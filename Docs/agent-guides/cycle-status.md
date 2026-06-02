---
purpose: Live platform state. Workshop version, mechanism catalogue, blueprint catalogue, harness count, landmines summary, in-flight queue. Updated at every cycle close.
load_when: Starting a session, picking the next cycle, or sanity-checking the current state.
---

# Cycle status (live)

> Closed-cycle narratives are in `Docs/cycle-history.md`. This guide carries only the live pointers. Update both this file AND `Docs/cycle-history.md` at every cycle close (see [build-test-verify.md](build-test-verify.md) § Cycle-close artifacts).

## Current

- **Workshop version:** `0.84.3` (closed 2026-06-02)
- **Most recent cycle:** v0.84.3 header-pills PATCH — right-aligned section-header pills for the daily dashboard. Tasks gets orange (`N Open`, with subtle glow) + optional green (`K Done`); Meetings + Activity get a single subtle neutral count pill. `_renderSection` grows `rightHtml` opt parallel to v0.84.1's `titleHtml`. Retired v0.84.1's `.sauce-tasks-done` inline-span. Two lockstep bumps (workshop / daily 0.13.3). 11 HC-V0843-A* sub-asserts replace the 6 retired HC-V0841-C1 cases; HC-V0842-A1 byte-equal guard retained. Single cycle commit. Preflight `version-sync ok: 0.84.3` ALL GREEN.

- **Workshop version (previous):** `0.84.2` (closed 2026-06-02) — v0.84.2 carryforward PATCH. See `Docs/cycle-history.md` for the v0.84.2 narrative.

- **Workshop version (previous):** `0.84.1` (closed 2026-06-02) — v0.84.1 cleanup-1 PATCH. See `Docs/cycle-history.md` for the v0.84.1 narrative.

- **Workshop version (previous):** `0.84.0` (closed 2026-06-02) — v0.84.0 cowork-memory-layer MINOR. See `Docs/cycle-history.md` for the v0.84.0 narrative.

- **Workshop version (previous):** `0.83.0` (closed 2026-06-01) — v0.83.0 cowork-engagement-type-materialization MINOR. See `Docs/cycle-history.md` for the v0.83.0 narrative.

- **Workshop version (previous, retained for reference):** v0.83.0 cowork-engagement-type-materialization MINOR — closes FLN-v82-1 (engagement-type accessibility). 3 engagement-type JSONs (`w2-fte.json`, `personal.json`, `consulting.json`) added to cowork's `files[]`; materialize to `spice/cowork/context/engagement-types/` on consumer vaults. All 7 cowork orchestrators updated to read from the canonical materialized path. `eod-review`, `weekly-review`, `monthly-review` gain explicit engagement-not-found guard (matching morning-briefing + midday-tripwire baseline). STOCK row added to `cowork-customization-contract.md`. Workshop 0.82.1 → 0.83.0; cowork 0.21.1 → 0.22.0 (MINOR — new install surface). ~10 cases / ~14 HC-V0830-* sub-asserts (A/B/C/D groups); HC-V0750-C1/C3 updated (S4.1 follow-up). 9 stage commits + S7 cycle-close. Preflight `version-sync ok: 0.83.0` ALL GREEN. 3 new lessons surfaced; FLN-v83-1 surfaced (orchestrator prose-consistency lint candidate).

- **Workshop version (previous):** `0.82.1` (closed 2026-06-01) — v0.82.1 fln-cleanup-bundle-2 PATCH. See `Docs/cycle-history.md` for the v0.82.1 narrative.

