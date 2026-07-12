// trip-entry-list.js — TripEntryList (Trips shared array-of-objects CRUD helper).
//
// A reusable CRUD helper that manages an array-of-objects frontmatter field
// (packing_items / flights / stays) on a trip-section note. Rows render with
// Add / Edit / Delete via form modals; the pure static mutation ops are
// unit-tested in Node (run-trip-entry-list.js). Patterned closely on
// ProjectLinksManager (modal/form/_write/AccentButton/SectionLabel.divider).
//
// The spec passed to render():
//   { key, fields:[{name,label,placeholder}], group?, checkbox?,
//     title:fn(entry), subtitle:fn(entry) }
//   - key:      frontmatter field name holding the array.
//   - fields:   form inputs (name maps to entry[name]).
//   - group:    if true, rows are grouped by `category` + an "Add category" /
//               "Add item" pair (packing case); the item form's first control is
//               a <select> of the distinct existing categories.
//   - checkbox: if true, each row gets a leading checkbox bound to entry.checked.
//   - title/subtitle: functions mapping an entry to its bold title / muted line.
//
// Static ops each return { list, changed, reason? } with `list` ALWAYS a NEW
// array (callers never mutate the source). Grouped rendering tracks each row's
// ABSOLUTE index in the underlying array so Edit/Delete/toggle target the right
// element.
//
// customJS stores classes as INSTANCES (customJS.TripEntryList = new …); the
// static ops are class statics, render + handlers are instance methods. This
// file MUST stay a bare class expression with NO trailing statements — the
// customJS loader evals the whole file as one expression `("+file+")`; any
// trailer would make it "Unexpected token" and the class would silently never
// register (lesson: customjs-no-trailing-statements).
class TripEntryList {
  // ── pure mutation ops (unit-tested) ──────────────────────────────────────
  static _norm(entry) {
    const out = {};
    for (const k of Object.keys(entry || {})) out[k] = typeof entry[k] === "string" ? entry[k].trim() : entry[k];
    return out;
  }
  static addEntry(list, entry) {
    const l = Array.isArray(list) ? list.slice() : [];
    const e = TripEntryList._norm(entry);
    const meaningful = Object.keys(e).some((k) => k !== "category" && k !== "checked" && e[k]);
    if (!meaningful) return { list: l, changed: false, reason: "empty" };
    l.push(e);
    return { list: l, changed: true };
  }
  static updateEntry(list, index, entry) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l[index] = TripEntryList._norm(entry);
    return { list: l, changed: true };
  }
  static deleteEntry(list, index) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l.splice(index, 1);
    return { list: l, changed: true };
  }
  static toggleChecked(list, index) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l[index] = Object.assign({}, l[index], { checked: !l[index].checked });
    return { list: l, changed: true };
  }
  static addCategory(list, category) {
    const l = Array.isArray(list) ? list.slice() : [];
    const c = String(category || "").trim();
    if (!c) return { list: l, changed: false, reason: "empty" };
    if (l.some((e) => e && e.category === c)) return { list: l, changed: false, reason: "duplicate" };
    l.push({ category: c });
    return { list: l, changed: true };
  }

  // ── render ────────────────────────────────────────────────────────────────
  async render(dv, spec = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return; // cold-load guard
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    if (c.closest && c.closest(".markdown-embed")) return;
    if (!spec || !spec.key) return;

    const cur = dv.current && dv.current();
    const items = Array.isArray(cur && cur[spec.key]) ? cur[spec.key] : [];

    const plusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;

    if (customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
      customJS.SectionLabel.divider(c);
    }

    // ── rows ──────────────────────────────────────────────────────────────
    if (spec.group) {
      // Grouped: bucket entries by category, preserving each row's ABSOLUTE
      // index in `items` so Edit/Delete/toggle target the right element.
      const groups = new Map();
      items.forEach((entry, absIndex) => {
        const cat = (entry && entry.category) || "Uncategorized";
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push({ entry, absIndex });
      });
      for (const [cat, members] of groups) {
        const gh = c.createEl("div", { text: cat });
        if (gh.style) gh.style.cssText = "font-size:0.72em; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin:10px 0 4px;";
        for (const m of members) this._row(c, dv, spec, items, m.entry, m.absIndex);
      }
    } else {
      items.forEach((entry, absIndex) => this._row(c, dv, spec, items, entry, absIndex));
    }

    // ── add controls ──────────────────────────────────────────────────────
    const row = c.createEl("div");
    row.style.cssText = "display: flex; gap: 10px; margin: 10px auto 0; justify-content: center; align-items: stretch; max-width: 640px; flex-wrap: wrap;";
    if (spec.group) {
      const addCat = customJS.AccentButton.render(row, { label: "Add category", icon: plusIcon, onClick: () => this._onAddCategory(dv, spec) });
      const addItem = customJS.AccentButton.render(row, { label: "Add item", icon: plusIcon, onClick: () => this._onAddItem(dv, spec) });
      for (const btn of [addCat, addItem]) this._styleLeafBtn(btn);
    } else {
      const add = customJS.AccentButton.render(row, { label: "Add", icon: plusIcon, onClick: () => this._onAdd(dv, spec) });
      this._styleLeafBtn(add);
    }
  }

  // Render one entry row (bold title + muted subtitle, optional leading
  // checkbox, Edit + Delete). absIndex = the entry's index in `items`.
  _row(c, dv, spec, items, entry, absIndex) {
    const rowEl = c.createEl("div");
    rowEl.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; margin-top:6px; border:1px solid var(--background-modifier-border); border-radius:6px;";
    if (spec.checkbox) {
      const cb = rowEl.createEl("input");
      cb.type = "checkbox";
      cb.checked = !!(entry && entry.checked);
      if (cb.style) cb.style.cssText = "flex:0 0 auto; margin:0;";
      cb.addEventListener("change", async () => {
        const res = TripEntryList.toggleChecked(items, absIndex);
        if (res.changed) await this._write(dv, spec, res.list);
      });
    }
    const label = rowEl.createEl("div");
    label.style.cssText = "flex:1; min-width:0;";
    const title = label.createEl("div", { text: spec.title ? spec.title(entry) : "" });
    title.style.cssText = "font-weight:600; font-size:0.9em; overflow:hidden; text-overflow:ellipsis;";
    const subText = spec.subtitle ? spec.subtitle(entry) : "";
    if (subText) {
      const sub = label.createEl("div", { text: subText });
      sub.style.cssText = "font-size:0.76em; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis;";
    }
    const editBtn = rowEl.createEl("button", { text: "Edit" });
    editBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:0.8em;";
    editBtn.onclick = () => this._onEdit(dv, spec, absIndex, entry);
    const delBtn = rowEl.createEl("button", { text: "Delete" });
    delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); font-size:0.8em;";
    delBtn.onclick = async () => {
      const res = TripEntryList.deleteEntry(this._items(dv, spec), absIndex);
      if (res.changed) await this._write(dv, spec, res.list);
    };
  }

  _styleLeafBtn(btn) {
    if (!btn || !btn.style) return btn;
    btn.style.flex = "1 1 calc(50% - 6px)";
    btn.style.minWidth = "128px";
    btn.style.fontSize = "0.92em";
    btn.style.padding = "9px 14px";
    return btn;
  }

  // ── read + write ──────────────────────────────────────────────────────────
  _items(dv, spec) {
    const cur = dv.current && dv.current();
    return Array.isArray(cur && cur[spec.key]) ? cur[spec.key] : [];
  }
  _file(dv) {
    const cur = dv.current && dv.current();
    if (!cur || !cur.file) return null;
    return app.vault.getAbstractFileByPath(cur.file.path);
  }
  async _write(dv, spec, list) {
    const file = this._file(dv);
    if (!file) { new Notice("Could not resolve this note to save."); return false; }
    try {
      await app.fileManager.processFrontMatter(file, (fm) => { fm[spec.key] = list; });
      return true;
    } catch (e) {
      new Notice("Save failed: " + (e && e.message ? e.message : e), 6000);
      return false;
    }
  }

  // ── distinct existing categories (for the grouped Add-item <select>) ──────
  _categories(dv, spec) {
    const seen = [];
    for (const e of this._items(dv, spec)) {
      const cat = e && e.category;
      if (cat && !seen.includes(cat)) seen.push(cat);
    }
    return seen;
  }

  // ── add / edit handlers ───────────────────────────────────────────────────
  _onAdd(dv, spec) {
    this._openForm({
      title: "Add",
      fields: spec.fields || [],
      onSubmit: async (values) => {
        const res = TripEntryList.addEntry(this._items(dv, spec), values);
        if (!res.changed) { new Notice("Enter at least one value."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Added."); return true; }
        return false;
      },
    });
  }

  _onEdit(dv, spec, index, entry) {
    // Grouped entries keep their category via a category <select>; flat ones
    // just re-present spec.fields. Pre-fill from the existing entry.
    const catField = spec.group ? [{ name: "category", label: "Category", select: this._categories(dv, spec) }] : [];
    this._openForm({
      title: "Edit",
      fields: catField.concat(spec.fields || []),
      values: entry || {},
      onSubmit: async (values) => {
        const res = TripEntryList.updateEntry(this._items(dv, spec), index, values);
        if (!res.changed) { new Notice("Nothing to update."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Updated."); return true; }
        return false;
      },
    });
  }

  _onAddCategory(dv, spec) {
    this._openForm({
      title: "Add category",
      fields: [{ name: "category", label: "Category", placeholder: "e.g. Clothing" }],
      onSubmit: async (values) => {
        const res = TripEntryList.addCategory(this._items(dv, spec), values.category);
        if (!res.changed) { new Notice(res.reason === "duplicate" ? "That category already exists." : "Enter a category."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Category added."); return true; }
        return false;
      },
    });
  }

  _onAddItem(dv, spec) {
    const cats = this._categories(dv, spec);
    const fields = [{ name: "category", label: "Category", select: cats }].concat(spec.fields || []);
    this._openForm({
      title: "Add item",
      fields,
      onSubmit: async (values) => {
        const res = TripEntryList.addEntry(this._items(dv, spec), values);
        if (!res.changed) { new Notice("Enter at least one value."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Item added."); return true; }
        return false;
      },
    });
  }

  // ── form modal ────────────────────────────────────────────────────────────
  // fields: [{ name, label, placeholder?, select?:[...] }]. A `select` field
  // renders a <select> populated from its options; otherwise a text <input>.
  _openForm({ title, fields, values, onSubmit }) {
    values = values || {};
    this._openModal({ title, build: (panel, close) => {
      const controls = [];
      for (const f of fields) {
        const wrap = panel.createEl("div");
        wrap.style.cssText = "display:flex; flex-direction:column; gap:4px; margin-top:10px;";
        const l = wrap.createEl("label", { text: f.label || f.name });
        l.style.cssText = "font-size:0.85em; color:var(--text-muted);";
        let input;
        if (Array.isArray(f.select)) {
          input = wrap.createEl("select");
          input.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
          for (const opt of f.select) {
            const o = input.createEl("option", { text: opt });
            o.value = opt;
          }
          if (values[f.name]) input.value = values[f.name];
        } else {
          input = wrap.createEl("input");
          input.type = "text";
          input.value = values[f.name] || "";
          input.placeholder = f.placeholder || "";
          input.style.cssText = "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
        }
        controls.push({ name: f.name, input });
      }
      const save = panel.createEl("button", { text: "Save" });
      save.style.cssText = "margin-top:14px; width:100%; padding:8px; border-radius:6px; border:1px solid var(--interactive-accent); background:var(--interactive-accent); color:var(--text-on-accent); cursor:pointer; font-weight:600;";
      const submit = async () => {
        const out = {};
        for (const cc of controls) out[cc.name] = cc.input.value;
        const okDone = await onSubmit(out);
        if (okDone) close();
      };
      save.onclick = submit;
      controls.forEach((cc, i) => {
        cc.input.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            if (i + 1 < controls.length) controls[i + 1].input.focus();
            else submit();
          }
        });
      });
      if (controls.length) setTimeout(() => controls[0].input.focus(), 0);
    } });
  }

  _openModal({ title, build }) {
    const prior = document.querySelector(".sauce-trip-entry-modal-overlay");
    if (prior) prior.remove();
    const overlay = document.body.createDiv({ cls: "sauce-trip-entry-modal-overlay" });
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
