# Sauce Pipeline Round 17 — DEPLOY-PAUSE handoff

**Date:** 2026-05-17
**Workshop version shipped:** v0.59.1 (PATCH — deploy-prep migration rules; no card closed)
**Round status:** PAUSED for user-driven deploy

## What happened this round

User picked **"Pause for deploy round"** at Phase B instead of FA-8 / FA-9. The autonomous loop pipeline only writes to the workshop repo + vault file system; the deploy round needs system-level operations (brew tap PR merges, `brew upgrade sauce`, `sauce reinstall` across 4 consumer vaults, `sauce migrate-frontmatter --apply`) that require user permission per the safety-protocol guidance for destructive / shared-system changes.

So this round did the **safe workshop-side prep** only:

### v0.59.1 PATCH shipped

`platform/migrations/v0.53-frontmatter.json` gains 2 rename rules (closes FLN-FA5-1 + FLN-FA7-1):

```json
{ "from": "month_iso",    "to": "month", "scope": { "type": "cowork-monthly" } },
{ "from": "budget_month", "to": "month", "scope": { "type": "budget" } }
```

Without these rules, consumer-vault migration of cowork-monthly notes (v0.7.0 emitted `month_iso:`) and budget notes (pre-v0.4.0 emitted `budget_month:`) would not populate the new canonical `month:` key. With these rules, migration outputs canonical-vocab-correct content for all 5 affected blueprints.

`cmd-migrate-frontmatter.js` `scope.type` narrowing already handles this shape; no code change needed. Whole-suite preflight green (18 harnesses).

`workshop_version 0.59.0 → 0.59.1` PATCH. No blueprint version changes. Commit `8d99d25`. Tag `v0.59.1` pushed.

## Deploy checklist (user-driven)

**Accumulated deploy debt: 4 workshop tags (v0.57.0 + v0.58.0 + v0.59.0 + v0.59.1).** Brew sauce is at v0.56.2. 4 consumer vaults are pinned to subscription versions pre-FA-5/6/7.

### 1. Bring brew sauce to v0.59.1

Round 13 squashed multiple tap-formula PRs into one direct main bump. With 4 accumulated tags, same pattern likely fastest:

```bash
cd ~/projects/repos/homebrew-sauce  # (or wherever the tap clone lives)
# Edit Formula/sauce.rb to point at v0.59.1 tarball + SHA256
git commit -am "Sauce 0.59.1"
git push origin main
# Close any open auto-PRs (release.yml fires per-tag — may be 4 PRs in flight)
```

Then on each machine:

```bash
brew update && brew upgrade sauce
sauce --version  # should report 0.59.1
```

### 2. Consumer-vault subscription pin bumps (4 vaults)

Per vault: edit `<vault>/ranch/platform-subscription.json`:

```jsonc
{
  "workshop_version": "0.59.1",   // was 0.56.x
  "mechanisms": [
    // ... no changes needed; v0.57-0.59 didn't bump any mechanisms
  ],
  "blueprints": [
    { "name": "cowork",  "version": "0.8.0" },  // was 0.7.0 (FA-5)
    { "name": "trips",   "version": "0.2.0" },  // was 0.1.7 (FA-6)
    { "name": "to-do",   "version": "0.2.0" },  // was 0.1.4 (FA-6)
    { "name": "boards",  "version": "0.2.0" },  // was 0.1.0 (FA-6)
    { "name": "finance", "version": "0.4.0" },  // was 0.3.1 (FA-7)
    // ... others unchanged
  ]
}
```

4 vaults: `~/notes/sauce/headspace-sauce/`, `~/notes/sauce/accuris-sauce/`, `~/notes/sauce/ero-sauce/`, `~/notes/sauce/barebones/`. (User per round 10 may have ero / accuris on different paths; consult round-13 deploy handoff for canonical paths.)

### 3. Frontmatter migration (5 blueprints × 4 vaults = 20 invocations)

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  for bp in cowork trips to-do boards finance; do
    sauce migrate-frontmatter --vault ~/notes/sauce/$vault --blueprint $bp --apply
  done
done
```

Each `--apply` invocation produces a per-file report + `.sauce-backup/` sidecars for reversal. Watch for parse-error skipped files (FA-3 softened halt-on-parse-error; surface in summary).

### 4. Reinstall (4 invocations)

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  sauce reinstall --vault ~/notes/sauce/$vault
done
```

Deploys v0.59.1 templates + materializes new rule_fragments.

### 5. Audit verification (4 invocations)

```bash
for vault in headspace-sauce accuris-sauce ero-sauce barebones; do
  echo "=== $vault ==="
  sauce audit --frontmatter-alignment --vault ~/notes/sauce/$vault
done
```

Expected: zero `legacy_key_used` findings across all 4 vaults for cowork/trips/to-do/boards/finance.

### 6. Smoke test (Obsidian, manual)

Open headspace-sauce vault, Cmd-R, and verify:
- Click **"+ Add a card"** on any project board → workstream-picker dialog fires (round-13 fix; still unobserved by user).
- Open a project → buttons render (Open Board / Create Board / etc.).
- Open a budget note → check that canonical `month:` is present (post-migration).
- Open a cowork-monthly note → same canonical `month:` check.

## Board snapshot (unchanged — no card closed this round)

### In Planning (top-level)
- [[To-Do Blueprint]]
- [[Daily-Hub Blueprint]]
- [[Convenience Functionality]]
- [[Blueprint Orchestration]]
- [[Cowork Brainstorming]]
- [[Scratch Blueprint]]
- [[Bugs]]

### In Progress
- [[Frontmatter Alignment]] (FA-1..FA-7 done; FA-8..FA-9 ahead)

### Blocked
(empty)

### Completed (top 8)
- [[FA-7 · Finance migration]] — v0.59.0 — 2026-05-17
- [[FA-6 · Domain wave]] — v0.58.0 — 2026-05-17
- [[FA-5 · Cowork migration]] — v0.57.0 — 2026-05-17
- [[FA-4 · Timeline wave]] — v0.56.0 — 2026-05-17
- [[FA-3 · Project migration]] — v0.55.0 — 2026-05-17
- [[FA-2 · Entity wave]] — v0.54.0 — 2026-05-17
- [[FA-1 · Foundation cycle]] — v0.53.0 — 2026-05-17
- [[Projects Blueprint]]

### FA sub-board Planning (unchanged)
- [[FA-8 · Backlink panels]]
- [[FA-9 · Activity feeds + rollups]]

## Recommended next (after deploy)

- **Card:** [[FA-8 · Backlink panels]]
- **Reason:** Payoff cycle — pays off canonical-vocab investment. With v0.59.1 deployed, canonical keys (`people:`, `projects:`, etc.) are populated on consumer-vault notes; BacklinkPanel materialization will show meaningful results from day one.

Alternates after deploy:
- **FA-9 · Activity feeds + rollups** — sibling Wave-5 payoff. Cross-blueprint feed + project rollup dashboards.

## ScheduleWakeup

**Not scheduled.** This round paused at Phase B per user pick. Restart the loop with `/loop /sauce-pipeline` after deploy completes (or sooner if a Bug card surfaces from deploy smoke testing).
