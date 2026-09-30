---
purpose: Absolute paths to the workshop, consumer vaults, and legacy source vaults on the current developer machine. Load before any work that touches a vault by path.
load_when: Touching any vault path — workshop, consumer, legacy source, or predecessor-machine reference.
---

# Vault paths

> The paths below are **current-machine** (post-2026-05-07). On other machines, substitute the equivalent workshop dev-repo path. Auto-memory entry `machine-layout-willfell.md` carries the same data for cross-session continuity.

## Workshop dev repo (THIS directory)

```
/Users/willfell/Documents/GitHub/sauce
```

Canonical platform source-of-truth. Also self-installs as the workshop dogfood vault. All `cd` / harness invocations in docs assume this path.

GitHub remote: `git@github.com:willfell/sauce.git` (HTTPS: `https://github.com/willfell/sauce`) — personal account `willfellhoelter@gmail.com`.

## Consumer vaults

Post-v0.28.0 migrated Sauce-shape vaults:

| Vault | Path | Role |
| --- | --- | --- |
| `accuris-sauce` | `/Users/willfell/obsidian/accuris-sauce` | Day-to-day consumer |
| `ero-sauce` | `/Users/willfell/obsidian/ero-sauce` | Day-to-day consumer |
| `headspace-sauce` | `/Users/willfell/obsidian/headspace-sauce` | Day-to-day consumer + smoke-path target |

## Consumer workshop resolution: brew (canonical on this machine)

Each consumer vault's `ranch/platform-config.json` declares `workshop_relative_path`. On THIS dev machine, all three consumers point at the **brew-installed** workshop, NOT a local clone:

```json
{ "workshop_relative_path": "/opt/homebrew/opt/sauce/libexec" }
```

All three are registered in `~/.sauce/vaults.json`. Consumers only see a change once it has been released and `brew upgrade sauce` has served it locally.

**Dev override:** `sauce link <checkout>` symlinks `~/.sauce/active-pantry` at a workshop checkout so every `sauce` subcommand dispatches through it; `sauce unlink` reverts to the brew-installed copy (see [`Docs/use.md`](../use.md) § Dev mode). While linked, consumers see whatever HEAD of that checkout is at install time — uncommitted edits and other-branch work propagate — so unlink when done. To materialize a helper edit without linking, run the checkout's installer directly: `node platform/install.js --vault <vault-path> --auto-approve`.

### Long-term maintenance protocol

Run this sequence after a release has shipped and you want consumers aligned. Order matters.

```bash
# 1. Serve the newly released version locally
brew upgrade sauce

# 2. Per consumer vault — bump subscription pins to the brew-installed catalogue (re-runs the installer)
cd /Users/willfell/obsidian/headspace-sauce
sauce update --bump-pins
sauce status                            # expect: Drift: none

cd /Users/willfell/obsidian/accuris-sauce
sauce update --bump-pins
sauce status

cd /Users/willfell/obsidian/ero-sauce
sauce update --bump-pins
sauce status

# 3. Cmd+R in Obsidian on each vault — loads new CustomJS classes
```

**Expected state after a successful upgrade:**

- `Drift: none` on each consumer.
- Workshop `git status` is clean (no uncommitted runtime artifacts).

### Don't ship runtime artifacts

When the workshop is dirty with runtime artifacts (`ranch/claude-surface-registry.json`, `ranch/platform-installed.json`, `ranch/bootstrap-last-install.log`) after a dogfood install, decide explicitly:

- If they reflect a NEW cycle's state → commit them as a "post-cycle dogfood" follow-up (precedent: commits 36097d4 and similar).
- If they're from an accidental `sauce update --help`-triggered self-install → `git checkout --` them.

Never push origin/main with stale runtime artifacts mixed into a feature commit. Always isolate the dogfood refresh into its own commit.

## Legacy source vaults (READ-ONLY)

Per landmine #20, legacy source vaults are READ-ONLY: they are **only ever inputs** to `sauce migrate --from <path>`. Never written to. None are present on this machine (`/Users/willfell/notes/` does not exist here); the paths are listed under the predecessor-machine heading below.

## Predecessor-machine paths (historical reference)

These paths appear in dated handoff / plan / result / prompt docs under `Docs/plans/` + `Docs/prompts/`. **Do NOT edit those for path-update churn** — they are historical artifacts.

```
/Users/willfell/notes/accuris                                    (legacy source vault — not present on this machine)
/Users/willfell/notes/ero-sync/ero                               (legacy source vault — not present on this machine)
/Users/willfell/notes/headspace                                  (legacy source vault — not present on this machine)
/Users/willfell/Documents/obsidian/sync/workshop/beacon          (old workshop, pre-rebrand)
/Users/willfell/Documents/obsidian/sync/workshop/barebones-beacon-poc
/Users/willfell/Documents/obsidian/sync/workshop/accuris-beacon-poc
```

## Vault identity check (pre-write)

Before any write to a vault, run `ls <vault-path>` to confirm shape:

- **Workshop** expected top-level: `CLAUDE.md`, `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `platform/`, `plugins/`, `commands/`, `Docs/`, `.obsidian/`, `ranch/`, `package.json`, `install.sh`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/` at root, you are NOT in the workshop. STOP.
- **Consumer** expected top-level: `spice/`, `ranch/`, `.claude/`, `.obsidian/`, plus the consumer's own personal content. No `platform/` or `commands/`. An in-vault `pantry/` is the retired pre-v0.36.0 layout; it is inert if it remains, as it still does in `ero-sauce`.

The router's "Vault identity check" section enforces this as a pre-write gate.

## Brand history

`sauce` was rebranded from `beacon` in v0.23.0 (resolves macOS APFS case-collision against pre-existing `Beacon/` consumer-side dir; renamed to `pantry/`). Pre-v0.23.0 references in cycle history + plan docs use the `beacon` name and pre-rebrand paths; do not rewrite them.
