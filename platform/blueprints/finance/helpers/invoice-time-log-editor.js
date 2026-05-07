/**
 * InvoiceTimeLogEditor — Add/Edit/Delete editor for the entries[] frontmatter
 * array on Time-Log entity pages under beacon/finance/invoices/<YYYY-MM>/.
 * Auto-computes hours per entry from start+end. Sums total_hours and
 * propagates to the sibling Invoice atlas's hours + amount (rate x hours).
 * Two-file write surface; non-atomic — surfaces a Notice if the sibling write
 * fails. All writes via customJS.FinanceFrontmatter.update. Embed-deduped per
 * v0.16.0 lesson.
 */
class InvoiceTimeLogEditor {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .itle-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        const m = page.file.path.match(/^beacon\/finance\/invoices\/(\d{4}-\d{2})\/Time-Log-/);
        if (!m) return;
        const month = m[1];
        const siblingInvoicePath = `beacon/finance/invoices/${month}/Invoice-${month}.md`;

        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;
        const entries = Array.isArray(page.entries) ? page.entries : [];

        const root = dv.container.createEl("div", { cls: "itle-root" });
        root.style.cssText = "margin: 8px 0;";

        const actionRow = root.createEl("div");
        actionRow.style.cssText = "margin-bottom: 8px;";
        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        const addBtn = customJS.AccentButton.render(actionRow, {
            label: "Add Entry",
            icon: plusIcon,
            onClick: () => this._addFlow(file, dv, entries, siblingInvoicePath)
        });

        const header = root.createEl("div");
        header.style.cssText = "display: flex; gap: 8px; padding: 6px 0; font-size: 0.78em; color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); margin-top: 8px; flex-wrap: wrap;";
        const hDate = header.createEl("div");
        hDate.textContent = "Date";
        hDate.style.cssText = "flex: 0 0 110px; min-width: 0;";
        const hStart = header.createEl("div");
        hStart.textContent = "Start";
        hStart.style.cssText = "flex: 0 0 60px; text-align: center;";
        const hEnd = header.createEl("div");
        hEnd.textContent = "End";
        hEnd.style.cssText = "flex: 0 0 60px; text-align: center;";
        const hHours = header.createEl("div");
        hHours.textContent = "Hours";
        hHours.style.cssText = "flex: 0 0 60px; text-align: right; min-width: 0;";
        const hDesc = header.createEl("div");
        hDesc.textContent = "Description";
        hDesc.style.cssText = "flex: 1; min-width: 0;";
        const hDel = header.createEl("div");
        hDel.textContent = "";
        hDel.style.cssText = "flex: 0 0 32px;";

        const rows = root.createEl("div");
        if (entries.length === 0) {
            const empty = rows.createEl("div");
            empty.textContent = "No entries yet. Click + Add.";
            empty.style.cssText = "font-size: 0.85em; color: var(--text-muted); padding: 12px 0; text-align: center;";
            return;
        }

        const fmt = (v) => (typeof v === "number" ? v.toFixed(2) : (v || ""));

