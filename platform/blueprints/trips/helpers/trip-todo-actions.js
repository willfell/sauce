// trip-todo-actions.js — TripToDoActions.
//
// Renders on a trip's To Do section note (type:trip-section, section_kind:to-do):
//   - an "Add task" button that opens the shared ToDoCreateTask dialog
//     pre-selected to the current trip (preselectTripSlug), and
//   - an "Open tasks" list of incomplete tasks referencing this trip via
//     an inline `[trip:: [[Name]]]` dataview field.
//
// customJS stores classes as INSTANCES; this file MUST stay a bare class
// expression with NO trailing statements (customjs-no-trailing-statements) —
// the loader evals the whole file as one expression, so any trailer would make
// the class silently fail to register.
class TripToDoActions {
  render(dv) {
    try {
      const page = customJS.RenderSafe.page(dv);
      if (!page || !page.file || page.type !== "trip-section" || page.section_kind !== "to-do") return;
      const c = (dv && dv.container) ? dv.container : dv;
      if (!c || typeof c.createEl !== "function") return;
      if (c.closest && c.closest(".markdown-embed")) return;
      const TD = window.customJS && window.customJS.ToDoCreateTask;
      if (TD) {
        if (customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") customJS.SectionLabel.divider(c);
        const row = c.createEl("div");
        row.style.cssText = "display:flex; justify-content:center; margin:0 auto; max-width:640px;";
        const plus = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
        const btn = customJS.AccentButton.render(row, { label: "Add task", icon: plus, onClick: () => {
          try { TD.open({ preselectTripSlug: page.trip_slug }); } catch (_e) { if (typeof Notice==="function") new Notice("Could not open the task dialog."); }
        }});
        if (btn && btn.style) { btn.style.minWidth = "128px"; btn.style.padding = "9px 14px"; }
      }
      // Open tasks that reference this trip via [trip:: [[Name]]].
      try {
        const bare = String(page.trip || "").replace(/^\[\[|\]\]$/g, "");
        if (bare) {
          const tasks = dv.pages().file.tasks.where(t => !t.completed && t.text && t.text.includes("trip::") && t.text.includes(bare));
          if (tasks && tasks.length) {
            if (customJS.SectionLabel && typeof customJS.SectionLabel.render === "function") customJS.SectionLabel.render(c, { text: "Open tasks" });
            dv.taskList(tasks, false, c);
          }
        }
      } catch (_e) { /* never throw */ }
    } catch (_e) { /* never throw */ }
  }
}
