---
date: 2026-05-03
refined: 2026-05-04
phase: design
status: approved (v0.1.1 closed; v0.2.0 ready when chosen)
target_cycle: v0.2.0
supersedes: none
related:
  - 2026-05-03-registry-driven-nav-buttons-design.md
  - 2026-05-03-multi-vault-automation-design.md
  - 2026-05-03-registry-driven-nav-buttons-result.md
  - landmines.md
---

# Design — `boards` blueprint + module-directory invariant (v0.2.0)

> [!info] 2026-05-04 refinement — `beacon/` namespace adopted
> All materialized blueprint content moves under a `beacon/` parent namespace. The boards blueprint's content path becomes `beacon/boards/`, not top-level `boards/`. This applies to ALL paths in this design — wherever you see `boards/<thing>` referring to consumer-vault materialization, mentally substitute `beacon/boards/<thing>`.
>
> **Mechanism update:** `module_directory` field in blueprint manifests stays as a bare name (e.g., `"module_directory": "boards"`). The installer derives the substitution value `{{module_directory}}` to be the full namespaced path (`beacon/boards`). Templates that reference `{{module_directory}}/card-notes/...` resolve correctly to `beacon/boards/card-notes/...`.
>
> **Why:** the `beacon/` namespace cleanly demarcates platform-managed content from consumer-personal content. Consumers keep any other top-level structure (`Timestamps/`, `Resources/`, etc.) without collision risk. Codified in CLAUDE.md non-negotiables + landmine #11 + how.md "Module directory" section, all updated 2026-05-04.
>
> **Project name:** the platform is now formally **Beacon**. GitHub remote: `git@github-personal:willfell/beacon.git` (HTTPS: `https://github.com/willfell/beacon`).

> [!abstract] Goal
> Ship a real `boards` blueprint mirroring the accuris task-board mechanism (Obsidian Kanban plugin board + Templater-routed dated card notes). Codify a new platform non-negotiable: every blueprint owns one top-level consumer-vault directory. Retire the project blueprint's mis-attributed Board contribution as part of the same cycle.

> [!info] Why this design exists
> v0.1.1 S4 manual smokes surfaced two findings: (1) the project blueprint's `Board` button materializes a Dataview-list view, but the user's mental model + accuris reference is an Obsidian-Kanban-plugin board with dated card notes — wrong primitive, not just under-polished. (2) The platform lacks an isolation guarantee between modules — projects, boards, future trips/finance/to-do all currently sharing top-level real estate (e.g., `boards/planning/<slug>/` mixes "boards" naming with "project" semantics). Both surfaced naturally; both deserve the same cycle.

---

## Decisions locked during brainstorming

> [!success] Approved choices (2026-05-03)
> - **New non-negotiable: module-directory invariant.** Every blueprint declares ONE top-level consumer-vault directory it owns. All files materialized into that consumer (per-vault content, card notes, sub-notes) live under that directory. Cross-module data flows via wikilinks only — no module writes into another's directory. New CLAUDE.md non-negotiable + new landmine.
> - **`boards` is the right name.** Mirrors accuris's "Board" mechanism (kanban + bigger-scope task cards). Distinct from a future `to-do` module (daily checklist surface, like accuris's `Timestamps/ToDo/`). The two are not interchangeable.
> - **The boards blueprint replaces the project blueprint's Board contribution.** Project blueprint loses `nav_buttons[]` + the kanban template file in v0.2.0 (bumps to v0.3.0, breaking — any consumer that subscribed to the project Board re-subscribes via `boards`). Boards blueprint owns the Board button.
> - **External dependency declared, not auto-installed.** The Obsidian Kanban community plugin must be enabled in the consumer. Platform installer surfaces a `post_install: notice` instructing the user; CLAUDE.md / use.md document the prerequisite. Auto-installing community plugins is out of scope (would require touching `.obsidian/community-plugins.json`, an "ask before" gate per CLAUDE.md, and is fragile).
> - **Sequencing:** v0.1.1 closes first (T4.6 + T4.7 manual smokes pending) → v0.1.2 ships (git-based pull, already designed) → v0.2.0 ships boards blueprint + retires project blueprint's Board.

