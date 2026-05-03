# Vault Platform Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Stand up a workshop vault POC at `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault` containing the customjs-guard mechanism, the validator + Templater hook, the audit walker, and the `tp.user.platformInstall` installer. Then integrate the platform into the accuris vault as Phase 1, leaving ero and headspace as follow-up plans.

**Architecture:** Per design doc `Docs/plans/2026-05-02-vault-platform-design.md`. Workshop vault is canonical platform host. Consumer vaults declare a subscription, run the installer, get materialized copies of mechanisms with vault-specific path substitution. No canonical-path migration in this plan — installer adapts to existing consumer paths via `platform-config.yml`. Canonical migration is a follow-up plan.

**Tech Stack:** Templater (user scripts, hooks), Dataview (view files), CustomJS (consumer-side guarded callsites only — workshop ships no class files), js-yaml (parsing rule files), Obsidian Sync (cross-machine vault delivery). All work happens via Obsidian + filesystem; no Node build step.

**Reference docs the implementing agent must read first:**
1. `Docs/plans/2026-05-02-customjs-guard-rollout.md` — pattern + five landmines.
2. `Docs/plans/2026-05-02-vault-platform-design.md` — concepts (mechanisms, blueprints, subscriptions, installer).
3. `Extras/Scripts/customjs-guard/view.js` — the proven helper this plan ports to the workshop.
4. `.obsidian/snippets/customjs-loader.css` — the proven loader CSS.

---

## Conventions used in this plan

- **Bash commands** assume cwd is `/Users/willfell/Documents/obsidian/sync/`. Each task that changes cwd says so.
- **YAML and JS file contents** are given in full in the task. No "add validation here" placeholders.
- **Verify** steps describe how to confirm behavior in Obsidian itself (the only realistic test harness for Templater + Dataview).
- **Commit** steps assume each consumer vault has been `git init`-ed in Phase 0. Workshop vault gets `git init` in Task 2.
- **Approval gate** marker means: stop, show the user the diff, wait for explicit approval before applying.

---

## Phase 0 — Backups + git baseline

### Task 1: Snapshot the three consumer vaults

**Files:** none — filesystem only.

**Step 1: Create a backups directory**

```bash
mkdir -p ~/vault-backups/2026-05-02-pre-platform
```

**Step 2: Tar each vault**

```bash
cd /Users/willfell/Documents/obsidian/sync
tar -czf ~/vault-backups/2026-05-02-pre-platform/accuris.tar.gz accuris
tar -czf ~/vault-backups/2026-05-02-pre-platform/headspace.tar.gz headspace
tar -czf ~/vault-backups/2026-05-02-pre-platform/ero.tar.gz ero
```

**Step 3: Verify**

```bash
ls -lh ~/vault-backups/2026-05-02-pre-platform/
```

Expected: three `.tar.gz` files, each tens of MB to low GB.

**Step 4: Commit nothing — this is purely a snapshot.**

---

### Task 2: Initialize git in each vault if not already

**Step 1: Per vault, check + init**

```bash
for v in accuris headspace ero; do
  cd /Users/willfell/Documents/obsidian/sync/$v
  if [ ! -d .git ]; then
    git init
    echo ".obsidian/workspace*" > .gitignore
    echo ".trash/" >> .gitignore
    git add .gitignore
    git commit -m "chore: initialize git for vault baseline"
  fi
  git add -A
  git commit -m "chore: pre-platform-rollout baseline" --allow-empty
done
```

**Step 2: Verify each vault has a "pre-platform-rollout baseline" commit**

```bash
for v in accuris headspace ero; do
  echo "=== $v ==="
  cd /Users/willfell/Documents/obsidian/sync/$v
  git log --oneline -1
done
```

Expected: each shows the baseline commit.

---

## Phase 1 — Workshop vault creation

### Task 3: Create the workshop POC directory and register with Obsidian

**Files:**
- Create: `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault/.obsidian/` (Obsidian creates this on first open)

**Step 1: Make the parent dir and the vault dir**

```bash
mkdir -p /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
```

**Step 2: Open the vault in Obsidian**

In Obsidian: File → Open vault → Open folder as vault → select `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`. This causes Obsidian to populate `.obsidian/`.

**Step 3: Verify**

```bash
ls -la /Users/willfell/Documents/obsidian/sync/workshop/poc-vault/.obsidian
```

Expected: directory exists with `app.json`, `appearance.json`, etc.

**Step 4: Configure Obsidian Sync**

In Obsidian: Settings → Core plugins → enable Sync. Settings → Sync → choose "Set up new remote vault" → name it `workshop`. Confirm.

**Step 5: Install the same plugin set as the other vaults (manual)**

Settings → Community plugins → enable. Install: Templater, Dataview, CustomJS, QuickAdd. Match versions to the other vaults if possible. Configure Templater's "Script files folder" to `Docs/Meta/Templater/`. Configure CustomJS's `jsFolder` to `Docs/Meta/Scripts/`.

**Step 6: Initialize git**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
git init
echo ".obsidian/workspace*" > .gitignore
echo ".trash/" >> .gitignore
git add -A
git commit -m "chore: initialize workshop POC vault"
```

---

### Task 4: Write workshop CLAUDE.md

**Files:**
- Create: `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault/CLAUDE.md`

**Step 1: Write the file**

```markdown
# CLAUDE.md — Workshop POC

This is the **workshop vault** — the canonical home for vault-platform mechanisms and blueprints. It contains NO personal content.

## Vault identity check

Before any write, run `ls /Users/willfell/Documents/obsidian/sync/workshop/poc-vault`. Expected top-level: `CLAUDE.md`, `platform/`, `commands/`, `Docs/`. If you see `Boards/`, `Timestamps/`, `Finance/`, `Resources/`, you are in a CONSUMER vault, NOT the workshop. STOP.

## Purpose

- Author + iterate mechanisms (cross-cutting code: customjs-guard, validator, audit, installer).
- Author + iterate blueprints (note-type bundles: project, daily, invoice, todo-card).
- Tag versions in `platform/manifest.yml`.
- Consumer vaults pull from here via `tp.user.platformInstall()` on demand.

