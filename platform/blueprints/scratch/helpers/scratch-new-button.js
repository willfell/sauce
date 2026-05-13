/**
 * ScratchNewButton (CustomJS)
 * Renders a single accent-styled button on a scratch day-hub note.
 * Click → creates Scratch-YYYY-MM-DD-HH-mm.md in the same folder as the
 * current day-hub, via the Templater plugin's create_new_note_from_template.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchNewButton" });
 */
class ScratchNewButton {
    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;

        const day = dv.current().day;
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchNewButton: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const m = window.moment(day, "YYYY-MM-DD", true);
        if (!m.isValid()) {
            dv.paragraph(`ScratchNewButton: invalid day value "${day}".`);
            return;
        }
        const monthFolder = m.format("YYYY/MM-MMMM");
        const folder = `spice/scratch/${monthFolder}/${day}`;

        const btn = dv.container.createEl("button", {
            text: "+ New Scratch",
            cls: "beacon-accent-button"
        });
        btn.style.cssText = "margin: 0.5em 0; padding: 0.4em 0.9em; cursor: pointer;";

        btn.onclick = async () => {
            const tpPlugin = app.plugins.plugins["templater-obsidian"];
            if (!tpPlugin || !tpPlugin.templater) {
                new Notice("ScratchNewButton: Templater plugin not enabled.", 8000);
                return;
            }

            const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Scratch.md");
            if (!templateFile) {
                new Notice("ScratchNewButton: template not found at ranch/templates/Scratch.md.", 8000);
                return;
            }

            if (!app.vault.getAbstractFileByPath(folder)) {
                try {
                    await app.vault.createFolder(folder);
                } catch (folderErr) {
                    if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
                        new Notice(`ScratchNewButton: cannot create folder ${folder} — ${folderErr.message}`, 8000);
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
                new Notice(`ScratchNewButton: Templater create failed — ${msg}`, 8000);
            }
        };
    }
}
