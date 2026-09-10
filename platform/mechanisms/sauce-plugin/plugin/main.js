// Sauce plugin — registers customJS renderer classes on window.customJS at
// onload(), so dataviewjs blocks dispatched through the customjs-guard view find
// their class on the FIRST poll iteration (no ~2s "loading…" cold-load flash).
//
// This deliberately mirrors what the CustomJS community plugin does — it ONLY
// instantiates classes (`new Class()`), exactly like CustomJS, and does NOT run
// any startupScriptNames inits (those stay owned by CustomJS, whose side effects
// live in an init() method, not the constructor — so there is no double-init).
//
// CustomJS remains enabled as the fallback: if this plugin fails to load, errors,
// or loses the startup race, CustomJS still populates window.customJS and the
// guard poll still resolves. Worst case is today's behavior — this cannot regress.
'use strict';

const { Plugin } = require('obsidian');

// First ~80 chars after skipping leading whitespace + // and /* */ comments.
// Mirrors ranch/views/customjs-guard + run-customjs-loadable's firstRealToken.
function firstRealToken(src) {
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    break;
  }
  return src.slice(i, i + 80);
}

function isClassFile(src) {
  return /^class\b/.test(firstRealToken(src));
}

// Replicate CustomJS's evalFile: eval(`(${body})`) then `new def()`.
function instantiateClass(body) {
  // eslint-disable-next-line no-eval
  const def = eval('(' + body + ')');
  if (typeof def !== 'function') throw new Error('eval did not yield a constructable class');
  return { name: def.name, instance: new def() };
}

// Instantiate every class-file into `target` (window.customJS). Per-file
// try/catch — a bad/non-class file is recorded, never thrown.
function registerAll(target, files) {
  const registered = [];
  const failures = [];
  for (const entry of files) {
    const body = entry.body;
    if (!isClassFile(body)) continue;
    try {
      const r = instantiateClass(body);
      if (!r.name) { failures.push({ path: entry.path, message: 'class had no name' }); continue; }
      target[r.name] = r.instance;
      registered.push(r.name);
    } catch (e) {
      const kind = (e && e.constructor) ? e.constructor.name : 'Error';
      failures.push({ path: entry.path, message: kind + ': ' + String(e && e.message).split('\n')[0] });
    }
  }
  return { registered, failures };
}

// Resolve the folder customJS loads classes from — read its configured jsFolder
// (.obsidian/plugins/customjs/data.json) so we load from wherever CustomJS does,
// even if a vault customizes it. Falls back to the default "ranch/scripts".
// Never throws.
async function resolveScriptsFolder(app) {
  try {
    const adapter = app.vault.adapter;
    const cfgPath = '.obsidian/plugins/customjs/data.json';
    if (await adapter.exists(cfgPath)) {
      const cfg = JSON.parse(await adapter.read(cfgPath));
      if (cfg && typeof cfg.jsFolder === 'string' && cfg.jsFolder.trim()) return cfg.jsFolder.trim();
    }
  } catch (_e) { /* fall through to default */ }
  return 'ranch/scripts';
}

// Monotonic clock for boot-stage timings — performance.now() where the webview
// provides it, Date.now() otherwise. Cheap enough to call around every stage.
function monotonicNow() {
  const g = (typeof globalThis !== 'undefined') ? globalThis : window;
  const p = g.performance;
  return (p && typeof p.now === 'function') ? p.now() : Date.now();
}

function elapsedMs(from, to) {
  return Math.round((to - from) * 100) / 100;
}

const BOOT_RECEIPT_PATH = 'ranch/boot-profile.json';

