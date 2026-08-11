#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/operator-station.js');
const VISUAL = path.join(ROOT, 'platform/test/visual/operator-station.html');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function loadClass() { return eval(`(${fs.readFileSync(HELPER, 'utf8')})`); } // eslint-disable-line no-eval
function file(filePath) { return { path: filePath, basename: path.posix.basename(filePath, '.md') }; }
function element(tag = 'div', options = {}) {
  return {
    tag, className: options.cls || '', textContent: options.text || '', href: '',
    style: { cssText: '' }, children: [], listeners: {}, removed: false, open: false,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions);
      this.children.push(child);
      return child;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelector(selector) {
      if (selector === ':scope > .operator-station-root') {
        return this.children.find((child) => child.className.split(/\s+/).includes('operator-station-root')) || null;
      }
      return null;
    },
    replaceChildren() { this.children = []; this.textContent = ''; },
    remove() { this.removed = true; },
  };
}
function flatten(root, out = []) {
  out.push(root);
  for (const child of root.children || []) flatten(child, out);
  return out;
}
function textOf(root) { return flatten(root).map((node) => node.textContent).filter(Boolean).join('\n'); }
function descendants(root, className) {
  return flatten(root).filter((node) => node.className.split(/\s+/).includes(className));
}
function indices(haystack, labels) { return labels.map((label) => haystack.indexOf(label)); }
function deadline(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}
function cdpPipe(child) {
  const input = child.stdio[3];
  const output = child.stdio[4];
  const pending = new Map();
  let nextId = 1;
  let buffer = '';
  output.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let boundary;
    while ((boundary = buffer.indexOf('\0')) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
      if (!message.id || !pending.has(message.id)) continue;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`CDP ${message.error.code}: ${message.error.message}`));
      else resolve(message.result || {});
    }
  });
  return {
    command(method, params = {}, sessionId = undefined) {
      const id = nextId++;
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        input.write(`${JSON.stringify(message)}\0`);
      });
    },
  };
}
async function renderGeometry(chrome, profile, viewportWidth) {
  const child = childProcess.spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
    '--disable-background-networking', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    const cdp = cdpPipe(child);
    const send = (method, params = {}, sessionId = undefined) => deadline(
      cdp.command(method, params, sessionId), 10000, `CDP ${method}`,
    );
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    await send('Page.enable', {}, session);
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth, height: 1800, deviceScaleFactor: 1, mobile: false,
      screenWidth: viewportWidth, screenHeight: 1800,
    }, session);
    await send('Page.navigate', {
      url: `${pathToFileURL(VISUAL).href}?expectedViewport=${viewportWidth}`,
    }, session);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await send('Runtime.evaluate', {
        expression: 'JSON.stringify({ready:document.readyState,geometry:document.body?.dataset.geometry||null,result:document.querySelector(".geometry-result")?.textContent||""})',
        returnByValue: true,
      }, session);
      const value = JSON.parse(evaluated.result?.value || '{}');
      if (value.ready === 'complete' && value.geometry) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`operator geometry never completed: ${stderr}`);
  } finally {
    child.kill('SIGKILL');
    await deadline(closed, 5000, 'headless Chrome close').catch(() => {});
  }
}

