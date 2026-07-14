# Code-Fence Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `code-fence-button` customJS mechanism that puts an always-present, far-right view-header button (code icon) into every Obsidian markdown note; it greys out until text is selected, then wraps the selection in a fence long enough to survive inner backticks, and also registers an equivalent Cmd+P command.

**Architecture:** A Sauce **mechanism** (no real Obsidian plugin) in `platform/mechanisms/code-fence-button/`, with two customJS classes: `CodeFenceButton` (pure, Node-testable static wrap logic) and `CodeFenceButtonInit` (startup script that injects the header action via `MarkdownView.addAction`, keeps it enabled/greyed in sync with the editor selection via a debounced `document` `selectionchange` listener, wires the click + command, and tears down idempotently across customJS reloads). Distribution rides Sauce's subscription + brew machinery; no note bodies are touched, so there is no install heal.

**Tech Stack:** Node (test harness via `new Function`), Obsidian public-ish APIs (`MarkdownView.addAction`, `Editor.getSelection/somethingSelected/replaceSelection`, `Workspace` events, DOM `selectionchange`), customjs-guard.

**Reference files (read before starting):**
- `Docs/plans/2026-07-13-code-fence-button-design.md` — the spec.
- `platform/mechanisms/kanban-status-sync/manifest.json` + `kanban-status-sync-init.js` — the mechanism + startup-script pattern to mirror.
- `ranch/scripts/project/project-commands-init.js` — never-throw / cold-load-safe command registration.
- `platform/test/run-kanban-status-sync.js` — the Node harness pattern (`new Function(...)` class loading, `assertEq`/`assertTrue`, pass/fail counters, exit code).
- `Docs/agent-guides/code-conventions.md` — the five non-negotiables (customjs-guard, module-directory invariant, never-throw, cold-load-safe, marker regions).

**Global conventions (apply to every code task):**
- customJS classes carry **no imports/exports**; they are loaded by filesystem scan. `new Function(src + "\nreturn ClassName;")` must succeed with only `app`, `customJS`, `Notice`, `window` in scope.
- Every method is **never-throw** and **cold-load-safe**: guard every `app.*` / DOM access; degrade to no-op or a single `Notice`, never throw.
- No `Date.now()` avoidance needed (this is runtime code, not a workflow script).

---

## Task 1: Mechanism scaffold — directory + manifest + empty classes

**Files:**
- Create: `platform/mechanisms/code-fence-button/manifest.json`
- Create: `platform/mechanisms/code-fence-button/code-fence-button.js`
- Create: `platform/mechanisms/code-fence-button/code-fence-button-init.js`

- [ ] **Step 1: Write the manifest**

`platform/mechanisms/code-fence-button/manifest.json`:
```json
{
  "name": "code-fence-button",
  "version": "0.1.0",
  "kind": "mechanism",
  "description": "Always-present view-header button (far-right, code icon) that greys out until text is selected, then wraps the selection in a fence long enough to survive inner backticks. Ships an equivalent 'Sauce: Wrap selection in code fence' command.",
  "depends_on": [{ "name": "customjs-guard", "range": ">=1.0.0" }],
  "customjs_classes": ["CodeFenceButton", "CodeFenceButtonInit"],
  "customjs_startup_scripts": ["CodeFenceButtonInit"],
  "files": [
    { "source": "code-fence-button.js", "dest": "{{scripts_path}}/code-fence-button/code-fence-button.js" },
    { "source": "code-fence-button-init.js", "dest": "{{scripts_path}}/code-fence-button/code-fence-button-init.js" }
  ],
  "post_install": [],
  "rule_fragments": []
}
```

- [ ] **Step 2: Write a stub `CodeFenceButton` class**

