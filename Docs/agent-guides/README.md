---
purpose: On-demand reference loaded by `CLAUDE.md`'s "Further reading" routing — extends the existing `Docs/` documentation with task-shaped views.
---

# Agent guides

Deep reference loaded on demand. The root `CLAUDE.md` names these guides under "Further reading" with an `**IMPORTANT:**` directive that tells Claude to identify and read the relevant ones **before** starting a task.

These guides are not auto-injected into every conversation. They earn their context-window cost only when the task actually needs them.

## Files in this directory

| Guide | When to load |
| --- | --- |
| [architecture.md](architecture.md) | Touching mechanisms, blueprints, the installer, the distribution model, or `claude_surface[]`. |
| [build-test-verify.md](build-test-verify.md) | Running preflight, cutting a release, brew-tap workflow, dogfooding the workshop, debugging a failed install. |
| [code-conventions.md](code-conventions.md) | Writing or editing any mechanism / blueprint / installer code. Covers the five non-negotiables, JSON-not-YAML, `{{template_variables}}`, customjs-guard, module-directory invariant. |
| [vault-paths.md](vault-paths.md) | Anything that touches a vault path. Workshop, consumers, legacy source vaults, predecessor-machine paths. |
| [cycle-status.md](cycle-status.md) | Current platform state: workshop version, mechanism + blueprint catalogue, harness count, landmines summary, in-flight queue. Updated at every cycle close. |
| [asking-before-acting.md](asking-before-acting.md) | Before any destructive/shared/cross-vault action. The full ask-before list with landmine context. |
| [project-blueprint-ui.md](project-blueprint-ui.md) | Editing any project-blueprint helper or template. Shared rendering primitives (Breadcrumb, SectionLabel, DocSearch, EntityCreate) + section ordering + spacing rules locked in v0.109.0. |
| [migration-regression-net.md](migration-regression-net.md) | Adding an install-time migration, editing `platform/test/seed-vault/`, authoring an `HC-V0XYZ-SEED-*` family, running `npm run seed:rebaseline`, or debugging `run-seed-migrations.js` on CI. |
| [note-chrome.md](note-chrome.md) | Vault-wide chrome standard (breadcrumb/nav grammar, dividers, migration posture). **New features (all blueprints) follow this grammar.** |
| [dev-workflow.md](dev-workflow.md) | Day-to-day workflow: `npm run status` first; local-clone vs brew; per-vault sync; the four scripts (workshop-status, regen-cycle-status, scaffold-behavioral-harness, dev-sync). |
| [delivery-board.md](delivery-board.md) | Epic-centric delivery board topology, `discarded` tombstone governance, supersede-at-mint, reap/restructure/cutover, retroactive digest. Read before touching the board, coordinator lifecycle, or intake supersession. |
| [sauce-plugin.md](sauce-plugin.md) | The sauce plugin (`plugins/sauce/`, published via sauce's own marketplace): install/reload for Claude + Codex, `.loop/config.json` binding contract, skill surface, Codex router generation. Sauce's own runtime copy of the binding resolver lives at `scripts/autoloop/loop-config.js`. Read before touching the plugin, the binding resolver, or the sauce skill surface. |
| [engine.md](engine.md) | The Sauce engine: runtime layout under `platform/engine/`, the invariants (append-only ledger, no index, result.json by rename, never writes boards), the four harnesses. Read before touching `platform/engine/`, `platform/cli/cmd-run.js`, or the delivery-slice graph. |
| [finance-blueprint.md](finance-blueprint.md) | Canonical finance reference (entities, `FinanceMath` engine, Finance Plan, widgets, install heals). Read before any finance work. |
| [wiki-blueprint.md](wiki-blueprint.md) | Canonical wiki reference (folder-is-truth, render helpers, chrome, move dialog, install heal). Read before any wiki work. |
| [trips-blueprint.md](trips-blueprint.md) | Canonical trips reference (folder-is-truth, collision-free naming, launcher nav, conformance heal). Read before any trips work. |
| [reader-blueprint.md](reader-blueprint.md) | Canonical reader reference (flat reading queue, status-in-frontmatter, Web Clipper capture flow, scaffold heal). Read before any reader work. |
| [schemas.md](schemas.md) | Schema registry (`platform/schemas-index.json`) + `npm run lint-schemas`. Read before designing any feature that touches frontmatter, sidecars, contracts, or learned state. |
| [cowork-customization-contract.md](cowork-customization-contract.md) | Which cowork consumer-vault files are STOCK vs USER-owned. Read before adding a new user-owned cowork file. |
| [cowork-orchestrator-template.md](cowork-orchestrator-template.md) | Structural contract every cowork atomic-note orchestrator must conform to. Read before authoring or refactoring an orchestrator. |

## What does not belong here

- **One-line facts that fit in the router itself** — those live in `CLAUDE.md`.
- **Procedures that recur enough to deserve a skill** — those live under `.claude/skills/<bp>/` and are materialized by the installer.
- **Content already covered by `Docs/why.md` / `Docs/how.md` / `Docs/use.md` / `Docs/landmines.md` / `Docs/cycle-history.md`** — guides point at those rather than duplicate.

Pick one home per fact. Duplication rots the moment one copy changes.

## How this dovetails with `Docs/`

The platform's hand-authored reference docs (`Docs/why.md`, `Docs/how.md`, `Docs/use.md`, `Docs/landmines.md`, `Docs/cycle-history.md`, `Docs/Index.md`) are the **canonical sources**. These agent-guides are task-shaped pointers into them — designed to be the right slice for whatever Claude is about to do — and never duplicate their content.

If a guide here repeats a paragraph from `Docs/how.md`, the guide is wrong. Reword as "see `Docs/how.md` § <section>" instead.
