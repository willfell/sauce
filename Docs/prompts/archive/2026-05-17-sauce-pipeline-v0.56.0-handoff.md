# Sauce Pipeline Round 12 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.56.0
**Card completed:** [[FA-4 · Timeline wave]]
**Result doc:** (folded into this handoff — small cycle with no separate result doc)

## What shipped in v0.56.0

**Timeline wave (3 blueprints):**
- `daily@0.3.0 → 0.4.0` — daily-template: `type: daily` + `created_at` ISO+TZ; drop `daily` + temporal tags. rule_fragment uses `extends: "_canonical-vocab"`.
- `journal@0.1.2 → 0.2.0` — Today Journal.md: `type: journal` + `created_at` ISO+TZ; drop `journal` + temporal tags. NEW rule_fragment (had none); extends canonical-vocab.
- `scratch@0.3.1 → 0.4.0` — Scratch.md + Scratch Day Hub.md: `created → created_at` (was ISO-no-TZ; now ISO+TZ). entity-create frontmatter_template: created → created_at. Both rule_fragments extend canonical-vocab.

**Accuris-sauce catch-up** (this round added accuris to the apply scope at user's request):
- meetings: 356 files
- people: 115 + 2 parse-error
- project: 304 + 20 parse-error
- Total: 775 catch-up files

**FA-4 apply across all 4 vaults:**
- headspace-sauce: 391 (1 parse-error)
- barebones: 384 (1 parse-error)
- ero-sauce: 69
- accuris-sauce: 332 (1 parse-error)
- **FA-4 total: 1176 files**

Round 12 total mutation: **~1951 files** across 4 consumer vaults; backups under `<vault>/.sauce-backup/`.

**Whole-suite:** run-helper-cases 755 → 769 (+14 FA-4 + 1 SHC-S1 scratch version pin). All 14 harnesses green.

## Board snapshot

### In Planning
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (FA-1..FA-4 done; FA-5..FA-9 ahead)

### FA sub-board Planning
- [[FA-5 · Cowork migration]]
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

### Completed
- v0.56.0 — FA-4 · Timeline wave
- v0.55.0 — FA-3 · Project migration
- v0.54.0 — FA-2 · Entity wave
- v0.53.0 — FA-1 · Foundation cycle

## Recommended next

- **Card:** [[FA-5 · Cowork migration]]
- **Reason:** Cowork alone. Heaviest timeline migration: 14 rule_fragments + 8 templates + `month → month_label` rename (resolves cowork-vs-finance semantic clash). `cowork@0.7.0 → 0.8.0` MINOR. Apply scope: all 4 vaults (now established pattern; accuris caught up).

Alternates:
- **FA-6 · Domain wave** — trips + to-do + boards (lighter; 3 blueprints).
- **Cleanup over-applied `type: project`** on ~20-30 sub-files under spice/projects/ (FLN-FA3-2 carry-over).
- **Cleanup `.sauce-backup/`** dirs across 4 vaults (~3500+ backup files accumulated).

## FIX-LATER notes (this cycle)

- **FLN-FA4-1** — Daily-notes core plugin owns daily-note creation but the template carries `<% tp.file.creation_date %>` Templater syntax. Verify daily-notes plugin still invokes Templater post-create so created_at populates. (If not: daily notes will have empty created_at; trigger audit findings.)
- **FLN-FA4-2** — `journal` blueprint shipped no rule_fragments before FA-4. Adding canonical-vocab via extends is the first rule_fragment journal has; consumers with existing journal notes pre-canonical may trigger missing_canonical_key. Migration runs cleared headspace/barebones (33 each) but ero/accuris had 0 journal files.
- **FLN-FA4-3** — Parse-error files (3 total in FA-4) — list-of-objects in `workstreams:` of daily-note fm in some vaults (Sauce's own daily notes). Hand-edit needed.
- **FLN-FA4-4** — `tp.file.creation_date` returns blank for templater-not-managed file open. Same caveat as FA-2.

## Open questions / dependencies

- **`brew upgrade sauce`** + `sauce reinstall` against each consumer to pick up the new daily/journal/scratch templates for fresh note creation.
- **`extends` still doesn't propagate into `frontmatter_branch[]`** (FLN-FA3-1 carry). FA-4 rules use simple `required_frontmatter` so extends works directly.

## ScheduleWakeup pacing

Next round picks at Phase B. 270s heartbeat keeps cache warm.