// Walk the customJS scripts folder, read every .js, and register the class-files
// onto window.customJS. Also captures a per-stage boot profile (file count,
// bytes read, elapsed ms) — timestamps only, no extra work before classes are
// available; the receipt write happens later, after layout-ready idle.
// Exported for headless testing.
async function loadCustomJsClasses(app) {
  const stages = [];
  const t0 = monotonicNow();
  const adapter = app.vault.adapter;
  const folder = await resolveScriptsFolder(app);
  const t1 = monotonicNow();
  stages.push({ name: 'resolve-scripts-folder', elapsed_ms: elapsedMs(t0, t1) });
  const files = [];
  let bytes = 0;
  const walk = async (dir) => {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return; }
    for (const f of (listing.files || [])) {
      if (f.endsWith('.js')) {
        try {
          const body = await adapter.read(f);
          files.push({ path: f, body });
          bytes += body.length;
        } catch (_e) { /* skip unreadable */ }
      }
    }
    for (const d of (listing.folders || [])) await walk(d);
  };
  await walk(folder);
  const t2 = monotonicNow();
  stages.push({ name: 'read-class-files', elapsed_ms: elapsedMs(t1, t2), files: files.length, bytes });
  const w = (typeof window !== 'undefined') ? window : globalThis;
  w.customJS = w.customJS || {};
  const res = registerAll(w.customJS, files);
  const t3 = monotonicNow();
  stages.push({ name: 'register-classes', elapsed_ms: elapsedMs(t2, t3), registered: res.registered.length, failed: res.failures.length });
  res.profile = { total_ms: elapsedMs(t0, t3), stages };
  return res;
}

class SaucePlugin extends Plugin {
  async onload() {
    const bootStartedAt = new Date().toISOString();
    let profile = null;
    try {
      const res = await loadCustomJsClasses(this.app);
      profile = res.profile;
      console.log('[sauce] registered ' + res.registered.length + ' customJS class(es)'
        + (res.failures.length ? ' (' + res.failures.length + ' non-class/failed skipped)' : ''));
    } catch (e) {
      // Never throw out of onload — CustomJS fallback still populates window.customJS.
      console.error('[sauce] onload class-load failed (CustomJS fallback applies): ' + (e && e.message));
    }
    // Faster reconciliation of Dataview views on background vault changes (below).
    try { this._installReconciler(); } catch (e) { console.error('[sauce] reconciler install failed: ' + (e && e.message)); }
    // Boot-profile receipt — deferred to layout-ready + idle so profiling never
    // adds boot-time work or a boot-time vault write. Never throws.
    try { this._scheduleBootReceipt(bootStartedAt, profile); } catch (e) { console.warn('[sauce] boot-profile scheduling failed: ' + (e && e.message)); }
  }

  onunload() {
    this._unloaded = true;
    if (this._bootReceiptIdle) {
      try { this._bootReceiptIdle.cancel(); } catch (_e) { /* never throw */ }
      this._bootReceiptIdle = null;
    }
  }

  // ---------- Boot-profile receipt ----------
  // Writes the last boot's stage profile to ranch/boot-profile.json so any
  // device (mobile included, via sync) can read what its boot paid. The write is
  // gated on onLayoutReady AND an idle deferral — a profiler that slows boot to
  // measure boot would defeat the point. Repeated boots overwrite the receipt.

  _scheduleBootReceipt(startedAt, profile) {
    if (!profile) return;
    const ws = this.app && this.app.workspace;
    const onReady = this._onLayoutReadyFn
      || (ws && typeof ws.onLayoutReady === 'function' ? ws.onLayoutReady.bind(ws) : null);
    if (!onReady) return;
    onReady(() => {
      try {
        if (this._unloaded) return;
        this._bootReceiptIdle = this._deferIdle(() => {
          this._bootReceiptIdle = null;
          if (this._unloaded) return;
          this._writeBootReceipt(startedAt, profile);
        });
      } catch (_e) { /* never throw */ }
    });
  }

  // Idle deferral: requestIdleCallback where the webview has it, setTimeout
  // fallback otherwise. Returns { cancel } so unload can revoke a pending write.
  _deferIdle(cb) {
    const g = (typeof window !== 'undefined') ? window : globalThis;
    if (!this._setTimeoutFn && typeof g.requestIdleCallback === 'function') {
      const id = g.requestIdleCallback(cb, { timeout: 10000 });
      return { cancel: () => { if (typeof g.cancelIdleCallback === 'function') g.cancelIdleCallback(id); } };
    }
    const setT = this._setTimeoutFn || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    const clearT = this._clearTimeoutFn || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
    if (!setT) return { cancel: () => {} };
    const id = setT(cb, 1000);
    return { cancel: () => { if (clearT) clearT(id); } };
  }

