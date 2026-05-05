/**
 * InvoiceNavButtons — per-invoice ecosystem context nav.
 *
 * Auto-detects via path prefix `beacon/finance/invoices/<YYYY-MM>/`. Renders
 * buttons for Invoice / Time Log / Board / Finance Hub. Hides the button
 * matching the active file. Mirrors trips' TripNavButtons context-aware shape,
 * simplified.
 */
class InvoiceNavButtons {
    async render(dv) {
        const previous = dv.container.querySelector(":scope > .inb-root");
        if (previous) previous.remove();

        const path = dv.current()?.file?.path || "";
        const m = path.match(/^beacon\/finance\/invoices\/(\d{4}-\d{2})\//);
        if (!m) return;
        const month = m[1];
        const root = `beacon/finance/invoices/${month}`;
        const targets = [
            { label: "Invoice",     target: `${root}/Invoice-${month}.md` },
            { label: "Time Log",    target: `${root}/Time-Log-${month}.md` },
            { label: "Board",       target: `${root}/board/Board-${month}.md` },
            { label: "Finance Hub", target: `beacon/finance/Finance.md` }
        ].filter(t => t.target !== path);

        const row = dv.container.createEl("div", { cls: "inb-root" });
        row.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0;";
        for (const t of targets) {
            const btn = row.createEl("button");
            btn.textContent = t.label;
            btn.style.cssText = "cursor: pointer; padding: 6px 12px; border-radius: 6px; font-size: 0.85em; border: 1px solid var(--background-modifier-border); background: var(--background-secondary);";
            btn.onclick = () => app.workspace.openLinkText(t.target, "");
        }
    }
}
