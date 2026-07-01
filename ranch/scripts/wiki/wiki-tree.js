class WikiTree {
    render(dv) {
        const cur = dv.current();
        if (!cur || !cur.file) return;
    }

    _immediateChildFolders(scopePath, pages) {
        const depth = scopePath.split("/").length;
        const seen = new Map();
        for (const p of pages) {
            if (!p || !p.file || !p.file.path) continue;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            if (!folder.startsWith(scopePath + "/")) continue;
            const segs = folder.slice(scopePath.length + 1).split("/");
            if (segs.length < 1) continue;
            const child = scopePath + "/" + segs[0];
            if (!seen.has(child)) seen.set(child, { folder: child, title: segs[0], pageCount: 0, maxMtime: 0 });
            const entry = seen.get(child);
            if (p.type === "wiki-page") {
                entry.pageCount++;
                const ts = p.file.mtime && p.file.mtime.ts != null ? p.file.mtime.ts : 0;
                if (ts > entry.maxMtime) entry.maxMtime = ts;
            }
        }
        return Array.from(seen.values()).sort((a, b) => a.folder.localeCompare(b.folder));
    }

    _immediatePages(scopePath, pages) {
        return (pages || []).filter(p => {
            if (!p || !p.file || !p.file.path) return false;
            if (p.type !== "wiki-page") return false;
            const folder = p.file.path.slice(0, p.file.path.lastIndexOf("/"));
            return folder === scopePath;
        }).sort((a, b) => {
            const at = a.file && a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
            const bt = b.file && b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
            return bt - at;
        });
    }

    _recentPages(pages, n) {
        return (pages || [])
            .filter(p => p && p.type === "wiki-page")
            .sort((a, b) => {
                const at = a.file && a.file.mtime && a.file.mtime.ts != null ? a.file.mtime.ts : 0;
                const bt = b.file && b.file.mtime && b.file.mtime.ts != null ? b.file.mtime.ts : 0;
                return bt - at;
            })
            .slice(0, n);
    }
}
