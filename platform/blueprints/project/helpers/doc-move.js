// doc-move.js — pure helpers for moving a doc-note to another section /
// sub-section within a project (project blueprint).
//
// Phase 1 of the "Project Doc Updating" feature: ONLY the pure logic the move
// dialogs + the backfill heal build on — target enumeration, destination-path
// computation, section-frontmatter rewrite, and folder->section inference. The
// runtime move itself (app.fileManager.renameFile + processFrontMatter) and the
// browser dialogs are dogfood-only and live in the Phase-2 wiring card
// ([[Project Doc Updating Wiring]]); keeping this logic pure is what lets it be
// regression-tested in the Node harness.
//
// customJS stores classes as INSTANCES (customJS.DocMove = new DocMove()), so
// every method lives on the prototype (instance methods, NOT static) — a static
// method would be undefined on the instance and throw at render time (the
// customjs static-vs-instance trap; see render-safe.js / code-conventions.md).
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class DocMove {
  // Canonical section/sub-section slugify — mirrors entity-create._slugify so a
  // computed target folder matches how new sections are created on disk.
  slugify(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[\/\\:*?"<>|]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // Strip a wikilink ("[[Knowledge]]" -> "Knowledge") and a trailing ".md".
  _strip(v) {
    let s = String(v == null ? "" : v).trim();
    const m = s.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
    if (m) s = m[1];
    return s.replace(/\.md$/i, "").trim();
  }

  _dirname(p) {
    const s = String(p == null ? "" : p);
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(0, i) : "";
  }
  _basename(p) {
    const s = String(p == null ? "" : p);
    const i = s.lastIndexOf("/");
    return i >= 0 ? s.slice(i + 1) : s;
  }

  // Build the ordered list of move targets from already-queried section-hub
  // pages. `hubs` is a normalized array of { label, path, depth, parent }:
  //   depth 1 -> a top-level section (parent ignored)
  //   depth 2 -> a sub-section whose `parent` is its section's display name
  // Returns [{ section, subSection, folder, label }] sorted by (section, sub),
  // where `folder` is the on-disk directory that holds that section-hub (so a
  // moved doc lands next to the hub regardless of slug-vs-name folder legacy).
  sectionTargets(hubs) {
    const list = Array.isArray(hubs) ? hubs : [];
    const out = [];
    const seen = new Set();
    for (const h of list) {
      if (!h) continue;
      const depth = Number(h.depth) || 1;
      const path = String(h.path || "");
      const folder = this._dirname(path);
      const label = this._strip(h.label);
      if (!label) continue;
      let section;
      let subSection;
      if (depth >= 2) {
        section = this._strip(h.parent);
        subSection = label;
        if (!section) continue; // orphan sub-section with no parent — skip
      } else {
        section = label;
        subSection = "";
      }
      const key = JSON.stringify([section, subSection]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        section,
        subSection,
        folder,
        label: subSection ? section + " / " + subSection : section,
      });
    }
    out.sort((a, b) =>
      a.section.localeCompare(b.section) || a.subSection.localeCompare(b.subSection));
    return out;
  }

  // Destination path for a doc when the target section-hub's folder is known
  // (the reliable case — the caller resolved the real hub folder). Joins the
  // folder + the doc's own filename. Returns "" if inputs are unusable.
  targetPath(targetFolder, docPath) {
    const folder = String(targetFolder == null ? "" : targetFolder).replace(/\/+$/, "");
    const file = this._basename(docPath);
    if (!file) return "";
    return folder ? folder + "/" + file : file;
  }

  // Destination folder computed from slugs — the fallback when moving into a
  // section by name (e.g. a section with no existing hub folder resolved).
  // projectsRoot defaults to "spice/projects".
  slugFolder(projectSlug, section, subSection, projectsRoot) {
    const root = String(projectsRoot || "spice/projects").replace(/\/+$/, "");
    const ps = String(projectSlug == null ? "" : projectSlug).trim();
    if (!ps) return "";
    const secSlug = this.slugify(section);
    if (!secSlug) return "";
    const parts = [root, ps, "docs", secSlug];
    const subSlug = this.slugify(subSection);
    if (subSlug) parts.push(subSlug);
    return parts.join("/");
  }

  // True when the doc already lives in the target folder (no-op guard so the
  // dialog can skip / disable a move to the current location).
  isSameLocation(docPath, targetFolder) {
    return this._dirname(docPath) === String(targetFolder == null ? "" : targetFolder).replace(/\/+$/, "");
  }

  // Return the frontmatter patch for a move: sets section + sub_section (empty
  // string for a top-level target). Pure — the caller applies it via
  // processFrontMatter. Preserves the passed object's other keys.
  rewriteSection(fm, section, subSection) {
    const base = fm && typeof fm === "object" ? fm : {};
    return Object.assign({}, base, {
      section: this._strip(section),
      sub_section: subSection ? this._strip(subSection) : "",
    });
  }

  // Infer { section, subSection } from a doc-note's path, for the Phase-2
  // backfill heal on pre-existing docs missing the frontmatter. Reads the raw
  // folder segments AFTER the project's `docs/` folder: first segment ->
  // section, second -> sub_section. Returns raw folder names (which may be slugs
  // or display names in legacy vaults); the caller reconciles against the real
  // section-hub display names. Returns { section: "", subSection: "" } if the
  // path isn't under a docs/ folder or sits directly in docs/.
  inferSectionFromPath(docPath) {
    const s = String(docPath == null ? "" : docPath);
    const parts = s.split("/");
    const di = parts.lastIndexOf("docs");
    if (di < 0) return { section: "", subSection: "" };
    // segments strictly between docs/ and the file itself
    const between = parts.slice(di + 1, parts.length - 1);
    return {
      section: between.length >= 1 ? between[0] : "",
      subSection: between.length >= 2 ? between[1] : "",
    };
  }
}
