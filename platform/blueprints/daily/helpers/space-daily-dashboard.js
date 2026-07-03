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
   *   overdue — COUNT of open task-notes scheduled BEFORE today (all sources). These
   *             are NOT listed; they surface only as a red count pill so the day's
   *             list stays scoped to what was made for today.
   *   done    — count of _done/ task-notes whose completed_at DATE == today (done-TODAY
   *             only; all-done would grow unbounded with vault history).
   * Filtering is done in plain JS AFTER dv.pages() (not via DataArray .where) so a
   * plain-array dv-stub exercises the real path. No TE (cold load / mechanism not
   * registered) → { open: [], overdue: 0, done: 0 }; the panel simply hides. Never throws.
   */
  static selectTasks(dv, todayStr, TE) {
    if (!TE || typeof TE.parseNote !== "function" || typeof TE.queryToday !== "function") {
      return { open: [], done: 0, overdue: 0 };
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
    // LIST = today only (scheduled == today); overdue = COUNT only (red pill).
    const bands = TE.queryToday(openParsed, todayStr);
    const open = Array.isArray(bands.today) ? bands.today : [];
    const overdue = Array.isArray(bands.overdue) ? bands.overdue.length : 0;

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
   * Home command center count API (DRY): roll up the day's counts for the glance
   * line. Composes selectTasks (→ { open[], overdue, done }) with selectMeetings
   * (→ page[]) and returns integers only: { today, overdue, done, meetings }.
   * Cold-load safe — no TE → tasks zeroed (selectTasks returns empties) but
   * meetings are still counted. Never throws.
   */
  static computeCounts(dv, todayStr, TE) {
    const t = SpaceDailyDashboard.selectTasks(dv, todayStr, TE);
    const m = SpaceDailyDashboard.selectMeetings(dv, todayStr);
    return {
      today: Array.isArray(t.open) ? t.open.length : 0,
      overdue: t.overdue || 0,
      done: t.done || 0,
      meetings: Array.isArray(m) ? m.length : 0,
    };
  }

  async render(dv, params) {
    const icons = {
      calendar: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
      checkSquare: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
      activity: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.5.5 0 0 1-.96 0L9.24 2.18a.5.5 0 0 0-.96 0l-2.35 8.36A2 2 0 0 1 4 12H2"/></svg>`,
      square: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>`
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
    const { open: openTasks, overdue: overdueCount, done: doneCount } = getTasks();
    const activityResult = await this._getActivityCount(dv, today);
    const activityCount = activityResult.total;
    const hasContent = meetings.length > 0 || openTasks.length > 0 || overdueCount > 0 || doneCount > 0 || activityCount > 0;

    // v0.13.0 (sauce v0.73.0): persisted <details> state map. Read once per
    // render so the 3 _renderSection calls don't each hit the adapter.
    const sectionState = await this._readSectionState();

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

    // v0.10.3 (sauce v0.70.3): render a polished empty-state panel when
    // the day has no tasks, meetings, or activity. Replaces the prior
    // silent early-return so the user always gets a visible signal.
    if (!hasContent) {
      const empty = container.createEl("div");
      empty.className = "sauce-empty-state";
      empty.innerHTML = `${icons.activity}<span>No activity recorded yet</span>`;
      return;
    }

    if (openTasks.length > 0 || overdueCount > 0 || doneCount > 0) {
      // v0.13.3 (sauce v0.84.3): pills move out of the title text and into a
      // right-aligned sauce-section-counts container. Up to three pills, each
      // shown only when its count > 0, in a fixed left→right order:
      //   orange "N Open"   — tasks made for today (the LIST below)
      //   red    "M Overdue" — open tasks scheduled before today (COUNT only, not listed)
      //   green  "K Done"    — tasks completed today
      // Numeric counts interpolated directly into rightHtml are XSS-safe; we control
      // every arm. The outer guard guarantees at least one pill renders.
      let tasksRightHtml = "";
      if (openTasks.length > 0) tasksRightHtml += `<span class="sauce-section-open-pill">${openTasks.length} Open</span>`;
      if (overdueCount > 0)     tasksRightHtml += `<span class="sauce-section-overdue-pill">${overdueCount} Overdue</span>`;
      if (doneCount > 0)        tasksRightHtml += `<span class="sauce-section-done-pill">${doneCount} Done</span>`;

      const tasksBody = this._renderSection(container, {
        accent: "cyan",
        iconHtml: icons.checkSquare,
        title: "Tasks",
        rightHtml: tasksRightHtml,
        defaultOpen: true,
        stateKey: "sauce-daily-dashboard:tasks",
        sectionState,
      });

      // v0.13.1: body iterates open tasks only. Done tasks are surfaced via the
      // header count; their notes stay in spice/tasks/_done/.
      if (openTasks.length > 0) {
        const tasksList = tasksBody.createEl("ul");
        tasksList.style.cssText = "margin: 0; padding-left: 20px; list-style-type: disc;";

        // Deterministic inline-link renderer from the task-entity mechanism — real
        // <a> for [[wl]] / [md](url) / bare URLs (task titles can carry links). NOT
        // MarkdownRenderer (absent in the customJS eval context → raw text). Falls
        // back to plain text if TaskTodayList isn't registered yet (cold load).
        const TTL = (typeof customJS !== "undefined" && customJS) ? customJS.TaskTodayList : null;

        for (const task of openTasks) {
          const li = tasksList.createEl("li");
          li.style.cssText = "margin: 6px 0; font-size: 0.9em; cursor: pointer; word-break: break-word; overflow-wrap: anywhere;";

          const titleSpan = li.createEl("span");
          const titleText = (task && task.title) || "(untitled)";
          if (TTL && typeof TTL.renderInlineLinks === "function") {
            TTL.renderInlineLinks(titleSpan, titleText, task.path);
          } else {
            titleSpan.textContent = titleText;
          }

          // Row click → open the task NOTE (read-mostly mirror; the note carries its
          // own edit affordance). Ignore clicks that land on an inner <a> so opening
          // a title link doesn't ALSO navigate to the note.
          li.onclick = (e) => {
            if (e.target && (e.target.tagName === "A" || (e.target.closest && e.target.closest("a")))) return;
            if (task && task.path) app.workspace.openLinkText(task.path, "");
          };
        }
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
        await customJS.ActivityFeed.render(activityShim, {
          scope: "today",
          asOf: today,
          includeMtime: true,
          groupBy: "blueprint",
          blueprints: this._DEFAULT_DASHBOARD_BLUEPRINTS,
          getTitle: (p) => this._resolveTitle(p),
          // v0.10.0 (sauce v0.70.0) — framed renderer + cowork bucket + pin order + scratch closed
          framed: true,
          bucketRules: [
            { bucketKey: "cowork", match: (t) => typeof t === "string" && t.indexOf("cowork-") === 0 },
          ],
          groupOrder: ["cowork", "project", "kanban", "trip"],
          groupOrderBottom: ["scratch"],
          // Scratch group now opens by default (was defaultClosed) and renders
          // oldest-first so the day's scratch notes read in the order they were
          // taken. See the "Daily Hub Scratch Notes" card.
          defaultClosed: [],
          ascendingGroups: ["scratch"],
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
          tsKeys: ["day", "created_at", "status_changed_at"],
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
          // this builder for defaultClosed groups (currently scratch), so the
          // cowork bucket (open by default) won't trigger it.
          groupPreviewBuilder: (pages) => {
            if (!Array.isArray(pages) || pages.length === 0) return "";
            const top = pages[0];
            if (top && typeof top.summary === "string") {
              return top.summary;
            }
            return "";
          },
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

    // v0.10.7 (sauce v0.70.7): mirror activity-feed@0.4.1's strict
    // created_at semantics — when created_at is present, it's authoritative
    // and we do NOT fall through to mtime (which is unreliable on Obsidian
    // Mobile after sync). mtime is consulted only for legacy pages without
    // a created_at field.
    // v0.13.6 (sauce v0.96.2): consult `day` (semantic YYYY-MM-DD frontmatter,
    // canonical day-of-action) FIRST. When `day` is present it is fully
    // authoritative — we do NOT also OR-check created_at / status_changed_at,
    // because doing so would double-surface a page on both its canonical day
    // (per `day:`) AND on the wall-clock day that created_at happens to land on
    // (e.g. EOD cron firing 4am next morning). Only when `day` is absent do we
    // fall back to created_at → status_changed_at OR-semantics (matching the
    // pre-v0.13.6 behavior + activity-feed kanban OR semantics). mtime is the
    // final fallback for legacy pages with NONE of these fields.
    const inWindow = (p) => {
      if (!p) return false;
      // Authoritative path: `day:` frontmatter (semantic day-of-action).
      if (p.day) {
        const ts = String(p.day);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
          return ts >= startIso.slice(0, 10) && ts <= endIso.slice(0, 10);
        }
        return ts >= startIso && ts <= endIso;
      }
      // Legacy path: OR-check created_at + status_changed_at (matches activity-feed
      // tsKeys semantics + pre-v0.13.6 dashboard behavior).
      const FALLBACK_KEYS = ["created_at", "status_changed_at"];
      let anyFieldPresent = false;
      for (const key of FALLBACK_KEYS) {
        const tsRaw = p[key];
        if (!tsRaw) continue;
        anyFieldPresent = true;
        const ts = String(tsRaw);
        if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
          if (ts >= startIso.slice(0, 10) && ts <= endIso.slice(0, 10)) return true;
        } else {
          if (ts >= startIso && ts <= endIso) return true;
        }
      }
      if (anyFieldPresent) return false; // authoritative — at least one field present
      if (p.file && p.file.mtime) {
        const mIso = (typeof p.file.mtime.toISO === "function") ? p.file.mtime.toISO() : String(p.file.mtime);
        if (mIso >= startIso && mIso <= endIso) return true;
      }
      return false;
    };
    // v0.8.1 (v0.67.1): apply ActivityFeed's rollup logic so the count + byBlueprint
    // reflect the cards that will actually render. Pre-v0.8.1, count was raw filtered
    // pages (e.g., project hub if edited) without rollup coalescing — when only
    // project task children were edited (no direct hub edit), the project rollup
    // card would render but `_getActivityCount` would miss it entirely, leading to
    // a single-color segmented accent (FLN-v67-4 observed by user smoke).
    //
    // L5 (perf): ONE sweep of dv.pages() builds BOTH the direct-hit `filtered`
    // set and the rolled-up roots — was two full-vault sweeps with inWindow
    // computed twice per page. A page is EITHER a direct hit (allowed blueprint
    // type, in-window) OR a rollup candidate (in-window child of a project/trip/
    // board), never both, so the old `filtered.some(...)` de-dup is unnecessary.
    // The per-project/-trip rollup rootPath scoped query (dv.pages('"spice/.../
    // <slug>"')) is memoized by slug-prefix so it fires once per project, not
    // once per matching child.
    const filtered = [];
    const rolledUpRoots = new Map(); // rootPath -> rule.type
    const rootPathMemo = new Map();  // "type::spice/<kind>/<slug>" -> rootPath|null (per-render)
    const memoRootPath = (rule, p) => {
      const key = rule.type + "::" + String(p.file.path).split("/").slice(0, 3).join("/");
      if (rootPathMemo.has(key)) return rootPathMemo.get(key);
      let rp = null;
      try { rp = rule.rootPath(p); } catch (_) { rp = null; }
      rootPathMemo.set(key, rp);
      return rp;
    };
    for (const p of dv.pages()) {
      if (!inWindow(p)) continue;
      const path = p && p.file && p.file.path;
      // Direct hit: an allowed blueprint type, in-window (was the `inDay` loop).
      if (allowed.indexOf(String(p.type)) >= 0) { filtered.push(p); continue; }
      // Otherwise a rollup candidate: an in-window child of a project/trip/board.
      if (!path) continue;
      for (const rule of rollupRules) {
        if (typeof rule.exclude === "function" && rule.exclude(p)) break;
        if (typeof rule.childMatch !== "function" || !rule.childMatch(p)) continue;
        const rootPath = memoRootPath(rule, p);
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
      "kanban", "board-card",
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
      details.addEventListener("toggle", () => {
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