> [!info] Inherited from prior cycles
> - JSON-everywhere (landmine #6).
> - Desktop-only (landmine #8 — `fs` + `child_process`).
> - Failure-loud posture (every error path Notice + history entry).
> - `template_source` is BASENAME ONLY in `nav_buttons[]` declarations.
> - Workshop dogfods every release before promoting to consumers.

---

## The module-directory invariant (codification)

> [!warning] New platform non-negotiable (refined 2026-05-04)
> Every blueprint declares ONE directory at `beacon/<module_directory>/` in the consumer vault that it exclusively owns. All files the blueprint materializes — at install time OR at runtime via the blueprint's templates / commands / nav-button actions — land under that directory.
>
> **Consequences:**
> - Install/update/uninstall a blueprint = touch one directory at `beacon/<module>/`. Predictable.
> - Cross-module name collisions become impossible by construction.
> - Platform-managed content is cleanly demarcated from consumer-personal content via the `beacon/` namespace.
> - New blueprints get a clean recipe — pick a directory name under `beacon/`, own it.
> - Each blueprint's manifest declares `module_directory: "<name>"` (NEW required field, bare name).
> - Installer derives the materialization root as `<vault_root>/beacon/<module_directory>/`.
> - Substitution variable `{{module_directory}}` resolves to the full namespaced path `beacon/<module_directory>` (so templates that reference `{{module_directory}}/foo` get correct paths).
>
> **Non-applicable to mechanisms.** Mechanisms (cross-cutting code: `customjs-guard`, `validator`, `audit`, `nav-buttons`) keep landing under `Docs/Meta/Scripts/` and `Docs/Meta/Views/` — shared infrastructure, not modules, NOT under `beacon/`.
>
> **Existing layout drift (project blueprint, double violation):**
> - Today: project blueprint materializes under `boards/planning/<slug>/` — wrong namespace (no `beacon/` prefix) AND wrong module dir (lives under `boards/` instead of own `projects/`).
> - Future: a separate cycle migrates project blueprint to own `beacon/projects/<slug>/`. Out of scope for v0.2.0 (which retires project's Board contribution but doesn't migrate the project blueprint's location). Documented as known follow-up.
>
> **v0.1.1's stale `boards/To-Do-Board.md`:**
> - Today (post-v0.1.1): barebones has a top-level `boards/To-Do-Board.md` (Dataview kanban from v0.1.1).
> - v0.2.0: ships a NEW Kanban-plugin board at `beacon/boards/To-Do-Board.md` (different path due to namespace).
> - The old file becomes orphaned. Stage 4 of v0.2.0 needs a cleanup step (delete or migrate the old file). Plan as part of the migration mechanic.
>
> **Codification surfaces:**
> - `CLAUDE.md` — new non-negotiable in the "Non-negotiables" section.
> - `Docs/landmines.md` — new entry (#11) — collision risks if violated, the layout drift problem, the manifest-field requirement.
> - `Docs/how.md` — concept section "Module directories."
> - `platform/install.js` — validates `module_directory` is declared on every blueprint manifest; refuses to install otherwise (failure-loud).

---

## Architecture overview

> [!example]- File-level diff
> ```
> WORKSHOP                                                                CONSUMER (post-v0.2.0 install in barebones)
> ─────────────────────────────────────────                               ─────────────────────────────────────────
> platform/manifest.json                                                  Docs/Meta/platform-subscription.json
>   blueprints[]:                                                           blueprints[]:
>     project:  0.2.0 → 0.3.0  (drops Board contribution)                     boards:  0.1.0  (NEW)
>     boards:   NEW @ 0.1.0                                                    project: 0.2.0 → 0.3.0  (or drop if not used)
> 
> platform/blueprints/boards/                                              boards/
>   manifest.json                                                            To-Do-Board.md            (Kanban-plugin board)
>     name: boards                                                           card-notes/
>     module_directory: boards         ← NEW field                             2026/
>     depends_on:                                                                05-May/
>       nav-buttons >=2.0.0                                                        <Card Title>.md   (auto-routed by Templater)
>       customjs-guard >=1.0.0
>     nav_buttons:                                                          Docs/Meta/Templates/
>       - id: boards (or board)                                                 Template, Board Card.md  (Templater card template)
>         label: Board
>         action: createFromTemplate
>         target: boards/To-Do-Board.md
>         template_source: To-Do-Board.md   ← basename only
>     files:
>       - source: content/To-Do-Board.md
>         dest:   {{module_directory}}/To-Do-Board.md
>       - source: templates/Template, Board Card.md
>         dest:   {{templates_path}}/Template, Board Card.md
>     post_install:
>       - type: notice
>         message: "Boards blueprint installed. Required: enable the
>                   'Kanban' community plugin (Settings → Community plugins).
>                   First click of the Board button will materialize the
>                   board."
> 
>   content/To-Do-Board.md     (NEW — Obsidian Kanban plugin board)
>   templates/Template, Board Card.md   (NEW — Templater card template
>                                         with date-routing tp.file.move)
> 
> platform/blueprints/project/manifest.json                                Docs/Meta/Content/project/kanban-board.md
>   version: 0.2.0 → 0.3.0   (BREAKING)                                       (DELETED on next install — pruned by installer)
>   nav_buttons[]: REMOVED                                                  boards/To-Do-Board.md
>   files[] entry for content/kanban-board.md: REMOVED                        (REPLACED with Kanban-plugin format on next install
>                                                                              — see "Migration mechanic" below)
> 
> platform/install.js                                                      Docs/Meta/nav-buttons-registry.json
>   + module_directory validation per blueprint manifest                     contributions.project: REMOVED (auto-pruned)
>   + {{module_directory}} substitution variable (per-blueprint)             contributions.boards: ADDED (Board button entry)
>   + stale-content overwrite mechanic
>     (see "Migration mechanic" — open design call)
> ```

### Data flow at click time

1. User opens any note in the consumer; SpaceNavButtons renders the Board button (boards blueprint's contribution).
2. User clicks Board → renderer's `_dispatchAction` reads `target: boards/To-Do-Board.md`. If the file exists with valid Kanban-plugin frontmatter → just open. If absent → read `template_source`, write to `target`, open.
3. The materialized `To-Do-Board.md` is an Obsidian Kanban board. Plugin renders four columns.
4. User clicks "Add a card" inside the board → Kanban plugin creates `boards/card-notes/<title>.md` from `Template, Board Card.md`.
5. Templater intercepts new-file event, runs the template:
   - Sets frontmatter: `source_board: boards/To-Do-Board.md`, `tags: [<vault_identity_tag>, board, YYYY/MM/DD]`, `created: <timestamp>`.
   - Runs `tp.file.move("boards/card-notes/" + YYYY + "/" + MM-MMMM + "/" + title)` → relocates to date-routed path.
6. Wikilink in the kanban (`[[<title>]]`) resolves via Obsidian's name-based resolution — works even after the move.

---

## File shapes

### `content/To-Do-Board.md` (kanban template body, pre-substitution)

> [!example]- Body sketch
> ```markdown
> ---
> kanban-plugin: board
> title: To Do Board
> created: <created at install time — substituted via lenient body sub or carried forward unchanged>
> type: kanban
> tags:
>   - "{{vault_identity_tag}}"
>   - board
> ---
> 
> ## To Do
> 
> 
> ## In Progress
> 
> 
> ## Done
> 
> 
> ***
> 
> ## Archive
> 
> 
> %% kanban:settings
> ```
> {"kanban-plugin":"board","list-collapse":[false,false,false],"mark-cards-complete":true,"new-note-folder":"{{module_directory}}/card-notes","new-note-template":"{{templates_path}}/Template, Board Card.md"}
> ```
> %%
> ```
>
> Substitutions at install time (lenient body sub):
> - `{{vault_identity_tag}}` → consumer's value (must be in `platform-config.json:variables` per landmine #9; barebones already has it).
> - `{{module_directory}}` → `boards` (per the blueprint's `module_directory` declaration).
> - `{{templates_path}}` → consumer's templates_path (e.g., `Docs/Meta/Templates`).

### `templates/Template, Board Card.md` (Templater card template)

> [!example]- Body sketch
> ```markdown
> ---
> created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
> source_board: {{module_directory}}/To-Do-Board.md
> tags:
>   - "{{vault_identity_tag}}"
>   - board
>   - <% tp.date.now("YYYY/MM/DD") %>
> ---
> <%* await tp.file.move("{{module_directory}}/card-notes/" + tp.date.now("YYYY") + "/" + tp.date.now("MM-MMMM") + "/" + tp.file.title) %>
> 
> ```dataviewjs
> await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
> ```
> 
> ---
> ```
>
> Substitutions at install time:
> - `{{vault_identity_tag}}` → consumer's value
> - `{{module_directory}}` → `boards`
> - `{{views_path}}` → consumer's views_path
>
> The `<% %>` Templater tokens pass through unchanged (lenient body sub doesn't match `<% ... %>` patterns; only `{{xxx}}` patterns).

### Manifest declaration shape (boards blueprint)

> [!example]- platform/blueprints/boards/manifest.json
> ```json
> {
>   "name": "boards",
>   "version": "0.1.0",
>   "kind": "blueprint",
>   "module_directory": "boards",
>   "description": "Kanban-plugin task board with date-routed card notes.",
>   "depends_on": [
>     { "name": "nav-buttons",    "range": ">=2.0.0" },
>     { "name": "customjs-guard", "range": ">=1.0.0" }
>   ],
>   "external_plugins": [
>     { "id": "obsidian-kanban", "required": true, "reason": "Renders the To-Do-Board.md kanban view" }
>   ],
>   "files": [
>     { "source": "content/To-Do-Board.md",         "dest": "{{module_directory}}/To-Do-Board.md" },
>     { "source": "templates/Template, Board Card.md", "dest": "{{templates_path}}/Template, Board Card.md" }
>   ],
>   "nav_buttons": [
>     {
>       "id": "boards-board",
>       "label": "Board",
>       "icon": "board",
>       "order": 100,
>       "action": {
>         "type": "createFromTemplate",
>         "target": "{{module_directory}}/To-Do-Board.md",
>         "template_source": "To-Do-Board.md"
>       }
>     }
>   ],
>   "post_install": [
>     {
>       "type": "notice",
>       "message": "Boards blueprint installed. REQUIRED: enable the Kanban community plugin (Settings → Community plugins → Browse → Kanban). Then click the Board button from any note's nav."
>     }
>   ],
>   "rule_fragments": []
> }
> ```
>
> Note `id: "boards-board"` — namespaced to avoid collision with project blueprint's existing `id: "board"` during the v0.2.0 transition window. After project@0.3.0 lands and prunes its contribution, we could rename. Or accept the namespaced id as the convention going forward (`<module>-<purpose>`).

### Project blueprint v0.3.0 (retiring its Board contribution)

> [!example]- platform/blueprints/project/manifest.json (v0.3.0 form)
> ```json
> {
>   "name": "project",
>   "version": "0.3.0",
>   "kind": "blueprint",
>   "module_directory": "boards",   // CURRENT mis-located dir; future cycle migrates to "projects"
>   ...
>   "files": [
>     // existing 9 entries; the kanban-board.md entry REMOVED
>   ],
>   "nav_buttons": [],   // EMPTY — Board contribution retired; boards blueprint owns it
>   ...
> }
> ```
>
> Note: project blueprint claiming `module_directory: "boards"` violates the invariant (it doesn't own that directory; the boards blueprint does). Acknowledged tech debt — the "migrate project to projects/" cycle resolves this. For v0.2.0 close, both blueprints are subscribed and they coexist with project ALMOST owning a sub-tree (`boards/planning/`) inside boards's territory. Documented as known violation in the v0.2.0 result writeup.

---

## Migration mechanic — open design call

> [!warning] The stale-target-file problem
> Existing barebones state has `boards/To-Do-Board.md` materialized as a 470B Dataview-kanban file (from v0.1.1's project Board). When v0.2.0 installs the boards blueprint, that file is mid-flight: the new content (Kanban-plugin board) wants the same path; the dispatch's "if exists, just open" means a stale Dataview file would shadow the new kanban indefinitely.
>
> Same root cause as today's lazy-scaffold finding (empty 0-byte `To-Do-Board.md` from v0.1.0 era blocked v0.1.1's materialization in barebones).

### Three options for the dispatch / installer

> [!info]- Option A — "delete first, install second" (manual user step)
> v0.2.0 result writeup tells consumers: "Before installing v0.2.0, delete `boards/To-Do-Board.md` if it exists." Cheapest. Most fragile (relies on user reading the doc + not forgetting). Doesn't help future stale-state cases.

> [!info]- Option B — installer overwrites content files when source.bytes != dest.bytes (Recommended)
> Installer compares the source's post-substitution body against the dest's current body. If they differ AND the destination is a content file (not a runtime-generated artifact like card notes), overwrite. Records a `replaced` history event with old-file SHA + new-file SHA for audit. The dispatch's "if exists, open" stays unchanged — that's a click-time concern, separate from install-time content management.
>
> Trade: installer becomes more invasive (writes over consumer state). Mitigation: only applies to files explicitly listed in `files[]` (NOT runtime-generated card notes, NOT user-created files). The `files[]` is the platform's contract; updating those files is what versioning is for.

> [!info]- Option C — versioned content files
> Add `version` per file in `files[]`. Installer tracks installed version per file in `platform-installed.json`. Overwrites if blueprint version > installed file version. More state to manage; adds complexity. Likely overkill for v0.2.0.

> [!info]- Option D — `pre_install` migration step in manifest
> New manifest field `pre_install[]` runs before file copies. Could declare `{ type: "delete", path: "{{module_directory}}/To-Do-Board.md", reason: "stale Dataview kanban from v0.1.1 — replaced by Kanban-plugin board" }`. One-shot per blueprint version. More general than B but heavier.

**Recommendation:** Option B. Smallest installer change; matches existing semantics (the platform manages files declared in `files[]`); no new manifest fields. The "if file exists" dispatch behavior in `space-nav-buttons.js` stays — that's about user-created targets, distinct from platform-managed files.

---

## Failure-loud posture

| Failure | Behavior | History |
|---|---|---|
| Blueprint manifest missing `module_directory` | Installer Notice + skip blueprint; refuse to install | `error, step: module_directory_missing` |
| Two blueprints declare the same `module_directory` | Installer Notice + skip the LATER one (first-wins by install order); install proceeds with the first | `warning, step: module_directory_collision` |
| Kanban plugin not enabled in consumer at click time | User clicks Board → renderer dispatches createFromTemplate → file materializes; Obsidian renders it as plain markdown (not as a kanban). Recovery: user enables plugin via Settings → Community plugins | n/a (renderer-side) |
| Stale `To-Do-Board.md` blocks new content | Per Option B above: installer overwrites (replace event); preserves prior file as `.bak` next to dest if non-empty | `replace, step: file_overwrite, dest, prior_sha, new_sha` |
| `template_source` for the Kanban board missing at click time | Notice naming the missing file; abort | n/a (renderer-side) |
| All v0.1.x hardenings (C2/C4/E1/E3/L2 + strict/lenient + #9 substitution scope + #10 triple-bump) | Carried forward | as before |

---

## Stage breakdown (rough — gates `de:writing-plans`)

> [!todo] Stage 1 — installer extensions for module-directory invariant + content-overwrite
> - Add `module_directory` field validation to `applyManifest`.
> - Add `{{module_directory}}` per-blueprint substitution variable.
> - Implement Option B content overwrite (compare bytes; replace if changed; `.bak` for non-empty prior files; record `replace` history event).
> - Workshop self-install green; bootstrap copies re-synced × 3.
> - Add landmine #11 (module-directory invariant) to `Docs/landmines.md`.
> - Update CLAUDE.md non-negotiables.

> [!todo] Stage 2 — boards blueprint v0.1.0
> - Create `platform/blueprints/boards/` with `manifest.json`, `content/To-Do-Board.md`, `templates/Template, Board Card.md`.
> - Bump `platform/manifest.json:blueprints[]` to include `boards@0.1.0`.
> - Workshop subscribes (or NOT — workshop's "no personal content" rule applies; same posture as project — barebones-only dogfood).

> [!todo] Stage 3 — retire project blueprint's Board contribution (project@0.3.0)
> - Drop `nav_buttons[]` from project manifest.
> - Drop `content/kanban-board.md` from project's `files[]`.
> - Bump project to v0.3.0 in workshop manifest.
> - Subscription-aware pruning will auto-remove `contributions.project` from consumer registries.
> - Stale `Docs/Meta/Content/project/kanban-board.md` cleanup: relies on Option B overwrite OR a one-shot manual cleanup step in v0.2.0 result writeup.

> [!todo] Stage 4 — barebones regression sweep
> - Bump barebones subscription to project@0.3.0 + boards@0.1.0.
> - Run install harness; verify:
>   - boards module directory created with kanban template
>   - Old Dataview kanban replaced (Option B mechanic)
>   - Card template lands in templates_path
>   - Registry has only `boards-board` Board entry; project's stale `board` entry pruned
> - Manual smoke (Obsidian-driven; can't be harness-tested): user enables Kanban plugin, opens kanban board, adds a card, verifies date-routing works (`boards/card-notes/2026/05-May/<title>.md`).
> - Result writeup at `Docs/plans/2026-05-04-boards-blueprint-result.md` (or whatever date the cycle closes).

---

## Subscription state per consumer after v0.2.0

| Consumer | nav-buttons | project | boards | Notes |
|---|:---:|:---:|:---:|---|
| `poc-vault` (workshop) | 2.0.0 | (dropped) | (dropped) | Renderer dogfood only; no module content in workshop. |
| `tmp-test-barebones-vault` | 2.0.0 | 0.3.0 (or dropped) | 0.1.0 | Regression target. |
| `tmp-acc-vault` | held | held | (not subscribed) | Awaits accuris note-type blueprints. |

---

## Open trail (3 design calls awaiting user input)

> [!question]- 1. Card-notes path
> Accuris uses `boards/to-do/card-notes/YYYY/MM-MMMM/`. The extra `to-do/` segment is accuris-legacy naming (its dir is more granular). For the workshop's boards blueprint, simpler:
> - **Recommended:** `boards/card-notes/YYYY/MM-MMMM/<title>.md` — drop the `to-do/` segment. Cleaner, single-purpose.
> - Alternative: `boards/cards/YYYY/MM-MMMM/<title>.md` — even shorter.
> - Alternative: keep `boards/to-do/card-notes/...` for accuris-compat.
>
> Affects: kanban-plugin settings comment block; card template `tp.file.move()` path; documentation.

> [!question]- 2. Button id namespacing
> Today the project blueprint's button id is bare `"board"`. The boards blueprint introduces a Board button — collision unless we namespace.
> - **Recommended:** `id: "boards-board"` (namespaced as `<module>-<purpose>`); enforce as a convention going forward. Clean precedent for `to-do-list`, `trips-itinerary`, `finance-summary`, etc.
> - Alternative: drop project blueprint's button FIRST in v0.1.x patch, then boards uses bare `id: "board"` in v0.2.0. Two cycles, less convention.
>
> Affects: nav-buttons registry; future blueprint contributions; landmines.

> [!question]- 3. External plugin declaration mechanism
> The Kanban plugin is required but the platform can't auto-install community plugins.
> - **Recommended:** `external_plugins[]` field in manifest; installer surfaces a `post_install: notice` AND a structured warning if the plugin isn't enabled (read `.obsidian/community-plugins.json` — read-only check, no edits). Documented in CLAUDE.md / use.md.
> - Alternative: just a notice; no automated check. User responsibility.
>
> Affects: install.js, manifest schema, documentation.

---

## Out of scope

- **Migrating project blueprint to own `projects/`** instead of the mis-located `boards/planning/<slug>/`. Future cycle (v0.2.x or v0.3.0).
- **Multi-board support per consumer** (e.g., a "Personal" board AND a "Work" board). Single board for v0.2.0; multi-board is a future blueprint variant.
- **Card-note templating beyond date routing** (e.g., per-area templates, frontmatter validation rules). Defer.
- **Kanban-plugin auto-install via `.obsidian/community-plugins.json` edit.** Out of scope; CLAUDE.md "ask before" gate.
- **Migrating accuris to v0.2.0.** Separate cycle when the rest of the accuris note-type blueprints (daily, todo, meetings, summary, planning) are designed.
- **Mobile install support.** Still desktop-only.

---

## Cross-cutting risks & landmines (preview for `Docs/landmines.md`)

> [!warning] New landmines surfaced by this design
> 1. **Module-directory collisions are catastrophic.** If two blueprints declare the same `module_directory`, the second blueprint's writes can clobber the first's runtime-generated files. Installer enforces uniqueness; manual hand-edit of manifests can violate.
> 2. **Wikilink resolution depends on Obsidian's name-based lookup.** Date-routed card notes work because Obsidian resolves `[[<title>]]` by name, not path. If two blueprints both ship card-notes with overlapping titles, links go to the wrong note. Mitigation: each blueprint's card titles SHOULD be unique within the consumer; consider prefixing for multi-board future.
> 3. **The Kanban plugin is an external runtime dependency.** v0.2.0 install can succeed AND the user can have a broken Board button (renders as raw markdown instead of kanban) if the plugin isn't enabled. The `post_install: notice` mitigates but doesn't prevent.
> 4. **Templater's new-file-template hook must be enabled** (Settings → Templater → "Trigger Templater on new file creation"). Without it, the kanban plugin creates the file but the `tp.file.move()` doesn't fire, leaving the card in `boards/card-notes/` un-routed. Document in post_install notice.

---

## Next step

User reviews this draft alongside the v0.1.1 manual smokes (T4.6 + T4.7). Resolve the three open trail questions. After v0.1.1 closes via T4.10, hand off to `de:writing-plans` to produce the v0.2.0 implementation plan.
