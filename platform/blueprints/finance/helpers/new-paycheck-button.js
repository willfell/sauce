/**
 * NewPaycheckButton — overlay-dialog button for creating a Paycheck-YYYY-MM-DD.md
 * entity under beacon/finance/paychecks/.
 *
 * Inputs: pay_period_start (date) + pay_period_end (date) + amount (number).
 * Filename derives from start_date: Paycheck-YYYY-MM-DD.md.
 * Frontmatter: type: paycheck, pay_period_start, pay_period_end, paycheck_amount, expenses[].
 * Validation: end_date >= start_date; amount >= 0. Notice + abort on invalid.
 */
class NewPaycheckButton {
    async render(dv) {
        const previous = dv.container.querySelector(":scope > .npb-root");
        if (previous) previous.remove();
        const root = dv.container.createEl("div", { cls: "npb-root" });
        root.style.cssText = "margin: 8px 0;";

        const btn = root.createEl("button");
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px; margin-right: 6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New Paycheck`;
        btn.style.cssText = "padding: 8px 16px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.9em; font-weight: 500;";
        btn.onclick = async () => {
            const details = await this._promptForDetails();
            if (!details) return;
            const path = await this._createPaycheck(details);
            if (path) await app.workspace.openLinkText(path, "");
        };
    }

    _promptForDetails() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Paycheck";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const startInput = this._addDateField(dialog, "Start date");
            const endInput   = this._addDateField(dialog, "End date");
            const amountInput = this._addNumberField(dialog, "Amount", "0.01");

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const validate = () => {
                if (!startInput.value) return "Start date required.";
                if (!endInput.value) return "End date required.";
                if (endInput.value < startInput.value) return "End date must be on or after start date.";
                const amt = Number(amountInput.value);
                if (Number.isNaN(amt) || amt < 0) return "Amount must be a non-negative number.";
                const path = `beacon/finance/paychecks/${startInput.value}/Paycheck-${startInput.value}.md`;
                if (app.vault.getAbstractFileByPath(path)) return `Paycheck-${startInput.value}.md already exists. Will open existing.`;
                return null;
            };
            const refresh = () => {
                const err = validate();
                status.textContent = err || "";
                status.style.color = err && err.includes("already exists") ? "var(--text-muted)" : "var(--text-error)";
            };
            startInput.addEventListener("input", refresh);
            endInput.addEventListener("input", refresh);
            amountInput.addEventListener("input", refresh);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
            cancelBtn.onclick = () => { document.body.removeChild(overlay); resolve(null); };

            const okBtn = document.createElement("button");
            okBtn.textContent = "Create";
            okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
            okBtn.onclick = () => {
                const err = validate();
                if (err && !err.includes("already exists")) { refresh(); return; }
                document.body.removeChild(overlay);
                resolve({
                    start_date: startInput.value,
                    end_date: endInput.value,
                    amount: Number(amountInput.value || 0)
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            startInput.addEventListener("keydown", onKey);
            endInput.addEventListener("keydown", onKey);
            amountInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => startInput.focus(), 0);
        });
    }

    _addDateField(dialog, label) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;";
        const lab = document.createElement("label");
        lab.textContent = label;
        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
        wrap.appendChild(lab);
        const input = document.createElement("input");
        input.type = "date";
        input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
        wrap.appendChild(input);
        dialog.appendChild(wrap);
        return input;
    }

    _addNumberField(dialog, label, step) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;";
        const lab = document.createElement("label");
        lab.textContent = label;
        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
        wrap.appendChild(lab);
        const input = document.createElement("input");
        input.type = "number";
        input.step = step || "1";
        input.min = "0";
        input.placeholder = "0.00";
        input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
        wrap.appendChild(input);
        dialog.appendChild(wrap);
        return input;
    }

    async _createPaycheck({ start_date, end_date, amount }) {
        const baseDir = "beacon/finance/paychecks";
        const entityDir = `${baseDir}/${start_date}`;
        for (const dir of [baseDir, entityDir]) {
            if (!app.vault.getAbstractFileByPath(dir)) {
                await app.vault.createFolder(dir);
            }
        }
        const path = `${entityDir}/Paycheck-${start_date}.md`;
        if (app.vault.getAbstractFileByPath(path)) {
            new Notice(`Paycheck-${start_date}.md already exists; opening.`);
            return path;
        }
        const today = window.moment().format("YYYY-MM-DD");
        const body = `---
type: paycheck
pay_period_start: "${start_date}"
pay_period_end: "${end_date}"
paycheck_amount: ${amount}
expenses: []
created: "${today}"
tags:
  - finance
  - paycheck
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "paycheck");
\`\`\`

# Paycheck — ${start_date} to ${end_date}

## Expenses

(Add expenses to frontmatter \`expenses: []\` as \`{item, amount, category, paid, url?}\`)

## Notes

`;
        await app.vault.create(path, body);
        return path;
    }
}
