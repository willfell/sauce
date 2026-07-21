/**
 * DebtsHubSummary v0.6.0 (v0.108.0 S3)
 * Marker: dhs-v0.6.0
 *
 * Hub-level three-band rollup for spice/finance/debts/Debts.md.
 *
 * Band 1 — Totals: total debt, monthly interest, planned attack,
 *          weighted-average APR, zero-debt date.
 * Band 2 — Per-kind progress strip (credit cards, student loans, other).
 * Band 3 — Per-debt mini-cards sorted by balance DESC (click to navigate).
 *
 * Weighted-avg APR = Σ(balance * apr) / Σ(balance).
 *
 * CSS root: dhs-root. Embed-deduped. Never writes. Pure derivation.
 */
class DebtsHubSummary {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".dhs-root");
            if (prev) prev.remove();
        }

        const debts = dv.pages('"spice/finance/debts"').where(p => p.type === "debt").array();
        const root = dv.container.createEl("div", { cls: "dhs-root" });
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--sauce-hairline); border-radius: 12px; background: var(--background-secondary-alt);";

        if (debts.length === 0) {
            const empty = root.createEl("div", { cls: "dhs-empty" });
            empty.textContent = "No debts yet. Add via + New Debt or seed Debt Defaults from the configuration.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0; text-align: center;";
            return;
        }

        // ----- Compute totals (canonical payoff source so this hub == the Finance hub) -----
        const _now = new Date();
        const _monthKey = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;
        const pp = customJS.FinanceMath.projectedPayoff(dv, _monthKey);
        const totalBal = pp.totalBalance;
        const totalInterest = pp.monthlyInterest;
        const totalPlanned = pp.plannedAttack;
        const wAvgApr = pp.weightedApr;
        const zeroDate = pp.zeroDebtDate;

        // ----- Band 1 — Totals -----
        const b1 = root.createEl("div", { cls: "dhs-band-1" });
        b1.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--sauce-hairline);";

        const mk = (label, val) => {
            const cell = b1.createEl("div");
            cell.style.cssText = "flex: 1; min-width: 120px;";
            const labEl = cell.createEl("div");
            labEl.textContent = label;
            labEl.style.cssText = "font-size: 0.72em; color: var(--text-muted); letter-spacing: 0.05em; font-weight: 600;";
            const valEl = cell.createEl("div");
            valEl.textContent = val;
            valEl.style.cssText = "font-size: 1.1em; font-variant-numeric: tabular-nums; margin-top: 2px;";
        };

        mk("TOTAL DEBT", `$${totalBal.toFixed(2)}`);
        mk("MONTHLY INTEREST", `$${totalInterest.toFixed(2)}`);
        mk("MONTHLY ATTACK", `$${totalPlanned.toFixed(2)}`);
        mk("WEIGHTED APR", `${wAvgApr.toFixed(2)}%`);
        mk("ZERO-DEBT DATE", zeroDate);

        // ----- Band 2 — Per-kind strip -----
        const byKind = {};
        for (const d of debts) {
            const k = d.kind || "other";
            if (!byKind[k]) byKind[k] = { count: 0, total: 0 };
            byKind[k].count++;
            byKind[k].total += Number(d.current_balance) || 0;
        }

        const b2 = root.createEl("div", { cls: "dhs-band-2" });
        b2.style.cssText = "padding: 10px 0; border-bottom: 1px solid var(--sauce-hairline); display: flex; gap: 8px; flex-wrap: wrap;";

        for (const [k, stats] of Object.entries(byKind)) {
            const chip = b2.createEl("span", { cls: "dhs-kind-chip sauce-pill" });
            chip.textContent = `${k}: $${stats.total.toFixed(0)} across ${stats.count}`;
            chip.style.cssText = "white-space: normal; overflow-wrap: anywhere;";
        }

        // ----- Band 3 — Per-debt mini-cards -----
        const sorted = debts.slice().sort((a, b) =>
            (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0));

        const b3 = root.createEl("div", { cls: "dhs-band-3" });
        b3.style.cssText = "padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px;";

        for (const d of sorted) {
            const bal = Number(d.current_balance) || 0;
            const apr = Number(d.apr) || 0;
            const card = b3.createEl("div", { cls: "dhs-card" });
            card.style.cssText = "padding: 8px 10px; border: 1px solid var(--sauce-hairline); border-radius: var(--sauce-radius-btn); cursor: pointer;";

            card.createEl("div", { cls: "dhs-card-name", text: d.name || "(unnamed)" }).style.cssText =
                "font-size: 0.82em; font-weight: 600; margin-bottom: 2px;";
            card.createEl("div", { cls: "dhs-card-bal", text: `$${bal.toFixed(2)}` }).style.cssText =
                "font-size: 1em; font-variant-numeric: tabular-nums;";
            card.createEl("div", { cls: "dhs-card-apr", text: `${apr.toFixed(2)}% APR` }).style.cssText =
                "font-size: 0.78em; color: var(--text-muted); margin-top: 2px;";

            if (d.kind === "credit-card" && Number(d.credit_limit) > 0) {
                const paidPct = Math.round((1 - bal / Number(d.credit_limit)) * 100);
                const chip = card.createEl("span", { cls: "dhs-card-progress-pill sauce-pill", text: `${paidPct}% paid` });
                chip.style.cssText = `margin-top: 4px; color: #fff; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"};`;
            }

            card.addEventListener("click", () => {
                if (d.file && d.file.name) app.workspace.openLinkText(d.file.name, "");
            });
        }
    }
}
