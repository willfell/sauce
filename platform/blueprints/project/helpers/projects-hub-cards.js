/**
 * Projects Hub Cards (CustomJS)
 * Renders the All Projects list on beacon/projects/Projects.md as activity-sorted
 * cards. Each card shows title, description, last-activity timestamp, and
 * task progress (done/total plus blocked count) read from the project's
 * kanban board file.
 *
 * Source query: pages under beacon/projects/ tagged #project, excluding
 * Projects itself, anything in /steps/, and *-board files.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectsHubCards" });
 */
class ProjectsHubCards {
    async render(dv) {
        // Get project hub files
        const projectHubs = dv.pages('"beacon/projects"')
            .where(p => p.file.etags.includes("#project") && p.file.name !== "Projects" && !p.file.path.includes("/steps/") && !p.file.name.toLowerCase().endsWith("-board"));

        // Build project data with latest modification time from any file in project dir
        const projectsWithActivity = [];
        for (const project of projectHubs) {
            const projectDir = project.file.folder;
            // Get all files in beacon/projects/<slug>/ directory
            const filesInProject = dv.pages(`"${projectDir}"`)
                .where(f => !f.file.path.includes("/steps/"));

            // Find most recent modification
            let latestMtime = project.file.mtime;
            for (const f of filesInProject) {
                if (f.file.mtime > latestMtime) {
                    latestMtime = f.file.mtime;
                }
            }

            // Read board for task stats
            const slug = projectDir.split("/").pop();
            const boardPath = `${projectDir}/${slug}-board.md`;
            const boardFile = app.vault.getAbstractFileByPath(boardPath);
            let taskTotal = 0, taskDone = 0, taskBlocked = 0;
            if (boardFile) {
                const bc = await app.vault.read(boardFile);
                let lane = "";
                for (const line of bc.split("\n")) {
                    if (line.startsWith("## ")) lane = line.replace("## ", "").trim();
                    if (line.match(/^- \[[ x]\] /)) {
                        taskTotal++;
                        if (lane === "Completed") taskDone++;
                        if (lane === "Blocked") taskBlocked++;
                    }
                }
            }

            projectsWithActivity.push({
                project: project,
                latestMtime: latestMtime,
                fileCount: filesInProject.length,
                taskTotal, taskDone, taskBlocked
            });
        }

        // Sort by latest activity
        projectsWithActivity.sort((a, b) => b.latestMtime - a.latestMtime);

        if (projectsWithActivity.length === 0) {
            dv.paragraph("*No projects yet. Create one to get started.*");
            return;
        }

        const container = dv.container.createEl("div");
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 16px;
        `;

        const isMobile = app.isMobile;

        for (const { project, latestMtime, fileCount, taskTotal, taskDone, taskBlocked } of projectsWithActivity) {
            const card = container.createEl("div");
            card.style.cssText = "background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; cursor: pointer; transition: all 0.2s ease; display: flex; flex-direction: column; gap: 6px; box-sizing: border-box;";
            card.onmouseenter = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"; card.style.borderColor = "var(--interactive-accent)"; };
            card.onmouseleave = () => { card.style.transform = "none"; card.style.boxShadow = "none"; card.style.borderColor = "var(--background-modifier-border)"; };
            card.onclick = () => { app.workspace.openLinkText(project.file.path, ""); };

            // Top row: title/desc on left, metadata on right
            const row = card.createEl("div");
            row.style.cssText = `display: flex; flex-direction: ${isMobile ? "column" : "row"}; align-items: ${isMobile ? "flex-start" : "center"}; gap: ${isMobile ? "6px" : "16px"};`;

            const left = row.createEl("div");
            left.style.cssText = `flex: 1; min-width: 0; ${isMobile ? "width: 100%;" : ""}`;

            const title = left.createEl("div");
            title.style.cssText = "font-size: 1em; font-weight: 600; color: var(--text-normal); display: flex; align-items: center; gap: 8px;";
            title.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="overflow: hidden; text-overflow: ellipsis; ${isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap;"}">${project.file.name}</span>`;

            const desc = project.description || "";
            if (desc) {
                const descEl = left.createEl("div");
                descEl.style.cssText = `font-size: 0.8em; color: var(--text-muted); margin-top: 2px; padding-left: 24px; ${isMobile ? "white-space: normal; word-break: break-word;" : "overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"}`;
                descEl.textContent = desc;
            }

            // Metadata: time + task stats
            const meta = row.createEl("div");
            meta.style.cssText = `display: flex; gap: ${isMobile ? "12px" : "16px"}; font-size: 0.8em; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; ${isMobile ? "padding-left: 24px;" : ""}`;
            const modified = moment(latestMtime.ts);
            let metaHtml = `<span title="Last activity">${modified.fromNow()}</span>`;
            if (taskTotal > 0) {
                const pct = Math.round((taskDone / taskTotal) * 100);
                metaHtml += `<span>${taskDone}/${taskTotal} &middot; ${pct}%</span>`;
                if (taskBlocked > 0) metaHtml += `<span style="color: var(--text-error);">${taskBlocked} blocked</span>`;
            }
            meta.innerHTML = metaHtml;

            // Progress bar (below the content row)
            if (taskTotal > 0) {
                const pct = Math.round((taskDone / taskTotal) * 100);
                const bar = card.createEl("div");
                bar.style.cssText = "height: 3px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; margin-top: 2px;";
                bar.createEl("div").style.cssText = `height: 100%; width: ${pct}%; background: var(--interactive-accent); border-radius: 2px;`;
            }
        }
    }
}
