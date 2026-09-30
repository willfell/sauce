/**
 * GraphView — read-only epic dependency-graph widget for the project blueprint.
 *
 * Two scopes, one widget:
 *
 * Epic scope (default, mounted on the epic atlas beside EpicDashboard via the
 * standard customjs-guard block): gathers type:slice direct children of the
 * atlas's sibling board/ directory (the same folder-is-authoritative logic as
 * EpicDashboard._slicePages), reads lane order from the epic board note's
 * "## In Planning" / "## In Progress"  // lint-display-markers:allow doc comment names the real lane headings _laneOrder anchors on
 * checklist wikilinks, delegates ALL layout to customJS.GraphLayout, and
 * delegates status presentation (Delivery lifecycle API + the shared
 * EpicDashboard status-color buckets) — no duplicated color table, no
 * reimplemented ranking.
 *
 * Project scope ({ scope: "project" }, mounted on the Loop Station note via
 * customjs-guard args — the parent board is a kanban-plugin view that cannot
 * host dataviewjs): resolves the sibling <project>-board.md, renders each
 * live epic (In Planning / In Progress / Blocked lanes) as a labeled cluster
 * of its board/ slices (per-cluster GraphLayout, clusters stacked vertically,
 * epic-name header linking to the atlas), draws cross-epic depends_on edges
 * between chips in different clusters, outlines the active claim named in the
 * Loop Station's own frontmatter, and collapses Completed-lane epics to one
 * done-chip each. The Archive section and anything below the kanban archive
 * divider never render. An epic whose atlas or board note is missing becomes
 * a warning-strip entry, never a throw or a blank station.
 *
 * Rendering: a horizontally scrollable canvas with an SVG edge layer (solid
 * arrowed strokes for kind "depends", dashed low-opacity strokes for kind
 * "order") under positioned DOM chips (columns = rank, rows = row). At epic
 * scope columns are per-rank auto-width (widest chip content in the rank,
 * clamped to [minCol, maxCol]) and the canvas is sized to the last column's
 * right edge plus pad, so nothing clips at rest. With GraphInsights available,
 * a first chip tap selects its full chain and opens inline detail; a second tap
 * opens the card, while an empty-canvas tap restores the exact at-rest graph.
 * The title wraps to two lines before any ellipsis, an info line shows
 * the colored lifecycle status word plus the inline wait reason ("needs <dep>"
 * for blocked, resume_condition start for parked), and the hover tooltip
 * carries the card's Outcome sentence. Layout warnings render as one compact
 * strip row each under the graph; empty warnings render nothing.
 *
 * Phone-first (PH-1): every render resolves a container width once —
 * explicit containerWidth mount arg, then the measured note scroll container,
 * then the Obsidian is-mobile body class when the measurement is not a
 * finite positive number, then wide — and at epic scope, under 600px, draws
 * a compact map of the SAME frozen layout result: one 26px pill per slice or
 * cross-epic stub in per-rank columns sized by a pure formula, with the same
 * edge layer, filter toolbar, legend, and selection controller. Both maps
 * open the same inline detail card under the map / canvas. A presentation is
 * the wide map, or the compact map at the width it was measured at (or drawn
 * from an unmeasured guess).
 * Live pane resize (PH-9c): the measured width is the content width of the
 * note's scroll container (the closest .markdown-preview-view or
 * .cm-scroller at or around the mount container), or the mount container's
 * client width when there is no scroll container or no computed style to
 * read (see _resolveWidth). An epic-scope render that was not pinned by a
 * containerWidth arg, and that finishes with its root still in the mount
 * container, watches that scroll container (or the mount container when none
 * is found) with one resize observer, where the resize-observer API exists
 * and observe() succeeds, as a trigger only: each notification, unless the
 * watch is gone, re-resolves the same measurement; one that resolves a
 * different measured presentation (re)starts a 120ms debounce, which, unless
 * the watch is gone, re-resolves again and re-renders if and only if the
 * measured presentation still differs; a measured one that resolves the
 * drawn presentation cancels anything pending. The last measurement wins. An unmeasured resolution keeps the drawn presentation
 * and arms one re-check 250ms later; a re-check that is still unmeasured
 * waits for the next notification. The watch disconnects when the container
 * renders again, and at its next notification, debounce or re-check after
 * its root has left the mount container or the container has left the
 * scroll container it watches (where the mutation-observer API exists, root
 * removal is also seen at the watch's next childList record; see
 * _watchPaneWidth). At rest the wide presentation's DOM is byte-identical to
 * the pre-PH-1 renderer's; the detail card a chip tap opens (at both scopes)
 * now labels its open button "Open slice" instead of "Open card" and adds a
 * "Close" button.
 *
 * Fail-soft everywhere: gather/layout/render failures degrade to warning rows
 * or unknown-style chips — the widget never throws, never blanks the note,
 * never writes to the vault, and never calls the coordinator. A compact-map
 * failure falls back to the wide path plus one warning row.
 */
class GraphView {
  constructor(options = {}) {
    this._injectedLifecycleApi = options.lifecycleApi || null;
    this._injectedLayout = options.layout || null;
    this._injectedDashboard = options.dashboard || null;
    this._injectedInsights = options.insights || null;
    this._scope = options.scope || "epic";
  }

  _app() {
    try { return typeof app !== "undefined" ? app : globalThis.app; } catch (_e) { return null; }
  }

  _renderSectionChrome(dv, root) {
    try {
      const SL = globalThis.customJS?.SectionLabel;
      if (typeof SL?.divider === "function" && typeof SL?.render === "function") {
        SL.divider(root);
        SL.render({ ...dv, container: root }, { text: "Dependency Graph", top: true });
        return;
      }
    } catch (_e) {}
    root.createEl("div", { text: "Dependency Graph" });
  }

  _dashboard() {
    if (this._injectedDashboard) return this._injectedDashboard;
    try { return globalThis.customJS?.EpicDashboard || null; } catch (_e) { return null; }
  }

  _graphLayout() {
    if (this._injectedLayout) return this._injectedLayout;
    try { return globalThis.customJS?.GraphLayout || null; } catch (_e) { return null; }
  }

  _graphInsights() {
    if (this._injectedInsights) return this._injectedInsights;
    try { return globalThis.customJS?.GraphInsights || null; } catch (_e) { return null; }
  }

  // GraphInsights is the sole owner of transitive semantics. GraphView only
  // delegates the drawn graph and consumes the returned per-node membership.
  // Missing, throwing, or malformed analysis is optional UI sugar: the graph
  // remains byte-identical to its pre-insights rendering with no warning row.
  _analyzeGraph(nodes, edges) {
    try {
      const insights = this._graphInsights();
      if (typeof insights?.analyzeGraph !== "function") return null;
      const analysis = insights.analyzeGraph(nodes, edges);
      if (!analysis || typeof analysis !== "object"
        || !analysis.perNode || typeof analysis.perNode !== "object"
        || !analysis.summary || typeof analysis.summary !== "object") return null;
      return analysis;
    } catch (_e) { return null; }
  }

  _renderStuckSummary(root, analysis) {
    const summary = analysis?.summary;
    if (!summary || Number(summary.stuckCount) <= 0) return;
    const rootCount = Array.isArray(summary.rootBlockers) ? summary.rootBlockers.length : 0;
    const gatedTotal = Number.isFinite(Number(summary.gatedTotal)) ? Number(summary.gatedTotal) : 0;
    const row = root.createEl("div", {
      text: `${rootCount} root blocker${rootCount === 1 ? "" : "s"}`
        + ` · gating ${gatedTotal} slice${gatedTotal === 1 ? "" : "s"}`,
    });
    row.className = "graph-view-stuck-summary";
    row.setAttribute?.("aria-label", "Graph blocking summary");
    row.style.cssText = "color:var(--text-error);font-size:0.75em;font-weight:650;margin-bottom:8px;";
  }

  _nodeInsight(analysis, card) {
    try {
      return Object.prototype.hasOwnProperty.call(analysis?.perNode || {}, card)
        ? analysis.perNode[card]
        : null;
    } catch (_e) { return null; }
  }

  async _lifecycleApi() {
    if (this._injectedLifecycleApi) return this._injectedLifecycleApi;
    try { return (await this._dashboard()?._deliveryApi?.()) || null; } catch (_e) { return null; }
  }

  _epicPaths(currentPath, currentFolder = "") {
    if (currentFolder) {
      const epicDir = String(currentFolder).replace(/\\/g, "/").replace(/\/$/, "");
      return { epicDir, boardDir: `${epicDir}/board` };
    }
    const normalized = String(currentPath || "").replace(/\\/g, "/");
    const epicDir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    return { epicDir, boardDir: `${epicDir}/board` };
  }

  _frontmatter(file) {
    try { return this._app()?.metadataCache?.getFileCache(file)?.frontmatter || {}; }
    catch (_e) { return {}; }
  }

