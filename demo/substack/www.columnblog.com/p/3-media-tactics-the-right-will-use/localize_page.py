#!/usr/bin/env python3
"""Localize a Substack HTML page: download remote assets, rewrite references."""

import hashlib
import os
import re
import shutil
import urllib.request
import urllib.parse
from pathlib import Path

HTML_FILE = "index.html"
LOCAL_DIR = "local-assets"

def url_to_filename(url):
    """Create a hash-based filename from a URL."""
    h = hashlib.md5(url.encode()).hexdigest()[:12]
    # Extract extension
    parsed = urllib.parse.urlparse(url)
    path = parsed.path
    # Remove query params from extension detection
    ext = os.path.splitext(path)[1]
    if not ext or len(ext) > 10:
        # Try to guess from URL content
        if 'css' in url:
            ext = '.css'
        elif 'woff2' in url:
            ext = '.woff2'
        elif 'woff' in url:
            ext = '.woff'
        elif '.js' in path:
            ext = '.js'
        elif '.ico' in path:
            ext = '.ico'
        elif '.png' in path:
            ext = '.png'
        elif '.jpg' in path or '.jpeg' in path:
            ext = '.jpg'
        elif '.gif' in path:
            ext = '.gif'
        elif '.svg' in path:
            ext = '.svg'
        elif '.webp' in path:
            ext = '.webp'
        else:
            ext = '.bin'
    return f"{h}{ext}"

def fix_double_encoded_slashes(html):
    """Fix %252F -> %2F double-encoded slashes."""
    count = html.count('%252F')
    if count > 0:
        html = html.replace('%252F', '%2F')
        print(f"  Fixed {count} double-encoded slashes (%252F -> %2F)")
    return html

def remove_analytics(html):
    """Remove analytics and tracking scripts."""
    patterns = [
        # Sentry
        r'<script[^>]*js\.sentry-cdn\.com[^>]*>.*?</script>',
        r'<script[^>]*>[^<]*Sentry[^<]*</script>',
        # Cloudflare
        r'<script[^>]*cloudflare[^>]*>.*?</script>',
        r'<script[^>]*cloudflareinsights[^>]*>.*?</script>',
        # Google Tag Manager
        r'<script[^>]*googletagmanager[^>]*>.*?</script>',
        r'<script[^>]*>[^<]*gtag[^<]*</script>',
        r'<noscript><iframe[^>]*googletagmanager[^>]*>[^<]*</iframe></noscript>',
        # Generic analytics
        r'<script[^>]*>[^<]*Google Analytics[^<]*</script>',
    ]
    total = 0
    for p in patterns:
        matches = re.findall(p, html, re.DOTALL | re.IGNORECASE)
        if matches:
            total += len(matches)
            html = re.sub(p, '', html, flags=re.DOTALL | re.IGNORECASE)
    if total:
        print(f"  Removed {total} analytics/tracking scripts")
    return html

def remove_substack_js(html):
    """Remove Substack JS bundle scripts that don't work offline."""
    # Remove <script defer type="module" src="../../substackcdn.com/bundle/static/js/...">
    pattern = r'<script\s+defer\s+type="module"\s+src="[^"]*substackcdn\.com/bundle/static/js/[^"]*">\s*</script>'
    matches = re.findall(pattern, html)
    if matches:
        html = re.sub(pattern, '', html)
        print(f"  Removed {len(matches)} Substack JS module scripts")

    # Remove nomodule fallback scripts
    pattern2 = r'<script\s+defer\s+nomodule\s+src="[^"]*substackcdn\.com[^"]*">\s*</script>'
    matches2 = re.findall(pattern2, html)
    if matches2:
        html = re.sub(pattern2, '', html)
        print(f"  Removed {len(matches2)} nomodule fallback scripts")

    return html

