#!/usr/bin/env node
'use strict';

// PERF-10 research harness. Runs real hub classes against one large synthetic
// Dataview fixture. This is a measurement tool, not a production benchmark:
// the generous budget catches catastrophic query/render regressions while the
// reported median/p95 remain useful for deciding whether EntityQuery is needed.

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT = path.resolve(__dirname, '..', '..');
const src = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const load = (relative, name, args = [], values = []) =>
  new Function(...args, `${src(relative)}\nreturn ${name};`)(...values);

function element(tag = 'div', options = {}) {
  const node = {
    tag, tagName: String(tag).toUpperCase(), className: options.cls || '',
    textContent: options.text || '', innerHTML: '', children: [], parentNode: null,
    style: {}, dataset: {}, attributes: {}, _listeners: {}, isConnected: true,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions); child.parentNode = this;
      this.children.push(child); return child;
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
      this.parentNode = null; this.isConnected = false;
    },
    empty() { this.children = []; },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    closest() { return null; },
    querySelector(selector) {
      const cls = String(selector).match(/\.([A-Za-z0-9_-]+)/)?.[1];
      if (!cls) return null;
      const visit = (cur) => {
        for (const child of cur.children || []) {
          if (String(child.className).split(/\s+/).includes(cls)) return child;
          const nested = visit(child); if (nested) return nested;
        }
        return null;
      };
      return visit(this);
    },
    querySelectorAll(selector) {
      const wanted = String(selector).toUpperCase(); const out = [];
      const visit = (cur) => { for (const child of cur.children || []) {
        if (wanted === child.tagName || (wanted === 'BUTTON' && child.tagName === 'BUTTON')) out.push(child);
        visit(child);
      } };
      visit(this); return out;
    },
  };
  node.classList = { add(cls) { node.className += `${node.className ? ' ' : ''}${cls}`; } };
  return node;
}

