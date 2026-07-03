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

    customJS.SectionLabel.render(dv, { text: "Recent activity" });

    await customJS.BeaconCards.render(dv, {
      pages: top.map((r) => r.page),
      layout: "row",
      title: (p) => {
        const n = String(p.file.name || "");
        return n.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name;
      },
      // Chrome overhaul WS2.3 — per-card type icon (meeting / doc / task).
      icon: (p) => this._cardIcon(p),
      // Chrome overhaul WS2.3 — doc cards show their section (`doc · <Section>`);
      // meetings/tasks stay `meeting`/`task`. Recency ("updated X ago") is
      // appended here at render time (the pure _cardMeta can't touch the clock).
      meta: (p) => {
        const base = this._cardMeta(p);
        const ts = (p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
        const when = ts && window.moment ? window.moment(ts).fromNow() : "";
        return when ? `${base} · ${when}` : base;
      },
      target: (p) => p.file.path,
    });
  }

  _row(p, tag) {
    const mtime = (p && p.file && p.file.mtime && p.file.mtime.ts) ? p.file.mtime.ts : 0;
    return { page: p, tag, mtime };
  }

  // ── Pure card helpers (WS2.3) ───────────────────────────────────────────────
  // Card type icons. Doc/task glyph shapes mirror project-nav-buttons.js's
  // `icons` object (file-document + checkbox); meeting is a calendar+users glyph.
  // Getter so the map is available without stubbing render (unit-tested).
  get _icons() {
    return {
      meeting: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`,
      doc: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
    };
  }

  // Classify an entry into one of meeting / doc / task. `type:meeting` →
  // meeting, `type:doc-note` → doc, everything else (task-note, board tasks,
  // untyped rows) → task. Pure — takes a plain entry, reads only `.type`.
  _kind(entry) {
    const t = entry && entry.type ? String(entry.type) : "";
    if (t === "meeting") return "meeting";
    if (t === "doc-note") return "doc";
    return "task";
  }

  // The type icon for a card, dispatched by _kind. Pure string return.
  _cardIcon(entry) {
    return this._icons[this._kind(entry)] || this._icons.task;
  }

  // Card meta prefix (WS2.3). Doc cards show `doc · <Section>` when a section is
  // set, else `doc`; meetings/tasks are just `meeting`/`task`. Pure — the render
  // callback appends the recency (` · updated X ago`) on top of this. Section is
  // only meaningful for docs (doc-note frontmatter carries `section:`; exposed
  // as `entry.section` by Dataview — same field project-docs-sections.js reads).
  _cardMeta(entry) {
    const kind = this._kind(entry);
    if (kind === "doc") {
      const section = entry && entry.section ? String(entry.section).trim() : "";
      return section ? `doc · ${section}` : "doc";
    }
    return kind; // "meeting" | "task"
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
