/**
 * Project Navigation Buttons (CustomJS)
 * Renders project-context buttons matching vault nav button styling.
 * Auto-hides the button for the current note type.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
 *
 * Expected file paths:
 *   spice/projects/<slug>/<atlas|map|board>.md
 *   spice/projects/<slug>/tasks/<TaskName>.md                    (legacy flat tasks)
 *   spice/projects/<slug>/tasks/<TaskName>/<TaskName>.md         (new task-folder convention)
 *   spice/projects/<slug>/tasks/<TaskName>/<sub-note>.md         (sub-notes peer to a task)
 *
 * Sub-note detection: a file inside tasks/<X>/ whose basename != X.
 * For sub-notes, prepends a "Task: <X>" button only if <X>.md exists in that folder.
 */
class ProjectNavButtons {
    detectContext(filePath, dv) {
        const pathParts = filePath.split("/");
        const planningIdx = pathParts.indexOf("projects");
        if (planningIdx < 0 || planningIdx + 1 >= pathParts.length) return { context: "non-project", pathParts, planningIdx };

        const slugIndex = planningIdx + 1;
        const projectSlug = pathParts[slugIndex];
        const projectDir = pathParts.slice(0, planningIdx + 2).join("/");
        const tasksIdx = planningIdx + 2;

        const basename = dv.current().file.name;
        const isMap = basename.endsWith("- Map");

        // Project board: <slug>-board.md directly under project dir
        if (basename.endsWith("-board") && pathParts.length === planningIdx + 3) {
            return { context: "project-board", pathParts, planningIdx, projectSlug, projectDir };
        }

        // Project map
        if (isMap && pathParts.length === planningIdx + 3) {
            return { context: "project-map", pathParts, planningIdx, projectSlug, projectDir };
        }

        // Inside tasks/?
        if (pathParts[tasksIdx] === "tasks" && pathParts.length > tasksIdx + 2) {
            const taskFolder = pathParts[tasksIdx + 1];
            const afterTask = pathParts.slice(tasksIdx + 2);

            // task hub: tasks/<X>/<X>.md
            if (afterTask.length === 1 && basename === taskFolder) {
                return { context: "task-hub", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }

            // task-note: tasks/<X>/notes/<Y>.md
            if (afterTask.length === 2 && afterTask[0] === "notes") {
                return { context: "task-note", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }

            // task-board: tasks/<X>/board/<X>-board.md
            if (afterTask.length === 2 && afterTask[0] === "board" && basename.endsWith("-board")) {
                return { context: "task-board", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }

            // task-board-card: tasks/<X>/board/<Y>/<Y>.md
            if (afterTask.length === 3 && afterTask[0] === "board" && basename === afterTask[1].replace(/\.md$/, "")) {
                return { context: "task-board-card", pathParts, planningIdx, projectSlug, projectDir, taskFolder, cardName: afterTask[1] };
            }

            // legacy sub-note: tasks/<X>/<other>.md (peer to task hub)
            if (afterTask.length === 1 && basename !== taskFolder) {
                return { context: "legacy-sub-note", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }
        }

        // Project hub: lives directly under project dir, has #project tag
        const cache = app.metadataCache.getFileCache(dv.current().file);
        const tags = cache?.frontmatter?.tags || [];
        if (Array.isArray(tags) && tags.includes("project") && pathParts.length === planningIdx + 3) {
            return { context: "project-hub", pathParts, planningIdx, projectSlug, projectDir };
        }

        // Projects hub: spice/projects/Projects.md (single fixed-path hub note)
        if (pathParts.length === planningIdx + 2 && basename === "Projects") {
            return { context: "projects-hub", pathParts, planningIdx };
        }

        return { context: "unknown", pathParts, planningIdx, projectSlug, projectDir };
    }

    async _promptForTitle(notesFolder) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Task Note";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Note title";
            input.style.cssText = "width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; margin-bottom: 8px;";
            dialog.appendChild(input);

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const checkCollision = () => {
                const title = input.value.trim();
                if (!title) { status.textContent = ""; return; }
                const candidate = `${notesFolder}/${title}.md`;
                if (app.vault.getAbstractFileByPath(candidate)) {
                    status.textContent = `"${title}" already exists in this folder. Try "${title} 2".`;
                    status.style.color = "var(--text-error)";
                } else {
                    status.textContent = "";
                }
            };
            input.addEventListener("input", checkCollision);

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
                const title = input.value.trim();
                if (!title) return;
                const candidate = `${notesFolder}/${title}.md`;
                if (app.vault.getAbstractFileByPath(candidate)) {
                    checkCollision();
                    input.focus();
                    return;
                }
                document.body.removeChild(overlay);
                resolve(title);
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

    async _createTaskNote(notesFolder, title, projectSlug, taskFolder, taskHubPath) {
        const tplPath = "ranch/templates/Template, Task Note.md";
        const tplFile = app.vault.getAbstractFileByPath(tplPath);
        if (!tplFile) {
            new Notice(`Template missing: ${tplPath}`);
            return null;
        }

        const tpl = await app.vault.read(tplFile);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const dateTag = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
        const alias = `${projectSlug}-${taskFolder}: ${title}`;

        if (!app.vault.getAbstractFileByPath(notesFolder)) {
            await app.vault.createFolder(notesFolder);
        }

        const content = tpl
            .replaceAll("{{DATE}}", dateStr)
            .replaceAll("{{TASK_PARENT_PATH}}", taskHubPath)
            .replaceAll("{{ALIAS}}", alias)
            .replaceAll("{{DATE_TAG}}", dateTag);

        const targetPath = `${notesFolder}/${title}.md`;
        await app.vault.create(targetPath, content);
        return targetPath;
    }

    async _createTaskBoard(projectDir, taskFolder) {
        const tplPath = "ranch/templates/Template, Task Board.md";
        const tplFile = app.vault.getAbstractFileByPath(tplPath);
        if (!tplFile) {
            new Notice(`Template missing: ${tplPath}`);
            return null;
        }

        const tpl = await app.vault.read(tplFile);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const dateTag = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;

        const boardFolder = `${projectDir}/tasks/${taskFolder}/board`;
        if (!app.vault.getAbstractFileByPath(boardFolder)) {
            await app.vault.createFolder(boardFolder);
        }

        const newNoteFolder = boardFolder;
        const content = tpl
            .replaceAll("{{TASK_NAME}}", taskFolder)
            .replaceAll("{{DATE_TAG}}", dateTag)
            .replaceAll("{{NEW_NOTE_FOLDER}}", newNoteFolder);

        const targetPath = `${boardFolder}/${taskFolder}-board.md`;
        if (app.vault.getAbstractFileByPath(targetPath)) {
            new Notice("Task board already exists.");
            return targetPath;
        }
        await app.vault.create(targetPath, content);
        return targetPath;
    }

    async _openAsKanban(filePath) {
        // Kanban plugin auto-detects `kanban-plugin: board` frontmatter and
        // takes over the leaf. Explicit setViewState raced with file-body load
        // and produced blank panes; openLinkText alone is sufficient.
        app.workspace.openLinkText(filePath, "");
    }

    async renderTaskNoteTiles(parent, notesFolder, currentPath) {
        const folderObj = app.vault.getAbstractFileByPath(notesFolder);
        if (!folderObj || !folderObj.children) return;

        const noteFiles = folderObj.children.filter(f => f.extension === "md");
        if (noteFiles.length === 0) return;

        noteFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);

        const isMobile = app.isMobile;

        const heading = parent.createEl("div", { text: "Task Notes" });
        heading.style.cssText = "font-size: 0.85em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 16px; margin-bottom: 8px;";

        const container = parent.createEl("div");
        container.style.cssText = "display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;";

        const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

        for (const f of noteFiles) {
            const isCurrent = f.path === currentPath;
            const card = container.createEl("div");
            card.style.cssText = `background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 12px 16px; cursor: ${isCurrent ? "default" : "pointer"}; transition: all 0.2s ease; display: flex; flex-direction: ${isMobile ? "column" : "row"}; align-items: ${isMobile ? "flex-start" : "center"}; gap: ${isMobile ? "6px" : "12px"}; opacity: ${isCurrent ? "0.6" : "1"};`;
            if (!isCurrent) {
                card.onmouseenter = () => { card.style.transform = "translateY(-2px)"; card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)"; card.style.borderColor = "var(--interactive-accent)"; };
                card.onmouseleave = () => { card.style.transform = "none"; card.style.boxShadow = "none"; card.style.borderColor = "var(--background-modifier-border)"; };
                card.onclick = () => { app.workspace.openLinkText(f.path, ""); };
            }

            const left = card.createEl("div");
            left.style.cssText = `flex: 1; min-width: 0; ${isMobile ? "width: 100%;" : ""}`;

            const title = left.createEl("div");
            title.style.cssText = "font-size: 1em; font-weight: 600; color: var(--text-normal); display: flex; align-items: center; gap: 8px;";
            title.innerHTML = fileIcon + `<span style="overflow: hidden; text-overflow: ellipsis; ${isMobile ? "white-space: normal; word-break: break-word;" : "white-space: nowrap;"}">${f.basename}${isCurrent ? " (current)" : ""}</span>`;

            const meta = card.createEl("div");
            meta.style.cssText = `font-size: 0.8em; color: var(--text-muted); flex-shrink: 0; white-space: nowrap; ${isMobile ? "padding-left: 24px;" : ""}`;
            meta.textContent = moment(f.stat.mtime).fromNow();
        }
    }

    async render(dv) {
        const icons = {
            project: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
            map: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
            board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
            task: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`
        };

        const filePath = dv.current().file.path;
        const ctx = this.detectContext(filePath, dv);
        if (ctx.context === "non-project" || ctx.context === "unknown" || ctx.context === "projects-hub") return;

        const { pathParts, planningIdx, projectSlug, projectDir } = ctx;
        const boardPath = `${projectDir}/${projectSlug}-board.md`;

        const projectFiles = app.vault.getFiles().filter(f =>
            f.path.startsWith(projectDir + "/") &&
            !f.basename.endsWith("-board")
        );

        const mainNote = projectFiles.find(f => {
            const tags = app.metadataCache.getFileCache(f)?.frontmatter?.tags || [];
            return tags.includes("project");
        });

        const mapNote = projectFiles.find(f => f.basename.endsWith("- Map"));

        const isMainNote = mainNote && filePath === mainNote.path;
        const isMap = dv.current().file.name.endsWith("- Map");
        const isBoard = dv.current().file.name.endsWith("-board");

        // ── Sub-note detection ──────────────────────────────────────────────
        // Path shape for a sub-note: spice/projects/<slug>/tasks/<TaskName>/<other>.md
        // Path shape for a task note: spice/projects/<slug>/tasks/<TaskName>/<TaskName>.md
        // Only render the Task button when (a) we're nested under tasks/<X>/ AND
        // (b) basename != X AND (c) <X>.md exists in that folder (skip for legacy
        // sub-folders like doc-db-testing/ that have no matching task note).
        const tasksIdx = planningIdx + 2;  // tasks/ is direct child of project dir
        let taskNotePath = null;
        let taskFolderName = null;
        if (
            pathParts.length > tasksIdx + 2 &&
            pathParts[tasksIdx] === "tasks"
        ) {
            taskFolderName = pathParts[tasksIdx + 1];
            const currentBasename = dv.current().file.name;
            if (currentBasename !== taskFolderName) {
                const taskNoteCandidate = pathParts.slice(0, tasksIdx + 2).join("/") + "/" + taskFolderName + ".md";
                if (app.vault.getAbstractFileByPath(taskNoteCandidate)) {
                    taskNotePath = taskNoteCandidate;
                }
            }
        }

        const buttons = [];
        if (taskNotePath && ctx.context !== "task-hub") {
            buttons.push({ label: `Task: ${taskFolderName}`, icon: icons.task, path: taskNotePath });
        }
        if (!isMainNote && mainNote) {
            buttons.push({ label: mainNote.basename, icon: icons.project, path: mainNote.path });
        }
        if (!isMap && mapNote) {
            buttons.push({ label: "Map", icon: icons.map, path: mapNote.path });
        }
        if (!isBoard) {
            buttons.push({ label: "Project Board", icon: icons.board, path: boardPath });
        }

        // Task-note context: ensure a Task: <X> button leads back to the parent task hub.
        // Legacy code already handles this for legacy sub-notes via the regex; task-note is
        // structurally similar but lives under tasks/<X>/notes/.
        if (ctx.context === "task-note") {
            const taskHubPath = `${projectDir}/tasks/${ctx.taskFolder}/${ctx.taskFolder}.md`;
            if (app.vault.getAbstractFileByPath(taskHubPath) && !buttons.some(b => b.path === taskHubPath)) {
                buttons.unshift({ label: `Task: ${ctx.taskFolder}`, icon: icons.task, path: taskHubPath });
            }
        }

        // task-board: shown buttons should be Task: <X> · Project Hub · Project Board
        // (Map button is removed because the task-board doesn't need it)
        if (ctx.context === "task-board") {
            const taskHubPath = `${projectDir}/tasks/${ctx.taskFolder}/${ctx.taskFolder}.md`;
            const filteredButtons = buttons.filter(b => b.label !== "Map");
            if (app.vault.getAbstractFileByPath(taskHubPath) && !filteredButtons.some(b => b.path === taskHubPath)) {
                filteredButtons.unshift({ label: `Task: ${ctx.taskFolder}`, icon: icons.task, path: taskHubPath });
            }
            buttons.length = 0;
            buttons.push(...filteredButtons);
        }

        // task-board-card: shown buttons should be Card Board · Task: <X> · Project Hub
        if (ctx.context === "task-board-card") {
            const taskHubPath = `${projectDir}/tasks/${ctx.taskFolder}/${ctx.taskFolder}.md`;
            const taskBoardPath = `${projectDir}/tasks/${ctx.taskFolder}/board/${ctx.taskFolder}-board.md`;
            // Keep only the Project Hub button (whose label === mainNote?.basename) from the existing list
            const filteredButtons = mainNote ? buttons.filter(b => b.label === mainNote.basename) : [];
            if (app.vault.getAbstractFileByPath(taskHubPath) && !filteredButtons.some(b => b.path === taskHubPath)) {
                filteredButtons.unshift({ label: `Task: ${ctx.taskFolder}`, icon: icons.task, path: taskHubPath });
            }
            if (app.vault.getAbstractFileByPath(taskBoardPath) && !filteredButtons.some(b => b.path === taskBoardPath)) {
                filteredButtons.unshift({ label: "Card Board", icon: icons.board, path: taskBoardPath });
            }
            buttons.length = 0;
            buttons.push(...filteredButtons);
        }

        if (buttons.length === 0) return;

        // Dedupe: Dataview can re-fire a block without clearing dv.container
        // (esp. on file-modified events triggered by our own processFrontMatter
        // calls in the workstream widget). Wrap all our output in a single
        // removable root so re-renders replace previous output instead of
        // appending. See ranch/Plugins.md for the landmine writeup.
        const previousRoot = dv.container.querySelector(":scope > .pnb-root");
        if (previousRoot) previousRoot.remove();
        const root = dv.container.createEl("div", { cls: "pnb-root" });

        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Project";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const container = root.createEl("div");
        container.style.cssText = `
            display: flex;
            flex-wrap: nowrap;
            gap: 6px;
            margin-bottom: 4px;
        `;

        const btnStyle = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 6px;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-primary);
            color: var(--text-muted);
            font-size: 0.82em;
            font-weight: 500;
            font-family: inherit;
            letter-spacing: 0.01em;
            transition: all 0.15s ease;
            flex: 1;
            min-width: 0;
        `;

        for (const btn of buttons) {
            const el = container.createEl("button");
            el.innerHTML = btn.icon + `<span>${btn.label}</span>`;
            el.style.cssText = btnStyle;
            el.onmouseenter = () => {
                el.style.background = "var(--interactive-accent)";
                el.style.color = "var(--text-on-accent)";
                el.style.borderColor = "var(--interactive-accent)";
            };
            el.onmouseleave = () => {
                el.style.background = "var(--background-primary)";
                el.style.color = "var(--text-muted)";
                el.style.borderColor = "var(--background-modifier-border)";
            };
            el.onclick = () => app.workspace.openLinkText(btn.path, "");
        }

        // --- Workstream widget (card notes only) ---
        const isCardNote = !isMainNote && !isMap && !isBoard && dv.current().source_board;
        if (isCardNote && mainNote) {
            // (Dedupe handled by the root-level cleanup at the top of render.)
            const atlasCache = app.metadataCache.getFileCache(mainNote);
            let workstreams = atlasCache?.frontmatter?.workstreams || [];
            if (typeof workstreams === "string") {
                try { workstreams = JSON.parse(workstreams); } catch (e) { workstreams = []; }
            }
            if (!Array.isArray(workstreams)) workstreams = [];

            const currentWsId = String(dv.current().workstream || "");
            const matched = workstreams.find(w => w.id === currentWsId);

            const wsRow = root.createEl("div", { cls: "workstream-widget" });
            wsRow.style.cssText = "display: flex; align-items: center; gap: 8px; margin-top: 4px; margin-bottom: 4px; padding: 0 2px;";

            wsRow.createEl("span", { text: "Workstream:" }).style.cssText = "font-size: 0.82em; color: var(--text-muted);";

            const wsName = wsRow.createEl("span");
            if (matched) {
                wsName.textContent = matched.name;
                wsName.style.cssText = "font-size: 0.82em; font-weight: 500; color: var(--text-normal);";
            } else if (workstreams.length === 0) {
                wsName.textContent = "No workstreams defined";
                wsName.style.cssText = "font-size: 0.82em; color: var(--text-faint); font-style: italic;";
            } else {
                wsName.textContent = "Unassigned";
                wsName.style.cssText = "font-size: 0.82em; color: var(--text-faint); font-style: italic;";
            }

            if (workstreams.length > 0) {
                const changeBtn = wsRow.createEl("button", { text: matched ? "Change" : "Assign" });
                changeBtn.style.cssText = `
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    padding: 4px 10px;
                    border-radius: 6px;
                    border: 1px solid var(--background-modifier-border);
                    background: var(--background-primary);
                    color: var(--text-muted);
                    font-size: 0.78em;
                    font-weight: 500;
                    font-family: inherit;
                    letter-spacing: 0.01em;
                    transition: all 0.15s ease;
                    margin-left: auto;
                `;
                changeBtn.onmouseenter = () => {
                    changeBtn.style.background = "var(--interactive-accent)";
                    changeBtn.style.color = "var(--text-on-accent)";
                    changeBtn.style.borderColor = "var(--interactive-accent)";
                };
                changeBtn.onmouseleave = () => {
                    changeBtn.style.background = "var(--background-primary)";
                    changeBtn.style.color = "var(--text-muted)";
                    changeBtn.style.borderColor = "var(--background-modifier-border)";
                };
                changeBtn.onclick = () => {
                    const overlay = document.createElement("div");
                    overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
                    const dialog = document.createElement("div");
                    dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

                    dialog.createEl("div", { text: "Select Workstream" }).style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";

                    const list = dialog.createEl("div");
                    list.style.cssText = "display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;";

                    for (const w of workstreams) {
                        const isActive = w.id === currentWsId;
                        const item = list.createEl("button");
                        item.style.cssText = `display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; cursor: pointer; border: 1px solid ${isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)"}; border-radius: 6px; background: var(--background-secondary); color: var(--text-normal); font-size: 0.95em; transition: border-color 0.15s;`;
                        if (!isActive) {
                            item.onmouseenter = () => { item.style.borderColor = "var(--interactive-accent)"; };
                            item.onmouseleave = () => { item.style.borderColor = "var(--background-modifier-border)"; };
                        }
                        item.createEl("span", { text: w.name }).style.cssText = "font-weight: 500;";
                        if (w.description) {
                            item.createEl("span", { text: w.description }).style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-left: auto;";
                        }
                        if (isActive) {
                            item.createEl("span", { text: "(current)" }).style.cssText = "font-size: 0.8em; color: var(--text-muted); margin-left: auto;";
                        }
                        item.onclick = async () => {
                            document.body.removeChild(overlay);
                            if (isActive) return;
                            const cardFile = app.vault.getAbstractFileByPath(filePath);
                            if (cardFile) {
                                await app.fileManager.processFrontMatter(cardFile, fm => { fm.workstream = w.id; });
                                new Notice("Workstream: " + w.name);
                            }
                        };
                    }

                    if (currentWsId) {
                        const unItem = list.createEl("button");
                        unItem.style.cssText = "display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 12px; cursor: pointer; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); color: var(--text-faint); font-size: 0.95em; font-style: italic; transition: border-color 0.15s;";
                        unItem.onmouseenter = () => { unItem.style.borderColor = "var(--interactive-accent)"; };
                        unItem.onmouseleave = () => { unItem.style.borderColor = "var(--background-modifier-border)"; };
                        unItem.textContent = "Unassigned";
                        unItem.onclick = async () => {
                            document.body.removeChild(overlay);
                            const cardFile = app.vault.getAbstractFileByPath(filePath);
                            if (cardFile) {
                                await app.fileManager.processFrontMatter(cardFile, fm => { delete fm.workstream; });
                                new Notice("Workstream removed");
                            }
                        };
                    }

                    const cancelBtn = dialog.createEl("button", { text: "Cancel" });
                    cancelBtn.style.cssText = "padding: 6px 14px; border-radius: 6px; cursor: pointer; width: 100%; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.95em; transition: all 0.15s ease;";
                    cancelBtn.onclick = () => document.body.removeChild(overlay);

                    overlay.appendChild(dialog);
                    overlay.addEventListener("click", e => { if (e.target === overlay) document.body.removeChild(overlay); });
                    document.body.appendChild(overlay);
                };
            }
        }

        // Action button row: New Note (task-hub or task-note)
        if (ctx.context === "task-hub" || ctx.context === "task-note") {
            const taskHubPath = ctx.context === "task-hub"
                ? filePath
                : `${projectDir}/tasks/${ctx.taskFolder}/${ctx.taskFolder}.md`;
            const notesFolder = `${projectDir}/tasks/${ctx.taskFolder}/notes`;
            const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;

            // Divider between project nav row and task action row
            const divider = root.createEl("hr");
            divider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0;";

            const actionRow = root.createEl("div");
            actionRow.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px;";

            customJS.AccentButton.render(actionRow, {
                label: "New Note",
                icon: plusIcon,
                onClick: async () => {
                    const title = await this._promptForTitle(notesFolder);
                    if (!title) return;
                    const targetPath = await this._createTaskNote(notesFolder, title, projectSlug, ctx.taskFolder, taskHubPath);
                    if (targetPath) {
                        new Notice(`Created: ${title}`);
                        app.workspace.openLinkText(targetPath, "");
                    }
                },
                flex: true
            });

            if (ctx.context === "task-hub") {
                const boardPath = `${projectDir}/tasks/${ctx.taskFolder}/board/${ctx.taskFolder}-board.md`;
                const boardExists = !!app.vault.getAbstractFileByPath(boardPath);
                const boardIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;

                if (boardExists) {
                    customJS.AccentButton.render(actionRow, {
                        label: "Open Board",
                        icon: boardIcon,
                        onClick: async () => {
                            await this._openAsKanban(boardPath);
                        },
                        flex: true
                    });
                } else {
                    customJS.AccentButton.render(actionRow, {
                        label: "Create Board",
                        icon: boardIcon,
                        onClick: async () => {
                            const created = await this._createTaskBoard(projectDir, ctx.taskFolder);
                            if (created) {
                                new Notice("Task board created.");
                                await this._openAsKanban(created);
                            }
                        },
                        flex: true
                    });
                }
            }
        }

        // Auto-listing tiles: render notes/ folder contents for task-hub and task-note
        if (ctx.context === "task-hub" || ctx.context === "task-note") {
            const notesFolder = `${projectDir}/tasks/${ctx.taskFolder}/notes`;
            await this.renderTaskNoteTiles(root, notesFolder, filePath);
        }
    }

}
