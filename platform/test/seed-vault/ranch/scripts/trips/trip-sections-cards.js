class TripSectionsCards {
  async render(dv) {
    const filePath = dv.current().file.path;
    const pathParts = filePath.split("/");
    const tripsIdx = pathParts.indexOf("trips");
    if (tripsIdx < 1 || pathParts[tripsIdx - 1] !== "spice" || pathParts.length !== tripsIdx + 3) {
      return;
    }
    const slug = pathParts[tripsIdx + 1];
    const tripDir = `spice/trips/${slug}`;

    const folderObj = app.vault.getAbstractFileByPath(tripDir);
    if (!folderObj || !folderObj.children) return;

    const siblings = folderObj.children
      .filter(f => f.extension === "md")
      .filter(f => {
        const cache = app.metadataCache.getFileCache(f);
        return cache?.frontmatter?.type !== "trip";
      });

    const ICONS = {
      "Flights":      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
      "Stay":         `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
      "Packing List": `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
      "To Do":        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      "Notes":        `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      "Trip Board":   `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`,
    };
    const fallbackIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    const DEFAULT_ORDER = ["Flights", "Stay", "Packing List", "To Do", "Notes"];

    const pages = siblings.map(f => ({ file: { name: f.basename, path: f.path } }));

    // Trip Board lives under <slug>/board/<slug>-board.md (subfolder, not a sibling).
    // Synthesize a card entry pointing at it with the "Trip Board" display name.
    const boardPath = `${tripDir}/board/${slug}-board.md`;
    const boardFile = app.vault.getAbstractFileByPath(boardPath);
    if (boardFile) {
      pages.push({ file: { name: "Trip Board", path: boardPath } });
    }

    const isDefault = (name) => DEFAULT_ORDER.includes(name) || name === "Trip Board";

    await window.customJS.BeaconCards.render(dv, {
      pages,
      layout: "stacked",
      group: (p) => isDefault(p.file.name) ? "Default Sections" : "Additional Sections",
      title: (p) => p.file.name,
      icon: (p) => ICONS[p.file.name] || fallbackIcon,
      target: (p) => p.file.path,
      sort: (a, b) => {
        const aDef = isDefault(a.file.name);
        const bDef = isDefault(b.file.name);
        if (aDef && bDef) {
          if (a.file.name === "Trip Board") return 1;
          if (b.file.name === "Trip Board") return -1;
          return DEFAULT_ORDER.indexOf(a.file.name) - DEFAULT_ORDER.indexOf(b.file.name);
        }
        if (aDef) return -1;
        if (bDef) return 1;
        return a.file.name.localeCompare(b.file.name);
      },
      empty: "No sections yet. Click 'New Section' to add one."
    });
  }
}
