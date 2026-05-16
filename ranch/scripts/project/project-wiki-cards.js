class ProjectWikiCards {
  async view(dv) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const wikiFolder = currentFile.folder;

    const siblings = dv
      .pages(`"${wikiFolder}"`)
      .where((p) => p.type === "wiki-note")
      .sort((p) => p.created, "desc");

    if (siblings.length === 0) {
      dv.paragraph("> [!info] No wiki notes yet · Click \"+ New Wiki Note\" above to create one");
      return;
    }

    await customJS.BeaconCards.render(dv, {
      pages: siblings,
      title: (p) => p.file.name,
      subtitle: (p) => (p.created ? String(p.created) : ""),
      target: (p) => p.file.link,
    });
  }
}
