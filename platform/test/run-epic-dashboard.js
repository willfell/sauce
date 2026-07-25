#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/epic-dashboard.js');
const VISUAL = path.join(ROOT, 'platform/test/visual/epic-dashboard.html');
const delivery = require(path.join(ROOT, 'platform/mechanisms/delivery'));
const coordinator = require(path.join(ROOT, 'scripts/autoloop/codex-coordinator.js'));
const { VAULTS } = require(path.join(ROOT, 'scripts/autoloop/deploy.js'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const installer = require(path.join(ROOT, 'platform/install.js'));

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function scalar(md, key) {
  const match = String(md).match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return match ? match[1].replace(/^"|"$/g, '') : '';
}
function loadClass() { return eval(`(${fs.readFileSync(HELPER, 'utf8')})`); } // eslint-disable-line no-eval
function loadNamedClass(rel, name) { return new Function(`${read(rel)}\nreturn ${name};`)(); }
function memoryAdapter(initial) {
  const store = new Map(Object.entries(initial));
  const dirs = new Set();
  const rememberParents = (entry) => {
    const parts = String(entry).split('/');
    for (let index = 1; index < parts.length; index += 1) dirs.add(parts.slice(0, index).join('/'));
  };
  for (const entry of store.keys()) rememberParents(entry);
  return {
    store, dirs, writes: [], mkdirs: [],
    async exists(entry) { return store.has(entry) || dirs.has(entry); },
    async list(entry) {
      return {
        folders: [...dirs].filter((candidate) => candidate.startsWith(`${entry}/`)
          && !candidate.slice(entry.length + 1).includes('/')),
        files: [...store.keys()].filter((candidate) => candidate.startsWith(`${entry}/`)
          && !candidate.slice(entry.length + 1).includes('/')),
      };
    },
    async read(entry) {
      if (!store.has(entry)) throw new Error(`ENOENT ${entry}`);
      return store.get(entry);
    },
    async write(entry, body) {
      const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
      if (parent && !dirs.has(parent)) throw new Error(`ENOENT parent ${parent}`);
      store.set(entry, body);
      this.writes.push({ entry, body });
    },
    async mkdir(entry) {
      const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : '';
      if (parent && !dirs.has(parent)) throw new Error(`ENOENT parent ${parent}`);
      dirs.add(entry);
      this.mkdirs.push(entry);
    },
  };
}
function file(filePath, mtime = 0) {
  const basename = path.posix.basename(filePath, '.md');
  return { path: filePath, basename, stat: { mtime } };
}
function element(tag = 'div', options = {}) {
  return {
    tag, className: options.cls || '', textContent: options.text || '', style: { cssText: '' },
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
function sliceRow(root, label) {
  return flatten(root).find((node) => (node.children || []).some((child) => child.tag === 'button' && child.textContent === label));
}
function pillOf(row) { return (row.children || []).find((child) => child.className.includes('status-pill')); }
function visualUrlFor(filePath) { return pathToFileURL(filePath).href; }
function deploymentHostFor(identity, env, io = fs) {
  return env.SAUCE_DEPLOYMENT_HOST === 'true'
    || (identity.username === 'willfellhoelter'
      && io.existsSync(path.join(identity.homedir, 'projects/repos/sauce/.git')));
}
function deploymentVaultsFor(identity, vaults) {
  return vaults.map((vault) => ({ name: vault.name, path: path.join(identity.homedir, 'notes/sauce', vault.name) }));
}
function verifyDeploymentHost({ identity, env, io, vaults, verify }) {
  const required = deploymentHostFor(identity, env, io);
  if (!required) return { required, ran: false, vaults: [], receipt: null };
  const hostVaults = deploymentVaultsFor(identity, vaults);
  return { required, ran: true, vaults: hostVaults, receipt: verify(hostVaults) };
}
function createGeometryResources(io = fs) {
  let specialVisualRoot = null;
  let profile = null;
  let specialProfile = null;
  const cleanup = ({ suppressErrors = false } = {}) => {
    let cleanupError = null;
    for (const resource of [specialProfile, profile, specialVisualRoot]) {
      if (!resource) continue;
      try { io.rmSync(resource, { recursive: true, force: true }); } catch (error) { cleanupError ||= error; }
    }
    if (cleanupError && !suppressErrors) throw cleanupError;
  };
  try {
    specialVisualRoot = io.mkdtempSync(path.join(os.tmpdir(), 'contributor#clone?query-'));
    const specialVisualPath = path.join(specialVisualRoot, 'epic dashboard.html');
    io.copyFileSync(VISUAL, specialVisualPath);
    profile = io.mkdtempSync(path.join(os.tmpdir(), 'epic-dashboard-geometry-'));
    specialProfile = io.mkdtempSync(path.join(os.tmpdir(), 'epic-dashboard-geometry-special-'));
    return { specialVisualRoot, specialVisualPath, profile, specialProfile, cleanup };
  } catch (error) {
    cleanup({ suppressErrors: true });
    throw error;
  }
}
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
  const command = (method, params = {}, sessionId = undefined) => {
    const id = nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      input.write(`${JSON.stringify(message)}\0`);
    });
  };
  return { command };
}
async function renderGeometry(chrome, profile, visualPath, viewportWidth) {
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
      width: viewportWidth, height: 1400, deviceScaleFactor: 1, mobile: false,
      screenWidth: viewportWidth, screenHeight: 1400,
    }, session);
    await send('Page.navigate', { url: visualUrlFor(visualPath) }, session);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await send('Runtime.evaluate', {
        expression: `JSON.stringify({readyState:document.readyState,geometry:document.body?.dataset.geometry||null,innerWidth:window.innerWidth,clientWidth:document.documentElement.clientWidth,result:document.querySelector('.geometry-result')?.textContent||''})`,
        returnByValue: true,
      }, session);
      const value = JSON.parse(evaluated.result?.value || '{}');
      if (value.readyState === 'complete' && value.geometry) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`headless geometry never completed: ${stderr}`);
  } finally {
    child.kill('SIGKILL');
    await deadline(closed, 5000, 'headless Chrome close').catch(() => {});
  }
}

