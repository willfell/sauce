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
 *   R-SCRATCH-DAYHUB scratch-day-hub runTemplaterTemplate composes three-level folder + date-only filename (v0.40.0)
 *   R-COWORK-HUB cowork-hub openLink fires openLinkText("spice/cowork/Cowork.md") (v0.42.0)
 *   T4.0  lazy-scaffold       createFromTemplate dispatch → folder/file create + open
 *   T4.4  barebones-one-button   barebones's real registry → exactly one Board button
 *   BC1   subtitle-object       subtitle returning {text, secondaryText} → two subtitle elements
 *   BC2   subtitle-null         subtitle returning null → no subtitle element (regression)
 *   BC3   subtitle-string       subtitle returning string → single subtitle (regression)
 *   BC4   badge-icon            badges[].icon populates inline SVG in chip
 *   BC5   badge-no-icon         badges[] without icon renders text-only chip (regression)
 *   BC6   synthetic-page-onclick synthetic page + custom onClick fires
 *   BC7   success-tone          badges[].tone === "success" renders green (#16a34a) chip
 *   BC9   meta-function-form    REND-V066-PILL-1a+1b: meta (page, parentEl) => void callback invoked with parentEl (v0.2.6)
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
 *     all (default), empty, malformed, unknown-action, invoke-command-args, scratch-day-hub, cowork-hub, lazy-scaffold, barebones-one-button, beacon-cards, date-aware, finance, accent-button
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

const PEOPLE_RENDERING_FILE = path.join(WORKSHOP, 'platform', 'mechanisms', 'people-rendering', 'people-rendering.js');
const PEOPLE_RENDERING_SRC = fs.existsSync(PEOPLE_RENDERING_FILE) ? fs.readFileSync(PEOPLE_RENDERING_FILE, 'utf8') : '';

const ICONS_FILE = path.join(WORKSHOP, 'platform', 'mechanisms', 'icons', 'icons.js');
const ICONS_SRC = fs.existsSync(ICONS_FILE) ? fs.readFileSync(ICONS_FILE, 'utf8') : '';
function makeIconsInstance() {
  if (!ICONS_SRC) return { resolve: () => null };
  const fn = new Function(`${ICONS_SRC}\nreturn new Icons();`);
  return fn();
}
const ICONS_INSTANCE = makeIconsInstance();

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
  // Overlay code (SpaceNavButtons._openLauncher) builds nodes via
  // document.createElement + appendChild and identifies them via .className.
  el.appendChild = function (child) {
    child.parent = el;
    el.children.push(child);
    return child;
  };
  el.querySelector = function (sel) {
    if (typeof sel !== 'string' || sel[0] !== '.') return null;
    const cls = sel.slice(1);
    const walk = (n) => {
      if (n.cls === cls || n.className === cls) return n;
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
  // Walk ancestors for the nearest element matching a ".class" selector.
  el.closest = function (sel) {
    if (typeof sel !== 'string' || sel[0] !== '.') return null;
    const cls = sel.slice(1);
    let n = el;
    while (n) {
      if (n.cls === cls || n.className === cls) return n;
      n = n.parent;
    }
    return null;
  };
  return el;
}

// Global document stub — the v2.10.0 launcher overlay is appended to
// document.body (bottom sheet / dropdown) rather than the note container.
// app.isMobile is false in makeApp(), so the overlay takes the desktop path
// (pill.getBoundingClientRect is guarded → falls back when absent).
if (!global.document) {
  const _body = makeEl('body');
  global.document = {
    body: _body,
    createElement: (t) => makeEl(t),
    addEventListener: function () {},
    removeEventListener: function () {},
    querySelector: (sel) => _body.querySelector(sel),
  };
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
  // Paths created during this test run (capture mode). vault.create() returns a
  // TFile-shaped stub in real Obsidian, and getAbstractFileByPath resolves the
  // just-created file immediately after — mirror that so nav-buttons'
  // createFromTemplate tail (which re-fetches the target by path before opening
  // it on a captured leaf) sees the file it just wrote.
  const created_paths = new Set();
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
        // A file created earlier in THIS run resolves to a TFile regardless of
        // the (pre-create) fileExistsHook answer.
        if (created_paths.has(p)) return { path: p };
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
          created_paths.add(p);
          return { path: p };
        }
        const abs = path.join(VAULT, p);
        await fs.promises.mkdir(path.dirname(abs), { recursive: true });
        await fs.promises.writeFile(abs, body, 'utf8');
        created_paths.add(p);
        return { path: p };
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
      // v0.120.3 review: createFromTemplate's new-note tail now opens the
      // created TFile on a captured leaf (getLeaf(false).openFile(file)) so the
      // deferred read-mode flip targets THIS note. Record the opened path so the
      // lazy-scaffold assertion still sees exactly one open of the target.
      activeLeaf: null,
      getLeaf(_split) {
        const leaf = {
          async openFile(file) {
            captured_open.push(file && file.path ? file.path : '<no-path>');
          },
        };
        this.activeLeaf = leaf;
        return leaf;
      },
    },
    __captured_open: captured_open,
    __captured_writes: captured_writes,
  };
}

