#!/usr/bin/env node
const fs = require("fs"); const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "blueprints", "project", "helpers", "project-status-widget.js"), "utf8");
const ProjectStatusWidget = new Function(`${src}\nreturn ProjectStatusWidget;`)();
let fails=[]; const ok=(l,c,d)=>{ if(c)console.log("  ok  "+l); else {fails.push(l);console.log("  FAIL "+l+(d?"  "+d:""));} };

ok("PSW-1 STATUSES includes archived", ProjectStatusWidget.STATUSES.includes("archived"), JSON.stringify(ProjectStatusWidget.STATUSES));
ok("PSW-2 COLORS has archived", !!ProjectStatusWidget.COLORS.archived);
// archive stashes prior
{ const fm={status:"in-progress"}; ProjectStatusWidget._applyStatusChange(fm,"archived","2026-07-13");
  ok("PSW-3a status archived", fm.status==="archived"); ok("PSW-3b prior stashed", fm.pre_archive_status==="in-progress"); ok("PSW-3c date", fm.status_changed_at==="2026-07-13"); }
// unarchive clears stash
{ const fm={status:"archived",pre_archive_status:"planning"}; ProjectStatusWidget._applyStatusChange(fm,"planning","2026-07-14");
  ok("PSW-4a status restored-ish", fm.status==="planning"); ok("PSW-4b stash cleared", !("pre_archive_status" in fm)); }
// re-archiving already-archived does not overwrite stash with 'archived'
{ const fm={status:"archived",pre_archive_status:"done"}; ProjectStatusWidget._applyStatusChange(fm,"archived","2026-07-15");
  ok("PSW-5 stash preserved (no self-stash)", fm.pre_archive_status==="done"); }

async function structuralMutationCases() {
  const widget = new ProjectStatusWidget();
  const priorApp = global.app;
  const priorCustomJS = global.customJS;
  const priorDocument = global.document;
  const priorNotice = global.Notice;
  let optimistic = false;
  let reverted = false;
  let focused = false;
  let observedBeforeWrite = false;
  global.document = { activeElement: { focus: () => { focused = true; } } };
  global.Notice = function Notice() {};
  global.app = {
    fileManager: {
      processFrontMatter: async () => {
        observedBeforeWrite = optimistic;
        throw new Error("fixture persistence failure");
      },
    },
    commands: { executeCommandById: () => { throw new Error("global refresh forbidden"); } },
  };
  global.customJS = {
    RenderSafe: {
      mutateStructure: async (opts) => {
        const receipt = await opts.apply();
        try { await opts.write(); return { ok: true, receipt }; }
        catch (error) { await opts.rollback(receipt, error); return { ok: false, error, receipt }; }
      },
    },
  };
  try {
    const result = await widget._writeStatus({}, { path: "spice/projects/x/X.md" }, "done", {
      optimistic: () => { optimistic = true; },
      revert: () => { reverted = true; },
    });
    ok("PSW-6 status UI applies before frontmatter persistence", result === false && observedBeforeWrite);
    ok("PSW-7 failed status persistence invokes exact UI rollback", reverted);
    ok("PSW-8 status rollback restores prior focus without global refresh", focused);
  } finally {
    global.app = priorApp;
    global.customJS = priorCustomJS;
    global.document = priorDocument;
    global.Notice = priorNotice;
  }
}

async function pickerRecoveryCase() {
  const widget = new ProjectStatusWidget();
  const priorApp = global.app;
  const priorCustomJS = global.customJS;
  const priorDocument = global.document;
  const priorNotice = global.Notice;
  const makeEl = () => {
    const el = {
      children: [], parentNode: null, style: {}, textContent: "", innerHTML: "", focused: false,
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { this.children = this.children.filter((candidate) => candidate !== child); child.parentNode = null; },
      remove() { this.parentNode?.removeChild(this); },
      addEventListener() {}, focus() { this.focused = true; },
    };
    return el;
  };
  const body = makeEl();
  const trigger = { focus() {} };
  let rejectWrite = true;
  const history = [];
  global.document = {
    body, activeElement: trigger,
    createElement: () => makeEl(),
    addEventListener() {}, removeEventListener() {},
  };
  global.Notice = function Notice() {};
  global.app = { fileManager: { processFrontMatter: async () => {
    if (rejectWrite) throw new Error("fixture persistence failure");
  } } };
  global.customJS = { RenderSafe: { mutateStructure: async (opts) => {
    const receipt = await opts.apply();
    try { return { ok: true, value: await opts.write(), receipt }; }
    catch (error) { await opts.rollback(receipt, error); return { ok: false, error, receipt }; }
  } } };
  try {
    widget._openPicker({}, { path: "Project.md" }, "idea", ["idea", "planning"],
      ProjectStatusWidget.COLORS, (status) => history.push(status));
    const overlay = body.children[0];
    const dialog = overlay.children[0];
    const planning = dialog.children.find((child) => /planning/.test(child.innerHTML || ""));
    await planning.onclick();
    ok("PSW-9 rejected picker write keeps the exact modal mounted",
      body.children.length === 1 && body.children[0] === overlay);
    ok("PSW-10 rejected picker write restores chip and focuses the retry control",
      history.join(",") === "planning,idea" && planning.focused);
    rejectWrite = false;
    await planning.onclick();
    ok("PSW-11 retry success closes the original modal", body.children.length === 0);
  } finally {
    global.app = priorApp;
    global.customJS = priorCustomJS;
    global.document = priorDocument;
    global.Notice = priorNotice;
  }
}

structuralMutationCases().then(() => pickerRecoveryCase()).then(() => {
  if(fails.length){console.log(`\n${fails.length} FAILED`);process.exit(1);}
  console.log("\nAll project-status-widget tests passed.");
}).catch((error) => { console.error(error && error.stack || error); process.exit(1); });
