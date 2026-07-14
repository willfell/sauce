# Sauce Pipeline Round 15 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.58.0
**Card completed:** [[FA-6 · Domain wave]]
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.58.0-result.md`

## What shipped

Three mixed-shape domain blueprints adopt canonical vocabulary in one cycle per umbrella design §C Wave 4. `trips@0.1.7 → 0.2.0`, `to-do@0.1.4 → 0.2.0`, `boards@0.1.0 → 0.2.0` — all MINOR. `workshop_version 0.57.0 → 0.58.0`.

- **trips:** Trip Atlas template gets canonical `created_at:` (via `_isoWithTz` in trip-nav-buttons helper) + **`attending:` → `people:` canonical alignment**; Trip Board Card gets canonical `created_at:` + `type: trip-board-card`; Trips.md hub gets static `created_at:`; both rule_fragments declare `extends:`; Trip Atlas rule drops `trip` required_tag + drops `attending:` requirement.
- **to-do:** Today To-Do template **adds `type: "to-do"`** (the ONE blueprint missing canonical type discriminator per FA audit) + canonical `created_at:`; discriminator `todo` + temporal tag stripped; NEW canonical-vocab rule_fragment.
- **boards:** Template, Board Card gets canonical `created_at:` + `type: board-card`; To-Do-Board.md hub gets static `created_at:`; discriminator `board` tags stripped; `kanban-card` preserved; NEW canonical-vocab rule_fragment scoping `spice/boards/cards/**/*.md`.

Whole-suite preflight green (18 harnesses). +23 sub-asserts vs v0.57.0 baseline.

## Board snapshot (after this round)

### In Planning (top-level)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (FA-1..FA-6 done; FA-7..FA-9 ahead)

### Blocked
(empty)

### Completed (most recent at top)
- [[FA-6 · Domain wave]] — v0.58.0 — 2026-05-17
- [[FA-5 · Cowork migration]] — v0.57.0 — 2026-05-17
- [[FA-4 · Timeline wave]] — v0.56.0 — 2026-05-17
- [[FA-3 · Project migration]] — v0.55.0 — 2026-05-17
- [[FA-2 · Entity wave]] — v0.54.0 — 2026-05-17
- [[FA-1 · Foundation cycle]] — v0.53.0 — 2026-05-17
- [[Projects Blueprint]]

### FA sub-board Planning (after FA-6 close)
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

## Recommended next

- **Card:** [[FA-7 · Finance migration]]
- **Reason:** Finance alone — 3 sub-flows (budget + paycheck + invoice) × 2-3 templates each + 3 entity-create entries. Slightly heavier than FA-6 but still well-scoped. `finance@0.3.1 → 0.4.0` MINOR. Whole-suite delta target ~+12 sub-asserts. Possible split FA-7a / FA-7b / FA-7c if cycle gets unwieldy at execution time. FA-7 closes Wave 4 of the umbrella design; FA-8 (universal backlink panels) is the payoff cycle that pays off the canonical-vocab investment visibly.

Alternates:
- **Deploy round** — accumulating: v0.57.0 (FA-5 cowork) + v0.58.0 (FA-6 trips+to-do+boards). 4 vaults need brew upgrade + subscription pin updates + 4 migration runs + reinstall + audit verify. 9-step checklist in v0.58.0 result doc.
- **FA-8 · Universal backlink panels** — payoff cycle; NEW `BacklinkPanel` mechanism + materialization on entity atlases (Person, Project, Team, Product, Trip). FA-7 can ship before/after FA-8.
- **Pause for deploy + smoke test** — round 13's project-flow fix hasn't been observed working at any vault yet. Pausing to verify before adding more cycles might be prudent.

## Open questions / dependencies

- **`month_iso → month` migration rule still missing for FA-5** (FLN-FA5-1 carry). Affects deploy-round cowork migration; doesn't block FA-7 ship.
- **`type: "to-do"` backfill via migration verb** (FLN-FA6-7). v0.53 migration spec has a general `backfill.type.infer_from: ["path", ...]` rule. Plan-author check at deploy-round time — verify the path-based inference correctly maps `spice/to-do/**/*.md` → `type: "to-do"` (mirrors FLN-FA3-2's project over-aggressiveness in the opposite direction).
- **Trip Atlas `cssclasses` rule relaxed** (FLN-FA6-2) — pre-existing inconsistency between rule (required `["wide", "cards"]`) and content (only `wide`). Relaxed during FA-6. Might surface as audit drift at consumer vault if hub has been hand-edited.

## Sleep

270s heartbeat — keeps prompt cache warm for the next-round user pick (Phase B is the only interactive gate per round).
