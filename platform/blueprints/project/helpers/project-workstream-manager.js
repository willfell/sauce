/**
 * Project Workstream Manager (CustomJS)
 * Renders Add/Remove buttons + workstream cards with progress bars.
 * Reads the kanban board to cross-reference task status per workstream.
 * Routes gesture writes through RenderSafe.mutateStructure for optimistic
 * structural reconciliation with exact rollback receipts.
 *
 * Usage in DataviewJS (atlas note):
 *   await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
 */
class ProjectWorkstreamManager {
    _workstreamRoot(dv) {
        const container = dv && dv.container;
        const scopes = [container];
        try {
            const noteView = container?.closest?.(".markdown-preview-view, .markdown-reading-view, .markdown-source-view, .workspace-leaf-content");
            if (noteView) scopes.push(noteView);
        } catch (_e) {}
        try {
            const activeLeaf = (typeof document !== "undefined")
                ? document.querySelector?.(".workspace-leaf.mod-active .workspace-leaf-content") : null;
            if (activeLeaf) scopes.push(activeLeaf);
        } catch (_e) {}
        for (const scope of scopes) {
            try {
                const root = scope?.querySelector?.(".pwm-root");
                if (root) return root;
            } catch (_e) {}
        }
        return null;
    }

    _applyWorkstreamPreview(dv, before, after) {
        const root = this._workstreamRoot(dv);
        const cards = root && root.querySelector ? root.querySelector(".pwm-cards") : null;
        if (!cards) return null;
        let receipt = null;
        try {
        const priorIds = new Set((before || []).map((entry) => entry && entry.id).filter(Boolean));
        const nextIds = new Set((after || []).map((entry) => entry && entry.id).filter(Boolean));
        const removed = (before || []).find((entry) => entry && entry.id && !nextIds.has(entry.id));
        if (removed) {
            const node = Array.from(cards.children || []).find((child) =>
                String(child && child.dataset && child.dataset.workstreamId || "") === removed.id);
            if (!node) return null;
            const nextSibling = node.nextSibling || null;
            receipt = { kind: "remove", parent: cards, node, nextSibling };
            node.remove?.();
            return receipt;
        }
        const added = (after || []).find((entry) => entry && entry.id && !priorIds.has(entry.id));
        if (!added || typeof cards.createEl !== "function") return null;
        const node = cards.createEl("div", { cls: "pwm-card pwm-card-optimistic" });
        receipt = { kind: "insert", parent: cards, node };
        if (node.dataset) node.dataset.workstreamId = added.id;
        node.createEl("div", { text: added.name || added.id });
        if (added.description) node.createEl("div", { text: added.description });
        try { node.focus?.(); } catch (_e) {}
        return receipt;
        } catch (error) {
            this._rollbackWorkstreamPreview(receipt);
            throw error;
        }
    }

    _rollbackWorkstreamPreview(receipt) {
        if (!receipt) return;
        if (receipt.kind === "insert") receipt.node?.remove?.();
        if (receipt.kind === "remove" && receipt.parent && receipt.node) {
            receipt.parent.insertBefore?.(receipt.node, receipt.nextSibling || null);
        }
    }

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

        const findProjectNote = (type) => {
            return app.vault.getFiles().find(f =>
                f.path.substring(0, f.path.lastIndexOf("/")) === projectDir &&
                (() => {
                    const cache = app.metadataCache.getFileCache(f);
                    return cache?.frontmatter?.type === type;
                })()
            );
        };

