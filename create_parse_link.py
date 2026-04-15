#!/usr/bin/env python3
"""
create_parse_link.py

End-to-end pipeline for a Substack (or any) article URL:

  1. Download  — wget -p -k <url> into demo/substack/
  2. Rename    — move the downloaded file to <slug>/index.html
  3. Localize  — download remote assets and rewrite references for offline use
  4. Match     — map smart-quoted passages to source URLs
  5. Annotate  — wrap matched passages with <q cite="url">...</q>
  6. CiteIt    — inject jQuery/CiteIt header+footer deps; add data-citeit-citing-url

Steps 3-5 import functions directly from the sibling scripts so logic
stays in one place:
  localize_page.py, match_quotes_to_sources.py, apply_quote_matches.py

Usage:
  python3 create_parse_link.py <url>
  python3 create_parse_link.py <url> --sources path/to/source_urls.txt
  python3 create_parse_link.py <url> --skip-download
  python3 create_parse_link.py <url> --skip-localize
  python3 create_parse_link.py <url> --skip-match
  python3 create_parse_link.py <url> --no-copy-to-site
  python3 create_parse_link.py <url> --min-quote-words 4 --match-threshold 0.7

Examples:
  # Full pipeline — first run for a new article
  python3 create_parse_link.py https://www.columnblog.com/p/3-media-tactics-the-right-will-use

  # Re-run matching only after editing source_urls.txt
  python3 create_parse_link.py https://www.columnblog.com/p/3-media-tactics-the-right-will-use \\
      --skip-download --skip-localize

  # Apply an already-generated quote_matches.txt without re-fetching sources
  python3 create_parse_link.py https://www.columnblog.com/p/3-media-tactics-the-right-will-use \\
      --skip-download --skip-localize --skip-match
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# CiteIt dependency blocks injected in Step 6
# ---------------------------------------------------------------------------

CITEIT_HEADER = """\
    <!-- ############################### Begin: CiteIt Dependencies ##################################
        - jQuery: manipulate Dom:
        - query api.CiteIt.net
        - download JSON to hidden citeit_container div
        - add arrows and popup links to q tags and blockquotes

    ====== 1) jQuery -->
    <script src="https://code.jquery.com/jquery-1.12.4.min.js"
        integrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ="
        crossorigin="anonymous">
    </script>

    <!-- 2) jQuery Migrate: Used to migrate jQuery: https://github.com/jquery/jquery-migrate -->
    <script src="https://code.jquery.com/jquery-migrate-1.4.1.min.js"
        integrity="sha256-SOuLUArmo4YXtXONKz+uxIGSKneCJG4x0nVcA0pFzV0="
        crossorigin="anonymous">
    </script>

    <!-- 3) Generate q-tag Popup -->
    <script
        src="https://code.jquery.com/ui/1.12.1/jquery-ui.min.js"
        integrity="sha256-VazP97ZCwtekAsvgPBSUwPFKdrwD3unUfSGVYrahUqU="
        crossorigin="anonymous">
    </script>

    <!-- 4) Calculate JSON Hash values using sha256 library -->
    <script src='/assets/wordpress/plugins/CiteIt.net/lib/forge-sha256/forge/forge-sha256.min.js' defer></script>

    <!-- 5) jsVideoUrlParser: Detect Domain: Determine if an Embed code can be used: YouTube, Vimeo, Soundcloud -->
    <script src='/assets/wordpress/plugins/CiteIt.net/lib/jsVideoUrlParser/dist/jsVideoUrlParser.min.js' defer></script>

    <!--CSS Styles: CiteIt & JQuery Popup Window -->
    <link rel='stylesheet' href='/assets/wordpress/plugins/CiteIt.net/lib/jquery-ui-1.12.1/jquery-ui.min.css' type='text/css' media='all' />
    <link rel='stylesheet' href='/assets/wordpress/plugins/CiteIt.net/css/CiteIt-library.css' type='text/css' media='all' />

    <link rel='stylesheet' href='/assets/css/citeit-wikipedia.css' type='text/css' media='all' />
    <link rel='stylesheet' href='/assets/css/citeit.css' type='text/css' media='all' />

    <!-- 6) Main CiteIt Javascript Code: Download JSON & Create Popup windows and Expanding Arrows -->
    <script src='/assets/wordpress/plugins/CiteIt.net/js/versions/0.4/CiteIt-quote-context.js' defer></script>

    <!-- ############################### End: CiteIt.net Dependencies ##################################-->
