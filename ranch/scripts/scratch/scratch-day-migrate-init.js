/**
 * ScratchDayMigrateInit — customjs startup-script for ScratchDayMigrate.
 *
 * Mirrors KanbanStatusSyncInit (kanban-status-sync@0.2.0). Registered in
 * customjs plugin's startupScriptNames[] via the scratch blueprint's
 * customjs_startup_scripts[] manifest entry. customjs invokes invoke() at
 * plugin init time. invoke() waits for Dataview readiness (30s max), then
 * calls customJS.ScratchDayMigrate.migrateAll() once per session.
 *
 * Also registers Obsidian command "Sauce: Re-migrate scratch day frontmatter"
 * (id scratch-day-migrate:resync-now) for cache-bypass re-runs.
 *
 * v0.5.2 (sauce v0.84.1): initial release.
 */
class ScratchDayMigrateInit {
  async invoke() {
    try {
      this._registerResyncCommand();
      await this._runStartupMigration();
    } catch (e) {
      new Notice(`ScratchDayMigrateInit error: ${String(e)}`, 8000);
      if (typeof console !== "undefined") console.error("[ScratchDayMigrateInit]", e);
    }
  }

  _registerResyncCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    app.commands.addCommand({
      id: "scratch-day-migrate:resync-now",
      name: "Sauce: Re-migrate scratch day frontmatter",
      callback: async () => {
        try {
          if (!customJS || !customJS.ScratchDayMigrate) {
            new Notice("Scratch day migration: ScratchDayMigrate unavailable", 6000);
            return;
          }
          const r = await customJS.ScratchDayMigrate.migrateAll(true);
          new Notice(`Scratch day migration: ${r.migrated} migrated / ${r.scanned} scanned`, 6000);
        } catch (e) {
          new Notice(`Scratch day migration failed: ${String(e)}`, 8000);
          if (typeof console !== "undefined") console.error("[ScratchDayMigrateInit resync]", e);
        }
      },
    });
    this._commandRegistered = true;
    if (typeof console !== "undefined") {
      console.log("[ScratchDayMigrateInit] scratch-day-migrate:resync-now command registered at", new Date().toISOString());
    }
  }

  async _runStartupMigration() {
    const dv = await this._waitForDataview(30000, 250);
    if (!dv) {
      if (typeof console !== "undefined") console.warn("[ScratchDayMigrateInit] Dataview not ready after 30s; skipping startup migration");
      return;
    }
    if (!customJS || !customJS.ScratchDayMigrate || typeof customJS.ScratchDayMigrate.migrateAll !== "function") {
      if (typeof console !== "undefined") console.warn("[ScratchDayMigrateInit] customJS.ScratchDayMigrate unavailable; skipping startup migration");
      return;
    }
    try {
      const r = await customJS.ScratchDayMigrate.migrateAll(false);
      if (typeof console !== "undefined") {
        console.log(`[ScratchDayMigrateInit] startup migration: ${r.migrated} migrated / ${r.scanned} scanned (skipped=${r.skipped})`);
      }
      if (r.migrated > 0) {
        new Notice(`Scratch day frontmatter migrated: ${r.migrated} file(s)`, 4000);
      }
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[ScratchDayMigrateInit] startup migration failed:", e && e.message);
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
