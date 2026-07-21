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
        // v0.115.3: Dataview auto-converts wikilink-shaped strings (e.g. "[[Debt-X]]")
        // in frontmatter to Link objects. Strict `typeof === "string"` rejects those
        // and the band would silently render nothing. Accept any truthy value here;
        // _parseDebtSlug below normalizes string AND Link object to a slug.
        const debtExpenses = expenses.filter((e) => e && this._hasDebtLink(e));
        if (debtExpenses.length === 0) return; // nothing to render — quiet

        const root = dv.container.createEl("div", { cls: "pdb-root" });
        root.style.cssText = "margin: 10px 0 14px; padding: 12px 14px; border: 1px solid var(--sauce-hairline); border-radius: 10px; background: var(--background-secondary-alt);";

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
        header.style.cssText = "display: flex; align-items: baseline; gap: 12px; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--sauce-hairline);";

        const title = header.createEl("div");
        title.textContent = `Debt Payments (${count})`;
        title.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.08em; text-transform: uppercase;";

        const totals = header.createEl("div");
        totals.textContent = `${this._fmtMoney(totalPaid)} paid of ${this._fmtMoney(totalPlanned)} planned`;
        totals.style.cssText = "font-size: 0.85em; color: var(--text-normal); font-variant-numeric: tabular-nums;";

        const chip = header.createEl("span", { cls: "pdb-progress-pill sauce-pill" });
        chip.textContent = `${paidPct}%`;
        const tone = paidPct >= 100 ? "green" : paidPct >= 50 ? "amber" : (paidPct === 0 ? "muted" : "red");
        chip.style.cssText = `margin-left: auto; color: ${PaycheckDebtBand.PALETTE[tone]}; background: ${PaycheckDebtBand.PALETTE[`${tone}Bg`]}; border-color: ${PaycheckDebtBand.PALETTE[tone]}33; font-variant-numeric: tabular-nums;`;
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
                const chip = row.createEl("span", { cls: "pdb-paydown-pill sauce-pill" });
                chip.textContent = `${pct}% paid`;
                chip.style.cssText = `flex: 0 0 auto; color: ${PaycheckDebtBand.PALETTE[tone]}; background: ${PaycheckDebtBand.PALETTE[`${tone}Bg`]}; border-color: ${PaycheckDebtBand.PALETTE[tone]}33; font-variant-numeric: tabular-nums;`;
            });
        }
    }

    // v0.115.3: handle Dataview Link objects (wikilink-shaped strings get
    // auto-converted in frontmatter parsing) AS WELL AS literal string forms.
    _hasDebtLink(exp) {
        const v = exp && exp.debt;
        if (v == null) return false;
        if (typeof v === "string") return v.trim().length > 0;
        // Link object: { path: "Debt-X", display: ..., subpath: ..., type: "file" }
        if (typeof v === "object" && (typeof v.path === "string" && v.path.length > 0)) return true;
        return false;
    }
    _parseDebtSlug(linkVal) {
        if (linkVal == null) return null;
        if (typeof linkVal === "string") {
            const m = linkVal.match(/^\[\[([^\]]+)\]\]$/);
            return m ? m[1] : (linkVal.length > 0 ? linkVal : null);
        }
        // Dataview Link object: { path: "Debt-X", ... }. Prefer .path, fall back
        // to .display / .toString().
        if (typeof linkVal === "object") {
            if (typeof linkVal.path === "string" && linkVal.path.length > 0) {
                // Strip optional .md extension that some Dataview versions include
                return linkVal.path.replace(/\.md$/, "");
            }
            if (typeof linkVal.display === "string" && linkVal.display.length > 0) return linkVal.display;
            try { const s = String(linkVal); return s.length > 0 ? s : null; } catch (_e) { return null; }
        }
        return null;
    }

    async _resolveDebt(slug) {
        const dest = app.metadataCache.getFirstLinkpathDest(slug, "");
        if (!dest) return null;
        const cache = app.metadataCache.getFileCache(dest);
        return cache?.frontmatter || null;
    }
}
