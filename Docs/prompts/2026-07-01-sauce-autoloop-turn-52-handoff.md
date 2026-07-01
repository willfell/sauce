# Sauce Autoloop Turn 52 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** block-with-questions (card too big for one bounded turn) — Selected 'Project Links Wiring' (idle -> Planning) but digging into the wiring showed phase-2 is too large + landmine-dense for one clean gated turn: doing it right adds a project->links dependency (cascades into wizard DEFAULT_MECHANISMS_CHECKED + seed subscription + manifest + a links-hub breadcrumb type + entity-create + button + helper + template + tests) and its highest-value pieces (add/delete/modify dialogs) are dogfood-only/untestable. Blocked with a concrete 3-slice decomposition (PR1 foundation / PR2 dialogs+hub-display / PR3 backfill heal) + real trade-offs (dep strategy, heal-now-vs-later, dogfood acceptance); 'yes to all' unblocks. No code/PR this turn.
**Card:** Project Links Wiring
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Updating Wiring]]
- [[Project Doc Move Cross-Project]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Project Links Wiring]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

## Recommended next
- **Card:** [[Project Doc Updating Wiring]]

## Notes
- Deploy (Phase A step 3): action=none, all 3 vaults current at 0.157.0 (links + DocMove + paycheck all shipped + LIVE). Release pipeline caught up. This turn: reconcile idle -> both existing Blocked cards ('New Tab Edit Mode' no reply; 'To do tasks daily' awaiting the user's post-research option pick) still blocked -> Phase B picked 'Project Links Wiring' from Planning -> on inspection it's an oversized, convention-touching, dogfood-heavy phase-2 feature -> block-with-questions (per the 'don't force it / small diffs only' guardrail) rather than ram a sprawling risky change. Card moved to Blocked with a 3-PR plan + defaults. LOOP STATE NOTE: the feature pipeline is now largely GATED ON THE USER. Blocked (3): Project Links Wiring (decomposition decision), 'To do tasks daily and other' (task-redesign option pick, research delivered turn 51), 'New Tab Edit Mode' (no reply). Planning (2): Project Doc Updating Wiring (also a large phase-2 with the SAME dep/dogfood shape -> likely blocks similarly next turn), Project Doc Move Cross-Project (explicitly gated behind Doc Updating Wiring). So within ~1-2 turns the loop will have no fresh board work to implement without user input and will fall through to the Scout queue / bounded bug-hunt. NEXT TURN: Phase B picks 'Project Doc Updating Wiring' (recommended next) — expect another decomposition block unless it can be sliced small. If both wiring cards end blocked, subsequent turns go to Scout/bug-hunt (discovery) until the user answers. Standing flags: release-PR BEHIND churn (durable fix = release.yml auto-update-branch, needs user/workflow-YAML); context7 MCP tool erroring this session (used WebSearch/WebFetch).
