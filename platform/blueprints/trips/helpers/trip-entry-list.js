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
  // Base form-field css shared by <input> and <select> controls.
  static _fieldCss() {
    return "padding:6px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal);";
  }
  // iOS-safe date/time <input> css: strips the intrinsic control chrome that
  // otherwise ignores width:100% (native picker still opens on tap).
  static _dateCss() {
    return TripEntryList._fieldCss() + " -webkit-appearance:none; appearance:none; max-width:100%; text-align:left;";
  }
  // Maps a spec field to its <input type="…"> (or "select" to render a
  // <select>). text/date/time/select pass through as-is; link -> url.
  static _inputTypeFor(field) {
    if (!field || !field.type) return "text";
    return field.type === "link" ? "url" : field.type;
  }
  static addCategory(list, category) {
    const l = Array.isArray(list) ? list.slice() : [];
    const c = String(category || "").trim();
    if (!c) return { list: l, changed: false, reason: "empty" };
    if (l.some((e) => e && e.category === c)) return { list: l, changed: false, reason: "duplicate" };
    l.push({ category: c });
    return { list: l, changed: true };
  }

  // Derive the form fields from a render spec. Explicit spec.fields win;
  // otherwise map spec.kind -> the per-section SSOT field list. Lets rows
  // mounted with only {key, kind} (no fields) still build a full edit form.
  static _fieldsFor(spec) {
    if (spec && Array.isArray(spec.fields) && spec.fields.length) return spec.fields;
    switch (spec && spec.kind) {
      case "flights": return TripEntryList._flightFields();
      case "stay": return TripEntryList._stayFields();
      case "packing": return TripEntryList._packingItemFields(spec.__cats || []);
      default: return [];
    }
  }

  // ── per-section field specs (SSOT — templates + chrome bar call these) ─────
  // Flights: direction select + typed schedule fields + a booking link.
  static _flightFields() {
    return [
      { name: "direction", label: "Direction", type: "select", options: ["Outbound", "Return"] },
      { name: "airline", label: "Airline", type: "text", placeholder: "Delta" },
      { name: "flight_no", label: "Flight #", type: "text", placeholder: "DL123" },
      { name: "from", label: "From", type: "text", placeholder: "DEN" },
      { name: "to", label: "To", type: "text", placeholder: "DTW" },
      { name: "depart_date", label: "Depart date", type: "date" },
      { name: "depart_time", label: "Depart time", type: "time" },
      { name: "boarding_time", label: "Boarding time", type: "time" },
      { name: "gate", label: "Gate", type: "text", placeholder: "A12" },
      { name: "seat", label: "Seat", type: "text", placeholder: "14C" },
      { name: "confirmation", label: "Confirmation", type: "text", placeholder: "ABC123" },
      { name: "link", label: "Link", type: "link", placeholder: "https://…" },
    ];
  }
  // Stays: lodging with check-in/out dates + a booking link.
  static _stayFields() {
    return [
      { name: "name", label: "Name", type: "text", placeholder: "Hotel" },
      { name: "address", label: "Address", type: "text", placeholder: "123 Main St" },
      { name: "check_in", label: "Check in", type: "date" },
      { name: "check_out", label: "Check out", type: "date" },
      { name: "confirmation", label: "Confirmation", type: "text", placeholder: "ABC123" },
      { name: "link", label: "Link", type: "link", placeholder: "https://…" },
    ];
  }
  // Packing add-item: a SINGLE category select (auto-first) + the item text —
  // no duplicate category field. `categories` = distinct existing categories.
  static _packingItemFields(categories) {
    return [
      { name: "category", label: "Category", type: "select", options: (categories && categories.length ? categories : []) },
      { name: "item", label: "Item", type: "text", placeholder: "Socks" },
    ];
  }

  // ── flight direction grouping ─────────────────────────────────────────────
  // Bucket entries into Outbound / Return / Other (blank/unknown -> Other),
  // dropping empty groups, preserving input order within each group.
  static _groupByDirection(items) {
    const order = ["Outbound", "Return", "Other"];
    const buckets = { Outbound: [], Return: [], Other: [] };
    for (const e of Array.isArray(items) ? items : []) {
      const d = e && e.direction;
      const label = d === "Outbound" || d === "Return" ? d : "Other";
      buckets[label].push(e);
    }
    return order.filter((l) => buckets[l].length).map((l) => ({ label: l, entries: buckets[l] }));
  }

  // ── date/time formatters ──────────────────────────────────────────────────
  static _MONTHS() {
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  }
  // "YYYY-MM-DD" -> "MMM D, YYYY" (UTC-safe). Empty/malformed -> "".
  static _fmtDate(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    if (!m) return "";
    const mon = TripEntryList._MONTHS()[parseInt(m[2], 10) - 1];
    if (!mon) return "";
    return mon + " " + parseInt(m[3], 10) + ", " + m[1];
  }
  // 24h "13:00" -> "1:00 PM"; "09:05" -> "9:05 AM". Empty -> "".
  static _fmtTime(v) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
    if (!m) return "";
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + min + " " + ampm;
  }
  // "Aug 1, 1:00 PM" — MMM D (year-less) + ", " + 12h time. Blank date -> just
  // the time; blank time -> just the date; both blank -> "".
  static _fmtDateTime(dateStr, timeStr) {
    const full = TripEntryList._fmtDate(dateStr);
    const datePart = full ? full.replace(/, \d{4}$/, "") : ""; // MMM D
    const timePart = TripEntryList._fmtTime(timeStr);
    if (datePart && timePart) return datePart + ", " + timePart;
    return datePart || timePart || "";
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

    if (customJS.SectionLabel && typeof customJS.SectionLabel.divider === "function") {
      customJS.SectionLabel.divider(c);
    }

    // ── rows ──────────────────────────────────────────────────────────────
    // The Add / Add category / Add item buttons now live on the chrome bar,
    // which calls the headless openers below. Only the list + per-row
    // edit/delete/checkbox controls render here.
    const isFlights = spec.kind === "flights" || spec.key === "flights";
    if (isFlights) {
      // Flights: group by direction (Outbound / Return / Other), each group
      // under a guarded SectionLabel, each leg a rich detail card. Track each
      // entry's ABSOLUTE index in `items` so Edit/Delete target the right leg.
      const withIdx = items.map((entry, absIndex) => ({ entry, absIndex }));
      const groups = TripEntryList._groupByDirection(withIdx.map((w) => Object.assign({}, w.entry, { __i: w.absIndex })));
      for (const g of groups) {
        if (customJS.SectionLabel && typeof customJS.SectionLabel.render === "function") {
          customJS.SectionLabel.render(c, g.label);
        } else {
          const gh = c.createEl("div", { text: g.label });
          if (gh.style) gh.style.cssText = "font-size:0.72em; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin:10px 0 4px;";
        }
        for (const e of g.entries) this._flightRow(c, dv, spec, items, e, e.__i);
      }
    } else if (spec.group) {
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
  }

  // Rich flight leg: airline flight_no · direction / from → to / depart /
  // board / gate / seat / confirmation / link, plus per-row Edit + Delete.
  _flightRow(c, dv, spec, items, entry, absIndex) {
    const e = entry || {};
    const rowEl = c.createEl("div");
    rowEl.style.cssText = "display:flex; align-items:flex-start; gap:8px; padding:8px 10px; margin-top:6px; border:1px solid var(--background-modifier-border); border-radius:6px;";
    const body = rowEl.createEl("div");
    body.style.cssText = "flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;";

    const head = ((e.airline || "") + " " + (e.flight_no || "")).trim();
    const hline = body.createEl("div", { text: head + (e.direction ? "  ·  " + e.direction : "") });
    hline.style.cssText = "font-weight:600; font-size:0.9em;";

    const route = ((e.from || "") + (e.from || e.to ? " → " : "") + (e.to || "")).trim();
    if (route) {
      const r = body.createEl("div", { text: route });
      r.style.cssText = "font-size:0.82em; color:var(--text-muted);";
    }

    const depart = TripEntryList._fmtDateTime(e.depart_date, e.depart_time);
    if (depart) this._flightDetail(body, "Depart", depart);
    if (e.boarding_time) this._flightDetail(body, "Board", TripEntryList._fmtTime(e.boarding_time));
    if (e.gate) this._flightDetail(body, "Gate", e.gate);
    if (e.seat) this._flightDetail(body, "Seat", e.seat);
    if (e.confirmation) this._flightDetail(body, "Conf", e.confirmation);

    if (e.link) {
      const isWeb = /^[a-z]+:\/\//i.test(String(e.link));
      const a = body.createEl("a", { text: isWeb ? "Open link ↗" : String(e.link).replace(/^\[\[|\]\]$/g, "") });
      a.style.cssText = "font-size:0.8em; color:var(--text-accent); cursor:pointer; margin-top:2px;";
      if (isWeb) { a.href = e.link; a.target = "_blank"; a.rel = "noopener"; }
      else a.onclick = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); app.workspace.openLinkText(String(e.link).replace(/^\[\[|\]\]$/g, ""), "", false); };
    }

    const editBtn = rowEl.createEl("button", { text: "Edit" });
    editBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:0.8em;";
    editBtn.onclick = () => this._onEdit(dv, spec, absIndex, e);
    const delBtn = rowEl.createEl("button", { text: "Delete" });
    delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); font-size:0.8em;";
    delBtn.onclick = async () => {
      const res = TripEntryList.deleteEntry(this._items(dv, spec), absIndex);
      if (res.changed) await this._write(dv, spec, res.list);
    };
  }

  _flightDetail(body, label, value) {
    const d = body.createEl("div", { text: label + ": " + value });
    d.style.cssText = "font-size:0.8em; color:var(--text-muted);";
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
      fields: TripEntryList._fieldsFor(spec),
      dv, spec,
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
      fields: catField.concat(TripEntryList._fieldsFor(spec)),
      values: entry || {},
      dv, spec,
      onSubmit: async (values) => {
        const res = TripEntryList.updateEntry(this._items(dv, spec), index, values);
        if (!res.changed) { new Notice("Nothing to update."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Updated."); return true; }
        return false;
      },
    });
  }

  // Headless openers — the chrome bar calls these directly (bar owns the
  // Add buttons now). openAdd(dv, spec) opens the add-entry form; the bar
  // passes `spec` (may carry {key, kind, fields}). openAddCategory adds a
  // packing category. These delegate to the same _on* handlers.
  openAdd(dv, spec) { return this._onAdd(dv, spec || {}); }
  openAddItem(dv, spec) { return this._onAddItem(dv, spec || {}); }
  openAddCategory(dv, spec) { return this._onAddCategory(dv, spec || {}); }

  _onAddCategory(dv, spec) {
    this._openForm({
      title: "Add category",
      fields: [{ name: "category", label: "Category", placeholder: "e.g. Clothing" }],
      dv, spec,
      onSubmit: async (values) => {
        const res = TripEntryList.addCategory(this._items(dv, spec), values.category);
        if (!res.changed) { new Notice(res.reason === "duplicate" ? "That category already exists." : "Enter a category."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Category added."); return true; }
        return false;
      },
    });
  }

  _onAddItem(dv, spec) {
    // SINGLE category <select> (auto-first) + item text — no duplicate
    // category field. Do NOT concat spec.fields (the template's fields carry
    // their own category, which is what doubled the control).
    const fields = TripEntryList._packingItemFields(this._categories(dv, spec));
    this._openForm({
      title: "Add item",
      fields,
      dv, spec,
      onSubmit: async (values) => {
        const res = TripEntryList.addEntry(this._items(dv, spec), values);
        if (!res.changed) { new Notice("Enter at least one value."); return false; }
        if (await this._write(dv, spec, res.list)) { new Notice("Item added."); return true; }
        return false;
      },
    });
  }

  // ── form modal ────────────────────────────────────────────────────────────
  // fields: [{ name, label, placeholder?, select?:[...], type?, options?,
  // optionsFrom? }]. A `select` array (legacy — the grouped category field)
  // renders a <select> populated from its options. Otherwise `type` picks
  // the control: "select" renders a <select> from `options` (or, when
  // `optionsFrom === "categories"`, the distinct existing entry categories);
  // any other type (text/date/time/link->url) renders a typed <input>.
  _openForm({ title, fields, values, dv, spec, onSubmit }) {
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
          input.style.cssText = TripEntryList._fieldCss();
          for (const opt of f.select) {
            const o = input.createEl("option", { text: opt });
            o.value = opt;
          }
          if (values[f.name]) input.value = values[f.name];
        } else if (TripEntryList._inputTypeFor(f) === "select") {
          const opts = f.optionsFrom === "categories" ? this._categories(dv, spec) : (f.options || []);
          input = wrap.createEl("select");
          input.style.cssText = TripEntryList._fieldCss();
          for (const opt of opts) {
            const o = input.createEl("option", { text: opt });
            o.value = opt;
          }
          if (opts.length) input.value = values[f.name] || opts[0];
          input.onchange = () => { values[f.name] = input.value; };
        } else {
          const inputType = TripEntryList._inputTypeFor(f);
          input = wrap.createEl("input", { type: inputType });
          input.value = values[f.name] || "";
          input.placeholder = f.placeholder || "";
          input.style.cssText = (inputType === "date" || inputType === "time") ? TripEntryList._dateCss() : TripEntryList._fieldCss();
          input.oninput = () => { values[f.name] = input.value; };
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
