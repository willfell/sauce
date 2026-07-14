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
let CFB, cfb;
try {
  CFB = new Function("app", "customJS", "Notice", "window", src + "\nreturn CodeFenceButton;")(
    undefined, undefined, function () {}, undefined);
  // customJS exposes each class as an INSTANCE (customJS.CodeFenceButton === new
  // CodeFenceButton()), so the runtime reaches methods via an instance — mirror
  // that here. A static method would be undefined on the instance at runtime.
  cfb = new CFB();
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

// Pass 1b — instance-method contract. customJS hands consumers an INSTANCE, so
// every public method MUST be an instance method; a `static` method would be
// undefined on customJS.CodeFenceButton at runtime (the v0.2.1 "unavailable" bug).
console.log("\n--- Pass 1b: instance-method contract ---");
for (const meth of ["computeFence", "wrapSelection", "buttonState", "wrapActiveEditor", "computeInlineTicks", "wrapInline", "wrapActiveEditorInline"]) {
  assertTrue(`CFB-INST-${meth}: reachable on instance`, cfb && typeof cfb[meth] === "function");
  assertTrue(`CFB-INST-${meth}: NOT static (undefined on class)`, typeof CFB[meth] === "undefined");
}

// Pass 2 — computeFence
console.log("\n--- Pass 2: computeFence ---");
assertEq("CFB-1: no backticks → 4", cfb.computeFence("hello world"), "````");
assertEq("CFB-2: contains 3 → 4", cfb.computeFence("a ``` b"), "````");
assertEq("CFB-3: contains 4 → 5", cfb.computeFence("x ```` y"), "`````");
assertEq("CFB-4: contains 5 → 6", cfb.computeFence("`````"), "``````");

console.log("\n--- Pass 3: wrapSelection ---");
// Full-line selection: no extra leading/trailing newline; fence on its own line.
assertEq("CFB-5: full-line wrap",
  cfb.wrapSelection("x", { atLineStart: true, atLineEnd: true }),
  { text: "````\nx\n````", cursor: "````\nx\n````".length });
// Mid-line selection: leading + trailing newline guard.
assertEq("CFB-6: mid-line wrap",
  cfb.wrapSelection("x", { atLineStart: false, atLineEnd: false }),
  { text: "\n````\nx\n````\n", cursor: "\n````\nx\n````\n".length });
// Multiline inner text preserved verbatim.
assertEq("CFB-7: multiline inner preserved",
  cfb.wrapSelection("a\nb", { atLineStart: true, atLineEnd: true }).text,
  "````\na\nb\n````");
// Empty selection → null (caller no-ops).
assertEq("CFB-8: empty → null", cfb.wrapSelection("   ", { atLineStart: true, atLineEnd: true }), null);
// Cursor lands after the closing fence.
const w9 = cfb.wrapSelection("hi", { atLineStart: true, atLineEnd: true });
assertEq("CFB-9: cursor after block", w9.cursor, w9.text.length);

// Pass 4 — buttonState (mode + selection → enabled/opacity/label). Drives the
// view-header button's greyed/lit affordance + tooltip.
console.log("\n--- Pass 4: buttonState ---");
// Reading (preview) mode: never enabled, discoverable opacity, "switch to editing" hint.
const bsPrev = cfb.buttonState("preview", true);
assertEq("CFB-10: preview never enabled", bsPrev.enabled, false);
assertEq("CFB-11: preview label = switch-to-editing", bsPrev.label, "Switch to editing mode to wrap in a code fence");
assertEq("CFB-12: disabled opacity is discoverable (>=0.5)", bsPrev.opacity >= 0.5, true);
// Editable, no selection: greyed, "select text" hint.
const bsNoSel = cfb.buttonState("source", false);
assertEq("CFB-13: editable no-selection disabled", bsNoSel.enabled, false);
assertEq("CFB-14: editable no-selection label", bsNoSel.label, "Select text to wrap in a code fence");
// Editable + selection: enabled, full opacity, action label.
const bsOn = cfb.buttonState("source", true);
assertEq("CFB-15: editable + selection enabled", bsOn.enabled, true);
assertEq("CFB-16: enabled opacity = 1", bsOn.opacity, 1);
assertEq("CFB-17: enabled label = wrap", bsOn.label, "Wrap selection in code fence");
// Inline kind → inline-code phrasing in the tooltips.
assertEq("CFB-18: inline preview label", cfb.buttonState("preview", true, "inline").label, "Switch to editing mode to wrap in inline code");
assertEq("CFB-19: inline no-selection label", cfb.buttonState("source", false, "inline").label, "Select text to wrap in inline code");
assertEq("CFB-20: inline enabled label", cfb.buttonState("source", true, "inline").label, "Wrap selection in inline code");

// Pass 5 — inline code (single-backtick) wrapping.
console.log("\n--- Pass 5: inline code ---");
assertEq("CFB-21: plain text → 1 tick", cfb.computeInlineTicks("hello"), "`");
assertEq("CFB-22: contains 1 tick → 2 ticks", cfb.computeInlineTicks("a ` b"), "``");
assertEq("CFB-23: plain wrap = single backticks", cfb.wrapInline("hello").text, "`hello`");
assertEq("CFB-24: cursor after closing tick", (() => { const w = cfb.wrapInline("hi"); return w.cursor === w.text.length; })(), true);
assertEq("CFB-25: empty → null", cfb.wrapInline("   "), null);
// Content containing a backtick → 2-tick delimiter + space padding (CommonMark).
assertEq("CFB-26: backtick content padded", cfb.wrapInline("a ` b").text, "`` a ` b ``");
// Content touching a backtick at an edge → padded even at 1-tick-longest.
assertEq("CFB-27: edge backtick padded", cfb.wrapInline("`x").text, "`` `x ``");

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("\n" + failures.join("\n"));
process.exit(fail ? 1 : 0);
