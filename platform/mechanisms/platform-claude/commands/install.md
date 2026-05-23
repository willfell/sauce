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

---

## Upgrading from v0.75.1 → v0.76.0

v0.76.0 closes residual deploy bugs from v0.75.1 AND ships the first half of cowork's interactive-context personalization.

### What changed

- **`sauce update --bump-pins` now works without `--workshop-path`** (was the workaround in v0.75.1). The `_resolveWorkshopPath` ancestry walk previously used `process.execPath` (the Node binary) which has no `libexec/platform` ancestor on real brew installs — the v0.75.1 test mock hid the bug. v0.76.0 anchors the walk on `__filename` (cmd-update.js's own source path), which resolves to the workshop libexec on every brew install.
- **Stale `installed.workshop_path` values are auto-invalidated.** When `brew cleanup` removes an old keg between sauce-tap releases, the persisted `workshop_path` in `ranch/platform-installed.json` becomes a dead path. v0.76.0 probes for `platform/manifest.json` at the candidate; if absent, falls through to ancestry walk.
- **eod-review + weekly-review semantic-warning parity with morning-briefing.** Both orchestrators now gate the "Smart Connections index absent" callout on the corresponding semantic gather step having actually run, and emit the canonical text verbatim from `gather-semantic-related`'s contract. Matches morning-briefing's v0.75.1 H fix.
- **eod/weekly/monthly engagement-template prompt fallback.** When `spice/cowork/prompts/<orch>.md` is empty, the Write step now reads `spice/cowork/context/engagement-templates/<engagement.type>/prompts/<orch>.md` as a fallback before stub-firing. `prompt_source` frontmatter records which source drove the run.
- **NEW user-owned file at `spice/cowork/context/user-preferences.md`** — protected by `materialize_once: true` (re-uses the v0.59.9 manifest flag). Seeded at install time; preserved across all subsequent `sauce update` / `sauce reinstall`.
- **NEW `cowork:context-builder` orchestrator-tier skill** — 14 hand-curated questions across 4 MCP-kinds (calendar, gmail, imessage, finance) + cross-cutting priorities + personality. Writes `user-preferences.md`. Invokable directly via Claude Code skill invocation, OR auto-delegated by `cowork:onboard-scheduled-jobs` when user-preferences is absent or seed-stamped.
- **NEW boundary contract at `Docs/agent-guides/cowork-customization-contract.md`** — enumerates STOCK files (overwritten on every install) vs USER files (preserved across install) vs USER-DRAFTABLE-WITH-BACKUP files (in `files[]` without `materialize_once`; `.bak`'d-then-overwritten via v0.2.0 Option B). The 5 cowork prompts currently fall in the third category.

### Upgrade procedure

```bash
# One-command update per vault — no overrides needed:
cd <vault-path>
sauce update --bump-pins
```

That's it. The two v0.75.1 deploy bugs are fixed; auto-detection now works reliably.

After the install, the next `cowork:onboard-scheduled-jobs` invocation will auto-delegate to `cowork:context-builder` for the 14-question interview (or prompt for an update if user-preferences was previously captured). The composed file lives at `spice/cowork/context/user-preferences.md` and is preserved across all future `sauce update`s.

**If you want to run the interview standalone** (without going through onboard-scheduled-jobs):

```
# In Claude Code, invoke:
Use Skill cowork:context-builder
```

### Carry-forward

The 5 atomic-note-emitting cowork orchestrators (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) do NOT yet consume `user-preferences.md` in v0.76.0 — that consumption layer is v0.77.0. v0.76.0 stabilizes the file schema; v0.77.0 wires the orchestrators to apply priorities + personality from the file.
