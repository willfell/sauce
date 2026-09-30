#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { captureViewport, chromeExecutable } = require('./chrome-cdp');

process.env.TZ = 'UTC';

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/board-health.js');
const VISUAL = path.join(ROOT, 'platform/test/visual/board-health.html');
const COORDINATOR = path.join(ROOT, 'scripts/autoloop/codex-coordinator.js');
const ASSERTION_FLOOR = 805;
const VISUAL_CHECK_FLOOR = 158;
const IN_PROCESS_HEADLINES = 76;
const VALIDATION_TABLE_FIELDS = 44;
const VALIDATION_TABLE_ROWS = 251;
const CHROME_HEADLINES = [
  ['full-light', 'At least 2014 findings need action in this clone'],
  ['healthy-light', 'Board healthy'],
  ['throws-light', 'At least 2014 findings need action in this clone'],
  ['full-dark', 'At least 2014 findings need action in this clone'],
  ['healthy-dark', 'Board healthy'],
  ['throws-dark', 'At least 2014 findings need action in this clone'],
];
const CHROME_MOUNTS = ['full', 'healthy', 'broken', 'throws'].map((name) => `${name}-light`)
  .concat(['full', 'healthy', 'broken', 'throws'].map((name) => `${name}-dark`));
const CHROME_CHECKS = ['viewport', 'document-overflow', ...CHROME_MOUNTS.flatMap((mount) => [
  'state', 'scope', 'remedy-code', 'not-listed', 'footer', 'lines',
  'details-collapsed', 'tags', 'outline', 'rows', 'link-clicks', 'rows-stack', 'summary-marker', 'tap-label-centred',
  ...(mount.startsWith('full-') ? ['unbroken-card-wraps', 'headline-wraps-at-390'] : []),
  'section-overflow', 'escaped', 'scrolling', 'short-targets', 'target-count',
].map((check) => `${mount}:${check}`))];
const RECOVERY = 'Board health unavailable — run board-health --json, then reinstall project if needed.';
const DRIFT_REMEDY = 'heal-epic-bindings --dry-run --json';
const CROSS_CLONE = 'cross-clone: no action in this clone';
const NOTE_PATH = 'spice/projects/sauce/Board Health.md';
const FOOTER_TIME = Date.UTC(2026, 7, 23, 21, 18, 42);
const FOOTER = 'footer: Note file last changed 2026-08-23 21:18';
const skippedBanner = (ledger) => `banner: Ledger ${ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`;

let asserted = 0;
let finished = false;
function check(condition, message) { asserted += 1; assert(condition, message); }
function eq(actual, expected, message) { asserted += 1; assert.deepStrictEqual(actual, expected, message); }
process.on('exit', () => {
  if (!finished) {
    console.error('board-health tests: exited before the last assertion ran');
    process.exitCode = 1;
  } else if (asserted !== ASSERTION_FLOOR) {
    console.error(`board-health tests: ran ${asserted} assertions; ASSERTION_FLOOR is ${ASSERTION_FLOOR}`);
    process.exitCode = 1;
  }
});

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function helperSource() { return fs.readFileSync(HELPER, 'utf8'); }
function loadClass() { return eval(`(${fs.readFileSync(HELPER, 'utf8')})`); } // eslint-disable-line no-eval

const created = [];
function element(tag = 'div', options = {}) {
  const node = {
    tag, className: options.cls || '', textContent: options.text || '', href: '',
    style: { cssText: '' }, children: [], listeners: {}, parent: null, open: false,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions);
      child.parent = this;
      this.children.push(child);
      return child;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelector(selector) {
      if (selector !== ':scope > .board-health-root') return null;
      return this.children.find((child) => child.className.split(/\s+/).includes('board-health-root')) || null;
    },
    replaceChildren() { this.children = []; },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    },
  };
  created.push(node);
  return node;
}
function flatten(root, out = []) {
  out.push(root);
  for (const child of root.children || []) flatten(child, out);
  return out;
}
function lines(root) { return flatten(root).map((node) => node.textContent).filter(Boolean); }
function joined(node) { return flatten(node).map((entry) => entry.textContent).join(''); }
function byClass(root, className) {
  return flatten(root).filter((node) => node.className.split(/\s+/).includes(className));
}
function rows(node) { return node.children.filter((child) => child.className === 'board-health-row'); }
function rowTitles(node) {
  return rows(node).flatMap((row) => row.children.filter((child) => child.className === 'board-health-link')
    .map((link) => link.textContent));
}
function rowDetails(node) {
  return rows(node).map((row) => row.children.filter((child) => child.className !== 'board-health-link').map(joined));
}
function sectionBody(root, label) {
  const at = root.children.findIndex((child) => child.className === 'section-label' && child.textContent === label);
  return at < 0 ? null : root.children[at + 1];
}

const mutations = [];
const opened = [];
const mutator = (name) => () => {
  mutations.push(name);
  throw new Error(`read-only fixture invoked ${name}`);
};
const vaultStats = new Map();
global.app = {
  vault: {
    getAbstractFileByPath: (target) => (vaultStats.has(target) ? { path: target, stat: vaultStats.get(target) } : null),
    create: mutator('vault.create'), createBinary: mutator('vault.createBinary'),
    modify: mutator('vault.modify'), modifyBinary: mutator('vault.modifyBinary'),
    process: mutator('vault.process'), append: mutator('vault.append'),
    delete: mutator('vault.delete'), rename: mutator('vault.rename'), trash: mutator('vault.trash'),
    adapter: {
      write: mutator('adapter.write'), writeBinary: mutator('adapter.writeBinary'),
      append: mutator('adapter.append'), process: mutator('adapter.process'),
      remove: mutator('adapter.remove'), rename: mutator('adapter.rename'), copy: mutator('adapter.copy'),
      mkdir: mutator('adapter.mkdir'), rmdir: mutator('adapter.rmdir'),
      trashSystem: mutator('adapter.trashSystem'), trashLocal: mutator('adapter.trashLocal'),
    },
  },
  metadataCache: { trigger: mutator('metadataCache.trigger'), save: mutator('metadataCache.save') },
  fileManager: {
    processFrontMatter: mutator('fileManager.processFrontMatter'), renameFile: mutator('fileManager.renameFile'),
  },
  workspace: { openLinkText: (...args) => opened.push(args) },
  commands: { commands: {}, executeCommandById: mutator('commands.executeCommandById') },
};
const sections = [];
let currentPage = null;
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

function payload(overrides = {}) {
  return {
    type: 'board-health',
    schema_version: '1.0.0',
    project: 'sauce',
    ledger: 'present',
    no_op: false,
    checked: { epics: 20, slices: 185, records: 137 },
    untracked_members: [],
    untracked_members_overflow_count: 0,
    untracked_members_by_provenance: { coordinator: 0, foreign: 0 },
    unprojectable_epics: [],
    unprojectable_epics_overflow_count: 0,
    binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY },
    lane_divergence: [],
    lane_divergence_overflow_count: 0,
    projection_errors: [],
    projection_errors_overflow_count: 0,
    foreign_writes: [],
    foreign_writes_overflow_count: 0,
    ...overrides,
  };
}
function member(card, provenance, extra = {}) {
  return {
    epic: 'Perf Epic', card, note_status: 'completed',
    stamp: provenance === 'coordinator' ? '2026-07-29T16:30:37.343Z' : null, provenance,
    issue: 'board member has no ledger record; a completed note is never counted done',
    remedy: provenance === 'coordinator' ? CROSS_CLONE : 'adopt',
    ...extra,
  };
}
function lane(epic, derived, painted, agrees) { return { epic, derived, painted, agrees }; }

const COLOUR = '(?:var\\(--[a-z0-9-]+\\)|color-mix\\(in srgb, var\\(--[a-z0-9-]+\\) \\d+%, transparent\\))';
const COLOUR_GRAMMAR = {
  color: new RegExp(`^${COLOUR}$`),
  background: new RegExp(`^${COLOUR}$`),
  border: new RegExp(`^\\d+px solid ${COLOUR}$`),
  'border-bottom': new RegExp(`^\\d+px solid ${COLOUR}$`),
  'text-decoration': /^none$/,
};
const NON_COLOUR_PROPERTIES = [
  'align-items', 'border-radius', 'cursor', 'display', 'font-family', 'font-size', 'font-weight', 'gap', 'line-height',
  'max-width', 'min-height', 'min-width', 'overflow', 'overflow-wrap', 'padding', 'padding-top', 'user-select',
  'white-space', 'word-break',
];
const COLOUR_RULE = 'either sets one of the 19 properties in NON_COLOUR_PROPERTIES, sets text-decoration to none, or sets color or background to a var(--…) token or a color-mix(in srgb, var(--…) N%, transparent), or border or border-bottom to Npx solid and one of those';
const NAMED_COLOURS = `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen
darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/);
const SYSTEM_COLOURS = `AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field FieldText
GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText VisitedText ActiveBorder ActiveCaption
AppWorkspace Background ButtonHighlight ButtonShadow CaptionText InactiveBorder InactiveCaption InactiveCaptionText
InfoBackground InfoText Menu MenuText Scrollbar ThreeDDarkShadow ThreeDFace ThreeDHighlight ThreeDLightShadow ThreeDShadow
Window WindowFrame WindowText`.split(/\s+/);
const COLOUR_KEYWORDS = new Set([...NAMED_COLOURS, ...SYSTEM_COLOURS, 'transparent', 'currentcolor'].map((name) => name.toLowerCase()));
const ALLOWED_COLOR_MIX = /color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, transparent\)/g;
const ALLOWED_ESCAPES = ['\\"', "\\'", '\\`'];
function stringLiterals(source, escapes = []) {
  const out = [];
  let at = 0;
  const escaped = () => {
    const pair = source.slice(at, at + 2);
    escapes.push(pair);
    at += 2;
    return ALLOWED_ESCAPES.includes(pair) ? pair[1] : pair;
  };
  const readQuoted = (quote) => {
    let text = '';
    at += 1;
    while (at < source.length && source[at] !== quote) {
      if (source[at] === '\\') { text += escaped(); } else { text += source[at]; at += 1; }
    }
    at += 1;
    return text;
  };
  const scan = (insideExpression) => {
    let depth = 0;
    while (at < source.length) {
      const char = source[at];
      if (char === '/' && source[at + 1] === '/') { const end = source.indexOf('\n', at); at = end < 0 ? source.length : end; continue; }
      if (char === '/' && source[at + 1] === '*') { const end = source.indexOf('*/', at + 2); at = end < 0 ? source.length : end + 2; continue; }
      if (char === '"' || char === "'") { out.push(readQuoted(char)); continue; }
      if (char === '`') {
        let text = '';
        at += 1;
        while (at < source.length && source[at] !== '`') {
          if (source[at] === '\\') { text += escaped(); } else if (source[at] === '$' && source[at + 1] === '{') {
            at += 2;
            scan(true);
            text += ' ';
          } else { text += source[at]; at += 1; }
        }
        at += 1;
        out.push(text);
        continue;
      }
      if (insideExpression && char === '{') depth += 1;
      if (insideExpression && char === '}') {
        if (depth === 0) { at += 1; return; }
        depth -= 1;
      }
      at += 1;
    }
  };
  scan(false);
  return out;
}
const DECLARATION = /^\s*([a-z-]+)\s*:([\s\S]*)$/i;
function literalDeclarations(literal) {
  const parts = literal.split(';').filter((part) => part.trim());
  if (!parts.some((part) => DECLARATION.test(part))) return null;
  return parts.map((part) => {
    const match = DECLARATION.exec(part);
    return match ? [match[1].toLowerCase(), match[2].trim()] : [`not a declaration: ${part.trim()}`, ''];
  });
}
function colourKeywordHits(literal) {
  const hits = [];
  if (COLOUR_KEYWORDS.has(literal.trim().toLowerCase())) hits.push(literal.trim());
  for (const part of literal.split(';')) {
    const match = DECLARATION.exec(part);
    if (!match) continue;
    const tokens = match[2].replace(ALLOWED_COLOR_MIX, 'var(--allowed)').split(/[\s,()/!]+/);
    hits.push(...tokens.filter((token) => COLOUR_KEYWORDS.has(token.toLowerCase())).map((token) => `${match[1]}:${token}`));
  }
  return hits;
}
function declarations(cssText) {
  return cssText.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':');
    return colon < 0 ? [part, ''] : [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()];
  });
}
function cssViolations(list) {
  return list.filter(([property, value]) => !(COLOUR_GRAMMAR[property]
    ? COLOUR_GRAMMAR[property].test(value)
    : NON_COLOUR_PROPERTIES.includes(property))).map(([property, value]) => `${property}:${value}`);
}
function styleDeclarations(node) {
  const style = node.style || {};
  const assigned = Object.keys(style).filter((key) => key !== 'cssText')
    .map((key) => [key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), String(style[key])]);
  return [...declarations(style.cssText || ''), ...assigned];
}

let BoardHealth = null;
const swept = [];
function isHeadline(node) { return node.className.split(/\s+/).includes('board-health-headline'); }
function renderSwept(instance, dv) {
  const page = currentPage;
  const from = created.length;
  instance.render(dv);
  for (const node of created.slice(from).filter(isHeadline)) {
    swept.push({ site: 'in-process', node, laneOverflow: page?.lane_divergence_overflow_count });
  }
}
const outlined = new Set();
function headlineOf(rendered) {
  const headline = byClass(rendered.container, 'board-health-headline');
  return headline.length === 1 ? headline[0].textContent : null;
}
function render(page, file = { path: NOTE_PATH }) {
  currentPage = page === null ? null : { ...page, file };
  sections.length = 0;
  const container = element();
  renderSwept(new BoardHealth(), { container, current: () => { throw new Error('raw dv.current forbidden'); } });
  const root = container.children[0] || null;
  return { container, root, sections: [...sections] };
}
function summaryOf(rendered) {
  return byClass(rendered.root, 'board-health-no-action').map((node) => node.children[0].textContent);
}
function outline(root) {
  return root.children.map((child) => {
    if (child.className === 'board-health-headline') return child.textContent;
    if (child.className === 'board-health-scope') return 'scope';
    if (child.className === 'board-health-ledger-skipped') return `banner: ${child.textContent}`;
    if (child.className === 'section-label') return `label: ${child.textContent}`;
    if (child.className === 'board-health-section') return 'section';
    if (child.className === 'board-health-no-action') return `details: ${child.children[0].textContent}`;
    if (child.className === 'board-health-footer') return `footer: ${child.textContent}`;
    if (child.className === 'board-health-recovery') return `recovery: ${child.textContent}`;
    if (child.tag === 'div' && child.className === '' && !child.children.length) return `plain: ${child.textContent}`;
    return `other: ${child.tag}.${child.className}`;
  });
}
function assertOutline(root, expected, message) {
  outlined.add(root);
  eq(outline(root), expected, message);
}
function assertOutlines(roots, expected, message) {
  for (const root of roots) outlined.add(root);
  eq(roots.map(outline), expected, message);
}
function isRecovery(rendered) {
  return rendered.root.children.length === 1
    && rendered.root.children[0].tag === 'div'
    && rendered.root.children[0].className === 'board-health-recovery'
    && rendered.root.children[0].textContent === RECOVERY
    && rendered.sections.length === 0
    && byClass(rendered.container, 'board-health-headline').length === 0;
}

const LANES = ['In Planning', 'In Progress', 'Blocked', 'Completed'];
const COORDINATOR_STAMP = '2026-07-29T16:30:37.343Z';
function boardLines(lanes) {
  const all = { ...Object.fromEntries(LANES.map((name) => [name, []])), ...lanes };
  return Object.entries(all).flatMap(([name, cards]) => [
    `## ${name}`, ...cards.map((card) => `- [${name === 'Completed' ? 'x' : ' '}] [[${card}]]`), '',
  ]);
}

