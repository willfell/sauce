// doc-bulk-move.js — DocBulkMoveActions (Project Doc Updating Wiring, PR3).
//
// A "Move docs" affordance on the project Docs hub (type: docs-hub). Opens a
// multi-select dialog: the project's docs grouped by section, plus a target
// section/sub-section picker; moves every selected doc to the target via the
// already-tested customJS.DocMove pure helpers (sectionTargets / targetPath /
// rewriteSection / isSameLocation). Sibling of PR2's DocLeafActions single-doc
// Move button. The runtime batch move (renameFile + processFrontMatter per doc)
// and the modal are dogfood-only; the decision logic that CAN be tested lives in
// the static pure helpers groupDocsBySection / planBulkMove / normalizeHubs.
//
// customJS stores classes as INSTANCES (customJS.DocBulkMoveActions = new …), so
// render + handlers are instance methods; the pure helpers are static (referenced
// by class name) so the Node harness can exercise them without a live vault.
//
// This file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; a
// module.exports / if / const trailer would make it "Unexpected token" and the
// class would silently never register (lesson: customjs-no-trailing-statements).
class DocBulkMoveActions {
  // Normalize queried section-hub pages into the { label, path, depth, parent }
  // shape DocMove.sectionTargets expects (mirrors DocLeafActions.normalizeHubs).
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

  // Strip a leading/trailing wikilink ("[[Knowledge|Kb]]" -> "Knowledge").
  static _strip(v) {
    let s = String(v == null ? "" : v).trim();
    const m = s.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
    if (m) s = m[1];
    return s.trim();
  }

