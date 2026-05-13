/**
 * ScratchHubActions (CustomJS)
 * Renders an accent-styled "Today" button on the global scratch hub.
 * Click → opens-or-creates today's day-hub Scratch-Day-YYYY-MM-DD.md.
 *
 * Empties dv.container before rendering to avoid Dataview's dual-fire
 * lifecycle producing duplicated button rows.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchHubActions" });
 */
class ScratchHubActions {
    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = window.moment().format("YYYY-MM-DD");
        const m = window.moment(day, "YYYY-MM-DD", true);
        const monthFolder = m.format("YYYY/MM-MMMM");
        const folder = `spice/scratch/${monthFolder}/${day}`;
        const dayHubPath = `${folder}/Scratch-Day-${day}.md`;

        const todayIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const openToday = async () => {
            const existing = app.vault.getAbstractFileByPath(dayHubPath);
            if (existing) {
                app.workspace.openLinkText(dayHubPath, "");
                return;
            }
            const tpPlugin = app.plugins.plugins["templater-obsidian"];
            if (!tpPlugin || !tpPlugin.templater) {
                new Notice("ScratchHubActions: Templater plugin not enabled.", 8000);
                return;
            }
            const templateFile = app.vault.getAbstractFileByPath("ranch/templates/Scratch Day Hub.md");
            if (!templateFile) {
                new Notice("ScratchHubActions: template not found at ranch/templates/Scratch Day Hub.md.", 8000);
                return;
            }
            if (!app.vault.getAbstractFileByPath(folder)) {
                try {
                    await app.vault.createFolder(folder);
                } catch (folderErr) {
                    if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) {
                        new Notice(`ScratchHubActions: cannot create folder ${folder} — ${folderErr.message}`, 8000);
                        return;
                    }
                }
            }
            try {
                await tpPlugin.templater.create_new_note_from_template(templateFile, folder, `Scratch-Day-${day}`, true);
            } catch (err) {
                const msg = (err && err.message) || "";
                if (/already exists|exists/i.test(msg)) {
                    app.workspace.openLinkText(dayHubPath, "");
                    return;
                }
                new Notice(`ScratchHubActions: Templater create failed — ${msg}`, 8000);
            }
        };

        customJS.AccentButton.render(row, { label: "Today", icon: todayIcon, onClick: openToday, flex: true });
    }
}
