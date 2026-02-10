# Duplicate Quote Disambiguation - Design Options

## Problem Statement

Sometimes a quote appears multiple times within a cited document. The current CiteIt design has no way to specify which occurrence is being cited. The webservice picks the first match (or an arbitrary match), which may return the wrong `cited_context_before` and `cited_context_after`.

This affects both:
- **citeit-webservice** (Python): must identify the correct occurrence when computing context
- **CiteIt-quote-context.js** (JavaScript): may need to pass disambiguation info to the webservice or use it when validating responses

---

## Current Behavior

1. The citing page has: `<blockquote cite="https://example.com/article">repeated phrase</blockquote>`
2. The webservice fetches `https://example.com/article`, searches for `"repeated phrase"`
3. It finds the **first** occurrence and returns context around that location
4. If the author intended the 3rd occurrence, the context is wrong

---

## Option 1: Occurrence Index

Add a field specifying which occurrence (1-based) of the quote in the cited document is intended.

### HTML Usage
```html
<blockquote cite="https://example.com/article"
            data-citeit-occurrence="3">
  repeated phrase
</blockquote>
```

### JSON Addition
```json
{
  "...existing fields...",
  "cited_occurrence": 3,
  "cited_occurrence_total": 5
}
```

### Hash Key Impact
The hash would need to incorporate the occurrence number:
`escapeQuote(citing_quote) + "|" + citing_url + "|" + cited_url + "|" + occurrence`

Or: occurrence-0 quotes omit it (backward compatible for single-occurrence quotes).

### Pros
- Simple to implement and understand
- Minimal data overhead
- Easy for authors to specify ("I mean the 3rd time this appears")
- Clean, compact JSON addition

### Cons
- **Fragile**: if the cited document is edited and an earlier occurrence is added or removed, the index shifts and all subsequent citations break
- Author must manually count occurrences, which is error-prone
- No way to verify correctness without fetching the full document
- Not self-describing: occurrence "3" tells you nothing about the location

---

## Option 2: Extended Context Anchoring

Store enough surrounding text from the cited source to uniquely identify the quote location. The webservice would search for the quote + its anchor text together.

### HTML Usage
```html
<blockquote cite="https://example.com/article"
            data-citeit-cited-before="unique text before the"
            data-citeit-cited-after="unique text after the">
  repeated phrase
</blockquote>
```

### JSON Addition
```json
{
  "...existing fields...",
  "cited_anchor_before": "unique text that precedes the quote",
  "cited_anchor_after": "unique text that follows the quote",
  "cited_occurrence": 2,
  "cited_occurrence_total": 5
}
```

The `cited_anchor_before/after` would be short snippets (e.g., 50-200 chars) — just enough to disambiguate, separate from the larger `cited_context_before/after` (~500 chars) used for display.

### Hash Key Impact
Anchor text could optionally be included in the hash, or the hash could remain unchanged (with the webservice using anchors only for lookup, not identity).

### Pros
- **Resilient to edits**: small insertions/deletions elsewhere in the document won't break it, as long as the immediate surroundings are stable
- Self-describing: you can see *where* in the document the quote is
- The webservice can validate the match by checking surrounding text
- Graceful degradation: if anchors don't match (document changed), the webservice can fall back to best-effort matching

### Cons
- More data for the author to provide (though this could be computed by the webservice on first submission)
- Larger JSON payload (though modest — ~200 extra chars)
- Anchor text itself could change if the cited document is edited near the quote

---

## Option 3: Character Offset

Store the character position (byte or character offset) where the quote begins in the cited document's extracted text.

### HTML Usage
```html
<blockquote cite="https://example.com/article"
            data-citeit-offset="4523">
  repeated phrase
</blockquote>
```

### JSON Addition
```json
{
  "...existing fields...",
  "cited_char_offset": 4523,
  "cited_occurrence": 2,
  "cited_occurrence_total": 5
}
```

### Hash Key Impact
Could include offset in hash, or keep hash unchanged and use offset only for lookup.

### Pros
- Precise and unambiguous
- Very compact (single integer)
- Easy for the webservice to compute automatically

### Cons
- **Extremely fragile**: any edit to the cited document before the quote shifts the offset, breaking the reference
- Depends on text extraction being deterministic (HTML-to-text conversion can vary)
- Not human-readable or meaningful
- Author can't reasonably specify this manually — must be computed

---

## Option 4: W3C Text Fragments (URL-based)

