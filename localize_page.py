#!/usr/bin/env python3
"""
Localize a Substack HTML page for fully offline use.

Takes a local dev-server URL (e.g. http://localhost:8080/demo/substack/...)
or a file path, and:
  1. Fixes %252F double-encoded slashes
  2. Removes analytics/tracking scripts (Sentry, Cloudflare, GTM, Datadog)
  3. Removes Substack JS bundle <script> tags (non-functional offline)
  4. Downloads all remote assets (CSS, JS, images, fonts) to local-assets/
  5. Rewrites all HTML references to point to local-assets/
  6. Copies updated files to _site/ for the Eleventy dev server

Usage:
  python3 localize_page.py http://localhost:8080/demo/substack/site.com/p/article-slug/
  python3 localize_page.py demo/substack/site.com/p/article-slug/index.html
  python3 localize_page.py demo/substack/site.com/p/article-slug/

Options:
  --no-copy-to-site    Skip copying to _site/ directory
  --dry-run            Show what would be done without modifying files
"""

import argparse
import hashlib
import os
import re
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

LOCAL_ASSETS_DIR = "local-assets"

# Domains whose assets we download and localize
ASSET_DOMAINS = [
    "substackcdn.com",
    "fonts.gstatic.com",
    "fonts.googleapis.com",
    "substack-post-media.s3.amazonaws.com",
]

# Analytics / tracking script patterns to remove
ANALYTICS_PATTERNS = [
    # Sentry
    r'<script[^>]*js\.sentry-cdn\.com[^>]*>.*?</script>',
    r'<script[^>]*>[^<]*Sentry[^<]*</script>',
    # Cloudflare
    r'<script[^>]*cloudflare[^>]*>.*?</script>',
    r'<script[^>]*cloudflareinsights[^>]*>.*?</script>',
    # Google Tag Manager / Analytics
    r'<script[^>]*googletagmanager[^>]*>.*?</script>',
    r'<script[^>]*>[^<]*gtag[^<]*</script>',
    r'<noscript><iframe[^>]*googletagmanager[^>]*>[^<]*</iframe></noscript>',
    r'<script[^>]*>[^<]*Google Analytics[^<]*</script>',
    # Datadog RUM
    r'[ \t]*<script>\s*\(function\s*\(.*?\).*?datadoghq-browser-agent.*?</script>',
]

