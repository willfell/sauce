---
purpose: Live platform state. Workshop version, mechanism catalogue, blueprint catalogue, harness count, in-flight queue. Updated at every cycle close.
load_when: Starting a session, picking the next cycle, or sanity-checking the current state.
---

# Cycle status (live)

> Closed-cycle narratives, the full chronological version chain, and per-harness detail are in `Docs/cycle-history.md`. This guide carries only the live pointers. Update both this file AND `Docs/cycle-history.md` at every cycle close — see § Update protocol.

## Current

- **Workshop version:** `0.295.1` (last closed release)
- **Most recent narrated cycle:** engine reintegration (shipped v0.292.0) — the Sauce engine runtime (`platform/engine/`), the always-on `engine` mechanism, `sauce run` / `sauce audit --engine`, and the retirement of the autoloop cron surface. Design: `Docs/plans/engine-reintegration.md`; agent guide: `Docs/agent-guides/engine.md`. See `Docs/plans/2026-09-22-v0.292.0-engine-reintegration-result.md`. v0.293.0 then renamed the delivery plugin from `mayo` to `sauce` (`/sauce:loop` replaces `/mayo:run`).

- **Workshop version (previous):** `0.283.0` (closed 2026-08-05) — loop-integrity workstream 3 — a rail that fits: the `adopt` verb (verified out-of-band completion carrying PR + merge-SHA provenance, new terminal `adopted` ledger phase, projection refresh), stamp-provenance classification of untracked board members in `board-health`, `card_note_sha`/`foreign_write` detection of non-coordinator card writes, and a stable `concurrent_modification` refusal across the bulk-rewrite verbs. See `Docs/plans/2026-08-04-v0.283.0-ws3-a-rail-that-fits-result.md`.
- **Workshop version (previous):** `0.282.0` (closed 2026-08-04) — loop-integrity workstream 2 — one source of truth: canonical path derivation, board-vs-ledger authority, and the release bump each reduced to one physical implementation (`delivery.topology.*`, `resolveSliceAuthority`, PR-title bump gate). See `Docs/plans/2026-08-04-v0.282.1-ws2-one-source-of-truth-result.md`.

## Mechanisms (35)

| Name | Version | Role |
| --- | --- | --- |
| `editor-width` | 0.2.0 | Sauce-patched editor-width-slider plugin build, enabled in every vault |
| `agent-embed` | 0.2.0 | Manages the `realclaudian` community plugin (embeds Claude Code/Codex agents in the vault) |
| `customjs-guard` | 1.0.2 | Cold-load TDZ guard for Dataview views |
| `validator` | 0.3.0 | Per-file rules engine + manifest-convention rules |
| `activity-feed` | 0.10.2 | Bucketed activity-feed renderer |
| `kanban-status-sync` | 0.2.2 | Syncs obsidian-kanban column → frontmatter |
| `code-fence-button` | 0.3.0 | Inline code-fence action buttons (code/inline-code) |
| `audit` | 0.4.0 | `claude-surface` + entity-create walker; `/audit` |
| `backlink-panel` | 0.1.3 | Backlink panel renderer |
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
| `entity-create` | 0.9.2 | Entity-create dialog + folder routing |
| `people-rendering` | 0.1.0 | People page renderers |
| `people-identity` | 0.1.0 | Identity resolver for `spice/people/` |
| `styling` | 0.5.2 | Vendored sauce theme + CSS variables |
| `convenience` | 0.6.0 | Consumer-default hotkeys/snippets/app-settings |
| `platform-claude` | 0.7.0 | `/install` `/upgrade` `/bootstrap` + CLAUDE.md router mgmt |
| `smart-connections-bridge` | 0.3.0 | Smart Connections `.smart-env` bridge (non-fatal parse-skip) |
| `render-safe` | 0.3.1 | Cold-load-safe `dv.current()` / page resolver |
| `sauce-plugin` | 0.3.3 | Sauce Obsidian plugin shell |
| `task-entity` | 0.16.1 | Shared task-note entity model + row renderer |
| `modal` | 0.2.0 | Shared `SauceModal` dialog primitive |
| `menu-popover` | 0.3.0 | Shared ⋯ menu popover |
| `chrome-bar` | 0.4.3 | Shared breadcrumb+Go+primary+⋯ chrome bar factory |
| `section-explorer` | 0.6.3 | Shared section/doc management (move, bulk-select, delete) |
| `delivery` | 0.7.1 | Shared Delivery execution-contract core (registry, fixtures, semantic API) |
| `engine` | 0.2.0 | Node-based agent execution engine surface (/sauce, template, ranch/engine); always-on |

