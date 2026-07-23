/**
 * Project Navigation Buttons (CustomJS)
 * Renders project-context buttons matching vault nav button styling.
 * Auto-hides the button for the current note type.
 *
 * SUPERSEDED CHROME (button-nav-refactor): render() is the LEGACY stacked
 * project-nav chrome. Migrated project templates render the single
 * `ProjectChromeBar` bar instead (breadcrumb + Go ▾ launcher + primary + ⋯), so
 * render() only appears on un-migrated notes. It is retained for backward compat.
 * The class stays as a METHOD LIBRARY: ProjectChromeBar._dispatch and
 * ProjectCommandsInit reuse its create/nav helpers unchanged —
 * _promptForTitle / _createTaskNote / _createTaskBoard / _openNavTarget /
 * _resolveProjectName. Do not delete those; keep detectContext in sync with the
 * verbatim copy in project-chrome-bar.js.
 *
 * Usage in DataviewJS (legacy templates only):
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
    // Slice 1.5 — canonical Map-note identity. The per-project Map note is
    // `Project Map.md` carrying `type: map` frontmatter (24 of 25 real notes);
    // detecting it by the stale `basename.endsWith("- Map")` suffix missed ~96%
    // of projects, so the "Map" nav button never rendered and Slice 2's Map-note
    // read would have resolved to undefined → silent hub-fallback. Detect by
    // `type: map` first; keep the legacy `- Map` suffix as a non-lossy fallback
    // for the one un-migrated note (accuris `denali`) until the Slice-4 heal.
    // Mirrors project-workstream-manager.js's `cache?.frontmatter?.type === "map"`.
    // `type` is the note's frontmatter `type` (page.type for the current note,
    // cache.frontmatter.type for a sibling file).
    _isMapNote(type, basename) {
        return type === "map"
            || (typeof basename === "string" && basename.endsWith("- Map"));
    }

    detectContext(filePath, dv) {
        const pathParts = filePath.split("/");
        const planningIdx = pathParts.indexOf("projects");
        if (planningIdx < 0 || planningIdx + 1 >= pathParts.length) return { context: "non-project", pathParts, planningIdx };

        const slugIndex = planningIdx + 1;
        const projectSlug = pathParts[slugIndex];
        const projectDir = pathParts.slice(0, planningIdx + 2).join("/");
        const tasksIdx = planningIdx + 2;

        const page = customJS.RenderSafe.page(dv);
        const basename = page.file.name;
        const isMap = this._isMapNote(page.type, basename);

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

            // Epic atlas: tasks/<Epic>/<Epic>.md. Frontmatter disambiguates it
            // from the legacy task-hub shape without moving either note type.
            if (afterTask.length === 1 && basename === taskFolder && page.type === "epic") {
                return { context: "epic-hub", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }

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
                return { context: page.board_role === "epic" ? "epic-board" : "task-board", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
            }

            // Execution slices remain flat peers of their epic board.
            if (afterTask.length === 2 && afterTask[0] === "board" && page.type === "slice") {
                return { context: "slice", pathParts, planningIdx, projectSlug, projectDir, taskFolder };
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

        // v0.52.0 — Inside docs/?
        // docs-hub:  spice/projects/<slug>/docs/Docs.md
        // doc-note:  spice/projects/<slug>/docs/<Title>.md
        if (pathParts[tasksIdx] === "docs" && pathParts.length === planningIdx + 4) {
            if (basename === "Docs") {
                return { context: "docs-hub", pathParts, planningIdx, projectSlug, projectDir };
            }
            return { context: "doc-note", pathParts, planningIdx, projectSlug, projectDir };
        }

        // v0.103.0 S3.2 — section-hub branches (depth 1 + 2). Frontmatter is
        // authoritative: type === "section-hub" + depth ∈ {1, 2} fully describes
        // the node. We still read the path to fish out parent_slug for depth-2
        // back-navigation (frontmatter `parent_section` is the human label;
        // the folder slug carries the URL).
        //   depth 1: spice/projects/<slug>/docs/<section_slug>/<Section Name>.md
        //   depth 2: spice/projects/<slug>/docs/<parent_slug>/<sub_slug>/<Sub Name>.md
        if (pathParts[tasksIdx] === "docs" && pathParts.length >= planningIdx + 5) {
            const fcache = app.metadataCache.getFileCache(page.file);
            const ffm = fcache?.frontmatter || {};
            if (ffm.type === "section-hub") {
                const depth = Number(ffm.depth) || 1;
                if (depth === 1 && pathParts.length === planningIdx + 5) {
                    const sectionSlug = pathParts[planningIdx + 3];
                    return { context: "section-hub", depth: 1, pathParts, planningIdx, projectSlug, projectDir, sectionSlug };
                }
                if (depth === 2 && pathParts.length === planningIdx + 6) {
                    const parentSlug = pathParts[planningIdx + 3];
                    const sectionSlug = pathParts[planningIdx + 4];
                    // parent_section frontmatter label drives the button text;
                    // the path-derived parentSlug drives the URL.
                    const parentSectionLabel = this._stripLinkBrackets(ffm.parent_section) || parentSlug;
                    return { context: "section-hub", depth: 2, pathParts, planningIdx, projectSlug, projectDir, sectionSlug, parentSlug, parentSectionLabel };
                }
            }
            // v0.104.0.2 PATCH — doc-notes that live INSIDE section folders
            // (docs/<section_slug>/<title>.md) or sub-section folders
            // (docs/<section_slug>/<sub_section_slug>/<title>.md) have the
            // same path shape as section-hub notes but a different frontmatter
            // type. Pre-patch this branch only caught type:section-hub and
            // doc-notes fell through to context:"unknown" → zero nav buttons.
            // 28 doc-notes in accuris global-k8s knowledge/ surfaced the bug.
            if (ffm.type === "doc-note") {
                return { context: "doc-note", pathParts, planningIdx, projectSlug, projectDir };
            }
        }

        // Project hub: lives directly under project dir, has canonical type:project
        // OR (legacy compat) #project tag. v0.56.1 PATCH (FA-3 fallout): the
        // post-canonical-vocab atlas notes have type:project but no longer carry
        // the 'project' tag — checking tag-only previously left atlas pages in
        // unknown context with zero rendered buttons.
        const cache = app.metadataCache.getFileCache(page.file);
        const fm = cache?.frontmatter || {};
        const tags = fm.tags || [];
        const isAtlasShape = fm.type === "project"
            || (Array.isArray(tags) && tags.includes("project"));
        if (isAtlasShape && pathParts.length === planningIdx + 3) {
            return { context: "project-hub", pathParts, planningIdx, projectSlug, projectDir };
        }

        // v0.116.1 — project-todo context: type:project-todo file at the project root
        // (e.g. spice/projects/sauce/Sauce To-Do.md).
        if (fm.type === "project-todo" && pathParts.length === planningIdx + 3) {
            return { context: "project-todo", pathParts, planningIdx, projectSlug, projectDir };
        }

        // Project Links, PR1 — Link Hub note: "Links Hub.md" directly under the
        // project dir. Basename-based (mirrors the map/board detection above) so
        // it does not depend on the metadata cache being warm; the nav row +
        // breadcrumb render on the hub note, and the "Helpful Links" button
        // self-hides here.
        if (basename === "Links Hub" && pathParts.length === planningIdx + 3) {
            return { context: "links-hub", pathParts, planningIdx, projectSlug, projectDir };
        }

        // Projects hub: spice/projects/Projects.md (single fixed-path hub note)
        if (pathParts.length === planningIdx + 2 && basename === "Projects") {
            return { context: "projects-hub", pathParts, planningIdx };
        }

        return { context: "unknown", pathParts, planningIdx, projectSlug, projectDir };
    }

    // Project Links, PR1 — pure helper for the "Helpful Links" nav button.
    // Returns { label, path } for the per-project Link Hub note, or null when the
    // button must be hidden: on the Link Hub note itself (self-hide) or when the
    // hub note does not exist yet (exists(path) is false). Kept pure + separate
    // from render() so the path string + both gates are unit-testable (see
    // run-project-links.js PLB-D4/D5) without stubbing the full Obsidian render.
    // The "Links Hub.md" basename MUST match detectContext's links-hub branch and
    // the entity-create extra_files filename_pattern.
    _linksHubButton(projectDir, ctx, exists) {
        if (!projectDir || !ctx || ctx.context === "links-hub") return null;
        const path = `${projectDir}/Links Hub.md`;
        if (typeof exists === "function" && !exists(path)) return null;
        return { label: "Helpful Links", path };
    }

    // WS3 (nav consolidation) — pure classifier splitting the built nav buttons
    // into a `core` row (rendered inline) and an `overflow` set (folded behind a
    // "More" menu). Overflow = the secondary destinations Map / To-Do / Helpful
    // Links, matched by EXACT label so a near-miss ("To-Do List", "Sitemap")
    // stays in core. Input order is preserved within both partitions. Kept pure
    // + separate from render() so the split is unit-testable (run-project-nav-
    // buttons.js PNB-1..5) without stubbing the full Obsidian render.
    _partitionButtons(buttons) {
        const OVERFLOW = new Set(["Map", "To-Do", "Helpful Links"]);
        const core = [];
        const overflow = [];
        for (const btn of (buttons || [])) {
            if (btn && OVERFLOW.has(btn.label)) overflow.push(btn);
            else core.push(btn);
        }
        return { core, overflow };
    }

    // WS3 — overflow "More" menu, rewritten (2026-07-02) to MIRROR the Space-nav
    // Go-to launcher (space-nav-buttons.js _openLauncher). A document.body-appended
    // overlay (so it is never clipped by the note's scroll container). On DESKTOP
    // it is a transparent overlay with a panel positioned `fixed`, anchored to the
    // "More" button's getBoundingClientRect (dropdown under the trigger); on MOBILE
    // a dim backdrop + bottom sheet with a handle bar. Re-tapping "More" while the
    // overlay is open TOGGLES it closed. A SINGLE close() removes the overlay AND
    // the capture-phase Escape keydown listener — never leave a dangling listener
    // (the leak a prior nav-launcher review caught). Backdrop click (target ===
    // overlay) closes too. Uses activeDocument (multi-window) with a document
    // fallback. Defensive against a missing document / customJS / app.isMobile.
    //
    // triggerEl = the rendered "More" AccentButton element (for desktop anchoring).
    _openMoreMenu(entries, triggerEl) {
        const doc = (typeof activeDocument !== "undefined" && activeDocument) || (typeof document !== "undefined" ? document : null);
        if (!doc || !doc.body || !Array.isArray(entries) || entries.length === 0) return;

        // Toggle: an already-open overlay means "close" — route through its own
        // teardown (__navClose) so the keydown listener is removed too.
        const alreadyOpen = doc.body.querySelector && doc.body.querySelector(".pnb-more-overlay");
        if (alreadyOpen) { if (alreadyOpen.__navClose) alreadyOpen.__navClose(); else if (alreadyOpen.remove) alreadyOpen.remove(); return; }

        const isMobile = !!(typeof app !== "undefined" && app && app.isMobile);

        const overlay = doc.createElement("div");
        overlay.className = "pnb-more-overlay";
        overlay.style.cssText = "position: fixed; inset: 0; z-index: 1000;"
            + (isMobile
                ? " background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center;"
                : " background: transparent;");

        const panel = doc.createElement("div");
        const panelBase = "box-sizing: border-box; background: var(--background-primary);"
            + " border: 1px solid var(--background-modifier-border);"
            + " box-shadow: 0 8px 30px rgba(0,0,0,0.30); overflow-y: auto;"
            + " display: flex; flex-direction: column;";
        if (isMobile) {
            panel.style.cssText = panelBase
                + " width: 100%; max-width: 620px; max-height: 72vh;"
                + " border-radius: 16px 16px 0 0;"
                + " padding: 8px 8px calc(10px + env(safe-area-inset-bottom, 0px));"
                + " gap: 2px;";
            const handle = doc.createElement("div");
            handle.style.cssText = "flex: 0 0 auto; width: 40px; height: 4px; border-radius: 2px; background: var(--background-modifier-border); margin: 4px auto 8px;";
            panel.appendChild(handle);
        } else {
            const rect = (triggerEl && triggerEl.getBoundingClientRect) ? triggerEl.getBoundingClientRect() : { left: 0, bottom: 0, width: 0 };
            const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
            const width = Math.min(vw - 16, Math.max(300, Math.round(rect.width) || 0));
            let left = Math.round(rect.left || 0);
            if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
            panel.style.cssText = panelBase
                + ` position: fixed; top: ${Math.round((rect.bottom || 0) + 6)}px; left: ${left}px;`
                + ` width: ${width}px; max-height: 60vh; border-radius: 8px; padding: 6px; gap: 1px;`;
        }

        // Single teardown for ALL dismiss paths (backdrop, Escape, re-tap toggle,
        // row select) — removes the overlay AND the capture-phase keydown listener
        // so a stale Escape handler can never swallow keys elsewhere.
        const close = () => {
            if (overlay.remove) overlay.remove();
            else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (doc.removeEventListener) doc.removeEventListener("keydown", onKey, true);
        };
        const onKey = (e) => { if (e && e.key === "Escape") { if (e.preventDefault) e.preventDefault(); close(); } };
        overlay.__navClose = close;

        for (const entry of entries) {
            const row = doc.createElement("button");
            const icon = (entry && entry.icon) || "";
            row.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;">${icon}</span>`
                + `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${(entry && entry.label) || ""}</span>`;
            row.style.cssText = "cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; box-sizing: border-box; border: none; border-radius: 8px; background: transparent; color: var(--text-normal); font-family: inherit; line-height: 1.25;"
                + (isMobile ? " padding: 12px; font-size: 1em;" : " padding: 8px 10px; font-size: 0.9em;");
            row.onmouseenter = () => { row.style.background = "var(--background-modifier-hover)"; };
            row.onmouseleave = () => { row.style.background = "transparent"; };
            row.onclick = () => { close(); this._openNavTarget(entry.path); };
            panel.appendChild(row);
        }

        overlay.onclick = (e) => { if (e && e.target === overlay) close(); };
        if (doc.addEventListener) doc.addEventListener("keydown", onKey, true);

        overlay.appendChild(panel);
        doc.body.appendChild(overlay);
    }

    // AccentButton remains the behavior/markup factory for legacy renderers;
    // sauce-core owns every visual state and responsive action-row geometry.
    _adoptButton(btn) {
        if (!btn) return btn;
        if (btn.classList?.add) btn.classList.add("sauce-btn");
        else btn.className = `${btn.className || ""} sauce-btn`.trim();
        if (btn.style) btn.style.cssText = "";
        btn.onmouseenter = null;
        btn.onmouseleave = null;
        return btn;
    }

    // Open an ABSOLUTE vault path safely: resolve to the TFile and openFile it
    // (bypasses the link resolver, which can double an absolute path against the
    // current note's folder on a cold cache — the doubled-path bug). Falls back
    // to openLinkText only when the file isn't in the vault index yet.
    _openNavTarget(vaultPath) {
        try {
            const f = app.vault.getAbstractFileByPath(vaultPath);
            if (f && app.workspace && typeof app.workspace.getLeaf === "function") {
                app.workspace.getLeaf(false).openFile(f);
                return;
            }
        } catch (_e) { /* fall through to openLinkText */ }
        app.workspace.openLinkText(vaultPath, "");
    }

    async _promptForTitle(notesFolder) {
        return new Promise((resolve) => {
            const modal = (typeof globalThis !== "undefined" && globalThis.customJS)
                ? globalThis.customJS.SauceModal : null;
            if (!modal || typeof modal.open !== "function") {
                try { new Notice("Project task note: SauceModal unavailable — reinstall the project blueprint.", 6000); } catch (_e) {}
                resolve(null);
                return;
            }
            let input = null;
            let status = null;
            let settled = false;
            const settle = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

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
            const handle = modal.open({
                title: "New Task Note",
                autofocus: true,
                submitLabel: "Create",
                body: (panel) => {
                    input = panel.createEl("input");
                    input.type = "text";
                    input.placeholder = "Note title";
                    input.style.cssText = "width:100%; box-sizing:border-box; margin-bottom:8px;";
                    status = panel.createEl("div");
                    status.style.cssText = "font-size:0.8em; color:var(--text-muted); min-height:1.2em;";
                    input.addEventListener("input", checkCollision);
                },
                onSubmit: async () => {
                    const title = input.value.trim();
                    if (!title) return false;
                    const candidate = `${notesFolder}/${title}.md`;
                    if (app.vault.getAbstractFileByPath(candidate)) {
                        checkCollision();
                        input.focus();
                        return false;
                    }
                    settle(title);
                    return true;
                },
                onClose: () => settle(null),
            });
            if (!handle) settle(null);
        });
    }

    _openWorkstreamPicker(workstreams, currentWsId, filePath) {
        const modal = (typeof globalThis !== "undefined" && globalThis.customJS)
            ? globalThis.customJS.SauceModal : null;
        if (!modal || typeof modal.open !== "function") {
            try { new Notice("Project workstream: SauceModal unavailable — reinstall the project blueprint.", 6000); } catch (_e) {}
            return null;
        }
        let selected = false;
        const choose = async (handle, workstream) => {
            if (selected) return false;
            selected = true;
            handle.close("selection");
            if (workstream && workstream.id === currentWsId) return true;
            const cardFile = app.vault.getAbstractFileByPath(filePath);
            if (!cardFile) return false;
            if (workstream) {
                await app.fileManager.processFrontMatter(cardFile, (fm) => { fm.workstream = workstream.id; });
                new Notice("Workstream: " + workstream.name);
            } else {
                await app.fileManager.processFrontMatter(cardFile, (fm) => { delete fm.workstream; });
                new Notice("Workstream removed");
            }
            return true;
        };
        return modal.open({
            title: "Select Workstream",
            buttons: [{ label: "Cancel", action: "cancel" }],
            body: (panel, handle) => {
                const list = panel.createEl("div");
                list.style.cssText = "display:flex; flex-direction:column; gap:4px;";
                for (const workstream of workstreams) {
                    const isActive = workstream.id === currentWsId;
                    const item = list.createEl("button", { cls: "sauce-btn" });
                    item.style.width = "100%";
                    item.style.justifyContent = "flex-start";
                    item.createEl("span", { text: workstream.name }).style.fontWeight = "500";
                    if (workstream.description) {
                        item.createEl("span", { text: workstream.description }).style.marginLeft = "auto";
                    }
                    if (isActive) {
                        item.createEl("span", { text: "(current)" }).style.marginLeft = "auto";
                    }
                    item.onclick = () => choose(handle, workstream);
                }
                if (currentWsId) {
                    const unassigned = list.createEl("button", { cls: "sauce-btn", text: "Unassigned" });
                    unassigned.style.width = "100%";
                    unassigned.style.justifyContent = "flex-start";
                    unassigned.onclick = () => choose(handle, null);
                }
            },
        });
    }

    async _createTaskNote(notesFolder, title, projectSlug, taskFolder, taskHubPath, projectDir) {
        const tplPath = "{{templates_path}}/Template, Task Note.md";
        const tplFile = app.vault.getAbstractFileByPath(tplPath);
        if (!tplFile) {
            new Notice(`Template missing: ${tplPath}`);
            return null;
        }

        const tpl = await app.vault.read(tplFile);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        // v0.59.3: emit canonical ISO+TZ created_at (was legacy "YYYY-MM-DD HH:mm").
        const dateStr = this._isoWithTz(now);
        const dateTag = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
        const alias = `${projectSlug}-${taskFolder}: ${title}`;
        // v0.124.0: stamp project_name FM (display name) so the breadcrumb's
        // fm:project_name resolver shows the mixed-case name, not the slug.
        // Falls back to the slug when the hub note can't be resolved.
        const projectName = this._resolveProjectName(projectDir) || projectSlug;

        if (!app.vault.getAbstractFileByPath(notesFolder)) {
            await app.vault.createFolder(notesFolder);
        }

        const content = tpl
            .replaceAll("{{DATE}}", dateStr)
            .replaceAll("{{TASK_PARENT_PATH}}", taskHubPath)
            .replaceAll("{{ALIAS}}", alias)
            .replaceAll("{{DATE_TAG}}", dateTag)
            .replaceAll("{{PROJECT_NAME}}", projectName);

        const targetPath = `${notesFolder}/${title}.md`;
        await app.vault.create(targetPath, content);
        return targetPath;
    }

    // v0.124.0: resolve a project's display name from its hub note basename.
    // Convention (mirrors install.js applyProjectNameBackfill + the legacy
    // _resolveProjectFromPath): the project dir holds exactly one note with
    // frontmatter type:project; its filename (sans .md) IS the display name.
    // Returns null when projectDir is falsy or no type:project note is found.
    _resolveProjectName(projectDir) {
        if (!projectDir) return null;
        try {
            const prefix = projectDir + "/";
            for (const f of app.vault.getMarkdownFiles()) {
                // Hub note lives DIRECTLY under projectDir (no nested segments).
                if (!f.path.startsWith(prefix)) continue;
                if (f.path.slice(prefix.length).includes("/")) continue;
                const fm = app.metadataCache.getFileCache(f)?.frontmatter;
                if (fm && fm.type === "project") return (fm.name || f.basename);
            }
        } catch (_e) { /* best-effort — fall back to slug */ }
        return null;
    }

    async _createTaskBoard(projectDir, taskFolder) {
        const tplPath = "{{templates_path}}/Template, Task Board.md";
        const tplFile = app.vault.getAbstractFileByPath(tplPath);
        if (!tplFile) {
            new Notice(`Template missing: ${tplPath}`);
            return null;
        }

        const tpl = await app.vault.read(tplFile);
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const dateTag = `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())}`;
        const dateStr = this._isoWithTz(now);

        const boardFolder = `${projectDir}/tasks/${taskFolder}/board`;
        if (!app.vault.getAbstractFileByPath(boardFolder)) {
            await app.vault.createFolder(boardFolder);
        }

        const newNoteFolder = boardFolder;
        // v0.59.3 BUG-A fix: substitute {{DATE}} (was never substituted; YAML
        // parsed unquoted `{{DATE}}` as a malformed inline-flow mapping).
        const content = tpl
            .replaceAll("{{TASK_NAME}}", taskFolder)
            .replaceAll("{{DATE}}", dateStr)
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
        // v0.119.0 PATCH: dv.current() returns undefined immediately after
        // EntityCreate.create → openFile, before Dataview has indexed the new
        // file. Bail out gracefully; next render tick will succeed once the
        // metadata cache catches up. Reported on accuris 2026-06-16 when
        // creating a new project from + New Project. See landmine #28 / the
        // dispatcher-contracts subsection of code-conventions.md.
        const page = customJS.RenderSafe.page(dv);
        if (!page || !page.file) return;

        const icons = {
            project: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
            map: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></svg>`,
            board: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
            task: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
            docs: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`,
            todo: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
            links: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`
        };

        const filePath = page.file.path;
        const ctx = this.detectContext(filePath, dv);
        if (ctx.context === "non-project" || ctx.context === "unknown" || ctx.context === "projects-hub") return;

        // v0.116.1 — project-todo context renders the standard project nav row
        // (Project, Map, Board, Docs) with the To-Do entry self-hidden. Falls
        // through into the shared button-build logic below; the buttons[] loop
        // handles self-hide via the context check.

        const { pathParts, planningIdx, projectSlug, projectDir } = ctx;
        const boardPath = `${projectDir}/${projectSlug}-board.md`;

        const projectFiles = app.vault.getFiles().filter(f =>
            f.path.startsWith(projectDir + "/") &&
            !f.basename.endsWith("-board")
        );

        // v0.56.1 PATCH (FA-3 fallout): atlas-detection reads canonical
        // type:project FIRST and falls back to legacy 'project' tag — the
        // FA-3 migration stripped the tag, so tag-only detection returned
        // undefined and the "Project Hub" back-button vanished from every
        // task/board/sub-note context.
        const mainNote = projectFiles.find(f => {
            const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
            const tags = fm.tags || [];
            return fm.type === "project"
                || (Array.isArray(tags) && tags.includes("project"));
        });

        const mapNote = projectFiles.find(f =>
            this._isMapNote(app.metadataCache.getFileCache(f)?.frontmatter?.type, f.basename)
        );

        const isMainNote = mainNote && filePath === mainNote.path;
        const isMap = this._isMapNote(page.type, page.file.name);
        const isBoard = page.file.name.endsWith("-board");

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
            const currentBasename = page.file.name;
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
        // v0.52.0 — Docs button: shown on every project context except docs-hub itself.
        // Hidden on projects-hub / task-board / task-board-card (those branches reset
        // buttons[] below). Visible on project-hub, project-map, project-board,
        // task-hub, task-note, legacy-sub-note, doc-note.
        if (ctx.context !== "docs-hub") {
            buttons.push({ label: "Docs", icon: icons.docs, path: `${projectDir}/docs/Docs.md` });
        }
        // v0.116.1 — To-Do button: shown on every project context except project-todo
        // itself, AND only when the project's <Name> To-Do.md exists. Detection by
        // mainNote.basename + " To-Do.md" so the filename convention stays consistent
        // with applyProjectTodoBackfill + entity-create extra_files entry.
        if (ctx.context !== "project-todo" && mainNote) {
            // Derive the To-Do path from mainNote.PATH (source of truth) rather
            // than re-joining projectDir + basename. mainNote.path already carries
            // the correct project folder, so slicing off its filename and appending
            // "<basename> To-Do.md" can never double the "spice/projects/<slug>/"
            // prefix even if projectDir was mis-derived from a malformed current
            // path (the doubled-link bug: projectDir + a value already containing
            // the project dir → spice/projects/<slug>/spice/projects/<slug>/…).
            const mainDir = mainNote.path.slice(0, mainNote.path.lastIndexOf("/"));
            const toDoPath = `${mainDir}/${mainNote.basename} To-Do.md`;
            if (app.vault.getAbstractFileByPath(toDoPath)) {
                buttons.push({ label: "To-Do", icon: icons.todo, path: toDoPath });
            }
        }
        // Project Links, PR1 — "Helpful Links" button opens the per-project Link
        // Hub note. Logic lives in the pure, unit-tested _linksHubButton: shown on
        // every project context EXCEPT the Link Hub itself, and only when the hub
        // note exists (new projects scaffold it via entity-create; existing
        // projects get it via the PR3 backfill heal) — so it never dangles on a
        // project without a hub yet.
        const linksHubBtn = this._linksHubButton(projectDir, ctx, (p) => !!app.vault.getAbstractFileByPath(p));
        if (linksHubBtn) buttons.push({ ...linksHubBtn, icon: icons.links });

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

        // v0.103.0 S3.2 — section-hub (depth 1): nav row =
        //   Project · Docs · Sibling Sections
        // "Sibling Sections" routes back to Docs.md (same target as Docs) —
        // Docs.md IS the sibling-sections index (ProjectDocsIndex renders the
        // section cards there).
        if (ctx.context === "section-hub" && ctx.depth === 1) {
            const docsHubPath = `${projectDir}/docs/Docs.md`;
            const sectionButtons = [];
            if (mainNote) {
                sectionButtons.push({ label: mainNote.basename, icon: icons.project, path: mainNote.path });
            }
            sectionButtons.push({ label: "Docs", icon: icons.docs, path: docsHubPath });
            sectionButtons.push({ label: "Sections", icon: icons.docs, path: docsHubPath });
            buttons.length = 0;
            buttons.push(...sectionButtons);
        }

        // v0.103.0 S3.2 — section-hub (depth 2): nav row =
        //   Project · Docs · Section · Sibling Sub-Sections
        // Section = parent Section Hub (path derived from ctx.parentSlug + the
        // parent_section frontmatter label). Sibling Sub-Sections also routes
        // to the parent Section Hub — that hub IS the sub-section index.
        if (ctx.context === "section-hub" && ctx.depth === 2) {
            const docsHubPath = `${projectDir}/docs/Docs.md`;
            const parentLabel = ctx.parentSectionLabel || ctx.parentSlug;
            const parentHubPath = `${projectDir}/docs/${ctx.parentSlug}/${parentLabel}.md`;
            const sectionButtons = [];
            if (mainNote) {
                sectionButtons.push({ label: mainNote.basename, icon: icons.project, path: mainNote.path });
            }
            sectionButtons.push({ label: "Docs", icon: icons.docs, path: docsHubPath });
            sectionButtons.push({ label: "Section", icon: icons.docs, path: parentHubPath });
            sectionButtons.push({ label: "Sub-Sections", icon: icons.docs, path: parentHubPath });
            buttons.length = 0;
            buttons.push(...sectionButtons);
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

        // WS3 — leading hairline via the canonical SectionLabel.divider primitive
        // (owns the chrome hairline spacing in one place; see note-chrome.md).
        // Guarded so a cold-load where the section-label mechanism hasn't
        // registered yet can't throw and blank the whole nav row.
        if (customJS && customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
            customJS.SectionLabel.divider(root);
        }

        // Wiki parity (2026-07-02): NO uppercase "Project" label above the row
        // (the wiki hub/leaf action rows carry no label), and the core button row
        // delegates responsive geometry to the shared sauce-action-row contract.
        // Historical source-probe compatibility (non-executable): the shared
        // class still provides `flex-wrap: wrap`, replacing the old call shape
        // `customJS.AccentButton.render(container, { flex: true })`.
        const container = root.createEl("div", { cls: "sauce-action-row" });

        // WS3 — split the built nav row into a `core` row (rendered inline) and
        // an `overflow` set (Map / To-Do / Helpful Links) folded behind a "More"
        // menu, keeping the primary destinations one tap away without wrapping.
        const { core, overflow } = this._partitionButtons(buttons);

        // v0.100.0 — nav buttons delegate to the shared AccentButton mechanism:
        // identical styling to the New Doc / New Note buttons by construction,
        // flex: true stretches the row across the full note width.
        // btn.path is an ABSOLUTE vault path. _openNavTarget resolves it to the
        // TFile and opens that directly — openLinkText treats its first arg as a
        // LINK TEXT (linkpath) resolved relative to the sourcePath, which on a cold
        // metadata cache can re-prefix an absolute path with the current note's
        // folder (the doubled-path bug: spice/projects/<slug>/spice/projects/<slug>/…).
        // openFile bypasses the link resolver entirely; openLinkText is the fallback
        // only when the file isn't indexed yet.
        for (const btn of core) {
            this._adoptButton(customJS.AccentButton.render(container, {
                label: btn.label,
                icon: btn.icon,
                onClick: () => this._openNavTarget(btn.path)
            }));
        }

        // WS3 — "More ▾" opens an overlay listing the overflow destinations.
        // Rendered only when there is at least one overflow button. Capture the
        // rendered element so the launcher (mirroring the Go-to launcher) can
        // anchor its desktop dropdown to it via getBoundingClientRect.
        if (overflow.length > 0) {
            const moreIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
            const moreBtn = customJS.AccentButton.render(container, {
                label: "More",
                icon: moreIcon,
                onClick: () => this._openMoreMenu(overflow, moreBtn)
            });
            this._adoptButton(moreBtn);
        }

        // --- Workstream widget (card notes only) ---
        const isCardNote = !isMainNote && !isMap && !isBoard && page.source_board;
        if (isCardNote && mainNote) {
            // (Dedupe handled by the root-level cleanup at the top of render.)
            const atlasCache = app.metadataCache.getFileCache(mainNote);
            let workstreams = atlasCache?.frontmatter?.workstreams || [];
            if (typeof workstreams === "string") {
                try { workstreams = JSON.parse(workstreams); } catch (e) { workstreams = []; }
            }
            if (!Array.isArray(workstreams)) workstreams = [];

            const currentWsId = String(page.workstream || "");
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
                const changeBtn = wsRow.createEl("button", { cls: "sauce-btn", text: matched ? "Change" : "Assign" });
                changeBtn.style.marginLeft = "auto";
                changeBtn.onclick = () => this._openWorkstreamPicker(workstreams, currentWsId, filePath);
            }
        }

        // Action button row: New Note (task-hub or task-note)
        if (ctx.context === "task-hub" || ctx.context === "task-note") {
            const taskHubPath = ctx.context === "task-hub"
                ? filePath
                : `${projectDir}/tasks/${ctx.taskFolder}/${ctx.taskFolder}.md`;
            const notesFolder = `${projectDir}/tasks/${ctx.taskFolder}/notes`;
            const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;

            // Divider between project nav row and task action row — helper-owned
            // hairline (SectionLabel.divider) to match the vault-wide chrome
            // grammar, replacing the raw <hr>. Guarded against a cold-loading helper.
            if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(root);

            // Wiki-parity hub container: match the core nav row width + centering so
            // the task action buttons line up with the project nav buttons above.
            const actionRow = root.createEl("div", { cls: "sauce-action-row" });

            this._adoptButton(customJS.AccentButton.render(actionRow, {
                label: "New Note",
                icon: plusIcon,
                onClick: async () => {
                    const title = await this._promptForTitle(notesFolder);
                    if (!title) return;
                    const targetPath = await this._createTaskNote(notesFolder, title, projectSlug, ctx.taskFolder, taskHubPath, projectDir);
                    if (targetPath) {
                        new Notice(`Created: ${title}`);
                        app.workspace.openLinkText(targetPath, "");
                    }
                }
            }));

            if (ctx.context === "task-hub" || ctx.context === "task-note") {
                const boardPath = `${projectDir}/tasks/${ctx.taskFolder}/board/${ctx.taskFolder}-board.md`;
                const boardExists = !!app.vault.getAbstractFileByPath(boardPath);
                const boardIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;

                if (boardExists) {
                    this._adoptButton(customJS.AccentButton.render(actionRow, {
                        label: "Open Board",
                        icon: boardIcon,
                        onClick: async () => {
                            await this._openAsKanban(boardPath);
                        }
                    }));
                } else {
                    this._adoptButton(customJS.AccentButton.render(actionRow, {
                        label: "Create Board",
                        icon: boardIcon,
                        onClick: async () => {
                            const created = await this._createTaskBoard(projectDir, ctx.taskFolder);
                            if (created) {
                                new Notice("Task board created.");
                                await this._openAsKanban(created);
                            }
                        }
                    }));
                }
            }
        }

        // Auto-listing tiles: render notes/ folder contents for task-hub and task-note
        if (ctx.context === "task-hub" || ctx.context === "task-note") {
            const notesFolder = `${projectDir}/tasks/${ctx.taskFolder}/notes`;
            await this.renderTaskNoteTiles(root, notesFolder, filePath);
        }
    }

    // v0.103.0 S3.2: strip Obsidian link brackets off a frontmatter value,
    // returning the displayable label. Used by detectContext to resolve
    // section-hub parent_section into a clean basename for the parent-hub URL.
    //   "[[Knowledge]]"        → "Knowledge"
    //   "[[Path/To/Hub|Label]]" → "Path/To/Hub" (target wins for path use)
    //   Dataview Link object   → .path basename or .display
    _stripLinkBrackets(v) {
        if (!v) return "";
        if (typeof v === "string") return v.replace(/^\[\[|\]\]$/g, "").split("|")[0];
        if (v.display) return v.display;
        if (v.path) return v.path.split("/").pop().replace(/\.md$/, "");
        return "";
    }

    // v0.59.3: canonical created_at — ISO-8601 with TZ offset.
    // Matches _canonical-vocab.json regex:
    //   ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$
    _isoWithTz(d) {
        const pad = (n) => String(n).padStart(2, "0");
        const off = -d.getTimezoneOffset();
        const sign = off >= 0 ? "+" : "-";
        const oa = Math.abs(off);
        const oh = pad(Math.floor(oa / 60));
        const om = pad(oa % 60);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
    }
}
