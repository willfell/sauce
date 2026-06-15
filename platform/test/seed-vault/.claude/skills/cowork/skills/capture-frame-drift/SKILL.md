---
name: cowork:capture-frame-drift
description: Background tripwire that fires post-synthesize-day. Reads the last 5 day-syntheses + last 3 days of MB/midday/EOD atomic notes, makes ONE LLM call to claude-haiku-4-5-20251001 to extract themes, evaluates three deterministic drift rules (frame_repeat, subject_dominance, explicit_null), and — if any flag fires — appends a `[!warning]- Frame may be stuck` callout to TODAY's memory.md between the synthesis and `## Ticks` sections. Tomorrow's morning-briefing picks it up via the read-memory `drift_warning` extension. Gated by `plan.tripwire_aspects.includes("frame_drift")`. NON-FATAL: any failure (LLM error, file race, malformed JSON) emits a `warnings:` frontmatter entry but never blocks the parent orchestrator.
scope: shared
tags: [cowork, sub-skill, tripwire, frame-drift, anti-echo, v0.95.1]
---

# cowork:capture-frame-drift

Knob 2 (background tripwire) implementation. Breaks the cowork memory echo loop by detecting when the daily-synthesis frame has been thematically locked for ≥4 of the last 5 days, when the same top-subject has dominated ≥3 of 5 days, or when Knob 1's anti-echo callout has explicitly emitted "today's gather largely continued yesterday's threads" for 3 consecutive days. When any of these fires, raises a visible drift warning in TODAY's `memory.md` that propagates into tomorrow's morning-briefing via the read-memory sub-skill.

Cost surface: one `claude-haiku-4-5-20251001` call per fire per engagement (~$0.0014/fire → ~$0.50/year at daily firing). Negligible.

Design: `Docs/plans/2026-06-08-v0.95.1-anti-echo-design.md` § 4.

## Inputs

```json
{
  "engagement_id": "<string, required>",
  "tripwire_aspects": ["<string>", ...],
  "voice_contract": "<string from cowork:plan-dispatch, may be empty>",
  "today_memory_path": "<absolute path to today's memory.md>",
  "today_date": "<YYYY-MM-DD>"
}
```

Caller (synthesize-day post-step) MUST resolve `engagement_id` from `vault-config.md` and `today_memory_path` from `date-context` before invoking. `tripwire_aspects` comes from the plan-dispatch contract.

## Pre-flight

1. **Gate on `tripwire_aspects.includes("frame_drift")`.** When absent, exit silently with status `skipped:not-opted-in`. NO file reads, NO LLM call.

2. **Locate the 5 most-recent memory.md syntheses with non-null `synthesis_paragraph` AND a non-null `carry_forward_bullets` list.** Walk backward day-by-day from `today_date - 1` up to 14 calendar days. Stop when 5 synthesized days have been collected OR the walk exhausts the window. Use `mcp__obsidian__get_file_contents` (or `Read` outside the MCP-routed surface). Skip days where `memory.md` does not exist OR `synthesized: false`.

3. **<5-syntheses gate.** When fewer than 5 syntheses are gathered, exit silently with status `skipped:insufficient-history`. NO LLM call. (Design § 4.7.)

4. **Locate the last 3 days of MB / midday-tripwire / EOD atomic notes.** Walk backward day-by-day from `today_date - 1`. Read each day's `spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/` folder; collect any file whose `type:` frontmatter is one of `cowork-morning-briefing`, `cowork-midday-tripwire`, `cowork-eod-review`. Read the body markdown. Continue until 3 calendar days have been visited (notes may be 0..many per day). These feed the `explicit_null` evaluator.

## Gather

5. **Make ONE LLM call (claude-haiku-4-5-20251001) to extract themes.** Use the canonical prompt:

   > For each day below, extract: (1) 1-3 dominant themes (2-4 words each), (2) the single most-named subject (person, project, or topic).
   > Return JSON array: `[{"day":"YYYY-MM-DD","themes":["string"],"top_subject":"string"}]`. One object per day, in the SAME order I provide them.

   Input payload per day: the `synthesis_paragraph` + `carry_forward_bullets` joined with newlines. Total prompt size ~750 input tokens for 5 days. Output ~200 tokens.

6. **Capture the JSON string verbatim.** Pass it to `extractThemes(syntheses, { mockResponse: <JSON string> })` from `helpers/capture-frame-drift-helper.js`. The helper parses + validates the shape. On any throw, fall through to the non-fatal warnings path (Step 11).

## Decide

7. **Evaluate drift.** Invoke `evaluateDrift({ themes, atomicNotes, tripwire_aspects })` from the helper. Capture the `DriftReport`:

   ```json
   {
     "frame_repeat":      <boolean>,
     "subject_dominance": <boolean>,
     "explicit_null":     <boolean>,
     "details": { ... }
   }
   ```

   The helper is deterministic; no LLM call here.

