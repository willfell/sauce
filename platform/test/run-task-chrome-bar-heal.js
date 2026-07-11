#!/usr/bin/env node
'use strict';

// run-task-chrome-bar-heal.js — unit harness for task-entity's ChromeBar-heal
// wiring: _healNoteChromeBody / _healChromeBarMigration as PURE string
// transforms (no DOM, no fs) against synthetic `type: task` note bodies.
// Mirrors the assertion style of run-chrome-bar-cycle3-heal.js /
// run-meetings-hub-chrome-bar-heal.js. Prints "N passed, M failed"; exits 0
// iff M === 0.

const install = require('../install.js');
const _healNoteChromeBody = install._healNoteChromeBody;

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

// ---- top-level task note: bare SpaceNavButtons, no Breadcrumb block (the
// actual current shape TaskEntity._chromeBody() emits pre-fix) ----
{
  const before = `---
type: task
title: "Groceries"
status: open
due: ""
recurrence: ""
priority: ""
project: ""
project_slug: ""
source: ""
source_note: ""
parent_task: ""
links: []
created_at: "2026-07-11T09:00:00-06:00"
completed_at: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });
\`\`\`

---

<!-- TASK_NOTES -->
`;
  const after = _healNoteChromeBody(before, 'task');
  ok('TASK-HEAL-1: task note heal inserts TaskChromeBar', after.includes('class: "TaskChromeBar"'));
  ok('TASK-HEAL-2: task note heal strips the legacy bare SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
  ok('TASK-HEAL-3: task note heal leaves TaskNoteView + the TASK_NOTES marker intact', after.includes('class: "TaskNoteView"') && after.includes('<!-- TASK_NOTES -->'));
  const again = _healNoteChromeBody(after, 'task');
  ok('TASK-HEAL-4: idempotent — a second heal pass is a no-op', again === after);
}

// ---- subtask note: same shape, parent_task set (heal doesn't care — it's
// keyed on type, not parent_task) ----
{
  const before = `---
type: task
title: "tmp-subtask"
status: open
due: ""
recurrence: ""
priority: ""
project: ""
project_slug: ""
source: ""
source_note: ""
parent_task: "[[Groceries]]"
links: []
created_at: "2026-07-11T10:00:00-06:00"
completed_at: ""
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });
\`\`\`

---

<!-- TASK_NOTES -->
`;
  const after = _healNoteChromeBody(before, 'task');
  ok('TASK-HEAL-5: subtask note heal also inserts TaskChromeBar', after.includes('class: "TaskChromeBar"'));
  ok('TASK-HEAL-6: subtask note heal also strips SpaceNavButtons', !after.includes('class: "SpaceNavButtons"'));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
