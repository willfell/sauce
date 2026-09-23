# The Sauce engine

Sauce turns an Obsidian note into a graph of work that AI agents execute. This page is the reference: the problem it solves, a minimal graph in real syntax, the node and edge reference, how runs are scheduled and isolated, and what it does not do yet.

The engine is just Sauce. The CLI verb is `sauce run`, the slash command is `/sauce`, and the mechanism that installs the vault surface is called `engine`.

## The problem

Sauce already ran agents against a Kanban board: a launchd job fired a Claude session every two hours, later a deterministic coordinator claimed cards, isolated them in git worktrees, gated them behind a mutation check and a three-lens review quorum, and shipped them through CI, release, tag, tap, and deploy. That worked, and it is still here as the `mayo` plugin.

What did not scale was the shape of the work. Every new shape (a review quorum, a retry with a budget, a handoff from one agent to another, a "wait for me" step) meant more prose in a prompt or more code in a coordinator that had grown past thirteen thousand lines. The engine moves the shape into data: a note declares typed nodes and edges, the engine runs it, and results land back in the note.

## A minimal graph

A graph note is an ordinary markdown file with `type: sauce-graph` in its frontmatter and exactly one fenced ` ```sauce ` block. Start one from the `Sauce Graph` template the mechanism installs, or write it by hand:

````markdown
---
type: sauce-graph
repo: ~/Documents/GitHub/sauce
status: idle
---

# Fix the flaky sticky-notes harness

```sauce
nodes:
  - id: implement
    type: agent
    worker: claude-code
    isolate: worktree
    prompt: |
      The sticky-notes visual harness flakes under load. Find the
      nondeterminism, fix it, and add a regression test that fails
      without the fix. Commit with a conventional message.
  - id: verify
    type: judge
    run: npm run test:sticky-notes
  - id: review
    type: agent
    worker: codex
    isolate: none
    prompt: |
      Review the diff on this branch for correctness and test adequacy.
      Outcome pass or fail, one paragraph of reasons.
  - id: ship
    type: human
    ask: Open a PR from this branch?
edges:
  - { from: implement, to: verify }
  - { from: verify, to: review, on: pass }
  - { from: verify, to: implement, on: fail, max: 2 }
  - { from: review, to: ship, on: pass }
  - { from: review, to: implement, on: fail, max: 1 }
```
````

Three things are happening. `implement` runs Claude Code in its own git worktree. `verify` is a deterministic check whose exit code decides pass or fail, and a failure sends the work back to `implement` at most twice. `review` hands the branch to Codex, and a pass parks the run on a checkbox until a person answers.

Run it:

```bash
sauce run "spice/graphs/fix-flaky-harness.md" --follow
```

## Node reference

Every node has an `id` (letters, digits, `_`, `-`) and a `type`. Fields marked with `${...}` accept variable substitution (see below).

| Type | Required | Optional | Done when | Outcome |
| --- | --- | --- | --- | --- |
| `agent` | `worker` (`claude-code`, `codex`, `fake`), `prompt` | `isolate` (`worktree`, default when the note has `repo:`; or `none`), `cwd`, `timeout` (seconds), `max_turns`, `model` | The worker exits and `result.json` exists in the node's run directory. | `pass`, `fail`, or a named outcome the worker wrote. A missing or malformed result is `fail`. |
| `judge` | one of `run` (a shell command) or `gate: adequacy` | `cwd`, `timeout` | The command exits. | Exit 0 is `pass`, anything else `fail`. |
| `shell` | `run` | `capture: json` (parse stdout into the result's `receipt`), `outcome_from` (dotted path into the receipt), `outcome` (a `${...}` expression), `vars_from` (map of var name to receipt path), `cwd`, `timeout` | Exit 0. | `pass` by default; `outcome_from` or `outcome` name a different one; non-zero exit is `fail`. |
| `human` | `ask` | | A person ticks the checkbox the engine wrote into the note. | `pass`, or the word given as `(decision: <word>)` on the line. |
| `end` | | `outcome` (defaults to the node id) | Immediately. | The run's final status. |

`gate: adequacy` calls the workshop's `scripts/autoloop/gate.js verify-adequacy` in the node's directory: the regression test must fail without the change and pass with it.

A graph may also carry a top-level `vars:` map of scalar defaults. `sauce run --var k=v` overrides them.

## Edge reference

```yaml
edges:
  - { from: a, to: b }                     # on: pass is the default
  - { from: b, to: a, on: fail, max: 2 }   # a retry with a budget
  - { from: b, to: c, on: always }         # fires on any outcome
  - { from: b, to: d, on: needs-design }   # a named outcome
