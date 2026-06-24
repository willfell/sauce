---
purpose: Design doc for the Copilot actuals-sync cycle (finance 0.11.0 / workshop 0.131.0).
kind: design
date: 2026-06-23
blueprint: finance
finance_version: 0.11.0
workshop_version: 0.131.0
arc: hub-as-brain (sub-project 2 of 3)
---

# Sub-project 2 — Copilot actuals sync

Sub-project 2 of the "hub-as-brain" arc (1 = correctness, shipped v0.130.0; **2 = this**; 3 = seed + go-live). Goal: pull real Copilot category spend into the governed month's `Budget-<month>.md` `categories[].actual`, so the hub's "spent / left" is **live data, not hand-typed**.

## Two findings that shaped the design

1. **The mapping is essentially already solved.** The headspace budget category names are ~1:1 with the Copilot envelope categories the finance skill already lists (`Groceries`, `Taco`, `Taco Juice`, `Restaurants`, `Door Dash`, `Uber`, `Misc Shopping`, `Dogs`, `Home`, `Haircut`, `Gift`, `Alcohol/Bud/Misc`, `Entertainment`, `Cash`, `Snacks`, `Subscriptions`, `Outdoors`, `Golf`, `Nicotine`, `Prescriptions`, `Health`, `Travel`). This is a **name-match**, not a translation problem — at most a small alias table for edge cases.
2. **Copilot is reachable only locally.** `copilot-money` is a local **stdio** MCP (`/opt/homebrew/bin/copilot-money-mcp`) reading the Copilot app's local DB. A cloud Cowork scheduled job can't touch it — only an agent running on the mac can. So the scheduled path is a **local launchd cron**, not cloud cron.

Also: the **July 2026 budget already exists** on disk, so the write target for the first governed month is ready.

## Decisions (from the brainstorm)

| Axis | Decision |
| --- | --- |
| Cadence | On-demand **and** a local launchd cron (both, this cycle) |
| Cron engine | **Headless `claude -p`** driving the same skill route in `--unattended` mode (correctness anchored in one skill); deterministic core does the money math |
| Shipped surface | **Freshness badge** — a thin, generic blueprint marker (`actuals_synced_at` / `actuals_source`) + a "live / stale / typed" badge on the hub + month dashboard |
| Cron write policy | **Write + log + notify**: snapshot-first, write, append to `Sync Log.md`, fire a notification; **abort (no write) if Copilot connection is stale** |
| Money math | **Deterministic core** — the LLM never sums or maps numbers; it only orchestrates the MCP fetch and (interactive) confirms |

## Architecture — one route, two modes, two homes

```
Copilot (local stdio MCP, read-only)
        │  get_categories(this_month) + get_connection_status
        ▼
┌─────────────────────────────────────────────┐
│  SYNC ROUTE  (finance skill — sync-actuals)  │   ← anchors correctness
│   mode=interactive   |   mode=--unattended   │
└───────────────┬──────────────────────────────┘
                │ calls
                ▼
┌─────────────────────────────────────────────┐
│  DETERMINISTIC CORE  (skill-owned node)      │
│  name-match + alias table + EXCLUDE set      │
│  → per-category new actual + unmapped report │
│  → snapshot backup → write categories[].actual│
│  → stamp actuals_synced_at / actuals_source  │
└───────────────┬──────────────────────────────┘
                ▼
  Budget-<gov-month>.md   +   Sync Log.md   +   notification
                ▲
┌───────────────┴──────────────────────────────┐
│  SHIPPED BLUEPRINT (finance 0.11.0)          │
│  freshness badge: reads actuals_synced_at →  │
│  "live as of <date>" / "stale" / "typed"     │
│  on FinanceHubSummary + MonthDashboard       │
└───────────────────────────────────────────────┘
```

### Home 1 — local skill + cron infra (NOT released)
Lives in `~/.claude/skills/finance/`. Will-specific (his Copilot categories) → correctly stays out of shipped platform per the generalizability intent. Pieces:

- `scripts/sync-actuals-core.mjs` — the **deterministic core** (pure, testable). Input: Copilot `get_categories` JSON + target budget path. Output: new `categories[].actual` + two flag lists + a written file. No network, no LLM.
- `scripts/sync-actuals-core.test.mjs` — node unit test (fixture JSON → expected actuals, both flag lists, idempotency, stale-abort).
- `references/copilot-category-map.md` — the EXCLUDE set + the alias table (seeded thin; refined on the first real July run).
- `references/sync-actuals.md` — the **sync route** (the skill steps for both modes); referenced from `references/map.md` + `references/sync.md`.
- `cron/com.will.finance-actuals-sync.plist` + `references/cron-setup.md` — the launchd job (weekly) + install/uninstall instructions.