## Non-negotiables

- No personal content. If you find yourself writing a daily note here, you're in the wrong vault.
- All mechanisms are versioned in `platform/manifest.yml`. Bump the version on any change.
- All file paths in mechanism code use `{{template_variables}}`, not hardcoded paths. The installer substitutes per-vault.
- The five customjs-guard landmines from `accuris/Docs/plans/2026-05-02-customjs-guard-rollout.md` apply to every Dataview view written in this workshop.

## Directory map

- `platform/manifest.yml` — version catalogue.
- `platform/install.js` — the installer (Templater user-script).
- `platform/mechanisms/<name>/` — cross-cutting code.
- `platform/blueprints/<name>/` — note-type bundles.
- `platform/rule-schemas/` — JSON Schema for rule files.
- `commands/` — master copy of slash commands.
- `Docs/plans/` — design + implementation docs.

## Reference

- Design: see `accuris/Docs/plans/2026-05-02-vault-platform-design.md`.
- Implementation plan: see `accuris/Docs/plans/2026-05-02-vault-platform-implementation.md`.
```

**Step 2: Commit**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
git add CLAUDE.md
git commit -m "docs: add workshop CLAUDE.md identifying purpose and non-negotiables"
```

---

### Task 5: Create the platform skeleton

**Files:**
- Create: `platform/manifest.yml`
- Create: `platform/mechanisms/.gitkeep`
- Create: `platform/blueprints/.gitkeep`
- Create: `platform/rule-schemas/.gitkeep`
- Create: `Docs/plans/.gitkeep`

**Step 1: Make directories**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
mkdir -p platform/mechanisms platform/blueprints platform/rule-schemas Docs/plans commands
touch platform/mechanisms/.gitkeep platform/blueprints/.gitkeep platform/rule-schemas/.gitkeep Docs/plans/.gitkeep commands/.gitkeep
```

**Step 2: Write `platform/manifest.yml`**

```yaml
# Workshop platform manifest.
# Version is the workshop's overall release version. Each mechanism + blueprint has its own version.

workshop_version: 0.1.0
date: 2026-05-02

mechanisms: []
blueprints: []
```

(Empty for now. Mechanisms and blueprints will be added as they're built.)

**Step 3: Commit**

```bash
git add platform/ Docs/ commands/
git commit -m "chore: scaffold workshop platform skeleton"
```

---

## Phase 2 — Port customjs-guard mechanism

### Task 6: Create the customjs-guard mechanism directory and copy view.js

**Files:**
- Create: `platform/mechanisms/customjs-guard/view.js`
- Create: `platform/mechanisms/customjs-guard/loader.css`
- Create: `platform/mechanisms/customjs-guard/manifest.yml`
- Create: `platform/mechanisms/customjs-guard/install.yml`

**Step 1: Make the directory**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
mkdir -p platform/mechanisms/customjs-guard
```

**Step 2: Copy view.js verbatim from accuris**

```bash
cp /Users/willfell/Documents/obsidian/sync/accuris/Extras/Scripts/customjs-guard/view.js \
   platform/mechanisms/customjs-guard/view.js
```

The body is path-agnostic — uses `window.customJS?.[className]` only. No substitution needed.

**Step 3: Copy loader.css verbatim from accuris**

```bash
cp /Users/willfell/Documents/obsidian/sync/accuris/.obsidian/snippets/customjs-loader.css \
   platform/mechanisms/customjs-guard/loader.css
```

**Step 4: Write `manifest.yml`** for this mechanism:

```yaml
name: customjs-guard
version: 1.0.0
description: Polling guard for CustomJS callsites that prevents cold-load ReferenceError flashes.
files:
  - { source: view.js, dest: "{{views_path}}/customjs-guard/view.js" }
  - { source: loader.css, dest: ".obsidian/snippets/customjs-loader.css", approval: required }
post_install:
  - { type: enable_snippet, snippet: customjs-loader, approval: required }
rule_fragments:
  - target: _global
    fragment: |
      forbid_dataviewjs_patterns:
        - { pattern: "await customJS\\.", reason: "use customjs-guard instead" }
```

**Step 5: Verify view.js is unchanged from accuris source**

```bash
diff /Users/willfell/Documents/obsidian/sync/accuris/Extras/Scripts/customjs-guard/view.js \
     platform/mechanisms/customjs-guard/view.js
```

Expected: no output (files identical).

**Step 6: Commit**

```bash
git add platform/mechanisms/customjs-guard/
git commit -m "feat: port customjs-guard mechanism into workshop"
```

---

### Task 7: Register customjs-guard in the workshop manifest

**Files:**
- Modify: `platform/manifest.yml`

**Step 1: Update manifest**

Replace the `mechanisms: []` line with:

```yaml
mechanisms:
  - { name: customjs-guard, version: 1.0.0, path: mechanisms/customjs-guard }
```

**Step 2: Verify YAML parses**

```bash
python3 -c "import yaml; print(yaml.safe_load(open('platform/manifest.yml')))"
```

Expected: dict prints with `mechanisms` containing one entry.

**Step 3: Commit**

```bash
git add platform/manifest.yml
git commit -m "feat: register customjs-guard 1.0.0 in workshop manifest"
```

---

## Phase 3 — Validator mechanism

### Task 8: Scaffold the validator mechanism

**Files:**
- Create: `platform/mechanisms/validator/validate.js`
- Create: `platform/mechanisms/validator/hook.js`
- Create: `platform/mechanisms/validator/manifest.yml`

**Step 1: Make the directory**

```bash
mkdir -p platform/mechanisms/validator
```

**Step 2: Write `validate.js` skeleton** (Templater user-script — runs as `tp.user.validate`):

