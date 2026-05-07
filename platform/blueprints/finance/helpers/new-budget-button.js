/**
 * NewBudgetButton — overlay-dialog button for creating a Budget-YYYY-MM.md
 * entity under spice/finance/budgets/.
 *
 * Inputs: month picker (<input type="month">). Defaults to current month.
 * Filename: Budget-YYYY-MM.md. Frontmatter: type: budget, budget_month, categories[].
 * On duplicate: opens existing + Notice (no overwrite).
 */
class NewBudgetButton {
    async render(dv) {
        const previous = dv.container.querySelector(":scope > .nbb-root");
        if (previous) previous.remove();
        const root = dv.container.createEl("div", { cls: "nbb-root" });
        root.style.cssText = "margin: 8px 0;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
        const btn = customJS.AccentButton.render(root, {
            label: "New Budget",
            icon: plusIcon,
            onClick: async () => {
                const month = await this._promptForMonth();
                if (!month) return;
                const path = await this._createBudget(month);
                if (path) await app.workspace.openLinkText(path, "");
            }
        });
    }

    _promptForMonth() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Budget";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const wrap = document.createElement("div");
            wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
            const lab = document.createElement("label");
            lab.textContent = "Month";
            lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 80px;";
            wrap.appendChild(lab);
            const input = document.createElement("input");
            input.type = "month";
            const now = new Date();
            const pad = (n) => String(n).padStart(2, "0");
            input.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
            input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
            wrap.appendChild(input);
            dialog.appendChild(wrap);

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const checkExists = () => {
                const m = input.value;
                if (!m) { status.textContent = ""; return; }
                const path = `spice/finance/budgets/${m}/Budget-${m}.md`;
                if (app.vault.getAbstractFileByPath(path)) {
                    status.textContent = `Budget-${m}.md already exists. Will open existing.`;
                    status.style.color = "var(--text-muted)";
                } else {
                    status.textContent = "";
                }
            };
            input.addEventListener("input", checkExists);
            checkExists();

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
                if (!input.value) return;
                document.body.removeChild(overlay);
                resolve(input.value);
            };

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            });

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => input.focus(), 0);
        });
    }

    async _createBudget(month) {
        const baseDir = "spice/finance/budgets";
        const entityDir = `${baseDir}/${month}`;
        for (const dir of [baseDir, entityDir]) {
            if (!app.vault.getAbstractFileByPath(dir)) {
                await app.vault.createFolder(dir);
            }
        }
        const path = `${entityDir}/Budget-${month}.md`;
        if (app.vault.getAbstractFileByPath(path)) {
            new Notice(`Budget-${month}.md already exists; opening.`);
            return path;
        }
        const today = window.moment().format("YYYY-MM-DD");
        const body = `---
type: budget
budget_month: "${month}"
categories: []
created: "${today}"
tags:
  - finance
  - budget
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "BudgetNavButtons" });
\`\`\`

\`\`\`dataviewjs
await customJS.FinanceStatus.renderBadge(dv, "budget");
\`\`\`

## Categories

\`\`\`dataviewjs
await dv.view("ranch/Views/customjs-guard", { class: "BudgetCategoriesEditor" });
\`\`\`

`;
        await app.vault.create(path, body);
        return path;
    }
}
