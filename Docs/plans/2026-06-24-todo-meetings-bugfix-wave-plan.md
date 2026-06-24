# to-do + meetings bug-fix wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Spec: `Docs/plans/2026-06-24-todo-meetings-bugfix-wave-design.md`.

**Goal:** Fix six post-v0.131.0 regressions in the to-do + meetings + daily surfaces (false Notes badge, blank auto-created to-do note, non-editable dialog tasks, carryover loss, missing button dividers, meeting attendees error flash).

**Architecture:** Pure-helper + template fixes only — no stored-state migration (new-notes-only per user). Four file-disjoint work-units (A–D) can be implemented independently; each adds TDD coverage to an EXISTING preflight harness. After all units land, one workshop dogfood self-install syncs `platform/` → `ranch/` (required by run-renderer's byte-identical check) before full preflight.

**Tech Stack:** Zero-dep Node test harnesses (`new Function` class loaders, `ok(label,cond,detail)` idiom), CustomJS classes, Obsidian Templater templates.

**Non-negotiables:** Do NOT hand-bump versions/manifests/pins/tags (release pipeline owns it). Conventional commits only. No `Co-Authored-By: Claude` trailer in this repo. Optional-chain all `customJS.X` access. Generalized list-marker class is exactly `[-*+]` (hyphen, asterisk, plus).

---

## Work-unit A — marker generalization + carryover data-safety (#4A, #4B)

**Files:**
- Modify: `platform/blueprints/to-do/helpers/task-parser.js`
- Modify: `platform/blueprints/to-do/helpers/todo-daily-carryover.js`
- Modify: `platform/blueprints/to-do/helpers/today-capture-editable-list.js`
- Modify: `platform/mechanisms/task-interactions/task-interactions.js`
- Test: `platform/test/run-task-parser.js`, `run-todo-carryover.js`, `run-task-interactions.js`

### A1 — generalize task-line regexes to `[-*+]`

- [ ] **task-parser.js** `parseTasks`: replace the four task regexes:
  - `const isUnchecked = /^- \[ \] /.test(line);` → `/^[-*+] \[ \] /`
  - `const isChecked = /^- \[x\] /i.test(line);` → `/^[-*+] \[x\] /i`
  - both child-boundary checks `if (/^- \[(?: |x)\] /i.test(next)) break;` → `/^[-*+] \[(?: |x)\] /i` (there are two: one in the unchecked branch, one in the checked-skip branch).
- [ ] **todo-daily-carryover.js** `_fallbackParse`: same four swaps (`/^- \[ \] /`→`/^[-*+] \[ \] /`; `/^- \[x\] /i`→`/^[-*+] \[x\] /i`; both `/^- \[(?: |x)\] /i`→`/^[-*+] \[(?: |x)\] /i`).
- [ ] **task-interactions.js**: `parseTaskLine` L≈49 `/^- \[[ xX]\] (.*)$/`→`/^[-*+] \[[ xX]\] (.*)$/`; `findTaskLines` L≈240 `/^- \[[ xX]\] /`→`/^[-*+] \[[ xX]\] /`; `replaceTaskAt` guard L≈412 `/^- \[[ xX]\] /`→`/^[-*+] \[[ xX]\] /`.
- [ ] **today-capture-editable-list.js**: L≈71 `/^- \[[xX]\] /`→`/^[-*+] \[[xX]\] /`; L≈78 `.replace(/^- \[[ xX]\] /, '')`→`.replace(/^[-*+] \[[ xX]\] /, '')`.

> Leave the meetings open/done count regexes (`/- \[ \]/g`) untouched — out of scope, cosmetic-only, risk of mid-line match changes.

### A2 — carryover ordering: write today before stripping prior

- [ ] **todo-daily-carryover.js** `materialize`: keep the in-memory computation, then SWAP the two final writes so today is written first:
```js
        // v0.X (#4B): write TODAY first so a mid-operation failure DUPLICATES
        // (recoverable) rather than DELETES (silent loss). Only strip the prior
        // file after today is safely persisted. Satisfies "never lose a to-do item".
        await vault.modify(todayFile, todayWithSentinel);
        await vault.modify(priorFile, newPrior);
```
(was `modify(priorFile, newPrior)` then `modify(todayFile, todayWithSentinel)`.)

### A3 — tests

- [ ] **run-task-parser.js**: add cases after TM-7 (use the existing `ok(...)` idiom + the loaded `TaskParser`):
```js
// TM-8: asterisk + plus bullets parse as top-level tasks (#4A).
(() => {
    const md = '---\ntype: to-do\n---\n* [ ] star task\n+ [ ] plus task\n- [ ] dash task';
    const blocks = TaskParser.parseTasks(md);
    ok('TM-8 mixed-marker count', blocks.length === 3, `got ${blocks.length}`);
    ok('TM-8 star top line', blocks[0] && blocks[0].topLine === '* [ ] star task');
    ok('TM-8 plus top line', blocks[1] && blocks[1].topLine === '+ [ ] plus task');
})();
// TM-9: nested children under a * parent carry; * [x] checked is skipped (#4A).
(() => {
    const md = '---\ntype: to-do\n---\n* [ ] parent\n   * detail line\n* [x] done parent\n   * done detail\n* [ ] after';
    const blocks = TaskParser.parseTasks(md);
    ok('TM-9 unchecked count (checked skipped)', blocks.length === 2, `got ${blocks.length}`);
    ok('TM-9 child captured', blocks[0] && blocks[0].childLines.length === 1, `got ${blocks[0] && blocks[0].childLines.length}`);
    ok('TM-9 child text', blocks[0] && blocks[0].childLines[0] === '   * detail line');
    ok('TM-9 second is "after"', blocks[1] && blocks[1].topLine === '* [ ] after');
})();
```
- [ ] **run-task-interactions.js**: add cases (match its `eq`/`ok` idiom + the in-memory world) asserting `parseTaskLine('* [ ] x [priority:: high]')` returns `{title:'x', priority:'high'}` and `findTaskLines` over content with `* [ ]` / `+ [ ]` lines at fence-depth 0 returns those rows. Label `HC-V0127-TI-MARKER-*`.
- [ ] **run-todo-carryover.js**: add (a) an `eligibleBlocks` case proving a `* [ ] regular task` is returned, and (b) a behavioral materialize ordering test. Paste this self-contained block (uses a minimal moment shim + in-memory vault; `ToDoDailyCarryover` is already loaded at top of file):
```js
// CARR-ORDER: materialize writes TODAY before stripping PRIOR; a today-write
// failure leaves the prior file intact (no data loss) (#4B).
(async () => {
    const p2 = (n) => String(n).padStart(2, '0');
    const monthName = (mo) => ['January','February','March','April','May','June','July','August','September','October','November','December'][mo-1];
    const makeMoment = (s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        const base = { y:+m[1], mo:+m[2], d:+m[3] };
        const wrap = (o) => ({
            clone: () => wrap({ ...o }),
            subtract: (n) => { const dt = new Date(Date.UTC(o.y,o.mo-1,o.d)); dt.setUTCDate(dt.getUTCDate()-n); return wrap({y:dt.getUTCFullYear(),mo:dt.getUTCMonth()+1,d:dt.getUTCDate()}); },
            format: (f) => f === 'YYYY/MM-MMMM' ? `${o.y}/${p2(o.mo)}-${monthName(o.mo)}` : `${o.y}-${p2(o.mo)}-${p2(o.d)}`,
        });
        return wrap(base);
    };
    const prior = '---\ntype: to-do\n---\n- [ ] carry me';
    const today0 = '---\ntype: to-do\n---\n<dvjs>ToDoDailyCarryover</dvjs>'.replace('<dvjs>ToDoDailyCarryover</dvjs>',
        '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });\n```');
    function world(throwOnToday) {
        const files = {
            'spice/to-do/2026/06-June/ToDo-2026-06-22.md': { path:'spice/to-do/2026/06-June/ToDo-2026-06-22.md', body: prior },
            'spice/to-do/2026/06-June/ToDo-2026-06-23.md': { path:'spice/to-do/2026/06-June/ToDo-2026-06-23.md', body: today0 },
        };
        const order = [];
        global.window = {
            moment: makeMoment,
            app: { vault: {
                getAbstractFileByPath: (p) => files[p] || null,
                read: async (f) => f.body,
                modify: async (f, c) => {
                    if (throwOnToday && f.path.endsWith('06-23.md')) throw new Error('boom');
                    order.push(f.path.endsWith('06-23.md') ? 'today' : 'prior');
                    f.body = c;
                },
            } },
        };
        return { files, order };
    }
    const inst = new ToDoDailyCarryover();
    const w1 = world(false);
    await inst.materialize('spice/to-do/2026/06-June/ToDo-2026-06-23.md', '2026-06-23');
    ok('CARR-ORDER today written before prior', w1.order[0] === 'today' && w1.order[1] === 'prior', `order=${w1.order.join(',')}`);
    const w2 = world(true);
    await inst.materialize('spice/to-do/2026/06-June/ToDo-2026-06-23.md', '2026-06-23');
    ok('CARR-ORDER prior intact when today-write fails', w2.files['spice/to-do/2026/06-June/ToDo-2026-06-22.md'].body === prior, 'prior was mutated despite today failure');
    delete global.window;
})();
```
> If `run-todo-carryover.js` ends with a synchronous tally, wrap the new async IIFE so the tally awaits it (mirror `run-todo-dialog.js`'s `pendingAsync`/`Promise.all` pattern) — or place the async block and convert the final tally to run after it. Verify the file's existing tail before editing.

- [ ] **Verify A:** `node platform/test/run-task-parser.js && node platform/test/run-todo-carryover.js && node platform/test/run-task-interactions.js` → all PASS.

---

## Work-unit B — full auto-created scaffold + editable insertion + dividers (#2, #3, #5)

**Files:**
- Modify: `platform/blueprints/to-do/helpers/todo-create-task.js`
- Modify: `platform/blueprints/to-do/templates/Today To-Do.md`
- Test: `platform/test/run-todo-dialog.js`

### B1 — `_insertLineUnderSection`: today tasks land AFTER the marker (#3)

- [ ] In `_insertLineUnderSection(content, line, payload)`, BEFORE the existing SectionLabel-anchor logic, add a today-only marker branch:
```js
        // #3: for the today daily, insert AFTER the stable TODAY_CAPTURE_MARKER so
        // the new task falls inside TodayCaptureEditableList's scan window
        // (findTaskLines(_, 'todayCapture') scans only below the marker). Mirrors
        // TaskInteractions.appendTask's to-do branch. SectionLabel-anchor logic
        // below remains the fallback for notes without the marker.
        const isToday = !(payload.mode === 'recurring')
            && !(payload.destination && payload.destination.type === 'project');
        if (isToday) {
            const MARK = '<!-- TODAY_CAPTURE_MARKER -->';
            const mi = content.indexOf(MARK);
            if (mi !== -1) {
                const insertPos = mi + MARK.length;
                const head = content.slice(0, insertPos);
                const tail = content.slice(insertPos).replace(/^\n+/, '');
                return head + `\n${line}\n` + (tail ? '\n' + tail : '');
            }
        }
