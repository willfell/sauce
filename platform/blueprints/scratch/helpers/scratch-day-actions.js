/**
 * ScratchDayActions (CustomJS)
 * Renders TWO accent-styled buttons in a flex row on a scratch day-hub note:
 *   1. "+ New Scratch" — creates Scratch-YYYY-MM-DD-HH-mm.md in same folder
 *   2. "Hub" — navigates to spice/scratch/Scratch.md
 *
 * Tolerates `day` frontmatter as string, Date, or Luxon — normalizes to
 * YYYY-MM-DD before validation (Obsidian auto-parses unquoted YAML dates).
 *
 * Usage in DataviewJS (via customjs-guard):
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

    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;

        const day = this._coerceDay(dv.current().day);
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchDayActions: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const m = window.moment(day, "YYYY-MM-DD", true);
        if (!m.isValid()) {
            dv.paragraph(`ScratchDayActions: invalid day value "${day}".`);
            return;
        }
        const monthFolder = m.format("YYYY/MM-MMMM");
        const folder = `spice/scratch/${monthFolder}/${day}`;

        const pencilPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`;
        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 8px; margin: 0.5em 0; flex-wrap: wrap;";

        const newScratch = async () => {
            const tpPlugin = app.plugins.plugins["templater-obsidian"];
            if (!tpPlugin || !tpPlugin.templater) {
                new Notice("ScratchDayActions: Templater plugin not enabled.", 8000);
                return;
            }
            const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Scratch.md");
            if (!templateFile) {
                new Notice("ScratchDayActions: template not found at ranch/templates/Scratch.md.", 8000);
                return;
            }
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
            const hhmm = window.moment().format("HH-mm");
            const filenameNoExt = `Scratch-${day}-${hhmm}`;
            try {
                await tpPlugin.templater.create_new_note_from_template(templateFile, folder, filenameNoExt, true);
            } catch (err) {
                const msg = (err && err.message) || "";
                if (/already exists|exists/i.test(msg)) {
                    app.workspace.openLinkText(`${folder}/${filenameNoExt}.md`, "");
                    return;
                }
                new Notice(`ScratchDayActions: Templater create failed — ${msg}`, 8000);
            }
        };

        const goToHub = () => {
            app.workspace.openLinkText("spice/scratch/Scratch.md", "");
        };

        customJS.AccentButton.render(row, { label: "+ New Scratch", icon: pencilPlusIcon, onClick: newScratch });
        customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub });
    }
}
