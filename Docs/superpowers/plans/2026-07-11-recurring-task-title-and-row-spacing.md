# Recurring-Task Title Corruption + Row Separator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real per-row separator to every task-row surface, and clean up (plus prevent recurrence of) a title-corruption bug where a legacy registry migration baked a manually-typed "✅ &lt;date&gt;" completion annotation into a recurring task's `title` frontmatter (and hence its filename).

**Architecture:** One CSS change in the shared `TaskTodayList.renderTaskRow` (a real `border-bottom` replacing an inert transparent placeholder). One new pure helper `_stripCompletionEmojiSuffix` in `platform/install.js`, applied at the one place a legacy registry line's title is parsed (`_parseRecurringRegistry`) so future migrations can't reintroduce the bug. One small extension to the already-shipped, ungated, idempotent `applyTaskNoteHeal` — a third heal condition (clean a corrupted title + rename to match) alongside its existing "rename ugly filename" / "inject missing chrome" jobs, reusing its existing backup/dedupe/rename infrastructure.

**Tech Stack:** CustomJS (Obsidian), `platform/install.js` (Templater-driven installer), Node test harness (`platform/test/run-task-entity.js`, `platform/test/run-seed-migrations.js`).

**Spec:** `docs/superpowers/specs/2026-07-11-recurring-task-title-and-row-spacing-design.md`

---

### Task 1: Row separator in `TaskTodayList.renderTaskRow`

**Files:**
- Modify: `platform/mechanisms/task-entity/task-today-list.js:284`
- Test: `platform/test/run-task-entity.js`

- [ ] **Step 1: Write the failing test**

Add this test to `platform/test/run-task-entity.js`, right after the existing `RTR-SUB-2` test:

```javascript
// RTR-DIV-1. Row separator: renderTaskRow's row element carries a real
// (non-transparent) border-bottom hairline, so tasks read as visually
// distinct rows on narrow (mobile) viewports instead of a dense undifferentiated
// block. Uses var(--background-modifier-border-hover), NOT the plain
// --background-modifier-border, which this project has already found reads as
// near-invisible on dark themes (see the project-blueprint divider precedent).
ok('RTR-DIV-1 renderTaskRow row has a real border-bottom divider color (not transparent)', () => {
  const container = makeRowStubEl('div');
  const task = { title: 'Task', path: 'spice/tasks/Task.md' };
  const row = TaskTodayList.renderTaskRow(container, task, null);
  assert(/border-bottom:\s*1px solid var\(--background-modifier-border-hover\)/.test(row.style.cssText || ''),
    'row must have a real border-bottom divider, got: ' + row.style.cssText);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node platform/test/run-task-entity.js`
Expected: FAIL — the current row style has no `border-bottom` declaration.

- [ ] **Step 3: Implement the divider**

In `platform/mechanisms/task-entity/task-today-list.js`, find:

```javascript
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent; width: 100%; box-sizing: border-box;';
```

