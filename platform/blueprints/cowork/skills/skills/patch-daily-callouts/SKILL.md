---
name: cowork:patch-daily-callouts
description: Patch callout blocks into a daily note at COWORK_CALLOUTS anchor; fallback to ## Notes on marker absence.
inputs:
  daily_path: string
  callouts: list[object]
  tail_blocks: list[object]
outputs:
  status: string
  patched_count: int
tags: [cowork, write]
---

# cowork:patch-daily-callouts

FAT mutation skill that owns all daily-note callout writes for cowork orchestrators. Reads the daily note, locates the `<!-- COWORK_CALLOUTS -->` anchor, and replaces or inserts each provided callout idempotently. Tail blocks (e.g., Open Threads) go below `## Notes`. Orchestrators MUST NOT call `mcp__obsidian__patch_note` directly - every daily-note write routes through this sub-skill.

## Inputs

- `daily_path` (string, required): vault-relative path to today's (or target) daily note. Caller computes via `cowork:date-context.daily_path`.
- `callouts` (list[object], required): ordered list of callout blocks to patch ABOVE the `<!-- COWORK_CALLOUTS -->` marker. Each entry is `{ id: string, body: string }` where:
  - `id` - short stable identifier used for idempotent replace-by-title (e.g., `"morning-briefing"`, `"finance"`, `"eod-review"`, `"weekly-review"`, `"monthly-review"`, `"tripwire-red"`, `"tripwire-yellow"`).
  - `body` - the full multi-line callout markdown, every line `> `-prefixed, no trailing blank line.
- `tail_blocks` (list[object], optional): callout blocks that go AFTER the `## Notes` heading (e.g., `{ id: "open-threads", body: "..." }`). Same shape as `callouts`. Empty list means no tail mutation.

## Outputs

- `status` (string): one of `"ok"`, `"fallback-used"` (marker absent - inserted before `## Notes` or appended), `"error:<reason>"`.
- `patched_count` (int): number of callouts successfully written (head + tail combined).

## Steps

1. Read the daily note via `mcp__obsidian__read_note` at `daily_path`. On read failure, return `{ status: "error:read-failed", patched_count: 0 }`.
2. Locate the `<!-- COWORK_CALLOUTS -->` marker line. If present, set `head_anchor = marker`. If absent:
   - Locate the `## Notes` heading. If present, set `head_anchor = ## Notes` (insert ABOVE this heading) and mark `fallback = true`.
   - If both are absent, set `head_anchor = end-of-file` and mark `fallback = true`. Emit Notice `cowork:patch-daily-callouts - anchor missing; appended to end of file`.
3. For each entry in `callouts` (in order):
   - Compute the callout's first-line title pattern from `body` (the first `> [!type]<+|->` line).
   - Search for any existing block in the file matching that title in the head region (above `<!-- COWORK_CALLOUTS -->` if marker present; entire file if fallback). An existing block is the contiguous run of `> `-prefixed lines starting with the matching title.
   - If found, REPLACE the contiguous block in place.
   - If not found, INSERT immediately above `head_anchor`, separated from the previous content by exactly one blank line.
4. For each entry in `tail_blocks` (in order):
   - Locate the `## Notes` heading. If present, search BELOW `## Notes` for any existing block matching the entry's title pattern.
   - If found, REPLACE in place. If not found, append to end-of-file with one blank line of separation.
   - If `## Notes` is absent, append the tail block to end-of-file.
5. Write the modified buffer via `mcp__obsidian__patch_note` (preferred for surgical changes) or `mcp__obsidian__write_note` (full-replace fallback). Return `{ status, patched_count }` where `status = "fallback-used"` if any anchor fallback was used and `"ok"` otherwise.

## Returns

```json
{ "status": "ok" | "fallback-used" | "error:<reason>", "patched_count": <int> }
```

## Errors

- Read failure: `{ status: "error:read-failed", patched_count: 0 }`. Do not attempt write.
- Write failure: `{ status: "error:write-failed", patched_count: 0 }`. Caller emits Notice and decides whether to retry.
- Empty `callouts` AND empty `tail_blocks`: return `{ status: "ok", patched_count: 0 }` immediately (no-op is valid for tripwire silent runs).
- This sub-skill never raises. All failure modes return a status string.
