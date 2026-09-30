---
purpose: Onboarding runbook for the sauce plugin — install/reload for Claude and Codex, the /sauce:init binding walkthrough, and the two round-one test scripts.
load_when: Installing, updating, binding, or debugging the sauce plugin surface; onboarding a new repo/project onto the meta-loop.
---

# Sauce plugin — onboarding runbook

The `sauce` plugin centralizes the meta-loop skill surface (status, review, propose, plan, execute, loop, intake, init, block-review) in ONE place — `plugins/sauce/` in this repo, published via sauce own marketplace — and every repo binds itself to a vault/board with a committed `.loop/config.json`. A plugin reload puts every session of every project on the same logic. Design: `Docs/superpowers/specs/2026-07-26-meta-loop-plugin-design.md`.

## Architecture in three sentences

Skill bodies live once in `plugins/sauce/skills/*/SKILL.md`; Claude reads them as an installed plugin (`/sauce:*`), and Codex reads the SAME bodies through generated `.agents/skills/sauce-*` routers that resolve the body location from `.loop/config.json` (`codex.plugin_root`) at use time. The binding contract `.loop/config.json` declares vault root, project slug, board/cards paths, id prefix, policy knobs, and coordinator location; the plugin's resolver (`loop-config.js`) turns it into env (`DELIVERY_*`, `SAUCE_LOOP_*`) that retargets the unchanged coordinator, batch-runner, digest, and intake rails at that board. Board-writer authority is untouched: the coordinator remains the only operational writer and card-intake the only planning writer — the plugin skills orchestrate those CLIs and never hand-edit boards. The plugin is a consumer of the Sauce engine (`platform/engine/`, see [engine.md](engine.md)): `/sauce:loop` can hand a slice to the shipped delivery-slice graph, and `/sauce:status` folds engine runs into its digest.

Sauce's own automation never depends on the installed plugin: `scripts/autoloop/codex-coordinator.js` and `scripts/autoloop/board-health-launchd.js` require the resolver at `scripts/autoloop/loop-config.js` directly, so the coordinator keeps working whether or not the plugin is installed. The plugin surface at `plugins/sauce/scripts/loop-config.js` is a thin forwarder onto that same module, so the skill bodies' `${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js` contract and Codex's `codex.plugin_root` resolve to one implementation that cannot drift from it.

## Install (Claude, once per machine)

```text
/plugin marketplace add willfell/sauce
/plugin install sauce@sauce
```

Restart the session (or open a new one) — `/sauce:status`, `/sauce:init`, etc. are now available in EVERY repo.

**Reload after the plugin changes** (any merged sauce commit is a new plugin version):

```text
/plugin marketplace update sauce
```

then restart the session. Repos can auto-recommend the plugin: `/sauce:init` offers to write `extraKnownMarketplaces` + `enabledPlugins` into the repo's `.claude/settings.json`, which prompts anyone opening that repo to install.

## Install (Codex, per repo)

Codex never reads `~/.claude/`. Its surface is the generated `.agents/skills/sauce-*` routers committed in each bound repo, which point at the canonical bodies via `codex.plugin_root` in `.loop/config.json`:

- Consumer/brew setups: `plugin_root = /opt/homebrew/opt/sauce/libexec/plugins/sauce` — **reload = `brew upgrade sauce`**, nothing else (routers bake no paths and never go stale).
- Dev setups: point `plugin_root` at a local sauce clone`s `plugins/sauce`.

Regenerate routers only when the SKILL SET changes: `node <plugin_root>/scripts/gen-codex-routers.js --repo . --json` (also run by `/sauce:init`). CI keeps the workshop's own routers honest via the `--check` byte-determinism gate.

## Bind a repo: /sauce:init walkthrough

From the repo you want on the loop:

1. `/sauce:init` — answer the interview: vault root, project slug, board paths (convention offered: `spice/projects/<slug>/<slug>-board.md` + `tasks/`), default id prefix, policy (batch policy, execution mode, deploy subscriptions/vaults), coordinator (`brew` default), optional FID path, Codex routers y/n.
2. It writes `.loop/config.json`, validates with `loop-config.js check --json` (vault exists, board has `## In Planning`, cards root is a directory), generates the routers, and offers the settings.json recommendation.
3. Commit `.loop/config.json` + `.agents/skills/sauce-*` to the repo.
4. `/sauce:status` — first read of a fresh binding legitimately shows an empty ledger.

