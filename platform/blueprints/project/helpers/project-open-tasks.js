// project-open-tasks.js — ProjectOpenTasks (Surface C).
//
// "Open tasks" panel on the project hub: top unchecked tasks from the project's
// Kanban board <slug>-board.md (excluding the Completed lane), in board order.
// Reuses the same board-parse shape as ProjectsHubCards. SectionLabel +
// BeaconCards; empty-renders-nothing. Single class per file.
class ProjectOpenTasks {
  async render(dv, opts = {}) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return;            // cold-load guard
    const folder = cur.file.folder;
    if (!folder) return;
    const slug = folder.split("/").pop();
    const boardPath = `${folder}/${slug}-board.md`;
    const boardFile = app.vault.getAbstractFileByPath(boardPath);
    if (!boardFile) return;                    // empty-renders-nothing

    let content = "";
    try { content = await app.vault.read(boardFile); } catch (_e) { return; }

    const open = [];
    let lane = "";
    for (const line of content.split("\n")) {
      if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; }
      const m = line.match(/^- \[ \] (.+)$/);
      if (m && lane !== "Completed") {
        open.push({ text: m[1].trim(), lane });
        if (open.length >= 5) break;
      }
    }
    if (open.length === 0) return;             // empty-renders-nothing

    customJS.SectionLabel.render(dv, { text: "Open tasks" });

    const pages = open.map((t) => ({
      file: { name: t.text, path: boardPath, folder },
      _lane: t.lane,
    }));

    await customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: (p) => p.file.name,
      meta: (p) => p._lane || "",
      target: (p) => p.file.path,
    });
  }
}
