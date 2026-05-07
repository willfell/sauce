/**
 * ProjectReferencedByCards (CustomJS)
 * Renders the "Referenced By" listing on a project atlas — pages elsewhere in
 * the vault that link to the current atlas, excluding self-references and
 * legacy Planning-Board paths. Delegates to BeaconCards for rendering.
 * Wrapped via customjs-guard for cold-load safety (landmines #1, #2).
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/Views/customjs-guard", { class: "ProjectReferencedByCards" });
 */
class ProjectReferencedByCards {
    async render(dv) {
        const current = dv.current();
        const projectFolder = current.file.folder;
        const incoming = dv.pages().where(p =>
            p.file.outlinks && p.file.outlinks.some(l => l.path === current.file.path)
            && !p.file.path.includes("Planning-Board")
            && !p.file.path.startsWith(projectFolder + "/")
        );
        await customJS.BeaconCards.render(dv, {
            pages: incoming,
            title:    (p) => p.file.name,
            subtitle: (p) => `Modified ${window.moment(p.file.mtime.ts).fromNow()}`,
            target:   (p) => p.file.path,
            sort:     (a, b) => b.file.mtime - a.file.mtime,
            empty:    "Not referenced from anywhere yet."
        });
    }
}