# Substack JS bundle patterns to remove (non-functional offline)
SUBSTACK_JS_PATTERNS = [
    # <script defer type="module" src="...substackcdn.com/bundle/static/js/...">
    r'<script\s+defer\s+type="module"\s+src="[^"]*substackcdn\.com/bundle/static/js/[^"]*"[^>]*>\s*</script>',
    # After localization rewrites src to local-assets/
    r'<script\s+defer\s+type="module"\s+src="local-assets/[^"]*\.js"[^>]*>\s*</script>',
    # nomodule fallback
    r'<script\s+defer\s+nomodule\s+src="[^"]*substackcdn\.com[^"]*"[^>]*>\s*</script>',
    r'<script\s+defer\s+nomodule\s+src="local-assets/[^"]*\.js"[^>]*>\s*</script>',
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def url_to_local_filename(url):
    """Generate a hash-based local filename from a URL.

    Uses md5(url)[:12] + detected extension. This avoids problematic
    characters like %2F in filenames that break Eleventy's dev server.
    """
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    ext = _detect_extension(url)
    return f"{h}{ext}"


def _detect_extension(url):
    """Best-effort extension detection from a URL string."""
    # Strip query string for cleaner path parsing
    path = url.split("?")[0].split("#")[0]

    # Try standard extension extraction
    _, ext = os.path.splitext(path)
    if ext and 1 < len(ext) <= 6:
        return ext

    # Fall back to checking known extensions anywhere in the URL
    known = [
        ".woff2", ".woff", ".ttf", ".eot",       # fonts
        ".css",                                     # stylesheets
        ".js",                                      # scripts
        ".jpeg", ".jpg", ".png", ".gif",            # images
        ".svg", ".webp", ".avif", ".ico",           # images
    ]
    for e in known:
        if e in url:
            return e

    return ".bin"


def resolve_html_file(input_path):
    """Turn a URL or path into an absolute path to the HTML file.

    Accepts:
      - http://localhost:8080/demo/substack/.../   -> <project>/demo/substack/.../index.html
      - demo/substack/.../index.html               -> <project>/demo/substack/.../index.html
      - demo/substack/.../                          -> <project>/demo/substack/.../index.html
    """
    # Strip localhost URL prefix
    input_path = re.sub(r'^https?://[^/]+/', '', input_path)

    # Strip leading/trailing slashes
    input_path = input_path.strip("/")

    # Find project root (directory containing .eleventy.js)
    project_root = _find_project_root()

    full_path = os.path.join(project_root, input_path)

    # If it's a directory, append index.html
    if os.path.isdir(full_path):
        full_path = os.path.join(full_path, "index.html")
    elif not full_path.endswith(".html"):
        full_path = os.path.join(full_path, "index.html")

    if not os.path.isfile(full_path):
        print(f"Error: File not found: {full_path}")
        sys.exit(1)

    return full_path


def _find_project_root():
    """Walk up from cwd to find the project root (contains .eleventy.js)."""
    d = os.path.abspath(os.getcwd())
    for _ in range(10):
        if os.path.isfile(os.path.join(d, ".eleventy.js")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    # Fall back to cwd
    return os.path.abspath(os.getcwd())


# ---------------------------------------------------------------------------
# Step 1: Fix double-encoded slashes
# ---------------------------------------------------------------------------

def fix_double_encoded_slashes(html):
    """Fix %252F -> %2F (double URL-encoding of forward slashes)."""
    count = html.count("%252F")
    if count:
        html = html.replace("%252F", "%2F")
        print(f"  Fixed {count} double-encoded slashes (%252F -> %2F)")
    return html


# ---------------------------------------------------------------------------
# Step 2: Remove analytics / tracking scripts
# ---------------------------------------------------------------------------

def remove_analytics_scripts(html):
    """Remove analytics and tracking script blocks."""
    total = 0
    for pattern in ANALYTICS_PATTERNS:
        matches = re.findall(pattern, html, re.DOTALL | re.IGNORECASE)
        if matches:
            total += len(matches)
            html = re.sub(pattern, "", html, flags=re.DOTALL | re.IGNORECASE)
    if total:
        print(f"  Removed {total} analytics/tracking scripts")
    return html


# ---------------------------------------------------------------------------
# Step 3: Remove Substack JS bundles
# ---------------------------------------------------------------------------

def remove_substack_js_bundles(html):
    """Remove Substack JS bundle <script> tags (non-functional offline)."""
    total = 0
    for pattern in SUBSTACK_JS_PATTERNS:
        matches = re.findall(pattern, html)
        if matches:
            total += len(matches)
            html = re.sub(pattern, "", html)
    if total:
        print(f"  Removed {total} Substack JS bundle script tags")
    return html


# ---------------------------------------------------------------------------
# Step 4: Find asset references
# ---------------------------------------------------------------------------

def _domain_pattern():
    """Build a regex alternation for asset domains."""
    escaped = [re.escape(d) for d in ASSET_DOMAINS]
    return "|".join(escaped)


def find_all_asset_refs(html):
    """Find every asset URL that should be localized.

    Searches src=, href=, srcset=, and url() for references to asset
    domains, both as relative ../../domain/... paths and absolute
    https://domain/... URLs.
    """
    refs = set()
    domain_re = _domain_pattern()

    # --- Relative paths (../../domain/...) ---

    # In src= and href= (no commas — simple attributes)
    for m in re.finditer(
        rf'(?:src|href)=["\'](\.\./\.\./(?:{domain_re})/[^"\'\s]+)["\']', html
    ):
        refs.add(m.group(1))

    # In <link> preload/stylesheet href=
    for m in re.finditer(
        rf'<link[^>]+href=["\'](\.\./\.\./(?:{domain_re})/[^"\']+)["\']', html
    ):
        refs.add(m.group(1))

    # In url() CSS
    for m in re.finditer(
        rf'url\(["\']?(\.\./\.\./(?:{domain_re})/[^"\')\s]+)["\']?\)', html
    ):
        refs.add(m.group(1))

    # In srcset= (may contain commas and size descriptors)
    for m in re.finditer(r'srcset=["\']([^"\']+)["\']', html):
        for part in m.group(1).split(","):
            url = part.strip().split()[0] if part.strip() else ""
            if re.match(rf'\.\./\.\./(?:{domain_re})/', url):
                refs.add(url)

    # Relative paths with commas (Substack image transform params like w_424,c_limit,...)
    for m in re.finditer(
        rf'\.\./\.\./(?:{domain_re})/image/fetch/[^\s"\'<>)]+', html
    ):
        refs.add(m.group(0))

    # --- Absolute https:// URLs ---

    for m in re.finditer(
        rf'(?:src|href)=["\'](https://(?:{domain_re})/[^"\'\s]+)["\']', html
    ):
        refs.add(m.group(1))

    for m in re.finditer(
        rf'url\(["\']?(https://(?:{domain_re})/[^"\')\s]+)["\']?\)', html
    ):
        refs.add(m.group(1))

    for m in re.finditer(r'srcset=["\']([^"\']+)["\']', html):
        for part in m.group(1).split(","):
            url = part.strip().split()[0] if part.strip() else ""
            if re.match(rf'https://(?:{domain_re})/', url):
                refs.add(url)

    return refs


# ---------------------------------------------------------------------------
# Step 5: Download assets
# ---------------------------------------------------------------------------

def download_asset(url, local_dir):
    """Download a single asset to local_dir. Returns local filename or None."""
    filename = url_to_local_filename(url)
    dest = os.path.join(local_dir, filename)

    # Already downloaded
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return filename

    # For relative paths, try the local file on disk first
    if url.startswith("../../"):
        local_source = url
        if os.path.isfile(local_source):
            shutil.copy2(local_source, dest)
            return filename
        # Convert to absolute CDN URL
        cdn_url = "https://" + url[6:]
    else:
        cdn_url = url

    # Download from CDN
    try:
        req = urllib.request.Request(cdn_url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
        with open(dest, "wb") as f:
            f.write(data)
        return filename
    except Exception as e:
        print(f"    FAILED: {cdn_url[:100]}  ({e})")
        return None


def download_all_assets(refs, local_dir):
    """Download all asset refs. Returns {original_url: local_relative_path}."""
    os.makedirs(local_dir, exist_ok=True)

    url_map = {}
    ok = 0
    fail = 0

    for url in sorted(refs):
        filename = download_asset(url, local_dir)
        if filename:
            url_map[url] = f"{LOCAL_ASSETS_DIR}/{filename}"
            ok += 1
        else:
            fail += 1

    print(f"  Downloaded: {ok}  |  Failed: {fail}")
    return url_map


# ---------------------------------------------------------------------------
# Step 6: Rewrite HTML references
# ---------------------------------------------------------------------------

def rewrite_html_refs(html, url_map):
    """Replace all original URLs with their local-assets/ paths.

    Replaces longest URLs first to prevent partial-match corruption.
    """
    replaced = 0
    for url in sorted(url_map.keys(), key=len, reverse=True):
        local_path = url_map[url]
        count = html.count(url)
        if count:
            html = html.replace(url, local_path)
            replaced += count

    print(f"  Rewrote {replaced} references")
    return html


# ---------------------------------------------------------------------------
# Step 7: Copy to _site/
# ---------------------------------------------------------------------------

def copy_to_site(html_file, local_assets_dir, project_root):
    """Copy the updated HTML and local-assets/ to the _site/ output directory."""
    # Compute relative path from project root
    rel = os.path.relpath(html_file, project_root)
    site_html = os.path.join(project_root, "_site", rel)
    site_dir = os.path.dirname(site_html)

    os.makedirs(site_dir, exist_ok=True)
    shutil.copy2(html_file, site_html)

    # Copy local-assets directory
    src_assets = local_assets_dir
    dest_assets = os.path.join(site_dir, LOCAL_ASSETS_DIR)
    if os.path.isdir(src_assets):
        os.makedirs(dest_assets, exist_ok=True)
        for f in os.listdir(src_assets):
            shutil.copy2(
                os.path.join(src_assets, f),
                os.path.join(dest_assets, f),
            )
    print(f"  Copied to {os.path.relpath(site_html, project_root)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Localize a Substack HTML page for offline use."
    )
    parser.add_argument(
        "url",
        help="Local dev-server URL or file path to the HTML page",
    )
    parser.add_argument(
        "--no-copy-to-site",
        action="store_true",
        help="Skip copying results to _site/ directory",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be done without modifying files",
    )
    args = parser.parse_args()

    # Resolve input to an absolute HTML file path
    html_file = resolve_html_file(args.url)
    html_dir = os.path.dirname(html_file)
    project_root = _find_project_root()
    local_assets_dir = os.path.join(html_dir, LOCAL_ASSETS_DIR)

    print(f"Localizing: {os.path.relpath(html_file, project_root)}")
    print(f"Project root: {project_root}")

    # Work from the HTML file's directory (so relative ../../ paths resolve)
    original_cwd = os.getcwd()
    os.chdir(html_dir)

    # Read HTML
    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()
    original_size = len(html)

    # Step 1
    print("\n1. Fixing double-encoded slashes...")
    html = fix_double_encoded_slashes(html)

    # Step 2
    print("\n2. Removing analytics/tracking scripts...")
    html = remove_analytics_scripts(html)

    # Step 3
    print("\n3. Removing Substack JS bundles...")
    html = remove_substack_js_bundles(html)

    # Step 4
    print("\n4. Finding asset references...")
    refs = find_all_asset_refs(html)
    print(f"  Found {len(refs)} unique asset references")

    if args.dry_run:
        print("\n  [DRY RUN] Would download and rewrite the above references.")
        for url in sorted(refs)[:20]:
            print(f"    {url[:120]}")
        if len(refs) > 20:
            print(f"    ... and {len(refs) - 20} more")
        os.chdir(original_cwd)
        return

    # Step 5
    print("\n5. Downloading assets...")
    url_map = download_all_assets(refs, local_assets_dir)

    # Step 6
    print("\n6. Rewriting HTML references...")
    html = rewrite_html_refs(html, url_map)

    # Step 3 again — catch any JS bundle tags whose src was just rewritten
    print("\n7. Removing any remaining Substack JS bundle tags...")
    html = remove_substack_js_bundles(html)

    # Write updated HTML
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"\n  File size: {original_size:,} -> {len(html):,} bytes")

    # Step 7: Copy to _site/
    if not args.no_copy_to_site:
        print("\n8. Copying to _site/...")
        copy_to_site(html_file, local_assets_dir, project_root)

    os.chdir(original_cwd)
    print("\nDone!")


if __name__ == "__main__":
    main()