```

- `on` is `pass`, `fail`, `always`, `exhausted`, or any lowercase hyphenated name a worker or receipt can produce.
- `max` is a traversal budget for the run. Exceeding it produces the outcome `exhausted` on the source node, which follows an `on: exhausted` edge if there is one or ends the run as `failed`.
- `budget: <name>` makes several edges share one `max` counter. Without it each edge counts alone, so five gates that each allow one repair allow five repairs in total. The shipped delivery graph puts every repair edge on `budget: repair`, which is how "one repair per card, then supersede" is expressed. An edge naming a budget must also carry `max`.
- Several matching edges all fire (fan-out). A node with several incoming edges starts when any one fires; joins are not implemented yet.
- A handoff is an edge between two `agent` nodes. The downstream prompt receives the upstream summary, head, and artifacts under a `## Handoff context` heading, and its worktree branches from the upstream head when there is one.
- The validator refuses a cycle that has no `max:` on any of its edges, an edge to an unknown node, an unknown node type, and a missing required field. `sauce run --dry-run` reports every error with the node or edge it belongs to.

The run starts at the first declared node, plus any node no edge points at.

## Variables

`${run.id}`, `${run.dir}`, `${vars.<name>}`, `${result.<node>.<path>}`, and `${node.id}` are substituted in `prompt`, `run`, `cwd`, `outcome`, and `ask`. An unknown reference is an error, never an empty string. A var default may reference another var; substitution repeats until stable, bounded so a self-reference is refused.

**Substitution into a command is shell-quoted.** In `run:`, every substituted value is wrapped in single quotes with embedded quotes escaped, so a card title, a path, or an agent's free-prose summary cannot break out of its operand and execute something. Write `--card ${vars.card}`, not `--card "${vars.card}"`. When a var holds a whole command fragment rather than an operand, opt that one reference out with `${raw:vars.name}`. It is deliberately conspicuous: every raw reference is a place the graph author has taken responsibility for the value.

`shell` nodes with `capture: json` and `vars_from` are how a receipt from one tool feeds the next node. The shipped delivery graph captures `lease_token`, `worktree`, and `branch` from the coordinator's claim receipt this way.

## Running

```bash
sauce run <note>                       # one tick: run every ready node, fire edges, stop
sauce run <note> --follow              # keep ticking until a terminal node or a human node
sauce run <note> --follow --wait-human # also keep polling the note for the human's answer
sauce run <note> --dry-run             # validate and print the plan; writes nothing
sauce run <note> --status              # latest run of this note, read-only
sauce run --list                       # every run in the vault, newest first
sauce run <note> --sweep               # remove finished, clean worktrees of this note's runs
sauce run <note> --worker fake         # rehearse: every agent node uses the test double
sauce run <note> --var k=v             # override a graph var
sauce run <note> --json                # receipt only, for scripts and /sauce
```

`sauce run` finds the vault from the note's own path, so it works from any directory. Exit codes: 0 when the run is done, parked, or listed; 1 when it failed; 2 for a refusal (`vault_missing`, `note_missing`, `graph_invalid`, `repo_missing`, `usage`).

`/sauce <note>` inside Claude Code shells to the same verb and relays the receipt. It never edits the ledger, the board, or a checkbox for you.

## State and the note

Each run is one append-only file, `ranch/engine/runs/<run-id>.jsonl`, plus a directory of per-node artifacts (`prompt.md`, `result.json`, `stdout.log`, `command.txt`). Nothing is ever rewritten and there is no index file: `--list` replays the ledgers. That is deliberate so Obsidian Sync can carry runs between machines without two sides fighting over one file. A partial trailing line (a sync caught mid-append) is ignored on read.

This is the ledger of a real run on this machine, with the fake worker, the retry edge firing once, the handoff to `review`, and the park on `ship`:

