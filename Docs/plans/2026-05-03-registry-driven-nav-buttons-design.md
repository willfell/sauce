---
date: 2026-05-03
phase: design
status: approved
supersedes: none
related:
  - 2026-05-02-nav-buttons-and-project-blueprint-design.md
  - 2026-05-03-nav-buttons-scope-and-blueprint-content-handoff.md
  - landmines.md
---

# Design — registry-driven nav-buttons + lazy content scaffolding (v0.1.1)

> [!abstract] Goal
> Close the two design surprises Stage 4 surfaced. Refactor `SpaceNavButtons` from a kitchen-sink class with hardcoded accuris paths into a thin renderer over an installer-aggregated **registry**. Each blueprint or mechanism declares the buttons it owns; the installer merges declarations into `Docs/Meta/nav-buttons-registry.json`. Add a `createFromTemplate` button action so first-click on the project blueprint's "Board" button materializes a working Dataview-driven kanban from a template the blueprint ships. Outcome: barebones renders exactly the buttons that match what's installed, and clicking them produces working content instead of empty stubs.

> [!info] Context
> v0.1.0 shipped four mechanisms + the project blueprint into a barebones vault. Stage 4 smoke tests revealed two gaps: (1) `SpaceNavButtons` rendered 7+ accuris-shaped buttons regardless of what was actually installed; (2) clicking "Board" auto-created an empty `boards/To-Do-Board.md` because the platform shipped *code* but no companion content. See [2026-05-03-nav-buttons-scope-and-blueprint-content-handoff.md](2026-05-03-nav-buttons-scope-and-blueprint-content-handoff.md) for the full surprise post-mortem and the A/B/C option set this design picks from.

---

## Decisions locked during brainstorming

> [!success] Approved choices
> - **Conceptual model:** registry-driven. Each mechanism/blueprint declares `nav_buttons[]` in its manifest; installer aggregates into `Docs/Meta/nav-buttons-registry.json`. Buttons the vault has = buttons the nav shows.
> - **Surprise 2 strategy:** lazy via button action. New `createFromTemplate` action type creates the target on first click from a template the blueprint shipped. No new install-time scaffolding concept.
> - **Strip depth:** hard. nav-buttons v2.0.0 is a thin renderer. No prev/next arrows, no path heuristics, no kanban-card sniffing. Those move to future blueprints (`daily`, `temporal-nav`) when shipped.
> - **Workshop dogfood policy:** workshop drops the project subscription. Workshop subscribes to `nav-buttons@2.0.0` only (proves the renderer over an empty registry). project is dogfooded exclusively in barebones. Keeps "no personal content" non-negotiable intact.
> - **Kanban template body:** Dataview-driven. `boards/To-Do-Board.md` is plain markdown plus a dataviewjs block that lists projects from `boards/planning/<slug>/` as a board. Depends only on Dataview, already required by the platform.
> - **`workshop_version` bump:** 0.3.0 → **0.4.0** at the end of S1, when the installer changes land. Standard global-release-marker bump.
> - **Future-plans appendix:** the doc includes a brief sketch of how accuris migrates from v1.0.0 to v2.0.0 (daily/todo/meetings/summary/planning blueprints + temporal-nav mechanism), so future-us isn't surprised.

> [!info] Mechanical decisions encoded by lead designer (not surfaced as questions)
> - **Registry location:** `Docs/Meta/nav-buttons-registry.json` — its own file under `meta_path`, not folded into `rules/_global.json`. Different lifecycle, different reader (renderer vs validator), different failure modes.
> - **Async registry read:** `app.vault.adapter.read("Docs/Meta/nav-buttons-registry.json")` then `JSON.parse`. Symmetric with the installer's existing `adapter.write` for `platform-installed.json`.
> - **Order semantics:** integer (default 100, lower = earlier). Ties broken by source name then id. No opinionated reservation buckets (YAGNI).

---

## Architecture overview

