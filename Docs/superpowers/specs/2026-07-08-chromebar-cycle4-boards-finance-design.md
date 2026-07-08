# ChromeBar Cycle 4: Boards + Finance — Design

**Goal:** Extend the shared ChromeBar mechanism to the two remaining blueprints deliberately deferred from cycle 3: `boards` and `finance`.

## Context

Cycle 3 shipped `TripsChromeBar`, `ReaderChromeBar`, `PeopleChromeBar`, `ProductsChromeBar`, `TeamsChromeBar`, `JournalChromeBar` (v0.202.0). Two blueprints were explicitly out of scope:

- **boards** — flagged "likely skip" because kanban-card notes render inside the Kanban plugin's board view, not a normal reading-view page.
- **finance** — flagged "needs its own evaluation" because it has a materially richer existing nav system (`FinanceNav`) than a simple `SpaceNavButtons` swap.

## Boards

**Current state:** `platform/blueprints/boards/templates/Template, Board Card.md` — `type: board-card`, single surface, chrome is a bare `SpaceNavButtons` block followed by a trailing literal `---` divider. No dedicated nav/action helper exists to guard or retire. Structurally identical to journal's pre-cycle-3 shape.

**Design:** Create `BoardsChromeBar` mirroring `JournalChromeBar` exactly — single surface (`detect` matches `type: board-card`), no primary button, no overflow, always `leaf: true`, no-op `dispatch`, single-entry `destinations` (`{section: "This boards"}`, no hub link since board cards don't have a hub-and-spoke relationship the way other entities do). Swap the template's `SpaceNavButtons` block for `BoardsChromeBar` and drop the trailing `---`.

No migration heal changes needed beyond the standard `CHROME_BAR_MAP`/`applyNoteChromeHeal` wiring (mirrors journal's Task 1-equivalent wiring).

## Finance

**Current state:** `FinanceNav` (`platform/blueprints/finance/helpers/finance-nav.js`) is the sole context-aware nav for all 7 finance hubs (Finance, Budgets, Paychecks, Invoices, Debts, Months, Savings) and 6 entity types (budget, paycheck, invoice, debt, month, savings-account), plus 3 "defaults" config pages. It renders a two-tier layout per page: a cross-hub row (links to the other 6 hubs), then a context-specific row that varies by mode — "+ New X" via `EntityCreate` on hub pages, prev/next sibling navigation (sorted by `month` or `current_balance`) on entity pages, "X Defaults" links, etc. Sections are separated by literal `<hr>` elements. Unlike every other blueprint touched in cycle 3, finance's hubs carry `SpaceNavButtons + FinanceNav` with **no breadcrumb at all** — finance predates the vault-wide breadcrumb convention.

**Design (partial integration, mirrors the `PersonNavButtons` precedent):** ChromeBar's `surfaceSpec`/`destinations` model (one primary button + a flat overflow menu + a flat Go▾ list) cannot losslessly represent FinanceNav's richer per-mode layout — particularly the prev/next sibling nav and the multi-branch context row — without either dropping functionality or awkwardly overloading the overflow menu. Rather than force a full replacement, `FinanceChromeBar` will render **only the shared top bar**: breadcrumb (new capability for finance) + a Go▾ launcher listing the 7 hubs, replacing what `SpaceNavButtons` did. `FinanceNav` is left completely untouched below it, continuing to render its cross-hub row, context actions, and prev/next nav exactly as today.

This gives finance a breadcrumb for the first time and a Go▾ launcher consistent with every other blueprint, while touching zero of `FinanceNav`'s actual logic — no risk to the "+ New X" EntityCreate flow, sibling nav, or defaults links.

`FinanceChromeBar`'s `_config()`:
- `detect`: classifies by `page.type`/`file.path` across all 7 hubs + 6 entity types + 3 defaults pages (reusing `FinanceNav._detectMode`'s classification logic, adapted to ChromeBar's `{context, path}` return shape).
- `surfaceSpec`: `primary: null, overflow: []` on every surface (no chrome-owned actions — `FinanceNav` already owns "+ New X" and defaults links).
- `dispatch`: no-op.
- `destinations`: `{section: "This finance"}` header + the 7 hubs (self-link omitted per the existing self-omission pattern).
- `rootClass: "finance-chrome-root"`; no guard needed on `FinanceNav` itself since nothing in it is being retired/duplicated — it keeps rendering unconditionally below the new bar.

**Testing:** Standard `run-finance-chrome-bar.js` following the canonical shape (detect/surfaceSpec/dispatch/destinations), plus a spot-check that `FinanceNav`'s existing test suite (`run-finance-plan-*.js` etc.) is unaffected since we're not touching that file.

## Out of scope

- No changes to `FinanceNav`, `FinanceNavRow`, `FinanceHubActions`, or any finance entity logic.
- No new prev/next or "+ New X" primitives added to `ChromeBar` itself.
- Migration heal for finance hubs follows the same `CHROME_BAR_MAP` pattern as every prior cycle blueprint.