```
(Leave the rest of the method unchanged as fallback.)

### B2 — `_initialBodyFor` (today) emits the FULL scaffold (#2)

- [ ] Add a pure static helper:
```js
    /**
     * #2: build the full daily-to-do body. If `templateContent` looks like the
     * materialized Today To-Do template, substitute the Templater creation_date
     * token (inherits the correct vault tag + live block list). Otherwise emit a
     * hardcoded full scaffold. `isoNow` is the YYYY-MM-DDTHH:mm:ssZ timestamp.
     */
    static _todayBody(templateContent, isoNow) {
        const TOKEN = /<%\s*tp\.file\.creation_date\([^)]*\)\s*%>/g;
        if (typeof templateContent === 'string'
            && templateContent.includes('TODAY_CAPTURE_MARKER')
            && templateContent.includes('TodayCaptureEditableList')) {
            return templateContent.replace(TOKEN, isoNow);
        }
        return [
            '---', 'type: to-do', `created_at: "${isoNow}"`, 'cssclasses:', '  - wide', '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });', '```', '',
            '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoLeafActions" });', '```', '',
            '---', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });', '```', '',
            '<!-- TODAY_CAPTURE_MARKER -->', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyRecurring" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyProjectGroups" });', '```', '',
            '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyUnassignedMeetings" });', '```', '',
        ].join('\n');
    }
