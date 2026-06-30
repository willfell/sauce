# Sauce Autoloop Turn 5 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** wait (pr-open) — PR #77 open, auto-merge pending. CI: ubuntu preflight GREEN, macOS preflight in-progress, CodeQL neutral/analyze success. Reconcile = pr-open -> the turns work is to wait. BUT the PR was mergeStateStatus:BEHIND because turn-4 pushed its handoff to main after the branch was cut, and main requires up-to-date branches (strict_required:true). Did the mechanical unblock: pushed THIS handoff to main first, then ran `gh pr update-branch 77` so the branch ends the turn current with main and CI re-runs on the up-to-date SHA -> auto-merge can fire once green.
**Card:** Board Note Template Fix from Projects Board
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]

### In Progress
- [[Board Note Template Fix from Projects Board]]

### Blocked
- [[Workstreams in Projects need updating]]
- [[Project Hub Style Fixing]]

## Recommended next
- **Card:** [[Editing To Do Items in a Project]]

## Notes
- SYSTEMIC ISSUE surfaced (worth a substrate fix in Increment 5): the autoloop pushes a handoff commit to main EVERY turn, and main has strict-required up-to-date branches (preflight macos+ubuntu). So any open autoloop PR is pushed BEHIND on the very next turn and can NEVER satisfy the up-to-date gate on its own -> auto-merge stalls forever. GitHub auto-merge did NOT auto-update the head branch here (observed: still BEHIND, CI ran on the stale SHA). Mitigation this turn: order the turn so the handoff lands on main BEFORE `gh pr update-branch`, leaving the branch up-to-date at end-of-turn; CI (~3-5min) should finish inside the ~10min cron gap and merge before the next handoff push. Durable fixes to consider: (a) dont push autoloop handoffs to main while an autoloop PR is open (commit them on the next idle turn, or to the PR branch itself); (b) drop `strict` for the autoloop, or enable GitHubs Auto-update head branches; (c) have Phase A pr-open run update-branch as a first-class step. Card stays In Progress (PR open). Two cards remain Blocked awaiting Wills in-card replies (Project Hub Style Fixing, Workstreams in Projects need updating).
