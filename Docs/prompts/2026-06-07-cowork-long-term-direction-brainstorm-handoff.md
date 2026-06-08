---
purpose: Fresh-session brainstorm handoff for COWORK LONG-TERM DIRECTION + QUALITY (not a specific cycle). Sibling to the tactical v0.94.0 brainstorm handoff. Use this one when the goal is to discuss cowork's North Star, what "quality" means for it, and whether the queued tactical arc actually serves the long-term goal.
status: ready-to-paste
opened: 2026-06-07 evening
context: User's 2026-06-07 reframe explicitly named cowork ("the consistency of ensuring all configured scheduled jobs within claude cowork were in alignment... the layout / structure of skills and whatnot are in cohesive alignment... this setup should work for any user, with any setup, with any needs, to get consistency in regards to what they're wanting out of their connectors, in the order that they want, how they want it, with quality and dynamic understanding and accommodating in mind"). The 5-sub-theme arc that emerged is the tactical answer; this handoff anchors a strategic-direction discussion.
sibling: Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md (tactical v0.94.0 brainstorm)
---

# Cowork long-term direction + quality brainstorm handoff

## Why this is a separate handoff

The post-v0.93.3 brainstorm handoff (`Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md`) anchors a **tactical** brainstorm for v0.94.0 (extend install.js to close the v0.93.3 existing-consumer gap). That's a specific cycle with a specific scope.

This handoff anchors a **strategic** brainstorm for cowork itself: where is it going long-term, what does quality look like, does the queued tactical arc (v0.94.0 → v0.94.1 → v0.94.2 → v0.95.0 → v0.95.1 → v0.96.0+) actually serve the long-term goal, and are there strategic-direction questions that should reshape the arc?

The two brainstorms are NOT in conflict. Both can happen. The strategic one should probably PRECEDE the next tactical cycle (so v0.94.0's scope can be informed by clarity on cowork's North Star), but it doesn't have to — the user can pick.

## The reframe (verbatim — load-bearing for the brainstorm)

From the post-v0.93.2 brainstorm state doc § 3 (user said this 2026-06-07):

> "MCP unavailable is annoying, but not much you can do about here. Another annoying thing was the consistency of ensuring all configured scheduled jobs within claude cowork were in alignment on both machines to ensure that there was consistency in regards to the jobs referencing the microscope info, styling info, personality, people functionality, etc. Glueing it all together consistently has been a huge headache. I'm not sure what the missing echos callout means within just headspace, but ya i'm wanting for you to take a look at everything that's been made via these jobs and let's discuss a way to move forward by ensuring consistency is there, the layout / structure of skills and whatnot are in cohesive alignment, and that we're developing this not with the goal of specificity in mind, but with the idea that this setup should work for any user, with any setup, with any needs, to get consistency in regards to what they're wanting out of their connectors, in the order that they want, how they want it, with quality and dynamic understanding and accommodating in mind"

The reframe decomposes into roughly 5 distinct intents:

1. **Cross-machine consistency** — same wrapper, same output, on every machine.
2. **Skill structural cohesion** — layout/structure of skills "in cohesive alignment."
3. **Generalizability** — works for ANY user, ANY setup, ANY needs (not just willfellhoelter/accuris/headspace).
4. **User-controllable composition** — connectors in the order the user wants, how they want it.
5. **Quality + dynamic understanding** — accommodating user-specific signals, not just stamping templates.

The tactical 5-sub-theme arc maps to these but doesn't FRAME them — it just enumerates work items.

## What the strategic brainstorm needs to produce

By the end of the session, ideally:

