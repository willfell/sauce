/**
 * SavingsCards v0.10.0
 *
 * Grid listing of all spice/finance/savings/*.md savings-account notes.
 * Sorted by balance DESC. Click navigates to the savings entity note.
 * Shows name, balance, target-progress chip.
 *
 * CSS root: sav-cards-root. Embed-deduped.
 */
class SavingsCards {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".sav-cards-root");
            if (prev) prev.remove();
        }

        const accounts = dv.pages('"spice/finance/savings"').where(p => p.type === "savings-account").array();
        const root = dv.container.createEl("div", { cls: "sav-cards-root" });
        root.style.cssText = "margin: 8px 0;";

        if (accounts.length === 0) {
            const empty = root.createEl("div");
            empty.textContent = "No savings accounts yet.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const sorted = accounts.slice().sort((a, b) =>
            (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0));

        const grid = root.createEl("div");
        grid.style.cssText = "display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;";

        for (const s of sorted) {
            const bal = Number(s.current_balance) || 0;
            const target = Number(s.target) || 0;
            const paidPct = target > 0 ? Math.min(100, (bal / target) * 100) : 0;

            const card = grid.createEl("div", { cls: "sav-card" });
            card.style.cssText = "padding: 12px; border: 1px solid var(--sauce-hairline); border-radius: var(--sauce-radius-btn); cursor: pointer; background: var(--background-primary); transition: box-shadow 0.1s;";

            card.onmouseenter = () => { card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)"; };
            card.onmouseleave = () => { card.style.boxShadow = ""; };

            const nameEl = card.createEl("div");
            nameEl.textContent = s.name || "(unnamed)";
            nameEl.style.cssText = "font-weight: 600; font-size: 0.92em; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const balEl = card.createEl("div");
            balEl.textContent = `$${bal.toFixed(2)}`;
            balEl.style.cssText = "font-size: 1.05em; font-variant-numeric: tabular-nums; margin-bottom: 4px;";

            const chip = card.createEl("span", { cls: "sav-progress-pill sauce-pill" });
            chip.textContent = `${paidPct.toFixed(0)}% of $${target}`;
            chip.style.cssText = `color: #fff; background: ${paidPct < 33 ? "#dc2626" : paidPct < 66 ? "#b45309" : "#16a34a"};`;

            card.addEventListener("click", () => {
                if (s.file && s.file.name) app.workspace.openLinkText(s.file.name, "");
            });
        }
    }
}
