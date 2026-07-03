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

// Walk the customJS scripts folder, read every .js, and register the class-files
// onto window.customJS. Exported for headless testing.
async function loadCustomJsClasses(app) {
  const adapter = app.vault.adapter;
  const files = [];
  const walk = async (dir) => {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return; }
    for (const f of (listing.files || [])) {
      if (f.endsWith('.js')) {
        try { files.push({ path: f, body: await adapter.read(f) }); } catch (_e) { /* skip unreadable */ }
      }
    }
    for (const d of (listing.folders || [])) await walk(d);
  };
  await walk(await resolveScriptsFolder(app));
  const w = (typeof window !== 'undefined') ? window : globalThis;
  w.customJS = w.customJS || {};
  return registerAll(w.customJS, files);
}

class SaucePlugin extends Plugin {
  async onload() {
    try {
      const res = await loadCustomJsClasses(this.app);
      console.log('[sauce] registered ' + res.registered.length + ' customJS class(es)'
        + (res.failures.length ? ' (' + res.failures.length + ' non-class/failed skipped)' : ''));
    } catch (e) {
      // Never throw out of onload — CustomJS fallback still populates window.customJS.
      console.error('[sauce] onload class-load failed (CustomJS fallback applies): ' + (e && e.message));
    }
    // Faster reconciliation of Dataview views on background vault changes (below).
    try { this._installReconciler(); } catch (e) { console.error('[sauce] reconciler install failed: ' + (e && e.message)); }
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
