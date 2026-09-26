# Engine reintegration: node-based agent execution as the core of Sauce (design)

**Cycle:** 2026-09-22 · **Version:** workshop 0.291.1 → next `feat!` minor · **Status:** Phase 1 proposal, awaiting Director approval · **Session:** `sauce-plugin-mktng-refactor`

This is the Phase 1 deliverable: archaeology, inventory, engine description, and the integration design. Nothing outside this file was written. When approved, Phase 2 creates the dated `-plan.md` and `-result.md` siblings under the normal `Docs/plans/<date>-v<X.Y.Z>-engine-reintegration-*` naming; this undated file stays as the design of record and is deliberately outside the `2026-*` glob that the session-start missing-sibling check scans.

---

## 0. The one finding that shapes everything else

**The node-based engine could not be located.** The task text names it as `[OTHER_REPO]` at `[LOCAL_PATH_OR_GITHUB_URL]`; both placeholders arrived unfilled. I searched, in order:

| Where | What I looked for | Result |
| --- | --- | --- |
| `willfell/sauce` full history (3036 commits, all branches, tags, stash, 14 worktrees) | `node_type`, `edges`, `nodes:`, `handoff_to`, `-i --grep engine` | Zero hits outside the project blueprint's **GraphView** (a renderer for the existing `depends_on` DAG) and the to-do filter view. |
| `willfell/wac.plugins` (where the loop went on 2026-09-01) | its full log | The loop plugin moved there verbatim and came back as `mayo` on 2026-09-11. No graph engine. |
| Every repo under `~/Documents/GitHub`, `~/Documents/old-repos`, `~/obsidian/*`, `~/.pulse`, `~/.claude-orchestrator` | typed-node / edge / handoff language, dirs named engine/graph/dispatch | `pulse` (briefings + launchd jobs) and `wac.lab.remote` (Claude process monitor) are the only orchestration-adjacent code; neither is a work graph. |
| All 29 repos on the `willfell` GitHub account and the `atlas-trading-app` org | names + descriptions | Nothing graph- or engine-shaped. |
| The vault R&D projects `sauce-ai-loop-system` and `meta-board-loop-system-rnd` (60+ design notes) | the same terms + any pointer to another repo | Every `node` is Node.js, every `edge` is a `depends_on` edge, every `graph` is the dependency DAG. The only "other repo" pointers are aspirational (`willfell/delivery-plugins`, never created) or third-party (`gastownhall/beads`). |

So the honest description of "the node-based engine as it exists now" is: **it does not exist in any place this machine or this account can see.** What does exist is a flat phase machine (`claimed → feature_pr → feature_merged → release_pr → tagged → tap_pr → deployed`, plus `parked`, `adopted`, `discarded`) owned by the 13k-line `codex-coordinator.js`, driving one card at a time through worktrees, gates, and a three-lens review quorum. That is the substrate the graph engine generalizes.

**Decision for you (D0):** either (a) give me the real path or URL, and Phase 2 imports that code into the location proposed in § 5 and diffs it against § 4, or (b) confirm there is no separate implementation and Phase 2 builds § 4 as the MVP. Everything below is written to hold under both answers; § 4 is the contract either way.

---

## 1. Archaeology: the loop-based execution

### 1.1 Timeline

