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

> **Note (release process):** the workshop→brew **release** is fully automated (compute-release → auto-merged release PR → tag-and-ship → brew). Do NOT bump versions or tag by hand. The canonical, current description is `Docs/agent-guides/build-test-verify.md` § Release workflow. The legacy `tp.user.platformInstall` / Obsidian-Sync steps below predate the brew + CLI distribution model and are kept only as historical context.

## Updating an existing consumer

Consumer is at version A; workshop has version B (newer):

1. In workshop: bump versions in `platform/manifest.json` and the relevant `mechanisms/<name>/manifest.json`.
2. Obsidian Sync delivers the new workshop contents to every machine.
3. In the consumer: edit `ranch/platform-subscription.json` to pin the new versions.
4. Run `tp.user.platformInstall(tp)` in the consumer. It detects the version delta and re-installs.
5. `platform-installed.json` records the new version + a new history entry.

## Known flow changes (v0.46.0+)

### Entity creation moved to declarative AccentButtons (meetings · people · project · scratch · finance)

v0.46.0 extracted the "create a new entity" pattern into the `entity-create` mechanism. Each affected blueprint now declares a `new_entity_buttons[]` entry in its manifest; the installer injects an AccentButton fence into the entry's hub note, and the `EntityCreate` CustomJS class drives prompts → frontmatter → file create → open at click time.

The retired per-blueprint `New<X>Button` helpers (NewMeetingButton, NewPersonButton, ProjectNavButtons' `_createProject`, ScratchNewButton, NewBudget/Paycheck/InvoiceButton) are gone; the registry-driven flow replaces them.

**Templater `<%* %>` regression for meetings / people / scratch (Path C posture — by design):**

Templates in these three blueprints used Templater's `<%* %>` syntax (attendees prompt for meetings, `tp.file.move` auto-promote for scratch). Templater code is incompatible with the entity-create substitution catalogue, so the v0.46.0 manifests dropped `body_template` for these three blueprints in favour of `frontmatter_template` + `inline_body` (covers ~95% of the original behaviour).

The Templater templates (`ranch/templates/Meeting.md`, `ranch/templates/People.md`, `ranch/templates/Scratch.md`) remain in each blueprint's `files[]` for **manual invocation only** — open the empty note created by the AccentButton, then run Obsidian's "Templates: Insert template" command and select the relevant template. The `<%* %>` block fires at that point.

This is documented posture, not a bug. Project's templates were token-translated (Path A) and have no regression. Auto-template-on-creation is a candidate for a future v0.47.x cycle (would require adding Templater-flow support to the entity-create runtime).

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

3. **Commit + push to `main`.** Wait for `ci` workflow green on both `preflight (linux)` and `preflight (macos)`.

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
  - `preflight (linux)`
  - `preflight (macos)`
  - Toggle "Require branches to be up to date before merging".
- ☑ **Require linear history** (matches the project's no-merge-commits convention).
- ☑ **Restrict who can push to matching branches** — limit to your account.
- (Optional) **Require signed commits** if you use a GPG/SSH signing key.

## Running work through the engine

The Sauce engine runs a **graph note** — an ordinary vault note whose frontmatter carries `type: sauce-graph` (plus `repo:` for the git checkout agent nodes work in, and `status:`) and whose body holds one `sauce` code block of `nodes:` and `edges:`. Nodes are `agent` (claude-code or codex, usually in its own git worktree), `judge` (a command whose exit code decides pass/fail), `shell`, `human` (parks the run until you tick a checkbox), or `end`; edges are named (`on: pass` / `on: fail`) and any cycle must carry `max: N`. Start from the `Sauce Graph` template (materialized by the always-on `engine` mechanism) or `/sauce` in the vault. Standalone reference: `Docs/engine.md`.

### `sauce run`

```
sauce run <note>                       one tick, then exit
sauce run <note> --follow              keep ticking until a terminal node (stops at a human node unless --wait-human)
sauce run <note> --dry-run             validate + print the plan; writes nothing
sauce run <note> --status              latest run's projection, read-only
sauce run --list                       every run in the vault, newest first
sauce run <note> --sweep               remove finished, clean worktrees of this note's runs
sauce run <note> --install-launchd [--interval <s>]   unattended cadence; --uninstall-launchd removes it
flags: --worker <fake|claude-code|codex>  --repo <path>  --var k=v  --interval <s>  --json
```

`sauce run` is context-free: the vault is resolved from the note's own ancestors first, so an absolute note path works from anywhere. Exit 0 = done/parked/listed, 1 = the run failed, 2 = usage or refusal (unknown node type, dangling edge, unbounded cycle).

### Where state lives

- **Ledger:** `<vault>/ranch/engine/runs/<run-id>.jsonl` — one append-only JSONL file per run, never rewritten, no index file (`--list` replays them). Per-node artifacts (`prompt.md`, `result.json`, `stdout.log`) sit under `runs/<run-id>/<node-id>/`.
- **Projection:** the engine writes a `## Runs` section into the graph note between `<!-- @sauce:runs BEGIN -->` / `<!-- @sauce:runs END -->` markers. A parked human node appears there as `- [ ] run:<id> node:<n> — <ask>`; tick the box and the next tick resumes.
- **Worktrees:** agent nodes run in `<repo>/.worktrees/sauce/<run>-<node>`; `--sweep` removes finished ones but keeps any tree that is dirty or ahead of its base.

### Halting

Set `status: halted` in the graph note's frontmatter. The next tick records the halt and exits; do not delete or edit a ledger.

### Unattended cadence (launchd)

`sauce run <note> --install-launchd --interval 300` writes a per-note launchd job from `platform/engine/sauce-engine.plist.sample` that ticks the graph on that interval; `--uninstall-launchd` removes it. This replaces the retired `/sauce-autoloop` cron loop and `sauce-autoloop.plist.sample`.

### Auditing

`sauce audit --engine` is a read-only walk: `engine_dir_missing` / `engine_surface_missing` (HIGH), `engine_surface_stale` / `engine_version_drift` / `engine_ledger_unparsable` (MEDIUM), `engine_worktree_orphan` (LOW). It never modifies a ledger or a worktree.

The engine never writes boards or cards. Delivery work still goes through the coordinator — `/mayo:run` can opt into the shipped `platform/engine/graphs/delivery-slice.md` graph, where every coordinator call is a `shell` node.

## Connecting Claude Cowork (scheduled jobs)

See `Docs/cowork-onboarding.md` for the 5-step checklist that connects a sauce-installed vault to Claude Cowork (or any scheduler). See `Docs/cowork-consumer-extensions.md` for the worked sprint-sync example showing how to add custom scheduled jobs on top of the sauce-shipped orchestrators.
