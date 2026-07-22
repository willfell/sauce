#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HELPER = path.join(ROOT, 'platform/blueprints/project/helpers/epic-dashboard.js');
const VISUAL = path.join(ROOT, 'platform/test/visual/epic-dashboard.html');
const delivery = require(path.join(ROOT, 'platform/mechanisms/delivery'));
const { VAULTS } = require(path.join(ROOT, 'scripts/autoloop/deploy.js'));

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
function sliceRow(root, label) {
  return flatten(root).find((node) => (node.children || []).some((child) => child.tag === 'button' && child.textContent === label));
}
function pillOf(row) { return (row.children || []).find((child) => child.className.includes('status-pill')); }
function renderGeometry(chrome, args) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let passed = false;
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`headless 390px geometry timed out: ${stderr}`));
    }, 45000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!passed && stdout.includes('data-geometry="pass"') && stdout.includes('390px geometry pass')) {
        passed = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('close', () => {
      clearTimeout(deadline);
      if (passed) resolve({ stdout, stderr });
      else reject(new Error(`headless 390px geometry did not pass: ${stderr}\n${stdout}`));
    });
  });
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
  }, 'epic paths are folder-derived');
  const slices = dashboard._slicePages(epicPath, epicFolder);
  assert.deepStrictEqual(slices.map((slice) => slice.file.name), [
    'S1 Planned', 'S10 Done', 'S2 Active', 'S3 Blocked', 'S4 Done',
    'S5 Active', 'S6 Blocked', 'S7 Blocked', 'S8 Done', 'S9 Done',
  ],
    'only direct type:slice children of the canonical board are included');
  const groups = dashboard._contextGroups(epicPath, 3, epicFolder);
  assert.deepStrictEqual(groups.runs.map((entry) => entry.basename), ['Run 4', 'Run 3', 'Run 2'], 'runs are newest-first and capped at three');
  assert.strictEqual(groups.lessons.length, 4, 'lessons remain uncapped');

  const container = element();
  await dashboard.render({ container, current: () => { throw new Error('raw dv.current is forbidden'); } });
  assert.strictEqual(lifecycleCalls, 1, 'lifecycle is delegated exactly once');
  assert.deepStrictEqual(lifecycleInput.map((slice) => slice.file.name), slices.map((slice) => slice.file.name),
    'Delivery receives the complete canonical slice set');
  assert.deepStrictEqual(lifecycleOutput.counts, { planned: 1, active: 2, blocked: 3, done: 4, total: 10 },
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
    'epic-cold-load-dv-current-alias-mutation-gap: cold load never reads or invokes any Dataview current alias');

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
    'epic-delivery-installed-path-mismatch: manifest plus workshop content_path derives the public index');
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

  const artifactSources = ['index.js', 'scripts/delivery-contract.js', 'data/delivery-schema.json'];
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
    for (const sourceName of artifactSources) {
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
    return artifactSources.map((sourceName) => {
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
  if (process.env.CI !== 'true') {
    const hostMatrix = verifyInstalledVaults(VAULTS, fs, 'deployment-host');
    assert.strictEqual(hostMatrix.artifacts.length, 9, 'deployment host verifies all nine real installed artifacts');
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
    for (const sourceName of artifactSources) {
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
  assert(textOf(unavailable).includes('Delivery lifecycle unavailable'), 'missing Delivery fails closed with a visible recovery message');

  global.SauceDelivery = { deriveEpicLifecycle: 'partially initialized' };
  global.customJS.DeliveryContract = { deriveEpicLifecycle: true };
  const partial = element();
  await new EpicDashboard({ lifecycleApi: { deriveEpicLifecycle: {} } }).render({ container: partial });
  assert(textOf(partial).includes('Delivery lifecycle unavailable'),
    'epic-delivery-partial-api-mutation-gap: truthy non-functions fail closed with the visible recovery message');
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
  ]) assert(visual.includes(geometryGuard), `rendered geometry proof locks ${geometryGuard}`);

  const chromeCandidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const chrome = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  if (chrome) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dashboard-geometry-'));
    try {
      const browser = await renderGeometry(chrome, [
        '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--no-first-run',
        '--disable-background-networking', '--window-size=390,1400', `--user-data-dir=${profile}`,
        '--dump-dom', `file://${VISUAL}`,
      ]);
      assert(browser.stdout.includes('data-geometry="pass"'),
        `epic-390px-rendered-geometry-mutation-gap: real 390px browser boxes pass: ${browser.stdout}`);
      assert(browser.stdout.includes('390px geometry pass'), 'light and dark rendered geometry checker completed');
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }

  console.log('epic-dashboard: all checks passed');
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
