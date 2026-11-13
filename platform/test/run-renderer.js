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
 *     all (default), empty, malformed, unknown-action, invoke-command-args, scratch-day-hub, cowork-hub, lazy-scaffold, barebones-one-button, beacon-cards, date-aware, accent-button
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
    const direct = typeof sel === 'string' ? sel.match(/^:scope\s*>\s*\.([A-Za-z0-9_-]+)$/) : null;
    if (direct) return el.children.find((child) => child.cls === direct[1] || child.className === direct[1]) || null;
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
  const once = entityCreateInjectBlock(before, "meeting");
  const twice = entityCreateInjectBlock(once, "meeting");
  // Count occurrences of the marker; expect 1 in both `once` and `twice`.
  const onceCount = (once.match(/<!-- entity-create:meeting -->/g) || []).length;
  const twiceCount = (twice.match(/<!-- entity-create:meeting -->/g) || []).length;
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
  const initial = userTop + "<!-- entity-create:project -->\n```dataviewjs\nold block content\n```" + userBottom;
  const after = entityCreateInjectBlock(initial, "project");
  const topPreserved = after.startsWith(userTop);
  const bottomPreserved = after.endsWith(userBottom);
  const blockReplaced = after.includes("await customJS.EntityCreate.render(dv, { instance: \"project\" });") && !after.includes("old block content");
  console.log(`  user content above preserved: ${topPreserved}`);
  console.log(`  user content below preserved: ${bottomPreserved}`);
  console.log(`  stale block content replaced with canonical: ${blockReplaced}`);
  const pass = topPreserved && bottomPreserved && blockReplaced;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

// ── R-EC-ICON-N — DOM-icon assert per entity-create site ──────────────────
// For each entity-create site, exercise the Icons → AccentButton
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
      { type: "task", status: "open", due: "2026-07-02", title: "daily today", source: "daily",   file: { path: "spice/tasks/daily-today.md" } },
      { type: "task", status: "open", due: "2026-07-02", title: "proj today",  source: "project", project_slug: "connectors", file: { path: "spice/tasks/proj-today.md" } },
      { type: "task", status: "open", due: "2026-07-02", title: "mtg today",   source: "meeting",  file: { path: "spice/tasks/mtg-today.md" } },
      { type: "task", status: "open", due: "2026-06-30", title: "mtg overdue", source: "meeting",  file: { path: "spice/tasks/mtg-overdue.md" } },
      { type: "task", status: "open", due: "2026-06-29", title: "proj overdue", source: "project", project_slug: "connectors", file: { path: "spice/tasks/proj-overdue.md" } },
      { type: "task", status: "open", due: "2026-07-05", title: "future",       file: { path: "spice/tasks/future.md" } },
      { type: "task", status: "open", due: "",           title: "someday",      file: { path: "spice/tasks/someday.md" } },
      { type: "task", status: "done", due: "2026-07-02", title: "leaked done",  file: { path: "spice/tasks/_done/leaked.md" } },
      { type: "task", status: "open", due: "2026-07-02", title: "trashed",      file: { path: "spice/tasks/_trash/trashed.md" } },
      { type: "note", status: "open", due: "2026-07-02", title: "not a task",   file: { path: "spice/tasks/note.md" } },
    ],
    '"spice/tasks/_done"': [
      { type: "task", status: "done", completed_at: "2026-07-02T09:15:00-06:00", title: "done today dt",   file: { path: "spice/tasks/_done/a.md" } },
      { type: "task", status: "done", completed_at: "2026-07-02",                title: "done today date", file: { path: "spice/tasks/_done/b.md" } },
      { type: "task", status: "done", completed_at: "2026-07-01T23:00:00-06:00", title: "done yesterday",  file: { path: "spice/tasks/_done/c.md" } },
      { type: "task", status: "done", completed_at: "",                          title: "done no date",    file: { path: "spice/tasks/_done/d.md" } },
      { type: "task", status: "deleted", completed_at: "2026-07-02",              title: "trashed done",    file: { path: "spice/tasks/_trash/e.md" } },
    ],
  };
  pagesByQuery['"spice/tasks"'] = pagesByQuery['"spice/tasks"'].concat(pagesByQuery['"spice/tasks/_done"']);
  delete pagesByQuery['"spice/tasks/_done"'];
  const fakeDv = { pages: (q) => pagesByQuery[q] || [] };

  let ok = true;
  const check = (label, cond) => { if (!cond) { ok = false; console.log(`  FAIL: SELTASK-1 ${label}`); } };

  const res = SDD.selectTasks(fakeDv, today, TE);
  const titles = res.open.map((t) => t.title);

  const overdueTitles = res.overdue.map((t) => t.title);

  // open == TODAY ONLY (due == today); overdue is its OWN LIST (scheduled
  // before today) — same shape as open, rendered as a distinguished tail.
  check("open list is today-only (3 tasks due today)", res.open.length === 3);
  check("every open row is due today", res.open.every((t) => t.due === "2026-07-02"));
  check("all sources present in the today list (daily + project + meeting)",
    titles.indexOf("daily today") >= 0 && titles.indexOf("proj today") >= 0 && titles.indexOf("mtg today") >= 0);
  check("overdue tasks are NOT in the open list", titles.indexOf("mtg overdue") < 0 && titles.indexOf("proj overdue") < 0);
  check("overdue is an array", Array.isArray(res.overdue));
  check("overdue.length == 2 (all sources counted: meeting + project)", res.overdue.length === 2);
  check("overdue list contains the overdue tasks (all sources)",
    overdueTitles.indexOf("mtg overdue") >= 0 && overdueTitles.indexOf("proj overdue") >= 0);
  check("future excluded from open", titles.indexOf("future") < 0);
  check("unscheduled excluded from open", titles.indexOf("someday") < 0);
  check("_trash excluded from open", titles.indexOf("trashed") < 0);
  check("_done leak excluded from open", titles.indexOf("leaked done") < 0);
  check("non-task type excluded from open", titles.indexOf("not a task") < 0);
  check("done == 2 (today incl datetime form; excl yesterday/no-date/trashed)", res.done === 2);

  const cold = SDD.selectTasks(fakeDv, today, null);
  check("cold-load (no TE) → empty open + empty overdue + zero done",
    cold.open.length === 0 && Array.isArray(cold.overdue) && cold.overdue.length === 0 && cold.done === 0);

  const counts = SDD.computeCounts(fakeDv, today, TE);
  check("computeCounts().overdue is still a number", typeof counts.overdue === "number" && counts.overdue === 2);

  return ok;
}

