/**
 * activity-feed@0.1.1 — universal cross-blueprint activity feed renderer (FA-9a).
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. `customJS.BeaconCards` is read at call-time, never at class-load.
 *
 * Public API:
 *   render(dv, opts) → void | Promise<void>
 *
 * opts:
 *   scope:               "today" | "week" | "month" (default "today")
 *   blueprints:          string[] of canonical `type:` values to include
 *                        (default: ALL entity-shape + timeline-shape types)
 *   groupBy:             "blueprint" | "hour" | "none" (default "blueprint")
 *   limit:               number (default 50)
 *   useStatusChangedAt:  boolean (default false) — when true, time-window
 *                        comparison uses `status_changed_at` instead of
 *                        `created_at` (FA-9a "Today's project status changes"
 *                        section).
 *   asOf:                string|moment (default: now())
 *                        Anchors the time window to this date. When set,
 *                        time-window resolution computes start/end around
 *                        this anchor instead of window.moment(). Accepts
 *                        any value window.moment() accepts (ISO string,
 *                        "YYYY-MM-DD", moment object).
 *
 *   includeMtime:        boolean (default false) — when true, a page matches
 *                        if EITHER its tsKey timestamp OR its file.mtime
 *                        falls in the window. Catches "edited today but
 *                        created earlier" notes.
 *
 *   getTitle:            function(p) → string (optional) — override the
 *                        default card title (`p.file.name`). Use to surface
 *                        frontmatter `title:` / `aliases[0]` / first heading
 *                        for prettier display when the filename is opaque
 *                        (e.g. timestamp-based scratch filenames). Added v0.1.2.
 *
 *   collapsible:         boolean (default false) — when true and groupBy is
 *                        "blueprint", wrap each group in a `<details>` /
 *                        `<summary>` block (closed by default; the summary
 *                        line shows blueprint name + count). Added v0.1.2.
 *
 *   colorByType:         object (optional) — `{ [type]: cssColor }` map.
 *                        When collapsible is true, each group's `<details>`
 *                        wrapper gets `border-left: 4px solid <color>`.
 *                        Unknown types fall back to var(--color-base-50).
 *                        Added v0.1.2.
 *
 *   title:               string (optional) — emits an H3 above the panel
 *
 * Per landmine #11: spice/ module-directory namespace is conceptual;
 * Dataview query scope is vault-wide.
 */
class ActivityFeed {
  /**
   * Render a time-windowed activity feed across blueprints.
   * @param {object} dv  — Dataview API in dataviewjs scope
   * @param {object} opts
   */
  render(dv, opts) {
    const safeOpts = opts || {};
    const scope = (safeOpts.scope === "week" || safeOpts.scope === "month")
      ? safeOpts.scope
      : "today";
    const groupBy = (safeOpts.groupBy === "hour" || safeOpts.groupBy === "none")
      ? safeOpts.groupBy
      : "blueprint";
    const limit = typeof safeOpts.limit === "number" && safeOpts.limit > 0
      ? safeOpts.limit
      : 50;
    const useStatusChangedAt = safeOpts.useStatusChangedAt === true;
    const asOf = safeOpts.asOf;
    const includeMtime = safeOpts.includeMtime === true;
    // v0.1.2 additive opts
    const getTitle = typeof safeOpts.getTitle === "function" ? safeOpts.getTitle : null;
    const collapsible = safeOpts.collapsible === true;
    const colorByType = (safeOpts.colorByType && typeof safeOpts.colorByType === "object") ? safeOpts.colorByType : null;
    const blueprints = Array.isArray(safeOpts.blueprints) && safeOpts.blueprints.length > 0
      ? safeOpts.blueprints.map(String)
      : this._DEFAULT_BLUEPRINTS;

    if (typeof safeOpts.title === "string" && safeOpts.title.length > 0) {
      const h = dv.container.createEl("h3");
      h.textContent = safeOpts.title;
      h.style.cssText = "margin: 0.4em 0;";
    }

    let timeWindow;
    try {
      timeWindow = this._resolveTimeWindow(scope, asOf);
    } catch (e) {
      new Notice("ActivityFeed: time-window resolve failed — " + (e && e.message ? e.message : String(e)));
      return;
    }
    if (!timeWindow) {
      new Notice("ActivityFeed: unable to resolve time window for scope " + JSON.stringify(scope));
      return;
    }

    let pages;
    try {
      pages = this._query(dv, blueprints, timeWindow, useStatusChangedAt, includeMtime, limit);
    } catch (e) {
      new Notice("ActivityFeed: query failed — " + (e && e.message ? e.message : String(e)));
      return;
    }

    if (!pages || pages.length === 0) {
      this._renderEmpty(dv, scope);
      return;
    }

    if (groupBy === "hour") {
      return this._renderGroupedByHour(dv, pages, useStatusChangedAt, getTitle);
    }
    if (groupBy === "blueprint") {
      return this._renderGroupedByBlueprint(dv, pages, { getTitle, collapsible, colorByType });
    }
    return this._renderFlat(dv, pages, getTitle);
  }

