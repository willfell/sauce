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
            const page = customJS.RenderSafe.page(dv);
            const cache = app.metadataCache.getFileCache(page.file);
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
        const page = customJS.RenderSafe.page(dv);
        if (!page || !page.file) return;
        const filePath = page.file.path;
        const ctx = this.detectContext(filePath, dv);

        // Dedupe: re-renders should replace previous output, not append.
        const previousRoot = dv.container.querySelector(":scope > .tnb-root");
        if (previousRoot) previousRoot.remove();
        const root = dv.container.createEl("div", { cls: "tnb-root" });

        if (ctx.context === "trips-hub") {
            await this._renderTripsHub(root);
            return;
        }
        if (ctx.context === "trip-atlas" || ctx.context === "trip-section"
            || ctx.context === "trip-board" || ctx.context === "trip-card") {
            await this._renderTripNav(root, ctx, filePath, dv);
            return;
        }
        // non-trip → no render
    }

    // ── Menu-entry model (pure; tests stub _siblingsFor/_boardPathIfExists) ──

    _sanitizeFilename(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    }

    // Read the trip folder's .md children into a stub-friendly shape.
    _siblingsFor(ctx) {
        const folder = app.vault.getAbstractFileByPath(ctx.tripDir);
        if (!folder || !folder.children) return [];
        return folder.children
            .filter(f => f.extension === "md")
            .map(f => ({
                basename: f.basename,
                path: f.path,
                fm: (app.metadataCache.getFileCache(f)?.frontmatter) || {},
            }));
    }

    _boardPathIfExists(ctx) {
        const p = `${ctx.tripDir}/board/${ctx.slug}-board.md`;
        return app.vault.getAbstractFileByPath(p) ? p : null;
    }

    // Partition the trip folder into { primary (atlas), entries } for the launcher.
    _tripMenuEntries(ctx, currentPath) {
        const sibs = this._siblingsFor(ctx);
        const atlas = sibs.find(s => s.fm.type === "trip") || null;

        const primary = (ctx.context !== "trip-atlas" && atlas && atlas.path !== currentPath)
            ? { label: atlas.basename, icon: this._icons().trip, path: atlas.path }
            : null;

        const sections = sibs
            .filter(s => s.fm.type === "trip-section" && s.path !== currentPath)
            .sort((a, b) => {
                const oa = customJS.TripSectionKinds.order(a.fm.section_kind);
                const ob = customJS.TripSectionKinds.order(b.fm.section_kind);
                if (oa !== ob) return oa - ob;
                return (a.fm.section || a.basename).localeCompare(b.fm.section || b.basename);
            })
            .map(s => ({
                label: s.fm.section || s.basename,
                icon: customJS.TripSectionKinds.iconFor(s.fm.section_kind),
                path: s.path,
            }));

        const entries = [...sections];

        const bp = this._boardPathIfExists(ctx);
        if (bp && bp !== currentPath) {
            entries.push({ label: "Trip Board", icon: this._icons().board, path: bp });
        }

        // No `label` on the action entry: `label || action` resolves to the
        // action so the launcher menu shows a "+ New Section" affordance last.
        entries.push({ action: "new-section", displayLabel: "New Section", icon: this._plusIcon() });

        return { primary, entries };
    }

    _plusIcon() {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`;
    }

    // ── Per-trip nav render: SectionLabel band + primary + "Go to…" launcher ──
    async _renderTripNav(root, ctx, currentPath, dv) {
        const { primary, entries } = this._tripMenuEntries(ctx, currentPath);
        if (!primary && entries.length === 0) return;

        // "Trip" band — hand-drawn hairline + muted uppercase label (SectionLabel visual).
        const topDivider = root.createEl("hr");
        topDivider.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 8px 0 6px 0;";

        const sectionLabel = root.createEl("div");
        sectionLabel.textContent = "Trip";
        sectionLabel.style.cssText = "font-size: 0.72em; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;";

        // Bind the new-section entry to a closure so the launcher can run the flow.
        for (const e of entries) {
            if (e.action === "new-section") {
                e.onSelect = async () => {
                    const title = await this._promptForSectionTitle(ctx.tripDir);
                    if (!title) return;
                    const atlas = this._siblingsFor(ctx).find(s => s.fm.type === "trip");
                    const atlasBase = atlas ? atlas.basename : ctx.slug;
                    const p = await this._createTripSection(ctx.tripDir, title, atlasBase, ctx.slug);
                    if (p) {
                        new Notice(`Created section: ${title}`);
                        app.workspace.openLinkText(p, "");
                    }
                };
            }
        }

        const row = root.createEl("div");
        row.style.cssText = "display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;";

        if (primary) {
            const btnStyle = `cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 9px 16px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted); font-size: 0.9em; font-weight: 600; font-family: inherit; letter-spacing: 0.01em; transition: all 0.15s ease; flex: 1; min-width: 0; white-space: nowrap;`;
            const el = row.createEl("button");
            el.innerHTML = primary.icon + `<span>${primary.label}</span>`;
            el.style.cssText = btnStyle;
            el.onmouseenter = () => { el.style.background = "var(--interactive-accent)"; el.style.color = "var(--text-on-accent)"; el.style.borderColor = "var(--interactive-accent)"; };
            el.onmouseleave = () => { el.style.background = "var(--background-primary)"; el.style.color = "var(--text-muted)"; el.style.borderColor = "var(--background-modifier-border)"; };
            el.onclick = () => app.workspace.openLinkText(primary.path, "");
        }

        this._renderPill(row, entries, dv, !primary);
    }

    // ── Launcher pill + overlay (ported from SpaceNavButtons) ────────────────

    _stylePill(el) {
        el.style.cssText = `
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 10px;
            border-radius: 6px;
            border: 1px solid var(--background-modifier-border);
            background: var(--background-primary);
            color: var(--text-muted);
            font-size: 0.82em;
            font-weight: 500;
            font-family: inherit;
            letter-spacing: 0.01em;
            transition: all 0.15s ease;
        `;
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
    }

    // Render the "Go to…" pill; wire its click to the launcher overlay. When
    // there is no primary (on the atlas) the pill spans the full row width.
    _renderPill(row, menuEntries, dv, fullWidth) {
        const pill = row.createEl("button");
        const gridIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`;
        const chevronDown = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
        pill.innerHTML = gridIcon + `<span>Go to…</span>` + chevronDown;
        this._stylePill(pill);
        if (fullWidth) { pill.style.flex = "1"; pill.style.justifyContent = "center"; pill.style.minWidth = "0"; }
        pill.onclick = (evt) => this._openLauncher(evt, pill, menuEntries, dv);
        return pill;
    }

    // Open the launcher as a viewport overlay appended to document.body (so it is
    // never clipped by the note container): a full-width bottom sheet on mobile,
    // an anchored dropdown on desktop. Backdrop-tap / Escape / re-tap closes it.
    _openLauncher(evt, pill, menuEntries, dv) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        const doc = (typeof activeDocument !== "undefined" && activeDocument) || (typeof document !== "undefined" ? document : null);
        if (!doc || !doc.body) return;

        // Toggle: an already-open overlay means "close" — route through its own
        // teardown (__navClose) so the keydown listener is removed too.
        const open = doc.body.querySelector && doc.body.querySelector(".vault-nav-overlay");
        if (open) { if (open.__navClose) open.__navClose(); else if (open.remove) open.remove(); return; }

        const isMobile = !!(typeof app !== "undefined" && app && app.isMobile);

        const overlay = doc.createElement("div");
        overlay.className = "vault-nav-overlay";
        overlay.style.cssText = `position: fixed; inset: 0; z-index: 1000;`
            + (isMobile
                ? " background: rgba(0,0,0,0.45); display: flex; align-items: flex-end; justify-content: center;"
                : " background: transparent;");

        const panel = doc.createElement("div");
        panel.className = "vault-nav-panel";
        const panelBase = `box-sizing: border-box; background: var(--background-primary);`
            + ` border: 1px solid var(--background-modifier-border);`
            + ` box-shadow: 0 8px 30px rgba(0,0,0,0.30); overflow-y: auto;`
            + ` display: flex; flex-direction: column;`;
        if (isMobile) {
            panel.style.cssText = panelBase
                + ` width: 100%; max-width: 620px; max-height: 72vh;`
                + ` border-radius: 16px 16px 0 0;`
                + ` padding: 8px 8px calc(10px + env(safe-area-inset-bottom, 0px));`
                + ` gap: 2px;`;
            const handle = doc.createElement("div");
            handle.style.cssText = `flex: 0 0 auto; width: 40px; height: 4px; border-radius: 2px; background: var(--background-modifier-border); margin: 4px auto 8px;`;
            panel.appendChild(handle);
        } else {
            const rect = (pill && pill.getBoundingClientRect) ? pill.getBoundingClientRect() : { left: 0, bottom: 0, width: 0 };
            const vw = (typeof window !== "undefined" && window.innerWidth) || 1024;
            const width = Math.min(vw - 16, Math.max(300, Math.round(rect.width) || 0));
            let left = Math.round(rect.left || 0);
            if (left + width > vw - 8) left = Math.max(8, vw - 8 - width);
            panel.style.cssText = panelBase
                + ` position: fixed; top: ${Math.round((rect.bottom || 0) + 6)}px; left: ${left}px;`
                + ` width: ${width}px; max-height: 60vh; border-radius: 8px; padding: 6px; gap: 1px;`;
        }

        // Single teardown for ALL dismiss paths (backdrop, Escape, re-tap toggle,
        // row select) — removes the overlay AND the keydown listener so a stale
        // capture-phase Escape handler can never swallow keys elsewhere.
        const close = () => {
            if (overlay.remove) overlay.remove();
            if (doc.removeEventListener) doc.removeEventListener("keydown", onKey, true);
        };
        const onKey = (e) => { if (e && e.key === "Escape") { if (e.preventDefault) e.preventDefault(); close(); } };
        overlay.__navClose = close;

        for (const btn of menuEntries) {
            panel.appendChild(this._buildOverlayRow(doc, btn, dv, close, isMobile));
        }

        overlay.onclick = (e) => { if (e && e.target === overlay) close(); };
        if (doc.addEventListener) doc.addEventListener("keydown", onKey, true);

        overlay.appendChild(panel);
        doc.body.appendChild(overlay);
    }

    // Build a single overlay row (inline entry.icon + full label). New-section
    // rows run their bound onSelect closure; every other row opens its note.
    _buildOverlayRow(doc, entry, dv, close, isMobile) {
        const row = doc.createElement("button");
        const svg = entry.icon || "";
        const label = entry.label || entry.displayLabel || "";
        row.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 auto;">${svg}</span>`
            + `<span style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>`;
        row.style.cssText = `cursor: pointer; display: flex; align-items: center; gap: 10px;`
            + ` width: 100%; text-align: left; box-sizing: border-box; border: none;`
            + ` border-radius: 8px; background: transparent; color: var(--text-normal);`
            + ` font-family: inherit; line-height: 1.25;`
            + (isMobile ? " padding: 12px; font-size: 1em;" : " padding: 8px 10px; font-size: 0.9em;");
        row.onmouseenter = () => { row.style.background = "var(--background-modifier-hover)"; };
        row.onmouseleave = () => { row.style.background = "transparent"; };
        row.onclick = () => {
            close();
            if (entry.onSelect) return entry.onSelect();
            return app.workspace.openLinkText(entry.path, "");
        };
        return row;
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
            board:   `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
        };
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

    async _createTripSection(tripDir, title, tripName, tripSlug) {
        const targetPath = `${tripDir}/${this._sanitizeFilename(tripName)} — ${this._sanitizeFilename(title)}.md`;
        if (app.vault.getAbstractFileByPath(targetPath)) return targetPath;

        const isoTz = this._isoWithTz(new Date());

        const body = `---
type: trip-section
section_kind: custom
section: "${title}"
trip: "[[${this._sanitizeFilename(tripName)}]]"
trip_slug: ${tripSlug}
created_at: "${isoTz}"
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

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
        const isoTz = this._isoWithTz(new Date());
        const atlasBase = this._sanitizeFilename(name);

        // The atlas keeps the raw display `name` for {{NAME}} (its own frontmatter
        // title). Section templates use {{NAME}} only inside `trip: "[[{{NAME}}]]"`,
        // which must resolve to the atlas BASENAME (= sanitize(name)) so the link
        // targets the actual atlas note.
        const makeSubs = (nameVal) => (s) => s
            .replaceAll("{{NAME}}", nameVal)
            .replaceAll("{{SLUG}}", slug)
            .replaceAll("{{DATE}}", isoTz)
            .replaceAll("{{START_DATE}}", start_date)
            .replaceAll("{{END_DATE}}", end_date)
            .replaceAll("{{LOCATION}}", location);
        const subsAtlas = makeSubs(name);
        const subsSection = makeSubs(atlasBase);

        const writeTpl = async (tplName, destBasename, subs) => {
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

        const atlasPath = await writeTpl("Template, Trip Atlas.md", `${atlasBase}.md`, subsAtlas);
        for (const s of customJS.TripSectionKinds.all()) {
            await writeTpl(`Template, Trip ${s.label}.md`, `${atlasBase} — ${s.label}.md`, subsSection);
        }
        await writeTpl("Template, Trip Board.md", `board/${slug}-board.md`, subsAtlas);

        return atlasPath;
    }

    // v0.58.0 FA-6: canonical created_at format — ISO-8601 with TZ offset.
    // Matches _canonical-vocab.json's required regex
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