  // Honest gather (GV-R1): a slice whose status maps to an archived/discarded
  // (excluded) lifecycle bucket is dead lineage — it must contribute neither a
  // chip nor a warning, so it is dropped from the gather BEFORE layout at BOTH
  // scopes. The delivery lifecycle API is authoritative for aliased discarded
  // statuses; `archived` is not a registry status (it normalizes to null like
  // any unknown token) so it is treated as excluded explicitly.
  _isExcludedStatus(rawStatus, api) {
    const raw = String(rawStatus == null ? "" : rawStatus).trim().toLowerCase().replace(/^['"]|['"]$/g, "");
    if (raw === "archived" || raw === "discarded") return true;
    try {
      if (api?.normalizeStatus && api.normalizeStatus(rawStatus) === "discarded") return true;
    } catch (_e) {}
    return false;
  }

  _slicePages(currentPath, currentFolder = "", api = null) {
    const { boardDir } = this._epicPaths(currentPath, currentFolder);
    const prefix = boardDir + "/";
    try {
      return (this._app()?.vault?.getMarkdownFiles?.() || [])
        .filter((file) => file.path.startsWith(prefix)
          && !file.path.slice(prefix.length).includes("/")
          && this._frontmatter(file).type === "slice"
          && !this._isExcludedStatus(this._frontmatter(file).status, api))
        .map((file) => ({
          ...this._frontmatter(file),
          card: file.basename,
          name: file.basename,
          file: { path: file.path, name: file.basename, mtime: file.stat?.mtime || 0 },
        }))
        .sort((left, right) => String(left.file.name).localeCompare(String(right.file.name)));
    } catch (_e) { return []; }
  }

  // Cross-epic dangling → linkable ghost stub (GV-R1, epic scope). The layout
  // core only sees the current epic's slices, so a depends_on onto a slice
  // owned by ANOTHER epic surfaces as a dangling_dependency warning. Mirror the
  // project-scope precedent — but resolve the target across cards_root (the
  // other epic's slices are not in this gather): if the target card NAME
  // resolves to a type:slice under cards_root in a DIFFERENT epic, replace the
  // warning with one small ghost external-stub node + a depends edge into it;
  // a target that resolves nowhere stays exactly one dangling warning.
  _applyCrossEpicStubs(result, currentPath, currentFolder) {
    try {
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      const nodes = Array.isArray(result?.nodes) ? result.nodes.slice() : [];
      const edges = Array.isArray(result?.edges) ? result.edges.slice() : [];
      const { epicDir, boardDir } = this._epicPaths(currentPath, currentFolder);
      const cardsRoot = epicDir.includes("/") ? epicDir.slice(0, epicDir.lastIndexOf("/")) : "";
      const stubRank = nodes.length ? Math.max(...nodes.map((node) => node.rank || 0)) + 1 : 0;
      const stubbed = new Map();
      const kept = [];
      for (const warning of warnings) {
        if (warning?.code === "dangling_dependency") {
          const resolved = this._resolveCrossEpicStub(warning.detail, boardDir, cardsRoot);
          if (resolved) {
            if (!stubbed.has(warning.detail)) {
              const parts = this._titleParts(warning.detail);
              nodes.push({
                card: warning.detail,
                path: resolved.path,
                status: null,
                rank: stubRank,
                row: stubbed.size,
                isStub: true,
                stubLabel: `${resolved.epicName} · ${parts.id || warning.detail}`,
              });
              stubbed.set(warning.detail, true);
            }
            edges.push({ from: warning.detail, to: warning.card, kind: "depends", cross: true });
            continue;
          }
        }
        kept.push(warning);
      }
      return { nodes, edges, warnings: kept };
    } catch (_e) {
      return result;
    }
  }

  _resolveCrossEpicStub(target, currentBoardDir, cardsRoot) {
    try {
      const name = String(target == null ? "" : target).trim();
      if (!name || !cardsRoot) return null;
      const prefix = cardsRoot + "/";
      const marker = "/board/";
      for (const file of this._app()?.vault?.getMarkdownFiles?.() || []) {
        if (file.basename !== name) continue;
        const path = String(file.path || "").replace(/\\/g, "/");
        if (!path.startsWith(prefix)) continue;
        const at = path.indexOf(marker);
        if (at < 0) continue;
        if (path.slice(at + marker.length).includes("/")) continue; // direct board child only
        const fileBoardDir = path.slice(0, at + marker.length - 1);
        if (fileBoardDir === currentBoardDir) continue; // must be a DIFFERENT epic
        if (this._frontmatter(file).type !== "slice") continue;
        return { epicName: path.slice(0, at).split("/").pop() || "", path: file.path };
      }
      return null;
    } catch (_e) { return null; }
  }

  async _laneOrder(currentPath, currentFolder = "") {
    try {
      const { epicDir, boardDir } = this._epicPaths(currentPath, currentFolder);
      const name = epicDir.split("/").pop();
      const boardPath = `${boardDir}/${name}-board.md`;
      const appRef = this._app();
      const file = (appRef?.vault?.getMarkdownFiles?.() || [])
        .find((entry) => entry.path === boardPath);
      const read = appRef?.vault?.cachedRead || appRef?.vault?.read;
      if (!file || typeof read !== "function") return [];
      const body = await read.call(appRef.vault, file);
      const lanes = ["In Planning", "In Progress"];
      const names = [];
      let active = false;
      for (const line of String(body || "").split(/\r?\n/)) {
        const heading = line.match(/^##\s+(.*?)\s*$/);
        if (heading) { active = lanes.includes(heading[1]); continue; }
        if (!active) continue;
        for (const match of line.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)) {
          const cardName = match[1].replace(/\.md$/i, "").trim();
          if (cardName && !names.includes(cardName)) names.push(cardName);
        }
      }
      return names;
    } catch (_e) { return []; }
  }

  _statusPresentation(rawStatus, api) {
    try {
      const dashboard = this._dashboard();
      if (dashboard?._statusPresentation) return dashboard._statusPresentation(rawStatus, api);
    } catch (_e) {}
    return {
      normalized: null,
      label: `unrecognized: ${String(rawStatus == null ? "" : rawStatus).trim() || "(missing)"}`,
      color: "var(--text-muted)",
      glyph: "",
      className: "status-unrecognized",
    };
  }

  // Present-status-only legend. Entries are deduped by the shared lifecycle
  // presentation identity in deterministic draw order; stubs have no status
  // and therefore never manufacture a legend entry.
  _renderLegend(root, nodes, api) {
    const entries = [];
    const seen = new Set();
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node?.isStub) continue;
      const presentation = this._statusPresentation(node?.status, api);
      const key = presentation.normalized || presentation.label;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(presentation);
    }
    if (!entries.length) return;
    const legend = root.createEl("div");
    legend.className = "graph-view-legend";
    legend.setAttribute?.("aria-label", "Graph status legend");
    legend.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:8px 0 0;font-size:0.7em;";
    for (const presentation of entries) {
      const entry = legend.createEl("span");
      entry.className = `graph-view-legend-entry ${presentation.className}`;
      entry.style.cssText = `display:inline-flex;align-items:center;gap:4px;color:${presentation.color};`;
      const glyph = entry.createEl("span", { text: presentation.glyph });
      glyph.className = "graph-view-legend-glyph";
      glyph.setAttribute?.("aria-hidden", "true");
      const label = entry.createEl("span", { text: presentation.label });
      label.className = "graph-view-legend-label";
    }
  }

  _titleParts(value) {
    try {
      const dashboard = this._dashboard();
      if (dashboard?._titleParts) return dashboard._titleParts(value);
    } catch (_e) {}
    return { id: null, title: String(value || "") };
  }

  _open(path, source) {
    try { this._app()?.workspace?.openLinkText?.(String(path || "").replace(/\.md$/, ""), source || "", false); }
    catch (_e) {}
  }

