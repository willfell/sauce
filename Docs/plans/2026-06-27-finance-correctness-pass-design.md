---
purpose: Design doc for the finance correctness pass — credit_limit scaffold fix, single-source payoff unification, coach actuals-source reconcile, + housekeeping.
kind: design
date: 2026-06-27
blueprint: finance
context_finance_version: 0.11.1
context_workshop_version: 0.135.0
arc: finance correctness (post hub-as-brain sub-projects 1+2; go-live = separate phase 2)
---

# Finance correctness pass — design

A bug-fix-grade cycle that closes four gaps found auditing the finance system. No new
user-facing features. Two fixes ship in the **finance blueprint** (a normal pipeline bump);
one is a **local edit to the user-global `/finance` coach skill** (not pipeline-shipped);
one is **repo housekeeping**.

## Why

A full audit of the finance system (blueprint engine + `/finance` coach skill + Copilot
actuals-sync + cron) found the engine fundamentally solid but surfaced four inconsistencies:

1. **`credit_limit` missing from the new-debt scaffold** — debts created via "+ New Debt"
   never render the credit-card utilization/paydown chip.
2. **Three different whole-debt payoff dates** across the UI (hero, Plan tile, Debts hub),
   plus a fourth naive **per-debt** payoff that ignores avalanche roll.
3. **Coach vs badge "spent" drift** — the coach is told to ignore `Budget.actual`, which is
   correct pre-governance but has no "once a governed month is synced" branch, so post-go-live
   the coach and the on-hub freshness badge will disagree.
4. **Stale meta state** — `cycle-status.md` says workshop `0.131.0` but HEAD is `0.135.0`; one
   untracked handoff doc.

## Goals

- Every payoff/zero-debt date in the finance UI comes from **one canonical engine function**,
  with a defined plan-aware → entity-based → none precedence that degrades gracefully on
  finance vaults with no Finance Plan.
- New debts scaffold with `credit_limit` so the CC chip renders.
- The coach reads synced governed-month budget actuals when (and only when) they are fresh,
  matching the hub badge; otherwise it reads Copilot live and says so.
- Repo meta state is current.

## Non-goals

- **Go-live (sub-project 3): July budget creation, first interactive `/finance sync`, cron
  validation.** Explicitly a separate Phase 2 (user accepted it may slip past July 5).
- No change to the envelope/carry/glide/overflow math.
- No heal migration for existing debts (render already treats missing `credit_limit` as 0).
- No change to the Copilot sync engine, plist, or freshness-badge math.

---

## Fix 1 — `credit_limit` in the new-debt scaffold

**Where:** `platform/blueprints/finance/manifest.json` — the debt `new_entity_buttons[]`
entry, `frontmatter_template` block (currently lines 583–596).

**Change:** add `"credit_limit": 0` to `frontmatter_template` (alongside `min_payment` /
`planned_monthly_payment`, before `balance_history`).

**Rationale / safety:** every consumer of the field already guards `Number(credit_limit) > 0`
(`debt-summary.js` CC band, `debts-hub-summary.js:113`, `debts-cards.js`,
`paycheck-debt-band.js`, `paycheck-expenses-editor.js`), so `0` is inert until the user sets a
real limit via `DebtConfigEditor` / `DebtDefaultsEditor` (which already manage `credit_limit`).

**No heal migration.** Existing debts without the field render identically (0 ⇒ no chip);
writing `0` into them would be pointless and wrong for real cards. Live headspace debts already
carry it (hand-seeded), so nothing to repair.

---

## Fix 2 — One canonical payoff source (full unification)

### Problem

Whole-debt zero-debt date is computed in **three** places, each differently:

| Callsite | File:line | Source today |
|---|---|---|
| Finance hub **hero** | `finance-hub-summary.js:72,93` | `debtTotals(debts).zeroDebtDate` — entity-planned avalanche |
| Finance hub **Plan tile** | `finance-hub-summary.js:136,143` | `computePlanState(dv,mk).payoff.zeroDebtDate` — plan-aware |
| **Debts hub** | `debts-hub-summary.js:45–52,73` | naive `Math.ceil(totalBal / (planned − interest))` — **wrong** |
| **Plan cockpit** | `finance-plan-dashboard.js:111` | `computePlanState(...).payoff` — plan-aware |

