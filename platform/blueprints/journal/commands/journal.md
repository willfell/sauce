---
description: Navigate the journal blueprint — open today's day-hub, create a new journal entry, or browse historical days
allowed-tools: Read, Glob, Bash, Edit, Write
---

<!-- @claude-surface:version 0.4.0 -->

# /journal — journal blueprint navigator

Drives the v0.4.x journal blueprint installed at `spice/journal/`. Use this when you want to:

- Open or create today's **day-hub** (per-day surface that lists today's journal entries + offers a "+ New Journal Entry" button)
- Create a new journal entry (overlay dialog prompts for an optional title, file lands in today's folder)
- Open the global hub (one-click "Today" + day cards across history, Days | All search)
- Find a past journal entry by day or by capture time

## Vault layout

```
spice/journal/
├── Journal.md                                       Global hub
└── YYYY/MM-MMMM/YYYY-MM-DD/
    ├── Journal-Day-YYYY-MM-DD.md                    Day-hub
    └── Journal-YYYY-MM-DD-HH-mm-ss.md               Leaf journal entries (time-suffixed to the second)
```

The nav-button's `runTemplaterTemplate` action computes:
- `folder_prefix: {{module_directory}}` (`spice/journal` post-substitution)
- `folder_date_pattern: YYYY/MM-MMMM/YYYY-MM-DD`
- `filename_prefix: Journal-Day-`
- `filename_date_pattern: YYYY-MM-DD`

The renderer in `space-nav-buttons.js` opens the existing file or creates it from the
`Journal Day Hub.md` template via `Templater.create_new_note_from_template`.

## Common operations

| Goal | Path |
|---|---|
| Open / create today's day-hub | Click **Journal** nav-button (top strip of every note) |
| New leaf journal entry | Click **+ New Journal Entry** on the day-hub → overlay prompts for optional title |
| Browse historical days | Open `spice/journal/Journal.md` → click a day card |
| Programmatic entry creation | Invoke `new-journal-entry` skill |
| Find a past entry | `ls spice/journal/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Journal-*.md` |

## Page surfaces

Every surface renders a single `JournalChromeBar` dataviewjs block — the shared ChromeBar
mechanism owns the breadcrumb, Go-to launcher, primary action, and the ⋯ overflow menu.

### Day-hub (`Journal-Day-YYYY-MM-DD.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + [+ New Journal Entry] primary + ⋯ (Hub)
[Journal entry list]       ← JournalDayList, title + "edited X ago", sorted mtime DESC
```

- **+ New Journal Entry** dispatches `EntityCreate.create({ instance: "journal-entry" })` — the overlay dialog prompts for an optional title, then creates the leaf with the title baked into frontmatter.
- **Hub** (in ⋯) navigates to the global hub.

### Leaf journal entry (`Journal-YYYY-MM-DD-HH-mm-ss.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + ⋯ (Back to Day, Hub)
<click-to-rename title banner>
<your journal entry content>
```

Frontmatter:
```yaml
type: journal-entry
created_at: "<ISO>"
day: "<YYYY-MM-DD>"
time: "<HH:mm>"
title: "<from overlay>"
day_link: "[[Journal-Day-<YYYY-MM-DD>]]"
```

Note: `day` and `time` are quoted strings — Obsidian's YAML parser auto-coerces unquoted
`YYYY-MM-DD` to Date objects which breaks string-equality filters.

### Global hub (`spice/journal/Journal.md`)

```
[JournalChromeBar]         ← breadcrumb + Go ▾ + [Today] primary
[Days | All toggle]
[Day cards or search results]
```

## CustomJS classes

| Class | File | Surface | Role |
|---|---|---|---|
| `JournalChromeBar` | `helpers/journal-chrome-bar.js` | all three | ChromeBar adapter: detect context from `page.type`, primary + overflow actions, Go-to destinations, leaf title banner |
| `JournalDayList` | `helpers/journal-day-list.js` | day-hub | Lists day's journal entries; title (or preview fallback) + edited-ago; sort by mtime DESC |
| `JournalHubCards` | `helpers/journal-hub-cards.js` | global hub | Days \| All toggle; Days = one card per day; All = flat searchable list via doc-search |

Helpers implement a `_coerceDay(raw)` shim to normalize `string | Date | Luxon` → `YYYY-MM-DD`,
empty `dv.container` at the start of `render()`, and stamp `__journalRenderGen` to bail out of
stale renders.

## Migration

Pre-v0.4.0 vaults have flat `spice/journal/YYYY/MM-MMMM/Journal-YYYY-MM-DD.md` notes
(`type: journal`). On next install, `applyJournalMultiEntryMigration` (in `platform/install.js`,
gated on `manifest.name === "journal"`) converts each into the day-folder shape: creates
`Journal-Day-YYYY-MM-DD.md` in a new `YYYY-MM-DD/` subfolder and moves the old note's body into
`Journal-YYYY-MM-DD-00-00-00.md` as that day's first entry. Backed up under
`.sauce-backup/journal-multi-entry/<timestamp>/` before any write.

## Rule fragments

Two fragments (disjoint by `path_glob`):

- **journal-entry** (`spice/journal/**/Journal-2*.md`): `type: journal-entry`, filename
  `^Journal-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}(-\d{2})?\.md$`.
- **journal-day-hub** (`spice/journal/**/Journal-Day-*.md`): `type: journal-day`, filename
  `^Journal-Day-\d{4}-\d{2}-\d{2}\.md$`.

## Refresh or audit

```bash
sauce audit                   # validates rule_fragments
sauce update                  # re-runs installer with current subscription pins
```

## See also

- `.claude/skills/journal/new-journal-entry/SKILL.md` — programmatic new-journal-entry skill
- Landmine #11 (module-directory invariant) — journal owns ONLY `spice/journal/`
