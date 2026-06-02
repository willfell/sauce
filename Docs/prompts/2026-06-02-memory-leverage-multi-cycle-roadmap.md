---
purpose: Strategic input for the multi-cycle brainstorm that maps out v0.85.0 → v0.88.0+ — the "memory-leverage" arc that turns cowork's freshly-shipped capture-tick + synthesize-day data into compounding intelligence across every scheduled job. Authored 2026-06-02 immediately after v0.84.0 deploy + accuris first-tick validation.
load_when: Starting the multi-cycle brainstorm session described in the paste-prompt at the end of this doc, OR any session that needs the strategic context for what comes after v0.84.1.
audience: A fresh Claude Code session invoking superpowers:brainstorming on the memory-leverage arc. Brainstorm + write design docs only — DO NOT execute (parallel chat is driving execution against origin/main).
---

# Memory-leverage multi-cycle roadmap (v0.85.0 → v0.88.0+)

## 1. Where we are now (2026-06-02)

**Workshop:** v0.84.1 at HEAD (`31a589a` post-cleanup-1 cycle close). Cowork @ v0.23.0 (memory-layer intact across the v0.84.1 cleanup PATCH). Preflight ALL GREEN.

**Memory layer status (shipped at v0.84.0, validated 2026-06-02):**

- `cowork:capture-tick` orchestrator deployed on all 4 vaults; default cron `0 7-22 * * *` (16 ticks/day).
- `cowork:synthesize-day` orchestrator deployed on all 4 vaults; default cron `15 19 * * *` (or vault-specific eod-offset).
- `cowork:morning-briefing` reads yesterday's synthesis + last 6 overnight ticks via new pre-flight step 3a; injects `Yesterday at a glance` + `Overnight` callouts in the body.
- Engagement-types schema v0.4.0 declares `tick` + `synthesize_day` in supported + default cadences for all 3 types.
- New canonical type `cowork-memory` + rule_fragment in cowork manifest; STOCK row in customization-contract.

**Validation evidence (accuris, 2026-06-02 08:27 MT):**

First tick scaffolded `spice/cowork/memory/accuris/2026/06-June/2026-06-02/memory.md` with full structural compliance:

- Frontmatter: `type: cowork-memory`, `engagement_id: accuris`, `day: 2026-06-02`, `tick_count: 1`, plus required fields.
- Body: H1 + `[!info]- Today's pattern (synthesis)` placeholder + `[!tip] Carry-forward` placeholder + `## Ticks` header + `[!example]- 08:00 Tick`.
- Tick body captured deltas across chat (busy: Jason Batai release-mgmt brainstorm, OTEL 413 thread, Patryk sync request, EMS NPM_TOKEN expiry), calendar (Dev Enablement Weekly + Pillar 2 DSU), email (quiet, 2 newsletters filtered, 1 1Password recovery pending). ADO unreachable → `[!warning]` callout. GitHub excluded under deltas-only contract (PRs touched yesterday evening, outside the 00:00–08:27 window).

The end-to-end chain works. Synthesize-day fires at 17:20 MT today; tomorrow's morning-briefing should walk in with `Yesterday at a glance` + `Overnight` enriched context.

## 2. Open items at the START of the memory-leverage arc

These were proposed but NOT folded into v0.84.1's actual cleanup-1 scope:

- **FLN-v83-2** — `sauce update --bump-pins` flag bug still open. Accuris manual jq workaround documented in `Docs/prompts/2026-06-02-post-v0.84.0-next-cycle-handoff.md` + the accuris onboarding scratch on the other-machine vault.
- **Hub discoverability gap** — Cowork.md has a resolver row for `Cowork Memory` but no visible Memory section on the hub. User confirmed difficulty finding the new memory.md file from the Cowork hub when validating on accuris.
- **Atomic-note memory backlink** — proposed: footer callout on morning-briefing/eod-review atomic notes linking to `[[<today-memory.md>]]` so the user has a one-click pivot from any cowork output to the underlying memory log. Not yet implemented.
- **Headspace eod-review monochrome callout** — post-deploy validation point from v0.83.0. Was tonight's eod-review fire on the post-v0.83.0 SKILL.md the resolution? Or does headspace's eod-review still render monochrome example callouts? Not yet confirmed.

Any of these could be folded into the next PATCH (v0.84.2) OR bundled into v0.85.0 OR deferred. Decision for the brainstorm.

