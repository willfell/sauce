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
 * "order") under positioned DOM chips (columns = rank, rows = row). Chips are
 * clickable internal links; parked/blocked chips carry a wait badge
 * (truncated ~60 chars, full text in the title attribute). Layout warnings
 * render as one compact strip row each under the graph; empty warnings render
 * nothing.
 *
 * Fail-soft everywhere: gather/layout/render failures degrade to warning rows
 * or unknown-style chips — the widget never throws, never blanks the note,
 * never writes to the vault, and never calls the coordinator.
 */
class GraphView {
  constructor(options = {}) {
    this._injectedLifecycleApi = options.lifecycleApi || null;
    this._injectedLayout = options.layout || null;
    this._injectedDashboard = options.dashboard || null;
    this._scope = options.scope || "epic";
  }

  _app() {
    try { return typeof app !== "undefined" ? app : globalThis.app; } catch (_e) { return null; }
  }

  _dashboard() {
    if (this._injectedDashboard) return this._injectedDashboard;
    try { return globalThis.customJS?.EpicDashboard || null; } catch (_e) { return null; }
  }

  _graphLayout() {
    if (this._injectedLayout) return this._injectedLayout;
    try { return globalThis.customJS?.GraphLayout || null; } catch (_e) { return null; }
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

  _slicePages(currentPath, currentFolder = "") {
    const { boardDir } = this._epicPaths(currentPath, currentFolder);
    const prefix = boardDir + "/";
    try {
      return (this._app()?.vault?.getMarkdownFiles?.() || [])
        .filter((file) => file.path.startsWith(prefix)
          && !file.path.slice(prefix.length).includes("/")
          && this._frontmatter(file).type === "slice")
        .map((file) => ({
          ...this._frontmatter(file),
          card: file.basename,
          name: file.basename,
          file: { path: file.path, name: file.basename, mtime: file.stat?.mtime || 0 },
        }))
        .sort((left, right) => String(left.file.name).localeCompare(String(right.file.name)));
    } catch (_e) { return []; }
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
      className: "status-unrecognized",
    };
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
    strip.style.cssText = "display:grid;gap:4px;padding:2px 0;";
    for (const warning of rows) {
      const row = strip.createEl("div", { text: this._warningText(warning) });
      row.className = `graph-view-warning warning-${String(warning.code || "unknown").replace(/_/g, "-")}`;
      row.style.cssText = "color:var(--color-orange);font-size:var(--font-ui-smaller);overflow-wrap:anywhere;";
    }
  }

