---
date: 2026-05-03
purpose: copy-paste-ready prompt for a fresh chat session to address Stage 4 design surprises
related:
  - Docs/plans/2026-05-03-nav-buttons-scope-and-blueprint-content-handoff.md
---

# Prompt — fix nav-buttons over-scope + blueprint content gap

Copy everything below the `---` line into a fresh Claude Code session opened in `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`.

---

I'm continuing work on the vault platform project from `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`. We just completed v0.1.0 (4 mechanisms + 1 blueprint installed end-to-end into a fresh `tmp-test-barebones-vault`), and Stage 4 smoke tests surfaced two design surprises that I want to address in v0.1.1. Don't write any code yet — read first, then we'll brainstorm.

## Read in this order before responding

1. `CLAUDE.md` at the workshop root — vault identity + non-negotiables.
2. `Docs/Index.md` — entry point.
3. `Docs/why.md`, `Docs/how.md`, `Docs/landmines.md` — purpose, architecture, traps. Landmines is non-negotiable.
4. `Docs/plans/2026-05-03-nav-buttons-scope-and-blueprint-content-handoff.md` — **this is the load-bearing handoff doc.** It captures: what's installed, what works, the two surprises Stage 4 surfaced, root causes, three design options (A / B / C), where to read next, suggested first move. Read it in full.
5. `Docs/plans/2026-05-02-nav-buttons-and-project-blueprint-design.md` — current design doc (includes Stage 4's post-hardening additions).
6. `Docs/plans/execution-logs/2026-05-02-nav-buttons-and-project-blueprint/` — every per-task log. Skim the most recent ones (Stage 4 entries) to see what we just changed.

Then peek at the live state in barebones:

- `/Users/willfell/Documents/obsidian/sync/workshop/tmp-test-barebones-vault/Docs/Meta/platform-installed.json` — proof of install.
- `/Users/willfell/Documents/obsidian/sync/workshop/tmp-test-barebones-vault/Docs/Meta/Scripts/nav-buttons/space-nav-buttons.js` — the kitchen-sink class (look at the `config = {...}` block ~line 51 and `buildButtons` ~line 95).
- `/Users/willfell/Documents/obsidian/sync/workshop/tmp-test-barebones-vault/commands/new-project.md` — the materialized slash command.

## The two surprises to address

**Surprise 1 — Nav-buttons over-scope.** The shipped `SpaceNavButtons` renders 7+ buttons (Daily, To Do, Meetings, Board, Summary, Projects, Planning) all with hardcoded paths from accuris's layout. I expected a focused button set that matches what the platform actually shipped (just "Board" or similar). Today the class is byte-identical to accuris's full nav bar — kitchen sink, hardcoded paths.

**Surprise 2 — Blueprint shipped mechanism but not companion content.** Clicking the "Board" button creates an empty `boards/To-Do-Board.md` because the platform never shipped that target file. The project blueprint installed code (helpers, slash command, Create New Project template) but no working "Board" content. The user expected complete board functionality out-of-box.

The handoff doc lays out three options:

- **A** — Mechanisms ship code only; consumer ships content. Cleanest separation, doesn't solve the user ask.
- **B** — Add a new platform concept: scaffolding content. Mechanisms / blueprints declare files to create on install if missing. Closes the gap. New design surface.
- **C** — Make `SpaceNavButtons` data-driven. Per-consumer config drives button list + paths. Solves Surprise 1 cleanly, doesn't solve Surprise 2 alone.

Combined approaches plausible. The handoff doc is the canonical statement of the problem; please ground in it.

## What I want from you in this session

1. **Read the files** above before saying anything substantive. Confirm you've read them by referencing specifics (not just titles).
2. **Use the de:brainstorming skill** to drive the design conversation. The decision shape is: which of A / B / C (or hybrid) do we adopt for v0.1.1, and how do we scope it so the build is bite-sized.
3. **Don't write code or implementation plans yet.** Brainstorming → design doc → plan → implementation, in that order. Same rhythm as v0.1.0.
4. **Ask one clarifying question at a time** via the AskUserQuestion tool when it'd help disambiguate. The handoff doc anticipates many of them; only ask if not covered.

## Constraints

- **No git commits.** Git is unavailable in this vault. Each implementer logs work to `Docs/plans/execution-logs/<plan-name>/T<task>-<slug>.md` files instead.
- **Bootstrap-copy discipline.** When `platform/install.js` changes, the runtime copies in `poc-vault/Docs/Meta/Templater/`, `tmp-acc-vault/Docs/Meta/Templater/`, and `tmp-test-barebones-vault/Docs/Meta/Templater/` must all be re-synced byte-identically.
- **Workshop dogfood is mandatory.** Every change must pass workshop self-install before promoting to consumers (per CLAUDE.md non-negotiable).
- **Mobile (iOS Obsidian) is unsupported for installs.** `require("fs")` is desktop-only (landmine #8). Smoke tests can run on iOS but installs must be on macOS.
- **Workshop CLAUDE.md says ask before bumping `workshop_version`** in `platform/manifest.json` (it's the global release marker).

## Pacing preference

I want stage-level checkpoints. Bundle implementer work; surface to me only at stage boundaries OR at design decision points. Stage 4 was the most recent test of this rhythm — it worked well except for two failure-mode discoveries that were exactly the kind of "build to fail loudly" wins we wanted.

## Suggested first move

Per the handoff doc:
1. Read everything above.
2. Use the de:brainstorming skill.
3. Pick A / B / C.
4. If B: design the `scaffold` manifest field shape, ownership rules, idempotency semantics.
5. If C: design the config file format, default per vault identity.
6. Write a design doc, then an implementation plan.
7. Build incrementally with stage-by-stage dogfood.
8. Re-test in barebones to confirm the v0.1.1 gap is closed.

Begin by confirming what you've read and then asking your first clarifying question.
