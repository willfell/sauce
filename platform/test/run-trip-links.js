'use strict';

// run-trip-links.js — pure-op coverage for TripLinks's static link ops
// (addLink / updateLink / deleteLink over a `links: [{url,text}]` frontmatter
// array on the trip ATLAS note). These are a verbatim port of
// ProjectLinksManager's ops. Also asserts the `links` SECTION kind is gone from
// TripSectionKinds (links now live on the atlas, not a dedicated section).
//
// TripLinks + TripSectionKinds are customJS classes (bare class expression, no
// trailing statements). Static ops are unit-testable in Node; the instance
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

const TripLinks = loadClass('platform/blueprints/trips/helpers/trip-links.js', 'TripLinks');
const TripSectionKinds = loadClass('platform/blueprints/trips/helpers/trip-section-kinds.js', 'TripSectionKinds');

// Dataview may expose frontmatter lists as iterable DataArrays.
{
    const dataArray = { [Symbol.iterator]: function* () { yield { url: 'https://a.com', text: 'A' }; } };
    const parsed = new TripLinks()._parse(dataArray);
    ok('DATA-1 iterable DataArray links normalize safely',
        parsed.length === 1 && parsed[0].url === 'https://a.com' && parsed[0].text === 'A');
}

// ---------- static ops (same semantics as ProjectLinksManager) ----------
{
    const r = TripLinks.addLink([], { url: " https://a.com ", text: "" });
    ok('ADD-1 addLink trims + defaults text to url', r.changed && r.links[0].url === "https://a.com" && r.links[0].text === "https://a.com", JSON.stringify(r));
}
{
    const r = TripLinks.addLink([{ url: "https://a.com", text: "A" }], { url: "https://a.com" });
    ok('ADD-2 addLink rejects duplicate url', r.reason === "duplicate", JSON.stringify(r));
}
{
    const r = TripLinks.addLink([], { url: "" });
    ok('ADD-3 addLink rejects empty url', r.reason === "empty-url", JSON.stringify(r));
}
{
    const r = TripLinks.updateLink([{ url: "x", text: "X" }], 9, { url: "y" });
    ok('UPD-1 updateLink rejects out-of-range index', r.changed === false, JSON.stringify(r));
}
{
    const r = TripLinks.deleteLink([{ url: "x" }], 0);
    ok('DEL-1 deleteLink removes at index', r.links.length === 0, JSON.stringify(r));
}
{
    const links = new TripLinks();
    const current = [{ url: "https://b.com", text: "B" }];
    ok('IDENTITY-1 modal target resolves by unique URL after a sibling index shift',
        links._linkIndex(current, { url: "https://b.com", text: "stale label" }) === 0
        && links._linkIndex(current, { url: "https://a.com" }) === -1);
}

// ---------- links section kind is gone ----------
{
    const kinds = new TripSectionKinds().all();
    ok('KIND-1 links section kind removed', kinds.every(k => k.kind !== "links"), JSON.stringify(kinds.map(k => k.kind)));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
