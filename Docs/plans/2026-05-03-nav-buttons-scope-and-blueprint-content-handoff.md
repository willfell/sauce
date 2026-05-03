---
date: 2026-05-03
phase: handoff
status: open
related:
  - 2026-05-02-vault-platform-design.md
  - 2026-05-02-nav-buttons-and-project-blueprint-design.md
  - 2026-05-02-nav-buttons-and-project-blueprint-plan.md
  - landmines.md
---

# Handoff — nav-buttons scope + blueprint content gaps surfaced by Stage 4

> [!abstract] Summary
> Stage 4 (barebones-vault end-to-end install) succeeded — every platform piece materialized cleanly into a vault with zero pre-existing artifacts. Smoke tests then surfaced two design surprises that v0.1.0 didn't solve: (1) `SpaceNavButtons` shows 7+ buttons with hardcoded accuris paths instead of a minimal default; (2) the "Board" button creates an empty target note because the platform shipped *mechanism* (the JS class) but not *companion content* (the target files / kanban board / supporting templates). Project blueprint shipped runnable but doesn't yet produce a working "complete board functionality" experience. This doc captures what's installed, what works, what's surprising, and what to decide next.

---

## Project context (one screen)

**This vault platform** is a system that lets one canonical "workshop" vault author code (mechanisms) + note-type bundles (blueprints), version them, and ship them on demand to consumer vaults via a Templater-driven installer. See `Docs/why.md` for the original problem statement, `Docs/how.md` for the architecture, `Docs/landmines.md` for already-hit traps.

Three concepts:
- **Mechanism** — cross-cutting code (a CustomJS class, a Dataview view, a CSS snippet, a Templater script). Examples: `customjs-guard`, `validator`, `audit`, `nav-buttons`.
- **Blueprint** — a note-type bundle that defines what a particular kind of note looks like and how to create one. Includes rule.json + templates/ + helpers/ + commands/ + variants.json.
- **Subscription** — per-consumer-vault `platform-subscription.json` declaring which mechanisms + blueprints + which versions this consumer wants.

Three vaults in play:
- `workshop/poc-vault/` — canonical platform host. Authoritative source for all mechanism/blueprint code.
- `workshop/tmp-acc-vault/` — first external consumer (mirror of accuris). Subscription updated to receive nav-buttons + project, but installer NOT run there in latest cycle.
- `workshop/tmp-test-barebones-vault/` — fresh sandbox built in Stage 4 from absolute zero. Now fully installed: 4 mechanisms + 1 blueprint.

> [!info] Why barebones-vault matters
> Real consumers (accuris, headspace, ero) have pre-existing artifacts and idiosyncratic layouts. Barebones is the first vault to install everything from scratch, so it's the cleanest place to see what the platform actually delivers — independent of what's already there. It's the regression-test target going forward.

---

## What's installed and verified working

### Mechanisms (4)

| Mechanism | Version | What it does | Verified |
|---|---|---|---|
| `customjs-guard` | 1.0.0 | Polling guard so Dataview views call CustomJS classes safely on cold load | ✅ smoke test passed (SpaceNavButtons renders without ReferenceError) |
| `validator` | 0.1.0 | Rule engine + Templater hook handler. Reads rules from `Docs/Meta/rules/` | ⏳ not yet smoke-tested in barebones |
| `audit` | 0.1.0 | Vault walker that produces `Timestamps/Audits/<date>-audit.md` | ⏳ not yet smoke-tested in barebones |
| `nav-buttons` | 1.0.0 | Ships `SpaceNavButtons` CustomJS class | ⚠️ renders but with surprises (see below) |

### Blueprint (1)

| Blueprint | Version | What it does | Verified |
|---|---|---|---|
| `project` | 0.1.0 | Project note bundle: `rule.json` + `variants.json` + `Create New Project` template + 5 helper CustomJS classes + `commands/new-project.md` slash command | ⚠️ install lands but produces incomplete experience (see below) |

### Installer feature set (Stage 1 deliverable)

- ✅ Dependency resolution (topo sort + version range satisfaction)
- ✅ Blueprint install loop
- ✅ rule_fragments materialization (namespaced under `contributions.<source>` in target rule files)
- ✅ Strict-on-paths, lenient-on-bodies substitution (added Stage 4 after `{{DATE}}` runtime placeholders in helpers tripped strict mode)
- ✅ Six failure-mode hardenings: unrecognized version range syntax → distinct skip; malformed JSON in pre-existing rule/appearance files → no clobber; per-item try/catch + try/finally for installed.json persistence; skipped-dep cascade attribution; mechanism-blueprint name collision detection; strict-vs-lenient dest/body split.