async function main() {
  const EpicDashboard = loadClass();
  const epicPath = 'spice/projects/alpha/tasks/Alpha Epic/Alpha Epic.md';
  const epicFolder = 'spice/projects/alpha/tasks/Alpha Epic';
  const board = `${epicFolder}/board`;
  const context = `${epicFolder}/context`;
  const markdownFiles = [
    file(`${board}/S1 Planned.md`, 10), file(`${board}/S2 Active.md`, 20),
    file(`${board}/S3 Blocked.md`, 30), file(`${board}/S4 Done.md`, 40),
    file(`${board}/S5 Active.md`, 50),
    file(`${board}/S6 Blocked.md`, 60), file(`${board}/S7 Blocked.md`, 70),
    file(`${board}/S8 Done.md`, 80), file(`${board}/S9 Done.md`, 90), file(`${board}/S10 Done.md`, 100),
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
    [`${board}/S5 Active.md`, { type: 'slice', status: 'in_progress', depends_on: [] }],
    [`${board}/S6 Blocked.md`, { type: 'slice', status: 'blocked', depends_on: [] }],
    [`${board}/S7 Blocked.md`, { type: 'slice', status: 'blocked', depends_on: [] }],
    [`${board}/S8 Done.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${board}/S9 Done.md`, { type: 'slice', status: 'completed', depends_on: [] }],
    [`${board}/S10 Done.md`, { type: 'slice', status: 'completed', depends_on: [] }],
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
  let lifecycleOutput;
  const lifecycleApi = {
    deriveEpicLifecycle(slices) {
      lifecycleCalls += 1;
      lifecycleInput = slices;
      lifecycleOutput = delivery.deriveEpicLifecycle(slices);
      return lifecycleOutput;
    },
  };
  const dashboard = new EpicDashboard({ lifecycleApi });
  assert.deepStrictEqual(dashboard._epicPaths(epicPath, epicFolder), {
    epicDir: epicFolder, boardDir: board, contextDir: context,
  }, 'ES2C10-CORE-FOLDER-TRUTH: epic paths are folder-derived');
  const slices = dashboard._slicePages(epicPath, epicFolder);
  assert.deepStrictEqual(slices.map((slice) => slice.file.name), [
    'S1 Planned', 'S10 Done', 'S2 Active', 'S3 Blocked', 'S4 Done',
    'S5 Active', 'S6 Blocked', 'S7 Blocked', 'S8 Done', 'S9 Done',
  ],
    'ES2C10-CORE-FOLDER-TRUTH: only direct type:slice children of the canonical board are included');
  const groups = dashboard._contextGroups(epicPath, 3, epicFolder);
  assert.deepStrictEqual(groups.runs.map((entry) => entry.basename), ['Run 4', 'Run 3', 'Run 2'], 'runs are newest-first and capped at three');
  assert.strictEqual(groups.lessons.length, 4, 'lessons remain uncapped');

  const container = element();
  await dashboard.render({ container, current: () => { throw new Error('raw dv.current is forbidden'); } });
  assert.strictEqual(lifecycleCalls, 1, 'lifecycle is delegated exactly once');
  assert.deepStrictEqual(lifecycleInput.map((slice) => slice.file.name), slices.map((slice) => slice.file.name),
    'Delivery receives the complete canonical slice set');
  // BGR redesign 2026-07-25: lifecycle counts carry a waiting bucket (parked slices).
  assert.deepStrictEqual(lifecycleOutput.counts, { planned: 1, active: 2, waiting: 0, blocked: 3, done: 4, total: 10 },
    'epic-lifecycle-metric-association-mutation-gap: asymmetric statuses bind each lifecycle count to its source');
  assert.strictEqual(lifecycleOutput.frontier, 'S1 Planned',
    'epic-slice-render-association-mutation-gap: Delivery identifies the exact first non-blocked pending slice');
  const rendered = textOf(container);
  for (const expected of ['active', '4 deployed', '2 in flight', '3 blocked', '1 planned',
    'S1 Planned', 'S2 Active', 'S3 Blocked', 'S4 Done', 'S10 Done', 'Context pack', 'Run 4', 'Lesson 4',
    'Decision 1', 'Architecture', 'Runbook']) assert(rendered.includes(expected), `render includes ${expected}`);
  assert(rendered.includes('Architecture') && rendered.includes('Runbook'),
    'epic-docs-dataarray: Dataview DataArray docs materialize and render');
  const order = indices(rendered, ['Slices', 'Context pack', 'Runs', 'Lessons', 'Decisions', 'Docs']);
  assert(order.every((at, index) => at >= 0 && (!index || at > order[index - 1])), 'sections use canonical order');
  const rowExpectations = [
    ['S1 Planned', 'planning', 'status-pill open', 'frontier', null],
    ['S2 Active', 'in_progress', 'status-pill open', null, 'depends on S1 Planned'],
    ['S3 Blocked', 'blocked', 'status-pill overdue', null, 'depends on S2 Active'],
    ['S4 Done', 'completed', 'status-pill done', null, null],
  ];
  for (const [name, status, className, marker, dependency] of rowExpectations) {
    const row = sliceRow(container, name);
    assert(row, `epic-slice-render-association-mutation-gap: renders exact row ${name}`);
    assert.strictEqual(pillOf(row)?.textContent, status,
      `epic-slice-render-association-mutation-gap: ${name} keeps status label ${status}`);
    assert(pillOf(row)?.className.includes(className),
      `epic-slice-render-association-mutation-gap: ${name} keeps class ${className}`);
    assert.strictEqual(textOf(row).includes('frontier'), Boolean(marker),
      `epic-slice-render-association-mutation-gap: ${name} frontier association is exact`);
    assert.strictEqual(textOf(row).includes('depends on'), Boolean(dependency),
      `epic-slice-render-association-mutation-gap: ${name} dependency presence is exact`);
    if (dependency) assert(textOf(row).includes(dependency), `${name} binds exact dependency text`);
  }
  assert.strictEqual(flatten(container).filter((node) => node.textContent === 'frontier').length, 1,
    'epic-slice-render-association-mutation-gap: exactly one rendered row owns the frontier marker');
  assert.strictEqual(opened.length, 0, 'render performs no navigation');
  assert.deepStrictEqual(mutations, [],
    'ES2C10-CORE-READ-ONLY: render invokes no vault, adapter, frontmatter, or metadata mutator');

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

  currentPage = { file: { path: epicPath, folder: epicFolder }, docs: [] };
  global.app.vault.getMarkdownFiles = () => [];
  const noSlicesContainer = element();
  await dashboard.render({ container: noSlicesContainer });
  assert(textOf(noSlicesContainer).includes('No slices yet'),
    'ES2C10-CORE-EMPTY-STATE: an epic with no slice or context sections renders a visible empty state');
  assert.deepStrictEqual(mutations, [],
    'ES2C10-CORE-READ-ONLY: the true empty-state render remains mutation-free');

  currentPage = { file: { path: epicPath, folder: epicFolder }, docs: [] };
  const throwingDeliveryContainer = element();
  await new EpicDashboard({
    lifecycleApi: {
      deriveEpicLifecycle() { throw new Error('corrupt callable Delivery API'); },
    },
  }).render({ container: throwingDeliveryContainer });
  assert(textOf(throwingDeliveryContainer).includes('Delivery lifecycle unavailable'),
    'ES2C10-CORE-DELIVERY-RECOVERY: a callable Delivery API failure renders visible recovery');
  assert.deepStrictEqual(mutations, [],
    'ES2C10-CORE-READ-ONLY: Delivery exception recovery remains mutation-free');

  for (const nullishLifecycle of [null, undefined]) {
    const nullishDeliveryContainer = element();
    await new EpicDashboard({
      lifecycleApi: {
        deriveEpicLifecycle() { return nullishLifecycle; },
      },
    }).render({ container: nullishDeliveryContainer });
    assert(textOf(nullishDeliveryContainer).includes('Delivery lifecycle unavailable'),
      `ES2C10-DELIVERY-NULL-RESULT-BLANK-RECOVERY: ${nullishLifecycle} lifecycle renders visible recovery`);
  }
  assert.deepStrictEqual(mutations, [],
    'ES2C10-CORE-READ-ONLY: nullish Delivery recovery remains mutation-free');

  const coldContainer = element();
  let coldCurrentTouches = 0;
  const coldDv = new Proxy({ container: coldContainer }, {
    get(target, property) {
      if (property === 'current') {
        coldCurrentTouches += 1;
        return () => { coldCurrentTouches += 1; throw new Error('must not call any dv current alias'); };
      }
      return target[property];
    },
  });
  delete global.customJS.RenderSafe;
  await new EpicDashboard({ lifecycleApi }).render(coldDv);
  assert.strictEqual(coldContainer.children.length, 0, 'cold load is a render-safe no-op');
  assert.strictEqual(coldCurrentTouches, 0,
    'ES2C10-CORE-COLD-LOAD: RenderSafe cold load never reads or invokes any Dataview current alias');

  global.customJS = { RenderSafe: { page: () => ({ file: { path: epicPath, folder: epicFolder } }) }, SectionLabel: sectionLabel };

  const deliveryManifest = JSON.parse(read('platform/mechanisms/delivery/manifest.json'));
  const workshopConfig = JSON.parse(read('ranch/platform-config.json'));
  const defaultContentPath = workshopConfig.variables.content_path || 'ranch/content';
  const installedPath = (sourceName) => {
    const mapping = deliveryManifest.files.find((entry) => entry.source === sourceName);
    assert(mapping, `Delivery manifest maps ${sourceName}`);
    return mapping.dest.replace('{{content_path}}', defaultContentPath);
  };
  const expectedIndexPath = installedPath('index.js');
  const expectedContractPath = installedPath('scripts/delivery-contract.js');
  const expectedRegistryPath = installedPath('data/delivery-schema.json');
  assert.strictEqual(expectedIndexPath, 'ranch/content/delivery/index.js',
    'ES2C10-CORE-INSTALLED-DELIVERY: manifest plus workshop content_path derives the public index');
  assert.strictEqual(await new EpicDashboard()._contentPath({
    read: async () => JSON.stringify({ variables: { content_path: 'custom/content' } }),
  }), 'custom/content', 'configured consumer content_path overrides the default');
  assert.strictEqual(await new EpicDashboard()._contentPath({
    read: async () => JSON.stringify({ variables: { scripts_path: 'ranch/scripts' } }),
  }), 'ranch/content', 'consumer without content_path uses the installer default');
  assert.strictEqual(await new EpicDashboard()._contentPath({
    read: async () => JSON.stringify({ variables: { content_path: '../escape' } }),
  }), 'ranch/content', 'unsafe content_path fails closed to the installer default');
  for (const absolutePath of ['/absolute/content', 'C:\\absolute\\content']) {
    assert.strictEqual(await new EpicDashboard()._contentPath({
      read: async () => JSON.stringify({ variables: { content_path: absolutePath } }),
    }), 'ranch/content', `epic-delivery-unsafe-content-path-mutation-gap: rejects ${absolutePath}`);
  }

  const expectedArtifactSources = Object.freeze([
    'index.js', 'scripts/delivery-contract.js', 'data/delivery-schema.json',
  ]);
  const artifactSources = ['index.js', 'scripts/delivery-contract.js', 'data/delivery-schema.json'];
  assert.deepStrictEqual(artifactSources, expectedArtifactSources,
    'epic-delivery-installed-artifact-source-self-oracle-mutation-gap: verifier source set equals the independently declared exact artifact set');
  assert.strictEqual(new Set(expectedArtifactSources).size, expectedArtifactSources.length,
    'epic-delivery-installed-artifact-source-self-oracle-mutation-gap: independently declared artifact set is unique');
  assert.deepStrictEqual(expectedArtifactSources.map((sourceName) => deliveryManifest.files.find((entry) => entry.source === sourceName)?.source), expectedArtifactSources,
    'epic-delivery-installed-artifact-source-self-oracle-mutation-gap: independently declared artifact set remains manifest-backed');
  const verifyInstalledVaults = (vaults, io, mode) => {
    assert.deepStrictEqual(vaults.map((vault) => vault.name).sort(), ['accuris-sauce', 'ero-sauce', 'headspace-sauce'],
      'epic-delivery-installed-all-vaults-skip-mutation-gap: verifier receives the complete authoritative vault set');
    const receipt = { mode, vaults: [], artifacts: [] };
    for (const vault of vaults) {
      assert(io.existsSync(vault.path), `epic-delivery-installed-all-vaults-skip-mutation-gap: ${vault.name} root exists`);
      const configPath = path.join(vault.path, 'ranch/platform-config.json');
      assert(io.existsSync(configPath), `${vault.name} has platform-config.json`);
      const config = JSON.parse(io.readFileSync(configPath, 'utf8'));
      const contentPath = config.variables?.content_path || 'ranch/content';
      receipt.vaults.push(`${vault.name}|${contentPath}`);
      for (const sourceName of artifactSources) {
        const mapping = deliveryManifest.files.find((entry) => entry.source === sourceName);
        assert(mapping, `Delivery manifest maps matrix source ${sourceName}`);
        const installed = mapping.dest.replace('{{content_path}}', contentPath);
        const artifact = path.join(vault.path, installed);
        assert(io.existsSync(artifact), `epic-delivery-installed-path-mismatch: ${vault.name} has ${mapping.source}`);
        receipt.artifacts.push(`${vault.name}|${sourceName}|${installed}`);
      }
    }
    return receipt;
  };
  const fixtureContentPaths = {
    'headspace-sauce': null,
    'accuris-sauce': 'custom/accuris-content',
    'ero-sauce': 'nested/ero/content',
  };
  const fixtureVaults = VAULTS.map((vault) => ({
    name: vault.name,
    path: path.join('/portable-vault-fixture', vault.name),
  }));
  const fixtureFiles = new Set();
  const fixtureConfigs = new Map();
  for (const vault of fixtureVaults) {
    fixtureFiles.add(vault.path);
    const configPath = path.join(vault.path, 'ranch/platform-config.json');
    const configured = fixtureContentPaths[vault.name];
    fixtureFiles.add(configPath);
    fixtureConfigs.set(configPath, JSON.stringify({ variables: configured ? { content_path: configured } : {} }));
    const contentPath = configured || 'ranch/content';
    for (const sourceName of expectedArtifactSources) {
      const mapping = deliveryManifest.files.find((entry) => entry.source === sourceName);
      fixtureFiles.add(path.join(vault.path, mapping.dest.replace('{{content_path}}', contentPath)));
    }
  }
  const fixtureIo = (files) => ({
    existsSync: (entry) => files.has(entry),
    readFileSync: (entry) => {
      assert(fixtureConfigs.has(entry), `fixture config read is bound to ${entry}`);
      return fixtureConfigs.get(entry);
    },
  });
  const expectedVaultMatrix = fixtureVaults.map((vault) => `${vault.name}|${fixtureContentPaths[vault.name] || 'ranch/content'}`);
  const expectedArtifactMatrix = fixtureVaults.flatMap((vault) => {
    const contentPath = fixtureContentPaths[vault.name] || 'ranch/content';
    return expectedArtifactSources.map((sourceName) => {
      const mapping = deliveryManifest.files.find((entry) => entry.source === sourceName);
      return `${vault.name}|${sourceName}|${mapping.dest.replace('{{content_path}}', contentPath)}`;
    });
  });
  const normalMatrix = verifyInstalledVaults(fixtureVaults, fixtureIo(fixtureFiles), 'portable-normal');
  const ciMatrix = verifyInstalledVaults(fixtureVaults, fixtureIo(fixtureFiles), 'portable-ci');
  for (const receipt of [normalMatrix, ciMatrix]) {
    assert.deepStrictEqual(receipt.vaults, expectedVaultMatrix,
      `epic-delivery-installed-verifier-matrix-mutation-gap: ${receipt.mode} covers each distinct vault configuration`);
    assert.deepStrictEqual(receipt.artifacts, expectedArtifactMatrix,
      `epic-delivery-installed-verifier-matrix-mutation-gap: ${receipt.mode} covers the exact 3x3 artifact matrix`);
  }
  assert.deepStrictEqual([normalMatrix.mode, ciMatrix.mode], ['portable-normal', 'portable-ci'],
    'epic-delivery-installed-verifier-matrix-mutation-gap: normal and CI complete-verification calls are both mandatory');
  const hostCases = [
    {
      name: 'explicit opt-in', identity: { username: 'contributor', homedir: '/explicit-home' },
      env: { SAUCE_DEPLOYMENT_HOST: 'true', HOME: '/mutable-home' }, marker: false, expected: true, markerReads: 0,
    },
    {
      name: 'canonical identity with checkout marker', identity: { username: 'willfellhoelter', homedir: '/canonical-home' },
      env: {}, marker: true, expected: true, markerReads: 1,
    },
    {
      name: 'canonical identity missing checkout marker', identity: { username: 'willfellhoelter', homedir: '/canonical-home' },
      env: {}, marker: false, expected: false, markerReads: 1,
    },
    {
      name: 'wrong identity despite checkout marker', identity: { username: 'contributor', homedir: '/canonical-home' },
      env: {}, marker: true, expected: false, markerReads: 0,
    },
    {
      name: 'canonical identity ignores mutable HOME', identity: { username: 'willfellhoelter', homedir: '/stable-home' },
      env: { HOME: '/mutable-home' }, marker: true, expected: true, markerReads: 1,
    },
  ];
  for (const fixture of hostCases) {
    const marker = path.join(fixture.identity.homedir, 'projects/repos/sauce/.git');
    const reads = [];
    let verifierCalls = 0;
    const decision = verifyDeploymentHost({
      identity: fixture.identity,
      env: fixture.env,
      io: { existsSync: (entry) => { reads.push(entry); return fixture.marker && entry === marker; } },
      vaults: VAULTS,
      verify: (hostVaults) => {
        verifierCalls += 1;
        return { mode: 'deployment-host', artifacts: Array(9).fill('verified'), vaults: hostVaults.map((vault) => vault.path) };
      },
    });
    assert.deepStrictEqual({ required: decision.required, ran: decision.ran, verifierCalls }, {
      required: fixture.expected, ran: fixture.expected, verifierCalls: fixture.expected ? 1 : 0,
    }, `epic-dashboard-local-preflight-host-detection-mutation-gap: ${fixture.name} binds authority and verifier execution`);
    assert.deepStrictEqual(reads, Array(fixture.markerReads).fill(marker),
      `${fixture.name} performs the exact expected checkout-marker reads`);
    const expectedVaultPaths = fixture.expected
      ? VAULTS.map((vault) => path.join(fixture.identity.homedir, 'notes/sauce', vault.name)) : [];
    assert.deepStrictEqual(decision.vaults.map((vault) => vault.path), expectedVaultPaths,
      `${fixture.name} derives vaults only from stable identity homedir, never env.HOME`);
    assert.deepStrictEqual(decision.receipt?.vaults || [], expectedVaultPaths,
      `${fixture.name} receipt binds the exact verified vault paths`);
  }
  const deploymentIdentity = os.userInfo();
  const hostDecision = verifyDeploymentHost({
    identity: deploymentIdentity, env: process.env, io: fs, vaults: VAULTS,
    verify: (hostVaults) => verifyInstalledVaults(hostVaults, fs, 'deployment-host'),
  });
  assert.strictEqual(hostDecision.ran, hostDecision.required,
    'epic-dashboard-local-preflight-host-detection-mutation-gap: runtime host decision and verifier receipt cannot diverge');
  if (hostDecision.required) {
    assert.strictEqual(hostDecision.receipt?.artifacts.length, 9,
      'deployment host records all nine real installed artifacts');
    assert.deepStrictEqual(hostDecision.vaults.map((vault) => vault.path),
      VAULTS.map((vault) => path.join(deploymentIdentity.homedir, 'notes/sauce', vault.name)),
      'deployment host receipt binds the exact stable-homedir vault set');
  }
  for (const vault of fixtureVaults) {
    const missingRoot = new Set(fixtureFiles);
    missingRoot.delete(vault.path);
    assert.throws(() => verifyInstalledVaults(fixtureVaults, fixtureIo(missingRoot), `missing-root:${vault.name}`), /root exists/,
      `epic-delivery-installed-all-vaults-skip-mutation-gap: missing ${vault.name} root fails closed`);
    const missingConfig = new Set(fixtureFiles);
    missingConfig.delete(path.join(vault.path, 'ranch/platform-config.json'));
    assert.throws(() => verifyInstalledVaults(fixtureVaults, fixtureIo(missingConfig), `missing-config:${vault.name}`), /platform-config\.json/,
      `epic-delivery-installed-verifier-matrix-mutation-gap: missing ${vault.name} config fails closed`);
    const contentPath = fixtureContentPaths[vault.name] || 'ranch/content';
    for (const sourceName of expectedArtifactSources) {
      const mapping = deliveryManifest.files.find((entry) => entry.source === sourceName);
      const missingArtifact = new Set(fixtureFiles);
      missingArtifact.delete(path.join(vault.path, mapping.dest.replace('{{content_path}}', contentPath)));
      assert.throws(() => verifyInstalledVaults(fixtureVaults, fixtureIo(missingArtifact), `missing-artifact:${vault.name}:${sourceName}`),
        new RegExp(`has ${sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        `epic-delivery-installed-verifier-matrix-mutation-gap: missing ${vault.name} ${sourceName} fails closed`);
    }
  }

  const priorGlobalRequire = global.require;
  const desktopPaths = [];
  global.require = require;
  global.app = {
    vault: { adapter: {
      read: async (entry) => {
        assert.strictEqual(entry, 'ranch/platform-config.json', 'desktop reads the installed path configuration');
        return JSON.stringify(workshopConfig);
      },
      getFullPath: (entry) => {
        desktopPaths.push(entry);
        return path.join(ROOT, 'platform/mechanisms/delivery/index.js');
      },
    } },
  };
  delete global.SauceDelivery;
  delete global.customJS.DeliveryContract;
  const desktopApi = await new EpicDashboard()._deliveryApi();
  assert.deepStrictEqual(desktopPaths, [expectedIndexPath],
    'epic-delivery-desktop-resolution-mutation-gap: desktop resolves the installed public index through getFullPath');
  assert(desktopApi && typeof desktopApi.deriveEpicLifecycle === 'function', 'desktop loads Delivery through Node require');
  assert.deepStrictEqual(desktopApi.deriveEpicLifecycle(slices), delivery.deriveEpicLifecycle(slices),
    'desktop installed API has exact public-contract parity');
  if (priorGlobalRequire === undefined) delete global.require;
  else global.require = priorGlobalRequire;

  global.app = { vault: { getMarkdownFiles: () => markdownFiles }, metadataCache: { getFileCache: (entry) => ({ frontmatter: frontmatter.get(entry.path) || {} }) } };
  const unavailable = element();
  await new EpicDashboard().render({ container: unavailable });
  assert(textOf(unavailable).includes('Delivery lifecycle unavailable'),
    'ES2C10-CORE-DELIVERY-RECOVERY: missing Delivery fails closed with a visible recovery message');

  global.SauceDelivery = { deriveEpicLifecycle: 'partially initialized' };
  global.customJS.DeliveryContract = { deriveEpicLifecycle: true };
  const partial = element();
  await new EpicDashboard({ lifecycleApi: { deriveEpicLifecycle: {} } }).render({ container: partial });
  assert(textOf(partial).includes('Delivery lifecycle unavailable'),
    'ES2C10-CORE-DELIVERY-RECOVERY: partial non-callable APIs fail closed with the visible recovery message');
  delete global.SauceDelivery;
  delete global.customJS.DeliveryContract;

  const installedSources = {
    'ranch/platform-config.json': JSON.stringify(workshopConfig),
    [expectedIndexPath]: "const contract = require('./scripts/delivery-contract'); module.exports = { ...contract, __epicDashboardPublicIndex: true };",
    [expectedContractPath]: read('platform/mechanisms/delivery/scripts/delivery-contract.js'),
    [expectedRegistryPath]: read('platform/mechanisms/delivery/data/delivery-schema.json'),
  };
  global.app = { vault: { adapter: { read: async (entry) => installedSources[entry] } } };
  delete global.SauceDelivery;
  delete global.customJS.DeliveryContract;
  const mobileApi = await new EpicDashboard()._deliveryApi();
  assert(mobileApi && typeof mobileApi.deriveEpicLifecycle === 'function', 'mobile resolves the installed public Delivery artifact');
  assert.strictEqual(mobileApi.__epicDashboardPublicIndex, true,
    'epic-delivery-mobile-public-boundary-mutation-gap: mobile returns the evaluated public index export');
  assert.deepStrictEqual(mobileApi.deriveEpicLifecycle(slices), delivery.deriveEpicLifecycle(slices),
    'mobile adapter delegates to the same lifecycle contract');

  const manifest = JSON.parse(read('platform/blueprints/project/manifest.json'));
  assert.strictEqual(manifest.depends_on.filter((entry) => entry.name === 'delivery' && entry.range === '>=0.3.0').length, 1,
    'project declares delivery >=0.3.0 exactly once');
  assert.strictEqual(manifest.customjs_classes.filter((name) => name === 'EpicDashboard').length, 1,
    'EpicDashboard is registered exactly once');
  assert.strictEqual(manifest.files.filter((entry) => entry.source === 'helpers/epic-dashboard.js' && entry.dest === '{{scripts_path}}/project/epic-dashboard.js').length, 1,
    'the helper has one canonical install mapping');
  assert.strictEqual(manifest.customjs_classes.filter((name) => name === 'EpicCreateAction').length, 1,
    'ES2D-ENTITY-SCAFFOLD: EpicCreateAction is registered exactly once');
  assert.strictEqual(manifest.files.filter((entry) => entry.source === 'helpers/epic-create-action.js'
    && entry.dest === '{{scripts_path}}/project/epic-create-action.js').length, 1,
  'ES2D-ENTITY-SCAFFOLD: the New Epic helper has one canonical install mapping');
  for (const [sourceName, destination] of [
    ['templates/Epic.md', '{{templates_path}}/Template, Epic.md'],
    ['templates/Epic Board.md', '{{templates_path}}/Template, Epic Board.md'],
    ['templates/Slice Card.md', '{{templates_path}}/Template, Slice Card.md'],
  ]) {
    assert.strictEqual(manifest.files.filter((entry) => entry.source === sourceName && entry.dest === destination).length, 1,
      `ES2D-ENTITY-SCAFFOLD: ${sourceName} has one canonical install mapping`);
  }
  const epicEntity = manifest.new_entity_buttons.find((entry) => entry.id === 'epic');
  assert(epicEntity, 'ES2D-ENTITY-SCAFFOLD: EntityCreate registers New Epic');
  assert.strictEqual(epicEntity.destination.folder_prefix,
    '{{current_file.folder}}/tasks/{{prompts.name|sanitize-filename}}',
    'ES2D-ENTITY-SCAFFOLD: epic atlas materializes under the current project tasks directory');
  assert.strictEqual(epicEntity.frontmatter_template.type, 'epic',
    'ES2D-ENTITY-SCAFFOLD: generated atlas owns canonical epic identity');
  assert.strictEqual(epicEntity.frontmatter_template.epic_board,
    '{{current_file.folder}}/tasks/{{prompts.name|sanitize-filename}}/board/{{prompts.name|sanitize-filename}}-board.md',
    'ES2D-ENTITY-SCAFFOLD: atlas binds the exact sibling epic board');
  const epicBoardSidecar = epicEntity.extra_files.find((entry) =>
    entry.subfolder === 'board' && entry.filename_pattern === '{{prompts.name|sanitize-filename}}-board.md');
  assert(epicBoardSidecar && epicBoardSidecar.frontmatter_template.board_role === 'epic',
    'ES2D-ENTITY-SCAFFOLD: EntityCreate materializes the canonical board-role sidecar');
  assert.deepStrictEqual(epicEntity.extra_files.filter((entry) => entry.filename_pattern === '.keep').map((entry) => entry.subfolder).sort(), [
    'context/decisions', 'context/lessons', 'context/runs',
  ], 'ES2D-ENTITY-SCAFFOLD: EntityCreate materializes the complete context skeleton');

  const epicTemplate = read('platform/blueprints/project/templates/Epic.md');
  assert(epicTemplate.indexOf('ProjectChromeBar') < epicTemplate.indexOf('EpicDashboard'),
    'ES2D-ENTITY-SCAFFOLD: epic chrome precedes its dashboard');
  const epicBoardTemplate = read('platform/blueprints/project/templates/Epic Board.md');
  assert.match(epicBoardTemplate, /Template, Slice Card\.md/,
    'ES2D-ENTITY-SCAFFOLD: canonical board creates the generated slice-body template');
  const projectBoardTemplate = read('platform/blueprints/project/templates/Project Board.md');
  assert.match(projectBoardTemplate, /class: "EpicCreateAction"/,
    'ES2D-ENTITY-SCAFFOLD: every new project board exposes the New Epic action');
  assert.match(projectBoardTemplate, /^project_name: "\{\{prompts\.name\}\}"$/m,
    'ES2D-ENTITYCREATE-PROJECT-IDENTITY-ABSENT: project board preserves the human project name');
  assert.match(projectBoardTemplate, /^project_slug: "\{\{prompts\.slug\}\}"$/m,
    'ES2D-ENTITYCREATE-PROJECT-IDENTITY-ABSENT: project board supplies EntityCreate its canonical slug');
  assert.doesNotMatch(projectBoardTemplate, /^project_name:.*sanitize-filename/m,
    'ES2D-ENTITYCREATE-PROJECT-IDENTITY-ABSENT: project identity is not replaced by a filename projection');

  const EpicCreateAction = loadNamedClass('platform/blueprints/project/helpers/epic-create-action.js', 'EpicCreateAction');
  const actionContainer = element();
  let entityCall = null;
  const priorEntityCreate = global.customJS.EntityCreate;
  global.customJS.EntityCreate = {
    async render(proxy, options) {
      const button = proxy.container.createEl('button', { text: 'New Epic' });
      entityCall = { proxy, options, button };
    },
  };
  await new EpicCreateAction().render({ container: actionContainer });
  global.customJS.EntityCreate = priorEntityCreate;
  const actionRow = actionContainer.children.find((child) => child.className === 'sauce-action-row');
  assert(actionRow && entityCall && entityCall.options.instance === 'epic',
    'ES2D-ENTITY-SCAFFOLD: production helper dispatches the epic EntityCreate entry');
  assert.match(entityCall.button.style.cssText, /flex:\s*1 1 100%/,
    'ES2D-ENTITY-SCAFFOLD: New Epic remains full width at desktop and 390px');

  const sliceTemplate = read('platform/blueprints/project/templates/Slice Card.md');
  assert.match(sliceTemplate, /^epic: "\[\[<% epicName %>\]\]"$/m,
    'slice-epic-backlink-identity: generated slice identity is the canonical epic basename');
  assert.match(sliceTemplate, /^task_parent: <% epicAtlas %>$/m,
    'slice-epic-backlink-identity: generated task_parent resolves the same epic atlas');
  assert.doesNotMatch(sliceTemplate, /^---[\s\S]*?^---[\s\S]*?^type:/m,
    'ES2D-ENTITY-SCAFFOLD: generated slice body does not duplicate execution-contract frontmatter');
  const templateBlock = sliceTemplate.match(/^---\n<%\*([\s\S]*?)-%>/)?.[1];
  assert(templateBlock, 'ES2D-ENTITY-SCAFFOLD: slice template production block is executable');
  const executeSliceTemplate = new AsyncFunction('tp', 'app', 'Notice',
    `${templateBlock}\nreturn { sourceBoard, epicName, epicAtlas, destination: typeof destination === "undefined" ? null : destination };`);
  const canonicalBoard = 'spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md';
  const canonicalBoardFile = { path: canonicalBoard, stat: { mtime: 10 } };
  const targetSlice = { path: 'spice/projects/demo/tasks/Alpha Epic/board/Slice One.md', stat: { ctime: 11 } };
  const templateResult = await executeSliceTemplate({
    config: { target_file: targetSlice },
    file: { path: () => targetSlice.path, title: 'Slice One', async move() {} },
  }, {
    vault: {
      getAbstractFileByPath: (candidate) => candidate === canonicalBoard ? canonicalBoardFile : null,
      getMarkdownFiles: () => [canonicalBoardFile, targetSlice],
    },
    metadataCache: {
      getFileCache: (file) => file === canonicalBoardFile
        ? { frontmatter: { 'kanban-plugin': 'board', board_role: 'epic', epic: '[[Alpha Epic]]' } }
        : { frontmatter: {} },
    },
  }, class Notice {});
  assert.deepStrictEqual({
    sourceBoard: templateResult.sourceBoard,
    epicName: templateResult.epicName,
    epicAtlas: templateResult.epicAtlas,
  }, {
    sourceBoard: canonicalBoard,
    epicName: 'Alpha Epic',
    epicAtlas: 'spice/projects/demo/tasks/Alpha Epic/Alpha Epic.md',
  }, 'slice-epic-backlink-identity: production template binds the exact atlas and board identities');

  const rootPath = 'Root Slice.md';
  const rootTarget = { path: rootPath, stat: { ctime: 100000, mtime: 100000 } };
  const sourceCanonical = {
    path: 'spice/projects/demo/tasks/Root Epic/board/Root Epic-board.md',
    stat: { mtime: 99995 },
  };
  const olderCanonical = {
    path: 'spice/projects/demo/tasks/Older Epic/board/Older Epic-board.md',
    stat: { mtime: 100 },
  };
  const strayBoard = {
    path: 'spice/projects/demo/tasks/Root Epic/board/A-stray-board.md',
    stat: { mtime: 99999 },
  };
  const rootStore = new Map([[rootPath, 'user-authored root content']]);
  const movedRoot = [];
  const boardFrontmatter = (file) => {
    const epic = file.path.split('/').at(-3);
    return file === strayBoard
      ? { 'kanban-plugin': 'board', board_role: 'epic', epic: '[[Root Epic]]' }
      : { 'kanban-plugin': 'board', board_role: 'epic', epic: `[[${epic}]]` };
  };
  const rootFiles = [rootTarget, sourceCanonical, olderCanonical, strayBoard];
  const rootByPath = new Map(rootFiles.map((file) => [file.path, file]));
  const rootResult = await executeSliceTemplate({
    config: { target_file: rootTarget },
    file: {
      path: () => rootPath,
      title: 'Root Slice',
      async move(destinationWithoutExtension) {
        const destinationPath = `${destinationWithoutExtension}.md`;
        rootStore.set(destinationPath, rootStore.get(rootPath));
        rootStore.delete(rootPath);
        movedRoot.push(destinationWithoutExtension);
      },
    },
  }, {
    vault: {
      getAbstractFileByPath: (candidate) => rootByPath.get(candidate) || null,
      getMarkdownFiles: () => rootFiles,
      async read() { return '## In Planning'; },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: boardFrontmatter(file) }),
      getBacklinksForFile: () => ({ data: {} }),
    },
  }, class Notice {});
  const rootDestination = 'spice/projects/demo/tasks/Root Epic/board/Root Slice.md';
  assert.deepStrictEqual(rootResult, {
    sourceBoard: sourceCanonical.path,
    epicName: 'Root Epic',
    epicAtlas: 'spice/projects/demo/tasks/Root Epic/Root Epic.md',
    destination: rootDestination,
  }, 'slice-template-root-placement-breaks-kanban-flow: uniquely recent canonical board recovers exact identity');
  assert.deepStrictEqual(movedRoot, ['spice/projects/demo/tasks/Root Epic/board/Root Slice'],
    'slice-template-root-placement-breaks-kanban-flow: root-created slice moves into the flat epic board directory');
  assert.strictEqual(rootStore.get(rootDestination), 'user-authored root content',
    'slice-template-root-placement-breaks-kanban-flow: production move preserves existing user content');

  const ambiguousCanonical = {
    path: 'spice/projects/demo/tasks/Other Epic/board/Other Epic-board.md',
    stat: { mtime: 99996 },
  };
  const ambiguousFiles = [rootTarget, sourceCanonical, ambiguousCanonical];
  const ambiguousByPath = new Map(ambiguousFiles.map((file) => [file.path, file]));
  let ambiguousMoves = 0;
  const recoveryNotices = [];
  await assert.rejects(() => executeSliceTemplate({
    config: { target_file: rootTarget },
    file: { path: () => rootPath, title: 'Root Slice', async move() { ambiguousMoves += 1; } },
  }, {
    vault: {
      getAbstractFileByPath: (candidate) => ambiguousByPath.get(candidate) || null,
      getMarkdownFiles: () => ambiguousFiles,
      async read() { return '## In Planning'; },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: boardFrontmatter(file) }),
      getBacklinksForFile: () => ({ data: {} }),
    },
  }, class Notice {
    constructor(message) { recoveryNotices.push(message); }
  }), /Ambiguous canonical epic boards/,
  'slice-template-root-placement-breaks-kanban-flow: ambiguous recent boards fail closed visibly');
  assert.strictEqual(ambiguousMoves, 0,
    'slice-template-root-placement-breaks-kanban-flow: ambiguity performs no move or partial mutation');
  assert(recoveryNotices.some((message) => /Ambiguous canonical epic boards/.test(message)),
    'slice-template-root-placement-breaks-kanban-flow: ambiguity provides a visible recovery message');

  let missingMoves = 0;
  const missingNotices = [];
  await assert.rejects(() => executeSliceTemplate({
    config: { target_file: rootTarget },
    file: { path: () => rootPath, title: 'Root Slice', async move() { missingMoves += 1; } },
  }, {
    vault: {
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [rootTarget],
      async read() { return ''; },
    },
    metadataCache: {
      getFileCache: () => ({ frontmatter: {} }),
      getBacklinksForFile: () => ({ data: {} }),
    },
  }, class Notice {
    constructor(message) { missingNotices.push(message); }
  }), /Cannot recover one canonical source epic board/,
  'slice-template-root-placement-breaks-kanban-flow: missing source board fails closed');
  assert.strictEqual(missingMoves, 0,
    'slice-template-root-placement-breaks-kanban-flow: missing identity performs no move or partial mutation');
  assert(missingNotices.some((message) => /Cannot recover one canonical source epic board/.test(message)),
    'slice-template-root-placement-breaks-kanban-flow: missing identity provides a visible recovery message');

  let invalidExpectedMoves = 0;
  const invalidExpectedBoard = { path: canonicalBoard, stat: { mtime: 100000 } };
  await assert.rejects(() => executeSliceTemplate({
    config: { target_file: targetSlice },
    file: {
      path: () => targetSlice.path,
      title: 'Slice One',
      async move() { invalidExpectedMoves += 1; },
    },
  }, {
    vault: {
      getAbstractFileByPath: (candidate) => candidate === canonicalBoard ? invalidExpectedBoard : null,
      getMarkdownFiles: () => [invalidExpectedBoard, sourceCanonical],
      async read() { return '[[Slice One]]'; },
    },
    metadataCache: {
      getFileCache: (file) => ({ frontmatter: file === invalidExpectedBoard
        ? { 'kanban-plugin': 'board', board_role: 'project' }
        : boardFrontmatter(file) }),
    },
  }, class Notice {}), /Canonical epic board missing or invalid/,
  'slice-template-root-placement-breaks-kanban-flow: an invalid exact sibling fails closed without fallback');
  assert.strictEqual(invalidExpectedMoves, 0,
    'slice-template-root-placement-breaks-kanban-flow: invalid exact sibling performs no partial move');

  const kanbanTemplate = read('platform/blueprints/project/templates/Kanban Card.md');
  for (const binding of [
    'project: "[[${promotionProjectName}]]"',
    'project_slug: ${promotionProjectSlug}',
    'project_name: ${JSON.stringify(promotionProjectName)}',
    'context/runs', 'context/lessons', 'context/decisions',
  ]) assert(kanbanTemplate.includes(binding), `ES2D-PARENT-PROMOTION: production promotion binds ${binding}`);
  assert.match(kanbanTemplate, /const boardPath = `\$\{boardDir\}\/\$\{chosenName\}-board\.md`/,
    'ES2D-PARENT-PROMOTION: promotion materializes only the exact sibling epic board');
  assert.match(kanbanTemplate, /let chosenName = fileName;[\s\S]*?suffix <= 999/,
    'ES2D-PARENT-PROMOTION: promotion preserves the bounded collision contract');
  const templaterBlocks = [...kanbanTemplate.matchAll(/<%\*([\s\S]*?)-%>/g)].map((match) => match[1]);
  assert(templaterBlocks.length >= 2, 'ES2D-PARENT-PROMOTION: production promotion block is executable');
  const executePromotion = new AsyncFunction(
    'tp', 'app', 'Notice', 'activePath', 'promoteAsEpic', 'promotionProjectSlug',
    'promotionProjectName', 'fileName', 'chosenName', templaterBlocks[1],
  );
  const promotionFiles = new Map([
    ['ranch/templates/Template, Epic Board.md', epicBoardTemplate],
    ['spice/projects/demo/demo-board.md', 'parent board'],
  ]);
  const promotionFolders = new Set(['spice', 'spice/projects', 'spice/projects/demo']);
  const moved = [];
  const created = [];
  const promotionApp = {
    vault: {
      getAbstractFileByPath(candidate) {
        if (promotionFiles.has(candidate) || promotionFolders.has(candidate)) return { path: candidate };
        return null;
      },
      async createFolder(candidate) { promotionFolders.add(candidate); },
      async create(candidate, body) {
        promotionFiles.set(candidate, body);
        created.push(candidate);
        return { path: candidate };
      },
      adapter: {
        async read(candidate) {
          if (!promotionFiles.has(candidate)) throw new Error(`missing ${candidate}`);
          return promotionFiles.get(candidate);
        },
      },
    },
  };
  await executePromotion({
    file: {
      async move(candidate) { moved.push(candidate); },
    },
    date: { now: () => '2026-07-23T01:45:00-05:00' },
  }, promotionApp, class Notice {}, 'spice/projects/demo/demo-board.md', true,
  'demo', 'Demo Project', 'Alpha Epic', 'Alpha Epic');
  assert.deepStrictEqual(moved, ['spice/projects/demo/tasks/Alpha Epic/Alpha Epic'],
    'ES2D-PARENT-PROMOTION: real production block moves the atlas to its canonical path');
  assert.deepStrictEqual([...promotionFolders].filter((folder) => folder.includes('/context/')).sort(), [
    'spice/projects/demo/tasks/Alpha Epic/context/decisions',
    'spice/projects/demo/tasks/Alpha Epic/context/lessons',
    'spice/projects/demo/tasks/Alpha Epic/context/runs',
  ], 'ES2D-PARENT-PROMOTION: real production block creates the complete context skeleton');
  assert.deepStrictEqual(created, ['spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md'],
    'ES2D-PARENT-PROMOTION: real production block creates only the exact sibling board');
  const promotedBoard = promotionFiles.get(created[0]);
  for (const expected of [
    'board_role: epic', 'epic: "[[Alpha Epic]]"', 'project_slug: demo',
    'project_name: "Demo Project"', 'Template, Slice Card.md',
  ]) assert(promotedBoard.includes(expected), `ES2D-PARENT-PROMOTION: promoted board binds ${expected}`);

  const ProjectChromeBar = loadNamedClass('platform/blueprints/project/helpers/project-chrome-bar.js', 'ProjectChromeBar');
  const ProjectNavButtons = loadNamedClass('platform/blueprints/project/helpers/project-nav-buttons.js', 'ProjectNavButtons');
  const contextFixtures = [
    {
      path: 'spice/projects/demo/tasks/Alpha Epic/Alpha Epic.md',
      page: { type: 'epic', file: { name: 'Alpha Epic' } },
      expected: 'epic-hub',
    },
    {
      path: canonicalBoard,
      page: { type: 'kanban', board_role: 'epic', file: { name: 'Alpha Epic-board' } },
      expected: 'epic-board',
    },
    {
      path: targetSlice.path,
      page: { type: 'slice', file: { name: 'Slice One' } },
      expected: 'slice',
    },
  ];
  const priorRenderSafe = global.customJS.RenderSafe;
  for (const fixture of contextFixtures) {
    global.customJS.RenderSafe = { page: () => fixture.page };
    const chromeContext = new ProjectChromeBar().detectContext(fixture.path, {});
    const navContext = new ProjectNavButtons().detectContext(fixture.path, {});
    assert.strictEqual(chromeContext.context, fixture.expected,
      `ES2D-CONTEXT-PARITY: ProjectChromeBar classifies ${fixture.expected}`);
    assert.strictEqual(navContext.context, fixture.expected,
      `ES2D-CONTEXT-PARITY: ProjectNavButtons classifies ${fixture.expected}`);
    assert.deepStrictEqual(navContext, chromeContext,
      `ES2D-CONTEXT-PARITY: mirrored production classifiers agree for ${fixture.expected}`);
  }
  global.customJS.RenderSafe = priorRenderSafe;

  const projectAtlasBody = [
    '---', 'type: project', 'project_name: "Demo Project"', '---', '', '# Demo',
  ].join('\n');
  const projectBoardBefore = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  ].join('\n');
  const strayProjectBoard = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '', '# preserved stray project board',
  ].join('\n');
  const epicAtlasBefore = [
    '---', 'type: epic', 'schema_version: 1.1.0', '---', '',
    '```dataviewjs', 'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });', '```', '',
  ].join('\n');
  const epicBoardBefore = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '', '## In Planning', '',
  ].join('\n');
  const strayEpicBoard = [
    '---', 'kanban-plugin: board', 'type: kanban', '---', '', '# preserved stray epic board',
  ].join('\n');
  const sliceBefore = [
    '---', 'type: slice', 'source_board: wrong.md', 'kanban_board: wrong.md', '---', '', '# Slice',
  ].join('\n');
  const legacyBefore = [
    '---', 'type: task-hub', '---', '', '# Legacy',
  ].join('\n');
  const mismatchedEpicBefore = [
    '---', 'type: epic', 'schema_version: 1.1.0', '---', '', '# Wrong basename',
  ].join('\n');
  const invalidBoardEpicBefore = [
    '---', 'type: epic', 'schema_version: 1.1.0', '---', '', '# Invalid board epic',
  ].join('\n');
  const invalidCanonicalBoard = [
    '---', 'type: doc-note', '---', '', 'kanban-plugin: board', '',
  ].join('\n');
  const healAdapter = memoryAdapter({
    'spice/projects/demo/Demo Project.md': projectAtlasBody,
    'spice/projects/demo/demo-board.md': projectBoardBefore,
    'spice/projects/demo/stray-board.md': strayProjectBoard,
    'spice/projects/demo/tasks/Alpha Epic/Alpha Epic.md': epicAtlasBefore,
    'spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md': epicBoardBefore,
    'spice/projects/demo/tasks/Alpha Epic/board/A-stray-board.md': strayEpicBoard,
    'spice/projects/demo/tasks/Alpha Epic/board/Slice One.md': sliceBefore,
    'spice/projects/demo/tasks/Alpha Epic/board/Legacy.md': legacyBefore,
    'spice/projects/demo/tasks/Mismatch/Wrong.md': mismatchedEpicBefore,
    'spice/projects/demo/tasks/Invalid Board/Invalid Board.md': invalidBoardEpicBefore,
    'spice/projects/demo/tasks/Invalid Board/board/Invalid Board-board.md': invalidCanonicalBoard,
    'spice/projects/demo/tasks/Invalid Board/board/Slice Two.md': sliceBefore,
  });
  const healHistory = [];
  const healTp = { app: { vault: { adapter: healAdapter } } };
  const healManifest = { name: 'project' };
  const healGit = { commit: 'fixture', tag: null, dirty: false };
  await installer.applyEpicScaffoldHeal(healTp, healManifest, {}, healHistory, healGit);
  await installer.applyEpicBoardRoleBackfill(healTp, healManifest, {}, healHistory, healGit);
  await installer.applySliceSourceBoardHeal(healTp, healManifest, {}, healHistory, healGit);

  const healedProjectBoard = healAdapter.store.get('spice/projects/demo/demo-board.md');
  assert(healedProjectBoard.includes('project_slug: "demo"')
    && healedProjectBoard.includes('project_name: "Demo Project"')
    && healedProjectBoard.includes('class: "EpicCreateAction"'),
  'ES2E-CANONICAL-HEAL: exact project board gains identity and the full-width epic action');
  assert.strictEqual(healAdapter.store.get('spice/projects/demo/stray-board.md'), strayProjectBoard,
    'ES2E-CANONICAL-HEAL: stray sibling project board remains byte-identical');
  const healedAtlas = healAdapter.store.get('spice/projects/demo/tasks/Alpha Epic/Alpha Epic.md');
  assert(healedAtlas.includes('class: "EpicDashboard"'),
    'ES2E-CANONICAL-HEAL: exact type:epic atlas gains the dashboard after chrome');
  for (const folder of [
    'spice/projects/demo/tasks/Alpha Epic/context/runs',
    'spice/projects/demo/tasks/Alpha Epic/context/lessons',
    'spice/projects/demo/tasks/Alpha Epic/context/decisions',
  ]) assert(healAdapter.dirs.has(folder), `ES2E-CANONICAL-HEAL: creates ${folder}`);
  assert.match(healAdapter.store.get('spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md'),
    /^board_role: epic$/m, 'canonical-epic-board-heal: exact board gains board_role');
  assert.strictEqual(healAdapter.store.get('spice/projects/demo/tasks/Alpha Epic/board/A-stray-board.md'), strayEpicBoard,
    'canonical-epic-board-heal: stray sibling epic board remains byte-identical');
  const healedSlice = healAdapter.store.get('spice/projects/demo/tasks/Alpha Epic/board/Slice One.md');
  assert(healedSlice.includes('source_board: spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md')
    && healedSlice.includes('kanban_board: spice/projects/demo/tasks/Alpha Epic/board/Alpha Epic-board.md'),
  'canonical-epic-board-heal: type:slice paths bind only the exact canonical board');
  assert.strictEqual(healAdapter.store.get('spice/projects/demo/tasks/Alpha Epic/board/Legacy.md'), legacyBefore,
    'ES2E-CANONICAL-HEAL: legacy note types are never retyped or rewritten');
  assert.strictEqual(healAdapter.store.get('spice/projects/demo/tasks/Mismatch/Wrong.md'), mismatchedEpicBefore,
    'ES2E-CANONICAL-HEAL: mismatched atlas basename fails closed');
  assert.strictEqual(
    healAdapter.store.get('spice/projects/demo/tasks/Invalid Board/board/Invalid Board-board.md'),
    invalidCanonicalBoard,
    'canonical-epic-board-heal: canonical filename with non-board frontmatter remains byte-identical',
  );
  assert.strictEqual(healAdapter.store.get('spice/projects/demo/tasks/Invalid Board/board/Slice Two.md'), sliceBefore,
    'canonical-epic-board-heal: slice paths remain untouched when the canonical filename is not a board');
  const backupWrites = healAdapter.writes.filter(({ entry }) =>
    entry.startsWith('.obsidian/.sauce-heals/backups/'));
  assert(backupWrites.length >= 4 && backupWrites.every(({ entry }) => !entry.startsWith('.sauce-backup/')),
    'ES2E-CANONICAL-HEAL: every content edit is backed up under the approved root first');
  for (const { entry } of healAdapter.writes.filter(({ entry }) =>
    !entry.startsWith('.obsidian/.sauce-heals/backups/'))) {
    const liveIndex = healAdapter.writes.findIndex((write) => write.entry === entry);
    const backupIndex = healAdapter.writes.findIndex((write) =>
      write.entry.startsWith('.obsidian/.sauce-heals/backups/') && write.entry.endsWith(`/${entry}`));
    assert(backupIndex >= 0 && backupIndex < liveIndex,
      `ES2E-CANONICAL-HEAL: backup precedes the live write for ${entry}`);
  }
  const firstPassStore = [...healAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right));
  const writesAfterFirstPass = healAdapter.writes.length;
  await installer.applyEpicScaffoldHeal(healTp, healManifest, {}, healHistory, healGit);
  await installer.applyEpicBoardRoleBackfill(healTp, healManifest, {}, healHistory, healGit);
  await installer.applySliceSourceBoardHeal(healTp, healManifest, {}, healHistory, healGit);
  assert.deepStrictEqual(
    [...healAdapter.store.entries()].sort(([left], [right]) => left.localeCompare(right)),
    firstPassStore,
    'ES2E-CANONICAL-HEAL: second pass is byte-identical',
  );
  assert.strictEqual(healAdapter.writes.length, writesAfterFirstPass,
    'ES2E-CANONICAL-HEAL: second pass performs zero writes');
  assert(!healHistory.some((entry) => entry.event === 'warning'),
    'ES2E-CANONICAL-HEAL: conformant and legacy fixtures produce no warnings');

  const faultHistory = [];
  await assert.doesNotReject(() => installer.applyEpicScaffoldHeal({
    app: { vault: { adapter: { async exists() { throw new Error('adapter fault'); } } } },
  }, healManifest, {}, faultHistory, healGit), 'ES2E-CANONICAL-HEAL: adapter failures never escape install');
  assert(faultHistory.some((entry) => entry.event === 'warning' && entry.step === 'epic_scaffold_heal'),
    'ES2E-CANONICAL-HEAL: adapter failure leaves an auditable warning');
  for (const [heal, step] of [
    [installer.applyEpicBoardRoleBackfill, 'epic_board_role_backfill'],
    [installer.applySliceSourceBoardHeal, 'slice_source_board_heal'],
  ]) {
    const history = [];
    await assert.doesNotReject(() => heal({
      app: { vault: { adapter: {
        async exists() { return true; },
        async list() { throw new Error(`${step} adapter fault`); },
      } } },
    }, healManifest, {}, history, healGit), `ES2E-CANONICAL-HEAL: ${step} failures never escape install`);
    assert(history.some((entry) => entry.event === 'warning' && entry.step === step),
      `ES2E-CANONICAL-HEAL: ${step} failure leaves an auditable warning`);
  }

  const seedRoot = 'platform/test/seed-vault/spice/projects/epic-fixture';
  const seedSlices = ['Alpha 1', 'Alpha 2', 'Alpha 3'].map((name) => {
    const md = read(`${seedRoot}/tasks/Alpha Epic/board/${name}.md`);
    return { name, md, status: scalar(md, 'status') };
  });
  const expectedSeedStatus = new Map([
    ['Alpha 1', 'completed'], ['Alpha 2', 'in_progress'], ['Alpha 3', 'planning'],
  ]);
  for (const seed of seedSlices) {
    assert.strictEqual(seed.status, expectedSeedStatus.get(seed.name),
      `seed-canonical-status: ${seed.name} stores a canonical Delivery status`);
    const verdict = delivery.validateSlice({
      card: seed.name,
      parent_card: 'Epics & Slices bridge',
      slice: seed.name,
      model_profile: 'heavy',
      schema_version: '1.1.0',
      execution_mode: 'release',
      batch_policy: 'supervised_only',
      status: seed.status,
      touch_zones: ['platform/blueprints/project'],
      depends_on: [],
      deploy_subscriptions: { headspace: [], accuris: [], ero: [] },
      evidence: [{
        source_identity: 'portable-seed',
        captured_at: '2026-07-21T00:00:00Z',
        revision: 'fixture',
        locator: `${seed.name}.md:1`,
        claim: 'Portable epic seed fixture',
      }],
      release_required: true,
      deployment_required: true,
      risk_dimensions: [],
      type: 'slice',
      epic: scalar(seed.md, 'epic'),
      task_parent: scalar(seed.md, 'task_parent'),
      source_board: scalar(seed.md, 'source_board'),
      kanban_board: scalar(seed.md, 'kanban_board'),
    });
    assert(!verdict.errors.some((error) => error.code === 'slice-epic-backlink-mismatch'),
      `seed-canonical-status: ${seed.name} preserves canonical epic basename identity`);
  }
  const seedLifecycle = delivery.deriveEpicLifecycle([
    { card: 'Alpha 1', status: seedSlices[0].status, depends_on: [] },
    { card: 'Alpha 2', status: seedSlices[1].status, depends_on: ['Alpha 1'] },
    { card: 'Alpha 3', status: seedSlices[2].status, depends_on: ['Alpha 2'] },
  ]);
  assert.deepStrictEqual(
    { state: seedLifecycle.state, posture: seedLifecycle.posture, counts: seedLifecycle.counts },
    {
      state: 'active',
      posture: 'claimable',
      // BGR redesign 2026-07-25: lifecycle counts carry a waiting bucket (parked slices).
      counts: { planned: 1, active: 1, waiting: 0, blocked: 0, done: 1, total: 3 },
    },
    'seed-canonical-status: three-slice fixture derives one closed slice and an active claimable frontier',
  );

  const seededBoards = [
    {
      md: read(`${seedRoot}/epic-fixture-board.md`),
      lane: 'In Planning',
      cards: ['Alpha Epic', 'Beta Epic', 'Degenerate Flat Card'],
    },
    {
      md: read(`${seedRoot}/tasks/Alpha Epic/board/Alpha Epic-board.md`),
      laneByCard: { 'Alpha 1': 'Completed', 'Alpha 2': 'In Progress', 'Alpha 3': 'In Planning' },
      cards: ['Alpha 1', 'Alpha 2', 'Alpha 3'],
    },
  ];
  for (const boardFixture of seededBoards) {
    for (const card of boardFixture.cards) {
      const lane = boardFixture.lane || boardFixture.laneByCard[card];
      assert.doesNotThrow(
        () => coordinator.moveBoardCard(boardFixture.md, card, lane, lane === 'Completed'),
        `coordinator-checklist-board-cards: ${card} remains coordinator-addressable`,
      );
    }
  }
  const seedFiles = fs.readdirSync(path.join(ROOT, seedRoot, 'tasks', 'Alpha Epic', 'context'));
  assert(seedFiles.includes('pack.md')
    && /^[a-f0-9]{64}$/.test(scalar(read(`${seedRoot}/tasks/Alpha Epic/context/pack.md`), 'content_sha256')),
  'seed-canonical-status: portable context pack carries a deterministic hash');
  assert(
    read(`${seedRoot}/tasks/Alpha Epic/context/runs/Run 1.md`).includes('type: run-summary')
      && read(`${seedRoot}/tasks/Alpha Epic/context/lessons/Lesson 1.md`).includes('type: lesson'),
    'seed-canonical-status: portable run and lesson context are present',
  );
  assert(read(`${seedRoot}/tasks/Degenerate Flat Card.md`).includes('type: task-hub'),
    'coordinator-checklist-board-cards: degenerate flat card remains legacy work');

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
  assert(source.includes('ranch/platform-config.json') && source.includes('ranch/content'),
    'production derives configured content_path with the installer default');
  assert(!source.includes('ranch/delivery/'), 'production contains no obsolete pre-content-path Delivery location');
  assert(/epic-dashboard-link[\s\S]*?min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;/.test(source),
    'ES2C11-390-FIXTURE-PRODUCTION-DIVERGENCE: production links wrap long slice and context labels');
  assert(/border-bottom:[^"]*?flex-wrap:wrap;min-width:0;/.test(source),
    'ES2C11-390-FIXTURE-PRODUCTION-DIVERGENCE: production slice rows can shrink inside the viewport');
  assert(/border-radius:8px;padding:9px;min-width:0;overflow-wrap:anywhere;/.test(source),
    'ES2C11-390-FIXTURE-PRODUCTION-DIVERGENCE: production context tiles match the overflow-safe fixture');

  const visual = fs.readFileSync(VISUAL, 'utf8');
  assert((visual.match(/<main class="phone/g) || []).length === 2 && visual.includes('class="phone dark"'), 'visual proof includes light and dark phones');
  for (const guard of ['width:390px', 'name="viewport"', 'overflow:hidden', 'overflow-wrap:anywhere', 'completed', 'in_progress', 'planning']) {
    assert(visual.includes(guard), `visual proof locks ${guard}`);
  }
  assert(/body\{[^}]*padding:0(?:;|})/.test(visual), '390px viewport adds no body width outside the phone');
  assert(/\.phone\{[^}]*width:390px;max-width:100%/.test(visual), 'phone is exact at 390px and bounded below it');
  assert(/body\{[^}]*overflow-x:hidden/.test(visual), 'fixture forbids horizontal viewport scrolling');
  const phoneRule = (visual.match(/\.phone\{([^}]*)\}/) || [])[1] || '';
  const phoneWidth = Number((phoneRule.match(/(?:^|;)width:(\d+(?:\.\d+)?)px/) || [])[1]);
  const phonePadding = Number((phoneRule.match(/(?:^|;)padding:(\d+(?:\.\d+)?)px/) || [])[1]);
  assert.strictEqual(phoneWidth, 390, 'epic-390px-rendered-geometry-mutation-gap: phone border box is exactly 390px');
  assert(Number.isFinite(phonePadding) && phoneWidth - (2 * phonePadding) >= 320,
    'epic-390px-rendered-geometry-mutation-gap: phone retains at least 320px usable content width');
  assert(visual.includes('*{box-sizing:border-box}'), 'phone width and padding use a deterministic border-box geometry model');
  for (const geometryGuard of [
    'document.documentElement.scrollWidth', 'document.documentElement.clientWidth',
    'phone.scrollWidth', 'phone.clientWidth', 'getBoundingClientRect()',
    "phone.querySelectorAll('.stack,.row,.tiles,.tile')", "document.body.dataset.geometry = failures.length ? 'fail' : 'pass'",
    'const expectedViewportWidth = 390', 'effectiveViewport.innerWidth !== expectedViewportWidth',
    'effectiveViewport.clientWidth !== expectedViewportWidth', 'document.body.dataset.viewportWidth',
  ]) assert(visual.includes(geometryGuard), `rendered geometry proof locks ${geometryGuard}`);

  for (const failure of ['special-root', 'copy', 'normal-profile', 'special-profile']) {
    const created = [];
    const removed = [];
    let mkdtempCall = 0;
    const setupIo = {
      mkdtempSync: () => {
        mkdtempCall += 1;
        if ((failure === 'special-root' && mkdtempCall === 1)
          || (failure === 'normal-profile' && mkdtempCall === 2)
          || (failure === 'special-profile' && mkdtempCall === 3)) throw new Error(`${failure} fault`);
        const resource = `/tmp/${failure}-${mkdtempCall}`;
        created.push(resource);
        return resource;
      },
      copyFileSync: () => {
        if (failure === 'copy') throw new Error('copy fault');
      },
      rmSync: (resource) => { removed.push(resource); },
    };
    assert.throws(() => createGeometryResources(setupIo), /fault/,
      `epic-dashboard-special-path-setup-cleanup-gap: ${failure} setup fault propagates`);
    assert.deepStrictEqual([...removed].sort(), [...created].sort(),
      `epic-dashboard-special-path-setup-cleanup-gap: ${failure} setup fault leaves no temporary resource`);
  }
  const cleanupCreated = [];
  const cleanupAttempts = [];
  const cleanupResources = createGeometryResources({
    mkdtempSync: () => {
      const resource = `/tmp/cleanup-${cleanupCreated.length + 1}`;
      cleanupCreated.push(resource);
      return resource;
    },
    copyFileSync: () => {},
    rmSync: (resource) => {
      cleanupAttempts.push(resource);
      if (resource === '/tmp/cleanup-2') throw new Error('normal cleanup fault');
    },
  });
  assert.throws(() => cleanupResources.cleanup(), /normal cleanup fault/,
    'epic-dashboard-geometry-cleanup-error-swallow-gap: normal cleanup failure is visible');
  assert.deepStrictEqual(cleanupAttempts, ['/tmp/cleanup-3', '/tmp/cleanup-2', '/tmp/cleanup-1'],
    'epic-dashboard-geometry-cleanup-error-swallow-gap: normal cleanup attempts every resource after a failure');

  const chromeCandidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  assert(chrome, 'epic-390px-effective-viewport-mutation-gap: Chrome is required for device-metrics geometry proof');
  const geometryResources = createGeometryResources();
  const { specialVisualRoot, specialVisualPath, profile, specialProfile } = geometryResources;
  const specialVisualUrl = visualUrlFor(specialVisualPath);
  assert(specialVisualUrl.includes('%23') && specialVisualUrl.includes('%3F') && specialVisualUrl.includes('%20'),
    'epic-dashboard-geometry-file-url-portability-gap: special checkout characters are URL encoded');
  assert.strictEqual(fileURLToPath(specialVisualUrl), specialVisualPath,
    'epic-dashboard-geometry-file-url-portability-gap: encoded visual URL round-trips to the exact checkout path');
  let geometryFailure = null;
  try {
    const browser = await renderGeometry(chrome, profile, VISUAL, 390);
    assert.deepStrictEqual({ geometry: browser.geometry, innerWidth: browser.innerWidth, clientWidth: browser.clientWidth }, {
      geometry: 'pass', innerWidth: 390, clientWidth: 390,
    }, `ES2C10-CORE-390-NO-OVERFLOW: effective browser viewport and geometry are exact: ${JSON.stringify(browser)}`);
    assert.strictEqual(browser.result, '390px geometry pass', 'light and dark rendered geometry checker completed');
    const specialBrowser = await renderGeometry(chrome, specialProfile, specialVisualPath, 390);
    assert.deepStrictEqual({ geometry: specialBrowser.geometry, innerWidth: specialBrowser.innerWidth, clientWidth: specialBrowser.clientWidth }, {
      geometry: 'pass', innerWidth: 390, clientWidth: 390,
    }, `epic-dashboard-geometry-file-url-navigation-binding-mutation-gap: encoded special-path navigation renders the exact viewport: ${JSON.stringify(specialBrowser)}`);
  } catch (error) {
    geometryFailure = error;
    throw error;
  } finally {
    geometryResources.cleanup({ suppressErrors: Boolean(geometryFailure) });
  }

  console.log('epic-dashboard: all checks passed');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
