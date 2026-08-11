---
purpose: Live platform state. Workshop version, mechanism catalogue, blueprint catalogue, harness count, in-flight queue. Updated at every cycle close.
load_when: Starting a session, picking the next cycle, or sanity-checking the current state.
---

# Cycle status (live)

> Closed-cycle narratives, the full chronological version chain, and per-harness detail are in `Docs/cycle-history.md`. This guide carries only the live pointers. Update both this file AND `Docs/cycle-history.md` at every cycle close — see § Update protocol.

## Current

- **Workshop version:** `0.282.1` (closed 2026-08-04)
- **Most recent cycle:** loop-integrity workstream 3 — a rail that fits: the `adopt` verb (verified out-of-band completion carrying PR + merge-SHA provenance, new terminal `adopted` ledger phase, projection refresh), stamp-provenance classification of untracked board members in `board-health`, `card_note_sha`/`foreign_write` detection of non-coordinator card writes, and a stable `concurrent_modification` refusal across the bulk-rewrite verbs. See `Docs/plans/2026-08-04-v0.283.0-ws3-a-rail-that-fits-result.md`.

- **Workshop version (previous):** `0.282.0` (closed 2026-08-04) — loop-integrity workstream 2 — one source of truth: canonical path derivation, board-vs-ledger authority, and the release bump each reduced to one physical implementation (`delivery.topology.*`, `resolveSliceAuthority`, PR-title bump gate). See `Docs/plans/2026-08-04-v0.282.1-ws2-one-source-of-truth-result.md`.

## Mechanisms (30)

| Name | Version | Role |
| --- | --- | --- |
| `customjs-guard` | 1.0.0 | Cold-load TDZ guard for Dataview views |
| `validator` | 0.3.0 | Per-file rules engine + manifest-convention rules |
| `activity-feed` | 0.10.0 | Bucketed activity-feed renderer |
| `kanban-status-sync` | 0.2.0 | Syncs obsidian-kanban column → frontmatter |
| `code-fence-button` | 0.3.0 | Inline code-fence action buttons (code/inline-code) |
| `audit` | 0.3.0 | `claude-surface` + entity-create walker; `/audit` |
| `backlink-panel` | 0.1.1 | Backlink panel renderer |
| `breadcrumb` | 0.4.0 | Ancestors/path-walk breadcrumb renderer |
| `doc-search` | 0.3.0 | Doc search box helper |
| `nav-buttons` | 2.16.0 | Registry-driven nav-button renderer |
| `cards` | 0.2.6 | BeaconCards row/stacked layouts |
| `accent-button` | 0.1.3 | AccentButton render helper |
| `section-label` | 0.2.2 | SectionLabel + helper-owned divider primitive |
| `links` | 0.2.0 | Shared link-grid renderer |
| `task-interactions` | 0.2.0 | Shared task-row interactions (check/edit/delete) |
| `open-helpers` | 0.1.1 | Shared open-note/open-editor helpers |
| `icons` | 0.3.0 | Lucide kebab → SVG resolver + Tier-2 `setIcon` fallback |
| `entity-create` | 0.9.1 | Entity-create dialog + folder routing |
| `people-rendering` | 0.1.0 | People page renderers |
| `people-identity` | 0.1.0 | Identity resolver for `spice/people/` |
| `styling` | 0.2.1 | Vendored sauce theme + CSS variables |
| `convenience` | 0.6.0 | Consumer-default hotkeys/snippets/app-settings |
| `platform-claude` | 0.1.3 | `/install` `/upgrade` `/bootstrap` + CLAUDE.md router mgmt |
| `smart-connections-bridge` | 0.2.0 | Smart Connections `.smart-env` bridge (non-fatal parse-skip) |
| `render-safe` | 0.2.2 | Cold-load-safe `dv.current()` / page resolver |
| `sauce-plugin` | 0.3.0 | Sauce Obsidian plugin shell |
| `task-entity` | 0.15.3 | Shared task-note entity model + row renderer |
| `menu-popover` | 0.3.0 | Shared ⋯ menu popover |
| `chrome-bar` | 0.4.1 | Shared breadcrumb+Go+primary+⋯ chrome bar factory |
| `section-explorer` | 0.6.0 | Shared section/doc management (move, bulk-select, delete) |

> Per-mechanism history and rationale: `Docs/cycle-history.md`. Source of truth for versions: `platform/manifest.json`.

## Blueprints (16)

| Name | Version | Slash command | Module dir |
| --- | --- | --- | --- |
| `boards` | 0.3.0 | — | `spice/boards/` |
| `cowork` | 0.41.0 | `/cowork` | `spice/cowork/` |
| `daily` | 0.23.0 | `/daily` | `spice/daily/` |
| `journal` | 0.5.1 | — | `spice/journal/` |
| `meetings` | 0.19.1 | `/meetings` | `spice/meetings/` |
| `people` | 0.8.1 | — | `spice/people/` |
| `products` | 0.4.0 | — | `spice/products/` |
| `project` | 1.53.1 | `/project` | `spice/projects/` |
| `sticky-notes` | 0.11.3 | `/sticky-notes` | `spice/sticky-notes/` |
| `teams` | 0.4.0 | — | `spice/teams/` |
| `to-do` | 0.26.0 | — | `spice/to-do/` |
| `trips` | 0.10.1 | — | `spice/trips/` |
| `finance` | 0.19.2 | — | `spice/finance/` |
| `wiki` | 0.8.2 | `/wiki` | `spice/wiki/` |
| `home` | 0.7.0 | `/home` | `spice/home/` |
| `reader` | 0.6.0 | `/reader` | `spice/reader/` |

> Note: table tracks `platform/manifest.json`'s catalogue, not per-blueprint `manifest.json`. The two must match (lockstep gate) — drift is a `check-version-sync.js` violation. Per-blueprint version history: `Docs/cycle-history.md`.

## Test harnesses

171 harnesses under `platform/test/run-*.js`, one per mechanism/blueprint plus cross-cutting suites (seed-vault regression, schema lint, version-sync). Run the full set via `npm run release:preflight`. Per-harness detail and history: `Docs/cycle-history.md`.

## In-flight / next-candidate queue

Active work: GA-D1–GA-D4 docs/context-economy sweep (this cycle). For the full FLN-numbered candidate/deferred backlog and closed-cycle detail, see `Docs/cycle-history.md`.

## Cycle order (chronological)

Full chain v0.1.0 → `0.229.0` (current) lives in `Docs/cycle-history.md`, including the known v0.50.0–v0.62.0 narrative gap. This file tracks only the live tip (see § Current above).

## Landmines

See `Docs/landmines.md` for the full, canonically-numbered list of traps. Do not duplicate the summary here — it drifts.

## Update protocol

At every cycle close:

1. Run `node scripts/regen-cycle-status.js` (or `--check` to detect drift first). It rewrites `## Current` from `platform/manifest.json` + the latest `Docs/plans/*-result.md`, demoting the prior top entry. The script enforces a 15,360-byte cap on this file and fails loudly if the rewrite would exceed it — trim `## Current`'s "Most recent narrated cycle" prose or move detail to `Docs/cycle-history.md` first.
2. Append the closed cycle's full narrative to `Docs/cycle-history.md` as `## v<X.Y.Z> — <topic> CLOSED <date>`.
3. If mechanisms/blueprints changed, update the tables above from `platform/manifest.json` (name + version only; do not restate full descriptions inline — one line max).
4. Do not add per-harness paragraphs, FLN queue prose, or cycle-order gap notes to this file — they belong in `Docs/cycle-history.md`.
