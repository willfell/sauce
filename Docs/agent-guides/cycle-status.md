---
purpose: Live platform state. Workshop version, mechanism catalogue, blueprint catalogue, harness count, landmines summary, in-flight queue. Updated at every cycle close.
load_when: Starting a session, picking the next cycle, or sanity-checking the current state.
---

# Cycle status (live)

> Closed-cycle narratives are in `Docs/cycle-history.md`. This guide carries only the live pointers. Update both this file AND `Docs/cycle-history.md` at every cycle close (see [build-test-verify.md](build-test-verify.md) § Cycle-close artifacts).

## Current

- **Workshop version:** `0.67.3` (closed 2026-05-20)
- **Most recent cycle:** v0.67.x arc — Activity Drill-In + Polish (1 MINOR + 3 PATCHes over ~24h). See `Docs/cycle-history.md` § v0.48.0 → v0.67.3 archive for the full narrative.

## Cycle order (chronological)

v0.1.0 → v0.1.1 → v0.1.x → v0.1.3 → v0.1.2 → v0.2.0 → v0.3.0 → v0.4.0 → v0.3.2 → v0.4.2 → v0.5.0 → v0.11.0 → v0.12.0 → v0.13.0 → v0.14.0 → v0.6.0 → v0.16.0 → v0.17.0 → v0.18.0/.1/.2 → v0.19.0 → v0.20.0 → v0.21.0/.1 → v0.22.0/.1 → v0.23.0 → v0.24.0 → v0.25.0 → v0.26.0/.1 → v0.27.0 → v0.28.0 → v0.29.0 → v0.30.0 ⏭️ → v0.31.0 → v0.32.0 → v0.33.0/.1 → v0.36.0/.1 → v0.37.0 → v0.38.0/.1 → v0.40.0 → v0.41.0/.5 → v0.42.0 → v0.43.0 → v0.44.0 → v0.45.0 → v0.46.0/.1/.2 → v0.47.0 → v0.48.0 → v0.49.0 → v0.49.1 ⏭️ → v0.49.2 → (v0.50.0–v0.62.0 narratives lost; pre-v0.63 narrative below resumes) → v0.63.0 → v0.63.1 → v0.63.2 → v0.63.3 → v0.64.0 → v0.64.1 → v0.64.2 → v0.64.3 → v0.65.0 → v0.66.0 → v0.66.1 → v0.66.2 → v0.67.0 → v0.67.1 → v0.67.2 → v0.67.3 (current).

> Gap note: per `Docs/cycle-history.md` line count (57 closed-cycle sections ending at v0.47.0, plus a v0.48–v0.67.3 archive), the v0.50.0 → v0.62.0 narratives were not captured in cycle-history.md during their respective closes. The CLAUDE.md claim that they were "archived to Docs/cycle-history.md" was stale. Backfill from `Docs/plans/` is possible but deferred.

## In-flight / next-candidate queue

Live brainstorm list (also referenced in `Docs/plans/` and brainstorm shelf files):

- **hub-nav@0.1.0 mechanism** (extraction candidate)
- **claude_surface[] wave 3** (boards / people / to-do / finance / journal / trips adopt `claude_surface[]` + retire `Docs/Meta/<X>-System.md`; cowork already retired; cowork backwards-compat shim removal)
- **v0.44.1 deploy-hardening** (deferred)
- **audit YAML parser swap**
- **Remaining-blueprint seed coverage**
- **v0.47.0 / v0.48.0 FLN cleanup cycles**
- **FLN-v66-1 cleanup** — 7 legacy-shape project hubs in accuris/ero use `type: structure`/`project-board` → rollup silently drops them; migration helper or rollup type-predicate widening
- **FLN-v66-5 audit assert** — every `new_entity_buttons[].prompts[].key` should appear in `frontmatter_template` as `{{prompts.<key>}}` (catches v0.66.2-style wiring gaps platform-wide)
- **FLN-v64-6** — scratch body-first-line title fallback for legacy untitled scratches
- **FLN-v67-7** — `sauce update --bump-pins` flag candidate for consumer subscription auto-bump

## Mechanisms (12)