  async _writeBootReceipt(startedAt, profile) {
    try {
      const vault = this.app && this.app.vault;
      const adapter = vault && vault.adapter;
      if (!adapter || typeof adapter.write !== 'function') return;
      const receipt = {
        schema_version: 1,
        generated_by: 'sauce-plugin',
        boot_started_at: startedAt,
        written_at: new Date().toISOString(),
        total_ms: profile.total_ms,
        stages: profile.stages,
      };
      await adapter.write(BOOT_RECEIPT_PATH, JSON.stringify(receipt, null, 2));
    } catch (e) {
      // Profiling is best-effort — a failed receipt never disturbs the plugin.
      console.warn('[sauce] boot-profile receipt write failed (classes unaffected): ' + (e && e.message));
    }
  }

  // ---------- Render reconciler ----------
  // Escape Dataview's 2.5s refresh debounce for BACKGROUND changes: on a vault
  // change to a file OTHER than the one being actively edited, fire Dataview's
  // OWN scoped force-refresh (debounced) so hubs/dashboards reflect the change in
  // ~500ms instead of ~2.5s. Safe-by-construction: Dataview stays the renderer AND
  // its own 2.5s refresh stays enabled as the backstop (this only makes it happen
  // sooner); the active-edit file is skipped so typing never triggers a refresh of
  // the note you're in. Never throws; no-op if the force-refresh command is absent.

  // Pure: reconcile only for a real change to a file that ISN'T the active one.
  static shouldReconcile(changedPath, activePath) {
    return !!changedPath && changedPath !== activePath;
  }

  _installReconciler() {
    const app = this.app;
    if (!app || typeof this.registerEvent !== 'function') return;
    const onChanged = (file) => this._onVaultChange(file && file.path);
    if (app.metadataCache && typeof app.metadataCache.on === 'function') {
      this.registerEvent(app.metadataCache.on('changed', onChanged));
    }
    if (app.vault && typeof app.vault.on === 'function') {
      this.registerEvent(app.vault.on('rename', onChanged));
      this.registerEvent(app.vault.on('delete', onChanged));
    }
  }

  _onVaultChange(changedPath) {
    try {
      const ws = this.app && this.app.workspace;
      const active = ws && typeof ws.getActiveFile === 'function' ? ws.getActiveFile() : null;
      if (!SaucePlugin.shouldReconcile(changedPath, active && active.path)) return;
      this._scheduleReconcile();
    } catch (_e) { /* never throw */ }
  }

  _scheduleReconcile() {
    try {
      const setT = this._setTimeoutFn || (typeof setTimeout !== 'undefined' ? setTimeout : null);
      const clearT = this._clearTimeoutFn || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);
      if (!setT) return;
      if (this._reconcileTimer != null && clearT) clearT(this._reconcileTimer);
      this._reconcileTimer = setT(() => { this._reconcileTimer = null; this._fireReconcile(); }, this._reconcileDelayMs || 500);
    } catch (_e) { /* never throw */ }
  }

  _fireReconcile() {
    try {
      const cmds = this.app && this.app.commands;
      if (cmds && typeof cmds.executeCommandById === 'function') {
        cmds.executeCommandById('dataview:dataview-force-refresh-views');
      }
    } catch (_e) { /* never throw */ }
  }
}

module.exports = SaucePlugin;
// Test seam: expose the pure loader helpers when loaded as a CommonJS module in
// a headless harness (Obsidian ignores these extra exports).
module.exports.loadCustomJsClasses = loadCustomJsClasses;
module.exports.registerAll = registerAll;
module.exports.isClassFile = isClassFile;
module.exports.resolveScriptsFolder = resolveScriptsFolder;
module.exports.shouldReconcile = SaucePlugin.shouldReconcile;
module.exports.BOOT_RECEIPT_PATH = BOOT_RECEIPT_PATH;
