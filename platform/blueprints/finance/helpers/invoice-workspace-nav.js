/**
 * InvoiceWorkspaceNav — v0.115.2.
 *
 * Renders a small two-button nav row on every Invoice-<YYYY-MM>.md entity:
 *   [ Time Log ]  [ Board ]
 *
 * Each button opens the corresponding sidecar (Time-Log-<YYYY-MM>.md and
 * board/Board-<YYYY-MM>.md respectively — both scaffolded by the invoice
 * entity-create entry's `extra_files[]`). Closes a UX gap reported on the
 * ero v0.115.1 deploy: from an invoice note there was no direct path to
 * the time-log or kanban board.
 *
 * Renders BETWEEN FinanceNav and FinanceStatus.renderBadge on every Invoice
 * note. Type-guarded (`page.type === "invoice"`); embed-deduped; read-only.
 * If the linked sidecars don't exist yet (legacy invoices with no Time-Log
 * scaffold), clicking still calls openLinkText which will offer to create
 * the file — same Obsidian-native behavior as a wikilink.
 *
 * Wired by:
 *   - new_entity_buttons[invoice].inline_body (new invoices)
 *   - templates/Invoice Template.md (Templater path)
 *   - applyFinanceInvoiceWorkspaceNavInjection (heals existing invoices)
 */
class InvoiceWorkspaceNav {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .iwn-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        if (page.type !== "invoice") return;

        const month = this._monthKey(page);
        if (!month) return;

        const root = dv.container.createEl("div", { cls: "iwn-root" });
        root.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 6px 0 4px;";

        const timeLogPath = `spice/finance/invoices/${month}/Time-Log-${month}.md`;
        const boardPath = `spice/finance/invoices/${month}/board/Board-${month}.md`;

        this._renderButton(root, "Time Log", this._iconClock(), timeLogPath);
        this._renderButton(root, "Board", this._iconBoard(), boardPath);
    }

    _monthKey(page) {
        if (typeof page.month === "string" && /^\d{4}-\d{2}$/.test(page.month)) return page.month;
        // Fallback: parse from filename
        const name = page.file && page.file.name;
        if (typeof name === "string") {
            const m = name.match(/Invoice-(\d{4}-\d{2})/);
            if (m) return m[1];
        }
        // Coerce Luxon DateTime / Date
        try {
            const FM = (typeof customJS !== "undefined" && customJS && customJS.FinanceMath) ? customJS.FinanceMath : null;
            if (FM) {
                const m = FM._coerceMonthString(page.month);
                if (m) return m;
            }
        } catch (_e) { /* fall through */ }
        return null;
    }

    _renderButton(parent, label, icon, target) {
        if (typeof customJS !== "undefined" && customJS && customJS.AccentButton) {
            customJS.AccentButton.render(parent, {
                label,
                icon,
                onClick: () => app.workspace.openLinkText(target, "")
            });
            return;
        }
        // Fallback when AccentButton is not loaded yet (cold-load race).
        const btn = parent.createEl("button");
        btn.innerHTML = `${icon}<span style="margin-left:6px">${label}</span>`;
        btn.style.cssText = "display: inline-flex; align-items: center; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); cursor: pointer; font-size: 0.85em;";
        btn.addEventListener("click", () => app.workspace.openLinkText(target, ""));
    }

    _iconClock() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
    }
    _iconBoard() {
        return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>';
    }
}
