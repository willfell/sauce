# Sauce Autoloop Turn 12 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** implemented -> PR opened — NEW install heal applyProjectHubLegacyHeadingCleanup strips the legacy ## Status / ## Workstreams H2 lines from pre-v0.109.0 type:project hubs (the users Sauce.md). Cleanup heal: every-install, idempotent, fence-aware, .sauce-backup, history-logged; SURGICAL guard strips a heading only when it labels its widget block (user-authored ## Status sections preserved). Regression HC-V0127-PHLH-A..E (strip+preserve+backup+history; idempotent; fresh no-op; user-heading kept; empty no-throw). Gate A green (preflight + install exit 0), Gate B L1 adequate, L2 panel PASS (1/3 refute, below >=2; the lone refute was a conservative edge case the verifier itself called recoverable + unshipped-shape, and the correctness lens ran the strip on the real Sauce.md cleanly). PR #91 open, auto-merge armed.
**Card:** Heal legacy Status and Workstreams headings in project hubs
**Version shipped:** (pending release)

## Board snapshot (after this turn)

### In Planning
- [[Editing To Do Items in a Project]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To Do number on daily note to show to items for all]]

### In Progress
- [[Heal legacy Status and Workstreams headings in project hubs]]

### Blocked
- [[Workstreams in Projects need updating]]

## Recommended next
- **Card:** [[To Do number on daily note to show to items for all]]

## Notes
- Closes the #3 (last) split of Project Hub Style Fixing — all four of the users decomposed asks from that card are now shipped or in-flight (divider keep=no-op, button removed v0.142.2, open-tasks link v0.145.1, legacy-H2 heal = PR #91). Built in an isolated worktree per the hardened skill; no collisions. Deadlock-as-idle handled at the top of this turn (merged #88 already-closed -> idle -> selected this card). When #91 ships, the users Sauce.md heals on their next `sauce update` (the literal ## Status/## Workstreams hashtags disappear; widgets stay). REMAINING SUBSTRATE GAP: still just the reconcile merged-deadlock ledger (reconcile-inflight.js has no reconciled-PR tracking) — keep treating merged-but-already-closed as idle. Remaining Planning cards: Editing To Do Items in a Project, Figure out Why Opening up a New Tab (a third-party-plugin runtime investigation — likely a block-with-questions), To Do number on daily note (recommended next, user-added). Workstreams in Projects need updating still Blocked awaiting a reply.
