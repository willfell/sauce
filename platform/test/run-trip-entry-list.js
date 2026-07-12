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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