1. **A cowork North Star sentence or paragraph** — what is the long-term goal? Drafted, refined, and persisted somewhere durable (probably `Docs/Index.md` or a new `Docs/cowork-vision.md`).
2. **A quality bar** — what does "quality" mean operationally for cowork? Some candidates the brainstorm can refine:
   - Consistency: same wrapper produces same output on every machine.
   - Cohesion: every orchestrator follows the same skill structure (gather → decide → write-run-note → audit-receipt).
   - Accommodation: the system reads user prefs (mcp_map, voice notes, personality, microscope, finance knobs) and ADAPTS — not just substitutes tokens.
   - Generalizability: a new user can `sauce bootstrap` + answer the interview + get a working cowork without editing source.
   - Polish: callouts render cleanly, no orphaned warnings on healthy runs, no rough edges.
   - Recoverability: failures are loud + debuggable + don't corrupt vault content.
3. **A North-Star-vs-queued-arc audit** — does the current 6-cycle arc serve the North Star, or are there gaps?
   - Strong fit: v0.94.0 (close install gap), v0.94.2 (de-personalization), v0.95.0 (knob ergonomics), v0.96.0+ (cross-machine wrappers).
   - Probably fits: v0.94.1 (Echoes reword), v0.95.1 (vault-config migration).
   - Possible gaps: (a) skill-structure cohesion sweep — no current cycle. (b) Quality KPIs / health checks / cowork doctor — no current cycle. (c) Bootstrap-interview ergonomics — no current cycle. (d) "Dynamic understanding" accommodation — currently scattered, not a designed primitive.
4. **A revised or confirmed sequencing decision** — does the brainstorm change v0.94.0's role? Should there be a strategic cycle (e.g. v0.94.0 = North-Star doc + cohesion audit + KPI definition; tactical install-helper pushes to v0.94.1)?
5. **A list of strategic-direction questions to lock in** — analogous to Q1/Q2/Q3 from the post-v0.93.2 brainstorm.

## How this brainstorm should NOT scope-creep

This is a CONVERSATION + DOCUMENT, not a code cycle. Outputs are:
- Updated/new `Docs/` markdown
- Possibly updates to the post-v0.93.3 brainstorm state doc § 4 (resequenced arc) + § 5 (lessons)
- A short `Docs/cowork-vision.md` or amended `Docs/Index.md`

NO code changes. NO manifest bumps. NO mechanism touches. The brainstorm's deliverable is alignment, not artifacts.

If the user wants to immediately execute a cycle informed by this brainstorm, do that as a SEPARATE follow-on session (use the tactical v0.94.0 handoff or write a new tactical handoff for whatever cycle the strategic discussion lands on).

## Inputs the brainstorm should ingest

In addition to the load-bearing docs already cited in the tactical handoff:

