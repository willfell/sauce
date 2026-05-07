/**
 * people-rendering@0.1.0 — shared CustomJS rendering helpers for People notes.
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. `customJS.BeaconCards` is read at call-time, never at class-load.
 *
 * Public API (LITERAL signatures):
 *   renderChip(parent, personLink, opts) → HTMLSpanElement
 *   renderCard(dv, personLink, opts) → void
 *   renderMentionList(dv, query, opts) → void | Promise<void>
 *   extractMentions(markdownBody, opts) → Array<{display, target}>
 *
 * Per landmine #19 + #11: spice/people/ path-prefix is hardcoded; never
 * parameterized. Module-directory invariant.
 */
class PeopleRendering {
  /**
   * Render a single Person as an inline chip (name + hover tooltip).
   * @param {HTMLElement} parent
   * @param {string} personLink — wikilink "[[First Last]]" or path "spice/people/First Last.md"
   * @param {object} [opts]
   * @param {boolean} [opts.openOnClick=true]
   * @param {string}  [opts.tooltipFields="company,title"]
   * @returns {HTMLSpanElement}
   */
  renderChip(parent, personLink, opts) {
    opts = opts || {};
    const openOnClick = opts.openOnClick !== false;
    const tooltipFieldsStr = typeof opts.tooltipFields === "string" && opts.tooltipFields.length > 0
      ? opts.tooltipFields
      : "company,title";
    const tooltipFields = tooltipFieldsStr.split(",").map(s => s.trim()).filter(Boolean);

    const linkpath = this._stripWikilink(personLink);
    const file = (app && app.metadataCache && typeof app.metadataCache.getFirstLinkpathDest === "function")
      ? app.metadataCache.getFirstLinkpathDest(linkpath, "")
      : null;

    const span = parent.createEl("span");

    if (!file) {
      span.cls = "bp-chip-missing";
      span.className = "bp-chip-missing";
      span.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 4px; font-size: 0.85em; color: var(--text-error); background: rgba(220, 38, 38, 0.08); border: 1px solid rgba(220, 38, 38, 0.35); cursor: pointer;";
      span.textContent = linkpath;
      span.title = "Unknown person: " + linkpath;
      span.onclick = () => { new Notice("Unknown person: " + linkpath); };
      return span;
    }

    // Resolved — read frontmatter sync (no await).
    const cache = (app.metadataCache && typeof app.metadataCache.getFileCache === "function")
      ? app.metadataCache.getFileCache(file)
      : null;
    const fm = (cache && cache.frontmatter) || {};

    // Build display text (mobile-aware: initials when narrow).
    const isNarrow = (typeof window !== "undefined" && window.innerWidth && window.innerWidth < 600)
      || (app && app.isMobile === true);
    const displayText = isNarrow ? this._initialsOf(linkpath) : linkpath;

    // Tooltip = full name · field1 · field2 ...
    const tooltipParts = [linkpath];
    for (const k of tooltipFields) {
      const v = fm[k];
      if (v !== undefined && v !== null && String(v).length > 0) tooltipParts.push(String(v));
    }
    const tooltip = tooltipParts.join(" · ");

    span.cls = "bp-chip";
    span.className = "bp-chip";
    span.style.cssText = "display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 4px; font-size: 0.85em; color: var(--text-normal); background: var(--background-secondary); border: 1px solid var(--background-modifier-border); cursor: pointer;";
    span.textContent = displayText;
    span.title = tooltip;

    if (openOnClick) {
      span.onclick = () => {
        if (app && app.workspace && typeof app.workspace.openLinkText === "function") {
          app.workspace.openLinkText(linkpath, "");
        }
      };
    }
    return span;
  }

  /**
   * Render a single Person as a BeaconCards row card via synthetic page.
   * @param {object} dv
   * @param {string} personLink
   * @param {object} [opts]
   * @returns {void}
   */
  renderCard(dv, personLink, opts) {
    opts = opts || {};
    const linkpath = this._stripWikilink(personLink);
    const file = (app && app.metadataCache && typeof app.metadataCache.getFirstLinkpathDest === "function")
      ? app.metadataCache.getFirstLinkpathDest(linkpath, "")
      : null;
    if (!file) {
      new Notice("Unknown person: " + linkpath);
      return;
    }

    const cache = (app.metadataCache && typeof app.metadataCache.getFileCache === "function")
      ? app.metadataCache.getFileCache(file)
      : null;
    const fm = (cache && cache.frontmatter) || {};

    const syntheticPage = Object.assign({}, fm, {
      file: {
        name: linkpath,
        path: file.path,
        link: { path: file.path, type: "file", display: linkpath },
      },
    });

    if (!customJS || !customJS.BeaconCards || typeof customJS.BeaconCards.render !== "function") {
      new Notice("PeopleRendering.renderCard: BeaconCards mechanism unavailable");
      return;
    }

    const renderOpts = Object.assign({
      layout: "row",
      title: (p) => p.file && p.file.name,
      meta: (p) => p.company || "",
      subtitle: (p) => p.title || null,
    }, opts, {
      pages: [syntheticPage],
    });

    // Fire-and-forget — renderCard itself is sync.
    customJS.BeaconCards.render(dv, renderOpts);
  }

