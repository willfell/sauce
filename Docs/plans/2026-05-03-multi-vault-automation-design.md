---
date: 2026-05-03
refined: 2026-05-04
phase: design
status: approved (GitHub remote configured 2026-05-04 — v0.1.2 designs around real remote, not local-only)
target_cycle: v0.1.2
supersedes: none
related:
  - 2026-05-03-registry-driven-nav-buttons-design.md
  - 2026-05-03-boards-blueprint-design.md
  - 2026-05-02-vault-platform-design.md
  - landmines.md
  - execution-logs/2026-05-03-registry-driven-nav-buttons/T1.6-T1.7-headless-harness.md
---

# Design — multi-vault automation via git-based pull (v0.1.2)

> [!info] 2026-05-04 refinement — GitHub remote is configured
> When this design was written (2026-05-03), the assumption was workshop = local-only git repo, with remote/CI deferred to a Phase 4 follow-up. As of 2026-05-04, **the workshop is connected to a real GitHub remote**: `git@github-personal:willfell/beacon.git` (HTTPS: `https://github.com/willfell/beacon`), owned by personal account `willfellhoelter@gmail.com`. Project name: **Beacon**.
>
> **What this changes for v0.1.2:**
> - The thin stub bootstrap can now do `git pull --ff-only origin main` against a real network remote (was: only local checkout).
> - Cross-machine consumers become viable in v0.1.2 itself — no need to wait for "Phase 4."
> - Tag-based pinning (`pinned_to: "tag:v0.5.0"`) becomes a real cross-machine release mechanism.
> - "Phase 4 — push to remote + CI" is no longer deferred; v0.1.2's stage breakdown should incorporate at least the basic `git push` discipline (push tags after creating them; CI hooks remain optional follow-up).
> - Consumers (barebones first, accuris/headspace/ero eventually) can clone the workshop repo locally and the stub still does `git -C <workshopPath> pull` — same mechanism, now with network reach.
>
> **What this does NOT change:**
> - The thin stub's logic stays the same (parse pin → checkout/pull → require install.js).
> - The bootstrap-copy resync landmine still gets retired in S3.
> - The schema additions (`auto_pull`, `pinned_to`, `git_commit/tag/dirty` history fields) stay.
> - `pinned_to: "head"` still does `git pull --ff-only`; now it reaches the network.
>
> **What v0.1.2's plan should explicitly add:**
> - Push the initial commit + `v0.4.0` tag to `origin/main` in S1 (instead of stopping at local).
> - Document the SSH alias (`github-personal:willfell/beacon`) per machine setup.
> - Verify each `pinned_to` mode actually reaches the remote in S4.

> [!abstract] Goal
> Replace the current "workshop pushes by re-syncing bootstrap copies + manifest version field as global authority" model with a **pull-based, git-versioned distribution**. Workshop becomes a local git repo. Each consumer's Templater bootstrap shrinks to a ~10-line stub that loads the workshop's `install.js` directly at runtime, optionally pulling first. Tags are the authoritative version markers; consumer subscriptions can pin to `head`, `tag:<name>`, `commit:<sha>`, or `branch:<name>`. Phase 3 (drift detection) is sketched and partially built; Phase 4 (push to remote, CI) is fully deferred.

