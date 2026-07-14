# Finance continuation prompt (fresh chat)

> Paste the block below into a new chat to continue finance work with zero context gaps. It points at the durable docs + memory + vault paths so the new session can rebuild full context.

---

I'm continuing work on **my personal finance system** — built on the Sauce **finance blueprint** and running live in my Obsidian **headspace** vault. Before doing anything, load context:

**1. Read these, in order:**
- `Docs/agent-guides/finance-blueprint.md` — the canonical reference: entities + data model, the `FinanceMath` engine, the Finance Plan (lever protocol), every widget, the month workflow, install heals, and the load-bearing invariants. **This is your map.**
- `Docs/agent-guides/build-test-verify.md` — preflight, the auto-release pipeline, deploy. `Docs/agent-guides/vault-paths.md` — workshop + consumer vault paths. `Docs/agent-guides/schemas.md` — the schema registry. `Docs/agent-guides/dev-workflow.md`.
- `Docs/landmines.md` — non-negotiable traps.
- The finance cycle docs under `Docs/plans/`: `2026-06-30-finance-month-reality-*`, `2026-07-01-monthly-paycheck-*`, `2026-07-01-finance-tweaks-*` (design + plan + the model decisions).
- Your auto-memory `MEMORY.md` — especially `project_v01570_monthly_paycheck`, `project_v01500_finance_month_reality`, `project_v01380_finance_correctness_pass`, and the autoloop lessons.

**2. The mental model (the one thing to internalize):**
- **Finance Plan** (`Finance Plan.md`) = steady-state policy. **Defaults** (`Budget/Paycheck/Debt Defaults.md`) = templates that seed new entities. **Per-month snapshots** (`Budget-YYYY-MM`, `Paycheck-YYYY-MM`, `Month-YYYY-MM`) = editable copies — edit the month for one-offs, edit the defaults for permanent changes.
- **THE ENVELOPE-ISOLATION INVARIANT:** the budget's discretionary Planned/Actual/Variance + over-flag are computed from `budget.categories[]` ONLY. Debt, savings, and fixed bills are display-only (the budget's reconcile-to-income full-picture) — never fold them into `categories[]` or the over-flag breaks.
- Paychecks are **monthly** now: one `Paycheck-YYYY-MM.md` with `deposits:[{date,amount}]` (the 1st + 15th checks) and `expenses[]` where each row's `deposit` tags which check pays it. Whole-month "green" = Total allocated ≤ income on the budget's full-picture.

**3. Where things stand (July 2026 setup):**
- Live on headspace + ero at **finance 0.16.0** (workshop v0.158.0). I've set my Paycheck Defaults (deposit_schedule + per-expense deposit tags), created my July monthly paycheck, and I'm using the budget's full-picture (Fixed itemized · Debt · Savings · Discretionary → reconcile to my $9k income). I'll run it through July and then know what to improve.

**4. How we ship finance changes (the workflow that works here):**
- Brainstorm → design doc → implementation plan → **subagent execution** (backward-compatible, TDD, each harness green) → PR → CI green → adversarial diff review → apply review fixes → **merge the feature PR** (sync main + `gh pr merge <n> --admin --merge` to beat the autoloop merge race) → wait for the **release PR** to ship (if it wedges `BEHIND`, `gh pr update-branch <release-pr>` — **never admin-merge the release PR**) → `brew update && brew upgrade sauce` → **deploy per vault** with `sauce update --bump-pins` in each of `~/notes/sauce/{headspace,ero,accuris}-sauce` → verify drift:none.
- Gotchas: conventional commits, **no `Co-Authored-By: Claude` trailer**; never hand-version/tag/pin; run `npm run release:preflight` + `release:preflight-bumped` before merge; customJS files = bare class only (no trailing statements); `entity-create:<X>` markers must LEAD their FinanceNav block.

**5. My task this session:** <describe what you want to change — e.g. "the budget full-picture should also show X", "add a new debt", "the paycheck should Y". I iterate: propose the design, confirm the fork if there's an envelope/UX tradeoff, then ship it all the way through deploy.>
