#!/usr/bin/env node
// run-v01271-today-capture-renderer-heal.js — behavioral harness for the v0.127.1 PATCH.
// Asserts that _healNoteChromeBody step 6 injects BOTH the TODAY_CAPTURE_MARKER
// sentinel AND the EditableTaskList dataviewjs renderer block — closing
// the v0.127.0 gap where the marker landed but the renderer didn't, leaving
// existing pre-deploy daily notes with the anchor but no editable list UI.
//
// v0.128.0 update: the renderer class was renamed from TodayCaptureEditableList
// to EditableTaskList (with explicit sectionAnchor arg). Heal step 6 (b) now
// injects the canonical EditableTaskList form directly; the (b) guard accepts
// either canonical OR legacy class names so v0.127.x notes carrying the legacy
// invocation aren't double-injected. Heal step 6 (c) rewrites any remaining
// legacy invocations to canonical on subsequent passes. This harness was
// updated to assert on the canonical class name in the heal output, with a
// dedicated case (HC-V01271-TCRH-G) verifying back-compat against bodies that
// already ship the legacy class string.

const path = require('path');
const install = require(path.join(__dirname, '..', 'install.js'));
const { _healNoteChromeBody } = install;

const TODAY_LABEL = 'class: "SectionLabel", args: [{ text: "Today", top: true }]';
const TODAY_MARKER = '<!-- TODAY_CAPTURE_MARKER -->';
const RENDERER_CLASS = 'class: "EditableTaskList"';
const LEGACY_RENDERER_CLASS = 'class: "TodayCaptureEditableList"';

const TODO_NOTE_NO_MARKER = `---
type: to-do
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
\`\`\`

- [ ] some pre-existing task

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });
\`\`\`
`;

const TODO_NOTE_MARKER_ONLY = `---
type: to-do
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
\`\`\`

<!-- TODAY_CAPTURE_MARKER -->
- [ ] task from a v0.127.0 heal pass

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ToDoDailyCarryover" });
\`\`\`
`;

const TODO_NOTE_FULLY_HEALED = `---
type: to-do
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });
\`\`\`

<!-- TODAY_CAPTURE_MARKER -->

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "EditableTaskList", args: [{ sectionAnchor: "todayCapture" }] });
\`\`\`
`;

const TODO_NOTE_NO_TODAY_LABEL = `---
type: to-do
---

# Some daily note with no Today SectionLabel block at all.
`;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

function countOccurrences(s, needle) {
  let n = 0, i = 0;
  while ((i = s.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// HC-V01271-TCRH-A — fresh heal: both marker AND renderer get injected on a
// note that has neither.
{
  const out = _healNoteChromeBody(TODO_NOTE_NO_MARKER, 'to-do');
  ok(out.includes(TODAY_MARKER), 'HC-V01271-TCRH-A1: marker injected');
  ok(out.includes(RENDERER_CLASS), 'HC-V01271-TCRH-A2: renderer block injected');
  ok(countOccurrences(out, TODAY_MARKER) === 1, 'HC-V01271-TCRH-A3: exactly one marker');
  ok(countOccurrences(out, RENDERER_CLASS) === 1, 'HC-V01271-TCRH-A4: exactly one renderer');
  // Order check: SectionLabel → marker → renderer → existing content.
  const slIdx = out.indexOf(TODAY_LABEL);
  const mkIdx = out.indexOf(TODAY_MARKER);
  const rnIdx = out.indexOf(RENDERER_CLASS);
  ok(slIdx < mkIdx && mkIdx < rnIdx, 'HC-V01271-TCRH-A5: order is SectionLabel → marker → renderer');
}

// HC-V01271-TCRH-B — back-fill: note already has the marker (v0.127.0 heal
// half-pass) but no renderer. Patch should inject ONLY the renderer.
{
  const out = _healNoteChromeBody(TODO_NOTE_MARKER_ONLY, 'to-do');
  ok(out.includes(RENDERER_CLASS), 'HC-V01271-TCRH-B1: renderer injected on marker-only note');
  ok(countOccurrences(out, TODAY_MARKER) === 1, 'HC-V01271-TCRH-B2: marker not duplicated');
  ok(countOccurrences(out, RENDERER_CLASS) === 1, 'HC-V01271-TCRH-B3: renderer not duplicated');
  // The user's existing task line MUST survive verbatim.
  ok(out.includes('- [ ] task from a v0.127.0 heal pass'), 'HC-V01271-TCRH-B4: existing user task preserved');
}

// HC-V01271-TCRH-C — idempotency: fully-healed note → no-op (after === before).
{
  const out = _healNoteChromeBody(TODO_NOTE_FULLY_HEALED, 'to-do');
  ok(out === TODO_NOTE_FULLY_HEALED, 'HC-V01271-TCRH-C1: fully-healed note unchanged');
}

// HC-V01271-TCRH-D — no anchor: no Today SectionLabel block at all → no marker,
// no renderer, no throw.
{
  const out = _healNoteChromeBody(TODO_NOTE_NO_TODAY_LABEL, 'to-do');
  ok(!out.includes(TODAY_MARKER), 'HC-V01271-TCRH-D1: no marker when no anchor');
  ok(!out.includes(RENDERER_CLASS), 'HC-V01271-TCRH-D2: no renderer when no anchor');
}

// HC-V01271-TCRH-E — wrong type: type:meeting note is NOT touched by step 6
// (step 6 is to-do-only).
{
  const out = _healNoteChromeBody(TODO_NOTE_NO_MARKER.replace('type: to-do', 'type: meeting'), 'meeting');
  ok(!out.includes(TODAY_MARKER), 'HC-V01271-TCRH-E1: meeting type does not trigger today-marker inject');
  ok(!out.includes(RENDERER_CLASS), 'HC-V01271-TCRH-E2: meeting type does not trigger today-renderer inject');
}

// HC-V01271-TCRH-F — second pass: re-running on the output of TCRH-A is a no-op.
{
  const first = _healNoteChromeBody(TODO_NOTE_NO_MARKER, 'to-do');
  const second = _healNoteChromeBody(first, 'to-do');
  ok(first === second, 'HC-V01271-TCRH-F1: second pass is a no-op (idempotent)');
}

console.log('');
if (fail === 0) {
  console.log(`PASS ${pass}/${pass + fail}`);
  process.exit(0);
} else {
  console.log(`FAIL ${fail}/${pass + fail}`);
  process.exit(1);
}