```javascript
// validate.js — vault-platform validator.
// Usage from a template:
//   <%* const result = await tp.user.validate(tp.file, "project");
//       if (result.violations.length) console.log(result.violations); %>
//
// Usage from a hook (preferred):
//   tp.hooks.on_all_templates_executed(async () => {
//     const file = tp.config.target_file;
//     const result = await tp.user.validate(file);
//     /* hook applies fixes + surfaces violations */
//   });
//
// Returns: { fixes: [{file, op, before, after}], violations: [{rule, severity, message}] }

module.exports = async function (tpFile, moduleId) {
  const app = this.app || window.app;
  const result = { fixes: [], violations: [] };

  // 1. Resolve TFile from input (Templater passes a TFile in tp.file).
  const file = tpFile.file ?? tpFile;
  if (!file || !file.path) {
    result.violations.push({ rule: "internal", severity: "error", message: "validate: invalid file argument" });
    return result;
  }

  // 2. Read frontmatter via Obsidian metadata cache.
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter ?? {};

  // 3. Resolve moduleId (argument > frontmatter.module > "_global").
  const resolvedModule = moduleId || fm.module || null;

  // 4. Load rules.
  const rulesPath = "Docs/Meta/rules";
  const globalRule = await loadRule(app, rulesPath, "_global");
  const moduleRule = resolvedModule ? await loadRule(app, rulesPath, resolvedModule) : null;

  if (!globalRule) {
    result.violations.push({ rule: "internal", severity: "warn", message: "validate: _global.yml not found; skipping" });
    return result;
  }

  // 5. Run rule checks.
  const ctx = { file, fm, body: await app.vault.read(file), result };
  await checkFrontmatter(ctx, globalRule, moduleRule);
  await checkTags(ctx, globalRule, moduleRule);
  await checkRequiredBlocks(ctx, globalRule, moduleRule);
  await checkForbiddenPatterns(ctx, globalRule, moduleRule);
  await checkNamingPattern(ctx, globalRule, moduleRule);

  return result;
};

async function loadRule(app, rulesPath, name) {
  const tfile = app.vault.getAbstractFileByPath(`${rulesPath}/${name}.yml`);
  if (!tfile) return null;
  const text = await app.vault.read(tfile);
  // Workshop validator depends on a YAML parser. Until one is installed, accept JSON.
  // Phase 4 swaps this for a real YAML parser via Templater's CommonJS require.
  try { return YAML.parse(text); } catch (e) { return null; }
}

// Stubs — implementations follow in Tasks 9-12.
async function checkFrontmatter(ctx, gr, mr) { /* Task 9 */ }
async function checkTags(ctx, gr, mr) { /* Task 10 */ }
async function checkRequiredBlocks(ctx, gr, mr) { /* Task 11 */ }
async function checkForbiddenPatterns(ctx, gr, mr) { /* Task 12 */ }
async function checkNamingPattern(ctx, gr, mr) { /* Task 12 */ }
```

**Step 3: Write `manifest.yml` for validator**

```yaml
name: validator
version: 0.1.0
description: Rule-engine validator + Templater hook handler. Reads Docs/Meta/rules/* and validates a file.
files:
  - { source: validate.js, dest: "{{templater_scripts_path}}/validate.js" }
  - { source: hook.js, dest: "{{templater_scripts_path}}/hook-validate.js" }
post_install:
  - { type: notice, message: "Reload Templater after install (Settings → Templater → reload user scripts)." }
```

**Step 4: Verify validate.js loads in Templater**

In a workshop test note, paste:

````markdown
```dataviewjs
// validator smoke test — only checks loadability
console.log(typeof tp); // tp is undefined here, but template fires would have it
dv.paragraph("validator scaffold present");
```
````

This is a no-op smoke check. Real validation tests come after Tasks 9-12.

**Step 5: Commit**

```bash
git add platform/mechanisms/validator/
git commit -m "feat: scaffold validator mechanism with rule loader and check stubs"
```

---

### Task 9: Implement `checkFrontmatter`

**Files:**
- Modify: `platform/mechanisms/validator/validate.js` — replace the `checkFrontmatter` stub.

**Step 1: Implement**

Replace the `async function checkFrontmatter(ctx, gr, mr) { /* Task 9 */ }` stub with:

```javascript
async function checkFrontmatter(ctx, gr, mr) {
  const required = { ...(gr.required_frontmatter || {}), ...((mr || {}).required_frontmatter || {}) };
  for (const [key, spec] of Object.entries(required)) {
    if (spec.required && (ctx.fm[key] === undefined || ctx.fm[key] === null || ctx.fm[key] === "")) {
      ctx.result.violations.push({
        rule: `required_frontmatter.${key}`,
        severity: "error",
        message: `Missing required frontmatter field: ${key}`,
      });
    }
    if (spec.type && ctx.fm[key] !== undefined) {
      const actual = Array.isArray(ctx.fm[key]) ? "array" : typeof ctx.fm[key];
      if (actual !== spec.type && !(spec.type === "datetime" && actual === "string")) {
        ctx.result.violations.push({
          rule: `required_frontmatter.${key}.type`,
          severity: "warn",
          message: `Field ${key} should be ${spec.type}, got ${actual}`,
        });
      }
    }
  }
}
```

**Step 2: Verify** by writing a test rule + test file (skip until Task 13 wires the rules folder); for now, commit and move on.

**Step 3: Commit**

```bash
git add platform/mechanisms/validator/validate.js
git commit -m "feat(validator): implement frontmatter required + type checks"
```

---

### Task 10: Implement `checkTags`

**Files:**
- Modify: `platform/mechanisms/validator/validate.js` — replace the `checkTags` stub.

**Step 1: Implement**

```javascript
async function checkTags(ctx, gr, mr) {
  const required = [...((gr.required_tags) || []), ...(((mr || {}).required_tags) || [])];
  const tags = Array.isArray(ctx.fm.tags) ? ctx.fm.tags : [];

  for (const spec of required) {
    const tag = spec.tag;
    if (tag.includes("{{")) continue; // template variable; resolved at install, not validation
    const idx = tags.indexOf(tag);
    if (idx === -1) {
      ctx.result.violations.push({
        rule: "required_tags.missing",
        severity: "error",
        message: `Missing required tag: ${tag}`,
      });
      ctx.result.fixes.push({ file: ctx.file, op: "add_tag", value: tag, position: spec.position });
      continue;
    }
    if (spec.position !== undefined && spec.position >= 0 && idx !== spec.position) {
      ctx.result.violations.push({
        rule: "required_tags.position",
        severity: "warn",
        message: `Tag ${tag} should be at position ${spec.position}, found at ${idx}`,
      });
      ctx.result.fixes.push({ file: ctx.file, op: "move_tag", value: tag, to: spec.position });
    }
    if (spec.pattern) {
      // Date tags: pattern is "YYYY/MM/DD" — convert to regex.
      const re = new RegExp(spec.pattern.replace("YYYY", "\\d{4}").replace("MM", "\\d{2}").replace("DD", "\\d{2}"));
      if (!re.test(tag)) {
        ctx.result.violations.push({
          rule: "required_tags.pattern",
          severity: "warn",
          message: `Tag ${tag} does not match pattern ${spec.pattern}`,
        });
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add platform/mechanisms/validator/validate.js
git commit -m "feat(validator): implement tag presence + position + pattern checks"
```

