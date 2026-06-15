---
description: Navigate the scratch blueprint — open today's day-hub, create a new scratch, or browse historical days
allowed-tools: Read, Glob, Bash, Edit, Write
---

<!-- @claude-surface:version 0.2.6 -->

# /scratch — scratch blueprint navigator

Drives the v0.2.x scratch blueprint installed at `spice/scratch/`. Use this when you want to:

- Open or create today's **day-hub** (per-day surface that lists today's scratches + offers a "+ New Scratch" button)
- Create a new scratch (overlay dialog prompts for a title, file lands in today's folder)
- Open the global hub (one-click "Today" + day cards across history)
- Find a past scratch by day or by capture time

## Vault layout

```
spice/scratch/
├── Scratch.md                                       Global hub
└── YYYY/MM-MMMM/YYYY-MM-DD/
    ├── Scratch-Day-YYYY-MM-DD.md                    Day-hub (collision-free with daily blueprint)
    └── Scratch-YYYY-MM-DD-HH-mm.md                  Leaf scratches (time-suffixed)
```

The nav-button's `runTemplaterTemplate` action computes:
- `folder_prefix: spice/scratch` (`spice/scratch` post-substitution)
- `folder_date_pattern: YYYY/MM-MMMM/YYYY-MM-DD`
- `filename_prefix: Scratch-Day-`
- `filename_date_pattern: YYYY-MM-DD`

The renderer at `space-nav-buttons.js:348-352` opens the existing file or creates it from `Scratch Day Hub.md` template via `Templater.create_new_note_from_template`.

## Common operations

| Goal | Path |
|---|---|
| Open / create today's day-hub | Click **Scratch** nav-button (top strip of every note) |
| New leaf scratch | Click **+ New Scratch** on the day-hub → overlay prompts for title |
| Browse historical days | Open `spice/scratch/Scratch.md` → click a day card |
| Programmatic scratch creation | Invoke `new-scratch` skill |
| Find a past scratch | `ls spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-*.md` |

## Page surfaces

### Day-hub (`Scratch-Day-YYYY-MM-DD.md`)

```
[SpaceNavButtons row]
---
[+ New Scratch] [Hub]      ← ScratchDayActions, centered flex row, equal width
---
[Scratch list]             ← ScratchDayList, title + "edited X ago", sorted mtime DESC
```

- **+ New Scratch** opens an overlay dialog ("What's this scratch for?"). On submit, the leaf scratch is created via `app.vault.create` directly (bypasses Templater) with the title baked into frontmatter.
- **Hub** navigates to the global hub.

### Leaf scratch (`Scratch-YYYY-MM-DD-HH-mm.md`)

```
[SpaceNavButtons row]
---
[Back to Day] [Hub]        ← ScratchLeafActions
---
<your scratch content>
```

Frontmatter:
```yaml
created: "<ISO>"
type: scratch
day: "<YYYY-MM-DD>"
time: "<HH:mm>"
title: "<from overlay>"
day_link: "[[Scratch-Day-<YYYY-MM-DD>]]"
```

Note: `day` and `time` are quoted strings — Obsidian's YAML parser auto-coerces unquoted `YYYY-MM-DD` to Date objects which breaks string-equality filters.

### Global hub (`spice/scratch/Scratch.md`)

```
[SpaceNavButtons row]
---
[Today]                    ← ScratchHubActions, opens-or-creates today's day-hub
---
[Day cards]                ← ScratchHubCards, one card per day with scratches, latest first
```

## CustomJS classes

| Class | File | Surface | Role |
|---|---|---|---|
| `ScratchDayActions` | `helpers/scratch-day-actions.js` | day-hub | + New Scratch + Hub; opens title-prompt overlay dialog |
| `ScratchLeafActions` | `helpers/scratch-leaf-actions.js` | leaf scratch | Back to Day + Hub; navigates only |
| `ScratchHubActions` | `helpers/scratch-hub-actions.js` | global hub | Today button; opens-or-creates today's day-hub |
| `ScratchDayList` | `helpers/scratch-day-list.js` | day-hub | Lists day's scratches; title (or preview fallback) + edited-ago; sort by mtime DESC |
| `ScratchHubCards` | `helpers/scratch-hub-cards.js` | global hub | One card per day with scratches; uses BeaconCards row layout |
| `ScratchNewButton` | `helpers/scratch-new-button.js` | (legacy) | Pre-v0.2.2; retained for back-compat; current templates use ScratchDayActions |

All helpers implement a `_coerceDay(raw)` shim to normalize `string | Date | Luxon` → `YYYY-MM-DD`. Action helpers also poll `dv.current().day` up to 2s during the Templater-processing race window (`_pollForDay`). All helpers empty `dv.container` at the start of `render()` and stamp `__scratchRenderGen` to bail out of stale renders.

## Rule fragments

Two fragments (disjoint by `path_glob`):

- **scratch** (`spice/scratch/**/Scratch-2*.md`): `type: scratch`, filename `^Scratch-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$`. The `2*` prefix disjoins from day-hub (which starts `Scratch-Day-`).
- **scratch-day-hub** (`spice/scratch/**/Scratch-Day-*.md`): `type: scratch-day`, filename `^Scratch-Day-\d{4}-\d{2}-\d{2}\.md$`.

## Refresh or audit

```bash
sauce audit                   # validates rule_fragments
sauce wizard                  # interactive subscription editor; pick scratch + run install
sauce update                  # re-runs installer with current subscription pins
```

## See also

- `.claude/skills/scratch/new-scratch/SKILL.md` — programmatic new-scratch skill
- `Docs/scratch-architecture.md` — workshop-side architecture reference + lessons learned from v0.40.x patch series
- Landmine #11 (module-directory invariant) — scratch owns ONLY `spice/scratch/`
