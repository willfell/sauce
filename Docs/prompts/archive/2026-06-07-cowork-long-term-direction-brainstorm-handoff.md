---
purpose: Fresh-session brainstorm handoff for COWORK ADVANCEMENT — runs in PARALLEL with v0.94.0 execution. Produces a ready-to-execute proposal (design + plan) for the cycle AFTER v0.94.0, focused on cowork's long-term goal + quality + cohesion. v0.94.0 (applyExternalPluginInstall) is locked as the next tactical cycle; this brainstorm produces what comes next.
status: ready-to-paste
opened: 2026-06-07 evening; revised 2026-06-07 to reflect parallel-with-v0.94.0 framing
context: User's 2026-06-07 reframe explicitly named cowork ("the consistency of ensuring all configured scheduled jobs within claude cowork were in alignment... the layout / structure of skills and whatnot are in cohesive alignment... this setup should work for any user, with any setup, with any needs, to get consistency in regards to what they're wanting out of their connectors, in the order that they want, how they want it, with quality and dynamic understanding and accommodating in mind"). v0.94.0 is locked as the tactical install-helper cycle; this brainstorm advances cowork in parallel so a designed + planned cowork-advancement cycle is READY to execute the moment v0.94.0 ships.
sibling: Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md (tactical v0.94.0 brainstorm — execute in a different session)
---

# Cowork advancement brainstorm handoff (parallel with v0.94.0)

## Why this is a separate, parallel handoff

The post-v0.93.3 brainstorm handoff (`Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md`) anchors **v0.94.0 — applyExternalPluginInstall**. That cycle is LOCKED as the next tactical ship: it closes the v0.93.3 existing-consumer install gap (extends `platform/install.js` to auto-install missing `external_plugins[]`). User has confirmed v0.94.0 is going forward.

This handoff runs in PARALLEL with v0.94.0 and produces what comes AFTER it: **a ready-to-execute cowork-advancement cycle** (likely v0.95.0 — the connector / knob ergonomics MINOR — but reshapeable based on the strategic discussion). Output is design + plan documents that can be picked up the moment v0.94.0 ships.

### Why parallel works
- **No shared write surface.** v0.94.0 touches `platform/install.js`, `platform/test/run-helper-cases.js`, `platform/test/run-install.js` (and possibly a new `platform/install-lib/` directory). Cowork-advancement touches `platform/blueprints/cowork/manifest.json`, cowork SKILL.md bodies, `Docs/cowork-vision.md` (NEW), the post-v0.93.3 brainstorm state doc, and possibly `Docs/Index.md`. Zero overlap.
- **No version conflict.** v0.94.0 bumps workshop 0.93.3 → 0.94.0; cowork-advancement bumps cowork blueprint (probably 0.31.2 → 0.32.0) inside its own cycle, which will run on top of whatever workshop_version v0.94.0 produced.
- **Doc-first deliverable.** This brainstorm's output is markdown — vision doc + design + plan. No code change. Lands as a single docs commit; doesn't interfere with v0.94.0's code commits.
- **Sequencing safety.** The cowork-advancement cycle does NOT execute as part of this session. It just gets designed + planned, ready to ship next.

## The reframe (verbatim — load-bearing for the brainstorm)

From the post-v0.93.2 brainstorm state doc § 3 (user said this 2026-06-07):

> "MCP unavailable is annoying, but not much you can do about here. Another annoying thing was the consistency of ensuring all configured scheduled jobs within claude cowork were in alignment on both machines to ensure that there was consistency in regards to the jobs referencing the microscope info, styling info, personality, people functionality, etc. Glueing it all together consistently has been a huge headache. I'm not sure what the missing echos callout means within just headspace, but ya i'm wanting for you to take a look at everything that's been made via these jobs and let's discuss a way to move forward by ensuring consistency is there, the layout / structure of skills and whatnot are in cohesive alignment, and that we're developing this not with the goal of specificity in mind, but with the idea that this setup should work for any user, with any setup, with any needs, to get consistency in regards to what they're wanting out of their connectors, in the order that they want, how they want it, with quality and dynamic understanding and accommodating in mind"

