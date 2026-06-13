// project-meetings-panel.js — v1.16.0 helper (sauce v0.102.0 S2.2).
//
// Renders the "## Meetings" panel on a project note. Queries every meeting
// under spice/meetings/notes whose `project:` frontmatter wikilinks to the
// current project note, shows the 5 most-recent (date desc) via BeaconCards
// (row layout), and an inline "View all N meetings →" toggle when total > 5.
//
// "+ New meeting for this project" button uses EntityCreate.render with
// presetPrompts: { project: `[[<projectName>]]` } so the project is
// pre-selected and the picker prompt is skipped.
//
// Project-match shapes handled by _projectMatches:
//   • Dataview Link object (wikilink parsed): .path === currentPath
//     OR .display === projectName.
//   • String (plain text or unparsed wikilink): includes("[[<projectName>]]")
//     OR === projectName.
//   • null/undefined/empty: false.
//
// The Project.md template rewrite that consumes this helper lands in v0.102.0 S4.
class ProjectMeetingsPanel {
  async render(dv, opts = {}) {
    const currentPath = dv.current()?.file?.path;
    const projectName = dv.current()?.file?.name;
    if (!currentPath || !projectName) return;

    // + New meeting for this project — presetPrompts skips the project picker
    // so the new meeting's frontmatter carries `project: "[[<projectName>]]"`.
    await customJS.EntityCreate.render(dv, {
      instance: "meeting",
      presetPrompts: { project: `[[${projectName}]]` },
    });

    const meetings = dv.pages('"spice/meetings/notes"')
      .where((p) => p.type === "meeting" && this._projectMatches(p.project, currentPath, projectName));

    if (meetings.length === 0) {
      dv.paragraph(`> [!info]+ No meetings linked to this project yet. Use **+ New meeting for this project** above, or add \`project: "[[${projectName}]]"\` to an existing meeting's frontmatter.`);
      return;
    }

    const sorted = meetings.sort(p => p.date, "desc");
    const top5 = sorted.limit(5);
    const total = meetings.length;

    const calendarIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

    const metaFn = (p) => {
      const date = p.date ? String(p.date).slice(0, 10) : "(no date)";
      const attendees = Array.isArray(p.attendees) ? p.attendees.length : 0;
      return `${date} · ${attendees} attendee${attendees === 1 ? "" : "s"}`;
    };

    await customJS.BeaconCards.render(dv, {
      pages: top5,
      layout: "row",
      title: (p) => p.file.name,
      icon: () => calendarIcon,
      meta: metaFn,
    });

    if (total > 5) {
      const expandEl = dv.el("p", `View all ${total} meetings →`, { cls: "project-meetings-expand" });
      expandEl.style.cursor = "pointer";
      expandEl.style.color = "var(--interactive-accent)";
      let expanded = false;
      expandEl.addEventListener("click", async () => {
        if (expanded) return;
        expanded = true;
        expandEl.remove();
        await customJS.BeaconCards.render(dv, {
          pages: sorted,
          layout: "row",
          title: (p) => p.file.name,
          icon: () => calendarIcon,
          meta: metaFn,
        });
      });
    }
  }

  // Returns true if the meeting's `project:` field references the current
  // project note. Handles three Dataview field shapes (Link object, string,
  // empty); see header comment for the full table.
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