// HC-SELMTG — SpaceDailyDashboard.selectMeetings filters meeting pages by
// filename-CONTAINS-today (covers both leading-date "2026-07-02 Foo" and
// trailing-date "Foo-2026-07-02" conventions), drops others, sorts asc; empty
// today / bad dv → []. Loads the REAL class via the bare-class eval.
async function testSelectMeetings() {
  const fs = require("fs");
  const path = require("path");
  const sddSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  const SDD = new Function(`${sddSrc}\nreturn SpaceDailyDashboard;`)();

  const today = "2026-07-02";
  const pages = [
    { file: { name: "2026-07-02 Standup", path: "spice/meetings/notes/2026-07-02 Standup.md" } }, // leading-date
    { file: { name: "Retro-2026-07-02",   path: "spice/meetings/notes/Retro-2026-07-02.md" } },   // trailing-date
    { file: { name: "1:1-2026-07-01",     path: "spice/meetings/notes/1:1-2026-07-01.md" } },     // yesterday → drop
    { file: { name: "Planning-2026-07-05", path: "spice/meetings/notes/Planning-2026-07-05.md" } },// future → drop
    { file: { name: "Undated",            path: "spice/meetings/notes/Undated.md" } },            // no date → drop
  ];
  const fakeDv = { pages: (q) => (q === '"spice/meetings/notes"' ? pages : []) };

  let ok = true;
  const check = (label, cond) => { if (!cond) { ok = false; console.log(`  FAIL: HC-SELMTG ${label}`); } };

  const res = SDD.selectMeetings(fakeDv, today);
  const names = res.map((p) => p.file.name);
  check("returns exactly 2 today meetings", res.length === 2);
  check("keeps the leading-date name", names.indexOf("2026-07-02 Standup") >= 0);
  check("keeps the trailing-date name", names.indexOf("Retro-2026-07-02") >= 0);
  check("drops yesterday", names.indexOf("1:1-2026-07-01") < 0);
  check("drops future", names.indexOf("Planning-2026-07-05") < 0);
  check("drops undated", names.indexOf("Undated") < 0);
  check("sorted by filename asc", names[0] === "2026-07-02 Standup" && names[1] === "Retro-2026-07-02");

  // Blank / null today → [] (no over-broad match).
  check("blank today → []", SDD.selectMeetings(fakeDv, "").length === 0);
  check("null today → []", SDD.selectMeetings(fakeDv, null).length === 0);
  // Bad dv → [] (never throws).
  check("throwing dv → []", SDD.selectMeetings({ pages: () => { throw new Error("boom"); } }, today).length === 0);

  return ok;
}

