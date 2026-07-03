class TripSectionsCards {
  static _BOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;

  // Pure grouping logic — no vault access.
  // siblings: [{ basename, path, fm }] where fm.type === "trip-section"
  // boardPath: string | null
  // Returns sorted [{ title, path, kind, icon, group }]
  _buildRows(siblings, boardPath) {
    const kinds = customJS.TripSectionKinds;
    const rows = siblings.map(s => {
      const kind = s.fm.section_kind;
      const isDefault = kind && kind !== 'custom';
      return {
        title: s.fm.section || s.basename,
        path: s.path,
        kind,
        icon: kinds.iconFor(kind),
        group: isDefault ? 'Default Sections' : 'Additional Sections',
      };
    });

    if (boardPath) {
      rows.push({
        title: 'Trip Board',
        path: boardPath,
        kind: '_board',
        icon: TripSectionsCards._BOARD_SVG,
        group: 'Default Sections',
      });
    }

    rows.sort((a, b) => {
      const aDefault = a.group === 'Default Sections';
      const bDefault = b.group === 'Default Sections';
      if (aDefault !== bDefault) return aDefault ? -1 : 1;
      if (aDefault) {
        const aOrd = a.kind === '_board' ? 1000 : customJS.TripSectionKinds.order(a.kind);
        const bOrd = b.kind === '_board' ? 1000 : customJS.TripSectionKinds.order(b.kind);
        return aOrd - bOrd;
      }
      return a.title.localeCompare(b.title);
    });

    return rows;
  }

  async render(dv) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;
    const filePath = page.file.path;
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
      .map(f => {
        const cache = app.metadataCache.getFileCache(f);
        return { basename: f.basename, path: f.path, fm: cache?.frontmatter || {} };
      })
      .filter(s => s.fm.type === "trip-section");

    const boardPathCandidate = `${tripDir}/board/${slug}-board.md`;
    const boardExists = app.vault.getAbstractFileByPath(boardPathCandidate);
    const boardPath = boardExists ? boardPathCandidate : null;

    const rows = this._buildRows(siblings, boardPath);

    await window.customJS.BeaconCards.render(dv, {
      pages: rows,
      layout: "stacked",
      group: (r) => r.group,
      title: (r) => r.title,
      icon: (r) => r.icon,
      target: (r) => r.path,
      sort: (a, b) => rows.indexOf(a) - rows.indexOf(b),
      empty: 'No sections yet. Use “Go to… → New Section” to add one.',
    });
  }
}
