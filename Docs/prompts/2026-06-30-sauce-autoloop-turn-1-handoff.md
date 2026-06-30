# Sauce Autoloop Turn 1 — handoff

**Date:** 2026-06-30
**Mode:** live
**Outcome:** blocked — out of autonomous scope (multi-part overhaul + 2 convention conflicts + heal migration) — moved to Blocked pending human design
**Card:** Project Hub Style Fixing
**Version shipped:** (no release this turn)

## Board snapshot (after this turn)

### In Planning
- [[Workstreams in Projects need updating]]
- [[Editing To Do Items in a Project]]
- [[Board Note Template Fix from Projects Board]]

### In Progress
- (empty)

### Blocked
- [[Project Hub Style Fixing]]

## Recommended next
- **Card:** [[Workstreams in Projects need updating]]

## Notes
- See the Assessment section below — card decomposed into its constituent asks, with the two note-chrome convention conflicts flagged as decisions for Will.

---

## Assessment — why "Project Hub Style Fixing" was blocked, not implemented

Phase A returned `idle`; Phase B's deterministic selector picked **Project Hub Style Fixing**
as the first in-scope Planning card. The `isBroadScope` heuristic (keyword + 2500-char length)
did **not** flag it — but a read of the card against the platform code + the documented
conventions shows it is broad-scope *in substance*: a multi-part hub overhaul, two of whose asks
**conflict with documented non-negotiable conventions**, plus a piece that needs a heal migration
over existing user content. None of that is a single bounded, regression-testable bug-fix, so per
the autoloop guardrails ("Features remain out of scope", "small diffs only", "STOP if the turn
balloons past scope") I did **not** branch/implement. The card moved to **Blocked** (board +
frontmatter `blocked_reason`) so the loop won't re-pick and churn on it every fire.

The card is genuinely good work — it just needs Will's design decisions first. Decomposition:

### Ask 1 — remove `## Status` / `## Workstreams` H2s from the existing project note
- **Status:** the *blueprint template* (`platform/blueprints/project/templates/Project.md`) is
  **already correct** — it renders `ProjectStatusWidget` / `ProjectWorkstreamManager` helpers,
  no `## H2` headings (per `project-blueprint-ui.md` §2–3). The literal `## Status` /
  `## Workstreams` Will sees live in his **existing** `spice/projects/sauce/Sauce.md` (legacy
  hand-authored body), not in shipped code.
- **Why it needs design:** fixing existing notes means a **heal migration that reshapes user
  content**. Project notes are **not** in the current note-chrome heal `type` scope
  (`applyNoteChromeHeal` keys on `type ∈ {meeting, scratch, scratch-day, to-do}` — project is
  excluded; see `note-chrome.md` §6). Adding project to that scope is a one-time-reshaper change —
  exactly the delicate kind the migration-lifecycle lesson says must be version-gated and designed
  carefully (`Docs/landmines.md`, `lesson_migration_lifecycle_extraction_blocked`). Not an
  autoloop turn.

### Ask 2 — Open Tasks cards link to the board, not the task note  (the one real bug)
- **Confirmed bug:** `platform/blueprints/project/helpers/project-open-tasks.js:37` sets every
  card's `file.path` to `boardPath` (the project's `<slug>-board.md`) and `:45` targets
  `p.file.path` — so clicking any open-task card opens the **Kanban board**, never the task note.
- **Why it needs design, not a blind fix:** Open-task rows are parsed from raw Kanban
  `- [ ] <text>` lines. `<text>` may be a `[[wikilink]]` (→ resolvable to a task note) **or**
  plain text (→ no note exists). Correct behavior is a decision: resolve wikilinks via
  `app.metadataCache.getFirstLinkpathDest(...)` and fall back to the board for plain text? Render
  plain-text rows non-clickable? And the resolution itself is **Obsidian-runtime** (metadata
  cache), so an end-to-end regression test can't run in the Node `platform/test/run-*.js` harness
  — only a pure wikilink-extraction helper could be unit-tested, which the Gate B test-adequacy
  lens would (rightly) flag as not proving the user-facing fix. **This is the most autoloop-able
  slice if Will picks the desired behavior** — recommend splitting it into its own narrow card.

### Ask 3 — "add a `---` separator between the Open Tasks and Meetings sections"
- **Conflicts with a documented convention.** `project-blueprint-ui.md` §3 + `note-chrome.md` §1:
  **"No `---` horizontal rules between sections"** — `SectionLabel` owns dividers (it renders its
  own hairline above the label). The separation Will wants is *supposed* to come from the
  SectionLabel hairline, not a literal `---`. If the current hairline reads as too weak, the fix
  is to the SectionLabel spacing/treatment (a convention change), **not** to add `---`. This is
  Will's call — the autoloop must not unilaterally overturn a documented standard.

### Ask 4 — "move the New Meeting button below the Meetings section"
- **Conflicts with a documented convention.** `project-blueprint-ui.md` §1: the `EntityCreate`
  `+ New <thing>` button is **"Always rendered ABOVE the cards it would seed; always available
  even on empty surfaces."** `project-meetings-panel.js:25–30` follows this deliberately (button
  emits before the optional SectionLabel + cards, so it's present even when there are zero
  meetings). Moving it below the cards would make it vanish on empty surfaces unless the empty-
  state rule also changes. Again — Will's design call, not an autonomous edit.

### Ask 5 — "just clean things up visually, ensure patterns are matched"
- Open-ended polish — not a bounded, testable unit of work.

## Recommended path for Will
1. **Split the card.** The Open-Task link bug (Ask 2) is a clean standalone card the autoloop can
   take **once the target behavior is specified** (wikilink → note, plain text → ?).
2. **Decide the two convention questions** (Asks 3 & 4): keep the no-`---` / button-above
   standards (and instead tune SectionLabel separation), or revise the conventions in
   `project-blueprint-ui.md` + `note-chrome.md` first. A `superpowers:brainstorming` pass fits.
3. **Ask 1** (heal existing project notes) is its own design item — extend the note-chrome heal
   `type` scope to `project` with version-gating, tracked against the migration-lifecycle work.

## Turn mechanics
- Halt sentinel: absent. Tree: clean `main`, in sync `origin/main`, HEAD `81d2812c`.
- Reconcile: `idle` (no in-flight branch/PR).
- No branch created, no workshop source edited, no PR opened, no version touched.
- Board projection (consumer vault): `Project Hub Style Fixing` In Planning → Blocked;
  card frontmatter `status: blocked` + `blocked_reason` set.
- Next fire: `idle` → selector picks **Workstreams in Projects need updating**.
