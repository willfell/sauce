# Sauce Autoloop Turn 17 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** implemented -> PR opened — override turn-lock when the holder pid is dead — fixes the stale-lock wedge you hit; auto-merge armed
**Card:** lock-liveness-pid-check (PR #101)
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[Project buttons]]
- [[Daily Hub Scratch Notes]]
- [[Project Card Separator Fix]]

### In Progress
- (empty)

### Blocked
- [[Workstreams in Projects need updating]]
- [[To Do number on daily note to show to items for all]]
- [[Editing To Do Items in a Project]]

## Recommended next
- **Card:** [[reconcile-inflight-merged-ledger]]

## Notes
- MANUAL LAUNCH via /loop 2h (cron f76bd38d) — the turn found the single-turn lock held by a DEAD pid 50003 (crashed prior turn, never released). Root cause: lockState only overrode a lock after 30min / garbage / clock-skew; it NEVER checked holder liveness, so a crash wedged every later turn for up to 30min. Released the stale lock, acquired fresh, and made the fix itself the turns work. FIX (PR #101, autoloop/lock-liveness-pid-check): lockState gains a tri-state pidAlive 4th param (false=KNOWN-dead ESRCH -> override now; true/null/undefined -> time-only, never stomp a live/unidentifiable holder) + a pidAlive(pid) helper (process.kill(pid,0): EPERM->alive, ESRCH->dead, bad-pid->null); CLI probes holderPid. Backward-compatible (3-arg callers byte-identical). Gate A preflight 134/134 + install exit0; Gate B L1 adequate; Gate B L2 panel 1/3 refute (test-adequacy flagged the ESRCH->false branch unpinned) -> addressed with TL-12 (reaped-child pid reads dead) + TL-13 (EPERM alive); a ESRCH->null mutation now fails TL-12. Auto-merge armed; merges on green CI. RECONCILE this turn = merged #91 (heal-legacy-project-hub-headings) but that card is ALREADY in Completed -> this is the long-standing merged-DEADLOCK (reconcile-inflight.js has no reconciled-PR ledger; it re-fires merged for the most-recent terminal autoloop PR forever). Handled per the 10+-turn workaround: treat merged-but-already-closed as IDLE. NOTE: PR #101 will BECOME the most-recent autoloop PR on merge, so next turns reconcile will fire merged #101 -> keep treating as idle until the ledger ships. DEPLOY (Phase A step 7): action=none — ERO/accuris/headspace all current at 0.147.2 (origin/main advanced to v0.147.2 / release #100 during the turn). No vault action needed. RECOMMENDED NEXT = ship the reconcile merged-deadlock LEDGER (the #1 remaining substrate gap for 10+ turns; now that the lock-liveness wedge is fixed, the ledger is the last thing blocking a clean idle->select each turn). Board also has 3 Blocked cards awaiting Wills in-card replies (Workstreams in Projects need updating; To Do number on daily note; Editing To Do Items in a Project) and 4 fresh Planning cards.
