/**
 * DebtsCards v0.6.0 (v0.108.0 S3)
 *
 * Grid listing of all spice/finance/debts/Debt-*.md notes.
 * Mirror of BudgetsCards — sorted by balance DESC. Click navigates to
 * the debt entity note. Shows name, balance, APR badge, paydown chip
 * (CC kind only).
 *
 * CSS root: dbt-cards-root. Embed-deduped.
 */
class DebtsCards {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".dbt-cards-root");
            if (prev) prev.remove();
        }

        const debts = dv.pages('"spice/finance/debts"').where(p => p.type === "debt").array();
        const root = dv.container.createEl("div", { cls: "dbt-cards-root" });
        root.style.cssText = "margin: 8px 0;";

        if (debts.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "No debts yet.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const sorted = debts.slice().sort((a, b) =>
            (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0));

        const grid = root.createEl("div");
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;";

        for (const d of sorted) {
            const bal = Number(d.current_balance) || 0;
            const apr = Number(d.apr) || 0;

            const card = grid.createEl("div", { cls: "dbt-card" });
            card.style.cssText = "padding: 12px; border: 1px solid var(--background-modifier-border); border-radius: 8px; cursor: pointer; background: var(--background-primary); transition: box-shadow 0.1s;";

            card.onmouseenter = () => { card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; };
            card.onmouseleave = () => { card.style.boxShadow = ""; };

            const nameEl = card.createEl("div");
            nameEl.textContent = d.name || "(unnamed)";
            nameEl.style.cssText = "font-weight: 600; font-size: 0.92em; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const balEl = card.createEl("div");
            balEl.textContent = `$${bal.toFixed(2)}`;
            balEl.style.cssText = "font-size: 1.05em; font-variant-numeric: tabular-nums; margin-bottom: 4px;";

            const aprBadge = card.createEl("span");
            aprBadge.textContent = `${apr.toFixed(2)}% APR`;
            aprBadge.style.cssText = "font-size: 0.75em; padding: 1px 6px; border-radius: 3px; background: var(--background-modifier-border); color: var(--text-muted);";

            if (d.kind === "credit-card" && Number(d.credit_limit) > 0) {
                const paidPct = Math.max(0, Math.min(100, Math.round((1 - bal / Number(d.credit_limit)) * 100)));
                const chip = card.createEl("span");
                chip.textContent = `${paidPct}% paid`;
                chip.style.cssText = `display: inline-block; margin-left: 6px; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; color: #fff; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"};`;
            }

            card.addEventListener("click", () => {
                if (d.file && d.file.name) app.workspace.openLinkText(d.file.name, "");
            });
        }
    }
}
