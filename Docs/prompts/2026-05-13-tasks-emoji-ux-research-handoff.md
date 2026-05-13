# Handoff prompt — Tasks plugin emoji UX research

> Copy-paste the block below into a fresh Claude Code session at the sauce workshop repo (`/Users/willfell/Documents/obsidian/sync/workshop/sauce`).

---

```
I want to resume the Tasks-plugin emoji UX research that v0.41.x deferred.

CANONICAL CONTEXT:
- Read `Docs/plans/2026-05-13-tasks-icon-ux-research.md` end-to-end FIRST. That document is the authoritative spec — it covers what was shipped, what's still gapping, four implementation tracks with tradeoffs, the edit-mode diagnostic protocol, hot-context for code paths / command IDs, decision log, and acceptance criteria.
- Then skim the v0.41.x summary bullet in `CLAUDE.md` Status (live) for the commit trail.
- Do NOT re-derive any of the design decisions captured there. If something looks wrong, point it out as a question, don't quietly redo it.

TWO OPEN PROBLEMS:
1. Tasks plugin suggester popup emojis (📅 due date, ⏫ high priority, etc.) when typing inside a `- [ ]` line.
2. Edit-mode "looks bad" complaint — undiagnosed; may be Live Preview's inherent cursor-line decoration behavior OR a real regression. Diagnostic protocol is in the research doc Phase 1.

PROCESS:
- Invoke the brainstorming skill before any code work — confirm with me which of Track A (CustomJS monkey-patch), Track B (custom WOFF2 webfont with unicode-range), Track C (upstream PR), Track D (plugin replacement) we're committing to.
- Run Phase 1 (diagnostic) FIRST regardless of which track we pick for the suggester — without screenshots and config diffs from both vaults (beacon-poc at `/Users/willfell/Documents/obsidian/sync/workshop/accuris-beacon-poc` vs accuris-sauce at `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`), we can't tell if there's a real edit-mode regression or just Live Preview being Live Preview.
- After brainstorming approval, follow the standard sauce cycle pacing (writing-plans → executing-plans / subagent-driven-development → workshop self-install → tag + push).

NON-NEGOTIABLES:
- Don't re-trigger the v0.41.2-style mistake (switching `taskFormat: "dataview"` — it breaks the rendered-task CSS chain because Tasks plugin only emits .task-due / .task-priority DOM in emoji format).
- Don't regress the existing wins: Cmd+T / Cmd+E / Cmd+Shift+T hotkeys, `sauce-tasks-icons.css` rendered-task swap, reader-view default.
- Keep convenience@0.2.4 as the baseline — bump to 0.3.0 (MINOR) only after the chosen track lands cleanly.

START BY:
1. Reading `Docs/plans/2026-05-13-tasks-icon-ux-research.md`
2. Confirming the canonical state of accuris-sauce (`ls .obsidian/snippets/`, `cat .obsidian/app.json`, `grep taskFormat .obsidian/plugins/obsidian-tasks-plugin/data.json`)
3. Reporting back with: a track recommendation + the smallest reproducible diagnostic question you'd want me to answer before any implementation begins.

Workshop dev-repo path: `/Users/willfell/Documents/obsidian/sync/workshop/sauce`.
Consumer vault to validate against: `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`.
Reference vault (the GOOD edit-mode screenshot was from here): `/Users/willfell/Documents/obsidian/sync/workshop/accuris-beacon-poc/spice/daily/2026/05-May/Wednesday-2026-05-13.md`.

End-state acceptance criteria are in the research doc — don't claim done until you've walked through every checkbox there.
```

---

## Notes for the human pasting this in

- The prompt is intentionally context-thin: it points at the research doc rather than restating it. That keeps the fresh session's context window unloaded for the actual work.
- If you want a different track than "let the agent recommend", edit the START BY block to pre-commit to e.g. Track B and request a webfont build plan directly.
- If you want to skip the brainstorming gate (e.g. you've already decided), say so explicitly in the prompt — sauce subagents have been trained to invoke brainstorming on creative-shape work and will otherwise insist on it.