function scaffoldVault(root, parentLanes, epics) {
  const projectRoot = path.join(root, 'spice', 'projects', 'test');
  const cardsRoot = path.join(projectRoot, 'tasks');
  const boardPath = path.join(projectRoot, 'project-board.md');
  const prefix = 'spice/projects/test';
  fs.mkdirSync(cardsRoot, { recursive: true });
  fs.writeFileSync(boardPath, [
    '---', 'kanban-plugin: board', '---', '',
    ...boardLines(parentLanes),
    '%% kanban:settings', '{}', '%%', '',
  ].join('\n'));
  for (const [epic, spec] of Object.entries(epics)) {
    const boardDir = path.join(cardsRoot, epic, 'board');
    fs.mkdirSync(boardDir, { recursive: true });
    fs.mkdirSync(path.join(cardsRoot, epic, 'context', 'runs'), { recursive: true });
    fs.writeFileSync(path.join(cardsRoot, epic, `${epic}.md`), [
      '---', 'type: epic', 'schema_version: 1.1.0',
      `source_board: ${prefix}/project-board.md`, `kanban_board: ${prefix}/project-board.md`,
      `epic_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
      'status: planning', 'posture: claimable', '---', '', `${epic} atlas`, '',
    ].join('\n'));
    fs.writeFileSync(path.join(boardDir, `${epic}-board.md`), [
      '---', 'kanban-plugin: board', 'board_role: epic', `epic: "[[${epic}]]"`, '---', '',
      ...boardLines(spec.lanes),
    ].join('\n'));
    for (const [name, [status, stamp]] of Object.entries(spec.slices)) {
      fs.writeFileSync(path.join(boardDir, `${name}.md`), [
        '---', 'type: slice', 'schema_version: 1.1.0', `epic: "[[${epic}]]"`,
        `parent_card: "[[${epic}]]"`, `task_parent: ${prefix}/tasks/${epic}/${epic}.md`,
        `source_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
        `kanban_board: ${prefix}/tasks/${epic}/board/${epic}-board.md`,
        `status: ${status}`, ...(stamp ? [`status_changed_at: ${stamp}`] : []),
        'depends_on: []', '---', '', `${name} body`, '',
      ].join('\n'));
    }
  }
  return { projectRoot, cardsRoot, boardPath };
}

