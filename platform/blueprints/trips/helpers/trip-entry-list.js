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
  static _asArray(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value !== "string" && typeof value[Symbol.iterator] === "function") {
      try { return Array.from(value); } catch (_e) {}
    }
    return [];
  }
  static _norm(entry) {
    const out = {};
    for (const k of Object.keys(entry || {})) out[k] = typeof entry[k] === "string" ? entry[k].trim() : entry[k];
    return out;
  }
  // Dataview rehydrates YAML dates as Luxon DateTime values. Mutation
  // authority compares the indexed value with the plain frontmatter value, so
  // normalize date-like values (and object key order) before stringifying.
  static _mutationComparable(value) {
    if (value && typeof value.toISODate === "function") {
      try {
        const isoDate = value.toISODate();
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ""))) return String(isoDate);
      } catch (_e) {}
    }
    if (Array.isArray(value)) return value.map((item) => TripEntryList._mutationComparable(item));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = TripEntryList._mutationComparable(value[key]);
      return out;
    }
    return value;
  }
  static addEntry(list, entry) {
    const l = TripEntryList._asArray(list);
    const e = TripEntryList._norm(entry);
    const meaningful = Object.keys(e).some((k) => k !== "category" && k !== "checked" && e[k]);
    if (!meaningful) return { list: l, changed: false, reason: "empty" };
    l.push(e);
    return { list: l, changed: true };
  }
  static updateEntry(list, index, entry) {
    const l = TripEntryList._asArray(list);
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l[index] = TripEntryList._norm(entry);
    return { list: l, changed: true };
  }
  static deleteEntry(list, index) {
    const l = TripEntryList._asArray(list);
    if (!Number.isInteger(index) || index < 0 || index >= l.length) return { list: l, changed: false, reason: "bad-index" };
    l.splice(index, 1);
    return { list: l, changed: true };
  }
  static toggleChecked(list, index) {
    const l = TripEntryList._asArray(list);
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
    const l = TripEntryList._asArray(list);
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

  // Fields for the Edit form. Grouped (packing) uses a SINGLE category <select>
  // populated from existing categories + the item field — never doubled. Flat
  // sections (flights/stay) present their kind's fields.
  static _editFields(spec, categories) {
    if (spec && spec.group) return TripEntryList._packingItemFields(categories || []);
    return TripEntryList._fieldsFor(spec);
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
      { name: "arrival_date", label: "Arrival date", type: "date" },
      { name: "arrival_time", label: "Arrival time", type: "time" },
      { name: "gate", label: "Gate", type: "text", placeholder: "A12" },
      { name: "seat", label: "Seat", type: "text", placeholder: "14C" },
      { name: "confirmation", label: "Confirmation", type: "text", placeholder: "ABC123" },
      { name: "delay_minutes", label: "Delay (min)", type: "number", placeholder: "0" },
      { name: "link", label: "Link", type: "link" },
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
  // Preset form values for the per-category Add-item "+" button: pre-fills the
  // Category field so the user lands directly in the item box (pure/testable).
  static _addItemValuesForCategory(category) {
    return { category: String(category || "") };
  }
  // Packing add-item: a SINGLE category select (auto-first) + the item text —
  // no duplicate category field. `categories` = distinct existing categories.
  static _packingItemFields(categories) {
    return [
      { name: "category", label: "Category", type: "select", options: (categories && categories.length ? categories : []) },
      { name: "item", label: "Item", type: "text", placeholder: "Socks" },
    ];
  }

  // ── row title / subtitle + packing buckets (pure) ────────────────────────
  // Title for a generic row. spec.title(fn) wins; stay -> name; else -> item||name.
  static _rowTitle(spec, entry) {
    if (spec && typeof spec.title === "function") return spec.title(entry) || "";
    if (spec && spec.kind === "stay") return (entry && entry.name) || "";
    return (entry && (entry.item || entry.name)) || "";
  }
  // Subtitle for a generic row. spec.subtitle(fn) wins; stay -> check-in → check-out
  // date range; else "".
  static _rowSubtitle(spec, entry) {
    if (spec && typeof spec.subtitle === "function") return spec.subtitle(entry) || "";
    if (spec && spec.kind === "stay") {
      const ci = TripEntryList._fmtDate(entry && entry.check_in), co = TripEntryList._fmtDate(entry && entry.check_out);
      return (ci || co) ? (ci + " → " + co) : "";
    }
    return "";
  }
  // Bucket packing entries by category (first-seen order). "Add category" stores
  // {category} with no item — those seed the bucket header but are NOT rows.
  // Only entries with an `item` become rows (carrying their ABSOLUTE index).
  static _packingBuckets(items) {
    const order = [];
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach((entry, absIndex) => {
      const cat = (entry && entry.category) || "Uncategorized";
      if (!map.has(cat)) { map.set(cat, []); order.push(cat); }
      if (entry && entry.item) map.get(cat).push({ entry, absIndex });
    });
    // Within each category, unchecked rows render first and checked-off rows
    // sink to the bottom — stable within each group. absIndex is untouched
    // (still points into the ORIGINAL items array); only display order changes.
    return order.map((cat) => {
      const rows = map.get(cat)
        .map((r, i) => [r, i])
        .sort((a, b) => {
          const ca = !!a[0].entry.checked, cb = !!b[0].entry.checked;
          return ca === cb ? a[1] - b[1] : (ca ? 1 : -1);
        })
        .map((x) => x[0]);
      return { category: cat, rows };
    });
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

  // ── pure flight-time math (unit-tested; all guard null/blank, never throw) ──
  // depart_date may be clean "2026-07-16" OR full ISO — slice(0,10) normalizes.
  static _dayMs(v) {
    if (!v) return null;
    const s = String(v).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (typeof v === "number") {
      const d = new Date(v);
      if (isNaN(d.getTime())) return null;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return null;
  }
  static _toMin(t) {
    const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? +m[1] * 60 + +m[2] : null;
  }
  static _delayMin(leg) {
    const n = parseInt(leg && leg.delay_minutes, 10);
    return Number.isFinite(n) ? n : 0;
  }
  static _legDepartMs(leg) {
    const d = TripEntryList._dayMs(leg && leg.depart_date), t = TripEntryList._toMin(leg && leg.depart_time);
    return (d == null || t == null) ? null : d + t * 60000;
  }
  static _legArriveMs(leg) {
    const d = TripEntryList._dayMs(leg && leg.arrival_date), t = TripEntryList._toMin(leg && leg.arrival_time);
    return (d == null || t == null) ? null : d + t * 60000;
  }
  static _effDepartMs(leg) {
    const b = TripEntryList._legDepartMs(leg);
    return b == null ? null : b + TripEntryList._delayMin(leg) * 60000;
  }
  static _effArriveMs(leg) {
    const b = TripEntryList._legArriveMs(leg);
    return b == null ? null : b + TripEntryList._delayMin(leg) * 60000;
  }
  // Boarding = effective-depart − 40 min (auto, no stored field). "HH:MM" UTC.
  static _boardingMin(leg) {
    const e = TripEntryList._effDepartMs(leg);
    if (e == null) return null;
    const bt = new Date(e - 40 * 60000);
    const hh = String(bt.getUTCHours()).padStart(2, "0");
    const mm = String(bt.getUTCMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }
  static _durationMin(leg) {
    const d = TripEntryList._effDepartMs(leg), a = TripEntryList._effArriveMs(leg);
    return (d == null || a == null) ? null : Math.round((a - d) / 60000);
  }
  static _fmtDur(min) {
    if (min == null || min <= 0) return "";
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  // Layover only for connecting same-direction legs (prev.to === next.from).
  static _layoverMin(prev, next) {
    if (!(prev && next && prev.direction === next.direction && prev.to && next.from && prev.to === next.from)) return null;
    const a = TripEntryList._effArriveMs(prev), d = TripEntryList._effDepartMs(next);
    return (a == null || d == null) ? null : Math.round((d - a) / 60000);
  }
  // Positive ms delta -> "N min" / "N hr" / "N days".
  static _humanDelta(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return min + " min";
    const hr = Math.round(ms / 3600000);
    if (hr < 24) return hr + " hr";
    return Math.round(ms / 86400000) + " days";
  }
  // Whole calendar-days from now's LOCAL date to a leg date (both mapped into
  // the UTC-midnight scheme). Same-date legs at different times give the same
  // count. null when the date is blank/malformed.
  static _daysUntilDate(dateVal, nowMs) {
    const dep = TripEntryList._dayMs(dateVal);
    if (dep == null) return null;
    const n = new Date(nowMs);
    const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate());
    return Math.round((dep - today) / 86400000);
  }
  static _flightStatus(leg, nowMs) {
    const d = TripEntryList._effDepartMs(leg);
    if (d == null) return null;
    const a = TripEntryList._effArriveMs(leg);
    const board = d - 40 * 60000;
    if (a != null && nowMs >= a) return { label: "Landed", tone: "muted" };
    if (nowMs >= d) return { label: a != null ? "In air" : "Departed", tone: "accent" };
    if (nowMs >= board) return { label: "Boarding", tone: "warn" };
    // Countdown by calendar days so same-date legs read consistently; fall back
    // to the fine-grained ms delta only inside the last day (< 1 day out).
    const days = TripEntryList._daysUntilDate(leg.depart_date, nowMs);
    if (days != null && days >= 1) return { label: "in " + days + (days === 1 ? " day" : " days"), tone: "accent" };
    return { label: "in " + TripEntryList._humanDelta(d - nowMs), tone: "accent" };
  }
  // Epoch ms (UTC) -> "MMM D, h:mm A". "" for null. Uses UTC getters so a
  // clean YYYY-MM-DD + HH:MM renders back exactly (no local-tz drift).
  static _msToDisplay(ms) {
    if (ms == null) return null;
    const dt = new Date(ms);
    if (isNaN(dt.getTime())) return null;
    const mon = TripEntryList._MONTHS()[dt.getUTCMonth()];
    if (!mon) return null;
    let h = dt.getUTCHours();
    const min = String(dt.getUTCMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return mon + " " + dt.getUTCDate() + ", " + h + ":" + min + " " + ampm;
  }
  // Human "MMM D, h:mm A" for the EFFECTIVE depart/arrive (shifted by delay);
  // "" when unknown. Card render reads these.
  static _effDepartDisplay(leg) { return TripEntryList._msToDisplay(TripEntryList._effDepartMs(leg)) || ""; }
  static _effArriveDisplay(leg) { return TripEntryList._msToDisplay(TripEntryList._effArriveMs(leg)) || ""; }

  // ── render ────────────────────────────────────────────────────────────────
  async render(dv, spec = {}) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return; // cold-load guard
    const c = (dv && dv.container) ? dv.container : dv;
    if (!c || typeof c.createEl !== "function") return;
    if (c.closest && c.closest(".markdown-embed")) return;
    if (!spec || !spec.key) return;

    const ownerPath = String(page.file.path || "");
    if (c.dataset) {
      c.dataset.tripEntryOwnerPath = ownerPath;
      c.dataset.tripEntryOwnerKey = String(spec.key);
    }
    if (c.classList?.add) c.classList.add("trip-entry-list-owner");
    else if (!String(c.className || "").split(/\s+/).includes("trip-entry-list-owner")) {
      c.className = `${c.className || ""} trip-entry-list-owner`.trim();
    }

    const state = this._entryState(c, page, spec.key);
    const items = TripEntryList._asArray(state.model);

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
      // under a guarded SectionLabel, each leg a rich card. Track each entry's
      // ABSOLUTE index in `items` so Edit/Delete target the right leg. Between
      // consecutive legs of the same group, drop a layover / connection chip.
      const nowMs = Date.now();
      const withIdx = items.map((entry, absIndex) => ({ entry, absIndex }));
      const groups = TripEntryList._groupByDirection(withIdx.map((w) => Object.assign({}, w.entry, { __i: w.absIndex })));
      groups.forEach((g, gi) => {
        if (gi > 0) {
          const hr = c.createEl("div");
          if (hr.style) hr.style.cssText = "border-top:1px solid var(--background-modifier-border); margin-top:14px; padding-top:2px;";
        }
        const gh = c.createEl("div", { text: "✈ " + g.label });
        if (gh.style) gh.style.cssText = "font-weight:700; font-size:0.95em; letter-spacing:0.06em; text-transform:uppercase; color:var(--interactive-accent); margin:16px 0 6px;";
        g.entries.forEach((e, i) => {
          if (i > 0) this._layoverChip(c, g.entries[i - 1], e);
          this._flightRow(c, dv, spec, items, e, e.__i, nowMs);
        });
      });
    } else if (spec.group) {
      // Grouped: bucket entries by category, preserving each row's ABSOLUTE
      // index in `items` so Edit/Delete/toggle target the right element.
      // Item-less "Add category" placeholders seed a header but are not rows.
      for (const bucket of TripEntryList._packingBuckets(items)) {
        const gh = c.createEl("div");
        if (gh.style) gh.style.cssText = "display:flex; align-items:center; gap:8px; margin:10px 0 4px;";
        const lbl = gh.createEl("span", { text: bucket.category });
        if (lbl.style) lbl.style.cssText = "font-size:0.72em; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em;";
        const addBtn = gh.createEl("button", { text: "+" });
        if (addBtn.style) addBtn.style.cssText = "margin-left:auto; padding:2px 9px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--interactive-accent); font-size:0.85em; font-weight:600; cursor:pointer;";
        addBtn.onclick = () => this._onAddItem(dv, spec, TripEntryList._addItemValuesForCategory(bucket.category));
        for (const r of bucket.rows) this._row(c, dv, spec, items, r.entry, r.absIndex);
      }
    } else {
      items.forEach((entry, absIndex) => this._row(c, dv, spec, items, entry, absIndex));
    }
  }

  // Rich flight card, compute-at-render (nowMs read once by the caller):
  //   Row 1: ✈ airline flight# (bold) + direction badge + live status pill.
  //   Row 2: from → to (muted).
  //   Row 3: Depart / Arrive (effective) · Board · duration.
  //   Row 4: Gate / Seat / Conf / Delayed pill / Details link.
  // Every field omitted when empty; every pure-call result guarded. Never throws.
  _flightRow(c, dv, spec, items, entry, absIndex, nowMs) {
    const e = entry || {};
    if (nowMs == null) nowMs = Date.now();
    const rowEl = c.createEl("div");
    rowEl.style.cssText = "display:flex; align-items:flex-start; gap:8px; padding:8px 10px; margin-top:6px; border:1px solid var(--background-modifier-border); border-radius:6px;";
    const body = rowEl.createEl("div");
    body.style.cssText = "flex:1; min-width:0; display:flex; flex-direction:column; gap:3px;";

    // ── Row 1: ✈ airline flight# + direction badge + status pill ──
    const r1 = body.createEl("div");
    r1.style.cssText = "display:flex; align-items:center; gap:6px; flex-wrap:wrap;";
    const head = ("✈ " + ((e.airline || "") + " " + (e.flight_no || "")).trim()).trim();
    const hline = r1.createEl("span", { text: head });
    hline.style.cssText = "font-weight:600; font-size:0.92em;";
    if (e.direction) {
      const badge = r1.createEl("span", { text: e.direction });
      badge.style.cssText = "font-size:0.66em; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); border:1px solid var(--background-modifier-border); border-radius:10px; padding:1px 7px;";
    }
    const status = TripEntryList._flightStatus(e, nowMs);
    if (status) {
      const spacer = r1.createEl("span");
      spacer.style.cssText = "flex:1;";
      this._flightPill(r1, status.label, status.tone);
    }

    // ── Row 2: from → to ──
    const route = ((e.from || "") + (e.from || e.to ? " → " : "") + (e.to || "")).trim();
    if (route) {
      const r = body.createEl("div", { text: route });
      r.style.cssText = "font-size:0.84em; color:var(--text-muted);";
    }

    // ── Row 3: times (effective depart / arrive / board / duration) ──
    const timeParts = [];
    const dep = TripEntryList._effDepartDisplay(e);
    if (dep) timeParts.push("Depart " + dep);
    const arr = TripEntryList._effArriveDisplay(e);
    if (arr) timeParts.push("Arrive " + arr);
    const board = TripEntryList._boardingMin(e);
    if (board) timeParts.push("Board " + TripEntryList._fmtTime(board));
    const dur = TripEntryList._fmtDur(TripEntryList._durationMin(e));
    if (dur) timeParts.push(dur);
    if (timeParts.length) {
      const t = body.createEl("div", { text: timeParts.join("  ·  ") });
      t.style.cssText = "font-size:0.8em; color:var(--text-muted); display:flex; flex-wrap:wrap; gap:2px 6px;";
    }

    // ── Row 4: day-of fields + delay pill + details link ──
    const r4 = body.createEl("div");
    r4.style.cssText = "display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; font-size:0.8em; color:var(--text-muted); margin-top:1px;";
    let r4has = false;
    const addField = (label, val) => {
      if (!val) return;
      const s = r4.createEl("span", { text: label + " " + val });
      r4has = true;
    };
    addField("Gate", e.gate);
    addField("Seat", e.seat);
    addField("Conf", e.confirmation);
    if (TripEntryList._delayMin(e) > 0) {
      this._flightPill(r4, "Delayed " + TripEntryList._delayMin(e) + " min", "warn");
      r4has = true;
    }
    if (e.link) {
      const isWeb = /^[a-z]+:\/\//i.test(String(e.link));
      const a = r4.createEl("a", { text: "Details ↗" });
      a.style.cssText = "color:var(--text-accent); cursor:pointer;";
      if (isWeb) { a.href = e.link; a.target = "_blank"; a.rel = "noopener"; }
      else a.onclick = (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); app.workspace.openLinkText(String(e.link).replace(/^\[\[|\]\]$/g, ""), "", false); };
      r4has = true;
    }
    if (!r4has) r4.remove();

    const editBtn = rowEl.createEl("button", { text: "Edit" });
    editBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-normal); font-size:0.8em;";
    editBtn.onclick = () => this._onEdit(dv, spec, absIndex, e);
    const delBtn = rowEl.createEl("button", { text: "Delete" });
    delBtn.style.cssText = "padding:4px 10px; border-radius:6px; border:1px solid var(--background-modifier-border); background:var(--background-primary); color:var(--text-error); font-size:0.8em;";
    delBtn.onclick = async () => {
      const res = TripEntryList.deleteEntry(this._items(dv, spec), absIndex);
      if (res.changed) await this._write(dv, spec, res.list, { focusTarget: delBtn });
    };
  }

  // Small status/delay pill. tone → color: accent / warn / muted.
  _flightPill(parent, label, tone) {
    const color = tone === "warn" ? "var(--color-orange, #d68)"
      : tone === "muted" ? "var(--text-muted)"
      : "var(--interactive-accent)";
    const pill = parent.createEl("span", { text: label });
    pill.style.cssText = "font-size:0.7em; font-weight:600; color:" + color + "; border:1px solid " + color + "; border-radius:10px; padding:1px 8px; white-space:nowrap;";
    return pill;
  }

  // Between two consecutive same-group legs: a subtle centered chip. Layover
  // when the airports connect (prev.to === cur.from), else a neutral
  // "Connection" chip when the airports differ. Nothing when unknown.
  _layoverChip(c, prev, cur) {
    let text = null;
    const lo = TripEntryList._layoverMin(prev, cur);
    if (lo != null) {
      text = "⏱ Layover at " + (prev && prev.to ? prev.to : "") + " — " + TripEntryList._fmtDur(lo);
    } else if (prev && cur && prev.to && cur.from && prev.to !== cur.from) {
      text = "Connection";
    }
    if (!text) return;
    const chip = c.createEl("div", { text });
    chip.style.cssText = "text-align:center; font-size:0.72em; color:var(--text-muted); margin:4px 0;";
  }

  // Render one entry row (bold title + muted subtitle, optional leading
  // checkbox, Edit + Delete). absIndex = the entry's index in `items`.
  _row(c, dv, spec, items, entry, absIndex) {
    const rowEl = c.createEl("div");
    rowEl.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 8px; margin-top:6px; border:1px solid var(--background-modifier-border); border-radius:6px;";
    let checkbox = null;
    if (spec.checkbox) {
      checkbox = rowEl.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!(entry && entry.checked);
      if (checkbox.style) checkbox.style.cssText = "flex:0 0 auto; margin:0;";
      checkbox.addEventListener("change", async () => {
        const res = TripEntryList.toggleChecked(items, absIndex);
        if (!res.changed) return;
        const previous = !!(entry && entry.checked);
        const next = !!(res.list[absIndex] && res.list[absIndex].checked);
        await this._write(dv, spec, res.list, {
          optimistic: () => this._setCheckedRow(rowEl, checkbox, next),
          revert: () => this._setCheckedRow(rowEl, checkbox, previous),
        });
      });
    }
    const label = rowEl.createEl("div");
    label.style.cssText = "flex:1; min-width:0;";
    const title = label.createEl("div", { text: TripEntryList._rowTitle(spec, entry) });
    title.style.cssText = "font-weight:600; font-size:0.9em; overflow:hidden; text-overflow:ellipsis;";
    if (checkbox) this._setCheckedRow(rowEl, checkbox, checkbox.checked);
    const subText = TripEntryList._rowSubtitle(spec, entry);
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
      if (res.changed) await this._write(dv, spec, res.list, { focusTarget: delBtn });
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

  _setCheckedRow(rowEl, checkbox, checked) {
    const on = checked === true;
    if (checkbox) checkbox.checked = on;
    if (rowEl && rowEl.classList && typeof rowEl.classList.toggle === "function") {
      rowEl.classList.toggle("sauce-trip-entry-checked", on);
    }
    if (rowEl && rowEl.style) rowEl.style.textDecoration = on ? "line-through" : "";
  }

  // ── read + write ──────────────────────────────────────────────────────────
  _items(dv, spec) {
    const cur = this._page(dv);
    const filePath = cur && cur.file ? cur.file.path : "";
    const owner = filePath ? this._entryOwner(dv, filePath, spec.key) : null;
    if (owner) return TripEntryList._asArray(this._entryState(owner, cur, spec.key).model);
    return TripEntryList._asArray(cur && cur[spec.key]);
  }
  _page(dv) {
    const renderSafe = globalThis.customJS?.RenderSafe;
    if (renderSafe && typeof renderSafe.page === "function") return renderSafe.page(dv);
    try { return dv && typeof dv.current === "function" ? dv.current() : null; }
    catch (_e) { return null; }
  }
  _file(dv) {
    const cur = this._page(dv);
    if (!cur || !cur.file) return null;
    return app.vault.getAbstractFileByPath(cur.file.path);
  }
  _entryOwner(dv, filePath, key) {
    const container = dv && dv.container;
    const scopes = [container];
    try {
      const noteView = container?.closest?.(".markdown-preview-view, .markdown-reading-view, .markdown-source-view, .workspace-leaf-content");
      if (noteView) scopes.push(noteView);
    } catch (_e) {}
    for (const scope of scopes) {
      try {
        const candidates = [];
        if (scope?.dataset?.tripEntryOwnerPath != null) candidates.push(scope);
        if (typeof scope?.querySelectorAll === "function") candidates.push(...scope.querySelectorAll(".trip-entry-list-owner"));
        else {
          const owner = scope?.querySelector?.(".trip-entry-list-owner");
          if (owner) candidates.push(owner);
        }
        const match = candidates.find((owner) =>
          String(owner?.dataset?.tripEntryOwnerPath || "") === String(filePath || "")
          && String(owner?.dataset?.tripEntryOwnerKey || "") === String(key || ""));
        if (match) return match;
      } catch (_e) {}
    }
    return null;
  }
  _entryState(owner, page, key) {
    if (!this._entryMutationStates) this._entryMutationStates = new WeakMap();
    let state = this._entryMutationStates.get(owner);
    const incoming = TripEntryList._asArray(page && page[key]);
    const path = String(page?.file?.path || owner?.dataset?.tripEntryOwnerPath || "");
    const metadataVersion = this._metadataVersion(path);
    if (!state || state.path !== path || state.key !== String(key || "")) {
      state = {
        path,
        key: String(key || ""),
        model: incoming,
        tail: Promise.resolve(),
        queued: 0,
        epoch: 0,
        authority: null,
      };
      this._entryMutationStates.set(owner, state);
      return state;
    }
    if (state.queued === 0) {
      if (state.authority) {
        const matches = this._sameEntryModel(incoming, state.authority.expected);
        const incomingMtime = this._pageMtime(page);
        const externallyNewer = incomingMtime != null && state.authority.writeMtime != null
          && incomingMtime > state.authority.writeMtime;
        const cached = incomingMtime == null ? this._cachedEntries(path, key) : null;
        const cacheAdvanced = cached && metadataVersion > (state.authority.cacheVersion || 0);
        if (matches) {
          state.model = incoming;
          state.authority = null;
        } else if (externallyNewer) {
          state.model = incoming;
          state.authority = {
            expected: incoming,
            writeMtime: incomingMtime,
            cacheVersion: metadataVersion,
          };
        } else if (cacheAdvanced) {
          if (this._sameEntryModel(cached.model, state.authority.expected)) {
            state.authority.cacheVersion = metadataVersion;
            if (cached.mtime != null) state.authority.writeMtime = cached.mtime;
          } else {
            state.model = cached.model;
            state.authority = {
              expected: cached.model,
              writeMtime: cached.mtime,
              cacheVersion: metadataVersion,
            };
          }
        }
      } else {
        state.model = incoming;
      }
    }
    return state;
  }
  _sameEntryModel(left, right) {
    try {
      return JSON.stringify(TripEntryList._mutationComparable(TripEntryList._asArray(left)))
        === JSON.stringify(TripEntryList._mutationComparable(TripEntryList._asArray(right)));
    } catch (_e) { return false; }
  }
  _pageMtime(page) {
    const value = page?.file?.mtime;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    try {
      const numeric = value && typeof value.valueOf === "function" ? Number(value.valueOf()) : NaN;
      return Number.isFinite(numeric) ? numeric : null;
    } catch (_e) { return null; }
  }
  _fileMtime(file) {
    const value = file?.stat?.mtime;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  _cachedEntries(path, key) {
    try {
      if (typeof app === "undefined") return null;
      const file = app.vault?.getAbstractFileByPath?.(path);
      if (!file) return null;
      const frontmatter = app.metadataCache?.getFileCache?.(file)?.frontmatter;
      if (!frontmatter || typeof frontmatter !== "object") return null;
      return {
        mtime: this._fileMtime(file),
        model: TripEntryList._asArray(frontmatter[key]),
      };
    } catch (_e) { return null; }
  }
  _metadataTracker() {
    try {
      if (typeof app === "undefined" || !app.metadataCache) return null;
      const cache = app.metadataCache;
      const slot = Symbol.for("sauce.trips.metadata-generations");
      let tracker = globalThis[slot];
      if (!tracker || tracker.cache !== cache) {
        tracker = { cache, versions: new Map(), ref: null };
        if (typeof cache.on === "function") {
          tracker.ref = cache.on("changed", (file) => {
            const path = String(file?.path || "");
            if (path) tracker.versions.set(path, (tracker.versions.get(path) || 0) + 1);
          });
        }
        globalThis[slot] = tracker;
      }
      return tracker;
    } catch (_e) { return null; }
  }
  _metadataVersion(path) {
    return this._metadataTracker()?.versions?.get(String(path || "")) || 0;
  }
  _queueEntryStructure(state, task) {
    const epoch = state.epoch;
    state.queued += 1;
    const run = async () => {
      try {
        if (epoch !== state.epoch) {
          new Notice("An earlier trip change failed. Retry this action.", 6000);
          return false;
        }
        const ok = await task();
        if (!ok) state.epoch += 1;
        return ok;
      } catch (error) {
        state.epoch += 1;
        new Notice("Could not save: " + (error?.message || error), 6000);
        return false;
      } finally {
        state.queued = Math.max(0, state.queued - 1);
      }
    };
    const result = (state.tail || Promise.resolve()).then(run, run);
    state.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  _rollbackStructurePreview(receipt) {
    if (!receipt) return;
    if (receipt.owner) {
      if (typeof receipt.owner.replaceChildren === "function") receipt.owner.replaceChildren(...receipt.priorNodes);
      else {
        receipt.owner.empty?.();
        for (const node of receipt.priorNodes || []) receipt.owner.appendChild?.(node);
      }
    }
    if (receipt.page) {
      if (receipt.hadValue) receipt.page[receipt.key] = receipt.priorValue;
      else delete receipt.page[receipt.key];
    }
    if (receipt.state) {
      receipt.state.model = receipt.priorModel;
      receipt.state.authority = receipt.priorAuthority;
    }
    try { receipt.focusTarget?.focus?.(); } catch (_e) {}
  }
  _previewDv(dv, owner, page) {
    const preview = Object.create((dv && typeof dv === "object") ? dv : null);
    preview.container = owner;
    preview.current = () => page;
    return preview;
  }
  async _write(dv, spec, list, ui) {
    const file = this._file(dv);
    if (!file) { new Notice("Could not resolve this note to save."); return false; }
    const renderSafe = globalThis.customJS?.RenderSafe;
    const fieldMutation = Boolean(ui
      && (typeof ui.optimistic === "function" || typeof ui.revert === "function"));
    const method = fieldMutation ? "mutate" : "mutateStructure";
    if (!renderSafe || typeof renderSafe[method] !== "function") {
      if (ui && typeof ui.revert === "function") {
        try { await ui.revert(); } catch (_e) {}
      }
      new Notice("Could not save: RenderSafe is unavailable.", 6000);
      return false;
    }
    if (!fieldMutation) {
      const page = this._page(dv);
      if (!page) { new Notice("Could not save: page metadata is unavailable.", 6000); return false; }
      const next = TripEntryList._asArray(list);
      const owner = this._entryOwner(dv, file.path, spec.key);
      if (!owner) { new Notice("Could not save: trip entry list surface is unavailable.", 6000); return false; }
      const state = this._entryState(owner, page, spec.key);
      return this._queueEntryStructure(state, async () => {
        const previewPage = this._page(dv) || page;
        const result = await renderSafe.mutateStructure({
          app,
          dv,
          path: file.path,
          failureMessage: "Could not save",
          apply: async () => {
            const hadValue = Object.prototype.hasOwnProperty.call(previewPage, spec.key);
            const priorValue = previewPage[spec.key];
            const priorModel = state.model;
            const priorAuthority = state.authority;
            const priorNodes = Array.from(owner.childNodes || owner.children || []);
            const focusTarget = ui?.focusTarget
              || ((typeof document !== "undefined") ? document.activeElement : null);
            const receipt = {
              owner, page: previewPage, key: spec.key, hadValue, priorValue,
              priorModel, priorAuthority, priorNodes, focusTarget, state,
            };
            try {
              state.model = next;
              previewPage[spec.key] = next;
              if (typeof owner.replaceChildren === "function") owner.replaceChildren();
              else owner.empty?.();
              await this.render(this._previewDv(dv, owner, previewPage), spec);
              return receipt;
            } catch (error) {
              this._rollbackStructurePreview(receipt);
              throw error;
            }
          },
          rollback: (receipt) => this._rollbackStructurePreview(receipt),
          write: () => app.fileManager.processFrontMatter(file, (fm) => { fm[spec.key] = next; }),
        });
        if (result.ok === true) {
          state.model = next;
        state.authority = {
          expected: next,
          writeMtime: this._fileMtime(file),
          cacheVersion: this._metadataVersion(state.path),
        };
          return true;
        }
        return false;
      });
    }
    const expected = JSON.stringify(TripEntryList._mutationComparable(TripEntryList._asArray(list)));
    const result = await renderSafe.mutate({
      app,
      dv,
      path: file.path,
      optimistic: ui && ui.optimistic,
      revert: ui && ui.revert,
      write: () => app.fileManager.processFrontMatter(file, (fm) => { fm[spec.key] = list; }),
      isCurrent: (page) => {
        const current = page && page[spec.key];
        if (!current || typeof current[Symbol.iterator] !== "function") return false;
        try { return JSON.stringify(TripEntryList._mutationComparable(Array.from(current))) === expected; }
        catch (_e) { return false; }
      },
    });
    return result.ok === true;
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
    // Grouped (packing) → one populated category <select> + item; flat sections
    // (flights/stay) → their kind's fields. Pre-fill from the existing entry.
    this._openForm({
      title: "Edit",
      fields: TripEntryList._editFields(spec, this._categories(dv, spec)),
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

  _onAddItem(dv, spec, presetValues) {
    // SINGLE category <select> (auto-first) + item text — no duplicate
    // category field. Do NOT concat spec.fields (the template's fields carry
    // their own category, which is what doubled the control). presetValues
    // (e.g. {category} from a per-category "+") pre-fills the select so the
    // cursor lands in the item box (the category select is never focused).
    const fields = TripEntryList._packingItemFields(this._categories(dv, spec));
    this._openForm({
      title: "Add item",
      fields,
      values: presetValues || {},
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
      // Focus the first TEXT-like control (skip a leading <select>, e.g. the
      // packing category picker) so add-item lands the cursor in the item box.
      if (controls.length) {
        const textTypes = ["text", "url", "number", "time", "date"];
        const target = controls.find((cc) => {
          const inp = cc.input;
          return inp && inp.tagName === "INPUT" && textTypes.includes(inp.type);
        }) || controls[0];
        setTimeout(() => target.input.focus(), 0);
      }
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