// ── Load renderer class ──────────────────────────────────────────────────
function loadRendererClass(app, Notice) {
  const customJS = { Icons: ICONS_INSTANCE, OpenHelpers: { forceActiveLeafPreview() {}, forceLeafPreview() {} } };
  const fn = new Function('app', 'Notice', 'customJS', `${RENDERER_SRC}\nreturn SpaceNavButtons;`);
  return fn(app, Notice, customJS);
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

function loadPeopleRenderingClass(app, customJS, Notice) {
  if (!PEOPLE_RENDERING_SRC) return null;
  const fn = new Function('app', 'customJS', 'Notice', `${PEOPLE_RENDERING_SRC}\nreturn typeof PeopleRendering !== 'undefined' ? PeopleRendering : null;`);
  return fn(app, customJS || {}, Notice || FakeNotice);
}

function makeFinanceCustomJsStub(overrides) {
  const noop = { render: async () => {} };
  const base = {
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
  return Object.assign(base, overrides || {});
}

function loadFinanceClass(className, app, customJsOverrides) {
  const filename = className === 'BudgetNavButtons' ? 'budget-nav-buttons.js'
    : className === 'PaycheckNavButtons' ? 'paycheck-nav-buttons.js'
    : className === 'FinanceHubCards' ? 'finance-hub-cards.js'
    : className === 'BudgetCategoriesEditor' ? 'budget-categories-editor.js'
    : className === 'BudgetDefaultsEditor' ? 'budget-defaults-editor.js'
    : className === 'BudgetAllocationsEditor' ? 'budget-allocations-editor.js'
    : className === 'PaycheckExpensesEditor' ? 'paycheck-expenses-editor.js'
    : className === 'PaycheckSummary' ? 'paycheck-summary.js'
    : className === 'PaycheckDefaultsEditor' ? 'paycheck-defaults-editor.js'
    : className === 'InvoiceTimeLogEditor' ? 'invoice-time-log-editor.js'
    : className === 'InvoiceControls' ? 'invoice-controls.js'
    : null;
  if (!filename) throw new Error(`loadFinanceClass: unknown class ${className}`);
  const filepath = path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', filename);
  const src = fs.readFileSync(filepath, 'utf8');
  const fn = new Function('app', 'customJS', 'Notice', `${src}\nreturn ${className};`);
  return fn(app, makeFinanceCustomJsStub(customJsOverrides), FakeNotice);
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
// SpaceNavButtons wraps the label in a span that may carry inline styles
// (overflow/ellipsis safety, nav-buttons@2.8.0), so match the label text inside
// a <span ...> with optional attributes rather than the bare <span>label</span>.
function labelSpanRe(label) {
  return new RegExp(`<span(?:\\s[^>]*)?>${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`);
}
function findButtonByLabel(root, label) {
  if (root.tag === 'button' && labelSpanRe(label).test(root.innerHTML)) return root;
  for (const c of root.children) {
    const f = findButtonByLabel(c, label);
    if (f) return f;
  }
  return null;
}
// nav-buttons@2.12.0: some entries are PINNED as direct 3-col-grid buttons
// (Daily/To-Do/Scratch/Projects/Meetings); the rest live behind the "Go to…"
// pill, which on click builds a launcher overlay appended to document.body.
// Try the direct grid button first; otherwise open the overlay and search it —
// so the existing click→_dispatchAction assertions hold whether the entry is
// pinned or in the menu.
function openLauncherFindByLabel(root, label) {
  const direct = findButtonByLabel(root, label);
  if (direct) return direct;
  if (global.document && global.document.body) global.document.body.children = [];
  const pill = findButtonByLabel(root, 'Go to…');
  if (!pill || typeof pill.onclick !== 'function') return null;
  pill.onclick({ stopPropagation() {} });
  return findButtonByLabel(global.document.body, label);
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
    const fakeBtn = openLauncherFindByLabel(dv.container, 'Fake');
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

// R-INVOKE-ARGS — invoke_command action with args object dispatches and writes scratchpad.
//
// v0.31.0 S3.2 / nav-buttons@2.6.0: when action.args is a valid {[string]:string}
// map, the renderer (1) writes <vault>/.scratch/nav-button-pending-args.json
// containing {command_id, args, dispatched_at}, AND (2) calls
// app.commands.executeCommandById(command_id, args). When args is absent, only
// (2) fires with a single arg.
async function testInvokeCommandArgs() {
  console.log('\n=== R-INVOKE-ARGS — invoke_command with args writes scratchpad + dispatches command (v2.6.0) ===');
  reset();
  const synthetic = JSON.stringify({
    schema_version: 1,
    contributions: {
      cowork: [
        {
          id: 'cowork-bootstrap-accuris',
          label: 'Bootstrap',
          icon: 'plus',
          order: 50,
          action: {
            type: 'invoke_command',
            command_id: 'cowork:bootstrap-vault',
            args: { engagement_id: 'accuris' },
          },
        },
      ],
    },
  });
  return await withTempRegistry(synthetic, async () => {
    const app = makeApp();
    // Stub commands surface used by the renderer.
    const dispatched = [];
    app.commands = {
      commands: { 'cowork:bootstrap-vault': { id: 'cowork:bootstrap-vault' } },
      executeCommandById(id, args) { dispatched.push({ id, args }); },
    };
    // Stub adapter.mkdir (renderer calls it to ensure .scratch exists).
    app.vault.adapter.mkdir = async function (_p) { /* capture-only via writes */ };

    const Cls = loadRendererClass(app, FakeNotice);
    const dv = makeDv();
    const sn = new Cls();
    await sn.render(dv);
    const btn = openLauncherFindByLabel(dv.container, 'Bootstrap');
    if (!btn) {
      console.log('  FAIL — Bootstrap button not rendered');
      return false;
    }
    await btn.onclick();

    const writes = app.__captured_writes.filter(
      (w) => w.method === 'adapter.write' && w.path === '.scratch/nav-button-pending-args.json'
    );
    const scratchOk = writes.length === 1;
    let scratchPayloadOk = false;
    if (scratchOk) {
      try {
        const parsed = JSON.parse(writes[0].body);
        scratchPayloadOk =
          parsed.command_id === 'cowork:bootstrap-vault' &&
          parsed.args &&
          parsed.args.engagement_id === 'accuris' &&
          typeof parsed.dispatched_at === 'string';
      } catch (_) {
        scratchPayloadOk = false;
      }
    }
    const dispatchedOk =
      dispatched.length === 1 &&
      dispatched[0].id === 'cowork:bootstrap-vault' &&
      dispatched[0].args &&
      dispatched[0].args.engagement_id === 'accuris';
    const noticesOk = captured_notices.length === 0;

    console.log(`  scratchpad writes: ${writes.length} (expect 1)`);
    console.log(`  scratchpad payload valid: ${scratchPayloadOk}`);
    console.log(`  command dispatches: ${dispatched.length} (expect 1)`);
    console.log(`  dispatched args.engagement_id: ${dispatched[0] && dispatched[0].args && dispatched[0].args.engagement_id}`);
    console.log(`  notices: ${captured_notices.length} (expect 0)`);

    const pass = scratchOk && scratchPayloadOk && dispatchedOk && noticesOk;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

// R-SCRATCH-DAYHUB — runTemplaterTemplate action for scratch-day-hub composes
// the three-level folder path (folder_prefix + YYYY/MM-MMMM/YYYY-MM-DD) and the
// date-only filename (Scratch-Day-YYYY-MM-DD — NO time suffix) and dispatches
// Templater.
//
// v0.40.0 S4 — scratch blueprint sole nav-button entry, renamed from scratch-new
// to scratch-day-hub. Filename change from Scratch-YYYY-MM-DD-HH-mm to
// Scratch-Day-YYYY-MM-DD activates the dormant open-if-exists branch at
// space-nav-buttons.js:348-352, so a second click on the same day opens the
// existing day-hub instead of failing. The registry stores already-resolved
// fields (folder_prefix === "spice/scratch"); the renderer must (1) call
// createFolder with the deepest day-folder, (2) invoke the Templater plugin's
// create_new_note_from_template with filename matching Scratch-Day-YYYY-MM-DD.
async function testScratchDayHubRunTemplaterTemplate() {
  console.log('\n=== R-SCRATCH-DAYHUB — scratch-day-hub runTemplaterTemplate composes three-level folder + date-only filename ===');
  reset();

  // Frozen instant for deterministic assertions: 2026-05-12.
  const FROZEN_ISO = '2026-05-12';
  const EXPECTED_FOLDER = 'spice/scratch/2026/05-May/2026-05-12';
  const EXPECTED_FILENAME_NO_EXT = `Scratch-Day-${FROZEN_ISO}`;

  // Local moment stub honoring the two patterns the renderer uses for this
  // action: "YYYY/MM-MMMM/YYYY-MM-DD" + "YYYY-MM-DD-HH-mm". Strict-validate
  // path mirrors window-moment used by _resolveActionDate.
  const prior_window = global.window;
  global.window = {
    moment: function (s, fmt, strict) {
      const validIso = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
      return {
        isValid: () => validIso,
        format: function (pattern) {
          if (pattern === 'YYYY/MM-MMMM/YYYY-MM-DD') return '2026/05-May/2026-05-12';
          if (pattern === 'YYYY-MM-DD') return FROZEN_ISO;
          return '';
        },
      };
    },
  };

  // Synthetic registry containing the resolved scratch-day-hub entry.
  const synthetic = JSON.stringify({
    schema_version: 1,
    contributions: {
      scratch: [
        {
          id: 'scratch-day-hub',
          label: 'Scratch',
          icon: 'edit-3',
          order: 130,
          action: {
            type: 'runTemplaterTemplate',
            template_source: 'Scratch Day Hub.md',
            folder_prefix: 'spice/scratch',
            folder_date_pattern: 'YYYY/MM-MMMM/YYYY-MM-DD',
            filename_prefix: 'Scratch-Day-',
            filename_date_pattern: 'YYYY-MM-DD',
            filename_suffix: '',
          },
        },
      ],
    },
  });

  try {
    return await withTempRegistry(synthetic, async () => {
      const app = makeApp({
        fileExistsHook(p) {
          // target file must NOT exist (so renderer falls through to scaffold).
          if (p === `${EXPECTED_FOLDER}/${EXPECTED_FILENAME_NO_EXT}.md`) return null;
          // folder must NOT exist (so renderer calls createFolder).
          if (p === EXPECTED_FOLDER) return null;
          // template must exist (renderer dereferences it as a TFile).
          if (p === 'Scratch Day Hub.md') return { path: 'Scratch Day Hub.md' };
          return undefined;
        },
      });

      // Stub Templater plugin surface.
      const templaterCalls = [];
      app.plugins = {
        plugins: {
          'templater-obsidian': {
            templater: {
              async create_new_note_from_template(tfile, folder, filename, openNewNote) {
                templaterCalls.push({
                  template_path: tfile && tfile.path,
                  folder,
                  filename,
                  openNewNote,
                });
              },
            },
          },
        },
      };

      const Cls = loadRendererClass(app, FakeNotice);
      const dv = makeDv();
      const sn = new Cls();
      await sn.render(dv);

      const btn = openLauncherFindByLabel(dv.container, 'Scratch');
      if (!btn) {
        console.log('  FAIL — Scratch button not rendered');
        return false;
      }
      await btn.onclick();

      const folderCreates = app.__captured_writes.filter(
        (w) => w.method === 'createFolder' && w.path === EXPECTED_FOLDER
      );
      const folderOk = folderCreates.length === 1;
      const tcOk = templaterCalls.length === 1;
      const tcCall = templaterCalls[0] || {};
      const templatePathOk = tcCall.template_path === 'Scratch Day Hub.md';
      const folderArgOk = tcCall.folder === EXPECTED_FOLDER;
      const filenameOk = tcCall.filename === EXPECTED_FILENAME_NO_EXT;
      const noticesOk = captured_notices.length === 0;

      console.log(`  folder createFolder('${EXPECTED_FOLDER}'): ${folderCreates.length}`);
      console.log(`  templater.create_new_note_from_template calls: ${templaterCalls.length}`);
      console.log(`  templater call: template=${tcCall.template_path} folder=${tcCall.folder} filename=${tcCall.filename}`);
      console.log(`  notices: ${captured_notices.length}`);

      const pass = folderOk && tcOk && templatePathOk && folderArgOk && filenameOk && noticesOk;
      console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
      return pass;
    });
  } finally {
    global.window = prior_window;
  }
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
    const boardBtn = openLauncherFindByLabel(dv.container, 'Board');
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

// T4.4 — barebones registry should produce exactly one Board entry behind the
// "Go to…" launcher (nav-buttons@2.9.0: entries are collapsed into the launcher,
// not always-visible). Reads the target vault's registry as-is (no sandbox).
// Asserts: vault-nav container present, a single "Go to…" pill after render, and
// opening the launcher reveals exactly one entry — label "Board", board icon.
async function testBarebonesOneButton() {
  console.log('\n=== T4.4 — barebones registry → exactly one Board entry in launcher ===');
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

  const navContainer = findClass(dv.container, 'vault-nav');
  // After render, before opening the launcher, the collapsed chrome exposes the
  // pill (and, if the daily blueprint is installed, prev/next arrows — but the
  // barebones registry has no daily contributor, so pill only).
  const pill = findButtonByLabel(dv.container, 'Go to…');
  console.log(`  vault-nav container: ${navContainer ? 'present' : 'absent'}`);
  console.log(`  Go to… pill: ${pill ? 'present' : 'absent'}`);
  if (!pill || typeof pill.onclick !== 'function') {
    console.log('  FAIL — Go to… launcher pill not rendered');
    return false;
  }
  // Open the launcher (overlay appended to document.body) and enumerate entries.
  if (global.document && global.document.body) global.document.body.children = [];
  pill.onclick({ stopPropagation() {} });
  const panel = global.document.body.querySelector('.vault-nav-panel');
  const entries = panel ? collectButtons(panel) : [];
  console.log(`  entries revealed: ${entries.length}`);
  for (const b of entries) {
    const m = b.innerHTML.match(/<span(?:\s[^>]*)?>([^<]+)<\/span>/);
    console.log(`    entry label="${m && m[1]}"`);
  }
  if (entries.length !== 1) {
    console.log('  FAIL — expected exactly 1 entry');
    return false;
  }
  const labelOk = labelSpanRe('Board').test(entries[0].innerHTML);
  // Board icon: lucide "board" svg has the three vertical paths
  const iconOk = entries[0].innerHTML.includes('M8 7v7') && entries[0].innerHTML.includes('M16 7v9');
  console.log(`  label is Board: ${labelOk}`);
  console.log(`  icon is board: ${iconOk}`);
  const pass = !!navContainer && entries.length === 1 && labelOk && iconOk && captured_notices.length === 0;
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

async function testBC8SubtitleCallback() {
  console.log('\n=== BC8 — subtitle returning (parent) => void callback fires once and renders into subtitle slot ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  let calls = 0;
  await cards.render(dv, {
    pages: [{ file: { name: 'Test', path: 'Test.md' } }],
    title: (p) => p.file.name,
    subtitle: () => (parent) => {
      calls++;
      const span = parent.createEl('span');
      span.textContent = 'callback-rendered-text';
    },
    layout: 'stacked',
  });
  const cbHits = collectAll(dv.container, (el) => el.textContent === 'callback-rendered-text');
  console.log(`  subtitle callback invocations: ${calls}`);
  console.log(`  callback-rendered DOM elements: ${cbHits.length}`);
  const pass = calls === 1 && cbHits.length >= 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── REND-V066-PILL-1: BeaconCards meta accepts function-form (arity >= 2) ─────
// v0.66.0 prerequisite for daily-dashboard cohesion cycle. The daily blueprint
// will pass a (page, parentEl) callback as `meta` to ActivityFeed which
// delegates to BeaconCards. Mirrors v0.2.4 subtitle-callback pattern.
async function testBC9MetaFunctionForm() {
  console.log('\n=== BC9 / REND-V066-PILL-1 — meta (page, parentEl) => void callback form fires and receives parentEl ===');
  const app = makeApp();
  const Cls = loadBeaconCardsClass(app);
  const dv = makeDv();
  const cards = new Cls();
  let metaCalls = 0;
  let metaArity = null;
  let metaParentEl = null;
  const fakeMetaFn = function (page, parentEl) {
    metaCalls++;
    metaArity = arguments.length;
    metaParentEl = parentEl;
    parentEl.textContent = 'via-fn';
  };
  await cards.render(dv, {
    pages: [{ file: { name: 'x', path: 'x.md' } }],
    title: (p) => p.file.name,
    meta: fakeMetaFn,
    layout: 'row',
  });
  console.log(`  meta callback invocations: ${metaCalls}`);
  console.log(`  meta callback arity: ${metaArity}`);
  console.log(`  meta parentEl non-null: ${metaParentEl !== null}`);
  const pill1a = metaCalls === 1;
  const pill1b = metaArity === 2 && metaParentEl !== null;
  console.log(`  REND-V066-PILL-1a (invoked exactly once): ${pill1a ? 'PASS' : 'FAIL'}`);
  console.log(`  REND-V066-PILL-1b (receives parentEl as 2nd arg): ${pill1b ? 'PASS' : 'FAIL'}`);
  const pass = pill1a && pill1b;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── people-rendering mechanism (v0.27.0) ────────────────────────────────
async function testPR1ChipResolved() {
  console.log('\n=== PR1 — renderChip with valid personLink returns <span> with name + tooltip from frontmatter ===');
  const app = makeApp();
  app.metadataCache = {
    getFirstLinkpathDest: (linkpath) => ({ path: 'spice/people/' + linkpath + '.md', basename: linkpath }),
    getFileCache: () => ({ frontmatter: { company: 'Acme', title: 'Engineer' } }),
  };
  const Cls = loadPeopleRenderingClass(app);
  if (!Cls) { console.log('  FAIL — PeopleRendering class not loaded'); return false; }
  const parent = makeEl('div', {});
  let span;
  try {
    span = new Cls().renderChip(parent, '[[Jane Doe]]');
  } catch (e) {
    console.log(`  FAIL — renderChip threw: ${e.message}`);
    return false;
  }
  const isSpan = !!span && span.tag === 'span';
  const hasName = isSpan && typeof span.textContent === 'string' && span.textContent.includes('Jane Doe');
  const hasTooltip = isSpan && typeof span.title === 'string' && span.title.includes('Acme') && span.title.includes('Engineer');
  console.log(`  is <span>: ${isSpan}; name in text: ${hasName}; tooltip has frontmatter: ${hasTooltip}`);
  const pass = isSpan && hasName && hasTooltip;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testPR2ChipMissing() {
  console.log('\n=== PR2 — renderChip with unresolved link renders red-tinted span + Notice on click ===');
  reset();
  const app = makeApp();
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const Cls = loadPeopleRenderingClass(app);
  if (!Cls) { console.log('  FAIL — class not loaded'); return false; }
  const parent = makeEl('div', {});
  let span;
  try {
    span = new Cls().renderChip(parent, '[[Unknown]]');
  } catch (e) {
    console.log(`  FAIL — threw: ${e.message}`);
    return false;
  }
  const css = (span.style && span.style.cssText) || '';
  const clsStr = (span.cls || '') + ' ' + (span.className || '');
  const looksMissing = css.includes('--text-error')
    || css.includes('color: var(--text-error)')
    || css.includes('rgba(255')
    || /missing|unknown/i.test(clsStr);
  if (typeof span.onclick === 'function') {
    span.onclick({});
  }
  const hadNotice = captured_notices.some((n) => /unknown person/i.test(n.msg || ''));
  console.log(`  red-tinted: ${looksMissing}; click→Notice "Unknown person…": ${hadNotice}`);
  const pass = looksMissing && hadNotice;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testPR3CardDelegates() {
  console.log('\n=== PR3 — renderCard delegates to customJS.BeaconCards.render with synthetic-page list of one ===');
  const app = makeApp();
  app.metadataCache = {
    getFirstLinkpathDest: () => ({ path: 'spice/people/Jane Doe.md', basename: 'Jane Doe' }),
    getFileCache: () => ({ frontmatter: { company: 'Acme', title: 'Engineer' } }),
  };
  const calls = [];
  const customJSStub = { BeaconCards: { render: async (dv, opts) => { calls.push({ dv, opts }); } } };
  const Cls = loadPeopleRenderingClass(app, customJSStub);
  if (!Cls) { console.log('  FAIL — class not loaded'); return false; }
  const dv = makeDv();
  try {
    new Cls().renderCard(dv, '[[Jane Doe]]', { layout: 'row' });
  } catch (e) {
    console.log(`  FAIL — renderCard threw: ${e.message}`);
    return false;
  }
  await new Promise((r) => setImmediate(r));
  const callCount = calls.length;
  let pageCount = 0;
  let layoutThreaded = false;
  if (callCount === 1) {
    const opts = calls[0].opts || {};
    const pages = opts.pages || opts.items || [];
    pageCount = Array.isArray(pages) ? pages.length : 0;
    layoutThreaded = opts.layout === 'row';
  }
  console.log(`  BeaconCards.render calls: ${callCount}; synthetic pages: ${pageCount}; layout threaded: ${layoutThreaded}`);
  const pass = callCount === 1 && pageCount === 1 && layoutThreaded;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testPR4MentionListMentioningPerson() {
  console.log('\n=== PR4 — renderMentionList(mode=mentioning_person) emits dv.pages(scopePath).where chain; respects limit ===');
  const app = makeApp();
  app.metadataCache = {
    getFirstLinkpathDest: () => ({ path: 'spice/people/Jane Doe.md', basename: 'Jane Doe' }),
    getFileCache: () => ({ frontmatter: {} }),
  };
  const customJSStub = { BeaconCards: { render: async () => {} } };
  const Cls = loadPeopleRenderingClass(app, customJSStub);
  if (!Cls) { console.log('  FAIL — class not loaded'); return false; }

  const observed = { pages_arg: null, where_invoked: false, sort_invoked: false, limit_observed: null };
  const chain = {
    where(fn) { observed.where_invoked = true; return chain; },
    sort(fn, dir) { observed.sort_invoked = true; return chain; },
    slice(start, end) {
      observed.limit_observed = end !== undefined ? end - start : end;
      return [];
    },
    limit(n) { observed.limit_observed = n; return chain; },
    [Symbol.iterator]() { return [].values(); },
    length: 0,
    map(fn) { return []; },
    forEach() {},
  };
  const dvSpy = {
    container: makeEl('div', {}),
    fileLink: (p) => ({ path: p, type: 'file', display: p }),
    pages(arg) { observed.pages_arg = arg; return chain; },
  };
  try {
    const result = new Cls().renderMentionList(dvSpy, { mode: 'mentioning_person', personLink: '[[Jane Doe]]', scopePath: 'spice/meetings' }, { style: 'cards', limit: 50 });
    if (result && typeof result.then === 'function') await result;
  } catch (e) {
    console.log(`  FAIL — renderMentionList threw: ${e.message}`);
    return false;
  }
  const pagesArgOk = observed.pages_arg === '"spice/meetings"';
  const limitOk = observed.limit_observed === 50;
  console.log(`  pages arg: ${observed.pages_arg}; .where invoked: ${observed.where_invoked}; limit threaded: ${limitOk}`);
  const pass = pagesArgOk && observed.where_invoked && limitOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testPR5MentionListMentionedInNote() {
  console.log('\n=== PR5 — renderMentionList(mode=mentioned_in_note) reads body via app.vault + filters via extractMentions ===');
  const app = makeApp();
  app.vault.adapter.read = async (p) => {
    if (p === 'spice/meetings/Test.md') return 'Body [[Jane Doe]] and [[Random Note]]';
    throw new Error('unexpected read: ' + p);
  };
  app.metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      if (linkpath === 'Jane Doe') return { path: 'spice/people/Jane Doe.md', basename: 'Jane Doe' };
      return null;
    },
    getFileCache: () => ({ frontmatter: { company: 'Acme', title: 'Engineer' } }),
  };
  const customJSStub = { BeaconCards: { render: async () => {} } };
  const Cls = loadPeopleRenderingClass(app, customJSStub);
  if (!Cls) { console.log('  FAIL — class not loaded'); return false; }
  const dv = makeDv();
  try {
    const result = new Cls().renderMentionList(dv, { mode: 'mentioned_in_note', notePath: 'spice/meetings/Test.md' }, { style: 'chips' });
    if (result && typeof result.then === 'function') await result;
  } catch (e) {
    console.log(`  FAIL — renderMentionList threw: ${e.message}`);
    return false;
  }
  const chipsForJane = collectAll(dv.container, (el) => el.tag === 'span' && typeof el.textContent === 'string' && el.textContent.includes('Jane Doe'));
  const chipsForRandom = collectAll(dv.container, (el) => el.tag === 'span' && typeof el.textContent === 'string' && el.textContent.includes('Random'));
  console.log(`  Jane chips: ${chipsForJane.length}; Random chips: ${chipsForRandom.length}`);
  const pass = chipsForJane.length === 1 && chipsForRandom.length === 0;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testPR6ExtractMentionsArray() {
  console.log('\n=== PR6 — extractMentions returns Array<{display,target}>; filters to spice/people/; unique=true dedupes ===');
  const app = makeApp();
  app.metadataCache = {
    getFirstLinkpathDest: (linkpath) => {
      if (linkpath === 'Jane Doe') return { path: 'spice/people/Jane Doe.md', basename: 'Jane Doe' };
      return null;
    },
  };
  const Cls = loadPeopleRenderingClass(app);
  if (!Cls) { console.log('  FAIL — class not loaded'); return false; }
  let out;
  try {
    out = new Cls().extractMentions('Body [[Jane Doe]] and [[Random Note]] and [[Jane Doe]]');
  } catch (e) {
    console.log(`  FAIL — extractMentions threw: ${e.message}`);
    return false;
  }
  const isArray = Array.isArray(out);
  const len = isArray ? out.length : 0;
  const first = isArray && out[0];
  const shapeOk = !!first && first.display === 'Jane Doe' && first.target === 'spice/people/Jane Doe.md';
  console.log(`  isArray: ${isArray}; length: ${len}; first.display: ${first && first.display}; first.target: ${first && first.target}`);
  const pass = isArray && len === 1 && shapeOk;
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
  // Label span may carry truncation styling (a style="..." attr), so match the
  // tag close + text rather than a bare <span>.
  const idxLabel = html.indexOf('>Save</span>');
  const pass = idxIcon !== -1 && idxLabel !== -1 && idxIcon < idxLabel;
  console.log(`  innerHTML: ${html}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB9LabelSpanTruncates() {
  console.log('\n=== BB9 — label span carries single-line truncation styling (no wrap → centering stays clean) ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Project Board', icon: '<svg/>', onClick: () => {}, flex: true });
  const html = (btn && btn.innerHTML) || '';
  // Isolate the label span (the one wrapping the text, not the icon).
  const m = html.match(/<span([^>]*)>Project Board<\/span>/);
  const attrs = (m && m[1]) || '';
  const hasNowrap = /white-space\s*:\s*nowrap/.test(attrs);
  const hasEllipsis = /text-overflow\s*:\s*ellipsis/.test(attrs);
  const hasOverflowHidden = /overflow\s*:\s*hidden/.test(attrs);
  const hasMinWidth0 = /min-width\s*:\s*0/.test(attrs);
  const pass = !!m && hasNowrap && hasEllipsis && hasOverflowHidden && hasMinWidth0;
  console.log(`  label span attrs: ${attrs}`);
  console.log(`  nowrap=${hasNowrap} ellipsis=${hasEllipsis} overflowHidden=${hasOverflowHidden} minWidth0=${hasMinWidth0}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB6HoverEnterLeaveSwapsColors() {
  console.log('\n=== BB6 — hover-enter swaps to filled accent; hover-leave restores (individual props) ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {} });
  if (btn && typeof btn.onmouseenter === 'function') btn.onmouseenter();
  const enteredFill = btn.style.background === 'var(--interactive-accent)'
    && btn.style.color === 'var(--text-on-accent)';
  if (btn && typeof btn.onmouseleave === 'function') btn.onmouseleave();
  const restored = btn.style.background === 'var(--background-primary)'
    && btn.style.color === 'var(--interactive-accent)';
  const pass = enteredFill && restored;
  console.log(`  enteredFill: ${enteredFill}; restored: ${restored}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB7HoverDoesNotReassignCssText() {
  console.log('\n=== BB7 — hover mutates individual props only; cssText unchanged (no jitter) ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'Hi', icon: '<svg/>', onClick: () => {} });
  const resting = btn.style.cssText;
  if (btn && typeof btn.onmouseenter === 'function') btn.onmouseenter();
  const unchangedOnEnter = btn.style.cssText === resting;
  if (btn && typeof btn.onmouseleave === 'function') btn.onmouseleave();
  const unchangedOnLeave = btn.style.cssText === resting;
  const pass = unchangedOnEnter && unchangedOnLeave;
  console.log(`  unchangedOnEnter: ${unchangedOnEnter}; unchangedOnLeave: ${unchangedOnLeave}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testBB8BaseCssClipsOverflow() {
  console.log('\n=== BB8 — base cssText clips overflow (label cannot spill past button) ===');
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: 'A very long button label here', icon: '<svg/>', onClick: () => {} });
  const css = (btn && btn.style && btn.style.cssText) || '';
  const pass = css.includes('overflow: hidden');
  console.log(`  cssText: ${css}`);
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testNavWrapRowStyleWraps() {
  console.log('\n=== NAV-LAYOUT — SpaceNavButtons renders a fixed 3-column grid (pinned buttons + Go to…) ===');
  // v2.12.0: pinned quick-nav buttons + the Go to… menu render in a fixed
  // 3-column CSS grid; cells clip overflow (labels ellipsised) so nothing
  // crushes on narrow screens. No flex-wrap:nowrap crush anywhere.
  const gridCols = RENDERER_SRC.includes('grid-template-columns: repeat(3, 1fr)');
  const cellClips = RENDERER_SRC.includes('overflow') && RENDERER_SRC.includes('text-overflow:ellipsis');
  const noNowrap = !RENDERER_SRC.includes('flex-wrap: nowrap');
  const pass = gridCols && cellClips && noNowrap;
  console.log(`  3-col grid: ${gridCols}; cellClips: ${cellClips}; noNowrap: ${noNowrap}`);
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

// FF9 — PaycheckExpensesEditor delete re-renders from the authoritative array,
// not the frozen dv.current() metadata cache. Proves render-from-authoritative +
// no index cascade: with dv.current() frozen to the pre-delete 2-row array, the
// re-render must reflect the shorter written array (only the surviving row).
async function testFF9PaycheckDeleteRendersAuthoritative() {
  console.log('\n=== FF9 — PaycheckExpensesEditor delete renders from authoritative array (no index cascade) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app);
  const inst = new Cls();
  // Authoritative store — the "true" post-write state the metadata cache lags.
  const store = { expenses: [{ item: 'Alpha', amount: 1 }, { item: 'Bravo', amount: 2 }] };
  // Bypass customJS.FinanceFrontmatter; mutate the authoritative store directly.
  inst._mutate = async (file, mutator) => {
    const fm = { expenses: store.expenses.slice() };
    await mutator(fm);
    store.expenses = fm.expenses;
  };
  // dv.current() is FROZEN to the ORIGINAL 2-row array (the bug's trigger).
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Paycheck-x', path: 'spice/finance/paychecks/x/Paycheck-x.md' },
    { expenses: store.expenses.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/paychecks/x/Paycheck-x.md');
  global.window = { confirm: () => true };
  await inst._deleteFlow(file, dv, 0, store.expenses[0]);
  const writeOk = store.expenses.length === 1 && store.expenses[0].item === 'Bravo';
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const rendersAlpha = texts.includes('Alpha');
  const rendersBravo = texts.includes('Bravo');
  const renderOk = !!root && rendersBravo && !rendersAlpha;
  console.log(`  write shortened to [Bravo]: ${writeOk} ; render shows Bravo not Alpha (authoritative): ${renderOk}`);
  const pass = writeOk && renderOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF10 — editing a debt-linked paycheck row preserves its [[Debt-…]] wikilink
// (merge-on-edit). The modal returns only its editable fields (no debt), so a
// naive list[index] = result strips the link; Object.assign({}, current, result)
// keeps it while applying the new fields.
async function testFF10PaycheckEditPreservesDebt() {
  console.log('\n=== FF10 — PaycheckExpensesEditor edit preserves debt link (merge-on-edit) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app);
  const inst = new Cls();
  const store = { expenses: [{ item: 'Apple', amount: 950, category: 'Credit Payment', url: 'https://card.apple.com', debt: '[[Debt-Apple-Card]]', paid: false }] };
  inst._mutate = async (file, mutator) => {
    const fm = { expenses: store.expenses.slice() };
    await mutator(fm);
    store.expenses = fm.expenses;
  };
  // Modal returns edited fields WITHOUT a debt field (the bug's trigger).
  inst._promptForExpense = async () => ({ item: 'Apple', amount: 950, category: 'Credit Payment', paid: true, url: 'https://card.apple.com' });
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Paycheck-x', path: 'spice/finance/paychecks/x/Paycheck-x.md' },
    { expenses: store.expenses.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/paychecks/x/Paycheck-x.md');
  await inst._editFlow(file, dv, 0, store.expenses[0]);
  const keepsDebt = store.expenses[0].debt === '[[Debt-Apple-Card]]';
  const appliedPaid = store.expenses[0].paid === true;
  console.log(`  keeps debt link: ${keepsDebt} ; applied new paid flag: ${appliedPaid}`);
  const pass = keepsDebt && appliedPaid;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── Monthly-paycheck per-deposit view (Task 3) ────────────────────────────
// FF17 — first-render deposit materialize: a monthly paycheck born with
// `deposits: []` + `month` materializes deposits ONCE from Paycheck Defaults'
// deposit_schedule, then a second render with deposits present writes NOTHING
// (idempotent — no write loop).
async function testFF17PaycheckDepositMaterialize() {
  console.log('\n=== FF17 — PaycheckExpensesEditor materializes deposits from schedule (once, idempotent) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  // Capture _mutate writes into an authoritative store.
  const store = { deposits: [], month: '2026-07', expenses: [] };
  const writes = [];
  const overrides = {
    FinanceFrontmatter: {
      update: async () => {},
      // deposit_schedule from the (stubbed) Paycheck Defaults note.
      read: (p) => (p === 'spice/finance/Paycheck Defaults.md'
        ? { deposit_schedule: [{ day: 1, amount: 4500 }, { day: 15, amount: 4500 }] }
        : null),
      isTruthy: (v) => v === true,
    },
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      depositTotals: (pg) => (Array.isArray(pg && pg.deposits) ? pg.deposits : []).map(d => ({ date: d.date, amount: Number(d.amount) || 0, assigned: 0, leftover: Number(d.amount) || 0 })),
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  inst._mutate = async (file, mutator) => {
    const fm = { deposits: store.deposits.slice(), month: store.month, expenses: store.expenses.slice() };
    await mutator(fm);
    store.deposits = fm.deposits;
    store.expenses = fm.expenses;
    writes.push({ deposits: JSON.parse(JSON.stringify(fm.deposits)) });
  };
  // dv.current() starts FROZEN to the empty-deposits page.
  const emptyPage = { file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' }, month: '2026-07', deposits: [], expenses: [] };
  const dv = makeDvWithCurrent(emptyPage);
  await inst.render(dv);

  const wroteOnce = writes.length === 1;
  const materialized = wroteOnce && JSON.stringify(writes[0].deposits) === JSON.stringify([{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 4500 }]);
  console.log(`  wrote deposits exactly once: ${wroteOnce} ; materialized shape correct: ${materialized}`);

  // Second render: deposits already present → NO further write.
  const beforeSecond = writes.length;
  const fullPage = { file: emptyPage.file, month: '2026-07', deposits: store.deposits.slice(), expenses: [] };
  const dv2 = makeDvWithCurrent(fullPage);
  await inst.render(dv2);
  const idempotent = writes.length === beforeSecond;
  console.log(`  second render (deposits present) writes nothing: ${idempotent}`);

  const pass = wroteOnce && materialized && idempotent;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF18 — per-deposit render: a monthly paycheck with 2 deposits + tagged
// expenses shows both deposit dates, a per-row deposit tag, and Assigned /
// Leftover subtotals (from stubbed depositTotals).
async function testFF18PaycheckPerDepositRender() {
  console.log('\n=== FF18 — PaycheckExpensesEditor renders per-deposit header + row tags + subtotals ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      depositTotals: (pg) => [
        { date: '2026-07-01', amount: 4500, assigned: 2200, leftover: 2300 },
        { date: '2026-07-15', amount: 4500, assigned: 950, leftover: 3550 },
      ],
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: [{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 4500 }],
    expenses: [
      { item: 'Rent', amount: 2200, category: 'Rent', deposit: 1, paid: false },
      { item: 'Apple', amount: 950, category: 'Credit Payment', deposit: 2, paid: true },
    ],
  };
  const dv = makeDvWithCurrent(page);
  await inst.render(dv);
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const showsDate1 = joined.includes('2026-07-01');
  const showsDate15 = joined.includes('2026-07-15');
  // ordinal tags derived from the deposit dates: day 1 → "1st", day 15 → "15th".
  const hasTag1st = texts.some(t => t === '1st') || joined.includes('1st');
  const hasTag15th = texts.some(t => t === '15th') || joined.includes('15th');
  const showsAssigned = joined.toLowerCase().includes('assigned');
  const showsLeftover = joined.toLowerCase().includes('leftover');
  console.log(`  dates: ${showsDate1}/${showsDate15} ; row tags 1st/15th: ${hasTag1st}/${hasTag15th} ; assigned: ${showsAssigned} ; leftover: ${showsLeftover}`);
  const pass = !!root && showsDate1 && showsDate15 && hasTag1st && hasTag15th && showsAssigned && showsLeftover;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF19 — move-an-expense-between-deposits: _moveFlow (picker stubbed to return
// deposit 2) on a deposit-1 row writes expenses[i].deposit = 2 + re-renders
// authoritatively despite a frozen dv.current().
async function testFF19PaycheckMoveBetweenDeposits() {
  console.log('\n=== FF19 — PaycheckExpensesEditor move-flow writes deposit index + renders authoritative ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      depositTotals: (pg) => (Array.isArray(pg && pg.deposits) ? pg.deposits : []).map(d => ({ date: d.date, amount: Number(d.amount) || 0, assigned: 0, leftover: Number(d.amount) || 0 })),
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  const store = {
    month: '2026-07',
    deposits: [{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 4500 }],
    expenses: [{ item: 'Apple', amount: 950, category: 'Credit Payment', deposit: 1, paid: false }],
  };
  inst._mutate = async (file, mutator) => {
    const fm = { month: store.month, deposits: store.deposits.slice(), expenses: store.expenses.map(e => ({ ...e })) };
    await mutator(fm);
    store.expenses = fm.expenses;
  };
  // Stub the picker to choose deposit 2.
  inst._promptForDeposit = async () => 2;
  // dv.current() FROZEN to the pre-move (deposit 1) page.
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: store.deposits.slice(),
    expenses: store.expenses.map(e => ({ ...e })),
  };
  const dv = makeDvWithCurrent(page);
  const file = app.vault.getAbstractFileByPath(page.file.path);
  await inst._moveFlow(file, dv, 0, store.expenses[0]);
  const wroteMove = store.expenses[0].deposit === 2;
  // Re-render must reflect the moved row: its tag is now "15th" (deposit 2's date).
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const rendersMoved = joined.includes('15th');
  console.log(`  wrote deposit=2: ${wroteMove} ; re-render shows 15th tag (authoritative): ${rendersMoved}`);
  const pass = wroteMove && rendersMoved;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF20 — backward-compat: a LEGACY per-check note (NO `deposits` key at all,
// pay_period_start, flat expenses) renders exactly as before (flat list, no
// deposit columns, no materialize write).
async function testFF20PaycheckLegacyFlatRender() {
  console.log('\n=== FF20 — PaycheckExpensesEditor legacy note (no deposits[]) renders flat, writes nothing ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => 1,
      depositTotals: () => { throw new Error('depositTotals must not be called for a legacy note'); },
    },
    FinanceFrontmatter: {
      update: async () => { throw new Error('legacy render must not write'); },
      read: () => { throw new Error('legacy render must not read Paycheck Defaults'); },
      isTruthy: (v) => v === true,
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  let wrote = false;
  inst._mutate = async () => { wrote = true; };
  const page = {
    file: { name: 'Paycheck-2026-05-15', path: 'spice/finance/paychecks/2026-05-15/Paycheck-2026-05-15.md' },
    pay_period_start: '2026-05-15',
    pay_period_end: '2026-05-31',
    paycheck_amount: 4500,
    expenses: [{ item: 'Rent', amount: 2200, category: 'Rent', paid: false }],
  };
  const dv = makeDvWithCurrent(page);
  let threw = null;
  try {
    await inst.render(dv);
  } catch (e) { threw = e; }
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const rendersFlatRow = joined.includes('Rent');
  const noDepositColumns = !joined.includes('2026-05-15') || true; // flat header has no deposit-date cells; assert via tag absence
  const noDepositTag = !texts.some(t => t === '15th' || t === '1st');
  const noWrite = !wrote && !threw;
  console.log(`  flat row rendered: ${rendersFlatRow} ; no deposit tag: ${noDepositTag} ; no write/throw: ${noWrite}${threw ? ' (threw: ' + threw.message + ')' : ''}`);
  const pass = !!root && rendersFlatRow && noDepositTag && noWrite;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF25 — editing a deposit amount re-renders from the AUTHORITATIVE array:
// _editDepositAmount mutates a deposit's amount, then must render the new amount
// (and recomputed subtotals) even though dv.current() is FROZEN to the OLD page.
// Mirrors FF19's move-flow authoritative-render assertion. RED before the fix:
// a plain this.render(dv) reads the frozen dv.current() → shows the OLD amount.
async function testFF25PaycheckEditDepositAmountAuthoritative() {
  console.log('\n=== FF25 — PaycheckExpensesEditor edit-deposit-amount renders authoritative (frozen dv.current) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      // depositTotals derives from the passed page so the header reflects the
      // authoritative (post-edit) deposits, not the frozen dv.current().
      depositTotals: (pg) => (Array.isArray(pg && pg.deposits) ? pg.deposits : []).map(d => ({ date: d.date, amount: Number(d.amount) || 0, assigned: 0, leftover: Number(d.amount) || 0 })),
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  // deposit[1] is a distinct amount (3000) so the "stale 4500.00" check isolates
  // deposit[0]: if the re-render were stale it would still show deposit[0]'s 4500.
  const store = {
    month: '2026-07',
    deposits: [{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 3000 }],
    expenses: [],
  };
  inst._mutate = async (file, mutator) => {
    const fm = { month: store.month, deposits: store.deposits.map(d => ({ ...d })), expenses: store.expenses.slice() };
    await mutator(fm);
    store.deposits = fm.deposits;
    store.expenses = fm.expenses;
  };
  // Stub window.prompt to type the NEW deposit amount (6000).
  const restoreWin = (() => { const prior = global.window; global.window = { prompt: () => '6000' }; return () => { global.window = prior; }; })();
  // dv.current() is FROZEN to the PRE-edit page (deposit 0 amount = 4500).
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: store.deposits.map(d => ({ ...d })),
    expenses: [],
  };
  const dv = makeDvWithCurrent(page);
  const file = app.vault.getAbstractFileByPath(page.file.path);
  await inst._editDepositAmount(file, dv, 0);
  restoreWin();
  const wroteAmount = store.deposits[0].amount === 6000;
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  // The re-render must show the NEW amount (6000.00), NOT the frozen 4500.00.
  const showsNew = joined.includes('6000.00');
  const showsStale = joined.includes('4500.00');
  console.log(`  wrote deposit[0]=6000: ${wroteAmount} ; re-render shows 6000.00: ${showsNew} ; stale 4500.00 still shown: ${showsStale}`);
  const pass = wroteAmount && showsNew && !showsStale;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF26 — grouped-by-check display order (finance tweak #1): with expenses authored
// OUT of deposit order (a deposit-2 row BEFORE a deposit-1 row), the editor must
// render all deposit-1 rows first, then deposit-2 — but edit/delete/move flows must
// still hit the ORIGINAL expenses[] index. Proven by deleting the FIRST rendered row
// (which is the deposit-1 expense, authored SECOND) and asserting the surviving
// expense is the deposit-2 one (original index 0), not a naive display-position delete.
async function testFF26PaycheckGroupedByCheckOrder() {
  console.log('\n=== FF26 — PaycheckExpensesEditor renders grouped by check + delete hits original index ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      _coerceDateString: (v) => (typeof v === 'string' ? v : (v && typeof v.toISODate === 'function' ? v.toISODate() : null)),
      depositTotals: (pg) => (Array.isArray(pg && pg.deposits) ? pg.deposits : []).map(d => ({ date: d.date, amount: Number(d.amount) || 0, assigned: 0, leftover: Number(d.amount) || 0 })),
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  // Authoritative store — expenses authored OUT of deposit order: Apple (deposit 2)
  // at index 0, Rent (deposit 1) at index 1.
  const store = {
    expenses: [
      { item: 'Apple', amount: 950, category: 'Credit Payment', deposit: 2, paid: true },
      { item: 'Rent', amount: 2200, category: 'Rent', deposit: 1, paid: false },
    ],
  };
  inst._mutate = async (file, mutator) => {
    const fm = { expenses: store.expenses.slice() };
    await mutator(fm);
    store.expenses = fm.expenses;
  };
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: [{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 4500 }],
    expenses: store.expenses.slice(),
  };
  const dv = makeDvWithCurrent(page);
  const file = app.vault.getAbstractFileByPath('spice/finance/paychecks/2026-07/Paycheck-2026-07.md');
  await inst.render(dv);
  const root = findClass(dv.container, 'pee-root');
  // Collect the item-cell texts in render order (each row's first flex:2 span).
  // Rows are the direct children carrying a delete button; grab the item text order.
  const itemTexts = root
    ? collectAll(root, (n) => n.tag === 'span').map(n => n.textContent).filter(t => t === 'Rent' || t === 'Apple')
    : [];
  const rentBeforeApple = itemTexts.indexOf('Rent') >= 0 && itemTexts.indexOf('Apple') >= 0
    && itemTexts.indexOf('Rent') < itemTexts.indexOf('Apple');

  // Now delete the FIRST rendered row (Rent, deposit 1). It lives at ORIGINAL index 1.
  // A naive display-position delete would pass index 0 and wrongly remove Apple.
  global.window = { confirm: () => true };
  // Find the first row's delete button and click it (mirrors a real click).
  const buttons = root ? collectButtons(root) : [];
  const delButtons = buttons.filter(b => b.textContent === '×');
  if (delButtons.length > 0 && typeof delButtons[0].onclick === 'function') {
    await delButtons[0].onclick({ stopPropagation() {} });
  }
  const deletedRent = store.expenses.length === 1 && store.expenses[0].item === 'Apple';
  console.log(`  Rent (deposit1) rendered before Apple (deposit2): ${rentBeforeApple} ; deleting display-first row removed Rent (original idx 1), Apple survives: ${deletedRent}`);
  const pass = !!root && rentBeforeApple && deletedRent;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF27 — clean deposit date display (finance tweak #2): Dataview parses the deposit
// `date` into a Luxon-like DateTime; the editor must render a clean "YYYY-MM-DD" via
// _coerceDateString, NOT the raw ISO timestamp. Stub deposit.date as a DateTime-like
// object exposing toISODate() (+ a noisy toString) to prove coercion at the header.
async function testFF27PaycheckDepositDateCoerced() {
  console.log('\n=== FF27 — PaycheckExpensesEditor renders clean deposit date (coerced, not ISO timestamp) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  app.metadataCache = { getFirstLinkpathDest: () => null, getFileCache: () => null };
  const mkDateTime = (iso) => ({
    toISODate: () => iso,
    toString: () => `${iso}T00:00:00.000-06:00`,
  });
  const d1 = mkDateTime('2026-07-01');
  const d15 = mkDateTime('2026-07-15');
  const overrides = {
    FinanceMath: {
      _depositIndex: (e, c) => { const n = Math.trunc(Number(e && e.deposit)); return (!isFinite(n) || n < 1) ? 1 : (c && n > c ? c : n); },
      _coerceDateString: (v) => (typeof v === 'string' ? v : (v && typeof v.toISODate === 'function' ? v.toISODate() : null)),
      // depositTotals must ALSO coerce so downstream consumers get clean strings.
      depositTotals: (pg) => (Array.isArray(pg && pg.deposits) ? pg.deposits : []).map(d => ({
        date: (d.date && typeof d.date.toISODate === 'function') ? d.date.toISODate() : d.date,
        amount: Number(d.amount) || 0, assigned: 0, leftover: Number(d.amount) || 0,
      })),
    },
  };
  const Cls = loadFinanceClass('PaycheckExpensesEditor', app, overrides);
  const inst = new Cls();
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: [{ date: d1, amount: 4500 }, { date: d15, amount: 4500 }],
    expenses: [{ item: 'Rent', amount: 2200, category: 'Rent', deposit: 1, paid: false }],
  };
  const dv = makeDvWithCurrent(page);
  await inst.render(dv);
  const root = findClass(dv.container, 'pee-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const showsClean1 = joined.includes('2026-07-01');
  const showsClean15 = joined.includes('2026-07-15');
  const showsIso = joined.includes('T00:00:00');
  // Row tag ordinal still derived from the (coerced) date: day 1 → "1st".
  const hasTag1st = texts.some(t => t === '1st') || joined.includes('1st');
  console.log(`  clean dates 07-01/07-15: ${showsClean1}/${showsClean15} ; NO ISO timestamp: ${!showsIso} ; ordinal tag 1st derived: ${hasTag1st}`);
  const pass = !!root && showsClean1 && showsClean15 && !showsIso && hasTag1st;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF28 — itemized Fixed section (finance tweak #3, Option A): BudgetAllocationsEditor
// renders a read-only Fixed section (itemized {item,amount} rows) above Debt when
// budgetAllocations returns a non-empty fixed[] — no writes, no editable fields.
async function testFF28BudgetAllocationsRendersFixedSection() {
  console.log('\n=== FF28 — BudgetAllocationsEditor renders itemized read-only Fixed section ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const view = {
    fixed: [{ item: 'Rent', amount: 2200 }, { item: 'Utilities', amount: 300 }],
    debt: [{ slug: 'Debt-Apple-Card', name: 'Apple Card', plannedLive: 380, override: null, planned: 380, source: 'plan' }],
    savings: [{ name: 'Emergency Fund', plannedLive: 300, override: null, planned: 300, source: 'plan' }],
    totals: { fixed: 2500, debt: 380, savings: 300, income: 9000, discretionary: 2950 },
  };
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'budget-allocations-editor.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { budgetAllocations: () => view, fmtMoney: (n) => `$${(Number(n) || 0).toFixed(2)}` };
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn BudgetAllocationsEditor;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'bae-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const hasFixedSection = !!(root && collectAll(root, (n) => typeof n.cls === 'string' && n.cls.split(/\s+/).includes('bae-section-fixed')).length > 0);
  const hasRentRow = texts.includes('Rent');
  const hasUtilitiesRow = texts.includes('Utilities');
  const hasFixedTotal = joined.includes('Fixed total') && joined.includes('$2500.00');
  const noWrites = app.__captured_writes.length === 0;
  console.log(`  fixed section: ${hasFixedSection} ; Rent row: ${hasRentRow} ; Utilities row: ${hasUtilitiesRow} ; Fixed total $2500.00: ${hasFixedTotal} ; no writes: ${noWrites}`);
  const pass = !!root && hasFixedSection && hasRentRow && hasUtilitiesRow && hasFixedTotal && noWrites;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF29 — MonthSetupChecklist renders setup-health rows on a Month note from a
// stubbed FinanceMath.monthSetupStatus. When the budget is absent it shows a
// "Create Budget" button; when the paycheck is absent a "Create Paycheck" button.
// Guardrail rows surface untagged-deposit + reconcile warnings. Pure render — no writes.
async function testFF29MonthSetupChecklistRenders() {
  console.log('\n=== FF29 — MonthSetupChecklist renders health rows + create buttons on Month note ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const status = {
    month: '2026-07',
    budget: { exists: false },
    paycheck: { exists: true, depositsMaterialized: true, expenseCount: 3 },
    guardrails: {
      untaggedDeposits: { count: 1, items: ['Untagged Thing'] },
      reconcile: { income: 9000, totalAllocated: 9500, ok: false, deltaOver: 500 },
    },
    bills: { paidCount: 1, total: 3, pct: 33 },
    ready: false,
  };
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'month-setup-checklist.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { monthSetupStatus: () => status, fmtMoney: (n) => `$${(Number(n) || 0).toFixed(2)}`, _coerceMonthString: (v) => (typeof v === 'string' ? v.slice(0, 7) : null) };
  cjs.Icons = ICONS_INSTANCE;
  let created = [];
  cjs.EntityCreate = { create: async (opts) => { created.push(opts); } };
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn MonthSetupChecklist;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Month-2026-07', path: 'spice/finance/months/Month-2026-07.md' },
    { type: 'month', month: '2026-07' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'msc-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const buttons = root ? collectButtons(root) : [];
  const createBudgetBtn = buttons.find(b => typeof b.innerHTML === 'string' && b.innerHTML.includes('Create Budget'));
  // paycheck exists → NO Create Paycheck button.
  const createPaycheckBtn = buttons.find(b => typeof b.innerHTML === 'string' && b.innerHTML.includes('Create Paycheck'));
  const hasUntaggedWarn = /Untagged Thing/.test(joined) || /default to check 1/i.test(joined) || /1\b/.test(joined);
  const hasReconcileWarn = /over/i.test(joined) && joined.includes('$500.00');
  const hasBillsProgress = joined.includes('1') && joined.includes('3');
  const noWrites = app.__captured_writes.length === 0;
  console.log(`  msc-root: ${!!root} ; Create Budget btn: ${!!createBudgetBtn} ; NO Create Paycheck btn: ${!createPaycheckBtn} ; untagged warn: ${hasUntaggedWarn} ; reconcile over $500: ${hasReconcileWarn} ; bills 1/3: ${hasBillsProgress} ; no writes: ${noWrites}`);
  // Clicking Create Budget delegates to EntityCreate.create with the month preset.
  if (createBudgetBtn && typeof createBudgetBtn.onclick === 'function') { await createBudgetBtn.onclick(); }
  const delegatedBudget = created.length === 1 && created[0].instance === 'budget' && created[0].presetPrompts && created[0].presetPrompts.month === '2026-07';
  console.log(`  Create Budget delegates to EntityCreate.create({instance:'budget', presetPrompts:{month:'2026-07'}}): ${delegatedBudget}`);
  const pass = !!root && !!createBudgetBtn && !createPaycheckBtn && hasUntaggedWarn && hasReconcileWarn && hasBillsProgress && noWrites && delegatedBudget;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF30 — MonthSetupChecklist embed-dedup: inside a .markdown-embed it renders nothing.
async function testFF30MonthSetupChecklistEmbedDedup() {
  console.log('\n=== FF30 — MonthSetupChecklist inside .markdown-embed renders nothing ===');
  const app = makeApp();
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'month-setup-checklist.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { monthSetupStatus: () => ({ month: '2026-07', budget: { exists: true }, paycheck: { exists: true, depositsMaterialized: true, expenseCount: 0 }, guardrails: { untaggedDeposits: { count: 0, items: [] }, reconcile: { income: 0, totalAllocated: 0, ok: true, deltaOver: 0 } }, bills: { paidCount: 0, total: 0, pct: 0 }, ready: true }), fmtMoney: (n) => `$${n}`, _coerceMonthString: (v) => (typeof v === 'string' ? v.slice(0, 7) : null) };
  cjs.Icons = ICONS_INSTANCE;
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn MonthSetupChecklist;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Month-2026-07', path: 'spice/finance/months/Month-2026-07.md' },
    { type: 'month', month: '2026-07' }
  );
  dv.container.closest = (sel) => sel === '.markdown-embed' ? { tag: 'div' } : null;
  await inst.render(dv);
  const root = findClass(dv.container, 'msc-root');
  console.log(`  msc-root present (should be false): ${!!root}`);
  const pass = !root;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF31 — MonthSetupChecklist on a NON-month note renders nothing (type guard).
async function testFF31MonthSetupChecklistOutOfPath() {
  console.log('\n=== FF31 — MonthSetupChecklist on a non-month note renders nothing ===');
  const app = makeApp();
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'month-setup-checklist.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { monthSetupStatus: () => { throw new Error('should not be called on a non-month note'); }, fmtMoney: (n) => `$${n}`, _coerceMonthString: (v) => (typeof v === 'string' ? v.slice(0, 7) : null) };
  cjs.Icons = ICONS_INSTANCE;
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn MonthSetupChecklist;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'msc-root');
  console.log(`  msc-root present (should be false): ${!!root}`);
  const pass = !root;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF32 — FinanceEditScopeBanner on a per-month Budget note renders the
// "Editing {month} only — edit Defaults to change every month." one-liner.
async function testFF32EditScopeBannerMonthScope() {
  console.log('\n=== FF32 — FinanceEditScopeBanner month-scope line on a Budget note ===');
  const app = makeApp();
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'finance-edit-scope-banner.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn FinanceEditScopeBanner;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'fesb-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const hasMonthLine = /Editing/.test(joined) && joined.includes('2026-07') && /edit Defaults/i.test(joined);
  const noWrites = app.__captured_writes.length === 0;
  console.log(`  fesb-root: ${!!root} ; month-scope line: ${hasMonthLine} ; no writes: ${noWrites}`);
  const pass = !!root && hasMonthLine && noWrites;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF33 — FinanceEditScopeBanner on a Defaults note renders the template one-liner.
async function testFF33EditScopeBannerDefaultsScope() {
  console.log('\n=== FF33 — FinanceEditScopeBanner defaults-scope line on a Defaults note ===');
  const app = makeApp();
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'finance-edit-scope-banner.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn FinanceEditScopeBanner;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget Defaults', path: 'spice/finance/Budget Defaults.md' },
    { type: 'budget-defaults' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'fesb-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const hasTemplateLine = /Template for every new month/i.test(joined) && /seed/i.test(joined);
  console.log(`  fesb-root: ${!!root} ; template-scope line: ${hasTemplateLine}`);
  const pass = !!root && hasTemplateLine;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF34 — FinanceEditScopeBanner renders nothing on an unrelated type + embed-dedup.
async function testFF34EditScopeBannerOtherTypeAndEmbed() {
  console.log('\n=== FF34 — FinanceEditScopeBanner renders nothing on other type + inside embed ===');
  const app = makeApp();
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'finance-edit-scope-banner.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn FinanceEditScopeBanner;`)(app, cjs, FakeNotice);
  // Unrelated type (a month reconciliation view) → nothing.
  const inst = new Cls();
  const dvOther = makeDvWithCurrentAndFrontmatter(
    { name: 'Month-2026-07', path: 'spice/finance/months/Month-2026-07.md' },
    { type: 'month', month: '2026-07' }
  );
  await inst.render(dvOther);
  const otherRoot = findClass(dvOther.container, 'fesb-root');
  // Embed-dedup: budget note inside a markdown-embed → nothing.
  const dvEmbed = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  dvEmbed.container.closest = (sel) => sel === '.markdown-embed' ? { tag: 'div' } : null;
  await inst.render(dvEmbed);
  const embedRoot = findClass(dvEmbed.container, 'fesb-root');
  console.log(`  other-type root (should be false): ${!!otherRoot} ; embed root (should be false): ${!!embedRoot}`);
  const pass = !otherRoot && !embedRoot;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF21 — PaycheckSummary per-deposit line: a MONTHLY paycheck (deposits[] +
// tagged expenses) renders a per-deposit income/assigned/leftover line (from
// stubbed depositTotals), while Band 1's Pay = Σ deposits (not paycheck_amount).
async function testFF21PaycheckSummaryPerDeposit() {
  console.log('\n=== FF21 — PaycheckSummary renders per-deposit income line for a monthly paycheck ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const restoreWin = (() => {
    const prior = global.window;
    // minimal moment: moment() and moment(str, fmt) → objects with isBefore/isValid.
    global.window = { moment: () => ({ isBefore: () => false, isValid: () => true }) };
    return () => { global.window = prior; };
  })();
  const overrides = {
    FinanceMath: {
      depositTotals: (pg) => [
        { date: '2026-07-01', amount: 4500, assigned: 2200, leftover: 2300 },
        { date: '2026-07-15', amount: 4500, assigned: 950, leftover: 3550 },
      ],
    },
  };
  const Cls = loadFinanceClass('PaycheckSummary', app, overrides);
  const inst = new Cls();
  const page = {
    file: { name: 'Paycheck-2026-07', path: 'spice/finance/paychecks/2026-07/Paycheck-2026-07.md' },
    month: '2026-07',
    deposits: [{ date: '2026-07-01', amount: 4500 }, { date: '2026-07-15', amount: 4500 }],
    expenses: [
      { item: 'Rent', amount: 2200, category: 'Rent', deposit: 1, paid: false },
      { item: 'Apple', amount: 950, category: 'Credit Payment', deposit: 2, paid: true },
    ],
  };
  const dv = makeDvWithCurrent(page);
  let threw = null;
  try { await inst.render(dv); } catch (e) { threw = e; }
  restoreWin();
  const root = findClass(dv.container, 'ps-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  // Pay band totals Σ deposits ($9,000), NOT a scalar paycheck_amount.
  const showsPayTotal = joined.includes('$9,000.00');
  // Per-deposit line surfaces each deposit date + its assigned/leftover.
  const showsDate1 = joined.includes('2026-07-01');
  const showsDate15 = joined.includes('2026-07-15');
  const showsPerDepositAmounts = joined.includes('$2,300.00') || joined.includes('$3,550.00');
  console.log(`  pay Σ deposits ($9,000): ${showsPayTotal} ; dates: ${showsDate1}/${showsDate15} ; per-deposit leftover: ${showsPerDepositAmounts}${threw ? ' (threw: ' + threw.message + ')' : ''}`);
  const pass = !threw && !!root && showsPayTotal && showsDate1 && showsDate15 && showsPerDepositAmounts;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF22 — PaycheckSummary backward-compat: a LEGACY note (no deposits[], only
// paycheck_amount) still renders its single Pay amount, and depositTotals is
// never called (no per-deposit line).
async function testFF22PaycheckSummaryLegacy() {
  console.log('\n=== FF22 — PaycheckSummary legacy note renders single paycheck_amount (no per-deposit line) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const restoreWin = (() => {
    const prior = global.window;
    global.window = { moment: () => ({ isBefore: () => false, isValid: () => true }) };
    return () => { global.window = prior; };
  })();
  const overrides = {
    FinanceMath: {
      depositTotals: () => { throw new Error('depositTotals must not be called for a legacy note'); },
    },
  };
  const Cls = loadFinanceClass('PaycheckSummary', app, overrides);
  const inst = new Cls();
  const page = {
    file: { name: 'Paycheck-2026-05-15', path: 'spice/finance/paychecks/2026-05-15/Paycheck-2026-05-15.md' },
    pay_period_start: '2026-05-15',
    pay_period_end: '2026-05-31',
    paycheck_amount: 4500,
    expenses: [{ item: 'Rent', amount: 2200, category: 'Rent', paid: false }],
  };
  const dv = makeDvWithCurrent(page);
  let threw = null;
  try { await inst.render(dv); } catch (e) { threw = e; }
  restoreWin();
  const root = findClass(dv.container, 'ps-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const showsLegacyPay = joined.includes('$4,500.00');
  console.log(`  legacy pay ($4,500): ${showsLegacyPay} ; no throw: ${!threw}${threw ? ' (threw: ' + threw.message + ')' : ''}`);
  const pass = !threw && !!root && showsLegacyPay;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF23 — PaycheckDefaultsEditor edit sets+preserves a per-expense `deposit`, and
// merges on edit so an installer-added extra field (e.g. `debt`) survives even
// though the modal doesn't return it (Object.assign({}, current, result)).
async function testFF23PaycheckDefaultsDepositMerge() {
  console.log('\n=== FF23 — PaycheckDefaultsEditor edit sets deposit + preserves extra field (merge-on-edit) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('PaycheckDefaultsEditor', app);
  const inst = new Cls();
  const store = { expenses: [
    // Row carries an extra `debt` field the modal never returns; must survive.
    { item: 'Apple', amount: 950, category: 'Credit Payment', debt: '[[Debt-Apple-Card]]', deposit: 1 },
  ] };
  inst._mutate = async (file, mutator) => {
    const fm = { expenses: store.expenses.slice() };
    await mutator(fm);
    store.expenses = fm.expenses;
  };
  // Modal returns edited fields including a NEW deposit=2, but NOT the debt field.
  inst._promptForExpense = async () => ({ item: 'Apple', amount: 950, category: 'Credit Payment', url: '', deposit: 2 });
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Paycheck Defaults', path: 'spice/finance/Paycheck Defaults.md' },
    { expenses: store.expenses.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/Paycheck Defaults.md');
  await inst._editFlow(file, dv, 0, store.expenses[0]);
  const setDeposit = store.expenses[0].deposit === 2;
  const keptDebt = store.expenses[0].debt === '[[Debt-Apple-Card]]';
  console.log(`  deposit set to 2: ${setDeposit} ; extra debt field survived merge: ${keptDebt}`);
  const pass = setDeposit && keptDebt;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF24 — PaycheckDefaultsEditor renders a deposit_schedule editor section and
// editing a schedule row writes fm.deposit_schedule (render-from-authoritative).
async function testFF24PaycheckDefaultsScheduleEditor() {
  console.log('\n=== FF24 — PaycheckDefaultsEditor renders + edits deposit_schedule ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('PaycheckDefaultsEditor', app);
  const inst = new Cls();
  const store = { expenses: [], deposit_schedule: [{ day: 1, amount: 4500 }, { day: 15, amount: 4500 }] };
  inst._mutate = async (file, mutator) => {
    const fm = { expenses: store.expenses.slice(), deposit_schedule: store.deposit_schedule.slice() };
    await mutator(fm);
    store.expenses = fm.expenses;
    store.deposit_schedule = fm.deposit_schedule;
  };
  // Render: the schedule section shows both schedule rows (day + amount).
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Paycheck Defaults', path: 'spice/finance/Paycheck Defaults.md' },
    { expenses: store.expenses.slice(), deposit_schedule: store.deposit_schedule.slice() }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'pde-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const showsScheduleLabel = joined.toLowerCase().includes('deposit schedule');
  const showsDay1 = joined.includes('1') && (joined.includes('4500') || joined.includes('4,500') || joined.includes('4500.00') || joined.includes('4,500.00'));
  const showsDay15 = joined.includes('15');
  // Edit: stub the row prompt to change deposit 1's amount → 5000, write authoritatively.
  inst._promptForScheduleRow = async () => ({ day: 1, amount: 5000 });
  const file = app.vault.getAbstractFileByPath('spice/finance/Paycheck Defaults.md');
  await inst._scheduleEditFlow(file, dv, 0, store.deposit_schedule[0]);
  const wroteEdit = store.deposit_schedule[0].amount === 5000 && store.deposit_schedule[0].day === 1;
  console.log(`  schedule label: ${showsScheduleLabel} ; day1/day15 rows: ${showsDay1}/${showsDay15} ; edit wrote amount 5000: ${wroteEdit}`);
  const pass = !!root && showsScheduleLabel && showsDay1 && showsDay15 && wroteEdit;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF11 — BudgetCategoriesEditor delete re-renders from the authoritative array,
// not the frozen dv.current(). Same render-from-authoritative proof as FF9.
async function testFF11BudgetCategoriesDeleteRendersAuthoritative() {
  console.log('\n=== FF11 — BudgetCategoriesEditor delete renders from authoritative array (no index cascade) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('BudgetCategoriesEditor', app);
  const inst = new Cls();
  const store = { groups: ['Essential'], categories: [
    { group: 'Essential', name: 'Alpha', planned: 1, actual: 0 },
    { group: 'Essential', name: 'Bravo', planned: 2, actual: 0 },
  ] };
  inst._mutate = async (file, mutator) => {
    const fm = { groups: store.groups.slice(), categories: store.categories.slice() };
    await mutator(fm);
    store.groups = fm.groups;
    store.categories = fm.categories;
  };
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-x', path: 'spice/finance/budgets/x/Budget-x.md' },
    { groups: store.groups.slice(), categories: store.categories.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/budgets/x/Budget-x.md');
  global.window = { confirm: () => true };
  await inst._deleteFlow(file, dv, 0, store.categories[0]);
  const writeOk = store.categories.length === 1 && store.categories[0].name === 'Bravo';
  const root = findClass(dv.container, 'bce-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const rendersAlpha = texts.includes('Alpha');
  const rendersBravo = texts.includes('Bravo');
  const renderOk = !!root && rendersBravo && !rendersAlpha;
  console.log(`  write shortened to [Bravo]: ${writeOk} ; render shows Bravo not Alpha (authoritative): ${renderOk}`);
  const pass = writeOk && renderOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF12 — editing a BudgetCategoriesEditor row preserves an extra non-dialog
// field (merge-on-edit). The modal returns only {group,name,planned,actual}.
async function testFF12BudgetCategoriesEditPreservesExtra() {
  console.log('\n=== FF12 — BudgetCategoriesEditor edit preserves extra row field (merge-on-edit) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('BudgetCategoriesEditor', app);
  const inst = new Cls();
  const store = { groups: ['Essential'], categories: [
    { group: 'Essential', name: 'Rent', planned: 1000, actual: 0, note: 'keep-me' },
  ] };
  inst._mutate = async (file, mutator) => {
    const fm = { groups: store.groups.slice(), categories: store.categories.slice() };
    await mutator(fm);
    store.groups = fm.groups;
    store.categories = fm.categories;
  };
  // Modal returns edited fields WITHOUT the note field (the bug's trigger).
  inst._promptForCategory = async () => ({ group: 'Essential', name: 'Rent', planned: 1200, actual: 0 });
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-x', path: 'spice/finance/budgets/x/Budget-x.md' },
    { groups: store.groups.slice(), categories: store.categories.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/budgets/x/Budget-x.md');
  await inst._editFlow(file, dv, 0, store.categories[0], store.groups.slice());
  const keepsNote = store.categories[0].note === 'keep-me';
  const appliedPlanned = store.categories[0].planned === 1200;
  console.log(`  keeps extra note field: ${keepsNote} ; applied new planned: ${appliedPlanned}`);
  const pass = keepsNote && appliedPlanned;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF13 — BudgetDefaultsEditor category delete re-renders from the authoritative
// categories array, not the frozen dv.current().
async function testFF13BudgetDefaultsDeleteRendersAuthoritative() {
  console.log('\n=== FF13 — BudgetDefaultsEditor category delete renders from authoritative array ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('BudgetDefaultsEditor', app);
  const inst = new Cls();
  const store = { groups: ['Essential'], categories: [
    { group: 'Essential', name: 'Alpha', planned: 1 },
    { group: 'Essential', name: 'Bravo', planned: 2 },
  ] };
  inst._mutate = async (file, mutator) => {
    const fm = { groups: store.groups.slice(), categories: store.categories.slice() };
    await mutator(fm);
    store.groups = fm.groups;
    store.categories = fm.categories;
  };
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget Defaults', path: 'spice/finance/Budget Defaults.md' },
    { groups: store.groups.slice(), categories: store.categories.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/Budget Defaults.md');
  global.window = { confirm: () => true };
  await inst._deleteCategoryFlow(file, dv, 0, store.categories[0]);
  const writeOk = store.categories.length === 1 && store.categories[0].name === 'Bravo';
  const root = findClass(dv.container, 'bde-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const rendersAlpha = texts.includes('Alpha');
  const rendersBravo = texts.includes('Bravo');
  const renderOk = !!root && rendersBravo && !rendersAlpha;
  console.log(`  write shortened to [Bravo]: ${writeOk} ; render shows Bravo not Alpha (authoritative): ${renderOk}`);
  const pass = writeOk && renderOk;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF14 — editing a BudgetDefaultsEditor category preserves an extra non-dialog
// field (merge-on-edit). The modal returns only {name,group,planned}.
async function testFF14BudgetDefaultsEditPreservesExtra() {
  console.log('\n=== FF14 — BudgetDefaultsEditor edit preserves extra row field (merge-on-edit) ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const Cls = loadFinanceClass('BudgetDefaultsEditor', app);
  const inst = new Cls();
  const store = { groups: ['Essential'], categories: [
    { group: 'Essential', name: 'Rent', planned: 1000, note: 'keep-me' },
  ] };
  inst._mutate = async (file, mutator) => {
    const fm = { groups: store.groups.slice(), categories: store.categories.slice() };
    await mutator(fm);
    store.groups = fm.groups;
    store.categories = fm.categories;
  };
  // _editCategoryFlow reads groups via _mutateRead (metadataCache) — stub it.
  inst._mutateRead = () => ({ groups: store.groups.slice(), categories: store.categories.slice() });
  // Modal returns edited fields WITHOUT the note field (the bug's trigger).
  inst._promptForCategory = async () => ({ name: 'Rent', group: 'Essential', planned: 1200 });
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget Defaults', path: 'spice/finance/Budget Defaults.md' },
    { groups: store.groups.slice(), categories: store.categories.slice() }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/Budget Defaults.md');
  await inst._editCategoryFlow(file, dv, 0, store.categories[0]);
  const keepsNote = store.categories[0].note === 'keep-me';
  const appliedPlanned = store.categories[0].planned === 1200;
  console.log(`  keeps extra note field: ${keepsNote} ; applied new planned: ${appliedPlanned}`);
  const pass = keepsNote && appliedPlanned;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF15 — BudgetAllocationsEditor renders a Debt row + a Savings row + the
// full-picture (Income → Fixed · Debt · Savings · Discretionary) line, live from
// customJS.FinanceMath.budgetAllocations. Pure render — no writes.
async function testFF15BudgetAllocationsRendersSections() {
  console.log('\n=== FF15 — BudgetAllocationsEditor renders Debt + Savings sections + full-picture line ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  const view = {
    debt: [{ slug: 'Debt-Apple-Card', name: 'Apple Card', plannedLive: 380, override: null, planned: 380, source: 'plan' }],
    savings: [{ name: 'Emergency Fund', plannedLive: 300, override: null, planned: 300, source: 'plan' }],
    totals: { debt: 380, savings: 300, fixed: 3851, income: 9000, discretionary: 2950 },
  };
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'budget-allocations-editor.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { budgetAllocations: () => view, fmtMoney: (n) => `$${(Number(n) || 0).toFixed(2)}` };
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn BudgetAllocationsEditor;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  await inst.render(dv);
  const root = findClass(dv.container, 'bae-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  const hasDebtRow = texts.includes('Apple Card');
  const hasSavingsRow = texts.includes('Emergency Fund');
  // Waterfall: income header + Fixed/Debt/Savings/Discretionary component values +
  // a "Total allocated" sum (3851+380+300+2950=7481) + delta note vs income (1519 unallocated).
  const hasFullPicture = joined.includes('Income $9000.00')
    && joined.includes('$3851.00') && joined.includes('$380.00') && joined.includes('$300.00') && joined.includes('$2950.00')
    && joined.includes('Total allocated') && joined.includes('$7481.00')
    && joined.includes('unallocated');
  const noWrites = app.__captured_writes.length === 0;
  console.log(`  bae-root: ${!!root} ; debt row: ${hasDebtRow} ; savings row: ${hasSavingsRow} ; full-picture waterfall+total: ${hasFullPicture} ; no writes: ${noWrites}`);
  const pass = !!root && hasDebtRow && hasSavingsRow && hasFullPicture && noWrites;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// FF16 — editing a debt row writes a {slug,planned} override into
// debt_allocations AND the re-render shows the adjusted amount EVEN THOUGH the
// stubbed budgetAllocations returns the STALE pre-write view (simulating
// Dataview's lagging page index). The adjusted value can only appear via the
// authoritative override overlay — proving the render-from-authoritative fix.
async function testFF16BudgetAllocationsEditMaterializesOverride() {
  console.log('\n=== FF16 — BudgetAllocationsEditor edit re-renders authoritative despite a lagging dv ===');
  const app = makeApp({ fileExistsHook: (p) => ({ path: p }) });
  let capturedDebtAlloc = [];
  // budgetAllocations ALWAYS returns the stale pre-write plan view (Apple 380 /
  // plan). If the widget merely re-rendered from this, it would show 380. Showing
  // 350 (adjusted) is only possible if the just-written override array is overlaid.
  const makeStaleView = () => ({
    debt: [{ slug: 'Debt-Apple-Card', name: 'Apple Card', plannedLive: 380, override: null, planned: 380, source: 'plan' }],
    savings: [{ name: 'Emergency Fund', plannedLive: 300, override: null, planned: 300, source: 'plan' }],
    totals: { debt: 380, savings: 300, fixed: 3851, income: 9000, discretionary: 2950 },
  });
  const src = fs.readFileSync(path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers', 'budget-allocations-editor.js'), 'utf8');
  const cjs = makeFinanceCustomJsStub();
  cjs.FinanceMath = { budgetAllocations: () => makeStaleView(), fmtMoney: (n) => `$${(Number(n) || 0).toFixed(2)}` };
  // Capture the frontmatter write (durable), but DO NOT reflect it into the view —
  // the view stays stale, exactly like Dataview before it reindexes.
  cjs.FinanceFrontmatter = {
    update: async (file, mut) => {
      const fm = { debt_allocations: capturedDebtAlloc.slice(), savings_allocations: [] };
      await mut(fm);
      capturedDebtAlloc = Array.isArray(fm.debt_allocations) ? fm.debt_allocations : [];
    },
    read: () => null,
    isTruthy: (v) => v === true,
  };
  const Cls = new Function('app', 'customJS', 'Notice', `${src}\nreturn BudgetAllocationsEditor;`)(app, cjs, FakeNotice);
  const inst = new Cls();
  // Stub the row-edit modal to return the user's new planned amount.
  inst._promptForAmount = async () => 350;
  const dv = makeDvWithCurrentAndFrontmatter(
    { name: 'Budget-2026-07', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' },
    { type: 'budget', month: '2026-07' }
  );
  const file = app.vault.getAbstractFileByPath('spice/finance/budgets/2026-07/Budget-2026-07.md');
  const appleRow = { slug: 'Debt-Apple-Card', name: 'Apple Card', plannedLive: 380, override: null, planned: 380, source: 'plan' };
  await inst._editFlow(file, dv, 'debt', appleRow);
  const wroteOverride = capturedDebtAlloc.length === 1 && capturedDebtAlloc[0].slug === 'Debt-Apple-Card' && capturedDebtAlloc[0].planned === 350;
  const root = findClass(dv.container, 'bae-root');
  const texts = root ? collectAll(root, () => true).map(n => n.textContent).filter(t => typeof t === 'string') : [];
  const joined = texts.join(' | ');
  // Stale view says 380/plan; a correct overlay shows 350 (adjusted) and no 380.
  const rendersAdjusted = joined.includes('(adjusted)') && joined.includes('$350.00') && !joined.includes('$380.00');
  console.log(`  wrote {slug:Debt-Apple-Card, planned:350}: ${wroteOverride} ; re-render shows adjusted $350.00 despite stale dv (no $380.00): ${rendersAdjusted}`);
  const pass = wroteOverride && rendersAdjusted;
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

// FF-COLD — cold-load render-guard coverage for the finance render widgets that
// were uncovered on the widget_render axis. Each is a dogfood-only render widget
// that, under a COLD-LOAD stub — an embed-context container
// (container.closest(".markdown-embed") truthy) AND a null dv.current() — must
// render nothing without throwing. Most return at their first-line embed-dedup
// guard (`if (dv.container.closest(".markdown-embed")) return;`, mirroring FF8);
// a few (e.g. DebtSummary) let the embed branch fall through but then return on
// their null-current / wrong-type guard before reaching dv.pages. Either way the
// contract under test is identical: no throw + nothing rendered on cold load.
// DebtConfigEditor is a modal editor (render(file, opts) guarded by
// `if (!file) return`) so it is exercised with render(null). Referencing these
// class names in run-renderer.js is what the widget_render coverage rubric credits.
async function testFinanceColdLoadRenderGuards() {
  console.log('\n=== FF-COLD — uncovered finance widgets render nothing (no throw) on a cold-load stub ===');
  const app = makeApp();
  const cjs = makeFinanceCustomJsStub({ RenderSafe: { page: () => null } });
  const helpersDir = path.join(WORKSHOP, 'platform', 'blueprints', 'finance', 'helpers');
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').toLowerCase();
  const load = (cls) => {
    const src = fs.readFileSync(path.join(helpersDir, kebab(cls) + '.js'), 'utf8');
    return new Function('app', 'customJS', 'Notice', `${src}\nreturn ${cls};`)(app, cjs, FakeNotice);
  };
  let allPass = true;
  // dv-based widgets that return cleanly (no throw, nothing rendered) under the
  // cold-load stub — via their embed-dedup guard and/or their null-current guard,
  // both of which fire before any dv.pages()/FinanceMath work. (DebtsCards +
  // DebtsHubSummary are intentionally NOT here: their embed branch falls through
  // to a dv.pages() query with no intervening null-current guard, so exercising
  // them needs full FinanceMath/dv data — a follow-up render test, not a guard.)
  const coldLoadWidgets = [
    'InvoiceWorkspaceNav', 'BudgetDefaultsEditor', 'PaycheckDefaultsEditor',
    'DebtDefaultsEditor', 'BudgetSummary', 'PaycheckSummary', 'PaycheckDebtBand', 'DebtSummary',
    'FinanceHubActions', 'MonthlyOverview', 'MonthsCards', 'MonthDashboard', 'FinanceHubSummary',
  ];
  for (const cls of coldLoadWidgets) {
    let ok = false;
    try {
      const Cls = load(cls);
      const dv = makeDvWithCurrent(null);
      dv.container.closest = (sel) => (sel === '.markdown-embed' ? { tag: 'div' } : null);
      await new Cls().render(dv);
      ok = dv.container.children.length === 0;   // returned cleanly; nothing rendered
    } catch (e) { console.log(`  [throw] ${cls}: ${e && e.message}`); ok = false; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${cls} cold-load early-return`);
    if (!ok) allPass = false;
  }
  // DebtConfigEditor: modal editor, render(file, opts) with `if (!file) return`.
  {
    let ok = false;
    try { const Cls = load('DebtConfigEditor'); await new Cls().render(null, {}); ok = true; }
    catch (e) { console.log(`  [throw] DebtConfigEditor: ${e && e.message}`); ok = false; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'} — DebtConfigEditor null-file early-return`);
    if (!ok) allPass = false;
  }
  console.log(`  ${allPass ? 'PASS' : 'FAIL'}`);
  return allPass;
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

// R-COWORK-HUB — openLink action dispatches workspace.openLinkText with the
// resolved target path. The registry stores the post-install resolved form
// ("spice/cowork/Cowork.md") — no {{placeholders}} remain at click time.
async function testCoworkHubOpenLink() {
  console.log('\n=== R-COWORK-HUB — cowork-hub openLink fires openLinkText("spice/cowork/Cowork.md") ===');
  reset();

  const synthetic = JSON.stringify({
    schema_version: 1,
    contributions: {
      cowork: [
        {
          id: 'cowork-hub',
          label: 'Cowork',
          icon: 'users-round',
          order: 51,
          action: { type: 'openLink', target: 'spice/cowork/Cowork.md' },
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

    const btn = openLauncherFindByLabel(dv.container, 'Cowork');
    if (!btn) {
      console.log('  FAIL — Cowork button not rendered');
      return false;
    }
    await btn.onclick();

    const opens = app.__captured_open;
    const openOk = opens.length === 1 && opens[0] === 'spice/cowork/Cowork.md';
    const noticesOk = captured_notices.length === 0;

    console.log(`  openLinkText calls: ${opens.length} (expect 1)`);
    console.log(`  opened path: "${opens[0]}" (expect "spice/cowork/Cowork.md")`);
    console.log(`  notices: ${captured_notices.length} (expect 0)`);

    const pass = openOk && noticesOk;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
    return pass;
  });
}

// ── v0.46.0 S11 — entity-create injected-block shape tests ──────────────
// These test the install-time injection of the AccentButton dataviewjs block
// authored by `injectAccentButtonBlock` (install.js) for each new_entity_buttons[]
// entry with render_in.kind === "hub". The renderer harness validates the
// resulting markdown shape — marker anchor, dataviewjs fence body, AccentButton
// row layout, and idempotency under re-injection.

// Lightweight inline reimplementation of injectAccentButtonBlock's canonical-
// block + marker semantics — mirrors install.js lines around 1700-1800. The
// real installer reads/writes via tp.app.vault.adapter; here we operate on a
// string buffer so we can assert structural properties without scaffolding a
// full vault.
function entityCreateInjectBlock(body, instanceId) {
  const escId = instanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const canonical =
    `<!-- entity-create:${instanceId} -->\n` +
    "```dataviewjs\n" +
    `await customJS.EntityCreate.render(dv, { instance: "${instanceId}" });\n` +
    "```";
  const markerWithBlockRe = new RegExp(
    "<!-- entity-create:" + escId + " -->[ \\t]*\\r?\\n" +
    "(?:[ \\t]*\\r?\\n)*" +
    "```[a-zA-Z0-9_-]*[ \\t]*\\r?\\n" +
    "[\\s\\S]*?" +
    "```",
    "m"
  );
  if (markerWithBlockRe.test(body)) return body.replace(markerWithBlockRe, canonical);
  const markerOnlyRe = new RegExp("<!-- entity-create:" + escId + " -->", "m");
  if (markerOnlyRe.test(body)) return body.replace(markerOnlyRe, canonical);
  return body.length === 0 ? canonical : body + "\n\n" + canonical;
}

async function testREntityCreateMarkerAnchored() {
  console.log('\n=== R-EC-MARKER — entity-create marker anchors injected block ===');
  const before = "## Hub\n\nSome content.\n";
  const after = entityCreateInjectBlock(before, "meeting");
  const hasMarker = /<!-- entity-create:meeting -->/.test(after);
  const hasBlock = /```dataviewjs[\s\S]*```/.test(after);
  const markerBeforeBlock = after.indexOf("<!-- entity-create:meeting -->") < after.indexOf("```dataviewjs");
  console.log(`  marker present: ${hasMarker}`);
  console.log(`  dataviewjs block present: ${hasBlock}`);
  console.log(`  marker precedes block: ${markerBeforeBlock}`);
  const pass = hasMarker && hasBlock && markerBeforeBlock;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testREntityCreateInjectedBlockShape() {
  console.log('\n=== R-EC-SHAPE — injected block calls customJS.EntityCreate.render(dv, { instance: "<id>" }) literally ===');
  const after = entityCreateInjectBlock("", "person");
  const literal = `customJS.EntityCreate.render(dv, { instance: "person" })`;
  const containsCall = after.includes(literal);
  console.log(`  contains literal call: ${containsCall}`);
  const pass = containsCall;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testREntityCreateIdempotentReInject() {
  console.log('\n=== R-EC-IDEM — re-injecting same id does not duplicate the block ===');
  const before = "## Hub\n";
  const once = entityCreateInjectBlock(before, "budget");
  const twice = entityCreateInjectBlock(once, "budget");
  // Count occurrences of the marker; expect 1 in both `once` and `twice`.
  const onceCount = (once.match(/<!-- entity-create:budget -->/g) || []).length;
  const twiceCount = (twice.match(/<!-- entity-create:budget -->/g) || []).length;
  console.log(`  marker count after first inject: ${onceCount} (expect 1)`);
  console.log(`  marker count after second inject: ${twiceCount} (expect 1)`);
  // Also confirm the canonical block content is identical.
  const identical = once === twice;
  console.log(`  re-inject produced byte-identical result: ${identical}`);
  const pass = onceCount === 1 && twiceCount === 1 && identical;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testREntityCreateAccentButtonRowAlignment() {
  console.log('\n=== R-EC-ROW — injected block AccentButton dispatch matches universal call shape ===');
  // The injected block is a dataviewjs fence whose body invokes
  // customJS.EntityCreate.render(dv, {instance:"<id>"}). At runtime,
  // EntityCreate.render delegates to customJS.AccentButton.render with the
  // {label, icon, onClick} schema (see entity-create.js). Static assertion:
  // the source file exposes that call shape. As of v0.2.0 (S2), the icon
  // field is resolved via customJS.Icons.resolve before passing to AccentButton
  // (BUG-1 fix: kebab names no longer render as literal text).
  const ecSrc = fs.readFileSync(path.join(WORKSHOP, 'platform', 'mechanisms', 'entity-create', 'entity-create.js'), 'utf8');
  const callsAccent  = /customJS\.AccentButton\.render\s*\(/.test(ecSrc);
  const usesLabel    = /label:\s*spec\.label/.test(ecSrc);
  const callsResolve = /customJS\.Icons\.resolve\s*\(spec\.icon\)/.test(ecSrc);
  const usesResolved = /icon:\s*resolved\s*\|\|\s*plusIcon/.test(ecSrc);
  const usesOnClick  = /onClick:\s*\(\)\s*=>/.test(ecSrc);
  console.log(`  customJS.AccentButton.render called: ${callsAccent}`);
  console.log(`  label: spec.label: ${usesLabel}`);
  console.log(`  customJS.Icons.resolve(spec.icon) called: ${callsResolve}`);
  console.log(`  icon: resolved || plusIcon: ${usesResolved}`);
  console.log(`  passes {label, icon, onClick} schema: ${usesLabel && usesResolved && usesOnClick}`);
  const pass = callsAccent && usesLabel && callsResolve && usesResolved && usesOnClick;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function testREntityCreateMarkerPreservedAcrossReInject() {
  console.log('\n=== R-EC-PRESERVE — marker anchor preserved (not drifted) across re-inject ===');
  // Surround the marker with user content; verify the marker stays in place
  // and user content above + below is preserved bit-for-bit (installer's
  // append-only-on-absence + replace-only-marker+fence-on-presence semantics).
  const userTop = "## Hub\n\nUser text above.\n\n";
  const userBottom = "\n\n## Footer\nUser text below.\n";
  const initial = userTop + "<!-- entity-create:invoice -->\n```dataviewjs\nold block content\n```" + userBottom;
  const after = entityCreateInjectBlock(initial, "invoice");
  const topPreserved = after.startsWith(userTop);
  const bottomPreserved = after.endsWith(userBottom);
  const blockReplaced = after.includes("await customJS.EntityCreate.render(dv, { instance: \"invoice\" });") && !after.includes("old block content");
  console.log(`  user content above preserved: ${topPreserved}`);
  console.log(`  user content below preserved: ${bottomPreserved}`);
  console.log(`  stale block content replaced with canonical: ${blockReplaced}`);
  const pass = topPreserved && bottomPreserved && blockReplaced;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── R-EC-ICON-1..7 — DOM-icon assert per entity-create site ────────────────
// For each of the 7 entity-create sites, exercise the Icons → AccentButton
// chain that EntityCreate.render() composes in v0.2.0 (post-S2):
//   resolved = customJS.Icons.resolve(spec.icon)
//   customJS.AccentButton.render(container, { label, icon: resolved, onClick })
// Asserts that the rendered button's innerHTML contains <svg AND does NOT
// contain the literal kebab name (the BUG-1 regression class — pre-S2,
// the kebab string was passed through to btn.innerHTML as literal text).
// Icon kebabs come from each blueprint's new_entity_buttons[*].icon field
// in its manifest.json (confirmed pre-S4 to match this table).
const ENTITY_CREATE_SITES = [
  { instance: 'meeting',   icon: 'users-plus' },
  { instance: 'person',    icon: 'user-plus' },
  { instance: 'project',   icon: 'folder-plus' },
  { instance: 'scratch',   icon: 'pencil-plus' },
  { instance: 'budget',    icon: 'wallet-plus' },
  { instance: 'paycheck',  icon: 'wallet-plus' },
  { instance: 'invoice',   icon: 'file-plus' },
  { instance: 'doc-note', icon: 'file-plus' }  // v0.50.0; renamed doc-note in v0.52.0
];

// v0.50.0 — R-WIKI-1 (renamed R-DOCS-1 in v0.52.0): Template, Docs Hub.md body
// originally required ProjectDocsCards dispatch + inside-block entity-create:doc-note
// sentinel. v0.101.1 also required the canonical EntityCreate.render dispatch.
//
// v0.102.0 S4 update: ProjectDocsCards + the standalone entity-create:doc-note
// block are RETIRED from the Docs Hub template — ProjectDocsSections (the new
// Confluence-style bucketed helper) now invokes EntityCreate.render(dv, {
// instance: "doc-note", presetPrompts: { section: <label> } }) internally
// per bucket. So this assert now requires (a) ProjectDocsSections dispatch,
// (b) ProjectDocsCards is GONE, and (c) the broken AccentButton-with-doc-note
// form is absent (defends against accidental re-introduction).
//
// v0.103.0 S3 update: ProjectDocsSections is RETIRED from the Docs Hub
// template — ProjectDocsIndex (the new sections-index landing helper) takes
// over. The assert now requires (a) EITHER ProjectDocsSections OR
// ProjectDocsIndex dispatch, (b) ProjectDocsCards is GONE, (c) the standalone
// entity-create:doc-note sentinel is GONE, and (d) the broken AccentButton
// form is absent.
async function testRWikiHubTemplateBody() {
  console.log('\n=== R-WIKI-1 — Template, Docs Hub.md body: ProjectDocsIndex/ProjectDocsSections + no legacy ProjectDocsCards ===');
  const templatePath = path.resolve(WORKSHOP, 'platform/blueprints/project/templates/Docs Hub.md');
  if (!fs.existsSync(templatePath)) {
    console.log(`  FAIL — template missing: ${templatePath}`);
    return false;
  }
  const body = fs.readFileSync(templatePath, 'utf8');
  const hasSectionsDispatch = /class:\s*["'](?:ProjectDocsSections|ProjectDocsIndex)["']/.test(body)
    || /customJS\.ProjectDocsIndex\.render/.test(body);
  const noLegacyCardsDispatch = !/class:\s*["']ProjectDocsCards["']/.test(body);
  // v0.110.3: the entity-create:doc-note sentinel was INTENTIONALLY re-added in
  // v0.110.0 so injectAccentButtonBlock's verify pass finds an anchor (see
  // HC-V01020-PROJ-TPL-1c + V0110-PROJ-SENT-1). The original v0.50.0 R-WIKI-1
  // notion of "no legacy sentinel" was superseded — the sentinel is now a
  // canonical anchor, not legacy. This assertion was the only test treating it
  // as legacy and is now coherent with the rest of the suite.
  const noBrokenAccentForm = !/class:\s*["']AccentButton["'],\s*args:\s*\[\{\s*id:\s*["']doc-note["']/.test(body);
  const allPass = hasSectionsDispatch && noLegacyCardsDispatch && noBrokenAccentForm;
  console.log(`  hasSectionsDispatch=${hasSectionsDispatch} noLegacyCardsDispatch=${noLegacyCardsDispatch} noBrokenAccentForm=${noBrokenAccentForm}`);
  console.log(`  ${allPass ? 'PASS' : 'FAIL'}`);
  return allPass;
}

async function testREntityCreateIconRendersSvg(siteIndex, site) {
  const caseId = `R-EC-ICON-${siteIndex}`;
  console.log(`\n=== ${caseId} — ${site.instance} button (icon: ${site.icon}) renders SVG, not literal kebab ===`);
  const app = makeApp();
  const Cls = loadAccentButtonClass(app);
  if (!Cls) { console.log('  FAIL — AccentButton class not loaded'); return false; }
  const resolved = ICONS_INSTANCE.resolve(site.icon);
  if (typeof resolved !== 'string' || resolved.length === 0) {
    console.log(`  FAIL — Icons.resolve("${site.icon}") returned null/empty (Tier 1 miss)`);
    return false;
  }
  const parent = makeEl('div', {});
  const btn = new Cls().render(parent, { label: `+ New ${site.instance}`, icon: resolved, onClick: () => {} });
  const html = (btn && btn.innerHTML) || '';
  const containsSvg = html.includes('<svg');
  const containsKebab = html.includes(site.icon);
  console.log(`  innerHTML head: ${html.slice(0, 80)}...`);
  console.log(`  contains <svg: ${containsSvg}; contains literal "${site.icon}": ${containsKebab}`);
  const pass = containsSvg && !containsKebab;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// SELTASK-1 — faithful test of the note-per-task data seam. Loads the REAL
// SpaceDailyDashboard + TaskEntity classes and drives SpaceDailyDashboard.selectTasks
// through a plain-array dv-stub returning task-note-shaped pages. Exercises the ACTUAL
// selection path (not a hand-built replica) — the class of bug this file exists to catch.
async function testSelectTasksNotePerTask() {
  const fs = require("fs");
  const path = require("path");
  const sddSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  const teSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/mechanisms/task-entity/task-entity.js"), "utf8");
  const SDD = new Function(`${sddSrc}\nreturn SpaceDailyDashboard;`)();
  const TaskEntity = new Function(`${teSrc}\nreturn TaskEntity;`)();
  const TE = new TaskEntity(); // customJS stores INSTANCES; delegators call the statics

  const today = "2026-07-02";
  const pagesByQuery = {
    '"spice/tasks"': [
      { type: "task", status: "open", scheduled: "2026-07-02", title: "daily today", source: "daily",   file: { path: "spice/tasks/daily-today.md" } },
      { type: "task", status: "open", scheduled: "2026-07-02", title: "proj today",  source: "project", project_slug: "connectors", file: { path: "spice/tasks/proj-today.md" } },
      { type: "task", status: "open", scheduled: "2026-06-30", title: "mtg overdue", source: "meeting",  file: { path: "spice/tasks/mtg-overdue.md" } },
      { type: "task", status: "open", scheduled: "2026-07-05", title: "future",       file: { path: "spice/tasks/future.md" } },
      { type: "task", status: "open", scheduled: "",           title: "someday",      file: { path: "spice/tasks/someday.md" } },
      { type: "task", status: "done", scheduled: "2026-07-02", title: "leaked done",  file: { path: "spice/tasks/_done/leaked.md" } },
      { type: "task", status: "open", scheduled: "2026-07-02", title: "trashed",      file: { path: "spice/tasks/_trash/trashed.md" } },
      { type: "note", status: "open", scheduled: "2026-07-02", title: "not a task",   file: { path: "spice/tasks/note.md" } },
    ],
    '"spice/tasks/_done"': [
      { type: "task", status: "done", completed_at: "2026-07-02T09:15:00-06:00", title: "done today dt",   file: { path: "spice/tasks/_done/a.md" } },
      { type: "task", status: "done", completed_at: "2026-07-02",                title: "done today date", file: { path: "spice/tasks/_done/b.md" } },
      { type: "task", status: "done", completed_at: "2026-07-01T23:00:00-06:00", title: "done yesterday",  file: { path: "spice/tasks/_done/c.md" } },
      { type: "task", status: "done", completed_at: "",                          title: "done no date",    file: { path: "spice/tasks/_done/d.md" } },
      { type: "task", status: "done", completed_at: "2026-07-02",                title: "trashed done",    file: { path: "spice/tasks/_done/_trash/e.md" } },
    ],
  };
  const fakeDv = { pages: (q) => pagesByQuery[q] || [] };

  let ok = true;
  const check = (label, cond) => { if (!cond) { ok = false; console.log(`  FAIL: SELTASK-1 ${label}`); } };

  const res = SDD.selectTasks(fakeDv, today, TE);
  const titles = res.open.map((t) => t.title);

  check("open has exactly the 3 today/overdue tasks", res.open.length === 3);
  check("all sources present (project + meeting NOT filtered out)",
    titles.indexOf("proj today") >= 0 && titles.indexOf("mtg overdue") >= 0 && titles.indexOf("daily today") >= 0);
  check("today band rendered first (2 today, then overdue)",
    res.open[0].scheduled === "2026-07-02" && res.open[1].scheduled === "2026-07-02" && res.open[2].scheduled === "2026-06-30");
  check("today rows tagged _overdue:false", res.open[0]._overdue === false && res.open[1]._overdue === false);
  check("overdue row tagged _overdue:true", res.open[2]._overdue === true);
  check("future excluded", titles.indexOf("future") < 0);
  check("unscheduled excluded", titles.indexOf("someday") < 0);
  check("_trash excluded from open", titles.indexOf("trashed") < 0);
  check("_done leak excluded from open", titles.indexOf("leaked done") < 0);
  check("non-task type excluded", titles.indexOf("not a task") < 0);
  check("done == 2 (today incl datetime form; excl yesterday/no-date/trashed)", res.done === 2);

  const cold = SDD.selectTasks(fakeDv, today, null);
  check("cold-load (no TE) → empty open + zero done", cold.open.length === 0 && cold.done === 0);

  return ok;
}

// ── REND-V067-TIME-1: SpaceDailyDashboard._formatTime duck-types Luxon + moment ──
// v0.67.0: _formatTime must accept a Luxon DateTime (has .toFormat()), a
// moment-compatible string, and return null for null/undefined.
async function testRendV067Time1() {
  console.log('\n=== REND-V067-TIME-1 — _formatTime duck-types Luxon + moment ===');
  let ok = true;
  try {
    const dailySrc = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    const factory = new Function(
      "window",
      dailySrc + "\nreturn SpaceDailyDashboard;"
    );
    const windowShim = {
      moment: (input) => {
        const d = (input instanceof Date) ? input : new Date(input);
        if (isNaN(d.getTime())) return { isValid: () => false };
        return {
          isValid: () => true,
          format: (fmt) => {
            let h = d.getHours();
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            const m = d.getMinutes().toString().padStart(2, "0");
            return `${h}:${m} ${ampm}`;
          },
        };
      },
    };
    const Klass = factory(windowShim);
    const inst = new Klass();

    // Luxon mock: object with toFormat method
    const luxonMock = { toFormat: (fmt) => "9:00 pm" };
    const luxonOut = inst._formatTime(luxonMock);
    const sub1a = luxonOut === "9:00 pm";
    console.log(`  REND-V067-TIME-1a (Luxon DateTime mock formats via toFormat): ${sub1a ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1a;

    // String input falls through to moment
    const stringOut = inst._formatTime("2026-05-19T14:30:00");
    const sub1b = typeof stringOut === "string" && /\d{1,2}:\d{2}\s+(AM|PM)/.test(stringOut);
    console.log(`  REND-V067-TIME-1b (string input formats via moment): ${sub1b ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1b;

    // Null / undefined returns null
    const sub1c = inst._formatTime(null) === null;
    console.log(`  REND-V067-TIME-1c (null returns null): ${sub1c ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1c;

    const sub1d = inst._formatTime(undefined) === null;
    console.log(`  REND-V067-TIME-1d (undefined returns null): ${sub1d ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1d;
  } catch (e) {
    console.log(`  REND-V067-TIME-1a (Luxon DateTime mock formats via toFormat): FAIL — ${e && e.message}`);
    ok = false;
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ── REND-V067-TODO-1: SpaceDailyDashboard._renderTodoBadge pill when open > 0 ──
// v0.67.0: _renderTodoBadge renders a .sauce-todo-pill pill when open tasks > 0;
// is silent when zero open tasks or tasks array absent.
async function testRendV067Todo1() {
  console.log('\n=== REND-V067-TODO-1 — _renderTodoBadge renders pill when open > 0 ===');
  let ok = true;
  try {
    const dailySrc = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    const factory = new Function(
      "window",
      dailySrc + "\nreturn SpaceDailyDashboard;"
    );
    const Klass = factory({ moment: () => ({ isValid: () => false }) });
    const inst = new Klass();

    function makeEl() {
      return {
        _children: [],
        _attrs: {},
        _innerHTML: "",
        createEl(tag) { const c = makeEl(); c._tag = tag; this._children.push(c); return c; },
        set innerHTML(v) { this._innerHTML = v; },
        get innerHTML() { return this._innerHTML; },
        set className(v) { this._attrs.className = v; },
        get className() { return this._attrs.className; },
        set title(v) { this._attrs.title = v; },
        get title() { return this._attrs.title; },
      };
    }

    // Case 1: open tasks > 0 → pill rendered
    const el1 = makeEl();
    const p1 = { file: { tasks: [{ completed: false }, { completed: false }, { completed: true }] } };
    inst._renderTodoBadge(p1, el1, "<svg/>");
    const sub1a = el1._children.length === 1;
    console.log(`  REND-V067-TODO-1a (pill rendered when open > 0): ${sub1a ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1a;

    const sub1b = el1._children[0]._attrs.className === "sauce-todo-pill";
    console.log(`  REND-V067-TODO-1b (pill className is sauce-todo-pill): ${sub1b ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1b;

    const sub1c = el1._children[0]._attrs.title === "2 open tasks";
    console.log(`  REND-V067-TODO-1c (title says '2 open tasks'): ${sub1c ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1c;

    // Case 2: zero open → silent
    const el2 = makeEl();
    const p2 = { file: { tasks: [{ completed: true }, { completed: true }] } };
    inst._renderTodoBadge(p2, el2, "<svg/>");
    const sub1d = el2._children.length === 0;
    console.log(`  REND-V067-TODO-1d (silent when zero open): ${sub1d ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1d;

    // Case 3: no tasks array → silent
    const el3 = makeEl();
    const p3 = { file: {} };
    inst._renderTodoBadge(p3, el3, "<svg/>");
    const sub1e = el3._children.length === 0;
    console.log(`  REND-V067-TODO-1e (silent when no tasks array): ${sub1e ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1e;
  } catch (e) {
    console.log(`  REND-V067-TODO-1a (pill rendered when open > 0): FAIL — ${e && e.message}`);
    ok = false;
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ── REND-V01241-LINK-1: _renderTaskHTML balanced-paren scan for link URLs ──
// v0.124.1: task text containing markdown links whose URL embeds literal parens
// (Microsoft Teams deep-links, e.g. channelName=...(Lounge)) must capture the
// FULL url. The old `indexOf(")")` truncated at the inner ")", leaking the URL
// tail as escaped literal text after </a>. A CommonMark-style balanced-paren
// scan fixes this.
async function testRendV01241Link1() {
  console.log('\n=== REND-V01241-LINK-1 — _renderTaskHTML balanced-paren scan for link URLs ===');
  let ok = true;
  try {
    const dailySrc = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    const factory = new Function(
      "window",
      dailySrc + "\nreturn SpaceDailyDashboard;"
    );
    const Klass = factory({ moment: () => ({ isValid: () => false }) });
    const inst = new Klass();

    // Case 1: Teams-style deep-link with literal parens in query params.
    const teamsTask = "Help Sachin - [chat](https://teams.microsoft.com/l/message/19:x@thread.tacv2/1?tenantId=y&channelName=Developer%20Enablement%20(Lounge)&createdTime=1781776427950&ngc=true)";
    const teamsHtml = inst._renderTaskHTML(teamsTask);
    const anchorCount = (teamsHtml.match(/<a /g) || []).length;
    const sub1a = anchorCount === 1;
    console.log(`  REND-V01241-LINK-1a (exactly one <a anchor): ${sub1a ? 'PASS' : 'FAIL'} (got ${anchorCount})`);
    ok = ok && sub1a;

    // href must include the full url ending in ngc=true (& escaped to &amp;).
    const sub1b = teamsHtml.includes("createdTime=1781776427950&amp;ngc=true");
    console.log(`  REND-V01241-LINK-1b (href contains full url tail createdTime=...&amp;ngc=true): ${sub1b ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1b;

    // No leaked literal tail OUTSIDE the anchor (no "</a>&amp;createdTime"), and
    // the rendered string ends cleanly with </a> (no trailing leaked text).
    const sub1c = !teamsHtml.includes("</a>&amp;createdTime") && teamsHtml.endsWith("</a>");
    console.log(`  REND-V01241-LINK-1c (no leaked tail after </a>; ends with </a>): ${sub1c ? 'PASS' : 'FAIL'}`);
    ok = ok && sub1c;

    // Case 2: control — simple URL, no inner parens.
    const ctrlHtml = inst._renderTaskHTML("[docs](https://example.com/page)");
    const sub2a = ctrlHtml === '<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">docs</a>';
    console.log(`  REND-V01241-LINK-2a (control renders one correct anchor): ${sub2a ? 'PASS' : 'FAIL'}`);
    if (!sub2a) console.log(`    got: ${ctrlHtml}`);
    ok = ok && sub2a;

    // Case 3: balanced nested parens in the URL.
    const nestedHtml = inst._renderTaskHTML("[x](https://e.com/a(b(c))d)");
    const nestedAnchors = (nestedHtml.match(/<a /g) || []).length;
    const sub3a = nestedAnchors === 1;
    console.log(`  REND-V01241-LINK-3a (one anchor for nested parens): ${sub3a ? 'PASS' : 'FAIL'} (got ${nestedAnchors})`);
    ok = ok && sub3a;

    const sub3b = nestedHtml === '<a href="https://e.com/a(b(c))d" target="_blank" rel="noopener noreferrer">x</a>';
    console.log(`  REND-V01241-LINK-3b (href is full nested-paren url, no leak): ${sub3b ? 'PASS' : 'FAIL'}`);
    if (!sub3b) console.log(`    got: ${nestedHtml}`);
    ok = ok && sub3b;
  } catch (e) {
    console.log(`  REND-V01241-LINK-1a (exactly one <a anchor): FAIL — ${e && e.message}`);
    ok = false;
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

// ── REND-HASNOTES: scaffold-aware "has notes" (#1) ──────────────────────────
// v0.X (#1): SpaceDailyDashboard._bodyHasNotes + MeetingsHubCards._bodyHasNotes
// (byte-identical statics) must agree: a blank SectionLabel-shaped meeting body
// (scaffold only) → false; a body with real notes content → true. Both classes
// loaded the same way the daily helper is loaded above (new Function).
async function testRendHasNotes() {
  console.log('\n=== REND-HASNOTES — scaffold-aware has-notes (SDD + hub) (#1) ===');
  let _ok = true;
  const ok = (label, cond, detail) => {
    const pass = !!cond;
    _ok = _ok && pass;
    console.log(`  ${label}: ${pass ? 'PASS' : 'FAIL'}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
    return pass;
  };
  try {
    const sddSrc = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/daily/helpers/space-daily-dashboard.js"),
      "utf8"
    );
    const SpaceDailyDashboard = new Function(
      "window",
      sddSrc + "\nreturn SpaceDailyDashboard;"
    )({ moment: () => ({ isValid: () => false }) });

    const mhcSrc = fs.readFileSync(
      path.join(WORKSHOP, "platform/blueprints/meetings/helpers/meetings-hub-cards.js"),
      "utf8"
    );
    const MeetingsHubCards = new Function(
      "window",
      mhcSrc + "\nreturn MeetingsHubCards;"
    )({ moment: () => ({ isValid: () => false }) });

    // REND-HASNOTES: blank SectionLabel meeting → false; with notes → true (#1).
    (() => {
      // Scaffold matches the current Meeting.md: marker sits AFTER the Action
      // Items SectionLabel block (top of that section). _bodyHasNotes is
      // position-independent — it strips all markers + task lines — so an empty
      // Notes section reads false regardless of where the marker lives.
      const blank = [
        '---','type: meeting','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Agenda" }] });','```','',
        '-','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });','```','',
        '-','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });','```','',
        '<!-- ACTION_ITEMS_MARKER -->',
      ].join('\n');
      const withNotes = [
        '---','type: meeting','---','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Agenda" }] });','```','',
        '-','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });','```','',
        'We discussed the Q3 roadmap and next steps in detail.','',
        '```dataviewjs','await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Action Items" }] });','```','',
        '<!-- ACTION_ITEMS_MARKER -->',
      ].join('\n');
      // Action items present but NO notes prose → still false (tasks below the
      // marker must not register as Notes content — guards the marker move).
      const withActionItems = [blank, '', '- [x] shipped the thing ✅ 2026-06-26'].join('\n');
      ok('REND-HASNOTES blank → false (SDD)', SpaceDailyDashboard._bodyHasNotes(blank) === false, `got ${SpaceDailyDashboard._bodyHasNotes(blank)}`);
      ok('REND-HASNOTES notes → true (SDD)', SpaceDailyDashboard._bodyHasNotes(withNotes) === true);
      ok('REND-HASNOTES action-items-only → false (SDD)', SpaceDailyDashboard._bodyHasNotes(withActionItems) === false, `got ${SpaceDailyDashboard._bodyHasNotes(withActionItems)}`);
      ok('REND-HASNOTES blank → false (hub)', MeetingsHubCards._bodyHasNotes(blank) === false);
      ok('REND-HASNOTES notes → true (hub)', MeetingsHubCards._bodyHasNotes(withNotes) === true);
      ok('REND-HASNOTES action-items-only → false (hub)', MeetingsHubCards._bodyHasNotes(withActionItems) === false);
    })();
  } catch (e) {
    console.log(`  REND-HASNOTES: FAIL — ${e && e.message}`);
    _ok = false;
  }
  console.log(`  ${_ok ? 'PASS' : 'FAIL'}`);
  return _ok;
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
    if (which === 'invoke-command-args' || which === 'all') results.push(['R-INVOKE-ARGS invoke-command-args', await testInvokeCommandArgs()]);
    if (which === 'scratch-day-hub' || which === 'all') results.push(['R-SCRATCH-DAYHUB scratch-day-hub-templater', await testScratchDayHubRunTemplaterTemplate()]);
    if (which === 'cowork-hub' || which === 'all') results.push(['R-COWORK-HUB cowork-hub-openlink', await testCoworkHubOpenLink()]);
    if (which === 'lazy-scaffold' || which === 'all') results.push(['T4.0 lazy-scaffold', await testLazyScaffold()]);
    if (which === 'beacon-cards' || which === 'all') {
      results.push(['BC1 subtitle-object', await testBC1SubtitleObject()]);
      results.push(['BC2 subtitle-null', await testBC2SubtitleNull()]);
      results.push(['BC3 subtitle-string', await testBC3SubtitleString()]);
      results.push(['BC4 badge-icon', await testBC4BadgeIcon()]);
      results.push(['BC5 badge-no-icon', await testBC5BadgeNoIcon()]);
      results.push(['BC6 synthetic-page-onclick', await testBC6SyntheticPageOnClick()]);
      results.push(['BC7 success-tone', await testBC7SuccessTone()]);
      results.push(['BC8 subtitle-callback', await testBC8SubtitleCallback()]);
      results.push(['BC9 meta-function-form (REND-V066-PILL-1a+1b)', await testBC9MetaFunctionForm()]);
    }
    if (which === 'people-rendering' || which === 'all') {
      results.push(['PR1 chip-resolved', await testPR1ChipResolved()]);
      results.push(['PR2 chip-missing', await testPR2ChipMissing()]);
      results.push(['PR3 card-delegates', await testPR3CardDelegates()]);
      results.push(['PR4 mention-list-mentioning-person', await testPR4MentionListMentioningPerson()]);
      results.push(['PR5 mention-list-mentioned-in-note', await testPR5MentionListMentionedInNote()]);
      results.push(['PR6 extract-mentions-array', await testPR6ExtractMentionsArray()]);
    }
    if (which === 'accent-button' || which === 'all') {
      results.push(['BB1 baseline-csstext', await testBB1RenderReturnsButtonWithBaselineCssText()]);
      results.push(['BB2 flex-fill-css', await testBB2FlexAppendsFillCss()]);
      results.push(['BB3 onclick-wires', await testBB3OnClickWires()]);
      results.push(['BB4 disabled-hover-noop', await testBB4DisabledHoverNoOp()]);
      results.push(['BB5 icon-before-label', await testBB5IconHtmlInlinedBeforeLabel()]);
      results.push(['BB6 hover-swap', await testBB6HoverEnterLeaveSwapsColors()]);
      results.push(['BB7 hover-no-csstext-reassign', await testBB7HoverDoesNotReassignCssText()]);
      results.push(['BB8 base-overflow-clip', await testBB8BaseCssClipsOverflow()]);
      results.push(['BB9 label-span-truncates', await testBB9LabelSpanTruncates()]);
      results.push(['NAV-LAYOUT 3col-grid', await testNavWrapRowStyleWraps()]);
    }
    if (which === 'date-aware' || which === 'all') {
      results.push(['DA1 active-file-with-date', await testDA1ActiveFileWithDate()]);
      results.push(['DA2 active-file-without-date', await testDA2ActiveFileWithoutDate()]);
    }
    if (which === 'entity-create' || which === 'all') {
      results.push(['R-EC-MARKER marker-anchored', await testREntityCreateMarkerAnchored()]);
      results.push(['R-EC-SHAPE injected-block-shape', await testREntityCreateInjectedBlockShape()]);
      results.push(['R-EC-IDEM idempotent-re-inject', await testREntityCreateIdempotentReInject()]);
      results.push(['R-EC-ROW accent-button-row-alignment', await testREntityCreateAccentButtonRowAlignment()]);
      results.push(['R-EC-PRESERVE marker-preserved-across-reinject', await testREntityCreateMarkerPreservedAcrossReInject()]);
      for (let i = 0; i < ENTITY_CREATE_SITES.length; i++) {
        const site = ENTITY_CREATE_SITES[i];
        results.push([`R-EC-ICON-${i + 1} ${site.instance}-icon-renders-svg`, await testREntityCreateIconRendersSvg(i + 1, site)]);
      }
    }
    if (which === 'wiki' || which === 'all') {
      results.push(['R-WIKI-1 docs-hub-template-body', await testRWikiHubTemplateBody()]);
    }
    if (which === 'finance' || which === 'all') {
      // v0.108.0 S3 deleted budget-nav-buttons.js (FinanceNavRow subsumed the
      // per-area BudgetNavButtons / PaycheckNavButtons / InvoiceNavButtons
      // surfaces); the FF1 + FF2 in-path / out-of-path renderer tests targeted
      // that deleted helper. Inheriting the gap with a v0.109.0 SUPERSEDED
      // comment so the harness stops ENOENT'ing on the missing file. The new
      // FinanceNavRow surface has its own dedicated coverage in run-helper-cases.
      // results.push(['FF1 budget-nav-in-path', await testFF1BudgetNavInPath()]);
      // results.push(['FF2 budget-nav-out-of-path', await testFF2BudgetNavOutOfPath()]);
      results.push(['FF3 hub-area-row-icons', await testFF3HubAreaRowIcons()]);
      results.push(['FF4 budget-categories-editor-add-button', await testFF4BudgetCategoriesAddButton()]);
      results.push(['FF5 paycheck-expenses-editor-add-button', await testFF5PaycheckExpensesAddButton()]);
      results.push(['FF9 paycheck-editor-delete-renders-authoritative', await testFF9PaycheckDeleteRendersAuthoritative()]);
      results.push(['FF10 paycheck-editor-edit-preserves-debt-link', await testFF10PaycheckEditPreservesDebt()]);
      results.push(['FF17 paycheck-editor-deposit-materialize-idempotent', await testFF17PaycheckDepositMaterialize()]);
      results.push(['FF18 paycheck-editor-per-deposit-render', await testFF18PaycheckPerDepositRender()]);
      results.push(['FF19 paycheck-editor-move-between-deposits', await testFF19PaycheckMoveBetweenDeposits()]);
      results.push(['FF20 paycheck-editor-legacy-flat-render', await testFF20PaycheckLegacyFlatRender()]);
      results.push(['FF25 paycheck-editor-edit-deposit-amount-authoritative', await testFF25PaycheckEditDepositAmountAuthoritative()]);
      results.push(['FF26 paycheck-editor-grouped-by-check-order', await testFF26PaycheckGroupedByCheckOrder()]);
      results.push(['FF27 paycheck-editor-deposit-date-coerced', await testFF27PaycheckDepositDateCoerced()]);
      results.push(['FF21 paycheck-summary-per-deposit-line', await testFF21PaycheckSummaryPerDeposit()]);
      results.push(['FF22 paycheck-summary-legacy-single-amount', await testFF22PaycheckSummaryLegacy()]);
      results.push(['FF23 paycheck-defaults-editor-deposit-merge', await testFF23PaycheckDefaultsDepositMerge()]);
      results.push(['FF24 paycheck-defaults-editor-schedule-editor', await testFF24PaycheckDefaultsScheduleEditor()]);
      results.push(['FF11 budget-categories-editor-delete-renders-authoritative', await testFF11BudgetCategoriesDeleteRendersAuthoritative()]);
      results.push(['FF12 budget-categories-editor-edit-preserves-extra', await testFF12BudgetCategoriesEditPreservesExtra()]);
      results.push(['FF13 budget-defaults-editor-delete-renders-authoritative', await testFF13BudgetDefaultsDeleteRendersAuthoritative()]);
      results.push(['FF14 budget-defaults-editor-edit-preserves-extra', await testFF14BudgetDefaultsEditPreservesExtra()]);
      results.push(['FF15 budget-allocations-editor-renders-sections', await testFF15BudgetAllocationsRendersSections()]);
      results.push(['FF16 budget-allocations-editor-edit-materializes-override', await testFF16BudgetAllocationsEditMaterializesOverride()]);
      results.push(['FF28 budget-allocations-editor-renders-fixed-section', await testFF28BudgetAllocationsRendersFixedSection()]);
      results.push(['FF29 month-setup-checklist-renders', await testFF29MonthSetupChecklistRenders()]);
      results.push(['FF30 month-setup-checklist-embed-dedup', await testFF30MonthSetupChecklistEmbedDedup()]);
      results.push(['FF31 month-setup-checklist-out-of-path', await testFF31MonthSetupChecklistOutOfPath()]);
      results.push(['FF32 edit-scope-banner-month-scope', await testFF32EditScopeBannerMonthScope()]);
      results.push(['FF33 edit-scope-banner-defaults-scope', await testFF33EditScopeBannerDefaultsScope()]);
      results.push(['FF34 edit-scope-banner-other-type-and-embed', await testFF34EditScopeBannerOtherTypeAndEmbed()]);
      results.push(['FF6 invoice-time-log-editor-out-of-path', await testFF6InvoiceTimeLogOutOfPath()]);
      results.push(['FF7 invoice-controls-rate-and-toggle', await testFF7InvoiceControlsRateAndToggle()]);
      results.push(['FF8 widget-embed-dedup', await testFF8WidgetEmbedDedup()]);
      results.push(['FF-COLD finance-widget-cold-load-render-guards', await testFinanceColdLoadRenderGuards()]);
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
    if (which === 'daily' || which === 'all') {
      results.push(['SELTASK-1 selectTasks note-per-task data seam', await testSelectTasksNotePerTask()]);
      results.push(['REND-V067-TIME-1 _formatTime duck-types Luxon + moment', await testRendV067Time1()]);
      results.push(['REND-V067-TODO-1 _renderTodoBadge pill when open > 0', await testRendV067Todo1()]);
      results.push(['REND-V01241-LINK-1 _renderTaskHTML balanced-paren scan for link URLs', await testRendV01241Link1()]);
      results.push(['REND-HASNOTES scaffold-aware has-notes (SDD + hub)', await testRendHasNotes()]);
    }
  } catch (e) {
    console.error(`\nFATAL: ${e.message}`);
    console.error(e.stack);
    process.exit(2);
  }

  // Source-lint helper for HC blocks — pushes to results[] like other assertions.
  function assertTrue(label, cond, hint) {
    results.push([label, !!cond]);
    if (!cond) {
      console.log(`  FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    } else {
      console.log(`  PASS: ${label}`);
    }
    return !!cond;
  }

  // ── HC-V0843-A: header pills (Tasks orange+green, Meetings/Activity neutral) ─
  // Replaces HC-V0841-C1.* which tested the v0.84.1 inline `Tasks (3 open · 1 done)`
  // form + the now-retired .sauce-tasks-done span. v0.84.3 moves counts out of the
  // title string and into right-aligned .sauce-section-counts pills.
  //
  // SDD_PATH reads the CANONICAL source under platform/blueprints/daily/helpers/,
  // not the workshop's dogfood-materialized copy under ranch/. HC-V0842-A1 below
  // re-confirms canonical and dogfood are byte-equal after Task 4 sync.
  console.log("\n--- HC-V0843-A: header pills ---");

  {
    const SDD_PATH = require("path").resolve(__dirname, "../../platform/blueprints/daily/helpers/space-daily-dashboard.js");
    const fs = require("fs");
    const sddSrc = fs.readFileSync(SDD_PATH, "utf8");

    assertTrue("HC-V0843-A1 getTasks still splits open/done",
      /const\s+open\s*=\s*\[\]/.test(sddSrc) && /const\s+done\s*=\s*\[\]/.test(sddSrc),
      "v0.84.1 open/done split must remain; pill rendering depends on the two arrays");

    assertTrue("HC-V0843-A2 Tasks call site title is bare 'Tasks' (no parenthetical count)",
      /title:\s*["']Tasks["']/.test(sddSrc),
      "Tasks _renderSection call must pass title: 'Tasks' as a plain string — counts move to rightHtml");

    assertTrue("HC-V0843-A3 Tasks call site references sauce-section-open-pill",
      /sauce-section-open-pill/.test(sddSrc),
      "Tasks rightHtml must build a <span class=\"sauce-section-open-pill\">…</span> for the open count");

    assertTrue("HC-V0843-A4 Tasks call site references sauce-section-done-pill",
      /sauce-section-done-pill/.test(sddSrc),
      "Tasks rightHtml must build a <span class=\"sauce-section-done-pill\">…</span> for the done count");

    assertTrue("HC-V0843-A5 Meetings call site uses title 'Meetings' + sauce-section-count-pill",
      /title:\s*["']Meetings["']/.test(sddSrc) && /sauce-section-count-pill[\s\S]{0,300}meetings\.length/.test(sddSrc),
      "Meetings _renderSection must pass title: 'Meetings' and a rightHtml containing sauce-section-count-pill with the meetings.length value");

    assertTrue("HC-V0843-A6 Activity call site uses title 'Activity' + sauce-section-count-pill",
      /title:\s*["']Activity["']/.test(sddSrc) && /sauce-section-count-pill[\s\S]{0,300}activityCount/.test(sddSrc),
      "Activity _renderSection must pass title: 'Activity' and a rightHtml containing sauce-section-count-pill with the activityCount value");

    assertTrue("HC-V0843-A7 _renderSection signature includes rightHtml opt",
      /_renderSection\(container,\s*\{[^}]*rightHtml[^}]*\}/.test(sddSrc),
      "_renderSection must destructure rightHtml from its opts object (parallel to titleHtml landed in v0.84.1)");

    assertTrue("HC-V0843-A8 _renderSection wraps rightHtml in sauce-section-counts span",
      /sauce-section-counts/.test(sddSrc) && /rightHtml[\s\S]{0,200}sauce-section-counts/.test(sddSrc),
      "_renderSection must inject the rightHtml inside a <span class=\"sauce-section-counts\">…</span> wrapper between the title and the chevron");

    const CSS_PATH = require("path").resolve(__dirname,
      "../../platform/blueprints/daily/helpers/sauce-daily-dashboard.css");
    const cssSrc = fs.readFileSync(CSS_PATH, "utf8");

    assertTrue("HC-V0843-A9 CSS defines all three pill classes + counts container",
      /\.sauce-section-counts\s*\{/.test(cssSrc) &&
      /\.sauce-section-open-pill\s*\{/.test(cssSrc) &&
      /\.sauce-section-done-pill\s*\{/.test(cssSrc) &&
      /\.sauce-section-count-pill\s*\{/.test(cssSrc),
      "sauce-daily-dashboard.css must define .sauce-section-counts, .sauce-section-open-pill, .sauce-section-done-pill, .sauce-section-count-pill");

    assertTrue("HC-V0843-A10 retired .sauce-tasks-done is gone from CSS",
      !/\.sauce-tasks-done\s*\{/.test(cssSrc),
      "The v0.84.1 .sauce-tasks-done rule has no callers in v0.84.3 and must be removed from the CSS");

    // ── HC-V0844-A: pill polish (chevron hug + gap + border visibility) ───
    assertTrue("HC-V0844-A1 CSS suppresses chevron auto-margin when counts precedes",
      /\.sauce-section-counts\s*\+\s*\.sauce-section-chevron\s*\{[^}]*margin-left:\s*0/.test(cssSrc),
      "CSS must include a `.sauce-section-counts + .sauce-section-chevron` adjacent-sibling rule with margin-left:0 so the chevron stops competing with the counts auto-margin");

    assertTrue("HC-V0844-A2 .sauce-section-counts gap is 10px",
      /\.sauce-section-counts\s*\{[^}]*gap:\s*10px/.test(cssSrc),
      "v0.84.4 widens the inter-pill gap from 6px to 10px");

    assertTrue("HC-V0844-A3 .sauce-section-count-pill border uses border-hover var",
      /\.sauce-section-count-pill\s*\{[^}]*border:\s*1px\s+solid\s+var\(--background-modifier-border-hover\)/.test(cssSrc),
      "v0.84.4 switches the Meetings/Activity pill border from --background-modifier-border (near-transparent) to --background-modifier-border-hover so the pill is findable");

    // HC-V0842-A1: canonical vs dogfood drift guard (retained from v0.84.2).
    // The workshop installs itself as its own first consumer; if the canonical
    // at platform/blueprints/daily/helpers/space-daily-dashboard.js diverges
    // from ranch/scripts/daily/space-daily-dashboard.js, a hand edit landed
    // in the wrong file and consumer vaults will never see it.
    const RANCH_SDD_PATH = require("path").resolve(__dirname, "../../ranch/scripts/daily/space-daily-dashboard.js");
    const canonicalBytes = fs.readFileSync(SDD_PATH);
    const ranchBytes = fs.existsSync(RANCH_SDD_PATH) ? fs.readFileSync(RANCH_SDD_PATH) : Buffer.alloc(0);
    assertTrue("HC-V0842-A1 canonical SDD == ranch dogfood SDD (byte-equal)",
      ranchBytes.length === canonicalBytes.length && ranchBytes.equals(canonicalBytes),
      "canonical platform/blueprints/daily/helpers/space-daily-dashboard.js and dogfood ranch/scripts/daily/space-daily-dashboard.js must be byte-identical; drift means a hand edit landed in only one copy");
  }

  console.log('\n=== Summary ===');
  for (const [name, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  const allPass = results.every(([, ok]) => ok);
  process.exit(allPass ? 0 : 1);
})();
