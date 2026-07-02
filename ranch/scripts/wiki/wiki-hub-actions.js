/**
 * WikiHubActions (CustomJS)
 * Renders the "+ New Section" and "+ New Page" accent buttons in a SINGLE
 * evenly-spaced flex row on a wiki-hub or wiki-section note — replacing the two
 * stacked entity-create dataviewjs blocks that rendered one-per-line. Each
 * button delegates to customJS.EntityCreate.create({ instance, dv }) (the same
 * dispatch the entity-create mechanism uses); only the row layout is owned here
 * so both buttons share one row with identical flex styling. Mirrors the
 * ScratchDayActions one-row pattern.
 *
 * Empties nothing and is guarded against Dataview's dual-fire lifecycle via a
 * per-container render-generation token, so a re-fire replaces (not appends) the
 * row. Renders only on wiki-hub / wiki-section notes; a no-op elsewhere.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "WikiHubActions" });
 */
class WikiHubActions {
    async render(dv) {
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;
        const cur = dv.current();
        if (!cur || !cur.file) return;
        if (cur.type !== "wiki-hub" && cur.type !== "wiki-section") return;

        // Dual-fire guard: tag this render; if a later fire supersedes it, bail.
        const myGen = (dv.container.__wikiHubGen || 0) + 1;
        dv.container.__wikiHubGen = myGen;
        const existing = dv.container.querySelector(".wiki-hub-actions");
        if (existing) existing.remove();

        const folderPlus = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
        const filePlus = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/></svg>`;
        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        const upIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 14 12 11 15 14"/></svg>`;

        const wrap = dv.container.createEl("div", { cls: "wiki-hub-actions" });
        // Divider between the global nav-button row (above) and the wiki buttons.
        const hr = wrap.createEl("hr");
        hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 10px 0 8px 0;";
        const row = wrap.createEl("div");
        row.style.cssText = "display: flex; gap: 10px; margin: 0 auto 4px auto; justify-content: center; align-items: stretch; max-width: 640px; flex-wrap: wrap;";

        const root = "spice/wiki";
        const open = (t) => { if (t) app.workspace.openLinkText(t, ""); };

        // On a SECTION: prepend navigation so you can get back to the wiki home and
        // up to the parent section from any depth. The root hub itself is home — no nav.
        if (cur.type === "wiki-section") {
            this._mobilize(customJS.AccentButton.render(row, { label: "Wiki", icon: homeIcon, flex: true, onClick: () => open(root + "/Wiki.md") }));
            const secFolder = cur.file.path.slice(0, cur.file.path.lastIndexOf("/"));
            const parentFolder = secFolder.slice(0, secFolder.lastIndexOf("/"));
            if (parentFolder && parentFolder !== root && parentFolder.startsWith(root + "/")) {
                const up = this._resolveSectionHub(dv, parentFolder);
                this._mobilize(customJS.AccentButton.render(row, { label: "Up: " + up.label, icon: upIcon, flex: true, onClick: () => open(up.path) }));
            }
        }

        const mk = (label, icon, instance) => {
            const go = () => {
                if (!customJS || !customJS.EntityCreate || typeof customJS.EntityCreate.create !== "function") {
                    new Notice("WikiHubActions: EntityCreate mechanism unavailable.", 8000);
                    return;
                }
                customJS.EntityCreate.create({ instance, dv });
            };
            this._mobilize(customJS.AccentButton.render(row, { label, icon, onClick: go, flex: true }));
        };

        mk("+ New Section", folderPlus, "wiki-section");
        mk("+ New Page", filePlus, "wiki-page");
    }

    // Mobile-legible sizing: bigger tap target + readable label. Each button takes
    // ~half the row (min 128px) so a phone wraps them 2-up instead of shrinking
    // every label to an ellipsis. Layered on AccentButton's flex:1 base.
    _mobilize(btn) {
        if (!btn || !btn.style) return btn;
        btn.style.flex = "1 1 calc(50% - 6px)";
        btn.style.minWidth = "128px";
        btn.style.fontSize = "0.92em";
        btn.style.padding = "9px 14px";
        return btn;
    }

    // Resolve the wiki-section hub note living directly in `folder` (title + link
    // for the Up button). Falls back to <folder>/<lastSeg>.md when none found.
    _resolveSectionHub(dv, folder) {
        try {
            const raw = dv.pages('"' + folder + '"');
            const list = raw && typeof raw.array === "function" ? raw.array() : Array.from(raw || []);
            const hub = list.find((p) => p && p.type === "wiki-section" && p.file && p.file.folder === folder);
            if (hub && hub.file) {
                return { path: hub.file.path, label: (hub.title && String(hub.title).trim()) || String(hub.file.name).replace(/\.md$/, "") };
            }
        } catch (_e) { /* fall through */ }
        const seg = folder.slice(folder.lastIndexOf("/") + 1);
        return { path: folder + "/" + seg + ".md", label: seg };
    }
}
