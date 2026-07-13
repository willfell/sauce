'use strict';

// run-trip-entry-list.js — pure-op coverage for the shared TripEntryList CRUD
// helper (packing_items / flights / stays array-of-objects frontmatter).
//
// TripEntryList is a customJS class (bare class expression, no trailing
// statements — the customJS loader evals it as one expression). Its static
// mutation ops are unit-testable in Node; the instance render()/modals are
// dogfood-only. Each op returns { list, changed, reason? } with `list` ALWAYS a
// new array so callers never mutate the source.
//
// Zero-dep. "N passed, M failed" — exit 0 iff M === 0.

const fs = require('fs');
const path = require('path');

let passes = 0, fails = 0;
function ok(label, cond, detail) {
    if (cond) { passes++; console.log('ok ' + label); }
    else { fails++; console.error('FAIL ' + label + (detail ? ' — ' + detail : '')); }
}

function loadClass(relPath, className) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
    return new Function(`${src}; return ${className};`)();
}

const TripEntryList = loadClass('platform/blueprints/trips/helpers/trip-entry-list.js', 'TripEntryList');

// ---------- addEntry ----------
{
    const src = [];
    const r = TripEntryList.addEntry(src, { item: " socks ", category: "Clothing", checked: false });
    ok('ADD-1 addEntry trims + appends a meaningful entry',
        r.changed === true && r.list.length === 1 && r.list[0].item === "socks" && r.list[0].category === "Clothing",
        JSON.stringify(r));
    ok('ADD-1b source array untouched (new list)', src.length === 0);
}
{
    const r = TripEntryList.addEntry([], { category: "", checked: false });
    ok('ADD-2 addEntry rejects entry with no meaningful non-category/checked field',
        r.changed === false && r.reason === "empty", JSON.stringify(r));
}

// ---------- updateEntry ----------
{
    const r = TripEntryList.updateEntry([{ item: "x" }], 0, { item: "y" });
    ok('UPD-1 updateEntry replaces at index', r.changed === true && r.list[0].item === "y", JSON.stringify(r));
}
{
    const r = TripEntryList.updateEntry([{ item: "x" }], 5, { item: "z" });
    ok('UPD-2 updateEntry rejects out-of-range index', r.changed === false && r.reason === "bad-index", JSON.stringify(r));
}

// ---------- deleteEntry ----------
{
    const r = TripEntryList.deleteEntry([{ a: 1 }], 5);
    ok('DEL-1 deleteEntry rejects out-of-range index', r.changed === false, JSON.stringify(r));
}
{
    const r = TripEntryList.deleteEntry([{ a: 1 }, { b: 2 }], 0);
    ok('DEL-2 deleteEntry removes at index', r.changed === true && r.list.length === 1, JSON.stringify(r));
}

// ---------- toggleChecked ----------
{
    const r1 = TripEntryList.toggleChecked([{ item: "x", checked: false }], 0);
    ok('TOG-1 toggleChecked flips false -> true', r1.list[0].checked === true, JSON.stringify(r1));
    const r2 = TripEntryList.toggleChecked(r1.list, 0);
    ok('TOG-2 toggleChecked flips true -> false', r2.list[0].checked === false, JSON.stringify(r2));
}

// ---------- addCategory ----------
{
    const r = TripEntryList.addCategory([{ category: "A", item: "x" }], "A");
    ok('CAT-1 addCategory rejects duplicate category', r.changed === false, JSON.stringify(r));
}
{
    const r = TripEntryList.addCategory([], "Toiletries");
    ok('CAT-2 addCategory adds a new category placeholder',
        r.changed === true && r.list.some(e => e.category === "Toiletries"), JSON.stringify(r));
}

// ---------- _inputTypeFor ----------
{
    ok('TYP-1 _inputTypeFor defaults to text', TripEntryList._inputTypeFor({ name: "x" }) === "text");
    ok('TYP-2 _inputTypeFor passes through date', TripEntryList._inputTypeFor({ name: "x", type: "date" }) === "date");
    ok('TYP-3 _inputTypeFor passes through time', TripEntryList._inputTypeFor({ name: "x", type: "time" }) === "time");
    ok('TYP-4 _inputTypeFor maps link -> url', TripEntryList._inputTypeFor({ name: "x", type: "link" }) === "url");
    ok('TYP-5 _inputTypeFor passes through select', TripEntryList._inputTypeFor({ name: "x", type: "select" }) === "select");
}

// ---------- _dateCss ----------
{
    const css = TripEntryList._dateCss();
    ok('CSS-1 _dateCss includes iOS-safe appearance override',
        css.includes("-webkit-appearance:none") && css.includes("max-width:100%"), css);
}

