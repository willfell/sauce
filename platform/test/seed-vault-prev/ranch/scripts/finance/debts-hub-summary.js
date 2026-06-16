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
        root.style.cssText = "margin: 12px 0 20px; padding: 16px; border: 1px solid var(--background-modifier-border); border-radius: 12px; background: var(--background-secondary-alt);";

        if (debts.length === 0) {
            const empty = root.createEl("div", { cls: "dhs-empty" });
            empty.textContent = "No debts yet. Add via + New Debt or seed Debt Defaults from the configuration.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 6px 0; text-align: center;";
            return;
        }

        // ----- Compute totals -----
        const totalBal = debts.reduce((s, d) => s + (Number(d.current_balance) || 0), 0);
        const totalInterest = debts.reduce((s, d) =>
            s + ((Number(d.current_balance) || 0) * (Number(d.apr) || 0) / 100 / 12), 0);
        const totalPlanned = debts.reduce((s, d) => s + (Number(d.planned_monthly_payment) || 0), 0);

        // Weighted-avg APR = Σ(balance * apr) / Σ(balance)
        const weightedAprNumer = debts.reduce((s, d) =>
            s + (Number(d.current_balance) || 0) * (Number(d.apr) || 0), 0);
        const wAvgApr = totalBal > 0 ? weightedAprNumer / totalBal : 0;

        let zeroDate = "—";
        const principalAttack = totalPlanned - totalInterest;
        if (principalAttack > 0 && totalBal > 0) {
            const months = Math.ceil(totalBal / principalAttack);
            const d = new Date();
            d.setMonth(d.getMonth() + months);
            zeroDate = d.toISOString().slice(0, 10);
        }

        // ----- Band 1 — Totals -----
        const b1 = root.createEl("div", { cls: "dhs-band-1" });
        b1.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1px solid var(--background-modifier-border);";

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
        b2.style.cssText = "padding: 10px 0; border-bottom: 1px solid var(--background-modifier-border); display: flex; gap: 8px; flex-wrap: wrap;";

        for (const [k, stats] of Object.entries(byKind)) {
            const chip = b2.createEl("span", { cls: "dhs-kind-chip" });
            chip.textContent = `${k}: $${stats.total.toFixed(0)} across ${stats.count}`;
            chip.style.cssText = "font-size: 0.82em; padding: 2px 8px; border-radius: 4px; background: var(--background-modifier-border); color: var(--text-muted);";
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
            card.style.cssText = "padding: 8px 10px; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer;";

            card.createEl("div", { cls: "dhs-card-name", text: d.name || "(unnamed)" }).style.cssText =
                "font-size: 0.82em; font-weight: 600; margin-bottom: 2px;";
            card.createEl("div", { cls: "dhs-card-bal", text: `$${bal.toFixed(2)}` }).style.cssText =
                "font-size: 1em; font-variant-numeric: tabular-nums;";
            card.createEl("div", { cls: "dhs-card-apr", text: `${apr.toFixed(2)}% APR` }).style.cssText =
                "font-size: 0.78em; color: var(--text-muted); margin-top: 2px;";

            if (d.kind === "credit-card" && Number(d.credit_limit) > 0) {
                const paidPct = Math.round((1 - bal / Number(d.credit_limit)) * 100);
                const chip = card.createEl("span", { cls: "dhs-card-chip", text: `${paidPct}% paid` });
                chip.style.cssText = `display: inline-block; margin-top: 4px; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; color: #fff; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"};`;
            }

            card.addEventListener("click", () => {
                if (d.file && d.file.name) app.workspace.openLinkText(d.file.name, "");
            });
        }
    }
}
