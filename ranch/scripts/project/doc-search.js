class DocSearch {
  /**
   * Renders the filter UI as a PERMANENT strip + returns a filterContext with a
   * SEPARATE resultsContainer for consumers to render into.
   *
   * v0.105.0 Issue 6 refactor — the prior implementation re-rendered the entire
   * dv container on every keystroke (consumer onChange emptied dv container +
   * re-invoked render). That deleted the input element mid-keypress, so the
   * browser lost the keystroke + focus. The fix is two-container: the strip
   * (input + chips + status pill) is built once and never rebuilt; consumers
   * write cards/headers into ctx.resultsContainer and clear ONLY that container
   * on filter change. The input element keeps focus + value across keystrokes.
   *
   * v0.105.0 Issue 9: the prior magnifying-glass emoji on the Search button is
   * replaced by an inline SVG icon (lucide search head).
   *
   * @param dv  Dataview
   * @param opts {
   *   projectSlug: string,        // for scoped-search button
   *   scopePath: string,          // e.g. "spice/projects/global-k8s/docs" or ".../knowledge"
   *   recursive: boolean,         // true for Docs.md; false for Section Hub leaf
   *   onChange: (ctx) => void     // re-render callback — consumer should clear
   *                                  ONLY ctx.resultsContainer (not dv.container)
   *                                  and re-fill it.
   * }
   * @returns initial filterContext { text: "", tags: Set, hasActiveFilter: false, resultsContainer }
   */
  render(dv, opts) {
    const allDocs = dv.pages(`"${opts.scopePath}"`).where(p => p.type === "doc-note");
    const tagCounts = this._countTags(allDocs);
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);

    // PERMANENT strip — built once, never rebuilt. Survives keystrokes.
    const stripContainer = dv.container.createEl("div", { cls: "doc-search-strip" });
    stripContainer.style.cssText = "display: flex; flex-direction: column; gap: 6px; margin: 8px 0;";

    // Inline SVG search icon (v0.105.0 Issue 9 — replaces the prior emoji).
    const searchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>`;

    // Row 1: input + scoped-search button
    const row1 = stripContainer.createEl("div");
    row1.style.cssText = "display: flex; gap: 8px; align-items: center;";
    const input = row1.createEl("input", { attr: { type: "text", placeholder: "Filter docs by title, tags, or content…" } });
    input.style.cssText = "flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal);";

    const nativeBtn = row1.createEl("button");
    nativeBtn.innerHTML = `${searchIcon} Search`;
    nativeBtn.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: transparent; color: var(--interactive-accent); font-size: 0.85em;";
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
      chipsRow = stripContainer.createEl("div");
      chipsRow.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px;";
    }

    // Row 3: status pill (only when active)
    const statusRow = stripContainer.createEl("div");
    statusRow.style.cssText = "font-size: 0.78em; color: var(--text-muted); min-height: 1em;";

    // SEPARATE results container — consumer fills + clears this. Strip stays.
    const resultsContainer = dv.container.createEl("div", { cls: "doc-search-results" });

    const ctx = { text: "", tags: new Set(), hasActiveFilter: false, resultsContainer };

    // Now wire tag-chip listeners (need ctx before binding).
    if (chipsRow) {
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
          if (ctx.hasActiveFilter) {
            statusRow.textContent = `Filtering: "${ctx.text}"${ctx.tags.size > 0 ? " + " + Array.from(ctx.tags).map(t => `#${t}`).join(" ") : ""}`;
          } else {
            statusRow.textContent = "";
          }
          // Clear ONLY the results container; the strip stays intact.
          resultsContainer.empty();
          opts.onChange?.(ctx);
        });
      }
    }

    input.addEventListener("input", () => {
      ctx.text = input.value.trim();
      this._updateActive(ctx);
      if (ctx.hasActiveFilter) {
        statusRow.textContent = `Filtering: "${ctx.text}"${ctx.tags.size > 0 ? " + " + Array.from(ctx.tags).map(t => `#${t}`).join(" ") : ""}`;
      } else {
        statusRow.textContent = "";
      }
      // Clear ONLY the results container; the strip (and the input element) stays.
      resultsContainer.empty();
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
