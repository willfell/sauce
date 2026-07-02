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
      if (line.startsWith("## ")) { lane = line.replace("## ", "").trim(); continue; }  // lint-display-markers:allow Kanban board lane parse, not a display marker
      const m = line.match(/^- \[ \] (.+)$/);
      if (m && lane !== "Completed") {
        open.push({ text: m[1].trim(), lane });
        if (open.length >= 5) break;
      }
    }
    if (open.length === 0) return;             // empty-renders-nothing

    customJS.SectionLabel.render(dv, { text: "Open tasks" });

    const pages = open.map((t) => {
      // Board card text is typically a [[wikilink]] (optionally [[Name|Alias]]);
      // fall back to plain text. The task note created from the board lives at
      // <folder>/tasks/<Name>/<Name>.md (see Template, Kanban Card.md auto-promote).
      const m = t.text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
      const noteName = (m ? m[1] : t.text).trim();
      const display = (m && m[2] ? m[2] : noteName).trim();
      const taskNotePath = `${folder}/tasks/${noteName}/${noteName}.md`;
      // Target the task note when it exists; fall back to the board for cards
      // with no backing note so the click still does something sensible.
      const exists = !!(app.vault.getAbstractFileByPath
        && app.vault.getAbstractFileByPath(taskNotePath));
      return {
        file: { name: display, path: exists ? taskNotePath : boardPath, folder },
        _lane: t.lane,
      };
    });

    await customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: (p) => p.file.name,
      // Chrome overhaul WS2.3 — every card here is a board task, so stamp the
      // task (checkbox) icon on each one to match the activity-panel cards.
      icon: () => this._taskIcon(),
      meta: (p) => p._lane || "",
      target: (p) => p.file.path,
    });
  }

  // WS2.3 — task (checkbox) glyph, mirroring project-nav-buttons.js's task icon
  // and ProjectActivityPanel._icons.task. Kept as a pure accessor so it can be
  // unit-tested without stubbing the full Obsidian render.
  _taskIcon() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`;
  }
}