async function main() {
  const OperatorStation = loadClass();
  const vaultRoot = '/Users/willfell/obsidian/headspace-sauce';
  const stationPath = 'spice/projects/sauce/Loop Station.md';
  const ratificationDir = 'spice/projects/sauce/ratifications';
  const markdownFiles = [
    file(`${ratificationDir}/GA-H1a.md`),
    file(`${ratificationDir}/GA-H2a.md`),
    file(`${ratificationDir}/nested/GA-H3a.md`),
    file('spice/projects/other/ratifications/GA-H4a.md'),
    file(`${ratificationDir}/plain.md`),
  ];
  const frontmatter = new Map([
    [`${ratificationDir}/GA-H1a.md`, {
      type: 'ratification', schema_version: '1.0.0', state: 'pending',
      target_card: 'GA-H1a Choose bounded path', created_at: '2026-07-26T10:00:00Z',
    }],
    [`${ratificationDir}/GA-H2a.md`, {
      type: 'ratification', schema_version: '1.0.0', state: 'consumed',
      target_card: 'GA-H2a Already settled', created_at: '2026-07-26T11:00:00Z',
    }],
    [`${ratificationDir}/nested/GA-H3a.md`, {
      type: 'ratification', schema_version: '1.0.0', state: 'pending',
      target_card: 'GA-H3a Nested', created_at: '2026-07-26T12:00:00Z',
    }],
    ['spice/projects/other/ratifications/GA-H4a.md', {
      type: 'ratification', schema_version: '1.0.0', state: 'pending',
      target_card: 'GA-H4a Wrong project', created_at: '2026-07-26T13:00:00Z',
    }],
    [`${ratificationDir}/plain.md`, { type: 'note', state: 'pending' }],
  ]);
  const mutations = [];
  const mutator = (name) => () => {
    mutations.push(name);
    throw new Error(`read-only fixture invoked ${name}`);
  };
  const opened = [];
  global.app = {
    vault: {
      getMarkdownFiles: () => markdownFiles,
      create: mutator('vault.create'), createBinary: mutator('vault.createBinary'),
      modify: mutator('vault.modify'), modifyBinary: mutator('vault.modifyBinary'),
      delete: mutator('vault.delete'), rename: mutator('vault.rename'), trash: mutator('vault.trash'),
      adapter: {
        basePath: vaultRoot,
        write: mutator('adapter.write'), writeBinary: mutator('adapter.writeBinary'),
        append: mutator('adapter.append'), process: mutator('adapter.process'),
        remove: mutator('adapter.remove'), rename: mutator('adapter.rename'), copy: mutator('adapter.copy'),
        mkdir: mutator('adapter.mkdir'), rmdir: mutator('adapter.rmdir'),
        trashSystem: mutator('adapter.trashSystem'), trashLocal: mutator('adapter.trashLocal'),
      },
    },
    metadataCache: {
      getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) || {} }),
      trigger: mutator('metadataCache.trigger'), save: mutator('metadataCache.save'),
    },
    fileManager: {
      processFrontMatter: mutator('fileManager.processFrontMatter'), renameFile: mutator('fileManager.renameFile'),
    },
    workspace: { openLinkText: (...args) => opened.push(args) },
    commands: {
      commands: {},
      executeCommandById: mutator('commands.executeCommandById'),
    },
  };
  const sections = [];
  const payload = {
    type: 'loop-station',
    schema_version: '1.0.0',
    updated_at: '2026-07-25T10:00:00Z',
    updated_on: 'claim',
    headline: '2 need you · active: GA-OPS18b',
    exact_action: `Ratify GA-H1a Choose bounded path in [[${ratificationDir}/GA-H1a]] — Choose the bounded recovery path.`,
    active: { card: 'GA-OPS18b Operator Station', phase: 'implementing', epic: 'Loop Ops' },
    needs_attention: [
      {
        card: 'GA-H1a Choose bounded path', epic: 'Host Ops', bucket: 'ratification',
        why: 'Choose the bounded recovery path.', ratification: `${ratificationDir}/GA-H1a`,
      },
      {
        card: 'GA-H5a Repair fixture', epic: 'Loop Ops', bucket: 'refutation',
        why: 'Repair the failing contract.', ratification: `${ratificationDir}/missing`,
      },
    ],
    needs_attention_overflow_count: 0,
    waiting: [{
      card: 'GA-W1a Await brew', epic: 'Loop Ops', bucket: 'deploy-wait',
      why: 'Homebrew promotion in progress.',
    }],
    waiting_overflow_count: 0,
    since: {
      marker_at: '2026-07-24T08:30:00Z',
      discards: [{
        name: 'GA-X1a Old route', reason: 'Superseded by the bounded route.',
        superseded_by: 'GA-X1b Bounded route', discarded_at: '2026-07-25T09:00:00Z',
      }],
      self_ratified: [{ heading: 'Bounded convergence', date: '2026-07-25' }],
      self_ratified_overflow_count: 0,
      cutover_flips: [{ enabled: true, at: '2026-07-25T12:00:00Z' }],
      cutover_flips_overflow_count: 0,
      ratified: [{
        card: 'GA-R1a Adopt route', authority: 'delegate',
        at: '2026-07-25T13:00:00Z', artifact_path: null,
      }],
      ratified_overflow_count: 0,
      discards_overflow_count: 0,
    },
    releases_recent: ['v0.265.0', 'v0.264.1'],
    releases_recent_overflow_count: 0,
    tombstone_residue: [],
    tombstone_residue_overflow_count: 0,
    counts: { needs_attention: 2, waiting: 1, frozen: 7, done: 31, tombstone_residue: 0 },
  };
  let currentPage = { ...payload, file: { path: stationPath, folder: 'spice/projects/sauce' } };
  global.customJS = {
    RenderSafe: { page: () => currentPage },
    SectionLabel: {
      render: (dv, options) => {
        sections.push(options.text);
        const label = dv.container.createEl('div', { text: options.text });
        label.className = 'section-label';
      },
    },
  };
  const station = new OperatorStation({
    now: () => new Date('2026-07-26T16:30:00Z'),
    deliveryApi: { normalizeStatus: (value) => value },
  });
  const container = element();
  await station.render({ container, current: () => { throw new Error('raw dv.current forbidden'); } });
  const rendered = textOf(container);

  assert.deepStrictEqual(sections, [
    'Needs you', 'Ratification inbox', 'Waiting — no action',
    'Since you last looked', 'Active now + recent releases',
  ], 'OPX3-NEEDS-YOU-FIRST: SectionLabel owns exact canonical section order');
  const ordered = indices(rendered, [
    'Needs you', 'Ratification inbox',
    'Waiting — no action', 'Since you last looked', 'Active now + recent releases',
  ]);
  assert(ordered.every((at, index) => at >= 0 && (!index || at > ordered[index - 1])),
    'OPX3-NEEDS-YOU-FIRST: needs_attention renders above every later section');
  assert(rendered.includes('Choose the bounded recovery path.')
    && rendered.includes('Repair the failing contract.')
    && rendered.includes('Ratify →'),
  'OPX3-NEEDS-YOU-FIRST: each item keeps why text and only an artifact-backed ratify link');
  assert.strictEqual(flatten(container).filter((entry) => entry.textContent === 'Ratify →').length, 1,
    'OPX3-NEEDS-YOU-FIRST: a projected path without a live pending artifact never becomes a dead link');
  const needsLinks = descendants(container, 'operator-station-link');
  assert(needsLinks.length >= 7 && needsLinks.every((entry) => entry.tag === 'a'),
    'OPX3-NEEDS-YOU-FIRST: cards, epics, artifacts, and successors are real anchors');
  const firstCard = needsLinks.find((entry) => entry.textContent === 'GA-H1a Choose bounded path');
  const ratify = needsLinks.find((entry) => entry.textContent === 'Ratify →');
  assert(firstCard && ratify, 'OPX3-NEEDS-YOU-FIRST: live card and ratification anchors exist');
  firstCard.listeners.click({ preventDefault() {} });
  ratify.listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(opened.slice(-2), [
    ['GA-H1a Choose bounded path', stationPath, false],
    [`${ratificationDir}/GA-H1a`, stationPath, false],
  ], 'OPX3-NEEDS-YOU-FIRST: anchor click handlers route to exact internal targets');
  const exactAction = descendants(container, 'operator-station-exact-action')[0];
  const exactActionLinks = descendants(exactAction, 'operator-station-link');
  const exactActionCard = exactActionLinks.find((entry) => entry.textContent === 'GA-H1a Choose bounded path');
  const exactActionLink = exactActionLinks.find((entry) => entry.textContent === `${ratificationDir}/GA-H1a`);
  assert(exactActionCard && exactActionLink
    && !textOf(exactAction).includes('[['),
  'OPX3-NEEDS-YOU-FIRST: projected exact-action card and ratification targets are real anchors, never literal bracket text');
  assert.strictEqual(textOf(exactAction).replace(/\n/g, ''),
    `Ratify GA-H1a Choose bounded path in ${ratificationDir}/GA-H1a — Choose the bounded recovery path.`,
    'OPX3-MIXED-EXACT-ACTION-TEXT-PRESERVATION: ratification action preserves every visible instruction segment around its anchors');
  exactActionCard.listeners.click({ preventDefault() {} });
  exactActionLink.listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(opened.slice(-2), [
    ['GA-H1a Choose bounded path', stationPath, false],
    [`${ratificationDir}/GA-H1a`, stationPath, false],
  ], 'OPX3-NEEDS-YOU-FIRST: exact-action anchors open the projected card and artifact');

  const reviewActionPayload = {
    ...payload,
    updated_at: '2026-07-26T16:00:00Z',
    exact_action: 'Review GA-H5a Repair fixture — Repair the failing contract.',
    needs_attention: [payload.needs_attention[1]],
  };
  const reviewActionContainer = element();
  station._renderHeadline(reviewActionContainer, reviewActionPayload, stationPath);
  const reviewAction = descendants(reviewActionContainer, 'operator-station-exact-action')[0];
  const reviewActionLink = descendants(reviewAction, 'operator-station-link')[0];
  assert(reviewActionLink && reviewActionLink.textContent === 'GA-H5a Repair fixture'
    && textOf(reviewAction) === 'Review \nGA-H5a Repair fixture\n — Repair the failing contract.',
  'OPX3-NON-RATIFICATION-EXACT-ACTION-NAVIGATION: producer-shaped review action anchors its exact card and preserves the instruction');
  reviewActionLink.listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(opened.at(-1), ['GA-H5a Repair fixture', stationPath, false],
    'OPX3-NON-RATIFICATION-EXACT-ACTION-NAVIGATION: non-ratification action opens the exact projected card');
  const mixedActionPayload = {
    ...reviewActionPayload,
    exact_action: 'Review GA-H5a Repair fixture — Compare [[GA-DEP1 Dependency]] before repair.',
  };
  const mixedActionContainer = element();
  station._renderHeadline(mixedActionContainer, mixedActionPayload, stationPath);
  const mixedLinks = descendants(mixedActionContainer, 'operator-station-link');
  assert.deepStrictEqual(mixedLinks.map((entry) => entry.textContent), [
    'GA-H5a Repair fixture', 'GA-DEP1 Dependency',
  ], 'OPX3-NON-RATIFICATION-EXACT-ACTION-NAVIGATION: embedded why wikilinks never make the producer card inert');
  assert.strictEqual(textOf(descendants(mixedActionContainer, 'operator-station-exact-action')[0])
    .replace(/\n/g, ''),
    'Review GA-H5a Repair fixture — Compare GA-DEP1 Dependency before repair.',
    'OPX3-MIXED-EXACT-ACTION-TEXT-PRESERVATION: review action preserves every visible instruction segment around its anchors');
  mixedLinks[0].listeners.click({ preventDefault() {} });
  mixedLinks[1].listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(opened.slice(-2), [
    ['GA-H5a Repair fixture', stationPath, false],
    ['GA-DEP1 Dependency', stationPath, false],
  ], 'OPX3-NON-RATIFICATION-EXACT-ACTION-NAVIGATION: mixed action dispatches both exact internal targets');

  assert(rendered.includes('last projected 30h ago') && rendered.includes('/delivery-status'),
    'OPX3-STALENESS-BANNER: older-than-24h payload names age and live-status command');
  const openedBeforeFallback = opened.length;
  const fallbackCommandContainer = element();
  station._renderHeadline(fallbackCommandContainer, payload, stationPath);
  const staleBanner = descendants(fallbackCommandContainer, 'operator-station-stale')[0];
  const command = descendants(staleBanner, 'operator-station-command')[0];
  assert(command?.tag === 'code' && command.textContent === '/delivery-status'
    && command.style.cssText.includes('user-select:all')
    && !command.listeners.click
    && descendants(staleBanner, 'operator-station-link').length === 0,
  'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: absent runtime command fails closed to an honest selectable instruction, never a dead note anchor');
  assert.strictEqual(opened.length, openedBeforeFallback,
    'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: rendering the absent-command fallback never calls openLinkText');
  assert(!opened.some(([target]) => target === 'delivery:status'),
    'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: render never dispatches delivery:status through openLinkText');

  const dispatchedCommands = [];
  global.app.commands = {
    commands: { 'delivery:status': { id: 'delivery:status' } },
    executeCommandById: (id) => dispatchedCommands.push(id),
  };
  const registeredCommandContainer = element();
  station._renderHeadline(registeredCommandContainer, payload, stationPath);
  const registeredCommand = descendants(
    registeredCommandContainer, 'operator-station-command',
  )[0];
  assert(registeredCommand?.tag === 'button'
    && registeredCommand.textContent === '/delivery-status'
    && typeof registeredCommand.listeners.click === 'function',
  'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: exact registered runtime command renders as a user action');
  const openedBeforeDispatch = opened.length;
  registeredCommand.listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(dispatchedCommands, ['delivery:status'],
    'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: user action dispatches only the exact registered command id');
  assert.strictEqual(opened.length, openedBeforeDispatch,
    'OPX3-DELIVERY-STATUS-COMMAND-DISPATCH: registered command dispatch never calls openLinkText');
  global.app.commands = {
    commands: {},
    executeCommandById: mutator('commands.executeCommandById'),
  };
  assert(rendered.includes('since your last delivery:status read (2026-07-24)'),
    'OPX3-SINCE-HONEST-LABEL: projected marker date labels the digest honestly');
  assert.deepStrictEqual(mutations, [],
    'OPX3-SINCE-HONEST-LABEL: render never writes the digest marker or any vault byte');

  assert.deepStrictEqual(descendants(container, 'operator-station-ratification-row')
    .map((row) => textOf(row).split('\n')[0]), ['GA-H1a'],
  'OPX3-CORE-FOLDER-TRUTH: only direct pending ratification artifacts in the exact folder render');
  assert(rendered.includes('Decision needed for GA-H1a Choose bounded path'),
    'ratification inbox renders a one-line ask from target_card');
  assert(!rendered.includes('Already settled') && !rendered.includes('Nested') && !rendered.includes('Wrong project'),
    'OPX3-CORE-FOLDER-TRUTH: consumed, nested, and foreign artifacts stay excluded');
  assert(descendants(container, 'operator-station-waiting')[0]?.tag === 'details'
    && descendants(container, 'operator-station-waiting')[0]?.open === false,
  'waiting is count-first and collapsed by default');
  assert(rendered.includes('1 waiting — no action'), 'waiting summary names its count');
  assert(rendered.includes('Old route') && rendered.includes('Superseded by the bounded route.')
    && rendered.includes('Bounded convergence') && rendered.includes('delegate')
    && rendered.includes('v0.265.0'),
  'since and active/release sections render all projected feed families');

  for (const chip of descendants(container, 'operator-station-chip')) {
    assert(chip.style.cssText.includes('background:color-mix(in srgb,')
      && chip.style.cssText.includes('12%, transparent)')
      && chip.style.cssText.includes('border:1px solid color-mix(in srgb,')
      && chip.style.cssText.includes('35%, transparent)'),
    'status chips reuse the shared color-mix recipe');
  }
  const helperSource = fs.readFileSync(HELPER, 'utf8');
  assert(!helperSource.includes('MarkdownRenderer'), 'helper builds DOM anchors without MarkdownRenderer');
  assert(!helperSource.includes('dv.current'), 'cold-load path never uses raw dv.current');
  assert(!helperSource.includes('createEl("h2"') && !helperSource.includes("createEl('h2'"),
    'note-chrome sections emit no H2');
  assert(!helperSource.includes('"---"') && !helperSource.includes("'---'"),
    'note-chrome helper emits no literal horizontal rule');

  currentPage = {
    ...payload,
    updated_at: '2026-07-26T16:00:00Z',
    exact_action: null,
    active: null,
    needs_attention: [],
    waiting: [],
    since: {
      marker_at: null,
      discards: [], discards_overflow_count: 0,
      self_ratified: [], self_ratified_overflow_count: 0,
      cutover_flips: [], cutover_flips_overflow_count: 0,
      ratified: [], ratified_overflow_count: 0,
    },
    releases_recent: [],
    tombstone_residue: [{
      card: 'GA-X1a Residual note',
      path: `${vaultRoot}/spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md`,
      heal: 'reap',
    }],
    counts: { needs_attention: 0, waiting: 0, frozen: 0, done: 31, tombstone_residue: 1 },
    file: { path: stationPath, folder: 'spice/projects/sauce' },
  };
  global.app.vault.getMarkdownFiles = () => [];
  const residueContainer = element();
  await station.render({ container: residueContainer });
  const residueText = textOf(residueContainer);
  assert(residueText.includes('1 tombstone residue detected')
    && residueText.includes('GA-X1a Residual note') && residueText.includes('heal: reap'),
  'OPX3-TOMBSTONE-RESIDUE-ATTENTION: valid deployed residue is visibly surfaced with its repair');
  assert(residueText.includes('Nothing needs you.'),
    'OPX3-TOMBSTONE-RESIDUE-ATTENTION: attention-lite residue does not invent a Will action');
  const residueLink = descendants(residueContainer, 'operator-station-link')
    .find((entry) => entry.textContent === 'GA-X1a Residual note');
  residueLink.listeners.click({ preventDefault() {} });
  assert.deepStrictEqual(opened.at(-1), [
    'spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note',
    stationPath,
    false,
  ], 'OPX3-ABSOLUTE-RESIDUE-PATH-NAVIGATION: production absolute path becomes the exact vault-relative note');
  global.app.vault.getMarkdownFiles = () => [
    file('spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md'),
  ];
  assert.strictEqual(
    station._vaultRelativePath(
      '/tmp/outside-vault/spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md',
    ),
    null,
    'OPX3-ABSOLUTE-RESIDUE-PATH-NAVIGATION: a known desktop root rejects even a unique matching suffix outside the vault',
  );
  const desktopBase = global.app.vault.adapter.basePath;
  delete global.app.vault.adapter.basePath;
  assert.strictEqual(
    station._vaultRelativePath(
      '/projected/desktop/root/spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md',
    ),
    'spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md',
    'OPX3-ABSOLUTE-RESIDUE-PATH-NAVIGATION: adapters without a desktop root recover one exact vault suffix',
  );
  global.app.vault.getMarkdownFiles = () => [
    file('GA-X1a Residual note.md'),
    file('board/GA-X1a Residual note.md'),
  ];
  assert.strictEqual(
    station._vaultRelativePath(
      '/projected/desktop/root/board/GA-X1a Residual note.md',
    ),
    null,
    'OPX3-ROOTLESS-RESIDUE-AMBIGUITY-FAIL-CLOSED: overlapping rootless suffix matches refuse instead of opening either note',
  );
  assert.strictEqual(
    station._vaultRelativePath(
      '/projected/desktop/root/board/GA-X1a Missing note.md',
    ),
    null,
    'OPX3-ROOTLESS-RESIDUE-AMBIGUITY-FAIL-CLOSED: a rootless path with zero suffix matches refuses',
  );
  global.app.vault.adapter.basePath = desktopBase;
  assert.strictEqual(
    station._vaultRelativePath('spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md'),
    'spice/projects/sauce/tasks/Loop Ops/board/GA-X1a Residual note.md',
    'OPX3-ABSOLUTE-RESIDUE-PATH-NAVIGATION: existing vault-relative projections remain compatible',
  );

  currentPage = {
    ...payload, updated_at: '2026-07-26T16:00:00Z', needs_attention: [], waiting: [],
    since: {
      marker_at: null,
      discards: [], discards_overflow_count: 0,
      self_ratified: [], self_ratified_overflow_count: 0,
      cutover_flips: [], cutover_flips_overflow_count: 0,
      ratified: [], ratified_overflow_count: 0,
    },
    active: null, releases_recent: [], exact_action: null,
    releases_recent_overflow_count: 0,
    counts: { needs_attention: 0, waiting: 0, frozen: 0, done: 31, tombstone_residue: 0 },
    file: { path: stationPath, folder: 'spice/projects/sauce' },
  };
  global.app.vault.getMarkdownFiles = () => [];
  sections.length = 0;
  const emptyContainer = element();
  await station.render({ container: emptyContainer });
  const emptyText = textOf(emptyContainer);
  assert(emptyText.includes('Nothing needs you.'),
    'OPX3-CORE-EMPTY-PAYLOAD: calm required empty state is visible');
  assert(!emptyText.includes('last projected') && !emptyText.includes('Ratification inbox')
    && !emptyText.includes('Waiting — no action') && !emptyText.includes('Since you last looked')
    && !emptyText.includes('Active now + recent releases'),
  'OPX3-CORE-EMPTY-PAYLOAD: fresh empty optional sections render nothing');
  assert.deepStrictEqual(sections, ['Needs you'], 'only the required empty section owns a label');

  for (const broken of [
    { file: { path: stationPath } },
    { type: 'loop-station', schema_version: '1.0.0', file: { path: stationPath } },
    { ...payload, needs_attention: null, file: { path: stationPath } },
  ]) {
    currentPage = broken;
    const recovery = element();
    await station.render({ container: recovery });
    assert(textOf(recovery).includes('Operator state unavailable'),
      'OPX3-CORE-RECOVERY: missing or partial payload renders a visible recovery line');
  }

  const partialLists = [
    {
      label: 'needs_attention', path: ['needs_attention'],
      missing: {
        epic: 'Loop Ops', bucket: 'refutation', why: 'Missing canonical card.',
        ratification: null,
      },
    },
    {
      label: 'waiting', path: ['waiting'],
      missing: {
        epic: 'Loop Ops', bucket: 'deploy-wait', why: 'Missing canonical card.',
      },
    },
    {
      label: 'releases_recent', path: ['releases_recent'],
      missing: {},
    },
    {
      label: 'tombstone_residue', path: ['tombstone_residue'],
      missing: { path: '/tmp/residue.md', heal: 'reap' },
    },
    {
      label: 'since.discards', path: ['since', 'discards'],
      missing: {
        reason: 'Superseded.', superseded_by: null, discarded_at: '2026-07-25T09:00:00Z',
      },
    },
    {
      label: 'since.self_ratified', path: ['since', 'self_ratified'],
      missing: { date: '2026-07-25' },
    },
    {
      label: 'since.cutover_flips', path: ['since', 'cutover_flips'],
      missing: { at: '2026-07-25T12:00:00Z' },
    },
    {
      label: 'since.ratified', path: ['since', 'ratified'],
      missing: {
        authority: 'delegate', at: '2026-07-25T13:00:00Z', artifact_path: null,
      },
    },
  ];
  const malformedEntries = [
    ['null', null],
    ['scalar', 7],
    ['array', []],
  ];
  for (const projected of partialLists) {
    for (const [kind, malformed] of [
      ...malformedEntries, ['missing-required-field', projected.missing],
    ]) {
      const partial = JSON.parse(JSON.stringify(payload));
      let target = partial;
      for (const segment of projected.path.slice(0, -1)) target = target[segment];
      target[projected.path.at(-1)] = [malformed];
      partial.file = { path: stationPath, folder: 'spice/projects/sauce' };
      assert.strictEqual(station._validPayload(partial), false,
        `OPX3-PARTIAL-PAYLOAD-RECOVERY: ${projected.label} rejects ${kind} before render`);
      currentPage = partial;
      const recovery = element();
      await station.render({ container: recovery });
      assert.strictEqual(descendants(recovery, 'operator-station-recovery').length, 1,
        `OPX3-PARTIAL-PAYLOAD-RECOVERY: ${projected.label} ${kind} renders one recovery state`);
      assert.strictEqual(descendants(recovery, 'operator-station-headline').length, 0,
        `OPX3-PARTIAL-PAYLOAD-RECOVERY: ${projected.label} ${kind} emits no partial headline`);
      assert.strictEqual(descendants(recovery, 'section-label').length, 0,
        `OPX3-PARTIAL-PAYLOAD-RECOVERY: ${projected.label} ${kind} emits no section shell`);
      assert.strictEqual(textOf(recovery),
        'Operator state unavailable — run delivery:status, then reinstall project if needed.',
        `OPX3-PARTIAL-PAYLOAD-RECOVERY: ${projected.label} ${kind} recovery is the only visible state`);
    }
  }

  currentPage = { ...payload, file: { path: stationPath, folder: 'spice/projects/sauce' } };
  const recoveryReplacement = new OperatorStation({
    now: () => new Date('2026-07-26T16:30:00Z'),
    deliveryApi: { normalizeStatus: (value) => value },
  });
  recoveryReplacement._renderNeeds = (_dv, root) => {
    root.createEl('div', { text: 'misleading partial section' });
    throw new Error('fixture render failure');
  };
  const replacementContainer = element();
  await recoveryReplacement.render({ container: replacementContainer });
  assert.strictEqual(descendants(replacementContainer, 'operator-station-recovery').length, 1,
    'OPX3-PARTIAL-PAYLOAD-RECOVERY: unexpected render failure replaces partial station with one recovery');
  assert(!textOf(replacementContainer).includes('misleading partial section')
    && descendants(replacementContainer, 'operator-station-headline').length === 0
    && descendants(replacementContainer, 'section-label').length === 0,
  'OPX3-PARTIAL-PAYLOAD-RECOVERY: recovery replacement removes every partial headline and section shell');

  currentPage = { ...payload, file: { path: stationPath } };
  const noDelivery = element();
  await new OperatorStation({
    now: () => new Date('2026-07-26T16:30:00Z'),
    deliveryApi: {},
  }).render({ container: noDelivery });
  assert(textOf(noDelivery).includes('Delivery unavailable'),
    'OPX3-CORE-DELIVERY-RECOVERY: missing Delivery API renders recovery, never blank or throw');

  const deliveryManifest = JSON.parse(read('platform/mechanisms/delivery/manifest.json'));
  const installedSources = new Map(deliveryManifest.files
    .filter((entry) => ['index.js', 'scripts/delivery-contract.js', 'data/delivery-schema.json'].includes(entry.source))
    .map((entry) => [
      entry.dest.replace('{{content_path}}', 'ranch/content'),
      read(`platform/mechanisms/delivery/${entry.source}`),
    ]));
  global.app.vault.adapter.read = async (entry) => {
    if (entry === 'ranch/platform-config.json') return JSON.stringify({ variables: {} });
    if (!installedSources.has(entry)) throw new Error(`unexpected installed artifact ${entry}`);
    return installedSources.get(entry);
  };
  const resolvedDelivery = await new OperatorStation()._deliveryApi();
  assert.strictEqual(typeof resolvedDelivery?.normalizeStatus, 'function',
    'OPX3-CORE-INSTALLED-ARTIFACT: helper resolves the installed public Delivery boundary');

  const coldContainer = element();
  let coldCurrentTouches = 0;
  delete global.customJS.RenderSafe;
  await station.render(new Proxy({ container: coldContainer }, {
    get(target, property) {
      if (property === 'current') coldCurrentTouches += 1;
      return target[property];
    },
  }));
  assert.strictEqual(coldContainer.children.length, 0, 'OPX3-CORE-COLD-LOAD: RenderSafe absence is a no-op');
  assert.strictEqual(coldCurrentTouches, 0, 'OPX3-CORE-COLD-LOAD: no Dataview current alias is touched');

  const projectManifest = JSON.parse(read('platform/blueprints/project/manifest.json'));
  assert.strictEqual(projectManifest.customjs_classes.filter((name) => name === 'OperatorStation').length, 1,
    'OPX3-CORE-INSTALLED-ARTIFACT: project registers OperatorStation exactly once');
  assert.strictEqual(projectManifest.files.filter((entry) => entry.source === 'helpers/operator-station.js'
    && entry.dest === '{{scripts_path}}/project/operator-station.js').length, 1,
  'OPX3-CORE-INSTALLED-ARTIFACT: installer maps the helper to scripts_path exactly once');
  assert(projectManifest.depends_on.some((entry) => entry.name === 'delivery'),
    'OPX3-CORE-INSTALLED-ARTIFACT: project keeps its installed Delivery dependency');
  const packageJson = JSON.parse(read('package.json'));
  assert.strictEqual(packageJson.scripts['test:operator-station'], 'node platform/test/run-operator-station.js',
    'package exposes the focused harness');
  assert.strictEqual((packageJson.scripts['release:preflight']
    .match(/node platform\/test\/run-operator-station\.js/g) || []).length, 1,
  'release preflight registers the harness exactly once');

  const visual = fs.readFileSync(VISUAL, 'utf8');
  for (const token of [
    'operator-fixture phone theme-light', 'operator-fixture phone theme-dark',
    'operator-fixture desktop theme-light', 'operator-fixture desktop theme-dark',
    'Needs you', 'Ratification inbox', 'Waiting — no action',
    'Since you last looked', 'Active now + recent releases', 'tombstone residue detected',
  ]) assert(visual.includes(token), `visual fixture includes ${token}`);
  const chromeCandidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].filter(Boolean);
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  assert(chrome, 'OPX3-CORE-390PX: Chrome is required for rendered geometry proof');
  const profiles = [fs.mkdtempSync(path.join(os.tmpdir(), 'operator-station-390-')),
    fs.mkdtempSync(path.join(os.tmpdir(), 'operator-station-desktop-'))];
  try {
    const phone = await renderGeometry(chrome, profiles[0], 390);
    const desktop = await renderGeometry(chrome, profiles[1], 1024);
    assert.strictEqual(phone.geometry, 'pass', `OPX3-CORE-390PX: ${phone.result}`);
    assert.strictEqual(desktop.geometry, 'pass', `operator desktop geometry: ${desktop.result}`);
  } finally {
    for (const profile of profiles) fs.rmSync(profile, { recursive: true, force: true });
  }

  assert.deepStrictEqual(mutations, [], 'all OperatorStation paths remain strictly read-only');
  console.log('operator-station tests: ok');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
