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

    // ---- deposit helpers (monthly paycheck) ----
    // 1-based deposit index for an expense; missing/invalid → 1 (first check).
    _depositIndex(exp, depositCount) {
        const n = Math.trunc(Number(exp && exp.deposit));
        if (!isFinite(n) || n < 1) return 1;
        if (depositCount && n > depositCount) return depositCount;
        return n;
    }
    // A note is the NEW monthly format iff it has a deposits[] array.
    _isMonthlyPaycheck(p) { return !!(p && Array.isArray(p.deposits)); }
    // Per-deposit rollup: for each deposit, { date, amount, assigned, leftover }
    // where assigned = Σ expenses tagged to that deposit (missing/invalid → 1).
    depositTotals(paycheck) {
        const deposits = Array.isArray(paycheck && paycheck.deposits) ? paycheck.deposits : [];
        const expenses = Array.isArray(paycheck && paycheck.expenses) ? paycheck.expenses : [];
        const assigned = deposits.map(() => 0);
        for (const e of expenses) {
            const idx = this._depositIndex(e, deposits.length) - 1;
            if (idx >= 0 && idx < assigned.length) assigned[idx] += (Number(e && e.amount) || 0);
        }
        return deposits.map((d, i) => ({
            date: d && d.date,
            amount: Number(d && d.amount) || 0,
            assigned: assigned[i],
            leftover: (Number(d && d.amount) || 0) - assigned[i],
        }));
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
                // Archived notes are never part of the live monthly rollup.
                if (p.file && typeof p.file.path === "string" && p.file.path.includes("/_archive/")) return false;
                // Prefer the new month-keyed shape; fall back to the legacy
                // pay_period_* (attribute to the month PAID: end, then start) so
                // pre-cutover notes still attribute until the archive heal runs.
                const m = this._coerceMonthString(p.month)
                    || this._coerceMonthString(this._coerceDateString(p.pay_period_end) || this._coerceDateString(p.pay_period_start));
                return m === monthKey;
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
    // ---- actuals freshness (finance 0.11.0) ----
    // Classifies a governed month's budget actuals for the hub/month badge.
    // Returns { state, label, tone } where state ∈ "live" | "stale" | "typed" | "none".
    // "none" = not applicable (baseline month or no budget) → caller renders no badge.
    // nowMs defaults to Date.now(); tests pass an explicit ms for determinism.
    actualsFreshness(budget, monthKey, governedFrom, nowMs) {
        if (!budget) return { state: "none", label: "", tone: "muted" };
        const gf = this._coerceMonthString(governedFrom);
        const mk = this._coerceMonthString(monthKey);
        if (!(gf && mk && mk >= gf)) return { state: "none", label: "", tone: "muted" };
        const syncedRaw = this._coerceDateString(budget.actuals_synced_at);
        if (!syncedRaw) return { state: "typed", label: "typed", tone: "muted" };
        const t = Date.parse(syncedRaw.length <= 10 ? syncedRaw + "T00:00:00Z" : syncedRaw);
        const now = (typeof nowMs === "number") ? nowMs : Date.now();
        const ageDays = Number.isFinite(t) ? (now - t) / 86400000 : Infinity;
        const dateLabel = syncedRaw.slice(0, 10);
        if (ageDays <= 8) return { state: "live", label: `live · ${dateLabel}`, tone: "green" };
        return { state: "stale", label: `stale · synced ${dateLabel}`, tone: "amber" };
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
        // Accurate payoff via the avalanche simulation (rolls freed minimums, finance 0.10.1) so
        // the hub hero + Debts hub match the planning dashboard. attack-above-mins = plannedAttack
        // − Σ active minimums; the sim holds total monthly outlay constant.
        const _minsSum = debts.reduce((s, d) => s + ((Number(d.current_balance) || 0) > 0 ? (Number(d.min_payment) || 0) : 0), 0);
        const zeroDebtDate = this.simulateAvalanche(debts, Math.max(0, plannedAttack - _minsSum)).zeroDebtDate;
        return { totalBalance, monthlyInterest, plannedAttack, weightedApr, zeroDebtDate };
    }
    // One canonical payoff source so every widget agrees. Precedence:
    //   plan-aware (computePlanState honors floor + attack + freed savings + override)
    //   → entity-planned (debtTotals + sim over each debt's planned_monthly_payment)
    //   → none (no debts with a balance).
    // Returns the money figures + canonical { zeroDebtDate, months, killOrder, source }.
    // killOrder[].slug === the Debt note's file.name (e.g. "Debt-Apple-Card").
    projectedPayoff(dv, monthKey) {
        const debts = this.readDebts(dv);
        const totals = this.debtTotals(debts);
        const base = {
            totalBalance: totals.totalBalance,
            monthlyInterest: totals.monthlyInterest,
            plannedAttack: totals.plannedAttack,
            weightedApr: totals.weightedApr,
        };
        const active = debts.filter(d => (Number(d.current_balance) || 0) > 0);
        if (active.length === 0) {
            return Object.assign(base, { zeroDebtDate: "—", months: Infinity, killOrder: [], source: "none" });
        }
        // Plan branch — prefer the plan-aware payoff when a finite plan payoff exists.
        let ps = null;
        try { ps = this.computePlanState(dv, monthKey); } catch (_e) { ps = null; }
        if (ps && ps.ok && ps.payoff && isFinite(ps.payoff.months)) {
            return Object.assign(base, {
                zeroDebtDate: ps.payoff.zeroDebtDate,
                months: ps.payoff.months,
                killOrder: ps.payoff.killOrder || [],
                source: "plan",
            });
        }
        // Entity branch — same inputs debtTotals uses: planned attack minus active minimums.
        const minsSum = active.reduce((s, d) => s + (Number(d.min_payment) || 0), 0);
        const sim = this.simulateAvalanche(debts, Math.max(0, totals.plannedAttack - minsSum));
        return Object.assign(base, {
            zeroDebtDate: sim.zeroDebtDate,
            months: sim.months,
            killOrder: sim.killOrder || [],
            source: "entities",
        });
    }
    monthIncome(paychecks) {
        return paychecks.reduce((s, p) => {
            // Prefer the new deposits[] shape; fall back to legacy scalar paycheck_amount.
            if (Array.isArray(p.deposits) && p.deposits.length) return s + p.deposits.reduce((d, x) => d + (Number(x && x.amount) || 0), 0);
            return s + (typeof p.paycheck_amount === "number" ? p.paycheck_amount : 0);
        }, 0);
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

    // ===== v0.10.0 planning / lever / allocation layer =====

    // The single finance-plan config singleton, or null.
    readPlan(dv) {
        try {
            const hits = dv.pages('"spice/finance"').where(p => p && p.type === "finance-plan").array();
            return hits.length ? hits[0] : null;
        } catch (_e) { return null; }
    }

    // All savings-account entities under spice/finance/savings.
    readSavings(dv) {
        try { return dv.pages('"spice/finance/savings"').where(p => p && p.type === "savings-account").array(); }
        catch (_e) { return []; }
    }

    // Pick the glide tier for a savings balance. tiers: [{under, monthly} | {at_or_above, monthly}], in order.
    // Returns { tier (1-based), contribution }.
    glide(balance, tiers) {
        const bal = Number(balance) || 0;
        if (!Array.isArray(tiers) || tiers.length === 0) return { tier: 1, contribution: 0 };
        for (let i = 0; i < tiers.length; i++) {
            const t = tiers[i] || {};
            if (t.under != null && bal < Number(t.under)) return { tier: i + 1, contribution: Number(t.monthly) || 0 };
            if (t.at_or_above != null && bal >= Number(t.at_or_above)) return { tier: i + 1, contribution: Number(t.monthly) || 0 };
        }
        const last = tiers[tiers.length - 1] || {};
        return { tier: tiers.length, contribution: Number(last.monthly) || 0 };
    }

    _prevMonthKey(monthKey) {
        const m = this._coerceMonthString(monthKey);
        if (!m || !/^\d{4}-\d{2}$/.test(m)) return null;
        let [y, mo] = m.split("-").map(Number);
        mo -= 1; if (mo < 1) { mo = 12; y -= 1; }
        return `${y}-${String(mo).padStart(2, "0")}`;
    }

    // Month-by-month avalanche simulation. attackTotal goes to one target (override while its
    // balance >= overrideBelow, else highest-APR active debt). No intra-month attack spill
    // (a paid-off target wastes the month's leftover — conservative by design). Cap 600 iters;
    // non-convergence (minimums < interest) → months Infinity / zeroDebtDate "—".
    simulateAvalanche(debts, attackTotal, opts) {
        opts = opts || {};
        const overrideKey = opts.overrideKey || null;
        const overrideBelow = (opts.overrideBelow != null) ? Number(opts.overrideBelow) : null;
        const skipFirstMonthAttack = !!opts.skipFirstMonthAttack;
        const atk = Number(attackTotal) || 0;
        let work = (Array.isArray(debts) ? debts : [])
            .filter(d => (Number(d.current_balance) || 0) > 0)
            .map(d => ({
                slug: (d.file && d.file.name) ? d.file.name : (d.name || "debt"),
                name: d.name || (d.file && d.file.name) || "debt",
                bal: Number(d.current_balance) || 0,
                apr: Number(d.apr) || 0,
                min: Number(d.min_payment) || 0,
            }));
        if (work.length === 0) return { months: 0, zeroDebtDate: "—", killOrder: [] };
        // Avalanche holds the TOTAL monthly debt outlay constant: when a card pays off, its
        // freed minimum rolls into the extra paid to the next target (Lever Protocol "roll the
        // whole payment to the next card"). monthlyBudget = current active minimums + attack.
        const monthlyBudget = work.reduce((s, w) => s + (w.min || 0), 0) + atk;
        const killOrder = [];
        const cap = 600;
        let months = 0;
        const start = new Date();
        while (work.some(w => w.bal > 0) && months < cap) {
            months++;
            for (const w of work) { if (w.bal > 0) w.bal += w.bal * w.apr / 1200; }
            const active = work.filter(w => w.bal > 0);
            let target = null;
            if (overrideKey && overrideBelow != null) {
                const o = active.find(w => w.slug === overrideKey && w.bal >= overrideBelow);
                if (o) target = o;
            }
            if (!target) target = active.slice().sort((a, b) => (b.apr - a.apr) || (a.bal - b.bal))[0] || null;
            // pay each active card its minimum (capped at balance), tracking total paid
            let minsPaid = 0;
            for (const w of work) { if (w.bal > 0) { const p = Math.min(w.min, w.bal); w.bal -= p; minsPaid += p; } }
            // the leftover (attack + any freed minimums) goes entirely to the target; the
            // what-if skips only the attack portion in month 1 (minimums are still paid).
            let extra = (skipFirstMonthAttack && months === 1) ? 0 : (monthlyBudget - minsPaid);
            if (extra < 0) extra = 0;
            if (target && target.bal > 0 && extra > 0) {
                target.bal -= extra;
                if (target.bal < 0) target.bal = 0;
            }
            for (const w of work) {
                if (w.bal <= 0 && !killOrder.find(k => k.slug === w.slug)) {
                    const d = new Date(start); d.setMonth(d.getMonth() + months);
                    killOrder.push({ debt: w.name, slug: w.slug, date: d.toISOString().slice(0, 10) });
                    w.bal = 0;
                }
            }
        }
        const converged = months < cap && work.every(w => w.bal <= 0);
        let zeroDebtDate = "—";
        if (converged) { const d = new Date(start); d.setMonth(d.getMonth() + months); zeroDebtDate = d.toISOString().slice(0, 10); }
        return { months: converged ? months : Infinity, zeroDebtDate, killOrder };
    }

    // The keystone: one read of plan + entities → the whole plan-state object every widget views.
    computePlanState(dv, monthKey) {
        const plan = this.readPlan(dv);
        if (!plan) return { ok: false, reason: "no-plan", monthKey: monthKey || null };
        const num = (v, d = 0) => { const n = Number(v); return isFinite(n) ? n : d; };

        const incomeFloor = num(plan.income_floor);
        const fixedLiving = num(plan.fixed_living_monthly);
        const attackBase = num(plan.attack_above_minimums);
        const payPeriods = num(plan.pay_periods_per_month, 2) || 2;
        const rollFreed = plan.roll_freed_savings_to_attack !== false;
        const tiers = Array.isArray(plan.savings_glide) ? plan.savings_glide : [];
        const overflowCfg = plan.overflow || { attack_pct: 80, flex_pct: 20 };

        const debts = this.readDebts(dv);
        const savings = this.readSavings(dv);
        const paychecks = this.readPaychecksForMonth(dv, monthKey);
        const budget = this.readBudgetForMonth(dv, monthKey);

        // savings + glide
        const ef = savings.find(s => String(s.name || "").toLowerCase() === "emergency fund") || savings[0] || null;
        const savingsBalance = ef ? num(ef.current_balance) : 0;
        const savingsTarget = ef ? num(ef.target) : 0;
        const g = this.glide(savingsBalance, tiers);
        const tier1Monthly = tiers.length ? num(tiers[0].monthly) : 0;
        const contribution = g.contribution;
        const freed = rollFreed ? Math.max(0, tier1Monthly - contribution) : 0;

        // minimums + attack
        const activeDebts = debts.filter(d => num(d.current_balance) > 0);
        const minimums = activeDebts.reduce((s, d) => s + num(d.min_payment), 0);
        const attackTotal = attackBase + freed;

        // envelope (base is constant across glide tiers when freed rolls to attack)
        const base = incomeFloor - fixedLiving - minimums - attackTotal - contribution;
        const governedFrom = this._coerceMonthString(plan.governed_from);
        const isGoverned = (m) => !!(governedFrom && m && this._coerceMonthString(m) >= governedFrom);
        const prevKey = this._prevMonthKey(monthKey);
        const prevBudget = prevKey ? this.readBudgetForMonth(dv, prevKey) : null;
        const priorSpent = prevBudget ? this.monthSpending(prevBudget) : 0;
        const priorPlanned = (prevBudget && Array.isArray(prevBudget.categories))
            ? prevBudget.categories.reduce((s, c) => s + num(c && c.planned), 0) : 0;
        // Overage carry flows ONLY governed → governed: a pre-system baseline month (e.g. an old
        // $6k full budget with $11k of real spend) must NOT punish the new envelope. And it
        // compares the prior month's spend to its OWN plan, never to this month's envelope.
        const carryApplies = incomeFloor > 0 && isGoverned(monthKey) && isGoverned(prevKey) && !!prevBudget && priorPlanned > 0;
        const overageCarry = carryApplies ? Math.max(0, priorSpent - priorPlanned) : 0;
        const effective = base - overageCarry;
        const planned = (budget && Array.isArray(budget.categories))
            ? budget.categories.reduce((s, c) => s + num(c && c.planned), 0) : 0;
        const spent = this.monthSpending(budget);
        const left = effective - spent;
        const over = (incomeFloor > 0 && planned > effective) ? planned - effective : 0;
        const status = over > 0 ? "over" : "ok";

        // allocation (avalanche + override + automatic roll via current balances)
        const overrideCfg = plan.attack_target_override || null;
        let overrideKey = null, overrideBelow = null;
        if (overrideCfg && overrideCfg.debt) {
            overrideKey = String(this._debtKey(overrideCfg.debt) || "").replace(/^\[\[|\]\]$/g, "").replace(/\.md$/, "");
            overrideBelow = (overrideCfg.until_balance_below != null) ? num(overrideCfg.until_balance_below) : null;
        }
        const ranked = activeDebts.slice().sort((a, b) => (num(b.apr) - num(a.apr)) || (num(a.current_balance) - num(b.current_balance)));
        let targetSlug = ranked.length ? ((ranked[0].file && ranked[0].file.name) || ranked[0].name) : null;
        if (overrideKey && overrideBelow != null) {
            const o = activeDebts.find(d => ((d.file && d.file.name) || d.name) === overrideKey && num(d.current_balance) >= overrideBelow);
            if (o) targetSlug = (o.file && o.file.name) || o.name;
        }
        const allocation = ranked.map(d => {
            const slug = (d.file && d.file.name) ? d.file.name : (d.name || "debt");
            const isTarget = slug === targetSlug;
            const min = num(d.min_payment);
            const atk = isTarget ? attackTotal : 0;
            return { debt: d.name || slug, slug, balance: num(d.current_balance), apr: num(d.apr), min, attack: atk, total: min + atk, isTarget, paidOff: false };
        });

        // payoff + what-if
        const payoff = this.simulateAvalanche(debts, attackTotal, { overrideKey, overrideBelow });
        const skip = this.simulateAvalanche(debts, attackTotal, { overrideKey, overrideBelow, skipFirstMonthAttack: true });
        const weeksSlipped = (isFinite(payoff.months) && isFinite(skip.months))
            ? Math.max(0, Math.round((skip.months - payoff.months) * 4.345)) : 0;
        const whatIf = { skipAttackThisMonth: { weeksSlipped, newZeroDebtDate: skip.zeroDebtDate } };

        // overflow (only when actual income exceeds the floor)
        const actualIncome = this.monthIncome(paychecks);
        const surplus = Math.max(0, actualIncome - incomeFloor);
        const overflow = surplus > 0 ? {
            actualIncome, surplus,
            toAttack: surplus * num(overflowCfg.attack_pct, 80) / 100,
            toFlex: surplus * num(overflowCfg.flex_pct, 20) / 100,
        } : null;

        // apply targets
        const debtTargets = allocation.map(a => ({ slug: a.slug, planned_monthly_payment: a.total }));
        const savingsPerCheck = Math.round((contribution / payPeriods) * 100) / 100;

        return {
            ok: true,
            monthKey: monthKey || null,
            inputs: { incomeFloor, fixedLiving, minimums, savingsBalance, savingsTarget },
            envelope: { base, overageCarry, effective, planned, spent, left, over, status, governed: isGoverned(monthKey), governedFrom },
            savings: { balance: savingsBalance, target: savingsTarget, tier: g.tier, contribution, freed, toTarget: Math.max(0, savingsTarget - savingsBalance) },
            attack: { base: attackBase, freed, total: attackTotal },
            allocation,
            payoff,
            overflow,
            whatIf,
            applyPlan: { debtTargets, savingsContribution: contribution, savingsPerCheck },
        };
    }

    // Live-derived budget allocation view (planning layer). Merges the plan's live
    // per-debt allocation + savings contribution with the budget's stored per-row
    // overrides. planned = override ?? plannedLive; source ∈ "override" | "plan".
    // Debt/savings planned numbers are a VIEW — never summed into the discretionary
    // envelope (which stays categories[]-only in computePlanState).
    budgetAllocations(dv, monthKey) {
        const budget = this.readBudgetForMonth(dv, monthKey);
        const overridesDebt = (budget && Array.isArray(budget.debt_allocations)) ? budget.debt_allocations : [];
        const overridesSav = (budget && Array.isArray(budget.savings_allocations)) ? budget.savings_allocations : [];
        const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
        const ovBySlug = new Map();
        for (const o of overridesDebt) { const s = o && (o.slug || o.name); if (s) ovBySlug.set(String(s), o); }

        let ps = null;
        try { ps = this.computePlanState(dv, monthKey); } catch (_e) { ps = null; }
        const debts = this.readDebts(dv);
        // Live per-debt planned: plan allocation total when available, else entity planned_monthly_payment.
        const liveBySlug = new Map();
        if (ps && ps.ok && Array.isArray(ps.allocation)) {
            for (const a of ps.allocation) liveBySlug.set(String(a.slug), num(a.total));
        }
        const debt = debts
            .filter(d => num(d.current_balance) > 0)
            .map(d => {
                const slug = (d.file && d.file.name) ? d.file.name : (d.name || "debt");
                const plannedLive = liveBySlug.has(slug) ? liveBySlug.get(slug) : num(d.planned_monthly_payment);
                const ov = ovBySlug.get(slug);
                const override = ov ? num(ov.planned) : null;
                return { slug, name: d.name || slug, plannedLive, override, planned: (ov ? override : plannedLive), source: ov ? "override" : "plan" };
            });

        const savLive = ps && ps.ok && ps.savings ? num(ps.savings.contribution) : 0;
        // Derive the savings row label from the actual chosen savings entity
        // (mirrors computePlanState's emergency-fund selection) — no baked-in name.
        const savEntities = this.readSavings(dv);
        const savEf = savEntities.find(s => String(s.name || "").toLowerCase() === "emergency fund") || savEntities[0] || null;
        const savName = (savEf && savEf.name) ? String(savEf.name) : "Emergency Fund";
        const savOv = overridesSav.find(o => o && String(o.name || "").toLowerCase() === savName.toLowerCase()) || overridesSav[0] || null;
        const savings = [{
            name: (savOv && savOv.name) || savName,
            plannedLive: savLive,
            override: savOv ? num(savOv.planned) : null,
            planned: savOv ? num(savOv.planned) : savLive,
            source: savOv ? "override" : "plan",
        }];

        const debtTotal = debt.reduce((s, d) => s + d.planned, 0);
        const savTotal = savings.reduce((s, d) => s + d.planned, 0);
        const income = ps && ps.ok ? num(ps.inputs.incomeFloor) : 0;
        const fixed = ps && ps.ok ? num(ps.inputs.fixedLiving) : 0;
        const discretionary = ps && ps.ok ? num(ps.envelope.effective) : Math.max(0, income - fixed - debtTotal - savTotal);
        return { debt, savings, totals: { debt: debtTotal, savings: savTotal, fixed, income, discretionary } };
    }
}
