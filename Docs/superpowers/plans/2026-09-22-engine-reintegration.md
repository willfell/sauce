# Engine Reintegration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the node-based agent execution engine as the core of Sauce: a `platform/engine/` runtime, an always-on `engine` mechanism, `sauce run <note>` and `/sauce`, a shipped `delivery-slice` graph that mayo can opt into, retirement of the dead loop artifacts, and the README/docs/marketing re-positioning.

**Architecture:** The runtime is a zero-dependency Node library under `platform/engine/` that parses a graph note (frontmatter + fenced `sauce` block in a YAML subset), validates it, and ticks it: each tick runs every ready node to completion (agent nodes through a worker adapter in a per-node git worktree), appends events to a per-run JSONL ledger in the vault at `ranch/engine/runs/<run-id>.jsonl`, fires edges, and rewrites a marker-bounded `## Runs` projection in the note. The mechanism `platform/mechanisms/engine/` materializes the `/sauce` command, the `engine:run` skill, and the `Sauce Graph.md` template; the installer auto-subscribes `engine` and `platform-claude`. `plugins/mayo` consumes the engine through the shipped `delivery-slice` graph.

**Tech Stack:** Node ≥ 18, CommonJS, `fs`/`child_process` only. Test harnesses follow the repo's zero-dep `ok(label, cond)` style and register in `platform/test/preflight-manifest.json` + `package.json`.

**Spec:** `Docs/plans/engine-reintegration.md` (sections 4 to 7) as amended by the Director's Phase 2 reply of 2026-09-22 (D0 to D7 plus conditions).

## Global Constraints

