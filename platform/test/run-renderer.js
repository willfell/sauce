#!/usr/bin/env node
/**
 * run-renderer.js — Headless renderer harness for SpaceNavButtons (CustomJS class).
 *
 * Runs the v2.0.0 renderer against a stubbed DOM + Obsidian API. Each test
 * temporarily writes a registry shape to disk (sandboxing the target vault's
 * registry), runs render(), inspects the resulting DOM tree + captured Notices
 * + captured vault writes, restores prior state.
 *
 * Cross-vault target:
 *   By default the harness operates on the workshop vault (one level up from
 *   platform/test/). Pass --vault <path> or the first positional arg to point
 *   at a different consumer vault. The renderer code itself always loads from
 *   the workshop's platform/mechanisms/nav-buttons/space-nav-buttons.js — only
 *   the registry path + filesystem reads are vault-scoped.
 *
 * Tests:
 *   T2.5  empty               empty install (no registry file) → renders nothing
 *   T2.6  malformed           malformed registry JSON → single error chip
 *   T2.7  unknown-action      synthetic registry, unknown action.type → click Notice
 *   T4.0  lazy-scaffold       createFromTemplate dispatch → folder/file create + open
 *   T4.4  barebones-one-button   barebones's real registry → exactly one Board button
 *   BC1   subtitle-object       subtitle returning {text, secondaryText} → two subtitle elements
 *   BC2   subtitle-null         subtitle returning null → no subtitle element (regression)
 *   BC3   subtitle-string       subtitle returning string → single subtitle (regression)
 *   BC4   badge-icon            badges[].icon populates inline SVG in chip
 *   BC5   badge-no-icon         badges[] without icon renders text-only chip (regression)
 *   BC6   synthetic-page-onclick synthetic page + custom onClick fires
 *   BC7   success-tone          badges[].tone === "success" renders green (#16a34a) chip
 *   DA1   active-file-with-date  dv.current() basename matches /(\d{4}-\d{2}-\d{2})/ → helper returns extracted ISO
 *   DA2   active-file-without-date  dv.current() basename has no date → helper falls back to today (window.moment stub)
 *   FF1   budget-nav-in-path         BudgetNavButtons on Budget atlas path → 2 buttons (active hidden)
 *   FF2   budget-nav-out-of-path     BudgetNavButtons on non-budget path → renders nothing
 *   FF3   hub-area-row-chevron       FinanceHubCards area-row buttons render with chevron SVG + "Open " label
 *   FF4   budget-categories-editor-add-button     BudgetCategoriesEditor renders Add button on Budget page
 *   FF5   paycheck-expenses-editor-add-button     PaycheckExpensesEditor renders Add button on Paycheck page
 *   FF6   invoice-time-log-editor-out-of-path     InvoiceTimeLogEditor on non-Time-Log path renders nothing
 *   FF7   invoice-controls-rate-and-toggle        InvoiceControls renders rate input + Mark Submitted button
 *   FF8   widget-embed-dedup                      InvoiceControls inside .markdown-embed renders nothing
 *   BB1   baseline-csstext         AccentButton.render returns HTMLButtonElement with accent baseline cssText
 *   BB2   flex-fill-css            opts.flex === true appends "flex: 1; min-width: 0" to base cssText
 *   BB3   onclick-wires            opts.onClick wires through (synthetic click triggers handler)
 *   BB4   disabled-hover-noop      opts.disabled === true initial; hover handlers no-op while btn.disabled
 *   BB5   icon-before-label        opts.icon HTML inlined verbatim before <span>${label}</span>
 *   BB6   hover-swap               hover-enter swaps to filled accent; hover-leave restores
 *
 * Usage:
 *   node platform/test/run-renderer.js [--vault <path>] [test-selector]
 *   test-selector:
 *     all (default), empty, malformed, unknown-action, lazy-scaffold, barebones-one-button, beacon-cards, date-aware, finance, accent-button
 *   exit 0 on all selected pass; 1 otherwise
 */

const fs = require('fs');
const path = require('path');

// ── Arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { vault: null, selector: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault') {
      out.vault = argv[++i];
    } else if (a.startsWith('--')) {
      console.error(`run-renderer: unknown flag ${a}`);
      process.exit(2);
    } else if (!out.vault && (a.includes('/') || a.includes('\\') || a === '.' || a === '..')) {
      // First positional that looks like a path → vault
      out.vault = a;
    } else {
      out.selector = a;
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));

// Workshop is the canonical source of the renderer file regardless of target vault.
const WORKSHOP = path.resolve(__dirname, '..', '..');
const RENDERER_FILE = path.join(WORKSHOP, 'platform', 'mechanisms', 'nav-buttons', 'space-nav-buttons.js');

// Target vault for registry + adapter reads/writes.
const VAULT = ARGS.vault ? path.resolve(ARGS.vault) : WORKSHOP;
const REGISTRY_REL = 'ranch/nav-buttons-registry.json';
const REGISTRY_ABS = path.join(VAULT, REGISTRY_REL);
const KANBAN_TARGET_REL = 'boards/To-Do-Board.md';

// Cache the renderer source at module load — identical bytes per test run.
const RENDERER_SRC = fs.readFileSync(RENDERER_FILE, 'utf8');

const BEACON_CARDS_FILE = path.join(WORKSHOP, 'platform', 'mechanisms', 'cards', 'beacon-cards.js');
const BEACON_CARDS_SRC = fs.readFileSync(BEACON_CARDS_FILE, 'utf8');

const ACCENT_BUTTON_FILE = path.join(WORKSHOP, 'platform', 'mechanisms', 'accent-button', 'accent-button.js');
const ACCENT_BUTTON_SRC = fs.existsSync(ACCENT_BUTTON_FILE) ? fs.readFileSync(ACCENT_BUTTON_FILE, 'utf8') : '';

