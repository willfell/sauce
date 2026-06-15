---
description: Navigate the meetings blueprint — open today's hub, create a new meeting, find historical meeting notes by attendee or title
allowed-tools: Read, Glob, Bash
---

<!-- @claude-surface:version 0.4.0 -->

# /meetings — meetings blueprint navigator

Drives the v0.4.0 meetings blueprint installed at `spice/meetings/`. Use this when you want to:

- Open today's Meetings Hub (one hub per day; aggregates all meeting notes for the day)
- Create a new meeting note from inside the hub (per-meeting note with attendees + agenda + notes scaffold)
- Find historical meeting notes by date, title, or attendee
- Audit hub-card rendering or attendee-chip behavior for the `MeetingsHubCards` panel

## Vault layout

```
spice/meetings/
├── hubs/
│   └── YYYY/
│       └── MM-MMMM/
│           └── Meetings-YYYY-MM-DD.md       One hub note per day (tag: meetings-hub)
└── notes/
    └── YYYY/
        └── MM-MMMM/
            └── <title>-YYYY-MM-DD.md        Per-meeting note (tag: meeting)
```

The hub folder route + filename pattern are wired by the meetings blueprint's `nav_buttons[]` entry (`runTemplaterTemplate` action; `folder_date_pattern: YYYY/MM-MMMM`; `filename_prefix: Meetings-`; `filename_date_pattern: YYYY-MM-DD`). The per-meeting note route is registered via `templater_folder_templates[]` so any new file created under `spice/meetings/notes/` auto-applies the `Meeting.md` template.

Glob example to enumerate all meeting notes:

```bash
ls spice/meetings/notes/*/*/*.md
```

## Open today's hub

Click the **Meetings** nav button in the strip at the top of any note (rendered by `nav-buttons@2.6.0`; contributed via the meetings blueprint's `nav_buttons[]` entry, order 120). The action fires the `Meeting Hub.md` Templater template auto-routed to today's `spice/meetings/hubs/YYYY/MM-MMMM/Meetings-YYYY-MM-DD.md` path, creating the hub if missing and opening it otherwise.

The hub renders a `MeetingsHubCards` panel (CustomJS class) listing all meeting notes whose filename includes today's date. Each card shows the meeting title, status badge, and attendee chips.

## Create a new meeting

From inside today's hub, click the **New Meeting** button (rendered by the `NewMeetingButton` CustomJS class as an inline accent button). The button prompts for:

1. **Title** — free text (slugified into the filename)
2. **Attendees** — comma-separated names; each name is matched against `spice/people/<name>.md` for chip rendering

The button creates a new file at `spice/meetings/notes/YYYY/MM-MMMM/<title>-YYYY-MM-DD.md` using the `Meeting.md` template (frontmatter `type: meeting` + `tags: [meeting, person/<name>...]` + `attendees: [[Name1]], [[Name2]]`).

## Attendee chips

Registered People (those with `spice/people/<name>.md` notes in the people blueprint) render as compact chips via the `PeopleRendering.renderChip` callback. This integration uses the `cards@0.2.4` subtitle-callback polymorphism: the `MeetingsHubCards` subtitle slot delegates per-attendee rendering to `people-rendering@0.1.0` when the attendee resolves to a registered Person note; otherwise it falls back to a plain comma-separated string.

The `## Attendees` dataviewjs block in each meeting note also calls `PeopleRendering.renderMentionList` (mode `mentioned_in_note`, scope `spice/people`, style `chips`) for the in-note chip strip.

## Refresh or audit

```bash
sauce audit                   # full vault rule audit incl. meetings rule_fragments (notes + hubs)
sauce update --vault $(pwd)   # re-install Meeting.md + Meeting Hub.md templates + CustomJS helpers if drifted
```

The meetings blueprint ships two `rule_fragments`:

- **Notes** (`spice/meetings/notes/**/*.md`): when `frontmatter.type == meeting`, requires `date` + `attendees` frontmatter and the `meeting` tag.
- **Hubs** (`spice/meetings/hubs/**/*.md`): requires the `meetings-hub` tag.

## See also

- `pantry/platform/blueprints/meetings/manifest.json` — full file + nav-button + rule_fragment + bootstrap_contributions inventory
- `.claude/skills/meetings/new-meeting/SKILL.md` — programmatic new-meeting skill (alternative to the inline `NewMeetingButton`)
- `pantry/Docs/landmines.md` #11 — module-directory invariant (this blueprint owns ONLY `spice/meetings/`)
