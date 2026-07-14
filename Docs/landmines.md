# Landmines — traps we already hit

Read this before any new platform work. Every entry is a real failure we
recovered from. Reintroducing one of these costs hours. Each entry is
statement → trigger → rule → one-line rationale. Extended narrative
(version-history call-outs, postmortem detail, full original prose) is
archived verbatim in [`Docs/cycle-history.md`](cycle-history.md) § "Landmines
— full pre-GA-D4 archive" — load it on demand, not by default.

## CustomJS / Dataview integration (5 landmines)

### 1. Bare `customJS.X.Y(dv)` throws ReferenceError on cold load
Trigger: calling a CustomJS class method directly from a dataviewjs block.
Rule: always go through `dv.view("ranch/views/customjs-guard", {...})` so the
guard view waits for `customJS` to exist before dispatching.
Why: CustomJS loads asynchronously; a cold-load race leaves `customJS`
undefined when the dataviewjs block first executes.

### 2. `typeof customJS === 'undefined'` doesn't guard the TDZ
Trigger: writing a "defensive" undefined-check before calling into CustomJS.
Rule: use `window.customJS?.X` (optional chaining off `window`), not a bare
`typeof` check.
Why: `typeof` on a not-yet-hoisted `let`/`const` still throws in the
temporal dead zone; only property access on `window` is safe.

### 3. Helper view files must NOT live in the CustomJS scan folder
Trigger: adding a new `dv.view()`-invoked helper file under the CustomJS
`jsFolder`.
Rule: all view files live under `ranch/views/`, never inside the CustomJS
scan folder.
Why: CustomJS eagerly `require()`s everything in its scan folder; view files
aren't CustomJS classes and will break the scan.

### 4. Dataview view files are NOT CommonJS modules
Trigger: writing a `ranch/views/*/view.js` file.
Rule: never wrap the body in `module.exports = ...`.
Why: Dataview's `dv.view()` evals the file directly in its own sandboxed
scope; a CommonJS wrapper breaks that contract.

### 5. `dv.view` resolves a folder, not a file
Trigger: adding a new dataview view.
Rule: every view ships as a folder containing `view.js` (e.g.
`ranch/views/my-view/view.js`), referenced as `dv.view("ranch/views/my-view", {...})`.
Why: Dataview's view API is folder-addressed; a bare `.js` file path won't resolve.

## Platform installer (landmines #6–#30)

### 6. Templater scripts can't reach Obsidian's YAML helpers
Trigger: needing to parse/stringify frontmatter from a Templater script.
Rule: all platform metadata (subscription, config, manifests) is JSON, never
YAML-via-Templater.
Why: `parseYaml`/`stringifyYaml` aren't exposed to Templater's script sandbox.

### 7. Templater needs a manual reload after new user scripts are copied
Trigger: install materializes new `ranch/` script files.
Rule: install ends with a Notice telling the user to reload Templater;
codified as `post_install: {type: notice}` in the manifest.
Why: Templater caches its script list at plugin load; new files aren't
picked up until a reload.

### 8. Cross-vault fs reads are desktop-only
Trigger: writing code that touches another vault's filesystem.
Rule: `install.js` is filesystem-only (desktop); `bootstrap.js` (v0.21.0+) is
the sole network gateway — see landmine #17 for its posture.
Why: `require("fs")` cross-vault access isn't available on mobile; network
fetch is the only cross-vault channel that works everywhere.

### 9. Installer substitution variables come from exactly one place
Trigger: adding a new `{{...}}` substitution token to a template.
Rule: values resolve ONLY from `platform-config.json:variables` — never from
`variants.json` or `vault_identity`.
Why: those are consumer-authored config files with a different lifecycle;
mixing sources causes silent unresolved tokens.

### 11. Module-directory invariant (out of order — appears before #10)
Trigger: adding a new blueprint.
Rule: every blueprint owns exactly one directory at `spice/<module>/`;
mechanisms are exempt (they land under `ranch/`).
Why: historical violations (the old `beacon/` namespace) were resolved by the
v0.25.0 Tree 2 rename; one-dir-per-blueprint keeps subscription/dependency
bookkeeping tractable.

