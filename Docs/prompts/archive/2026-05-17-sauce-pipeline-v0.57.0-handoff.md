# Sauce Pipeline Round 14 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.57.0
**Card completed:** [[FA-5 · Cowork migration]]
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.57.0-result.md`

## What shipped

Cowork canonical-vocab adoption per FA-5. `cowork@0.7.0 → 0.8.0` MINOR. `workshop_version 0.56.2 → 0.57.0` MINOR.

- 3 note templates (Daily / Weekly / Monthly Note) emit canonical `created_at:` ISO+TZ; discriminator tags (`cowork-daily` / `cowork-weekly` / `cowork-monthly`) stripped from templates.
- Monthly Note canonical `month: "YYYY-MM"` introduced (was `month_iso:`); resolves cross-blueprint `month:` clash with finance.
- 5 hub content files + 4 prompt stubs gain static `created_at:` so workshop dogfood install satisfies `extends:` contract.
- 12 of 13 rule_fragments declare `extends: "_canonical-vocab"` (the `.claude/skills/cowork/*/SKILL.md` fragment is the documented exception — different schema).
- Daily / weekly / monthly fragments drop `required_frontmatter.created`; daily fragment drops `required_tags: [{ tag: "cowork-daily" }]`; monthly fragment adds canonical `month:` regex `^\d{4}-\d{2}$`.
- Helpers unchanged this cycle (audit revealed existing helpers already read canonical-shaped keys).

Whole-suite preflight green (18 harnesses). +48 sub-asserts vs v0.56.0 baseline.

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
- [[Frontmatter Alignment]] (FA-1..FA-5 done; FA-6..FA-9 ahead)

### Blocked
(empty)

### Completed (most recent at top)
- [[FA-5 · Cowork migration]] — v0.57.0 — 2026-05-17
- [[FA-4 · Timeline wave]] — v0.56.0 — 2026-05-17
- [[FA-3 · Project migration]] — v0.55.0 — 2026-05-17
- [[FA-2 · Entity wave]] — v0.54.0 — 2026-05-17
- [[FA-1 · Foundation cycle]] — v0.53.0 — 2026-05-17
- [[Projects Blueprint]] (top-level)

### FA sub-board Planning (after FA-5 close)
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

## Recommended next

- **Card:** [[FA-6 · Domain wave]]
- **Reason:** Per umbrella design §C Wave 4. Three lighter blueprints (trips + to-do + boards) — trips `attending → people` canonical alignment, to-do `type: "to-do"` backfill (audit found this is the ONE blueprint missing `type:`), boards canonical-vocab adoption. Whole-suite delta target ~+10 sub-asserts. Cleaner / smaller than FA-5.

Alternates:
- **Deploy round** — batch v0.57.0 deployment + FA-5 consumer-vault migration. Repeats round 13's posture: tap formula bump (`willfell/homebrew-sauce` PR likely auto-opened on tag push) + brew upgrade + consumer subscription pin updates + reinstall + `sauce migrate-frontmatter --blueprint cowork --apply` × 4 vaults. See result doc "Consumer-vault migration" section for the 7-step deploy checklist.
- **FA-7 · Finance migration** — finance alone; 3 sub-flows.
- **FA-8 · Universal backlink panels** — payoff cycle; NEW `BacklinkPanel` mechanism + materialization on entity atlases.
- **Pause for project flow smoke** — round 13's deploy unblocked the project kanban flow. Round 14 has not observed user testing the "+ Add a card" workstream picker. Verifying before piling more cycles ahead could be prudent.

## Open questions / dependencies

- **`month_iso → month` migration rule missing** (FLN-FA5-1). The v0.53 migration spec doesn't yet rename `month_iso:` (post-v0.7.0 cowork-monthly key) → canonical `month:`. The next deploy round needs to either (a) append the rule to `platform/migrations/v0.53-frontmatter.json` OR (b) add a backfill rule deriving canonical `month:` from filename for cowork-monthly path-matched files. Option (b) is more robust (covers both pre-v0.7.0 and post-v0.7.0).
- **No user feedback yet on round 13 deploy's project-flow fix** — the kanban "+ Add a card" workstream picker should now fire at consumer vaults (v0.56.x). If still broken at any vault, file a Bug card and triage before continuing FA waves.

## Sleep

270s heartbeat — keeps prompt cache warm for the next-round user pick (Phase B is the only interactive gate per round).
