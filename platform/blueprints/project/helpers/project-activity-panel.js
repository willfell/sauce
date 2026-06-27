// project-activity-panel.js — ProjectActivityPanel (Surface B).
//
// "Recent activity" panel on the project hub: the project's most-recently-
// touched docs + linked meetings + task notes, newest-first, capped at 5.
// SectionLabel + BeaconCards; empty-renders-nothing. Deliberately NOT the
// vault-wide time-windowed activity-feed mechanism (wrong axis — see the
// 2026-06-26 design spec). Single class per file (customjs contract).
class ProjectActivityPanel {
  async render(dv, opts = {}) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return;            // cold-load guard (landmine #1/#2)
    const folder = cur.file.folder;
    if (!folder) return;
    const currentPath = cur.file.path;
    const projectName = cur.name || cur.file.name;

    const rows = [];
    try {
      for (const p of dv.pages(`"${folder}/docs"`).where((p) => p && p.type === "doc-note")) {
        rows.push(this._row(p, "doc"));
      }
    } catch (_e) {}
    try {
      for (const p of dv.pages('"spice/meetings/notes"')
          .where((p) => p && p.type === "meeting" && this._projectMatches(p.project, currentPath, projectName))) {
        rows.push(this._row(p, "mtg"));
      }
    } catch (_e) {}
    try {
      for (const p of dv.pages(`"${folder}/tasks"`).where((p) => p && p.type === "task-note")) {
        rows.push(this._row(p, "task"));
      }
    } catch (_e) {}

    const valid = rows.filter((r) => r && r.mtime > 0);
    if (valid.length === 0) return;            // empty-renders-nothing

    valid.sort((a, b) => b.mtime - a.mtime);
    const top = valid.slice(0, 5);
    const byPath = new Map(top.map((r) => [r.page.file.path, r.tag]));

    customJS.SectionLabel.render(dv, { text: "Recent activity" });

    await customJS.BeaconCards.render(dv, {
      pages: top.map((r) => r.page),
      layout: "row",
      title: (p) => {
        const n = String(p.file.name || "");
        return n.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name;
      },
      meta: (p) => {
        const tag = byPath.get(p.file.path) || "";
        const label = { doc: "doc", mtg: "meeting", task: "task" }[tag] || tag;
        const ts = (p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
        const when = ts ? window.moment(ts).fromNow() : "";
        return when ? `${label} · ${when}` : label;
      },
      target: (p) => p.file.path,
    });
  }

  _row(p, tag) {
    const mtime = (p && p.file && p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
    return { page: p, tag, mtime };
  }

  // Verbatim port of ProjectMeetingsPanel._projectMatches (3 field shapes).
  _projectMatches(field, currentPath, projectName) {
    if (!field) return false;
    if (typeof field === "string") {
      return field.includes(`[[${projectName}]]`)
          || field.includes(`[[${projectName}|`)
          || field === projectName;
    }
    if (field.path) return field.path === currentPath;
    if (field.display) return field.display === projectName;
    return false;
  }
}