// HC-COUNTS — SpaceDailyDashboard.computeCounts rolls up { today, overdue, done,
// meetings } as integers, composing selectTasks + selectMeetings. dv-stub + a real
// TaskEntity ref → integers match the stub; cold load (no TE) → tasks zeroed but
// meetings still counted; never throws.
async function testComputeCounts() {
  const fs = require("fs");
  const path = require("path");
  const sddSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  const teSrc = fs.readFileSync(path.resolve(__dirname,
    "../../platform/mechanisms/task-entity/task-entity.js"), "utf8");
  const SDD = new Function(`${sddSrc}\nreturn SpaceDailyDashboard;`)();
  const TaskEntity = new Function(`${teSrc}\nreturn TaskEntity;`)();
  const TE = new TaskEntity();

  const today = "2026-07-02";
  const pagesByQuery = {
    '"spice/tasks"': [
      { type: "task", status: "open", due: "2026-07-02", title: "a", source: "daily",   file: { path: "spice/tasks/a.md" } },
      { type: "task", status: "open", due: "2026-07-02", title: "b", source: "project",  file: { path: "spice/tasks/b.md" } },
      { type: "task", status: "open", due: "2026-06-30", title: "od", source: "meeting",  file: { path: "spice/tasks/od.md" } },
    ],
    '"spice/tasks/_done"': [
      { type: "task", status: "done", completed_at: "2026-07-02", title: "done1", file: { path: "spice/tasks/_done/d1.md" } },
    ],
    '"spice/meetings/notes"': [
      { file: { name: "Standup-2026-07-02", path: "spice/meetings/notes/Standup-2026-07-02.md" } },
      { file: { name: "Retro-2026-07-02",   path: "spice/meetings/notes/Retro-2026-07-02.md" } },
      { file: { name: "Old-2026-07-01",     path: "spice/meetings/notes/Old-2026-07-01.md" } },
    ],
  };
  pagesByQuery['"spice/tasks"'] = pagesByQuery['"spice/tasks"'].concat(pagesByQuery['"spice/tasks/_done"']);
  delete pagesByQuery['"spice/tasks/_done"'];
  const fakeDv = { pages: (q) => pagesByQuery[q] || [] };

  let ok = true;
  const check = (label, cond) => { if (!cond) { ok = false; console.log(`  FAIL: HC-COUNTS ${label}`); } };

  const c = SDD.computeCounts(fakeDv, today, TE);
  check("today === 2 (two tasks due today)", c.today === 2);
  check("overdue === 1 (one open task before today)", c.overdue === 1);
  check("done === 1 (one done-today)", c.done === 1);
  check("meetings === 2 (two today meetings)", c.meetings === 2);
  check("all counts are integers", [c.today, c.overdue, c.done, c.meetings].every((n) => Number.isInteger(n)));

  // Cold load (no TE) → tasks zeroed, meetings still counted.
  const cold = SDD.computeCounts(fakeDv, today, null);
  check("cold-load today === 0", cold.today === 0);
  check("cold-load overdue === 0", cold.overdue === 0);
  check("cold-load done === 0", cold.done === 0);
  check("cold-load meetings still counted (=== 2)", cold.meetings === 2);

  // Throwing dv → all zeros, never throws.
  let threw = false;
  let z = null;
  try { z = SDD.computeCounts({ pages: () => { throw new Error("boom"); } }, today, TE); }
  catch (_e) { threw = true; }
  check("throwing dv does not throw", !threw);
  check("throwing dv → all zeros", z && z.today === 0 && z.overdue === 0 && z.done === 0 && z.meetings === 0);

  return ok;
}

