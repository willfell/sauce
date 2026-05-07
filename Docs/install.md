# Installing Beacon (v0.22.0+)

This is the user-facing install reference for the **inside-vault layout** introduced in v0.22.0 — a single curl one-liner clones the workshop into `<vault>/Beacon/`, npm-installs, and runs the first-run wizard.

For architectural context see [how.md](how.md). For ongoing operations see [use.md](use.md).

> [!info] Two layouts coexist
> v0.22.0 introduces the inside-vault layout but does NOT retire the legacy sibling-of-workshop layout (`workshop_relative_path: "../beacon"`). Existing POC vaults continue to work unchanged. Only fresh consumer vaults bootstrapped via the curl one-liner default to the inside-vault `Beacon/` shape.

---

## One-liner usage

> [!abstract] The whole install
> ```bash
> cd /path/to/your/vault
> curl -fsSL https://raw.githubusercontent.com/willfell/beacon/main/install.sh | bash
> ```

The script runs four phases with sectioned output:

```
  ╔══════════════════════════════════════╗
  ║   Beacon  ·  installer               ║
  ║   Obsidian vault platform            ║
  ╚══════════════════════════════════════╝

  [1/4] Detecting environment...                OK
        node v22.1.0 · git 2.45.0 · vault /Users/me/notes/personal

  [2/4] Cloning workshop into Beacon/...        OK

  [3/4] Installing dependencies...              OK

  [4/4] Running first-run wizard...
        ?  Workshop path inside vault: Beacon
        ?  Vault display name: personal
        ?  Mechanisms to subscribe: ...
        ?  Blueprints to subscribe: ...
        ?  Confirm and write config? Yes
```

When the wizard finishes the script prints a final "Activate with: source Beacon/Scripts/activate.sh" hint.

> [!warning] Run from inside the vault dir
> The script defaults `--vault` to the current working directory. cd into the vault first OR pass `--vault /abs/path/to/vault` explicitly.

---

## Prerequisites

> [!info] What you need before running the one-liner
> - **Node.js 18 or newer** — the platform runs on Node's standard library + a single dependency (`@inquirer/prompts`).
> - **git 2.30 or newer** — used for the initial clone and for `beacon update`.

Install lines per platform:

| Platform | Node | git |
|---|---|---|
| **macOS (Homebrew)** | `brew install node` | `brew install git` |
| **Linux (Debian/Ubuntu)** | `sudo apt-get install -y nodejs npm` | `sudo apt-get install -y git` |
| **Linux (Fedora/RHEL)** | `sudo dnf install -y nodejs npm` | `sudo dnf install -y git` |

Verify with:

```bash
node --version    # v18.0.0 or higher
git --version     # 2.30.0 or higher
```

The installer will fail loud at phase `[1/4]` if either binary is missing.

---

## What gets installed

After a successful run, your vault layout looks like this:

```
<vault>/                                  Your Obsidian vault root
├── .obsidian/                            (existing) Obsidian state
├── Beacon/                               NEW — workshop clone (git-managed)
│   ├── platform/                         CLI verbs, install.js, mechanisms, blueprints
│   ├── Scripts/
│   │   ├── activate.sh                   NEW — per-shell PATH + BEACON_VAULT export
│   │   └── beacon                        NEW — bash wrapper exec'ing node CLI
│   ├── node_modules/                     npm install --omit=dev artifact
│   └── .git/                             clone --depth=1 history
├── Docs/Meta/                            Consumer-side platform state
│   ├── platform-config.json              NEW — vault-side path map + variables
│   ├── platform-subscription.json        NEW — what mechanisms/blueprints you opted into
│   └── platform-installed.json           NEW — auto-managed install ledger
└── (your existing notes)
```

