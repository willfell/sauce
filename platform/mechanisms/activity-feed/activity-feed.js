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
 *   rollUpRoots:         Array of {type, childMatch, rootPath, exclude?}
 *                        (optional, added v0.3.0). Coalesces descendant pages
 *                        of a matched root file into a single synthetic page
 *                        for the root. Each rule: childMatch(p)→bool selects
 *                        child pages; rootPath(p)→string returns the root file
 *                        path; exclude?(p)→bool strips pages before matching.
 *                        Decorated root page gets _isRollUp:true +
 *                        _rollUpChildren:count. Additive — callers passing no
 *                        rollUpRoots get prior behavior unchanged.
 *
 *   flatGrouped:         boolean (default false, added v0.3.0) — when true
 *                        (and groupBy="blueprint"), render groups as muted
 *                        uppercase headers with colored dots instead of nested
 *                        <details> blocks.
 *
 *   metaBuilder:         function(page, parentEl) → void (optional, v0.3.0)
 *                        Forwarded to BeaconCards' function-form `meta` opt.
 *                        Caller-driven per-card meta rendering. Requires
 *                        cards@0.2.6.
 *
 *   bucketRules:         Array of {bucketKey: string, match: (type) => bool}
 *                        (optional, added v0.4.0). Applied after grouping by
 *                        p.type. Each rule folds any matching type-key into
 *                        the rule's bucketKey, merging their pages and
 *                        re-sorting by created_at desc inside the bucket.
 *
 *   groupOrder:          string[] (optional, added v0.4.0). Group keys (post-
 *                        bucket-merge) to render first, in the given order.
 *                        Keys with no cards are silently skipped.
 *
 *   groupOrderBottom:    string[] (optional, added v0.4.0). Group keys to
 *                        render last, in the given order. Conflict with
 *                        groupOrder → groupOrder wins.
 *
 *   defaultClosed:       string[] (optional, added v0.4.0). Group keys whose
 *                        <details> element renders without the `open`
 *                        attribute. Only meaningful when framed:true.
 *
 *   framed:              boolean (default false, added v0.4.0). When true
 *                        AND groupBy="blueprint", each group renders as a
 *                        framed section: bg-tint + left-accent stripe,
 *                        clickable summary (chevron + dot + label + count),
 *                        flat list of rows (no per-row backgrounds; hairline
 *                        divider between rows). REPLACES the v0.3.0
 *                        flatGrouped opt — `flatGrouped:true` callers now
 *                        fall through to the v0.1.0 h4 path silently.
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
    // v0.3.0 additive opts
    const metaBuilder = (typeof safeOpts.metaBuilder === "function" && safeOpts.metaBuilder.length >= 2) ? safeOpts.metaBuilder : null;
    const rollUpRoots = Array.isArray(safeOpts.rollUpRoots) ? safeOpts.rollUpRoots : null;

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
      pages = this._query(dv, blueprints, timeWindow, useStatusChangedAt, includeMtime, limit, rollUpRoots);
    } catch (e) {
      new Notice("ActivityFeed: query failed — " + (e && e.message ? e.message : String(e)));
      return;
    }

    if (!pages || pages.length === 0) {
      this._renderEmpty(dv, scope);
      return;
    }

    if (groupBy === "hour") {
      return this._renderGroupedByHour(dv, pages, useStatusChangedAt, getTitle, metaBuilder);
    }
    if (groupBy === "blueprint") {
      return this._renderGroupedByBlueprint(dv, pages, {
        getTitle, collapsible, colorByType, metaBuilder,
        framed: safeOpts.framed === true,
        bucketRules: Array.isArray(safeOpts.bucketRules) ? safeOpts.bucketRules : null,
        groupOrder: Array.isArray(safeOpts.groupOrder) ? safeOpts.groupOrder : null,
        groupOrderBottom: Array.isArray(safeOpts.groupOrderBottom) ? safeOpts.groupOrderBottom : null,
        defaultClosed: Array.isArray(safeOpts.defaultClosed) ? safeOpts.defaultClosed : null,
      });
    }
    return this._renderFlat(dv, pages, getTitle, metaBuilder);
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
   * v0.3.0: accepts rollUpRoots[] to coalesce descendant pages under root files.
   * @param {object} dv
   * @param {string[]} blueprints
   * @param {{startIso, endIso}} timeWindow
   * @param {boolean} useStatusChangedAt
   * @param {boolean} includeMtime — when true, OR file.mtime into the predicate.
   * @param {number} limit
   * @param {Array|null} rollUpRoots — optional rollup rules (v0.3.0).
   * @returns {Array}
   */
  _query(dv, blueprints, timeWindow, useStatusChangedAt, includeMtime, limit, rollUpRoots) {
    const start = timeWindow.startIso;
    const end = timeWindow.endIso;
    const tsKey = useStatusChangedAt ? "status_changed_at" : "created_at";

    // Pass 1: window filter only (NOT type allowlist — rollup children may have
    // types outside the allowlist; we allowlist-filter the SURVIVORS post-rollup).
    const inWindow = (p) => {
      if (!p) return false;
      const tsRaw = p[tsKey];
      if (tsRaw) {
        const ts = String(tsRaw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
          if (ts >= start.slice(0, 10) && ts <= end.slice(0, 10)) return true;
        } else if (ts >= start && ts <= end) return true;
      }
      if (!includeMtime) return false;
      if (!p.file || !p.file.mtime) return false;
      const mIso = (typeof p.file.mtime.toISO === "function") ? p.file.mtime.toISO() : String(p.file.mtime);
      return mIso >= start && mIso <= end;
    };

    const windowed = dv.pages().where(inWindow).array();
    const allowSet = new Set(blueprints.map(String));
    const hasRollup = Array.isArray(rollUpRoots) && rollUpRoots.length > 0;

    let filtered;
    if (!hasRollup) {
      filtered = windowed.filter(p => allowSet.has(String(p.type)));
    } else {
      const buckets = new Map(); // rootPath -> { root, children }
      const survivors = [];

      for (const p of windowed) {
        let consumed = false;
        for (const rule of rollUpRoots) {
          if (typeof rule.exclude === "function" && rule.exclude(p)) { consumed = true; break; }
          if (typeof rule.childMatch !== "function" || !rule.childMatch(p)) continue;
          let rootPath = null;
          try { rootPath = rule.rootPath(p); } catch (_) {}
          if (!rootPath) continue;
          if (rootPath === p.file.path) continue; // no self-rollup
          if (!buckets.has(rootPath)) {
            const rootPage = dv.page(rootPath);
            if (!rootPage) { consumed = true; break; }
            buckets.set(rootPath, { root: rootPage, children: [] });
          }
          buckets.get(rootPath).children.push(p);
          consumed = true;
          break;
        }
        if (!consumed) survivors.push(p);
      }

      const pickLatest = (children) => {
        let best = null, bestKey = "";
        for (const c of children) {
          const v = c[tsKey] ? String(c[tsKey])
                  : (c.file && c.file.mtime && typeof c.file.mtime.toISO === "function" ? c.file.mtime.toISO()
                  : "");
          if (v > bestKey) { bestKey = v; best = c; }
        }
        return best;
      };

      for (const [rootPath, { root, children }] of buckets) {
        const existing = survivors.find(s => s.file && s.file.path === rootPath);
        if (existing) {
          existing._isRollUp = true;
          existing._rollUpChildren = children.length;
          existing._rollUpChildrenPages = children;
          existing._rollUpLatest = pickLatest(children);
        } else {
          const latest = pickLatest(children);
          const synthetic = {
            file: root.file,
            type: root.type,
            // v0.3.1 (v0.66.1): include name field for project-blueprint hubs
            // (filename literally "Project.md"; real name lives in frontmatter
            // `name:`). Without this, _resolveTitle falls through to filename.
            name: root.name,
            title: root.title,
            aliases: root.file && root.file.aliases,
            created_at: (latest && latest[tsKey]) ? latest[tsKey] : root[tsKey],
            status_changed_at: root.status_changed_at,
            _isRollUp: true,
            _rollUpChildren: children.length,
            _rollUpChildrenPages: children,
            _rollUpLatest: latest,
          };
          survivors.push(synthetic);
        }
      }

      filtered = survivors.filter(p => allowSet.has(String(p.type)));
    }

    // Sort by tsKey desc, then slice
    filtered.sort((a, b) => {
      const av = (a && a[tsKey]) ? String(a[tsKey]) : "";
      const bv = (b && b[tsKey]) ? String(b[tsKey]) : "";
      return bv.localeCompare(av);
    });
    return filtered.slice(0, limit);
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  _renderEmpty(dv, scope) {
    const p = dv.container.createEl("p");
    p.style.cssText = "color: var(--text-muted); font-style: italic; margin: 0.5em 0;";
    p.textContent = "No activity in this " + scope + ".";
  }

  _renderFlat(dv, pages, getTitle, metaBuilder) {
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
      meta: metaBuilder ? metaBuilder : ((p) => (p && p.type) ? String(p.type) : ""),
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
    const framed = safe.framed === true;  // NEW v0.4.0 — supersedes flatGrouped
    const colorByType = (safe.colorByType && typeof safe.colorByType === "object") ? safe.colorByType : null;
    const metaBuilder = (typeof safe.metaBuilder === "function" && safe.metaBuilder.length >= 2) ? safe.metaBuilder : null;
    const bucketRules = Array.isArray(safe.bucketRules) ? safe.bucketRules : null;            // NEW v0.4.0
    const groupOrder = Array.isArray(safe.groupOrder) ? safe.groupOrder.map(String) : [];     // NEW v0.4.0
    const groupOrderBottom = Array.isArray(safe.groupOrderBottom) ? safe.groupOrderBottom.map(String) : [];  // NEW v0.4.0
    const defaultClosed = new Set(Array.isArray(safe.defaultClosed) ? safe.defaultClosed.map(String) : []);  // NEW v0.4.0

    // Pass A — initial grouping by p.type (unchanged from v0.3.0)
    const groups = new Map();
    for (const p of pages) {
      const t = (p && p.type) ? String(p.type) : "(untyped)";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(p);
    }

    // Pass B — apply bucketRules (NEW v0.4.0). Each rule folds matching keys
    // into the rule's bucketKey. Pages inside the bucket are sorted by
    // created_at desc (mirrors the outer-feed sort).
    if (bucketRules && bucketRules.length > 0) {
      for (const rule of bucketRules) {
        if (!rule || typeof rule.bucketKey !== "string" || typeof rule.match !== "function") continue;
        const bucketKey = rule.bucketKey;
        let bucketPages = groups.get(bucketKey) ? groups.get(bucketKey).slice() : [];
        const consumed = [];
        for (const [k, list] of groups) {
          if (k === bucketKey) continue;
          let matched = false;
          try { matched = rule.match(k) === true; } catch (_) { matched = false; }
          if (!matched) continue;
          bucketPages = bucketPages.concat(list);
          consumed.push(k);
        }
        if (consumed.length === 0 && !groups.has(bucketKey)) continue;
        bucketPages.sort((a, b) => {
          const av = (a && a.created_at) ? String(a.created_at) : "";
          const bv = (b && b.created_at) ? String(b.created_at) : "";
          return bv.localeCompare(av);
        });
        groups.set(bucketKey, bucketPages);
        for (const k of consumed) groups.delete(k);
      }
    }

    // Pass C — resolve render order. Top-pinned first (in given order),
    // alphabetical middle, bottom-pinned last (in given order). Empty
    // groups (no pages) are silently skipped. If a key appears in both
    // groupOrder and groupOrderBottom, top wins.
    const topSet = new Set();
    const orderedTop = [];
    for (const k of groupOrder) {
      if (groups.has(k) && !topSet.has(k)) {
        orderedTop.push(k);
        topSet.add(k);
      }
    }
    const bottomSet = new Set();
    const orderedBottom = [];
    for (const k of groupOrderBottom) {
      if (topSet.has(k)) continue;
      if (groups.has(k) && !bottomSet.has(k)) {
        orderedBottom.push(k);
        bottomSet.add(k);
      }
    }
    const middle = Array.from(groups.keys())
      .filter(k => !topSet.has(k) && !bottomSet.has(k))
      .sort();
    const sortedKeys = orderedTop.concat(middle).concat(orderedBottom);

    // Pass D — render each group via the selected path.
    for (const t of sortedKeys) {
      const groupPages = groups.get(t);
      const color = (colorByType && colorByType[t]) ? colorByType[t] : "var(--color-base-50)";
      const isClosed = defaultClosed.has(t);

      if (framed) {
        this._renderFramedGroup(dv, { key: t, pages: groupPages, color, isClosed, titleFn, metaBuilder });
      } else if (collapsible) {
        // v0.1.2 legacy path — preserved for callers that prefer nested
        // <details> without framing. No known caller today.
        const details = dv.container.createEl("details");
        details.open = false;
        details.style.cssText = "margin: 0.4em 0; padding: 0.3em 0.5em; border-left: 4px solid " + color + "; background: var(--background-secondary); border-radius: 4px;";
        const summary = details.createEl("summary");
        summary.style.cssText = "cursor: pointer; font-weight: 600; font-size: 0.9em; color: var(--text-normal); user-select: none;";
        summary.textContent = t + " (" + groupPages.length + ")";
        const cardsShim = { container: details };
        customJS.BeaconCards.render(cardsShim, {
          pages: groupPages,
          layout: "row",
          title: titleFn,
          meta: metaBuilder ? metaBuilder : undefined,
        });
      } else {
        // v0.1.0 path — h4 + BeaconCards. No known active caller; kept
        // as the renderer's groupBy:"blueprint" default fallback.
        const h = dv.container.createEl("h4");
        h.textContent = t;
        h.style.cssText = "margin: 0.8em 0 0.3em 0;";
        customJS.BeaconCards.render(dv, {
          pages: groupPages,
          layout: "row",
          title: titleFn,
          meta: metaBuilder ? metaBuilder : undefined,
        });
      }
    }
  }

  /**
   * v0.4.0: render one Activity sub-group as a framed section:
   * wrapper div (bg + left-accent stripe), clickable summary (chevron +
   * dot + label + count), flat list of rows (no per-row backgrounds;
   * hairline divider between rows). Title + meta are caller-supplied;
   * click-to-open is wired here so callers don't need to handle it.
   *
   * Rows are structured as:
   *   .sauce-group-row              ← flex-direction: column container
   *     .sauce-group-row-line       ← flex-row: title + meta
   *       .sauce-group-row-title
   *       .sauce-group-row-meta     ← metaBuilder writes here
   *
   * This shape ensures `_renderActivityMeta`'s parentElement.parentElement
   * walk (used to attach the drill-in panel) lands at .sauce-group-row,
   * which is column-oriented and can hold the drill-in below the line.
   */
  _renderFramedGroup(dv, { key, pages, color, isClosed, titleFn, metaBuilder }) {
    const group = dv.container.createEl("div");
    group.className = "sauce-group";
    group.dataset.group = key;
    // Emit data-group attr into _html so Node test shim's innerHTML captures it.
    if (typeof group._html !== "undefined") group._html += ' data-group="' + key + '"';
    if (typeof group.style.setProperty === "function") {
      group.style.setProperty("--group-accent", color);
    } else {
      group.style.cssText = "--group-accent: " + color + ";";
    }

    const details = group.createEl("details");
    if (!isClosed) details.open = true;

    const summary = details.createEl("summary");
    summary.className = "sauce-group-header";
    const chevron = summary.createEl("span");
    chevron.className = "sauce-group-chevron";
    chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
    const dot = summary.createEl("span");
    dot.className = "sauce-group-dot";
    dot.style.background = color;
    const label = summary.createEl("span");
    label.className = "sauce-group-label";
    label.textContent = key;
    const count = summary.createEl("span");
    count.className = "sauce-group-count";
    count.textContent = "(" + pages.length + ")";

    const body = details.createEl("div");
    body.className = "sauce-group-body";

    for (const p of pages) {
      const row = body.createEl("div");
      row.className = "sauce-group-row";
      const line = row.createEl("div");
      line.className = "sauce-group-row-line";
      const titleEl = line.createEl("span");
      titleEl.className = "sauce-group-row-title";
      const titleText = (typeof titleFn === "function" ? titleFn(p) : (p && p.file && p.file.name)) || "";
      titleEl.textContent = String(titleText);
      const metaEl = line.createEl("span");
      metaEl.className = "sauce-group-row-meta";
      if (typeof metaBuilder === "function") {
        try { metaBuilder(p, metaEl); } catch (_) { /* swallow — never break a single row */ }
      }
      // Click-to-open on the line. Anchors/breadcrumbs inside meta
      // call stopPropagation themselves; this handler defends with a
      // best-effort closest("a") probe in case a shim lacks it.
      if (typeof line.addEventListener === "function") {
        line.addEventListener("click", (ev) => {
          try {
            const target = ev.target;
            if (target && typeof target.closest === "function" && target.closest("a")) return;
            if (p && p.file && p.file.path && typeof app !== "undefined" && app && app.workspace && typeof app.workspace.openLinkText === "function") {
              app.workspace.openLinkText(p.file.path, "");
            }
          } catch (_) { /* ignore */ }
        });
      }
    }
  }

  _renderGroupedByHour(dv, pages, useStatusChangedAt, getTitle, metaBuilder) {
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
        meta: metaBuilder ? metaBuilder : ((p) => (p && p.type) ? String(p.type) : ""),
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
