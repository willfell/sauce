---
description: Open the Home command center — greeting, quick-capture, and today's dashboard at spice/home/Home.md
allowed-tools: Read, Glob, Bash
---

<!-- @claude-surface:version 0.1.0 -->

# /home — home command center

Drives the home blueprint installed at `spice/home/`. Use this when you want to:

- Open the Home command center (`spice/home/Home.md`), the vault's landing page
- Locate or audit the `SpaceHome` panel rendered on the home note
- Quick-capture a task or scratch from the home dashboard
- Glance at today's dashboard (tasks + meetings + recent activity) without opening a daily note

## Vault layout

```
spice/home/
└── Home.md                 The single home command center note (owned by an install heal)
```

The home note is materialized once by the home blueprint's install heal and is never clobbered on re-install, so user edits below the platform-rendered panel are preserved.

## Open the home note

Two equivalent entry points — pick whichever fits the context:

1. **Home nav button** — the `Home` button in the nav-buttons strip at the top of every note. It fires the `homepage:open-homepage` command (from the Homepage community plugin), which opens `spice/home/Home.md`.
2. **Homepage on launch** — when the Homepage plugin is configured with `spice/home/Home.md`, the note opens automatically when the vault loads.

## The home panel

The Home note renders a `SpaceHome` panel via CustomJS:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceHome" });
```

The panel shows a greeting, a quick-capture row (new task / new scratch), and a compact today's-dashboard view (tasks, meetings, recent activity). If the panel does not render (or appears with stale data), trigger Cmd+R after install to re-register the `SpaceHome` CustomJS class.

## Refresh or audit

```bash
sauce audit                   # full vault rule audit
sauce update --vault $(pwd)   # re-install the home panel helper + CSS snippet if they drifted
```

## See also

- `pantry/platform/blueprints/home/manifest.json` — full file + nav-button inventory
- `.claude/skills/home/open-home/SKILL.md` — programmatic open-home skill
- `.claude/commands/daily.md` — the per-day daily note (this home dashboard is a cross-day landing page)
- `pantry/Docs/landmines.md` #11 — module-directory invariant (this blueprint owns ONLY `spice/home/`)