        const updateWorkstreams = async (newWs, ui = {}) => {
            const atlasFile = findProjectNote("project");
            const mapFile = findProjectNote("map");
            const targets = [atlasFile, mapFile].filter((file, index, all) =>
                file && all.findIndex((candidate) => candidate && candidate.path === file.path) === index
            );
            const renderSafe = globalThis.customJS?.RenderSafe;
            if (!renderSafe || typeof renderSafe.mutateStructure !== "function") {
                new Notice("Could not update workstreams: RenderSafe is unavailable.", 6000);
                return false;
            }
            const result = await renderSafe.mutateStructure({
                app,
                dv,
                path: filePath,
                failureMessage: "Could not update workstreams",
                apply: () => {
                    const hadValue = Object.prototype.hasOwnProperty.call(current, "workstreams");
                    const priorValue = current.workstreams;
                    const priorList = getWorkstreams();
                    const focusTarget = ui.focusTarget
                        || ((typeof document !== "undefined") ? document.activeElement : null);
                    current.workstreams = newWs;
                    let dom = null;
                    try {
                        dom = this._applyWorkstreamPreview(dv, priorList, newWs);
                        if (!dom) throw new Error("Workstream surface is unavailable");
                    } catch (error) {
                        if (hadValue) current.workstreams = priorValue;
                        else delete current.workstreams;
                        throw error;
                    }
                    return {
                        current, hadValue, priorValue, focusTarget, dom,
                        modal: ui.modal || null,
                        triggerFocus: ui.triggerFocus || null,
                    };
                },
                rollback: (receipt) => {
                    this._rollbackWorkstreamPreview(receipt && receipt.dom);
                    if (receipt && receipt.current) {
                        if (receipt.hadValue) receipt.current.workstreams = receipt.priorValue;
                        else delete receipt.current.workstreams;
                    }
                    try { receipt && receipt.focusTarget && receipt.focusTarget.focus?.(); } catch (_e) {}
                },
                write: async () => {
                    for (const target of targets) {
                        await app.fileManager.processFrontMatter(target, fm => { fm.workstreams = newWs; });
                    }
                },
            });
            return result.ok === true;
        };

        const slugify = (str) => {
            return str.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
        };

        return { current, filePath, projectDir, projectSlug, getWorkstreams, updateWorkstreams, slugify };
    }

    // Shared overlay-modal shell (moved out of render() verbatim so the extracted
    // Add / Remove methods reuse it). Instance method — customJS stores instances.
    _showModal(content) {
        const triggerFocus = (typeof document !== "undefined") ? document.activeElement : null;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
        const dialog = document.createElement("div");
        dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 320px; max-width: 420px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";
        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            else overlay.remove?.();
        };
        close.overlay = overlay;
        close.dialog = dialog;
        close.triggerFocus = triggerFocus;
        content(dialog, close);
        overlay.appendChild(dialog);
        overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
        document.body.appendChild(overlay);
        return { overlay, dialog, close, triggerFocus };
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
            let submitting = false;
            const submit = async () => {
                if (submitting) return false;
                const name = nameInput.value.trim();
                if (!name) { try { nameInput.focus?.(); } catch (_e) {} return false; }
                const id = slugify(name);
                if (!id) { try { nameInput.focus?.(); } catch (_e) {} return false; }
                const cur = getWorkstreams();
                if (cur.some(w => w.id === id)) { new Notice(`"${id}" already exists.`); close(); return; }
                submitting = true;
                const saved = await updateWorkstreams([...cur, { id, name, description: descInput.value.trim() }], {
                    modal: { overlay: close.overlay, dialog: close.dialog },
                    triggerFocus: close.triggerFocus,
                    focusTarget: okBtn,
                });
                submitting = false;
                if (saved) {
                    close();
                    new Notice(`Added workstream: ${name}`);
                } else { try { okBtn.focus?.(); } catch (_e) {} }
                return saved;
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
                    const saved = await updateWorkstreams(cur.filter(x => x.id !== w.id), {
                        modal: { overlay: close.overlay, dialog: close.dialog },
                        triggerFocus: close.triggerFocus,
                        focusTarget: item,
                    });
                    if (saved) {
                        close();
                        new Notice(`Removed: ${w.name}`);
                    } else { try { item.focus?.(); } catch (_e) {} }
                    return saved;
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
                if (line.startsWith("## ")) { // lint-display-markers:allow kanban column syntax
                    currentLane = line.replace("## ", "").trim(); // lint-display-markers:allow kanban column syntax
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

        const root = dv.container.createEl("div", { cls: "pwm-root" });

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

        const cards = root.createEl("div", { cls: "pwm-cards" });
        cards.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
        if (ws.length > 0) {

            for (const w of ws) {
                const tasks = wsTaskMap[w.id] || [];
                const done = tasks.filter(t => t.lane === "Completed").length;
                const total = tasks.length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const blocked = tasks.filter(t => t.lane === "Blocked").length;

                const card = cards.createEl("div", { cls: "pwm-card" });
                if (card.dataset) card.dataset.workstreamId = w.id;
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
