/**
 * WikiLeafActions (CustomJS)
 * Renders the navigation + action row at the top of a wiki-page note:
 *   [ Wiki ]  [ Up: <section> ]  [ Move ]
 * — so you can always get back to the wiki home (docs) and up to the section the
 * page lives in, from anywhere. Move options are computed LAZILY on click (never
 * at render), so a cold-loading WikiMove can't throw and blank the whole row.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "WikiLeafActions" });
 */
class WikiLeafActions {
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file || cur.type !== "wiki-page") return;
        if (dv.container.closest && dv.container.closest(".markdown-embed")) return;

        const root = "spice/wiki";
        const filePath = cur.file.path;
        const folder = filePath.slice(0, filePath.lastIndexOf("/"));

        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        const upIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="9 14 12 11 15 14"/></svg>`;
        const moveIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`;

        const row = dv.container.createEl("div", { cls: "wiki-leaf-actions" });
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const open = (target) => { if (target) app.workspace.openLinkText(target, ""); };

        // Wiki home (docs).
        customJS.AccentButton.render(row, { label: "Wiki", icon: homeIcon, flex: true, onClick: () => open(root + "/Wiki.md") });

        // Up to the section this page lives in (skip when the page sits at the wiki root).
        if (folder && folder !== root) {
            const hub = this._resolveSectionHub(dv, folder);
            customJS.AccentButton.render(row, { label: "Up: " + hub.label, icon: upIcon, flex: true, onClick: () => open(hub.path) });
        }

        // Move (dialog + options computed on click — render stays dependency-free).
        customJS.AccentButton.render(row, { label: "Move", icon: moveIcon, flex: true, onClick: () => this._openMoveDialog(dv, filePath) });
    }

    // Resolve the wiki-section hub note that lives directly in `folder` (for the Up
    // button's label + link). Falls back to <folder>/<lastSeg>.md when none found.
    _resolveSectionHub(dv, folder) {
        try {
            const raw = dv.pages('"' + folder + '"');
            const list = raw && typeof raw.array === "function" ? raw.array() : Array.from(raw || []);
            const hub = list.find((p) => p && p.type === "wiki-section" && p.file && p.file.folder === folder);
            if (hub && hub.file) {
                return { path: hub.file.path, label: (hub.title && String(hub.title).trim()) || String(hub.file.name).replace(/\.md$/, "") };
            }
        } catch (_e) { /* fall through to path-derived */ }
        const seg = folder.slice(folder.lastIndexOf("/") + 1);
        return { path: folder + "/" + seg + ".md", label: seg };
    }

    async _openMoveDialog(dv, currentPath) {
        if (!customJS || !customJS.WikiMove || typeof customJS.WikiMove.sectionTargets !== "function") {
            new Notice("WikiLeafActions: WikiMove unavailable.", 6000);
            return;
        }
        const wikiPages = dv.pages('"spice/wiki"');
        const pages = wikiPages.array ? wikiPages.array() : Array.from(wikiPages);
        const options = this._buildMoveOptions(pages, currentPath);
        if (!options || options.length === 0) { new Notice("No other sections to move to.", 4000); return; }
        const chosen = await new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;";
            const dialog = document.createElement("div");
            dialog.style.cssText = "background:var(--background-primary);border-radius:12px;padding:24px;min-width:320px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,0.3);";
            const heading = document.createElement("div");
            heading.textContent = "Move to section";
            heading.style.cssText = "font-size:1.1em;font-weight:600;margin-bottom:12px;";
            dialog.appendChild(heading);
            const sel = document.createElement("select");
            sel.style.cssText = "width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);font-size:1em;margin-bottom:12px;";
            for (const opt of options) {
                const o = document.createElement("option");
                o.value = opt.folder; o.textContent = opt.label;
                sel.appendChild(o);
            }
            dialog.appendChild(sel);
            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
            const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.onclick = () => { close(); resolve(null); };
            const okBtn = document.createElement("button");
            okBtn.textContent = "Move";
            okBtn.style.cssText = "padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid var(--interactive-accent);background:var(--interactive-accent);color:var(--text-on-accent);";
            okBtn.onclick = () => { close(); resolve(sel.value); };
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
        });
        if (chosen) await customJS.WikiMove.move(dv, chosen);
    }

    _buildMoveOptions(pages, currentPath) {
        const currentFolder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        return customJS.WikiMove.sectionTargets(pages).filter(o => o.folder !== currentFolder);
    }
}
