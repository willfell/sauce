---
date: 2026-05-02
phase: design
status: approved
supersedes: none
related:
  - 2026-05-02-vault-platform-design.md
  - 2026-05-02-vault-platform-implementation.md
  - 2026-05-02-customjs-guard-rollout.md
---

# Design — nav-buttons mechanism, project blueprint, and barebones-vault regression test

> [!abstract] Goal
> Build the platform's first **dependency-coupled pair**: a `nav-buttons` mechanism that ships `SpaceNavButtons`, plus a `project` blueprint that depends on it. Use the build to extend the installer with dependency resolution, blueprint shipping, rule-fragment materialization, and a stricter substitution model. Validate end-to-end on tmp-acc-vault, then prove the platform from absolute zero by onboarding a fresh `barebones-vault`.

> [!info] Context
> Phases 0–6 of the original platform implementation completed (workshop self-installs, three mechanisms shipped). Phase 7 onboarded tmp-acc-vault as the first external consumer. This design unblocks the **next major workstream** called out in `Docs/Index.md` ("first blueprint") while exercising platform features that have been declared but never wired (`rule_fragments`, blueprint install loop, `scripts_path` substitution).

---

## Decisions locked during brainstorming

> [!success] Approved choices
> - **Teaching goal:** maximum surface-area module that exercises platform dimensions not yet covered.
> - **Module shape:** TWO platform items — `nav-buttons` mechanism (cross-cutting) + `project` blueprint (the first blueprint).
> - **Nav-buttons scope:** ships only the universal `SpaceNavButtons`. Domain-specific nav button classes (`ProjectNavButtons`, `PlanningNavButtons`) live with the project blueprint.
> - **Dependency semantics:** strict — fail loudly if a declared dep isn't in the subscription, or if the version range is unsatisfied. No silent auto-install.
> - **Sequencing:** four stages, each dogfooded in workshop self-install before promoting.
> - **Version range syntax:** v1 supports only `>=X.Y.Z` and exact `X.Y.Z`. Document limitation; revisit when first painful.
> - **Unsubstituted variable behavior:** abort. Built to fail if anything is unwired.
> - **Rule-fragment merge:** namespaced under `contributions.<source-name>` for clean attribution and uninstall.
> - **Vault identity:** explicit field in `platform-config.json` (no auto-detection).
> - **Auto-fix safety:** v0.1.0 only auto-sets `type: project` and `status: active`. Everything else surfaces as a Notice.
> - **Barebones vault location:** `workshop/barebones-vault/` (sibling layout matches the rest).
> - **Barebones disposition:** keep permanently as the platform's regression-test vault.

---

## Architecture overview

> [!example]- File-level diff (workshop, tmp-acc-vault, barebones-vault)
> ```
> WORKSHOP                                              CONSUMER (tmp-acc-vault)
> ─────────────────────                                 ─────────────────────────
> platform/install.js                                   Docs/Meta/platform-subscription.json
>   + dep resolver (topo sort, version range)             { mechanisms: [
>   + blueprint install loop                                 customjs-guard@1.0.0,
>   + rule_fragments materialization                         validator@0.1.0,
>   + (rules_path, commands_path, templates_path             audit@0.1.0,
>      substitution variables added)                         nav-buttons@1.0.0
>                                                          ],
> platform/manifest.json                                   blueprints: [
>   workshop_version: 0.2.0 -> 0.3.0  (S1)                   project@0.1.0
>   + nav-buttons@1.0.0               (S2)                 ]
>   + project@0.1.0                   (S3)               }
>
> platform/mechanisms/nav-buttons/   (NEW, S2)            Docs/Meta/platform-config.json
>   space-nav-buttons.js                                    + variables.rules_path
>   manifest.json                                           + variables.templates_path
>                                                           + variables.commands_path
> platform/blueprints/project/       (NEW, S3)              + vault_identity
>   rule.json
>   templates/create-new-project.md                       Materialized after install:
>   helpers/{project-nav-buttons,planning-nav-buttons,      Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js
>            planning-board-projects,project-workstreams,   Docs/Meta/Scripts/project/{...}.js
>            project-workstream-manager}.js                 <templates_path>/Create New Project.md
>   commands/new-project.md                                 <commands_path>/new-project.md
>   variants.json                                           <views_path>/customjs-guard/view.js (existing)
>   manifest.json                                           Docs/Meta/rules/project.json
>                                                           Docs/Meta/rules/project.variants.json
>                                                           Docs/Meta/rules/_global.json (rule_fragments merged)
>                                                           Docs/Meta/platform-installed.json (history)
>
> BAREBONES VAULT (NEW, S4)
> ─────────────────────────
> workshop/barebones-vault/  (sibling to poc-vault, tmp-acc-vault)
>   hand-bootstrap:
>     Docs/Meta/platform-config.json          (canonical paths, vault_identity: barebones)
>     Docs/Meta/platform-subscription.json    (subscribe to all 5 items)
>     Docs/Meta/Templater/platformInstall.js  (copy of install.js)
>     Docs/Meta/Templates/_install-platform.md
>   Obsidian-side: install Templater + Dataview + CustomJS, set folders, run install
>   Result: zero -> fully platformed in one install run.
> ```

