/**
 * PaycheckSummary — Read-only three-band rollup at the top of every Paycheck note.
 *
 * Band 1 — Pay amount / Paid / Remaining ($ and %).
 * Band 2 — Paid X of N expenses progress pill ("on track", "all paid", etc.).
 * Band 3 — Per-category pill-cards (one per distinct expenses[].category).
 *
 * Status-aware:
 *   • Planning (today < pay_period_start) — no progress band.
 *   • In Progress (any paid, OR today >= start AND not all paid) — full bands.
 *   • Done (all paid) — full bands + "Closed" tag.
 *
 * Pure derivation from page frontmatter. Never writes. Embed-deduped.
 * Mirrors BudgetSummary's CF-3 visual treatment (hardcoded palette, pill-cards).
 */
class PaycheckSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .ps-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        const expenses = Array.isArray(page.expenses) ? page.expenses : [];

        const root = dv.container.createEl("div", { cls: "ps-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px 18px; border: 1px solid var(--sauce-hairline); border-radius: 10px; background: var(--background-secondary-alt);";

        if (expenses.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "Empty paycheck — add expenses below.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0; text-align: center;";
            return;
        }

        const isPaid = (e) => {
            if (!e) return false;
            const v = e.paid;
            if (v === true) return true;
            if (typeof v === "string" && v.toLowerCase() === "true") return true;
            return false;
        };

        // Prefer the new monthly shape (deposits[]): pay = Σ deposits[].amount.
        // Fall back to the legacy scalar paycheck_amount for pre-cutover notes.
        const isMonthly = Array.isArray(page.deposits) && page.deposits.length > 0;
        const payAmount = isMonthly
            ? page.deposits.reduce((s, d) => s + (Number(d && d.amount) || 0), 0)
            : (typeof page.paycheck_amount === "number" ? page.paycheck_amount : 0);
        const totalExpenses = expenses.reduce((s, e) => s + ((typeof e?.amount === "number") ? e.amount : 0), 0);
        const paidExpenses = expenses.filter(isPaid).reduce((s, e) => s + ((typeof e?.amount === "number") ? e.amount : 0), 0);
        const remaining = payAmount - paidExpenses;
        const paidCount = expenses.filter(isPaid).length;
        const totalCount = expenses.length;

        // Status: all paid → done; some paid OR start passed → in-progress; else planning.
        // Prefer the monthly anchor (month → first-of-month, or the earliest deposit
        // date); fall back to the legacy pay_period_start for pre-cutover notes.
        const today = window.moment ? window.moment() : null;
        let startStr = null;
        if (isMonthly) {
            const depDates = page.deposits
                .map(d => (d && typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) ? d.date : null)
                .filter(Boolean)
                .sort();
            if (depDates.length) startStr = depDates[0];
            else if (typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) startStr = `${page.month}-01`;
        }
        if (!startStr && typeof page.pay_period_start === "string") startStr = page.pay_period_start;
        const start = (typeof startStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startStr) && today)
            ? window.moment(startStr, "YYYY-MM-DD")
            : null;
        let status = "planning";
        const allPaid = paidCount === totalCount && totalCount > 0;
        if (allPaid) status = "done";
        else if (paidCount > 0 || (start && !today.isBefore(start, "day"))) status = "in-progress";

        this._renderBand1(root, payAmount, paidExpenses, remaining, totalExpenses, status);
        // Per-deposit line — only for the new monthly shape. Shows each deposit's
        // income / assigned / leftover (via depositTotals) so the check-by-check
        // split is visible right at the top; the paid/total bands below are shape-
        // agnostic (they read Σ deposits vs Σ expenses either way).
        if (isMonthly) this._renderDepositLine(root, page);
        this._renderBand2(root, paidCount, totalCount, paidExpenses, totalExpenses, status);
        this._renderBand3(root, expenses);
    }

    // -------------------------------------------------------------- palette

    static PALETTE = {
        green: "#16a34a", greenBg: "rgba(22, 163, 74, 0.10)",
        amber: "#b45309", amberBg: "rgba(180, 83, 9, 0.10)",
        red:   "#dc2626", redBg:   "rgba(220, 38, 38, 0.10)",
        muted: "var(--text-muted)", mutedBg: "transparent"
    };

    _fmtMoney(n) {
        const sign = n < 0 ? "-" : "";
        const abs = Math.abs(typeof n === "number" ? n : 0).toFixed(2);
        const parts = abs.split(".");
        return sign + "$" + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
    }

    _toneForRemaining(remaining, payAmount) {
        if (payAmount <= 0) return "muted";
        if (remaining > 0) return "green";        // pay covers expenses
        if (remaining === 0) return "amber";      // exactly zero
        return "red";                              // negative — overspending
    }

    _colorFor(tone) { return PaycheckSummary.PALETTE[tone] || PaycheckSummary.PALETTE.muted; }
    _bgFor(tone) { return PaycheckSummary.PALETTE[`${tone}Bg`] || "transparent"; }

    // ----- Band 1: pay / paid / remaining -----

    _renderBand1(root, payAmount, paidExpenses, remaining, totalExpenses, status) {
        const band = root.createEl("div");
        band.style.cssText = "display: flex; gap: 24px; flex-wrap: wrap; padding-bottom: 14px; border-bottom: 1px solid var(--sauce-hairline);";

        const mk = (label, val, color) => {
            const cell = band.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 500; text-transform: uppercase;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            valEl.style.cssText = `font-size: 1.35em; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 4px;${color ? " color: " + color + ";" : ""}`;
        };

        mk("Pay", this._fmtMoney(payAmount));
        mk("Paid out", this._fmtMoney(paidExpenses));

        const tone = this._toneForRemaining(remaining, payAmount);
        mk("Remaining", this._fmtMoney(remaining), this._colorFor(tone));

        // Coverage signal — does paycheck cover total scheduled expenses?
        if (payAmount > 0 && totalExpenses > payAmount) {
            const overStr = this._fmtMoney(totalExpenses - payAmount);
            mk("Over plan by", overStr, this._colorFor("red"));
        }

        if (status === "done") {
            const closed = band.createEl("div", { cls: "ps-closed-pill sauce-pill" });
            closed.textContent = "Closed";
            closed.style.cssText = "flex: 0 0 auto; align-self: center; color: var(--text-muted); letter-spacing: 0.04em; text-transform: uppercase;";
        }
    }

    // ----- Per-deposit line (monthly shape only) -----

    _renderDepositLine(root, page) {
        let rows;
        try { rows = customJS.FinanceMath.depositTotals(page); }
        catch (_e) { return; }
        if (!Array.isArray(rows) || rows.length === 0) return;

        const band = root.createEl("div");
        band.style.cssText = "display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--sauce-hairline);";

        for (const r of rows) {
            const leftoverTone = (Number(r.leftover) || 0) >= 0 ? "green" : "red";
            const cell = band.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 150px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--sauce-hairline); background: var(--background-primary);";

            const dateEl = cell.createEl("div");
            dateEl.textContent = r.date != null ? String(r.date) : "—";
            dateEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 500;";

            const incEl = cell.createEl("div");
            incEl.textContent = this._fmtMoney(Number(r.amount) || 0);
            incEl.style.cssText = "font-size: 1.05em; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 2px;";

            const subEl = cell.createEl("div");
            subEl.textContent = `Assigned ${this._fmtMoney(Number(r.assigned) || 0)} · Leftover ${this._fmtMoney(Number(r.leftover) || 0)}`;
            subEl.style.cssText = `font-size: 0.76em; margin-top: 3px; font-variant-numeric: tabular-nums; color: ${this._colorFor(leftoverTone)};`;
        }
    }

    // ----- Band 2: progress -----

    _renderBand2(root, paidCount, totalCount, paidExpenses, totalExpenses, status) {
        const band = root.createEl("div");
        band.style.cssText = "padding: 14px 0; border-bottom: 1px solid var(--sauce-hairline);";

        const pctByCount = totalCount > 0 ? (paidCount / totalCount) * 100 : 0;
        const pctByAmount = totalExpenses > 0 ? (paidExpenses / totalExpenses) * 100 : 0;

        const headLine = band.createEl("div");
        headLine.textContent = `Paid ${paidCount} of ${totalCount} · ${pctByCount.toFixed(0)}% by count · ${pctByAmount.toFixed(0)}% by amount`;
        headLine.style.cssText = "font-size: 0.84em; color: var(--text-muted); margin-bottom: 10px;";

        this._renderBar(band, "by count", pctByCount, this._colorFor(status === "done" ? "green" : "muted"));
        this._renderBar(band, "by amount", pctByAmount, this._colorFor(status === "done" ? "green" : "muted"));

        let label, paceTone;
        if (status === "done") { label = "All paid"; paceTone = "green"; }
        else if (status === "planning") { label = "Not yet started"; paceTone = "muted"; }
        else if (pctByCount >= 80) { label = "Almost there"; paceTone = "green"; }
        else if (pctByCount >= 40) { label = "In progress"; paceTone = "amber"; }
        else { label = "Just starting"; paceTone = "muted"; }

        const statusWrap = band.createEl("div");
        statusWrap.style.cssText = "margin-top: 10px;";
        const statusTag = statusWrap.createEl("span", { cls: "ps-status-pill sauce-pill" });
        statusTag.textContent = label;
        statusTag.style.cssText = `color: ${this._colorFor(paceTone)}; background: ${this._bgFor(paceTone)}; border-color: ${this._colorFor(paceTone)}33;`;
    }

    _renderBar(parent, label, pct, fillColor) {
        const wrap = parent.createEl("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 10px; margin: 3px 0;";

        const labEl = wrap.createEl("div");
        labEl.textContent = label;
        labEl.style.cssText = "flex: 0 0 75px; font-size: 0.78em; color: var(--text-muted);";

        const track = wrap.createEl("div");
        track.style.cssText = "flex: 1; height: 6px; background: var(--background-modifier-border); border-radius: 999px; overflow: hidden;";

        const fill = track.createEl("div");
        const clamped = Math.min(Math.max(pct, 0), 100);
        fill.style.cssText = `height: 100%; width: ${clamped}%; background: ${fillColor}; transition: width 200ms; border-radius: 999px;`;

        const valEl = wrap.createEl("div");
        valEl.textContent = `${pct.toFixed(0)}%`;
        valEl.style.cssText = "flex: 0 0 48px; text-align: right; font-size: 0.78em; font-variant-numeric: tabular-nums; color: var(--text-muted);";
    }

    // ----- Band 3: per-category mini-cards -----

    _renderBand3(root, expenses) {
        const isPaid = (e) => {
            if (!e) return false;
            const v = e.paid;
            return v === true || (typeof v === "string" && v.toLowerCase() === "true");
        };

        // Aggregate per category.
        const buckets = new Map();
        for (const e of expenses) {
            if (!e || typeof e !== "object") continue;
            const cat = (e.category && String(e.category).trim()) || "Uncategorized";
            const amount = (typeof e.amount === "number") ? e.amount : 0;
            const paid = isPaid(e) ? amount : 0;
            const cur = buckets.get(cat) || { total: 0, paid: 0, count: 0, paidCount: 0 };
            cur.total += amount;
            cur.paid += paid;
            cur.count += 1;
            if (isPaid(e)) cur.paidCount += 1;
            buckets.set(cat, cur);
        }

        // Sort by total amount descending so the heavy hitters surface first.
        const sorted = Array.from(buckets.entries()).sort((a, b) => b[1].total - a[1].total);

        const band = root.createEl("div");
        band.style.cssText = "padding-top: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px;";

        for (const [category, bucket] of sorted) {
            let tone = "muted";
            if (bucket.count > 0) {
                if (bucket.paidCount === bucket.count) tone = "green";
                else if (bucket.paidCount > 0) tone = "amber";
                else tone = "muted";
            }
            const fg = this._colorFor(tone);
            const bg = this._bgFor(tone);

            const card = band.createEl("div");
            card.style.cssText = `padding: 9px 11px; border-radius: 8px; border: 1px solid ${fg}26; background: ${bg};`;

            const nameEl = card.createEl("div");
            nameEl.textContent = category;
            nameEl.style.cssText = `font-size: 0.78em; font-weight: 600; color: ${fg}; letter-spacing: 0.01em;`;

            const valEl = card.createEl("div");
            valEl.textContent = `${this._fmtMoney(bucket.paid)} of ${this._fmtMoney(bucket.total)}`;
            valEl.style.cssText = "font-size: 0.86em; font-variant-numeric: tabular-nums; margin-top: 4px; color: var(--text-normal);";

            const dirEl = card.createEl("div");
            const pct = bucket.total > 0 ? (bucket.paid / bucket.total) * 100 : 0;
            dirEl.textContent = `${bucket.paidCount} of ${bucket.count} paid · ${pct.toFixed(0)}%`;
            dirEl.style.cssText = `font-size: 0.76em; margin-top: 2px; color: ${fg};`;
        }
    }
}