  // ── Time window ────────────────────────────────────────────────────────────

  /**
   * Resolve {startIso, endIso} for the requested scope using window.moment.
   * Falls back to native Date when moment is unavailable.
   * @param {string} scope
   * @param {string|object} [asOf] — optional anchor; defaults to "now".
   * @returns {{startIso: string, endIso: string} | null}
   */
  _resolveTimeWindow(scope, asOf) {
    const useMoment = typeof window !== "undefined" && window.moment;
    if (useMoment) {
      const now = asOf ? window.moment(asOf) : window.moment();
      if (scope === "today") {
        return { startIso: now.clone().startOf("day").format(), endIso: now.clone().endOf("day").format() };
      }
      if (scope === "week") {
        return { startIso: now.clone().startOf("isoWeek").format(), endIso: now.clone().endOf("isoWeek").format() };
      }
      if (scope === "month") {
        return { startIso: now.clone().startOf("month").format(), endIso: now.clone().endOf("month").format() };
      }
      return null;
    }
    // Native fallback — coarser, no isoWeek support.
    const now = asOf ? new Date(asOf) : new Date();
    if (scope === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }
    if (scope === "week") {
      // ISO week starts Monday. Native Date getDay() returns 0=Sunday..6=Saturday.
      const dow = now.getDay();
      const offsetToMon = dow === 0 ? -6 : 1 - dow;
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToMon, 0, 0, 0);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }
    if (scope === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      return { startIso: start.toISOString(), endIso: end.toISOString() };
    }
    return null;
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Filter pages by blueprint type + time window. Sort by created_at desc.
   * @param {object} dv
   * @param {string[]} blueprints
   * @param {{startIso, endIso}} timeWindow
   * @param {boolean} useStatusChangedAt
   * @param {boolean} includeMtime — when true, OR file.mtime into the predicate.
   * @param {number} limit
   * @returns {Array}
   */
  _query(dv, blueprints, timeWindow, useStatusChangedAt, includeMtime, limit) {
    const start = timeWindow.startIso;
    const end = timeWindow.endIso;
    const tsKey = useStatusChangedAt ? "status_changed_at" : "created_at";

    const chain = dv.pages()
      .where((p) => {
        if (!p) return false;
        if (blueprints.indexOf(String(p.type)) < 0) return false;
        // ts-window predicate (created_at: or status_changed_at:)
        const tsRaw = p[tsKey];
        let tsHit = false;
        if (tsRaw) {
          const ts = String(tsRaw);
          if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
            tsHit = ts >= start.slice(0, 10) && ts <= end.slice(0, 10);
          } else {
            tsHit = ts >= start && ts <= end;
          }
        }
        if (tsHit) return true;
        // mtime predicate (file.mtime), opt-in via includeMtime
        if (!includeMtime) return false;
        if (!p.file || !p.file.mtime) return false;
        const mIso = (typeof p.file.mtime.toISO === "function")
          ? p.file.mtime.toISO()
          : String(p.file.mtime);
        return mIso >= start && mIso <= end;
      })
      .sort((p) => {
        const v = p && p[tsKey];
        return v ? String(v) : "";
      }, "desc")
      .slice(0, limit);

    return Array.isArray(chain)
      ? chain
      : (chain && typeof chain.length === "number" ? Array.from(chain) : []);
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  _renderEmpty(dv, scope) {
    const p = dv.container.createEl("p");
    p.style.cssText = "color: var(--text-muted); font-style: italic; margin: 0.5em 0;";
    p.textContent = "No activity in this " + scope + ".";
  }

