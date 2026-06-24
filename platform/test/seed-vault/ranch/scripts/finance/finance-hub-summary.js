/**
 * FinanceHubSummary — Debt-forward landing widget for spice/finance/Finance.md.
 *
 * Hero (top): debt-forward stat block — TOTAL DEBT (large) · ZERO-DEBT DATE ·
 * compact sub-stats (weighted APR, monthly attack, monthly interest).
 * Tile row (below): this-month budget progress · latest paycheck · open invoices.
 *
 * v0.115.2 visual cleanup:
 *   - Tighter hero padding; value/label hierarchy made consistent across
 *     hero + tiles (uppercase muted label above a numeric value).
 *   - Sub-stats split into a small grid for scannability rather than a
 *     single bullet-separated run-on line.
 *   - Tiles get a hover affordance + accent left-border to telegraph clickability.
 *   - Latest-paycheck sort routes through FinanceMath._coerceDateString so
 *     unquoted-YAML paychecks (Luxon DateTime) sort correctly against quoted
 *     ones (strings). v0.115.1 used inline coercion which only handled
 *     Luxon; FinanceMath now also covers native Date + moment.
 *
 * Path guard: renders only on spice/finance/Finance.md.
 * CSS root: fhs-root. Embed-deduped. Never writes. Pure derivation.
 */
class FinanceHubSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .fhs-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.file.path !== "spice/finance/Finance.md") return;

        const root = dv.container.createEl("div", { cls: "fhs-root" });
        root.style.cssText = "margin: 14px 0 22px; display: flex; flex-direction: column; gap: 12px;";

        this._renderHero(root, dv);
        this._renderTiles(root, dv);
    }

    // ----------------------------------------------------------------- helpers

    _fmtMoney(n, opts) {
        return customJS.FinanceMath.fmtMoney(n, opts);
    }

    _muted(parent, text) {
        const el = parent.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.85em; color: var(--text-muted);";
        return el;
    }

    // ----------------------------------------------------------------- Hero

    _renderHero(root, dv) {
        const debts = customJS.FinanceMath.readDebts(dv);
        const hero = root.createEl("div", { cls: "fhs-hero" });
        hero.style.cssText = "padding: 16px 18px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt); display: flex; flex-direction: column; gap: 10px;";

        if (!debts || debts.length === 0) {
            const lab = hero.createEl("div");
            lab.textContent = "TOTAL DEBT";
            lab.style.cssText = "font-size: 0.7em; color: var(--text-muted); letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;";
            this._muted(hero, "No debt tracked.");
            const btn = hero.createEl("button");
            btn.textContent = "Open Debts Hub";
            btn.style.cssText = "align-self: flex-start; margin-top: 4px; font-size: 0.82em; padding: 5px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
            btn.addEventListener("click", () => app.workspace.openLinkText("spice/finance/debts/Debts.md", ""));
            return;
        }

        const totals = customJS.FinanceMath.debtTotals(debts);

        // Top row: TOTAL DEBT (large) + ZERO-DEBT DATE (right-aligned).
        const topRow = hero.createEl("div");
        topRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between;";

        const debtBlock = topRow.createEl("div");
        debtBlock.style.cssText = "display: flex; flex-direction: column; gap: 2px; min-width: 0;";
        const debtLab = debtBlock.createEl("div");
        debtLab.textContent = "TOTAL DEBT";
        debtLab.style.cssText = "font-size: 0.7em; color: var(--text-muted); letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;";
        const debtVal = debtBlock.createEl("div");
        debtVal.textContent = this._fmtMoney(totals.totalBalance);
        debtVal.style.cssText = "font-size: 1.7em; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; color: var(--text-normal);";

        const zeroBlock = topRow.createEl("div");
        zeroBlock.style.cssText = "display: flex; flex-direction: column; gap: 2px; align-items: flex-end; text-align: right;";
        const zeroLab = zeroBlock.createEl("div");
        zeroLab.textContent = "ZERO-DEBT DATE";
        zeroLab.style.cssText = "font-size: 0.7em; color: var(--text-muted); letter-spacing: 0.08em; font-weight: 600; text-transform: uppercase;";
        const zeroVal = zeroBlock.createEl("div");
        zeroVal.textContent = totals.zeroDebtDate;
        zeroVal.style.cssText = "font-size: 1.05em; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-normal);";

        // Sub-stats row: weighted APR · monthly attack · monthly interest as a
        // mini three-cell grid (was a run-on bullet-separated line in v0.115.1).
        const sub = hero.createEl("div");
        sub.style.cssText = "display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding-top: 8px; border-top: 1px solid var(--background-modifier-border);";

        const subCell = (label, value) => {
            const cell = sub.createEl("div");
            cell.style.cssText = "display: flex; flex-direction: column; gap: 1px; min-width: 0;";
            const l = cell.createEl("div");
            l.textContent = label;
            l.style.cssText = "font-size: 0.62em; color: var(--text-muted); letter-spacing: 0.06em; font-weight: 600; text-transform: uppercase;";
            const v = cell.createEl("div");
            v.textContent = value;
            v.style.cssText = "font-size: 0.92em; font-variant-numeric: tabular-nums; color: var(--text-normal);";
        };
        subCell("Weighted APR", `${totals.weightedApr.toFixed(2)}%`);
        subCell("Monthly attack", this._fmtMoney(totals.plannedAttack));
        subCell("Monthly interest", this._fmtMoney(totals.monthlyInterest));
    }

    // ----------------------------------------------------------------- Tiles

    _renderTiles(root, dv) {
        const row = root.createEl("div", { cls: "fhs-tiles" });
        row.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;";

        this._renderBudgetTile(row, dv);
        this._renderPaycheckTile(row, dv);
        this._renderInvoicesTile(row, dv);
    }

    _makeTile(parent, cls) {
        const tile = parent.createEl("div", { cls });
        tile.style.cssText = "padding: 12px 14px; border: 1px solid var(--background-modifier-border); border-left: 3px solid var(--interactive-accent); border-radius: 8px; cursor: pointer; background: var(--background-secondary); display: flex; flex-direction: column; gap: 6px; transition: background-color 0.15s;";
        tile.addEventListener("mouseenter", () => tile.style.backgroundColor = "var(--background-modifier-hover)");
        tile.addEventListener("mouseleave", () => tile.style.backgroundColor = "var(--background-secondary)");
        return tile;
    }

    _tileLabel(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.7em; color: var(--text-muted); letter-spacing: 0.06em; font-weight: 600; text-transform: uppercase;";
        return el;
    }

    _tileValue(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 1.05em; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-normal);";
        return el;
    }

    _tileMuted(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.78em; color: var(--text-muted); font-variant-numeric: tabular-nums;";
        return el;
    }

    _renderBudgetTile(row, dv) {
        const tile = this._makeTile(row, "fhs-tile-budget");
        this._tileLabel(tile, "This Month Budget");

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const currentMonth = `${year}-${String(month).padStart(2, "0")}`;
        const budget = customJS.FinanceMath.readBudgetForMonth(dv, currentMonth);

        if (!budget) {
            this._tileMuted(tile, `No budget for ${currentMonth}`);
        } else {
            const cats = Array.isArray(budget.categories) ? budget.categories : [];
            const totalPlanned = cats.reduce((s, c) => s + ((c && typeof c.planned === "number") ? c.planned : 0), 0);
            const spending = customJS.FinanceMath.monthSpending(budget);
            const pct = totalPlanned > 0 ? Math.round(spending / totalPlanned * 100) : 0;

            this._tileValue(tile, `${this._fmtMoney(spending)} / ${this._fmtMoney(totalPlanned)}`);

            const barWrap = tile.createEl("div");
            barWrap.style.cssText = "height: 4px; background: var(--background-modifier-border); border-radius: 2px; overflow: hidden;";
            const barFill = barWrap.createEl("div");
            const fillPct = Math.min(100, pct);
            const barColor = pct <= 90 ? "#16a34a" : pct <= 110 ? "#b45309" : "#dc2626";
            barFill.style.cssText = `height: 100%; width: ${fillPct}%; background: ${barColor};`;

            const currentDay = now.getDate();
            const daysInMonth = new Date(year, month, 0).getDate();
            this._tileMuted(tile, `${pct}% spent · day ${currentDay}/${daysInMonth}`);
        }

        tile.addEventListener("click", () => {
            app.workspace.openLinkText("spice/finance/budgets/Budgets.md", "");
        });
    }

    _renderPaycheckTile(row, dv) {
        const tile = this._makeTile(row, "fhs-tile-paycheck");
        this._tileLabel(tile, "Latest Paycheck");

        let allPaychecks = [];
        try {
            allPaychecks = dv.pages('"spice/finance/paychecks"')
                .where(p => p && p.type === "paycheck")
                .array();
        } catch (_e) { allPaychecks = []; }

        if (allPaychecks.length === 0) {
            this._tileMuted(tile, "No paychecks yet.");
        } else {
            const FM = customJS.FinanceMath;
            const latest = allPaychecks.slice().sort((a, b) => {
                const as = FM._coerceDateString(a.pay_period_start) || "";
                const bs = FM._coerceDateString(b.pay_period_start) || "";
                // DESC: latest (largest string) first
                if (as === bs) return 0;
                return as < bs ? 1 : -1;
            })[0];

            const startStr = FM._coerceDateString(latest.pay_period_start) || String(latest.pay_period_start || "");
            const amount = typeof latest.paycheck_amount === "number" ? latest.paycheck_amount : 0;
            this._tileValue(tile, this._fmtMoney(amount));
            this._tileMuted(tile, startStr);
        }

        tile.addEventListener("click", () => {
            app.workspace.openLinkText("spice/finance/paychecks/Paychecks.md", "");
        });
    }

    _renderInvoicesTile(row, dv) {
        const tile = this._makeTile(row, "fhs-tile-invoices");
        this._tileLabel(tile, "Open Invoices");

        let openInvoices = [];
        try {
            openInvoices = dv.pages('"spice/finance/invoices"')
                .where(p => p && p.type === "invoice")
                .array()
                .filter(p => {
                    try {
                        return customJS.FinanceStatus.derive(p, "invoice").label !== "Done";
                    } catch (_e) { return true; }
                });
        } catch (_e) { openInvoices = []; }

        const count = openInvoices.length;
        const total = openInvoices.reduce((s, p) => s + (typeof p.amount === "number" ? p.amount : 0), 0);

        if (count === 0) {
            this._tileMuted(tile, "No open invoices.");
        } else {
            this._tileValue(tile, `${count} open`);
            this._tileMuted(tile, `Total ${this._fmtMoney(total)}`);
        }

        tile.addEventListener("click", () => {
            app.workspace.openLinkText("spice/finance/invoices/Invoices.md", "");
        });
    }
}
