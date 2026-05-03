---
date: 2026-05-04
phase: result
status: closed
cycle: v0.1.1
related:
  - 2026-05-03-registry-driven-nav-buttons-design.md
  - 2026-05-03-registry-driven-nav-buttons-plan.md
  - 2026-05-03-v0.1.1-S2-close-and-v0.1.2-handoff.md
  - 2026-05-03-v0.1.1-S3-close-and-S4-handoff.md
  - 2026-05-03-boards-blueprint-design.md
  - 2026-05-03-multi-vault-automation-design.md
  - landmines.md
---

# v0.1.1 Result — registry-driven nav-buttons + project blueprint v0.2.0

> [!success] Cycle closed 2026-05-04
> All three deliverables (Surprise 1 closure + Surprise 2 closure + project blueprint v0.2.0) shipped GREEN. Workshop self-install + barebones regression sweep + manual smoke T4.6 all PASS. T4.7 deferred — surfaced four real pre-existing bugs that v0.1.1 didn't introduce; logged here as priorities for the next cycle. Architectural discovery during T4.6 ("wrong primitive" — current kanban is a Dataview view, user expected real Obsidian-Kanban-plugin board) triggered the v0.2.0 design (boards blueprint) which is now approved.

---

## What shipped

| Deliverable | Status | Evidence |
|---|---|---|
| Installer extensions (S1) — `applyNavButtons`, `validateAndResolve`, `pruneNavButtonsRegistry`, `pruneInstalledLedger`, `content_path` variable | ✅ | `T1.1`-`T1.7` execution logs; nit-4 prune-shape failure-loud fix; `pruneInstalledLedger` symmetric remediation. |
| Nav-buttons mechanism v2.0.0 (S2) — thin renderer, ~205 LOC, registry-driven | ✅ | `T2.1`-`T2.4` logs; `T2.fix-installed-ledger-prune.md`; `T2.5-T2.7-headless-renderer-harness.md` (T2.5/T2.6/T2.7 PASS via harness). |
| Project blueprint v0.2.0 (S3) — Dataview-driven kanban template + first registry contribution | ✅ | `T3.1-T3.4-project-blueprint-v0.2.0.md`; T3.5/T3.6 deferred to S4 with rationale logs. |
| Renderer harness extension + barebones regression (S4) — cross-vault `--vault` + write-capture; lazy-scaffold + barebones-one-button tests; malformed-entry negative; idempotency | ✅ | `T4.0-T4.9-S4-harness-and-barebones-regression.md` (5/5 PASS against barebones; 4/5 against workshop with the 5th deliberately + visibly skipped). |
| Manual smoke T4.6 — `/new-project` + board update | ✅ (with workflow finding) | `T4.6-T4.7-manual-smokes.md`. |
| Manual smoke T4.7 — validator + audit walker | ❌ deferred (4 real bugs surfaced) | `T4.6-T4.7-manual-smokes.md`. |

