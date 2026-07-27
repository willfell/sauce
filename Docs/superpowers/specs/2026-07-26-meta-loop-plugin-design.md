# Meta-loop plugin unification — design

Date: 2026-07-26
Author: Will's delegate (session run under the ratified "Standing delegation of ratification", FID 2026-07-25). Will absent by design; every open question below is resolved from evidence with rationale recorded, per session mandate.
Status: ACCEPTED (delegate) — plugin/skill/packaging decisions delegated.

## 1. Problem

The meta-loop system (board-governed epic/slice delivery driven by the autoloop) is implemented once per consumer and drifting:

- The **sauce** loop runs against the headspace vault (`spice/projects/sauce/sauce-board.md`) via the JS coordinator; skills are scattered across `.claude/skills/` (delivery-status, delivery-review — Claude-only, not shipped to consumers), `.agents/skills/` (card-intake, sauce-autoloop, slice-plan — Codex-only), fat `.claude/commands/` (sauce-autoloop, sauce-pipeline duplicate the Codex skill in divergent prose), and `platform/mechanisms/platform-claude/skills/` mirrors.
- **card-intake has THREE divergent bodies** (86/68/60 lines) over one authoritative script; the live checkout carries untracked, stale Claude copies.
- The **ERO** adaptation (`egnyte-mcp` repo → ero vault board) re-implemented the whole loop as an independent Python package with a frozen hardcoded `LoopConfig`, its own `ci_gated` policy, merge-only completion, renamed lanes, and project-slug string literals in code — protocol shared, implementation forked.
- Onboarding a third project would fork again. Will's ask: centralize the skills as a **plugin** living in the sauce repo, one source of truth for Claude AND Codex, with a per-repo config declaring which vault/board the repo drives, so a plugin reload puts every session of every project on the same page.

## 2. Evidence base

Six research lanes (full reports in session transcript):

- **A (governance):** four-amendment current law (epic-centric board + `discarded` tombstones; park-for-supersession; standing delegation; self-refilling frontier). Coordinator is the SOLE board writer; card-intake the sole planning writer. `claude_surface[]` materializes skills into vaults with a dest-allowlist, registry, and marker-region CLAUDE.md renderer.
- **B (inventory):** master table of every loop skill/command/script; drift flags: card-intake 3-way divergence, sauce-autoloop duplicated (Codex skill vs fat Claude command), delivery-* Claude-workshop-only, AGENTS.md corrupted by a naive `claude`→`Codex` string replacement with an empty skills index.
- **C (ERO):** 23 concrete divergence knobs (paths, id conventions, lanes, `ci_gated`, deploy-vs-merge completion, absent lenses/quorum/tombstones, ratification semantics). ERO's `LoopConfig` dataclass is the ready-made shape for the binding config.
- **D (plugin mechanics):** marketplace at repo root (`.claude-plugin/marketplace.json`) may point at a plugin subdirectory via relative `source`; skills auto-become `/plugin:skill` slash commands; repos can auto-recommend via `extraKnownMarketplaces`/`enabledPlugins` in `.claude/settings.json`; plugin skills work headless and in subagents. Codex discovers ONLY via repo `AGENTS.md` + `.agents/skills/<name>/SKILL.md` (identical frontmatter format) and is forbidden from reading `~/.claude/`.
- **E (binding):** coordinator hardcodes `BOARD`/`CARDS_ROOT`/`VAULTS` as module constants but threads them as default parameters everywhere — an entry-point override reaches all ~100 call sites. `scripts/autoloop/delivery-paths.js` is the existing env-overridable portability seam. card-intake is already fully spec-driven. Digest/triage are path-agnostic. No `.loop/` convention exists anywhere — greenfield.

## 3. Decisions

Each decision records the alternatives considered and the reason for the choice. All are delegate-ratifiable (packaging/skill/process; nothing constitutional, no perimeter crossing, no gate/lens/receipt weakening).

### D1 — Plugin name: `loop`, marketplace name: `sauce`, plugin lives at `plugins/loop/`

- Slash surface becomes exactly what Will specified: `/loop:init`, `/loop:status`, … (skills auto-namespace as `/<plugin>:<skill>`).
- Marketplace manifest at repo root `.claude-plugin/marketplace.json`, `"plugins": [{"name": "loop", "source": "./plugins/loop"}]` — matches the official `"./plugins/..."` pattern observed in the claude-plugins-official catalog. One repo ships catalog + plugin; a change to the repo is a change to the plugin.
- Alternative rejected: separate marketplace repo (superpowers pattern) — extra repo to maintain, violates Will's "putting the plugin within this repo makes sense".
- Alternative rejected: `platform/plugins/loop/` — buries the plugin inside installer-owned tree; `plugins/` at root is the documented convention and discoverable.

