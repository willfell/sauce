# Scratch Blueprint — Design (v0.33.0)

> **Date:** 2026-05-12 · **Status:** design-locked · **Author:** Will + Claude (brainstorming session) · **Target cycle:** v0.33.0 (TBD — see Open Questions)

## Goal

Ship a low-friction quick-capture blueprint so the user can hit a nav-row button and start typing into a date-stamped scratch note in **one click**, without leaving Obsidian for BBEdit / Notepad / a stray text file. Past scratches are browsable through a per-day index and a global hub.

## Decisions (locked during 2026-05-12 brainstorm)

| # | Decision | Value |
|---|---|---|
| 1 | Filename pattern | `Scratch-YYYY-MM-DD-HH-mm.md` (time suffix; collision-free, chronological) |
| 2 | Nav-button behavior | Create + open a new scratch immediately (pure "oh shit" speed) |
| 3 | "Back" target on scratch | That day's day-index page |
| 4 | Folder layout | Per-day sub-folder (`spice/scratch/YYYY/MM-MMMM/YYYY-MM-DD/`) |
| 5 | Scratch body | Frontmatter + nav row only (truly bare; cursor lands ready to type) |
| 6 | Approach | A — Templater-driven, mirrors journal blueprint (lowest novelty) |
| 7 | Nav-button label | `Scratch` (matches Daily/Journal single-word convention) |

## On-disk Layout

```
spice/scratch/
├── Scratch.md                                  ← global hub (Dataview day-cards)
└── 2026/05-May/
    └── 2026-05-12/                             ← per-day sub-folder
        ├── Tuesday-2026-05-12.md               ← day index (Dataview + +New)
        ├── Scratch-2026-05-12-09-15.md
        └── Scratch-2026-05-12-14-37.md
```

## Flow

1. **Click "Scratch" nav-button** (visible in the global nav row on every page).
2. **`runTemplaterTemplate` fires** with `folder_prefix="{{module_directory}}"`, `folder_date_pattern="YYYY/MM-MMMM/YYYY-MM-DD"`, `filename_prefix="Scratch-"`, `filename_date_pattern="YYYY-MM-DD-HH-mm"`.
3. **Scratch template's `<%* %>` block** runs: ensures the day-index file `<DayName>-YYYY-MM-DD.md` exists in the target folder (idempotent — wraps `tp.file.create_new()` in try/catch for double-click race).
4. **Scratch file created**, frontmatter populated (`created`, `type: scratch`, `day`, `time`), nav-button mechanism's post-processor renders the row at the top automatically (no literal `BUTTON[...]` lines in the template body).
5. **Cursor lands below frontmatter** on a blank line, ready to type.
6. **Scratch nav row** has `[Hub]` (→ `Scratch.md`), `[← Day]` (→ `Tuesday-2026-05-12.md`), `[+ New]` (re-fires Templater action).

## Manifest Shape

```json
{
  "name": "scratch",
  "version": "0.1.0",
  "kind": "blueprint",
  "module_directory": "scratch",
  "description": "Low-friction quick-capture scratch notes. Per-day sub-folders under spice/scratch/YYYY/MM-MMMM/YYYY-MM-DD/. Filename Scratch-YYYY-MM-DD-HH-mm.md. Day-index + global hub via Dataview cards.",
  "depends_on": [
    { "name": "nav-buttons",    "range": ">=2.6.0" },
    { "name": "customjs-guard", "range": ">=1.0.0" },
    { "name": "cards",          "range": ">=0.2.4" }
  ],
  "customjs_classes": ["ScratchHubCards", "ScratchDayList"],
  "files": [
    { "source": "templates/Scratch.md",         "dest": "{{templates_path}}/Scratch.md" },
    { "source": "templates/Scratch Day.md",     "dest": "{{templates_path}}/Scratch Day.md" },
    { "source": "templates/Scratch Hub.md",     "dest": "{{module_directory}}/Scratch.md" },
    { "source": "helpers/scratch-hub-cards.js", "dest": "{{scripts_path}}/scratch/scratch-hub-cards.js" },
    { "source": "helpers/scratch-day-list.js",  "dest": "{{scripts_path}}/scratch/scratch-day-list.js" }
  ],
  "nav_buttons": [
    {
      "id": "scratch-new",
      "label": "Scratch",
      "icon": "edit-3",
      "order": 130,
      "action": {
        "type": "runTemplaterTemplate",
        "template_source": "Scratch.md",
        "folder_prefix": "{{module_directory}}",
        "folder_date_pattern": "YYYY/MM-MMMM/YYYY-MM-DD",
        "filename_prefix": "Scratch-",
        "filename_date_pattern": "YYYY-MM-DD-HH-mm",
        "filename_suffix": ""
      }
    }
  ],
  "templater_folder_templates": [
    { "folder": "{{module_directory}}", "template": "{{templates_path}}/Scratch.md" }
  ],
  "rule_fragments": [
    {
      "target": "scratch",
      "fragment": {
        "scope": { "path_glob": "spice/scratch/**/Scratch-*.md" },
        "required_frontmatter": {
          "created": { "required": true, "type": "string" },
          "type":    { "required": true, "equals": "scratch" },
          "day":     { "required": true, "type": "string" }
        },
        "naming_pattern": "^Scratch-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}\\.md$"
      }
    }
  ]
}
```

## Template Bodies

### `templates/Scratch.md` (the scratch note)

