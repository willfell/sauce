# nav-buttons + project blueprint Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build a `nav-buttons` mechanism and a `project` blueprint, extending the workshop installer with dependency resolution, blueprint shipping, rule-fragment materialization, and strict substitution. Validate on tmp-acc-vault, then prove the platform from absolute zero on a fresh barebones-vault.

**Architecture:** Four sequential stages, each dogfooded in workshop self-install before promoting. Stage 1 = installer-only changes. Stage 2 = nav-buttons mechanism (mechanism with `depends_on`). Stage 3 = project blueprint (first blueprint, multi-file, rule + template + helpers + slash command). Stage 4 = onboard barebones-vault from zero as the platform's permanent regression-test target.

**Tech Stack:** Templater user scripts (Node JavaScript with `fs` + `path`), JSON for all platform metadata, Obsidian Templater + Dataview + CustomJS plugins as the runtime, manual Obsidian-side validation.

**Reference:** Design doc at `Docs/plans/2026-05-02-nav-buttons-and-project-blueprint-design.md`.

**Conventions used in this plan:**
- `WORKSHOP` = `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`
- `TMPACC` = `/Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault`
- `BAREBONES` = `/Users/willfell/Documents/obsidian/sync/workshop/barebones-vault`
- "Self-install" = open the workshop in Obsidian, run `tp.user.platformInstall(tp)`. The implementing agent cannot do this; surface it to the user.
- Tests are mostly **filesystem assertions** + **smoke runs inside Obsidian** (no automated test harness exists). Each task names the assertion explicitly.
- Commits: workshop CLAUDE.md says only commit when explicitly asked. Each task ends with a "Commit (ask user)" step — the implementing agent should pause and request confirmation, not auto-commit.

---

## Stage 1 — Installer extensions (workshop only)

Stage 1 is a workshop-side-only series of changes. No consumer vault is touched. Workshop self-install must remain green at the end.

### Task 1.1: Add new substitution variables to workshop platform-config.json

**Files:**
- Modify: `WORKSHOP/Docs/Meta/platform-config.json`

**Step 1: Read current contents**

Run: `cat WORKSHOP/Docs/Meta/platform-config.json`
Expected: existing JSON with `workshop_relative_path` and `variables` containing `views_path`, `templater_scripts_path`, `scripts_path`.

**Step 2: Add new variables + vault_identity**

Edit the JSON to add:
- top-level `"vault_identity": "workshop"`
- `"variables.rules_path": "Docs/Meta/rules"`
- `"variables.templates_path": "Docs/Meta/Templates"`
- `"variables.commands_path": "commands"`

Final shape:

```json
{
  "_comment": "Workshop self-install config. Mirrors a real consumer's config since the workshop dogfoods the platform.",
  "workshop_relative_path": ".",
  "vault_identity": "workshop",
  "variables": {
    "views_path": "Docs/Meta/Views",
    "templater_scripts_path": "Docs/Meta/Templater",
    "scripts_path": "Docs/Meta/Scripts",
    "rules_path": "Docs/Meta/rules",
    "templates_path": "Docs/Meta/Templates",
    "commands_path": "commands"
  }
}
```

(Preserve `workshop_relative_path` as-is — read existing file before editing.)

**Step 3: Verify**

Run: `cat WORKSHOP/Docs/Meta/platform-config.json | python3 -m json.tool`
Expected: parses cleanly, contains all six variables + `vault_identity`.

**Step 4: Commit (ask user)**

Suggested message: `chore(platform): add rules_path, templates_path, commands_path, vault_identity to workshop config`

---

### Task 1.2: Implement strict substitution in install.js

**Files:**
- Modify: `WORKSHOP/platform/install.js` — `substitute()` function

**Step 1: Locate the function**

Read `WORKSHOP/platform/install.js`. Find:

```javascript
function substitute(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}
```

**Step 2: Replace with strict version**

```javascript
function substitute(text, variables) {
  const missing = new Set();
  const result = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (variables[key] === undefined || variables[key] === null) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return variables[key];
  });
  if (missing.size > 0) {
    const err = new Error(`Unsubstituted variables: ${[...missing].join(", ")}`);
    err.missing = [...missing];
    throw err;
  }
  return result;
}
```

**Step 3: Update callers to handle the throw**

In `installMechanism`, wrap each `substitute` call in try/catch. On error: Notice the failure with the file source path + missing var names, and `return false` so the mechanism is not recorded as installed. Specifically, around lines that call `substitute(f.dest, variables)` and `substitute(sourceText, variables)`:

```javascript
let destPath, substituted;
try {
  destPath = substitute(f.dest, variables);
  substituted = substitute(sourceText, variables);
} catch (e) {
  new Notice(`installMechanism: ${mech.name} ${f.source} — ${e.message}`, 8000);
  return false;
}
```

**Step 4: Verify by inspection**

Read the modified `install.js`. Confirm `substitute` throws on missing var, and both call sites have try/catch.

**Step 5: Commit (ask user)**

Suggested message: `feat(installer): abort on unsubstituted template variables instead of leaving placeholders`

---

### Task 1.3: Implement dependency resolver in install.js

**Files:**
- Modify: `WORKSHOP/platform/install.js`

**Step 1: Add resolveDependencies function**

Add this function near the bottom of `install.js`:

```javascript
function resolveDependencies(subscription, manifest) {
  const subItems = [];
  for (const m of subscription.mechanisms || []) subItems.push({ ...m, kind: "mechanism" });
  for (const b of subscription.blueprints || []) subItems.push({ ...b, kind: "blueprint" });

  const manifestItem = (name) =>
    (manifest.mechanisms || []).find((m) => m.name === name) ||
    (manifest.blueprints || []).find((b) => b.name === name);

  const skipped = [];
  const nodes = new Map();

  for (const sub of subItems) {
    const target = manifestItem(sub.name);
    if (!target) {
      skipped.push({ name: sub.name, reason: `workshop has no item named "${sub.name}"` });
      continue;
    }
    if (target.version !== sub.version) {
      skipped.push({
        name: sub.name,
        reason: `subscription pins ${sub.name}@${sub.version} but workshop has ${target.version}`,
      });
      continue;
    }
    nodes.set(sub.name, { sub, target, deps: [] });
  }

  // We need each item's manifest.json to read depends_on. The caller passes a reader.
  return { nodes, skipped };
}

function checkDeps(nodes, perItemManifest, subscriptionLookup) {
  const skipped = [];
  for (const [name, node] of nodes) {
    const itemMan = perItemManifest.get(name);
    const deps = (itemMan && itemMan.depends_on) || [];
    for (const dep of deps) {
      const sub = subscriptionLookup.get(dep.name);
      if (!sub) {
        skipped.push({ name, reason: `depends on ${dep.name} ${dep.range} but it is not subscribed` });
        node.unfit = true;
        break;
      }
      if (!satisfiesRange(sub.version, dep.range)) {
        skipped.push({
          name,
          reason: `depends on ${dep.name} ${dep.range} but subscription pins ${dep.name}@${sub.version}`,
        });
        node.unfit = true;
        break;
      }
      node.deps.push(dep.name);
    }
  }
  return skipped;
}

function satisfiesRange(version, range) {
  if (range === version) return true;
  const m = range.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [, a, b, c] = m.map(Number);
    const [x, y, z] = version.split(".").map(Number);
    if (x > a) return true;
    if (x < a) return false;
    if (y > b) return true;
    if (y < b) return false;
    return z >= c;
  }
  return false;
}

function topoSort(nodes) {
  const order = [];
  const visited = new Set();
  const temp = new Set();
  function visit(name) {
    if (visited.has(name)) return true;
    if (temp.has(name)) return false; // cycle
    const node = nodes.get(name);
    if (!node || node.unfit) return true;
    temp.add(name);
    for (const d of node.deps) {
      if (!visit(d)) return false;
    }
    temp.delete(name);
    visited.add(name);
    order.push(name);
    return true;
  }
  for (const name of nodes.keys()) {
    if (!visit(name)) return { order: null, cycle: name };
  }
  return { order, cycle: null };
}
```

