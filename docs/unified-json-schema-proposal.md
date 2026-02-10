# Unified JSON Schema Proposal v0.5

This schema combines two new features into a single update:
1. **Ellipsis/Gap Expansion** — clickable "..." gaps within quotes that reveal hidden context
2. **Duplicate Quote Disambiguation** — automatic identification of the correct quote occurrence

---

## Design Decisions Summary

| Decision | Answer |
|----------|--------|
| Ellipsis indicator in HTML | Author types literal `...` in blockquote text |
| Hash computation | From quote text as-written (including `...`) |
| Multiple gaps | Arbitrary number supported |
| Recursive gaps (>1000 chars) | One level only — hard truncation with "read more" link |
| Gap text source | Always from the cited document |
| Backward compatibility | Not required (system not yet in production) |
| UI indicator | `...` in bright blue, bold on hover |
| Disambiguation | Automatic, no author intervention |
| Disambiguation method | Option 2 — Extended Context Anchors (webservice-computed) |

---

## Complete JSON Schema

```json
{
  "schema_version": "0.5",

  "sha256": "64-char hex hash",
  "hashkey": "normalized_quote_as_written|citing_url|cited_url",

  "citing_url": "https://example.com/my-article",
  "cited_url": "https://example.com/original-source",

  "citing_quote": "The first part of the quote ... and the conclusion of the quote",

  "cited_quote": "The first part of the quote with all the original intervening text restored and the conclusion of the quote",

  "citing_context_before": "~500 chars before the quote on the citing page",
  "citing_context_after": "~500 chars after the quote on the citing page",

  "cited_context_before": "~500 chars before the quote in the cited source",
  "cited_context_after": "~500 chars after the quote in the cited source",

  "quote_segments": [
    {
      "type": "text",
      "text": "The first part of the quote"
    },
    {
      "type": "gap",
      "char_count": 340,
      "hidden_text": "with all the original intervening text restored",
      "gap_segments": null
    },
    {
      "type": "text",
      "text": "and the conclusion of the quote"
    }
  ],

  "cited_occurrence": 2,
  "cited_occurrence_total": 3,
  "cited_anchor_before": "short unique text preceding the quote in the cited doc",
  "cited_anchor_after": "short unique text following the quote in the cited doc",

  "citing_archive_url": "",
  "cited_archive_url": ""
}
```

---

## Field-by-Field Specification

### Existing Fields (modified)

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | string | **New.** Always `"0.5"`. Allows the front-end to detect which schema version a JSON file uses. |
| `sha256` | string | 64-char hex SHA256 hash. **Hash computation unchanged** — computed from `citing_quote` as-written (including any `...`), citing URL, and cited URL. |
| `hashkey` | string | The raw concatenated string before hashing. Same as before but now `citing_quote` may contain `...`. |
| `citing_quote` | string | The quote text as it appears on the citing page, **including literal `...` for gaps**. |
| `cited_quote` | string | The **full reconstructed quote** as it exists in the cited source, with all gap text restored. This allows verification that the segments are correct. |
| `citing_url` | string | URL of the page containing the quote. Unchanged. |
| `cited_url` | string | URL of the original source. Unchanged. |
| `citing_context_before` | string | ~500 chars before the quote on the citing page. Unchanged. |
| `citing_context_after` | string | ~500 chars after the quote on the citing page. Unchanged. |
| `cited_context_before` | string | ~500 chars before the quote in the cited source. Unchanged. |
| `cited_context_after` | string | ~500 chars after the quote in the cited source. Unchanged. |
| `citing_archive_url` | string | Optional archive.org URL. Unchanged. |
| `cited_archive_url` | string | Optional archive.org URL. Unchanged. |

### New Fields — Ellipsis/Gap Feature

| Field | Type | Description |
|-------|------|-------------|
| `quote_segments` | array | Ordered array of segment objects representing the quote broken into text and gap parts. Present for all quotes; for quotes without gaps, contains a single text segment. |

#### Segment Object — Text Type

```json
{
  "type": "text",
  "text": "The visible quoted text"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"text"` |
| `text` | string | The visible portion of the quote |

#### Segment Object — Gap Type

```json
{
  "type": "gap",
  "char_count": 340,
  "hidden_text": "the omitted text from the cited source",
  "gap_segments": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"gap"` |
| `char_count` | integer | Total number of characters omitted from the cited source |
| `hidden_text` | string or null | The omitted text. If `char_count <= 1000`, this is the full omitted text. If `char_count > 1000`, this is `null` and `gap_segments` is used instead. |
| `gap_segments` | array or null | Only present when `char_count > 1000`. Contains a nested segment array for the large gap. `null` when `hidden_text` is used directly. |

