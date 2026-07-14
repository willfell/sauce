---
title: Try sauce v0.36.1 on this Mac — exercise prompt
date: 2026-05-12
target: a fresh Claude Code session on the Mac that just shipped v0.36.1
state_on_this_mac:
  brew_sauce_version: 0.36.1
  active_pantry_symlink: "~/.sauce/active-pantry → /Users/willfell/Documents/obsidian/sync/workshop/sauce (dev mode)"
  registered_vaults: ["the workshop itself"]
  zsh_sauce_function: "obsoleted (renamed to ~/.alias-config/sauce.sh.pre-v0.36.bak)"
---

# Try sauce v0.36.1 on this Mac

> [!tip] Use
> Open a fresh Claude Code session anywhere on this Mac. Paste the **BEGIN PROMPT** block below verbatim. End with the **END PROMPT** marker.

## What's already true on this Mac

- `brew install willfell/sauce/sauce` already ran → `sauce` v0.36.1 on PATH at `/opt/homebrew/bin/sauce`.
- `~/.sauce/active-pantry` symlinks the workshop checkout at `/Users/willfell/Documents/obsidian/sync/workshop/sauce`. **You're in dev mode by default.** Every `sauce <verb>` dispatches through the workshop checkout, not the brewed libexec. To test the brewed code path in isolation, `sauce unlink` first; relink with `sauce link /Users/willfell/Documents/obsidian/sync/workshop/sauce` when done.
- `~/.sauce/vaults.json` contains exactly one entry: the workshop itself (registered 2026-05-13).
- The legacy `sauce()` shell function in `~/.alias-config/sauce.sh` is **disabled** (renamed to `sauce.sh.pre-v0.36.bak`). Fresh shells use the brewed binary.

## Vault candidates on this Mac (from filesystem scan during cycle close)

- `~/Documents/obsidian/sync/sauce/` — likely a real sauce-managed area (4 subdirs)
- `~/Documents/obsidian/sync/old-vaults/` — historical
- `~/Documents/Obsidian/headspace/` — possibly a headspace vault
- The workshop itself at `~/Documents/obsidian/sync/workshop/sauce/` (already registered)

The prompt below asks you to discover state first, then walk an exercise tour.

---

## BEGIN PROMPT

```
You are helping me exercise sauce v0.36.1 on this Mac to validate the Homebrew-distributed platform end-to-end. Sauce is already brew-installed at v0.36.1; the workshop checkout is symlinked as the active dev pantry. Detailed pre-state in
Docs/prompts/2026-05-12-try-sauce-on-this-mac.md in the workshop repo.

## Phase 0 — Verify the starting state

Run these in order; report findings concisely:

1. `which sauce` and `sauce help | head -3` — expect `/opt/homebrew/bin/sauce` and `workshop_version 0.36.1`.
2. `sauce doctor` — expect `0 fail · 0 warn · 3 ok`. If WARNs appear for tmp-vault paths, run `sauce reinstall --all` to auto-prune (or `sauce vault remove <path>` per entry).
3. `sauce vault list` — should show one entry (the workshop). If more, that's fine.
4. `ls -la ~/.sauce/active-pantry` — expect symlink to the workshop checkout.
5. Scan for other vault candidates: `find ~/Documents/obsidian/sync ~/Documents/Obsidian -maxdepth 4 -name '.obsidian' -type d 2>/dev/null | head -20`.

Report what you find. Ask me which vault(s) I want to try registering / installing into.

## Phase 1 — Exercise the new verbs (read-only / safe)

Walk these without modifying anything load-bearing:

- `sauce status` (from inside any vault — try one of the candidate dirs from Phase 0). Should print workshop version, vault path, drift summary, active-pantry target.
- `sauce help vault` (or just `sauce vault` with no subverb) — confirm usage text reads cleanly.
- `sauce migrate-layout --vault <some-vault> --dry-run` (against any vault that has `pantry/.git/`). Should print the 6-step plan without writes. If no legacy vault is around, skip.
- `sauce doctor` again, after any state changes.

## Phase 2 — Test the brewed code path (no dev override)

Temporarily disable dev mode to confirm the pure brew install dispatches correctly:

```bash
sauce unlink
which sauce             # still /opt/homebrew/bin/sauce
sauce help | head -3    # should still print workshop_version 0.36.1
sauce doctor            # should still pass; check active-pantry row is gone
```

Then relink:

```bash
sauce link /Users/willfell/Documents/obsidian/sync/workshop/sauce
sauce doctor            # active-pantry row should reappear
```

## Phase 3 — Optional: register a real vault on this Mac

If Phase 0 surfaced a real vault you want managed (not the workshop), pick ONE and ask me before mutating:

```bash
sauce vault add "<path>"            # registers, no install
sauce reinstall --vault "<path>"    # actual install run
sauce audit                          # from inside the vault
```

If the vault has `pantry/.git/` (legacy layout), the right verb is `sauce migrate-layout --vault <path>` instead — preview with `--dry-run` first and let me approve before mutating.

## Phase 4 — Test fresh-vault bootstrap (clean room)

To validate the bootstrap-via-brew fix (the v0.36.1 patch's main payload):

```bash
TMP="$(mktemp -d /tmp/sauce-tryout.XXXXX)"
sauce bootstrap --vault "$TMP" --non-interactive --no-register
ls -la "$TMP"                       # expect ranch/ + platform-config.json
sauce audit --vault "$TMP" || echo "audit not flag-style; that's ok"
rm -rf "$TMP"
```

Should succeed without the ENOENT error that pre-fix v0.36.0 produced.

## Phase 5 — Optional: trigger a re-release dry run

If you want to test the release workflow opens another tap PR (e.g., to simulate a real v0.36.2 in the future):

DO NOT actually tag from this exercise session. The release workflow is already proven via the v0.36.1 cycle. This phase is just for understanding — show me the workflow file:

```bash
cat .github/workflows/release.yml | head -20
gh run list --repo willfell/sauce --workflow release.yml --limit 5
```

## Stop conditions

- If `sauce doctor` shows a FAIL row that isn't expected → stop, report.
- If Phase 4 fresh-vault bootstrap throws ENOENT → the BF fix didn't ship; check `git log v0.36.1 -1 --stat` for commit `0337e09`'s diff.
- If anything writes outside `~/.sauce/`, `<vault>/`, or `/tmp/` → stop, report.

## Report style

Brief. Per-phase one-paragraph summary plus key command output (≤5 lines). Skip phases that don't apply. Tell me what's new — not what I already know.
```

## END PROMPT

---

## Cleanup before fresh sessions

If you want to start COMPLETELY clean before the prompt above:

```bash
# Optional — drop the registry
rm ~/.sauce/vaults.json
# Optional — drop the dev link
sauce unlink
# Re-register the workshop fresh
sauce vault add /Users/willfell/Documents/obsidian/sync/workshop/sauce
sauce link /Users/willfell/Documents/obsidian/sync/workshop/sauce
```

Not needed — current state is healthy. Only do this if you specifically want to validate the registration flow from zero.
