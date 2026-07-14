---
title: Onboard accuris vault on another Mac — handoff prompt
date: 2026-05-12
target: a fresh Claude Code session on a DIFFERENT Mac (not the one that shipped v0.36.1)
prerequisite: sauce v0.36.1 published to willfell/homebrew-sauce (already merged 2026-05-12)
expected_state_on_target:
  brew_installed: maybe
  sauce_installed: probably not
  accuris_vault: probably at ~/notes/sauce/accuris-sauce or similar; probably on pre-v0.36 <vault>/pantry/ layout
  zsh_legacy_sauce_function: probably still present in ~/.alias-config/sauce.sh
---

# Onboard accuris vault on another Mac

> [!tip] Use
> On your OTHER Mac, open Claude Code anywhere. Paste the **BEGIN PROMPT** block verbatim. The prompt is fully self-contained — it discovers state and branches accordingly.

## Background for the target session

Sauce v0.36.1 was published 2026-05-12 to the public Homebrew tap `willfell/homebrew-sauce`. Pre-v0.36 the install path was `curl -fsSL ... install.sh | bash` and each vault held its own `pantry/.git/` clone, which broke across machines when synced. Post-v0.36 the install path is `brew install willfell/sauce/sauce` and pantry lives in `$(brew --prefix)/Cellar/sauce/<v>/libexec` — outside any synced vault. A per-machine registry at `~/.sauce/vaults.json` tracks which vaults are managed.

On the target Mac, expected starting state:
- A historical `accuris-sauce` vault probably exists somewhere under `~/notes/sauce/` or similar.
- That vault probably still has `<vault>/pantry/.git/` (pre-v0.36 layout).
- The user's zshrc probably sources `~/.alias-config/sauce.sh` which defines a legacy `sauce()` shell function — needs to be retired on this Mac too.

The prompt below handles all three.

---

## BEGIN PROMPT

