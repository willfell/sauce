// render-safe.js — render-safe mechanism v0.1.0.
//
// Cold-load safety for Dataview render context. On cold vault load Dataview can
// render a dataviewjs block before it has indexed the embedding file, so
// dv.current() returns undefined and a bare `dv.current().file.path` deref throws
// the "Cannot read properties of undefined" flash (landmines #1-#2 + the v0.119/
// v0.132/v0.133 point-fixes). RenderSafe is the single home for the fallback:
// helpers call customJS.RenderSafe.page(dv) (window.customJS is already loaded in
// a helper body, since the customjs-guard view resolved the class first).
//
// Templates / dataviewjs-block args CANNOT use this class (customJS may be in the
// TDZ pre-guard) — they use `dv.current()?.x || app.workspace.getActiveFile()?.x`
// optional chaining instead. See Docs/agent-guides/code-conventions.md.
class RenderSafe {
  // Returns the live Dataview page when indexed, else a shim built from the
  // active file (path/name + cached frontmatter), else null. Never throws.
  static page(dv) {
    try {
      const cur = dv && typeof dv.current === 'function' ? dv.current() : null;
      if (cur && cur.file) return cur;
    } catch (_e) { /* fall through to active-file shim */ }
    try {
      const f = (typeof app !== 'undefined' && app.workspace && app.workspace.getActiveFile)
        ? app.workspace.getActiveFile() : null;
      if (!f) return null;
      const fm = (app.metadataCache && app.metadataCache.getFileCache)
        ? (app.metadataCache.getFileCache(f) || {}).frontmatter : null;
      return Object.assign({ file: { path: f.path, name: f.basename } }, fm || {});
    } catch (_e) { return null; }
  }

  static filePath(dv) { const p = RenderSafe.page(dv); return (p && p.file && p.file.path) || null; }
  static fileName(dv) { const p = RenderSafe.page(dv); return (p && p.file && p.file.name) || null; }
}
