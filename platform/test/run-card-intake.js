#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  run: runCardIntake, validateDeliveryContract, canonicalEpicSurface,
} = require('../../.agents/skills/card-intake/scripts/card-intake');
const { parseDependsOn, selectCard } = require('../../scripts/autoloop/select-card');
const { selectClaimCandidate } = require('../../scripts/autoloop/codex-coordinator');
const { prepareDeliveryCard } = require('../../scripts/autoloop/select-card');
const delivery = require('../mechanisms/delivery');
const { aggregateClaudeSurface, materializeClaudeSurface } = require('../install');
const { regenerateClaudeMd } = require('../mechanisms/platform-claude/claude-md-renderer');

const ROOT = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function ok(condition, label) { if (condition) { passed += 1; console.log(`  PASS: ${label}`); } else { failed += 1; console.error(`  FAIL: ${label}`); } }
function eq(actual, expected, label) { ok(JSON.stringify(actual) === JSON.stringify(expected), `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`); }
function run(spec, apply = false, deps = {}) {
  return runCardIntake(spec, apply, {
    readCoordinatorStatus: () => ({ action: 'status', cutover: null }),
    ...deps,
  });
}
function board() { return ['---', 'kanban-plugin: board', '---', '', '## In Planning', '', '## In Progress', '', '## Blocked', '', '## Parked', '', '## Discovered (autoloop)', '', '## Post-GA', '', '## Completed', '', '- [x] [[Prerequisite]]', ''].join('\n'); }
function base(dir, extra = {}) {
  return { mode: 'single', classification: 'direct_execution', completion_mode: 'release', outcome: 'Ship one bounded behavior with deterministic coverage.', project_root: dir, link_roots: [dir], evidence_roots: [dir], board_path: path.join(dir, 'board.md'), cards_root: path.join(dir, 'tasks'), source_board: 'project/board.md', epic: '[[Roadmap]]', created_at: '2026-07-15T12:00:00-06:00', evidence: [{ path: 'platform/example.js', line: 12, note: 'verified behavior', source_identity: 'fixture repo', captured_at: '2026-07-15T12:00:00-06:00', revision: 'fixture-revision', claim: 'The bounded example behavior is verified.' }], protected_cards: [], cards: [], ...extra };
}
function execution(title, extra = {}) {
  return { title, role: 'execution', lane: 'In Planning', status: 'planning', model_profile: 'standard', risk_flags: [], execution_mode: 'release', touch_zones: ['platform/example.js', 'platform/test/run-example.js'], depends_on: [], deploy_subscriptions: { headspace: [], accuris: [], ero: [] }, acceptance_tests: ['Focused behavior test passes.', 'Full preflight passes.'], applicable_guides: ['AGENTS.md', 'Docs/agent-guides/build-test-verify.md'], trap_warnings: ['Do not widen scope or edit version pins.'], ...extra };
}
function markdownTitles(root) {
  const titles = new Set();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.name.endsWith('.md')) titles.add(entry.name.slice(0, -3));
    }
  }
  return titles;
}
function emittedLinksResolve(raw, root) {
  const titles = markdownTitles(root);
  return [...raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].every((match) => titles.has(path.basename(match[1], '.md')));
}
function findTaskFile(root, title) {
  const wanted = `${title}.md`;
  const stack = [path.join(root, 'tasks')];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.name === wanted) return item;
    }
  }
  return null;
}
function tempCase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-intake-'));
  try {
    fs.writeFileSync(path.join(dir, 'board.md'), board());
    fs.writeFileSync(path.join(dir, 'Roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(path.join(dir, 'Loop System with Codex.md'), '# Loop System with Codex\n');
    for (const [file, lines] of [['platform/example.js', 20], ['platform/helper.js', 100], ['platform/blueprints/x/manifest.json', 30], ['package.json', 100]]) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n'));
    }
    fs.mkdirSync(path.join(dir, 'tasks', 'Prerequisite'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', 'Prerequisite', 'Prerequisite.md'), '---\nstatus: completed\n---\n');
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    ok(!fs.existsSync(dir), 'temporary fixture cleaned');
  }
}

function validateSkillSurface() {
  console.log('\n--- skill metadata and surface registration ---');
  const codexSkill = path.join(ROOT, '.agents/skills/card-intake/SKILL.md');
  const claudeSkill = path.join(ROOT, 'platform/mechanisms/platform-claude/skills/card-intake/SKILL.md');
  const command = path.join(ROOT, 'platform/mechanisms/platform-claude/commands/card-intake.md');
  const metadata = path.join(ROOT, '.agents/skills/card-intake/agents/openai.yaml');
  for (const file of [codexSkill, claudeSkill, command, metadata]) ok(fs.existsSync(file), `${path.relative(ROOT, file)} exists`);
  for (const file of [codexSkill, claudeSkill]) {
    const body = fs.readFileSync(file, 'utf8');
    ok(/^---\nname: card-intake\ndescription: .+\n---/s.test(body), `${path.relative(ROOT, file)} has valid frontmatter`);
    ok(Buffer.byteLength(body) < 8192, `${path.relative(ROOT, file)} stays under 8 KB`);
    ok(body.includes('[[Loop System with Codex]]'), `${path.relative(ROOT, file)} links the execution contract`);
    ok(/Delivery public contract|delivery\/index\.js/.test(body), `${path.relative(ROOT, file)} routes authoring through the Delivery public contract`);
  }
  ok(fs.readFileSync(metadata, 'utf8').includes('default_prompt: "Use $card-intake'), 'openai.yaml names $card-intake');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/mechanisms/platform-claude/manifest.json'), 'utf8'));
  ok(manifest.claude_surface.some((e) => e.kind === 'command' && e.dest === '.claude/commands/card-intake.md'), 'manifest registers command');
  ok(manifest.claude_surface.some((e) => e.kind === 'skill' && e.dest === '{{skills_dir}}/card-intake/SKILL.md'), 'manifest registers skill');
  ok(manifest.claude_surface.some((e) => e.kind === 'claude_md_row' && e.table === 'resolvers' && e.row.command === '/card-intake'), 'manifest registers resolver');
  ok(manifest.claude_surface.some((e) => e.kind === 'claude_md_row' && e.table === 'skills-index' && e.row.command === '/card-intake'), 'manifest registers skills index');
}

function sharedDeliveryFixtures() {
  console.log('\n--- shared Delivery fixture corpus ---');
  const fixtureCard = (fixture) => {
    const card = JSON.parse(JSON.stringify(delivery.registry.fixtures.base_execution_card));
    Object.assign(card, fixture.patch || {});
    for (const key of fixture.remove || []) delete card[key];
    return card;
  };
  for (const fixture of delivery.registry.fixtures.valid) {
    const verdict = validateDeliveryContract(fixtureCard(fixture), fixture.mode || 'current');
    ok(verdict.ok, `card intake accepts shared valid fixture: ${fixture.name}`);
  }
  for (const fixture of delivery.registry.fixtures.invalid) {
    const verdict = validateDeliveryContract(fixtureCard(fixture), fixture.mode || 'current');
    ok(!verdict.ok && verdict.errors.some((error) => error.code === fixture.expected_error),
      `card intake refuses shared invalid fixture: ${fixture.name}`);
  }
}

function localizedBug() {
  console.log('\n--- forward fixture: localized bug with evidence ---');
  tempCase((dir) => {
    const card = execution('BUG-1 Localized cold-load guard', { lane: 'Discovered (autoloop)' });
    const spec = base(dir, { classification: 'bug', outcome: 'Prevent the localized cold-load crash.', reproduction: 'Open the packing checkbox in a cold vault and observe the null dereference.', evidence: [{ path: 'platform/helper.js', line: 86, note: 'unguarded dereference', source_identity: 'fixture repo', captured_at: '2026-07-15T12:00:00-06:00', revision: 'fixture-revision', claim: 'The helper dereferences a missing value.' }], cards: [card] });
    eq(run(spec, false).result, 'awaiting_user_decision', 'bug dry-run routes to triage posture');
    ok(run(spec, true).ok, 'bug fixture applies');
    const raw = fs.readFileSync(path.join(dir, 'tasks', card.title, `${card.title}.md`), 'utf8');
    ok(raw.includes('kanban_column: "Discovered (autoloop)"'), 'bug metadata records lane');
    ok(raw.includes('`platform/helper.js:86`'), 'bug preserves reproduction evidence');
    ok(raw.includes(`schema_version: "${delivery.CONTRACT_VERSION}"`) && raw.includes('batch_policy: continue'), 'new execution card stamps the current Delivery contract and derived policy');
    const prepared = prepareDeliveryCard(raw, card.title);
    ok(prepared.ok && prepared.source === 'current' && prepared.card.evidence[0].revision === 'fixture-revision', 'rendered card round-trips through the shared current contract');
    ok(emittedLinksResolve(raw, dir), 'every emitted bug-card wikilink resolves');
    ok(!run({ ...spec, reproduction: '' }, false).ok, 'bug without reproduction is refused');
    delete spec.created_at;
    ok(run(spec, true).no_op, 'repeat bug intake is idempotent without restating generated created_at');
  });
}

function roadmapTheme() {
  console.log('\n--- forward fixture: broad finish-blueprint roadmap ---');
  tempCase((dir) => {
    const parent1 = { title: 'RM-1 Blueprint X safety', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const child1 = execution('RM-1a Blueprint X safety harness', { parent_title: parent1.title, slice: 'RM-1a', depends_on: ['[[Prerequisite]]'] });
    const parent2 = { title: 'RM-2 Blueprint X polish', role: 'parent', lane: 'Post-GA', status: 'planning', depends_on: ['[[RM-1 Blueprint X safety]]'] };
    const spec = base(dir, { mode: 'roadmap', classification: 'roadmap_theme', outcome: 'Finish Blueprint X through dependency-ordered safety and polish parents.', evidence: [{ path: 'platform/blueprints/x/manifest.json', line: 1, source_identity: 'fixture repo', captured_at: '2026-07-15T12:00:00-06:00', revision: 'fixture-revision', claim: 'The blueprint manifest establishes the implementation surface.' }], cards: [parent1, child1, parent2], roadmap_path: path.join(dir, 'docs', 'roadmap', 'Blueprint X.md'), roadmap_key: 'blueprint-x', roadmap_section: '## Blueprint X plan\n\n1. Safety\n2. Polish' });
    const result = run(spec, true);
    ok(result.ok && result.result === 'awaiting_user_decision' && result.candidate_card === child1.title && result.eligibility_dry_run_required, 'roadmap identifies a candidate but defers eligibility to coordinator');
    ok(fs.existsSync(path.join(dir, 'tasks', parent1.title, child1.title, `${child1.title}.md`)), 'first child is nested');
    eq(fs.readdirSync(path.join(dir, 'tasks', parent2.title)).sort(), [`${parent2.title}.md`], 'later parent remains undecomposed');
    ok(fs.readFileSync(path.join(dir, 'tasks', parent2.title, `${parent2.title}.md`), 'utf8').includes('kanban_column: "Post-GA"'), 'later roadmap parent respects Post-GA placement');
    const boardRaw = fs.readFileSync(spec.board_path, 'utf8');
    ok(boardRaw.indexOf(parent1.title) < boardRaw.indexOf(parent2.title), 'board preserves dependency order');
    ok(boardRaw.includes(`decomposed → [[${child1.title}]]`), 'parent annotation names child');
    const childRaw = fs.readFileSync(path.join(dir, 'tasks', parent1.title, child1.title, `${child1.title}.md`), 'utf8');
    const parentRaw = fs.readFileSync(path.join(dir, 'tasks', parent1.title, `${parent1.title}.md`), 'utf8');
    ok(emittedLinksResolve(`${boardRaw}\n${parentRaw}\n${childRaw}`, dir), 'every emitted roadmap/card wikilink resolves');
    eq(parseDependsOn(childRaw), ['Prerequisite'], 'dependency parser accepts emitted wikilink list');
    const selected = selectClaimCandidate({ boardMd: boardRaw, state: { cards: {} }, loadCard: (title) => {
      const file = [path.join(dir, 'tasks', parent1.title, child1.title, `${title}.md`), path.join(dir, 'tasks', title, `${title}.md`)].find(fs.existsSync);
      return file ? { path: file, raw: fs.readFileSync(file, 'utf8') } : null;
    } });
    eq(selected.card, child1.title, 'release dry-run selects child');
    for (const match of boardRaw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const title = match[1];
      const candidates = [
        path.join(dir, 'tasks', title, `${title}.md`),
        path.join(dir, 'tasks', parent1.title, title, `${title}.md`),
      ];
      ok(candidates.some(fs.existsSync), `board wikilink resolves: ${title}`);
    }
    ok(fs.readFileSync(spec.roadmap_path, 'utf8').includes('<!-- card-intake:blueprint-x BEGIN -->'), 'roadmap has stable marker');
    ok(run(spec, true).no_op, 'repeat roadmap intake is idempotent');
  });
}

function singleParentChildren() {
  console.log('\n--- single-card depth: large parent with children ---');
  tempCase((dir) => {
    const parent = { title: 'LARGE-1 Parent requirement', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const child = execution('LARGE-1a First releasable slice', { parent_title: parent.title, slice: 'LARGE-1a' });
    const spec = base(dir, { classification: 'parent_children', outcome: 'Split the large requirement into releasable execution work.', cards: [parent, child] });
    const result = run(spec, true);
    ok(result.ok && result.candidate_card === child.title && result.eligibility_dry_run_required, 'large single-card intake prepares an exact coordinator candidate');
    ok(fs.existsSync(path.join(dir, 'tasks', parent.title, child.title, `${child.title}.md`)), 'large requirement child is nested');
    ok(!fs.readFileSync(path.join(dir, 'tasks', parent.title, `${parent.title}.md`), 'utf8').includes('model_profile:'), 'large requirement parent remains non-claimable');
  });
}

function docsOnly() {
  console.log('\n--- forward fixture: docs-only requirement ---');
  tempCase((dir) => {
    const card = execution('DOC-1 Clarify guide', { lane: 'Docs Only', execution_mode: 'docs_only', release_required: false, deployment_required: false });
    delete card.deploy_subscriptions;
    const spec = base(dir, { classification: 'direct_execution', completion_mode: 'docs_only', outcome: 'Clarify the operator guide without a release.', cards: [card] });
    eq(run(spec, true).result, 'docs_only', 'docs-only result is explicit');
    const boardRaw = fs.readFileSync(spec.board_path, 'utf8');
    ok(boardRaw.includes('## Docs Only'), 'Docs Only lane is created');
    ok(selectCard({ boardMd: boardRaw, loadBody: () => '' }).card !== card.title, 'release selector cannot claim docs-only card');
    const raw = fs.readFileSync(path.join(dir, 'tasks', card.title, `${card.title}.md`), 'utf8');
    ok(raw.includes('release_required: false') && raw.includes('deployment_required: false'), 'docs-only flags materialize');
    ok(prepareDeliveryCard(raw, card.title).ok, 'docs-only intake also round-trips through the complete Delivery contract');
    delete spec.created_at;
    ok(run(spec, true).no_op, 'repeat docs-only intake preserves generated created_at and is idempotent');
  });
}

function missingEvidenceAndRefusals() {
  console.log('\n--- forward fixture: missing evidence and refusals ---');
  tempCase((dir) => {
    const direct = execution('DIRECT-1 Small requirement', { depends_on: ['[[Prerequisite]]'], context_pack: 'Docs/direct-context.md' });
    const directSpec = base(dir, { cards: [direct] });
    const directResult = run(directSpec, true);
    ok(directResult.ok && directResult.result === 'awaiting_user_decision' && directResult.candidate_card === direct.title, 'small direct requirement defers claimability to coordinator');
    const directRaw = fs.readFileSync(path.join(dir, 'tasks', direct.title, `${direct.title}.md`), 'utf8');
    ok(directRaw.includes('model_profile: standard') && directRaw.includes('deploy_subscriptions:') && directRaw.includes('touch_zones:')
      && directRaw.includes('context_pack: "Docs/direct-context.md"'), 'direct execution metadata is complete, including optional context_pack');
    const directSelected = selectClaimCandidate({ boardMd: fs.readFileSync(directSpec.board_path, 'utf8'), state: { cards: {} }, loadCard: (title) => {
      const file = findTaskFile(dir, title);
      return file ? { path: file, raw: fs.readFileSync(file, 'utf8') } : null;
    } });
    eq(directSelected.card, direct.title, 'authoritative coordinator dry-run makes the direct card claimable');
    const scout = run(base(dir, { evidence: [], scout_artifact: 'Scout Blueprint X scope', cards: [] }), false);
    ok(scout.ok && scout.result === 'awaiting_user_decision' && scout.changed_paths.length === 0, 'missing evidence yields scout posture without writes');
    fs.writeFileSync(path.join(dir, 'GA Research — Blueprint X.md'), '# Research\n\nEvidence: `package.json:74`.\n');
    const researchSpec = base(dir, { evidence: [], evidence_claims: [{ source_identity: 'GA Research — Blueprint X', captured_at: '2026-07-15T12:00:00-06:00', revision: 'fixture-research-revision', locator: 'GA Research — Blueprint X.md:3', claim: 'The research artifact pins the package evidence.' }], research_artifact: 'GA Research — Blueprint X', cards: [execution('RESEARCH-1 Supported execution')] });
    const research = run(researchSpec, true);
    ok(research.ok && research.candidate_card === 'RESEARCH-1 Supported execution', 'resolved research artifact with path:line evidence can support candidate work');
    ok(emittedLinksResolve(fs.readFileSync(findTaskFile(dir, 'RESEARCH-1 Supported execution'), 'utf8'), dir), 'research-backed card emits only resolved wikilinks');
    ok(!run(base(dir, { evidence: [], research_artifact: 'Missing research', cards: [execution('BAD Missing research')] }), false).ok, 'missing research artifact is refused');
    fs.writeFileSync(path.join(dir, 'Empty research.md'), '# Research without evidence\n');
    ok(!run(base(dir, { evidence: [], research_artifact: 'Empty research', cards: [execution('BAD Empty research')] }), false).ok, 'research artifact without path:line evidence is refused');
    ok(!run(base(dir, { evidence: [], cards: [execution('BAD Evidence-free execution')] }), false).ok, 'evidence-free execution is refused');
    ok(!run(base(dir, { evidence: [{ path: 'platform/no-such-file.js', line: 1 }], cards: [execution('BAD Missing evidence file')] }), false).ok, 'nonexistent direct evidence file is refused');
    ok(!run(base(dir, { evidence: [{ path: 'platform/example.js', line: 999 }], cards: [execution('BAD Evidence line')] }), false).ok, 'out-of-range evidence line is refused');
    fs.writeFileSync(path.join(dir, 'board.md'), board().replace('## In Progress\n', '## In Progress\n\n- [ ] [[LIVE Active card]]\n'));
    ok(!run(base(dir, { cards: [execution('LIVE Active card')] }), false).ok, 'In Progress card is immutable');
    fs.writeFileSync(path.join(dir, 'board.md'), board().replace('## Parked\n', '## Parked\n\n- [ ] [[PARKED Board-only card]]\n'));
    ok(!run(base(dir, { cards: [execution('PARKED Board-only card')] }), false).ok, 'board-lane parked card is immutable without loading its note');
    ok(!run(base(dir, { cards: [execution('BAD Invented lane', { lane: 'Made Up' })] }), false).ok, 'invented board lane is refused');
    ok(run(base(dir, { cards: [execution('ALIAS Status', { status: 'in-planning' })] }), false).ok, 'shared historical status alias is normalized');
    ok(!run(base(dir, { cards: [execution('BAD Status', { status: 'almost-done' })] }), false).ok, 'unknown status is refused');
    ok(!run(base(dir, { cards: [execution('BAD Empty schema', { schema_version: '' })] }), false).ok, 'explicitly empty schema version is not defaulted');
    ok(!run(base(dir, { cards: [execution('BAD Policy', { batch_policy: 'continue garbage' })] }), false).ok, 'unknown authored batch policy is not replaced by derivation');
    ok(!run(base(dir, { cards: [execution('BAD Null deployment', { deploy_subscriptions: null })] }), false).ok, 'explicitly null deployment map is not defaulted');
    ok(!run(base(dir, { cards: [execution('BAD Empty execution mode', { execution_mode: '' })] }), false).ok, 'explicitly empty execution mode is not defaulted');
    const badMap = execution('BAD Map'); delete badMap.deploy_subscriptions.ero;
    ok(!run(base(dir, { cards: [badMap] }), false).ok, 'missing deployment map is refused');
    const gaException = base(dir, { classification: 'ga_exception', cards: [execution('GA-EX-1 Approved exception')], ga_exception_path: path.join(dir, 'docs', 'roadmap', 'Priorities for GA.md'), ga_exception_section: '## Approved exception\n\nGA-EX-1 is allowed.' });
    const exceptionResult = run(gaException, true);
    ok(exceptionResult.ok && fs.readFileSync(gaException.ga_exception_path, 'utf8').includes('Approved exception'), 'GA exception is recorded in Priorities');
    for (const status of ['planning', 'in_progress', 'blocked', 'parked', 'completed']) {
      ok(run(base(dir, { cards: [execution(`ENUM ${status}`, { status })] }), false).ok, `normalized status accepted: ${status}`);
    }
    const wrongModel = execution('BAD Risk profile', { risk_flags: ['loader'], model_profile: 'standard' });
    ok(!run(base(dir, { cards: [wrongModel] }), false).ok, 'risk rules refuse wrong model profile');
    const parkedTitle = 'PARKED Existing';
    fs.mkdirSync(path.join(dir, 'tasks', parkedTitle), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', parkedTitle, `${parkedTitle}.md`), '---\nstatus: parked\n---\n');
    ok(!run(base(dir, { cards: [execution(parkedTitle)] }), false).ok, 'parked card is immutable');
    const parent1 = { title: 'P1', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const parent2 = { title: 'P2', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const child2 = execution('P2a', { parent_title: 'P2', slice: 'P2a' });
    ok(!run(base(dir, { mode: 'roadmap', classification: 'roadmap_theme', roadmap_path: path.join(dir, 'r.md'), roadmap_section: 'x', cards: [parent1, parent2, child2] }), false).ok, 'later-parent decomposition is refused');
    ok(!run(base(dir, { mode: 'roadmap', classification: 'roadmap_theme', roadmap_path: path.join(dir, 'empty-lookahead.md'), roadmap_section: 'x', cards: [parent1] }), false).ok, 'In Planning roadmap parent without a prepared child is refused');
    const duplicateParent = { title: 'DUPLICATE Identity', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const duplicateChild = execution('DUPLICATE Identity', { parent_title: 'DUPLICATE Identity', slice: 'DUP-1a' });
    ok(!run(base(dir, { classification: 'parent_children', cards: [duplicateParent, duplicateChild] }), false).ok, 'duplicate parent and child titles are refused');
    ok(!run(base(dir, { cards: [execution('BAD Missing dependency', { depends_on: ['[[Does not exist]]'] })] }), false).ok, 'unresolved dependency is refused');
    ok(run(base(dir, { classification: 'post_ga', cards: [{ title: 'LATER Parent', role: 'parent', lane: 'Post-GA', status: 'planning', depends_on: [] }] }), false).ok, 'Post-GA remains an undecomposed parent');
    ok(!run(base(dir, { cards: [execution('../ESCAPE')] }), false).ok, 'path-traversing card title is refused');
    ok(!run(base(dir, { project_root: path.dirname(dir), cards: [execution('BAD Broad root')] }), false).ok, 'project root broader than the board directory is refused');
    ok(!run(base(dir, { cards: [execution('BAD Phantom existing', { existing: true })] }), false).ok, 'nonexistent card cannot be declared existing');
    ok(!run(base(dir, { cards: [execution(direct.title, { existing: true })] }), false).ok, 'existing execution cards cannot be silently rewritten');
    const existingDep = 'DEP Existing prerequisite';
    fs.mkdirSync(path.join(dir, 'tasks', existingDep), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', existingDep, `${existingDep}.md`), '---\nstatus: planning\n---\n');
    fs.writeFileSync(path.join(dir, 'board.md'), board().replace('## In Planning\n', `## In Planning\n\n- [ ] [[${existingDep}]]\n`));
    const ordered = execution('ORDER New dependent', { depends_on: [`[[${existingDep}]]`] });
    ok(run(base(dir, { cards: [ordered] }), true).ok, 'dependent card applies against existing prerequisite');
    const orderedBoard = fs.readFileSync(path.join(dir, 'board.md'), 'utf8');
    ok(orderedBoard.indexOf(existingDep) < orderedBoard.indexOf(ordered.title), 'new dependent is inserted after existing prerequisite');
    const promotedParent = 'RM Existing Post-GA parent';
    fs.mkdirSync(path.join(dir, 'tasks', promotedParent), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', promotedParent, `${promotedParent}.md`), `---\nkanban_column: "Post-GA"\nstatus: planning\ndepends_on:\n  []\n---\n\n# ${promotedParent}\n`);
    fs.writeFileSync(path.join(dir, 'board.md'), board().replace('## In Planning\n', `## In Planning\n\n- [ ] [[${existingDep}]]\n`).replace('## Post-GA\n', `## Post-GA\n\n- [ ] [[${promotedParent}]]\n`));
    const promoted = { title: promotedParent, role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [`[[${existingDep}]]`], existing: true };
    const promotedChild = execution('RM Existing first child', { parent_title: promotedParent, slice: 'RM-Xa' });
    const promotionSpec = base(dir, { mode: 'roadmap', classification: 'roadmap_theme', cards: [promoted, promotedChild], roadmap_path: path.join(dir, 'promoted-roadmap.md'), roadmap_section: '## Promoted parent\n\nPrepare the next slice.' });
    ok(run(promotionSpec, true).ok, 'existing Post-GA parent promotes when it becomes the lookahead');
    const promotedBoard = fs.readFileSync(path.join(dir, 'board.md'), 'utf8');
    ok(promotedBoard.indexOf(existingDep) < promotedBoard.indexOf(promotedParent) && promotedBoard.indexOf(promotedParent) < promotedBoard.indexOf(promotedChild.title) && (promotedBoard.match(new RegExp(promotedParent, 'g')) || []).length === 1, 'promoted parent and child follow the existing prerequisite exactly once');
    const promotedRaw = fs.readFileSync(path.join(dir, 'tasks', promotedParent, `${promotedParent}.md`), 'utf8');
    ok(promotedRaw.includes('kanban_column: "In Planning"') && promotedRaw.includes(`- "[[${existingDep}]]"`), 'promoted parent lane and dependency metadata update atomically');
    ok(run(promotionSpec, true).no_op, 'repeat parent promotion intake is idempotent');
    ok(!run(base(dir, { roadmap_path: path.join(dir, '..', 'outside.md'), mode: 'roadmap', classification: 'roadmap_theme', roadmap_section: 'x', cards: [parent1] }), false).ok, 'roadmap path outside project root is refused');
    ok(!run(base(dir, { classification: 'roadmap_theme', cards: [parent1] }), false).ok, 'roadmap theme in single mode is refused');
    ok(!run(base(dir, { classification: 'ga_exception', ga_exception_path: path.join(dir, 'Priorities for GA.md'), ga_exception_section: 'x', cards: [execution('GA BAD 1'), execution('GA BAD 2')] }), false).ok, 'GA exception with unrelated roots is refused');
  });
}

function cutoverEpicIntake() {
  console.log('\n--- BGD-CUTOVER fixtures: epic-native intake ---');
  tempCase((dir) => {
    const enabledStatus = () => ({ action: 'status', cutover: { enabled: true, enabled_at: '2026-07-25T19:00:00.000Z' } });
    const runEnabled = (spec, apply = false) => run(spec, apply, { readCoordinatorStatus: enabledStatus });
    const legacySpec = base(dir, { cards: [execution('CUT-PRE Legacy flat card')] });
    const legacyAbsent = run(legacySpec, false, { readCoordinatorStatus: () => ({ action: 'status', cutover: null }) });
    const legacyOff = run(legacySpec, false, { readCoordinatorStatus: () => ({ action: 'status', cutover: { enabled: false, reason: 'fixture' } }) });
    eq(legacyOff, legacyAbsent, 'BGD-CUTOVER-PRE-COMPAT absent and disabled cutover preserve the exact legacy intake receipt');
    const existingEpic = 'Existing Epic';
    const existingRoot = path.join(dir, 'tasks', existingEpic);
    const existingBoardPath = path.join(existingRoot, 'board', `${existingEpic}-board.md`);
    fs.mkdirSync(path.dirname(existingBoardPath), { recursive: true });
    fs.writeFileSync(path.join(existingRoot, `${existingEpic}.md`), [
      '---', 'type: epic', 'schema_version: 1.1.0',
      `epic_board: "project/tasks/${existingEpic}/board/${existingEpic}-board.md"`,
      '---', '',
    ].join('\n'));
    fs.writeFileSync(existingBoardPath, [
      '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic',
      `epic: "[[${existingEpic}]]"`, '---', '',
      '## In Planning', '', '## In Progress', '', '## Blocked', '', '## Completed', '',
    ].join('\n'));

    let statusReads = 0;
    const direct = execution('CUT-1 Existing epic slice', {
      model_profile: 'heavy', risk_flags: ['loader'],
    });
    const directSpec = base(dir, { epic: `[[${existingEpic}]]`, cards: [direct] });
    const parentBefore = fs.readFileSync(directSpec.board_path, 'utf8');
    const directResult = run(directSpec, true, {
      readCoordinatorStatus: () => {
        statusReads += 1;
        return enabledStatus();
      },
    });
    ok(directResult.ok && directResult.cutover_enabled === true, 'BGD-CUTOVER-EPIC-INTAKE-ROUTING reads enabled cutover and applies');
    eq(statusReads, 1, 'BGD-CUTOVER-EPIC-INTAKE-ROUTING reads installed status exactly once per planning pass');
    const directPath = path.join(existingRoot, 'board', `${direct.title}.md`);
    eq(directResult.changed_paths.sort(), [directPath, existingBoardPath].sort(), 'BGD-CUTOVER-EPIC-INTAKE-ROUTING changes only the epic slice and epic board');
    const directRaw = fs.readFileSync(directPath, 'utf8');
    ok(/^type: slice$/m.test(directRaw)
      && new RegExp(`^epic: "\\[\\[${existingEpic}\\]\\]"$`, 'm').test(directRaw)
      && new RegExp(`^task_parent: "project/tasks/${existingEpic}/${existingEpic}\\.md"$`, 'm').test(directRaw)
      && new RegExp(`^source_board: "project/tasks/${existingEpic}/board/${existingEpic}-board\\.md"$`, 'm').test(directRaw)
      && new RegExp(`^kanban_board: "project/tasks/${existingEpic}/board/${existingEpic}-board\\.md"$`, 'm').test(directRaw),
    'BGD-CUTOVER-EPIC-INTAKE-ROUTING emits exact slice type and epic/atlas/board backlinks');
    eq(fs.readFileSync(directSpec.board_path, 'utf8'), parentBefore, 'BGD-CUTOVER-PARENT-BOARD-PRESERVED leaves the parent board byte-identical');
    ok(fs.readFileSync(existingBoardPath, 'utf8').includes(`[[${direct.title}]]`), 'BGD-CUTOVER-EPIC-INTAKE-ROUTING inserts the slice on its epic board');
    ok(runEnabled(directSpec, true).no_op, 'BGD-CUTOVER-EPIC-INTAKE-ROUTING literal existing-epic replay is no_op');

    const flatTitle = 'GA-OPS13a Close epic cutover selector and intake deadlock';
    const flatSpec = base(dir, { epic: null, cards: [execution(flatTitle, { model_profile: 'heavy', risk_flags: ['loader'] })] });
    const flatBoardBefore = fs.readFileSync(flatSpec.board_path, 'utf8');
    const flatRefused = runEnabled(flatSpec, true);
    ok(!flatRefused.ok && (flatRefused.errors || []).some((error) => error.includes('post-cutover execution intake requires one named epic')),
      'BGD-CUTOVER-FLAT-REFUSAL refuses a post-cutover heavy flat execution card, including a fresh bootstrap-named card');
    ok(!fs.existsSync(path.join(dir, 'tasks', flatTitle)) && fs.readFileSync(flatSpec.board_path, 'utf8') === flatBoardBefore,
      'BGD-CUTOVER-ONE-SHOT-BOOTSTRAP flat refusal happens before any card or board write and has no name bypass');

    const triage = execution('BUG-CUT One-line triage', {
      lane: 'Discovered (autoloop)', model_profile: 'standard',
    });
    const triageSpec = base(dir, {
      classification: 'bug', outcome: 'Record one bounded post-cutover finding.',
      reproduction: 'Open the fixture and observe the bounded finding.', cards: [triage],
    });
    const triageResult = runEnabled(triageSpec, true);
    ok(triageResult.ok && fs.existsSync(path.join(dir, 'tasks', triage.title, `${triage.title}.md`)),
      'BGD-CUTOVER-FLAT-REFUSAL preserves the explicit Discovered one-line triage path');

    const parent = { title: 'New Theme Epic', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const child = execution('NEW-1 First epic slice', { parent_title: parent.title, slice: 'NEW-1' });
    const roadmapSpec = base(dir, {
      mode: 'roadmap', classification: 'roadmap_theme', epic: '[[Roadmap]]',
      outcome: 'Create a new canonical epic theme and prepare its first slice.',
      cards: [parent, child],
      roadmap_path: path.join(dir, 'docs', 'roadmap', 'New Theme.md'),
      roadmap_key: 'new-theme',
      roadmap_section: '## New Theme\n\nPrepare the first bounded slice.',
    });
    const roadmapResult = runEnabled(roadmapSpec, true);
    ok(roadmapResult.ok, 'BGD-CUTOVER-NEW-EPIC-SCAFFOLD applies the post-cutover roadmap theme');
    const newRoot = path.join(dir, 'tasks', parent.title);
    const expectedSurface = [
      `${parent.title}.md`,
      `board/${parent.title}-board.md`,
      `board/${child.title}.md`,
      'context/pack.md',
      'context/runs/.keep',
      'context/lessons/.keep',
      'context/decisions/.keep',
    ].sort();
    eq(fileListForTest(newRoot), expectedSurface, 'BGD-CUTOVER-NEW-EPIC-SCAFFOLD creates exactly the canonical atlas/board/context/slice file set');
    ok(canonicalEpicSurface(roadmapSpec, parent.title).ok, 'BGD-CUTOVER-NEW-EPIC-SCAFFOLD creates a resolver-conformant epic pair');
    const newParentBoard = fs.readFileSync(roadmapSpec.board_path, 'utf8');
    const newEpicBoard = fs.readFileSync(path.join(newRoot, 'board', `${parent.title}-board.md`), 'utf8');
    ok(newParentBoard.includes(`[[${parent.title}]]`) && !newParentBoard.includes(`[[${child.title}]]`)
      && newEpicBoard.includes(`[[${child.title}]]`),
    'BGD-CUTOVER-NEW-EPIC-SCAFFOLD adds only the atlas line to the parent board and the slice line to the epic board');
    ok(/^[a-f0-9]{64}$/.test((fs.readFileSync(path.join(newRoot, 'context', 'pack.md'), 'utf8').match(/^content_sha256:\s*(.+)$/m) || [])[1] || ''),
      'BGD-CUTOVER-NEW-EPIC-SCAFFOLD context pack carries a deterministic content hash');
    ok(runEnabled(roadmapSpec, true).no_op, 'BGD-CUTOVER-NEW-EPIC-SCAFFOLD literal replay is no_op');

    const corruptParent = { title: 'Corrupt Theme Epic', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const corruptChild = execution('CORRUPT-1 Slice', { parent_title: corruptParent.title, slice: 'CORRUPT-1' });
    const corruptSpec = base(dir, {
      mode: 'roadmap', classification: 'roadmap_theme',
      outcome: 'Prove corrupt partial scaffold bytes fail closed.',
      cards: [corruptParent, corruptChild],
      roadmap_path: path.join(dir, 'docs', 'roadmap', 'Corrupt Theme.md'),
      roadmap_section: '## Corrupt Theme\n\nMust fail closed.',
    });
    const corruptRoot = path.join(dir, 'tasks', corruptParent.title);
    fs.mkdirSync(corruptRoot, { recursive: true });
    fs.writeFileSync(path.join(corruptRoot, `${corruptParent.title}.md`), 'unexpected bytes\n');
    const corruptBoardBefore = fs.readFileSync(corruptSpec.board_path, 'utf8');
    const corruptResult = runEnabled(corruptSpec, true);
    ok(!corruptResult.ok && (corruptResult.errors || []).some((error) => error.includes('unexpected pre-existing bytes')),
      'BGD-CUTOVER-NEW-EPIC-SCAFFOLD unexpected pre-existing scaffold bytes refuse');
    eq(fs.readFileSync(corruptSpec.board_path, 'utf8'), corruptBoardBefore,
      'BGD-CUTOVER-NEW-EPIC-SCAFFOLD scaffold refusal occurs before parent-board mutation');

    const statusFailureBoard = fs.readFileSync(corruptSpec.board_path, 'utf8');
    const statusFailure = runCardIntake(base(dir, { cards: [execution('CUT Status unreadable')] }), true, {
      readCoordinatorStatus: () => { throw new Error('fixture status failure'); },
    });
    ok(!statusFailure.ok && statusFailure.errors[0].includes('fresh installed coordinator status failed'),
      'BGD-CUTOVER-EPIC-INTAKE-ROUTING installed-status failure refuses planning');
    eq(fs.readFileSync(corruptSpec.board_path, 'utf8'), statusFailureBoard,
      'BGD-CUTOVER-EPIC-INTAKE-ROUTING installed-status refusal performs zero board writes');
  });
}

function fileListForTest(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else files.push(path.relative(root, item).replace(/\\/g, '/'));
    }
  }
  return files.sort();
}

function supersedeGovernance() {
  console.log('\n--- BGR fixtures: supersede finding-coverage + discard-at-mint ---');
  tempCase((dir) => {
    const successor = (extra = {}) => execution('SUP-1 Successor card', { supersedes: 'X Legacy card', carried_findings: ['F1', 'F2'], binding_fixtures: [{ name: 'replay F1 crash', description: 'binds finding F1 as a regression fixture' }, 'F2 guard stays enforced'], ...extra });

    const uncovered = successor({ binding_fixtures: [{ name: 'replay F1 crash', description: 'binds finding F1 only' }] });
    const refused = run(base(dir, { cards: [uncovered] }), true);
    ok(!refused.ok && (refused.errors || []).some((error) => error.includes('supersede_coverage_missing') && /(^|[^A-Za-z0-9_])F2([^A-Za-z0-9_]|$)/.test(error)), 'BGR-INTAKE-SUPERSEDE-COVERAGE: uncovered carried finding refuses with machine-readable error naming F2');
    ok((refused.errors || []).every((error) => !error.includes('supersede_coverage_missing') || !error.endsWith(': F1')), 'BGR-INTAKE-SUPERSEDE-COVERAGE: covered finding F1 is not reported uncovered');
    ok(!fs.existsSync(path.join(dir, 'tasks', uncovered.title)) && !fs.readFileSync(path.join(dir, 'board.md'), 'utf8').includes(uncovered.title), 'BGR-INTAKE-SUPERSEDE-COVERAGE: refusal happens before any write');

    const spec = base(dir, { cards: [successor()] });
    const applied = run(spec, true);
    ok(applied.ok && applied.applied === true, 'BGR-INTAKE-SUPERSEDE-DISCARDS: valid superseding spec applies');
    eq(applied.post_apply_instructions, [{ discard: { card: 'X Legacy card', superseded_by: 'SUP-1 Successor card' } }], 'BGR-INTAKE-SUPERSEDE-DISCARDS: apply receipt instructs predecessor discard without touching coordinator state');
    const raw = fs.readFileSync(findTaskFile(dir, 'SUP-1 Successor card') || path.join(dir, 'missing.md'), 'utf8');
    ok(raw.includes('supersedes: "X Legacy card"') && raw.includes('carried_findings: ["F1","F2"]') && raw.includes('binding_fixtures:'), 'BGR-INTAKE-SUPERSEDE-DISCARDS: supersede metadata materializes on the card note');

    const replay = run(spec, true);
    ok(replay.ok && replay.no_op === true, 'BGR-INTAKE-SUPERSEDE-NOOP: literal replay of the applied superseding spec is a no_op');
    const changed = run(base(dir, { cards: [successor({ carried_findings: ['F1'], binding_fixtures: ['replay F1 crash fixture'] })] }), true);
    ok(changed.ok === false && changed.no_op !== true, 'BGR-INTAKE-SUPERSEDE-NOOP: changed carried_findings list is NOT a no_op');

    const noFindings = successor({ title: 'SUP-2 No findings' });
    delete noFindings.carried_findings;
    const noFindingsResult = run(base(dir, { cards: [noFindings] }), false);
    ok(!noFindingsResult.ok && (noFindingsResult.errors || []).some((error) => error.includes('supersede_missing_fields') && error.includes('carried_findings')), 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: supersedes without carried_findings is refused machine-readably');
    const emptyFindingsResult = run(base(dir, { cards: [successor({ title: 'SUP-3 Empty findings', carried_findings: [] })] }), false);
    ok(!emptyFindingsResult.ok && (emptyFindingsResult.errors || []).some((error) => error.includes('supersede_missing_fields') && error.includes('carried_findings')), 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: carried_findings: [] is refused (superseding with zero findings is a contradiction)');
    const noFixtures = successor({ title: 'SUP-4 No fixtures' });
    delete noFixtures.binding_fixtures;
    const noFixturesResult = run(base(dir, { cards: [noFixtures] }), false);
    ok(!noFixturesResult.ok && (noFixturesResult.errors || []).some((error) => error.includes('supersede_missing_fields') && error.includes('binding_fixtures')), 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: supersedes without binding_fixtures is refused machine-readably');
    const emptyFixturesResult = run(base(dir, { cards: [successor({ title: 'SUP-5 Empty fixtures', binding_fixtures: [] })] }), false);
    ok(!emptyFixturesResult.ok && (emptyFixturesResult.errors || []).some((error) => error.includes('supersede_missing_fields') && error.includes('binding_fixtures')), 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: binding_fixtures: [] is refused machine-readably');
    const danglingFindings = execution('SUP-7 Findings without supersedes', { carried_findings: ['F1'] });
    const danglingResult = run(base(dir, { cards: [danglingFindings] }), false);
    ok(!danglingResult.ok && (danglingResult.errors || []).some((error) => error.includes('supersede_invalid')), 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: carried_findings without supersedes refuses with supersede_invalid');
    const supersedingParent = { title: 'SUP-6 Parent supersede', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [], supersedes: 'X Legacy card' };
    ok(!run(base(dir, { classification: 'parent_children', cards: [supersedingParent, execution('SUP-6a Child', { parent_title: supersedingParent.title, slice: 'SUP-6a' })] }), false).ok, 'BGR-INTAKE-SUPERSEDE-MISSING-FIELDS: a parent card cannot silently declare supersedes');
  });
}

function tpStub(dir) {
  return { app: { vault: { adapter: {
    async exists(rel) { return fs.existsSync(path.join(dir, rel)); },
    async mkdir(rel) { fs.mkdirSync(path.join(dir, rel), { recursive: true }); },
    async read(rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); },
    async write(rel, content) { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); },
  } } } };
}

async function exactHeadMaterialization() {
  console.log('\n--- exact-head surface materialization ---');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-intake-surface-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/mechanisms/platform-claude/manifest.json'), 'utf8'));
    const history = [];
    const aggregate = await aggregateClaudeSurface(new Map([['platform-claude', manifest]]), { mechanisms: [{ name: 'platform-claude', version: manifest.version }], blueprints: [] }, history, { commit: 'HEAD', tag: null, dirty: false }, { workshop_version: 'HEAD', targetPathByName: new Map([['platform-claude', 'mechanisms/platform-claude']]) });
    await materializeClaudeSurface(aggregate.materializeList, tpStub(dir), ROOT, history, { commit: 'HEAD', tag: null, dirty: false });
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), ['# Fixture', '<!-- @claude-surface:resolvers BEGIN -->', '<!-- @claude-surface:resolvers END -->', '<!-- @claude-surface:directory-map BEGIN -->', '<!-- @claude-surface:directory-map END -->', '<!-- @claude-surface:skills-index BEGIN -->', '<!-- @claude-surface:skills-index END -->', ''].join('\n'));
    await regenerateClaudeMd(aggregate.rows, tpStub(dir), history, { commit: 'HEAD', tag: null, dirty: false });
    ok(fs.existsSync(path.join(dir, '.claude/commands/card-intake.md')), 'command materializes');
    ok(fs.existsSync(path.join(dir, '.claude/skills/platform/card-intake/SKILL.md')), 'skill materializes');
    const router = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    ok(router.includes('| Card Intake | .claude/commands/card-intake.md | /card-intake |'), 'resolver row materializes');
    ok(router.includes('| /card-intake | .claude/skills/platform/card-intake/SKILL.md | platform-claude |'), 'skills-index row materializes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    ok(!fs.existsSync(dir), 'surface fixture cleaned');
  }
}

async function main() {
  validateSkillSurface(); sharedDeliveryFixtures(); localizedBug(); roadmapTheme(); singleParentChildren(); docsOnly(); missingEvidenceAndRefusals(); cutoverEpicIntake(); supersedeGovernance(); await exactHeadMaterialization();
  console.log(`\nrun-card-intake: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
