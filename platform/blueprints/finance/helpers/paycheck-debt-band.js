/**
 * PaycheckDebtBand — Read-only debt-payments rollup band on every Paycheck note.
 *
 * Renders BETWEEN PaycheckSummary and PaycheckExpensesEditor. Shows the
 * paycheck's debt-targeted expenses (any expense with a `debt: "[[Debt-X]]"`
 * wikilink) grouped into a single visually-distinct section so the user
 * can see at a glance which debts this paycheck is paying down + how much
 * + paid/unpaid status — independent of the full expense list below.
 *
 * Band layout:
 *   • Section header: "Debt Payments" + total target $$ + paid % chip.
 *   • One row per debt expense:
 *       - paid pill (○ unpaid / ✓ paid)
 *       - debt name (links to Debt-*.md)
 *       - amount ($)
 *       - paydown-progress chip (% paid of credit_limit for credit cards)
 *
 * Pure derivation. Never writes (PaycheckExpensesEditor owns the toggle).
 * Embed-deduped per the standard pattern.
 *
 * Wired into install via applyFinancePaycheckDebtBandInjection (v0.112.0)
 * which marker-guards the block (paycheck-debt-band-v0.8.0) and injects it
 * between PaycheckSummary and PaycheckExpensesEditor on every existing
 * Paycheck-*.md. Widget class shipped v0.114.0 (paycheck-debt-band.js).
 */
class PaycheckDebtBand {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pdb-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "paycheck") return;

        const expenses = Array.isArray(page.expenses) ? page.expenses : [];
        const debtExpenses = expenses.filter((e) => e && typeof e.debt === "string" && e.debt.trim().length > 0);
        if (debtExpenses.length === 0) return; // nothing to render — quiet

        const root = dv.container.createEl("div", { cls: "pdb-root" });
        root.style.cssText = "margin: 10px 0 14px; padding: 12px 14px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);";

        const totalPlanned = debtExpenses.reduce((s, e) => s + (typeof e.amount === "number" ? e.amount : 0), 0);
        const totalPaid = debtExpenses
            .filter((e) => this._isPaid(e))
            .reduce((s, e) => s + (typeof e.amount === "number" ? e.amount : 0), 0);
        const paidPct = totalPlanned > 0 ? Math.round((totalPaid / totalPlanned) * 100) : 0;

        this._renderHeader(root, debtExpenses.length, totalPlanned, totalPaid, paidPct);
        const rows = root.createEl("div");
        rows.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
        for (const exp of debtExpenses) {
            this._renderRow(rows, exp);
        }
    }

    static PALETTE = {
        green: "#16a34a",
        amber: "#b45309",
        red: "#dc2626",
        muted: "#6b7280",
        greenBg: "rgba(22, 163, 74, 0.10)",
        amberBg: "rgba(180, 83, 9, 0.10)",
        redBg: "rgba(220, 38, 38, 0.10)",
        mutedBg: "rgba(107, 114, 128, 0.08)"
    };

    _isPaid(exp) {
        const v = exp && exp.paid;
        if (v === true) return true;
        if (typeof v === "string" && v.toLowerCase() === "true") return true;
        return false;
    }

    _fmtMoney(n) {
        const num = typeof n === "number" && isFinite(n) ? n : 0;
        const abs = Math.abs(num).toFixed(2);
        const parts = abs.split(".");
        const dollars = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return `${num < 0 ? "-" : ""}$${dollars}.${parts[1]}`;
    }

    _renderHeader(parent, count, totalPlanned, totalPaid, paidPct) {
        const header = parent.createEl("div");
        header.style.cssText = "display: flex; align-items: baseline; gap: 12px; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border);";

        const title = header.createEl("div");
        title.textContent = `Debt Payments (${count})`;
        title.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase;";

        const totals = header.createEl("div");
        totals.textContent = `${this._fmtMoney(totalPaid)} paid of ${this._fmtMoney(totalPlanned)} planned`;
        totals.style.cssText = "font-size: 0.85em; color: var(--text-normal); font-variant-numeric: tabular-nums;";

        const chip = header.createEl("span");
        chip.textContent = `${paidPct}%`;
        const tone = paidPct >= 100 ? "green" : paidPct >= 50 ? "amber" : (paidPct === 0 ? "muted" : "red");
        chip.style.cssText = `margin-left: auto; font-size: 0.78em; padding: 2px 9px; border-radius: 999px; color: ${PaycheckDebtBand.PALETTE[tone]}; background: ${PaycheckDebtBand.PALETTE[`${tone}Bg`]}; border: 1px solid ${PaycheckDebtBand.PALETTE[tone]}33; font-variant-numeric: tabular-nums;`;
    }

    _renderRow(parent, exp) {
        const row = parent.createEl("div");
        row.style.cssText = "display: flex; gap: 10px; align-items: center; padding: 4px 0;";

        const paidPill = row.createEl("span");
        const paid = this._isPaid(exp);
        paidPill.textContent = paid ? "✓" : "○";
        paidPill.style.cssText = `flex: 0 0 18px; text-align: center; font-size: 1em; color: ${paid ? PaycheckDebtBand.PALETTE.green : PaycheckDebtBand.PALETTE.muted};`;

        const name = row.createEl("a");
        const debtSlug = this._parseDebtSlug(exp.debt);
        name.textContent = exp.item || debtSlug || "Debt payment";
        name.style.cssText = "flex: 1; font-size: 0.92em; color: var(--text-normal); text-decoration: none; cursor: pointer;";
        if (debtSlug) {
            name.addEventListener("click", (e) => {
                e.preventDefault();
                app.workspace.openLinkText(debtSlug, "", false);
            });
        }

        const amount = row.createEl("span");
        amount.textContent = this._fmtMoney(exp.amount);
        amount.style.cssText = "flex: 0 0 96px; text-align: right; font-size: 0.92em; font-variant-numeric: tabular-nums; color: var(--text-normal);";

        // Async paydown-progress chip resolved from the debt entity.
        if (debtSlug) {
            this._resolveDebt(debtSlug).then((debt) => {
                if (!debt) return;
                if (debt.kind !== "credit-card") return;
                const lim = Number(debt.credit_limit);
                const bal = Number(debt.current_balance);
                if (!isFinite(lim) || lim <= 0 || !isFinite(bal)) return;
                const pct = Math.max(0, Math.min(100, Math.round((1 - bal / lim) * 100)));
                const tone = pct >= 67 ? "green" : pct >= 34 ? "amber" : "red";
                const chip = row.createEl("span");
                chip.textContent = `${pct}% paid`;
                chip.style.cssText = `flex: 0 0 auto; font-size: 0.72em; padding: 2px 7px; border-radius: 999px; color: ${PaycheckDebtBand.PALETTE[tone]}; background: ${PaycheckDebtBand.PALETTE[`${tone}Bg`]}; border: 1px solid ${PaycheckDebtBand.PALETTE[tone]}33; font-variant-numeric: tabular-nums;`;
            });
        }
    }

    _parseDebtSlug(linkStr) {
        if (typeof linkStr !== "string") return null;
        const m = linkStr.match(/^\[\[([^\]]+)\]\]$/);
        return m ? m[1] : null;
    }

    async _resolveDebt(slug) {
        const dest = app.metadataCache.getFirstLinkpathDest(slug, "");
        if (!dest) return null;
        const cache = app.metadataCache.getFileCache(dest);
        return cache?.frontmatter || null;
    }
}