function dataArray(items) {
  const list = Array.from(items || []);
  list.where = (fn) => dataArray(list.filter(fn));
  list.sort = (fn, direction) => {
    const copy = Array.from(list).sort((a, b) => {
      const av = typeof fn === 'function' ? fn(a) : a;
      const bv = typeof fn === 'function' ? fn(b) : b;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    if (direction === 'desc') copy.reverse();
    return dataArray(copy);
  };
  list.array = () => Array.from(list);
  return list;
}

function nodeCount(root) {
  let count = 1;
  for (const child of root.children || []) count += nodeCount(child);
  return count;
}

function propertyCount(root, key, value = true) {
  let count = root && root[key] === value ? 1 : 0;
  for (const child of (root && root.children) || []) count += propertyCount(child, key, value);
  return count;
}

function classCount(root, cls) {
  let count = String((root && root.className) || '').split(/\s+/).includes(cls) ? 1 : 0;
  for (const child of (root && root.children) || []) count += classCount(child, cls);
  return count;
}

function requireMeasurement(condition, message) {
  if (!condition) throw new Error(`PERF-10 invalid measurement: ${message}`);
}

function fixture() {
  const today = '2026-08-03';
  const pages = [];
  const byScope = new Map();
  const add = (scope, page) => { pages.push(page); if (!byScope.has(scope)) byScope.set(scope, []); byScope.get(scope).push(page); };
  for (let i = 0; i < 120; i++) {
    const slug = `project-${i}`; const folder = `spice/projects/${slug}`;
    add('spice/projects', { type: 'project', name: `Project ${i}`, status: i % 9 === 0 ? 'archived' : 'in-progress',
      project_slug: slug, file: { name: `Project ${i}`, path: `${folder}/Project ${i}.md`, folder, etags: ['#project'], mtime: { ts: 1_900_000_000_000 - i } } });
    for (let j = 0; j < 6; j++) add(folder, { type: 'doc-note', file: { name: `Doc ${j}`, path: `${folder}/docs/Doc ${j}.md`, folder: `${folder}/docs`, etags: [], mtime: { ts: 1_900_000_000_000 - i - j } } });
  }
  const currentFolder = 'spice/projects/project-0';
  for (let i = 0; i < 360; i++) add('spice/tasks', { type: 'task', status: 'open', title: `Task ${i}`,
    scheduled: i % 3 === 0 ? today : '2026-08-02', project_slug: `project-${i % 120}`, source: 'manual',
    priority: ['high', 'medium', 'low'][i % 3], file: { name: `Task ${i}`, path: `spice/tasks/task-${i}.md`, mtime: { ts: 1_900_000_000_000 - i } } });
  for (let i = 0; i < 80; i++) add('spice/tasks/_done', { type: 'task', completed_at: `${today}T12:00:00`, file: { name: `Done ${i}`, path: `spice/tasks/_done/done-${i}.md` } });
  for (let i = 0; i < 180; i++) add('spice/meetings/notes', { type: 'meeting', project: `[[Project ${i % 120}]]`, attendees: ['[[Ada]]', '[[Lin]]'],
    file: { name: `${today} Meeting ${i}`, path: `spice/meetings/notes/${today} Meeting ${i}.md`, mtime: { ts: 1_900_000_000_000 - i } } });
  for (let i = 0; i < 140; i++) add('spice/reader', { type: 'reader-article', status: i < 12 ? 'reading' : 'queued', captured_at: `${today}T10:00:00`, file: { name: `Article ${i}`, path: `spice/reader/article-${i}.md` } });
  for (let i = 0; i < 40; i++) add('spice/trips', { type: 'trip', trip_slug: `trip-${i}`, start_date: '2026-08-10', file: { name: `Trip ${i}`, path: `spice/trips/trip-${i}/Trip ${i}.md` } });
  for (let i = 0; i < 100; i++) add('activity', { type: i % 2 ? 'wiki-page' : 'sticky-note', created_at: `${today}T09:00:00`, file: { name: `Activity ${i}`, path: `spice/wiki/activity-${i}.md` } });
  const board = ['## In Planning', ...Array.from({ length: 20 }, (_, i) => `- [ ] Card ${i}`), '## In Progress', '- [ ] Active', '## Blocked', '- [ ] Blocked', '## Completed', '- [x] Done'].join('\n');
  const files = new Map();
  for (let i = 0; i < 120; i++) {
    const p = `spice/projects/project-${i}/project-${i}-board.md`;
    files.set(p, { path: p, content: board });
  }
  files.set(`${currentFolder}/Project 0 To-Do.md`, { path: `${currentFolder}/Project 0 To-Do.md`, content: '- [ ] one\n- [ ] two' });
  for (const p of byScope.get('spice/meetings/notes')) files.set(p.file.path, { path: p.file.path, content: '## Attendees\n- [[Ada]]\n\nNotes exist.\n- [ ] follow up' });
  return { today, pages, byScope, files, currentFolder, board };
}

function dvFor(fx, current) {
  const container = element('div');
  const queryCounts = new Map();
  return {
    container,
    _queryCounts: queryCounts,
    current: () => current,
    pages(query) {
      const scope = String(query || '').replaceAll('"', '');
      queryCounts.set(scope, (queryCounts.get(scope) || 0) + 1);
      if (!scope) return dataArray(fx.pages);
      if (scope === fx.currentFolder + '/docs') return dataArray(fx.byScope.get(fx.currentFolder) || []);
      if (scope === fx.currentFolder + '/tasks') return dataArray([]);
      return dataArray(fx.byScope.get(scope) || []);
    },
    page: () => null,
    el(tag, text, options = {}) { return container.createEl(tag, { ...options, text }); },
  };
}

async function samples(label, makeRun, count = 7) {
  await makeRun(); await makeRun();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now(); await makeRun(); values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const p95 = values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)];
  return { label, median_ms: Number(median.toFixed(2)), p95_ms: Number(p95.toFixed(2)) };
}

