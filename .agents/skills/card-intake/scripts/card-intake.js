#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const delivery = require('../../../../platform/mechanisms/delivery');

const CLASSIFICATIONS = new Set(['bug', 'direct_execution', 'parent_children', 'roadmap_theme', 'ga_exception', 'post_ga']);
const EPIC_SCHEMA_VERSION = '1.1.0';
const VAULTS = delivery.registry.policies.required_vaults;
// Slice-scope ceilings: a single execution slice that exceeds these is a
// program hidden in one card. Enforced at mint (the only planning writer) so an
// oversized slice — or a supersession chain that has accreted findings past the
// carried_findings cap — is refused with a decompose instruction instead of
// thrashing the loop through dozens of 1:1 supersessions. Thresholds live in
// the schema registry, never as literals here.
const SLICE_SCOPE_CAPS = (delivery.registry.policies && delivery.registry.policies.slice_scope_caps) || {};
const RISK_MAP = {
  new_mechanism: 'new_mechanism', shared_abstraction: 'shared_contract', schema: 'schema',
  migration: 'migration', heal: 'migration', loader: 'control_plane',
  multi_blueprint: 'multi_blueprint_ui', high_regression_refactor: 'control_plane',
};

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function linkName(value) {
  const match = String(value || '').match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  return match ? match[1].trim() : null;
}

function escapeRe(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function quoted(value) { return JSON.stringify(String(value)); }
function within(root, target) {
  const base = path.resolve(root);
  const file = path.resolve(target);
  return file === base || file.startsWith(`${base}${path.sep}`);
}

function lstatMaybe(target) {
  try { return fs.lstatSync(target); } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

// Binds lexical intake routes to their physical filesystem roots. Existing
// components must be ordinary directories/files, never symlinks; missing
// suffixes are resolved from the nearest real ancestor. This validation runs
// for the complete plan before the first write.
function physicalIntakeTarget(root, target, label, expected = 'file') {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  const prefix = 'GA-OPS13A-EPIC-INTAKE-PHYSICAL-CONTAINMENT';
  if (!within(rootPath, targetPath) || targetPath === rootPath) {
    throw new Error(`${prefix} ${label} escapes its lexical root`);
  }
  const rootEntry = lstatMaybe(rootPath);
  if (!rootEntry || rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error(`${prefix} ${label} root must be one existing regular non-symlink directory`);
  }
  const physicalRoot = fs.realpathSync(rootPath);
  const parts = path.relative(rootPath, targetPath).split(path.sep).filter(Boolean);
  let cursor = rootPath;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    const entry = lstatMaybe(cursor);
    if (!entry) {
      const unresolved = parts.slice(index + 1);
      const resolved = path.join(fs.realpathSync(path.dirname(cursor)), path.basename(cursor), ...unresolved);
      if (!resolved.startsWith(`${physicalRoot}${path.sep}`)) {
        throw new Error(`${prefix} ${label} escapes its physical root`);
      }
      return resolved;
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`${prefix} ${label} contains a symlink component at ${cursor}`);
    }
    const final = index === parts.length - 1;
    if (!final && !entry.isDirectory()) {
      throw new Error(`${prefix} ${label} has a non-directory path component at ${cursor}`);
    }
    if (final && expected === 'directory' && !entry.isDirectory()) {
      throw new Error(`${prefix} ${label} must be one regular non-symlink directory`);
    }
    if (final && expected === 'file' && !entry.isFile()) {
      throw new Error(`${prefix} ${label} must be one regular non-symlink file`);
    }
    const resolved = fs.realpathSync(cursor);
    if (!resolved.startsWith(`${physicalRoot}${path.sep}`)) {
      throw new Error(`${prefix} ${label} escapes its physical root`);
    }
  }
  return fs.realpathSync(targetPath);
}

function safeTitle(value) {
  return Boolean(value) && value === value.trim() && !/[\\/\0\n\r]/.test(value) && value !== '.' && value !== '..';
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
}

