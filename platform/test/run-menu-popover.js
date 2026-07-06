#!/usr/bin/env node
/**
 * run-menu-popover.js — MenuPopover is the shared popup primitive (the DRY
 * extraction of the desktop-dropdown / mobile-bottom-sheet overlay that
 * space-nav-buttons / project-nav-buttons / trip-nav-buttons duplicated).
 *
 * These tests drive the REAL MenuPopover class (loaded via new Function so
 * there are no imports/exports — it is a customJS filesystem-scanned class)
 * against a hand-written DOM stub that mirrors the DOM API the source uses:
 * createElement / appendChild / style.cssText / onclick / addEventListener /
 * removeEventListener / remove / getBoundingClientRect / querySelector.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MECH = path.join(ROOT, 'platform', 'mechanisms', 'menu-popover', 'menu-popover.js');

// loadClass — mirror the run-section-label.js loader: eval the source and
// return the named class (no module system in customJS).
function loadClass(absPath, className) {
  const src = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
  if (!src) return null;
  return new Function(`${src}\nreturn ${className};`)();
}

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// --------------------------------------------------------------------------- DOM stub
// A minimal but faithful element: children[], style.cssText, event listeners,
// remove(), appendChild(), querySelector/querySelectorAll (by className),
// getBoundingClientRect(). onclick is a settable handler the tests can invoke.
function makeEl(tag) {
  const el = {
    tag,
    className: '',
    textContent: '',
    innerHTML: '',
    style: { cssText: '' },
    children: [],
    onclick: null,
    onmouseenter: null,
    onmouseleave: null,
    _removed: false,
    _listeners: [],
  };
  el.createElement = (t) => makeEl(t);
  el.appendChild = (c) => { el.children.push(c); c._parent = el; return c; };
  el.remove = () => {
    el._removed = true;
    if (el._parent && el._parent.children) {
      const i = el._parent.children.indexOf(el);
      if (i >= 0) el._parent.children.splice(i, 1);
    }
  };
  el.addEventListener = (type, fn, capture) => { el._listeners.push({ type, fn, capture }); };
  el.removeEventListener = (type, fn, capture) => {
    const i = el._listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) el._listeners.splice(i, 1);
  };
  el.getBoundingClientRect = () => ({ left: 10, bottom: 40, top: 20, width: 120, height: 20 });
  // querySelector / querySelectorAll walk the subtree matching a ".className"
  // selector (that is all the source needs to find an already-open overlay).
  const matches = (node, sel) => sel[0] === '.' && node.className &&
    (' ' + node.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0;
  const walk = (node, sel, acc) => {
    for (const c of node.children || []) {
      if (matches(c, sel)) acc.push(c);
      walk(c, sel, acc);
    }
    return acc;
  };
  el.querySelector = (sel) => { const a = walk(el, sel, []); return a[0] || null; };
  el.querySelectorAll = (sel) => walk(el, sel, []);
  return el;
}

// A document stub: has a body element and delegates createElement + doc-level
// add/removeEventListener (the capture-phase Escape listener lives on the doc).
function makeDoc(bodyOverrides) {
  const body = makeEl('body');
  if (bodyOverrides) Object.assign(body, bodyOverrides);
  const doc = {
    body,
    _listeners: [],
    createElement: (t) => makeEl(t),
  };
  doc.addEventListener = (type, fn, capture) => { doc._listeners.push({ type, fn, capture }); };
  doc.removeEventListener = (type, fn, capture) => {
    const i = doc._listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) doc._listeners.splice(i, 1);
  };
  return doc;
}

const MP = loadClass(MECH, 'MenuPopover');

// --------------------------------------------------------------------------- MP-1
// _isMobile → false for a wide stub, true for a narrow one (clientWidth <= 600).
{
  const wide = { body: { clientWidth: 1200 } };
  const narrow = { body: { clientWidth: 390 } };
  const passWide = MP ? (new MP())._isMobile(wide) === false : false;
  const passNarrow = MP ? (new MP())._isMobile(narrow) === true : false;
  ok('MP-1 _isMobile false wide / true narrow', passWide && passNarrow);
}

// --------------------------------------------------------------------------- MP-2
// _partitionSections groups entries by preceding {section} marker.
{
  let pass = false;
  if (MP) {
    const parts = (new MP())._partitionSections([
      { section: 'This project' },
      { label: 'Board', onSelect() {} },
      { section: 'Vault' },
      { label: 'Home', onSelect() {} },
    ]);
    pass = Array.isArray(parts) && parts.length === 2 &&
      parts[0].section === 'This project' &&
      parts[0].rows.length === 1 && parts[0].rows[0].label === 'Board' &&
      parts[1].section === 'Vault' &&
      parts[1].rows.length === 1 && parts[1].rows[0].label === 'Home';
  }
  ok('MP-2 _partitionSections groups by section marker', pass);
}

// --------------------------------------------------------------------------- MP-3
// open() appends exactly ONE overlay to doc.body with a __navClose function.
{
  let pass = false;
  if (MP) {
    const doc = makeDoc();
    const anchor = makeEl('button');
    const entries = [{ label: 'Board', onSelect() {} }];
    const overlay = (new MP()).open(entries, { doc, anchor });
    const overlays = doc.body.children;
    pass = overlays.length === 1 &&
      overlays[0] === overlay &&
      typeof overlay.__navClose === 'function';
  }
  ok('MP-3 open() appends one overlay w/ __navClose', pass);
}

// --------------------------------------------------------------------------- MP-4
// Clicking a rendered row button calls that entry's onSelect exactly once AND
// removes the overlay (row click → close() then onSelect()).
{
  let pass = false;
  if (MP) {
    const doc = makeDoc();
    const anchor = makeEl('button');
    let selectCount = 0;
    const entries = [{ label: 'Board', onSelect() { selectCount += 1; } }];
    const overlay = (new MP()).open(entries, { doc, anchor });
    // Find the row button by walking the overlay subtree for a clickable el
    // whose innerHTML mentions the label.
    const collect = (node, acc) => {
      for (const c of node.children || []) {
        if (typeof c.onclick === 'function') acc.push(c);
        collect(c, acc);
      }
      return acc;
    };
    const clickables = collect(overlay, []);
    const rowBtn = clickables.find(b => (b.innerHTML || '').indexOf('Board') >= 0);
    if (rowBtn && rowBtn.onclick) rowBtn.onclick({ stopPropagation() {} });
    pass = selectCount === 1 && (overlay._removed === true || doc.body.children.length === 0);
  }
  ok('MP-4 row click → onSelect once + overlay removed', pass);
}

// --------------------------------------------------------------------------- MP-5
// After close, the capture-phase keydown listener is removed — the same handler
// fn that addEventListener received is passed to removeEventListener.
{
  let pass = false;
  if (MP) {
    const doc = makeDoc();
    const anchor = makeEl('button');
    const added = [];
    const removed = [];
    const origAdd = doc.addEventListener;
    const origRemove = doc.removeEventListener;
    doc.addEventListener = (type, fn, capture) => { added.push({ type, fn, capture }); return origAdd(type, fn, capture); };
    doc.removeEventListener = (type, fn, capture) => { removed.push({ type, fn, capture }); return origRemove(type, fn, capture); };
    const overlay = (new MP()).open([{ label: 'Board', onSelect() {} }], { doc, anchor });
    const keyAdd = added.find(a => a.type === 'keydown');
    overlay.__navClose();
    const keyRemove = removed.find(r => r.type === 'keydown');
    pass = !!keyAdd && !!keyRemove &&
      keyAdd.fn === keyRemove.fn &&
      keyAdd.capture === true && keyRemove.capture === true &&
      doc._listeners.findIndex(l => l.type === 'keydown') === -1;
  }
  ok('MP-5 close removes the exact keydown handler (capture)', pass);
}

// --------------------------------------------------------------------------- MP-6
// open() twice with the SAME anchor toggles: the 2nd call removes the prior
// overlay and adds none (net zero overlays on body).
{
  let pass = false;
  if (MP) {
    const doc = makeDoc();
    const anchor = makeEl('button');
    const entries = [{ label: 'Board', onSelect() {} }];
    (new MP()).open(entries, { doc, anchor });
    const afterFirst = doc.body.children.length;
    (new MP()).open(entries, { doc, anchor });
    const afterSecond = doc.body.children.length;
    pass = afterFirst === 1 && afterSecond === 0;
  }
  ok('MP-6 re-open with same anchor toggles to zero overlays', pass);
}

// --------------------------------------------------------------------------- MP-7
// Explicit opts.isMobile threads through open() regardless of doc width — this
// locks the precedence (opts.isMobile wins over the _isMobile(doc) fallback).
// A wide doc + isMobile:true MUST render the mobile bottom-sheet (handle bar +
// backdrop overlay); a wide doc + isMobile:false MUST render the desktop
// dropdown (no handle, transparent overlay). We assert via the explicit
// opts.isMobile path only (no global `app` in the Node harness).
{
  let pass = false;
  if (MP) {
    // The mobile panel prepends a "handle" bar: a div whose cssText carries the
    // 40px x 4px pill. Detect it by walking the overlay subtree.
    const hasHandle = (overlay) => {
      const found = [];
      const walk = (node) => {
        for (const c of node.children || []) {
          const cs = (c.style && c.style.cssText) || '';
          if (cs.indexOf('width: 40px') >= 0 && cs.indexOf('height: 4px') >= 0) found.push(c);
          walk(c);
        }
      };
      walk(overlay);
      return found.length > 0;
    };

    // Wide doc, force mobile → mobile branch (handle bar + backdrop overlay).
    const docA = makeDoc({ clientWidth: 1400 });
    const overlayMobile = (new MP()).open([{ label: 'Board', onSelect() {} }],
      { doc: docA, anchor: makeEl('button'), isMobile: true });
    const mobileCss = (overlayMobile.style && overlayMobile.style.cssText) || '';
    const mobileRan = hasHandle(overlayMobile) && mobileCss.indexOf('rgba(0,0,0,0.45)') >= 0;

    // Wide doc, force desktop → desktop branch (no handle + transparent overlay).
    const docB = makeDoc({ clientWidth: 1400 });
    const overlayDesktop = (new MP()).open([{ label: 'Board', onSelect() {} }],
      { doc: docB, anchor: makeEl('button'), isMobile: false });
    const desktopCss = (overlayDesktop.style && overlayDesktop.style.cssText) || '';
    const desktopRan = !hasHandle(overlayDesktop) && desktopCss.indexOf('background: transparent') >= 0;

    pass = mobileRan && desktopRan;
  }
  ok('MP-7 opts.isMobile precedence: true→mobile, false→desktop (wide doc)', pass);
}

// --------------------------------------------------------------------------- MP-8
// Opening-gesture guard (the mobile ghost-click fix). On a phone the tap that
// opens the sheet synthesizes a delayed "ghost" click at the tap coordinates;
// the full-screen backdrop now covers that point, so the click lands on the
// backdrop and self-dismissed the just-opened sheet (opens-then-closes =
// "tapping does nothing"). A backdrop dismiss WITHIN the opening window must be
// ignored; a deliberate tap AFTER the window must still close.
{
  let pass = false;
  if (MP) {
    const doc = makeDoc();
    const anchor = makeEl('button');
    const overlay = (new MP()).open([{ label: 'Board', onSelect() {} }], { doc, anchor });
    // Immediately (within the opening window): a backdrop click must NOT close.
    if (overlay.onclick) overlay.onclick({ target: overlay });
    const survivedGhost = doc.body.children.length === 1 && overlay._removed !== true;
    // Past the 400ms window: the same backdrop click DOES close it.
    const realNow = Date.now;
    let closedLater = false;
    try {
      Date.now = () => realNow() + 500;
      if (overlay.onclick) overlay.onclick({ target: overlay });
      closedLater = overlay._removed === true || doc.body.children.length === 0;
    } finally { Date.now = realNow; }
    pass = survivedGhost && closedLater;
  }
  ok('MP-8 backdrop dismiss ignored during opening gesture, honored after', pass);
}

// --------------------------------------------------------------------------- MP-9
// customjs static-vs-instance regression. The customJS plugin stores the class as
// an INSTANCE (`customJS.MenuPopover = new MenuPopover()`), and callers reach it
// via `customJS.MenuPopover.open(...)`. If `open` were STATIC it would be undefined
// on the instance → every launcher (Go / hub ⋯ / per-row ⋯) silently no-ops at
// runtime (the exact bug this locks out). Assert the public method + the internals
// it needs are reachable on a fresh INSTANCE, not just the class, and that an
// instance actually opens.
{
  let pass = false;
  if (MP) {
    const inst = new MP();
    pass = typeof inst.open === 'function'
      && typeof inst._isMobile === 'function'
      && typeof inst._partitionSections === 'function'
      && typeof inst._buildRow === 'function'
      && typeof inst._sectionHeader === 'function';
    if (pass) {
      const doc = makeDoc();
      const ov = inst.open([{ label: 'Board', onSelect() {} }], { doc, anchor: makeEl('button') });
      pass = !!ov && doc.body.children.length === 1;
    }
  }
  ok('MP-9 methods reachable on a customJS INSTANCE (not static) + opens', pass);
}

// --------------------------------------------------------------------------- MP-10..13
// layout:"grid" — a section marker opting into a 2-column grid (added to make
// the project-chrome-bar Go ▾ launcher's long Vault list scannable instead of
// one tall stacked column). Opt-in per section: every OTHER marker/caller
// (untouched by this change) keeps the original stacked-list rendering.
function allDescendants(el) {
  const out = [];
  for (const c of (el.children || [])) { out.push(c); out.push(...allDescendants(c)); }
  return out;
}
const gridEntries = [
  { section: 'This project' },
  { label: 'Board', onSelect() {} },
  { section: 'Vault', layout: 'grid' },
  { label: 'Home', onSelect() {} },
  { label: 'Daily', onSelect() {} },
  { label: 'Wiki', onSelect() {} },
];

// MP-10 — desktop: the grid section's rows land inside a display:grid wrapper
// (not appended straight to the panel), while the ungridded "This project"
// section's row is a direct panel child.
{
  const inst = new MP();
  const doc = makeDoc({ clientWidth: 1400 });
  const overlay = inst.open(gridEntries, { doc, anchor: makeEl('button'), isMobile: false });
  const panel = overlay.children.find((c) => c.className === 'menu-popover-panel');
  const gridWrapper = panel.children.find((c) => /display:\s*grid/.test(c.style.cssText || ''));
  const boardIsDirectChild = panel.children.some((c) => c.tag === 'button' && /Board/.test(c.innerHTML));
  const wrapperRowLabels = gridWrapper ? allDescendants(gridWrapper).filter((c) => c.tag === 'button').map((c) => c.innerHTML) : [];
  ok('MP-10a desktop grid section renders rows inside a display:grid wrapper',
    !!gridWrapper && wrapperRowLabels.length === 3);
  ok('MP-10b the ungridded section\'s row is still a direct panel child (unchanged)', boardIsDirectChild);
}

// MP-11 — mobile: layout:"grid" is desktop-only; the bottom-sheet stays a
// single stacked column (no grid wrapper) so long labels don't get cramped.
{
  const inst = new MP();
  const doc = makeDoc({ clientWidth: 390 });
  const overlay = inst.open(gridEntries, { doc, anchor: makeEl('button'), isMobile: true });
  const panel = overlay.children.find((c) => c.className === 'menu-popover-panel');
  const hasGridWrapper = panel.children.some((c) => /display:\s*grid/.test(c.style.cssText || ''));
  ok('MP-11 mobile ignores layout:"grid" — no grid wrapper, stays single-column', !hasGridWrapper);
}

// MP-12 — the desktop dropdown widens (>=340px) when a grid section is present
// vs the existing 300px floor when none is.
{
  const inst = new MP();
  const doc1 = makeDoc({ clientWidth: 1400 });
  const ov1 = inst.open(gridEntries, { doc: doc1, anchor: makeEl('button'), isMobile: false });
  const w1 = parseInt(/width:\s*(\d+)px/.exec(ov1.children.find((c) => c.className === 'menu-popover-panel').style.cssText)[1], 10);

  const inst2 = new MP();
  const doc2 = makeDoc({ clientWidth: 1400 });
  const ov2 = inst2.open([{ label: 'Board', onSelect() {} }], { doc: doc2, anchor: makeEl('button'), isMobile: false });
  const w2 = parseInt(/width:\s*(\d+)px/.exec(ov2.children.find((c) => c.className === 'menu-popover-panel').style.cssText)[1], 10);

  ok('MP-12 desktop panel widens to >=340px when a grid section is present (vs 300px floor otherwise)',
    w1 >= 340 && w2 === 300, `w1=${w1} w2=${w2}`);
}

// MP-13 — _partitionSections carries the `layout` hint through untouched for
// non-grid markers (undefined), proving the change is additive.
{
  const inst = new MP();
  const parts = inst._partitionSections([{ section: 'This project' }, { label: 'Board', onSelect() {} }]);
  ok('MP-13 _partitionSections leaves layout undefined for a plain section marker',
    parts[0] && parts[0].layout === undefined);
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
