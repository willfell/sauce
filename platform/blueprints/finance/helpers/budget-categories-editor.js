/**
 * BudgetCategoriesEditor — Add/Edit/Delete editor for the categories[] frontmatter
 * array on Budget atlas pages. Hybrid UX: read-only rows + Add modal +
 * click-row-to-edit modal + per-row × delete. All writes via
 * customJS.FinanceFrontmatter.update (Obsidian's processFrontMatter under the
 * hood). Embed-deduped per v0.16.0 lesson.
 */
class BudgetCategoriesEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .bce-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;
        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;
        const categories = Array.isArray(page.categories) ? page.categories : [];

        const root = dv.container.createEl("div", { cls: "bce-root" });
        root.style.cssText = "margin: 8px 0;";

        const actionRow = root.createEl("div");
        actionRow.style.cssText = "margin-bottom: 8px;";
        const addBtn = actionRow.createEl("button");
        addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg><span>Add Category</span>`;
        addBtn.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease;";
        addBtn.onmouseenter = () => { addBtn.style.background = "var(--interactive-accent)"; addBtn.style.color = "var(--text-on-accent)"; };
        addBtn.onmouseleave = () => { addBtn.style.background = "var(--background-primary)"; addBtn.style.color = "var(--interactive-accent)"; };
        addBtn.onclick = () => this._addFlow(file, dv);

        const header = root.createEl("div");
        header.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 8px;";
        const hName = header.createEl("div");
        hName.textContent = "Name";
        hName.style.cssText = "flex: 2; min-width: 0;";
        const hPlanned = header.createEl("div");
        hPlanned.textContent = "Planned";
        hPlanned.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hActual = header.createEl("div");
        hActual.textContent = "Actual";
        hActual.style.cssText = "flex: 1; text-align: right; min-width: 0;";
        const hDel = header.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        if (categories.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No categories yet. Click + Add.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));
        categories.forEach((cat, index) => {
            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center;";

            const nameCell = row.createEl("span");
            nameCell.textContent = cat?.name || "";
            nameCell.style.cssText = "flex: 2; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const plannedCell = row.createEl("span");
            plannedCell.textContent = fmt(cat?.planned);
            plannedCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

            const actualCell = row.createEl("span");
            actualCell.textContent = fmt(cat?.actual);
            actualCell.style.cssText = "flex: 1; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

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
                this._deleteFlow(file, dv, index, cat);
            };

            row.onclick = () => this._editFlow(file, dv, index, cat);
        });
    }

    _promptForCategory(initial) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Category" : "Add Category";
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

            const nameInput = mkField("Name", "text");
            const plannedInput = mkField("Planned", "number");
            const actualInput = mkField("Actual", "number");

            if (initial) {
                nameInput.value = initial.name || "";
                plannedInput.value = String(initial.planned ?? 0);
                actualInput.value = String(initial.actual ?? 0);
            } else {
                plannedInput.value = "0";
                actualInput.value = "0";
            }

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                const n = nameInput.value;
                const p = plannedInput.value;
                const a = actualInput.value;
                if (!n.trim()) return "Name required.";
                if (Number.isNaN(Number(p)) || Number(p) < 0) return "Planned must be >= 0.";
                if (Number.isNaN(Number(a)) || Number(a) < 0) return "Actual must be >= 0.";
                return null;
            };

            const refreshStatus = () => {
                const err = validate();
                status.textContent = err || "";
            };
            nameInput.addEventListener("input", refreshStatus);
            plannedInput.addEventListener("input", refreshStatus);
            actualInput.addEventListener("input", refreshStatus);

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
                    name: nameInput.value.trim(),
                    planned: Number(plannedInput.value),
                    actual: Number(actualInput.value)
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            nameInput.addEventListener("keydown", onKey);
            plannedInput.addEventListener("keydown", onKey);
            actualInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    async _addFlow(file, dv) {
        const result = await this._promptForCategory(null);
        if (!result) return;
        await this._mutate(file, (fm) => {
            fm.categories = (fm.categories || []).concat([result]);
        });
        await this.render(dv);
    }

    async _editFlow(file, dv, index, current) {
        const result = await this._promptForCategory(current);
        if (!result) return;
        await this._mutate(file, (fm) => {
            const list = (fm.categories || []).slice();
            list[index] = result;
            fm.categories = list;
        });
        await this.render(dv);
    }

    async _deleteFlow(file, dv, index, current) {
        if (!window.confirm(`Delete category '${current?.name || ""}'?`)) return;
        await this._mutate(file, (fm) => {
            const list = (fm.categories || []).slice();
            list.splice(index, 1);
            fm.categories = list;
        });
        await this.render(dv);
    }

    async _mutate(file, mutator) {
        return await customJS.FinanceFrontmatter.update(file, mutator);
    }
}
