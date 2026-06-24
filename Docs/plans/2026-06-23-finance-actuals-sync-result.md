---
purpose: Result doc for the Copilot actuals-sync cycle (finance 0.11.0 / workshop 0.131.0).
kind: result
date: 2026-06-24
blueprint: finance
finance_version: 0.11.0
workshop_version: 0.131.0
design: Docs/plans/2026-06-23-finance-actuals-sync-design.md
plan: Docs/plans/2026-06-23-finance-actuals-sync-plan.md
arc: hub-as-brain (sub-project 2 of 3)
---

# v0.131.0 — finance Copilot actuals-sync badge (finance 0.11.0)

Sub-project 2 of the "hub-as-brain" arc (1 = correctness v0.130.0; **2 = this**; 3 = seed + go-live). Makes the hub's "spent / left" real data instead of hand-typed by pulling Copilot category spend into the governed month's `Budget-<month>.md` `categories[].actual`, and surfaces on the hub whether those actuals are live, stale, or typed.

## What shipped (blueprint, finance 0.11.0)

1. **Generic freshness marker** — `actuals_synced_at` (ISO) + `actuals_source` (`copilot` | `manual`), optional/additive, **no migration** (absence ⇒ "typed"). No Will-specific identifiers → safe to ship to every finance vault.
2. **Live / stale / typed badge** on `FinanceHubSummary` (Budget tile) + `MonthDashboard` (Budget Analysis), gated to governed months. Baseline months (`< governed_from`) keep the v0.130.0 "not scored" framing and get no badge.
3. **Shared math** `FinanceMath.actualsFreshness(budget, monthKey, governedFrom, nowMs) → {state,label,tone}`. live ≤ 8 days, stale > 8 days, typed = no stamp, none = baseline/no-budget.

## What did NOT ship — local skill + cron infra (`~/.claude/skills/finance/`, not released)

The actual Copilot pull is Will-specific and local (Copilot's MCP is a local stdio server). Built but not in the workshop release:
- `scripts/sync-actuals-core.mjs` — **pure deterministic** mapper (name-match + alias table + exclude → `{updates, unmappedCopilot, unsourcedBudget}`; zero file I/O; unit-tested incl. idempotency).
- `references/sync-actuals.md` — the route, two modes (interactive preview+confirm / `--unattended`); `references/copilot-category-map.md` (exclude set + empty alias table).
- `cron/com.will.finance-actuals-sync.plist` + `cron/cron-setup.md` — a weekly launchd job (headless `claude -p` → the same route), **installed + loaded but dormant until July** (governed_from gate).

## Gates

`release:preflight` GREEN — run-finance-plan-state **51/0** (HC-V0128-FRESH-1..6), run-finance-plan-widgets **32/0** (WIDGET-FRESH-1..4, incl. a MonthDashboard + FinanceHubSummary render), run-helper-cases **3710/0**, seed 31/0, `version-sync ok: 0.131.0`. CI green macOS + Ubuntu (PR #28). Core unit test green locally.

**Deploy:** headspace + ero → finance **0.11.0** / workshop 0.131.0; accuris → workshop 0.131.0 (not finance-subscribed). All three `sauce update --bump-pins` clean exit 0; `sauce doctor` 0 fail.

## Real-data validation

A real headless `claude -p "/finance sync --unattended"` against June (baseline) **no-op'd with zero writes** (no `.sauce-backup`, budget fingerprint unchanged) — confirming the governed_from gate fails closed.

## Lessons / pipeline findings (the interesting part)

- **The auto-release pipeline (now live on main) can't ship a BLUEPRINT bump.** `prepare-release` runs `compute-release.js --write` + preflight, but `applyPlan` doesn't mirror the **seed-vault** subscription pin, and `run-seed-migrations.js` fails (install exit 1) on a seed-pin/catalogue skew. Worked around by a manual bump (incl. seed pin) + a `chore(release):` squash-merge that skips `prepare-release` and fires `tag-and-ship` directly on the CI-validated state. **Fix before the pipeline can auto-release blueprints:** add `platform/test/seed-vault/ranch/platform-subscription.json` to `compute-release.js` applyPlan's mirror list (or make run-seed-migrations tolerate pin < catalogue).
- **`rebaseline-seed` job failed** at "Commit rebaselined seed" (its `git push origin HEAD:main` — branch protection / non-ff). Benign here, but the pipeline's post-release seed rebaseline is currently broken.
- **Headless `claude -p` denies all tools in "don't-ask mode."** The unattended cron needs an explicit `--allowedTools` (+ `--permission-mode acceptEdits`) — added to the plist; validate the launchd-context path before the first real July sync (fallback `bypassPermissions`). Cron fails closed, so worst case is non-function, not corruption.
- **Landmine #16 residue:** 9 finance version-range hard-codes in run-helper-cases.js that the Phase 0b collapse missed (silently widened `(6|7|8|9|10)`, broke at 11) → converted to `=== VERSION_SNAPSHOT.components.finance`. Now fully retired for finance.

## Carry-forward — sub-project 3 (seed + go-live)

Create July's budget from the envelope defaults, run the **first interactive `/finance sync`** (which finalizes the alias table), then run the cadence. The badge shows nothing until July (June is baseline).

**Commits:** branch `cycle/finance-actuals-sync`; PR #28; tag v0.131.0; tap PR #215.
