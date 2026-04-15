#!/usr/bin/env python3
"""
Match quoted text in a target HTML page to source URLs.

Extracts text between smart quotes from the target page, fetches each
source URL to get its text content, and matches quotes to sources using
normalized fuzzy text matching.

If fetching a source URL fails (paywall, 403, etc.), falls back to the
archive.org Wayback Machine. For JavaScript-rendered pages that return
too little content from static fetch, uses Playwright to render the page.

Outputs a text file mapping each quote to its matched source URL.

Usage:
  python3 match_quotes_to_sources.py <target> <sources_file>
  python3 match_quotes_to_sources.py <target> <sources_file> -o output.txt

Examples:
  python3 match_quotes_to_sources.py \\
    demo/substack/heathercoxrichardson.substack.com/p/january-19-2026/ \\
    demo/substack/heathercoxrichardson.substack.com/p/january-19-2026/source_urls.txt
"""

import argparse
import hashlib
import html as html_mod
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


# ---------------------------------------------------------------------------
# CDN / tracking domain exclusion list (used by auto_detect_source_urls)
# ---------------------------------------------------------------------------

CDN_TRACKING_DOMAINS = frozenset([
    "substackcdn.com",
    "substack.com",
    "googleapis.com",
    "googletagmanager.com",
    "google-analytics.com",
    "googleadservices.com",
    "googlesyndication.com",
    "doubleclick.net",
    "gstatic.com",
    "beehiiv.com",
    "cloudflare.com",
    "cloudflareinsights.com",
    "jsdelivr.net",
    "unpkg.com",
    "cdnjs.cloudflare.com",
    "gravatar.com",
    "wp.com",
    "wordpress.com",
    "disqus.com",
    "disquscdn.com",
    "stripe.com",
    "plausible.io",
    "segment.com",
    "intercomcdn.com",
    "givebutter.com",
])

_SMART_QUOTE_CHARS = frozenset("\u201c\u201d\u2018\u2019")
_BARE_URL_RE = re.compile(r"https?://[^\s<>\"']+")

