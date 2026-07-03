// breadcrumb.js — breadcrumb mechanism v0.1.0 (promoted from the project
// blueprint helper at sauce v0.123.0; originally shipped at sauce v0.103.0 S1).
//
// Shared rendering primitive. customJS.Breadcrumb.render(dv) renders the
// clickable trail at the top of any note whose `type` frontmatter is declared
// in ranch/breadcrumb-registry.json. The registry is aggregated at install
// time from per-blueprint manifest `breadcrumb: { types: { ... } }` blocks
// via applyBreadcrumb() in install.js — the mechanism itself is purely
// generic and knows zero blueprint paths.
//
// Resolver grammar (see Docs/plans/2026-06-17-v0.123.0-breadcrumb-mechanism-design.md §2):
//   • Atoms:      fm:<field> / path:<n> / file:basename|stem / lit:<text>
//   • Transform:  slug:<atom>  (single-level slugify)
//   • Chains:     <atom>|<atom>|...  (first non-empty wins)
//   • Templates:  "<text>{<chain>}<text>{<chain>}..."  (any empty slot → null)
//   • Predicates: when: { "fm:<field>": "present"|"absent"|"<literal>" }
//                 (AND-conjoined across keys)
//
// Registry shape:
//   {
//     "schema_version": 1,
//     "contributions": {
//       "<blueprint>": {
//         "types": {
//           "<type>": {
//             "ancestors": [ { when?, label, link? }, ... ],
//             "current":   { label, link? }   // optional
//           }
//         }
//       }
//     }
//   }
//
// First-match-wins across Object.values(contributions): if two blueprints
// declare the same `type`, the first one in iteration order wins; a one-time
// console.warn is logged. Frontmatter type values are globally unique today.
class Breadcrumb {
  async render(dv) {
    const cur = dv.current();
    if (!cur || !cur.file) return;

    const registry = await this._loadRegistry();
    const entry = this._findTypeEntry(registry, cur);
    if (!entry) return;

    // path_walk mode — arbitrary-depth trail derived from the file's vault path.
    if (entry.path_walk) return this._renderPathWalk(dv, entry.path_walk);

    const trail = this._buildAncestorsSegments(entry, dv);
    if (trail.length === 0) return;

    const html = trail.map((s) => s.link ? this._link(s.label, s.link) : this._currentLabel(s.label));

    const wrap = dv.el("div", "", { cls: "project-breadcrumb" });
    wrap.style.cssText = "font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;";
    wrap.innerHTML = html.join(' <span style="opacity:0.5;"> / </span> ');
  }

  // ── buildSegments — additive DATA seam ─────────────────────────────────
  // Returns the resolved breadcrumb trail as data — [{ label, link|null }] —
  // matching exactly what render(dv) would draw (same ancestors + optional
  // current for ancestors-mode entries; same walked trail for path_walk-mode).
  // A later chrome-bar helper renders the crumbs on the left of its bar and
  // needs the segments as data rather than pre-rendered HTML. Returns [] when
  // there is no matching type entry, on cold load (no cur/file), or when the
  // trail resolves empty — so callers can guard with a simple length check.
  async buildSegments(dv) {
    const cur = dv.current();
    if (!cur || !cur.file) return [];

    const registry = await this._loadRegistry();
    const entry = this._findTypeEntry(registry, cur);
    if (!entry) return [];

    if (entry.path_walk) return this._buildPathWalkSegments(dv, entry.path_walk);

    return this._buildAncestorsSegments(entry, dv);
  }

  // Resolve ancestors[] (+ optional current) into [{ label, link|null }].
  // Shared by render() and buildSegments() so the trail is defined once.
  _buildAncestorsSegments(entry, dv) {
    const segments = [];

    // Ancestors — render in order, skip when-gated entries that fail predicates.
    const ancestors = Array.isArray(entry.ancestors) ? entry.ancestors : [];
    for (const anc of ancestors) {
      if (anc.when && !this._evalWhen(anc.when, dv)) continue;
      const label = this._resolveChain(anc.label || "", dv);
      if (!label) continue; // empty label → drop this ancestor segment
      let link = null;
      if (anc.link) link = this._resolveTemplate(anc.link, dv);
      // link template failed (or absent) → plain bold label (link:null)
      segments.push({ label, link: link || null });
    }

    // Current — optional. Three shapes:
    //   1. omitted → trail ends at last ancestor
    //   2. { label } → plain bold (label resolves; fall back to file:basename if empty)
    //   3. { label, link } → wikilink (falls back to plain bold if link fails)
    if (entry.current) {
      let label = this._resolveChain(entry.current.label || "", dv);
      if (!label) label = this._resolveAtom("file:basename", dv);
      if (label) {
        let link = null;
        if (entry.current.link) link = this._resolveTemplate(entry.current.link, dv);
        segments.push({ label, link: link || null });
      }
    }

    return segments;
  }

