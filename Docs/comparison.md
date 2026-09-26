# How Sauce compares

Sauce is an Obsidian vault platform with a small orchestration engine at its core. A graph note (`type: sauce-graph` plus one fenced `sauce` block) declares typed nodes and edges. The engine ticks the graph, runs workers in git worktrees, and writes results back into the note. This page sets that next to three other ways people run coding agents.

## Gas Town

Gas Town is Steve Yegge's multi-agent orchestration system. A Mayor agent coordinates work across a workspace. Polecats are worker agents with persistent identity and ephemeral sessions, each working in its own git worktree. Convoys bundle beads into work orders. Town-level roles such as the Witness, Deacon, and Refinery watch for stuck agents, patrol across rigs, and run a merge queue. Work is tracked in beads, a Dolt-backed issue tracker built for agents.

Where Sauce borrows: one worktree per worker, one branch per unit of work, and a receipt that decides whether the work counted.

Where Sauce differs: there is no Mayor. The shape of the work is an explicit graph with `on:` outcomes, `max:` retry budgets, and `human` nodes that park a run on a checkbox. Judgment about what happens next lives in the note, not in a coordinating agent. The store is the vault. State is an append-only JSONL ledger per run under `ranch/engine/runs/`, with no database and no index file, and Obsidian Sync can carry it.

Where Gas Town is the better fit: many parallel workers on several repos, a merge queue, and a coordinator that can break large work into pieces on its own. If you want the system to plan, pick Gas Town.

## beads-superpowers

beads-superpowers wires Jesse Vincent's Superpowers skills to Yegge's beads tracker. Skills enforce workflows for testing, debugging, design, and execution. Every task becomes a `bd` bead in a local Dolt database, so memory persists across sessions and "where are we" resumes where the last session stopped. Critical review findings block progress and every close needs evidence.

Where Sauce borrows: the idea that a skill should leave a record as it runs. Sauce's mayo plugin does this against a board in the vault, and the engine's `record-review` step records each review lens.

Where Sauce differs: the record is a note, not a bead. There is no external tracker. The unit of work is a note with a graph in it, and the run ledger sits beside it. Gates are graph nodes with retry budgets, not skill-level checkpoints. A `judge` node is a deterministic command; exit 0 passes. The engine never parses a verdict from free text, and a missing or malformed `result.json` is a fail.

Where beads-superpowers is the better fit: you already work inside a single agent CLI session and want strong practices plus memory between sessions, without a separate runner. It supports more agents than Sauce.

## Plain Claude Code loops

The simplest option is a shell or cron loop that re-invokes `claude -p` with a prompt. State lives in git or a markdown file. Sauce started here in June 2026 with a launchd loop firing one non-interactive turn every two hours against a Kanban board.

Where Sauce borrows: the cadence. Unattended runs still come from a launchd plist, installed with `sauce run --install-launchd`. A `claude-code` worker is still `claude -p`; a `codex` worker is `codex exec`. The adapters are thin shell-outs.

Where Sauce differs: the loop is now a graph. Retries, handoffs from one agent to another, a review quorum, and a "wait for me" step are edges and nodes rather than paragraphs in a prompt. Each agent node gets its own worktree. Each tick appends to a ledger you can read after the fact. A cycle without a retry budget is refused before it runs.

Where a plain loop is the better fit: one repo, one prompt, no branching. If a graph would have one node, use a loop.

## Where Sauce stands

Sauce is MIT, pre-1.0, and solo-developed. It runs on one machine. Isolation is worktrees only, with no container or VM sandbox. Workers block the tick. There are no join or fan-in nodes yet. The delivery-slice graph that expresses the mayo pipeline is opt-in and has not yet finished a live epic. The strongest reason to pick it is that your work already lives in an Obsidian vault and you want the record of agent work to live there too.

Sources: the Gas Town GitHub README and the beads-superpowers GitHub README were fetched on 2026-09-22; the Medium post "Welcome to Gas Town" returned 403 and the beads-superpowers GitHub Pages site returned 404, so claims about those two are kept generic.
