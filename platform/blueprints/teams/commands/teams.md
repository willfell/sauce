---
description: Manage the teams blueprint — create new teams, navigate the Teams hub, browse per-team rollup pages
---

# /teams

Use this command to navigate the teams blueprint.

## Common operations

- **Open the Teams hub** — `spice/teams/Teams.md` lists all teams grouped by Product. Each card shows active-project count and a status histogram chip.
- **Create a new team** — Use the embedded `new-team` skill. Requires a `product:` wikilink (the team's parent product must already exist; create one via `/products` first if needed).
- **Open a per-team rollup** — `spice/teams/<Name>.md` shows sibling teams under the same product + all projects this team is on.

## Related blueprints

- `/products` — each Team has exactly one Product parent.
- `/project` — projects optionally tag teams via `teams: []` frontmatter.
