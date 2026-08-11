/**
 * EpicDashboard — read-only epic atlas dashboard.
 *
 * Folder shape is authoritative: slices are direct Markdown children of the
 * current epic's board/ directory; context is read from context/{runs,lessons,
 * decisions}. Lifecycle state is delegated to delivery@0.3.0's public API.
 */
class EpicDashboard {
  constructor(options = {}) {
    this._injectedLifecycleApi = options.lifecycleApi || null;
  }

  _epicPaths(currentPath, currentFolder = "") {
    if (currentFolder) {
      const epicDir = String(currentFolder).replace(/\\/g, "/").replace(/\/$/, "");
      return { epicDir, boardDir: `${epicDir}/board`, contextDir: `${epicDir}/context` };
    }
    const normalized = String(currentPath || "").replace(/\\/g, "/");
    const epicDir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    return { epicDir, boardDir: `${epicDir}/board`, contextDir: `${epicDir}/context` };
  }

  _app() {
    try { return typeof app !== "undefined" ? app : globalThis.app; } catch (_e) { return null; }
  }

  async _contentPath(adapter) {
    try {
      const config = JSON.parse(await adapter?.read?.("ranch/platform-config.json"));
      const configured = String(config?.variables?.content_path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
      if (configured && !configured.startsWith("/") && !/^[A-Za-z]:\//.test(configured)
        && !configured.split("/").includes("..")) return configured;
    } catch (_e) {}
    return "ranch/content";
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

  _contextGroups(currentPath, limit = 3, currentFolder = "") {
    const { contextDir } = this._epicPaths(currentPath, currentFolder);
    const groups = { pack: [], runs: [], lessons: [], decisions: [] };
    try {
      for (const file of (this._app()?.vault?.getMarkdownFiles?.() || [])) {
        if (file.path === `${contextDir}/pack.md`) groups.pack.push(file);
        for (const kind of ["runs", "lessons", "decisions"]) {
          const prefix = `${contextDir}/${kind}/`;
          if (file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes("/")) groups[kind].push(file);
        }
      }
      for (const kind of ["runs", "lessons", "decisions"]) {
        groups[kind].sort((a, b) => Number(b.stat?.mtime || 0) - Number(a.stat?.mtime || 0));
      }
      groups.runs = groups.runs.slice(0, limit);
    } catch (_e) {}
    return groups;
  }

  async _deliveryApi() {
    const complete = (api) => typeof api?.deriveEpicLifecycle === "function"
      && typeof api?.normalizeStatus === "function";
    if (complete(this._injectedLifecycleApi)) return this._injectedLifecycleApi;
    if (complete(this._resolvedLifecycleApi)) return this._resolvedLifecycleApi;
    try {
      if (complete(globalThis.SauceDelivery)) return (this._resolvedLifecycleApi = globalThis.SauceDelivery);
      if (complete(globalThis.customJS?.DeliveryContract)) return (this._resolvedLifecycleApi = globalThis.customJS.DeliveryContract);
      const realApp = this._app();
      const adapter = realApp?.vault?.adapter;
      const contentPath = await this._contentPath(adapter);
      const deliveryRoot = `${contentPath}/delivery`;
      const req = typeof globalThis.require === "function" ? globalThis.require : null;
      const fullPath = adapter?.getFullPath?.(`${deliveryRoot}/index.js`);
      if (req && fullPath) {
        const api = req(fullPath);
        if (complete(api)) return (this._resolvedLifecycleApi = api);
      }

      // Obsidian mobile has no Node require(). Evaluate the installed ES1
      // CommonJS artifact with a deliberately tiny resolver instead of
      // duplicating its lifecycle rules in this view. The stable public index
      // remains the final export boundary; crypto is a lazy stub because the
      // dashboard calls lifecycle derivation only (never hashing APIs).
      if (adapter?.read) {
        const [indexSource, contractSource, registrySource] = await Promise.all([
          adapter.read(`${deliveryRoot}/index.js`),
          adapter.read(`${deliveryRoot}/scripts/delivery-contract.js`),
          adapter.read(`${deliveryRoot}/data/delivery-schema.json`),
        ]);
        const registry = JSON.parse(registrySource);
        const contractModule = { exports: {} };
        const contractRequire = (id) => {
          if (id === "../data/delivery-schema.json") return registry;
          if (id === "crypto") return { createHash() { throw new Error("hashing unavailable in EpicDashboard lifecycle adapter"); } };
          throw new Error(`unsupported delivery dependency: ${id}`);
        };
        new Function("require", "module", "exports", contractSource)(contractRequire, contractModule, contractModule.exports);
        const indexModule = { exports: {} };
        new Function("require", "module", "exports", indexSource)(
          (id) => {
            if (id === "./scripts/delivery-contract") return contractModule.exports;
            throw new Error(`unsupported delivery public dependency: ${id}`);
          },
          indexModule,
          indexModule.exports
        );
        if (complete(indexModule.exports)) return (this._resolvedLifecycleApi = indexModule.exports);
      }
    } catch (_e) {}
    return null;
  }

  static get STATUS_DISPLAY() {
    return {
      planning: "planning",
      in_progress: "in progress",
      parked: "waiting",
      blocked: "blocked",
      completed: "done",
      discarded: "discarded",
    };
  }

  static get STATUS_COLORS() {
    return {
      planning: "var(--color-blue)",
      in_progress: "var(--color-green)",
      parked: "var(--color-orange)",
      blocked: "var(--color-red)",
      completed: "var(--color-purple)",
      discarded: "var(--text-faint)",
    };
  }

  // One shared, mobile-safe glyph channel for every lifecycle presentation.
  // Consumers receive the glyph through _statusPresentation; widgets must not
  // carry a second status→glyph table of their own.
  static get STATUS_GLYPHS() {
    return {
      planning: "○",
      in_progress: "●",
      parked: "◷",
      blocked: "!",
      completed: "✓",
      discarded: "–",
      unrecognized: "?",
    };
  }

  _chip(parent, text, color, className = "") {
    const chip = parent.createEl("span", { text });
    chip.className = className;
    chip.style.cssText =
      `display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;` +
      `font-size:0.75em;font-weight:600;color:${color};` +
      `background:color-mix(in srgb, ${color} 12%, transparent);` +
      `border:1px solid color-mix(in srgb, ${color} 35%, transparent);`;
    return chip;
  }

  _statusPresentation(rawStatus, api) {
    const raw = String(rawStatus == null ? "" : rawStatus).trim();
    const normalized = api?.normalizeStatus?.(raw) || null;
    const label = EpicDashboard.STATUS_DISPLAY[normalized];
    if (!normalized || !label) {
      return {
        normalized: null,
        label: `unrecognized: ${raw || "(missing)"}`,
        color: "var(--color-orange)",
        glyph: EpicDashboard.STATUS_GLYPHS.unrecognized,
        className: "status-unrecognized",
      };
    }
    return {
      normalized,
      label,
      color: EpicDashboard.STATUS_COLORS[normalized] || "var(--text-muted)",
      glyph: EpicDashboard.STATUS_GLYPHS[normalized] || EpicDashboard.STATUS_GLYPHS.unrecognized,
      className: `status-${({
        planning: "planning", in_progress: "in-progress", parked: "waiting",
        blocked: "blocked", completed: "done", discarded: "discarded",
      })[normalized]}`,
    };
  }

  _identity(value) {
    const raw = String(value == null ? "" : value).trim();
    const match = raw.match(/^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/);
    return (match ? match[1] : raw).replace(/\.md$/i, "").trim();
  }

  _titleParts(value) {
    const full = String(value || "").trim();
    const idMatch = full.match(/^([A-Z]+-[A-Za-z0-9]+)(?:\s+|$)/);
    if (!idMatch) return { id: null, title: full };
    const withoutId = full.slice(idMatch[0].length).trim();
    const clean = withoutId.replace(/\s+\(supersedes[^)]*\)\s*$/i, "").trim();
    return { id: idMatch[1], title: clean || full };
  }

  _array(value) {
    if (Array.isArray(value)) return value;
    try {
      if (value && typeof value.array === "function") {
        const materialized = value.array();
        return Array.isArray(materialized) ? materialized : [];
      }
    } catch (_e) {}
    return [];
  }

  _open(path, source) {
    try { this._app()?.workspace?.openLinkText?.(String(path || "").replace(/\.md$/, ""), source || "", false); }
    catch (_e) {}
  }

  _link(parent, path, label, source) {
    const button = parent.createEl("button", { text: label });
    button.className = "epic-dashboard-link";
    button.style.cssText = "appearance:none;background:none;border:0;padding:0;color:var(--link-color);cursor:pointer;text-align:left;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;";
    button.addEventListener?.("click", () => this._open(path, source));
    return button;
  }

  _section(dv, root, label) {
    try {
      const SL = globalThis.customJS?.SectionLabel;
      if (SL?.render) { SL.render({ ...dv, container: root }, { text: label }); return; }
    } catch (_e) {}
    root.createEl("div", { text: label });
  }

  _renderLifecycle(root, lifecycle) {
    const counts = lifecycle.counts || {};
    const card = root.createEl("div");
    card.className = "epic-dashboard-summary";
    card.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:10px;padding:12px;display:grid;gap:10px;";
    const header = card.createEl("div");
    header.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
    const state = String(lifecycle.state || "planned");
    const stateColors = {
      planned: EpicDashboard.STATUS_COLORS.planning,
      active: EpicDashboard.STATUS_COLORS.in_progress,
      blocked: EpicDashboard.STATUS_COLORS.blocked,
      done: EpicDashboard.STATUS_COLORS.completed,
    };
    this._chip(header, state, stateColors[state] || "var(--text-muted)", "epic-dashboard-state");
    const total = Number(counts.total ?? (Number(counts.done || 0) + Number(counts.active || 0) + Number(counts.waiting || 0) + Number(counts.blocked || 0) + Number(counts.planned || 0)));
    const progressRow = card.createEl("div");
    progressRow.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;";
    const progress = progressRow.createEl("div");
    progress.className = "epic-dashboard-progress";
    progress.style.cssText = "display:flex;flex:1;min-width:0;height:6px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;";
    const segmentSpecs = [
      ["done", "segment-done", EpicDashboard.STATUS_COLORS.completed],
      ["active", "segment-active", EpicDashboard.STATUS_COLORS.in_progress],
      ["waiting", "segment-waiting", EpicDashboard.STATUS_COLORS.parked],
      ["blocked", "segment-blocked", EpicDashboard.STATUS_COLORS.blocked],
    ];
    for (const [key, className, color] of segmentSpecs) {
      const count = Number(counts[key] || 0);
      if (count <= 0 || total <= 0) continue;
      const segment = progress.createEl("span");
      segment.className = `epic-dashboard-progress-segment ${className}`;
      segment.style.cssText = `display:block;height:100%;width:${count / total * 100}%;background:${color};`;
    }
    if (total > 0 && Number(counts.planned || 0) === total) {
      const notStarted = progressRow.createEl("span", { text: "not started" });
      notStarted.className = "epic-dashboard-not-started";
      notStarted.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-smaller);white-space:nowrap;";
    }
    const metrics = card.createEl("div");
    metrics.className = "epic-dashboard-metrics";
    metrics.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";
    for (const [value, label, color] of [
      [counts.done || 0, "deployed", EpicDashboard.STATUS_COLORS.completed],
      [counts.active || 0, "in flight", EpicDashboard.STATUS_COLORS.in_progress],
      [counts.waiting || 0, "waiting", EpicDashboard.STATUS_COLORS.parked],
      [counts.blocked || 0, "blocked", EpicDashboard.STATUS_COLORS.blocked],
      [counts.planned || 0, "planned", EpicDashboard.STATUS_COLORS.planning],
    ]) {
      if (Number(value) <= 0) continue;
      this._chip(metrics, `${value} ${label}`, color, "epic-dashboard-metric-chip");
    }
  }