> Per-mechanism history and rationale: `Docs/cycle-history.md`. Source of truth for versions: `platform/manifest.json`.

## Blueprints (16)

| Name | Version | Slash command | Module dir |
| --- | --- | --- | --- |
| `boards` | 0.3.0 | — | `spice/boards/` |
| `cowork` | 0.41.0 | `/cowork` | `spice/cowork/` |
| `daily` | 0.27.1 | `/daily` | `spice/daily/` |
| `journal` | 0.5.3 | `/journal` | `spice/journal/` |
| `meetings` | 0.19.4 | `/meetings` | `spice/meetings/` |
| `people` | 0.9.0 | — | `spice/people/` |
| `products` | 0.4.0 | `/products` | `spice/products/` |
| `project` | 1.65.0 | `/project` | `spice/projects/` |
| `sticky-notes` | 0.11.7 | `/sticky-notes` | `spice/sticky-notes/` |
| `teams` | 0.4.0 | `/teams` | `spice/teams/` |
| `to-do` | 0.29.1 | — | `spice/to-do/` |
| `trips` | 0.10.3 | — | `spice/trips/` |
| `finance` | 0.23.2 | — | `spice/finance/` |
| `wiki` | 0.8.4 | `/wiki` | `spice/wiki/` |
| `home` | 0.8.7 | `/home` | `spice/home/` |
| `reader` | 0.6.3 | `/reader` | `spice/reader/` |

> Note: table tracks `platform/manifest.json`'s catalogue, not per-blueprint `manifest.json`. The two must match (lockstep gate) — drift is a `check-version-sync.js` violation. Per-blueprint version history: `Docs/cycle-history.md`.

## Test harnesses

180 harness files under `platform/test/run-*.js` (183 steps in `platform/test/preflight-manifest.json`), one per mechanism/blueprint plus cross-cutting suites (seed-vault regression, schema lint, version-sync). Run the full set via `npm run release:preflight`. Per-harness detail and history: `Docs/cycle-history.md`.

Engine harnesses (added in the engine-reintegration cycle; all in the preflight manifest and `package.json`):

| Script | File | Cases |
| --- | --- | :---: |
| `test:engine-graph` | `platform/test/run-engine-graph.js` | 95 |
| `test:engine-smoke` | `platform/test/run-engine-smoke.js` | 39 |
| `test:engine-install` | `platform/test/run-engine-install.js` | 18 |
| `test:engine-delivery-graph` | `platform/test/run-engine-delivery-graph.js` (stub coordinator at `platform/test/fixtures/engine/stub-coordinator.js`) | 34 |

## In-flight / next-candidate queue

Active work is tracked on the bound delivery board — run `/sauce:status` for the live queue. For the full FLN-numbered candidate/deferred backlog and closed-cycle detail, see `Docs/cycle-history.md`.

## Cycle order (chronological)

Full chain from v0.1.0 onward lives in `Docs/cycle-history.md`, including the known v0.50.0–v0.62.0 narrative gap. This file tracks only the live tip (see § Current above).

## Landmines

See `Docs/landmines.md` for the full, canonically-numbered list of traps. Do not duplicate the summary here — it drifts.

## Update protocol

At every cycle close:

1. Run `node scripts/regen-cycle-status.js` (or `--check` to detect drift first). It rewrites `## Current` from `platform/manifest.json` + the latest `Docs/plans/*-result.md`, demoting the prior top entry. The script enforces a 15,360-byte cap on this file and fails loudly if the rewrite would exceed it — trim `## Current`'s "Most recent narrated cycle" prose or move detail to `Docs/cycle-history.md` first.
2. Append the closed cycle's full narrative to `Docs/cycle-history.md` as `## v<X.Y.Z> — <topic> CLOSED <date>`.
3. If mechanisms/blueprints changed, update the tables above from `platform/manifest.json` (name + version only; do not restate full descriptions inline — one line max).
4. Do not add per-harness paragraphs, FLN queue prose, or cycle-order gap notes to this file — they belong in `Docs/cycle-history.md`.