The reframe decomposes into roughly 5 distinct intents:

1. **Cross-machine consistency** — same wrapper, same output, on every machine.
2. **Skill structural cohesion** — layout/structure of skills "in cohesive alignment."
3. **Generalizability** — works for ANY user, ANY setup, ANY needs (not just willfellhoelter/accuris/headspace).
4. **User-controllable composition** — connectors in the order the user wants, how they want it.
5. **Quality + dynamic understanding** — accommodating user-specific signals, not just stamping templates.

The tactical 5-sub-theme arc maps to these but doesn't FRAME them — it just enumerates work items. This brainstorm produces the FRAME, then proposes a concrete cycle to start delivering against it.

## What this brainstorm produces

By the end of the session, three deliverables:

### Deliverable 1 — `Docs/cowork-vision.md` (NEW)
A short, durable doc that captures:
- **North Star** — 2-3 sentence statement of what cowork is for, long-term.
- **Quality bar** — 5-10 operational dimensions (consistency, cohesion, accommodation, generalizability, polish, recoverability, observability, etc.) with current grade (A/B/C) and target grade.
- **Anti-goals** — what cowork is explicitly NOT trying to be (e.g., a CRM, a project management tool, an email client).
- **Strategic decisions locked** — analogous to the post-v0.93.2 Q1/Q2/Q3 lock. Probably 5-10 Q&A pairs covering: distribution model (personal-public vs OSS), engagement-type taxonomy direction, knob taxonomy shape, skill-cohesion enforcement mechanism, dynamic-understanding scope.

### Deliverable 2 — Updates to `Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md` § 4
If the strategic discussion reshuffles the cycle arc (e.g., moves "skill cohesion sweep" up from carry-forward to v0.95.0 slot; renames v0.95.0 to be more specific), update the resequenced-arc table in § 4 to reflect the new ordering. Add reasoning prose.

### Deliverable 3 — Design + plan for the next-after-v0.94.0 cowork-advancement cycle
The big deliverable. A pair of `Docs/plans/<date>-v<X.Y.Z>-<title>-{design,plan}.md` documents for whatever cycle the strategic discussion lands on. Most likely candidates:

- **v0.95.0 — knob ergonomics MINOR** (current default from the arc). Cowork blueprint MINOR (probably 0.31.2 → 0.32.0). Refactor knobs (personality, microscope, styling, people, connector ordering) into first-class composable per-engagement preferences. ~5-7 stages.
- **v0.94.1 — skill structural cohesion sweep** (NEW candidate from this brainstorm). Audit every cowork orchestrator SKILL.md (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) for structural drift; define a canonical orchestrator template; refactor stragglers to conform. Probably workshop PATCH 0.94.0 → 0.94.1. ~3-5 stages.
- **v0.94.1 — Echoes-warning reword** (originally queued; if the brainstorm decides cohesion is more urgent, this defers).
- **v0.94.2 — platform de-personalization** (originally v0.94.2; if cohesion-sweep takes the v0.94.1 slot, this stays).
- **A new strategic-prep cycle** — if the brainstorm decides cowork needs a doc-first North Star cycle (no code), this could be a v0.94.0.5 docs-only release. Lower-effort.

Design must follow the v0.93.3 lesson (`feedback_verify_helper_behavior_before_design`): grep + read every helper the design references BEFORE asserting what it does. Plan must follow v0.93.3 lessons § 5.1-5.6 (state doc reference).

The design + plan are COMMITTED (not pushed) at the end of this session — they sit at HEAD ready for a follow-on session to execute via `superpowers:executing-plans`.

## How this brainstorm should NOT scope-creep

- **NO code changes** in this session. Output is markdown.
- **NO execution** of the proposed cycle. That's a follow-on session AFTER v0.94.0 ships.
- **NO interference with v0.94.0** — don't touch `platform/install.js`, `platform/test/run-install.js`, or anything else the v0.94.0 session might write. Stick to `Docs/` + (if the proposed cycle needs preview content) draft text in the design doc.
- **NO commits to origin/main** of the design + plan until user approves. Stage them, commit locally, surface to user for review.

