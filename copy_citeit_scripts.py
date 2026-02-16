#!/usr/bin/env python3
"""
Insert CiteIt code blocks into a target HTML file.

The CiteIt blocks are stored within this script, so no source file is
needed. The Header Notice breadcrumb is auto-generated from the target
file path.

Inserts four sections:
  1. CiteIt Style       -> before </head>
  2. CiteIt Dependencies -> before </head>  (jQuery, sha256, etc.)
  3. CiteIt Header Notice -> inside <div class="body markup">, after hero
  4. CiteIt Footer Deps  -> before </body>

Usage:
  python3 copy_citeit_scripts.py <target_html>
  python3 copy_citeit_scripts.py http://localhost:8080/demo/substack/site.com/p/article/

Examples:
  python3 copy_citeit_scripts.py demo/substack/www.columnblog.com/p/washington-post-continues-to-lie/index.html
  python3 copy_citeit_scripts.py http://localhost:8080/demo/substack/www.kenklippenstein.com/p/jd-vance-on-war-and-peace/
"""

import os
import re
import sys


# ---------------------------------------------------------------------------
# Embedded CiteIt code blocks
# ---------------------------------------------------------------------------

CITEIT_STYLE = """\
<!--***************** Begin CiteIt Style *****************-->
        <style>
            .breadcrumbs {
                margin: 25px 0 30px 0;
                color: #777;
                font-size: 88%;
            }
            .nav-links {
                font-size: 90%;
            }

            a {
                white-space: wrap;
            }


        </style>
        <!--***************** End CiteIt Style *******************-->"""

CITEIT_HEAD_DEPS = """\
<!-- ############################### Begin: CiteIt Dependencies ##################################
      - jQuery: manipulate Dom:
      - query api.CiteIt.net
      - download JSON to hidden citeit_container div
      - add arrows and popup links to q tags and blockquotes

  ------ 1) jQuery -->
  <script src="https://code.jquery.com/jquery-1.12.4.min.js"
\tintegrity="sha256-ZosEbRLbNQzLpnKIkEdrPv7lOy9C27hHQ+Xp8a4MxAQ="
\tcrossorigin="anonymous">
  </script>

  <!-- 2) jQuery Migrate: Used to migrate jQuery: https://github.com/jquery/jquery-migrate -->
  <script src="https://code.jquery.com/jquery-migrate-1.4.1.min.js"
\tintegrity="sha256-SOuLUArmo4YXtXONKz+uxIGSKneCJG4x0nVcA0pFzV0="
\tcrossorigin="anonymous">
  </script>

  <!-- 3) Generate q-tag Popup -->
  <script
\tsrc="https://code.jquery.com/ui/1.12.1/jquery-ui.min.js"
\tintegrity="sha256-VazP97ZCwtekAsvgPBSUwPFKdrwD3unUfSGVYrahUqU="
\tcrossorigin="anonymous">
  </script>

  <!-- 4) Calculate JSON Hash values using sha256 library --->
  <script src='/assets/wordpress/plugins/CiteIt.net/lib/forge-sha256/forge/forge-sha256.min.js' defer></script>

  <!-- 5) jsVideoUrlParser: Detect Domain: Determine if an Embed code can be use: YouTube, Vimeo, Soundcloud -->
  <script src='/assets/wordpress/plugins/CiteIt.net/lib/jsVideoUrlParser/dist/jsVideoUrlParser.min.js' defer></script>

  <!--CSS Styles: CiteIt & JQuery Popup Window -->
  <link rel='stylesheet' href='/assets/wordpress/plugins/CiteIt.net/lib/jquery-ui-1.12.1/jquery-ui.min.css' type='text/css' media='all' />
  <link rel='stylesheet' href='/assets/wordpress/plugins/CiteIt.net/css/CiteIt-library.css' type='text/css' media='all' />

  <link rel='stylesheet' href='/assets/css/citeit-wikipedia.css' type='text/css' media='all' />

  <!-- 6) Main CiteIt Javascript Code: Download JSON & Create Popup windows and Expanding Arrows  -->
  <script src='/assets/js/citeit/CiteIt-quote-context.js'> </script>

  <!-- ############################### End: CiteIt.net Dependencies #######################################-->"""

# Template for the Header Notice. {site_name} and {site_breadcrumb_url}
# are replaced with values derived from the target file path.
CITEIT_HEADER_NOTICE_TEMPLATE = """\
<!--*************** Begin: CiteIt Header Notice *****************-->

\t                <div class="highlight" style="text-align:center">
\t                <h3>This is a Mockup of Substack using <a href="https://www.citeit.net/">CiteIt.net</a>.</h3>
\t                <div class="nav-links">
\t                    <a href="/">CiteIt.net home</a> |
\t                    <a href="https://demo.citeit.net/">Demo</a> |
\t                    <a href="/#journalism">Substack Samples</a>
\t                    <br /><br />
\t                </div>
\t                </div>

\t                <div class="breadcrumbs"><a href="/">CiteIt</a> &gt; <a href="/demo/">Demo</a> &gt; <a href="/demo/substack/">Substack</a> &gt;
                        <a href="/demo/substack/{site_breadcrumb_url}/">{site_name}</a></div>
\t                <!--start-->
\t                <br />
\t            <!--*************** End: CiteIt Header Notice *****************-->"""