Use the [Text Fragments](https://wicg.github.io/scroll-to-text-fragment/) spec to encode the quote location in the URL itself: `https://example.com/article#:~:text=prefix-,quote,quote,-suffix`

### HTML Usage
```html
<blockquote cite="https://example.com/article#:~:text=before%20text-,repeated%20phrase,-after%20text">
  repeated phrase
</blockquote>
```

### JSON Addition
```json
{
  "...existing fields...",
  "cited_url_fragment": "text=before%20text-,repeated%20phrase,-after%20text",
  "cited_occurrence": 2,
  "cited_occurrence_total": 5
}
```

### Hash Key Impact
The fragment could be stripped from the URL for hash computation (maintaining backward compat) or included.

### Pros
- **Web standard**: browsers already support scrolling to text fragments
- Encodes prefix/suffix context for disambiguation directly in the URL
- The `cite` attribute becomes a deep link that browsers can navigate to the exact location
- No new HTML attributes needed — it's all in the URL

### Cons
- URL encoding makes the `cite` attribute long and hard to read
- Not all cited pages work well with text fragments (e.g., JavaScript-rendered content)
- The hash key changes if fragments are included in the URL, breaking backward compatibility
- Fragment syntax has character limitations and escaping complexities
- Prefix/suffix in the fragment may duplicate data already in the JSON

---

## Option 5: Webservice-Computed Disambiguation (Automatic)

The author provides no extra markup. Instead, the **webservice** detects duplicate quotes automatically and stores disambiguation data. If the quote is unique, nothing changes. If duplicates exist, the webservice stores all occurrences or uses `cited_context_before/after` to pick the best match.

### HTML Usage (unchanged)
```html
<blockquote cite="https://example.com/article">
  repeated phrase
</blockquote>
```

### JSON Addition
```json
{
  "...existing fields...",
  "cited_occurrence": 2,
  "cited_occurrence_total": 5,
  "cited_anchor_before": "automatically extracted unique prefix",
  "cited_anchor_after": "automatically extracted unique suffix"
}
```

The webservice would:
1. Find all occurrences of the quote in the cited document
2. For each, extract surrounding context
3. Use heuristics to pick the most likely match (e.g., compare `citing_context_before/after` with the candidate contexts, or pick the first occurrence as default)
4. Store the occurrence index and short anchors for future verification

### Hash Key Impact
No change to the hash. Disambiguation is metadata, not identity.

### Pros
- **Zero author effort**: no new HTML attributes needed
- Backward compatible: existing HTML works unchanged
- Webservice can re-evaluate on re-crawl if the document changes
- Can store all occurrences and let the front-end or a future UI choose

### Cons
- Heuristic matching may pick the wrong occurrence
- No way for the author to explicitly specify which occurrence they mean
- If the webservice guesses wrong, there's no mechanism to correct it without adding author-specified hints

---

## Option 6: Hybrid (Recommended for Consideration)

Combine automatic webservice detection with optional author hints.

### HTML Usage
```html
<!-- Simple case: author provides no hints, webservice auto-detects -->
<blockquote cite="https://example.com/article">
  repeated phrase
</blockquote>

<!-- Disambiguation case: author provides a hint when needed -->
<blockquote cite="https://example.com/article"
            data-citeit-cited-before="unique preceding text">
  repeated phrase
</blockquote>
```

### JSON Structure
```json
{
  "...existing fields...",
  "cited_occurrence": 2,
  "cited_occurrence_total": 5,
  "cited_anchor_before": "short unique text before quote in cited doc",
  "cited_anchor_after": "short unique text after quote in cited doc"
}
```

### Behavior
1. Webservice always counts occurrences and stores `cited_occurrence_total`
2. If `data-citeit-cited-before` is provided, use it to find the correct occurrence
3. If not provided, use heuristics (first occurrence, or best-match based on context)
4. Always store `cited_anchor_before/after` (computed by webservice) for future verification and re-matching
5. Store `cited_occurrence` for informational purposes

### Hash Key Impact
Keep hash unchanged. The `data-citeit-cited-before` hint is used for lookup only, not for identity. This preserves backward compatibility.

### Pros
- Works automatically for the common case (unique quotes)
- Authors can disambiguate when needed with a single attribute
- Webservice always stores enough data to re-verify the match
- Fully backward compatible (new fields are additive)
- The anchor data enables future features (e.g., detecting when cited documents change)

### Cons
- Slightly more complex implementation than any single approach
- Author-provided hints could become stale if the cited document changes

---

## Comparison Summary

| Criteria                    | 1: Index | 2: Anchors | 3: Offset | 4: Text Frags | 5: Auto | 6: Hybrid |
|-----------------------------|----------|------------|-----------|---------------|---------|-----------|
| Author effort               | Low      | Medium     | None*     | Medium        | None    | None/Low  |
| Resilience to doc edits     | Poor     | Good       | Poor      | Good          | Good    | Good      |
| Backward compatible (hash)  | No**     | Flexible   | Flexible  | No**          | Yes     | Yes       |
| Backward compatible (HTML)  | No       | No         | No        | No            | Yes     | Yes       |
| Precision                   | Exact    | High       | Exact     | High          | Heuristic| High     |
| Author can override         | Yes      | Yes        | No        | Yes           | No      | Yes       |
| Implementation complexity   | Low      | Medium     | Low       | Medium        | Medium  | Medium    |

*Computed by webservice, not author
**Unless special handling is added for backward compat

---

## Questions for You

### A. Author Control vs. Automation
Do you want authors to be able to explicitly specify which occurrence they mean? Or should the webservice always figure it out automatically?

**Your answer:** The system should automatically perform disambiguation without requiring author intervention.

### B. Hash Key Compatibility
Should the hash key remain unchanged (disambiguation is metadata only), or is it acceptable to change the hash computation (breaking existing lookups)?

**Your answer:** The current hash design can change (breaking existing lookups is acceptable), but once the new design is in place the hash key should remain stable going forward.

### C. Preferred Approach
Which option (or combination) appeals to you most?

**Your answer:** Option 2 (Extended Context Anchors) or Option 4 (W3C Text Fragments). Leaning toward one of these two.

### D. Interaction with Ellipsis Feature
This feature interacts with the ellipsis/gap feature. If a quote has both gaps (ellipses) AND appears multiple times, the disambiguation anchors help confirm we found the right occurrence before computing gap text. Should these two features be designed together as a single JSON schema update?

**Your answer:** Yes, the two features should be designed together as a single JSON schema update.

---

## Next Steps

Once these questions are answered (along with the ellipsis feature questions), we will:
1. Propose a unified JSON schema covering both features
2. Modify the citeit-webservice Python code
3. Modify the front-end JavaScript