// ---------- _groupByDirection ----------
{
    const g = TripEntryList._groupByDirection([{ direction: "Return", airline: "DL" }, { direction: "Outbound", airline: "UA" }, { airline: "AA" }]);
    ok('GRP-1 groups Outbound, Return, Other in order; empties dropped',
        g.map(x => x.label).join(",") === "Outbound,Return,Other", JSON.stringify(g.map(x => x.label)));
    ok('GRP-2 preserves input order within a group', g[0].entries[0].airline === "UA", JSON.stringify(g[0]));
}

// ---------- _packingItemFields ----------
{
    const spec = TripEntryList._packingItemFields(["Clothing", "Toiletries"]);
    ok('PKF-1 single category field', spec.filter(f => f.name === "category").length === 1, JSON.stringify(spec));
    const cat = spec.find(f => f.name === "category");
    ok('PKF-2 category is a select sourced from existing categories, first auto',
        cat.type === "select" && cat.options[0] === "Clothing", JSON.stringify(cat));
    ok('PKF-3 has an item text field', spec.some(f => f.name === "item" && (f.type === "text" || !f.type)), JSON.stringify(spec));
}

// ---------- per-section field specs ----------
{
    const ff = TripEntryList._flightFields();
    ok('FLD-1 flight fields carry direction select', ff.some(f => f.name === "direction" && f.type === "select"), JSON.stringify(ff));
    ok('FLD-2 flight fields carry depart_date date', ff.some(f => f.name === "depart_date" && f.type === "date"));
    ok('FLD-3 flight fields carry depart_time time', ff.some(f => f.name === "depart_time" && f.type === "time"));
    ok('FLD-4 flight fields carry link', ff.some(f => f.name === "link" && f.type === "link"));
    const sf = TripEntryList._stayFields();
    ok('FLD-5 stay fields carry check_in date + link', sf.some(f => f.name === "check_in" && f.type === "date") && sf.some(f => f.name === "link" && f.type === "link"), JSON.stringify(sf));
}

// ---------- _fieldsFor (fixes edit dialog) ----------
{
    ok('FF-1 _fieldsFor flights derives airline', TripEntryList._fieldsFor({ kind: "flights" }).some(f => f.name === "airline"));
    ok('FF-2 _fieldsFor stay derives check_in', TripEntryList._fieldsFor({ kind: "stay" }).some(f => f.name === "check_in"));
    ok('FF-3 _fieldsFor packing derives item', TripEntryList._fieldsFor({ kind: "packing", __cats: ["A"] }).some(f => f.name === "item"));
    ok('FF-4 _fieldsFor explicit fields win', TripEntryList._fieldsFor({ fields: [{ name: "z" }] })[0].name === "z");
}
{
    // Edit form: grouped (packing) → exactly ONE populated category select + item
    // (no doubled category); flat sections → their kind's fields, no category.
    const pe = TripEntryList._editFields({ group: true, kind: "packing" }, ["Clothing", "Toiletries"]);
    ok('EF-1 packing edit has exactly one category field', pe.filter(f => f.name === "category").length === 1);
    ok('EF-2 packing edit category select is populated', (pe.find(f => f.name === "category").options || [])[0] === "Clothing");
    ok('EF-3 packing edit has item field', pe.some(f => f.name === "item"));
    const fe = TripEntryList._editFields({ kind: "flights" }, []);
    ok('EF-4 flight edit has fields, no stray category', fe.some(f => f.name === "airline") && fe.filter(f => f.name === "category").length === 0);
}

// ---------- flight schema: drop boarding, add arrival + delay ----------
{
    const ff = TripEntryList._flightFields();
    const n = ff.map(f => f.name);
    ok('FS-1 no boarding_time', !n.includes("boarding_time"), JSON.stringify(n));
    ok('FS-2 arrival_date date', n.includes("arrival_date") && ff.find(f => f.name === "arrival_date").type === "date", JSON.stringify(n));
    ok('FS-3 arrival_time time', n.includes("arrival_time") && ff.find(f => f.name === "arrival_time").type === "time", JSON.stringify(n));
    ok('FS-4 delay_minutes number', n.includes("delay_minutes") && ff.find(f => f.name === "delay_minutes").type === "number", JSON.stringify(n));
    ok('FS-5 keeps depart_date/time + direction', n.includes("depart_date") && n.includes("depart_time") && n.includes("direction"), JSON.stringify(n));
}

// ---------- _fmtDateTime ----------
{
    ok('FMT-1 _fmtDateTime formats date + 12h time', TripEntryList._fmtDateTime("2026-08-01", "13:00") === "Aug 1, 1:00 PM", TripEntryList._fmtDateTime("2026-08-01", "13:00"));
    ok('FMT-2 _fmtDateTime empty date+time -> ""', TripEntryList._fmtDateTime("", "") === "");
}

