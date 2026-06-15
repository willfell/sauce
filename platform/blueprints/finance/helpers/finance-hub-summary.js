/**
 * FinanceHubSummary — Debt-forward landing widget for spice/finance/Finance.md.
 *
 * Hero: TOTAL DEBT + ZERO-DEBT DATE + weighted APR + monthly attack stats.
 * Secondary tiles (3): this-month budget progress, latest paycheck, open invoices.
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
        root.style.cssText = "margin: 12px 0 20px;";

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

    _sectionWrap(root, cls, extraCss) {
        const s = root.createEl("div", { cls });
        s.style.cssText = "padding: 14px 16px; border: 1px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-secondary-alt);" + (extraCss || "");
        return s;
    }

    // ----------------------------------------------------------------- Hero

    _renderHero(root, dv) {
        const debts = customJS.FinanceMath.readDebts(dv);
        const hero = this._sectionWrap(root, "fhs-hero", " margin-bottom: 14px;");

        if (!debts || debts.length === 0) {
            this._muted(hero, "No debt tracked.");
            const btn = hero.createEl("button");
            btn.textContent = "Debts Hub";
            btn.style.cssText = "margin-top: 8px; font-size: 0.82em; padding: 4px 10px; border-radius: 4px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";
            btn.addEventListener("click", () => {
                app.workspace.openLinkText("spice/finance/debts/Debts.md", "");
            });
            return;
        }

        const totals = customJS.FinanceMath.debtTotals(debts);

        const totalEl = hero.createEl("div", { cls: "fhs-total-debt" });
        totalEl.style.cssText = "margin-bottom: 4px;";
        const totalLab = totalEl.createEl("span");
        totalLab.textContent = "TOTAL DEBT ";
        totalLab.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600; text-transform: uppercase;";
        const totalVal = totalEl.createEl("span");
        totalVal.textContent = this._fmtMoney(totals.totalBalance);
        totalVal.style.cssText = "font-size: 1.6em; font-weight: 700; font-variant-numeric: tabular-nums;";

        const zeroEl = hero.createEl("div", { cls: "fhs-zero-date" });
        zeroEl.style.cssText = "margin-bottom: 10px;";
        const zeroLab = zeroEl.createEl("span");
        zeroLab.textContent = "ZERO-DEBT DATE ";
        zeroLab.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600; text-transform: uppercase;";
        const zeroVal = zeroEl.createEl("span");
        zeroVal.textContent = totals.zeroDebtDate;
        zeroVal.style.cssText = "font-size: 1em; font-weight: 500; font-variant-numeric: tabular-nums;";

        const subStats = hero.createEl("div", { cls: "fhs-sub-stats" });
        subStats.textContent = `Weighted APR ${totals.weightedApr.toFixed(2)}% · Monthly attack ${this._fmtMoney(totals.plannedAttack)} · Monthly interest ${this._fmtMoney(totals.monthlyInterest)}`;
        subStats.style.cssText = "font-size: 0.82em; color: var(--text-muted); font-variant-numeric: tabular-nums;";
    }

    // ----------------------------------------------------------------- Tiles

    _renderTiles(root, dv) {
        const row = root.createEl("div", { cls: "fhs-tiles" });
        row.style.cssText = "display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;";

        this._renderBudgetTile(row, dv);
        this._renderPaycheckTile(row, dv);
        this._renderInvoicesTile(row, dv);
    }

    _makeTile(parent, cls) {
        const tile = parent.createEl("div", { cls });
        tile.style.cssText = "padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer; background: var(--background-secondary);";
        return tile;
    }

    _tileLabel(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.04em; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;";
        return el;
    }

    _tileValue(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 1em; font-weight: 500; font-variant-numeric: tabular-nums; margin-bottom: 4px;";
        return el;
    }

    _tileMuted(tile, text) {
        const el = tile.createEl("div");
        el.textContent = text;
        el.style.cssText = "font-size: 0.78em; color: var(--text-muted);";
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

            this._tileValue(tile, `${this._fmtMoney(spending)} / ${this._fmtMoney(totalPlanned)} (${pct}%)`);

            const barWrap = tile.createEl("div");
            barWrap.style.cssText = "height: 4px; background: var(--background-modifier-border); border-radius: 2px; margin-bottom: 6px;";
            const barFill = barWrap.createEl("div");
            const fillPct = Math.min(100, pct);
            const barColor = pct <= 90 ? "#16a34a" : pct <= 110 ? "#b45309" : "#dc2626";
            barFill.style.cssText = `height: 100%; width: ${fillPct}%; background: ${barColor}; border-radius: 2px;`;

            const currentDay = now.getDate();
            const daysInMonth = new Date(year, month, 0).getDate();
            this._tileMuted(tile, `${currentDay}/${daysInMonth} days in month`);
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
            const latest = allPaychecks.slice().sort((a, b) => {
                const as = (typeof a.pay_period_start === "string") ? a.pay_period_start
                    : (a.pay_period_start && typeof a.pay_period_start.toISODate === "function")
                        ? a.pay_period_start.toISODate() : "";
                const bs = (typeof b.pay_period_start === "string") ? b.pay_period_start
                    : (b.pay_period_start && typeof b.pay_period_start.toISODate === "function")
                        ? b.pay_period_start.toISODate() : "";
                return bs.localeCompare(as);
            })[0];

            const startStr = (typeof latest.pay_period_start === "string") ? latest.pay_period_start
                : (latest.pay_period_start && typeof latest.pay_period_start.toISODate === "function")
                    ? latest.pay_period_start.toISODate() : String(latest.pay_period_start || "");
            const amount = typeof latest.paycheck_amount === "number" ? latest.paycheck_amount : 0;
            this._tileValue(tile, `${this._fmtMoney(amount)}`);
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
