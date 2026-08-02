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
 * right edge plus pad, so nothing clips at rest. Chips are clickable internal
 * links: the title wraps to two lines before any ellipsis, an info line shows
 * the colored lifecycle status word plus the inline wait reason ("needs <dep>"
 * for blocked, resume_condition start for parked), and the hover tooltip
 * carries the card's Outcome sentence. Layout warnings render as one compact
 * strip row each under the graph; empty warnings render nothing.
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

  // Edge endpoints bind to each chip's OWN width now (per-column auto-width at
  // epic scope). from.w / to.w carry the chip's rendered width; project scope's
  // fixed-geometry positions omit w and fall back to the shared geometry.chipW,
  // so project-scope edge math is byte-identical to before.
  _edgeMarkup(edges, positions, geometry) {
    const paths = [];
    for (const edge of edges || []) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const fromW = from.w != null ? from.w : geometry.chipW;
      const chipH = geometry.chipH;
      let d;
      if (from.x === to.x) {
        const x = from.x + fromW / 2;
        d = `M ${x} ${from.y + chipH} L ${x} ${to.y}`;
      } else {
        const x1 = from.x + fromW;
        const y1 = from.y + chipH / 2;
        const x2 = to.x;
        const y2 = to.y + chipH / 2;
        const bend = Math.max(24, (x2 - x1) / 2);
        d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
      }
      paths.push(edge.kind === "depends"
        ? `<path class="graph-view-edge edge-depends${edge.cross ? " edge-cross-epic" : ""}" d="${d}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" marker-end="url(#graph-view-arrow)"/>`
        : `<path class="graph-view-edge edge-order" d="${d}" fill="none" stroke="var(--text-faint)" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.55"/>`);
    }
    return paths.join("");
  }

  // GV-R2 epic-scope geometry: per-rank auto-width columns. Each rank's column
  // width is the widest chip content in that rank (deterministic text formula,
  // NOT a live-DOM measure — the harness is headless), clamped to [minCol,
  // maxCol]. Column x-offset accumulates prior column widths plus an inter-column
  // gap; a chip's width is its column's width. The canvas is sized to the last
  // column's right edge plus pad EXACTLY, so the final column never clips at
  // rest — horizontal scroll engages only when the container is genuinely
  // narrower than that width. rowH/chipH stay constant, so vertical edge math is
  // unchanged; only the horizontal axis is auto-width now.
  async _renderGraph(root, result, api, source, extraWarnings) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    if (!nodes.length) return;
    const geometry = {
      rowH: 74, chipH: 56, pad: 12, colGap: 28, chipW: 172,
      charPx: 7, hPad: 18, minCol: 120, maxCol: 260,
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
    const positions = new Map(nodes.map((node) => {
      const rank = node.rank || 0;
      return [node.card, {
        x: colX.get(rank),
        y: geometry.pad + (node.row || 0) * geometry.rowH,
        w: colWidth.get(rank),
      }];
    }));
    const width = colX.get(lastRank) + colWidth.get(lastRank) + geometry.pad;
    const height = geometry.pad * 2 + (Math.max(...nodes.map((node) => node.row || 0)) * geometry.rowH) + geometry.chipH;
    const outcomes = await this._loadOutcomes(nodes);
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
      if (node.isStub) this._renderStub(canvas, node, positions.get(node.card), geometry, source);
      else this._renderChip(canvas, node, positions.get(node.card), geometry, api, source, extraWarnings, null, outcomes);
    }
  }

  // Deterministic chip-content width (headless-safe): word-wrap the chip's text
  // to at most two lines at the column's character budget, then size to the
  // widest wrapped line. A title that overflows two lines caps at maxCol (its
  // second line ellipsizes in the DOM); everything else is clamped to
  // [minCol, maxCol]. Stubs size to their ghost label.
  _chipContentWidth(node, geometry) {
    const text = node.isStub ? (node.stubLabel || node.card || "") : (node.card || "");
    const { longest, clamped } = this._wrapTitle(text, geometry.maxCharsPerLine);
    const raw = clamped ? geometry.maxCol : (longest * geometry.charPx + geometry.hPad);
    return Math.min(geometry.maxCol, Math.max(geometry.minCol, raw));
  }

  // Greedy two-line word wrap. Returns the kept (≤2) lines, the longest line's
  // character length, and whether the text overflowed two lines (clamped → the
  // second line ellipsizes under CSS -webkit-line-clamp:2).
  _wrapTitle(text, maxChars) {
    const limit = Math.max(1, Number(maxChars) || 1);
    const words = String(text == null ? "" : text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= limit || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    const clamped = lines.length > 2;
    const kept = lines.slice(0, 2);
    const longest = kept.reduce((max, entry) => Math.max(max, entry.length), 0);
    return { lines: kept, longest, clamped };
  }

  // Info-line wait text: a blocked slice (waitReason "waiting on: X, Y") shows
  // "needs <first-dep-id>"; a parked slice's waitReason is the resume_condition
  // verbatim, shown from its start (truncated). Null when the node is neither.
  _waitInfo(node) {
    const reason = node && node.waitReason;
    if (reason == null || String(reason).trim() === "") return null;
    const text = String(reason);
    const blocked = text.match(/^\s*waiting on:\s*(.+)$/i);
    if (blocked) {
      const firstDep = blocked[1].split(",")[0].trim();
      return `needs ${this._titleParts(firstDep).id || firstDep}`;
    }
    return this._truncate(text, 48);
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

  // Ghost external stub (GV-R1): a muted, dashed, clickable chip standing in
  // for a cross-epic prerequisite. Read-only — clicking opens the owning card.
  // It is not a slice, so it never routes through status presentation and never
  // emits an unreadable-slice warning.
  _renderStub(canvas, node, at, geometry, source) {
    const chipW = at && at.w != null ? at.w : geometry.chipW;
    const chip = canvas.createEl("div");
    chip.className = "graph-view-chip graph-view-stub";
    chip.style.cssText =
      `position:absolute;left:${at.x}px;top:${at.y}px;width:${chipW}px;min-height:${geometry.chipH}px;`
      + "display:flex;flex-direction:column;gap:3px;justify-content:center;padding:7px 9px;border-radius:9px;"
      + "cursor:pointer;box-sizing:border-box;color:var(--text-muted);opacity:0.75;"
      + "border:1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent);"
      + "background:color-mix(in srgb, var(--text-muted) 6%, var(--background-primary));";
    chip.addEventListener?.("click", () => this._open(node.path || node.card, source));
    const label = chip.createEl("div", { text: node.stubLabel || String(node.card || "") });
    label.className = "graph-view-stub-label";
    label.style.cssText = "min-width:0;font-size:0.72em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  }

  _renderChip(canvas, node, at, geometry, api, source, extraWarnings, activeCard, outcomes) {
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
    const perLineChars = Math.max(1, Math.floor((chipW - geometry.hPad) / geometry.charPx));
    const wrapped = this._wrapTitle(parts.title, perLineChars);
    const chip = canvas.createEl("div");
    chip.className = `graph-view-chip ${presentation.className}`
      + `${active ? " graph-view-active" : ""}${wrapped.clamped ? " graph-view-chip-clamped" : ""}`;
    chip.style.cssText =
      `position:absolute;left:${at.x}px;top:${at.y}px;width:${chipW}px;min-height:${geometry.chipH}px;`
      + "display:flex;flex-direction:column;gap:3px;justify-content:center;padding:7px 9px;border-radius:9px;"
      + `cursor:pointer;box-sizing:border-box;color:${presentation.color};`
      + `border:1px solid color-mix(in srgb, ${presentation.color} 40%, transparent);`
      + `background:color-mix(in srgb, ${presentation.color} 10%, var(--background-primary));`
      + (active ? "outline:2px solid var(--interactive-accent);outline-offset:2px;" : "");
    // Outcome sentence in the hover tooltip; fall back to the full card title.
    const outcome = outcomes && typeof outcomes.get === "function" ? outcomes.get(node.card) : null;
    chip.setAttribute?.("title", String(outcome || node.card || ""));
    chip.addEventListener?.("click", () => this._open(node.path || node.card, source));
    const titleRow = chip.createEl("div");
    titleRow.className = "graph-view-chip-title";
    titleRow.style.cssText = "display:flex;align-items:baseline;gap:5px;min-width:0;";
    if (parts.id) {
      const id = titleRow.createEl("span", { text: parts.id });
      id.className = "graph-view-chip-id";
      id.style.cssText = "flex:none;font-family:var(--font-monospace);font-size:0.72em;font-weight:600;opacity:0.85;";
    }
    // Title wraps to two lines before any ellipsis (-webkit-line-clamp:2); the
    // full title stays in the DOM so nothing is lost — only the visual overflow
    // ellipsizes on the second line.
    const title = titleRow.createEl("span", { text: parts.title });
    title.className = "graph-view-chip-name";
    title.style.cssText = "min-width:0;font-size:0.78em;font-weight:600;"
      + "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;"
      + "overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere;";
    // Info line: the colored lifecycle status WORD (shared presentation, no
    // local color table) plus the inline wait reason.
    const info = chip.createEl("div");
    info.className = "graph-view-chip-info";
    info.style.cssText = "display:flex;align-items:baseline;gap:5px;min-width:0;font-size:0.7em;";
    const word = info.createEl("span", { text: presentation.label });
    word.className = `graph-view-status-word ${presentation.className}`;
    word.style.cssText = `flex:none;font-weight:600;color:${presentation.color};`;
    const waitText = this._waitInfo(node);
    if (waitText) {
      const wait = info.createEl("span", { text: waitText });
      wait.className = "graph-view-wait";
      wait.setAttribute?.("title", String(node.waitReason || ""));
      wait.style.cssText = "min-width:0;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
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
    // Project-scope COLUMN geometry stays fixed (colW/rowH/chipW/chipH); charPx
    // and hPad only feed the shared chip's two-line wrap calc.
    const geometry = { colW: 200, rowH: 74, chipW: 172, chipH: 56, pad: 12, headerH: 30, clusterGap: 26, charPx: 7, hPad: 18 };
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
      try {
        await this._renderGraph(root, result, api, current.file.path, extraWarnings);
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
