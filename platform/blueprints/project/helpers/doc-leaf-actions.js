// doc-leaf-actions.js — DocLeafActions (Project Doc Updating Wiring, PR2).
//
// Inline action bar on doc-note leaves. PR2 ships one action: a "Move" button
// that opens a section picker and relocates the current doc to another
// section / sub-section within its project. All decision logic reuses the
// already-tested customJS.DocMove pure helpers (sectionTargets / targetPath /
// rewriteSection / isSameLocation); the runtime move (app.fileManager.renameFile
// + processFrontMatter) and the modal are dogfood-only. Mirrors
// MeetingLeafActions' structural conventions (RenderSafe cold-load guard,
// AccentButton flex row, overlay modal); the pure normalizeHubs helper is
// unit-tested headlessly.
//
// customJS stores classes as INSTANCES (customJS.DocLeafActions = new …), so
// render + handlers are instance methods. normalizeHubs is a static pure helper
// (referenced by class name, DocLeafActions.normalizeHubs) so it is exercisable
// without a live vault.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class DocLeafActions {
  // Normalize queried section-hub pages into the { label, path, depth, parent }
  // shape DocMove.sectionTargets expects. Pure + static (unit-tested). `label`
  // is the section's display name (frontmatter `section`, falling back to the
  // hub file's basename); `parent` is the parent_section for depth-2 hubs.
  static normalizeHubs(pages) {
    const out = [];
    for (const p of (pages || [])) {
      if (!p) continue;
      const file = p.file || {};
      out.push({
        label: p.section || file.name || "",
        path: p.path || file.path || "",
        depth: Number(p.depth) || 1,
        parent: p.parent_section || "",
      });
    }
    return out;
  }

  // Derive the project root dir from a doc-note path
  // ("spice/projects/<slug>/docs/<section>/…/doc.md" -> "spice/projects/<slug>").
  // Returns "" when the path isn't under a project docs/ folder.
  projectDirFor(docPath) {
    const s = String(docPath == null ? "" : docPath);
    const di = s.indexOf("/docs/");
    if (di < 0) return "";
    return s.slice(0, di);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  async render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    if (page.type !== "doc-note") return;         // only on doc notes
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    if (c.closest && c.closest(".markdown-embed")) return;

    // Leading hairline via the canonical SectionLabel.divider primitive: Doc
    // Note.md no longer carries a literal `---` between the nav row and this
    // action bar (helpers own dividers now), so render our own leading hairline
    // to stay visually separated from the ProjectNavButtons row above. Guarded
    // so a cold-load where section-label hasn't registered yet can't throw.
    if (customJS && customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
      customJS.SectionLabel.divider(c);
    }

    const moveIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 11 15 14"/></svg>`;

    const row = c.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";
    const currentPath = page.file.path;
    customJS.AccentButton.render(row, { label: "Move", icon: moveIcon, flex: true, onClick: () => {
      // Prefer the wiki-style indented Move tree dialog; fall back to the legacy
      // flat DocMove picker if the newer helper hasn't loaded (cold-load safety).
      if (customJS?.DocMoveDialog?._openMoveDialog) {
        customJS.DocMoveDialog._openMoveDialog(dv, currentPath);
      } else {
        this._onMove(dv);
      }
    } });
  }

  // ── data source ──────────────────────────────────────────────────────────
  _listSectionHubs(dv, projectDir) {
    try {
      return dv.pages('"' + projectDir + '"').where((p) => p && p.type === "section-hub").array();
    } catch (_e) { return []; }
  }

  // ── handler ────────────────────────────────────────────────────────────────
  _onMove(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) { new Notice("Open a doc note to move it."); return; }
    const docPath = cur.file.path;
    const file = app.vault.getAbstractFileByPath(docPath);
    if (!file) { new Notice("Could not resolve the current note."); return; }
    const dm = window.customJS && window.customJS.DocMove;
    if (!dm) { new Notice("DocMove helper unavailable — reinstall the project blueprint.", 6000); return; }
    const projectDir = this.projectDirFor(docPath);
    if (!projectDir) { new Notice("This note isn't inside a project's docs/ folder."); return; }

    const hubs = DocLeafActions.normalizeHubs(this._listSectionHubs(dv, projectDir));
    const targets = dm.sectionTargets(hubs);
    if (!targets.length) { new Notice("No sections found to move into."); return; }

    this._openModal({ title: "Move doc to section", build: (panel, close) => {
      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:6px; margin-top:10px; max-height:56vh; overflow:auto;";
      for (const t of targets) {
        const here = dm.isSameLocation(docPath, t.folder);
        const b = list.createEl("button", { text: here ? t.label + "  (current)" : t.label });
        b.style.cssText = "text-align:left; padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); cursor:pointer;";
        if (here) { b.disabled = true; b.style.opacity = "0.5"; b.style.cursor = "not-allowed"; continue; }
        b.onclick = async () => {
          try {
            const dest = dm.targetPath(t.folder, docPath);
            if (!dest) { new Notice("Could not compute the destination path."); return; }
            if (app.vault.getAbstractFileByPath(dest)) {
              new Notice("A doc with that name already exists in " + t.label + ".", 6000);
              return;
            }
            await app.fileManager.renameFile(file, dest);
            const moved = app.vault.getAbstractFileByPath(dest) || file;
            await app.fileManager.processFrontMatter(moved, (fm) => {
              const patch = dm.rewriteSection(fm, t.section, t.subSection);
              fm.section = patch.section;
              fm.sub_section = patch.sub_section;
            });
            new Notice("Moved to " + t.label);
          } catch (e) { new Notice("Could not move: " + (e.message || e), 6000); }
          close();
        };
      }
    }});
  }

  // ── modal overlay (mirrors MeetingLeafActions._openModal) ──────────────────
  _openModal({ title, build }) {
    const prior = document.querySelector(".sauce-doc-modal-overlay");
    if (prior) prior.remove();
    const overlay = document.body.createDiv({ cls: "sauce-doc-modal-overlay" });
    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9999;";
    const modal = overlay.createDiv();
    modal.style.cssText = "background: var(--background-primary, #1c1c1c); color: var(--text-normal, #ddd); border: 1px solid var(--background-modifier-border, #444); border-radius: 10px; padding: 18px 20px; width: min(440px, 92vw); max-height: 80vh; overflow: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);";
    const escListener = (ev) => { if (ev.key === "Escape") close(); };
    const close = () => { document.removeEventListener("keydown", escListener); overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener("keydown", escListener);
    const h = modal.createEl("div", { text: title });
    h.style.cssText = "font-weight:600; font-size:1.05em; margin-bottom:4px;";
    build(modal, close);
  }
}