- MIT license unchanged; **no new npm dependencies** (the YAML subset parser is hand-written).
- Never push. Never bump versions, tags, or subscription pins by hand beyond adding the new `engine` entry (the bumper writes pins).
- The engine is just "Sauce": CLI `sauce run`, slash `/sauce`, mechanism slug `engine`, skill `engine:run`. No product name.
- The coordinator and card-intake remain the only board writers. The engine never edits boards or cards.
- Ledger design for Obsidian Sync: one file per run, append-only events, no shared index; indexes are derived at read time.
- No comments in config/manifest/plist files (user's global rule). Code comments follow the surrounding file's conventions.
- Consumer vaults get nothing outside `ranch/`, `.claude/commands/sauce.md`, `.claude/skills/engine/`, and the template under `{{templates_path}}`.
- `sauce-autoloop.plist.sample` is deleted only after `platform/engine/sauce-engine.plist.sample` exists and is documented in `Docs/engine.md`.
- README and launch post describe what ships in this cycle; the delivery-slice graph is opt-in and must be described as opt-in.
- `Docs/engine.md` uses a real ledger excerpt from an actual run, not a hand-written one.
- Worktree sweep: remove only clean worktrees; delete only branches merged into `main`; list the rest.

## Review Focus

1. A graph note whose `sauce` block has a syntax error in the YAML subset (tabs, unbalanced flow map) must be refused with a line number, never silently parsed to an empty graph. Pinned in Task 2 (`yaml-lite` refusal cases).
2. A `human` node whose checkbox is ticked while the ledger already says the run ended (a stale sync) must not restart the run. Pinned in Task 8 (projection reads the ledger status first).
3. Two machines appending to the same run file through Obsidian Sync can interleave events; the reducer must ignore a `node.finished` for an attempt it never saw start rather than crash. Pinned in Task 4 (reducer tolerance case).
4. A worker that exits 0 but writes no `result.json` (or a partial one from a crashed rename) must yield `fail`, never `pass`. Pinned in Task 6 (fake worker with `write_result: false`).
5. `sauce run` from outside any vault with a note path that is inside a vault must resolve that vault from the note's ancestors, not error out. Pinned in Task 10 (CLI case run from `os.tmpdir()`).

---

## File structure

| Path | Responsibility |
| --- | --- |
| `platform/engine/yaml-lite.js` | Parse the documented YAML subset (maps, lists, scalars, `\|` block scalars, inline `{}` flow maps). |
| `platform/engine/graph.js` | `parseGraphNote(text)` → `{ frontmatter, block, graph }`; `splitFrontmatter`. |
| `platform/engine/validate.js` | `validateGraph(graph)` → `{ ok, errors[] }`. |
| `platform/engine/ledger.js` | Append-only per-run JSONL: `appendEvent`, `readEvents`, `listRuns`, `runPath`. |
| `platform/engine/state.js` | `reduce(events)` → run state; `outcomeOf`, `readyNodes`. |
| `platform/engine/vars.js` | `${vars.x}` / `${result.<node>.<field>}` / `${run.id}` substitution. |
| `platform/engine/isolation.js` | Worktree create/remove/sweep for `isolate: worktree`. |
| `platform/engine/workers/fake.js` | Test double: scripted outcomes, optional missing result. |
| `platform/engine/workers/claude-code.js` | `claude -p` adapter. |
| `platform/engine/workers/codex.js` | `codex exec` adapter. |
| `platform/engine/workers/index.js` | `resolveWorker(name)`; the shared prompt tail; `publishResult`. |
| `platform/engine/nodes.js` | `runNode(ctx, node)` per type → `{ outcome, result }`. |
| `platform/engine/scheduler.js` | `tick(ctx)` and `follow(ctx)`. |
| `platform/engine/projection.js` | `## Runs` marker section, frontmatter `status`, human checkbox read/write. |
| `platform/engine/run.js` | `createRun`, `resolveVaultForNote`, `runReceipt`. |
| `platform/engine/launchd.js` | Render/install/uninstall from `sauce-engine.plist.sample`. |
| `platform/engine/sauce-engine.plist.sample` | launchd template. |
| `platform/engine/graphs/delivery-slice.md` | Shipped graph expressing the coordinator slice pipeline. |
| `platform/engine/schemas/{graph.v1,run-ledger.v1,worker-result.v1}.json` | Registered schema descriptions. |
| `platform/engine/index.js` | Public surface re-export. |
| `platform/mechanisms/engine/manifest.json`, `commands/sauce.md`, `skills/run/SKILL.md`, `templates/Sauce Graph.md` | Vault-facing mechanism. |
| `platform/cli/cmd-run.js` | `sauce run` verb. |
| `platform/cli/cmd-audit.js` | `--engine` walker. |
| `platform/install.js` | `ensureAlwaysOnMechanisms` heal. |
| `platform/test/run-engine-graph.js` | Parser, validator, reducer, vars unit cases. |
| `platform/test/run-engine-smoke.js` | 3-node fake run end to end, CLI, projection, human node, halt, sweep. |
| `platform/test/run-engine-delivery-graph.js` | Shipped graph validity, coordinator action coverage, stub-coordinator run. |
| `platform/test/run-engine-install.js` | Mechanism install into a temp vault, auto-subscribe heal, audit walker. |

Interfaces shared across tasks:

```js
// graph
{ nodes: [{ id, type, worker?, prompt?, run?, gate?, ask?, isolate?, cwd?, capture?, outcome_from?, timeout?, fake? }],
  edges: [{ from, to, on = 'pass', max? }] }

// run state (state.js reduce)
{ run_id, graph_note, repo, status: 'running'|'parked'|'halted'|'done'|'failed'|<named>,
  nodes: { [id]: { status: 'idle'|'running'|'finished', attempts, outcome, result } },
  edge_counts: { [`${from}->${to}`]: n }, ready: [id], parked: { node, ask } | null,
  vars: {}, results: { [id]: result }, started_at, ended_at }

// worker result (workers write this file)
{ schema: 'sauce.worker-result.v1', outcome: 'pass'|'fail'|string, summary, artifacts: [], head: string|null, vars: {} }

// ledger event
{ ts, type, ...fields }  // types: run.created, node.started, node.finished, edge.fired, run.parked, human.answered, run.halted, run.ended
```

---

### Task 1: Branch, deletions that need no replacement, `.local/` untrack

**Files:**
- Delete: `.claude/commands/sauce-pipeline.md`, `.claude/commands/delivery-review.md`, `.claude/commands/delivery-status.md`, `.agents/skills/card-intake/SKILL.md`, `.agents/skills/slice-plan/SKILL.md`, `.agents/skills/sauce-autoloop/` (whole dir), `autoloop-queue.md`, `scripts/autoloop/{scout-signals,bughunt,board-mirror,block-note,render-handoff,reconcile-inflight}.js`, `.claude/commands/sauce-autoloop.md`
- Modify: `platform/test/run-autoloop-select.js` (drop the requires and SS-*/BN-*/BM-*/RH-*/RI-* case blocks; keep select-card cases), `scripts/autoloop/select-card.js` (remove `parseQueue`, `selectFromQueue`, their exports), `scripts/autoloop/gate.js:78` (drop the `autoloop-queue.md` clause), `.gitignore` (drop the four `.autoloop*` lines; add `.local/`)
- Untrack: `git rm --cached -r .local`

- [ ] **Step 1:** `git switch -c cycle/v0.292.0-engine-reintegration`.
- [ ] **Step 2:** Run `node platform/test/run-autoloop-select.js | tail -3` and record the pass count.
- [ ] **Step 3:** Apply the deletions and edits above. In `run-autoloop-select.js` remove every `ok(...)` whose label prefix is `SS-`, `SD-`, `BN-`, `BM-`, `RH-`, `RI-` and the helper functions only they use; keep `deliveryCard` and the `SC-*` selection cases.
- [ ] **Step 4:** `node platform/test/run-autoloop-select.js | tail -3` → passes with the smaller count; `node platform/test/run-codex-autoloop.js | tail -2` → still green (the coordinator never required the deleted files).
- [ ] **Step 5:** `grep -rn "autoloop-queue\|scout-signals\|board-mirror\|render-handoff\|reconcile-inflight\|block-note\|bughunt" --include=*.js --include=*.json --include=*.md . | grep -v node_modules | grep -v .worktrees | grep -v Docs/` → only archival docs remain.
- [ ] **Step 6:** Commit `chore(autoloop): retire the pre-plugin loop surface and Scout queue`.

### Task 2: `yaml-lite` and `graph.js`

**Files:** Create `platform/engine/yaml-lite.js`, `platform/engine/graph.js`, `platform/test/run-engine-graph.js`.

**Interfaces:**
- `parse(text) → value` throws `YamlLiteError { line, message }`.
- `parseGraphNote(text) → { frontmatter: object, block: string, graph: object }`; throws `GraphNoteError` when no ` ```sauce ` fence or more than one.
- `splitFrontmatter(text) → { frontmatter: object, body: string, raw: string }` (frontmatter via `yaml-lite`).

- [ ] **Step 1:** Write failing cases in `run-engine-graph.js`: scalar map; nested list of maps; `|` block scalar preserving newlines; inline flow map `{ from: a, to: b, on: fail, max: 2 }`; integers and booleans typed; a tab-indented line throws with `line`; an unbalanced `{` throws with `line`; `parseGraphNote` on the spec's minimal note returns 4 nodes and 5 edges with `edges[2].max === 2`; a note without a fence throws `GraphNoteError`.
- [ ] **Step 2:** Run `node platform/test/run-engine-graph.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `yaml-lite.js`: line tokenizer (strip comments after ` #`, refuse tabs), indentation stack, `- ` list items, `key: value`, `key:` opening a nested block, `key: |` block scalar collecting deeper-indented lines, `{ k: v, k2: v2 }` flow maps split on top-level commas, scalar typing (`true/false/null`, ints, quoted strings). Implement `graph.js` on top.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(engine): graph note parser with a YAML subset`.

### Task 3: `validate.js`

**Files:** Create `platform/engine/validate.js`; extend `run-engine-graph.js`.

**Interfaces:** `validateGraph(graph) → { ok, errors: [{ code, node?, edge?, message }] }`. Codes: `no_nodes`, `duplicate_id`, `unknown_type`, `missing_field`, `dangling_edge`, `bad_on`, `bad_max`, `unbounded_cycle`, `no_entry`.

Rules: `agent` needs `prompt` and `worker ∈ {claude-code, codex, fake}`; `judge` needs exactly one of `run`/`gate`; `shell` needs `run`; `human` needs `ask`; `end` needs nothing; `on` is `pass|fail|always|exhausted|<[a-z][a-z0-9-]*>`; `max` is an integer ≥ 1; entry nodes = nodes with no incoming edge (at least one required; several allowed); a cycle every edge of which lacks `max` is `unbounded_cycle` (DFS over edges without `max`).

- [ ] **Step 1:** Failing cases: valid minimal graph ok; duplicate id; edge to unknown node; agent without prompt; `on: PASS` refused; `max: 0` refused; cycle `a→b→a` without `max` refused; same cycle with `max: 1` on one edge accepted; graph with every node having an incoming edge refused `no_entry`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(engine): graph validator`.

### Task 4: `ledger.js` and `state.js`

**Files:** Create `platform/engine/ledger.js`, `platform/engine/state.js`; extend `run-engine-graph.js`.

**Interfaces:**
- `ledger.runsDir(vault) = <vault>/ranch/engine/runs`; `runPath(vault, runId)`; `appendEvent(vault, runId, event)` writes one JSON line (`ts` added) with `fs.appendFileSync`; `readEvents(vault, runId)` skips a trailing partial line; `listRuns(vault) → [{ run_id, graph_note, status, started_at, ended_at }]` derived by replaying each file (no index file).
- `state.reduce(graph, events) → state` (shape in the header); `state.readyNodes(graph, state)`; `state.matchEdges(graph, state, nodeId, outcome) → { fired: [edge], exhausted: [edge] }`.

Reducer rules: `run.created` seeds all nodes idle and marks entry nodes ready; `node.started` → running, attempts++; `node.finished` → finished with outcome/result, merges `result.vars` into `state.vars`, stores `results[id]`; `edge.fired` → increments count and marks `to` ready (and idle); `run.parked` → status parked; `human.answered` → status running, the node finished with the answered outcome; `run.halted` / `run.ended` → terminal. A `node.finished` for a node not `running` is ignored (Review Focus 3).

- [ ] **Step 1:** Failing cases: append then read round-trip; trailing garbage line ignored; `listRuns` on two files returns two entries sorted by `started_at` desc; reduce of created → ready = entry nodes; finished with `pass` + edge fired → next node ready; out-of-order `node.finished` ignored; `matchEdges` returns `exhausted` when count ≥ max.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(engine): append-only run ledger and state reducer`.

### Task 5: `vars.js` and `isolation.js`

**Files:** Create `platform/engine/vars.js`, `platform/engine/isolation.js`; extend `run-engine-graph.js`; smoke coverage for worktrees lands in Task 7.

**Interfaces:**
- `substitute(text, { run, vars, results, node }) → string`: `${run.id}`, `${vars.<k>}`, `${result.<nodeId>.<path>}`, `${node.id}`; unknown reference throws `VarsError`.
- `createWorktree({ repo, dest, branch, base }) → { path, branch }` (`git worktree add -b <branch> <dest> <base>`; if the branch exists, reuse); `removeWorktree({ repo, path })`; `sweep({ repo, runsDir })` removes worktrees whose run is terminal and whose branch has no commits ahead of `origin/main`; returns `{ removed: [], kept: [{ path, reason }] }`.

- [ ] **Step 1:** Failing vars cases: each token form; nested path `${result.claim.receipt.lease_token}`; unknown throws. Isolation: in a temp git repo with one commit, `createWorktree` creates a checkout on the branch; `removeWorktree` removes it; `sweep` keeps a worktree whose branch has an extra commit and removes a clean one.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(engine): variable substitution and worktree isolation`.

### Task 6: Workers and `nodes.js`

**Files:** Create `platform/engine/workers/{index,fake,claude-code,codex}.js`, `platform/engine/nodes.js`; extend `run-engine-graph.js` for fake + shell + judge + `outcome_from`.

**Interfaces:**
- `workers.resolveWorker(name) → { name, run({ prompt, cwd, timeoutMs, resultPath, env }) → { exitCode, stdout } }`.
- `workers.promptTail(resultPath)` returns the instruction block telling the agent to write `result.json` at that path with the `sauce.worker-result.v1` shape.
- `workers.publishResult(resultPath, obj)` writes `<resultPath>.tmp` then `renameSync`.
- `workers.readResult(resultPath) → result|null` (null when missing or unparsable or `schema` mismatch).
- `fake.run`: outcome from `node.fake` (`'pass'`, `'fail'`, or an array indexed by attempt) or env `SAUCE_FAKE_OUTCOME`; `node.fake_write_result === false` skips writing; `node.fake_vars` merges into result vars; also appends a line to `stdout.log`.
- `claude-code.run`: `spawnSync('claude', ['-p', prompt + tail, '--permission-mode', 'acceptEdits', '--max-turns', String(maxTurns)], { cwd, timeout })`; `codex.run`: `spawnSync('codex', ['exec', '--json', prompt + tail], ...)`. Adapters take the binary from `SAUCE_CLAUDE_BIN` / `SAUCE_CODEX_BIN` when set.
- `nodes.runNode(ctx, node) → { outcome, result }` where ctx = `{ vault, runId, runDir, repo, state, workerOverride, coordinator }`. `agent`: pick worker (override wins), resolve cwd (worktree or `cwd:` or repo or vault), write `prompt.md`, run, read result, `fail` on null. `judge`: `run:` via `spawnSync(cmd, { shell: true, cwd })` or `gate: adequacy` → `node scripts/autoloop/gate.js verify-adequacy --base origin/main --cwd <cwd> --json`; exit 0 → pass. `shell`: same spawn; `capture: json` parses stdout into `result.receipt`; `outcome_from: <path>` sets outcome from the receipt; exit non-zero → `fail`. `human`: returns `{ outcome: 'parked' }`. `end`: `{ outcome: node.outcome || node.id }`.

- [ ] **Step 1:** Failing cases: fake worker pass writes a valid result; `fake_write_result: false` → `readResult` null → `runNode` returns `fail` (Review Focus 4); shell node `run: "echo '{\"action\":\"waiting\"}'"` with `capture: json`, `outcome_from: action` → outcome `waiting`; judge `run: "exit 3"` → fail; `publishResult` leaves no `.tmp`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(engine): worker adapters and node execution`.

### Task 7: `scheduler.js`, `run.js`, smoke harness

**Files:** Create `platform/engine/scheduler.js`, `platform/engine/run.js`, `platform/engine/index.js`, `platform/test/run-engine-smoke.js`; register `test:engine-graph`, `test:engine-smoke` in `package.json` and `preflight-manifest.json` (parallel lane).

**Interfaces:**
- `run.resolveVaultForNote(notePath) → vaultPath|null` (walk ancestors for `ranch/platform-config.json`).
- `run.createRun({ vault, notePath, repo?, workerOverride?, dryRun? }) → { runId, state }`: parse + validate, `run.created` event with `graph_hash` (sha256 of the block), mkdir `ranch/engine/runs/<runId>/`.
- `scheduler.tick(ctx) → receipt` where ctx = `{ vault, runId, notePath, graph, workerOverride, coordinator }`: loop: reduce → if terminal/parked/halted stop → if the note frontmatter says `status: halted` append `run.halted` and stop → for each ready node: `node.started`, `runNode`, `node.finished` → for each matched edge `edge.fired`; exhausted edge → outcome `exhausted` re-evaluated once; outcome with no edge → `run.ended` with that outcome mapped (`pass` → `done`, `fail` → `failed`, else named). `human` → `run.parked`, projection writes the checkbox, stop.
- `scheduler.follow(ctx, { intervalMs })` → repeats `tick` until terminal, re-reading the projection for human answers between ticks.
- Receipt: `{ ok, run_id, status, nodes: {id: outcome}, parked?, ledger, worktrees: [] }`.

- [ ] **Step 1:** Failing smoke cases in a temp vault (write `ranch/platform-config.json`) and temp git repo: graph A = `implement (agent fake: [fail, pass]) → verify (judge run: "test -f done.txt" ... )` simplified to: `plan (agent fake pass, fake_vars {topic: x}) → build (agent fake [fail, pass], isolate worktree) → check (judge run "true")` with edge `check→build on: fail max: 1` and `build→build`? Use: edges `plan→build`, `build→check`, `check→build on: fail, max: 1`. Assertions: run reaches `done`; `build.attempts === 2`? (make check fail first: `check` run `test -f ok.txt` and the fake for build writes `ok.txt` on attempt 2 via `fake_touch: ok.txt`); handoff payload: `build`'s `prompt.md` contains `plan`'s summary; worktree created under `<repo>/.worktrees/sauce/<run>-build`; ledger has exactly one `run.ended`; a second `tick` on a done run is a no-op (Review Focus 2 precondition).
- [ ] **Step 2:** FAIL. **Step 3:** Implement scheduler/run/index. **Step 4:** PASS. **Step 5:** Commit `feat(engine): scheduler, run lifecycle, smoke harness`.

### Task 8: `projection.js` (note surface, human nodes, halt)

**Files:** Create `platform/engine/projection.js`; extend smoke harness.

**Interfaces:**
- Markers: `<!-- @sauce:runs BEGIN -->` / `<!-- @sauce:runs END -->` under a `## Runs` heading appended if absent.
- `writeProjection(notePath, state, graph)`: rewrites the marker region with one line per node `- <glyph> \`<id>\` <type> · <outcome or status> · attempts <n>` (glyphs: `○` idle, `◐` running, `●` finished pass, `✕` fail/named, `⏸` parked), the human line as `- [ ] run:<runId> node:<id> — <ask>` (or `- [x]`), and sets frontmatter `status:` to the run status; write via temp+rename.
- `readHumanAnswers(notePath) → [{ runId, node, checked, decision }]` parsing `- [x] run:<id> node:<n> … (decision: <word>)?`.
- `applyHumanAnswers(ctx)`: for a parked run whose line is checked, append `human.answered { node, outcome: decision || 'pass' }`; ignored when the ledger status is not `parked` (Review Focus 2).
- `isHalted(notePath)`: frontmatter `status: halted`.

- [ ] **Step 1:** Failing cases: graph B adds `ship (human ask)` after `check`; after tick the note contains the marker section, an unchecked box, frontmatter `status: parked`; ticking the box and running `tick` again ends the run `done`; ticking a box on an already-done run appends nothing; setting `status: halted` before a tick appends `run.halted` and runs nothing; the marker region is rewritten idempotently (second write byte-identical).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(engine): note projection and human nodes`.

### Task 9: launchd template + installer

**Files:** Create `platform/engine/sauce-engine.plist.sample`, `platform/engine/launchd.js`; smoke case; delete `sauce-autoloop.plist.sample` (only in this task, after the new sample exists).

**Interfaces:** `renderPlist({ user, home, nodePath, cliPath, notePath, slug, intervalSeconds }) → string`; `install({ notePath, intervalSeconds })` writes `~/Library/LaunchAgents/com.<user>.sauce-run.<slug>.plist` and `launchctl load -w`; `uninstall({ notePath })`. Template placeholders `{{$user}}`, `{{$home}}`, `{{$node_path}}`, `{{$cli_path}}`, `{{$note_path}}`, `{{$slug}}`, `{{$interval}}`; ProgramArguments = node, cli, `run`, note, `--follow`, `--json`; logs to `~/Library/Logs/sauce-run.<slug>.{log,err}`.

- [ ] **Step 1:** Failing case: `renderPlist` output contains the label, the note path, and no `{{$` residue; XML is well-formed by a regex check on balanced `<dict>`/`</dict>`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; `git rm sauce-autoloop.plist.sample`. **Step 4:** PASS. **Step 5:** Commit `feat(engine): launchd template and installer; retire sauce-autoloop.plist.sample`.

### Task 10: `sauce run` verb

**Files:** Create `platform/cli/cmd-run.js`; modify `platform/cli/sauce-cli.js` (add `run` to `VERBS`; special-case before `resolveContext` like `doctor`), `platform/cli/cmd-help.js` (verb row + example); smoke CLI cases via `execFileSync(process.execPath, [cli, 'run', ...])`.

**Interfaces:** `run(ctx, args)`; flags `--follow`, `--dry-run`, `--worker <name>`, `--status`, `--list`, `--sweep`, `--json`, `--interval <s>`, `--install-launchd`, `--uninstall-launchd`, `--repo <path>`. Note argument: absolute, cwd-relative, or vault-relative. Exit codes: 0 done/parked/listed, 1 failed, 2 usage/refusal. `--json` prints the receipt only.

- [ ] **Step 1:** Failing cases: run from `os.tmpdir()` with an absolute note path resolves the vault (Review Focus 5); `--dry-run --json` prints `{ ok: true, plan: [...] }` and writes no ledger; `--worker fake --follow --json` completes graph A; `--status --json` reports the latest run; `--list --json` lists it; unknown note → exit 2 with a message.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(cli): sauce run`.

### Task 11: The `engine` mechanism and installer heal

**Files:** Create `platform/mechanisms/engine/manifest.json`, `commands/sauce.md`, `skills/run/SKILL.md`, `templates/Sauce Graph.md`, `platform/engine/schemas/*.json`; modify `platform/manifest.json` (catalogue entry `engine@0.1.0`), `ranch/platform-subscription.json` and `platform/test/seed-vault/ranch/platform-subscription.json` (add `engine`), `platform/install.js` (heal after the subscription read), `platform/schemas-index.json` (three entries), `platform/mechanisms/platform-claude/manifest.json` description (formally always-on). Create `platform/test/run-engine-install.js`.

Manifest:

```json
{
  "name": "engine",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Sauce's node-based agent execution engine: the /sauce launcher, the engine:run skill, the Sauce Graph template, and the ranch/engine run ledger. Always-on: the installer subscribes every vault.",
  "skills_dir": ".claude/skills/engine",
  "depends_on": [],
  "files": [
    { "source": "templates/Sauce Graph.md", "dest": "{{templates_path}}/Sauce Graph.md" },
    { "source": "ranch/README.md", "dest": "ranch/engine/README.md" }
  ],
  "claude_surface": [
    { "kind": "command", "source": "commands/sauce.md", "dest": ".claude/commands/sauce.md" },
    { "kind": "skill", "source": "skills/run/SKILL.md", "dest": "{{skills_dir}}/run/SKILL.md" },
    { "kind": "claude_md_row", "table": "resolvers", "row": { "topic": "Sauce", "path": ".claude/commands/sauce.md", "command": "/sauce" } }
  ],
  "post_install": [ { "type": "notice", "message": "engine@0.1.0 installed. /sauce and `sauce run <note>` are available." } ],
  "rule_fragments": []
}
```

Heal (`platform/install.js`, right after the subscription is read and before dependency resolution):

```js
const ALWAYS_ON_MECHANISMS = ["platform-claude", "engine"];
function ensureAlwaysOnMechanisms(subscription, manifest, history, git) {
  const added = [];
  for (const name of ALWAYS_ON_MECHANISMS) {
    const cat = (manifest.mechanisms || []).find((m) => m.name === name);
    if (!cat) continue;
    if ((subscription.mechanisms || []).some((m) => m.name === name)) continue;
    subscription.mechanisms = subscription.mechanisms || [];
    subscription.mechanisms.push({ name, version: cat.version });
    added.push(`${name}@${cat.version}`);
  }
  if (added.length) history.push({ event: "heal", step: "always_on_subscription", message: `subscribed ${added.join(", ")}`, git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  return added;
}
```

then `await writeJson(app, "ranch/platform-subscription.json", subscription)` when `added.length`.

- [ ] **Step 1:** Failing install cases (temp vault, `platform/install.js` via the existing `run-install.js` style harness): subscription without `engine` gets it appended with the catalogue version and a `heal` history row; a subscription already listing it is unchanged (byte-identical file); after install `.claude/commands/sauce.md`, `.claude/skills/engine/run/SKILL.md`, `ranch/templates/Sauce Graph.md`, `ranch/engine/README.md` exist; `ranch/claude-surface-registry.json` has the three rows; `npm run lint-schemas` passes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS; `node scripts/check-version-sync.js` green. **Step 5:** Commit `feat(engine)!: always-on engine mechanism with /sauce and the graph template`.

### Task 12: `sauce audit --engine`

**Files:** Modify `platform/cli/cmd-audit.js` (flag + walker + help text); `platform/mechanisms/audit/commands/audit.md` and `skills/drift/SKILL.md` (mention the engine pass); extend `run-engine-install.js`.

Findings: `engine_dir_missing` HIGH, `engine_surface_missing` HIGH (command/skill/template absent), `engine_surface_stale` MEDIUM (deployed body ≠ workshop source), `engine_ledger_unparsable` MEDIUM, `engine_worktree_orphan` LOW (ledger references a worktree path that no longer exists), `engine_version_drift` MEDIUM (installed ≠ catalogue). Read-only; JSON footer like the other passes.

- [ ] **Step 1:** Failing cases: clean install → zero findings; delete the command → `engine_surface_missing`; corrupt a ledger line → `engine_ledger_unparsable`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5:** Commit `feat(audit): engine install walker`.

### Task 13: The shipped `delivery-slice` graph and mayo opt-in

**Files:** Create `platform/engine/graphs/delivery-slice.md`, `platform/test/run-engine-delivery-graph.js`, `platform/test/fixtures/engine/stub-coordinator.js`; modify `plugins/mayo/skills/run/SKILL.md` (Engine mode section), `plugins/mayo/skills/status/SKILL.md` (list engine runs), `plugins/mayo/.claude-plugin/plugin.json` (description), `plugins/mayo/README.md`; register the test.

Graph nodes (all coordinator calls are `shell` nodes with `capture: json`; `${vars.coordinator}` and `${vars.gate}` are seeded by `sauce run --var coordinator=<path>`; `--var` is added to `cmd-run.js` here):

| id | type | run / prompt | outcome_from | edges |
| --- | --- | --- | --- | --- |
| `claim` | shell | `node ${vars.coordinator} claim --json` | `action` | `claim → implement`; `no-work`, `at-capacity`, `halted`, `all-work-leased` → `end:<same>` |
| `implement` | agent (worker per `${vars.worker}`, `cwd: ${result.claim.receipt.worktree}`) | implement the slice within touch zones, regression test first | | `→ adequacy` |
| `adequacy` | judge `gate: adequacy` with `cwd` | | | `pass → lens-correctness`; `fail → implement, max: 1`; `exhausted → supersede` |
| `lens-correctness`, `lens-regression`, `lens-adequacy` | agent (read-only prompt, `isolate: none`) | | | each `pass → record-<lens>`; `fail → record-<lens>` (verdict carried) |
| `record-<lens>` | shell `record-review --lens <lens> --verdict ${result.lens-<lens>.outcome} --summary "${result.lens-<lens>.summary}" --head ${result.lens-<lens>.head} --lease-token ${result.claim.receipt.lease_token} --json` | `verdict` | `pass → next lens / verify-gates`; `fail → implement, max: 1`; `exhausted → supersede` |
| `verify-gates` | shell | `action` | `gates-passed → pr`; `fail → implement, max: 1` |
| `pr` | shell (push + `gh pr create` + `record-pr`) | | `→ advance` |
| `advance` | shell `advance --lease-token … --lease-seconds 600 --json` | `action` | `phase-change → advance`; `waiting → wait`; `fix-ci → fix-ci`; `refresh-feature → refresh`; `deploy → advance`; `complete → end:done`; `completion-projection-failed`, `blocked`, `blocked-external`, `needs-inspection`, `deploy-failed` → `end:<same>` |
| `wait` | shell `sleep ${vars.wait_seconds}` | | `→ advance` |
| `fix-ci`, `refresh` | agent (repair in the worktree) | | `→ verify-gates` |
| `supersede` | human `ask: second refutation; supersede via /mayo:intake?` | | `pass → end:superseded` |

Note the deliberate limit: `advance → advance` on `phase-change` is a self-edge with `max: 40`, which is the budget the old plist gave a turn.

- [ ] **Step 1:** Failing cases: the shipped graph parses and validates; every `action:` literal the coordinator's `advance` path can return (extracted from `scripts/autoloop/codex-coordinator.js` by regex over `action: '<x>'` restricted to the set `{phase-change, waiting, fix-ci, refresh-feature, deploy, complete, completion-projection-failed, blocked, blocked-external, needs-inspection, deploy-failed}`) appears as an `on:` edge out of `advance`; the stub coordinator (a script returning scripted receipts per verb from a JSON file) drives a full fake run `claim → … → complete` to `done`; a stub scripting `at-capacity` ends the run `at-capacity` without running `implement`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement graph + stub + `--var`. Add to `mayo:run` an "Engine mode (opt-in)" section: `sauce run "<plugin_root>/../platform/engine/graphs/delivery-slice.md" --var coordinator=<coordinator> --var gate=<gate> --var worker=claude-code --follow --json` from the bound repo, and the rule that the default prose pipeline stays until one live epic completes cleanly through the graph and its ledger has been diffed against a coordinator run of the same shape. **Step 4:** PASS; `npm run test:mayo-plugin-surface` and `test:mayo-codex-routers` green. **Step 5:** Commit `feat(mayo): opt-in engine mode on the shipped delivery-slice graph`.

### Task 14: Worktree sweep (D5) and dogfood self-install

- [ ] **Step 1:** `git worktree prune` (the 7 dangling `/var/folders` entries). For each `.worktrees/codex-autoloop-*`: `git -C <wt> status --porcelain`; clean → `git worktree remove <wt>`; dirty (`perf-9a`) → keep and list.
- [ ] **Step 2:** `git branch -d codex-autoloop/ga-ml8-installer-log-relocation-and-stale-script-prune` (merged). List the 15 unmerged branches in the result doc for the Director; delete none.
- [ ] **Step 3:** `node platform/install.js --auto-approve` style dogfood: run the workshop self-install the way `release:preflight` does, confirm `.claude/commands/sauce.md` and `ranch/engine/README.md` land in the workshop, and `ranch/platform-subscription.json` still lists `engine` once.
- [ ] **Step 4:** Commit `chore(worktrees): sweep clean codex-autoloop worktrees; dogfood engine surface`.

### Task 15: Docs and marketing

**Files:** Modify `README.md`; create `Docs/engine.md`, `Docs/comparison.md`, `CHANGELOG.md`, `Docs/marketing/launch-post.md`, `Docs/plans/2026-09-22-v0.292.0-engine-reintegration-plan.md` (pointer to this plan), `Docs/plans/2026-09-22-v0.292.0-engine-reintegration-release-note.md`; modify `Docs/Index.md`, `CLAUDE.md` (router rows outside markers: `Docs/agent-guides/engine.md` pointer), create `Docs/agent-guides/engine.md` (short agent guide: where the runtime lives, invariants, harness names), modify `Docs/agent-guides/{architecture,mayo-plugin,cycle-status}.md`, `Docs/cycle-history.md` (appended at close in Task 16), `Docs/use.md` (CLI verb row), `Docs/how.md` (CLI table row).

Content rules from the Director: README top keeps "Obsidian but with the Sauce."; one sentence for an engineer evaluating agentic tooling; what it is (2 sentences); a 30-second walkthrough of one task; install; plugins (mayo); then the existing vault-platform material; honest pre-1.0 and solo-developed; "How it works" Mermaid diagram (note → graph → dispatcher → isolated workers (Claude Code / Codex) → results back in the vault). `Docs/engine.md`: problem, the minimal graph in real syntax, node and edge reference, scheduling (launchd sample) and isolation model, limitations, and a **real ledger excerpt** copied from a smoke run on this machine. `Docs/comparison.md`: Gas Town, beads-superpowers, plain Claude Code loops; fair; borrowed vs different. Launch post: 200 words, casual, no em dashes, no "revolutionary"/"supercharge", leads with the problem it solved.

- [ ] **Step 1:** Run `node platform/cli/sauce-cli.js run <temp graph> --worker fake --follow --json` against a temp vault and copy 8 to 12 ledger lines verbatim into `Docs/engine.md`.
- [ ] **Step 2:** Write every file above. `npm run lint-display-markers`, `lint-note-chrome`, `lint-schemas` green.
- [ ] **Step 3:** Commit `docs(engine): README repositioning, engine reference, comparison, launch post, changelog`.

### Task 16: Verification, GitHub metadata, cycle close

- [ ] **Step 1:** `npm run release:preflight` green (record counts); `npm run release:check-bump` on the intended PR title `feat(engine)!: node-based agent execution as the core of Sauce`.
- [ ] **Step 2:** `gh repo edit willfell/sauce --description "Agentic operating loop for Obsidian: node-based agent execution, versioned vault platform, shipped via Homebrew"` (D7). Topics to list for the Director: `claude-code, ai-agents, agentic-workflows, mcp, automation, developer-tools, obsidian, codex, homebrew, knowledge-management`.
- [ ] **Step 3:** Write `Docs/plans/2026-09-22-v0.292.0-engine-reintegration-result.md`, append `Docs/cycle-history.md`, update `cycle-status.md` (Current, Mechanisms table, harness count, in-flight queue), `Docs/landmines.md` history block only if a new trap surfaced.
- [ ] **Step 4:** Commit `docs(cycle): close engine reintegration`. Do not push.
