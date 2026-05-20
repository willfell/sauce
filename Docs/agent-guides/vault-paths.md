---
purpose: Absolute paths to the workshop, consumer vaults, and legacy source vaults on the current developer machine. Load before any work that touches a vault by path.
load_when: Touching any vault path — workshop, consumer, legacy source, or predecessor-machine reference.
---

# Vault paths

> The paths below are **current-machine** (post-2026-05-07). On other machines, substitute the equivalent workshop dev-repo path. Auto-memory entry `project_machine_layout.md` carries the same data for cross-session continuity.

## Workshop dev repo (THIS directory)

```
/Users/willfellhoelter/projects/repos/sauce
```

Canonical platform source-of-truth. Also self-installs as the workshop dogfood vault. All `cd` / harness invocations in docs assume this path.

GitHub remote: `git@github-personal:willfell/sauce.git` (HTTPS: `https://github.com/willfell/sauce`) — personal account `willfellhoelter@gmail.com`.

## Consumer vaults

Post-v0.28.0 migrated Sauce-shape vaults:

| Vault | Path | Role |
| --- | --- | --- |
| `barebones` | `/Users/willfellhoelter/notes/sauce/barebones` | Primary regression target |
| `accuris-sauce` | `/Users/willfellhoelter/notes/sauce/accuris-sauce` | Day-to-day consumer |
| `ero-sauce` | `/Users/willfellhoelter/notes/sauce/ero-sauce` | Day-to-day consumer |
| `headspace-sauce` | `/Users/willfellhoelter/notes/sauce/headspace-sauce` | Day-to-day consumer + smoke-path target |

## Legacy source vaults (READ-ONLY)

Per landmine #20, these are READ-ONLY: they are **only ever inputs** to `sauce migrate --from <path>`. Never written to.

```
/Users/willfellhoelter/notes/accuris
/Users/willfellhoelter/notes/ero-sync/ero
/Users/willfellhoelter/notes/headspace
```

## Predecessor-machine paths (historical reference)

These paths appear in dated handoff / plan / result / prompt docs under `Docs/plans/` + `Docs/prompts/`. **Do NOT edit those for path-update churn** — they are historical artifacts.

```
/Users/willfell/Documents/obsidian/sync/workshop/beacon          (old workshop, pre-rebrand)
/Users/willfell/Documents/obsidian/sync/workshop/barebones-beacon-poc
/Users/willfell/Documents/obsidian/sync/workshop/accuris-beacon-poc
```

## Vault identity check (pre-write)

Before any write to a vault, run `ls <vault-path>` to confirm shape:

- **Workshop** expected top-level: `CLAUDE.md`, `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `platform/`, `commands/`, `Docs/`, `.obsidian/`, `ranch/`, `package.json`, `install.sh`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you are NOT in the workshop. STOP.
- **Consumer** expected top-level: `spice/`, `pantry/`, `ranch/`, `.claude/`, `.obsidian/`, plus the consumer's own personal content. No `platform/` or `commands/`.

The router's "Vault identity check" section enforces this as a pre-write gate.

## Brand history

`sauce` was rebranded from `beacon` in v0.23.0 (resolves macOS APFS case-collision against pre-existing `Beacon/` consumer-side dir; renamed to `pantry/`). Pre-v0.23.0 references in cycle history + plan docs use the `beacon` name and pre-rebrand paths; do not rewrite them.
