---
description: Re-run sauce installer against current subscription
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /install

Re-runs `sauce update` for the current vault against `ranch/platform-subscription.json`. Use this after:
- Pulling a workshop update (`cd ~/sauce && git pull`)
- Editing `ranch/platform-subscription.json` (subscription drift)
- Manually placing files under `.claude/commands.local/` or `.claude/skills.local/` (re-apply shadow shim)

The skill at `.claude/skills/platform/install/SKILL.md` shells out to `sauce update --vault $(pwd)` and renders the install ledger delta.

---

## Upgrading from v0.74.0 → v0.75.0

> **Note:** This section was backfilled at v0.75.1 — the v0.75.0 cycle only wrote to the dest, not this source template.

v0.75.0 ships a new `smart-connections-bridge` mechanism. Because `--bump-pins` does not auto-subscribe new mechanisms, you must opt in manually before the first update:

```bash
# 1. Patch workshop_path into every consumer vault's platform-installed.json
#    (v0.75.0 deploy found this was null everywhere; --bump-pins needs it)
BREW_PATH="/opt/homebrew/Cellar/sauce/0.75.0/libexec"
for vault in <list-of-vault-paths>; do
  f="$vault/ranch/platform-installed.json"
  jq --arg p "$BREW_PATH" '.workshop_path = $p' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 2. Subscribe each vault to smart-connections-bridge@0.1.0
for vault in <list-of-vault-paths>; do
  f="$vault/ranch/platform-subscription.json"
  jq '.mechanisms += [{"name":"smart-connections-bridge","version":"0.1.0"}]' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done

# 3. Run bump-pins + reinstall per vault
cd <vault-path>
sauce update --bump-pins   # bumps pin floors from workshop manifest
sauce reinstall --vault .  # materializes updated subscription
```

After install, run `cowork:onboard-scheduled-jobs` (or the Layer 3 manual recipe) to update your scheduled-tasks-MCP entries with the v0.75.0 enriched prompts that instruct the cron-fired agent to READ sub-skill SKILL.md bodies.

**Known issue with `sauce update` in this release:** the standard `sauce update` flow (without `--bump-pins`) attempts a git fetch against the consumer vault, which fails with `fatal: not a git repository` (consumer vaults are not git repos). Workaround: use `sauce reinstall --vault <path>` after `--bump-pins`. Both issues are fixed in v0.75.1.

---

## Upgrading from v0.75.0 → v0.75.1

v0.75.1 fixes the two deploy pain-points documented above. The two manual jq-patches from the v0.75.0 recipe are **no longer needed**.

### What changed

- **`sauce update --bump-pins` auto-detects `workshop_path`** when the field is null in `ranch/platform-installed.json`. It walks the ancestry of `process.execPath` to find the brew-installed `libexec` directory. This means the step-5 `workshop_path` jq-patch is no longer needed.
- **`sauce update` is brew-aware** (Workstream B). The old git-fetch + reset path has been removed; `sauce update` now delegates directly to `bootstrap.phaseRunInstaller` — the same code-path `sauce reinstall` uses. No more `fatal: not a git repository` errors against consumer vaults.
- **`installed.workshop_version` is refreshed on every install.** The top-level `workshop_version` field in `ranch/platform-installed.json` now reflects the installed version (was always null in pre-v0.75.1 vaults). You can verify with: `jq -r .workshop_version ranch/platform-installed.json`.
- **sc-bridge `--quiet` actually suppresses non-fatal stderr.** The "skipping unparseable .ajson" warning is now suppressed when `--quiet` is passed (Workstream D).
- **93 emoji characters stripped from 15 engagement-template prompts** (Workstream G). Callout titles now rely on Obsidian's built-in SVG icons rather than emoji prefixes.
- **Morning-briefing semantic-warning misfire fixed** (Workstream H). A calendar-empty fire no longer surfaces a "Semantic index not available" warning; the warning is gated on step 12b having actually run.

### Upgrade procedure

```bash
# One-command update per vault (no jq-patches needed):
cd <vault-path>
sauce update --bump-pins
```

That's it. `--bump-pins` now resolves the workshop path automatically and the subsequent update is brew-aware.

**If auto-detection fails** (e.g., the workshop path is in an unusual location or you are running from the workshop repo itself), use the explicit override:

```bash
sauce update --bump-pins --workshop-path /opt/homebrew/Cellar/sauce/0.75.1/libexec
```

### Workshop self-install (workshop-as-vault)

The workshop's own `ranch/platform-installed.json` lacks a `workshop_path` field (it would be circular). Auto-detection looks for a `libexec` ancestor of `process.execPath` — but when running via `node platform/test/run-install.js .` directly (not via a brew-installed binary), there is no such ancestor. Workshop dogfood path remains:

```bash
node platform/test/run-install.js .
```