- **The reframe quote** (above; canonical source `Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 3).
- **The 5-sub-theme detail** (`Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 4 — especially Sub-theme 2 which is the cowork-knob heart of the question).
- **The cross-cutting questions** (`Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 8 — those are STRATEGIC questions, perfect input for this discussion).
- **The cowork manifest + orchestrator skill bodies** (`platform/blueprints/cowork/manifest.json` + `platform/blueprints/cowork/skills/orchestrators/*/SKILL.md`) — the "layout / structure of skills" the reframe talks about.
- **The consumer-vault audit findings** (`Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 2 — what the brainstorm actually saw in the live atomic notes).
- **The post-v0.93.3 lessons** (`Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md` § 5 — six concrete process lessons that inform what "quality" means).
- **One sample atomic note from each consumer vault** — the brainstorm should look at a real morning-briefing from accuris AND headspace to see the current quality bar in action. Live evidence beats abstract reasoning.

## Suggested brainstorm flow

The fresh session shouldn't follow a script — it's a brainstorm. But here's a rough arc to consider:

1. **Load context** — read the docs above; spend 5-10 minutes internalizing the current cowork shape.
2. **Look at live output** — open one recent morning-briefing from accuris AND one from headspace. What works well? What feels off?
3. **Draft the North Star** — propose 2-3 candidate "cowork is for X" sentences. Refine with user.
4. **Define quality** — list 5-10 operational quality dimensions. Score current cowork against each (rough — A/B/C). Identify the lowest-grade ones.
5. **Map quality gaps to the arc** — does the current 6-cycle arc fix the lowest-grade dimensions? If not, what's missing?
6. **Decide on adjustments** — confirm the arc, modify it, or insert a strategic-prep cycle.
7. **Persist** — write `Docs/cowork-vision.md` (or amend `Docs/Index.md`); update the post-v0.93.3 brainstorm state doc § 4 if the arc changed; commit + push.

## Open strategic-direction questions (seed the brainstorm)

Lifted from `Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 8, plus new ones:

1. **The "any user" claim.** Sauce currently distributes via Homebrew tap (willfellhoelter/homebrew-sauce). Is the long-term distribution model "personal-public" (anyone CAN install but it's still tailored), OR "true OSS multi-user" (anyone SHOULD install + customize)? Affects how aggressively to de-personalize platform code + whether cowork should ship with example engagements + how much bootstrap-interview to invest in.
2. **Engagement-type taxonomy.** Today: `w2-fte`, `personal`, a few others. Richer (`w2-fte/saas`, `contractor`, `student`, `retiree`)? Thinner (one generic "professional", one "personal")? Or obviated entirely by Sub-theme 2's knob refactor (engagement-types become BUNDLES of knobs, not first-class categories)?
3. **Cowork's relationship to the rest of sauce.** Cowork is one blueprint among 13. Should cowork's long-term goal influence other blueprints (daily, weekly, monthly, meetings, scratch)? Or is cowork sui generis (the platform's flagship; other blueprints are utility-scale)?
4. **Knob taxonomy.** What's the right shape? Currently mixed: render_aspects (per-engagement-type defaults), personality (per-engagement context file), people (per-engagement context file), connector ordering (implicit in orchestrator SKILL.md prose). Unified "preferences" tree? Layered (type-defaults + engagement-overrides + ad-hoc)? Per-cadence or cross-cadence?
5. **Skill structural cohesion.** Every cowork orchestrator (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) has a similar but not-identical SKILL.md structure. Should there be a CANONICAL orchestrator template that all of them conform to? Should the bootstrap or a `cowork:audit-cohesion` skill enforce it?
6. **Dynamic understanding.** The reframe talks about "dynamic understanding and accommodating." What does that mean operationally? Current cowork reads prefs.mcps for connectivity routing — is that "dynamic understanding"? Or does the user mean something richer (the system learns user patterns over time, surfaces them in atomic notes, adapts the personality based on tone history)? Worth asking the user.
7. **Quality observability.** How does the user (or a future contributor) KNOW cowork is high-quality? Today: dogfood + manual atomic-note inspection. Should there be automated KPIs (Echoes-callout-fire rate; warning-Notice rate; sub-skill-invocation rate; atomic-note-size variance)? A `cowork:doctor` skill?
8. **Bootstrap-interview quality.** The bootstrap-vault skill interviews the user for engagement setup. Headspace's setup has 8 fully-populated context files; accuris has 4. Is that the user's choice or a population gap? Should bootstrap be more aggressive about prompting for `brand-voice.md`, `people.md`, etc.? Or are those genuinely optional?
9. **"Dynamic understanding" via memory layer.** v0.85.0+v0.87.0 introduced memory-read + semantic-memory. v0.85.0 wires Memory log backlinks; v0.87.0 wires Echoes. Both are READ-side primitives. Is there a WRITE-side primitive needed (cowork actively logging user-pattern observations into a knowledge graph)? Out of scope for now or a v1.0.0 candidate?
10. **OSS readiness.** If the long-term goal is true multi-user OSS, what's missing today? (a) Documentation (Docs/why.md/how.md/use.md stale 3+ weeks); (b) onboarding (bootstrap is solid but assumes Homebrew + macOS + Obsidian + Claude); (c) examples (de-personalization helps); (d) governance (no CONTRIBUTING guide for the cowork-specific subsystem); (e) test coverage of edge-case engagements.

---

## Paste-ready prompt for fresh session

Copy the entire block below into a new Claude Code session in `/Users/willfellhoelter/projects/repos/sauce`. The new session has no context from this conversation — the block is self-contained.

```
Strategic brainstorm: cowork long-term direction + quality.

REPO: /Users/willfellhoelter/projects/repos/sauce (workshop vault, NOT a
consumer). Run vault-identity check per CLAUDE.md before any write.

================================================================
TASK: STRATEGIC (not tactical) BRAINSTORM ON COWORK ITSELF
================================================================

This session is NOT picking a specific cycle to execute. It's a
strategic-direction conversation about cowork as a system:
  - What is cowork's long-term goal? (Draft a North Star.)
  - What does "quality" mean operationally for cowork?
  - Does the currently-queued tactical arc (v0.94.0 → v0.94.1 → v0.94.2
    → v0.95.0 → v0.95.1 → v0.96.0+) serve that goal, or are there gaps?
  - Should the arc be reshuffled, augmented, or interrupted by a
    strategic-prep cycle?

Output is markdown + sequencing decisions, NOT code. No mechanism bumps,
no manifest edits, no skill body changes. If the user wants to execute a
cycle after this discussion, that's a SEPARATE follow-on session.

================================================================
AUTHORITATIVE INPUT DOCS (READ FIRST, END-TO-END, BEFORE BRAINSTORMING):
================================================================

  1. Docs/prompts/2026-06-07-cowork-long-term-direction-brainstorm-handoff.md
     (this doc's source — has the reframe quote verbatim, what the
     brainstorm should produce, 10 seeded strategic-direction questions,
     and the suggested brainstorm flow)
  2. Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md
     (THE reframe is in § 3 — read it verbatim; sub-themes are in § 4;
     cross-cutting strategic questions are in § 8 — those are PERFECT
     seed material)
  3. Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md
     (post-v0.93.3 state; resequenced arc in § 4; six v0.93.3-execution
     lessons in § 5 inform what "quality" means)
  4. Docs/plans/2026-06-07-v0.93.3-required-plugins-result.md
     (the v0.93.3 CONTRACT REDEFINED narrative — informs how cowork
     should handle scope adaptation + helper-behavior-verification)
  5. Docs/agent-guides/cycle-status.md (live workshop catalogue;
     cowork is the flagship blueprint at v0.31.2)
  6. Docs/Index.md (cowork's existing positioning in the canonical
     docs entry point)
  7. Docs/why.md (if it exists — likely 3+ weeks stale per the
     v0.93.3 result doc; carry-forward note)
  8. platform/blueprints/cowork/manifest.json
     (the cowork blueprint's claude_surface[], files[], skills, etc.
     — the "layout / structure of skills" the reframe talks about)
  9. platform/blueprints/cowork/skills/orchestrators/morning-briefing/SKILL.md
 10. platform/blueprints/cowork/skills/orchestrators/eod-review/SKILL.md
     (two sample orchestrator SKILL.md bodies — note structural
     consistency vs drift; one shape of "cohesion" the reframe targets)

================================================================
LIVE EVIDENCE (look at recent atomic notes — quality bar in practice):
================================================================

  ls /Users/willfellhoelter/notes/sauce/accuris-sauce/spice/cowork/daily/2026/*/2026-06-*/ 2>/dev/null | tail -10
  ls /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/cowork/daily/2026/*/2026-06-*/ 2>/dev/null | tail -10

Open at least one morning-briefing.md from each consumer vault. Look at:
  - Callout shape consistency
  - Information density
  - Sections present/absent
  - Warning vs success Notices
  - Engagement-specific personality coming through

================================================================
VAULT IDENTITY + STATE VERIFICATION (always):
================================================================

  ls /Users/willfellhoelter/projects/repos/sauce
  cd /Users/willfellhoelter/projects/repos/sauce
  git fetch origin && git status
  git log --oneline -3
  jq -r .version package.json
  jq -r .workshop_version platform/manifest.json
  for vault in /Users/willfellhoelter/notes/sauce/accuris-sauce \
               /Users/willfellhoelter/notes/sauce/headspace-sauce; do
    echo "=== $vault ==="
    jq -r '.workshop_version' "$vault/ranch/platform-subscription.json"
  done

Expected: HEAD on origin/main; tag v0.93.3 present; both consumers at
workshop_version 0.93.3.

================================================================
THE BRAINSTORM (invoke superpowers:brainstorming with this brief):
================================================================

  "Strategic brainstorm on cowork's long-term direction + quality bar.
   Read the handoff doc + cited inputs FIRST. Look at one recent
   morning-briefing.md from each consumer vault.

   Drive at:
     1. Cowork North Star — propose 2-3 candidate sentences; refine
        with user.
     2. Quality definition — 5-10 operational dimensions; score
        current cowork against each; identify the lowest-grade ones.
     3. Arc audit — does the queued 6-cycle arc (v0.94.0 install
        helper → v0.94.1 Echoes reword → v0.94.2 de-personalization
        → v0.95.0 knob ergonomics → v0.95.1 vault-config migration →
        v0.96.0+ cross-machine wrappers) fix the lowest-grade
        quality dimensions? Identify gaps.
     4. Sequencing decision — confirm or revise the arc; consider
        inserting a strategic-prep cycle (North Star doc + cohesion
        audit + KPI definition) BEFORE tactical execution.
     5. Strategic-direction questions — lock in user answers on the
        10 seeded questions in the handoff doc § 'Open strategic-
        direction questions'.

   Deliverables (write into the repo before session-end):
     - Docs/cowork-vision.md (NEW) — North Star + quality bar +
       any cycle-arc revisions; OR an amendment to Docs/Index.md
       if user prefers consolidation
     - An update to Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md
       § 4 (resequenced arc) IF the arc changed
     - A locked Q1/Q2/.../QN list of strategic decisions (analogous
       to the post-v0.93.2 Q1/Q2/Q3 lock) — persist either inline
       in the vision doc OR as a sibling Docs/plans/<date>-cowork-
       direction-decisions.md

   Commit + push the deliverables when user approves.

   DO NOT propose a specific cycle to execute as part of this session.
   That's a follow-on session (use Docs/prompts/2026-06-07-post-v0.93.3-
   brainstorm-handoff.md for the tactical v0.94.0 brainstorm, OR write
   a new tactical handoff for whatever cycle the strategic discussion
   lands on)."