> [!example]- File-level diff (workshop, barebones, tmp-acc-vault)
> ```
> WORKSHOP                                              CONSUMER (barebones)
> ─────────────────────                                 ─────────────────────
> platform/install.js                                   Docs/Meta/platform-config.json
>   + applyNavButtons (parallels applyRuleFragment)       + variables.content_path
>   + content_path substitution variable
>   + subscription-aware contribution pruning           Docs/Meta/platform-subscription.json
>                                                         nav-buttons: 1.0.0 -> 2.0.0
> platform/manifest.json                                  project:     0.1.0 -> 0.2.0
>   workshop_version: 0.3.0 -> 0.4.0  (S1)
>   nav-buttons:      1.0.0 -> 2.0.0  (S2)              Materialized after install:
>   project:          0.1.0 -> 0.2.0  (S3)                Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js  (replaced)
>                                                         Docs/Meta/Content/project/kanban-board.md           (NEW)
> platform/mechanisms/nav-buttons/                        Docs/Meta/nav-buttons-registry.json                 (NEW)
>   space-nav-buttons.js          (full rewrite)
>   manifest.json                 (no nav_buttons[])    First-click on Board:
>                                                         boards/To-Do-Board.md materialized from kanban template
> platform/blueprints/project/
>   manifest.json                 + nav_buttons[]
>                                 + content/kanban-board.md file entry      WORKSHOP
>   content/kanban-board.md       (NEW — Dataview-driven)                   ──────────────────────
>                                                                           Docs/Meta/platform-subscription.json
>                                                                             nav-buttons: 1.0.0 -> 2.0.0
> tmp-acc-vault                                                               (project NOT subscribed)
> ─────────────────────
>   subscription unchanged: nav-buttons@1.0.0, project@0.1.0
>   continues using kitchen-sink class until accuris's note-type
>   blueprints (daily/todo/meetings/...) are designed and shipped
> ```

### Data flow

1. Each installed mechanism / blueprint manifest may declare `nav_buttons[]`.
2. On install, `applyNavButtons` merges declarations into `Docs/Meta/nav-buttons-registry.json` under `contributions.<source>` — same namespacing pattern as `rule_fragments`.
3. The installer prunes `contributions.<X>` for any X not in the current subscription. Self-cleaning registry; no separate uninstall mechanic needed in v0.1.1.
4. `SpaceNavButtons` (v2.0.0) reads the registry at render time, sorts by `order` then source then id, dispatches click on `action.type`.
5. Action types: `openLink` and `createFromTemplate`. The latter reads a blueprint-shipped content file and writes it to `target` on first click.

---

## Registry schema

> [!example]- Docs/Meta/nav-buttons-registry.json (post-install in barebones)
> ```json
> {
>   "schema_version": 1,
>   "contributions": {
>     "project": [
>       {
>         "id": "board",
>         "label": "Board",
>         "icon": "board",
>         "order": 100,
>         "action": {
>           "type": "createFromTemplate",
>           "target": "boards/To-Do-Board.md",
>           "template_source": "Docs/Meta/Content/project/kanban-board.md"
>         }
>       }
>     ]
>   }
> }
> ```

- **`contributions.<source>`** — namespaced under the contributing item's name, mirrors `rules/_global.json:contributions.<source>`.
- **`order`** — integer, default 100. Lower = earlier. Ties broken by source name then id.
- **`icon`** — name string keying into the renderer's icon map. Unknown name → fallback chip with first letter of label.
- **`action.template_source`** — declared in the manifest as a **basename only** (e.g., `kanban-board.md`). The installer rewrites it to the consumer-resolved absolute-vault form `${content_path}/${source-name}/${basename}` (e.g., `Docs/Meta/Content/project/kanban-board.md`) at install time. **Do NOT include `content/` or any directory prefix in the manifest's `template_source`** — the installer prepends `${content_path}/${source}/` automatically; a directory prefix produces a doubled-segment path. This convention parallels how `files[].dest` declares the destination basename.

---

## Manifest declaration shape

