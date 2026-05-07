# Installing Sauce (v0.23.0+)

This is the user-facing install reference for the **inside-vault layout** introduced in v0.22.0 — a single curl one-liner clones the workshop into `<vault>/pantry/`, npm-installs, and runs the first-run wizard.

For architectural context see [how.md](how.md). For ongoing operations see [use.md](use.md).

> [!info] Two layouts coexist
> v0.22.0 introduces the inside-vault layout but does NOT retire the legacy sibling-of-workshop layout (`workshop_relative_path: "../beacon"`). Existing POC vaults continue to work unchanged. Only fresh consumer vaults bootstrapped via the curl one-liner default to the inside-vault `pantry/` shape.

---

## One-liner usage

> [!abstract] The whole install
> ```bash
> cd /path/to/your/vault
> curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh | bash
> ```

The script runs four phases with sectioned output:

```
  ╔══════════════════════════════════════╗
  ║   Sauce   ·  installer               ║
  ║   Obsidian vault platform            ║
  ╚══════════════════════════════════════╝

  [1/4] Detecting environment...                OK
        node v22.1.0 · git 2.45.0 · vault /Users/me/notes/personal

  [2/4] Cloning workshop into pantry/...        OK

  [3/4] Installing dependencies...              OK

  [4/4] Running first-run wizard...
        ?  Workshop path inside vault: pantry
        ?  Vault display name: personal
        ?  Mechanisms to subscribe: ...
        ?  Blueprints to subscribe: ...
        ?  Confirm and write config? Yes
```

When the wizard finishes the script prints a final "Activate with: source pantry/Scripts/activate.sh" hint.

> [!warning] Run from inside the vault dir
> The script defaults `--vault` to the current working directory. cd into the vault first OR pass `--vault /abs/path/to/vault` explicitly.

---

## Prerequisites