  _truncate(value, max = 60) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  }

  _warningText(warning) {
    const card = String(warning?.card || "");
    const detail = String(warning?.detail || "");
    switch (String(warning?.code || "")) {
      case "dangling_dependency": return `${card}: depends on a card that doesn't exist: '${detail}'`;
      case "self_dependency": return `${card}: depends on itself`;
      case "unreadable_slice": return `${card}: slice state unreadable: '${detail}'`;
      case "missing_epic": return `${card}: epic atlas or board note is missing: '${detail}'`;
      case "missing_board": return `${card}: parent board note is missing: '${detail}'`;
      default: return `${card}${card && detail ? ": " : ""}${detail}`;
    }
  }

  _renderWarnings(root, warnings) {
    const rows = (warnings || []).filter(Boolean);
    if (!rows.length) return;
    const strip = root.createEl("div");
    strip.className = "graph-view-warnings";
    strip.style.cssText = "display:grid;gap:4px;margin-top:16px;padding:2px 0;";
    for (const warning of rows) {
      const row = strip.createEl("div", { text: this._warningText(warning) });
      row.className = `graph-view-warning warning-${String(warning.code || "unknown").replace(/_/g, "-")}`;
      row.style.cssText = "color:var(--color-orange);font-size:var(--font-ui-smaller);overflow-wrap:anywhere;";
    }
  }

  // Edge endpoints bind to each chip's OWN width now (per-column auto-width at
  // epic scope). from.w / to.w carry the chip's rendered width; project scope's
  // fixed-geometry positions omit w and fall back to the shared geometry.chipW,
  // so project-scope edge math is byte-identical to before.
  _edgeMarkup(edges, positions, geometry, chain) {
    const paths = [];
    for (const edge of edges || []) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const fromW = from.w != null ? from.w : geometry.chipW;
      const fromH = from.h != null ? from.h : geometry.chipH;
      const toH = to.h != null ? to.h : geometry.chipH;
      let d;
      if (from.x === to.x) {
        const x = from.x + fromW / 2;
        d = `M ${x} ${from.y + fromH} L ${x} ${to.y}`;
      } else {
        const x1 = from.x + fromW;
        const y1 = from.y + fromH / 2;
        const x2 = to.x;
        const y2 = to.y + toH / 2;
        const bend = Math.max(24, (x2 - x1) / 2);
        d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      }
      const emphasized = edge.kind === "depends" && chain?.has(edge.from) && chain?.has(edge.to);
      paths.push(edge.kind === "depends"
        ? `<path class="graph-view-edge edge-depends${edge.cross ? " edge-cross-epic" : ""}${emphasized ? " graph-view-chain-edge" : ""}" d="${d}" fill="none" stroke="var(--text-muted)" stroke-width="${emphasized ? "2.5" : "1.5"}" marker-end="url(#graph-view-arrow)"/>`
        : `<path class="graph-view-edge edge-order" d="${d}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.55"/>`);
    }
    return paths.join("");
  }

  _edgeSvg(width, height, edges, positions, geometry, chain) {
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><marker id="graph-view-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
      + '<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-muted)"/></marker></defs>'
      + this._edgeMarkup(edges, positions, geometry, chain)
      + "</svg>";
  }

  _setClass(element, name, enabled) {
    if (!element) return;
    const names = String(element.className || "").split(/\s+/).filter(Boolean);
    const next = names.filter((entry) => entry !== name);
    if (enabled) next.push(name);
    element.className = next.join(" ");
  }

  _panelLink(parent, node, api, source, className) {
    const link = parent.createEl("button");
    link.className = className;
    link.style.cssText = "display:inline-flex;align-items:center;gap:5px;justify-self:start;width:max-content;max-width:100%;"
      + "padding:3px 8px;border:1px solid var(--background-modifier-border);border-radius:999px;"
      + "background:var(--background-primary);color:var(--link-color);cursor:pointer;text-align:left;overflow-wrap:anywhere;";
    const parts = this._titleParts(node.card);
    const presentation = this._statusPresentation(node.status, api);
    link.createEl("span", { text: parts.id || node.card }).className = "graph-view-detail-link-id";
    link.createEl("span", { text: ` · ${presentation.glyph} ${presentation.label}` }).className = "graph-view-detail-link-status";
    link.addEventListener?.("click", (event) => {
      event?.stopPropagation?.();
      this._open(node.path || node.card, source);
    });
    return link;
  }

  _panelFact(panel, label, className) {
    const block = panel.createEl("div");
    block.className = `graph-view-detail-fact ${className}`;
    block.style.cssText = "display:grid;gap:4px;min-width:0;";
    const heading = block.createEl("div", { text: label });
    heading.className = "graph-view-detail-label";
    heading.style.cssText = "font-size:0.7em;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);";
    return block;
  }

  _renderDetailPanel(root, scroller, node, nodes, edges, analysis, api, source, outcomes, onClose) {
    const panel = root.createEl("div");
    panel.className = "graph-view-detail-panel";
    panel.style.cssText = "display:grid;gap:12px;margin-top:16px;padding:12px 14px;border:1px solid var(--background-modifier-border);"
      + "border-radius:9px;background:var(--background-secondary);font-size:var(--font-ui-small);";
    const legend = Array.from(root.children || [])
      .find((child) => String(child?.className || "").split(/\s+/).includes("graph-view-legend"));
    root.insertBefore?.(panel, legend?.nextSibling || scroller?.nextSibling || null);

    const parts = this._titleParts(node.card);
    const header = panel.createEl("div");
    header.className = "graph-view-detail-header";
    header.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:10px;min-width:0;";
    const heading = header.createEl("div");
    heading.className = "graph-view-detail-heading";
    heading.style.cssText = "display:flex;align-items:baseline;gap:7px;min-width:0;font-weight:700;overflow-wrap:anywhere;";
    heading.createEl("span", { text: parts.id || node.card }).className = "graph-view-detail-id";
    if (parts.id) heading.createEl("span", { text: parts.title }).className = "graph-view-detail-title";

    const controls = header.createEl("div");
    controls.className = "graph-view-detail-controls";
    controls.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;";
    if (!node.isStub) {
      const presentation = this._statusPresentation(node.status, api);
      const status = controls.createEl("div", { text: `${presentation.glyph} ${presentation.label}` });
      status.className = `graph-view-detail-status ${presentation.className}`;
      status.style.cssText = "display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;"
        + `color:${presentation.color};font-weight:650;white-space:nowrap;`
        + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
        + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`;
    }
    const open = controls.createEl("button", { text: "Open slice" });
    open.className = "graph-view-detail-open";
    open.style.cssText = "min-height:32px;padding:5px 10px;cursor:pointer;";
    open.addEventListener?.("click", (event) => {
      event?.stopPropagation?.();
      this._open(node.path || node.card, source);
    });
    if (typeof onClose === "function") {
      const close = controls.createEl("button", { text: "Close" });
      close.className = "graph-view-detail-close";
      close.style.cssText = "min-height:32px;padding:5px 10px;cursor:pointer;";
      close.addEventListener?.("click", (event) => {
        event?.stopPropagation?.();
        onClose();
      });
    }
    if (node.isStub) return panel;

    if (node.waitReason) {
      const waiting = this._panelFact(panel, "Waiting on", "graph-view-detail-wait-row");
      const value = waiting.createEl("div", { text: String(node.waitReason) });
      value.className = "graph-view-detail-wait";
      value.style.cssText = "overflow-wrap:anywhere;";
    }

    const byCard = new Map((nodes || []).map((entry) => [entry.card, entry]));
    const unmet = (edges || [])
      .filter((edge) => edge.kind === "depends" && edge.to === node.card)
      .map((edge) => byCard.get(edge.from))
      .filter((entry) => entry && (entry.isStub || this._statusPresentation(entry.status, api).normalized !== "completed"));
    if (unmet.length) {
      const needs = this._panelFact(panel, "Unmet prerequisites", "graph-view-detail-needs");
      for (const entry of unmet) this._panelLink(needs, entry, api, source, "graph-view-detail-prerequisite");
    }

    const outcome = outcomes?.get?.(node.card);
    if (outcome) {
      const result = this._panelFact(panel, "Outcome", "graph-view-detail-outcome");
      const value = result.createEl("div", { text: String(outcome) });
      value.className = "graph-view-detail-outcome-value";
      value.style.cssText = "overflow-wrap:anywhere;";
    }

    const insight = this._nodeInsight(analysis, node.card);
    const gated = (Array.isArray(insight?.downstream) ? insight.downstream : [])
      .map((card) => byCard.get(card))
      .filter((entry) => entry && !entry.isStub && entry.status !== null
        && String(entry.status).trim().toLowerCase() !== "completed");
    const gatedCount = Number.isFinite(Number(insight?.gates)) ? Number(insight.gates) : 0;
    const gates = this._panelFact(panel, "Gates", "graph-view-detail-gates");
    const count = gates.createEl("div", { text: `${gatedCount} slice${gatedCount === 1 ? "" : "s"}` });
    count.className = "graph-view-detail-gates-count";
    for (const entry of gated) this._panelLink(gates, entry, api, source, "graph-view-detail-dependent");
    return panel;
  }

  // Inline detail card (PH-1): the one labeled-rows builder above, mounted as
  // an inline element right after the host's legend — under the compact map
  // on narrow widths, under the canvas on wide — on both presentations. Never
  // a body-fixed sheet: that fights the reading-view scroller and the
  // ghost-click guard, and the popover primitive is for menus only.
  _renderDetailInline(host, node, context) {
    const ctx = context && typeof context === "object" ? context : {};
    return this._renderDetailPanel(host, ctx.scroller, node, ctx.nodes, ctx.edges, ctx.analysis,
      ctx.api, ctx.source, ctx.outcomes, ctx.onClose);
  }

  // Stuck filtering consumes GraphInsights closures only. For every root/stuck
  // pair, nodes on a connecting path are exactly the root's downstream closure
  // intersected with the stuck node's upstream closure. GraphView performs set
  // arithmetic over those supplied memberships and never walks the graph.
  _stuckKeepSet(nodes, analysis) {
    const stuck = new Set((nodes || [])
      .filter((node) => !node?.isStub && ["blocked", "parked"].includes(String(node?.status || "").trim().toLowerCase()))
      .map((node) => node.card));
    const roots = (Array.isArray(analysis?.summary?.rootBlockers) ? analysis.summary.rootBlockers : [])
      .filter((card) => typeof card === "string" && card);
    const keep = new Set([...stuck, ...roots]);
    for (const root of roots) {
      const below = new Set(this._nodeInsight(analysis, root)?.downstream || []);
      for (const blocked of stuck) {
        if (blocked !== root && !below.has(blocked)) continue;
        const above = new Set(this._nodeInsight(analysis, blocked)?.upstream || []);
        for (const card of below) if (card === blocked || above.has(card)) keep.add(card);
      }
    }
    return keep;
  }

  // Selection and filters, plus project-cluster focus, live only in this
  // render's closure. Selection wins wholesale while active; clearing it reapplies the
  // current filter/focus union. Cluster focus keeps the selected epic plus the
  // direct partner at either end of every cross-epic edge at full strength.
  _selectionController({
    root, scroller, canvas, nodes, edges, analysis, api, source, outcomes, renderEdges, clusterByCard = null,
  }) {
    const chips = new Map();
    const headers = new Map();
    let selected = null;
    let focusedCluster = null;
    let panel = null;
    const filters = { stuck: false, dimDone: false };
    const buttons = {};
    const setDimmed = (record, dimmed) => {
      this._setClass(record.chip, "graph-view-dimmed", dimmed);
      record.chip.style.cssText = record.cssText
        + (dimmed ? "opacity:0.28;filter:saturate(0.45);" : "");
    };
    const updateButtons = () => {
      for (const [key, button] of Object.entries(buttons)) {
        const active = filters[key] === true;
        this._setClass(button, "graph-view-filter-active", active);
        button.setAttribute?.("aria-pressed", active ? "true" : "false");
      }
    };
    const updateHeaders = () => {
      for (const [cluster, header] of headers) {
        const active = focusedCluster === cluster;
        this._setClass(header, "graph-view-cluster-focused", active);
        header.setAttribute?.("aria-pressed", active ? "true" : "false");
      }
    };
    const focusedKeepSet = () => {
      if (focusedCluster === null || !clusterByCard) return null;
      const base = new Set((nodes || [])
        .filter((node) => clusterByCard.get(node.card) === focusedCluster)
        .map((node) => node.card));
      const keep = new Set(base);
      for (const edge of edges || []) {
        if (!edge?.cross || (!base.has(edge.from) && !base.has(edge.to))) continue;
        keep.add(edge.from);
        keep.add(edge.to);
      }
      return keep;
    };
    const applyFilters = () => {
      updateButtons();
      updateHeaders();
      if (selected !== null) return;
      const keep = filters.stuck ? this._stuckKeepSet(nodes, analysis) : null;
      const focused = focusedKeepSet();
      for (const [card, record] of chips) {
        const completed = this._statusPresentation(record.node.status, api).normalized === "completed";
        setDimmed(record, (filters.stuck && !keep.has(card))
          || (filters.dimDone && completed)
          || (focused && !focused.has(card)));
      }
      renderEdges(null);
    };
    const clear = () => {
      selected = null;
      focusedCluster = null;
      panel?.remove?.();
      panel = null;
      applyFilters();
    };
    const select = (node, event) => {
      event?.stopPropagation?.();
      if (selected === node.card) {
        this._open(node.path || node.card, source);
        return;
      }
      selected = node.card;
      panel?.remove?.();
      const insight = this._nodeInsight(analysis, node.card);
      const chain = new Set([node.card, ...(insight?.upstream || []), ...(insight?.downstream || [])]);
      for (const [card, record] of chips) {
        setDimmed(record, !chain.has(card));
      }
      renderEdges(chain);
      panel = this._renderDetailInline(root, node, {
        scroller, nodes, edges, analysis, api, source, outcomes, onClose: clear,
      });
    };
    const focus = (cluster, path, event) => {
      event?.stopPropagation?.();
      if (focusedCluster === cluster) {
        this._open(path, source);
        return;
      }
      selected = null;
      panel?.remove?.();
      panel = null;
      focusedCluster = cluster;
      applyFilters();
    };
    canvas.addEventListener?.("click", clear);
    return {
      register(node, chip) { chips.set(node.card, { node, chip, cssText: chip?.style?.cssText || "" }); },
      registerHeader(cluster, header) {
        headers.set(cluster, header);
        header.setAttribute?.("aria-pressed", focusedCluster === cluster ? "true" : "false");
      },
      renderToolbar: () => {
        const toolbar = root.createEl("div");
        toolbar.className = "graph-view-filter-toolbar";
        toolbar.setAttribute?.("aria-label", "Graph filters");
        toolbar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;";
        root.insertBefore?.(toolbar, scroller);
        for (const [key, label, className] of [
          ["stuck", "Stuck", "graph-view-filter-stuck"],
          ["dimDone", "Dim done", "graph-view-filter-done"],
        ]) {
          const button = toolbar.createEl("button", { text: label });
          button.className = `graph-view-filter-toggle ${className}`;
          button.setAttribute?.("type", "button");
          button.setAttribute?.("aria-pressed", "false");
          button.style.cssText = "min-height:32px;padding:5px 12px;border-radius:999px;cursor:pointer;"
            + "border:1px solid var(--background-modifier-border);background:var(--background-secondary);";
          button.addEventListener?.("click", (event) => {
            event?.stopPropagation?.();
            // Stuck is meaningful only with GraphInsights' authoritative root
            // and closure memberships. On the fail-soft path keep the visible
            // toolbar structurally unchanged, but make this toggle a no-op;
            // approximating from local statuses can hide connecting chains.
            // BL5B-FAIL-SOFT-GUARD: the independent contract sentinel binds
            // this authority boundary as well as the behavioral harness.
            if (key === "stuck" && !analysis) return;
            filters[key] = !filters[key];
            applyFilters();
          });
          buttons[key] = button;
        }
        updateButtons();
        return toolbar;
      },
      select: analysis ? select : null,
      focus: clusterByCard ? focus : null,
      clear,
    };
  }

  // GV-R2 epic-scope geometry: per-rank auto-width columns. Each rank's column
  // width is the widest chip content in that rank (deterministic text formula,
  // NOT a live-DOM measure — the harness is headless), clamped to [minCol,
  // maxCol]. Column x-offset accumulates prior column widths plus an inter-column
  // gap; a chip's width is its column's width. Vertical geometry is also
  // deterministic: each chip height comes from full title lines plus at most
  // two wait lines, each row takes its tallest chip, and row tops accumulate
  // those heights plus rowGap. No live DOM measurement participates.
  async _renderGraph(root, result, api, source, extraWarnings) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    if (!nodes.length) return;
    const edges = Array.isArray(result?.edges) ? result.edges : [];
    const analysis = this._analyzeGraph(nodes, edges);
    this._renderStuckSummary(root, analysis);
    const geometry = {
      chipH: 56, pad: 12, colGap: 28, rowGap: 18, chipW: 172,
      widthCharPx: 7, titleGlyphPx: 13, titleFontPx: 12, infoFontPx: 11,
      hPad: 18, minCol: 120, maxCol: 260,
      titleLineH: 15, infoLineH: 13, padY: 7, contentGap: 3, scrollbarAllowance: 14,
      maxCharsPerLine: Math.floor((260 - 18) / 7),
    };
    const ranks = [...new Set(nodes.map((node) => node.rank || 0))].sort((left, right) => left - right);
    const colWidth = new Map();
    for (const node of nodes) {
      const rank = node.rank || 0;
      const desired = this._chipContentWidth(node, geometry);
      colWidth.set(rank, Math.max(colWidth.get(rank) || geometry.minCol, desired));
    }
    const colX = new Map();
    let cursorX = geometry.pad;
    for (const rank of ranks) { colX.set(rank, cursorX); cursorX += colWidth.get(rank) + geometry.colGap; }
    const lastRank = ranks[ranks.length - 1];
    const rows = this._rowGeometry(nodes, (node) => colWidth.get(node.rank || 0), geometry, geometry.pad);
    const positions = new Map(nodes.map((node) => {
      const rank = node.rank || 0;
      return [node.card, {
        x: colX.get(rank), y: rows.tops.get(node.row || 0),
        w: colWidth.get(rank), h: this._chipHeight(node, colWidth.get(rank), geometry),
      }];
    }));
    const width = colX.get(lastRank) + colWidth.get(lastRank) + geometry.pad;
    const height = rows.bottom + geometry.pad;
    const outcomes = await this._loadOutcomes(nodes);
    const scroller = root.createEl("div");
    scroller.className = "graph-view-scroll";
    scroller.style.cssText = `overflow-x:auto;overflow-y:hidden;max-width:100%;padding-bottom:${geometry.scrollbarAllowance}px;box-sizing:content-box;`;
    const canvas = scroller.createEl("div");
    canvas.className = "graph-view-canvas";
    canvas.style.cssText = `position:relative;width:${width}px;height:${height}px;margin-inline:auto;`;
    const edgeLayer = canvas.createEl("div");
    edgeLayer.className = "graph-view-edges";
    edgeLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    const renderEdges = (chain) => { edgeLayer.innerHTML = this._edgeSvg(width, height, edges, positions, geometry, chain); };
    renderEdges(null);
    const interaction = this._selectionController({
      root, scroller, canvas, nodes, edges, analysis, api, source, outcomes, renderEdges,
    });
    interaction.renderToolbar();
    for (const node of nodes) {
      const chip = node.isStub
        ? this._renderStub(canvas, node, positions.get(node.card), geometry, source, interaction?.select)
        : this._renderChip(canvas, node, positions.get(node.card), geometry, api, source, extraWarnings,
          null, outcomes, this._nodeInsight(analysis, node.card), interaction?.select);
      interaction?.register(node, chip);
    }
    this._renderLegend(root, nodes, api);
  }

  // Deterministic chip-content width (headless-safe): word-wrap the complete
  // chip title at the maximum column budget and size to its longest line.
  // Nothing is visually clamped; width alone remains bounded to [minCol,maxCol].
  _chipContentWidth(node, geometry) {
    const text = node.isStub ? (node.stubLabel || node.card || "") : (node.card || "");
    const { longest } = this._wrapTitle(text, geometry.maxCharsPerLine);
    const raw = longest * geometry.widthCharPx + geometry.hPad;
    return Math.min(geometry.maxCol, Math.max(geometry.minCol, raw));
  }

  // Greedy full-title word wrap. Oversized words split at the same character
  // budget as CSS overflow-wrap:anywhere, so geometry cannot undercount lines.
  _wrapTitle(text, maxChars) {
    const limit = Math.max(1, Number(maxChars) || 1);
    const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const sourceWord of words) {
      let word = sourceWord;
      if (word.length > limit) {
        if (line) { lines.push(line); line = ""; }
        while (word.length > limit) {
          lines.push(word.slice(0, limit));
          word = word.slice(limit);
        }
      }
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= limit || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const longest = lines.reduce((max, entry) => Math.max(max, entry.length), 0);
    return { lines: lines.length ? lines : [""], longest };
  }

  _chipHeight(node, chipW, geometry) {
    if (node?.isStub) return geometry.chipH;
    const parts = this._titleParts(node?.card);
    // Height uses a deliberately conservative 13px glyph cell at an explicit
    // 12px rendered font. This safely contains even repeated wide proportional
    // glyphs (the width-sizing model remains the established 7px average).
    const idBudget = parts.id ? parts.id.length * geometry.titleGlyphPx + 5 : 0;
    const perLineChars = Math.max(1,
      Math.floor((chipW - geometry.hPad - idBudget) / geometry.titleGlyphPx));
    const titleLines = this._wrapTitle(parts.title, perLineChars).lines.length;
    const waitText = this._waitInfo(node);
    // Any wait may visually occupy its full two-line clamp. Reserving both
    // exact info line boxes avoids another average-glyph estimate entirely.
    const waitLines = waitText ? 2 : 1;
    return Math.max(geometry.chipH,
      geometry.padY * 2 + titleLines * geometry.titleLineH
      + geometry.contentGap + waitLines * geometry.infoLineH);
  }

  _rowGeometry(nodes, widthForNode, geometry, startY) {
    const rowNodes = new Map();
    for (const node of nodes || []) {
      const row = Number(node?.row) || 0;
      if (!rowNodes.has(row)) rowNodes.set(row, []);
      rowNodes.get(row).push(node);
    }
    const tops = new Map();
    const heights = new Map();
    let cursor = startY;
    for (const row of [...rowNodes.keys()].sort((left, right) => left - right)) {
      const height = Math.max(...rowNodes.get(row).map((node) => this._chipHeight(node, widthForNode(node), geometry)));
      tops.set(row, cursor);
      heights.set(row, height);
      cursor += height + geometry.rowGap;
    }
    const last = [...rowNodes.keys()].sort((left, right) => left - right).at(-1);
    return { tops, heights, bottom: last == null ? startY : tops.get(last) + heights.get(last) };
  }

  // Info-line wait text: a blocked slice (waitReason "waiting on: X, Y") shows
  // "needs <first-dep-id>"; a parked slice's waitReason is the complete
  // resume_condition (visual wrapping is bounded in _renderChip). Null when
  // the node is neither.
  _waitInfo(node) {
    const reason = node && node.waitReason;
    if (reason == null || String(reason).trim() === "") return null;
    const text = String(reason);
    const blocked = text.match(/^\s*waiting on:\s*(.+)$/i);
    if (blocked) {
      const firstDep = blocked[1].split(",")[0].trim();
      return `needs ${this._titleParts(firstDep).id || firstDep}`;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  // Outcome tooltip source (epic scope, READ-ONLY, fail-soft): read each slice's
  // note body and extract the first sentence under its "## Outcome" heading via
  // cachedRead. Any failure (missing file, unreadable, no Outcome section) is
  // swallowed per node — the chip falls back to its full title and the render
  // never blocks or throws.
  async _loadOutcomes(nodes) {
    const map = new Map();
    try {
      const appRef = this._app();
      const read = appRef?.vault?.cachedRead || appRef?.vault?.read;
      if (typeof read !== "function") return map;
      const files = appRef?.vault?.getMarkdownFiles?.() || [];
      const byPath = new Map(files.map((file) => [file.path, file]));
      for (const node of nodes) {
        if (!node || node.isStub) continue;
        const path = node.path || (node.file && node.file.path) || null;
        const file = path ? byPath.get(path) : null;
        if (!file) continue;
        try {
          const body = await read.call(appRef.vault, file);
          const sentence = this._extractOutcome(body);
          if (sentence) map.set(node.card, sentence);
        } catch (_e) { /* fail-soft per node */ }
      }
    } catch (_e) { /* fail-soft: outcomes are optional tooltip sugar */ }
    return map;
  }

  _extractOutcome(body) {
    const buffer = [];
    let inOutcome = false;
    for (const line of String(body == null ? "" : body).split(/\r?\n/)) {
      const heading = line.match(/^#{2,3}\s+(.*?)\s*$/);
      if (heading) {
        if (/^outcome$/i.test(heading[1].trim())) { inOutcome = true; continue; }
        if (inOutcome) break;
        continue;
      }
      if (!inOutcome) continue;
      if (line.trim()) buffer.push(line.trim());
      else if (buffer.length) break;
    }
    const text = buffer.join(" ").trim();
    if (!text) return null;
    const sentence = text.match(/^(.*?[.!?])(?:\s|$)/);
    return (sentence ? sentence[1] : text).trim() || null;
  }

  // Ghost external stub (GV-R1): a muted, dashed, selectable chip standing in
  // for a cross-epic prerequisite. Its detail panel degrades to its heading
  // plus the Open slice and Close buttons. It is not a slice, so it never
  // routes through status presentation and never emits an unreadable-slice
  // warning.
  _renderStub(canvas, node, at, geometry, source, onSelect) {
    const chipW = at && at.w != null ? at.w : geometry.chipW;
    const chip = canvas.createEl("div");
    chip.className = "graph-view-chip graph-view-stub";
    chip.style.cssText =
      `position:absolute;left:${at.x}px;top:${at.y}px;width:${chipW}px;height:${at.h || geometry.chipH}px;`
      + "display:flex;flex-direction:column;gap:3px;justify-content:center;padding:7px 9px;border-radius:9px;"
      + "cursor:pointer;box-sizing:border-box;color:var(--text-muted);opacity:0.75;"
      + "border:1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent);"
      + "background:color-mix(in srgb, var(--text-muted) 6%, var(--background-primary));";
    chip.addEventListener?.("click", (event) => onSelect
      ? onSelect(node, event)
      : this._open(node.path || node.card, source));
    const label = chip.createEl("div", { text: node.stubLabel || String(node.card || "") });
    label.className = "graph-view-stub-label";
    label.style.cssText = "min-width:0;font-size:0.72em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    return chip;
  }

  _renderChip(canvas, node, at, geometry, api, source, extraWarnings, activeCard, outcomes, insight, onSelect) {
    const presentation = this._statusPresentation(node.status, api);
    if (!presentation.normalized) {
      extraWarnings.push({
        code: "unreadable_slice",
        card: node.card,
        detail: String(node.status == null ? "(missing)" : node.status),
      });
    }
    const active = activeCard != null && node.card === activeCard;
    const chipW = at && at.w != null ? at.w : geometry.chipW;
    const parts = this._titleParts(node.card);
    const chip = canvas.createEl("div");
    chip.className = `graph-view-chip ${presentation.className}`
      + `${active ? " graph-view-active" : ""}`;
    chip.style.cssText =
      `position:absolute;left:${at.x}px;top:${at.y}px;width:${chipW}px;height:${at.h || this._chipHeight(node, chipW, geometry)}px;`
      + "display:flex;flex-direction:column;gap:3px;justify-content:center;padding:7px 9px;border-radius:9px;"
      + `cursor:pointer;box-sizing:border-box;color:${presentation.color};`
      + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
      + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`
      + (active ? "outline:2px solid var(--interactive-accent);outline-offset:2px;" : "");
    // Outcome sentence in the hover tooltip; fall back to the full card title.
    const outcome = outcomes && typeof outcomes.get === "function" ? outcomes.get(node.card) : null;
    chip.setAttribute?.("title", String(outcome || node.card || ""));
    chip.addEventListener?.("click", (event) => onSelect
      ? onSelect(node, event)
      : this._open(node.path || node.card, source));
    const titleRow = chip.createEl("div");
    titleRow.className = "graph-view-chip-title";
    titleRow.style.cssText = `display:flex;align-items:baseline;gap:5px;min-width:0;line-height:${geometry.titleLineH}px;`;
    if (parts.id) {
      const id = titleRow.createEl("span", { text: parts.id });
      id.className = "graph-view-chip-id";
      id.style.cssText = "flex:none;font-family:var(--font-monospace);font-size:0.72em;font-weight:600;opacity:0.85;";
    }
    // Title wraps in full. Its deterministic line count is the same input used
    // by _chipHeight, so the absolute chip box always contains every line.
    const title = titleRow.createEl("span", { text: parts.title });
    title.className = "graph-view-chip-name";
    title.style.cssText = `min-width:0;font-size:${geometry.titleFontPx}px;font-weight:600;white-space:normal;overflow-wrap:anywhere;`;
    // Info line: the shared lifecycle glyph + colored status WORD (no local
    // presentation table) plus the inline wait reason.
    const info = chip.createEl("div");
    info.className = "graph-view-chip-info";
    info.style.cssText = `display:flex;align-items:flex-start;gap:5px;min-width:0;font-size:${geometry.infoFontPx}px;line-height:${geometry.infoLineH}px;`;
    const glyph = info.createEl("span", { text: presentation.glyph });
    glyph.className = `graph-view-status-glyph ${presentation.className}`;
    glyph.setAttribute?.("aria-hidden", "true");
    glyph.style.cssText = `flex:none;font-weight:700;color:${presentation.color};`;
    const word = info.createEl("span", { text: presentation.label });
    word.className = `graph-view-status-word ${presentation.className}`;
    word.style.cssText = `flex:none;font-weight:600;color:${presentation.color};`;
    const waitText = this._waitInfo(node);
    if (waitText) {
      const wait = info.createEl("span", { text: waitText });
      wait.className = "graph-view-wait";
      wait.setAttribute?.("title", String(node.waitReason || ""));
      wait.style.cssText = "min-width:0;color:var(--text-muted);display:-webkit-box;-webkit-box-orient:vertical;"
        + "-webkit-line-clamp:2;overflow:hidden;text-overflow:ellipsis;white-space:normal;overflow-wrap:anywhere;";
    }
    if (insight?.isRootBlocker === true) {
      const gates = Number.isFinite(Number(insight.gates)) ? Number(insight.gates) : 0;
      const badge = info.createEl("span", { text: `gates ${gates}` });
      badge.className = "graph-view-gates-badge";
      badge.style.cssText = "flex:none;margin-left:auto;padding:1px 5px;border-radius:999px;"
        + "font-size:0.9em;font-weight:700;color:var(--text-error);"
        + "border:1px solid color-mix(in srgb, var(--text-error) 45%, transparent);"
        + "background:color-mix(in srgb, var(--text-error) 10%, var(--background-primary));";
    }
    return chip;
  }

  // ---- PH-1 phone-first: compact map (epic scope, narrow widths) ----
  // Deterministic geometry (its one outside read is the shared _titleParts id
  // parser) over the frozen GraphLayout result. One column per rank:
  // colW = clamp(floor((W - 2*pad - (R-1)*gap) / R), 40, 140); pill height
  // 26, row gap 8, pad 2, gap 10. Ids drop their shared alphabetic prefix
  // (through the dash, GA-ML8 -> ML8) only when colW < 72 AND every id shares
  // that prefix. When even 40px pills cannot fit (R*40 + (R-1)*gap + 2*pad >
  // W) the canvas keeps its natural width and the map scrolls sideways — the
  // documented, warning-free fallback. No DOM measurement happens here: the
  // width arrives as an argument (render()'s resolved width in production, a
  // literal in the harness).
  _compactGeometry(nodes, ranks, width) {
    const W = Number(width);
    if (!Number.isFinite(W) || W <= 0) throw new Error(`compact geometry needs a positive width, got ${String(width)}`);
    const list = Array.isArray(nodes) ? nodes : [];
    const order = Array.isArray(ranks) && ranks.length
      ? ranks.slice()
      : [...new Set(list.map((node) => node?.rank || 0))].sort((left, right) => left - right);
    const R = Math.max(1, order.length);
    const pad = 2;
    const gap = 10;
    const pillH = 26;
    const rowGap = 8;
    const minCol = 40;
    const maxCol = 140;
    const shortIdBelow = 72;
    const colW = Math.min(maxCol, Math.max(minCol, Math.floor((W - 2 * pad - (R - 1) * gap) / R)));
    const scrolls = R * minCol + (R - 1) * gap + 2 * pad > W;
    const natural = R * colW + (R - 1) * gap + 2 * pad;
    const colX = new Map(order.map((rank, index) => [rank, pad + index * (colW + gap)]));
    const rowCount = list.reduce((max, node) => Math.max(max, (Number(node?.row) || 0) + 1), 0);
    const canvasHeight = 2 * pad + rowCount * pillH + Math.max(0, rowCount - 1) * rowGap;
    const positions = new Map(list.map((node) => [node.card, {
      x: colX.get(node?.rank || 0),
      y: pad + (Number(node?.row) || 0) * (pillH + rowGap),
      w: colW,
      h: pillH,
    }]));
    const labels = this._compactLabels(list, colW < shortIdBelow);
    return {
      width: W, ranks: R, pad, gap, pillH, rowGap, minCol, maxCol, shortIdBelow,
      colW, scrolls, natural, canvasWidth: natural, canvasHeight,
      shortIds: labels.shortened, labels: labels.byCard, colX, positions,
      chipW: colW, chipH: pillH, scrollbarAllowance: scrolls ? 14 : 0,
    };
  }

  // Short-id rule: strip the alphabetic prefix through the dash only when the
  // columns are narrow AND every id carries the same prefix; a set whose
  // prefixes differ (or a node without a parseable id) keeps full ids.
  _compactLabels(nodes, narrowColumns) {
    const entries = (nodes || []).map((node) => ({ card: node?.card, id: this._titleParts(node?.card).id }));
    let prefix = null;
    let shared = entries.length > 0;
    for (const entry of entries) {
      const match = entry.id ? entry.id.match(/^([A-Z]+)-(.+)$/) : null;
      if (!match || (prefix !== null && match[1] !== prefix)) { shared = false; break; }
      prefix = match[1];
    }
    const shortened = narrowColumns === true && shared;
    const byCard = new Map(entries.map((entry) => [entry.card,
      shortened ? entry.id.slice(prefix.length + 1) : (entry.id || String(entry.card == null ? "" : entry.card))]));
    return { shortened, byCard };
  }

  async _renderCompactGraph(root, result, api, source, warnings, width) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    if (!nodes.length) return null;
    const ranks = [...new Set(nodes.map((node) => node.rank || 0))].sort((left, right) => left - right);
    const geometry = this._compactGeometry(nodes, ranks, width);
    return this._renderCompactMap(root, result, api, source, warnings, geometry);
  }

  // The compact map is a second presentation of the same layout: the stuck
  // summary, the existing filter toolbar, the existing SVG edge layer over
  // positioned pills, and the existing legend, all inside one host so the
  // inline detail card mounts under the map. Selection registers pills as
  // chips, so Stuck / Dim done, chain highlight, two-tap open, and the
  // canvas-tap deselect are the wide path's behaviors verbatim.
  async _renderCompactMap(root, result, api, source, warnings, geometry) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    const edges = Array.isArray(result?.edges) ? result.edges : [];
    const analysis = this._analyzeGraph(nodes, edges);
    const host = root.createEl("div");
    host.className = "graph-view-compact";
    host.style.cssText = "display:grid;gap:0;min-width:0;max-width:100%;";
    this._renderStuckSummary(host, analysis);
    const outcomes = await this._loadOutcomes(nodes);
    const scroller = host.createEl("div");
    scroller.className = "graph-view-scroll graph-view-compact-scroll";
    scroller.style.cssText = `overflow-x:auto;overflow-y:hidden;max-width:100%;padding-bottom:${geometry.scrollbarAllowance}px;box-sizing:content-box;`;
    const canvas = scroller.createEl("div");
    canvas.className = "graph-view-canvas graph-view-compact-canvas";
    canvas.style.cssText = `position:relative;width:${geometry.canvasWidth}px;height:${geometry.canvasHeight}px;`;
    const edgeLayer = canvas.createEl("div");
    edgeLayer.className = "graph-view-edges";
    edgeLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    const renderEdges = (chain) => {
      edgeLayer.innerHTML = this._edgeSvg(geometry.canvasWidth, geometry.canvasHeight, edges, geometry.positions, geometry, chain);
    };
    renderEdges(null);
    const interaction = this._selectionController({
      root: host, scroller, canvas, nodes, edges, analysis, api, source, outcomes, renderEdges,
    });
    interaction.renderToolbar();
    for (const node of nodes) {
      const pill = this._renderPill(canvas, node, geometry, api, source, warnings, interaction?.select);
      interaction?.register(node, pill);
    }
    this._renderLegend(host, nodes, api);
    return host;
  }

  // One id pill per slice or cross-epic stub (an id-less node shows its full
  // card name): the shared status class, colour, and glyph come from
  // _statusPresentation (no local table); stubs are dashed and muted; stuck
  // (blocked / parked) pills carry a 2px error hairline on the left; parked
  // slice pills carry the graph-view-needs-you class (no stylesheet styles it
  // yet). A slice pill's tooltip is its full card name, a stub's its epic · id
  // label; the detail card carries the Outcome.
  _renderPill(canvas, node, geometry, api, source, warnings, onSelect) {
    const at = geometry.positions.get(node.card)
      || { x: geometry.pad, y: geometry.pad, w: geometry.colW, h: geometry.pillH };
    const label = geometry.labels.get(node.card) ?? String(node.card == null ? "" : node.card);
    const pill = canvas.createEl("div");
    const base = `position:absolute;left:${at.x}px;top:${at.y}px;width:${at.w}px;height:${at.h}px;`
      + "display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;box-sizing:border-box;"
      + "cursor:pointer;min-width:0;font-family:var(--font-monospace);font-size:11px;font-weight:600;";
    if (node.isStub) {
      pill.className = "graph-view-chip graph-view-pill graph-view-stub";
      pill.style.cssText = base + "color:var(--text-muted);opacity:0.75;"
        + "border:1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent);"
        + "background:color-mix(in srgb, var(--text-muted) 6%, var(--background-primary));";
      pill.setAttribute?.("title", String(node.stubLabel || node.card || ""));
    } else {
      const presentation = this._statusPresentation(node.status, api);
      if (!presentation.normalized) {
        warnings.push({
          code: "unreadable_slice",
          card: node.card,
          detail: String(node.status == null ? "(missing)" : node.status),
        });
      }
      const stuck = ["blocked", "parked"].includes(presentation.normalized);
      const needsYou = presentation.normalized === "parked";
      pill.className = `graph-view-chip graph-view-pill ${presentation.className}${needsYou ? " graph-view-needs-you" : ""}`;
      pill.style.cssText = base + `color:${presentation.color};`
        + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
        + (stuck ? "border-left:2px solid var(--text-error);" : "")
        + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`;
      pill.setAttribute?.("title", String(node.card || ""));
      const glyph = pill.createEl("span", { text: presentation.glyph });
      glyph.className = `graph-view-status-glyph ${presentation.className}`;
      glyph.setAttribute?.("aria-hidden", "true");
      glyph.style.cssText = `flex:none;font-weight:700;color:${presentation.color};`;
    }
    const id = pill.createEl("span", { text: label });
    id.className = "graph-view-pill-id";
    id.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    pill.addEventListener?.("click", (event) => (onSelect
      ? onSelect(node, event)
      : this._open(node.path || node.card, source)));
    return pill;
  }

  _activeCard(current) {
    try {
      const active = current?.active;
      const raw = active && typeof active === "object" && !Array.isArray(active) ? active.card : active;
      if (typeof raw !== "string") return null;
      const match = raw.trim().match(/^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/);
      return (match ? match[1] : raw).replace(/\.md$/i, "").trim() || null;
    } catch (_e) { return null; }
  }

  // Parent-board lane parse: live epics come from the In Planning / In
  // Progress / Blocked lanes in board order; Completed-lane epics collapse to
  // done-chips. Every other section (Discovered, Post-GA, Archive, …) and
  // anything below the kanban archive divider (***) never renders.
  _parentBoardLanes(body) {
    const live = [];
    const completed = [];
    const liveLanes = ["In Planning", "In Progress", "Blocked"];
    let bucket = null;
    for (const line of String(body || "").split(/\r?\n/)) {
      if (/^\*\*\*\s*$/.test(line)) break;
      const heading = line.match(/^##\s+(.*?)\s*$/);
      if (heading) {
        bucket = liveLanes.includes(heading[1]) ? live : heading[1] === "Completed" ? completed : null;
        continue;
      }
      if (!bucket) continue;
      for (const match of line.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g)) {
        const name = match[1].replace(/\.md$/i, "").trim();
        if (name && !live.includes(name) && !completed.includes(name)) bucket.push(name);
      }
    }
    return { live, completed };
  }

  async _renderProjectScope(root, current, warnings) {
    const source = current.file.path;
    const normalized = String(current.file.folder || current.file.path).replace(/\\/g, "/").replace(/\/$/, "");
    const projectDir = current.file.folder
      ? normalized
      : (normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "");
    const slug = projectDir.split("/").pop() || "project";
    const boardPath = `${projectDir}/${slug}-board.md`;
    const appRef = this._app();
    const files = appRef?.vault?.getMarkdownFiles?.() || [];
    const boardFile = files.find((entry) => entry.path === boardPath);
    if (!boardFile) {
      warnings.push({ code: "missing_board", card: slug, detail: boardPath });
      return;
    }
    const layout = this._graphLayout();
    if (typeof layout?.layoutGraph !== "function") {
      warnings.push({ code: "render_error", card: "GraphView", detail: "GraphLayout unavailable — reinstall project" });
      return;
    }
    const read = appRef?.vault?.cachedRead || appRef?.vault?.read;
    const body = typeof read === "function" ? await read.call(appRef.vault, boardFile) : "";
    const lanes = this._parentBoardLanes(body);
    const known = new Set(files.map((entry) => entry.path));
    const api = await this._lifecycleApi();

    // One cluster per live epic: the epic-scope gather + layout, verbatim.
    const clusters = [];
    for (const epic of lanes.live) {
      const epicDir = `${projectDir}/tasks/${epic}`;
      const atlasPath = `${epicDir}/${epic}.md`;
      const epicBoardPath = `${epicDir}/board/${epic}-board.md`;
      if (!known.has(atlasPath) || !known.has(epicBoardPath)) {
        warnings.push({ code: "missing_epic", card: epic, detail: known.has(atlasPath) ? epicBoardPath : atlasPath });
        if (!known.has(atlasPath)) continue;
      }
      const result = layout.layoutGraph(this._slicePages(atlasPath, epicDir, api), {
        laneOrder: await this._laneOrder(atlasPath, epicDir),
      });
      clusters.push({
        epic,
        atlasPath,
        nodes: Array.isArray(result?.nodes) ? result.nodes : [],
        edges: Array.isArray(result?.edges) ? result.edges : [],
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      });
    }

    // Cross-epic depends_on: the layout core only sees one cluster at a time,
    // so a target in ANOTHER cluster surfaces as a per-cluster dangling
    // warning. Resolve those by card name across all gathered slices into
    // real cross-cluster edges; a target in no cluster stays on the dangling
    // warning path unchanged.
    const clusterOf = new Map();
    for (const cluster of clusters) {
      for (const node of cluster.nodes) if (!clusterOf.has(node.card)) clusterOf.set(node.card, cluster);
    }
    const crossEdges = [];
    for (const cluster of clusters) {
      const kept = [];
      for (const warning of cluster.warnings) {
        const owner = warning?.code === "dangling_dependency" ? clusterOf.get(warning.detail) : null;
        if (owner && owner !== cluster) crossEdges.push({ from: warning.detail, to: warning.card, kind: "depends", cross: true });
        else kept.push(warning);
      }
      cluster.warnings = kept;
    }

    const activeCard = this._activeCard(current);
    // Project columns stay fixed, but vertical geometry shares the same
    // deterministic full-title / bounded-wait height formula as epic scope.
    const geometry = {
      colW: 200, chipW: 172, chipH: 56, pad: 12, headerH: 30, clusterGap: 36,
      rowGap: 18, widthCharPx: 7, titleGlyphPx: 13, titleFontPx: 12, infoFontPx: 11,
      hPad: 18, titleLineH: 15, infoLineH: 13,
      padY: 7, contentGap: 3, scrollbarAllowance: 14,
    };
    const positions = new Map();
    let cursorY = geometry.pad;
    let width = geometry.pad * 2 + geometry.chipW;
    for (const cluster of clusters) {
      cluster.headerY = cursorY;
      const chipTop = cursorY + geometry.headerH;
      const rows = this._rowGeometry(cluster.nodes, () => geometry.chipW, geometry, chipTop);
      for (const node of cluster.nodes) {
        if (!positions.has(node.card)) {
          positions.set(node.card, {
            x: geometry.pad + node.rank * geometry.colW,
            y: rows.tops.get(node.row || 0),
            h: this._chipHeight(node, geometry.chipW, geometry),
          });
        }
      }
      if (cluster.nodes.length) {
        width = Math.max(width,
          geometry.pad * 2 + Math.max(...cluster.nodes.map((node) => node.rank)) * geometry.colW + geometry.chipW);
      }
      cursorY = rows.bottom + geometry.clusterGap;
    }
    const height = clusters.length ? cursorY - geometry.clusterGap + geometry.pad : 0;
    const allNodes = clusters.flatMap((cluster) => cluster.nodes);
    const allEdges = [...clusters.flatMap((cluster) => cluster.edges), ...crossEdges];
    const analysis = this._analyzeGraph(allNodes, allEdges);
    // Outcome bodies are panel-only at project scope. Keep the pre-BL-4
    // fail-soft path cold when GraphInsights is absent or malformed: without
    // analysis there is no selection controller and therefore no panel reader.
    const outcomes = analysis ? await this._loadOutcomes(allNodes) : null;

    if (clusters.length) {
      this._renderStuckSummary(root, analysis);
      const scroller = root.createEl("div");
      scroller.className = "graph-view-scroll";
      scroller.style.cssText = `overflow-x:auto;overflow-y:hidden;max-width:100%;padding-bottom:${geometry.scrollbarAllowance}px;box-sizing:content-box;`;
      const canvas = scroller.createEl("div");
      canvas.className = "graph-view-canvas graph-view-project-canvas";
      canvas.style.cssText = `position:relative;width:${width}px;height:${height}px;margin-inline:auto;`;
      const edgeLayer = canvas.createEl("div");
      edgeLayer.className = "graph-view-edges";
      edgeLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      const renderEdges = (chain) => {
        edgeLayer.innerHTML = this._edgeSvg(width, height, allEdges, positions, geometry, chain);
      };
      renderEdges(null);
      const interaction = this._selectionController({
        root, scroller, canvas, nodes: allNodes, edges: allEdges, analysis, api, source, outcomes, renderEdges,
        clusterByCard: new Map([...clusterOf].map(([card, cluster]) => [card, cluster.epic])),
      });
      interaction.renderToolbar();
      for (const cluster of clusters) {
        const header = canvas.createEl("div", { text: cluster.epic });
        header.className = "graph-view-cluster-header";
        header.style.cssText =
          `position:absolute;left:${geometry.pad}px;top:${cluster.headerY}px;height:${geometry.headerH}px;`
          + "display:flex;align-items:center;font-size:0.75em;font-weight:700;letter-spacing:0.05em;"
          + "text-transform:uppercase;color:var(--text-muted);cursor:pointer;";
        header.setAttribute?.("role", "button");
        header.addEventListener?.("click", (event) => interaction.focus?.(cluster.epic, cluster.atlasPath, event));
        interaction.registerHeader?.(cluster.epic, header);
        for (const node of cluster.nodes) {
          const chip = this._renderChip(canvas, node, positions.get(node.card), geometry, api, source, warnings,
            activeCard, null, this._nodeInsight(analysis, node.card), interaction?.select);
          interaction?.register(node, chip);
        }
      }
      this._renderLegend(root, allNodes, api);
    }
    for (const cluster of clusters) {
      for (const warning of cluster.warnings) warnings.push(warning);
    }

    if (lanes.completed.length) {
      const strip = root.createEl("div");
      strip.className = "graph-view-done-strip";
      strip.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:16px;";
      const presentation = this._statusPresentation("completed", api);
      for (const epic of lanes.completed) {
        const chip = strip.createEl("span", { text: epic });
        chip.className = `graph-view-done-chip ${presentation.className}`;
        chip.style.cssText =
          "display:inline-flex;align-items:center;gap:5px;padding:2px 10px;border-radius:999px;"
          + `font-size:0.75em;font-weight:600;cursor:pointer;color:${presentation.color};`
          + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
          + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`;
        chip.addEventListener?.("click", () => this._open(`${projectDir}/tasks/${epic}/${epic}.md`, source));
      }
    }
  }

  // ---- PH-1 phone-first: width resolution (resolved on every render, used only at epic scope) ----
  // Under 600px is narrow: any finite value below 600 after Number() (0
  // included) is narrow here. _resolveWidth only calls this with a positive
  // override or measurement; a zero or unreadable measurement never reaches
  // it and resolves to the is-mobile class or wide, which keeps a desktop
  // cold-load pane (measures 0) from flickering into the compact
  // presentation.
  _isNarrow(width) {
    const value = Number(width);
    return Number.isFinite(value) && value < 600;
  }

  _isMobileBody() {
    try {
      const body = globalThis.document?.body;
      if (!body) return false;
      if (typeof body.classList?.contains === "function") return body.classList.contains("is-mobile") === true;
      return /(?:^|\s)is-mobile(?:\s|$)/.test(String(body.className || ""));
    } catch (_e) { return false; }
  }

  // The note's scroll container at or around a mount container: the closest
  // reading-view or editor scroller, or null when there is none (or the
  // container has no closest method).
  _noteScroller(container) {
    const found = typeof container?.closest === "function"
      ? container.closest(".markdown-preview-view, .cm-scroller")
      : null;
    return found && typeof found === "object" ? found : null;
  }

  // Resolved ONCE per render, in this order: an explicit containerWidth in
  // the mounting block's args (or a harness override); then the measured
  // width: the content width of the note's scroll container, or the mount
  // container's client width when there is no scroll container around it
  // (or no computed style to read). The content width is the scroll
  // container's client width less its left and right padding when its
  // computed scrollbar-gutter includes "stable", and otherwise its offset
  // width less its left and right borders and padding (a shown scrollbar is
  // not subtracted); then the Obsidian is-mobile body class when the
  // measurement is not a finite positive number (a read that throws is
  // unmeasured, never an error); then wide. Never throws; input it cannot use falls
  // through to the is-mobile class and otherwise to wide. The 600px narrow
  // cutoff applies to the measured width itself. Only a finite positive
  // NUMBER is an override (no coercion: true, "390", or [390] fall through
  // to measurement). The phone default (390) and the desktop default
  // (1024) are the design's reference widths. `source` names the step that
  // decided: "override" and "measured" are decided widths, "mobile-class"
  // and "default" are unmeasured guesses.
  _resolveWidth(dv, overrides) {
    const wide = { width: 1024, narrow: false, source: "default" };
    try {
      let raw;
      try { raw = overrides && typeof overrides === "object" ? overrides.containerWidth : undefined; } catch (_e) { raw = undefined; }
      const explicit = typeof raw === "number" ? raw : NaN;
      if (Number.isFinite(explicit) && explicit > 0) {
        return { width: explicit, narrow: this._isNarrow(explicit), source: "override" };
      }
      let measured = NaN;
      try {
        const container = dv?.container;
        const scroller = this._noteScroller(container);
        const style = scroller && typeof globalThis.getComputedStyle === "function"
          ? globalThis.getComputedStyle(scroller)
          : null;
        if (!style) {
          measured = Number(container?.clientWidth);
        } else {
          const px = (name) => Number.parseFloat(style[name]);
          const padding = px("paddingLeft") + px("paddingRight");
          measured = String(style.scrollbarGutter || "").includes("stable")
            ? Number(scroller.clientWidth) - padding
            : Number(scroller.offsetWidth) - px("borderLeftWidth") - px("borderRightWidth") - padding;
        }
      } catch (_e) { measured = NaN; }
      if (Number.isFinite(measured) && measured > 0) {
        return { width: measured, narrow: this._isNarrow(measured), source: "measured" };
      }
      if (this._isMobileBody()) return { width: 390, narrow: true, source: "mobile-class" };
      return wide;
    } catch (_e) { return wide; }
  }

  // Disconnects the pane-width watch owned by a mount container, if any.
  _disconnectWidthWatch(container) {
    try {
      if (container && typeof container === "object") this._widthWatches?.get(container)?.disconnect();
    } catch (_e) { /* nothing to disconnect */ }
  }

  // Live pane resize (PH-9c). An epic-scope render whose width was not an
  // override, and that finishes with its root still a child of the mount
  // container, leaves one watch per mount container where the
  // resize-observer API exists and observe() succeeds: a resize observer on the note's scroll
  // container (the mount container when there is none) and, where the
  // mutation-observer API exists, a childList watch on the mount container.
  // A notification is a trigger only; it never reads the observer's box.
  // Each step that finds the watch not gone re-resolves the same
  // measurement render() uses and compares the resolved presentation with
  // the one the render resolved: wide and compact differ, and two compact
  // resolutions differ unless both are measured at the same width:
  //   a notification: unmeasured arms the 250ms re-check; measured and
  //     different (re)starts the 120ms debounce; measured and the same
  //     cancels whatever was pending;
  //   the debounce: unmeasured arms the re-check; measured and different
  //     disconnects and re-renders once, handing over that resolution;
  //   the re-check: measured and different re-renders the same way;
  //     unmeasured waits for the next notification.
  // One timer at most is pending per watch. The watch is gone, and
  // disconnects on its next step, once its root is no longer a child of the
  // mount container or the mount container is no longer inside the scroll
  // container it watches; a new watch on the same scroll container also
  // disconnects any watch there that is gone. A render of the container
  // disconnects its watch before anything else. Any fault is swallowed.
  _watchPaneWidth(dv, overrides, root, resolved) {
    let watch = null;
    try {
      const container = dv?.container;
      const Resize = globalThis.ResizeObserver;
      if (!root || !container || typeof container !== "object" || !resolved
        || resolved.source === "override" || typeof Resize !== "function") return null;
      const removed = () => root.parentNode !== container;
      if (removed()) return null;
      const target = this._noteScroller(container) || container;
      this._disconnectWidthWatch(container);
      if (!this._widthWatches) this._widthWatches = new WeakMap();
      if (!this._paneWatches) this._paneWatches = new WeakMap();
      const owners = this._widthWatches;
      const peers = this._paneWatches.get(target) || new Set();
      this._paneWatches.set(target, peers);
      const drawnNarrow = resolved.narrow === true;
      const drawnWidth = resolved.source === "measured" ? resolved.width : NaN;
      let resize = null;
      let childList = null;
      let timer = null;
      const stopTimer = () => {
        if (timer === null) return;
        const pending = timer;
        timer = null;
        globalThis.clearTimeout(pending);
      };
      watch = {
        gone: () => removed() || (target !== container && this._noteScroller(container) !== target),
        disconnect: () => {
          try { stopTimer(); } catch (_e) { /* already cleared */ }
          try { resize?.disconnect(); } catch (_e) { /* already disconnected */ }
          try { childList?.disconnect(); } catch (_e) { /* already disconnected */ }
          peers.delete(watch);
          if (owners.get(container) === watch) owners.delete(container);
        },
      };
      const step = (kind) => {
        try {
          if (watch.gone()) { watch.disconnect(); return; }
          const fresh = this._resolveWidth(dv, overrides);
          if (fresh.source !== "measured") {
            if (kind !== "recheck") arm(250, "recheck");
            return;
          }
          if (fresh.narrow === drawnNarrow && (!fresh.narrow || fresh.width === drawnWidth)) { stopTimer(); return; }
          if (kind === "notify") { arm(120, "debounce"); return; }
          watch.disconnect();
          this._renderAtWidth(dv, overrides, fresh);
        } catch (_e) { /* swallowed: the watch keeps observing */ }
      };
      const arm = (ms, kind) => {
        stopTimer();
        timer = globalThis.setTimeout(() => { timer = null; step(kind); }, ms);
      };
      for (const peer of [...peers]) if (peer.gone()) peer.disconnect();
      owners.set(container, watch);
      peers.add(watch);
      resize = new Resize(() => step("notify"));
      const Mutation = globalThis.MutationObserver;
      if (typeof Mutation === "function") {
        childList = new Mutation(() => {
          try {
            if (removed()) watch.disconnect();
          } catch (_e) { /* swallowed: the watch keeps observing */ }
        });
        childList.observe(container, { childList: true });
      }
      resize.observe(target);
      return watch;
    } catch (_e) {
      watch?.disconnect();
      return null;
    }
  }

  async render(dv, overrides) {
    return this._renderAtWidth(dv, overrides, null);
  }

  // The body of render(). `decided` is null for every render a caller starts;
  // only the pane-width watch passes the measured resolution it just took,
  // so its re-render draws exactly that presentation without reading the
  // width a second time.
  async _renderAtWidth(dv, overrides, decided) {
    try {
      this._disconnectWidthWatch(dv && typeof dv === "object" ? dv.container : null);
      const RS = globalThis.customJS?.RenderSafe;
      const current = RS?.page ? RS.page(dv) : null;
      if (!current?.file?.path || !dv?.container?.createEl) return;
      // The width is resolved once, while the previous graph (if any) is still
      // drawn, unless the pane-width watch handed over the measurement it
      // resolved in that same layout state.
      const resolved = decided && decided.source === "measured" ? decided : this._resolveWidth(dv, overrides);
      const previous = dv.container.querySelector?.(":scope > .graph-view-root");
      previous?.remove?.();
      const root = dv.container.createEl("div");
      root.className = "graph-view-root";
      root.style.cssText = "display:grid;gap:0;max-width:100%;";
      this._renderSectionChrome(dv, root);
      const scope = overrides && typeof overrides === "object" && overrides.scope
        ? String(overrides.scope)
        : this._scope;
      if (scope === "project") {
        const warnings = [];
        try {
          await this._renderProjectScope(root, current, warnings);
        } catch (error) {
          warnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
        }
        this._renderWarnings(root, warnings);
        return;
      }
      if (scope !== "epic") return;
      const extraWarnings = [];
      let result = { nodes: [], edges: [], warnings: [] };
      let api = null;
      try {
        const currentFolder = current.file.folder || "";
        api = await this._lifecycleApi();
        const slices = this._slicePages(current.file.path, currentFolder, api);
        const laneOrder = await this._laneOrder(current.file.path, currentFolder);
        const layout = this._graphLayout();
        if (typeof layout?.layoutGraph !== "function") {
          extraWarnings.push({ code: "render_error", card: "GraphView", detail: "GraphLayout unavailable — reinstall project" });
        } else {
          const laidOut = layout.layoutGraph(slices, { laneOrder });
          if (laidOut && typeof laidOut === "object") result = laidOut;
          result = this._applyCrossEpicStubs(result, current.file.path, currentFolder);
        }
      } catch (error) {
        extraWarnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
      }
      // The compact map is a second presentation of the same frozen layout
      // result; any compact failure degrades to one warning row plus the wide
      // path — never a blank note.
      let presented = false;
      if (resolved.narrow) {
        const warningsBefore = extraWarnings.length;
        try {
          await this._renderCompactGraph(root, result, api, current.file.path, extraWarnings, resolved.width);
          presented = true;
        } catch (error) {
          for (const child of Array.from(root.children || [])) {
            if (String(child?.className || "").split(/\s+/).includes("graph-view-compact")) child.remove?.();
          }
          extraWarnings.length = warningsBefore;
          extraWarnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
        }
      }
      if (!presented) {
        try {
          await this._renderGraph(root, result, api, current.file.path, extraWarnings);
        } catch (error) {
          extraWarnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
        }
      }
      this._renderWarnings(root, [
        ...(Array.isArray(result.warnings) ? result.warnings : []),
        ...extraWarnings,
      ]);
      this._watchPaneWidth(dv, overrides, root, resolved);
    } catch (_e) { /* render-safe: a partial cold-load page is a no-op */ }
  }
}