  // Group the project's doc-note pages by their `section` frontmatter for the
  // multi-select list. Docs with no/blank section fall under "(unsectioned)".
  // Returns [{ section, docs: [{ path, name, subSection }] }] sorted by section
  // then doc name; each doc keeps its path (identity for the move).
  static groupDocsBySection(docPages) {
    const groups = new Map();
    for (const p of (docPages || [])) {
      if (!p) continue;
      const file = p.file || {};
      const section = DocBulkMoveActions._strip(p.section) || "(unsectioned)";
      const doc = {
        path: String(p.path || file.path || ""),
        name: String(file.name || "").replace(/\.md$/, "") || DocBulkMoveActions._strip(file.name),
        subSection: DocBulkMoveActions._strip(p.sub_section),
      };
      if (!doc.path) continue;
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(doc);
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([section, docs]) => ({
        section,
        docs: docs.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }

  // Plan the batch of moves for the selected docs into `target`
  // ({ section, subSection, folder }). Pure — uses the DocMove instance for
  // targetPath + isSameLocation only. Skips docs already in the target
  // (already-there), docs with no computable destination (no-dest), and docs
  // whose destination collides with an earlier selection's destination
  // (collision — same basename into the same folder). Returns
  // { moves: [{ from, to, section, subSection }], skipped: [{ path, reason }] }.
  static planBulkMove(selectedDocs, target, docMove) {
    const moves = [];
    const skipped = [];
    const destSeen = new Set();
    const t = target || {};
    for (const d of (selectedDocs || [])) {
      const from = (d && typeof d === "object") ? String(d.path || "") : String(d || "");
      if (!from) continue;
      if (docMove.isSameLocation(from, t.folder)) { skipped.push({ path: from, reason: "already-there" }); continue; }
      const to = docMove.targetPath(t.folder, from);
      if (!to) { skipped.push({ path: from, reason: "no-dest" }); continue; }
      if (destSeen.has(to)) { skipped.push({ path: from, reason: "collision" }); continue; }
      destSeen.add(to);
      moves.push({ from, to, section: t.section, subSection: t.subSection });
    }
    return { moves, skipped };
  }

  // ── render ─────────────────────────────────────────────────────────────────
  async render(dv, opts = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;              // cold-load guard
    if (page.type !== "docs-hub") return;         // only on the Docs hub
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    if (c.closest && c.closest(".markdown-embed")) return;

    const moveIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="12 11 12 17"/><polyline points="9 14 12 11 15 14"/></svg>`;
    const row = c.createEl("div");
    row.style.cssText = "display: flex; gap: 12px; margin: 0.5em auto; justify-content: center; align-items: stretch; max-width: 600px; flex-wrap: wrap;";
    customJS.AccentButton.render(row, { label: "Move docs", icon: moveIcon, onClick: () => this._onBulkMove(dv), flex: true });
  }

  // ── data sources ───────────────────────────────────────────────────────────
  // The docs-hub note (Docs.md) lives at spice/projects/<slug>/docs/Docs.md, so
  // its own folder IS the docs folder to scan (mirrors ProjectDocsIndex, which
  // derives docsFolder = currentFile.folder). Returns "" when the note is not a
  // docs hub under a project's docs/ folder.
  docsFolderFor(page) {
    const f = page && page.file ? page.file : {};
    let folder = f.folder != null ? String(f.folder) : "";
    if (!folder) {
      const p = String(f.path || "");
      const i = p.lastIndexOf("/");
      folder = i >= 0 ? p.slice(0, i) : "";
    }
    return /^spice\/projects\/[^/]+\/docs$/.test(folder) ? folder : "";
  }
  _listSectionHubs(dv, docsFolder) {
    try { return dv.pages('"' + docsFolder + '"').where((p) => p && p.type === "section-hub").array(); }
    catch (_e) { return []; }
  }
  _listDocs(dv, docsFolder) {
    try { return dv.pages('"' + docsFolder + '"').where((p) => p && p.type === "doc-note").array(); }
    catch (_e) { return []; }
  }

  // ── handler ────────────────────────────────────────────────────────────────
  _onBulkMove(dv) {
    const page = dv.current && dv.current();
    if (!page || !page.file) { new Notice("Open the project Docs hub to move docs."); return; }
    const dm = window.customJS && window.customJS.DocMove;
    if (!dm) { new Notice("DocMove helper unavailable — reinstall the project blueprint.", 6000); return; }
    const docsFolder = this.docsFolderFor(page);
    if (!docsFolder) { new Notice("Open the project Docs hub to move docs."); return; }

    const targets = dm.sectionTargets(DocBulkMoveActions.normalizeHubs(this._listSectionHubs(dv, docsFolder)));
    if (!targets.length) { new Notice("No sections found to move into."); return; }
    const grouped = DocBulkMoveActions.groupDocsBySection(this._listDocs(dv, docsFolder));
    if (!grouped.length) { new Notice("No docs found to move."); return; }

    const selected = new Set();
    let targetIdx = 0;
    this._openModal({ title: "Move docs to a section", build: (panel, close) => {
      const targetWrap = panel.createEl("div");
      targetWrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin:10px 0;";
      const tl = targetWrap.createEl("label", { text: "Target section" });
      tl.style.cssText = "font-size:0.85em; color:var(--text-muted);";
      const sel = targetWrap.createEl("select");
      sel.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
      targets.forEach((t, i) => { const o = sel.createEl("option", { text: t.label }); o.value = String(i); });
      sel.onchange = () => { targetIdx = Number(sel.value) || 0; };

      const list = panel.createEl("div");
      list.style.cssText = "display:flex; flex-direction:column; gap:2px; margin:8px 0; max-height:46vh; overflow:auto;";
      for (const g of grouped) {
        const head = list.createEl("div", { text: g.section });
        head.style.cssText = "font-size:0.72em; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.06em; margin:8px 0 2px;";
        for (const d of g.docs) {
          const r = list.createEl("label");
          r.style.cssText = "display:flex; align-items:center; gap:8px; padding:2px 4px; cursor:pointer;";
          const cb = r.createEl("input"); cb.type = "checkbox";
          cb.onchange = () => { if (cb.checked) selected.add(d.path); else selected.delete(d.path); updateBtn(); };
          r.createEl("span", { text: d.name });
        }
      }

      const save = panel.createEl("button", { text: "Move selected" });
      save.style.cssText = "margin-top:12px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      const updateBtn = () => {
        const n = selected.size;
        save.disabled = n === 0;
        save.style.opacity = n ? "1" : "0.5";
        save.style.cursor = n ? "pointer" : "not-allowed";
        save.textContent = n ? `Move ${n} doc${n === 1 ? "" : "s"}` : "Move selected";
      };
      updateBtn();
      save.onclick = async () => {
        if (save.disabled) return;
        const target = targets[targetIdx];
        const selectedDocs = [...selected].map((p) => ({ path: p }));
        const { moves, skipped } = DocBulkMoveActions.planBulkMove(selectedDocs, target, dm);
        let moved = 0, failed = 0;
        for (const mv of moves) {
          try {
            if (app.vault.getAbstractFileByPath(mv.to)) { failed++; continue; }
            const file = app.vault.getAbstractFileByPath(mv.from);
            if (!file) { failed++; continue; }
            await app.fileManager.renameFile(file, mv.to);
            const movedFile = app.vault.getAbstractFileByPath(mv.to) || file;
            await app.fileManager.processFrontMatter(movedFile, (fm) => {
              const patch = dm.rewriteSection(fm, mv.section, mv.subSection);
              fm.section = patch.section;
              fm.sub_section = patch.sub_section;
            });
            moved++;
          } catch (_e) { failed++; }
        }
        const bits = [`Moved ${moved} to ${target.label}`];
        if (skipped.length) bits.push(`${skipped.length} skipped`);
        if (failed) bits.push(`${failed} failed`);
        new Notice(bits.join("; "), 6000);
        close();
      };
    }});
  }

  // ── modal overlay (mirrors DocLeafActions._openModal) ──────────────────────
  _openModal({ title, build }) {
    const prior = document.querySelector(".sauce-docbulk-modal-overlay");
    if (prior) prior.remove();
    const overlay = document.body.createDiv({ cls: "sauce-docbulk-modal-overlay" });
    overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 9999;";
    const modal = overlay.createDiv();
    modal.style.cssText = "background: var(--background-primary, #1c1c1c); color: var(--text-normal, #ddd); border: 1px solid var(--background-modifier-border, #444); border-radius: 10px; padding: 18px 20px; width: min(480px, 92vw); max-height: 80vh; overflow: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);";
    const escListener = (ev) => { if (ev.key === "Escape") close(); };
    const close = () => { document.removeEventListener("keydown", escListener); overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.addEventListener("keydown", escListener);
    const h = modal.createEl("div", { text: title });
    h.style.cssText = "font-weight:600; font-size:1.05em; margin-bottom:4px;";
    build(modal, close);
  }
}
