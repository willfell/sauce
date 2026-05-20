---
name: cowork:midday-tripwire
description: Engagement-aware midday CC tripwire. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md per scheduled invocation when severity == yellow or red; frontmatter `type: cowork-midday-tripwire` + `severity:`. Silent (no note written) when severity == green. Personal-engagement only (gated by render_aspects.finance_block). Body composed from gather outputs interpolated through the user's prompt body at spice/cowork/prompts/midday-tripwire.md. Phrasings = "midday tripwire for <engagement>", "<engagement> midday check", "midday cc check".
schedule: Cron-driven per enabled (engagement, midday) pair (typically only personal-type engagements enable midday)
scope: shared
tags: [cowork, orchestrator, midday, finance, engagement-aware]
---

# cowork:midday-tripwire

Real-time mid-day check for credit-card charges that violate the active payoff plan, scoped to a single engagement. Pulls today's CC transactions for the engagement's finance scope, classifies each as RED (locked-card charge), YELLOW (active-card discretionary >= threshold), or GREEN. Writes ONLY when at least one RED or YELLOW exists — when severity is green, NO atomic note is written (presence of a tripwire note = something to flag). When a write fires, the note lands at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md` (deterministic path per `(orchestrator, day)`; re-run replaces).

Skipped (early-exit silently) for engagements whose `render_aspects.finance_block != "include"`.

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, exit silently.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Load engagement-type manifest; capture `render_aspects`. If `render_aspects.finance_block != "include"`, exit silently (engagement doesn't track finance — tripwire is a no-op).
3. Use Skill `cowork:date-context` with `{}`. If `context.error`, exit silently.
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

5. Use Skill `cowork:gather-finance-cc-today` with `{ engagement_id, date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: engagement.cc_active_cards, locked: engagement.cc_locked_cards, ignore: engagement.cc_ignored_cards } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }`.
6. (Dedupe is implicit in the v0.65.0 atomic-note contract — the deterministic path `spice/cowork/daily/.../YYYY-MM-DD/midday-tripwire.md` is overwrite-last-write-wins, so each fire produces a fresh snapshot of currently-flagged charges. No per-run state read needed; `step 5.charges` is used as-is.)

## Decide

7. Partition `step 5.charges` into `red_charges` (severity == RED) and `yellow_charges` (severity == YELLOW). If both empty: exit silently. Do NOT write a "nothing flagged" run-note (atomic-note absence = green; presence = something to flag).

## Write

8. **Determine severity.** From threshold-eval gather outputs (existing earlier steps), set `severity = "red" | "yellow"` per the existing branching logic. If severity is "green" (no flags), emit Notice `cowork:midday-tripwire green -- nothing to flag` and exit cleanly. Do NOT write a run-note for green.
9. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/midday-tripwire.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
10. **Compose run-note body** per `prompt_body` + the flagged-event details from the gather steps. When prompt is empty, `warning = "empty_prompt"` and `run_body` is a terse literal summarizing the flagged events. Otherwise `warning = null`.
11. Use Skill `cowork:write-run-note-midday-tripwire` with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], severity, body: run_body, prompt_source: "spice/cowork/prompts/midday-tripwire.md", warning }`. Capture `status`. If `status` starts with `"failed:"`, emit Notice `cowork:midday-tripwire aborted -- write failed: <status>` and exit.

## Done