function scalarField(markdown, key) {
  const match = String(markdown || '').match(new RegExp(`^${escapeRe(key)}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return '';
  const value = match[1].trim();
  try { return JSON.parse(value); } catch (_) { return value.replace(/^['"]|['"]$/g, ''); }
}

function resolveInstalledCoordinator(execFileSync = childProcess.execFileSync) {
  const prefix = String(execFileSync('brew', ['--prefix', 'sauce'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }) || '').trim();
  if (!prefix || !path.isAbsolute(prefix)) {
    throw new Error('brew --prefix sauce returned no absolute installed formula path');
  }
  return path.join(prefix, 'libexec', 'scripts', 'autoloop', 'codex-coordinator.js');
}

function readInstalledCoordinatorStatus(execFileSync = childProcess.execFileSync) {
  const coordinator = resolveInstalledCoordinator(execFileSync);
  const stdout = execFileSync(process.execPath, [coordinator, 'status', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const status = JSON.parse(stdout);
  if (!status || status.action !== 'status') throw new Error('installed coordinator returned a non-status receipt');
  return status;
}

function epicNameForCard(spec, card) {
  return card.parent_title || linkName(spec.epic);
}

// Non-throwing wrapper over the shared canonical authority
// (delivery.topology.physicalProjectPrefix). Returns '' for a non-vault /
// fixture root instead of throwing, so fixtures keep legacy caller-derived
// behavior; the canonical logic itself is no longer duplicated here.
function safePhysicalProjectPrefix(cardsRoot) {
  if (!cardsRoot) return '';
  try { return delivery.topology.physicalProjectPrefix(cardsRoot).prefix; }
  catch (_) { return ''; }
}

// The project prefix every emitted board reference is rooted at. Deriving it from
// the physical cards root first is what keeps a mint projectable: the intake skill
// passes `board_path = config.board_path_abs` (absolute) and no `source_board`, and
// an absolute or absent input used to collapse this to '' — minting atlases with
// absolute source boards and project-relative epic/slice backlinks that the
// coordinator's vault-relative binding check then refused forever.
function projectPrefix(spec) {
  return safePhysicalProjectPrefix(spec.cards_root)
    || (() => {
      const source = normalizePath(spec.source_board || '');
      return source && !path.isAbsolute(source) ? path.posix.dirname(source) : '';
    })();
}

// The canonical vault-relative reference to the PARENT board. The coordinator
// expects `<prefix>/<parent board basename>` and additionally requires the parent
// board to sit directly in the project root, so the basename is the only part of
// the caller's absolute path that survives.
function parentBoardRef(spec) {
  const prefix = safePhysicalProjectPrefix(spec.cards_root);
  const board = normalizePath(spec.board_path || '');
  if (prefix && board) return delivery.topology.parentBoardRef(prefix, path.posix.basename(board));
  return spec.source_board || spec.board_path;
}

function epicRoute(spec, epic) {
  const prefix = projectPrefix(spec);
  const canonical = prefix && prefix !== '.' ? delivery.topology.epicBindingPaths(prefix, epic) : null;
  const relative = (...parts) => normalizePath(path.posix.join(prefix === '.' ? '' : prefix, 'tasks', epic, ...parts));
  return {
    epic,
    root: path.join(spec.cards_root, epic),
    atlas_path: path.join(spec.cards_root, epic, `${epic}.md`),
    board_path: path.join(spec.cards_root, epic, 'board', `${epic}-board.md`),
    atlas_ref: canonical ? canonical.atlasRef : relative(`${epic}.md`),
    board_ref: canonical ? canonical.boardRef : relative('board', `${epic}-board.md`),
  };
}

function canonicalEpicSurface(spec, epic) {
  if (!safeTitle(epic)) return { ok: false, reason: 'epic name must be a safe title' };
  const route = epicRoute(spec, epic);
  try {
    physicalIntakeTarget(spec.cards_root, route.root, `${epic} epic root`, 'directory');
    physicalIntakeTarget(spec.cards_root, route.atlas_path, `${epic} atlas`);
    physicalIntakeTarget(spec.cards_root, path.dirname(route.board_path), `${epic} board directory`, 'directory');
    physicalIntakeTarget(spec.cards_root, route.board_path, `${epic} board`);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (!fs.existsSync(route.atlas_path) || !fs.existsSync(route.board_path)) {
    return { ok: false, reason: `canonical epic scaffold does not resolve: ${epic}` };
  }
  const atlas = fs.readFileSync(route.atlas_path, 'utf8');
  const board = fs.readFileSync(route.board_path, 'utf8');
  const atlasBoard = normalizePath(scalarField(atlas, 'epic_board'));
  const boardEpic = linkName(scalarField(board, 'epic')) || scalarField(board, 'epic');
  if (scalarField(atlas, 'type') !== 'epic'
    || (atlasBoard !== route.board_ref && !atlasBoard.endsWith(`/${route.board_ref}`))
    || scalarField(board, 'board_role') !== 'epic'
    || boardEpic !== epic) {
    return { ok: false, reason: `canonical epic scaffold is invalid: ${epic}` };
  }
  return { ok: true, route, atlas, board };
}

function renderOptionsForCard(spec, card, epicNative) {
  if (!epicNative || (card.role || 'execution') !== 'execution') return {};
  const epic = epicNameForCard(spec, card);
  if (!safeTitle(epic)) return { epicNative: true, epicName: epic || '' };
  const route = epicRoute(spec, epic);
  return { epicNative: true, epicName: epic, boardRef: route.board_ref, atlasRef: route.atlas_ref };
}

function evidenceClaims(spec) {
  return [...(Array.isArray(spec.evidence) ? spec.evidence : []), ...(Array.isArray(spec.evidence_claims) ? spec.evidence_claims : [])]
    .map((item) => {
      const claim = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
      return {
        source_identity: String(claim.source_identity || '').trim(),
        captured_at: String(claim.captured_at || '').trim(),
        revision: String(claim.revision || '').trim(),
        locator: String(claim.locator || (claim.path && claim.line ? `${claim.path}:${claim.line}` : '')).trim(),
        claim: String(claim.claim || claim.note || '').trim(),
      };
    });
}

function deliveryContract(card, spec, options = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(card, key);
  const riskInput = has('risk_dimensions') ? card.risk_dimensions : (has('risk_flags') ? card.risk_flags : []);
  const riskDimensions = Array.isArray(riskInput)
    ? [...new Set(riskInput.map((risk) => RISK_MAP[risk] || risk))] : riskInput;
  const epic = options.epicNative ? `[[${options.epicName}]]` : spec.epic;
  const contract = {
    card: card.title,
    schema_version: has('schema_version') ? card.schema_version : delivery.CONTRACT_VERSION,
    parent_card: options.epicNative ? epic
      : (has('parent_title') ? (card.parent_title ? `[[${card.parent_title}]]` : card.parent_title) : spec.epic),
    slice: has('slice') ? card.slice : card.title,
    model_profile: card.model_profile,
    execution_mode: has('execution_mode') ? card.execution_mode : spec.completion_mode,
    batch_policy: has('batch_policy') ? card.batch_policy : 'continue',
    status: has('status') ? card.status : 'planning',
    touch_zones: card.touch_zones,
    depends_on: card.depends_on,
    deploy_subscriptions: has('deploy_subscriptions') ? card.deploy_subscriptions : { headspace: [], accuris: [], ero: [] },
    epic,
    evidence: evidenceClaims(spec),
    release_required: has('release_required') ? card.release_required : spec.completion_mode === 'release',
    deployment_required: has('deployment_required') ? card.deployment_required : spec.completion_mode === 'release',
    risk_dimensions: riskDimensions,
  };
  if (delivery.registry.policies.policy_strength.includes(contract.batch_policy)) {
    contract.batch_policy = delivery.derivePolicy(contract);
  }
  if (has('context_pack')) contract.context_pack = card.context_pack;
  return contract;
}

function validateDeliveryContract(card, mode = 'current') {
  return delivery.validateCard(card, mode);
}

function parseBoard(md) {
  const lanes = {};
  let lane = null;
  for (const line of String(md || '').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) { lane = heading[1]; lanes[lane] ||= []; continue; }
    if (!lane) continue;
    const card = line.match(/^\s*-\s*\[([ xX])\]\s*\[\[([^\]|]+)(?:\|[^\]]+)?\]\](.*)$/);
    if (card) lanes[lane].push({ checked: /x/i.test(card[1]), title: card[2].trim(), suffix: card[3] || '' });
  }
  return lanes;
}

function boardLane(lanes, title) {
  return Object.entries(lanes).find(([, entries]) => entries.some((entry) => entry.title === title))?.[0] || null;
}

function findCard(cardsRoot, title) {
  if (!cardsRoot || !fs.existsSync(cardsRoot)) return null;
  const wanted = `${title}.md`;
  const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.name === wanted) return item;
    }
  }
  return null;
}

function findCards(cardsRoot, title) {
  if (!cardsRoot || !fs.existsSync(cardsRoot)) return [];
  const wanted = `${title}.md`;
  const matches = [];
  const stack = [cardsRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.name === wanted) matches.push(item);
    }
  }
  return matches.sort();
}

function findNote(roots, title) {
  const target = linkName(title) || String(title || '').trim();
  if (!target) return null;
  const basename = `${target.replace(/\.md$/i, '')}.md`;
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const direct = path.resolve(root, basename);
    if (within(root, direct) && fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
    if (basename.includes('/') || basename.includes('\\')) continue;
    const stack = [path.resolve(root)];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      for (const entry of entries) {
        const item = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(item);
        else if (entry.name === basename) return item;
      }
    }
  }
  return null;
}

function resolveEvidence(roots, item) {
  if (!item || typeof item.path !== 'string' || !item.path || path.isAbsolute(item.path) || !Number.isInteger(item.line) || item.line < 1) return null;
  for (const root of roots) {
    const file = path.resolve(root, item.path);
    if (!within(root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const lineCount = fs.readFileSync(file, 'utf8').split('\n').length;
    if (item.line <= lineCount) return file;
  }
  return null;
}

function artifactEvidence(markdown) {
  return [...String(markdown || '').matchAll(/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_. -]+)*):(\d+)/g)]
    .map((match) => ({ path: match[1], line: Number(match[2]) }));
}

function bindingFixtureText(fixture) {
  if (typeof fixture === 'string') return fixture;
  if (fixture && typeof fixture === 'object' && !Array.isArray(fixture)) return [fixture.name, fixture.description].filter(Boolean).map(String).join(' ');
  return null;
}

function fixtureCoversFinding(text, finding) {
  return new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(finding)}([^A-Za-z0-9_]|$)`).test(text);
}

function validateSupersede(card, errors) {
  if (typeof card.supersedes !== 'string' || !safeTitle(card.supersedes)) {
    errors.push(`${card.title}: supersede_invalid: supersedes must be a safe card title, and carried_findings/binding_fixtures require supersedes`);
    return;
  }
  const findings = Array.isArray(card.carried_findings) ? card.carried_findings : null;
  const fixtures = Array.isArray(card.binding_fixtures) ? card.binding_fixtures : null;
  if (!findings || !findings.length) errors.push(`${card.title}: supersede_missing_fields: carried_findings must be a non-empty array of finding names`);
  // Carried-findings ceiling: a successor carrying more than the cap is proof
  // the slice is mis-scoped — a 1:1 supersession chain has accreted an
  // ever-growing acceptance conjunction that review will never pass whole.
  // Refuse and demand decomposition rather than mint yet another mega-successor.
  const carriedCap = SLICE_SCOPE_CAPS.carried_findings;
  if (typeof carriedCap === 'number' && findings && findings.length > carriedCap) {
    errors.push(`${card.title}: carried_findings_ceiling: ${findings.length} carried findings (> ${carriedCap}) signals a mis-scoped slice; decompose the predecessor into independently mergeable slices that each carry a share of the findings, do not supersede 1:1`);
  }
  if (!fixtures || !fixtures.length) errors.push(`${card.title}: supersede_missing_fields: binding_fixtures must be a non-empty array of fixture strings or {name, description}`);
  if (!findings || !findings.length || !fixtures || !fixtures.length) return;
  if (findings.some((finding) => typeof finding !== 'string' || !finding.trim())) {
    errors.push(`${card.title}: supersede_invalid: carried_findings entries must be non-empty strings`);
    return;
  }
  const texts = fixtures.map(bindingFixtureText);
  if (texts.some((text) => text == null || !text.trim())) {
    errors.push(`${card.title}: supersede_invalid: binding_fixtures entries must be non-empty strings or {name, description}`);
    return;
  }
  for (const finding of findings) {
    if (!texts.some((text) => fixtureCoversFinding(text, finding))) errors.push(`${card.title}: supersede_coverage_missing: carried finding not covered by any binding fixture: ${finding}`);
  }
}

function validateCard(card, spec, errors, options = {}) {
  const role = card.role || 'execution';
  if (!safeTitle(card.title)) errors.push('every card needs a safe one-line title without path separators');
  if (card.parent_title && !safeTitle(card.parent_title)) errors.push(`${card.title}: parent title is unsafe`);
  if (!['parent', 'execution'].includes(role)) errors.push(`${card.title}: role must be parent|execution`);
  if (!delivery.normalizeStatus(card.status || 'planning')) errors.push(`${card.title}: invalid normalized status`);
  if (!Array.isArray(card.depends_on)) errors.push(`${card.title}: depends_on must be an array`);
  else for (const dep of card.depends_on) {
    if (typeof dep === 'string' && /^external:/.test(dep)) continue; // explicit off-board dep, accepted verbatim
    if (!linkName(dep)) errors.push(`${card.title}: dependencies must be wikilinks or external:<text>`);
  }
  if (spec.completion_mode === 'docs_only' && card.lane !== 'Docs Only') errors.push(`${card.title}: docs_only card must use Docs Only lane`);
  if (role === 'parent') {
    for (const key of ['model_profile', 'touch_zones', 'deploy_subscriptions']) {
      if (card[key] != null) errors.push(`${card.title}: parent must remain non-claimable; remove ${key}`);
    }
    if (card.supersedes != null || card.carried_findings != null || card.binding_fixtures != null) errors.push(`${card.title}: supersede_invalid: only execution cards may supersede`);
    return;
  }
  if (card.supersedes != null || card.carried_findings != null || card.binding_fixtures != null) validateSupersede(card, errors);
  for (const field of ['touch_zones', 'acceptance_tests', 'applicable_guides', 'trap_warnings']) {
    if (!Array.isArray(card[field]) || !card[field].length) errors.push(`${card.title}: ${field} must be non-empty`);
  }
  // Slice-scope ceilings (upper bound): an execution slice above any cap is a
  // program hidden in one card and will thrash the review loop. Refuse at mint
  // and demand decomposition. risk_dimensions counts pre-normalization entries.
  for (const field of ['touch_zones', 'acceptance_tests', 'risk_dimensions']) {
    const cap = SLICE_SCOPE_CAPS[field];
    if (typeof cap === 'number' && Array.isArray(card[field]) && card[field].length > cap) {
      errors.push(`${card.title}: slice_scope_ceiling: ${field} has ${card[field].length} > ${cap}; this slice is a program — decompose it into independently mergeable slices before minting`);
    }
  }
  if (card.parent_title && !card.slice) errors.push(`${card.title}: nested child needs slice`);
  if (spec.completion_mode === 'release') {
    if (card.execution_mode && card.execution_mode !== 'release') errors.push(`${card.title}: execution_mode mismatch`);
  } else {
    if (card.execution_mode !== 'docs_only' || card.release_required !== false || card.deployment_required !== false) errors.push(`${card.title}: docs_only routing flags are required`);
  }
  const verdict = validateDeliveryContract(deliveryContract(card, spec, options));
  for (const issue of verdict.errors) errors.push(`${card.title}: Delivery ${issue.code} (${issue.field}): ${issue.message}`);
  if (verdict.requires_migration) errors.push(`${card.title}: new intake must use Delivery ${delivery.CONTRACT_VERSION}`);
}

function validateSpec(spec, boardRaw = '', options = {}) {
  const errors = [];
  if (!['single', 'roadmap'].includes(spec.mode)) errors.push('mode must be single|roadmap');
  if (!CLASSIFICATIONS.has(spec.classification)) errors.push('classification is invalid');
  if (!['release', 'docs_only'].includes(spec.completion_mode)) errors.push('completion_mode must be release|docs_only');
  if (!spec.outcome || /[\n\r]/.test(spec.outcome)) errors.push('outcome must be one sentence on one line');
  if (!spec.project_root || !spec.board_path || !spec.cards_root) errors.push('project_root, board_path, and cards_root are required');
  const projectRoot = spec.project_root ? path.resolve(spec.project_root) : null;
  const boardRoot = spec.board_path ? path.dirname(path.resolve(spec.board_path)) : null;
  if (projectRoot && boardRoot && projectRoot !== boardRoot) errors.push('project_root must equal the existing board directory');
  if (spec.board_path && (!fs.existsSync(spec.board_path) || !/^##\s+In Planning\s*$/m.test(boardRaw))) errors.push('board_path must be an existing Sauce project board');
  for (const [label, target] of [['board_path', spec.board_path], ['cards_root', spec.cards_root], ['roadmap_path', spec.roadmap_path], ['ga_exception_path', spec.ga_exception_path]]) {
    if (boardRoot && target && !within(boardRoot, target)) errors.push(`${label} must stay inside the board directory`);
  }
  const evidenceRoots = [...new Set([boardRoot, ...(Array.isArray(spec.evidence_roots) ? spec.evidence_roots : [])].filter(Boolean).map((root) => path.resolve(root)))];
  const evidence = Array.isArray(spec.evidence) ? spec.evidence : [];
  const hasEvidence = evidence.length > 0 && evidence.every((item) => resolveEvidence(evidenceRoots, item));
  const linkRoots = [...new Set([spec.cards_root, boardRoot, ...(Array.isArray(spec.link_roots) ? spec.link_roots : [])].filter(Boolean).map((root) => path.resolve(root)))];
  const researchPath = spec.research_artifact ? findNote(linkRoots, spec.research_artifact) : null;
  const hasResearch = Boolean(researchPath && artifactEvidence(fs.readFileSync(researchPath, 'utf8')).some((item) => resolveEvidence(evidenceRoots, item)));
  const scoutOnly = !hasEvidence && !hasResearch && Boolean(spec.scout_artifact);
  if (spec.research_artifact && !hasResearch) errors.push('research_artifact must resolve and contain path:line evidence');
  if (!hasEvidence && !hasResearch && !scoutOnly) errors.push('file evidence path+line, research_artifact, or scout_artifact is required');
  const cards = Array.isArray(spec.cards) ? spec.cards : [];
  const cutoverEnabled = options.cutoverEnabled === true;
  const triageFlat = cutoverEnabled && spec.classification === 'bug'
    && cards.length === 1 && cards[0].lane === 'Discovered (autoloop)';
  const epicNative = cutoverEnabled && !triageFlat && !scoutOnly && spec.completion_mode === 'release';
  if (new Set(cards.map((card) => card.title)).size !== cards.length) errors.push('card titles must be unique across parents and children');
  if (scoutOnly && cards.some((card) => (card.role || 'execution') === 'execution')) errors.push('scout-only intake cannot create an execution card');
  if (!scoutOnly && !cards.length) errors.push('evidenced intake requires cards');
  for (const card of cards) validateCard(card, spec, errors, renderOptionsForCard(spec, card, epicNative));
  if (spec.completion_mode === 'docs_only') {
    if (cards.some((card) => card.lane !== 'Docs Only')) errors.push('docs_only cards must route to Docs Only');
  } else if (spec.classification === 'roadmap_theme') {
    if (cards.some((card) => card.role === 'parent' ? !['In Planning', 'Post-GA'].includes(card.lane) : card.lane !== 'In Planning')) errors.push('roadmap parents must route to In Planning|Post-GA and prepared children to In Planning');
  } else {
    const expectedLane = spec.classification === 'bug' ? 'Discovered (autoloop)'
      : spec.classification === 'post_ga' ? 'Post-GA' : 'In Planning';
    if (cards.some((card) => card.lane !== expectedLane)) errors.push(`${spec.classification} cards must route to ${expectedLane}`);
  }
  const executionCards = cards.filter((card) => (card.role || 'execution') === 'execution');
  const parentCards = cards.filter((card) => card.role === 'parent');
  if (epicNative) {
    const newEpicNames = new Set(parentCards.filter((card) => card.existing !== true).map((card) => card.title));
    for (const card of executionCards) {
      const epic = epicNameForCard(spec, card);
      if (!safeTitle(epic)) {
        errors.push(`${card.title}: post-cutover execution intake requires one named epic`);
        continue;
      }
      if (!newEpicNames.has(epic)) {
        const surface = canonicalEpicSurface(spec, epic);
        if (!surface.ok) errors.push(`${card.title}: ${surface.reason}`);
      }
    }
    for (const parent of parentCards.filter((card) => card.existing === true)) {
      const surface = canonicalEpicSurface(spec, parent.title);
      if (!surface.ok) errors.push(`${parent.title}: ${surface.reason}`);
    }
    if (!parentCards.length && !executionCards.length) {
      errors.push('post-cutover intake requires an epic slice, epic scaffold, or Discovered triage card');
    }
  }
  if (!scoutOnly && spec.classification === 'bug') {
    if (!spec.reproduction || /[\n\r]/.test(spec.reproduction)) errors.push('bugs require one-line reproduction evidence');
    if (cards.length !== 1 || executionCards.length !== 1 || cards.some((card) => card.parent_title)) errors.push('a bug intake must create one direct execution card');
    if (cards.some((card) => card.lane !== 'Discovered (autoloop)')) errors.push('bugs must route to Discovered (autoloop)');
  }
  if (!scoutOnly && spec.classification === 'direct_execution' && (cards.length !== 1 || executionCards.length !== 1 || cards.some((card) => card.parent_title))) errors.push('direct_execution requires one root execution card');
  if (!scoutOnly && spec.classification === 'post_ga') {
    if (cards.some((card) => card.lane !== 'Post-GA')) errors.push('post_ga cards must route to Post-GA');
    if (executionCards.length || parentCards.length !== 1 || cards.some((card) => card.parent_title)) errors.push('post_ga must remain one undecomposed parent');
  }
  if (spec.mode === 'roadmap' && (!spec.roadmap_path || !spec.roadmap_section)) errors.push('roadmap mode requires roadmap_path and roadmap_section');
  if (spec.mode === 'roadmap' && spec.classification !== 'roadmap_theme') errors.push('roadmap mode requires roadmap_theme classification');
  if (spec.classification === 'roadmap_theme' && spec.mode !== 'roadmap') errors.push('roadmap_theme classification requires roadmap mode');
  if (spec.classification === 'ga_exception' && (!spec.ga_exception_path || !spec.ga_exception_section)) errors.push('ga_exception requires Priorities path and exception section');
  const roots = cards.filter((card) => !card.parent_title);
  const childParents = [...new Set(cards.filter((card) => card.parent_title).map((card) => card.parent_title))];
  if (spec.mode === 'roadmap' && childParents.some((parent) => !roots[0] || parent !== roots[0].title)) errors.push('lazy lookahead permits children only for the first parent');
  if (spec.mode === 'roadmap' && childParents.length && roots[0]?.lane !== 'In Planning') errors.push('the prepared roadmap parent must be In Planning');
  if (!scoutOnly && spec.mode === 'roadmap' && (roots.length === 0 || roots.some((card) => card.role !== 'parent'))) errors.push('roadmap roots must be non-claimable parents');
  if (!scoutOnly && spec.mode === 'roadmap' && roots.some((card) => card.lane === 'In Planning')
    && (roots[0]?.lane !== 'In Planning' || childParents.length !== 1 || childParents[0] !== roots[0].title)) errors.push('the first In Planning roadmap parent requires prepared execution children');
  if (!scoutOnly && spec.classification === 'parent_children' && (roots.length !== 1 || roots[0].role !== 'parent' || childParents.length !== 1 || childParents[0] !== roots[0].title)) errors.push('parent_children requires one prepared parent with nested children');
  if (!scoutOnly && spec.classification === 'ga_exception') {
    const directShape = cards.length === 1 && executionCards.length === 1 && !cards[0].parent_title;
    const parentShape = roots.length === 1 && roots[0].role === 'parent' && childParents.length === 1 && childParents[0] === roots[0].title;
    if (!directShape && !parentShape) errors.push('ga_exception requires direct execution or one prepared parent with nested children');
  }
  const order = new Map(cards.map((card, index) => [card.title, index]));
  for (const card of cards) for (const dep of card.depends_on || []) {
    if (typeof dep === 'string' && /^external:/.test(dep)) continue; // explicit off-board dep, never resolved
    const name = linkName(dep);
    if (order.has(name) && order.get(name) > order.get(card.title)) errors.push(`${card.title}: dependency appears after dependent`);
    else if (!order.has(name) && !findCard(spec.cards_root, name)) errors.push(`${card.title}: dependency does not resolve: ${name}`);
  }
  const lanes = parseBoard(boardRaw);
  const protectedNames = new Set([...(spec.protected_cards || []), ...['In Progress', 'Parked'].flatMap((lane) => (lanes[lane] || []).map((entry) => entry.title))]);
  for (const card of cards) {
    if (protectedNames.has(card.title) || protectedNames.has(card.parent_title)) errors.push(`${card.title}: refuses to touch active/protected card`);
    const priorPath = findCard(spec.cards_root, card.title);
    if (epicNative && (card.role || 'execution') === 'execution') {
      const intendedPath = cardPath(spec, card, renderOptionsForCard(spec, card, true));
      const foreignPath = findCards(spec.cards_root, card.title)
        .find((candidate) => path.resolve(candidate) !== path.resolve(intendedPath));
      if (foreignPath) {
        errors.push(`${card.title}: duplicate card title resolves outside intended epic: ${foreignPath}`);
      }
    }
    if (card.existing === true && !priorPath) errors.push(`${card.title}: existing card does not resolve`);
    if (card.existing === true && card.role !== 'parent') errors.push(`${card.title}: only non-claimable parents may be updated as existing cards`);
    const actualLane = boardLane(lanes, card.title);
    if (card.existing === true && actualLane && actualLane !== card.lane) {
      const promotableRoadmapParent = spec.classification === 'roadmap_theme' && card.role === 'parent'
        && [actualLane, card.lane].every((lane) => ['In Planning', 'Post-GA'].includes(lane));
      if (!promotableRoadmapParent) errors.push(`${card.title}: existing card cannot move from ${actualLane} to ${card.lane}`);
    }
    if (priorPath) {
      const priorStatus = (fs.readFileSync(priorPath, 'utf8').match(/^status:\s*([^\s#]+)/m) || [])[1];
      if (['in_progress', 'parked'].includes(priorStatus)) errors.push(`${card.title}: refuses to touch ${priorStatus} card`);
    }
  }
  if (!scoutOnly && cards.length && errors.length === 0) {
    const plannedNames = new Set(cards.map((card) => card.title));
    const emitted = [...cards.map((card) => renderCard(card, spec, renderOptionsForCard(spec, card, epicNative))), spec.roadmap_section, spec.ga_exception_section].filter(Boolean).join('\n');
    for (const match of emitted.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const target = match[1].trim();
      if (!plannedNames.has(target) && !findNote(linkRoots, target)) errors.push(`emitted wikilink does not resolve: ${target}`);
    }
  }
  return { errors, scoutOnly, cards, lanes, cutoverEnabled, triageFlat, epicNative };
}

function renderCard(card, spec, options = {}) {
  const role = card.role || 'execution';
  const contract = role === 'execution' ? validateDeliveryContract(deliveryContract(card, spec, options)).card : null;
  const boardRef = options.boardRef || parentBoardRef(spec);
  const noteType = options.epicNative && role === 'execution' ? 'slice' : 'task-hub';
  const structuredValue = (value) => delivery.encodeStructuredFrontmatterValue(value);
  const lines = ['---', `type: ${noteType}`, `created_at: ${quoted(spec.created_at || new Date().toISOString())}`, `source_board: ${quoted(boardRef)}`, `kanban_board: ${quoted(boardRef)}`, `kanban_column: ${quoted(card.lane)}`, `status: ${contract ? contract.status : (delivery.normalizeStatus(card.status || 'planning') || card.status)}`];
  if (options.epicNative && role === 'execution') {
    lines.push(`epic: ${quoted(`[[${options.epicName}]]`)}`, `task_parent: ${quoted(options.atlasRef)}`);
  } else if (spec.epic) lines.push(`epic: ${quoted(spec.epic)}`);
  if (role === 'execution') {
    lines.push(`card: ${quoted(contract.card)}`, `schema_version: ${quoted(contract.schema_version)}`, `parent_card: ${quoted(`[[${contract.parent_card}]]`)}`, `slice: ${quoted(contract.slice)}`);
    lines.push(`model_profile: ${contract.model_profile}`, `execution_mode: ${contract.execution_mode}`, `batch_policy: ${contract.batch_policy}`);
    if (Object.prototype.hasOwnProperty.call(contract, 'context_pack')) lines.push(`context_pack: ${quoted(contract.context_pack)}`);
    lines.push(`release_required: ${contract.release_required}`, `deployment_required: ${contract.deployment_required}`);
    lines.push('touch_zones:', ...contract.touch_zones.map((item) => `  - ${quoted(item)}`));
  }
  lines.push('depends_on:');
  const dependencies = contract
    ? contract.depends_on.map((item) => (/^external:/.test(item) ? item : `[[${item}]]`))
    : (card.depends_on || []);
  if (dependencies.length) lines.push(...dependencies.map((item) => `  - ${quoted(item)}`));
  else lines.push('  []');
  if (role === 'execution') {
    if (options.legacyStructuredFrontmatter === true) {
      lines.push('deploy_subscriptions:');
      for (const vault of VAULTS) lines.push(`  ${vault}: ${JSON.stringify(contract.deploy_subscriptions[vault])}`);
    } else {
      lines.push(`deploy_subscriptions: ${structuredValue(contract.deploy_subscriptions)}`);
    }
  }
  if (role === 'execution') {
    lines.push(
      `evidence: ${options.legacyStructuredFrontmatter === true ? JSON.stringify(contract.evidence) : structuredValue(contract.evidence)}`,
      `risk_dimensions: ${JSON.stringify(contract.risk_dimensions)}`,
    );
  }
  if (role === 'execution' && card.supersedes) {
    lines.push(
      `supersedes: ${quoted(card.supersedes)}`,
      `carried_findings: ${JSON.stringify(card.carried_findings)}`,
      `binding_fixtures: ${options.legacyStructuredFrontmatter === true ? JSON.stringify(card.binding_fixtures) : structuredValue(card.binding_fixtures)}`,
    );
  }
  lines.push('tags:', ...(options.epicNative && role === 'execution' ? ['  - slice'] : ['  - kanban-card', '  - project-card']), '---', '', `## ${card.title}`, '', '### Outcome', '', card.outcome || spec.outcome, '', '### Evidence', '');
  for (const item of spec.evidence || []) lines.push(`- \`${item.path}:${item.line}\`${item.note ? ` — ${item.note}` : ''}`);
  if (spec.reproduction) lines.push(`- Reproduction: ${spec.reproduction}`);
  if (spec.research_artifact) lines.push(`- Research artifact: [[${spec.research_artifact}]]`);
  if (spec.scout_artifact) lines.push(`- Scout required: [[${spec.scout_artifact}]]`);
  if (role === 'parent') lines.push('', 'Parent only — do not claim. Decompose per [[Loop System with Codex]] §Execution-slice contract.');
  else lines.push('', '### Acceptance tests', '', ...card.acceptance_tests.map((item) => `- ${item}`), '', '### Applicable guides', '', ...card.applicable_guides.map((item) => `- \`${item}\``), '', '### Trap warnings', '', ...card.trap_warnings.map((item) => `- ${item}`));
  return `${lines.join('\n')}\n`;
}

function renderEpicAtlas(parent, spec, boardRaw, route, createdAt) {
  const projectName = scalarField(boardRaw, 'project_name');
  const projectSlug = scalarField(boardRaw, 'project_slug');
  const sourceBoard = parentBoardRef(spec);
  const lines = ['---', 'type: epic', `schema_version: ${EPIC_SCHEMA_VERSION}`, `created_at: ${quoted(createdAt)}`];
  if (projectName) lines.push(`project: ${quoted(`[[${projectName}]]`)}`);
  if (projectSlug) lines.push(`project_slug: ${projectSlug}`);
  if (projectName) lines.push(`project_name: ${quoted(projectName)}`);
  lines.push(
    `source_board: ${quoted(sourceBoard)}`,
    `kanban_board: ${quoted(sourceBoard)}`,
    `status: ${delivery.normalizeStatus(parent.status || 'planning') || parent.status}`,
    `epic_board: ${quoted(route.board_ref)}`,
    'posture: claimable',
    'docs: []',
    'tags:', '  - epic',
    `kanban_column: ${quoted(parent.lane)}`,
    '---', '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });',
    '```', '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "GraphView" });',
    '```', '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "EpicDashboard" });',
    '```', '',
  );
  return lines.join('\n');
}

function renderEpicBoard(epic, spec, boardRaw, route, createdAt) {
  const projectName = scalarField(boardRaw, 'project_name');
  const projectSlug = scalarField(boardRaw, 'project_slug');
  const settings = JSON.stringify({
    'kanban-plugin': 'board',
    'list-collapse': [false, false, false, false],
    'mark-cards-complete': true,
    'new-note-folder': normalizePath(path.posix.dirname(route.board_ref)),
    'new-note-template': 'ranch/templates/Template, Slice Card.md',
  });
  const lines = [
    '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic',
    `epic: ${quoted(`[[${epic}]]`)}`,
    ...(projectSlug ? [`project_slug: ${projectSlug}`] : []),
    ...(projectName ? [`project_name: ${quoted(projectName)}`] : []),
    `created_at: ${quoted(createdAt)}`,
    'tags:', '  - epic-board', '---', '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });',
    '```', '',
    '## In Planning', '',
    '## In Progress', '',
    '## Blocked', '',
    '## Completed', '',
    '%% kanban:settings', '```', settings, '```', '%%', '',
  ];
  return lines.join('\n');
}

function renderContextPack(epic, spec, createdAt) {
  const body = `Prepared by card-intake for: ${spec.outcome}\n`;
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  return [
    '---', 'type: context-pack', 'schema_version: 1.0.0',
    `epic: ${quoted(`[[${epic}]]`)}`,
    `content_sha256: ${digest}`,
    `generated_at: ${quoted(createdAt)}`,
    '---', '', body,
  ].join('\n');
}

function ensureLane(board, lane) {
  if (new RegExp(`^## ${escapeRe(lane)}\\s*$`, 'm').test(board)) return board;
  const anchor = board.match(/^## (Post-GA|Completed)\s*$/m);
  const block = `## ${lane}\n\n`;
  return anchor ? `${board.slice(0, anchor.index)}${block}${board.slice(anchor.index)}` : `${board.trimEnd()}\n\n${block}`;
}

function insertBoardCard(board, card, children = []) {
  board = ensureLane(board, card.lane);
  const existing = new RegExp(`^(\\s*-\\s*\\[[ xX]\\]\\s*\\[\\[${escapeRe(card.title)}(?:\\|[^\\]]+)?\\]\\]).*$`, 'm');
  const suffix = children.length ? ` (decomposed → ${children.map((child) => `[[${child.title}]]`).join(' → ')})` : '';
  let next = board;
  if (existing.test(board)) {
    const actualLane = boardLane(parseBoard(board), card.title);
    if (actualLane === card.lane) next = board.replace(existing, `$1${suffix}`);
    else next = board.replace(new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*\\[\\[${escapeRe(card.title)}(?:\\|[^\\]]+)?\\]\\].*\\n?`, 'm'), '');
  }
  if (!existing.test(next)) {
    const heading = next.match(new RegExp(`^## ${escapeRe(card.lane)}\\s*$`, 'm'));
    const sectionStart = heading.index + heading[0].length;
    const tail = next.slice(sectionStart);
    const nextHeading = tail.search(/^##\s+/m);
    const section = nextHeading < 0 ? tail : tail.slice(0, nextHeading);
    const anchors = [...(card.depends_on || []).map(linkName), card.parent_title].filter(Boolean);
    let at = sectionStart;
    for (const anchor of anchors) {
      const match = section.match(new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*\\[\\[${escapeRe(anchor)}(?:\\|[^\\]]+)?\\]\\].*$`, 'm'));
      if (match) at = Math.max(at, sectionStart + match.index + match[0].length);
    }
    const separator = at === sectionStart ? '\n\n' : '\n';
    next = `${next.slice(0, at)}${separator}- [ ] [[${card.title}]]${suffix}${next.slice(at)}`;
  }
  for (const child of children) next = next.replace(new RegExp(`^\\s*-\\s*\\[[ xX]\\]\\s*\\[\\[${escapeRe(child.title)}(?:\\|[^\\]]+)?\\]\\].*\\n?`, 'm'), '');
  for (const child of children) next = insertBoardCard(next, child, []);
  return next;
}

function cardPath(spec, card, options = {}) {
  const target = options.epicNative
    ? path.join(spec.cards_root, options.epicName, 'board', `${card.title}.md`)
    : (card.parent_title ? path.join(spec.cards_root, card.parent_title, card.title, `${card.title}.md`) : path.join(spec.cards_root, card.title, `${card.title}.md`));
  if (!within(spec.cards_root, target)) throw new Error(`card path escapes cards_root: ${card.title}`);
  return target;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.card-intake-${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function priorCreatedAt(markdown) {
  const match = String(markdown || '').match(/^created_at:\s*(.+?)\s*$/m);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (_) { return match[1].replace(/^['"]|['"]$/g, ''); }
}

function patchExistingLane(markdown, lane) {
  if (/^kanban_column:\s*.+$/m.test(markdown)) return markdown.replace(/^kanban_column:\s*.+$/m, `kanban_column: ${quoted(lane)}`);
  if (markdown.startsWith('---\n')) return markdown.replace('---\n', `---\nkanban_column: ${quoted(lane)}\n`);
  return markdown;
}

function patchExistingCard(markdown, card) {
  let result = patchExistingLane(markdown, card.lane);
  if (card.role !== 'parent') return result;
  if (/^status:\s*.+$/m.test(result)) result = result.replace(/^status:\s*.+$/m, `status: ${card.status || 'planning'}`);
  const lines = ['depends_on:'];
  if ((card.depends_on || []).length) lines.push(...card.depends_on.map((dep) => `  - ${quoted(dep)}`));
  else lines.push('  []');
  const depends = `${lines.join('\n')}\n`;
  const block = /^depends_on:[^\n]*\n(?:^[ \t]+.*\n)*/m;
  if (block.test(result)) return result.replace(block, depends);
  return result.replace(/^status:.*$/m, (line) => `${line}\n${depends.trimEnd()}`);
}

function roadmapContent(raw, spec) {
  const key = slug(spec.roadmap_key || spec.outcome);
  const begin = `<!-- card-intake:${key} BEGIN -->`;
  const end = `<!-- card-intake:${key} END -->`;
  const block = `${begin}\n${spec.roadmap_section.trim()}\n${end}`;
  const re = new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`);
  return re.test(raw) ? raw.replace(re, block) : `${raw.trimEnd()}\n\n${block}\n`;
}

function posture(spec, validation, boardRaw) {
  if (validation.scoutOnly) return { result: 'awaiting_user_decision', next_card: null, model_profile: null };
  if (spec.completion_mode === 'docs_only') return { result: 'docs_only', next_card: null, model_profile: null };
  if (['bug', 'post_ga'].includes(spec.classification)) return { result: 'awaiting_user_decision', next_card: null, model_profile: null };
  const next = validation.cards.find((card) => (card.role || 'execution') === 'execution' && card.lane === 'In Planning');
  if (!next) return { result: 'awaiting_user_decision', next_card: null, model_profile: null };
  return { result: 'awaiting_user_decision', next_card: null, model_profile: null, candidate_card: next.title, candidate_model_profile: next.model_profile, eligibility_dry_run_required: true };
}

function fileList(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else files.push(item);
    }
  }
  return files.sort();
}

function enqueuePlan(planned, file, content, options = {}) {
  const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const accepted = Array.isArray(options.acceptedPreimages) ? options.acceptedPreimages : [];
  if (prior !== null && prior !== content && !options.allowExisting && !accepted.includes(prior)) {
    return `${options.label || path.basename(file)}: refuses unexpected pre-existing bytes at ${file}`;
  }
  const existing = planned.find((item) => item.path === file);
  if (existing && existing.content !== content) return `conflicting planned bytes for ${file}`;
  if (!existing) planned.push({ path: file, content, changed: prior !== content });
  return null;
}

function planSupplementalFiles(spec, planned) {
  if (spec.mode === 'roadmap') {
    const prior = fs.existsSync(spec.roadmap_path) ? fs.readFileSync(spec.roadmap_path, 'utf8') : '';
    const content = roadmapContent(prior, spec);
    planned.push({ path: spec.roadmap_path, content, changed: prior !== content });
  }
  if (spec.classification === 'ga_exception') {
    const prior = fs.existsSync(spec.ga_exception_path) ? fs.readFileSync(spec.ga_exception_path, 'utf8') : '';
    const content = roadmapContent(prior, { ...spec, roadmap_key: `ga-exception-${slug(spec.outcome)}`, roadmap_section: spec.ga_exception_section });
    planned.push({ path: spec.ga_exception_path, content, changed: prior !== content });
  }
}

function validateEpicRouteForPlan(spec, route, creating) {
  physicalIntakeTarget(spec.cards_root, route.root, `${route.epic} epic root`, 'directory');
  physicalIntakeTarget(spec.cards_root, route.atlas_path, `${route.epic} atlas`);
  physicalIntakeTarget(spec.cards_root, path.dirname(route.board_path), `${route.epic} board directory`, 'directory');
  physicalIntakeTarget(spec.cards_root, route.board_path, `${route.epic} board`);
  if (creating) {
    physicalIntakeTarget(spec.cards_root, path.join(route.root, 'context'), `${route.epic} context directory`, 'directory');
  }
}

function validatePhysicalPlan(spec, planned) {
  const cardsRoot = path.resolve(spec.cards_root);
  const projectRoot = path.resolve(spec.project_root);
  for (const item of planned) {
    const target = path.resolve(item.path);
    if (within(cardsRoot, target) && target !== cardsRoot) {
      physicalIntakeTarget(cardsRoot, target, `planned card target ${path.basename(target)}`);
    } else if (within(projectRoot, target) && target !== projectRoot) {
      physicalIntakeTarget(projectRoot, target, `planned project target ${path.basename(target)}`);
    } else {
      throw new Error(`GA-OPS13A-EPIC-INTAKE-PHYSICAL-CONTAINMENT planned target escapes sanctioned roots: ${target}`);
    }
  }
}

function planEpicNative(spec, validation, boardRaw) {
  const planned = [];
  const errors = [];
  const parents = validation.cards.filter((card) => card.role === 'parent');
  const executionCards = validation.cards.filter((card) => (card.role || 'execution') === 'execution');
  const parentByName = new Map(parents.map((card) => [card.title, card]));
  let nextParentBoard = boardRaw;
  for (const parent of [...parents].reverse()) nextParentBoard = insertBoardCard(nextParentBoard, parent, []);

  const cardsByEpic = new Map();
  for (const card of executionCards) {
    const epic = epicNameForCard(spec, card);
    if (!cardsByEpic.has(epic)) cardsByEpic.set(epic, []);
    cardsByEpic.get(epic).push(card);
  }
  const epicNames = new Set([...parents.map((card) => card.title), ...cardsByEpic.keys()]);
  for (const epic of epicNames) {
    const parent = parentByName.get(epic);
    const creating = Boolean(parent && parent.existing !== true);
    const route = epicRoute(spec, epic);
    try {
      validateEpicRouteForPlan(spec, route, creating);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const atlasPrior = fs.existsSync(route.atlas_path) ? fs.readFileSync(route.atlas_path, 'utf8') : null;
    const boardPrior = fs.existsSync(route.board_path) ? fs.readFileSync(route.board_path, 'utf8') : null;
    const packPath = path.join(route.root, 'context', 'pack.md');
    const packPrior = fs.existsSync(packPath) ? fs.readFileSync(packPath, 'utf8') : null;
    const createdAt = spec.created_at
      || (atlasPrior && scalarField(atlasPrior, 'created_at'))
      || (boardPrior && scalarField(boardPrior, 'created_at'))
      || (packPrior && scalarField(packPrior, 'generated_at'))
      || new Date().toISOString();
    let baseBoard;
    if (creating) {
      baseBoard = renderEpicBoard(epic, spec, boardRaw, route, createdAt);
    } else {
      const surface = canonicalEpicSurface(spec, epic);
      if (!surface.ok) {
        errors.push(`${epic}: ${surface.reason}`);
        continue;
      }
      baseBoard = surface.board;
    }
    let nextEpicBoard = baseBoard;
    const epicCards = cardsByEpic.get(epic) || [];
    for (const card of [...epicCards].reverse()) nextEpicBoard = insertBoardCard(nextEpicBoard, card, []);

    if (creating) {
      const atlas = renderEpicAtlas(parent, spec, boardRaw, route, createdAt);
      const keepPaths = ['runs', 'lessons', 'decisions'].map((kind) => path.join(route.root, 'context', kind, '.keep'));
      const intendedPaths = new Set([
        route.atlas_path, route.board_path, packPath, ...keepPaths,
        ...epicCards.map((card) => cardPath(spec, card, renderOptionsForCard(spec, card, true))),
      ].map((file) => path.resolve(file)));
      for (const existing of fileList(route.root)) {
        if (!intendedPaths.has(path.resolve(existing))) {
          errors.push(`${epic}: refuses unexpected pre-existing bytes at ${existing}`);
        }
      }
      for (const [file, content, label] of [
        [route.atlas_path, atlas, `${epic} atlas`],
        [path.join(route.root, 'context', 'pack.md'), renderContextPack(epic, spec, createdAt), `${epic} context pack`],
        ...keepPaths.map((file) => [file, '', `${epic} context keep`]),
      ]) {
        const error = enqueuePlan(planned, file, content, { label });
        if (error) errors.push(error);
      }
      const boardError = enqueuePlan(planned, route.board_path, nextEpicBoard, {
        label: `${epic} board`,
        acceptedPreimages: [baseBoard],
      });
      if (boardError) errors.push(boardError);
    } else {
      planned.push({ path: route.board_path, content: nextEpicBoard, changed: nextEpicBoard !== baseBoard });
    }

    for (const card of epicCards) {
      const options = renderOptionsForCard(spec, card, true);
      const file = cardPath(spec, card, options);
      const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const stableSpec = !spec.created_at && prior ? { ...spec, created_at: priorCreatedAt(prior) || undefined }
        : (!spec.created_at ? { ...spec, created_at: createdAt } : spec);
      const content = renderCard(card, stableSpec, options);
      const legacyContent = renderCard(card, stableSpec, { ...options, legacyStructuredFrontmatter: true });
      const error = enqueuePlan(planned, file, content, {
        label: card.title,
        acceptedPreimages: [legacyContent],
      });
      if (error) errors.push(error);
    }
  }
  planSupplementalFiles(spec, planned);
  planned.push({ path: spec.board_path, content: nextParentBoard, changed: nextParentBoard !== boardRaw });
  return { planned, errors, nextBoard: nextParentBoard };
}

function planLegacy(spec, validation, boardRaw) {
  let nextBoard = boardRaw;
  const planned = [];
  const roots = validation.cards.filter((card) => !card.parent_title);
  const boardOrder = [];
  for (const root of roots) {
    const children = validation.cards.filter((card) => card.parent_title === root.title);
    boardOrder.push({ card: root, children });
    boardOrder.push(...children.map((card) => ({ card, children: [] })));
  }
  boardOrder.push(...validation.cards
    .filter((card) => card.parent_title && !roots.some((root) => root.title === card.parent_title))
    .map((card) => ({ card, children: [] })));
  for (const item of boardOrder.reverse()) nextBoard = insertBoardCard(nextBoard, item.card, item.children);
  for (const card of validation.cards) {
    if (card.existing === true) {
      const file = findCard(spec.cards_root, card.title);
      const prior = fs.readFileSync(file, 'utf8');
      const content = patchExistingCard(prior, card);
      planned.push({ path: file, content, changed: prior !== content });
      continue;
    }
    const file = cardPath(spec, card);
    const prior = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const stableSpec = !spec.created_at && prior ? { ...spec, created_at: priorCreatedAt(prior) || undefined } : spec;
    const content = renderCard(card, stableSpec);
    const legacyContent = renderCard(card, stableSpec, { legacyStructuredFrontmatter: true });
    if (prior !== null && prior !== content && prior !== legacyContent) {
      return { ok: false, errors: [`refuses to overwrite existing card: ${card.title}`] };
    }
    planned.push({ path: file, content, changed: prior !== content });
  }
  planSupplementalFiles(spec, planned);
  planned.push({ path: spec.board_path, content: nextBoard, changed: nextBoard !== boardRaw });
  return { planned, errors: [], nextBoard };
}

function run(spec, apply = false, deps = {}) {
  let coordinatorStatus;
  try {
    coordinatorStatus = (deps.readCoordinatorStatus || readInstalledCoordinatorStatus)();
  } catch (error) {
    return { ok: false, errors: [`fresh installed coordinator status failed: ${error.message}`] };
  }
  const boardRaw = fs.existsSync(spec.board_path) ? fs.readFileSync(spec.board_path, 'utf8') : '';
  if (spec.epic_native !== undefined && typeof spec.epic_native !== 'boolean') {
    return { ok: false, errors: ['epic_native must be a boolean when present'] };
  }
  // Fresh boards (loop-plugin bindings) force epic-native topology via
  // spec.epic_native; the ledger cutover flag remains the sauce board's own
  // migration-era switch. Absent both, the legacy flat path is preserved.
  const cutoverEnabled = spec.epic_native === true
    || Boolean(coordinatorStatus && coordinatorStatus.cutover && coordinatorStatus.cutover.enabled === true);
  const validation = validateSpec(spec, boardRaw, { cutoverEnabled });
  if (validation.errors.length) return {
    ok: false, errors: validation.errors, ...(cutoverEnabled ? { cutover_enabled: true } : {}),
  };
  const plan = validation.epicNative ? planEpicNative(spec, validation, boardRaw) : planLegacy(spec, validation, boardRaw);
  if (plan.errors.length) return {
    ok: false, errors: plan.errors, ...(cutoverEnabled ? { cutover_enabled: true } : {}),
  };
  const planned = plan.planned;
  if (validation.epicNative) {
    try {
      validatePhysicalPlan(spec, planned);
    } catch (error) {
      return { ok: false, errors: [error.message], ...(cutoverEnabled ? { cutover_enabled: true } : {}) };
    }
  }
  const changed = planned.filter((item) => item.changed);
  if (apply) for (const item of changed) atomicWrite(item.path, item.content);
  const finalBoard = apply && fs.existsSync(spec.board_path) ? fs.readFileSync(spec.board_path, 'utf8') : plan.nextBoard;
  const discardInstructions = validation.cards
    .filter((card) => (card.role || 'execution') === 'execution' && card.supersedes)
    .map((card) => ({ discard: { card: card.supersedes, superseded_by: card.title } }));
  return {
    ok: true, applied: apply, no_op: changed.length === 0,
    ...(cutoverEnabled ? { cutover_enabled: true } : {}),
    ...(spec.epic_native === true ? { epic_native: true } : {}),
    plan_fingerprint: crypto.createHash('sha256').update(JSON.stringify(cutoverEnabled ? { spec, cutover_enabled: true } : spec)).digest('hex'),
    changed_paths: changed.map((item) => item.path),
    ...(discardInstructions.length ? { post_apply_instructions: discardInstructions } : {}),
    ...posture(spec, validation, finalBoard),
  };
}

module.exports = {
  validateSpec, validateDeliveryContract, deliveryContract, renderCard, parseBoard, run, roadmapContent, cardPath,
  resolveInstalledCoordinator, readInstalledCoordinatorStatus, epicRoute, canonicalEpicSurface,
  renderEpicAtlas, renderEpicBoard, renderContextPack,
};

if (require.main === module) {
  const args = argsOf(process.argv.slice(2));
  if (!args.spec) { console.error('usage: card-intake.js --spec <plan.json> [--apply] [--json]'); process.exit(2); }
  try {
    const result = run(JSON.parse(fs.readFileSync(path.resolve(args.spec), 'utf8')), Boolean(args.apply));
    console.log(args.json ? JSON.stringify(result, null, 2) : `${result.ok ? 'ok' : 'refused'}: ${result.result || (result.errors || []).join('; ')}`);
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(args.json ? JSON.stringify({ ok: false, errors: [error.message] }, null, 2) : error.message);
    process.exit(1);
  }
}
