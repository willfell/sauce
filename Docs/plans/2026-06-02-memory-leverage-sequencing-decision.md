---
cycle_arc: v0.85.0 → v0.89.0+ memory-leverage
kind: sequencing-decision
status: locked
opened: 2026-06-02
predecessor_state: workshop @ v0.84.1 (closed 2026-06-02), cowork @ 0.23.0
companion_docs:
  - Docs/plans/2026-06-02-v0.85.0-tier-2-and-read-memory-design.md
  - Docs/plans/2026-06-02-v0.86-v0.89-scope-sketches.md
  - Docs/prompts/2026-06-02-memory-leverage-multi-cycle-roadmap.md
---

# Memory-leverage multi-cycle sequencing decision (2026-06-02)

> [!warning]+ Superseded by v0.88.0 people-cohesion-1
> The strict v0.85→v0.89 sequence below is overridden by `Docs/plans/2026-06-03-v0.88.0-people-cohesion-1-design.md` §0.1.
> - v0.88.0 → people-cohesion-1 (was: distill-week)
> - v0.89.0 → distill-week (was: retro/insights)
> - v0.90.0 → retro/insights
>
> Lock-decision rationale below preserved for historical audit; the load-bearing argument (memory volume must precede primitives) still holds for the shifted slots.

> [!warning]+ Superseded a second time — see v0.89.0 people-cohesion-2
> The v0.88.0 supersession above shifted distill-week to v0.89.0; v0.89.0 itself is now `Docs/plans/2026-06-03-v0.89.0-people-cohesion-2-design.md` (people-cohesion arc slices B+C+D bundled).
> - v0.89.0 → people-cohesion-2 (was: distill-week)
> - v0.90.0 → distill-week + auto-update prefs (was: retro/insights)
> - v0.91.0 → retro/insights + slice E brain-map rollups (was: slice E only at v0.92.0+)
>
> Third memory-arc shift. The lock-decision rationale ("memory volume must precede primitives") still holds for the further-shifted slots.

The roadmap doc at `Docs/prompts/2026-06-02-memory-leverage-multi-cycle-roadmap.md` posed two sequencing questions to the brainstorm. This doc codifies the answers. Companion docs detail the v0.85.0 spec and v0.86–v0.89 scope sketches.

## Decision summary

| Decision | Choice | Driver |
| --- | --- | --- |
| **A.1 — v0.84.2 carry-forwards** | Fold v0.84.2 polish-prelude into v0.85.0 | Single narrative for the memory-leverage arc; polish unlocks deploy smoothness for every subsequent cycle |
| **A.2 — Cycle sequencing** | Strict-sequence v0.85 → v0.86 → v0.87 → v0.88 → v0.89 | Each cycle's primitives + accumulated memory are load-bearing inputs for the next |

## A.1 — v0.84.2 disposition: fold polish-prelude into v0.85.0

### Choice

Ship v0.85.0 with a 4-item polish prelude bundled before the Tier 2 + read-memory work. No separate v0.84.2 PATCH cycle.

### What gets folded in

The open carry-forwards at the start of the memory-leverage arc — proposed-but-not-shipped during v0.84.1 cleanup-1:

1. **FLN-v83-2** — `sauce update --bump-pins` flag bug in `platform/cli/cmd-update.js#handleBumpPins` (line 59). Manual `jq` workaround documented in `Docs/install.md`. Actively painful on every deploy.
2. **Hub discoverability** — `Cowork.md` has a resolver row for `Cowork Memory` but no visible Memory section on the hub. User confirmed difficulty finding the new memory.md file from the Cowork hub when validating on accuris.
3. **Atomic-note memory backlink** — footer callout on `morning-briefing` / `midday-tripwire` / `eod-review` atomic notes linking to `[[<today-memory.md>]]` so the user has a one-click pivot from any cowork output to the underlying memory log.
4. **Headspace eod-review monochrome-callout post-deploy validation** — was tonight's eod-review fire on the post-v0.83.0 SKILL.md the resolution? Still owed.

These become S1–S4 of v0.85.0; the Tier 2 + read-memory work runs S5–S11. Full breakdown in the v0.85.0 design doc.

### Why not a separate v0.84.2 PATCH

- **One narrative wins.** The memory-leverage arc is a 5-cycle story. Inserting a fix-grab-bag PATCH between v0.84.1 cleanup-1 and v0.85.0 fragments the arc's cycle-history.md narrative and adds a tag-merge-deploy round-trip for what amounts to ~4 small surface fixes.
- **Polish unlocks the rest of the arc.** FLN-v83-2 in particular is friction on every deploy. Folding it into v0.85.0 means every deploy from v0.85.0 onward (v0.86, v0.87, v0.88, v0.89) lands without the manual `jq` workaround. The deploy-velocity compounds.
- **Hub discoverability + atomic-note backlink are memory-layer-adjacent.** They make the user-facing memory surface coherent. Shipping them alongside Tier 2 strengthens the v0.85.0 user-visible delta rather than diluting it across two PATCH cycles.

### Trade-off accepted

v0.85.0 grows from ~8 to ~12 stages (4 polish + 8 core). This is comparable to v0.79.0 (16 stages) and v0.80.0 (12 stages); within the cycle-size we've delivered before. The risk is plan-replacement-text drift mid-cycle (the v0.83.0 S3/S4 churn pattern). Mitigation: each polish stage is a tight surface fix with its own HC sub-asserts, and the plan doc breaks stage boundaries explicitly between polish (S1–S4) and Tier 2 core (S5–S11).