---

## Stage 1 — Installer extensions (workshop-only, dogfooded before promoting)

> [!abstract] Stage 1 deliverable
> `platform/install.js` gains dependency resolution, blueprint shipping, rule-fragment materialization, three new substitution variables, and a stricter "abort on unsubstituted variable" policy. Workshop self-install must remain green. `workshop_version: 0.2.0 → 0.3.0`.

### Dependency resolver

> [!example]- Algorithm
> ```
> INPUT  subscription { mechanisms[], blueprints[] }
>        workshop manifest { mechanisms[], blueprints[] }
>        (each item may declare depends_on: [{ name, range }])
>
> ALGORITHM
>   build node set: every subscribed item (mechanism or blueprint)
>   for each node: resolve its workshop entry; read its manifest.depends_on
>   for each dep:
>     if dep not in subscription -> mark node UNINSTALLABLE, reason="dep X not subscribed"
>     elif dep version doesn't satisfy range -> mark UNINSTALLABLE, reason="dep X@Y, need range"
>     else add edge: node -> dep
>   if cycle detected -> mark all in cycle UNINSTALLABLE, reason="dep cycle"
>   topo-sort installable nodes (deps first, dependents last)
>   emit install order list
>
> OUTPUT { installable: [n1, n2, ...], skipped: [{name, reason}, ...] }
> ```

> [!warning] Skipped-item behavior
> Each skip writes a Notice + a `history` entry of `{ event: "skip", name, reason, attempted_at }`. Mechanism / blueprint files are NOT touched. `platform-installed.json` does not record a version for the skipped item.

### Blueprint install loop

Mirrors the mechanism loop. Reads `platform/blueprints/<name>/manifest.json` with the same `files` + `post_install` shape; lands in `installedNow.blueprints[]` instead of `mechanisms[]`. Manifest may declare `depends_on`, `customjs_classes`, `rule_fragments` exactly like a mechanism.

### Rule-fragments materialization

> [!example]- Pseudo
> ```
> for each item being installed (mechanism or blueprint):
>   for each fragment in manifest.rule_fragments:
>     target = fragment.target  (e.g., "_global", "project")
>     fragmentJson = fragment.fragment  (object — change shape from current YAML-string-in-json)
>     rulePath = `${rules_path}/${target}.json`
>     existing = readJson(rulePath) || {}
>     existing.contributions = existing.contributions || {}
>     existing.contributions[<source-mechanism-name>] = fragmentJson
>     writeJson(rulePath)
> ```

> [!warning] Customjs-guard manifest update
> The current `customjs-guard/manifest.json` declares its `rule_fragments` as a YAML-formatted string. Change to a JSON object literal in this stage. No version bump needed since `rule_fragments` was previously dead data.

### New platform-config variables

