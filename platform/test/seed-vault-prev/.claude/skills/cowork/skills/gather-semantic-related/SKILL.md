---
name: cowork:gather-semantic-related
description: Semantic retrieval over the vault's Smart Connections index. Returns markdown for a "> [!example]+ 🧩 Related context" callout + structured hits. Used by morning-briefing / eod-review / weekly-review for thematic note surfacing. Calls sc-bridge (smart-connections-bridge mechanism) via Bash. Skipped gracefully when no SC index present.
scope: shared
tags: [cowork, gather, semantic, smart-connections]
---

# cowork:gather-semantic-related

Retrieves semantically related notes from the vault's Smart Connections index and emits a paste-ready `> [!example]+ 🧩 <callout_title>` callout block. Works in two modes: `find-related` (anchor-based similarity from an existing note path) and `semantic-search` (free-text query). Invokes the sc-bridge CLI (materialized at `.local/mechanisms/smart-connections-bridge/sc-bridge.js`) via Bash. When the SC index is absent, the anchor is too short to embed, or no candidates clear the similarity floor, returns a structured skip signal rather than failing. Makes no other cowork sub-skill calls.

## Inputs

```
{
  mode: "find-related" | "semantic-search",
  anchor: string,            // required when mode == "find-related" (vault-relative path)
  query: string,             // required when mode == "semantic-search"
  top_k: int,                // optional, default 3
  min_similarity: float,     // optional, default 0.45
  exclude_globs: list[str],  // optional default ["spice/cowork/daily/**", "spice/cowork/weekly/**", "spice/cowork/monthly/**", ".obsidian/**", ".smart-env/**"]
  callout_title: string      // optional, default "Related context"
}
```

## Outputs

```
{
  status: "ready" | "skipped:no-index" | "skipped:anchor-not-indexed" | "skipped:no-hits-above-floor",
  index_age_minutes: int | null,
  markdown: string,
  hits: [ { path, title, similarity, snippet } ]
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

## Steps

### Step 1 — Probe index status

Run the following Bash command:

```bash
node "${WORKSHOP_PATH:-$(pwd)/.local/mechanisms/smart-connections-bridge}/sc-bridge.js" index-status --vault "$(pwd)" --quiet
```

The materialized path is `.local/mechanisms/smart-connections-bridge/sc-bridge.js` per the smart-connections-bridge mechanism's manifest `files[]`. The `WORKSHOP_PATH` fallback is a defensive measure; in real consumer vaults the bridge lives under `.local/`.

Parse stdout as JSON. Capture `index_status` and `index_age_minutes`.

- If `index_status == "absent"` or `index_status == "error"`: return `{ status: "skipped:no-index", index_age_minutes: null, markdown: "", hits: [] }` and exit immediately.
- If `index_status == "ready"` or `index_status == "stale-config"`: continue to Step 2.

### Step 2 — Query

Compose the appropriate Bash invocation based on `mode`:

```bash
# For mode == "find-related":
node "${WORKSHOP_PATH:-$(pwd)/.local/mechanisms/smart-connections-bridge}/sc-bridge.js" find-related "<anchor>" --vault "$(pwd)" --top-k <top_k> --min-similarity <min_similarity> [--exclude-glob <pattern> ...] --quiet

# For mode == "semantic-search":
node "${WORKSHOP_PATH:-$(pwd)/.local/mechanisms/smart-connections-bridge}/sc-bridge.js" semantic-search "<query>" --vault "$(pwd)" --top-k <top_k> --min-similarity <min_similarity> [--exclude-glob <pattern> ...] --quiet
```

For each entry in `exclude_globs`, append a separate `--exclude-glob <pattern>` flag. Apply defaults: `top_k = 3`, `min_similarity = 0.45`, `exclude_globs = ["spice/cowork/daily/**", "spice/cowork/weekly/**", "spice/cowork/monthly/**", ".obsidian/**", ".smart-env/**"]`.

Parse stdout as JSON.

### Step 3 — Branch on hits

Inspect the parsed response:

- If the bridge returned `skipped: "anchor-not-indexed"` (find-related on an anchor that is too short or has not been embedded by Smart Connections): return `{ status: "skipped:anchor-not-indexed", index_age_minutes, markdown: "", hits: [] }`.
- If `hits.length == 0` (all candidates fell below `min_similarity` and none passed the floor): return `{ status: "skipped:no-hits-above-floor", index_age_minutes, markdown: "", hits: [] }`.
- Otherwise continue to Step 4.

### Step 4 — Render markdown callout

Compose the callout block using `callout_title` (default `"Related context"`):

```
> [!example]+ 🧩 <callout_title>
> - [[<title>]] — <snippet truncated to 80 chars> (sim <similarity:.2f>)
> - ...
```

Rendering rules per hit:
- Use `[[<title>]]` wikilink form for the note title.
- Truncate `snippet` to 80 characters; append `…` when truncated.
- Format `similarity` as a 2-decimal float (e.g. `0.73`).

### Step 5 — Return

Return the structured output:

```
{ status: "ready", index_age_minutes, markdown, hits }
```

## Orchestrator integration contract

The orchestrator that calls this sub-skill is responsible for the following interpolation rules:

**Index age line.** When `index_age_minutes` is non-null (regardless of whether hits is empty), interpolate `> Semantic index age: <N>m` inside the orchestrator's `> [!info]- Synopsis` callout. This surfaces freshness every fire, even on skip paths other than `skipped:no-index`.

**Warning callout.** When `status` is `"skipped:no-index"` or `"skipped:anchor-not-indexed"`, the orchestrator appends a one-line warning callout near the synopsis:

```
> [!warning]- Semantic index not available
> Smart Connections index absent or anchor not indexed — semantic gather skipped.
```

This is idempotent: when the orchestrator calls this sub-skill multiple times per run (e.g. once per engagement in morning-briefing), it must emit at most ONE such warning block in the output note, not one per call.

**No warning for no-hits-above-floor.** When `status == "skipped:no-hits-above-floor"`, the index is healthy and functioning — nothing matched the similarity floor. The orchestrator does not emit a warning callout for this case.

**Body skeleton slot.** The Related-context callout (`> [!example]+ 🧩 ...`) slots into the v0.74.0 adaptive body skeleton's optional-example-block region. The pre-write self-check regex already allows multiple `> [!example]+` markers; no change to the self-check logic is needed.

**No downstream sub-skill calls.** This sub-skill calls only the sc-bridge CLI via Bash. It does not call any other cowork sub-skill.
