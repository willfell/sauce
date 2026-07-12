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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