## 3. The 5-stage memory-leverage roadmap

The strategic frame: today we **write** memory; the next 3-5 cycles are about how every scheduled job **reads + leverages** it. Each stage compounds on the prior — by v0.87.0 the system can answer "when today looks like X past day, surface what happened that day." By v0.88.0 it can propose updates to the user's preferences from distilled weekly patterns.

| Cycle | Codename | Scope | What it unlocks |
|---|---|---|---|
| **v0.85.0** | tier-2-weekly-synthesis + read-memory primitive | NEW `cowork:synthesize-week` orchestrator (Friday cron after weekly-review). NEW `cowork:read-memory` sub-skill — single API every consumer orchestrator calls with `{engagement_id, tier, window}`. Refactor morning-briefing's pre-flight 3a to call `cowork:read-memory` (don't break post-v0.84.0 behavior; same callouts). | Friday weekly-review walks in with "this week's pattern" instead of cold-gathering. All future orchestrators get a single read-memory API instead of re-implementing the file-glob + parse logic. Sets the architectural pattern for v0.86.0 wire-through. |
| **v0.86.0** | cross-orchestrator memory wire-through (FLN-v84-2) | Add pre-flight step 3a (mirror morning-briefing's v0.84.0 pattern) to midday-tripwire, eod-review, weekly-review, monthly-review. Each reads via `cowork:read-memory` with the time-window appropriate to its scope (midday = last 4h; eod = today; weekly = this week; monthly = this month). | Every scheduled job becomes context-aware. Equivalent compounding effect to what morning-briefing already has — but across the full 5-orchestrator surface. |
| **v0.87.0** | semantic-retrieval over memory (sc-bridge) | NEW `cowork:gather-semantic-memory` sub-skill, wraps the existing `smart-connections-bridge@0.1.1` mechanism. Each orchestrator's pre-flight can optionally call this to find "the closest past memory note to today's context" via embeddings. | Pattern recognition across history. Today's morning-briefing pulls "the most-similar past day" via SC embeddings + walks in knowing not just yesterday but the closest analogue from the historical record. |
| **v0.88.0** | distill-week + auto-update user-preferences | NEW `cowork:distill-week` orchestrator (Friday cron after synthesize-week). Scans the week's synthesized memory for recurring people / topics / pattern hints. Proposes USER-PREFERENCES updates interactively (e.g., "Jason Batai mentioned 27× this week; promote to inner_circle? (y/N)"). On accept, writes to `user-preferences.md` under existing edit-microscope's proven write contract. | Closes the "getting smarter" feedback loop. The system learns the user's evolving context. Each week the prefs grow; future jobs see richer routing + voice + priorities. |
| **v0.89.0+** | retrospective views + insights surfacing | NEW `cowork:retro` (weekly/monthly/quarterly retrospective compositions from accumulated memory) + `cowork:insights` (pattern callouts surfaced in cowork hub). | User-facing surface for the accumulated intelligence — not just consumed by other agents, but visible to the user in narrative + dataviewjs views. |

## 4. Existing patterns to crib from (do NOT reinvent)

The tier-N agent-memory pattern is well-established. Steal shamelessly:

- **MemGPT / Letta** — distinguishes `core_memory` (always-loaded identity facts) vs `archival_memory` (vector-searched) vs `recall_memory` (chronological lookup). Sauce already has: `user-preferences.md` = core memory; memory notes = recall memory; **archival/semantic = the v0.87.0 cycle**.
- **Mem0** — extracts structured "memory items" with `{type, content, entities, importance, last_referenced}` fields. Their "extract → update → surface" loop is the gold-standard pattern for the v0.88.0 distill-week cycle.
- **Anthropic project memory ergonomics** — hierarchical per-message → per-session → per-project → per-user. Our hierarchy: per-tick → per-day → per-week → per-month → per-engagement.
- **Smart Connections (Obsidian plugin)** — semantic similarity over notes. Sauce already ships `smart-connections-bridge@0.1.1` (per cycle-status.md mechanism catalogue). The bridge wraps SC's embeddings on disk; v0.87.0 just needs a new sub-skill calling it with memory-note anchors. **No new infrastructure required.**
- **activity-feed mechanism** — already surfaces canonical types in hub Recent Activity sections. `cowork-memory` is already in `_canonical-vocab.json` display_names (post-v0.84.0). Discoverability gap is on the Cowork.md hub note itself, not the underlying mechanism.

## 5. Cross-stage decisions to brainstorm

The brainstorm needs to settle:

### 5.1 Sequencing

Strict sequence v0.85 → v0.86 → v0.87 → v0.88, or interleave? Recommended: **strict sequence** because each builds on the prior's primitives. v0.86 NEEDS v0.85's `cowork:read-memory` API. v0.87 NEEDS the memory-volume from at least a week of v0.86 wire-through (more memory = better semantic retrieval). v0.88 NEEDS v0.85's tier-2 weekly syntheses to operate over.

### 5.2 Open carry-forwards: fold into v0.85 or separate v0.84.2 PATCH?

Two options:

- **Fold into v0.85.0:** add the hub discoverability + atomic-note backlink + FLN-v83-2 fix as a "polish pass" inside the MINOR. Risk: scope creep + plan-replacement-text gaps similar to v0.83.0 S3/S4.
- **Separate v0.84.2 PATCH first:** ship the polish + FLN-v83-2 + headspace-callout-validation as a tight PATCH bundle (~4-5 stages overnight), then v0.85.0 next. Cleaner; mirrors the v0.80.1 + v0.82.1 PATCH-bundle precedent.

Recommended: **separate v0.84.2 PATCH first**. Smaller cycles ship faster + the polish + FLN-v83-2 will reduce friction on every subsequent deploy.

### 5.3 read-memory API shape

`cowork:read-memory` is the load-bearing abstraction for v0.85 → v0.88. Its API needs careful design:

- **Inputs:** `{ engagement_id, tier: "tick" | "day" | "week" | "month", window: { start, end } | "yesterday" | "today" | "this-week" | "last-7d" | ... }`.
- **Output shape:** structured data (NOT raw markdown) so consumers can compose freely — e.g., `{ synthesis_paragraph, carry_forward_bullets, tick_summaries, atomic_note_paths }`.
- **Failure mode:** graceful null-data return (matches morning-briefing's v0.84.0 backward-compat gating).
- **Performance:** memory notes are small + few in number per day; no caching needed yet. Could matter at v0.87.0 (semantic retrieval over years of memory).

### 5.4 Tier 2 weekly synthesis shape

What does the weekly synthesis OUTPUT look like? Open questions:

- Where does it live? `spice/cowork/memory/<engagement>/<YYYY>/<MM-Month>/<ISO-week>/synthesis.md`? Or appended to the existing weekly-review atomic note?
- Voice-applied? Yes — same `voice_contract` pattern as Tier 1.
- Tick-data preservation? Tier 1 preserves all ticks verbatim. Tier 2 over Tier 1: should it preserve all 5-7 daily syntheses verbatim, or just the carry-forward bullets?
- Length cap? Tier 1 = 2-3 paragraphs. Tier 2 should be ~similar (≤300 words) since downstream consumers will read it inline.

### 5.5 Auto-update prefs at v0.88.0 — write contract

This is the highest-risk piece. Auto-mutating `user-preferences.md` is a USER-OWNED file with `materialize_once: true`. The existing `cowork:edit-microscope` writes to USER files; v0.88.0 reuses that proven pattern. Open: does v0.88.0 propose ONE update at a time (one yes/no per accepted change) or BATCH (full diff approve/reject)?

## 6. References

### v0.84.0 cycle artifacts (where it all started)
- Design: `Docs/plans/2026-06-01-v0.84.0-cowork-memory-layer-design.md` (commit `3569179`)
- Plan: `Docs/plans/2026-06-01-v0.84.0-cowork-memory-layer-plan.md` (commit `379f5e0`)
- Result: `Docs/plans/2026-06-01-v0.84.0-cowork-memory-layer-result.md` (commit `a9c80b8`)
- Handoff: `Docs/prompts/2026-06-02-post-v0.84.0-next-cycle-handoff.md`

### v0.84.1 cleanup-1 cycle (just closed by parallel chat)
- Design: `Docs/plans/2026-06-02-v0.84.1-cleanup-1-design.md`
- Plan: `Docs/plans/2026-06-02-v0.84.1-cleanup-1-plan.md`
- Result: `Docs/plans/2026-06-02-v0.84.1-cleanup-1-result.md`
- Handoff: NOT YET WRITTEN at time of authoring this roadmap doc — the parallel chat may add it.

### Foundational v0.83.0 cycle (engagement-type materialization, blocks v0.84.0)
- Design + plan + result + handoff: `Docs/plans/2026-06-01-v0.83.0-cowork-engagement-type-materialization-*.md` + `Docs/prompts/2026-06-02-post-v0.83.0-next-cycle-handoff.md`

### Live workshop state pointers
- `Docs/agent-guides/cycle-status.md` — workshop version, mechanism catalogue, blueprint catalogue, harness count, FLN queue.
- `Docs/cycle-history.md` — newest-first per-cycle narratives (v0.84.0 at line 7-ish; v0.84.1 added by parallel chat).
- `Docs/landmines.md` — 22 canonical traps with rationale.
- `CLAUDE.md` — thin router; `claude-surface[]` regenerates resolvers + directory-map + skills-index tables on every install.

### Existing-pattern external references (for v0.87 + v0.88 design)
- MemGPT / Letta: https://github.com/letta-ai/letta
- Mem0: https://github.com/mem0ai/mem0
- Anthropic project memory ergonomics: surfaced in Claude.ai Project conventions (no canonical paper; community-documented).
- Smart Connections (Obsidian plugin) — already in-house via `smart-connections-bridge@0.1.1` mechanism.

---

## Paste-prompt for the new brainstorm session

Below is the prompt to paste into a fresh Claude Code session at the workshop repo to kick off the multi-cycle brainstorm. The new session should brainstorm + write design docs ONLY — execution is being driven from the parallel chat against `origin/main`, so this session must NOT push code changes.

```
v0.85.0 → v0.88.0+ memory-leverage multi-cycle brainstorm.

This is a STRATEGIC brainstorm + design pass, NOT execution. A parallel
Claude Code chat is driving execution against origin/main; do not push any
code commits from this session. ONLY brainstorm + commit design docs.

WORKING DIR: /Users/willfellhoelter/projects/repos/sauce

STEP 0 — session-start recipe:
  git fetch origin && git status     # expect clean tree on main (parallel chat is pushing)
  git log --oneline -5               # HEAD may have moved since this prompt was written
  jq -r .workshop_version ranch/platform-installed.json   # expect 0.84.1 or later

Follow Docs/prompts/SESSION-START.md (canonical session-start recipe).

STEP 1 — load the strategic roadmap doc:
  Read Docs/prompts/2026-06-02-memory-leverage-multi-cycle-roadmap.md IN FULL.

  Key data points to internalize:
    - Memory layer (Tier 0 capture-tick + Tier 1 synthesize-day) shipped at v0.84.0.
    - Accuris first-tick validated end-to-end at 08:27 MT 2026-06-02.
    - v0.84.1 cleanup-1 PATCH closed by parallel chat (activity-feed + daily polish);
      did NOT include the FLN-v83-2 + hub-discoverability + atomic-note backlink fixes
      I proposed in the prior chat — those remain open.
    - 5-stage roadmap: v0.85.0 (tier-2 + read-memory) → v0.86.0 (cross-orch wire-through)
      → v0.87.0 (semantic retrieval) → v0.88.0 (auto-update prefs) → v0.89.0+ (retros).
    - Existing patterns to crib from: MemGPT/Letta, Mem0, Anthropic project memory,
      Smart Connections (already in-house via sc-bridge mechanism).

  Also load these for full context:
    - Docs/plans/2026-06-01-v0.84.0-cowork-memory-layer-{design,plan,result}.md (v0.84.0 cycle)
    - Docs/plans/2026-06-02-v0.84.1-cleanup-1-{design,plan,result}.md (just-closed PATCH)
    - Docs/prompts/2026-06-02-post-v0.84.0-next-cycle-handoff.md (FLN-v84-1..4 surfaced)
    - Docs/agent-guides/cycle-status.md (live workshop state — workshop_version, FLN queue)
    - Docs/landmines.md (22 entries; always non-negotiable)

STEP 2 — invoke superpowers:brainstorming.

  The brainstorm has 3 layers to settle, in order:

  LAYER A — sequencing + carry-forward folding:
    1. Is the strict-sequence v0.85 → v0.86 → v0.87 → v0.88 → v0.89 the right shape?
       Or should any cycles parallelize / interleave / re-order?
    2. Do we ship a v0.84.2 PATCH first (FLN-v83-2 + hub discoverability + atomic-note
       memory backlink + headspace-callout validation), OR fold those into v0.85.0?
       Roadmap doc recommends a separate v0.84.2 PATCH; brainstorm validates or pivots.

  LAYER B — v0.85.0 spec deep-dive (THE NEXT CYCLE; design doc deliverable):
    1. read-memory API shape — inputs, output structure (raw md vs structured?),
       failure modes, performance considerations for v0.87 forward.
    2. Tier 2 weekly synthesis output shape — where does it live in vault, length,
       voice contract, tick-data preservation strategy.
    3. Backward-compat: morning-briefing's pre-flight 3a is FROZEN at v0.84.0;
       v0.85.0 refactors it to call cowork:read-memory but the OUTPUT (Yesterday at
       a glance + Overnight callouts) MUST be byte-identical to v0.84.0 to avoid
       regressing existing deployed vaults. How to test this?
    4. Cron registration — synthesize-week needs a Friday-after-weekly-review cron.
       Does engagement-types/*.json schema bump to v0.5.0 to add synthesize_week?
       Or do we keep the cron config side-channel + skip the schema bump?
    5. HC strategy — ~14-20 sub-asserts across A (orchestrator structure),
       B (read-memory API), C (refactored MB), D (engagement-types), E (manifest),
       F (onboard-scheduled-jobs).

  LAYER C — high-level scope sketches for v0.86, v0.87, v0.88, v0.89:
    For each, write a 1-2 paragraph scope sketch identifying:
    - The new orchestrator(s) / sub-skill(s) to ship.
    - The new canonical type(s) / rule_fragment(s) if any.
    - Cross-stage dependencies on prior cycle primitives.
    - Open design questions to revisit when that cycle is up next.

  Each LAYER produces design-doc artifacts:
    - LAYER A → docs(plans): 2026-06-02-memory-leverage-sequencing-decision.md
      (brief — codifies the answer to the 2 sequencing questions)
    - LAYER B → docs(plans): 2026-06-02-v0.85.0-tier-2-and-read-memory-design.md
      (full spec, mirrors v0.84.0 design doc shape — implementation-ready)
    - LAYER C → docs(plans): 2026-06-02-v0.86-v0.89-scope-sketches.md
      (5 short sketches, one per future cycle, sufficient to onboard the next session)

STEP 3 — commit + push the 3 design docs:

  Direct-push to origin/main; one commit per doc; conventional-commits format;
  NO Co-Authored-By trailer; explicit git add per doc.

  WARNING: parallel chat may push between your commits. Pull --ff-only before
  each commit; rebase if needed. If you hit a non-trivial conflict, surface to
  user before resolving — do NOT silently rebase.

STEP 4 — STOP at the writing-plans handoff:

  Per superpowers:brainstorming convention, the terminal state is invoking
  superpowers:writing-plans. But DO NOT invoke it in this session — the user
  wants the design docs FIRST, then will dispatch implementation in a separate
  session (or instruct the parallel chat to pick up).

  Final reply summarizes:
    - The sequencing decision (LAYER A).
    - The v0.85.0 spec headline (LAYER B).
    - The v0.86-v0.89 sketches table (LAYER C).
    - Where to paste-prompt the next session to execute v0.85.0 (or v0.84.2 PATCH
      first if LAYER A chose that path).

VAULT SANITY (do BEFORE STEP 1):
  1. Confirm workshop at v0.84.1+ : jq -r .workshop_version ranch/platform-installed.json
  2. Confirm tree clean OR known parallel-chat state: git status
  3. If parallel chat has pushed past v0.84.1, read the new commits' subjects
     to understand what's now in scope vs out of scope.

CONVENTIONS (baked in from v0.79+v0.80+v0.81+v0.82+v0.83+v0.84):
  - Direct-push to origin/main; one commit per doc; explicit git add.
  - NO Co-Authored-By trailer.
  - Always run npm run release:preflight before pushing any doc commit (validates
    nothing accidentally broke; brief sanity-check).

END STATE: 3 design docs committed to origin/main. Brainstorm session ends with
the next-session paste-prompt ready (either v0.84.2 PATCH or v0.85.0 implementation
depending on LAYER A sequencing decision). NO code touched; NO version bumps;
NO orchestrator changes. Pure design-doc commits only.
```