- **Workshop version (previous, retained for reference):** v0.82.1 fln-cleanup-bundle-2 PATCH — 4 FLN cleanups (FLN-v82-2 resetSourceContributions + per-item-loop wiring + cowork PATCH bump 0.21.0→0.21.1 to clear landmine-#16 version-skip guard; FLN-v82-3 parseYamlIsh hyphen-key support; FLN-v81-1 semver-helper.js extraction + 3 floor-assertion sites refactored; FLN-v79-5 CS-MIG-1 counts derived from manifest.claude_surface[] groupBy — 4 hardcoded magic numbers removed). `ranch/rules/cowork.json` natural shrink 7929→635 lines / 281→22 entries at S8 dogfood. Workshop 0.82.0 → 0.82.1; cowork 0.21.0 → 0.21.1 (PATCH, mechanism-internal, mid-cycle scope expansion). ~10 HC-V0821-* sub-asserts (A1.1a, A1.1b, A1.2, A1.3, B1.1, B1.2, C1.1..C1.4). 9 stage commits + S8.1 + S9 cycle-close. Preflight `version-sync ok: 0.82.1` ALL GREEN. 3 new FLNs surfaced: FLN-v821-1 (V0750-VERSION exact-version assertions), FLN-v821-2 (installItem version-skip + new in-loop mechanism), FLN-v821-3 (S0 verification pattern for cleanup FLNs).

- **Workshop version (previous):** `0.82.0` (closed 2026-06-01) — v0.82.0 callout-types-tables-and-tripwire MINOR. See `Docs/cycle-history.md` for the v0.82.0 narrative.

- **Workshop version (previous, retained for reference):** v0.82.0 callout-types-tables-and-tripwire MINOR — two coherent UX-polish workstreams on top of v0.79+v0.80+v0.81's structural foundation. **WS-A** per-kind callout types: `read-user-preferences-helper.js` resolves `mcps.<kind>.callout_type` per kind (explicit OR default mapping OR `example`); `gather-from-served-by-helper.js` accepts `callout_type` input + parameterizes `[!<callout_type>]+ <kind_title>` prefix + echoes `callout_type_used`; 5 atomic-note orchestrators pass `callout_type: prefs.mcps[entry.kind_name].callout_type` in the gather loop. Default mapping: chat→info, finance→warning, calendar→tip, email→quote, ado→example, github→note. Result: morning briefings now render 5-6 kind sections in 5-6 visually-distinct colors via existing v0.79.0 per-type CSS. **WS-B** gather contract softening: Step 3 "Bulleted lines preferred (no tables)" prohibition replaced with table-or-bullet decision rule; microscope `## Output shape` directives explicitly noted as overriding. **WS-C dropped** at S0 — plan premise was wrong (w2-fte.json fix was already done in v0.13.0; engagement-type JSONs aren't materialized to consumer vaults). Real fix folded into FLN-v82-1. cowork@0.20.1 → 0.21.0 MINOR. ~17 HC-V0820-* sub-asserts added (A1..A4, B1..B3, C1..C3, D1). 9 stage commits + S10 cycle-close. Preflight `version-sync ok: 0.82.0` ALL GREEN.

- **Workshop version (previous):** `0.81.1` (closed 2026-05-30) — v0.81.1 cowork-slash-doc-fix PATCH. See `Docs/cycle-history.md` for the v0.81.1 narrative.

- **Workshop version (previous, retained for reference):** v0.81.1 cowork-slash-doc-fix PATCH — single doc fix: `platform/blueprints/cowork/commands/cowork.md` (the `/cowork` slash command body) gains a `## /cowork audit-siblings [<kind>] (v0.81.0)` section paralleling the existing v0.79.0 microscope section. Closes a v0.81.0 carry-forward gap surfaced during pre-test vetting: the audit-siblings skill materialized correctly in consumer vaults, but the slash command body didn't document how to invoke it. Without the doc entry, Will running `/cowork audit-siblings` (per tomorrow's headspace test plan Step 7) would rely on Claude Code's skill auto-discovery, which is risky for test confidence. The fix adds an explicit invocation section with em-dash UX hardening callout. cowork@0.20.0 → 0.20.1 PATCH (content change triggers re-materialization of cowork.md slash body in consumer vaults). HC-V0811-A1 added to run-cowork-smoke.js (prose-lint asserting slash body mentions audit-siblings sub-command + names the skill). 4 stage commits + S4 cycle-close. Preflight `version-sync ok: 0.81.1` ALL GREEN.

- **Workshop version (previous):** `0.81.0` (closed 2026-05-30) — v0.81.0 cowork-audit-siblings MINOR. See `Docs/cycle-history.md` for the v0.81.0 narrative.