async function productionNote(parentLanes, epics, records, { stateFile = false, prepare = null } = {}) {
  const coordinator = require(COORDINATOR);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-health-vault-'));
  try {
    const fixture = scaffoldVault(root, parentLanes, epics);
    if (prepare) prepare(fixture);
    if (stateFile) fs.writeFileSync(path.join(root, 'state.json'), '{}\n');
    const state = coordinator.emptyState();
    for (const record of records) state.cards[record.card] = record;
    const receipt = await coordinator.commandBoardHealth(
      { root, statePath: path.join(root, 'state.json') },
      { json: true, 'write-note': true },
      {
        boardPath: fixture.boardPath, cardsRoot: fixture.cardsRoot,
        withLock: async (_ctx, _name, fn) => fn(), readState: () => state,
      },
    );
    return { receipt, raw: fs.readFileSync(path.join(fixture.projectRoot, 'Board Health.md'), 'utf8') };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function frontmatterJson(raw) {
  const block = /^---\n([\s\S]*?)\n---/.exec(raw);
  const parsed = {};
  const unparsed = [];
  for (const line of (block ? block[1] : '').split('\n')) {
    if (!line.trim()) continue;
    const match = /^([a-z_]+): (.*)$/.exec(line);
    if (!match) { unparsed.push(line); continue; }
    try { parsed[match[1]] = JSON.parse(match[2]); } catch (_e) { unparsed.push(line); }
  }
  return { parsed, unparsed };
}

async function classAndProduction() {
  const { receipt, raw } = await productionNote({ 'In Planning': ['Stale Epic'], 'In Progress': ['Mixed Epic'] }, {
    'Stale Epic': { lanes: { 'In Progress': ['ST-1'] }, slices: { 'ST-1': ['in_progress'] } },
    'Mixed Epic': {
      lanes: { 'In Progress': ['MX-2'], Completed: ['MX-1', 'MX-3'] },
      slices: { 'MX-1': ['completed'], 'MX-2': ['in_progress'], 'MX-3': ['completed', COORDINATOR_STAMP] },
    },
  }, [
    { card: 'ST-1', phase: 'implementing', projection_error: 'fixture projection refusal' },
    {
      card: 'MX-2', phase: 'implementing',
      foreign_write: { detected_at: '2026-08-01T10:00:00.000Z', expected_sha: 'a'.repeat(64), actual_sha: 'b'.repeat(64) },
    },
  ]);
  check(receipt.ok === true && receipt.note && receipt.note.scaffolded === true && !receipt.note_error,
    'BHV-CLASS-RESOLVES: the real coordinator scaffolds the Board Health note');
  const named = /customjs-guard", \{ class: "([A-Za-z0-9_]+)" \}/.exec(raw.slice(raw.indexOf('\n---', 4)));
  eq(named && named[1], 'BoardHealth', 'BHV-CLASS-RESOLVES: the coordinator-written body names class BoardHealth');
  BoardHealth = loadClass();
  eq(BoardHealth.name, named[1], 'BHV-CLASS-RESOLVES: the shipped helper defines the class the note names');
  const renderMethod = Object.getOwnPropertyDescriptor(BoardHealth.prototype, 'render');
  check(renderMethod && typeof renderMethod.value === 'function' && typeof BoardHealth.render === 'undefined',
    'BHV-CLASS-RESOLVES: render(dv) is an instance method');

  const { parsed, unparsed } = frontmatterJson(raw);
  eq(unparsed, [], 'BHV-PRODUCTION-PAYLOAD: each non-empty frontmatter line parses as key: JSON');
  eq(parsed.binding_drift, {
    atlases: 0, slices: 0, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY,
  }, 'BHV-PRODUCTION-PAYLOAD: the production binding_drift carries reports and report_codes');
  check(new BoardHealth()._validPayload(parsed) === true,
    'BHV-PRODUCTION-PAYLOAD: the production payload passes validation');
  const production = render(parsed, { path: 'spice/projects/test/Board Health.md' });
  eq(headlineOf(production), '4 findings need action in this clone',
    'BHV-PRODUCTION-PAYLOAD: the production payload renders its headline');
  eq(production.sections, [
    'Lane disagreements', 'Projection errors', 'Foreign writes', 'Foreign-written members', 'No action in this clone',
  ], 'BHV-PRODUCTION-PAYLOAD: the production payload renders the lane, projection-error, foreign-write, foreign-written-member, and no-action sections in that order');
  const productionOutline = [
    '4 findings need action in this clone', 'scope', 'label: Lane disagreements', 'section',
    'label: Projection errors', 'section', 'label: Foreign writes', 'section',
    'label: Foreign-written members', 'section', 'label: No action in this clone',
    'details: 1 cross-clone member · 1 agreeing lane — no action in this clone',
  ];
  assertOutline(production.root, productionOutline,
    'RR3C-SECTIONS-ASSERTED: the production payload renders its exact sections and no footer without a file time');

  const older = JSON.parse(JSON.stringify(parsed));
  delete older.binding_drift.reports;
  delete older.binding_drift.report_codes;
  check(new BoardHealth()._validPayload(older) === true,
    'BHV-PRODUCTION-PAYLOAD: binding_drift without reports and report_codes validates');
  const olderRendered = render(older);
  eq(headlineOf(olderRendered), '4 findings need action in this clone',
    'BHV-PRODUCTION-PAYLOAD: binding_drift without reports and report_codes renders a headline');
  assertOutline(olderRendered.root, productionOutline,
    'RR3C-SECTIONS-ASSERTED: binding_drift without reports and report_codes renders the same exact sections');
}

function laneOverflowBoard() {
  const epics = Array.from({ length: 24 }, (_, index) => `Epic ${String(index + 1).padStart(2, '0')}`);
  const specs = {};
  const records = [];
  epics.forEach((epic, index) => {
    const live = `${epic} live`;
    records.push({ card: live, phase: 'implementing' });
    if (index >= 21) {
      specs[epic] = { lanes: { 'In Progress': [live] }, slices: { [live]: ['in_progress'] } };
      return;
    }
    const done = [`${epic} cross-clone`];
    const slices = { [live]: ['in_progress'], [done[0]]: ['completed', COORDINATOR_STAMP] };
    if (index === 20) {
      done.push(`${epic} foreign`);
      slices[done[1]] = ['completed'];
    }
    specs[epic] = { lanes: { 'In Progress': [live], Completed: done }, slices };
  });
  return productionNote({ 'In Progress': epics.slice(0, 21), Completed: epics.slice(21) }, specs, records);
}

function uncappedActions(findings) {
  const drift = findings.binding_drift;
  return findings.lane_divergence.filter((row) => row.agrees === false).length
    + findings.projection_errors.length + findings.unprojectable_epics.length + findings.foreign_writes.length
    + findings.untracked_members_by_provenance.foreign
    + (drift.error ? 1 : drift.atlases + drift.slices + drift.orphan_lines);
}

async function honestCount() {
  const { receipt, raw } = await laneOverflowBoard();
  const { findings } = receipt;
  eq([receipt.ok, receipt.no_op, findings.lane_divergence.map((row) => row.agrees),
    findings.untracked_members_by_provenance],
  [true, false, [...Array(21).fill(true), false, false, false], { coordinator: 21, foreign: 1 }],
  'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the real coordinator reports 24 lane rows, the first 21 agreeing and the last 3 disagreeing, and one foreign-written member');
  eq(uncappedActions(findings), 4, 'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the uncapped receipt holds 4 findings that need action');
  const { parsed } = frontmatterJson(raw);
  eq([parsed.lane_divergence.length, parsed.lane_divergence.filter((row) => row.agrees === false).length,
    parsed.lane_divergence_overflow_count, parsed.untracked_members.filter((item) => item.provenance === 'foreign').length,
    parsed.untracked_members_overflow_count],
  [20, 0, 4, 0, 2],
  'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the note lists 20 agreeing lane rows, and the disagreeing rows and the foreign-written member sit in the overflow');
  const rendered = render(parsed, { path: 'spice/projects/test/Board Health.md' });
  const headline = headlineOf(rendered);
  eq(headline, 'At least 1 finding needs action in this clone',
    'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: a lane overflow beside another finding renders the count as at least N');
  const stated = Number(/\d+/.exec(headline)[0]);
  check(stated <= uncappedActions(findings)
    && uncappedActions(findings) <= stated + parsed.lane_divergence_overflow_count,
  'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the uncapped count lies between the stated count and the stated count plus the unlisted lane rows');
  eq(rendered.sections, ['Lane disagreements', 'Foreign-written members', 'No action in this clone'],
    'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the lane overflow renders the lane section beside the foreign-written members');
  eq([
    byClass(sectionBody(rendered.root, 'Lane disagreements'), 'board-health-not-listed').map(joined),
    byClass(sectionBody(rendered.root, 'Foreign-written members'), 'board-health-not-listed').map(joined),
  ], [
    ['4 more lane rows are not listed here — run board-health --json to list them'],
    ['1 foreign-written member needs adopt review and is not listed here — run board-health --json to list them'],
  ], 'RR3-HEADLINE-HONEST-UNDER-OVERFLOW: the unlisted lane rows and foreign-written member each get an overflow honesty line');
  eq(summaryOf(rendered), ['21 cross-clone members · at least 20 agreeing lanes — no action in this clone'],
    'RR3-AGREEING-SUMMARY-HEDGE: with 20 listed agreeing lanes and a lane overflow the summary reads at least 20 agreeing lanes');
  assertOutline(rendered.root, [
    'At least 1 finding needs action in this clone', 'scope', 'label: Lane disagreements', 'section',
    'label: Foreign-written members', 'section', 'label: No action in this clone',
    'details: 21 cross-clone members · at least 20 agreeing lanes — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: the lane-overflow note renders its exact sections');

  const cases = [
    ['a listed disagreeing lane, a listed agreeing lane, and a lane overflow', payload({
      lane_divergence: [lane('Stale', 'active', 'In Planning', false), lane('Calm', 'active', 'In Progress', true)],
      lane_divergence_overflow_count: 2, projection_errors_overflow_count: 1,
    }), 'At least 2 findings need action in this clone', ['at least 1 agreeing lane — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: No action in this clone']],
    ['one unlisted foreign-written member and a lane overflow', payload({
      lane_divergence_overflow_count: 5,
      untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: 0, foreign: 1 },
    }), 'At least 1 finding needs action in this clone', [],
    ['label: Lane disagreements', 'section', 'label: Foreign-written members', 'section']],
    ['two listed agreeing lanes and no listed disagreeing lane beside a lane overflow', payload({
      lane_divergence: [lane('Calm', 'active', 'In Progress', true), lane('Quiet', 'blocked', 'Blocked', true)],
      lane_divergence_overflow_count: 3,
    }), 'No listed finding needs action in this clone', ['at least 2 agreeing lanes — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: No action in this clone']],
    ['one listed agreeing lane beside one unlisted lane row', payload({
      lane_divergence: [lane('Calm', 'active', 'In Progress', true)], lane_divergence_overflow_count: 1,
    }), 'No listed finding needs action in this clone', ['at least 1 agreeing lane — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: No action in this clone']],
    ['projection errors, unprojectable epics, foreign writes, and members in overflow with no lane overflow', payload({
      lane_divergence: [lane('Stale', 'active', 'In Planning', false), lane('Calm', 'active', 'In Progress', true)],
      projection_errors_overflow_count: 2, unprojectable_epics_overflow_count: 1, foreign_writes_overflow_count: 3,
      untracked_members: [member('XC-1', 'coordinator')], untracked_members_overflow_count: 4,
      untracked_members_by_provenance: { coordinator: 2, foreign: 3 },
    }), '10 findings need action in this clone', ['2 cross-clone members · 1 agreeing lane — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
      'label: Foreign writes', 'section', 'label: Foreign-written members', 'section', 'label: No action in this clone']],
    ['one cross-clone member beside a lane overflow with no listed lane row', payload({
      untracked_members: [member('XC-1', 'coordinator')], untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
      lane_divergence_overflow_count: 2,
    }), 'No listed finding needs action in this clone', ['1 cross-clone member — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: No action in this clone']],
    ['a listed disagreeing lane and cross-clone members beside a lane overflow with no listed agreeing lane', payload({
      lane_divergence: [lane('Stale', 'active', 'In Planning', false)],
      untracked_members: [member('XC-1', 'coordinator'), member('XC-2', 'coordinator')],
      untracked_members_by_provenance: { coordinator: 2, foreign: 0 }, lane_divergence_overflow_count: 4,
    }), 'At least 1 finding needs action in this clone', ['2 cross-clone members — no action in this clone'],
    ['label: Lane disagreements', 'section', 'label: No action in this clone']],
  ];
  for (const [label, page, expected, summary, body] of cases) {
    const shown = render(page);
    eq(headlineOf(shown), expected, `RR3-HEADLINE-HONEST-UNDER-OVERFLOW: ${label} renders its literal headline`);
    eq(summaryOf(shown), summary, `RR3-AGREEING-SUMMARY-HEDGE: ${label} renders its literal no-action summary`);
    assertOutline(shown.root, [expected, 'scope', ...body, ...summary.map((text) => `details: ${text}`)],
      `RR3C-SECTIONS-ASSERTED: ${label} renders its exact sections`);
  }

  const capped = render(payload({
    lane_divergence: Array.from({ length: 20 }, (_, index) => lane(`Calm ${index + 1}`, 'active', 'In Progress', true)),
    lane_divergence_overflow_count: 0,
  }));
  eq(headlineOf(capped), 'Nothing needs action in this clone',
    'RR3C-LANE-CAP-EXACT: exactly 20 listed agreeing lanes with no lane overflow renders an exact headline');
  eq(summaryOf(capped), ['20 agreeing lanes — no action in this clone'],
    'RR3C-LANE-CAP-EXACT: exactly 20 listed agreeing lanes with no lane overflow renders the exact summary 20 agreeing lanes');
  assertOutline(capped.root, [
    'Nothing needs action in this clone', 'scope', 'label: No action in this clone',
    'details: 20 agreeing lanes — no action in this clone',
  ], 'RR3C-LANE-CAP-EXACT: exactly 20 listed agreeing lanes with no lane overflow renders only the no-action section');
}

function liveShape() {
  const crossClone = Array.from({ length: 20 }, (_, index) => member(
    `XC-${index + 1} Cross-clone member with a long descriptive card title ${index + 1}`, 'coordinator',
    { note_status: index % 2 ? 'parked' : 'completed', epic: `Epic ${String.fromCharCode(65 + (index % 4))}` },
  ));
  return payload({
    checked: { epics: 20, slices: 185, records: 137 },
    untracked_members: crossClone,
    untracked_members_overflow_count: 55,
    untracked_members_by_provenance: { coordinator: 64, foreign: 11 },
    lane_divergence: [
      lane('Agree One', 'active', 'In Progress', true),
      lane('Agree Two', 'blocked', 'Blocked', true),
      lane('Agree Three', 'blocked', 'Blocked', true),
      lane('Agree Four', 'blocked', 'Blocked', true),
      lane('Agree Five', 'blocked', 'Blocked', true),
      lane('Agree Six', 'blocked', 'Blocked', true),
      lane('Loop Ops', 'active', 'Completed', false),
      lane('Daily Sort', 'active', 'Completed', false),
    ],
  });
}

function actionableFirst() {
  const rendered = render(liveShape());
  const { root } = rendered;
  eq(headlineOf(rendered), '13 findings need action in this clone',
    'BHV-ACTIONABLE-FIRST: the first line counts the disagreeing lanes and the foreign-written members');
  check(root.children[0].className === 'board-health-headline',
    'BHV-ACTIONABLE-FIRST: the headline is the first rendered line');
  eq(rendered.sections, ['Lane disagreements', 'Foreign-written members', 'No action in this clone'],
    'BHV-ACTIONABLE-FIRST: actionable sections precede the no-action section');
  assertOutline(root, [
    '13 findings need action in this clone', 'scope', 'label: Lane disagreements', 'section',
    'label: Foreign-written members', 'section', 'label: No action in this clone',
    'details: 64 cross-clone members · 6 agreeing lanes — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: the live shape renders its exact sections');
  const first = sectionBody(root, rendered.sections[0]);
  eq(rowTitles(first), ['Loop Ops', 'Daily Sort'],
    'BHV-ACTIONABLE-FIRST: the first section lists the two disagreeing lanes');
  eq(rowDetails(first), [['board lane Completed · derived active'], ['board lane Completed · derived active']],
    'BHV-ACTIONABLE-FIRST: each disagreeing lane shows its painted lane beside its derived state');
  const foreign = sectionBody(root, 'Foreign-written members');
  eq(rowTitles(foreign), [], 'BHV-ACTIONABLE-FIRST: no foreign-written member is listed in this payload');
  eq(byClass(foreign, 'board-health-not-listed').map(joined), [
    '11 foreign-written members need adopt review and are not listed here — run board-health --json to list them',
  ], 'BHV-ACTIONABLE-FIRST: the overflow honesty line counts the unlisted foreign-written members and names board-health --json');
  eq([...new Set(flatten(rendered.container).map((node) => node.tag))].sort(),
    ['a', 'code', 'details', 'div', 'span', 'summary'],
    'BHV-ACTIONABLE-FIRST: the live shape renders only div, a, span, code, details, and summary elements');
  const details = byClass(root, 'board-health-no-action');
  eq(details.map((node) => [node.tag, node.open]), [['details', false]],
    'BHV-ACTIONABLE-FIRST: cross-clone members sit in one collapsed details element');
  eq(details[0].children[0].textContent,
    '64 cross-clone members · 6 agreeing lanes — no action in this clone',
    'BHV-ACTIONABLE-FIRST: the details summary is marked no action in this clone');
  const crossLinks = byClass(root, 'board-health-link').filter((link) => link.textContent.startsWith('XC-'));
  eq([crossLinks.length, crossLinks.filter((link) => flatten(details[0]).includes(link)).length], [20, 20],
    'BHV-ACTIONABLE-FIRST: every listed cross-clone member renders inside the details element');
  eq(byClass(details[0], 'board-health-not-listed').map(joined), [
    '44 more cross-clone members are not listed here — run board-health --json to list them',
  ], 'BHV-ACTIONABLE-FIRST: the details element counts the unlisted cross-clone members');
  eq(byClass(root, 'board-health-not-listed').map((line) => line.children.map((child) => child.tag)),
    [['span', 'code', 'span'], ['span', 'code', 'span']],
    'RR3D-EDGES-AND-CONVERGENCE: each of the live shape\'s 2 not-listed lines holds a span, the board-health --json code, and a span, in that order');
  eq(rows(details[0]).length, 26,
    'BHV-ACTIONABLE-FIRST: the details element holds one row per listed cross-clone member and agreeing lane');
  eq(rowTitles(details[0]).slice(20), ['Agree One', 'Agree Two', 'Agree Three', 'Agree Four', 'Agree Five', 'Agree Six'],
    'BHV-LANE-AGREES: agreeing lane rows render inside the no-action details element');
  eq(rowDetails(details[0])[20], ['board lane In Progress matches derived active'],
    'BHV-LANE-AGREES: an agreeing lane row shows its painted lane and derived state');
  eq(rowDetails(details[0])[0], ['Epic A · note says completed · cross-clone: no action in this clone'],
    'BHV-ACTIONABLE-FIRST: a cross-clone row shows its epic, note status, and remedy');
}

function laneAgreesAndHealthy() {
  const agreeing = render(payload({
    lane_divergence: [lane('Calm A', 'active', 'In Progress', true), lane('Calm B', 'blocked', 'Blocked', true),
      lane('Calm C', 'done', 'Completed', true)],
  }));
  eq(headlineOf(agreeing), 'Nothing needs action in this clone',
    'BHV-LANE-AGREES: agreeing lane rows are not counted as findings');
  eq(agreeing.sections, ['No action in this clone'],
    'BHV-LANE-AGREES: agreeing lane rows render no actionable section');
  eq(byClass(agreeing.root, 'board-health-no-action')[0].children[0].textContent,
    '3 agreeing lanes — no action in this clone',
    'BHV-LANE-AGREES: the summary counts agreeing lanes as no-action rows');
  assertOutline(agreeing.root, [
    'Nothing needs action in this clone', 'scope', 'label: No action in this clone',
    'details: 3 agreeing lanes — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: agreeing lanes alone render their exact sections');

  const crossOnly = render(payload({
    untracked_members: [member('XC-1', 'coordinator'), member('XC-2', 'coordinator', { epic: null })],
    untracked_members_by_provenance: { coordinator: 2, foreign: 0 },
  }));
  eq([headlineOf(crossOnly), crossOnly.sections],
    ['Nothing needs action in this clone', ['No action in this clone']],
    'NO-ACTION: no_op false with cross-clone members and no finding does not read as needing action');
  eq(byClass(crossOnly.root, 'board-health-no-action')[0].children[0].textContent,
    '2 cross-clone members — no action in this clone',
    'NO-ACTION: the summary counts cross-clone members');
  assertOutline(crossOnly.root, [
    'Nothing needs action in this clone', 'scope', 'label: No action in this clone',
    'details: 2 cross-clone members — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: cross-clone members alone render their exact sections');
  eq(rowDetails(byClass(crossOnly.root, 'board-health-no-action')[0])[1],
    ['note says completed · cross-clone: no action in this clone'],
    'NO-ACTION: a cross-clone member with no epic omits the epic prefix');
  const ones = render(payload({
    untracked_members: [member('XC-1', 'coordinator', { epic: 'Calm A' })],
    untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    lane_divergence: [lane('Calm A', 'active', 'In Progress', true)],
  }));
  eq(byClass(ones.root, 'board-health-no-action')[0].children[0].textContent,
    '1 cross-clone member · 1 agreeing lane — no action in this clone',
    'NO-ACTION: one cross-clone member and one agreeing lane use the singular');
  assertOutline(ones.root, [
    'Nothing needs action in this clone', 'scope', 'label: No action in this clone',
    'details: 1 cross-clone member · 1 agreeing lane — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: one cross-clone member and one agreeing lane render their exact outline');

  const healthy = render(payload({ no_op: true }));
  eq(headlineOf(healthy), 'Board healthy', 'BHV-HEALTHY: no_op true renders Board healthy');
  eq(byClass(healthy.root, 'board-health-scope').map((node) => node.textContent),
    ['sauce · 20 epics · 185 slices · 137 ledger records'],
    'BHV-HEALTHY: the line under the headline carries the checked counts');
  eq([healthy.sections, byClass(healthy.root, 'board-health-section').length,
    byClass(healthy.root, 'board-health-no-action').length, byClass(healthy.root, 'board-health-ledger-skipped').length],
  [[], 0, 0, 0], 'BHV-HEALTHY: a healthy present-ledger payload renders no finding section and no banner');
  assertOutline(healthy.root, ['Board healthy', 'scope'],
    'RR3C-SECTIONS-ASSERTED: a healthy present-ledger payload renders its exact outline');
  const singular = render(payload({ no_op: true, checked: { epics: 1, slices: 1, records: 1 } }));
  eq(byClass(singular.root, 'board-health-scope')
    .map((node) => node.textContent), ['sauce · 1 epic · 1 slice · 1 ledger record'],
  'BHV-HEALTHY: single checked counts use the singular');
  assertOutline(singular.root, ['Board healthy', 'scope'],
    'RR3C-SECTIONS-ASSERTED: single checked counts render their exact outline');
  for (const ledger of ['empty', 'absent']) {
    const skipped = render(payload({ no_op: true, ledger, checked: { epics: 3, slices: 7, records: 0 } }));
    eq([headlineOf(skipped), byClass(skipped.root, 'board-health-ledger-skipped').map((node) => [node.tag, node.textContent])], [
      'Board healthy',
      [['div', `Ledger ${ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`]],
    ], `BHV-HEALTHY: an ${ledger} ledger renders the skipped-checks banner`);
    assertOutline(skipped.root, ['Board healthy', 'scope', skippedBanner(ledger)],
      `RR3C-SECTIONS-ASSERTED: a healthy ${ledger}-ledger payload renders its exact outline`);
  }
  const reportsOnly = render(payload({
    no_op: true,
    binding_drift: {
      atlases: 0, slices: 0, orphan_lines: 0, reports: 3,
      report_codes: { parent_card_conflict: 2, epic_board_conflict: 1 }, remedy: DRIFT_REMEDY,
    },
  }));
  eq([headlineOf(reportsOnly), reportsOnly.sections], ['Board healthy', ['No action in this clone']],
    'BHV-HEALTHY: no_op true with binding reports renders Board healthy and only the no-action section');
  assertOutline(reportsOnly.root, [
    'Board healthy', 'scope', 'label: No action in this clone', 'details: 3 binding reports — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: no_op true with binding reports renders its exact outline');
  const reportDetails = byClass(reportsOnly.root, 'board-health-no-action')[0];
  eq([reportDetails.children[0].textContent, rowDetails(reportDetails)], [
    '3 binding reports — no action in this clone',
    [['3 binding reports the heal will not change: parent_card_conflict ×2, epic_board_conflict ×1']],
  ], 'BHV-HEALTHY: binding reports show their count and per-code tally');
  const oneReportRendered = render(payload({
    binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, reports: 1, remedy: DRIFT_REMEDY },
  }));
  assertOutline(oneReportRendered.root, [
    'Nothing needs action in this clone', 'scope', 'label: No action in this clone',
    'details: 1 binding report — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: one binding report renders its exact outline');
  const oneReport = byClass(oneReportRendered.root, 'board-health-no-action')[0];
  eq([oneReport.children[0].textContent, rowDetails(oneReport)],
    ['1 binding report — no action in this clone', [['1 binding report the heal will not change']]],
    'BHV-HEALTHY: a report count without report_codes renders without a tally');
}

async function ledgerSkipped() {
  const banner = (ledger) => [['div', `Ledger ${ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`]];
  let last = null;
  const shown = (page) => {
    last = render(page, { path: NOTE_PATH, mtime: FOOTER_TIME });
    return [headlineOf(last), byClass(last.root, 'board-health-ledger-skipped').map((node) => [node.tag, node.textContent])];
  };
  const memberOutline = (ledger) => [
    '1 finding needs action in this clone', 'scope', skippedBanner(ledger),
    'label: Foreign-written members', 'section', 'label: No action in this clone',
    'details: 1 cross-clone member — no action in this clone', FOOTER,
  ];
  for (const ledger of ['empty', 'absent']) {
    const skipped = { no_op: false, ledger, checked: { epics: 2, slices: 3, records: 0 } };
    eq(shown(payload({
      ...skipped,
      untracked_members: [member('XC-1', 'coordinator')],
      untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    })), ['Nothing needs action in this clone', banner(ledger)],
    `BHV-HEALTHY: an ${ledger} ledger with no_op false and one cross-clone member renders one skipped-checks banner`);
    assertOutline(last.root, [
      'Nothing needs action in this clone', 'scope', skippedBanner(ledger), 'label: No action in this clone',
      'details: 1 cross-clone member — no action in this clone', FOOTER,
    ], `RR3C-SECTIONS-ASSERTED: an ${ledger} ledger with no_op false and one cross-clone member renders the no-action section and the footer`);
    eq(shown(payload({
      ...skipped,
      untracked_members: [member('XC-1', 'coordinator'), member('FM-1', 'foreign')],
      untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
    })), ['1 finding needs action in this clone', banner(ledger)],
    `BHV-HEALTHY: an ${ledger} ledger with no_op false and a foreign-written member renders one skipped-checks banner`);
    assertOutline(last.root, memberOutline(ledger),
      `RR3C-SECTIONS-ASSERTED: an ${ledger} ledger with no_op false and a foreign-written member renders the foreign-written and no-action sections and the footer`);
  }

  const board = [{ 'In Progress': ['Ledgerless Epic'] }, {
    'Ledgerless Epic': {
      lanes: { Completed: ['LL-1', 'LL-2'] },
      slices: { 'LL-1': ['completed', COORDINATOR_STAMP], 'LL-2': ['completed'] },
    },
  }, []];
  for (const [ledger, options] of [['absent', {}], ['empty', { stateFile: true }]]) {
    const { receipt, raw } = await productionNote(...board, options);
    const { parsed } = frontmatterJson(raw);
    eq([parsed.ledger, parsed.no_op, parsed.checked.records, parsed.untracked_members_by_provenance],
      [ledger, false, 0, { coordinator: 1, foreign: 1 }],
      `BHV-HEALTHY: the real coordinator with no ledger records writes ledger ${ledger}, no_op false, one cross-clone and one foreign-written member`);
    check(receipt.ok === true && new BoardHealth()._validPayload(parsed) === true,
      `BHV-HEALTHY: the real coordinator's ledger ${ledger} payload passes validation`);
    eq(shown(parsed), ['1 finding needs action in this clone', banner(ledger)],
      `BHV-HEALTHY: the real coordinator's ledger ${ledger} note renders one skipped-checks banner`);
    assertOutline(last.root, memberOutline(ledger),
      `RR3C-SECTIONS-ASSERTED: the real coordinator's ledger ${ledger} note renders the foreign-written and no-action sections and the footer`);
  }

  const everySection = (ledger) => payload({
    ledger,
    lane_divergence: [lane('Stale Epic', 'active', 'In Planning', false), lane('Calm Epic', 'active', 'In Progress', true)],
    projection_errors: [{ card: 'PE-1', phase: 'implementing', error: 'epic board is unreadable' }],
    unprojectable_epics: [{ epic: 'Ghost Epic', error: 'board member has neither an epic scaffold nor a note', remedy: DRIFT_REMEDY }],
    binding_drift: {
      atlases: 1, slices: 2, orphan_lines: 3, reports: 1, report_codes: { parent_card_conflict: 1 }, remedy: DRIFT_REMEDY,
    },
    foreign_writes: [{ card: 'FW-1', phase: 'feature_pr' }],
    untracked_members: [member('FM-1', 'foreign'), member('XC-1', 'coordinator', { epic: 'Calm Epic' })],
    untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
  });
  const everyLine = [
    '11 findings need action in this clone', 'sauce · 20 epics · 185 slices · 137 ledger records',
    'Lane disagreements', 'Stale Epic', 'board lane In Planning · derived active',
    'Projection errors', 'PE-1', 'phase implementing · epic board is unreadable', "reconcile --card 'PE-1'",
    'Unprojectable epics', 'Ghost Epic', 'board member has neither an epic scaffold nor a note', DRIFT_REMEDY,
    'Binding drift', '1 atlas · 2 slices · 3 orphan board lines', DRIFT_REMEDY,
    'Foreign writes', 'FW-1', "phase feature_pr · note bytes differ from the coordinator's last write",
    'Foreign-written members', 'FM-1', 'Perf Epic · note says completed · remedy: adopt',
    'No action in this clone', '1 cross-clone member · 1 agreeing lane · 1 binding report — no action in this clone',
    'XC-1', 'Calm Epic · note says completed · cross-clone: no action in this clone',
    'Calm Epic', 'board lane In Progress matches derived active',
    '1 binding report the heal will not change: parent_card_conflict ×1',
    'Note file last changed 2026-08-23 21:18',
  ];
  const everyOutline = [
    '11 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Binding drift', 'section', 'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone',
    'details: 1 cross-clone member · 1 agreeing lane · 1 binding report — no action in this clone', FOOTER,
  ];
  const every = render(everySection('present'), { path: NOTE_PATH, mtime: FOOTER_TIME });
  assertOutline(every.root, everyOutline,
    'RR3C-SECTIONS-ASSERTED: ledger present with no_op false renders no skipped-checks banner, the lane, projection-error, unprojectable-epic, Binding drift, foreign-write, and foreign-written-member sections, the no-action section, and the footer');
  eq(lines(every.root), everyLine, 'RR3C-SECTIONS-ASSERTED: ledger present with no_op false renders its literal lines');
  for (const ledger of ['empty', 'absent']) {
    const skipped = render({
      ...everySection(ledger), checked: { epics: 20, slices: 185, records: 0 },
      lane_divergence: [], projection_errors: [], foreign_writes: [],
    }, { path: NOTE_PATH, mtime: FOOTER_TIME });
    assertOutline(skipped.root, [
      '8 findings need action in this clone', 'scope', skippedBanner(ledger),
      'label: Unprojectable epics', 'section', 'label: Binding drift', 'section', 'label: Foreign-written members', 'section',
      'label: No action in this clone', 'details: 1 cross-clone member · 1 binding report — no action in this clone', FOOTER,
    ], `RR3C-SECTIONS-ASSERTED: ledger ${ledger} with no_op false, 0 ledger records, and no lane, projection-error, or foreign-write finding renders one skipped-checks banner, the unprojectable-epic, Binding drift, and foreign-written-member sections, the no-action section, and the footer`);
    eq(lines(skipped.root), [
      '8 findings need action in this clone', 'sauce · 20 epics · 185 slices · 0 ledger records',
      `Ledger ${ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`,
      'Unprojectable epics', 'Ghost Epic', NO_SCAFFOLD, DRIFT_REMEDY,
      'Binding drift', '1 atlas · 2 slices · 3 orphan board lines', DRIFT_REMEDY,
      'Foreign-written members', 'FM-1', 'Perf Epic · note says completed · remedy: adopt',
      'No action in this clone', '1 cross-clone member · 1 binding report — no action in this clone',
      'XC-1', 'Calm Epic · note says completed · cross-clone: no action in this clone',
      '1 binding report the heal will not change: parent_card_conflict ×1',
      'Note file last changed 2026-08-23 21:18',
    ], `RR3C-SECTIONS-ASSERTED: ledger ${ledger} with no_op false, 0 ledger records, and no lane, projection-error, or foreign-write finding renders its literal lines`);
  }
}

const NOT_LISTED_TAIL = ['board-health --json', ' to list them'];
const DRIFT_UNREADABLE = 'binding-drift plan is unreadable: EISDIR: illegal operation on a directory, read';
const NO_SCAFFOLD = 'board member has neither an epic scaffold nor a note';

async function ledgerSkippedOverflow() {
  const two = (index) => String(index).padStart(2, '0');
  const lost = Array.from({ length: 22 }, (_, index) => `Lost Epic ${two(index + 1)}`);
  const cross = (index) => `XC-${two(index)}`;
  const foreign = (index) => `FM-${two(index)}`;
  const order = [
    ...Array.from({ length: 9 }, (_, index) => cross(index + 1)), foreign(1),
    ...Array.from({ length: 9 }, (_, index) => cross(index + 10)), foreign(2),
    cross(19), foreign(3), foreign(4), cross(20), foreign(5), foreign(6), cross(21),
  ];
  const board = [{ 'In Planning': lost, 'In Progress': ['Member Epic'] }, {
    'Member Epic': {
      lanes: { Completed: order },
      slices: Object.fromEntries(order.map((name) => [name, name.startsWith('XC-') ? ['completed', COORDINATOR_STAMP] : ['completed']])),
    },
  }, []];
  const unreadableAtlas = ({ cardsRoot }) => {
    fs.mkdirSync(path.join(cardsRoot, 'Broken Epic', 'Broken Epic.md'), { recursive: true });
    fs.mkdirSync(path.join(cardsRoot, 'Broken Epic', 'board'), { recursive: true });
    fs.writeFileSync(path.join(cardsRoot, 'Broken Epic', 'board', 'Broken Epic-board.md'), 'unread\n');
  };
  for (const [ledger, options] of [['absent', {}], ['empty', { stateFile: true }]]) {
    const { receipt, raw } = await productionNote(...board, { ...options, prepare: unreadableAtlas });
    const { parsed } = frontmatterJson(raw);
    eq([receipt.ok, parsed.ledger, parsed.no_op, parsed.checked,
      parsed.untracked_members.length, parsed.untracked_members_overflow_count, parsed.untracked_members_by_provenance,
      parsed.unprojectable_epics.length, parsed.unprojectable_epics_overflow_count, parsed.binding_drift,
      parsed.lane_divergence, parsed.lane_divergence_overflow_count, parsed.projection_errors,
      parsed.projection_errors_overflow_count, parsed.foreign_writes, parsed.foreign_writes_overflow_count],
    [true, ledger, false, { epics: 23, slices: 27, records: 0 }, 20, 7, { coordinator: 21, foreign: 6 }, 20, 2,
      { error: DRIFT_UNREADABLE, remedy: DRIFT_REMEDY }, [], 0, [], 0, [], 0],
    `RR3D-LEDGER-SKIPPED-OVERFLOW: with no ledger records, 22 board members without a scaffold, an epic of 27 untracked members, and an epic directory off the board whose atlas path is a directory, the real coordinator writes ledger ${ledger}, no_op false, 20 listed and 7 overflowing untracked members (21 cross-clone, 6 foreign-written), 20 listed and 2 overflowing unprojectable epics, a binding_drift error, and no lane, projection-error, or foreign-write finding`);
    const shown = render(parsed, { path: NOTE_PATH, mtime: FOOTER_TIME });
    assertOutline(shown.root, [
      '29 findings need action in this clone', 'scope', skippedBanner(ledger),
      'label: Unprojectable epics', 'section', 'label: Binding drift', 'section',
      'label: Foreign-written members', 'section', 'label: No action in this clone',
      'details: 21 cross-clone members — no action in this clone', FOOTER,
    ], `RR3D-LEDGER-SKIPPED-OVERFLOW: the real coordinator's ledger ${ledger} overflow note renders the headline counting all 6 foreign-written members, the scope line, one skipped-checks banner, the unprojectable-epic, Binding drift, foreign-written-member, and no-action sections, and the footer`);
    eq(lines(shown.root), [
      '29 findings need action in this clone', 'test · 23 epics · 27 slices · 0 ledger records',
      `Ledger ${ledger} in this clone — lane, projection-error, and foreign-write checks were skipped`,
      'Unprojectable epics', ...lost.slice(0, 20).flatMap((epic) => [epic, NO_SCAFFOLD, DRIFT_REMEDY]),
      '2 more unprojectable epics are not listed here — run ', ...NOT_LISTED_TAIL,
      'Binding drift', DRIFT_UNREADABLE, DRIFT_REMEDY,
      'Foreign-written members',
      'FM-01', 'Member Epic · note says completed · remedy: adopt',
      'FM-02', 'Member Epic · note says completed · remedy: adopt',
      '4 more foreign-written members need adopt review and are not listed here — run ', ...NOT_LISTED_TAIL,
      'No action in this clone', '21 cross-clone members — no action in this clone',
      ...Array.from({ length: 18 }, (_, index) => [cross(index + 1), 'Member Epic · note says completed · cross-clone: no action in this clone']).flat(),
      '3 more cross-clone members are not listed here — run ', ...NOT_LISTED_TAIL,
      'Note file last changed 2026-08-23 21:18',
    ], `RR3D-LEDGER-SKIPPED-OVERFLOW: the real coordinator's ledger ${ledger} overflow note renders its literal lines, including the unlisted unprojectable-epic, foreign-written-member, and cross-clone-member lines, the drift error, and the footer`);
  }
}

async function crossCloneOnlyInOverflow() {
  const foreign = Array.from({ length: 20 }, (_, index) => `FM-${String(index + 1).padStart(2, '0')}`);
  const cross = ['XC-01', 'XC-02', 'XC-03'];
  const order = [...foreign, ...cross];
  const { receipt, raw } = await productionNote({ 'In Progress': ['Member Epic'] }, {
    'Member Epic': {
      lanes: { Completed: order },
      slices: Object.fromEntries(order.map((name) => [name, name.startsWith('XC-') ? ['completed', COORDINATOR_STAMP] : ['completed']])),
    },
  }, []);
  const { parsed } = frontmatterJson(raw);
  eq([receipt.ok, parsed.ledger, parsed.no_op, parsed.checked, parsed.untracked_members.map((item) => item.card),
    parsed.untracked_members.filter((item) => item.provenance === 'foreign').length, parsed.untracked_members_overflow_count,
    parsed.untracked_members_by_provenance, parsed.unprojectable_epics, parsed.unprojectable_epics_overflow_count, parsed.binding_drift],
  [true, 'absent', false, { epics: 1, slices: 23, records: 0 }, foreign, 20, 3, { coordinator: 3, foreign: 20 }, [], 0,
    { atlases: 0, slices: 0, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY }],
  'RR3D-EDGES-AND-CONVERGENCE: with no ledger records and an epic whose first 20 members in board order are foreign-written and whose last 3 are cross-clone, the real coordinator lists the 20 foreign-written members and holds all 3 cross-clone members in the overflow');
  const shown = render(parsed, { path: NOTE_PATH, mtime: FOOTER_TIME });
  assertOutline(shown.root, [
    '20 findings need action in this clone', 'scope', skippedBanner('absent'),
    'label: Foreign-written members', 'section', 'label: No action in this clone',
    'details: 3 cross-clone members — no action in this clone', FOOTER,
  ], 'RR3D-EDGES-AND-CONVERGENCE: a note whose cross-clone members are all in the overflow renders the no-action section with the summary 3 cross-clone members');
  eq(byClass(byClass(shown.root, 'board-health-no-action')[0] || { children: [] }, 'board-health-not-listed').map(joined),
    ['3 more cross-clone members are not listed here — run board-health --json to list them'],
    'RR3D-EDGES-AND-CONVERGENCE: a note whose cross-clone members are all in the overflow renders the not-listed line for all 3 inside the no-action details');
  eq(lines(shown.root), [
    '20 findings need action in this clone', 'test · 1 epic · 23 slices · 0 ledger records',
    'Ledger absent in this clone — lane, projection-error, and foreign-write checks were skipped',
    'Foreign-written members', ...foreign.flatMap((card) => [card, 'Member Epic · note says completed · remedy: adopt']),
    'No action in this clone', '3 cross-clone members — no action in this clone',
    '3 more cross-clone members are not listed here — run ', ...NOT_LISTED_TAIL,
    'Note file last changed 2026-08-23 21:18',
  ], 'RR3D-EDGES-AND-CONVERGENCE: a note whose cross-clone members are all in the overflow renders its literal lines');
}

function entryPositionRejects() {
  const lists = {
    untracked_members: {
      valid: (index) => member(`XC-${index}`, 'coordinator'),
      malformed: { ...member('FM-X', 'foreign'), card: 123 },
      wellFormed: member('FM-X', 'foreign'),
      tally: (valid) => ({ untracked_members_by_provenance: { coordinator: valid, foreign: 1 } }),
    },
    unprojectable_epics: {
      valid: (index) => ({ epic: `Ghost ${index}`, error: NO_SCAFFOLD, remedy: DRIFT_REMEDY }),
      malformed: { epic: 'Ghost X', error: null, remedy: DRIFT_REMEDY },
      wellFormed: { epic: 'Ghost X', error: NO_SCAFFOLD, remedy: DRIFT_REMEDY },
      tally: () => ({}),
    },
    lane_divergence: {
      valid: (index) => lane(`Lane ${index}`, 'active', 'In Planning', false),
      malformed: { epic: 'Lane X', derived: 'active', painted: 'In Progress', agrees: 'false' },
      wellFormed: lane('Lane X', 'active', 'In Progress', false),
      tally: () => ({}),
    },
    projection_errors: {
      valid: (index) => ({ card: `PE-${index}`, phase: 'implementing', error: 'x' }),
      malformed: { card: 'PE-X', phase: 'implementing', error: 5 },
      wellFormed: { card: 'PE-X', phase: 'implementing', error: 'x' },
      tally: () => ({}),
    },
    foreign_writes: {
      valid: (index) => ({ card: `FW-${index}`, phase: 'implementing' }),
      malformed: { card: null, phase: 'implementing' },
      wellFormed: { card: 'FW-X', phase: 'implementing' },
      tally: () => ({}),
    },
  };
  return Object.entries(lists).flatMap(([list, { valid, malformed, wellFormed, tally }]) => [[0, 3], [1, 3], [2, 3], [19, 20]]
    .map(([at, length]) => {
      const entries = (odd) => Array.from({ length }, (_, index) => (index === at ? odd : valid(index + 1)));
      return [`a malformed ${list} entry at index ${at} of ${length} entries`, { [list]: entries(malformed), ...tally(length - 1) },
        { [list]: entries(wellFormed), ...tally(length - 1) }];
    }));
}

function edgesAndConvergence() {
  const reconcileAnn = "reconcile --card 'Ann'\"'\"'s and Bob'\"'\"'s card'";
  const threeRows = render(payload({
    lane_divergence: [
      lane('Stale Mid', 'active', 'In Planning', false), lane('Stale Alpha', 'blocked', 'Completed', false),
      lane('Stale Zulu', 'done', 'In Progress', false),
    ],
    projection_errors: [
      { card: 'PE-5', phase: 'implementing', error: 'epic board is unreadable' },
      { card: "Ann's and Bob's card", phase: 'feature_pr', error: 'slice note is missing' },
      { card: 'PE-9', phase: 'implementing', error: 'epic board names no lane for the slice' },
    ],
    unprojectable_epics: [
      { epic: 'Ghost Mid', error: NO_SCAFFOLD, remedy: DRIFT_REMEDY },
      { epic: 'Ghost Alpha', error: 'canonical epic Ghost Alpha is missing its atlas or board directory', remedy: DRIFT_REMEDY },
      { epic: 'Ghost Zulu', error: NO_SCAFFOLD, remedy: DRIFT_REMEDY },
    ],
    foreign_writes: [
      { card: 'FW-5', phase: 'implementing', foreign_write: { detected_at: '2026-08-01T10:00:00.000Z' } },
      { card: 'FW-1', phase: 'feature_pr', foreign_write: { detected_at: '2026-08-02T10:00:00.000Z' } },
      { card: 'FW-9', phase: 'implementing', foreign_write: { detected_at: '2026-08-03T10:00:00.000Z' } },
    ],
    untracked_members: [
      member('FM-5', 'foreign'), member('XC-5', 'coordinator'),
      member('FM-1', 'foreign', { note_status: 'blocked', remedy: 'no mechanical remedy: adopt ratifies only a completed declaration' }),
      member('XC-1', 'coordinator', { epic: null }),
      member('FM-9', 'foreign'), member('XC-9', 'coordinator'),
    ],
    untracked_members_by_provenance: { coordinator: 3, foreign: 3 },
  }), { path: NOTE_PATH, mtime: FOOTER_TIME });
  assertOutline(threeRows.root, [
    '15 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 3 cross-clone members — no action in this clone', FOOTER,
  ], 'RR3D-EDGES-AND-CONVERGENCE: three listed rows in each section, in an order that is neither ascending nor descending, render their exact outline');
  eq(rows(sectionBody(threeRows.root, 'Projection errors')).map((row) => byClass(row, 'board-health-remedy').map(joined)),
    [["reconcile --card 'PE-5'"], [reconcileAnn], ["reconcile --card 'PE-9'"]],
    'RR3D-EDGES-AND-CONVERGENCE: each of the three listed projection errors carries its own reconcile --card remedy');
  eq(lines(threeRows.root), [
    '15 findings need action in this clone', 'sauce · 20 epics · 185 slices · 137 ledger records',
    'Lane disagreements', 'Stale Mid', 'board lane In Planning · derived active',
    'Stale Alpha', 'board lane Completed · derived blocked',
    'Stale Zulu', 'board lane In Progress · derived done',
    'Projection errors', 'PE-5', 'phase implementing · epic board is unreadable', "reconcile --card 'PE-5'",
    "Ann's and Bob's card", 'phase feature_pr · slice note is missing', reconcileAnn,
    'PE-9', 'phase implementing · epic board names no lane for the slice', "reconcile --card 'PE-9'",
    'Unprojectable epics', 'Ghost Mid', NO_SCAFFOLD, DRIFT_REMEDY,
    'Ghost Alpha', 'canonical epic Ghost Alpha is missing its atlas or board directory', DRIFT_REMEDY,
    'Ghost Zulu', NO_SCAFFOLD, DRIFT_REMEDY,
    'Foreign writes', 'FW-5', "phase implementing · note bytes differ from the coordinator's last write",
    'FW-1', "phase feature_pr · note bytes differ from the coordinator's last write",
    'FW-9', "phase implementing · note bytes differ from the coordinator's last write",
    'Foreign-written members', 'FM-5', 'Perf Epic · note says completed · remedy: adopt',
    'FM-1', 'Perf Epic · note says blocked · remedy: no mechanical remedy: adopt ratifies only a completed declaration',
    'FM-9', 'Perf Epic · note says completed · remedy: adopt',
    'No action in this clone', '3 cross-clone members — no action in this clone',
    'XC-5', 'Perf Epic · note says completed · cross-clone: no action in this clone',
    'XC-1', 'note says completed · cross-clone: no action in this clone',
    'XC-9', 'Perf Epic · note says completed · cross-clone: no action in this clone',
    'Note file last changed 2026-08-23 21:18',
  ], 'RR3D-EDGES-AND-CONVERGENCE: three listed rows in each section render their literal lines in payload order');

  const shuffled = (prefix) => Array.from({ length: 20 }, (_, index) => `${prefix}-${String((index * 7) % 20).padStart(2, '0')}`);
  const full = {
    lanes: shuffled('Lane'), errors: shuffled('PE'), epics: shuffled('Ghost'), writes: shuffled('FW'),
    members: shuffled('Member'),
  };
  const twenty = render(payload({
    checked: { epics: 40, slices: 185, records: 137 },
    lane_divergence: full.lanes.map((epic) => lane(epic, 'active', 'In Planning', false)),
    projection_errors: full.errors.map((card) => ({ card, phase: 'implementing', error: 'x' })),
    unprojectable_epics: full.epics.map((epic) => ({ epic, error: NO_SCAFFOLD, remedy: DRIFT_REMEDY })),
    foreign_writes: full.writes.map((card) => ({ card, phase: 'implementing' })),
    untracked_members: full.members.map((card, index) => member(card, index % 2 ? 'coordinator' : 'foreign')),
    untracked_members_by_provenance: { coordinator: 10, foreign: 10 },
  }));
  assertOutline(twenty.root, [
    '90 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 10 cross-clone members — no action in this clone',
  ], 'RR3D-EDGES-AND-CONVERGENCE: twenty listed entries in every list render their exact outline');
  eq([
    rowTitles(sectionBody(twenty.root, 'Lane disagreements')), rowTitles(sectionBody(twenty.root, 'Projection errors')),
    rowTitles(sectionBody(twenty.root, 'Unprojectable epics')), rowTitles(sectionBody(twenty.root, 'Foreign writes')),
    rowTitles(sectionBody(twenty.root, 'Foreign-written members')), rowTitles(byClass(twenty.root, 'board-health-no-action')[0]),
  ], [
    full.lanes, full.errors, full.epics, full.writes,
    full.members.filter((_, index) => index % 2 === 0), full.members.filter((_, index) => index % 2 === 1),
  ], 'RR3D-EDGES-AND-CONVERGENCE: twenty listed entries in every list, in an order that is neither ascending nor descending, each render one row in payload order');

  const twice = (entry) => [entry, entry];
  const repeated = render(payload({
    lane_divergence: twice(lane('Twice Epic', 'active', 'In Planning', false)),
    projection_errors: twice({ card: 'PE-2x', phase: 'implementing', error: 'x' }),
    unprojectable_epics: twice({ epic: 'Ghost 2x', error: NO_SCAFFOLD, remedy: DRIFT_REMEDY }),
    foreign_writes: twice({ card: 'FW-2x', phase: 'implementing' }),
    untracked_members: [...twice(member('FM-2x', 'foreign')), ...twice(member('XC-2x', 'coordinator'))],
    untracked_members_by_provenance: { coordinator: 2, foreign: 2 },
  }));
  assertOutline(repeated.root, [
    '10 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 2 cross-clone members — no action in this clone',
  ], 'RR3D-EDGES-AND-CONVERGENCE: a payload that lists every entry twice renders its exact outline');
  eq([
    rowTitles(sectionBody(repeated.root, 'Lane disagreements')), rowTitles(sectionBody(repeated.root, 'Projection errors')),
    rowTitles(sectionBody(repeated.root, 'Unprojectable epics')), rowTitles(sectionBody(repeated.root, 'Foreign writes')),
    rowTitles(sectionBody(repeated.root, 'Foreign-written members')), rowTitles(byClass(repeated.root, 'board-health-no-action')[0]),
  ], [twice('Twice Epic'), twice('PE-2x'), twice('Ghost 2x'), twice('FW-2x'), twice('FM-2x'), twice('XC-2x')],
  'RR3D-EDGES-AND-CONVERGENCE: a payload that lists every entry twice renders one row per entry');

  const ownRemedies = render(payload({
    unprojectable_epics: [{ epic: 'Ghost', error: NO_SCAFFOLD, remedy: 'reconcile-metadata --epic Ghost --json' }],
    binding_drift: { atlases: 1, slices: 0, orphan_lines: 0, remedy: 'heal-epic-bindings --apply --json' },
    untracked_members: [member('XC-1', 'coordinator', { remedy: 'cross-clone: adopt in the owning clone' })],
    untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
  }));
  assertOutline(ownRemedies.root, [
    '2 findings need action in this clone', 'scope', 'label: Unprojectable epics', 'section',
    'label: Binding drift', 'section', 'label: No action in this clone',
    'details: 1 cross-clone member — no action in this clone',
  ], 'RR3D-EDGES-AND-CONVERGENCE: a payload whose unprojectable-epic, binding_drift, and cross-clone remedies are reconcile-metadata --epic Ghost --json, heal-epic-bindings --apply --json, and cross-clone: adopt in the owning clone renders its exact outline');
  eq(lines(ownRemedies.root), [
    '2 findings need action in this clone', 'sauce · 20 epics · 185 slices · 137 ledger records',
    'Unprojectable epics', 'Ghost', NO_SCAFFOLD, 'reconcile-metadata --epic Ghost --json',
    'Binding drift', '1 atlas · 0 slices · 0 orphan board lines', 'heal-epic-bindings --apply --json',
    'No action in this clone', '1 cross-clone member — no action in this clone',
    'XC-1', 'Perf Epic · note says completed · cross-clone: adopt in the owning clone',
  ], 'RR3D-EDGES-AND-CONVERGENCE: that payload\'s unprojectable-epic, Binding drift, and cross-clone rows render those remedy texts');

  const twentyOne = (make) => Array.from({ length: 21 }, (_, index) => make(`N-${index + 1}`));
  const rejects = [
    ...[['a number', 7], ['null', null], ['only spaces', '   '], ['an object', { message: 'boom' }], ['an array', ['boom']]]
      .map(([label, error]) => [`a binding_drift error that is ${label}`, { binding_drift: { error, remedy: DRIFT_REMEDY } }]),
    ['an empty binding_drift error beside valid counts', {
      binding_drift: { error: '', atlases: 0, slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY },
    }],
    ...[['null', null], ['false', false], ['0', 0], ['an empty string', '']].map(([label, codes]) => [`a report_codes that is ${label}`, {
      binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, reports: 0, report_codes: codes, remedy: DRIFT_REMEDY },
    }]),
    ...[
      ['second of 2', { parent_card_conflict: 1, epic_board_conflict: 'two' }, { parent_card_conflict: 1, epic_board_conflict: 2 }],
      ['first of 2', { parent_card_conflict: 'one', epic_board_conflict: 2 }, { parent_card_conflict: 1, epic_board_conflict: 2 }],
      ['middle of 3', { parent_card_conflict: 1, epic_board_conflict: null, unresolved_epic: 3 },
        { parent_card_conflict: 1, epic_board_conflict: 1, unresolved_epic: 3 }],
    ].map(([where, codes, counted]) => {
      const drift = (reportCodes) => ({
        binding_drift: {
          atlases: 0, slices: 0, orphan_lines: 0, report_codes: reportCodes, remedy: DRIFT_REMEDY,
          reports: Object.values(counted).reduce((sum, value) => sum + value, 0),
        },
      });
      return [`a report_codes whose ${where} values is not a count`, drift(codes), drift(counted)];
    }),
    ['two listed foreign-written members beside a foreign tally of 1', {
      untracked_members: [member('FM-1', 'foreign'), member('FM-2', 'foreign')],
      untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
    }, {
      untracked_members: [member('FM-1', 'foreign'), member('FM-2', 'foreign')],
      untracked_members_by_provenance: { coordinator: 0, foreign: 2 },
    }],
    ['two listed cross-clone members beside a cross-clone tally of 1', {
      untracked_members: [member('XC-1', 'coordinator'), member('XC-2', 'coordinator')],
      untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
    }, {
      untracked_members: [member('XC-1', 'coordinator'), member('XC-2', 'coordinator')],
      untracked_members_by_provenance: { coordinator: 2, foreign: 0 },
    }],
    ...entryPositionRejects(),
    ['an untracked_members list of 21 entries', {
      untracked_members: twentyOne((card) => member(card, 'coordinator')), untracked_members_by_provenance: { coordinator: 21, foreign: 0 },
    }],
    ['an unprojectable_epics list of 21 entries', { unprojectable_epics: twentyOne((epic) => ({ epic, error: NO_SCAFFOLD, remedy: DRIFT_REMEDY })) }],
    ['a projection_errors list of 21 entries', { projection_errors: twentyOne((card) => ({ card, phase: 'implementing', error: 'x' })) }],
    ['a foreign_writes list of 21 entries', { foreign_writes: twentyOne((card) => ({ card, phase: 'implementing' })) }],
  ];
  const controls = rejects.filter((entry) => entry.length === 3);
  eq(controls.map(([, , control]) => new BoardHealth()._validPayload(payload(control))), Array(25).fill(true),
    'RR3D-EDGES-AND-CONVERGENCE: each of the 25 rejected payloads that has a control differs from its control only in the malformed entry, the one non-count report_codes value, or the provenance tally, and each control validates: each of the 20 malformed entries has exactly one wrong-typed field and its control entry corrects that field, each of the 3 non-count report_codes values becomes a count, and each of the 2 provenance tallies becomes the count of its listed members');
  for (const [label, overrides] of rejects) {
    const page = payload(overrides);
    const shown = render(page);
    eq([new BoardHealth()._validPayload(page), shown.root.children.map((child) => [child.tag, child.className, child.textContent]),
      shown.sections], [false, [['div', 'board-health-recovery', RECOVERY]], []],
    `RR3D-EDGES-AND-CONVERGENCE: ${label} fails validation and its root holds only the literal recovery line`);
  }
}

function validationTable() {
  const STRING_KINDS = [['a number', 7], ['a boolean', true], ['null', null], ['an array', ['x']], ['an object', { x: 1 }]];
  const BLANK_KINDS = [['an empty string', ''], ['whitespace only', '   ']];
  const kinds = {
    text: [...STRING_KINDS, ...BLANK_KINDS],
    nullableText: [...STRING_KINDS.filter(([name]) => name !== 'null'), ...BLANK_KINDS],
    boolean: [['the number 0', 0], ['the number 1', 1], ['the string "true"', 'true'], ['the string "false"', 'false'], ['null', null]],
    count: [['a negative count', -1], ['a fractional count', 1.5], ['a numeric string', '1'], ['NaN', NaN], ['Infinity', Infinity]],
    exact: (value, prefixed, suffixed, other) => [
      ['a prefix extension', prefixed], ['a suffix extension', suffixed],
      ...(value.toUpperCase() !== value ? [['a case change', value.toUpperCase()]] : []),
      ['leading whitespace', ` ${value}`], ['trailing whitespace', `${value} `], ['a different value', other], ...STRING_KINDS,
    ],
    enumeration: (value, unknown) => [
      ['a case change', value.toUpperCase()], ['surrounding whitespace', ` ${value} `], ['an unknown value', unknown], ...STRING_KINDS,
    ],
    nonArray: (entry) => [['an array-like object', { 0: entry, length: 1 }]],
  };
  const unprojectable = { epic: 'Ghost', error: NO_SCAFFOLD, remedy: DRIFT_REMEDY };
  const projectionError = { card: 'PE-1', phase: 'implementing', error: 'x' };
  const foreignWrite = { card: 'FW-1', phase: 'implementing' };
  const bases = {
    lists: payload({
      untracked_members: [member('FM-1', 'foreign')], untracked_members_by_provenance: { coordinator: 0, foreign: 1 },
      unprojectable_epics: [unprojectable], lane_divergence: [lane('Stale', 'active', 'In Planning', false)],
      projection_errors: [projectionError], foreign_writes: [foreignWrite],
      binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, reports: 1, report_codes: { parent_card_conflict: 1 }, remedy: DRIFT_REMEDY },
    }),
    healthy: payload(),
    driftError: payload({ binding_drift: { error: 'binding-drift plan is unreadable: boom', remedy: DRIFT_REMEDY } }),
  };
  const FIELDS = [
    ['type', kinds.exact('board-health', 'x-board-health', 'board-health-x', 'loop-station'), 'lists'],
    ['schema_version', kinds.exact('1.0.0', 'v1.0.0', '1.0.0.1', '1.0.1'), 'lists'],
    ['project', kinds.text, 'lists'],
    ['ledger', kinds.enumeration('present', 'stale'), 'lists'],
    ['no_op', kinds.boolean, 'healthy'],
    ['checked.epics', kinds.count, 'lists'],
    ['checked.slices', kinds.count, 'lists'],
    ['checked.records', kinds.count, 'lists'],
    ['untracked_members', kinds.nonArray(member('FM-1', 'foreign')), 'lists'],
    ['untracked_members_overflow_count', kinds.count, 'lists'],
    ['untracked_members_by_provenance.coordinator', kinds.count, 'lists'],
    ['untracked_members_by_provenance.foreign', kinds.count, 'lists'],
    ['untracked_members.0.card', kinds.text, 'lists'],
    ['untracked_members.0.epic', kinds.nullableText, 'lists'],
    ['untracked_members.0.note_status', kinds.text, 'lists'],
    ['untracked_members.0.provenance', kinds.enumeration('foreign', 'other'), 'lists'],
    ['untracked_members.0.remedy', kinds.text, 'lists'],
    ['unprojectable_epics', kinds.nonArray(unprojectable), 'lists'],
    ['unprojectable_epics_overflow_count', kinds.count, 'lists'],
    ['unprojectable_epics.0.epic', kinds.text, 'lists'],
    ['unprojectable_epics.0.error', kinds.text, 'lists'],
    ['unprojectable_epics.0.remedy', kinds.text, 'lists'],
    ['binding_drift.remedy', kinds.text, 'lists'],
    ['binding_drift.error', kinds.text, 'driftError'],
    ['binding_drift.atlases', kinds.count, 'lists'],
    ['binding_drift.slices', kinds.count, 'lists'],
    ['binding_drift.orphan_lines', kinds.count, 'lists'],
    ['binding_drift.reports', kinds.count, 'lists'],
    ['binding_drift.report_codes.parent_card_conflict', kinds.count, 'lists'],
    ['lane_divergence', kinds.nonArray(lane('Stale', 'active', 'In Planning', false)), 'lists'],
    ['lane_divergence_overflow_count', kinds.count, 'lists'],
    ['lane_divergence.0.epic', kinds.text, 'lists'],
    ['lane_divergence.0.derived', kinds.text, 'lists'],
    ['lane_divergence.0.painted', kinds.nullableText, 'lists'],
    ['lane_divergence.0.agrees', kinds.boolean, 'lists'],
    ['projection_errors', kinds.nonArray(projectionError), 'lists'],
    ['projection_errors_overflow_count', kinds.count, 'lists'],
    ['projection_errors.0.card', kinds.text, 'lists'],
    ['projection_errors.0.phase', kinds.text, 'lists'],
    ['projection_errors.0.error', kinds.text, 'lists'],
    ['foreign_writes', kinds.nonArray(foreignWrite), 'lists'],
    ['foreign_writes_overflow_count', kinds.count, 'lists'],
    ['foreign_writes.0.card', kinds.text, 'lists'],
    ['foreign_writes.0.phase', kinds.text, 'lists'],
  ];
  const show = (value) => (typeof value === 'number' ? String(value) : JSON.stringify(value));
  const withValue = (base, path, value) => {
    const copy = structuredClone(base);
    const keys = path.split('.');
    keys.slice(0, -1).reduce((node, key) => node[key], copy)[keys.at(-1)] = value;
    return copy;
  };
  const rows = FIELDS.flatMap(([path, near, base]) => near.map(([kind, value]) => [path, kind, value, base]));
  eq([FIELDS.length, rows.length], [VALIDATION_TABLE_FIELDS, VALIDATION_TABLE_ROWS],
    `RR3D-VALIDATION-TABLE: the table lists ${VALIDATION_TABLE_FIELDS} fields and ${VALIDATION_TABLE_ROWS} near-miss rows`);
  const validates = (page) => {
    try { return new BoardHealth()._validPayload(page); } catch (error) { return `threw ${error.name}`; }
  };
  for (const [path, kind, value, base] of rows) {
    const page = withValue(bases[base], path, value);
    const shown = render(page);
    eq([validates(bases[base]), validates(page),
      shown.root.children.map((child) => [child.tag, child.className, child.textContent]), shown.sections],
    [true, false, [['div', 'board-health-recovery', RECOVERY]], []],
    `RR3D-VALIDATION-TABLE: ${path} set to ${kind} (${show(value)}) fails validation while its base payload validates, and its root holds only the literal recovery line`);
  }
}

function findingClasses() {
  const full = render(payload({
    project: 'test',
    unprojectable_epics: [{ epic: 'Ghost Epic', error: 'board member has neither an epic scaffold nor a note', remedy: DRIFT_REMEDY }],
    unprojectable_epics_overflow_count: 2,
    binding_drift: { atlases: 2, slices: 1, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY },
    lane_divergence: [lane('Unpainted Epic', 'active', null, false)],
    lane_divergence_overflow_count: 1,
    projection_errors: [{ card: "Bob's card", phase: 'implementing', error: 'epic board is unreadable' }],
    projection_errors_overflow_count: 3,
    foreign_writes: [{ card: 'FW-1', phase: 'feature_pr', foreign_write: { detected_at: { ts: 1 } } }],
    foreign_writes_overflow_count: 4,
    untracked_members: [
      member('FM-1', 'foreign'),
      member('FM-2', 'foreign', { epic: null, note_status: 'blocked', remedy: 'no mechanical remedy: adopt ratifies only a completed declaration', stamp: { ts: 1 } }),
    ],
    untracked_members_by_provenance: { coordinator: 0, foreign: 5 },
    untracked_members_overflow_count: 3,
  }));
  const { root } = full;
  eq(headlineOf(full), 'At least 21 findings need action in this clone',
    'FINDINGS: the headline sums lanes, projection errors, unprojectable epics, drift, foreign writes, and foreign-written members, as at least N beside a lane overflow');
  eq(full.sections, [
    'Lane disagreements', 'Projection errors', 'Unprojectable epics', 'Binding drift', 'Foreign writes',
    'Foreign-written members',
  ], 'FINDINGS: each actionable class renders its own section in order');
  assertOutline(root, [
    'At least 21 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Binding drift', 'section', 'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
  ], 'RR3C-SECTIONS-ASSERTED: the all-findings payload renders its exact sections and no footer without a file time');
  const lanes = sectionBody(root, 'Lane disagreements');
  eq([rowTitles(lanes), rowDetails(lanes), byClass(lanes, 'board-health-not-listed').map(joined)], [
    ['Unpainted Epic'], [['board lane none · derived active']],
    ['1 more lane row is not listed here — run board-health --json to list them'],
  ], 'FINDINGS: a null painted lane reads board lane none, and one unlisted lane row is counted');
  const errors = sectionBody(root, 'Projection errors');
  eq([rowTitles(errors), rowDetails(errors), byClass(errors, 'board-health-not-listed').map(joined)], [
    ["Bob's card"],
    [['phase implementing · epic board is unreadable', "reconcile --card 'Bob'\"'\"'s card'"]],
    ['3 more projection errors are not listed here — run board-health --json to list them'],
  ], 'FINDINGS: a projection error names reconcile --card with the shell-quoted card');
  const unprojectable = sectionBody(root, 'Unprojectable epics');
  eq([rowTitles(unprojectable), rowDetails(unprojectable), byClass(unprojectable, 'board-health-not-listed').map(joined)], [
    ['Ghost Epic'], [['board member has neither an epic scaffold nor a note', DRIFT_REMEDY]],
    ['2 more unprojectable epics are not listed here — run board-health --json to list them'],
  ], 'FINDINGS: an unprojectable epic shows its error and the payload remedy');
  const drift = sectionBody(root, 'Binding drift');
  eq(rowDetails(drift), [['2 atlases · 1 slice · 0 orphan board lines', DRIFT_REMEDY]],
    'FINDINGS: binding drift shows its counts and the copyable heal-epic-bindings remedy');
  eq(byClass(drift, 'board-health-command').map((node) => [node.tag, node.textContent, node.style.cssText.includes('user-select:all')]),
    [['code', DRIFT_REMEDY, true]], 'FINDINGS: the drift remedy is selectable code');
  const writes = sectionBody(root, 'Foreign writes');
  eq([rowTitles(writes), rowDetails(writes), byClass(writes, 'board-health-not-listed').map(joined)], [
    ['FW-1'], [["phase feature_pr · note bytes differ from the coordinator's last write"]],
    ['4 more foreign writes are not listed here — run board-health --json to list them'],
  ], 'FINDINGS: a foreign write names its card and phase');
  const foreign = sectionBody(root, 'Foreign-written members');
  eq([rowTitles(foreign), rowDetails(foreign), byClass(foreign, 'board-health-not-listed').map(joined)], [
    ['FM-1', 'FM-2'],
    [['Perf Epic · note says completed · remedy: adopt'],
      ['note says blocked · remedy: no mechanical remedy: adopt ratifies only a completed declaration']],
    ['3 more foreign-written members need adopt review and are not listed here — run board-health --json to list them'],
  ], 'FINDINGS: listed foreign-written members show their remedy and the rest are counted as more');
  eq(byClass(root, 'board-health-no-action').length, 0,
    'FINDINGS: a payload with no cross-clone member, agreeing lane, or report renders no details element');
  eq(['board-health-section', 'board-health-detail', 'board-health-remedy'].map((name) => byClass(root, name).length),
    [6, 7, 3], 'FINDINGS: the all-findings render holds 6 section bodies, 7 detail lines, and 3 remedy blocks by class');
  eq([...new Set(flatten(full.container).map((node) => node.tag))].sort(), ['a', 'code', 'div', 'span'],
    'FINDINGS: the all-findings render uses only div, a, span, and code elements');

  const listedOnly = render(payload({
    lane_divergence: [lane('Stale', 'active', 'In Planning', false)],
    projection_errors: [{ card: 'PE-1', phase: 'implementing', error: 'x' }],
    unprojectable_epics: [{ epic: 'Ghost', error: 'y', remedy: DRIFT_REMEDY }],
    foreign_writes: [{ card: 'FW-1', phase: 'implementing' }],
    untracked_members: [member('FM-1', 'foreign'), member('XC-1', 'coordinator')],
    untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
  }));
  eq([headlineOf(listedOnly), byClass(listedOnly.root, 'board-health-not-listed').length],
    ['5 findings need action in this clone', 0], 'FINDINGS: fully listed findings render no not-listed line');
  assertOutline(listedOnly.root, [
    '5 findings need action in this clone', 'scope',
    'label: Lane disagreements', 'section', 'label: Projection errors', 'section', 'label: Unprojectable epics', 'section',
    'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 1 cross-clone member — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: fully listed findings render their exact sections');

  const singles = render(payload({
    projection_errors: [], projection_errors_overflow_count: 1,
    unprojectable_epics_overflow_count: 1,
    foreign_writes_overflow_count: 1,
    untracked_members: [member('FM-1', 'foreign'), member('XC-1', 'coordinator')],
    untracked_members_overflow_count: 2,
    untracked_members_by_provenance: { coordinator: 2, foreign: 2 },
    binding_drift: { error: 'binding-drift plan is unreadable: boom', remedy: DRIFT_REMEDY },
  }));
  eq(headlineOf(singles), '6 findings need action in this clone',
    'FINDINGS: a drift error counts as one finding and overflow counts add to the finding count');
  assertOutline(singles.root, [
    '6 findings need action in this clone', 'scope',
    'label: Projection errors', 'section', 'label: Unprojectable epics', 'section', 'label: Binding drift', 'section',
    'label: Foreign writes', 'section', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 2 cross-clone members — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: single overflow counts and a drift error render their exact sections');
  eq(byClass(singles.root, 'board-health-not-listed').map(joined), [
    '1 more projection error is not listed here — run board-health --json to list them',
    '1 more unprojectable epic is not listed here — run board-health --json to list them',
    '1 more foreign write is not listed here — run board-health --json to list them',
    '1 more foreign-written member needs adopt review and is not listed here — run board-health --json to list them',
    '1 more cross-clone member is not listed here — run board-health --json to list them',
  ], 'FINDINGS: single unlisted counts use the singular');
  eq(rowDetails(sectionBody(singles.root, 'Binding drift')), [['binding-drift plan is unreadable: boom', DRIFT_REMEDY]],
    'FINDINGS: a binding-drift error shows the error and the remedy');
  const unlistedForeign = render(payload({
    untracked_members: [member('XC-1', 'coordinator')], untracked_members_overflow_count: 1,
    untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
  }));
  eq(byClass(unlistedForeign.root, 'board-health-not-listed').map(joined), [
    '1 foreign-written member needs adopt review and is not listed here — run board-health --json to list them',
  ], 'FINDINGS: one unlisted foreign-written member with none listed reads without more');
  assertOutline(unlistedForeign.root, [
    '1 finding needs action in this clone', 'scope', 'label: Foreign-written members', 'section',
    'label: No action in this clone', 'details: 1 cross-clone member — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: one unlisted foreign-written member renders its exact outline');

  const one = render(payload({ binding_drift: { atlases: 1, slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY } }));
  eq([headlineOf(one), rowDetails(sectionBody(one.root, 'Binding drift'))],
    ['1 finding needs action in this clone', [['1 atlas · 0 slices · 0 orphan board lines', DRIFT_REMEDY]]],
    'FINDINGS: one finding and one atlas use the singular');
  assertOutline(one.root, ['1 finding needs action in this clone', 'scope', 'label: Binding drift', 'section'],
    'RR3C-SECTIONS-ASSERTED: one drifted atlas renders only the Binding drift section');
  const orphanOnly = render(payload({ binding_drift: { atlases: 0, slices: 0, orphan_lines: 3, remedy: DRIFT_REMEDY } }));
  eq(headlineOf(orphanOnly), '3 findings need action in this clone', 'FINDINGS: orphan board lines count as drift findings');
  assertOutline(orphanOnly.root, ['3 findings need action in this clone', 'scope', 'label: Binding drift', 'section'],
    'RR3C-SECTIONS-ASSERTED: a drift made only of orphan board lines renders the Binding drift section');
  eq(rowDetails(sectionBody(orphanOnly.root, 'Binding drift') || { children: [] }), [['0 atlases · 0 slices · 3 orphan board lines', DRIFT_REMEDY]],
    'RR3C-SECTIONS-ASSERTED: a drift made only of orphan board lines shows its counts and remedy');
  const slicesOnly = render(payload({ binding_drift: { atlases: 0, slices: 2, orphan_lines: 0, remedy: DRIFT_REMEDY } }));
  eq(headlineOf(slicesOnly), '2 findings need action in this clone', 'FINDINGS: drifted slices count as drift findings');
  assertOutline(slicesOnly.root, ['2 findings need action in this clone', 'scope', 'label: Binding drift', 'section'],
    'RR3C-SECTIONS-ASSERTED: a drift made only of drifted slices renders the Binding drift section');
  eq(rowDetails(sectionBody(slicesOnly.root, 'Binding drift') || { children: [] }), [['0 atlases · 2 slices · 0 orphan board lines', DRIFT_REMEDY]],
    'RR3C-SECTIONS-ASSERTED: a drift made only of drifted slices shows its counts and remedy');

  const hiddenLanes = render(payload({ lane_divergence: [lane('Calm', 'active', 'In Progress', true)], lane_divergence_overflow_count: 2 }));
  eq([headlineOf(hiddenLanes), hiddenLanes.sections, byClass(hiddenLanes.root, 'board-health-not-listed').map(joined)], [
    'No listed finding needs action in this clone', ['Lane disagreements', 'No action in this clone'],
    ['2 more lane rows are not listed here — run board-health --json to list them'],
  ], 'FINDINGS: unlisted lane rows keep the headline from claiming nothing needs action');
  eq(rowTitles(sectionBody(hiddenLanes.root, 'Lane disagreements')), [],
    'FINDINGS: an agreeing lane does not render in the lane disagreements section');
  assertOutline(hiddenLanes.root, [
    'No listed finding needs action in this clone', 'scope', 'label: Lane disagreements', 'section',
    'label: No action in this clone', 'details: at least 1 agreeing lane — no action in this clone',
  ], 'RR3C-SECTIONS-ASSERTED: unlisted lane rows beside a listed agreeing lane render their exact sections');
  const oneHidden = render(payload({ lane_divergence_overflow_count: 1 }));
  eq(headlineOf(oneHidden), 'No listed finding needs action in this clone',
    'FINDINGS: one unlisted lane row keeps the headline from claiming nothing needs action');
  assertOutline(oneHidden.root, ['No listed finding needs action in this clone', 'scope', 'label: Lane disagreements', 'section'],
    'RR3C-SECTIONS-ASSERTED: one unlisted lane row renders only the lane section');
}

function recovery() {
  const required = [
    'type', 'schema_version', 'project', 'ledger', 'no_op', 'checked',
    'untracked_members', 'untracked_members_overflow_count', 'untracked_members_by_provenance',
    'unprojectable_epics', 'unprojectable_epics_overflow_count', 'binding_drift',
    'lane_divergence', 'lane_divergence_overflow_count', 'projection_errors', 'projection_errors_overflow_count',
    'foreign_writes', 'foreign_writes_overflow_count',
  ];
  const base = liveShape();
  const rejects = (page, label) => {
    check(new BoardHealth()._validPayload(page) === false, `BHV-RECOVERY: ${label} fails validation`);
    check(isRecovery(render(page)), `BHV-RECOVERY: ${label} renders exactly one recovery line`);
  };
  for (const key of required) {
    const broken = JSON.parse(JSON.stringify(base));
    delete broken[key];
    rejects(broken, `removing ${key}`);
  }
  const entries = {
    untracked_members: [member('FM-1', 'foreign'), { coordinator: 0, foreign: 1 }, {
      card: [123, ''], epic: [7, ''], note_status: [null, ''], provenance: ['other', null], remedy: [null, ''],
    }],
    unprojectable_epics: [{ epic: 'E', error: 'x', remedy: 'y' }, null, {
      epic: [null, ''], error: [5, ''], remedy: [null, ''],
    }],
    lane_divergence: [lane('E', 'active', 'In Progress', false), null, {
      epic: [null, ''], derived: [3, ''], painted: [4, ''], agrees: ['false', null],
    }],
    projection_errors: [{ card: 'C', phase: 'implementing', error: 'x' }, null, {
      card: [null, ''], phase: [1, ''], error: [null, ''],
    }],
    foreign_writes: [{ card: 'C', phase: 'implementing' }, null, { card: [null, ''], phase: [2, ''] }],
  };
  const wellFormedSection = {
    untracked_members: 'Foreign-written members', unprojectable_epics: 'Unprojectable epics',
    lane_divergence: 'Lane disagreements', projection_errors: 'Projection errors', foreign_writes: 'Foreign writes',
  };
  for (const [list, [valid, provenance, fields]] of Object.entries(entries)) {
    const adjust = (value) => {
      const next = payload({ [list]: [value] });
      if (list === 'untracked_members') next.untracked_members_by_provenance = provenance;
      return next;
    };
    const wellFormed = render(adjust(valid));
    check(!isRecovery(wellFormed), `BHV-RECOVERY: a well-formed ${list} entry renders without recovery`);
    assertOutline(wellFormed.root, ['1 finding needs action in this clone', 'scope', `label: ${wellFormedSection[list]}`, 'section'],
      `RR3C-SECTIONS-ASSERTED: a well-formed ${list} entry renders its exact outline`);
    for (const [kind, malformed] of [['null', null], ['scalar', 7], ['array', []]]) {
      rejects(adjust(malformed), `a ${kind} ${list} entry`);
    }
    for (const [key, wrongs] of Object.entries(fields)) {
      const missing = { ...valid };
      delete missing[key];
      rejects(adjust(missing), `a ${list} entry missing ${key}`);
      for (const wrong of wrongs) rejects(adjust({ ...valid, [key]: wrong }), `a ${list} entry with ${key}=${JSON.stringify(wrong)}`);
    }
  }
  const nullPainted = render(payload({ lane_divergence: [lane('E', 'active', null, false)] }));
  check(!isRecovery(nullPainted), 'BHV-RECOVERY: a lane entry with a null painted lane is well-formed');
  assertOutline(nullPainted.root, ['1 finding needs action in this clone', 'scope', 'label: Lane disagreements', 'section'],
    'RR3C-SECTIONS-ASSERTED: a lane entry with a null painted lane renders its exact outline');
  const nullEpic = render(payload({
    untracked_members: [member('FM-1', 'foreign', { epic: null })],
    untracked_members_by_provenance: { coordinator: 0, foreign: 1 },
  }));
  check(!isRecovery(nullEpic), 'BHV-RECOVERY: an untracked member with a null epic is well-formed');
  assertOutline(nullEpic.root, ['1 finding needs action in this clone', 'scope', 'label: Foreign-written members', 'section'],
    'RR3C-SECTIONS-ASSERTED: an untracked member with a null epic renders its exact outline');

  const cases = [
    ['a wrong type', { type: 'loop-station' }],
    ['a wrong schema_version', { schema_version: '2.0.0' }],
    ['an empty project', { project: ' ' }],
    ['a non-string project', { project: 7 }],
    ['an unknown ledger', { ledger: 'stale' }],
    ['a non-boolean no_op', { no_op: 'false' }],
    ['a non-object checked', { checked: null }],
    ['a negative checked count', { checked: { epics: -1, slices: 1, records: 1 } }],
    ['a fractional checked count', { checked: { epics: 1, slices: 1.5, records: 1 } }],
    ['a missing checked records', { checked: { epics: 1, slices: 1 } }],
    ['a string list', { lane_divergence: 'none' }],
    ['a list over the cap', { lane_divergence: Array.from({ length: 21 }, (_, index) => lane(`L${index}`, 'active', 'In Progress', true)) }],
    ['a negative overflow count', { projection_errors_overflow_count: -1 }],
    ['a fractional overflow count', { foreign_writes_overflow_count: 0.5 }],
    ['a string overflow count', { unprojectable_epics_overflow_count: '0' }],
    ['a non-object provenance tally', { untracked_members_by_provenance: [0, 0] }],
    ['a negative provenance count', { untracked_members_by_provenance: { coordinator: -1, foreign: 1 } }],
    ['a missing foreign tally', { untracked_members_by_provenance: { coordinator: 0 } }],
    ['a null cross-clone tally that sums to the total', {
      untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: null, foreign: 1 },
    }],
    ['a null foreign tally that sums to the total', {
      untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: 1, foreign: null },
    }],
    ['a boolean cross-clone tally that sums to the total', {
      untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: true, foreign: 0 },
    }],
    ['a provenance tally that disagrees with the total', { untracked_members_by_provenance: { coordinator: 1, foreign: 0 } }],
    ['more listed foreign members than the tally', {
      untracked_members: [member('FM-1', 'foreign')], untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    }],
    ['more listed cross-clone members than the tally', {
      untracked_members: [member('XC-1', 'coordinator')], untracked_members_by_provenance: { coordinator: 0, foreign: 1 },
    }],
    ['a non-object binding_drift', { binding_drift: 'clean' }],
    ['a binding_drift without remedy', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0 } }],
    ['a binding_drift with an empty remedy', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, remedy: '' } }],
    ['a binding_drift with an empty error', { binding_drift: { error: '', remedy: DRIFT_REMEDY } }],
    ['a binding_drift missing atlases', { binding_drift: { slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY } }],
    ['a binding_drift with negative slices', { binding_drift: { atlases: 0, slices: -1, orphan_lines: 0, remedy: DRIFT_REMEDY } }],
    ['a binding_drift missing orphan_lines', { binding_drift: { atlases: 0, slices: 0, remedy: DRIFT_REMEDY } }],
    ['a negative reports count', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, reports: -1, remedy: DRIFT_REMEDY } }],
    ['a non-object report_codes', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, report_codes: [], remedy: DRIFT_REMEDY } }],
    ['a numeric report_codes', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, report_codes: 5, remedy: DRIFT_REMEDY } }],
    ['a non-count report code', { binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, report_codes: { x: 'one' }, remedy: DRIFT_REMEDY } }],
    ['no_op true with a drift error', { no_op: true, binding_drift: { error: 'boom', remedy: DRIFT_REMEDY } }],
    ['no_op true with drifted atlases', { no_op: true, binding_drift: { atlases: 1, slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY } }],
    ['no_op true with drifted slices', { no_op: true, binding_drift: { atlases: 0, slices: 1, orphan_lines: 0, remedy: DRIFT_REMEDY } }],
    ['no_op true with orphan lines', { no_op: true, binding_drift: { atlases: 0, slices: 0, orphan_lines: 1, remedy: DRIFT_REMEDY } }],
    ['no_op true with a listed lane row', { no_op: true, lane_divergence: [lane('E', 'active', 'In Progress', true)] }],
    ['no_op true with an overflow count and no listed row', { no_op: true, foreign_writes_overflow_count: 1 }],
  ];
  for (const [label, overrides] of cases) rejects(payload(overrides), label);

  const validationRejects = [
    ['a provenance tally below the untracked total', {
      untracked_members_overflow_count: 2, untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    }],
    ['a provenance tally above the untracked total', {
      untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: 1, foreign: 1 },
    }],
    ['no_op true with a listed projection error', {
      no_op: true, projection_errors: [{ card: 'PE-1', phase: 'implementing', error: 'x' }],
    }],
    ['no_op true with a projection-error overflow', { no_op: true, projection_errors_overflow_count: 1 }],
    ['no_op true with a listed unprojectable epic', {
      no_op: true, unprojectable_epics: [{ epic: 'Ghost', error: 'y', remedy: DRIFT_REMEDY }],
    }],
    ['no_op true with an unprojectable-epic overflow', { no_op: true, unprojectable_epics_overflow_count: 1 }],
    ['no_op true with a listed untracked member', {
      no_op: true, untracked_members: [member('XC-1', 'coordinator')],
      untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    }],
    ['no_op true with an untracked-member overflow', {
      no_op: true, untracked_members_overflow_count: 1, untracked_members_by_provenance: { coordinator: 1, foreign: 0 },
    }],
    ['a binding_drift error without a remedy', { binding_drift: { error: 'binding-drift plan is unreadable: boom' } }],
    ['a binding_drift error with an empty remedy', { binding_drift: { error: 'binding-drift plan is unreadable: boom', remedy: '' } }],
    ['a reports-shaped binding_drift missing atlases', {
      binding_drift: { slices: 0, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY },
    }],
    ['a reports-shaped binding_drift missing slices', {
      binding_drift: { atlases: 0, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY },
    }],
    ['a reports-shaped binding_drift missing orphan_lines', {
      binding_drift: { atlases: 0, slices: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY },
    }],
    ['a reports-shaped binding_drift with a string atlases count', {
      binding_drift: { atlases: '0', slices: 0, orphan_lines: 0, reports: 0, report_codes: {}, remedy: DRIFT_REMEDY },
    }],
    ['reports: null', {
      binding_drift: { atlases: 0, slices: 0, orphan_lines: 0, reports: null, report_codes: {}, remedy: DRIFT_REMEDY },
    }],
  ];
  for (const [label, overrides] of validationRejects) {
    const page = payload(overrides);
    const shown = render(page);
    eq([new BoardHealth()._validPayload(page), shown.root.children.map((child) => [child.tag, child.className, child.textContent]),
      shown.sections], [false, [['div', 'board-health-recovery', RECOVERY]], []],
    `RR3C-VALIDATION-REJECTS: ${label} fails validation and its root holds only the literal recovery line`);
  }

  currentPage = { ...liveShape(), file: { path: NOTE_PATH } };
  const failing = new (loadClass())();
  failing._renderForeignMembers = (_dv, root) => {
    root.createEl('div', { text: 'misleading partial section' });
    throw new Error('fixture render failure');
  };
  const container = element();
  sections.length = 0;
  renderSwept(failing, { container });
  eq([container.children.length, isRecovery({ container, root: container.children[0], sections: [] }),
    lines(container).includes('misleading partial section')], [1, true, false],
  'BHV-RECOVERY: a render failure leaves only the recovery line in the root');
  assertOutline(container.children[0], [`recovery: ${RECOVERY}`],
    'RR3C-SECTIONS-ASSERTED: a render failure leaves an outline of only the recovery line');

  const early = new (loadClass())();
  early._renderLanes = (_dv, root) => {
    root.createEl('div', { text: 'misleading partial lane section' });
    throw new Error('fixture early render failure');
  };
  const earlyContainer = element();
  sections.length = 0;
  renderSwept(early, { container: earlyContainer });
  eq([earlyContainer.children.length, isRecovery({ container: earlyContainer, root: earlyContainer.children[0], sections: [] })],
    [1, true], 'RR3D-EDGES-AND-CONVERGENCE: a render failure after only the headline, scope line, and one partial line leaves only the recovery line in the root');
  assertOutline(earlyContainer.children[0], [`recovery: ${RECOVERY}`],
    'RR3D-EDGES-AND-CONVERGENCE: an early render failure leaves an outline of only the recovery line');

  const replaced = element();
  const stale = replaced.createEl('div');
  stale.className = 'board-health-root';
  currentPage = { ...payload({ no_op: true }), file: { path: NOTE_PATH } };
  renderSwept(new BoardHealth(), { container: replaced });
  eq([replaced.children.length, replaced.children[0] === stale, headlineOf({ container: replaced })],
    [1, false, 'Board healthy'], 'BHV-RECOVERY: a re-render replaces the previous root');
  assertOutline(replaced.children[0], ['Board healthy', 'scope'],
    'RR3C-SECTIONS-ASSERTED: a re-render renders its exact outline');
  renderSwept(new BoardHealth(), { container: replaced });
  eq(replaced.children.map((child) => [child.tag, child.className]), [['div', 'board-health-root']],
    'BHV-RECOVERY: rendering twice into one container leaves one board-health-root');
  assertOutline(replaced.children[0], ['Board healthy', 'scope'],
    'RR3C-SECTIONS-ASSERTED: a second re-render renders its exact outline');
}

