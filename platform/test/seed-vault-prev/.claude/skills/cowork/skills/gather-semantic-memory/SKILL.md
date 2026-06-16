---
name: cowork:gather-semantic-memory
description: Semantic-retrieval sub-skill that surfaces historical memory analogues to today's anchor text via Smart Connections embeddings. Wraps the existing smart-connections-bridge semantic-search op. Inputs declare engagement_id + anchor_text + retrieval parameters; output is a structured matches[] array with similarity scores + synthesis excerpts. Failure mode is graceful null-data return (sc-bridge unavailable, SC index missing, thin corpus, empty anchor all produce found:false + error:string with empty matches).
scope: shared
tags: [cowork, sub-skill, memory, semantic, retrieval]
---

# cowork:gather-semantic-memory

Pure-retrieval sub-skill that surfaces historical analogues from the accumulated cowork memory corpus to the caller's anchor text. Wraps `smart-connections-bridge@0.1.1`'s `semantic-search` op. The "Echoes from your record" callout is the canonical consumer (composed via `composeSemanticEchoesCallout` helper at v0.87.0).

Tier 2 (weekly synthesis.md) matches are prioritized over Tier 1 (daily memory.md) when both present at the min_similarity threshold; Tier 0 (per-tick) is NOT included (per-tick noise; signal lives at synthesis grain).

## Inputs

```json
{
  "engagement_id": "<string, required>",
  "anchor_text": "<string, required — ≤500 chars composed by caller>",
  "top_k": <number, optional, default 3>,
  "exclude_window": "last-30d | last-7d | { start: <ISO>, end: <ISO> } | none",
  "min_similarity": <number, optional, default 0.45>
}
```

## Pre-flight

Sub-skill is read-only; no pre-flight side effects. The caller is responsible for composing `anchor_text` from upstream gather output (dispatch_plan_summary + calendar + email summaries). Empty anchor_text → return error: "empty_anchor" + empty matches (don't invoke sc-bridge).

## Gather

1. Compose exclude globs from `exclude_window`:
   - `last-30d` / `last-7d`: walk the appropriate day range; compose globs `spice/cowork/memory/<engagement>/YYYY/MM-Month/YYYY-MM-DD/*.md` per day.
   - `{start, end}`: walk days in range.
   - `none`: no globs.
2. Invoke `sc-bridge semantic-search <anchor_text> --vault <vault-root> --top-k <top_k> --min-similarity <min_similarity> --exclude-glob <glob>` (one --exclude-glob per excluded day; multiple flags allowed per sc-bridge interface). Capture stdout JSON.
3. Parse JSON. Filter results to paths matching `spice/cowork/memory/<engagement_id>/**` (memory-scoped, engagement-scoped).
4. For each result, identify tier:
   - `synthesis.md` filename → tier: "week"
   - `memory.md` filename → tier: "day" (if synthesized) or "tick" (if not)
5. Prefer Tier 2 matches: sort by (tier desc, similarity desc). Keep top `top_k`.
6. For each kept match, extract synthesis excerpt via `parseMemoryFile` / `parseSynthesisFile` from `helpers/read-memory-helper.js`. Truncate to ≤200 chars.

## Decide

Compose output:

```json
{
  "found": <true if matches.length > 0>,
  "matches": [
    {
      "path": "<vault-relative path>",
      "similarity_score": <float 0..1>,
      "day_or_week": "<YYYY-MM-DD or YYYY-Www>",
      "tier": "tick | day | week",
      "synthesis_excerpt": "<≤200 chars>"
    },
    ...
  ],
  "anchor_text_used": "<echo>",
  "exclusion_count": <number>,
  "error": null
}
```

### Structured items (NEW v0.96.0)

In addition to `markdown`, return `items[]` — one entry per surfaced echo:

```json
{
  "items": [
    {
      "item_id": "<deriveItemId({ kind: 'semantic', engagement_id, day, stable_key: echo.source_path })>",
      "kind": "semantic",
      "callout_type": "example",
      "title": "<echo.title or source basename>",
      "features": {
        "similarity_bucket": "0.45-0.6|0.6-0.75|0.75-plus",
        "source_age_bucket": "within-week|within-month|older",
        "is_warning": false
      }
    }
  ]
}
```

## Failure modes (graceful — never throws)

- **Empty anchor_text** → `{ found: false, matches: [], anchor_text_used: "", error: "empty_anchor" }`.
- **sc-bridge binary missing** → `{ found: false, matches: [], error: "sc_bridge_unavailable" }`.
- **SC index missing/corrupt** (sc-bridge exit code 4) → `{ found: false, matches: [], error: "index_unavailable" }`.
- **Timeout** (10s default) → `{ found: false, matches: [], error: "timeout" }`.
- **Empty result set** after filtering → `{ found: false, matches: [], error: null }`.

No throws. Caller composes null-data clean-omit in body composition.

## Done

Return the structured output. No side effects.

## Harness testing

HC-V0870-A1..A4 sub-asserts validate SKILL.md prose contract (existence, required sections, structured-output fields, graceful-failure clause). Helper-level retrieval is integration-tested via consumer-vault sc-bridge invocations post-deploy; SKILL.md structure asserts presence of declared inputs/outputs + null-data graceful-failure clause.
