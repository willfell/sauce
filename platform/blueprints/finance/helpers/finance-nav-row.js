/**
 * FinanceNavRow v0.6.0 (v0.108.0 S3)
 *
 * Context-aware single nav-row class. Replaces BudgetNavButtons,
 * PaycheckNavButtons, InvoiceNavButtons (deleted in S3.8). Detects
 * mode from dv.current().file.path + page.type. Hub modes delegate
 * to FinanceHubActions (CF-3 v0.5.3 — cross-hub nav + entity-create
 * + Defaults link in one consolidated row). Entity modes render
 * inline sibling nav. CSS root: fnr-root.
 */
class FinanceNavRow {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) {
            const prev = dv.container.querySelector(".fnr-root");
            if (prev) prev.remove();
        }

        const page = dv.current() || {};
        const filePath = page?.file?.path || "";
        const type = page.type;
        const mode = this._detectMode(filePath, type);

        const root = dv.container.createEl("div", { cls: "fnr-root", attr: { "data-mode": mode } });

        const divider = root.createEl("hr");
        divider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        if (mode.startsWith("hub-")) {
            await this._renderHub(dv, root, mode);
        } else {
            await this._renderEntity(dv, root, mode, page);
        }
    }

    _detectMode(filePath, type) {
        if (filePath === "spice/finance/Finance.md") return "hub-finance";
        if (filePath === "spice/finance/budgets/Budgets.md") return "hub-budgets";
        if (filePath === "spice/finance/paychecks/Paychecks.md") return "hub-paychecks";
        if (filePath === "spice/finance/invoices/Invoices.md") return "hub-invoices";
        if (filePath === "spice/finance/debts/Debts.md") return "hub-debts";
        if (type === "budget") return "entity-budget";
        if (type === "paycheck") return "entity-paycheck";
        if (type === "invoice") return "entity-invoice";
        if (type === "debt") return "entity-debt";
        return "hub-finance";
    }

    async _renderHub(dv, root, mode) {
        const here = mode.replace("hub-", "");

        // Hub mode delegates to FinanceHubActions (CF-3 v0.5.3) — cross-hub nav
        // + + New X (via EntityCreate) + Defaults link in a single consolidated
        // row. FinanceNavRow's contribution here is the section label above.
        const labelEl = root.createEl("div");
        labelEl.textContent = here.charAt(0).toUpperCase() + here.slice(1);
        labelEl.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const inst = here === "budgets" ? "budget"
            : here === "paychecks" ? "paycheck"
            : here === "invoices" ? "invoice"
            : here === "debts" ? "debt"
            : null;
        const defaultsPath = here === "budgets" ? "spice/finance/Budget Defaults.md"
            : here === "paychecks" ? "spice/finance/Paycheck Defaults.md"
            : here === "debts" ? "spice/finance/Debt Defaults.md"
            : null;

        // Provide a dv shim that attaches FinanceHubActions to our root so the
        // hub-actions row sits inside fnr-root for embed-dedup parity.
        const shim = Object.create(dv);
        shim.container = root;

        try {
            await customJS.FinanceHubActions.render(shim, { here, instance: inst, defaultsPath });
        } catch (_e) {
            // FinanceHubActions may not be loaded in some contexts (e.g. fresh
            // headless install). Fail-soft — section label above still renders.
        }
    }

    async _renderEntity(dv, root, mode, page) {
        const labelEl = root.createEl("div");
        const labelText = mode === "entity-budget" ? "Budget"
            : mode === "entity-paycheck" ? "Paycheck"
            : mode === "entity-invoice" ? "Invoice"
            : "Debt";
        labelEl.textContent = labelText;
        labelEl.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const row = root.createEl("div");
        row.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px; align-items: center;";

        const btnStyle = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease;";

        const mkBtn = (label, path) => {
            const btn = row.createEl("button", { text: label });
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
            btn.onclick = () => app.workspace.openLinkText(path, "");
            return btn;
        };

        mkBtn("Finance Hub", "spice/finance/Finance.md");

        if (mode === "entity-budget") {
            mkBtn("Budgets Hub", "spice/finance/budgets/Budgets.md");
            await this._renderSiblingNav(row, page, "budgets", "month", "ASC", btnStyle);
        } else if (mode === "entity-paycheck") {
            mkBtn("Paychecks Hub", "spice/finance/paychecks/Paychecks.md");
            await this._renderSiblingNav(row, page, "paychecks", "month", "ASC", btnStyle);
        } else if (mode === "entity-invoice") {
            mkBtn("Invoices Hub", "spice/finance/invoices/Invoices.md");
        } else if (mode === "entity-debt") {
            mkBtn("Debts Hub", "spice/finance/debts/Debts.md");
            await this._renderSiblingNav(row, page, "debts", "current_balance", "DESC", btnStyle);
        }
    }

    async _renderSiblingNav(row, page, subarea, sortKey, dir, btnStyle) {
        try {
            const currentPath = page?.file?.path || "";
            const allFiles = app.vault.getMarkdownFiles()
                .filter(f => f.path.startsWith(`spice/finance/${subarea}/`) && f.path !== `spice/finance/${subarea}/${subarea.charAt(0).toUpperCase() + subarea.slice(1)}.md`);

            const siblings = allFiles.map(f => {
                const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
                // Month-keyed entities sort by `month`; legacy paycheck notes lack
                // it, so fall back to pay_period_start (harmless for budgets/months
                // whose `month` is always present).
                let sortVal = fm[sortKey];
                if ((sortVal === undefined || sortVal === null) && sortKey === "month") sortVal = fm.pay_period_start;
                return { path: f.path, name: f.name, sortVal, fm };
            }).filter(s => s.sortVal !== undefined && s.sortVal !== null);

            siblings.sort((a, b) => {
                const av = String(a.sortVal || "");
                const bv = String(b.sortVal || "");
                return dir === "DESC" ? bv.localeCompare(av) : av.localeCompare(bv);
            });

            const idx = siblings.findIndex(s => s.path === currentPath);
            if (idx === -1) return;

            const prevSib = siblings[idx - 1];
            const nextSib = siblings[idx + 1];

            if (prevSib) {
                const btn = row.createEl("button", { text: "← Prev" });
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
                btn.onclick = () => app.workspace.openLinkText(prevSib.path, "");
            }

            if (nextSib) {
                const btn = row.createEl("button", { text: "Next →" });
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
                btn.onclick = () => app.workspace.openLinkText(nextSib.path, "");
            }
        } catch (_e) { /* fail-soft — sibling nav is best-effort */ }
    }
}