```jsonl
{"ts":"2026-09-22T20:02:20.572Z","type":"run.created","run_id":"fix-flaky-harness-20260922-140220","graph_note":"spice/graphs/fix-flaky-harness.md","graph_hash":"d6a593e1f1f77019","repo":"/Users/will/Documents/GitHub/sauce","vars":{},"worker_override":"fake","host":"mac-mini.local"}
{"ts":"2026-09-22T20:02:20.573Z","type":"node.started","node":"implement","attempt":1}
{"ts":"2026-09-22T20:02:20.632Z","type":"node.finished","node":"implement","attempt":1,"outcome":"pass","result":{"schema":"sauce.worker-result.v1","outcome":"pass","summary":"fake implement attempt 1 → pass","artifacts":[],"head":null,"vars":{},"worker":"fake","attempt":1,"cwd":"/Users/will/Documents/GitHub/sauce/.worktrees/sauce/fix-flaky-harness-20260922-140220-implement","worktree":"/Users/will/Documents/GitHub/sauce/.worktrees/sauce/fix-flaky-harness-20260922-140220-implement","branch":"sauce/fix-flaky-harness-20260922-140220-implement","exit_code":0,"timed_out":false}}
{"ts":"2026-09-22T20:02:20.632Z","type":"edge.fired","from":"implement","to":"verify","on":"pass"}
{"ts":"2026-09-22T20:02:20.632Z","type":"node.started","node":"verify","attempt":1}
{"ts":"2026-09-22T20:02:20.639Z","type":"node.finished","node":"verify","attempt":1,"outcome":"fail","result":{"summary":"fail: exit 1","exit_code":1,"stdout":"","stderr":"","artifacts":[],"head":null,"vars":{}}}
{"ts":"2026-09-22T20:02:20.639Z","type":"edge.fired","from":"verify","to":"implement","on":"fail"}
{"ts":"2026-09-22T20:02:20.639Z","type":"node.started","node":"implement","attempt":2}
{"ts":"2026-09-22T20:02:20.662Z","type":"node.finished","node":"implement","attempt":2,"outcome":"pass","result":{"schema":"sauce.worker-result.v1","outcome":"pass","summary":"fake implement attempt 2 → pass","artifacts":[],"head":null,"vars":{},"worker":"fake","attempt":2,"cwd":"/Users/will/Documents/GitHub/sauce/.worktrees/sauce/fix-flaky-harness-20260922-140220-implement","worktree":"/Users/will/Documents/GitHub/sauce/.worktrees/sauce/fix-flaky-harness-20260922-140220-implement","branch":"sauce/fix-flaky-harness-20260922-140220-implement","exit_code":0,"timed_out":false}}
{"ts":"2026-09-22T20:02:20.662Z","type":"edge.fired","from":"implement","to":"verify","on":"pass"}
{"ts":"2026-09-22T20:02:20.662Z","type":"node.started","node":"verify","attempt":2}
{"ts":"2026-09-22T20:02:20.668Z","type":"node.finished","node":"verify","attempt":2,"outcome":"pass","result":{"summary":"pass: exit 0","exit_code":0,"stdout":"","stderr":"","artifacts":[],"head":null,"vars":{}}}
{"ts":"2026-09-22T20:02:20.668Z","type":"edge.fired","from":"verify","to":"review","on":"pass"}
{"ts":"2026-09-22T20:02:20.668Z","type":"node.started","node":"review","attempt":1}
{"ts":"2026-09-22T20:02:20.669Z","type":"node.finished","node":"review","attempt":1,"outcome":"pass","result":{"schema":"sauce.worker-result.v1","outcome":"pass","summary":"fake review attempt 1 → pass","artifacts":[],"head":null,"vars":{},"worker":"fake","attempt":1,"cwd":"/Users/will/Documents/GitHub/sauce","worktree":null,"branch":null,"exit_code":0,"timed_out":false}}
{"ts":"2026-09-22T20:02:20.669Z","type":"edge.fired","from":"review","to":"ship","on":"pass"}
{"ts":"2026-09-22T20:02:20.669Z","type":"node.started","node":"ship","attempt":1}
{"ts":"2026-09-22T20:02:20.669Z","type":"run.parked","node":"ship","ask":"Open a PR from this branch?"}
```

The same run, as the engine wrote it back into the note:

```markdown
## Runs

<!-- @sauce:runs BEGIN -->
**Latest run:** `fix-flaky-harness-20260922-140220` · status **parked**

- ● `implement` agent · pass · attempts 2 — fake implement attempt 2 → pass
- ● `verify` judge · pass · attempts 2 — pass: exit 0
- ● `review` agent · pass · attempts 1 — fake review attempt 1 → pass
- ⏸ `ship` human · parked · attempts 1

Answer by ticking the box (add `(decision: fail)` or a named outcome before ticking to answer anything but pass):
- [ ] run:fix-flaky-harness-20260922-140220 node:ship — Open a PR from this branch?

Ledger: `ranch/engine/runs/fix-flaky-harness-20260922-140220.jsonl`
<!-- @sauce:runs END -->
```

Tick the box and run `sauce run <note>` again; the engine records `human.answered` and continues. To stop a run, set `status: halted` in the note's frontmatter; the next tick records `run.halted` and exits. The `## Runs` region is the only part of the note the engine rewrites.

