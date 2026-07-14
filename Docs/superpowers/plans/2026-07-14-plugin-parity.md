# Plugin Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring community-plugin state into parity across the three consumer vaults — smart-connections default-off (and stays off), a vendored *patched* editor-width-slider enabled everywhere (kills the null-deref + debug-log noise), and migrate claudian→realclaudian — all inside sauce's existing plugin machinery.

**Architecture:** Add one optional manifest field (`auto_enable`) honored by `applyExternalPluginInstall`; ship the patched slider through the **existing** `applyBundledPlugin` path via a new `editor-width` mechanism; enable realclaudian through a new `agent-embed` mechanism's `external_plugins`; and add two sentinel-guarded one-time heals that remove `smart-connections` and old `claudian` from `community-plugins.json`. Foundational version parity is handled operationally at deploy (deferred from code — see spec Revision).

**Tech Stack:** Node.js (CommonJS), Obsidian vault adapter API, sauce `platform/install.js` + `platform/mechanisms/*`, test harness `platform/test/run-*.js` (`node`-run, in-process `makeTpStub`).

**Key anchors (verified in worktree):**
- `applyExternalPluginInstall` — `platform/install.js:16534-16629`; installedIds built at `:16626`; call site `:1305` (inside `installItem`).
- `applyBundledPlugin` — `platform/install.js:8529-8599` (generic; fires for any mech with `bundled_plugin`; source dir `platform/mechanisms/<mech.name>/<source_dir|plugin>/`; stamps `mech.version` into the plugin manifest; enables in community-plugins.json).
- Vault-wide heals invoked in `installItem` around `platform/install.js:1296-1297` (`applyReaderScaffoldHeal`, `applyHomeScaffoldHeal`) — signature `(tp, history, git)`, adapter = `tp.app.vault.adapter` (`exists/read/write/mkdir`).
- Mechanism registration: `platform/manifest.json` `mechanisms[]` entry shape `{ "name", "version", "path": "mechanisms/<dir>" }`; workshop self-subscription `ranch/platform-subscription.json` `mechanisms[]` entry `{ "name", "version" }`.
- Test harness: `platform/test/run-helper-cases.js` (`withTempVault(fn)` + `makeTpStub(dir)` in-process, `assertEq/assertTrue`, `node platform/test/run-helper-cases.js`, exit 1 on any FAIL); external-plugin fetch flow tested in `platform/test/run-smart-connections-bridge.js` (mocks the index/https).
- `component-versions.snapshot.json` at `platform/test/fixtures/` is **bumper-generated** — do NOT hand-edit; regenerate via the release preflight (Task 7).

**Source bytes to reuse (real installed plugin on accuris):**
- `/Users/willfellhoelter/notes/sauce/accuris-sauce/.obsidian/plugins/editor-width-slider/{main.js,manifest.json,styles.css}`

---

## Task 0: Prepare the patched editor-width-slider assets

**Files:**
- Create: `platform/mechanisms/editor-width/plugin/main.js` (patched)
- Create: `platform/mechanisms/editor-width/plugin/manifest.json`
- Create: `platform/mechanisms/editor-width/plugin/styles.css`

