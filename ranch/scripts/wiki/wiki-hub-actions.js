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

        const row = dv.container.createEl("div", { cls: "wiki-hub-actions" });
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const mk = (label, icon, instance) => {
            const go = () => {
                if (!customJS || !customJS.EntityCreate || typeof customJS.EntityCreate.create !== "function") {
                    new Notice("WikiHubActions: EntityCreate mechanism unavailable.", 8000);
                    return;
                }
                customJS.EntityCreate.create({ instance, dv });
            };
            customJS.AccentButton.render(row, { label, icon, onClick: go, flex: true });
        };

        mk("+ New Section", folderPlus, "wiki-section");
        mk("+ New Page", filePlus, "wiki-page");
    }
}
