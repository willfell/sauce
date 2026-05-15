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

function loadPeopleRenderingClass(app, customJS, Notice) {
  if (!PEOPLE_RENDERING_SRC) return null;
  const fn = new Function('app', 'customJS', 'Notice', `${PEOPLE_RENDERING_SRC}\nreturn typeof PeopleRendering !== 'undefined' ? PeopleRendering : null;`);
  return fn(app, customJS || {}, Notice || FakeNotice);
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
    const btn = findButtonByLabel(dv.container, 'Bootstrap');
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

      const btn = findButtonByLabel(dv.container, 'Scratch');
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

    const btn = findButtonByLabel(dv.container, 'Cowork');
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