**Step 2: Refactor main flow to use the resolver**

The existing `module.exports` body iterates `subscription.mechanisms` directly. Replace that loop with:

```javascript
// 1. resolve which items to install + their order
const { nodes, skipped: missingItems } = resolveDependencies(subscription, manifest);

// 2. read each item's manifest.json so we can see its depends_on
const perItemManifest = new Map();
const subscriptionLookup = new Map();
for (const [name, node] of nodes) {
  const path = `${workshopPath}/platform/${node.target.path}/manifest.json`;
  const m = await readJsonAbsolute(path);
  if (m) perItemManifest.set(name, m);
  subscriptionLookup.set(name, node.sub);
}

// 3. check dep satisfaction
const depSkipped = checkDeps(nodes, perItemManifest, subscriptionLookup);

// 4. topo sort
const { order, cycle } = topoSort(nodes);
if (cycle) {
  new Notice(`platformInstall: dependency cycle involving ${cycle}. Aborting.`, 8000);
  return;
}

// 5. log + record skips
const allSkipped = [...missingItems, ...depSkipped];
for (const s of allSkipped) {
  new Notice(`platformInstall: skipping ${s.name} — ${s.reason}`, 6000);
  installedNow.history.push({ event: "skip", name: s.name, reason: s.reason, attempted_at: new Date().toISOString() });
}

// 6. install in order
for (const name of order) {
  const node = nodes.get(name);
  const installedEntry = (node.target.kind === "blueprint"
    ? installedNow.blueprints || []
    : installedNow.mechanisms
  ).find((m) => m.name === name);
  if (installedEntry && installedEntry.version === node.sub.version) continue;
  const itemMan = perItemManifest.get(name);
  const ok = await installItem(tp, workshopPath, node.target, itemMan, variables);
  if (ok) {
    const entry = { name, version: node.sub.version, installed_at: new Date().toISOString() };
    const bucket = node.target.kind === "blueprint" ? "blueprints" : "mechanisms";
    installedNow[bucket] = installedNow[bucket] || [];
    const idx = installedNow[bucket].findIndex((m) => m.name === name);
    if (idx >= 0) installedNow[bucket][idx] = entry;
    else installedNow[bucket].push(entry);
    installedNow.history.push({ event: "install", kind: node.target.kind, ...entry });
  }
}
```

(The existing per-mechanism loop is replaced by the above. `installMechanism` is renamed to `installItem` in Task 1.4.)

**Step 3: Verify by inspection**

Read the modified `install.js`. Confirm `resolveDependencies`, `checkDeps`, `satisfiesRange`, `topoSort` exist and the main flow uses them. Do NOT run yet — Task 1.4 must land first.

**Step 4: Commit (ask user)**

Hold the commit until Task 1.4 lands; this task's code does not run standalone.

---

### Task 1.4: Generalize installMechanism into installItem (mechanism + blueprint)

**Files:**
- Modify: `WORKSHOP/platform/install.js`

**Step 1: Rename + extend installMechanism**

Rename `installMechanism` to `installItem`. Signature changes from `(tp, workshopPath, target, variables)` to `(tp, workshopPath, target, itemMan, variables)` — the item's manifest is now passed in (already loaded by the resolver).

Replace the body's `const mech = await readJsonAbsolute(...)` with `const mech = itemMan` since it's now passed.

The function works identically for blueprints — they have the same `files` + `post_install` shape.

**Step 2: Add rule_fragments handling at end of installItem**

Just before `return true;`, add:

```javascript
// Materialize rule_fragments contributed by this item.
for (const frag of mech.rule_fragments || []) {
  await applyRuleFragment(tp, frag, mech.name, variables);
}
```

And define `applyRuleFragment`:

```javascript
async function applyRuleFragment(tp, frag, sourceName, variables) {
  const adapter = tp.app.vault.adapter;
  const rulesPath = variables.rules_path;
  if (!rulesPath) {
    new Notice(`applyRuleFragment: rules_path not configured; skipping fragment from ${sourceName}`, 6000);
    return;
  }
  const target = frag.target; // e.g. "_global", "project"
  const rulePath = `${rulesPath}/${target}.json`;
  if (!(await adapter.exists(rulesPath))) await adapter.mkdir(rulesPath);
  let existing = {};
  if (await adapter.exists(rulePath)) {
    try {
      existing = JSON.parse(await adapter.read(rulePath));
    } catch (e) {
      existing = {};
    }
  }
  existing.contributions = existing.contributions || {};
  existing.contributions[sourceName] = frag.fragment;
  await adapter.write(rulePath, JSON.stringify(existing, null, 2));
}
```

**Step 3: Verify by inspection**

Read modified file. Confirm:
- `installItem` exists (no `installMechanism`).
- `applyRuleFragment` exists and writes namespaced under `contributions.<source>`.
- The main flow (from Task 1.3) calls `installItem` not `installMechanism`.

**Step 4: Commit (ask user)**

Suggested message: `feat(installer): add dep resolver, blueprint loop, rule_fragments materialization`

---

### Task 1.5: Update customjs-guard manifest's rule_fragments to JSON-object shape

**Files:**
- Modify: `WORKSHOP/platform/mechanisms/customjs-guard/manifest.json`

**Step 1: Read current contents**

Run: `cat WORKSHOP/platform/mechanisms/customjs-guard/manifest.json`
Expected: existing shape with `rule_fragments: [{ target: "_global", fragment: "<YAML string>" }]`.

**Step 2: Replace fragment string with JSON object**

Change the `rule_fragments` entry from:

```json
"rule_fragments": [
  {
    "target": "_global",
    "fragment": "forbid_dataviewjs_patterns:\n  - { pattern: \"await customJS\\\\.\", reason: \"use customjs-guard instead\" }\n"
  }
]
```