### Trade-off rejected

The "defer FLN-v83-2 indefinitely" option (do nothing; live with `jq` workaround) was considered and rejected. Every multi-machine deploy cycle re-pays the cost of the workaround. v0.83.0 deploy hit it. v0.84.0 deploy hit it again. v0.85.0+ deploys will hit it. Fixing it once is cheaper than carrying the friction.

## A.2 — Cycle sequencing: strict v0.85 → v0.86 → v0.87 → v0.88 → v0.89

### Choice

Strict sequential order. Each cycle ships on its own MINOR, fully closes before the next starts. No bundling, no parallelization.

### The dependency chain

| Cycle | Codename | Depends on |
| --- | --- | --- |
| **v0.85.0** | tier-2 + read-memory primitive | v0.84.0 Tier 1 memory layer (in production) |
| **v0.86.0** | cross-orchestrator wire-through (FLN-v84-2) | v0.85.0's `cowork:read-memory` sub-skill |
| **v0.87.0** | semantic retrieval over memory | v0.86.0's wire-through + ≥1 week of accumulated memory (for SC embeddings to have a meaningful corpus) |
| **v0.88.0** | distill-week + auto-update prefs | v0.85.0's Tier 2 weekly syntheses (input to distill); v0.87.0's semantic retrieval (for entity de-duplication) |
| **v0.89.0+** | retro views + insights surfacing | All four prior cycles' accumulated memory + distilled prefs |

Each downstream cycle's primitives are absent without the prior cycle being live + accumulating data. Parallelizing breaks the dependency chain.

### Why not bundle v0.85 + v0.86

The "v0.85 = Tier 2 + read-memory + cross-orch wire-through" bundle (~10 stages) is technically feasible but trades cycle clarity for stage count. Each wire-through (midday/eod/weekly/monthly) follows the same template as MB's step 3a refactor — but applied to 4 orchestrators in one cycle means 4× the plan-replacement-text surface in a single MINOR. The v0.83.0 S3/S4 churn pattern shows this is where mid-cycle drift bites. Splitting into v0.85 (Tier 2 + API) → v0.86 (wire-through to 4 orchestrators) keeps each cycle's surface coherent.

### Why not promote v0.87 (semantic retrieval) earlier

Tempting because `smart-connections-bridge@0.1.1` is already in-house — semantic retrieval is the lowest-friction add from an infrastructure standpoint. But:

- **Memory volume matters.** At v0.85 close, accumulated memory ≈ 1 week × 4 vaults × ~50 ticks per engagement = ~200 ticks per engagement. Semantic similarity over 200 ticks is noisy. By the time v0.87 ships (assuming ~2 weeks per cycle), memory volume ≈ ~600–800 ticks per engagement — meaningful retrieval surface.
- **The cross-orch wire-through is the memory-volume amplifier.** v0.86 makes 4 more orchestrators read memory daily; each read keeps the loop hot. Without v0.86 between v0.85 and v0.87, memory is read once per day (MB) instead of 4–5×.

### Trade-off accepted

Calendar time: 5 cycles × ~2 weeks each = ~10 weeks to v0.89. Fast cycle close discipline (v0.84.0 + v0.84.1 closed same day) compresses this if cycles stay focused. Worst-case 3 months to full arc completion.

## v0.85.0 polish-prelude scope (companion-doc preview)

Full detail in the v0.85.0 design doc; this section summarizes the folded-in scope.

| § | Stage | Surface | What ships |
| --- | --- | --- | --- |
| 0.1 | S1 | `platform/cli/cmd-update.js#handleBumpPins` | FLN-v83-2 fix: audit `--bump-pins` blueprint-pin handling; failing test fixture + correct loop body |
| 0.2 | S2 | `platform/blueprints/cowork/content/Cowork.md` | Hub discoverability: new visible Memory section (callout or dataviewjs view) surfacing today's + yesterday's memory file paths with click-through |
| 0.3 | S3 | `morning-briefing`, `midday-tripwire`, `eod-review` SKILL.md bodies | Atomic-note memory backlink: footer callout in each of 3 orchestrators' Write step pointing to `[[<today-memory.md>]]` |
| 0.4 | S4 | post-deploy validation (manual; no commit) | Headspace eod-review monochrome-callout: confirm v0.83.0 fix held; if regression, write FLN-v85-X and design follow-up PATCH |

Tier 2 + read-memory work runs S5 (RED tests) → S11 (cycle-close).

## References

- **Memory-leverage roadmap (input):** `Docs/prompts/2026-06-02-memory-leverage-multi-cycle-roadmap.md`
- **v0.85.0 design (companion):** `Docs/plans/2026-06-02-v0.85.0-tier-2-and-read-memory-design.md`
- **v0.86–v0.89 sketches (companion):** `Docs/plans/2026-06-02-v0.86-v0.89-scope-sketches.md`
- **v0.84.0 cycle (Tier 0 + Tier 1):** `Docs/plans/2026-06-01-v0.84.0-cowork-memory-layer-{design,plan,result}.md`
- **v0.84.1 cleanup-1 (just-closed PATCH):** `Docs/plans/2026-06-02-v0.84.1-cleanup-1-{design,plan,result}.md`
- **v0.84.0 handoff (FLN-v83-2 detail):** `Docs/prompts/2026-06-02-post-v0.84.0-next-cycle-handoff.md`
- **Cycle status (workshop @ v0.84.1):** `Docs/agent-guides/cycle-status.md`
- **Landmines (non-negotiable):** `Docs/landmines.md`
