---
description: Run a graph note through the Sauce engine (sauce run), or list this vault's runs
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /sauce

`/sauce <note>` runs a graph note through the Sauce engine. `/sauce` alone lists the vault's runs. The command is a launcher: it shells to `sauce run`, relays the JSON receipt, and never edits boards, cards, or coordinator state.

A graph note carries `type: sauce-graph` frontmatter and one fenced ` ```sauce ` block declaring typed nodes (`agent`, `judge`, `shell`, `human`, `end`) and edges (`on:` outcome, optional `max:` retry budget). Start one from the `Sauce Graph` template.

## Steps

1. **Resolve the argument.** No argument → `sauce run --list --json` and render the runs table (status, run id, note, parked node). A wikilink or bare name → find the note under the vault; a path → use it as is.
2. **Dry-run first when the note has never run.** `sauce run "<note>" --dry-run --json` prints the plan (nodes, workers, isolation, edges). Show it in one short table.
3. **Run.** `sauce run "<note>" --follow --json`. `--follow` ticks until a terminal node or a `human` node. Pass `--worker fake` only when the user asks for a rehearsal.
4. **Relay the receipt.** Status, one line per node with its outcome, the ledger path (`ranch/engine/runs/<run-id>.jsonl`). When `status` is `parked`, name the node and the checkbox line in the note's `## Runs` section the user must tick, then stop. When `status` is `failed`, quote the failing node's `summary` from `ranch/engine/runs/<run-id>/<node>/result.json` or `stdout.log`.
5. **Resume a parked run** with the same command after the box is ticked; the engine picks up where the ledger left off.

## Refusals

`sauce run` exits 2 with `{ ok: false, code, message }` for `vault_missing`, `note_missing`, `graph_invalid`, `repo_missing`, or `usage`. Relay the code and message verbatim; do not retry with a different graph.

## Reference

`sauce run --help` for every flag (`--status`, `--sweep`, `--install-launchd`, `--var k=v`, `--repo`). Full reference: `Docs/engine.md` in the workshop.
