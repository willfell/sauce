---
name: cowork:synthesize-day
description: End-of-day synthesis. Reads today's memory.md (all hourly ticks) + today's atomic notes (morning-briefing, midday-tripwire, eod-review, finance) and composes a voice-applied 2-3 paragraph "Today's pattern" synthesis + a Carry-forward block of ≤3 bullets for tomorrow's morning-briefing. REPLACES the placeholder synthesis section at the top of today's memory.md; sets frontmatter `synthesized: true`, `synthesis_at: <now>`. Background memory tier 1 — does NOT write to spice/cowork/daily/, does NOT touch the daily note. Phrasings = "synthesize today's pattern", "compress today's memory", "end-of-day memory synthesis".
schedule: Cron-driven per (engagement, day); typically 15 min after the engagement's eod-review cron slot
scope: shared
tags: [cowork, orchestrator, synthesis, memory, eod, background]
---

# cowork:synthesize-day

End-of-day memory synthesis for one engagement. Fires after `cowork:eod-review` completes (typically 15 minutes later, per the engagement's cron schedule); reads today's memory file at `spice/cowork/memory/<engagement_id>/YYYY/MM-MMMM/YYYY-MM-DD/memory.md` (which `cowork:capture-tick` has been appending to all day) plus today's atomic notes at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/{morning-briefing,midday-tripwire,eod-review,finance}.md`, and composes a voice-applied "Today's pattern" synthesis paragraph + a Carry-forward block of ≤3 actionable bullets for tomorrow's morning-briefing.

The synthesis section at the top of today's memory file (between H1 and `## Ticks`) is REPLACED with the new voice-applied synthesis content. All tick callouts in the `## Ticks` section are preserved byte-identical — this orchestrator never rewrites tick data. Frontmatter `synthesized: true` + `synthesis_at: <now-ISO>` are set so morning-briefing can detect a completed synthesis. If the orchestrator fires again (re-fire or missed-slot retry), it replaces the synthesis section again from the latest available data — idempotent by design. The tick count and all tick bodies remain intact regardless of how many times synthesize-day fires.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. READ `.claude/skills/cowork/skills/check-vault-routing/SKILL.md` in full and follow
   its `## Steps` section with `{ required: ["obsidian"] }`. If the return is not `"ready"`, exit silently (synthesis is best-effort; the memory file retains its placeholder section).

2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up engagement by id. If not found, exit silently. Read the engagement-type manifest via the Read tool at `spice/cowork/context/engagement-types/<engagement.type>.json` (substitute `<engagement.type>` from the resolved engagement; expected values: `personal`, `w2-fte`, `consulting`). Parse as JSON; capture `engagement` + `render_aspects`. If the file is missing or fails to parse, emit Notice `cowork:synthesize-day aborted -- engagement-type manifest unavailable at spice/cowork/context/engagement-types/<engagement.type>.json` and exit silently.

3. READ `.claude/skills/cowork/skills/date-context/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture `context` (today, daily_path, dddd, MM-Month). If `context.error` exists, exit silently.

3b. READ `.claude/skills/cowork/skills/read-user-preferences/SKILL.md` in full and follow
   its `## Steps` section with `{}`. Capture as `prefs_result = { prefs, status, reason }`. Capture `prefs = prefs_result.prefs` (may be null when `status != "ok"`). If `status != "ok"`, exit silently with Notice `cowork:synthesize-day skipped -- user-preferences unavailable; synthesis requires voice contract`.

3c. **Compose voice_contract.** Capture `voice_contract` from `prefs.personality` and `prefs.effective_hard_rules`: if every personality field (`vibe`, `formality`, `pep_talk`, `length`, `notes`) is null/undefined AND `prefs.effective_hard_rules` is empty, `voice_contract = ""`. Otherwise compose:

   ```
   Voice contract (from spice/cowork/context/user-preferences.md):
   - Vibe: <prefs.personality.vibe or "default">
   - Formality: <prefs.personality.formality or "default">
   - Pep talk: <"yes" if prefs.personality.pep_talk else "no">
   - Length: <prefs.personality.length or "default">
   - Notes: <prefs.personality.notes verbatim, collapsed to single line>

   Apply this voice to the synthesis paragraph and carry-forward bullets. Do NOT apply to frontmatter field values.

   Hard rules (non-negotiable, apply verbatim to ALL output — narrative AND callout bodies):
   - <each entry of prefs.effective_hard_rules on its own line; omit this whole block when the list is empty>

   ---

   ```

   This step is PURE — no MCP calls, no file writes. The voice_contract is applied during the Decide phase when composing synthesis content.

## Gather

1. Compose `today_memory_path` = `spice/cowork/memory/<engagement_id>/<YYYY>/<MM-Month>/<YYYY-MM-DD>/memory.md` (substitute `<engagement_id>` from input; `<YYYY>` = `context.yyyy`, `<MM-Month>` = `context["MM-Month"]`, `<YYYY-MM-DD>` = `context.today`). Example: `spice/cowork/memory/personal/2026/06-June/2026-06-01/memory.md`.

2. Read `today_memory_path` via the Read tool. If not found, emit Notice `cowork:synthesize-day skipped -- no memory.md for <engagement_id> on <today>; tick may not have fired yet` and exit silently. Cannot synthesize a day with no ticks.

3. Parse frontmatter from the file; capture `tick_count`, `created_at`. Parse body; identify the synthesis section — everything between H1 (`# Daily memory —`) and `## Ticks` header — and capture it as `current_synthesis_md`. Identify all tick callouts in the `## Ticks` section (lines matching `^> \[!example\]-`); capture the complete `## Ticks` section content as `ticks_section_md` (from the `## Ticks` header to end-of-file, verbatim).

4. Compose paths for today's atomic notes:

   ```
   spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md
   spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md
   spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md
   spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/finance.md
   ```

   For each, Read via the Read tool; treat not-found as null. For each file that exists, strip the leading frontmatter block (YAML between `---` markers); capture the body as `<orch>_atomic_md` (or null when the file is absent). Capture as:

   ```
   today_atomic_notes = {
     morning_briefing:  <body string or null>,
     midday_tripwire:   <body string or null>,
     eod_review:        <body string or null>,
     finance:           <body string or null>
   }
   ```

## Decide

Using the full ticks content from `ticks_section_md` and each present entry in `today_atomic_notes`, compose the synthesis content. Apply `voice_contract` to all narrative output (synthesis paragraphs and carry-forward bullets).

**Pattern paragraph:** 2-3 paragraphs of voice-applied prose synthesizing the day's pattern. Derive from the tick summaries and atomic-note bodies together. Focus on PATTERN — what was the shape of the day, what stood out, what was quiet vs. active. Tick callout bold-prefix lines (`**KindTitle:** ...`) are the primary source; atomic notes add confirmatory context. Cap at approximately 3 paragraphs / 300 words total. Do NOT enumerate every kind mechanically — synthesize into a coherent narrative.

**Carry-forward bullets:** ≤3 bullets that tomorrow's morning-briefing should know. Bullets should be ACTIONABLE / CONTEXTUAL — open loops, threads needing follow-up, anticipated tomorrow-events surfaced by today's data. If nothing meaningful surfaces (day was routine, all loops closed, no pending items), write `No carry-forward — clean close.` instead of forcing bullets.

**Day-summary one-liner:** ≤200 character summary of the day's pattern, suitable for the frontmatter `summary:` field. Concise plain-prose fragment (no markdown).

Capture as:
```
synthesis_result = {
  pattern_md:      <2-3 paragraph synthesis string>,
  carry_forward_md: <bullet lines or clean-close fallback>,
  day_summary:     <≤200 char one-liner>
}
```

## Write

1. Compose `new_synthesis_section_md`:

   ```
   > [!info]- Today's pattern (synthesis)
   > <voice-applied 2-3 paragraph pattern from synthesis_result.pattern_md>

   > [!tip] Carry-forward to tomorrow's morning-briefing
   > - <bullet 1>
   > - <bullet 2>
   > - <bullet 3>
   ```

   Use only as many carry-forward bullets as meaningful content provides. If `synthesis_result.carry_forward_md` is the clean-close fallback, emit:

   ```
   > [!tip] Carry-forward to tomorrow's morning-briefing
   > No carry-forward — clean close.
   ```

2. **Re-read before write.** Read `today_memory_path` again via the Read tool (re-read — the file may have been appended to by another tick fire between Gather and Write). Re-parse frontmatter and body. Capture the re-read version as the authoritative source for tick preservation:
   - `latest_tick_count` = frontmatter `tick_count` from re-read (may be higher than original Gather read)
   - `latest_last_tick_at` = frontmatter `last_tick_at` from re-read
   - `latest_ticks_section_md` = full `## Ticks` section from re-read (verbatim, to the end of file)

3. **Compose updated frontmatter.** Start from the re-read frontmatter. Set:
   - `synthesized: true`
   - `synthesis_at: <now-ISO>` (ISO-8601 with timezone offset)
   - `summary: <synthesis_result.day_summary>`
   Preserve all other frontmatter fields verbatim (especially `tick_count`, `last_tick_at`, `created_at`, `engagement_id`, `day`, `type`).

4. **Compose full file content:**

   ```
   ---
   <updated frontmatter block>
   ---

   # Daily memory — <context.dddd>, <month_name> <D>, <YYYY>

   <new_synthesis_section_md>

   <latest_ticks_section_md>
   ```

   Where `<D>` is the integer day with no leading zero, `<YYYY>` is the 4-digit year, `<month_name>` is the full English month name (from `context["MM-Month"].split("-")[1]`).

   The H1 title is re-composed from context (it matches what capture-tick originally wrote). The `<latest_ticks_section_md>` is preserved byte-identical from the re-read — no tick callouts are modified.

**Pre-write self-check.** Before calling the Write tool, enumerate that the composed file content has ALL of:
- Frontmatter: `synthesized: true` set.
- Frontmatter: `synthesis_at` set to a non-empty ISO string.
- Body H1: `# Daily memory —` (regex: `/^# Daily memory —/m`).
- `[!info]- Today's pattern (synthesis)` callout with non-empty body (regex: `/^> \[!info\]- Today's pattern \(synthesis\)/m`; body line count ≥ 1).
- `[!tip] Carry-forward to tomorrow's morning-briefing` callout with non-empty body (regex: `/^> \[!tip\] Carry-forward/m`; body line count ≥ 1).
- `## Ticks` header (regex: `/^## Ticks/m`).
- At least `latest_tick_count` `[!example]-` tick callouts (count of `/^> \[!example\]-/gm` matches ≥ `latest_tick_count`).

On any miss: return `failed:contract-violation:<field>` + emit Notice `cowork:synthesize-day aborted -- contract-violation: <field>` + exit non-zero. Do NOT call Write.

5. Write the full file content to `today_memory_path` via the Write tool.

6. **v0.95.1 Knob 2 — post-write frame-drift capture (gated).** AFTER the successful Write in Step 5 AND BEFORE `## Verify`, conditionally invoke `cowork:capture-frame-drift`:

   a. Check `plan.tripwire_aspects`. When the array does NOT include `"frame_drift"`, skip this step silently. Continue to `## Verify`.

   b. When `plan.tripwire_aspects.includes("frame_drift")`, READ the `cowork:capture-frame-drift` sub-skill and follow its `## Steps` with:

      ```json
      {
        "engagement_id":      "<from vault-config.md>",
        "tripwire_aspects":   <plan.tripwire_aspects>,
        "voice_contract":     "<plan.voice_contract>",
        "today_memory_path":  "<today_memory_path resolved in pre-flight>",
        "today_date":         "<context.today>"
      }
      ```

      The sub-skill self-gates on <5-syntheses availability (returns `skipped:insufficient-history`) and is responsible for its own LLM call to `claude-haiku-4-5-20251001` (design § 4.3). It writes the `[!warning]- Frame may be stuck` callout directly into today's `memory.md` between the `[!tip] Carry-forward` callout and the `## Ticks` section, and additively sets frontmatter `frame_drift_flagged: true` + `frame_drift_at: <ISO>`.

   c. **Non-fatal contract.** ANY non-zero / error return from the sub-skill MUST be treated as non-fatal: synthesize-day continues to `## Verify` regardless. The sub-skill itself appends a `warnings:` frontmatter entry on today's memory.md per design § 4.7 — synthesize-day's own contract guards (frontmatter `synthesized: true`, body H1, callout presence, `## Ticks`, tick count) all still apply unchanged in `## Verify` since the sub-skill only ADDS to body + frontmatter, never replaces.

   d. Capture the sub-skill's return value as `drift_result` for the Done section diagnostics.

7. **v0.96.0 Rail L — post-write learn-from-checks (gated).** AFTER Step 6 AND BEFORE `## Verify`, conditionally invoke `cowork:learn-from-checks`. This step is the final atomic-state mutation of the orchestrator — it updates per-engagement `learned_weights:` in `user-preferences.md` from yesterday's ticked rating callouts so tomorrow's morning-briefing dispatch reflects observed preference signal.

   a. **Gate.** When `engagement.learning_enabled === false`, skip this step silently. Continue to `## Verify`. (Default behavior — `learning_enabled` unset / `true` — runs the sub-skill.)

   b. READ `.claude/skills/cowork/skills/learn-from-checks/SKILL.md` in full and follow its `## Steps` section with:

      ```json
      {
        "engagement_id": "<from vault-config.md>",
        "yesterday":     "<context.yesterday from date-context>",
        "vault_root":    "<absolute vault root from check-vault-routing>"
      }
      ```

      The sub-skill is pure data — no MCP calls, no LLM call. It scans `<vault_root>/spice/cowork/daily/<YYYY>/<MM-Month>/<yesterday>/` for rating-tick atomic notes, aggregates per-kind ticks/skips, applies `updateWeights` + `evaluateWarmup` from `helpers/learn-from-checks-helper.js`, and writes `learned_weights:` back to `spice/cowork/context/user-preferences.md` frontmatter. Idempotent on same-day re-fire via `totals.scanned_days[]` (per HC-V0960-L-18).

   c. **Lazy-init mitigation (S0.5 plan revision).** On the first post-v0.96.0-upgrade fire against an existing vault, `user-preferences.md` has NO `learned_weights:` section (the installer's `materialize_once` policy skipped the file). The sub-skill detects this in its Step 3 and constructs the skeleton in-memory before scanning. First-fire result includes `lazy_initialized: true`. No caller action required.

   d. **Non-fatal contract.** ANY `status` starting with `"failed:"` from the sub-skill MUST be treated as non-fatal: emit Notice `cowork:synthesize-day learn-from-checks step skipped -- <result.status>` and continue to `## Verify`. `learned_weights:` stays at its prior on-disk state; synthesize-day's own contract guards in `## Verify` (synthesized: true, body H1, callouts, ## Ticks, tick count) are independent of this step.

   e. Capture the sub-skill's return value as `learn_result` for the Done section diagnostics.

## Verify

After a successful Write:

a. Read the just-written file at `today_memory_path` via the Read tool.

b. Parse leading frontmatter (YAML between `---` markers) as `parsed_frontmatter`; capture the remainder as `body`.

c. Assert required frontmatter fields:
   - `synthesized` equals `true` (boolean)
   - `synthesis_at` is a non-empty string (ISO-8601 format)
   - `tick_count` is a number ≥ 1
   - `last_tick_at` is a non-empty string
   - `engagement_id` is a non-empty string
   - `day` matches regex `^\d{4}-\d{2}-\d{2}$`

d. Parse `body`; assert structural markers:
   - H1 present: `/^# Daily memory —/m`
   - `[!info]- Today's pattern (synthesis)` callout: `/^> \[!info\]- Today's pattern \(synthesis\)/m`
   - `[!tip] Carry-forward` callout: `/^> \[!tip\] Carry-forward/m`
   - `## Ticks` header: `/^## Ticks/m`
   - **Tick data preservation contract:** count of `/^> \[!example\]-/gm` matches in `body` equals `parsed_frontmatter.tick_count`. This is the primary guard that tick data was not lost during the synthesis section replacement.

e. Assert `[!info]- Today's pattern (synthesis)` callout body is non-empty and does NOT contain the placeholder text `Synthesis pending` — confirming real synthesis content replaced the placeholder.

f. Assert `[!tip] Carry-forward` callout body is non-empty and does NOT contain the placeholder text `Pending synthesis`.

g. On any miss: emit Notice `cowork:synthesize-day aborted -- contract-violation: <field>` + exit non-zero. Do NOT delete the file — synthesis failure should leave the existing memory file intact for next attempt. The placeholder synthesis section remains accessible; the next synthesize-day fire will retry from fresh data.

h. On all-pass: continue to Done.

## Done

## Harness testing

S1 HC-V0840-B1..B3 sub-asserts in `run-cowork-smoke.js` validate this SKILL.md's prose contract (presence at canonical dest, required sections, canonical memory path + synthesis section reference + `spice/cowork/daily/` atomic-note discovery reference). Runtime behavior is validated post-deploy by firing synthesize-day on a day that has accumulated ≥1 tick — the placeholder synthesis section at the top of memory.md should be replaced with real voice-applied content while ALL tick callouts remain byte-identical. Verify by diffing the `## Ticks` section before and after synthesize-day fires: zero changes expected. Verify frontmatter `synthesized: true` + `synthesis_at` is set. Verify the `[!info]-` callout body does not contain "Synthesis pending".