function readOnlyAndFreshness() {
  const cold = element();
  let currentTouches = 0;
  const renderSafe = global.customJS.RenderSafe;
  delete global.customJS.RenderSafe;
  renderSwept(new BoardHealth(), new Proxy({ container: cold }, {
    get(target, property) {
      if (property === 'current') currentTouches += 1;
      return target[property];
    },
  }));
  global.customJS.RenderSafe = renderSafe;
  eq([cold.children.length, currentTouches], [0, 0],
    'BHV-READ-ONLY: with RenderSafe absent render adds nothing and reads no dv.current');
  eq(render(null).container.children.length, 0, 'BHV-READ-ONLY: a null RenderSafe page renders nothing');
  for (const value of [null, [], 'board-health']) {
    check(new BoardHealth()._validPayload(value) === false,
      `BHV-RECOVERY: ${JSON.stringify(value)} is not a valid payload`);
  }

  const clicked = render(payload({
    lane_divergence: [lane('Loop Ops', 'active', 'Completed', false)],
    projection_errors: [{ card: 'PE-1', phase: 'implementing', error: 'x' }],
  }));
  assertOutline(clicked.root, [
    '2 findings need action in this clone', 'scope', 'label: Lane disagreements', 'section',
    'label: Projection errors', 'section',
  ], 'RR3C-SECTIONS-ASSERTED: the click fixture renders its exact outline');
  const before = opened.length;
  for (const link of byClass(clicked.root, 'board-health-link')) {
    check(link.tag === 'a' && link.href === '#' && link.style.cssText.includes('min-height:44px'),
      `BHV-READ-ONLY: ${link.textContent} is an anchor with href # that declares min-height 44px`);
    let prevented = 0;
    link.listeners.click({ preventDefault() { prevented += 1; } });
    check(prevented === 1, `BHV-READ-ONLY: ${link.textContent} click prevents the default navigation`);
  }
  eq(opened.slice(before), [['Loop Ops', NOTE_PATH, false], ['PE-1', NOTE_PATH, false]],
    'BHV-READ-ONLY: link clicks pass the exact epic and card names to openLinkText');
  const openLinkText = global.app.workspace.openLinkText;
  global.app.workspace.openLinkText = () => { throw new Error('fixture navigation failure'); };
  let thrown = null;
  try { byClass(clicked.root, 'board-health-link')[0].listeners.click({ preventDefault() {} }); } catch (error) { thrown = error; }
  global.app.workspace.openLinkText = openLinkText;
  eq(thrown, null, 'BHV-READ-ONLY: a navigation failure on click is contained');

  let outcome = 'returned';
  try { renderSwept(new BoardHealth(), {}); } catch (_error) { outcome = 'threw'; }
  eq(outcome, 'returned', 'BHV-READ-ONLY: render with a dv that has no container does not throw');

  const sectionLabel = global.customJS.SectionLabel;
  delete global.customJS.SectionLabel;
  const unlabelled = render(liveShape());
  global.customJS.SectionLabel = { render: () => { throw new Error('fixture label failure'); } };
  const failedLabel = render(liveShape());
  global.customJS.SectionLabel = sectionLabel;
  for (const [label, rendered] of [['absent', unlabelled], ['throwing', failedLabel]]) {
    eq(rendered.root.children.filter((child) => child.tag === 'div' && child.className === ''
      && !child.children.length).map((child) => child.textContent),
    ['Lane disagreements', 'Foreign-written members', 'No action in this clone'],
    `LABELS: a ${label} SectionLabel falls back to plain section labels`);
  }
  assertOutlines([unlabelled.root, failedLabel.root], Array(2).fill([
    '13 findings need action in this clone', 'scope', 'plain: Lane disagreements', 'section',
    'plain: Foreign-written members', 'section', 'plain: No action in this clone',
    'details: 64 cross-clone members · 6 agreeing lanes — no action in this clone',
  ]), 'RR3C-SECTIONS-ASSERTED: an absent and a throwing SectionLabel each render the exact outline with plain labels');

  const source = helperSource();
  check(!source.includes('dv.current'), 'BHV-READ-ONLY: the helper source has no dv.current');
  check(!/createEl\(\s*["'`]h[1-6]["'`]/.test(source), 'BHV-READ-ONLY: the helper source creates no heading element');
  check(!source.includes('---') && !/createEl\(\s*["'`]hr["'`]/.test(source),
    'BHV-READ-ONLY: the helper source has no --- and creates no hr element');
  eq([NAMED_COLOURS.length, new Set(NAMED_COLOURS).size, SYSTEM_COLOURS.length, new Set(SYSTEM_COLOURS).size], [148, 148, 42, 42],
    'BHV-READ-ONLY: NAMED_COLOURS holds 148 distinct names and SYSTEM_COLOURS holds 42 distinct names');
  eq(source.match(/#[0-9a-f]{3,8}(?![0-9a-z_-])/gi) || [], [],
    'BHV-READ-ONLY: the helper source, comments included, has no hex colour: # followed by 3 to 8 hex digits and no further letter, digit, underscore, or hyphen');
  eq(source.match(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk|light-dark)\s*\(/gi) || [], [],
    'BHV-READ-ONLY: the helper source, comments included, calls none of rgb(), rgba(), hsl(), hsla(), hwb(), lab(), lch(), oklab(), oklch(), color(), device-cmyk(), or light-dark(), in any letter case');
  const escapes = [];
  const literals = stringLiterals(source, escapes);
  eq(escapes.filter((pair) => !ALLOWED_ESCAPES.includes(pair)), [],
    'BHV-READ-ONLY: every backslash escape in the helper source\'s string literals (double-quoted, single-quoted, or template text) is \\", \\\', or \\`');
  eq(literals.flatMap(colourKeywordHits), [],
    'BHV-READ-ONLY: no string literal in the helper source (double-quoted, single-quoted, or template text) is, trimmed and in any letter case, one of the 148 CSS named colours in NAMED_COLOURS, the 42 CSS system colours in SYSTEM_COLOURS, transparent, or currentcolor, or holds one of them as a whole token of a property: value pair\'s value, except transparent as the last argument of color-mix(in srgb, var(--…) N%, transparent)');
  const sourceDeclarations = literals.map(literalDeclarations).filter(Boolean).flat();
  eq([cssViolations(sourceDeclarations), [...new Set(sourceDeclarations.map(([property]) => property)
    .filter((property) => COLOUR_GRAMMAR[property]))].sort()],
  [[], ['background', 'border', 'border-bottom', 'color', 'text-decoration']],
  `BHV-READ-ONLY: every string literal in the helper source (double-quoted, single-quoted, or template text) that holds a property: value pair, in any letter case and spacing and with or without a trailing semicolon, holds only such pairs, each of which ${COLOUR_RULE}; those literals set color, background, border, border-bottom, and text-decoration`);

  const time = FOOTER_TIME;
  const footerRoots = [];
  const footer = (file) => {
    const rendered = render(payload({ no_op: true }), file);
    footerRoots.push(rendered.root);
    return [headlineOf(rendered), ...byClass(rendered.root, 'board-health-footer').map((node) => `${node.tag}: ${node.textContent}`)];
  };
  eq(footer({ path: NOTE_PATH, mtime: { toMillis: () => time } }), ['Board healthy', 'div: Note file last changed 2026-08-23 21:18'],
    'BHV-FRESHNESS: a Dataview mtime renders as the note file time');
  eq(footer({ path: NOTE_PATH, mtime: time }), ['Board healthy', 'div: Note file last changed 2026-08-23 21:18'],
    'BHV-FRESHNESS: a numeric mtime renders as the note file time');
  vaultStats.set(NOTE_PATH, { mtime: Date.UTC(2026, 0, 5, 7, 4) });
  eq(footer({ path: NOTE_PATH }), ['Board healthy', 'div: Note file last changed 2026-01-05 07:04'],
    'BHV-FRESHNESS: without a page mtime the vault file stat supplies the note file time');
  eq(footer({ path: NOTE_PATH, mtime: null }), ['Board healthy', 'div: Note file last changed 2026-01-05 07:04'],
    'BHV-FRESHNESS: a null page mtime falls back to the vault file stat');
  eq(footer({ path: NOTE_PATH, mtime: 0 }), ['Board healthy', 'div: Note file last changed 1970-01-01 00:00'],
    'BHV-FRESHNESS: a zero page mtime is used without the vault file stat');
  vaultStats.clear();
  eq(footer({ path: NOTE_PATH }), ['Board healthy'], 'BHV-FRESHNESS: no known file time renders no footer');
  const lookup = global.app.vault.getAbstractFileByPath;
  global.app.vault.getAbstractFileByPath = () => { throw new Error('fixture vault lookup failure'); };
  const thrownLookup = footer({ path: NOTE_PATH });
  global.app.vault.getAbstractFileByPath = lookup;
  eq(thrownLookup, ['Board healthy'], 'BHV-FRESHNESS: a vault file lookup that throws renders no footer and no recovery line');
  process.env.TZ = 'America/Denver';
  const local = footer({ path: NOTE_PATH, mtime: time });
  process.env.TZ = 'UTC';
  eq(local, ['Board healthy', 'div: Note file last changed 2026-08-23 15:18'],
    'BHV-FRESHNESS: in time zone America/Denver the footer reads the note file time as local wall-clock time');
  process.env.TZ = 'America/Denver';
  const denverEvening = footer({ path: NOTE_PATH, mtime: Date.UTC(2026, 7, 24, 3, 18) });
  process.env.TZ = 'Asia/Kolkata';
  const kolkata = footer({ path: NOTE_PATH, mtime: Date.UTC(2026, 7, 23, 21, 18) });
  process.env.TZ = 'UTC';
  eq(denverEvening, ['Board healthy', 'div: Note file last changed 2026-08-23 21:18'],
    'BHV-FRESHNESS: in time zone America/Denver a note file time of 2026-08-24T03:18Z reads as the local date and time 2026-08-23 21:18, not the UTC date');
  eq(kolkata, ['Board healthy', 'div: Note file last changed 2026-08-24 02:48'],
    'BHV-FRESHNESS: in time zone Asia/Kolkata (UTC+5:30) a note file time of 2026-08-23T21:18Z reads as the local date and time 2026-08-24 02:48, not the UTC date or minutes');
  eq(footer({ path: NOTE_PATH, mtime: 'yesterday' }), ['Board healthy'], 'BHV-FRESHNESS: an unreadable mtime renders no footer');
  assertOutlines(footerRoots, [
    ['Board healthy', 'scope', FOOTER], ['Board healthy', 'scope', FOOTER],
    ['Board healthy', 'scope', 'footer: Note file last changed 2026-01-05 07:04'],
    ['Board healthy', 'scope', 'footer: Note file last changed 2026-01-05 07:04'],
    ['Board healthy', 'scope', 'footer: Note file last changed 1970-01-01 00:00'],
    ['Board healthy', 'scope'], ['Board healthy', 'scope'],
    ['Board healthy', 'scope', 'footer: Note file last changed 2026-08-23 15:18'],
    ['Board healthy', 'scope', 'footer: Note file last changed 2026-08-23 21:18'],
    ['Board healthy', 'scope', 'footer: Note file last changed 2026-08-24 02:48'], ['Board healthy', 'scope'],
  ], 'RR3C-SECTIONS-ASSERTED: the 11 file-time fixtures each render their headline, no section, and their literal footer or none');

  const freshness = [
    liveShape(), payload({ no_op: true }), payload({ no_op: true, ledger: 'empty', checked: { epics: 20, slices: 185, records: 0 } }),
    payload({ lane_divergence_overflow_count: 1 }),
    payload({ binding_drift: { atlases: 1, slices: 0, orphan_lines: 0, remedy: DRIFT_REMEDY } }),
  ].map((page) => render(page, { path: NOTE_PATH, mtime: time }));
  assertOutlines(freshness.map((rendered) => rendered.root), [
    ['13 findings need action in this clone', 'scope', 'label: Lane disagreements', 'section',
      'label: Foreign-written members', 'section', 'label: No action in this clone',
      'details: 64 cross-clone members · 6 agreeing lanes — no action in this clone', FOOTER],
    ['Board healthy', 'scope', FOOTER],
    ['Board healthy', 'scope', skippedBanner('empty'), FOOTER],
    ['No listed finding needs action in this clone', 'scope', 'label: Lane disagreements', 'section', FOOTER],
    ['1 finding needs action in this clone', 'scope', 'label: Binding drift', 'section', FOOTER],
  ], 'RR3C-SECTIONS-ASSERTED: the 5 freshness payloads each render their exact outline with the footer');
  const everything = freshness.flatMap((rendered) => lines(rendered.container));
  check(!everything.some((text) => /\b(checked|updated|fresh|current as of|as of)\b/i.test(text)),
    'BHV-FRESHNESS: no line rendered for these payloads uses checked, updated, fresh, or as of');
}

function registration() {
  const manifest = JSON.parse(read('platform/blueprints/project/manifest.json'));
  eq(manifest.customjs_classes.filter((name) => name === 'BoardHealth').length, 1,
    'BHV-REGISTRATION: the project manifest registers BoardHealth once');
  eq(manifest.files.filter((entry) => entry.source === 'helpers/board-health.js')
    .map((entry) => entry.dest), ['{{scripts_path}}/project/board-health.js'],
  'BHV-REGISTRATION: helpers/board-health.js maps once to scripts_path/project/board-health.js');
  eq(JSON.parse(read('package.json')).scripts['test:board-health'], 'node platform/test/run-board-health.js',
    'BHV-REGISTRATION: package.json exposes test:board-health');
  const steps = JSON.parse(read('platform/test/preflight-manifest.json')).steps
    .filter((step) => step.cmd.join(' ').includes('run-board-health'));
  eq(steps.map((step) => [step.cmd, step.group]), [[['node', 'platform/test/run-board-health.js'], 'chrome']],
    'BHV-REGISTRATION: the preflight manifest has one board-health step in the chrome group');
  const orphan = childProcess.spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-orphan-harnesses.js')],
    { cwd: ROOT, encoding: 'utf8' });
  check(orphan.status === 0 && orphan.stdout.startsWith('PASS'),
    `BHV-REGISTRATION: check-orphan-harnesses passes: ${orphan.stdout}${orphan.stderr}`);
}

async function visual() {
  const html = fs.readFileSync(VISUAL, 'utf8');
  check(html.includes('<script src="../../blueprints/project/helpers/board-health.js"></script>')
    && html.includes('<script src="../../mechanisms/section-label/section-label.js"></script>'),
  'BHV-390PX: the visual fixture loads the shipped helper and SectionLabel scripts');
  const executable = chromeExecutable();
  check(Boolean(executable), 'BHV-390PX: a Chrome executable is available for the geometry proof');
  for (const width of [390, 1024]) {
    const colourQuery = encodeURIComponent(JSON.stringify([...NAMED_COLOURS, 'transparent', 'currentcolor']));
    const { marker } = await captureViewport(executable, `${pathToFileURL(VISUAL).href}?viewport=${width}&colours=${colourQuery}`, width, 900);
    eq([Number(marker['colour-names']), JSON.parse(marker['unsupported-colours'] || '["unreported"]')], [150, []],
      `BHV-READ-ONLY: at ${width}px headless Chrome accepts, through CSS.supports('color', name), each of the 148 names in NAMED_COLOURS, transparent, and currentcolor`);
    eq([marker.geometry, marker.failures], ['pass', ''], `BHV-390PX: ${width}px light and dark geometry passes`);
    eq(Number(marker.checks), VISUAL_CHECK_FLOOR, `BHV-390PX: ${width}px ran ${VISUAL_CHECK_FLOOR} geometry checks`);
    eq(JSON.parse(marker['check-names'] || '[]'), CHROME_CHECKS,
      `RR3D-BROWSER-EXPECTED-STATE: at ${width}px the page ran, for each of its 8 fixture mounts, the literal scope, remedy-code, not-listed, footer, text-line, collapsed-details, element-tag, root-outline, row, link-click, row-stacking, and summary-display checks beside the layout checks, and for each full fixture the checks that the card name with no hyphen or space wraps and that at 390 px the headline wraps onto at least 2 lines`);
    const reported = JSON.parse(marker.headlines || '[]');
    eq([reported.map(({ fixture, text }) => [fixture, text]), Number(marker['unswept-headlines'])], [CHROME_HEADLINES, 0],
      `RR3-SWEEP-EVERY-HEADLINE: at ${width}px the page hands the sweep its ${CHROME_HEADLINES.length} literal fixture headlines and leaves out no headline element it created through createEl or holds in its document`);
    for (const { fixture, laneOverflow, text } of reported) swept.push({ site: 'chrome', fixture: `${width}px ${fixture}`, laneOverflow, text });
  }
}

function headlineSweep() {
  const hedged = /^(?:At least \d+ findings? needs? action|No listed finding needs action) in this clone$/;
  const exact = /^(?:\d+ findings? needs? action in this clone|Nothing needs action in this clone|Board healthy)$/;
  const inProcess = new Set(swept.filter(({ site }) => site === 'in-process').map(({ node }) => node));
  eq([inProcess.size, created.filter((node) => isHeadline(node) && !inProcess.has(node)).length], [IN_PROCESS_HEADLINES, 0],
    `RR3-SWEEP-EVERY-HEADLINE: the sweep holds ${IN_PROCESS_HEADLINES} in-process headline elements and leaves out no headline element the harness DOM stub created`);
  const entries = swept.map(({ site, node, laneOverflow, text }) => ({ site, laneOverflow, text: node ? node.textContent : text }));
  eq(entries.filter(({ laneOverflow, text }) => !(laneOverflow > 0 ? hedged : exact).test(text)), [],
    'RR3-SWEEP-EVERY-HEADLINE: each swept headline is hedged when its payload has unlisted lane rows and exact when it has none');
  eq(['in-process', 'chrome'].map((site) => ['At least', 'No listed', 'exact'].map((kind) => entries.some((entry) => (
    entry.site === site && (kind === 'exact' ? !entry.laneOverflow : entry.laneOverflow > 0 && entry.text.startsWith(kind)))))),
  [[true, true, true], [true, false, true]],
  'RR3-SWEEP-EVERY-HEADLINE: the in-process headlines include an at-least, a no-listed, and an exact headline; the Chrome headlines include an at-least and an exact headline');
}

async function main() {
  await classAndProduction();
  await honestCount();
  actionableFirst();
  laneAgreesAndHealthy();
  await ledgerSkipped();
  await ledgerSkippedOverflow();
  await crossCloneOnlyInOverflow();
  edgesAndConvergence();
  validationTable();
  findingClasses();
  recovery();
  readOnlyAndFreshness();
  registration();
  await visual();
  headlineSweep();
  eq(mutations, [], 'BHV-READ-ONLY: the throwing app-mutator stubs record zero calls');
  const styled = created.filter((node) => styleDeclarations(node).length);
  eq([cssViolations(styled.flatMap(styleDeclarations)),
    [...new Set(styled.map((node) => node.className || node.tag))].sort()],
  [[], [
    'board-health-command', 'board-health-detail', 'board-health-footer', 'board-health-headline',
    'board-health-ledger-skipped', 'board-health-link', 'board-health-no-action', 'board-health-not-listed',
    'board-health-remedy', 'board-health-root', 'board-health-row', 'board-health-scope', 'board-health-section', 'summary',
  ]], `BHV-READ-ONLY: every inline style declaration, in cssText or set as a style property, on every element the in-process renders styled ${COLOUR_RULE}, and those elements cover all 14 styled element kinds the helper creates`);
  const sweptRoots = new Set(swept.filter(({ site }) => site === 'in-process').map(({ node }) => node.parent));
  eq([sweptRoots.size, [...sweptRoots].filter((root) => !outlined.has(root)).length], [IN_PROCESS_HEADLINES, 0],
    `RR3C-SECTIONS-ASSERTED: each of the ${IN_PROCESS_HEADLINES} in-process swept headline roots has its outline asserted against a literal expected outline`);
  finished = true;
  console.log(`board-health tests: ok (${asserted} assertions)`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