  _renderFlat(dv, pages, getTitle) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("ActivityFeed: cards mechanism (BeaconCards) unavailable");
      return;
    }
    const titleFn = (typeof getTitle === "function")
      ? getTitle
      : (p) => p && p.file && p.file.name;
    return customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: titleFn,
      meta: (p) => (p && p.type) ? String(p.type) : "",
    });
  }

  _renderGroupedByBlueprint(dv, pages, opts) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("ActivityFeed: cards mechanism (BeaconCards) unavailable");
      return;
    }
    const safe = opts || {};
    const titleFn = (typeof safe.getTitle === "function")
      ? safe.getTitle
      : (p) => p && p.file && p.file.name;
    const collapsible = safe.collapsible === true;
    const colorByType = (safe.colorByType && typeof safe.colorByType === "object") ? safe.colorByType : null;

    const groups = new Map();
    for (const p of pages) {
      const t = (p && p.type) ? String(p.type) : "(untyped)";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(p);
    }
    const sortedKeys = Array.from(groups.keys()).sort();
    for (const t of sortedKeys) {
      if (collapsible) {
        const details = dv.container.createEl("details");
        details.open = false;
        const color = (colorByType && colorByType[t]) ? colorByType[t] : "var(--color-base-50)";
        details.style.cssText = "margin: 0.4em 0; padding: 0.3em 0.5em; border-left: 4px solid " + color + "; background: var(--background-secondary); border-radius: 4px;";
        const summary = details.createEl("summary");
        summary.style.cssText = "cursor: pointer; font-weight: 600; font-size: 0.9em; color: var(--text-normal); user-select: none;";
        summary.textContent = t + " (" + groups.get(t).length + ")";
        const cardsShim = { container: details };
        customJS.BeaconCards.render(cardsShim, {
          pages: groups.get(t),
          layout: "row",
          title: titleFn,
        });
      } else {
        const h = dv.container.createEl("h4");
        h.textContent = t;
        h.style.cssText = "margin: 0.8em 0 0.3em 0;";
        customJS.BeaconCards.render(dv, {
          pages: groups.get(t),
          layout: "row",
          title: titleFn,
        });
      }
    }
  }

  _renderGroupedByHour(dv, pages, useStatusChangedAt, getTitle) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("ActivityFeed: cards mechanism (BeaconCards) unavailable");
      return;
    }
    const titleFn = (typeof getTitle === "function")
      ? getTitle
      : (p) => p && p.file && p.file.name;
    const tsKey = useStatusChangedAt ? "status_changed_at" : "created_at";
    const groups = new Map();
    for (const p of pages) {
      const ts = (p && p[tsKey]) ? String(p[tsKey]) : "";
      // Pull HH:00 bucket from ISO-8601 (T position 10..13 = "THH:"). Fall back to "(no time)".
      let bucket = "(no time)";
      const tPos = ts.indexOf("T");
      if (tPos >= 0 && ts.length >= tPos + 3) {
        bucket = ts.slice(tPos + 1, tPos + 3) + ":00";
      }
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push(p);
    }
    // Sort buckets descending (most recent hour first). "(no time)" last.
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === "(no time)") return 1;
      if (b === "(no time)") return -1;
      return b.localeCompare(a);
    });
    for (const k of sortedKeys) {
      const h = dv.container.createEl("h4");
      h.textContent = k;
      h.style.cssText = "margin: 0.8em 0 0.3em 0;";
      customJS.BeaconCards.render(dv, {
        pages: groups.get(k),
        layout: "row",
        title: titleFn,
        meta: (p) => (p && p.type) ? String(p.type) : "",
      });
    }
  }

  // ── Constants ──────────────────────────────────────────────────────────────

  get _DEFAULT_BLUEPRINTS() {
    return [
      "daily",
      "meeting",
      "scratch",
      "scratch-day",
      "cowork-daily",
      "cowork-weekly",
      "cowork-monthly",
      "to-do",
      "journal",
      "project",
      "person",
      "team",
      "product",
      "trip",
      "budget",
      "paycheck",
      "invoice",
      // v0.2.0 (v0.65.0 cowork-scheduling-cycle): 6 cowork run-note types
      "cowork-morning-briefing",
      "cowork-midday-tripwire",
      "cowork-eod-review",
      "cowork-finance-snapshot",
      "cowork-weekly-review",
      "cowork-monthly-review",
    ];
  }
}