To:

```json
"rule_fragments": [
  {
    "target": "_global",
    "fragment": {
      "forbid_dataviewjs_patterns": [
        { "pattern": "await customJS\\.", "reason": "use customjs-guard instead" }
      ]
    }
  }
]
```

**Step 3: Verify**

Run: `cat WORKSHOP/platform/mechanisms/customjs-guard/manifest.json | python3 -m json.tool`
Expected: parses cleanly. The fragment is now a nested object, not a string.

**Step 4: Commit (ask user)**

Suggested message: `chore(customjs-guard): convert rule_fragments to JSON-object shape (was inert YAML string)`

---

### Task 1.6: Bump workshop_version in platform manifest

**Files:**
- Modify: `WORKSHOP/platform/manifest.json`

**Step 1: Update workshop_version**

Change `"workshop_version": "0.2.0"` to `"workshop_version": "0.3.0"`.

**Step 2: Verify**

Run: `cat WORKSHOP/platform/manifest.json | python3 -m json.tool | head -5`
Expected: `workshop_version` is `0.3.0`.

**Step 3: Commit (ask user)**

Suggested message: `chore(platform): bump workshop_version 0.2.0 -> 0.3.0`

---

### Task 1.7: Workshop self-install dogfood (HUMAN STEP)

**Files:** none (Obsidian-side action)

**Step 1: Surface to the user**

Tell the user:

> Open the workshop in Obsidian (`workshop/poc-vault`). Reload Templater user scripts. Open any note. Run Templater: Open Insert Template modal → `_install-platform`. Confirm:
> - No "Unsubstituted variables" Notice fires.
> - All three mechanisms re-install or are skipped as already-current (idempotent).
> - `Docs/Meta/rules/_global.json` is created with `contributions.customjs-guard.forbid_dataviewjs_patterns`.
> - Final Notice is `platformInstall: complete.`

**Step 2: Wait for user confirmation**

Do not proceed until user confirms green.

**Step 3: Verify (agent)**

Read `WORKSHOP/Docs/Meta/platform-installed.json` — confirm three mechanisms present (versions unchanged) + history reflects re-run.
Read `WORKSHOP/Docs/Meta/rules/_global.json` — confirm exists, parses, has `contributions.customjs-guard`.

**Step 4: If anything fails**

Investigate root cause; do NOT plough on. Common failure modes: missing variable in platform-config, JSON parse error in customjs-guard manifest, dep cycle (impossible with current setup).

---

### Task 1.8: Dep resolver negative test (workshop)

**Files:**
- Modify: `WORKSHOP/Docs/Meta/platform-subscription.json` (temporarily)

**Step 1: Pre-state snapshot**

Run: `cat WORKSHOP/Docs/Meta/platform-subscription.json` and record the output for restoration.

**Step 2: Add a synthetic depends_on for the negative test**

Temporarily edit `WORKSHOP/platform/mechanisms/audit/manifest.json` to add:

```json
"depends_on": [{ "name": "validator", "range": ">=99.0.0" }]
```

(Pin to `>=99.0.0` so the satisfied condition fails.)

**Step 3: Self-install (HUMAN)**

Tell the user:

> Re-run the workshop installer. Expected: a Notice saying "skipping audit — depends on validator >=99.0.0 but subscription pins validator@0.1.0". audit's `installed_at` in `platform-installed.json` should NOT change. A new history entry of `{ event: "skip", name: "audit", reason: "..." }` should appear.

**Step 4: Verify (agent)**

Read `WORKSHOP/Docs/Meta/platform-installed.json` — confirm history has skip entry.

**Step 5: Restore**

Revert the synthetic `depends_on` from audit's manifest.

**Step 6: Re-run installer (HUMAN)**

Tell the user to re-run. Confirm audit no longer skipped.

**Step 7: Verify (agent)**

Confirm history now has both the skip entry AND a subsequent install/no-op entry.

**Step 8: Commit (ask user)**

Suggested message: nothing — this task is verification only, no source change.

---

## Stage 2 — nav-buttons mechanism

### Task 2.1: Create platform/mechanisms/nav-buttons/ + space-nav-buttons.js

**Files:**
- Create: `WORKSHOP/platform/mechanisms/nav-buttons/space-nav-buttons.js`

**Step 1: Source the canonical SpaceNavButtons**

Run: `cat TMPACC/Docs/Meta/Scripts/space-nav-buttons.js`
Expected: a CustomJS class definition (`class SpaceNavButtons { … }` or similar pattern). Capture full contents.

**Step 2: Write to workshop**

Run: `mkdir -p WORKSHOP/platform/mechanisms/nav-buttons` then write the captured contents verbatim to `WORKSHOP/platform/mechanisms/nav-buttons/space-nav-buttons.js`.

**Step 3: Verify byte-identical**

Run: `diff TMPACC/Docs/Meta/Scripts/space-nav-buttons.js WORKSHOP/platform/mechanisms/nav-buttons/space-nav-buttons.js`
Expected: empty output (files identical).

**Step 4: Commit (ask user)**

Hold; commit at end of Task 2.2.

---

### Task 2.2: Create nav-buttons manifest.json

**Files:**
- Create: `WORKSHOP/platform/mechanisms/nav-buttons/manifest.json`

**Step 1: Write manifest**

