# Ellipsis/Gap Feature - Design Questions

## Background

We want to modify contextual citations to allow ellipses within the citation. The ellipses indicate hidden gaps within the citation that can be expanded by the user clicking on the "..". When the user clicks on the ".." the hidden gap in the quote expands and fills with the hidden context. The length of the hidden context can be up to 1000 characters in total. If the gap is greater than that, a new gap will appear in the middle of the hidden context, leaving 500 characters after the original ".." ellipsis, and 500 characters before the continuation of the succeeding quote.

---

## Current JSON Structure

Each quote context JSON file currently contains:

```json
{
  "citing_quote": "the exact quote text",
  "sha256": "64-char hash used as filename",
  "citing_url": "URL of the page containing the quote",
  "cited_url": "URL of the original source",
  "citing_context_before": "~500 chars before the quote on the citing page",
  "citing_context_after": "~500 chars after the quote on the citing page",
  "cited_context_before": "~500 chars before the quote in the original source",
  "cited_context_after": "~500 chars after the quote in the original source",
  "cited_quote": "the quote as found in the original source",
  "citing_archive_url": "",
  "cited_archive_url": "",
  "hashkey": "normalized_quote|citing_url|cited_url"
}
```

The hash is computed from: `escapeQuote(citing_quote) + "|" + urlWithoutProtocol(citing_url) + "|" + urlWithoutProtocol(cited_url)`

JSON files are stored at: `https://read.citeit.net/quote/sha256/0.4/{shard}/{sha256}.json`
where `shard` is the first 2 characters of the hash.

---

## Questions

### 1. Quote Representation in HTML

Currently `citing_quote` stores the full continuous quote text. With ellipses, the quote on the citing page will have gaps. How should the quoting author indicate an ellipsis in their HTML?

- **Option A**: They literally type `...` or `...` in the blockquote text (e.g., `<blockquote cite="...">First part ... second part</blockquote>`)
- **Option B**: A special markup like `<span class="citeit-gap">...</span>`
- **Option C**: Something else?

This matters because the webservice needs to detect where the gaps are.

**Your answer:** Option A — the author literally types "..." in the blockquote text.

---

### 2. Hash Key Stability

The SHA256 hash is currently computed from the full quote text + citing URL + cited URL. If the quote now contains `...` gaps, should the hash be computed from:

- **Option A**: The quote text as-written (including the `...`)?
- **Option B**: The reconstructed full quote (gaps filled in)?

This affects backward compatibility and lookup behavior.

**Your answer:** Option A — the hash is computed from the quote text as-written, including the "...".

---

### 3. Multiple Gaps

A single quote could have multiple ellipses (e.g., `"First part ... middle part ... last part"`). Should the data structure support an arbitrary number of gaps, or is there a practical limit you want to impose?

**Your answer:** The data structure should support an arbitrary number of gaps.

---

### 4. Recursive Gap Limit

You described that gaps > 1000 chars get a new ellipsis in the middle (500 before + 500 after). Can that secondary gap also be expandable? Or is it just a hard truncation with a "read more" link? How many levels of nesting should be supported?

**Your answer:** The secondary gap does not need to be expandable. It should be a hard truncation with a "read more" link. One level of nesting only.

---

### 5. Gap Context Source

The hidden text in each gap comes from the cited source (the original document being quoted). Is that correct, or could it ever come from the citing page?

**Your answer:** The gap text always comes from the cited source.

---

### 6. JSON Structure Direction

Here is a proposed direction. The current flat fields (`cited_context_before`, `citing_quote`, `cited_context_after`) would be augmented with a `quote_segments` array:

```json
{
  "citing_quote": "First part ... second part ... third part",
  "quote_segments": [
    { "type": "text", "text": "First part" },
    { "type": "gap", "hidden_text": "the omitted words here...", "char_count": 847 },
    { "type": "text", "text": "second part" },
    { "type": "gap", "hidden_text": "more omitted text...", "char_count": 200 },
    { "type": "text", "text": "third part" }
  ],
  "...existing fields preserved for backward compatibility..."
}
```

For gaps > 1000 chars, the `hidden_text` would contain the first 500 + `...` + last 500 chars, and optionally a nested structure or a separate `gap_segments` array.

Does this direction feel right? What would you change?

**Your answer:** Yes, this structure looks right. Would like the option of a nested structure for large gaps.

---

### 7. Backward Compatibility

Should quotes without ellipses continue to work unchanged (i.e., `quote_segments` is simply absent or empty)? Assumption: yes.

**Your answer:** Backward compatibility is not important because the system is not yet in production.

---

### 8. UI Indicator

You mentioned clicking `".."` to expand. Should the clickable indicator be:

- `..` (two dots, as currently used for context before/after)
- `...` (three dots)
- `...` (Unicode ellipsis character)
- Something else?

And should there be a visual affordance (color, underline, icon) to signal it's clickable?

**Your answer:** The clickable indicator should be three dots "...". The visual affordance: bright blue color, becoming bold when hovered over.

---

## Next Steps

All questions answered. Ready to:
1. Propose a unified JSON schema (combined with duplicate quote disambiguation feature)
2. Modify the citeit-webservice to look up quotes and save JSON files in the new format
3. Modify the front-end JavaScript to parse and render the new structure
