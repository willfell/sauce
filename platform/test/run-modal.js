'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'mechanisms', 'modal', 'sauce-modal.js');
let passes = 0;
let fails = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
    passes += 1;
  } catch (error) {
    console.error(`FAIL ${name}: ${error && error.message}`);
    fails += 1;
  }
}

function descendants(root) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children || []) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

function matches(node, selector) {
  if (!node) return false;
  if (selector.startsWith('.')) return (` ${node.className || ''} `).includes(` ${selector.slice(1)} `);
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return String(node.tagName || '').toLowerCase() === selector.toLowerCase();
}

function makeElement(tagName) {
  const node = {
    tagName: String(tagName || 'div').toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    parentNode: null,
    style: { cssText: '' },
    attributes: {},
    disabled: false,
    _focusCount: 0,
    appendChild(child) {
      child.parentNode = node;
      node.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = node.children.indexOf(child);
      if (index >= 0) node.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    remove() {
      if (node.parentNode) node.parentNode.removeChild(node);
      node._removed = true;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
      if (name === 'id') node.id = String(value);
      if (name === 'tabindex') node.tabIndex = String(value);
    },
    getAttribute(name) { return node.attributes[name]; },
    focus() { node._focusCount += 1; },
    querySelector(selector) {
      const all = descendants(node);
      if (selector.includes(',')) {
        return all.find((item) => {
          const tag = String(item.tagName || '').toLowerCase();
          return ['input', 'select', 'textarea', 'button'].includes(tag) && !item.disabled;
        }) || null;
      }
      return all.find((item) => matches(item, selector)) || null;
    },
    querySelectorAll(selector) { return descendants(node).filter((item) => matches(item, selector)); },
  };
  return node;
}

function makeDocument() {
  const doc = {
    body: makeElement('body'),
    listeners: [],
    removedListeners: [],
    createElement: (tag) => makeElement(tag),
    addEventListener(type, fn, capture) { doc.listeners.push({ type, fn, capture }); },
    removeEventListener(type, fn, capture) {
      doc.removedListeners.push({ type, fn, capture });
      const index = doc.listeners.findIndex((item) => item.type === type && item.fn === fn && item.capture === capture);
      if (index >= 0) doc.listeners.splice(index, 1);
    },
    dispatch(type, event) {
      for (const listener of doc.listeners.filter((item) => item.type === type)) listener.fn(event);
    },
  };
  return doc;
}

function loadClass() {
  const source = fs.readFileSync(SOURCE, 'utf8');
  return new Function(`${source}; return SauceModal;`)();
}

function buttons(handle) {
  return handle.footer.children.filter((item) => item.tagName === 'BUTTON');
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  const SauceModalClass = loadClass();

  await test('SM-1 CustomJS instance owns open and pure state helpers', () => {
    const modal = new SauceModalClass();
    assert(typeof modal.open === 'function', 'instance open missing');
    assert(typeof SauceModalClass.open === 'undefined', 'static-only API would bypass CustomJS instance contract');
    assert(modal._withinOpeningGesture(1000, 1399) === true, '399ms must remain guarded');
    assert(modal._withinOpeningGesture(1000, 1400) === false, '400ms boundary must dismiss');
    const normalized = modal._normalizeButtons(null, true, 'Create');
    assert(normalized.length === 2 && normalized[1].label === 'Create', 'pure default-button normalization');
  });

  await test('SM-2 cold-load missing document returns null', () => {
    assert(new SauceModalClass().open({ doc: null }) === null, 'missing document should no-op');
  });

  await test('SM-3 open emits class skeleton, callbacks, and default actions', () => {
    const doc = makeDocument();
    let bodyHost = null;
    const handle = new SauceModalClass().open({
      doc,
      title: 'New item',
      body(el) { bodyHost = el; el.appendChild(doc.createElement('input')); },
      onSubmit() {},
    });
    assert(doc.body.children.length === 1 && doc.body.children[0] === handle.backdrop, 'one appended backdrop');
    assert(handle.backdrop.className === 'sauce-modal-backdrop', 'backdrop class');
    assert(handle.modal.className === 'sauce-modal sauce-anim-pop', 'modal classes');
    assert(handle.title.className === 'sauce-modal-title' && handle.title.textContent === 'New item', 'title');
    assert(bodyHost === handle.body && handle.body.className === 'sauce-modal-body', 'body callback');
    assert(handle.footer.className === 'sauce-modal-footer sauce-action-row', 'footer classes');
    assert(buttons(handle).map((item) => item.textContent).join('|') === 'Cancel|Save', 'default Cancel + Save');
    assert(buttons(handle)[0].className === 'sauce-btn', 'quiet cancel class');
    assert(buttons(handle)[1].className === 'sauce-btn sauce-btn-accent', 'accent primary class');
    assert(handle.modal.getAttribute('role') === 'dialog' && handle.modal.getAttribute('aria-modal') === 'true', 'dialog semantics');
  });

  await test('SM-4 mechanism emits no inline presentation', () => {
    const doc = makeDocument();
    const handle = new SauceModalClass().open({ doc, title: 'Styled by CSS', onSubmit() {} });
    const styled = [handle.backdrop, ...descendants(handle.backdrop)].filter((item) => item.style.cssText !== '');
    assert(styled.length === 0, `inline presentation found on ${styled.length} nodes`);
    const source = fs.readFileSync(SOURCE, 'utf8');
    assert(!/\.style\s*\.|style\.cssText|setAttribute\(["']style/.test(source), 'source must not write style');
  });

  await test('SM-5 Cancel uses one idempotent teardown and exact listener removal', async () => {
    const doc = makeDocument();
    const closes = [];
    const handle = new SauceModalClass().open({ doc, onSubmit() {}, onClose(reason) { closes.push(reason); } });
    const added = doc.listeners.find((item) => item.type === 'keydown');
    await buttons(handle)[0].onclick({});
    const removed = doc.removedListeners.find((item) => item.type === 'keydown');
    assert(handle.isOpen === false && doc.body.children.length === 0, 'Cancel removes dialog');
    assert(added && removed && added.fn === removed.fn && added.capture === true && removed.capture === true, 'exact capture listener removed');
    assert(closes.join('|') === 'cancel', 'cancel reason');
    assert(handle.close('again') === false && closes.length === 1, 'close is idempotent');
  });

  await test('SM-6 Escape prevents default and tears down', () => {
    const doc = makeDocument();
    let prevented = 0;
    const handle = new SauceModalClass().open({ doc });
    doc.dispatch('keydown', { key: 'Escape', preventDefault() { prevented += 1; } });
    assert(prevented === 1 && !handle.isOpen && doc.listeners.length === 0, 'Escape teardown');
  });

  await test('SM-7 backdrop ghost-click guard is exact and target-bound', () => {
    const doc = makeDocument();
    let now = 1000;
    const handle = new SauceModalClass().open({ doc, now: () => now });
    now = 1399;
    handle.backdrop.onclick({ target: handle.backdrop });
    assert(handle.isOpen, '399ms ghost click must be ignored');
    now = 2000;
    handle.backdrop.onclick({ target: handle.modal });
    assert(handle.isOpen, 'modal child click must not dismiss');
    now = 1400;
    handle.backdrop.onclick({ target: handle.backdrop });
    assert(!handle.isOpen, '400ms deliberate backdrop click must dismiss');
  });

  await test('SM-8 Enter submits once and closes after async completion', async () => {
    const doc = makeDocument();
    let submits = 0;
    let prevented = 0;
    const handle = new SauceModalClass().open({ doc, onSubmit(api) { submits += 1; assert(api === handle, 'handle passed'); } });
    doc.dispatch('keydown', { key: 'Enter', target: makeElement('input'), preventDefault() { prevented += 1; } });
    await flush();
    assert(submits === 1 && prevented === 1 && !handle.isOpen, 'Enter submit lifecycle');
  });

  await test('SM-9 multiline, actionable, and modified Enter never submit', async () => {
    const doc = makeDocument();
    let submits = 0;
    const handle = new SauceModalClass().open({ doc, onSubmit() { submits += 1; } });
    doc.dispatch('keydown', { key: 'Enter', target: makeElement('textarea') });
    doc.dispatch('keydown', { key: 'Enter', target: { isContentEditable: true } });
    doc.dispatch('keydown', { key: 'Enter', target: makeElement('button') });
    doc.dispatch('keydown', { key: 'Enter', target: makeElement('select') });
    doc.dispatch('keydown', { key: 'Enter', target: makeElement('input'), shiftKey: true });
    await flush();
    assert(submits === 0 && handle.isOpen, 'multiline/modified Enter ignored');
  });

  await test('SM-10 false submit keeps dialog open and concurrent submit is suppressed', async () => {
    const doc = makeDocument();
    let resolveSubmit;
    let submits = 0;
    const pending = new Promise((resolve) => { resolveSubmit = resolve; });
    const handle = new SauceModalClass().open({ doc, onSubmit() { submits += 1; return pending; } });
    const first = handle.submit();
    const second = await handle.submit();
    assert(second === false && submits === 1, 'concurrent submit suppressed');
    resolveSubmit(false);
    assert(await first === false && handle.isOpen, 'false result keeps open');
    handle.close();
  });

  await test('SM-11 custom buttons preserve tones, callbacks, and close:false', async () => {
    const doc = makeDocument();
    let actions = 0;
    const handle = new SauceModalClass().open({
      doc,
      buttons: [
        { label: 'Keep open', tone: 'danger', close: false, onClick() { actions += 1; } },
        { label: 'Done', tone: 'accent', onClick() { actions += 10; } },
      ],
    });
    const list = buttons(handle);
    assert(list[0].className === 'sauce-btn sauce-btn-danger', 'danger class');
    assert(list[1].className === 'sauce-btn sauce-btn-accent', 'accent class');
    await list[0].onclick({});
    assert(actions === 1 && handle.isOpen, 'close:false honored');
    await list[1].onclick({});
    assert(actions === 11 && !handle.isOpen, 'default custom action closes');
  });

  await test('SM-12 footer callback receives handle and suppresses generated buttons', () => {
    const doc = makeDocument();
    let seen = null;
    const handle = new SauceModalClass().open({
      doc,
      onSubmit() {},
      footer(el, api) { seen = api; const custom = doc.createElement('span'); custom.textContent = 'custom'; el.appendChild(custom); },
    });
    assert(seen === handle && buttons(handle).length === 0 && handle.footer.children[0].textContent === 'custom', 'custom footer');
    handle.close();
  });

  await test('SM-13 autofocus is explicit and supports true, selector, and element', () => {
    const docA = makeDocument();
    let omittedInput;
    const omitted = new SauceModalClass().open({ doc: docA, body(el) { omittedInput = docA.createElement('input'); el.appendChild(omittedInput); }, defer: (fn) => fn() });
    assert(omittedInput._focusCount === 0, 'omitted autofocus preserves focus');
    omitted.close();

    const docB = makeDocument();
    let first;
    const automatic = new SauceModalClass().open({ doc: docB, autofocus: true, defer: (fn) => fn(), body(el) { first = docB.createElement('input'); el.appendChild(first); } });
    assert(first._focusCount === 1, 'true focuses first eligible field');
    automatic.close();

    const docC = makeDocument();
    let second;
    const selected = new SauceModalClass().open({ doc: docC, autofocus: '#second', defer: (fn) => fn(), body(el) { second = docC.createElement('input'); second.setAttribute('id', 'second'); el.appendChild(second); } });
    assert(second._focusCount === 1, 'selector autofocus');
    selected.close();

    const docD = makeDocument();
    const explicit = docD.createElement('input');
    const direct = new SauceModalClass().open({ doc: docD, autofocus: explicit, defer: (fn) => fn() });
    assert(explicit._focusCount === 1, 'element autofocus');
    direct.close();
  });

  await test('SM-14 opening a replacement closes prior DOM and listener', () => {
    const doc = makeDocument();
    const instance = new SauceModalClass();
    const first = instance.open({ doc });
    const second = instance.open({ doc });
    assert(!first.isOpen && second.isOpen && doc.body.children.length === 1 && doc.body.children[0] === second.backdrop, 'single live instance');
    assert(doc.listeners.length === 1, 'replacement leaves one listener');
    second.close();
  });

  await test('SM-15 registry, manifest, seed subscription, and preflight registration agree', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'mechanisms', 'modal', 'manifest.json'), 'utf8'));
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-vault', 'ranch', 'platform-subscription.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'package.json'), 'utf8'));
    assert(manifest.name === 'modal' && manifest.version === '0.1.0', 'component manifest');
    assert(manifest.customjs_classes.join('|') === 'SauceModal', 'CustomJS class registration');
    assert(manifest.depends_on.some((item) => item.name === 'styling' && item.range === '>=0.3.0'), 'styling dependency');
    assert(registry.mechanisms.some((item) => item.name === 'modal' && item.version === manifest.version && item.path === 'mechanisms/modal'), 'platform registry');
    assert(seed.mechanisms.some((item) => item.name === 'modal' && item.version === manifest.version), 'seed subscription');
    assert(pkg.scripts['test:modal'] === 'node platform/test/run-modal.js', 'focused script');
    assert(pkg.scripts['test:sauce-core-css'].includes('node platform/test/run-modal.js'), 'release preflight path invokes modal harness');
  });

  console.log(`\nSauceModal: ${passes} passed, ${fails} failed`);
  if (fails) process.exit(1);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