> [!example]- platform/blueprints/project/manifest.json (S3 form)
> ```json
> {
>   "name": "project",
>   "version": "0.2.0",
>   "kind": "blueprint",
>   "description": "Project note bundle.",
>   "depends_on": [
>     { "name": "nav-buttons",    "range": ">=2.0.0" },
>     { "name": "customjs-guard", "range": ">=1.0.0" }
>   ],
>   "customjs_classes": [ ... existing ... ],
>   "files": [
>     ... existing 9 entries ...,
>     { "source": "content/kanban-board.md", "dest": "{{content_path}}/project/kanban-board.md" }
>   ],
>   "nav_buttons": [
>     {
>       "id": "board",
>       "label": "Board",
>       "icon": "board",
>       "order": 100,
>       "action": {
>         "type": "createFromTemplate",
>         "target": "boards/To-Do-Board.md",
>         "template_source": "kanban-board.md"
>       }
>     }
>   ],
>   "post_install": [ ... existing notice ... ],
>   "rule_fragments": []
> }
> ```
>
> Note `template_source: "kanban-board.md"` is a **basename only** — the installer prepends `${content_path}/${source-name}/` at install time. The `files[]` entry above ships the source from `content/kanban-board.md` (manifest-relative) to `{{content_path}}/project/kanban-board.md` (vault-relative); the registry's `template_source` resolves to the same vault-relative dest.