> [!info] What "git-managed" means
> The `Beacon/` directory is a real git clone with `origin` pointing at the upstream beacon repo. `beacon update` calls `git fetch + git reset --hard origin/main` inside it. Hand-edits are wiped on the next update — see [landmines.md #18](landmines.md).

> [!warning] macOS APFS case-collision (`Beacon/` vs `beacon/<module>/`)
> macOS APFS is case-insensitive by default. The workshop clone at `Beacon/` (capital B) and the blueprint module-directory namespace at `beacon/<module>/` (lowercase, per [landmines.md #11](landmines.md)) resolve to the same directory on macOS. Blueprint `module_directory` mkdirs from `bash install.sh` therefore land inside `<vault>/Beacon/` instead of at vault root.
>
> The workshop-side `.gitignore` (v0.22.1+) masks the surfaced untracked artifacts so `beacon status` reports clean. Linux and case-sensitive macOS volumes materialize the dirs separately — the `.gitignore` entries are no-ops for them. See also [landmines.md #18](landmines.md) for the inside-vault `Beacon/` git-managed posture.

---

## Activation per shell

The install does **not** touch your shell rc files (`~/.zshrc`, `~/.bashrc`, etc.) — every new shell starts un-activated.

> [!success] Activate the current shell
> ```bash
> cd <vault>
> source Beacon/Scripts/activate.sh
> ```
>
> Output:
> ```
> beacon active. Try: beacon status
> ```

What activation does:

```sh
export PATH="<abs-vault>/Beacon/Scripts:$PATH"
export BEACON_VAULT="<abs-vault>"
```

After that, the `beacon` CLI is on your PATH and works from anywhere. `BEACON_VAULT` is the fallback the dispatcher uses if you run a verb from outside the vault tree.

> [!tip] Want it persistent?
> Add `source /abs/path/to/vault/Beacon/Scripts/activate.sh` to your shell rc. The platform deliberately doesn't do this for you — auto-modifying shell rc is a CLAUDE-side ask-before-acting concern.

---

## Day-2 operations

> [!example]- `beacon status` — read-only state report
> ```
>   Beacon  ·  v0.22.0
>   Vault:        ~/notes/personal
>   Workshop:     Beacon/  (git head a3f2b1, clean, 0 behind origin/main)
>   Subscribed:   7 mechanisms · 8 blueprints
>   Drift:        none
> ```
> No writes. Safe to run any time. Use it before `beacon update` to see what would change.

> [!example]- `beacon update` — pull latest workshop + re-run installer
> ```
>   [1/4] Fetching origin/main...                 OK (3 new commits)
>   [2/4] Checking working tree...                OK (clean)
>   [3/4] Resetting Beacon/ to origin/main...     OK
>   [4/4] Re-running installer...                 OK
>         2 files updated · 0 errors
>
>   Tip: Cmd+R Obsidian to pick up changes.
> ```
>
> What happens:
> 1. `git fetch origin` inside `Beacon/`
> 2. Working-tree dirty check — if dirty, **fails loud** (use `--force` to override).
> 3. `git reset --hard origin/main`
> 4. If `package.json` SHA changed, re-runs `npm install --omit=dev`
> 5. Re-invokes the installer phase against the same config

> [!example]- `beacon update --force` — dirty-tree override
> When you've hand-edited something inside `Beacon/` (which you shouldn't — see [landmines.md #18](landmines.md)) and need to discard those edits to get back to a clean upstream:
> ```bash
> beacon update --force
> ```
> The dirty check is skipped; `git reset --hard origin/main` discards local changes.

> [!example]- `beacon wizard` — re-run the subscription / config prompts
> Falls through to the existing re-run wizard from `bootstrap-lib/wizard.js`. Lets you toggle subscribed mechanisms / blueprints, edit the path-variable config, or quit without changes. Idempotent — quitting at any point leaves files untouched.

---

## Sync exclusion guides

`Beacon/` contains two large directories that should NOT be cloud-synced:

- **`Beacon/node_modules/`** — npm install artifact; large, regenerable via `beacon update`.
- **`Beacon/.git/`** — git history; large, regenerable via re-clone.

Per provider:

> [!example]- Obsidian Sync
> 1. Open Obsidian Settings → Sync.
> 2. Find the **Exclude from sync** field.
> 3. Add (one per line):
>    ```
>    Beacon/node_modules
>    Beacon/.git
>    ```
> 4. Save.
>
> The `.bak` files left behind by `beacon update --force` (or by landmine #12 backup-on-edit mechanics) are NOT auto-excluded but are small. If they bother you, also add `Beacon.bak` and `Beacon.bak.*`.

> [!example]- iCloud Drive
> iCloud's exclude mechanism is path-suffix-based: appending `.nosync` to a directory name signals iCloud to leave it un-synced.
>
> ```bash
> mv Beacon/node_modules Beacon/node_modules.nosync
> mv Beacon/.git Beacon/.git.nosync
> ```
>
> > [!warning] This breaks `require()` and `git`
> > Renaming `node_modules` to `node_modules.nosync` makes Node's resolver fail (it looks for `node_modules` literally). Renaming `.git` makes git operations fail.
> >
> > Workaround: use **System Settings → Apple ID → iCloud → Drive → Sync Desktop & Documents Folders** to keep the vault local. Or pick a non-iCloud path for your Obsidian vault.
> >
> > **Recommended posture:** if you use iCloud Drive, do NOT put your Obsidian vault inside it. Put the vault under `~/notes/` or another non-iCloud path.

> [!example]- Dropbox (Smart Sync / Online-only)
> 1. Right-click `Beacon/node_modules` in Finder/Explorer → Smart Sync → **Online only**.
> 2. Right-click `Beacon/.git` → Smart Sync → **Online only**.
>
> The directories remain on disk references but their contents are not stored locally; Dropbox fetches on demand. Node and git both still work — Dropbox transparently materializes files on access.

---

## Troubleshooting

> [!example]- "Not inside a beacon-managed vault"
> The CLI dispatcher walks cwd ancestors looking for `Docs/Meta/platform-config.json`. If it doesn't find one and `$BEACON_VAULT` isn't set, you get this error.
>
> Fixes (any one works):
> 1. `cd` into the vault root or any subdirectory of it before running `beacon`.
> 2. `export BEACON_VAULT=/abs/path/to/vault` and re-run.
> 3. Re-source the activation script: `source <vault>/Beacon/Scripts/activate.sh` (this sets `BEACON_VAULT`).

> [!example]- "Working tree dirty" on `beacon update`
> ```
>   [2/4] Checking working tree...                FAIL
>         Beacon/ has uncommitted changes:
>          M platform/install.js
>          ?? Beacon/local-experiment.js
>         Re-run with --force to discard.
> ```
>
> Fixes:
> 1. **Discard the dirty state** (recommended; see landmine #18): `beacon update --force`.
> 2. If you genuinely need to keep the changes, copy them out of `Beacon/` first, then `beacon update --force`.

> [!example]- "Beacon/ already exists" on re-install
> When running `curl ... | bash` for a second time, the script refuses to overwrite an existing `Beacon/` because curl|bash provides no TTY for an interactive prompt.
>
> Fixes:
> 1. **Download the script first** then run it directly (it can prompt):
>    ```bash
>    curl -fsSL https://raw.githubusercontent.com/willfell/beacon/main/install.sh -o install.sh
>    bash install.sh
>    ```
> 2. **Force-overwrite (backs up to `Beacon.bak`)**:
>    ```bash
>    bash <(curl -fsSL https://raw.githubusercontent.com/willfell/beacon/main/install.sh) --overwrite
>    ```
>
> The script preserves any prior `Beacon.bak` by timestamping it (`Beacon.bak.YYYYMMDD-HHMMSS`) — backups are never destroyed.

> [!example]- `beacon` command not found
> The `beacon` CLI is added to PATH via `activate.sh`. PATH state is per-shell:
> - Each new terminal needs `source <vault>/Beacon/Scripts/activate.sh` before `beacon` works.
> - The script does NOT modify `~/.zshrc` or `~/.bashrc` (that's an explicit choice — see "Activation per shell" above).
>
> Verify:
> ```bash
> echo "$PATH" | tr ':' '\n' | grep Beacon/Scripts
> # should print: /abs/path/to/vault/Beacon/Scripts
> ```

---

## Uninstall

To fully remove Beacon from a vault:

```bash
cd <vault>
rm -rf Beacon/ Beacon.bak Beacon.bak.*
rm -f Docs/Meta/platform-config.json \
      Docs/Meta/platform-subscription.json \
      Docs/Meta/platform-installed.json
```

> [!warning] What this does NOT undo
> The platform's `.obsidian/` plugin-data merges (Templater hotkeys, Slash Commander bindings, Daily Notes settings, vendored Baseline theme, Style Settings JSON, hotkeys.json entries, Dataview settings, and other allowlisted paths — see [landmines.md #12](landmines.md)) are NOT auto-reverted by uninstall.
>
> Each of those paths has a sibling `.beacon-backup` (or `.bak` for vendored themes) created the first time the installer touched it. To revert:
> 1. Find each backup: `find .obsidian -name '*.beacon-backup' -o -name '*.bak'`
> 2. Copy each backup over its live target (e.g., `cp .obsidian/hotkeys.json.beacon-backup .obsidian/hotkeys.json`).
> 3. Reload Obsidian (Cmd+R).
>
> Backups are single-deep — one prior version per target. The platform doesn't auto-rotate them.

---

## Two layouts coexist

The v0.22.0 inside-vault layout is **one of two supported shapes**:

- **Inside-vault (v0.22.0+, default for fresh consumers):** workshop clone at `<vault>/Beacon/`, `workshop_relative_path: "Beacon"` in `platform-config.json`. Bootstrapped via the curl one-liner.
- **Sibling-of-workshop (legacy, still supported):** workshop checked out at a path adjacent to the vault, e.g., `~/Documents/obsidian/sync/workshop/beacon/`, with the consumer's `platform-config.json` pointing at it via `workshop_relative_path: "../beacon"`. Used by existing POC vaults (`barebones-beacon-poc`, `accuris-beacon-poc`) and by the workshop's own self-install.

Both shapes use the same canonical `install.js` at runtime via the v0.1.2 thin-stub dispatch — no code paths diverge based on layout. The only difference is the value stored in `workshop_relative_path`.

For the legacy onboarding flow (manual git clone + manual config files + manual stub copy), see [use.md → "Onboarding a new consumer vault (post-v0.1.2)"](use.md).
