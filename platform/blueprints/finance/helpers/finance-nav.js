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

        // FinanceChromeBar (v0.204.0+) already renders a Go▾ launcher listing
        // all 7 hubs — the cross-hub button row (Section 1) and the single
        // "<X> Hub" back-buttons in entity/defaults context (Section 2) are
        // now redundant on chrome-bar-migrated notes. Skip them there;
        // fall back to full legacy rendering when the chrome bar is absent
        // (unmigrated note) so nav isn't lost. Mirrors the PersonNavButtons /
        // ReaderArticleActions guard precedent.
        const chromePresent = !!(dv.container.closest && dv.container.closest(".markdown-preview-view")?.querySelector(".finance-chrome-root"));

        const root = dv.container.createEl("div", { cls: "fnav-root", attr: { "data-mode": mode } });

        // Section 1: top divider + cross-hub nav + divider
        if (!chromePresent) {
            this._hr(root);
            this._renderCrossHub(root, mode);
            this._hr(root);
        }

        // Section 2 (when applicable): context row + divider
        if (mode.startsWith("hub-") && mode !== "hub-finance") {
            const rendered = await this._renderHubContext(dv, root, mode, chromePresent);
            if (rendered) this._hr(root);
        } else if (mode.startsWith("entity-")) {
            this._renderEntityContext(root, mode, page, chromePresent);
            this._hr(root);
        } else if (mode.startsWith("defaults-") || mode === "config-plan") {
            const rendered = this._renderDefaultsContext(root, mode, chromePresent);
            if (rendered) this._hr(root);
        }
    }

    _renderDefaultsContext(root, mode, chromePresent) {
        // Entirely redundant with the chrome bar's Go▾ launcher once
        // migrated — this row is JUST a "back to hub" button, nothing else
        // (defaults pages have no "+ New X").
        if (chromePresent) return false;

        const row = root.createEl("div", { cls: "fnav-row fnav-context" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 4px 0;";

        const config = {
            "defaults-budget":   { hubLabel: "Budgets Hub",   hubIcon: this._icon("calculator"),  hubPath: "spice/finance/budgets/Budgets.md" },
            "defaults-paycheck": { hubLabel: "Paychecks Hub", hubIcon: this._icon("coins"),       hubPath: "spice/finance/paychecks/Paychecks.md" },
            "defaults-debt":     { hubLabel: "Debts Hub",     hubIcon: this._icon("credit-card"), hubPath: "spice/finance/debts/Debts.md" },
            "config-plan":       { hubLabel: "Finance Hub",   hubIcon: this._icon("wallet"),      hubPath: "spice/finance/Finance.md" },
        };
        const cfg = config[mode];
        if (!cfg) return false;

        customJS.AccentButton.render(row, {
            label: cfg.hubLabel,
            icon: cfg.hubIcon,
            onClick: () => app.workspace.openLinkText(cfg.hubPath, "")
        });
        return true;
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
        // v0.111.3: defaults files. Same nav as their parent hub but no "+ New X"
        // (defaults don't scaffold entities; they're config).
        if (filePath === "spice/finance/Budget Defaults.md") return "defaults-budget";
        if (filePath === "spice/finance/Paycheck Defaults.md") return "defaults-paycheck";
        if (filePath === "spice/finance/Debt Defaults.md") return "defaults-debt";
        if (filePath === "spice/finance/months/Months.md") return "hub-months";
        if (filePath === "spice/finance/savings/Savings.md") return "hub-savings";   // NEW v0.10.0
        if (filePath === "spice/finance/Finance Plan.md") return "config-plan";       // NEW v0.10.0
        if (type === "budget") return "entity-budget";
        if (type === "paycheck") return "entity-paycheck";
        if (type === "invoice") return "entity-invoice";
        if (type === "debt") return "entity-debt";
        if (type === "month") return "entity-month";
        if (type === "savings-account") return "entity-savings";   // NEW v0.10.0
        if (type === "finance-plan") return "config-plan";          // NEW v0.10.0
        return "hub-finance";
    }

    _hereKey(mode) {
        if (mode === "hub-finance") return "finance";
        if (mode === "hub-budgets" || mode === "entity-budget" || mode === "defaults-budget") return "budgets";
        if (mode === "hub-paychecks" || mode === "entity-paycheck" || mode === "defaults-paycheck") return "paychecks";
        if (mode === "hub-invoices" || mode === "entity-invoice") return "invoices";
        if (mode === "hub-debts" || mode === "entity-debt" || mode === "defaults-debt") return "debts";
        if (mode === "hub-months" || mode === "entity-month") return "months";
        if (mode === "hub-savings" || mode === "entity-savings") return "savings";   // NEW v0.10.0
        return null;
    }

    _renderCrossHub(root, mode) {
        const row = root.createEl("div", { cls: "fnav-row fnav-hubs" });
        // Centered with even gap; buttons share the row width.
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 4px 0;";

        const HUBS = [
            { key: "finance",   label: "Finance",   path: "spice/finance/Finance.md",             icon: this._icon("wallet") },
            { key: "budgets",   label: "Budgets",   path: "spice/finance/budgets/Budgets.md",     icon: this._icon("calculator") },
            { key: "paychecks", label: "Paychecks", path: "spice/finance/paychecks/Paychecks.md", icon: this._icon("coins") },
            { key: "invoices",  label: "Invoices",  path: "spice/finance/invoices/Invoices.md",   icon: this._icon("file-text") },
            { key: "debts",     label: "Debts",     path: "spice/finance/debts/Debts.md",         icon: this._icon("credit-card") },
            { key: "months",    label: "Months",    path: "spice/finance/months/Months.md",       icon: this._icon("calendar") },
            { key: "savings",   label: "Savings",   path: "spice/finance/savings/Savings.md",      icon: this._icon("piggy-bank") },
        ];

        const here = this._hereKey(mode);

        for (const hub of HUBS) {
            if (hub.key === here) continue;
            customJS.AccentButton.render(row, {
                label: hub.label,
                icon: hub.icon,
                onClick: () => app.workspace.openLinkText(hub.path, "")
            });
        }
    }

    async _renderHubContext(dv, root, mode, chromePresent) {
        const config = {
            "hub-budgets":   { instance: "budget",   defaultsLabel: "Budget Defaults",   defaultsPath: "spice/finance/Budget Defaults.md",   defaultsIcon: this._icon("settings") },
            "hub-paychecks": { instance: "paycheck", defaultsLabel: "Paycheck Defaults", defaultsPath: "spice/finance/Paycheck Defaults.md", defaultsIcon: this._icon("settings") },
            "hub-invoices":  { instance: "invoice",  defaultsLabel: null,                defaultsPath: null,                                 defaultsIcon: null },
            "hub-debts":     { instance: "debt",     defaultsLabel: "Debt Defaults",     defaultsPath: "spice/finance/Debt Defaults.md",     defaultsIcon: this._icon("settings") },
            "hub-months":    { instance: "month",    defaultsLabel: null,                defaultsPath: null,                                 defaultsIcon: null },
            "hub-savings":   { instance: "savings",  defaultsLabel: null,                defaultsPath: null,                                 defaultsIcon: null },
        };
        const cfg = config[mode];
        if (!cfg) return false;

        // + New <X> — owned by FinanceChromeBar's primary button (right of the
        // compass) once migrated; only fall back to this inline render on an
        // unmigrated note (no .finance-chrome-root present).
        const showNewButton = !chromePresent;
        const showDefaults = !!(cfg.defaultsPath && cfg.defaultsLabel);
        if (!showNewButton && !showDefaults) return false;

        const row = root.createEl("div", { cls: "fnav-row fnav-context" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 4px 0;";

        if (showNewButton) {
            // via EntityCreate (poll for cold-load race; carried from v0.110.1/0.110.3)
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
        }

        // <X> Defaults link
        if (showDefaults) {
            customJS.AccentButton.render(row, {
                label: cfg.defaultsLabel,
                icon: cfg.defaultsIcon,
                onClick: () => app.workspace.openLinkText(cfg.defaultsPath, "")
            });
        }
        return true;
    }

    _renderEntityContext(root, mode, page, chromePresent) {
        const row = root.createEl("div", { cls: "fnav-row fnav-context" });
        row.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; margin: 4px 0;";

        const subAreaConfig = {
            "entity-budget":   { hubLabel: "Budgets Hub",   hubIcon: this._icon("calculator"),  hubPath: "spice/finance/budgets/Budgets.md",     sub: "budgets",   sortKey: "month",            dir: "ASC"  },
            "entity-paycheck": { hubLabel: "Paychecks Hub", hubIcon: this._icon("coins"),       hubPath: "spice/finance/paychecks/Paychecks.md", sub: "paychecks", sortKey: "month",            dir: "ASC"  },
            "entity-invoice":  { hubLabel: "Invoices Hub",  hubIcon: this._icon("file-text"),   hubPath: "spice/finance/invoices/Invoices.md",   sub: "invoices",  sortKey: "month",            dir: "ASC"  },
            "entity-debt":     { hubLabel: "Debts Hub",     hubIcon: this._icon("credit-card"), hubPath: "spice/finance/debts/Debts.md",         sub: "debts",     sortKey: "current_balance",  dir: "DESC" },
            "entity-month":    { hubLabel: "Months Hub",    hubIcon: this._icon("calendar"),    hubPath: "spice/finance/months/Months.md",       sub: "months",    sortKey: "month",            dir: "DESC" },
            "entity-savings":  { hubLabel: "Savings Hub",   hubIcon: this._icon("piggy-bank"),  hubPath: "spice/finance/savings/Savings.md",     sub: "savings",   sortKey: "current_balance",  dir: "DESC" },
        };
        const cfg = subAreaConfig[mode];
        if (!cfg) return;

        // Sub-area hub button — redundant with the chrome bar's Go▾ launcher
        // (already lists this hub) once the note is chrome-bar-migrated.
        if (!chromePresent) {
            customJS.AccentButton.render(row, {
                label: cfg.hubLabel,
                icon: cfg.hubIcon,
                onClick: () => app.workspace.openLinkText(cfg.hubPath, "")
            });
        }

        // Prev / Next sibling nav — not covered by the chrome bar, always render.
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
                // Month-keyed entities sort by `month`; legacy paycheck notes lack
                // it, so fall back to pay_period_start (harmless for budgets/months
                // whose `month` is always present).
                let sortVal = fm[sortKey];
                if ((sortVal === undefined || sortVal === null) && sortKey === "month") sortVal = fm.pay_period_start;
                return { path: f.path, sortVal };
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
                    label: "Prev",
                    icon: this._icon("chevron-left"),
                    onClick: () => app.workspace.openLinkText(prevSib.path, "")
                });
            }
            if (nextSib) {
                customJS.AccentButton.render(row, {
                    label: "Next",
                    icon: this._icon("chevron-right"),
                    onClick: () => app.workspace.openLinkText(nextSib.path, "")
                });
            }
        } catch (_e) { /* fail-soft — sibling nav is best-effort */ }
    }

    _icon(key) {
        // Inline 14x14 SVGs (lucide-style). Returns SVG string suitable for
        // customJS.AccentButton.render's icon parameter.
        switch (key) {
            case "wallet":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';
            case "calculator":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8" y2="10"/><line x1="12" y1="10" x2="12" y2="10"/><line x1="16" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/><line x1="16" y1="18" x2="16" y2="18"/></svg>';
            case "coins":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>';
            case "file-text":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>';
            case "credit-card":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>';
            case "settings":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
            case "chevron-left":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
            case "chevron-right":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
            case "calendar":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
            case "piggy-bank":
                return '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5c-1.5 0-2.8 1.4-3 2.5S17.5 10 19 10c.5 0 .9-.1 1.3-.3.4 1.1.7 2.3.7 3.3 0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8c1.4 0 2.7.4 3.9 1"/><path d="M9 11h.01"/></svg>';
            default:
                return null;
        }
    }
}
