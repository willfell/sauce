---
name: brainstorm
description: Turn an idea into a fully-formed epic proposal for the bound board through collaborative dialogue. Use when starting any creative loop work — a new feature, capability, or refactor theme headed for the board — or when the user says "let's design", "think through", "brainstorm", or brings a half-formed idea that should become an epic. Produces a written proposal; /loop:plan turns it into board schema.
---

# loop:brainstorm

Design dialogue for board-bound work. Same discipline as a good design session (one question at a time, approaches with trade-offs, user approval), except the terminal artifact is an **epic proposal** written in the vocabulary the board schema needs — so `/loop:plan` can convert it into an epic + contracted slices without re-litigating the design.

<HARD-GATE>
Do NOT mint anything, write any card, or invoke intake from this skill. The output is a proposal document. Board writes belong to /loop:plan and /loop:intake.
</HARD-GATE>

## Bind and orient

1. Resolve: `node "${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js" resolve --json`; refusal → `/loop:init`, stop.
2. Read the bound board (`config.board_path_abs`) and skim the top In Planning epics — the proposal must slot into what exists (extend an epic vs found a new one is an explicit question to settle).
3. Run `node <coordinator> status --json` (read-only, env applied) to know what is active/parked — a proposal that collides with live touch zones should say so.

## The dialogue

- Ask questions ONE at a time; prefer multiple choice; understand purpose, constraints, success criteria before proposing anything.
- Propose 2–3 approaches with trade-offs; lead with your recommendation and why.
- Scope check: if the idea decomposes into multiple independent epics, say so and split the proposal.
- YAGNI ruthlessly.

## The proposal artifact

Write to `<config.project_root_abs>/docs/proposals/YYYY-MM-DD-<topic>-proposal.md` (create the directory if missing — it is project docs, not board/coordinator state). Structure:

1. **Problem + outcome** — one paragraph each.
2. **Approach** — the chosen design, with rejected alternatives and why.
3. **Epic shape** — new epic (name + posture) or extension of an existing epic (name it).
4. **Slice sketch** — ordered slice candidates, each with: one-sentence outcome, the risky dimension, candidate touch zones, dependency edges, `standard`/`heavy` guess, and acceptance-test sketch. This is a SKETCH — `/loop:plan` owns contract-grade decomposition.
5. **Evidence** — `path:line` references gathered during the dialogue.
6. **Open questions** — anything the Director must still decide at plan time.

## Close

Present the proposal, get explicit approval on the design, then hand off: "Run `/loop:plan` against this proposal to mint the epic — it will ask for the id prefix and board priority position." Offer to run it in the same session.
