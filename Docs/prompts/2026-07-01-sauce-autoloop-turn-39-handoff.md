# Sauce Autoloop Turn 39 — handoff

**Date:** 2026-07-01
**Mode:** live
**Outcome:** block-with-questions — card explicitly asked to brainstorm + get questions; posted 6 design decisions (each with a recommended default) to the card and moved it to Blocked for the user's reply
**Card:** Project Links
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Project Doc Updating]]
- [[Figure out Why Opening up a New Tab always opens up in Edit Mode]]
- [[To do tasks daily and other]]

### In Progress
- [[Workstreams in Projects need updating]]

### Blocked
- [[Project Links]]

## Recommended next
- **Card:** [[Next turn: leave Project Links Blocked (awaiting user reply) and pick the next fresh Planning card ([[Project Doc Updating]]). When the user answers Project Links, the loop implements the Helpful Links feature.]]

## Notes
- deploy (Phase A step 3): action=none — installable brew bottle is STILL 0.152.1. v0.153.0 is tagged (package.json 0.153.0) but its brew bottle hasn't published across several turns now, so the projects-hub feature (v0.153.0) is not on the vaults yet. FLAG for the user: if the 0.153.0 bottle stays unpublished, the release->brew-tap build may be worth a look (pipeline's domain, not touched here). The two earlier features (0.152.0/0.152.1) remain live.

reconcile: idle. Selector picked 'Project Links'. That card EXPLICITLY asks to brainstorm + get questions back ('brainstorm with me here, think about it and respond back with some questions'), so this turn used block-with-questions rather than implementing.

BLOCKED-WITH-QUESTIONS (card: Project Links): the feature is a per-project 'Helpful Links' surface (a form to add {url,text} links + a section/button to view them + add/delete/edit management). Posted 6 design decisions to the card, each with a RECOMMENDED default so the user can just say 'yes to all' or tweak: (1) storage = hub `links` frontmatter array vs a dedicated Links note; (2) access = a 'Helpful Links' nav button opening a panel, inline section, or both; (3) add-form fields = url + text only vs extra optional field; (4) manage UX = workstream-manager-style edit/delete; (5) scope = reusable `links` mechanism wired to project-only vs strictly project; (6) click-opens-external + order-added (reorder/grouping deferred). Card moved to Blocked (board + frontmatter). parseBlockedResponse confirms hasSection:true, hasResponse:false.

No workshop code changed this turn (block-with-questions is card+board only — no worktree, no PR). Next turn: Phase A reconcile leaves Project Links Blocked until the user replies, then Phase B picks a fresh Planning card ([[Project Doc Updating]]). When the user answers Project Links, the loop implements it.

Standing: [[Workstreams in Projects need updating]] epic still parked in In Progress; its plan slices want Planning cards.