## Inputs the brainstorm should ingest

Beyond the standard load-bearing docs:

- **The reframe quote** (above; canonical source `Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 3).
- **The 5-sub-theme detail** (`Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 4 — especially Sub-theme 2 which is the cowork-knob heart of the question).
- **The cross-cutting strategic questions** (`Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 8).
- **The post-v0.93.3 state doc § 4 + § 5** (resequenced arc + lessons from v0.93.3 execution).
- **The cowork manifest** (`platform/blueprints/cowork/manifest.json`) — claude_surface[], files[], skills, the "layout / structure" the reframe targets.
- **All 5 cowork orchestrator SKILL.md bodies** — read them as a SET, looking for structural drift:
  - `platform/blueprints/cowork/skills/orchestrators/morning-briefing/SKILL.md`
  - `platform/blueprints/cowork/skills/orchestrators/midday-tripwire/SKILL.md`
  - `platform/blueprints/cowork/skills/orchestrators/eod-review/SKILL.md`
  - `platform/blueprints/cowork/skills/orchestrators/weekly-review/SKILL.md`
  - `platform/blueprints/cowork/skills/orchestrators/monthly-review/SKILL.md`
- **The engagement-type manifests** (`platform/blueprints/cowork/data/engagement-types/*.json`) — the current "knobs" surface.
- **The sub-skill bodies** (`platform/blueprints/cowork/skills/skills/*/SKILL.md` and `platform/blueprints/cowork/skills/cowork/skills/*/SKILL.md`) — to assess the gather/decide/compose/write contract consistency.
- **Live evidence — one recent atomic note per consumer vault** — the quality bar in practice.

## Suggested brainstorm flow

1. **Load context** — read input docs above (~15-20 minutes).
2. **Audit live output** — open one recent morning-briefing.md from each consumer vault. Score against rough quality dimensions.
3. **Audit skill cohesion** — diff/compare the 5 orchestrator SKILL.md bodies. Note structural drift (section orders differ; pre-flight steps inconsistent; failure-token vocabularies diverge; etc.).
4. **Audit knob surface** — list every "knob" cowork currently exposes (per-engagement context files, vault-config.md fields, engagement-type defaults, render_aspects, prefs.mcps). Classify each: first-class composable / hard-coupled to type / buried in prose.
5. **Draft North Star** — propose 2-3 candidate sentences. Refine with user.
6. **Define quality bar** — list 5-10 dimensions, grade current state, set target.
7. **Lock strategic decisions** — work through the 10 seeded questions (below), record user answers.
8. **Pick the next cowork-advancement cycle** — based on strategic decisions + quality gaps, which cycle ships next-after-v0.94.0? Default: v0.95.0 knob ergonomics. Alternatives: skill cohesion sweep, Echoes reword, de-personalization, new strategic-prep cycle.
9. **Write the cycle's design** — using v0.93.3 patterns (`Docs/plans/2026-06-07-v0.93.3-required-plugins-design.md` is a good template). Verify every helper claim by reading code.
10. **Write the cycle's plan** — TDD-first, stage-by-stage, with explicit `git add <paths>` per commit (per sauce conventions).
11. **Update post-v0.93.3 state doc § 4** if the arc shifted.
12. **Commit + present** — commit the deliverables locally; surface to user for review; push after approval.

## Strategic-direction questions to lock (seed the brainstorm)

Lifted from `Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 8 + new ones from the post-v0.93.3 lessons:

1. **The "any user" claim.** Distribution model = "personal-public" (anyone CAN install but tailored to user) OR "true OSS multi-user" (anyone SHOULD install + customize)? Affects de-personalization aggressiveness, example-engagement shipping, bootstrap-interview investment.
2. **Engagement-type taxonomy.** Richer (`w2-fte/saas`, `contractor`, `student`, `retiree`)? Thinner (one "professional" + one "personal")? Or obviated by knob refactor (engagement-types become BUNDLES of knobs, not first-class categories)?
3. **Cowork's relationship to other blueprints.** Cowork is one of 13. Should its long-term direction influence daily/weekly/monthly/meetings/scratch? Or is cowork sui generis (flagship; others are utility-scale)?
4. **Knob taxonomy.** Unified "preferences" tree? Layered (type-defaults + engagement-overrides + ad-hoc)? Per-cadence or cross-cadence?
5. **Skill structural cohesion.** Canonical orchestrator template? Enforced by `cowork:audit-cohesion` skill or just convention? Refactor existing stragglers?
6. **Dynamic understanding scope.** Current cowork reads prefs.mcps for routing. Is "dynamic understanding" just that, or richer (learns patterns, surfaces them, adapts personality from tone history)? Worth asking the user explicitly.
7. **Quality observability.** Automated KPIs (Echoes-fire rate; warning-Notice rate; sub-skill-invocation rate; atomic-note-size variance)? A `cowork:doctor` skill? Or just dogfood + manual inspection?
8. **Bootstrap-interview quality.** Headspace has 8 populated context files; accuris has 4. User choice or population gap? Should bootstrap prompt more aggressively for `brand-voice.md`, `people.md`, etc.?
9. **Memory-layer write side.** v0.85.0/v0.87.0 added memory-read + semantic-memory (READ side). Should there be a WRITE side (cowork actively logging user-pattern observations)? Out of scope or a v1.0.0 candidate?
10. **OSS readiness.** If long-term goal is multi-user OSS, what's missing? (a) Docs (why/how/use are 3+ weeks stale); (b) onboarding (bootstrap assumes Homebrew + macOS + Obsidian + Claude); (c) examples (de-personalization helps); (d) governance (no cowork-specific CONTRIBUTING); (e) test coverage of edge-case engagements.

---

## Paste-ready prompt for fresh session (runs in parallel with v0.94.0)

Copy the entire block below into a new Claude Code session in `/Users/willfellhoelter/projects/repos/sauce`. The new session has no context from this conversation. This session can run in parallel with any v0.94.0 execution session — no shared write surface.

```
Parallel-with-v0.94.0 brainstorm: cowork advancement.

REPO: /Users/willfellhoelter/projects/repos/sauce (workshop vault, NOT a
consumer). Run vault-identity check per CLAUDE.md before any write.

================================================================
PARALLELISM NOTE — IMPORTANT:
================================================================

v0.94.0 (extend platform/install.js with applyExternalPluginInstall) is
LOCKED as the next tactical cycle. A separate session (using
Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md) is
brainstorming + executing v0.94.0.

THIS session runs in parallel. It produces a designed + planned
COWORK-ADVANCEMENT cycle to execute AFTER v0.94.0 ships. No shared write
surface — v0.94.0 touches platform/install.js + platform/test/run-install.js
+ possibly new platform/install-lib/; THIS session touches Docs/* +
possibly cowork blueprint manifest/SKILL.md drafts (within design docs
only, not as committed code changes).

Coordination rules:
  - DO NOT touch platform/install.js or platform/test/run-install.js.
  - DO NOT execute the proposed cowork-advancement cycle in this
    session (just design + plan it).
  - DO NOT commit the design + plan to origin/main until user approves.
  - Before pushing anything, git fetch + check if v0.94.0 work has
    landed and rebase if needed.

================================================================
TASK: STRATEGIC BRAINSTORM + READY-TO-EXECUTE COWORK CYCLE DESIGN+PLAN
================================================================

Three deliverables by session-end:

1. Docs/cowork-vision.md (NEW) — cowork's North Star + quality bar +
   anti-goals + locked strategic decisions (Q&A list analogous to
   post-v0.93.2 Q1/Q2/Q3).

2. Updates to Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md § 4
   (resequenced arc) IF the strategic discussion shifts ordering.

3. Design + plan docs for the cowork-advancement cycle that ships
   NEXT-AFTER-v0.94.0. Default candidate: v0.95.0 — knob ergonomics
   MINOR (cowork blueprint MINOR, probably 0.31.2 -> 0.32.0). Alternative
   candidates the strategic discussion may surface: skill structural
   cohesion sweep; Echoes-warning reword; platform de-personalization;
   a docs-only strategic-prep cycle.

Output is markdown ONLY. No code edits, no execution.

================================================================
AUTHORITATIVE INPUT DOCS (READ FIRST, END-TO-END):
================================================================

  1. Docs/prompts/2026-06-07-cowork-long-term-direction-brainstorm-handoff.md
     (this doc's source — has the reframe quote verbatim, 10 seeded
     strategic-direction questions, suggested brainstorm flow, list of
     candidate cycles)
  2. Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md
     (THE reframe is in § 3 — verbatim; sub-themes in § 4 — especially
     Sub-theme 2 knob ergonomics; cross-cutting questions in § 8)
  3. Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md
     (post-v0.93.3 state; resequenced arc in § 4; six v0.93.3 lessons
     in § 5 — apply ALL six when writing the new cycle's design + plan)
  4. Docs/plans/2026-06-07-v0.93.3-required-plugins-{design,plan,result}.md
     (template for the new cycle's design + plan; result doc has the
     CONTRACT REDEFINED narrative that informs scope-adaptation posture)
  5. Docs/agent-guides/cycle-status.md (live workshop catalogue at
     0.93.3; cowork blueprint at 0.31.2)
  6. Docs/Index.md (cowork's existing positioning)
  7. platform/blueprints/cowork/manifest.json (cowork blueprint
     claude_surface[], files[], skills — the "layout / structure")
  8. All 5 cowork orchestrator SKILL.md bodies (read as a SET; look
     for structural drift):
       platform/blueprints/cowork/skills/orchestrators/morning-briefing/SKILL.md
       platform/blueprints/cowork/skills/orchestrators/midday-tripwire/SKILL.md
       platform/blueprints/cowork/skills/orchestrators/eod-review/SKILL.md
       platform/blueprints/cowork/skills/orchestrators/weekly-review/SKILL.md
       platform/blueprints/cowork/skills/orchestrators/monthly-review/SKILL.md
  9. platform/blueprints/cowork/data/engagement-types/*.json (the
     current "knobs" surface — engagement-type defaults)
 10. Docs/landmines.md (22 traps; § 16 has the in-cycle bump rule;
     § 12 has the v0.93.3 applyExternalPlugins observation)
 11. Docs/agent-guides/code-conventions.md + build-test-verify.md

================================================================
LIVE EVIDENCE (look at recent atomic notes — quality bar in practice):
================================================================

  ls /Users/willfellhoelter/notes/sauce/accuris-sauce/spice/cowork/daily/2026/*/2026-06-*/ 2>/dev/null | tail -10
  ls /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/cowork/daily/2026/*/2026-06-*/ 2>/dev/null | tail -10

Open at least one morning-briefing.md from EACH consumer vault. Look at:
  - Callout shape consistency
  - Information density per section
  - Engagement-specific personality coming through (or not)
  - Warning vs success Notices
  - Sections present/absent (the structural-cohesion signal)

================================================================
VAULT IDENTITY + STATE VERIFICATION:
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
workshop_version 0.93.3. (v0.94.0 may or may not be in HEAD yet — if it
is, that's fine; just acknowledge in your design doc that v0.94.0 is
the predecessor.)

================================================================
THE BRAINSTORM (invoke superpowers:brainstorming with this brief):
================================================================

  "Strategic brainstorm on cowork's long-term direction + quality bar,
   PARALLEL with v0.94.0 execution. Read the handoff doc + cited
   inputs FIRST. Look at one recent morning-briefing.md from each
   consumer vault. Read all 5 orchestrator SKILL.md bodies as a SET.

   Drive at:
     1. Cowork North Star — propose 2-3 candidate sentences; refine
        with user.
     2. Quality definition — 5-10 operational dimensions; score
        current cowork against each; identify the lowest-grade ones.
     3. Skill cohesion audit — diff the 5 orchestrator SKILL.md
        bodies; note structural drift; assess severity.
     4. Knob surface audit — enumerate every knob cowork exposes;
        classify each: first-class composable / hard-coupled to
        engagement-type / buried in prose.
     5. Strategic decisions — lock user answers on the 10 seeded
        questions in the handoff doc § 'Strategic-direction questions'.
     6. Next-cycle pick — which cycle ships next-after-v0.94.0?
        Default v0.95.0 knob ergonomics, but the strategic discussion
        may surface a more urgent alternative.
     7. Design + plan for the picked cycle, following v0.93.3
        patterns. Apply v0.93.3 lessons § 5.1-5.6:
          - 5.1: grep + read every helper the design references
            BEFORE asserting what it does
          - 5.2: TDD against the real execution path
          - 5.3: include HC-V0*-VERSION-* sweep step
          - 5.4: include ranch/platform-subscription.json bump
          - 5.5: re-verify plan preconditions at execution start
          - 5.6: surface scope adaptations explicitly

   Deliverables (write into the repo before session-end):
     - Docs/cowork-vision.md (NEW) — North Star + quality bar +
       anti-goals + locked strategic decisions (Q&A list)
     - An update to Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md
       § 4 IF the resequenced arc changed
     - Docs/plans/<today>-v<X.Y.Z>-<title>-design.md (cowork-
       advancement cycle design)
     - Docs/plans/<today>-v<X.Y.Z>-<title>-plan.md (cowork-
       advancement cycle plan, ready for superpowers:executing-plans)

   Stage + commit deliverables locally. SURFACE to user for review.
   Push to origin/main ONLY after user approves (and after git fetch
   confirms no v0.94.0 work is in-flight that would conflict).

   DO NOT execute the proposed cycle. DO NOT touch platform/install.js
   or platform/test/run-install.js (v0.94.0's surface). Design + plan
   are the deliverable — execution is a follow-on session AFTER
   v0.94.0 ships."

================================================================
SAUCE CONVENTIONS (NON-NEGOTIABLE):
================================================================

  - Direct-push to origin/main only after explicit user approval.
  - One commit per deliverable (vision doc, state-doc-update,
    design, plan); conventional commits; explicit git add <paths>
    (NEVER -A).
  - NO Co-Authored-By trailer.
  - Vault-identity check before any write.
  - 22 landmines (Docs/landmines.md) apply.
  - Brainstorm output is docs + decisions + design + plan, NOT code.

================================================================
PROCEED:
================================================================

1. Run vault-identity check + state verification.
2. Read the input docs in order (Items 1-11 above).
3. Look at live atomic notes from both consumer vaults.
4. Read the 5 orchestrator SKILL.md bodies as a SET.
5. Invoke superpowers:brainstorming with the brief above.
6. Drive the strategic discussion with the user.
7. Write the four deliverables (vision doc, state-doc-update if
   needed, design, plan).
8. Stage + commit locally; surface to user for review.
9. Push to origin/main after user approval (git fetch first; rebase
   on top of any v0.94.0 commits that landed in parallel).
```

---

## Sibling handoffs

| Handoff | Scope | Session model |
|---|---|---|
| `Docs/prompts/2026-06-07-post-v0.93.3-brainstorm-handoff.md` | TACTICAL v0.94.0 — extend install.js with applyExternalPluginInstall | Brainstorm + design + plan + execute (single thread, may span sessions) |
| **This doc** | COWORK ADVANCEMENT — North Star + quality + ready-to-execute design+plan for next-after-v0.94.0 cycle | Brainstorm + design + plan (no execution); runs in PARALLEL with the tactical session |

Both sessions can run concurrently. No shared write surface. After v0.94.0 ships, use the design + plan this session produces to launch the next cowork-advancement cycle (with `superpowers:executing-plans`).