---

### Task 11: Implement `checkRequiredBlocks`

**Files:**
- Modify: `platform/mechanisms/validator/validate.js` — replace the `checkRequiredBlocks` stub.

**Step 1: Implement**

```javascript
async function checkRequiredBlocks(ctx, gr, mr) {
  const required = [...((gr.required_blocks) || []), ...(((mr || {}).required_blocks) || [])];
  for (const spec of required) {
    if (spec.when) {
      // crude evaluator: only support "frontmatter.X != 'Y'" / "frontmatter.X == 'Y'"
      const m = spec.when.match(/^frontmatter\.(\w+)\s*(==|!=)\s*['"]([^'"]+)['"]$/);
      if (m) {
        const [, key, op, val] = m;
        const actual = ctx.fm[key];
        const matches = op === "==" ? actual === val : actual !== val;
        if (!matches) continue;
      }
    }
    const fence = spec.type === "dataviewjs" ? "```dataviewjs" : "```" + spec.type;
    const blocks = ctx.body.split("\n```").map(b => b.trim()).filter(b => b);
    const expectedSnippet = spec.content;
    const present = ctx.body.includes(expectedSnippet);
    if (!present) {
      ctx.result.violations.push({
        rule: "required_blocks.missing",
        severity: "error",
        message: `Missing required ${spec.type} block containing: ${expectedSnippet.slice(0, 80)}`,
      });
    }
  }
}
```

**Step 2: Commit**

```bash
git add platform/mechanisms/validator/validate.js
git commit -m "feat(validator): implement required-blocks check with conditional 'when'"
```

---

### Task 12: Implement `checkForbiddenPatterns` + `checkNamingPattern`

**Files:**
- Modify: `platform/mechanisms/validator/validate.js`

**Step 1: Implement**

```javascript
async function checkForbiddenPatterns(ctx, gr, mr) {
  const patterns = [...((gr.forbid_dataviewjs_patterns) || []), ...(((mr || {}).forbid_dataviewjs_patterns) || [])];
  for (const spec of patterns) {
    const re = new RegExp(spec.pattern);
    // Walk dataviewjs blocks only; skip prose.
    const dvjsBlocks = [...ctx.body.matchAll(/```dataviewjs\n([\s\S]*?)\n```/g)].map(m => m[1]);
    for (const block of dvjsBlocks) {
      if (re.test(block)) {
        ctx.result.violations.push({
          rule: "forbid_dataviewjs_patterns",
          severity: "error",
          message: `Forbidden pattern matched in dataviewjs: ${spec.pattern} — ${spec.reason || "(no reason given)"}`,
        });
      }
    }
  }
}

async function checkNamingPattern(ctx, gr, mr) {
  const pattern = (mr || {}).naming_pattern;
  if (!pattern) return;
  // Pattern syntax: "{Title Case Title}.md" — for now, only enforce ".md" + non-empty basename.
  const basename = ctx.file.basename;
  if (!basename || basename.length === 0) {
    ctx.result.violations.push({ rule: "naming_pattern", severity: "error", message: "Empty basename" });
  }
}
```

**Step 2: Commit**

```bash
git add platform/mechanisms/validator/validate.js
git commit -m "feat(validator): implement forbidden-pattern + naming-pattern checks"
```

---

### Task 13: Write the Templater hook handler

**Files:**
- Create: `platform/mechanisms/validator/hook.js`

**Step 1: Implement**

```javascript
// hook.js — Templater on_all_templates_executed handler.
// Wired into a startup template (Task 24) or invoked from each template's <%* %> tag.

module.exports = async function (tp) {
  tp.hooks.on_all_templates_executed(async () => {
    try {
      const file = tp.config.target_file;
      if (!file) return;
      const result = await tp.user.validate(tp);
      // Apply auto-fixes (tag inserts, tag reorders).
      for (const fix of result.fixes || []) {
        await applyFix(tp, fix);
      }
      if ((result.violations || []).length) {
        const msg = result.violations.map(v => `[${v.severity}] ${v.rule}: ${v.message}`).join("\n");
        new Notice("Vault-platform validator:\n" + msg, 8000);
        await appendLintQueue(tp, file, result.violations);
      }
    } catch (e) {
      new Notice("Validator hook error: " + e.message, 6000);
      console.error(e);
    }
  });
};

async function applyFix(tp, fix) {
  if (fix.op === "add_tag" || fix.op === "move_tag") {
    await tp.app.fileManager.processFrontMatter(fix.file, (fm) => {
      fm.tags = Array.isArray(fm.tags) ? fm.tags.filter(t => t !== fix.value) : [];
      const pos = (fix.position === undefined || fix.position < 0) ? fm.tags.length : fix.position;
      fm.tags.splice(pos, 0, fix.value);
    });
  }
}