---

## The two surprises Stage 4 surfaced

### Surprise 1: SpaceNavButtons renders 7+ buttons, not just "Board"

**Observed:** Adding `await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });` to a note in barebones renders a row of buttons including: Daily, To Do, Meetings, Board, Summary, Projects, Planning.

**Expected (user's intuition):** A focused button — maybe just "Board" since that's the blueprint we said we shipped.

**Root cause:** We shipped `SpaceNavButtons` byte-identical from tmp-acc-vault, which inherited it byte-identical from accuris's full live nav bar. The class is a kitchen-sink with conditional rendering of seven button categories, each pointing to hardcoded paths from accuris's layout (`Timestamps/<YYYY>/<MM>-<MMMM>/...`, `boards/To-Do-Board`, `Extras/Templates/Template, Daily.md`, etc.).

**File to read:** `tmp-test-barebones-vault/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js`. Specifically the `config = {...}` block (~line 51) and the `buildButtons` function (~line 95). All paths and templates are literal strings; nothing is data-driven.

### Surprise 2: Clicking "Board" creates an empty `boards/To-Do-Board.md`

**Observed:** Click the Board button → Obsidian opens (or creates) `boards/To-Do-Board.md`. The file is empty. No kanban, no list, no nav.

**Expected:** Complete board functionality — a working kanban-like view.

**Root cause:** Two layers:

1. **The button's action** is `app.workspace.openLinkText("boards/To-Do-Board", "")`. Obsidian's openLinkText auto-creates a missing target as an empty note — surprising default but documented behavior.
2. **The target content was never shipped.** The platform installed *code* (`SpaceNavButtons`, the project blueprint's helpers, a Templater template for new projects) but *not* the content the code points to. There's no `Boards/` scaffolding template, no kanban setup, no pre-populated `To-Do-Board.md`.

This is the deeper gap the user noticed. v0.1.0's project blueprint manifest:
- ✅ ships rule.json (validator config for project notes)
- ✅ ships variants.json (cross-vault aliases)
- ✅ ships 5 helper CustomJS classes
- ✅ ships a `Create New Project` Templater template (creates a folder + atlas note when run)
- ✅ ships a slash command file
- ❌ does NOT ship a "Board" target file
- ❌ does NOT ship the kanban setup
- ❌ does NOT trigger any scaffolding of `boards/` structure on install

The `Create New Project` template DOES create `boards/planning/<slug>/<slug>.md` when run — but only for that specific project. The standing "Board" button at vault root has no destination that the platform created.

**Implementer flag from Bundle 2 log:** *"kanban planning board NOT created (deferred to v0.1.1)."* This was documented at build time but didn't get re-surfaced before Stage 4.

---

## The deeper design question

**Should mechanisms / blueprints ship companion content, not just code?**

Three answers, each shaping the next 1-2 versions of the platform:

### Option A — Mechanisms ship code only; consumer vaults ship content separately

Keep nav-buttons / project minimal — just the code. The user's existing content (boards, daily notes, etc.) is the user's responsibility. Document that `SpaceNavButtons` requires accuris-shaped content to be useful elsewhere.

- Pro: clean separation. Mechanisms are reusable across very different vaults.
- Con: doesn't solve the user's actual ask ("complete board functionality").

### Option B — Add a new platform concept: **scaffolding content** (Recommended)

Mechanisms / blueprints declare a `scaffold` section in their manifest that lists files/folders to create on install if missing. For `nav-buttons` (or a new `boards-scaffold` mechanism), the install would create:
- `boards/To-Do-Board.md` from a template, with frontmatter + dataviewjs blocks for a working kanban
- `boards/planning/Planning-Board.md` similarly
- `Timestamps/Summary/.gitkeep` etc.

Scaffolding only writes if the target doesn't already exist (idempotent, never clobbers).

- Pro: closes the "ship complete experience" gap. Versionable. Per-consumer config can opt-in/out.
- Con: new concept. Needs design + installer work + dogfood.

### Option C — Make `SpaceNavButtons` data-driven

Instead of hardcoding 7 button definitions, ship a default `nav-buttons-config.json` per vault that the class reads at runtime. Each consumer customizes their button set + paths.

- Pro: addresses Surprise 1 directly. Consumer can ship just "Board" if that's what they want.
- Con: doesn't fix Surprise 2 (target content still missing). Adds runtime config surface.

A combined direction (B + C) is plausible. For v0.1.1, scope-cut to one or both.

---

## Files for the new session to read

In order:

1. `CLAUDE.md` (workshop root) — vault identity, non-negotiables.
2. `Docs/Index.md` — entry point.
3. `Docs/why.md` — purpose.
4. `Docs/how.md` — architecture (mechanism / blueprint / subscription).
5. `Docs/landmines.md` — already-hit traps. **Non-negotiable read.**
6. `Docs/plans/2026-05-02-nav-buttons-and-project-blueprint-design.md` — the design doc shipped in this cycle, including the post-Stage-4 hardening additions.
7. `Docs/plans/2026-05-02-nav-buttons-and-project-blueprint-plan.md` — task-by-task implementation plan.
8. `Docs/plans/execution-logs/2026-05-02-nav-buttons-and-project-blueprint/` — every implementer's per-task log.
9. **THIS DOC** — the handoff capturing surprises + decision points.

Then peek into the actual barebones state:
- `tmp-test-barebones-vault/Docs/Meta/platform-installed.json` — proof of install.
- `tmp-test-barebones-vault/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` — the kitchen-sink class.
- `tmp-test-barebones-vault/Docs/Meta/Scripts/project/*.js` — project helpers (5 of them).
- `tmp-test-barebones-vault/Docs/Meta/rules/project.json` + `project.variants.json` — the rules.
- `tmp-test-barebones-vault/Docs/Meta/Templates/Create New Project.md` — the working Templater template.
- `tmp-test-barebones-vault/commands/new-project.md` — the slash command file.

Also useful:
- `platform/manifest.json` (workshop) — current platform_version `0.3.0`, four mechanisms, one blueprint.
- `platform/mechanisms/nav-buttons/manifest.json` — `customjs_classes: ["SpaceNavButtons"]`, depends on `customjs-guard >=1.0.0`.
- `platform/blueprints/project/manifest.json` — files list, depends_on, customjs_classes.

---

## Suggested first move for the next session

1. **Read** the files above.
2. **Brainstorm** with the user using the de:brainstorming skill. The decision: pick A / B / C (or hybrid) for v0.1.1.
3. **Design + plan** the chosen direction. Specifically:
   - If B (scaffolding): define the manifest field shape (`scaffold: [{ source, dest, condition }]`?), the install behavior on idempotent re-run, the ownership rules (does scaffolding write inside vault content the user might edit?).
   - If C (data-driven nav-buttons): define the config file format, where it lives in the consumer (`Docs/Meta/nav-buttons.json`?), how SpaceNavButtons loads it, default contents per vault identity.
4. **Build incrementally** with stage-by-stage dogfood, like the v0.1.0 cycle. Workshop self-install must remain green at every step.
5. **Re-test in barebones** to confirm the v0.1.1 gap is closed.

---

## Open trail / context the new chat should know

- **Date this was written:** 2026-05-03.
- **User's pacing preference:** "next manual effort happens at barebones-vault." Bundle work; surface to user only at stage / decision boundaries.
- **Git policy:** no commits unless explicitly asked. The user has stated git is unavailable in this vault, so each implementer logs to `Docs/plans/execution-logs/<plan-name>/T<task>-<slug>.md` instead.
- **Bootstrap copies:** when `platform/install.js` changes, also re-sync the runtime copies in:
  - `poc-vault/Docs/Meta/Templater/platformInstall.js`
  - `tmp-acc-vault/Docs/Meta/Templater/platformInstall.js`
  - `tmp-test-barebones-vault/Docs/Meta/Templater/platformInstall.js`
- **Stage 4 known limitation:** mobile (iOS Obsidian) is unsupported for installs because `require("fs")` is desktop-only (landmine #8). Smoke tests can run on iPhone but install must run on macOS.
- **One decision the user already made in this cycle:** `vault_identity_tag` is a per-consumer variable in `platform-config.json:variables`. v0.1.1 should consider auto-deriving it from `variants.json + vault_identity` to remove the duplicate state.

---

## Status of the existing 34-task plan

Stages 1, 2, 3 are complete. Stage 4 install is complete; smoke tests in progress (customjs-guard cold-load passed). Three smoke tests remain:
- `/new-project` template execution
- `audit-walker` execution
- validator hook execution

Those can finish in the new chat OR be deferred. The "complete the smoke tests" path is independent from the "fix the surprises" path — they can run in parallel or sequentially.
