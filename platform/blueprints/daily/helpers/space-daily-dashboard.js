/**
 * Daily Dashboard (CustomJS)
 * Shows meetings and tasks for the current daily note.
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceDailyDashboard" });
 */
class SpaceDailyDashboard {
  async render(dv) {
    const icons = {
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      checkSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`
    };

    const currentFile = dv.current();
    const fileName = currentFile.file.name;
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    const today = dateMatch ? dateMatch[1] : moment().format("YYYY-MM-DD");

    const config = {
      meetingsPath: "beacon/meetings/notes",
      todoPaths: ["beacon/to-do"]
    };

    const getMeetings = () => {
      if (!config.meetingsPath) return [];
      const pages = dv.pages(`"${config.meetingsPath}"`)
        .where(p => p.file.name.startsWith(today))
        .sort(p => p.file.name, "asc");
      return pages.array().map(p => ({
        link: p.file.link,
        path: p.file.path,
        name: p.file.name.replace(`${today} `, ""),
        summary: p.summary || ""
      }));
    };

    const getTasks = () => {
      const tasks = [];
      for (const todoPath of config.todoPaths) {
        const todoPages = dv.pages(`"${todoPath}"`)
          .where(p => p.file.name.includes(today));
        for (const page of todoPages) {
          const pageTasks = page.file.tasks.where(t => !t.completed);
          for (const task of pageTasks) {
            tasks.push({ text: task.text, due: task.due });
          }
        }
      }
      return tasks;
    };

    const meetings = getMeetings();
    const tasks = getTasks();
    const hasContent = meetings.length > 0 || tasks.length > 0;
    if (!hasContent) return;

    // Guard against double-execution
    const existing = dv.container.querySelector(".space-daily-dashboard");
    if (existing) existing.remove();

    const container = dv.el("div", "", { cls: "space-daily-dashboard" });
    container.style.cssText = `
      background-color: var(--background-secondary);
      border-radius: 12px;
      padding: 20px;
      margin: 8px 0 16px 0;
      border: 1px solid var(--background-modifier-border);
    `;

    if (meetings.length > 0) {
      const meetingsSection = container.createEl("div", { cls: "section" });
      meetingsSection.style.cssText = "margin-bottom: 16px;";

      const meetingsHeader = meetingsSection.createEl("div", { cls: "section-header" });
      meetingsHeader.innerHTML = `${icons.calendar} <span>Today's Meetings</span>`;
      meetingsHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95em;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 10px;
      `;

      const meetingsList = meetingsSection.createEl("ul");
      meetingsList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

      for (const meeting of meetings) {
        const li = meetingsList.createEl("li");
        li.style.cssText = "margin: 6px 0; font-size: 0.9em;";
        const link = li.createEl("a", { cls: "internal-link", href: meeting.path });
        link.innerText = meeting.name;
        if (meeting.summary) {
          li.createEl("span", { text: ` — ${meeting.summary}` });
          li.lastChild.style.color = "var(--text-muted)";
        }
      }
    }

    if (tasks.length > 0) {
      const tasksSection = container.createEl("div", { cls: "section" });

      const tasksHeader = tasksSection.createEl("div", { cls: "section-header" });
      tasksHeader.innerHTML = `${icons.checkSquare} <span>Today's Tasks</span>`;
      tasksHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95em;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 10px;
      `;

      const tasksList = tasksSection.createEl("ul");
      tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

      for (const task of tasks) {
        const li = tasksList.createEl("li");
        li.style.cssText = "margin: 6px 0; font-size: 0.9em;";
        li.innerText = task.text;
      }
    }
  }
}
