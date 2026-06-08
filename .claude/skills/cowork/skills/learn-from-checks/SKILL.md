---
name: cowork:learn-from-checks
description: Scans yesterday's atomic notes for ticked rating callouts, updates per-engagement per-kind learned weights in user-preferences.md frontmatter. Pure data — no MCP calls, no LLM call. Lazy-initializes the learned_weights frontmatter section on first post-v0.96.0-upgrade fire so existing pre-v0.96.0 user-preferences.md files (which the installer's materialize_once policy preserves verbatim) participate in Rail L from their next synthesize-day cycle forward.
schedule: Invoked by cowork:synthesize-day as a final post-step (NOT cron-scheduled directly).
scope: shared
tags: [cowork, sub-skill, learning, state, rail-l, v0.96.0]
---

# cowork:learn-from-checks

> [!info]+ Rail L preference learning (v0.96.0)
> Pure data operation. Scans yesterday's `.md` + `.cowork.json` pairs under `spice/cowork/daily/<YYYY>/<MM-Month>/<yesterday>/`, parses rating-block sentinels, aggregates per-kind ticks/skips, applies `updateWeights` + `evaluateWarmup` from `helpers/learn-from-checks-helper.js`, writes `learned_weights:` back to `spice/cowork/context/user-preferences.md` frontmatter. Same-day re-fire is idempotent via `totals.scanned_days[]`.

## Inputs

```
{
  engagement_id: string,   // required
  yesterday:     string,   // YYYY-MM-DD; required
  vault_root:    string    // required — absolute path to the consumer vault root
}
```

Caller (synthesize-day post-step) MUST resolve `engagement_id` from `vault-config.md`, `yesterday` from `date-context.context.yesterday`, and `vault_root` from check-vault-routing before invoking.

## Steps

1. **Resolve atomic-note directory.** Derive the four-segment date: `YYYY` = first 4 chars of `yesterday`; `MM` = chars 5-6; `<MM-Month>` = `<MM>-<full English month name>` (e.g. `06-June`). Compose `atomic_notes_dir` = `<vault_root>/spice/cowork/daily/<YYYY>/<MM-Month>/<yesterday>/`. If the directory does not exist, return `{ status: "ok", kinds_updated: [], warnings: [], notes_scanned: 0, lazy_initialized: false }` — no observations to learn from.

2. **Read user-preferences.md frontmatter.** Compose `prefs_path` = `<vault_root>/spice/cowork/context/user-preferences.md`. Read the file via the Read tool. Parse the leading YAML frontmatter (between `---` markers); capture as `prefs_fm`. Capture the post-frontmatter body verbatim as `prefs_body` for later re-write.

