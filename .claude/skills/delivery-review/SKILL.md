---
name: delivery-review
description: The Director's retroactive-review surface for the Sauce Delivery loop. Use when asking "what did the loop decide while I was away", "walk me through the digest", "review the self-ratified amendments", "why is something parked", or to work the few genuine escalations. Walks the retroactive digest (self-ratified FID amendments, discards, cutover flips), surfaces perimeter items and escalations for decisions, and can reject a self-ratified amendment into a corrective intake — never writes cards.
---

# delivery:review

The full-variant Sauce Delivery retroactive review. Under zero-authorization governance the loop never waits on a human: value reviews, PROPOSED-and-wait amendments, and per-blocker Will-gates are retired. This skill's job is to **walk what already happened** (the retroactive digest) and to **decide the few things only the Director can** (perimeter items, escalations, rejections of self-ratified amendments). **Never writes cards, the board, or coordinator state** — the FID and loop-project docs are the only write targets. Full spec: `Docs/superpowers/specs/2026-07-25-board-governance-redesign-design.md` §3.

## Paths

- Repo root: `/Users/willfellhoelter/projects/repos/sauce`
- Coordinator status: `/opt/homebrew/opt/node/bin/node /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js status --json` (from repo root)
- FID (authority + write target): `/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md`
- Digest helper: `node scripts/autoloop/delivery-status-digest.js --status <status.json> --fid "<FID path>" [--peek]`
- Triage helper: `node scripts/autoloop/delivery-review-triage.js --status <status.json> --fid "<FID path>"`
- Ratify helper: `node scripts/autoloop/delivery-review-ratify.js flip --fid "<FID path>" --heading "<title>" --date <YYYY-MM-DD>` (for legacy PROPOSED headings only)

## Phase 1 — Walk the retroactive digest

1. Run the coordinator status, save its JSON to a temp file. Build the digest with `--peek` first (peeking preserves the since-section for the closing read in Phase 4).
2. Walk the `since` section item by item, newest first:
   - **Self-ratified FID amendments** (heading + date): summarize each in one line. The Director may accept silently (default) or **reject** — rejection spawns a corrective card through normal `card-intake`; shipped work stands per its receipts. Never revert an amendment in place.
   - **Discards** (name + reason + superseded_by): one line each. Resurrection is one intake command — offer it only if the Director asks.
   - **Cutover flips** (enabled/disabled + at + reason): state the current position.
3. Known gap: ceilings hit and decompositions are part of the digest design but coordinator `status --json` does not expose them yet; say so only if the Director asks about them.

## Phase 2 — Surface the exceptions (deterministic)

1. Run the triage helper against the status JSON + FID. It returns `{ actionable: [{card, bucket, resume_condition}], noAction: {frozen, waiting, done, active} }`.
2. Present the no-action summary first: "only the coordinator's active list is real work; X frozen host evidence, Y genuine waits (concurrency/deploy — the loop resumes these itself), Z done." This is the antidote to the board-lies effect.
3. Present the ranked actionable queue. Buckets: `provisional-pending` (legacy FID headings), `coordinator-deadend` (blocked/projection problems), `escalation` (parked outside the loop's own resume authority — perimeter items, Director decisions). There is no superseded-corpse bucket: the coordinator discards corpses at mint time and `reap` is the backstop, so tombstones never reach triage.

## Phase 3 — Decide the escalations (one at a time)

For each actionable item in rank order:
1. Read its exact `resume_condition`. `coordinator-deadend` items are machinery problems — name the fix, don't brainstorm policy.
2. For `escalation` items, ask ONE `AskUserQuestion`: decision (act now · re-scope via intake · shelve · defer), recommendation first. Perimeter items (publication, new credential scopes, spending) are **Will-initiated projects** — present them as such, never as gates the loop is waiting at.
3. Capture the answer. Decisions that change loop policy go through the FID as amendments; decisions that change work go through `card-intake`. Never edit a card, the board, or coordinator state.

## Phase 4 — Close the read

Re-run the digest WITHOUT `--peek` so the last-seen marker advances — the next review starts from now.

## Phase 5 — Handoff

Phone-sized: digest items walked (accepted / rejected→corrective intake), escalations decided, deadends named, next coordinator effect. If a legacy PROPOSED heading was ratified on the Director's word, note the flip.

## NEVER

Write cards/board/coordinator state · surface host lineage (LH*, A5, GA-OPS10a/b, GA-OPS4b) as actionable — the durable-host suspension is constitutional and reopening is Will-initiated · revert a self-ratified amendment in place (reject → corrective intake) · present a perimeter item as a blocker the loop waits on · flip a PROPOSED heading without the Director's explicit word.
