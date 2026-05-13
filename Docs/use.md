# How to use the platform

This doc covers daily operations. For architectural background, see [how.md](how.md).

## Install (v0.36.0+)

Sauce distributes via a personal Homebrew tap. The pantry lives once under the brew prefix; vaults are pure consumer content with `ranch/` state only.

> [!success] First-time install on any Mac
> ```bash
> brew tap willfell/sauce
> brew install willfell/sauce/sauce
> sauce bootstrap --vault <path-to-your-vault>
> ```

After install, your machine has:

- `sauce` binary on PATH (`/opt/homebrew/bin/sauce`).
- Pantry under the brew prefix (`/opt/homebrew/opt/sauce/libexec` or equivalent on Intel Macs).
- `~/.sauce/vaults.json` — per-machine registry of installed vaults (every bootstrap appends an entry).
- (optional) `~/.sauce/active-pantry` symlink for dev mode (see "Dev mode" below).

> [!info] Prerequisites
> - **macOS with Homebrew** — `brew --version` should report 4.x+.
> - **Node.js 18+** — brought in as a brew dependency of the `sauce` formula; no separate install needed.

> [!tip] What `sauce bootstrap` does
> Reads / writes `<vault>/ranch/platform-{config,subscription,installed}.json`, scaffolds foundational plugin data files in `<vault>/.obsidian/` (additive merge per landmine #12), runs the first-run wizard for mechanism + blueprint selection, and records the vault in `~/.sauce/vaults.json`.

### Update flow

```bash
brew upgrade sauce       # refresh pantry under the brew prefix
sauce reinstall --all    # re-materialize every registered vault
```

`sauce reinstall --all` walks `~/.sauce/vaults.json` and re-runs the installer against each registered vault — your subscriptions stay pinned, but any post-bump materialization deltas (new mechanism files, new blueprint scaffolding, claude_surface[] re-render) land in one pass.

### Migrating from the pre-v0.36 `<vault>/pantry/` layout

Vaults bootstrapped before v0.36.0 carry an in-tree `<vault>/pantry/` clone. The migrator archives it and re-registers against the brew-installed pantry:

```bash
sauce migrate-layout --vault <path-to-legacy-vault>
```

Effects (in order):

1. Archives `<vault>/pantry/` → `<vault>/pantry.legacy.<timestamp>.bak/`.
2. Registers the vault in `~/.sauce/vaults.json` (if not already present).
3. Re-runs the installer against the brew-installed pantry.
4. Runs `sauce audit` to confirm the result is clean.

Useful flags:

- `--dry-run` — preview every write without touching disk.
- `--purge` — remove the `pantry.legacy.<ts>.bak/` archive after a clean audit.

> [!warning] Sanity check before `--purge`
> Run without `--purge` first. Confirm the vault opens in Obsidian and `sauce audit` is green. Then re-run with `--purge` (or just `rm -rf` the timestamped backup) once you're satisfied.

### Dev mode (working on the platform itself)

When you're iterating on the workshop code, you don't want every `sauce` invocation to hit the brew-installed pantry. Use `sauce link` to redirect dispatch through your checkout:

```bash
sauce link <path-to-your-sauce-checkout>   # symlinks ~/.sauce/active-pantry → checkout
sauce unlink                                # revert to brew-installed pantry
```

When `~/.sauce/active-pantry` exists, every `sauce` subcommand dispatches through your checkout — useful when iterating on workshop code without `brew upgrade`'ing on every change.

### Where vault state lives

```
<vault>/
├── ranch/                                Consumer-side state (no platform code)
│   ├── platform-config.json              Variables + workshop pointer
│   ├── platform-subscription.json        Pinned mechanism + blueprint versions
│   ├── platform-installed.json           Auto-managed install ledger (do NOT hand-edit)
│   ├── templates/                        Materialized Templater templates
│   ├── scripts/                          Materialized CustomJS classes
│   ├── views/                            Materialized Dataview views
│   ├── rules/                            Rule registry (_global.json + per-blueprint)
│   └── nav-buttons-registry.json         Renderer-resolved nav button registry
├── spice/<module>/                       Per-blueprint module directories (landmine #11)
├── .claude/
│   ├── commands/                         Slash commands (managed; landmine #22)
│   ├── commands.local/                   Consumer overrides (the override seam)
│   ├── skills/<bp>/                      Skill bodies (managed)
│   └── skills.local/<bp>/                Consumer overrides (the override seam)
└── CLAUDE.md                             Hand-authored prose + claude_surface[] marker regions
```

The pantry itself (platform source) does NOT live in the vault any more — it's under the brew prefix.

### Legacy install (pre-v0.36)

The `install.sh` curl|bash flow was the install entry point from v0.22.0 through v0.35.x. It is deprecated as of v0.36.0; running `bash install.sh` now exits 2 with a pointer at `brew install willfell/sauce/sauce`. The pre-v0.1.2 `tp.user.platformInstall(tp)` Templater flow is also retired — `git log -- install.sh Docs/use.md` recovers the historical walkthroughs if you need them.

---

## Slash Commander setup (per consumer vault)

> [!info] Why this exists
> The platform ships three runner templates (`Create New Project.md`, `Validate.md`, `Audit.md`) and surfaces them as slash commands (`/new-project`, `/validate`, `/audit`) via the Slash Commander community plugin. Three steps total per consumer vault — two installer-driven, one manual.

> [!todo] One-time setup steps
> 1. **Install Slash Commander.** Settings → Community plugins → Browse → search "Slash Commander" → Install → Enable. Irreducible (Obsidian's plugin install API is not exposed to scripts).
> 2. **Run the platform installer.** It writes Templater Template Hotkeys + Slash Commander bindings into the two plugin data.jsons (additive merge, backup on edit, idempotent on re-runs). See landmine #12 for the safety mechanics.
> 3. **Reload Obsidian** (Cmd+R / Ctrl+R or restart). Plugin caches re-read from disk; the three slash commands go live. Irreducible (Templater registers per-template commands at plugin boot, not on settings save).

> [!example] Verifying
> Open any note. Type `/validate` → fuzzy-matches the platform's binding → fires `Insert Validate` → Notice: `validate: clean` (or violation count). Type `/audit` → walker writes `Timestamps/Audits/<today>-audit.md`. Type `/new-project` → prompts for slug → new project note materializes.

> [!warning] Plugin id is `slash-commander`
> The Obsidian community-plugin slug is the un-prefixed form (NOT `obsidian-slash-commander`). The three manifests' `external_plugins[].id` declarations cite this exact string. Locked from disk in v0.1.x patch cycle (T2.1) by reading `.obsidian/community-plugins.json` after a real install.

---

## Updating an existing consumer

Consumer is at version A; workshop has version B (newer):

1. In workshop: bump versions in `platform/manifest.json` and the relevant `mechanisms/<name>/manifest.json`.
2. Obsidian Sync delivers the new workshop contents to every machine.
3. In the consumer: edit `ranch/platform-subscription.json` to pin the new versions.
4. Run `tp.user.platformInstall(tp)` in the consumer. It detects the version delta and re-installs.
5. `platform-installed.json` records the new version + a new history entry.

## Adding a new mechanism

1. In `workshop/platform/mechanisms/<new-name>/`:
   - Write the JS / CSS / config files.
   - Write `manifest.json` declaring `name`, `version`, `files`, `post_install`.
2. Update `workshop/platform/manifest.json`'s `mechanisms` array — add `{ name, version, path }`.
3. Test in workshop's self-install: bump workshop's `platform-subscription.json` to include the new mechanism, run `tp.user.platformInstall(tp)`, verify materialization.
4. When ready, update each consumer's subscription and run their installer.

## Adding a new blueprint

The first blueprint is the next major workstream. Sketch:

1. In `workshop/platform/blueprints/<name>/`:
   - `rule.json` — required tags, frontmatter, blocks, naming.
   - `templates/` — Templater templates.
   - `helpers/` — CustomJS classes.
   - `commands/` — slash commands.
   - `variants.json` — per-vault aliases.
   - `manifest.json`.
2. The installer needs blueprint-handling code. The current installer has the loop scaffolded but not implemented (see `// for (const sub of subscription.blueprints || [])` comment in `install.js`).

## Running the audit

Once `audit-walker.js` + `Audit.md` are materialized in a consumer (audit mechanism v0.1.0+) and Slash Commander is mapped:

1. Open any note in the consumer.
2. Type `/audit` (or run `Templater: Insert Audit` from the command palette).
3. Audit report writes to `Timestamps/Audits/YYYY-MM-DD-audit.md`.
4. Sections: platform drift, violations summary, violations by file.
5. Notice: `audit: complete — see Timestamps/Audits/`.

> [!info] Pre-Slash-Commander fallback
> If Slash Commander isn't installed, run the audit by replacing templates in the active file with `<%* await tp.user["audit-walker"](tp); %>`. The `Audit.md` runner template is the same content as a saved Templater command.

## Recovering from a broken install

If the installer aborts mid-flight:
- `platform-installed.json` only records mechanisms that succeeded entirely. Partial installs are not recorded.
- Files that DID land are still on disk. They're in canonical locations (no half-written files since `adapter.write` is atomic).
- Re-running `tp.user.platformInstall(tp)` is idempotent: already-installed mechanisms (matching version in `platform-installed.json`) are skipped.
- If an approval gate was declined, the file is skipped but the mechanism is otherwise installed. Re-run the installer to re-prompt.

If you need to fully reset a consumer's platform state:
1. Delete `ranch/platform-installed.json`.
2. Optionally delete `ranch/templater/{validate,hook-validate,audit-walker}.js`, `ranch/views/customjs-guard/view.js`, `.obsidian/snippets/customjs-loader.css`.
3. Re-run `tp.user.platformInstall(tp)`. Everything re-installs from scratch.

## Releasing a version

The release pipeline is gated. A tag push only ships a Formula bump if preflight is green.

### Gate sequence

1. **Bump versions in lockstep.**
   - `platform/manifest.json` `workshop_version` → new version
   - `package.json` `version` → same value
   - The `scripts/check-version-sync.js` gate (first step of `release:preflight`) fails the chain if these drift.

2. **Run preflight locally.**
   ```bash
   npm run release:preflight
   ```
   Must exit 0. Includes 14 harnesses + integration smoke (~30s end-to-end).

3. **Commit + push to `main`.** Wait for `ci` workflow green on both `macos-latest` and `ubuntu-latest`.

4. **Tag + push.**
   ```bash
   git tag -a v.X.Y.Z -m "v.X.Y.Z — <one-line summary>"
   git push origin v.X.Y.Z
   ```

5. **`release.yml` runs.** First job: `preflight` (full chain). If green: `bump-tap` opens a PR in `willfell/homebrew-sauce` with the new SHA + URL.

6. **Merge tap PR.** This is the publish step. After merge, `brew upgrade sauce` ships the new version to consumers.

7. **Verify locally.**
   ```bash
   brew upgrade sauce
   sauce help | head -2
   ```

### Recovery: tag pushed against red preflight

If a tag pushes and `release.yml`'s `preflight` job fails, no formula bump happens. Recover:

```bash
git tag -d v.X.Y.Z
git push --delete origin v.X.Y.Z
# fix the underlying issue
git tag -a v.X.Y.Z -m "..."
git push origin v.X.Y.Z
```

## Recommended GitHub branch protection (one-time UI setup)

These are flipped on manually in the GitHub UI under **Settings → Branches → Branch protection rules → Add rule** for `main`. They are not configured in-repo because branch protection is a per-repo GitHub setting, not a file.

- ☑ **Require a pull request before merging** (skip if single-developer; current workflow is direct push to main).
- ☑ **Require status checks to pass before merging:**
  - `preflight (macos-latest)`
  - `preflight (ubuntu-latest)`
  - Toggle "Require branches to be up to date before merging".
- ☑ **Require linear history** (matches the project's no-merge-commits convention).
- ☑ **Restrict who can push to matching branches** — limit to your account.
- (Optional) **Require signed commits** if you use a GPG/SSH signing key.