async function appendLintQueue(tp, file, violations) {
  const path = "Docs/Meta/_lint-queue.yml";
  let existing = "";
  const tfile = tp.app.vault.getAbstractFileByPath(path);
  if (tfile) existing = await tp.app.vault.read(tfile);
  const entry = `\n- file: "${file.path}"\n  date: "${new Date().toISOString()}"\n  violations:\n` +
    violations.map(v => `    - { rule: "${v.rule}", severity: "${v.severity}", message: ${JSON.stringify(v.message)} }`).join("\n");
  if (tfile) {
    await tp.app.vault.modify(tfile, existing + entry);
  } else {
    await tp.app.vault.create(path, "# Vault lint queue — entries appended by validator hook\n" + entry);
  }
}
```

**Step 2: Commit**

```bash
git add platform/mechanisms/validator/hook.js
git commit -m "feat(validator): add Templater hook handler with fix application + lint queue"
```

---

### Task 14: Register validator in the workshop manifest

**Files:**
- Modify: `platform/manifest.yml`

**Step 1: Update manifest**

```yaml
mechanisms:
  - { name: customjs-guard, version: 1.0.0, path: mechanisms/customjs-guard }
  - { name: validator, version: 0.1.0, path: mechanisms/validator }
```

**Step 2: Commit**

```bash
git add platform/manifest.yml
git commit -m "feat: register validator 0.1.0 in workshop manifest"
```

---

## Phase 4 — Audit walker

### Task 15: Build the audit walker

**Files:**
- Create: `platform/mechanisms/audit/audit-walker.js`
- Create: `platform/mechanisms/audit/manifest.yml`

**Step 1: Make directory + write walker**

```bash
mkdir -p platform/mechanisms/audit
```

`audit-walker.js`:

```javascript
// audit-walker.js — invoked by /audit slash command.
// Walks every .md file in the vault, runs tp.user.validate on each, groups violations.

module.exports = async function (tp) {
  const app = tp.app;
  const files = app.vault.getMarkdownFiles();
  const report = { summary: {}, byFile: {}, generated: new Date().toISOString() };

  for (const file of files) {
    const result = await tp.user.validate({ file });
    if (!result.violations || result.violations.length === 0) continue;
    report.byFile[file.path] = result.violations;
    for (const v of result.violations) {
      report.summary[v.rule] = (report.summary[v.rule] || 0) + 1;
    }
  }

  // Compare installed vs workshop platform versions.
  const installedPath = "Docs/Meta/platform-installed.yml";
  const subscriptionPath = "Docs/Meta/platform-subscription.yml";
  const installed = await readYaml(app, installedPath) || {};
  const subscription = await readYaml(app, subscriptionPath) || {};
  report.platformDrift = computeDrift(installed, subscription);

  // Write report.
  const today = new Date().toISOString().slice(0, 10);
  const reportPath = `Timestamps/Audits/${today}-audit.md`;
  const md = renderMarkdown(report);
  const existing = app.vault.getAbstractFileByPath(reportPath);
  if (existing) await app.vault.modify(existing, md);
  else await app.vault.create(reportPath, md);
  return reportPath;
};

async function readYaml(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  const text = await app.vault.read(f);
  try { return YAML.parse(text); } catch (e) { return null; }
}

function computeDrift(installed, subscription) {
  const drift = [];
  const sub = subscription.mechanisms || [];
  const inst = installed.mechanisms || [];
  for (const s of sub) {
    const i = inst.find(x => x.name === s.name);
    if (!i) drift.push({ name: s.name, status: "not_installed", subscribed: s.version });
    else if (i.version !== s.version) drift.push({ name: s.name, status: "version_mismatch", installed: i.version, subscribed: s.version });
  }
  return drift;
}

function renderMarkdown(report) {
  const lines = [
    "---", "tags: [audit, " + report.generated.slice(0, 10).replace(/-/g, "/") + "]", "---", "",
    "# Vault Audit — " + report.generated.slice(0, 10), "",
    "## Platform drift", "",
  ];
  if (report.platformDrift.length === 0) lines.push("- No drift detected.");
  for (const d of report.platformDrift) lines.push(`- 🔴 ${d.name}: ${d.status} (${JSON.stringify(d)})`);
  lines.push("", "## Violations summary", "");
  for (const [rule, count] of Object.entries(report.summary)) lines.push(`- ${rule}: ${count}`);
  lines.push("", "## Violations by file", "");
  for (const [file, vs] of Object.entries(report.byFile)) {
    lines.push("### " + file);
    for (const v of vs) lines.push(`- [${v.severity}] ${v.rule}: ${v.message}`);
    lines.push("");
  }
  return lines.join("\n");
}
```

`manifest.yml`:

```yaml
name: audit
version: 0.1.0
description: Walks every .md file, runs validator, reports violations + platform drift.
files:
  - { source: audit-walker.js, dest: "{{templater_scripts_path}}/audit-walker.js" }
post_install: []
```

**Step 2: Commit**

```bash
git add platform/mechanisms/audit/
git commit -m "feat: add audit walker mechanism with file iteration + drift detection + markdown report"
```

---

### Task 16: Register audit in the workshop manifest

**Step 1: Update manifest**

```yaml
mechanisms:
  - { name: customjs-guard, version: 1.0.0, path: mechanisms/customjs-guard }
  - { name: validator, version: 0.1.0, path: mechanisms/validator }
  - { name: audit, version: 0.1.0, path: mechanisms/audit }
```

**Step 2: Commit**

```bash
git add platform/manifest.yml
git commit -m "feat: register audit 0.1.0 in workshop manifest"
```

---

## Phase 5 — The installer

### Task 17: Build the installer skeleton

**Files:**
- Create: `platform/install.js`

**Step 1: Implement**

```javascript
// install.js — the per-vault installer. Runs as tp.user.platformInstall().
//
// Reads:
//   ../workshop/poc-vault/platform/manifest.yml    (workshop catalogue)
//   Docs/Meta/platform-config.yml                  (this vault's path map)
//   Docs/Meta/platform-subscription.yml            (what this vault wants)
//   Docs/Meta/platform-installed.yml               (what's currently installed)
//
// For each subscribed mechanism / blueprint at a NEWER version than installed:
//   1. Read its manifest.yml.
//   2. For each file: substitute {{vars}} from platform-config.yml, copy to dest.
//   3. For each post_install step: handle (snippet enable, notice, etc.) — gated by approval where required.
//   4. Update platform-installed.yml.

