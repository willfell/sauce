---
purpose: Fresh-chat handoff for the config-driven `breadcrumb` mechanism cycle (next slice of the note-chrome standard arc, post-v0.122.0). Paste the "Prompt to start the new chat" section into a new session to continue.
load_when: Resuming the note-chrome arc to author + ship the breadcrumb mechanism (+ registry + schema + project-as-proof + heal + docs).
---

# Breadcrumb mechanism cycle — handoff (2026-06-17)

## Mission (one line)

Promote the project-only `platform/blueprints/project/helpers/breadcrumb.js` into a config-driven shared `breadcrumb` mechanism with a per-blueprint trail registry, drive the project blueprint onto it as the proof case (existing notes must render byte-identical trails after the migration), and lay the groundwork for adoption waves to follow.

## State on disk RIGHT NOW

- **Workshop:** v0.122.0 (main HEAD `4154c275 Merge pull request #13 …`). brewed sauce = 0.122.0. Tag pushed, tap PR #202 merged, brew upgraded.
- **All four consumer vaults deployed clean at v0.122.0, Drift: none.**
  - `/Users/willfellhoelter/notes/sauce/barebones` — 18 mechs · 11 blueprints. ONE pre-existing benign skip: `people → people-identity` transitive gap (unrelated to v0.122.0; tolerated since prior cycles).
  - `/Users/willfellhoelter/notes/sauce/accuris-sauce` — 19 mechs · 8 blueprints. Clean.
  - `/Users/willfellhoelter/notes/sauce/ero-sauce` — 18 mechs · 8 blueprints. Clean. **Brew-only** (workshop_relative_path = `/opt/homebrew/opt/sauce/libexec`).
  - `/Users/willfellhoelter/notes/sauce/headspace-sauce` — 19 mechs · 11 blueprints. Clean.
- **`section-label` mechanism is now LIVE** at `platform/mechanisms/section-label/` (v0.1.0). class name `SectionLabel` unchanged. project + to-do depend_on it directly. THIS is your reference impl for the breadcrumb promotion — same pattern, different file.
- **Worktree at `.worktrees/note-chrome-foundation`** (branch `feature/note-chrome-foundation`) currently points at the MERGED commit chain. Two ways to start the next slice:
  - Option A (preferred): reset the branch onto current main and reuse the worktree.
    ```bash
    cd /Users/willfellhoelter/projects/repos/sauce/.worktrees/note-chrome-foundation
    git fetch origin main
    git reset --hard origin/main
    ```
  - Option B: cut a fresh branch + worktree.
    ```bash
    cd /Users/willfellhoelter/projects/repos/sauce
    git worktree add .worktrees/breadcrumb-mechanism -b feature/breadcrumb-mechanism origin/main
    ```

## What's already DECIDED (don't re-litigate)

From the design spec (`Docs/plans/2026-06-16-v0.121.0-note-chrome-standard-design.md` §5.1 + §11) and brainstorming 2026-06-16:

- **Approach:** mechanism + per-blueprint declaration (Approach 1, not the single `NoteChrome` renderer).
- **Class name stays `Breadcrumb`** → customJS singleton-by-class-name → live-render, **no body migration** (same trick as section-label this cycle).
- **Resolver field-reference grammar:** `fm:<field>` (frontmatter), `path:<rule>` (path derivation), `hub:<slug>` (named hub), `file:<rule>` (e.g. `file:basename`). Resolver order of precedence is **finalize in the v0.123.0 plan** (open item).
- **Top-level hubs render nothing** (no ancestors / no current → empty output).
- **Current note is plain text, no link** (last segment).
- **Trails INCLUDE the month segment** for date-organized blueprints (e.g. `Journal / June 2026 / 2026-06-16`) — decided in brainstorming, NOT to be dropped without re-asking.
- **Registry shape (sketch from §5.1):**
  ```json
  "breadcrumb": {
    "types": {
      "doc-note": {
        "ancestors": [
          { "label": "fm:project_title|path:1", "link": "fm:project|path-hub" },
          { "label": "Docs", "link": "path:docs-hub" }
        ],
        "current": { "label": "fm:title|file:basename" }
      },
      "meeting": { "ancestors": [{ "label": "Meetings", "link": "hub:meetings" }], "current": { "label": "file:basename" } }
    }
  }
  ```