// ---------- pure flight-time math ----------
{
    const leg = { depart_date: "2026-07-16", depart_time: "09:39", arrival_date: "2026-07-16", arrival_time: "11:15", delay_minutes: "" };
    ok('FM-1 _toMin parses HH:MM', TripEntryList._toMin("09:39") === 579, String(TripEntryList._toMin("09:39")));
    ok('FM-2 _toMin blank -> null', TripEntryList._toMin("") === null, String(TripEntryList._toMin("")));
    ok('FM-3 _boardingMin = depart - 40', TripEntryList._boardingMin(leg) === "08:59", TripEntryList._boardingMin(leg));
    ok('FM-4 _durationMin', TripEntryList._durationMin(leg) === 96, String(TripEntryList._durationMin(leg)));
    ok('FM-5 _fmtDur h+m', TripEntryList._fmtDur(96) === "1h 36m", TripEntryList._fmtDur(96));
    ok('FM-6 _fmtDur m only', TripEntryList._fmtDur(45) === "45m", TripEntryList._fmtDur(45));

    const del = Object.assign({}, leg, { delay_minutes: "30" });
    ok('FM-7 _boardingMin cascades delay', TripEntryList._boardingMin(del) === "09:29", TripEntryList._boardingMin(del));
    ok('FM-8 _delayMin parses / defaults 0', TripEntryList._delayMin(del) === 30 && TripEntryList._delayMin(leg) === 0,
        TripEntryList._delayMin(del) + "/" + TripEntryList._delayMin(leg));

    // layover only for connecting same-direction legs (prev.to === next.from)
    const a = { direction: "Outbound", to: "ATL", arrival_date: "2026-07-16", arrival_time: "13:00" };
    const b = { direction: "Outbound", from: "ATL", depart_date: "2026-07-16", depart_time: "13:45" };
    ok('FM-9 _layoverMin connecting legs', TripEntryList._layoverMin(a, b) === 45, String(TripEntryList._layoverMin(a, b)));
    ok('FM-10 _layoverMin null across directions',
        TripEntryList._layoverMin(a, { direction: "Return", from: "ATL", depart_date: "2026-07-16", depart_time: "13:45" }) === null);
    ok('FM-11 _layoverMin null different airport',
        TripEntryList._layoverMin(a, { direction: "Outbound", from: "MCO", depart_date: "2026-07-16", depart_time: "13:45" }) === null);

    // ISO date tolerance
    ok('FM-12 _legDepartMs tolerates full ISO depart_date',
        TripEntryList._legDepartMs({ depart_date: "2026-07-16T00:00:00.000-06:00", depart_time: "09:39" }) === TripEntryList._legDepartMs(leg));

    // status at fixed now
    const dep = TripEntryList._legDepartMs(leg);
    ok('FM-13 status pre-boarding -> "in …"', TripEntryList._flightStatus(leg, dep - 90 * 60000).label.startsWith("in "),
        JSON.stringify(TripEntryList._flightStatus(leg, dep - 90 * 60000)));
    ok('FM-14 status Boarding within 40m window', TripEntryList._flightStatus(leg, dep - 20 * 60000).label === "Boarding",
        JSON.stringify(TripEntryList._flightStatus(leg, dep - 20 * 60000)));
    ok('FM-15 status In air after depart (arrival known)', TripEntryList._flightStatus(leg, dep + 5 * 60000).label === "In air",
        JSON.stringify(TripEntryList._flightStatus(leg, dep + 5 * 60000)));
    ok('FM-16 status Landed after arrival', TripEntryList._flightStatus(leg, TripEntryList._legArriveMs(leg) + 60000).label === "Landed",
        JSON.stringify(TripEntryList._flightStatus(leg, TripEntryList._legArriveMs(leg) + 60000)));
    ok('FM-17 status null when depart unknown', TripEntryList._flightStatus({ depart_time: "", depart_date: "" }, dep) === null);
}

// ---------- effective depart/arrival display (rich card) ----------
{
    ok('EFF-1 _effDepartDisplay no delay',
        TripEntryList._effDepartDisplay({ depart_date: "2026-07-16", depart_time: "09:39", delay_minutes: "" }) === "Jul 16, 9:39 AM",
        TripEntryList._effDepartDisplay({ depart_date: "2026-07-16", depart_time: "09:39", delay_minutes: "" }));
    ok('EFF-2 _effDepartDisplay shifts by delay',
        TripEntryList._effDepartDisplay({ depart_date: "2026-07-16", depart_time: "09:39", delay_minutes: "30" }) === "Jul 16, 10:09 AM",
        TripEntryList._effDepartDisplay({ depart_date: "2026-07-16", depart_time: "09:39", delay_minutes: "30" }));
    ok('EFF-3 _effDepartDisplay unknown -> ""', TripEntryList._effDepartDisplay({}) === "",
        JSON.stringify(TripEntryList._effDepartDisplay({})));
    ok('EFF-4 _effArriveDisplay no delay',
        TripEntryList._effArriveDisplay({ arrival_date: "2026-07-16", arrival_time: "11:15", delay_minutes: "" }) === "Jul 16, 11:15 AM",
        TripEntryList._effArriveDisplay({ arrival_date: "2026-07-16", arrival_time: "11:15", delay_minutes: "" }));
}