module.exports = async function (tp) {
  const app = tp.app;

  // Locate workshop. Convention: sibling to consumer vault, named workshop/poc-vault.
  // Future: read from platform-config.yml's workshop_path.
  const workshopPath = "../workshop/poc-vault";
  const workshopManifestPath = `${workshopPath}/platform/manifest.yml`;

  const config = await readYaml(app, "Docs/Meta/platform-config.yml");
  const subscription = await readYaml(app, "Docs/Meta/platform-subscription.yml");
  const installed = (await readYaml(app, "Docs/Meta/platform-installed.yml")) || { mechanisms: [], blueprints: [], history: [] };
  const manifest = await readYamlAbsolute(workshopManifestPath);

  if (!config || !subscription || !manifest) {
    new Notice("platformInstall: missing config, subscription, or workshop manifest. Aborting.", 6000);
    return;
  }

  const variables = config.variables || {};
  const installedNow = { ...installed, mechanisms: [...(installed.mechanisms || [])], history: [...(installed.history || [])] };

  for (const sub of subscription.mechanisms || []) {
    const target = manifest.mechanisms.find(m => m.name === sub.name);
    if (!target) {
      new Notice(`platformInstall: workshop has no mechanism "${sub.name}"`, 4000);
      continue;
    }
    if (target.version !== sub.version) {
      new Notice(`platformInstall: subscription pins ${sub.name}@${sub.version} but workshop has ${target.version}. Skipping.`, 6000);
      continue;
    }
    const installedEntry = installedNow.mechanisms.find(m => m.name === sub.name);
    if (installedEntry && installedEntry.version === sub.version) continue; // already installed

    const ok = await installMechanism(tp, workshopPath, target, variables);
    if (ok) {
      const idx = installedNow.mechanisms.findIndex(m => m.name === sub.name);
      const entry = { name: sub.name, version: sub.version, installed_at: new Date().toISOString() };
      if (idx >= 0) installedNow.mechanisms[idx] = entry;
      else installedNow.mechanisms.push(entry);
      installedNow.history.push({ event: "install", ...entry });
    }
  }

  // (Blueprint installs follow the same pattern — deferred to Task 22.)

  await writeYaml(app, "Docs/Meta/platform-installed.yml", installedNow);
  new Notice("platformInstall: complete.", 4000);
};

// helpers — see Task 18 for installMechanism, Task 19 for variable substitution, Task 20 for approval gates.

async function installMechanism(tp, workshopPath, target, variables) { /* Task 18 */ return false; }
async function readYaml(app, path) { /* simple wrapper */ }
async function readYamlAbsolute(absPath) { /* via FileSystemAdapter */ }
async function writeYaml(app, path, obj) { /* simple wrapper */ }
```

**Step 2: Commit**

```bash
git add platform/install.js
git commit -m "feat: scaffold platformInstall installer with subscription processing loop"
```

---

### Task 18: Implement `installMechanism` with file copying

**Files:**
- Modify: `platform/install.js`

**Step 1: Implement**

```javascript
async function installMechanism(tp, workshopPath, target, variables) {
  const app = tp.app;
  const adapter = app.vault.adapter;

  // Read mechanism manifest.
  const manPath = `${workshopPath}/platform/${target.path}/manifest.yml`;
  const mech = await readYamlAbsolute(manPath);
  if (!mech) {
    new Notice(`installMechanism: cannot read ${manPath}`, 4000);
    return false;
  }

  for (const f of mech.files || []) {
    const sourceAbs = `${workshopPath}/platform/${target.path}/${f.source}`;
    const destPath = substitute(f.dest, variables);
    if (f.approval === "required") {
      const ok = await approvalGate(tp, `Install ${mech.name} → ${destPath}?`);
      if (!ok) {
        new Notice(`Skipped ${destPath} (no approval)`, 3000);
        continue;
      }
    }
    const sourceFile = await readAbsolute(sourceAbs);
    if (sourceFile === null) {
      new Notice(`installMechanism: source missing: ${sourceAbs}`, 4000);
      return false;
    }
    // Substitute variables in JS / CSS content too (only inside specially-marked spots).
    const substituted = substitute(sourceFile, variables);
    // Ensure destination dir exists.
    const destDir = destPath.substring(0, destPath.lastIndexOf("/"));
    if (destDir && !(await adapter.exists(destDir))) {
      await adapter.mkdir(destDir);
    }
    await adapter.write(destPath, substituted);
  }

  for (const step of mech.post_install || []) {
    if (step.type === "enable_snippet") {
      await enableSnippet(tp, step.snippet, step.approval === "required");
    } else if (step.type === "notice") {
      new Notice(step.message, 8000);
    }
  }

  return true;
}

