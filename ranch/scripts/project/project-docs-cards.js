class ProjectDocsCards {
  async render(dv) {
    const currentFile = dv.current()?.file;
    if (!currentFile) return;
    const docsFolder = currentFile.folder;

    const siblings = dv
      .pages(`"${docsFolder}"`)
      .where((p) => p.type === "doc-note")
      .sort((p) => p.created, "desc");

    if (siblings.length === 0) {
      dv.paragraph("> [!info] No docs yet · Click \"+ New Doc\" above to create one");
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