And a **fourth, per-debt** number in `DebtSummary` (`debt-summary.js:63–66`) uses
`Math.ceil(balance / (planned − monthlyInterest))` — each card **in isolation**, ignoring the
avalanche roll (freed minimums from paid-off cards accelerating the rest). The avalanche's
`killOrder` (`finance-math.js:291–293`) already produces the correct per-debt date.

`debtTotals` and `computePlanState` differ in **what attack amount they assume**: `debtTotals`
trusts each debt's `planned_monthly_payment` as written; `computePlanState` derives attack from
the plan policy (income floor → minimums + `attack_above_minimums` + freed savings + override).
After "Apply" in the Plan cockpit writes the plan allocation to the debts, they converge; before
Apply they diverge — and that divergence is real signal, so we pick a precedence rather than
pretend they're the same.

### Design — new `FinanceMath.projectedPayoff(dv, monthKey)`

A single canonical entry point that every payoff-date callsite uses.

**Signature:** `projectedPayoff(dv, monthKey)` → returns:

```
{
  totalBalance, monthlyInterest, plannedAttack, weightedApr,  // the money figures (entity-derived)
  zeroDebtDate,    // canonical whole-debt date, or "—"
  months,          // finite, or Infinity
  killOrder,       // [{ debt, slug, date }]  (slug === Debt note file.name)
  source           // "plan" | "entities" | "none"
}
```

**Precedence:**
1. **Plan branch** — `const ps = computePlanState(dv, monthKey)`. If `ps.ok` **and**
   `isFinite(ps.payoff.months)`, return `ps.payoff`'s `{ zeroDebtDate, months, killOrder }`
   (honors the income floor, attack-above-minimums, freed savings, and the
   `attack_target_override`), with `source: "plan"`. Money figures come from `debtTotals`
   (they describe current balances, identical either way).
2. **Entity branch** — no usable plan: run `simulateAvalanche(debts, max(0, plannedAttack −
   Σ active minimums))` (the same inputs `debtTotals` uses today) and return its
   `{ zeroDebtDate, months, killOrder }` with `source: "entities"`.
3. **None branch** — no debts with balance > 0: `zeroDebtDate: "—"`, `months: Infinity`,
   `killOrder: []`, `source: "none"`.

`debtTotals` is **left unchanged** (keeps its current contract + tests; remains the
entity-based primitive). `projectedPayoff` orchestrates on top of `debtTotals` +
`computePlanState` + `simulateAvalanche`.

> Note: by construction `projectedPayoff(...).zeroDebtDate === computePlanState(...).payoff.zeroDebtDate`
> whenever a plan exists, so the Plan tile and Plan cockpit need no change to agree with the
> hero/Debts hub.

### Callsite routing

| Callsite | After |
|---|---|
| Finance hub hero (`finance-hub-summary.js`) | one `projectedPayoff` call → `zeroDebtDate`; money figures from the same return |
| Debts hub (`debts-hub-summary.js`) | one `projectedPayoff` call → replaces the inline reduces (35–43) **and** the naive payoff (45–52); Band 1 reads `totalBalance/monthlyInterest/plannedAttack/weightedApr/zeroDebtDate` from it |
| Finance hub Plan tile | unchanged — already `computePlanState`, equal to `projectedPayoff` when a plan exists |
| Plan cockpit (`finance-plan-dashboard.js`) | unchanged — already `computePlanState` |
| `DebtSummary` per-debt (`debt-summary.js:58–67`) | look up `projectedPayoff(...).killOrder.find(k => k.slug === page.file.name)`; show its `.date` (derive months = whole months between today and that date for the existing `"{N}mo (date)"` format). Keep the `principalAttack <= 0` warning. Naive isolation fallback **only** if the debt isn't in `killOrder` (e.g. paid off / not simulated). |

`DebtSummary` renders on a single Debt note and already calls `dv.current()` — it gets
`monthKey` from the current month (same `_coerceMonthString(new Date())`/`dv` pattern the hub
uses) to pass to `projectedPayoff`.

### Behavior change to call out

The per-debt "PROJECTED PAYOFF" on each Debt note now reflects the **real avalanche including
roll**, not each card in isolation. Displayed dates will move — non-target cards generally pay
off **sooner** (they receive rolled minimums), and the override/target card reflects its actual
attack. This is intended and more correct. (User approved.)

### `customJS` access / render-safety

All routed widgets already reach the engine via `customJS.FinanceMath.<method>` (see
`finance-hub-summary.js:43,56,72,136`). `projectedPayoff` is a new instance method on the same
class — same access pattern, same `customjs-guard` view, no new cold-load surface. Run
`npm run lint-cold-load` (the build-failing gate from v0.135.0) to confirm.

