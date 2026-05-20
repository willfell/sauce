/**
 * ScratchDayActions (CustomJS)
 * Renders the '+ New Scratch' and 'Hub' accent buttons in a single centered
 * flex row on a scratch day-hub note. The '+ New Scratch' click delegates to
 * customJS.EntityCreate.create({ instance: "scratch", dv }) — same dispatch
 * the entity-create mechanism uses; only the rendering is owned here so both
 * buttons share one row with identical flex styling.
 *
 * Empties dv.container before rendering to avoid Dataview's dual-fire
 * lifecycle producing duplicated button rows. Tolerates `day` frontmatter
 * as string, Date, or Luxon — normalizes to YYYY-MM-DD before validation.
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchDayActions" });
 */
class ScratchDayActions {
    _coerceDay(raw) {
        if (typeof raw === "string") return raw.slice(0, 10);
        if (raw && typeof raw.toISODate === "function") return raw.toISODate();
        if (raw instanceof Date && !isNaN(raw)) {
            const y = raw.getFullYear();
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${y}-${m}-${d}`;
        }
        return null;
    }

    async _pollForDay(dv) {
        let day = this._coerceDay(dv.current().day);
        for (let i = 0; i < 40 && (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)); i++) {
            await new Promise(r => setTimeout(r, 50));
            day = this._coerceDay(dv.current().day);
        }
        return day;
    }

    async render(dv) {
        if (dv.container.closest(".markdown-embed")) return;

        const myGen = (dv.container.__scratchRenderGen || 0) + 1;
        dv.container.__scratchRenderGen = myGen;
        const isStale = () => dv.container.__scratchRenderGen !== myGen;

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDay(dv);
        if (isStale()) return;
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchDayActions: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const mo = window.moment(day, "YYYY-MM-DD", true);
        if (!mo.isValid()) {
            dv.paragraph(`ScratchDayActions: invalid day value "${day}".`);
            return;
        }

        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
        const pencilPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/><line x1="20" y1="2" x2="20" y2="8"/><line x1="23" y1="5" x2="17" y2="5"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const createScratch = () => {
            if (!customJS || !customJS.EntityCreate || typeof customJS.EntityCreate.create !== "function") {
                new Notice("ScratchDayActions: EntityCreate mechanism unavailable.", 8000);
                return;
            }
            customJS.EntityCreate.create({ instance: "scratch", dv });
        };
        const goToHub = () => {
            app.workspace.openLinkText("spice/scratch/Scratch.md", "");
        };

        customJS.AccentButton.render(row, { label: "+ New Scratch", icon: pencilPlusIcon, onClick: createScratch, flex: true });
        customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub, flex: true });
    }
}
