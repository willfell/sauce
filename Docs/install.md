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