// ---------- _rowTitle / _rowSubtitle / _packingBuckets (FIX 1) ----------
{
    ok('RT-1 _rowTitle packing -> item', TripEntryList._rowTitle({ kind: "packing" }, { item: "Socks", category: "Clothing" }) === "Socks");
    ok('RT-2 _rowTitle stay -> name', TripEntryList._rowTitle({ kind: "stay" }, { name: "Beach House" }) === "Beach House");
    ok('RT-3 _rowTitle default -> item', TripEntryList._rowTitle({ fields: [] }, { item: "X" }) === "X");
    ok('RS-1 _rowSubtitle stay -> date range',
        TripEntryList._rowSubtitle({ kind: "stay" }, { check_in: "2026-07-16", check_out: "2026-07-20" }) === "Jul 16, 2026 → Jul 20, 2026",
        TripEntryList._rowSubtitle({ kind: "stay" }, { check_in: "2026-07-16", check_out: "2026-07-20" }));
    ok('RS-2 _rowSubtitle packing -> ""', TripEntryList._rowSubtitle({ kind: "packing" }, { item: "X" }) === "");

    const b = TripEntryList._packingBuckets([{ category: "Clothing" }, { category: "Clothing", item: "Socks" }, { category: "Bookbag" }]);
    ok('PB-1 two buckets first-seen order', b.length === 2, JSON.stringify(b.map(x => x.category)));
    const cl = b.find(x => x.category === "Clothing");
    ok('PB-2 Clothing keeps only item rows w/ absIndex',
        cl.rows.length === 1 && cl.rows[0].entry.item === "Socks" && cl.rows[0].absIndex === 1, JSON.stringify(cl));
    const bb = b.find(x => x.category === "Bookbag");
    ok('PB-3 empty category kept as header', bb.rows.length === 0, JSON.stringify(bb));

    // FEATURE 1: checked items sink to the bottom of their category (stable),
    // absIndex preserved (points back into the ORIGINAL items array).
    const s = TripEntryList._packingBuckets([
        { category: "Clothing", item: "Socks", checked: true },
        { category: "Clothing", item: "Underwear", checked: false },
        { category: "Clothing", item: "Swim Trunks", checked: false },
    ]);
    const scl = s.find(x => x.category === "Clothing");
    ok('PB-4 unchecked first, checked last (stable)',
        scl.rows.map(r => r.entry.item).join(",") === "Underwear,Swim Trunks,Socks", JSON.stringify(scl.rows.map(r => r.entry.item)));
    ok('PB-5 absIndex preserved after sink (Socks=0)', scl.rows.find(r => r.entry.item === "Socks").absIndex === 0, JSON.stringify(scl.rows));
    ok('PB-6 absIndex preserved after sink (Underwear=1)', scl.rows.find(r => r.entry.item === "Underwear").absIndex === 1, JSON.stringify(scl.rows));
}

// ---------- _addItemValuesForCategory (FEATURE 2: per-category + button) ----------
{
    ok('AIV-1 preset category value', TripEntryList._addItemValuesForCategory("Clothing").category === "Clothing", JSON.stringify(TripEntryList._addItemValuesForCategory("Clothing")));
    ok('AIV-2 empty/undefined -> ""', TripEntryList._addItemValuesForCategory("").category === "" && TripEntryList._addItemValuesForCategory().category === "", JSON.stringify(TripEntryList._addItemValuesForCategory()));
}

// ---------- _daysUntilDate (FIX 3) ----------
{
    const now = Date.UTC(2026, 6, 12, 20, 0) / 1; // Jul 12
    const legA = { depart_date: "2026-07-16", depart_time: "09:39", arrival_date: "2026-07-16", arrival_time: "11:15" };
    const legB = { depart_date: "2026-07-16", depart_time: "13:39", arrival_date: "2026-07-16", arrival_time: "16:00" };
    const sa = TripEntryList._flightStatus(legA, now).label, sb = TripEntryList._flightStatus(legB, now).label;
    ok('DU-1 same-date legs give identical "in N days"', sa === sb && /days/.test(sa), sa + " / " + sb);
    ok('DU-2 today -> 0', TripEntryList._daysUntilDate("2026-07-12", now) === 0, String(TripEntryList._daysUntilDate("2026-07-12", now)));
    ok('DU-3 label self-consistent with _daysUntilDate',
        TripEntryList._flightStatus(legA, now).label === "in " + TripEntryList._daysUntilDate("2026-07-16", now) + " days",
        sa);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
