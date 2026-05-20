---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:midday-tripwire
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Midday tripwire — personal

Compose the tripwire body using the gather-finance-cc-today output. This run-note ONLY exists when at least one charge is yellow or red severity — if everything is green, the orchestrator skips the write entirely. Body shape:

## 🚨 Flagged charges

For each yellow + red charge: amount (USD) · merchant · card name · severity (yellow/red) · one-sentence rationale (e.g., "locked-card breach", "discretionary >$X threshold", "splurge category"). Group reds first.

## 🕒 Days since last splurge

Single line from the gather output: `days_since_splurge_pre` value (or note "first splurge tracked"). Pre-tripwire snapshot so the reader sees the streak that was broken.

## 🔒 Locked-card breaches

Only if at least one red charge hit a locked card. List each locked-card transaction separately with merchant + amount. Skip section if zero red charges.

## 🎯 Recommended action

One 1–2 sentence paragraph naming the corrective action: pause discretionary, move the charge to the active card if possible, or note the breach for EOD reconciliation. End with a specific next step.

---

Tone: direct without scolding. Severity comes from the gather classifier — don't second-guess it. Skip the locked-card section if all flags were yellow.
