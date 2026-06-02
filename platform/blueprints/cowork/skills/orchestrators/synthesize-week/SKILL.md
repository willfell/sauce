---
name: cowork:synthesize-week
description: End-of-week synthesis (Tier 2). Reads the past 7 daily memory.md files for the engagement, composes a voice-applied weekly-pattern paragraph + ≤5 carry-forward bullets, and writes them to spice/cowork/memory/<engagement_id>/YYYY/MM-Month/YYYY-Www/synthesis.md. Pure synthesis — does not modify any Tier 0 (tick) or Tier 1 (daily) memory files. Phrasings = "synthesize this week's pattern", "weekly memory synthesis", "tier 2 roll-up".
schedule: Cron-driven per (engagement, week); typically Friday 17:30 (after synthesize-day's 17:20 fire so Friday's data is included in the roll-up)
scope: shared
tags: [cowork, orchestrator, synthesis, memory, weekly, background]
---

# cowork:synthesize-week

End-of-week memory synthesis (Tier 2). Fires Friday 17:30 after `cowork:synthesize-day`'s 17:20 fire (so Friday's daily memory is captured in the roll-up). Reads the past 7 daily `memory.md` files via `cowork:read-memory`. Composes a voice-applied 3-paragraph weekly-pattern + ≤5 carry-forward bullets at `spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-Www>/synthesis.md`.

Pure synthesis. Does not modify Tier 0 (tick) or Tier 1 (daily) memory files. Background-only — never touches the weekly-review atomic note. Idempotent re-fires within the same ISO week REPLACE the synthesis body while preserving `created_at` + days-covered list.

## Inputs

```json
{ "engagement_id": "<string, required>" }
```

## Pre-flight

1. **check-vault-routing** required: `["obsidian"]`. If not ready, exit silently — Tier 2 synthesis is best-effort.
2. **Resolve engagement** via `spice/cowork/context/vault-config.md` + Read engagement-type manifest at `spice/cowork/context/engagement-types/<engagement.type>.json` (canonical v0.83.0 path). If engagement not found, emit Notice `cowork:synthesize-week — engagement <engagement_id> not found in vault-config.md` and exit silently.
3. **date-context** — compute `iso_week` (e.g. `2026-W23`), `week_start_iso` (Monday 00:00), `week_end_iso` (Sunday 23:59), `<YYYY>`, `<MM-Month>` (e.g. `06-June`).
4. **read-user-preferences** — invoke `cowork:read-user-preferences` for `prefs.personality` voice contract + `effective_hard_rules[]`. If `status != "ok"`, exit silently with Notice.

## Gather

1. Invoke sub-skill `cowork:read-memory` with input:
   ```json
   { "engagement_id": "<engagement_id>", "tier": "day", "window": { "start": "<week_start_iso>", "end": "<week_end_iso>" } }
   ```
   Capture as `week_days_output`.

2. If `week_days_output.found === false` OR the count of synthesized days is 0 (no `day_synthesis` records with `synthesized: true` across the window), emit Notice `cowork:synthesize-week skipped — no synthesized memory for <engagement_id> in week <iso_week>` and exit silently. No empty syntheses.

## Decide

1. Compose `voice_contract` from `prefs.personality` + `effective_hard_rules`. Mirror morning-briefing / synthesize-day's voice-contract construction verbatim.
2. Caps:
   - `weekly_pattern` paragraph: ≤300 words (~3 paragraphs).
   - `carry_forward_bullets`: ≤5 bullets.
3. Cross-week pattern detection: identify carry-forward themes that recurred across ≥2 days. Promote those to the weekly carry-forward list; deduplicate.

## Write

1. Compose `week_synthesis_path` = `spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<iso_week>/synthesis.md` (substituting date tokens from `date-context`; `iso_week` is the ISO-week label e.g. `2026-W23`).

2. Read-or-create the file:

   **On create (first fire for this engagement+week):**
   - Frontmatter:
     ```yaml
     type: cowork-weekly-synthesis
     engagement_id: <engagement_id>
     iso_week: <iso_week>
     week_start: <YYYY-MM-DD>
     week_end: <YYYY-MM-DD>
     days_covered: <N>
     created_at: <now-ISO>
     synthesis_at: <now-ISO>
     summary: <≤300 chars voice-applied one-liner>
     ```
   - H1 title: `# Weekly memory — <iso_week> (<week_start_label> to <week_end_label>)`.
   - `> [!info]+ Weekly pattern` callout with the voice-applied weekly-pattern body (~3 paragraphs).
   - `> [!tip] Carry-forward to next week` callout with ≤5 bullets.
   - `## Days included` H2 with a bulleted list of `[[spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md|<YYYY-MM-DD> (<tick_count> ticks)]]` for each synthesized day in the window.

   **On replace (idempotent re-fire within the same ISO week):**
   - Preserve `created_at` from existing frontmatter.
   - Update `synthesis_at` to current time.
   - Update `summary`, `days_covered`, the Weekly pattern callout body, the Carry-forward callout body, and the Days included list (refresh from current week_days_output).
   - REPLACE the body sections idempotently — do NOT append duplicates. Frontmatter `type` and `iso_week` MUST NOT change.

3. Pre-write self-check: assert frontmatter has `type/engagement_id/iso_week/synthesis_at/summary/created_at/days_covered`; body has H1 + `Weekly pattern` callout + `Carry-forward` callout + `## Days included` section. On miss → `failed:contract-violation:<field>` + exit non-zero.

4. Write the file.

## Verify

1. Re-Read the file just written.
2. Invoke helper `parseSynthesisFile(rawMarkdown)` from `helpers/read-memory-helper.js` (cross-vault-relative require path).
3. Assert `engagement_id`, `iso_week`, `synthesis_at` non-null.
4. Assert `weekly_pattern` non-empty.
5. On any miss → delete the file + Notice + exit non-zero.

## Done

Empty. The orchestrator returns nothing; the file IS the side effect.

## Harness testing

HC-V0850-B1..B5 sub-asserts in `platform/test/run-cowork-smoke.js` validate the SKILL.md prose contract (existence, sections, read-memory invocation, canonical week-synthesis path, cowork-weekly-synthesis type + replace-section idempotency, `## Days included` section). Runtime behavior is validated post-deploy via Friday cron fire on consumer vaults (synthesize-week creates `spice/cowork/memory/<engagement>/YYYY/MM-Month/YYYY-Www/synthesis.md` on first fire; re-fires REPLACE the synthesis body cleanly).