---

## Fix 3 — Coach reads synced budget actuals once governed (local skill)

**Where:** `~/.claude/skills/finance/references/map.md` (the "Computing the discretionary
envelope" section, ~line 64) + align the sibling route guides `status.md`, `weekly-check.md`,
`reconcile.md`, `monthly-plan.md` that repeat the "spent" instruction.

**Today (correct but incomplete):** "compute 'spent' from Copilot categories, NOT from the
month's `Budget.actual` fields … until a governed month is seeded (July 2026 is the first)."

**Change — add the freshness-conditional branch:**

> For a **governed** month (`month ≥ governed_from`) whose `Budget-<month>.md` has
> `actuals_source: copilot` **and** a fresh `actuals_synced_at` (≤ 8 days, matching the hub
> badge's "live" threshold), the budget `categories[].actual` fields **are** authoritative —
> read "spent" from them (this is what the on-hub badge shows; reading Copilot live would
> disagree). **Otherwise** (ungoverned month, or `actuals_source` ≠ `copilot`, or stale/absent
> `actuals_synced_at`) compute "spent" from Copilot live as today, and say which source you
> used.

This makes the coach and the hub badge tell the same story in every state, and stays safe
before go-live (no plan/no sync ⇒ unchanged Copilot-live behavior).

**Scope:** user-global skill at `~/.claude/skills/finance/`. **Not** shipped by the sauce
release pipeline — a local edit, reviewed manually, no version bump.

---

## Fix 6 — Housekeeping (folded in)

- **`Docs/agent-guides/cycle-status.md`** — regenerate to reflect workshop `0.135.0` + current
  catalogue and backfill missing `Docs/cycle-history.md` entries (cycles 132–135), via the
  repo's `regen-cycle-status` script (`Scripts/regen-cycle-status.js`, `npm run`). Verify the
  output rather than hand-editing.
- **`Docs/prompts/2026-06-17-breadcrumb-mechanism-handoff.md`** (untracked) — read it; if it's a
  real handoff doc, commit it with the cycle; if obsolete, remove it. **Confirm before
  deleting.**

---

## Tests

**Engine** (`platform/test/run-finance-plan-state.js`):
- `projectedPayoff` with a plan + finite payoff ⇒ `source: "plan"`, `zeroDebtDate ===
  computePlanState(...).payoff.zeroDebtDate`.
- `projectedPayoff` with no plan ⇒ `source: "entities"`, `zeroDebtDate ===
  debtTotals(debts).zeroDebtDate`.
- `projectedPayoff` with no debts ⇒ `source: "none"`, `zeroDebtDate === "—"`.
- `killOrder` slug matches a debt's `file.name` (per-debt lookup contract).

**Widgets** (`platform/test/run-finance-plan-widgets.js`):
- Finance hub hero and Debts hub render the **same** zero-debt date.
- `DebtSummary` per-debt date equals its `killOrder` entry's date.

## Shipping

- Helper edits propagate to the **seed-vault copies** under
  `platform/test/seed-vault/ranch/scripts/finance/` (debts-hub-summary, debt-summary,
  finance-math, finance-hub-summary) so the seed harness + `release:preflight` stay green.
- `release:preflight` green locally before merge (`run-finance-plan-state`,
  `run-finance-plan-widgets`, `run-helper-cases`, seed, `version-sync`, `lint-cold-load`,
  `lint-schemas`).
- `fix(finance): …` conventional commits to `main`. **Do not version, tag, sweep pins, or
  merge the release PR** — the auto-release pipeline computes semver, opens + auto-merges the
  release PR, tags, and ships to brew.
- The coach-skill edit (Fix 3) is committed/managed separately from the blueprint (different
  artifact, different machine path); it does not go through the pipeline.

## Risks / watch-items

- **Seed-vault skew wedging prepare-release** — known trap (snapshot SSOT). Mirror helper edits
  into the seed copies in the same change; don't hand-edit version literals.
- **`DebtSummary` monthKey** — must pass the current month so `projectedPayoff` can reach the
  plan; verify the lookup matches when the override targets a card (override key is normalized
  by stripping `[[ ]]`/`.md`; slug is bare `file.name`).
- **Per-debt visible change** — dates move (intended); no migration, pure render.
- **Coach-guide alignment** — make sure all four route guides agree, not just `map.md`, or the
  coach will contradict itself depending on which guide it loads.
