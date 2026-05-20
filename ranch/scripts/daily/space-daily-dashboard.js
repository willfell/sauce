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
 *    function` when scratch / meeting notes had no `aliases:` frontmatter.
 *    Dataview's `p.file.aliases` is a Proxy/DataArray where `.values` is
 *    a non-callable property (not Array.prototype.values). The throw
 *    aborted BeaconCards mid-render, leaving the activity-panel cards
 *    visually empty. Wrapped resolver in try-catch + simplified aliases
 *    probe to length-only.
 *  - Allowlist drops `meeting` — already has its own dedicated top-level
 *    "Today's Meetings" panel; duplicate inside Activity was noise.
 *
 * v0.3.2 (v0.64.2) PATCH:
 *  - Activity panel allowlist drops `scratch-day` + `to-do` — both are
 *    per-day auto-created notes that flood the activity stream with
 *    predictable daily noise (one new entry every morning each).
 *  - Smart title resolver `_resolveTitle(p)` — tries `title:` frontmatter,
 *    then `aliases[0]`, then first heading in `file.outline`, then falls
 *    back to filename. Surfaces user-meaningful titles for timestamp-named
 *    scratches once the user adds `title:` or `aliases:`.
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
 *    - flatGrouped: muted uppercase headers replace nested <details>
 *      sub-groups (single-tap reveal at outer-section level).
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
 */
class SpaceDailyDashboard {
  async render(dv) {
    const icons = {
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      checkSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      activity: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.24 2.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4 12H2"/></svg>`,
      square: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`
    };

    const currentFile = dv.current();
    const fileName = currentFile.file.name;
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    const today = dateMatch ? dateMatch[1] : moment().format("YYYY-MM-DD");

    const config = {
      meetingsPath: "spice/meetings/notes",
      todoPaths: ["spice/to-do"]
    };

    const getMeetings = () => {
      if (!config.meetingsPath) return [];
      // v0.2.6: match meetings whose filename CONTAINS today's date (covers
      // both leading-date "2026-05-12 Foo.md" and trailing-date "Foo-2026-05-12.md"
      // conventions). Previously matched only leading-date — accuris-style
      // trailing-date names were silently dropped.
      const pages = dv.pages(`"${config.meetingsPath}"`)
        .where(p => p.file.name.includes(today))
        .sort(p => p.file.name, "asc");
      return pages.array();
    };

    const getTasks = () => {
      const tasks = [];
      for (const todoPath of config.todoPaths) {
        const todoPages = dv.pages(`"${todoPath}"`)
          .where(p => p.file.name.includes(today));
        for (const page of todoPages) {
          const pageTasks = page.file.tasks.where(t => !t.completed);
          for (const task of pageTasks) {
            tasks.push({
              text: task.text,
              parentPath: page.file.path
            });
          }
        }
      }
      return tasks;
    };

    const meetings = getMeetings();
    const tasks = getTasks();
    const activityResult = await this._getActivityCount(dv, today);
    const activityCount = activityResult.total;
    const activityByBlueprint = activityResult.byBlueprint;
    const hasContent = meetings.length > 0 || tasks.length > 0 || activityCount > 0;
    if (!hasContent) return;

    const existing = dv.container.querySelector(".space-daily-dashboard");
    if (existing) existing.remove();

    const container = dv.el("div", "", { cls: "space-daily-dashboard" });
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

    if (tasks.length > 0) {
      const tasksBody = this._renderSection(container, {
        accent: "cyan",
        iconHtml: icons.checkSquare,
        title: `Tasks (${tasks.length})`,
        defaultOpen: true,
      });

      const tasksList = tasksBody.createEl("ul");
      tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

      for (const task of tasks) {
        const li = tasksList.createEl("li");
        // v0.2.6: word-break + overflow-wrap protect against long task strings
        // (URLs, hashes, no-space text) overflowing the dashboard.
        li.style.cssText = "margin: 6px 0; font-size: 0.9em; cursor: pointer; word-break: break-word; overflow-wrap: anywhere;";
        // v0.5.1 (v0.64.1): render markdown links + wikilinks as clickable
        // anchors. Plain-text clicks (outside any <a>) still open the parent
        // daily note via the LI's onclick.
        li.innerHTML = this._renderTaskHTML(task.text);
        li.onclick = (e) => {
          if (e.target && (e.target.tagName === "A" || (e.target.closest && e.target.closest("a")))) return;
          app.workspace.openLinkText(task.parentPath, "");
        };
        const wikilinks = li.querySelectorAll("a.internal-link");
        for (const a of wikilinks) {
          a.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = a.getAttribute("data-href") || a.textContent || "";
            app.workspace.openLinkText(target, task.parentPath);
          };
        }
      }
    }

    if (meetings.length > 0) {
      const meetingsBody = this._renderSection(container, {
        accent: "blue",
        iconHtml: icons.calendar,
        title: `Meetings (${meetings.length})`,
        defaultOpen: true,
      });

      const meetingsShim = { container: meetingsBody };
      await customJS.BeaconCards.render(meetingsShim, {
        pages: meetings,
        layout: "stacked",
        columns: 1,
        title: p => p.file.name.replace(`${today} `, ""),
        subtitle: p => {
          const s = p.summary || "";
          return (typeof s === "string" && s.trim()) ? s.trim() : null;
        },
        meta: (p, el) => this._renderTodoBadge(p, el, icons.square),
        target: p => p.file.path,
        empty: "(no meetings — should not render due to outer hasContent guard)"
      });
    }

    if (activityCount > 0) {
      const activityBody = this._renderSection(container, {
        accent: "purple",
        iconHtml: icons.activity,
        title: `Activity (${activityCount})`,
        defaultOpen: true,
        accentSegments: this._buildAccentSegments(activityByBlueprint),
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
      if (customJS && customJS.ActivityFeed && typeof customJS.ActivityFeed.render === "function") {
        await customJS.ActivityFeed.render(activityShim, {
          scope: "today",
          asOf: today,
          includeMtime: true,
          groupBy: "blueprint",
          blueprints: this._DEFAULT_DASHBOARD_BLUEPRINTS,
          getTitle: (p) => this._resolveTitle(p),
          // v0.7.0 (v0.66.0) — replaces collapsible:true (renderer side)
          flatGrouped: true,
          colorByType: this._BLUEPRINT_COLORS,
          rollUpRoots: this._buildRollupRules(dv),
          metaBuilder: (p, el) => this._renderActivityMeta(p, el, icons.square, this._CHEVRON_SVG),
        });
      } else {
        const warn = activityBody.createEl("p");
        warn.style.cssText = "color: var(--text-muted); font-style: italic; margin: 0.5em 0;";
        warn.textContent = "ActivityFeed mechanism unavailable.";
      }
    }
  }

  /**
   * Pre-count activity matches for the hasContent gate. Mirrors
   * ActivityFeed._query semantics but returns just the length, so we can
   * short-circuit the dashboard render when nothing matches.
   */
  async _getActivityCount(dv, today) {
    const startIso = window.moment(today, "YYYY-MM-DD").startOf("day").format();
    const endIso   = window.moment(today, "YYYY-MM-DD").endOf("day").format();
    const allowed  = this._DEFAULT_DASHBOARD_BLUEPRINTS;
    const rollupRules = this._buildRollupRules(dv);

    const inWindow = (p) => {
      if (!p) return false;
      const tsRaw = p.created_at;
      if (tsRaw) {
        const ts = String(tsRaw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
          if (ts >= startIso.slice(0, 10) && ts <= endIso.slice(0, 10)) return true;
        } else if (ts >= startIso && ts <= endIso) {
          return true;
        }
      }
      if (p.file && p.file.mtime) {
        const mIso = (typeof p.file.mtime.toISO === "function") ? p.file.mtime.toISO() : String(p.file.mtime);
        if (mIso >= startIso && mIso <= endIso) return true;
      }
      return false;
    };
    const inDay = (p) => {
      if (!p) return false;
      if (allowed.indexOf(String(p.type)) < 0) return false;
      return inWindow(p);
    };

    // v0.8.1 (v0.67.1): apply ActivityFeed's rollup logic so the count + byBlueprint
    // reflect the cards that will actually render. Pre-v0.8.1, count was raw filtered
    // pages (e.g., project hub if edited) without rollup coalescing — when only
    // project task children were edited (no direct hub edit), the project rollup
    // card would render but `_getActivityCount` would miss it entirely, leading to
    // a single-color segmented accent (FLN-v67-4 observed by user smoke).
    const filtered = [];
    for (const p of dv.pages()) {
      if (inDay(p)) filtered.push(p);
    }

    const rolledUpRoots = new Map(); // rootPath -> rule.type
    for (const p of dv.pages()) {
      if (!inWindow(p)) continue;
      // Skip pages already in `filtered` — they're directly counted via their own type
      const path = p && p.file && p.file.path;
      if (!path) continue;
      if (filtered.some(f => f.file && f.file.path === path)) continue;
      for (const rule of rollupRules) {
        if (typeof rule.exclude === "function" && rule.exclude(p)) break;
        if (typeof rule.childMatch !== "function" || !rule.childMatch(p)) continue;
        let rootPath = null;
        try { rootPath = rule.rootPath(p); } catch (_) {}
        if (!rootPath) continue;
        if (rootPath === path) continue;
        if (!rolledUpRoots.has(rootPath)) rolledUpRoots.set(rootPath, rule.type);
        break;
      }
    }

    // Remove direct hits whose root is also being rolled up (avoid double-count)
    const rolledRootPaths = new Set(rolledUpRoots.keys());
    const survivors = filtered.filter(p => !(p.file && rolledRootPaths.has(p.file.path)));

    // Final card-count = surviving direct hits + synthetic rollup roots
    const byBlueprint = {};
    const bucket = (t) => {
      if (!t) return "(unknown)";
      const s = String(t);
      if (s === "project" || s.startsWith("project-")) return "project";
      if (s === "trip" || s.startsWith("trip-")) return "trip";
      return s;
    };
    for (const p of survivors) {
      const blueprint = bucket(p && p.type);
      byBlueprint[blueprint] = (byBlueprint[blueprint] || 0) + 1;
    }
    for (const [, type] of rolledUpRoots) {
      const blueprint = bucket(type);
      byBlueprint[blueprint] = (byBlueprint[blueprint] || 0) + 1;
    }
    const total = survivors.length + rolledUpRoots.size;
    return { total, byBlueprint };
  }

  get _DEFAULT_DASHBOARD_BLUEPRINTS() {
    // v0.5.2 (v0.64.2): drop scratch-day + to-do — both are per-day auto-created
    // notes that pollute the activity panel with predictable daily noise.
    // The user creates a fresh ToDo-YYYY-MM-DD.md every morning and a
    // Scratch-Day-YYYY-MM-DD.md whenever a scratch is taken; neither is a
    // meaningful "activity" signal.
    // v0.5.3 (v0.64.3): drop `meeting` — already has its own dedicated top-level
    // panel ("Today's Meetings"); duplicating inside Activity is noise.
    // v0.6.0 (v0.65.0 cowork-scheduling-cycle): add 6 cowork run-note types so
    // scheduled-job atomic notes surface under their own groups in the
    // "Today's Activity" panel (groupBy: "blueprint" already on).
    return [
      "scratch", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice",
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
      meeting:   "var(--color-blue)",
      scratch:   "var(--color-orange)",
      project:   "var(--color-green)",
      person:    "var(--color-purple)",
      team:      "var(--color-pink)",
      product:   "var(--color-yellow)",
      trip:      "var(--color-cyan)",
      journal:   "var(--color-red)",
      budget:    "var(--color-green)",
      paycheck:  "var(--color-green)",
      invoice:   "var(--color-green)",
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
   */
  get _BLUEPRINT_PILL_COLORS() {
    return this._BLUEPRINT_COLORS;
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
   * v0.8.0 (v0.67.0): build a linear-gradient string from a byBlueprint count
   * map. Returns null when no entries (caller falls through to single-color
   * border-left). Used only by the Activity section — Tasks/Meetings stay
   * with the existing border-left single-color rule.
   */
  _buildAccentSegments(byBlueprint) {
    if (!byBlueprint || typeof byBlueprint !== "object") return null;
    // v0.8.2 (v0.67.2): sort entries alphabetically by key so segment order
    // matches ActivityFeed's group rendering order (which renders blueprints
    // alphabetically). Pre-v0.8.2 order depended on Map iteration which mixed
    // direct-hits before rollups, producing inverted segments vs. visual content.
    const entries = Object.entries(byBlueprint)
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return null;
    const total = entries.reduce((s, [, n]) => s + n, 0);
    const colors = this._BLUEPRINT_PILL_COLORS || {};
    const stops = [];
    let cursor = 0;
    for (const [type, count] of entries) {
      const color = colors[type] || "var(--color-base-50)";
      const start = (cursor * 100).toFixed(2) + "%";
      cursor += count / total;
      const end = (cursor * 100).toFixed(2) + "%";
      stops.push(`${color} ${start}, ${color} ${end}`);
    }
    return `linear-gradient(to bottom, ${stops.join(", ")})`;
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
    const tsRaw = p && (p.created_at || (p.file && p.file.mtime));
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
      dot.style.background = (colorMap && colorMap[type]) || "var(--color-base-50)";
      const label = pill.createEl("span");
      label.textContent = type;
    }

    // Open-todo badge (v0.8.0 — universal across Meetings + Activity)
    this._renderTodoBadge(p, parentEl, squareIcon);

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
      this._renderDrillInList(drillIn, p._rollUpChildrenPages || [], rootPath);

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
  _renderSection(container, { accent, iconHtml, title, defaultOpen, accentSegments }) {
    const section = container.createEl("div");
    section.className = "sauce-section";
    section.dataset.accent = accent;
    if (accentSegments) {
      section.dataset.segmented = "true";
      section.style.setProperty("--sauce-accent-segments", accentSegments);
    }
    const details = section.createEl("details");
    if (defaultOpen) details.open = true;
    const summary = details.createEl("summary");
    summary.className = "sauce-section-summary";
    summary.innerHTML =
      `<span class="sauce-section-icon">${iconHtml}</span>` +
      `<span>${this._escapeHtml(title)}</span>` +
      `<span class="sauce-section-chevron">${this._CHEVRON_SVG}</span>`;
    const body = details.createEl("div");
    body.className = "sauce-section-body";
    return body;
  }

  _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
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
   */
  _resolveTitle(p) {
    try {
      if (!p) return "";
      // v0.7.1 (v0.66.1): project blueprint stores name: in frontmatter, not
      // title:. Without this branch, project hubs at <slug>/Project.md
      // resolve to the literal filename "Project" via the final fallback.
      const name = p.name;
      if (name && String(name).trim()) return String(name).trim();
      const title = p.title;
      if (title && String(title).trim()) return String(title).trim();
      const aliases = p.file && p.file.aliases;
      if (aliases && typeof aliases.length === "number" && aliases.length > 0) {
        const a0 = aliases[0];
        if (a0 && String(a0).trim()) return String(a0).trim();
      }
      const outline = p.file && p.file.outline;
      if (outline && typeof outline.length === "number" && outline.length > 0) {
        const t0 = outline[0] && (outline[0].text || outline[0].name);
        if (t0 && String(t0).trim()) return String(t0).trim();
      }
      return p.file && p.file.name ? String(p.file.name) : "";
    } catch (e) {
      return (p && p.file && p.file.name) ? String(p.file.name) : "";
    }
  }

  /**
   * v0.5.1 (v0.64.1): convert task text containing markdown links + wikilinks
   * into safe HTML for innerHTML rendering. All non-link content is HTML-escaped.
   *  - `[text](url)` → external <a target="_blank">
   *  - `[[target]]` / `[[target|alias]]` → internal <a class="internal-link">
   *    (caller wires onclick → app.workspace.openLinkText)
   */
  _renderTaskHTML(text) {
    const escapeHtml = (s) => String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    // Process in segments: split on link tokens, escape literal segments,
    // emit anchor HTML for link tokens. Two-pass scan keeps wikilink matches
    // from interfering with markdown-link matches (and vice versa).
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      // Try wikilink [[...]] first (must come before markdown-link probe
      // because [[x]] starts with [[ which markdown-link's [ would also match).
      if (text.charAt(i) === "[" && text.charAt(i + 1) === "[") {
        const end = text.indexOf("]]", i + 2);
        if (end >= 0) {
          const inner = text.slice(i + 2, end);
          const pipe = inner.indexOf("|");
          const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
          const alias  = pipe >= 0 ? inner.slice(pipe + 1).trim() : target;
          tokens.push({ kind: "wikilink", target, alias });
          i = end + 2;
          continue;
        }
      }
      // Markdown link [text](url)
      if (text.charAt(i) === "[") {
        const closeBracket = text.indexOf("]", i + 1);
        if (closeBracket >= 0 && text.charAt(closeBracket + 1) === "(") {
          const closeParen = text.indexOf(")", closeBracket + 2);
          if (closeParen >= 0) {
            const linkText = text.slice(i + 1, closeBracket);
            const url      = text.slice(closeBracket + 2, closeParen);
            tokens.push({ kind: "mdlink", text: linkText, url });
            i = closeParen + 1;
            continue;
          }
        }
      }
      // Literal char — accumulate to next token
      let j = i;
      while (j < text.length && text.charAt(j) !== "[") j++;
      if (j === i) j = i + 1; // safety against zero-width
      tokens.push({ kind: "text", value: text.slice(i, j) });
      i = j;
    }

    let html = "";
    for (const tok of tokens) {
      if (tok.kind === "text") {
        html += escapeHtml(tok.value);
      } else if (tok.kind === "mdlink") {
        html += `<a href="${escapeHtml(tok.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tok.text)}</a>`;
      } else if (tok.kind === "wikilink") {
        html += `<a href="#" class="internal-link" data-href="${escapeHtml(tok.target)}">${escapeHtml(tok.alias)}</a>`;
      }
    }
    return html;
  }
}
