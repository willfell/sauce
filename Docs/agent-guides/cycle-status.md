---
purpose: Live platform state. Workshop version, mechanism catalogue, blueprint catalogue, harness count, landmines summary, in-flight queue. Updated at every cycle close.
load_when: Starting a session, picking the next cycle, or sanity-checking the current state.
---

# Cycle status (live)

> Closed-cycle narratives are in `Docs/cycle-history.md`. This guide carries only the live pointers. Update both this file AND `Docs/cycle-history.md` at every cycle close (see [build-test-verify.md](build-test-verify.md) § Cycle-close artifacts).

## Current

- **Workshop version:** `0.79.0` (closed 2026-05-29)
- **Most recent cycle:** v0.79.0 cowork-microscope MINOR — closes four gaps surfaced by the headspace 2026-05-29 morning-briefing run (emojis leaking into the body, monochrome callouts, shallow finance contract despite explicit notes, privacy-limited chat MCP). Ships a complete vertical slice: **(WS-A) Microscope** — per-kind USER-owned deep gather contracts at `spice/cowork/prompts/per-mcp/<kind>/microscope.md` authored by the new MCP-tool-aware iterative capture skill `cowork:edit-microscope` (`/cowork microscope <kind>`); when present, the 5 atomic-note orchestrators route the kind through `gather-from-served-by` with the microscope body as the deep `what_matters` and the prior `notes` as `baseline_notes`. Contract file is NOT in cowork's `files[]` (bootstrap-vault-style seeding; never overwritten by `update`/`reinstall`). **(WS-B) Hard rules** — `personality.hard_rules[]` + `personality.no_emojis` parse in `read-user-preferences` → composed `effective_hard_rules[]` propagated to all three output layers: voice-contract Hard-rules block, `gather-from-served-by` dispatch `## Hard rules` section binding callout TITLE + BODY (this is the load-bearing fix for emoji leak in served-by-path kinds), write-run-note skeleton binding paragraph on all 5 sub-skills. Canonical `[!warning]` exempt. **(WS-C) Admonition fix** — styling 0.1.2 → 0.2.0 ships `sauce-callouts.css` defining per-type `--callout-color` for info/note/tip/success/warning/caution/example/quote/danger across light (rose-pine-light) + dark (melange-dark); wired via `applySnippets` (manifest `snippets[]` + `appearance.enabledCssSnippets`). Workshop dogfood materializes `.obsidian/snippets/sauce-callouts.css`. **(WS-D doc-only)** — iMessage `search_contacts` closes number→name gap in-gather; WhatsApp recommend `lharries/whatsapp-mcp` swap for message-level depth (surfaced live by `edit-microscope`'s gap classification). New helper `edit-microscope-helper.js` (pure `resolveKind`/`classifyGap`/`composeMicroscope`). Modified helpers: `read-user-preferences-helper.js`, `dispatch-plan-helper.js`, `gather-from-served-by-helper.js`. 5 orchestrators + 5 write-run-notes carry identical edits (per-cadence range untouched). cowork@0.17.0 → 0.18.0 MINOR. +28 HC-V0790-* sub-asserts in run-cowork-smoke.js + 3 in run-install.js (F1 reinstall preservation, mirrors caseV0760E1 scaffold) + FOCUSED_USER_PATHS extended with the per-mcp glob. CS-MIG-1 cowork counts 36→37 / 45→46. **VISUAL verification of WS-C still owed by user** (Obsidian rendering check — remote-control session had no UI access; snippet + appearance registration verified on disk). 16 stage commits + S17 cycle-close. Final smoke 608 passed / 0 failed; preflight `version-sync ok: 0.79.0` ALL GREEN.

## Cycle order (chronological)

