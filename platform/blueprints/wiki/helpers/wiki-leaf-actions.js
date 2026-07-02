/**
 * WikiLeafActions (CustomJS)
 * Renders the navigation + action row at the top of a wiki-page note, as ONE
 * horizontal row with the section-nav on the left and Move pushed to the far right:
 *   [ Wiki ]  [ <section> ] ................................ [ Move ]
 * — so you can always get back to the wiki home (docs) and up to the section the
 * page lives in, from anywhere. Move options are computed LAZILY on click (never
 * at render), so a cold-loading WikiMove can't throw and blank the whole row.
 * Separators above + below get ~one line break of breathing room.
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

        // Dual-fire guard: replace (not append) the row on Dataview re-render.
        const existing = dv.container.querySelector(".wiki-leaf-actions");
        if (existing) existing.remove();

        const wrap = dv.container.createEl("div", { cls: "wiki-leaf-actions" });
        wrap.style.cssText = "margin: 0;";
        // Breathing room: ~one line break (12px) above + below every separator so the
        // row isn't squished against the nav above or the page content below.
        const hr = wrap.createEl("hr");
        hr.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;";
        // ONE horizontal row: [Wiki] [<section>] on the left, [Move] pushed to the far
        // right via margin-left:auto. No wrap — the controls stay on a single line.
        const row = wrap.createEl("div");
        row.style.cssText = "display: flex; gap: 10px; margin: 0; align-items: center;";

        const open = (target) => { if (target) app.workspace.openLinkText(target, ""); };

        // Wiki home (docs) — left.
        this._styleLeafBtn(customJS.AccentButton.render(row, { label: "Wiki", icon: homeIcon, onClick: () => open(root + "/Wiki.md") }));

        // Up to the section this page lives in (skip when the page sits at the wiki
        // root). Labelled with just the section name — clicking it takes you there.
        // { shrink } lets a long section label ellipsis so the row never overflows.
        if (folder && folder !== root) {
            const hub = this._resolveSectionHub(dv, folder);
            this._styleLeafBtn(customJS.AccentButton.render(row, { label: hub.label, icon: upIcon, onClick: () => open(hub.path) }), { shrink: true });
        }

        // Move — pushed to the very right of the row ({ right }). Dialog + options
        // computed on click, so render stays dependency-free.
        this._styleLeafBtn(customJS.AccentButton.render(row, { label: "Move", icon: moveIcon, onClick: () => this._openMoveDialog(dv, filePath) }), { right: true });

        // Bottom separator — 12px above (buttons) + below (page content). The leaf owns
        // this divider so the page template needs no trailing "---"; a per-note heal
        // strips the legacy template "---" from existing pages.
        const hrBottom = wrap.createEl("hr");
        hrBottom.style.cssText = "border: none; border-top: 1px solid var(--background-modifier-border); margin: 12px 0;";
    }

    // One-row sizing: readable label + tap target at natural width. Wiki + section sit
    // on the left; { right:true } pushes Move to the far right; { shrink:true } lets a
    // long section label ellipsis-shrink so the row never overflows on a phone.
    _styleLeafBtn(btn, opts) {
        opts = opts || {};
        if (!btn || !btn.style) return btn;
        btn.style.fontSize = "0.9em";
        btn.style.padding = "8px 14px";
        btn.style.flex = opts.shrink ? "0 1 auto" : "0 0 auto";
        btn.style.minWidth = "0";
        btn.style.overflow = "hidden";
        btn.style.whiteSpace = "nowrap";
        if (opts.right) btn.style.marginLeft = "auto";
        return btn;
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
            const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
            overlay.addEventListener("click", (ev) => { if (ev.target === overlay) { close(); resolve(null); } });
            const dialog = document.createElement("div");
            dialog.style.cssText = "background:var(--background-primary);border-radius:12px;padding:20px;min-width:320px;max-width:520px;box-shadow:0 8px 32px rgba(0,0,0,0.3);";
            const heading = document.createElement("div");
            heading.textContent = "Move to section";
            heading.style.cssText = "font-size:1.1em;font-weight:600;margin-bottom:10px;";
            dialog.appendChild(heading);

            // Indented tree list — each row is indented by its depth (with a subtle
            // connector for nested sections) so the section → sub-section hierarchy is
            // visible; clicking a row moves the note straight into that section.
            const list = document.createElement("div");
            list.style.cssText = "max-height:55vh;overflow-y:auto;margin-bottom:12px;border:1px solid var(--background-modifier-border);border-radius:8px;padding:4px;";
            for (const opt of options) {
                const rowEl = document.createElement("div");
                const indent = 8 + (opt.depth || 0) * 18;
                rowEl.style.cssText = "padding:8px 10px;padding-left:" + indent + "px;border-radius:6px;cursor:pointer;color:var(--text-normal);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" + (opt.depth === 0 ? "font-weight:600;" : "");
                const connector = (opt.depth || 0) > 0 ? '<span style="color:var(--text-muted);opacity:0.6;">└ </span>' : "";
                rowEl.innerHTML = connector + this._escape(opt.label);
                rowEl.onmouseenter = () => { rowEl.style.background = "var(--background-modifier-hover)"; };
                rowEl.onmouseleave = () => { rowEl.style.background = "transparent"; };
                rowEl.onclick = () => { close(); resolve(opt.folder); };
                list.appendChild(rowEl);
            }
            dialog.appendChild(list);

            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding:6px 14px;border-radius:6px;cursor:pointer;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-normal);";
            cancelBtn.onclick = () => { close(); resolve(null); };
            btnRow.appendChild(cancelBtn);
            dialog.appendChild(btnRow);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);
        });
        if (chosen) await customJS.WikiMove.move(dv, chosen);
    }

    _escape(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    _buildMoveOptions(pages, currentPath) {
        const currentFolder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        return customJS.WikiMove.sectionTargets(pages).filter(o => o.folder !== currentFolder);
    }
}
