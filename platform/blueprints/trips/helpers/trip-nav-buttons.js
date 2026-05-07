class TripNavButtons {
    detectContext(filePath, dv) {
        const pathParts = filePath.split("/");
        const tripsIdx = pathParts.indexOf("trips");
        if (tripsIdx < 1 || pathParts[tripsIdx - 1] !== "spice") {
            return { context: "non-trip" };
        }

        // spice/trips/Trips.md
        if (pathParts.length === tripsIdx + 2 && pathParts[tripsIdx + 1] === "Trips.md") {
            return { context: "trips-hub" };
        }

        const slug = pathParts[tripsIdx + 1];
        const tripDir = `spice/trips/${slug}`;

        // spice/trips/<slug>/<file>.md
        if (pathParts.length === tripsIdx + 3) {
            const cache = app.metadataCache.getFileCache(dv.current().file);
            const fmType = cache?.frontmatter?.type;
            if (fmType === "trip") {
                return { context: "trip-atlas", slug, tripDir };
            }
            return { context: "trip-section", slug, tripDir };
        }

        // spice/trips/<slug>/board/...
        if (pathParts[tripsIdx + 2] === "board") {
            // spice/trips/<slug>/board/<file>.md
            if (pathParts.length === tripsIdx + 4) {
                const basename = pathParts[tripsIdx + 3].replace(/\.md$/, "");
                if (basename.endsWith("-board")) {
                    return { context: "trip-board", slug, tripDir };
                }
                return { context: "trip-card", slug, tripDir };
            }
            // spice/trips/<slug>/board/<TaskName>/<file>.md (post-promote folder-style)
            if (pathParts.length === tripsIdx + 5) {
                return { context: "trip-card", slug, tripDir };
            }
        }

        return { context: "non-trip" };
    }

    async render(dv) {
        const filePath = dv.current().file.path;
        const ctx = this.detectContext(filePath, dv);

        // Dedupe: re-renders should replace previous output, not append.
        const previousRoot = dv.container.querySelector(":scope > .tnb-root");
        if (previousRoot) previousRoot.remove();
        const root = dv.container.createEl("div", { cls: "tnb-root" });

        if (ctx.context === "trips-hub") {
            await this._renderTripsHub(root);
            return;
        }
        if (ctx.context === "trip-atlas" || ctx.context === "trip-section") {
            await this._renderTripContext(root, ctx, filePath);
            return;
        }
        if (ctx.context === "trip-board" || ctx.context === "trip-card") {
            await this._renderBoardContext(root, ctx, filePath);
            return;
        }
        // non-trip → no render
    }

    async _renderTripContext(root, ctx, currentPath) {
        const folderObj = app.vault.getAbstractFileByPath(ctx.tripDir);
        if (!folderObj || !folderObj.children) return;

        const siblings = folderObj.children.filter(f => f.extension === "md");
        if (siblings.length === 0) return;

        let atlasFile = null;
        for (const f of siblings) {
            const cache = app.metadataCache.getFileCache(f);
            if (cache?.frontmatter?.type === "trip") {
                atlasFile = f;
                break;
            }
        }

        const icons = this._icons();
        const DEFAULT_ORDER = ["Flights", "Stay", "Packing List", "To Do", "Notes"];
        const sectionIconFor = (name) => {
            const map = {
                "Flights": icons.flights,
                "Stay": icons.stay,
                "Packing List": icons.packing,
                "To Do": icons.todo,
                "Notes": icons.notes
            };
            return map[name] || icons.section;
        };

        const defaults = [];
        const additional = [];
        for (const f of siblings) {
            if (f === atlasFile) continue;
            if (DEFAULT_ORDER.includes(f.basename)) defaults.push(f);
            else additional.push(f);
        }
        defaults.sort((a, b) => DEFAULT_ORDER.indexOf(a.basename) - DEFAULT_ORDER.indexOf(b.basename));
        additional.sort((a, b) => a.name.localeCompare(b.name));

        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Trip";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const buildRow = (buttons, opts) => {
            opts = opts || {};
            if (buttons.length === 0) return;
            const row = root.createEl("div");
            row.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 6px; overflow-x: auto;";
            const padding = opts.fullWidth ? "9px 16px" : "6px 14px";
            const fontSize = opts.fullWidth ? "0.9em" : "0.82em";
            const fontWeight = opts.fullWidth ? "600" : "500";
            const btnStyle = `cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: ${padding}; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: ${fontSize}; font-weight: ${fontWeight}; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; flex: 1; min-width: 0; white-space: nowrap;`;
            for (const btn of buttons) {
                const el = row.createEl("button");
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
        };

        // Row 1 — atlas (full-width, only when not on atlas)
        if (atlasFile && atlasFile.path !== currentPath) {
            buildRow([{ label: atlasFile.basename, icon: icons.trip, path: atlasFile.path }], { fullWidth: true });
        }

        // Row 2 — default sections + Trip Board; current self-hides
        const defaultButtons = defaults
            .filter(f => f.path !== currentPath)
            .map(f => ({ label: f.basename, icon: sectionIconFor(f.basename), path: f.path }));
        const boardPath = `${ctx.tripDir}/board/${ctx.slug}-board.md`;
        if (app.vault.getAbstractFileByPath(boardPath)) {
            defaultButtons.push({ label: "Trip Board", icon: icons.board, path: boardPath });
        }
        buildRow(defaultButtons);

        // Row 3 — additional sections (user-added); HIDDEN in trip-atlas context (cards grid covers it)
        if (ctx.context !== "trip-atlas") {
            const additionalButtons = additional
                .filter(f => f.path !== currentPath)
                .map(f => ({ label: f.basename, icon: icons.section, path: f.path }));
            buildRow(additionalButtons);
        }

        // "New Section" action button — atlas context only
        if (ctx.context === "trip-atlas" && atlasFile) {
            const divider = root.createEl("hr");
            divider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0;";

            const actionRow = root.createEl("div");
            actionRow.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px;";

            const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;

            this._renderActionButton(actionRow, "New Section", plusIcon, async () => {
                const title = await this._promptForSectionTitle(ctx.tripDir);
                if (!title) return;
                const sectionPath = await this._createTripSection(ctx.tripDir, title, atlasFile.basename);
                if (sectionPath) {
                    new Notice(`Created section: ${title}`);
                    app.workspace.openLinkText(sectionPath, "");
                }
            });
        }
    }

    async _renderTripsHub(root) {
        const actionRow = root.createEl("div");
        actionRow.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px;";

        const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;

        this._renderActionButton(actionRow, "New Trip", plusIcon, async () => {
            const details = await this._promptForTripDetails();
            if (!details) return;
            const atlasPath = await this._createTrip(details);
            if (atlasPath) {
                new Notice(`Created trip: ${details.name}`);
                app.workspace.openLinkText(atlasPath, "");
            }
        });
    }

    _renderActionButton(container, label, icon, onClick) {
        const btn = container.createEl("button");
        btn.innerHTML = icon + `<span>${label}</span>`;
        btn.style.cssText = `cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--interactive-accent); background: var(--background-primary); color: var(--interactive-accent); font-size: 0.82em; font-weight: 500; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; flex: 1; min-width: 0;`;
        btn.onmouseenter = () => { btn.style.background = "var(--interactive-accent)"; btn.style.color = "var(--text-on-accent)"; };
        btn.onmouseleave = () => { btn.style.background = "var(--background-primary)"; btn.style.color = "var(--interactive-accent)"; };
        btn.onclick = onClick;
        return btn;
    }

    _icons() {
        return {
            trip:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
            section: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
            flights: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
            stay:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
            packing: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
            todo:    `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
            notes:   `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
            board:   `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
        };
    }

    async _renderBoardContext(root, ctx, currentPath) {
        const folderObj = app.vault.getAbstractFileByPath(ctx.tripDir);
        if (!folderObj || !folderObj.children) return;

        let atlasFile = null;
        for (const f of folderObj.children) {
            if (f.extension !== "md") continue;
            const cache = app.metadataCache.getFileCache(f);
            if (cache?.frontmatter?.type === "trip") { atlasFile = f; break; }
        }

        const icons = this._icons();
        const buttons = [];
        if (atlasFile) {
            buttons.push({ label: atlasFile.basename, icon: icons.trip, path: atlasFile.path });
        }

        const boardPath = `${ctx.tripDir}/board/${ctx.slug}-board.md`;
        if (ctx.context === "trip-card" && app.vault.getAbstractFileByPath(boardPath)) {
            buttons.push({ label: "Trip Board", icon: icons.board, path: boardPath });
        }
        if (buttons.length === 0) return;

        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Trip";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        const row = root.createEl("div");
        row.style.cssText = "display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 4px; overflow-x: auto;";
        const btnStyle = `cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.9em; font-weight: 600; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; flex: 1; min-width: 0; white-space: nowrap;`;
        for (const btn of buttons) {
            const el = row.createEl("button");
            el.innerHTML = btn.icon + `<span>${btn.label}</span>`;
            el.style.cssText = btnStyle;
            el.onmouseenter = () => { el.style.background = "var(--interactive-accent)"; el.style.color = "var(--text-on-accent)"; el.style.borderColor = "var(--interactive-accent)"; };
            el.onmouseleave = () => { el.style.background = "var(--background-primary)"; el.style.color = "var(--text-muted)"; el.style.borderColor = "var(--background-modifier-border)"; };
            el.onclick = () => app.workspace.openLinkText(btn.path, "");
        }
    }

    async _promptForTripDetails() {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Trip";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const nameInput = this._addTextField(dialog, "Trip name");

            const slugDisplay = document.createElement("div");
            slugDisplay.style.cssText = "font-size: 0.78em; color: var(--text-muted); margin-bottom: 6px;";
            slugDisplay.textContent = "Slug:";
            dialog.appendChild(slugDisplay);

            const startDateInput = this._addDateField(dialog, "Start date");
            const endDateInput = this._addDateField(dialog, "End date");
            const locationInput = this._addTextField(dialog, "Location");

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const slugify = (n) => n.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

            const refresh = () => {
                const name = nameInput.value.trim();
                const slug = slugify(name);
                slugDisplay.textContent = slug ? `Slug: spice/trips/${slug}/` : "Slug:";
                if (!name) { status.textContent = ""; return; }
                const existing = app.vault.getAbstractFileByPath(`spice/trips/${slug}`);
                if (existing) {
                    status.textContent = `"${slug}" already exists. Try a different name.`;
                    status.style.color = "var(--text-error)";
                } else {
                    status.textContent = "";
                }
            };
            nameInput.addEventListener("input", refresh);

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
                const name = nameInput.value.trim();
                if (!name) return;
                const slug = slugify(name);
                if (!slug) { status.textContent = "Name must contain alphanumerics."; status.style.color = "var(--text-error)"; return; }
                if (app.vault.getAbstractFileByPath(`spice/trips/${slug}`)) { refresh(); nameInput.focus(); return; }
                document.body.removeChild(overlay);
                resolve({
                    name,
                    slug,
                    start_date: startDateInput.value || "",
                    end_date: endDateInput.value || "",
                    location: locationInput.value.trim() || "",
                });
            };

            const onKey = (e) => {
                if (e.key === "Enter") okBtn.click();
                if (e.key === "Escape") cancelBtn.click();
            };
            nameInput.addEventListener("keydown", onKey);
            startDateInput.addEventListener("keydown", onKey);
            endDateInput.addEventListener("keydown", onKey);
            locationInput.addEventListener("keydown", onKey);

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            overlay.addEventListener("click", (e) => { if (e.target === overlay) cancelBtn.click(); });
            document.body.appendChild(overlay);
            setTimeout(() => nameInput.focus(), 0);
        });
    }

    _addTextField(dialog, placeholder) {
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = placeholder;
        input.style.cssText = "width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; margin-bottom: 6px; box-sizing: border-box;";
        dialog.appendChild(input);
        return input;
    }

    _addDateField(dialog, label) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 6px;";
        const lab = document.createElement("label");
        lab.textContent = label;
        lab.style.cssText = "font-size: 0.85em; color: var(--text-muted); flex: 0 0 90px;";
        wrap.appendChild(lab);
        const input = document.createElement("input");
        input.type = "date";
        input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 1em; box-sizing: border-box;";
        wrap.appendChild(input);
        dialog.appendChild(wrap);
        return input;
    }

    async _promptForSectionTitle(tripDir) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 360px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);";

            const heading = document.createElement("div");
            heading.textContent = "New Section";
            heading.style.cssText = "font-size: 1.1em; font-weight: 600; margin-bottom: 12px;";
            dialog.appendChild(heading);

            const input = this._addTextField(dialog, "Section title (e.g. Honorees)");

            const status = document.createElement("div");
            status.style.cssText = "font-size: 0.8em; color: var(--text-muted); min-height: 1.2em; margin-bottom: 12px;";
            dialog.appendChild(status);

            const checkCollision = () => {
                const title = input.value.trim();
                if (!title) { status.textContent = ""; return; }
                if (app.vault.getAbstractFileByPath(`${tripDir}/${title}.md`)) {
                    status.textContent = `"${title}" already exists in this trip.`;
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
                if (app.vault.getAbstractFileByPath(`${tripDir}/${title}.md`)) { checkCollision(); input.focus(); return; }
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

    async _createTripSection(tripDir, title, atlasName) {
        const targetPath = `${tripDir}/${title}.md`;
        if (app.vault.getAbstractFileByPath(targetPath)) return targetPath;

        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const body = `---
created: ${dateStr}
tags:
  - trip
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "TripNavButtons" });
\`\`\`
`;

        await app.vault.create(targetPath, body);
        return targetPath;
    }

    async _createTrip({ name, slug, start_date, end_date, location }) {
        const tripDir = `spice/trips/${slug}`;
        const boardDir = `${tripDir}/board`;
        for (const dir of [tripDir, boardDir]) {
            if (!app.vault.getAbstractFileByPath(dir)) {
                await app.vault.createFolder(dir);
            }
        }

        const tplBase = "ranch/templates";
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const subs = (s) => s
            .replaceAll("{{NAME}}", name)
            .replaceAll("{{SLUG}}", slug)
            .replaceAll("{{DATE}}", dateStr)
            .replaceAll("{{START_DATE}}", start_date)
            .replaceAll("{{END_DATE}}", end_date)
            .replaceAll("{{LOCATION}}", location);

        const writeTpl = async (tplName, destBasename) => {
            const tplFile = app.vault.getAbstractFileByPath(`${tplBase}/${tplName}`);
            if (!tplFile) {
                new Notice(`Template missing: ${tplBase}/${tplName}`);
                return null;
            }
            const tpl = await app.vault.read(tplFile);
            const targetPath = `${tripDir}/${destBasename}`;
            if (app.vault.getAbstractFileByPath(targetPath)) return targetPath;
            await app.vault.create(targetPath, subs(tpl));
            return targetPath;
        };

        const atlasPath = await writeTpl("Template, Trip Atlas.md", `${name}.md`);
        await writeTpl("Template, Trip Flights.md", "Flights.md");
        await writeTpl("Template, Trip Stay.md", "Stay.md");
        await writeTpl("Template, Trip Packing List.md", "Packing List.md");
        await writeTpl("Template, Trip To Do.md", "To Do.md");
        await writeTpl("Template, Trip Notes.md", "Notes.md");
        await writeTpl("Template, Trip Board.md", `board/${slug}-board.md`);

        return atlasPath;
    }
}