`platform/mechanisms/code-fence-button/code-fence-button.js`:
```javascript
/**
 * CodeFenceButton — pure, Node-testable wrap logic for the code-fence view-header
 * button. No imports/exports (loaded by the customJS filesystem scan). Static
 * helpers only; no app/DOM dependency in computeFence / wrapSelection.
 */
class CodeFenceButton {
  // Longest run of consecutive backticks in `selection` → fence of max(4, N+1).
  static computeFence(selection) {
    return "````"; // replaced in Task 2
  }
}
```

- [ ] **Step 3: Write a stub `CodeFenceButtonInit` class**

`platform/mechanisms/code-fence-button/code-fence-button-init.js`:
```javascript
/**
 * CodeFenceButtonInit — customjs startup-script bootstrap for code-fence-button.
 * Registered in customjs_startup_scripts[]. customJS calls invoke() at plugin
 * init. Never-throw + cold-load-safe throughout.
 */
class CodeFenceButtonInit {
  invoke() {
    try {
      // wired in Tasks 4–6
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButtonInit]", e);
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/code-fence-button/
git commit -m "feat(code-fence-button): mechanism scaffold (manifest + stub classes)"
```

---

## Task 2: `computeFence` — fence length from inner backticks (TDD)

**Files:**
- Create: `platform/test/run-code-fence-button.js`
- Modify: `platform/mechanisms/code-fence-button/code-fence-button.js`

- [ ] **Step 1: Write the failing test harness**

Create `platform/test/run-code-fence-button.js`. Model the loader + assert helpers on `platform/test/run-kanban-status-sync.js` (load the class source via `new Function`, `assertEq`, pass/fail counters, `process.exit(fail ? 1 : 0)`):
```javascript
#!/usr/bin/env node
// run-code-fence-button.js — asserts code-fence-button mechanism.
// Pass 1: manifest sanity. Pass 2: CodeFenceButton.computeFence (CFB-1..4).
// Pass 3: CodeFenceButton.wrapSelection (CFB-5..9). Pass 4: source lint (parses).
"use strict";
const fs = require("fs");
const path = require("path");
const WORKSHOP = path.resolve(__dirname, "../..");
const MECH_DIR = path.join(WORKSHOP, "platform/mechanisms/code-fence-button");
const MANIFEST_PATH = path.join(MECH_DIR, "manifest.json");
const SRC_PATH = path.join(MECH_DIR, "code-fence-button.js");
const INIT_PATH = path.join(MECH_DIR, "code-fence-button-init.js");

let pass = 0, fail = 0; const failures = [];
function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; failures.push(`FAIL: ${label}\n  expected ${e}\n  got      ${a}`); }
}
function assertTrue(label, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`FAIL: ${label}${detail ? "\n  " + detail : ""}`); }
}

// ── Load CodeFenceButton from source via new Function (customJS scope stubs).
const src = fs.readFileSync(SRC_PATH, "utf8");
let CFB;
try {
  CFB = new Function("app", "customJS", "Notice", "window", src + "\nreturn CodeFenceButton;")(
    undefined, undefined, function () {}, undefined);
} catch (e) { fail++; failures.push("CFB-P0: source loads via new Function\n  " + (e && e.message)); }

// Pass 1 — manifest sanity
console.log("\n--- Pass 1: manifest ---");
const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
assertEq("CFB-M1: name", m.name, "code-fence-button");
assertEq("CFB-M2: kind", m.kind, "mechanism");
assertEq("CFB-M3: startup scripts", m.customjs_startup_scripts, ["CodeFenceButtonInit"]);
assertEq("CFB-M4: classes", m.customjs_classes, ["CodeFenceButton", "CodeFenceButtonInit"]);
assertTrue("CFB-M5: init source parses", (() => {
  try { new Function("app","customJS","Notice","window", fs.readFileSync(INIT_PATH,"utf8") + "\nreturn CodeFenceButtonInit;"); return true; }
  catch (_e) { return false; }
})());

// Pass 2 — computeFence
console.log("\n--- Pass 2: computeFence ---");
assertEq("CFB-1: no backticks → 4", CFB.computeFence("hello world"), "````");
assertEq("CFB-2: contains 3 → 4", CFB.computeFence("a ``` b"), "````");
assertEq("CFB-3: contains 4 → 5", CFB.computeFence("x ```` y"), "`````");
assertEq("CFB-4: contains 5 → 6", CFB.computeFence("`````"), "``````");

