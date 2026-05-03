# Landmines — traps we already hit

Read this before any new platform work. Every entry is a real failure we recovered from. Reintroducing one of these costs hours.

## CustomJS / Dataview integration (5 landmines)

### 1. Bare `customJS.X.Y(dv)` callsites cause cold-load `ReferenceError`

On cold vault load, Dataview/Templater render dataviewjs blocks before the CustomJS plugin populates `window.customJS`. Every bare callsite throws a red error flash before resolving.

**Fix:** never use the bare pattern. Always go through the customjs-guard view:
```dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
```

### 2. `typeof customJS === 'undefined'` does NOT guard against the error

CustomJS declares its global with `let customJS = …`, putting the name in the **temporal dead zone** until the plugin initializes. TDZ is the one case where `typeof` itself throws a `ReferenceError`.

**Fix:** use `window.customJS?.X` — property access on `window` cannot hit TDZ.

### 3. Helper view file MUST NOT live in the CustomJS scan folder

The CustomJS plugin scans its `jsFolder` and tries to parse every `.js` file as a CustomJS class. A Dataview view file uses different syntax (top-level body, not a class). CustomJS hits a parse error and **aborts class registration entirely** — every customJS class in the vault goes dark.

**Fix:** view files live OUTSIDE the CustomJS scan folder. Canonical: `Docs/Meta/Views/`. ERO has a CLAUDE.md non-negotiable banning the legacy `Extras/Scripts/...` location for the same reason.

### 4. Dataview view files are NOT CommonJS modules

`dv.view` evaluates the script body inline with `dv` and `input` already in scope. A `module.exports = async (dv, input) => {…}` assignment runs without ever being invoked. Result: silent no-op, zero output, zero error.

**Fix:** view scripts are plain top-level statements. NO `module.exports` wrapper.

### 5. `dv.view` resolves a folder, not a single file

In Dataview 0.5.x, the reliable resolution is `dv.view("path/to/folder")` → loads `path/to/folder/view.js`. Single-file resolution (`dv.view("path/to/file")` → `path/to/file.js`) is unreliable.

**Fix:** every Dataview view ships as a folder containing `view.js` (and optional `view.css`).

## Platform installer (3 landmines)

### 6. Templater user scripts cannot reach Obsidian's `parseYaml`

The `obsidian` virtual module is registered for plugin code only. `require("obsidian")` from a Templater user script returns undefined / throws. So `parseYaml` and `stringifyYaml` are unavailable.

**Fix:** all platform metadata is JSON. `JSON.parse` is a built-in, no dependencies. Files affected: `platform-config.json`, `platform-subscription.json`, `platform-installed.json`, `platform/manifest.json`, each mechanism's `manifest.json`, `rules/_global.json`.

### 7. Templater requires a manual reload to pick up new user scripts

After the installer copies `validate.js` / `hook-validate.js` / `audit-walker.js` into the consumer's Templater scripts folder, Templater doesn't see them until "User Script Functions → reload" runs.

**Fix:** every install ends with a Notice instructing the user to reload. Built into the validator's manifest as a `post_install: { type: notice }` step.

### 8. Cross-vault filesystem reads need `require("fs")`, desktop only

The installer reads the workshop's manifest from outside its own vault. We use `require("fs").promises.readFile(absPath, "utf8")` — Node API available in desktop Templater. Obsidian mobile sandboxes the renderer differently and `fs` is unavailable.

**Fix:** the platform is desktop-first. Mobile is a future consideration; would require Obsidian Sync to deliver the workshop's files into each consumer's vault first (as a vendored copy), then the installer reads from `app.vault.adapter` instead of `fs`.

## Operational gotchas

### CustomJS scan folder is per-vault and configured in `.obsidian/plugins/customjs/data.json`

When canonically migrating a consumer to `Docs/Meta/Scripts/`, also update CustomJS's `jsFolder` setting. Editing that file is a `.obsidian/` change and needs explicit user approval (per each vault's CLAUDE.md "ask before acting" rule).

### Approval gates use Templater's `tp.system.suggester`

The suggester's "Esc" key returns null, which the installer treats as a skip (not an error). Files declined by the user are silently skipped; the mechanism continues with whatever else it can do. The `platform-installed.json` entry records the version even on partial installs — that's a known limitation. Resolution: treat partial installs as "good enough" for now; a future installer version can track per-file install state.

### Workshop content vault plugins emit warnings on workshop boot

Workshop has no daily notes, no kanban boards, no projects. If you leave Calendar / Big Calendar / Kanban / Daily Notes core plugin enabled, they fire warnings every time you open the workshop. Disable them in the workshop specifically (community plugins are per-vault, not synced via Obsidian Sync).

### Don't carry a bug across vaults

Every mechanism update goes through the workshop first, dogfoods on the workshop's own self-install, THEN promotes to consumers. If the workshop self-test fails, do not push the update into consumers. The workshop's "production" status validates the mechanism end-to-end.