- **Workshop version (previous, retained for reference):** v0.81.0 cowork-audit-siblings MINOR — new pure-read-only `cowork:audit-siblings` orchestrator skill closes the silent-degradation gap v0.80.0 left open. Two-axis check: dangling references (`microscope.md` names a sibling that's absent → `[!warning]`) + orphan files (sibling present but unreferenced → `[!info]`). New helper exports `parseReferences` + `auditSiblings` (pure, deterministic, sorted by (kind, name); em-dash separator required). New SKILL.md at orchestrator-tier dest `{{skills_dir}}/audit-siblings/SKILL.md` with em-dash UX hardening note. cowork@0.19.0 → 0.20.0 MINOR. CS-MIG-1 counts 37→38 / 46→47 (lockstep dance closed). +26 HC-V0810-* sub-asserts in run-cowork-smoke.js + 1 in run-claude-surface.js. 7 stage commits + S8 cycle-close. **FLN-v81-1 surfaced + partially mitigated:** semver-regex assertions across 3 test files widened from 0.8.x-0.19.x to 0.8.x-0.29.x (ceiling now at 0.30.x). Preflight `version-sync ok: 0.81.0` ALL GREEN. Cycle executed subagent-driven-development style.

- **Workshop version (previous):** `0.80.1` (closed 2026-05-30) — v0.80.1 fln-cleanup-bundle PATCH. See `Docs/cycle-history.md` for the v0.80.1 narrative.

- **Workshop version (previous, retained for reference):** v0.80.1 fln-cleanup-bundle PATCH — closes 5 documented footguns from prior cycles. FLN-v79-2: `install.js` CLI handler so `node install.js --vault . --auto-approve` actually works (was silently no-op'ing); +2 in-stage hardening fixes (--vault no-value, --auto-approve/--decline-all mutual exclusion). FLN-v80-1: softened HC-V0800-A1 per-mcp glob regex to accept split phrasing. FLN-v79-3: 80-char `agent_markdown` floor documented in build-test-verify.md `## Writing HC cases`. FLN-v79-4: orchestrator-vs-sub-skill dest convention in architecture.md. FLN-v80-2: landmine #16 entry updated to note `materializeClaudeSurface` SKILL.md catch-up posture. No contract surface change; pure cleanup. 6 stage commits + S6 cycle-close. Cycle executed subagent-driven-development style. Preflight `version-sync ok: 0.80.1` ALL GREEN.

- **Workshop version (previous):** `0.80.0` (closed 2026-05-30) — v0.80.0 cowork-sibling-files MINOR. See `Docs/cycle-history.md` for the v0.80.0 narrative.

- **Workshop version (previous, retained for reference):** v0.80.0 cowork-sibling-files MINOR — closes the third resolution path in `cowork:edit-microscope`'s gap-finding triad (the `user-supplied` placeholder from v0.79.0). New convention: any markdown file in `spice/cowork/prompts/per-mcp/<kind>/` except `microscope.md` and `_*.md` is a USER-owned context surface; orchestrators discover via new step 2c (glob + filter); `gather-from-served-by` injects each verbatim under `**User-supplied reference: <name>**` in dispatch contract Step 3 (after `what_matters`, before `**Hard rules ...**`), echoes back `siblings_used[]`. `cowork:edit-microscope` step 4 user-supplied branch pre-checks existence + scaffolds via new `composeSibling` helper (gap-text-keyed column heuristic: phone/email/account/vip/generic) + writes `## References` into `microscope.md` via extended `composeMicroscope`. cowork@0.18.0 → 0.19.0 MINOR. +43 HC-V0800-* sub-asserts (A1..A3, B1..B3, C1..C6, D1..D3, E1) in run-cowork-smoke.js + 3 in run-install.js (F1). No CS-MIG-1 count change. 12 stage commits + S12 cycle-close. Preflight `version-sync ok: 0.80.0` ALL GREEN.

- **Workshop version (previous):** `0.79.0` (closed 2026-05-29) — v0.79.0 cowork-microscope MINOR. See `Docs/cycle-history.md` for the v0.79.0 narrative.

- **Workshop version (previous, retained for reference):** v0.79.0 cowork-microscope MINOR — closes four gaps surfaced by the headspace 2026-05-29 morning-briefing run (emojis leaking into the body, monochrome callouts, shallow finance contract despite explicit notes, privacy-limited chat MCP). Ships a complete vertical slice: **(WS-A) Microscope** — per-kind USER-owned deep gather contracts at `spice/cowork/prompts/per-mcp/<kind>/microscope.md` authored by the new MCP-tool-aware iterative capture skill `cowork:edit-microscope` (`/cowork microscope <kind>`); when present, the 5 atomic-note orchestrators route the kind through `gather-from-served-by` with the microscope body as the deep `what_matters` and the prior `notes` as `baseline_notes`. Contract file is NOT in cowork's `files[]` (bootstrap-vault-style seeding; never overwritten by `update`/`reinstall`). **(WS-B) Hard rules** — `personality.hard_rules[]` + `personality.no_emojis` parse in `read-user-preferences` → composed `effective_hard_rules[]` propagated to all three output layers: voice-contract Hard-rules block, `gather-from-served-by` dispatch `## Hard rules` section binding callout TITLE + BODY (this is the load-bearing fix for emoji leak in served-by-path kinds), write-run-note skeleton binding paragraph on all 5 sub-skills. Canonical `[!warning]` exempt. **(WS-C) Admonition fix** — styling 0.1.2 → 0.2.0 ships `sauce-callouts.css` defining per-type `--callout-color` for info/note/tip/success/warning/caution/example/quote/danger across light (rose-pine-light) + dark (melange-dark); wired via `applySnippets` (manifest `snippets[]` + `appearance.enabledCssSnippets`). Workshop dogfood materializes `.obsidian/snippets/sauce-callouts.css`. **(WS-D doc-only)** — iMessage `search_contacts` closes number→name gap in-gather; WhatsApp recommend `lharries/whatsapp-mcp` swap for message-level depth (surfaced live by `edit-microscope`'s gap classification). New helper `edit-microscope-helper.js` (pure `resolveKind`/`classifyGap`/`composeMicroscope`). Modified helpers: `read-user-preferences-helper.js`, `dispatch-plan-helper.js`, `gather-from-served-by-helper.js`. 5 orchestrators + 5 write-run-notes carry identical edits (per-cadence range untouched). cowork@0.17.0 → 0.18.0 MINOR. +28 HC-V0790-* sub-asserts in run-cowork-smoke.js + 3 in run-install.js (F1 reinstall preservation, mirrors caseV0760E1 scaffold) + FOCUSED_USER_PATHS extended with the per-mcp glob. CS-MIG-1 cowork counts 36→37 / 45→46. **VISUAL verification of WS-C still owed by user** (Obsidian rendering check — remote-control session had no UI access; snippet + appearance registration verified on disk). 16 stage commits + S17 cycle-close. Final smoke 608 passed / 0 failed; preflight `version-sync ok: 0.79.0` ALL GREEN.

## Cycle order (chronological)

v0.1.0 → v0.1.1 → v0.1.x → v0.1.3 → v0.1.2 → v0.2.0 → v0.3.0 → v0.4.0 → v0.3.2 → v0.4.2 → v0.5.0 → v0.11.0 → v0.12.0 → v0.13.0 → v0.14.0 → v0.6.0 → v0.16.0 → v0.17.0 → v0.18.0/.1/.2 → v0.19.0 → v0.20.0 → v0.21.0/.1 → v0.22.0/.1 → v0.23.0 → v0.24.0 → v0.25.0 → v0.26.0/.1 → v0.27.0 → v0.28.0 → v0.29.0 → v0.30.0 ⏭️ → v0.31.0 → v0.32.0 → v0.33.0/.1 → v0.36.0/.1 → v0.37.0 → v0.38.0/.1 → v0.40.0 → v0.41.0/.5 → v0.42.0 → v0.43.0 → v0.44.0 → v0.45.0 → v0.46.0/.1/.2 → v0.47.0 → v0.48.0 → v0.49.0 → v0.49.1 ⏭️ → v0.49.2 → (v0.50.0–v0.62.0 narratives lost; pre-v0.63 narrative below resumes) → v0.63.0 → v0.63.1 → v0.63.2 → v0.63.3 → v0.64.0 → v0.64.1 → v0.64.2 → v0.64.3 → v0.65.0 → v0.66.0 → v0.66.1 → v0.66.2 → v0.67.0 → v0.67.1 → v0.67.2 → v0.67.3 → v0.70.0 → v0.70.1 → v0.70.2 → v0.70.3 → v0.70.4 → v0.70.5 → v0.70.6 → v0.70.7 → v0.71.0 → v0.71.1 → v0.72.0 → v0.72.1 → v0.73.0 → v0.74.0 → v0.75.0 → v0.75.1 → v0.76.0 → v0.77.0 → v0.78.0 → v0.78.1 → v0.79.0 → v0.80.0 → v0.80.1 → v0.81.0 → v0.81.1 → v0.82.0 → v0.82.1 → v0.83.0 → v0.84.0 → v0.84.1 → v0.84.2 → v0.84.3 (current).

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
- **v0.81+ candidate: microscope vertical-slice carry-forwards (from v0.79.0 design §11)** — ~~`contacts-map.md` sibling-file format + gather consumption~~ CLOSED in v0.80.0; WhatsApp MCP-swap follow-through once user adopts `lharries/whatsapp-mcp`; `samples/` sibling dir (cached example outputs per kind); per-kind microscope versioning/changelog; hard-rule post-processor (mechanical emoji-strip / word-budget pass); expanded known-kinds catalog (drive / code-platform / project-tracker / monitoring); cross-vault `inherits_from` for microscope contracts; canonical-gather × microscope hybrid path. Full list in `Docs/plans/2026-05-29-v0.79.0-handoff.md`.
- **v0.81+ candidate: sibling-file vertical-slice carry-forwards (from v0.80.0 design §11)** — interactive editing of EXISTING sibling content (v0.80.0 scaffolds only); dedicated `/cowork sibling <kind> <name>` slash command (decoupled from edit-microscope); typed sibling parsers + deterministic pre-agent substitution (vs. v0.80's opaque-injection model); hard-rule-style post-processor for sibling-application compliance (overlaps with v0.79.0 §5); sibling-file versioning/changelog; multiple-microscope-per-kind (cadence-specific); soft-limit warning for very large sibling files (>50KB); sibling-file-aware reverse audit (verify `## References` entries point to extant files). Full list in `Docs/plans/2026-05-30-v0.80.0-handoff.md`.
- ~~**FLN-v80-1: HC-V0800-A1 glob-prose regex over-strict.**~~ — CLOSED in v0.80.1. Regex softened in `run-cowork-smoke.js` to accept either the literal `per-mcp/<kind_name>/*.md` substring OR a split `per-mcp/<kind_name>/` + "matching `*.md`" phrasing (`hasLiteralGlob || hasSplitPhrasing` boolean OR; 7-line change; sub-assert count unchanged at 1).
- ~~**FLN-v80-2: landmine #16 less load-bearing than v0.79.0 close documented.**~~ — CLOSED in v0.80.1. `Docs/landmines.md` entry #16 narrative extended with the v0.80.0 + v0.80.1 observation that `materializeClaudeSurface` keeps SKILL.md dests current per-install regardless of the per-item version short-circuit.
- **FLN-v80-3: result-doc structure stability.** v0.79.0 + v0.80.0 result docs follow the same structure. Worth codifying in a result-doc template skill if cycle-close documentation continues at this volume.
- **2026-05-30 night plan (in-flight tonight):** 3-session roadmap — Session 1 (polish + test plan, no version bump) → Session 2 (v0.80.1 PATCH bundling FLN-v79-2/v79-3/v79-4/v80-1/v80-2) → Session 3 (v0.81.0 MINOR shipping `cowork:audit-siblings` reverse-audit skill). Design: `Docs/plans/2026-05-30-night-plan-design.md`. Headspace test plan for tomorrow morning: `Docs/plans/2026-05-30-headspace-test-plan.md`.
- **FLN-v79-1 (urgent): VISUAL verification of WS-C (sauce-callouts.css)** still owed by user — the remote-control session that closed v0.79.0 had no Obsidian UI access. Snippet + appearance registration verified on disk; need eyeball confirmation that info/warning/tip/example callouts render in DISTINCT colors in the workshop vault. If still monochrome, set non-monochrome callout keys in `platform/mechanisms/styling/data/style-settings-default.json`.
- ~~**FLN-v79-2: `install.js` has no CLI handler**~~ — CLOSED in v0.80.1. install.js now detects `require.main === module` + parses `--vault <path>` + passthrough flags + delegates to run-install.js via subprocess. Two in-stage hardening fixes added: --vault no-value detection + --auto-approve/--decline-all mutual exclusion. HC-V0801-A1 verifies subprocess spawn end-to-end (4 sub-asserts).
- ~~**FLN-v79-3: gather-from-served-by 80-char `agent_markdown` floor**~~ — CLOSED in v0.80.1. Documented in `Docs/agent-guides/build-test-verify.md` `## Writing HC cases` with the canonical 4-line fixture pattern + the +1-bullet fix that recovers under-floor inputs.
- ~~**FLN-v79-4: orchestrator-vs-sub-skill dest convention not codified**~~ — CLOSED in v0.80.1. `Docs/agent-guides/architecture.md` now contains an orchestrator-vs-sub-skill dest convention paragraph: orchestrators flatten to `{{skills_dir}}/<name>/SKILL.md`; sub-skills nest under `{{skills_dir}}/skills/<name>/SKILL.md`.
- ~~**FLN-v79-5: CS-MIG-1 hardcoded counts**~~ — CLOSED in v0.82.1. `run-claude-surface.js` now derives expected counts from `platform/manifest.json` at runtime via `groupBy(claude_surface[], source)`; 4 hardcoded magic numbers (47/38/3/6) removed. Future `claude_surface[]` additions require no harness edits.
- **FLN-v79-6: `classifyGap` resolution heuristics are tight** — the v0.79.0 `RESOLVING_TOOL_SIGNALS` + `CONTENT_TOOL_SIGNALS` regex lists cover the two motivating cases (iMessage `search_contacts`, WhatsApp privacy-cap). Easy lift; expand as new MCPs surface.
- ~~**FLN-v81-1: semver-regex ceiling.**~~ — CLOSED in v0.82.1. New `platform/test/helpers/semver-helper.js` exports `versionAtLeast(version, floor)`. 3 cowork-version-floor assertion sites in `run-cowork-smoke.js`, `run-claude-surface.js`, `run-helper-cases.js` refactored from hardcoded regex to `versionAtLeast()` calls. No ceiling at any semver version.
- **FLN-v81-2: M3 em-dash UX hardening.** `audit-siblings-helper.js`'s `ENTRY_RX` regex requires em-dash `—` (U+2014; matches `composeMicroscope`'s output) but this requirement is invisible to a user hand-editing `microscope.md`. Folded into SKILL.md prose at S4 as a hardening note. Future plan-template wisdom: when a parser depends on a non-obvious character (em-dash, NBSP, ZWJ), document it in the user-facing SKILL.md prose, not just helper code comments.
- ~~**FLN-v82-1: engagement-type-accessibility fix.**~~ — CLOSED in v0.83.0. All 3 engagement-type JSONs (`w2-fte.json`, `personal.json`, `consulting.json`) added to cowork's `files[]`; materialize to `spice/cowork/context/engagement-types/` on consumer vaults. All 7 orchestrators read from the canonical materialized path. STOCK row added to customization contract. cowork 0.21.1 → 0.22.0 MINOR. Preflight `version-sync ok: 0.83.0` ALL GREEN.
- **FLN-v83-1 (next-cycle candidate): orchestrator SKILL.md prose-consistency lint.** Surfaced from v0.83.0 S3/S4/S4.2 plan-inheritance gaps. No HC case currently asserts that each cowork orchestrator's Step 2 contains BOTH (a) the canonical engagement-type materialized-path Read AND (b) a `If not found, exit silently.` or `emit Notice ... and exit.` guard. A future prose-lint HC case would catch plan-spec drift across orchestrators before it ships. ~1-2 stages (write failing test + wire assertions per orchestrator).
- **FLN-v84-1 (NEW — v0.85.0 MINOR candidate): Tier 2 (weekly synthesis) + Tier 3 (monthly synthesis) deferred.** Tier 0 (capture-tick) + Tier 1 (synthesize-day) shipped in v0.84.0. Tier 2 synthesizes daily summaries into a weekly roll-up; Tier 3 synthesizes weekly summaries into a monthly roll-up. Both are well-specified in the v0.84.0 design doc. v0.85.0 MINOR candidate; could bundle with FLN-v84-2.
- **FLN-v84-2 (NEW — v0.85.0+ MINOR candidate): wire-through to midday-tripwire / eod-review / weekly-review / monthly-review deferred.** Each orchestrator could read recent memory (parallel to morning-briefing's step 3a wire-through). Each needs its own pre-flight step + body composition update. Could bundle with FLN-v84-1 in a v0.85.0 MINOR cycle.
- **FLN-v84-3 (NEW — design candidate): memory retention / compression policy.** Memory files accumulate indefinitely. At 1-2 ticks/day × ~50 lines/tick, a year-long active engagement accumulates ~73k lines. A rolling summarization or date-based archival policy will eventually be needed. Design-only until compression logic is scoped.
- **FLN-v841-1 (NEW — v0.85.0+ candidate): test-pin equality helper.** More test-pin sites use hardcoded version strings (SHC-S1, FA6-MANIFEST, AF-1d, AF-V065). FLN-v81-1 closed three pin sites by adopting `versionAtLeast()`; the remaining hardcoded-equality sites surfaced again at v0.84.1 S7. Future cycle could extend `semver-helper.js` with a `versionEquals()` helper and refactor the equality sites where exact pinning is intentional (vs. converting to floor checks where appropriate).
- **FLN-v841-2 (NEW — long-term candidate): prune stale defaultClosed group state.** Activity-feed group state persistence is now asymmetric: `defaultClosed` groups skip reading persistence but still write to it. Toggling a `defaultClosed` group open still persists `open:true` to `dashboard-section-state.json`; that value is just ignored on subsequent renders. Cleanup: prune persisted state entries for groups currently in `defaultClosed` at write time.
- **FLN-v842-1 (NEW — v0.85.0+ small candidate): make `--bump-pins` the implicit default for `sauce update`.** Today consumers must remember to pass `--bump-pins` to actually pick up new workshop versions; plain `sauce update` re-applies current pins and (combined with landmine #16's version-equal short-circuit) silently no-ops the per-item install loop. For the "always track latest" usage pattern across all 4 consumer vaults, this is a footgun the user hits every release. Proposed: flip the default to bump-pins-on; add `--no-bump-pins` for the legacy idempotent-reinstall behavior. One-line CLI change in `platform/cli/verbs/update.js`. Update install.md doc + the build-test-verify.md release-workflow narrative accordingly. PATCH-cycle scope.
- **FLN-v84-4 (NEW — long-term candidate): Smart Connections semantic retrieval over memory notes.** `spice/cowork/memory/**` is a natural corpus for semantic similarity queries. Future cycle could wire `sc-bridge` (or equivalent) to surface relevant past context beyond the most-recent-file read. Aligns with the Smart Connections candidate in project memory.
- ~~**FLN-v82-2: ranch/rules/cowork.json dedup.**~~ — CLOSED in v0.82.1. NEW `resetSourceContributions(contributions, sourceName)` helper in `install.js` + wired into per-item install loop. `ranch/rules/cowork.json` shrank 7929→635 lines / 281→22 entries at S8 dogfood. Design pivoted at S0.3 from key-based dedup to per-source reset (two scope shapes in the real file; object-form + string-form; key-based dedup would have dropped string-scope entries). cowork PATCH bump 0.21.0→0.21.1 added mid-cycle to clear landmine-#16 version-skip guard and validate end-to-end.
- ~~**FLN-v82-3: parseYamlIsh hyphenated-key support.**~~ — CLOSED in v0.82.1. `context-builder-dry-run.js#parseYamlIsh` flat-key regex widened from `/^([a-z_]+):/` to `/^([a-z_][a-z0-9_-]*):/`. Hyphenated MCP kinds (e.g., `lharries-whatsapp`, `sharepoint-online`) can now appear in `user-preferences.md` without being silently dropped. HC-V0821-B1.1/B1.2 added.
- **FLN-v821-1: V0750-VERSION exact-version assertions.** `run-cowork-smoke.js` carries a hardcoded `V0750-VERSION` exact-version pin asserting `cowork === X.Y.Z` (distinct from floor checks covered by FLN-v81-1's `versionAtLeast()`). When cowork bumped 0.21.0 → 0.21.1 at S8.1, this pin broke and required a manual edit. Candidate fix: extend `semver-helper.js` with `versionEquals(version, expected)` + refactor all exact-pin sites; or migrate pins to floor checks where semantically appropriate.
- **FLN-v821-2: installItem version-skip + new in-loop mechanism interaction.** When new logic is introduced INSIDE the per-item install loop (e.g., `resetSourceContributions`), `install.js:223`'s per-item version-skip guard silently bypasses it unless the blueprint's version bumps. Discovered at v0.82.1 S8: production dogfood short-circuited cowork's loop body entirely (version unchanged), requiring a co-occurring PATCH bump (S8.1) to validate end-to-end. Plan-template addition candidate: for any cycle touching `installItem`-internal logic, mandate a co-occurring blueprint PATCH bump as part of the dogfood stage. Landmine #23 candidate.
- **FLN-v821-3: S0 verification pattern for cleanup FLNs.** The v0.82.1 S0.3 divergent-bodies check caught a design-assumption error (two scope shapes, not one) before committing a buggy dedup key that would have silently dropped all string-scope entries. Candidate fix: add a "S0 data-shape verification" protocol to the cleanup-cycle plan template or `Docs/agent-guides/build-test-verify.md` — for any cleanup FLN touching an accumulator on real-world production files, enumerate all value shapes before writing any code.

## Mechanisms (16)

| Name | Version | Role |
| --- | --- | --- |
| `customjs-guard` | 1.0.0 | Cold-load TDZ guard for Dataview views |
| `validator` | 0.3.0 | Per-file rules engine + Layer 2 manifest-convention rules |
| `audit` | 0.3.0 | `claude-surface` walker + entity-create walker + `/audit` slash command |
| `nav-buttons` | 2.7.0 | Registry-driven nav-button renderer; consumes icons mechanism |
| `activity-feed` | 0.7.1 | Bucketed activity-feed renderer; framed groups; persisted `<details>` state across re-renders (v0.7.0); numeric ISO compare + defaultClosed gate fix (v0.7.1) |
| `kanban-status-sync` | 0.2.0 | Syncs obsidian-kanban column → frontmatter; NEW `KanbanStatusSyncInit` startup-script class moves sync out of render hot path (v0.2.0) |
| `cards` | 0.2.6 | BeaconCards row/stacked layouts; function-form `meta` opt |
| `accent-button` | 0.1.0 | AccentButton render helper |
| `icons` | 0.1.1 | Lucide kebab → SVG resolver; ~21 vendored Tier 1 SVGs + Obsidian `setIcon` Tier 2 fallback |
| `people-rendering` | 0.1.0 | People page renderers |
| `styling` | 0.2.1 | Vendored sauce theme + CSS variables (v0.79.0: per-type callout-color snippet `sauce-callouts.css`); `.sauce-tasks-done` CSS rule (v0.2.1) |
| `convenience` | 0.2.4 | Consumer-default hotkeys/snippets/app-settings |
| `platform-claude` | 0.1.2 | `/install` `/upgrade` `/bootstrap` lifecycle slash commands + CLAUDE.md marker renderer |
| `entity-create` | 0.4.0 | Declarative `new_entity_buttons[]` spec; inside-block JS-comment sentinel; substitution catalogue with `derive`/`validate`/`inline_body` extensions |
| `backlink-panel` | 0.1.0 | Backlink panel renderer |
| `smart-connections-bridge` | 0.1.1 | Node CLI bridge over `.smart-env/multi/*.ajson` for SC semantic retrieval; `--quiet` suppresses non-fatal parse-skip stderr |

Per-mechanism version history is in `Docs/cycle-history.md`. Current canonical catalogue lives at `platform/manifest.json`.

## Blueprints (13)

| Name | Version | Slash command | Module dir |
| --- | --- | --- | --- |
| `boards` | 0.2.1 | — | `spice/boards/` |
| `cowork` | 0.23.0 | — | `spice/cowork/` |
| `daily` | 0.13.1 | `/daily` | `spice/daily/` |
| `journal` | 0.2.0 | — | `spice/journal/` |
| `meetings` | 0.6.0 | `/meetings` | `spice/meetings/` |
| `people` | 0.4.0 | — | `spice/people/` |
| `products` | 0.3.0 | — | `spice/products/` |
| `project` | 1.14.0 | `/project` | `spice/projects/` |
| `scratch` | 0.5.2 | `/scratch` | `spice/scratch/` |
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

v0.80.0 added ~43 new sub-asserts in run-cowork-smoke.js (HC-V0800-A1..A3 / B1..B3 / C1..C6 / D1..D3 / E1) + 3 in run-install.js (HC-V0800-F1 mirrors v0.79.0 F1 scaffold with a non-microscope sibling sentinel `vip-list.md` under `chat` kind to prove preservation generality across per-mcp/**). No new harness files; file count stays at 23. No CS-MIG-1 count change (no new claude_surface[] entry — `composeSibling` + `composeMicroscope` extension are helper-only; orchestrator step 2c + edit-microscope SKILL.md step 4 expansion add no new dest). Cowork-smoke final tally: 651 passed / 0 failed.

v0.80.1 added 4 new sub-asserts in run-install.js (HC-V0801-A1 install.js CLI handler — no-args usage hint + real --vault invocation + sentinel-written verification + tightened exit-code-2 pinning, via subprocess spawn against a consumer-bootstrap-shape synthetic fixture). No new cowork-smoke cases; 1 logical relaxation on HC-V0800-A1 (FLN-v80-1 closure; sub-assert count unchanged). No new harness files; file count stays at 23. No CS-MIG-1 count change. Cowork-smoke final tally: 655 passed / 0 failed (+4 from somewhere in the suite during S2/S3 — see harness output); install-harness +4 sub-asserts.

v0.81.0 added ~26 new sub-asserts in run-cowork-smoke.js (HC-V0810-A1..A4 / B1..B6 / C1) + 1 in run-claude-surface.js (CS-MIG-1 count bump for the new audit-siblings claude_surface entry; 37→38 skill entries / 46→47 total contributions). No new harness files; file count stays at 23. New orchestrator-tier skill + helper materialize into `.claude/skills/cowork/audit-siblings/SKILL.md`. Cowork-smoke final tally: ~688 passed / 0 failed.

v0.81.1 added 1 new sub-assert in run-cowork-smoke.js (HC-V0811-A1 — prose-lint asserting the `/cowork` slash command body at `platform/blueprints/cowork/commands/cowork.md` documents the `audit-siblings` sub-command + names the `cowork:audit-siblings` skill). No new harness files; file count stays at 23. No CS-MIG-1 count change (doc-only fix to existing cowork.md surface). Cowork-smoke final tally: 685 passed / 0 failed.

v0.82.0 added ~17 new sub-asserts in run-cowork-smoke.js (HC-V0820-A1..A4 / B1..B3 / C1..C3 / D1; E1..E3 dropped with WS-C). No new harness files; file count stays at 23. No CS-MIG-1 count change (no new claude_surface[] entry — WS-A is helper + SKILL.md + orchestrator content edits only). Cowork-smoke final tally: 713 passed / 0 failed.

v0.82.1 added ~10 new sub-asserts: HC-V0821-A1.1a, A1.1b, A1.2, A1.3 (resetSourceContributions semantics) + B1.1, B1.2 (parseYamlIsh hyphen-key) in run-helper-cases.js; HC-V0821-C1.1..C1.4 (manifest-derived CS-MIG-1 counts) in run-claude-surface.js. New `platform/test/helpers/semver-helper.js` added (shared helper; not a harness file). No new run-*.js harness files; file count stays at 23. CS-MIG-1 count posture UNCHANGED at 47/38/3/6 (manifest unchanged; only assertion mechanic changed — now derived dynamically).

v0.83.0 added ~10 cases / ~14 new sub-asserts: HC-V0830-A1..A3 (materialization: files[] presence + path resolution + field correctness) + HC-V0830-B1..B5 (atomic-note orchestrators read materialized path) + HC-V0830-C1..C2 (bootstrap-vault + onboard-scheduled-jobs) + HC-V0830-D1 (prose-lint: engagement-not-found guard) distributed across run-install.js and run-cowork-smoke.js. HC-V0750-C1 + C3 updated (S4.1 follow-up — modified, not new sub-asserts). No new run-*.js harness files; file count stays at 23. CS-MIG-1 count posture UNCHANGED at 47/38/3/6 (no new claude_surface[] entries; manifest-derived counts absorb automatically).

v0.84.0 added ~14 cases / ~29 actual sub-asserts: HC-V0840-A1..A3 (capture-tick orchestrator prose-lint + output contract) + HC-V0840-B1..B3 (synthesize-day orchestrator prose-lint + output contract) + HC-V0840-C1..C2 (morning-briefing pre-flight step 3a + null-data gate) + HC-V0840-D1 (engagement-type schema 0.4.0: supported_cadences + default_cadences across all 3 types; 12 sub-asserts) + HC-V0840-E1..E2 (onboard-scheduled-jobs cadence walk + Cowork.md resolver) + HC-V0840-F1 (customization contract STOCK row for memory/**) all in run-cowork-smoke.js. 4 pre-existing gaps closed at S7.1: HC-V0710-1c (cowork-memory discriminator_tags entry) + HC-V0740-1 (engagement-type exact-version pin 0.3.1 → 0.4.0). Started at 754 passed / 0 failed (post-v0.83.0); ended at 803 passed / 0 failed. No new run-*.js harness files; file count stays at 23. CS-MIG-1 count posture UNCHANGED at 47/38/3/6 (no new claude_surface[] entries).

v0.84.1 added ~32 HC-V0841-* sub-asserts: A1 ×7 (`_coerceDay` regression — string, Luxon, Date→null, null/undefined/object→null) + A2 ×15 (`ScratchDayMigrate` behavior — passthrough, Date rewrite, path/filename synthesis, no-op, idempotency, manifest wiring) in NEW `run-scratch.js`; A3 ×2 (`inWindow` numeric epoch compare source-lint) + D1/D2 (`defaultClosed` `!isClosed` gate + toggle WRITE preservation) appended to `run-activity-feed.js`; C1 ×6 (Tasks header forms + `titleHtml` opt + CSS rule) appended to `run-renderer.js`. 3 in-cycle test-pin updates surfaced at S7 (run-helper-cases SHC-S1 + FA6-MANIFEST-daily/activity-feed; run-activity-feed AF-1d + AF-V065; run-install-sh PID-1). NEW `run-scratch.js` harness file added; file count bumps to 24. CS-MIG-1 count posture UNCHANGED at 47/38/3/6 (no new claude_surface[] entries).

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