```markdown
---
created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
type: scratch
day: <% tp.date.now("YYYY-MM-DD") %>
time: <% tp.date.now("HH:mm") %>
---

<%*
const dayName = tp.date.now("dddd");
const dayDate = tp.date.now("YYYY-MM-DD");
const monthFolder = tp.date.now("YYYY/MM-MMMM");
const dayFolder = `spice/scratch/${monthFolder}/${dayDate}`;
const dayIndexPath = `${dayFolder}/${dayName}-${dayDate}.md`;
if (!app.vault.getAbstractFileByPath(dayIndexPath)) {
  try {
    const dayTpl = tp.file.find_tfile("Scratch Day.md");
    await tp.file.create_new(dayTpl, `${dayName}-${dayDate}`, false, app.vault.getAbstractFileByPath(dayFolder));
  } catch (e) { /* concurrent create — fine */ }
}
%>

```

> The nav-button mechanism's post-processor renders the `[Hub] [← Day] [+ New]` row at the top based on `type: scratch`. No literal `BUTTON[...]` lines in the body.

### `templates/Scratch Day.md` (per-day index)

```markdown
---
created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
type: scratch-day
day: <% tp.date.now("YYYY-MM-DD") %>
---

# <% tp.date.now("dddd, MMMM Do YYYY") %>

​```dataviewjs
await customJS.ScratchDayList.render(dv, { day: dv.current().day });
​```
```

### `templates/Scratch Hub.md` (installed once at `spice/scratch/Scratch.md`)

```markdown
---
type: scratch-hub
---

# Scratch

Quick-capture pad. Click a day below to see its scratches, or hit the **Scratch** nav-button to start a new one right now.

​```dataviewjs
await customJS.ScratchHubCards.render(dv);
​```
```

## Helper JS

### `helpers/scratch-hub-cards.js` — `ScratchHubCards`

- Queries `dv.pages('"spice/scratch"').where(p => p.type === "scratch")`.
- Groups by `p.day`, picks day-name via moment.
- Sorts days descending.
- Builds items `{ name: "Tuesday May 12", link: <link to day-index>, count, latest_time }`.
- Dispatches to `customJS.BeaconCards.render(dv, { items, fields: [...] })`.
- **Embed dedup** via `dv.container.closest('.markdown-embed')` early-return.
- **customjs-guard** wrapper.

### `helpers/scratch-day-list.js` — `ScratchDayList`

- Accepts `{ day }` from caller.
- Queries `dv.pages('"spice/scratch"').where(p => p.type === "scratch" && p.day === day)`.
- Sorts by `time` ascending.
- Renders tight time-prefixed list: `09:15 · [[Scratch-2026-05-12-09-15|first body line preview]]`.
- Preview = first non-empty body line, ~60 chars.
- Renders a `+ New Scratch` button at the top by re-using the `scratch-new` nav-button id (so the same Templater action fires).
- **Embed dedup + customjs-guard** wrappers.

## Versioning & Harness

- `scratch@0.1.0` registered in `platform/manifest.json` catalogue (lockstep with the per-blueprint manifest — gotcha 11).
- **Workshop_version bump:** TBD (`0.31.0 → 0.33.0` if v0.31.0 closes first + v0.32.0 ships sauce-claude-cohesion).
- Subscriptions: add `scratch` to workshop's `Docs/Meta/platform-subscription.json` + the 4 consumer subscriptions (barebones, ero-sauce, headspace-sauce, accuris-sauce) on rollout stage.
- **Harness deltas:**
  - `run-helper-cases.js` — +6 sub-asserts (`SHC-*`): templates land, helpers land, hub lands at `spice/scratch/Scratch.md`.
  - `run-renderer.js` — +1 case: `scratch-new` nav-button renders with the right Templater action shape after substitution.
  - `run-audit.js` — +6 sub-asserts: rule_fragment positive (passing scratch) + negatives (missing `day`, wrong naming pattern).
  - `run-install.js` / `run-bootstrap.js` / `run-cli.js` / `run-install-sh.js` / `run-migrate.js` — no deltas expected.

## Landmines applied

- **#11 module-directory invariant** — single `spice/scratch/` namespace; day-index files + sub-folders all live under it.
- **#12 .obsidian/ allowlist** — only adds `templater-obsidian/data.json` registration via `templater_folder_templates`; no new allowlist paths needed.
- **customjs-guard discipline** — both helpers wrap class definitions in the standard guard.
- **#16 in-cycle re-process bump** — applies if CFs land during cycle.

## Open Questions

1. **Three-level `folder_date_pattern` (`YYYY/MM-MMMM/YYYY-MM-DD`).** Journal uses two levels; renderer's substitution + Templater's `tp.file.move()` chain must handle three. **Lean:** likely fine — moment.format treats slashes as literal — but verify in writing-plans S0 smoke.
2. **Day-index create_new race on rapid double-click.** Wrap in try/catch; verify Templater swallows "already exists" cleanly.
3. **Hub overwrite policy on re-install.** If `spice/scratch/Scratch.md` is user-edited, the installer must NOT clobber it. Need to verify the installer's behavior for blueprint-shipped landing files (project blueprint's `Projects.md` precedent likely applies — confirm in writing-plans).
4. **Hotkey for Cmd+; quick-capture.** Defer to v0.33.x patch — add `convenience` hotkeys[] entry binding Cmd+; to the same nav-button action via a registered command. Out of scope for v0.33.0.
5. **Cycle-order placement.** v0.31.0 (cowork engagement-model) is mid-flight; v0.32.0 is pre-claimed for sauce-claude-cohesion. Default placement: v0.33.0. Confirm before writing the implementation plan.
6. **Day-index preview text.** First non-empty body line, ~60 chars. Confirmed in design session.

## Next step

`/de:writing-plans` against this design doc to produce a staged implementation plan (`Docs/plans/2026-05-12-v0.33.0-scratch-blueprint-plan.md`), with S0 smoke, S1 manifest+templates, S2 helpers+hub, S3 harness deltas, S4 workshop self-install + dogfood, S5 4-vault rollout.