#### Large Gap (>1000 chars) — Nested Structure

When a gap exceeds 1000 characters, `hidden_text` is `null` and `gap_segments` contains:

```json
{
  "type": "gap",
  "char_count": 2500,
  "hidden_text": null,
  "gap_segments": [
    {
      "type": "text",
      "text": "first 500 characters of the omitted text ..."
    },
    {
      "type": "truncated",
      "char_count": 1500,
      "read_more_url": "https://example.com/original-source"
    },
    {
      "type": "text",
      "text": "... last 500 characters of the omitted text"
    }
  ]
}
```

The `truncated` segment is **not expandable** — it renders as a "read more" link to the cited source.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"truncated"` — indicates a non-expandable omission |
| `char_count` | integer | Number of characters truncated |
| `read_more_url` | string | URL to the cited source for the user to read the full text |

### New Fields — Disambiguation

| Field | Type | Description |
|-------|------|-------------|
| `cited_occurrence` | integer | Which occurrence (1-based) of the quote this is within the cited document. `1` if the quote is unique. |
| `cited_occurrence_total` | integer | Total number of times this quote appears in the cited document. `1` if unique. |
| `cited_anchor_before` | string | Short unique text (up to 200 chars) immediately preceding the quote in the cited document. Computed by the webservice to uniquely identify this occurrence. |
| `cited_anchor_after` | string | Short unique text (up to 200 chars) immediately following the quote in the cited document. Computed by the webservice to uniquely identify this occurrence. |

**How the webservice uses anchors:**
1. Fetch the cited document and find all occurrences of the quote text
2. If only 1 occurrence: set `cited_occurrence = 1`, `cited_occurrence_total = 1`, extract short anchors
3. If multiple occurrences: use heuristics to pick the best match (e.g., compare surrounding context with `citing_context_before/after`), then set the occurrence index and extract unique anchors
4. The anchor length starts at 50 chars and extends up to 200 chars until the combination of `cited_anchor_before` + quote + `cited_anchor_after` is unique within the document

---

## Complete Example — Quote with One Gap

### Author's HTML
```html
<blockquote cite="https://en.wikisource.org/wiki/Pride_and_Prejudice/Chapter_5">
  I could easily forgive his pride ... if he had not mortified mine.
