/**
 * Project Workstreams — Structure View (CustomJS)
 * Renders tasks grouped by workstream with status badges and progress.
 * Reads the kanban board for task status. Completed tasks sort to bottom.
 * Unassigned tasks get a "Move" button to reassign to a workstream.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectWorkstreams" });
 */
class ProjectWorkstreams {
    async render(dv) {
        const icons = {
            ws: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
            file: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`,
            move: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`
        };

        const statusConfig = {
            "Completed":   { label: "Done",     bg: "#16a34a", text: "#fff",               order: 3 },
            "In Progress": { label: "Active",   bg: "var(--interactive-accent)", text: "var(--text-on-accent)", order: 0 },
            "Blocked":     { label: "Blocked",  bg: "#dc2626", text: "#fff",               order: 1 },
            "In Planning": { label: "Planning", bg: "var(--background-modifier-border)", text: "var(--text-muted)", order: 2 },
            "Unknown":     { label: "\u2014",   bg: "var(--background-modifier-border)", text: "var(--text-muted)", order: 2 }
        };

        const current = dv.current();
        let rawWs = current.workstreams || [];
        if (typeof rawWs === "string") {
            try { rawWs = JSON.parse(rawWs); } catch (e) { rawWs = []; }
        }
        const workstreams = Array.isArray(rawWs) ? rawWs : [];
        const filePath = current.file.path;
        const projectDir = filePath.substring(0, filePath.lastIndexOf("/"));
        const projectSlug = projectDir.split("/").pop();
        const boardPath = `${projectDir}/${projectSlug}-board.md`;

        const boardFile = app.vault.getAbstractFileByPath(boardPath);
        let boardContent = "";
        if (boardFile) boardContent = await app.vault.read(boardFile);

        const getTaskLane = (taskName) => {
            let lane = "";
            for (const line of boardContent.split("\n")) {
                if (line.startsWith("## ")) lane = line.replace("## ", "").trim();
                if (line.includes(taskName)) return lane;
            }
            return "Unknown";
        };

        const projectPages = dv.pages(`"${projectDir}"`)
            .where(p => p.file.path !== filePath && !p.file.name.endsWith("-board") && !p.file.name.endsWith("- Structure"));

        const grouped = {};
        const unassigned = [];
        for (const page of projectPages) {
            const wsId = page.workstream || "";
            const lane = getTaskLane(page.file.name);
            const info = { page, lane, cfg: statusConfig[lane] || statusConfig["Unknown"] };
            if (wsId && workstreams.some(w => w.id === wsId)) {
                if (!grouped[wsId]) grouped[wsId] = [];
                grouped[wsId].push(info);
            } else if (page.source_board !== undefined || page.workstream !== undefined) {
                unassigned.push(info);
            }
        }

        const sortTasks = (arr) => {
            return arr.sort((a, b) => a.cfg.order - b.cfg.order || a.page.file.name.localeCompare(b.page.file.name));
        };

        const badge = (cfg) => {
            return `<span style="display:inline-block; padding: 1px 8px; border-radius: 4px; font-size: 0.72em; font-weight: 500; background: ${cfg.bg}; color: ${cfg.text}; white-space: nowrap;">${cfg.label}</span>`;
        };

        const showMoveModal = (page) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 300px; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";
            dialog.createEl("div", { text: `Move "${page.file.name}" to:` }).style.cssText = "font-size: 1em; font-weight: 600; margin-bottom: 12px;";

            const list = dialog.createEl("div");
            list.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;";

            for (const w of workstreams) {
                const item = list.createEl("button");
                item.style.cssText = "display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; cursor: pointer; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 0.95em; transition: border-color 0.15s;";
                item.onmouseenter = () => { item.style.borderColor = "var(--interactive-accent)"; };
                item.onmouseleave = () => { item.style.borderColor = "var(--background-modifier-border)"; };
                item.createEl("span", { text: w.name || w.id }).style.cssText = "font-weight: 500;";
                if (w.description) {
                    item.createEl("span", { text: w.description }).style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-left: auto;";
                }
                item.onclick = async () => {
                    document.body.removeChild(overlay);
                    const tFile = app.vault.getAbstractFileByPath(page.file.path);
                    if (tFile) {
                        await app.fileManager.processFrontMatter(tFile, fm => { fm.workstream = w.id; });
                        new Notice(`Moved "${page.file.name}" to ${w.name}`);
                    }
                };
            }

            const cancelBtn = dialog.createEl("button", { text: "Cancel" });
            cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; width: 100%;";
            cancelBtn.onclick = () => document.body.removeChild(overlay);

            overlay.appendChild(dialog);
            overlay.addEventListener("click", e => { if (e.target === overlay) document.body.removeChild(overlay); });
            document.body.appendChild(overlay);
        };

