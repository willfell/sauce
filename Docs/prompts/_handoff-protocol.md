---
date: 2026-05-04
purpose: Canonical "endless chat" baton-pass protocol for Beacon platform sessions. Every session entry-prompt and exit-prompt MUST conform. Read once; reference always.
status: load-bearing (referenced by every cycle handoff)
---

# Beacon Handoff Protocol — the endless-chat baton-pass

> [!abstract] What this is
> Beacon's development happens across many short Claude Code chat sessions. To make those sessions feel like one continuous conversation — without re-explaining context every time — every session enters via a STARTER prompt and exits with a successor STARTER prompt for the next session. This file is the canonical contract.

---

## Two prompt types

### 1. Entry prompt (`Docs/prompts/<date>-<topic>-handoff.md`)

The thing the user pastes into a fresh chat session to start. Contains everything the next agent needs to pick up cold:
- What was just done (predecessor commits + tags)
- What is next (specific task or cycle)
- Where to read for context (ordered list, ~15 min reads)
- Pre-flight checks (concrete bash commands + expected output)
- Cadence guidance (which sub-skills, when, what gates)
- Constraints carried forward (non-negotiables; landmines)
- Cross-cutting gotchas (recent surprises codified)
- End-of-session protocol pointer (this file)
- Slash command for the actual next-next session (the recursive baton pass)

### 2. Exit prompt (the last thing a session does)

Before a session ends, it MUST write the next entry prompt. The exit prompt IS the next entry prompt. The end-of-session checklist below codifies what must be in place.

---

## Entry prompt template (REQUIRED sections)

Every entry prompt at `Docs/prompts/<date>-<topic>-handoff.md` MUST include all sections below. Add cycle-specific sections as needed.

```markdown
---
date: YYYY-MM-DD
purpose: <one sentence — what this session does>
predecessors:
  - <prior result writeup or design path>
  - ...
gates:
  - <state assertion that must hold at session start; e.g., tag vX.Y.Z pushed>
  - ...
required_sub_skill: <de:executing-plans / de:brainstorming / etc.>
target_artifact: <plan path → result path → tag>
---

# Onboarding — <session topic>

> [!info] Project identity (load-bearing)
> - **Project name:** `beacon`
> - **GitHub remote:** `git@github-personal:willfell/beacon.git`
> - **Local workshop path:** `/Users/willfell/Documents/obsidian/sync/workshop/poc-vault`
> - **Sibling vaults:** `../tmp-test-barebones-vault/` (regression target), `../tmp-acc-vault/` (deliberate-lag), `../accuris/` (pattern reference, not a consumer)
> - **Distribution model:** stub-dispatch (post-v0.1.2). Stub md5 `a39257da1dd49ae4481e5cd0a42bdac4`. NEVER re-edit the stub (landmine #13).

---

## Mission

<2-4 sentences: what to execute this session. Bullet the deliverables.>

**State at session start:**
- `workshop_version: <vX.Y.Z>`
- Mechanisms: <list>
- Blueprints: <list>
- Tags on origin: <list>
- Harness sub-asserts: <count> green
- Working tree: <expected state>

---

## Pre-flight checks

> [!todo] Run all of these BEFORE touching code

```bash
git -C /Users/willfell/Documents/obsidian/sync/workshop/poc-vault log --oneline -5
git status
git ls-remote --tags origin | tail -10
md5 platform/installer-stub.js \
    Docs/Meta/Templater/platformInstall.js \
    ../tmp-test-barebones-vault/Docs/Meta/Templater/platformInstall.js \
    ../tmp-acc-vault/Docs/Meta/Templater/platformInstall.js
grep workshop_version platform/manifest.json
node platform/test/run-install.js .
node platform/test/run-helper-cases.js | tail -3
```

If any pre-flight fails, STOP and surface to user via `AskUserQuestion`.

---

## Required reads (~15 minutes)

> [!todo] In this order
> 1. <most-recent result writeup>
> 2. CLAUDE.md (status snapshot section)
> 3. Docs/landmines.md
> 4. <relevant design + plan docs for this session>
> 5. Docs/how.md (sections relevant to the session's work)

---

## Cadence guidance

> [!info] How this session moves
> - <which de skill to invoke first>
> - <subagent dispatch points + master-driven points>
> - <stage-close `AskUserQuestion` gates>
> - <TDD discipline if applicable>
> - <Cmd+R prerequisites for any new CustomJS class>
> - Push to origin/main after each stage commit; annotated tag at cycle close.

---

## Constraints carried forward (non-negotiable)

> [!warning] Read CLAUDE.md + landmines for the full set
> - <cycle-relevant non-negotiables; ask-before-acting items; landmine references>

---

## Cross-cutting gotchas

> [!warning] Recent surprises codified
> <Numbered list of gotchas surfaced in recent cycles. Update at every handoff.>

---

## End-of-session protocol

> [!success] Before this session ends, the agent MUST:
> 1. Write the cycle's result writeup at `Docs/plans/<date>-<cycle>-result.md` (subagent dispatch acceptable; mirror most recent green close).
> 2. Update `CLAUDE.md` status snapshot with the new cycle entry + workshop_version + mechanism + blueprint version updates.
> 3. Get user approval via `AskUserQuestion` before the cycle-close commit.
> 4. Stage + commit cycle-close changes; annotate the tag (if applicable); push origin/main + push tag.
> 5. Write the NEXT entry prompt at `Docs/prompts/<date>-post-<cycle>-next-cycle-handoff.md` following this protocol's template.
> 6. Commit + push the next entry prompt.
> 7. End the session by giving the user the literal copy-paste slash command for the next session.
>
> See `Docs/prompts/_handoff-protocol.md` for the canonical template + checklist.

---

## Slash command for the next session

```
/de:<starting-skill>

