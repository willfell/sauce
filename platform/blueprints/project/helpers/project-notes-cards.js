/**
 * ProjectNotesCards (CustomJS)
 * Renders the "Project Notes" listing on a project atlas — all non-board notes
 * within the current project's directory, excluding the atlas itself.
 * Delegates to BeaconCards for rendering. Wrapped via customjs-guard for
 * cold-load safety (landmines #1, #2).
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "ProjectNotesCards" });
 */
class ProjectNotesCards {
    async render(dv) {
        const current = dv.current();
        const folder = current.file.folder;
        const pages = dv.pages(`"${folder}"`)
            .where(p => p.file.name !== current.file.name && !p.file.name.endsWith("-board"));
        await customJS.BeaconCards.render(dv, {
            pages,
            title:    (p) => p.file.name,
            subtitle: (p) => window.moment(p.file.mtime.ts).fromNow(),
            target:   (p) => p.file.path,
            sort:     (a, b) => b.file.mtime - a.file.mtime,
            empty:    "No project notes yet."
        });
    }
}
