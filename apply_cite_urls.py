#!/usr/bin/env python3
"""
Apply cite URLs from an original CiteIt-annotated HTML page to a new page.

Reads <q cite="URL"> and <blockquote cite="URL"> tags from the original
(source) page, matches them to the corresponding quotes in the new (target)
page by text similarity, and adds the cite attributes.

For <q cite> tags whose text appears inline (not wrapped in <q>) in the
target, the script wraps the matching text in <q cite="URL">...</q>.

The source can be a remote URL (https://), a localhost URL, or a local file path.
The target must be a local file path or localhost URL.

Usage:
  python3 apply_cite_urls.py <source> <target>

Examples:
  python3 apply_cite_urls.py \
    https://www.citeit.net/demo/substack/kenklippenstein.com/p/biden-takes-swipe-at-campus-protesters-snubbing-youth-support/ \
    http://localhost:8080/demo/substack/www.kenklippenstein.com/p/biden-takes-swipe-at-campus-protesters-snubbing-youth-support/

  python3 apply_cite_urls.py \
    demo/substack/www.columnblog.com/p/washington-post-continues-to-lie/index-old-previous.html \
    demo/substack/www.columnblog.com/p/washington-post-continues-to-lie/index.html
"""

import html
import os
import re
import sys
import unicodedata
import urllib.request


def is_remote_url(input_path):
    """Check if input is a remote (non-localhost) URL."""
    if not re.match(r"https?://", input_path):
        return False
    # localhost URLs are treated as local file paths
    if re.match(r"https?://localhost", input_path):
        return False
    if re.match(r"https?://127\.0\.0\.1", input_path):
        return False
    return True


def fetch_remote_html(url):
    """Fetch HTML content from a remote URL."""
    print(f"  Fetching: {url}")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            return resp.read().decode(charset)
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        sys.exit(1)


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


