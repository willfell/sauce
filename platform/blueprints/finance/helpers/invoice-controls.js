/**
 * InvoiceControls — Invoice atlas combined widget. Rate input ($/hr) with
 * Save-on-change + Mark/Unmark Submitted toggle. submitted_date set to today
 * via window.moment when toggling on; cleared when toggling off. Embed-deduped
 * per v0.16.0 lesson. All writes via customJS.FinanceFrontmatter.update.
 * Note: when rate changes, the Invoice atlas's amount is NOT proactively
 * recomputed; it updates on the next Time-Log edit (rate x hours).
 */
class InvoiceControls {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const previous = dv.container.querySelector(":scope > .ic-root");
        if (previous) previous.remove();

        const page = dv.current();
        if (!page || !page.file) return;

        if (!/^beacon\/finance\/invoices\/(\d{4}-\d{2})\/Invoice-/.test(page.file.path)) return;

        const file = app.vault.getAbstractFileByPath(page.file.path);
        if (!file) return;

        const rate = Number(page.rate || 0);
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
        root.style.cssText = "margin: 12px 0; display: flex; gap: 16px; flex-wrap: wrap; align-items: center;";

        const leftGroup = root.createEl("div");
        leftGroup.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";

        const rateLabel = leftGroup.createEl("label");
        rateLabel.textContent = "Rate ($/hr):";
        rateLabel.style.cssText = "font-size: 0.85em; color: var(--text-muted);";

        const rateInput = leftGroup.createEl("input");
        rateInput.type = "number";
        rateInput.step = "0.01";
        rateInput.min = "0";
        rateInput.value = String(rate);
        rateInput.style.cssText = "padding: 4px 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.9em; width: 80px; min-width: 0; box-sizing: border-box;";

        const saveBtn = leftGroup.createEl("button");
        saveBtn.textContent = "Save";
        saveBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.85em;";

        const refreshSaveEnabled = () => {
            const v = Number(rateInput.value);
            const same = !Number.isNaN(v) && v === rate;
            saveBtn.disabled = same;
            saveBtn.style.opacity = same ? "0.5" : "1";
            saveBtn.style.cursor = same ? "default" : "pointer";
        };
        rateInput.addEventListener("input", refreshSaveEnabled);
        refreshSaveEnabled();

        saveBtn.onclick = async () => {
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
        note.style.cssText = "font-size: 0.75em; color: var(--text-muted); font-style: italic;";

        const rightGroup = root.createEl("div");
        rightGroup.style.cssText = "display: flex; align-items: center; gap: 8px; flex-wrap: wrap;";

        const submitBtn = rightGroup.createEl("button");
        if (submitted) {
            submitBtn.textContent = "Unmark Submitted";
            submitBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.85em;";
        } else {
            submitBtn.textContent = "Mark Submitted";
            submitBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.85em;";
        }

        if (submitted) {
            const submittedSpan = rightGroup.createEl("span");
            submittedSpan.textContent = `Submitted ${formatDate(submittedDate)}`;
            submittedSpan.style.cssText = "font-size: 0.85em; color: var(--text-muted);";
        }

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
