#!/usr/bin/env python3
"""
Apply <q cite="URL"> tags to a target HTML page using a quote_matches.txt file.

Reads the quote-to-source mappings produced by match_quotes_to_sources.py
and wraps each quoted passage in the target HTML with <q cite="URL">...</q>.

Quotes in the target are delimited by Unicode smart quotes. The script
finds each smart-quoted passage and wraps it (including the surrounding
smart quotes) with a <q cite> tag.

Usage:
  python3 apply_quote_matches.py <target> [matches_file]

  target:       Local file path or localhost URL to the HTML page
  matches_file: Path to quote_matches.txt (default: <target_dir>/quote_matches.txt)

Examples:
  python3 apply_quote_matches.py \\
    demo/substack/heathercoxrichardson.substack.com/p/january-19-2026/

  python3 apply_quote_matches.py \\
    http://localhost:8080/demo/substack/heathercoxrichardson.substack.com/p/january-19-2026/
"""

import html as html_mod
import os
import re
import sys


# ---------------------------------------------------------------------------
# Shared utilities (same as apply_cite_urls.py)
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
# Parse quote_matches.txt
# ---------------------------------------------------------------------------

def parse_matches_file(matches_path):
    """Parse a quote_matches.txt file into a list of (quote_text, source_url) tuples.

    Skips entries where SOURCE is UNMATCHED.
    """
    matches = []
    current_quote = None
    current_source = None

    with open(matches_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")

            if line.startswith("FULL_QUOTE: "):
                current_quote = line[len("FULL_QUOTE: "):]

            elif line.startswith("SOURCE: "):
                current_source = line[len("SOURCE: "):]
                if current_source == "UNMATCHED":
                    current_source = None

            elif line.startswith("MATCH_METHOD: "):
                # End of entry — save if we have both quote and source
                if current_quote and current_source:
                    matches.append((current_quote, current_source))
                current_quote = None
                current_source = None

    return matches


# ---------------------------------------------------------------------------
# Apply <q cite> tags
# ---------------------------------------------------------------------------

def apply_q_cite(target_html, cite_url, quote_text):
    """Wrap a smart-quoted passage in the target HTML with <q cite="URL">.

    Finds the quote text between smart quotes in the HTML and wraps the
    entire passage (including the smart quotes) with <q cite="URL">...</q>.
    """
    # Check if already wrapped in <q cite>
    norm_quote = normalize_for_match(quote_text)
    existing_q = re.finditer(r"<q[^>]*>.*?</q>", target_html, re.DOTALL)
    for m in existing_q:
        q_text = normalize_for_match(m.group(0))
        if norm_quote in q_text or q_text in norm_quote:
            if 'cite="' in m.group(0):
                print(f"    Already has <q cite>: {cite_url[:60]}")
                return target_html
            # Add cite to existing <q>
            new_q = m.group(0).replace("<q", f'<q cite="{cite_url}"', 1)
            target_html = target_html.replace(m.group(0), new_q, 1)
            print(f"    Added cite to existing <q>: {cite_url[:70]}")
            return target_html

    # Build a flexible regex to find the quote text between smart quotes.
    # The quote text has been normalized (smart quotes → ASCII) so we need
    # to match the original smart-quoted version in the HTML.
    words = quote_text.split()
    if len(words) < 3:
        print(f"    Quote too short to match: {quote_text[:60]}")
        return target_html

    # Try progressively shorter snippets
    min_words = max(3, min(5, len(words) // 4))

    for start_idx in range(min(3, len(words))):
        for length in range(len(words) - start_idx, min_words - 1, -1):
            snippet_words = words[start_idx: start_idx + length]

            # Escape each word for regex with smart-quote variants
            escaped_words = []
            for w in snippet_words:
                ew = re.escape(w)
                ew = ew.replace(re.escape("'"), "['\\u2018\\u2019\\u2032']")
                ew = ew.replace(re.escape('"'), '[\"\\u201c\\u201d\\u2033]')
                ew = ew.replace(re.escape("--"), "(?:--|[\\u2014])")
                escaped_words.append(ew)

            # Allow HTML tags, entities, and whitespace between words
            flex_pattern = r"(?:<[^>]*>|&[^;]+;|\s)+".join(escaped_words)

            # Wrap pattern to capture surrounding smart quotes if present
            # Look for opening smart quote before and closing after
            # Group 1: opening smart quote (and any tags/whitespace after it)
            # Group 2: closing punctuation + smart quote
            full_pattern = (
                r'(\u201c\s*(?:<[^>]*>\s*)*)'
                + flex_pattern
                + r'(\s*(?:<[^>]*>\s*)*[.!?,;:\u2026]*\s*\u201d)'
            )

            try:
                match = re.search(full_pattern, target_html)
            except re.error:
                # Fall back to matching without the smart quotes
                try:
                    match = re.search(flex_pattern, target_html)
                except re.error:
                    continue

                if not match:
                    continue

            if match:
                # Don't wrap if already inside a <q> tag
                before = target_html[max(0, match.start() - 300): match.start()]
                if "<q " in before and "</q>" not in before:
                    continue

                matched_text = match.group(0)

                # Position quotation marks OUTSIDE the <q cite> tag:
                #   \u201c<q cite="URL">inner text</q>\u201d
                if match.lastindex and match.lastindex >= 2:
                    # full_pattern matched — extract inner text (without quotes)
                    open_quote = match.group(1)   # e.g. \u201c
                    close_quote = match.group(2)  # e.g. .\u201d
                    inner_start = match.start() + len(open_quote)
                    inner_end = match.end() - len(close_quote)
                    inner_text = target_html[inner_start:inner_end]
                    replacement = f'{open_quote}<q cite="{cite_url}">{inner_text}</q>{close_quote}'
                else:
                    # flex_pattern matched (no surrounding quotes found)
                    replacement = f'<q cite="{cite_url}">{matched_text}</q>'

                target_html = (
                    target_html[: match.start()]
                    + replacement
                    + target_html[match.end():]
                )
                print(f"    Wrapped with <q cite>: {cite_url[:70]}")
                return target_html

    print(f"    No match found for: {quote_text[:60]}...")
    return target_html


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 apply_quote_matches.py <target> [matches_file]")
        print("  target:       file path or localhost URL to the HTML page")
        print("  matches_file: path to quote_matches.txt (default: <target_dir>/quote_matches.txt)")
        sys.exit(1)

    target_path = resolve_local_path(sys.argv[1])
    project_root = _find_project_root()
    target_dir = os.path.dirname(target_path)

    # Determine matches file path
    if len(sys.argv) >= 3:
        matches_path = sys.argv[2]
        if not os.path.isabs(matches_path):
            matches_path = os.path.join(project_root, matches_path)
    else:
        matches_path = os.path.join(target_dir, "quote_matches.txt")

    if not os.path.isfile(matches_path):
        print(f"Error: Matches file not found: {matches_path}")
        print("  Run match_quotes_to_sources.py first to generate it.")
        sys.exit(1)

    print(f"Target: {os.path.relpath(target_path, project_root)}")
    print(f"Matches: {os.path.relpath(matches_path, project_root)}")

    # Read target HTML
    with open(target_path, "r", encoding="utf-8") as f:
        target_html = f.read()

    # Parse matches
    matches = parse_matches_file(matches_path)
    print(f"\nFound {len(matches)} quote-to-source mappings")

    if not matches:
        print("No matches to apply. Exiting.")
        return

    # Apply each match
    print("\nApplying <q cite> tags...\n")
    applied = 0
    for quote_text, source_url in matches:
        display = quote_text[:50] + "..." if len(quote_text) > 50 else quote_text
        print(f"  [{applied}] {display}")
        original = target_html
        target_html = apply_q_cite(target_html, source_url, quote_text)
        if target_html != original:
            applied += 1

    # Write updated target
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(target_html)

    print(f"\nDone! Applied {applied}/{len(matches)} <q cite> tags.")
    print(f"Updated: {os.path.relpath(target_path, project_root)}")


if __name__ == "__main__":
    main()