// ── DOM stub ─────────────────────────────────────────────────────────────
function makeEl(tag, opts) {
  const el = {
    tag,
    cls: opts && opts.cls,
    text: '',
    children: [],
    style: { cssText: '' },
    innerHTML: '',
    onclick: null,
    onmouseenter: null,
    onmouseleave: null,
    parent: null,
    addEventListener: function () {},
    removeEventListener: function () {},
  };
  el.createEl = function (t, o) {
    const c = makeEl(t, o);
    c.parent = el;
    el.children.push(c);
    return c;
  };
  el.querySelector = function (sel) {
    if (typeof sel !== 'string' || sel[0] !== '.') return null;
    const cls = sel.slice(1);
    const walk = (n) => {
      if (n.cls === cls) return n;
      for (const c of n.children) {
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(el);
  };
  el.remove = function () {
    if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
  };
  return el;
}

function makeDv() {
  const root = makeEl('div', { cls: '__dv_root' });
  return {
    container: root,
    el(tag, content, opts) {
      const e = makeEl(tag, opts);
      e.text = content || '';
      e.parent = root;
      root.children.push(e);
      return e;
    },
  };
}

function makeDvWithCurrent(currentReturn) {
  const dv = makeDv();
  dv.current = () => currentReturn;
  return dv;
}

// ── Notice capture ───────────────────────────────────────────────────────
let captured_notices = [];
class FakeNotice {
  constructor(msg, dur) {
    captured_notices.push({ msg, dur });
    console.log(`  [Notice] ${msg}`);
  }
}

// ── App stub ─────────────────────────────────────────────────────────────
//
// makeApp(opts): writes are captured by default — capture is the safe default
// so a forgotten flag can never corrupt the target vault. Opt out with
// opts.allowDiskWrites if a test genuinely needs real disk writes (none
// currently do). Reads pass through to disk by default; tests may monkey-patch
// app.vault.adapter.read after construction to serve synthetic content (see
// testLazyScaffold). getAbstractFileByPath consults real disk by default;
// pass opts.fileExistsHook to override per-path.
function makeApp(opts) {
  opts = opts || {};
  const captureWrites = opts.allowDiskWrites !== true;
  const captured_open = [];
  const captured_writes = [];
  return {
    isMobile: false,
    vault: {
      adapter: {
        async read(p) {
          const abs = path.join(VAULT, p);
          return await fs.promises.readFile(abs, 'utf8');
        },
        async write(p, body) {
          if (captureWrites) {
            captured_writes.push({ method: 'adapter.write', path: p, body, bodyLength: body.length });
            return;
          }
          const abs = path.join(VAULT, p);
          await fs.promises.mkdir(path.dirname(abs), { recursive: true });
          await fs.promises.writeFile(abs, body, 'utf8');
        },
      },
      getAbstractFileByPath(p) {
        if (typeof opts.fileExistsHook === 'function') {
          const r = opts.fileExistsHook(p);
          if (r !== undefined) return r;
        }
        const abs = path.join(VAULT, p);
        try {
          fs.accessSync(abs);
          return { path: p };
        } catch {
          return null;
        }
      },
      async create(p, body) {
        if (captureWrites) {
          captured_writes.push({ method: 'create', path: p, body, bodyLength: body.length });
          return;
        }
        const abs = path.join(VAULT, p);
        await fs.promises.mkdir(path.dirname(abs), { recursive: true });
        await fs.promises.writeFile(abs, body, 'utf8');
      },
      async createFolder(p) {
        if (captureWrites) {
          captured_writes.push({ method: 'createFolder', path: p });
          return;
        }
        const abs = path.join(VAULT, p);
        await fs.promises.mkdir(abs, { recursive: true });
      },
    },
    workspace: {
      openLinkText(p, _) {
        captured_open.push(p);
      },
    },
    __captured_open: captured_open,
    __captured_writes: captured_writes,
  };
}

// ── Load renderer class ──────────────────────────────────────────────────
function loadRendererClass(app, Notice) {
  const fn = new Function('app', 'Notice', `${RENDERER_SRC}\nreturn SpaceNavButtons;`);
  return fn(app, Notice);
}

function loadBeaconCardsClass(app) {
  const fn = new Function('app', `${BEACON_CARDS_SRC}\nreturn BeaconCards;`);
  return fn(app);
}

function loadAccentButtonClass(app) {
  if (!ACCENT_BUTTON_SRC) return null;
  const fn = new Function('app', `${ACCENT_BUTTON_SRC}\nreturn typeof AccentButton !== 'undefined' ? AccentButton : null;`);
  return fn(app);
}

function makeFinanceCustomJsStub() {
  const noop = { render: async () => {} };
  return {
    NewBudgetButton: noop,
    NewPaycheckButton: noop,
    NewInvoiceButton: noop,
    BudgetsCards: noop,
    PaychecksCards: noop,
    InvoicesCards: noop,
    FinanceFrontmatter: { update: async () => {}, read: () => null, isTruthy: (v) => v === true || (typeof v === 'string' && v.toLowerCase() === 'true') },
    AccentButton: {
      render: (parent, opts) => {
        const btn = parent.createEl('button');
        btn.innerHTML = (opts && opts.icon ? opts.icon : '') + `<span>${opts && opts.label != null ? opts.label : ''}</span>`;
        if (opts && typeof opts.onClick === 'function') btn.onclick = opts.onClick;
        if (opts && opts.disabled === true) btn.disabled = true;
        return btn;
      },
    },
  };
}

function loadFinanceClass(className, app) {
  const filename = className === 'BudgetNavButtons' ? 'budget-nav-buttons.js'
    : className === 'PaycheckNavButtons' ? 'paycheck-nav-buttons.js'
    : className === 'FinanceHubCards' ? 'finance-hub-cards.js'
    : className === 'BudgetCategoriesEditor' ? 'budget-categories-editor.js'
    : className === 'PaycheckExpensesEditor' ? 'paycheck-expenses-editor.js'
    : className === 'InvoiceTimeLogEditor' ? 'invoice-time-log-editor.js'
    : className === 'InvoiceControls' ? 'invoice-controls.js'
    : null;
  if (!filename) throw new Error(`loadFinanceClass: unknown class ${className}`);
  const filepath = path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', filename);
  const src = fs.readFileSync(filepath, 'utf8');
  const fn = new Function('app', 'customJS', 'Notice', `${src}\nreturn ${className};`);
  return fn(app, makeFinanceCustomJsStub(), FakeNotice);
}

// ── Tree helpers ─────────────────────────────────────────────────────────
function findClass(root, cls) {
  if (root.cls === cls) return root;
  for (const c of root.children) {
    const f = findClass(c, cls);
    if (f) return f;
  }
  return null;
}
function countButtons(root) {
  let n = root.tag === 'button' ? 1 : 0;
  for (const c of root.children) n += countButtons(c);
  return n;
}
function findButtonByLabel(root, label) {
  if (root.tag === 'button' && root.innerHTML.includes(`<span>${label}</span>`)) return root;
  for (const c of root.children) {
    const f = findButtonByLabel(c, label);
    if (f) return f;
  }
  return null;
}
function collectButtons(root, out) {
  out = out || [];
  if (root.tag === 'button') out.push(root);
  for (const c of root.children) collectButtons(c, out);
  return out;
}
function collectAll(root, predicate, out) {
  out = out || [];
  if (predicate(root)) out.push(root);
  for (const c of root.children) collectAll(c, predicate, out);
  return out;
}

// ── Registry sandbox ─────────────────────────────────────────────────────
async function withTempRegistry(content_or_null, fn) {
  let saved_existed = false;
  let saved_body = '';
  if (fs.existsSync(REGISTRY_ABS)) {
    saved_existed = true;
    saved_body = fs.readFileSync(REGISTRY_ABS, 'utf8');
  }
  try {
    if (content_or_null === null) {
      if (saved_existed) fs.unlinkSync(REGISTRY_ABS);
    } else {
      fs.mkdirSync(path.dirname(REGISTRY_ABS), { recursive: true });
      fs.writeFileSync(REGISTRY_ABS, content_or_null, 'utf8');
    }
    return await fn();
  } finally {
    if (!saved_existed) {
      if (fs.existsSync(REGISTRY_ABS)) fs.unlinkSync(REGISTRY_ABS);
    } else {
      fs.writeFileSync(REGISTRY_ABS, saved_body, 'utf8');
    }
  }
}

function reset() {
  captured_notices = [];
}

// Install a minimal global.window.moment stub for tests that exercise
// _resolveActionDate's today-fallback path. Returns a restore function.
// The stub supports the EXACT subset the helper uses:
//   - moment(s, "YYYY-MM-DD", true).isValid()
//   - moment().format("YYYY-MM-DD")
function withWindowMomentStub(todayIso) {
  const prior_window = global.window;
  global.window = {
    moment: function (s, fmt, strict) {
      if (s === undefined) {
        return { format: () => todayIso };
      }
      // Strict-parse semantics: validate components match YYYY-MM-DD.
      const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const valid = !!m && (() => {
        const y = +m[1], mo = +m[2], d = +m[3];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
        const probe = new Date(Date.UTC(y, mo - 1, d));
        return probe.getUTCFullYear() === y && (probe.getUTCMonth() + 1) === mo && probe.getUTCDate() === d;
      })();
      return { isValid: () => valid };
    },
  };
  return () => { global.window = prior_window; };
}

// ── Tests ────────────────────────────────────────────────────────────────
async function testEmpty() {
  console.log('\n=== T2.5 — empty install (no registry file) ===');
  reset();
  return await withTempRegistry(null, async () => {
    const app = makeApp();
    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDv();
    const sn = new Cls();
    await sn.render(dv);
    const buttons = countButtons(dv.container);
    const errChip = findClass(dv.container, 'nav-error');
    const navContainer = findClass(dv.container, 'vault-nav');
    console.log(`  buttons rendered: ${buttons}`);
    console.log(`  error chip: ${errChip ? `"${errChip.text}"` : 'none'}`);
    console.log(`  vault-nav container: ${navContainer ? 'present' : 'absent'}`);
    console.log(`  notices captured: ${captured_notices.length}`);
    const pass =
      buttons === 0 && !errChip && !navContainer && captured_notices.length === 0;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

async function testMalformed() {
  console.log('\n=== T2.6 — malformed registry → error chip ===');
  reset();
  const broken = '{ "schema_version": 1, "contributions": [BAD';
  return await withTempRegistry(broken, async () => {
    const app = makeApp();
    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDv();
    const sn = new Cls();
    await sn.render(dv);
    const buttons = countButtons(dv.container);
    const errChip = findClass(dv.container, 'nav-error');
    console.log(`  buttons rendered: ${buttons}`);
    console.log(`  error chip text: ${errChip ? `"${errChip.text}"` : 'none'}`);
    console.log(`  notices captured: ${captured_notices.length}`);
    const pass =
      buttons === 0 &&
      errChip &&
      errChip.text.toLowerCase().includes('parse error');
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

async function testUnknownAction() {
  console.log('\n=== T2.7 — unknown action.type → button renders, click fires Notice ===');
  reset();
  const synthetic = JSON.stringify({
    schema_version: 1,
    contributions: {
      test: [
        {
          id: 'fake',
          label: 'Fake',
          icon: 'board',
          order: 100,
          action: { type: 'fake' },
        },
      ],
    },
  });
  return await withTempRegistry(synthetic, async () => {
    const app = makeApp();
    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDv();
    const sn = new Cls();
    await sn.render(dv);
    const buttons = countButtons(dv.container);
    const fakeBtn = findButtonByLabel(dv.container, 'Fake');
    console.log(`  buttons rendered: ${buttons}`);
    console.log(`  Fake button: ${fakeBtn ? 'found' : 'NOT FOUND'}`);
    if (!fakeBtn) {
      console.log('  FAIL — button not rendered');
      return false;
    }
    // Trigger the click handler
    await fakeBtn.onclick();
    console.log(`  notices after click: ${captured_notices.length}`);
    if (captured_notices.length > 0) {
      console.log(`  notice text: "${captured_notices[0].msg}"`);
    }
    const noticeOk =
      captured_notices.length === 1 &&
      captured_notices[0].msg.includes('unknown action.type') &&
      captured_notices[0].msg.includes('"fake"') &&
      captured_notices[0].msg.includes('from test');
    const pass = buttons === 1 && noticeOk;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

// T4.0 — lazy-scaffold dispatch via createFromTemplate.
//
// Synthetic registry with a Board entry whose template_source points at the
// workshop-source kanban-board.md (always present). Captures vault writes
// instead of touching disk. Stubs getAbstractFileByPath to make the target
// appear non-existent regardless of whether it happens to exist on disk.
async function testLazyScaffold() {
  console.log('\n=== T4.0 — lazy-scaffold createFromTemplate dispatch ===');
  reset();

  // Read the template from workshop source — guaranteed present regardless of
  // VAULT target. Override adapter.read to serve it when the renderer asks
  // for the registry's declared template_source path; this decouples the test
  // from VAULT's filesystem state (no need to materialize the template inside
  // VAULT just to exercise dispatch).
  const templateBody = '# Synthetic Kanban\n\n```kanban\n## Backlog\n\n## In Progress\n\n## Done\n```\n';
  const templateBodyLen = templateBody.length;
  console.log(`  template source: synthetic://kanban-board (${templateBodyLen}B)`);

  const synthetic = JSON.stringify({
    schema_version: 1,
    contributions: {
      project: [
        {
          id: 'board',
          label: 'Board',
          icon: 'board',
          order: 100,
          action: {
            type: 'createFromTemplate',
            target: KANBAN_TARGET_REL,
            template_source: 'synthetic://kanban-board',
          },
        },
      ],
    },
  });

  return await withTempRegistry(synthetic, async () => {
    const app = makeApp({
      fileExistsHook(p) {
        if (p === KANBAN_TARGET_REL) return null;
        if (p === 'boards') return null;
        return undefined; // fall through to real disk check
      },
    });
    // Override adapter.read to serve the workshop template body regardless
    // of VAULT, so this test works against any vault target.
    const origRead = app.vault.adapter.read;
    app.vault.adapter.read = async function (p) {
      if (p === 'synthetic://kanban-board') return templateBody;
      return origRead.call(this, p);
    };

    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDv();
    const sn = new Cls();
    await sn.render(dv);

    const buttons = countButtons(dv.container);
    const boardBtn = findButtonByLabel(dv.container, 'Board');
    console.log(`  buttons rendered: ${buttons}`);
    console.log(`  Board button: ${boardBtn ? 'found' : 'NOT FOUND'}`);
    if (!boardBtn) {
      console.log('  FAIL — Board button not rendered');
      return false;
    }

    try {
      await boardBtn.onclick();
    } finally {
      app.vault.adapter.read = origRead;
    }

    const writes = app.__captured_writes;
    const opens = app.__captured_open;
    console.log(`  captured writes: ${writes.length}`);
    for (const w of writes) {
      const tail = w.bodyLength !== undefined ? ` body=${w.bodyLength}B` : '';
      console.log(`    ${w.method} ${w.path}${tail}`);
    }
    console.log(`  captured opens: ${opens.length}`);
    for (const o of opens) console.log(`    openLinkText ${o}`);

    const folderCalls = writes.filter((w) => w.method === 'createFolder' && w.path === 'boards');
    const createCalls = writes.filter((w) => w.method === 'create' && w.path === KANBAN_TARGET_REL);
    const opensCalls = opens.filter((o) => o === KANBAN_TARGET_REL);

    const pass =
      buttons === 1 &&
      folderCalls.length === 1 &&
      createCalls.length === 1 &&
      createCalls[0].bodyLength > 0 &&
      createCalls[0].bodyLength === templateBodyLen &&
      opensCalls.length === 1 &&
      captured_notices.length === 0;

    console.log(`  folder createFolder('boards'): ${folderCalls.length}`);
    console.log(`  create('${KANBAN_TARGET_REL}') body=${createCalls[0] && createCalls[0].bodyLength}B (template ${templateBodyLen}B)`);
    console.log(`  openLinkText('${KANBAN_TARGET_REL}'): ${opensCalls.length}`);
    console.log(`  notices: ${captured_notices.length}`);
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

// T4.4 — barebones registry should produce exactly one Board button.
//
// Reads the target vault's registry as-is (no sandbox). Asserts: vault-nav
// container present, exactly one button, label "Board", icon HTML matches the
// "board" lucide icon.
async function testBarebonesOneButton() {
  console.log('\n=== T4.4 — barebones registry → exactly one Board button ===');
  reset();
  if (!fs.existsSync(REGISTRY_ABS)) {
    console.log(`  registry not present at ${REGISTRY_ABS}`);
    console.log('  FAIL — barebones registry expected');
    return false;
  }
  // Renders against the registry currently on disk — no sandbox write.
  const app = makeApp();
  const Cls = loadRendererClass(app, FakeNotice);
  const dv = makeDv();
  const sn = new Cls();
  await sn.render(dv);

  const all = collectButtons(dv.container);
  const navContainer = findClass(dv.container, 'vault-nav');
  console.log(`  vault-nav container: ${navContainer ? 'present' : 'absent'}`);
  console.log(`  buttons rendered: ${all.length}`);
  for (const b of all) {
    const m = b.innerHTML.match(/<span>([^<]+)<\/span>/);
    console.log(`    button label="${m && m[1]}" iconHasBoardSvg=${b.innerHTML.includes('rect width="18" height="18"')}`);
  }
  if (all.length !== 1) {
    console.log('  FAIL — expected exactly 1 button');
    return false;
  }
  const labelOk = all[0].innerHTML.includes('<span>Board</span>');
  // Board icon: lucide "board" svg has rect 18x18 + the three vertical paths
  const iconOk = all[0].innerHTML.includes('M8 7v7') && all[0].innerHTML.includes('M16 7v9');
  console.log(`  label is Board: ${labelOk}`);
  console.log(`  icon is board: ${iconOk}`);
  const pass = navContainer && all.length === 1 && labelOk && iconOk && captured_notices.length === 0;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── BeaconCards renderer cases (v0.12.0 cards@0.2.0 API extension) ───────

async function testBC1SubtitleObject() {
  console.log('\n=== BC1 — subtitle returning {text, secondaryText} renders TWO subtitle elements ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    title: (p) => p.file.name,
    subtitle: () => ({ text: 'Primary line', secondaryText: 'Secondary italic line' }),
    layout: 'stacked',
  });
  const primary = collectAll(dv.container, (el) => el.text === 'Primary line' || el.innerHTML === 'Primary line');
  // The renderer assigns el.textContent — captured as a property on the stub.
  const primaryHits = collectAll(dv.container, (el) => el.textContent === 'Primary line');
  const secondaryHits = collectAll(dv.container, (el) =>
    el.textContent === 'Secondary italic line'
    && typeof el.style?.cssText === 'string'
    && el.style.cssText.includes('italic')
    && el.style.cssText.includes('0.78em'));
  console.log(`  primary "Primary line" elements: ${primaryHits.length}`);
  console.log(`  secondary italic-0.78em "Secondary italic line" elements: ${secondaryHits.length}`);
  const pass = primaryHits.length >= 1 && secondaryHits.length >= 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC2SubtitleNull() {
  console.log('\n=== BC2 — subtitle returning null renders no subtitle element (regression) ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    title: (p) => p.file.name,
    subtitle: () => null,
    layout: 'stacked',
  });
  const subtitleLike = collectAll(dv.container, (el) =>
    typeof el.style?.cssText === 'string'
    && el.style.cssText.includes('font-size: 0.8em')
    && el.style.cssText.includes('color: var(--text-muted)')
    && (!el.textContent || el.textContent === ''));
  console.log(`  subtitle-shaped empty elements: ${subtitleLike.length}`);
  const pass = subtitleLike.length === 0;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC3SubtitleString() {
  console.log('\n=== BC3 — subtitle returning string renders a single muted line (regression) ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    title: (p) => p.file.name,
    subtitle: () => 'Single subtitle string',
    layout: 'stacked',
  });
  const matchHits = collectAll(dv.container, (el) => el.textContent === 'Single subtitle string');
  const secondaryHits = collectAll(dv.container, (el) =>
    typeof el.style?.cssText === 'string'
    && el.style.cssText.includes('italic')
    && el.style.cssText.includes('0.78em'));
  console.log(`  "Single subtitle string" elements: ${matchHits.length}`);
  console.log(`  italic-0.78em (secondary-line) elements: ${secondaryHits.length}`);
  const pass = matchHits.length === 1 && secondaryHits.length === 0;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC4BadgeIcon() {
  console.log('\n=== BC4 — badges[] entry with icon renders inline-SVG inside chip ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  const testIcon = '<svg data-test="badge-icon" width="12" height="12"></svg>';
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    badges: () => [{ label: 'Test', tone: 'accent', icon: testIcon }],
  });
  const chipsWithIcon = collectAll(dv.container, (el) =>
    el.tag === 'span'
    && (
      (typeof el.innerHTML === 'string' && el.innerHTML.includes('data-test="badge-icon"'))
      || el.children.some((c) => typeof c.innerHTML === 'string' && c.innerHTML.includes('data-test="badge-icon"'))
    ));
  console.log(`  span chips containing data-test="badge-icon": ${chipsWithIcon.length}`);
  let labelOk = false;
  if (chipsWithIcon.length > 0) {
    const chip = chipsWithIcon[0];
    const chipText = chip.textContent || '';
    const descendantTextHit = collectAll(chip, (el) => (el.textContent || '').includes('Test')).length > 0;
    labelOk = chipText.includes('Test') || descendantTextHit;
    console.log(`  chip text includes "Test": ${chipText.includes('Test')}; descendant text hit: ${descendantTextHit}`);
  }
  const pass = chipsWithIcon.length >= 1 && labelOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC5BadgeNoIcon() {
  console.log('\n=== BC5 — badges[] entry without icon renders text-only chip (regression) ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    badges: () => [{ label: 'PlainBadge', tone: 'muted' }],
  });
  const matchingChips = collectAll(dv.container, (el) =>
    el.tag === 'span' && el.textContent === 'PlainBadge');
  console.log(`  span chips with textContent === "PlainBadge": ${matchingChips.length}`);
  let svgFree = false;
  if (matchingChips.length > 0) {
    const chip = matchingChips[0];
    const innerHtml = typeof chip.innerHTML === 'string' ? chip.innerHTML : '';
    svgFree = !innerHtml.includes('<svg');
    console.log(`  chip innerHTML excludes <svg: ${svgFree}`);
  }
  const pass = matchingChips.length === 1 && svgFree;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC6SyntheticPageOnClick() {
  console.log('\n=== BC6 — synthetic-page object + custom onClick fires ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  let capturedClickedPage = null;
  await cards.render(dv, {
    pages: [{ file: { name: 'Synthetic', path: 'synth.md' }, _custom: 'marker' }],
    title: (p) => p.file.name,
    onClick: (p, _ev) => { capturedClickedPage = p; },
  });
  const cardEls = collectAll(dv.container, (el) =>
    typeof el.style?.cssText === 'string' && el.style.cssText.includes('cursor: pointer'));
  console.log(`  clickable cards (cursor: pointer): ${cardEls.length}`);
  if (cardEls.length === 0) {
    console.log('  FAIL — no clickable card');
    return false;
  }
  const cardEl = cardEls[0];
  if (typeof cardEl.onclick === 'function') {
    cardEl.onclick({});
  } else {
    console.log('  FAIL — clickable card has no onclick handler');
    return false;
  }
  console.log(`  capturedClickedPage._custom: ${capturedClickedPage && capturedClickedPage._custom}`);
  const pass = !!capturedClickedPage && capturedClickedPage._custom === 'marker';
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBC7SuccessTone() {
  console.log('\n=== BC7 — badges[].tone === "success" renders green (#16a34a) chip ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  await cards.render(dv, {
    pages: [{ file: { name: 'Done item', path: 'x.md' } }],
    badges: () => [{ label: 'Done', tone: 'success' }],
  });
  const matchingChips = collectAll(dv.container, (el) =>
    el.tag === 'span' && el.textContent === 'Done');
  console.log(`  span chips with textContent === "Done": ${matchingChips.length}`);
  let bgOk = false;
  if (matchingChips.length > 0) {
    const chip = matchingChips[0];
    const css = (chip.style && chip.style.cssText) || '';
    bgOk = css.includes('#16a34a');
    console.log(`  chip cssText includes "#16a34a": ${bgOk}; cssText sample: ${css.slice(0, 200)}`);
  }
  const pass = matchingChips.length === 1 && bgOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── AccentButton mechanism (v0.18.0; renamed from BeaconButton in v0.24.0) ─
async function testBB1RenderReturnsButtonWithBaselineCssText() {
  console.log('\n=== BB1 — render returns HTMLButtonElement with accent baseline cssText ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {} });
  const css = (btn && btn.style && btn.style.cssText) || '';
  const pass = btn && btn.tag === 'button'
    && css.includes('border: 1px solid var(--interactive-accent)')
    && css.includes('background: var(--background-primary)')
    && css.includes('color: var(--interactive-accent)')
    && !css.includes('flex: 1');
  console.log(`  cssText sample: ${css.slice(0, 120)}...`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB2FlexAppendsFillCss() {
  console.log('\n=== BB2 — flex:true appends "flex: 1; min-width: 0" ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {}, flex: true });
  const css = (btn && btn.style && btn.style.cssText) || '';
  const pass = css.includes('flex: 1') && css.includes('min-width: 0');
  console.log(`  cssText includes flex: 1 + min-width: 0 → ${pass}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB3OnClickWires() {
  console.log('\n=== BB3 — onClick option wires through ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  let fired = 0;
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => { fired++; } });
  if (btn && typeof btn.onclick === 'function') btn.onclick();
  const pass = fired === 1;
  console.log(`  fired: ${fired}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB4DisabledHoverNoOp() {
  console.log('\n=== BB4 — disabled:true initial; hover handlers no-op while disabled ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {}, disabled: true });
  if (btn && typeof btn.onmouseenter === 'function') btn.onmouseenter();
  const css = (btn && btn.style && btn.style.cssText) || '';
  const stillAccentText = css.includes('color: var(--interactive-accent)');
  const stillPrimaryBg = css.includes('background: var(--background-primary)');
  const pass = btn && btn.disabled === true && stillAccentText && stillPrimaryBg;
  console.log(`  btn.disabled: ${btn && btn.disabled}; afterEnter accent text: ${stillAccentText}; primary bg: ${stillPrimaryBg}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB5IconHtmlInlinedBeforeLabel() {
  console.log('\n=== BB5 — icon HTML inlined verbatim before <span>${label}</span> ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const iconHtml = '<svg data-test="icon"/>';
  const btn = new Cls().render(parent, { label: 'Save', icon: iconHtml, onClick: () => {} });
  const html = (btn && btn.innerHTML) || '';
  const idxIcon = html.indexOf('data-test="icon"');
  const idxLabel = html.indexOf('<span>Save</span>');
  const pass = idxIcon !== -1 && idxLabel !== -1 && idxIcon < idxLabel;
  console.log(`  innerHTML: ${html}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB6HoverEnterLeaveSwapsColors() {
  console.log('\n=== BB6 — hover-enter swaps to filled accent; hover-leave restores ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {} });
  if (btn && typeof btn.onmouseenter === 'function') btn.onmouseenter();
  const cssEnter = (btn && btn.style && btn.style.cssText) || '';
  const enteredFill = cssEnter.includes('background: var(--interactive-accent)')
    && cssEnter.includes('color: var(--text-on-accent)');
  if (btn && typeof btn.onmouseleave === 'function') btn.onmouseleave();
  const cssLeave = (btn && btn.style && btn.style.cssText) || '';
  const restored = cssLeave.includes('background: var(--background-primary)')
    && cssLeave.includes('color: var(--interactive-accent)');
  const pass = enteredFill && restored;
  console.log(`  enteredFill: ${enteredFill}; restored: ${restored}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testDA1ActiveFileWithDate() {
  console.log('\n=== DA1 — active file with date in basename → helper returns extracted ISO ===');
  reset();
  const restore = withWindowMomentStub('2099-01-01'); // unused; DA1 takes regex-match path
  try {
    const app = makeApp();
    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDvWithCurrent({ file: { name: 'Journal-2026-05-10', path: 'spice/journal/2026/05-May/Journal-2026-05-10.md' } });
    const sn = new Cls();
    const date = sn._resolveActionDate(dv);
    console.log(`  resolved date: ${date}`);
    const pass = date === '2026-05-10';
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  } finally {
    restore();
  }
}

async function testDA2ActiveFileWithoutDate() {
  console.log('\n=== DA2 — active file without date → helper falls back to today (stubbed) ===');
  reset();
  const restore = withWindowMomentStub('2026-05-04');
  try {
    const app = makeApp();
    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDvWithCurrent({ file: { name: 'SomeAtlas', path: 'spice/projects/SomeAtlas.md' } });
    const sn = new Cls();
    const date = sn._resolveActionDate(dv);
    console.log(`  resolved date: ${date}`);
    const pass = date === '2026-05-04';
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  } finally {
    restore();
  }
}

async function testFF1BudgetNavInPath() {
  console.log('\n=== FF1 — BudgetNavButtons in-path renders 2 buttons (active hidden) ===');
  const app = makeApp();
  const Cls = loadFinanceClass('BudgetNavButtons', app);
  const dv = makeDvWithCurrent({ file: { name: 'Budget-2026-05', path: 'spice/finance/budgets/2026-05/Budget-2026-05.md' } });
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'bnb-root');
  const buttonCount = root ? countButtons(root) : 0;
  console.log(`  bnb-root present: ${!!root} ; button count: ${buttonCount}`);
  const pass = !!root && buttonCount === 2;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF2BudgetNavOutOfPath() {
  console.log('\n=== FF2 — BudgetNavButtons out-of-path renders nothing ===');
  const app = makeApp();
  const Cls = loadFinanceClass('BudgetNavButtons', app);
  const dv = makeDvWithCurrent({ file: { name: 'SomeAtlas', path: 'spice/projects/SomeAtlas.md' } });
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'bnb-root');
  console.log(`  bnb-root present (should be false): ${!!root}`);
  const pass = !root;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

function makeDvWithCurrentAndFrontmatter(file, fm) {
  const dv = makeDvWithCurrent({ file, ...fm });
  return dv;
}

async function testFF4BudgetCategoriesAddButton() {
  console.log('\n=== FF4 — BudgetCategoriesEditor renders Add button on Budget page ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('BudgetCategoriesEditor', app);
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-05', path: 'spice/finance/budgets/2026-05/Budget-2026-05.md' },
    { categories: [] }
  );
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'bce-root');
  const buttons = root ? collectButtons(root) : [];
  const addBtn = buttons.find(b => typeof b.innerHTML === 'string' && b.innerHTML.includes('Add Category'));
  console.log(`  bce-root present: ${!!root} ; Add button found: ${!!addBtn}`);
  const pass = !!root && !!addBtn;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF5PaycheckExpensesAddButton() {
  console.log('\n=== FF5 — PaycheckExpensesEditor renders Add button on Paycheck page ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app);
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Paycheck-2026-05-15', path: 'spice/finance/paychecks/2026-05-15/Paycheck-2026-05-15.md' },
    { expenses: [] }
  );
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'pee-root');
  const buttons = root ? collectButtons(root) : [];
  const addBtn = buttons.find(b => typeof b.innerHTML === 'string' && b.innerHTML.includes('Add Expense'));
  console.log(`  pee-root present: ${!!root} ; Add button found: ${!!addBtn}`);
  const pass = !!root && !!addBtn;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF6InvoiceTimeLogOutOfPath() {
  console.log('\n=== FF6 — InvoiceTimeLogEditor on non-Time-Log path renders nothing ===');
  const app = makeApp();
  const Cls = loadFinanceClass('InvoiceTimeLogEditor', app);
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'SomeAtlas', path: 'spice/projects/SomeAtlas.md' },
    { entries: [] }
  );
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'itle-root');
  console.log(`  itle-root present (should be false): ${!!root}`);
  const pass = !root;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF7InvoiceControlsRateAndToggle() {
  console.log('\n=== FF7 — InvoiceControls renders rate input + Mark Submitted button ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('InvoiceControls', app);
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Invoice-2026-05', path: 'spice/finance/invoices/2026-05/Invoice-2026-05.md' },
    { rate: 75, submitted_date: '' }
  );
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'ic-root');
  const inputs = root ? collectAll(root, el => el.tag === 'input') : [];
  const buttons = root ? collectButtons(root) : [];
  const markBtn = buttons.find(b => (typeof b.textContent === 'string' && b.textContent.includes('Mark Submitted')) || (typeof b.innerHTML === 'string' && b.innerHTML.includes('Mark Submitted')));
  console.log(`  ic-root: ${!!root} ; rate input count: ${inputs.length} ; Mark Submitted button: ${!!markBtn}`);
  const pass = !!root && inputs.length >= 1 && !!markBtn;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF8WidgetEmbedDedup() {
  console.log('\n=== FF8 — InvoiceControls inside .markdown-embed renders nothing ===');
  const app = makeApp();
  const Cls = loadFinanceClass('InvoiceControls', app);
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Invoice-2026-05', path: 'spice/finance/invoices/2026-05/Invoice-2026-05.md' },
    { rate: 75, submitted_date: '' }
  );
  dv.container.closest = (sel) => sel === '.markdown-embed' ? { tag: 'div' } : null;
  const sn = new Cls();
  await sn.render(dv);
  const root = findClass(dv.container, 'ic-root');
  console.log(`  ic-root present (should be false): ${!!root}`);
  const pass = !root;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testFF3HubAreaRowIcons() {
  console.log('\n=== FF3 — FinanceHubCards area-row buttons have icon SVG + label (post-CF-1) ===');
  const app = makeApp();
  const Cls = loadFinanceClass('FinanceHubCards', app);
  const dv = makeDv();
  const sn = new Cls();
  await sn.render(dv);
  const allButtons = collectButtons(dv.container);
  const iconButtons = allButtons.filter(b => typeof b.innerHTML === 'string' && b.innerHTML.includes('<svg'));
  const labels = ['Budgets', 'Paychecks', 'Invoices'];
  const labelMatches = labels.filter(lbl => iconButtons.some(b => b.innerHTML.includes(`<span>${lbl}</span>`)));
  console.log(`  area-row buttons with SVG: ${iconButtons.length} ; matched labels: ${labelMatches.length}/3`);
  const pass = iconButtons.length === 3 && labelMatches.length === 3;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
  const which = ARGS.selector;
  console.log(`run-renderer: vault = ${VAULT}`);
  console.log(`run-renderer: renderer = ${RENDERER_FILE}`);
  console.log(`run-renderer: selector = ${which}`);
  const results = [];
  try {
    if (which === 'empty' || which === 'all') results.push(['T2.5 empty', await testEmpty()]);
    if (which === 'malformed' || which === 'all') results.push(['T2.6 malformed', await testMalformed()]);
    if (which === 'unknown-action' || which === 'all') results.push(['T2.7 unknown-action', await testUnknownAction()]);
    if (which === 'lazy-scaffold' || which === 'all') results.push(['T4.0 lazy-scaffold', await testLazyScaffold()]);
    if (which === 'beacon-cards' || which === 'all') {
      results.push(['BC1 subtitle-object', await testBC1SubtitleObject()]);
      results.push(['BC2 subtitle-null', await testBC2SubtitleNull()]);
      results.push(['BC3 subtitle-string', await testBC3SubtitleString()]);
      results.push(['BC4 badge-icon', await testBC4BadgeIcon()]);
      results.push(['BC5 badge-no-icon', await testBC5BadgeNoIcon()]);
      results.push(['BC6 synthetic-page-onclick', await testBC6SyntheticPageOnClick()]);
      results.push(['BC7 success-tone', await testBC7SuccessTone()]);
    }
    if (which === 'accent-button' || which === 'all') {
      results.push(['BB1 baseline-csstext', await testBB1RenderReturnsButtonWithBaselineCssText()]);
      results.push(['BB2 flex-fill-css', await testBB2FlexAppendsFillCss()]);
      results.push(['BB3 onclick-wires', await testBB3OnClickWires()]);
      results.push(['BB4 disabled-hover-noop', await testBB4DisabledHoverNoOp()]);
      results.push(['BB5 icon-before-label', await testBB5IconHtmlInlinedBeforeLabel()]);
      results.push(['BB6 hover-swap', await testBB6HoverEnterLeaveSwapsColors()]);
    }
    if (which === 'date-aware' || which === 'all') {
      results.push(['DA1 active-file-with-date', await testDA1ActiveFileWithDate()]);
      results.push(['DA2 active-file-without-date', await testDA2ActiveFileWithoutDate()]);
    }
    if (which === 'finance' || which === 'all') {
      results.push(['FF1 budget-nav-in-path', await testFF1BudgetNavInPath()]);
      results.push(['FF2 budget-nav-out-of-path', await testFF2BudgetNavOutOfPath()]);
      results.push(['FF3 hub-area-row-icons', await testFF3HubAreaRowIcons()]);
      results.push(['FF4 budget-categories-editor-add-button', await testFF4BudgetCategoriesAddButton()]);
      results.push(['FF5 paycheck-expenses-editor-add-button', await testFF5PaycheckExpensesAddButton()]);
      results.push(['FF6 invoice-time-log-editor-out-of-path', await testFF6InvoiceTimeLogOutOfPath()]);
      results.push(['FF7 invoice-controls-rate-and-toggle', await testFF7InvoiceControlsRateAndToggle()]);
      results.push(['FF8 widget-embed-dedup', await testFF8WidgetEmbedDedup()]);
    }
    if (which === 'barebones-one-button' || which === 'all') {
      const isWorkshop = VAULT === WORKSHOP;
      const explicit = which === 'barebones-one-button';
      const registryPresent = fs.existsSync(REGISTRY_ABS);
      if (explicit || (!isWorkshop && registryPresent)) {
        results.push(['T4.4 barebones-one-button', await testBarebonesOneButton()]);
      } else if (which === 'all') {
        const why = isWorkshop ? 'VAULT === workshop (workshop has no registry contributors)' : 'no registry at ' + REGISTRY_ABS;
        console.log(`\n=== T4.4 — barebones-one-button SKIPPED (${why}) ===`);
      }
    }
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    console.error(e.stack);
    process.exit(2);
  }

  console.log('\n=== Summary ===');
  for (const [name, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = results.every(([, ok]) => ok);
  process.exit(allPass ? 0 : 1);
})();
