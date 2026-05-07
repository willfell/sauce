/**
 * InvoiceNavButtons — per-invoice ecosystem context nav. Auto-detects via path
 * prefix `spice/finance/invoices/<YYYY-MM>/`. Renders Invoice / Time Log /
 * Board / Finance Hub buttons with icons + hover-to-accent transition. Top HR
 * + uppercase "INVOICE" section label. Hides the button matching the active
 * file. Embed-deduped per v0.16.0 lesson. Mirrors project blueprint shape.
 */
class InvoiceNavButtons {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .inb-root");
        if (previous) previous.remove();

        const path = dv.current()?.file?.path || "";
        const m = path.match(/^spice\/finance\/invoices\/(\d{4}-\d{2})\//);
        if (!m) return;
        const month = m[1];
        const root = `spice/finance/invoices/${month}`;

        const icons = {
            invoice: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`,
            timeLog: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
            board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
            financeHub: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>`
        };

        const targets = [
            { label: "Invoice",     icon: icons.invoice,    target: `${root}/Invoice-${month}.md` },
            { label: "Time Log",    icon: icons.timeLog,    target: `${root}/Time-Log-${month}.md` },
            { label: "Board",       icon: icons.board,      target: `${root}/board/Board-${month}.md` },
            { label: "Finance Hub", icon: icons.financeHub, target: `spice/finance/Finance.md` }
        ].filter(t => t.target !== path);
        if (targets.length === 0) return;

        const rootEl = dv.container.createEl("div", { cls: "inb-root" });

        const topDivider = rootEl.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = rootEl.createEl("div");
        sectionLabel.textContent = "Invoice";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const container = rootEl.createEl("div");
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
