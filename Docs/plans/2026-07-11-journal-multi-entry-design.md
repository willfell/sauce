# Journal multi-entry design

## Context

The `journal` blueprint (`platform/blueprints/journal/`) is currently a single-note-per-day
blueprint: one nav button (`journal-today`) directly creates/opens `Journal-YYYY-MM-DD.md`
flat under `spice/journal/YYYY/MM-MMMM/`. No hub, no multiplicity, no search. It's subscribed
in `ero-sauce` and `headspace-sauce` (not `accuris-sauce`, not the workshop dogfood), so both
vaults have real `Journal-YYYY-MM-DD.md` notes on disk today.

The `sticky-notes` blueprint (`platform/blueprints/sticky-notes/`, v0.10.0) already solves
"multiple timestamped entries per day with a browsable hub" — global hub with **Days | All**
tabs, per-day day-hub listing that day's entries as cards, timestamped leaf notes
(`Sticky-YYYY-MM-DD-HH-mm-ss.md`, per-second suffix to avoid same-minute collisions), an
optional title prompt at entry creation (click-to-rename banner on the leaf), and an install
migration (`StickyDayMigrate` + `StickyDayMigrateInit`) that converts pre-v0.9.0 flat notes
into the new shape.

**Goal:** give Journal the same multi-entry capability — click the Journal nav button, land on
a day hub, create additional entries for the same day, browse other days, search across all
entries — using sticky-notes' proven mechanics as the template.

## Decisions (confirmed with user)

1. **Journal = the currently-live blueprint** at `spice/journal/`, not a new blueprint and not
   a revival of anything else.
