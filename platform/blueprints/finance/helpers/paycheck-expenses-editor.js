/**
 * PaycheckExpensesEditor — Add/Edit/Delete editor for the expenses[] frontmatter
 * array on Paycheck atlas pages. Hybrid UX: read-only rows + Add modal +
 * click-row-to-edit modal + per-row × delete. Fields: item + amount + category +
 * paid (boolean stored as JS true/false) + optional URL. All writes via
 * customJS.FinanceFrontmatter.update. Embed-deduped per v0.16.0 lesson.
 */
class PaycheckExpensesEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .pee-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;
        const expenses = Array.isArray(page.expenses) ? page.expenses : [];

        const root = dv.container.createEl("div", { cls: "pee-root" });
        root.style.cssText = "margin: 8px 0;";

        const actionRow = root.createEl("div");
        actionRow.style.cssText = "margin-bottom: 8px;";
        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        const addBtn = customJS.AccentButton.render(actionRow, {
            label: "Add Expense",
            icon: plusIcon,
            onClick: () => this._addFlow(file, dv)
        });

        const header = root.createEl("div");
        header.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 8px;";
        const hItem = header.createEl("div");
        hItem.textContent = "Item";
        hItem.style.cssText = "flex: 2; min-width: 0;";
        const hAmount = header.createEl("div");
        hAmount.textContent = "Amount";
        hAmount.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hCategory = header.createEl("div");
        hCategory.textContent = "Category";
        hCategory.style.cssText = "flex: 1; min-width: 0;";
        const hPaid = header.createEl("div");
        hPaid.textContent = "Paid";
        hPaid.style.cssText = "flex: 0 0 48px; text-align: center;";
        const hUrl = header.createEl("div");
        hUrl.textContent = "URL";
        hUrl.style.cssText = "flex: 0 0 48px; text-align: center;";
        const hDel = header.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        if (expenses.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No expenses yet. Click + Add.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));
        const isPaid = (e) => {
            if (!e) return false;
            const v = e.paid;
            if (v === true) return true;
            if (typeof v === "string" && v.toLowerCase() === "true") return true;
            return false;
        };

        expenses.forEach((exp, index) => {
            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const itemCell = row.createEl("span");
            itemCell.textContent = exp?.item || "";
            itemCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const amountCell = row.createEl("span");
            amountCell.textContent = fmt(exp?.amount);
            amountCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

            const categoryCell = row.createEl("span");
            categoryCell.textContent = exp?.category || "";
            categoryCell.style.cssText = "flex: 1; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const paidCell = row.createEl("span");
            const paid = isPaid(exp);
            paidCell.textContent = paid ? "✓" : "○";
            paidCell.style.cssText = "flex: 0 0 48px; text-align: center; font-size: 1.1em;";
            paidCell.style.color = paid ? "var(--text-success, #16a34a)" : "var(--text-muted)";

            const urlCell = row.createEl("span");
            urlCell.style.cssText = "flex: 0 0 48px; text-align: center; font-size: 0.85em;";
            if (exp?.url && typeof exp.url === "string" && exp.url.trim()) {
                const link = urlCell.createEl("a");
                link.textContent = "↗";
                link.href = exp.url;
                link.target = "_blank";
                link.style.cssText = "color: var(--text-accent); text-decoration: none;";
                link.onclick = (e) => { e.stopPropagation(); };
            }

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
                this._deleteFlow(file, dv, index, exp);
            };

            row.onclick = () => this._editFlow(file, dv, index, exp);
        });
    }

    _promptForExpense(initial) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Expense" : "Add Expense";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const mkField = (labelText, type) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                const input = document.createElement("input");
                input.type = type;
                if (type === "number") {
                    input.step = "0.01";
                    input.min = "0";
                }
                input.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                wrap.appendChild(input);
                dialog.appendChild(wrap);
                return input;
            };

            const mkCheckboxField = (labelText) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                const input = document.createElement("input");
                input.type = "checkbox";
                input.style.cssText = "flex: 0 0 auto; width: 18px; height: 18px;";
                wrap.appendChild(input);
                dialog.appendChild(wrap);
                return { wrap, input };
            };

            const itemInput = mkField("Item", "text");
            const amountInput = mkField("Amount", "number");
            const categoryInput = mkField("Category", "text");
            const paidField = mkCheckboxField("Paid");
            const paidInput = paidField.input;
            const urlInput = mkField("URL", "text");

            if (initial) {
                itemInput.value = initial.item || "";
                amountInput.value = String(initial.amount ?? 0);
                categoryInput.value = initial.category || "";
                paidInput.checked = (initial.paid === true || (typeof initial.paid === "string" && initial.paid.toLowerCase() === "true"));
                urlInput.value = initial.url || "";
            } else {
                amountInput.value = "0";
                paidInput.checked = false;
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!itemInput.value.trim()) return "Item required.";
                const a = amountInput.value;
                if (Number.isNaN(Number(a)) || Number(a) < 0) return "Amount must be >= 0.";
                if (urlInput.value && !/^https?:\/\//.test(urlInput.value)) return "URL must start with http:// or https:// (or leave empty).";
                return null;
            };

            const refreshStatus = () => {
                const err = validate();
                status.textContent = err || "";
            };
            itemInput.addEventListener("input", refreshStatus);
            amountInput.addEventListener("input", refreshStatus);
            categoryInput.addEventListener("input", refreshStatus);
            urlInput.addEventListener("input", refreshStatus);

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
                    paid: paidInput.checked,
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
        if (!window.confirm(`Delete expense '${current?.item || ""}'?`)) return;
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