// ── REND-ASOF — optional asOf/live inject on SpaceDailyDashboard.render ──────
// Drives the REAL async render(dv, params) end-to-end through a DOM+dv stub so
// the observed "today" is whatever the render's date-derivation actually chose.
// Two cases:
//   (a) render(dv, { asOf: "2025-01-15", live: true }) — caller-supplied asOf
//       overrides the filename date. The meetings .where predicate sees
//       2025-01-15 AND the captured ActivityFeed.render call carries
//       asOf: "2025-01-15".
//   (b) render(dv) with no params on a file basename containing 2026-02-03 —
//       current behavior (regression lock): selection uses 2026-02-03. This
//       must pass BEFORE and AFTER the seam is added (proves no-params behavior
//       is byte-for-byte unchanged).
//
// This is the Home-command-center DRY seam: a host renders the daily dashboard
// scoped to an explicit date without changing the note-embedded behavior.

// Minimal DOM element stub sufficient for _renderSection + container ops.
function makeDashEl() {
  const el = {
    _children: [],
    _tag: null,
    className: "",
    dataset: {},
    style: {},
    innerHTML: "",
    open: false,
    createEl(tag) { const c = makeDashEl(); c._tag = tag; this._children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    remove() {},
  };
  // style.cssText assignment is used by render on the container.
  Object.defineProperty(el.style, "cssText", { value: "", writable: true, configurable: true });
  return el;
}

// window.moment shim supporting the subset _getActivityCount needs:
//   moment(iso, "YYYY-MM-DD").startOf("day").format()  → "<iso>T00:00:00"
//   moment(iso, "YYYY-MM-DD").endOf("day").format()    → "<iso>T23:59:59"
// (no new Date() — pure string composition off the YYYY-MM-DD input).
function makeMomentWindow() {
  const wrap = (iso, edge) => ({
    startOf: () => wrap(iso, "start"),
    endOf: () => wrap(iso, "end"),
    format: () => `${iso}T${edge === "end" ? "23:59:59" : "00:00:00"}`,
  });
  return { moment: (iso) => wrap(String(iso), "start") };
}

// Load SpaceDailyDashboard with window injected (for window.moment) and no
// bare app (render/_readSectionState/_resolveCurrentFileName all guard `typeof
// app`). customJS is set on the injected window's globalThis-free scope via a
// closure variable that the factory closes over.
function loadDashboardForRender() {
  const fsMod = require("fs");
  const pathMod = require("path");
  const sddSrc = fsMod.readFileSync(pathMod.resolve(__dirname,
    "../../platform/blueprints/daily/helpers/space-daily-dashboard.js"), "utf8");
  // Factory params supply the bare identifiers render + collaborators reference:
  //   window (window.moment), customJS (BeaconCards/ActivityFeed/TaskEntity).
  // `app` stays undefined so the guarded fallbacks fire (no app.workspace, so
  // _resolveCurrentFileName falls back to dv.current().file.name — the shim path).
  return new Function("window", "customJS",
    `${sddSrc}\nreturn SpaceDailyDashboard;`);
}

async function runDashboardRender({ params, fileName }) {
  const factory = loadDashboardForRender();

  // Capture the date the meetings .where predicate filtered on: seed candidate
  // meeting pages named after several distinct dates; whichever survives the
  // filter reveals the `today` the predicate closed over.
  const candidateDates = ["2025-01-15", "2026-02-03", "2099-12-31"];
  const meetingPages = candidateDates.map((d) => ({
    file: { name: `Standup-${d}`, path: `spice/meetings/notes/Standup-${d}.md` },
    summary: "",
  }));
  // One activity page dated on each candidate day so activityCount > 0 for
  // whichever `today` the render picks — ensures the flow reaches ActivityFeed.
  const activityPages = candidateDates.map((d) => ({
    type: "journal-entry", day: d,
    file: { name: `Journal-${d}`, path: `spice/journal/Journal-${d}.md` },
  }));

  let meetingsFilteredDate = null;
  const dv = {
    pages(query) {
      if (query === '"spice/meetings/notes"') {
        return {
          where(fn) {
            const kept = meetingPages.filter(fn);
            // The predicate is `p.file.name.includes(today)`; the surviving
            // page's embedded date IS the today the render derived.
            if (kept.length === 1) {
              const m = String(kept[0].file.name).match(/(\d{4}-\d{2}-\d{2})/);
              meetingsFilteredDate = m ? m[1] : null;
            }
            return { sort() { return { array: () => kept }; } };
          },
        };
      }
      // Task queries (spice/tasks) — return [] so no task rows (TE is a
      // real stub below); activity queries iterate this array in _getActivityCount.
      if (query === '"spice/tasks"') return [];
      // _getActivityCount calls dv.pages() with no query.
      if (query === undefined) return activityPages;
      return [];
    },
    page() { return null; },
    el(tag) { const e = makeDashEl(); e._tag = tag; this.container._children.push(e); return e; },
    current() { return { file: { name: fileName } }; },
    container: makeDashEl(),
  };

  // customJS stub: BeaconCards + ActivityFeed spies, TaskEntity returns no tasks.
  // 2→1 sweep reduction: SpaceDailyDashboard.render now calls
  // customJS.ActivityFeed.query(dv, opts) ONCE for the activity count (was the
  // retired _getActivityCount). The query spy returns the activity pages whose
  // `day` matches the derived asOf — total > 0 so the activity section renders
  // and the render spy fires (letting REND-ASOF-A2/B2 observe the derived asOf).
  let capturedActivityAsOf = null;
  const customJS = {
    TaskEntity: { queryToday: () => ({ personal: [], all: [] }) },
    TaskTodayList: null,
    BeaconCards: { render: async () => {} },
    ActivityFeed: {
      query: (_dv, opts) => {
        const asOf = opts && opts.asOf;
        const pages = activityPages.filter(p => p && p.day === asOf);
        return { pages, total: pages.length };
      },
      render: async (_shim, opts) => { capturedActivityAsOf = opts && opts.asOf; },
    },
  };

  const SpaceDailyDashboard = factory(makeMomentWindow(), customJS);
  const inst = new SpaceDailyDashboard();
  await inst.render(dv, params);

  return { meetingsFilteredDate, capturedActivityAsOf };
}

async function testRendAsOfCallerOverride() {
  console.log('\n=== REND-ASOF-A — render(dv, { asOf }) scopes selection to the caller date ===');
  let ok = true;
  try {
    const { meetingsFilteredDate, capturedActivityAsOf } = await runDashboardRender({
      params: { asOf: "2025-01-15", live: true },
      // Filename carries a DIFFERENT date — asOf must win over the filename.
      fileName: "Journal-2026-02-03",
    });
    const subA = meetingsFilteredDate === "2025-01-15";
    console.log(`  REND-ASOF-A1 (meetings filter uses caller asOf): ${subA ? 'PASS' : 'FAIL'} — got ${meetingsFilteredDate}`);
    ok = ok && subA;
    const subB = capturedActivityAsOf === "2025-01-15";
    console.log(`  REND-ASOF-A2 (ActivityFeed.render asOf is caller asOf): ${subB ? 'PASS' : 'FAIL'} — got ${capturedActivityAsOf}`);
    ok = ok && subB;
  } catch (e) {
    console.log(`  REND-ASOF-A: FAIL — ${e && e.message}`);
    ok = false;
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
  return ok;
}

async function testRendAsOfNoParamsRegression() {
  console.log('\n=== REND-ASOF-B — render(dv) with no params derives today from the filename (regression lock) ===');
  let ok = true;
  try {
    const { meetingsFilteredDate, capturedActivityAsOf } = await runDashboardRender({
      params: undefined,
      fileName: "Journal-2026-02-03",
    });
    const subA = meetingsFilteredDate === "2026-02-03";
    console.log(`  REND-ASOF-B1 (meetings filter uses filename date): ${subA ? 'PASS' : 'FAIL'} — got ${meetingsFilteredDate}`);
    ok = ok && subA;
    const subB = capturedActivityAsOf === "2026-02-03";
    console.log(`  REND-ASOF-B2 (ActivityFeed.render asOf is filename date): ${subB ? 'PASS' : 'FAIL'} — got ${capturedActivityAsOf}`);
    ok = ok && subB;
  } catch (e) {
    console.log(`  REND-ASOF-B: FAIL — ${e && e.message}`);
    ok = false;
  }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}`);
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
      results.push(['HC-SELMTG selectMeetings filters by filename-contains-today', await testSelectMeetings()]);
      results.push(['HC-COUNTS computeCounts rolls up {today,overdue,done,meetings}', await testComputeCounts()]);
      results.push(['REND-ASOF-A render(dv,{asOf}) scopes to caller date', await testRendAsOfCallerOverride()]);
      results.push(['REND-ASOF-B render(dv) no-params filename-date regression lock', await testRendAsOfNoParamsRegression()]);
      results.push(['REND-V067-TIME-1 _formatTime duck-types Luxon + moment', await testRendV067Time1()]);
      results.push(['REND-V067-TODO-1 _renderTodoBadge pill when open > 0', await testRendV067Todo1()]);
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

    assertTrue("HC-V0843-A1 selectTasks is the note-per-task data seam returning { open, done, overdue }",
      /static\s+selectTasks\s*\(/.test(sddSrc) && /return\s*\{\s*open\s*,\s*done\s*,\s*overdue\s*[,}]/.test(sddSrc),
      "selectTasks must select task-notes and return a today-only open list + a done count + an overdue count (pills read openTasks.length + overdueCount + doneCount)");

    assertTrue("HC-V0843-A1b selectTasks queries spice/tasks (open + done-today by status) via queryToday",
      /"spice\/tasks"/.test(sddSrc) && !/"spice\/tasks\/_done"/.test(sddSrc) && /queryToday/.test(sddSrc),
      "selectTasks must query spice/tasks once (open and done by status, wherever they live) and partition open tasks via the source-agnostic TaskEntity.queryToday");

    assertTrue("HC-V0843-A1c task rows render via TaskTodayList.renderInlineLinks + open the note",
      /renderInlineLinks/.test(sddSrc) && /openLinkText\(task\.path/.test(sddSrc),
      "task rows must render titles via the canonical inline-link renderer and click through to the task note (task.path)");

    assertTrue("HC-V0843-A2 Tasks call site title is bare 'Tasks' (no parenthetical count)",
      /titleHtml:\s*['"`].*sauce-section-title-link.*Tasks/.test(sddSrc),
      "Tasks _renderSection call must render a bare 'Tasks' title (now a clickable sauce-section-title-link span) — counts move to rightHtml");

    assertTrue("HC-V0843-A3 Tasks call site references sauce-section-open-pill",
      /sauce-section-open-pill/.test(sddSrc),
      "Tasks rightHtml must build a <span class=\"sauce-section-open-pill\">…</span> for the open count");

    assertTrue("HC-V0843-A4 Tasks call site references sauce-section-done-pill",
      /sauce-section-done-pill/.test(sddSrc),
      "Tasks rightHtml must build a <span class=\"sauce-section-done-pill\">…</span> for the done count");

    assertTrue("HC-V0843-A4b Tasks call site references sauce-section-overdue-pill (red overdue count)",
      /sauce-section-overdue-pill/.test(sddSrc) && /overdueCount/.test(sddSrc),
      "Tasks rightHtml must build a <span class=\"sauce-section-overdue-pill\">…</span> carrying the overdueCount (overdue tasks are surfaced only as a red count pill, not as list rows)");

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

    assertTrue("HC-V0843-A9 CSS defines all pill classes + counts container (incl. red overdue)",
      /\.sauce-section-counts\s*\{/.test(cssSrc) &&
      /\.sauce-section-open-pill\s*\{/.test(cssSrc) &&
      /\.sauce-section-overdue-pill\s*\{/.test(cssSrc) &&
      /\.sauce-section-done-pill\s*\{/.test(cssSrc) &&
      /\.sauce-section-count-pill\s*\{/.test(cssSrc),
      "sauce-daily-dashboard.css must define .sauce-section-counts, .sauce-section-open-pill, .sauce-section-overdue-pill, .sauce-section-done-pill, .sauce-section-count-pill");

    assertTrue("HC-V0843-A9b overdue pill is themed red (var(--color-red))",
      /\.sauce-section-overdue-pill\s*\{[^}]*var\(--color-red\)/.test(cssSrc),
      "the .sauce-section-overdue-pill rule must colour itself with var(--color-red) so overdue reads as a red count");

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
