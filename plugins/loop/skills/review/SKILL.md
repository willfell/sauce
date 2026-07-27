---
name: review
description: The Director's retroactive-review surface for the bound delivery loop. Use when asking "what did the loop decide while I was away", "walk me through the digest", "review the self-ratified amendments", "why is something parked", or to work the few genuine escalations. Walks the retroactive digest, surfaces perimeter items and escalations for decisions, and can reject a self-ratified amendment into a corrective intake — never writes cards.
---

# loop:review

The retroactive review of whatever board this repo is bound to. Under zero-authorization governance the loop never waits on a human: this skill's job is to **walk what already happened** (the retroactive digest) and to **decide the few things only the Director can** (perimeter items, escalations, rejections of self-ratified amendments). **Never writes cards, the board, or coordinator state** — the FID and loop-project docs are the only write targets.

## Bind

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json` from the repo root; refusal → `/loop:init`, stop.
2. `<coordinator>` = `config.coordinator`; helpers are its siblings in `dirname(<coordinator>)`: `delivery-status-digest.js`, `delivery-review-triage.js`, `delivery-review-ratify.js`. Export `config.env` into every command. `<fid>` = `config.fid_abs`; without one, the amendment feed and ratify verbs are unavailable — say so if asked for them.

## Phase 1 — Walk the retroactive digest

1. Run `node <coordinator> status --json` (env applied, cwd = repo root), save to a temp file. Build the digest with `--peek` first (peeking preserves the since-section for the closing read in Phase 4).
2. Walk the `since` section item by item, newest first:
   - **Self-ratified FID amendments** (heading + date): one line each. The Director may accept silently (default) or **reject** — rejection spawns a corrective card through `/loop:intake`; shipped work stands per its receipts. Never revert an amendment in place.
   - **Discards** (name + reason + superseded_by): one line each. Resurrection is one intake command — offer it only if the Director asks.
   - **Cutover flips** (enabled/disabled + at + reason): state the current position.

## Phase 2 — Surface the exceptions (deterministic)

1. Run `node <triage> --status <status.json> --fid "<fid>"`. It returns `{ actionable: [{card, bucket, resume_condition}], noAction: {frozen, waiting, done, active} }`.
2. Present the no-action summary first: "only the coordinator's active list is real work; X frozen, Y genuine waits (the loop resumes these itself), Z done." This is the antidote to the board-lies effect.
3. Present the ranked actionable queue. Buckets: `provisional-pending` (legacy FID headings), `coordinator-deadend` (blocked/projection problems), `escalation` (parked outside the loop's own resume authority).

## Phase 3 — Decide the escalations (one at a time)

For each actionable item in rank order:
1. Read its exact `resume_condition`. `coordinator-deadend` items are machinery problems — name the fix, don't brainstorm policy.
2. For `escalation` items, ask ONE question: decision (act now · re-scope via intake · shelve · defer), recommendation first. Perimeter items (publication, new credential scopes, spending) are **Director-initiated projects** — present them as such, never as gates the loop is waiting at.
3. Capture the answer. Policy changes go through the FID as amendments; work changes go through `/loop:intake`. Never edit a card, the board, or coordinator state.

## Phase 4 — Close the read

Re-run the digest WITHOUT `--peek` so the last-seen marker advances — the next review starts from now.

## Phase 5 — Handoff

Phone-sized: digest items walked (accepted / rejected→corrective intake), escalations decided, deadends named, next coordinator effect. If a legacy PROPOSED heading was ratified on the Director's explicit word, flip it with `node <ratify> flip --fid "<fid>" --heading "<title>" --date <YYYY-MM-DD>` and note it.

## NEVER

Write cards/board/coordinator state · revert a self-ratified amendment in place (reject → corrective intake) · present a perimeter item as a blocker the loop waits on · flip a PROPOSED heading without the Director's explicit word.
