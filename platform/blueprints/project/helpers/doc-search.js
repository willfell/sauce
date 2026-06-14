class DocSearch {
  /**
   * Renders the filter UI + returns a filterContext consumable by ProjectDocsIndex / SectionHub.
   *
   * @param dv  Dataview
   * @param opts {
   *   projectSlug: string,        // for scoped-search button
   *   scopePath: string,          // e.g. "spice/projects/global-k8s/docs" or ".../knowledge"
   *   recursive: boolean,         // true for Docs.md; false for Section Hub leaf
   *   onChange: (ctx) => void     // re-render callback
   * }
   * @returns initial filterContext { text: "", tags: [], hasActiveFilter: false }
   */
  render(dv, opts) {
    const allDocs = dv.pages(`"${opts.scopePath}"`).where(p => p.type === "doc-note");
    const tagCounts = this._countTags(allDocs);
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);

    const container = dv.el("div", "", { cls: "doc-search-strip" });
    container.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin: 8px 0;";

    const ctx = { text: "", tags: new Set(), hasActiveFilter: false };

    // Row 1: input + scoped-search button
    const row1 = container.createEl("div");
    row1.style.cssText = "display: flex; gap: 8px; align-items: center;";
    const input = row1.createEl("input", { attr: { type: "text", placeholder: "Filter docs by title, tags, or content…" } });
    input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";

    const nativeBtn = row1.createEl("button", { text: "🔎 Search" });
    nativeBtn.style.cssText = "padding: 6px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: transparent; color: var(--interactive-accent); font-size: 0.85em;";
    nativeBtn.title = "Open Obsidian native search scoped to this folder";
    nativeBtn.addEventListener("click", () => {
      const query = `path:"${opts.scopePath}" `;
      app.commands.executeCommandById("global-search:open");
      setTimeout(() => {
        const searchInput = document.querySelector(".workspace-leaf-content[data-type='search'] input[type='search']");
        if (searchInput) { searchInput.value = query; searchInput.dispatchEvent(new Event("input")); }
      }, 100);
    });

    // Row 2: tag chips
    let chipsRow = null;
    if (topTags.length > 0) {
      chipsRow = container.createEl("div");
      chipsRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px;";
      for (const tag of topTags) {
        const chip = chipsRow.createEl("span", { text: `#${tag}` });
        chip.style.cssText = "padding: 2px 8px; border-radius: 10px; background: var(--background-modifier-active-hover); color: var(--text-muted); font-size: 0.78em; cursor: pointer; user-select: none;";
        chip.addEventListener("click", () => {
          if (ctx.tags.has(tag)) {
            ctx.tags.delete(tag);
            chip.style.background = "var(--background-modifier-active-hover)";
            chip.style.color = "var(--text-muted)";
          } else {
            ctx.tags.add(tag);
            chip.style.background = "var(--interactive-accent)";
            chip.style.color = "var(--text-on-accent)";
          }
          this._updateActive(ctx);
          opts.onChange?.(ctx);
        });
      }
    }

    // Row 3: status pill (only when active)
    const statusRow = container.createEl("div");
    statusRow.style.cssText = "font-size: 0.78em; color: var(--text-muted); min-height: 1em;";

    input.addEventListener("input", () => {
      ctx.text = input.value.trim();
      this._updateActive(ctx);
      const totalDocCount = allDocs.length;
      if (ctx.hasActiveFilter) {
        statusRow.textContent = `Filtering: "${ctx.text}"${ctx.tags.size > 0 ? " + " + Array.from(ctx.tags).map(t => `#${t}`).join(" ") : ""}`;
      } else {
        statusRow.textContent = "";
      }
      opts.onChange?.(ctx);
    });

    return ctx;
  }

  _countTags(pages) {
    const counts = {};
    for (const p of pages) {
      const tags = Array.isArray(p.tags) ? p.tags : (p.file?.tags || []);
      for (const t of tags) {
        const clean = String(t).replace(/^#/, "");
        if (!clean || clean === "doc-note") continue;
        counts[clean] = (counts[clean] || 0) + 1;
      }
    }
    return counts;
  }

  _updateActive(ctx) {
    ctx.hasActiveFilter = ctx.text.length > 0 || ctx.tags.size > 0;
  }

  /**
   * Pure-function matcher used by consumers. Given a doc page + filterContext, returns true if doc matches.
   *
   * v0.104.0.1 PATCH — was declared with the class-level keyword in
   * v0.104.0, but customJS stores INSTANCES of helper classes, not the
   * classes themselves. The class-level access path therefore resolved to
   * `undefined.call` and threw "Evaluation Error" inside every `.where(...)`
   * predicate on Docs.md and Section Hub. The keyword is removed so matches
   * is reachable via `customJS.DocSearch.matches(p, ctx)`.
   */
  matches(page, ctx) {
    if (!ctx || !ctx.hasActiveFilter) return true;
    if (ctx.text) {
      const needle = ctx.text.toLowerCase();
      const name = (page.file?.name || "").toLowerCase();
      const tagList = (Array.isArray(page.tags) ? page.tags : (page.file?.tags || [])).map(t => String(t).toLowerCase());
      const tagText = tagList.join(" ");
      if (!name.includes(needle) && !tagText.includes(needle)) return false;
    }
    if (ctx.tags && ctx.tags.size > 0) {
      const tagList = (Array.isArray(page.tags) ? page.tags : (page.file?.tags || [])).map(t => String(t).replace(/^#/, ""));
      for (const required of ctx.tags) {
        if (!tagList.includes(required)) return false;
      }
    }
    return true;
  }
}
