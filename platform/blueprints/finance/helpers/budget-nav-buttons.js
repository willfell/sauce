/**
 * BudgetNavButtons — per-budget context nav. Auto-detects via path prefix
 * `spice/finance/budgets/<YYYY-MM>/`. Renders Budget / Budgets Hub / Finance
 * Hub buttons with icons + hover-to-accent transition. Top HR + uppercase
 * "BUDGET" section label. Hides the button matching the active file.
 * Embed-deduped per v0.16.0 lesson. Mirrors project blueprint nav-button shape.
 */
class BudgetNavButtons {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bnb-root");
        if (previous) previous.remove();

        const path = dv.current()?.file?.path || "";
        const m = path.match(/^spice\/finance\/budgets\/(\d{4}-\d{2})\//);
        if (!m) return;
        const month = m[1];

        const icons = {
            budget: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`,
            budgetsHub: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
            financeHub: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`
        };

        const targets = [
            { label: "Budget",      icon: icons.budget,     target: `spice/finance/budgets/${month}/Budget-${month}.md` },
            { label: "Budgets Hub", icon: icons.budgetsHub, target: `spice/finance/budgets/Budgets.md` },
            { label: "Finance Hub", icon: icons.financeHub, target: `spice/finance/Finance.md` }
        ].filter(t => t.target !== path);
        if (targets.length === 0) return;

        const root = dv.container.createEl("div", { cls: "bnb-root" });

        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Budget";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const container = root.createEl("div");
        container.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px;";

        const btnStyle = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; flex: 1; min-width: 0;";

        for (const t of targets) {
            const btn = container.createEl("button");
            btn.innerHTML = t.icon + `<span>${t.label}</span>`;
            btn.style.cssText = btnStyle;
            btn.onmouseenter = () => {
                btn.style.background = "var(--interactive-accent)";
                btn.style.color = "var(--text-on-accent)";
                btn.style.borderColor = "var(--interactive-accent)";
            };
            btn.onmouseleave = () => {
                btn.style.background = "var(--background-primary)";
                btn.style.color = "var(--text-muted)";
                btn.style.borderColor = "var(--background-modifier-border)";
            };
            btn.onclick = () => app.workspace.openLinkText(t.target, "");
        }
    }
}
