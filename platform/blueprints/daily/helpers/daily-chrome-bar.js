/**
 * DailyChromeBar (CustomJS) — the daily blueprint's ChromeBar adapter config.
 *
 * Renders the shared Go ▾ / ⋯ bar on Daily notes via
 * customJS.ChromeBar.makeAdapter(this._config()), replacing SpaceNavButtons.
 * The bar's left slot renders smart day-nav (nearest earlier/later daily note,
 * greyed out + inert at either end of the run) via adapter.dayNav instead of
 * a breadcrumb — Daily notes have no ancestor trail. No primary/overflow
 * actions: task/meeting/sticky-note capture stays Home's job (explicit user
 * decision, 2026-07-11 brainstorm).
 */
class DailyChromeBar {
  /**
   * Pure day-nav resolver. `currentDateStr` is the current daily note's
   * YYYY-MM-DD date; `allDateStrs` is every OTHER daily note's date string
   * found in the daily folder (duplicates/invalid entries are tolerated —
   * filtered here). Returns { prevLabel, prevPath, nextLabel, nextPath } —
   * `*Path` here is actually just the nearest date string itself (the real
   * FILE path is resolved by the live `_dayNav` closure below, which maps
   * date -> real file path via a live vault listing); this static only
   * computes WHICH date is nearest, so it's testable without any Obsidian
   * global. Never throws — malformed input returns all-null fields.
   * `currentLabel` is the current day formatted the same way (e.g. "Jul 10")
   * so the bar can render prev / CURRENT / next instead of just two dates
   * connected by an arrow with no indication of which day is "today".
   */
  static resolveDayNav(currentDateStr, allDateStrs) {
    const cur = window.moment(currentDateStr, "YYYY-MM-DD", true);
    if (!cur || !cur.isValid || !cur.isValid()) {
      return { prevLabel: null, prevPath: null, currentLabel: null, nextLabel: null, nextPath: null };
    }
    const parsed = (Array.isArray(allDateStrs) ? allDateStrs : [])
      .map((s) => window.moment(s, "YYYY-MM-DD", true))
      .filter((m) => m && m.isValid && m.isValid());
    const earlier = parsed.filter((m) => m.isBefore(cur, "day")).sort((a, b) => a.diff(b)).pop();
    const later = parsed.filter((m) => m.isAfter(cur, "day")).sort((a, b) => a.diff(b))[0];
    return {
      prevLabel: earlier ? earlier.format("ddd, MMM D") : null,
      prevPath: earlier ? earlier.format("YYYY-MM-DD") : null,
      currentLabel: cur.format("MMM D"),
      nextLabel: later ? later.format("ddd, MMM D") : null,
      nextPath: later ? later.format("YYYY-MM-DD") : null,
    };
  }

  render(dv) {
    try {
      if (!customJS || !customJS.ChromeBar || typeof customJS.ChromeBar.makeAdapter !== "function"
        || typeof customJS.ChromeBar.render !== "function") return;
      return customJS.ChromeBar.render(dv, customJS.ChromeBar.makeAdapter(this._config()));
    } catch (_e) { /* never throw */ }
  }

  _config() {
    return {
      detect: (dv, page) => {
        if (!page || page.type !== "cowork-daily") return null;
        const p = (page.file && page.file.path) || "";
        return { path: p };
      },
      surfaceSpec: () => ({ primary: null, overflow: [] }),
      dispatch: () => {},
      destinations: () => ([]),
      dayNav: (dv) => this._dayNav(dv),
      rootClass: "daily-chrome-root",
      btnClass: (v) => `daily-chrome-btn daily-chrome-btn-${v}`,
    };
  }

  // Live day-nav lookup: resolves the CURRENT daily note's date from dv.current(),
  // reads .obsidian/daily-notes.json for the daily folder, lists every daily
  // note's date via app.vault.getMarkdownFiles(), asks resolveDayNav which
  // date is nearest on each side, then maps those winning dates back to real
  // file paths. Never throws — any failure returns null (bar's dayNav branch
  // treats a null return as "render nothing for the left slot").
  async _dayNav(dv) {
    try {
      const cur = dv && dv.current ? dv.current() : null;
      const curPath = (cur && cur.file && cur.file.path) || "";
      const m = curPath.match(/(\d{4}-\d{2}-\d{2})/);
      if (!m) return null;
      const currentDateStr = m[1];
      let cfg = null;
      try {
        const raw = await app.vault.adapter.read(".obsidian/daily-notes.json");
        cfg = JSON.parse(raw);
      } catch (_e) { cfg = null; }
      if (!cfg || typeof cfg.folder !== "string" || !cfg.folder) return null;
      const filesByDate = {};
      for (const f of app.vault.getMarkdownFiles()) {
        if (!f.path.startsWith(cfg.folder + "/")) continue;
        const fm = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        if (fm) filesByDate[fm[1]] = f.path;
      }
      const nav = DailyChromeBar.resolveDayNav(currentDateStr, Object.keys(filesByDate));
      return {
        prevLabel: nav.prevLabel,
        prevPath: nav.prevPath ? (filesByDate[nav.prevPath] || null) : null,
        currentLabel: nav.currentLabel,
        nextLabel: nav.nextLabel,
        nextPath: nav.nextPath ? (filesByDate[nav.nextPath] || null) : null,
      };
    } catch (_e) { return null; }
  }
}