v0.1.0 → v0.1.1 → v0.1.x → v0.1.3 → v0.1.2 → v0.2.0 → v0.3.0 → v0.4.0 → v0.3.2 → v0.4.2 → v0.5.0 → v0.11.0 → v0.12.0 → v0.13.0 → v0.14.0 → v0.6.0 → v0.16.0 → v0.17.0 → v0.18.0/.1/.2 → v0.19.0 → v0.20.0 → v0.21.0/.1 → v0.22.0/.1 → v0.23.0 → v0.24.0 → v0.25.0 → v0.26.0/.1 → v0.27.0 → v0.28.0 → v0.29.0 → v0.30.0 ⏭️ → v0.31.0 → v0.32.0 → v0.33.0/.1 → v0.36.0/.1 → v0.37.0 → v0.38.0/.1 → v0.40.0 → v0.41.0/.5 → v0.42.0 → v0.43.0 → v0.44.0 → v0.45.0 → v0.46.0/.1/.2 → v0.47.0 → v0.48.0 → v0.49.0 → v0.49.1 ⏭️ → v0.49.2 → (v0.50.0–v0.62.0 narratives lost; pre-v0.63 narrative below resumes) → v0.63.0 → v0.63.1 → v0.63.2 → v0.63.3 → v0.64.0 → v0.64.1 → v0.64.2 → v0.64.3 → v0.65.0 → v0.66.0 → v0.66.1 → v0.66.2 → v0.67.0 → v0.67.1 → v0.67.2 → v0.67.3 → v0.70.0 → v0.70.1 → v0.70.2 → v0.70.3 → v0.70.4 → v0.70.5 → v0.70.6 → v0.70.7 → v0.71.0 → v0.71.1 → v0.72.0 → v0.72.1 → v0.73.0 → v0.74.0 → v0.75.0 → v0.75.1 → v0.76.0 → v0.77.0 → v0.78.0 → v0.78.1 → v0.79.0 (current).

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
- **v0.79.0 candidate: `kind_title` field on `mcps.<kind>` blocks** — v0.78.0 uses the bare kind key (e.g., `chat`, `ado`) as the rendered Example title; add an optional `kind_title:` for prettier display strings (e.g., `Microsoft Teams chat`). Pure cosmetic.
- ~~**v0.79.0 candidate: personality hard rules**~~ — CLOSED in v0.79.0 (WS-B). Also reaches the gather dispatch + write-run-note skeleton (not voice-contract-only) since served-by-path callouts were the dominant emoji-leak surface.
- **v0.79.0 candidate: expanded known-kinds catalog** — v0.77.0's catalog is intentionally Minimum-4 (calendar / email / chat / finance). Strong v0.79.0 candidates: drive (Google Drive / Dropbox / S3) / code-platform (GitHub / GitLab) / project-tracker (Linear / Jira / ADO) / monitoring (NewRelic / Datadog / PagerDuty). Custom-kind path covers everything else for now.
- **v0.79.0 candidate: promote frequently-used custom kinds to known** — once post-v0.78.0 deployment usage data exists, promote the most-common user-defined custom kinds into the known catalog so they get hand-curated question sets instead of free-text `what_matters`.
- **v0.79.0 candidate: cross-vault preferences inheritance (`inherits_from:`)** — allow a vault's user-preferences.md to declare it inherits from another vault's (`inherits_from: ../other-vault/spice/cowork/context/user-preferences.md`); useful for users with multiple vaults sharing personality + cross-cutting priorities. Resolution-order spec + cycle-detection guard required.
- **v0.76.0 carry-forward: promote 5 cowork prompts to strict-USER (`materialize_once`) OR formalize the `.bak` behavior** — currently the 5 prompts are USER-DRAFTABLE-WITH-BACKUP (in `files[]` without `materialize_once`; `.bak`'d-then-overwritten via v0.2.0 Option B). Pick one direction and codify it. Still open.
- **v0.79.0 candidate: 5-orchestrator engagement-template fallback parity** (v0.76.0 carry-forward) — v0.76.0's S6 covered eod/weekly/monthly. Morning-briefing + midday-tripwire still rely on implicit `onboard-scheduled-jobs` install-time seeding; add explicit fire-time fallback.
- **v0.79.0 candidate: sc-bridge fallback anchor when calendar empty** (from v0.75.0/v0.75.1) — bridge stays cold when morning-briefing fires with no calendar events; fire sc-bridge with vault-root anchor to keep model warm.
- **v0.79.0 candidate: `--subscribe <mech>=<ver>` CLI flag** (from v0.75.0/v0.75.1) — new-in-workshop mechanism subscription still requires manual jq edit.
- **v0.79.0 candidate: HC-V0751-A1 registry-driven** (from v0.75.1) — hardcodes 3 engagement-type names; should discover dynamically from `platform/blueprints/cowork/engagement-types/*.json`.
- **v0.79.0 candidate: factor shared test utilities** (from v0.75.1) — `assertEqual`/`assertTrue`/UNIT_TEST_MODE duplicated in run-install.js + run-cli.js; extract to `platform/test/harness-utils.js`.
- **v0.79.0 candidate: check-claude-surface harness** (from v0.75.1) — assert dest content matches what source would produce (prevents install.md source-vs-dest drift).
- **v0.80.0 candidate: microscope vertical-slice carry-forwards (from v0.79.0 design §11)** — `contacts-map.md` sibling-file format + gather consumption; WhatsApp MCP-swap follow-through once user adopts `lharries/whatsapp-mcp`; `samples/` sibling dir (cached example outputs per kind); per-kind microscope versioning/changelog; hard-rule post-processor (mechanical emoji-strip / word-budget pass); expanded known-kinds catalog (drive / code-platform / project-tracker / monitoring); cross-vault `inherits_from` for microscope contracts; canonical-gather × microscope hybrid path. Full list in `Docs/plans/2026-05-29-v0.79.0-handoff.md`.
- **FLN-v79-1 (urgent): VISUAL verification of WS-C (sauce-callouts.css)** still owed by user — the remote-control session that closed v0.79.0 had no Obsidian UI access. Snippet + appearance registration verified on disk; need eyeball confirmation that info/warning/tip/example callouts render in DISTINCT colors in the workshop vault. If still monochrome, set non-monochrome callout keys in `platform/mechanisms/styling/data/style-settings-default.json`.
- **FLN-v79-2: `install.js` has no CLI handler** — `node platform/install.js --vault . --auto-approve` silently no-ops (install.js exports `async function(tp)` for Templater; flags ignored). Mid-cycle stage instructions across CLAUDE.md / build-test-verify.md / plan templates use this invocation; should be `node platform/test/run-install.js . --auto-approve`. Either add CLI arg parsing to install.js or sweep the docs.
- **FLN-v79-3: gather-from-served-by 80-char `agent_markdown` floor** is a heuristic guard but trips plausible-looking test fixtures (v0.79.0 plan's HC-V0790-B3/D1 input was 78 chars; padded in S3/S7). Either document the floor in the plan-template HC skeleton or lower it.
- **FLN-v79-4: orchestrator-vs-sub-skill dest convention not codified** — orchestrators flatten to `{{skills_dir}}/<name>/SKILL.md`; sub-skills nest under `{{skills_dir}}/skills/<name>/SKILL.md`. The v0.79.0 plan's S11.4 default put the new orchestrator's dest under the nested form (would have created a path mismatch); corrected inline. Add one-line note to `Docs/agent-guides/architecture.md` or the plan-writing skill.
- **FLN-v79-5: CS-MIG-1 hardcoded counts** require lockstep bumps whenever a cowork claude_surface[] entry is added (v0.79.0 bumped 36→37 / 45→46). Add a plan-template note or auto-derive.
- **FLN-v79-6: `classifyGap` resolution heuristics are tight** — the v0.79.0 `RESOLVING_TOOL_SIGNALS` + `CONTENT_TOOL_SIGNALS` regex lists cover the two motivating cases (iMessage `search_contacts`, WhatsApp privacy-cap). Easy lift; expand as new MCPs surface.

## Mechanisms (16)

| Name | Version | Role |
| --- | --- | --- |
| `customjs-guard` | 1.0.0 | Cold-load TDZ guard for Dataview views |
| `validator` | 0.3.0 | Per-file rules engine + Layer 2 manifest-convention rules |
| `audit` | 0.3.0 | `claude-surface` walker + entity-create walker + `/audit` slash command |
| `nav-buttons` | 2.7.0 | Registry-driven nav-button renderer; consumes icons mechanism |
| `activity-feed` | 0.7.0 | Bucketed activity-feed renderer; framed groups; persisted `<details>` state across re-renders (v0.7.0) |
| `kanban-status-sync` | 0.2.0 | Syncs obsidian-kanban column → frontmatter; NEW `KanbanStatusSyncInit` startup-script class moves sync out of render hot path (v0.2.0) |
| `cards` | 0.2.6 | BeaconCards row/stacked layouts; function-form `meta` opt |
| `accent-button` | 0.1.0 | AccentButton render helper |
| `icons` | 0.1.1 | Lucide kebab → SVG resolver; ~21 vendored Tier 1 SVGs + Obsidian `setIcon` Tier 2 fallback |
| `people-rendering` | 0.1.0 | People page renderers |
| `styling` | 0.2.0 | Vendored sauce theme + CSS variables (v0.79.0: per-type callout-color snippet `sauce-callouts.css`) |
| `convenience` | 0.2.4 | Consumer-default hotkeys/snippets/app-settings |
| `platform-claude` | 0.1.1 | `/install` `/upgrade` `/bootstrap` lifecycle slash commands + CLAUDE.md marker renderer |
| `entity-create` | 0.4.0 | Declarative `new_entity_buttons[]` spec; inside-block JS-comment sentinel; substitution catalogue with `derive`/`validate`/`inline_body` extensions |
| `backlink-panel` | 0.1.0 | Backlink panel renderer |
| `smart-connections-bridge` | 0.1.1 | Node CLI bridge over `.smart-env/multi/*.ajson` for SC semantic retrieval; `--quiet` suppresses non-fatal parse-skip stderr |

Per-mechanism version history is in `Docs/cycle-history.md`. Current canonical catalogue lives at `platform/manifest.json`.

## Blueprints (13)

| Name | Version | Slash command | Module dir |
| --- | --- | --- | --- |
| `boards` | 0.2.1 | — | `spice/boards/` |
| `cowork` | 0.18.0 | — | `spice/cowork/` |
| `daily` | 0.13.0 | `/daily` | `spice/daily/` |
| `journal` | 0.2.0 | — | `spice/journal/` |
| `meetings` | 0.6.0 | `/meetings` | `spice/meetings/` |
| `people` | 0.4.0 | — | `spice/people/` |
| `products` | 0.3.0 | — | `spice/products/` |
| `project` | 1.14.0 | `/project` | `spice/projects/` |
| `scratch` | 0.5.1 | `/scratch` | `spice/scratch/` |
| `teams` | 0.3.0 | — | `spice/teams/` |
| `to-do` | 0.3.3 | — | `spice/to-do/` |
| `trips` | 0.3.0 | — | `spice/trips/` |
| `finance` | 0.4.0 | — | `spice/finance/` |

> Note: this table's blueprint versions track `platform/manifest.json`'s catalogue, not the per-blueprint `manifest.json`. The two must match (lockstep gate); if you see drift, that's a `check-version-sync.js` violation. Per-blueprint version history is in `Docs/cycle-history.md`.

## Test harnesses (23)

Whole-suite GREEN preserved v0.21.0 → current. Files in `platform/test/run-*.js`:

`run-activity-feed`, `run-audit`, `run-backlink-panel`, `run-bootstrap`, `run-claude-surface`, `run-cli`, `run-cowork-smoke`, `run-doctor-self`, `run-entity-create`, `run-helper-cases`, `run-install`, `run-install-sh`, `run-integration-smoke`, `run-migrate`, `run-migrate-frontmatter`, `run-migrate-layout`, `run-registry`, `run-renderer`, `run-seed`, `run-smart-connections-bridge` (NEW v0.75.0), `run-todo-modal` (NEW v0.63.0), `run-validator`, `run-wiki-to-docs-migration`.

v0.75.1 added 11 new cases (HC-V0751-A1, HC-V0751-B1..B4, HC-V0751-C1..C2, HC-V0751-D1, HC-V0751-E1, HC-V0751-H1..H2) distributed across four existing harnesses. No new harness files; file count stays at 23.

v0.76.0 added 16 new cases (HC-V0760-A1, B1..B4, C1..C4, D1..D3, E1, F1..F2, H1) distributed across run-cli.js, run-install.js, run-cowork-smoke.js. No new harness files; file count stays at 23.

v0.77.0 added 11 new cases (HC-V0770-A1..A3, B1..B2, C1..C4, D1, E1) all in run-cowork-smoke.js. No new harness files; file count stays at 23.

v0.78.0 added 14 new cases (HC-V0780-A1..A4, B1..B3, C1..C4, D1..D2, E1) all in run-cowork-smoke.js. No new harness files; file count stays at 23.

v0.78.1 added 2 new cases (HC-V0781-A1, B1) — static SKILL.md prose lints in run-cowork-smoke.js. No new harness files; file count stays at 23.

v0.79.0 added ~30 new sub-asserts distributed across run-cowork-smoke.js (28 — HC-V0790-A1..A3 / B1..B4 / C1..C2 / D1 / E1..E3 / G1; FOCUSED_USER_PATHS extended with the per-mcp glob) and run-install.js (HC-V0790-F1, 3 sub-asserts mirroring caseV0760E1's reinstall scaffold). CS-MIG-1 hardcoded counts bumped 36→37 skill entries / 45→46 contributions in run-claude-surface.js. No new harness files; file count stays at 23. Cowork-smoke final tally: 608 passed / 0 failed.

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
