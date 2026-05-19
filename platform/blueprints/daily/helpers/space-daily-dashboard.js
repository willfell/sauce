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
 * v0.3.1 (v0.64.1) PATCH:
 *  - BUGFIX: activityShim now delegates `.pages` to the real dv (was a thin
 *    {container} shim, which broke ActivityFeed._query's `dv.pages()` call
 *    with "dv.pages is not a function" — Activity panel never rendered).
 *  - Tasks panel: render markdown links `[text](url)` + wikilinks `[[target]]`
 *    as clickable HTML anchors via new `_renderTaskHTML(text)` helper. LI
 *    click still opens the parent daily note for clicks outside any anchor;
 *    wikilink anchors wire onclick → app.workspace.openLinkText.
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
      zap: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
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
    const activityCount = await this._getActivityCount(dv, today);
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
      const tasksSection = container.createEl("div", { cls: "section" });
      tasksSection.style.cssText = "margin-bottom: 16px;";

      const tasksHeader = tasksSection.createEl("div", { cls: "section-header" });
      tasksHeader.innerHTML = `${icons.checkSquare} <span>Today's Tasks</span>`;
      tasksHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95em;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 10px;
      `;

      const tasksList = tasksSection.createEl("ul");
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
          // Don't intercept clicks that land on inline anchors.
          if (e.target && (e.target.tagName === "A" || (e.target.closest && e.target.closest("a")))) return;
          app.workspace.openLinkText(task.parentPath, "");
        };
        // Wire wikilink anchors to Obsidian's link-open API.
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
      const meetingsSection = container.createEl("div", { cls: "section" });

      const meetingsHeader = meetingsSection.createEl("div", { cls: "section-header" });
      meetingsHeader.innerHTML = `${icons.calendar} <span>Today's Meetings</span>`;
      meetingsHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95em;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 10px;
      `;

      const meetingsPanel = meetingsSection.createEl("div");
      const meetingsShim = { container: meetingsPanel };
      await customJS.BeaconCards.render(meetingsShim, {
        pages: meetings,
        layout: "stacked",
        columns: 1,
        title: p => p.file.name.replace(`${today} `, ""),
        subtitle: p => {
          const s = p.summary || "";
          return (typeof s === "string" && s.trim()) ? s.trim() : null;
        },
        target: p => p.file.path,
        empty: "(no meetings — should not render due to outer hasContent guard)"
      });
    }

    if (activityCount > 0) {
      const activitySection = container.createEl("div", { cls: "section" });
      activitySection.style.cssText = "margin-top: 16px;";

      const activityHeader = activitySection.createEl("div", { cls: "section-header" });
      activityHeader.innerHTML = `${icons.zap} <span>Today's Activity</span>`;
      activityHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95em;
        font-weight: 600;
        color: var(--text-normal);
        margin-bottom: 10px;
      `;

      const activityPanel = activitySection.createEl("div");
      // v0.5.1 (v0.64.1) bugfix: shim must delegate `.pages` to the real dv —
      // ActivityFeed.render() calls dv.pages().where(...).sort(...).slice(...)
      // internally. The v0.5.0 shim only had `.container`, so the query failed
      // with "dv.pages is not a function" and the panel never rendered.
      const activityShim = {
        container: activityPanel,
        pages: (...args) => dv.pages(...args),
      };
      if (customJS && customJS.ActivityFeed && typeof customJS.ActivityFeed.render === "function") {
        await customJS.ActivityFeed.render(activityShim, {
          scope: "today",
          asOf: today,
          includeMtime: true,
          groupBy: "blueprint",
          blueprints: this._DEFAULT_DASHBOARD_BLUEPRINTS,
        });
      } else {
        const warn = activityPanel.createEl("p");
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
    const inDay = (p) => {
      if (!p) return false;
      if (allowed.indexOf(String(p.type)) < 0) return false;
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
    let count = 0;
    for (const p of dv.pages()) {
      if (inDay(p)) count++;
    }
    return count;
  }

  get _DEFAULT_DASHBOARD_BLUEPRINTS() {
    return [
      "meeting", "scratch", "scratch-day", "to-do", "journal",
      "project", "person", "team", "product", "trip",
      "budget", "paycheck", "invoice"
    ];
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
