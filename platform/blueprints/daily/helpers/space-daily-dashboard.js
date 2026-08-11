/**
 * Daily Dashboard (CustomJS)
 * Panel-host wrapper: tasks panel as compact bullet list (clickable to parent
 * file); meetings panel as BeaconCards.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "SpaceDailyDashboard" });
 *
 * v0.2.0 (cards-cohesion cycle): meetings panel migrated to BeaconCards via
 * thin {container: subContainerEl} dv shim; tasks panel kept as flat <ul>
 * (audit-predicted regression on cards-for-tasks confirmed by user smoke).
 * Tasks render ABOVE meetings. Both-empty short-circuit + per-section SVG
 * headers + double-execution guard preserved.
 *
 * v0.2.1 (S3.4.1 inline-CF): tasks panel reverted from BeaconCards to bullet
 * <ul> per user feedback — at-a-glance compact list is the right primitive
 * for tasks; cards bloat the visual.
 *
 * v0.2.6 (v0.31.0 S6.6 — daily dashboard polish):
 * - Meeting filter: file.name.startsWith(today) → file.name.includes(today).
 *   Picks up both leading-date "2026-05-12 Foo.md" and trailing-date
 *   "Foo-2026-05-12.md" naming conventions (accuris uses the latter).
 * - Dashboard container: added box-sizing: border-box + width: 100% +
 *   max-width: 100% + overflow-x: hidden. Prevents horizontal scroll when
 *   the parent column is narrow (padding no longer adds to width).
 * - Task <li>: added word-break: break-word + overflow-wrap: anywhere so
 *   long URL-y / no-space task strings wrap instead of forcing a scrollbar.
 *
 * v0.3.3 (v0.64.3) PATCH:
 *  - BUGFIX `_resolveTitle` was crashing with `aliases.values is not a
 *    function` when sticky note / meeting notes had no `aliases:` frontmatter.
 *    Dataview's `p.file.aliases` is a Proxy/DataArray where `.values` is
 *    a non-callable property (not Array.prototype.values). The throw
 *    aborted BeaconCards mid-render, leaving the activity-panel cards
 *    visually empty. Wrapped resolver in try-catch + simplified aliases
 *    probe to length-only.
 *  - Allowlist drops `meeting` — already has its own dedicated top-level
 *    "Today's Meetings" panel; duplicate inside Activity was noise.
 *
 * v0.3.2 (v0.64.2) PATCH:
 *  - Activity panel allowlist drops `sticky-day` + `to-do` — both are
 *    per-day auto-created notes that flood the activity stream with
 *    predictable daily noise (one new entry every morning each).
 *  - Smart title resolver `_resolveTitle(p)` — tries `title:` frontmatter,
 *    then `aliases[0]`, then first heading in `file.outline`, then falls
 *    back to filename. Surfaces user-meaningful titles for timestamp-named
 *    sticky notes once the user adds `title:` or `aliases:`.
 *  - Visual polish: each of the 3 main sections (Tasks / Meetings /
 *    Activity) wrapped in `<details>` with a colored left border
 *    (cyan / blue / purple); default open. Activity sub-groups (one per
 *    blueprint type) wrapped in `<details>` via ActivityFeed's new
 *    `collapsible: true` + `colorByType` opts; default closed; summary line
 *    shows blueprint name + count + colored stripe.
 *
 * v0.3.1 (v0.64.1) PATCH:
 *  - BUGFIX: activityShim now delegates `.pages` to the real dv (was a thin
 *    {container} shim, which broke ActivityFeed._query's `dv.pages()` call
 *    with "dv.pages is not a function" — Activity panel never rendered).
 *  - Tasks panel: render markdown links `[text](url)` + wikilinks `[[target]]`
 *    as clickable HTML anchors via new `_renderTaskHTML(text)` helper. LI
 *    click still opens the parent daily note for clicks outside any anchor;
 *    wikilink anchors wire onclick → app.workspace.openLinkText.
 *
 * v0.7.0 (v0.66.0): Activity Dashboard Cohesion cycle.
 *  - Sections (Tasks/Meetings/Activity) render via _renderSection helper +
 *    the sauce-daily-dashboard.css snippet (chevron-right SVG rotates 90°
 *    on [open]; native browser triangle hidden via list-style + ::marker
 *    + ::-webkit-details-marker selectors).
 *  - Activity panel uses ActivityFeed's new v0.3.0 opts:
 *    - rollUpRoots: project + trip child edits coalesce into one hub card
 *      (closes FLN-v64-8 — "edits within projects don't surface").
 *    - metaBuilder: each card gets time · type pill · breadcrumb meta
 *      line via _renderActivityMeta (depends on cards@0.2.6 meta-function
 *      form).
 *  - Mobile pass: CSS @media (max-width: 480px) shrinks paddings + meta
 *    gap; BeaconCards isMobile column-stacking unchanged.
 *  - Section inline styles removed; sauce-section / sauce-section-summary
 *    / sauce-section-chevron classes carry all visual treatment.
 *
 * v0.3.0 (v0.64.0): third Activity panel below meetings. Delegates to
 * customJS.ActivityFeed.render(...) with { scope: "today", asOf:
 * <day-from-filename>, includeMtime: true, groupBy: "blueprint" }. Excludes
 * daily/cowork-daily/cowork-weekly/cowork-monthly types from the scan so
 * the daily note doesn't self-reference. hasContent gate widened to
 * include activityCount. Tasks + meetings panels unchanged.
 *
 * v0.13.0 (sauce v0.73.0): Part A — syncAllBoards moved out of render to
 *  KanbanStatusSyncInit customjs startup-script. Dashboard reads pre-synced
 *  frontmatter, never triggers the sync inline. Manual cache-bypass available
 *  via Cmd+P → "Sauce: Re-sync kanban boards".
 *  Part B — _renderSection reads/writes ranch/cache/dashboard-section-state.json
 *  so user-toggled <details> open/closed state survives Dataview re-renders.
 *  Namespaced keys: sauce-daily-dashboard:tasks / :meetings / :activity.
 *
 * v0.9.0 (sauce v0.68.0): board activity in the daily Activity panel.
 *  - Allowlist gains "kanban" + "board-card" — the boards blueprint's two
 *    surfaced types (single hub at spice/boards/To-Do-Board.md + per-card
 *    files under spice/boards/cards/YYYY/MM-MMMM/<title>.md).
 *  - Blueprint color map gains kanban -> var(--color-pink). board-card has
 *    no entry because it always rolls up.
 *  - Rollup rules gain a third entry that funnels any page under
 *    spice/boards/cards/ into the hardcoded root path
 *    spice/boards/To-Do-Board.md. Single-board case — the root path is a
 *    constant lookup, unlike the project/trip rules which derive the slug
 *    from the child file path.
 *  - Existing activity-count dedup logic (drop direct hits whose path is in
 *    rolledRootPaths, then add synthetic rollup roots) keeps the surface at
 *    one card per board even when both the hub mtime AND card creations match
 *    today. Title resolves via the kanban hub's `title: To Do Board`
 *    frontmatter (existing resolver `title:` branch). Drill-in row click
 *    handler opens individual card files unchanged.
 */
class SpaceDailyDashboard {
  static get _TASK_SORT_STORAGE_KEY() {
    return "sauce-daily-dashboard:task-sort-mode";
  }

