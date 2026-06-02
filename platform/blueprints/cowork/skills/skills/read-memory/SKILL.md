---
name: cowork:read-memory
description: Pure-read sub-skill that parses memory.md files at the canonical cowork memory path and returns structured data for downstream consumers. Single API surface every memory-aware orchestrator calls instead of re-implementing the file-glob + parse logic. Inputs declare engagement_id + tier + window; output is a structured object (synthesis + carry_forward + ticks + frontmatter). Failure mode is graceful null-data return (matches morning-briefing's v0.84.0 backward-compat gating).
scope: shared
tags: [cowork, sub-skill, memory, read]
---

# cowork:read-memory

Pure-read sub-skill that returns structured data parsed from the canonical cowork memory layer:

- **Tier 0** — individual tick callouts inside `memory.md` files.
- **Tier 1** — daily `memory.md` files (`spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md`).
- **Tier 2** — weekly `synthesis.md` files (`spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-Www>/synthesis.md`).

Load-bearing across:

- `cowork:morning-briefing` (v0.85.0 pre-flight step 3a refactor; output byte-identical to v0.84.0 via `composeMemoryCallouts` helper).
- `cowork:synthesize-week` (v0.85.0 Tier 2 orchestrator).
- v0.86+ wire-through to `cowork:midday-tripwire` / `cowork:eod-review` / `cowork:weekly-review` / `cowork:monthly-review`.

The structured output decouples downstream consumers from the raw-markdown parse logic.

## Inputs

```json
{
  "engagement_id": "<string, required>",
  "tier": "tick | day | week",
  "window": "yesterday | today | this-week | last-7d | { start: <ISO>, end: <ISO> }",
  "limit_ticks": <number, optional, default 6>
}
```

## Pre-flight

Sub-skill is read-only; no pre-flight side effects. The caller is responsible for resolving `engagement_id` from `vault-config.md` before invoking this sub-skill.

## Gather

Resolve the file path(s) per `(tier, window)`:

| `tier` | `window` | Read |
| --- | --- | --- |
| `day` | `yesterday` | yesterday's `memory.md` → populate `day_synthesis` only |
| `day` | `today` | today's `memory.md` → populate `day_synthesis` only |
| `tick` | `today` | today's `memory.md` → populate `ticks` array (most recent `limit_ticks`, chronological-reverse) + `day_synthesis` if synthesized |
| `tick` | `yesterday` | yesterday's `memory.md` → populate `ticks` similarly |
| `week` | `this-week` | THIS-WEEK's `<engagement>/<YYYY>/<MM-Month>/<YYYY-Www>/synthesis.md` → populate `week_synthesis` only |
| `week` | `last-7d` | walks days yesterday → -6d; populates `ticks` aggregated; sets `day_synthesis` to most-recent synthesized day's data |
| any | explicit `{start, end}` | walks day-by-day in the range; aggregates per `tier` |

For each resolved path:

1. Read via `mcp__obsidian__get_file_contents` (or `Read` tool when running outside the MCP-routed surface).
2. Invoke the helper `parseMemoryFile(rawMarkdown)` (for `memory.md`) or `parseSynthesisFile(rawMarkdown)` (for `synthesis.md`).
3. Aggregate into the structured output below.

## Decide

Compose the structured output:

```json
{
  "found": <boolean>,
  "tier": "<echoed from input>",
  "window_resolved": { "start": "<ISO>", "end": "<ISO>" },
  "files_read": ["<absolute or vault-relative path>", ...],
  "day_synthesis": {
    "engagement_id": "<string>",
    "day": "<YYYY-MM-DD>",
    "summary": "<≤200 chars>",
    "synthesis_paragraph": "<2-3 paragraphs voice-applied prose or null if not yet synthesized>",
    "carry_forward_bullets": ["<bullet>", ...],
    "tick_count": <number>,
    "synthesized": <boolean>,
    "synthesis_at": "<ISO or null>",
    "last_tick_at": "<ISO or null>"
  } | null,
  "week_synthesis": {
    "engagement_id": "<string>",
    "iso_week": "<YYYY-Www>",
    "summary": "<≤300 chars>",
    "weekly_pattern": "<3-5 paragraphs voice-applied prose or null>",
    "carry_forward_bullets": ["<bullet>", ...],
    "days_covered": <number>,
    "synthesis_at": "<ISO or null>"
  } | null,
  "ticks": [
    {
      "time": "HH:MM",
      "kindlist": ["chat", "calendar", ...],
      "summary_line": "<one-liner derived from tick body's bold-prefix lines>",
      "raw_callout_md": "<full callout source including header>"
    },
    ...
  ]
}
```

## Failure modes (graceful — never throws)

- **File-not-found** → return `{ found: false, tier, window_resolved, files_read: [], day_synthesis: null, week_synthesis: null, ticks: [] }`. This is the canonical null-data return that downstream consumers gate on.
- **Frontmatter parse error** → return the same null-data shape; emit a Notice (debug-level) with the offending path.
- **Filesystem read error** → return the same null-data shape; emit a Notice.

No throws under any circumstances. Downstream orchestrators rely on null-data gating to skip cleanly when memory hasn't accumulated yet (matches `cowork:morning-briefing`'s v0.84.0 backward-compat posture).

## Done

Return the structured output. No side effects.

## Harness testing

HC-V0850-A1..A4 sub-asserts validate the SKILL.md prose contract (existence, required sections, structured-output fields, graceful-failure clause). Helper-level parsing is unit-tested via golden fixtures (see `compose-memory-callouts.js`'s fixtures at S8). The SKILL.md structure asserts presence of declared input/output shape + null-data graceful-failure clause; runtime behavior is validated post-deploy via the consumer-side morning-briefing wire-through fire.
