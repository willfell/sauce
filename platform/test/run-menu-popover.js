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
  const passWide = MP ? MP._isMobile(wide) === false : false;
  const passNarrow = MP ? MP._isMobile(narrow) === true : false;
  ok('MP-1 _isMobile false wide / true narrow', passWide && passNarrow);
}

// --------------------------------------------------------------------------- MP-2
// _partitionSections groups entries by preceding {section} marker.
{
  let pass = false;
  if (MP) {
    const parts = MP._partitionSections([
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
    const overlay = MP.open(entries, { doc, anchor });
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
    const overlay = MP.open(entries, { doc, anchor });
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
    const overlay = MP.open([{ label: 'Board', onSelect() {} }], { doc, anchor });
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
    MP.open(entries, { doc, anchor });
    const afterFirst = doc.body.children.length;
    MP.open(entries, { doc, anchor });
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
    const overlayMobile = MP.open([{ label: 'Board', onSelect() {} }],
      { doc: docA, anchor: makeEl('button'), isMobile: true });
    const mobileCss = (overlayMobile.style && overlayMobile.style.cssText) || '';
    const mobileRan = hasHandle(overlayMobile) && mobileCss.indexOf('rgba(0,0,0,0.45)') >= 0;

    // Wide doc, force desktop → desktop branch (no handle + transparent overlay).
    const docB = makeDoc({ clientWidth: 1400 });
    const overlayDesktop = MP.open([{ label: 'Board', onSelect() {} }],
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
    const overlay = MP.open([{ label: 'Board', onSelect() {} }], { doc, anchor });
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

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
