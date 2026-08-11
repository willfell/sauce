class WikiMove {
    // Returns move targets with a `depth` (0 = wiki root, 1 = top-level section,
    // 2+ = sub-section …) in DEPTH-FIRST tree order — a lexical folder-path sort
    // places each parent immediately before its children, so callers can indent by
    // depth to render the section → sub-section hierarchy.
    sectionTargets(pages) {
        const ROOT = "spice/wiki";
        const rootDepth = ROOT.split("/").length; // 2
        const root = { folder: ROOT, label: "Wiki (root)", depth: 0 };
        const sections = (pages || [])
            .filter(p => p && p.type === "wiki-section" && p.file && p.file.path)
            .map(p => {
                const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                const label = (p.title && String(p.title).trim()) ? String(p.title).trim() : folder.split("/").pop();
                const depth = folder.split("/").length - rootDepth;
                return { folder, label, depth };
            })
            .sort((a, b) => a.folder.localeCompare(b.folder));
        return [root, ...sections];
    }

    targetPath(targetFolder, currentPath) {
        const basename = currentPath.slice(currentPath.lastIndexOf("/") + 1);
        return targetFolder + "/" + basename;
    }

    isNoop(targetFolder, currentPath) {
        const folder = currentPath.slice(0, currentPath.lastIndexOf("/"));
        return targetFolder === folder;
    }

    async move(dv, targetFolder) {
        try {
            const appRef = (typeof globalThis !== "undefined" && globalThis.app) || null;
            const cjs = (typeof globalThis !== "undefined" && globalThis.customJS) || null;
            const file = appRef && appRef.workspace && appRef.workspace.getActiveFile
                ? appRef.workspace.getActiveFile() : null;
            if (!file) return;
            if (this.isNoop(targetFolder, file.path)) return;
            if (!cjs || !cjs.SectionExplorer || typeof cjs.SectionExplorer.applyDocMove !== "function") return;
            return await cjs.SectionExplorer.applyDocMove(dv, file, targetFolder, {
                structural: true,
                move: { rewriteOnDocMove: () => null },
            });
        } catch (e) {
            console.error("WikiMove.move failed:", e);
            return { ok: false, error: e };
        }
    }
}
