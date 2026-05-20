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

## What does not belong here

- **One-line facts that fit in the router itself** — those live in `CLAUDE.md`.
- **Procedures that recur enough to deserve a skill** — those live under `.claude/skills/<bp>/` and are materialized by the installer.
- **Content already covered by `Docs/why.md` / `Docs/how.md` / `Docs/use.md` / `Docs/landmines.md` / `Docs/cycle-history.md`** — guides point at those rather than duplicate.

Pick one home per fact. Duplication rots the moment one copy changes.

## How this dovetails with `Docs/`

The platform's hand-authored reference docs (`Docs/why.md`, `Docs/how.md`, `Docs/use.md`, `Docs/landmines.md`, `Docs/cycle-history.md`, `Docs/Index.md`) are the **canonical sources**. These agent-guides are task-shaped pointers into them — designed to be the right slice for whatever Claude is about to do — and never duplicate their content.

If a guide here repeats a paragraph from `Docs/how.md`, the guide is wrong. Reword as "see `Docs/how.md` § <section>" instead.