<paste the cycle-specific brief here — include path to this handoff doc + key state assertions>
```
```

---

## End-of-session checklist (DEFINITIVE)

Every session that closes a cycle (or hands off mid-cycle) MUST satisfy:

- [ ] **Result writeup committed** at `Docs/plans/<date>-<cycle>-result.md`. Required sections: frontmatter, abstract success/status callout, what shipped table, surprises (if any), pacing rhythm, cumulative file-level diff (collapsed), state snapshot table, next-cycle handoff section.
- [ ] **CLAUDE.md status snapshot updated** with the new cycle entry + workshop_version + Mechanisms + Blueprints + Cycle order + harness lines.
- [ ] **Cycle-close commit + push.** Conventional-commits message; HEREDOC for multiline. NO `Co-authored-by: Claude` trailer.
- [ ] **Annotated tag** at cycle close (if cycle bumps workshop_version). `git tag -a vX.Y.Z -m "..."` + `git push origin vX.Y.Z`.
- [ ] **Next entry prompt written** at `Docs/prompts/<date>-post-<cycle>-next-cycle-handoff.md`. MUST conform to the template above. MUST end with a literal slash-command block the user can paste.
- [ ] **Next entry prompt committed + pushed.**
- [ ] **Final user message** in the closing session contains the literal copy-paste slash command for the next session, plus a one-paragraph status summary (what closed; what's next).
- [ ] **Stub md5 invariant verified** — `a39257da1dd49ae4481e5cd0a42bdac4` across all 4 paths.
- [ ] **Workshop self-install green** at the cycle's bumped workshop_version.
- [ ] **Helper-cases harness green** at whatever sub-assert count this cycle reached.

---

## Mid-cycle handoff (different from cycle-close handoff)

Some sessions hand off mid-cycle — e.g., a session that does brainstorming + plan writing but stops before execution; the next session executes. The protocol still applies, with these adjustments:

- Result writeup is OMITTED (no cycle close yet).
- CLAUDE.md status snapshot is NOT updated (cycle isn't closed).
- Cycle-close commit + tag are OMITTED.
- The next entry prompt is at `Docs/prompts/<date>-<cycle>-execution-handoff.md` (not "post-<cycle>"), pointing at the plan + setting expectations for the executing session.
- The executing session, when it closes the cycle, performs the FULL end-of-session checklist.

---

## How CLAUDE.md status snapshot must look after each cycle close

The "Status snapshot" section in CLAUDE.md grows by one bullet per cycle. Each bullet:
- Leads with `**vX.Y.Z <topic> CLOSED YYYY-MM-DD**`
- Captures the headline change in 2-3 sentences
- Calls out version bumps (mechanism + blueprint + workshop)
- Lists tag annotation
- Links result writeup path
- Updates `Workshop version` line at section bottom
- Updates `Mechanisms` + `Blueprints` lines with new versions
- Updates `Cycle order` line with the new cycle marker

This rolling snapshot is what makes "what was the most recent change?" answerable in <1 minute by any future session.

---

## Why this protocol exists

Without it: each new chat session re-asks the user for context, re-discovers the codebase, re-justifies decisions made in prior sessions. Slow, wasteful, error-prone.

With it: each session reads ~15 minutes of grounded context (handoff prompt + result writeup + CLAUDE.md status), runs pre-flight checks, and is productive within the first turn. Decisions persist. Mistakes don't recur. The user never has to re-explain.

The protocol is the difference between "a series of disconnected sessions" and "one endless chat with persistent memory in markdown."

---

## Maintenance

This file is load-bearing. Changes to it cascade across every future cycle's handoff. Update only when the protocol itself evolves — not for cycle-specific content. Cycle-specific content goes in the cycle's own handoff prompt under `Docs/prompts/<date>-...`.

If a cycle surfaces a gotcha or pattern that should apply to all future cycles (e.g., a new gate, a new ask-before-acting item, a new constraint), update CLAUDE.md non-negotiables OR landmines.md (whichever is canonical for that thing) AND reference the change in the next cycle's handoff. Do not duplicate landmines into this file.
