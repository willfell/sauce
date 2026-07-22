#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/epic-dashboard.js');
const VISUAL = path.join(ROOT, 'platform/test/visual/epic-dashboard.html');
const delivery = require(path.join(ROOT, 'platform/mechanisms/delivery'));

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function loadClass() { return eval(`(${fs.readFileSync(HELPER, 'utf8')})`); } // eslint-disable-line no-eval
function file(filePath, mtime = 0) {
  const basename = path.posix.basename(filePath, '.md');
  return { path: filePath, basename, stat: { mtime } };
}
function element(tag = 'div', options = {}) {
  return {
    tag, className: '', textContent: options.text || '', style: { cssText: '' },
    children: [], listeners: {}, removed: false,
    createEl(childTag, childOptions = {}) {
      const child = element(childTag, childOptions);
      this.children.push(child);
      return child;
    },
    addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelector() { return null; },
    remove() { this.removed = true; },
  };
}
function flatten(root, out = []) {
  out.push(root);
  for (const child of root.children || []) flatten(child, out);
  return out;
}
function textOf(root) { return flatten(root).map((node) => node.textContent).filter(Boolean).join('\n'); }
function indices(haystack, labels) { return labels.map((label) => haystack.indexOf(label)); }

async function main() {
  const EpicDashboard = loadClass();
  const epicPath = 'spice/projects/alpha/tasks/Alpha Epic/Alpha Epic.md';
  const epicFolder = 'spice/projects/alpha/tasks/Alpha Epic';
  const board = `${epicFolder}/board`;
  const context = `${epicFolder}/context`;
  const markdownFiles = [
    file(`${board}/S1 Planned.md`, 10), file(`${board}/S2 Active.md`, 20),
    file(`${board}/S3 Blocked.md`, 30), file(`${board}/S4 Done.md`, 40),
    file(`${board}/nested/Not Direct.md`, 50), file(`${board}/Not a Slice.md`, 60),
    file(`${context}/pack.md`, 1),
    file(`${context}/runs/Run 1.md`, 1), file(`${context}/runs/Run 2.md`, 2),
    file(`${context}/runs/Run 3.md`, 3), file(`${context}/runs/Run 4.md`, 4),
    file(`${context}/lessons/Lesson 1.md`, 1), file(`${context}/lessons/Lesson 2.md`, 2),
    file(`${context}/lessons/Lesson 3.md`, 3), file(`${context}/lessons/Lesson 4.md`, 4),
    file(`${context}/decisions/Decision 1.md`, 1),
  ];
  const frontmatter = new Map([
    [`${board}/S1 Planned.md`, { type: 'slice', status: 'planning', depends_on: [] }],
    [`${board}/S2 Active.md`, { type: 'slice', status: 'in_progress', depends_on: ['S1 Planned'] }],
    [`${board}/S3 Blocked.md`, { type: 'slice', status: 'blocked', depends_on: ['S2 Active'] }],
    [`${board}/S4 Done.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${board}/nested/Not Direct.md`, { type: 'slice', status: 'planning' }],
    [`${board}/Not a Slice.md`, { type: 'task', status: 'planning' }],
  ]);
  const opened = [];
  const mutations = [];
  const mutator = (name) => () => {
    mutations.push(name);
    throw new Error(`read-only fixture invoked ${name}`);
  };
  global.app = {
    vault: {
      getMarkdownFiles: () => markdownFiles,
      create: mutator('vault.create'), createBinary: mutator('vault.createBinary'),
      modify: mutator('vault.modify'), modifyBinary: mutator('vault.modifyBinary'),
      delete: mutator('vault.delete'), rename: mutator('vault.rename'), trash: mutator('vault.trash'),
      adapter: {
        write: mutator('adapter.write'), remove: mutator('adapter.remove'),
        mkdir: mutator('adapter.mkdir'), rmdir: mutator('adapter.rmdir'),
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
  };
  let currentPage = {
    file: { path: epicPath, folder: epicFolder },
    docs: { array: () => ['[[Architecture]]', '[[Runbook|Runbook]]'] },
  };
  const sectionLabel = { render: (dv, options) => dv.container.createEl('div', { text: options.text }) };
  global.customJS = {
    RenderSafe: { page: () => currentPage },
    SectionLabel: sectionLabel,
  };

  let lifecycleCalls = 0;
  let lifecycleInput;
  const lifecycleApi = {
    deriveEpicLifecycle(slices) {
      lifecycleCalls += 1;
      lifecycleInput = slices;
      return delivery.deriveEpicLifecycle(slices);
    },
  };
  const dashboard = new EpicDashboard({ lifecycleApi });
  assert.deepStrictEqual(dashboard._epicPaths(epicPath, epicFolder), {
    epicDir: epicFolder, boardDir: board, contextDir: context,
  }, 'epic paths are folder-derived');
  const slices = dashboard._slicePages(epicPath, epicFolder);
  assert.deepStrictEqual(slices.map((slice) => slice.file.name), ['S1 Planned', 'S2 Active', 'S3 Blocked', 'S4 Done'],
    'only direct type:slice children of the canonical board are included');
  const groups = dashboard._contextGroups(epicPath, 3, epicFolder);
  assert.deepStrictEqual(groups.runs.map((entry) => entry.basename), ['Run 4', 'Run 3', 'Run 2'], 'runs are newest-first and capped at three');
  assert.strictEqual(groups.lessons.length, 4, 'lessons remain uncapped');

  const container = element();
  await dashboard.render({ container, current: () => { throw new Error('raw dv.current is forbidden'); } });
  assert.strictEqual(lifecycleCalls, 1, 'lifecycle is delegated exactly once');
  assert.deepStrictEqual(lifecycleInput.map((slice) => slice.file.name), slices.map((slice) => slice.file.name),
    'Delivery receives the complete canonical slice set');
  const rendered = textOf(container);
  for (const expected of ['active', '1 deployed', '1 in flight', '1 blocked', '1 planned',
    'S1 Planned', 'S2 Active', 'S3 Blocked', 'S4 Done', 'Context pack', 'Run 4', 'Lesson 4',
    'Decision 1', 'Architecture', 'Runbook']) assert(rendered.includes(expected), `render includes ${expected}`);
  assert(rendered.includes('Architecture') && rendered.includes('Runbook'),
    'epic-docs-dataarray: Dataview DataArray docs materialize and render');
  const order = indices(rendered, ['Slices', 'Context pack', 'Runs', 'Lessons', 'Decisions', 'Docs']);
  assert(order.every((at, index) => at >= 0 && (!index || at > order[index - 1])), 'sections use canonical order');
  const classes = flatten(container).map((node) => node.className).join(' ');
  assert(classes.includes('status-pill open') && classes.includes('status-pill overdue') && classes.includes('status-pill done'),
    'slice statuses map to canonical pill classes');
  assert.strictEqual(opened.length, 0, 'render performs no navigation');
  assert.deepStrictEqual(mutations, [], 'epic-read-only-mutation-gap: render invokes no vault, adapter, frontmatter, or metadata mutator');

  currentPage = { file: { path: epicPath, folder: epicFolder }, docs: ['[[Native Architecture]]', '[[Native Runbook]]'] };
  const nativeDocsContainer = element();
  await dashboard.render({ container: nativeDocsContainer });
  assert(textOf(nativeDocsContainer).includes('Native Architecture') && textOf(nativeDocsContainer).includes('Native Runbook'),
    'epic-docs-native-array-mutation-gap: native arrays render independently of Dataview DataArrays');

  currentPage = { file: { path: epicPath, folder: epicFolder }, docs: [] };
  global.app.vault.getMarkdownFiles = () => markdownFiles.filter((entry) => entry.path.startsWith(`${board}/`));
  const emptyContainer = element();
  await dashboard.render({ container: emptyContainer });
  const emptyRendered = textOf(emptyContainer);
  assert(emptyRendered.includes('Slices'), 'empty optional groups do not suppress the required slice section');
  for (const absent of ['Context pack', 'Runs', 'Lessons', 'Decisions', 'Docs', 'No context', 'No docs']) {
    assert(!emptyRendered.includes(absent), `epic-empty-sections-mutation-gap: omits ${absent}`);
  }
  assert.deepStrictEqual(mutations, [], 'native-array and empty-section renders remain read-only');

  const coldContainer = element();
  delete global.customJS.RenderSafe;
  await new EpicDashboard({ lifecycleApi }).render({ container: coldContainer, current: () => { throw new Error('must not call dv.current'); } });
  assert.strictEqual(coldContainer.children.length, 0, 'cold load is a render-safe no-op');

  global.customJS = { RenderSafe: { page: () => ({ file: { path: epicPath, folder: epicFolder } }) }, SectionLabel: sectionLabel };

  const priorGlobalRequire = global.require;
  const desktopPaths = [];
  global.require = require;
  global.app = {
    vault: { adapter: { getFullPath: (entry) => {
      desktopPaths.push(entry);
      return path.join(ROOT, 'platform/mechanisms/delivery/index.js');
    } } },
  };
  delete global.SauceDelivery;
  delete global.customJS.DeliveryContract;
  const desktopApi = await new EpicDashboard()._deliveryApi();
  assert.deepStrictEqual(desktopPaths, ['ranch/delivery/index.js'],
    'epic-delivery-desktop-resolution-mutation-gap: desktop resolves the installed public index through getFullPath');
  assert(desktopApi && typeof desktopApi.deriveEpicLifecycle === 'function', 'desktop loads Delivery through Node require');
  assert.deepStrictEqual(desktopApi.deriveEpicLifecycle(slices), delivery.deriveEpicLifecycle(slices),
    'desktop installed API has exact public-contract parity');
  if (priorGlobalRequire === undefined) delete global.require;
  else global.require = priorGlobalRequire;

  global.app = { vault: { getMarkdownFiles: () => markdownFiles }, metadataCache: { getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) || {} }) } };
  const unavailable = element();
  await new EpicDashboard().render({ container: unavailable });
  assert(textOf(unavailable).includes('Delivery lifecycle unavailable'), 'missing Delivery fails closed with a visible recovery message');

  const installedSources = {
    'ranch/delivery/index.js': read('platform/mechanisms/delivery/index.js'),
    'ranch/delivery/scripts/delivery-contract.js': read('platform/mechanisms/delivery/scripts/delivery-contract.js'),
    'ranch/delivery/data/delivery-schema.json': read('platform/mechanisms/delivery/data/delivery-schema.json'),
  };
  global.app = { vault: { adapter: { read: async (entry) => installedSources[entry] } } };
  delete global.SauceDelivery;
  delete global.customJS.DeliveryContract;
  const mobileApi = await new EpicDashboard()._deliveryApi();
  assert(mobileApi && typeof mobileApi.deriveEpicLifecycle === 'function', 'mobile resolves the installed public Delivery artifact');
  assert.deepStrictEqual(mobileApi.deriveEpicLifecycle(slices), delivery.deriveEpicLifecycle(slices),
    'mobile adapter delegates to the same lifecycle contract');

  const manifest = JSON.parse(read('platform/blueprints/project/manifest.json'));
  assert.strictEqual(manifest.depends_on.filter((entry) => entry.name === 'delivery' && entry.range === '>=0.3.0').length, 1,
    'project declares delivery >=0.3.0 exactly once');
  assert.strictEqual(manifest.customjs_classes.filter((name) => name === 'EpicDashboard').length, 1,
    'EpicDashboard is registered exactly once');
  assert.strictEqual(manifest.files.filter((entry) => entry.source === 'helpers/epic-dashboard.js' && entry.dest === '{{scripts_path}}/project/epic-dashboard.js').length, 1,
    'the helper has one canonical install mapping');
  const subscription = JSON.parse(read('ranch/platform-subscription.json'));
  assert.strictEqual(subscription.mechanisms.filter((entry) => entry.name === 'delivery' && entry.version === '0.3.0').length, 1,
    'project-delivery-dependency-closure: workshop dogfood subscription pins delivery@0.3.0 exactly once');

  const packageJson = JSON.parse(read('package.json'));
  assert.strictEqual(packageJson.scripts['test:epic-dashboard'], 'node platform/test/run-epic-dashboard.js', 'focused script is wired');
  assert.strictEqual((packageJson.scripts['release:preflight'].match(/node platform\/test\/run-epic-dashboard\.js/g) || []).length, 1,
    'release preflight runs the harness exactly once');
  const source = fs.readFileSync(HELPER, 'utf8');
  assert(source.includes('api.deriveEpicLifecycle(slices)'), 'production rendering calls the Delivery public API');
  assert(!/function\s+deriveEpicLifecycle\b/.test(source), 'dashboard contains no copied lifecycle state machine');
  assert(!source.includes('dv.current('), 'dashboard uses RenderSafe instead of raw dv.current');
  for (const installedPath of Object.keys(installedSources)) assert(source.includes(installedPath), `mobile resolver includes ${installedPath}`);

  const visual = fs.readFileSync(VISUAL, 'utf8');
  assert((visual.match(/<main class="phone/g) || []).length === 2 && visual.includes('class="phone dark"'), 'visual proof includes light and dark phones');
  for (const guard of ['width:390px', 'name="viewport"', 'overflow:hidden', 'overflow-wrap:anywhere', 'completed', 'in_progress', 'planning']) {
    assert(visual.includes(guard), `visual proof locks ${guard}`);
  }
  assert(/body\{[^}]*padding:0(?:;|})/.test(visual), '390px viewport adds no body width outside the phone');
  assert(/\.phone\{[^}]*width:390px;max-width:100%/.test(visual), 'phone is exact at 390px and bounded below it');
  assert(/body\{[^}]*overflow-x:hidden/.test(visual), 'fixture forbids horizontal viewport scrolling');

  console.log('epic-dashboard: all checks passed');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
