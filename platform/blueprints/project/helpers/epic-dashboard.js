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
    if (typeof this._injectedLifecycleApi?.deriveEpicLifecycle === "function") return this._injectedLifecycleApi;
    if (typeof this._resolvedLifecycleApi?.deriveEpicLifecycle === "function") return this._resolvedLifecycleApi;
    try {
      if (typeof globalThis.SauceDelivery?.deriveEpicLifecycle === "function") return (this._resolvedLifecycleApi = globalThis.SauceDelivery);
      if (typeof globalThis.customJS?.DeliveryContract?.deriveEpicLifecycle === "function") return (this._resolvedLifecycleApi = globalThis.customJS.DeliveryContract);
      const realApp = this._app();
      const adapter = realApp?.vault?.adapter;
      const contentPath = await this._contentPath(adapter);
      const deliveryRoot = `${contentPath}/delivery`;
      const req = typeof globalThis.require === "function" ? globalThis.require : null;
      const fullPath = adapter?.getFullPath?.(`${deliveryRoot}/index.js`);
      if (req && fullPath) {
        const api = req(fullPath);
        if (typeof api?.deriveEpicLifecycle === "function") return (this._resolvedLifecycleApi = api);
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
        if (typeof indexModule.exports?.deriveEpicLifecycle === "function") return (this._resolvedLifecycleApi = indexModule.exports);
      }
    } catch (_e) {}
    return null;
  }

  _statusKind(status) {
    const value = String(status || "planning").toLowerCase();
    if (["deployed", "completed", "done"].includes(value)) return "done";
    if (["parked", "blocked"].includes(value)) return "overdue";
    return "open";
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
    const chip = header.createEl("span", { text: String(lifecycle.state || "planned") });
    chip.className = "epic-dashboard-state";
    chip.style.cssText = "border-radius:999px;padding:2px 8px;background:var(--background-modifier-hover);font-size:var(--font-ui-smaller);font-weight:600;";
    const total = Number(counts.total ?? (Number(counts.done || 0) + Number(counts.active || 0) + Number(counts.blocked || 0) + Number(counts.planned || 0)));
    const done = Number(counts.done || 0);
    const progress = card.createEl("div");
    progress.style.cssText = "height:6px;border-radius:999px;background:var(--background-modifier-border);overflow:hidden;";
    const fill = progress.createEl("div");
    fill.style.cssText = `height:100%;width:${total ? Math.round(done / total * 100) : 0}%;background:var(--interactive-accent);`;
    const metrics = card.createEl("div");
    metrics.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;color:var(--text-muted);font-size:var(--font-ui-smaller);";
    for (const [value, label] of [[done, "deployed"], [counts.active || 0, "in flight"], [counts.blocked || 0, "blocked"], [counts.planned || 0, "planned"]]) {
      metrics.createEl("span", { text: `${value} ${label}` });
    }
  }

  _renderSlices(dv, root, slices, lifecycle, source) {
    this._section(dv, root, "Slices");
    const card = root.createEl("div");
    card.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:10px;overflow:hidden;";
    const frontier = String(lifecycle.frontier || "");
    for (const slice of slices) {
      const row = card.createEl("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--background-modifier-border);flex-wrap:wrap;min-width:0;";
      this._link(row, slice.file.path, slice.file.name, source).style.cssText += "flex:1;min-width:120px;";
      const kind = this._statusKind(slice.status);
      const pill = row.createEl("span", { text: String(slice.status || "planning") });
      pill.className = `epic-dashboard-pill status-pill ${kind}`;
      pill.style.cssText = "border-radius:999px;padding:2px 7px;background:var(--background-modifier-hover);font-size:var(--font-ui-smaller);";
      const name = String(slice.card || slice.name || slice.title || slice.file.name);
      if (frontier && (frontier === name || frontier === slice.file.name)) row.createEl("span", { text: "frontier" });
      const deps = Array.isArray(slice.depends_on) ? slice.depends_on : [];
      if (deps.length) row.createEl("span", { text: `depends on ${deps.join(", ")}` });
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
      this._renderSlices(dv, root, slices, lifecycle, current.file.path);
      const groups = this._contextGroups(current.file.path, 3, currentFolder);
      this._renderLinkStrip(dv, root, "Context pack", groups.pack, current.file.path);
      this._renderLinkStrip(dv, root, "Runs", groups.runs, current.file.path);
      this._renderLinkStrip(dv, root, "Lessons", groups.lessons, current.file.path);
      this._renderLinkStrip(dv, root, "Decisions", groups.decisions, current.file.path);
      this._renderLinkStrip(dv, root, "Docs", this._array(current.docs), current.file.path);
    } catch (_e) { /* render-safe: a partial cold-load page is a no-op */ }
  }
}
