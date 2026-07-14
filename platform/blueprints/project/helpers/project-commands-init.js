/**
 * ProjectCommandsInit — customjs startup-script bootstrap that mirrors the
 * project chrome-bar's actions as Obsidian commands.
 *
 * Registered in customjs plugin's startupScriptNames[] via the project
 * blueprint's customjs_startup_scripts[] manifest entry (wired in Task 8).
 * customjs invokes this class's invoke() at plugin init time. invoke() registers
 * ten commands so every project nav + create action the chrome bar's Go ▾ /
 * primary / ⋯ controls expose is ALSO reachable from the command palette
 * (Cmd+P) and bindable to a hotkey — without any button.
 *
 * Single source of truth: every command callback resolves the active file + the
 * Dataview api, builds the surface context via ProjectChromeBar.detectContext,
 * then DELEGATES to the SAME helper the button uses — create/action commands to
 * ProjectChromeBar._dispatch(dv, ctx, id); nav commands to
 * ProjectChromeBar.navTarget(dv, ctx, key) + ._openNavTarget(path, dv). No path
 * or action logic is reimplemented here; the chrome bar owns it.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan. invoke()
 * and every callback are never-throw + cold-load-safe: a missing app.commands,
 * ProjectChromeBar, or Dataview degrades to a Notice / no-op, never a throw.
 */
class ProjectCommandsInit {
  invoke() {
    try {
      this._registerCommands();
    } catch (e) {
      if (typeof console !== "undefined") console.error("[ProjectCommandsInit]", e);
    }
  }

  _registerCommands() {
    // Idempotent: a second invoke() is a no-op.
    if (this._registered) return;
    // Cold-load guard: bail (never throw) when the command API isn't available.
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;

    // Create/action commands → ProjectChromeBar._dispatch(dv, ctx, <action id>).
    // Nav commands → ProjectChromeBar.navTarget(dv, ctx, <key>) + ._openNavTarget.
    const ACTIONS = [
      { id: "sauce-project:new-task", name: "Sauce Project: New task", kind: "action", arg: "new-task" },
      { id: "sauce-project:new-doc", name: "Sauce Project: New doc", kind: "action", arg: "new-doc" },
      { id: "sauce-project:move-doc", name: "Sauce Project: Move doc", kind: "action", arg: "move-docs" },
      { id: "sauce-project:add-workstream", name: "Sauce Project: Add workstream", kind: "action", arg: "add-workstream" },
      { id: "sauce-project:add-link", name: "Sauce Project: Add link", kind: "action", arg: "add-link" },
      { id: "sauce-project:archive-toggle", name: "Sauce Project: Archive / Unarchive project", kind: "action", arg: "archive-toggle" },
      { id: "sauce-project:go-board", name: "Sauce Project: Go to Board", kind: "nav", arg: "board" },
      { id: "sauce-project:go-docs", name: "Sauce Project: Go to Docs", kind: "nav", arg: "docs" },
      { id: "sauce-project:go-map", name: "Sauce Project: Go to Map", kind: "nav", arg: "map" },
      { id: "sauce-project:go-todo", name: "Sauce Project: Go to To-Do", kind: "nav", arg: "todo" },
      { id: "sauce-project:go-links", name: "Sauce Project: Go to Links", kind: "nav", arg: "links" },
    ];

    for (const a of ACTIONS) {
      app.commands.addCommand({
        id: a.id,
        name: a.name,
        callback: () => {
          try {
            if (a.kind === "nav") this._runNav(a.arg);
            else this._runAction(a.arg);
          } catch (_e) { /* never throw */ }
        },
      });
    }

    this._registered = true;
    if (typeof console !== "undefined") {
      console.log("[ProjectCommandsInit] registered", ACTIONS.length, "project commands at", new Date().toISOString());
    }
  }

  // Resolve { dv, ctx } for the active file, or null when there is no active
  // file / it isn't a project note / ProjectChromeBar is unavailable. On the
  // no-file / non-project path, surfaces a Notice so a mis-fired command tells
  // the user why nothing happened.
  _resolveContext() {
    const dv = (typeof app !== "undefined" && app.plugins && app.plugins.plugins
      && app.plugins.plugins.dataview) ? app.plugins.plugins.dataview.api : null;
    let file = null;
    try { file = app.workspace && typeof app.workspace.getActiveFile === "function" ? app.workspace.getActiveFile() : null; }
    catch (_e) { file = null; }
    if (!file || !file.path) {
      if (typeof Notice === "function") new Notice("Open a project note first.", 4000);
      return null;
    }
    const PCB = (typeof customJS !== "undefined") && customJS.ProjectChromeBar;
    if (!PCB || typeof PCB.detectContext !== "function") {
      if (typeof Notice === "function") new Notice("ProjectChromeBar unavailable — reinstall the project blueprint.", 6000);
      return null;
    }
    let ctx = null;
    try { ctx = PCB.detectContext(file.path, dv); } catch (_e) { ctx = null; }
    if (!ctx || ctx.context === "non-project") {
      if (typeof Notice === "function") new Notice("Open a project note first.", 4000);
      return null;
    }
    return { dv, ctx, PCB };
  }

  // Create/action command → delegate to ProjectChromeBar._dispatch (it already
  // guards every missing helper + never throws).
  _runAction(actionId) {
    const resolved = this._resolveContext();
    if (!resolved) return;
    try {
      if (typeof resolved.PCB._dispatch === "function") resolved.PCB._dispatch(resolved.dv, resolved.ctx, actionId);
    } catch (_e) { /* never throw */ }
  }

  // Nav command → resolve the destination via ProjectChromeBar.navTarget (SAME
  // logic the Go ▾ launcher uses), then open it via ._openNavTarget. An
  // unresolvable destination surfaces a Notice.
  _runNav(key) {
    const resolved = this._resolveContext();
    if (!resolved) return;
    try {
      const path = (typeof resolved.PCB.navTarget === "function")
        ? resolved.PCB.navTarget(resolved.dv, resolved.ctx, key)
        : null;
      if (!path) {
        if (typeof Notice === "function") new Notice("That destination isn't available for this project.", 4000);
        return;
      }
      if (typeof resolved.PCB._openNavTarget === "function") resolved.PCB._openNavTarget(path, resolved.dv);
    } catch (_e) { /* never throw */ }
  }
}