> [!info] What you need before running the one-liner
> - **Node.js 18 or newer** — the platform runs on Node's standard library + a single dependency (`@inquirer/prompts`).
> - **git 2.30 or newer** — used for the initial clone and for `sauce update`.

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
├── pantry/                               NEW — workshop clone (git-managed)
│   ├── platform/                         CLI verbs, install.js, mechanisms, blueprints
│   ├── Scripts/
│   │   ├── activate.sh                   NEW — per-shell PATH + SAUCE_VAULT export
│   │   └── sauce                         NEW — bash wrapper exec'ing node CLI
│   ├── node_modules/                     npm install --omit=dev artifact
│   └── .git/                             clone --depth=1 history
├── ranch/                                Consumer-side platform state
│   ├── platform-config.json              NEW — vault-side path map + variables
│   ├── platform-subscription.json        NEW — what mechanisms/blueprints you opted into
│   └── platform-installed.json           NEW — auto-managed install ledger
└── (your existing notes)
```

> [!info] What "git-managed" means
> The `pantry/` directory is a real git clone with `origin` pointing at the upstream Sauce repo. `sauce update` calls `git fetch + git reset --hard origin/main` inside it. Hand-edits are wiped on the next update — see [landmines.md #18](landmines.md).

> [!success] Resolved in v0.23.0
> The macOS APFS case-collision (former `Beacon/` ≡ lowercase `beacon/<module>/`)
> is resolved by renaming the workshop clone dir to `pantry/`. Daily Notes
> "Open today's daily note" works correctly on macOS APFS as of v0.23.0.
> Upgrading from v0.22.x: see "Upgrading from v0.22.x" section below.

---

## Upgrading from v0.22.x

If you have an existing v0.22.0 / v0.22.1 install:

```bash
cd <vault>
mv Beacon pantry                                                                # rename workshop clone dir
sed -i '' 's/"workshop_relative_path": "Beacon"/"workshop_relative_path": "pantry"/' ranch/platform-config.json
source pantry/Scripts/activate.sh
sauce status                                                                    # verify
```

If you exported `BEACON_VAULT` / `BEACON_REPO_URL` in your shell rc-file,
update them to `SAUCE_VAULT` / `SAUCE_REPO_URL`.

---

## Upgrading from v0.23.x to v0.24.0

The runtime plumbing directory has moved from `<vault>/Docs/Meta/` to `<vault>/ranch/`. The `beacon-button` mechanism has been renamed to `accent-button`. Run this once per consumer vault:

```bash
cd <vault>
mv Docs/Meta ranch
sed -i '' 's|Docs/Meta|ranch|g' ranch/platform-config.json
# Then in Obsidian: Cmd+R, then run the platform install command (or `sauce update` from the CLI).
```

The new stub md5 invariant for `<vault>/ranch/Templater/platformInstall.js` is `ea23aa812503bfca66359d3b2b239ba8`. Existing stubs at the OLD md5 (`a39257da1dd49ae4481e5cd0a42bdac4`) will be overwritten by the next install run with the new canonical body.

---

## Activation per shell

The install does **not** touch your shell rc files (`~/.zshrc`, `~/.bashrc`, etc.) — every new shell starts un-activated.

> [!success] Activate the current shell
> ```bash
> cd <vault>
> source pantry/Scripts/activate.sh
> ```
>
> Output:
> ```
> sauce active. Try: sauce status
> ```

What activation does:

```sh
export PATH="<abs-vault>/pantry/Scripts:$PATH"
export SAUCE_VAULT="<abs-vault>"
```

After that, the `sauce` CLI is on your PATH and works from anywhere. `SAUCE_VAULT` is the fallback the dispatcher uses if you run a verb from outside the vault tree.

> [!tip] Want it persistent?
> Add `source /abs/path/to/vault/pantry/Scripts/activate.sh` to your shell rc. The platform deliberately doesn't do this for you — auto-modifying shell rc is a CLAUDE-side ask-before-acting concern.

---

## Day-2 operations

> [!example]- `sauce status` — read-only state report
> ```
>   Sauce   ·  v0.23.0
>   Vault:        ~/notes/personal
>   Workshop:     pantry/  (git head a3f2b1, clean, 0 behind origin/main)
>   Subscribed:   7 mechanisms · 8 blueprints
>   Drift:        none
> ```
> No writes. Safe to run any time. Use it before `sauce update` to see what would change.

> [!example]- `sauce update` — pull latest workshop + re-run installer
> ```
>   [1/4] Fetching origin/main...                 OK (3 new commits)
>   [2/4] Checking working tree...                OK (clean)
>   [3/4] Resetting pantry/ to origin/main...     OK
>   [4/4] Re-running installer...                 OK
>         2 files updated · 0 errors
>
>   Tip: Cmd+R Obsidian to pick up changes.
> ```
>
> What happens:
> 1. `git fetch origin` inside `pantry/`
> 2. Working-tree dirty check — if dirty, **fails loud** (use `--force` to override).
> 3. `git reset --hard origin/main`
> 4. If `package.json` SHA changed, re-runs `npm install --omit=dev`
> 5. Re-invokes the installer phase against the same config

> [!example]- `sauce update --force` — dirty-tree override
> When you've hand-edited something inside `pantry/` (which you shouldn't — see [landmines.md #18](landmines.md)) and need to discard those edits to get back to a clean upstream:
> ```bash
> sauce update --force
> ```
> The dirty check is skipped; `git reset --hard origin/main` discards local changes.

> [!example]- `sauce wizard` — re-run the subscription / config prompts
> Falls through to the existing re-run wizard from `bootstrap-lib/wizard.js`. Lets you toggle subscribed mechanisms / blueprints, edit the path-variable config, or quit without changes. Idempotent — quitting at any point leaves files untouched.

---

## Sync exclusion guides

`pantry/` contains two large directories that should NOT be cloud-synced:

- **`pantry/node_modules/`** — npm install artifact; large, regenerable via `sauce update`.
- **`pantry/.git/`** — git history; large, regenerable via re-clone.

Per provider:

> [!example]- Obsidian Sync
> 1. Open Obsidian Settings → Sync.
> 2. Find the **Exclude from sync** field.
> 3. Add (one per line):
>    ```
>    pantry/node_modules
>    pantry/.git
>    ```
> 4. Save.
>
> The `.bak` files left behind by `sauce update --force` (or by landmine #12 backup-on-edit mechanics) are NOT auto-excluded but are small. If they bother you, also add `pantry.bak` and `pantry.bak.*`.

> [!example]- iCloud Drive
> iCloud's exclude mechanism is path-suffix-based: appending `.nosync` to a directory name signals iCloud to leave it un-synced.
>
> ```bash
> mv pantry/node_modules pantry/node_modules.nosync
> mv pantry/.git pantry/.git.nosync
> ```
>
> > [!warning] This breaks `require()` and `git`
> > Renaming `node_modules` to `node_modules.nosync` makes Node's resolver fail (it looks for `node_modules` literally). Renaming `.git` makes git operations fail.
> >
> > Workaround: use **System Settings → Apple ID → iCloud → Drive → Sync Desktop & Documents Folders** to keep the vault local. Or pick a non-iCloud path for your Obsidian vault.
> >
> > **Recommended posture:** if you use iCloud Drive, do NOT put your Obsidian vault inside it. Put the vault under `~/notes/` or another non-iCloud path.

> [!example]- Dropbox (Smart Sync / Online-only)
> 1. Right-click `pantry/node_modules` in Finder/Explorer → Smart Sync → **Online only**.
> 2. Right-click `pantry/.git` → Smart Sync → **Online only**.
>
> The directories remain on disk references but their contents are not stored locally; Dropbox fetches on demand. Node and git both still work — Dropbox transparently materializes files on access.

---

## Troubleshooting

> [!example]- "Not inside a sauce-managed vault"
> The CLI dispatcher walks cwd ancestors looking for `ranch/platform-config.json`. If it doesn't find one and `$SAUCE_VAULT` isn't set, you get this error.
>
> Fixes (any one works):
> 1. `cd` into the vault root or any subdirectory of it before running `sauce`.
> 2. `export SAUCE_VAULT=/abs/path/to/vault` and re-run.
> 3. Re-source the activation script: `source <vault>/pantry/Scripts/activate.sh` (this sets `SAUCE_VAULT`).

> [!example]- "Working tree dirty" on `sauce update`
> ```
>   [2/4] Checking working tree...                FAIL
>         pantry/ has uncommitted changes:
>          M platform/install.js
>          ?? pantry/local-experiment.js
>         Re-run with --force to discard.
> ```
>
> Fixes:
> 1. **Discard the dirty state** (recommended; see landmine #18): `sauce update --force`.
> 2. If you genuinely need to keep the changes, copy them out of `pantry/` first, then `sauce update --force`.

> [!example]- "pantry/ already exists" on re-install
> When running `curl ... | bash` for a second time, the script refuses to overwrite an existing `pantry/` because curl|bash provides no TTY for an interactive prompt.
>
> Fixes:
> 1. **Download the script first** then run it directly (it can prompt):
>    ```bash
>    curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh -o install.sh
>    bash install.sh
>    ```
> 2. **Force-overwrite (backs up to `pantry.bak`)**:
>    ```bash
>    bash <(curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh) --overwrite
>    ```
>
> The script preserves any prior `pantry.bak` by timestamping it (`pantry.bak.YYYYMMDD-HHMMSS`) — backups are never destroyed.

> [!example]- `sauce` command not found
> The `sauce` CLI is added to PATH via `activate.sh`. PATH state is per-shell:
> - Each new terminal needs `source <vault>/pantry/Scripts/activate.sh` before `sauce` works.
> - The script does NOT modify `~/.zshrc` or `~/.bashrc` (that's an explicit choice — see "Activation per shell" above).
>
> Verify:
> ```bash
> echo "$PATH" | tr ':' '\n' | grep pantry/Scripts
> # should print: /abs/path/to/vault/pantry/Scripts
> ```

---

## Uninstall

To fully remove Sauce from a vault:

```bash
cd <vault>
rm -rf pantry/ pantry.bak pantry.bak.*
rm -f ranch/platform-config.json \
      ranch/platform-subscription.json \
      ranch/platform-installed.json
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

- **Inside-vault (v0.22.0+, default for fresh consumers):** workshop clone at `<vault>/pantry/`, `workshop_relative_path: "pantry"` in `platform-config.json`. Bootstrapped via the curl one-liner.
- **Sibling-of-workshop (legacy, still supported):** workshop checked out at a path adjacent to the vault, e.g., `~/Documents/obsidian/sync/workshop/beacon/`, with the consumer's `platform-config.json` pointing at it via `workshop_relative_path: "../beacon"`. Used by existing POC vaults (`barebones-beacon-poc`, `accuris-beacon-poc`) and by the workshop's own self-install.

Both shapes use the same canonical `install.js` at runtime via the v0.1.2 thin-stub dispatch — no code paths diverge based on layout. The only difference is the value stored in `workshop_relative_path`.

For the legacy onboarding flow (manual git clone + manual config files + manual stub copy), see [use.md → "Onboarding a new consumer vault (post-v0.1.2)"](use.md).
