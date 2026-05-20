# Sauce — workshop vault

The workshop for the **Sauce** platform: ships mechanisms (cross-cutting code) and blueprints (note-type bundles) that consumer vaults subscribe to via Homebrew. **No personal content lives here.** Self-installs as its own first consumer (dogfood).

## Vault identity check (pre-write)

Before any write, run `ls /Users/willfellhoelter/projects/repos/sauce`. Expected top-level: `CLAUDE.md`, `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `platform/`, `commands/`, `Docs/`, `.obsidian/`, `ranch/`, `package.json`, `install.sh`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you're in a CONSUMER vault, not the workshop — STOP.

## Further reading

**IMPORTANT:** Before starting any task, identify which of these guides apply and read them first. The router below tells you where to look; the guides + canonical `Docs/` files own the content.

- [`Docs/Index.md`](Docs/Index.md) — entry point for the canonical reference docs (`why.md`, `how.md`, `use.md`).
- [`Docs/agent-guides/architecture.md`](Docs/agent-guides/architecture.md) — mechanisms vs blueprints, installer, distribution model, `claude_surface[]`.
- [`Docs/agent-guides/build-test-verify.md`](Docs/agent-guides/build-test-verify.md) — preflight, release workflow, brew-tap chain, dogfood, cycle-close artifacts.
- [`Docs/agent-guides/code-conventions.md`](Docs/agent-guides/code-conventions.md) — the five non-negotiables, customjs gotchas, module-directory invariant, marker regions.
- [`Docs/agent-guides/vault-paths.md`](Docs/agent-guides/vault-paths.md) — workshop / consumer / legacy source vault paths on this machine.
- [`Docs/agent-guides/cycle-status.md`](Docs/agent-guides/cycle-status.md) — live workshop version, mechanism + blueprint catalogue, harness count, in-flight queue.
- [`Docs/agent-guides/asking-before-acting.md`](Docs/agent-guides/asking-before-acting.md) — full ask-before list with landmine context.
- [`Docs/landmines.md`](Docs/landmines.md) — 22 canonical traps with rationale. Always non-negotiable.
- [`Docs/cycle-history.md`](Docs/cycle-history.md) — archived per-cycle status snapshots in chronological close order.
- [`Docs/prompts/SESSION-START.md`](Docs/prompts/SESSION-START.md) — canonical session-start recipe (read on every fresh session).

## When using slash commands

<!-- @claude-surface:resolvers BEGIN -->
| Topic | Path | Slash command |
| --- | --- | --- |
| Audit | .claude/commands/audit.md | /audit |
| Bootstrap | .claude/commands/bootstrap.md | /bootstrap |
| Cowork | spice/cowork | /cowork |
| Cowork About | spice/cowork/About Cowork.md | /cowork about |
| Cowork Daily Hub | spice/cowork/Daily Hub.md | /cowork |
| Cowork Monthly Hub | spice/cowork/Monthly Hub.md | /monthly hub |
| Cowork Prompts | spice/cowork/prompts/ | /cowork prompts |
| Cowork Weekly Hub | spice/cowork/Weekly Hub.md | /weekly hub |
| Daily | spice/daily | /daily |
| Install | .claude/commands/install.md | /install |
| Meetings | spice/meetings | /meetings |
| Projects | spice/projects | /project |
| Scratch | spice/scratch | /scratch |
| Upgrade | .claude/commands/upgrade.md | /upgrade |
<!-- @claude-surface:resolvers END -->

## Directory map (managed by `claude_surface[]`)

<!-- @claude-surface:directory-map BEGIN -->
| Path | Blueprint | Purpose |
| --- | --- | --- |
| spice/ | (platform) | Module-directory namespace for blueprints |
| ranch/ | (platform) | Runtime plumbing (config, scripts, templates, views) |
| .claude/commands/ | (platform) | Slash commands managed via claude_surface[] |
| .claude/skills/ | (platform) | Native Claude Code skill bodies |
<!-- @claude-surface:directory-map END -->

## Skills index (managed by `claude_surface[]`)

<!-- @claude-surface:skills-index BEGIN -->
| Command | SKILL.md | Blueprint/Mechanism |
| --- | --- | --- |
<!-- @claude-surface:skills-index END -->

## What not to do

- Don't bloat this file. It is a router, not a manual — see [`Docs/agent-guides/`](Docs/agent-guides/) for content.
- Don't duplicate content from `Docs/` into the agent-guides, or from agent-guides into this router.
- Don't edit content between `claude-surface` marker pairs. The `platform-claude` mechanism rewrites those regions on every install.
- Don't take destructive, cross-vault, or shared-state actions without confirming — see [`Docs/agent-guides/asking-before-acting.md`](Docs/agent-guides/asking-before-acting.md).