## Scheduling

A tick is synchronous: every ready node runs to completion, including agent workers, which block the tick for as long as the session takes. `--follow` repeats ticks (default every 30 seconds) until a terminal node, and stops at a human node unless `--wait-human` is given.

Unattended cadence on macOS uses launchd:

```bash
sauce run <note> --install-launchd --interval 900   # every 15 minutes
sauce run <note> --uninstall-launchd
```

`--install-launchd` renders `platform/engine/sauce-engine.plist.sample` into `~/Library/LaunchAgents/com.<user>.sauce-run.<slug>.plist` and loads it; logs go to `~/Library/Logs/sauce-run.<slug>.log`. The job runs `sauce run <note> --follow --json` on the interval, so a parked run is checked every interval and resumes when the box is ticked.

## Isolation

When the note declares `repo:`, an `agent` node runs in its own git worktree at `<repo>/.worktrees/sauce/<run-id>-<node-id>` on branch `sauce/<run-id>-<node-id>`, branched from `origin/main` or from the upstream node's head on a handoff. `isolate: none` runs in the repo root, and `cwd:` overrides both (the shipped delivery graph uses `cwd: ${vars.worktree}` to work inside the coordinator's own checkout).

Workers run with the isolation scope as their working directory, stdin closed, a timeout, and `SAUCE_VAULT` exported. The Claude Code adapter runs `claude -p <prompt> --permission-mode acceptEdits --max-turns <n>`; the Codex adapter runs `codex exec --json <prompt>`. Every prompt ends with the same instruction: write `result.json` at a given path, by temp file and rename. The engine reads that file and nothing else. `sauce run <note> --sweep` removes worktrees of finished runs whose trees are clean and have no commits ahead of the base; anything else is kept and named. It fails closed: a dirty tree, a detached HEAD, or a base it cannot measure against all keep the worktree, because the alternative is deleting unmerged commits.

## The shipped delivery graph

`platform/engine/graphs/delivery-slice.md` is the coordinator's slice pipeline as a graph: claim, implement, adequacy gate, three review lenses each recorded through `record-review`, `verify-gates`, PR, and `advance` through CI, release, tag, tap, brew, and deploy to complete. One same-card repair per gate is an edge with `max: 1`; a second refutation parks on a `supersede` human node. Every action the coordinator's `advance` can return is a named edge, and a harness checks that against the coordinator source.

The `mayo` plugin runs it on request (`/mayo:run`, "run it through the engine"). The prose pipeline stays the default until one live epic completes cleanly through the graph and its ledger has been diffed against a coordinator run of the same shape.

## Limitations

- Pre-1.0 and solo-developed. The graph syntax is a YAML subset (maps, lists, scalars, `|` block scalars, single-line `{}` and `[]`); anchors, tags, and multi-line flow collections are refused with a line number.
- Single machine. Two machines ticking the same run through Obsidian Sync will append to the same ledger; the reducer ignores an event for a node it never saw start, but there is no lock.
- Worktrees are filesystem and branch isolation only. Workers keep your local privileges; there is no container or VM sandbox.
- Workers block the tick. A long Claude Code session holds `sauce run` for its duration.
- No join or fan-in nodes yet, and no sub-graphs. Fan-out works; waiting for all branches does not.
- The `claude-code` and `codex` adapters are thin shell-outs; the only worker the harnesses exercise end to end is `fake`.
- Agent workers run whatever a graph's prompt tells them to, with your local privileges. Treat a graph note from someone else the way you would treat a shell script from someone else.
- The delivery-slice graph is opt-in and has not yet driven a live epic.
- `sauce audit --engine` checks the install, not the graphs; a graph is validated when it runs.

## Where things live

| Path | What |
| --- | --- |
| `platform/engine/` | The runtime (shipped in the brew `libexec`, never copied into vaults) |
| `platform/mechanisms/engine/` | The vault surface: `/sauce`, the `engine:run` skill, the `Sauce Graph` template, `ranch/engine/` |
| `platform/cli/cmd-run.js` | The `sauce run` verb |
| `platform/audit/engine-walker.js` | `sauce audit --engine` |
| `platform/engine/schemas/` | `sauce.graph.v1`, `sauce.run-ledger.v1`, `sauce.worker-result.v1` |
| `platform/test/run-engine-*.js` | The harnesses (unit, smoke, install, delivery graph) |
| `Docs/agent-guides/engine.md` | The agent-facing guide (invariants, layout) |
| `Docs/comparison.md` | How Sauce compares to Gas Town, beads-superpowers, and plain loops |
