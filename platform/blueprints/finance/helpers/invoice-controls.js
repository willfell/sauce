/**
 * InvoiceControls — Invoice atlas combined widget. Renders a summary strip
 * (Month / Hours / Amount) + a controls row (Rate input + Save + Mark/Unmark
 * Submitted toggle). Replaces the legacy Month/Rate/Hours/Amount markdown
 * table on the Invoice atlas. submitted_date set to today via window.moment
 * when toggling on; cleared when toggling off. Embed-deduped per v0.16.0
 * lesson. All writes via customJS.FinanceFrontmatter.update. Note: when rate
 * changes, the Invoice atlas's amount is NOT proactively recomputed; it
 * updates on the next Time-Log edit (rate x hours).
 */
class InvoiceControls {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .ic-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        const m = page.file.path.match(/^beacon\/finance\/invoices\/(\d{4}-\d{2})\/Invoice-/);
        if (!m) return;
        const month = m[1];

        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const rate = Number(page.rate || 0);
        const hours = Number(page.hours || 0);
        const amount = Number(page.amount || 0);
        const submitted = !!page.submitted_date;
        const submittedDate = page.submitted_date || "";

        const formatDate = (val) => {
            try {
                if (customJS.FinanceStatus && typeof customJS.FinanceStatus.formatDate === "function") {
                    return customJS.FinanceStatus.formatDate(val, "YYYY-MM-DD");
                }
            } catch (_) {}
            return String(val || "");
        };

        const root = dv.container.createEl("div", { cls: "ic-root" });
        root.style.cssText = "margin: 12px 0; display: flex; flex-direction: column; gap: 12px;";

        const summaryRow = root.createEl("div");
        summaryRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px;";

        const summaryItems = [
            { label: "Month",  value: month },
            { label: "Hours",  value: `${hours}h` },
            { label: "Amount", value: `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: "Submitted", value: submitted ? formatDate(submittedDate) : "—" }
        ];

        for (const item of summaryItems) {
            const cell = summaryRow.createEl("div");
            cell.style.cssText = "display: flex; flex-direction: column; gap: 2px; min-width: 80px; flex: 1;";
            const lbl = cell.createEl("span");
            lbl.textContent = item.label;
            lbl.style.cssText = "font-size: 0.7em; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;";
            const val = cell.createEl("span");
            val.textContent = item.value;
            val.style.cssText = "font-size: 0.95em; color: var(--text-normal); font-weight: 500; font-variant-numeric: tabular-nums;";
        }

        const controlsRow = root.createEl("div");
        controlsRow.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap; align-items: center;";

        const leftGroup = controlsRow.createEl("div");
        leftGroup.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";

        const rateLabel = leftGroup.createEl("label");
        rateLabel.textContent = "Rate ($/hr):";
        rateLabel.style.cssText = "font-size: 0.82em; color: var(--text-muted);";

        const rateInput = leftGroup.createEl("input");
        rateInput.type = "number";
        rateInput.step = "0.01";
        rateInput.min = "0";
        rateInput.value = String(rate);
        rateInput.style.cssText = "padding: 4px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.9em; width: 80px; min-width: 0; box-sizing: border-box;";

        const saveBtn = leftGroup.createEl("button");
        saveBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>Save</span>`;
        const saveBtnBaseStyle = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease;";
        saveBtn.style.cssText = saveBtnBaseStyle;
        saveBtn.onmouseenter = () => {
            if (saveBtn.disabled) return;
            saveBtn.style.background = "var(--interactive-accent)";
            saveBtn.style.color = "var(--text-on-accent)";
        };
        saveBtn.onmouseleave = () => {
            if (saveBtn.disabled) return;
            saveBtn.style.background = "var(--background-primary)";
            saveBtn.style.color = "var(--interactive-accent)";
        };

        const refreshSaveEnabled = () => {
            const v = Number(rateInput.value);
            const same = !Number.isNaN(v) && v === rate;
            saveBtn.disabled = same;
            saveBtn.style.opacity = same ? "0.4" : "1";
            saveBtn.style.cursor = same ? "default" : "pointer";
        };
        rateInput.addEventListener("input", refreshSaveEnabled);
        refreshSaveEnabled();

        saveBtn.onclick = async () => {
            if (saveBtn.disabled) return;
            const value = Number(rateInput.value);
            if (Number.isNaN(value) || value < 0) {
                new Notice("Rate must be a non-negative number.");
                return;
            }
            await customJS.FinanceFrontmatter.update(file, (fm) => { fm.rate = value; });
            await this.render(dv);
        };

        const note = leftGroup.createEl("span");
        note.textContent = "Amount recomputes on next Time-Log edit.";
        note.style.cssText = "font-size: 0.72em; color: var(--text-muted); font-style: italic;";

        const rightGroup = controlsRow.createEl("div");
        rightGroup.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-left: auto;";

        const submitBtn = rightGroup.createEl("button");
        const submitIcon = submitted
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        submitBtn.innerHTML = submitIcon + `<span>${submitted ? "Unmark Submitted" : "Mark Submitted"}</span>`;
        submitBtn.style.cssText = "cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease;";
        submitBtn.onmouseenter = () => { submitBtn.style.background = "var(--interactive-accent)"; submitBtn.style.color = "var(--text-on-accent)"; };
        submitBtn.onmouseleave = () => { submitBtn.style.background = "var(--background-primary)"; submitBtn.style.color = "var(--interactive-accent)"; };

        submitBtn.onclick = async () => {
            if (submitted) {
                await customJS.FinanceFrontmatter.update(file, (fm) => { fm.submitted_date = ""; });
            } else {
                const today = window.moment().format("YYYY-MM-DD");
                await customJS.FinanceFrontmatter.update(file, (fm) => { fm.submitted_date = today; });
            }
            await this.render(dv);
        };
    }
}