> [!info] Workshop state at close
> - `workshop_version`: `0.4.0` (held since S1; no S2/S3/S4 bump)
> - Mechanisms: `customjs-guard@1.0.0`, `validator@0.1.0`, `audit@0.1.0`, `nav-buttons@2.0.0`
> - Blueprints: `project@0.2.0` (workshop subscription DROPPED project — barebones-only dogfood)
> - Two load-bearing harnesses: `platform/test/run-install.js`, `platform/test/run-renderer.js`
> - Landmines: 11 entries (most recent: #11 — module-directory invariant, drafted but technically codifies in v0.2.0 Stage 1; CLAUDE.md non-negotiable already references it)

---

## Surprise 1 closure — registry-driven nav

> [!success] Closed
> v0.1.0 Stage 4 found that SpaceNavButtons rendered 7+ accuris-shaped buttons regardless of subscription. v0.1.1's S2 thin renderer fixes this:
> - Each blueprint declares `nav_buttons[]` in its manifest.
> - Installer aggregates declarations into `Docs/Meta/nav-buttons-registry.json`.
> - Subscription-aware pruning auto-removes unsubscribed contributions.
> - SpaceNavButtons v2.0.0 renders ONLY what's in the registry — no kitchen-sink.
>
> **Evidence (barebones):**
> - Pre-v0.1.1: barebones rendered the project blueprint's hardcoded set.
> - Post-v0.1.1: barebones renders exactly ONE button (`Board`, declared by project blueprint).
> - Headless harness `T4.4 barebones-one-button` test PASS.
> - Manual T4.6: confirmed in Obsidian — one Board button rendered, label "Board", board icon.

---

## Surprise 2 closure — lazy content scaffold

> [!success] Closed
> v0.1.0 Stage 4 found that clicking Board materialized an empty `boards/To-Do-Board.md`. v0.1.1's `createFromTemplate` action type fixes this:
> - Project blueprint ships `content/kanban-board.md` (Dataview body) + declares `nav_buttons[Board]` with `template_source: "kanban-board.md"` (basename only).
> - Installer copies `content/kanban-board.md` → `Docs/Meta/Content/project/kanban-board.md` (path resolved automatically).
> - On click, `_dispatchAction` reads template_source → writes to target → opens.
>
> **Evidence (barebones):**
> - Headless harness `T4.0 lazy-scaffold` test PASS — captured `createFolder('boards')`, `create('boards/To-Do-Board.md', body=470B)`, `openLinkText('boards/To-Do-Board.md')`.
> - Manual T4.6: clicked Board → `boards/To-Do-Board.md` materialized with the Dataview kanban body; opened in active pane; empty-state line rendered correctly.

---

## "Wrong primitive" finding (the v0.2.0 trigger)

> [!warning] Finding surfaced during T4.6
> The v0.1.1 kanban is a **Dataview-list-rendering view** that lists projects from `boards/planning/<slug>/`. The user's mental model + accuris reference is an **Obsidian-Kanban-plugin board** with date-routed card notes — fundamentally different primitive (Kanban plugin renders columns + drag-drop; cards become individual notes via Templater integration).
>
> **Decision (locked 2026-05-03 brainstorm):**
> 1. Close v0.1.1 honestly with the Dataview-as-placeholder kanban shipped.
> 2. Design the real boards blueprint as v0.2.0.
> 3. Codify a new platform non-negotiable: the **module-directory invariant** (every blueprint owns one top-level consumer-vault directory).
>
> **Outputs from the brainstorm:**
> - `Docs/plans/2026-05-03-boards-blueprint-design.md` — full v0.2.0 design (approved 2026-05-03; status: draft, target_cycle: v0.2.0).
> - `Docs/landmines.md` #11 — module-directory invariant codified.
> - `CLAUDE.md` — module-directory invariant added to non-negotiables.
> - `Docs/how.md` — new "Module directory" concept section.
>
> **Sequencing locked:** v0.1.1 closes (now) → v0.1.2 ships (git-based pull, already designed) → v0.2.0 ships (boards blueprint + retires project's Board contribution).

---

## T4.7 deferred — four real pre-existing bugs surfaced

T4.7 (validator + audit walker manual smoke) was meant to confirm the v0.1.0-era mechanisms still work after v0.1.1's changes. Instead, every invocation attempt surfaced a real bug. v0.1.1 didn't introduce or touch any of these — they're latent v0.1.0-era issues that v0.1.0's "Stage 4" smoke didn't catch.

### The four findings

> [!warning] Finding #1 — No slash-command UX for `/new-project` (or `/audit`)
> The command files (`commands/new-project.md`, etc.) ship, but barebones has no slash-command plugin wired up to register them with Obsidian's command palette. Users invoke them only via Templater's Insert Template modal. UX gap. **Fix:** declare a slash-command-plugin dependency in the platform OR register the template in Obsidian's command palette directly via a Templater hook OR build a custom command-registration mechanism for blueprints.

> [!warning] Finding #2 — No standard runner UX for validator / audit walker
> No `Validate.md` template, no `/audit` slash command, no `Audit.md` template ship with the validator/audit mechanisms. Hook-based validation (via `hook-validate.js`) presumably works automatically when Templater runs templates, but there's no manual-trigger UX for ad-hoc validation. **Fix:** ship `Validate.md` + `Audit.md` runner templates as part of the validator + audit mechanism manifests respectively. Each is ~5 lines of Templater code.

> [!warning] Finding #3 — `validate.js` input resolution broken for direct `tp.file` invocation
> `validate.js` documents `tp.user.validate(tp.file, "project")` as a usage pattern. In current Templater versions, `tp.file` is a wrapper whose `.file` is undefined; the validator's `tpFileOrObj?.file ?? tpFileOrObj` falls through to the wrapper itself, then `.path` is a function not a string → downstream `getFileCache` crashes calling `.lastIndexOf` on a function. **Workaround:** pass `{ file: app.workspace.getActiveFile() }`. **Real fix:** defensive input handling in `validate.js` — detect TFile vs wrapper vs object-with-file; fall back gracefully.

> [!warning] Finding #4 — `validate.js:checkRequiredBlocks` schema mismatch with project rule
> Validator's `checkRequiredBlocks` expects `spec.content` (string snippet); project rule (`Docs/Meta/rules/project.json`) uses `kind` + `must_call` + `via` schema. Result: `expectedSnippet.slice(0, 80)` crashes on `undefined.slice`. The validator was never end-to-end tested against the project rule before v0.1.0 closed — the v0.1.1 manual smoke discovered this. **Real fix:** rewrite `checkRequiredBlocks` to parse `kind`/`must_call`/`via` (match the dataviewjs block, parse its body, check the must_call appears via the via-mechanism wrapper). Or: rewrite the rule to use `content` (less expressive). The schema in the rule is more meaningful; fix the validator.

### Disposition

All four are **pre-existing v0.1.0-era bugs**. v0.1.1 didn't introduce them; v0.1.1's harnesses can't catch them (they only fire in Obsidian-Templater runtime). T4.7 was the right test; it just exposed bugs the harness couldn't.

**Recommended next-cycle sequencing:** introduce a **v0.1.x patch cycle** dedicated to validator/audit subsystem fixes BEFORE v0.1.2 (git pull) ships. Reasoning: the validator hook fires on any template execution; a broken validator may silently fail or noisily error in the user's daily flow. Fix it early. Alternative: fold into v0.1.2 stage 0 OR v0.2.0 stage 0. User decision in next session.

---

## What's still ahead

> [!info] Three cycles ahead, sequenced
> 1. **v0.1.x patch (proposed)** — Fix Findings #1–#4. Ship `Validate.md` + `Audit.md` runner templates. Defensive input resolution in `validate.js`. Schema-match `checkRequiredBlocks` to project rule. Slash-command-plugin dependency or in-vault command registration. Decide cycle scope in next session.
> 2. **v0.1.2 — git-based pull, thin stub bootstrap.** Designed at `Docs/plans/2026-05-03-multi-vault-automation-design.md`. Retires the bootstrap-copy resync landmine. Five stages (S0 backup → S1 git init + tag → S2 schema + git state recording → S3 stub deployment → S4 harness pin-aware + drift sketch). Approved.
> 3. **v0.2.0 — boards blueprint + retire project's Board.** Designed at `Docs/plans/2026-05-03-boards-blueprint-design.md`. Codifies module-directory invariant in installer. Ships real Obsidian-Kanban-plugin board + Templater date-routed card notes. Project blueprint bumps to v0.3.0 BREAKING (drops `nav_buttons[]` + kanban file). Approved.
>
> Subsequent cycles (out of scope for this writeup): accuris migration (separate cycle when accuris's daily/todo/meetings/summary/planning blueprints are also designed); migrate project blueprint to own `projects/` directory (resolves the legacy `boards/planning/<slug>/` mis-location).

---

## Pacing rhythm — what worked

- **Stage-level checkpoints with bundle-of-implementer-work** continued working. Each cycle averaged 3-5 implementer dispatches per stage, with parallel spec + quality reviews. User surfaced only at stage / decision boundaries.
- **The two harnesses paid for themselves** — install harness (built mid-S1 as a side-quest) eliminated Templater-Reload-then-Run-Template-then-Squint-at-Notice cycle. Renderer harness (built at S2 close) eliminated three Obsidian eye-checks. Their existence enabled S4 to close on automated evidence; T4.6/T4.7 became the only manual surface.
- **Triple-bump protocol (landmine #10) surfaced organically** when the malformed-entry negative test (T4.8) needed to force re-processing of the project manifest. Codified inline; future test designs reference it.
- **Module-directory invariant emerged from a manual-smoke surprise.** The user's "wrong primitive" finding during T4.6 directly led to the v0.2.0 design; brainstorming that same morning produced both a new platform non-negotiable AND the boards blueprint design. Manual smokes ARE valuable design-discovery surface, even when they "fail."

---

## Pacing rhythm — what to improve

- **Pre-v0.1.0 mechanisms (validator, audit) were never end-to-end tested** before v0.1.0 closed. v0.1.1's manual smoke was the first time anyone tried to invoke `tp.user.validate(tp.file, ...)` as documented. Three real bugs hiding. Lesson: any mechanism that ships with a usage example in its source comments MUST have at least one end-to-end smoke (manual or harness) that exercises that usage example before the mechanism goes live.
- **The implementation plan's T4.6 wording assumed `/new-project` was a slash command.** It isn't. Plan-author and reality drifted. Next cycles' plan T-tasks should explicitly disambiguate: "Run via Insert Template modal" vs "Run as Obsidian slash command" — different UX paths require different setup.
- **Validator's `tp.file` resolution assumes an older Templater API.** The script's USAGE comments are stale. Lesson: comments documenting external-API consumption should include a tested-against version note (e.g., `// Tested against Templater 1.18.x as of 2026-04-01`). Comment rot is a silent source of bugs.

---

## Disposition for accuris migration

Still future work. The accuris migration plan (sketched in `2026-05-03-registry-driven-nav-buttons-design.md` § "Future-plans appendix") requires:
- daily / todo / meetings / summary / planning / temporal-nav blueprints to ship first
- v0.2.0's boards blueprint mechanism (kanban + card notes) ships first
- v0.1.x validator fixes ship first

Earliest realistic accuris cut-over: 4-5 cycles out from today (2026-05-04). Roughly aligned with the order-of-magnitude estimate the design doc gave.

---

## What changed in code/data this cycle (cumulative)

> [!example]- File-level summary
> - `platform/install.js` — added `applyNavButtons`, `validateAndResolve`, `pruneNavButtonsRegistry`, `pruneInstalledLedger`, `content_path` variable, nit-4 hardening. Bootstrap copies × 3 in sync.
> - `platform/manifest.json` — workshop_version 0.3.0 → 0.4.0; nav-buttons 1.0.0 → 2.0.0; project 0.1.0 → 0.2.0.
> - `platform/mechanisms/nav-buttons/space-nav-buttons.js` — full rewrite as v2.0.0 thin renderer (~297 → 205 LOC).
> - `platform/mechanisms/nav-buttons/manifest.json` — v1.0.0 → v2.0.0 with new description.
> - `platform/blueprints/project/manifest.json` — v0.1.0 → v0.2.0; added `nav_buttons[Board]`; tightened `depends_on.nav-buttons.range` to `>=2.0.0`; added `files[]` entry for kanban-board.md.
> - `platform/blueprints/project/content/kanban-board.md` — NEW. Dataview-driven kanban template.
> - `platform/test/run-install.js` — NEW (~280 LOC). Headless install harness.
> - `platform/test/run-renderer.js` — NEW + extended (562 LOC). Headless renderer harness; cross-vault + write-capture; 5 test cases; capture-on default for safety.
> - `Docs/Meta/platform-config.json` — added `content_path` variable.
> - `Docs/Meta/platform-subscription.json` (workshop) — bumped nav-buttons to 2.0.0; dropped project subscription.
> - `Docs/landmines.md` — added #9 (substitution scope), #10 (triple-bump), #11 (module-directory invariant — drafted; codifies in v0.2.0 stage 1).
> - `CLAUDE.md` — non-negotiables now include module-directory invariant; status snapshot updated.
> - `Docs/how.md` — added "Module directory" concept section.
> - `Docs/Index.md` — status updated.
> - 16 execution log files in `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/`.
> - 1 new design doc `Docs/plans/2026-05-03-boards-blueprint-design.md` (v0.2.0; approved).
> - 2 handoff docs (`2026-05-03-v0.1.1-S2-close-and-v0.1.2-handoff.md`, `2026-05-03-v0.1.1-S3-close-and-S4-handoff.md`).
> - 2 onboarding prompts in `Docs/prompts/`.

---

## v0.1.1 closed.

Next session opens v0.1.x patch (Findings #1–#4) OR v0.1.2 (git pull). User decides in `Docs/prompts/2026-05-04-onboard-v0.2.0-boards-blueprint.md`'s first move.

---

## Postscript — refinements landed 2026-05-04 (post-close)

> [!info] Two architectural shifts decided AFTER v0.1.1 closed; codified into platform docs but NOT into code yet
> 1. **Project formally named `beacon`.** GitHub remote configured: `git@github-personal:willfell/beacon.git` (HTTPS: `https://github.com/willfell/beacon`). Owned by `willfellhoelter@gmail.com`. The workshop is now a real published repo.
> 2. **Module-directory invariant refined to use `beacon/` namespace.** All materialized blueprint content moves under `beacon/<module_directory>/` (e.g., `beacon/boards/`, `beacon/projects/`). v0.1.1 shipped content at top-level `boards/`; v0.2.0 will ship at `beacon/boards/`. The legacy `boards/To-Do-Board.md` from v0.1.1 becomes orphaned during v0.2.0's deploy; v0.2.0 stage 4 needs a cleanup step.
>
> **Codification surfaces (updated 2026-05-04):**
> - `CLAUDE.md` — added project identity section + namespace prefix + git push "ask before" gates.
> - `Docs/landmines.md` #11 — updated for `beacon/` namespace + double-violation note for project blueprint.
> - `Docs/how.md` — Module directory concept section updated.
> - `Docs/plans/2026-05-03-boards-blueprint-design.md` — refinement section + path updates.
> - `Docs/plans/2026-05-03-multi-vault-automation-design.md` — GitHub remote refinement section; Phase 4 no longer deferred.
> - `Docs/prompts/2026-05-04-onboard-v0.2.0-boards-blueprint.md` — onboarding text reflects new context.
>
> **Implications for the next-cycle queue:**
> - **v0.1.x patch** scope unchanged (validator/audit subsystem fixes; no path-touching).
> - **v0.1.2** scope expands slightly — design around the real remote (push tags, document SSH alias, verify remote reachability in S4). Phase 4 hooks fold in.
> - **v0.2.0** scope substantively shifts — all paths use `beacon/<module>/`; substitution variable semantics clarified; legacy `boards/To-Do-Board.md` cleanup added to stage 4. Three open design calls in the v0.2.0 design doc still need user resolution.
