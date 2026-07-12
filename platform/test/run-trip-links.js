'use strict';

// run-trip-links.js — pure-op coverage for TripLinksManager's static link ops
// (addLink / updateLink / deleteLink over a `links: [{url,text}]` frontmatter
// array). These are a verbatim port of ProjectLinksManager's ops; the only
// blueprint-specific change is the note-type render guard (trip-section +
// section_kind:links), which is not exercised by the pure-op harness.
//
// TripLinksManager + TripLinksPanel are customJS classes (bare class expression,
// no trailing statements). Static ops are unit-testable in Node; the instance
// render()/modals are dogfood-only. Each op returns { links, changed, reason? }
// with `links` ALWAYS a new array so callers never mutate the source.
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

const TripLinksManager = loadClass('platform/blueprints/trips/helpers/trip-links-manager.js', 'TripLinksManager');

// ---------- addLink ----------
{
    const src = [];
    const r = TripLinksManager.addLink(src, { url: " https://a.com ", text: " A " });
    ok('ADD-1 addLink trims + appends', r.changed === true && r.links.length === 1 && r.links[0].url === "https://a.com" && r.links[0].text === "A", JSON.stringify(r));
    ok('ADD-1b source array untouched (new list)', src.length === 0);
}
{
    const r = TripLinksManager.addLink([], { url: "https://x.com" });
    ok('ADD-2 addLink defaults text to url', r.changed === true && r.links[0].text === "https://x.com", JSON.stringify(r));
}
{
    const r = TripLinksManager.addLink([], { url: "   ", text: "nope" });
    ok('ADD-3 addLink rejects empty url', r.changed === false && r.reason === "empty-url", JSON.stringify(r));
}
{
    const r = TripLinksManager.addLink([{ url: "https://a.com", text: "A" }], { url: "https://a.com", text: "dup" });
    ok('ADD-4 addLink rejects duplicate url', r.changed === false && r.reason === "duplicate", JSON.stringify(r));
}

// ---------- updateLink ----------
{
    const r = TripLinksManager.updateLink([{ url: "https://a.com", text: "A" }], 0, { url: "https://b.com", text: "B" });
    ok('UPD-1 updateLink replaces at index', r.changed === true && r.links[0].url === "https://b.com" && r.links[0].text === "B", JSON.stringify(r));
}
{
    const r = TripLinksManager.updateLink([{ url: "https://a.com" }], 5, { url: "https://z.com" });
    ok('UPD-2 updateLink rejects out-of-range index', r.changed === false && r.reason === "bad-index", JSON.stringify(r));
}
{
    const r = TripLinksManager.updateLink([{ url: "https://a.com" }, { url: "https://b.com" }], 1, { url: "https://a.com" });
    ok('UPD-3 updateLink rejects duplicate of another entry', r.changed === false && r.reason === "duplicate", JSON.stringify(r));
}
{
    const r = TripLinksManager.updateLink([{ url: "https://a.com" }], 0, { url: "  " });
    ok('UPD-4 updateLink rejects empty url', r.changed === false && r.reason === "empty-url", JSON.stringify(r));
}

// ---------- deleteLink ----------
{
    const r = TripLinksManager.deleteLink([{ url: "https://a.com" }], 5);
    ok('DEL-1 deleteLink rejects out-of-range index', r.changed === false && r.reason === "bad-index", JSON.stringify(r));
}
{
    const r = TripLinksManager.deleteLink([{ url: "https://a.com" }, { url: "https://b.com" }], 0);
    ok('DEL-2 deleteLink removes at index', r.changed === true && r.links.length === 1 && r.links[0].url === "https://b.com", JSON.stringify(r));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