        entries.forEach((entry, index) => {
            const row = rows.createEl("div");
            row.style.cssText = "display: flex; gap: 8px; padding: 8px 0; cursor: pointer; border-bottom: 1px solid var(--background-modifier-border); align-items: center; flex-wrap: wrap;";

            const dateCell = row.createEl("span");
            dateCell.textContent = entry?.date || "";
            dateCell.style.cssText = "flex: 0 0 110px; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const startCell = row.createEl("span");
            startCell.textContent = entry?.start || "";
            startCell.style.cssText = "flex: 0 0 60px; text-align: center; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const endCell = row.createEl("span");
            endCell.textContent = entry?.end || "";
            endCell.style.cssText = "flex: 0 0 60px; text-align: center; font-size: 0.9em; font-variant-numeric: tabular-nums;";

            const hoursCell = row.createEl("span");
            hoursCell.textContent = fmt(entry?.hours);
            hoursCell.style.cssText = "flex: 0 0 60px; text-align: right; font-size: 0.9em; font-variant-numeric: tabular-nums; min-width: 0;";

            const descCell = row.createEl("span");
            descCell.textContent = entry?.description || "";
            descCell.style.cssText = "flex: 1; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

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
                this._deleteFlow(file, dv, entries, siblingInvoicePath, index, entry);
            };

            row.onclick = () => this._editFlow(file, dv, entries, siblingInvoicePath, index, entry);
        });

        const total = Math.round(entries.reduce((s, e) => s + (Number(e?.hours) || 0), 0) * 100) / 100;
        const summary = root.createEl("div");
        summary.style.cssText = "display: flex; justify-content: flex-end; padding: 12px 0; font-weight: 600;";
        summary.textContent = `Total Hours: ${total}`;
    }

    _promptForEntry(initial) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 90vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = initial ? "Edit Time Entry" : "Add Time Entry";
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
                input.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
                wrap.appendChild(input);
                dialog.appendChild(wrap);
                return input;
            };

            const mkDisplayField = (labelText) => {
                const wrap = document.createElement("div");
                wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
                const lab = document.createElement("label");
                lab.textContent = labelText;
                lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
                wrap.appendChild(lab);
                const display = document.createElement("div");
                display.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-muted); font-size: 1em; box-sizing: border-box; font-variant-numeric: tabular-nums;";
                display.textContent = "—";
                wrap.appendChild(display);
                dialog.appendChild(wrap);
                return display;
            };

            const dateInput = mkField("Date", "date");
            const startInput = mkField("Start", "time");
            const endInput = mkField("End", "time");
            const hoursDisplay = mkDisplayField("Hours");
            const descriptionInput = mkField("Description", "text");

            const computeHours = () => {
                const s = startInput.value;
                const e = endInput.value;
                if (!s || !e) return null;
                const [sh, sm] = s.split(":").map(Number);
                const [eh, em] = e.split(":").map(Number);
                if ([sh, sm, eh, em].some(Number.isNaN)) return null;
                const minutes = (eh * 60 + em) - (sh * 60 + sm);
                if (minutes <= 0) return null;
                return Math.round((minutes / 60) * 100) / 100;
            };

            const refreshHours = () => {
                const h = computeHours();
                hoursDisplay.textContent = h == null ? "—" : String(h);
            };

            if (initial) {
                dateInput.value = initial.date || "";
                startInput.value = initial.start || "";
                endInput.value = initial.end || "";
                descriptionInput.value = initial.description || "";
            }
            refreshHours();

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!dateInput.value) return "Date required.";
                if (!startInput.value) return "Start time required.";
                if (!endInput.value) return "End time required.";
                if (computeHours() === null) return "End must be after start.";
                return null;
            };

            const refreshStatus = () => {
                const err = validate();
                status.textContent = err || "";
            };
            dateInput.addEventListener("input", refreshStatus);
            startInput.addEventListener("input", () => { refreshHours(); refreshStatus(); });
            endInput.addEventListener("input", () => { refreshHours(); refreshStatus(); });
            descriptionInput.addEventListener("input", refreshStatus);

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
                const hours = computeHours();
                document.body.removeChild(overlay);
                resolve({
                    date: dateInput.value,
                    start: startInput.value,
                    end: endInput.value,
                    hours: hours,
                    description: descriptionInput.value.trim()
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            dateInput.addEventListener("keydown", onKey);
            startInput.addEventListener("keydown", onKey);
            endInput.addEventListener("keydown", onKey);
            descriptionInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => dateInput.focus(), 0);
        });
    }

    async _propagateAfterMutation(file, dv, newEntries, siblingInvoicePath) {
        const total_hours = Math.round(newEntries.reduce((s, e) => s + (Number(e?.hours) || 0), 0) * 100) / 100;
        await customJS.FinanceFrontmatter.update(file, (fm) => {
            fm.entries = newEntries;
            fm.total_hours = total_hours;
        });
        try {
            const invoiceFile = app.vault.getAbstractFileByPath(siblingInvoicePath);
            if (!invoiceFile) {
                new Notice(`InvoiceTimeLogEditor: sibling Invoice file ${siblingInvoicePath} missing; total_hours saved on Time-Log only.`);
                return;
            }
            await customJS.FinanceFrontmatter.update(invoiceFile, (fm) => {
                const rate = Number(fm.rate || 0);
                fm.hours = total_hours;
                fm.amount = Math.round(rate * total_hours * 100) / 100;
            });
        } catch (err) {
            new Notice(`InvoiceTimeLogEditor: sibling Invoice write failed for ${siblingInvoicePath}: ${err.message || err}`);
        }
    }

    async _addFlow(file, dv, entries, siblingInvoicePath) {
        const result = await this._promptForEntry(null);
        if (!result) return;
        const newEntries = entries.concat([result]);
        await this._propagateAfterMutation(file, dv, newEntries, siblingInvoicePath);
        await this.render(dv);
    }

    async _editFlow(file, dv, entries, siblingInvoicePath, index, current) {
        const result = await this._promptForEntry(current);
        if (!result) return;
        const newEntries = entries.slice();
        newEntries[index] = result;
        await this._propagateAfterMutation(file, dv, newEntries, siblingInvoicePath);
        await this.render(dv);
    }

    async _deleteFlow(file, dv, entries, siblingInvoicePath, index, current) {
        if (!window.confirm(`Delete entry from '${current?.date || ""}'?`)) return;
        const newEntries = entries.slice();
        newEntries.splice(index, 1);
        await this._propagateAfterMutation(file, dv, newEntries, siblingInvoicePath);
        await this.render(dv);
    }
}
