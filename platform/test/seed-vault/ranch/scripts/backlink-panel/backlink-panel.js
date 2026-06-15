/**
 * backlink-panel@0.1.0 — universal cross-blueprint backlink renderer (FA-8).
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. `customJS.BeaconCards` is read at call-time, never at class-load.
 *
 * Public API:
 *   render(dv, opts) → void | Promise<void>
 *
 * opts:
 *   entityType: "person" | "project" | "team" | "product" | "trip" | "meeting" (required)
 *   groupBy:    "type" | "month" | "none" (default "none")
 *   limit:      number (default 25)
 *   sortBy:     "created_at" | "title" (default "created_at" desc)
 *
 * The 6 canonical cross-ref keys map 1:1 to entityType:
 *   person → people:    project → projects:    team → teams:
 *   product → products:  trip → trips:          meeting → meetings:
 *
 * Per landmine #11: spice/ module-directory namespace is conceptual, not
 * hardcoded here — Dataview query scope is vault-wide.
 */
class BacklinkPanel {
  /**
   * Render a backlinks panel for the current entity page.
   * @param {object} dv  — Dataview API in dataviewjs scope
   * @param {object} opts
   */
  render(dv, opts) {
    const safeOpts = opts || {};
    const entityType = safeOpts.entityType;
    const key = this._ENTITY_TYPE_TO_KEY[entityType];
    if (!key) {
      new Notice(
        "BacklinkPanel: unknown entityType " + JSON.stringify(entityType) +
        " (expected one of: " + Object.keys(this._ENTITY_TYPE_TO_KEY).join(", ") + ")"
      );
      return;
    }

    const limit = typeof safeOpts.limit === "number" && safeOpts.limit > 0
      ? safeOpts.limit
      : 25;
    const sortBy = (safeOpts.sortBy === "title")
      ? "title"
      : "created_at";
    const groupBy = (safeOpts.groupBy === "type" || safeOpts.groupBy === "month")
      ? safeOpts.groupBy
      : "none";

    let pages;
    try {
      pages = this._reverseQuery(dv, key, sortBy, limit);
    } catch (e) {
      new Notice("BacklinkPanel: reverse query failed — " + (e && e.message ? e.message : String(e)));
      return;
    }

    if (!pages || pages.length === 0) {
      this._renderEmpty(dv);
      return;
    }

    if (groupBy === "type") {
      return this._renderGroupedByType(dv, pages);
    }
    if (groupBy === "month") {
      return this._renderGroupedByMonth(dv, pages);
    }
    return this._renderFlat(dv, pages);
  }

  // ── Reverse query ──────────────────────────────────────────────────────────

  /**
   * Reverse-query the canonical cross-ref key against the current entity page.
   * Returns up to `limit` pages sorted by `sortBy`.
   * @param {object} dv
   * @param {string} key  — the canonical key name (e.g. "people")
   * @param {string} sortBy
   * @param {number} limit
   * @returns {Array}
   */
  _reverseQuery(dv, key, sortBy, limit) {
    const currentFile = dv.current() && dv.current().file;
    if (!currentFile || !currentFile.path) return [];
    const currentPath = currentFile.path;

    const chain = dv.pages()
      .where((p) => {
        if (!p) return false;
        const val = p[key];
        if (!val || typeof val.some !== "function") return false;
        return val.some((link) => link && link.path === currentPath);
      });

    const sorted = (sortBy === "title")
      ? chain.sort((p) => p && p.file && p.file.name, "asc")
      : chain.sort((p) => {
          const fm = p || {};
          // Prefer canonical created_at; fall back to file.cday for unmigrated notes.
          return fm.created_at || (p && p.file && p.file.cday) || "";
        }, "desc");

    const sliced = sorted.slice(0, limit);
    return Array.isArray(sliced)
      ? sliced
      : (sliced && typeof sliced.length === "number" ? Array.from(sliced) : []);
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  _renderEmpty(dv) {
    const p = dv.container.createEl("p");
    p.style.cssText = "color: var(--text-muted); font-style: italic; margin: 0.5em 0;";
    p.textContent = "No mentions yet.";
  }

  _renderFlat(dv, pages) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("BacklinkPanel: cards mechanism (BeaconCards) unavailable");
      return;
    }
    return customJS.BeaconCards.render(dv, {
      pages,
      layout: "row",
      title: (p) => p && p.file && p.file.name,
      meta: (p) => (p && p.type) ? String(p.type) : "",
    });
  }

  _renderGroupedByType(dv, pages) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("BacklinkPanel: cards mechanism (BeaconCards) unavailable");
      return;
    }
    const groups = new Map();
    for (const p of pages) {
      const t = (p && p.type) ? String(p.type) : "(untyped)";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(p);
    }
    const sortedKeys = Array.from(groups.keys()).sort();
    for (const t of sortedKeys) {
      const h = dv.container.createEl("h4");
      h.textContent = t;
      h.style.cssText = "margin: 0.8em 0 0.3em 0;";
      customJS.BeaconCards.render(dv, {
        pages: groups.get(t),
        layout: "row",
        title: (p) => p && p.file && p.file.name,
      });
    }
  }

  _renderGroupedByMonth(dv, pages) {
    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("BacklinkPanel: cards mechanism (BeaconCards) unavailable");
      return;
    }
    const groups = new Map();
    for (const p of pages) {
      const created = (p && p.created_at) ? String(p.created_at) : "";
      const month = created.length >= 7 ? created.slice(0, 7) : "(undated)";
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month).push(p);
    }
    // Sort months descending (most recent first); undated last.
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === "(undated)") return 1;
      if (b === "(undated)") return -1;
      return b.localeCompare(a);
    });
    for (const m of sortedKeys) {
      const h = dv.container.createEl("h4");
      h.textContent = m;
      h.style.cssText = "margin: 0.8em 0 0.3em 0;";
      customJS.BeaconCards.render(dv, {
        pages: groups.get(m),
        layout: "row",
        title: (p) => p && p.file && p.file.name,
        meta: (p) => (p && p.type) ? String(p.type) : "",
      });
    }
  }

  // ── Constants ──────────────────────────────────────────────────────────────

  get _ENTITY_TYPE_TO_KEY() {
    return {
      person:  "people",
      project: "projects",
      team:    "teams",
      product: "products",
      trip:    "trips",
      meeting: "meetings",
    };
  }
}