The mechanism manifest gains `nav_buttons[]` too (currently empty for nav-buttons itself — it's the renderer, not a contributor).

---

## Action types (v0.1.1)

| `type` | Required fields | Behavior |
| :----: | --- | --- |
| `openLink` | `target` (string path) | `app.workspace.openLinkText(target, "")`. For "go to existing thing." |
| `createFromTemplate` | `target` (path), `template_source` (path) | If `target` exists → open. Else: read `template_source`, write to `target`, open. If `template_source` missing at click time → Notice + abort (no empty file). |

> [!info] Why two types is the v0.1.1 cut
> Future action types (`prevDay`, `nextDay`, `runTemplaterTemplate`, `runQuickAddCapture`) belong to future blueprints that need them. YAGNI — add when first painful.

---

## Installer changes (`platform/install.js`)

> [!example]- applyNavButtons (parallels applyRuleFragment)
> ```javascript
> function applyNavButtons(item, manifest, paths, history) {
>   if (!Array.isArray(manifest.nav_buttons) || manifest.nav_buttons.length === 0) return;
>
>   const registryPath = `${paths.meta_path}/nav-buttons-registry.json`;
>   let registry;
>   try {
>     registry = readJsonOrEmpty(registryPath, { schema_version: 1, contributions: {} });
>   } catch (parseErr) {
>     new Notice(`nav-buttons-registry.json malformed; skipping ${manifest.name}: ${parseErr.message}`, 8000);
>     history.push({ event: "error", step: "nav_buttons", name: manifest.name, error_message: parseErr.message });
>     return; // C4 hardening posture — no clobber on malformed pre-existing file
>   }
>
>   registry.contributions = registry.contributions || {};
>   const validated = manifest.nav_buttons
>     .map(btn => validateAndResolve(btn, manifest.name, paths))
>     .filter(Boolean);
>
>   if (validated.length === 0) {
>     // every button entry was malformed; skip contribution
>     history.push({ event: "error", step: "nav_buttons", name: manifest.name, reason: "all entries invalid" });
>     return;
>   }
>
>   registry.contributions[manifest.name] = validated;
>   writeJson(registryPath, registry);
> }
>
> function validateAndResolve(btn, sourceName, paths) {
>   if (!btn.id || !btn.label || !btn.action || !btn.action.type) {
>     new Notice(`nav-buttons: invalid declaration in ${sourceName} (missing id/label/action)`, 8000);
>     return null;
>   }
>   if (btn.action.type === "createFromTemplate" && btn.action.template_source) {
>     return {
>       ...btn,
>       action: { ...btn.action, template_source: `${paths.content_path}/${sourceName}/${btn.action.template_source}` }
>     };
>   }
>   return btn;
> }
> ```

> [!example]- Subscription-aware pruning (end of install loop)
> ```javascript
> // After all installable items have been processed:
> const subscribedNames = new Set([
>   ...subscription.mechanisms.map(m => m.name),
>   ...subscription.blueprints.map(b => b.name),
> ]);
> const registry = readJsonOrEmpty(`${paths.meta_path}/nav-buttons-registry.json`, null);
> if (registry) {
>   for (const source of Object.keys(registry.contributions || {})) {
>     if (!subscribedNames.has(source)) delete registry.contributions[source];
>   }
>   writeJson(`${paths.meta_path}/nav-buttons-registry.json`, registry);
> }
> ```

### New substitution variable

| Variable | Purpose | Default |
| --- | --- | --- |
| `content_path` | Where blueprint-shipped content files (NOT Templater templates) land | `Docs/Meta/Content` |

> [!info] Why a new path vs. reusing `templates_path`
> Templater templates live in `templates_path` and are invoked via Templater's machinery (with `<% ... %>` substitution). `content/kanban-board.md` is **plain markdown** read by SpaceNavButtons via `app.vault.adapter.read` and dropped verbatim into the target. Different lifecycles → separate path.

---

## Failure-loud posture (carrying forward Stage 1 hardenings C2/C4/E1/E3/L2)

| Failure | Behavior | History entry |
| --- | --- | --- |
| Manifest declares `nav_buttons[]` but every entry is missing required fields | Skip contribution, Notice with sourcename | `{ event: "error", step: "nav_buttons", name, reason: "all entries invalid" }` |
| One entry malformed in an otherwise-valid `nav_buttons[]` | Notice naming the bad entry, skip just that entry, install the rest | `{ event: "warning", step: "nav_buttons", name, reason: "entry <id> invalid" }` |
| Pre-existing `nav-buttons-registry.json` is malformed JSON | Notice + skip this run's contribution; do NOT clobber | `{ event: "error", step: "nav_buttons", name, parse_error }` |
| Two installed items declare the same button `id` | Last-wins in registry (later install order overwrites); Notice on second to surface duplication | `{ event: "warning", step: "nav_buttons", reason: "duplicate id <X>" }` |
| Subscription removes a previously-installed contributor | Pruning step removes its `contributions.<X>` next install | n/a (clean operation, not an error) |
| `template_source` file missing at click time | Renderer Notice naming missing file; no empty `target` written | n/a (renderer-side, not history) |
| Unknown `action.type` at click time | Renderer Notice "unknown action type <X> from <source>"; button does nothing | n/a (renderer-side) |

---

## Stage breakdown

### Stage 1 — installer extensions

> [!abstract] S1 deliverable
> `platform/install.js` gains `applyNavButtons`, `content_path` variable, subscription-aware pruning, and the registry malformed-JSON hardening. No mechanism / blueprint changes yet. Workshop self-install must remain green (no behavioral change — workshop's items still don't declare `nav_buttons[]`).

> [!todo] S1 acceptance
> - [ ] `applyNavButtons` + `validateAndResolve` implemented in `platform/install.js`.
> - [ ] Subscription-aware pruning added to install loop tail.
> - [ ] `content_path` variable wired into substitution.
> - [ ] Workshop's `platform-config.json` gains `variables.content_path: "Docs/Meta/Content"`.
> - [ ] Bootstrap copies (`platformInstall.js`) re-synced in poc-vault, tmp-acc-vault, tmp-test-barebones-vault.
> - [ ] **`workshop_version` bump 0.3.0 → 0.4.0** in `platform/manifest.json`. (Confirm before commit per CLAUDE.md.)
> - [ ] Workshop self-install runs green; zero new file writes (idempotent re-install).
> - [ ] Execution log filed at `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T1.x-...md`.

---

### Stage 2 — nav-buttons mechanism v2.0.0

> [!abstract] S2 deliverable
> Full rewrite of `platform/mechanisms/nav-buttons/space-nav-buttons.js` as a thin renderer over the registry. Drops the kitchen-sink config, drops `detectNoteType`, drops prev/next, drops kanban-card sniffing. Manifest version 1.0.0 → 2.0.0 (BREAKING).

> [!example]- v2.0.0 SpaceNavButtons (sketch)
> ```javascript
> class SpaceNavButtons {
>   async render(dv) {
>     const ICONS = { board: `<svg ...></svg>`, /* ... */ };
>     const fallbackIcon = (label) => `<span class="nav-fallback-icon">${(label[0]||"?").toUpperCase()}</span>`;
>
>     // Read registry
>     let registry;
>     try {
>       const raw = await app.vault.adapter.read("Docs/Meta/nav-buttons-registry.json");
>       registry = JSON.parse(raw);
>     } catch (err) {
>       if (err.message?.includes("ENOENT")) return; // empty install: render nothing
>       dv.el("div", `[nav-buttons] registry parse error: ${err.message}`, { cls: "nav-error" });
>       return;
>     }
>
>     const entries = [];
>     for (const [source, btns] of Object.entries(registry.contributions || {})) {
>       for (const btn of btns) entries.push({ ...btn, _source: source });
>     }
>     entries.sort((a, b) =>
>       (a.order ?? 100) - (b.order ?? 100) ||
>       a._source.localeCompare(b._source) ||
>       a.id.localeCompare(b.id)
>     );
>     if (entries.length === 0) return;
>
>     const container = dv.el("div", "", { cls: "vault-nav" });
>     // ... grid styling carried over from v1.0.0 ...
>     for (const btn of entries) {
>       const el = container.createEl("button");
>       el.innerHTML = (ICONS[btn.icon] || fallbackIcon(btn.label)) + `<span>${btn.label}</span>`;
>       el.onclick = () => dispatchAction(btn);
>     }
>   }
> }
>
> async function dispatchAction(btn) {
>   const action = btn.action || {};
>   if (action.type === "openLink") {
>     app.workspace.openLinkText(action.target, "");
>     return;
>   }
>   if (action.type === "createFromTemplate") {
>     const existing = app.vault.getAbstractFileByPath(action.target);
>     if (existing) { app.workspace.openLinkText(action.target, ""); return; }
>     try {
>       const body = await app.vault.adapter.read(action.template_source);
>       const folder = action.target.split("/").slice(0, -1).join("/");
>       if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
>       await app.vault.create(action.target, body);
>       app.workspace.openLinkText(action.target, "");
>     } catch (err) {
>       new Notice(`nav-buttons: cannot create ${action.target} — ${err.message}`, 8000);
>     }
>     return;
>   }
>   new Notice(`nav-buttons: unknown action.type "${action.type}" from ${btn._source}`, 8000);
> }
> ```

> [!todo] S2 acceptance
> **Workshop side**
> - [ ] `platform/mechanisms/nav-buttons/space-nav-buttons.js` rewritten.
> - [ ] `platform/mechanisms/nav-buttons/manifest.json` bumped 1.0.0 → 2.0.0.
> - [ ] Workshop manifest's `mechanisms[]` updated to nav-buttons@2.0.0.
> - [ ] **Workshop subscription updated**: bumps nav-buttons to 2.0.0; **drops project subscription** (project becomes barebones-only dogfood).
> - [ ] Workshop self-install runs green: nav-buttons@2.0.0 lands; registry is empty (no contributors); SpaceNavButtons renders nothing.
> - [ ] Execution log filed.
>
> **Negative tests (must fail loudly)**
> - [ ] Hand-write malformed JSON into `Docs/Meta/nav-buttons-registry.json`, render → error chip with parse error. Restore.
> - [ ] Hand-add an unknown-`action.type` entry to the registry, click → Notice surfaces. Restore.

---

### Stage 3 — project blueprint v0.2.0

> [!abstract] S3 deliverable
> Project blueprint declares one button (Board) and ships a Dataview-driven kanban template. Manifest version 0.1.0 → 0.2.0 (additive). Both surprises closed in barebones.

> [!example]- platform/blueprints/project/content/kanban-board.md (sketch)
> ```markdown
> ---
> type: project-board
> tags: ["{{vault_identity_tag}}", "board"]
> ---
>
> # To-Do Board
>
> ```dataviewjs
> const projects = dv.pages('"boards/planning"')
>   .where(p => p.type === "project")
>   .groupBy(p => p.status || "active");
>
> for (const grp of projects) {
>   dv.header(2, grp.key);
>   for (const p of grp.rows) {
>     dv.paragraph(`- [[${p.file.path}|${p.file.name}]]`);
>   }
> }
> ```
> ```
>
> The `{{vault_identity_tag}}` placeholder substitutes at install time (lenient body substitution). Dataview reads `boards/planning/<slug>/<slug>.md` notes — the directory the existing `Create New Project` template already produces. Empty initial state until the user creates their first project; updates automatically thereafter.

> [!todo] S3 acceptance
> **Workshop side**
> - [ ] `platform/blueprints/project/content/kanban-board.md` written.
> - [ ] `platform/blueprints/project/manifest.json` bumped 0.1.0 → 0.2.0; gains `nav_buttons[Board]` + new `files[]` entry.
> - [ ] `depends_on.nav-buttons.range` updated `>=1.0.0` → `>=2.0.0`.
> - [ ] Workshop manifest's `blueprints[]` updated to project@0.2.0.
> - [ ] Workshop self-install runs green: nav-buttons@2.0.0 still empty in workshop (project not subscribed there); workshop renders no buttons.
> - [ ] Execution log filed.
>
> **Negative tests**
> - [ ] In workshop, manually add malformed `nav_buttons[]` entry to project's manifest, install → Notice fires, registry not clobbered, history records error. Restore.
> - [ ] In workshop, simulate manifest declaring nav_buttons but `depends_on.nav-buttons` pinned <2.0.0, install → installer skips with version-range Notice. Restore.

---

### Stage 4 — barebones regression sweep

> [!abstract] S4 deliverable
> Re-install in barebones. Verify both surprises are closed and the three deferred Stage 4 smoke tests still pass on the new versions.

> [!todo] S4 acceptance
> **Re-install + verify install state**
> - [ ] Update barebones `platform-subscription.json`: nav-buttons → 2.0.0, project → 0.2.0.
> - [ ] Run `platformInstall` in barebones.
> - [ ] `Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` byte-matches workshop v2.0.0 source.
> - [ ] `Docs/Meta/Content/project/kanban-board.md` exists.
> - [ ] `Docs/Meta/nav-buttons-registry.json` exists with one entry under `contributions.project`.
> - [ ] `platform-installed.json` records nav-buttons@2.0.0 + project@0.2.0.
>
> **Smoke — registry-driven nav (closes Surprise 1)**
> - [ ] Open any note in barebones. SpaceNavButtons renders **exactly one button**: Board.
>
> **Smoke — lazy scaffold (closes Surprise 2)**
> - [ ] Click Board. `boards/To-Do-Board.md` materializes from `Docs/Meta/Content/project/kanban-board.md`. Note opens. Dataview block renders (empty list since no projects yet).
> - [ ] Run `/new-project`. New project lands at `boards/planning/<slug>/<slug>.md`.
> - [ ] Re-open `boards/To-Do-Board.md`. Dataview block now lists the new project under its status group.
>
> **Smoke — deferred Stage 4 tests (validate nothing regressed)**
> - [ ] `tp.user.validate(tp)` on the new project note → PASS.
> - [ ] `tp.user.audit(tp)` produces a vault audit report.
> - [ ] Re-run `platformInstall` → idempotent (no new file writes, registry unchanged).
>
> **Result writeup**
> - [ ] Write `Docs/plans/2026-05-03-registry-driven-nav-buttons-result.md` summarizing what passed, any new landmines surfaced, and disposition.

---

## Versioning summary

| Stage | workshop_version | Item version bumps |
| :----: | :----: | --- |
| S1 | 0.3.0 → **0.4.0** | platform/install.js change; new `content_path` variable |
| S2 | 0.4.0 (no bump) | nav-buttons 1.0.0 → **2.0.0** (BREAKING — class body fully rewritten) |
| S3 | 0.4.0 (no bump) | project 0.1.0 → **0.2.0** (additive — new `nav_buttons[]` + new file) |
| S4 | n/a | n/a (consumer regression sweep, not a workshop release) |

---

## Subscription state per consumer after v0.1.1

| Consumer | nav-buttons | project | Notes |
| --- | :----: | :----: | --- |
| `poc-vault` (workshop) | 2.0.0 | (dropped) | Renderer dogfood only; no project content artifact in workshop. |
| `tmp-test-barebones-vault` | 2.0.0 | 0.2.0 | Regression target. End-to-end S4 happens here. |
| `tmp-acc-vault` | 1.0.0 (held) | 0.1.0 (held) | NOT migrated this cycle. Awaits accuris note-type blueprints (separate plan). |

---

## Bootstrap-copy discipline (CLAUDE.md non-negotiable)

Whenever `platform/install.js` changes (S1), the runtime copies must be re-synced byte-identically:

- [ ] `poc-vault/Docs/Meta/Templater/platformInstall.js`
- [ ] `tmp-acc-vault/Docs/Meta/Templater/platformInstall.js`
- [ ] `tmp-test-barebones-vault/Docs/Meta/Templater/platformInstall.js`

CI doesn't catch this. Each implementer T-task that touches `install.js` must include the re-sync as a sub-step.

---

## Out of scope for this design

- **Migrating tmp-acc-vault to v2.0.0.** Accuris stays on the kitchen-sink class until note-type blueprints exist for it.
- **Daily / todo / meetings / summary / planning blueprints.** Future workstreams. Each will declare its own `nav_buttons[]`.
- **Prev/next-day arrows.** Belongs to a future `temporal-nav` mechanism. Out of scope.
- **Eager scaffolding manifest field.** We chose lazy via `createFromTemplate`. If a future need arises (content not exposed via a button), separate v0.2.x design.
- **Uninstall command.** Self-cleaning registry pruning gets us most of the way. Real uninstall (delete files, drop history) is a separate plan.
- **Caret/tilde/wildcard version range syntax.** Existing v1 limit (`>=X.Y.Z` and exact `X.Y.Z`) carries through unchanged.
- **Mobile install support.** Still desktop-only (landmine #8).

---

## Future-plans appendix — accuris migration sketch

Captured here so future-us isn't surprised; **not part of this design**.

Migrating accuris (or any kitchen-sink-shaped consumer) from `nav-buttons@1.0.0` to `nav-buttons@2.0.0` requires re-homing the seven kitchen-sink buttons across new platform items:

| Button | New owner | New mechanism / blueprint |
| --- | --- | --- |
| Daily | `daily` blueprint | new — declares Daily button (`createFromTemplate` action over `Timestamps/<YYYY>/<MM>/...`) |
| To Do | `todo` blueprint | new — declares ToDo button + ships ToDo template |
| Meetings | `meetings` blueprint | new — declares Meetings hub button + ships hub template |
| Summary | `summary` blueprint | new — declares Summary button (likely `openLink`-only initially) |
| Board | `project` blueprint | already covered by v0.1.1 |
| Projects | `project` blueprint | second declaration (`openLink` to `boards/planning/Planning-Board`) |
| Planning | `planning` blueprint | new — declares Planning button |
| Prev/next-day arrows | `temporal-nav` mechanism | new mechanism — cross-cutting, declares arrow buttons + handles current-date detection |
| Kanban-card back-button | TBD — `kanban` mechanism or extension to `project` | future design call |

Rough sequence:
1. Design + ship the `daily` blueprint (likely the largest of these — most opinionated).
2. Ship the lighter blueprints (`todo`, `meetings`, `summary`, `planning`) in parallel since they're structurally similar to project.
3. Ship `temporal-nav` mechanism for prev/next.
4. Accuris adopts all of them in one subscription update; kitchen-sink retired.

The migration is order-of-magnitude larger than v0.1.1. That's fine — the platform is built for incremental adoption, and accuris already works today on v1.0.0.

---

## Cross-cutting risks & landmines (additions to `Docs/landmines.md`)

> [!warning] New landmines surfaced by this design
> 1. **Registry coupling to subscription.** Pruning `contributions.<X>` when X isn't subscribed is correct *if and only if* every contribution always re-emits each install. If we ever add a "sticky contribution" feature (e.g., user-pinned manual buttons), we'd need a separate non-prunable namespace.
> 2. **Two registry consumers must agree on schema.** Installer writes; renderer reads. Schema drift = silent breakage. `schema_version: 1` is currently informational only — bumping it without renderer support will break renders. Treat schema bumps as breaking changes that bump nav-buttons mechanism's major version.
> 3. **`createFromTemplate` race on concurrent clicks.** Double-clicking Board could attempt two `app.vault.create` calls; second throws "file already exists". Wrap in try/catch + treat as success (file exists → open it).
> 4. **`{{vault_identity_tag}}` in content body needs lenient substitution.** Stage 4's strict-paths/lenient-bodies split must propagate to `content_path`-targeted files. Verify in S1.
> 5. **Workshop dropping project subscription means workshop never dogfoods the project blueprint.** That's intentional but means project regressions only surface in barebones. If barebones drifts (gets stale, gets corrupted), project regressions hide. Mitigation: re-bootstrap barebones from scratch at any sign of drift; keep its setup in `Docs/use.md`.

---

## Next step

Hand off to **de:writing-plans** to produce the task-by-task implementation plan covering S1–S4. Implementation plan filed alongside this design before any code changes.
