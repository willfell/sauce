/**
 * FinanceNav v0.7.0 (workshop v0.111.0)
 *
 * The ONE context-aware nav primitive for the entire finance blueprint.
 * Notes call this with no arguments:
 *
 *   ```dataviewjs
 *   await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
 *   ```
 *
 * The class detects the current file from `dv.current()` and renders the
 * appropriate two-tier nav — cross-hub buttons on top, context-specific
 * actions below — with `---` separators wrapping every section.
 *
 * Replaces both FinanceHubActions (single-row consolidated nav, v0.5.3) and
 * FinanceNavRow (context-aware delegator, v0.6.0). Those classes remain in
 * the blueprint for backward compatibility with hand-edited notes that
 * haven't been migrated yet; new notes scaffolded after v0.111.0 use
 * FinanceNav exclusively.
 *
 * Detected modes (from page.file.path + page.type):
 *   hub-finance      | Finance.md
 *   hub-budgets      | budgets/Budgets.md
 *   hub-paychecks    | paychecks/Paychecks.md
 *   hub-invoices     | invoices/Invoices.md
 *   hub-debts        | debts/Debts.md
 *   entity-budget    | type: budget
 *   entity-paycheck  | type: paycheck
 *   entity-invoice   | type: invoice
 *   entity-debt      | type: debt
 *   (fallback)       | renders top-hub layout
 *
 * Layout per mode:
 *
 *   hub-finance:
 *     ---
 *     [ Budgets | Paychecks | Invoices | Debts ]
 *     ---
 *
 *   hub-budgets / hub-paychecks / hub-debts (have defaults):
 *     ---
 *     [ Finance | <other 3 sub-hubs> ]
 *     ---
 *     [ + New <X> | <X> Defaults ]
 *     ---
 *
 *   hub-invoices (no defaults):
 *     ---
 *     [ Finance | Budgets | Paychecks | Debts ]
 *     ---
 *     [ + New Invoice ]
 *     ---
 *
 *   entity-budget / entity-paycheck / entity-invoice / entity-debt:
 *     ---
 *     [ Finance | <other 3 sub-hubs> ]
 *     ---
 *     [ <X>s Hub | ← Prev | Next → ]
 *     ---
 *
 * Cold-load race fix carried forward from v0.110.1/0.110.3: polls
 * window.customJS.EntityCreate for up to 5s before invoking, falls back
 * to a muted "EntityCreate unavailable" placeholder rather than throwing.
 */
class FinanceNav {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .fnav-root");
        if (previous) previous.remove();

        const page = dv.current() || {};
        const filePath = page?.file?.path || "";
        const type = page?.type;
        const mode = this._detectMode(filePath, type);

        const root = dv.container.createEl("div", { cls: "fnav-root", attr: { "data-mode": mode } });

        // Section 1: top divider + cross-hub nav + divider
        this._hr(root);
        this._renderCrossHub(root, mode);
        this._hr(root);

