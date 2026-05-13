/**
 * ScratchDayActions (CustomJS)
 * Renders TWO accent-styled buttons in a centered flex row on a scratch day-hub:
 *   1. "+ New Scratch" — opens overlay dialog asking what the scratch is for,
 *      then creates Scratch-YYYY-MM-DD-HH-mm.md with the title baked into
 *      frontmatter.
 *   2. "Hub" — navigates to spice/scratch/Scratch.md
 *
 * Empties dv.container before rendering to avoid Dataview's dual-fire
 * lifecycle producing duplicated button rows. Tolerates `day` frontmatter
 * as string, Date, or Luxon — normalizes to YYYY-MM-DD before validation.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
 */
class ScratchDayActions {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        if (raw instanceof Date && !isNaN(raw)) {
            const y = raw.getFullYear();
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    _yamlEscape(s) {
        return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    _buildScratchBody({ created, day, time, title }) {
        return `---
created: "${created}"
type: scratch
day: "${day}"
time: "${time}"
title: "${this._yamlEscape(title)}"
day_link: "[[Scratch-Day-${day}]]"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ScratchLeafActions" });
\`\`\`

---

`;
    }

    _openTitleDialog(onSubmit) {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";

        const dialog = document.createElement("div");
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; max-width: 480px; width: calc(100% - 32px); margin: 0 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); box-sizing: border-box;";

        const heading = document.createElement("div");
        heading.textContent = "New Scratch";
        heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
        dialog.appendChild(heading);

        const wrap = document.createElement("div");
        wrap.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;";
        const lab = document.createElement("label");
        lab.textContent = "What's this scratch for?";
        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted);";
        wrap.appendChild(lab);
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "e.g. weekly retro thoughts";
        input.style.cssText = "padding: 8px 12px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box; width: 100%;";
        wrap.appendChild(input);
        dialog.appendChild(wrap);

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
        const cancelBtn = document.createElement("button");
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);";
        const createBtn = document.createElement("button");
        createBtn.textContent = "Create";
        createBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);";
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(createBtn);
        dialog.appendChild(btnRow);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        const submit = () => {
            const v = input.value.trim();
            if (!v) {
                input.focus();
                input.style.borderColor = "var(--text-error)";
                return;
            }
            close();
            onSubmit(v);
        };

        cancelBtn.onclick = close;
        createBtn.onclick = submit;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        input.onkeydown = (e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") close();
        };
        setTimeout(() => input.focus(), 50);
    }

    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;
        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = this._coerceDay(dv.current().day);
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchDayActions: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const mo = window.moment(day, "YYYY-MM-DD", true);
        if (!mo.isValid()) {
            dv.paragraph(`ScratchDayActions: invalid day value "${day}".`);
            return;
        }
        const monthFolder = mo.format("YYYY/MM-MMMM");
        const folder = `spice/scratch/${monthFolder}/${day}`;

        const pencilPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`;
        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const newScratch = () => {
            this._openTitleDialog(async (title) => {
                if (!app.vault.getAbstractFileByPath(folder)) {
                    try {
                        await app.vault.createFolder(folder);
                    } catch (folderErr) {
                        if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
                            new Notice(`ScratchDayActions: cannot create folder ${folder} — ${folderErr.message}`, 8000);
                            return;
                        }
                    }
                }
                const now = window.moment();
                const hhmm = now.format("HH-mm");
                const filenameNoExt = `Scratch-${day}-${hhmm}`;
                const filepath = `${folder}/${filenameNoExt}.md`;
                if (app.vault.getAbstractFileByPath(filepath)) {
                    app.workspace.openLinkText(filepath, "");
                    return;
                }
                const body = this._buildScratchBody({
                    created: now.format("YYYY-MM-DDTHH:mm:ss"),
                    day,
                    time: now.format("HH:mm"),
                    title,
                });
                try {
                    await app.vault.create(filepath, body);
                    app.workspace.openLinkText(filepath, "");
                } catch (err) {
                    new Notice(`ScratchDayActions: create failed — ${(err && err.message) || err}`, 8000);
                }
            });
        };

        const goToHub = () => {
            app.workspace.openLinkText("spice/scratch/Scratch.md", "");
        };

        customJS.AccentButton.render(row, { label: "+ New Scratch", icon: pencilPlusIcon, onClick: newScratch, flex: true });
        customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub, flex: true });
    }
}