        const renderTaskRow = (container, info, opts) => {
            const { page, lane, cfg } = info;
            const isDone = lane === "Completed";

            const row = container.createEl("div");
            row.style.cssText = `display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 4px; cursor: pointer; ${isDone ? "opacity: 0.55;" : ""}`;
            row.onmouseenter = () => { row.style.background = "var(--background-secondary)"; };
            row.onmouseleave = () => { row.style.background = "transparent"; };

            row.innerHTML = `${icons.file} <span style="flex: 1; font-size: 0.9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;${isDone ? " text-decoration: line-through;" : ""}">${page.file.name}</span> ${badge(cfg)}`;

            if (opts?.showMove) {
                const moveBtn = row.createEl("button");
                moveBtn.innerHTML = icons.move;
                moveBtn.title = "Assign to workstream";
                moveBtn.style.cssText = "padding: 2px 6px; border-radius: 4px; cursor: pointer; background: transparent; border: 1px solid var(--background-modifier-border); color: var(--text-muted); display: inline-flex; align-items: center; flex-shrink: 0;";
                moveBtn.onmouseenter = () => { moveBtn.style.borderColor = "var(--interactive-accent)"; moveBtn.style.color = "var(--interactive-accent)"; };
                moveBtn.onmouseleave = () => { moveBtn.style.borderColor = "var(--background-modifier-border)"; moveBtn.style.color = "var(--text-muted)"; };
                moveBtn.onclick = (e) => { e.stopPropagation(); showMoveModal(page); };
            }

            row.onclick = () => { app.workspace.openLinkText(page.file.path, ""); };
        };

        const container = dv.container.createEl("div");

        if (workstreams.length === 0) {
            container.createEl("p", { text: "No workstreams defined in frontmatter." }).style.cssText = "color: var(--text-faint); font-style: italic;";
        } else {
            for (const ws of workstreams) {
                const tasks = sortTasks(grouped[ws.id] || []);
                const done = tasks.filter(t => t.lane === "Completed").length;
                const total = tasks.length;

                const section = container.createEl("div");
                section.style.cssText = "margin-bottom: 16px;";

                const hdr = section.createEl("div");
                hdr.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--background-secondary); border-radius: 8px; border: 1px solid var(--background-modifier-border); margin-bottom: 4px;";
                let hdrHtml = `${icons.ws} <strong>${ws.name || ws.id}</strong>`;
                hdrHtml += ` <span style="color: var(--text-muted); font-weight: 400; font-size: 0.82em; margin-left: auto;">${total > 0 ? `${done}/${total}` : "no tasks"}</span>`;
                hdr.innerHTML = hdrHtml;

                if (ws.description) {
                    section.createEl("div", { text: ws.description }).style.cssText = "color: var(--text-muted); font-size: 0.82em; margin: 2px 0 4px 28px;";
                }

                const list = section.createEl("div");
                list.style.cssText = "margin-left: 12px;";

                if (tasks.length === 0) {
                    list.createEl("div", { text: "No tasks assigned" }).style.cssText = "color: var(--text-faint); font-size: 0.85em; font-style: italic; padding: 4px 8px;";
                } else {
                    for (const info of tasks) renderTaskRow(list, info);
                }
            }
        }

        if (unassigned.length > 0) {
            const section = container.createEl("div");
            section.style.cssText = "margin-bottom: 16px;";

            const hdr = section.createEl("div");
            hdr.style.cssText = "display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--background-secondary); border-radius: 8px; border: 1px dashed var(--background-modifier-border); margin-bottom: 4px; opacity: 0.8;";
            hdr.innerHTML = `${icons.ws} <strong>Unassigned</strong> <span style="color: var(--text-muted); font-weight: 400; font-size: 0.82em; margin-left: auto;">${unassigned.length}</span>`;

            const list = section.createEl("div");
            list.style.cssText = "margin-left: 12px;";
            for (const info of sortTasks(unassigned)) renderTaskRow(list, info, { showMove: true });
        }
    }
}