```json
{
  "name": "nav-buttons",
  "version": "1.0.0",
  "description": "SpaceNavButtons — universal vault-level nav block consumed via customjs-guard.",
  "depends_on": [
    { "name": "customjs-guard", "range": ">=1.0.0" }
  ],
  "customjs_classes": ["SpaceNavButtons"],
  "files": [
    { "source": "space-nav-buttons.js", "dest": "{{scripts_path}}/nav-buttons/space-nav-buttons.js" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

**Step 2: Verify**

Run: `cat WORKSHOP/platform/mechanisms/nav-buttons/manifest.json | python3 -m json.tool`
Expected: parses cleanly.

**Step 3: Commit (ask user)**

Suggested message: `feat(nav-buttons): add v1.0.0 mechanism shipping SpaceNavButtons`

---

### Task 2.3: Register nav-buttons in workshop manifest

**Files:**
- Modify: `WORKSHOP/platform/manifest.json`

**Step 1: Add nav-buttons to mechanisms array**

Append `{ "name": "nav-buttons", "version": "1.0.0", "path": "mechanisms/nav-buttons" }` to the `mechanisms` array.

**Step 2: Verify**

Run: `cat WORKSHOP/platform/manifest.json | python3 -m json.tool`
Expected: `mechanisms` has four entries; last one is nav-buttons.

**Step 3: Commit (ask user)**

Suggested message: `chore(platform): register nav-buttons@1.0.0 in workshop manifest`

---

### Task 2.4: Subscribe workshop to nav-buttons

**Files:**
- Modify: `WORKSHOP/Docs/Meta/platform-subscription.json`

**Step 1: Add nav-buttons subscription**

Append `{ "name": "nav-buttons", "version": "1.0.0" }` to the `mechanisms` array.

**Step 2: Verify**

Run: `cat WORKSHOP/Docs/Meta/platform-subscription.json | python3 -m json.tool`
Expected: four mechanisms subscribed.

**Step 3: Commit (ask user)**

Suggested message: `chore(workshop): subscribe to nav-buttons@1.0.0`

---

### Task 2.5: Workshop self-install (HUMAN)

**Files:** none (Obsidian-side action)

**Step 1: Surface to the user**

Tell the user:

> Re-run the workshop installer. Confirm:
> - nav-buttons installs successfully.
> - `WORKSHOP/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` exists.
> - `platform-installed.json` records nav-buttons@1.0.0 with new install timestamp.

**Step 2: Verify (agent)**

```bash
ls WORKSHOP/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js
cat WORKSHOP/Docs/Meta/platform-installed.json | python3 -m json.tool
```

Expected: file exists; installed.json has nav-buttons@1.0.0.

---

### Task 2.6: Dep resolver negative tests (nav-buttons)

**Files:**
- Modify: `WORKSHOP/Docs/Meta/platform-subscription.json` (temporarily)

**Step 1: Test missing-dep skip**

Edit subscription to remove `customjs-guard` (just nav-buttons references it via depends_on >=1.0.0).

**Step 2: Self-install (HUMAN)**

Tell the user: re-run installer. Expected Notice: `skipping nav-buttons — depends on customjs-guard >=1.0.0 but it is not subscribed`.

**Step 3: Verify (agent)**

Read `platform-installed.json` history — confirm skip entry for nav-buttons.

**Step 4: Test version-range skip**

Restore customjs-guard subscription but pin its version to `0.5.0` (a version that doesn't exist in the workshop manifest — actually this triggers the "subscription pins X but workshop has Y" skip first; instead pin to a hypothetical `0.5.0` after first changing workshop manifest).

Simpler alternative: edit nav-buttons' manifest temporarily to require `customjs-guard >=99.0.0`. Re-run. Expected skip Notice for nav-buttons. Restore.

**Step 5: Restore subscription + manifest**

Revert all temporary changes.

**Step 6: Self-install one more time (HUMAN)**

Confirm green re-install.

---

### Task 2.7: Subscribe tmp-acc-vault to nav-buttons

**Files:**
- Modify: `TMPACC/Docs/Meta/platform-subscription.json`

**Step 1: Add new variables to tmp-acc-vault config**

First update `TMPACC/Docs/Meta/platform-config.json` to add the three new variables and `vault_identity`:

```json
{
  "_comment": "tmp-acc-vault test mirror config.",
  "workshop_relative_path": "../poc-vault",
  "vault_identity": "accuris",
  "variables": {
    "views_path": "Extras/Scripts",
    "templater_scripts_path": "Docs/Meta/Templater",
    "scripts_path": "Docs/Meta/Scripts",
    "rules_path": "Docs/Meta/rules",
    "templates_path": "Extras/Templates",
    "commands_path": "commands"
  }
}
```

(`vault_identity: "accuris"` because tmp-acc-vault is a mirror of accuris.)

**Step 2: Add nav-buttons subscription**

Append `{ "name": "nav-buttons", "version": "1.0.0" }` to the `mechanisms` array of `TMPACC/Docs/Meta/platform-subscription.json`.

**Step 3: Verify both files**

Run: `cat TMPACC/Docs/Meta/platform-config.json TMPACC/Docs/Meta/platform-subscription.json | python3 -m json.tool`
(Run separately per file.)
Expected: both parse.

---

### Task 2.8: tmp-acc-vault install + verification

**Files:** none (Obsidian-side action)

**Step 1: Surface to the user**

Tell the user:

> Switch to tmp-acc-vault in Obsidian. Reload Templater user scripts (the platformInstall.js it has is from before Stage 1; we need to update it).

Wait — first the user needs the new installer in tmp-acc-vault.

**Step 1.5: Update tmp-acc-vault's platformInstall.js bootstrap copy**

Run: `cp WORKSHOP/platform/install.js TMPACC/Docs/Meta/Templater/platformInstall.js`
Run: `diff WORKSHOP/platform/install.js TMPACC/Docs/Meta/Templater/platformInstall.js`
Expected: identical.

**Step 2: Surface to the user**

> In tmp-acc-vault Obsidian: Settings → Templater → User Script Functions → reload. Then run `_install-platform` template. Confirm nav-buttons installs.

**Step 3: Verify (agent)**

```bash
ls TMPACC/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js
diff TMPACC/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js WORKSHOP/platform/mechanisms/nav-buttons/space-nav-buttons.js
cat TMPACC/Docs/Meta/platform-installed.json | python3 -m json.tool
```

Expected: file exists, byte-identical to source, installed.json has nav-buttons@1.0.0.

---

### Task 2.9: Stage 2.5 cleanup of flat-file in tmp-acc-vault (HUMAN approval)

**Files:**
- Delete: `TMPACC/Docs/Meta/Scripts/space-nav-buttons.js`

**Step 1: Get user approval**

Surface:

> The original flat-file `TMPACC/Docs/Meta/Scripts/space-nav-buttons.js` is now superseded by `TMPACC/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js`. Both files define `class SpaceNavButtons`. CustomJS scans both, last-wins. Bodies are identical. Delete the flat-file?

**Step 2: On approval, delete**

Run: `rm TMPACC/Docs/Meta/Scripts/space-nav-buttons.js`

**Step 3: Verify**

Run: `ls TMPACC/Docs/Meta/Scripts/space-nav-buttons.js 2>&1`
Expected: "No such file".

**Step 4: Smoke test (HUMAN)**

Surface: in tmp-acc-vault, open any note that has the customjs-guard `await dv.view(...)` callsite. Confirm SpaceNavButtons still renders (it'll come from the namespaced location now).

**Step 5: Commit (ask user)**

Suggested message: `chore(tmp-acc-vault): remove deprecated flat-file space-nav-buttons.js (superseded by nav-buttons mechanism)`

---

## Stage 3 — project blueprint

### Task 3.1: Create platform/blueprints/project/ directory + helper files

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/helpers/{project-nav-buttons,planning-nav-buttons,planning-board-projects,project-workstreams,project-workstream-manager}.js`

**Step 1: Source canonical helpers from tmp-acc-vault**

Run: `mkdir -p WORKSHOP/platform/blueprints/project/helpers`
Run: `cp TMPACC/Docs/Meta/Scripts/{project-nav-buttons,planning-nav-buttons,planning-board-projects,project-workstreams,project-workstream-manager}.js WORKSHOP/platform/blueprints/project/helpers/`

**Step 2: Verify byte-identical**

Run:

```bash
for f in project-nav-buttons planning-nav-buttons planning-board-projects project-workstreams project-workstream-manager; do
  diff TMPACC/Docs/Meta/Scripts/$f.js WORKSHOP/platform/blueprints/project/helpers/$f.js && echo "$f IDENTICAL" || echo "$f DIFFERS"
done
```