# Anchor inserted by run_inject_citeit — <div id="citeit-urls"> follows it
_CITEIT_FOOTER_COMMENT = "<!-- ################ Begin: CiteIt.net Dependencies"
_CITEIT_URLS_DIV_RE = re.compile(
    r'<div id=["\']citeit-urls["\'][^>]*>(.*?)</div>',
    re.DOTALL | re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Auto-detection of source URLs from HTML
# ---------------------------------------------------------------------------

def _is_cdn_url(parsed_url, article_domain):
    """Return True if URL should be excluded (CDN, tracker, or same domain)."""
    domain = parsed_url.netloc.lower()
    bare_article = article_domain.lower().lstrip("www.")
    bare_domain = domain.lstrip("www.")
    if bare_domain == bare_article:
        return True
    for cdn in CDN_TRACKING_DOMAINS:
        if bare_domain == cdn or bare_domain.endswith("." + cdn):
            return True
    return False


def auto_detect_source_urls(html_file, article_domain):
    """
    Scan html_file for source URLs within <div id="entry">.

    Extracts (in priority order):
      1. <q cite="URL">          — cite attribute
      2. <blockquote cite="URL"> — cite attribute
      3. <a href="URL">          — only when link text contains smart quotes
      4. Bare https?:// URLs     — visible text nodes only (not script/style)

    Filters out CDN/tracking domains and the article's own domain.
    Returns list of (url, label) tuples in discovery order, deduplicated.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("  Warning: beautifulsoup4 not installed; skipping auto-detect.")
        print("  Install with: pip install beautifulsoup4")
        return []

    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()

    soup = BeautifulSoup(html, "html.parser")

    # Use article body only — tightest scope, excludes nav/header/footer noise.
    # Priority: div.body.markup (Substack) → <article> → div#entry → <body>
    container = (
        soup.find("div", class_="body markup")
        or soup.find("article")
        or soup.find("div", id="entry")
        or soup.find("body")
        or soup
    )

    seen = set()
    results = []

    def add(raw_url, label):
        raw_url = raw_url.strip().rstrip(".,;:)\"'")
        if not raw_url or raw_url.startswith("#"):
            return
        try:
            parsed = urlparse(raw_url)
        except Exception:
            return
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            return
        if _is_cdn_url(parsed, article_domain):
            return
        if raw_url not in seen:
            seen.add(raw_url)
            results.append((raw_url, label))

    # 1 & 2: cite attributes on <q> and <blockquote>
    for tag in container.find_all(["q", "blockquote"]):
        cite = tag.get("cite", "").strip()
        if cite:
            add(cite, tag.name + "[cite]")

    # 3: all <a href> directly inside the article body container
    for a in container.find_all("a", href=True):
        text = a.get_text()
        label = (
            "a[href] smart-quoted text"
            if any(c in text for c in _SMART_QUOTE_CHARS)
            else "a[href] inline citation"
        )
        add(a["href"], label)

    # 4: bare URLs in visible text nodes (skip <script> / <style>)
    for text_node in container.find_all(string=True):
        parent_name = getattr(text_node.parent, "name", "")
        if parent_name in ("script", "style"):
            continue
        for raw_url in _BARE_URL_RE.findall(text_node):
            add(raw_url, "bare URL in text")

    return results


def load_source_urls_from_html(html_file):
    """
    Read source URLs from <div id="citeit-urls"> in the HTML file.

    Returns a list of URL strings (one per non-blank, non-comment line).
    Returns an empty list if the div is absent.
    """
    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()

    m = _CITEIT_URLS_DIV_RE.search(html)
    if not m:
        return []

    urls = []
    for line in m.group(1).splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            try:
                parsed = urlparse(line)
                if parsed.scheme in ("http", "https") and parsed.netloc:
                    urls.append(line)
            except Exception:
                pass
    return urls


def write_citeit_urls_div(html_file, detected_urls):
    """
    Insert or update <div id="citeit-urls"> in html_file.

    Location: immediately after the '<!-- #### Begin: CiteIt.net Dependencies'
    comment and before <div id='citeit_container'>.

    On update, merges new URLs with any already present (preserves existing,
    appends new ones with '# auto-detected' comment).
    """
    with open(html_file, "r", encoding="utf-8") as f:
        html = f.read()

    # Collect URLs already in the div (if present)
    existing_match = _CITEIT_URLS_DIV_RE.search(html)
    existing_urls = []
    if existing_match:
        for line in existing_match.group(1).splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                existing_urls.append(line)

    existing_set = set(existing_urls)
    new_urls = [u for u in detected_urls if u not in existing_set]
    all_urls = existing_urls + new_urls

    # Build the div content
    lines = []
    for u in existing_urls:
        lines.append("\t" + u)
    if new_urls:
        lines.append("\t# auto-detected")
        for u in new_urls:
            lines.append("\t" + u)
    inner = "\n".join(lines)
    div_html = f'\t<div id="citeit-urls">\n{inner}\n\t</div>\n'

    if existing_match:
        # Replace the existing div
        html = html[:existing_match.start()] + div_html + html[existing_match.end():]
    else:
        # Insert after the Begin: CiteIt.net Dependencies comment line
        anchor_pos = html.find(_CITEIT_FOOTER_COMMENT)
        if anchor_pos == -1:
            # Fallback: insert just before citeit_container
            anchor = "<div id='citeit_container'>"
            anchor_pos = html.find(anchor)
            if anchor_pos == -1:
                print("  Warning: could not find insertion point for citeit-urls div")
                return
        else:
            # Advance to end of that comment line
            eol = html.find("\n", anchor_pos)
            anchor_pos = eol + 1 if eol != -1 else anchor_pos

        html = html[:anchor_pos] + div_html + html[anchor_pos:]

    with open(html_file, "w", encoding="utf-8") as f:
        f.write(html)

    added = len(new_urls)
    total = len(all_urls)
    print(f"  citeit-urls div: {total} URL(s) total, {added} newly added")


# ---------------------------------------------------------------------------
# Shared utilities (same patterns as apply_cite_urls.py)
# ---------------------------------------------------------------------------

def _find_project_root():
    d = os.path.abspath(os.getcwd())
    for _ in range(10):
        if os.path.isfile(os.path.join(d, ".eleventy.js")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.abspath(os.getcwd())


def resolve_local_path(input_path):
    """Convert a localhost URL or relative path to an absolute file path."""
    path = re.sub(r"^https?://[^/]+/", "", input_path)
    path = path.strip("/")
    project_root = _find_project_root()
    full = os.path.join(project_root, path)
    if os.path.isdir(full):
        full = os.path.join(full, "index.html")
    elif not full.endswith(".html"):
        full = os.path.join(full, "index.html")
    if not os.path.isfile(full):
        print(f"Error: File not found: {full}")
        sys.exit(1)
    return full


def strip_html_tags(s):
    """Remove HTML tags, decode entities, normalize whitespace."""
    s = re.sub(r"<[^>]+>", "", s)
    s = html_mod.unescape(s)
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2014", "--").replace("\u2013", "-")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_for_match(s):
    """Aggressively normalize text for fuzzy matching."""
    s = strip_html_tags(s)
    s = s.lower()
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---------------------------------------------------------------------------
# Quote extraction
# ---------------------------------------------------------------------------

def extract_smart_quotes(html_content, min_words=4):
    """Extract text between Unicode smart quotes from HTML.

    Returns list of dicts with keys: index, raw_html, plain_text, position.
    """
    results = []
    idx = 0
    for m in re.finditer(r"\u201c([^\u201d]+)\u201d", html_content):
        raw = m.group(1)
        plain = strip_html_tags(raw)
        if len(plain.split()) >= min_words:
            results.append({
                "index": idx,
                "raw_html": raw,
                "plain_text": plain,
                "position": m.start(),
            })
            idx += 1
    return results


# ---------------------------------------------------------------------------
# Source URL loading
# ---------------------------------------------------------------------------

def load_source_urls(file_path):
    """Read source URLs from a text file, one per line.

    Skips blank lines and lines starting with '#'.
    """
    urls = []
    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)
    return urls


# ---------------------------------------------------------------------------
# Fetching with Wayback Machine fallback
# ---------------------------------------------------------------------------

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"


def fetch_url(url, timeout=30):
    """Fetch content from a URL. Returns (data_bytes, content_type) or (None, None)."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read()
            return data, content_type
    except (urllib.error.HTTPError, urllib.error.URLError, OSError) as e:
        print(f"    Fetch failed: {e}")
        return None, None


def fetch_wayback_url(url):
    """Query the Wayback Machine for an archived snapshot.

    Returns the archived snapshot URL, or None.
    """
    api_url = f"https://archive.org/wayback/available?url={urllib.request.quote(url, safe='')}"
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        snapshot = data.get("archived_snapshots", {}).get("closest", {})
        if snapshot.get("available"):
            return snapshot["url"]
    except Exception as e:
        print(f"    Wayback API error: {e}")
    return None


def render_with_playwright(url, timeout=30000):
    """Render a page using Playwright to get its visible text.

    Returns the rendered page text, or None on failure.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("    Playwright not installed, skipping JS rendering")
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url, timeout=timeout)
            page.wait_for_load_state("networkidle", timeout=15000)
            text = page.inner_text("body")
            browser.close()
            return text
    except Exception as e:
        print(f"    Playwright render failed: {e}")
        return None


def fetch_source_text(url, cache_dir):
    """Fetch a source URL and extract its plain text content.

    Always uses Playwright to render pages for accurate text extraction.
    Falls back to static HTML extraction if Playwright fails.
    Tries Wayback Machine if the original URL is unreachable.
    Caches rendered text to avoid re-downloading on subsequent runs.
    Returns (plain_text, fetched_url) or (None, None).
    """
    # Check if it's a PDF — skip
    if url.lower().endswith(".pdf"):
        print("    Skipping PDF source")
        return None, None

    # Check cache
    os.makedirs(cache_dir, exist_ok=True)
    cache_key = hashlib.md5(url.encode()).hexdigest()[:12]
    rendered_cache = os.path.join(cache_dir, f"{cache_key}.rendered.txt")

    # Check rendered text cache (from a previous Playwright run)
    if os.path.isfile(rendered_cache) and os.path.getsize(rendered_cache) > 0:
        with open(rendered_cache, "r", encoding="utf-8", errors="replace") as f:
            return f.read(), url

    # Try Playwright rendering (preferred — handles JS-rendered pages)
    print("    Rendering with Playwright...")
    rendered = render_with_playwright(url)
    if rendered and len(rendered.strip()) > 100:
        with open(rendered_cache, "w", encoding="utf-8") as f:
            f.write(rendered)
        return rendered, url

    # Playwright failed or returned too little — try static fetch
    print("    Playwright insufficient, trying static fetch...")
    fetched_url = url
    data, content_type = fetch_url(url)

    # If direct fetch failed, try Wayback Machine
    if data is None:
        print("    Trying Wayback Machine...")
        wb_url = fetch_wayback_url(url)
        if wb_url:
            print(f"    Found archive: {wb_url[:80]}")
            # Try Playwright on the Wayback URL too
            rendered = render_with_playwright(wb_url)
            if rendered and len(rendered.strip()) > 100:
                with open(rendered_cache, "w", encoding="utf-8") as f:
                    f.write(rendered)
                return rendered, wb_url
            data, content_type = fetch_url(wb_url)
            fetched_url = wb_url

    if data is None:
        return None, None

    # Check if response is PDF
    if content_type and "pdf" in content_type.lower():
        print("    Skipping PDF response")
        return None, None

    # Decode HTML and extract text as fallback
    charset = "utf-8"
    ct_match = re.search(r"charset=([^\s;]+)", content_type or "")
    if ct_match:
        charset = ct_match.group(1)
    try:
        html_content = data.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        html_content = data.decode("utf-8", errors="replace")

    text = extract_article_text(html_content)
    if text and len(text.strip()) > 100:
        # Cache the static extraction as rendered text
        with open(rendered_cache, "w", encoding="utf-8") as f:
            f.write(text)
    return text, fetched_url


def extract_article_text(html_content):
    """Extract article body text from HTML.

    Tries <article>, <main>, <div class="body markup">, then <body>.
    """
    # Try progressively broader selectors
    for pattern in [
        r"<article[^>]*>(.*?)</article>",
        r'<div[^>]*class="body markup"[^>]*>(.*?)</div>',
        r"<main[^>]*>(.*?)</main>",
        r"<body[^>]*>(.*?)</body>",
    ]:
        m = re.search(pattern, html_content, re.DOTALL | re.IGNORECASE)
        if m:
            return strip_html_tags(m.group(1))

    # Fallback: full HTML
    return strip_html_tags(html_content)


# ---------------------------------------------------------------------------
# Matching algorithm
# ---------------------------------------------------------------------------

def match_quote_to_sources(quote_text, source_texts, threshold=0.7):
    """Find the best matching source for a quote.

    Args:
        quote_text: Plain text of the quote.
        source_texts: Dict of {url: plain_text_content}.
        threshold: Minimum word-overlap ratio to accept.

    Returns (best_url, score, method) or (None, 0.0, "none").
    """
    norm_quote = normalize_for_match(quote_text)
    quote_words = norm_quote.split()

    if not quote_words:
        return None, 0.0, "none"

    best_url = None
    best_score = 0.0
    best_method = "none"

    for url, source_text in source_texts.items():
        norm_source = normalize_for_match(source_text)

        if not norm_source:
            continue

        # Tier 1: Exact normalized substring
        if norm_quote in norm_source:
            if best_score < 1.0:
                best_url = url
                best_score = 1.0
                best_method = "normalized_substring"
            continue

        # Tier 2: Partial substring (first 60% of words)
        if len(quote_words) > 6:
            partial = " ".join(quote_words[: int(len(quote_words) * 0.6)])
            if partial in norm_source:
                if best_score < 0.9:
                    best_url = url
                    best_score = 0.9
                    best_method = "partial_substring"
                continue

        # Tier 3: Word-overlap ratio
        if len(quote_words) >= 3:
            match_count = sum(1 for w in quote_words if w in norm_source)
            ratio = match_count / len(quote_words)
            if ratio >= threshold and ratio > best_score:
                best_url = url
                best_score = ratio
                best_method = "word_overlap"

    return best_url, best_score, best_method


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_output(matches, output_path, quotes):
    """Write the quote-to-source matches to a text file."""
    with open(output_path, "w", encoding="utf-8") as f:
        for q_idx, source_url, score, method in matches:
            q = quotes[q_idx]
            # Truncated display
            display = q["plain_text"]
            if len(display) > 80:
                display = display[:77] + "..."
            f.write(f'QUOTE[{q_idx}]: "{display}"\n')
            f.write(f'FULL_QUOTE: {q["plain_text"]}\n')
            f.write(f"SOURCE: {source_url or 'UNMATCHED'}\n")
            f.write(f"MATCH_SCORE: {score:.2f}\n")
            f.write(f"MATCH_METHOD: {method}\n")
            f.write("\n")
    print(f"\nOutput written to: {output_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Match quoted text in a target page to source URLs."
    )
    parser.add_argument(
        "target",
        help="Target HTML page (file path or localhost URL)",
    )
    parser.add_argument(
        "sources",
        help="Text file with source URLs, one per line",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output file path (default: <target_dir>/quote_matches.txt)",
    )
    parser.add_argument(
        "--min-quote-words",
        type=int,
        default=4,
        help="Minimum number of words for a quote to be matched (default: 4)",
    )
    parser.add_argument(
        "--match-threshold",
        type=float,
        default=0.7,
        help="Word-overlap ratio threshold for fuzzy matching (default: 0.7)",
    )
    args = parser.parse_args()

    # Resolve target path
    target_path = resolve_local_path(args.target)
    project_root = _find_project_root()
    target_dir = os.path.dirname(target_path)

    print(f"Target: {os.path.relpath(target_path, project_root)}")

    # Read target HTML
    with open(target_path, "r", encoding="utf-8") as f:
        target_html = f.read()

    # Extract smart-quoted passages
    print("\n1. Extracting quoted passages...")
    quotes = extract_smart_quotes(target_html, min_words=args.min_quote_words)
    print(f"   Found {len(quotes)} quotes (>= {args.min_quote_words} words)")
    for q in quotes:
        display = q["plain_text"][:70]
        print(f"   [{q['index']}] {display}...")

    # Load source URLs
    sources_file = args.sources
    if not os.path.isabs(sources_file):
        sources_file = os.path.join(project_root, sources_file)
    source_urls = load_source_urls(sources_file)
    print(f"\n2. Loaded {len(source_urls)} source URLs")

    # Fetch all source texts
    print("\n3. Fetching source pages...")
    cache_dir = os.path.join(target_dir, ".source_cache")
    source_texts = {}
    for i, url in enumerate(source_urls, 1):
        print(f"\n  [{i}/{len(source_urls)}] {url[:80]}")
        text, fetched_url = fetch_source_text(url, cache_dir)
        if text:
            source_texts[url] = text
            if fetched_url and fetched_url != url:
                print(f"    (via: {fetched_url[:80]})")
            print(f"    OK: {len(text):,} chars extracted")
        else:
            print("    FAILED: could not fetch or extract text")
        time.sleep(1)  # rate limit

    print(f"\n   Successfully fetched {len(source_texts)}/{len(source_urls)} sources")

    # Match quotes to sources
    print(f"\n4. Matching {len(quotes)} quotes against {len(source_texts)} sources...")
    matches = []
    matched_count = 0
    for q in quotes:
        best_url, score, method = match_quote_to_sources(
            q["plain_text"], source_texts, args.match_threshold
        )
        matches.append((q["index"], best_url, score, method))
        display = q["plain_text"][:50]
        if best_url:
            matched_count += 1
            print(f"   [{q['index']}] MATCH (score={score:.2f}, {method})")
            print(f"       Quote: {display}...")
            print(f"       Source: {best_url[:70]}")
        else:
            print(f"   [{q['index']}] UNMATCHED: {display}...")

    # Write output
    output_path = args.output
    if output_path is None:
        output_path = os.path.join(target_dir, "quote_matches.txt")
    elif not os.path.isabs(output_path):
        output_path = os.path.join(project_root, output_path)

    print(f"\n5. Writing output...")
    write_output(matches, output_path, quotes)

    print(f"\nDone! {matched_count}/{len(matches)} quotes matched.")
    print(f"Output: {os.path.relpath(output_path, project_root)}")


if __name__ == "__main__":
    main()
