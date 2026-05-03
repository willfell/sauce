# Workshop — Documentation Index

This is the **workshop vault** — the canonical home for the vault platform. Mechanisms (cross-cutting code), blueprints (note-type bundles), and the installer all live here. Consumer vaults (accuris, headspace, ero) subscribe to what they want and pull updates on demand.

## Read in this order

| If you're … | Read |
|---|---|
| New to the platform | [why.md](why.md) → [how.md](how.md) → [use.md](use.md) |
| Onboarding a new consumer vault | [use.md](use.md) → [landmines.md](landmines.md) |
| Adding a new mechanism or blueprint | [how.md](how.md) → [landmines.md](landmines.md) → [plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md) |
| Debugging a failed install | [landmines.md](landmines.md) → [how.md](how.md) (installer section) |
| Catching up on history | [plans/2026-05-02-customjs-guard-rollout.md](plans/2026-05-02-customjs-guard-rollout.md) → [plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md) → [plans/2026-05-02-vault-platform-implementation.md](plans/2026-05-02-vault-platform-implementation.md) |

## Documents

### Conceptual

- **[why.md](why.md)** — Why this exists. The problem we're solving. The end goal.
- **[how.md](how.md)** — How it works. Architecture, concepts, data flow.
- **[use.md](use.md)** — How to use it. Daily operations: install, audit, add a mechanism, onboard a consumer.
- **[landmines.md](landmines.md)** — Traps we already hit. **Read before any new work.**

### Plans (chronological history)

- **[plans/2026-05-02-customjs-guard-rollout.md](plans/2026-05-02-customjs-guard-rollout.md)** — The original technique authority. Five hard-won landmines for the customjs-guard pattern.
- **[plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md)** — The platform design. Architecture, concepts, migration plan.
- **[plans/2026-05-02-vault-platform-implementation.md](plans/2026-05-02-vault-platform-implementation.md)** — 24-task implementation plan. Phases 0-6 complete; Phase 7 in progress.

### Prompts

- **[prompts/](prompts/)** — Self-contained agent prompts for specific operations. Each prompt is copy-paste-ready for a fresh session.

## Status (as of 2026-05-04)

- ✅ **v0.1.0 closed** — workshop self-installs four mechanisms + first blueprint.
- ✅ **v0.1.1 CLOSED** — result writeup at `plans/2026-05-03-registry-driven-nav-buttons-result.md`. All deliverables green; T4.7 deferred with four pre-existing-bug findings logged for next cycle.
- ⬜ **v0.1.x patch (proposed)** — fix the four T4.7 findings (validator/audit subsystem bugs, runner-UX gaps).
- ⬜ **v0.1.2 designed** — git-based pull + thin stub bootstrap. See `plans/2026-05-03-multi-vault-automation-design.md`.
- ⬜ **v0.2.0 designed, approved** — boards blueprint (real Obsidian-Kanban-plugin board + Templater date-routed card notes); retires project's Board contribution; codifies module-directory invariant. See `plans/2026-05-03-boards-blueprint-design.md`.
- ⬜ **Real consumers:** accuris, ero, headspace — gated on barebones success across v0.1.x + v0.1.2 + v0.2.0.

**Mechanisms:** `customjs-guard@1.0.0`, `validator@0.1.0` (with known bugs), `audit@0.1.0` (with known bugs), `nav-buttons@2.0.0`.
**Blueprints:** `project@0.2.0`.
**Workshop version:** `0.4.0`.
**Load-bearing harnesses:** `platform/test/run-install.js`, `platform/test/run-renderer.js`.
