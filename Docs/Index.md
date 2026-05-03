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

## Status (as of 2026-05-02)

- ✅ Workshop vault created and self-installs its own platform.
- ✅ Three mechanisms shipped at v1.0.0 / v0.1.0 / v0.1.0:
  - `customjs-guard` — Dataview view + CSS snippet that prevents cold-load `ReferenceError` flashes.
  - `validator` — rule engine + Templater hook that validates notes against `Docs/Meta/rules/*.json`.
  - `audit` — walker that produces a vault audit report.
- ✅ Installer (`tp.user.platformInstall`) at v0.1.0.
- 🔄 First consumer onboarding: `tmp-acc-vault` (test mirror of accuris) — see [prompts/](prompts/).
- ⬜ Real consumers: accuris, ero, headspace.
- ⬜ Blueprints: zero. First blueprint (`project`) is the next major workstream.
