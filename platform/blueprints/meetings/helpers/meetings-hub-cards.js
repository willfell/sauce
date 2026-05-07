/**
 * Meetings Hub Cards (CustomJS)
 * Thin wrapper around BeaconCards. Pre-fetches per-meeting content async
 * (attendees, task counts, notes-flag) into synthetic page objects, then
 * delegates rendering to BeaconCards with layout: "row".
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/Views/customjs-guard", { class: "MeetingsHubCards" });
 *
 * v0.2.0 (cards-cohesion cycle): migrated from hand-rolled card chrome to
 * BeaconCards.render call. Visual fidelity preserved via subtitle:{text,
 * secondaryText} + badges[].icon API extensions. LOC ~159 -> ~110.
 */
class MeetingsHubCards {
  async render(dv) {
    const currentFile = dv.current();
    const dateMatch = currentFile.file.name.match(/(\d{4}-\d{2}-\d{2})/);
    const currentDateStr = dateMatch ? dateMatch[1] : window.moment().format("YYYY-MM-DD");

    const icons = {
      clock: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      notes: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      pending: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };

    const meetingsRaw = dv.pages('"spice/meetings/notes"')
      .where(p => p.file.name.endsWith(`-${currentDateStr}`))
      .sort(p => {
        if (p.date) return moment(p.date.toString()).format("HH:mm");
        return p.file.name;
      })
      .array();

    // Pre-fetch async data: build synthetic page array.
    const enriched = await Promise.all(meetingsRaw.map(async (p) => {
      const file = app.vault.getAbstractFileByPath(p.file.path);
      let content = "";
      if (file) {
        content = await app.vault.read(file);
      }
      const attendeesMatch = content.match(/## Attendees\s*([\s\S]*?)(?=---|##|$)/);
      let attendees = [];
      if (attendeesMatch) {
        const attendeeLines = attendeesMatch[1].match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g);
        if (attendeeLines) {
          attendees = attendeeLines.map(line => {
            const m = line.match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
            return m ? (m[2] || m[1]) : "";
          }).filter(a => a);
        }
      }
      const openTasks = (content.match(/- \[ \]/g) || []).length;
      const doneTasks = (content.match(/- \[x\]/gi) || []).length;
      const notesSection = content.match(/## Notes\s*([\s\S]*?)(?=---|##|$)/);
      const hasNotes = notesSection && notesSection[1].trim().length > 5;
      let summary = p.summary || "";
      if (typeof summary === "string") {
        summary = summary.trim();
        if (summary === '""' || summary === "") summary = "";
      }
      let timeStr = "";
      if (p.date) {
        const dateStr = p.date.toString();
        const timePart = dateStr.split(" ")[1];
        if (timePart) timeStr = moment(timePart, "HH:mm").format("h:mm A");
      }
      return {
        file: { name: p.file.name, path: p.file.path },
        attendees,
        openTasks,
        doneTasks,
        hasNotes,
        summary,
        timeStr
      };
    }));

    await customJS.BeaconCards.render(dv, {
      pages: enriched,
      layout: "row",
      columns: 1,
      title: p => p.file.name.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name,
      meta: p => p.timeStr
        ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${icons.clock}<span>${p.timeStr}</span></span>`
        : "",
      subtitle: p => {
        const attendeesText = p.attendees.length === 0
          ? null
          : (p.attendees.length <= 3
              ? p.attendees.join(", ")
              : p.attendees.slice(0, 2).join(", ") + ` +${p.attendees.length - 2}`);
        if (!attendeesText && !p.summary) return null;
        if (!p.summary) return attendeesText;
        const truncated = p.summary.length > 80 ? p.summary.substring(0, 77) + "..." : p.summary;
        if (!attendeesText) return truncated;
        return { text: attendeesText, secondaryText: truncated };
      },
      badges: p => {
        const out = [];
        if (p.hasNotes) out.push({ label: "Notes", tone: "accent", icon: icons.notes });
        if (p.openTasks > 0) out.push({ label: `${p.openTasks} open`, tone: "error", icon: icons.pending });
        if (p.doneTasks > 0) out.push({ label: `${p.doneTasks} done`, tone: "accent", icon: icons.task });
        return out;
      },
      target: p => p.file.path,
      empty: "No meetings scheduled for today",
      sort: () => 0  // pre-sorted by Dataview .sort() above
    });
  }
}
