---
name: cowork:check-heartbeat
description: Walks .cowork.json sidecars under spice/cowork/daily/ to compute per-cadence last-fire timestamps; flags expected cadences missing their freshness window; appends a warning callout to today's memory.md. Pure data — no MCP / LLM calls.
schedule: Invoked by cowork:synthesize-day as a final post-step (NOT cron-scheduled directly).
scope: shared
tags: [cowork, sub-skill, heartbeat, observability, rail-h]
---

# cowork:check-heartbeat

> [!info]+ Rail H cron-heartbeat (v0.96.1)
> Pure data scan over the last 30 days of `.cowork.json` sidecars. No write surface beyond a single warning callout appended to today's `memory.md` when any expected cadence missed its freshness window. Silent on green.

## Inputs

```
{
  engagement_id: string,     // required
  today: string,             // YYYY-MM-DD; required
  vault_root: string,        // required
  enabled_cadences: string[] // optional; defaults to all engagement.cadences[c] === true
}
```

## Steps

1. Load `cadence-freshness-windows.json` from `<vault_root>/.claude/skills/cowork/data/cadence-freshness-windows.json` (fallback: workshop blueprint source) via `_loadFreshnessWindows(vault_root)`.

2. Resolve `expected_cadences`:
   - If `enabled_cadences` was passed in input, use it directly.
   - Otherwise: read `<vault_root>/spice/cowork/context/vault-config.md` frontmatter; find the engagement record matching `engagement_id`; collect every cadence key under `engagement.cadences` where the value is `true`.

3. Invoke helper `walkCadenceSidecars({ vault_root, engagement_id, days: 30 })`. Capture `last_fires` map: `{ <cadence>: { last_fire_at, count_in_window } }`.

4. Invoke helper `evaluateFreshness({ windows_hours, expected_cadences, last_fires, now: today })`. Capture `{ missed, green, first_fire }`.

5. If `missed.length === 0`: exit silently with status ok. No callout written.

6. Otherwise invoke `composeHeartbeatCallout(missed, first_fire, today)`. Capture `callout_md`.

7. Read today's `memory.md` at `<vault_root>/spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md`. If absent, exit ok (no memory to attach to — synthesize-day will write the warning when it composes memory.md).

8. Append the callout to memory.md immediately after the synthesis section (before `## Ticks`). Use atomic-write semantics (temp file + rename) to avoid partial writes.

9. Return `{ status: "ok", missed_count: missed.length, first_fire, callout_emitted: true }`.

## Return

```
{
  status: "ok" | "failed:<reason>",
  missed_count: number,
  first_fire: boolean,
  callout_emitted: boolean
}
```

## Idempotency

Re-fire same-day is safe. If memory.md already contains a `> [!warning]+ Cron heartbeat anomaly` callout from an earlier same-day invocation, the second invocation REPLACES it (regex-locate + atomic-rewrite) — does NOT append a second callout. The most recent set of missed cadences wins.

## Failure modes

- **Sidecars directory empty:** `walkCadenceSidecars` returns `{}`. `evaluateFreshness` sees `first_fire: true`. Callout fires with first-fire mitigation message.
- **vault-config.md unreadable:** abort with `failed:contract-violation:vault-config-unreadable`. Synthesize-day's invocation is non-fatal — heartbeat skip doesn't break synthesize-day.
- **Some sidecars malformed JSON:** silently skip those files, continue with the rest.
- **memory.md write race:** atomic temp+rename avoids half-written file. Two simultaneous invocations rare in practice (synthesize-day fires once per day).

## Performance

Pure data — no MCP / LLM. Bounded by sidecar count in 30-day window (typically <200 files). <100ms typical.