| Name | Version | Role |
| --- | --- | --- |
| `customjs-guard` | 1.0.0 | Cold-load TDZ guard for Dataview views |
| `validator` | 0.2.0 | Per-file rules engine + Layer 2 manifest-convention rules |
| `audit` | 0.2.0 | `claude-surface` walker + entity-create walker + `/audit` slash command |
| `nav-buttons` | 2.7.0 | Registry-driven nav-button renderer; consumes icons mechanism |
| `cards` | 0.2.4 | BeaconCards row/stacked layouts |
| `accent-button` | 0.1.0 | AccentButton render helper |
| `icons` | 0.1.1 | Lucide kebab → SVG resolver; ~21 vendored Tier 1 SVGs + Obsidian `setIcon` Tier 2 fallback |
| `people-rendering` | 0.1.0 | People page renderers |
| `styling` | 0.1.2 | Vendored sauce theme + CSS variables |
| `convenience` | 0.2.4 | Consumer-default hotkeys/snippets/app-settings |
| `platform-claude` | 0.1.0 | `/install` `/upgrade` `/bootstrap` lifecycle slash commands + CLAUDE.md marker renderer |
| `entity-create` | 0.3.0 | Declarative `new_entity_buttons[]` spec; inside-block JS-comment sentinel; substitution catalogue with `derive`/`validate`/`inline_body` extensions |

Per-mechanism version history is in `Docs/cycle-history.md`. Current canonical catalogue lives at `platform/manifest.json`.

## Blueprints (11)

| Name | Version | Slash command | Module dir |
| --- | --- | --- | --- |
| `boards` | 0.1.0 | — | `spice/boards/` |
| `cowork` | 0.7.0 | — | `spice/cowork/` |
| `daily` | 0.3.0 | `/daily` | `spice/daily/` |
| `journal` | 0.1.2 | — | `spice/journal/` |
| `meetings` | 0.5.1 | `/meetings` | `spice/meetings/` |
| `people` | 0.2.2 | — | `spice/people/` |
| `project` | 1.9.2 | `/project` | `spice/projects/` |
| `scratch` | 0.3.1 | `/scratch` | `spice/scratch/` |
| `to-do` | 0.3.3 | — | `spice/to-do/` |
| `trips` | 0.1.7 | — | `spice/trips/` |
| `finance` | 0.3.1 | — | `spice/finance/` |

> Note: this table's blueprint versions track `platform/manifest.json`'s catalogue, not the per-blueprint `manifest.json`. The two must match (lockstep gate); if you see drift, that's a `check-version-sync.js` violation. Per-blueprint version history is in `Docs/cycle-history.md`.

## Test harnesses (22)

Whole-suite GREEN preserved v0.21.0 → current. Files in `platform/test/run-*.js`:

`run-activity-feed`, `run-audit`, `run-backlink-panel`, `run-bootstrap`, `run-claude-surface`, `run-cli`, `run-cowork-smoke`, `run-doctor-self`, `run-entity-create`, `run-helper-cases`, `run-install`, `run-install-sh`, `run-integration-smoke`, `run-migrate`, `run-migrate-frontmatter`, `run-migrate-layout`, `run-registry`, `run-renderer`, `run-seed`, `run-todo-modal` (NEW v0.63.0), `run-validator`, `run-wiki-to-docs-migration`.

Per-cycle sub-assert deltas are in `Docs/cycle-history.md`. Run via `npm run release:preflight` (gated first on `scripts/check-version-sync.js` per v0.38.0).

## Landmines

**22 entries** as of v0.32.0 close. Full canonical list with rationales + helper-count + stub-md5 invariant in `Docs/landmines.md`.

Most recent additions:

- #22 (v0.32.0) — `.local/` is the only consumer override seam
- #21 (v0.29.0) — `sauce audit` is read-only against the audited vault
- #20 (v0.28.0) — source vault is read-only during `sauce migrate`
- #19 (v0.26.0) — platform-managed dir names lowercase
- #18 (v0.22.0) — inside-vault `pantry/` is git-managed, never hand-edit

**Landmine #12 allowlist:** currently **18 paths + CLAUDE.md marker regions** (v0.41.0 amendment) covering Templater/Slash-Commander/Daily-Notes/Customjs/Dataview/Hotkeys/Vendored-plugin data.json files + sauce-namespaced snippets + claude_surface markers.

## Update protocol

Edit this file at every cycle close (per the canonical cycle-close artifact list in `Docs/prompts/SESSION-START.md`):

1. Bump **Current** → workshop_version + most-recent-cycle pointer.
2. Append the new version to the **Cycle order** line.
3. If mechanism or blueprint versions changed, update their rows in the **Mechanisms / Blueprints** tables.
4. If a new harness was added, append to the **Test harnesses** list and bump the count.
5. If new landmines were added, update the **Landmines** section.
6. Update the **In-flight / next-candidate queue** to reflect FLNs closed this cycle + new FLNs surfaced.

The full per-cycle narrative goes into `Docs/cycle-history.md` as a new `## v<X.Y.Z> <topic> CLOSED <date>` section — not into this file.
