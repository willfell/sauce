/**
 * StickyDayMigrateInit — customjs startup-script for StickyDayMigrate.
 *
 * Mirrors KanbanStatusSyncInit (kanban-status-sync@0.3.0). Registered in
 * customjs plugin's startupScriptNames[] via the sticky-notes blueprint's
 * customjs_startup_scripts[] manifest entry. customjs invokes invoke() at
 * plugin init time. invoke() registers the manual resync command and then
 * *schedules* the day-frontmatter sweep; it never performs it. Once the gates
 * open it calls customJS.StickyDayMigrate.migrateAll(false) — the helper caches
 * per-day, so a re-init within the same session is a cache hit that rescans
 * nothing.
 *
 * Also registers Obsidian command "Sauce: Re-migrate sticky-note day frontmatter"
 * (id sticky-day-migrate:resync-now) for cache-bypass re-runs.
 *
 * v0.5.2 (sauce v0.84.1): initial release.
 *
 * GA-ML6 (mobile boot audit): the sweep leaves the boot path, adopting the same
 * contract GA-ML5 gave KanbanStatusSyncInit — keep the two shapes aligned.
 * invoke() used to `await` a Dataview readiness poll of up to 30s and then the
 * sweep itself, which held the customJS startup-script chain (every later
 * startup script waited behind it) and put whole-vault frontmatter writes inside
 * boot. The gates are now, in order:
 *   invoke() returns  →  workspace.onLayoutReady  →  idle deferral  →  Dataview
 *   ready (observed through scheduled retries)  →  migrateAll(false).
 * WHY BOTH GATES: the layout-ready hop is very nearly a no-op in production —
 * customJS already invokes startup scripts from inside its own onLayoutReady,
 * and Obsidian fires the callback immediately when layout is already ready — so
 * the IDLE DEFERRAL is the gate that actually keeps the sweep off the boot path.
 * A "simplification" that drops the idle deferral because layout-ready looks
 * sufficient puts the whole-vault sweep straight back into boot. Keep both.
 * The sweep's write scope is unchanged: moving *when* it runs must never become
 * a change to *what* it writes.
 */
class StickyDayMigrateInit {
  async invoke() {
    try {
      this._registerResyncCommand();
      // Deliberately NOT awaited. Awaiting here — in any future refactor — would
      // put the Dataview wait and the sweep's vault writes back on the boot path.
      this._scheduleStartupMigration();
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

  // ---------- Startup migration scheduling ----------
  // Gate order: layout-ready → idle → Dataview-ready → migrateAll. Every hop is a
  // scheduled callback, so invoke() hands control straight back to customJS and
  // no vault write can land while Obsidian is still assembling its workspace.
  // _onLayoutReadyFn / _setTimeoutFn / _clearTimeoutFn are injectable seams so a
  // fake-timer harness can drive the gates deterministically.
  _scheduleStartupMigration() {
    if (this._startupScheduled) return;
    this._startupScheduled = true;
    const onReady = this._onLayoutReadyFn || this._appLayoutReady();
    const begin = () => {
      try {
        this._startupIdle = this._deferIdle(() => {
          this._startupIdle = null;
          this._startupSweepPromise = this._awaitDataviewThenMigrate(1);
        });
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn("[StickyDayMigrateInit] startup migration scheduling failed:", e && e.message);
        }
      }
    };
    // No workspace to wait on (headless harness, or a load order where the
    // workspace object isn't there yet): the idle deferral alone still keeps the
    // sweep off the synchronous boot path.
    if (onReady) onReady(begin); else begin();
  }

  _appLayoutReady() {
    if (typeof app === "undefined" || !app || !app.workspace) return null;
    const ws = app.workspace;
    return (typeof ws.onLayoutReady === "function") ? ws.onLayoutReady.bind(ws) : null;
  }

  // Idle deferral: requestIdleCallback where the webview has it, setTimeout
  // fallback otherwise. This — not the layout-ready hop — is what actually keeps
  // the whole-vault sweep out of boot on mobile. Returns { cancel } so a pending
  // sweep can be revoked.
  _deferIdle(cb) {
    const g = (typeof window !== "undefined" && window) ? window : globalThis;
    if (!this._setTimeoutFn && g && typeof g.requestIdleCallback === "function") {
      const id = g.requestIdleCallback(cb, { timeout: 10000 });
      return { cancel: () => { if (typeof g.cancelIdleCallback === "function") g.cancelIdleCallback(id); } };
    }
    const setT = this._setTimeoutFn || (typeof setTimeout !== "undefined" ? setTimeout : null);
    const clearT = this._clearTimeoutFn || (typeof clearTimeout !== "undefined" ? clearTimeout : null);
    if (!setT) return { cancel: () => {} };
    const id = setT(cb, 1000);
    return { cancel: () => { if (clearT) clearT(id); } };
  }

  // Dataview readiness without blocking: re-check on a scheduled callback rather
  // than `await`-ing a poll loop. migrateAll() reads the vault directly, but
  // Dataview readiness remains the cheapest proxy for "the metadata cache is warm
  // enough that a sweep will see real frontmatter". Attempt-counted (not
  // wall-clock) so the bound is deterministic under injected timers.
  // 120 × 250ms ≈ the old 30s ceiling.
  _awaitDataviewThenMigrate(attempt) {
    const dv = this._dataviewApi();
    if (dv) return this._runStartupMigration();
    const maxAttempts = this._dataviewMaxAttempts || 120;
    const retryMs = this._dataviewRetryMs || 250;
    if (attempt >= maxAttempts) {
      if (typeof console !== "undefined") {
        console.warn(`[StickyDayMigrateInit] Dataview not ready after ~${Math.round((maxAttempts * retryMs) / 1000)}s; skipping startup migration`);
      }
      return Promise.resolve(null);
    }
    const setT = this._setTimeoutFn || (typeof setTimeout !== "undefined" ? setTimeout : null);
    if (!setT) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._dataviewRetryId = setT(() => {
        this._dataviewRetryId = null;
        resolve(this._awaitDataviewThenMigrate(attempt + 1));
      }, retryMs);
    });
  }

  _dataviewApi() {
    if (typeof app === "undefined" || !app) return null;
    const plugins = app.plugins && app.plugins.plugins;
    const dataview = plugins && plugins.dataview;
    return (dataview && dataview.api) ? dataview.api : null;
  }

  async _runStartupMigration() {
    if (!customJS || !customJS.StickyDayMigrate || typeof customJS.StickyDayMigrate.migrateAll !== "function") {
      if (typeof console !== "undefined") console.warn("[StickyDayMigrateInit] customJS.StickyDayMigrate unavailable; skipping startup migration");
      return null;
    }
    try {
      // force=false on purpose: migrateAll is once-per-day cached on the customJS
      // singleton, so a re-init within the same session is a cache hit that
      // rescans nothing. Passing true here would turn every reopen into a full
      // vault walk. A sweep interrupted mid-flight never commits that marker, so
      // the next session re-runs it — and per-file migration is idempotent, so
      // files the interrupted sweep already fixed are read and left alone.
      const r = await customJS.StickyDayMigrate.migrateAll(false);
      if (typeof console !== "undefined") {
        console.log(`[StickyDayMigrateInit] startup migration: ${r.migrated} migrated / ${r.scanned} scanned (skipped=${r.skipped})`);
      }
      if (r.migrated > 0) {
        new Notice(`Sticky-note day frontmatter migrated: ${r.migrated} file(s)`, 4000);
      }
      return r;
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[StickyDayMigrateInit] startup migration failed:", e && e.message);
      return null;
    }
  }
}
