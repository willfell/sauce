---
name: cowork:patch-daily-callouts
description: Engagement-aware. Patch callout blocks into a daily note under per-engagement H2 sections within the COWORK_CALLOUTS anchor block; fallback to ## Notes on marker absence. Idempotent replace-by-(cadence, engagement_id). Multi-engagement-same-cadence H2 blocks coexist.
inputs:
  engagement_id: string
  daily_path: string
  callouts: list[object]
  tail_blocks: list[object]
outputs:
  status: string
  patched_count: int
tags: [cowork, write, engagement-aware]
---

# cowork:patch-daily-callouts

FAT mutation skill that owns all daily-note callout writes for cowork orchestrators. Reads the daily note, locates the `[//]: # (COWORK_CALLOUTS)` anchor, and replaces or inserts each provided callout idempotently within the per-engagement H2 section that matches `(cadence, engagement_id)`. Tail blocks (e.g., Open Threads) go below `## Notes`. Orchestrators MUST NOT call `mcp__obsidian__patch_note` directly — every daily-note write routes through this sub-skill.

## Engagement-aware H2 layout (v0.31.0)

Inside the `[//]: # (COWORK_CALLOUTS)` block, this skill writes one H2 per `(cadence, engagement.label)` pair. Multi-engagement-same-cadence H2 blocks coexist — running the morning briefing for engagement `accuris` AND engagement `personal` produces two distinct H2 blocks in the same daily note:

```markdown
[//]: # (COWORK_CALLOUTS)

## Morning — Accuris
<callouts for accuris morning>

## Morning — Personal
<callouts for personal morning>

## EOD — Accuris
<callouts for accuris eod>
```

Idempotent replace is keyed on `(cadence_marker, engagement.label)`. Re-running the same orchestrator for the same engagement on the same day replaces ONLY the matching H2 block.

## Inputs

- `engagement_id` (string, required): id of the engagement this patch is for. Resolves the engagement record to get `engagement.label`; the H2 title becomes `## <Cadence> — <engagement.label>`.
- `daily_path` (string, required): vault-relative path to today's (or target) daily note. Caller computes via `cowork:date-context.daily_path`.
- `callouts` (list[object], required): ordered list of callout blocks to patch under the matching H2 ABOVE `[//]: # (COWORK_CALLOUTS)`. Each entry is `{ id: string, body: string }`:
  - `id` — short stable identifier; ALSO determines the cadence marker derived from the id prefix (`"morning-briefing"` → `Morning`, `"tripwire-red"` / `"tripwire-yellow"` → `Midday`, `"eod-review"` → `EOD`, `"weekly-review"` → `Weekly`, `"monthly-review"` → `Monthly`, `"finance"` → nested under Morning's H2, `"open-threads"` → tail block).
  - `body` — the full multi-line callout markdown, every line `> `-prefixed, no trailing blank line.
- `tail_blocks` (list[object], optional): callout blocks that go AFTER the `## Notes` heading. Same shape as `callouts`. Empty list = no tail mutation.

## Outputs

- `status` (string): one of `"ok"`, `"fallback-used"` (marker absent — inserted before `## Notes` or appended), `"error:<reason>"`.
- `patched_count` (int): number of callouts successfully written (head + tail combined).

## Steps

1. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md` via `mcp__obsidian__get_frontmatter`; look up `engagements[]` entry where `id == engagement_id`. Capture `engagement.label`. If not found, return `{ status: "error:engagement-not-found", patched_count: 0 }`.
2. Read the daily note via `mcp__obsidian__read_note` at `daily_path`. On read failure, return `{ status: "error:read-failed", patched_count: 0 }`.
3. Locate the `[//]: # (COWORK_CALLOUTS)` marker line. If present, set `head_anchor = marker`. If absent:
   - Locate the `## Notes` heading. If present, set `head_anchor = ## Notes` (insert ABOVE this heading) and mark `fallback = true`.
   - If both are absent, set `head_anchor = end-of-file` and mark `fallback = true`. Emit Notice `cowork:patch-daily-callouts — anchor missing; appended to end of file`.
4. Group callouts by cadence_marker (per the id-prefix rule in Inputs). For each cadence_marker group:
   - Compute `h2_title = "## " + <Cadence> + " — " + engagement.label`.
   - Search for an existing H2 line matching `h2_title` in the head region (between `[//]: # (COWORK_CALLOUTS)` and `## Notes`, or entire head if fallback). The block extends from that H2 to the next H2 / `## Notes` / EOF.
   - If found, REPLACE the contiguous H2 block in place with: the H2 line + a blank line + every callout body in the group concatenated with blank-line separators.
   - If not found, INSERT a new H2 block immediately above `head_anchor`, ordered by cadence sequence (Morning → Midday → EOD → Weekly → Monthly) within the same engagement; engagements separated by blank line.
5. For each entry in `tail_blocks` (in order):
   - Locate the `## Notes` heading. If present, search BELOW `## Notes` for any existing block matching the entry's title pattern.
   - If found, REPLACE in place. If not found, append to end-of-file with one blank line of separation.
   - If `## Notes` is absent, append the tail block to end-of-file.
6. Write the modified buffer via `mcp__obsidian__patch_note` (preferred for surgical changes) or `mcp__obsidian__write_note` (full-replace fallback). Return `{ status, patched_count }` where `status = "fallback-used"` if any anchor fallback was used and `"ok"` otherwise.

## Cadence marker derivation

| callout.id prefix          | Cadence marker |
|:---------------------------|:---------------|
| `morning-briefing`         | Morning        |
| `finance`                  | Morning (nested) |
| `tripwire-red` / `tripwire-yellow` | Midday |
| `eod-review`               | EOD            |
| `weekly-review`            | Weekly         |
| `monthly-review`           | Monthly        |
| `open-threads`             | (tail block — not under any H2) |

The H2 block contains all callouts whose ids map to the same cadence marker for the dispatched engagement. Within the H2, callouts render in canonical sequence (briefing → finance → tripwires for Morning; etc.).

## Returns

```json
{ "status": "ok" | "fallback-used" | "error:<reason>", "patched_count": <int> }
```

## Errors

- Engagement not found in vault-config.md: `{ status: "error:engagement-not-found", patched_count: 0 }`.
- Read failure: `{ status: "error:read-failed", patched_count: 0 }`. Do not attempt write.
- Write failure: `{ status: "error:write-failed", patched_count: 0 }`. Caller emits Notice and decides whether to retry.
- Empty `callouts` AND empty `tail_blocks`: return `{ status: "ok", patched_count: 0 }` immediately (no-op is valid for tripwire silent runs).
- This sub-skill never raises. All failure modes return a status string.