================================================================
SAUCE CONVENTIONS (NON-NEGOTIABLE):
================================================================

  - Direct-push to origin/main only after explicit user approval.
  - One commit per deliverable; conventional commits; explicit
    git add <paths> (NEVER -A).
  - NO Co-Authored-By trailer.
  - Vault-identity check before any write.
  - 22 landmines (Docs/landmines.md) apply.
  - Brainstorm output is docs + decisions, NOT code.

================================================================
PROCEED:
================================================================

1. Run vault-identity check + state verification.
2. Read the input docs in order (Items 1-10 above).
3. Look at live atomic notes from both consumer vaults.
4. Invoke superpowers:brainstorming with the brief above.
5. Drive the strategic discussion with the user.
6. Persist deliverables + commit + push (after user approval).
```

---

## Sibling handoffs

| Handoff | Scope | When to use |
|---|---|---|
| `Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md` | TACTICAL v0.94.0 (extend install.js with applyExternalPluginInstall) | Pick a specific cycle to brainstorm + design + plan + execute |
| **This doc** | STRATEGIC cowork direction + quality (no specific cycle) | Anchor a North Star + quality bar; decide whether the queued arc still serves the long-term goal |

If both happen in the same week: do the strategic one FIRST (so v0.94.0's scope can be informed by the North Star), then the tactical one. If only one happens: pick based on user intent — strategic if "where is cowork going", tactical if "let's ship the next cycle."