### D2 — No hand-versioning: `plugin.json` omits `version`

Git commit SHA becomes the plugin version (documented Claude Code behavior). Every merged commit is a new installable version; `/plugin marketplace update sauce` + reinstall is the whole reload flow. This complies with the repo's "never hand-version" law without wiring the release bumper into a new file.

### D3 — Skill set: eight skills, slash command each

| Skill | Slash | Wraps (deterministic CLI) | Modeled on |
| --- | --- | --- | --- |
| `init` | `/loop:init` | writes `.loop/config.json`; validates against vault; generates Codex routers; offers `.claude/settings.json` marketplace recommendation | — |
| `status` | `/loop:status` | coordinator `status --json` → `delivery-status-digest.js` | existing delivery-status |
| `review` | `/loop:review` | digest + `delivery-review-triage.js` + `delivery-review-ratify.js` | existing delivery-review |
| `brainstorm` | `/loop:brainstorm` | read-only board/context reads; output = epic proposal doc | superpowers:brainstorming |
| `plan` | `/loop:plan` | `card-intake.js` spec → dry-run → `--apply` (epic + contracted slices in board schema). **Prompts the user for the work-item id prefix and the board priority position before minting.** | superpowers:writing-plans, emitting board schema |
| `execute` | `/loop:execute` | coordinator claim/verify-gates/record-review/record-pr/advance + `gate.js`; sub-agent per slice with the FULL quorum (Gate B + correctness → regression-risk → test-adequacy, sequential, stop-at-first-refutation) | run-loose slice path, in-session |
| `run` | `/loop:run` | the run-loose engine as a skill: coordinator verbs end-to-end, config-driven paths, FID law | run-loose prompt v2, genericized |
| `intake` | `/loop:intake` | `card-intake.js` directly (raw requirement → board-ready cards, incl. supersede-at-mint) | existing card-intake |

- No separate supersede/station skills: supersession is a card-intake spec capability (already refusal-guarded: `supersede_coverage_missing`), surfaced through `plan`/`intake`; the Loop Station is a coordinator-owned projection read by `status`. Adding skills for them would fork board-writer authority in prose — forbidden.
- Skills are judgment + command calls + receipts. **No logic is reimplemented in prose.** Every board write goes through card-intake or the coordinator.

### D4 — Binding contract: committed `.loop/config.json` at repo root

```json
{
  "schema_version": "1.0.0",
  "project": { "slug": "sauce", "name": "Sauce" },
  "vault": { "root": "~/notes/sauce/headspace-sauce", "mcp_server": "headspace-obsidian" },
  "board": {
    "project_root": "spice/projects/sauce",
    "board_path": "spice/projects/sauce/sauce-board.md",
    "cards_root": "spice/projects/sauce/tasks"
  },
  "ids": { "default_prefix": "GA" },
  "policy": {
    "batch_policy": "continue",
    "execution_mode": "release",
    "deploy_subscriptions": ["headspace", "accuris", "ero"]
  },
  "coordinator": { "resolve": "brew" },
  "fid": "~/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md",
  "codex": { "routers": true, "plugin_root": "/opt/homebrew/opt/sauce/libexec/plugins/loop" }
}
```

