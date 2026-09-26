# ranch/engine

Run state for the Sauce engine. Materialized by the `engine` mechanism; the installer creates the directory and this note, the engine writes everything else.

- `runs/<run-id>.jsonl` — one append-only ledger per run. Never rewritten, never indexed; `sauce run --list` derives the index by replaying these files, so Obsidian Sync can carry them between machines without a shared file both sides rewrite.
- `runs/<run-id>/<node-id>/` — per-node artifacts: `prompt.md`, `result.json`, `stdout.log`, `command.txt`.

Do not hand-edit a ledger. To stop a run, set `status: halted` in the graph note's frontmatter; the next tick records it and exits.
