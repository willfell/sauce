---
name: run
description: Run, inspect, or resume a Sauce graph note through the engine. Shells `sauce run <note> [--follow|--dry-run|--status|--list|--sweep] --json` and relays the receipt. Launcher only; never edits boards, cards, or coordinator state.
---

# engine:run

Runs a graph note through the Sauce engine and reports the receipt. The engine owns state (an append-only ledger under `ranch/engine/runs/`), the note owns the human surface (`## Runs` section, `human` checkboxes, `status:` frontmatter). This skill only launches and relays.

## Pre-flight

1. **Confirm vault shape.** `ranch/platform-config.json` must exist under the vault; otherwise abort with `[!warning] /sauce requires a sauce vault` and stop.
2. **Confirm the CLI.** `sauce run --help` must print usage; otherwise report `brew install willfell/sauce/sauce` (or `brew upgrade sauce`) and stop.

## Steps

1. Resolve the note. A wikilink `[[Name]]` becomes the matching `Name.md` under the vault; a path is used as given; no argument means `--list`.
2. For a note with no prior run, `sauce run "<note>" --dry-run --json` and show the plan as a table: node, type, worker, isolation; then edges as `from → to on <outcome> (max n)`.
3. `sauce run "<note>" --follow --json`. Relay:
   - `done`: every node's outcome, the ledger path, and any `worktrees` still on disk (offer `--sweep`).
   - `parked`: the parked node, its ask, and the exact checkbox line in the note. Stop; the user answers in Obsidian and re-runs `/sauce <note>`.
   - `failed`: the failing node, its `summary`, and the path to its `stdout.log`.
   - a named status (an `end` node's outcome): report it as the run's result.
4. Never edit the ledger, the note's `## Runs` region, or a checkbox on the user's behalf.

## Refusals

Exit code 2 carries `{ ok: false, code, message }`. Relay both fields. `graph_invalid` messages name the node or edge; point the user at the line in the `sauce` block.
