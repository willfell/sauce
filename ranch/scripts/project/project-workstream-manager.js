/**
 * Project Workstream Manager (CustomJS)
 * Renders Add/Remove buttons + workstream cards with progress bars.
 * Reads the kanban board to cross-reference task status per workstream.
 * Uses app.fileManager.processFrontMatter() for safe YAML serialization.
 *
 * Usage in DataviewJS (atlas note):
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
 */
class ProjectWorkstreamManager {
    // ── extracted per-call context (v0.190.x button-nav refactor) ──────────────
    // addWorkstream / removeWorkstream were CLOSURES inside render(); the chrome
    // bar's ⋯ menu needs to invoke the same Add / Remove flows without a render
    // pass. _wsCtx(dv) re-derives the small state each flow needs (the current
    // page, project dir, the parse/get/update/slugify helpers) from `dv` so the
    // methods are self-contained. render() calls the same methods for its own
    // Add / Remove buttons (no behavior change). Returns null on cold-load (no
    // page / no file), so both methods no-op safely.
    _wsCtx(dv) {
        const current = dv && dv.current ? dv.current() : null;
        if (!current || !current.file) return null;
        const filePath = current.file.path;
        const projectDir = filePath.substring(0, filePath.lastIndexOf("/"));
        const projectSlug = projectDir.split("/").pop();

        const parseWorkstreams = (raw) => {
            if (!raw) return [];
            if (typeof raw === "string") {
                try { raw = JSON.parse(raw); } catch (e) { return []; }
            }
            return Array.isArray(raw) ? raw : [];
        };
        const getWorkstreams = () => parseWorkstreams(current.workstreams);

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

        return { current, filePath, projectDir, projectSlug, getWorkstreams, updateWorkstreams, slugify };
    }

    // Shared overlay-modal shell (moved out of render() verbatim so the extracted
    // Add / Remove methods reuse it). Instance method — customJS stores instances.
    _showModal(content) {
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
        const dialog = document.createElement("div");
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";
        content(dialog, () => document.body.removeChild(overlay));
        overlay.appendChild(dialog);
        overlay.addEventListener("click", e => { if (e.target === overlay) document.body.removeChild(overlay); });
        document.body.appendChild(overlay);
    }

    // Add a workstream — opens the name/description modal, writes the new
    // workstreams[] via processFrontMatter (atlas + map). Extracted from render()
    // so the chrome bar's ⋯ "Add workstream" can call it directly. Never throws.
    addWorkstream(dv) {
        const ctx = this._wsCtx(dv);
        if (!ctx) { try { new Notice("Open a project note to add a workstream."); } catch (_e) {} return; }
        const { getWorkstreams, updateWorkstreams, slugify } = ctx;
        this._showModal((dialog, close) => {
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
    }

    // Remove a workstream — opens the pick-one list, writes the filtered
    // workstreams[] via processFrontMatter. Extracted from render() so the chrome
    // bar's ⋯ "Remove workstream" can call it directly. Never throws.
    removeWorkstream(dv) {
        const ctx = this._wsCtx(dv);
        if (!ctx) { try { new Notice("Open a project note to remove a workstream."); } catch (_e) {} return; }
        const { getWorkstreams, updateWorkstreams } = ctx;
        const cur = getWorkstreams();
        if (cur.length === 0) { new Notice("No workstreams to remove."); return; }
        this._showModal((dialog, close) => {
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
    }

    async render(dv, opts = {}) {
        // contentOnly (v0.191 chrome-bar refactor): the Project Map's chrome bar
        // (ProjectChromeBar) now owns the Add / Remove workstream affordances as
        // its primary + ⋯ overflow actions, so the Map template calls this helper
        // in { contentOnly: true } mode to render ONLY the workstream content
        // (label + progress summary + per-workstream cards + unassigned note) and
        // suppress the redundant Add / Remove button row. The Add/Remove flows
        // themselves stay as instance methods (addWorkstream / removeWorkstream)
        // which the chrome bar dispatches directly.
        const contentOnly = !!(opts && opts.contentOnly);
        const current = dv && dv.current ? dv.current() : null;
        // v0.119.0 PATCH: bail when Dataview hasn't indexed the file yet
        // (typically the first render after EntityCreate.openFile on a newly
        // created project). Next render tick will succeed.
        if (!current || !current.file) return;
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

        // Add / Remove workstream flows now live as instance methods
        // (this.addWorkstream / this.removeWorkstream) so the chrome bar's ⋯ menu
        // can invoke them without a render pass; the buttons below delegate.

        // v0.109.0 S5 — emit the canonical Workstreams section label at the top.
        // Template, Project.md dropped the `## Workstreams` H2 in this cycle;
        // the helper now owns the label so the section reads cohesively
        // alongside ProjectMeetingsPanel's "Meetings" SectionLabel.
        customJS.SectionLabel.render(dv, { text: "Workstreams" });

        const root = dv.container.createEl("div");

        // Action row (Add / Remove) — suppressed in contentOnly mode: the chrome
        // bar owns these affordances. In legacy (non-chrome-bar) callers the row
        // still renders so behavior is unchanged there.
        if (!contentOnly) {
            const btnRow = root.createEl("div");
            btnRow.style.cssText = "display: flex; gap: 8px; margin-bottom: 10px;";

            const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
            const minusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`;

            customJS.AccentButton.render(btnRow, { label: "Add", icon: plusIcon, onClick: () => this.addWorkstream(dv) });
            customJS.AccentButton.render(btnRow, { label: "Remove", icon: minusIcon, onClick: () => this.removeWorkstream(dv) });
        }

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
