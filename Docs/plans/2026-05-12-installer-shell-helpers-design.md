---
date: 2026-05-12
status: brainstorm-shelf
slot: installer-shell-helpers-design
cycle: future (v0.32.x or v0.33.x)
related:
  - install.sh (consumer bootstrap)
  - platform/cli/sauce-cli.js
  - Docs/install.md
---

# Installer-shipped shell helpers — design (brainstorm-shelf)

> [!abstract] Problem
> Today, after `install.sh` finishes bootstrapping a vault's `pantry/`, the user still has to manually wire `sauce` as a shell command — either by aliasing it to the workshop-dev path (machine-specific, brittle) or by hand-pasting a `sauce()` function into `~/.zshrc` (cross-machine portable but undiscoverable). The "from inside vault X, just run `sauce update`" UX is an obvious win but not delivered by the installer today.

## Today's UX (v0.31.0)

After `install.sh`, the user must:
1. Author `~/.alias-config/sauce.sh` (or similar) with two functions:
   - `sauce()` — walks up from `cwd` for `pantry/`, invokes the local CLI.
   - `sauce-refresh()` — pulls origin/main in pantry + runs `sauce update --force`.
2. Add `source ~/.alias-config/sauce.sh` to `~/.zshrc` (or `~/.bashrc`).
3. `source ~/.zshrc`.

On a second machine, repeat steps 1-3. There's no canonical landing place for the functions in the workshop repo, so users copy-paste their own bespoke versions and they drift.

## Proposed UX (target cycle TBD)

```bash
cd /any/sauce/vault
sauce-bootstrap            # bootstraps + installs shell helpers
# helpers materialized; ~/.zshrc patched (additive); next shell session has sauce/sauce-refresh/sauce-here
```

Or for an existing-vault user opting in:

```bash
cd /any/sauce/vault
sauce install-shell-helpers --shell zsh    # or bash, or fish
```

## Design sketch

### Material

Ship a canonical helpers file as part of the workshop tree:

```
platform/cli/shell-helpers/sauce.sh        # bash + zsh (POSIX-friendly)
platform/cli/shell-helpers/sauce.fish      # fish equivalent (forecast)
```

`platform/cli/shell-helpers/sauce.sh` body matches today's hand-rolled version:
- `sauce()` — vault-resolving CLI invoker
- `sauce-refresh()` — pull + reset + npm install + update --force
- `sauce-here()` — print resolved vault + pantry sha + sub-pin
- `sauce-bootstrap()` — curl wrapper for fresh-vault bootstrap
- `sauce-pin <name> <version>` — update one mech/blueprint subscription pin (edits the JSON via node, not sed). Plus `--diff` (read-only drift report between pins and catalog) and `--catalog` (bulk bump all pins to current catalog versions). Surfaced from v0.31.0 S6.5 friction where pin bumps were the gating step for every blueprint upgrade and users were reaching for sed.

### Materialization helper

Add a workshop-level installer helper `installShellHelpers(tp, manifest, options)`:

- Input: `options.targetShell ∈ ["bash", "zsh", "fish", "auto"]`. Default `"auto"` — sniffs from `$SHELL`.
- Action:
  1. Copy `platform/cli/shell-helpers/sauce.sh` to `~/.alias-config/sauce.sh` (create dir if absent).
  2. Probe `~/.zshrc` (or `.bashrc`) for a sentinel comment line `# Sauce platform shell helpers`. If absent, append a 2-line block (sentinel + source line). If present, skip (idempotent).
  3. Emit Notice + history entry.
- Safety mechanics (matches landmine #12 posture):
  - Backup on edit (`.sauce-backup` on the rcfile before append).
  - Malformed-rcfile guard (don't overwrite; emit error history).
  - Failure-loud (Notice + history; never throw).
  - Sentinel-comment idempotency (skip-if-present).
- Opt-in not opt-out — first invocation prompts for consent unless `--non-interactive --install-shell-helpers=yes` was passed to `install.sh`.

### New CLI verbs

- `sauce install-shell-helpers [--shell <bash|zsh|fish|auto>]` — invokes the helper-install logic above. Lets existing-vault users opt in without re-bootstrapping.
- `sauce pin <name> <version>` — bump one subscription pin (mech or blueprint). Replaces the need to hand-edit `ranch/platform-subscription.json` or use sed. Same writer-with-validation pattern as cmd-wizard.js' subscription editor.
- `sauce pin --diff` — read-only drift report between subscription pins and the workshop catalog. Useful pre-flight before `sauce update`.
- `sauce pin --catalog` — bulk bump all pins to whatever the local pantry's `platform/manifest.json` declares. Useful when adopting a new workshop version wholesale.

These three sub-verbs replace the manual subscription editing surface today. The shell helpers (Material section above) prefigure them — once shipped in the CLI, the shell helpers proxy to the canonical CLI implementation.

## Landmines / open questions

- **`~/` writes are outside the vault.** Today's landmine #12 allowlist is `.obsidian/` + `.claude/skills/`-scoped. Writing to `~/.alias-config/` + `~/.zshrc` crosses the vault boundary. Mitigation:
  - Opt-in only (never silent).
  - Sentinel-bracketed block in the rcfile (easy to revert manually).
  - Backup-on-edit.
  - Documented in a new landmine entry (#23 or wherever).
- **Multi-shell support.** zsh + bash share the same `.sh` body; fish needs its own variant. Cross-shell aliasing for `sauce-bootstrap` (curl wrapper) needs both.
- **Sharing across machines.** Once shipped, users don't have to copy the helpers manually — but their dotfiles sync channel (Dropbox / git) may already have the file, causing a conflict. Add a `--keep-existing` flag that skips writing if `~/.alias-config/sauce.sh` already exists.
- **Uninstall path.** A `sauce uninstall-shell-helpers` verb that walks the sentinel block in the rcfile + deletes `~/.alias-config/sauce.sh`.
- **Per-user vs per-machine.** Helpers go to `~`, so they're per-user. A multi-user machine would write the helpers per `$HOME`. Acceptable; the existing alias-pattern users follow.

## Cycle sequencing

Forecast: v0.32.x or v0.33.x. NOT urgent because the hand-rolled version (this doc's "Today's UX" block) works perfectly on every machine. Promote when:
- A second user (or second machine) hits the manual setup friction.
- OR install.sh gets a refactor cycle anyway and this rides along cheaply.

## References + ownership

- Triggered by: v0.31.0 S6.5 session where the user asked "can I just `sauce update` from inside a vault without an alias to the workshop dev dir?" — surfaced the per-vault-pantry-resolution UX gap.
- Owner: TBD next cycle.
- Estimated lift: small. One new helper (~50 LOC), one new shell-helpers/ subtree (1 file initially), one new CLI verb. Plus a fresh landmine entry codifying the rcfile-write posture.
