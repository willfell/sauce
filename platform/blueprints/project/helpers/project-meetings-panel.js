// project-meetings-panel.js — v1.21.0 helper (sauce v0.109.0 S5).
//
// SpaceDailyDashboard-style 3-card panel of meetings linked to the current
// project. Each card carries attendees subtitle + Notes / open-task badges
// mirroring the daily dashboard's meeting cards exactly. No expand toggle (cap
// at 3 hard). Empty state: render nothing (no info callout) — consistent with
// v0.106.0.1's empty-state-callout removal.
//
// No "+ New meeting" button here: meetings are created from the meetings
// blueprint, so the project hub does not surface a New Meeting action (user
// decision, sauce v0.142.x). The SectionLabel and the cards only emit when
// there IS at least one meeting linked to the project.
class ProjectMeetingsPanel {
  async render(dv, opts = {}) {
    const current = globalThis.customJS?.RenderSafe?.page?.(dv);
    const currentPath = current?.file?.path;
    const projectName = current?.file?.name;
    if (!currentPath || !projectName) return;

    const meetings = dv.pages('"spice/meetings/notes"')
      .where((p) => p.type === "meeting" && this._projectMatches(p.project, currentPath, projectName));

    if (meetings.length === 0) return;

    const top3 = meetings.sort((p) => p.date, "desc").slice(0, 3);
    const enriched = await Promise.all(top3.map((p) => this._enrichMeeting(p)));

    customJS.SectionLabel.render(dv, { text: "Meetings" });

    const calendarIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

    await customJS.BeaconCards.render(dv, {
      pages: enriched,
      layout: "stacked",
      columns: 1,
      title: (p) => {
        let name = String(p.file.name || "");
        // Strip trailing -YYYY-MM-DD suffix (accuris convention).
        name = name.replace(/-\d{4}-\d{2}-\d{2}$/, "");
        return name || p.file.name;
      },
      subtitle: (p) => {
        const att = Array.isArray(p.attendees) ? p.attendees : [];
        if (att.length === 0) {
          const s = (p.summary && String(p.summary).trim()) || "";
          return s || null;
        }
        const max = 3;
        return att.length <= max
          ? att.join(", ")
          : `${att.slice(0, max - 1).join(", ")}, +${att.length - (max - 1)}`;
      },
      badges: (p) => {
        const out = [];
        if (p.hasNotes)      out.push({ label: "Notes",                tone: "accent", style: "outline" });
        if (p.openTasks > 0) out.push({ label: `${p.openTasks} open`,  tone: "warn",   style: "outline" });
        return out;
      },
      icon: () => calendarIcon,
      target: (p) => p.file.path,
    });
  }

  // Verbatim port of SpaceDailyDashboard._enrichMeeting. See that helper's
  // header docstring (platform/blueprints/daily/helpers/space-daily-dashboard.js)
  // for the contract. Returns a synthetic page (file + summary preserved;
  // attendees + openTasks + hasNotes derived from body parse) for BeaconCards.
  async _enrichMeeting(p) {
    let content = "";
    try {
      if (typeof app !== "undefined" && app && app.vault && p && p.file && p.file.path) {
        const file = app.vault.getAbstractFileByPath(p.file.path);
        if (file && typeof app.vault.read === "function") {
          content = await app.vault.read(file);
        }
      }
    } catch (_) {}

    const stripWikilink = (s) => {
      const str = String(s);
      const m = str.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      return m ? (m[2] || m[1]) : str;
    };

    let attendees = [];
    if (p && p.attendees && typeof p.attendees.length === "number" && p.attendees.length > 0) {
      for (let i = 0; i < p.attendees.length; i++) {
        const name = stripWikilink(p.attendees[i]).trim();
        if (name) attendees.push(name);
      }
    } else if (content) {
      const attendeesMatch = content.match(/## Attendees\s*([\s\S]*?)(?=---|##|$)/);
      if (attendeesMatch) {
        const lines = attendeesMatch[1].match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g);
        if (lines) {
          attendees = lines.map((l) => {
            const m = l.match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
            return m ? (m[2] || m[1]) : "";
          }).filter((a) => a);
        }
      }
    }

    const openTasks = (content.match(/- \[ \]/g) || []).length;

    let hasNotes = false;
    const notesMatch = content.match(/## Notes\s*([\s\S]*?)(?=---|##|$)/);
    if (notesMatch && notesMatch[1].trim().length > 5) {
      hasNotes = true;
    } else if (content) {
      let body = content;
      const fmEnd = body.indexOf("\n---", 4);
      if (body.indexOf("---") === 0 && fmEnd >= 0) body = body.slice(fmEnd + 4);
      body = body.replace(/```[\s\S]*?```/g, "");
      body = body.split("\n").filter((l) => !/^\s*-\s*\[[ xX]\]/.test(l)).join("\n");
      body = body.replace(/^#+\s.*$/gm, "");
      if (body.replace(/\s/g, "").length > 20) hasNotes = true;
    }

    return {
      file: p.file,
      summary: p.summary || "",
      attendees,
      openTasks,
      hasNotes,
    };
  }

  // Returns true if the meeting's `project:` field references the current
  // project note. Handles three Dataview field shapes (Link object, string,
  // empty); ported verbatim from the v0.102.0 implementation.
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
