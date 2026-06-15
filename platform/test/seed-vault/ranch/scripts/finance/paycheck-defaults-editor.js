/**
 * PaycheckDefaultsEditor — Flat-list editor for spice/finance/Paycheck Defaults.md.
 *
 * Owns the per-vault seed list consumed by entity-create's seed_from_defaults
 * resolver when the user clicks "+ New Paycheck". Each expense carries
 * {item, amount, category, url}. The Category input in the modal autocompletes
 * via <datalist> populated from Budget Defaults.md's category names — free
 * text still accepted (suggestions only). Falls back gracefully if Budget
 * Defaults is missing.
 *
 * Note: the `paid` field is NOT managed here. Defaults always represent unpaid
 * templates; entity-create's per_item_set adds `paid: false` at copy time.
 *
 * All writes via customJS.FinanceFrontmatter.update. Embed-deduped.
 */
class PaycheckDefaultsEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pde-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const expenses = Array.isArray(page.expenses) ? page.expenses.slice() : [];

        const root = dv.container.createEl("div", { cls: "pde-root" });
        root.style.cssText = "margin: 8px 0;";

        const headerRow = root.createEl("div");
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";

        const label = headerRow.createEl("div");
        label.textContent = "EXPENSES (seed list for new paychecks)";
        label.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(headerRow, {
            label: "Add Expense",
            icon: plusIcon,
            onClick: () => this._addFlow(file, dv)
        });

        const colHeader = root.createEl("div");
        colHeader.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 4px;";
        const hItem = colHeader.createEl("div");
        hItem.textContent = "Item";
        hItem.style.cssText = "flex: 2; min-width: 0;";
        const hAmount = colHeader.createEl("div");
        hAmount.textContent = "Amount";
        hAmount.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hCategory = colHeader.createEl("div");
        hCategory.textContent = "Category";
        hCategory.style.cssText = "flex: 1.5; min-width: 0;";
        const hUrl = colHeader.createEl("div");
        hUrl.textContent = "URL";
        hUrl.style.cssText = "flex: 0.5; text-align: center; min-width: 0;";
        const hDel = colHeader.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        if (expenses.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No expenses yet. Click + Add Expense.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));
        expenses.forEach((expense, index) => {
            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const itemCell = row.createEl("span");
            itemCell.textContent = expense?.item || "";
            itemCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const amountCell = row.createEl("span");
            amountCell.textContent = fmt(expense?.amount);
            amountCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const categoryCell = row.createEl("span");
            categoryCell.textContent = expense?.category || "";
            categoryCell.style.cssText = "flex: 1.5; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted);";

            const urlCell = row.createEl("span");
            urlCell.textContent = expense?.url ? "↗" : "";
            urlCell.style.cssText = "flex: 0.5; text-align: center; font-size: 0.9em; color: var(--text-accent);";

            const delBtn = row.createEl("button");
            delBtn.textContent = "×";
            delBtn.style.cssText = "flex: 0 0 32px; cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-size: 1em;";
            delBtn.addEventListener("mouseenter", () => {
                delBtn.style.background = "var(--background-modifier-hover)";
                delBtn.style.color = "var(--text-error)";
            });
            delBtn.addEventListener("mouseleave", () => {
                delBtn.style.background = "transparent";
                delBtn.style.color = "var(--text-muted)";
            });
            delBtn.onclick = (e) => {
                e.stopPropagation();
                this._deleteFlow(file, dv, index, expense);
            };

            row.onclick = () => this._editFlow(file, dv, index, expense);
        });
    }

    // Reads Budget Defaults.md's categories[].name list for the modal datalist.
    // Returns [] when the file is missing or has no categories — falls back to
    // plain free-text input in the modal.
    _readBudgetDefaultCategoryNames() {
        const path = "spice/finance/Budget Defaults.md";
        const file = app.vault.getAbstractFileByPath(path);
        if (!file) return [];
        const fm = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm || !Array.isArray(fm.categories)) return [];
        const names = new Set();
        for (const c of fm.categories) {
            if (c && typeof c === "object" && c.name) names.add(String(c.name));
        }
        return Array.from(names).sort();
    }

    _promptForExpense(initial) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Expense" : "Add Expense";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const mkField = (labelText, control) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                wrap.appendChild(control);
                dialog.appendChild(wrap);
            };

            const itemInput = document.createElement("input");
            itemInput.type = "text";
            mkField("Item", itemInput);

            const amountInput = document.createElement("input");
            amountInput.type = "number";
            amountInput.step = "0.01";
            amountInput.min = "0";
            mkField("Amount", amountInput);

            // Category with <datalist> autocomplete from Budget Defaults.md.
            const categoryInput = document.createElement("input");
            categoryInput.type = "text";
            const dlId = `pde-categories-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            categoryInput.setAttribute("list", dlId);
            const datalist = document.createElement("datalist");
            datalist.id = dlId;
            for (const name of this._readBudgetDefaultCategoryNames()) {
                const opt = document.createElement("option");
                opt.value = name;
                datalist.appendChild(opt);
            }
            mkField("Category", categoryInput);
            // datalist must live in the DOM but is invisible — append to dialog.
            dialog.appendChild(datalist);

            const urlInput = document.createElement("input");
            urlInput.type = "text";
            urlInput.placeholder = "(optional)";
            mkField("URL", urlInput);

            if (initial) {
                itemInput.value = initial.item || "";
                amountInput.value = String(initial.amount ?? 0);
                categoryInput.value = initial.category || "";
                urlInput.value = initial.url || "";
            } else {
                amountInput.value = "0";
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!itemInput.value.trim()) return "Item required.";
                const a = Number(amountInput.value);
                if (Number.isNaN(a) || a < 0) return "Amount must be >= 0.";
                return null;
            };
            const refresh = () => { status.textContent = validate() || ""; };
            itemInput.addEventListener("input", refresh);
            amountInput.addEventListener("input", refresh);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Save";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const err = validate();
                if (err) { status.textContent = err; return; }
                document.body.removeChild(overlay);
                resolve({
                    item: itemInput.value.trim(),
                    amount: Number(amountInput.value),
                    category: categoryInput.value.trim(),
                    url: urlInput.value.trim()
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            itemInput.addEventListener("keydown", onKey);
            amountInput.addEventListener("keydown", onKey);
            categoryInput.addEventListener("keydown", onKey);
            urlInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => itemInput.focus(), 0);
        });
    }

    async _addFlow(file, dv) {
        const result = await this._promptForExpense(null);
        if (!result) return;
        await this._mutate(file, (fm) => {
            fm.expenses = (fm.expenses || []).concat([result]);
        });
        await this.render(dv);
    }

    async _editFlow(file, dv, index, current) {
        const result = await this._promptForExpense(current);
        if (!result) return;
        await this._mutate(file, (fm) => {
            const list = (fm.expenses || []).slice();
            list[index] = result;
            fm.expenses = list;
        });
        await this.render(dv);
    }

    async _deleteFlow(file, dv, index, current) {
        if (!window.confirm(`Delete expense "${current?.item || ""}"?`)) return;
        await this._mutate(file, (fm) => {
            const list = (fm.expenses || []).slice();
            list.splice(index, 1);
            fm.expenses = list;
        });
        await this.render(dv);
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }
}