Replace it with (adds bottom padding + a real border-bottom color after the transparent shorthand — CSS text order means the later `border-bottom` wins over the earlier `border` shorthand's bottom edge):

```javascript
        row.style.cssText = 'display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; padding: 4px 6px 8px; border-radius: 4px; border: 1px solid transparent; border-bottom: 1px solid var(--background-modifier-border-hover); width: 100%; box-sizing: border-box;';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node platform/test/run-task-entity.js`
Expected: PASS — `RTR-DIV-1` passes, and all prior tests (which only check for the presence of other style fragments, not the full string) still pass.

- [ ] **Step 5: Verify the CustomJS load gate still accepts the file**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add platform/mechanisms/task-entity/task-today-list.js platform/test/run-task-entity.js
git commit -m "fix(task-entity): add a real row-separator hairline to renderTaskRow"
```

---

### Task 2: `_stripCompletionEmojiSuffix` helper + fix `_parseRecurringRegistry`

**Files:**
- Modify: `platform/install.js`
- Test: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Write the failing tests**

Add this test block to `platform/test/run-seed-migrations.js`. A good insertion point is right before the `// ===== HC-V0202-SEED-MIGRATE-RECURRING-*` comment (search for that exact string) — insert immediately above it:

```javascript
// ===== STRIP-EMOJI-* / HC-REGISTRY-TITLE-* — _stripCompletionEmojiSuffix +
// _parseRecurringRegistry title-cleanup (direct unit tests, no seed-vault
// fixture needed — mirrors the require(../install.js) pattern already used
// elsewhere in this file for pure-function checks) =====
{
    const { _stripCompletionEmojiSuffix, _parseRecurringRegistry } = require("../install.js");

    ok("STRIP-EMOJI-1 strips a trailing checkmark + date, with surrounding whitespace",
       _stripCompletionEmojiSuffix("Pay Rent ✅ 2026-07-06") === "Pay Rent");
    ok("STRIP-EMOJI-1b tolerates no space before the date",
       _stripCompletionEmojiSuffix("Feed the dogs ✅2026-06-17") === "Feed the dogs");
    ok("STRIP-EMOJI-2 leaves a title with no such suffix unchanged",
       _stripCompletionEmojiSuffix("Call Dog Trainer back") === "Call Dog Trainer back");
    ok("STRIP-EMOJI-3 null/empty input never throws",
       _stripCompletionEmojiSuffix(null) === "" && _stripCompletionEmojiSuffix("") === "");

    const registryBody = [
        "## Recurring Tasks",
        "- [x] Pay Rent ✅ 2026-07-06 [recurrence:: every day]",
        "- [ ] Water plants [recurrence:: every 3 days]",
        "## Last 7 days",
    ].join("\n");
    const entries = _parseRecurringRegistry(registryBody);
    const payRent = entries.find((e) => e.title.indexOf("Pay Rent") === 0);
    ok("HC-REGISTRY-TITLE-1 checked line with a manually-typed completion annotation yields a clean title",
       payRent && payRent.title === "Pay Rent", `got: ${JSON.stringify(payRent)}`);
    const waterPlants = entries.find((e) => e.title.indexOf("Water plants") === 0);
    ok("HC-REGISTRY-TITLE-1b an unaffected line is untouched",
       waterPlants && waterPlants.title === "Water plants", `got: ${JSON.stringify(waterPlants)}`);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-seed-migrations.js`
Expected: FAIL — `_stripCompletionEmojiSuffix` is not exported (undefined), and `_parseRecurringRegistry`'s title for the `Pay Rent` entry still contains "✅ 2026-07-06".

- [ ] **Step 3: Implement the helper and wire it in**

In `platform/install.js`, add the new helper right before `_parseRecurringRegistry` (search for `function _parseRecurringRegistry(content) {`):

```javascript
// _stripCompletionEmojiSuffix — strips a trailing "✅ YYYY-MM-DD" annotation
// (tolerant of surrounding/missing whitespace) from a title string. The
// legacy Recurring Tasks.md registry supported CHECKED lines
// (`- [x] Pay Rent ✅ 2026-07-06 [recurrence:: every day]`) where a user had
// manually typed a checkmark + completion date as free text (a common
// personal habit-tracking convention) — NOT a structured `[field:: value]`
// annotation, so the existing inline-field strip in _parseRecurringRegistry
// never touched it, and it survived verbatim into the migrated task note's
// title (and, via TaskEntity.taskFilename, its filename). Pure,
// null-tolerant (→ ""); a title with no such suffix passes through
// unchanged; never throws.
function _stripCompletionEmojiSuffix(title) {
  const s = String(title == null ? "" : title);
  return s.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/, "").trim();
}
```

Then find the title computation inside `_parseRecurringRegistry`:

```javascript
    const title = rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, "").trim();
```

Replace it with:

```javascript
    const title = _stripCompletionEmojiSuffix(rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, "").trim());
```

- [ ] **Step 4: Export the two new/reused functions**

Find `module.exports._sanitizeTaskTitleForFilename = _sanitizeTaskTitleForFilename;` in `platform/install.js`'s exports block and add two lines right after it:

```javascript
    module.exports._stripCompletionEmojiSuffix = _stripCompletionEmojiSuffix;
    module.exports._parseRecurringRegistry = _parseRecurringRegistry;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node platform/test/run-seed-migrations.js`
Expected: PASS — all `STRIP-EMOJI-*` and `HC-REGISTRY-TITLE-*` assertions pass, and the full suite is still `492/492` (or higher, plus the new assertions) with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-seed-migrations.js
git commit -m "fix(task-entity): strip manually-typed completion-checkmark annotations from recurring-registry titles"
```

---

### Task 3: Heal existing corrupted titles — extend `applyTaskNoteHeal`

**Files:**
- Modify: `platform/install.js:11527-11696` (the `applyTaskNoteHeal` function)
- Test: `platform/test/run-seed-migrations.js`

- [ ] **Step 1: Write the failing tests**

**IMPORTANT — read this file's actual architecture first, do not assume a simple top-to-bottom script.** `platform/test/run-seed-migrations.js` is built as ONE giant promise chain: a single top-level `withTempVault((vault) => { ... })` call (search for `withTempVault((vault) =>` — there is exactly ONE such call, near the top of the file) whose callback body IS a long `.then(() => runXFamily())` / `.catch((e) => {...})` chain, ending in one `.finally()` that prints the pass/fail summary and calls `process.exit()`. Each `runXFamily()` is a separately-declared `async function runXFamily() { ... }` (e.g. `async function runHomeScaffoldHealFamily() { ... }`, search for its exact definition and read it in full as your template — it creates its OWN isolated temp vault(s) via `fs.mkdtempSync(path.join(os.tmpdir(), "sauce-<name>-"))`, NOT the shared outer `vault`), and is threaded into the chain with its own `.then(() => runXFamily())` + matching `.catch((e) => { ...; fail++; failures.push("...-FAMILY"); })` pair. Do NOT write a standalone `withTempVault((root) => {...})` call for this task's tests — that pattern is used exactly once in this file (the outermost wrapper) and a second call would run outside the chain the `.finally()` summary/exit depends on, so its assertions would race the process exit and might not be counted.

Add a new family function, modeled directly on `runHomeScaffoldHealFamily` (copy its exact helper shapes: `freshVault()`, `readVault(root, rel)`, `existsVault(root, rel)`, `writeFixture(root, rel, content)`, `mkTp(root)`), anywhere among the other `runXFamily` function declarations (e.g. right after `runHomeScaffoldHealFamily`'s closing `}`):

```javascript
async function runTaskHealTitleCleanupFamily() {
    const install = require("../install.js");
    const git = { commit: "test", tag: "test", dirty: false };
    const roots = [];
    const freshVault = () => {
        const r = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-taskheal-title-"));
        roots.push(r);
        return r;
    };
    const readVault = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
    const existsVault = (root, rel) => fs.existsSync(path.join(root, rel));
    const writeFixture = (root, rel, content) => {
        const f = path.join(root, rel);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, content);
    };
    const mkTp = (root) => ({ app: { vault: { adapter: makeFsAdapter(root) } } });

    const corruptedBody = (title) => [
        "---", "type: task", "title: " + title, "status: open",
        "due: 2026-07-10", "recurrence: every day", "priority:", "project:",
        "project_slug:", "source: migrated-from-registry", "source_note:",
        "links: []", "created_at: 2026-07-08T23:47:39.078Z", 'completed_at: ""', "---", "",
        "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });', "```",
        "", "---", "",
        "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });', "```",
        "", "---", "", "<!-- TASK_NOTES -->", "",
    ].join("\n");

    try {
        // ----- 1. Corrupted title -> cleaned + renamed; clean note untouched; idempotent -----
        {
            const root = freshVault();
            const CORRUPTED = "spice/tasks/Pay Rent ✅ 2026-07-06.md";
            const CLEAN = "spice/tasks/Feed the cat.md";
            writeFixture(root, CORRUPTED, corruptedBody("Pay Rent ✅ 2026-07-06"));
            const cleanBody = corruptedBody("Feed the cat").replace("2026-07-08T23:47:39.078Z", "2026-07-08T23:47:39.078Z"); // same shape, clean title
            writeFixture(root, CLEAN, cleanBody);

            const tp = mkTp(root), history = [];
            await install.applyTaskNoteHeal(tp, history, git);

            ok("HC-TASKHEAL-TITLE-1 corrupted note GONE from its original path",
               !existsVault(root, CORRUPTED));
            ok("HC-TASKHEAL-TITLE-1b renamed to the clean 'Pay Rent.md'",
               existsVault(root, "spice/tasks/Pay Rent.md"));

            const healed = existsVault(root, "spice/tasks/Pay Rent.md") ? readVault(root, "spice/tasks/Pay Rent.md") : "";
            ok("HC-TASKHEAL-TITLE-1c frontmatter title cleaned to 'Pay Rent'",
               /^title:\s*Pay Rent\s*$/m.test(healed), `got frontmatter: ${healed.slice(0, 200)}`);
            ok("HC-TASKHEAL-TITLE-1d other frontmatter fields preserved (due/recurrence/status)",
               /^due:\s*2026-07-10\s*$/m.test(healed) && /^recurrence:\s*every day\s*$/m.test(healed) && /^status:\s*open\s*$/m.test(healed));
            ok("HC-TASKHEAL-TITLE-1e .sauce-backup snapshot written",
               fs.existsSync(path.join(root, ".sauce-backup")));

            ok("HC-TASKHEAL-TITLE-2 a clean note is left completely untouched",
               readVault(root, CLEAN) === cleanBody);

            // ----- Pass 2: idempotency -----
            const history2 = [];
            await install.applyTaskNoteHeal(tp, history2, git);
            ok("HC-TASKHEAL-TITLE-3 second pass is a no-op — 'Pay Rent.md' unchanged",
               readVault(root, "spice/tasks/Pay Rent.md") === healed);
            ok("HC-TASKHEAL-TITLE-3b second pass does not create a ' 2' duplicate",
               !existsVault(root, "spice/tasks/Pay Rent 2.md"));
        }

        // ----- 2. Collision: a pre-existing "Pay Rent.md" forces a dedupe rename -----
        {
            const root = freshVault();
            writeFixture(root, "spice/tasks/Pay Rent.md", [
                "---", "type: task", "title: Pay Rent", "status: open", "due: 2026-07-11",
                "recurrence:", "priority:", "project:", "project_slug:", "source: daily",
                "source_note:", "links: []", "created_at: 2026-07-01T00:00:00Z", 'completed_at: ""',
                "---", "", "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "TaskChromeBar" });', "```",
                "", "---", "", "```dataviewjs", 'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });', "```",
                "", "---", "", "<!-- TASK_NOTES -->", "",
            ].join("\n"));
            writeFixture(root, "spice/tasks/Pay Rent ✅ 2026-07-06.md", corruptedBody("Pay Rent ✅ 2026-07-06"));

            const tp = mkTp(root), history = [];
            await install.applyTaskNoteHeal(tp, history, git);
            ok("HC-TASKHEAL-TITLE-4 collision dedupes to 'Pay Rent 2.md'",
               existsVault(root, "spice/tasks/Pay Rent 2.md"));
        }
    } finally {
        for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch (_e) {} }
    }
}
```

Then thread it into the chain: find `.then(() => runHomeScaffoldHealFamily())` and its immediately-following `.catch((e) => { ... "HC-HOME-SCAFFOLD-FAMILY" ... })` block (this is currently the LAST family in the chain, right before `.finally()`), and insert a new `.then()`/`.catch()` pair for the new family AFTER it, still before `.finally()`:

```javascript
    .then(() => runTaskHealTitleCleanupFamily())
    .catch((e) => {
        console.log(`  FAIL HC-TASKHEAL-TITLE-FAMILY threw — ${e && e.message}`);
        fail++;
        failures.push("HC-TASKHEAL-TITLE-FAMILY");
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node platform/test/run-seed-migrations.js`
Expected: FAIL — `applyTaskNoteHeal` doesn't yet clean corrupted titles, so `Pay Rent ✅ 2026-07-06.md` is left in place and `HC-TASKHEAL-TITLE-1`/`1b`/`1c` fail.

- [ ] **Step 3: Implement the title-cleanup extension**

In `platform/install.js`, inside `applyTaskNoteHeal`, find:

```javascript
        const needsRename = OLD_NAME_RE.test(stemNoExt);
        const needsChrome = !before.includes(MARKER);
```

Replace it with (adds title-cleanup detection and folds it into `needsRename`):

```javascript
        const needsTitleCleanup = rawTitle !== _stripCompletionEmojiSuffix(rawTitle);
        const cleanTitle = needsTitleCleanup ? _stripCompletionEmojiSuffix(rawTitle) : rawTitle;
        const needsRename = OLD_NAME_RE.test(stemNoExt) || needsTitleCleanup;
        const needsChrome = !before.includes(MARKER);
```

Then find (a few lines below, inside the `if (needsRename)` branch):

```javascript
        if (needsRename) {
          const desired = _sanitizeTaskTitleForFilename(rawTitle) + ".md";
```

Replace it with (uses `cleanTitle` instead of `rawTitle`, so both the ugly-timestamp-filename case and the title-corruption case compute their target filename from the SAME clean value):

```javascript
        if (needsRename) {
          const desired = _sanitizeTaskTitleForFilename(cleanTitle) + ".md";
```

Then find:

```javascript
        let content = needsChrome ? _injectChrome(before)
          : (needsChromeUpgrade ? _upgradeChrome(before) : before);
```

Replace it with (adds the frontmatter `title:` rewrite, scoped strictly to the frontmatter block so a user's own free-text notes below the marker are never touched):

```javascript
        let content = needsChrome ? _injectChrome(before)
          : (needsChromeUpgrade ? _upgradeChrome(before) : before);
        if (needsTitleCleanup) {
          const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---)/.exec(content);
          if (fmMatch) {
            const fixedFm = fmMatch[1].replace(/^title:\s*.*$/m, "title: " + cleanTitle);
            content = fixedFm + content.slice(fmMatch[1].length);
          }
        }
```

Also update this function's doc-comment (right above `async function applyTaskNoteHeal(tp, history, git) {`) to mention the third job — find the line `//   2. INJECT CHROME into bare notes: ...` and add a third bullet after it:

```
//   3. CLEAN a corrupted title: a `title:` frontmatter value carrying a
//      trailing "✅ YYYY-MM-DD" annotation (baked in by a legacy
//      registry-migration parsing bug — see _stripCompletionEmojiSuffix) is
//      cleaned in place, and the note is renamed to match via the SAME
//      rename path job 1 uses (desired filename now always derives from the
//      clean title, whichever job triggered the rename).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node platform/test/run-seed-migrations.js`
Expected: PASS — all `HC-TASKHEAL-TITLE-*` assertions pass, and the full suite total passes with 0 failures (re-run `npm run release:preflight`'s seed-migrations line count to confirm no regression in the pre-existing `HC-TASKHEAL-SEED-*`/`HC-TE-SURF-*` assertions from the earlier ChromeBar cycle — those exercise the SAME function's other two jobs and must be unaffected).

- [ ] **Step 5: Verify the CustomJS load gate + full task-entity suite are unaffected**

Run: `node platform/test/run-customjs-loadable.js`
Expected: PASS.

Run: `node platform/test/run-task-entity.js`
Expected: PASS (this task doesn't touch that file).

- [ ] **Step 6: Commit**

```bash
git add platform/install.js platform/test/run-seed-migrations.js
git commit -m "fix(task-entity): applyTaskNoteHeal cleans corrupted recurring-task titles and renames to match"
```

---

### Task 4: Full preflight + PR

**Files:** none (verification + git/gh only)

- [ ] **Step 1: Run the full preflight suite**

Run: `npm run release:preflight`
Expected: PASS — whole-suite green bar, including `run-seed-migrations.js` (with the new `STRIP-EMOJI-*` / `HC-REGISTRY-TITLE-*` / `HC-TASKHEAL-TITLE-*` assertions) and `run-task-entity.js`.

- [ ] **Step 2: Self-install dogfood check**

Run: `node platform/install.js --vault . --auto-approve`
Expected: succeeds with no NEW errors beyond the pre-existing, unrelated `section-explorer` dependency skip for `project`/`wiki` (confirmed unrelated in the two prior cycles). Discard any self-install-materialized file drift afterward — do not commit it; the PR diff must stay scoped to this task's 3 commits.

- [ ] **Step 3: Confirm the branch is up to date with `origin/main`**

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git log --oneline HEAD..origin/main
```

If `origin/main` has moved, merge it in (`git merge origin/main --no-edit`) and re-run `npm run release:preflight` to confirm it's still green post-merge — resolve any conflicts carefully (check `package.json`'s `release:preflight` script chain in particular, which has needed manual conflict resolution in each of the last two cycles when a concurrent release lands new test entries).

- [ ] **Step 4: Push the branch**

```bash
git push -u origin worktree-recurring-task-completion-and-mobile-spacing
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(task-entity): row separator + recurring-task title-corruption cleanup" --body "$(cat <<'EOF'
## Summary
- Adds a real per-row separator hairline to every task-row surface (daily, project, meeting, subtask list) via the shared `TaskTodayList.renderTaskRow` — was previously an inert transparent placeholder, making rows read as one dense block on mobile.
- Fixes a legacy-migration bug where a manually-typed "✅ <date>" completion annotation (from the old Recurring Tasks.md registry's checked-line format) got baked verbatim into a recurring task's `title` frontmatter and filename during the one-time registry-to-note-per-task migration. Fixed at the source (`_parseRecurringRegistry`) so it can't recur, and healed for the two already-affected notes (and any others like them) via an extension to the existing `applyTaskNoteHeal`.
- Traced and confirmed the recurring roll-forward math itself (`TaskDialog._rollForwardDate`) is correct — the "shows as open even though completed" symptom was fully explained by the corrupted title visually mimicking a done state; no roll-forward logic change was needed.

## Test plan
- [x] `npm run release:preflight` green
- [x] `node platform/install.js --vault . --auto-approve` (workshop self-install/dogfood)
- [ ] CI green on this PR (macos-latest + ubuntu-latest)

Design spec: docs/superpowers/specs/2026-07-11-recurring-task-title-and-row-spacing-design.md
Implementation plan: docs/superpowers/plans/2026-07-11-recurring-task-title-and-row-spacing.md
EOF
)"
```

---

## After this plan: review, release, deploy (not plan tasks — orchestration steps)

Same sequence as the two prior cycles (`Docs/agent-guides/build-test-verify.md`):

1. Dispatch a final holistic code-reviewer subagent over the whole diff (all 3 code commits) before merge — pay particular attention to whether `applyTaskNoteHeal`'s title-cleanup extension could interact badly with its two EXISTING jobs (ugly-filename rename, chrome injection/upgrade) on a note that needs more than one fix at once, and whether the frontmatter-scoped `title:` regex replace is airtight against a user's own body text.
2. Wait for CI green on both `macos-latest` and `ubuntu-latest`, then merge the PR (squash).
3. The release pipeline auto-bumps the version and auto-merges the release PR — do not hand-edit versions/tags or merge the release PR yourself.
4. After the release PR merges, wait for `tag-and-ship` to tag `v<X.Y.Z>` and auto-merge the Homebrew tap PR.
5. `brew upgrade sauce`, then deploy to accuris, headspace, and ero via `sauce update --bump-pins` in each vault (existing, already-subscribed mechanism — version bump only).
6. Verify live in headspace: `spice/tasks/Pay Rent.md` and `spice/tasks/Feed the dogs.md` exist with clean titles (the old `✅`-suffixed filenames gone), and the daily ToDo note's task rows show a visible separator between each row.