| Date | Commit | Event |
| --- | --- | --- |
| 2026-05-15 | `5edbfb36`, `a4d4998f` | **`/sauce-pipeline`** designed: "endless self-pacing loop over the project board", human picks the card. 22 hand-driven rounds through 2026-05-19, then `PAUSED FOR SCOPE` (`5945dd42`). Never formally retired. |
| 2026-06-27 | `ffefe51a` (#57) | **`/sauce-autoloop` increment 1.** `.claude/commands/sauce-autoloop.md`, `sauce-autoloop.plist.sample`, `scripts/autoloop/{select-card,render-handoff}.js`. One non-interactive turn per launchd fire. |
| 2026-06-28 | `0b919134`, `1d2067a7` | `reconcile-inflight.js` (git/PR is truth, never the board); the **Scout** and the first `autoloop-queue.md`. |
| 2026-06-29 | `0f79ac3a` (#68) | **Gate B**: `gate.js` mutation check + the three-lens adversarial panel (correctness / regression / test-adequacy). |
| 2026-06-30 | `70135fec`, `db2293bd` | Per-turn **git worktree isolation** + `turn-lock.js`; `deploy.js` per-vault deployment. |
| 2026-07-14 | `7005be1c` (#512) | **`codex-coordinator.js`**: deterministic state leaves the prompt. Claims, touch zones, ledger at `<git-common-dir>/sauce-autoloop/state.json`, release ancestry, brew promotion. |
| 2026-07-21 | `f64561dd`, `b5f65971` | `/delivery-review` and `/delivery-status` skills (triage, ratify, digest). |
| 2026-07-25 | `f0e679c9` (#615) | **Epic-centric board**: two-level topology, `discarded` tombstones, supersede-at-mint, retroactive digest. `Docs/agent-guides/delivery-board.md`. |
| 2026-07-26 | `07f13ebf` (#641) | **Meta-loop plugin**: `plugins/loop/` (9 skills), `.claude-plugin/marketplace.json`, `.loop/config.json` binding, `loop-config.js` resolver, Codex routers. |
| 2026-08-03 | `caba2c4a` (#729) | Per-card **session leases** (`lease_token`, 2h TTL, `break-lease`). |
| 2026-08-04/05 | `9fe27be0`, `5abaa316`, `48830105` | **Loop-integrity program** workstreams 1 to 3: board-health sweep, one source of truth, the `adopt` escape hatch. Workstream 4 (durable ledger) still open. |
| 2026-09-01 | `f2816c2d` (#809) | Marketplace retired; `plugins/loop` **moved to `willfell/wac.plugins`**; `loop-config.js` kept in `scripts/autoloop/` as a hand-synced twin. |
| 2026-09-11 | `09262a5d` (#847), `ce9fe3ab` (#849) | Plugin **moved back as `plugins/mayo`** (`brainstorm` → `propose`, `.loop/` unchanged); resolver twins collapsed; `plugin_root` validated. |

The final turn handoff is `Docs/prompts/2026-07-04-sauce-autoloop-turn-159-handoff.md`; 159 turns ran under the fat command. `launchctl list` on this machine shows **no** `com.will.sauce-autoloop` job today; only `com.willfell.sauce-board-health.sauce` (hourly, installed by `board-health-launchd.js`) is loaded. The coordinator ledger was last written 2026-09-12. The loop today is driven interactively through `/mayo:run`, not by cron.

### 1.2 What it was, in one paragraph

Work enters as a card carrying a Delivery execution contract (`touch_zones`, `depends_on`, `model_profile`, `batch_policy`, `deploy_subscriptions`, acceptance tests), minted only by `card-intake.js`. The coordinator is the only operational writer: it selects the frontier slice of the highest-priority eligible epic from the Kanban board's drag order, claims it into a `codex-autoloop/<slug>` worktree, and moves it through phases. Done is decided by receipts, never by the board or by chat: a regression test proven to fail without the change (Gate B), three sequential read-only review lenses at an exact head with one same-card repair allowed, `verify-gates`, a merged PR, a containing release by git ancestry, a tag, a tap PR, `brew upgrade`, and a green deploy receipt in each subscribed vault. Humans touch it in Obsidian through the board (a projection the coordinator repaints), the epic dashboard, the phone-sized `/mayo:status` digest, and the retroactive `/mayo:review` walk. Refuted twice, a slice is superseded at mint and its predecessor discarded to a tombstone.

---

## 2. Inventory: loop machinery still in the repo

| Path | What it is | Class | Disposition in Phase 2 |
| --- | --- | --- | --- |
| `.loop/config.json` | The binding: vault, board, prefix, policy, coordinator, `codex.plugin_root` | **LIVE** | Keep. The engine reads it when a graph note omits `repo:`/`vault:`. |
| `plugins/mayo/**` (9 skills, `gen-codex-routers.js`, forwarder `loop-config.js`) | The current skill surface | **LIVE** | Keep; becomes a consumer of the engine (§ 5.4). |
| `.claude-plugin/marketplace.json` | Sauce's marketplace, lists `mayo` only | **LIVE** | Keep. |
| `.agents/skills/mayo-*/` (9 routers) | Generated Codex routers | **LIVE** | Keep; regenerate if the skill set changes. |
| `.agents/skills/card-intake/scripts/card-intake.js` | The only planning writer | **LIVE** | Keep (path contract: coordinator tree must contain `.agents/`). |
| `.agents/skills/{card-intake,slice-plan,sauce-autoloop}/SKILL.md` | Deprecation aliases pointing at `.agents/skills/loop-intake` and `loop-run` | **DEAD (broken)** | Delete the three alias bodies. Those targets never existed after the rename. |
| `scripts/autoloop/codex-coordinator.js` + `loop-config.js`, `gate.js`, `select-card.js`, `deploy.js`, `delivery-paths.js`, `delivery-status-digest.js`, `delivery-review-triage.js`, `delivery-review-ratify.js`, `cli-kit.js`, `batch-runner.js`, `turn-lock.js`, `sweep-worktrees.js`, `audit-delivery.js`, `analyze-workstreams.js`, `board-health-launchd.js` | The coordinator family | **LIVE** | Keep. Resolved from brew libexec at runtime. The engine reuses `gate.js` (judge nodes) and `sweep-worktrees.js`. |
| `scripts/autoloop/{scout-signals,bughunt,board-mirror,block-note,render-handoff,reconcile-inflight}.js` | Increment 1/2b Scout + handoff helpers | **DEAD (test-pinned)** | Delete, with their cases in `platform/test/run-autoloop-select.js` and the `autoloop-select` preflight entry. Only `.claude/commands/sauce-autoloop.md` calls them. |
| `autoloop-queue.md` (root, 23 KB, every item `done`) | Scout queue; read by `select-card.js:568`, allowlisted by `gate.js:78`, no live writer | **HALF-MIGRATED** | Delete; remove the queue-drain branch from `select-card.js` and the filename special case from `gate.js`. |
| `sauce-autoloop.plist.sample` | 2h launchd template running `/sauce-autoloop --dry-run`, hardcoded home path | **DEAD** | Delete. Replaced by `sauce run --install-launchd` (§ 4.7). Remove the four `.autoloop*` `.gitignore` lines. |
| `.claude/commands/sauce-autoloop.md` (24 KB) | The pre-plugin one-turn loop; absolute paths | **HALF-MIGRATED** | Delete. `mayo-plugin.md` says it stays "until `/mayo:run` is validated"; it is not scheduled anywhere and has not turned since 2026-07-04. |
| `.claude/commands/sauce-pipeline.md` | Two generations older than the above | **DEAD** | Delete. |
| `.claude/commands/delivery-review.md`, `delivery-status.md` | Deprecation stubs that redirect to `loop@wac-plugins`, which no longer exists | **HALF-MIGRATED (wrong target)** | Delete; `mayo-plugin.md` already documents the alias mapping. |
| `scripts/sauce`, `scripts/activate.sh` | Untracked self-bootstrap shims with a stale `/var/folders/...` `SAUCE_VAULT` | **DEAD** | Not tracked; leave for the user, note in result doc. |
| `.local/mechanisms/smart-connections-bridge/sc-bridge.js` | A tracked local overlay, no subscription or ignore rule covers it | **ANOMALY** | Ask (D6). Not loop-related; surfaced by the sweep. |
| `.worktrees/codex-autoloop-*` (14) + 16 `codex-autoloop/*` branches | Stale per-slice checkouts | **DEAD (runtime)** | Sweep with `sweep-worktrees.js`, branches only where no PR/worktree guard trips. **Destructive, local: needs your yes (D5).** |
| `platform/mechanisms/delivery/` (v0.7.0) | Execution-contract core installed to `ranch/content/delivery/` | **LIVE** | Keep; the engine's `delivery-slice` graph consumes it. |
| `Docs/agent-guides/{mayo-plugin,delivery-board}.md` | Current runbooks | **LIVE** | Update the "live cron loop still runs `/sauce-autoloop`" sentence. |
| `Docs/plans/2026-06-2*-sauce-autoloop-increment-*`, `Docs/prompts/*-sauce-autoloop-turn-*` | History | **ARCHIVAL** | Keep. |
| `ranch/`, `.github/workflows/*` | Consumer plumbing, CI | **LIVE** | Contain zero loop references. The loop was never materialized into consumer vaults; that is the gap § 5 closes. |

---

## 3. Closest existing substrate, mapped onto graph vocabulary

Because § 0 found no separate implementation, this section records what the coordinator already does in graph terms so Phase 2 can reuse rather than reinvent.

| Graph concept | Existing implementation | Reuse |
| --- | --- | --- |
| Node = bounded step with a verdict | Coordinator phases; `gate.js verify-adequacy`; the three review lenses recorded via `record-review` | `judge` nodes call `gate.js`; the lens pattern becomes three `agent` nodes with `on: fail` retry edges. |
| Edge with retry budget | "one same-card repair, then supersede"; `supersession-depth` ceiling | `max:` on an edge; `exhausted` outcome routes to a park/supersede node. |
| Handoff between agents | Navigator (Claude) drafts, Executors (Codex) implement and review; `model_profile` per card | `worker:` per node; the upstream `result.json` is the handoff payload. |
| Isolated worker | `.worktrees/codex-autoloop-<slug>` on `codex-autoloop/<slug>` | Same mechanics under `.worktrees/sauce/<run>-<node>`; `sweep-worktrees.js` reused. |
| Structured worker result | LS-10 dispatch protocol: `codex exec --json --output-schema worker-result.schema.json` | The engine's `sauce.worker-result.v1` schema is that shape, trimmed. |
| Durable state | `<git-common-dir>/sauce-autoloop/state.json` (per clone; workstream 4's open problem) | The engine ledger lives in the **vault** (`ranch/engine/runs/`) so Obsidian Sync carries it. |
| Scheduler | `board-health-launchd.js` renders a plist per bound repo | `sauce run --install-launchd` renders the same way. |
| Human touchpoint | Board drag order, `/mayo:status`, ratification sections | `human` nodes park on a checkbox in the graph note; `## Runs` projection. |
| Binding | `.loop/config.json` → env via `loop-config.js` | The engine reads the same binding for defaults. |

---

## 4. The engine as it will exist in Sauce

### 4.1 Vocabulary

| Term | Meaning |
| --- | --- |
| **Graph note** | An Obsidian note with `type: sauce-graph` frontmatter and one fenced ` ```sauce ` block. The note is the unit of work; the block is the graph. |
| **Node** | A typed step: `agent`, `judge`, `shell`, `human`, `end`. |
| **Edge** | Directed `from → to` with an `on:` condition (`pass`, `fail`, `always`, or a named outcome) and an optional `max:` traversal budget. |
| **Run** | One execution of a graph note: a run id, a ledger file, a worktree set, and a projection back into the note. |
| **Worker** | The process behind an `agent` node: `claude-code`, `codex`, or `fake` (the test double). |
| **Tick** | One scheduler pass: collect finished nodes, evaluate edges, start every node whose inputs are satisfied. |

### 4.2 A minimal graph in real syntax

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
    prompt: |
      Review the diff on this branch for correctness and test adequacy.
      Answer PASS or FAIL with one paragraph of reasons.
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

This shows the three things the engine exists for: an agent handoff (`implement` on Claude Code, `review` on Codex), a retry edge with a budget, and a human node that parks the run until someone answers in Obsidian.

### 4.3 Node types

| Type | Executes | Done when | Outcome |
| --- | --- | --- | --- |
| `agent` | Spawns a worker in the node's isolation scope with `prompt` plus the upstream node's result as context. | The worker exits **and** `result.json` exists in the node's run directory (published by rename, never partial). | `pass` / `fail` / a named outcome the worker writes. Missing or malformed result = `fail`. |
| `judge` | A deterministic command (`run:`) or a named gate (`gate: adequacy` calls `scripts/autoloop/gate.js verify-adequacy`). | The command exits. | Exit 0 = `pass`, else `fail`. |
| `shell` | A command with no verdict semantics (build, push, open a PR, call a coordinator verb). `capture: json` stores stdout into run variables. | Exit 0. | `pass`; non-zero = `fail`. |
| `human` | Writes `ask:` into the note's `## Runs` section as a checkbox line and parks the run. | The box is ticked, or `decision:` is set on the run line. | `pass` / `fail` / named. |
| `end` | Nothing. Names a terminal state (`done`, `abandoned`). | Immediately. | The run's final status. |

Implicit rule: a node whose produced outcome has no matching outgoing edge ends the run with that outcome. The minimal graph therefore needs no explicit `end`.

### 4.4 Edge semantics

- `on:` defaults to `pass`. `always` fires regardless. A named outcome (`on: needs-design`) matches a worker that wrote `"outcome": "needs-design"`.
- `max:` is a per-edge traversal budget for the run. Exceeding it produces the outcome `exhausted` on the **source** node, which follows an `on: exhausted` edge if one exists or ends the run as `failed`.
- Several edges from one node may match; all fire (fan-out). A node with several incoming edges starts when **any** one fires. Join semantics (`wait: all`) are a follow-up.
- A handoff is nothing special: an edge between two `agent` nodes. The target worker receives the source's `result.json` (summary, artifacts, branch head) as context; different `worker:` values are how one agent hands to another.
- Cycles are allowed only through edges that carry `max:`. The validator refuses a graph with an unbounded cycle.

### 4.5 How a run starts

```bash
sauce run "spice/projects/sauce/graphs/fix-flaky-harness.md"   # one tick, then exit
sauce run <note> --follow            # keep ticking until a terminal or human node
sauce run <note> --dry-run           # validate and print the plan; no side effects
sauce run <note> --worker fake       # every agent node uses the test double
sauce run <note> --status            # read-only projection of the latest run
sauce run <note> --install-launchd   # follow-up: unattended cadence
```

`sauce run` resolves the vault from the note's own ancestors first (a graph note always lives in a vault), then the usual cwd walk and `SAUCE_VAULT`. It validates the block against the registered `sauce.graph.v1` schema, assigns a run id (`<slug>-<yyyymmdd-hhmmss>`), writes the ledger, and executes the first tick. `/sauce <note>` in Claude Code is a thin command that shells to `sauce run` and reads the JSON receipt; `/sauce` alone lists the vault's graph notes and their latest run.

### 4.6 State

- **Authoritative:** `ranch/engine/runs/<run-id>.json` in the vault, written by temp+rename on every transition: node states, outcomes, edge traversal counts, worktree paths, worker pids, captured variables, result payloads.
- **Projection:** a marker-bounded `## Runs` section in the graph note, rewritten per tick, one line per node with a status glyph, plus the `human` checkboxes. The note's `status:` frontmatter mirrors the latest run.
- **Artifacts:** `ranch/engine/runs/<run-id>/<node-id>/{prompt.md,result.json,stdout.log}`.

The ledger lives in the vault rather than in the repo's `.git/` so Obsidian Sync carries it and a run started on one machine is visible on another. This is the opposite of the coordinator's per-clone choice, which loop-integrity workstream 4 already named the rail's weakest point. **Decision D3** asks you to confirm.

### 4.7 Scheduling

MVP is in-process: one tick per `sauce run`, or `--follow` for a polling loop (30 s default) that ends at a terminal or `human` node. Unattended cadence is a follow-up that reuses `board-health-launchd.js`'s pattern: `--install-launchd` renders `~/Library/LaunchAgents/com.willfell.sauce-run.<slug>.plist` from a template under `Docs/install/`, `--uninstall-launchd` removes it. `sauce-autoloop.plist.sample` is retired in its favour.

### 4.8 Isolation

`isolate: worktree` (default for `agent` nodes when the graph declares `repo:`) creates `<repo>/.worktrees/sauce/<run-id>-<node-id>` on branch `sauce/<run-id>-<node-id>` from `origin/main`, or from the upstream node's head on a handoff. `isolate: none` runs in the repo root for read-only graphs. Worktrees are swept by `sauce run --sweep` (reusing `sweep-worktrees.js`), never automatically while a branch has unmerged commits.

Workers run with cwd = the isolation scope, stdin closed, a per-node timeout, and `SAUCE_VAULT` exported. The Claude Code adapter shells to `claude -p` with `--permission-mode acceptEdits --max-turns <n>`; the Codex adapter shells to `codex exec --json`. Both receive the same prompt tail instructing them to write `result.json`; the engine never parses free text for a verdict. Worktrees are filesystem and branch isolation only; the workers keep the user's local privileges. That limitation goes in `Docs/engine.md` verbatim.

### 4.9 Human touchpoints in Obsidian

1. **Author** a graph note from the `Sauce Graph.md` template the mechanism installs.
2. **Watch** the `## Runs` projection update in place.
3. **Answer** a `human` node by ticking its checkbox.
4. **Read** results: each agent node's summary lands in the projection with links to artifacts.
5. **Halt** a run by setting `status: halted` in the note; the next tick honours it.

Follow-up: a Dataview view (`ranch/views/engine-run-status`) drawing the run as a graph through the existing `GraphLayout` pure core, and a run list on Home.

---

## 5. Integration

### 5.1 Where the engine lands

Three candidates were weighed against how the repo already ships code.

| Option | Shape | Verdict |
| --- | --- | --- |
| **A. `platform/engine/` runtime + `platform/mechanisms/engine/` manifest** (recommended) | The runtime is a plain Node library shipped in the brew `libexec` like `platform/cli/` and `scripts/autoloop/`, never copied into vaults. The mechanism is the vault-facing surface: `/sauce` command + skill, the graph template, the `ranch/engine/` seed, the `claude_md_row`. | Matches the two precedents exactly: CLI verbs live under `platform/`, the coordinator is resolved from the install and not vendored per vault, and `delivery` shows a mechanism that ships pure scripts under `ranch/`. One version, one code path, consumer vaults only carry state and surface. |
| B. Everything inside `platform/mechanisms/engine/` with `files[]` copying the runtime into `ranch/engine/` | Per-vault vendored runtime | Rejected: three vaults would run three copies pinned at three versions, and the coordinator precedent deliberately avoided this. |
| C. `plugins/engine/` next to mayo | Engine as a plugin | Rejected by the naming rule: plugins sit on the engine, and a plugin cannot be what `sauce run` requires when no plugin is installed. |

So: `platform/engine/{index.js, graph.js, scheduler.js, ledger.js, projection.js, workers/{claude-code,codex,fake}.js, isolation.js, schemas/}` and `platform/mechanisms/engine/{manifest.json, commands/sauce.md, skills/run/SKILL.md, templates/Sauce Graph.md}`. The catalogue slug is `engine` (internal, like `delivery`); the user-facing name is Sauce, per the naming rule.

### 5.2 Installer wiring so every `sauce install` gets it

- `platform/manifest.json` gains `engine` in `mechanisms[]`; the workshop's `ranch/platform-subscription.json` and the seed vault's subscription gain the entry (the bumper writes pins; adding the entry is the one manual edit, as for every new mechanism).
- **New posture, needs D2:** an installer heal `ensureEngineSubscription` appends `engine` to any subscription that lacks it and prints a notice. Today no mechanism is auto-subscribed (`platform-claude` is "always-on" by convention only). Without this heal, "every vault that runs `sauce install`" is not true for the three existing consumers.
- The manifest's `files[]` writes `{{templates_path}}/Sauce Graph.md` and seeds `ranch/engine/.keep`; `claude_surface[]` writes `.claude/commands/sauce.md`, `{{skills_dir}}/run/SKILL.md`, and a `resolvers` row (`Sauce | .claude/commands/sauce.md | /sauce`). `ranch/engine/` is inside the sanctioned tetrad, so no new top-level path is created.
- Schemas: `sauce.graph.v1`, `sauce.run-ledger.v1`, `sauce.worker-result.v1` registered in `platform/schemas-index.json` so `lint-schemas` covers them.

### 5.3 The two entry points

- **`sauce run <note>`**: new `run` entry in the `VERBS` map, `platform/cli/cmd-run.js` (50 to 150 LOC like the others), delegating to `platform/engine`. Flags per § 4.5. Advertised in `cmd-help.js`.
- **`/sauce`**: `.claude/commands/sauce.md` materialized by the mechanism into every vault (and into the workshop by dogfood). Body: resolve the note argument, call `sauce run`, relay the receipt, and on a `human` node tell the user which box to tick. No board writes, no coordinator calls; it is a launcher.

### 5.4 `plugins/mayo` as a consumer, not a sibling

- `platform/engine/graphs/delivery-slice.md` ships the canonical slice pipeline as a graph: `claim` (shell, coordinator `claim --json`, `capture: json` for `lease_token`) → `implement` (agent, worktree) → `adequacy` (judge, `gate: adequacy`) → `lens-correctness` → `lens-regression` → `lens-adequacy` (agent, read-only, each recorded through `record-review`) → `verify-gates` (shell) → `pr` (shell, `record-pr`) → `advance` (shell) → `complete`. Retry edges encode "one same-card repair"; the `exhausted` edge routes to a `supersede` node that calls `/mayo:intake` semantics through the intake CLI. The coordinator stays the only board writer; the graph merely sequences its verbs.
- `mayo:run` gains an `--engine` mode that runs that graph for the claimed slice; the prose pipeline stays the default until one live epic completes through the graph (follow-up cutover, D4). `plugin.json` and `plugins/mayo/README.md` state the dependency: the mayo plugin requires the Sauce engine from the same install (`brew` or the local clone named in `codex.plugin_root`).
- `mayo:status` reads `ranch/engine/runs/` alongside the coordinator ledger so an engine-driven slice shows in the digest.

### 5.5 `/audit` validates the engine install

`sauce audit --engine` becomes the fourth read-only walker in `cmd-audit.js`: `ranch/engine/` present; `.claude/commands/sauce.md` and the skill match canonical bytes; the template exists; every ledger file parses against `sauce.run-ledger.v1`; no ledger references a worktree that no longer exists; the mechanism version in `platform-installed.json` matches the catalogue. Findings use the existing four-level severity and JSON footer so the `/audit` skill needs only a new section, not a new parser.

### 5.6 Testing

- `platform/test/run-engine-smoke.js`: builds a temp vault and a temp git repo, writes a 3-node graph (`agent fake → judge shell → agent fake` with one `on: fail, max: 1` retry edge), runs `sauce run --follow --worker fake`, asserts the ledger transitions, the retry count, the handoff payload reaching node 3, the worktree lifecycle, and the `## Runs` projection bytes. Registered in `package.json` (`test:engine`) and `preflight-manifest.json`.
- `platform/test/run-engine-graph.js`: parser and validator cases (unbounded cycle refused, unknown node type refused, dangling edge refused, named outcomes).
- Existing `release:preflight` plus every lint stays green; the deletions in § 2 adjust `run-autoloop-select.js` and the preflight manifest.

---

## 6. MVP versus follow-up

**MVP (this cycle):**

1. `platform/engine/` runtime: parser + validator, in-process scheduler (tick and `--follow`), node types `agent | judge | shell | human | end`, edges with `on` and `max`, worktree isolation, workers `fake`, `claude-code`, `codex`, vault ledger, note projection.
2. `platform/mechanisms/engine/` with template, `/sauce` command and skill, schema entries, installer heal (pending D2).
3. `sauce run` verb and `cmd-help` entry.
4. `sauce audit --engine` and the `/audit` skill section.
5. `delivery-slice` graph shipped and exercised end-to-end by the fake worker in the smoke test; `mayo:run --engine` opt-in.
6. Deletions from § 2 (non-destructive set); worktree/branch sweep only on D5.
7. Docs and marketing per Phase 2B: README rewrite with the Mermaid "How it works", `Docs/engine.md`, `Docs/comparison.md`, CHANGELOG entry, release-note draft under `Docs/plans/`, `Docs/marketing/launch-post.md`, `Docs/Index.md` and agent-guide router rows, `mayo-plugin.md` correction, cycle-status and cycle-history updates.

**Follow-up (named, not scheduled):**

- `--install-launchd` unattended cadence.
- `wait: all` join nodes and parallel fan-out with per-node worktrees merging through a queue node.
- Sub-graphs (`type: graph`, `note:`) so an epic is a graph of slice graphs.
- Dataview run-status view on `GraphLayout`; Home run list.
- `mayo:run` default cutover to the engine; coordinator verbs as first-class `coordinator` node type instead of `shell` calls.
- Cross-machine ledger reconciliation (the vault ledger removes most of workstream 4's motivation; what remains is conflict handling when two machines tick the same run).
- Container or VM sandboxing for workers.

---

## 7. Breaking changes and migration

| Change | Who it hits | Migration |
| --- | --- | --- |
| New `engine` mechanism required for `/sauce` and `sauce run` | All consumer vaults (`accuris-sauce`, `ero-sauce`, `headspace-sauce`) | `brew upgrade sauce && sauce update` per vault; with D2 the heal subscribes it, otherwise add `{name: engine}` to `ranch/platform-subscription.json` first. `sauce audit --engine` verifies. |
| `.claude/commands/sauce.md` and `.claude/skills/engine/run/SKILL.md` appear in each vault | Consumer vaults | Managed by `claude_surface[]`; a hand-authored file at either path would be overwritten. None exists today (verified: the claude-surface registry has zero loop entries). |
| `ranch/engine/` new directory | Consumer vaults | Created by the installer; inside the tetrad. |
| `/sauce-autoloop`, `/sauce-pipeline`, `/delivery-review`, `/delivery-status` removed | Workshop only; never materialized to consumers | Any loaded `com.will.sauce-autoloop` plist must be unloaded (none is on this machine). |
| `autoloop-queue.md` and the Scout scripts removed | Workshop | `select-card.js` no longer drains a queue; nothing else changes. |
| Release bump | Everyone on the tap | PR title `feat(engine)!: ...` so the squash commit classifies correctly; under 0.x this is a minor. The bumper writes every version record. |
| Repo description and topics | GitHub | Description update is an external write I would apply with `gh repo edit` in Phase 2 unless you prefer to do it; topics are listed for you to set. |

Nothing in `.loop/config.json`, the coordinator ledger, env names, or the mayo slash surface changes.

---

## 8. Decisions needed from you before Phase 2

| # | Decision | My default if you say "go" without answering |
| --- | --- | --- |
| **D0** | Where is the node-based engine (path or URL)? Or confirm none exists. | Build § 4 fresh. |
| D1 | Location: `platform/engine/` + `platform/mechanisms/engine/` (§ 5.1 A). | A. |
| D2 | Installer auto-subscribes `engine` (first auto-subscribed mechanism). | Yes, with a notice line. |
| D3 | Ledger in the vault (`ranch/engine/runs/`) rather than `.git/`. | Vault. |
| D4 | `mayo:run` engine mode opt-in first, cutover after one live epic. | Opt-in first. |
| D5 | Sweep the 14 stale worktrees and 16 `codex-autoloop/*` branches. | **Skip** unless you say yes (destructive, local). |
| D6 | The tracked `.local/mechanisms/smart-connections-bridge/` overlay. | Leave untouched; note it in the result doc. |
| D7 | I apply the GitHub description with `gh repo edit`. | Apply it; you set topics. |

---

## 9. Phase 2 file plan

**Code**

- `platform/engine/**` (new), `platform/mechanisms/engine/**` (new), `platform/cli/cmd-run.js` (new), `platform/cli/sauce-cli.js`, `platform/cli/cmd-help.js`, `platform/cli/cmd-audit.js`, `platform/manifest.json`, `platform/schemas-index.json`, `platform/install.js` (heal), `ranch/platform-subscription.json`, `platform/test/seed-vault/ranch/platform-subscription.json`, `platform/test/run-engine-smoke.js` (new), `platform/test/run-engine-graph.js` (new), `platform/test/run-autoloop-select.js`, `platform/test/preflight-manifest.json`, `package.json`, `scripts/autoloop/select-card.js`, `scripts/autoloop/gate.js`, `plugins/mayo/skills/run/SKILL.md`, `plugins/mayo/.claude-plugin/plugin.json`, `plugins/mayo/README.md`, `.gitignore`.
- Deletions: `.claude/commands/{sauce-autoloop,sauce-pipeline,delivery-review,delivery-status}.md`, `sauce-autoloop.plist.sample`, `autoloop-queue.md`, six Scout scripts, three `.agents/skills/*/SKILL.md` aliases.

**Docs and marketing**

- `README.md`, `Docs/engine.md` (new), `Docs/comparison.md` (new), `Docs/marketing/launch-post.md` (new), `CHANGELOG.md`, `Docs/plans/<date>-v<X.Y.Z>-engine-reintegration-{plan,result}.md` (new) plus the release-note draft, `Docs/Index.md`, `CLAUDE.md` router rows (outside marker regions), `Docs/agent-guides/{mayo-plugin,cycle-status,architecture}.md`, `Docs/cycle-history.md`.

**Outside references used for the comparison doc:** Gas Town (Mayor, polecats, convoys, beads, one worktree per polecat) at [steve-yegge.medium.com/welcome-to-gas-town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) and [github.com/gastownhall/gastown](https://github.com/gastownhall/gastown); beads-superpowers (Superpowers skills + Beads Dolt-backed tracker, headless-stopping approval gates) at [dollardill.github.io/beads-superpowers](https://dollardill.github.io/beads-superpowers/); the vault's own 2026-07-21 substrate decision, which borrowed the DAG-plus-ready-work idea from Beads and kept the vault as the store.

---

## Phase 1 files touched

- `Docs/plans/engine-reintegration.md` (this file, new). Nothing else.
