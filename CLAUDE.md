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
- [`Docs/agent-guides/project-blueprint-ui.md`](Docs/agent-guides/project-blueprint-ui.md) — shared rendering primitives (Breadcrumb, SectionLabel, DocSearch) + section-ordering + spacing conventions for the project blueprint.
- [`Docs/agent-guides/note-chrome.md`](Docs/agent-guides/note-chrome.md) — vault-wide chrome standard (breadcrumb/nav grammar, dividers, migration posture). **New features (all blueprints) follow this grammar.**
- [`Docs/agent-guides/dev-workflow.md`](Docs/agent-guides/dev-workflow.md) — day-to-day workflow: `npm run status` first; local-clone vs brew; per-vault sync; the four scripts (workshop-status, regen-cycle-status, scaffold-behavioral-harness, dev-sync).
- [`Docs/agent-guides/delivery-board.md`](Docs/agent-guides/delivery-board.md) — epic-centric delivery board topology, `discarded` tombstone governance, supersede-at-mint, reap/restructure/cutover, retroactive digest. Read before touching the board, coordinator lifecycle, or intake supersession.
- [`Docs/agent-guides/finance-blueprint.md`](Docs/agent-guides/finance-blueprint.md) — canonical finance reference (entities, `FinanceMath` engine, Finance Plan, widgets, install heals). Read before any finance work.
- [`Docs/agent-guides/wiki-blueprint.md`](Docs/agent-guides/wiki-blueprint.md) — canonical wiki reference (folder-is-truth, render helpers, chrome, move dialog, install heal). Read before any wiki work.
- [`Docs/agent-guides/trips-blueprint.md`](Docs/agent-guides/trips-blueprint.md) — canonical trips reference (folder-is-truth, collision-free naming, launcher nav, conformance heal). Read before any trips work.
- [`Docs/agent-guides/reader-blueprint.md`](Docs/agent-guides/reader-blueprint.md) — canonical reader reference (flat reading queue, status-in-frontmatter, Web Clipper capture flow, scaffold heal). Read before any reader work.
- [`Docs/agent-guides/schemas.md`](Docs/agent-guides/schemas.md) — schema registry (`platform/schemas-index.json`) + `npm run lint-schemas`. Read before designing any feature that touches frontmatter, sidecars, contracts, or learned state.
- [`Docs/agent-guides/migration-regression-net.md`](Docs/agent-guides/migration-regression-net.md) — seed-vault harness, per-cycle authoring loop, portable-sentinel pattern. Load when adding migrations or editing `platform/test/seed-vault/`.
- [`Docs/agent-guides/vault-paths.md`](Docs/agent-guides/vault-paths.md) — workshop / consumer / legacy source vault paths on this machine.
- [`Docs/agent-guides/cycle-status.md`](Docs/agent-guides/cycle-status.md) — live workshop version, mechanism + blueprint catalogue, harness count, in-flight queue.
- [`Docs/agent-guides/asking-before-acting.md`](Docs/agent-guides/asking-before-acting.md) — full ask-before list with landmine context.
- [`Docs/agent-guides/cowork-customization-contract.md`](Docs/agent-guides/cowork-customization-contract.md) — which cowork consumer-vault files are STOCK vs USER-owned. Read before adding a new user-owned cowork file.
- [`Docs/agent-guides/cowork-orchestrator-template.md`](Docs/agent-guides/cowork-orchestrator-template.md) — structural contract every cowork atomic-note orchestrator must conform to. Read before authoring or refactoring an orchestrator.
- [`Docs/landmines.md`](Docs/landmines.md) — canonical traps with rationale. Always non-negotiable.
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
| Cowork Atomic Notes (cron output) | spice/cowork/daily/ | (cron-only — NOT spice/daily/) |
| Cowork Daily Hub | spice/cowork/Daily Hub.md | /cowork |
| Cowork Discover People | spice/cowork/skills/orchestrators/discover-people/SKILL.md | /cowork discover-people |
| Cowork Find Missing People | spice/cowork/skills/orchestrators/find-missing-people/SKILL.md | /cowork find-missing-people |
| Cowork Memory | spice/cowork/memory/ | /cowork memory |
| Cowork Monthly Hub | spice/cowork/Monthly Hub.md | /monthly hub |
| Cowork Prompts | spice/cowork/prompts/ | /cowork prompts |
| Cowork Sync Scheduled Jobs | spice/cowork/skills/orchestrators/sync-scheduled-jobs/SKILL.md | /cowork sync-scheduled-jobs |
| Cowork Weekly Hub | spice/cowork/Weekly Hub.md | /weekly hub |
| Daily | spice/daily | /daily |
| Home | spice/home | /home |
| Install | .claude/commands/install.md | /install |
| Meetings | spice/meetings | /meetings |
| Projects | spice/projects | /project |
| Reader | spice/reader | /reader |
| Sticky Notes | spice/sticky-notes | /sticky-notes |
| Upgrade | .claude/commands/upgrade.md | /upgrade |
| Wiki | spice/wiki | /wiki |
<!-- @claude-surface:resolvers END -->

## Directory map (managed by `claude_surface[]`)

<!-- @claude-surface:directory-map BEGIN -->
| Path | Blueprint | Purpose |
| --- | --- | --- |
| spice/ | (platform) | Module-directory namespace for blueprints |
| spice/resources/ | (platform) | Vault default attachment + new-note targets |
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
- Don't manually version, tag, sweep version pins, or merge the release PR — the release pipeline is **fully automatic**. Write conventional commits and merge feature work to `main`; see [`Docs/agent-guides/build-test-verify.md`](Docs/agent-guides/build-test-verify.md) § Release workflow for what the bumper handles and what's off-limits to hand-edit.
- Don't take destructive, cross-vault, or shared-state actions without confirming — see [`Docs/agent-guides/asking-before-acting.md`](Docs/agent-guides/asking-before-acting.md).
