---
caption: Install
icon: lucide-download
---

# Sauce install reference

This document covers how to install, update, and safely upgrade consumer vaults using the `sauce` CLI.

## Installation

### Fresh bootstrap

For a new vault:

```bash
sauce bootstrap --vault <path-to-new-vault>
```

Runs the full bootstrap sequence: creates the vault skeleton, installs all mechanisms and subscribed blueprints, writes `ranch/platform-installed.json` and `ranch/platform-subscription.json`.

### Updating an existing vault

```bash
sauce update --bump-pins
```

Re-materializes all files from the workshop's current blueprint versions into the consumer vault. The `--bump-pins` flag updates `ranch/platform-subscription.json` to the latest workshop version before applying. Without `--bump-pins`, the installer re-applies the currently pinned version (useful for idempotent reinstall).

### Installing to the workshop vault itself (dogfood)

From the workshop root:

```bash
node platform/install.js --vault . --auto-approve
```

Used during the S2 verification stage of every release cycle to confirm the workshop installs cleanly against itself.

## Upgrading

### User-content preservation guarantees

The cowork installer is an explicit allowlist. `platform/blueprints/cowork/manifest.json:files[]` declares every destination the installer can write to. ZERO entries in `files[]` match:

- `context/<engagement-id>/` — engagement context directories (user-authored)
- `memory/` — memory files (user-authored per-engagement)
- `daily/`, `weekly/`, `monthly/` — atomic-note output directories (cron-written)
- `snapshots/`, `summaries/` — user synthesis directories

`context/user-preferences.md` and all 5 cadence `prompts/<cadence>.md` files carry `materialize_once: true` — they are written on first install and NEVER overwritten on subsequent updates. Landmine #11 (module-directory invariant) confines cowork writes to `spice/cowork/` regardless.

These guarantees are codified in four safeguards (introduced v0.98.1). See `Docs/plans/2026-06-11-v0.98.1-questionnaire-capture-design.md` § User-content preservation safeguards for rationale and design detail.

### v0.99.0 deploy note (sparse-signal feedback)

- **`learned_weights` schema 3 → 4 in-place migration.** The first post-update 03:00 reconciler run migrates the `learned_weights:` block in `user-preferences.md` frontmatter to schema 4 (block-scoped `.bak`-first rewrite — same contract as every prior migration). The migration keeps each kind's weight + ticks, **ZEROES silence-built skip counters, and re-enters every kind into warmup. This is BY DESIGN, not data loss** — under the pre-v0.99.0 semantics, every surfaced-but-unticked kind counted as a skip, so those counters were silence-contaminated, never user signal. Graduation now requires 7 ENGAGED days (days with real feedback gestures) plus 7 observations.
- **EOD Rail L renders v=3** after the post-update `align-scheduled-jobs` run: one-tap `Useful: [ ] yes [ ] no` + free-text box on top, per-kind lists collapsed below. Old v=1/v=2 notes stay readable forever (tolerant parsers).
- **`realclaudian` no longer auto-installs.** The plugin was delisted from the upstream obsidian-releases index, so it was removed from the convenience mechanism's `external_plugins[]` (convenience 0.4.1). **Already-installed copies are untouched** — the installer never uninstalls plugins; the entry's removal only stops fresh installs from erroring against the dead index entry.

### v0.98.2 deploy note (feedback-loop closure)

The v0.98.2 update materializes:

- NEW `spice/cowork/helpers/ingest-feedback-helper.js` (deterministic core for reconciler ingest)
- NEW `.claude/skills/cowork/skills/ingest-feedback/SKILL.md` shim
- Updated `compose-feedback-capture-helper.js` (v=2 Rail L shape — adds Didn't-like list)
- Updated `learn-from-checks-helper.js` (v=2 parse + Tasks-plugin trailing-annotation tolerance)
- Updated `write-atomic-note-helper.js` (sidecar `items[]` registry passthrough)
- Updated `reconcile-cowork.md` / `eod-review.md` / `morning-briefing.md` / `_shared-clauses.md` orchestrator-instructions
- Updated `data/schemas/eod-review@1.0.0.json` — `schema_version` enum gains `"1.2.0"` (additive; pre-1.2.0 sidecars still validate)

**User-content safeguards UNCHANGED from v0.98.1.** All four safeguards hold. `learned_weights` migrates schema 2 → 3 IN PLACE on `user-preferences.md` frontmatter (block-scoped `.bak`-first rewrite of ONLY the `learned_weights:` block; the existing reconciler contract, unchanged in kind). New per-engagement files (`feedback-deltas.md`, `voice-proposals.md`, `coverage-queue.md`) are runtime-created by the reconciler session via Obsidian MCP — NOT installer-materialized, NO `files[]` entries, Safeguard 3 stays green by construction.

**Accuris two-version catch-up is SAFE.** If a consumer vault sat at workshop 0.98.0 / cowork 0.36.0 (skipping v0.98.1), ONE `sauce update --bump-pins` invocation cleanly catches BOTH v0.98.1 AND v0.98.2 deltas in a single materialize pass. Verify post-install with `jq -r '.workshop_version' ranch/platform-subscription.json` (expect `0.98.2`) and confirm both `compose-feedback-capture-helper.js` (v0.98.1) AND `ingest-feedback-helper.js` (v0.98.2) materialize at `spice/cowork/helpers/`. Pre-deploy snapshot per Safeguard 1 strongly recommended for two-version jumps.

After `sauce update --bump-pins`, run `/cowork sync-scheduled-jobs` once per vault from claude.ai's Cowork UI — Rail A pushes new wrapper bodies (contract_version stays at 0.35.1; the new substitution tokens `{{$voice_proposals_count}}` + `{{$voice_proposal_lines}}` flow through wrapper template substitution; schedule preservation invariant holds — cron field NEVER touched).

---

### Safeguard 1 — Pre-deploy snapshot recipe

Run before EVERY `sauce update --bump-pins` that touches a version boundary:

```bash
# From the consumer vault root:
mkdir -p ~/cowork-snapshots
tar -czf ~/cowork-snapshots/$(basename "$PWD")-pre-$(date -u +%Y%m%dT%H%M%SZ).tar.gz \
  spice/cowork/context \
  spice/cowork/memory \
  spice/cowork/daily spice/cowork/weekly spice/cowork/monthly \
  vault-config.md user-preferences.md 2>/dev/null || true
```

Snapshots land in `~/cowork-snapshots/` (outside the vault tree) so future installs cannot clobber them. Restore is:

```bash
# Selective restore to a temp dir, then copy the file(s) you need:
mkdir -p /tmp/cowork-restore
tar -xzf ~/cowork-snapshots/<snapshot-name>.tar.gz -C /tmp/cowork-restore
```

The dated tarball is the durable rollback path. Do not rely on `.bak` files for rollback (see Safeguard 4).

---

### Safeguard 2 — Post-install diff verification

Verify that NO user-owned file was touched after the update:

```bash
# Just BEFORE running the update:
touch ~/.sauce/pre-update-marker

# Run the update:
sauce update --bump-pins

# Verify NO user-owned file was touched:
find spice/cowork/context spice/cowork/memory -newer ~/.sauce/pre-update-marker -type f
# Expected output: EMPTY (no matches)
```

If any files appear in the output, the installer wrote to a user-owned path — this is a bug. Stop, restore from the Safeguard 1 tarball, and file an issue.

---

### Safeguard 3 — Automated forbidden-paths guard (CI)

`scripts/check-files-forbidden-paths.js` is wired into `npm run release:preflight`. It fails the preflight if any `files[]` entry in any blueprint manifest carries a `dest` path matching the forbidden patterns above (`context/<engagement-id>/`, `memory/`, `daily/`, `weekly/`, `monthly/`, `snapshots/`, `summaries/`).

This guard runs on EVERY release cycle in the workshop. A workshop release that inadvertently adds a user-content path to `files[]` cannot ship — the guard catches it before the tag is created.

Users do not need to run this guard directly. It is a workshop-side CI safeguard.

---

### Safeguard 4 — .bak tripwire (single-shot, NOT durable rollback)

The installer writes a `.bak` copy whenever it would overwrite a file that already exists and whose content has changed. For example, updating `helpers/compose-body-helper.js` produces `helpers/compose-body-helper.js.bak`.

**Important:** `.bak` is a SINGLE-SHOT tripwire — not a multi-version rollback path. The second update overwrites the first `.bak`. It answers "did the installer touch this file in the LAST update?" not "what did this file contain two versions ago?"

Use the `.bak` tripwire to confirm WHICH files the installer just touched. Use the Safeguard 1 dated tarball as the durable rollback path.

---

## Checking the installed version

```bash
# Workshop version pinned in the consumer vault:
jq -r '.workshop_version' ranch/platform-subscription.json

# Cowork blueprint version:
jq -r '.blueprints[] | select(.name == "cowork") | .version' ranch/platform-subscription.json

# Installed workshop version (set at install time):
jq -r '.workshop_version' ranch/platform-installed.json

# CLI version (installed via brew):
sauce --version
```

## Common issues

### `--bump-pins` no-ops silently

This happens when the consumer vault is already at the current workshop version. Confirm with `jq -r '.workshop_version' ranch/platform-subscription.json`. If it already shows the target version, the update is a no-op. To force re-materialize without a version bump, run `sauce update` (without `--bump-pins`).

### `version-sync` error during preflight

```
check-version-sync.js: FAIL — version mismatch
```

Indicates `package.json`, `platform/manifest.json`, `platform/blueprints/cowork/manifest.json`, and/or `ranch/platform-subscription.json` are out of sync. Run `npm run release:preflight` to see the full diagnostic. All four must agree on the same workshop version.