  // ── path_walk renderer ─────────────────────────────────────────────────
  // Called when entry.path_walk is present. Builds the breadcrumb trail from
  // the current file's vault path instead of a fixed ancestors[] list.
  //
  // pw = { root_label, root_dir, root_file }
  //
  // Trail shape:
  //   root crumb  (linked to root_dir/root_file)
  //   one crumb per intermediate folder segment between root_dir and the file's
  //     own folder — each links to <accumulated_path>/<Segment>.md
  //   current page crumb — unlinked (plain bold)
  //
  // Edge cases:
  //   • Note IS the root hub (path === root_dir/root_file) → single crumb, current
  //   • Note IS a section hub (basename without .md === its own folder name) → skip
  //     self-crumb (the folder segment already IS the current page label)
  _renderPathWalk(dv, pw) {
    const trail = this._buildPathWalkSegments(dv, pw);
    if (trail.length === 0) return;

    const html = trail.map((s) => s.link ? this._link(s.label, s.link) : this._currentLabel(s.label));

    const wrap = dv.el("div", "", { cls: "project-breadcrumb wiki-breadcrumb" });
    // Prominent + mobile-legible: full-size, non-muted, roomy line-height so the
    // trail is clearly visible (and its crumbs tappable) on a phone. Wiki-only —
    // ancestors-mode breadcrumbs (project/meetings/…) keep their compact style.
    wrap.style.cssText = "font-size: 1em; margin: 2px 0 10px 0; line-height: 1.9;";
    wrap.innerHTML = html.join(' <span style="opacity:0.5;"> / </span> ');
  }

  // Resolve a path_walk trail into [{ label, link|null }]. Shared by
  // _renderPathWalk() and buildSegments() so the walked trail is defined once.
  _buildPathWalkSegments(dv, pw) {
    const cur = dv.current();
    if (!cur || !cur.file) return [];

    const filePath = cur.file.path;
    if (!filePath) return [];

    const rootDir  = pw.root_dir;   // e.g. "spice/wiki"
    const rootFile = pw.root_file;  // e.g. "Wiki.md"
    const rootLabel = pw.root_label; // e.g. "Wiki"
    const rootFullPath = rootDir + "/" + rootFile;

    const segments = [];

    // Determine current page's folder (everything before the last "/").
    const lastSlash = filePath.lastIndexOf("/");
    const fileFolder = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
    // Basename without extension.
    const fileBasename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
    const fileStem = fileBasename.endsWith(".md")
      ? fileBasename.slice(0, -3)
      : fileBasename;

    // Current page label: prefer fm:title, fall back to stem.
    const pageLabel = (cur.title && String(cur.title).trim()) || fileStem;

    // ── Root is current? (note IS the root hub) ────────────────────────────
    if (filePath === rootFullPath) {
      segments.push({ label: rootLabel, link: null });
      return segments;
    }

    // ── Root crumb — always linked ─────────────────────────────────────────
    segments.push({ label: rootLabel, link: rootFullPath });

    // ── Intermediate folder segments ────────────────────────────────────────
    // Strip the root_dir prefix (+1 for the "/") to get the relative folder path.
    // e.g. fileFolder="spice/wiki/infra/aws" → relative="infra/aws"
    let relFolder = "";
    if (fileFolder.startsWith(rootDir + "/")) {
      relFolder = fileFolder.slice(rootDir.length + 1); // "infra/aws" or "infra" or ""
    } else if (fileFolder === rootDir) {
      relFolder = "";
    }

    // Determine whether the current note IS a section hub:
    // that happens when the file's stem equals its own immediate folder's name.
    // e.g. "spice/wiki/infra/Infra.md" → stem="Infra", immediate folder seg="infra"
    // (case-insensitive comparison since folder names are slugified but file titles are Display Case)
    const immediateFolder = relFolder
      ? relFolder.split("/").slice(-1)[0]  // last segment of the relative folder path
      : null;
    const isSectionHub = immediateFolder !== null
      && fileStem.toLowerCase() === immediateFolder.toLowerCase();

    if (relFolder) {
      const relSegs = relFolder.split("/");
      let accumulated = rootDir;
      for (let i = 0; i < relSegs.length; i++) {
        const seg = relSegs[i];
        accumulated = accumulated + "/" + seg;
        // Skip the final folder segment when the current note IS the section hub
        // (it would be a self-crumb — e.g. "infra" → "Infra.md" which IS this note).
        const isLastSeg = i === relSegs.length - 1;
        if (isLastSeg && isSectionHub) continue;
        // Resolve the section-hub note living DIRECTLY in `accumulated` so the crumb
        // shows its display title + links to its real path. Folder names are slugified
        // (lower-case, e.g. "infra"/"aws") but hub notes are Display-Case ("Infra.md"/
        // "AWS.md") — using the raw segment would render lower-case labels and produce
        // links that only resolve on a case-insensitive filesystem. Fall back to the
        // segment when no hub is found (defensive; e.g. a folder with pages but no hub).
        let segLabel = seg;
        let segLink = accumulated + "/" + seg + ".md";
        try {
          const raw = dv.pages('"' + accumulated + '"');
          const list = raw && typeof raw.array === "function" ? raw.array() : Array.from(raw || []);
          const hub = list.find((p) => p && p.type === "wiki-section" && p.file && p.file.folder === accumulated);
          if (hub && hub.file) {
            segLabel = (hub.title && String(hub.title).trim()) || (hub.file.name ? String(hub.file.name).replace(/\.md$/, "") : seg);
            segLink = hub.file.path;
          }
        } catch (_e) { /* keep the folder-segment fallback */ }
        segments.push({ label: segLabel, link: segLink });
      }
    }

    // ── Current page crumb — always unlinked ───────────────────────────────
    // For a section hub the label is the fm:title (e.g. "Infra"), not the folder
    // slug ("infra"). For a page it is also fm:title.
    segments.push({ label: pageLabel, link: null });

    return segments;
  }

