---
description: Navigate the sticky-notes blueprint — open today's day-hub, create a new sticky note, or browse historical days
allowed-tools: Read, Glob, Bash, Edit, Write
---

<!-- @claude-surface:version 0.9.0 -->

# /sticky-notes — sticky-notes blueprint navigator

Drives the v0.9.x sticky-notes blueprint installed at `spice/sticky-notes/`. Use this when you want to:

- Open or create today's **day-hub** (per-day surface that lists today's sticky notes + offers a "+ New Sticky Note" button)
- Create a new sticky note (overlay dialog prompts for a title, file lands in today's folder)
- Open the global hub (one-click "Today" + day cards across history)
- Find a past sticky note by day or by capture time

## Vault layout

```
spice/sticky-notes/
├── Sticky.md                                        Global hub
└── YYYY/MM-MMMM/YYYY-MM-DD/
    ├── Sticky-Day-YYYY-MM-DD.md                     Day-hub (collision-free with daily blueprint)
    └── Sticky-YYYY-MM-DD-HH-mm-ss.md                Leaf sticky notes (time-suffixed to the second; pre-rename files keep the two-token HH-mm form)
```

The nav-button's `runTemplaterTemplate` action computes:
- `folder_prefix: spice/sticky-notes` (`spice/sticky-notes` post-substitution)
- `folder_date_pattern: YYYY/MM-MMMM/YYYY-MM-DD`
- `filename_prefix: Sticky-Day-`
- `filename_date_pattern: YYYY-MM-DD`

The renderer in `space-nav-buttons.js` opens the existing file or creates it from the `Sticky Day Hub.md` template via `Templater.create_new_note_from_template`.

## Common operations

| Goal | Path |
|---|---|
| Open / create today's day-hub | Click **Sticky Notes** nav-button (top strip of every note) |
| New leaf sticky note | Click **+ New Sticky Note** on the day-hub → overlay prompts for title |
| Browse historical days | Open `spice/sticky-notes/Sticky.md` → click a day card |
| Programmatic sticky-note creation | Invoke `new-sticky-note` skill |
| Find a past sticky note | `ls spice/sticky-notes/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Sticky-*.md` |

## Page surfaces

Every surface renders a single `StickyChromeBar` dataviewjs block — the shared ChromeBar mechanism owns the breadcrumb, Go-to launcher, primary action, and the ⋯ overflow menu. The three legacy per-surface action helpers (day / leaf / hub action classes) were dropped in the v0.9.0 rename.

### Day-hub (`Sticky-Day-YYYY-MM-DD.md`)

```
[StickyChromeBar]          ← breadcrumb + Go ▾ + [+ New Sticky Note] primary + ⋯ (Hub)
[Sticky-note list]         ← StickyDayList, title + "edited X ago", sorted mtime DESC
```

- **+ New Sticky Note** dispatches `EntityCreate.create({ instance: "sticky-note" })` — the overlay dialog prompts for an optional title, then creates the leaf with the title baked into frontmatter.
- **Hub** (in ⋯) navigates to the global hub.

### Leaf sticky note (`Sticky-YYYY-MM-DD-HH-mm-ss.md`)

```
[StickyChromeBar]          ← breadcrumb + Go ▾ + ⋯ (Back to Day, Hub)
<your sticky-note content>
```

Frontmatter:
```yaml
type: sticky-note
created_at: "<ISO>"
day: "<YYYY-MM-DD>"
time: "<HH:mm>"
title: "<from overlay>"
day_link: "[[Sticky-Day-<YYYY-MM-DD>]]"
```

Note: `day` and `time` are quoted strings — Obsidian's YAML parser auto-coerces unquoted `YYYY-MM-DD` to Date objects which breaks string-equality filters.

### Global hub (`spice/sticky-notes/Sticky.md`)

```
[StickyChromeBar]          ← breadcrumb + Go ▾ + [Today] primary
[Day cards]                ← StickyHubCards, one card per day with sticky notes, latest first
```

## CustomJS classes

| Class | File | Surface | Role |
|---|---|---|---|
| `StickyChromeBar` | `helpers/sticky-chrome-bar.js` | all three | ChromeBar adapter: detect context from `page.type`, primary + overflow actions, Go-to destinations |
| `StickyDayList` | `helpers/sticky-day-list.js` | day-hub | Lists day's sticky notes; title (or preview fallback) + edited-ago; sort by mtime DESC |
| `StickyHubCards` | `helpers/sticky-hub-cards.js` | global hub | One card per day with sticky notes; uses BeaconCards row layout |
| `StickyDayMigrate` | `helpers/sticky-day-migrate.js` | (headless) | Rewrites unquoted/missing `day:` frontmatter from the file path |
| `StickyDayMigrateInit` | `helpers/sticky-day-migrate-init.js` | (startup) | Once-per-session migrate sweep + `sticky-day-migrate:resync-now` command |

Helpers implement a `_coerceDay(raw)` shim to normalize `string | Date | Luxon` → `YYYY-MM-DD`, empty `dv.container` at the start of `render()`, and stamp `__stickyRenderGen` to bail out of stale renders.

## Rule fragments

Two fragments (disjoint by `path_glob`):

- **sticky-note** (`spice/sticky-notes/**/Sticky-2*.md`): `type: sticky-note`, filename `^Sticky-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$` (seconds token optional — migrated pre-rename files keep the two-token HH-mm form). The `2*` prefix disjoins from day-hub (which starts `Sticky-Day-`).
- **sticky-day-hub** (`spice/sticky-notes/**/Sticky-Day-*.md`): `type: sticky-day`, filename `^Sticky-Day-\d{4}-\d{2}-\d{2}\.md$`.

## Refresh or audit

```bash
sauce audit                   # validates rule_fragments
sauce wizard                  # interactive subscription editor; pick sticky-notes + run install
sauce update                  # re-runs installer with current subscription pins
```

## See also

- `.claude/skills/sticky-notes/new-sticky-note/SKILL.md` — programmatic new-sticky-note skill
- `Docs/sticky-notes-architecture.md` — workshop-side architecture reference + lessons learned from the v0.40.x patch series
- Landmine #11 (module-directory invariant) — sticky-notes owns ONLY `spice/sticky-notes/`
