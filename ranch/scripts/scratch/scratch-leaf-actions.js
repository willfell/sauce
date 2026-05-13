/**
 * ScratchLeafActions (CustomJS)
 * Renders TWO accent-styled buttons in a centered flex row on a leaf scratch
 * note (type: scratch):
 *   1. "← Back to Day" — navigates to Scratch-Day-YYYY-MM-DD.md in same folder
 *   2. "Hub" — navigates to spice/scratch/Scratch.md
 *
 * Empties dv.container before rendering to avoid Dataview's dual-fire
 * lifecycle producing duplicated button rows.
 *
 * Tolerates `day` frontmatter as string, Date, or Luxon.
 *
 * Usage in DataviewJS (via customjs-guard):
 *   await dv.view("ranch/views/customjs-guard", { class: "ScratchLeafActions" });
 */
class ScratchLeafActions {
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

        while (dv.container.firstChild) dv.container.removeChild(dv.container.firstChild);

        const day = await this._pollForDay(dv);
        if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
            dv.paragraph("ScratchLeafActions: missing or invalid `day` frontmatter (expected YYYY-MM-DD).");
            return;
        }

        const m = window.moment(day, "YYYY-MM-DD", true);
        if (!m.isValid()) {
            dv.paragraph(`ScratchLeafActions: invalid day value "${day}".`);
            return;
        }
        const monthFolder = m.format("YYYY/MM-MMMM");
        const dayHubPath = `spice/scratch/${monthFolder}/${day}/Scratch-Day-${day}.md`;

        const backIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;
        const homeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

        const row = dv.container.createEl("div");
        row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";

        const backToDay = () => app.workspace.openLinkText(dayHubPath, "");
        const goToHub  = () => app.workspace.openLinkText("spice/scratch/Scratch.md", "");

        customJS.AccentButton.render(row, { label: "Back to Day", icon: backIcon, onClick: backToDay, flex: true });
        customJS.AccentButton.render(row, { label: "Hub", icon: homeIcon, onClick: goToHub, flex: true });
    }
}
