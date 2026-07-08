/**
 * HomeCommandsInit — customjs startup-script bootstrap that registers ONE
 * Obsidian command, "sauce-home:open", so Home is reachable from the command
 * palette (Cmd+P) and bindable to a hotkey (see the home blueprint's
 * manifest.json hotkeys[] entry, and applyHomeHotkeyRemapHeal in install.js
 * for already-installed vaults).
 *
 * Mirrors platform/blueprints/project/helpers/project-commands-init.js:
 * registered in customjs's startupScriptNames[] via the home blueprint's
 * customjs_startup_scripts[] manifest entry; customjs invokes this class's
 * invoke() at plugin init time.
 *
 * customJS class — NO imports/exports; loaded by the filesystem scan. invoke()
 * and the command callback are never-throw + cold-load-safe: a missing
 * app.commands degrades to a no-op, never a throw.
 */
class HomeCommandsInit {
  invoke() {
    try {
      this._registerCommands();
    } catch (e) {
      if (typeof console !== "undefined") console.error("[HomeCommandsInit]", e);
    }
  }

  _registerCommands() {
    // Idempotent: a second invoke() is a no-op.
    if (this._registered) return;
    const appRef = (typeof app !== "undefined" && app)
      || (typeof window !== "undefined" && window.app)
      || null;
    // Cold-load guard: bail (never throw) when the command API isn't available.
    if (!appRef || !appRef.commands || typeof appRef.commands.addCommand !== "function") return;

    appRef.commands.addCommand({
      id: "sauce-home:open",
      name: "Sauce Home: Open",
      callback: () => {
        try {
          const a = (typeof app !== "undefined" && app)
            || (typeof window !== "undefined" && window.app)
            || null;
          if (a && a.workspace && typeof a.workspace.openLinkText === "function") {
            a.workspace.openLinkText("spice/home/Home.md", "", false);
          }
        } catch (_e) { /* never throw */ }
      },
    });

    this._registered = true;
    if (typeof console !== "undefined") {
      console.log("[HomeCommandsInit] registered sauce-home:open at " + new Date().toISOString());
    }
  }
}
