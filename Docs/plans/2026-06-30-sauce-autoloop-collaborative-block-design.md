# Sauce Autoloop — Collaborative Block/Unblock Loop (design)

**Date:** 2026-06-30
**Status:** Approved design (user-specified) — proceeding to implementation plan
**Scope:** Turn the loop from a gatekeeper into a collaborator: attempt *anything* on the board, and when it can't proceed, write its questions **into the card** and wait for the user's reply, which it reads next turn to unblock + continue. Builds on v0.141.1.
**Companion:** architecture reference (`~/notes/.../Implementation Setup - Architecture.md`).

## The shift (why)
Turn 1 (first live run) blocked a card and stopped, because the card asked for two things the platform conventions forbid + bundled multiple asks. That was *correct* discipline, but it felt like a dead end. The user wants: **put anything on the board; the loop tries; if it's stuck, it asks me right in the card; I answer in the card; it reads my answer and continues.** Blocking becomes a conversation, not a wall.

## Decisions (from the user)
- **Attempt anything** on the board (bug / feature / whatever) — drop the "features out of scope" + broad-scope **pre-filtering** of board cards.
- **Verification gates STAY** (Gate A: preflight + dogfood; Gate B: mutation check + 3-lens panel). They are what make autonomous shipping to the real vaults (ERO/accuris/headspace) safe. "Less strict" = stop pre-judging *what to attempt*, NOT stop verifying *what it produces*.
- **On block → write into the card note** a structured "needs your input" section (reason + specific questions + a reply marker), in `tasks/<Card>/<Card>.md` (the vault card body), not just the frontmatter/handoff.
- **Reconcile Blocked cards** each turn: read the user's reply; if it resolves the blocker → move back to In Progress and work it (now with the guidance); else move on.

## Components

### 1. `block-note.js` (NEW, pure, harness-tested)
- `renderBlockedSection({date, reason, needs})` → the in-card markdown block (see format below). `needs` is an array of questions/decisions.
- `parseBlockedResponse(cardBody)` → `{ hasSection: bool, hasResponse: bool, response: string }` — finds the "🔴 Autoloop — blocked" section and reads whatever the user wrote under `**Your response:**` (ignoring the HTML-comment hint). `hasResponse` = the response area is non-empty.

### 2. `select-card.js` (MODIFIED)
- **Board-card selection no longer applies the broad-scope skip** — it picks the first non-`[x]`-checked Planning card and *attempts* it (recommendation-first preserved). `isBroadScope` stays (still used by `selectFromQueue` for Scout items, which must stay small).
- `no-work` (empty Planning) unchanged.

### 3. Command `Phase A` (MODIFIED) — reconcile Blocked cards
After the in-flight reconcile, **before** Phase B:
- Read the board's **Blocked** column. For each blocked card, read its note + `parseBlockedResponse`.
- If `hasResponse` AND the reply (model-judged) **resolves** the blocker → move the card Blocked → In Progress (board + frontmatter), append a short "user resolved: <summary>" note, and **that card is this turn's work** (proceed to Phase C with the user's guidance). One per turn.
- Else (no reply / insufficient) → leave it Blocked; continue to the next blocked card, then Phase B.

### 4. Command `Phase C` (MODIFIED) — attempt, then block-with-questions
- **Drop the "features are out of scope" instruction.** Attempt the card (bug/feature/anything).
- The gates are unchanged: a produced change still must pass Gate A + Gate B to ship.
- **Block path (any genuine wall** — convention conflict, a change that can't be verified, a needed design decision, or the work balloons past a bounded turn): instead of a silent block, write `renderBlockedSection(...)` **into the card note** (append to the body) with the specific reason + the exact questions, move the card to Blocked (board + frontmatter `status: blocked`), write a handoff, and exit. (Convention conflicts: the loop still must NOT unilaterally overturn a documented standard — it blocks and *asks* whether to change the convention or drop the ask.)

## In-card block section format (appended to `tasks/<Card>/<Card>.md` body)
```markdown

---
## 🔴 Autoloop — blocked, needs your input

**Blocked:** <YYYY-MM-DD>
**Why:** <one-paragraph reason>
**What I need from you:**
- <question / decision 1>
- <question / decision 2>

**Your response:**
<!-- write your answer below this line; the loop reads it on its next pass and will unblock if it's enough -->

```

## Data flow (one turn)
```
Phase A: halt? → npm run status → reconcile in-flight (git/PR)
         → RECONCILE BLOCKED: for each Blocked card, read reply →
             sufficient? → unblock → In Progress → this turn's card
             else → next
         → none unblocked → Phase B
Phase B: selectCard → first Planning card (no scope pre-filter) → work
Phase C: attempt → produce change + test → Gate A → Gate B → ship (canary deploy = separate increment)
         OR genuine wall → renderBlockedSection INTO the card + Blocked + handoff + exit
```

## Error handling
- Card note unreadable / no `tasks/<Card>/` dir → fall back to the frontmatter+handoff block (don't crash); note the degraded path.
- Multiple blocked cards with replies → handle one per turn (oldest first); the rest next turn.
- A reply that's ambiguous → treat as insufficient (stay blocked) rather than guess — fail toward asking again.

## Testing
- Extend `platform/test/run-autoloop-select.js`: `renderBlockedSection` (contains the reason, the needs, the response marker) + `parseBlockedResponse` (no section → hasSection false; section but empty response → hasResponse false; section + reply → hasResponse true + the text) + `selectCard` now picks a broad-looking board card (no longer skipped). Wired into `release:preflight`.

## Out of scope (separate increment)
- **Canary → auto-promote-all deploy** (ERO tripwire → promote accuris/headspace after ≥1 clean check) — the user's other approved decision; its own increment after this one.
- Substrate hardening (real launchd scheduler) — later.