Expected: all five "IDENTICAL".

**Step 3: Inspect each file for {{var}} placeholders**

Run: `grep -l "{{" WORKSHOP/platform/blueprints/project/helpers/*.js`
Expected: ideally empty. If any helper has hardcoded paths, flag for the user — they'll need to be templatized in a follow-up. For v0.1.0 we ship as-is and document any hardcoded paths as a known limitation.

**Step 4: Commit (ask user)**

Hold; commit at end of Task 3.6.

---

### Task 3.2: Create create-new-project template

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/templates/create-new-project.md`

**Step 1: Source from tmp-acc-vault**

Run: `mkdir -p WORKSHOP/platform/blueprints/project/templates`
Run: `cat TMPACC/Extras/Templates/create-new-project.md`
Capture contents.

**Step 2: Templatize hardcoded paths**

Inspect the template body. Replace any literal vault paths (e.g., `Extras/Templates/...`, `boards/planning/...`) with `{{templates_path}}/...`, `boards/planning/...` (the latter is the project layout, kept literal). Where the template references a Templater include (`tp.file.find_tfile("Extras/Templates/Foo.md")`), substitute `{{templates_path}}` for the leading path component.

**Step 3: Write to workshop**

Write the templatized contents to `WORKSHOP/platform/blueprints/project/templates/create-new-project.md`.

**Step 4: Verify**

Run: `cat WORKSHOP/platform/blueprints/project/templates/create-new-project.md`
Inspect: any remaining `Extras/Templates` references? If yes, replace.

**Step 5: Commit (ask user)**

Hold.

---

### Task 3.3: Create new-project slash command file

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/commands/new-project.md`

**Step 1: Inspect tmp-acc-vault's existing slash command convention**

Run: `ls TMPACC/commands/ 2>&1 || ls TMPACC/Cowork/commands/ 2>&1 || find TMPACC -maxdepth 2 -type d -name commands`
Locate where slash commands live in tmp-acc-vault. If none exist, the slash command runner convention may be QuickAdd-driven — check `TMPACC/.obsidian/plugins/quickadd/data.json` for command definitions.

**Step 2: Decide format based on findings**

- If `commands/<name>.md` files exist with frontmatter caption + body, use that format.
- If QuickAdd is the runner, register a QuickAdd entry instead — but this requires `.obsidian/` edits which need explicit user approval. Surface and ask.
- If neither exists, default to a Templater-style `commands/<name>.md` and document the convention in `Docs/use.md` as part of Stage 3 closeout.

**Step 3: Write file**

Sample default body (Templater-driven slash command):

```markdown
---
caption: New project
icon: lucide-folder-plus
---

<%*
const file = await tp.file.find_tfile("{{templates_path}}/Create New Project.md");
const folder = app.vault.getAbstractFileByPath("boards/planning");
await tp.file.create_new(file, "Untitled", true, folder);
%>
```

Write to `WORKSHOP/platform/blueprints/project/commands/new-project.md`.

**Step 4: Verify**

Run: `cat WORKSHOP/platform/blueprints/project/commands/new-project.md`
Inspect: frontmatter + Templater body.

**Step 5: Commit (ask user)**

Hold.

---

### Task 3.4: Create project rule.json

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/rule.json`

**Step 1: Write rule**

```json
{
  "schema_version": 1,
  "name": "project",
  "applies_to": {
    "frontmatter_tag_any_of": ["project"],
    "path_glob_any_of": ["boards/planning/*/*.md"]
  },
  "required_frontmatter": {
    "type": "project",
    "tags": ["project", "{{vault_identity_tag}}"],
    "status": ["active", "paused", "shipped", "shelved"]
  },
  "required_blocks": [
    { "kind": "dataviewjs", "must_call": "customJS.SpaceNavButtons", "via": "customjs-guard" },
    { "kind": "dataviewjs", "must_call": "customJS.ProjectNavButtons", "via": "customjs-guard" }
  ],
  "naming": {
    "folder": "boards/planning/<slug>/",
    "slug_from": "frontmatter.title",
    "slug_format": "kebab-case"
  },
  "auto_fixes": [
    { "when": "missing_frontmatter.type", "set": "project" },
    { "when": "missing_frontmatter.status", "set": "active" }
  ]
}
```

**Step 2: Verify**

Run: `cat WORKSHOP/platform/blueprints/project/rule.json | python3 -m json.tool`
Expected: parses.

**Step 3: Commit (ask user)**

Hold.

---

### Task 3.5: Create project variants.json

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/variants.json`

**Step 1: Write variants**

```json
{
  "schema_version": 1,
  "default_name": "project",
  "variants": {
    "accuris":   { "alias": "project",    "vault_identity_tag": "accuris" },
    "headspace": { "alias": "side-quest", "vault_identity_tag": "life" },
    "ero":       { "alias": "project",    "vault_identity_tag": null,    "path_root": "Projects" },
    "barebones": { "alias": "project",    "vault_identity_tag": "barebones" },
    "workshop":  { "alias": "project",    "vault_identity_tag": null,    "applies_in_workshop": false }
  }
}
```

**Step 2: Verify**

Run: `cat WORKSHOP/platform/blueprints/project/variants.json | python3 -m json.tool`
Expected: parses.

**Step 3: Commit (ask user)**

Hold.

---

### Task 3.6: Create project blueprint manifest

**Files:**
- Create: `WORKSHOP/platform/blueprints/project/manifest.json`

**Step 1: Write manifest**

```json
{
  "name": "project",
  "version": "0.1.0",
  "kind": "blueprint",
  "description": "Project note bundle — boards/planning/<slug>/ structure, planning board view, workstream manager, /new-project command.",
  "depends_on": [
    { "name": "nav-buttons",    "range": ">=1.0.0" },
    { "name": "customjs-guard", "range": ">=1.0.0" }
  ],
  "customjs_classes": [
    "ProjectNavButtons",
    "PlanningNavButtons",
    "PlanningBoardProjects",
    "ProjectWorkstreams",
    "ProjectWorkstreamManager"
  ],
  "files": [
    { "source": "rule.json",                              "dest": "{{rules_path}}/project.json" },
    { "source": "variants.json",                          "dest": "{{rules_path}}/project.variants.json" },
    { "source": "templates/create-new-project.md",        "dest": "{{templates_path}}/Create New Project.md" },
    { "source": "helpers/project-nav-buttons.js",         "dest": "{{scripts_path}}/project/project-nav-buttons.js" },
    { "source": "helpers/planning-nav-buttons.js",        "dest": "{{scripts_path}}/project/planning-nav-buttons.js" },
    { "source": "helpers/planning-board-projects.js",     "dest": "{{scripts_path}}/project/planning-board-projects.js" },
    { "source": "helpers/project-workstreams.js",         "dest": "{{scripts_path}}/project/project-workstreams.js" },
    { "source": "helpers/project-workstream-manager.js",  "dest": "{{scripts_path}}/project/project-workstream-manager.js" },
    { "source": "commands/new-project.md",                "dest": "{{commands_path}}/new-project.md" }
  ],
  "post_install": [
    { "type": "notice", "message": "Project blueprint installed. Reload Templater (user scripts) + reload CustomJS to register new classes." }
  ],
  "rule_fragments": []
}
```