(async () => {
  const fx = fixture();
  const exactScopes = {
    'spice/projects': 120,
    'spice/tasks': 360,
    'spice/tasks/_done': 80,
    'spice/meetings/notes': 180,
    'spice/reader': 140,
    'spice/trips': 40,
    activity: 100,
  };
  requireMeasurement(fx.pages.length === 1740, `fixture must contain exactly 1,740 notes, got ${fx.pages.length}`);
  for (const [scope, expected] of Object.entries(exactScopes)) {
    requireMeasurement((fx.byScope.get(scope) || []).length === expected,
      `${scope} fixture must contain exactly ${expected} notes`);
  }
  const prior = { app: global.app, customJS: global.customJS, window: global.window, moment: global.moment, document: global.document,
    localStorageDescriptor: Object.getOwnPropertyDescriptor(global, 'localStorage') };
  const app = {
    vault: {
      getAbstractFileByPath: (p) => fx.files.get(p) || { path: p },
      read: async (file) => file.content || '', cachedRead: async (file) => file.content || '',
      adapter: { exists: async () => false, read: async () => '{}', write: async () => {}, mkdir: async () => {} },
    },
    workspace: { openLinkText() {}, getLeavesOfType: () => [] },
  };
  const moment = () => ({ format: () => fx.today, fromNow: () => 'now', isValid: () => true, valueOf: () => Date.now() });
  const localStorage = { getItem: () => null, setItem() {} };
  global.app = app;
  Object.defineProperty(global, 'localStorage', { value: localStorage, writable: true, configurable: true });
  global.window = { app, moment, customJS: null, localStorage };
  global.moment = moment; global.document = { body: element('body'), activeElement: null, createElement: (t) => element(t) };

  const metrics = { beaconPages: 0, activityQueried: 0, activityRendered: 0 };
  const resetMetrics = () => { metrics.beaconPages = 0; metrics.activityQueried = 0; metrics.activityRendered = 0; };
  const BeaconCards = { render: async (dv, opts) => { metrics.beaconPages += (opts.pages || []).length; for (const p of opts.pages || []) {
    const card = dv.container.createEl('div');
    if (opts.title) card.textContent = String(opts.title(p) || '');
    if (opts.meta) card.innerHTML = String(opts.meta(p) || '');
  } } };
  const SectionLabel = { render: ({ container }) => container.createEl('div'), divider: () => {} };
  const DocSearch = { matches: () => true, render: (dv) => ({ resultsContainer: dv.container.createEl('div') }) };
  const TaskEntity = {
    parseNote: (p) => ({ ...p, path: p.file.path, due: p.scheduled }),
    queryToday: (items, today) => ({ today: items.filter((p) => p.scheduled === today), overdue: items.filter((p) => p.scheduled < today) }),
    _toDateStr: (v) => String(v).slice(0, 10),
  };
  const TaskTodayList = { renderInlineLinks: (el, text) => { el.textContent = text; }, markTaskRow() {} };
  const ActivityFeed = {
    query: (dv) => { const selected = dv.pages('').where((p) => p.created_at && String(p.created_at).startsWith(fx.today)).array(); metrics.activityQueried += selected.length; return { pages: selected, total: selected.length }; },
    render: async (dv, opts) => { metrics.activityRendered += opts.precomputed.pages.length; for (const p of opts.precomputed.pages) dv.container.createEl('div', { text: p.file.name }); },
  };
  const customJS = { BeaconCards, SectionLabel, DocSearch, TaskEntity, TaskTodayList, ActivityFeed,
    RenderSafe: { page: (dv) => dv.current(), captureScroll() {} }, ProjectChromeBar: null, MenuPopover: { open() {} }, TaskDialog: { open() {} } };
  global.customJS = customJS; global.window.customJS = customJS;

  const ProjectsHubCards = load('platform/blueprints/project/helpers/projects-hub-cards.js', 'ProjectsHubCards');
  const ProjectDashboard = load('platform/blueprints/project/helpers/project-dashboard.js', 'ProjectDashboard', ['global'], [global]);
  const SpaceDailyDashboard = load('platform/blueprints/daily/helpers/space-daily-dashboard.js', 'SpaceDailyDashboard');
  const current = { type: 'project', name: 'Project 0', status: 'in-progress', project_slug: 'project-0', links: [], workstreams: ['a', 'b'],
    file: { name: 'Project 0', path: `${fx.currentFolder}/Project 0.md`, folder: fx.currentFolder } };

  const results = [];
  results.push(await samples('ProjectsHubCards.render', async () => {
    resetMetrics();
    const dv = dvFor(fx, current); const hub = new ProjectsHubCards();
    await hub.render(dv);
    requireMeasurement(hub._lookup && hub._lookup.size === 120, 'Projects hub did not enrich all 120 projects');
    requireMeasurement(hub._pages && hub._pages.length === 106, 'Projects hub did not render the exact 106 non-archived project cards');
    requireMeasurement(metrics.beaconPages === 106, `Projects hub rendered ${metrics.beaconPages}, expected 106 cards`);
    requireMeasurement((dv._queryCounts.get('spice/projects') || 0) === 1, 'Projects hub must query the project index exactly once');
    const projectFolderQueries = Array.from(dv._queryCounts.entries()).filter(([scope]) => /^spice\/projects\/project-\d+$/.test(scope));
    requireMeasurement(projectFolderQueries.length === 120 && projectFolderQueries.every(([, count]) => count === 1),
      'Projects hub must query each of 120 project folders exactly once');
    requireMeasurement(nodeCount(dv.container) > 100, 'Projects hub did not construct its card DOM');
  }));
  results.push(await samples('ProjectDashboard.render', async () => {
    resetMetrics();
    const dv = dvFor(fx, current); await new ProjectDashboard().render(dv);
    requireMeasurement(Boolean(dv.container.querySelector('.project-dashboard-root')), 'Project dashboard root was not rendered');
    requireMeasurement(nodeCount(dv.container) > 25, 'Project dashboard did not construct its sections');
    requireMeasurement((dv._queryCounts.get(`${fx.currentFolder}/docs`) || 0) === 2, 'Project dashboard must query project docs for counts and recency');
    requireMeasurement((dv._queryCounts.get('spice/meetings/notes') || 0) === 2, 'Project dashboard must query meetings for counts and recency');
    requireMeasurement((dv._queryCounts.get('spice/tasks') || 0) === 1, 'Project dashboard must query project tasks exactly once');
    requireMeasurement(propertyCount(dv.container, '__isRecentRow') === 6, 'Project dashboard must render 4 docs and 2 matching meeting rows');
  }));
  results.push(await samples('SpaceDailyDashboard.render', async () => {
    resetMetrics();
    const dv = dvFor(fx, { file: { name: `Journal-${fx.today}`, path: `spice/daily/Journal-${fx.today}.md` } });
    const dashboard = new SpaceDailyDashboard(); dashboard._readSectionState = async () => ({}); dashboard._enrichMeeting = async (p) => ({ ...p, attendees: ['Ada'], hasNotes: true, openTasks: 1 });
    await dashboard.render(dv, { asOf: fx.today });
    requireMeasurement(Boolean(dv.container.querySelector('.space-daily-dashboard')), 'Daily dashboard root was not rendered');
    requireMeasurement(nodeCount(dv.container) > 100, 'Daily dashboard did not construct its large-fixture sections');
    requireMeasurement((dv._queryCounts.get('spice/meetings/notes') || 0) === 1, 'Daily dashboard must query meetings exactly once');
    requireMeasurement((dv._queryCounts.get('spice/tasks') || 0) === 1 && (dv._queryCounts.get('spice/tasks/_done') || 0) === 1,
      'Daily dashboard must query open and completed task scopes exactly once');
    requireMeasurement((dv._queryCounts.get('spice/reader') || 0) === 1 && (dv._queryCounts.get('spice/trips') || 0) === 2,
      'Daily dashboard must query reader once and trips for gating plus rendering');
    requireMeasurement(metrics.beaconPages === 180, `Daily dashboard rendered ${metrics.beaconPages}, expected 180 meeting cards`);
    requireMeasurement(metrics.activityQueried === 100 && metrics.activityRendered === 112,
      `Daily activity must query 100 direct notes and render them with 12 reading articles; got ${metrics.activityQueried}/${metrics.activityRendered}`);
    requireMeasurement(classCount(dv.container, 'sauce-daily-task-row-content') === 360,
      'Daily dashboard must render all 120 today and 240 overdue task rows');
  }));

  const budgetMs = 250;
  const expectedLabels = ['ProjectsHubCards.render', 'ProjectDashboard.render', 'SpaceDailyDashboard.render'];
  requireMeasurement(results.length === expectedLabels.length && results.every((result, index) => result.label === expectedLabels[index]),
    'receipt must contain all three hubs in canonical order');
  const verdict = results.every((r) => r.median_ms <= budgetMs && r.p95_ms <= budgetMs * 2);
  const expectedRecommendation = verdict ? 'NO-GO: do not open EntityQuery epic yet' : 'GO: open EntityQuery epic';
  const receipt = { fixture_notes: fx.pages.length, samples_per_hub: 7, budget_median_ms: budgetMs, budget_p95_ms: budgetMs * 2, results, recommendation: expectedRecommendation, pass: verdict };
  requireMeasurement(receipt.recommendation === (receipt.pass
    ? 'NO-GO: do not open EntityQuery epic yet' : 'GO: open EntityQuery epic'),
  'recommendation must be derived from the threshold verdict');
  console.log(JSON.stringify(receipt, null, 2));

  global.app = prior.app; global.customJS = prior.customJS; global.window = prior.window;
  global.moment = prior.moment; global.document = prior.document;
  if (prior.localStorageDescriptor) Object.defineProperty(global, 'localStorage', prior.localStorageDescriptor);
  else delete global.localStorage;
  process.exit(verdict ? 0 : 1);
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