- [ ] **Step 1: Copy the three real plugin files into the mechanism payload dir**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_015NpziHg6uKjUdNC9cDDoVM
mkdir -p platform/mechanisms/editor-width/plugin
SRC=/Users/willfellhoelter/notes/sauce/accuris-sauce/.obsidian/plugins/editor-width-slider
cp "$SRC/main.js" platform/mechanisms/editor-width/plugin/main.js
cp "$SRC/manifest.json" platform/mechanisms/editor-width/plugin/manifest.json
cp "$SRC/styles.css" platform/mechanisms/editor-width/plugin/styles.css
```

- [ ] **Step 2: Apply the two patches to main.js (null guard + strip debug logs)**

The bug is in `updateEditorStyleYAML()`:
```js
    console.log("1.1");
    const file = this.app.workspace.getActiveFile();
    console.log("1.2");
    if (file.name) {
```
Replace those four lines with:
```js
    const file = this.app.workspace.getActiveFile();
    if (file?.name) {
```

Do it with an editor (exact string replace), or:
```bash
node - <<'EOF'
const fs=require('fs');
const p='platform/mechanisms/editor-width/plugin/main.js';
let s=fs.readFileSync(p,'utf8');
const before=s;
s=s.replace('    console.log("1.1");\n    const file = this.app.workspace.getActiveFile();\n    console.log("1.2");\n    if (file.name) {',
            '    const file = this.app.workspace.getActiveFile();\n    if (file?.name) {');
if(s===before){console.error('PATCH DID NOT APPLY — inspect main.js manually');process.exit(1);}
fs.writeFileSync(p,s);
console.log('patched');
EOF
```

- [ ] **Step 3: Verify the patch is complete and there are no other hazards**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_015NpziHg6uKjUdNC9cDDoVM
echo "must be 0 (no debug logs):"; grep -c 'console.log("1.1")\|console.log("1.2")' platform/mechanisms/editor-width/plugin/main.js
echo "must be >=1 (guard present):"; grep -c 'file?.name' platform/mechanisms/editor-width/plugin/main.js
echo "must be 0 (no unguarded file.name reads):"; grep -c 'if (file.name)' platform/mechanisms/editor-width/plugin/main.js
echo "must be 0 (no accidental template vars in payload):"; grep -c '{{' platform/mechanisms/editor-width/plugin/main.js platform/mechanisms/editor-width/plugin/manifest.json platform/mechanisms/editor-width/plugin/styles.css
```
Expected: `0`, `>=1`, `0`, `0`. If the last is nonzero, note it — `applyBundledPlugin` writes files verbatim (no `{{}}` substitution), so it's harmless, but confirm it's inside a legit string.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/editor-width/plugin/
git commit -m "feat(editor-width): vendor patched editor-width-slider build (null guard + strip debug logs)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 1: `auto_enable` support in `applyExternalPluginInstall` + smart-connections-bridge manifest

**Files:**
- Modify: `platform/install.js:16580-16629` (the fetch loop + installedIds)
- Modify: `platform/mechanisms/smart-connections-bridge/manifest.json`
- Test: `platform/test/run-smart-connections-bridge.js`

- [ ] **Step 1: Write the failing test (mirror an existing sc-bridge case)**

Open `platform/test/run-smart-connections-bridge.js`, find the existing case that runs `applyExternalPluginInstall` against the `vault-ready` fixture and asserts `smart-connections` lands in `.obsidian/community-plugins.json`. Add a new case `case_autoEnableFalse_notEnabled` that mirrors it but uses a manifest whose external_plugins entry is:
```js
external_plugins: [{ id: "smart-connections", required: false, auto_enable: false }]
```
and asserts the **opposite**: after `applyExternalPluginInstall`, the plugin dir is present (fetched/skipped) BUT `smart-connections` is **absent** from `.obsidian/community-plugins.json`. Assertion:
```js
const cp = JSON.parse(fs.readFileSync(path.join(vaultDir, ".obsidian/community-plugins.json"), "utf8"));
assertTrue("auto_enable:false → id NOT added to community-plugins.json", !cp.includes("smart-connections"), JSON.stringify(cp));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-smart-connections-bridge.js`
Expected: FAIL on the new assertion (current code adds every fetched/skipped id).

- [ ] **Step 3: Implement — honor `auto_enable` in the installedIds set**

In `platform/install.js`, in `applyExternalPluginInstall`, immediately after the `const fetched = [], skipped = [], failed = [];` line (`:16580`) add:
```js
  const noEnable = new Set(
    manifest.external_plugins
      .filter((d) => d && d.auto_enable === false)
      .map((d) => d.id)
  );
```
Then change the installedIds construction at `:16626` from:
```js
  const installedIds = [...fetched.map(x => x.id), ...skipped.map(x => x.id)];
```
to:
```js
  const installedIds = [...fetched.map(x => x.id), ...skipped.map(x => x.id)]
    .filter((id) => !noEnable.has(id));
```
(Behavior unchanged for any entry without `auto_enable:false`.)

- [ ] **Step 4: Update the smart-connections-bridge manifest**

In `platform/mechanisms/smart-connections-bridge/manifest.json`, change the `external_plugins` array from:
```json
"external_plugins":[{"id":"smart-connections","required":true}]
```
to:
```json
"external_plugins":[{"id":"smart-connections","required":false,"auto_enable":false}]
```
(Leave `version`, `files`, everything else untouched. The release bumper will bump the mechanism version — do NOT hand-edit it.)

- [ ] **Step 5: Run tests to verify pass**

Run: `node platform/test/run-smart-connections-bridge.js`
Expected: PASS (new case + all existing cases still green).

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/mechanisms/smart-connections-bridge/manifest.json platform/test/run-smart-connections-bridge.js
git commit -m "feat(install): auto_enable:false — install external plugin dir without enabling; apply to smart-connections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: New `editor-width` mechanism (bundled patched slider)

**Files:**
- Create: `platform/mechanisms/editor-width/manifest.json`
- Modify: `platform/manifest.json` (add mechanism to `mechanisms[]`)
- Modify: `ranch/platform-subscription.json` (workshop self-subscription)
- Test: `platform/test/run-helper-cases.js` (static asset-integrity case)

- [ ] **Step 1: Create the mechanism manifest**

Create `platform/mechanisms/editor-width/manifest.json`:
```json
{
  "name": "editor-width",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Ships a sauce-patched build of the editor-width-slider community plugin (null-deref guard on fileless leaves + debug logs stripped) and enables it, so the editor-width control is at parity across all vaults without the upstream 1.0.5 crash.",
  "depends_on": [],
  "bundled_plugin": {
    "id": "editor-width-slider",
    "source_dir": "plugin",
    "files": ["main.js", "manifest.json", "styles.css"]
  },
  "files": [],
  "claude_surface": [],
  "post_install": [],
  "rule_fragments": []
}
```

- [ ] **Step 2: Register the mechanism in the workshop manifest**

In `platform/manifest.json`, add to the `mechanisms[]` array (keep alphabetical/existing order convention; placing next to other mechanisms is fine):
```json
{ "name": "editor-width", "version": "0.1.0", "path": "mechanisms/editor-width" }
```

- [ ] **Step 3: Subscribe the workshop dogfood to it**

In `ranch/platform-subscription.json`, add to the `mechanisms[]` array:
```json
{ "name": "editor-width", "version": "0.1.0" }
```

- [ ] **Step 4: Write the static asset-integrity test**

In `platform/test/run-helper-cases.js`, add a case `caseEditorWidthPatchedAssets()` (registered in the run list like the other cases) that reads the shipped payload directly and asserts the patch:
```js
async function caseEditorWidthPatchedAssets() {
  console.log("\n--- Case: editor-width patched slider assets ---");
  const dir = path.join(__dirname, "..", "mechanisms", "editor-width", "plugin");
  const main = fs.readFileSync(path.join(dir, "main.js"), "utf8");
  assertTrue("editor-width: null guard present", main.includes("file?.name"), "missing file?.name");
  assertTrue("editor-width: no unguarded file.name", !main.includes("if (file.name)"), "found unguarded read");
  assertTrue("editor-width: debug log 1.1 stripped", !main.includes('console.log("1.1")'), "1.1 present");
  assertTrue("editor-width: debug log 1.2 stripped", !main.includes('console.log("1.2")'), "1.2 present");
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  assertEq("editor-width: plugin id", mf.id, "editor-width-slider");
  const mech = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mechanisms", "editor-width", "manifest.json"), "utf8"));
  assertEq("editor-width: bundled_plugin id", mech.bundled_plugin && mech.bundled_plugin.id, "editor-width-slider");
  assertEq("editor-width: bundled files count", (mech.bundled_plugin.files || []).length, 3);
}
```
Ensure `fs` and `path` are already required at the top of the harness (they are — used by other cases).

- [ ] **Step 5: Run tests**

Run: `node platform/test/run-helper-cases.js`
Expected: PASS (new case green; existing cases unaffected).

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/editor-width/manifest.json platform/manifest.json ranch/platform-subscription.json platform/test/run-helper-cases.js
git commit -m "feat(editor-width): new mechanism bundling the patched slider; register + subscribe + asset test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: New `agent-embed` mechanism (realclaudian)

**Files:**
- Create: `platform/mechanisms/agent-embed/manifest.json`
- Modify: `platform/manifest.json`
- Modify: `ranch/platform-subscription.json`

- [ ] **Step 1: Create the mechanism manifest**

Create `platform/mechanisms/agent-embed/manifest.json`:
```json
{
  "name": "agent-embed",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Manages the realclaudian community plugin (yishentu/claudian) — embeds Claude Code/Codex agents in the vault. Installs from the obsidian-releases index and enables it, standardizing the agent embed across vaults (supersedes the legacy 'claudian' plugin, retired by a one-time heal).",
  "depends_on": [],
  "external_plugins": [{ "id": "realclaudian", "name": "Claudian" }],
  "files": [],
  "claude_surface": [],
  "post_install": [],
  "rule_fragments": []
}
```
(No `version` pin on the external plugin — index latest is 2.0.21; `auto_enable` defaults true so it installs + enables everywhere.)

- [ ] **Step 2: Register + subscribe**

In `platform/manifest.json` `mechanisms[]`:
```json
{ "name": "agent-embed", "version": "0.1.0", "path": "mechanisms/agent-embed" }
```
In `ranch/platform-subscription.json` `mechanisms[]`:
```json
{ "name": "agent-embed", "version": "0.1.0" }
```

- [ ] **Step 3: Sanity-run the harness (no new test — fetch flow is network; covered operationally)**

Run: `node platform/test/run-helper-cases.js`
Expected: PASS (registration doesn't break existing cases). The realclaudian fetch/enable is validated at deploy against the real index.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/agent-embed/manifest.json platform/manifest.json ranch/platform-subscription.json
git commit -m "feat(agent-embed): new mechanism installing+enabling realclaudian (claudian v2 successor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Sentinel heal — remove-plugin-once helper + disable smart-connections

**Files:**
- Modify: `platform/install.js` (add `_removePluginOnce` + `disableSmartConnectionsOnce`; wire call site)
- Test: `platform/test/run-helper-cases.js`

- [ ] **Step 1: Write the failing test**

In `platform/test/run-helper-cases.js` add `caseDisableSmartConnectionsOnce()`:
```js
async function caseDisableSmartConnectionsOnce() {
  console.log("\n--- Case: disableSmartConnectionsOnce ---");
  await withTempVault(async (dir) => {
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    const cp = path.join(dir, ".obsidian/community-plugins.json");
    fs.writeFileSync(cp, JSON.stringify(["dataview", "smart-connections", "claudian"], null, 2));
    const tp = makeTpStub(dir);
    const { disableSmartConnectionsOnce } = require(CANONICAL_INSTALLER); // same require the harness uses
    await disableSmartConnectionsOnce(tp, [], {});
    let arr = JSON.parse(fs.readFileSync(cp, "utf8"));
    assertTrue("sc removed", !arr.includes("smart-connections"), JSON.stringify(arr));
    assertTrue("dataview preserved", arr.includes("dataview"), JSON.stringify(arr));
    assertTrue("sentinel written", fs.existsSync(path.join(dir, ".obsidian/.sauce-heals/sc-disabled-once")), "no sentinel");
    // idempotent + respects later re-enable
    fs.writeFileSync(cp, JSON.stringify(["dataview", "smart-connections"], null, 2));
    await disableSmartConnectionsOnce(tp, [], {});
    arr = JSON.parse(fs.readFileSync(cp, "utf8"));
    assertTrue("re-enabled sc survives after sentinel", arr.includes("smart-connections"), JSON.stringify(arr));
  });
}
```
Note the exact export/require idiom the harness uses for install functions — if the harness pulls helpers off a required `platformInstall` object, match that (`const platformInstall = require(CANONICAL_INSTALLER); platformInstall.disableSmartConnectionsOnce(...)`). Confirm `disableSmartConnectionsOnce` is added to `module.exports` in install.js (Step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-helper-cases.js`
Expected: FAIL — `disableSmartConnectionsOnce is not a function`.

- [ ] **Step 3: Implement the helper + heal in `platform/install.js`**

Add near the other vault-wide heals (e.g. just before `applyReaderScaffoldHeal`). First a shared, DRY helper:
```js
// _removePluginOnce — sentinel-guarded one-time removal of a plugin id from
// .obsidian/community-plugins.json. Runs exactly once per vault (marker under
// .obsidian/.sauce-heals/<sentinel>), so a later deliberate re-enable by the
// user is never fought. Backs up the prior file to a timestamped .sauce-backup/.
// Never throws; malformed/absent community-plugins.json → writes sentinel + returns.
async function _removePluginOnce(tp, history, git, pluginId, sentinelName, step) {
  const adapter = tp.app.vault.adapter;
  const sentinel = ".obsidian/.sauce-heals/" + sentinelName;
  try { if (await adapter.exists(sentinel)) return; } catch (_e) {}
  const writeSentinel = async () => {
    try { await adapter.mkdir(".obsidian/.sauce-heals"); } catch (_e) {}
    try { await adapter.write(sentinel, new Date().toISOString() + "\n"); } catch (_e) {}
  };
  const cp = ".obsidian/community-plugins.json";
  let raw;
  try { if (!(await adapter.exists(cp))) { await writeSentinel(); return; } raw = await adapter.read(cp); }
  catch (_e) { return; }
  let arr;
  try { arr = JSON.parse(raw); } catch (_e) { return; } // malformed → leave untouched, retry next run
  if (!Array.isArray(arr)) return;
  if (arr.includes(pluginId)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    try { await adapter.mkdir(".sauce-backup/community-plugins"); } catch (_e) {}
    try { await adapter.write(".sauce-backup/community-plugins/community-plugins.json." + ts, raw); } catch (_e) {}
    const next = arr.filter((id) => id !== pluginId);
    try { await adapter.write(cp, JSON.stringify(next, null, 2) + "\n"); }
    catch (_e) { return; } // write failed → don't set sentinel, retry next run
    if (history) history.push({
      event: "info", step, removed: pluginId,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
  await writeSentinel();
}

async function disableSmartConnectionsOnce(tp, history, git) {
  return _removePluginOnce(tp, history, git, "smart-connections", "sc-disabled-once", "sc_disabled_once");
}
```
Wire the call at the vault-wide heal site (`platform/install.js` ~`:1296`, alongside `applyHomeScaffoldHeal`):
```js
  await disableSmartConnectionsOnce(tp, history, git);
```
Add `disableSmartConnectionsOnce` (and `_removePluginOnce`) to `module.exports` if the harness requires named exports.

- [ ] **Step 4: Run tests to verify pass**

Run: `node platform/test/run-helper-cases.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-helper-cases.js
git commit -m "feat(install): sentinel-guarded disableSmartConnectionsOnce heal (remove-plugin-once helper)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Sentinel heal — retire old claudian

**Files:**
- Modify: `platform/install.js` (`retireOldClaudianOnce` + call site)
- Test: `platform/test/run-helper-cases.js`

- [ ] **Step 1: Write the failing test**

Add `caseRetireOldClaudianOnce()` to `platform/test/run-helper-cases.js`, mirroring Task 4's test but for id `"claudian"`, sentinel `claudian-retired-once`, asserting `realclaudian` (if present in the fixture array) is preserved:
```js
async function caseRetireOldClaudianOnce() {
  console.log("\n--- Case: retireOldClaudianOnce ---");
  await withTempVault(async (dir) => {
    fs.mkdirSync(path.join(dir, ".obsidian"), { recursive: true });
    const cp = path.join(dir, ".obsidian/community-plugins.json");
    fs.writeFileSync(cp, JSON.stringify(["claudian", "realclaudian", "dataview"], null, 2));
    const tp = makeTpStub(dir);
    const platformInstall = require(CANONICAL_INSTALLER);
    await platformInstall.retireOldClaudianOnce(tp, [], {});
    const arr = JSON.parse(fs.readFileSync(cp, "utf8"));
    assertTrue("old claudian removed", !arr.includes("claudian"), JSON.stringify(arr));
    assertTrue("realclaudian preserved", arr.includes("realclaudian"), JSON.stringify(arr));
    assertTrue("sentinel written", fs.existsSync(path.join(dir, ".obsidian/.sauce-heals/claudian-retired-once")), "no sentinel");
  });
}
```
(Note: `["claudian","realclaudian",...]` — the `.filter(id => id !== "claudian")` removes only the exact `"claudian"` id, never `"realclaudian"`. This test guards that exact-match precision.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node platform/test/run-helper-cases.js`
Expected: FAIL — `retireOldClaudianOnce is not a function`.

- [ ] **Step 3: Implement**

In `platform/install.js`, next to `disableSmartConnectionsOnce`:
```js
async function retireOldClaudianOnce(tp, history, git) {
  return _removePluginOnce(tp, history, git, "claudian", "claudian-retired-once", "claudian_retired_once");
}
```
Wire the call at the same vault-wide heal site:
```js
  await retireOldClaudianOnce(tp, history, git);
```
Export it if the harness requires named exports.

- [ ] **Step 4: Run tests to verify pass**

Run: `node platform/test/run-helper-cases.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/install.js platform/test/run-helper-cases.js
git commit -m "feat(install): sentinel-guarded retireOldClaudianOnce heal (claudian→realclaudian migration)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full harness green + release preflight (snapshot regen)

**Files:** (validation only; preflight may touch bumper-owned artifacts)

- [ ] **Step 1: Run every relevant harness**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce/.claude/worktrees/bridge-cse_015NpziHg6uKjUdNC9cDDoVM
node platform/test/run-helper-cases.js
node platform/test/run-smart-connections-bridge.js
```
Expected: both exit 0, all PASS.

- [ ] **Step 2: Run the release preflight (regenerates the bumper-owned version snapshot for the two new mechanisms)**

The new mechanisms must appear in `platform/test/fixtures/component-versions.snapshot.json` (bumper-generated — never hand-edit). Regenerate it via the project's preflight/snapshot-write path:
```bash
npm run release:preflight 2>&1 | tail -40
```
If `release:preflight` reports a snapshot mismatch and supports a `--write`/regen flag, run that (inspect `package.json` scripts + `platform/test/` for the snapshot writer — prior new-mechanism cycles, e.g. chrome-bar/menu-popover, used it). If the snapshot is only writable by the release bumper on `main`, note that in the PR description so the auto-release reconciles it; do NOT hand-edit the snapshot JSON.

- [ ] **Step 3: Verify the full working tree**

Run:
```bash
git status --short
git log --oneline origin/main..HEAD
```
Expected: only intended files changed; commits from Tasks 0-5 present.

- [ ] **Step 4: Commit any preflight-regenerated artifacts (if the preflight legitimately wrote them)**

```bash
git add -A
git commit -m "chore: regenerate component-version snapshot for editor-width + agent-embed mechanisms

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" || echo "nothing to commit"
```

---

## Self-review — spec coverage

- smart-connections default-off → Task 1 (`auto_enable:false`) + Task 4 (`disableSmartConnectionsOnce`). ✅
- patched slider everywhere → Task 0 (patched build) + Task 2 (`editor-width` mechanism via `applyBundledPlugin`). ✅
- claudian→realclaudian → Task 3 (`agent-embed` enables realclaudian) + Task 5 (`retireOldClaudianOnce`). ✅
- foundational version parity → deferred to operational deploy per spec Revision (NOT a code task). ✅ (handled in the deploy phase, flagged for user on ero's templater jump)
- `auto_enable` schema field → Task 1. ✅
- new-mechanism subscription + registration → Tasks 2 & 3. ✅
- snapshot regen for new mechanisms → Task 6. ✅

**Type/name consistency:** `_removePluginOnce(tp, history, git, pluginId, sentinelName, step)` defined Task 4, reused Task 5. Heal names `disableSmartConnectionsOnce` / `retireOldClaudianOnce` consistent across install.js + tests. Mechanism names `editor-width` / `agent-embed` consistent across manifest/registration/subscription. Sentinel paths `.obsidian/.sauce-heals/{sc-disabled-once,claudian-retired-once}` consistent.

## Deploy phase (post-merge, executed after release+brew — not a code task)

Per-vault, after `brew upgrade sauce`:
1. Add `editor-width` + `agent-embed` to each consumer `ranch/platform-subscription.json` (accuris, headspace, ero), then `sauce update --bump-pins` per vault (cwd = vault).
2. Catch ero up from 0.127.1 first (with backup) so the new mechanisms land on a current base.
3. Foundational version parity (operational): apply the small-delta upgrades (dataview 0.5.67→0.5.68 on ero, url-into-selection); **flag ero's templater 2.4.1→2.20.0, tasks 7.9→7.23, admonition 10→11 for the user** rather than force them blindly (breaking-change risk on live templates/queries).
4. Verify outcomes: smart-connections absent from all three community-plugins.json; editor-width-slider present+patched+enabled on all three (`grep -c 'file?.name'` in each installed main.js ≥1); realclaudian enabled on all three; old claudian absent; sentinels present.
