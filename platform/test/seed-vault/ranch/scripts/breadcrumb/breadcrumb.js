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

    const segments = [];

    // Ancestors — render in order, skip when-gated entries that fail predicates.
    const ancestors = Array.isArray(entry.ancestors) ? entry.ancestors : [];
    for (const anc of ancestors) {
      if (anc.when && !this._evalWhen(anc.when, dv)) continue;
      const label = this._resolveChain(anc.label || "", dv);
      if (!label) continue; // empty label → drop this ancestor segment
      let link = null;
      if (anc.link) link = this._resolveTemplate(anc.link, dv);
      if (link) {
        segments.push(this._link(label, link));
      } else {
        // link template failed (or absent) → plain bold label
        segments.push(this._currentLabel(label));
      }
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
        if (link) {
          segments.push(this._link(label, link));
        } else {
          segments.push(this._currentLabel(label));
        }
      }
    }

    if (segments.length === 0) return;

    const wrap = dv.el("div", "", { cls: "project-breadcrumb" });
    wrap.style.cssText = "font-size: 0.85em; color: var(--text-muted); margin-bottom: 8px;";
    wrap.innerHTML = segments.join(' <span style="opacity:0.5;"> / </span> ');
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