  _edgeMarkup(edges, positions, geometry) {
    const paths = [];
    for (const edge of edges || []) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      let d;
      if (from.x === to.x) {
        const x = from.x + geometry.chipW / 2;
        d = `M ${x} ${from.y + geometry.chipH} L ${x} ${to.y}`;
      } else {
        const x1 = from.x + geometry.chipW;
        const y1 = from.y + geometry.chipH / 2;
        const x2 = to.x;
        const y2 = to.y + geometry.chipH / 2;
        const bend = Math.max(24, (x2 - x1) / 2);
        d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      }
      paths.push(edge.kind === "depends"
        ? `<path class="graph-view-edge edge-depends${edge.cross ? " edge-cross-epic" : ""}" d="${d}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" marker-end="url(#graph-view-arrow)"/>`
        : `<path class="graph-view-edge edge-order" d="${d}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.55"/>`);
    }
    return paths.join("");
  }

  _renderGraph(root, result, api, source, extraWarnings) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    if (!nodes.length) return;
    const geometry = { colW: 200, rowH: 74, chipW: 172, chipH: 56, pad: 12 };
    const positions = new Map(nodes.map((node) => [node.card, {
      x: geometry.pad + node.rank * geometry.colW,
      y: geometry.pad + node.row * geometry.rowH,
    }]));
    const width = geometry.pad * 2 + (Math.max(...nodes.map((node) => node.rank)) * geometry.colW) + geometry.chipW;
    const height = geometry.pad * 2 + (Math.max(...nodes.map((node) => node.row)) * geometry.rowH) + geometry.chipH;
    const scroller = root.createEl("div");
    scroller.className = "graph-view-scroll";
    scroller.style.cssText = "overflow-x:auto;max-width:100%;";
    const canvas = scroller.createEl("div");
    canvas.className = "graph-view-canvas";
    canvas.style.cssText = `position:relative;width:${width}px;height:${height}px;`;
    const edgeLayer = canvas.createEl("div");
    edgeLayer.className = "graph-view-edges";
    edgeLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
    edgeLayer.innerHTML =
      `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
      + '<defs><marker id="graph-view-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
      + '<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-muted)"/></marker></defs>'
      + this._edgeMarkup(result?.edges, positions, geometry)
      + "</svg>";
    for (const node of nodes) {
      this._renderChip(canvas, node, positions.get(node.card), geometry, api, source, extraWarnings, null);
    }
  }

  _renderChip(canvas, node, at, geometry, api, source, extraWarnings, activeCard) {
    const presentation = this._statusPresentation(node.status, api);
    if (!presentation.normalized) {
      extraWarnings.push({
        code: "unreadable_slice",
        card: node.card,
        detail: String(node.status == null ? "(missing)" : node.status),
      });
    }
    const active = activeCard != null && node.card === activeCard;
    const chip = canvas.createEl("div");
    chip.className = `graph-view-chip ${presentation.className}${active ? " graph-view-active" : ""}`;
    chip.style.cssText =
      `position:absolute;left:${at.x}px;top:${at.y}px;width:${geometry.chipW}px;min-height:${geometry.chipH}px;`
      + "display:flex;flex-direction:column;gap:3px;justify-content:center;padding:7px 9px;border-radius:9px;"
      + `cursor:pointer;box-sizing:border-box;color:${presentation.color};`
      + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
      + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`
      + (active ? "outline:2px solid var(--interactive-accent);outline-offset:2px;" : "");
    chip.addEventListener?.("click", () => this._open(node.path || node.card, source));
    const parts = this._titleParts(node.card);
    const titleRow = chip.createEl("div");
    titleRow.className = "graph-view-chip-title";
    titleRow.style.cssText = "display:flex;align-items:baseline;gap:5px;min-width:0;";
    if (parts.id) {
      const id = titleRow.createEl("span", { text: parts.id });
      id.className = "graph-view-chip-id";
      id.style.cssText = "flex:none;font-family:var(--font-monospace);font-size:0.72em;font-weight:600;opacity:0.85;";
    }
    const title = titleRow.createEl("span", { text: parts.title });
    title.className = "graph-view-chip-name";
    title.style.cssText = "min-width:0;font-size:0.78em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    if (node.waitReason) {
      const badge = chip.createEl("span", { text: this._truncate(node.waitReason, 60) });
      badge.className = "graph-view-wait-badge";
      badge.setAttribute?.("title", String(node.waitReason));
      badge.style.cssText = "min-width:0;font-size:0.7em;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    }
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
      const result = layout.layoutGraph(this._slicePages(atlasPath, epicDir), {
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
    const geometry = { colW: 200, rowH: 74, chipW: 172, chipH: 56, pad: 12, headerH: 30, clusterGap: 26 };
    const positions = new Map();
    let cursorY = geometry.pad;
    let width = geometry.pad * 2 + geometry.chipW;
    for (const cluster of clusters) {
      cluster.headerY = cursorY;
      const chipTop = cursorY + geometry.headerH;
      for (const node of cluster.nodes) {
        if (!positions.has(node.card)) {
          positions.set(node.card, {
            x: geometry.pad + node.rank * geometry.colW,
            y: chipTop + node.row * geometry.rowH,
          });
        }
      }
      const clusterHeight = cluster.nodes.length
        ? Math.max(...cluster.nodes.map((node) => node.row)) * geometry.rowH + geometry.chipH
        : 0;
      if (cluster.nodes.length) {
        width = Math.max(width,
          geometry.pad * 2 + Math.max(...cluster.nodes.map((node) => node.rank)) * geometry.colW + geometry.chipW);
      }
      cursorY = chipTop + clusterHeight + geometry.clusterGap;
    }
    const height = clusters.length ? cursorY - geometry.clusterGap + geometry.pad : 0;

    if (clusters.length) {
      const scroller = root.createEl("div");
      scroller.className = "graph-view-scroll";
      scroller.style.cssText = "overflow-x:auto;max-width:100%;";
      const canvas = scroller.createEl("div");
      canvas.className = "graph-view-canvas graph-view-project-canvas";
      canvas.style.cssText = `position:relative;width:${width}px;height:${height}px;`;
      const edgeLayer = canvas.createEl("div");
      edgeLayer.className = "graph-view-edges";
      edgeLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      const allEdges = [...clusters.flatMap((cluster) => cluster.edges), ...crossEdges];
      edgeLayer.innerHTML =
        `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
        + '<defs><marker id="graph-view-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        + '<path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-muted)"/></marker></defs>'
        + this._edgeMarkup(allEdges, positions, geometry)
        + "</svg>";
      for (const cluster of clusters) {
        const header = canvas.createEl("div", { text: cluster.epic });
        header.className = "graph-view-cluster-header";
        header.style.cssText =
          `position:absolute;left:${geometry.pad}px;top:${cluster.headerY}px;height:${geometry.headerH}px;`
          + "display:flex;align-items:center;font-size:0.75em;font-weight:700;letter-spacing:0.05em;"
          + "text-transform:uppercase;color:var(--text-muted);cursor:pointer;";
        header.addEventListener?.("click", () => this._open(cluster.atlasPath, source));
        for (const node of cluster.nodes) {
          this._renderChip(canvas, node, positions.get(node.card), geometry, api, source, warnings, activeCard);
        }
      }
    }
    for (const cluster of clusters) {
      for (const warning of cluster.warnings) warnings.push(warning);
    }

    if (lanes.completed.length) {
      const strip = root.createEl("div");
      strip.className = "graph-view-done-strip";
      strip.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;";
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

  async render(dv, overrides) {
    try {
      const RS = globalThis.customJS?.RenderSafe;
      const current = RS?.page ? RS.page(dv) : null;
      if (!current?.file?.path || !dv?.container?.createEl) return;
      const previous = dv.container.querySelector?.(":scope > .graph-view-root");
      previous?.remove?.();
      const root = dv.container.createEl("div");
      root.className = "graph-view-root";
      root.style.cssText = "display:grid;gap:8px;max-width:100%;";
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
        const slices = this._slicePages(current.file.path, currentFolder);
        const laneOrder = await this._laneOrder(current.file.path, currentFolder);
        const layout = this._graphLayout();
        if (typeof layout?.layoutGraph !== "function") {
          extraWarnings.push({ code: "render_error", card: "GraphView", detail: "GraphLayout unavailable — reinstall project" });
        } else {
          const laidOut = layout.layoutGraph(slices, { laneOrder });
          if (laidOut && typeof laidOut === "object") result = laidOut;
        }
        api = await this._lifecycleApi();
      } catch (error) {
        extraWarnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
      }
      try {
        this._renderGraph(root, result, api, current.file.path, extraWarnings);
      } catch (error) {
        extraWarnings.push({ code: "render_error", card: "GraphView", detail: error?.message || String(error) });
      }
      this._renderWarnings(root, [
        ...(Array.isArray(result.warnings) ? result.warnings : []),
        ...extraWarnings,
      ]);
    } catch (_e) { /* render-safe: a partial cold-load page is a no-op */ }
  }
}
