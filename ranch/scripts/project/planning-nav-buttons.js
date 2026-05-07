/**
 * Planning Navigation Buttons (CustomJS)
 * Renders planning-context buttons (Iteration Note, All Plans)
 * by deriving the iteration from the current file's path.
 *
 * Usage in DataviewJS:
 *   await dv.view("Extras/Scripts/customjs-guard", { class: "PlanningNavButtons" });
 *
 * Expected file paths:
 *   Planning/<iteration>/filename.md
 *   Planning/<iteration>/<sprint>/filename.md
 */
class PlanningNavButtons {
    async render(dv) {
        const icons = {
            iteration: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
            allPlans: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>`
        };

        const filePath = dv.current().file.path;
        const pathParts = filePath.split("/");

        const planningIndex = pathParts.indexOf("Planning");
        const iterationSlug = planningIndex >= 0 && planningIndex + 1 < pathParts.length - 1 ? pathParts[planningIndex + 1] : null;

        if (!iterationSlug) return;

        const iterationDir = pathParts.slice(0, planningIndex + 2).join("/");
        const allPlansPath = "Planning/Planning.md";

        const currentFileName = dv.current().file.name;
        const iterationFiles = app.vault.getFiles().filter(f =>
            f.path.startsWith(iterationDir + "/") &&
            !f.path.includes("/", iterationDir.length + 1 + f.basename.length) === false &&
            f.path.split("/").length === iterationDir.split("/").length + 1
        );
        const mainNote = iterationFiles.find(f => {
            const tags = app.metadataCache.getFileCache(f)?.frontmatter?.tags || [];
            return tags.includes("iteration");
        });

        const createBtn = (parent, icon, text, onClick) => {
            const btn = parent.createEl("button");
            btn.innerHTML = icon + `<span style="margin-left: 6px;">${text}</span>`;
            btn.style.cssText = "cursor: pointer; padding: 8px 16px; border-radius: 6px; font-size: 0.9em; display: inline-flex; align-items: center;";
            btn.onclick = onClick;
            return btn;
        };

        const nav = dv.el("div", "");
        nav.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px;";

        if (mainNote && mainNote.basename !== currentFileName) {
            createBtn(nav, icons.iteration, mainNote.basename, () => {
                app.workspace.openLinkText(mainNote.path, "");
            });
        }

        createBtn(nav, icons.allPlans, "All Plans", () => {
            app.workspace.openLinkText(allPlansPath, "");
        });
    }
}