  _renderSlices(dv, root, slices, lifecycle, source, api) {
    this._section(dv, root, "Slices");
    const card = root.createEl("div");
    card.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:10px;overflow:hidden;";
    const frontier = String(lifecycle.frontier || "");
    for (const slice of slices) {
      const row = card.createEl("div");
      row.className = "epic-dashboard-slice-row";
      row.style.cssText = "display:grid;gap:7px;padding:10px 11px;border-bottom:1px solid var(--background-modifier-border);min-width:0;";
      const titleRow = row.createEl("div");
      titleRow.className = "epic-dashboard-slice-title-row";
      titleRow.style.cssText = "display:flex;align-items:flex-start;gap:7px;min-width:0;";
      const parts = this._titleParts(slice.file.name);
      if (parts.id) {
        const id = titleRow.createEl("span", { text: parts.id });
        id.className = "epic-dashboard-short-id";
        id.style.cssText = "flex:none;padding:1px 5px;border-radius:5px;background:var(--background-modifier-hover);color:var(--text-muted);font-family:var(--font-monospace);font-size:0.72em;font-weight:600;";
      }
      this._link(titleRow, slice.file.path, parts.title, source).style.cssText += "flex:1;min-width:0;font-weight:600;";
      const metaRow = row.createEl("div");
      metaRow.className = "epic-dashboard-slice-meta-row";
      metaRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;";
      const presentation = this._statusPresentation(slice.status, api);
      this._chip(
        metaRow, presentation.label, presentation.color,
        `epic-dashboard-pill status-pill ${presentation.className}`,
      );
      const name = String(slice.card || slice.name || slice.title || slice.file.name);
      if (frontier && (frontier === name || frontier === slice.file.name)) {
        this._chip(metaRow, "→ next up", "var(--interactive-accent)", "epic-dashboard-frontier-chip");
      }
      const deps = Array.isArray(slice.depends_on) ? slice.depends_on : [];
      if (deps.length) {
        const needs = metaRow.createEl("span", { text: "needs" });
        needs.style.cssText = "color:var(--text-muted);font-size:var(--font-ui-smaller);";
        for (const dependency of deps) {
          const identity = this._identity(dependency);
          if (!identity) continue;
          const depParts = this._titleParts(identity);
          const link = this._link(metaRow, identity, depParts.id || identity, source);
          link.className += " epic-dashboard-dependency-link";
          link.style.cssText += "font-size:var(--font-ui-smaller);";
        }
      }
      if (["parked", "blocked"].includes(presentation.normalized) && String(slice.resume_condition || "").trim()) {
        const why = row.createEl("div", {
          text: `waiting on: "${String(slice.resume_condition).replace(/\s+/g, " ").trim().slice(0, 140)}"`,
        });
        why.className = "epic-dashboard-waiting-why";
        why.style.cssText = "min-width:0;color:var(--text-muted);font-size:var(--font-ui-smaller);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      }
    }
    if (!slices.length) card.createEl("div", { text: "No slices yet" });
  }

  _renderLinkStrip(dv, root, label, entries, source) {
    if (!entries?.length) return;
    this._section(dv, root, label);
    const strip = root.createEl("div");
    strip.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;";
    for (const entry of entries) {
      const path = typeof entry === "string" ? entry.replace(/^\[\[|\]\]$/g, "").split("|")[0] : entry.path;
      const labelText = typeof entry === "string" ? path.split("/").pop() : (entry.basename || path.split("/").pop());
      const tile = strip.createEl("div");
      tile.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:8px;padding:9px;min-width:0;overflow-wrap:anywhere;";
      this._link(tile, path, labelText, source);
    }
  }

  async render(dv) {
    try {
      const RS = globalThis.customJS?.RenderSafe;
      const current = RS?.page ? RS.page(dv) : null;
      if (!current?.file?.path || !dv?.container?.createEl) return;
      const previous = dv.container.querySelector?.(":scope > .epic-dashboard-root");
      previous?.remove?.();
      const root = dv.container.createEl("div");
      root.className = "epic-dashboard-root";
      root.style.cssText = "display:grid;gap:10px;max-width:760px;";
      const currentFolder = current.file.folder || "";
      const slices = this._slicePages(current.file.path, currentFolder);
      const api = await this._deliveryApi();
      if (!api) {
        root.createEl("div", { text: "Delivery lifecycle unavailable — reinstall delivery and project." });
        return;
      }
      let lifecycle;
      try {
        lifecycle = api.deriveEpicLifecycle(slices);
      } catch (_e) {
        root.createEl("div", { text: "Delivery lifecycle unavailable — reinstall delivery and project." });
        return;
      }
      if (!lifecycle || typeof lifecycle !== "object") {
        root.createEl("div", { text: "Delivery lifecycle unavailable — reinstall delivery and project." });
        return;
      }
      this._renderLifecycle(root, lifecycle);
      this._renderSlices(dv, root, slices, lifecycle, current.file.path, api);
      const groups = this._contextGroups(current.file.path, 3, currentFolder);
      this._renderLinkStrip(dv, root, "Context pack", groups.pack, current.file.path);
      this._renderLinkStrip(dv, root, "Runs", groups.runs, current.file.path);
      this._renderLinkStrip(dv, root, "Lessons", groups.lessons, current.file.path);
      this._renderLinkStrip(dv, root, "Decisions", groups.decisions, current.file.path);
      this._renderLinkStrip(dv, root, "Docs", this._array(current.docs), current.file.path);
    } catch (_e) { /* render-safe: a partial cold-load page is a no-op */ }
  }
}