### 10. Forcing the installer to re-process a manifest needs a triple version bump
Trigger: wanting the installer to re-materialize files for an item whose
content changed but doesn't need a real semver bump.
Rule: bump all three in lockstep — the item's own `manifest.json` version,
its entry in `platform/manifest.json`, and its pin in
`ranch/platform-subscription.json`.
Why: `install.js` short-circuits when the subscription pin already matches
the workshop catalogue version (see landmine #16); a `--force-reinstall`
convenience flag is a deferred fix, not yet implemented.

### 12. `.obsidian/` is banned EXCEPT an explicit allowlist
Trigger: writing installer code that touches anything under `.obsidian/`.
Rule: only ~17 allowlisted paths (plugin configs healed via named
`applyX` helpers) plus CLAUDE.md marker regions, `.claude/skills/`,
`.claude/commands/`, `.claude/{commands,skills}.local/`, and
`ranch/claude-surface-registry.json` may be written — protected by additive
merge, backup-on-edit, malformed-JSON guards, and failure-loud history
logging. Anything outside the allowlist is off-limits.
Why: `.obsidian/` is Obsidian's own settings store; writing outside the
allowlist risks clobbering user-owned plugin state with no recovery path.
Full version-by-version growth history of the allowlist (v0.1.3–v0.106.0.1):
`Docs/cycle-history.md` § archive.

### 13. Bootstrap stub is content-static — never re-edit it
Trigger: touching `platform/installer-stub.js` or any vendored copy of it.
Rule: the stub's content is frozen; canonical source is
`platform/installer-stub.js`. Two known-good md5 invariants exist
(pre-v0.24.0 and v0.24.0+) — if a vendored copy drifts from either, restore
from canonical, don't hand-patch.
Why: the stub is the very first thing a fresh `curl | bash` install runs,
before any version-negotiation exists to correct it.

### 14. `gitState()` is best-effort — must never throw
Trigger: touching the helper that reports git status/history for install
Notices.
Rule: wrap the underlying `execSync` calls in try/catch and return nulls on
failure; every caller must tolerate null history fields.
Why: install must succeed even in a vault with no git repo, a detached HEAD,
or a missing git binary.

### 15. Vendored theme is mechanism-owned — never hand-edit it
Trigger: wanting to tweak `.obsidian/themes/<Name>/` CSS directly.
Rule: the installer overwrites-with-backup (sha256-compare, `.bak` on
mismatch) on every update; route customization through Style Settings JSON
or a user snippet (never `sauce-*.css`).
Why: hand edits get silently clobbered on the next `sauce update`, and the
sha256 compare exists specifically to detect (and warn about) drift.

### 16. In-cycle re-process needs the same lockstep bump as #10
Trigger: bumping a mechanism/blueprint version mid-cycle and expecting the
installer to pick it up.
Rule: `install.js:223`'s short-circuit is
`installedEntry.version === node.sub.version` — if the subscription pin
already equals the installed version, nothing re-installs. Bump all four
files in lockstep (item manifest, workshop manifest entry, subscription pin,
and re-run install).
Why: this has bitten real cycles repeatedly (v0.6.0, v0.17.0, v0.18.0,
v0.18.1, v0.19.0, and many later ones). Note: the manual `HC-V0*-VERSION-*`
pin-sweep practice this entry used to describe at length was **retired in
Phase 0b (documented at v0.129.0)** — see `Docs/cycle-history.md` § archive
for the full v0.80.0–v0.129.0 observation trail; only the short-circuit rule
above is still live.

### 17. Bootstrap network posture — failure-loud + idempotent + skip-if-present + GitHub-only
Trigger: any code path in `platform/bootstrap.js` (the only platform layer
that makes network calls, v0.21.0+).
Rule:
1. Single network host allowlist: `raw.githubusercontent.com` (community
   plugin index) and `github.com` (release-asset redirects → CDN). No other
   domains, no telemetry, no analytics.
2. Failure-loud: every fetch failure throws a descriptive message;
   per-plugin failures are caught at the orchestrator level and recorded in
   `failed: [{id, reason}]`; an index-fetch failure is fatal.
3. Idempotent skip-if-present: `fetchPlugin` returns `{status: "skipped"}`
   when the plugin's `manifest.json` already exists, unless force-redownload
   was requested.
4. No mid-fetch cleanup: partial writes on a thrown fetch are resumed
   correctly by the skip-if-present check on retry.
5. `.sauce-backup` written before any force-redownload overwrite;
   backup-copy failure is itself fatal.
6. Path-traversal validator: plugin id must match `/^[a-z0-9][a-z0-9._-]*$/i`
   and the resolved plugin dir must not escape the plugins root.
Why: bootstrap runs against a fresh, empty vault — a silent partial failure
there means the consumer never gets a working install, so failing loud is
the only honest posture. `install.js`'s `applyExternalPluginInstall`
(v0.94.0+) is a second, deliberately different gateway that warns-and-continues
instead, because it runs against an already-working vault where one missed
plugin is annoying, not catastrophic. Both share the same
`bootstrap-lib/fetch-plugin.js` defense-in-depth (allowlist regex,
path-traversal guard, atomic writes, optional `GITHUB_TOKEN`).

### 18. Inside-vault `pantry/` is git-managed — never hand-edit
Trigger: wanting to patch a file under `<vault>/pantry/` directly.
Rule: `pantry/` (renamed from `Beacon/` in v0.23.0 to resolve a macOS APFS
case collision) is the one git-managed top-level platform dir in any
consumer vault; treat it exactly like the vendored theme (#15) — canonical,
replaceable, never hand-modified. Route customizations through `sauce
wizard` (writes `ranch/platform-*.json`), upstream mechanism/blueprint PRs,
or the `.obsidian/` allowlist (#12).
Recovery if you already hand-edited a file inside `pantry/`: copy the edit
out, run `sauce update --force` to reset to a clean pull, then re-apply the
edit upstream so it survives future updates.
Why: `pantry/` content is meant to be fully replaceable on every update;
hand edits there are invisible to the update mechanism and will silently
vanish.

### 19. Platform-managed directory names must be lowercase
Trigger: naming any new directory materialized under `pantry/`, `ranch/`, or
`spice/`.
Rule: lowercase only. Exceptions: date-routed dirs like `05-May/`
(user-facing, not platform-naming), `assets/themes/<ThemeName>/`, and
user-facing note filenames (`Projects.md`, `Trips.md`, etc.). `.claude/skills/`
(added v0.30.0) is a sibling top-level zone with the same lowercase-only,
per-blueprint-subtree posture.
Recovery from an accidental TitleCase dir: two-step `git mv` through a temp
name (macOS APFS is case-insensitive), then sed-sweep every reference
(templates, CustomJS class literals, manifest paths, harness baselines) in
one atomic commit.
Why: macOS APFS case-collision risk plus path-canonicalization drift across
case-sensitive/case-insensitive filesystems. Codified after the v0.26.0
`ranch/Templater|Scripts|Templates|Views` lowercase sweep.

### 20. `sauce migrate` is source-read-only
Trigger: writing or reviewing migrator code (`boards.js`, `project.js`,
`trips.js`, etc.).
Rule: `sauce migrate`'s `--from <source>` argument is read-only, full stop;
the migrator's contract is "transform source → target," and target is
always the sauce-managed cwd vault. Grep any migrator diff for
`writeFileSync`/`appendFileSync`/`truncateSync`/`unlinkSync`/`renameSync`/`rmSync`
and confirm every call is rooted at `tgtRoot`, never `srcAbsPath`.
Why: if the source is corrupted by a migrator bug, it may be the user's only
intact copy of that content — a write-to-source bug is a permanent-data-loss
class bug, not a recoverable one.

### 21. `sauce audit` is read-only against the audited vault
Trigger: writing or reviewing `platform/audit/*` or `cmd-audit.js` code.
Rule: the only sanctioned write is the single `fs.writeFileSync` gated behind
the explicit `--output-file <path>` flag; walker, rule-runner, report, and
sanctioned-dirs modules do reads only.
Why: audit is meant to be a safe, side-effect-free diagnostic; any write
outside the explicit user-requested output file would violate that contract
silently.

### 22. `.local/` is the only consumer-override seam
Trigger: wanting to customize a canonical `.claude/commands/<x>.md` or
`.claude/skills/<bp>/<skill>/SKILL.md` file.
Rule: direct edits to canonical files are reverted on the next install.
Instead, shadow the same relative path under
`.claude/commands.local/<x>.md` or `.claude/skills.local/<bp>/<skill>/SKILL.md`
— installer step 6f overlays these onto the canonical materialization every
install, indefinitely. `/audit` flags a direct-canonical edit as
`consumer_edit_at_risk` before the user loses work.
Why: lockstep upgrades require the canonical source to be authoritative;
the `.local/` seam is the one place customization and upgrade safety coexist.
Permanent changes still route through a PR to the blueprint source in the
workshop, then `/upgrade`.

### 23. Time-windowed filters must treat a canonical timestamp as authoritative, never OR it with `file.mtime`
Trigger: writing any new time-window predicate over Dataview pages (daily
dashboards, activity feeds, future ranking surfaces).
Rule: if the page has a canonical timestamp field (`created_at`,
`status_changed_at`, etc.), use it exclusively — do not fall through to
`file.mtime` when the canonical field is present but out of window. Mtime
fallback is reserved for legacy pages with no canonical field at all.
```js
const inWindow = (p) => {
  if (!p) return false;
  const tsRaw = p[tsKey];
  if (tsRaw) {
    const ts = String(tsRaw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts >= startISODate && ts <= endISODate;
    return ts >= startISO && ts <= endISO;
  }
  if (!p.file || !p.file.mtime) return false;
  const mIso = (typeof p.file.mtime.toISO === "function") ? p.file.mtime.toISO() : String(p.file.mtime);
  return mIso >= startISO && mIso <= endISO;
};
```
Why: mobile sync mtime is a noisy, environment-dependent signal — on
headspace mobile it once made Thursday's daily render Wednesday's
scratches/run-notes because sync mtime landed in the wrong window, while
desktop (accurate mtime) was unaffected. Fixed in v0.70.7; mandatory mobile
smoke test on any cycle touching a time-window predicate, since Node-side
preflight can't reproduce the failure mode.

### 24. Workshop manifest catalogue drifts independently of per-item manifests
Trigger: bumping any mechanism or blueprint version.
Rule: three independent edit sites must move together — (a) the item's own
`manifest.json` version, (b) its pin in `ranch/platform-subscription.json`,
and (c) its row in `platform/manifest.json`'s `mechanisms[]`/`blueprints[]`
catalogue. `check-version-sync.js` only verifies `workshop_version`
lockstep, not catalogue rows — it will NOT catch a drifted catalogue entry.
Symptom: workshop self-install rejects with `"subscription pins X@A.B.C but
workshop has D.E.F"`. Fix: sweep the catalogue rows to match, re-run
self-install, confirm skip notices clear.

### 25. `frontmatter.section` can be a bare string or a wikilink during a migration window
Trigger: writing code that reads `frontmatter.section` or `sub_section`.
Rule: the value can be EITHER a bare string (`"Knowledge"`, pre-v0.103.0) or
a wikilink (`"[[Knowledge]]"`, v0.103.0+) until both consumer vaults have
completed the `sauce install` that migrates them — normalize at read time
with `String(p.section||"").replace(/^\[\[|\]\]$/g,"")` before comparing.
Symptom: a helper compares against the raw string form and silently drops
already-migrated doc-notes from a hub, with no error.
Why: `applyProjectSectionsHubMigration` only fires on `sauce install`
against an updated workshop, so the platform is in a mixed state until both
vaults are migrated. Designed proactively at v0.103.0.

### 26. `platform/test/seed-vault/` has exactly three sanctioned hand-edit targets
Trigger: wanting to hand-edit anything under `platform/test/seed-vault/`.
Rule: only (a) adding a pre-migration-schema note anchoring a new
`HC-V0XYZ-SEED-MIGRATE-*` assert, (b) adding a hand-authored user note
anchoring a `SEED-PRESERVE-*` assert, or (c) updating CLAUDE.md
outside-marker prose for `SEED-CLAUDE` assertions are allowed. Everything
else (schema changes, post-install state, registry refreshes) must go
through `npm run seed:prev && npm run seed:rebaseline` at cycle close.
Why: hand-editing anything else lets the seed drift silently away from real
install output — the harness and CI keep passing against a stale seed while
a real consumer vault hits an install path the harness no longer represents.
Codified at v0.110.0 when the seed-vault regression net was introduced.

### 29. Managed adopted-blueprint templates must conform to note-chrome grammar (out of order — appears before #27/#28)
Trigger: adding or touching a blueprint template (e.g. `sticky-notes`,
`to-do`).
Rule: the template's `breadcrumb`/`SectionLabel` block must pass
`scripts/lint-note-chrome.js` before merge (kanban-board `## Column`
headings are exempt — that's plugin structure, not content). Existing notes
are forward-migrated by the idempotent, `.sauce-backup`-guarded
`applyNoteChromeHeal` install step, never by hand-editing note bodies —
hand edits drift against what the heal produces and break its idempotency
check.
Known accepted regression: tag-based hubs with no `type` field aren't
reached by the heal and keep incidental `## H2` headings; this is cosmetic,
not a bug. Full rationale + the SectionLabel/outline-anchor tradeoff:
[`agent-guides/note-chrome.md`](agent-guides/note-chrome.md).
Why: heal owns existing notes, template owns new ones — mixing the two
authorship paths is what breaks idempotency. Surfaced at v0.124.0 (note-chrome
wave 1).

### 27. Cycle scope discipline — split when a feature spans more than ~3 surfaces
Trigger: a feature spans more than ~3 distinct surfaces at once (new class +
schema + template + dialog + widget + migration, all in one cycle).
Rule: split into smaller cycles, each verified end-to-end before starting
the next.
Why: v0.116.0's to-do cycle bundled 8 new CustomJS classes + a recurrence
engine + a new-task dialog in one shot — the bigger the bundle, the more
failure modes hide inside each other. Clean counter-examples: v0.94.0
(single demo blueprint), v0.113.0 (single index + linter). Source: v0.118.1
cycle postmortem item #6.

### 28. Verify dispatcher/loader contracts before designing against them
Trigger: designing a new consumer of an existing dispatcher/loader
(CustomJS, Templater, or the installer's `runInstall`).
Rule: grep the dispatcher's loader code and read one working consumer to
confirm the contract before designing against it. Known contracts: CustomJS
stores class *instances*, so dispatched methods must be on the prototype
(non-static) — caught by `platform/test/run-customjs-contract.js`; Templater
scripts execute in the *source* file's context, so `tp.file.creation_date`
resolves the source file, not the destination; the installer's `runInstall`
is subprocess-spawned, not in-process, so it can't share state with its
caller — only exit codes and stdout.
Why: "verify helpers before design asserts them" extends to runtime
dispatchers, not just static APIs. Catalog:
`Docs/agent-guides/code-conventions.md` § Dispatcher contracts. Source:
v0.118.1 postmortem item #10; reinforced v0.93.3, v0.94.0, v0.118.0.

### 30. `core.ignorecase=true` + case-fold collision on `scripts/` self-bootstrap
Trigger: `git add scripts/<file>` silently does nothing after adding a new
file under `scripts/`.
Rule: use `git add -f scripts/<file>` — the repo's `.gitignore` anchors
`/Scripts/` (capital-S) at the root for bootstrap-activation-dir isolation,
and macOS's case-insensitive filesystem folds that pattern onto lowercase
`scripts/` too.
Why: narrowing the `.gitignore` risks accidentally tracking bootstrap
activation artifacts; `-f` is the surgical per-file workaround. Surfaced at
v0.124.0 when adding `scripts/lint-note-chrome.js`.

## Operational gotchas

### CustomJS scan folder is per-vault configured in `.obsidian/plugins/customjs/data.json`
When migrating a consumer to `ranch/scripts/`, also update CustomJS's
`jsFolder` setting. Editing that file needs explicit user approval (`.obsidian/`
change, per each vault's CLAUDE.md ask-before-acting rule).

### Approval gates use Templater's `tp.system.suggester`
"Esc" returns null, which the installer treats as a skip, not an error — a
user who declines every prompt gets a silently partial install (known
limitation; `platform-installed.json` still records a version even on a
partial install). Treat partial installs as "good enough" for now.

### Workshop content vault plugins emit warnings on workshop boot
The workshop has no daily notes, kanban boards, or projects — leaving
Calendar/Big Calendar/Kanban/Daily Notes core plugins enabled fires warnings
every time you open it. Disable them in the workshop specifically (plugins
are per-vault, not synced via Obsidian Sync).

### Don't carry a bug across vaults
Every mechanism update goes through the workshop first (dogfoods on the
workshop's own self-install), then self-tests end-to-end, before touching a
real consumer vault.

### 31. Guard `dv.current()`/`.file` in dataviewjs blocks
Trigger: a dataviewjs block dereferences `dv.current().file...` eagerly —
throws a `TypeError` on cold load, before Dataview has populated the current
page context.
Rule: never dereference `dv.current()` unguarded.
```js
const notePath = dv.current()?.file?.path || app.workspace.getActiveFile()?.path;
```
Use the fuller form when the block must not run at all without a path:
```js
const cur = dv.current();
const notePath = (cur && cur.file && cur.file.path) || app.workspace.getActiveFile()?.path;
if (notePath) { /* render */ }
```
Why: the active-file fallback resolves on the FIRST render (no flash, no
placeholder needed) because the active file is known even when
`dv.current()` isn't yet. Where it bit: a button-created meeting note's
`inline_body` PeopleRendering block shipped the unguarded form while the
Templater `Meeting.md` template used the guarded form — button-created
meetings flashed the error, template-created ones didn't. Fixed at the
manifest `inline_body` source; `install.js`'s `_healNoteChromeBody` step 4b
rewrites the unguarded form in existing notes. Surfaced at v0.133.0.
