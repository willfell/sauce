#!/usr/bin/env node
/**
 * run-links.js — links mechanism (customJS.Links).
 * Covers Links.parse() normalization + Links.render() read-only anchor list.
 * Fails (cannot load the class) if the mechanism source is reverted — the
 * regression guard Gate B Layer 1 checks.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH = path.join(ROOT, 'platform', 'mechanisms', 'links', 'links.js');

// Obsidian-ish element stub: createEl(tag, {text, href}) + setAttr + style.
function makeEl(tag) {
  const el = { tag, textContent: '', href: undefined, attrs: {}, style: { cssText: '' }, children: [] };
  el.createEl = (t, opts) => {
    const c = makeEl(t);
    if (opts && opts.text != null) c.textContent = opts.text;
    if (opts && opts.href != null) c.href = opts.href;
    el.children.push(c);
    return c;
  };
  el.setAttr = (k, v) => { el.attrs[k] = v; };
  return el;
}

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

const SRC = fs.existsSync(MECH) ? fs.readFileSync(MECH, 'utf8') : '';
const Cls = SRC ? new Function(`${SRC}\nreturn Links;`)() : null;
ok('L0 mechanism class loads', !!Cls);
const L = Cls ? new Cls() : null;

// ---- parse() ----
// L1 — array of {url,text} objects passes through normalized
{
  const r = L && L.parse([{ url: 'https://a.com', text: 'A' }, { url: 'https://b.com', text: 'B' }]);
  ok('L1 objects normalized', r && r.length === 2 && r[0].url === 'https://a.com' && r[0].text === 'A' && r[1].text === 'B');
}
// L2 — {url,label} and {href,text} aliases resolve
{
  const r = L && L.parse([{ url: 'https://a.com', label: 'Alpha' }, { href: 'https://b.com', text: 'Beta' }]);
  ok('L2 label/href aliases', r && r.length === 2 && r[0].text === 'Alpha' && r[1].url === 'https://b.com' && r[1].text === 'Beta');
}
// L2b — {link} url alias and {title}/{name} text aliases resolve
{
  const r = L && L.parse([{ link: 'https://a.com', title: 'Ay' }, { url: 'https://b.com', name: 'Bee' }]);
  ok('L2b link/title/name aliases', r && r.length === 2 && r[0].url === 'https://a.com' && r[0].text === 'Ay' && r[1].text === 'Bee');
}
// L3 — bare URL strings: text defaults to the url
{
  const r = L && L.parse(['https://a.com', 'https://b.com']);
  ok('L3 bare strings text=url', r && r.length === 2 && r[0].url === 'https://a.com' && r[0].text === 'https://a.com');
}
// L4 — missing text defaults to url
{
  const r = L && L.parse([{ url: 'https://a.com' }]);
  ok('L4 missing text -> url', r && r.length === 1 && r[0].text === 'https://a.com');
}
// L5 — JSON-encoded string is parsed
{
  const r = L && L.parse('[{"url":"https://a.com","text":"A"}]');
  ok('L5 json string parsed', r && r.length === 1 && r[0].url === 'https://a.com' && r[0].text === 'A');
}
// L6 — a single bare url string (not JSON) becomes one entry
{
  const r = L && L.parse('https://solo.com');
  ok('L6 bare url string', r && r.length === 1 && r[0].url === 'https://solo.com' && r[0].text === 'https://solo.com');
}
// L7 — entries with no url are dropped; null/garbage entries dropped
{
  const r = L && L.parse([{ text: 'no url' }, null, 42, { url: '' }, { url: 'https://ok.com', text: 'OK' }]);
  ok('L7 urlless/garbage dropped', r && r.length === 1 && r[0].url === 'https://ok.com');
}
// L8 — duplicate urls keep the first occurrence
{
  const r = L && L.parse([{ url: 'https://a.com', text: 'first' }, { url: 'https://a.com', text: 'second' }]);
  ok('L8 dedup keeps first', r && r.length === 1 && r[0].text === 'first');
}
// L9 — whitespace trimmed on url + text
{
  const r = L && L.parse([{ url: '  https://a.com  ', text: '  A  ' }]);
  ok('L9 trims whitespace', r && r.length === 1 && r[0].url === 'https://a.com' && r[0].text === 'A');
}
// L10 — null/undefined/non-array/empty-string -> []
{
  const empties = [null, undefined, {}, 5, '', '   '].map(v => L && L.parse(v));
  ok('L10 empties -> []', empties.every(a => Array.isArray(a) && a.length === 0));
}
// L11 — order is preserved
{
  const r = L && L.parse([{ url: 'https://1.com' }, { url: 'https://2.com' }, { url: 'https://3.com' }]);
  ok('L11 order preserved', r && r.map(x => x.url).join(',') === 'https://1.com,https://2.com,https://3.com');
}

// ---- render() ----
// L12 — renders one anchor per link with href + text + external attrs
{
  const c = makeEl('div');
  const n = L && L.render({ container: c }, { links: [{ url: 'https://a.com', text: 'A' }, { url: 'https://b.com', text: 'B' }] });
  const anchors = [];
  const walk = (el) => { for (const ch of el.children) { if (ch.tag === 'a') anchors.push(ch); walk(ch); } };
  walk(c);
  // Assert EVERY anchor carries the external-safe attrs (not just the first) —
  // a per-anchor rel="noopener"/target regression must not slip through.
  const everyAnchorSafe = anchors.length === 2 &&
    anchors.every(a => a.attrs.target === '_blank' && a.attrs.rel === 'noopener' && typeof a.href === 'string' && a.href.length > 0);
  ok('L12 anchors rendered (per-anchor target/rel/href/text)', n === 2 && everyAnchorSafe &&
    anchors[0].href === 'https://a.com' && anchors[0].textContent === 'A' &&
    anchors[1].href === 'https://b.com' && anchors[1].textContent === 'B');
}
// L13 — empty links renders no anchors and returns 0
{
  const c = makeEl('div');
  const n = L && L.render({ container: c }, { links: [] });
  const anchors = [];
  const walk = (el) => { for (const ch of el.children) { if (ch.tag === 'a') anchors.push(ch); walk(ch); } };
  walk(c);
  ok('L13 empty -> 0 anchors', n === 0 && anchors.length === 0);
}
// L14 — empty message rendered when opts.empty given and no links
{
  const c = makeEl('div');
  L && L.render({ container: c }, { links: [], empty: 'No links yet' });
  ok('L14 empty message', c.children.some(x => x.textContent === 'No links yet'));
}
// L15 — title renders a label
{
  const c = makeEl('div');
  L && L.render({ container: c }, { links: [{ url: 'https://a.com' }], title: 'Helpful Links' });
  ok('L15 title label', c.children.some(x => x.textContent === 'Helpful Links'));
}
// L16 — cold-load safe: null dv / bad container / no opts never throw
{
  let threw = false;
  try {
    L && L.render(null, { links: [{ url: 'https://a.com' }] });
    L && L.render({ container: null }, {});
    L && L.render({}, undefined);
    L && L.render(undefined, undefined);
  } catch (_e) { threw = true; }
  ok('L16 cold-load no throw', !threw);
}
// L17 — render normalizes a raw frontmatter value (string) too
{
  const c = makeEl('div');
  const n = L && L.render({ container: c }, { links: '[{"url":"https://a.com","text":"A"}]' });
  ok('L17 render parses raw value', n === 1);
}

// ---- ProjectLinksPanel._linkCards() (pure; drives the responsive card grid) ----
// The project Link Hub renders `links[]` as a responsive card grid; each card is
// built from a pure { text, url, host } shape so the host label + text-fallback +
// dedupe are unit-testable without a DOM. host = URL hostname (best-effort, never
// throws on a malformed url); text falls back to the host when empty.
{
  const src = fs.readFileSync(path.join(ROOT, 'platform', 'blueprints', 'project', 'helpers', 'project-links-panel.js'), 'utf8');
  const Panel = new Function(`${src}\nreturn ProjectLinksPanel;`)();
  ok('LC0 ProjectLinksPanel class loads', typeof Panel === 'function');
  const p = new Panel();

  // LC1 — spec example: dedupe by url, host derived, text fallback to host.
  const cards = p._linkCards([{ url: 'https://a.com/x', text: 'A' }, { url: 'https://b.com', text: '' }, { url: 'https://a.com/x', text: 'dupe' }]);
  ok('LC1 dedupe removes duplicate url', cards.length === 2);
  ok('LC1 card[0] {text,url,host}', cards[0].text === 'A' && cards[0].url === 'https://a.com/x' && cards[0].host === 'a.com');
  ok('LC1 card[1] host parsed', cards[1].host === 'b.com');
  ok('LC1 card[1] text falls back to host', cards[1].text === 'b.com');

  // LC2 — insertion order preserved.
  const ordered = p._linkCards([{ url: 'https://1.com' }, { url: 'https://2.com' }, { url: 'https://3.com' }]);
  ok('LC2 insertion order preserved', ordered.map((x) => x.host).join(',') === '1.com,2.com,3.com');

  // LC3 — bad / non-http url: host parsing never throws; text still resolves.
  let threw = false;
  let bad = [];
  try { bad = p._linkCards([{ url: 'not a url', text: '' }, { url: 'mailto:x@y.com', text: 'Mail' }]); } catch (_e) { threw = true; }
  ok('LC3 malformed url does not throw', !threw);
  ok('LC3 malformed url still yields a card with a text', bad.length === 2 && bad[0].text.length > 0 && bad[1].text === 'Mail');

  // LC4 — empty / garbage input -> [].
  ok('LC4 empty input -> []', Array.isArray(p._linkCards([])) && p._linkCards([]).length === 0);
  ok('LC4 non-array input -> []', Array.isArray(p._linkCards(null)) && p._linkCards(null).length === 0);
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