  /**
   * Daily task sort policy. These comparators intentionally return zero for
   * equal values; sortTasks decorates with the source index so ties stay stable
   * even in hosts whose Array#sort stability differs.
   */
  static compareTasksByDue(a, b) {
    const due = (task) => String(task && task.due != null ? task.due : "").trim();
    const ad = due(a);
    const bd = due(b);
    if (ad === bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : 1;
  }

  static compareTasksByPriority(a, b) {
    const ranks = { highest: 4, high: 3, medium: 2, low: 1 };
    const rank = (task) => ranks[String(task && task.priority || "").trim().toLowerCase()] || 0;
    const byPriority = rank(b) - rank(a);
    return byPriority || SpaceDailyDashboard.compareTasksByDue(a, b);
  }

  static normalizeTaskSortMode(value) {
    return String(value == null ? "" : value).trim().toLowerCase() === "priority"
      ? "priority"
      : "due";
  }

  static sortTasks(tasks, mode) {
    const comparator = SpaceDailyDashboard.normalizeTaskSortMode(mode) === "priority"
      ? SpaceDailyDashboard.compareTasksByPriority
      : SpaceDailyDashboard.compareTasksByDue;
    const source = Array.isArray(tasks) ? tasks : [];
    return source
      .map((task, index) => ({ task, index }))
      .sort((a, b) => comparator(a.task, b.task) || a.index - b.index)
      .map((entry) => entry.task);
  }

  static readTaskSortMode(storage) {
    try {
      if (!storage || typeof storage.getItem !== "function") return "due";
      return SpaceDailyDashboard.normalizeTaskSortMode(
        storage.getItem(SpaceDailyDashboard._TASK_SORT_STORAGE_KEY)
      );
    } catch (_e) {
      return "due";
    }
  }

  static writeTaskSortMode(storage, mode) {
    const normalized = SpaceDailyDashboard.normalizeTaskSortMode(mode);
    try {
      if (storage && typeof storage.setItem === "function") {
        storage.setItem(SpaceDailyDashboard._TASK_SORT_STORAGE_KEY, normalized);
      }
    } catch (_e) { /* client-only preference persistence is best-effort */ }
    return normalized;
  }

  static taskSortStorage() {
    try {
      return (typeof window !== "undefined" && window) ? window.localStorage : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Note-per-task migration: SELECT the task-notes for the dashboard's at-a-glance
   * task panel. Pure + Node-testable (dv-stub + a real TaskEntity ref) — the
   * render() `getTasks` closure is just the adapter passing the live dv +
   * customJS.TaskEntity. Returns { open, overdue, done }:
   *   open    — parsed task objects (TaskEntity.parseNote) for tasks made for TODAY
   *             (scheduled == today). This is the ONLY set the panel LISTS — the
   *             tasks on today's plate. Partitioned by TaskEntity.queryToday, which
   *             is SOURCE-AGNOSTIC (scheduled==today | scheduled<today; future +
   *             unscheduled excluded). We use queryToday, NOT TaskTodayList.buildBands,
   *             because buildBands drops project_slug/source==meeting tasks (they
   *             render in the TO-DO note's own sections) — the dashboard mirror wants
   *             ALL sources.
   *   overdue — open task-notes scheduled BEFORE today (all sources), as a LIST
   *             (same shape as `open`). Rendered as a visually-distinguished tail
   *             after the open tasks, so the red "N Overdue" pill has matching rows.
   *   done    — count of _done/ task-notes whose completed_at DATE == today (done-TODAY
   *             only; all-done would grow unbounded with vault history).
   * Filtering is done in plain JS AFTER dv.pages() (not via DataArray .where) so a
   * plain-array dv-stub exercises the real path. No TE (cold load / mechanism not
   * registered) → { open: [], overdue: [], done: 0 }; the panel simply hides. Never throws.
   */
  static selectTasks(dv, todayStr, TE) {
    if (!TE || typeof TE.parseNote !== "function" || typeof TE.queryToday !== "function") {
      return { open: [], done: 0, overdue: [] };
    }
    const toArr = (q) => {
      try {
        const r = dv.pages(q);
        if (!r) return [];
        if (typeof r.array === "function") return r.array();
        return Array.from(r);
      } catch (_e) { return []; }
    };

    // Open task-notes — all sources, excluding the _done/ + _trash/ archives.
    const openParsed = [];
    for (const p of toArr('"spice/tasks"')) {
      if (!p || p.type !== "task" || p.status !== "open") continue;
      const path = p.file && p.file.path;
      if (!path || path.includes("/_trash/") || path.includes("/_done/")) continue;
      openParsed.push(TE.parseNote(p));
    }
    // LIST = today only (scheduled == today) + overdue (scheduled before today,
    // rendered as its own visually-distinguished tail so the red "N Overdue"
    // pill always has rows underneath it, not just a bare count).
    const bands = TE.queryToday(openParsed, todayStr);
    const open = Array.isArray(bands.today) ? bands.today : [];
    const overdue = Array.isArray(bands.overdue) ? bands.overdue : [];

    // Done today — _done/ notes with completed_at date == today.
    let done = 0;
    for (const p of toArr('"spice/tasks/_done"')) {
      if (!p || p.type !== "task") continue;
      const path = p.file && p.file.path;
      if (!path || path.includes("/_trash/")) continue;
      // Compare the RAW page field: parseNote does not date-coerce completed_at
      // (it blankToNulls it but keeps the raw string/Luxon), so route it through
      // _toDateStr here (handles string / datetime-with-offset / Luxon → YYYY-MM-DD).
      if (TE._toDateStr(p.completed_at) === todayStr) done++;
    }

    return { open, done, overdue };
  }

  /**
   * Home command center count API (DRY): SELECT today's meeting notes for the
   * dashboard's Meetings panel. Pure + Node-testable — the render() `getMeetings`
   * closure is now just the adapter that passes the live dv. Returns the pages
   * whose `file.name` CONTAINS today's date (covers both leading-date
   * "2026-07-02 Foo.md" and trailing-date "Foo-2026-07-02.md" conventions),
   * sorted by filename asc, as a plain array. Uses the DataArray .where/.sort/
   * .array chain when present (byte-identical to the render closure), else a
   * plain-array fallback so a plain-array dv-stub exercises the real path.
   * Empty/blank today → []; any throw (cold load / bad dv) → []. Never throws.
   */
  static selectMeetings(dv, todayStr) {
    const today = String(todayStr == null ? "" : todayStr).trim();
    if (!today) return [];
    try {
      const r = dv.pages('"spice/meetings/notes"');
      if (!r) return [];
      // Dataview DataArray path — .where(...).sort(...).array() BYTE-IDENTICAL to
      // the old render closure (a DataArray's .where returns a DataArray with
      // .sort, whose .sort returns one with .array). Guard on .where only so a
      // real DataArray (whose .sort lives on the .where RESULT, not the root)
      // takes this path; a plain Array (no .where) takes the fallback.
      if (typeof r.where === "function") {
        return r
          .where(p => p.file.name.includes(today))
          .sort(p => p.file.name, "asc")
          .array();
      }
      // Plain-array dv-stub fallback (Node harness): same filter + sort.
      const arr = Array.isArray(r) ? r.slice() : Array.from(r);
      return arr
        .filter(p => p && p.file && String(p.file.name).includes(today))
        .sort((a, b) => String(a.file.name).localeCompare(String(b.file.name)));
    } catch (_e) {
      return [];
    }
  }

  /**
   * All reader-articles currently in the "reading" state, regardless of when
   * last touched — the daily Activity panel always surfaces in-progress reading
   * (unioned into the activity page set by render). Pure + Node-testable
   * (DataArray .where().array() OR plain array). Never throws; missing folder → [].
   */
  static selectReadingArticles(dv) {
    try {
      if (!dv || typeof dv.pages !== "function") return [];
      const src = dv.pages('"spice/reader"');
      const isReading = (p) => p && p.type === "reader-article" &&
        String(p.status == null ? "" : p.status).trim().toLowerCase() === "reading";
      if (src && typeof src.where === "function") {
        const out = src.where(isReading);
        return (out && typeof out.array === "function") ? out.array() : Array.from(out || []);
      }
      const arr = Array.isArray(src) ? src : Array.from(src || []);
      return arr.filter(isReading);
    } catch (_e) { return []; }
  }

  /**
   * TASK 10: SELECT the trips atlas notes (type:"trip" under spice/trips) whose
   * start_date falls within [today, today + horizonDays] so the daily/home can
   * surface an "Upcoming trips" panel. Pure + Node-testable (dv-stub via the
   * DataArray .where(...).array() chain, byte-identical to selectMeetings).
   *
   * Returns a plain array of { name, path, daysAway } sorted ascending by
   * daysAway (soonest first). daysAway is a whole-day UTC delta — today == 0,
   * so a trip starting today is IN the window. Trips already begun (daysAway < 0)
   * and beyond the horizon (> horizonDays) are dropped.
   *
   * UTC-safe: both today and each start_date are normalized to a UTC day-millis
   * via _utcDay (tolerant of ISO "YYYY-MM-DD" string / Date / Luxon / epoch), so
   * the delta never drifts with local timezone. No trips folder / bad dv / any
   * throw → []. Never throws — a missing spice/trips (accuris, ero) renders nothing.
   */
  static selectUpcomingTrips(dv, todayStr, horizonDays = 14) {
    try {
      const todayMs = SpaceDailyDashboard._utcDay(todayStr);
      if (todayMs == null) return [];
      const r = dv.pages('"spice/trips"');
      if (!r) return [];
      // DataArray path (real Dataview + the harness chain stub): .where(...).array().
      // Plain-array fallback so any bare-array dv-stub still exercises the filter.
      let all;
      if (typeof r.where === "function") {
        all = r.array();
      } else {
        all = Array.isArray(r) ? r : Array.from(r);
      }
      const trips = all.filter(p => p && p.type === "trip");
      // Build slug → { packed, total } from packing-list trip-sections. Only
      // entries carrying a truthy `item` count toward total (placeholder /
      // category-only rows are ignored); `checked` counts toward packed.
      const slugByPacking = {};
      for (const p of all) {
        if (!p || p.type !== "trip-section" || p.section_kind !== "packing-list") continue;
        const slug = p.trip_slug;
        if (!slug) continue;
        let packed = 0, total = 0;
        const items = Array.isArray(p.packing_items) ? p.packing_items : [];
        for (const it of items) {
          if (it && it.item) {
            total += 1;
            if (it.checked) packed += 1;
          }
        }
        slugByPacking[slug] = { packed, total };
      }
      const out = [];
      for (const p of trips) {
        const startMs = SpaceDailyDashboard._utcDay(p && p.start_date);
        if (startMs == null) continue;
        const daysAway = Math.round((startMs - todayMs) / 86400000);
        if (daysAway < 0 || daysAway > horizonDays) continue;
        const path = p && p.file && p.file.path;
        // slug = the segment after "trips" in spice/trips/<slug>/...
        let slug = "";
        if (typeof path === "string") {
          const parts = path.split("/");
          const ti = parts.indexOf("trips");
          if (ti >= 0 && parts[ti + 1]) slug = parts[ti + 1];
        }
        const pack = slugByPacking[slug] || { packed: 0, total: 0 };
        out.push({
          name: (p && p.name) || (p && p.file && p.file.name) || "Trip",
          path,
          daysAway,
          slug,
          packed: pack.packed,
          packTotal: pack.total,
        });
      }
      out.sort((a, b) => a.daysAway - b.daysAway);
      return out;
    } catch (_e) {
      return [];
    }
  }

  /**
   * TASK 10: normalize a date-ish value to a UTC day-boundary millis (00:00:00Z
   * of that calendar day) or null. Tolerant of an ISO "YYYY-MM-DD" (or longer)
   * string, a JS Date, a Luxon DateTime (duck-typed via .toISODate/.toISO), and
   * an epoch number. Slicing the ISO to its first 10 chars + Date.UTC keeps the
   * result timezone-independent so daysAway deltas are stable everywhere.
   */
  static _utcDay(v) {
    try {
      if (v == null) return null;
      let iso = null;
      if (typeof v === "string") {
        iso = v;
      } else if (typeof v.toISODate === "function") {
        iso = v.toISODate();               // Luxon DateTime
      } else if (typeof v.toISO === "function") {
        iso = v.toISO();                    // Luxon DateTime (fallback)
      } else if (v instanceof Date && !isNaN(v.getTime())) {
        iso = v.toISOString();
      } else if (typeof v === "number" && isFinite(v)) {
        iso = new Date(v).toISOString();
      }
      if (typeof iso !== "string") return null;
      const m = iso.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return null;
      const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isFinite(ms) ? ms : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Home command center count API (DRY): roll up the day's counts for the glance
   * line. Composes selectTasks (→ { open[], overdue[], done }) with selectMeetings
   * (→ page[]) and returns integers only: { today, overdue, done, meetings }.
   * Cold-load safe — no TE → tasks zeroed (selectTasks returns empties) but
   * meetings are still counted. Never throws.
   */
  static computeCounts(dv, todayStr, TE) {
    const t = SpaceDailyDashboard.selectTasks(dv, todayStr, TE);
    const m = SpaceDailyDashboard.selectMeetings(dv, todayStr);
    return {
      today: Array.isArray(t.open) ? t.open.length : 0,
      overdue: Array.isArray(t.overdue) ? t.overdue.length : (t.overdue || 0),
      done: t.done || 0,
      meetings: Array.isArray(m) ? m.length : 0,
    };
  }

  /**
   * 2→1 sweep reduction: derive the segmented-accent byBlueprint map from the
   * pages ActivityFeed.query(...) returns (the SAME coalesced/rolled-up set the
   * cards render from). Buckets project-* → project and trip-* → trip so the
   * accent colors resolve consistently. This is the exact `bucket()` logic that
   * used to live inside the retired _getActivityCount; extracted to a pure
   * static so it's Node-testable and driven directly by the real query output.
   * @param {Array} pages — ActivityFeed.query(...).pages
   * @returns {Object} byBlueprint count map
   */
  static bucketByBlueprint(pages) {
    const bucket = (t) => {
      if (!t) return "(unknown)";
      const s = String(t);
      if (s === "project" || s.startsWith("project-")) return "project";
      if (s === "trip" || s.startsWith("trip-")) return "trip";
      if (s === "wiki-page" || s === "wiki-section") return "wiki";
      return s;
    };
    const byBlueprint = {};
    for (const p of (Array.isArray(pages) ? pages : [])) {
      const blueprint = bucket(p && p.type);
      byBlueprint[blueprint] = (byBlueprint[blueprint] || 0) + 1;
    }
    return byBlueprint;
  }

  async render(dv, params) {
    let mountReceipt = null;
    let mountedContainer = null;
    try {
    if (!dv || !dv.container || typeof dv.el !== "function" || typeof dv.pages !== "function") return;
    const icons = {
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      checkSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      activity: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.24 2.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4 12H2"/></svg>`,
      square: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`,
      mapPin: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`
    };

    // v0.10.6 (sauce v0.70.6): resolve the file containing THIS dataviewjs
    // block via DOM ancestry, not `dv.current()`. Obsidian Mobile has been
    // observed returning a stale `dv.current()` (the previously-focused
    // leaf's file rather than the embedding note) on rapid leaf navigation
    // and/or when deferred-loading plugins (Smart Connections etc.) reorder
    // render. Walking up from `dv.container` to find the markdown leaf that
    // actually contains us is authoritative regardless of focus state.
    const fileName = this._resolveCurrentFileName(dv);
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    // DRY seam (Home command center): a host may inject an explicit `asOf`
    // (and `live`) via params to scope this dashboard to a date OTHER than the
    // note's own filename date. When absent, `callerAsOf` is null and the
    // derivation is byte-for-byte the prior filename → moment() fallback.
    const callerAsOf = (params && typeof params.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.asOf)) ? params.asOf : null;
    const today = callerAsOf || (dateMatch ? dateMatch[1] : moment().format("YYYY-MM-DD"));

    const config = {
      meetingsPath: "spice/meetings/notes",
    };

    // v0.2.6: match meetings whose filename CONTAINS today's date (covers both
    // leading-date "2026-05-12 Foo.md" and trailing-date "Foo-2026-05-12.md"
    // conventions). Selection lives in the pure static selectMeetings (Node-tested
    // via HC-SELMTG + shared with computeCounts for the Home glance line); this
    // closure is just the dv adapter.
    const getMeetings = () => SpaceDailyDashboard.selectMeetings(dv, today);

    // Note-per-task migration: the panel LISTS open task-NOTES made for today
    // (scheduled == today, all sources) and surfaces overdue + done-today as red +
    // green COUNT pills. Data selection lives in the pure static selectTasks
    // (Node-tested via SELTASK-1); this closure is just the dv adapter that passes
    // the live customJS.TaskEntity.
    const getTasks = () => {
      const TE = (typeof customJS !== "undefined" && customJS) ? customJS.TaskEntity : null;
      return SpaceDailyDashboard.selectTasks(dv, today, TE);
    };

    const meetings = getMeetings();
    const { open: openTasks, overdue: overdueTasks, done: doneCount } = getTasks();
    const overdueCount = Array.isArray(overdueTasks) ? overdueTasks.length : 0;

    // 2→1 sweep reduction: the dashboard used to sweep the whole vault TWICE —
    // once in _getActivityCount (gate pre-count + segmented-accent byBlueprint)
    // and again inside ActivityFeed.render's own _query (the cards). Both
    // computed the same set. We now build the ActivityFeed opts ONCE and call
    // customJS.ActivityFeed.query(dv, opts) ONCE: .total drives the hasContent
    // gate + the activityCount>0 guard + the count pill; .pages is handed back
    // into the SAME ActivityFeed.render call via precomputed so render skips its
    // own sweep. (The segmented-accent byBlueprint map that _getActivityCount
    // used to return is now a pure static, bucketByBlueprint(query().pages),
    // available to the accent should it return — the current grey accent does
    // not consume it, so render behavior is unchanged.) Guarded for cold-load
    // (customJS.ActivityFeed?.query). The resulting gate-count now equals the
    // rendered card set exactly (previously the _getActivityCount
    // `day`-authoritative predicate could drift from _query's tsKeys
    // OR-semantics — the cards always used _query, so this unifies the count to
    // what actually renders). Never throws.
    const activityOpts = this._buildActivityOpts(dv, today, icons);
    let activityPages = [];
    if (customJS && customJS.ActivityFeed && typeof customJS.ActivityFeed.query === "function") {
      try {
        const q = customJS.ActivityFeed.query(dv, activityOpts);
        if (q && Array.isArray(q.pages)) activityPages = q.pages;
      } catch (_) { activityPages = []; }
    }
    // Always-show in-progress reading: union reader-articles with status:reading
    // that the today-scoped query didn't include (dedup by file.path).
    try {
      const reading = SpaceDailyDashboard.selectReadingArticles(dv);
      if (reading.length) {
        const seen = new Set(activityPages.map((p) => (p && p.file && p.file.path) || ""));
        for (const r of reading) {
          const key = (r && r.file && r.file.path) || "";
          if (key && !seen.has(key)) { activityPages.push(r); seen.add(key); }
        }
      }
    } catch (_e) { /* reading union is best-effort */ }

    const activityCount = activityPages.length;

    // TASK 10: count upcoming trips (<=14 days) so a day whose ONLY signal is an
    // approaching trip still shows the dashboard instead of the empty state.
    // Never throws (selectUpcomingTrips returns [] on any error / missing folder).
    const upcomingTripCount = SpaceDailyDashboard.selectUpcomingTrips(dv, today, 14).length;

    const hasContent = meetings.length > 0 || openTasks.length > 0 || overdueCount > 0 || doneCount > 0 || activityCount > 0 || upcomingTripCount > 0;

    // v0.13.0 (sauce v0.73.0): persisted <details> state map. Read once per
    // render so the 3 _renderSection calls don't each hit the adapter.
    const sectionState = await this._readSectionState();

    const existing = dv.container.querySelector(".space-daily-dashboard");
    if (existing) existing.remove();

    const container = dv.el("div", "", { cls: "space-daily-dashboard" });
    mountedContainer = container;
    mountReceipt = params && params.mountReceipt;
    // v0.2.6: prevent horizontal scroll at narrow widths.
    // - box-sizing: border-box → padding folds into width, not adds to it
    // - max-width: 100% → can't exceed parent width
    // - overflow-x: hidden → defensive cap if a card or task text would still overflow
    // - width: 100% → fills the dataviewjs viewport
    container.style.cssText = `
      background-color: var(--background-secondary);
      border-radius: 12px;
      padding: 20px;
      margin: 8px 0 16px 0;
      border: 1px solid var(--background-modifier-border);
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
    `;

    // v0.10.3 (sauce v0.70.3): render a polished empty-state panel when
    // the day has no tasks, meetings, or activity. Replaces the prior
    // silent early-return so the user always gets a visible signal.
    if (!hasContent) {
      const empty = container.createEl("div");
      empty.className = "sauce-empty-state";
      empty.innerHTML = `${icons.activity}<span>No activity recorded yet</span>`;
      if (mountReceipt && typeof mountReceipt === "object") {
        mountReceipt.ok = true;
        mountReceipt.node = container;
      }
      return;
    }

    if (openTasks.length > 0 || overdueCount > 0 || doneCount > 0) {
      // v0.13.3 (sauce v0.84.3): pills move out of the title text and into a
      // right-aligned sauce-section-counts container. Up to three pills, each
      // shown only when its count > 0, in a fixed left→right order:
      //   orange "N Open"    — tasks made for today (the LIST below)
      //   red    "M Overdue" — open tasks scheduled before today (also listed, as a
      //                        visually-distinguished tail after the open tasks)
      //   green  "K Done"    — tasks completed today
      // Numeric counts interpolated directly into rightHtml are XSS-safe; we control
      // every arm. The outer guard guarantees at least one pill renders.
      let tasksRightHtml = "";
      if (openTasks.length > 0) tasksRightHtml += `<span class="sauce-section-open-pill"><span class="sauce-section-pill-n">${openTasks.length}</span><span class="sauce-section-pill-label"> Open</span></span>`;
      if (overdueCount > 0)     tasksRightHtml += `<span class="sauce-section-overdue-pill"><span class="sauce-section-pill-n">${overdueCount}</span><span class="sauce-section-pill-label"> Overdue</span></span>`;
      if (doneCount > 0)        tasksRightHtml += `<span class="sauce-section-done-pill"><span class="sauce-section-pill-n">${doneCount}</span><span class="sauce-section-pill-label"> Done</span></span>`;

      const tasksBody = this._renderSection(container, {
        accent: "cyan",
        iconHtml: icons.checkSquare,
        titleHtml: '<span class="sauce-section-title-link">Tasks</span>',
        rightHtml: tasksRightHtml,
        defaultOpen: true,
        stateKey: "sauce-daily-dashboard:tasks",
        sectionState,
      });

      // v0.13.4: title click opens/creates the viewed day's To-Do note.
      // stopPropagation so it doesn't also toggle the <details> disclosure.
      const tasksTitleLink = container.querySelector(".sauce-section-title-link");
      if (tasksTitleLink) {
        tasksTitleLink.addEventListener("click", (event) => {
          event.stopPropagation();
          this._openTodayToDo(today, { dv, host: tasksBody, trigger: tasksTitleLink });
        });
      }

      // Body iterates open tasks, then overdue tasks (also open, scheduled
      // before today) in the same list style — one continuous list with overdue
      // at the bottom, each overdue row carrying its own red "Overdue" pill.
      // Done tasks stay surfaced via header count only; their notes stay in
      // spice/tasks/_done/.
      {
        const taskSortStorage = SpaceDailyDashboard.taskSortStorage();
        let taskSortMode = SpaceDailyDashboard.readTaskSortMode(taskSortStorage);

        // Client-only sort control. The preference never enters the vault:
        // localStorage is the sole persistence rail and every access is guarded.
        const sortControl = tasksBody.createEl("div");
        sortControl.className = "sauce-daily-task-sort";
        sortControl.style.cssText = "display:flex; align-items:center; gap:4px; margin:0 0 8px; font-size:0.78em;";
        sortControl.setAttribute("role", "group");
        sortControl.setAttribute("aria-label", "Sort daily tasks");

        const sortLabel = sortControl.createEl("span");
        sortLabel.textContent = "Sort";
        sortLabel.style.cssText = "margin-right:2px; color:var(--text-muted);";

        const sortButtons = {};
        const updateSortButtonState = () => {
          for (const mode of ["due", "priority"]) {
            const active = mode === taskSortMode;
            const button = sortButtons[mode];
            button.setAttribute("aria-pressed", active ? "true" : "false");
            button.style.cssText = "border:1px solid var(--background-modifier-border); border-radius:999px; padding:2px 8px; font:inherit; cursor:pointer;"
              + (active
                ? " background:var(--interactive-accent); color:var(--text-on-accent);"
                : " background:transparent; color:var(--text-muted);");
          }
        };

        const taskLists = tasksBody.createEl("div");
        taskLists.className = "sauce-daily-task-lists";

        // Deterministic inline-link renderer from the task-entity mechanism — real
        // <a> for [[wl]] / [md](url) / bare URLs (task titles can carry links). NOT
        // MarkdownRenderer (absent in the customJS eval context → raw text). Falls
        // back to plain text if TaskTodayList isn't registered yet (cold load).
        const TTL = (typeof customJS !== "undefined" && customJS) ? customJS.TaskTodayList : null;

        // Shared row renderer for both the open and overdue lists — row click
        // opens the task NOTE (read-mostly mirror; the note carries its own edit
        // affordance). Ignore clicks that land on an inner <a> so opening a title
        // link doesn't ALSO navigate to the note. `overdue` rows look identical
        // to today's rows (no left bar, no dimming) except for a small inline red
        // "Overdue" pill after the title.
        const renderTaskRow = (list, task, overdue) => {
          const li = list.createEl("li");
          if (TTL && typeof TTL.markTaskRow === "function") TTL.markTaskRow(li, task);
          li.style.cssText = "margin: 6px 0; font-size: 0.9em; cursor: pointer; word-break: break-word; overflow-wrap: anywhere; display:list-item;";

          // Keep flex off the li itself: changing a list item to display:flex
          // suppresses its bullet marker. The child owns horizontal alignment
          // while the li remains the stable click + rollback identity.
          const rowContent = li.createEl("div");
          rowContent.className = "sauce-daily-task-row-content";
          rowContent.style.cssText = "display:flex; align-items:center; gap:8px; width:100%; min-width:0;";

          const titleSpan = rowContent.createEl("span");
          titleSpan.style.cssText = "flex:1 1 auto; min-width:0;";
          const titleText = (task && task.title) || "(untitled)";
          if (TTL && typeof TTL.renderInlineLinks === "function") {
            TTL.renderInlineLinks(titleSpan, titleText, task.path);
          } else {
            titleSpan.textContent = titleText;
          }

          if (overdue) {
            const badge = rowContent.createEl("span");
            badge.textContent = "Overdue";
            badge.style.cssText = "margin-left: 8px; padding: 0 7px; border-radius: 999px; font-size: 0.72em; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; background: color-mix(in srgb, var(--color-red) 13%, transparent); color: var(--color-red); border: 1px solid color-mix(in srgb, var(--color-red) 45%, transparent);";
          }

          // TD-1a3: this dashboard owns a private row renderer, so it needs its
          // own visible action control. The mutation itself stays canonical in
          // TaskTodayList.rescheduleTomorrow. Pass the VIEWED daily-note date,
          // not wall-clock today; cold load / missing TaskDialog is a no-op.
          if (task && task.status === "open"
              && TTL && typeof TTL.rescheduleTomorrow === "function") {
            const tomorrow = rowContent.createEl("button");
            tomorrow.className = "sauce-daily-task-tomorrow";
            tomorrow.style.cssText = "display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; width:28px; height:24px; padding:0; border:none; border-radius:var(--radius-s, 4px); background:transparent; color:var(--text-faint); cursor:pointer;";
            tomorrow.setAttribute("type", "button");
            tomorrow.setAttribute("aria-label", "Move to tomorrow");
            tomorrow.setAttribute("title", "Move to tomorrow");
            tomorrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m12 14 2 2-2 2"/><path d="M9 16h5"/></svg>';
            tomorrow.addEventListener("click", async (event) => {
              try { event.stopPropagation(); } catch (_e) {}
              await TTL.rescheduleTomorrow(li, task, today);
            });
          }

          li.onclick = (e) => {
            if (e.target && (e.target.tagName === "A" || e.target.tagName === "BUTTON"
                || (e.target.closest && (e.target.closest("a") || e.target.closest("button"))))) return;
            if (task && task.path) app.workspace.openLinkText(task.path, "");
          };
        };

        const renderTaskLists = () => {
          // Clear only the row host: the control and its listeners remain singular
          // across mode changes. sortTasks always returns a fresh array, so the
          // TaskEntity/queryToday source bands are never mutated.
          taskLists.textContent = "";
          const sortedOpen = SpaceDailyDashboard.sortTasks(openTasks, taskSortMode);
          const sortedOverdue = SpaceDailyDashboard.sortTasks(overdueTasks, taskSortMode);

          if (sortedOpen.length > 0) {
            const tasksList = taskLists.createEl("ul");
            tasksList.className = "sauce-daily-task-today-list";
            tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";
            for (const task of sortedOpen) renderTaskRow(tasksList, task, false);
          }

          if (sortedOverdue.length > 0) {
            // Same list style as the open list (no left bar) so open + overdue read
            // as one continuous list, overdue at the bottom, each overdue row
            // tagged with its own red "Overdue" pill.
            const overdueList = taskLists.createEl("ul");
            overdueList.className = "sauce-section-overdue-list";
            overdueList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";
            for (const task of sortedOverdue) renderTaskRow(overdueList, task, true);
          }
        };

        for (const mode of ["due", "priority"]) {
          const button = sortControl.createEl("button");
          sortButtons[mode] = button;
          button.textContent = mode === "due" ? "Due" : "Priority";
          button.setAttribute("type", "button");
          button.setAttribute("aria-label", `Sort daily tasks by ${mode}`);
          button.addEventListener("click", (event) => {
            try { event.preventDefault(); } catch (_e) {}
            taskSortMode = SpaceDailyDashboard.writeTaskSortMode(taskSortStorage, mode);
            updateSortButtonState();
            renderTaskLists();
          });
        }
        updateSortButtonState();
        renderTaskLists();
      }
    }

    if (meetings.length > 0) {
      const meetingsBody = this._renderSection(container, {
        accent: "blue",
        iconHtml: icons.calendar,
        title: "Meetings",
        rightHtml: `<span class="sauce-section-count-pill">${meetings.length}</span>`,
        defaultOpen: true,
        stateKey: "sauce-daily-dashboard:meetings",
        sectionState,
      });

      // v0.10.5: enrich each meeting page (read body, parse attendees + tasks +
      // notes) so the meeting card surfaces an attendees subtitle + open-tasks
      // pill + notes pill — mirroring the meetings-hub chrome, with outline
      // pills calibrated for the dashboard's Quiet Frames aesthetic.
      const enrichedMeetings = await Promise.all(meetings.map(p => this._enrichMeeting(p)));

      const meetingsShim = { container: meetingsBody };
      await customJS.BeaconCards.render(meetingsShim, {
        pages: enrichedMeetings,
        layout: "stacked",
        columns: 1,
        title: p => {
          // Strip both leading "YYYY-MM-DD " (legacy) and trailing "-YYYY-MM-DD" (current)
          let name = String(p.file.name || "");
          name = name.replace(`${today} `, "");
          name = name.replace(/-\d{4}-\d{2}-\d{2}$/, "");
          return name || p.file.name;
        },
        subtitle: p => {
          // Prefer attendees over summary — they're higher signal at a glance.
          const att = Array.isArray(p.attendees) ? p.attendees : [];
          if (att.length > 0) {
            const max = 3;
            return att.length <= max
              ? att.join(", ")
              : `${att.slice(0, max - 1).join(", ")}, +${att.length - (max - 1)}`;
          }
          const s = (p.summary && String(p.summary).trim()) || "";
          return s || null;
        },
        badges: p => {
          const out = [];
          if (p.hasNotes)      out.push({ label: "Notes",                 tone: "accent", style: "outline" });
          if (p.openTasks > 0) out.push({ label: `${p.openTasks} open`,   tone: "warn",   style: "outline" });
          return out;
        },
        target: p => p.file.path,
        empty: "(no meetings — should not render due to outer hasContent guard)"
      });
    }

    // TASK 10: Upcoming trips — atlas notes (type:trip) whose start_date is
    // within 14 days. Data selection lives in the pure static selectUpcomingTrips
    // (Node-tested via SDD-TRIPS-*); this is just the dv adapter + a compact row
    // list. Wrapped so it NEVER throws — a vault with no spice/trips (accuris, ero)
    // simply produces [] and renders nothing.
    try {
      const trips = SpaceDailyDashboard.selectUpcomingTrips(dv, today, 14);
      if (Array.isArray(trips) && trips.length > 0) {
        const tripsBody = this._renderSection(container, {
          accent: "cyan",
          iconHtml: icons.mapPin,
          title: "Upcoming trips",
          rightHtml: `<span class="sauce-section-count-pill">${trips.length}</span>`,
          defaultOpen: true,
          stateKey: "sauce-daily-dashboard:trips",
          sectionState,
        });

        // Each trip renders as a quiet card matching the dashboard's other rows:
        // the trip name on the left, and a right cluster with the packing ratio
        // (subtle/muted) + the days-until. No filled background, no left pill —
        // it reads like the section's group rows, not a heavy dark tile.
        for (const trip of trips) {
          const card = tripsBody.createEl("div");
          card.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:12px; padding:8px 12px; margin:6px 0; border:1px solid var(--background-modifier-border); border-radius:8px; background:transparent; cursor:pointer;";

          const nameEl = card.createEl("div");
          nameEl.textContent = trip.name || "Trip";
          nameEl.style.cssText = "flex:1 1 auto; min-width:0; font-weight:600; font-size:0.92em; word-break:break-word; overflow-wrap:anywhere;";

          const meta = card.createEl("div");
          meta.style.cssText = "flex:0 0 auto; display:flex; align-items:center; gap:12px; white-space:nowrap; font-variant-numeric:tabular-nums;";

          if (trip.packTotal > 0) {
            const pk = meta.createEl("span");
            pk.textContent = `${trip.packed}/${trip.packTotal} packed`;
            pk.style.cssText = "font-size:0.76em; color:var(--text-muted);";
          }

          const days = meta.createEl("span");
          days.textContent = trip.daysAway === 0
            ? "Today"
            : (trip.daysAway === 1 ? "1 day" : `${trip.daysAway} days`);
          days.style.cssText = "font-size:0.82em; font-weight:600; color:var(--text-normal);";

          card.onclick = () => { if (trip.path) app.workspace.openLinkText(trip.path, ""); };
        }
      }
    } catch (_e) { /* trips panel is best-effort; never break the dashboard */ }

    if (activityCount > 0) {
      const activityBody = this._renderSection(container, {
        accent: "grey",
        iconHtml: icons.activity,
        title: "Activity",
        rightHtml: `<span class="sauce-section-count-pill">${activityCount}</span>`,
        defaultOpen: true,
        stateKey: "sauce-daily-dashboard:activity",
        sectionState,
      });

      // v0.5.1 (v0.64.1) bugfix: shim must delegate `.pages` to the real dv —
      // ActivityFeed.render() calls dv.pages().where(...).sort(...).slice(...)
      // internally. v0.7.0 (v0.66.0): also delegate `.page` for rollup root
      // lookups (ActivityFeed._query calls dv.page(rootPath) per bucket).
      const activityShim = {
        container: activityBody,
        pages: (...args) => dv.pages(...args),
        page:  (path) => dv.page(path),
        el:    (tag) => activityBody.createEl(tag),
      };
      // v0.13.0 (sauce v0.73.0): syncAllBoards moved out of render to the
      // NEW KanbanStatusSyncInit customjs startup-script (runs once at vault
      // boot). Dashboard reads pre-synced frontmatter; never triggers the
      // sync inline. Removes our code from the hot path of every Dataview
      // re-execution. Manual cache-bypass available via Cmd+P → "Sauce:
      // Re-sync kanban boards".
      if (customJS && customJS.ActivityFeed && typeof customJS.ActivityFeed.render === "function") {
        // 2→1 sweep reduction: reuse the SAME opts we handed to query() above,
        // adding precomputed:{ pages } so render() skips its own vault sweep and
        // renders exactly the pages query() already produced. The rendered cards
        // are byte-for-byte what a fresh render(opts) would have produced.
        await customJS.ActivityFeed.render(
          activityShim,
          Object.assign({}, activityOpts, { precomputed: { pages: activityPages } })
        );
      } else {
        const warn = activityBody.createEl("p");
        warn.style.cssText = "color: var(--text-muted); font-style: italic; margin: 0.5em 0;";
        warn.textContent = "ActivityFeed mechanism unavailable.";
      }
    }
    if (mountReceipt && typeof mountReceipt === "object") {
      mountReceipt.ok = true;
      mountReceipt.node = container;
    }
    } catch (_e) {
      // Cold-load and partial Dataview state never reject, but a partial root
      // is not a successful mount receipt. Remove it so the same Home surface
      // can retry once the missing child mechanism registers.
      try { mountedContainer?.remove?.(); } catch (_removeError) {}
      if (mountReceipt && typeof mountReceipt === "object") {
        mountReceipt.ok = false;
        mountReceipt.node = null;
      }
    }
  }

  /**
   * 2→1 sweep reduction: build the SINGLE ActivityFeed opts object used for
   * BOTH the coalesced customJS.ActivityFeed.query(dv, opts) count sweep AND
   * the customJS.ActivityFeed.render(shim, opts + precomputed) card render.
   * Extracted so the two calls can NEVER pass different opts (which would make
   * the count diverge from the cards). This is byte-for-byte the opts object
   * that used to be inlined in the render() ActivityFeed.render call.
   *
   * `dv` binds the rollUpRoots callbacks; `today` anchors the time window;
   * `icons` supplies the square glyph the metaBuilder passes to
   * _renderActivityMeta.
   * @param {object} dv
   * @param {string} today — YYYY-MM-DD
   * @param {object} icons — render()'s icon table (needs icons.square)
   * @returns {object} ActivityFeed opts
   */
  _buildActivityOpts(dv, today, icons) {
    return {
      scope: "today",
      asOf: today,
      includeMtime: true,
      groupBy: "blueprint",
      blueprints: this._DEFAULT_DASHBOARD_BLUEPRINTS,
      getTitle: (p) => this._resolveTitle(p),
      // v0.10.0 (sauce v0.70.0) — framed renderer + cowork bucket + pin order + sticky-note closed
      framed: true,
      bucketRules: [
        { bucketKey: "cowork", match: (t) => typeof t === "string" && t.indexOf("cowork-") === 0 },
        { bucketKey: "wiki", match: (t) => t === "wiki-page" || t === "wiki-section" },
      ],
      groupOrder: ["cowork", "project", "wiki", "reader-article", "kanban", "trip"],
      groupOrderBottom: ["sticky-note"],
      // Sticky-note renders oldest-first so the day's sticky notes read in
      // the order they were taken. Open/closed-by-default now follows the
      // SAME count-based collapseThreshold every other group uses (a prior
      // task in this same cycle added activity-feed's collapseThreshold
      // opt, default 3) — no more special-casing here.
      defaultClosed: [],
      ascendingGroups: ["sticky-note"],
      // Render the sticky-note group header as "Sticky Notes" instead of the
      // raw type id "sticky-note" (activity-feed groupLabels opt).
      groupLabels: { "sticky-note": "Sticky Notes", "wiki": "Wiki", "reader-article": "Reader" },
      colorByType: this._BLUEPRINT_COLORS,
      rollUpRoots: this._buildRollupRules(dv),
      metaBuilder: (p, el) => this._renderActivityMeta(p, el, icons.square, this._CHEVRON_SVG),
      // v0.12.0 (sauce v0.72.0): kanban group surfaces cards moved today via
      // status_changed_at OR created today via created_at. Activity-feed
      // v0.6.0 tsKeys opt applies the OR semantics.
      // v0.13.6 (sauce v0.96.2): prepend `day` so cowork atomic notes are
      // bucketed by their semantic `day:` frontmatter field (canonical
      // day-of-action) before falling back to wall-clock created_at /
      // status_changed_at. Closes the timestamp-drift class where EOD cron
      // firing past midnight (4am next morning) stamped created_at on the
      // wrong calendar day. Activity-feed iterates tsKeys in order and
      // OR-passes on the first in-window match, so `day` first gives the
      // semantic value precedence without breaking kanban OR semantics.
      tsKeys: ["day", "created_at", "status_changed_at", "captured_at"],
      // v0.11.0 (sauce v0.71.0) — surface cowork-* atomic note summary
      // as the row subtitle for cowork-* pages. NOTE: activity-feed v0.5.0
      // semantics give metaBuilder precedence over getSubtitle (only one
      // fires per row), so this opt is currently dormant — the actual
      // cowork-summary surfacing happens inside _renderActivityMeta below.
      // Plumbed here for clarity + future-proofing if metaBuilder is ever
      // removed; activity-feed will then fall back to getSubtitle.
      getSubtitle: (p) => {
        if (p && p.type && typeof p.type === "string" &&
            p.type.indexOf("cowork-") === 0 &&
            typeof p.summary === "string" && p.summary.length > 0) {
          return p.summary;
        }
        return "";
      },
      // v0.11.0 (sauce v0.71.0) — collapsed groups show a one-line preview
      // from the most-recent page's summary. Activity-feed only invokes
      // this builder for defaultClosed groups (currently sticky-note), so the
      // cowork bucket (open by default) won't trigger it.
      groupPreviewBuilder: (pages) => {
        if (!Array.isArray(pages) || pages.length === 0) return "";
        const top = pages[0];
        if (top && typeof top.summary === "string") {
          return top.summary;
        }
        return "";
      },
    };
  }

  get _DEFAULT_DASHBOARD_BLUEPRINTS() {
    // v0.5.2 (v0.64.2): drop sticky-day + to-do — both are per-day auto-created
    // notes that pollute the activity panel with predictable daily noise.
    // The user creates a fresh ToDo-YYYY-MM-DD.md every morning and a
    // Sticky-Day-YYYY-MM-DD.md whenever a sticky note is taken; neither is a
    // meaningful "activity" signal.
    // v0.5.3 (v0.64.3): drop `meeting` — already has its own dedicated top-level
    // panel ("Today's Meetings"); duplicating inside Activity is noise.
    // v0.6.0 (v0.65.0 cowork-scheduling-cycle): add 6 cowork run-note types so
    // scheduled-job atomic notes surface under their own groups in the
    // "Today's Activity" panel (groupBy: "blueprint" already on).
    //
    // v0.14.0 (2026-07-11 daily/home audit cycle): wiki-page/wiki-section/
    // doc-note added — wiki edits and project docs were previously INVISIBLE
    // to Activity (allowlist filter runs before rollup logic, so an
    // un-listed type never enters the query at all, not even via rollup).
    // doc-note needs no new rollup rule: it already lives under
    // spice/projects/<slug>/..., which the existing project rollup rule
    // (see _ROLLUP_RULES below) already matches by path, so it folds into
    // its parent project's hub card automatically once selectable.
    //
    // NOTE for future blueprint authors: any NEW per-day auto-created "hub"
    // note type (the sticky-day/to-do shape) MUST be excluded here — see the
    // v0.5.2/v0.5.3 comments above for precedent. Audited 2026-07-11: no
    // such gap exists today across any subscribed blueprint.
    return [
      "sticky-note", "journal-entry",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
      "kanban", "board-card",
      "wiki-page", "wiki-section", "doc-note", "reader-article",
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review"
    ];
  }

  /**
   * v0.5.2 (v0.64.2): per-blueprint accent color map. Drives the left-border
   * stripe on each collapsible activity sub-group + the main-section borders
   * (Tasks / Meetings / Activity). Obsidian theme variables themable.
   */
  get _BLUEPRINT_COLORS() {
    return {
      // Activity-feed groups
      cowork:    "var(--color-blue)",   // v0.10.0 — synthetic bucket from bucketRules; sub-type pills stay neutral
      meeting:   "var(--color-blue)",
      "sticky-note": "var(--color-orange)",
      "reader-article": "var(--color-cyan)",
      project:   "var(--color-green)",
      person:    "var(--color-purple)",
      team:      "var(--color-pink)",
      product:   "var(--color-yellow)",
      wiki:      "var(--color-yellow)",
      trip:      "var(--color-cyan)",
      "journal-entry": "var(--color-red)",
      budget:    "var(--color-green)",
      paycheck:  "var(--color-green)",
      invoice:   "var(--color-green)",
      kanban:    "var(--color-pink)",
      // Main dashboard sections (used by the 3 main wrappers)
      tasks:     "var(--color-cyan)",
      meetings:  "var(--color-blue)",
      activity:  "var(--color-purple)",
    };
  }

  /**
   * v0.7.0 (v0.66.0): Lucide chevron-right SVG. CSS rotates 90° on [open]
   * via .sauce-section-chevron + .sauce-section > details[open] rules in
   * the sauce-daily-dashboard.css snippet.
   */
  get _CHEVRON_SVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  }

  /**
   * v0.7.0 (v0.66.0): pill-color map. Mirrors _BLUEPRINT_COLORS today; a
   * separate name lets future cycles diverge (e.g., higher-saturation pill
   * dots vs subtle border colors).
   *
   * v0.11.0 (sauce v0.71.0): grows 6 cowork-* sub-type entries so per-row
   * pills inside the bucket-merged Cowork group carry cadence signal.
   * The cowork BUCKET key (group container) still uses
   * _BLUEPRINT_COLORS.cowork = blue; the sub-type pills below are for rows
   * inside the bucket (consumer reads p.type, which is the original
   * cowork-* sub-type, not the synthetic bucket key).
   */
  get _BLUEPRINT_PILL_COLORS() {
    return {
      ...this._BLUEPRINT_COLORS,
      "cowork-morning-briefing": "var(--color-blue)",
      "cowork-midday-tripwire":  "var(--color-yellow)",
      "cowork-eod-review":       "var(--color-purple)",
      "cowork-finance-snapshot": "var(--color-cyan)",
      "cowork-weekly-review":    "var(--color-pink)",
      "cowork-monthly-review":   "var(--color-red)",
    };
  }

  /**
   * v0.7.0 (v0.66.0): rollup rule templates. Each rule's childMatch and
   * rootPath are wrapped at call-time with the live dv via _buildRollupRules.
   * (_ROLLUP_RULES alone is dv-agnostic so it stays cacheable.)
   */
  get _ROLLUP_RULES() {
    return [
      {
        type: "project",
        childMatchTemplate: (path) => /^spice\/projects\/[^/]+\//.test(path),
        rootPathFromDv: (dv, p) => {
          const m = String(p.file.path).match(/^spice\/projects\/([^/]+)\//);
          if (!m) return null;
          const slug = m[1];
          const hubs = dv.pages('"spice/projects/' + slug + '"')
            .where(pg => pg.type === "project")
            .array();
          if (hubs.length === 0) return null;
          if (hubs.length > 1 && typeof console !== "undefined") {
            console.warn("SpaceDailyDashboard rollup: multiple hubs in spice/projects/" + slug + "; using " + hubs[0].file.path);
          }
          return hubs[0].file.path;
        },
        excludeTemplate: (name) => typeof name === "string" && /^Template,/i.test(name),
      },
      {
        type: "trip",
        childMatchTemplate: (path) => /^spice\/trips\/[^/]+\//.test(path),
        rootPathFromDv: (dv, p) => {
          const m = String(p.file.path).match(/^spice\/trips\/([^/]+)\//);
          if (!m) return null;
          const slug = m[1];
          const hubs = dv.pages('"spice/trips/' + slug + '"')
            .where(pg => pg.type === "trip")
            .array();
          if (hubs.length === 0) return null;
          if (hubs.length > 1 && typeof console !== "undefined") {
            console.warn("SpaceDailyDashboard rollup: multiple hubs in spice/trips/" + slug + "; using " + hubs[0].file.path);
          }
          return hubs[0].file.path;
        },
        excludeTemplate: (name) => typeof name === "string" && /^Template,/i.test(name),
      },
      {
        type: "kanban",
        childMatchTemplate: (path) => /^spice\/boards\/cards\//.test(path),
        rootPathFromDv: (_dv, _p) => "spice/boards/To-Do-Board.md",
        excludeTemplate: (name) => typeof name === "string" && /^Template,/i.test(name),
      },
    ];
  }

  /**
   * v0.7.0 (v0.66.0): bind the live `dv` to each rollup-rule's child/root
   * callbacks. Yields the {type, childMatch, rootPath, exclude} shape
   * ActivityFeed.render expects.
   */
  _buildRollupRules(dv) {
    return this._ROLLUP_RULES.map(rule => ({
      type: rule.type,
      childMatch: (p) => p && p.file && rule.childMatchTemplate(String(p.file.path)),
      rootPath:   (p) => rule.rootPathFromDv(dv, p),
      exclude:    (p) => p && p.file && rule.excludeTemplate(p.file.name),
    }));
  }

  /**
   * v0.8.0 (v0.67.0): duck-type Luxon DateTime vs moment-friendly input.
   * Returns a "h:mm A"-style string (e.g., `8:30 AM`) or null. Used by both
   * _renderActivityMeta (card timestamp) and _renderDrillInList (drill-in row
   * timestamps). Note: both Luxon `"h:mm a"` and moment `"h:mm A"` tokens
   * produce uppercase AM/PM output.
   *
   * Background: Dataview parses ISO frontmatter (`created_at: "2026-05-19T..."`)
   * and file.mtime into Luxon DateTime objects, NOT strings. `window.moment(luxon)`
   * silently produces an invalid value that .format("h:mm A") renders as "12:00 AM".
   * The fix is to detect Luxon via duck-type and call its native toFormat().
   */
  _formatTime(tsRaw) {
    if (!tsRaw) return null;
    try {
      if (typeof tsRaw.toFormat === "function") return tsRaw.toFormat("h:mm a");
      const m = window.moment(tsRaw);
      if (m && m.isValid()) return m.format("h:mm A");
    } catch (_) { /* fall through to null */ }
    return null;
  }

  /**
   * v0.8.0 (v0.67.0): render an open-todo pill ("☐ N") into parentEl when
   * p.file.tasks contains at least one unchecked task. Silent return on
   * zero/missing. Used by Meetings panel meta + Activity meta-line. Excluded
   * from Tasks panel (circular — Tasks IS the open-task surface).
   */
  _renderTodoBadge(p, parentEl, squareIcon) {
    const tasks = p && p.file && p.file.tasks;
    if (!tasks || typeof tasks.length !== "number") return;
    // Dataview p.file.tasks is a DataArray (Proxy) with .where() — not a native
    // array — so Array.isArray() returns false. Prefer .where() when available;
    // fall back to .filter() for unit tests that pass plain arrays.
    const unchecked = (typeof tasks.where === "function")
      ? tasks.where(t => t && !t.completed)
      : tasks.filter(t => t && !t.completed);
    const open = unchecked.length;
    if (open <= 0) return;
    const pill = parentEl.createEl("span");
    pill.className = "sauce-todo-pill";
    pill.title = `${open} open task${open === 1 ? "" : "s"}`;
    pill.innerHTML = `<span class="sauce-todo-icon">${squareIcon}</span><span class="sauce-todo-count">${open}</span>`;
  }

  /**
   * v0.8.0 (v0.67.0): render an inline drill-in list of rollup children.
   * Sorts by file.mtime DESC; caps at 12 visible + "+N more" label.
   * Each row links to the child file. Hidden by default — the breadcrumb
   * click handler in _renderActivityMeta toggles visibility.
   */
  _renderDrillInList(parentEl, children, rootPath) {
    if (!Array.isArray(children) || children.length === 0) return;
    const CAP = 12;
    const toIso = (p) => {
      const m = p && p.file && p.file.mtime;
      if (m && typeof m.toISO === "function") return m.toISO();
      if (typeof m === "string") return m;
      return "";
    };
    const sorted = children.slice().sort((a, b) => {
      const av = toIso(a);
      const bv = toIso(b);
      return bv.localeCompare(av);
    });
    const visible = sorted.slice(0, CAP);
    const overflow = sorted.length - visible.length;
    const rootDir = (rootPath && typeof rootPath === "string")
      ? rootPath.replace(/\/[^/]+$/, "/")
      : "";
    for (const c of visible) {
      if (!c || !c.file || !c.file.path) continue;
      const row = parentEl.createEl("a");
      row.className = "sauce-drill-row";
      row.href = "#";
      let rel = c.file.path;
      if (rootDir && rel.indexOf(rootDir) === 0) rel = rel.slice(rootDir.length);
      else rel = (c.file.name || rel);
      rel = rel.replace(/\.md$/i, "");
      const tsRaw = c && (c.created_at || (c.file && c.file.mtime));
      const time = this._formatTime(tsRaw) || "";
      const nameEl = row.createEl("span");
      nameEl.className = "sauce-drill-name";
      nameEl.textContent = rel;
      const timeEl = row.createEl("span");
      timeEl.className = "sauce-drill-time";
      timeEl.textContent = time;
      row.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          if (typeof app !== "undefined" && app && app.workspace && typeof app.workspace.openLinkText === "function") {
            app.workspace.openLinkText(c.file.path, "");
          }
        } catch (_) { /* ignore */ }
      });
    }
    if (overflow > 0) {
      const more = parentEl.createEl("span");
      more.className = "sauce-drill-more";
      more.textContent = `+${overflow} more`;
    }
  }

  /**
   * v0.12.0 (sauce v0.72.0): kanban-flavored drill-in row renderer.
   * Each child card surfaces its today's transition: move (from → to), create,
   * or archive. Mirrors _renderDrillInList structure but emits a transition
   * line instead of a bare file link + time.
   *
   * Precedence (multiple states on same card today): archive > move > create.
   */
  _renderKanbanDrillInList(parentEl, children, _rootPath) {
    if (!Array.isArray(children) || children.length === 0) return;
    const CAP = 12;
    const visible = children.slice(0, CAP);

    const ul = parentEl.createEl("ul");
    ul.className = "sauce-drill-in-list";

    for (const c of visible) {
      const li = ul.createEl("li");
      li.className = "sauce-drill-in-row";
      const title = this._resolveTitle(c);
      const fm = c || {};
      const status = typeof fm.status === "string" ? fm.status : "";
      const prev = typeof fm.status_prev === "string" ? fm.status_prev : "";
      const column = typeof fm.kanban_column === "string" ? fm.kanban_column : "";

      // Precedence
      let transition;
      if (status === "archived") {
        transition = "archived";
      } else if (prev && prev !== status && prev !== "archived") {
        // Move — humanise from-slug, prefer raw current column label.
        const fromLabel = prev.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
        transition = fromLabel + " → " + (column || status);
      } else {
        // Create — first-ever placement or returning from archive.
        transition = "— created in " + (column || status);
      }

      const a = li.createEl("a");
      a.className = "sauce-drill-in-link";
      a.textContent = title;
      a.onclick = (ev) => {
        ev.preventDefault();
        if (app && app.workspace && c.file && c.file.path) {
          app.workspace.openLinkText(c.file.path, "", false);
        }
      };

      const meta = li.createEl("span");
      meta.className = "sauce-drill-in-transition";
      meta.textContent = "  " + transition;
    }

    if (children.length > CAP) {
      const more = parentEl.createEl("div");
      more.className = "sauce-drill-in-more";
      more.textContent = "+" + (children.length - CAP) + " more";
    }
  }

  /**
   * v0.7.0 (v0.66.0): caller-driven meta line for ActivityFeed cards.
   * Renders time · type-pill · breadcrumb into the supplied parentEl.
   * Wired via BeaconCards' v0.2.6 function-form `meta` opt.
   */
  _renderActivityMeta(p, parentEl, squareIcon, chevronSvg) {
    parentEl.className = "sauce-meta";
    parentEl.innerHTML = "";

    // Time stamp (created_at preferred, file.mtime fallback)
    const tsRaw = (p && p.type === "reader-article")
      ? (p.status_changed_at || p.captured_at || p.created_at || (p.file && p.file.mtime))
      : (p && (p.created_at || (p.file && p.file.mtime)));
    const formatted = this._formatTime(tsRaw);
    if (formatted) {
      const t = parentEl.createEl("time");
      t.textContent = formatted;
    }

    // Type pill
    const type = p && p.type ? String(p.type) : null;
    if (type) {
      const pill = parentEl.createEl("span");
      pill.className = "sauce-pill";
      const dot = pill.createEl("span");
      dot.className = "sauce-pill-dot";
      const colorMap = this._BLUEPRINT_PILL_COLORS;
      let pillText = type;
      let dotColor = (colorMap && colorMap[type]) || "var(--color-base-50)";
      if (type === "reader-article") {
        const st = String(p.status == null ? "unread" : p.status).trim().toLowerCase();
        if (st === "reading") { pillText = "Reading"; dotColor = "var(--interactive-accent)"; }
        else if (st === "archived") { pillText = "Read"; dotColor = "var(--color-green)"; }
        else { pillText = "Added"; dotColor = "var(--color-orange)"; }
      }
      dot.style.background = dotColor;
      const label = pill.createEl("span");
      label.textContent = pillText;
    }

    // Open-todo badge (v0.8.0 — universal across Meetings + Activity)
    this._renderTodoBadge(p, parentEl, squareIcon);

    // v0.11.0 (sauce v0.71.0) — cowork-* atomic notes carry a curated
    // `summary:` frontmatter field; surface it as the row subtitle inside the
    // bucket-merged Cowork group. metaBuilder takes precedence over
    // getSubtitle in activity-feed v0.5.0, so we inline the cowork-summary
    // path here. Non-cowork rows are unaffected.
    if (type && type.indexOf("cowork-") === 0) {
      const summary = (p && typeof p.summary === "string") ? p.summary.trim() : "";
      if (summary) {
        const sub = parentEl.createEl("span");
        sub.className = "sauce-meta-subtitle";
        sub.textContent = summary;
      }
    }

    // Roll-up breadcrumb + drill-in
    if (p && p._isRollUp && typeof p._rollUpChildren === "number" && p._rollUpChildren > 0) {
      const bread = parentEl.createEl("span");
      bread.className = "sauce-bread";
      bread.dataset.expanded = "false";
      const label = (p._rollUpChildren === 1 ? "note" : "notes");
      bread.innerHTML = `· ${p._rollUpChildren} ${label} touched <span class="sauce-bread-chevron">${chevronSvg}</span>`;

      // v0.8.1 (v0.67.1): append drill-in to the CARD root, not the meta row.
      // BeaconCards' row layout puts title/left + meta side-by-side; rendering
      // drill-in inside parentEl (meta) squeezes the title to ellipsis.
      // DOM: parentEl(meta) → row → card. Walk 2 levels up; fall back to parentEl.
      const cardEl = (parentEl && parentEl.parentElement && parentEl.parentElement.parentElement) || parentEl;
      const drillIn = cardEl.createEl("div");
      drillIn.className = "sauce-drill-in";
      drillIn.hidden = true;
      const rootPath = p.file && p.file.path;
      // v0.12.0 (sauce v0.72.0): kanban rollups use the transition-aware drill-in.
      if (p && p.type === "kanban") {
        this._renderKanbanDrillInList(drillIn, p._rollUpChildrenPages || [], rootPath);
      } else {
        this._renderDrillInList(drillIn, p._rollUpChildrenPages || [], rootPath);
      }

      bread.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const expanded = bread.dataset.expanded === "true";
        bread.dataset.expanded = String(!expanded);
        drillIn.hidden = expanded;
      });
    }
  }

  /**
   * v0.7.0 (v0.66.0): single helper that builds a sauce-section + details
   * + summary scaffold for Tasks / Meetings / Activity. Returns the inner
   * body div so the caller can append section-specific content.
   *
   * Visual styling lives in .obsidian/snippets/sauce-daily-dashboard.css
   * (installed via daily.manifest.json's snippets[] + appearance.enabledCssSnippets[]).
   */
  _renderSection(container, { accent, iconHtml, title, titleHtml, rightHtml, defaultOpen, stateKey, sectionState }) {
    const section = container.createEl("div");
    section.className = "sauce-section";
    section.dataset.accent = accent;
    const details = section.createEl("details");
    // v0.13.0 (sauce v0.73.0): override defaultOpen when persisted state has
    // a value for this section's stateKey. Falls back to defaultOpen on miss.
    let initialOpen = !!defaultOpen;
    if (stateKey && sectionState && Object.prototype.hasOwnProperty.call(sectionState, stateKey)) {
      initialOpen = !!sectionState[stateKey];
    }
    if (initialOpen) details.open = true;
    const summary = details.createEl("summary");
    summary.className = "sauce-section-summary";
    // v0.13.1 (sauce v0.84.1): callers can pass titleHtml to inject pre-built
    // HTML; numeric counts interpolated directly are safe, arbitrary user
    // text MUST still go through _escapeHtml.
    // v0.13.3 (sauce v0.84.3): rightHtml parallels titleHtml — wraps a
    // right-aligned .sauce-section-counts container between the title and the
    // chevron, used for the Tasks open/done pills and the Meetings/Activity
    // neutral count pills. Same XSS trust boundary: integers only.
    const rightMarkup = (typeof rightHtml === "string" && rightHtml.length > 0)
      ? `<span class="sauce-section-counts">${rightHtml}</span>`
      : "";
    summary.innerHTML =
      `<span class="sauce-section-icon">${iconHtml}</span>` +
      `<span>${titleHtml ? titleHtml : this._escapeHtml(title)}</span>` +
      rightMarkup +
      `<span class="sauce-section-chevron">${this._CHEVRON_SVG}</span>`;
    const body = details.createEl("div");
    body.className = "sauce-section-body";
    if (stateKey) {
      // Persist ONLY genuine user toggles. Setting details.open programmatically
      // above (initial-state restore) queues an ASYNC `toggle` event that fires
      // AFTER this listener is attached — so without a guard it writes
      // ranch/cache/dashboard-section-state.json on every render. Because that
      // file lives inside the vault, Dataview's file-change auto-refresh then
      // re-executes the block → re-render → programmatic open → write again → an
      // endless ~refreshInterval reload loop (the reported Home "reloads every
      // time"). Tracking the last-persisted value lets us skip the spurious
      // programmatic toggle (open still equals the restored value) and write only
      // when the user actually flips the section.
      let lastPersisted = initialOpen;
      details.addEventListener("toggle", () => {
        if (details.open === lastPersisted) return;
        lastPersisted = details.open;
        this._writeSectionStateKey(stateKey, details.open);
      });
    }
    return body;
  }

  /**
   * v0.13.0 (sauce v0.73.0): read persisted <details> state map from
   * ranch/cache/dashboard-section-state.json. Missing file or malformed JSON
   * returns {} silently — state persistence is best-effort UX polish.
   */
  async _readSectionState() {
    try {
      if (typeof app === "undefined" || !app.vault || !app.vault.adapter) return {};
      const path = "ranch/cache/dashboard-section-state.json";
      if (typeof app.vault.adapter.exists === "function") {
        const ex = await app.vault.adapter.exists(path);
        if (!ex) return {};
      }
      const raw = await app.vault.adapter.read(path);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.states && typeof parsed.states === "object") {
        return parsed.states;
      }
      return {};
    } catch (_) { return {}; }
  }

