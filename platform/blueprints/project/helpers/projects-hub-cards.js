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
    _statusPill(status) {
        const colors = {
            "in-progress": "var(--color-green)",
            "planning":    "var(--color-cyan)",
            "blocked":     "var(--color-yellow)",
            "idea":        "var(--text-muted)",
            "done":        "var(--text-faint)",
            "superseded":  "var(--text-faint)",
            "cancelled":   "var(--text-faint)"
        };
        const color = colors[status] || "var(--text-muted)";
        return `<span style="background:${color}1A;color:${color};padding:2px 8px;border-radius:10px;font-size:0.8em;font-weight:600;">${status || "?"}</span>`;
    }

    _chipList(links) {
        if (!links || !links.length) return "";
        return links.map(l => `<span style="background:var(--background-secondary);padding:1px 6px;border-radius:4px;font-size:0.8em;margin-right:4px;">${l.path.split("/").pop().replace(/\.md$/, "")}</span>`).join("");
    }

    // WS1 chrome overhaul: the hub is sorted, not filtered. Two modes persist to
    // localStorage under "sauce.projects-hub.sort": "mtime" (default — most-
    // recently-edited first) and "alpha" (A–Z by display name, case-insensitive).
    _SORT_KEY = "sauce.projects-hub.sort";

    _readSortMode() {
        try {
            if (typeof localStorage === "undefined") return "mtime";
            const raw = localStorage.getItem(this._SORT_KEY);
            return (raw === "mtime" || raw === "alpha") ? raw : "mtime";
        } catch (_e) { return "mtime"; }
    }

    _writeSortMode(mode) {
        const m = (mode === "mtime" || mode === "alpha") ? mode : "mtime";
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(this._SORT_KEY, m);
        } catch (_e) { /* private-mode / disabled storage — non-fatal */ }
    }

    // Archived projects (status: archived) are HIDDEN by default. Toggle
    // persists to localStorage under this key; default OFF (false).
    _ARCH_KEY = "sauce.projects-hub.show-archived";

    _readShowArchived() {
        try {
            if (typeof localStorage === "undefined") return false;
            return localStorage.getItem(this._ARCH_KEY) === "true";
        } catch (_e) { return false; }
    }

    _writeShowArchived(on) {
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(this._ARCH_KEY, on ? "true" : "false");
        } catch (_e) { /* private-mode — non-fatal */ }
    }

    // Pure: drop status==='archived' projects unless showArchived. New array.
    _filterArchived(pages, showArchived) {
        const list = [...(pages || [])];
        if (showArchived) return list;
        return list.filter(p => String(p && p.status || "").trim() !== "archived");
    }

    // Pure, no DOM. Reads latestMtime from this._lookup (the SAME accessor the
    // render path + per-card meta use) so sort order matches the displayed
    // "last activity" timestamp. Returns a NEW array; never mutates the input.
    _sortProjects(pages, mode) {
        const list = [...(pages || [])];
        const lookup = this._lookup;
        const mtimeOf = (p) => {
            const e = lookup && lookup.get ? lookup.get(p.file.path) : null;
            return (e && e.latestMtime && e.latestMtime.ts) || 0;
        };
        const nameOf = (p) => String(p.name || p.file.name || "").toLowerCase();
        if (mode === "alpha") {
            return list.sort((a, b) => {
                const cmp = nameOf(a).localeCompare(nameOf(b));
                if (cmp !== 0) return cmp;
                return mtimeOf(b) - mtimeOf(a);   // stable tiebreak: recent first
            });
        }
        // default: "mtime" DESC (most-recently-edited first).
        return list.sort((a, b) => {
            const d = mtimeOf(b) - mtimeOf(a);
            if (d !== 0) return d;
            return nameOf(a).localeCompare(nameOf(b));   // stable tiebreak: A–Z
        });
    }

    // Control row above the grid: [ Sort: … ]  [ Archived: … ] — two pills.
    // Sort flips mtime↔alpha; archived flips hide↔show. Both persist + rebuild
    // ONLY the grid (this._gridEl), not the whole view.
    _renderSortToggle(dv) {
        const row = dv.container.createEl("div");
        row.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin:0 0 6px 0;";
        const pill = () => {
            const b = row.createEl("button");
            b.style.cssText = "cursor:pointer;font-size:0.8em;padding:3px 10px;border-radius:12px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);";
            return b;
        };

        const sortBtn = pill();
        const sortLabel = () => this._sortMode === "alpha" ? "Sort: A–Z" : "Sort: Last edited";
        sortBtn.textContent = sortLabel();
        sortBtn.addEventListener("click", async () => {
            this._sortMode = this._sortMode === "alpha" ? "mtime" : "alpha";
            this._writeSortMode(this._sortMode);
            sortBtn.textContent = sortLabel();
            await this._rebuildGrid();
        });

        const archBtn = pill();
        const archLabel = () => this._showArchived ? "Archived: shown" : "Archived: hidden";
        archBtn.textContent = archLabel();
        archBtn.addEventListener("click", async () => {
            this._showArchived = !this._showArchived;
            this._writeShowArchived(this._showArchived);
            archBtn.textContent = archLabel();
            this._pages = this._filterArchived(this._allPages || [], this._showArchived);
            await this._rebuildGrid();
        });
    }

    // Rebuild ONLY the card grid in place using the current sort mode. Reuses
    // this._gridEl (a container created inside _renderInner) + this._pages
    // (the enriched, filtered project list captured on first render).
    async _rebuildGrid() {
        if (!this._gridEl) return;
        this._gridEl.empty();
        const proxy = this._makeProxyDv(null, this._gridEl);
        await this._renderCards(proxy, this._sortProjects(this._pages || [], this._sortMode));
    }

    // WS1: the New Project button in its OWN full-width, centered row, bracketed
    // by SectionLabel dividers above + below (no blank-line gaps). Dispatched
    // from the Projects.md `// entity-create:project` marker block via the
    // customjs-guard (keeps the installer/entity-create smoke marker intact
    // while giving the button full-width chrome the marker block alone can't).
    async renderNewProjectButton(dv) {
        if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(dv);

        const row = dv.container.createEl("div");
        row.style.cssText = "display:flex;justify-content:center;margin:0;";
        const proxy = this._makeProxyDv(dv, row);

        // Cold-load race: poll for EntityCreate (mirrors section-hub.js).
        for (let i = 0; i < 40 && !window.customJS?.EntityCreate; i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (window.customJS?.EntityCreate) {
            await customJS.EntityCreate.render(proxy, { instance: "project" });
            // Stretch the rendered button to fill the row (full-width, centered).
            for (const btn of row.querySelectorAll("button")) {
                btn.style.flex = "1 1 100%";
                btn.style.width = "100%";
            }
        }

        if (customJS?.SectionLabel?.divider) customJS.SectionLabel.divider(dv);
    }

    async render(dv) {
        // WS1 chrome overhaul: no status/team/product scope filters. Every project
        // is shown; ordering is the only knob (sort mode, persisted).
        this._sortMode = this._readSortMode();
        this._showArchived = this._readShowArchived();

        // DocSearch stays as the filter strip above the grid. Wiki parity
        // (2026-07-02): hideNativeSearch dropped so the scoped "Search" button
        // shows (matches the wiki). persist:false → the box never remembers text
        // across visits; hideTags:true drops the tag-chip pool.
        const filterCtx = customJS.DocSearch.render(dv, {
            entityType: "project",
            scopePath:  "spice/projects",
            recursive:  true,
            placeholder: "Filter projects by name or tag…",
            hideTags: true,           // projects hub: drop the tag-chip section entirely
            persist:  false,          // projects hub: search box never remembers text across visits
            onChange: async (ctx) => {
                this._filterCtx = ctx;
                ctx.resultsContainer.empty();
                await this._renderInner(this._makeProxyDv(dv, ctx.resultsContainer));
            },
        });
        // Wiki parity: normalize the shared search strip's top gap to 12px.
        try { const strip = dv.container.querySelector(".doc-search-strip"); if (strip && strip.style) strip.style.marginTop = "12px"; } catch (_e) {}
        this._filterCtx = filterCtx;

        // First-render INTO resultsContainer.
        await this._renderInner(this._makeProxyDv(dv, filterCtx.resultsContainer));
    }

    _makeProxyDv(dv, container) {
        return {
            container,
            current: dv ? dv.current.bind(dv) : (() => null),
            pages:   dv ? dv.pages.bind(dv)   : (() => []),
            el: (tag, txt, opts) => {
                const el = container.createEl(tag, { ...(opts || {}) });
                if (txt !== undefined && txt !== null && txt !== "") el.textContent = String(txt);
                return el;
            },
            header: (lvl, txt) => container.createEl(`h${lvl}`, { text: String(txt) }),
            paragraph: (txt) => { const p = container.createEl("p"); p.innerHTML = String(txt); return p; },
        };
    }

    async _renderInner(dv) {
        // v1.4.1 (S6.5 CF-1): match the hub note via EITHER the new canonical
        // `type: project` discriminator (v1.4.0+) OR the legacy `#project` tag
        // (pre-v1.4.0). Older projects in long-running consumer vaults don't
        // have `type: project` yet; the OR keeps them surfaced.
        //
        // Defensive type-exclusions handle dataview's nested-tag expansion:
        // `tags: [project/widget]` produces etags `[#project, #project/widget]`,
        // which means Project Map.md (type: map) and Project Board.md (type: kanban)
        // would be falsely included by the etag check alone. Filter them out by
        // explicit type, plus the legacy `-board` filename guard for safety.
        //
        // WS1: the only filter is DocSearch text (persist:false); no status/team/
        // product scope. All non-hub project notes are candidates.
        const projectHubs = dv.pages('"spice/projects"')
            .where(p => (p.type === "project"
                      || (p.file.etags.includes("#project")
                          && p.type !== "map"
                          && p.type !== "kanban"))
                     && p.file.name !== "Projects"
                     && !p.file.path.includes("/steps/")
                     && !p.file.name.toLowerCase().endsWith("-board"))
            .where(p => customJS.DocSearch.matches(p, this._filterCtx));

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
                    if (line.startsWith("## ")) lane = line.replace("## ", "").trim();  // lint-display-markers:allow Kanban board lane parse, not a display marker
                    if (line.match(/^- \[[ x]\] /)) {
                        total++;
                        if (lane === "Completed") done++;
                        if (lane === "Blocked") blocked++;
                    }
                }
            }
            enriched.push({ project, latestMtime, total, done, blocked });
        }

        this._lookup = new Map(enriched.map(e => [e.project.file.path, e]));
        this._allPages = enriched.map(e => e.project);
        this._pages = this._filterArchived(this._allPages, this._showArchived);

        // WS1: a single sort toggle ("Last edited" ↔ "A–Z") above the grid.
        this._renderSortToggle(dv);

        // The card grid lives in its own container so the toggle can rebuild
        // ONLY the grid in place (not the whole view). _rebuildGrid empties +
        // re-renders this element.
        this._gridEl = dv.container.createEl("div");
        await this._renderCards(this._makeProxyDv(null, this._gridEl), this._sortProjects(this._pages, this._sortMode));
    }

    async _renderCards(dv, pages) {
        if (!pages || !pages.length) {
            const empty = dv.container.createEl("div", { text: "No projects yet. Create one to get started." });
            empty.style.cssText = "color:var(--text-muted);font-style:italic;padding:8px 0;";
            return;
        }
        const briefcase = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        const lookup = this._lookup;
        // WS1: callers pass a pre-sorted `pages` (via _sortProjects, which honors
        // the persisted sort mode). _renderCards renders in the order given.
        await customJS.BeaconCards.render(dv, {
            pages,
            layout: "row",
            // v0.59.10: titleWrap=true so long project display-names (e.g.
            // "Denali - Migrate Content-Registry to GH Actions") are NOT
            // ellipsis-truncated. Multi-line wrap preferred over hidden text.
            titleWrap: true,
            title: (p) => p.name || p.file.name,
            icon:  () => briefcase,
            // v0.59.10: subtitle (description) dropped from the hub list — long
            // descriptions inflated each card vertically and cluttered the
            // overview. Click into a project to see its full description.
            subtitle: () => null,
            meta: (p) => {
                const e = lookup.get(p.file.path);
                const time = window.moment(e.latestMtime.ts).fromNow();
                const pill = this._statusPill(p.status);
                const teamChips = this._chipList(p.teams || []);
                const productChips = this._chipList(p.products || []);
                // v0.59.10: format status_changed_at as YYYY-MM-DD only (new
                // v0.59.x projects emit full ISO+TZ via entity-create; truncate
                // to date for hub display).
                const scaDate = p.status_changed_at
                    ? String(p.status_changed_at).slice(0, 10)
                    : null;
                const recency = scaDate ? ` &middot; ${scaDate}` : "";
                let html = `<span>${pill}</span>`;
                if (teamChips) html += `<span>${teamChips}</span>`;
                if (productChips) html += `<span>${productChips}</span>`;
                html += `<span title="Last activity">${time}${recency}</span>`;
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
            target: (p) => p.file.path
        });
    }
}
