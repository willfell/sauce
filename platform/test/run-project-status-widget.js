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
if(fails.length){console.log(`\n${fails.length} FAILED`);process.exit(1);} console.log("\nAll project-status-widget tests passed.");