  /**
   * v0.13.0 (sauce v0.73.0): write a single state key. Last-write-wins —
   * reads the current file, mutates one key, writes the whole thing.
   * Creates ranch/cache/ on first write. Errors swallowed silently.
   */
  async _writeSectionStateKey(key, value) {
    try {
      if (typeof app === "undefined" || !app.vault || !app.vault.adapter) return;
      const path = "ranch/cache/dashboard-section-state.json";
      let cur = {};
      try {
        if (typeof app.vault.adapter.exists === "function") {
          const ex = await app.vault.adapter.exists(path);
          if (ex) {
            const raw = await app.vault.adapter.read(path);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && parsed.states && typeof parsed.states === "object") {
              cur = parsed.states;
            }
          }
        }
      } catch (_) { cur = {}; }
      // Idempotent — never rewrite the file with an unchanged value. A redundant
      // write is a vault modification that triggers Dataview's file-change
      // auto-refresh, so a no-op write would still re-render the Home/daily block.
      if (Object.prototype.hasOwnProperty.call(cur, key) && cur[key] === !!value) return;
      cur[key] = !!value;
      try {
        if (typeof app.vault.adapter.mkdir === "function") {
          await app.vault.adapter.mkdir("ranch/cache");
        }
      } catch (_) { /* dir may exist; ignore */ }
      await app.vault.adapter.write(path, JSON.stringify({ _version: 1, states: cur }, null, 2));
    } catch (_) { /* swallow */ }
  }

  _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  /**
   * v0.10.6 (sauce v0.70.6): resolve the file basename containing this
   * dataviewjs block by walking the markdown leaves and finding the one
   * whose contentEl actually contains `dv.container`. Authoritative
   * regardless of `dv.current()` staleness — which has been observed on
   * Obsidian Mobile when the user navigates between daily notes quickly
   * (the prior leaf's file leaks into `dv.current()`).
   *
   * Returns the file BASENAME (no .md extension), to match the previous
   * call-site contract (`currentFile.file.name`). Falls back to
   * `dv.current().file.name` if the leaf walk fails (e.g., in unit-test
   * shims with no `app.workspace`).
   */
  _resolveCurrentFileName(dv) {
    try {
      if (typeof app !== "undefined" && app && app.workspace
          && typeof app.workspace.getLeavesOfType === "function"
          && dv && dv.container) {
        const leaves = app.workspace.getLeavesOfType("markdown");
        for (const leaf of leaves) {
          if (leaf && leaf.view && leaf.view.contentEl
              && typeof leaf.view.contentEl.contains === "function"
              && leaf.view.contentEl.contains(dv.container)
              && leaf.view.file && leaf.view.file.basename) {
            return String(leaf.view.file.basename);
          }
        }
      }
    } catch (_) { /* fall through to dv.current() fallback */ }
    try {
      const cur = dv.current();
      if (cur && cur.file && cur.file.name) return String(cur.file.name);
    } catch (_) {}
    return "";
  }

  /**
   * v0.13.4: Tasks section title → open (or Templater-create) the viewed
   * day's To-Do note, mirroring cowork-timeframe-buttons.js's `_dispatch()`
   * open-existing-or-create dispatch shape. `dateStr` is the dashboard's
   * `today` (the day being VIEWED, not necessarily the real today — matches
   * every other date computation in this file).
   */
  async _openTodayToDo(dateStr, opts) {
    try {
      const appRef = (typeof globalThis !== "undefined" && globalThis.app) || null;
      const cjs = (typeof globalThis !== "undefined" && globalThis.customJS) || null;
      const momentRef = (typeof globalThis !== "undefined" && globalThis.moment) || null;
      if (!appRef || !momentRef) return { ok: false };
      const m = momentRef(dateStr, "YYYY-MM-DD");
      const folder = `spice/to-do/${m.format("YYYY/MM-MMMM")}`;
      const filenameNoExt = `ToDo-${m.format("YYYY-MM-DD")}`;
      const path = `${folder}/${filenameNoExt}.md`;

      const existing = appRef.vault.getAbstractFileByPath(path);
      if (existing) {
        appRef.workspace.openLinkText(path, "");
        return { ok: true, no_op: true };
      }

      const tpPlugin = appRef.plugins && appRef.plugins.plugins
        ? appRef.plugins.plugins["templater-obsidian"] : null;
      if (!tpPlugin || !tpPlugin.templater) {
        if (typeof Notice === "function") new Notice("SpaceDailyDashboard: Templater plugin not enabled", 8000);
        return { ok: false };
      }

      const templateSource = "ranch/templates/Today To-Do.md";
      const templateFile = appRef.vault.getAbstractFileByPath(templateSource);
      if (!templateFile) {
        if (typeof Notice === "function") new Notice(`SpaceDailyDashboard: template not found at ${templateSource}`, 8000);
        return { ok: false };
      }
      const renderSafe = cjs && cjs.RenderSafe;
      if (!renderSafe || typeof renderSafe.mutateStructure !== "function") return { ok: false };
      let folderCreated = false;
      return await renderSafe.mutateStructure({
        app: appRef,
        dv: opts && opts.dv,
        path,
        failureMessage: `Could not create ${filenameNoExt}`,
        apply: () => {
          const host = opts && opts.host;
          const focusTarget = (typeof document !== "undefined") ? document.activeElement : (opts && opts.trigger);
          if (!host || typeof host.createEl !== "function") return { focusTarget, kind: "none" };
          const node = host.createEl("div", { cls: "sauce-daily-todo-preview is-optimistic" });
          node.textContent = `Creating ${filenameNoExt}…`;
          return { parent: host, node, nextSibling: node.nextSibling || null, focusTarget, kind: "preview" };
        },
        rollback: async (receipt) => {
          if (receipt && receipt.node) {
            if (typeof receipt.node.remove === "function") receipt.node.remove();
            else receipt.parent?.removeChild?.(receipt.node);
          }
          if (folderCreated && !appRef.vault.getAbstractFileByPath(path)) {
            try {
              const createdFolder = appRef.vault.getAbstractFileByPath(folder);
              const empty = createdFolder && Array.isArray(createdFolder.children)
                && createdFolder.children.length === 0;
              if (empty && appRef.fileManager && typeof appRef.fileManager.trashFile === "function") {
                await appRef.fileManager.trashFile(createdFolder);
              }
            } catch (_e) {}
          }
          try {
            const doc = (typeof document !== "undefined") ? document : null;
            const active = doc && doc.activeElement;
            const target = receipt && receipt.focusTarget;
            const userMoved = active && active !== target && active !== doc.body
              && active.isConnected !== false;
            if (!userMoved) target?.focus?.();
          } catch (_e) {}
        },
        write: async () => {
          if (!appRef.vault.getAbstractFileByPath(folder)) {
            try { await appRef.vault.createFolder(folder); folderCreated = true; }
            catch (folderErr) {
              if (!/already exists|exists/i.test((folderErr && folderErr.message) || "")) throw folderErr;
            }
          }
          try {
            return await tpPlugin.templater.create_new_note_from_template(templateFile, folder, filenameNoExt, true);
          } catch (err) {
            const msg = (err && err.message) || "";
            if (/already exists|exists/i.test(msg)) {
              appRef.workspace.openLinkText(path, "");
              return appRef.vault.getAbstractFileByPath(path);
            }
            throw err;
          }
        },
      });
    } catch (_e) { return { ok: false, error: _e }; }
  }

  /**
   * #1: does the meeting body carry REAL notes content, ignoring scaffold?
   * Strips frontmatter, fenced code blocks, HTML comments, horizontal rules,
   * heading lines, task lines (any of -,*,+ markers), and lone/empty bullets;
   * "has notes" iff > 5 non-whitespace chars remain. Works on SectionLabel-shaped
   * AND legacy ## Notes notes. Keys on scaffold SHAPE, not on the "Notes" label
   * (lint-display-markers).
   */
  static _bodyHasNotes(content) {
    if (typeof content !== "string" || !content) return false;
    let body = content;
    const fmEnd = body.indexOf("\n---", 4);
    if (body.indexOf("---") === 0 && fmEnd >= 0) body = body.slice(fmEnd + 4);
    body = body.replace(/```[\s\S]*?```/g, "");          // fenced blocks
    body = body.replace(/<!--[\s\S]*?-->/g, "");          // HTML comments (markers)
    body = body
      .split("\n")
      .filter((l) => !/^\s*---+\s*$/.test(l))             // horizontal rules
      .filter((l) => !/^\s*[-*+]\s*\[[ xX]\]/.test(l))    // task lines (-,*,+)
      .filter((l) => !/^\s*[-*+]\s*$/.test(l))            // lone/empty bullets
      .filter((l) => !/^#+\s/.test(l))                    // heading lines
      .join("\n");
    return body.replace(/\s/g, "").length > 5;
  }

  /**
   * v0.10.5 (sauce v0.70.5): read meeting body + derive attendees, open-task
   * count, and a "has notes" flag for the daily-dashboard Meetings panel.
   * Mirrors the meetings-hub enrichment pattern. Returns a synthetic page
   * (preserves `file` + `summary` from the original Dataview page; adds
   * `attendees`, `openTasks`, `hasNotes`) suitable for BeaconCards.
   *
   * Attendees resolution:
   *   1. Frontmatter `attendees:` array (Dataview's `p.attendees` DataArray) —
   *      preferred. Wikilink tokens like "[[Jason Batai]]" are stripped to
   *      bare display names.
   *   2. Fallback: an Attendees body section with `- [[Name]]` bullets.
   *
   * Has-notes flag (#1): delegated to the scaffold-aware `_bodyHasNotes`
   *   helper, which strips frontmatter, fenced blocks, HTML-comment markers,
   *   horizontal rules, heading lines, task lines, and lone bullets, then
   *   reports true iff real content remains. Keys on scaffold SHAPE rather
   *   than any heading label, so it agrees with the meetings-hub copy.
   */
  async _enrichMeeting(p) {
    let content = "";
    try {
      if (typeof app !== "undefined" && app && app.vault && p && p.file && p.file.path) {
        const file = app.vault.getAbstractFileByPath(p.file.path);
        if (file && typeof app.vault.read === "function") {
          content = await app.vault.read(file);
        }
      }
    } catch (_) { /* leave empty */ }

    const stripWikilink = (s) => {
      const str = String(s);
      const m = str.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      return m ? (m[2] || m[1]) : str;
    };

    let attendees = [];
    if (p && p.attendees && typeof p.attendees.length === "number" && p.attendees.length > 0) {
      for (let i = 0; i < p.attendees.length; i++) {
        const name = stripWikilink(p.attendees[i]).trim();
        if (name) attendees.push(name);
      }
    } else if (content) {
      const attendeesMatch = content.match(/## Attendees\s*([\s\S]*?)(?=---|##|$)/);
      if (attendeesMatch) {
        const lines = attendeesMatch[1].match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g);
        if (lines) {
          attendees = lines.map(l => {
            const m = l.match(/- \[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
            return m ? (m[2] || m[1]) : "";
          }).filter(a => a);
        }
      }
    }

    const openTasks = (content.match(/- \[ \]/g) || []).length;

    const hasNotes = SpaceDailyDashboard._bodyHasNotes(content);

    return {
      file: p.file,
      summary: p.summary || "",
      attendees,
      openTasks,
      hasNotes,
    };
  }

  /**
   * v0.5.2 (v0.64.2): smart title resolver. Falls back to filename when
   * no friendlier source is available. Order:
   *   1. frontmatter `name:`   (NEW v0.7.1 — project blueprint convention,
   *                              fixes literal "Project" titles on rolled-up
   *                              project hubs at spice/projects/<slug>/Project.md)
   *   2. frontmatter `title:`
   *   3. frontmatter `aliases[0]`
   *   4. first heading in `file.outline` (Dataview-supplied)
   *   5. `file.name` (always present)
   *
   * v0.5.3 (v0.64.3): wrapped in try-catch + simplified aliases probe.
   * Dataview's `p.file.aliases` is a Proxy/DataArray that exposes `.values`
   * as a non-callable property (NOT Array.prototype.values), so the prior
   * fallback `aliases.values && aliases.values()[0]` threw
   * "aliases.values is not a function" and aborted BeaconCards rendering.
   * Now: just length-probe + index-zero access, and ANY throw falls back
   * to filename so a single bad frontmatter never breaks the dashboard.
   *
   * v0.13.5 (sauce v0.89.1): typed-alias guard. people@0.6.0 introduced
   * typed-object aliases ({type, value}); pre-fix the aliases[0] branch
   * stringified them to "[object Object]" and rendered that literally as
   * the dashboard row title for newly-created person notes. Now: detect
   * the typed-alias shape and use a0.value; defensive [object Object]
   * fallthrough on every branch as a safety net for any other object
   * leaks (Dataview Link wrappers etc.).
   */
  _resolveTitle(p) {
    // v0.13.5 (sauce v0.89.1): _safe returns a clean string or "" when the value
    // would stringify to "[object Object]". Lets each branch short-circuit on
    // junk and fall through to the next.
    const _safe = (v) => {
      if (v == null) return "";
      if (typeof v === "string") return v.trim();
      const s = String(v).trim();
      if (s === "[object Object]") return "";
      return s;
    };
    try {
      if (!p) return "";
      // v0.7.1 (v0.66.1): project blueprint stores name: in frontmatter, not
      // title:. Without this branch, project hubs at <slug>/Project.md
      // resolve to the literal filename "Project" via the final fallback.
      const nameStr = _safe(p.name);
      if (nameStr) return nameStr;
      const titleStr = _safe(p.title);
      if (titleStr) return titleStr;
      const aliases = p.file && p.file.aliases;
      if (aliases && typeof aliases.length === "number" && aliases.length > 0) {
        const a0 = aliases[0];
        // v0.13.5: typed-alias shape {type, value} from people@0.6.0 — use .value
        // instead of stringifying the wrapper object.
        if (a0 && typeof a0 === "object" && typeof a0.value === "string") {
          const v = _safe(a0.value);
          if (v) return v;
        } else {
          const aliasStr = _safe(a0);
          if (aliasStr) return aliasStr;
        }
      }
      const outline = p.file && p.file.outline;
      if (outline && typeof outline.length === "number" && outline.length > 0) {
        const t0 = outline[0] && (outline[0].text || outline[0].name);
        const outlineStr = _safe(t0);
        if (outlineStr) return outlineStr;
      }
      return p.file && p.file.name ? String(p.file.name) : "";
    } catch (e) {
      return (p && p.file && p.file.name) ? String(p.file.name) : "";
    }
  }

}

// NOTE: do NOT append a `module.exports` / `if (typeof module ...)` trailer here.
// CustomJS loads this file via `eval("(" + fileBody + ")")` then `new()` — it parses
// the WHOLE file as ONE expression. A class expression followed by ANY statement
// (like the old dual-export `if`) is a SyntaxError there ("Unexpected token 'if'"),
// so the class silently fails to register on window.customJS and the daily note shows
// "_SpaceDailyDashboard unavailable_". `node --check` / `require()` use a statement
// parse and do NOT catch this. The Node harness loads the pure statics via
// `new Function(src + "\nreturn SpaceDailyDashboard;")` (run-helper-cases.js DD-A9 /
// run-renderer.js), which needs no export. Enforced by the CJS-LOAD gate
// (platform/test/run-customjs-loadable.js).