```
You are helping me onboard my accuris Obsidian vault on this Mac to the v0.36.1+ Homebrew-distributed sauce platform. This Mac is DIFFERENT from the one that shipped v0.36.1; sauce probably isn't brew-installed here yet, and my accuris vault probably still has the pre-v0.36 <vault>/pantry/ layout.

Goal: by the end of this session, sauce is brew-installed on this Mac AND the accuris vault is registered + materialized via the new layout AND the legacy zsh shell function is retired.

## Phase 0 — Survey the target state

Run these in order; report findings before any mutation:

1. `which brew && brew --version` — Homebrew must be installed first. If not, stop and instruct me to install Homebrew (https://brew.sh).
2. `node --version` — must be 18+. If older, `brew install node` later.
3. `brew list --versions sauce 2>&1 || echo "not installed"` — is sauce already brew-installed here?
4. `cat ~/.sauce/vaults.json 2>/dev/null || echo "no registry"` — any registered vaults?
5. `ls -la ~/.sauce/active-pantry 2>/dev/null || echo "no active-pantry"` — any dev-mode link?
6. Look for the legacy shell function:
   ```bash
   type sauce 2>&1
   grep -l "_sauce_resolve_vault\|^sauce *()" ~/.alias-config/*.sh ~/.zshrc ~/.zshenv ~/.zprofile ~/.bashrc 2>/dev/null
   ```
7. Find the accuris vault:
   ```bash
   find ~/notes ~/Documents ~ -maxdepth 5 -type d -name 'accuris*' 2>/dev/null | head
   find ~/notes ~/Documents ~ -maxdepth 5 -name '.obsidian' -type d 2>/dev/null | head -10
   ```
   Ask me which path is the accuris vault if multiple candidates appear. Call it $ACCURIS henceforth.
8. Inspect $ACCURIS:
   ```bash
   ls "$ACCURIS"
   ls "$ACCURIS/pantry/.git" 2>/dev/null && echo "legacy layout" || echo "no legacy pantry/.git"
   ls "$ACCURIS/ranch/platform-config.json" 2>/dev/null && echo "sauce-managed" || echo "not sauce-managed"
   ```

Report a one-paragraph state summary. Then ask me to confirm before Phase 1.

## Phase 1 — Install sauce v0.36.1 via brew

```bash
brew tap willfell/sauce          # idempotent; safe if already tapped
brew install willfell/sauce/sauce   # OR `brew upgrade` if older version is present
sauce help | head -5             # verify workshop_version 0.36.1+
sauce doctor                      # capture output; expect mostly OK
```

If `sauce` resolves to a SHELL FUNCTION instead of `/opt/homebrew/bin/sauce` (check with `type sauce`), the legacy function from Phase 0 step 6 is shadowing the brewed binary. Skip to Phase 2 to retire it first; then come back and verify `sauce help` shows the brewed v0.36.1.

## Phase 2 — Retire the legacy zsh function

If `~/.alias-config/sauce.sh` exists, rename it (reversible):

```bash
mv ~/.alias-config/sauce.sh ~/.alias-config/sauce.sh.pre-v0.36.bak
exec zsh                          # reload shell
type sauce                        # expect: sauce is /opt/homebrew/bin/sauce
sauce help | head -3              # expect: workshop_version 0.36.1
```

If a different file defines the function (Phase 0 step 6 listed it), rename THAT file with `.pre-v0.36.bak` instead. Do not delete; rename. The file may have other helpers (`sauce-pin`, `sauce-here`, etc.) the user might want to reference later.

## Phase 3 — Migrate the accuris vault (branching)

### Case A — $ACCURIS has `pantry/.git/` (legacy)

```bash
sauce migrate-layout --vault "$ACCURIS" --dry-run    # preview only
```

Show me the printed plan. Wait for my approval before:

```bash
sauce migrate-layout --vault "$ACCURIS"
sauce audit
sauce doctor
```

Effects:
- `$ACCURIS/pantry/` is moved to `$ACCURIS/pantry.legacy.<ts>.bak/` (filesystem move, no git ops).
- `$ACCURIS` is registered in `~/.sauce/vaults.json`.
- Installer runs against the vault using the brew-installed pantry.
- `sauce audit --strict` runs. (Note: v0.36.1 ships an honest no-op audit stub in cmd-migrate-layout's production path — for now, audit always reports OK in real runs unless you pass an `--auditStrict` ctx hook. Manual `sauce audit` afterward is the real gate.)

If audit is clean, the `pantry.legacy.<ts>.bak/` can be deleted later with `rm -rf` OR you can re-run with `--purge` to delete it inline. Default is to keep the .bak.

### Case B — $ACCURIS has `ranch/platform-config.json` but no `pantry/` (already on v0.36 layout)

```bash
sauce vault add "$ACCURIS"
sauce reinstall --vault "$ACCURIS"
sauce audit                       # from inside the vault
sauce doctor
```

### Case C — $ACCURIS is empty / not yet sauce-managed (rare)

```bash
sauce bootstrap --vault "$ACCURIS"
```

The bootstrap wizard prompts for subscription selection — accuris's canonical subscription matches the workshop's full set, but you may want a leaner footprint. Ask me which mechanisms/blueprints I want.

## Phase 4 — Verify in Obsidian

Open the accuris vault in Obsidian. Confirm:
- `Cmd+R` reloads without errors.
- `spice/` directory contains the subscribed blueprints' module dirs.
- `ranch/` directory has scripts, views, rules, templates.
- Slash commands work: try `/daily` or `/meetings`.
- Existing personal content (Boards/, Timestamps/, etc. outside `spice/`) is untouched.
- No console errors about missing CustomJS classes or broken Templater paths.

## Phase 5 — Day-to-day update flow (document, don't execute)

For future reference, this is the new two-verb update flow:

```bash
brew upgrade sauce            # refresh pantry under brew prefix
sauce reinstall --all         # re-materialize every registered vault on this Mac
```

Auto-prunes missing vaults. Add `--keep-missing` if you want to preserve dead entries (rare).

## Phase 6 — Cleanup (optional, after 1-2 weeks of stability)

```bash
rm -rf "$ACCURIS"/pantry.legacy.*.bak    # only after migrate-layout has been audit-clean for a while
```

Or skip — the .bak is cheap to keep.

## Stop conditions

- If Homebrew isn't installed → stop, give me the install command, end session.
- If `node --version` < 18 → stop, `brew install node` first.
- If `sauce doctor` shows a non-brew FAIL → stop, report.
- If `migrate-layout` step 3 refuses with version-downgrade → confirm versions before passing `--allow-downgrade`. Don't auto-pass.
- If audit reports `consumer_edit_at_risk` or `dead_path` severities → don't auto-purge.
- If anything writes outside `~/.sauce/`, $ACCURIS, or `$(brew --prefix sauce)` → stop, report.

## Report style

Brief. Per-phase one-paragraph summary plus key command output (≤5 lines). Highlight surprises. Don't recap state I already gave you.
```

## END PROMPT

---

## If you're on a TRULY fresh Mac (nothing installed)

Pre-Phase 0 setup:

```bash
# 1. Install Homebrew (interactive, asks for sudo)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Add brew to PATH if it's not picked up
eval "$(/opt/homebrew/bin/brew shellenv)"

# 3. Verify
brew --version
```

Then paste the BEGIN PROMPT block above.
