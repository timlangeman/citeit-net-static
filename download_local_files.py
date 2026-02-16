#!/usr/bin/env python3
"""
Download local copies of JS, CSS, images, and fonts for a Substack page.

This is a convenience wrapper around localize_page.py. It performs the
same operations:
  1. Fix %252F double-encoded slashes
  2. Remove analytics/tracking scripts (Sentry, Cloudflare, GTM, Datadog)
  3. Remove Substack JS bundle <script> tags (non-functional offline)
  4. Download all remote assets (CSS, JS, images, fonts) to local-assets/
  5. Rewrite all HTML references to point to local-assets/
  6. Copy updated files to _site/ for the Eleventy dev server

Usage:
  python3 download_local_files.py <url_or_path>

Examples:
  python3 download_local_files.py http://localhost:8080/demo/substack/site.com/p/article/
  python3 download_local_files.py demo/substack/site.com/p/article/index.html

Options:
  --no-copy-to-site    Skip copying to _site/ directory
  --dry-run            Show what would be done without modifying files
"""

import subprocess
import sys
import os


def main():
    # Find localize_page.py in the same directory as this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    localize_script = os.path.join(script_dir, "localize_page.py")

    if not os.path.isfile(localize_script):
        print(f"Error: localize_page.py not found at {localize_script}")
        sys.exit(1)

    # Pass all arguments through to localize_page.py
    cmd = [sys.executable, localize_script] + sys.argv[1:]
    result = subprocess.run(cmd)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