// Pass 3 (wrapSelection) — added in Task 3.

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("\n" + failures.join("\n"));
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node platform/test/run-code-fence-button.js`
Expected: FAIL on CFB-3 / CFB-4 (stub returns `` ```` `` always).

- [ ] **Step 3: Implement `computeFence`**

Replace the stub method in `code-fence-button.js`:
```javascript
  static computeFence(selection) {
    const s = typeof selection === "string" ? selection : "";
    let longest = 0;
    const runs = s.match(/`+/g);
    if (runs) for (const r of runs) if (r.length > longest) longest = r.length;
    const n = Math.max(4, longest + 1);
    return "`".repeat(n);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-code-fence-button.js`
Expected: PASS (CFB-1..4 green, manifest green).

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/code-fence-button/code-fence-button.js platform/test/run-code-fence-button.js
git commit -m "feat(code-fence-button): computeFence + Node harness"
```

---

## Task 3: `wrapSelection` — newline-guarded fenced block (TDD)

**Files:**
- Modify: `platform/mechanisms/code-fence-button/code-fence-button.js`
- Modify: `platform/test/run-code-fence-button.js`

- [ ] **Step 1: Add failing tests** (insert where `// Pass 3 … added in Task 3.` sits):
```javascript
console.log("\n--- Pass 3: wrapSelection ---");
// Full-line selection: no extra leading/trailing newline; fence on its own line.
assertEq("CFB-5: full-line wrap",
  CFB.wrapSelection("x", { atLineStart: true, atLineEnd: true }),
  { text: "````\nx\n````", cursor: "````\nx\n````".length });
// Mid-line selection: leading + trailing newline guard.
assertEq("CFB-6: mid-line wrap",
  CFB.wrapSelection("x", { atLineStart: false, atLineEnd: false }),
  { text: "\n````\nx\n````\n", cursor: "\n````\nx\n````\n".length });
// Multiline inner text preserved verbatim.
assertEq("CFB-7: multiline inner preserved",
  CFB.wrapSelection("a\nb", { atLineStart: true, atLineEnd: true }).text,
  "````\na\nb\n````");
// Empty selection → null (caller no-ops).
assertEq("CFB-8: empty → null", CFB.wrapSelection("   ", { atLineStart: true, atLineEnd: true }), null);
// Cursor lands after the closing fence.
const w9 = CFB.wrapSelection("hi", { atLineStart: true, atLineEnd: true });
assertEq("CFB-9: cursor after block", w9.cursor, w9.text.length);
```

- [ ] **Step 2: Run to verify fail**

Run: `node platform/test/run-code-fence-button.js`
Expected: FAIL — `wrapSelection is not a function`.

- [ ] **Step 3: Implement `wrapSelection`** (add to `CodeFenceButton`):
```javascript
  static wrapSelection(selection, opts) {
    const sel = typeof selection === "string" ? selection : "";
    if (sel.trim() === "") return null;
    const o = opts || {};
    const fence = CodeFenceButton.computeFence(sel);
    const lead = o.atLineStart ? "" : "\n";
    const tail = o.atLineEnd ? "" : "\n";
    const text = lead + fence + "\n" + sel + "\n" + fence + tail;
    return { text: text, cursor: text.length };
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node platform/test/run-code-fence-button.js`
Expected: PASS (CFB-1..9 + manifest green).

- [ ] **Step 5: Commit**

```bash
git add platform/mechanisms/code-fence-button/code-fence-button.js platform/test/run-code-fence-button.js
git commit -m "feat(code-fence-button): wrapSelection (newline-guarded fenced block)"
```

---

## Task 4: `wrapActiveEditor` — app-facing wrap entry point

**Files:**
- Modify: `platform/mechanisms/code-fence-button/code-fence-button.js`

- [ ] **Step 1: Implement `wrapActiveEditor`** (add to `CodeFenceButton`; no unit test — it needs a live editor, covered by manual integration in Task 7). It is the single wrap entry point shared by the button click and the command:
```javascript
  // App-facing: wrap the active editor's selection in place. Never-throw.
  // Returns true if a wrap happened, false otherwise (no selection / no editor).
  static wrapActiveEditor(view) {
    try {
      const editor = view && view.editor;
      if (!editor || typeof editor.getSelection !== "function") return false;
      const sel = editor.getSelection();
      if (!sel || sel.trim() === "") return false;
      // Determine whether the selection starts at column 0 and ends at line end.
      let atLineStart = true, atLineEnd = true;
      try {
        const from = editor.getCursor("from");
        const to = editor.getCursor("to");
        atLineStart = from.ch === 0;
        const toLine = editor.getLine(to.line) || "";
        atLineEnd = to.ch >= toLine.length;
      } catch (_e) { /* default to guarded (both false-safe) */ atLineStart = false; atLineEnd = false; }
      const wrapped = CodeFenceButton.wrapSelection(sel, { atLineStart: atLineStart, atLineEnd: atLineEnd });
      if (!wrapped) return false;
      editor.replaceSelection(wrapped.text);
      return true;
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButton.wrapActiveEditor]", e);
      return false;
    }
  }
```

- [ ] **Step 2: Verify source still loads** (guards against a syntax error breaking the customjs-loadable CI check):

Run: `node -e "new Function('app','customJS','Notice','window', require('fs').readFileSync('platform/mechanisms/code-fence-button/code-fence-button.js','utf8')+'\nreturn CodeFenceButton;')(); console.log('loads OK')"`
Expected: `loads OK`

- [ ] **Step 3: Run harness (regression)**

Run: `node platform/test/run-code-fence-button.js`
Expected: PASS (unchanged; new method has no unit test).

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/code-fence-button/code-fence-button.js
git commit -m "feat(code-fence-button): wrapActiveEditor app-facing entry point"
```

---

## Task 5: `CodeFenceButtonInit` — button injection + far-right placement

**Files:**
- Modify: `platform/mechanisms/code-fence-button/code-fence-button-init.js`

- [ ] **Step 1: Implement injection + workspace hooks + teardown scaffold.** Replace the class body. `MarkdownView` is read off `app.workspace.getActiveViewOfType`'s constructor is not available, so resolve it via the obsidian module surface guardedly — use `view instanceof (app?.workspace?.getActiveViewOfType && ...)` is unavailable in customJS; instead **duck-type** the view (has `.getViewType?.() === "markdown"` and `.editor`). Full body:
```javascript
class CodeFenceButtonInit {
  invoke() {
    try {
      // Idempotent teardown across customJS reloads.
      const G = (typeof window !== "undefined") ? window : globalThis;
      const prev = G._sauceCodeFenceButton;
      if (prev && prev.teardown) { try { prev.teardown(); } catch (_e) {} }

      if (typeof app === "undefined" || !app.workspace) return;

      const state = { refs: [], onSel: null, debounce: null };
      const self = this;

      const syncButtons = () => { try { self._syncButtons(); } catch (_e) {} };
      const refreshEnabled = () => { try { self._refreshEnabled(); } catch (_e) {} };

      // Inject on startup + when panes/layout change.
      state.refs.push(app.workspace.on("active-leaf-change", () => { syncButtons(); refreshEnabled(); }));
      state.refs.push(app.workspace.on("layout-change", () => { syncButtons(); }));

      // Live greying: one debounced document selectionchange listener.
      if (typeof document !== "undefined" && document.addEventListener) {
        state.onSel = () => {
          if (state.debounce) clearTimeout(state.debounce);
          state.debounce = setTimeout(refreshEnabled, 50);
        };
        document.addEventListener("selectionchange", state.onSel);
      }

      state.teardown = () => {
        try { for (const r of state.refs) app.workspace.offref(r); } catch (_e) {}
        try { if (state.onSel) document.removeEventListener("selectionchange", state.onSel); } catch (_e) {}
        if (state.debounce) { try { clearTimeout(state.debounce); } catch (_e) {} }
      };
      G._sauceCodeFenceButton = state;

      this._registerCommand();

      // Initial pass (workspace may already be laid out).
      syncButtons();
      refreshEnabled();

      if (typeof console !== "undefined") {
        console.log("[CodeFenceButtonInit] initialized at", new Date().toISOString());
      }
    } catch (e) {
      if (typeof console !== "undefined") console.error("[CodeFenceButtonInit]", e);
    }
  }

  // Duck-typed markdown-view check (customJS has no MarkdownView symbol).
  _isMarkdownView(view) {
    try {
      return !!view && typeof view.getViewType === "function"
        && view.getViewType() === "markdown"
        && !!view.editor;
    } catch (_e) { return false; }
  }

  _markdownViews() {
    const out = [];
    try {
      const leaves = app.workspace.getLeavesOfType("markdown") || [];
      for (const leaf of leaves) if (leaf && this._isMarkdownView(leaf.view)) out.push(leaf.view);
    } catch (_e) {}
    return out;
  }

  // Ensure every markdown view carries exactly one far-right code-fence action.
  _syncButtons() {
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        if (!root) continue;
        const actions = root.querySelector(".view-header .view-actions") || root.querySelector(".view-actions");
        if (!actions) continue;
        if (actions.querySelector(".sauce-code-fence-action")) {
          // already present — just make sure it's still far-right
          const existing = actions.querySelector(".sauce-code-fence-action");
          if (existing && existing.parentElement === actions && existing !== actions.lastElementChild) {
            actions.appendChild(existing);
          }
          continue;
        }
        if (typeof view.addAction !== "function") continue;
        const el = view.addAction("code-2", "Wrap selection in code fence", () => this._onClick(view));
        if (!el) continue;
        el.classList.add("sauce-code-fence-action");
        // Far right: last child of the actions row.
        if (el.parentElement === actions) actions.appendChild(el);
      } catch (_e) { /* never throw */ }
    }
  }
}
```

- [ ] **Step 2: Verify source loads** (customjs-loadable guard):

Run: `node -e "new Function('app','customJS','Notice','window', require('fs').readFileSync('platform/mechanisms/code-fence-button/code-fence-button-init.js','utf8')+'\nreturn CodeFenceButtonInit;')(); console.log('loads OK')"`
Expected: `loads OK`

- [ ] **Step 3: Run harness** (CFB-M5 asserts init parses):

Run: `node platform/test/run-code-fence-button.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/code-fence-button/code-fence-button-init.js
git commit -m "feat(code-fence-button): view-header injection + far-right placement + teardown"
```

---

## Task 6: `CodeFenceButtonInit` — greying, click, command

**Files:**
- Modify: `platform/mechanisms/code-fence-button/code-fence-button-init.js`

- [ ] **Step 1: Add the enabled-sync, click, and command methods** to the class:
```javascript
  // Grey every button; enable only the active view's when it has a selection.
  _refreshEnabled() {
    let active = null;
    try {
      // Active markdown view = the one whose editor currently has selection focus.
      const leaf = app.workspace.activeLeaf;
      if (leaf && this._isMarkdownView(leaf.view)) active = leaf.view;
    } catch (_e) {}
    let enabled = false;
    try {
      enabled = !!(active && active.editor && typeof active.editor.somethingSelected === "function"
        && active.editor.somethingSelected());
    } catch (_e) { enabled = false; }
    for (const view of this._markdownViews()) {
      try {
        const root = view.containerEl;
        const el = root && root.querySelector(".sauce-code-fence-action");
        if (!el) continue;
        const on = (view === active) && enabled;
        el.classList.toggle("is-disabled", !on);
        el.style.opacity = on ? "" : "0.35";
        el.style.cursor = on ? "" : "default";
        el.setAttribute("aria-disabled", on ? "false" : "true");
      } catch (_e) {}
    }
  }

  _onClick(view) {
    try {
      if (!view || !view.editor) return;
      if (!view.editor.somethingSelected || !view.editor.somethingSelected()) return; // greyed → no-op
      const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
      if (!CFB || typeof CFB.wrapActiveEditor !== "function") {
        if (typeof Notice === "function") new Notice("CodeFenceButton unavailable — reinstall the mechanism.", 6000);
        return;
      }
      CFB.wrapActiveEditor(view);
    } catch (_e) {}
  }

  _registerCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    app.commands.addCommand({
      id: "code-fence-button:wrap-selection",
      name: "Sauce: Wrap selection in code fence",
      callback: () => {
        try {
          const leaf = app.workspace && app.workspace.activeLeaf;
          const view = leaf && this._isMarkdownView(leaf.view) ? leaf.view : null;
          if (!view) { if (typeof Notice === "function") new Notice("Select text in a note first.", 4000); return; }
          const CFB = (typeof customJS !== "undefined") && customJS.CodeFenceButton;
          if (!CFB) { if (typeof Notice === "function") new Notice("CodeFenceButton unavailable.", 6000); return; }
          const did = CFB.wrapActiveEditor(view);
          if (!did && typeof Notice === "function") new Notice("Select text in a note first.", 4000);
        } catch (_e) {}
      },
    });
    this._commandRegistered = true;
  }
