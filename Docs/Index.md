# Workshop — Documentation Index

This is the **workshop vault** — the canonical home for the vault platform. Mechanisms (cross-cutting code), blueprints (note-type bundles), and the installer all live here. Consumer vaults (accuris, headspace, ero) subscribe to what they want and pull updates on demand.

## Read in this order

| If you're … | Read |
|---|---|
| **New here, setting up your first vault** | **[getting-started.md](getting-started.md)** (end-to-end ~20-min walkthrough) |
| Going deeper after the quickstart | [why.md](why.md) → [how.md](how.md) → [use.md](use.md) |
| Onboarding a new consumer vault | [use.md](use.md) → [landmines.md](landmines.md) |
| Setting up Claude Cowork scheduled jobs | [cowork-onboarding.md](cowork-onboarding.md) → [cowork-consumer-extensions.md](cowork-consumer-extensions.md) |
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
- **[plans/2026-05-02-vault-platform-implementation.md](plans/2026-05-02-vault-platform-implementation.md)** — 24-task implementation plan covering v0.1.0.
- **[plans/2026-05-03-registry-driven-nav-buttons-result.md](plans/2026-05-03-registry-driven-nav-buttons-result.md)** — v0.1.1 result.
- **[plans/2026-05-04-v0.1.x-validator-subsystem-result.md](plans/2026-05-04-v0.1.x-validator-subsystem-result.md)** — v0.1.x patch result (validator/audit fixes).
- **[plans/2026-05-04-v0.1.3-plugin-data-automation-result.md](plans/2026-05-04-v0.1.3-plugin-data-automation-result.md)** — v0.1.3 result (`applyTemplaterHotkeys` + `applySlashCommanderBindings`; 3-step consumer flow).
- **[plans/2026-05-04-v0.1.2-multi-vault-automation-result.md](plans/2026-05-04-v0.1.2-multi-vault-automation-result.md)** — v0.1.2 result (thin-stub dispatch; bootstrap-copy ritual retired).
- **[plans/2026-05-03-boards-blueprint-design.md](plans/2026-05-03-boards-blueprint-design.md)** — v0.2.0 design (approved; pending plan + execute).

### Prompts

- **[prompts/](prompts/)** — Self-contained agent prompts for specific operations. Each prompt is copy-paste-ready for a fresh session.

## Status (as of 2026-05-04)

- ✅ **v0.1.0 closed** — workshop self-installs four mechanisms + first blueprint.
- ✅ **v0.1.1 CLOSED 2026-05-04** — registry-driven nav-buttons + project blueprint v0.2.0. Result writeup at `plans/2026-05-03-registry-driven-nav-buttons-result.md`. T4.7 deferred with four pre-existing-bug findings.
- ✅ **v0.1.x validator-subsystem patch CLOSED 2026-05-04** — closed Findings #2/#3/#4 at code level. Result at `plans/2026-05-04-v0.1.x-validator-subsystem-result.md`.
- ✅ **v0.1.3 plugin-data automation CLOSED 2026-05-04** — `applyTemplaterHotkeys` + `applySlashCommanderBindings`; landmine #12 (`.obsidian/` allowlist). 3-step consumer flow live. Result at `plans/2026-05-04-v0.1.3-plugin-data-automation-result.md`. Tag `v0.4.1` (retro on `25ef276`).
- ✅ **v0.1.2 multi-vault automation CLOSED 2026-05-04** — thin-stub dispatch retires bootstrap-copy × 3 ritual; `gitState()` records workshop revision into installed.history. Landmines #13 + #14. Result at `plans/2026-05-04-v0.1.2-multi-vault-automation-result.md`. Tag `v0.5.0` annotated; pushed.
- ⬜ **v0.2.0 designed, approved** — boards blueprint (real Obsidian-Kanban-plugin board + Templater date-routed card notes); retires project's Board contribution; codifies module-directory invariant. Design at `plans/2026-05-03-boards-blueprint-design.md`. Plan + execute pending. **Next cycle.**
- ⬜ **Real consumers:** accuris, ero, headspace — gated on barebones success across v0.2.0 + at least one cycle of stability.

**Mechanisms:** `customjs-guard@1.0.0`, `validator@0.1.1`, `audit@0.1.1`, `nav-buttons@2.0.0`.
**Blueprints:** `project@0.2.1` (workshop subscription DROPPED project at v0.1.3 — barebones-only dogfood).
**Workshop version:** `0.5.0` (tag `v0.5.0` annotated and pushed; tag `v0.4.1` retro on `25ef276`).
**Distribution model:** stub-dispatch (post-v0.1.2 S2). Each consumer's `Docs/Meta/Templater/platformInstall.js` is a 20-line content-static thin stub at md5 `a39257da1dd49ae4481e5cd0a42bdac4` across canonical + 3 consumers.
**Landmines list:** 14 entries (#13 stub-static, #14 `gitState()` best-effort added in v0.1.2 S2).
**Load-bearing harnesses:** `platform/test/run-install.js`, `platform/test/run-renderer.js`, `platform/test/run-helper-cases.js` (16 sub-asserts; v0.1.3).
