# Cowork customization contract

This guide enumerates which files in a consumer vault are STOCK (overwritten
on every `sauce update`) and which are USER (preserved across `sauce update`).
It is the single source of truth for v0.76.0+ user-owned content; future
cycles that add new user-owned files MUST update this guide and the
HC-V0760-A1 preservation harness lockstep.

## STOCK — overwritten by `sauce update` / `sauce reinstall`

| Path | Source | Notes |
|---|---|---|
| `spice/cowork/context/engagement-templates/**/*.md` | `platform/blueprints/cowork/content/context/engagement-templates/**` | All 15 prompt files + 7 context defaults per engagement-type. Stripped of emoji in v0.75.1. |
| `spice/cowork/context/engagement-shared-templates/*.md` | `platform/blueprints/cowork/content/context/engagement-shared-templates/**` | active-threads.md, vault-config.md, weekly-snapshot.md SEED templates only — NOT the runtime files at `spice/cowork/context/`. |
| `spice/cowork/scheduled-jobs.md` | `platform/blueprints/cowork/content/scheduled-jobs.md` | `cowork:onboard-scheduled-jobs` rewrites this as the user adds/removes jobs; `sauce reinstall` reverts to template. |
| `.claude/skills/cowork/**/SKILL.md` | `platform/blueprints/cowork/skills/**` | All skill bodies are `claude_surface`-managed STOCK. |
| `spice/cowork/Cowork.md` + hubs (Daily Hub / Weekly Hub / Monthly Hub / Today) | `platform/blueprints/cowork/content/*.md` | Hub notes — STOCK. |
| `spice/cowork/About Cowork.md` | `platform/blueprints/cowork/content/About Cowork.md` | STOCK. |

## USER — preserved across `sauce update`

| Path | First-install source | Preservation mechanism |
|---|---|---|
| `spice/cowork/context/vault-config.md` | `cowork:bootstrap-vault` writes from engagement-shared-templates seed | Not in `files[]`; bootstrap seeds once. |
| `spice/cowork/context/active-threads.md` | `cowork:bootstrap-vault` writes empty | Not in `files[]`. |
| `spice/cowork/context/weekly-snapshot.md` | `cowork:bootstrap-vault` writes empty | Not in `files[]`. |
| `spice/cowork/context/user-preferences.md` | `install.js` seeds from template | `materialize_once: true` in manifest (v0.59.9 flag). |

## USER-DRAFTABLE WITH BACKUP — overwritten on reinstall but prior content preserved as `.bak`

These files behave hybridly: they ARE in cowork's `files[]` array (so `sauce reinstall` overwrites them with the stock content), BUT install.js's v0.2.0 Option B mechanic writes the prior content to a sibling `<path>.bak` file before overwriting. The user's edits are recoverable from the `.bak` file but the live file gets replaced.

| Path | Stock source | Notes |
|---|---|---|
| `spice/cowork/prompts/morning-briefing.md` | `platform/blueprints/cowork/content/prompts/morning-briefing.md` | Seeded by `onboard-scheduled-jobs` from engagement-template defaults; user-edited prompts get backed up + overwritten on `sauce reinstall`. |
| `spice/cowork/prompts/midday-tripwire.md` | same | same |
| `spice/cowork/prompts/eod-review.md` | same | same |
| `spice/cowork/prompts/weekly-review.md` | same | same |
| `spice/cowork/prompts/monthly-review.md` | same | same |

**v0.77.0 candidate:** decide whether these 5 files should be promoted to strict USER (add `materialize_once: true` to manifest entries) OR retained as USER-draftable-with-backup. The hybrid behavior is functional but counterintuitive — the boundary contract clarity would benefit from making this binary.

## Why USER files MUST stay out of `files[]` (or carry `materialize_once: true`)

Adding a strict-USER file to a blueprint's `files[]` entry without
`materialize_once: true` will cause `sauce reinstall` to overwrite user
state (with `.bak` backup, but live file is replaced). The `HC-V0760-A1`
preservation harness fails closed against this mistake for the
`user-preferences.md` path.

The `materialize_once: true` flag (added in v0.59.9 of `platform/install.js`)
implements strict protection: when the dest file already exists, the
installer logs `action: skipped_materialize_once` in
`ranch/platform-installed.json` history and continues without overwriting.
v0.76.0 reuses this flag for `user-preferences.md` — no new mechanism
needed.

## When to add a new USER file

If a future cycle introduces another user-owned file:

1. Add the path to this contract's USER table (with first-install source and
   preservation mechanism).
2. Choose preservation mechanism — either:
   - **`bootstrap-vault` seeding** (file is NOT in `files[]`; bootstrap-vault writes once); or
   - **`materialize_once: true`** (file IS in `files[]` with the flag — strict preservation); or
   - **`.bak` backup** (file IS in `files[]` without the flag — overwrites with backup, the current default for cowork prompts).
3. Add the path to `HC-V0760-A1`'s `FOCUSED_USER_PATHS` list in
   `platform/test/run-cowork-smoke.js` if using strict-USER (materialize_once).

A future variant: `check-customization-preservation` harness that diffs
expected-stock vs expected-user file lists against the cowork manifest
to catch silent drift. Deferred from v0.76.0.

## Reference

- Source: v0.76.0 Workstream G (Docs/plans/2026-05-23-v0.76.0-cowork-interactive-context-design.md §9).
- Related: `materialize_once` introduced v0.59.9 (kanban-board protection).
- v0.76.0 preservation harness: `HC-V0760-A1` in `platform/test/run-cowork-smoke.js`.
- v0.77.0 candidate: promote the 5 cowork prompts to strict USER (`materialize_once`) OR keep as USER-draftable-with-backup.