  // ── Registry load ──────────────────────────────────────────────────────
  // Read ranch/breadcrumb-registry.json via app.vault.adapter.read. Cache on
  // the instance so a single render pass doesn't re-read. CustomJS keeps one
  // instance per class for the vault session, so this cache is effectively
  // session-scoped — a mid-session re-install that rewrites the registry will
  // not be picked up until Cmd+R. The install side already protects the file
  // (C4 hardening in applyBreadcrumb); the user-reload-after-install path is
  // the documented contract. Tolerate missing / malformed silently (render
  // nothing) but emit a one-line console hint on JSON parse failure so a
  // hand-edited registry file with bad JSON is easy to diagnose.
  async _loadRegistry() {
    if (this._registryCache !== undefined) return this._registryCache;
    const empty = { schema_version: 1, contributions: {} };
    const REGISTRY_PATH = "ranch/breadcrumb-registry.json";
    try {
      // global `app` provided by Obsidian at runtime
      const raw = await app.vault.adapter.read(REGISTRY_PATH);
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && parsed.contributions && typeof parsed.contributions === "object") {
          this._registryCache = parsed;
          return parsed;
        }
        this._registryCache = empty;
        return empty;
      } catch (_e) {
        try { console.warn("[breadcrumb] malformed ranch/breadcrumb-registry.json — rendering nothing"); } catch (_) {}
        this._registryCache = empty;
        return empty;
      }
    } catch (_e) {
      // ENOENT / missing file → empty registry
      this._registryCache = empty;
      return empty;
    }
  }

  // First-match-wins scan over contributions for cur.type. One-time
  // console.warn on collision (multiple contributions declaring the same type).
  _findTypeEntry(registry, cur) {
    const type = cur && cur.type;
    if (!type) return null;
    let found = null;
    let foundSource = null;
    const collisions = [];
    for (const [source, contribution] of Object.entries(registry.contributions || {})) {
      const types = contribution && contribution.types;
      if (!types || typeof types !== "object") continue;
      const entry = types[type];
      if (entry) {
        if (!found) {
          found = entry;
          foundSource = source;
        } else {
          collisions.push(source);
        }
      }
    }
    if (collisions.length > 0) {
      if (!Breadcrumb._warnedCollisions) Breadcrumb._warnedCollisions = new Set();
      const key = `${type}:${foundSource}:${collisions.join(",")}`;
      if (!Breadcrumb._warnedCollisions.has(key)) {
        Breadcrumb._warnedCollisions.add(key);
        try {
          console.warn(`[breadcrumb] type "${type}" declared by multiple contributions; using ${foundSource}, ignoring ${collisions.join(", ")}`);
        } catch (_e) {}
      }
    }
    return found;
  }

  // ── Resolver primitives ────────────────────────────────────────────────
  // Atom: switch on prefix. Returns string ("" if missing/empty).
  _resolveAtom(atom, dv) {
    if (!atom || typeof atom !== "string") return "";
    // slug:<atom> — single-level transform.
    if (atom.startsWith("slug:")) {
      const inner = atom.slice(5);
      return this._slugify(this._resolveAtom(inner, dv));
    }
    if (atom.startsWith("fm:")) {
      const field = atom.slice(3);
      const cur = dv.current();
      if (!cur) return "";
      return this._stripLink(cur[field]);
    }
    if (atom.startsWith("path:")) {
      // Indexed 0-based — `spice/projects/<slug>/...` → path:2 = <slug>. The
      // design-doc examples (e.g. `spice/projects/{path:2}/...`) require this
      // indexing for parity with the legacy helper's projectSlug resolution.
      const n = parseInt(atom.slice(5), 10);
      if (!Number.isFinite(n) || n < 0) return "";
      const cur = dv.current();
      const filePath = (cur && cur.file && cur.file.path) || "";
      const segs = String(filePath).split("/");
      const v = segs[n];
      return v == null ? "" : String(v);
    }
    if (atom === "file:basename" || atom === "file:stem") {
      const cur = dv.current();
      return (cur && cur.file && cur.file.name) ? String(cur.file.name) : "";
    }
    if (atom.startsWith("lit:")) {
      return atom.slice(4);
    }
    return "";
  }

  // Chain: <atom>|<atom>|... — first non-empty atom wins.
  _resolveChain(chain, dv) {
    if (!chain || typeof chain !== "string") return "";
    const atoms = chain.split("|");
    for (const a of atoms) {
      const v = this._resolveAtom(a, dv);
      if (v !== "" && v != null) return v;
    }
    return "";
  }

  // Template: "<text>{<chain>}<text>{<chain>}..." — any empty slot → null.
  _resolveTemplate(tpl, dv) {
    if (!tpl || typeof tpl !== "string") return null;
    let failed = false;
    const out = tpl.replace(/\{([^}]+)\}/g, (_m, inner) => {
      const v = this._resolveChain(inner, dv);
      if (v === "" || v == null) { failed = true; return ""; }
      return v;
    });
    if (failed) return null;
    return out;
  }

  // Predicate evaluation. For each key "fm:<field>", read FM value and
  // compare to predicate. AND-conjoined across keys.
  //   "present"  → non-empty after wikilink-strip
  //   "absent"   → empty / missing
  //   "<literal>" → exact match (after wikilink-strip)
  _evalWhen(whenObj, dv) {
    if (!whenObj || typeof whenObj !== "object") return true;
    for (const [key, pred] of Object.entries(whenObj)) {
      if (!key.startsWith("fm:")) {
        // unknown predicate key → fail closed
        return false;
      }
      const field = key.slice(3);
      const cur = dv.current();
      const raw = cur ? cur[field] : undefined;
      const stripped = this._stripLink(raw);
      if (pred === "present") {
        // Numbers / booleans count as present even when _stripLink returns "".
        const isPresent = stripped !== "" && stripped != null
          ? true
          : (raw !== undefined && raw !== null && raw !== "");
        if (!isPresent) return false;
      } else if (pred === "absent") {
        const isPresent = stripped !== "" && stripped != null
          ? true
          : (raw !== undefined && raw !== null && raw !== "");
        if (isPresent) return false;
      } else {
        // Literal compare — prefer the wikilink-stripped form for strings, but
        // fall back to the raw FM value for numbers / booleans so `depth: 2`
        // matches `"fm:depth": "2"`.
        const candidate = (stripped !== "" && stripped != null)
          ? String(stripped)
          : (raw === undefined || raw === null ? "" : String(raw));
        if (candidate !== String(pred)) return false;
      }
    }
    return true;
  }

  // ── HTML primitives (preserved byte-for-byte from legacy) ──────────────
  // Emit an Obsidian-native wikilink as an anchor with the canonical
  // `[[${vaultPath}|${label}]]` data-href shape — click + hover-preview wire
  // through Obsidian's openLinkText + internal-link handlers natively.
  _link(label, vaultPath) {
    const wikilink = `[[${vaultPath}|${this._escape(label)}]]`;
    return `<a class="internal-link" data-href="${vaultPath}" href="${vaultPath}" target="_blank" rel="noopener" aria-label="${wikilink}">${this._escape(label)}</a>`;
  }
  _currentLabel(label) { return `<span style="font-weight:600; color: var(--text-normal);">${this._escape(label)}</span>`; }
  _stripLink(v) {
    if (!v) return "";
    if (typeof v === "string") return v.replace(/^\[\[|\]\]$/g, "").split("|")[0];
    if (v.display) return v.display;
    if (v.path) return v.path.split("/").pop().replace(/\.md$/, "");
    return "";
  }
  _slugify(s) {
    return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  _escape(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
}
