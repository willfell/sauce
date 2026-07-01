// links.js — links mechanism v0.1.0.
//
// Reusable "helpful links" primitive. A note declares a `links` frontmatter
// array of { url, text } entries; consumers parse it into a normalized shape
// (customJS.Links.parse) and render a read-only list of external anchors in
// added order (customJS.Links.render). First consumer is the project blueprint
// (per-project Link Hub note), but the primitive is deliberately generic so
// daily/meeting/other note types can adopt it later.
//
// customJS stores classes as INSTANCES (customJS.Links = new Links()), so every
// method lives on the prototype (instance methods, NOT static) — a static method
// would be undefined on the instance and throw at render time (the customjs
// static-vs-instance trap; see render-safe.js / code-conventions.md).
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class Links {
  // Normalize a raw `links` frontmatter value into an ordered [{ url, text }].
  // Accepts: an array of objects ({url,text} | {url,label} | {href,text} | …),
  // an array of bare URL strings, a JSON-encoded string of either, or
  // null/undefined/garbage (-> []). Entries without a usable url are dropped;
  // text defaults to the url. Order is preserved; duplicate urls keep the first.
  parse(value) {
    let raw = value;
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      try { raw = JSON.parse(s); }
      catch (_e) { raw = [s]; } // a bare url string -> single entry
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
      let url = "";
      let text = "";
      if (entry && typeof entry === "object") {
        url = entry.url || entry.href || entry.link || "";
        text = entry.text || entry.label || entry.title || entry.name || "";
      } else if (typeof entry === "string") {
        url = entry;
      }
      url = String(url == null ? "" : url).trim();
      text = String(text == null ? "" : text).trim();
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, text: text || url });
    }
    return out;
  }

  // Render a read-only list of external links into a container.
  // dv:   a Dataview-like object with .container (or the container element).
  // opts: { links, title?, empty? } — `links` may be a raw frontmatter value or
  //       an already-parsed array; both are normalized through parse().
  // Never throws (cold-load safe). Returns the number of links rendered.
  render(dv, opts) {
    const o = opts || {};
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return 0;
    const links = this.parse(o.links);
    if (o.title) {
      const lbl = c.createEl("div");
      lbl.textContent = String(o.title);
      lbl.style.cssText = "font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin: 0 0 6px 0; font-weight: 600;";
    }
    if (!links.length) {
      if (o.empty) {
        const em = c.createEl("div");
        em.textContent = String(o.empty);
        em.style.cssText = "color: var(--text-muted); font-style: italic;";
      }
      return 0;
    }
    const list = c.createEl("div");
    list.style.cssText = "display: flex; flex-direction: column; gap: 4px;";
    for (const link of links) {
      const a = list.createEl("a", { text: link.text, href: link.url });
      if (a && typeof a.setAttr === "function") {
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
      if (a && a.style) a.style.cssText = "color: var(--text-accent);";
    }
    return links.length;
  }
}
