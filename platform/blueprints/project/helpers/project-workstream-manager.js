/**
 * Project Workstream Manager (CustomJS)
 * Renders Add/Remove buttons + workstream cards with progress bars.
 * Reads the kanban board to cross-reference task status per workstream.
 * Uses app.fileManager.processFrontMatter() for safe YAML serialization.
 *
 * Usage in DataviewJS (atlas note):
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectWorkstreamManager" });
 */
class ProjectWorkstreamManager {
    async render(dv) {
        const current = dv.current();
        const filePath = current.file.path;
        const projectDir = filePath.substring(0, filePath.lastIndexOf("/"));
        const projectSlug = projectDir.split("/").pop();
        const boardPath = `${projectDir}/${projectSlug}-board.md`;

        const parseWorkstreams = (raw) => {
            if (!raw) return [];
            if (typeof raw === "string") {
                try { raw = JSON.parse(raw); } catch (e) { return []; }
            }
            return Array.isArray(raw) ? raw : [];
        };

        const getWorkstreams = () => parseWorkstreams(current.workstreams);

        const parseBoardTasks = (content) => {
            const tasks = [];
            let currentLane = "";
            for (const line of content.split("\n")) {
                if (line.startsWith("## ")) {
                    currentLane = line.replace("## ", "").trim();
                }
                const linked = line.match(/- \[[ x]\] \[\[([^\]|]+)/);
                if (linked) {
                    tasks.push({ name: linked[1], lane: currentLane });
                    continue;
                }
                if (line.match(/^- \[[ x]\] /) && currentLane) {
                    const text = line.replace(/^- \[[ x]\] /, "").trim();
                    if (text) tasks.push({ name: text, lane: currentLane });
                }
            }
            return tasks;
        };

        const boardFile = app.vault.getAbstractFileByPath(boardPath);
        let boardTasks = [];
        if (boardFile) {
            boardTasks = parseBoardTasks(await app.vault.read(boardFile));
        }

        const cardNotes = dv.pages(`"${projectDir}"`)
            .where(p => {
                if (p.file.path === filePath) return false;
                if (p.file.name.endsWith("-board")) return false;
                if (p.file.name.endsWith("- Map")) return false;
                return p.source_board !== undefined || p.workstream !== undefined;
            });

        const ws = getWorkstreams();
        const wsTaskMap = {};
        for (const w of ws) wsTaskMap[w.id] = [];
        const unassigned = [];

        for (const card of cardNotes) {
            const wsId = card.workstream || "";
            const bt = boardTasks.find(t => t.name === card.file.name);
            const info = { name: card.file.name, path: card.file.path, lane: bt?.lane || "Unknown" };
            if (wsId && wsTaskMap[wsId]) {
                wsTaskMap[wsId].push(info);
            } else {
                unassigned.push(info);
            }
        }

        const totalAll = boardTasks.length;
        const completedAll = boardTasks.filter(t => t.lane === "Completed").length;
        const blockedAll = boardTasks.filter(t => t.lane === "Blocked").length;
        const inProgressAll = boardTasks.filter(t => t.lane === "In Progress").length;

        const findMapNote = () => {
            return app.vault.getFiles().find(f =>
                f.path.startsWith(projectDir + "/") &&
                !f.path.includes("/tasks/") &&
                (() => {
                    const cache = app.metadataCache.getFileCache(f);
                    return cache?.frontmatter?.type === "map";
                })()
            );
        };

        const updateWorkstreams = async (newWs) => {
            const atlasFile = app.vault.getAbstractFileByPath(filePath);
            if (atlasFile) await app.fileManager.processFrontMatter(atlasFile, fm => { fm.workstreams = newWs; });
            const mapFile = findMapNote();
            if (mapFile) await app.fileManager.processFrontMatter(mapFile, fm => { fm.workstreams = newWs; });
        };

        const slugify = (str) => {
            return str.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
        };

        const showModal = (content) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";
            content(dialog, () => document.body.removeChild(overlay));
            overlay.appendChild(dialog);
            overlay.addEventListener("click", e => { if (e.target === overlay) document.body.removeChild(overlay); });
            document.body.appendChild(overlay);
        };

        const addWorkstream = () => {
            showModal((dialog, close) => {
                dialog.createEl("div", { text: "Add Workstream" }).style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
                const nameInput = dialog.createEl("input", { type: "text", placeholder: "Name (e.g. Terraform)" });
                nameInput.style.cssText = "width: 100%; padding: 8px 10px; box-sizing: border-box; margin-bottom: 8px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 0.95em;";
                const descInput = dialog.createEl("input", { type: "text", placeholder: "Description (optional)" });
                descInput.style.cssText = "width: 100%; padding: 8px 10px; box-sizing: border-box; margin-bottom: 16px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 0.95em;";
                dialog.createEl("div", { text: "ID auto-generated from name." }).style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-bottom: 12px;";
                const btnRow = dialog.createEl("div");
                btnRow.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
                const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
                cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer;";
                cancelBtn.onclick = close;
                const okBtn = btnRow.createEl("button", { text: "Add" });
                okBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none; font-weight: 500;";
                const submit = async () => {
                    const name = nameInput.value.trim();
                    if (!name) return;
                    const id = slugify(name);
                    if (!id) return;
                    const cur = getWorkstreams();
                    if (cur.some(w => w.id === id)) { new Notice(`"${id}" already exists.`); close(); return; }
                    close();
                    await updateWorkstreams([...cur, { id, name, description: descInput.value.trim() }]);
                    new Notice(`Added workstream: ${name}`);
                };
                okBtn.onclick = submit;
                nameInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); descInput.focus(); } });
                descInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
                setTimeout(() => nameInput.focus(), 50);
            });
        };

        const removeWorkstream = () => {
            const cur = getWorkstreams();
            if (cur.length === 0) { new Notice("No workstreams to remove."); return; }
            showModal((dialog, close) => {
                dialog.createEl("div", { text: "Remove Workstream" }).style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
                const list = dialog.createEl("div");
                list.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;";
                for (const w of cur) {
                    const item = list.createEl("button");
                    item.style.cssText = "display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; cursor: pointer; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 0.95em; transition: border-color 0.15s;";
                    item.onmouseenter = () => { item.style.borderColor = "var(--text-error)"; };
                    item.onmouseleave = () => { item.style.borderColor = "var(--background-modifier-border)"; };
                    item.createEl("span", { text: w.name }).style.cssText = "font-weight: 500;";
                    item.createEl("code", { text: w.id }).style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-left: 4px;";
                    item.onclick = async () => {
                        close();
                        await updateWorkstreams(cur.filter(x => x.id !== w.id));
                        new Notice(`Removed: ${w.name}`);
                    };
                }
                const cancelBtn = dialog.createEl("button", { text: "Cancel" });
                cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; width: 100%;";
                cancelBtn.onclick = close;
            });
        };

        const root = dv.container.createEl("div");

        const btnRow = root.createEl("div");
        btnRow.style.cssText = "display: flex; gap: 8px; margin-bottom: 10px;";

        const addBtn = btnRow.createEl("button", { text: "+ Add" });
        addBtn.style.cssText = "padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 0.82em; background: var(--interactive-accent); color: var(--text-on-accent); border: none; font-weight: 500;";
        addBtn.onclick = addWorkstream;

        const rmBtn = btnRow.createEl("button", { text: "\u2212 Remove" });
        rmBtn.style.cssText = "padding: 4px 12px; border-radius: 6px; cursor: pointer; font-size: 0.82em; background: var(--background-secondary); color: var(--text-muted); border: 1px solid var(--background-modifier-border);";
        rmBtn.onclick = removeWorkstream;

        if (totalAll > 0) {
            const pct = Math.round((completedAll / totalAll) * 100);
            const summary = root.createEl("div");
            summary.style.cssText = "display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 8px 12px; background: var(--background-secondary); border-radius: 8px; font-size: 0.85em;";

            let parts = [`${completedAll}/${totalAll} complete`];
            if (inProgressAll > 0) parts.push(`${inProgressAll} active`);
            if (blockedAll > 0) parts.push(`<span style="color: var(--text-error);">${blockedAll} blocked</span>`);

            summary.innerHTML = `
                <div style="flex: 1;">
                    <div style="margin-bottom: 4px;">${parts.join(" &middot; ")}</div>
                    <div style="height: 4px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden;">
                        <div style="height: 100%; width: ${pct}%; background: var(--interactive-accent); border-radius: 2px;"></div>
                    </div>
                </div>
                <div style="font-size: 1.2em; font-weight: 600; color: var(--text-muted);">${pct}%</div>
            `;
        }

        if (ws.length > 0) {
            const cards = root.createEl("div");
            cards.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

            for (const w of ws) {
                const tasks = wsTaskMap[w.id] || [];
                const done = tasks.filter(t => t.lane === "Completed").length;
                const total = tasks.length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const blocked = tasks.filter(t => t.lane === "Blocked").length;

                const card = cards.createEl("div");
                card.style.cssText = "padding: 10px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px;";

                const hdr = card.createEl("div");
                hdr.style.cssText = "display: flex; align-items: center; justify-content: space-between;";
                hdr.createEl("span", { text: w.name || w.id }).style.cssText = "font-weight: 600; font-size: 0.92em;";
                const count = hdr.createEl("span");
                count.style.cssText = "font-size: 0.8em; color: var(--text-muted);";
                let countText = total > 0 ? `${done}/${total}` : "no tasks";
                if (blocked > 0) countText += ` \u00b7 ${blocked} blocked`;
                count.textContent = countText;

                if (w.description) {
                    const desc = card.createEl("div", { text: w.description });
                    desc.style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-top: 2px;";
                }

                if (total > 0) {
                    const bar = card.createEl("div");
                    bar.style.cssText = "height: 3px; border-radius: 2px; background: var(--background-modifier-border); overflow: hidden; margin-top: 6px;";
                    bar.createEl("div").style.cssText = `height: 100%; width: ${pct}%; background: var(--interactive-accent); border-radius: 2px;`;
                }
            }
        }

        if (unassigned.length > 0) {
            const note = root.createEl("div", { text: `${unassigned.length} task(s) not assigned to a workstream` });
            note.style.cssText = "font-size: 0.8em; color: var(--text-faint); margin-top: 8px; font-style: italic;";
        }
    }
}
