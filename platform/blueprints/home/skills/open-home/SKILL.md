---
name: open-home
description: Open the Home command center at spice/home/Home.md — the vault's landing page with greeting, quick-capture, and today's dashboard. Return the absolute path. Programmatic alternative to the Home nav button / Homepage plugin for orchestrators.
---

<!-- @claude-surface:version 0.1.0 -->

# open-home

Programmatic home-open skill. The Home nav button + Homepage-plugin-on-launch are the user-facing paths; this skill is for orchestrators that need to locate (and, if necessary, ensure the presence of) the home command center without invoking the Obsidian UI.

## Inputs

None.

## Steps

1. Compose the target path: `spice/home/Home.md`.
2. Check existence.
   - If the file exists, skip to step 4.
   - If it does not exist, the home note is materialized by the home blueprint's install heal, NOT by this skill. Abort with the failure message below rather than writing an empty file.
3. (Home note absent) Abort — see Failure modes.
4. Return the absolute path.

## Outputs

- `path` (absolute string) — the file location (`spice/home/Home.md`)
- `existed` (boolean) — `true` if the file was present, `false` otherwise

## Audit-receipt

Emit a one-line summary:

```
open-home: spice/home/Home.md existed; opened
```

## Failure modes

- **Home note missing** — abort with `open-home: home note not found at spice/home/Home.md; run \`sauce update --vault $(pwd)\` to run the install heal`. Do NOT fall back to writing an empty file; the home note is owned by the install heal so user content is never clobbered.
- **Path resolution denied** — abort with the underlying error; do not retry silently.

## See also

- `pantry/platform/blueprints/home/manifest.json` — the `files[]` + install-heal inventory (the home note is heal-owned, not listed in `files[]`, so re-install never clobbers user edits)
- `.claude/commands/home.md` — user-facing slash command
- `.claude/skills/daily/open-today/SKILL.md` — the per-day analogue (creates today's daily note from a template)