        // Section 2 (when applicable): context row + divider
        if (mode.startsWith("hub-") && mode !== "hub-finance") {
            await this._renderHubContext(dv, root, mode);
            this._hr(root);
        } else if (mode.startsWith("entity-")) {
            this._renderEntityContext(root, mode, page);
            this._hr(root);
        }
    }

    _hr(root) {
        const hr = root.createEl("hr");
        hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0;";
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

    _hereKey(mode) {
        if (mode === "hub-finance") return "finance";
        if (mode === "hub-budgets" || mode === "entity-budget") return "budgets";
        if (mode === "hub-paychecks" || mode === "entity-paycheck") return "paychecks";
        if (mode === "hub-invoices" || mode === "entity-invoice") return "invoices";
        if (mode === "hub-debts" || mode === "entity-debt") return "debts";
        return null;
    }

    _renderCrossHub(root, mode) {
        const row = root.createEl("div", { cls: "fnav-row fnav-hubs" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0;";

        const HUBS = [
            { key: "finance",   label: "Finance",   path: "spice/finance/Finance.md" },
            { key: "budgets",   label: "Budgets",   path: "spice/finance/budgets/Budgets.md" },
            { key: "paychecks", label: "Paychecks", path: "spice/finance/paychecks/Paychecks.md" },
            { key: "invoices",  label: "Invoices",  path: "spice/finance/invoices/Invoices.md" },
            { key: "debts",     label: "Debts",     path: "spice/finance/debts/Debts.md" },
        ];

        const here = this._hereKey(mode);

        for (const hub of HUBS) {
            if (hub.key === here) continue;
            customJS.AccentButton.render(row, {
                label: hub.label,
                onClick: () => app.workspace.openLinkText(hub.path, "")
            });
        }
    }

    async _renderHubContext(dv, root, mode) {
        const row = root.createEl("div", { cls: "fnav-row fnav-context" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0;";

        const config = {
            "hub-budgets":   { instance: "budget",   defaultsLabel: "Budget Defaults",   defaultsPath: "spice/finance/Budget Defaults.md" },
            "hub-paychecks": { instance: "paycheck", defaultsLabel: "Paycheck Defaults", defaultsPath: "spice/finance/Paycheck Defaults.md" },
            "hub-invoices":  { instance: "invoice",  defaultsLabel: null,                defaultsPath: null },
            "hub-debts":     { instance: "debt",     defaultsLabel: "Debt Defaults",     defaultsPath: "spice/finance/Debt Defaults.md" },
        };
        const cfg = config[mode];
        if (!cfg) return;

        // + New <X> via EntityCreate (poll for cold-load race; carried from v0.110.1/0.110.3)
        const subContainer = row.createEl("div");
        subContainer.style.cssText = "display: inline-flex;";
        const shim = Object.create(dv);
        shim.container = subContainer;
        for (let i = 0; i < 100 && !window.customJS?.EntityCreate; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (window.customJS?.EntityCreate) {
            await customJS.EntityCreate.render(shim, { instance: cfg.instance });
        } else {
            const ph = subContainer.createEl("em", { text: "EntityCreate unavailable" });
            ph.style.cssText = "color: var(--text-muted); font-size: 0.85em;";
        }

        // <X> Defaults link
        if (cfg.defaultsPath && cfg.defaultsLabel) {
            customJS.AccentButton.render(row, {
                label: cfg.defaultsLabel,
                onClick: () => app.workspace.openLinkText(cfg.defaultsPath, "")
            });
        }
    }

    _renderEntityContext(root, mode, page) {
        const row = root.createEl("div", { cls: "fnav-row fnav-context" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0;";

        const subAreaConfig = {
            "entity-budget":   { hubLabel: "Budgets Hub",   hubPath: "spice/finance/budgets/Budgets.md",     sub: "budgets",   sortKey: "month",            dir: "ASC"  },
            "entity-paycheck": { hubLabel: "Paychecks Hub", hubPath: "spice/finance/paychecks/Paychecks.md", sub: "paychecks", sortKey: "pay_period_start", dir: "ASC"  },
            "entity-invoice":  { hubLabel: "Invoices Hub",  hubPath: "spice/finance/invoices/Invoices.md",   sub: "invoices",  sortKey: "month",            dir: "ASC"  },
            "entity-debt":     { hubLabel: "Debts Hub",     hubPath: "spice/finance/debts/Debts.md",         sub: "debts",     sortKey: "current_balance",  dir: "DESC" },
        };
        const cfg = subAreaConfig[mode];
        if (!cfg) return;

        // Sub-area hub button
        customJS.AccentButton.render(row, {
            label: cfg.hubLabel,
            onClick: () => app.workspace.openLinkText(cfg.hubPath, "")
        });

        // Prev / Next sibling nav
        this._renderSiblingNav(row, page, cfg.sub, cfg.sortKey, cfg.dir);
    }

    _renderSiblingNav(row, page, subArea, sortKey, dir) {
        try {
            const currentPath = page?.file?.path || "";
            const subAreaRoot = `spice/finance/${subArea}/`;
            // sub-area hub file itself, skipped from siblings:
            const hubFileBase = subArea.charAt(0).toUpperCase() + subArea.slice(1) + ".md";
            const allFiles = app.vault.getMarkdownFiles().filter((f) => {
                if (!f.path.startsWith(subAreaRoot)) return false;
                if (f.path === subAreaRoot + hubFileBase) return false;
                return true;
            });
            const siblings = allFiles.map((f) => {
                const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
                return { path: f.path, sortVal: fm[sortKey] };
            }).filter((s) => s.sortVal !== undefined && s.sortVal !== null);
            siblings.sort((a, b) => {
                const av = String(a.sortVal);
                const bv = String(b.sortVal);
                if (av === bv) return 0;
                return dir === "DESC" ? (av > bv ? -1 : 1) : (av < bv ? -1 : 1);
            });
            const idx = siblings.findIndex((s) => s.path === currentPath);
            if (idx === -1) return;
            const prevSib = siblings[idx - 1];
            const nextSib = siblings[idx + 1];
            if (prevSib) {
                customJS.AccentButton.render(row, {
                    label: "← Prev",
                    onClick: () => app.workspace.openLinkText(prevSib.path, "")
                });
            }
            if (nextSib) {
                customJS.AccentButton.render(row, {
                    label: "Next →",
                    onClick: () => app.workspace.openLinkText(nextSib.path, "")
                });
            }
        } catch (_e) { /* fail-soft — sibling nav is best-effort */ }
    }
}
