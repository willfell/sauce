class WikiMove {
    sectionTargets(pages) {
        const root = { folder: "spice/wiki", label: "Wiki (root)" };
        const sections = (pages || [])
            .filter(p => p && p.type === "wiki-section" && p.file && p.file.path)
            .map(p => {
                const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
                const label = (p.title) ? String(p.title) : folder.split("/").pop();
                return { folder, label };
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
            const file = app.workspace.getActiveFile();
            if (!file) return;
            if (this.isNoop(targetFolder, file.path)) return;
            const newPath = this.targetPath(targetFolder, file.path);
            await app.fileManager.renameFile(file, newPath);
        } catch (e) {
            console.error("WikiMove.move failed:", e);
        }
    }
}