> [!info] Why this design exists
> Stage 4 of the v0.1.0 cycle and the v0.1.1 cycle both surfaced the same friction: the manual Templater-in-Obsidian dogfood loop is painful, and the bootstrap-copy resync discipline (3 byte-identical copies of `platformInstall.js` per `install.js` change) is a ticking landmine. The headless harness (delivered as a side-quest during v0.1.1's S1) eliminated the manual dogfood. This design extends that with a git-based distribution model that also kills the bootstrap-copy landmine.

---

## Decisions locked during brainstorming

> [!success] Approved choices
> - **Distribution model:** pull-based. Each consumer is autonomous; workshop never tracks who its subscribers are. No workshop-side `vaults.json` registry. Multi-consumer ad-hoc operations take vault paths as CLI args.
> - **Versioning substrate:** git. Workshop becomes a local git repo. Tags are the authoritative release markers. The legacy `platform/manifest.json:workshop_version` field stays as a human-readable mirror; tags win on conflict.
> - **Bootstrap model:** thin stub. Each consumer's `Docs/Meta/Templater/platformInstall.js` becomes a ~10-line stub that `require()`s the workshop's `install.js` at runtime (after optional `git pull` and pin-resolution). The stub is set once per consumer and never re-edited. Bootstrap-copy resync landmine retired.
> - **Git target:** local-only initially. Workshop is a local git repo on the dev machine. Tags + commits + history work; no remote configured. Phase 4 (push to GitHub or other remote) is deferred until cross-machine or CI-on-remote becomes painful.
> - **Tag naming:** `v0.4.0` style (with `v` prefix, semver-compatible).
> - **Branch model:** main-only for now. All cycle work commits to main. Feature branches deferred until remote + PR review exist.
> - **Dirty-install behavior:** warn + proceed; record `git_dirty: true` in installed.json history. Drift reports surface dirty state. Allows dev-loop iteration on `install.js` itself.
> - **`.gitignore`:** workshop scratch files (`tmp.md`), Obsidian per-machine state (`.obsidian/workspace*`, `.obsidian/cache`), workshop's own auto-managed state (`Docs/Meta/platform-installed.json`), and any dogfood artifacts (`boards/`).
> - **Backup discipline:** pre-S0 task creates a filesystem snapshot of all 3 vaults' `Docs/Meta/` to a sandbox dir before any git operation touches anything. Disaster-recovery friendly.
> - **First commit message:** `chore: bootstrap workshop git history at v0.4.0`. Subsequent commits follow conventional-commits style.
> - **Workshop's project subscription:** stays dropped through v0.1.2. Workshop is the migration target itself; project-blueprint regression dogfood happens in barebones.

> [!info] Inherited from v0.1.1
> - JSON-everywhere (landmine #6 — `parseYaml` unreachable in Templater scripts).
> - Desktop-only constraint (landmine #8 — `require("fs")` and `require("child_process").execSync` are desktop-only).
> - Failure-loud posture (every error path Notice + history entry).

---

## Architecture overview

> [!example]- File-level diff (workshop + consumers)
> ```
> WORKSHOP                                CONSUMERS (workshop, tmp-acc-vault, barebones,
> (local git repo)                         eventually accuris/headspace/ero)
> ─────────────                           ─────────────────────────────────────────────
> .git/                  ← versioning     Docs/Meta/
> .gitignore             NEW              ├── platform-config.json
> platform/                                │     workshop_relative_path: "../workshop/poc-vault"
> ├── install.js         ← single SoT      │     auto_pull: true            ← NEW
> ├── manifest.json                        │     variables: { ... }
> ├── mechanisms/                          ├── platform-subscription.json
> ├── blueprints/                          │     pinned_to: "head"          ← NEW
> └── test/                                │     mechanisms: [...]
>     └── run-install.js  ← + git-aware    │     blueprints: [...]
>                                          ├── platform-installed.json
> Tags = releases:                          │     each history entry has git_commit + git_tag + git_dirty   ← NEW
>   v0.3.0 (legacy mirror, pre-init)         │
>   v0.4.0 (initial git tag)                 └── Templater/
>   v0.4.x... (future cycles)                    └── platformInstall.js  ← THIN STUB, never re-synced
> ```

### The flow

1. **Consumer triggers install** via Templater's `_install-platform` template (or via the headless harness's stub-aware mode).
2. **Stub loads consumer config** (`platform-config.json`) and subscription (`platform-subscription.json`).
3. **Stub resolves the workshop path** from `workshop_relative_path`.
4. **Stub honors pinning**:
   - `pinned_to: "head"` + `auto_pull: true` → `git pull --ff-only` in workshop, install from HEAD.
   - `pinned_to: "tag:0.4.0"` → `git checkout tags/v0.4.0` in workshop, install (no pull — would move HEAD off tag).
   - `pinned_to: "commit:<sha>"` → checkout that commit, install.
   - `pinned_to: "branch:<name>"` → checkout branch + pull (if `auto_pull`).
5. **Stub clears Node require cache** for `platform/install.js` (otherwise stale module persists across runs).
6. **Stub `require()`s workshop's install.js** and invokes it with `tp`.
7. **Installer runs** (existing logic, unchanged in spirit), but extended to capture `git_commit`, `git_tag`, `git_dirty` via `execSync` and record them in `platform-installed.json` history entries.

### What this kills (delta vs current model)

- **Bootstrap-copy resync landmine** ✅ retired. Stub is set once per consumer; workshop's `install.js` is the single source of truth at runtime.
- **`vaults.json` registry concept** ✅ never lands. Workshop doesn't know who its subscribers are.
- **Workshop-as-subscriber-tracker** ✅ rejected. Each consumer is autonomous.
- **Manifest's `workshop_version` as authority** ✅ demoted to legacy mirror. Git tags are authoritative.

### What this preserves

- All current install behavior (mechanism + blueprint loops, rule-fragment merge, nav-buttons registry, subscription-aware pruning, strict-paths/lenient-bodies substitution, six failure-mode hardenings).
- All current consumer-side state files (`platform-config.json`, `platform-subscription.json`, `platform-installed.json`) — schema EXTENDED, not replaced.
- The harness (`platform/test/run-install.js`) as the testing surface — extended to be git-aware.
- Subscription-pinned versioning per mechanism/blueprint (you still control what each consumer adopts; the new `pinned_to` adds a second pinning axis at the workshop-revision level).

---

## Schemas

### `platform-config.json` (consumer side) — added field

```json
{
  "workshop_relative_path": "../workshop/poc-vault",
  "auto_pull": true,
  "variables": { ... }
}
```

`auto_pull` defaults to `true`. Set to `false` to suppress `git pull` even when `pinned_to: "head"`.

### `platform-subscription.json` (consumer side) — added field

```json
{
  "workshop_version": "0.4.0",
  "pinned_to": "head",
  "mechanisms": [...],
  "blueprints": [...]
}
```

`pinned_to` accepts: `"head"` (default), `"tag:<name>"`, `"commit:<sha>"`, `"branch:<name>"`. The legacy `workshop_version` field stays as a human-readable mirror; git tags win on conflict.

### `platform-installed.json` (consumer side) — extended history entry

```json
{
  "history": [
    {
      "event": "install",
      "kind": "mechanism",
      "name": "nav-buttons",
      "version": "2.0.0",
      "git_commit": "abc123def...",
      "git_tag": "v0.4.0",
      "git_dirty": false,
      "installed_at": "2026-05-03T..."
    }
  ]
}
```

`git_tag` is the closest annotated tag (or `null` if none). `git_dirty` reflects whether the workshop checkout had uncommitted changes at install time.

### Pinning resolution (the stub's pre-install dance)

| `pinned_to` | Stub behavior |
|---|---|
| `head` | `git pull --ff-only` (if `auto_pull`); install from HEAD |
| `tag:0.4.0` | `git checkout tags/v0.4.0`; do NOT pull; install |
| `commit:abc123` | `git checkout abc123`; do NOT pull; install |
| `branch:main` | `git checkout main && git pull --ff-only` (if `auto_pull`); install |

`auto_pull` is a no-op for tag/commit pins — you can't pull *toward* a frozen ref.

---

## The bootstrap stub (set once per consumer)

> [!example]- Docs/Meta/Templater/platformInstall.js
> ```javascript
> module.exports = async (tp) => {
>   const path = require('path');
>   const { execSync } = require('child_process');
>
>   const config = JSON.parse(await tp.app.vault.adapter.read('Docs/Meta/platform-config.json'));
>   const sub    = JSON.parse(await tp.app.vault.adapter.read('Docs/Meta/platform-subscription.json'));
>
>   const workshopPath = path.resolve(tp.app.vault.adapter.basePath, config.workshop_relative_path);
>
>   // Verify workshop is a git repo
>   try {
>     execSync(`git -C "${workshopPath}" rev-parse --is-inside-work-tree`, { stdio: 'ignore' });
>   } catch {
>     new Notice(`platformInstall: workshop at ${workshopPath} is not a git repo. Phase 2 requires git; run \`git init\` and tag a release.`, 10000);
>     return;
>   }
>
>   const pin = sub.pinned_to || 'head';
>
>   if (pin === 'head') {
>     if (config.auto_pull) {
>       try {
>         execSync(`git -C "${workshopPath}" pull --ff-only`, { stdio: 'inherit' });
>       } catch (e) {
>         new Notice(`platformInstall: git pull failed (${e.message}); continuing with current HEAD.`, 6000);
>       }
>     }
>   } else if (pin.startsWith('tag:')) {
>     execSync(`git -C "${workshopPath}" checkout tags/${pin.slice(4)}`, { stdio: 'inherit' });
>   } else if (pin.startsWith('commit:')) {
>     execSync(`git -C "${workshopPath}" checkout ${pin.slice(7)}`, { stdio: 'inherit' });
>   } else if (pin.startsWith('branch:')) {
>     execSync(`git -C "${workshopPath}" checkout ${pin.slice(7)}`, { stdio: 'inherit' });
>     if (config.auto_pull) {
>       try { execSync(`git -C "${workshopPath}" pull --ff-only`, { stdio: 'inherit' }); }
>       catch (e) { new Notice(`platformInstall: pull on branch failed (${e.message}); continuing.`, 6000); }
>     }
>   }
>
>   const installerPath = path.join(workshopPath, 'platform', 'install.js');
>
>   // Critical: clear require cache so we get the freshest install.js after a checkout/pull
>   try { delete require.cache[require.resolve(installerPath)]; } catch {}
>
>   const installer = require(installerPath);
>   return installer(tp);
> };
> ```

The stub never edits its own contents; iterating on `install.js` doesn't require any consumer-side change.

---

## Failure-loud posture (carrying forward six v0.1.0 hardenings + new ones)

| Failure | Stub / installer behavior | Recorded in |
|---|---|---|
| Workshop path doesn't exist | Notice "workshop not found"; abort | (no installed.json write — too early) |
| Workshop not a git repo | Notice "Phase 2 requires git; run `git init`"; abort | (no installed.json write) |
| `git pull` fails (no remote / non-ff) | Notice + continue with current HEAD if `pinned_to: head`; otherwise abort | history `event: warning, step: pull` |
| `git checkout <ref>` fails (uncommitted, ambiguous ref) | Notice "workshop has uncommitted changes" or "ambiguous ref"; abort | history `event: error, step: checkout` |
| `git_dirty: true` at install time | Notice warning + proceed; record `git_dirty: true` | history (every entry from this run carries dirty flag) |
| Resolved ref has no `platform/install.js` | `require()` throws; stub catches; Notice "install.js missing at \<ref\>"; abort | history `event: error, step: load_installer` |
| Stale require cache (delete fails) | Wrap in try; Notice "stale require cache may apply — restart Templater"; continue | (logged only) |
| All existing v0.1.0/v0.1.1 hardenings (C2/C4/E1/E3/L2 + strict/lenient) | Carried forward unchanged | as before |

---

## Stage breakdown

### Stage 0 — pre-migration backup

> [!abstract] S0 deliverable
> Filesystem snapshot of all 3 vaults' `Docs/Meta/` directories to a sandbox dir. Disaster recovery before any git operation touches anything.

> [!todo] S0 acceptance
> - [ ] Create `<workshop>/_backups/2026-05-03-pre-v0.1.2-migration/`.
> - [ ] Copy `Docs/Meta/` from poc-vault, tmp-acc-vault, tmp-test-barebones-vault under it.
> - [ ] Verify each backup has `platform-config.json`, `platform-subscription.json`, `platform-installed.json`, `Templater/`, etc.
> - [ ] Log `T0.1-pre-migration-backup.md` with the backup paths.

---

### Stage 1 — git-ify workshop

> [!abstract] S1 deliverable
> Workshop becomes a local git repo. `git init`, write `.gitignore`, commit current state, tag `v0.4.0`. No code changes.

> [!todo] S1 acceptance
> - [ ] `git init` in workshop root.
> - [ ] Write `.gitignore` covering: `tmp.md`, `_backups/`, `.obsidian/workspace*`, `.obsidian/cache`, `Docs/Meta/platform-installed.json`, `boards/`.
> - [ ] Initial commit: `chore: bootstrap workshop git history at v0.4.0`.
> - [ ] Tag `v0.4.0` (annotated): `git tag -a v0.4.0 -m "Initial git-versioned workshop release"`.
> - [ ] Verify `git log --oneline` shows the initial commit; `git tag -l` shows `v0.4.0`.
> - [ ] Workshop continues to function (open in Obsidian, run a no-op self-install via the harness — should pass).
> - [ ] Log `T1.1-git-init.md`.

---

### Stage 2 — schema updates + git-state recording

> [!abstract] S2 deliverable
> `install.js` extended to record `git_commit`, `git_tag`, `git_dirty` in installed.json history entries via `execSync`. `auto_pull` schema added to `platform-config.json`. `pinned_to` schema added to `platform-subscription.json`.

> [!todo] S2 acceptance
> - [ ] Add `gitState(workshopPath)` helper to `install.js` returning `{ commit, tag, dirty }` via `execSync git rev-parse HEAD`, `git describe --tags --exact-match`, `git status --porcelain`.
> - [ ] Wire git state into every `installed.history.push(...)` site in `install.js`.
> - [ ] Update workshop's `platform-config.json`: add `auto_pull: true`.
> - [ ] Update workshop's `platform-subscription.json`: add `pinned_to: "head"`.
> - [ ] Run harness: `node platform/test/run-install.js .`. Expected: history entries (if any new ones land on this run) record git state.
> - [ ] Negative test: hand-write malformed `git rev-parse` exit (e.g., point workshopPath to a non-git dir via temp config); verify failure-loud Notice and abort.
> - [ ] Log `T2.1-git-state-recording.md`.
> - [ ] Bump `workshop_version` 0.4.0 → 0.4.1 in `platform/manifest.json` (interim; the next tag becomes `v0.4.1`); commit + tag.

---

### Stage 3 — stub deployment

> [!abstract] S3 deliverable
> Replace the 3 existing bootstrap copies with the thin stub. Run install via stub in each consumer; verify behavior matches direct-harness install. Bootstrap-copy resync landmine retired.

> [!todo] S3 acceptance
> - [ ] Write the stub body (see "The bootstrap stub" section above).
> - [ ] Replace `Docs/Meta/Templater/platformInstall.js` in:
>   - poc-vault (workshop)
>   - tmp-acc-vault
>   - tmp-test-barebones-vault
> - [ ] Verify each consumer's stub is identical (`diff` between consumers should be empty for the stub itself, since it's content-static).
> - [ ] Run harness in each consumer: `node platform/test/run-install.js <vault-path>`. Expected: install runs through stub, git state captured, no errors.
> - [ ] **Critical idempotency check**: re-run install. Expected: zero new file writes, zero new history entries (except possibly an updated installed_at on registry-touched files).
> - [ ] **Pin test**: set `pinned_to: "tag:v0.4.0"` in barebones subscription, re-install. Expected: stub checks out v0.4.0 in workshop, install runs against tagged code.
> - [ ] **Restore**: set `pinned_to: "head"` in barebones subscription. Re-install. Expected: clean.
> - [ ] Log `T3.1-stub-deployment.md` per consumer.

---

### Stage 4 — harness git-awareness + drift sketch

> [!abstract] S4 deliverable
> Extend `run-install.js` to (a) honor `pinned_to` itself when invoked directly (parity with the stub flow) and (b) add a `--drift <vault-paths...>` mode (Phase 3 sketch — read-only audit comparing each consumer's installed git_commit vs workshop's HEAD/pinned ref).

> [!todo] S4 acceptance
> - [ ] Harness reads consumer's `platform-config.json` + `platform-subscription.json` and replicates the stub's pin-resolution logic.
> - [ ] `--drift` mode: takes 0+ vault paths as args; for each, reads `installed.json:history[-1].git_commit`, compares to workshop HEAD, prints a per-vault summary table.
> - [ ] **Drift smoke**: leave barebones at the v0.4.0 tag's commit, advance workshop to a later commit, run `--drift ../tmp-test-barebones-vault`. Expected: report shows N commits behind.
> - [ ] **Drift on unpinned**: barebones at `head`, fully synced. Expected: "in sync" report.
> - [ ] **Drift on dirty workshop**: hand-edit a workshop file (no commit). Run drift. Expected: report flags `workshop dirty: yes`.
> - [ ] Log `T4.1-harness-pin-aware.md` and `T4.2-drift-sketch.md`.
> - [ ] Final commit + tag `v0.4.2` (or `v0.5.0` if the cycle warrants a minor bump — decide at S4 close).

---

## Phase 3 + 4 — sketched, not built

### Phase 3 — drift detection (partially landed in S4)

`--drift <vault-paths...>` covers the core read-only audit. Future extensions (deferred):
- Drift via remote without local checkout (requires Phase 4 remote).
- Per-mechanism drift (which mechanism's version is behind, not just workshop-revision).
- HTML / JSON output for tooling integration.

### Phase 4 — push to remote + CI

When cross-machine or scheduled-audit becomes painful:
- Push workshop to a GitHub remote (private or public).
- Each consumer's `auto_pull` reaches network.
- GitHub Actions on workshop repo: scheduled drift detection, lint of mechanism manifests, automated tagging on merge to main.
- Possibly a "release notes" mechanism: each tag's annotation describes the changes since the prior tag.

Local-only continues to work indefinitely. Remote is purely additive.

---

## Versioning summary (post-S4)

| Stage | Workshop tag | manifest.json:workshop_version | Authority |
|:---:|:---:|:---:|---|
| Pre-S0 | (no git) | 0.4.0 | manifest field (legacy) |
| Post-S1 | v0.4.0 | 0.4.0 | git tag |
| Post-S2 | v0.4.1 | 0.4.1 | git tag |
| Post-S4 | v0.4.2 (or v0.5.0) | matching | git tag |

After v0.1.2 close, the manifest field is purely a human-readable mirror. Tag is authority.

---

## Subscription state per consumer after v0.1.2

| Consumer | Stub installed | `pinned_to` | `auto_pull` | Notes |
|---|:---:|:---:|:---:|---|
| `poc-vault` (workshop) | yes | `head` | true | Self-install for dogfood; workshop also IS the workshop, slightly meta |
| `tmp-acc-vault` | yes | `head` | true | First external consumer; tracks workshop tip during dev |
| `tmp-test-barebones-vault` | yes | `head` | true | Regression target; tracks workshop tip |
| `accuris` (future) | tbd | likely `tag:vX.Y.Z` | tbd | Real consumer; will pin to releases |
| `headspace` (future) | tbd | likely `tag:vX.Y.Z` | tbd | Same |
| `ero` (future) | tbd | likely `tag:vX.Y.Z` | tbd | Same |

---

## Cross-cutting risks & landmines (additions to `Docs/landmines.md`)

> [!warning] New landmines surfaced by this design
> 1. **Stale require cache.** Node caches modules across `require()` calls. Without the explicit `delete require.cache[require.resolve(installerPath)]` in the stub, after a `git pull` or `git checkout` the same Node process would still see the old `install.js`. This is the ONE line in the stub that's most easily missed and most catastrophic if forgotten.
> 2. **`git checkout` in dirty workshop fails noisily but recoverably.** When `pinned_to: tag:...` and workshop has uncommitted changes, checkout aborts. Stub surfaces the Notice; user must commit / stash. Don't `--force-checkout` — that destroys uncommitted work.
> 3. **`execSync` is desktop-only.** Same constraint as `require("fs")`. iOS / mobile installs remain unsupported. Documented landmine #8 still applies.
> 4. **Tag/commit pins freeze workshop's working tree across all consumers on the same machine.** If you have two consumers on one machine pinned to different tags, the second install's checkout overrides the first. Mitigation: pin consumers to the same ref OR run installs serially in a known order. For Phase 4 (cross-machine), this becomes a non-issue.
> 5. **Workshop's `Docs/Meta/platform-installed.json` is gitignored.** Workshop's self-install state stays per-machine. If you ever want to commit workshop's install state for audit, edit `.gitignore` to remove the entry; just be aware that re-running self-installs will keep generating diffs.

---

## Out of scope for this design

- **Push workshop to a remote (GitHub or other).** Phase 4. Local-only is the v0.1.2 endpoint.
- **CI hooks / scheduled drift detection.** Phase 4. Requires remote.
- **Per-mechanism drift detection.** Phase 3 extension. v0.1.2 only does workshop-revision drift.
- **Uninstall command.** Existing self-cleaning registry pruning gets us most of the way; explicit uninstall is a separate v0.2.x design.
- **Headspace / ero / accuris real onboarding.** Gated on barebones success across two cycles minimum (v0.1.1 + v0.1.2).
- **Mobile install support.** Still desktop-only.
- **Branching workflow / PRs / code review on workshop.** Deferred until remote exists.
- **Backwards-compat shims for old bootstrap copies.** v0.1.2 mandates the stub; no fallback path.

---

## Future-plans appendix — Phase 4 sketch

When the workshop pushes to a remote (most likely GitHub private), additions become:

1. **Remote-aware `auto_pull`.** Stub's `git pull --ff-only` reaches network. No code change to stub; just configure remote.
2. **Multi-machine consumers.** A consumer on machine B can clone workshop locally and reach it via filesystem; install behavior identical.
3. **GitHub Actions on workshop repo.**
   - Scheduled drift report against a list of "known consumer paths" (per-machine config, NOT a workshop-side registry).
   - Lint of every mechanism / blueprint manifest on push (catches malformed manifests before they reach a consumer).
   - Auto-tag on conventional-commit merges (e.g., `feat:` → minor bump, `fix:` → patch, `feat!:` → major).
4. **Release notes via tag annotations.** Each `git tag -a v0.5.0 -m "..."` carries human-readable release notes; surfaced by the harness's drift report.
5. **Browser-accessible mirror.** `tag.workshopvault.dev` (or similar) renders the manifest + each mechanism's README — a human-friendly catalog of what's available.

The remote is purely additive. Local-only continues to work after Phase 4 ships.

---

## Migration sequence (v0.1.2 actual execution path)

1. Close v0.1.1 first (S2 → S3 → S4 of the registry-driven nav-buttons cycle). Workshop remains at version 0.4.0 in the manifest field.
2. Open v0.1.2: read this design + the implementation plan (next).
3. Execute S0 (backup) → S1 (git init + tag v0.4.0) → S2 (schema + git state) → S3 (stub deployment) → S4 (harness + drift sketch).
4. Close v0.1.2. Tag `v0.4.2` or `v0.5.0`.
5. Workshop is now ready for accuris/headspace/ero migration plans (separate cycles).

---

## Next step

Hand off to **de:writing-plans** to produce the task-by-task implementation plan covering S0–S4. Plan filed alongside this design before any code/git changes touch the workshop.
