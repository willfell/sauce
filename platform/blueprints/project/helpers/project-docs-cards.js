class ProjectDocsCards {
  async render(dv) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const docsFolder = currentFile.folder;

    const siblings = dv
      .pages(`"${docsFolder}"`)
      .where((p) => p.type === "doc-note");

    if (siblings.length === 0) {
      dv.paragraph("> [!info] No docs yet · Click \"+ New Doc\" above to create one");
      return;
    }

    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    // Ordering: BeaconCards' default sort (file.mtime.ts desc) — most recently
    // edited first, by design (v0.100.0 decision table).
    await customJS.BeaconCards.render(dv, {
      pages: siblings,
      layout: "row",
      title: (p) => p.file.name,
      icon: () => fileIcon,
      meta: (p) => {
        const created = this._formatCreated(p);
        const edited = moment(p.file.mtime.ts).fromNow();
        return created ? `created ${created} · edited ${edited}` : `edited ${edited}`;
      },
      target: (p) => p.file.link,
    });
  }

  // created_at is canonical ISO frontmatter; Dataview parses it into a Luxon
  // DateTime (has .toISO()), but unparsed strings can reach here too.
  // Pre-canonical notes have no created_at at all → fall back to file ctime.
  _formatCreated(p) {
    const raw = p.created_at;
    let m = null;
    if (raw && typeof raw.toISO === "function") m = moment(raw.toISO());
    else if (raw) m = moment(String(raw));
    if (!m || !m.isValid()) m = (p.file.ctime && p.file.ctime.ts) ? moment(p.file.ctime.ts) : null;
    return (m && m.isValid()) ? m.format("MMM D") : "";
  }
}
