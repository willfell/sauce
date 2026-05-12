/**
 * Daily Dashboard (CustomJS)
 * Panel-host wrapper: tasks panel as compact bullet list (clickable to parent
 * file); meetings panel as BeaconCards.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
 *
 * v0.2.0 (cards-cohesion cycle): meetings panel migrated to BeaconCards via
 * thin {container: subContainerEl} dv shim; tasks panel kept as flat <ul>
 * (audit-predicted regression on cards-for-tasks confirmed by user smoke).
 * Tasks render ABOVE meetings. Both-empty short-circuit + per-section SVG
 * headers + double-execution guard preserved.
 *
 * v0.2.1 (S3.4.1 inline-CF): tasks panel reverted from BeaconCards to bullet
 * <ul> per user feedback — at-a-glance compact list is the right primitive
 * for tasks; cards bloat the visual.
 *
 * v0.2.6 (v0.31.0 S6.6 — daily dashboard polish):
 * - Meeting filter: file.name.startsWith(today) → file.name.includes(today).
 *   Picks up both leading-date "2026-05-12 Foo.md" and trailing-date
 *   "Foo-2026-05-12.md" naming conventions (accuris uses the latter).
 * - Dashboard container: added box-sizing: border-box + width: 100% +
 *   max-width: 100% + overflow-x: hidden. Prevents horizontal scroll when
 *   the parent column is narrow (padding no longer adds to width).
 * - Task <li>: added word-break: break-word + overflow-wrap: anywhere so
 *   long URL-y / no-space task strings wrap instead of forcing a scrollbar.
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
      meetingsPath: "spice/meetings/notes",
      todoPaths: ["spice/to-do"]
    };

    const getMeetings = () => {
      if (!config.meetingsPath) return [];
      // v0.2.6: match meetings whose filename CONTAINS today's date (covers
      // both leading-date "2026-05-12 Foo.md" and trailing-date "Foo-2026-05-12.md"
      // conventions). Previously matched only leading-date — accuris-style
      // trailing-date names were silently dropped.
      const pages = dv.pages(`"${config.meetingsPath}"`)
        .where(p => p.file.name.includes(today))
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
              text: task.text,
              parentPath: page.file.path
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

    const existing = dv.container.querySelector(".space-daily-dashboard");
    if (existing) existing.remove();

    const container = dv.el("div", "", { cls: "space-daily-dashboard" });
    // v0.2.6: prevent horizontal scroll at narrow widths.
    // - box-sizing: border-box → padding folds into width, not adds to it
    // - max-width: 100% → can't exceed parent width
    // - overflow-x: hidden → defensive cap if a card or task text would still overflow
    // - width: 100% → fills the dataviewjs viewport
    container.style.cssText = `
      background-color: var(--background-secondary);
      border-radius: 12px;
      padding: 20px;
      margin: 8px 0 16px 0;
      border: 1px solid var(--background-modifier-border);
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
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

      const tasksList = tasksSection.createEl("ul");
      tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

      for (const task of tasks) {
        const li = tasksList.createEl("li");
        // v0.2.6: word-break + overflow-wrap protect against long task strings
        // (URLs, hashes, no-space text) overflowing the dashboard.
        li.style.cssText = "margin: 6px 0; font-size: 0.9em; cursor: pointer; word-break: break-word; overflow-wrap: anywhere;";
        li.innerText = task.text;
        li.onclick = () => app.workspace.openLinkText(task.parentPath, "");
      }
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
