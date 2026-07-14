'use strict';

// run-trip-dashboard.js — pure-op coverage for the Trip Atlas dashboard's STATIC
// compute methods (countdown + packingCounts). TripDashboard is a customJS class
// (bare class expression, no trailing statements). Its instance render() is
// dogfood-only + cold-load-covered by run-trips-render-guards.js.
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

const TripDashboard = loadClass('platform/blueprints/trips/helpers/trip-dashboard.js', 'TripDashboard');

// ---------- countdown ----------
{
    const r = TripDashboard.countdown("2026-08-01", "2026-08-05", "2026-07-12");
    ok('CD-1 upcoming with day delta', r.state === "upcoming" && r.days === 20, JSON.stringify(r));
}
{
    const r = TripDashboard.countdown("2026-08-01", "2026-08-05", "2026-08-03");
    ok('CD-2 in-progress mid-trip', r.state === "in-progress", JSON.stringify(r));
}
{
    const r = TripDashboard.countdown("2026-08-01", "2026-08-05", "2026-08-10");
    ok('CD-3 complete after end', r.state === "complete", JSON.stringify(r));
}
{
    const r = TripDashboard.countdown("", "", "2026-07-12");
    ok('CD-4 unknown when no dates', r.state === "unknown" && r.days === null, JSON.stringify(r));
}

// ---------- packingCounts ----------
{
    const r = TripDashboard.packingCounts([
        { category: "A", item: "x", checked: true },
        { category: "A", item: "y", checked: false },
        { category: "B", item: "z", checked: false },
    ]);
    ok('PC-1 per-category total + checked',
        r.A && r.A.total === 2 && r.A.checked === 1 && r.B && r.B.total === 1 && r.B.checked === 0,
        JSON.stringify(r));
}
{
    const r = TripDashboard.packingCounts([{ category: "A" }]);
    ok('PC-2 category placeholder (no item) not counted', Object.keys(r).length === 0, JSON.stringify(r));
}

// ---------- _countOpenTasks (by trip_slug, parity with TaskTripList) ----------
{
    const rows = [
        { type: "task", status: "open", trip_slug: "bussin", source: "", file: { path: "spice/tasks/a.md" } },
        { type: "task", status: "open", trip_slug: "other",  source: "", file: { path: "spice/tasks/b.md" } },
        { type: "task", status: "open", trip_slug: "bussin", source: "meeting", file: { path: "spice/tasks/c.md" } },
        { type: "task", status: "done", trip_slug: "bussin", source: "", file: { path: "spice/tasks/d.md" } },
        { type: "task", status: "open", trip_slug: "bussin", source: "", file: { path: "spice/tasks/_trash/e.md" } },
    ];
    const mkArr = (a) => { a.where = (fn) => mkArr(a.filter(fn)); return a; };
    const dv = { pages: () => mkArr(rows.slice()) };
    ok('COT-1 counts only open non-meeting non-trashed tasks for the slug', TripDashboard._countOpenTasks(dv, "bussin") === 1);
    ok('COT-2 empty slug → 0', TripDashboard._countOpenTasks(dv, "") === 0);
    ok('COT-3 query throw → 0 (never throws)', TripDashboard._countOpenTasks({ pages(){ throw new Error("x"); } }, "bussin") === 0);
}

// ---------- _fmtDate ----------
{
    const r = TripDashboard._fmtDate("2026-08-01");
    ok('FD-1 YYYY-MM-DD string', r === "Aug 1, 2026", r);
}
{
    const r = TripDashboard._fmtDate(new Date(Date.UTC(2026, 7, 1)));
    ok('FD-2 Date object (UTC)', r === "Aug 1, 2026", r);
}
{
    const r = TripDashboard._fmtDate(1785542400000); // Date.UTC(2026,7,1)
    ok('FD-3 epoch millis', r === "Aug 1, 2026", r);
}
{
    const r = TripDashboard._fmtDate("");
    ok('FD-4 empty string', r === "", r);
}
{
    const r = TripDashboard._fmtDate(null);
    ok('FD-5 null', r === "", r);
}

// ---------- _itinerary + _staySummary (Task 5) ----------
{
    const flights = [
        { direction: "Outbound", from: "DEN", to: "ATL", depart_date: "2026-07-16", depart_time: "09:39" },
        { direction: "Outbound", from: "ATL", to: "VPS", depart_date: "2026-07-16", depart_time: "13:39" },
        { direction: "Return", from: "VPS", to: "DEN", depart_date: "2026-07-20", depart_time: "07:00" },
    ];
    const it = TripDashboard._itinerary(flights);
    ok('IT-1 two directions', it.length === 2, JSON.stringify(it));
    ok('IT-2 outbound chain collapsed', it[0].direction === "Outbound" && it[0].route === "DEN → ATL → VPS", JSON.stringify(it[0]));
    ok('IT-3 return chain', it[1].direction === "Return" && it[1].route === "VPS → DEN", JSON.stringify(it[1]));
    ok('IT-4 departsMs is a number', typeof it[0].departsMs === "number", JSON.stringify(it[0]));
}
{
    const stays = [{ name: "Beach House", check_in: "2026-07-16", check_out: "2026-07-20" }];
    const ss = TripDashboard._staySummary(stays);
    ok('SS-1 stay summary', ss.length === 1 && ss[0].name === "Beach House" && ss[0].check_in === "2026-07-16" && ss[0].check_out === "2026-07-20", JSON.stringify(ss));
}
{
    ok('IT-5 empty flights → []', TripDashboard._itinerary([]).length === 0);
    ok('SS-2 null stays → []', TripDashboard._staySummary(null).length === 0);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
