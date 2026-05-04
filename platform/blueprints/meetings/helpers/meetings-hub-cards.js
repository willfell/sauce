/**
 * Meetings Hub Cards (CustomJS)
 * Displays today's meetings as interactive cards with status badges.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "MeetingsHubCards" });
 */
class MeetingsHubCards {
  async render(dv) {
    const currentFile = dv.current();
    const dateMatch = currentFile.file.name.match(/(\d{4}-\d{2}-\d{2})/);
    const currentDateStr = dateMatch ? dateMatch[1] : window.moment().format("YYYY-MM-DD");

    // (no spacePrefix — beacon has no Life/ namespace)

    const meetings = dv.pages('"beacon/meetings/notes"')
      .where(p => p.file.name.endsWith(`-${currentDateStr}`))
      .sort(p => {
        if (p.date) {
          return moment(p.date.toString()).format("HH:mm");
        }
        return p.file.name;
      });

    const icons = {
      clock: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
      users: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
      notes: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
      task: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
      pending: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    };

    if (meetings.length > 0) {
      const container = dv.el("div", "", {cls: "meeting-cards-container"});
      container.style.cssText = "display: flex; flex-direction: column; gap: 12px; margin: 16px 0;";

      for (const p of meetings) {
        const title = p.file.name.replace(/-\d{4}-\d{2}-\d{2}$/, "") || p.file.name;

        let time = "";
        if (p.date) {
          const dateStr = p.date.toString();
          const timePart = dateStr.split(" ")[1];
          if (timePart) {
            time = moment(timePart, "HH:mm").format("h:mm A");
          }
        }

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
              const match = line.match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
              return match ? (match[2] || match[1]) : "";
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

        const card = container.createEl("div", {cls: "meeting-card"});
        card.style.cssText = `
          background: var(--background-secondary);
          border: 1px solid var(--background-modifier-border);
          border-radius: 12px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        `;
        card.onmouseenter = () => {
          card.style.borderColor = "var(--interactive-accent)";
          card.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
          card.style.transform = "translateY(-2px)";
        };
        card.onmouseleave = () => {
          card.style.borderColor = "var(--background-modifier-border)";
          card.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05)";
          card.style.transform = "translateY(0)";
        };
        card.onclick = () => app.workspace.openLinkText(p.file.path, "");

        const header = card.createEl("div", {cls: "card-header"});
        header.style.cssText = "display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;";

        const titleEl = header.createEl("div", {cls: "card-title"});
        titleEl.style.cssText = "font-weight: 600; font-size: 1.1em; color: var(--text-normal); line-height: 1.3;";
        titleEl.textContent = title;

        if (time) {
          const timeEl = header.createEl("div", {cls: "card-time"});
          timeEl.style.cssText = "display: flex; align-items: center; gap: 4px; font-size: 0.85em; color: var(--text-muted); white-space: nowrap; margin-left: 8px;";
          timeEl.innerHTML = icons.clock + ` ${time}`;
        }

        if (attendees.length > 0) {
          const attendeesEl = card.createEl("div", {cls: "card-attendees"});
          attendeesEl.style.cssText = "display: flex; align-items: center; gap: 6px; font-size: 0.85em; color: var(--text-muted); margin-bottom: 10px;";
          const displayAttendees = attendees.length <= 3
            ? attendees.join(", ")
            : attendees.slice(0, 2).join(", ") + ` +${attendees.length - 2}`;
          attendeesEl.innerHTML = icons.users + ` <span>${displayAttendees}</span>`;
        }

        if (summary) {
          const summaryEl = card.createEl("div", {cls: "card-summary"});
          summaryEl.style.cssText = "font-size: 0.9em; color: var(--text-muted); margin-bottom: 10px; font-style: italic;";
          summaryEl.textContent = summary.length > 80 ? summary.substring(0, 77) + "..." : summary;
        }

        const badges = card.createEl("div", {cls: "card-badges"});
        badges.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap;";

        if (hasNotes) {
          const notesBadge = badges.createEl("span");
          notesBadge.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; font-size: 0.75em; background: var(--background-modifier-success); color: var(--text-on-accent-inverted, var(--text-normal));";
          notesBadge.innerHTML = icons.notes + " Notes";
        }

        if (openTasks > 0) {
          const taskBadge = badges.createEl("span");
          taskBadge.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; font-size: 0.75em; background: var(--background-modifier-error); color: var(--text-on-accent-inverted, var(--text-normal));";
          taskBadge.innerHTML = icons.pending + ` ${openTasks} open`;
        }

        if (doneTasks > 0) {
          const doneBadge = badges.createEl("span");
          doneBadge.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; font-size: 0.75em; background: var(--background-modifier-success); color: var(--text-on-accent-inverted, var(--text-normal));";
          doneBadge.innerHTML = icons.task + ` ${doneTasks} done`;
        }
      }

    } else {
      const empty = dv.el("div", "");
      empty.style.cssText = "text-align: center; padding: 40px 20px; color: var(--text-muted);";
      empty.innerHTML = `
        <div style="font-size: 2em; margin-bottom: 8px;">No meetings scheduled for today</div>
      `;
    }
  }
}