def find_asset_refs(html):
    """Find all asset references that need localizing."""
    refs = set()

    # 1. Relative paths: ../../substackcdn.com/... and ../../fonts.gstatic.com/...
    for m in re.finditer(r'(?:src|href)=["\'](\.\./\.\./(?:substackcdn\.com|fonts\.gstatic\.com)/[^"\'\s]+)["\']', html):
        refs.add(m.group(1))

    # 2. In srcset attributes
    for m in re.finditer(r'srcset=["\']([^"\']+)["\']', html):
        srcset = m.group(1)
        for part in srcset.split(','):
            part = part.strip()
            url = part.split()[0] if part else ''
            if url.startswith('../../substackcdn.com/') or url.startswith('../../fonts.gstatic.com/'):
                refs.add(url)

    # 3. In url() CSS references
    for m in re.finditer(r'url\(["\']?(\.\./\.\./(?:substackcdn\.com|fonts\.gstatic\.com)/[^"\')\s]+)["\']?\)', html):
        refs.add(m.group(1))

    # 4. Absolute https:// URLs to substackcdn or fonts.gstatic
    for m in re.finditer(r'(?:src|href)=["\'](https://(?:substackcdn\.com|fonts\.gstatic\.com)/[^"\'\s]+)["\']', html):
        refs.add(m.group(1))

    # 5. https:// in srcset
    for m in re.finditer(r'srcset=["\']([^"\']+)["\']', html):
        srcset = m.group(1)
        for part in srcset.split(','):
            part = part.strip()
            url = part.split()[0] if part else ''
            if url.startswith('https://substackcdn.com/') or url.startswith('https://fonts.gstatic.com/'):
                refs.add(url)

    # 6. https:// in url()
    for m in re.finditer(r'url\(["\']?(https://(?:substackcdn\.com|fonts\.gstatic\.com)/[^"\')\s]+)["\']?\)', html):
        refs.add(m.group(1))

    # 7. Preload link refs
    for m in re.finditer(r'<link[^>]+href=["\'](\.\./\.\./(?:substackcdn\.com|fonts\.gstatic\.com)/[^"\']+)["\']', html):
        refs.add(m.group(1))

    return refs

def download_asset(url, local_dir):
    """Download an asset, trying local file first for relative paths, then CDN."""
    filename = url_to_filename(url)
    local_path = os.path.join(local_dir, filename)

    if os.path.exists(local_path):
        return filename

    # For relative paths, try to read the local file
    if url.startswith('../../'):
        local_file = url  # relative path
        if os.path.exists(local_file):
            shutil.copy2(local_file, local_path)
            return filename

        # Convert to CDN URL
        cdn_url = 'https://' + url[6:]  # strip ../../
    else:
        cdn_url = url

    # Download from CDN
    try:
        req = urllib.request.Request(cdn_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            with open(local_path, 'wb') as f:
                f.write(resp.read())
        return filename
    except Exception as e:
        print(f"  FAILED to download {cdn_url}: {e}")
        return None

def main():
    print("Localizing Substack page...")

    # Read HTML
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        html = f.read()

    original_len = len(html)

    # Step 1: Fix double-encoded slashes
    print("\n1. Fixing double-encoded slashes...")
    html = fix_double_encoded_slashes(html)

    # Step 2: Remove analytics
    print("\n2. Removing analytics scripts...")
    html = remove_analytics(html)

    # Step 3: Remove Substack JS bundles
    print("\n3. Removing Substack JS bundles...")
    html = remove_substack_js(html)

    # Step 4: Find all asset references
    print("\n4. Finding asset references...")
    refs = find_asset_refs(html)
    print(f"  Found {len(refs)} unique asset references")

    # Step 5: Create local-assets directory
    os.makedirs(LOCAL_DIR, exist_ok=True)

    # Step 6: Download assets
    print("\n5. Downloading assets...")
    url_to_local = {}
    downloaded = 0
    failed = 0
    for url in sorted(refs):
        filename = download_asset(url, LOCAL_DIR)
        if filename:
            url_to_local[url] = f"{LOCAL_DIR}/{filename}"
            downloaded += 1
        else:
            failed += 1
    print(f"  Downloaded: {downloaded}, Failed: {failed}")

    # Step 7: Replace URLs in HTML (longest first to avoid partial matches)
    print("\n6. Rewriting HTML references...")
    replacements = 0
    for url in sorted(url_to_local.keys(), key=len, reverse=True):
        local_path = url_to_local[url]
        count = html.count(url)
        if count > 0:
            html = html.replace(url, local_path)
            replacements += count

    print(f"  Replaced {replacements} references")

    # Step 8: Write updated HTML
    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f"\nDone! File size: {original_len} -> {len(html)} bytes")

if __name__ == '__main__':
    main()
