# Sauce Autoloop Turn 16 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** blocked (needs your input) + canary deployed — Selected the users editable-project-todo card. Mapped the exact fix (reuse the daily hubs TodayCaptureEditableList editable widget on project To-Do notes via a new ownedTasks anchor + marker + template + heal). Its a multi-file feature that REWRITES existing project To-Do notes (real task content) and whose editing UI is Obsidian-runtime (not fully verifiable from Node tests) — too big/high-stakes for one safe bounded turn, so blocked-with-questions WITH the concrete ready-to-execute plan + a heal-consent question (2 questions). Card In Progress -> Blocked; worktree cleaned up.
**Card:** Editing To Do Items in a Project
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]
- [[To Do number on daily note to show to items for all]]
- [[Editing To Do Items in a Project]]

## Recommended next
- **Card:** [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

## Notes
- DEPLOY (Increment 4, first real run): initial deploy.js run FAILED — shipped 0.147.0 but brew upgrade only pulled 0.145.1 (deploy.js didnt `brew update` first). I diagnosed it, ran `brew upgrade sauce` manually (-> 0.147.0 clean, so tap/brew chain is FINE), then re-ran deploy.js -> ERO canary deployed to 0.147.0 (allOk:true). The pipeline ALREADY shipped the root-cause fix: origin/main HEAD is #98 fix(autoloop): brew update before upgrade. So next turn should deploy cleanly, and (ERO having soaked 0.147.0) PROMOTE accuris + headspace to 0.147.0 — which finally puts the v0.146.0 project-hub-heal + all fixes in the users headspace vault (user still Cmd+R in Obsidian). BLOCK RATIONALE: the editable-todo feature needs a content-mutating heal into task-BEARING notes + the click-to-edit only works in Obsidian; getting the users OK before an autonomous heal edits their real task notes is the prudent call, and the block carries the full plan so the next turn ships fast once they answer. Board now has THREE Blocked cards awaiting Wills in-card replies (Workstreams in Projects need updating; To Do number on daily note; Editing To Do Items in a Project) and ONE fresh Planning card (Figure out New-Tab-Edit-Mode = a third-party-plugin runtime investigation, likely another block or not autonomously doable). Substrate healthy; deploy.js brew-step fix already in-flight (#98).