**Step 2: Verify all blueprint files**

```bash
cat WORKSHOP/platform/blueprints/project/manifest.json | python3 -m json.tool
ls WORKSHOP/platform/blueprints/project/{rule.json,variants.json,manifest.json}
ls WORKSHOP/platform/blueprints/project/templates/create-new-project.md
ls WORKSHOP/platform/blueprints/project/commands/new-project.md
ls WORKSHOP/platform/blueprints/project/helpers/*.js
```

Expected: all listed.

**Step 3: Commit (ask user)**

Suggested message: `feat(project): add v0.1.0 project blueprint (rule + templates + helpers + slash command)`

---

### Task 3.7: Register project blueprint in workshop manifest

**Files:**
- Modify: `WORKSHOP/platform/manifest.json`

**Step 1: Add to blueprints array**

Replace `"blueprints": []` with:

```json
"blueprints": [
  { "name": "project", "version": "0.1.0", "path": "blueprints/project" }
]
```

**Step 2: Verify**

Run: `cat WORKSHOP/platform/manifest.json | python3 -m json.tool`
Expected: blueprints array has one entry.

**Step 3: Commit (ask user)**

Suggested message: `chore(platform): register project@0.1.0 blueprint in workshop manifest`

---

### Task 3.8: Subscribe workshop to project blueprint

**Files:**
- Modify: `WORKSHOP/Docs/Meta/platform-subscription.json`

**Step 1: Add project**

Replace `"blueprints": []` with `"blueprints": [{ "name": "project", "version": "0.1.0" }]`.

**Step 2: Verify**

Run: `cat WORKSHOP/Docs/Meta/platform-subscription.json | python3 -m json.tool`

**Step 3: Commit (ask user)**

Suggested message: `chore(workshop): subscribe to project@0.1.0`

---

### Task 3.9: Workshop self-install with project blueprint (HUMAN)

**Files:** none

**Step 1: Surface to the user**

> Re-run the workshop installer. Confirm:
> - Both nav-buttons (already installed) and project (new) succeed.
> - All eight blueprint files materialize in workshop:
>   - `Docs/Meta/rules/project.json`
>   - `Docs/Meta/rules/project.variants.json`
>   - `Docs/Meta/Templates/Create New Project.md`
>   - `Docs/Meta/Scripts/project/{project-nav-buttons,planning-nav-buttons,planning-board-projects,project-workstreams,project-workstream-manager}.js`
>   - `commands/new-project.md`
> - Final Notice: project blueprint installed.
> - `platform-installed.json` shows `project@0.1.0` under `blueprints[]`.

**Step 2: Verify (agent)**

```bash
ls WORKSHOP/Docs/Meta/rules/project.json WORKSHOP/Docs/Meta/rules/project.variants.json
ls WORKSHOP/Docs/Meta/Templates/"Create New Project.md"
ls WORKSHOP/Docs/Meta/Scripts/project/*.js
ls WORKSHOP/commands/new-project.md
cat WORKSHOP/Docs/Meta/platform-installed.json | python3 -m json.tool | grep -A1 blueprints
```

Expected: all listed; installed.json blueprint entry has project@0.1.0.

---

### Task 3.10: Subscribe tmp-acc-vault to project + run installer

**Files:**
- Modify: `TMPACC/Docs/Meta/platform-subscription.json`

**Step 1: Add project to subscription**

Replace `"blueprints": []` with `"blueprints": [{ "name": "project", "version": "0.1.0" }]`.

**Step 2: HUMAN — run installer**

> In tmp-acc-vault Obsidian: re-run installer. Confirm all blueprint files materialize at the consumer paths defined by `platform-config.json`.

**Step 3: Verify (agent)**

```bash
ls TMPACC/Docs/Meta/rules/project.json TMPACC/Docs/Meta/rules/project.variants.json
ls TMPACC/Extras/Templates/"Create New Project.md"
ls TMPACC/Docs/Meta/Scripts/project/*.js
ls TMPACC/commands/new-project.md
cat TMPACC/Docs/Meta/platform-installed.json | python3 -m json.tool | grep -A1 blueprints
```

Expected: all listed.

---

### Task 3.11: Smoke test create-new-project (HUMAN)

**Files:** none

**Step 1: Surface to the user**

> In tmp-acc-vault: command palette → Templater: Open Insert Template modal → "Create New Project". Fill any prompts. Confirm:
> - A new project note is created at `boards/planning/<slug>/<slug>.md`.
> - Frontmatter has `type: project`, `status: active`, `tags: [project, accuris]`.
> - Body has the two required dataviewjs blocks (SpaceNavButtons, ProjectNavButtons).

Capture any failure output and surface back.

**Step 2: Verify (agent)**

Read the new project note's frontmatter.

---

### Task 3.12: Validator smoke test (HUMAN + agent)

**Files:** none

**Step 1: Positive case**

Surface to user: open the project note created in Task 3.11, run `tp.user.validate(tp)`. Expected: PASS Notice.

**Step 2: Negative case**

Surface: edit the same project note's frontmatter, remove `status`. Re-run validator. Expected: FAIL Notice mentioning missing `status` field, then auto-fix sets it back to `active` (per the rule's auto_fixes). Confirm.

**Step 3: Capture results**

Both pass + fail-then-fix observed → Stage 3 validation green.

---

### Task 3.13: Stage 3.5 cleanup of flat-files in tmp-acc-vault (HUMAN approval)

**Files:**
- Delete: `TMPACC/Docs/Meta/Scripts/{project-nav-buttons,planning-nav-buttons,planning-board-projects,project-workstreams,project-workstream-manager}.js`

**Step 1: Get approval**

Surface:

> Same situation as Stage 2.5: five flat-files in `TMPACC/Docs/Meta/Scripts/` are now superseded by the namespaced versions in `Docs/Meta/Scripts/project/`. CustomJS double-registers; bodies identical. Delete the flat-files?

**Step 2: On approval, delete**

```bash
rm TMPACC/Docs/Meta/Scripts/{project-nav-buttons,planning-nav-buttons,planning-board-projects,project-workstreams,project-workstream-manager}.js
```

**Step 3: Verify**

Run: `ls TMPACC/Docs/Meta/Scripts/`
Expected: only `meetings-hub-cards.js`, `todo-dataview-blocks.js`, `space-daily-dashboard.js`, `new-meeting-button.js`, `add_component.sh`, `create_section.sh`, `nav-buttons/`, `project/` remain.

