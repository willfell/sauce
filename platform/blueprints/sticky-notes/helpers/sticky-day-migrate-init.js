/**
 * StickyDayMigrateInit — customjs startup-script for StickyDayMigrate.
 *
 * Mirrors KanbanStatusSyncInit (kanban-status-sync@0.2.0). Registered in
 * customjs plugin's startupScriptNames[] via the sticky-notes blueprint's
 * customjs_startup_scripts[] manifest entry. customjs invokes invoke() at
 * plugin init time. invoke() waits for Dataview readiness (30s max), then
 * calls customJS.StickyDayMigrate.migrateAll() once per session.
 *
 * Also registers Obsidian command "Sauce: Re-migrate sticky-note day frontmatter"
 * (id sticky-day-migrate:resync-now) for cache-bypass re-runs.
 *
 * v0.5.2 (sauce v0.84.1): initial release.
 */
class StickyDayMigrateInit {
  async invoke() {
    try {
      this._registerResyncCommand();
      await this._runStartupMigration();
    } catch (e) {
      new Notice(`StickyDayMigrateInit error: ${String(e)}`, 8000);
      if (typeof console !== "undefined") console.error("[StickyDayMigrateInit]", e);
    }
  }

  _registerResyncCommand() {
    if (this._commandRegistered) return;
    if (typeof app === "undefined" || !app.commands || typeof app.commands.addCommand !== "function") return;
    app.commands.addCommand({
      id: "sticky-day-migrate:resync-now",
      name: "Sauce: Re-migrate sticky-note day frontmatter",
      callback: async () => {
        try {
          if (!customJS || !customJS.StickyDayMigrate) {
            new Notice("Sticky-note day migration: StickyDayMigrate unavailable", 6000);
            return;
          }
          const r = await customJS.StickyDayMigrate.migrateAll(true);
          new Notice(`Sticky-note day migration: ${r.migrated} migrated / ${r.scanned} scanned`, 6000);
        } catch (e) {
          new Notice(`Sticky-note day migration failed: ${String(e)}`, 8000);
          if (typeof console !== "undefined") console.error("[StickyDayMigrateInit resync]", e);
        }
      },
    });
    this._commandRegistered = true;
    if (typeof console !== "undefined") {
      console.log("[StickyDayMigrateInit] sticky-day-migrate:resync-now command registered at", new Date().toISOString());
    }
  }

  async _runStartupMigration() {
    const dv = await this._waitForDataview(30000, 250);
    if (!dv) {
      if (typeof console !== "undefined") console.warn("[StickyDayMigrateInit] Dataview not ready after 30s; skipping startup migration");
      return;
    }
    if (!customJS || !customJS.StickyDayMigrate || typeof customJS.StickyDayMigrate.migrateAll !== "function") {
      if (typeof console !== "undefined") console.warn("[StickyDayMigrateInit] customJS.StickyDayMigrate unavailable; skipping startup migration");
      return;
    }
    try {
      const r = await customJS.StickyDayMigrate.migrateAll(false);
      if (typeof console !== "undefined") {
        console.log(`[StickyDayMigrateInit] startup migration: ${r.migrated} migrated / ${r.scanned} scanned (skipped=${r.skipped})`);
      }
      if (r.migrated > 0) {
        new Notice(`Sticky-note day frontmatter migrated: ${r.migrated} file(s)`, 4000);
      }
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[StickyDayMigrateInit] startup migration failed:", e && e.message);
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
