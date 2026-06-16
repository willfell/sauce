---
purpose: Index of per-blueprint manual in-Obsidian smoke checklists. Loaded at cycle close when a blueprint UI surface (template / dialog / widget) changed.
load_when: Cycle close that touched any blueprint UI surface.
---

# Smoke checklists

Per-blueprint manual smoke procedures. Walk the relevant file on a deployed consumer vault after
`brew upgrade sauce && sauce update --bump-pins && sauce install`. Not gate-enforced (human
discretion). The result-doc § "Manual smoke" notes the vault tested, or "N/A — no UI surface
change."

## When to walk

Cycle close that touched any of:
- A blueprint's `Today <X>.md` / hub template
- A custom `+ New X` dialog
- A live-render widget (Dataview-rendered classes)
- A migration that mutates user-visible content

## Files

| Blueprint | File | State |
| --- | --- | --- |
| to-do | [`to-do.md`](to-do.md) | Load-bearing (bug-(b) + bug-(c) verification items) |
| daily | [`daily.md`](daily.md) | Scaffold placeholder — fill in as cycles touch the surface |
| meetings | [`meetings.md`](meetings.md) | Scaffold placeholder |
| scratch | [`scratch.md`](scratch.md) | Scaffold placeholder |
| people | [`people.md`](people.md) | Scaffold placeholder |
| project | [`project.md`](project.md) | Scaffold placeholder |
| cowork | [`cowork.md`](cowork.md) | Scaffold placeholder |

## Format

Each file is structured as Markdown task lists grouped by surface (templates / dialogs / widgets /
console / migration). Items are written so the human running them can check `[x]` off after each
step. The file ends with a "Result-doc note" template line for pasting into the cycle's result doc.