```
- [ ] In `_initialBodyFor(payload, dest)`, replace the final (today) `return [...]` minimal stub with:
```js
        // #2: full daily scaffold. Try the materialized template (correct vault
        // tag + live blocks), fall back to the hardcoded scaffold.
        const isoNow = (window && window.moment) ? window.moment().format('YYYY-MM-DDTHH:mm:ssZ') : new Date().toISOString();
        let tpl = null;
        try {
            const tf = window.app && window.app.vault && window.app.vault.getAbstractFileByPath('ranch/templates/Today To-Do.md');
            if (tf) tpl = await window.app.vault.read(tf);
        } catch (_e) { /* fall back to hardcoded */ }
        return ToDoCreateTask._todayBody(tpl, isoNow);
```
(Keep the recurring + project-todo branches above it unchanged.)

### B3 — template dividers (#5)

- [ ] In `platform/blueprints/to-do/templates/Today To-Do.md`, bracket the `ToDoLeafActions` block with `---` rules (match `Meeting.md`). Result around that block:
```
```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "ToDoLeafActions" });
```

---

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
```
```
- [ ] Mirror the SAME `_todayBody` hardcoded fallback dividers (already included above) so dialog-created notes match the template.

### B4 — tests (run-todo-dialog.js)

- [ ] Add (using the loaded `ToDoCreateTask`, `new Function('window', ...)` already provides `window`):
```js
// DLG-MARK: today task inserts AFTER the TODAY_CAPTURE_MARKER (#3).
(() => {
    const inst = new ToDoCreateTask();
    const content = [
        '---','type: to-do','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });','```','',
        '<!-- TODAY_CAPTURE_MARKER -->','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });','```',
    ].join('\n');
    const out = inst._insertLineUnderSection(content, '- [ ] new one', { destination: 'today' });
    const markIdx = out.indexOf('<!-- TODAY_CAPTURE_MARKER -->');
    const taskIdx = out.indexOf('- [ ] new one');
    ok('DLG-MARK task after marker', taskIdx > markIdx, `marker@${markIdx} task@${taskIdx}`);
})();
// DLG-SCAFFOLD: _todayBody fallback contains the full chrome (#2).
(() => {
    const body = ToDoCreateTask._todayBody(null, '2026-06-24T09:00:00-06:00');
    ok('DLG-SCAFFOLD has marker', body.includes('<!-- TODAY_CAPTURE_MARKER -->'));
    ok('DLG-SCAFFOLD has editable list', body.includes('TodayCaptureEditableList'));
    ok('DLG-SCAFFOLD has carryover', body.includes('ToDoDailyCarryover'));
    ok('DLG-SCAFFOLD has leaf actions', body.includes('ToDoLeafActions'));
    ok('DLG-SCAFFOLD dividers around buttons', body.split('---').length >= 4);
})();
// DLG-SCAFFOLD-TPL: when given the materialized template, substitutes the date token.
(() => {
    const tpl = '---\ntype: to-do\ncreated_at: "<% tp.file.creation_date(\"YYYY-MM-DDTHH:mm:ssZ\") %>"\ntags:\n  - "accuris"\n---\n<!-- TODAY_CAPTURE_MARKER -->\nTodayCaptureEditableList';
    const body = ToDoCreateTask._todayBody(tpl, '2026-06-24T09:00:00-06:00');
    ok('DLG-SCAFFOLD-TPL token substituted', body.includes('2026-06-24T09:00:00-06:00') && !body.includes('tp.file.creation_date'));
    ok('DLG-SCAFFOLD-TPL keeps vault tag', body.includes('"accuris"'));
})();
```
- [ ] **Verify B:** `node platform/test/run-todo-dialog.js` → PASS. Also `npm run lint-note-chrome` → PASS (template divider grammar).

---

## Work-unit C — scaffold-aware "has notes" (#1)

**Files:**
- Modify: `platform/blueprints/daily/helpers/space-daily-dashboard.js` (`_enrichMeeting`)
- Modify: `platform/blueprints/meetings/helpers/meetings-hub-cards.js` (enrich loop)
- Test: `platform/test/run-renderer.js`

### C1 — shared pure helper (identical copy in both files)

- [ ] Add this static to BOTH `SpaceDailyDashboard` and `MeetingsHubCards` (byte-identical body so behavior agrees):
```js
  /**
   * #1: does the meeting body carry REAL notes content, ignoring scaffold?
   * Strips frontmatter, fenced code blocks, HTML comments, horizontal rules,
   * heading lines, task lines (any of -,*,+ markers), and lone/empty bullets;
   * "has notes" iff > 5 non-whitespace chars remain. Works on SectionLabel-shaped
   * AND legacy ## Notes notes. Keys on scaffold SHAPE, not on the "Notes" label
   * (lint-display-markers).
   */
  static _bodyHasNotes(content) {
    if (typeof content !== "string" || !content) return false;
    let body = content;
    const fmEnd = body.indexOf("\n---", 4);
    if (body.indexOf("---") === 0 && fmEnd >= 0) body = body.slice(fmEnd + 4);
    body = body.replace(/```[\s\S]*?```/g, "");          // fenced blocks
    body = body.replace(/<!--[\s\S]*?-->/g, "");          // HTML comments (markers)
    body = body
      .split("\n")
      .filter((l) => !/^\s*---+\s*$/.test(l))             // horizontal rules
      .filter((l) => !/^\s*[-*+]\s*\[[ xX]\]/.test(l))    // task lines (-,*,+)
      .filter((l) => !/^\s*[-*+]\s*$/.test(l))            // lone/empty bullets
      .filter((l) => !/^#+\s/.test(l))                    // heading lines
      .join("\n");
    return body.replace(/\s/g, "").length > 5;
  }
```

### C2 — wire it in

- [ ] **space-daily-dashboard.js** `_enrichMeeting`: replace the `## Notes` + body-fallback block (the `let hasNotes = false; ... ` through the `if (body.replace(/\s/g,"").length > 20) hasNotes = true;`) with:
```js
    const hasNotes = SpaceDailyDashboard._bodyHasNotes(content);
```
- [ ] **meetings-hub-cards.js** enrich loop: replace
```js
      const notesSection = content.match(/## Notes\s*([\s\S]*?)(?=---|##|$)/);
      const hasNotes = notesSection && notesSection[1].trim().length > 5;
```
with
```js
      const hasNotes = MeetingsHubCards._bodyHasNotes(content);
```

### C3 — tests (run-renderer.js)

- [ ] Load both classes (the file already loads `SpaceDailyDashboard` via `new Function`; add a `MeetingsHubCards` load the same way from `platform/blueprints/meetings/helpers/meetings-hub-cards.js`). Add, using the file's existing `ok`/`eq` idiom:
```js
// REND-HASNOTES: blank SectionLabel meeting → false; with notes → true (#1).
(() => {
  const blank = [
    '---','type: meeting','---','',
    '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Agenda" }] });','```','',
    '-','',
    '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });','```','',
    '<!-- ACTION_ITEMS_MARKER -->','',
    '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });','```',
  ].join('\n');
  const withNotes = blank.replace('<!-- ACTION_ITEMS_MARKER -->', 'We discussed the Q3 roadmap and next steps in detail.\n<!-- ACTION_ITEMS_MARKER -->');
  ok('REND-HASNOTES blank → false (SDD)', SpaceDailyDashboard._bodyHasNotes(blank) === false, `got ${SpaceDailyDashboard._bodyHasNotes(blank)}`);
  ok('REND-HASNOTES notes → true (SDD)', SpaceDailyDashboard._bodyHasNotes(withNotes) === true);
  ok('REND-HASNOTES blank → false (hub)', MeetingsHubCards._bodyHasNotes(blank) === false);
  ok('REND-HASNOTES notes → true (hub)', MeetingsHubCards._bodyHasNotes(withNotes) === true);
})();
```
- [ ] **Verify C:** `node platform/test/run-renderer.js` → the NEW REND-HASNOTES cases PASS. (The byte-identical platform↔ranch REND check will fail until the main-session dogfood self-install; that is expected and handled in the integration step — do NOT self-install from inside this work-unit.) Also run `npm run lint-display-markers` → PASS.

---

## Work-unit D — meeting attendees error flash (#6)

**Files:**
- Modify: `platform/blueprints/meetings/templates/Meeting.md`

- [ ] Replace the PeopleRendering dataviewjs block (the one passing `notePath: dv.current().file.path`) with a guarded multi-line block:
```
```dataviewjs
const cur = dv.current();
const notePath = (cur && cur.file && cur.file.path) || (app.workspace.getActiveFile && app.workspace.getActiveFile()?.path);
if (notePath) {
  await dv.view("{{views_path}}/customjs-guard", {
    class: "PeopleRendering",
    method: "renderMentionList",
    args: [{ mode: "mentioned_in_note", notePath, scopePath: "spice/people" }, { style: "chips" }]
  });
}
```
```
- [ ] **Verify D:** `npm run lint-note-chrome` → PASS (template still well-formed). No unit harness (template-only); covered by manual smoke.

---

## Integration (main session, after A–D land)

- [ ] Review all four diffs together (file-disjoint; no conflicts expected).
- [ ] Dogfood self-install to sync `platform/` → `ranch/`: `node platform/install.js --vault . --auto-approve`.
- [ ] Full preflight: `npm run release:preflight` → whole-suite GREEN (incl. run-renderer byte-identical check now satisfied).
- [ ] Commit per component (conventional commits; NO version edits, NO Claude trailer):
  - `fix(to-do): generalize task markers to -,*,+ and write carryover today-first to prevent loss`
  - `fix(task-interactions): accept -,*,+ list markers in parse/find/replace`
  - `fix(to-do): auto-created daily note gets full scaffold; dialog tasks insert below capture marker; bracket button row with rules`
  - `fix(daily): meeting "has notes" badge ignores scaffold (markers/rules/empty bullets)`
  - `fix(meetings): scaffold-aware has-notes on hub cards; guard dv.current() in Meeting template`
  - (plus the dogfood `ranch/` sync — fold into the relevant commit or a trailing `chore: dogfood self-install sync`.)
- [ ] `git push -u origin cycle/todo-meetings-bugfix-wave`; `gh pr create`; wait for CI green; merge to `main`.
- [ ] Release pipeline (autonomous): `prepare-release` opens the release PR → auto-merges on CI → `tag-and-ship` tags `vX.Y.Z` + patches the brew tap (auto-merges tap PR). Monitor via `gh run watch` / `gh pr list`.
- [ ] `brew upgrade sauce` (serves the new bottle).
- [ ] Deploy to consumers: set workshop local clone to merged `main`; per vault (`ero-sauce` is brew-only, `accuris-sauce` + `headspace-sauce` are local-clone) run `sauce update --bump-pins && sauce status` → expect `Drift: none`. Note to user: Cmd+R in each open Obsidian to load new CustomJS classes (only manual step).
- [ ] Cycle-close artifacts (result / cycle-history / cycle-status / handoff) per build-test-verify § Cycle-close.

## Self-review (plan vs spec)

- Spec #1→C; #2→B2; #3→B1; #4A→A1; #4B→A2; #5→B3; #6→D. All seven covered.
- No placeholders; all test/impl code is literal.
- Names consistent across tasks: `_bodyHasNotes`, `_todayBody`, `_insertLineUnderSection`, `TODAY_CAPTURE_MARKER`, marker class `[-*+]`.
