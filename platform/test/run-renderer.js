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
 *
 * Usage:
 *   node platform/test/run-renderer.js [--vault <path>] [test-selector]
 *   test-selector:
 *     all (default), empty, malformed, unknown-action, lazy-scaffold, barebones-one-button
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
const REGISTRY_REL = 'Docs/Meta/nav-buttons-registry.json';
const REGISTRY_ABS = path.join(VAULT, REGISTRY_REL);
const KANBAN_TEMPLATE_SRC_REL = 'platform/blueprints/project/content/kanban-board.md';
const KANBAN_TARGET_REL = 'boards/To-Do-Board.md';

// Cache the renderer source at module load — identical bytes per test run.
const RENDERER_SRC = fs.readFileSync(RENDERER_FILE, 'utf8');

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
  const templateSourceAbs = path.join(WORKSHOP, KANBAN_TEMPLATE_SRC_REL);
  const templateBody = fs.readFileSync(templateSourceAbs, 'utf8');
  const templateBodyLen = templateBody.length;
  console.log(`  template source: ${KANBAN_TEMPLATE_SRC_REL} (${templateBodyLen}B)`);

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
            template_source: KANBAN_TEMPLATE_SRC_REL,
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
      if (p === KANBAN_TEMPLATE_SRC_REL) return templateBody;
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
