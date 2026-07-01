// workstream-source.js — WorkstreamSource (Workstreams Hub, Slice 1).
//
// Single source-of-truth resolver for a project's `workstreams`, which today is
// split between the hub (atlas, type:project) note and the Map (type:map) note
// (the ProjectWorkstreamManager dual-writes both). This slice lands the PURE
// resolver + its semantics only — NO reader is rewired yet (Slice 2 re-points the
// readers; Slice 3/4 migrate + heal).
//
// Semantics — MAP-CANONICAL, HUB-PRESERVING UNION (deliberately non-lossy):
//   - The Map note is the source of truth for ORDER and for shared entries.
//   - Any hub-only workstream (an id on the hub but NOT on the Map) is APPENDED,
//     never dropped. Slice-0 analysis (scripts/autoloop/analyze-workstreams.js)
//     found headspace `sauce` carries `finance-blueprint` on the hub but not the
//     Map, so a strict "map-wins" rule would SILENTLY DELETE a real workstream.
//     The plan's Slice-4 heal is explicitly "data-preserving", so the resolver
//     never loses data. (This intentionally refines the plan's literal "map wins
//     when non-empty" to a hub-preserving union — flagged in the Slice-1 card.)
//   - Empty Map -> hub (fallback). Empty hub -> Map. Dedup by id; the Map's
//     object wins for a shared id.
//
// customJS stores classes as INSTANCES (customJS.WorkstreamSource = new …), so
// every method is an instance method (NOT static). This file MUST stay a bare
// class expression with NO trailing statements — the customJS loader evals the
// whole file as one expression `("+file+")`; a module.exports / if trailer would
// make it "Unexpected token" and the class would never register (lesson:
// customjs-no-trailing-statements).
class WorkstreamSource {
  // Normalize a raw `workstreams` frontmatter value into an ordered array of
  // { id, name, ... } objects, deduped by id (first wins). Accepts an array of
  // objects, an array of bare id strings, a JSON-encoded string of either, or
  // null/garbage (-> []). An object's identity is `id` (falling back to `name`);
  // items with no usable identity are dropped; `name` defaults to the id.
  parse(value) {
    let raw = value;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      try { raw = JSON.parse(s); } catch (_e) { raw = [s]; }
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
      let ws = null;
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        // Identity is `id`, falling back to `name` when `id` is absent OR empty/
        // whitespace — so a malformed `{ id: "", name: "Ops" }` still counts (never
        // silently dropped; same data-preservation stance as the union resolver).
        let id = String(entry.id != null ? entry.id : "").trim();
        if (!id) id = String(entry.name != null ? entry.name : "").trim();
        if (!id) continue;
        ws = Object.assign({}, entry, { id });
        if (ws.name == null || String(ws.name).trim() === "") ws.name = id;
      } else if (typeof entry === "string" || typeof entry === "number") {
        const id = String(entry).trim();
        if (!id) continue;
        ws = { id, name: id };
      }
      if (!ws || seen.has(ws.id)) continue;
      seen.add(ws.id);
      out.push(ws);
    }
    return out;
  }

  // Resolve the canonical workstream list from the hub + Map frontmatter objects.
  // @param {object} o - { mapFrontmatter, hubFrontmatter } (each a note's fm; may
  //   be null/undefined). Reads `.workstreams` off each. Returns the map-canonical
  //   hub-preserving union (see file header). Never throws.
  resolve(o) {
    const mapFm = o && o.mapFrontmatter;
    const hubFm = o && o.hubFrontmatter;
    const map = this.parse(mapFm && mapFm.workstreams);
    const hub = this.parse(hubFm && hubFm.workstreams);
    if (!map.length) return hub;
    if (!hub.length) return map;
    const ids = new Set(map.map((w) => w.id));
    const out = map.slice();
    for (const w of hub) {
      if (!ids.has(w.id)) { ids.add(w.id); out.push(w); }
    }
    return out;
  }
}
