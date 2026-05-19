---
description: Navigate the daily notes blueprint — open today's daily note, find the dashboard panel, locate historical daily notes
allowed-tools: Read, Glob, Bash
---

<!-- @claude-surface:version 0.3.0 -->

# /daily — daily notes blueprint navigator

Drives the v0.3.0 daily blueprint installed at `spice/daily/`. Use this when you want to:

- Open today's daily note (creating it from the template if missing)
- Find a previous daily note for a given date
- Locate or audit the `SpaceDailyDashboard` panel rendered at the top of every daily note
- Inspect the cowork callout anchor wired in by the cowork blueprint

## Vault layout

```
spice/daily/
└── YYYY/
    └── MM-MMMM/
        └── dddd-YYYY-MM-DD.md           One daily note per day (e.g. Tuesday-2026-05-12.md)
```

The folder route + filename pattern are configured by the daily blueprint via core-plugin settings on `daily-notes`:

- `folder`: `spice/daily`
- `format`: `YYYY/MM-MMMM/dddd-YYYY-MM-DD`
- `template`: `ranch/templates/Daily Note.md`

Glob example to enumerate all daily notes:

```bash
ls spice/daily/*/*/*.md
```

## Open today's note

Three equivalent entry points — pick whichever fits the context:

1. **Cmd+[** — global hotkey wired by `convenience@0.1.0` from the blueprint's `hotkeys[]` manifest field (v0.2.2). Fires the `daily-notes` core-plugin command, which opens today's note or creates it from the template if missing.
2. **Today nav button** — the `Daily` button in the nav-buttons strip at the top of every note (rendered by `nav-buttons@2.6.0`; v0.1.4 contributed via the daily blueprint's `nav_buttons[]` entry). Same `invoke_command` dispatch as the hotkey.
3. **Calendar plugin** — click any date in the Calendar pane (community plugin; surfaced in `post_install` notice as a recommended companion).

The core `daily-notes` plugin runs the Templater template at `ranch/templates/Daily Note.md` when the target file does not yet exist; otherwise it just opens the existing file.

## The dashboard panel

Every daily note renders a `SpaceDailyDashboard` panel at the top of the body (immediately below the nav-buttons strip and above any user `## Notes`):

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceDailyDashboard" });
```

The dashboard shows two BeaconCards-rendered sub-panels (v0.2.0 migration), in order:

1. **Tasks panel** — synthetic-page cards for outstanding `obsidian-tasks-plugin` tasks across the vault (each card click navigates to the parent file).
2. **Meetings panel** — cards for meeting notes whose filenames include today's date (v0.2.6 widened from `startsWith` to `includes` to match the trailing-date `Foo-2026-05-12.md` convention).

If the panel does not render (or appears with stale data), trigger Cmd+R after install to re-register the `SpaceDailyDashboard` CustomJS class.

## Cowork callout anchor

A hidden Obsidian-comment anchor is materialized above the `## Notes` heading in the daily template (v0.2.5 contract; switched from HTML-comment to Obsidian `%% %%` syntax in v0.5.1 / v0.64.1 so the anchor is invisible in BOTH source AND reading mode):

```
%% COWORK_CALLOUTS %%

## Notes
```

The cowork blueprint inserts per-callout content blocks immediately above this anchor at orchestration time; daily-blueprint code never edits below `## Notes` directly. Treat the anchor line as a stable contract — do not rename, reposition, or remove it during template authoring.

## Refresh or audit

```bash
sauce audit                   # full vault rule audit incl. daily rule_fragment (tag:daily + naming-pattern)
sauce update --vault $(pwd)   # re-install the daily template + dashboard helper if they drifted
```

The daily `rule_fragment` requires `created` frontmatter + the `daily` tag and enforces the `dddd-YYYY-MM-DD.md` filename pattern.

## See also

- `pantry/platform/blueprints/daily/manifest.json` — full file + nav-button + hotkey + rule_fragment inventory
- `.claude/skills/daily/open-today/SKILL.md` — programmatic open-today skill (used by cowork orchestrators)
- `pantry/Docs/landmines.md` #11 — module-directory invariant (this blueprint owns ONLY `spice/daily/`)
