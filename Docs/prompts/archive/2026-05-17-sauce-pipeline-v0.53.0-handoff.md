# Sauce Pipeline Round 9 — handoff for next round

**Date:** 2026-05-17
**Workshop version shipped:** v0.53.0
**Card completed:** [[FA-1 · Foundation cycle]] (sub-card; workstream [[Frontmatter Alignment]] remains in In Progress on top-level board)
**Result doc:** `~/projects/repos/sauce/Docs/plans/2026-05-17-v0.53.0-result.md`

## Board snapshot (after this round)

### In Planning (top-level `sauce-board.md`)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (workstream — multi-round; FA-1 closed, FA-2..FA-9 ahead)

### Blocked
(empty)

### Completed (most recent at top)
- [[Frontmatter Alignment]] / [[FA-1 · Foundation cycle]] (sub-card) — v0.53.0 — 2026-05-17
- [[Projects Blueprint]] (workstream) — 2026-05-17 (round 8 close)

### Frontmatter Alignment sub-board (`tasks/Frontmatter Alignment/board/Frontmatter Alignment-board.md`)

**Planning:**
- [[FA-2 · Entity wave]]
- [[FA-3 · Project migration]]
- [[FA-4 · Timeline wave]]
- [[FA-5 · Cowork migration]]
- [[FA-6 · Domain wave]]
- [[FA-7 · Finance migration]]
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

**In Progress:** (empty — FA-1 just closed; FA-2 picked at next round)

**Completed:**
- [x] [[Planning Frontmatter Alignment]]
- [ ] [[FA-1 · Foundation cycle]] (v0.53.0)

## What shipped in v0.53.0

Foundation cycle for Frontmatter Alignment. Cross-cutting infrastructure only — zero blueprint manifest changes. Six concrete artifacts:

1. **`sauce migrate-frontmatter` CLI verb** (~530 LOC at `platform/cli/cmd-migrate-frontmatter.js`). Default dry-run writes `<vault>/sauce-migration-report.md`. `--apply` rewrites with `.sauce-backup/<rel>/<ts>/` sidecar. Wire to `platform/migrations/v0.53-frontmatter.json` declarative spec.
2. **`platform/rules/_canonical-vocab.json`** — shared rule template (audit triplet + walker/migrator config). Consumable via `extends: "_canonical-vocab"`.
3. **`validator@0.2.0 → 0.3.0`** — NEW `extends:` field on rule fragments (per-fragment in CLI rule-runner; top-level on rule files in in-vault validate.js). Failure-soft merge with fragment-wins precedence.
4. **`audit@0.2.1 → 0.3.0`** — NEW `frontmatter-alignment-walker.js` (6 finding severities: legacy_key_used HIGH / non_iso_timestamp HIGH / unquoted_wikilink MEDIUM / missing_canonical_key MEDIUM / discriminator_tag_present INFO / temporal_tag_present INFO) + `sauce audit --frontmatter-alignment` CLI flag.
5. **Layer 2 install.js rule `_validateCanonicalVocab`** — every blueprint expected to opt into canonical-vocab via rule_fragments OR declare `canonical_vocab_opt_out`. v0.53.0 posture: warning-only (no install fail) — promotes to hard fail post-FA-7.
6. **2 NEW test harnesses** — `run-migrate-frontmatter.js` (50/0) + `run-validator.js` (9/0); `run-audit.js` +15 AU-FA cases.

**Whole-suite delta:** +74 sub-asserts across 14 (→16) harnesses.

## Recommended next

- **Card:** [[FA-2 · Entity wave]] (meetings + people + products + teams)
- **Reason:** Lightest of the per-blueprint migrations. Validates the FA-1 substrate against 4 entity-shaped blueprints. Migration verb runs against headspace pre-tag; per-blueprint canonical-vocab adoption + entity-create `frontmatter_template` updates + rule_fragment `extends:` injection. Cycle bumps (verify at exec): `meetings 0.5.1→0.6.0`, `people 0.2.2→0.3.0`, `products 0.1.0→0.2.0`, `teams 0.1.0→0.2.0`. Whole-suite delta target ~+20 sub-asserts.

Alternates:
- **Cmd-R smoke first.** v0.53.0 ships infrastructure only — no consumer-visible UI change. But headspace's validate.js is freshly overwritten (extends loader), so a Cmd-R reload before next-round-work is prudent.
- **Brew tap merge gate.** Tag `v0.53.0` pushed; `.github/workflows/release.yml` should bump `Formula/sauce.rb` in `willfell/homebrew-sauce`. Verify tap PR merged + `brew upgrade sauce` against the test machine before starting FA-2 if testing FA-2's `--apply` against headspace is part of acceptance.

## Open questions / dependencies

- **No FA-1 migration `--apply` was run against headspace this cycle.** Per design, `--apply` runs are per-blueprint at FA-2..FA-7 time, not in FA-1. Headspace remains on pre-canonical frontmatter.
- **Canonical-vocab template materialization** to consumer vaults is not yet wired. FA-1's rule-runner resolves via workshop-fallback path; this works for the audit walker today. FA-2 needs to decide whether to materialize the template into `<vault>/ranch/rules/_canonical-vocab.json` (per landmine #11) or continue relying on workshop-fallback. See FLN-1 in the result doc.
- **In-vault validate.js extends loader is inspection-tested only.** No Obsidian app available in node harness. FA-2 first-consumer is the integration test. See FLN-2 in the result doc.
- **`_validateCanonicalVocab` fires warnings on every blueprint at v0.53.0.** All 13 blueprints will surface in install history as `event=warning step=canonical_vocab` until they migrate (FA-2..FA-7) or declare opt-out.

## FIX-LATER notes (new this cycle)

- **FLN-1.** Canonical-vocab template materialization to consumer vaults. Workshop-fallback works today; explicit materialization needed if a blueprint validate.js (in-vault) path is exercised before the workshop's `platform/rules/` is reachable.
- **FLN-2.** In-vault validate.js extends loader untested by harness.
- **FLN-3.** `unquoted_wikilink` walker detection is block-form only; inline-array form (`key: [[[X]]]`) is outside the minimal YAML parser scope anyway.
- **FLN-4.** `missing_canonical_key` simplified to "type set, created_at absent." Design suggested broader "blueprint emits canonical key by template but note omits." Narrow form is load-bearing.
- **FLN-5.** `_validateCanonicalVocab` is warning-only at v0.53.0. Promote to hard fail post-FA-7.
- **FLN-6.** `coerceIsoWithTz` uses install-machine local TZ for partial inputs. Re-run on different machine produces different offsets.
- **FLN-7.** `BLUEPRINT_MODULE_DIRS` map duplicated across 3 files. Extract to shared helper.

## Carry-forward notes from earlier rounds

- **FLN-FROM-ROUND-8.** `.sauce-backup/<slug>/wiki/20260517-013959/` dirs at headspace (round 8 deploy) are intentionally preserved. User can `rm -rf` once they've validated docs/ is correct.
- **FLN-FROM-ROUND-8.** "another project has no wiki/ at creation time" — pre-existing entity-create `extra_files[]` bug worth a triage cycle (orthogonal to FA workstream).

## ScheduleWakeup pacing

Next round picks at Phase B (interactive). 1800s fallback heartbeat to keep prompt cache TTL one-cache-miss within the typical user response window — they may step away between rounds.
