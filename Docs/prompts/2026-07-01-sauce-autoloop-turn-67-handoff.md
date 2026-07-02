# Sauce Autoloop Turn 67 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** work — shipped platform-wide customjs-guard class-ref resolution gate as PR #162 (auto-merge armed); Gate A green, Gate B L1 behavioral:false (test-only, clean)
**Card:** Cross-blueprint templating and render consistency audit (W0 guardrail, platform-wide)
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Updating Wiring PR2 - move dialog]]
- [[Project Doc Updating Wiring PR3 - bulk move dialog]]
- [[Project Links Wiring PR2 - link dialogs]]
- [[Project Links Wiring PR3 - existing-project backfill]]
- [[Project Doc Move Cross-Project]]
- [[Cross-blueprint templating and render consistency audit]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Workstreams Hub Slice 2 - repoint readers to Map note]]
- [[Workstreams Hub Slice 3 - relocate manager to Map note]]
- [[Workstreams Hub Slice 4 - version-gated data-preserving heal]]
- [[Workstreams Hub Slice 5 - remove hub surface + relabel nav button]]
- [[Workstreams Hub Slice 6 - docs + convention alignment]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Cross-blueprint templating and render consistency audit]]

## Notes
- deploy: action=none. v0.163.1 is TAGGED (7bc1579b) but its brew bottle is not published yet, so the latest INSTALLABLE is still 0.163.0 and all 3 vaults are current at 0.163.0 (allOk). A later turn syncs 0.163.1 once its bottle builds.
- reconcile=idle (last turn recorded merged substrate PR #160). No Blocked card had a user response (Slices 2-6 + 2 others still parked). Selector picked the Cross-blueprint consistency audit roadmap card again (recommended + top-of-Planning); its W0 was already shipped by #160, so this turn advanced the audit W0 GUARDRAIL deliverable.
- SHIPPED PR #162 (branch autoloop/consistency-audit-classref-guard, auto-merge armed): a PLATFORM-WIDE customjs-guard class-ref resolution gate. Extends the existing preflight-wired run-customjs-loadable.js with a 2nd gate (CJS-REF): every customjs-guard {class:"X"} literal ref across ALL 13 blueprints + mechanisms (templates/content/manifest inline_body) must resolve to a shipped `class X` DEFINITION. Same "_X unavailable_" failure the finance InvoiceNavButtons bug caused. #160 shipped a FINANCE-SCOPED regression lock (run-finance-template-classes.js); #162 is the platform-wide guardrail — the finance one is now effectively a subset (candidate for a future cleanup/removal, deferred to avoid churning a just-shipped file).
- DESIGN NOTE: resolves against actual `class X` DEFINITIONS (customJS runtime truth — it loads the shipped .js files, not the manifest customjs_classes[]), so shipped-but-uncatalogued classes (project ProjectActivityPanel/ProjectOpenTasks — audit finding C7) do NOT false-positive. A manifest-based platform-wide guard WOULD have false-positived on those.
- GATES: Gate A green (release:preflight exit 0 with CJS-LOAD 192 files + CJS-REF 280 refs/0 unresolved; dogfood install clean exit 0). Gate B L1 = behavioral:false (test-only: the only changed file is platform/test/run-customjs-loadable.js, a testFile) -> Gate B not required, skipped honestly (NO override needed — this is the clean placement that last turn`s .md-only fix lacked). Proven red on a synthetic dead ref, green on HEAD.
- AUDIT ROADMAP STATUS: W0 [BREAKING] finance fix SHIPPED (#160, v0.163.1) + W0 guardrail now PLATFORM-WIDE (#162). REMAINING work needs DECOMPOSITION into per-wave cards (as the card itself states) and, in one case, a USER DECISION: (a) `{{DATE}}` token — products/teams content use `created: {{DATE}}` which leaks a literal (no DATE substitution var exists), BUT the gold-standard PROJECT blueprint + trips ALSO use `{{DATE}}` in templates, so this is a platform convention decision (is {{DATE}} an accepted install-time-literal, or migrate all to `<% tp.file.creation_date %>`?), not a products/teams-only fix — do NOT fix piecemeal. (b) Cleanly-autoloopable remaining findings are thin: dead ProductActionButtons/TeamActionButtons removal (products/teams unsubscribed everywhere -> low value), unguarded dv.current() in people/cowork/meetings (adds render-safe deps -> manifest/version churn). The big waves (note-chrome adoption x9 blueprints, {{views_path}}-vs-ranch/views sweep) are large + convention-laden. RECOMMEND: decompose the audit card into per-wave board cards + make the {{DATE}} decision before the loop grinds it further.
- CONCURRENCY: turn-lock acquire returned wasStale:true AGAIN at turn start (a headless turn crashed without releasing its lock; dead-pid override). No worktree/branch mess left behind, tree clean on main. The dual-scheduler (20m /loop cron + launchd 2h) collision from turn 65/66 remains a live risk (see [[lesson_autoloop_cron_overlap_shared_git_tree]]); user was asked to drop one scheduler.
