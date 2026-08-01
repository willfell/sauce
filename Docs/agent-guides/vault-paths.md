---
purpose: Absolute paths to the workshop, consumer vaults, and legacy source vaults on the current developer machine. Load before any work that touches a vault by path.
load_when: Touching any vault path — workshop, consumer, legacy source, or predecessor-machine reference.
---

# Vault paths

> The paths below are **current-machine** (post-2026-05-07). On other machines, substitute the equivalent workshop dev-repo path. Auto-memory entry `project_machine_layout.md` carries the same data for cross-session continuity.

## Workshop dev repo (THIS directory)

```
/Users/willfell/Documents/GitHub/sauce
```

Canonical platform source-of-truth. Also self-installs as the workshop dogfood vault. All `cd` / harness invocations in docs assume this path.

GitHub remote: `git@github-personal:willfell/sauce.git` (HTTPS: `https://github.com/willfell/sauce`) — personal account `willfellhoelter@gmail.com`.

## Consumer vaults

Post-v0.28.0 migrated Sauce-shape vaults:

| Vault | Path | Role |
| --- | --- | --- |
| `barebones` | `/Users/willfell/obsidian/barebones` | Primary regression target |
| `accuris-sauce` | `/Users/willfell/obsidian/accuris-sauce` | Day-to-day consumer |
| `ero-sauce` | `/Users/willfell/obsidian/ero-sauce` | Day-to-day consumer |
| `headspace-sauce` | `/Users/willfell/obsidian/headspace-sauce` | Day-to-day consumer + smoke-path target |

## Consumer workshop resolution: local-clone (canonical on this machine)

Each consumer vault's `ranch/platform-config.json` declares `workshop_relative_path`. On THIS dev machine, consumers point at the **local clone** of the workshop, NOT the brew bottle:

```json
{ "workshop_relative_path": "/Users/willfell/Documents/GitHub/sauce" }
```

**Why local clone (not brew bottle):**

- We ship multiple cycles per day during active development; every commit on workshop `main` is instantly available to consumers without a brew round-trip (bottle bump → PR → merge → `brew upgrade`).
- Live debugging works: edit a helper in `platform/blueprints/<x>/helpers/` → re-run `sauce install` → the new code materializes immediately.
- Branch-switching the workshop instantly switches what consumers see — useful for testing branches before merging.

**Tradeoff:** consumers see whatever HEAD of the local workshop is at install time. Uncommitted edits propagate. Other-branch work propagates. Discipline required.

### Long-term maintenance protocol

Run this sequence whenever you've just landed a workshop cycle and want consumers fully aligned. Order matters.

```bash
# 1. Workshop side — confirm clean + on origin/main
cd /Users/willfell/Documents/GitHub/sauce
git status                              # expect: clean working tree
git log --oneline origin/main..HEAD     # expect: empty (no unpushed commits)
git log --oneline HEAD..origin/main     # expect: empty (no unpulled commits)
node platform/test/run-helper-cases.js  # expect: PASS

# 2. Per consumer vault — bump subscription pins to match workshop
cd /Users/willfell/obsidian/headspace-sauce
sauce update --bump-pins
sauce status                            # expect: drift: none + git head matches workshop HEAD

cd /Users/willfell/obsidian/accuris-sauce
sauce update --bump-pins
sauce status

# 3. Cmd+R in Obsidian on each vault — loads new CustomJS classes
```

**Expected state after a successful cycle:**

- `sauce status` on each consumer reports the same `git head <sha>` as the workshop HEAD.
- `Drift: none` on each consumer.
- Workshop `git status` is clean (no uncommitted runtime artifacts).

**When to flip to brew bottle instead:**

Switch consumer `workshop_relative_path` to `/opt/homebrew/opt/sauce/libexec` when:

- You're leaving the machine for an extended period (no active development).
- You want fully reproducible state across machines (CI/cross-machine sync).
- The brew bottle is on a tagged release you trust, and you want frozen behavior.

To switch: edit each consumer's `ranch/platform-config.json` `workshop_relative_path` → `/opt/homebrew/opt/sauce/libexec`. The next `sauce update --bump-pins` will install from the bottle instead.

### Don't ship runtime artifacts

When the workshop is dirty with runtime artifacts (`ranch/claude-surface-registry.json`, `ranch/platform-installed.json`, `ranch/bootstrap-last-install.log`) after a dogfood install, decide explicitly:

- If they reflect a NEW cycle's state → commit them as a "post-cycle dogfood" follow-up (precedent: commits 36097d4 and similar).
- If they're from an accidental `sauce update --help`-triggered self-install → `git checkout --` them.

Never push origin/main with stale runtime artifacts mixed into a feature commit. Always isolate the dogfood refresh into its own commit.

## Legacy source vaults (READ-ONLY)

Per landmine #20, these are READ-ONLY: they are **only ever inputs** to `sauce migrate --from <path>`. Never written to.

```
/Users/willfell/notes/accuris
/Users/willfell/notes/ero-sync/ero
/Users/willfell/notes/headspace
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