"""

CITEIT_FOOTER = """\
\t<!-- ################ Begin: CiteIt.net Dependencies ############# -->
\t  <div id='citeit_container'><!-- CiteIt-quote-context.js injects data returned from lookup in this hidden div --></div>
\t  <script>
\t\t// Call CiteIt.net plugin on all q-tags and blockquotes:
\t\t$( document ).ready(function() {
\t\t\tjQuery('q, blockquote').quoteContext2();
\t\t});
\t  </script>
\t<!-- ############### End: CiteIt.net Dependencies ############## -->
"""


# ---------------------------------------------------------------------------
# Project root
# ---------------------------------------------------------------------------

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
    return os.path.abspath(os.getcwd())


# ---------------------------------------------------------------------------
# URL parsing
# ---------------------------------------------------------------------------

def parse_article_url(url):
    """
    Parse an article URL into (domain, slug).

    Input:  https://www.columnblog.com/p/3-media-tactics-the-right-will-use
    Output: ('www.columnblog.com', '3-media-tactics-the-right-will-use')

    Also handles non-Substack URLs; uses the last path component as the slug.
    """
    parsed = urlparse(url)
    netloc = parsed.netloc
    path = parsed.path.rstrip("/")

    # Handle localhost URLs that embed the real domain in the path:
    # e.g. http://localhost:8080/demo/substack/www.dropsitenews.com/p/slug/
    if netloc.startswith("localhost") or netloc.startswith("127.0.0.1"):
        m = re.search(r"/demo/substack/([^/]+)/p/([^/]+)", path)
        if m:
            return m.group(1), m.group(2)
        # Fallback: strip the demo/substack prefix and parse normally
        path = re.sub(r"^/demo/substack/", "", path)
        parts = path.split("/")
        domain = parts[0] if parts else netloc
        m2 = re.search(r"/p/([^/]+)$", "/" + "/".join(parts[1:]))
        slug = m2.group(1) if m2 else (parts[-1] if parts else "index")
        return domain, slug

    domain = netloc

    # Prefer the component after /p/ if present (Substack convention)
    m = re.search(r"/p/([^/]+)$", path)
    if m:
        slug = m.group(1)
    else:
        slug = path.split("/")[-1] if path else "index"

    return domain, slug


def article_dir_path(project_root, domain, slug):
    """Return the canonical article directory: demo/substack/<domain>/p/<slug>/"""
    return os.path.join(project_root, "demo", "substack", domain, "p", slug)


# ---------------------------------------------------------------------------
# Step 1: wget download
# ---------------------------------------------------------------------------

def wget_download(url, dest_prefix):
    """
    Run wget -p -k to download the page and all requisite assets.

      -p   Download all page prerequisites (CSS, images, JS)
      -k   Convert links to local after download
      --adjust-extension   Ensure saved HTML gets .html extension
      -e robots=off        Ignore robots.txt
      -P <dest_prefix>     Root directory for mirrored files

    Returns True if wget exited cleanly, False otherwise.
    wget often exits non-zero even on a successful download (e.g. when
    some assets 404), so the caller should check for the output file
    rather than relying solely on the return value.
    """
    cmd = [
        "wget",
        "-p",
        "-k",
        "--adjust-extension",
        "-e", "robots=off",
        "--no-check-certificate",
        "-P", dest_prefix,
        url,
    ]
    print("  Running: " + " ".join(cmd))
    result = subprocess.run(cmd)
    return result.returncode == 0


# ---------------------------------------------------------------------------
# Step 2: Find and rename to <slug>/index.html
# ---------------------------------------------------------------------------

def find_wget_html(base_dir, domain, slug):
    """
    Locate the HTML file that wget created for the given domain/slug.

    wget -p -k saves the main page as one of:
      <base_dir>/<domain>/p/<slug>.html    (URL without trailing slash)
      <base_dir>/<domain>/p/<slug>/index.html  (URL with trailing slash)
      <base_dir>/<domain>/p/<slug>         (no extension, less common)

    Returns the absolute path to the HTML file, or None if not found.
    """
    candidates = [
        os.path.join(base_dir, domain, "p", slug + ".html"),
        os.path.join(base_dir, domain, "p", slug, "index.html"),
        os.path.join(base_dir, domain, "p", slug),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def rename_to_index_html(wget_html, article_dir):
    """
    Move <slug>.html (or wherever wget placed it) to <article_dir>/index.html.

    Creates article_dir if it does not exist.
    Returns the final path to index.html.
    """
    target = os.path.join(article_dir, "index.html")

    if os.path.abspath(wget_html) == os.path.abspath(target):
        print(f"  Already in place: {target}")
        return target

    os.makedirs(article_dir, exist_ok=True)
    shutil.move(wget_html, target)
    print(f"  Moved: {wget_html}")
    print(f"      → {target}")
    return target


def move_wget_asset_dirs(wget_prefix, domain, slug, article_dir):
    """
    Move asset directories wget created alongside the HTML file into article_dir.

    wget places asset directories (e.g. substackcdn.com/, fonts.gstatic.com/)
    in the same parent folder as the HTML file.  After we rename the HTML into
    its own subdirectory those relative paths would break, so we move them too.
    localize_page.py will then re-download and rewrite them into local-assets/.
    """
    parent = os.path.join(wget_prefix, domain, "p")
    if not os.path.isdir(parent):
        return

    moved = 0
    for entry in os.listdir(parent):
        entry_path = os.path.join(parent, entry)
        if not os.path.isdir(entry_path):
            continue
        if entry == slug:
            continue  # that's our article dir itself
        dest = os.path.join(article_dir, entry)
        if os.path.exists(dest):
            # Merge contents
            for f in os.listdir(entry_path):
                shutil.move(os.path.join(entry_path, f),
                            os.path.join(dest, f))
            shutil.rmtree(entry_path, ignore_errors=True)
        else:
            shutil.move(entry_path, dest)
        print(f"  Moved asset dir: {entry} → {os.path.relpath(dest)}")
        moved += 1

    if moved:
        print(f"  Moved {moved} wget asset dir(s) into article dir")


# ---------------------------------------------------------------------------
# Step 3: Localize (delegates to localize_page.py)
# ---------------------------------------------------------------------------

def run_localize(html_file, project_root, copy_to_site=True):
    """
    Apply localize_page.py logic to html_file in-place.

    Imports functions directly from the sibling script so any future
    changes to localize_page.py are automatically reflected here.
    """
    import localize_page as lp

    html_dir = os.path.dirname(html_file)
    local_assets_dir = os.path.join(html_dir, lp.LOCAL_ASSETS_DIR)

    original_cwd = os.getcwd()
    os.chdir(html_dir)

    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()
    original_size = len(html)

    print("  a. Fixing double-encoded slashes...")
    html = lp.fix_double_encoded_slashes(html)

    print("  b. Removing analytics/tracking scripts...")
    html = lp.remove_analytics_scripts(html)

    print("  c. Removing Substack JS bundles...")
    html = lp.remove_substack_js_bundles(html)

    print("  d. Finding asset references...")
    refs = lp.find_all_asset_refs(html)
    print(f"     Found {len(refs)} unique asset references")

    print("  e. Downloading assets...")
    url_map = lp.download_all_assets(refs, local_assets_dir)

    print("  f. Rewriting HTML references...")
    html = lp.rewrite_html_refs(html, url_map)

    print("  g. Second pass — removing any re-written Substack JS bundles...")
    html = lp.remove_substack_js_bundles(html)

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"     File size: {original_size:,} → {len(html):,} bytes")

    if copy_to_site:
        print("  h. Copying to _site/...")
        lp.copy_to_site(html_file, local_assets_dir, project_root)

    os.chdir(original_cwd)


# ---------------------------------------------------------------------------
# Step 4: Match quotes to sources (delegates to match_quotes_to_sources.py)
# ---------------------------------------------------------------------------

def run_match(html_file, sources_file, matches_output,
              min_words=4, threshold=0.7):
    """
    Extract smart-quoted passages from html_file, fetch each source URL,
    and write quote_matches.txt.

    Imports functions directly from match_quotes_to_sources.py.
    Returns True if at least one quote was found, False otherwise.
    """
    import match_quotes_to_sources as mqs

    with open(html_file, "r", encoding="utf-8") as f:
        target_html = f.read()

    # 4a: Extract quotes
    print(f"  Extracting quoted passages (min {min_words} words)...")
    quotes = mqs.extract_smart_quotes(target_html, min_words=min_words)
    print(f"  Found {len(quotes)} quote(s)")
    for q in quotes:
        print(f"    [{q['index']}] {q['plain_text'][:70]}...")

    if not quotes:
        print("  No smart-quoted passages found — skipping source matching.")
        return False

    # 4b: Load source URLs — div#citeit-urls is authoritative; fall back to file
    source_urls = mqs.load_source_urls_from_html(html_file)
    if source_urls:
        print(f"\n  Loaded {len(source_urls)} source URL(s) from "
              f"<div id=\"citeit-urls\">")
    else:
        source_urls = mqs.load_source_urls(sources_file)
        print(f"\n  Loaded {len(source_urls)} source URL(s) from "
              f"{os.path.basename(sources_file)}")

    # 4c: Fetch source pages
    cache_dir = os.path.join(os.path.dirname(html_file), ".source_cache")
    print(f"\n  Fetching {len(source_urls)} source page(s)...")
    source_texts = {}
    for i, url in enumerate(source_urls, 1):
        print(f"\n    [{i}/{len(source_urls)}] {url[:80]}")
        text, fetched_url = mqs.fetch_source_text(url, cache_dir)
        if text:
            source_texts[url] = text
            if fetched_url and fetched_url != url:
                print(f"      (via: {fetched_url[:80]})")
            print(f"      OK: {len(text):,} chars")
        else:
            print("      FAILED: could not fetch or extract text")
        time.sleep(1)  # rate-limit

    print(f"\n  Fetched {len(source_texts)}/{len(source_urls)} sources successfully")

    # 4d: Match each quote to best source
    print(f"\n  Matching {len(quotes)} quote(s) against "
          f"{len(source_texts)} source(s)...")
    matches = []
    matched_count = 0
    for q in quotes:
        best_url, score, method = mqs.match_quote_to_sources(
            q["plain_text"], source_texts, threshold
        )
        matches.append((q["index"], best_url, score, method))
        if best_url:
            matched_count += 1
            print(f"    [{q['index']}] MATCH  score={score:.2f} ({method})")
            print(f"           Quote:  {q['plain_text'][:55]}...")
            print(f"           Source: {best_url[:70]}")
        else:
            print(f"    [{q['index']}] UNMATCHED: {q['plain_text'][:60]}...")

    # 4e: Write output
    mqs.write_output(matches, matches_output, quotes)
    print(f"\n  {matched_count}/{len(matches)} quotes matched")
    return True


# ---------------------------------------------------------------------------
# Step 5: Apply <q cite> tags (delegates to apply_quote_matches.py)
# ---------------------------------------------------------------------------

def run_annotate(html_file, matches_file):
    """
    Read quote_matches.txt and wrap each matched passage in the HTML with
    <q cite="url">...</q>.

    Imports functions directly from apply_quote_matches.py.
    """
    import apply_quote_matches as aqm

    with open(html_file, "r", encoding="utf-8") as f:
        target_html = f.read()

    matches = aqm.parse_matches_file(matches_file)
    print(f"  Found {len(matches)} quote-to-source mapping(s)")

    if not matches:
        print("  Nothing to apply.")
        return

    applied = 0
    for quote_text, source_url in matches:
        display = (quote_text[:50] + "...") if len(quote_text) > 50 else quote_text
        print(f'\n  "{display}"')
        original = target_html
        target_html = aqm.apply_q_cite(target_html, source_url, quote_text)
        if target_html != original:
            applied += 1

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(target_html)

    print(f"\n  Applied {applied}/{len(matches)} <q cite> tag(s)")


# ---------------------------------------------------------------------------
# source_urls.txt helper + auto-detection (logic lives in match_quotes_to_sources)
# ---------------------------------------------------------------------------

def ensure_source_urls(article_dir, url):
    """
    Return the path to source_urls.txt in the article directory.

    Primary source of URLs is <div id="citeit-urls"> in the article HTML.
    Falls back to auto-detection from the HTML when both are empty.
    Existing manually-added URLs are never overwritten (merge strategy).
    """
    import match_quotes_to_sources as mqs

    path = os.path.join(article_dir, "source_urls.txt")
    html_file = os.path.join(article_dir, "index.html")

    # Create placeholder if the file doesn't exist yet
    if not os.path.isfile(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# Source URLs for: {url}\n")
            f.write("#\n")
            f.write("# Add one URL per line — these are pages the article quotes from.\n")
            f.write("# Lines starting with # are ignored.  Blank lines are ignored.\n")
            f.write("#\n")
            f.write("# Example:\n")
            f.write("# https://www.nytimes.com/2026/01/01/example.html\n")
            f.write("# https://bsky.app/profile/user.bsky.social/post/abc123\n")
            f.write("# https://x.com/user/status/1234567890\n")
        print(f"\n  Created: {path}")

    # Check for real (non-comment) URLs already in source_urls.txt
    with open(path, "r", encoding="utf-8") as f:
        existing_lines = f.readlines()
    real_urls = {
        line.strip() for line in existing_lines
        if line.strip() and not line.strip().startswith("#")
    }

    if real_urls:
        return path  # Already populated — nothing to do

    if not os.path.isfile(html_file):
        print("  index.html not found; cannot auto-detect source URLs.")
        return path

    # Try reading from <div id="citeit-urls"> first
    html_urls = mqs.load_source_urls_from_html(html_file)
    if html_urls:
        print(f"  Found {len(html_urls)} URL(s) in <div id=\"citeit-urls\">")
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n# --- from citeit-urls div ---\n")
            for u in html_urls:
                if u not in real_urls:
                    f.write(u + "\n")
                    real_urls.add(u)
        return path

    # Fallback: auto-detect from HTML content
    domain, _ = parse_article_url(url)
    print("  source_urls.txt is empty — auto-detecting from HTML...")
    detected = mqs.auto_detect_source_urls(html_file, domain)

    if not detected:
        print("  No source URLs auto-detected.")
        print(f"  Edit manually: {os.path.relpath(path)}")
        return path

    new_entries = []
    for det_url, label in detected:
        if det_url not in real_urls:
            new_entries.append((det_url, label))
            real_urls.add(det_url)

    if new_entries:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n# --- auto-detected ---\n")
            for det_url, label in new_entries:
                f.write(f"# auto-detected ({label})\n")
                f.write(det_url + "\n")
        print(f"  Added {len(new_entries)} auto-detected URL(s) to source_urls.txt")

        # Also write them into <div id="citeit-urls"> if the file has CiteIt deps
        if os.path.isfile(html_file):
            mqs.write_citeit_urls_div(html_file, [u for u, _ in new_entries])
    else:
        print("  All auto-detected URLs already present in source_urls.txt")

    return path


# ---------------------------------------------------------------------------
# Step 6: Inject CiteIt dependencies
# ---------------------------------------------------------------------------

def _add_citing_url_to_q_tags(html, local_citing_url):
    """Add data-citeit-citing-url to <q> tags that don't already have it."""
    def replace_q(m):
        attrs = m.group(1)
        if "data-citeit-citing-url" in attrs:
            return m.group(0)
        return "<q" + attrs + ' data-citeit-citing-url="' + local_citing_url + '">'
    return re.sub(r"<q(\b[^>]*)>", replace_q, html)