3. **LAZY-INIT (v0.96.0 S0.5 mitigation).** If `prefs_fm.learned_weights` is absent / null / undefined (existing pre-v0.96.0 user-preferences.md file — the installer's `materialize_once` policy never touches existing files), construct the skeleton in-memory:

   ```yaml
   learned_weights:
     schema_version: "1.0.0"
     engagement_id: <input.engagement_id>
     per_kind: {}
     totals:
       notes_scanned: 0
       notes_with_any_tick: 0
       warmup_until: "<today + 7 days, ISO-8601 date>"
       upgrade_notice_emitted: false
       scanned_days: []
       zero_tick_streak: 0
   ```

   Set `lazy_initialized = true`. Treat this skeleton as the initial `learned_weights` state for the rest of this fire. (The first real write of `learned_weights:` to disk happens in Step 12.)

4. **Engagement-mismatch guard.** When `learned_weights:` was present (not lazy-init path), verify `learned_weights.engagement_id == input.engagement_id`. If not, abort with `status: "failed:contract-violation:engagement-mismatch"`. Do not mutate state.

5. **Same-day idempotency check.** If `learned_weights.totals.scanned_days[]` already includes `yesterday`, return `{ status: "ok", kinds_updated: [], warnings: [], notes_scanned: 0, lazy_initialized: false, idempotent_skip: true }`. Same-day re-fire is a no-op — observations from already-scanned notes do NOT double-count. This is the canonical idempotency contract for Rail L (per HC-V0960-L-18).

6. **Scan atomic notes.** Invoke `scanAtomicNotes({ dir: atomic_notes_dir, engagement_id: input.engagement_id })` from `helpers/learn-from-checks-helper.js`. Capture `{ observations, notes_scanned, notes_with_any_tick }`. The helper gracefully handles pre-cycle .md files without sidecars (counts aggregate per-kind ticks; filters by `.cowork.json` sidecar `engagement_id` only when present).

7. **Update per-kind weights.** Invoke `updateWeights(learned_weights.per_kind, observations)`. Capture the returned object as `next_per_kind`.

8. **Compute warmup elapsed.** Parse `learned_weights.totals.warmup_until` as an ISO date; subtract 7 days to recover the original warmup start. Compute `days_since_first` = (today − warmup_start) in whole days. (On lazy-init path, `days_since_first` = 0.)

9. **Evaluate warmup graduation.** Invoke `evaluateWarmup(next_per_kind, days_since_first)`. Capture the returned object as `graduated_per_kind`. Per-kind cells whose `warmup` flag was true and now meet the graduation predicate transition to `warmup: false`.

10. **Update totals.** Mutate `learned_weights`:
    - `per_kind = graduated_per_kind`
    - `totals.notes_scanned += notes_scanned`
    - `totals.notes_with_any_tick += notes_with_any_tick`
    - `totals.scanned_days` — push `yesterday` if not already present (dedup-aware).
    - `totals.zero_tick_streak`: if `notes_scanned > 0 && notes_with_any_tick == 0`, increment by 1; else reset to 0.

11. **Anomaly detection.** If `learned_weights.totals.zero_tick_streak >= 5` post-update, append the string `"Rail L: 5 consecutive days with notes but zero ticks — preference learning may be stalled"` to today's `memory.md` frontmatter `warnings:` array (read-modify-write the today-memory file path `<vault_root>/spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<today>/memory.md`; create `warnings: []` if absent; preserve all other frontmatter keys verbatim). Also append this string to the local `warnings: []` return field.

12. **Write user-preferences.md back.** Compose the updated frontmatter: start from the original `prefs_fm`, replace (or insert, on lazy-init path) the `learned_weights:` key with the mutated object. PRESERVE all other top-level keys verbatim (`priorities`, `personality`, `mcps`, any user-added keys). Re-compose the full file content as `---\n<updated YAML>\n---\n<prefs_body>` and Write it to `prefs_path` via the Write tool. On lazy-init path, this is the FIRST write of `learned_weights:` to disk for this consumer vault.

## Return

```
{
  status:           "ok" | "failed:<reason>",
  kinds_updated:    string[],           // kinds whose per_kind cell mutated this fire
  warnings:         string[],           // anomaly warnings emitted this fire
  notes_scanned:    number,             // from scanAtomicNotes
  lazy_initialized: boolean,            // true iff Step 3 constructed the skeleton
  idempotent_skip?: boolean             // true iff Step 5 short-circuited
}
```

## Idempotency

Re-fire same-day is safe: Step 5 short-circuits when `yesterday` is already in `totals.scanned_days[]`. The entire run returns `idempotent_skip: true` with zero state mutation — observations from already-scanned notes never double-count. This is the canonical idempotency contract for v0.96.0 Rail L (validated by HC-V0960-L-18: SKILL.md presence + `totals.scanned_days[]` documentation).

## Failure modes

- **Pre-cycle .md without sidecar (`.cowork.json`)**: `scanAtomicNotes` gracefully degrades — counts per-kind aggregate ticks via the rating callout, ignores sidecar-only signal. Rail L MVP does not use item-level features yet, so this is non-blocking.
- **Rating block missing in atomic note**: the helper's `parseRatingCallout` returns null; that note is silently skipped (does NOT contribute to `notes_scanned`). Next compose-body re-fire of that orchestrator's note will regenerate the rating block correctly.
- **User hand-edits `learned_weights:` between fires**: honored. `updateWeights` only mutates kind cells observed this fire; manual overrides on un-observed kinds are preserved via the per-kind merge semantics in the helper.
- **engagement-mismatch (Step 4)**: aborts with `failed:contract-violation:engagement-mismatch`. Caller (synthesize-day) treats this as non-fatal per its contract — synthesis still completes; only learning is skipped.
- **vault_root not writable / prefs file missing**: Step 2 Read fails; the sub-skill returns `failed:contract-violation:user-preferences-unavailable`. Non-fatal at the caller.

## Performance

Pure data — no MCP calls, no LLM call. Bounded by atomic-note count per day (typically <10 per engagement). Typical fire <50ms; worst case (50 notes, large `learned_weights` history) <200ms. Negligible vs. synthesize-day's own LLM-bound steps.

## Harness testing

HC-V0960-L-18 in `platform/test/run-helper-cases.js` validates SKILL.md presence at the canonical workshop path AND that `totals.scanned_days[]` is documented as the idempotency mechanism (string-match on either `totals.scanned_days` or `scanned_days[]`). Runtime behavior is validated post-deploy by firing synthesize-day on a day with accumulated rating-tick atomic notes and inspecting `user-preferences.md` frontmatter for the materialized `learned_weights:` section + verifying same-day re-fire produces zero diff to that section.
