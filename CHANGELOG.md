# Changelog

Sauce releases are cut automatically from conventional commits on `main` (see `Docs/agent-guides/build-test-verify.md` § Release workflow). This file carries the human-readable notes for releases that change how you use Sauce; the full per-cycle record is `Docs/cycle-history.md`, and the git tags are the source of truth for versions.

## Unreleased (engine reintegration, PR title `feat(engine)!`)

### Added

- **The engine.** `platform/engine/`: a graph note (`type: sauce-graph` plus one fenced `sauce` block) declares typed nodes (`agent`, `judge`, `shell`, `human`, `end`) and edges (`on:` outcome, `max:` retry budget). `sauce run <note>` ticks it: agent nodes run Claude Code or Codex in their own git worktree and publish `result.json` by rename; judges and shells are exit-code steps; a human node parks the run on a checkbox in the note; the run's ledger is one append-only JSONL file at `ranch/engine/runs/<run-id>.jsonl`. Reference: `Docs/engine.md`.
- **`sauce run`** with `--follow`, `--wait-human`, `--dry-run`, `--status`, `--list`, `--sweep`, `--worker fake|claude-code|codex`, `--var k=v`, `--repo`, `--install-launchd` / `--uninstall-launchd`, `--json`.
- **`/sauce`** slash command and the `engine:run` skill, materialized into every vault by the new always-on `engine` mechanism, with a `Sauce Graph` template and `ranch/engine/`.
- **Always-on mechanisms.** The installer subscribes every vault to `engine` and `platform-claude` at the catalogue version and writes the pin back to `ranch/platform-subscription.json`.
- **`sauce audit --engine`**: read-only proof that the engine surface is installed and every ledger parses.
- **`platform/engine/graphs/delivery-slice.md`**: the mayo coordinator's slice pipeline as a shipped graph (claim, implement, adequacy gate, three recorded review lenses, verify-gates, PR, advance to complete, one same-card repair per gate, human supersede node). Opt-in from `/mayo:run`.
- **`platform/engine/sauce-engine.plist.sample`**: the launchd template `--install-launchd` renders.
- Schemas `sauce.graph.v1`, `sauce.run-ledger.v1`, `sauce.worker-result.v1`; harnesses `test:engine-graph`, `test:engine-smoke`, `test:engine-install`, `test:engine-delivery-graph`.
- `Docs/engine.md`, `Docs/comparison.md`, `Docs/marketing/launch-post.md`, `Docs/agent-guides/engine.md`.

### Changed

- README repositioned around the engine; the vault-platform material moves below it.
- `plugins/mayo` is documented as a consumer of the engine; `/mayo:run` gains an opt-in engine mode and `/mayo:status` folds engine runs into its digest. The coordinator remains the only board writer.
- `platform-claude` is formally always-on rather than by convention.

### Removed

- `.claude/commands/sauce-autoloop.md`, `sauce-pipeline.md`, `delivery-review.md`, `delivery-status.md` (the pre-plugin loop surface and stubs that pointed at a plugin that no longer exists).
- `sauce-autoloop.plist.sample` (superseded by `platform/engine/sauce-engine.plist.sample`).
- `autoloop-queue.md` and the Scout scripts `scout-signals.js`, `bughunt.js`, `board-mirror.js`, `block-note.js`, `render-handoff.js`, `reconcile-inflight.js`; `select-card.js` no longer drains a queue.
- The broken `.agents/skills/{card-intake,slice-plan}/SKILL.md` aliases and `.agents/skills/sauce-autoloop/`.
- `.local/` is untracked and ignored.

### Breaking

- Every consumer subscription gains the `engine` mechanism (at the catalogue version) on its next `sauce update`; `.claude/commands/sauce.md` and `.claude/skills/engine/` become installer-managed paths in every vault (a hand-authored file there is overwritten; use `.claude/commands.local/` to shadow).
- The `/sauce-autoloop` command and its plist are gone from the workshop. Unattended cadence is `sauce run <note> --install-launchd`.
