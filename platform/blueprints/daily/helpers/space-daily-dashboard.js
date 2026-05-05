/**
 * Daily Dashboard (CustomJS)
 * Panel-host wrapper around two BeaconCards calls (tasks + meetings).
 *
 * Usage in DataviewJS:
 *   await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceDailyDashboard" });
 *
 * v0.2.0 (cards-cohesion cycle): migrated from flat <ul> lists to per-panel
 * BeaconCards.render calls (columns: 1). Panel-host wrapper preserved
 * (rounded background, per-section SVG headers). Both-empty short-circuit
 * preserved. Tasks render ABOVE meetings (S2 user feedback). Tasks use
 * synthetic-page pattern: each task becomes a {file:{name,path}, line, text,
 * _isTask:true} object with custom onClick that opens the parent file.
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
      return pages.array();
    };

    const getTasks = () => {
      const tasks = [];
      for (const todoPath of config.todoPaths) {
        const todoPages = dv.pages(`"${todoPath}"`)
          .where(p => p.file.name.includes(today));
        for (const page of todoPages) {
          const pageTasks = page.file.tasks.where(t => !t.completed);
          for (const task of pageTasks) {
            tasks.push({
              file: { name: page.file.name, path: page.file.path },
              line: task.line,
              text: task.text,
              _isTask: true
            });
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

    if (tasks.length > 0) {
      const tasksSection = container.createEl("div", { cls: "section" });
      tasksSection.style.cssText = "margin-bottom: 16px;";

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

      const tasksPanel = tasksSection.createEl("div");
      const tasksShim = { container: tasksPanel };
      await customJS.BeaconCards.render(tasksShim, {
        pages: tasks,
        layout: "stacked",
        columns: 1,
        title: p => p.text,
        target: p => p.file.path,
        onClick: (p, ev) => app.workspace.openLinkText(p.file.path, ""),
        sort: () => 0,
        empty: "(no tasks — should not render due to outer hasContent guard)"
      });
    }

    if (meetings.length > 0) {
      const meetingsSection = container.createEl("div", { cls: "section" });

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

      const meetingsPanel = meetingsSection.createEl("div");
      const meetingsShim = { container: meetingsPanel };
      await customJS.BeaconCards.render(meetingsShim, {
        pages: meetings,
        layout: "stacked",
        columns: 1,
        title: p => p.file.name.replace(`${today} `, ""),
        subtitle: p => {
          const s = p.summary || "";
          return (typeof s === "string" && s.trim()) ? s.trim() : null;
        },
        target: p => p.file.path,
        empty: "(no meetings — should not render due to outer hasContent guard)"
      });
    }
  }
}
