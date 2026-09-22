---
purpose: The Sauce engine — runtime layout under platform/engine/, the invariants an agent must not break, the harnesses, how the `engine` mechanism materializes the vault surface, and how mayo consumes it.
load_when: Touching platform/engine/, platform/cli/cmd-run.js, platform/audit/engine-walker.js, the `engine` mechanism, or the shipped delivery-slice graph; debugging a `sauce run` or a `## Runs` projection.
---

# Sauce engine

## What it is

The engine runs a graph note — a `sauce` code block of typed nodes and named edges inside an ordinary vault note — one node at a time, with every event appended to a per-run ledger and a `## Runs` section projected back into the note. Nodes are `agent` (a worker such as claude-code or codex in a per-node git worktree), `judge` (a command whose exit decides pass/fail), `shell`, `human` (parks the run on a checkbox), or `end`. It is invoked as `sauce run <note>` or `/sauce`; the mechanism slug is `engine`, and the thing has no product name beyond "Sauce".

## Where the code lives

The runtime is a zero-dependency Node library at `platform/engine/`, shipped in the brew libexec like `platform/cli/` — it is never copied into vaults.

| Module | One line |
| --- | --- |
| `yaml-lite.js` | Parser for the documented YAML subset the `sauce` block uses. |
| `graph.js` | `parseGraphNote` — frontmatter + `sauce` block → graph object. |
| `validate.js` | Refuses unknown node types, dangling edges, and unbounded cycles; computes the entry set. |
| `ledger.js` | Append-only JSONL per run at `<vault>/ranch/engine/runs/<run-id>.jsonl`; no index file. |
| `state.js` | Reducer over ledger events; ignores a `node.finished` it never saw start. |
| `vars.js` | `${run.id}`, `${vars.k}`, `${result.<node>.<path>}`, `${node.id}` — bounded recursive expansion. |
| `isolation.js` | Per-node git worktrees at `<repo>/.worktrees/sauce/<run>-<node>`; sweep keeps dirty or ahead-of-base trees. |
| `workers/{index,fake,claude-code,codex}.js` | Worker adapters; each publishes `result.json` by rename, missing = fail. |
| `nodes.js` | Node executors: `agent`, `judge`, `shell`, `human`, `end`. |
| `scheduler.js` | `tick` / `follow`; follow stops at a `human` node unless `waitHuman`. |
| `projection.js` | Writes the `## Runs` marker section and the human checkbox; honours `status: halted`. |
| `run.js` | `createRun`; run id `<slug>-<yyyymmdd-hhmmss>`, suffixed on collision. |
| `launchd.js` + `sauce-engine.plist.sample` | Unattended cadence via a per-note launchd job. |
| `graphs/delivery-slice.md` | The coordinator slice pipeline as a graph; opt-in from `/mayo:run`. |
| `schemas/{graph.v1,run-ledger.v1,worker-result.v1}.json` | Registered in `platform/schemas-index.json` as `sauce.graph.v1`, `sauce.run-ledger.v1`, `sauce.worker-result.v1`. |

CLI: `platform/cli/cmd-run.js` (`sauce run`, context-free in the dispatcher — vault resolved from the note's ancestors first). Audit: `platform/audit/engine-walker.js` (`sauce audit --engine`, read-only). Mechanism: `platform/mechanisms/engine/`.

## Invariants — do not break these

- **The ledger is append-only and never rewritten.** `state.js` replays it; anything that needs to "fix" a run appends a new event.
- **No index file.** `sauce run --list` derives the run index by replaying `ranch/engine/runs/*.jsonl`, so Obsidian Sync never has a shared file both sides rewrite.
- **`result.json` is published by rename; missing = fail.** A worker that exits without a renamed-into-place result is a failed node, never a retried or assumed-passed one.
- **The engine never writes boards or cards.** The coordinator remains the only board writer; the delivery-slice graph reaches it only through `shell` nodes.
- **Entry-node rule.** The entry set is the first declared node plus every node nothing points at; the validator computes it, authors do not declare it.
- **The validator refuses unbounded cycles.** Every back-edge needs `max: N`; a graph without a bound on a cycle does not run.
- **`follow` stops at a `human` node by default.** Only `--wait-human` keeps the process alive across the parked checkbox.
- **`status: halted` in the note's frontmatter halts the run** at the next tick; that is the sanctioned stop, not deleting the ledger.

## Harnesses

All four are in `platform/test/preflight-manifest.json` and `package.json`:

```sh
npm run -s test:engine-graph            # platform/test/run-engine-graph.js — parser, validator, vars, state (81 cases)
npm run -s test:engine-smoke            # platform/test/run-engine-smoke.js — end-to-end with the fake worker (30)
npm run -s test:engine-install          # platform/test/run-engine-install.js — mechanism materialization + always-on heal (17)
npm run -s test:engine-delivery-graph   # platform/test/run-engine-delivery-graph.js — delivery-slice graph against the stub coordinator (19)
```

The stub coordinator for the last one is `platform/test/fixtures/engine/stub-coordinator.js`. `npm run release:preflight` runs all four.

## Mechanism + always-on heal

`platform/mechanisms/engine/` (slug `engine`, v0.1.0, `skills_dir: .claude/skills/engine`) materializes only the vault-facing surface:

- `.claude/commands/sauce.md` — the `/sauce` launcher
- `.claude/skills/engine/run/SKILL.md`
- `{{templates_path}}/Sauce Graph.md` — the starter graph note
- `ranch/engine/README.md` — the run-state directory
- a CLAUDE.md resolvers row: `Sauce | .claude/commands/sauce.md | /sauce`

`engine` is **always-on**. `ensureAlwaysOnMechanisms` in `platform/install.js` appends `platform-claude` and `engine` at their catalogue versions to any subscription lacking them, writes `ranch/platform-subscription.json` back, and records a `always_on_subscription` history row. Consumers cannot opt out by editing the subscription; `platform-claude` is formally always-on by the same rule, not by convention.

## How mayo consumes it (opt-in)

`/mayo:run` keeps the prose pipeline as the default. Its "Engine mode" section runs the shipped `platform/engine/graphs/delivery-slice.md` with `sauce run … --var coordinator=… --var gate=… --follow --json` when the user asks for it or the binding sets `policy.engine: true`. Engine mode stays opt-in until one live epic completes through it and its ledger is diffed against a coordinator run. `/mayo:status` folds engine runs into the digest. Unattended cadence is `sauce run <note> --install-launchd`; the 2h cron loop and `/sauce-autoloop` are gone.

## Read these next

- `Docs/engine.md` — the standalone engine reference (graph grammar, node types, worker contract, ledger events).
- `Docs/agent-guides/mayo-plugin.md` — the plugin that consumes the engine.
