---
name: delivery-review
description: The Director's exception-and-decide surface for the Sauce Delivery loop. Use when the board's "In Progress" is piling up, when asking "why is nothing moving on the board", "what's blocking the loop", "triage the parked cards", or when you want to work blockers to ratified fixes. Discovers what's actually blocking (vs frozen evidence), brainstorms each with you, and drafts ratifiable Final Initial Design amendments — never writes cards.
---

# delivery:review

The full-variant Sauce Delivery exception queue. Discover blockers, decide each with the Director, emit the ratifiable artifact the loop consumes. **Never writes cards, the board, or coordinator state** — the FID and loop-project docs are the only write targets. Full spec: `~/notes/sauce/headspace-sauce/spice/projects/meta-board-loop-system-rnd/docs/delivery-skills/delivery-review Skill Specification.md`.

## Paths

- Repo root: `/Users/willfellhoelter/projects/repos/sauce`
- Coordinator status: `/opt/homebrew/opt/node/bin/node /opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js status --json` (from repo root)
- FID (authority + write target): `/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md`
- Triage helper: `node scripts/autoloop/delivery-review-triage.js --status <status.json> --fid "<FID path>"`
- Ratify helper: `node scripts/autoloop/delivery-review-ratify.js flip --fid "<FID path>" --heading "<title>" --date <YYYY-MM-DD>`

## Phase 1 — Discover & triage (deterministic)

1. Run the coordinator status, save its JSON to a temp file.
2. Run the triage helper against that JSON + the FID. It returns `{ actionable: [{card, bucket, resume_condition}], noAction: {frozen, superseded, done, active} }`.
3. Present the no-action summary first, verbatim in spirit: "N cards show as In Progress; only the coordinator's active list is real work. X are frozen host evidence, Y are finished-and-superseded, Z are already done — none needs you." This is mandatory; it is the antidote to the board-lies effect.
4. Present the ranked actionable queue.

## Phase 2 — Brainstorm each blocker (bounded judgment, one at a time)

For each actionable item in rank order:
1. Read its exact `resume_condition` and the newest session log under `spice/projects/sauce/docs/workflow-loops/*-run-loose-session.md` for named findings.
2. Check the terminal boundary: if the resume condition says the lineage is "permanently closed" / "no further supersession", offer only re-scope or shelve — never "attempt N+1".
3. Two-strike check: if this initiative already ended two consecutive sessions at a Will-gate with no deploy, flag it as an auto-suspend candidate instead of drafting a third gate.
4. Ask ONE `AskUserQuestion`: decision (fix/authorize · re-scope · shelve · defer), recommendation first, with the named findings and value-vs-cost in the option descriptions.
5. Capture the answer. Move to the next blocker.

## Phase 3 — Author the ratifiable artifact

Per decision, using the exact FID amendment format (`## <title> — PROPOSED <date>` + `> [!warning] PROPOSED — awaiting Will's ratification` + **Basis / Authorized work / Not authorized**):
- authorize → append a PROPOSED amendment (touch-zone add / final attempt with findings as binding named fixtures / machinery fix).
- heavy multi-lineage → write a value-review brief doc in `spice/projects/sauce/docs/workflow-loops/`.
- shelve → a short PROPOSED amendment moving the cards to Post-GA.
Append amendments by reading the FID, using the ratify helper's `appendAmendment` shape (one blank-line separator), and writing back. Never edit a card, the board, or coordinator state.

## Phase 4 — Ratify on the Director's word

Only when the Director says "ratify" for a named amendment, run the ratify helper to flip it. Never self-ratify.

## Phase 5 — Handoff

Phone-sized: now-accepted (+ card each unblocks), still-PROPOSED (+ one-line ratify prompt), shelved, next coordinator effect, and the "paste run-loose next" pointer. Link any brief written.

## NEVER

Write cards/board/coordinator state · surface host lineage (LH*, A5, GA-OPS10a/b, GA-OPS4b) as actionable · self-ratify · touch a card whose resume condition names Will's direct approval · offer "attempt N+1" past a terminal boundary · draft a third consecutive Will-gate for one initiative.
