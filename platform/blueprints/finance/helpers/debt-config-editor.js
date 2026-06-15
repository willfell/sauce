/**
 * DebtConfigEditor v0.6.0 (v0.108.0 S3)
 *
 * Per-debt edit modal. Modal-triggered — NOT page-level.
 * Called from DebtSummary's "Edit balance" pill:
 *   await customJS.DebtConfigEditor.render(file, { onSave: () => {} });
 *
 * Field set: current_balance / apr / min_payment / planned_monthly_payment / url
 * (opened_date excluded — does not change post-creation)
 *
 * Auto-snapshot logic (CRITICAL):
 *   On save, if current_balance changed, prepend:
 *     { date: YYYY-MM-DD, balance: prevBalance, source: "manual" }
 *   to balance_history[] BEFORE writing new balance.
 *   Updates last_updated to today.
 *
 * All writes via customJS.FinanceFrontmatter.update.
 * CSS root: dce-root (modal only; no embed-dedup needed).
 */
class DebtConfigEditor {
    async render(file, opts = {}) {
        if (!file) return;

        const cache = app.metadataCache.getFileCache(file);
        const current = cache?.frontmatter || {};
        const prevBalance = Number(current.current_balance) || 0;

        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";

        const dialog = document.createElement("div");
        dialog.className = "dce-root";
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 340px; max-width: 92vw; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

        const heading = document.createElement("div");
        heading.textContent = `Edit: ${current.name || file.name}`;
        heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 16px;";
        dialog.appendChild(heading);

        const mkField = (labelText, control, hint) => {
            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 10px;";
            const lab = document.createElement("label");
            lab.textContent = labelText + (hint ? ` (${hint})` : "");
            lab.style.cssText = "font-size: 0.82em; color: var(--text-muted); flex: 0 0 110px;";
            wrap.appendChild(lab);
            control.style.cssText = "flex: 1; min-width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
            wrap.appendChild(control);
            dialog.appendChild(wrap);
            return wrap;
        };

        const balInput = document.createElement("input");
        balInput.type = "number";
        balInput.step = "0.01";
        balInput.min = "0";
        balInput.value = String(prevBalance);
        mkField("Balance", balInput);

        const aprInput = document.createElement("input");
        aprInput.type = "number";
        aprInput.step = "0.01";
        aprInput.min = "0";
        aprInput.value = String(Number(current.apr) || 0);
        mkField("APR (%)", aprInput);

        const minInput = document.createElement("input");
        minInput.type = "number";
        minInput.step = "0.01";
        minInput.min = "0";
        minInput.value = String(Number(current.min_payment) || 0);
        mkField("Min Payment", minInput);

        const plannedInput = document.createElement("input");
        plannedInput.type = "number";
        plannedInput.step = "0.01";
        plannedInput.min = "0";
        plannedInput.value = String(Number(current.planned_monthly_payment) || 0);
        mkField("Planned/mo", plannedInput);

        const urlInput = document.createElement("input");
        urlInput.type = "text";
        urlInput.value = current.url || "";
        urlInput.placeholder = "(optional)";
        mkField("URL", urlInput);

        const historyNote = document.createElement("div");
        historyNote.style.cssText = "font-size: 0.78em; color: var(--text-muted); margin-bottom: 12px;";
        historyNote.textContent = "Changing balance will auto-prepend a snapshot to balance_history[].";
        dialog.appendChild(historyNote);

        const status = document.createElement("div");
        status.style.cssText = "font-size: 0.8em; color: var(--text-error); min-height: 1.2em; margin-bottom: 10px;";
        dialog.appendChild(status);

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
        cancelBtn.onclick = () => document.body.removeChild(overlay);

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Save";
        saveBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";

        saveBtn.onclick = async () => {
            const newBalance = Number(balInput.value);
            if (Number.isNaN(newBalance) || newBalance < 0) {
                status.textContent = "Balance must be >= 0.";
                return;
            }

            await customJS.FinanceFrontmatter.update(file, (fm) => {
                // Auto-snapshot: if balance changed, prepend prior balance to history
                if (newBalance !== prevBalance) {
                    if (!Array.isArray(fm.balance_history)) fm.balance_history = [];
                    fm.balance_history.unshift({
                        date: new Date().toISOString().slice(0, 10),
                        balance: prevBalance,
                        source: "manual",
                    });
                }
                fm.current_balance = newBalance;
                fm.apr = Number(aprInput.value) || fm.apr;
                fm.min_payment = Number(minInput.value) || fm.min_payment;
                fm.planned_monthly_payment = Number(plannedInput.value) || fm.planned_monthly_payment;
                if (urlInput.value.trim()) fm.url = urlInput.value.trim();
                fm.last_updated = new Date().toISOString().slice(0, 10);
            });

            document.body.removeChild(overlay);
            if (typeof opts.onSave === "function") opts.onSave();
        };

        const onKey = (e) => {
            if (e.key === "Escape") cancelBtn.click();
            if (e.key === "Enter") saveBtn.click();
        };
        [balInput, aprInput, minInput, plannedInput, urlInput].forEach(el => {
            el.addEventListener("keydown", onKey);
        });

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(saveBtn);
        dialog.appendChild(btnRow);
        overlay.appendChild(dialog);
        overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
        document.body.appendChild(overlay);
        setTimeout(() => balInput.focus(), 0);
    }
}