2. **Optional title prompt** at entry creation (mirrors sticky-notes' `title` prompt), not bare
   timestamp-only capture.
3. **Auto-migrate existing entries on install.** Both `ero-sauce` and `headspace-sauce` have
   real flat `Journal-YYYY-MM-DD.md` notes; a `JournalDayMigrate` heal (mirroring
   `StickyDayMigrate`) converts each into the new day-folder shape, preserving body content as
   that day's first timestamped entry.
4. **Mirror the pattern into journal's own helpers** rather than extracting a shared "day-log"
   mechanism. Every other blueprint (daily / meetings / sticky-notes) owns its list/hub-card
   logic independently; sticky-notes is the only other consumer of this shape, and the
   workshop's precedent is to extract a shared mechanism only once a 3rd consumer needs it
   (YAGNI). Duplicating ~5 small files is cheaper and lower-risk than refactoring sticky-notes'
   working code for a second consumer.

## Shape

Three tiers, structurally identical to sticky-notes:

- **Global hub** — `spice/journal/Journal.md` — **Days | All** tabs. Days = one card per day
  with an entry count, linking to that day's day-hub. All = every entry across all days, flat,
  filterable via `doc-search`.
- **Day hub** — `spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/Journal-Day-YYYY-MM-DD.md` — cards for
  that day's entries (title if set, else time), `+ New Journal Entry` button.
- **Leaf entry** — `spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/Journal-YYYY-MM-DD-HH-mm-ss.md` —
  `day` frontmatter linking back to the day-hub; optional `title` frontmatter (prompted at
  creation, click-to-rename banner on the note itself, same UX as sticky-notes' leaf).

Nav button (`journal-today`) changes from directly creating the flat daily note to
create-if-missing + open the **day hub** (mirrors sticky-notes' `sticky-day-hub` nav button
action exactly — `folder_date_pattern: "YYYY/MM-MMMM/YYYY-MM-DD"`, template
`Journal Day Hub.md`, filename `Journal-Day-YYYY-MM-DD`).

## Types

Replaces the single `journal` type with three: `journal-entry`, `journal-day`, `journal-hub`.

## Files (new module directory contents, file-for-file mirror of sticky-notes)

| Sticky-notes source | Journal equivalent | Role |
|---|---|---|
| `helpers/sticky-hub-cards.js` (`StickyHubCards`) | `helpers/journal-hub-cards.js` (`JournalHubCards`) | Global hub Days/All tab rendering |
| `helpers/sticky-day-list.js` (`StickyDayList`) | `helpers/journal-day-list.js` (`JournalDayList`) | Day-hub entry-card list |
| `helpers/sticky-day-migrate.js` + `-init.js` (`StickyDayMigrate(Init)`) | `helpers/journal-day-migrate.js` + `-init.js` (`JournalDayMigrate(Init)`) | Install-time flat→day-folder migration |
| `helpers/sticky-chrome-bar.js` (`StickyChromeBar`) | `helpers/journal-chrome-bar.js` (`JournalChromeBar`, already exists as a stub) | Chrome bar adapter — gains a real config (currently `primary: null, leaf: true` on every surface) |
| `templates/Sticky Note.md` | `templates/Journal Entry.md` | Leaf entry template |
| `templates/Sticky Day Hub.md` | `templates/Journal Day Hub.md` | Day-hub template |
| `templates/Sticky Hub.md` | `templates/Journal Hub.md` | Global-hub template (materializes to `{{module_directory}}/Journal.md`) |
| `commands/sticky-notes.md` | `commands/journal.md` | `/journal` slash command (replaces existing router row pointing at `spice/journal`, currently undocumented as a command) |
| `skills/new-sticky-note/SKILL.md` | `skills/new-journal-entry/SKILL.md` | Claude-facing skill for creating an entry |

`templates/Today Journal.md` (the current single-note template) is retired — replaced by
`Journal Entry.md` (leaf) + `Journal Day Hub.md` (hub-creating template consumed by the nav
button, matching sticky-notes' `templater_folder_templates` wiring).

## Chrome bar

`JournalChromeBar`'s `_config()` currently returns `primary: null, overflow: [], leaf: true`
unconditionally — the "one flat note, no chrome" state documented in its own header comment.
It gets rebuilt to detect all three new types:

- `journal-entry` (leaf): primary = none (chip nav only), destination = its day-hub +
  the global hub.
- `journal-day` (hub): primary = `+ New Journal Entry`, destination = the global hub.
- `journal-hub` (hub): primary = none, leaf = true.

Same `ChromeBar.makeAdapter` factory sticky-notes already uses — no new mechanism needed.

## Breadcrumb

Mirrors sticky-notes' `breadcrumb.types` block exactly, substituting `sticky-note`→
`journal-entry`, `sticky-day`→`journal-day`, and `"Sticky Notes"`→`"Journal"` literal labels.
`journal-hub` needs no breadcrumb entry (it's the root — same as sticky-notes' `Sticky.md`,
which also has none).

## Dependencies

`journal`'s manifest currently depends on: `nav-buttons >=2.4.0`, `customjs-guard >=1.0.0`,
`convenience >=0.1.0`, `chrome-bar >=0.3.0`. It gains the rest of sticky-notes' dependency set:
`cards >=0.2.4`, `accent-button >=0.1.0`, `entity-create >=0.4.0`, `platform-claude >=0.1.1`,
`breadcrumb >=0.1.0`, `render-safe >=0.1.0`, `doc-search >=0.1.0`. All are already-shipped
mechanisms already used by sticky-notes at those same version floors — no new mechanism work.

## `new_entity_buttons`

New `journal-entry` entity-create button, mirroring sticky-notes' `sticky-note` entity exactly:
optional `title` prompt, destination folder/filename pattern keyed off the day-hub's `day`
frontmatter (`current_file.frontmatter.day|today`), `frontmatter_template` sets
`type: journal-entry`, `created_at`, `day`, `title`.

## `rule_fragments`

Three fragments (`journal-entry`, `journal-day`, `journal-hub`) mirroring sticky-notes' two
(`sticky-note`, `sticky-day`) plus one for the global hub — same `_canonical-vocab` extension,
same `required_frontmatter` (`type` equals + `day` required string for entry/day), naming
patterns adjusted for the `Journal-` / `Journal-Day-` prefixes.

## Migration (`JournalDayMigrate`)

Contract mirrors `StickyDayMigrate` exactly: idempotent, backup-before-write, never-throw. For
every `spice/journal/**/Journal-YYYY-MM-DD.md` (old flat shape, `type: journal`), it:

1. Creates the day folder `spice/journal/YYYY/MM-MMMM/YYYY-MM-DD/` if missing.
2. Creates the day hub `Journal-Day-YYYY-MM-DD.md` in that folder if missing.
3. Moves the old flat note's **body** into a new leaf entry
   `Journal-YYYY-MM-DD-00-00-00.md` inside the day folder (fixed `00-00-00` time suffix since
   the original note has no captured time — avoids fabricating a false timestamp), preserving
   `created_at` from the original frontmatter and setting `day` + `type: journal-entry`.
4. Deletes the old flat note only after the new leaf write succeeds.

Runs via `JournalDayMigrateInit` (customjs startup script), same registration vector as
`StickyDayMigrateInit`, on next install against `ero-sauce` and `headspace-sauce`.

## Testing

New `platform/test/run-journal-multi-entry.js` (or extend the existing
`run-journal-chrome-bar.js` — decide at plan time) mirroring the shape of sticky-notes' test
coverage: day-list card rendering, hub-cards Days/All tabs, migrate idempotency +
backup-on-edit + body-preservation, chrome-bar adapter per-type dispatch. Existing
`run-journal-chrome-bar.js` assertions against the current stub config will need updating for
the new three-type dispatch.

## Out of scope

- No changes to `sticky-notes` itself.
- No new shared mechanism.
- No changes to `daily` (the separate, currently-dominant daily-note blueprint) — this is
  scoped entirely to the dormant-turned-active `journal` blueprint.