Binding a repo that another loop implementation still drives (e.g. ERO's `ero_loop`) is **bind-and-observe**: set `policy.observe_only: true`; read skills work, write skills refuse.

Five knobs every fresh binding should know:

- **`policy.run_scope`** (default `"board"`) — how far a live `/sauce:loop` drives the board before stopping: `"board"` keeps taking eligible work in board order, epic by epic, until the frontier drains, a ceiling/halt applies, or every eligible card is leased by another session (`all-work-leased`); `"epic"` completes one epic then stops; `"turn"` is one bounded claim-or-resume turn. With the default, the start prompt is IDENTICAL for every bound repo: `Use $sauce-loop --live. Start NOW — do not stop after acknowledging.` — scope, deploy posture, and gates all come from the binding and the skill bodies, never the prompt.

**Concurrent sessions & leases** — claim and resume each grant the calling session a per-card lease (`lease_token`); every subsequent pipeline verb on that card (`record-review`, `verify-gates`, `record-pr`, `advance`, `park`) must present it via `--lease-token <token>`, and the token renews on each authenticated call, with a 2h TTL from last renewal. This is the guard against two chats/sessions racing the same card: resuming a card nobody else holds (or whose lease has gone stale) is a side-effect-free attach, but a second session trying to `resume` a card another live session already holds gets refused `lease_held` — it must take a different card, never work around the refusal (`claim` only ever takes unclaimed In-Planning work, so it never contends with an existing lease). `reconcile` is supervised and never takes a lease token. If a session dies mid-card without releasing it, `break-lease --card "<exact>" --reason "<text>"` is the manual escape hatch that clears the lease so a fresh claim (or an unblocked resume) can proceed; a stray `--lease-token` presented against an active card whose lease is already gone (broken or superseded) is refused `lease_gone` rather than silently accepted, with the same resume-or-break-lease remedy.

- **`board.topology`** (default `"epic"`) — the plan/intake skills pass `epic_native: true` to the intake rail, so mints produce canonical epic scaffolds (atlas with dashboard + epic board + clean one-link parent-board line) even on a ledger with no cutover history. `"flat"` opts a legacy board out.
- **`policy.deploy_vaults: []`** (explicit empty array) — declares a **merge-only** board: the resolver emits `SAUCE_LOOP_VAULTS=[]` and the coordinator completes a card at `feature_merged` with green protected checks, skipping the release/tag/tap/brew/deploy chain entirely. Absent field = the coordinator's default deploy-bound vault list (the sauce three). Cards still carry the contract's three-key `deploy_subscriptions` map (all-empty arrays).
- **`policy.verify_commands`** (merge-only repos) — the repo's own local check suite (e.g. `["./.venv/bin/python -m pytest -q", "ruff check ."]`). The merge-only combined gate (`verify-gates`) runs THESE in the card worktree instead of the sauce release preflights + workshop self-install. Empty/absent = the receipt records `none-declared` and the protected CI checks gate the merge.
- **`gate`** (merge-only repos) — Gate B classification for non-JS repos: `{"test_globs": ["tests/**"], "exclude_globs": ["docs/**", "*.md"], "test_command": "./.venv/bin/python -m pytest -q {test}"}`. Without it, gate.js falls back to the sauce rules (which misclassify non-sauce trees). The coordinator invokes the installed gate.js by absolute path with `--cwd <worktree>` on merge-only bindings, so the diff is always computed in the bound repo.
  - **The globs are not real globs.** gate.js matches exactly three shapes — `dir/**` (prefix), `*.ext` (suffix), and an exact path — and anything else falls through to a literal `file === glob` comparison that a pattern containing `*` can never satisfy. So `src/**/*.test.ts` binds fine and then matches nothing: every test file in a diff counts as behavioral source, and Gate B refuses each slice with "behavioral change ships no regression test". Write `*.test.ts` plus explicit `dir/**` prefixes instead. `loop-config.js` now refuses an unmatchable glob at bind time, including the `src/**/__tests__/**` case that takes the prefix branch and still never matches.
  - **`test_command` is required whenever a matched test cannot be run by bare `node`.** Without it gate.js runs `node <test>`, so a TypeScript or JSX test dies before asserting. That failure is worse than a crash: every run fails, so the mutation check sees red-without-the-change *and* red-with-it and reports "test FAILS with the change restored — the change is broken", blaming the code for a defect in the runner. It is also the one gate misconfiguration bind-time glob validation cannot catch.

Two derived/repair facts:

- **GitHub repo derivation** — the resolver reads the bound repo's `origin` remote and emits `SAUCE_LOOP_REPO` (owner/name) so every gh-backed verb (`record-pr`, `advance`, `adopt`) queries the RIGHT repository's PRs; no remote → the coordinator's sauce default. Nothing to configure. **The coordinator self-resolves this the same way `BOARD`/`CARDS_ROOT` do**, so a bare CLI invocation with no env is correct too — it does not depend on being launched through the plugin. That mattered: while `REPO` was env-only, `adopt` (which has no plugin-mediated invocation path) found the right card in the right vault and then verified `--pr` against `willfell/sauce`, checking an unrelated repository's PR of the same number.
- **`amend-park`** — bounded supervised repair when a parked card's recorded metadata is wrong (e.g. parked on a dependency that later proves impossible or already satisfied upstream): `amend-park --card "<exact>" --expected-head <preserved 40-hex HEAD> --reason "<audit>" (--clear-dependencies | --depends-on "<card>"...) [--resume-condition "<text>"] --json`. Parked cards only; compare-and-swap on the preserved HEAD; appends an audit record; literal replay is `no_op`; never touches receipts, worktrees, or any non-parked card. Discard/supersession remains the only path that deletes work.

## The skill surface

| Slash | Codex | Does |
| --- | --- | --- |
| `/sauce:init` | `$sauce-init` | bind repo → vault/board; write config; generate routers |
| `/sauce:status` | `$sauce-status` | phone-sized read-only digest + since-you-last-looked |
| `/sauce:review` | `$sauce-review` | walk the retroactive digest; decide escalations |
| `/sauce:propose` | `$sauce-propose` | design dialogue → epic proposal doc |
| `/sauce:plan` | `$sauce-plan` | plan AS board schema; prompts id prefix + priority; mints via intake |
| `/sauce:execute` | `$sauce-execute` | drive the minted epic in-session, sub-agent per slice, full quorum |
| `/sauce:loop` | `$sauce-loop` | one bounded autonomous loop turn |
| `/sauce:intake` | `$sauce-intake` | raw requirement → board-ready work (incl. supersede-at-mint) |
| `/sauce:block-review` | `$sauce-block-review` | detect + heal dangling depends_on rot; auto-fix provable, escalate never-minted |

The legacy aliases (`/delivery-status`, `/delivery-review`, `$card-intake`, `$slice-plan`, `$sauce-autoloop`) were retired in the engine-reintegration cycle; use the `/sauce:*` / `$sauce-*` names above. The fat `/sauce-autoloop` command and its `sauce-autoloop.plist.sample` are retired with them: unattended cadence is now `sauce run <note> --install-launchd` (see `platform/engine/sauce-engine.plist.sample`), and `/sauce:loop` has an opt-in engine mode that runs `platform/engine/graphs/delivery-slice.md` — the prose pipeline stays the default until one live epic completes through the graph and its ledger is diffed against a coordinator run. See [engine.md](engine.md).

## Test script A — sauce/headspace (full cycle with a toy epic)

Run in a fresh Claude session in the sauce workshop repo:

1. `/plugin marketplace add willfell/sauce` → `/plugin install sauce@sauce` → restart session. (Workshop is already bound — `.loop/config.json` is committed.)
2. `/sauce:status` — expect the real board digest, byte-for-byte the same content `/delivery-status` used to give.
3. `/sauce:propose` a TOY epic — e.g. "a `docs/toys/loop-plugin-smoke.md` note describing the plugin smoke test". Expect: one-question-at-a-time dialogue, proposal written under `spice/projects/sauce/docs/proposals/`.
4. `/sauce:plan` against the proposal — expect prompts for **id prefix** (answer `TOY`) and **board priority position** (answer `bottom`), a dry-run receipt to approve, then mint via the intake rail, then the "execute now or leave for the loop?" question — answer **leave for the loop**.
5. Verify on the board: the toy epic sits at the bottom of In Planning with `TOY-`-prefixed slices on its epic board.
6. Clean up so the live board stays clean — discard through the coordinator (the only sanctioned deleter):
   `node <coordinator> discard --card "<toy epic slice/epic name>" --reason "plugin onboarding smoke test" --json` per the coordinator's discard usage (dry-run first if unsure), then `/sauce:status` to confirm the tombstone shows in "since you last looked".
7. Repeat step 2 from Codex (`$sauce-status` in the sauce repo) — same digest, same body, different runtime.

## Test script B — ero-egnyte (bind-and-observe ONLY, round one)

Run in the egnyte-mcp repo (`~/Documents/GitHub/egnyte-mcp`). Do NOT migrate ero's boards or touch its `ero_loop` — round one only proves the binding reads the ero board.

1. `/sauce:init` — vault root `~/obsidian/ero-sauce`, slug `ero-egnyte-mcp`, board `spice/projects/ero-egnyte-mcp/ero-egnyte-mcp-board.md`, cards `spice/projects/ero-egnyte-mcp/tasks`, prefix (e.g. `EM`), **`observe_only: true`**, deploy subscriptions empty (ero completes on merge), coordinator `brew`, routers yes.
2. `/sauce:status` — expect a digest of the ero board with an empty/near-empty ledger (ero's Python loop owns its state; the coordinator has no claims here). That's the correct round-one answer.
3. Confirm `/sauce:plan` REFUSES (observe_only) — the guard that protects ero's existing loop.
4. Commit `.loop/config.json` + routers to egnyte-mcp when satisfied.

## Troubleshooting

- `config_missing` → run `/sauce:init`. Any other refusal code from `loop-config.js` names its exact fix.
- Coordinator missing → `brew install willfell/sauce/sauce` (or set `coordinator: {resolve: "path", path: ...}`).
- `Cannot find module '../../../scripts/autoloop/loop-config.js'` → the plugin is loaded from the Claude plugin cache, which holds only the plugin subtree, so `${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js` cannot resolve its relative require to `scripts/autoloop/loop-config.js`. Workaround until fixed: call the brew copy at `/opt/homebrew/opt/sauce/libexec/scripts/autoloop/loop-config.js`.
- Codex router drift → `node <plugin_root>/scripts/gen-codex-routers.js --repo . --json` (CI gate: `--check`).
- Harnesses: `npm run test:loop-config`, `test:loop-binding`, `test:autoloop-leases` (all in `release:preflight`).
