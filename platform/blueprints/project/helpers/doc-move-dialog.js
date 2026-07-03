// doc-move-dialog.js — DocMoveDialog (WS5 — wiki-style Move tree dialog).
//
// A depth-indented section-tree overlay for moving a doc-note to another section
// (or the docs root) within its project. Mirrors the SHIPPED, TESTED wiki pattern
// (WikiMove.sectionTargets + WikiLeafActions._openMoveDialog): the pure logic
// (sectionTargets / targetPath / isNoop) is Node-regression-tested; the overlay +
// runtime move (app.fileManager.renameFile + processFrontMatter) are dogfood-only.
//
// Unlike the project's older flat DocMove picker (kept shipped for existing
// notes/tests), this dialog renders the section hierarchy as an indented tree with
// `└` connectors so a parent section always sits above its sub-sections, and it
// rewrites the moved doc's section/sub_section frontmatter to match the destination
// folder (best-effort — never throws on a frontmatter failure).
//
// customJS stores classes as INSTANCES (customJS.DocMoveDialog = new …), so every
// method lives on the prototype (instance methods, NOT static) — a static method
// would be undefined on the instance and throw at render time (the customjs
// static-vs-instance trap; see render-safe.js / code-conventions.md).
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class DocMoveDialog {
    // Build depth-ordered move targets for a project's docs tree. Returns
    // [{ folder, label, depth }] with the docs root first (depth 0), then every
    // `type: section-hub` page under `<projectDir>/docs/`, sorted lexically by
    // folder path so each parent section precedes its children. `depth` counts
    // folder segments below `<projectDir>/docs`. `label` prefers the human
    // section/title over the folder basename.
    sectionTargets(pages, projectDir) {
        const dir = String(projectDir == null ? "" : projectDir).replace(/\/+$/, "");
        const docsRoot = dir + "/docs";
        const rootSegs = docsRoot.split("/").length;
        const root = { folder: docsRoot, label: "Docs (root)", depth: 0 };
        const prefix = docsRoot + "/";
        const sections = (pages || [])
            .filter((p) => p && p.type === "section-hub" && p.file && p.file.path &&
                String(p.file.path).indexOf(prefix) === 0)
            .map((p) => {
                const path = String(p.file.path);
                const folder = path.slice(0, path.lastIndexOf("/"));
                const label = this._label(p, folder);
                const depth = folder.split("/").length - rootSegs;
                return { folder, label, depth };
            })
            .sort((a, b) => a.folder.localeCompare(b.folder));
        return [root, ...sections];
    }

    // Prefer a human label: frontmatter `section`, then `title`, then the file
    // basename (sans .md), then the folder's last segment.
    _label(page, folder) {
        const strip = (v) => {
            let s = String(v == null ? "" : v).trim();
            const m = s.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
            if (m) s = m[1];
            return s.replace(/\.md$/i, "").trim();
        };
        const sec = strip(page && page.section);
        if (sec) return sec;
        const title = strip(page && page.title);
        if (title) return title;
        const base = page && page.file && page.file.path
            ? strip(String(page.file.path).slice(String(page.file.path).lastIndexOf("/") + 1))
            : "";
        if (base) return base;
        return folder.slice(folder.lastIndexOf("/") + 1);
    }

    // Destination path for the active doc when moved into `targetFolder`
    // (folder + the doc's own basename). Mirrors WikiMove.targetPath.
    targetPath(targetFolder, currentPath) {
        const basename = currentPath.slice(currentPath.lastIndexOf("/") + 1);
        return targetFolder + "/" + basename;
    }

    // True when the doc already lives directly in `targetFolder` (no-op guard).
    // Mirrors WikiMove.isNoop.
    isNoop(targetFolder, currentPath) {
        const folder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        return targetFolder === folder;
    }

    _escape(s) {
        return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // Derive the project root dir from a doc-note path
    // ("spice/projects/<slug>/docs/<section>/…/doc.md" -> "spice/projects/<slug>").
    // Returns "" when the path isn't under a project's docs/ folder.
    projectDirFor(currentPath) {
        const s = String(currentPath == null ? "" : currentPath);
        const di = s.indexOf("/docs/");
        if (di < 0) return "";
        return s.slice(0, di);
    }

    // Open the indented section-tree overlay (mirrors WikiLeafActions._openMoveDialog).
    // Targets are computed lazily here (never at render), so a cold-loading helper
    // can't throw and blank the row. On pick -> await this.move(dv, folder).
    async _openMoveDialog(dv, currentPath) {
        const projectDir = this.projectDirFor(currentPath);
        if (!projectDir) { new Notice("This note isn't inside a project's docs/ folder."); return; }
        let pages = [];
        try {
            const raw = dv.pages('"' + projectDir + '"');
            pages = raw && typeof raw.array === "function" ? raw.array() : Array.from(raw || []);
        } catch (_e) { pages = []; }
        const currentFolder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        const options = this.sectionTargets(pages, projectDir).filter((o) => o.folder !== currentFolder);
        if (!options.length) { new Notice("No other sections to move to.", 4000); return; }

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

            // Indented tree list — each row indented by its depth (with a subtle
            // connector for nested sections) so the section → sub-section hierarchy
            // is visible; clicking a row moves the doc straight into that folder.
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
        if (chosen) await this.move(dv, chosen);
    }

    // Move the active doc into `targetFolder` (renameFile) then rewrite its
    // section/sub_section frontmatter to match the destination. depth-1 folder ->
    // section = that folder's human label, sub_section cleared; depth-2 folder ->
    // section = parent folder's label, sub_section = leaf label; docs root ->
    // both cleared. Frontmatter rewrite is best-effort (try/catch, never throws).
    async move(dv, targetFolder) {
        try {
            const file = app.workspace.getActiveFile();
            if (!file) return;
            if (this.isNoop(targetFolder, file.path)) return;
            const newPath = this.targetPath(targetFolder, file.path);
            await app.fileManager.renameFile(file, newPath);
            const moved = app.vault.getAbstractFileByPath(newPath) || file;
            const { section, subSection } = this._destSection(targetFolder, file.path);
            try {
                await app.fileManager.processFrontMatter(moved, (fm) => {
                    fm.section = section;
                    fm.sub_section = subSection;
                });
            } catch (_e) { /* frontmatter best-effort — the move already succeeded */ }
        } catch (e) {
            console.error("DocMoveDialog.move failed:", e);
        }
    }

    // Derive { section, subSection } human labels from the destination folder,
    // relative to <projectDir>/docs. depth 0 (docs root) -> both "". depth 1 ->
    // section = folder basename, sub "". depth >= 2 -> section = parent basename,
    // subSection = leaf basename. Uses the on-disk folder segment as the label
    // (the section-hub display name typically matches its folder; a subsequent
    // section-hub reconciliation can refine it, but this keeps the move pure +
    // dependency-free).
    _destSection(targetFolder, currentPath) {
        const projectDir = this.projectDirFor(currentPath);
        const docsRoot = String(projectDir).replace(/\/+$/, "") + "/docs";
        const tf = String(targetFolder || "").replace(/\/+$/, "");
        if (!projectDir || tf === docsRoot || tf.indexOf(docsRoot + "/") !== 0) {
            return { section: "", subSection: "" };
        }
        const rel = tf.slice((docsRoot + "/").length).split("/").filter(Boolean);
        if (rel.length <= 1) return { section: rel[0] || "", subSection: "" };
        return { section: rel[rel.length - 2], subSection: rel[rel.length - 1] };
    }
}