**Step 4: Smoke test (HUMAN)**

> Reopen a project note. Confirm SpaceNavButtons + ProjectNavButtons + planning board still render.

**Step 5: Commit (ask user)**

Suggested message: `chore(tmp-acc-vault): remove deprecated flat-file project helpers (superseded by project blueprint)`

---

## Stage 4 — barebones-vault from zero

### Task 4.1: Create barebones-vault directory

**Files:**
- Create: `BAREBONES/.obsidian/app.json`
- Create: `BAREBONES/Docs/Meta/Templater/` (directory)
- Create: `BAREBONES/Docs/Meta/Templates/` (directory)

**Step 1: Confirm doesn't already exist**

Run: `ls BAREBONES 2>&1`
Expected: "No such file or directory". If it exists, ask user before overwriting.

**Step 2: Create directories**

```bash
mkdir -p BAREBONES/Docs/Meta/Templater
mkdir -p BAREBONES/Docs/Meta/Templates
mkdir -p BAREBONES/.obsidian
```

**Step 3: Write minimal app.json**

Write `BAREBONES/.obsidian/app.json`:

```json
{}
```

(Empty object — Obsidian will populate on first open.)

**Step 4: Verify**

```bash
ls -la BAREBONES/
ls -la BAREBONES/.obsidian/
ls -la BAREBONES/Docs/Meta/
```

---

### Task 4.2: Write barebones platform-config.json

**Files:**
- Create: `BAREBONES/Docs/Meta/platform-config.json`

**Step 1: Write config**

```json
{
  "_comment": "barebones-vault — fresh sandbox for end-to-end onboarding regression tests.",
  "workshop_relative_path": "../poc-vault",
  "vault_identity": "barebones",
  "variables": {
    "views_path": "Docs/Meta/Views",
    "templater_scripts_path": "Docs/Meta/Templater",
    "scripts_path": "Docs/Meta/Scripts",
    "rules_path": "Docs/Meta/rules",
    "templates_path": "Docs/Meta/Templates",
    "commands_path": "commands"
  }
}
```

(Canonical paths — barebones has no legacy layout, so we use the cleanest mapping. `workshop_relative_path: "../poc-vault"` since barebones is at `workshop/barebones-vault` next to `workshop/poc-vault`.)

**Step 2: Verify**

Run: `cat BAREBONES/Docs/Meta/platform-config.json | python3 -m json.tool`

---

### Task 4.3: Write barebones platform-subscription.json

**Files:**
- Create: `BAREBONES/Docs/Meta/platform-subscription.json`

**Step 1: Write subscription**

```json
{
  "_comment": "barebones subscribes to all five v0.x platform items.",
  "workshop_version": "0.3.0",
  "mechanisms": [
    { "name": "customjs-guard", "version": "1.0.0" },
    { "name": "validator",      "version": "0.1.0" },
    { "name": "audit",          "version": "0.1.0" },
    { "name": "nav-buttons",    "version": "1.0.0" }
  ],
  "blueprints": [
    { "name": "project", "version": "0.1.0" }
  ]
}
```

**Step 2: Verify**

Run: `cat BAREBONES/Docs/Meta/platform-subscription.json | python3 -m json.tool`

---

### Task 4.4: Bootstrap installer + install template

**Files:**
- Create: `BAREBONES/Docs/Meta/Templater/platformInstall.js`
- Create: `BAREBONES/Docs/Meta/Templates/_install-platform.md`

**Step 1: Copy installer**

```bash
cp WORKSHOP/platform/install.js BAREBONES/Docs/Meta/Templater/platformInstall.js
diff WORKSHOP/platform/install.js BAREBONES/Docs/Meta/Templater/platformInstall.js
```

Expected: identical.

**Step 2: Copy install template**

```bash
cp WORKSHOP/Docs/Meta/Templates/_install-platform.md BAREBONES/Docs/Meta/Templates/_install-platform.md
diff WORKSHOP/Docs/Meta/Templates/_install-platform.md BAREBONES/Docs/Meta/Templates/_install-platform.md
```

Expected: identical.

---

### Task 4.5: Write barebones CLAUDE.md sandbox stub

**Files:**
- Create: `BAREBONES/CLAUDE.md`

**Step 1: Write stub**

```markdown
# CLAUDE.md — barebones-vault (regression sandbox)

> [!warning] This is a sandbox vault, NOT a consumer.
> The platform's permanent regression-test target. Used to validate end-to-end onboarding from absolute zero. Has NO personal content. Has NO Obsidian Sync. Re-runnable from scratch.

## Identity

- `vault_identity: "barebones"` (declared in `Docs/Meta/platform-config.json`).
- Sibling to `poc-vault` (workshop) and `tmp-acc-vault` under `workshop/`.

## What lives here

- `Docs/Meta/platform-{config,subscription,installed}.json` — consumer-side platform state.
- `Docs/Meta/Templater/` — installed user scripts.
- `Docs/Meta/Scripts/` — installed CustomJS classes.
- `Docs/Meta/Templates/` — installed Templater templates.
- `Docs/Meta/Views/` — installed Dataview views.
- `Docs/Meta/rules/` — installed rules + rule_fragments.
- `commands/` — installed slash commands.
- `.obsidian/snippets/` — installed CSS snippets (after first install).

## Don't

- Don't add personal content here.
- Don't add this vault to Obsidian Sync.
- Don't mutate `platform-installed.json` by hand.

## Re-running from scratch

To wipe + redo: delete `Docs/Meta/platform-installed.json` and any installed files, then re-run the installer.
```

**Step 2: Verify**

Run: `cat BAREBONES/CLAUDE.md | head -15`

---

### Task 4.6: Pre-flight verification (agent)

**Files:** none (read-only)

**Step 1: Check all bootstrap files**

```bash
ls BAREBONES/CLAUDE.md
ls BAREBONES/.obsidian/app.json
ls BAREBONES/Docs/Meta/platform-config.json
ls BAREBONES/Docs/Meta/platform-subscription.json
ls BAREBONES/Docs/Meta/Templater/platformInstall.js
ls BAREBONES/Docs/Meta/Templates/_install-platform.md
```

Expected: all listed, no errors.

**Step 2: Sanity-check JSON files parse**

```bash
for f in BAREBONES/Docs/Meta/platform-config.json BAREBONES/Docs/Meta/platform-subscription.json BAREBONES/.obsidian/app.json; do
  python3 -m json.tool < "$f" > /dev/null && echo "$f OK" || echo "$f BAD"
done
```

Expected: three OK lines.

**Step 3: Confirm install.js is byte-identical**

Run: `diff WORKSHOP/platform/install.js BAREBONES/Docs/Meta/Templater/platformInstall.js`
Expected: empty.

---

### Task 4.7: HUMAN — Obsidian-side setup + first install

**Files:** none

**Step 1: Surface to the user**