function substitute(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

async function readAbsolute(path) {
  // Use FileSystemAdapter.read for paths outside the vault.
  // Templater's tp.app.vault.adapter is the FileSystemAdapter on desktop.
  try {
    const fs = require("fs").promises;
    return await fs.readFile(path, "utf8");
  } catch (e) {
    return null;
  }
}

async function readYamlAbsolute(absPath) {
  const text = await readAbsolute(absPath);
  if (!text) return null;
  try { return YAML.parse(text); } catch (e) { return null; }
}

async function approvalGate(tp, message) {
  const choice = await tp.system.suggester(["Approve", "Skip"], [true, false], false, message);
  return choice === true;
}

async function enableSnippet(tp, snippet, approvalRequired) {
  const app = tp.app;
  const path = ".obsidian/appearance.json";
  const adapter = app.vault.adapter;
  const text = await adapter.read(path);
  const json = JSON.parse(text);
  if ((json.enabledCssSnippets || []).includes(snippet)) return;
  if (approvalRequired) {
    const ok = await approvalGate(tp, `Enable snippet ${snippet} in appearance.json?`);
    if (!ok) return;
  }
  json.enabledCssSnippets = [...(json.enabledCssSnippets || []), snippet];
  await adapter.write(path, JSON.stringify(json, null, 2));
  new Notice(`Enabled snippet ${snippet}. Reload Obsidian to apply.`, 6000);
}
```

**Step 2: Implement the YAML helpers**

```javascript
async function readYaml(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  const text = await app.vault.read(f);
  try { return YAML.parse(text); } catch (e) { return null; }
}

async function writeYaml(app, path, obj) {
  const text = "---\n# Auto-managed by platform installer. Edit by hand only if you know what you're doing.\n---\n" +
               YAML.stringify(obj);
  const tfile = app.vault.getAbstractFileByPath(path);
  if (tfile) await app.vault.modify(tfile, text);
  else await app.vault.create(path, text);
}
```

**Step 3: Commit**

```bash
git add platform/install.js
git commit -m "feat(installer): implement installMechanism with file copy, variable substitution, approval gates, snippet enable"
```

---

### Task 19: Register installer in the workshop manifest as a special mechanism

**Files:**
- Modify: `platform/manifest.yml`

**Step 1: Update manifest** to reference the installer itself:

```yaml
workshop_version: 0.2.0
date: 2026-05-02

# install.js is special: it's the bootstrap mechanism that consumers must have BEFORE
# they can run any other install. Bootstrap path: copy install.js manually into the
# consumer's templater_scripts_path on first setup, then run it once to install
# everything else.
installer:
  source: install.js
  version: 0.1.0
  bootstrap_dest: "{{templater_scripts_path}}/platformInstall.js"

mechanisms:
  - { name: customjs-guard, version: 1.0.0, path: mechanisms/customjs-guard }
  - { name: validator, version: 0.1.0, path: mechanisms/validator }
  - { name: audit, version: 0.1.0, path: mechanisms/audit }

blueprints: []
```

**Step 2: Commit**

```bash
git add platform/manifest.yml
git commit -m "feat: declare installer in workshop manifest with bootstrap convention"
```

---

## Phase 6 — Workshop self-test

### Task 20: Bootstrap workshop as its own consumer

The workshop is itself a vault; we can dogfood the installer here before any consumer integration.

**Files:**
- Create: `Docs/Meta/platform-config.yml` (in the workshop)
- Create: `Docs/Meta/platform-subscription.yml` (in the workshop)
- Create: `Docs/Meta/rules/_global.yml` (empty stub)

**Step 1: Make Docs/Meta**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
mkdir -p Docs/Meta/rules Docs/Meta/Templater
```

**Step 2: Write `platform-config.yml`** (workshop variant — workshop installs into itself)

```yaml
# Self-install for the workshop POC vault.
# In a real consumer, paths point to that vault's canonical locations.
variables:
  views_path: Docs/Meta/Views
  templater_scripts_path: Docs/Meta/Templater
  scripts_path: Docs/Meta/Scripts
```

**Step 3: Write `platform-subscription.yml`**

```yaml
workshop_version: 0.2.0

mechanisms:
  - { name: customjs-guard, version: 1.0.0 }
  - { name: validator, version: 0.1.0 }
  - { name: audit, version: 0.1.0 }

blueprints: []
```

**Step 4: Write empty `_global.yml`**

```yaml
required_frontmatter: {}
required_tags: []
forbid_dataviewjs_patterns: []
```

**Step 5: Manually copy install.js into the workshop's Templater scripts folder**

```bash
cp platform/install.js Docs/Meta/Templater/platformInstall.js
```

**Step 6: Commit**

```bash
git add Docs/Meta/
git commit -m "chore: bootstrap workshop's own platform self-subscription"
```

---

### Task 21: Run the installer in the workshop and verify

**Step 1: In Obsidian (workshop vault), reload Templater user scripts**

Settings → Templater → User Scripts → reload.

**Step 2: Open a test note and run the installer**

Create `Test - Run Installer.md` with:

```markdown
---
tags: [test]
---

```dataviewjs
const tp = window.app.plugins.plugins["templater-obsidian"].templater.current_functions_object;
await tp.user.platformInstall(tp);
dv.paragraph("installer fired");
```
```

**Step 3: Approve all gates as they appear**

Approval gates should fire for the customjs-loader.css snippet and the appearance.json edit. Approve each.

**Step 4: Verify materialization**

```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
ls Docs/Meta/Views/customjs-guard/view.js
ls Docs/Meta/Templater/validate.js
ls Docs/Meta/Templater/hook-validate.js
ls Docs/Meta/Templater/audit-walker.js
ls .obsidian/snippets/customjs-loader.css
cat Docs/Meta/platform-installed.yml
```

Expected: all five files exist. `platform-installed.yml` lists three mechanisms with current versions and timestamps.

**Step 5: Commit installed state**

```bash
git add Docs/Meta/Views/ Docs/Meta/Templater/ .obsidian/snippets/customjs-loader.css .obsidian/appearance.json Docs/Meta/platform-installed.yml
git commit -m "feat: workshop self-installs its platform — POC verified"
```

---

## Phase 7 — Accuris consumer integration (Phase 1 of design)

### Task 22: Bootstrap accuris with platform config + subscription

**Files:**
- Create: `/Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/platform-config.yml`
- Create: `/Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/platform-subscription.yml`
- Create: `/Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/rules/_global.yml` (or merge if exists)

**Step 1: Write `platform-config.yml`** (uses ACCURIS's current paths — pre-canonical-migration)

```yaml
# Accuris vault path map.
# After canonical migration (separate plan), these all become Docs/Meta/* paths.
variables:
  views_path: Extras/Scripts                  # current accuris location for view files
  templater_scripts_path: Docs/Meta/Templater # NEW — needs creating
  scripts_path: Docs/Meta/Scripts             # already canonical for accuris
```

Note: the `views_path` here is `Extras/Scripts` — that's where customjs-guard already lives in accuris. After canonical migration, it becomes `Docs/Meta/Views`. The installer respects whatever the config says.

**Step 2: Write `platform-subscription.yml`**

```yaml
workshop_version: 0.2.0

mechanisms:
  - { name: customjs-guard, version: 1.0.0 }
  - { name: validator, version: 0.1.0 }
  - { name: audit, version: 0.1.0 }

blueprints: []
```

**Step 3: Make Templater scripts dir if missing**

```bash
mkdir -p /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/Templater
```

**Step 4: Configure Templater plugin to use that dir**

In Obsidian (accuris vault): Settings → Templater → User Scripts → "Script files folder location" → set to `Docs/Meta/Templater`. (Templater may already point elsewhere; check first.)

**Step 5: Bootstrap install.js**

```bash
cp /Users/willfell/Documents/obsidian/sync/workshop/poc-vault/platform/install.js \
   /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/Templater/platformInstall.js
```

**Step 6: Commit**

```bash
cd /Users/willfell/Documents/obsidian/sync/accuris
git add Docs/Meta/platform-config.yml Docs/Meta/platform-subscription.yml Docs/Meta/Templater/
git commit -m "chore: bootstrap accuris platform subscription pointing at workshop POC"
```

---

### Task 23: Run installer in accuris and verify

**Step 1: Reload Templater user scripts in accuris**

Settings → Templater → User Scripts → reload.

**Step 2: From a test note in accuris, run `tp.user.platformInstall`**

Create `Timestamps/2026/05-May/Test Run Platform Install.md`:

```markdown
---
tags: [accuris, test, 2026/05/02]
---

```dataviewjs
const tp = window.app.plugins.plugins["templater-obsidian"].templater.current_functions_object;
await tp.user.platformInstall(tp);
dv.paragraph("ran installer");
```
```

**Step 3: Watch approval gates**

Should fire for: customjs-loader.css (already exists from prior work — installer should detect and skip), appearance.json (already enabled — should skip).

For the views_path: `Extras/Scripts/customjs-guard/view.js` already exists. Installer overwrites with workshop version — check the diff first.

```bash
diff /Users/willfell/Documents/obsidian/sync/accuris/Extras/Scripts/customjs-guard/view.js \
     /Users/willfell/Documents/obsidian/sync/workshop/poc-vault/platform/mechanisms/customjs-guard/view.js
```

If identical: install is a no-op for that file. Confirm.

**Step 4: Verify validator + audit landed**

```bash
ls /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/Templater/validate.js
ls /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/Templater/hook-validate.js
ls /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/Templater/audit-walker.js
cat /Users/willfell/Documents/obsidian/sync/accuris/Docs/Meta/platform-installed.yml
```

Expected: three files present. `platform-installed.yml` shows three mechanisms.

**Step 5: Validate end-to-end on Saturday daily note**

Open `/Timestamps/2026/05-May/2026-05-02-Saturday.md`. From the command palette, run a quick lint (manual for now — slash command comes in a follow-up). Smoke check: validator finds the note has `module:` missing → reports a `_global` violation only.

**Step 6: Delete the test note + commit**

```bash
cd /Users/willfell/Documents/obsidian/sync/accuris
rm "Timestamps/2026/05-May/Test Run Platform Install.md"
git add -A
git commit -m "feat: install vault platform mechanisms into accuris from workshop"
```

---

### Task 24: Wire the validator hook into a startup template (accuris)

**Files:**
- Modify (or create): a Templater "Startup Templates" entry.

**Step 1: Configure Templater startup hook**

In Obsidian: Settings → Templater → Folder Templates / Startup Templates. Add a startup hook that requires `tp.user.hook-validate(tp)` once per session.

The simplest path: create `Docs/Meta/Templater/_startup.js` that imports hook.js and registers the global hook.

```javascript
// _startup.js — runs once when Templater initializes.
module.exports = async function (tp) {
  await tp.user["hook-validate"](tp);
};
```

Configure Templater: Startup Templates → add `_startup.js`. (If Templater requires a markdown file rather than a JS file for startup, write a wrapper template `Docs/Meta/Templater/_startup.md` that contains `<%* await tp.user.hook-validate(tp) %>` and register that.)

**Step 2: Verify hook fires**

In accuris, create a new note from any existing template. The hook should fire automatically. Check `Docs/Meta/_lint-queue.yml` — if violations exist, they should be appended.

**Step 3: Commit**

```bash
git add Docs/Meta/Templater/_startup.js
git commit -m "feat: wire validator hook into Templater startup for auto-validation"
```

---

## Phase 8 — Follow-up plans (out of scope for this plan)

The following are intentionally NOT in this plan. Each becomes its own follow-up plan once Phase 7 lands and the POC is stable.

1. **`/lint` slash command** — on-demand single-file validation from the command palette.
2. **`/audit` slash command** — invokes the audit walker, writes the markdown report.
3. **Headspace + ERO consumer integration** — same as Task 22-24 but for those vaults. Each vault gets its own `platform-config.yml` reflecting its current (pre-canonical) paths.
4. **First blueprint** — port the `project` blueprint into the workshop, with `variants.yml` mapping to `side-quest` for headspace.
5. **Canonical-path migration** — move every consumer to the canonical layout (`Docs/Meta/{Scripts,Views,Templates,QuickAdd,Templater,rules}`, etc.). Heaviest follow-up plan; touches every existing dataviewjs callsite.
6. **Workshop hosting** — decide: pure Obsidian Sync, or push to a private GitHub for backup and external collaboration?
7. **Multi-machine sync timing** — handle the case where Obsidian Sync hasn't delivered the latest workshop manifest before an installer run.

---

## Status

- [ ] Task 1 — Snapshot vaults
- [ ] Task 2 — Git baseline
- [ ] Task 3 — Workshop dir + Obsidian register
- [ ] Task 4 — Workshop CLAUDE.md
- [ ] Task 5 — Platform skeleton
- [ ] Task 6 — Port customjs-guard files
- [ ] Task 7 — Register customjs-guard in manifest
- [ ] Task 8 — Validator scaffold
- [ ] Task 9 — `checkFrontmatter`
- [ ] Task 10 — `checkTags`
- [ ] Task 11 — `checkRequiredBlocks`
- [ ] Task 12 — `checkForbiddenPatterns` + `checkNamingPattern`
- [ ] Task 13 — Templater hook handler
- [ ] Task 14 — Register validator
- [ ] Task 15 — Audit walker
- [ ] Task 16 — Register audit
- [ ] Task 17 — Installer skeleton
- [ ] Task 18 — `installMechanism` implementation
- [ ] Task 19 — Register installer in manifest
- [ ] Task 20 — Workshop self-bootstrap
- [ ] Task 21 — Workshop self-test
- [ ] Task 22 — Accuris bootstrap
- [ ] Task 23 — Accuris install + verify
- [ ] Task 24 — Wire validator hook in accuris startup
- [ ] Phase 8 — write follow-up plans
