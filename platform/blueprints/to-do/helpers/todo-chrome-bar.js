class ToDoChromeBar {
  get ICON() {
    return {
      plus: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
      repeat: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
      list: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
      back: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    const ICON = this.ICON;
    const ROOT = "spice/to-do";
    return {
      detect: (dv, page) => {
        const t = page && page.type;
        if (t === "to-do") return { context: "to-do", path: (page.file && page.file.path) || "" };
        if (t === "to-do-hub") return { context: "to-do-hub", path: (page.file && page.file.path) || "" };
        if (t === "project-todo") return { context: "project-todo", path: (page.file && page.file.path) || "" };
        if (t === "to-do-recurring") return { context: "to-do-recurring", path: (page.file && page.file.path) || "" };
        return null;
      },
      surfaceSpec: (ctx) => {
        if (ctx.context === "to-do") {
          return {
            primary: { id: "new-task", label: "New Task", icon: ICON.plus },
            overflow: [
              { id: "recurring", label: "Recurring", icon: ICON.repeat },
              { id: "all-todos", label: "All To-Dos", icon: ICON.list },
            ],
            leaf: true,
          };
        }
        if (ctx.context === "to-do-hub") {
          return {
            primary: null,
            overflow: [{ id: "back-today", label: "Back to Today", icon: ICON.back }],
            leaf: false,
          };
        }
        if (ctx.context === "project-todo") {
          return {
            primary: { id: "new-task", label: "New Task", icon: ICON.plus },
            overflow: [{ id: "recurring", label: "Recurring", icon: ICON.repeat }],
            leaf: true,
          };
        }
        if (ctx.context === "to-do-recurring") {
          return {
            primary: null,
            overflow: [{ id: "all-todos", label: "All To-Dos", icon: ICON.list }],
            leaf: true,
          };
        }
        return { primary: null, overflow: [], leaf: false };
      },
      dispatch: (dv, ctx, id) => {
        if (id === "new-task") {
          if (ctx.context === "project-todo") {
            try {
              let cur = null; try { cur = dv && dv.current ? dv.current() : null; } catch (_e) { cur = null; }
              const cleanName = (v) => {
                if (v == null) return "";
                if (typeof v === "object" && v !== null && ("path" in v || "display" in v)) {
                  const p = v.path != null ? String(v.path).trim() : "";
                  if (p) { const sl = p.lastIndexOf("/"); return (sl >= 0 ? p.slice(sl + 1) : p).replace(/\.md$/i, ""); }
                  return v.display != null ? String(v.display).trim() : "";
                }
                if (typeof v === "string") {
                  let s = v.trim(); const m = /^\[\[([^\]]*)\]\]$/.exec(s); if (m) s = m[1].trim();
                  const pipe = s.indexOf("|"); if (pipe >= 0) s = s.slice(0, pipe).trim();
                  const sl = s.lastIndexOf("/"); if (sl >= 0) s = s.slice(sl + 1);
                  return s.replace(/\.md$/i, "");
                }
                return String(v);
              };
              const slugify = (n) => String(n == null ? "" : n).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
              const name = cleanName(cur && cur.project);
              const slug = (cur && cur.project_slug) || (name ? slugify(name) : "");
              window.customJS.TaskDialog.open({ surface: "project", project: { name, slug } });
            } catch (e) { if (typeof Notice === "function") new Notice("Could not open task dialog: " + (e.message || e), 6000); }
          } else {
            try {
              window.customJS.TaskDialog.open({ surface: "daily", today: window.moment().format("YYYY-MM-DD") });
            } catch (e) { if (typeof Notice === "function") new Notice("Could not open task dialog: " + (e.message || e), 6000); }
          }
          return;
        }
        if (id === "recurring") {
          try { app.workspace.openLinkText("spice/to-do/Recurring Tasks.md", ""); }
          catch (e) { if (typeof Notice === "function") new Notice("Could not open Recurring Tasks: " + (e.message || e), 6000); }
          return;
        }
        if (id === "all-todos") {
          try { app.workspace.openLinkText("spice/to-do/All-ToDos.md", ""); }
          catch (e) { if (typeof Notice === "function") new Notice("Could not open All To-Dos: " + (e.message || e), 6000); }
          return;
        }
        if (id === "back-today") {
          try {
            const cmds = app.commands.commands || {};
            const tid = Object.keys(cmds).find(k => /templater.*Today To-Do/.test(k));
            if (tid) { app.commands.executeCommandById(tid); return; }
            const today = window.moment().format("YYYY-MM-DD");
            const folder = window.moment().format("YYYY/MM-MMMM");
            app.workspace.openLinkText(`spice/to-do/${folder}/ToDo-${today}.md`, "");
          } catch (e) { if (typeof Notice === "function") new Notice("Could not navigate to today: " + (e.message || e), 6000); }
          return;
        }
      },
      destinations: (dv, ctx) => {
        const out = [{ section: "This to-do" }];
        let curPath = ctx && ctx.path;
        if (!curPath) { try { const c = dv && dv.current ? dv.current() : null; curPath = (c && c.file && c.file.path) || ""; } catch (_e) { curPath = ""; } }
        const open = (p) => { try { customJS.ChromeBar.openNavTarget(p, dv); } catch (_e) {} };
        const todayPath = (() => {
          try {
            const today = window.moment().format("YYYY-MM-DD");
            const folder = window.moment().format("YYYY/MM-MMMM");
            return `spice/to-do/${folder}/ToDo-${today}.md`;
          } catch (_e) { return ""; }
        })();
        if (todayPath && curPath !== todayPath) {
          out.push({ label: "Today's To-Do", icon: ICON.back, _navTarget: todayPath, onSelect: () => open(todayPath) });
        }
        const allPath = "spice/to-do/All-ToDos.md";
        if (curPath !== allPath) {
          out.push({ label: "All To-Dos", icon: ICON.list, _navTarget: allPath, onSelect: () => open(allPath) });
        }
        return out;
      },
      rootClass: "todo-chrome-root",
      btnClass: (v) => `todo-chrome-btn todo-chrome-btn-${v}`,
    };
  }
}
