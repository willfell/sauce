/**
 * PaycheckNavButtons — per-paycheck context nav. Auto-detects via path prefix
 * `spice/finance/paychecks/<YYYY-MM-DD>/`. Renders Paycheck / Paychecks Hub /
 * Finance Hub buttons with icons + hover-to-accent transition. Top HR +
 * uppercase "PAYCHECK" section label. Hides the button matching the active
 * file. Embed-deduped per v0.16.0 lesson. Mirrors project blueprint shape.
 */
class PaycheckNavButtons {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pnb-root");
        if (previous) previous.remove();

        const path = dv.current()?.file?.path || "";
        const m = path.match(/^spice\/finance\/paychecks\/(\d{4}-\d{2}-\d{2})\//);
        if (!m) return;
        const start_date = m[1];

        const icons = {
            paycheck: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M16 9.5C16 8.12 14.21 7 12 7s-4 1.12-4 2.5 1.79 2.5 4 2.5 4 1.12 4 2.5-1.79 2.5-4 2.5-4-1.12-4-2.5"/></svg>`,
            paychecksHub: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>`,
            financeHub: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`
        };

        const targets = [
            { label: "Paycheck",      icon: icons.paycheck,     target: `spice/finance/paychecks/${start_date}/Paycheck-${start_date}.md` },
            { label: "Paychecks Hub", icon: icons.paychecksHub, target: `spice/finance/paychecks/Paychecks.md` },
            { label: "Finance Hub",   icon: icons.financeHub,   target: `spice/finance/Finance.md` }
        ].filter(t => t.target !== path);
        if (targets.length === 0) return;

        const root = dv.container.createEl("div", { cls: "pnb-root" });

        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Paycheck";
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