| Variable | Purpose | Default |
|---|---|---|
| `rules_path` | Where rule files materialize (`{{rules_path}}/<name>.json`) | `Docs/Meta/rules` |
| `templates_path` | Where Templater templates materialize | `Extras/Templates` (tmp-acc-vault) / `Docs/Meta/Templates` (canonical) |
| `commands_path` | Where slash command files materialize | `commands` |
| `vault_identity` | Identity tag (`accuris`, `headspace`, `ero`, `barebones`, etc.) | none — required field |

> [!warning] Strict substitution
> Installer treats unsubstituted `{{vars}}` (after substitution pass) in `dest` paths or file bodies as a hard error: abort the file write, Notice the user, do NOT record a successful install for that mechanism. Built to fail loudly if anything is unwired.

### Failure-mode hardening (added post Stage-1 quality review)

> [!warning] Philosophy
> The installer must **fail loudly with attribution** in every error path. Silent fallbacks are removed. Stage 1 already enforces "abort on unsubstituted variable"; the same posture applies to every other failure mode the installer can encounter.

The hardening additions cover five concrete cases surfaced by the Stage 1 quality review (plus a sixth design clarification surfaced during Stage 4):

1. **Unrecognized version range syntax (C2).** `satisfiesRange()` distinguishes "version doesn't satisfy a recognized range" from "I don't recognize the range syntax". Unrecognized syntax produces a distinct skip reason: `unrecognized version range syntax: "<range>"`. Documents the v1 limitation (only `>=X.Y.Z` and exact `X.Y.Z`) at the point of failure instead of as a misleading "subscription pins" message.
2. **Malformed pre-existing JSON files (C4).** `applyRuleFragment` and `enableSnippet` no longer silently rewrite a malformed pre-existing file. On parse failure: Notice naming the file + the JSON parse error, skip that contribution/edit for this run, record `event: "error"` in history. The user gets a chance to inspect/back up the file before re-running. No data clobber.
3. **Adapter errors mid-install (E1).** Each `installItem` invocation is wrapped in try/catch at the install loop level. On exception: log `{ event: "error", name, step, error_message }` to history, Notice the user, continue to the next item (don't crash). The top-level `module.exports` body uses `try/finally` so `writeJson(installedNow)` ALWAYS runs and partial install state is recorded.
4. **Skipped-dep cascade (E3).** When item B depends on item A and A was skipped during `resolveDependencies` (e.g. version mismatch with the workshop manifest, item not in workshop at all), B's skip reason says: `depends on A which was skipped (<original reason>)` — not the misleading "is not subscribed".
5. **Name collision (L2).** If a name appears as both `mechanisms[]` and `blueprints[]` in either subscription or workshop manifest, both items are hard-skipped with reason: `name collision: "<X>" appears as both mechanism and blueprint`. Surfaces what is otherwise a silent overwrite.
6. **Strict-on-paths, lenient-on-bodies (added during Stage 4).** The installer's substitute pass is split: `substituteStrict()` for `dest` paths (must resolve every `{{var}}` or abort with attribution) and `substituteLenient()` for file BODY content (unknown placeholders pass through unchanged). Rationale: file bodies legitimately contain runtime template strings like `{{DATE}}`, `{{TASK_NAME}}`, `{{ALIAS}}` that JavaScript helpers resolve via `replaceAll` at click-time. Strict-on-bodies eats those before runtime sees them. This is a real design clarification, not a relaxation: dest paths still fail loudly; only bodies became lenient, since the body's runtime is the rightful owner of any unresolved `{{X}}`.

> [!info] Design rule going forward
> Every new step type in `post_install`, every new file format the installer reads, every new consumer-facing error: **must surface a Notice with attribution + record a history entry** before silently doing something else. If silence is desired (e.g., already-current install), that itself is an explicit code path, not an absence of one. This pattern is what makes "we can always count on installing on a pre-existing vault" load-bearing.

### Stage 1 acceptance criteria

> [!todo] Stage 1 done when…
> - [ ] `platform/install.js` has all three additions.
> - [ ] Workshop's `platform-config.json` has the new vars + `vault_identity: workshop`.
> - [ ] Workshop's `platform-subscription.json` is unchanged (still just the three existing mechanisms).
> - [ ] Running `tp.user.platformInstall(tp)` in the workshop produces zero new file writes (idempotent re-install).
> - [ ] `customjs-guard/manifest.json` updated to JSON-object rule_fragments.
> - [ ] `workshop_version` bumped 0.2.0 → 0.3.0 in `platform/manifest.json`.
> - [ ] All five hardening cases (C2, C4, E1, E3, L2) implemented and verified.
> - [ ] Commit.

---

## Stage 2 — nav-buttons mechanism

> [!abstract] Stage 2 deliverable
> Single-class CustomJS mechanism. Proves the dep resolver works end-to-end before adding the heavier blueprint on top. Version `1.0.0` — the SpaceNavButtons class is mature.

### Files

```
platform/mechanisms/nav-buttons/
├── manifest.json
└── space-nav-buttons.js     (canonical SpaceNavButtons class — sourced from tmp-acc-vault)
```

### Manifest

> [!example]- platform/mechanisms/nav-buttons/manifest.json
> ```json
> {
>   "name": "nav-buttons",
>   "version": "1.0.0",
>   "description": "SpaceNavButtons — universal vault-level nav block consumed via customjs-guard.",
>   "depends_on": [
>     { "name": "customjs-guard", "range": ">=1.0.0" }
>   ],
>   "customjs_classes": ["SpaceNavButtons"],
>   "files": [
>     { "source": "space-nav-buttons.js", "dest": "{{scripts_path}}/nav-buttons/space-nav-buttons.js" }
>   ],
>   "post_install": [],
>   "rule_fragments": []
> }
> ```

### Notes

- File lands at `{{scripts_path}}/nav-buttons/space-nav-buttons.js` — namespaced under mechanism name. Future uninstall is `rm -rf {{scripts_path}}/nav-buttons/`.
- No `post_install`: CustomJS auto-rescans on file changes.
- `depends_on customjs-guard >=1.0.0` makes the cold-load contract explicit.

### Stage 2 acceptance criteria

> [!todo] Stage 2 done when…
> **Workshop side**
> - [ ] `platform/mechanisms/nav-buttons/{manifest.json, space-nav-buttons.js}` written.
> - [ ] Workshop manifest updated.
> - [ ] Workshop subscription updated to include `nav-buttons@1.0.0`.
> - [ ] Workshop self-install runs green.
> - [ ] **Negative test:** remove customjs-guard from subscription → installer skips nav-buttons + Notice. Restore.
> - [ ] **Negative test:** pin customjs-guard@0.5.0 → installer skips with version-range Notice. Restore.
> - [ ] Commit.
>
> **tmp-acc-vault side**
> - [ ] Subscription updated to add `nav-buttons@1.0.0`.
> - [ ] Installer runs.
> - [ ] `Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` exists, byte-matches workshop source.
> - [ ] Existing flat-file `Docs/Meta/Scripts/space-nav-buttons.js` untouched.
> - [ ] `await dv.view("Extras/Scripts/customjs-guard", { class: "SpaceNavButtons" })` still renders.
>
> **Stage 2.5 cleanup (manual, after verification)**
> - [ ] Delete deprecated flat-file `Docs/Meta/Scripts/space-nav-buttons.js` from tmp-acc-vault.
> - [ ] Verify nav buttons still render.

> [!warning] Two-file co-existence during install
> Pre-existing flat-file `Docs/Meta/Scripts/space-nav-buttons.js` AND new namespaced `Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` will both exist in tmp-acc-vault until the manual Stage 2.5 cleanup. CustomJS scans recursively and registers both — last-wins. Identical class bodies → no observable difference. Cleanup is deliberate and recorded; the platform never deletes content it doesn't own.

---

## Stage 3 — project blueprint

> [!abstract] Stage 3 deliverable
> First blueprint. Pressure-tests the blueprint loop AND the dep resolver simultaneously. Version `0.1.0` — rule + templates will iterate.

### Files

```
platform/blueprints/project/
├── manifest.json
├── rule.json
├── variants.json
├── templates/
│   └── create-new-project.md
├── helpers/
│   ├── project-nav-buttons.js
│   ├── planning-nav-buttons.js
│   ├── planning-board-projects.js
│   ├── project-workstreams.js
│   └── project-workstream-manager.js
└── commands/
    └── new-project.md
```

All sources come from tmp-acc-vault's existing files (`Docs/Meta/Scripts/*.js`, `Extras/Templates/create-new-project.md`).

### Manifest

> [!example]- platform/blueprints/project/manifest.json
> ```json
> {
>   "name": "project",
>   "version": "0.1.0",
>   "kind": "blueprint",
>   "description": "Project note bundle — boards/planning/<slug>/ structure, planning board view, workstream manager, /new-project command.",
>   "depends_on": [
>     { "name": "nav-buttons",    "range": ">=1.0.0" },
>     { "name": "customjs-guard", "range": ">=1.0.0" }
>   ],
>   "customjs_classes": [
>     "ProjectNavButtons",
>     "PlanningNavButtons",
>     "PlanningBoardProjects",
>     "ProjectWorkstreams",
>     "ProjectWorkstreamManager"
>   ],
>   "files": [
>     { "source": "rule.json",                              "dest": "{{rules_path}}/project.json" },
>     { "source": "variants.json",                          "dest": "{{rules_path}}/project.variants.json" },
>     { "source": "templates/create-new-project.md",        "dest": "{{templates_path}}/Create New Project.md" },
>     { "source": "helpers/project-nav-buttons.js",         "dest": "{{scripts_path}}/project/project-nav-buttons.js" },
>     { "source": "helpers/planning-nav-buttons.js",        "dest": "{{scripts_path}}/project/planning-nav-buttons.js" },
>     { "source": "helpers/planning-board-projects.js",     "dest": "{{scripts_path}}/project/planning-board-projects.js" },
>     { "source": "helpers/project-workstreams.js",         "dest": "{{scripts_path}}/project/project-workstreams.js" },
>     { "source": "helpers/project-workstream-manager.js",  "dest": "{{scripts_path}}/project/project-workstream-manager.js" },
>     { "source": "commands/new-project.md",                "dest": "{{commands_path}}/new-project.md" }
>   ],
>   "post_install": [
>     { "type": "notice", "message": "Project blueprint installed. Reload Templater (user scripts) + reload CustomJS to register new classes." }
>   ],
>   "rule_fragments": []
> }
> ```

### rule.json — what makes a note a "project note"

> [!example]- platform/blueprints/project/rule.json
> ```json
> {
>   "schema_version": 1,
>   "name": "project",
>   "applies_to": {
>     "frontmatter_tag_any_of": ["project"],
>     "path_glob_any_of": ["boards/planning/*/*.md"]
>   },
>   "required_frontmatter": {
>     "type": "project",
>     "tags": ["project", "{{vault_identity_tag}}"],
>     "status": ["active", "paused", "shipped", "shelved"]
>   },
>   "required_blocks": [
>     { "kind": "dataviewjs", "must_call": "customJS.SpaceNavButtons", "via": "customjs-guard" },
>     { "kind": "dataviewjs", "must_call": "customJS.ProjectNavButtons", "via": "customjs-guard" }
>   ],
>   "naming": {
>     "folder": "boards/planning/<slug>/",
>     "slug_from": "frontmatter.title",
>     "slug_format": "kebab-case"
>   },
>   "auto_fixes": [
>     { "when": "missing_frontmatter.type",   "set": "project" },
>     { "when": "missing_frontmatter.status", "set": "active" }
>   ]
> }
> ```

> [!info] Conservative auto-fixes
> v0.1.0 only auto-sets two safe defaults. Anything else surfaces as a Notice — human action required. Expand only after the rule has lived for a sprint.

### variants.json — cross-vault aliases

> [!example]- platform/blueprints/project/variants.json
> ```json
> {
>   "schema_version": 1,
>   "default_name": "project",
>   "variants": {
>     "accuris":    { "alias": "project",     "vault_identity_tag": "accuris" },
>     "headspace":  { "alias": "side-quest",  "vault_identity_tag": "life" },
>     "ero":        { "alias": "project",     "vault_identity_tag": null,    "path_root": "Projects" },
>     "barebones":  { "alias": "project",     "vault_identity_tag": "barebones" },
>     "workshop":   { "alias": "project",     "vault_identity_tag": null,    "applies_in_workshop": false }
>   }
> }
> ```

### Stage 3 acceptance criteria

> [!todo] Stage 3 done when…
> **Workshop side**
> - [ ] All eight files written under `platform/blueprints/project/`.
> - [ ] Workshop manifest updated to include `project@0.1.0` under `blueprints[]`.
> - [ ] Workshop subscription updated to include nav-buttons + project.
> - [ ] Workshop self-install green; all eight files materialize; `platform-installed.json` shows `project@0.1.0` under `blueprints[]`.
> - [ ] **Negative test:** remove nav-buttons from subscription → project skipped with dep-missing Notice. Restore.
> - [ ] **Negative test:** pin nav-buttons@0.9.0 → project skipped with version-range Notice. Restore.
> - [ ] Commit.
>
> **tmp-acc-vault side**
> - [ ] Subscription updated to add `project@0.1.0`.
> - [ ] Installer runs.
> - [ ] All eight files materialize.
> - [ ] Reload Templater + CustomJS.
> - [ ] **Smoke test:** "Create New Project" template → new note lands at `boards/planning/<slug>/<slug>.md` with required frontmatter + dataviewjs blocks.
> - [ ] **Validator test:** `tp.user.validate(tp)` on the new project note → PASS.
> - [ ] **Validator test (negative):** delete a required tag → FAIL with field reported.
>
> **Stage 3.5 cleanup (manual)**
> - [ ] Delete pre-existing flat-file copies of `project-nav-buttons.js`, `planning-nav-buttons.js`, `planning-board-projects.js`, `project-workstreams.js`, `project-workstream-manager.js` from tmp-acc-vault's `Docs/Meta/Scripts/`.
> - [ ] Verify project notes still render.

---

## Stage 4 — barebones-vault from zero

> [!abstract] Stage 4 deliverable
> Fresh vault at `workshop/barebones-vault/` with zero pre-existing artifacts. Bootstrap from scratch, run installer, validate every platform feature works without pre-seeded scaffolding. Becomes the platform's permanent regression-test vault.

### Onboarding procedure

| Phase | Doer | Action |
| :----: | :----: | --- |
| 1 | agent | Create vault directory + `Docs/Meta/Templater/`, write minimal `.obsidian/app.json`. |
| 2 | agent | Write `platform-config.json`, `platform-subscription.json`, copy `install.js` → `platformInstall.js`, copy `_install-platform.md`, write CLAUDE.md sandbox stub. |
| 3 | agent | Pre-flight verification (diff sources, list files). |
| 4 | human | Open vault in Obsidian; install + enable Templater, Dataview, CustomJS; configure folders; reload user scripts; run install template; approve gates; reload again. |
| 5 | agent | Verify each subscribed item materialized; check `platform-installed.json`; smoke test reports back to user. |

### Phase 4 detail (human-in-Obsidian, the only non-automatable steps)

> [!todo] Human checklist
> - [ ] File → Open Vault → point to `workshop/barebones-vault`.
> - [ ] Settings → Community plugins → enable.
> - [ ] Install + enable: Templater, Dataview, CustomJS.
> - [ ] Templater: Template folder = `Docs/Meta/Templates`; Script files folder = `Docs/Meta/Templater`.
> - [ ] CustomJS: JS files folder = `Docs/Meta/Scripts`.
> - [ ] Dataview: Enable JavaScript queries = ON.
> - [ ] Settings → Templater → User Script Functions → reload.
> - [ ] Open any note (or create scratch + click in).
> - [ ] Command palette → Templater: Open Insert Template modal → `_install-platform`.
> - [ ] Approve gates (CSS snippet write + appearance.json edit).
> - [ ] Final Notice: `platformInstall: complete.`
> - [ ] Reload Templater user scripts again.

### What this stage proves (vs. tmp-acc-vault, which was pre-seeded)

| Validated by barebones | Why it matters |
| --- | --- |
| `Docs/Meta/` directory creation | tmp-acc-vault already had it |
| `commands/` directory creation | new variable, never created from zero |
| `rules/` directory creation + first rule fragment write | rule_fragments was unimplemented before Stage 1 |
| First-time CustomJS class registration | tmp-acc-vault had pre-existing classes |
| First-time CSS snippet enable (gate fires for real) | tmp-acc-vault had it pre-enabled |
| First-time appearance.json edit | tmp-acc-vault had `customjs-loader` enabled |
| Vault identity → variant alias resolution (new `barebones` tag) | tmp-acc-vault uses `accuris` |
| End-to-end install of all 5 items in one run | tmp-acc-vault staged install |

### Stage 4 acceptance criteria

> [!todo] Stage 4 done when…
> - [ ] Phases 1–3 pre-flight all green.
> - [ ] Phase 4 completes without errors or skipped items.
> - [ ] Phase 5 verification: zero missing files, zero unresolved `{{vars}}`, zero skip entries in history.
> - [ ] Smoke tests: nav buttons render; `/new-project` produces a valid project note; audit walker writes a report.
> - [ ] Result writeup committed to `Docs/plans/<date>-barebones-onboarding-result.md`.
> - [ ] `Docs/use.md` updated with section: "Pre-promotion regression test: re-run barebones onboarding from a clean slate."

> [!info] Disposition after the experiment
> Barebones-vault stays permanently as a regression-test target. Future installer or mechanism changes dogfood here before promoting to real consumers. Cost: zero (just files).

---

## Cross-cutting risks and landmines

> [!warning] Landmine inventory (in addition to the eight already in `Docs/landmines.md`)
> 1. **Two-file co-existence during Stage 2/3 install.** Pre-existing flat-files in tmp-acc-vault co-exist with installed namespaced copies. CustomJS scans recursively → both register, last-wins. Identical bodies → no observable break. Cleanup is a deliberate manual step, never installer-driven.
> 2. **Strict substitution can mask consumer config errors as platform bugs.** If a consumer forgets to set `vault_identity` or one of the new path vars, every install fails loudly. That's intentional — but onboarding instructions must list every required var. Update `Docs/use.md` accordingly in Stage 1.
> 3. **rule_fragments JSON-shape change is a one-time data migration.** customjs-guard's manifest changes the rule_fragments format from YAML-string-in-string to JSON object literal. This is in the workshop only; consumers don't store rule_fragments themselves. Still — call it out explicitly to avoid confusion.
> 4. **Slash command runtime assumption.** Design assumes `commands/<name>.md` is consumed by an existing slash-command runner in tmp-acc-vault. Implementation must inspect tmp-acc-vault's actual convention first; if the format diverges, adapt before promoting.
> 5. **Barebones vault is not a "real" Obsidian Sync target.** It's a workshop-scoped sandbox. Don't add it to Obsidian Sync; it's machine-local.

---

## Versioning summary

| Stage | Workshop_version | Item version bumps |
| :----: | :----: | --- |
| 1 | 0.2.0 → 0.3.0 | platform/install.js change; customjs-guard manifest's `rule_fragments` shape (no version bump — was dead data) |
| 2 | 0.3.0 (no bump) | nav-buttons@1.0.0 (new) |
| 3 | 0.3.0 (no bump) | project@0.1.0 (new) |
| 4 | n/a | n/a (consumer setup, not a workshop release) |

---

## Out of scope for this design

- Cleanup of pre-existing flat-files in tmp-acc-vault is a manual one-shot, not installer behavior.
- Slash command runner standardization (QuickAdd vs Templater-based vs other) — design assumes existing convention; verify during implementation.
- Real accuris onboarding — gated on barebones success, separate plan.
- Headspace and ERO onboarding — even further downstream.
- Uninstall mechanic — `contributions.<source>` namespacing makes it possible later; not built in this design.
- Caret/tilde/wildcard version ranges — minimal range syntax is documented limitation.
- Mobile support — desktop-only per existing landmine.

---

## Next step

Hand off to the **writing-plans** skill to produce a detailed task-by-task implementation plan covering Stages 1–4. Implementation plan committed alongside this design doc before any code changes.