8. **Branch on flags.** When ALL three flags are `false`, exit silently with status `ok:no-drift`. No memory.md write, no frontmatter mutation.

9. **Compose the callout.** When ANY flag is `true`, invoke `composeDriftCallout(report, voice_contract)` from the helper. Capture the canonical `> [!warning]- Frame may be stuck` markdown block.

## Write

10. **Append the callout + update frontmatter — TODAY's memory.md.**

    a. Re-read `today_memory_path` (the file was just written by synthesize-day's Write step). Parse leading frontmatter as `parsed_frontmatter`; capture remainder as `body`.

    b. Locate the `## Ticks` header in body. The callout MUST be inserted BETWEEN the `> [!tip] Carry-forward` callout and `## Ticks` header per design § 4.5. Compose the updated body:

       ```
       <body up to + including the [!tip] Carry-forward callout>

       <composeDriftCallout output>

       ## Ticks
       <rest of body verbatim>
       ```

    c. Update frontmatter ADDITIVELY:
       - `frame_drift_flagged: true`
       - `frame_drift_at: <ISO-8601 with timezone offset>`

       Preserve ALL other frontmatter fields verbatim (synthesized, synthesis_at, tick_count, last_tick_at, type, engagement_id, day, summary, created_at).

    d. **Pre-write self-check.** Verify the composed file content has:
       - Frontmatter: `frame_drift_flagged: true`
       - Frontmatter: `frame_drift_at:` non-empty ISO string
       - Body: `> [!warning]- Frame may be stuck` callout present (regex: `/^> \[!warning\]-\s+Frame may be stuck/m`)
       - Body: `## Ticks` header preserved (regex: `/^## Ticks/m`)
       - Body: existing `[!info]- Today's pattern` + `[!tip] Carry-forward` callouts preserved verbatim

       On any miss: skip the write, fall through to Step 11.

    e. Write the full file content back via the Write tool.

## Verify

After a successful Write:

a. Read the just-written file at `today_memory_path` via the Read tool.

b. Confirm:
   - Frontmatter `frame_drift_flagged == true`
   - Frontmatter `frame_drift_at` matches the ISO timestamp written in Step 10c
   - Body contains the canonical `[!warning]- Frame may be stuck` callout
   - `## Ticks` section preserved byte-identical

Return status `ok:drift-flagged` + the DriftReport.

## Failure modes (non-fatal — never throws to caller)

11. **Non-fatal warnings path.** ANY failure in Steps 5-10 (LLM error, JSON parse failure, file race, write rejection) MUST be captured as a structured warning. Emit a frontmatter `warnings:` array entry on today's memory.md (additive — preserve any existing warnings):

    ```yaml
    warnings:
      - source: cowork:capture-frame-drift
        at: <ISO>
        reason: <short token, e.g. llm-timeout | json-parse | write-race>
        detail: <one-line human-readable>
    ```

    Return status `skipped:non-fatal-error` + the reason token. Do NOT crash the parent synthesize-day orchestrator.

12. **<5-syntheses + tripwire-not-opted-in are SILENT** (return status `skipped:...` with no warnings frontmatter entry). They are expected paths, not errors.

## Done

Return the structured result:

```json
{
  "status": "ok:no-drift | ok:drift-flagged | skipped:not-opted-in | skipped:insufficient-history | skipped:non-fatal-error",
  "drift_report": <DriftReport | null>,
  "memory_path": "<absolute path to today's memory.md>",
  "reason": "<short token, set when status is skipped:non-fatal-error>"
}
```

## Harness testing

HC-V0951-K2-A..K2-K sub-asserts in `platform/test/run-helper-cases.js` validate:

- K2-A: SKILL.md + helper exist + are registered in `manifest.json` `claude_surface[]` / `files[]`.
- K2-B: `evaluateDrift` returns no-flag report when `tripwire_aspects` excludes `"frame_drift"`.
- K2-C: `evaluateDrift` returns no-flag report when themes count <5 (insufficient history).
- K2-D: `extractThemes(syntheses, { mockResponse })` parses + validates ThemeBundle[] shape.
- K2-E / K2-F / K2-G: each drift flag fires independently for its canonical fixture.
- K2-H: `composeDriftCallout` returns markdown matching canonical regex `^> \[!warning\]-\s+Frame may be stuck\n> `.
- K2-I: synthesize-day SKILL.md invokes this sub-skill post-write, gated by `tripwire_aspects`, non-fatal on failure, writes to today's memory.md.
- K2-J: read-memory SKILL.md extracts the `[!warning]- Frame may be stuck` callout into `drift_warning`.
- K2-K: morning-briefing SKILL.md injects `yesterdayMemory.drift_warning` into the Yesterday-at-a-glance callout when non-null.

Runtime LLM call is mocked in K2-D via the `mockResponse` channel — no real API tokens burned during tests.
