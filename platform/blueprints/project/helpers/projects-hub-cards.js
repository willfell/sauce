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

    _renderChips(dv) {
        const STATUSES = ["idea", "planning", "in-progress", "blocked", "done", "superseded", "cancelled"];
        const bar = dv.container.createEl("div");
        bar.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center;";
        const label = bar.createEl("span", { text: "Status: " });
        label.style.cssText = "color:var(--text-muted);font-size:0.85em;margin-right:4px;";
        STATUSES.forEach(s => {
            const isActive = this._activeStatuses.has(s);
            const chip = bar.createEl("span", { text: s });
            chip.style.cssText = `cursor:pointer;padding:2px 10px;border-radius:12px;font-size:0.8em;${
                isActive ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "background:var(--background-secondary);color:var(--text-muted);"
            }`;
            chip.addEventListener("click", async () => {
                if (this._activeStatuses.has(s)) this._activeStatuses.delete(s);
                else this._activeStatuses.add(s);
                dv.container.empty();
                await this.render(dv, {});
            });
        });
    }

    async render(dv) {
        // v0.39.0 S6.3: default scope filter — hide terminal statuses unless
        // the chip UI (rendered in S6.4) toggles them on. Records WITHOUT a
        // `status` field (legacy `#project` tag-only notes pre-v0.38.0)
        // short-circuit the Set lookup and still render — they surface with
        // a "?" status pill rather than being filtered out (preserves
        // v1.4.1 CF-1 legacy-tag-compat posture).
        if (!this._activeStatuses) {
            this._activeStatuses = new Set(["idea", "planning", "in-progress", "blocked"]);
        }

        // v0.39.0 S6.4: render status filter chip bar at top of hub. Chips
        // are click-toggle; click handler mutates this._activeStatuses then
        // empties the container and re-renders the whole hub.
        this._renderChips(dv);

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
        const projectHubs = dv.pages('"spice/projects"')
            .where(p => (p.type === "project"
                      || (p.file.etags.includes("#project")
                          && p.type !== "map"
                          && p.type !== "kanban"))
                     && p.file.name !== "Projects"
                     && !p.file.path.includes("/steps/")
                     && !p.file.name.toLowerCase().endsWith("-board"))
            .where(p => !p.status || this._activeStatuses.has(p.status));

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
                    if (line.startsWith("## ")) lane = line.replace("## ", "").trim();
                    if (line.match(/^- \[[ x]\] /)) {
                        total++;
                        if (lane === "Completed") done++;
                        if (lane === "Blocked") blocked++;
                    }
                }
            }
            enriched.push({ project, latestMtime, total, done, blocked });
        }

        const lookup = new Map(enriched.map(e => [e.project.file.path, e]));

        const briefcase = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

        await customJS.BeaconCards.render(dv, {
            pages: enriched.map(e => e.project),
            layout: "row",
            title: (p) => p.name || p.file.name,
            icon:  () => briefcase,
            subtitle: (p) => p.description || null,
            meta: (p) => {
                const e = lookup.get(p.file.path);
                const time = window.moment(e.latestMtime.ts).fromNow();
                const pill = this._statusPill(p.status);
                const teamChips = this._chipList(p.teams || []);
                const productChips = this._chipList(p.products || []);
                const recency = p.status_changed_at ? ` &middot; ${p.status_changed_at}` : "";
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
            target: (p) => p.file.path,
            sort: (a, b) => {
                const ea = lookup.get(a.file.path);
                const eb = lookup.get(b.file.path);
                return eb.latestMtime - ea.latestMtime;
            },
            empty: "No projects yet. Create one to get started."
        });
    }
}