- **Registry file:** `ranch/breadcrumb-registry.json` (mirrors the shape of `ranch/nav-buttons-registry.json` + `ranch/entity-create-registry.json`). Aggregated from per-blueprint manifest declarations at install time.
- **Schema registration:** register the registry contract in `platform/schemas-index.json` (`npm run lint-schemas` must pass). See `Docs/agent-guides/schemas.md` for shape.
- **Proof case:** the project blueprint migrates onto the new mechanism FIRST. The output on existing project notes MUST be byte-identical (e.g. `test-project / Docs / Architecture` must render exactly that, same links, same dividers). If it doesn't, the resolver grammar needs to flex to match — not the other way around.
- **to-do KEEPS its `project` depends_on for now** (still uses `Breadcrumb` transitively today). After breadcrumb ships, to-do can drop `project` from depends_on in a follow-up commit.
- **Lint gate work + project heal migration + `note-chrome.md` doc** is the NEXT cycle after breadcrumb (v0.124.0 or v0.123.x — sequence per design spec §10).

## What's NEXT, in order

1. **Brainstorm** the resolver-precedence + edge cases (open items in design spec §11): `fm:`/`path:`/`hub:`/`file:` precedence when multiple keys match; what happens on missing fm field (fall through to next `|`-separated resolver, or drop the segment?); how the project blueprint's existing type dispatch (project / docs-hub / section-hub / doc-note / map / kanban / task-note) maps onto the registry's `types[]`. Use `superpowers:brainstorming`.
2. **Write the plan** (`Docs/plans/2026-06-17-v0.123.0-breadcrumb-mechanism-plan.md`). Use `superpowers:writing-plans`. Modeled on `Docs/plans/2026-06-16-v0.122.0-section-label-mechanism-plan.md`:
   - Task 1: TDD harness `platform/test/run-breadcrumb.js` (failing) → relocate via `git mv` → mechanism manifest mirroring `platform/mechanisms/section-label/manifest.json` → catalogue entry → harness passes → commit `feat(breadcrumb): promote Breadcrumb to a shared mechanism`.
   - Task 2: Generalize `Breadcrumb` to read from `ranch/breadcrumb-registry.json` instead of hardcoded `spice/projects/${slug}` paths + project-only type dispatch. Add resolver. NEW harness asserts project parity (the byte-identical-trail proof).
   - Task 3: Per-blueprint manifest schema — add `breadcrumb` block to `platform/blueprints/project/manifest.json` matching the design-spec example. Wire installer to aggregate per-blueprint `breadcrumb` blocks into `ranch/breadcrumb-registry.json` at install time (mirror how `nav-buttons-registry.json` is aggregated — see `platform/install.js` for the pattern).
   - Task 4: Register the registry in `platform/schemas-index.json`; `npm run lint-schemas` must pass.
   - Task 5: Version lockstep — workshop 0.122.0 → 0.123.0; package.json; ADD `breadcrumb` to BOTH `ranch/platform-subscription.json` AND `platform/test/seed-vault/ranch/platform-subscription.json` (seed `workshop_version` stays lagged); bump project to next MINOR; preflight chain extension.
   - Task 6 (optional, this cycle or next): drop to-do's `project` depends_on (only `breadcrumb` + `section-label` needed).
3. **Execute the plan via subagent-driven-development** (`superpowers:subagent-driven-development`): one implementer per task (or one for all if tightly coupled like v0.122.0), then spec compliance review, then code-quality review. Two-stage review per task.
4. **Push branch → open PR → CI green → admin-merge → tag v0.123.0 → tap PR → brew upgrade → deploy to vaults.**
5. **Dogfood:** Cmd+R the workshop in Obsidian. Open `spice/projects/test-project/Docs/Architecture.md`. Confirm the breadcrumb still renders identical to today's output (`test-project / Docs / Architecture`). Spot-check the other 6 project type dispatches.

