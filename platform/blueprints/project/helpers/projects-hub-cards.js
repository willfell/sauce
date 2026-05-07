/**
 * Projects Hub Cards (CustomJS)
 * Thin wrapper over BeaconCards (cards mechanism v0.1.1+) using the "row"
 * layout: title + briefcase icon left, mtime + counts right, progress bar
 * full-width below. Mirrors accuris's Planning-Board active-projects pattern.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectsHubCards" });
 */
class ProjectsHubCards {
    async render(dv) {
        const projectHubs = dv.pages('"spice/projects"')
            .where(p => p.file.etags.includes("#project")
                     && p.file.name !== "Projects"
                     && !p.file.path.includes("/steps/")
                     && !p.file.name.toLowerCase().endsWith("-board")
                     && !p.file.name.endsWith("- Map"));

        const enriched = [];
        for (const project of projectHubs) {
            const projectDir = project.file.folder;
            const filesInProject = dv.pages(`"${projectDir}"`)
                .where(f => !f.file.path.includes("/steps/"));
            let latestMtime = project.file.mtime;
            for (const f of filesInProject) {
                if (f.file.mtime > latestMtime) latestMtime = f.file.mtime;
            }
            const slug = projectDir.split("/").pop();
            const boardPath = `${projectDir}/${slug}-board.md`;
            const boardFile = app.vault.getAbstractFileByPath(boardPath);
            let total = 0, done = 0, blocked = 0;
            if (boardFile) {
                const bc = await app.vault.read(boardFile);
                let lane = "";
                for (const line of bc.split("\n")) {
                    if (line.startsWith("## ")) lane = line.replace("## ", "").trim();
                    if (line.match(/^- \[[ x]\] /)) {
                        total++;
                        if (lane === "Completed") done++;
                        if (lane === "Blocked") blocked++;
                    }
                }
            }
            enriched.push({ project, latestMtime, total, done, blocked });
        }

        const lookup = new Map(enriched.map(e => [e.project.file.path, e]));

        const briefcase = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

        await customJS.BeaconCards.render(dv, {
            pages: enriched.map(e => e.project),
            layout: "row",
            title: (p) => p.file.name,
            icon:  () => briefcase,
            subtitle: (p) => p.description || null,
            meta: (p) => {
                const e = lookup.get(p.file.path);
                const time = window.moment(e.latestMtime.ts).fromNow();
                let html = `<span title="Last activity">${time}</span>`;
                if (e.total > 0) {
                    const pct = Math.round((e.done / e.total) * 100);
                    html += `<span>${e.done}/${e.total} &middot; ${pct}%</span>`;
                    if (e.blocked > 0) html += `<span style="color: var(--text-error);">${e.blocked} blocked</span>`;
                }
                return html;
            },
            progress: (p) => {
                const e = lookup.get(p.file.path);
                return e.total > 0 ? { done: e.done, total: e.total } : null;
            },
            target: (p) => p.file.path,
            sort: (a, b) => {
                const ea = lookup.get(a.file.path);
                const eb = lookup.get(b.file.path);
                return eb.latestMtime - ea.latestMtime;
            },
            empty: "No projects yet. Create one to get started."
        });
    }
}
