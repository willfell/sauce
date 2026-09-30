# Sauce documentation index

Sauce is a platform for Obsidian vaults that you use by hand and that agents use alongside you. This repository is the workshop: the canonical home for the mechanisms (cross-cutting code), the blueprints (note-type bundles), and the installer. A vault subscribes to the blueprints it wants and updates on demand.

## Read in this order

| If you're … | Read |
|---|---|
| Asking what Sauce is day to day | [README § What you get](../README.md#what-you-get) (the blueprint catalogue) → [README § Two doors into the same vault](../README.md#two-doors-into-the-same-vault) |
| **New here, setting up your first vault** | **[getting-started.md](getting-started.md)** (end-to-end ~20-min walkthrough) |
| Going deeper after the quickstart | [why.md](why.md) → [how.md](how.md) → [use.md](use.md) |
| Onboarding a new consumer vault | [use.md](use.md) → [landmines.md](landmines.md) |
| Setting up Claude Cowork scheduled jobs | [cowork-onboarding.md](cowork-onboarding.md) → [cowork-consumer-extensions.md](cowork-consumer-extensions.md) |
| Adding a new mechanism or blueprint | [how.md](how.md) → [landmines.md](landmines.md) → [plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md) |
| Debugging a failed install | [landmines.md](landmines.md) → [how.md](how.md) (installer section) |
| Running agent work from notes | [engine.md](engine.md) → [comparison.md](comparison.md) |
| Catching up on history | [plans/2026-05-02-customjs-guard-rollout.md](plans/2026-05-02-customjs-guard-rollout.md) → [plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md) → [plans/2026-05-02-vault-platform-implementation.md](plans/2026-05-02-vault-platform-implementation.md) |

## Documents

### Conceptual

- **[why.md](why.md)** — Why this exists. The problem we're solving. The end goal.
- **[how.md](how.md)** — How it works. Architecture, concepts, data flow.
- **[use.md](use.md)** — How to use it. Daily operations: install, audit, add a mechanism, onboard a consumer.
- **[landmines.md](landmines.md)** — Traps we already hit. **Read before any new work.**
- **[engine.md](engine.md)** — The Sauce engine, standalone reference: graph notes, node types, workers, the run ledger, `sauce run`.
- **[comparison.md](comparison.md)** — How the Sauce engine compares to Gas Town, beads-superpowers, and plain agent loops.

### Plans (chronological history)

- **[plans/2026-05-02-customjs-guard-rollout.md](plans/2026-05-02-customjs-guard-rollout.md)** — The original technique authority. Five hard-won landmines for the customjs-guard pattern.
- **[plans/2026-05-02-vault-platform-design.md](plans/2026-05-02-vault-platform-design.md)** — The platform design. Architecture, concepts, migration plan.
- **[plans/2026-05-02-vault-platform-implementation.md](plans/2026-05-02-vault-platform-implementation.md)** — 24-task implementation plan covering v0.1.0.
- **[plans/2026-05-03-registry-driven-nav-buttons-result.md](plans/2026-05-03-registry-driven-nav-buttons-result.md)** — v0.1.1 result.
- **[plans/2026-05-04-v0.1.x-validator-subsystem-result.md](plans/2026-05-04-v0.1.x-validator-subsystem-result.md)** — v0.1.x patch result (validator/audit fixes).
- **[plans/2026-05-04-v0.1.3-plugin-data-automation-result.md](plans/2026-05-04-v0.1.3-plugin-data-automation-result.md)** — v0.1.3 result (`applyTemplaterHotkeys` + `applySlashCommanderBindings`; 3-step consumer flow).
- **[plans/2026-05-04-v0.1.2-multi-vault-automation-result.md](plans/2026-05-04-v0.1.2-multi-vault-automation-result.md)** — v0.1.2 result (thin-stub dispatch; bootstrap-copy ritual retired).
- **[plans/2026-05-03-boards-blueprint-design.md](plans/2026-05-03-boards-blueprint-design.md)** — v0.2.0 design.

### Prompts

- **[prompts/](prompts/)** — Self-contained agent prompts for specific operations. Each prompt is copy-paste-ready for a fresh session.

## Status

Live state (workshop version, mechanism and blueprint catalogue, harness count) is in [agent-guides/cycle-status.md](agent-guides/cycle-status.md).