- `vault.root` and `fid` accept `~`; board paths are vault-relative. Resolver enforces the intake coupling invariant `project_root == dirname(board_path)` and refuses on missing file, invalid JSON, missing required fields, or coupling violations (fixture-tested).
- `coordinator.resolve`: `"brew"` (default; `$(brew --prefix sauce)/libexec/scripts/autoloop/codex-coordinator.js` — matches run-loose law: installed coordinator only) or `"path"` with explicit `coordinator.path`.
- `policy` knobs absorb the ERO divergences that are *configuration* (batch policy vocabulary, deploy list — empty list = merge-only completion). Divergences that are *governance* (lenses, tombstones) are law, not config; ERO round one is bind-and-observe only.
- Names follow the intake spec/ERO `LoopConfig` vocabulary so the fields map 1:1 onto existing tools.
- Alternatives rejected: extending `ranch/platform-config.json` (that file is the installer's path map and exists only in vaults — the binding must live in arbitrary repos); env-vars-only (not committed, not discoverable, defeats "onboard a repo once").

### D5 — Resolver: `plugins/loop/scripts/loop-config.js`, zero-dependency Node

Verbs: `resolve --json` (validated binding + resolved absolute paths + an `env` map) and `check --json` (adds vault-existence checks: board file present, `## In Planning` heading, cards_root dir). Every skill starts with `node "$CLAUDE_PLUGIN_ROOT/scripts/loop-config.js" resolve --json` and passes the env map to the tools it shells. The env map feeds the two existing seams:

- `DELIVERY_REPO_ROOT`, `DELIVERY_COORDINATOR`, `DELIVERY_FID`, `DELIVERY_STATE` → `delivery-paths.js` (already env-overridable, untouched).
- `SAUCE_LOOP_BOARD`, `SAUCE_LOOP_CARDS_ROOT`, `SAUCE_LOOP_VAULTS` → new coordinator/batch-runner overrides (D6).

### D6 — Coordinator binding seam: env overrides at the constant block, defaults byte-identical

`codex-coordinator.js` lines ~51/87–93 and `batch-runner.js` lines ~66–67 change from hardcoded literals to `process.env.SAUCE_LOOP_* || <current literal>`. `SAUCE_LOOP_VAULTS` is a JSON array `[{"id":..., "path":...}]`; `DEPLOYMENT_VAULT_IDS` derives from it. With no env set, behavior is byte-identical (harness-asserted) — the live loop is untouched. This is the minimal correct seam given ~100 call sites already accept these values as default parameters.

- Alternative rejected: threading a config-file read into the coordinator — invasive in a 6.5k-line file the live loop depends on; the env seam achieves the same binding with a provable no-op default.

### D7 — One source of truth for skill bodies; Codex gets STATIC generated routers

Skill bodies live ONCE at `plugins/loop/skills/<name>/SKILL.md`. Claude reads them natively (plugin). Codex cannot read `~/.claude/` (Will's global `~/.codex/AGENTS.md` forbids it), so `/loop:init` generates `.agents/skills/loop-<name>/` routers in the consuming repo:

- `SKILL.md`: frontmatter (`name: loop-<name>`, description copied from the canonical body's frontmatter — metadata, not body) + a fixed ~6-line body: "Generated router — do not edit. Resolve `codex.plugin_root` from `.loop/config.json`, read `<plugin_root>/skills/<name>/SKILL.md`, and follow it. The repo binding is `.loop/config.json`."
- `agents/openai.yaml`: `display_name`/`short_description`/`default_prompt` (the existing `$name` Codex invocation convention).
- Routers bake NO paths — the plugin root is read from config at use time, so generation is a pure function of the skill list + descriptions → byte-determinism is trivially testable, and routers never go stale on plugin update.
- `codex.plugin_root` default: brew libexec (`/opt/homebrew/opt/sauce/libexec/plugins/loop`) — sauce already ships the whole repo into libexec, so the plugin rides the existing brew channel; a local-clone path is a per-repo dev override (same posture as `workshop_relative_path`).
- Zero duplicated bodies: the router body is a pointer, not a copy.

### D8 — Migration: plugin becomes the sole surface for loop skills

| Today | Disposition |
| --- | --- |
| `.claude/skills/delivery-status/`, `.claude/skills/delivery-review/` | Bodies move into `plugins/loop/skills/{status,review}/`; workshop copies deleted; `.claude/commands/delivery-{status,review}.md` become deprecation stubs pointing at `/loop:status` `/loop:review` (superpowers deprecation pattern). |
| `.agents/skills/card-intake/SKILL.md` | Body folds into `plugins/loop/skills/intake/SKILL.md` (newest 86-line body is the base). The 1007-line `scripts/card-intake.js` + fixtures STAY at `.agents/skills/card-intake/scripts/` — it is the deterministic rail, shipped via brew, referenced by path from the skill. `SKILL.md` is replaced by a generated router (name kept `card-intake` for `$card-intake` continuity, marked deprecated in favor of `loop-intake`). |
| `.agents/skills/slice-plan/SKILL.md` | Content folds into `plugins/loop/skills/plan/SKILL.md`; replaced by a deprecation router. |
| `.agents/skills/sauce-autoloop/SKILL.md` | Content folds into `plugins/loop/skills/run/SKILL.md` (+ `references/operations.md` moves to `plugins/loop/skills/run/references/`); replaced by a deprecation router. |
| `platform/mechanisms/platform-claude/skills/{card-intake,slice-plan}/` + their `claude_surface[]` entries | **RETIRED.** Loop skills are repo-facing (they drive repos against boards), not vault-content-facing; the plugin reaches every repo including non-vault ones, which `claude_surface[]` never can. Keeping the mirrors would preserve exactly the divergence this session exists to kill. Consumer vaults get `/loop:*` via the plugin instead. `{bootstrap,install,upgrade}` mirrors are vault-lifecycle skills and stay. |
| `.claude/commands/sauce-autoloop.md`, `sauce-pipeline.md` (fat) | **UNTOUCHED this round.** The live 30-minute cron loop invokes them; replacing them before `/loop:run` is validated would impede current operations (explicit session constraint). Marked for retirement in the doc; migration is a follow-up after Will's onboarding test. |
| Untracked live-checkout files (`.claude/skills/platform/{card-intake,slice-plan}/`, `.claude/commands/{card-intake,slice-plan}.md`) | Stale materializations; superseded by the plugin. Left for the next dogfood install to prune (no action from the worktree — they are not in git). |

### D9 — Distribution & reload

- Claude: `/plugin marketplace add willfell/sauce` once per machine; `/plugin install loop@sauce`; reload = `/plugin marketplace update sauce` (+ restart session). Repos may commit `.claude/settings.json` with `extraKnownMarketplaces` + `enabledPlugins` so new sessions are prompted automatically — `/loop:init` offers to write this.
- Codex: rides brew (`brew upgrade sauce` refreshes `codex.plugin_root`) + the static routers committed per-repo. Routers never change on plugin update (D7), so reload for Codex = brew upgrade, nothing else.
- Consumer vaults: same as any repo — the plugin is repo-agnostic.

### D10 — Testing (harness style, registered in preflight)

1. `platform/test/run-loop-config.js` — resolver fixtures: valid config; missing file / invalid JSON / missing fields / coupling-violation refusals; `~` expansion; env-map correctness; `check` vault validations (fixture vault).
2. `platform/test/run-loop-plugin-surface.js` — marketplace.json + plugin.json validity (name/source/dirs exist, no `version` field creep); every skill dir has SKILL.md with `name` matching dir + trigger-style `description`; **no absolute machine paths in any body** (portability gate); deprecation stubs point at existing skills.
3. `platform/test/run-loop-codex-routers.js` — generator byte-determinism (two runs identical); router set matches plugin skill set; router bodies carry no baked paths; refuses without `.loop/config.json`.
4. `platform/test/run-codex-autoloop.js` (existing) — extended: `SAUCE_LOOP_*` env overrides honored; **defaults unchanged when env absent**.
5. Existing `run-card-intake.js`, `run-slice-plan.js`, `run-delivery-status.js`, `run-delivery-review.js` — updated to gate the new canonical locations (they are the migration's regression net).

### D11 — The sauce repo binds itself

The sauce repo commits its own `.loop/config.json` (headspace vault binding, the values in D4) and its generated `.agents/skills/loop-*` routers — dogfood plus the live fixture for the byte-determinism gate.

## 4. Out of scope / follow-ups (recorded, not actioned)

1. **AGENTS.md corruption** — the `platform-codex` materialization does a naive `claude`→`Codex` string replace (emits `.Codex/…`) and its skills-index region is empty. Needs its own card via normal intake.
2. **ERO `ero_loop` unification** — round one is bind-and-observe (read-only `.loop/config.json` + `/loop:status` against the ero board). Porting ERO off its Python fork onto the shared coordinator is a separate project Will should direct.
3. **Cron migration** — flipping the 30-minute loop from `/sauce-autoloop` to `/loop:run`, and retiring the fat commands, after Will's onboarding test passes.
4. **`plugin-name` collision policy** — if a second plugin ever ships from this marketplace, revisit `metadata.pluginRoot`.

## 5. Done criteria (from the session mandate)

1. PR merged or auto-merge armed with CI green.
2. Onboarding runbook at `Docs/agent-guides/loop-plugin.md` (+ plugin README): Claude install/reload, Codex surface, `/loop:init` walkthrough.
3. Two test scripts for Will: (a) sauce/headspace toy-epic full cycle (bind → status → brainstorm → plan with prefix/priority prompts → mint → coordinator discard); (b) ero bind-and-observe only.
4. Session log in headspace `spice/projects/sauce/docs/workflow-loops/`; phone-sized final report.