def strip_html_tags(s):
    """Remove HTML tags, decode entities, normalize whitespace."""
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    # Normalize unicode quotes and dashes
    s = s.replace("\u2018", "'").replace("\u2019", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2014", "--").replace("\u2013", "-")
    # Normalize whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def normalize_for_match(s):
    """Aggressively normalize text for fuzzy matching."""
    s = strip_html_tags(s)
    s = s.lower()
    # Remove all punctuation for matching
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def extract_cite_tags(source_html):
    """Extract all <q cite="URL"> and <blockquote cite="URL"> from source.

    Returns list of (tag_type, cite_url, inner_html, plain_text).
    """
    results = []

    # Match <blockquote cite="URL">...</blockquote>
    for m in re.finditer(
        r'<blockquote\s+cite="([^"]+)">(.*?)</blockquote>',
        source_html,
        re.DOTALL,
    ):
        cite_url = m.group(1)
        inner = m.group(2)
        text = strip_html_tags(inner)
        if text:
            results.append(("blockquote", cite_url, inner, text))

    # Match <q cite="URL">...</q>
    for m in re.finditer(
        r'<q\s+cite="([^"]+)">(.*?)</q>',
        source_html,
        re.DOTALL,
    ):
        cite_url = m.group(1)
        inner = m.group(2)
        text = strip_html_tags(inner)
        if text:
            results.append(("q", cite_url, inner, text))

    return results


def find_best_match_substring(target_text, search_text, min_length=30):
    """Find the search_text within target_text using normalized matching.

    Returns (start, end) positions in target_text, or None.
    """
    norm_target = normalize_for_match(target_text)
    norm_search = normalize_for_match(search_text)

    if not norm_search or len(norm_search) < 10:
        return None

    # Try exact normalized match
    pos = norm_target.find(norm_search)
    if pos != -1:
        return True

    # Try with a shorter substring (first 60% of words)
    words = norm_search.split()
    if len(words) > 6:
        partial = " ".join(words[: int(len(words) * 0.6)])
        if partial in norm_target:
            return True

    return None


def apply_blockquote_cite(target_html, cite_url, source_text):
    """Add cite attribute to a matching <blockquote> in target_html.

    Matches by comparing the text content of each <blockquote> in the target.
    """
    norm_source = normalize_for_match(source_text)

    # Find all <blockquote> tags without cite attribute
    pattern = r"<blockquote(?:\s[^>]*)?>.*?</blockquote>"
    for m in re.finditer(pattern, target_html, re.DOTALL):
        block_html = m.group(0)
        block_text = strip_html_tags(block_html)
        norm_block = normalize_for_match(block_text)

        # Check for substantial overlap
        if not norm_source or not norm_block:
            continue

        # Use the shorter text to check containment
        shorter = min(norm_source, norm_block, key=len)
        longer = max(norm_source, norm_block, key=len)

        # Require at least 50% of the shorter text to be in the longer
        words_short = shorter.split()
        if len(words_short) < 3:
            continue

        match_words = sum(1 for w in words_short if w in longer)
        ratio = match_words / len(words_short)

        if ratio > 0.7:
            # Already has cite?
            if 'cite="' in block_html[:50]:
                print(f"    Already has cite: {cite_url[:60]}")
                return target_html

            # Add cite attribute
            new_tag = block_html.replace("<blockquote", f'<blockquote cite="{cite_url}"', 1)
            target_html = target_html.replace(block_html, new_tag, 1)
            print(f"    Added cite to <blockquote>: {cite_url[:70]}")
            return target_html

    print(f"    No matching <blockquote> found for: {source_text[:60]}...")
    return target_html


def apply_q_cite(target_html, cite_url, source_text):
    """Wrap matching inline text in the target with <q cite="URL">...</q>.

    Searches for the source quote text appearing inline in the target.
    """
    # First check if there's already a <q> tag with this text
    existing_q = re.finditer(r"<q[^>]*>.*?</q>", target_html, re.DOTALL)
    for m in existing_q:
        q_text = normalize_for_match(strip_html_tags(m.group(0)))
        if normalize_for_match(source_text) in q_text or q_text in normalize_for_match(source_text):
            if 'cite="' in m.group(0):
                print(f"    Already has <q cite>: {cite_url[:60]}")
                return target_html
            # Add cite to existing <q>
            new_q = m.group(0).replace("<q", f'<q cite="{cite_url}"', 1)
            target_html = target_html.replace(m.group(0), new_q, 1)
            print(f"    Added cite to existing <q>: {cite_url[:70]}")
            return target_html

    # Search for the plain text in the target and wrap it
    search_text = strip_html_tags(source_text)

    words = search_text.split()
    if len(words) < 3:
        print(f"    Quote too short to match: {source_text[:60]}")
        return target_html

    # Build a flexible regex pattern from words, allowing HTML tags,
    # whitespace, and smart-quote variants between words.
    # Try progressively shorter snippets until a match is found.
    # Min length: 5 words or 25% of total, whichever is smaller.
    min_words = max(3, min(5, len(words) // 4))

    for start_idx in range(min(3, len(words))):
        for length in range(len(words) - start_idx, min_words - 1, -1):
            snippet_words = words[start_idx : start_idx + length]

            # Escape each word for regex, then replace ASCII quotes/dashes
            # with character classes that match both ASCII and Unicode variants
            escaped_words = []
            for w in snippet_words:
                ew = re.escape(w)
                # Allow smart quote variants: ' matches ' \u2018 \u2019
                ew = ew.replace(re.escape("'"), "['\u2018\u2019\u2032]")
                # Allow smart double quotes: " matches " \u201c \u201d
                ew = ew.replace(re.escape('"'), '["\u201c\u201d\u2033]')
                # Allow em-dash variants: -- matches -- \u2014
                ew = ew.replace(re.escape("--"), "(?:--|[\u2014])")
                # Allow en-dash: - can also be \u2013
                # (only for standalone dashes, not hyphens in words)
                escaped_words.append(ew)

            # Allow HTML tags, entities, and whitespace between words
            flex_pattern = r"(?:<[^>]*>|&[^;]+;|\s)+".join(escaped_words)

            try:
                match = re.search(flex_pattern, target_html)
            except re.error:
                continue

            if match:
                matched_text = match.group(0)
                # Don't wrap if already inside a <q> tag
                before = target_html[max(0, match.start() - 300) : match.start()]
                if "<q " in before and "</q>" not in before:
                    continue
                # Don't wrap if already inside a <blockquote> tag
                # (the quote might belong to a blockquote cite instead)

                # Wrap the matched text
                replacement = f'<q cite="{cite_url}">{matched_text}</q>'
                target_html = (
                    target_html[: match.start()]
                    + replacement
                    + target_html[match.end() :]
                )
                print(f"    Wrapped inline text with <q cite>: {cite_url[:70]}")
                return target_html

    print(f"    No inline match found for <q>: {source_text[:60]}...")
    return target_html


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 apply_cite_urls.py <source> <target>")
        print("  source: URL or file path to the page with cite attributes")
        print("          (supports https:// remote URLs, localhost URLs, or file paths)")
        print("  target: localhost URL or file path to the page to update")
        sys.exit(1)

    source_input = sys.argv[1]
    target_path = resolve_local_path(sys.argv[2])
    project_root = _find_project_root()

    # Read source: from remote URL or local file
    if is_remote_url(source_input):
        print(f"Source (remote): {source_input}")
        source_html = fetch_remote_html(source_input)
    else:
        source_path = resolve_local_path(source_input)
        print(f"Source (with cites): {os.path.relpath(source_path, project_root)}")
        with open(source_path, "r", encoding="utf-8") as f:
            source_html = f.read()

    print(f"Target (to update):  {os.path.relpath(target_path, project_root)}")

    with open(target_path, "r", encoding="utf-8") as f:
        target_html = f.read()

    # Extract cite tags from source
    print("\nExtracting cite tags from source...")
    cite_tags = extract_cite_tags(source_html)
    print(f"  Found {len(cite_tags)} tags with cite attributes")

    if not cite_tags:
        print("  No cite tags found. Exiting.")
        return

    # Apply each cite to the target
    print("\nApplying cite attributes to target...")
    for tag_type, cite_url, inner_html, plain_text in cite_tags:
        print(f"\n  [{tag_type}] {plain_text[:50]}...")
        if tag_type == "blockquote":
            target_html = apply_blockquote_cite(target_html, cite_url, plain_text)
        elif tag_type == "q":
            target_html = apply_q_cite(target_html, cite_url, plain_text)

    # Write updated target
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(target_html)

    print(f"\nDone! Updated: {os.path.relpath(target_path, project_root)}")


if __name__ == "__main__":
    main()
