/**
 * NewInvoiceButton — overlay-dialog button for creating an invoice ecosystem
 * under beacon/finance/invoices/<YYYY-MM>/.
 *
 * Inputs: month picker. Defaults to current month.
 * Scaffolds THREE files:
 *   - Invoice-<YYYY-MM>.md   (atlas; type: invoice)
 *   - Time-Log-<YYYY-MM>.md  (time tracking; type: time-log)
 *   - board/Board-<YYYY-MM>.md (Kanban; type: kanban; auto-promote cards)
 *
 * On duplicate folder: opens existing Invoice atlas + Notice (no overwrite).
 */
class NewInvoiceButton {
    async render(dv) {
        const previous = dv.container.querySelector(":scope > .nib-root");
        if (previous) previous.remove();
        const root = dv.container.createEl("div", { cls: "nib-root" });
        root.style.cssText = "margin: 8px 0;";

        const btn = root.createEl("button");
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px; margin-right: 6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>New Invoice`;
        btn.style.cssText = "padding: 8px 16px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent); font-size: 0.9em; font-weight: 500;";
        btn.onclick = async () => {
            const month = await this._promptForMonth();
            if (!month) return;
            const path = await this._createInvoice(month);
            if (path) await app.workspace.openLinkText(path, "");
        };
    }

    _promptForMonth() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Invoice";
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
                const dir = `beacon/finance/invoices/${m}`;
                if (app.vault.getAbstractFileByPath(dir)) {
                    status.textContent = `${dir}/ already exists. Will open existing Invoice.`;
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

    async _createInvoice(month) {
        const baseDir = `beacon/finance/invoices/${month}`;
        const boardDir = `${baseDir}/board`;
        const invoicePath = `${baseDir}/Invoice-${month}.md`;
        const timeLogPath = `${baseDir}/Time-Log-${month}.md`;
        const boardPath = `${boardDir}/Board-${month}.md`;

        if (app.vault.getAbstractFileByPath(invoicePath)) {
            new Notice(`Invoice ${month} already exists; opening.`);
            return invoicePath;
        }

        for (const dir of [baseDir, boardDir]) {
            if (!app.vault.getAbstractFileByPath(dir)) {
                await app.vault.createFolder(dir);
            }
        }

        const today = window.moment().format("YYYY-MM-DD");

        const invoiceBody = `---
type: invoice
month: ${month}
date: ${month}-01
hours: 0
amount: 0
submitted_date: null
created: ${today}
tags:
  - finance
  - invoice
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "InvoiceNavButtons" });
\`\`\`

# Invoice — ${month}

| Field | Value |
|-------|-------|
| **Month** | \`= this.month\` |
| **Hours** | \`= this.hours\` |
| **Amount** | \`= "$" + this.amount\` |

## Time Log

![[Time-Log-${month}]]

## Notes

`;

        const timeLogBody = `---
type: time-log
month: ${month}
date: ${month}-01
total_hours: 0
created: ${today}
tags:
  - finance
  - time-log
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("Docs/Meta/Views/customjs-guard", { class: "InvoiceNavButtons" });
\`\`\`

# Time Log — ${month}

| Date | Start | End | Hours | Description |
|------|-------|-----|------:|-------------|

## Totals

| | |
|---|---:|
| **Total Hours** | \`= this.total_hours\` |
`;

        const boardBody = `---
kanban-plugin: board
title: Invoice ${month} Board
type: kanban
tags:
  - board
  - finance
  - invoice/${month}
---

## To Do

## In Progress

## Completed

%% kanban:settings
\`\`\`
{"kanban-plugin":"board","list-collapse":[false,false,false],"new-note-folder":"beacon/finance/invoices/${month}/board","new-note-template":"Docs/Meta/Templates/Template, Invoice Board Card.md"}
\`\`\`
%%
`;

        await app.vault.create(invoicePath, invoiceBody);
        await app.vault.create(timeLogPath, timeLogBody);
        await app.vault.create(boardPath, boardBody);

        return invoicePath;
    }
}