def run_inject_citeit(html_file, article_url):
    """
    Step 6: Inject CiteIt header and footer dependency blocks into html_file.

    - Skips if citeit_container is already present (idempotent)
    - Inserts CITEIT_HEADER just before </head>
    - Inserts CITEIT_FOOTER just before </body>
    - Adds data-citeit-citing-url to all <q> tags (localhost:8080 path)
    """
    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()

    if "citeit_container" in html:
        print("  citeit_container already present — skipping.")
        return

    # Build the localhost URL for this article
    domain, slug = parse_article_url(article_url)
    local_path = "/demo/substack/{}/p/{}/".format(domain, slug)
    local_citing_url = "http://localhost:8080" + local_path
    print("  data-citeit-citing-url: " + local_citing_url)

    # Patch <q> tags with the citing URL
    html = _add_citing_url_to_q_tags(html, local_citing_url)

    # Insert header block just before </head>
    if "</head>" in html:
        html = html.replace("</head>", CITEIT_HEADER + "    </head>", 1)
    else:
        print("  Warning: </head> not found — skipping header injection")

    # Insert footer block just before </body>
    if "</body>" in html:
        html = html.replace("</body>", CITEIT_FOOTER + "    </body>", 1)
    else:
        print("  Warning: </body> not found — skipping footer injection")

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html)

    print("  CiteIt dependencies injected.")

    # Inject <div id="citeit-urls"> with any already-detected source URLs
    import match_quotes_to_sources as mqs
    detected = mqs.auto_detect_source_urls(html_file, domain)
    if detected:
        mqs.write_citeit_urls_div(html_file, [u for u, _ in detected])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description=(
            "Download a Substack article, rename to index.html, "
            "match quotes to source URLs, and wrap with <q cite>."
        )
    )
    parser.add_argument("url", help="Article URL to download and process")
    parser.add_argument(
        "--sources", default=None,
        help="Path to source_urls.txt (default: auto-locate in article dir)",
    )
    parser.add_argument(
        "--skip-download", action="store_true",
        help="Skip wget download — index.html must already exist",
    )
    parser.add_argument(
        "--skip-localize", action="store_true",
        help="Skip asset localization step",
    )
    parser.add_argument(
        "--skip-match", action="store_true",
        help="Skip quote matching — use existing quote_matches.txt",
    )
    parser.add_argument(
        "--skip-citeit", action="store_true",
        help="Skip CiteIt dependency injection (Step 6)",
    )
    parser.add_argument(
        "--no-copy-to-site", action="store_true",
        help="Skip copying result to _site/ (Eleventy dev server)",
    )
    parser.add_argument(
        "--min-quote-words", type=int, default=4,
        help="Minimum word count for a quoted passage to be matched (default: 4)",
    )
    parser.add_argument(
        "--match-threshold", type=float, default=0.7,
        help="Word-overlap ratio threshold for fuzzy matching (default: 0.7)",
    )
    args = parser.parse_args()

    url = args.url.rstrip("/")
    project_root = _find_project_root()

    # Ensure sibling scripts (localize_page, match_quotes_to_sources,
    # apply_quote_matches) are importable by inserting their directory first.
    script_dir = os.path.dirname(os.path.abspath(__file__))
    if script_dir not in sys.path:
        sys.path.insert(0, script_dir)

    domain, slug = parse_article_url(url)
    article_dir = article_dir_path(project_root, domain, slug)
    html_file = os.path.join(article_dir, "index.html")
    matches_file = os.path.join(article_dir, "quote_matches.txt")
    wget_prefix = os.path.join(project_root, "demo", "substack")

    print("=" * 60)
    print(f"URL:          {url}")
    print(f"Domain:       {domain}")
    print(f"Slug:         {slug}")
    print(f"Article dir:  {os.path.relpath(article_dir, project_root)}")
    print(f"Project root: {project_root}")
    print("=" * 60)

    # ------------------------------------------------------------------
    # Steps 1 & 2: Download and rename
    # ------------------------------------------------------------------
    if not args.skip_download:
        print("\n--- Step 1: Downloading with wget ---")
        ok = wget_download(url, wget_prefix)
        if not ok:
            print("  Warning: wget returned non-zero — checking for output anyway")

        print("\n--- Step 2: Renaming to index.html ---")
        wget_html = find_wget_html(wget_prefix, domain, slug)

        if wget_html is None:
            if os.path.isfile(html_file):
                print(f"  index.html already exists: "
                      f"{os.path.relpath(html_file, project_root)}")
            else:
                print(f"\nError: wget output not found for {domain}/p/{slug}")
                print("  Looked for:")
                print(f"    demo/substack/{domain}/p/{slug}.html")
                print(f"    demo/substack/{domain}/p/{slug}/index.html")
                print("  Check that wget succeeded and the URL is correct.")
                sys.exit(1)
        else:
            rename_to_index_html(wget_html, article_dir)
            move_wget_asset_dirs(wget_prefix, domain, slug, article_dir)
    else:
        print("\n--- Steps 1 & 2: Skipped (--skip-download) ---")
        if not os.path.isfile(html_file):
            print(f"Error: Expected file not found: {html_file}")
            sys.exit(1)
        print(f"  Using: {os.path.relpath(html_file, project_root)}")

    # ------------------------------------------------------------------
    # Step 3: Localize assets
    # ------------------------------------------------------------------
    if not args.skip_localize:
        print("\n--- Step 3: Localizing assets ---")
        run_localize(
            html_file, project_root,
            copy_to_site=not args.no_copy_to_site,
        )
    else:
        print("\n--- Step 3: Skipped (--skip-localize) ---")

    # ------------------------------------------------------------------
    # Step 4: Match quotes to sources
    # ------------------------------------------------------------------
    if not args.skip_match:
        print("\n--- Step 4: Matching quotes to source URLs ---")

        if args.sources:
            sources_file = args.sources
            if not os.path.isabs(sources_file):
                sources_file = os.path.join(project_root, sources_file)
            if not os.path.isfile(sources_file):
                print(f"Error: --sources file not found: {sources_file}")
                sys.exit(1)
        else:
            sources_file = ensure_source_urls(article_dir, url)

        # Check whether source_urls.txt has any real (non-comment) URLs
        with open(sources_file, "r", encoding="utf-8") as f:
            real_urls = [
                line.strip() for line in f
                if line.strip() and not line.strip().startswith("#")
            ]

        if not real_urls:
            print(f"  source_urls.txt has no URLs — skipping match step.")
            print(f"  Edit: {os.path.relpath(sources_file, project_root)}")
            print("  Then re-run with: --skip-download --skip-localize")
        else:
            run_match(
                html_file, sources_file, matches_file,
                min_words=args.min_quote_words,
                threshold=args.match_threshold,
            )
    else:
        print("\n--- Step 4: Skipped (--skip-match) ---")

    # ------------------------------------------------------------------
    # Step 5: Apply <q cite> tags
    # ------------------------------------------------------------------
    print("\n--- Step 5: Applying <q cite> tags ---")
    if not os.path.isfile(matches_file):
        print(f"  quote_matches.txt not found: {matches_file}")
        print("  Run step 4 first (omit --skip-match) to generate it.")
    else:
        run_annotate(html_file, matches_file)

    # ------------------------------------------------------------------
    # Step 6: Inject CiteIt dependencies
    # ------------------------------------------------------------------
    if not args.skip_citeit:
        print("\n--- Step 6: Injecting CiteIt dependencies ---")
        run_inject_citeit(html_file, url)
    else:
        print("\n--- Step 6: Skipped (--skip-citeit) ---")

    # If localization was skipped we still sync the annotated HTML to _site/
    if args.skip_localize and not args.no_copy_to_site and os.path.isfile(html_file):
        import localize_page as lp
        local_assets_dir = os.path.join(article_dir, lp.LOCAL_ASSETS_DIR)
        lp.copy_to_site(html_file, local_assets_dir, project_root)
        print(f"  Synced updated index.html to _site/")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("Done!")
    print(f"  HTML:    {os.path.relpath(html_file, project_root)}")
    if os.path.isfile(matches_file):
        print(f"  Matches: {os.path.relpath(matches_file, project_root)}")
    sources_file_default = os.path.join(article_dir, "source_urls.txt")
    if os.path.isfile(sources_file_default):
        print(f"  Sources: {os.path.relpath(sources_file_default, project_root)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
