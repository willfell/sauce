/**
 * KanbanStatusSyncInit — customjs startup-script bootstrap for kanban-status-sync.
 *
 * Registered in customjs plugin's startupScriptNames[] via the kanban-status-sync
 * mechanism's customjs_startup_scripts[] manifest entry. customjs invokes this
 * class's invoke() method at plugin init time. invoke() registers the manual
 * resync command and then *schedules* the startup sweep; it never performs it.
 * Once the sweep's gates open it calls
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
 *
 * GA-ML5 (mobile boot audit): the sweep leaves the boot path. invoke() used to `await` a
 * Dataview readiness poll of up to 30s and then the sweep itself, which held the
 * customJS startup-script chain — every later startup script waited behind it —
 * and put a vault write inside boot. The gates are now, in order:
 *   invoke() returns  →  workspace.onLayoutReady  →  idle deferral  →  Dataview
 *   ready (observed through scheduled retries)  →  syncAllBoards.
 * This mirrors the sauce-plugin boot-receipt deferral (GA-ML1) deliberately;
 * keep the two shapes aligned. The sweep's write scope is unchanged — the
 * 283-card write storm is the recorded incident behind this code, and moving
 * *when* it runs must never become a change to *what* it writes.
 */
class KanbanStatusSyncInit {
  async invoke() {
    try {
      this._registerResyncCommand();
      // Deliberately NOT awaited. Awaiting here — in any future refactor — would
      // put the Dataview wait and the sweep's vault writes back on the boot path.
      this._scheduleStartupSync();
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
          const dv = this._dataviewApi();
          if (!dv) {
            new Notice("Kanban re-sync: Dataview not available", 6000);
            return;
          }
          const r = await customJS.KanbanStatusSync.syncAllBoards(dv, this._today());
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

  // ---------- Startup sweep scheduling ----------
  // Gate order: layout-ready → idle → Dataview-ready → sweep. Every hop is a
  // scheduled callback, so invoke() hands control straight back to customJS and
  // no vault write can land while Obsidian is still assembling its workspace.
  // _onLayoutReadyFn / _setTimeoutFn / _clearTimeoutFn are injectable seams so a
  // fake-timer harness can drive the gates deterministically.
  _scheduleStartupSync() {
    if (this._startupScheduled) return;
    this._startupScheduled = true;
    const onReady = this._onLayoutReadyFn || this._appLayoutReady();
    const begin = () => {
      try {
        this._startupIdle = this._deferIdle(() => {
          this._startupIdle = null;
          this._startupSweepPromise = this._awaitDataviewThenSync(1);
        });
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn("[KanbanStatusSyncInit] startup sweep scheduling failed:", e && e.message);
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
  // fallback otherwise. Returns { cancel } so a pending sweep can be revoked.
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
  // than `await`-ing a poll loop. Attempt-counted (not wall-clock) so the bound
  // is deterministic under injected timers. 120 × 250ms ≈ the old 30s ceiling.
  _awaitDataviewThenSync(attempt) {
    const dv = this._dataviewApi();
    if (dv) return this._runStartupSync(dv);
    const maxAttempts = this._dataviewMaxAttempts || 120;
    const retryMs = this._dataviewRetryMs || 250;
    if (attempt >= maxAttempts) {
      if (typeof console !== "undefined") {
        console.warn(`[KanbanStatusSyncInit] Dataview not ready after ~${Math.round((maxAttempts * retryMs) / 1000)}s; skipping startup sync`);
      }
      return Promise.resolve(null);
    }
    const setT = this._setTimeoutFn || (typeof setTimeout !== "undefined" ? setTimeout : null);
    if (!setT) return Promise.resolve(null);
    return new Promise((resolve) => {
      this._dataviewRetryId = setT(() => {
        this._dataviewRetryId = null;
        resolve(this._awaitDataviewThenSync(attempt + 1));
      }, retryMs);
    });
  }

  _dataviewApi() {
    if (typeof app === "undefined" || !app) return null;
    const plugins = app.plugins && app.plugins.plugins;
    const dataview = plugins && plugins.dataview;
    return (dataview && dataview.api) ? dataview.api : null;
  }

  _today() {
    return (typeof window !== "undefined" && window && window.moment)
      ? window.moment().format("YYYY-MM-DD")
      : new Date().toISOString().slice(0, 10);
  }

  async _runStartupSync(dv) {
    if (!customJS || !customJS.KanbanStatusSync || typeof customJS.KanbanStatusSync.syncAllBoards !== "function") {
      if (typeof console !== "undefined") console.warn("[KanbanStatusSyncInit] customJS.KanbanStatusSync unavailable; skipping startup sync");
      return null;
    }
    try {
      // syncAllBoards is itself once-per-day cached on the customJS singleton, so
      // a re-init within the same session is a cache hit and writes nothing.
      const r = await customJS.KanbanStatusSync.syncAllBoards(dv, this._today());
      if (typeof console !== "undefined") {
        console.log(`[KanbanStatusSyncInit] startup sync: ${r.synced} synced, ${r.archived} archived across ${r.boards} boards`);
      }
      if ((r.synced + r.archived) > 0) {
        new Notice(`Kanban status synced: ${r.synced} moved, ${r.archived} archived across ${r.boards} boards`, 4000);
      }
      return r;
    } catch (e) {
      if (typeof console !== "undefined") console.warn("[KanbanStatusSyncInit] startup sync failed:", e && e.message);
      return null;
    }
  }
}