```

- [ ] **Step 2: Verify source loads:**

Run: `node -e "new Function('app','customJS','Notice','window', require('fs').readFileSync('platform/mechanisms/code-fence-button/code-fence-button-init.js','utf8')+'\nreturn CodeFenceButtonInit;')(); console.log('loads OK')"`
Expected: `loads OK`

- [ ] **Step 3: Run harness:**

Run: `node platform/test/run-code-fence-button.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add platform/mechanisms/code-fence-button/code-fence-button-init.js
git commit -m "feat(code-fence-button): live greying + click + Cmd+P command"
```

---

## Task 7: Wire subscriptions + CI harness + full preflight

**Files:**
- Modify: `ranch/platform-subscription.json`
- Modify: `platform/test/seed-vault/ranch/platform-subscription.json`
- Modify: `package.json` (the `release:preflight` script)

- [ ] **Step 1: Subscribe the workshop.** In `ranch/platform-subscription.json`, add to the `mechanisms` array (keep valid JSON — add a comma after the prior entry):
```json
    {
      "name": "code-fence-button",
      "version": "0.1.0"
    }
```

- [ ] **Step 2: Subscribe the seed vault.** Add the identical entry to the `mechanisms` array in `platform/test/seed-vault/ranch/platform-subscription.json`. (If that file lists mechanisms; if its shape differs, match the existing entries' shape exactly.)

- [ ] **Step 3: Register the harness in CI.** In `package.json`, append to the end of the `release:preflight` command chain (before the closing quote):
```
 && node platform/test/run-code-fence-button.js
