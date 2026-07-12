# Installing Sauce (v0.23.0+)

> [!warning] Superseded as of v0.36.0
> The curl|bash inside-vault flow described in this document is **deprecated**. Sauce now distributes via Homebrew (`brew install willfell/sauce/sauce`) with the pantry under the brew prefix instead of `<vault>/pantry/`. See **[use.md](use.md#install-v0360)** for the current install + update + migrate-layout flow. The body below is retained as a historical reference for vaults still on the pre-v0.36 inside-vault layout.

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
> The macOS APFS case-collision (former `Beacon/` ≡ lowercase `spice/<module>/`)
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

The new stub md5 invariant for `<vault>/ranch/templater/platformInstall.js` is `ea23aa812503bfca66359d3b2b239ba8`. Existing stubs at the OLD md5 (`a39257da1dd49ae4481e5cd0a42bdac4`) will be overwritten by the next install run with the new canonical body.

> [!info] CustomJS plugin `jsFolder` migration
> v0.24.0 ships a new `applyCustomJsSettings` helper that automatically migrates `.obsidian/plugins/customjs/data.json:jsFolder` from `Docs/Meta/Scripts` to `ranch/scripts` on the first install run. Surgical: only overwrites the legacy v0.23.x value or absent settings; any other user-customized `jsFolder` is preserved.
>
> If you upgrade and dataviewjs blocks render `SpaceNavButtons unavailable` / `<ClassName> unavailable`, your CustomJS plugin's scan folder is stale. Either (a) run `sauce update` (helper auto-migrates), or (b) open Obsidian Settings → Community Plugins → CustomJS, set `jsFolder` to `ranch/scripts`, then Cmd+R.

## Upgrading from v0.24.x to v0.25.0

The blueprint module namespace has moved from `<vault>/beacon/<module>/` to `<vault>/spice/<module>/`. The backup-suffix convention has changed from `.beacon-backup` to `.sauce-backup`. v0.25.0 ships under fresh-start posture — no legacy consumer state to preserve. If your vault has prior v0.24.x state under `<vault>/beacon/`, the cleanest upgrade is wipe + reinstall:

```bash
cd <vault>
# Backup anything personal under <vault>/beacon/ (notes you want to keep) elsewhere first.
rm -rf beacon
sauce update --force
```

After reinstall, all blueprint content lands at `<vault>/spice/<module>/` (e.g., `spice/daily/`, `spice/projects/`, `spice/finance/`). Templater folder-template registrations + Daily Notes core-plugin folder are rewritten by the installer to the new namespace.

> [!success] Sauce rebrand sequence COMPLETE
> v0.23.0 (Tree 1) renamed the workshop clone `Beacon/` → `pantry/`. v0.24.0 (Tree 3) renamed the runtime plumbing `Docs/Meta/` → `ranch/`. v0.25.0 (Tree 2) renames the blueprint module namespace `beacon/<module>/` → `spice/<module>/`. The `pantry/` + `ranch/` + `spice/` namespace tripod is now the canonical layout.

---

## Upgrading from v0.25.x to v0.26.0

v0.26.0 lowercases the four `ranch/` subdirectories (`Templater` → `templater`, `Scripts` → `scripts`, `Templates` → `templates`, `Views` → `views`) to resolve macOS APFS case-collision risk and standardize platform-managed directory naming (per landmine #19). v0.26.0 also fixes the `sauce wizard` "Edit subscription" double-wrap bug, scaffolds `Templater` data.json defaults at install time so daily-note placeholders render correctly on first run, and adds `convenience` to the default mechanism set.

Existing v0.25.x consumers must wipe + reinstall the four affected directories:

```bash
cd <vault>
rm -rf ranch/Templater ranch/Scripts ranch/Templates ranch/Views
sauce update --force
```

The next install run materializes the lowercase variants and updates `<vault>/ranch/platform-config.json:variables` automatically. No data loss — every file under those directories was installer-managed and gets re-materialized from the workshop's canonical source.

> [!info] Also new in v0.26.0
> - Wizard "Edit subscription" no longer produces nested `{name: {name, version}, version: "0.0.0"}` entries (P0-1 fix). Legacy double-wrapped state on disk is healed automatically on next edit.
> - Templater `data.json` is scaffolded automatically at install time (P0-2 — `scaffoldFoundationalPluginData` helper). No more 6 silent helper-skips on fresh installs; daily-note Templater placeholders render correctly on first run.
> - `convenience` mechanism now ships in `DEFAULT_MECHANISMS_CHECKED` (P0-3) — fresh non-interactive installs get DataviewJS + Cmd+- / Cmd+= copy-path hotkeys by default. `sauce wizard` users can opt out.

---

## Upgrading from v0.28.0 to v0.29.0

v0.29.0 ships the `sauce audit` CLI verb — a programmatic vault conformance auditor (detection-only). Run `sauce update --force` to pull v0.29.0 and let the installer apply the new state additively.

What's new:

- **NEW `sauce audit [--vault PATH] [--blueprint NAME] [--output-file PATH] [--no-untracked-check] [--quiet]` verb.** Reads consumer's `ranch/rules/<bp>.json`, walks `<vault>/spice/<bp>/**/*.md`, applies rule_fragments[], reports per-blueprint structural violations + untracked top-level directories. Exit 0/1/2. See `Docs/audit.md` for the user guide.
- **NEW `rule_fragments[]` shipped on 5 blueprints with PATCH bumps:** trips@0.1.5→0.1.6, project@1.3.6→1.3.7, people@0.1.0→0.1.1, meetings@0.3.0→0.3.1, daily@0.2.3→0.2.4. Auto-merged into `ranch/rules/<bp>.json` on `sauce update`.
- **NEW additive validator schema extensions:** `equals`, `matches`, `contains`, `scope.path_glob`, `scope.exclude_basenames`, `frontmatter_branch[]`. Read-side compatible with pre-v0.29.0 rule files (old rules without these fields produce identical violation output).
- **NEW landmine #21:** `sauce audit` is read-only against the audited vault (mirrors landmine #20 for `sauce migrate` source).

> [!warning] Audit is detection-only
> v0.29.0's audit reports violations; it does NOT auto-fix. Cleanup happens manually (or session-by-session with Claude editing files). Auto-fix tooling deferred to a future cycle.

> [!info] install.js applyRuleFragment now array-supporting
> Pre-v0.29.0 install.js wrote single-value contributions; v0.29.0 patches to array-support so multiple fragments per blueprint accumulate. Backward-compatible read: legacy single-value contributions are wrapped in `[value]` on next install.

> [!info] Coverage is partial — 5 of 9 blueprints
> rule_fragments shipped for trips/project/people/meetings/daily this cycle. journal/to-do/boards/finance get their fragments in v0.29.1+ PATCH cycles (pure-additive).

---

## Upgrading from v0.27.0 to v0.28.0

v0.28.0 ships the `sauce migrate` CLI verb + 8 per-blueprint migrators + 5-phase atomic --commit orchestrator + cross-blueprint wikilink-rewrite + phase 4.7 post-write verification + phase 4.8 auto-recovery. **No vault layout changes**, no schema changes for existing consumers; the migrate verb is a NEW capability that converts a real source vault (Accuris/Ero/Headspace shape) into a fresh sauce-managed vault. Existing v0.27.0 consumers run `sauce update --force` to refresh the CLI; nothing else changes.

What's new:

- **NEW `sauce migrate --from <source> [--commit]` verb.** Dry-run by default emits `migration-plan.json`; `--commit` triggers the 5-phase atomic write (precheck → backup → bootstrap → carry-verbatim → rewrite-blueprint → wikilink-rewrite → mtime-preserve → verify → recover → finalize). Source vault is NEVER modified (landmine #20). Target vault is wiped in-place + rebuilt; sibling backup at `<vault>.pre-migration-<ts>/`. See `Docs/migrate.md` for the full user guide.
- **8 per-blueprint migrators**: people / daily / meetings-note / meetings-hub (Accuris pattern) / to-do / boards / project (path-translation only; full Sauce shape v0.29.x) / trips. Verbatim fallback claims everything else.
- **NEW phase 4.7 post-write verification + phase 4.8 auto-recovery** (CF-10): walks every plan entry post-write; re-invokes the appropriate migrator for any missing target. Logged in `migration.log.verification: {verified, missing, recovered}`.
- **NEW landmine #20**: source vault MUST never be modified by migration tooling. Future migrator code review must reject any `srcAbsPath`-rooted write.

> [!warning] Source vault is read-only
> The migrator never writes to `--from <path>`. If a future migrator change introduces a write to the source path, that's a critical bug — the source IS your only intact copy of pre-migration content. Code review must grep for `writeFileSync` / `appendFileSync` / `truncateSync` / `unlinkSync` / `renameSync` / `rmSync` and verify every call uses a target-rooted path.

> [!info] Three real vaults migrated in v0.28.0
> v0.28.0 migrated `/sync/accuris/` (1.5GB; 1670 entries), `/sync/ero/` (55MB; 489 entries), `/sync/headspace/` (120MB; 759 entries) into `/sync/sauce/<name>-sauce/`. Phase 4.7 verification on re-run reports `verified=plan_count, missing=0` for all three. User-confirmed phone-Sync visual smoke PASS for accuris-sauce.

---

## Upgrading from v0.26.1 to v0.27.0

v0.27.0 ships the People mechanism + blueprint + meetings pilot integration. Pure-additive at the install layer (no new state-materializing helpers; no allowlist additions; no schema breaks). Run `sauce update --force` to pull v0.27.0 and let the installer apply the new state additively.

What changes after the update:

- **NEW `people-rendering@0.1.0` mechanism** — shared `PeopleRendering` CustomJS class shipping `renderChip` / `renderCard` / `renderMentionList` / `extractMentions`. Materialized at `ranch/scripts/people-rendering/people-rendering.js`. Used by the people blueprint + meetings pilot in this cycle; reusable by daily / journal / project / todos in future cycles.
- **NEW `people@0.1.0` blueprint** — per-person notes at `spice/people/<First Last>.md`, canonical hub at `spice/people/People.md`, three classes (`PeopleHubCards` / `NewPersonButton` / `PersonNavButtons`). Templater folder-template registered for `spice/people` → `Template, People.md` (any new file under `spice/people/` auto-applies the template). Global "People" nav-button (Lucide users icon).
- **`cards@0.2.3 → 0.2.4` PATCH ADDITIVE** — `subtitle` parameter polymorphism extended to accept `(parent: HTMLElement) => void` callback in addition to existing `string | null | {text, secondaryText}`. Default behavior unchanged for existing callers.
- **`nav-buttons@2.5.2 → 2.5.3` PATCH ADDITIVE** — adds `people` Lucide users icon (12th ICONS entry).
- **`meetings@0.2.2 → 0.3.0` MINOR — pilot integration with people-rendering**:
  - **MeetingsHubCards subtitle** now renders attendee chips for registered People (those with `spice/people/<name>.md` notes) via `PeopleRendering.renderChip` callback. Falls back to existing comma-string when no registered People are in the meeting's `## Attendees` section. Extraction is scoped to the `## Attendees` section only (won't pick up People mentioned elsewhere in the body).
  - **`Template, Meetings.md`** gains a `## Attendees` chip-rendering dataviewjs block ABOVE the existing bullet list. Existing meeting notes (pre-v0.27.0) keep their original body; only newly-created meetings post-update include the chip block. Legacy attendees still work — wikilinks remain navigable; the chip block reads body wikilinks at render time. Migration tooling (v0.28.0) MAY append the chip block to migrated meetings as an opt-in body-rewrite step.
  - **NewMeetingButton attendees autocomplete** — DEFERRED to a v0.27.x carry. For now, manually type wikilink form (`[[Jane Doe]]`) when entering attendees in the new-meeting overlay.

> [!warning] Existing meeting notes do NOT retroactively gain the `## Attendees` chip block
> Only newly-created meetings post-v0.27.0 install include the chip block. Existing meetings keep their original body. The chip block is purely additive — adding it manually to an existing meeting is supported (paste the block above your existing `## Attendees` bullet list).

> [!info] People hub creation
> The People hub at `spice/people/People.md` is created at install time. Its body has a self-tag `type: people-hub` + dataviewjs blocks invoking `SpaceNavButtons` + `NewPersonButton` + `PeopleHubCards`. Click `+ New Person` to create your first person note. Per-person notes auto-route to `spice/people/<First Last>.md` via the Templater folder-template.

> [!success] Migration risk profile
> Migration tooling (v0.28.0) will translate consumer-vault People notes (e.g., `Extras/People/<Name>.md` from accuris/ero/headspace) into Sauce's `spice/people/<First Last>.md` shape with zero data loss. Filename + frontmatter migrate 1:1. Pre-locking the canonical schema in v0.27.0 makes v0.28.0 a mostly-mechanical migration script.

---

## Upgrading from v0.26.0 to v0.26.1

v0.26.1 is purely additive — no migration steps required. Run `sauce update --force` to pull v0.26.1 and let the installer apply the new state additively.

What changes after the update:

- **4 new community plugins fetched + auto-enabled** (`obsidian-admonition`, `calendar`, `obsidian-tasks-plugin`, `url-into-selection`). The plugins are added to your vault's `.obsidian/plugins/` and to `.obsidian/community-plugins.json`. Each ships with empty `data.json` — configure each via its plugin UI under Settings → Community plugins.
- **`alwaysOpenInNewTab: true`** is written to `.obsidian/app.json` (your existing app.json keys are preserved verbatim; a `.sauce-backup` is written before the edit). After this, every wikilink click opens in a new tab. To disable: Obsidian Settings → Files & Links → "Always open in new tab" → off. The platform won't re-overwrite on subsequent installs because the additive merge is platform-as-overrider only for declared keys.
- **NEW `sauce help` verb** — running `sauce help` (or bare `sauce` / `sauce --help` / `sauce -h`) prints a usage screen listing all 5 verbs. Works from any directory, including outside any sauce-managed vault.
- **NEW `sauce status` warning** — when a subscribed blueprint declares `convenience` in its `depends_on` but the convenience mechanism isn't subscribed, status emits a `[warn]` line listing the affected blueprint(s).
- **Wizard auto-add convenience** — `sauce wizard` (both first-run and re-run "Edit subscription") now auto-adds `convenience` to your selected mechanisms when any DV-using blueprint (daily, journal, meetings, project, trips, finance) is selected. Prints `[info] Auto-added convenience because <blueprint> depends on it.` Cannot be disabled, but you can drop `convenience` afterward by re-running wizard if you also drop all DV blueprints.
- **6 DV blueprint depends_on bumps** (PATCH each) — daily 0.2.3, journal 0.1.2, meetings 0.2.2, project 1.3.6, trips 0.1.5, finance 0.2.10. Each blueprint manifest's `depends_on[]` now declares `{ "name": "convenience", "range": ">=0.1.0" }`. No content change; the bumps trigger reprocess via landmine #16.

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
> Each of those paths has a sibling `.sauce-backup` (or `.bak` for vendored themes) created the first time the installer touched it. To revert:
> 1. Find each backup: `find .obsidian -name '*.sauce-backup' -o -name '*.bak'`
> 2. Copy each backup over its live target (e.g., `cp .obsidian/hotkeys.json.sauce-backup .obsidian/hotkeys.json`).
> 3. Reload Obsidian (Cmd+R).
>
> Backups are single-deep — one prior version per target. The platform doesn't auto-rotate them.

---

## Two layouts coexist

The v0.22.0 inside-vault layout is **one of two supported shapes**:

- **Inside-vault (v0.22.0+, default for fresh consumers):** workshop clone at `<vault>/pantry/`, `workshop_relative_path: "pantry"` in `platform-config.json`. Bootstrapped via the curl one-liner.
- **Sibling-of-workshop (legacy, still supported):** workshop checked out at a path adjacent to the vault, e.g., `~/Documents/obsidian/sync/workshop/spice/`, with the consumer's `platform-config.json` pointing at it via `workshop_relative_path: "../beacon"`. Used by existing POC vaults (`barebones-beacon-poc`, `accuris-beacon-poc`) and by the workshop's own self-install.

Both shapes use the same canonical `install.js` at runtime via the v0.1.2 thin-stub dispatch — no code paths diverge based on layout. The only difference is the value stored in `workshop_relative_path`.

For the legacy onboarding flow (manual git clone + manual config files + manual stub copy), see [use.md → "Onboarding a new consumer vault (post-v0.1.2)"](use.md).

---

### Upgrading from v0.69.0 → v0.70.0

Run `sauce install` (or `brew upgrade sauce && sauce install`) — the workshop's installer rewrites `ranch/scripts/activity-feed/activity-feed.js`, `ranch/scripts/daily/space-daily-dashboard.js`, and `.obsidian/snippets/sauce-daily-dashboard.css` in-place. No vault-side migration required; the new opts are additive and the daily dashboard adopts them automatically.

Visual changes you will see in today's daily note:
- The Activity panel groups all `cowork-*` notes under a single "Cowork" header.
- Cowork → Project → Kanban → Trip are pinned at the top; Scratch is pinned at the bottom and collapsed by default.
- Each sub-group renders as a framed section with a colored left stripe; cards inside are now list-style rows with no per-row backgrounds.

If you're a downstream consumer with a CustomJS surface that calls `ActivityFeed.render(..., { flatGrouped: true })` — `flatGrouped` is now a silent no-op (falls through to the legacy `<h4>` renderer). Switch to `framed: true` + the new ordering opts to keep current behavior.

### Upgrading from v0.70.0 → v0.70.1

CSS-only PATCH. Run `sauce install` (or `brew upgrade sauce && sauce install`) — the workshop's installer rewrites `.obsidian/snippets/sauce-daily-dashboard.css` in-place. No JS files change; no API change; no vault-side migration.

Visual changes:
- **Desktop:** times in the Activity panel now align vertically across rows within the same sub-group (e.g., "2:48 AM" and "1:30 PM" share the same right edge). Slightly more breathing room around rows and between meta tokens.
- **Mobile:** sub-group rows now stack — title on top with full-width wrapping, meta tokens (time, pill, todo-badge, breadcrumb) wrap below. Fixes the v0.70.0 issue where wide-meta rows (like the kanban "To Do Board" row with a breadcrumb) lost their title to flex shrinkage on narrow viewports.

### Upgrading from v0.70.x → v0.71.0

MINOR cycle. Run `sauce update` (or `brew upgrade sauce && sauce update`) to pick up:
- `activity-feed@0.5.0`: two additive opts on the v0.4.0 framed renderer — `groupLabels: Record<string,string>` (caller-supplied display-name map; falls back to `_humanCase(key)` when absent) and `groupPreviewBuilder: (pages) => string` (collapsed-group one-line preview after the `(N)` count, 80-char truncation with `…` ellipsis).
- `cowork@0.12.0`: atomic-note contract requires `summary:` + declares optional `warnings:`; 6 write-run-note sub-skills emit Obsidian-native body shape (admonitions + markdown tables); 3 gather skills do runtime MCP-availability detection (no more "failed to pull google calendar" on w2-fte engagements without Google Calendar); 15 per-engagement default prompts drop hardcoded MCP names; cowork Daily/Weekly/Monthly Hub ActivityFeed panels switch to the framed renderer scoped to cowork-* types only, with cadence-ordered groups and prettified display names.
- `daily@0.11.0`: SpaceDailyDashboard consumes the activity-feed v0.5.0 opts and adds 6 cowork-* sub-type pill colors (morning=blue, midday=yellow, eod=purple, finance=cyan, weekly=pink, monthly=red).

**User-side follow-up — re-onboard scheduled jobs:**
After `sauce update` succeeds, re-run `cowork:onboard-scheduled-jobs` against each subscribed vault and pick option **(a)** when prompted to overwrite the v0.68.0-era prompts in `spice/cowork/prompts/*.md` with the new v0.71.0 defaults (drops hardcoded MCP names, adds gather-skipped handling). Users who customized their per-engagement prompt via option (c) at bootstrap time keep their custom prompt — the v0.71.0 body-shape contract still ships via the workshop-side `write-run-note-*` sub-skills, so polished output still renders.

**FLN-v68-1 cleanup (accuris-sauce only):** if you have an `accuris` engagement that was bootstrapped pre-v0.65, re-run `cowork:bootstrap-vault {engagement_id: "accuris"}` to clear the pre-v0.65 headspace-dated contamination in `spice/cowork/context/weekly-snapshot.md`.

Visual changes you will see:
- **Daily dashboard Activity panel:** all `cowork-*` runs merged into one "Cowork" group at the top, with per-row pills now color-tinted by cadence (blue/yellow/purple/cyan/pink/red). Row subtitle reads the curated 1-2 sentence summary, not a body slice. Collapsed groups (scratch) show a one-line preview after the count.
- **Cowork Daily/Weekly/Monthly Hub:** Activity panels now show ONLY cowork-* runs, grouped by cadence with prettified headers ("Morning Briefing" / "Midday Tripwire" / "EOD Review" / "Finance Snapshot" / "Weekly Review" / "Monthly Review"). Today.md (the cross-blueprint landing) and per-day daily notes intentionally keep the cross-blueprint allowlist.
- **Cowork atomic notes** (morning-briefing.md / etc.): now open with a SpaceNavButtons block (consistent with scratch / project / meeting / etc.); body uses Obsidian admonitions (`> [!info]-` synopsis, `> [!example]+` per-section blocks with markdown tables, `> [!tip]` close). Notes carry a 1-2 sentence `summary:` frontmatter field that surfaces on CoworkLatestRuns and the daily dashboard Activity panel rows.
- **Accuris (w2-fte) jobs:** no more "failed to pull google calendar" noise. The calendar section renders as a `> [!warning] Calendar unavailable` admonition when no calendar MCP is wired, and the rest of the briefing composes normally. Same pattern for gmail + imessage when the respective MCP isn't wired.

### Upgrading from v0.71.0 → v0.71.1

PATCH BUGFIX. activity-feed 0.5.0 → 0.5.1: `_humanCase` moved inside `ActivityFeed` class to satisfy customJS's `eval(`(${file})`)` class-file contract. v0.71.0 shipped a file-scope helper that prevented customJS from registering the class, causing "ActivityFeed mechanism unavailable" on daily notes after a customJS reload.

```bash
brew upgrade sauce        # 0.71.0 → 0.71.1
# Bump consumer subscription pin first (FLN-v67-7 manual workaround):
#   activity-feed: 0.5.0 → 0.5.1
sauce update              # picks up the fix
# In Obsidian: reload customJS or restart to clear the cached pre-fix ActivityFeed instance
```

Verifying the fix: open today's daily note. The Activity panel should render the cowork bucket + other groups normally. If you still see "ActivityFeed mechanism unavailable", check that `ranch/scripts/activity-feed/activity-feed.js` has `_humanCase(key)` as a method INSIDE `class ActivityFeed` (not as a `function _humanCase()` declaration above the class).

Regression guard: `AF-V0710-CUSTOMJS-1` in `run-activity-feed.js` asserts the file remains customJS-loadable across future cycles.

### Upgrading from v0.72.x → v0.73.0

MINOR cycle. Four-part bundle: architectural cleanup of the kanban-progress surface + activity-feed efficiency pass.

```bash
brew upgrade sauce        # 0.72.x → 0.73.0
# Bump consumer subscription pins (workshop_version, kanban-status-sync,
# activity-feed, daily) — see the node one-liner in the cycle handoff or
# edit ranch/platform-subscription.json directly.
cd /path/to/your/vault    # critical — sauce update reads cwd ancestry
sauce update --force      # picks up the cycle
# In Obsidian: reload customJS to register KanbanStatusSyncInit + clear
# any cached pre-fix activity-feed instance.
```

What you get:

**Part A — `kanban-status-sync@0.2.0`: startup-script architecture.** The board-to-card frontmatter sync no longer runs inline inside the daily-dashboard's render path. A NEW `KanbanStatusSyncInit` customjs class is registered in `.obsidian/plugins/customjs/data.json`'s `startupScriptNames[]` and runs once at vault boot (Dataview-ready retry-with-backoff, max 30s). Subsequent `customJS.KanbanStatusSync.syncAllBoards` invocations are cache-hits. Eliminates the re-render storm pattern: when an external plugin (e.g., smart-connections embedding queue) causes Dataview to re-execute the dashboard's dataviewjs block, our code is no longer in the hot path.

**Part B — `activity-feed@0.7.0` + `daily@0.13.0`: persisted `<details>` state.** Section + group open/closed toggles now survive Dataview re-renders. State persists to `ranch/cache/dashboard-section-state.json` (best-effort; missing-file or malformed-JSON falls back to default-open semantics). Namespaced keys: `sauce-daily-dashboard:tasks` / `:meetings` / `:activity` for top-level dashboard sections; `sauce-activity-feed:<bucketKey>` (e.g., `:cowork`, `:project`, `:kanban`, `:scratch`) for inner activity-feed groups. Last-write-wins on toggle.

**Part C — manual re-sync command.** Cmd+P → "Sauce: Re-sync kanban boards" (id `kanban-status-sync:resync-now`) bypasses the once-per-day cache and forces a fresh sweep. Useful when you move a card mid-session and want it to surface in the activity feed without restarting Obsidian.

**Part D — activity-feed efficiency audit.** Precedence comments (metaBuilder vs getSubtitle), short-circuit annotation in `_query.inWindow`, manifest description trim. NEW runtime asserts AF-V073-1/2/3 (tsKeys 3-key any-in-window semantics, groupPreviewBuilder gating to manifest-`defaultClosed[]` only, native-Date `_resolveTimeWindow` fallback reachability).

Verifying the fix:
1. Open today's daily note. Toggle the Activity section closed. Switch to another note and back. The section should stay closed.
2. Toggle a single activity-feed group (e.g., `kanban`) closed. The state persists across re-renders.
3. Cmd+P → start typing "Sauce: Re-sync" — the command should appear in the palette.
4. Inspect `.obsidian/plugins/customjs/data.json` → `startupScriptNames[]` should include `KanbanStatusSyncInit`.

**Behavior notes (intentional):**
- `groupPreviewBuilder` still fires only for groups in the manifest's `defaultClosed[]` (e.g., `scratch`). User-toggled state does not change which groups show a preview suffix — by design.
- First daily-note render of a session may show stale kanban frontmatter (the startup sync runs at vault boot but may not have completed by the first render); subsequent renders are correct. If this matters, use the manual re-sync command.

### Upgrading from v0.73.0 → v0.74.0

MINOR cycle. Three workstreams: body-shape enforcement in 6 write-run-note-* skills; tripwire-aspects model broadening midday-tripwire beyond finance; filesystem-first write path + unified onboarding entry-point.

```bash
brew upgrade sauce        # 0.73.0 → 0.74.0
# Bump cowork pin in each consumer vault's ranch/platform-subscription.json:
#   "cowork": "0.12.0" → "0.13.0"
# (manual until FLN-v67-7 adds sauce update --bump-pins)
cd /path/to/your/vault    # critical — sauce update reads cwd ancestry
sauce update              # picks up the cycle
# Re-run the onboarding flow (see below)
cowork:onboard-scheduled-jobs   # invoke in Claude Code / Claude for Obsidian
```

**What you get:**

**Workstream A — body-shape enforcement.** All six cowork cadence-note skills now self-check before writing: title must match the deterministic formula (`{engagement_id} — {Cadence Label} — YYYY-MM-DD`), and the body must include five structural markers (summary frontmatter + `> [!info]- Synopsis` + `> [!example]+` section blocks + `> [!tip]` close). Any miss returns `failed:contract-violation:<field>` and halts — no partial files. The cowork manifest enforces `title: required` on all 6 atomic-note rule_fragments.

**Workstream B — tripwire-aspects model.** The midday-tripwire orchestrator now fires for w2-fte and consulting engagements, not only personal/finance. New `tripwire_aspects[]` field in engagement-type JSON files:
- `personal`: `["cc_drift"]` (unchanged behavior)
- `w2-fte`: `["calendar_drift", "queue_growth"]` — fires when meetings change or open task count grows
- `consulting`: `["cc_drift", "calendar_drift", "queue_growth"]` — all three aspects

Severity vocabulary simplified: `yellow|red` → `warn|alert`.

`cowork:gather-calendar` gains a `drift-check` mode (48-hour meeting-change window). `cowork:gather-projects` gains a `tripwire-delta` mode (open-count growth since last run).

**Workstream C — filesystem-first writes + unified onboarding.** All six `write-run-note-*` skills no longer use `mcp__obsidian__create_note`. They now write via `Bash mkdir -p` → `Write` → `wc -c` byte-count assertion. Notes are written even when the Obsidian REST API is unavailable (e.g., vault not open, or running from a remote Claude Code session).

`cowork:onboard-scheduled-jobs` is rewritten as the single conversational entry-point post-upgrade:

1. Prints a welcome explaining what it will write.
2. Checks if `vault-config.md` exists; if not, auto-delegates to `cowork:bootstrap-vault` first.
3. Detects re-runs (prompts before overwriting customized prompts).
4. Asks one bulk-defaults question: **(a)** use all workshop defaults or **(b)** customize per-cadence.
5. Copies per-cadence prompt files from workshop defaults into `spice/cowork/context/{engagement_id}/prompts/` via filesystem Read+Write with byte-count assertion.
6. Prints a summary table of what was written / skipped.

**Verifying the upgrade:**

1. `sauce update` exits 0; `ranch/platform-installed.json` shows `cowork@0.13.0` and `workshop_version: 0.74.0`.
2. Run `cowork:onboard-scheduled-jobs` — it should complete without prompting for MCP credentials and write all enabled-cadence prompt files.
3. Trigger a morning-briefing run. The output note should: have `title:` frontmatter matching `{id} — Morning Briefing — YYYY-MM-DD`; open with `> [!info]- Synopsis`; close with `> [!tip]`.
4. If you have a w2-fte or consulting engagement, trigger `cowork:midday-tripwire` — it should now gate on `tripwire_aspects.length > 0` and run the appropriate gather/decide branches.

**Behavior notes (intentional):**
- Consumer subscription cowork pin still requires a manual edit until FLN-v67-7 lands. Edit `ranch/platform-subscription.json` → `pinned.cowork: "0.13.0"` in each consumer vault before running `sauce update`.
- Existing customized prompt files (prompts whose byte count diverges from the workshop default) are skipped by `cowork:onboard-scheduled-jobs` unless you explicitly confirm overwrite. Your customizations are preserved.

---

## Upgrading from v0.82.0 to v0.82.1

PATCH release. `sauce update --bump-pins` works as normal — no vault-side migration steps required.

What changes:

- **Workshop:** `0.82.0` → `0.82.1`. Platform-internal changes only (install.js rules-merge dedup, parseYamlIsh regex, test harness refactors). No new blueprint or mechanism contract surfaces.
- **cowork:** `0.21.0` → `0.21.1` (PATCH; mechanism-internal; no contract surface change for blueprint consumers). The cowork PATCH bump was added mid-cycle to exercise the new `resetSourceContributions` mechanism through the production install path.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.82.0" → "0.82.1"
#   "cowork": "0.21.0" → "0.21.1"
# Then:
sauce update --bump-pins   # or: sauce update --force
```

**One-time side effect:** `ranch/rules/cowork.json` on each consumer vault will naturally shrink (from ~7900 lines down to ~600 lines, or proportional based on how many dogfood cycles that vault has had) as the new `resetSourceContributions` mechanism fires during cowork's PATCH re-install. This is not an entry loss — it is de-duplication of accumulated bloat (duplicate copies of the same path_glob fragments, pre-existing since ~v0.78.0). The canonical rule set is preserved.

No user action needed beyond the pin bump. No migration script. No manual `ranch/rules/cowork.json` cleanup required — the installer handles it automatically on the first cowork re-install after the bump.

---

## Upgrading from v0.82.x to v0.83.0

MINOR release. `sauce update --bump-pins` works as normal — no vault-side migration steps required.

What changes:

- **Workshop:** `0.82.1` → `0.83.0`. Engagement-type materialization: cowork now ships `w2-fte.json`, `personal.json`, and `consulting.json` via `files[]`.
- **cowork:** `0.21.1` → `0.22.0` (MINOR — new install surface; 3 engagement-type JSONs now materialize to `spice/cowork/context/engagement-types/`).

**Engagement-type manifests now materialize to `spice/cowork/context/engagement-types/`.** No action required — `sauce update --bump-pins` populates the dir automatically. These are STOCK files (overwritten on every `sauce update` to stay current with the workshop manifest). Do not hand-edit them; they are not user-customizable.

**Orchestrators that previously relied on workshop-path resolution** (`bootstrap-vault`, `onboard-scheduled-jobs`, and the 5 atomic-note orchestrators) now read the materialized path at `spice/cowork/context/engagement-types/<type>.json`. This makes engagement-type-driven orchestrator behavior (e.g., midday-tripwire `tripwire_aspects` gating) reachable on consumer vaults for the first time.

**Consumer overrides at the legacy `spice/cowork/engagement-types/` (no `context/`) path are no longer scanned.** If a user authored a file at the old pre-v0.83.0 path, the file is preserved on disk but inert. Recovery: copy the diff into the workshop source via PR, or wait for a future `.local/` seam if one is introduced.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.82.1" → "0.83.0"
#   "cowork": "0.21.1" → "0.22.0"
# Then:
sauce update --bump-pins   # or: sauce update --force
```

After the update, verify by checking that `spice/cowork/context/engagement-types/w2-fte.json` (or whichever type you use) is present in your vault. If running `cowork:midday-tripwire` previously silent-no-op'd on a w2-fte or consulting engagement, it should now correctly read `tripwire_aspects` from the materialized file.

---

## Upgrading from v0.83.x to v0.84.0

MINOR release. `sauce update --bump-pins` works as normal — no vault-side migration steps required. One required post-deploy user action (see below).

What changes:

- **Workshop:** `0.83.0` → `0.84.0`. Tier 0 + Tier 1 of the cowork continuous-memory architecture: `cowork:capture-tick` + `cowork:synthesize-day` orchestrators; morning-briefing pre-flight step 3a wire-through; engagement-types schema 0.4.0.
- **cowork:** `0.22.0` → `0.23.0` (MINOR — new install surface; 2 new orchestrators; morning-briefing wire-through; engagement-type schema 0.4.0 + cadence fields).

**Memory files land at `spice/cowork/memory/<engagement_id>/YYYY-MM-DD.md`.** This directory is NOT a `files[]` entry — it is created by `cowork:capture-tick` on first run. No action required at update time. These files are USER-data and are never overwritten by `sauce update`. You may delete or archive them freely.

**`cowork:morning-briefing` is backward-compatible.** The new pre-flight step 3a reads the most recent memory file and injects a memory context callout into the briefing body. When no memory files exist (i.e., you have not yet run `capture-tick`), the step skips cleanly with no visible change to the briefing output.

**Engagement-type schema 0.4.0.** The three standard engagement-type JSONs (`w2-fte.json`, `personal.json`, `consulting.json`) now include `supported_cadences` + `default_cadences` fields listing `tick` + `synthesize_day`. These are STOCK files overwritten by `sauce update`; do not hand-edit them.

**Required post-deploy user action: re-run `cowork:onboard-scheduled-jobs` after the update.** The new `tick` + `synthesize_day` cadences will not appear in your vault's Cowork.md nav table until `onboard-scheduled-jobs` walks the updated engagement-type JSON and registers them. Run `/cowork` → `onboard-scheduled-jobs` once per consumer vault after `sauce update --bump-pins`.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.83.0" → "0.84.0"
#   "cowork": "0.22.0" → "0.23.0"
# Then:
sauce update --bump-pins   # or: sauce update --force
```

**FLN-v83-2 workaround note.** If `sauce update --bump-pins` bumps the workshop pin but leaves the cowork blueprint pin at `0.22.0` (known bug; inconsistent across machines), manually edit `ranch/platform-subscription.json` to set `"cowork": "0.23.0"` and re-run `sauce update` (no `--bump-pins` needed on the second run). Verify cowork materialized by checking that `spice/cowork/context/engagement-types/w2-fte.json` is present on disk and that `spice/cowork/memory/` is accessible (will be created on first `capture-tick` run).

> [!success] FLN-v83-2 closed in v0.85.0
> v0.85.0 §0.1 ships a defensive hardening to `handleBumpPins`'s workshop-path resolution. v0.85.0+ deploys should no longer require this jq workaround — but real-world deploy validation on accuris/headspace is still owed (FLN-v85-1). If `--bump-pins` still silently skips cowork on v0.85.0+, fall back to the manual `ranch/platform-subscription.json` edit above and file a bug.

---

## Upgrading from v0.84.x to v0.85.0

MINOR release. `sauce update --bump-pins` should work cleanly (v0.85.0 §0.1 closes FLN-v83-2's `--bump-pins` blueprint-pin handling — but see the validation caveat below). One required post-deploy user action (re-run `cowork:onboard-scheduled-jobs`).

What changes:

- **Workshop:** `0.84.4` → `0.85.0`. Tier 2 of the cowork continuous-memory architecture + the load-bearing structured-output read-memory primitive.
- **cowork:** `0.23.0` → `0.24.0` (MINOR — new install surface: 1 new sub-skill `cowork:read-memory` + 1 new orchestrator `cowork:synthesize-week` + 2 new pure helpers + 1 new canonical type `cowork-weekly-synthesis` + rule_fragment + customization-contract STOCK row).
- **Engagement-types schema:** `0.4.0` → `0.5.0` (additive `synthesize_week` field on all 3 standard types — personal / w2-fte / consulting).

**NEW sub-skill `cowork:read-memory`.** Single load-bearing structured-output API for memory-aware orchestrators — returns `{ yesterday, today_ticks, week_synthesis, carry_forward }`. Materializes at `.claude/skills/cowork/skills/read-memory/SKILL.md` (FLN-v79-4 nested sub-skill dest). The morning-briefing's prior inline file-read step 3a is now a thin shim that calls this sub-skill twice + composes output via a new pure helper.

**NEW orchestrator `cowork:synthesize-week` (Friday 17:00).** Reads the week-window (Mon..Fri) for each engagement via `cowork:read-memory`; composes a voice-applied weekly-pattern paragraph (≤300 words) + ≤5 carry-forward bullets; writes to a NEW deep path `spice/cowork/memory/<engagement>/YYYY/MM-Month/YYYY-Www/synthesis.md`. Idempotent re-fires within the same ISO week replace the body while preserving `created_at`. Materializes at `.claude/skills/cowork/synthesize-week/SKILL.md` (FLN-v79-4 flat orchestrator dest).

**Morning-briefing byte-identical refactor.** `morning-briefing/SKILL.md` step 3a now calls `cowork:read-memory` twice (yesterday day + today tick) and pipes results through a new `composeMemoryCallouts` pure helper. The composed callout output is **byte-identical** to v0.84.0 — no consumer-visible change in the briefing body or callout text. Golden-fixture HC-V0850-C3..C5 asserts byte equality.

**§0.1 `sauce update --bump-pins` defensive hardening.** `handleBumpPins`'s `_resolveWorkshopPath` now detects when `installed.workshop_path` (recorded at first install) diverges from the actual on-disk path (the `__filename` ancestry walk) and prefers ancestry. This fix targets the stale Cellar keg scenario that surfaced on accuris/headspace at v0.83.0/v0.84.0 deploy (where `sauce update --bump-pins` resolved the workshop path to a stale Homebrew Cellar keg and silently no-op'd cowork's pin bump). **v0.85.0+ deploys should not require the v0.83.0/v0.84.0 jq workaround.** Real-world validation owed at deploy (FLN-v85-1).

**§0.2 Visible `## Memory` section on Cowork.md hub.** Between Engagements + cadences and About. Inline dataviewjs lists 5 most-recent cowork-memory files cross-engagement. Re-rendered automatically by the next `cowork:bootstrap-vault` or `cowork:onboard-scheduled-jobs` run; or hand-author from the visible source if needed (the section uses standard claude_surface marker pairs).

**§0.3 Atomic-note `[!quote]- Memory log` backlink footer.** Morning-briefing / midday-tripwire / eod-review `## Write` step now emit a small `[!quote]-` callout linking back to today's `memory.md` for the active engagement. One-click pivot from any atomic note to the day's tick stream + synthesis.

**New canonical type `cowork-weekly-synthesis`.** Frontmatter shape: `type` + `engagement_id` + `iso_week` + `week_start` + `week_end` + `days_covered` + `created_at` + `synthesis_at` + `summary`. Rule-engine `naming_pattern`: `^synthesis\.md$`. activity-feed `_DEFAULT_BLUEPRINTS` picks up synthesis files automatically for hub-render.

**Required post-deploy user action: re-run `cowork:onboard-scheduled-jobs` after the update.** The new `synthesize_week` cadence will not appear in your vault's Cowork.md nav table until `onboard-scheduled-jobs` walks the updated engagement-type JSONs and registers it. Run `/cowork` → `onboard-scheduled-jobs` once per consumer vault after `sauce update --bump-pins`.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.84.x" → "0.85.0"
#   "cowork": "0.23.0" → "0.24.0"
# Then:
sauce update --bump-pins   # or: sauce update --force
```

After the update, verify by checking that `spice/cowork/context/engagement-types/w2-fte.json` (or whichever type you use) shows `synthesize_week: true` in its `default_cadences` block. On Friday afternoon, the new `cowork:synthesize-week` orchestrator should fire at 17:00 and produce a `spice/cowork/memory/<engagement>/YYYY/MM-Month/YYYY-Www/synthesis.md` file with a voice-applied weekly-pattern paragraph + carry-forward bullets.

**Optional: workshop self-install drift catch-up.** The workshop dogfood subscription's `workshop_version` had drifted to `0.84.0` during the mid-cycle daily-blueprint polish PATCHes (v0.84.2/3/4) shipped from another chat. S11 absorbed the bump to `0.85.0` in lockstep. Consumer vaults whose subscriptions had been tracking v0.84.x will catch up to v0.85.0 in one `sauce update --bump-pins` run (no manual jq required if §0.1 hardening holds).

## Upgrading from v0.85.0 to v0.85.1

PATCH release. Closes FLN-v85-1 (v0.85.0 §0.1's defensive hardening was insufficient for the active-pantry deploy layout) + fixes a synthesize-week Friday-timing miss. **One required user action when upgrading from v0.85.0:** hand-adjust each existing `cowork-synthesize-week-<engagement>` scheduled job's cron field (see below). All other changes are transparent.

What changes:

- **Workshop:** `0.85.0` → `0.85.1`. Bug-fix to `_resolveWorkshopPath` + cron-default tweak + active-pantry drift warning.
- **cowork:** `0.24.0` → `0.24.1` (PATCH — SKILL.md prose change in synthesize-week + onboard-scheduled-jobs cadence walk).
- **Engagement-types schema:** unchanged at `0.5.0`.

**§1 `_resolveWorkshopPath` generalization (FLN-v85-1 CLOSED).** New `_isValidWorkshopRoot()` helper probes any candidate ancestor for a parseable `platform/manifest.json` with a `workshop_version` field. The ancestry walk no longer requires a `libexec/`-named ancestor, so `sauce update --bump-pins` now resolves cleanly across all three deploy layouts:

- **brew Cellar** (`.../Cellar/sauce/0.85.x/libexec/platform/manifest.json`)
- **active-pantry** (e.g., `.../Documents/obsidian/sync/workshop/sauce/platform/manifest.json`)
- **in-vault pantry** (`.../vault/pantry/platform/manifest.json`)

No `--workshop-path` flag dance required for any of the three. If you previously hand-passed `--workshop-path` on accuris/headspace to work around v0.85.0's libexec-only heuristic, you can drop it from your `sauce update` invocations going forward.

**§2 `installed.workshop_path` auto-populated on first resolve.** `handleBumpPins` now writes the resolved workshop path back to `ranch/platform-installed.json` after first successful resolve (when the stored value was null or diverged). Future `sauce update --bump-pins` invocations short-circuit without re-walking the filesystem. Inspect via:

```bash
jq -r '.workshop_path' ranch/platform-installed.json
```

The value is durable + debuggable; if `sauce update` ever resolves to a surprising path, the divergence is now visible on disk.

**§3 Synthesize-week default cron `0 17 * * 5 → 30 17 * * 5` (Friday 17:00 → 17:30).** Friday's synthesize-day fires at 17:20 (`cron 20 17 17 * * 1-5`). v0.85.0's synthesize-week default of `0 17` fired BEFORE synthesize-day, sees only Mon-Thu synthesized, drops Friday from the week roll-up. v0.85.1 moves the default to `30 17` (Friday 17:30, after synthesize-day's 17:20 fire) — captures Friday data in the week roll-up.

**REQUIRED user action: hand-adjust existing scheduled jobs.** Scheduled jobs registered at v0.85.0 onboard via `cowork:onboard-scheduled-jobs` (e.g., `cowork-synthesize-week-accuris`) carry the old `0 17 * * 5` cron and **will NOT auto-update**. For each consumer vault with an existing `cowork-synthesize-week-<engagement>` task, edit the cron field once via the scheduled-tasks MCP. The one-liner pattern (adjust to your MCP's API):

```text
For each existing `cowork-synthesize-week-<engagement>` task:
  Change cron from `0 17 * * 5` to `30 17 * * 5`.
```

After the edit, `sauce update --bump-pins` to pick up the v0.85.1 SKILL.md text (so the prose displayed by `/cowork` matches your active cron). Newly registered jobs (via a fresh `cowork:onboard-scheduled-jobs` walk) get the v0.85.1 default automatically.

**§4 Active-pantry drift warning.** New `_warnIfActivePantryDrift()` helper in `cmd-update.js` detects when `sauce update` is running against an active-pantry checkout (heuristic: resolved workshop path does NOT contain `/Cellar/`) and runs `git fetch origin --quiet` + `git rev-list --count HEAD..origin/main`. If the checkout is N-behind `origin/main`, you'll see a stderr Notice:

```
sauce: active-pantry workshop is <N> commits behind origin/main.
   Pull with: cd <workshop-path> && git pull --ff-only origin main
```

Best-effort: fetch failures emit a different Notice and don't block the install. This pre-empts the v0.85.0 deploy-time friction pattern (active-pantry was 189 commits behind; the just-shipped deploy fix never actually ran because the checkout was stale).

**Required user action after `sauce update --bump-pins`:** none beyond the cron migration in §3 above. The §1 generalization + §2 auto-populate land transparently. The §4 drift warning is read-only — it surfaces N-behind state but doesn't modify anything.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.85.0" → "0.85.1"
#   "cowork": "0.24.0" → "0.24.1"
# Then:
sauce update --bump-pins   # or: sauce update --force

# Hand-adjust each existing cowork-synthesize-week-<engagement> task's cron:
#   0 17 * * 5  →  30 17 * * 5
# (via your scheduled-tasks MCP)
```

After the update, verify the synthesize-week SKILL.md prose by checking `.claude/skills/cowork/synthesize-week/SKILL.md` shows `30 17 * * 5` (or "Friday 17:30") in its schedule line. On the next Friday afternoon, `cowork:synthesize-week` should fire at 17:30 (after the 17:20 synthesize-day fire) and produce a `spice/cowork/memory/<engagement>/YYYY/MM-Month/YYYY-Www/synthesis.md` file that includes Friday's data in the roll-up.

## Upgrading from v0.85.1 to v0.86.0

MINOR release. `sauce update --bump-pins` should work cleanly (v0.85.1's `_resolveWorkshopPath` generalization covers all three deploy layouts). **No required user action.** The wire-through is additive + null-data gated — atomic-note output is enriched when memory is present, unchanged when memory is absent (e.g., on the first day after install before any memory has accumulated).

What changes:

- **Workshop:** `0.85.1` → `0.86.0`. Cross-orchestrator memory wire-through (FLN-v84-2 CLOSED) — 4 atomic-note orchestrators newly memory-aware.
- **cowork:** `0.24.1` → `0.25.0` (MINOR — new install surface: 4 new pure helper files in `files[]` (`compose-midam-memory-callout.js`, `compose-eod-memory-callout.js`, `compose-weekly-memory-callout.js`, `compose-monthly-memory-callout.js`) + SKILL.md surface changes on 4 orchestrators).
- **Engagement-types schema:** unchanged at `0.5.0`.

**4 orchestrators gain memory wire-through.** Each of `cowork:midday-tripwire`, `cowork:eod-review`, `cowork:weekly-review`, `cowork:monthly-review` now invokes `cowork:read-memory` at pre-flight step 3a with the appropriate tier+window and pipes the structured output through a new per-orchestrator compose helper. The output is a new `[!example]+` / `[!info]+` callout injected after the orchestrator's synopsis. Specifically:

- **midday-tripwire** — reads recent 4 hours of tick activity (`tier: "tick"`, `limit_ticks: 4`); injects `[!example]+ Earlier today` callout listing tick HH:MM lines.
- **eod-review** — reads the full day's ticks (`tier: "tick"`, `limit_ticks: 16`) AND today's daily synthesis (`tier: "day"`, `window: "today"`); injects `[!example]+ Today's tick log` + (when day-synthesis present) `[!info]+ Today's pattern`.
- **weekly-review** — reads this week's Tier 2 synthesis (`tier: "week"`, `window: "this-week"`); injects `[!info]+ This week so far` with weekly_pattern + up to 5 carry-forward bullets.
- **monthly-review** — reads up to 4 weekly syntheses for the current month (`tier: "week"`, `window: { start, end }`); injects `[!info]+ This month's pattern` aggregating each week as a bullet.

**No consumer-visible behavior change without memory.** All 4 new compose helpers are null-data gated — when a memory file is absent (e.g., on the first day after install, or for an engagement that hasn't yet accumulated synthesis output), the relevant callout silently omits and the orchestrator body proceeds unchanged. Tomorrow's morning briefing on accuris and headspace continues to fire byte-identical to v0.84.x — the morning-briefing surface is unchanged in v0.86.0; only the 4 newly-wired orchestrators change.

**No required user action.** Existing cadences are unchanged (midday / eod / weekly / monthly fire at their established times). No scheduled-job edits required. No engagement-type schema bump. No `cowork:onboard-scheduled-jobs` re-run required. After `sauce update --bump-pins`, the new helpers + SKILL.md prose materialize automatically into `.claude/skills/cowork/` on next install.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.85.1" → "0.86.0"
#   "cowork": "0.24.1" → "0.25.0"
# Then:
sauce update --bump-pins   # or: sauce update --force
```

After the update, verify by checking that `.claude/skills/cowork/midday-tripwire/SKILL.md` references `cowork:read-memory` in its pre-flight section. On the next midday-tripwire / eod-review / weekly-review / monthly-review fire, the relevant `[!example]+` / `[!info]+` callout should appear in the atomic note's body (when the underlying memory file is present). If the underlying memory tier is absent, the callout silently omits — that's expected null-data behavior, not a regression.

## Upgrading from v0.86.0 to v0.87.0

MINOR release. `sauce update --bump-pins` should work cleanly. **No required user action for the cycle's headline behavior to ship cleanly** — the Echoes wire-through is additive + null-data gated. Morning-briefing output is byte-identical to v0.86.0 when sc-bridge or the Smart Connections plugin is absent; the Echoes callout surfaces only when both prerequisites are met AND the corpus has matches above threshold.

What changes:

- **Workshop:** `0.86.0` → `0.87.0`. Semantic-retrieval over memory (FLN-v84-4 CLOSED).
- **cowork:** `0.25.0` → `0.26.0` (MINOR — new install surface: NEW sub-skill `cowork:gather-semantic-memory` at `skills/skills/gather-semantic-memory/SKILL.md` + NEW pure helper `compose-semantic-echoes-callout.js` in `files[]` + SKILL.md modification on morning-briefing).
- **Engagement-types schema:** unchanged at `0.5.0`.
- **smart-connections-bridge:** unchanged at `0.1.1` (existing `semantic-search` op covers v0.87.0 needs).

**NEW sub-skill `cowork:gather-semantic-memory`** wraps `sc-bridge semantic-search` behind a structured-output API. Inputs `{ engagement_id, anchor_text, top_k, exclude_window, min_similarity }`; output `{ found, matches[], anchor_text_used, exclusion_count, error }` with one match per `{ path, similarity_score, day_or_week, tier, synthesis_excerpt }`. Tier 2 (synthesis.md) matches prioritized over Tier 1 (memory.md); Tier 0 (per-tick) excluded from retrieval scope. Graceful failure-mode taxonomy (`empty_anchor` / `sc_bridge_unavailable` / `index_unavailable` / `timeout` / empty `matches[]`) — sub-skill never throws.

**NEW helper `composeSemanticEchoesCallout`** renders a `[!quote]+ Echoes from your record` callout listing up to `top_k` matches:

```markdown
> [!quote]+ Echoes from your record
> Patterns from your past that resemble today's signal:
> - **<day_or_week>** (similarity 0.NN) — _"<excerpt>"_
```

Byte-identical to a golden test fixture. Returns empty string when the gather output is null, `found: false`, or `matches[]` is empty.

**MB step 3b auto-includes the Echoes callout when sc-bridge + SC index are available.** The new pre-flight step composes anchor_text from today's `dispatch_plan_summary` + `calendar_summary` + `email_summary` (≤500 chars total) and invokes the sub-skill with `top_k: 2`, `exclude_window: "last-30d"`, `min_similarity: 0.45`. Body composition appends the Echoes callout after the Overnight callout (or after the synopsis if Overnight + Yesterday were both empty), BEFORE the v0.85.0 `[!quote]- Memory log` backlink footer.

### Required consumer setup for Echoes to surface

For the Echoes callout to actually appear in MB output, BOTH of the following must be true on the consumer vault:

1. **`smart-connections-bridge` mechanism MUST be subscribed** in `ranch/platform-subscription.json`. Check with:
   ```bash
   jq '.mechanisms[] | select(.name == "smart-connections-bridge")' ranch/platform-subscription.json
   ```
   If the query returns nothing, add `{ "name": "smart-connections-bridge", "version": "0.1.1" }` to the `mechanisms[]` array and re-run `sauce update`. The bridge ships the `sc-bridge` Node CLI that the new sub-skill wraps.

2. **Smart Connections plugin MUST be installed + indexed in Obsidian.** Open Settings → Smart Connections in the consumer vault; verify the index status reports "ready" + the corpus size is at least ~50 memory files for meaningful retrieval. The plugin maintains the `.smart-env/multi/*.ajson` corpus files that the bridge reads.

Without those two, **MB still fires normally** — the sub-skill returns `error: "sc_bridge_unavailable"` or `error: "index_unavailable"`, the helper returns empty string, and the Echoes callout cleanly omits from the body. No regression, no user-visible error. The rest of MB (yesterday's pattern, overnight ticks, dispatch plan, served-by callouts) is byte-identical to v0.86.0.

```bash
# Bump consumer subscription pins (workshop + cowork) — edit each vault's
# ranch/platform-subscription.json:
#   "workshop_version": "0.86.0" → "0.87.0"
#   "cowork": "0.25.0" → "0.26.0"
# Optionally (if not already subscribed) add to mechanisms[]:
#   { "name": "smart-connections-bridge", "version": "0.1.1" }
# Then:
sauce update --bump-pins   # or: sauce update --force
```

After the update, verify by checking that `.claude/skills/cowork/skills/gather-semantic-memory/SKILL.md` exists in the consumer vault and that `.claude/skills/cowork/morning-briefing/SKILL.md` references `cowork:gather-semantic-memory` in its pre-flight step 3b. On the next morning-briefing fire (with sc-bridge subscribed + SC plugin indexed + ≥1 month of accumulated memory above the `exclude_window: "last-30d"` cutoff), the Echoes callout should appear in the atomic-note body. If any of those prerequisites is missing, the callout silently omits — expected null-data behavior, not a regression.

**Optional post-deploy validation (FLN-v87-1).** The `min_similarity: 0.45` threshold is a design-time guess. Review the first 3-5 morning briefings on each consumer vault: if Echoes callouts surface obviously-unrelated matches, the threshold should be raised; if relevant matches are consistently filtered out (callout omits even on days with clear historical analogues), the threshold should be lowered. A v0.87.1 PATCH can ship the empirically-validated threshold.

## Upgrading from v0.115.x to v0.117.4

After `brew upgrade sauce`, run from each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

v0.117.4 is a **test/doc hardening PATCH** — no new consumer behavior and no new migrations fire at install time. The to-do and project blueprint versions are unchanged (to-do 0.5.3, project 1.22.1). The redeploy is a clean no-op for vault users. Workshop 0.117.3 → 0.117.4.

**What this upgrade arc shipped (v0.116.0 → v0.117.4):**

The six-cycle arc added a full recurrence engine, per-project To-Do notes, a +New Task dialog, daily materialization aggregators, and four follow-up PATCHes closing post-deploy regressions:

- **v0.116.0 (to-do blueprint expansion MINOR):** 8 new customjs classes (RecurrenceParser, TaskParser, ToDoDailyCarryover, ToDoDailyRecurring, ToDoDailyProjectGroups, ToDoDailyUnassignedMeetings, ToDoCreateTask, ToDoCreateTaskInit), 2 new note types (`project-todo` + `to-do-recurring`), 2 new installer steps (`applyToDoBlueprintMigration` backfill + entity-create registry hydration), retired ToDoMigrateModal/Init. Project blueprint 1.21.2 → 1.22.0 (extra_files scaffolds Project To-Do.md per project; new project-todo rule_fragment).
- **v0.116.1 (dialog + nav + mobile PATCH):** Recurring-tab Create-button enable fix; project-todo context in ProjectNavButtons; mobile-friendly LeafActions labels. Project 1.22.0 → 1.22.1.
- **v0.117.0 (SectionLabel visual polish + LOAD-BEARING template fix MINOR):** Fixed the v0.116.0 silent bug where `Today To-Do.md` template was never updated (Write tool no-op on an existing file). H2-to-SectionLabel migration across all daily/project-todo/recurring surfaces. to-do 0.4.1 → 0.5.0 (adds `depends_on: project >=1.21.0`).
- **v0.117.1 (frontmatter sentinel PATCH):** Fixed misplaced HTML-comment sentinels that were breaking the YAML frontmatter block on newly-created dailies. "Today's Capture" renamed to "Today". to-do 0.5.0 → 0.5.1.
- **v0.117.2 (dialog anchor PATCH):** Fixed the +New Task dialog creating orphan `## Today` H2 at EOF when the SectionLabel anchor was missing. 3-tier fallback (SectionLabel → legacy H2 → EOF-no-new-heading). Orphan H2 cleanup migration added. to-do 0.5.1 → 0.5.2.
- **v0.117.3 (project-name normalization PATCH):** Fixed meeting-task-assigned-to-project not appearing in the daily's project section. NEW `_normalizeProjectName` static method handles all Dataview Link object representations; per-meeting try/catch prevents one bad meeting from blanking the whole array. to-do 0.5.2 → 0.5.3.
- **v0.117.4 (regression-net + doc backfill PATCH):** Three orphaned to-do harnesses wired into release:preflight (run-todo-carryover, run-todo-dialog, run-todo-materialize). Behavioral coverage for all v0.117.x fixes. HC-V01174 source contracts. Seed-migration end-to-end. This is the current version.

**What `sauce install` does on update:**

`applyToDoBlueprintMigration` runs on every install (unconditional, idempotent). On vaults still on the pre-v0.116.0 shape it will:

1. Reshape v0.3.3-shape To-Do dailies to the five-section v0.4.0/v0.5.0 shape (SpaceNavButtons + ToDoLeafActions + SectionLabel blocks for Today / Carryover / Recurring Tasks / Owned Tasks / From Meetings).
2. Inject or repair misplaced `SectionLabel("Today")` blocks on v0.4.0 dailies that are missing them.
3. Relocate any HTML-comment sentinels that landed inside the YAML frontmatter block (v0.117.1 heal).
4. Strip orphan `## Today's Capture` / `## Today` H2 lines from daily notes (v0.117.2 cleanup).
5. Backfill `Project To-Do.md` via `extra_files[]` for any project that doesn't yet have one.

All steps are idempotent. `.sauce-backup/<ts>/` snapshots are written before any note body is modified.

**Post-deploy check.** Open today's daily note. It should render five sections — Today, Carryover (from yesterday), Recurring Tasks, Owned Tasks, and From Meetings — each headed by a SectionLabel dataviewjs block (not a `## H2`). The +New Task button should insert tasks under the Today SectionLabel, not at EOF. Meeting tasks assigned to a project should appear under `OPEN PROJECT TASKS > <PROJECT NAME>`.

**No cowork surface touched.** `scheduled-job-contract.json` `contract_version` UNCHANGED. No `/cowork sync-scheduled-jobs` run required.

---

## Upgrading from v0.103.0.1

After `brew upgrade sauce`, run from each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

v0.104.0 is the cleanest cycle close in the recent arc: **pure additive — no migration step, no schema change, no template rewrite, no installer step, no contract bump**. The entire surface delta is helper materialization. Workshop 0.103.0.1 → 0.104.0; project blueprint 1.17.0 → 1.18.0; all other mechanism/blueprint versions UNCHANGED (cowork 0.40.0; contract 0.35.1; meetings 0.8.0; entity-create 0.5.0; platform-claude 0.1.3).

v0.104.0 closes the original v0.102.0 three-item ask. Sections + meetings link shipped at v0.102.0; search was deferred to v0.102.1 then re-evaluated against v0.103.0's section-hub reframe. The deferred search design adapted cleanly here because the underlying user-need (in-page filter + tag chips + scoped-search escape hatch) was unchanged and the section-hub model gave us natural query scope per hub for free.

**What `sauce install` materializes:**

- `ranch/scripts/project/doc-search.js` — NEW. `DocSearch` CustomJS class. `render(dv, opts)` builds the filter UI strip (text input + dynamic top-8 tag chips + scoped-Obsidian-search button + status pill) and returns the initial `filterContext` `{text, tags, hasActiveFilter}`. Static `DocSearch.matches(page, ctx)` is the pure predicate consumed by `ProjectDocsIndex` + `SectionHub` at query time — AND-logic across text substring (`file.name` + `tags` + first 200 chars of `file.content`) + every selected tag chip. The scoped-search button invokes Obsidian's `global-search:open` command pre-filled with `path:"<scopePath>"` — the escape hatch for full-body fuzzy search.
- `ranch/scripts/project/project-docs-index.js` — REFRESHED. Mounts `customJS.DocSearch.render` above the section card row at `recursive: true` cross-section scope. The `allDocs` query gates on `customJS.DocSearch.matches` so the dashboard doc-count chip + per-section meta counts both reflect the live filter. `onChange` triggers full re-render via `dv.container.empty() + this.render(dv)` with `_currentCtx` carry-over.
- `ranch/scripts/project/section-hub.js` — REFRESHED. Mounts `customJS.DocSearch.render` at depth-appropriate scope (depth 1 `recursive: true` so the count covers sub-section docs; depth 2 `recursive: false` leaf). Docs query + depth-1 sub-section card meta count gate on `customJS.DocSearch.matches`. Same `onChange` full-re-render pattern.
- `ranch/platform-subscription.json` — workshop `0.103.0.1` → `0.104.0` + project pin `1.17.0` → `1.18.0` (lockstep).

**What does NOT change:**

- No schema changes; no frontmatter rewrites; no doc-note touches; no project-note touches.
- No `applyProjectSectionsHubMigration` re-run (that step is idempotent and was already complete at v0.103.0).
- `scheduled-job-contract.json` `contract_version` UNCHANGED at `0.35.1`.
- No `cowork` blueprint change (stays at 0.40.0). No `align-scheduled-jobs` run required.
- meetings / entity-create / platform-claude UNCHANGED (0.8.0 / 0.5.0 / 0.1.3).
- Empty filter on every Docs.md + Section Hub = zero behavior change from v0.103.0.1.

**Restart Obsidian (or `customJS:reload`).** CustomJS only picks up the new `DocSearch` class on first vault load or via Cmd+P → `CustomJS: Reload`. After reload, every Docs.md + Section Hub re-renders with the filter strip mounted above the section card row.

**Post-deploy visual check.** Open a project's Docs.md in Obsidian. Above the section card row should now sit a filter strip: text input ("Filter docs by title, tags, or content…") + 8-or-fewer tag chips drawn from the docs in scope + a scoped-search button. Type a few characters — section card doc-counts narrow in real time; the status pill ("Filtering: 'X' — N of M docs") appears. Click a tag chip — chip activates; filter ANDs with the chip selection. Click the scoped-search button — Obsidian's global search opens pre-filled with `path:"spice/projects/<slug>/docs"`. Open a Section Hub — the same filter strip appears scoped to that section (recursive at depth 1, leaf at depth 2). Clear the input + deselect chips — UI returns to v0.103.0.1 baseline.

## Upgrading from v0.102.0

After `brew upgrade sauce`, run from each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

v0.103.0 ships a single, additive structural change to the project blueprint: a **hierarchical section-hub navigation tree** replaces v0.102.0's single-page Confluence-style Docs Hub. The previous bucket-on-one-page model scaled but did not communicate hierarchy — with 30+ docs across 5+ sections, the section identity got lost in the bucket density. The new model makes each section a first-class entity with its own hub note. Workshop 0.102.0 → 0.103.0; project blueprint 1.16.0 → 1.17.0; all other mechanism/blueprint versions UNCHANGED (cowork 0.40.0; contract 0.35.1; meetings 0.8.0; entity-create 0.5.0; platform-claude 0.1.3).

The v0.103.0 install runs ONE new structural step on top of the existing v0.102.0 pipeline:

1. **`applyProjectSectionsHubMigration`** — runs after `applyProjectSectionsMigration`. Heals each project under `spice/projects/` end-to-end:
   - **Rewires `docs/Docs.md` body** from `ProjectDocsCards` / `ProjectDocsSections` → `ProjectDocsIndex` (the new sections-INDEX renderer). Strips the standalone `entity-create:doc-note` block — `+ New Doc` is now offered by the index helper itself with section preset.
   - **Materializes Section Hub notes** (`Knowledge.md`, `Notes.md`, etc.) in every existing `docs/<slug>/` subfolder. Each hub renders breadcrumb + doc cards + `+ New Doc` button (presetPrompts: section) + sub-section cards + `+ New Sub-Section` button.
   - **Materializes Sub-Section Hubs** for nested subfolders containing ≥1 doc-note. Recurses ONE level (the 2-level cap: project → section → sub-section → docs). Depth-2 hubs suppress sub-section UI.
   - **Migrates doc-note frontmatter** from `section: "Knowledge"` (string) → `section: "[[Knowledge]]"` (wikilink). Adds `sub_section: "[[X]]"` field when the doc-note lives in a sub-folder.
   - **Injects a breadcrumb dataviewjs block** at the top of every doc-note body, guarded by `<!-- breadcrumb-v1.17.0 -->` marker for idempotency. The breadcrumb renders a clickable wikilink trail (project → docs → section → sub-section).
   - **Migrates project `sections[]` frontmatter** from string entries to wikilink form (`"Knowledge"` → `"[[Knowledge]]"`) — or inserts `sections[]` with the discovered labels when the field is absent.
   - **Default-section guarantee** — every project always has Knowledge + Notes hubs after migration, even when currently empty.

Idempotent per-project: re-running install is a no-op once `docs/Docs.md` already invokes `ProjectDocsIndex`. Failure-loud per-project: a per-project try/catch emits a warning event with `step: "project_sections_hub_migration"` but never throws — so one project's failed migration cannot block the rest of the install.

**What `sauce update --bump-pins` materializes:**

- `ranch/scripts/project/breadcrumb.js` — NEW Breadcrumb renderer (clickable wikilink trail on every node).
- `ranch/scripts/project/project-docs-index.js` — NEW sections-INDEX renderer (replaces ProjectDocsSections on `Docs.md`).
- `ranch/scripts/project/section-hub.js` — NEW depth-aware section + sub-section renderer.
- `ranch/scripts/project/project-nav-buttons.js` — section-hub depth 1 + depth 2 context branches.
- `ranch/templates/Template, Section Hub.md` — NEW canonical template for both depth-1 + depth-2 section hubs.
- `ranch/templates/Template, Docs Hub.md` — REWRITTEN to invoke Breadcrumb + ProjectDocsIndex.
- `ranch/templates/Template, Doc Note.md` — extended with `<!-- breadcrumb-v1.17.0 -->` marker + Breadcrumb dataviewjs block prepended.
- `ranch/rules/section-hub.json` — NEW rule registered.
- `ranch/platform-subscription.json` — workshop `0.102.0` → `0.103.0` + project pin `1.16.0` → `1.17.0` (lockstep).

**What does NOT change:**

- `scheduled-job-contract.json` `contract_version` UNCHANGED at `0.35.1`.
- No `cowork` blueprint change (stays at 0.40.0). No `align-scheduled-jobs` run required.
- meetings / entity-create / platform-claude UNCHANGED (0.8.0 / 0.5.0 / 0.1.3).

**Post-deploy visual check.** Open a project Docs hub in Obsidian — should render the breadcrumb at the top, section cards (Knowledge + Notes always present), dashboard chips (doc count + open meetings + project status), and `+ New Section` / `+ New Doc` shortcut buttons. Click a section card — should open the section's `<Section Name>.md` hub with its own breadcrumb, doc cards, `+ New Doc` button, and (depth-1 only) sub-section cards + `+ New Sub-Section` button. Open an existing doc-note — should render the breadcrumb at the top above the SpaceNavButtons row + the doc's original body.

**Expected accuris migration delta on `spice/projects/global-k8s/`:** ~5 existing section folders (created at v0.102.0 deploy) each gain a `<Section Name>.md` Section Hub note; every doc-note gains the breadcrumb marker + block at the top of its body + has its `section:` frontmatter rewritten from string to wikilink form; `Docs.md` body rewritten to invoke `ProjectDocsIndex`; project `sections[]` frontmatter rewritten from strings to wikilinks. Any pre-existing nested doc-note subfolder (depth ≥ 2 below `docs/`) gains a Sub-Section Hub at depth 2 (the cap). Idempotent — second run is a no-op once Docs.md already invokes `ProjectDocsIndex`.

## Upgrading from v0.101.0 to v0.101.1

`brew upgrade sauce` → `sauce update --bump-pins` per consumer vault. Project-blueprint PATCH (1.15.1 → 1.15.2); cowork untouched (0.40.0), no schema/contract change, no scheduled-job sync needed.

Fixes the project Docs hub "+ New Doc" button, which was missing on every project created from the pre-0.101.1 template (the entity-create block used a broken `AccentButton` guard form that threw on render). The fix canonicalizes the template AND adds an installer repair step (`applyDocsHubButtonRepair`) that heals already-broken `docs/Docs.md` files in place on update — so existing projects get their button back automatically. Idempotent; canonical hubs are untouched.

### Upgrading from v0.101.1

After `brew upgrade sauce`, run from each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

The v0.102.0 install runs two new steps:

1. **`applyProjectSectionsMigration`** — auto-moves every flat `docs/<doc>.md`
   (except `Docs.md`) into `docs/knowledge/<doc>.md`, adds
   `section: "Knowledge"` frontmatter, and registers any pre-existing
   doc-note-containing subfolders as custom sections in the parent
   project's `sections[]` frontmatter. Idempotent — second run is a
   no-op once `docs/knowledge/` exists.

2. **`applyVaultDefaultPaths`** — creates
   `spice/resources/{notes,attachments}/` and configures Obsidian's
   "Files & Links" defaults if currently unset. Existing user
   customizations are left untouched.

v0.102.0 also ships three platform-level moves on top of the migration:

- **Sections** in the project blueprint — doc-notes get foldered under
  `docs/<section-slug>/`; `Knowledge` and `Notes` ship as platform
  defaults; per-project overrides via `sections: []` in project
  frontmatter; `section:` doc-note frontmatter mirrors the folder
  (folder wins on conflict).
- **Confluence-style Docs Hub** — one labeled bucket per section, each
  as a single-column row list (v0.100.0 row aesthetic preserved); per-bucket
  `+ New <Section>` button via the NEW EntityCreate `presetPrompts`
  capability — no section picker on click; trailing `Unfiled` bucket
  catches orphans.
- **Project ↔ Meetings link** — singular `project:
  "[[ProjectName]]"` field on meeting frontmatter (optional); project
  note grows a `## Meetings` panel above the BacklinkPanel (top-5
  recent + view-all expander + `+ New meeting for this project`
  button); meeting hub rows gain a project pill when set.

Cowork is untouched (0.40.0); contract 0.35.1 holds; no scheduled-job
sync needed.

**What `sauce update --bump-pins` materializes:**

- `ranch/scripts/project/project-docs-sections.js` — NEW Confluence-style
  hub renderer.
- `ranch/scripts/project/project-meetings-panel.js` — NEW project↔meetings
  panel.
- `ranch/scripts/meetings/meetings-hub-cards.js` — project-pill subtitle
  callback.
- `ranch/scripts/entity-create/entity-create.js` — `presetPrompts` +
  `_resolveOptionsSource("all_projects")`.
- `ranch/templates/Template, Docs Hub.md` — invokes `ProjectDocsSections`.
- `ranch/templates/Template, Project.md` — adds `## Meetings` H2
  invoking `ProjectMeetingsPanel`.
- `ranch/platform-subscription.json` — workshop `0.101.1` →
  `0.102.0` + project pin `1.15.2` → `1.16.0` + meetings pin `0.7.0` →
  `0.8.0` + entity-create pin `0.4.0` → `0.5.0` + platform-claude pin
  `0.1.2` → `0.1.3` (lockstep).

**What does NOT change:**

- `scheduled-job-contract.json` `contract_version` UNCHANGED at `0.35.1`.
- No `cowork` blueprint change (stays at 0.40.0). No `align-scheduled-jobs`
  run required.
- No `learned_weights` schema migration, no cowork user-content writes.

**Post-deploy check.** Open a project Docs hub — should render labeled
buckets per section (Knowledge by default; any pre-existing doc-note
subfolders preserved as custom sections); each bucket has a `+ New
<Section>` button (no section picker on click). Open a Project note —
should show `## Meetings` H2 above Mentions, with top-5 recent linked
meetings + `+ New meeting for this project` button. Open the Meetings
Hub — rows linked to a project should show a project pill before the
attendees chip row.

**Expected accuris migration delta:** `spice/projects/global-k8s/` has
~31 flat `docs/<doc>.md`; the install moves them all to
`docs/knowledge/<doc>.md` + adds `section: "Knowledge"` frontmatter.
Any pre-existing doc-note-containing subfolder (e.g., `docs/specs/`)
registers as a custom section in the project's `sections[]`.
Transactional per project — partial failure aborts that project's
migration with full backup hand-undo logged.

## Upgrading from v0.99.0 to v0.100.0 / v0.100.1

> **Skip straight to v0.100.1** — v0.100.0's docs-hub rows threw `e.indexOf is not a function` on click (Dataview Link object passed to `openLinkText`); v0.100.1 PATCH (project 1.15.1) fixes it. Same upgrade steps; one `sauce update --bump-pins` catches both.

`brew upgrade sauce` distributes the new release. Existing consumers run `sauce update --bump-pins` from inside each vault.

v0.100.0 is a **visual-only project-blueprint change** (1.14.0 → 1.15.0). No schema delta, no contract bump, no scheduled-job sync needed (cowork is untouched at 0.39.0).

**What `sauce update --bump-pins` materializes:**

- `spice/projects/<project-hub>/scripts/project-docs-cards.js` — Docs hub now renders a single-column list instead of a stacked grid; right-side meta shows `created <MMM D> · edited <relative>` per row.
- `spice/projects/<project-hub>/scripts/project-nav-buttons.js` — Project nav row uses the accent button style (matching New Doc / New Note) and stretches full-width.
- `ranch/platform-subscription.json` workshop_version `0.99.0` → `0.100.0` + project pin `1.14.0` → `1.15.0` (lockstep).

**What does NOT change:**

- `scheduled-job-contract.json` `contract_version` UNCHANGED at `0.35.1`.
- No `cowork` blueprint change (stays at 0.39.0). No `align-scheduled-jobs` run required.
- No schema migration, no `user-preferences.md` write, no new OI files.

**Post-deploy check.** Open a project hub in Obsidian and confirm the Docs section renders a vertical list (not a grid). The project nav row buttons should match the accent style of the New Doc / New Note buttons with full-width stretch.

---

## Upgrading from v0.97.4 to v0.98.0

`brew upgrade sauce` distributes the new release. Existing consumers run `sauce update --bump-pins` from inside each vault. v0.98.0 bundles the **synopsis-density rewrite MINOR**: a brief-shape contract change at the orchestrator-instructions layer that shifts all five cadence atomic notes (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) from a coverage-emphasis shape (every per-kind callout open by default; `[!tip] <closing>` at the bottom) to a prediction-emphasis shape (one OPEN `[!info]+ <per-cadence title>` lead callout carrying ≤80-word predictive synopsis; all per-kind callouts collapsed by default behind a click; bottom closing callout REMOVED).

**Per-cadence lead callout titles (NEW):**

- morning-briefing → `> [!info]+ What matters today`
- midday-tripwire → `> [!info]+ What changed since morning`
- eod-review → `> [!info]+ What landed today`
- weekly-review → `> [!info]+ Where the week landed`
- monthly-review → `> [!info]+ Where the month landed`

**What auto-installs on the first `sauce update --bump-pins` after upgrade:**

- 5× `spice/cowork/data/orchestrator-instructions/<cadence>.md` with the new lead-callout strings (`[!info]+ <per-cadence title>`) + closing_md composition REMOVED + per-kind contract emit flipped from `[!example]+` (open) to `[!example]-` (collapsed) + NEW `## Synopsis composition rules (v0.98.0 contract)` section at EOF.
- 3× `spice/cowork/context/engagement-templates/{personal,w2-fte,consulting}/prompts/morning-briefing.md` with `## Today at a glance` H2 renamed to `## What matters today` + `## Today's focus` H2 retired (per-bundle prose merged in). The other 12 engagement-template prompts (3 templates × 4 cadences) are author-content and were left untouched per scope-narrowing discovery — see result doc.
- `spice/cowork/helpers/compose-body-helper.js` with the dropped `closing_md` contract:
  - `_validateInput` no longer requires `closing_md` (legacy inputs containing the key tolerated as no-op)
  - `_wrapCallout` emits `[!<callout_type>]- <title>` (was `+` — per-kind callouts now collapsed by default)
  - `_computeAssertions` drops the closing-first-line assertion
  - `composeBody` no longer destructures `closing_md` or emits the closing section
- 9 compose-body golden fixtures under `helpers/fixtures/compose-body/case-*/` regenerated (input.json + expected-body.md + expected-assertions.json) — informational for consumers, not user-edited.
- `ranch/platform-subscription.json` workshop_version `0.97.4` → `0.98.0` + cowork pin `0.35.4` → `0.36.0` (lockstep per v0.93.3 lesson 5.4).

**What does NOT change (backward-compat):**

- `scheduled-job-contract.json` `contract_version` UNCHANGED at `0.35.1` — the wrapper contract shape (substitution_tokens, shared_clauses, per-cadence schema) didn't change; only the orchestrator-instructions bodies' inline-composition rules changed. Landmine #20 lockstep applies on contract DATA shape; byte-identical contract data doesn't require a bump.
- vault-config.md + engagement records continue to work unchanged. No schema delta.
- `learned_weights:` shape stays at schema_version 2 (capture only continues to flow through Rail L's `[!todo]+ Was today useful?` ticks; v0.98.1 expands this surface with per-item ticks + free-text capture; v0.98.2 closes the loop with ingest).

**Cloud-sync (Rail A).** Run `/cowork sync-scheduled-jobs` once per vault from claude.ai's Cowork UI after `sauce update --bump-pins` completes. Rail A pushes new wrapper bodies (substitution-token refresh against new orchestrator-instructions sources) via the scheduled-tasks MCP. Schedule preservation invariant holds (cron field NEVER touched). Skipping this step means cron-fired briefs continue using the OLD wrapper bodies (with the old `[!info]- Today at a glance` synopsis title + the old `[!tip] Today's focus` closing callout); structurally still valid but doesn't carry the v0.98.0 contract.

**First-fire grading window.** Next scheduled cron fire AFTER deploy:

- Morning-briefing on day after deploy emits `> [!info]+ What matters today` as the lead callout, OPEN by default, ≤80 words, first sentence carrying a concrete blocking action token (PR number / person + decision / inbound + ask) — NEVER opens with "Today is..." / "You have..." / "There are N...".
- Per-kind callouts (chat / calendar / github / ado / email / finance per the engagement's priorities) all render `[!<type>]-` (collapsed by default behind a click).
- No `> [!tip] Today's focus` callout at the bottom.
- On empty-day (no actionable items, no inbox debt, no blocking calendar conflicts), synopsis says "Quiet day —" or equivalent plain-acknowledgment (NO padding).

**Quality observability window (7 days post-deploy).** Grade synopsis quality of every fired brief in both consumer vaults daily:

- Synopsis word count distribution (target: 50-60; hard cap 80; grade overshoots as v0.98.0.x PATCH candidate).
- First-sentence concrete-token presence (PR#, person + decision, inbound + ask).
- Cross-kind connective tissue when present.
- Empty-day fallback prose quality (no padding).
- Per-kind callout default-collapsed semantics held across cadences.

**Roll-forward on regression.** If structural regression (lead callout missing / closing callout re-emerges / per-kind callouts back to `+`), v0.98.0.x PATCH revises composition rules. If prose-quality regression (synopsis lecture-mode instead of prediction-mode), v0.98.0.x PATCH tightens the OI rule prose. The 9 compose-body golden fixtures + the 11 new HC-V0980 assert layer guard against structural regressions detectable from the rendered body.

**Coming in v0.98.1.** Questionnaire expansion: stable item-IDs (`^item-<key>` block-IDs on each surfaced person-block / PR-row / ADO-story-row); per-item ticks in Rail L; per-kind frequency knobs (`less / same / more`); free-text feedback capture (fenced code block + sentinel HTML comment). Capture only; no parse-back or ingest yet — v0.98.2 closes the loop via reconciler ingest into `learned_weights`.

**Restart Obsidian.** Not strictly required for v0.98.0 (no new plugins, no startup-script class additions), but a restart picks up the new materialized orchestrator-instructions + helper.js bodies for any claude-skills-aware tooling running inside the vault.

## Upgrading from v0.95.0 to v0.95.1

`brew upgrade sauce` distributes the new release. Existing consumers run `sauce update --bump-pins` from inside each vault. v0.95.1 bundles the **cowork-anti-echo MINOR**: three composable knobs intervening at the three closure points of the cowork memory echo loop — Knob 1 `render_aspects.anti_echo` per-fire callout, Knob 2 `cowork:capture-frame-drift` background tripwire, Knob 3 `lens_shift` weekly cold-MB cadence. All three default OFF in every engagement-type (Approach B opt-in everywhere); bootstrap-vault interview grows 3 NEW Y/N opt-in questions.

**What auto-installs on the first `sauce update --bump-pins` after upgrade:**

- `.claude/skills/cowork/skills/capture-frame-drift/SKILL.md` — NEW sub-skill body for Knob 2. Invoked post-synthesize-day when `plan.tripwire_aspects.includes("frame_drift")`. Requires ≥5 days of memory.md syntheses (fast-path skip if fewer).
- `spice/cowork/helpers/capture-frame-drift-helper.js` — NEW 3-export helper (`extractThemes` async LLM call to `claude-haiku-4-5`; `evaluateDrift` deterministic 3-flag DriftReport; `composeDriftCallout` voice-applied markdown).
- `ranch/scripts/cowork/CoworkLensShiftCards.js` — NEW CustomJS class for Knob 3's Daily Hub warm/cold MB side-by-side rendering (slug-match pairing, no `companion_to:` frontmatter).
- 3 engagement-type JSONs (personal / w2-fte / consulting) bump with `render_aspects.anti_echo: "skip"` default (opt-in `"include"`) + `supported_cadences += ["lens_shift"]` (NOT in `default_cadences`).
- `spice/cowork/data/scheduled-job-contract.json` — `contract_version` 0.32.0 → 0.33.0 (lockstep mirror per landmine #20); NEW `lens_shift` cadence entry with `default_cron: "0 7 * * 6"` + prompt template.
- 4 modified cowork orchestrator SKILL.md bodies: morning-briefing (cold-mode `--cadence lens_shift` branch + drift_warning injection), midday-tripwire + eod-review (`plan.excluded_themes` pass-through), synthesize-day (post-write capture-frame-drift invocation), read-memory (4-key return shape adds `drift_warning: string \| null`), bootstrap-vault (3 NEW Y/N opt-in questions per engagement).
- activity-feed type allowlist registers `cowork-morning-briefing-cold` so Knob 3's cold companion atomic notes surface on Daily Hub.

**What does NOT change (backward-compat):**

- vault-config.md engagement records WITHOUT new opt-ins continue to work — all three knobs default to OFF. Observable behavior unchanged from v0.95.0.
- plan-dispatch contract grows 12 keys → 13 keys (NEW `excluded_themes: string[]` always-present, empty when not opted in). Existing consumers of the contract see one new always-present empty array; nothing breaks.
- Existing v0.95.0 engagement-types JSONs gain the new fields ADDITIVELY; no removed fields.
- Atomic-note output shape unchanged for non-opted-in engagements. Next scheduled cron fire (morning-briefing on day after deploy) should produce a note in the same shape as v0.95.0.

**Optional: try the anti-echo knobs.** After upgrade, edit `spice/cowork/context/vault-config.md` for one engagement:

```yaml
engagements:
  - id: accuris
    type: w2-fte
    # ... existing fields ...
    overrides:
      render_aspects:
        anti_echo: include      # Knob 1: per-fire "Outside yesterday's frame" callout
      tripwire_aspects: [calendar_drift, queue_growth, frame_drift]   # Knob 2: REPLACES bundle (per v0.95.0 semantics)
    cadences:
      # ... existing entries ...
      lens_shift:               # Knob 3: weekly cold-MB
        cron: "0 7 * * 6"       # Saturday 07:00 (default)
```

OR re-run `cowork:bootstrap-vault` to be offered the 3 NEW Y/N opt-in questions interactively (one per knob; can be enabled independently).

**Knob behavior summary:**

- **Knob 1 (anti_echo).** MB / midday / EOD atomic notes grow a `> [!question] Outside yesterday's frame` callout naming ONE item from today's gather that doesn't relate to yesterday's carry-forward bullets. If nothing qualifies, the LLM writes explicit-null prose ("today's gather largely continued yesterday's threads") — load-bearing signal for Knob 2.
- **Knob 2 (capture-frame-drift).** Once-per-day post-synthesize-day, ONE LLM call (`claude-haiku-4-5`, ~$0.50/year/engagement at daily firing) extracts themes from the last 5 day-syntheses + deterministic helper evaluates 3 flags (`frame_repeat ≥4/5 days`, `subject_dominance ≥3/5 days`, `explicit_null 3 consecutive`). On any flag firing, appends a `[!warning]- Frame may be stuck` callout to today's memory.md + frontmatter additions. Tomorrow's MB picks it up via read-memory's NEW `drift_warning` field and injects into "Yesterday at a glance" so the LLM is aware recent days have been thematically locked.
- **Knob 3 (lens_shift).** Weekly Saturday 07:00 (default cron) fires `cowork:morning-briefing --cadence lens_shift` with pre-flight `read-memory` + `gather-semantic-related` SKIPPED. Writes a "cold" companion atomic note with NEW `type: cowork-morning-briefing-cold` + slug `morning-briefing-cold-<engagement>.md`. Daily Hub's `## Lens-shift companions` section renders warm + cold pair side-by-side via `CoworkLensShiftCards` (slug-match, no frontmatter coordination).

**Migrator parking note.** The v0.95.1 slot was originally allocated to a `sauce update --migrate-config` migrator (closes v0.95.0's one-cycle backward-compat window for vault-config.md `overrides:` block). Re-prioritized to anti-echo at brainstorm time. Migrator design + plan PARKED to v0.96.0+ (execution-ready when resurrected); v0.95.0's helper still falls through to bundle defaults when `overrides:` is absent, so existing engagements without overrides keep working through v0.95.1.

**Restart Obsidian.** Not strictly required for v0.95.1 (no new plugins), but a restart picks up the new claude-surface-registry.json + materialized SKILL.md bodies for any claude-skills-aware tooling running inside the vault, AND the new `CoworkLensShiftCards` CustomJS class registration.

## Upgrading from v0.94.0 to v0.95.0

`brew upgrade sauce` distributes the new release. Existing consumers run `sauce update --bump-pins` from inside each vault. v0.95.0 bundles the **cowork-spine MINOR**: a NEW `cowork:plan-dispatch` sub-skill that 5 atomic-note orchestrators (morning-briefing / midday-tripwire / eod-review / weekly-review / monthly-review) invoke as their single source of truth for Gather + Write, plus a NEW `engagement.overrides` schema on vault-config.md engagements[], plus a NEW `data/kind-titles.json` v1.0.0 canonical kind→title map.

**What auto-installs on the first `sauce update --bump-pins` after upgrade:**

- `.claude/skills/cowork/skills/plan-dispatch/SKILL.md` — NEW sub-skill body. Orchestrators READ this at pre-flight step 3b and consume its 12-key result tree (dispatch_plan / voice_contract / microscopes / siblings / allowlist / render_aspects / cadence_order / tripwire_aspects / kind_titles / effective_hard_rules / dispatch_mode / prefs_status).
- `spice/cowork/data/kind-titles.json` v1.0.0 — canonical kind→title map (7 entries: calendar=Today's calendar, email=Email triage, chat=Chat, finance=Finance, github=GitHub, ado=ADO, monitoring=Monitoring). Replaces the inlined kind→title labels in 5 orchestrator bodies + the module-private CANONICAL_TITLES const fallback in `dispatch-plan-helper.js`.
- 5 slimmed orchestrator SKILL.md bodies — pre-flight steps 3b read-prefs + 3c dispatch + 3d microscopes + 3e inner-circle collapse to a single READ of cowork:plan-dispatch. Net **−587 lines** across the 5 orchestrators.
- NEW `Docs/agent-guides/cowork-orchestrator-template.md` v1.0.0 — canonical structural contract every cowork atomic-note orchestrator must conform to.

**What does NOT change (backward-compat for one cycle):**

- vault-config.md engagement records WITHOUT an `overrides:` block continue to work — `composeFinalPreferences` falls through to bundle defaults verbatim. Observable behavior unchanged from v0.94.x.
- Existing engagement-type JSON files (personal.json / w2-fte.json / consulting.json) stay at v0.5.0; no schema change this cycle.
- Atomic-note output shape unchanged. Next scheduled cron fire (morning-briefing on day after deploy) should produce a note in the same shape as v0.94.x. The orchestrator's pre-flight log will show the new plan-dispatch invocation; that's the only observable difference.

**Optional: try engagement.overrides.** After upgrade, you can add an `overrides:` block to any engagement in `spice/cowork/context/vault-config.md` to reorder/tune knobs per-engagement without forking the engagement-type JSON. Examples:

```yaml
engagements:
  - id: accuris
    type: w2-fte
    # ... existing fields ...
    overrides:
      render_aspects:
        finance_block: skip     # disable finance for this engagement
        semantic_related: include   # add semantic echoes (was morning-only)
      cadence_order:
        morning: [calendar, chat, github, ado]   # reorder for morning
      voice:
        vibe: concise           # override the bundle's voice contract
      tripwire_aspects: [cc_drift]   # REPLACES bundle's array (not merge)
```

Composition order: `bundle ⨁ overrides ⨁ ad_hoc_prefs (reserved) → final`. Objects merge per-key with override-wins. Arrays REPLACE bundle values when present.

**Coming in v0.95.1.** `sauce update --migrate-config` will add an empty `overrides: {}` block to every engagement in vault-config.md (so the field is canonical) and drop the backward-compat reads. v0.95.0's one-cycle backward-compat window keeps the helper readable; v0.95.1 locks the schema.

**Restart Obsidian.** Not strictly required for v0.95.0 (no new plugins), but a restart picks up the new claude-surface-registry.json + materialized SKILL.md bodies for any claude-skills-aware tooling running inside the vault.

## Upgrading from v0.93.3 to v0.94.0

`brew upgrade sauce` distributes the new release. Existing consumers should run `sauce update --bump-pins` from inside each vault. v0.94.0 introduces an install-time companion to bootstrap's `phaseFetchPlugins` — `applyExternalPluginInstall` — which auto-fetches every `external_plugins[]` declaration whose plugin directory is absent.

**What auto-installs on the first `sauce update --bump-pins` after upgrade:**

- **realclaudian** (YishenTu/claudian) — new default under convenience 0.4.0. Embeds Claude Code / Codex / Opencode / Pi as AI coding-agent collaborators. Plugin id is `realclaudian` (not `claudian`); the renamed id is purely a community-plugin-store quirk.
- Anything declared in any subscribed mechanism's `external_plugins[]` whose plugin directory is absent in your vault. For consumers who skipped the v0.93.2 → v0.93.3 manual install workflow, this means **new-tab-default-page** (chrisgrieser/obsidian-new-tab-default-page) and **smart-connections** (brianpetro/obsidian-smart-connections) now auto-install too. The v0.93.3 manual-install workflow becomes a historical artifact.

**What does NOT change:**

- User-installed plugins (anything not declared by a sauce mechanism's `external_plugins[]`) are untouched. `community-plugins.json` is additive — sauce ids are appended-if-missing; nothing is removed.
- `applyExternalPlugins` (the warning helper) still runs after the install helper. Plugins marked `required:true` that remain disabled (e.g., because the auto-install failed, or you manually disabled them) still emit the loud Notice.
- The fetch fails warn-and-continue per plugin. If GitHub is unreachable for one plugin, the rest of the install proceeds; the failure is logged to `ranch/platform-installed.json`'s history and a Notice fires.

**Restart Obsidian.** Newly-installed plugins won't load until Obsidian rescans the plugins directory on restart. Close + reopen Obsidian after the update completes; the new plugins (claudian especially) need a restart to activate their commands + ribbon icons.

**Settings.** Claudian's settings (Claude provider, authentication, MCP servers) are user-owned. Open Settings → Claudian after first activation; choose your provider (Claude Code CLI is the recommended path). Sauce does not pre-configure anything for claudian.

## Upgrading from v0.93.2 to v0.93.3

PATCH release. `brew upgrade sauce` distributes the new release. Existing consumers should then run `sauce update --bump-pins` from inside each vault to update `ranch/platform-subscription.json` (bumps `workshop_version` to `0.93.3`, `convenience` pin to `0.3.0`, `smart-connections-bridge` pin to `0.2.0`).

**What v0.93.3 declares:**
- **new-tab-default-page** (chrisgrieser/obsidian-new-tab-default-page) — declared by convenience 0.3.0 in `external_plugins[]` + pre-configured via `community_plugin_settings[]` (whatToOpen=daily-notes, mode=reading-mode, filePath="", compatibilityMode=false). Opens the daily note in reading mode on every new tab.
- **smart-connections** (brianpetro/obsidian-smart-connections) — declared by smart-connections-bridge 0.2.0 in `external_plugins[]` with `required: true`. SC's own defaults are preserved; SC's first-run wizard handles model selection.

### IMPORTANT: existing consumers must manually install both plugins

`platform/install.js`'s `applyExternalPlugins` step is *warning-only* — it reads `.obsidian/community-plugins.json` and emits a Notice for any required dep that is not currently enabled, but it does NOT install or download the plugin. Actual plugin install lives in `platform/bootstrap.js`'s `phaseFetchPlugins`, which runs only during fresh-vault bootstrap (first install).

**After `sauce update --bump-pins` on an existing consumer vault, expect these Notices:**

```
applyCommunityPluginData: convenience prereq plugins missing (new-tab-default-page); skipped
smart-connections-bridge requires plugin smart-connections: (no reason). Install + enable in Settings → Community plugins.
```

These are the expected v0.93.3 contract. **To complete the upgrade:**

1. Open Obsidian → Settings → Community plugins → Browse.
2. Search for **"Default New Tab Page"**, click Install, then Enable.
3. Search for **"Smart Connections"**, click Install, then Enable.
4. Re-run `sauce update --bump-pins` (or `sauce update`). On this second pass, `applyCommunityPluginData` will scaffold `new-tab-default-page`'s `data.json` with the four-key payload (whatToOpen=daily-notes, mode=reading-mode, filePath="", compatibilityMode=false).
5. Optional: in Settings → Smart Connections, accept the default model (bge-micro-v2) and wait 10-30 minutes for the first-run vector indexing to complete. Once indexed, the morning-briefing's Echoes callout will start surfacing pattern matches.

### Why install isn't automated

The bootstrap path (`phaseFetchPlugins`) already iterates every mechanism's `external_plugins[]` and calls `fetchPlugin(id, repo, vaultPath)` per id. The update path (`platform/install.js`) does not. Extending the update path to auto-install absent external plugins is queued as **v0.94.0** (recommended next cycle). Once shipped, this manual step will become a one-time historical artifact: existing consumers will run `sauce update` once after upgrading to v0.94.0 and both plugins will be installed automatically.

### If a vault already has either plugin installed manually

The install is idempotent. User-customized settings outside the four-key shape for new-tab-default-page (`whatToOpen`, `filePath`, `mode`, `compatibilityMode`) are preserved via `applyCommunityPluginData`'s shallow-merge. A `data.json.sauce-backup` is written the first time settings diverge. Smart Connections settings are never touched by sauce.

### Echoes callout warming-up window

The `cowork:gather-semantic-related` skill (used by morning-briefing) needs SC's `.smart-env/multi/*.ajson` vector index to surface "Echoes from your record." On a fresh SC install, the plugin builds this index in the background (typically 10-30 min after first run). Until the index is warm, the morning-briefing will emit `[!warning]+ Semantic index not available` instead of an Echoes block. This is expected behavior; subsequent runs will surface Echoes once SC has indexed.

### Fresh consumer vaults (sauce bootstrap)

If you're setting up a new vault via `sauce bootstrap` (not upgrading an existing one), both plugins are installed and configured automatically — `phaseFetchPlugins` reads every subscribed mechanism's `external_plugins[]` and fetches each from GitHub release assets. No manual step required.

## Upgrading from v0.117.x to v0.118.0

`brew upgrade sauce` distributes the new release. Existing consumers should run `sauce update --bump-pins` from inside each vault. This is a MINOR release — workshop 0.117.4 → 0.118.0, to-do blueprint 0.5.3 → **0.6.0**.

**What this release fixes:**

The +New Task dialog's **Recurring tab Create button** was permanently disabled regardless of input. Root cause: the Obsidian customJS plugin stores **instances** under `window.customJS.<ClassName>`, but `RecurrenceParser.isSupported/matches` and `TaskParser.parseTasks` were declared `static`. Calling a static method on a stored instance returns `undefined`, and `undefined()` throws `TypeError`. In the dialog, this throw aborted `validatePayload()` before it could set `submit.disabled = false`, so the button never enabled. The same defect caused recurring task materialization (`ToDoDailyRecurring`) and carryover task-parsing (`ToDoDailyCarryover`) to throw in live Obsidian. v0.116.1 had misdiagnosed this as a closure-binding issue; the headless test harness masked it by never setting `customJS.RecurrenceParser` to an instance.

Fix: instance-method delegators added to `RecurrenceParser` (`isSupported`, `matches`) and `TaskParser` (`parseTasks`) that forward to the statics. Defense-in-depth `try/catch` wraps all three consumer call sites so a throwing helper degrades gracefully instead of bricking the surface. A repo-wide sweep confirmed no other `static`-on-customJS footguns exist.

**What this release adds:**

Both tabs of the +New Task dialog gained two optional inserter controls:

- **Link a note** — a searchable dropdown of note basenames. Selecting a note appends `[[Note Name]]` to the task title.
- **Add link** — a label text input + URL input + "Insert link" button. Clicking appends `[label](url)` (or `[url](url)` if label is empty) to the title.

The title field remains the single free-text field; `serializePayloadToLine` passes it verbatim, so wikilinks and hyperlinks flow into the `- [ ] …` task line and render live in Obsidian.

**What does NOT change:**

- No new migrations fire for this upgrade — `sauce update --bump-pins` reinstalls the to-do blueprint at 0.6.0, which is an additive dialog enhancement only.
- All 3 consumer vaults redeploy cleanly as a no-op apart from the updated CustomJS helper files. Cmd+R Obsidian after the update to pick up the new code.

---

## Upgrading from v0.118.0 to v0.118.1

After `brew upgrade sauce`, run from each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

This is a **PATCH** that fixes recurring tasks not appearing on daily notes — workshop 0.118.0 → 0.118.1, to-do blueprint 0.6.0 → **0.6.1**.

**What this fixes:**

`ToDoDailyRecurring.parseRegistry` — the function that reads the To-Do Recurring Registry to determine which tasks should materialize onto a daily note — matched only on a literal `## Recurring Tasks` H2 heading as the section start. v0.117.0's SectionLabel migration had replaced that H2 with a dataviewjs `SectionLabel "Recurring Tasks"` block on all existing registries and new-registry scaffolds. As a result, `parseRegistry` returned zero entries on every migrated vault, and recurring tasks stopped materializing onto daily notes entirely from v0.117.0 onward. The regression was invisible in CI because the existing test fixture (`REC-10`) used the legacy H2 form.

Fix: `parseRegistry` now accepts both the SectionLabel block and the legacy H2 as the section start. Section end is recognized by `SectionLabel "Last 7 days of materialization"`, any `## ` heading, or EOF. Existing recurring-task entries are parsed correctly again.

**What does NOT change:**

- No vault content is modified — this is a pure code fix in the to-do blueprint's CustomJS helper.
- All previously-materialized daily notes are unaffected. Today's already-opened daily note may carry a spent `recurring-materialized-<date>` sentinel; only future dailies auto-populate from the next open onward.
- `sauce update --bump-pins` reinstalls the to-do blueprint at 0.6.1. Cmd+R Obsidian after the update to reload the helper.

---

## Upgrading from v0.126.x

`brew update && brew upgrade sauce` (waits for the tap PR to merge after tag push). Then in each consumer vault:

```bash
sauce update --bump-pins
sauce install
```

This is a **MINOR** release — workshop 0.126.1 → **0.127.0**.

`--bump-pins` advances the v0.126.x pins to:

- `workshop_version` → **0.127.0**
- `meetings` blueprint → **0.12.0**
- `project` blueprint → **1.26.0**
- `to-do` blueprint → **0.12.1** (MINOR 0.11.0 → 0.12.0 + in-cycle PATCH → 0.12.1 for a `customJS.ToDoCreateTask.serializePayloadToLine` static-on-instance fix)
- NEW mechanism `task-interactions` → **0.1.0**

**What this release adds:**

- **NEW cross-blueprint mechanism `task-interactions@0.1.0`** — a single `customJS.TaskInteractions` instance with 9 methods (parse / serialize / actionItemsAnchor / todayCaptureAnchor / injectActionItemsMarker / injectTodayCaptureMarker / findTaskLines / appendTask / replaceTaskAt). The inline-dataview-field grammar (`- [ ] x [project:: [[Y]]] [priority:: high] [due:: Z]`) that the +New Task dialog has emitted since v0.118.0 becomes a first-class bidirectional contract consumed by meetings, to-do, and (in a follow-up) project.
- **Meeting New Task dual-write** — the meeting `+ New Task` button now writes the new task into BOTH the meeting's Action Items section AND the corresponding project's `<Name> To-Do.md` (when the meeting's `project:` frontmatter is set). Five Notice variants cover every success / partial-success / failure path.
- **Click-to-edit on `## Today` raw checkboxes** — a NEW `TodayCaptureEditableList` widget renders below the `Today` SectionLabel on each daily To-Do note; each row is clickable; clicking the pencil icon opens the existing `+ New Task` modal in NEW edit mode (Submit-button label flips `Create` → `Save`; destination select disabled; project select stays enabled so you can reassign `[project:: [[Y]]]` without moving the file).
- **Projects.md hub defaults flipped** — the hub now shows all 7 statuses by default (was: 4 active statuses); within-group sort flipped from status priority to latest-folder-mtime DESC so the most-recently-touched project is at the top. Status chips still let you toggle interactively.

**What this release fixes (four post-v0.126.1 bugs):**

- **PeopleRendering `args: [dv, ...]` scrub** — v0.126.1 fixed the double-prepend in the SOURCE (templates + inline_body) but the 411+ existing meeting + people leaf notes in the typical accuris vault still carried the bad pattern on-disk. The installer's `_healNoteChromeBody` now scrubs the `dv,` token from inside any `class: "PeopleRendering"` block (fence-aware, bounded regex, idempotent). Roots extended to include `spice/people`; person notes are now within the heal allowlist.
- **`ProjectMeetingsPanel` heal injection** — existing project hubs created before v0.126.0 were missing the meetings panel that lists every meeting tagged with the project. NEW `applyProjectMeetingsPanelHeal` walks `spice/projects/<slug>/` per project and injects the panel block at a stable anchor (preference: after `ProjectStatusWidget` → after `ProjectNavButtons` → after the first dataviewjs block). Insert-only and idempotent; never touches surrounding user content.
- **Sentinel injection** — `<!-- ACTION_ITEMS_MARKER -->` is back-injected into existing meeting notes (anchor for the new dual-write); `<!-- TODAY_CAPTURE_MARKER -->` is back-injected into existing daily To-Do notes (anchor for `TodayCaptureEditableList`).

**What does NOT change:**

- No manual migration steps required. All four installer heals (args-scrub, `ACTION_ITEMS_MARKER` injection, `TODAY_CAPTURE_MARKER` injection, `applyProjectMeetingsPanelHeal`) run automatically during `sauce install` and are idempotent on re-run.
- The `+ New Task` dialog's create path is unchanged. Only the new `editExisting` mode + the meeting-context dual-write are new behavior.
- No vault data is dropped or restructured. Each transform is fenced + bounded + reads-write-back via the existing `.sauce-backup/<ts>/` snapshot path.
- Cmd+R Obsidian after `sauce install` so the new CustomJS classes (`TaskInteractions` + `TodayCaptureEditableList`) load.

## Upgrading from v0.127.0

This is a **PATCH** — workshop 0.127.0 → **0.127.1**. No blueprint bumps; install.js heal fix only.

```bash
brew update && brew upgrade sauce
```

Then in each consumer vault:

```bash
sauce update --bump-pins
```

`--bump-pins` advances `workshop_version` only (mechanism + blueprint pins unchanged from v0.127.0).

**What this release fixes:**

- **`TodayCaptureEditableList` back-injection into existing daily To-Do notes.** v0.127.0's heal step 6 injected the `<!-- TODAY_CAPTURE_MARKER -->` sentinel but missed the `TodayCaptureEditableList` dataviewjs renderer block. Existing pre-v0.127.0 daily notes ended up with the anchor but no click-to-edit UI. v0.127.1 splits the heal guard so the renderer block back-fills on any note where the marker exists but the renderer doesn't (and remains idempotent on fully-healed notes).

**Effect of running this upgrade:** every pre-v0.127.0 daily To-Do note (any note with `type: to-do` frontmatter + a `Today` SectionLabel) gets the `TodayCaptureEditableList` dataviewjs block back-injected during the next install pass. After `sauce install`, the click-to-edit pencil rows render below the `## Today` SectionLabel on every daily note, matching the experience NEW daily notes have been getting since v0.127.0 deployed.

**What does NOT change:** no manifest bumps; no blueprint source changes; no `TaskInteractions` API change. The fix is a one-function patch in `_healNoteChromeBody`.

## Upgrading from v0.127.1

```bash
brew update && brew upgrade sauce
```

Then in each consumer vault:

```bash
sauce update --bump-pins
```

`--bump-pins` advances `workshop_version` 0.127.1 → 0.128.0 + finance 0.9.2 → 0.10.0.

**What this release adds (finance planning / lever / allocation layer):**

- **NEW `spice/finance/Finance Plan.md`** (`type: finance-plan`) — a per-vault policy singleton (income_floor, fixed_living_monthly, attack_above_minimums, savings_glide tiers, overflow, attack_target_override). Scaffolded create-if-absent with safe zero defaults; fill in your real numbers once.
- **NEW `spice/finance/savings/` sub-area** — Savings.md hub + a seeded Emergency Fund + SavingsSummary / SavingsConfigEditor / SavingsCards.
- **NEW FinancePlanDashboard** on Finance Plan.md — live envelope + avalanche allocation (auto-roll) + savings glide tier + payoff + what-if, with a one-click **Apply** that writes debt `planned_monthly_payment` + your Paycheck Defaults Savings row.
- **NEW PlanBand** flag injected atop every existing `Budget-*.md` (marker `<!-- plan-band-v0.10.0 -->`; `.sauce-backup` snapshot before write) — warns when planned spend exceeds the income-bound envelope.

**Effect of running this upgrade:** `applyFinancePlanScaffolding` + `applyFinanceSavingsScaffolding` create the plan + savings entities (create-if-absent; existing data untouched), and `applyFinancePlanBandInjection` adds the PlanBand block to every Budget. Cmd+R to load the 5 new CustomJS classes. Additive + backcompat: zero new required fields on existing Budget/Paycheck/Debt notes; the dashboard shows a "set up your plan" prompt until you fill in `Finance Plan.md`.

## Adding the `reader` blueprint (new blueprint — vX.Y.Z, pipeline-assigned)

The **`reader` blueprint** (`spice/reader/`) is a flat reading queue for web articles clipped via the official **Obsidian Web Clipper**. A NEW blueprint is **not** added by `--bump-pins` alone — each vault subscribes a subset — so you must add it to the subscription and install with the **vault as the CWD**.

```bash
brew update && brew upgrade sauce
```

Then, in each vault that should have the reader — **add the blueprint to its subscription** (`ranch/platform-subscription.json` `blueprints[]`):

```json
{ "name": "reader", "version": "<pin>" }
```

...and install with the vault as the current directory (`SAUCE_VAULT` is ignored — cwd-ancestor detection wins):

```bash
cd /abs/path/to/vault
sauce update --force
```

**What this adds:**

- **NEW `spice/reader/Reader.md`** (`type: reader-hub`) — the render-only queue hub. `applyReaderScaffoldHeal` creates it if absent (else idempotently heals its chrome, sentinel `class: "ReaderQueue"`, preserving any free-write below the `READER_CONTENT` marker; `.sauce-backup/reader/` snapshot before any write; never throws).
- **`reader-article` leaf notes** — flat in `spice/reader/`, never nested. The lifecycle `unread → reading → archived` is the frontmatter **`status`** field (a one-click toggle, never a folder move); the queue sorts by `captured_at`, not `mtime`.
- **Global "Reader" nav button** (icon `book-open`) on every note; `/reader` command + `new-reader-article` skill.
- **`spice/reader/reader-clip.json`** — a Web Clipper template artifact. **Import it once** into the browser's Obsidian Web Clipper (extension → templates → import); clips thereafter route straight to `spice/reader/` with the house frontmatter and (recommended, on a local Ollama) an Interpreter-generated **AI TL;DR** `summary`. The installer materializes the JSON into the vault but **cannot push it into the browser extension** — the one-time import is a manual step.

**Effect of running this upgrade:** `applyReaderScaffoldHeal` scaffolds/heals the hub (additive, backcompat — no new required fields on any existing note); **Cmd+R** to load the 3 new CustomJS classes (`ReaderQueue` / `ReaderArticleActions` / `ReaderArticleView`). The queue is empty until you import the clip template and clip a page (or use the hub's `＋ New article` button).

## Upgrading from v0.201.x — home fixes (Cmd+[ now opens Home)

No new subscriptions needed — this cycle only touches already-subscribed components (`home`, `daily`, `to-do`).

```bash
brew update && brew upgrade sauce
cd /abs/path/to/vault
sauce update --bump-pins
```

**What changes:**

- **`Cmd+[` now opens Home instead of the daily note.** An idempotent install heal moves the existing binding from `daily-notes` to the new `sauce-home:open` command; any OTHER binding you'd added to `daily-notes` is preserved untouched. The core `daily-notes` command is still reachable via the command palette (Cmd+P) — it just no longer has a hotkey by default.
- **Home gains a "‹ Yesterday" button** next to the date, opening the actual previous day's daily note (never creates one).
- A few quiet bug fixes: the daily to-do page's "New Task" button now correctly shows the created task in Today; Home's Enter-key quick-capture is hardened against a possible event-swallowing race; Home's first paint per app session now waits for Obsidian's workspace layout to settle (a best-effort mitigation for a reported load-time flash/widen — not a confirmed fix).

**User action required:** Cmd+R (or a full restart if that doesn't pick up the new `HomeCommandsInit` class) to load the updated classes and start using `Cmd+[` for Home.

## Upgrading from v0.211.x — journal multi-entry (only affects vaults subscribed to `journal`)

Only affects `ero-sauce` / `headspace-sauce`-style vaults subscribed to the `journal` blueprint — no action needed if you don't subscribe to it.

```bash
brew update && brew upgrade sauce
cd /abs/path/to/vault
sauce update --bump-pins
```

**What changes:**

- **Journal is now multi-entry.** The old single flat note per day (`Journal-YYYY-MM-DD.md`) is replaced by a global hub (`spice/journal/Journal.md`, Days | All + search), a per-day day-hub, and timestamped leaf entries — the same shape as `sticky-notes`.
- **Automatic migration.** An install-time step converts every existing flat `Journal-YYYY-MM-DD.md` note into the new day-folder shape (day-hub + a first leaf entry preserving the original body and `created_at`). Backed up to `.sauce-backup/journal-multi-entry/<timestamp>/` before any write; safe to run more than once.
- **The Journal nav-button now opens the day-hub**, not a single note directly. Use the day-hub's `+ New Journal Entry` button to capture additional entries for the same day.

**Effect of running this upgrade:** the migration runs once automatically; **Cmd+R** to load the new `JournalDayList` / `JournalHubCards` / rebuilt `JournalChromeBar` classes.