## NON-NEGOTIABLE conventions (carried forward — internalize)

- **Conventional Commits, no Claude trailer.** Repo rule. Never add `Co-Authored-By: Claude` or `Generated with Claude Code` to commit messages or PR descriptions. See `Docs/agent-guides/build-test-verify.md` + memory [[feedback-no-claude-commit-trailer]].
- **Worktree work, single arc branch.** Keep the diff coherent. Don't push to main.
- **Version lockstep is LOAD-BEARING.** Every source change bumps:
  1. component version
  2. `platform/manifest.json` catalogue entry
  3. `package.json` version
  4. `platform/manifest.json` `workshop_version`
  5. `ranch/platform-subscription.json` pin (workshop self-subscription)
  6. `platform/test/seed-vault/ranch/platform-subscription.json` pin (seed; workshop_version stays lagged)
  - A NEW mechanism must be ADDED to BOTH subscriptions or the installer SKIPS it (precedent commit `c5342408`). `node scripts/check-version-sync.js` is the gate.
- **Live-render vs migration:** chrome (breadcrumb included) is live-rendered via `dv.view(customjs-guard, {class})`. Changing JS reflects on Cmd+R — NO note migration required. Migrations are ONLY for static body text changes (injected dataviewjs blocks, literal `---`, `## H2` heading rewrites). This cycle = live-render only. NO `applyXxx` in `platform/install.js`, NO new seed family.
- **Templates under `{{module_directory}}/` keep `materialize_once: true`** so cosmetic diffs never overwrite user content. (Not relevant this cycle — no template changes — but a hard rule.)
- **Gate before any push:** `npm run release:preflight` (~4400 asserts; Bash timeout 600000 ms) must exit 0.

## CI / deploy traps to expect (memory entries written 2026-06-17)

1. **`platform/bootstrap-lib/wizard.js` `DEFAULT_MECHANISMS_CHECKED` lags the catalogue.** If `breadcrumb` becomes a foundational default mech (every blueprint should have one — likely yes), ADD it to the list in the same PR. Precedent comments in `wizard.js` show the exact shape. v0.60.0 hit this with `icons`; v0.121.2 hit it with `open-helpers`; v0.122.0 fixed both + preemptively added `section-label`. See memory [[lesson-wizard-default-mechs-lags-catalogue]].
2. **`sauce update --bump-pins` does NOT auto-add new transitive deps.** When project takes on `depends_on: breadcrumb`, each consumer's `ranch/platform-subscription.json` will need the new mechanism added manually before `sauce update` will install project cleanly. Use the v0.122.0 deploy pattern: a small node script that reads → pushes if missing → re-sorts → writes. See memory [[lesson-bump-pins-no-transitive-add]].
3. **GitHub OAuth scope does NOT allow Claude Code to push workflow YAML edits.** Any change to `.github/workflows/*.yml` will be rejected with `refusing to allow an OAuth App to create or update workflow without workflow scope`. Either route around (fix in non-workflow code) or hand the change to the user. See memory [[feedback-no-workflow-yaml-push-via-claude]].
4. **Branch protection on main blocks merge on `preflight (macos-latest)` failure**, but `enforce_admins: false` → owner can `gh pr merge --admin --merge`. Used in v0.122.0 to land the wizard.js fix despite the brewed predecessor's known bug. Future PRs against post-v0.122.0 brewed should pass macOS smoke cleanly.

## Release + deploy flow (only on your explicit go-ahead after CI green)

- Merge PR → main; push tag `vX.Y.Z` on the merge commit (release.yml fires ONLY on `v*.*.*` tags → opens a tap PR on `willfell/homebrew-sauce`).
- Merge the tap PR; `brew update && brew upgrade sauce`.
- Per consumer vault (`/Users/willfellhoelter/notes/sauce/{barebones,accuris-sauce,ero-sauce,headspace-sauce}`):
  ```bash
  cd <vault>
  # If a new transitive dep was added, patch subscription FIRST (see trap #2 above).
  sauce update --bump-pins && sauce status
  ```
