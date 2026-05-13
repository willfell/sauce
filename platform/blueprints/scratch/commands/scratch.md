---
description: Navigate the scratch blueprint — create a new scratch note, open today's day-index, or browse the scratch hub
allowed-tools: Read, Glob, Bash, Edit, Write
---

<!-- @claude-surface:version 0.1.0 -->

# /scratch — scratch blueprint navigator

Drives the v0.1.0 scratch blueprint installed at `spice/scratch/`. Use this when you want to:

- Create a new quick-capture scratch note for today (one click; no friction)
- Open today's day-index page (lists all of today's scratches in time order)
- Open the global scratch hub (cards per day, latest first)
- Find a past scratch by day or by the time it was captured

## Vault layout

```
spice/scratch/
├── Scratch.md                                  Global hub (cards per day)
└── YYYY/MM-MMMM/YYYY-MM-DD/
    ├── DayName-YYYY-MM-DD.md                   Per-day index (lists that day's scratches)
    └── Scratch-YYYY-MM-DD-HH-mm.md             Individual scratches (time-suffixed)
```

The folder route + filename pattern are wired by the scratch blueprint's `nav_buttons[]` entry (`runTemplaterTemplate` action; `folder_date_pattern: YYYY/MM-MMMM/YYYY-MM-DD`; `filename_prefix: Scratch-`; `filename_date_pattern: YYYY-MM-DD-HH-mm`). Manual creation under `spice/scratch/` also auto-applies the `Scratch.md` template via `templater_folder_templates[]`.

## Common operations

| Goal | Path |
|---|---|
| New scratch right now | Invoke `new-scratch` skill OR click the **Scratch** nav-button in any note |
| Today's day-index | Open `spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/<DayName>-<YYYY-MM-DD>.md` |
| Browse all days | Open `spice/scratch/Scratch.md` |
| Find a past scratch | Glob `spice/scratch/**/Scratch-<date-prefix>*.md` |

Glob example to enumerate all scratches across a month:

```bash
ls spice/scratch/2026/05-May/*/Scratch-*.md
```

## Create a new scratch

The user-facing path is the **Scratch** nav-button rendered by `SpaceNavButtons` in the top strip of every note (contributed via the scratch blueprint's `nav_buttons[]` entry, order 130). The action fires the `Scratch.md` Templater template auto-routed to today's `spice/scratch/<YYYY>/<MM-MMMM>/<YYYY-MM-DD>/Scratch-<YYYY-MM-DD>-<HH-mm>.md` path. The template's `<%* %>` block lazily creates the day-index file (`<DayName>-<YYYY-MM-DD>.md`) in the same folder if it does not yet exist; the create is wrapped in try/catch so a second concurrent click swallows the "already exists" race cleanly.

For programmatic creation (orchestrators, cowork weekly-review, etc.), invoke the `new-scratch` skill at `.claude/skills/scratch/new-scratch/SKILL.md`.

## Per-day index + global hub

Each per-day index (`<DayName>-<YYYY-MM-DD>.md`) renders the day's scratches in time order via the `ScratchDayList` CustomJS class. The global hub (`spice/scratch/Scratch.md`) renders one card per day with at least one scratch (latest first) via `ScratchHubCards`. Both classes go through the `customjs-guard` mechanism's class-registration wrapper.

Each scratch note carries a footer line `← [[<DayName>-<YYYY-MM-DD>|Back to day]] · [[Scratch|Hub]]` substituted at creation time — that's the navigation shape (no type-scoped nav-buttons; the `SpaceNavButtons` strip renders unconditionally on every note).

## Refresh or audit

```bash
sauce audit                   # full vault rule audit incl. scratch rule_fragment
sauce update --vault $(pwd)   # re-install Scratch.md + Scratch Day.md + Scratch Hub.md + helpers if drifted
```

The scratch blueprint ships one `rule_fragment`:

- **Scratches** (`spice/scratch/**/Scratch-*.md`): requires `created` + `type: scratch` + `day` frontmatter; filename must match `^Scratch-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$`.

## See also

- Workshop sources under `platform/blueprints/scratch/` — full file + nav-button + rule_fragment inventory
- `.claude/skills/scratch/new-scratch/SKILL.md` — programmatic new-scratch skill (alternative to the inline nav-button)
- Landmine #11 (module-directory invariant) — this blueprint owns ONLY `spice/scratch/`