  /**
   * Render notes mentioning a person OR people mentioned in a note.
   * @param {object} dv
   * @param {object} query — {mode, personLink?, scopePath?, notePath?}
   * @param {object} [opts] — {style: "chips"|"cards"|"list", limit, sortBy}
   * @returns {void | Promise<void>}
   */
  renderMentionList(dv, query, opts) {
    query = query || {};
    opts = opts || {};
    const style = opts.style || "chips";
    const limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 50;
    const sortBy = opts.sortBy || "cday";

    if (query.mode === "mentioning_person") {
      return this._renderMentioningPerson(dv, query, { style, limit, sortBy });
    }
    if (query.mode === "mentioned_in_note") {
      return this._renderMentionedInNote(dv, query, { style, limit });
    }
    new Notice("PeopleRendering.renderMentionList: unknown mode " + JSON.stringify(query.mode));
  }

  _renderMentioningPerson(dv, query, opts) {
    const linkpath = this._stripWikilink(query.personLink || "");
    const dest = (app && app.metadataCache && typeof app.metadataCache.getFirstLinkpathDest === "function")
      ? app.metadataCache.getFirstLinkpathDest(linkpath, "")
      : null;
    const resolvedPath = dest && dest.path ? dest.path : null;
    const scopePath = query.scopePath || "";
    const quotedScope = '"' + scopePath + '"';

    const chain = dv.pages(quotedScope)
      .where((p) => {
        if (!resolvedPath) return false;
        const outlinks = p && p.file && p.file.outlinks;
        if (!outlinks || typeof outlinks.some !== "function") return false;
        return outlinks.some((l) => l && l.path === resolvedPath);
      })
      .sort((p) => p && p.file && p.file[opts.sortBy], "desc")
      .slice(0, opts.limit);

    const pages = Array.isArray(chain)
      ? chain
      : (chain && typeof chain.length === "number" ? Array.from(chain) : []);

    if (opts.style === "cards") {
      if (customJS && customJS.BeaconCards && typeof customJS.BeaconCards.render === "function") {
        return customJS.BeaconCards.render(dv, {
          pages,
          layout: "row",
          title: (p) => p && p.file && p.file.name,
        });
      }
      new Notice("PeopleRendering: BeaconCards unavailable");
      return;
    }
    if (opts.style === "list") {
      const items = pages.map((p) => (p && p.file && (p.file.link || p.file.name)) || "");
      if (typeof dv.list === "function") dv.list(items);
      return;
    }
    // default: chips
    const row = dv.container.createEl("div");
    row.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px;";
    for (const p of pages) {
      const name = (p && p.file && p.file.name) || "";
      if (name) this.renderChip(row, "[[" + name + "]]");
    }
  }

  async _renderMentionedInNote(dv, query, opts) {
    const notePath = query.notePath;
    if (!notePath) {
      new Notice("PeopleRendering: mentioned_in_note requires notePath");
      return;
    }
    let body = "";
    try {
      body = await app.vault.adapter.read(notePath);
    } catch (e) {
      new Notice("PeopleRendering: failed to read " + notePath);
      return;
    }
    const mentions = this.extractMentions(body);
    const limited = mentions.slice(0, opts.limit);

    if (opts.style === "cards") {
      if (customJS && customJS.BeaconCards && typeof customJS.BeaconCards.render === "function") {
        const pages = limited.map((m) => ({ file: { name: m.display, path: m.target } }));
        return customJS.BeaconCards.render(dv, {
          pages,
          layout: "row",
          title: (p) => p.file && p.file.name,
        });
      }
      return;
    }
    if (opts.style === "list") {
      const items = limited.map((m) => "[[" + m.display + "]]");
      if (typeof dv.list === "function") dv.list(items);
      return;
    }
    // default: chips into a single flex-wrap row
    const row = dv.container.createEl("div");
    row.style.cssText = "display: flex; flex-wrap: wrap; gap: 6px;";
    for (const m of limited) {
      this.renderChip(row, "[[" + m.display + "]]");
    }
  }

  /**
   * Extract [[Person]] wikilinks from markdown body, filter to spice/people/.
   * @param {string} markdownBody
   * @param {object} [opts]
   * @param {boolean} [opts.unique=true]
   * @returns {Array<{display: string, target: string}>}
   */
  extractMentions(markdownBody, opts) {
    opts = opts || {};
    const unique = opts.unique !== false;
    const body = typeof markdownBody === "string" ? markdownBody : "";

    const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    const out = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(body)) !== null) {
      const linkpath = m[1].trim();
      if (!linkpath) continue;
      const dest = (app && app.metadataCache && typeof app.metadataCache.getFirstLinkpathDest === "function")
        ? app.metadataCache.getFirstLinkpathDest(linkpath, "")
        : null;
      if (!dest || !dest.path) continue;
      if (!dest.path.startsWith("spice/people/")) continue;
      if (unique && seen.has(dest.path)) continue;
      seen.add(dest.path);
      out.push({ display: linkpath, target: dest.path });
    }
    return out;
  }

  // ── Internals ────────────────────────────────────────────────────────────
  _stripWikilink(raw) {
    if (typeof raw !== "string") return "";
    let s = raw.trim();
    if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
    // Drop |alias suffix.
    const pipe = s.indexOf("|");
    if (pipe >= 0) s = s.slice(0, pipe);
    // Drop #anchor suffix.
    const hash = s.indexOf("#");
    if (hash >= 0) s = s.slice(0, hash);
    // If a path was passed (e.g. "spice/people/First Last.md"), strip dir + .md.
    if (s.endsWith(".md")) s = s.slice(0, -3);
    const slash = s.lastIndexOf("/");
    if (slash >= 0) s = s.slice(slash + 1);
    return s.trim();
  }

  _initialsOf(name) {
    const parts = String(name).split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