- Expect `v<X.Y.Z>` + `Drift: none`. The installer's `exit 1` "N error/skip" is BENIGN when it's only `skipped_existing` (materialize_once) + `entity_create_block_missing` warnings with `errors:0` and `Drift: none`. The `people → people-identity` skip on barebones is also pre-existing benign — tolerated. NOT benign: skips that name a dep that should have been added to the subscription.
- Cmd+R in each Obsidian vault loads new CustomJS classes.

## GUARDRAILS

ASK BEFORE: merging to main, pushing tags, merging the tap PR, deploying to vaults. Local work (worktree commits, plans, preflight, feature-branch pushes, opening PRs, gathering CI status) is autonomous.

If the user says "execute everything and don't report back until done, tests pass, it's deployed to all vaults" (or equivalent), the full chain is authorized — but bias toward giving them ONE preflight summary (the renumber-and-execute proposal, like v0.122.0) before kicking off the implementer, so they can correct course before the heavy lifting starts.

## Canonical docs to READ FIRST (in this order)

1. `Docs/plans/2026-06-16-v0.121.0-note-chrome-standard-design.md` — the arc design. §5.1 has the registry sketch; §6 has the per-blueprint trail audit table; §7 has the migration plan (informational for THIS cycle since no body migration); §11 has the open items to resolve.
2. `Docs/plans/2026-06-16-v0.122.0-section-label-mechanism-plan.md` — your template. Same shape; copy structure verbatim.
3. `Docs/prompts/2026-06-16-note-chrome-handoff.md` — the predecessor handoff for arc context.
4. `Docs/agent-guides/project-blueprint-ui.md` — the current Breadcrumb primitive doc + project-blueprint-ordering conventions. (Will become `note-chrome.md` in a LATER cycle — not this one.)
5. `Docs/agent-guides/schemas.md` — schema registry + `npm run lint-schemas`. Read before designing the registry file.
6. `Docs/agent-guides/code-conventions.md` — the five non-negotiables, customjs gotchas, module-directory invariant, marker regions.
7. `Docs/agent-guides/architecture.md` — mechanisms vs blueprints, depends_on contract, installer aggregation patterns (which is where you'll learn how `nav-buttons-registry.json` is aggregated and apply the same to `breadcrumb-registry.json`).
8. `Docs/agent-guides/build-test-verify.md` — preflight, release/tap/deploy chain.
9. `Docs/agent-guides/vault-paths.md` — workshop / consumer / legacy paths.
10. `Docs/landmines.md` — 22 canonical traps. Especially stable-anchors-vs-display-markers (relevant if any migration eventually lands) + `materialize_once` (not directly relevant this cycle).

## Reference: the v0.122.0 promotion as your template

Look at these files from the merged v0.122.0 PR — they ARE the shape you're cloning for breadcrumb:

- `platform/mechanisms/section-label/section-label.js` — the relocated class file (with refreshed header).
- `platform/mechanisms/section-label/manifest.json` — the mechanism manifest. Mirror this shape EXACTLY for `breadcrumb/manifest.json` (you may need extra `depends_on` for whatever Breadcrumb uses).
- `platform/test/run-section-label.js` — the smoke harness. Build a similar `run-breadcrumb.js` that asserts the legacy copy is gone + a basic render produces expected DOM. Add an explicit "project-parity" assertion that loads the workshop's real `ranch/breadcrumb-registry.json` and a frontmatter fixture + asserts the rendered ancestors match the byte-output of today's project-helper version.
- `platform/blueprints/project/manifest.json` (post-merge) — drop the helpers/breadcrumb.js files[] entry (the way Task 2 dropped section-label.js), add `breadcrumb >=0.1.0` to `depends_on`, bump version.
- `platform/manifest.json` — see where `section-label` got inserted in the `mechanisms` array (between accent-button and open-helpers); use the same alphabetical/grouping order for breadcrumb.
- `ranch/platform-subscription.json` + `platform/test/seed-vault/ranch/platform-subscription.json` — see how `section-label@0.1.0` is pinned in both files.
- `platform/bootstrap-lib/wizard.js` `DEFAULT_MECHANISMS_CHECKED` — see the comment pattern for adding `breadcrumb` if it becomes foundational.

---

## Prompt to start the new chat

> Continue the **note-chrome standard arc** for the Sauce workshop (`/Users/willfellhoelter/projects/repos/sauce`). The first plan of the arc (`section-label` mechanism promotion) shipped as v0.122.0 — tag pushed, tap merged, brew upgraded, deployed clean to barebones + accuris + ero + headspace (all at v0.122.0, Drift: none). You're picking up the **next plan: the config-driven `breadcrumb` mechanism**.
>
> Read these in order before doing anything else:
> 1. `Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md` — this handoff (full state on disk + decisions + traps).
> 2. `Docs/plans/2026-06-16-v0.121.0-note-chrome-standard-design.md` — the arc design (especially §5.1 registry sketch, §6 per-blueprint trail audit, §11 open items).
> 3. `Docs/plans/2026-06-16-v0.122.0-section-label-mechanism-plan.md` — your TEMPLATE (the v0.122.0 shipped plan; copy its shape).
> 4. `Docs/agent-guides/schemas.md` — schema-registry contract before designing `breadcrumb-registry.json`.
> 5. `Docs/agent-guides/architecture.md` — installer registry-aggregation pattern (mirror `nav-buttons-registry.json`).
>
> Work from `/Users/willfellhoelter/projects/repos/sauce/.worktrees/note-chrome-foundation` (branch `feature/note-chrome-foundation`). The branch is currently on the MERGED v0.122.0 chain — reset it onto current main first:
> ```bash
> cd /Users/willfellhoelter/projects/repos/sauce/.worktrees/note-chrome-foundation
> git fetch origin main && git reset --hard origin/main
> ```
>
> **Mission:** Promote `platform/blueprints/project/helpers/breadcrumb.js` → shared `breadcrumb` mechanism + per-blueprint trail declaration aggregated into `ranch/breadcrumb-registry.json` + schema-registry entry. Class name stays `Breadcrumb` (live-render, no body migration). Project blueprint migrates onto it as the proof case — existing project notes must render byte-identical breadcrumbs (e.g. `test-project / Docs / Architecture`) after the migration.
>
> **Approach:** start with `superpowers:brainstorming` to resolve the §11 open items (resolver precedence; missing-field behavior; mapping the project's existing type dispatch onto the registry). Then `superpowers:writing-plans` to author `Docs/plans/2026-06-17-v0.123.0-breadcrumb-mechanism-plan.md` modeled on the v0.122.0 plan. Then execute via `superpowers:subagent-driven-development` (implementer → spec review → code-quality review per task). Push → PR → CI green → ask before admin-merge → tag v0.123.0 → tap PR → brew upgrade → deploy to vaults (REMEMBER: `--bump-pins` does NOT auto-add new transitive deps — patch each consumer's subscription.json before running `sauce update`).
>
> **Pre-existing memory you need:**
> - [[lesson-bump-pins-no-transitive-add]] — when project depends_on breadcrumb, every consumer needs the new mech ADDED manually.
> - [[lesson-wizard-default-mechs-lags-catalogue]] — if breadcrumb becomes foundational, add it to `platform/bootstrap-lib/wizard.js` `DEFAULT_MECHANISMS_CHECKED` in the same PR.
> - [[feedback-no-workflow-yaml-push-via-claude]] — never include `.github/workflows/*.yml` edits in autonomous pushes.
> - [[feedback-no-claude-commit-trailer]] — no Co-Authored-By Claude in commits.
> - [[project-v01220-ship-state]] — full v0.122.0 receipts + deploy outcome.
>
> Use subagent-driven execution, honor version-lockstep, live-render-vs-migration, the preflight gate (`npm run release:preflight`, 600s timeout), and the release+deploy flow. Ask before merging to main, pushing tags, merging the tap PR, or deploying to vaults. Local work (commits, plans, preflight, feature-branch pushes, opening PRs) is autonomous.
