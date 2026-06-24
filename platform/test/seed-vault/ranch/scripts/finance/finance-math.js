class FinanceMath {
    // ---- date coercion (v0.115.2) ----
    // Dataview parses unquoted YAML dates (e.g. `pay_period_start: 2026-05-15`)
    // as Luxon DateTime objects; quoted ones (`"2026-05-15"`) stay strings.
    // Without coercion, `p.pay_period_start === "2026-05-15"` is false even when
    // the file's literal value matches — same gotcha v0.114.0 closed in
    // MonthlyOverview. Coercion accepts string / Luxon DateTime / native Date
    // / moment and returns canonical strings.
    _coerceDateString(v) {
        if (v == null) return null;
        if (typeof v === "string") return v;
        if (typeof v.toISODate === "function") {
            // Luxon DateTime — toISODate() returns "YYYY-MM-DD"
            const s = v.toISODate();
            return typeof s === "string" ? s : null;
        }
        if (v instanceof Date && !isNaN(v.getTime())) {
            return v.toISOString().slice(0, 10);
        }
        if (typeof v.format === "function") {
            // moment
            const s = v.format("YYYY-MM-DD");
            return typeof s === "string" ? s : null;
        }
        return null;
    }
    _coerceMonthString(v) {
        const s = this._coerceDateString(v);
        return s ? s.slice(0, 7) : null;
    }

    // ---- reads ----
    readDebts(dv) {
        try { return dv.pages('"spice/finance/debts"').where(p => p && p.type === "debt").array(); }
        catch (_e) { return []; }
    }
    readPaychecksForMonth(dv, monthKey) {
        try {
            return dv.pages('"spice/finance/paychecks"').where(p => {
                if (!p || p.type !== "paycheck") return false;
                const s = this._coerceDateString(p.pay_period_start);
                return typeof s === "string" && s.startsWith(monthKey);
            }).array();
        } catch (_e) { return []; }
    }
    readBudgetForMonth(dv, monthKey) {
        try {
            const hits = dv.pages('"spice/finance/budgets"').where(p => {
                if (!p || p.type !== "budget") return false;
                // Accept p.month as string, Luxon DateTime, Date, or moment.
                const m = this._coerceMonthString(p.month);
                return m === monthKey;
            }).array();
            return hits.length ? hits[0] : null;
        } catch (_e) { return null; }
    }
    monthBounds(monthKey) {
        const [y, m] = monthKey.split("-").map(Number);
        const first = `${monthKey}-01`;
        const ny = m === 12 ? y + 1 : y;
        const nm = m === 12 ? 1 : m + 1;
        const lastExclusive = `${ny}-${String(nm).padStart(2, "0")}-01`;
        return { first, lastExclusive };
    }
    debtTotals(debts) {
        const totalBalance = debts.reduce((s, d) => s + (Number(d.current_balance) || 0), 0);
        const monthlyInterest = debts.reduce((s, d) =>
            s + ((Number(d.current_balance) || 0) * (Number(d.apr) || 0) / 100 / 12), 0);
        const plannedAttack = debts.reduce((s, d) => s + (Number(d.planned_monthly_payment) || 0), 0);
        const wNumer = debts.reduce((s, d) =>
            s + (Number(d.current_balance) || 0) * (Number(d.apr) || 0), 0);
        const weightedApr = totalBalance > 0 ? wNumer / totalBalance : 0;
        let zeroDebtDate = "—";
        const principalAttack = plannedAttack - monthlyInterest;
        if (principalAttack > 0 && totalBalance > 0) {
            const months = Math.ceil(totalBalance / principalAttack);
            const d = new Date();
            d.setMonth(d.getMonth() + months);
            zeroDebtDate = d.toISOString().slice(0, 10);
        }
        return { totalBalance, monthlyInterest, plannedAttack, weightedApr, zeroDebtDate };
    }
    monthIncome(paychecks) {
        return paychecks.reduce((s, p) => s + (typeof p.paycheck_amount === "number" ? p.paycheck_amount : 0), 0);
    }
    monthSpending(budget) {
        if (!budget || !Array.isArray(budget.categories)) return 0;
        return budget.categories.reduce((s, c) => s + (c && typeof c.actual === "number" ? c.actual : 0), 0);
    }
    monthExpensesTotal(paychecks) {
        let total = 0;
        for (const p of paychecks) {
            const ex = Array.isArray(p.expenses) ? p.expenses : [];
            for (const e of ex) if (e && typeof e.amount === "number") total += e.amount;
        }
        return total;
    }
    // v0.115.3: Dataview auto-converts wikilink-shaped frontmatter strings
    // (e.g. "[[Debt-X]]") into Link objects with { path, display, type }.
    // _debtKey normalizes string OR Link object to a stable string key so
    // monthDebtPaid + debtPaidByDebt match either form (and the same expense
    // groups regardless of how Dataview chose to parse it).
    _debtKey(v) {
        if (v == null) return null;
        if (typeof v === "string") return v.trim().length > 0 ? v.trim() : null;
        if (typeof v === "object") {
            if (typeof v.path === "string" && v.path.length > 0) {
                // Canonicalize: strip optional .md
                return `[[${v.path.replace(/\.md$/, "")}]]`;
            }
            if (typeof v.display === "string" && v.display.length > 0) return `[[${v.display}]]`;
        }
        return null;
    }
    monthDebtPaid(paychecks) {
        let total = 0;
        for (const p of paychecks) {
            const ex = Array.isArray(p.expenses) ? p.expenses : [];
            for (const e of ex) {
                if (!e || e.paid !== true) continue;
                if (!this._debtKey(e.debt)) continue;
                if (typeof e.amount === "number") total += e.amount;
            }
        }
        return total;
    }
    debtPaidByDebt(paychecks, opts) {
        const paidOnly = !opts || opts.paidOnly !== false;
        const map = new Map();
        for (const p of paychecks) {
            const ex = Array.isArray(p.expenses) ? p.expenses : [];
            for (const e of ex) {
                const key = this._debtKey(e && e.debt);
                if (!key) continue;
                if (paidOnly && e.paid !== true) continue;
                const cur = map.get(key) || { amount: 0, count: 0 };
                cur.amount += (typeof e.amount === "number" ? e.amount : 0);
                cur.count += 1;
                map.set(key, cur);
            }
        }
        return map;
    }
    measuredMovement(debts, monthKey) {
        const { first, lastExclusive } = this.monthBounds(monthKey);
        const perDebt = new Map();
        let delta = 0;
        let hasSignal = false;
        for (const d of debts) {
            const hist = Array.isArray(d.balance_history) ? d.balance_history : [];
            let opening = null;
            let closing = null;
            for (const h of hist) {
                if (!h || typeof h.balance !== "number") continue;
                const dateStr = this._coerceDateString(h.date);
                if (!dateStr) continue;
                if (dateStr < first) { if (!opening || dateStr > opening._dateStr) opening = Object.assign({}, h, { _dateStr: dateStr }); }
                if (dateStr < lastExclusive) { if (!closing || dateStr > closing._dateStr) closing = Object.assign({}, h, { _dateStr: dateStr }); }
            }
            const sig = !!(opening && closing && opening._dateStr !== closing._dateStr);
            const dDelta = sig ? (closing.balance - opening.balance) : 0;
            perDebt.set(d.name || (d.file && d.file.name) || "(unnamed)", {
                opening: opening ? opening.balance : null,
                closing: closing ? closing.balance : null,
                delta: dDelta,
                hasSignal: sig
            });
            if (sig) { delta += dDelta; hasSignal = true; }
        }
        return { delta, perDebt, hasSignal };
    }
    reconcile(paydownApplied, measuredMovement) {
        const measuredDrop = -((measuredMovement && measuredMovement.delta) || 0);
        return { paydownApplied, measuredDrop, interestAndCharges: paydownApplied - measuredDrop };
    }
    fmtMoney(n, opts) {
        const o = opts || {};
        const num = typeof n === "number" && isFinite(n) ? n : 0;
        const abs = Math.abs(num).toFixed(2).split(".");
        const dollars = abs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        let sign = "";
        if (o.signed) sign = num >= 0 ? "+" : "-";
        else if (num < 0) sign = "-";
        return `${sign}$${dollars}.${abs[1]}`;
    }
}