### Home 2 — shipped blueprint (released to all subscribing vaults)
Generic freshness marker + badge only. No Will-specific identifiers.

- `actuals_synced_at` (ISO timestamp, optional) + `actuals_source` (`copilot` | `manual`, optional) read by the widgets.
- Badge rendering in `finance-hub-summary.js` (the Plan/Month tile) + `month-dashboard.js`.
- No install migration (additive optional fields; absence ⇒ "typed").

## B. Deterministic core (the money math)

Pure node module. Both modes call it. Steps:

1. **Exclude** everything in the EXCLUDE set (Brex, Consulting, Claude, AWS, Rent, Taco Lease, insurance, Student Loans, Utilities, Phone, Credit Payment, Interest Charge, Uncategorized) — straight from `map.md`.
2. **Name-match** each remaining Copilot category to a budget category (normalized: trim / lowercase / collapse punctuation), with an **alias table** for the handful that don't match 1:1.
3. Emit per-budget-category new `actual` (sum of matched Copilot categories) **plus two flag lists**:
   - `unmappedCopilot[]` — Copilot spend that found no budget home (not excluded, no match).
   - `unsourcedBudget[]` — a budget category whose name isn't present in Copilot at all (config gap → **flag, never silently zero**; its prior `actual` is left untouched).
4. **Overwrite-with-latest** (Copilot month-to-date is cumulative → idempotent; re-run same day = no diff). **Snapshot** `.sauce-backup/<ts>/` first, then write `categories[].actual` + stamp `actuals_synced_at` + `actuals_source: copilot`.

The write uses headless-safe file editing (read file → regex/YAML-aware replace of the `categories:` block → write), never Obsidian `processFrontMatter` (the core runs outside Obsidian).

## C. Sync route — two modes

- **Interactive (`/finance sync`)**: pull → core computes diff → **preview old→new per category + the two flag lists → confirm → write**.
- **`--unattended` (cron)**: pull → **abort if `get_connection_status` is stale** → snapshot → write → append a reverse-chron entry to `spice/finance/Sync Log.md` → fire a macOS notification (`osascript -e 'display notification …'`). You review the log after.
- **Target-month guard** (both modes): only the **current calendar month's budget, and only if it is governed** (`month >= governed_from`). Today (June, `governed_from` July) → "current month is baseline — nothing to sync", no write. Missing budget file → "no budget for `<month>`, seed it first" (hands to sub-project 3).

## D. Cron

`launchd` plist, **weekly** (Sunday evening, to feed the weekly check), runs `claude -p` headless → the sync skill in `--unattended`. Negligible tokens. On-demand runs anytime regardless. Cron is a **no-op until July** by design (the governed_from gate), so it is safe to install now.

## E. Freshness badge (the shipped piece)

On `FinanceHubSummary` (Plan/Month tile) + `MonthDashboard`, gated to governed months:

| State | Condition | Tone |
| --- | --- | --- |
| **live** | `actuals_synced_at` within 8 days | green |
| **stale** | `actuals_synced_at` older than 8 days | amber |
| **typed** | no `actuals_synced_at` | muted |

Baseline months (`< governed_from`) keep the v0.130.0 "baseline — not scored" framing and get **no** sync badge.

## F. Testing

- **Core (local):** node unit test in the skill dir — fixture Copilot JSON → expected actuals, both flag lists, idempotency (re-run = no diff), stale-abort, baseline-month no-op.
- **Blueprint (preflight):** badge render states (live / stale / typed / baseline) added to the finance widget harness (`run-finance-plan-widgets.js`).

## G. Versioning

finance **0.10.3 → 0.11.0** (additive feature), workshop **0.130.0 → 0.131.0** (0.131 is free; 0.129 belongs to the auto-release PR #25). Driven by `compute-release.js --write` (regenerates the version snapshot + all pins; landmine #16 manual sweep retired). Seed-vault subscription finance pin bumped to 0.11.0 to match the catalogue. **No data migration** — lighter install footprint than v0.130.0.

## Risks / calls made

- **Determinism for money** — the LLM never sums or maps numbers; the core is pure + tested.
- **Alias table seeded thin** and refined on the **first real July run** (names are ~1:1, ≤2 aliases expected). First run is interactive, so it's eyeballed before the cron ever fires.
- **Cron is a no-op until July** (governed_from gate) — safe to install now.
- **Headless cron needs Claude CLI auth** to stay valid; if it lapses, the cron no-ops loudly (logs + notifies) rather than writing guesses.

## Carry-forwards

- **Sub-project 3 — seed + go-live.** Create the governed month's budget from envelope defaults, run the first interactive sync, run the cadence.
- The alias table is finalized on the first real July sync.
