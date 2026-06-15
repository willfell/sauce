/**
 * MonthlyOverview — Read-only three-band rollup at the top of every Budget note.
 *
 * Renders ABOVE BudgetSummary. Answers "where did the money go and how much
 * did I move on debt" for the month.
 *
 * Band 1 — Income · Spending · Debt paydown · Net cashflow ($ + color).
 * Band 2 — Total debt balance + month-over-month delta (from balance_history[]).
 * Band 3 — Tiny audit footer (paycheck count + debt entity count).
 *
 * Headline math:
 *   income − spending − debtPaid = netCash
 *   income    = Σ paycheck_amount across paychecks with pay_period_start ~ this month
 *   spending  = Σ categories[*].actual on this Budget
 *   debtPaid  = Σ expenses[*].amount across paychecks where expenses[*].debt is
 *               a wikilink AND expenses[*].paid === true
 *   net color = green if >= 0; amber if loss <= 10% of income; red otherwise
 *
 * Pure derivation. Never writes. Embed-deduped.
 */
class MonthlyOverview {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .mo-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "budget") return;

        const monthKey = this._monthKeyFromPage(page);
        if (!monthKey) return;

        const paychecks = this._readPaychecks(dv, monthKey);
        const debts = this._readDebts(dv);
        const spending = this._sumActuals(page);
        const income = this._sumIncome(paychecks);
        const debtPaid = this._sumDebtPaid(paychecks);
        const netCash = income - spending - debtPaid;

        const root = dv.container.createEl("div", { cls: "mo-root" });
        root.setAttribute("data-month", monthKey);
        root.style.cssText = "margin: 12px 0 16px; padding: 14px 18px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";

        this._renderBand1(root, income, spending, debtPaid, netCash, debts);
        this._renderBand2(root, monthKey, debts);
        this._renderBand3(root, paychecks, debts, income);
    }

    // ----------------------------------------------------------------- palette

    static PALETTE = {
        green: "#16a34a",
        greenBg: "rgba(22, 163, 74, 0.10)",
        amber: "#b45309",
        amberBg: "rgba(180, 83, 9, 0.10)",
        red: "#dc2626",
        redBg: "rgba(220, 38, 38, 0.10)",
        muted: "var(--text-muted)",
        mutedBg: "transparent"
    };

    _colorFor(tone) { return MonthlyOverview.PALETTE[tone] || MonthlyOverview.PALETTE.muted; }
    _bgFor(tone) { return MonthlyOverview.PALETTE[`${tone}Bg`] || "transparent"; }

    // ----------------------------------------------------------------- parsing

    _monthKeyFromPage(page) {
        if (typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) return page.month;
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const m = name.match(/Budget-(\d{4}-\d{2})/);
            if (m) return m[1];
        }
        return null;
    }

    _fmtMoney(n, opts) {
        const o = opts || {};
        const num = typeof n === "number" && isFinite(n) ? n : 0;
        const abs = Math.abs(num).toFixed(2);
        const parts = abs.split(".");
        const dollars = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        let sign = "";
        if (o.signed) sign = num >= 0 ? "+" : "-";
        else if (num < 0) sign = "-";
        return `${sign}$${dollars}.${parts[1]}`;
    }

    // ----------------------------------------------------------------- reads

    _readPaychecks(dv, monthKey) {
        try {
            const pages = dv.pages('"spice/finance/paychecks"');
            const out = [];
            for (const p of pages) {
                if (!p) continue;
                if (p.type !== "paycheck") continue;
                if (typeof p.pay_period_start !== "string") continue;
                if (!p.pay_period_start.startsWith(monthKey)) continue;
                out.push(p);
            }
            return out;
        } catch (_e) {
            return [];
        }
    }

    _readDebts(dv) {
        try {
            const pages = dv.pages('"spice/finance/debts"');
            const out = [];
            for (const p of pages) {
                if (!p) continue;
                if (p.type !== "debt") continue;
                out.push(p);
            }
            return out;
        } catch (_e) {
            return [];
        }
    }

    _sumIncome(paychecks) {
        let total = 0;
        for (const p of paychecks) {
            if (typeof p?.paycheck_amount === "number") total += p.paycheck_amount;
        }
        return total;
    }

    _sumActuals(page) {
        const categories = Array.isArray(page.categories) ? page.categories : [];
        let total = 0;
        for (const c of categories) {
            if (c && typeof c.actual === "number") total += c.actual;
        }
        return total;
    }

    _sumDebtPaid(paychecks) {
        let total = 0;
        for (const p of paychecks) {
            const expenses = Array.isArray(p?.expenses) ? p.expenses : [];
            for (const e of expenses) {
                if (!e) continue;
                if (e.paid !== true) continue;
                if (typeof e.debt !== "string" || e.debt.length === 0) continue;
                if (typeof e.amount === "number") total += e.amount;
            }
        }
        return total;
    }

    _sumDebtBalances(debts) {
        let total = 0;
        for (const d of debts) {
            if (typeof d?.current_balance === "number") total += d.current_balance;
        }
        return total;
    }

    _mom(debts, monthKey) {
        // Return { delta, hasSignal } where hasSignal=true iff at least one debt
        // has BOTH a first-of-month and last-of-month snapshot in balance_history.
        let delta = 0;
        let hasSignal = false;
        for (const d of debts) {
            const hist = Array.isArray(d?.balance_history) ? d.balance_history : [];
            let first = null;
            let last = null;
            for (const h of hist) {
                if (!h || typeof h.date !== "string") continue;
                if (!h.date.startsWith(monthKey)) continue;
                if (typeof h.balance !== "number") continue;
                if (first === null || h.date < first.date) first = h;
                if (last === null || h.date > last.date) last = h;
            }
            if (first && last && first.date !== last.date) {
                delta += (last.balance - first.balance);
                hasSignal = true;
            }
        }
        return { delta, hasSignal };
    }

    _toneForNet(net, income) {
        if (net >= 0) return "green";
        const loss = Math.abs(net);
        if (income > 0 && loss <= 0.10 * income) return "amber";
        return "red";
    }

    // ----------------------------------------------------------------- band 1

    _renderBand1(root, income, spending, debtPaid, net, debts) {
        const band = root.createEl("div");
        band.style.cssText = "display: flex; gap: 22px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);";

        const mk = (label, val, valColor, muted) => {
            const cell = band.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 500; text-transform: uppercase;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            const color = valColor || (muted ? "var(--text-muted)" : "");
            valEl.style.cssText = `font-size: 1.35em; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 4px;${color ? " color: " + color + ";" : ""}`;
        };

        mk("Income", this._fmtMoney(income));
        mk("Spending", this._fmtMoney(spending));

        const hasDebts = Array.isArray(debts) && debts.length > 0;
        if (hasDebts || debtPaid !== 0) {
            mk("Debt paydown", this._fmtMoney(debtPaid));
        } else {
            mk("Debt paydown", "—", null, true);
        }

        const tone = this._toneForNet(net, income);
        mk("Net cashflow", this._fmtMoney(net, { signed: true }), this._colorFor(tone));
    }

    // ----------------------------------------------------------------- band 2

    _renderBand2(root, monthKey, debts) {
        const band = root.createEl("div");
        band.style.cssText = "padding: 12px 0 10px; display: flex; gap: 18px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--background-modifier-border);";

        if (!debts || debts.length === 0) {
            const empty = band.createEl("div");
            empty.textContent = "No debt tracked";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted);";
            return;
        }

        const totalBalance = this._sumDebtBalances(debts);
        const totalEl = band.createEl("div");
        totalEl.style.cssText = "flex: 1; min-width: 180px;";
        const totalLab = totalEl.createEl("span");
        totalLab.textContent = "Total debt ";
        totalLab.style.cssText = "font-size: 0.78em; color: var(--text-muted);";
        const totalVal = totalEl.createEl("span");
        totalVal.textContent = this._fmtMoney(totalBalance);
        totalVal.style.cssText = "font-size: 0.95em; font-variant-numeric: tabular-nums; font-weight: 500;";

        const { delta, hasSignal } = this._mom(debts, monthKey);
        const pillWrap = band.createEl("div");
        const pill = pillWrap.createEl("span");
        if (!hasSignal) {
            pill.textContent = "No MoM signal yet";
            pill.style.cssText = `display: inline-block; font-size: 0.78em; padding: 3px 9px; border-radius: 999px; color: ${this._colorFor("muted")}; background: ${this._bgFor("muted")}; border: 1px solid var(--background-modifier-border);`;
            return;
        }
        let tone;
        if (delta < 0) tone = "green";
        else if (delta > 0) tone = "red";
        else tone = "muted";
        pill.textContent = `MoM ${delta <= 0 ? "↓" : "↑"} ${this._fmtMoney(Math.abs(delta))}`;
        pill.style.cssText = `display: inline-block; font-size: 0.78em; padding: 3px 9px; border-radius: 999px; color: ${this._colorFor(tone)}; background: ${this._bgFor(tone)}; border: 1px solid ${this._colorFor(tone)}33;`;
    }

    // ----------------------------------------------------------------- band 3

    _renderBand3(root, paychecks, debts, income) {
        const band = root.createEl("div");
        band.style.cssText = "padding-top: 10px; font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.02em;";

        const pCount = Array.isArray(paychecks) ? paychecks.length : 0;
        const dCount = Array.isArray(debts) ? debts.length : 0;

        if (pCount === 0) {
            band.textContent = `No paychecks dated this month — income shown as $0. ${dCount} debt ${dCount === 1 ? "entity" : "entities"} surveyed.`;
            return;
        }
        band.textContent = `From ${pCount} paycheck${pCount === 1 ? "" : "s"} (Σ ${this._fmtMoney(income)}), ${dCount} debt ${dCount === 1 ? "entity" : "entities"} surveyed.`;
    }
}
