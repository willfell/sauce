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

    _renderChips(dv, projects) {
        const STATUSES = ["idea", "planning", "in-progress", "blocked", "done", "superseded", "cancelled"];

        // Status chip bar
        const statusBar = dv.container.createEl("div");
        statusBar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;";
        const statusLabel = statusBar.createEl("span", { text: "Status: " });
        statusLabel.style.cssText = "color:var(--text-muted);font-size:0.85em;margin-right:4px;";
        STATUSES.forEach(s => {
            const isActive = this._activeStatuses.has(s);
            const chip = statusBar.createEl("span", { text: s });
            chip.style.cssText = `cursor:pointer;padding:2px 10px;border-radius:12px;font-size:0.8em;${
                isActive ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "background:var(--background-secondary);color:var(--text-muted);"
            }`;
            chip.addEventListener("click", async () => {
                if (this._activeStatuses.has(s)) this._activeStatuses.delete(s);
                else this._activeStatuses.add(s);
                // v0.109.0 S3: clear ONLY the resultsContainer (the proxy's container)
                // and re-render via _renderInner. The DocSearch strip lives outside
                // the proxy and stays intact across status-chip clicks.
                dv.container.empty();
                await this._renderInner(dv);
            });
        });

        // Compute team + product chip universe from current (status-filtered) projects.
        const allTeams = new Set();
        const allProducts = new Set();
        for (const p of projects) {
            (p.teams || []).forEach(l => allTeams.add(l.path));
            (p.products || []).forEach(l => allProducts.add(l.path));
        }
        if (!this._activeTeams)    this._activeTeams    = new Set(allTeams);
        if (!this._activeProducts) this._activeProducts = new Set(allProducts);

        const renderLinkChips = (labelText, allSet, activeSet) => {
            if (!allSet.size) return;
            const bar = dv.container.createEl("div");
            bar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;";
            const lbl = bar.createEl("span", { text: `${labelText}: ` });
            lbl.style.cssText = "color:var(--text-muted);font-size:0.85em;margin-right:4px;";
            [...allSet].sort().forEach(path => {
                const display = path.split("/").pop().replace(/\.md$/, "");
                const isActive = activeSet.has(path);
                const chip = bar.createEl("span", { text: display });
                chip.style.cssText = `cursor:pointer;padding:2px 10px;border-radius:12px;font-size:0.8em;${
                    isActive ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "background:var(--background-secondary);color:var(--text-muted);"
                }`;
                chip.addEventListener("click", async () => {
                    if (activeSet.has(path)) activeSet.delete(path);
                    else activeSet.add(path);
                    // v0.109.0 S3 — see status-chip handler above.
                    dv.container.empty();
                    await this._renderInner(dv);
                });
            });
        };
        renderLinkChips("Teams", allTeams, this._activeTeams);
        renderLinkChips("Products", allProducts, this._activeProducts);
    }

    _renderGroupSelector(dv) {
        const wrap = dv.container.createEl("div");
        wrap.style.cssText = "margin-bottom:10px;";
        const lbl = wrap.createEl("span", { text: "Group by: " });
        lbl.style.cssText = "color:var(--text-muted);font-size:0.85em;margin-right:6px;";
        const select = wrap.createEl("select");
        ["none", "status", "team", "product"].forEach(opt => {
            const o = select.createEl("option", { text: opt, value: opt });
            if (opt === (this._groupBy || "none")) o.selected = true;
        });
        select.addEventListener("change", async (e) => {
            this._groupBy = e.target.value;
            // v0.109.0 S3 — see status-chip handler above.
            dv.container.empty();
            await this._renderInner(dv);
        });
    }

    _renderRecentStrip(dv, enriched) {
        if (!enriched || enriched.length === 0) return;   // empty-renders-nothing
        const sorted = [...enriched].sort((a, b) => {
            const ma = (a.latestMtime && a.latestMtime.ts) || 0;
            const mb = (b.latestMtime && b.latestMtime.ts) || 0;
            return mb - ma;
        }).slice(0, 4);

        customJS.SectionLabel.render(dv, { text: "Recently active" });
        const bar = dv.container.createEl("div");
        bar.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px 0;";
        for (const e of sorted) {
            const p = e.project;
            const name = p.name || p.file.name;
            const when = (e.latestMtime && e.latestMtime.ts) ? window.moment(e.latestMtime.ts).fromNow() : "";
            const chip = bar.createEl("span");
            chip.textContent = when ? `${name} · ${when}` : name;
            chip.style.cssText = "cursor:pointer;padding:3px 12px;border-radius:12px;font-size:0.85em;background:var(--background-secondary);color:var(--text-normal);border:1px solid var(--background-modifier-border);";
            chip.addEventListener("click", () => {
                try { app.workspace.openLinkText(p.file.path, ""); } catch (_e) {}
            });
        }
    }

    async render(dv) {
        // v0.39.0 S6.3: default scope filter — hide terminal statuses unless
        // the chip UI (rendered in S6.4) toggles them on. Records WITHOUT a
        // `status` field (legacy `#project` tag-only notes pre-v0.38.0)
        // short-circuit the Set lookup and still render — they surface with
        // a "?" status pill rather than being filtered out (preserves
        // v1.4.1 CF-1 legacy-tag-compat posture).
        if (!this._activeStatuses) {
            // v0.127.0 §E1: default scope shows ALL statuses including terminal
            // (done/superseded/cancelled). Users still toggle chips off interactively.
            this._activeStatuses = new Set(["idea", "planning", "in-progress", "blocked", "done", "superseded", "cancelled"]);
        }

        // v0.109.0 S3 — DocSearch filter strip wraps the existing status/team/product
        // chips + grid. entityType: project + scopePath: spice/projects let DocSearch
        // build its tag-chip universe from project tags. Chip-strip listeners + the
        // grid are written into the resultsContainer via a proxyDv shim, mirroring
        // how ProjectDocsIndex and SectionHub consume DocSearch.
        const filterCtx = customJS.DocSearch.render(dv, {
            entityType: "project",
            scopePath:  "spice/projects",
            recursive:  true,
            placeholder: "Filter projects by name or tag…",
            hideTags: true,   // projects hub: drop the tag-chip section entirely
            persist:  false,  // projects hub: search box never remembers text across visits
            onChange: async (ctx) => {
                this._filterCtx = ctx;
                ctx.resultsContainer.empty();
                await this._renderInner(this._makeProxyDv(dv, ctx.resultsContainer));
            },
        });
        this._filterCtx = filterCtx;

        // First-render INTO resultsContainer.
        await this._renderInner(this._makeProxyDv(dv, filterCtx.resultsContainer));
    }

    _makeProxyDv(dv, container) {
        return {
            container,
            current: dv.current.bind(dv),
            pages:   dv.pages.bind(dv),
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
        // v0.109.0 S3: final .where applies DocSearch.matches against the filter ctx
        // so the text input + tag chips compose with status/team/product.
        const statusFiltered = dv.pages('"spice/projects"')
            .where(p => (p.type === "project"
                      || (p.file.etags.includes("#project")
                          && p.type !== "map"
                          && p.type !== "kanban"))
                     && p.file.name !== "Projects"
                     && !p.file.path.includes("/steps/")
                     && !p.file.name.toLowerCase().endsWith("-board"))
            .where(p => !p.status || this._activeStatuses.has(p.status))
            .where(p => customJS.DocSearch.matches(p, this._filterCtx));

        // v0.39.0 S6.4/S6.5: render status + team + product chip bars at top
        // of hub. Team/product chip set is derived from the status-filtered
        // projects so the chip universe is responsive to status toggles.
        this._renderChips(dv, statusFiltered);

        // v0.39.0 S6.6: render group-by dropdown (default: status).
        this._renderGroupSelector(dv);

        // v0.39.0 S6.5: apply team/product filter (OR-mode multi-select).
        // Projects with neither teams nor products surface unconditionally
        // (unassigned-shown posture).
        const projectHubs = statusFiltered.where(p => {
            const teams = (p.teams || []).map(l => l.path);
            const products = (p.products || []).map(l => l.path);
            if (teams.length === 0 && products.length === 0) return true;
            return teams.some(t => this._activeTeams.has(t)) || products.some(pr => this._activeProducts.has(pr));
        });

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

        // v?: 'Recently active' strip — top-4 by recency from the filtered set,
        // rendered just above the grouped grid (cross-status recency access).
        this._renderRecentStrip(dv, enriched);

        // v0.39.0 S6.6: dispatch on this._groupBy. "none" renders all
        // projects as a single grid (preserves existing behavior). "status"
        // (default) / "team" / "product" emit an <h3> header per group with
        // a card list below. Status groups are ordered by STATUS_ORDER
        // priority; team/product groups are alphabetical.
        const groupBy = this._groupBy || "none";
        const pages = enriched.map(e => e.project);
        if (groupBy === "none" || pages.length === 0) {
            await this._renderCards(dv, pages);
        } else {
            const groups = new Map();
            for (const p of pages) {
                let key;
                if (groupBy === "status") key = p.status || "(no status)";
                else if (groupBy === "team") key = (p.teams || []).map(l => l.path.split("/").pop().replace(/\.md$/, "")).join(", ") || "(no team)";
                else if (groupBy === "product") key = (p.products || []).map(l => l.path.split("/").pop().replace(/\.md$/, "")).join(", ") || "(no product)";
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(p);
            }
            const STATUS_ORDER = ["in-progress", "planning", "blocked", "idea", "done", "superseded", "cancelled", "(no status)"];
            const sortedKeys = groupBy === "status"
                ? STATUS_ORDER.filter(s => groups.has(s))
                : [...groups.keys()].sort();
            for (const key of sortedKeys) {
                // Use the shared SectionLabel primitive (no raw ## / <h3> chrome),
                // matching the sections pattern used across the blueprints.
                customJS.SectionLabel.render(dv, { text: key });
                await this._renderCards(dv, groups.get(key));
            }
        }
    }

    async _renderCards(dv, pages) {
        if (!pages || !pages.length) {
            const empty = dv.container.createEl("div", { text: "No projects yet. Create one to get started." });
            empty.style.cssText = "color:var(--text-muted);font-style:italic;padding:8px 0;";
            return;
        }
        const briefcase = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
        const lookup = this._lookup;
        // v0.127.0 §E2: sort primary by max folder mtime DESC (most-recently-touched
        // project surfaces first regardless of status_changed_at). Status priority
        // + status_changed_at retained as tiebreakers (only fire when two projects
        // share the exact same latest-mtime millisecond — extremely rare).
        const PRIORITY = { "in-progress": 0, "planning": 1, "blocked": 2, "idea": 3, "done": 4, "superseded": 5, "cancelled": 6 };
        const sorted = [...pages].sort((a, b) => {
            const ea = lookup && lookup.get ? lookup.get(a.file.path) : null;
            const eb = lookup && lookup.get ? lookup.get(b.file.path) : null;
            const ma = (ea && ea.latestMtime && ea.latestMtime.ts) || 0;
            const mb = (eb && eb.latestMtime && eb.latestMtime.ts) || 0;
            if (mb !== ma) return mb - ma;
            const pa = PRIORITY[a.status] ?? 99;
            const pb = PRIORITY[b.status] ?? 99;
            if (pa !== pb) return pa - pb;
            const da = String(a.status_changed_at || "1970-01-01");
            const db = String(b.status_changed_at || "1970-01-01");
            return db.localeCompare(da);
        });
        await customJS.BeaconCards.render(dv, {
            pages: sorted,
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
