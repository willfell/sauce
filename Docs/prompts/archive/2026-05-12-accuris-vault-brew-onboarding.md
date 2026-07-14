---
title: Accuris vault — brew onboarding handoff prompt
date: 2026-05-12
prerequisite: sauce v0.36.1+ published to willfell/homebrew-sauce tap (tap PR #1 merged)
target_session: fresh Claude Code session, ideally on the user's other Mac or on this Mac after a clean reset
---

# Accuris vault — brew onboarding handoff prompt

> [!tip] How to use this
> This entire document is the prompt. Open a fresh Claude Code session in any directory, paste everything between the `BEGIN PROMPT` / `END PROMPT` markers below, and let it drive.

---

## Background context the next session needs

You (the user) just shipped sauce v0.36.1 — the first Homebrew-distributed release of the Obsidian vault platform. The full cycle execution log lives at `Docs/plans/2026-05-12-v0.36.0-v0.36.1-execution-log.md` in `willfell/sauce`. Key new surface:

- **Install:** `brew tap willfell/sauce && brew install willfell/sauce/sauce`
- **Per-machine registry:** `~/.sauce/vaults.json`
- **CLI verbs:** `vault`, `reinstall`, `migrate-layout`, `doctor`, `link`, `unlink`, plus existing `bootstrap`, `update`, `status`, `audit`, `wizard`, `migrate`, `help`
- **Two-verb update flow:** `brew upgrade sauce && sauce reinstall --all`
- **Legacy migration:** `sauce migrate-layout --vault <path>` for vaults still on `<vault>/pantry/.git/`

The accuris vault is one of your consumer vaults. On your other Mac, the historical path was `/Users/willfellhoelter/notes/sauce/accuris-sauce` (per CLAUDE.md in the sauce repo) — but your current machine has a different `$HOME` layout (`/Users/willfell/...`). Path discovery is part of the handoff.

---

## BEGIN PROMPT

```
You are helping me onboard my accuris Obsidian vault to the Homebrew-distributed sauce v0.36.1+ platform. This may be running on either (a) the same Mac that just shipped v0.36.1, or (b) a different Mac where sauce has never been installed. Detect which.

## Phase 0 — Discover state

Run these in order and report findings before doing anything else:

1. `which brew` — confirm Homebrew is installed. If not, instruct me to install Homebrew first (https://brew.sh) and stop.
2. `brew list --versions sauce 2>&1` — is sauce already brew-installed? If yes, capture the version.
3. `node --version` — must be 18+.
4. `cat ~/.sauce/vaults.json 2>/dev/null` — is there a sauce registry already? If yes, list the registered paths.
5. `ls -la ~/.sauce/active-pantry 2>/dev/null` — is there an active dev-mode symlink?
6. Ask me: "Where is your accuris vault on this machine?" If I'm unsure, suggest:
   - `find ~ -maxdepth 4 -name '.obsidian' -type d 2>/dev/null | head -20` to find candidate vaults
   - Or check `~/notes/`, `~/Documents/Obsidian/`, `~/Documents/obsidian/sync/`, `~/notes/sauce/accuris-sauce`
   - For comparison: my workshop dev repo is at `/Users/willfell/Documents/obsidian/sync/workshop/sauce` (or `/Users/willfellhoelter/projects/repos/sauce` on the other machine)
7. Once I provide the vault path (call it $VAULT henceforth), run `ls "$VAULT"` and check for:
   - `ranch/platform-config.json` (sauce-managed vault — already onboarded at some point)
   - `pantry/.git/` (legacy pre-v0.36 layout — needs `migrate-layout`)
   - `.obsidian/` (it's an Obsidian vault at all)
   - Neither pantry nor ranch (fresh vault, never sauce-installed)

Report back with a one-paragraph state summary before proceeding to Phase 1.

## Phase 1 — Install sauce via brew (if not already installed)

If `brew list sauce` showed nothing or an older version:

```bash
brew tap willfell/sauce          # idempotent
brew install willfell/sauce/sauce   # OR: brew upgrade willfell/sauce/sauce
which sauce                          # expect /opt/homebrew/bin/sauce
sauce help | head -5                 # smoke check; expect v0.36.1+
sauce doctor                         # expect 0 fail
```

If `sauce doctor` shows FAIL rows that aren't `brew sauce`-related, stop and report — something is unusual about this Mac's setup.

⚠ Side-note: my zshrc might define a `sauce()` shell function that shadows the brewed binary. Check with `grep -n "^sauce ()" ~/.zshrc ~/.zshenv ~/.zprofile 2>/dev/null`. If found, suggest I remove it; for the rest of this session, use the absolute path `/opt/homebrew/bin/sauce` (or `$(brew --prefix sauce)/bin/sauce`) instead of unqualified `sauce` to bypass the function.

## Phase 2 — Onboard the accuris vault (branching logic)

### Case A — $VAULT has `pantry/.git/` (legacy layout)

```bash
sauce migrate-layout --vault "$VAULT" --dry-run    # preview
# Review the printed plan with me before:
sauce migrate-layout --vault "$VAULT"
sauce audit
sauce doctor
```

- `--dry-run` prints the 6-step plan without writing.
- After a real run: `<VAULT>/pantry/` is archived to `<VAULT>/pantry.legacy.<ts>.bak/`, vault is registered in `~/.sauce/vaults.json`, installer runs against the brew-installed pantry, audit runs.
- After audit comes back clean, you may delete the `.bak` manually OR re-run with `--purge` (which deletes it automatically). Default is to keep the .bak.

### Case B — $VAULT has `ranch/platform-config.json` but NO `pantry/` (already on v0.36+ layout, just not registered locally)

```bash
sauce vault add "$VAULT"
sauce reinstall --vault "$VAULT"
sauce audit
sauce doctor
```

### Case C — $VAULT is empty / not yet sauce-managed (fresh onboard)

```bash
sauce bootstrap --vault "$VAULT"
```

`bootstrap` is interactive — it walks me through subscription selection (which mechanisms + blueprints to install). For the accuris vault specifically, the canonical subscription is the same as my other consumer vaults: ask me which mechanisms/blueprints to include, or default to the workshop's current full subscription (mechanisms: customjs-guard, validator, audit, nav-buttons, cards, accent-button, people-rendering, styling, convenience, platform-claude; blueprints: boards, cowork, daily, journal, meetings, people, project, to-do, trips, finance).

After bootstrap completes:

```bash
sauce audit
sauce doctor
```

## Phase 3 — Verify in Obsidian

Open the accuris vault in Obsidian. Confirm:

- `Cmd+R` reloads the vault.
- The `spice/` directory contains the subscribed blueprints' module directories.
- The `ranch/` directory has Templater scripts, Dataview views, rules JSON, registries.
- Slash commands work: try `/daily` or `/meetings` in the file palette.
- Existing personal content (Boards/, Timestamps/, Finance/, etc. outside `spice/`) is untouched.

If Obsidian shows errors (CustomJS warnings, missing scripts, etc.), check the Templater + Dataview + CustomJS plugin settings against `ranch/` paths.

## Phase 4 — Update flow (for future reference, document only — don't execute)

On any subsequent day:

```bash
brew upgrade sauce          # one command per machine
sauce reinstall --all       # one command per machine, walks ~/.sauce/vaults.json
```

`reinstall --all` auto-prunes missing paths from the registry and re-runs the installer against every remaining vault on this machine.

## Phase 5 — Cleanup (only if Case A happened)

After 1-2 weeks of confirming the migrated vault works correctly:

```bash
rm -rf "$VAULT"/pantry.legacy.*.bak
```

(Or skip — `.bak` is cheap to keep indefinitely.)

## Stop conditions / things to surface to me

- If brew isn't installed → stop, instruct.
- If node < 18 → stop, instruct `brew install node`.
- If `sauce doctor` shows a non-brew FAIL → stop, report the row's `fix:` pointer.
- If `migrate-layout` step 3 refuses with a version-downgrade error → check `sauce help` version vs the vault's `pantry/platform/manifest.json` workshop_version; investigate before passing `--allow-downgrade`.
- If audit reports `consumer_edit_at_risk` or `dead_path` severities → don't auto-purge; investigate.
- If bootstrap can't write to the vault (permission errors) → stop, report.

## Report style

Brief per-phase progress reports. One sentence per significant action. Show actual command output (last 5-10 lines) when something interesting happens. Don't recap what I already know; tell me what's new.
```

## END PROMPT

---

## Optional: onboarding a brand-new Mac

If the next session runs on a Mac where **nothing** is set up yet, Phase 0 catches it (no `brew`, no node, no vaults). The prompt instructs the assistant to walk the user through installing Homebrew + node first, then resume.

A clean-Mac onboarding from scratch:

```bash
# 1. Install Homebrew (manual; this prompts for sudo)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install sauce (after brew is on PATH)
brew tap willfell/sauce
brew install willfell/sauce/sauce

# 3. Verify
sauce help
sauce doctor

# 4. Either migrate an existing vault or bootstrap a fresh one
#    (see Phase 2 in the prompt above)
```

That's the entire install-from-scratch path on a clean Mac. Pre-v0.36 was a curl-bash-into-vault dance; post-v0.36 is two `brew` commands.

---

## Things the next session should know but may not need to act on

1. **Workshop dev path on this Mac:** `/Users/willfell/Documents/obsidian/sync/workshop/sauce` (NOT `/Users/willfellhoelter/projects/repos/sauce` from the CLAUDE.md status block — that's the other machine).
2. **Tap repo path on this Mac:** `/Users/willfell/Documents/obsidian/sync/homebrew-sauce`.
3. **Workshop active-pantry symlink:** `~/.sauce/active-pantry → /Users/willfell/Documents/obsidian/sync/workshop/sauce`. Means `sauce <verb>` from anywhere on this Mac dispatches through the workshop checkout, not the brew-installed pantry. If the next session wants to test the BREW-installed code path specifically, `sauce unlink` first.
4. **CLAUDE.md status block** in the sauce repo references machine paths from `willfellhoelter` user — that's the other Mac's `$HOME`. Workshop is portable; vault paths are per-machine.
5. **Subscription drift reconciliation pattern** (v0.33.0 S1, v0.33.1, S8 of v0.36.0): if the workshop's own subscription falls behind the catalog version of a mechanism, `sauce reinstall --vault <workshop>` skips those mechanisms and exits 1. Fix is to bump the version pins in `<workshop>/ranch/platform-subscription.json` to match `<workshop>/platform/manifest.json`. This applies to the workshop self-install; consumer vaults have their own subscription that pins whatever versions they intentionally subscribe to.