```

- [ ] **Step 4: Run the customjs-loadable + contract checks** (these scan every registered `customjs_classes` entry — the new mechanism must pass):

Run: `node platform/test/run-customjs-loadable.js && node platform/test/run-customjs-contract.js`
Expected: PASS (both). If either fails, fix the flagged class (usually a cold-load guard or a stray reference) before continuing.

- [ ] **Step 5: Run version-sync + the new harness:**

Run: `node scripts/check-version-sync.js && node platform/test/run-code-fence-button.js`
Expected: PASS. (If `check-version-sync.js` complains about the new mechanism's pin vs manifest, align the subscription version `0.1.0` with the manifest `version` `0.1.0` — they must match.)

- [ ] **Step 6: Run the full preflight** (the exact CI gate):

Run: `npm run release:preflight`
Expected: PASS (exit 0). Fix any failure before committing. Common culprits: `check-files-forbidden-paths.js` (file dest path), `lint-cold-load.js` (add a missing guard), seed/migration tests (subscription shape).

- [ ] **Step 7: Commit**

```bash
git add ranch/platform-subscription.json platform/test/seed-vault/ranch/platform-subscription.json package.json
git commit -m "chore(code-fence-button): subscribe workshop + seed vault; wire preflight harness"
```

---

## Task 8: Dogfood install + on-device verification

**Files:** none (verification only).

- [ ] **Step 1: Dogfood-install into the workshop vault.** Install the workshop's own subscription against itself (this is the self-as-first-consumer dogfood; the mechanism's `dest` lands the two files under `ranch/scripts/code-fence-button/`). Use the repo's normal local install path — from the workshop worktree root:

Run: `node platform/install.js .` (or the repo's documented dogfood command from `Docs/agent-guides/dev-workflow.md` — prefer that if it differs).
Expected: install reports the `code-fence-button` mechanism installed, 2 files written, exit 0.

- [ ] **Step 2: Confirm the files landed + git status is intentional:**

Run: `ls ranch/scripts/code-fence-button/ && git status --short`
Expected: `code-fence-button.js` + `code-fence-button-init.js` present. Review any dogfood-regenerated files; commit only intended changes.

- [ ] **Step 3: Manual on-device check (user-facing).** Reload Obsidian (Cmd+R) in the workshop vault and verify the design's integration checklist:
  1. code icon (`</>`) appears **far-right** in the header of every markdown note, including a freshly-split pane / new tab;
  2. **greyed** with no selection; **lights up** the instant text is selected; greys again on deselect;
  3. clicking with a selection **wraps** it in a fence; caret lands after the block;
  4. a selection containing ```` ``` ```` gets a **4-tick** fence; one containing 4 ticks gets **5**;
  5. mid-line and multiline selections wrap validly (fences on their own lines);
  6. `Sauce: Wrap selection in code fence` works from **Cmd+P**;
  7. after a customJS reload there is exactly **one** button per view (no dupes) and no double-wrap (no listener leak).

