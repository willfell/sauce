/**
 * MonthDashboard — Three-section dashboard for individual Month notes.
 *
 * Renders Budget Analysis + Paycheck Totals + Debt Changes for a given
 * month entity. monthKey derived from frontmatter `month` or filename.
 *
 * CSS root: mdash-root. Embed-deduped. Never writes. Pure derivation.
 */
class MonthDashboard {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .mdash-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "month") return;

        const monthKey = this._resolveMonthKey(page);
        if (!monthKey) return;

        const root = dv.container.createEl("div", { cls: "mdash-root" });
        root.style.cssText = "margin: 12px 0 20px;";

        const paychecks = customJS.FinanceMath.readPaychecksForMonth(dv, monthKey);
        const budget = customJS.FinanceMath.readBudgetForMonth(dv, monthKey);
        const debts = customJS.FinanceMath.readDebts(dv);

        this._renderBudgetAnalysis(root, dv, monthKey, budget);
        this._renderPaycheckTotals(root, paychecks);
        this._renderDebtChanges(root, dv, paychecks, debts, monthKey);
    }

    // ----------------------------------------------------------------- helpers

    _resolveMonthKey(page) {
        if (typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) {
            return page.month;
        }
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const m = name.match(/Month-(\d{4}-\d{2})/);
            if (m) return m[1];
        }
        return null;
    }

    _fmtMoney(n, opts) {
        return customJS.FinanceMath.fmtMoney(n, opts);
    }

    _toneForVariance(variance, planned) {
        if (variance >= 0) return "green";
        const loss = Math.abs(variance);
        if (planned > 0 && loss <= 0.10 * planned) return "amber";
        return "red";
    }

    _colorFor(tone) {
        const COLORS = { green: "#16a34a", amber: "#b45309", red: "#dc2626" };
        return COLORS[tone] || "var(--text-muted)";
    }

    _sectionHeader(parent, text) {
        const h = parent.createEl("div", { cls: "mdash-section-header" });
        h.textContent = text;
        h.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;";
        return h;
    }

    _sectionWrap(root, cls) {
        const s = root.createEl("div", { cls });
        s.style.cssText = "margin-bottom: 16px; padding: 14px 16px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";
        return s;
    }

    _muted(parent, text) {
        const el = parent.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.85em; color: var(--text-muted);";
        return el;
    }

    // ----------------------------------------------------------------- Budget Analysis

    _renderBudgetAnalysis(root, dv, monthKey, budget) {
        const section = this._sectionWrap(root, "mdash-budget");
        this._sectionHeader(section, "Budget Analysis");

        if (!budget) {
            this._muted(section, "No budget for this month.");
            const btn = section.createEl("button");
            btn.textContent = "Budgets Hub";
            btn.style.cssText = "margin-top: 8px; font-size: 0.82em; padding: 4px 10px; border-radius: 4px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
            btn.addEventListener("click", () => {
                app.workspace.openLinkText("spice/finance/budgets/Budgets.md", "");
            });
            return;
        }

        const cats = Array.isArray(budget.categories) ? budget.categories : [];
        const totalPlanned = cats.reduce((s, c) => s + ((c && typeof c.planned === "number") ? c.planned : 0), 0);
        const totalActual = customJS.FinanceMath.monthSpending(budget);
        const variance = totalPlanned - totalActual;

        const headerEl = section.createEl("div", { cls: "mdash-budget-header" });
        headerEl.textContent = `Planned ${this._fmtMoney(totalPlanned)} · Actual ${this._fmtMoney(totalActual)} · Variance ${this._fmtMoney(variance, { signed: true })}`;
        headerEl.style.cssText = "font-size: 0.9em; font-variant-numeric: tabular-nums; margin-bottom: 10px;";

        const plan = customJS.FinanceMath.readPlan(dv);
        const fresh = customJS.FinanceMath.actualsFreshness(budget, monthKey, plan && plan.governed_from);
        if (fresh.state !== "none") {
            const COLORS = { green: "#16a34a", amber: "#b45309", muted: "var(--text-muted)" };
            const badge = section.createEl("div");
            badge.textContent = fresh.label || fresh.state;
            badge.style.cssText = `display: inline-block; font-size: 0.66em; letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; margin-bottom: 10px; color: ${COLORS[fresh.tone] || COLORS.muted};`;
        }

        const groups = new Map();
        for (const c of cats) {
            if (!c) continue;
            const g = (typeof c.group === "string" && c.group.trim()) ? c.group.trim() : "Unassigned";
            if (!groups.has(g)) groups.set(g, { planned: 0, actual: 0 });
            const entry = groups.get(g);
            entry.planned += (typeof c.planned === "number") ? c.planned : 0;
            entry.actual  += (typeof c.actual  === "number") ? c.actual  : 0;
        }

        const groupWrap = section.createEl("div", { cls: "mdash-budget-groups" });
        groupWrap.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        for (const [groupName, totals] of groups) {
            const gVariance = totals.planned - totals.actual;
            const tone = this._toneForVariance(gVariance, totals.planned);
            const row = groupWrap.createEl("div", { cls: "mdash-budget-group-row" });
            row.style.cssText = "display: flex; gap: 8px; font-size: 0.82em; font-variant-numeric: tabular-nums;";
            const nameEl = row.createEl("span");
            nameEl.textContent = groupName + ":";
            nameEl.style.cssText = "min-width: 120px; color: var(--text-muted);";
            const statsEl = row.createEl("span");
            statsEl.textContent = `${this._fmtMoney(totals.planned)} planned / ${this._fmtMoney(totals.actual)} actual / ${this._fmtMoney(gVariance, { signed: true })} variance`;
            statsEl.style.cssText = `color: ${this._colorFor(tone)};`;
        }
    }

    // ----------------------------------------------------------------- Paycheck Totals

    _renderPaycheckTotals(root, paychecks) {
        const section = this._sectionWrap(root, "mdash-paychecks");
        this._sectionHeader(section, "Paycheck Totals");

        const income = customJS.FinanceMath.monthIncome(paychecks);
        const expenses = customJS.FinanceMath.monthExpensesTotal(paychecks);

        // Build the row set: one row PER DEPOSIT for month-keyed notes (each check
        // that landed this month), or a single row for a legacy per-check note.
        // Each row carries its own income figure so the deposit dates line up with
        // the schedule the paycheck editor materialized.
        const rows = [];
        for (const p of paychecks) {
            if (Array.isArray(p.deposits) && p.deposits.length) {
                for (const d of p.deposits) {
                    const dateStr = customJS.FinanceMath._coerceDateString(d && d.date) || String((d && d.date) || "");
                    rows.push({ label: dateStr, amount: Number(d && d.amount) || 0, page: p });
                }
            } else {
                // Legacy per-check note: label by the pay date (pay_period_end, the
                // month-attribution anchor), falling back to pay_period_start.
                const payDate = (p.pay_period_end != null) ? p.pay_period_end : p.pay_period_start;
                const dateStr = customJS.FinanceMath._coerceDateString(payDate) || String(payDate || "");
                const amount = typeof p.paycheck_amount === "number" ? p.paycheck_amount : 0;
                rows.push({ label: dateStr, amount, page: p });
            }
        }

        // Pluralize on the number of income events (deposits + legacy checks),
        // not the number of notes — a single monthly note holds multiple deposits.
        const eventCount = rows.length;
        const anyMonthly = paychecks.some(p => Array.isArray(p.deposits) && p.deposits.length);
        const eventNoun = anyMonthly ? "deposit" : "paycheck";
        const headerEl = section.createEl("div", { cls: "mdash-paychecks-header" });
        headerEl.textContent = `Income ${this._fmtMoney(income)} · Expenses ${this._fmtMoney(expenses)} · ${eventCount} ${eventNoun}${eventCount === 1 ? "" : "s"}`;
        headerEl.style.cssText = "font-size: 0.9em; font-variant-numeric: tabular-nums; margin-bottom: 10px;";

        if (eventCount === 0) {
            this._muted(section, "No paychecks for this month.");
            return;
        }

        const rowWrap = section.createEl("div", { cls: "mdash-paychecks-rows" });
        rowWrap.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        for (const r of rows) {
            const row = rowWrap.createEl("div", { cls: "mdash-paycheck-row" });
            row.style.cssText = "font-size: 0.82em; font-variant-numeric: tabular-nums; cursor: pointer; color: var(--text-normal);";
            row.textContent = `${r.label} — ${this._fmtMoney(r.amount)}`;
            row.addEventListener("click", () => {
                if (r.page && r.page.file && r.page.file.name) app.workspace.openLinkText(r.page.file.name, "");
            });
        }
    }

    // ----------------------------------------------------------------- Debt Changes

    _renderDebtChanges(root, dv, paychecks, debts, monthKey) {
        const section = this._sectionWrap(root, "mdash-debts");
        this._sectionHeader(section, "Debt Changes");

        const paydown = customJS.FinanceMath.monthDebtPaid(paychecks);
        const mv = customJS.FinanceMath.measuredMovement(debts, monthKey);
        const rec = customJS.FinanceMath.reconcile(paydown, mv);

        // Planned (budget) allocation per debt — the third leg of the
        // planned/paid/measured reconciliation. Keyed by every representation a
        // Debt Changes row can carry: slug, name, and the [[slug]] wikilink form.
        const plannedBySlug = new Map();
        try {
            const alloc = customJS.FinanceMath.budgetAllocations(dv, monthKey);
            const rows = (alloc && Array.isArray(alloc.debt)) ? alloc.debt : [];
            for (const a of rows) {
                if (!a || typeof a.planned !== "number") continue;
                if (a.slug != null) {
                    plannedBySlug.set(String(a.slug), a.planned);
                    plannedBySlug.set(`[[${a.slug}]]`, a.planned);
                }
                if (a.name != null) plannedBySlug.set(String(a.name), a.planned);
            }
        } catch (_e) { /* planned column is best-effort; never blocks the section */ }

        const headerEl = section.createEl("div", { cls: "mdash-debts-header" });
        headerEl.textContent = `Paydown applied ${this._fmtMoney(rec.paydownApplied)} · Measured drop ${this._fmtMoney(rec.measuredDrop)} · Interest/charges ${this._fmtMoney(rec.interestAndCharges)}`;
        headerEl.style.cssText = "font-size: 0.9em; font-variant-numeric: tabular-nums; margin-bottom: 10px;";

        const paidByDebt = customJS.FinanceMath.debtPaidByDebt(paychecks);
        const perDebt = mv.perDebt;

        const allKeys = new Set([...paidByDebt.keys(), ...perDebt.keys()]);

        if (allKeys.size === 0) {
            this._muted(section, "No debt activity this month.");
            return;
        }

        const rowWrap = section.createEl("div", { cls: "mdash-debts-rows" });
        rowWrap.style.cssText = "display: flex; flex-direction: column; gap: 4px;";

        for (const key of allKeys) {
            const paidEntry = paidByDebt.get(key);
            const mvEntry = perDebt.get(key);

            const row = rowWrap.createEl("div", { cls: "mdash-debt-row" });
            row.style.cssText = "display: flex; gap: 8px; font-size: 0.82em; font-variant-numeric: tabular-nums;";

            const nameEl = row.createEl("span");
            nameEl.textContent = key + ":";
            nameEl.style.cssText = "min-width: 120px; color: var(--text-muted);";

            const paidAmt = paidEntry ? this._fmtMoney(paidEntry.amount) : "—";
            const measuredCell = (mvEntry && mvEntry.hasSignal)
                ? this._fmtMoney(Math.abs(mvEntry.delta))
                : "snapshot pending";
            const plannedCell = plannedBySlug.has(key) ? this._fmtMoney(plannedBySlug.get(key)) : "—";

            const detailEl = row.createEl("span");
            detailEl.textContent = `planned ${plannedCell} · paydown ${paidAmt} · measured drop ${measuredCell}`;
        }
    }
}
