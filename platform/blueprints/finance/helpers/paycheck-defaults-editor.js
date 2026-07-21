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
        const hDeposit = colHeader.createEl("div");
        hDeposit.textContent = "Check";
        hDeposit.style.cssText = "flex: 0.5; text-align: center; min-width: 0;";
        const hUrl = colHeader.createEl("div");
        hUrl.textContent = "URL";
        hUrl.style.cssText = "flex: 0.5; text-align: center; min-width: 0;";
        const hDel = colHeader.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));
        if (expenses.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No expenses yet. Click + Add Expense.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
        }
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

            const depositCell = row.createEl("span");
            const depN = Math.trunc(Number(expense?.deposit));
            depositCell.textContent = "#" + String((isFinite(depN) && depN >= 1) ? depN : 1);
            depositCell.style.cssText = "flex: 0.5; text-align: center; font-size: 0.9em; font-variant-numeric: tabular-nums; color: var(--text-muted);";

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

        // ---- Deposit schedule section ----
        // deposit_schedule[] = { day, amount } — the check calendar new months
        // materialize their deposits[] from. Fall back to a default 2-check
        // schedule when the note lacks the field so the section always renders.
        const schedule = Array.isArray(page.deposit_schedule) && page.deposit_schedule.length
            ? page.deposit_schedule.slice()
            : [{ day: 1, amount: 0 }, { day: 15, amount: 0 }];
        this._renderScheduleSection(root, dv, file, schedule, fmt);
    }

    _renderScheduleSection(root, dv, file, schedule, fmt) {
        const section = root.createEl("div", { cls: "pde-schedule" });
        section.style.cssText = "margin-top: 20px;";

        const headerRow = section.createEl("div");
        headerRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;";
        const label = headerRow.createEl("div");
        label.textContent = "DEPOSIT SCHEDULE (checks per month)";
        label.style.cssText = "font-size: 0.78em; font-weight: 600; color: var(--text-muted); letter-spacing: 0.04em;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        customJS.AccentButton.render(headerRow, {
            label: "Add Deposit",
            icon: plusIcon,
            onClick: () => this._scheduleAddFlow(file, dv)
        });

        const colHeader = section.createEl("div");
        colHeader.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 4px;";
        const hDay = colHeader.createEl("div");
        hDay.textContent = "Day";
        hDay.style.cssText = "flex: 1; min-width: 0;";
        const hAmt = colHeader.createEl("div");
        hAmt.textContent = "Amount";
        hAmt.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hDel = colHeader.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = section.createEl("div");
        schedule.forEach((entry, index) => {
            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const dayCell = row.createEl("span");
            const dayN = Math.trunc(Number(entry?.day));
            dayCell.textContent = String(isFinite(dayN) ? dayN : "");
            dayCell.style.cssText = "flex: 1; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const amtCell = row.createEl("span");
            amtCell.textContent = fmt(entry?.amount);
            amtCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const delBtn = row.createEl("button");
            delBtn.textContent = "×";
            delBtn.style.cssText = "flex: 0 0 32px; cursor: pointer; padding: 4px 8px; border-radius: 4px; border: 1px solid transparent; background: transparent; color: var(--text-muted); font-size: 1em;";
            delBtn.onclick = (e) => {
                e.stopPropagation();
                this._scheduleDeleteFlow(file, dv, index, entry);
            };

            row.onclick = () => this._scheduleEditFlow(file, dv, index, entry);
        });
    }

    // Small modal for a deposit-schedule row: { day (1..31), amount }.
    _promptForScheduleRow(initial) {
        return new Promise((resolve) => {
            const sauceModal = (typeof globalThis !== "undefined" && globalThis.customJS)
                ? globalThis.customJS.SauceModal : null;
            if (!sauceModal || typeof sauceModal.open !== "function") {
                resolve(null);
                return;
            }

            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            let dayInput;
            let amountInput;
            let status;

            const validate = () => {
                const d = Math.trunc(Number(dayInput.value));
                if (!isFinite(d) || d < 1 || d > 31) return "Day must be 1–31.";
                const a = Number(amountInput.value);
                if (Number.isNaN(a) || a < 0) return "Amount must be >= 0.";
                return null;
            };

            const handle = sauceModal.open({
                doc: document,
                title: initial ? "Edit Deposit" : "Add Deposit",
                autofocus: !initial,
                body: (body) => {
                    const mkField = (labelText, control) => {
                        const wrap = document.createElement("div");
                        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                        const lab = document.createElement("label");
                        lab.textContent = labelText;
                        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                        wrap.appendChild(lab);
                        control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                        wrap.appendChild(control);
                        body.appendChild(wrap);
                    };

                    dayInput = document.createElement("input");
                    dayInput.type = "number";
                    dayInput.step = "1";
                    dayInput.min = "1";
                    dayInput.max = "31";
                    mkField("Day", dayInput);

                    amountInput = document.createElement("input");
                    amountInput.type = "number";
                    amountInput.step = "0.01";
                    amountInput.min = "0";
                    mkField("Amount", amountInput);

                    if (initial) {
                        dayInput.value = String(initial.day ?? 1);
                        amountInput.value = String(initial.amount ?? 0);
                    } else {
                        dayInput.value = "1";
                        amountInput.value = "0";
                    }

                    status = document.createElement("div");
                    status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em;";
                    body.appendChild(status);
                    const refresh = () => { status.textContent = validate() || ""; };
                    dayInput.addEventListener("input", refresh);
                    amountInput.addEventListener("input", refresh);
                },
                onSubmit: () => {
                    if (!dayInput || !amountInput || !status) return false;
                    const err = validate();
                    if (err) { status.textContent = err; return false; }
                    done({ day: Math.trunc(Number(dayInput.value)), amount: Number(amountInput.value) });
                    return true;
                },
                onClose: () => done(null),
                buttons: [
                    { label: "Cancel", action: "cancel" },
                    { label: "Save", action: "submit", tone: "accent" }
                ]
            });
            if (!handle) done(null);
        });
    }

    async _scheduleAddFlow(file, dv) {
        const result = await this._promptForScheduleRow(null);
        if (!result) return;
        await this._mutate(file, (fm) => {
            fm.deposit_schedule = (Array.isArray(fm.deposit_schedule) ? fm.deposit_schedule : []).concat([result]);
        });
        await this.render(dv);
    }

    async _scheduleEditFlow(file, dv, index, current) {
        const result = await this._promptForScheduleRow(current);
        if (!result) return;
        await this._mutate(file, (fm) => {
            const list = (Array.isArray(fm.deposit_schedule) ? fm.deposit_schedule : []).slice();
            // Merge onto the current row so no stray fields are dropped.
            list[index] = Object.assign({}, list[index] || current, result);
            fm.deposit_schedule = list;
        });
        await this.render(dv);
    }

    async _scheduleDeleteFlow(file, dv, index, current) {
        if (!window.confirm(`Delete deposit on day ${current?.day ?? ""}?`)) return;
        await this._mutate(file, (fm) => {
            const list = (Array.isArray(fm.deposit_schedule) ? fm.deposit_schedule : []).slice();
            list.splice(index, 1);
            fm.deposit_schedule = list;
        });
        await this.render(dv);
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
            const sauceModal = (typeof globalThis !== "undefined" && globalThis.customJS)
                ? globalThis.customJS.SauceModal : null;
            if (!sauceModal || typeof sauceModal.open !== "function") {
                resolve(null);
                return;
            }

            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            let itemInput;
            let amountInput;
            let categoryInput;
            let urlInput;
            let depositInput;
            let status;

            const validate = () => {
                if (!itemInput.value.trim()) return "Item required.";
                const a = Number(amountInput.value);
                if (Number.isNaN(a) || a < 0) return "Amount must be >= 0.";
                return null;
            };

            const handle = sauceModal.open({
                doc: document,
                title: initial ? "Edit Expense" : "Add Expense",
                autofocus: !initial,
                body: (body) => {
                    const mkField = (labelText, control) => {
                        const wrap = document.createElement("div");
                        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                        const lab = document.createElement("label");
                        lab.textContent = labelText;
                        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                        wrap.appendChild(lab);
                        control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                        wrap.appendChild(control);
                        body.appendChild(wrap);
                    };

                    itemInput = document.createElement("input");
                    itemInput.type = "text";
                    mkField("Item", itemInput);

                    amountInput = document.createElement("input");
                    amountInput.type = "number";
                    amountInput.step = "0.01";
                    amountInput.min = "0";
                    mkField("Amount", amountInput);

                    categoryInput = document.createElement("input");
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
                    body.appendChild(datalist);

                    urlInput = document.createElement("input");
                    urlInput.type = "text";
                    urlInput.placeholder = "(optional)";
                    mkField("URL", urlInput);

                    depositInput = document.createElement("input");
                    depositInput.type = "number";
                    depositInput.step = "1";
                    depositInput.min = "1";
                    mkField("Deposit", depositInput);

                    if (initial) {
                        itemInput.value = initial.item || "";
                        amountInput.value = String(initial.amount ?? 0);
                        categoryInput.value = initial.category || "";
                        urlInput.value = initial.url || "";
                        depositInput.value = String((Number(initial.deposit) >= 1 ? Math.trunc(Number(initial.deposit)) : 1));
                    } else {
                        amountInput.value = "0";
                        depositInput.value = "1";
                    }

                    status = document.createElement("div");
                    status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em;";
                    body.appendChild(status);
                    const refresh = () => { status.textContent = validate() || ""; };
                    itemInput.addEventListener("input", refresh);
                    amountInput.addEventListener("input", refresh);
                },
                onSubmit: () => {
                    if (!itemInput || !amountInput || !categoryInput || !urlInput || !depositInput || !status) return false;
                    const err = validate();
                    if (err) { status.textContent = err; return false; }
                    const depN = Math.trunc(Number(depositInput.value));
                    done({
                        item: itemInput.value.trim(),
                        amount: Number(amountInput.value),
                        category: categoryInput.value.trim(),
                        url: urlInput.value.trim(),
                        deposit: (isFinite(depN) && depN >= 1) ? depN : 1
                    });
                    return true;
                },
                onClose: () => done(null),
                buttons: [
                    { label: "Cancel", action: "cancel" },
                    { label: "Save", action: "submit", tone: "accent" }
                ]
            });
            if (!handle) done(null);
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
            // Merge onto the CURRENT row (not a full replace) so installer-added
            // fields the modal doesn't surface (e.g. `debt`) survive the edit.
            list[index] = Object.assign({}, list[index] || current, result);
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
