---
type: scheduled-context
---

# Finance Goals & Personal Finance Context

> [!info] User-managed
> Edit freely. The morning + EOD orchestrators read this for posture (which cards are locked, what categories to flag, what the active payoff target is). No cowork skill writes to this file -- it survives `sauce update`.

## Primary Goal

{{primary_finance_goal}}

One-line statement of the owner's current top-priority finance goal (e.g. "pay down CC debt to zero in 24 months", "save $20K for down payment by Q4"). The morning briefing leads with progress toward this goal.

---

## Income

- Salary: {{income_salary}}
- Side income: {{income_side}}
- Other: {{income_other}}

---

## Accounts

### Banking & Cash

| Institution | Account | Balance | Notes |
|:------------|:--------|:--------|:------|
| {{bank_1_name}} | {{bank_1_acct}} | {{bank_1_balance}} | {{bank_1_notes}} |
| {{bank_2_name}} | {{bank_2_acct}} | {{bank_2_balance}} | {{bank_2_notes}} |

### Credit Cards (debt)

| Card | Last 4 | Balance | Limit | APR | Status |
|:-----|:-------|:--------|:------|:----|:-------|
| {{cc_1_name}} | {{cc_1_last4}} | {{cc_1_balance}} | {{cc_1_limit}} | {{cc_1_apr}} | {{cc_1_status}} |
| {{cc_2_name}} | {{cc_2_last4}} | {{cc_2_balance}} | {{cc_2_limit}} | {{cc_2_apr}} | {{cc_2_status}} |

**Locked cards** (no new charges should appear): {{locked_cards_list}}
**Active daily driver:** {{active_card}}
**Current payoff target:** {{payoff_target_card}}
**Monthly payoff attack:** {{monthly_payoff_target_usd}}

---

## Savings Goals

| Goal | Target | Current | Notes |
|:-----|:-------|:--------|:------|
| {{savings_goal_1_name}} | {{savings_goal_1_target}} | {{savings_goal_1_current}} | {{savings_goal_1_notes}} |

---

## Spending Rules

- {{spending_rule_1}}
- {{spending_rule_2}}
- {{spending_rule_3}}

Default stance: don't spend it. Necessities only: rent, groceries, gas, utilities, insurance. Anything else flagged for review.

---

## Discretionary Categories (to flag)

{{discretionary_categories}}

List the spending categories the owner wants flagged when they appear in daily transactions. Common entries: Restaurants, Clothing, Subscriptions, Door Dash, Misc Shopping.

---

## Transaction Flagging Rules

When reviewing daily transactions, the morning briefing flags:
- Any transaction over {{flag_threshold_usd}} that isn't rent, utilities, or groceries
- Restaurant/food delivery charges
- Subscription charges
- Any merchant the owner hasn't seen before
- Multiple small purchases at the same merchant (impulse pattern)
- **Locked-card charges** -- always flagged, no threshold
- Uncategorized transactions