CITEIT_FOOTER_DEPS = """\
<!-- ################ Begin: CiteIt.net Dependencies ############# -->
  <div id='citeit_container'><!-- CiteIt-quote-context.js injects data returned from lookup in this hidden div --></div>
  <script>
\t// Call CiteIt.net plugin on all q-tags and blockquotes:
\t$( document ).ready(function() {
\t\tjQuery('q, blockquote').quoteContext2();
\t});

  </script>
<!-- ############### End: CiteIt.net Dependencies ############## -->"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def resolve_path(input_path):
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
    """Walk up from cwd to find .eleventy.js."""
    d = os.path.abspath(os.getcwd())
    for _ in range(10):
        if os.path.isfile(os.path.join(d, ".eleventy.js")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.abspath(os.getcwd())


def derive_site_info(target_path, project_root):
    """Derive the site name and breadcrumb URL from the target file path.

    For a path like demo/substack/www.columnblog.com/p/article/index.html,
    returns ("www.columnblog.com", "www.columnblog.com").
    """
    rel = os.path.relpath(target_path, project_root)
    # Expected: demo/substack/<site>/p/<article>/index.html
    parts = rel.replace("\\", "/").split("/")
    # Find the site part (after demo/substack/)
    try:
        substack_idx = parts.index("substack")
        site = parts[substack_idx + 1]
    except (ValueError, IndexError):
        site = "Substack"
    return site, site


def build_header_notice(target_path, project_root):
    """Build the Header Notice block with page-specific breadcrumbs."""
    site_name, site_url = derive_site_info(target_path, project_root)
    return CITEIT_HEADER_NOTICE_TEMPLATE.format(
        site_name=site_name,
        site_breadcrumb_url=site_url,
    )


# ---------------------------------------------------------------------------
# Injection logic
# ---------------------------------------------------------------------------

def inject_into_target(target_html, header_notice):
    """Inject all CiteIt blocks into the target HTML."""
    modified = target_html

    # 1. Insert Style + Head Dependencies before </head>
    head_content = f"\n{CITEIT_STYLE}\n\n{CITEIT_HEAD_DEPS}\n"
    modified = modified.replace("</head>", f"{head_content}\n    </head>", 1)
    print("  Inserted: CiteIt Style")
    print("  Inserted: CiteIt Dependencies (head)")

    # 2. Insert Header Notice inside <div class="body markup">,
    #    after the first child element (hero image/figure or video embed).
    inserted = False
    body_markup_match = re.search(
        r'<div[^>]*class="body markup"[^>]*>', modified
    )
    if body_markup_match:
        search_start = body_markup_match.end()
        # Try: after first </figure> (hero image)
        figure_end = modified.find("</figure>", search_start)
        # Try: after first youtube-wrap closing </div></div>
        youtube_match = re.search(
            r'class="youtube-wrap".*?</div>\s*</div>',
            modified[search_start:],
            re.DOTALL,
        )

        insert_pos = None
        if figure_end != -1:
            after_figure = modified.find("</div>", figure_end + len("</figure>"))
            if after_figure != -1:
                insert_pos = after_figure + len("</div>")
        if youtube_match and (
            insert_pos is None
            or search_start + youtube_match.end() < insert_pos
        ):
            insert_pos = search_start + youtube_match.end()

        if insert_pos is not None:
            modified = (
                modified[:insert_pos]
                + f"\n\n{header_notice}\n"
                + modified[insert_pos:]
            )
            inserted = True
            print("  Inserted: CiteIt Header Notice (after hero element)")

    if not inserted:
        entry_match = re.search(r'(<div id="entry">)', modified)
        if entry_match:
            pos = entry_match.end()
            modified = (
                modified[:pos] + f"\n{header_notice}\n" + modified[pos:]
            )
            print("  Inserted: CiteIt Header Notice (fallback: after #entry)")
        else:
            print("  WARNING: Could not find insertion point for Header Notice")

    # 3. Insert Footer Dependencies before </body>
    modified = modified.replace(
        "</body>", f"\n{CITEIT_FOOTER_DEPS}\n\n    </body>", 1
    )
    print("  Inserted: CiteIt Dependencies (footer)")

    return modified


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 copy_citeit_scripts.py <target>")
        print("  target can be a file path or localhost URL")
        sys.exit(1)

    target_path = resolve_path(sys.argv[1])
    project_root = _find_project_root()

    print(f"Target: {os.path.relpath(target_path, project_root)}")

    with open(target_path, "r", encoding="utf-8") as f:
        target_html = f.read()

    # Check if target already has CiteIt blocks
    if "Begin CiteIt" in target_html or "Begin: CiteIt" in target_html:
        print("\n  WARNING: Target already contains CiteIt blocks.")
        print("  Remove them first or they will be duplicated.")
        response = input("  Continue anyway? [y/N] ").strip().lower()
        if response != "y":
            print("  Aborted.")
            return

    # Build header notice with page-specific breadcrumbs
    header_notice = build_header_notice(target_path, project_root)

    # Inject all blocks
    print("\nInjecting CiteIt blocks...")
    modified = inject_into_target(target_html, header_notice)

    # Write updated file
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(modified)

    print(f"\nDone! Updated: {os.path.relpath(target_path, project_root)}")


if __name__ == "__main__":
    main()
