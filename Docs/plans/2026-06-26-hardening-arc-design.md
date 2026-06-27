# Sauce hardening arc — umbrella design (2026-06-26)

> Program-level framing for a three-cycle "harden the platform" arc. Each sub-project
> gets its own design → plan → cycle → release. This doc captures the diagnosis, the
> decomposition, and the sequencing. Sub-project specs live alongside it in `Docs/plans/`.

## Why this arc exists (diagnosis)

A deep read of the platform (workshop `0.133.0`, 21 mechanisms + 13 blueprints, 262 tags)
surfaced four compounding costs. Hard numbers, not impressions:

1. **`install.js` is a 14,471-LOC monolith that only grows.** 67 `apply*` helpers, 23 of
   them `applyFinance*` heals. **No retirement mechanism** — heals avoid *re-doing* work via
   ~180 per-note idempotency markers, but every heal still **walks every note on every
   install, forever**, to check a marker for a migration that finished cycles ago. Every
   cycle that fixes existing-vault data adds another perpetual heal. This is the substrate
   everything runs on, and it gets bigger/slower every cycle.

2. **The cold-load error class is codified but not enforced.** Landmines #1–#5 documented
   the customJS-TDZ / `dv.current()`-undefined cold-load `ReferenceError`/`TypeError` long
   ago, yet v0.132.x and **v0.133.0 still shipped fixes for the exact same class**. The rule
   "always go through `customjs-guard`" lives in prose; **nothing fails preflight** when a new
   surface ships a bare/unguarded callsite. Every new render surface re-learns the lesson as
   a user-visible red flash and a PATCH.

3. **Firefighting > building.** Last 120 commits: **27 `fix` vs 20 `feat`**. The fix>feat
   ratio is the signature of a platform spending itself on regressions — and #1 + #2 are the
   two biggest regression engines.

4. **Knowledge debt compounds.** `landmines.md` is 595 lines (entry #12 alone is a ~1,500-word
   paragraph that accretes a sentence per cycle, loaded into context every session);
   `cycle-status.md` is stale (claims `0.131.0`); the in-flight queue is a graveyard of
   `FLN-*` candidates deferred 4–10 cycles.

## The arc (sequenced)

Three independent subsystems. The release pipeline ships per-component, so they ship as
three separate cycles/PRs rather than one mega-diff. Posture (user decision): **hard,
build-failing gates over advisory discipline.**

1. **Cycle B — cold-load eradication** (this sub-project; spec:
   `2026-06-26-cold-load-eradication-design.md`). First because it is bounded, stops the
   user-visible bleeding, and every later render surface (including ones A and C touch)
   inherits the guard for free.

2. **Cycle A — migration lifecycle.** Give heals a `retire_after` / `applies_below_version`
   gate so completed migrations stop walking every note, and extract the heal family out of
   `install.js` into a registry. Highest structural leverage; benefits from B already cutting
   the new-heal rate. B's existing-note heal is authored in a retireable style as a forward
   handoff to A.

3. **Cycle C — knowledge + pipeline debt.** Auto-regen `cycle-status.md`, split landmines'
   *rules* from their accreting *history*, groom the FLN backlog, harden the recurring
   release-pipeline wedges (seed rebaseline, stale version assertions). Woven last; if A's
   large diff trips a pipeline wedge mid-arc, pull the pipeline-hardening slice of C forward.

## Out of scope for the arc

Feature growth (mobile support, new blueprints, richer cowork) — the "grow" axis. Deferred
until the "harden" axis is done, by user decision.