- [ ] **Step 4: If any check fails**, fix in the mechanism source, re-run `npm run release:preflight`, re-install, re-verify. Commit each fix with a `fix(code-fence-button): …` message.

- [ ] **Step 5: Final commit (if any dogfood artifacts are intended to ship):**

```bash
git add -A
git commit -m "chore(code-fence-button): dogfood install artifacts" || echo "nothing to commit"
```

---

## Self-Review Notes (author)

- **Spec coverage:** computeFence ladder (CFB-1..4) ✓; newline-guarded wrap + empty→null + cursor (CFB-5..9) ✓; injection far-right (Task 5) ✓; live greying (Task 6) ✓; command (Task 6) ✓; idempotent teardown (Task 5) ✓; subscriptions + preflight (Task 7) ✓; dogfood verify (Task 8) ✓. No install heal by design (no note bodies touched).
- **Naming consistency:** `computeFence`, `wrapSelection`, `wrapActiveEditor`, `_syncButtons`, `_refreshEnabled`, `_onClick`, `_registerCommand`, class `sauce-code-fence-action`, command id `code-fence-button:wrap-selection` — used identically across tasks.
- **Distribution to consumers (accuris/headspace/ero)** is intentionally NOT in this plan — it happens post-release/brew, per the design's Distribution section and the run's final phase.
```