```
Phase 4 (HUMAN): in Obsidian, do the following IN ORDER:

  1. File -> Open Vault -> point to workshop/barebones-vault.
  2. Settings -> Community plugins -> Turn ON.
  3. Browse + install + enable: Templater, Dataview, CustomJS.
  4. Templater settings:
     - "Template folder location"     = Docs/Meta/Templates
     - "Script files folder location" = Docs/Meta/Templater
  5. CustomJS settings:
     - "JS files folder" = Docs/Meta/Scripts
  6. Dataview settings:
     - "Enable JavaScript queries" = ON
  7. Settings -> Templater -> "User Script Functions" -> Reload.
  8. Open any note (or create scratch note + click in).
  9. Command palette -> "Templater: Open Insert Template modal" -> _install-platform.
 10. Approve gates as they fire (CSS snippet write + appearance.json edit).
 11. Final Notice: "platformInstall: complete."
 12. Settings -> Templater -> "User Script Functions" -> Reload (again, to register validate / hook-validate / audit-walker).

Stop and report any error messages.
```

**Step 2: Wait for user confirmation**

Do not proceed until user confirms green.

---

### Task 4.8: Verification — every item materialized (agent)

**Files:** none (read-only)

**Step 1: Run full verification**

```bash
echo "=== platform-installed ==="
cat BAREBONES/Docs/Meta/platform-installed.json | python3 -m json.tool

echo "=== mechanisms files ==="
ls BAREBONES/Docs/Meta/Templater/{platformInstall,validate,hook-validate,audit-walker}.js
ls BAREBONES/Docs/Meta/Views/customjs-guard/view.js
ls BAREBONES/.obsidian/snippets/customjs-loader.css
ls BAREBONES/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js

echo "=== blueprint files ==="
ls BAREBONES/Docs/Meta/rules/project.json
ls BAREBONES/Docs/Meta/rules/project.variants.json
ls BAREBONES/Docs/Meta/rules/_global.json
ls BAREBONES/Docs/Meta/Templates/"Create New Project.md"
ls BAREBONES/Docs/Meta/Scripts/project/*.js
ls BAREBONES/commands/new-project.md

echo "=== appearance.json ==="
cat BAREBONES/.obsidian/appearance.json | python3 -m json.tool
```

Expected: all 17+ files present; appearance.json has `customjs-loader` in `enabledCssSnippets`; platform-installed.json has 4 mechanisms + 1 blueprint.

**Step 2: Check for unsubstituted placeholders in any installed file**

```bash
grep -rn "{{" BAREBONES/Docs/Meta/{Scripts,Templater,Templates,rules,Views} BAREBONES/commands 2>&1 | grep -v "Binary"
```

Expected: empty (no unsubstituted `{{var}}` strings in any installed file).

**Step 3: Check skip history**

```bash
cat BAREBONES/Docs/Meta/platform-installed.json | python3 -c "import json,sys; d=json.load(sys.stdin); print([h for h in d.get('history',[]) if h.get('event')=='skip'])"
```

Expected: empty list.

---

### Task 4.9: Smoke tests (HUMAN)

**Files:** none

**Step 1: Surface tests**

```
Three smoke tests in barebones Obsidian:

  1. customjs-guard cold-load: open any note, paste:

       ```dataviewjs
       await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
       ```

     Expected: nav buttons render with no red flash. Reload the vault and re-confirm.

  2. /new-project: command palette -> "Templater: Open Insert Template modal" -> "Create New Project".
     Expected: a project note lands at boards/planning/<slug>/<slug>.md with required frontmatter +
     dataviewjs blocks rendering correctly.

  3. audit-walker: paste into a note + run "Templater: Replace templates in active file":

       <%* await tp.user["audit-walker"](tp) %>

     Expected: a report file appears at Timestamps/Audits/YYYY-MM-DD-audit.md.

Stop and report any failure.
```

**Step 2: Wait for user confirmation**

---

### Task 4.10: Result writeup

**Files:**
- Create: `WORKSHOP/Docs/plans/2026-05-02-barebones-onboarding-result.md`

**Step 1: Write outcome doc**

Capture: what worked, what was rough, any unexpected behavior, any new landmines discovered. Template:

```markdown
---
date: 2026-05-02
phase: result
related:
  - 2026-05-02-nav-buttons-and-project-blueprint-design.md
  - 2026-05-02-nav-buttons-and-project-blueprint-plan.md
---

# Barebones-vault onboarding — result

> [!success] Outcome
> [single-sentence summary]

## What worked

- ...

## What was rough

- ...

## New landmines (add to Docs/landmines.md)

- ...

## Disposition

barebones-vault retained at workshop/barebones-vault/ as the platform's regression-test target.
```

Fill in based on the user's reported observations from Tasks 4.7–4.9.

**Step 2: Commit (ask user)**

Suggested message: `docs: capture barebones-vault onboarding result`

---

### Task 4.11: Update Docs/use.md with regression-test entry

**Files:**
- Modify: `WORKSHOP/Docs/use.md`

**Step 1: Add regression-test section**

Append a new section at the end of `Docs/use.md`:

```markdown
## Pre-promotion regression test

Before promoting any new mechanism or blueprint to consumers, re-run the barebones-vault onboarding from a clean slate:

1. Delete `workshop/barebones-vault/Docs/Meta/platform-installed.json`.
2. Delete the materialized files (Docs/Meta/Scripts/, Docs/Meta/Templater/{validate,hook-validate,audit-walker}.js, Docs/Meta/Views/, Docs/Meta/Templates/, Docs/Meta/rules/, commands/).
3. Reload Templater user scripts in barebones Obsidian.
4. Run `_install-platform`.
5. Verify: every subscribed item materializes; zero skip entries; smoke tests pass.

If barebones onboarding fails, do NOT promote to real consumers. Investigate and fix in workshop first.
```

**Step 2: Verify**

Run: `tail -20 WORKSHOP/Docs/use.md`

**Step 3: Commit (ask user)**

Suggested message: `docs(use): add pre-promotion regression-test procedure`

---

## Final acceptance

> [!success] Implementation done when…
> - All Stage 1 tasks complete; workshop self-install green at version 0.3.0.
> - All Stage 2 tasks complete; nav-buttons installed in workshop + tmp-acc-vault; flat-file cleanup done.
> - All Stage 3 tasks complete; project blueprint installed in workshop + tmp-acc-vault; create-new-project + validator smoke tests pass.
> - All Stage 4 tasks complete; barebones-vault onboarded from zero; result writeup committed; use.md updated.
> - Zero skip entries in any vault's `platform-installed.json` history (other than the deliberate negative tests, which were also reverted).

> [!info] Out of scope reminders
> - Real accuris onboarding — gated on barebones success, separate plan.
> - Headspace + ERO — further downstream.
> - Uninstall mechanic — `contributions.<source>` namespacing makes it possible later; not built here.
> - Caret/tilde/wildcard version ranges — minimal range syntax is documented limitation.
> - Mobile support — desktop-only.