</blockquote>
```

### Generated JSON
```json
{
  "schema_version": "0.5",
  "sha256": "a1b2c3d4...",
  "hashkey": "Icouldeasilyforgivehispride...ifhehadnotmortifiedmine.|www.example.com/article|en.wikisource.org/wiki/Pride_and_Prejudice/Chapter_5",

  "citing_url": "https://www.example.com/article",
  "cited_url": "https://en.wikisource.org/wiki/Pride_and_Prejudice/Chapter_5",

  "citing_quote": "I could easily forgive his pride ... if he had not mortified mine.",
  "cited_quote": "I could easily forgive his pride, which had not perhaps been so strong as to surprise me, if he had not mortified mine.",

  "citing_context_before": "Elizabeth says: ",
  "citing_context_after": " Jane Austen wrote this...",
  "cited_context_before": "...text from the original chapter before the quote...",
  "cited_context_after": "...text from the original chapter after the quote...",

  "quote_segments": [
    { "type": "text", "text": "I could easily forgive his pride" },
    {
      "type": "gap",
      "char_count": 48,
      "hidden_text": ", which had not perhaps been so strong as to surprise me,",
      "gap_segments": null
    },
    { "type": "text", "text": "if he had not mortified mine." }
  ],

  "cited_occurrence": 1,
  "cited_occurrence_total": 1,
  "cited_anchor_before": "was not so well pleased with it.",
  "cited_anchor_after": "Charlotte Lucas, a sensible",

  "citing_archive_url": "",
  "cited_archive_url": ""
}
```

---

## Complete Example — Quote with Large Gap (>1000 chars)

```json
{
  "schema_version": "0.5",

  "citing_quote": "In the beginning ... the end.",
  "cited_quote": "In the beginning [full 2500 chars of original text] the end.",

  "quote_segments": [
    { "type": "text", "text": "In the beginning" },
    {
      "type": "gap",
      "char_count": 2500,
      "hidden_text": null,
      "gap_segments": [
        {
          "type": "text",
          "text": "[first 500 characters of omitted text]"
        },
        {
          "type": "truncated",
          "char_count": 1500,
          "read_more_url": "https://example.com/original-source"
        },
        {
          "type": "text",
          "text": "[last 500 characters of omitted text]"
        }
      ]
    },
    { "type": "text", "text": "the end." }
  ],

  "...other fields..."
}
```

---

## Complete Example — Quote with No Gaps

For a standard quote without ellipses, `quote_segments` contains a single text segment:

```json
{
  "schema_version": "0.5",

  "citing_quote": "I could easily forgive his pride, if he had not mortified mine.",
  "cited_quote": "I could easily forgive his pride, if he had not mortified mine.",

  "quote_segments": [
    { "type": "text", "text": "I could easily forgive his pride, if he had not mortified mine." }
  ],

  "cited_occurrence": 1,
  "cited_occurrence_total": 1,
  "cited_anchor_before": "was not so well pleased with it.",
  "cited_anchor_after": "Charlotte Lucas, a sensible",

  "...other fields..."
}
```

---

## Complete Example — Duplicate Quote (3rd of 5 occurrences)

```json
{
  "schema_version": "0.5",

  "citing_quote": "To be or not to be",
  "cited_quote": "To be or not to be",

  "quote_segments": [
    { "type": "text", "text": "To be or not to be" }
  ],

  "cited_occurrence": 3,
  "cited_occurrence_total": 5,
  "cited_anchor_before": "HAMLET: ",
  "cited_anchor_after": ", that is the question",

  "...other fields..."
}
```

---

## Hash Key Computation (v0.5)

The hash is computed identically to before, but `citing_quote` now includes literal `...` when present:

```
hashkey = escapeQuote(citing_quote) + "|" + urlWithoutProtocol(citing_url) + "|" + urlWithoutProtocol(cited_url)
sha256 = SHA256(UTF8(hashkey))
```

No change to the hash algorithm. The `...` in the quote text naturally becomes part of the hash input.

---

## Webservice Processing Logic

### Step 1: Parse the citing quote
- Split `citing_quote` on `...` (literal three dots) to identify text segments and gap positions
- Handle edge cases: `...` at start/end of quote, consecutive `...`, `...` within legitimate text

### Step 2: Find the quote in the cited document
- Fetch the cited document and extract text
- Search for each text segment in order within the cited document
- Use flexible matching: the text segments must appear in order with arbitrary text between them (the gaps)

### Step 3: Disambiguate (if multiple matches)
- Count all matching locations
- For each match, extract surrounding context
- Compare with `citing_context_before/after` to pick the best match
- Compute `cited_anchor_before/after` — extend from 50 to 200 chars until unique

### Step 4: Build segments
- For each gap between text segments, extract the omitted text from the cited document
- If gap `char_count <= 1000`: store full text in `hidden_text`
- If gap `char_count > 1000`: set `hidden_text = null`, populate `gap_segments` with first 500 chars + truncated + last 500 chars

### Step 5: Build the full cited_quote
- Concatenate all text segments with their gap text restored to produce `cited_quote`

---

## Front-End Rendering Logic

### Rendering quote_segments
1. Iterate over `quote_segments`
2. For `"text"` segments: render as normal escaped HTML
3. For `"gap"` segments:
   - Render a clickable `<span class="citeit-gap">...</span>` in bright blue
   - On hover: bold the `...`
   - On click: expand inline to show `hidden_text` (or `gap_segments` for large gaps)
4. For `"truncated"` segments (inside `gap_segments`):
   - Render as `<span class="citeit-gap-truncated">... [1500 chars omitted] </span>` with a "read more" link

### CSS
```css
.citeit-gap {
  color: #0066ff;
  cursor: pointer;
  font-weight: normal;
}
.citeit-gap:hover {
  font-weight: bold;
}
.citeit-gap-expanded {
  color: inherit;
  cursor: default;
  background-color: #f0f8ff;
}
.citeit-gap-truncated {
  color: #999;
  font-style: italic;
}
```

---

## Migration Notes

- **Version bump**: `0.4` → `0.5` in API paths and `schema_version` field
- **All JSON files must be regenerated** — no backward compatibility needed
- **New API endpoint path**: `https://read.citeit.net/quote/sha256/0.5/{shard}/{sha256}.json`
- **Hash values will change** for quotes that previously had no `...` — but since the hash algorithm is unchanged and only the quote content determines the hash, existing quotes without `...` will produce the same hash
- Quotes **with** `...` are inherently new and won't collide with old data
