---
name: cowork:midday-tripwire
description: Engagement-aware midday CC tripwire. Writes one atomic note at spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md per scheduled invocation when severity == yellow or red; frontmatter `type: cowork-midday-tripwire` + `severity:`. Silent (no note written) when severity == green. Engagement-aware — fires when engagement.tripwire_aspects is non-empty (personal=cc, w2-fte=calendar/queue, consulting=all). Severity = warn|alert. Body composed from gather outputs interpolated through the user's prompt body at spice/cowork/prompts/midday-tripwire.md. Phrasings = "midday tripwire for <engagement>", "<engagement> midday check", "midday cc check".
schedule: Cron-driven per enabled (engagement, midday) pair (typically only personal-type engagements enable midday)
scope: shared
tags: [cowork, orchestrator, midday, finance, engagement-aware]
---

# cowork:midday-tripwire

Real-time mid-day check for credit-card charges that violate the active payoff plan, scoped to a single engagement. Pulls today's CC transactions for the engagement's finance scope, classifies each as RED (locked-card charge), YELLOW (active-card discretionary >= threshold), or GREEN. Writes ONLY when at least one RED or YELLOW exists — when severity is green, NO atomic note is written (presence of a tripwire note = something to flag). When a write fires, the note lands at `spice/cowork/daily/YYYY/MM-MMMM/YYYY-MM-DD/midday-tripwire.md` (deterministic path per `(orchestrator, day)`; re-run replaces).

Skipped (early-exit silently) for engagements whose `tripwire_aspects` is empty (field absent or `[]`).

This orchestrator NEVER patches the daily note's callouts, edits the daily-note template, or writes to legacy paths. The v0.65.0 atomic-note write contract is the only output surface.

## Inputs

```
{
  engagement_id: string   // required
}
```

## Pre-flight

1. Use Skill `cowork:check-vault-routing` with `{ required: ["obsidian"] }`. If not `"ready"`, exit silently.
2. **Resolve engagement.** Read `<vault>/spice/cowork/context/vault-config.md`; look up `engagement` by id. If not found, exit silently. Load engagement-type manifest; capture `render_aspects` AND `tripwire_aspects` (defaults to `[]` when field absent). If `tripwire_aspects.length == 0`, exit silently (engagement has no tripwire signals — tripwire is a no-op).
3. Use Skill `cowork:date-context` with `{}`. If `context.error`, exit silently.
4. Use Skill `cowork:ensure-daily-note` with `{ date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], path: context.daily_path }`.

## Gather

Each gather call passes `engagement_id`. The orchestrator branches per-aspect from `engagement.tripwire_aspects`.

5. If `"cc_drift"` in `tripwire_aspects`: use Skill `cowork:gather-finance-cc-today` with `{ engagement_id, date_today: context.today, lookback_start: "06:00", timezone: "America/Denver", classify: true, cards: { active: engagement.cc_active_cards, locked: engagement.cc_locked_cards, ignore: engagement.cc_ignored_cards } }`. Capture `{ markdown, charges, top_merchant_today_total, mtd_discretionary, days_since_splurge_pre }` as `cc_signal`. When CC cards are not configured, treat as `cc_signal = null` (engagement opted into cc_drift but isn't wired yet; surface a one-line Notice and continue).
6. If `"calendar_drift"` in `tripwire_aspects`: use Skill `cowork:gather-calendar` with `{ engagement_id, mode: "drift-check", horizon: "today+4h", timezone: "America/Denver" }`. Capture `{ markdown, drift_minutes, drifted_events }` as `calendar_signal`. On `gather-skipped`, `calendar_signal = null` and append `calendar_unavailable` to the warnings array passed to write.
7. If `"queue_growth"` in `tripwire_aspects`: use Skill `cowork:gather-projects` with `{ engagement_id, mode: "tripwire-delta", since: <yesterday EOD ISO> }`. Capture `{ markdown, new_count, items }` as `queue_signal`.

## Decide

8. **Compute severity** from collected signals:
   - `alert` if any of: cc_signal contains a RED-class charge, calendar_signal.drift_minutes >= 60, queue_signal.new_count >= 10
   - `warn`  if any of: cc_signal contains only YELLOW-class charges, calendar_signal.drift_minutes in [30, 59], queue_signal.new_count in [3, 9]
   - `green` if none of the above
   If `green` → exit silently. Do NOT write a "nothing flagged" run-note (atomic-note absence = green; presence = something to flag).

## Write

9. **Read prompt body** via `mcp__obsidian__get_file_contents` at `spice/cowork/prompts/midday-tripwire.md`. Strip frontmatter; capture body as `prompt_body` (or empty when missing).
10. **Compose run-note body** per `prompt_body` + the flagged-event details from the gather steps. When prompt is empty, `warning = "empty_prompt"` and `run_body` is a terse literal summarizing the flagged events. Otherwise `warning = null`.
11. Use Skill `cowork:write-run-note-midday-tripwire` with `{ engagement, date: context.today, weekday: context.dddd, month_name: context["MM-Month"].split("-")[1], severity, signals: { cc: cc_signal, calendar: calendar_signal, queue: queue_signal }, body: run_body, prompt_source: "spice/cowork/prompts/midday-tripwire.md", warning, warnings: warnings_array }`. The `signals` arg is an opaque structured handoff write-run-note uses to compose the summary line; `warnings_array` is the optional list of `<aspect>_unavailable` strings from gather-skipped returns. Capture `status`. If `status` starts with `"failed:contract-violation:"`, emit Notice `cowork:midday-tripwire aborted -- contract violation: <field>` and exit non-zero. Else if `status` starts with `"failed:"`, emit Notice `cowork:midday-tripwire aborted -- write failed: <status>` and exit. Do not run state-update steps after a failed write.

## Done
