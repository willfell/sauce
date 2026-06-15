/**
 * KanbanStatusSyncInit — customjs startup-script bootstrap for kanban-status-sync.
 *
 * Registered in customjs plugin's startupScriptNames[] via the kanban-status-sync
 * mechanism's customjs_startup_scripts[] manifest entry. customjs invokes this
 * class's invoke() method at plugin init time. invoke() kicks off an async
 * helper that retries until Dataview's API is ready, then calls
 * customJS.KanbanStatusSync.syncAllBoards(dv, today) exactly once per session
 * (the underlying mechanism caches per-day, so subsequent invocations are
 * cache-hits).
 *
 * Also registers an Obsidian command "Sauce: Re-sync kanban boards" that
 * bypasses the once-per-day cache and forces a fresh sync. Discoverable via
 * Cmd+P.
 *
 * v0.2.0 (sauce v0.73.0): initial release. Moves the sync call out of
 * SpaceDailyDashboard's render path (daily@0.13.0); the dashboard now reads
 * pre-synced frontmatter instead of triggering the sync inline on every
 * Dataview re-render.
 */
class KanbanStatusSyncInit {
  async invoke() {
    try {
      this._registerResyncCommand();
      await this._runStartupSync();
    } catch (e) {
      new Notice(`KanbanStatusSyncInit error: ${String(e)}`, 8000);
      if (typeof console !== "undefined") console.error("[KanbanStatusSyncInit]", e);
    }
  }

  _registerResyncCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    app.commands.addCommand({
      id: "kanban-status-sync:resync-now",
      name: "Sauce: Re-sync kanban boards",
      callback: async () => {
        try {
          if (!customJS || !customJS.KanbanStatusSync) {
            new Notice("Kanban re-sync: KanbanStatusSync unavailable", 6000);
            return;
          }
          // Cache lives on the customJS singleton instance; nulling forces
          // syncAllBoards to skip the early-return at line 40-42 of
          // kanban-status-sync.js and run a fresh sweep.
          customJS.KanbanStatusSync._lastSyncDay = null;
          customJS.KanbanStatusSync._lastSyncResult = null;
          const dv = (app.plugins && app.plugins.plugins && app.plugins.plugins.dataview)
            ? app.plugins.plugins.dataview.api
            : null;
          if (!dv) {
            new Notice("Kanban re-sync: Dataview not available", 6000);
            return;
          }
          const today = (typeof window !== "undefined" && window.moment)
            ? window.moment().format("YYYY-MM-DD")
            : new Date().toISOString().slice(0, 10);
          const r = await customJS.KanbanStatusSync.syncAllBoards(dv, today);
          new Notice(`Kanban re-sync: ${r.synced} synced, ${r.archived} archived across ${r.boards} boards`, 6000);
        } catch (e) {
          new Notice(`Kanban re-sync failed: ${String(e)}`, 8000);
          if (typeof console !== "undefined") console.error("[KanbanStatusSyncInit resync]", e);
        }
      },
    });
    this._commandRegistered = true;
    if (typeof console !== "undefined") {
      console.log("[KanbanStatusSyncInit] kanban-status-sync:resync-now command registered at", new Date().toISOString());
    }
  }

  async _runStartupSync() {
    const dv = await this._waitForDataview(30000, 250);
    if (!dv) {
      if (typeof console !== "undefined") console.warn("[KanbanStatusSyncInit] Dataview not ready after 30s; skipping startup sync");
      return;
    }
    if (!customJS || !customJS.KanbanStatusSync || typeof customJS.KanbanStatusSync.syncAllBoards !== "function") {
      if (typeof console !== "undefined") console.warn("[KanbanStatusSyncInit] customJS.KanbanStatusSync unavailable; skipping startup sync");
      return;
    }
    const today = (typeof window !== "undefined" && window.moment)
      ? window.moment().format("YYYY-MM-DD")
      : new Date().toISOString().slice(0, 10);
    try {
      const r = await customJS.KanbanStatusSync.syncAllBoards(dv, today);
      if (typeof console !== "undefined") {
        console.log(`[KanbanStatusSyncInit] startup sync: ${r.synced} synced, ${r.archived} archived across ${r.boards} boards`);
      }
      if ((r.synced + r.archived) > 0) {
        new Notice(`Kanban status synced: ${r.synced} moved, ${r.archived} archived across ${r.boards} boards`, 4000);
      }
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[KanbanStatusSyncInit] startup sync failed:", e && e.message);
    }
  }

  async _waitForDataview(maxMs, intervalMs) {
    const start = Date.now();
    while ((Date.now() - start) < maxMs) {
      if (typeof app !== "undefined" && app.plugins && app.plugins.plugins
          && app.plugins.plugins.dataview && app.plugins.plugins.dataview.api) {
        return app.plugins.plugins.dataview.api;
      }
      await new Promise(res => setTimeout(res, intervalMs));
    }
    return null;
  }
}
