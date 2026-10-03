#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  run: runCardIntake, validateDeliveryContract, canonicalEpicSurface, readInstalledCoordinatorStatus,
} = require('../../.agents/skills/card-intake/scripts/card-intake');
const { parseDependsOn, selectCard } = require('../../scripts/autoloop/select-card');
const { selectClaimCandidate, canonicalEpicProjection } = require('../../scripts/autoloop/codex-coordinator');
const { prepareDeliveryCard } = require('../../scripts/autoloop/select-card');
const delivery = require('../mechanisms/delivery');
const { aggregateClaudeSurface, materializeClaudeSurface } = require('../install');
const { regenerateClaudeMd } = require('../mechanisms/platform-claude/claude-md-renderer');

const ROOT = path.resolve(__dirname, '../..');
const ACTUAL_LEGACY_WRITER_PROVENANCE = Object.freeze({
  commit: '402988f32e6ef4c510f5b7e3ad8b6f327648266b',
  git_blob: '7b2c06084136b8b2a4aef8324a024846250aa334',
  blob_sha256: '70d74b4af3a468d7fa2e076780126bae2e1d5ee1f6316633a9e91e92ba426b67',
});
const ACTUAL_LEGACY_WRITER_EXCERPT = [
  "  else lines.push('  []');",
  "  if (role === 'execution') {",
  "    lines.push('deploy_subscriptions:');",
  '    for (const vault of VAULTS) lines.push(`  ${vault}: ${JSON.stringify(contract.deploy_subscriptions[vault])}`);',
  '  }',
  '  if (role === \'execution\') lines.push(`evidence: ${JSON.stringify(contract.evidence)}`, `risk_dimensions: ${JSON.stringify(contract.risk_dimensions)}`);',
  '  if (role === \'execution\' && card.supersedes) {',
].join('\n') + '\n';
const ACTUAL_LEGACY_WRITER_EXCERPT_SHA256 = 'bc7280f6c3498b1e50addd9ef81da28ed6c283fd706e9aaec36d83135ea403f3';
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

function installedCoordinatorResolution() {
  for (const prefix of ['/usr/local/opt/sauce', '/home/linuxbrew/.linuxbrew/opt/sauce']) {
    const calls = [];
    const status = readInstalledCoordinatorStatus((file, args) => {
      calls.push({ file, args });
      if (file === 'brew') return `${prefix}\n`;
      return JSON.stringify({ action: 'status', cutover: { enabled: false } });
    });
    eq(calls[0], { file: 'brew', args: ['--prefix', 'sauce'] },
      `GA-OPS13A2-RR1-HARDCODED-HOMEBREW-PATH resolves ${prefix} through brew`);
    eq(calls[1], {
      file: process.execPath,
      args: [path.join(prefix, 'libexec/scripts/autoloop/codex-coordinator.js'), 'status', '--json'],
    }, `GA-OPS13A2-RR1-HARDCODED-HOMEBREW-PATH invokes installed coordinator under ${prefix}`);
    eq(status, { action: 'status', cutover: { enabled: false } },
      `GA-OPS13A2-RR1-HARDCODED-HOMEBREW-PATH parses status under ${prefix}`);
  }
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
function structuredJsonScalar(raw, key) {
  const frontmatter = String(raw).match(/^---\n([\s\S]*?)\n---/);
  const line = frontmatter && frontmatter[1].split('\n').find((entry) => entry.startsWith(`${key}: `));
  if (!line) return null;
  return JSON.parse(JSON.parse(line.slice(line.indexOf(':') + 1).trim()));
}
function actualLegacyWriterPreimage(raw, contract, bindingFixtures) {
  const deployBlock = [
    'deploy_subscriptions:',
    ...delivery.registry.policies.required_vaults
      .map((vault) => `  ${vault}: ${JSON.stringify(contract.deploy_subscriptions[vault])}`),
  ].join('\n');
  let next = String(raw).replace(/^deploy_subscriptions:\s*.*$/m, deployBlock);
  next = next.replace(/^evidence:\s*.*$/m, `evidence: ${JSON.stringify(contract.evidence)}`);
  if (bindingFixtures !== undefined) {
    next = next.replace(/^binding_fixtures:\s*.*$/m, `binding_fixtures: ${JSON.stringify(bindingFixtures)}`);
  }
  return next;
}
function actualLegacyWriterPin() {
  console.log('\n--- carried fixture: actual pre-change intake writer ---');
  eq(crypto.createHash('sha256').update(ACTUAL_LEGACY_WRITER_EXCERPT).digest('hex'),
    ACTUAL_LEGACY_WRITER_EXCERPT_SHA256,
    `GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY pins ${ACTUAL_LEGACY_WRITER_PROVENANCE.commit}:${ACTUAL_LEGACY_WRITER_PROVENANCE.git_blob}`);
  ok(ACTUAL_LEGACY_WRITER_PROVENANCE.blob_sha256.length === 64
    && ACTUAL_LEGACY_WRITER_EXCERPT.includes("lines.push('deploy_subscriptions:');")
    && ACTUAL_LEGACY_WRITER_EXCERPT.includes('for (const vault of VAULTS) lines.push(`  ${vault}: ${JSON.stringify(contract.deploy_subscriptions[vault])}`);')
    && ACTUAL_LEGACY_WRITER_EXCERPT.includes('lines.push(`evidence: ${JSON.stringify(contract.evidence)}`'),
  'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY carries provenance plus the exact YAML deploy block and inline evidence grammar');
}
function objectValuedFrontmatterKeys(raw) {
  const frontmatter = String(raw).match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return [];
  const lines = frontmatter[1].split('\n');
  const offenders = [];
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) continue;
    const inline = field[2].trim();
    if (inline.startsWith('{')) offenders.push(field[1]);
    if (inline.startsWith('[')) {
      try {
        const value = JSON.parse(inline);
        const containsObject = (item) => Boolean(item && typeof item === 'object'
          && (!Array.isArray(item) || item.some(containsObject)));
        if (containsObject(value)) offenders.push(field[1]);
      } catch (_) {}
    }
    if (!inline) {
      const block = [];
      for (let cursor = index + 1; cursor < lines.length && /^\s+/.test(lines[cursor]); cursor += 1) block.push(lines[cursor]);
      if (block.some((entry) => /^\s{2}[A-Za-z_][A-Za-z0-9_-]*:\s*/.test(entry))) offenders.push(field[1]);
    }
  }
  return [...new Set(offenders)];
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
    eq(structuredJsonScalar(raw, 'evidence'), prepared.card.evidence,
      'BGR-OBSY-WRITER-STRING-ENCODING flat intake writes evidence as one JSON text scalar');
    eq(structuredJsonScalar(raw, 'deploy_subscriptions'), prepared.card.deploy_subscriptions,
      'BGR-OBSY-WRITER-STRING-ENCODING flat intake writes deploy_subscriptions as one JSON text scalar');
    eq(objectValuedFrontmatterKeys(raw), [],
      'BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD flat intake emits no object-valued frontmatter key');
    ok(emittedLinksResolve(raw, dir), 'every emitted bug-card wikilink resolves');
    ok(!run({ ...spec, reproduction: '' }, false).ok, 'bug without reproduction is refused');
    delete spec.created_at;
    ok(run(spec, true).no_op, 'repeat bug intake is idempotent without restating generated created_at');
    const cardFile = path.join(dir, 'tasks', card.title, `${card.title}.md`);
    const legacyPreimage = actualLegacyWriterPreimage(raw, prepared.card);
    ok(objectValuedFrontmatterKeys(legacyPreimage).includes('deploy_subscriptions')
      && objectValuedFrontmatterKeys(legacyPreimage).includes('evidence'),
    'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY flat fixture contains the actual legacy object shapes');
    fs.writeFileSync(cardFile, legacyPreimage);
    const legacyReplay = run(spec, true);
    ok(legacyReplay.ok && legacyReplay.changed_paths.includes(cardFile),
      'BGR-OBSY-READERS-BOTH-ENCODINGS flat intake accepts and heals its byte-equivalent legacy writer preimage');
    eq(objectValuedFrontmatterKeys(fs.readFileSync(cardFile, 'utf8')), [],
      'BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD healed flat replay restores object-free frontmatter');
    const unrelatedLegacyBytes = legacyPreimage.replace('### Outcome', '### Outcome\n\nunrelated legacy mutation');
    const boardBeforeRefusal = fs.readFileSync(spec.board_path, 'utf8');
    fs.writeFileSync(cardFile, unrelatedLegacyBytes);
    const unrelatedRefusal = run(spec, true);
    ok(!unrelatedRefusal.ok
      && fs.readFileSync(cardFile, 'utf8') === unrelatedLegacyBytes
      && fs.readFileSync(spec.board_path, 'utf8') === boardBeforeRefusal,
    'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY flat unrelated-byte third state refuses before every write');
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
    // Slice-scope ceilings: an execution slice that is a program hidden in one
    // card is refused at mint so the loop never thrashes it through dozens of
    // 1:1 supersessions (the TV-2 mega-slice failure mode).
    const zones7 = Array.from({ length: 7 }, (_, i) => `platform/zone-${i}.js`);
    ok(!run(base(dir, { cards: [execution('BAD Too many zones', { model_profile: 'heavy', touch_zones: zones7 })] }), false).ok, 'slice with more than the touch-zone cap is refused');
    const accept13 = Array.from({ length: 13 }, (_, i) => `Acceptance behavior ${i} passes.`);
    ok(!run(base(dir, { cards: [execution('BAD Too many acceptances', { model_profile: 'heavy', acceptance_tests: accept13 })] }), false).ok, 'slice with more than the acceptance-test cap is refused');
    ok(!run(base(dir, { cards: [execution('BAD Too many risks', { model_profile: 'heavy', risk_dimensions: ['schema', 'migration', 'shared_contract', 'new_mechanism'] })] }), false).ok, 'slice with more than the risk-dimension cap is refused');
    const finding = (i) => `finding-${i}`;
    const findings13 = Array.from({ length: 13 }, (_, i) => finding(i));
    const fixtures13 = findings13.map((name) => ({ name, description: `${name}: bound behavior for ${name}.` }));
    ok(!run(base(dir, { cards: [execution('BAD Accreted supersession', { model_profile: 'heavy', supersedes: 'OLD mega slice', carried_findings: findings13, binding_fixtures: fixtures13 })] }), false).ok, 'supersession carrying more than the carried-findings cap is refused');
    // A slice exactly at every cap still mints: the ceilings refuse programs, not legitimate bounded slices.
    const zones6 = Array.from({ length: 6 }, (_, i) => `platform/ok-zone-${i}.js`);
    const accept12 = Array.from({ length: 12 }, (_, i) => `Bounded acceptance ${i} passes.`);
    ok(run(base(dir, { cards: [execution('OK At the scope cap', { model_profile: 'heavy', touch_zones: zones6, acceptance_tests: accept12, risk_dimensions: ['schema', 'migration', 'shared_contract'] })] }), false).ok, 'a bounded slice exactly at every scope cap still mints');
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
    const discardedOrNeverMintedResult = run(base(dir, { cards: [execution('DISC-1 Depends on tombstoned prerequisite', { depends_on: ['[[GA-P4b Gesture write lint]]'] })] }), false);
    ok(!discardedOrNeverMintedResult.ok && discardedOrNeverMintedResult.errors.some((e) => /does not resolve/.test(e)), 'B1 the existing resolution guard already refuses a dependency on a discarded/never-minted card (its note is gone on disk)');
    const externalDep = execution('EXT-1 External marker dependency', { depends_on: ['external:upstream vendor SDK', '[[Prerequisite]]'] });
    const externalDepResult = run(base(dir, { cards: [externalDep] }), true);
    ok(externalDepResult.ok, 'B1 external: dependency does not trigger a resolution error');
    const externalDepRaw = fs.readFileSync(findTaskFile(dir, externalDep.title), 'utf8');
    ok(externalDepRaw.includes('external:upstream vendor SDK') && !externalDepRaw.includes('[[external:') && externalDepRaw.includes('[[Prerequisite]]'),
      'B1 external: dependency round-trips through renderCard unwrapped while ordinary deps stay wikilinked');
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
    const epicAtlas = (epic) => [
      '---', 'type: epic', 'schema_version: 1.1.0',
      `epic_board: "project/tasks/${epic}/board/${epic}-board.md"`,
      '---', '',
    ].join('\n');
    const epicBoard = (epic) => [
      '---', 'kanban-plugin: board', 'type: kanban', 'board_role: epic',
      `epic: "[[${epic}]]"`, '---', '',
      '## In Planning', '', '## In Progress', '', '## Blocked', '', '## Completed', '',
    ].join('\n');
    const physicalRefusal = (label, spec, sentinelPath, escapedTarget) => {
      const boardBefore = fs.readFileSync(spec.board_path, 'utf8');
      const sentinelBefore = fs.readFileSync(sentinelPath, 'utf8');
      const dryRun = runEnabled(spec, false);
      const applied = runEnabled(spec, true);
      const isPhysicalRefusal = (result) => !result.ok && (result.errors || [])
        .some((error) => error.includes('GA-OPS13A-EPIC-INTAKE-PHYSICAL-CONTAINMENT'));
      ok(isPhysicalRefusal(dryRun) && isPhysicalRefusal(applied),
        `GA-OPS13A-EPIC-INTAKE-PHYSICAL-CONTAINMENT ${label} dry-run and apply refuse`);
      ok(fs.readFileSync(spec.board_path, 'utf8') === boardBefore
        && fs.readFileSync(sentinelPath, 'utf8') === sentinelBefore
        && !fs.existsSync(escapedTarget),
      `GA-OPS13A-EPIC-INTAKE-PHYSICAL-CONTAINMENT ${label} preserves every sentinel and creates no escaped target`);
    };
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
    const directPrepared = prepareDeliveryCard(directRaw, direct.title);
    eq(structuredJsonScalar(directRaw, 'evidence'), directPrepared.card.evidence,
      'BGR-OBSY-WRITER-STRING-ENCODING epic-native intake writes evidence as one JSON text scalar');
    eq(structuredJsonScalar(directRaw, 'deploy_subscriptions'), directPrepared.card.deploy_subscriptions,
      'BGR-OBSY-WRITER-STRING-ENCODING epic-native intake writes deploy_subscriptions as one JSON text scalar');
    eq(objectValuedFrontmatterKeys(directRaw), [],
      'BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD epic-native intake emits no object-valued frontmatter key');
    eq(fs.readFileSync(directSpec.board_path, 'utf8'), parentBefore, 'BGD-CUTOVER-PARENT-BOARD-PRESERVED leaves the parent board byte-identical');
    ok(fs.readFileSync(existingBoardPath, 'utf8').includes(`[[${direct.title}]]`), 'BGD-CUTOVER-EPIC-INTAKE-ROUTING inserts the slice on its epic board');
    ok(runEnabled(directSpec, true).no_op, 'BGD-CUTOVER-EPIC-INTAKE-ROUTING literal existing-epic replay is no_op');
    const legacyEpicPreimage = actualLegacyWriterPreimage(directRaw, directPrepared.card);
    ok(objectValuedFrontmatterKeys(legacyEpicPreimage).includes('deploy_subscriptions')
      && objectValuedFrontmatterKeys(legacyEpicPreimage).includes('evidence'),
    'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY epic-native fixture contains the actual legacy object shapes');
    fs.writeFileSync(directPath, legacyEpicPreimage);
    const legacyEpicReplay = runEnabled(directSpec, true);
    ok(legacyEpicReplay.ok && legacyEpicReplay.changed_paths.includes(directPath),
      'BGR-OBSY-READERS-BOTH-ENCODINGS epic-native intake accepts and heals its byte-equivalent legacy writer preimage');
    eq(objectValuedFrontmatterKeys(fs.readFileSync(directPath, 'utf8')), [],
      'BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD healed epic-native replay restores object-free frontmatter');
    const healedEpicRaw = fs.readFileSync(directPath, 'utf8');
    const unrelatedEpicBytes = legacyEpicPreimage.replace('### Outcome', '### Outcome\n\nunrelated legacy mutation');
    const epicBoardBeforeRefusal = fs.readFileSync(existingBoardPath, 'utf8');
    fs.writeFileSync(directPath, unrelatedEpicBytes);
    const unrelatedEpicRefusal = runEnabled(directSpec, true);
    ok(!unrelatedEpicRefusal.ok
      && fs.readFileSync(directPath, 'utf8') === unrelatedEpicBytes
      && fs.readFileSync(existingBoardPath, 'utf8') === epicBoardBeforeRefusal,
    'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY epic-native unrelated-byte third state refuses before every write');
    fs.writeFileSync(directPath, healedEpicRaw);

    const duplicate = execution('CUT-DUP Cross epic title', {
      model_profile: 'heavy', risk_flags: ['loader'],
    });
    const otherEpic = 'Other Epic';
    const otherBoardDir = path.join(dir, 'tasks', otherEpic, 'board');
    fs.mkdirSync(otherBoardDir, { recursive: true });
    const duplicateReplayPath = path.join(otherBoardDir, `${direct.title}.md`);
    fs.writeFileSync(duplicateReplayPath, directRaw
      .replaceAll(existingEpic, otherEpic));
    const duplicateReplay = runEnabled(directSpec, true);
    ok(!duplicateReplay.ok && (duplicateReplay.errors || []).some((error) => error.includes('duplicate card title resolves outside intended epic')),
      'GA-OPS13A-CROSS-EPIC-DUPLICATE-MISCLAIM refuses replay when the intended slice and a foreign same-title slice both exist');
    fs.unlinkSync(duplicateReplayPath);
    fs.writeFileSync(path.join(otherBoardDir, `${duplicate.title}.md`), [
      '---', 'type: slice', 'status: planning', `card: ${duplicate.title}`,
      `epic: "[[${otherEpic}]]"`, `parent_card: "[[${otherEpic}]]"`, '---', '',
    ].join('\n'));
    const duplicateSpec = base(dir, { epic: `[[${existingEpic}]]`, cards: [duplicate] });
    const duplicateTarget = path.join(existingRoot, 'board', `${duplicate.title}.md`);
    const duplicateBoardBefore = fs.readFileSync(existingBoardPath, 'utf8');
    const duplicateResult = runEnabled(duplicateSpec, true);
    ok(!duplicateResult.ok && (duplicateResult.errors || []).some((error) => error.includes('duplicate card title resolves outside intended epic')),
      'GA-OPS13A-CROSS-EPIC-DUPLICATE-MISCLAIM refuses a post-cutover title already owned by another epic');
    ok(!fs.existsSync(duplicateTarget) && fs.readFileSync(existingBoardPath, 'utf8') === duplicateBoardBefore,
      'GA-OPS13A-CROSS-EPIC-DUPLICATE-MISCLAIM refuses before any target slice or epic-board write');

    const symlinkRootEpic = 'Symlink Root Epic';
    const outsideRoot = path.join(dir, 'outside-root-epic');
    fs.mkdirSync(path.join(outsideRoot, 'board'), { recursive: true });
    fs.writeFileSync(path.join(outsideRoot, `${symlinkRootEpic}.md`), epicAtlas(symlinkRootEpic));
    fs.writeFileSync(path.join(outsideRoot, 'board', `${symlinkRootEpic}-board.md`), epicBoard(symlinkRootEpic));
    const rootSentinel = path.join(outsideRoot, 'sentinel.txt');
    fs.writeFileSync(rootSentinel, 'root sentinel\n');
    fs.symlinkSync(outsideRoot, path.join(dir, 'tasks', symlinkRootEpic), 'dir');
    const rootEscapeCard = execution('PHYS-1 Root escape slice', { model_profile: 'heavy', risk_flags: ['loader'] });
    physicalRefusal(
      'epic-root symlink',
      base(dir, { epic: `[[${symlinkRootEpic}]]`, cards: [rootEscapeCard] }),
      rootSentinel,
      path.join(outsideRoot, 'board', `${rootEscapeCard.title}.md`),
    );

    const symlinkBoardEpic = 'Symlink Board Epic';
    const symlinkBoardRoot = path.join(dir, 'tasks', symlinkBoardEpic);
    const outsideBoard = path.join(dir, 'outside-board-dir');
    fs.mkdirSync(symlinkBoardRoot, { recursive: true });
    fs.mkdirSync(outsideBoard, { recursive: true });
    fs.writeFileSync(path.join(symlinkBoardRoot, `${symlinkBoardEpic}.md`), epicAtlas(symlinkBoardEpic));
    fs.writeFileSync(path.join(outsideBoard, `${symlinkBoardEpic}-board.md`), epicBoard(symlinkBoardEpic));
    const boardSentinel = path.join(outsideBoard, 'sentinel.txt');
    fs.writeFileSync(boardSentinel, 'board sentinel\n');
    fs.symlinkSync(outsideBoard, path.join(symlinkBoardRoot, 'board'), 'dir');
    const boardEscapeCard = execution('PHYS-2 Board escape slice', { model_profile: 'heavy', risk_flags: ['loader'] });
    physicalRefusal(
      'board-directory symlink',
      base(dir, { epic: `[[${symlinkBoardEpic}]]`, cards: [boardEscapeCard] }),
      boardSentinel,
      path.join(outsideBoard, `${boardEscapeCard.title}.md`),
    );

    const symlinkContextEpic = 'Symlink Context Epic';
    const symlinkContextRoot = path.join(dir, 'tasks', symlinkContextEpic);
    const outsideContext = path.join(dir, 'outside-context-dir');
    fs.mkdirSync(symlinkContextRoot, { recursive: true });
    fs.mkdirSync(outsideContext, { recursive: true });
    const contextSentinel = path.join(outsideContext, 'sentinel.txt');
    fs.writeFileSync(contextSentinel, 'context sentinel\n');
    fs.symlinkSync(outsideContext, path.join(symlinkContextRoot, 'context'), 'dir');
    const contextParent = { title: symlinkContextEpic, role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const contextChild = execution('PHYS-3 Context escape slice', { parent_title: symlinkContextEpic, slice: 'PHYS-3' });
    physicalRefusal(
      'context-directory symlink',
      base(dir, {
        mode: 'roadmap', classification: 'roadmap_theme',
        outcome: 'Reject a new epic whose context directory escapes cards_root.',
        cards: [contextParent, contextChild],
        roadmap_path: path.join(dir, 'docs', 'roadmap', 'Symlink Context.md'),
        roadmap_section: '## Symlink context\n\nMust fail closed.',
      }),
      contextSentinel,
      path.join(outsideContext, 'pack.md'),
    );

    const symlinkAtlasEpic = 'Symlink Atlas Epic';
    const symlinkAtlasRoot = path.join(dir, 'tasks', symlinkAtlasEpic);
    const symlinkAtlasBoard = path.join(symlinkAtlasRoot, 'board');
    const outsideAtlas = path.join(dir, 'outside-atlas.md');
    fs.mkdirSync(symlinkAtlasBoard, { recursive: true });
    fs.writeFileSync(outsideAtlas, epicAtlas(symlinkAtlasEpic));
    fs.symlinkSync(outsideAtlas, path.join(symlinkAtlasRoot, `${symlinkAtlasEpic}.md`));
    fs.writeFileSync(path.join(symlinkAtlasBoard, `${symlinkAtlasEpic}-board.md`), epicBoard(symlinkAtlasEpic));
    const atlasSentinel = path.join(dir, 'outside-atlas-sentinel.txt');
    fs.writeFileSync(atlasSentinel, 'atlas sentinel\n');
    const atlasEscapeCard = execution('PHYS-4 Atlas escape slice', { model_profile: 'heavy', risk_flags: ['loader'] });
    physicalRefusal(
      'pre-existing atlas symlink',
      base(dir, { epic: `[[${symlinkAtlasEpic}]]`, cards: [atlasEscapeCard] }),
      atlasSentinel,
      path.join(symlinkAtlasBoard, `${atlasEscapeCard.title}.md`),
    );

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
    eq(structuredJsonScalar(raw, 'binding_fixtures'), successor().binding_fixtures,
      'BGR-OBSY-WRITER-STRING-ENCODING object-bearing binding_fixtures use one JSON text scalar');
    eq(objectValuedFrontmatterKeys(raw), [],
      'BGR-OBSY-NO-OBJECT-FRONTMATTER-GUARD superseding intake emits no nested object in frontmatter');
    const successorPath = findTaskFile(dir, 'SUP-1 Successor card');
    const legacySupersedePreimage = actualLegacyWriterPreimage(
      raw,
      prepareDeliveryCard(raw, successor().title).card,
      successor().binding_fixtures,
    );
    ok(objectValuedFrontmatterKeys(legacySupersedePreimage).includes('binding_fixtures'),
      'GA-OPS20A-NESTED-OBJECT-GUARD carried fixture reproduces the actual object-bearing supersession writer');
    const legacySupersedeThirdState = legacySupersedePreimage.replace(
      'binds finding F1 as a regression fixture',
      'binds finding F1 as a regression fixturX',
    );
    const supersedeThirdStateBoard = fs.readFileSync(spec.board_path, 'utf8');
    const supersedeThirdStatePeerPath = path.join(dir, 'Roadmap.md');
    const supersedeThirdStatePeer = fs.readFileSync(supersedeThirdStatePeerPath, 'utf8');
    eq(Buffer.byteLength(legacySupersedeThirdState), Buffer.byteLength(legacySupersedePreimage),
      'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding third-state mutation preserves preimage length');
    eq([...Buffer.from(legacySupersedeThirdState)].filter(
      (byte, index) => byte !== Buffer.from(legacySupersedePreimage)[index],
    ).length, 1,
    'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding fixture mutates exactly one unrelated byte');
    fs.writeFileSync(successorPath, legacySupersedeThirdState);
    const legacySupersedeThirdStateResult = run(spec, true);
    ok(!legacySupersedeThirdStateResult.ok && legacySupersedeThirdStateResult.no_op !== true,
      'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding legacy unrelated-byte third state refuses');
    eq(fs.readFileSync(successorPath, 'utf8'), legacySupersedeThirdState,
      'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding third-state refusal preserves the card bytes');
    eq(fs.readFileSync(spec.board_path, 'utf8'), supersedeThirdStateBoard,
      'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding third-state refusal preserves board bytes');
    eq(fs.readFileSync(supersedeThirdStatePeerPath, 'utf8'), supersedeThirdStatePeer,
      'GA-OPS20A-ACTUAL-LEGACY-BLOCK-REPLAY superseding third-state refusal preserves peer bytes');
    fs.writeFileSync(successorPath, legacySupersedePreimage);
    const legacySupersedeReplay = run(spec, true);
    ok(legacySupersedeReplay.ok && legacySupersedeReplay.changed_paths.includes(successorPath),
      'BGR-OBSY-READERS-BOTH-ENCODINGS superseding intake accepts and heals its legacy object-bearing preimage');

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
    ok(!fs.existsSync(path.join(dir, '.claude/commands/card-intake.md')), 'retired card-intake command no longer materializes');
    ok(!fs.existsSync(path.join(dir, '.claude/skills/platform/card-intake/SKILL.md')), 'retired card-intake skill no longer materializes');
    ok(fs.existsSync(path.join(dir, '.claude/commands/install.md')), 'remaining platform commands still materialize');
    const router = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    ok(!/card-intake|slice-plan/.test(router), 'no retired rows reach the CLAUDE.md tables');
    ok(router.includes('| Install | .claude/commands/install.md | /install |'), 'remaining resolver rows materialize');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    ok(!fs.existsSync(dir), 'surface fixture cleaned');
  }
}

function epicNativeForcedIntake() {
  console.log('\n--- LOOP-EPIC-NATIVE forced routing: fresh boards without cutover ---');
  tempCase((dir) => {
    const nullStatus = () => ({ action: 'status', cutover: null });
    const runFresh = (spec, apply = false) => run(spec, apply, { readCoordinatorStatus: nullStatus });
    const epicTitle = 'Fresh Epic';
    const parent = { title: epicTitle, role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] };
    const childA = execution('FE-1 First slice', { parent_title: epicTitle, slice: 'FE-1' });
    const childB = execution('FE-2 Second slice', { parent_title: epicTitle, slice: 'FE-2', depends_on: [`[[${childA.title}]]`] });
    const spec = base(dir, {
      mode: 'roadmap', classification: 'roadmap_theme', epic_native: true,
      outcome: 'Scaffold a canonical epic on a fresh board that has no cutover history.',
      cards: [parent, childA, childB],
      roadmap_path: path.join(dir, 'docs', 'roadmap', 'Fresh Epic.md'),
      roadmap_key: 'fresh-epic', roadmap_section: '## Fresh Epic plan\n\n1. Slices',
    });

    const dry = runFresh(spec, false);
    ok(dry.ok && dry.epic_native === true && dry.cutover_enabled === true,
      'LOOP-EPIC-NATIVE spec.epic_native forces epic routing on a cutover-null ledger');
    const applied = runFresh(spec, true);
    ok(applied.ok, `LOOP-EPIC-NATIVE apply succeeds — ${JSON.stringify(applied.errors || [])}`);

    const epicRoot = path.join(dir, 'tasks', epicTitle);
    const atlasRaw = fs.readFileSync(path.join(epicRoot, `${epicTitle}.md`), 'utf8');
    ok(/^type: epic$/m.test(atlasRaw), 'LOOP-EPIC-NATIVE scaffold writes a canonical epic atlas (type: epic)');
    const atlasMountPattern = /\bdv\s*\.\s*view\s*\(\s*["']ranch\/views\/customjs-guard["']\s*,\s*\{\s*(?:class|["']class["'])\s*:\s*["']([^"']+)["']\s*,?\s*\}\s*\)/g;
    const readAtlasMounts = (raw) => [...raw.matchAll(atlasMountPattern)]
      .map((match) => ({ className: match[1], index: match.index }));
    const atlasMounts = readAtlasMounts(atlasRaw);
    const mountFor = (className) => atlasMounts.filter((mount) => mount.className === className);
    const atlasChromeAt = mountFor('ProjectChromeBar')[0]?.index ?? -1;
    const atlasGraphViewAt = mountFor('GraphView')[0]?.index ?? -1;
    const atlasDashboardAt = mountFor('EpicDashboard')[0]?.index ?? -1;
    ok(atlasChromeAt >= 0 && atlasGraphViewAt > atlasChromeAt && atlasDashboardAt > atlasGraphViewAt,
      'VP-2 atlas scaffold preserves ChromeBar then mounts GraphView before EpicDashboard');
    ok(mountFor('ProjectChromeBar').length === 1,
      'VP-2d carried fixture: atlas scaffold mounts ProjectChromeBar exactly once across whitespace variants');
    ok(mountFor('GraphView').length === 1,
      'VP-2d carried fixture: atlas scaffold mounts GraphView exactly once across whitespace variants');
    ok(mountFor('EpicDashboard').length === 1,
      'VP-2d carried fixture: atlas scaffold mounts EpicDashboard exactly once across whitespace variants');
    for (const className of ['ProjectChromeBar', 'GraphView', 'EpicDashboard']) {
      const carriedVariants = [
        `await dv . view("ranch/views/customjs-guard", { class : "${className}" });`,
        `await dv.view("ranch/views/customjs-guard", { "class": "${className}" });`,
        `await dv.view("ranch/views/customjs-guard", { class: "${className}", });`,
      ];
      ok(carriedVariants.every((variant) => readAtlasMounts(variant)[0]?.className === className),
        `VP-2d carried fixture: semantic parser recognizes executable ${className} spacing, quoted-key, and trailing-comma variants`);
    }
    const epicBoardPath = path.join(epicRoot, 'board', `${epicTitle}-board.md`);
    ok(fs.existsSync(epicBoardPath), 'LOOP-EPIC-NATIVE scaffold writes the epic board');
    ok(fs.existsSync(path.join(epicRoot, 'board', `${childA.title}.md`))
      && fs.existsSync(path.join(epicRoot, 'board', `${childB.title}.md`)),
    'LOOP-EPIC-NATIVE slices land flat in the epic board directory');
    ok(/^type: slice$/m.test(fs.readFileSync(path.join(epicRoot, 'board', `${childA.title}.md`), 'utf8')),
      'LOOP-EPIC-NATIVE slices carry the slice contract type');

    const parentBoard = fs.readFileSync(spec.board_path, 'utf8');
    ok(parentBoard.includes(`[[${epicTitle}]]`), 'LOOP-EPIC-NATIVE parent board carries the epic line');
    ok(!parentBoard.includes('decomposed'),
      'LOOP-EPIC-NATIVE parent board line carries NO decomposed slice-chain suffix');
    ok(!parentBoard.includes(`[[${childA.title}]]`),
      'LOOP-EPIC-NATIVE slices never reach the parent board');

    ok(runFresh(spec, true).no_op === true, 'LOOP-EPIC-NATIVE literal replay is no_op');

    const badSpec = { ...spec, epic_native: 'yes' };
    const badResult = runFresh(badSpec, false);
    ok(!badResult.ok && (badResult.errors || []).some((e) => e.includes('epic_native must be a boolean')),
      'LOOP-EPIC-NATIVE non-boolean epic_native refuses before any read');

    // Absent epic_native on the same fresh ledger preserves the legacy flat path.
    const legacySpec = base(dir, {
      mode: 'roadmap', classification: 'roadmap_theme',
      outcome: 'Legacy flat routing stays byte-stable when epic_native is absent.',
      cards: [
        { title: 'Legacy Parent', role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] },
        execution('LG-1 Legacy child', { parent_title: 'Legacy Parent', slice: 'LG-1' }),
      ],
      roadmap_path: path.join(dir, 'docs', 'roadmap', 'Legacy.md'),
      roadmap_key: 'legacy', roadmap_section: '## Legacy plan\n\n1. Child',
    });
    const legacyApplied = runFresh(legacySpec, true);
    ok(legacyApplied.ok && legacyApplied.epic_native === undefined && legacyApplied.cutover_enabled === undefined,
      'LOOP-EPIC-NATIVE absent flag on a cutover-null ledger keeps legacy routing');
    ok(fs.readFileSync(legacySpec.board_path, 'utf8').includes('decomposed → [[LG-1 Legacy child]]'),
      'LOOP-EPIC-NATIVE legacy path still annotates decomposition (unchanged behavior)');
  });
}

// A canonical vault fixture: <vault>/spice/projects/<slug>/ with the parent board
// directly in the project root and cards under tasks/. This is the shape every
// real consumer vault has, and the shape the coordinator's projection contract
// (physicalProjectPrefix) requires. The run-card-intake fixtures elsewhere use a
// deliberately NON-canonical tmp root, so they exercise the fallback path.
function canonicalVaultCase(fn) {
  const vault = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'card-intake-vault-'));
  try {
    const slug = 'demo-project';
    const projectRoot = path.join(vault, 'spice', 'projects', slug);
    fs.mkdirSync(path.join(projectRoot, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, `${slug}-board.md`), board());
    fs.writeFileSync(path.join(projectRoot, 'Roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(path.join(projectRoot, 'Loop System with Codex.md'), '# Loop System with Codex\n');
    const example = path.join(projectRoot, 'platform', 'example.js');
    fs.mkdirSync(path.dirname(example), { recursive: true });
    fs.writeFileSync(example, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
    fn({ vault, slug, projectRoot, boardPath: path.join(projectRoot, `${slug}-board.md`), cardsRoot: path.join(projectRoot, 'tasks') });
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

function canonicalBoardBindings() {
  console.log('\n--- BPX-CANONICAL-BINDINGS: mints bind vault-relative board paths ---');
  canonicalVaultCase(({ slug, projectRoot, boardPath, cardsRoot }) => {
    const epicTitle = 'Bindings Epic';
    const sliceTitle = 'BE-1 First slice';
    // Exactly what plugins/loop/skills/intake/SKILL.md passes: board_path is the
    // ABSOLUTE config.board_path_abs, and no source_board is supplied at all.
    const spec = {
      mode: 'roadmap', classification: 'roadmap_theme', completion_mode: 'release', epic_native: true,
      outcome: 'Mint a canonical epic whose bindings the coordinator can project.',
      project_root: projectRoot, link_roots: [projectRoot], evidence_roots: [projectRoot],
      board_path: boardPath, cards_root: cardsRoot,
      created_at: '2026-08-03T12:00:00-06:00',
      evidence: [{ path: 'platform/example.js', line: 12, note: 'verified behavior', source_identity: 'fixture repo', captured_at: '2026-08-03T12:00:00-06:00', revision: 'fixture-revision', claim: 'The bounded example behavior is verified.' }],
      protected_cards: [],
      roadmap_path: path.join(projectRoot, 'docs', 'roadmap', 'Bindings.md'),
      roadmap_key: 'bindings', roadmap_section: '## Bindings plan\n\n1. Slice',
      cards: [
        { title: epicTitle, role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] },
        execution(sliceTitle, { parent_title: epicTitle, slice: 'BE-1' }),
      ],
    };
    const applied = run(spec, true);
    ok(applied.ok, `BPX-CANONICAL-BINDINGS apply succeeds — ${JSON.stringify(applied.errors || [])}`);

    const epicRoot = path.join(cardsRoot, epicTitle);
    const atlasRaw = fs.readFileSync(path.join(epicRoot, `${epicTitle}.md`), 'utf8');
    const field = (raw, key) => (raw.match(new RegExp(`^${key}: (.+)$`, 'm')) || [])[1].replace(/^"|"$/g, '');
    const prefix = `spice/projects/${slug}`;
    eq(field(atlasRaw, 'source_board'), `${prefix}/${slug}-board.md`,
      'BPX-CANONICAL-BINDINGS atlas source_board is vault-relative, never the absolute caller input');
    eq(field(atlasRaw, 'kanban_board'), `${prefix}/${slug}-board.md`,
      'BPX-CANONICAL-BINDINGS atlas kanban_board is vault-relative');
    eq(field(atlasRaw, 'epic_board'), `${prefix}/tasks/${epicTitle}/board/${epicTitle}-board.md`,
      'BPX-CANONICAL-BINDINGS atlas epic_board is vault-relative, not project-relative');

    const slicePath = path.join(epicRoot, 'board', `${sliceTitle}.md`);
    const sliceRaw = fs.readFileSync(slicePath, 'utf8');
    eq(field(sliceRaw, 'source_board'), `${prefix}/tasks/${epicTitle}/board/${epicTitle}-board.md`,
      'BPX-CANONICAL-BINDINGS slice source_board is vault-relative');
    eq(field(sliceRaw, 'task_parent'), `${prefix}/tasks/${epicTitle}/${epicTitle}.md`,
      'BPX-CANONICAL-BINDINGS slice task_parent is vault-relative');

    // The contract that actually matters: the coordinator must be able to project
    // the freshly minted epic. Before this fix every mint was born un-projectable.
    let projection = null;
    let projectionError = null;
    try {
      projection = canonicalEpicProjection(sliceRaw, slicePath, boardPath, cardsRoot, { state: { cards: {} }, currentCard: sliceTitle });
    } catch (error) { projectionError = error.message; }
    ok(projection && projection.epic === epicTitle,
      `BPX-CANONICAL-BINDINGS the freshly minted epic projects through the real coordinator contract — ${projectionError || 'ok'}`);
  });
}

// SYNC-2
// A stub of the Local REST API plugin. With stallOnPut, the first PUT of that
// vault path blocks the stub's thread for stallMs before it is handled.
function sync2IntakeStubMain() {
  const fs = require('fs');
  const path = require('path');
  const http = require('http');
  const crypto = require('crypto');
  const { parentPort, workerData: o } = require('worker_threads');
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const absOf = (rel) => path.join(o.vault, ...rel.split('/'));
  const isFileOnDisk = (rel) => { try { return Boolean(rel) && fs.statSync(absOf(rel)).isFile(); } catch (_) { return false; } };
  const index = new Map();
  const scan = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(o.vault, ...dir.split('/').filter(Boolean)), { withFileTypes: true }); } catch (_) { entries = []; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) scan(rel);
      else if (!entry.name.endsWith('.tmp')) index.set(rel, sha(fs.readFileSync(absOf(rel))));
    }
  };
  scan('');
  const requests = [];
  let stalled = false;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const entry = {
        at: Date.now(), method: req.method, url: req.url, host: req.headers.host, remote: req.socket.remoteAddress,
        contentType: req.headers['content-type'] || null, body: Buffer.concat(chunks), rel: null, kind: null, status: null,
      };
      requests.push(entry);
      const echo = o.hostile ? ` ${req.headers.authorization || ''}` : '';
      const json = { 'Content-Type': 'application/json' };
      const answer = (status, headers, body) => { entry.status = status; res.writeHead(status, headers); res.end(body); };
      if (req.url === '/') {
        entry.kind = 'root';
        answer(200, json, JSON.stringify({ status: 'OK', authenticated: req.headers.authorization === `Bearer ${o.apiKey}`, ...(o.hostile ? { echo } : {}) }));
        return;
      }
      if (req.headers.authorization !== `Bearer ${o.apiKey}` || !req.url.startsWith('/vault/')) {
        answer(401, json, JSON.stringify({ errorCode: 40101, message: `Authorization required.${echo}` }));
        return;
      }
      const raw = decodeURIComponent(req.url.slice('/vault/'.length));
      entry.rel = raw.endsWith('/') ? raw.slice(0, -1) : raw;
      if (req.method === 'PUT') {
        entry.kind = 'put';
        if (o.stallOnPut === entry.rel && !stalled) {
          stalled = true;
          parentPort.postMessage({ type: 'stalling', at: Date.now() });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, o.stallMs);
          parentPort.postMessage({ type: 'resumed', at: Date.now() });
        }
        if (o.putStatus) { answer(o.putStatus, json, JSON.stringify({ errorCode: o.putStatus * 100, message: `stub refused the write${echo}` })); return; }
        fs.mkdirSync(path.dirname(absOf(entry.rel)), { recursive: true });
        fs.writeFileSync(absOf(entry.rel), entry.body);
        index.set(entry.rel, sha(entry.body));
        answer(204, {}, '');
        return;
      }
      if (isFileOnDisk(entry.rel)) { entry.kind = 'note'; return; }
      entry.kind = 'list';
      const prefix = entry.rel ? `${entry.rel}/` : '';
      const files = [...new Set([...index.keys()].filter((rel) => rel.startsWith(prefix))
        .map((rel) => { const sub = rel.slice(prefix.length); return sub.includes('/') ? sub.slice(0, sub.indexOf('/') + 1) : sub; }))].sort();
      if (!files.length) { answer(404, json, JSON.stringify({ errorCode: 40400, message: `File not found${echo}` })); return; }
      answer(200, json, JSON.stringify({ files, ...(o.hostile ? { echo } : {}) }));
    });
  });
  parentPort.on('message', (message) => {
    if (message && message.type === 'log') parentPort.postMessage({ type: 'log', id: message.id, requests, index: Object.fromEntries(index) });
  });
  server.listen(0, '127.0.0.1', () => parentPort.postMessage({ type: 'ready', port: server.address().port }));
}

async function sync2IntakeStub(vault, apiKey, extra = {}) {
  const { Worker } = require('worker_threads');
  const worker = new Worker(`(${sync2IntakeStubMain.toString()})();`, { eval: true, workerData: { vault, apiKey, ...extra } });
  const events = [];
  worker.on('message', (message) => { if (message && (message.type === 'stalling' || message.type === 'resumed')) events.push(message); });
  const ready = await new Promise((resolve, reject) => {
    const onMessage = (message) => { if (message && message.type === 'ready') { worker.off('message', onMessage); resolve(message); } };
    worker.on('message', onMessage);
    worker.once('error', reject);
  });
  let logSeq = 0;
  let closedLog = null;
  const fetchLog = () => new Promise((resolve) => {
    const id = ++logSeq;
    const onMessage = (message) => {
      if (!message || message.type !== 'log' || message.id !== id) return;
      worker.off('message', onMessage);
      resolve({ requests: message.requests.map((request) => ({ ...request, body: Buffer.from(request.body) })), index: message.index });
    };
    worker.on('message', onMessage);
    worker.postMessage({ type: 'log', id });
  });
  return {
    port: ready.port,
    events,
    log: () => (closedLog ? Promise.resolve(closedLog) : fetchLog()),
    close: async () => {
      if (closedLog) return;
      closedLog = await fetchLog();
      await worker.terminate();
    },
  };
}

// Loaded with --require into an intake CLI child. SYNC2_PROBE_LOG records
// sockets, workers and vault file writes; SYNC2_MAIN_SHIM replaces vault-index
// with a module whose functions do nothing.
function sync2IntakePreloadMain() {
  const fs = require('fs');
  const path = require('path');
  const append = fs.appendFileSync.bind(fs);
  const log = process.env.SYNC2_PROBE_LOG;
  const record = (entry) => { if (log) append(log, `${JSON.stringify(entry)}\n`); };
  if (process.env.SYNC2_MAIN_SHIM) {
    const target = process.env.SYNC2_MAIN_SHIM;
    const shim = {
      beforeNoteWrite() {},
      beforeNoteRewrite() {},
      noteWritten() {},
      lockGate() { return null; },
      async awaitWriteTurn() {},
      async withVaultIndex(_vaultRoot, fn) { return fn(null); },
      async verifyJournal() { return null; },
      attachObsidianIndex(receipt) { return receipt; },
      vaultRootForBoard(boardPath) { return path.resolve(path.dirname(boardPath), '../../..'); },
    };
    require.cache[target] = { id: target, filename: target, loaded: true, exports: shim, children: [], paths: [] };
  }
  if (log) {
    const net = require('net');
    const threads = require('worker_threads');
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function sync2Connect(...args) { record({ op: 'connect' }); return connect.apply(this, args); };
    const RealWorker = threads.Worker;
    threads.Worker = class extends RealWorker { constructor(...args) { record({ op: 'worker' }); super(...args); } };
    const vault = `${process.env.SYNC2_VAULT}${path.sep}`;
    const wrap = (name, describe) => {
      const real = fs[name];
      fs[name] = function sync2Wrapped(...args) {
        const result = real.apply(this, args);
        const entry = describe(args);
        if (entry) record(entry);
        return result;
      };
    };
    wrap('writeFileSync', ([file]) => (String(file).startsWith(vault) ? { op: 'write', file: String(file) } : null));
    wrap('renameSync', ([from, to]) => (String(to).startsWith(vault) ? { op: 'rename', from: String(from), to: String(to) } : null));
    wrap('unlinkSync', ([file]) => (String(file).startsWith(vault) ? { op: 'unlink', file: String(file) } : null));
    wrap('mkdirSync', ([dir]) => (String(dir).startsWith(vault) ? { op: 'mkdir', dir: String(dir) } : null));
  }
}

async function sync2Intake() {
  console.log('\n--- SYNC-2: intake notes sent to Obsidian after they are written ---');
  const { spawn } = require('child_process');
  const intake = require('../../.agents/skills/card-intake/scripts/card-intake');
  const vaultIndex = require('../../scripts/autoloop/vault-index');
  const indexPath = path.join(ROOT, 'scripts/autoloop/vault-index.js');
  const intakePath = path.join(ROOT, '.agents/skills/card-intake/scripts/card-intake.js');
  const apiKey = crypto.randomBytes(24).toString('hex');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'card-intake-sync2-'));
  const stubs = [];
  const nullStatus = () => ({ action: 'status', cutover: null });
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const snapshot = (vault) => {
    const out = new Map();
    const stack = [vault];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.obsidian') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else out.set(path.relative(vault, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
      }
    }
    return out;
  };
  const changedBetween = (before, after) => [...after].filter(([rel, raw]) => before.get(rel) !== raw).map(([rel]) => rel).sort();
  const hidden = (rel) => rel.split('/').some((segment) => segment.startsWith('.'));
  const indexable = (rels) => rels.filter((rel) => !hidden(rel));
  const turn = (vault) => path.join(vault, vaultIndex.PENDING_DIR, 'turn');
  const until = async (predicate, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !predicate()) await new Promise((resolve) => { setTimeout(resolve, 10); });
    return predicate();
  };
  const closedPort = () => new Promise((resolve) => {
    const probe = require('http').createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
  const epicTitle = 'Visibility Epic';
  const sliceTitles = Array.from({ length: 8 }, (_, i) => `VW-${i + 1} Visible slice ${i + 1}`);
  let fixtureSeq = 0;
  const fixture = async (mode = 'reachable', stubExtra = {}) => {
    const base = path.join(root, `fixture-${++fixtureSeq}`);
    const vault = path.join(base, 'vault');
    const slug = 'demo-project';
    const projectRoot = path.join(vault, 'spice', 'projects', slug);
    fs.mkdirSync(path.join(projectRoot, 'tasks'), { recursive: true });
    const boardPath = path.join(projectRoot, `${slug}-board.md`);
    fs.writeFileSync(boardPath, board());
    fs.writeFileSync(path.join(projectRoot, 'Roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(path.join(projectRoot, 'Loop System with Codex.md'), '# Loop System with Codex\n');
    fs.mkdirSync(path.join(projectRoot, 'platform'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'platform', 'example.js'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
    let stub = null;
    if (mode === 'reachable') {
      stub = await sync2IntakeStub(vault, apiKey, stubExtra);
      stubs.push(stub);
      const config = path.join(vault, vaultIndex.REST_CONFIG_RELATIVE);
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, JSON.stringify({
        port: await closedPort(), insecurePort: stub.port, enableInsecureServer: true, enableSecureServer: true, apiKey,
      }, null, 2));
    }
    const spec = {
      mode: 'roadmap', classification: 'roadmap_theme', completion_mode: 'release', epic_native: true,
      outcome: 'Mint a canonical epic whose every note desktop Obsidian indexes.',
      project_root: projectRoot, link_roots: [projectRoot], evidence_roots: [projectRoot],
      board_path: boardPath, cards_root: path.join(projectRoot, 'tasks'),
      created_at: '2026-09-28T06:40:00-06:00',
      evidence: [{ path: 'platform/example.js', line: 12, note: 'verified behavior', source_identity: 'fixture repo', captured_at: '2026-09-28T06:40:00-06:00', revision: 'fixture-revision', claim: 'The bounded example behavior is verified.' }],
      protected_cards: [],
      roadmap_path: path.join(projectRoot, 'docs', 'roadmap', 'Visibility.md'),
      roadmap_key: 'visibility', roadmap_section: '## Visibility plan\n\n1. Slice',
      cards: [
        { title: epicTitle, role: 'parent', lane: 'In Planning', status: 'planning', depends_on: [] },
        ...sliceTitles.map((title, i) => execution(title, {
          parent_title: epicTitle, slice: `VW-${i + 1}`, ...(i ? { depends_on: [`[[${sliceTitles[i - 1]}]]`] } : {}),
        })),
      ],
    };
    return { base, vault, boardPath, stub, spec };
  };
  const deps = { readCoordinatorStatus: nullStatus };
  const fakePrefix = path.join(root, 'fake-brew-prefix');
  const fakeCoordinator = path.join(fakePrefix, 'libexec', 'scripts', 'autoloop', 'codex-coordinator.js');
  fs.mkdirSync(path.dirname(fakeCoordinator), { recursive: true });
  fs.writeFileSync(fakeCoordinator, "process.stdout.write(JSON.stringify({ action: 'status', cutover: null }));\n");
  const fakeBin = path.join(root, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'brew'), `#!/bin/sh\necho ${JSON.stringify(fakePrefix)}\n`);
  fs.chmodSync(path.join(fakeBin, 'brew'), 0o755);
  const preload = path.join(root, 'preload.js');
  fs.writeFileSync(preload, `(${sync2IntakePreloadMain.toString()})();\n`);
  let probeSeq = 0;
  const cli = (fx, extra, options = {}) => new Promise((resolve) => {
    const specFile = path.join(fx.base, 'spec.json');
    fs.writeFileSync(specFile, JSON.stringify(fx.spec));
    const probeLog = options.probe ? path.join(fx.base, `probe-${++probeSeq}.log`) : null;
    const env = {
      ...process.env, HOME: root, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, SYNC2_VAULT: fx.vault,
      ...(probeLog ? { SYNC2_PROBE_LOG: probeLog } : {}),
      ...(options.mainShim ? { SYNC2_MAIN_SHIM: indexPath } : {}),
    };
    const child = spawn(process.execPath, ['--require', preload, intakePath, '--spec', specFile, ...extra, '--json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      let receipt = {};
      try { receipt = JSON.parse(stdout); } catch (_) { receipt = {}; }
      const probe = probeLog && fs.existsSync(probeLog)
        ? fs.readFileSync(probeLog, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
      resolve({ code, stdout, stderr: Buffer.concat(err).toString('utf8'), receipt, pid: child.pid, probe });
    });
  });
  const outputs = [];
  try {
    const intakeSource = fs.readFileSync(intakePath, 'utf8');
    const writerStart = intakeSource.indexOf('function atomicWrite(');
    const writerBody = writerStart < 0 ? '' : intakeSource.slice(writerStart, intakeSource.indexOf('\n}\n', writerStart));
    ok(/^function atomicWrite\(file, content\) \{\s*vaultIndex\.beforeNoteWrite\(\);\s*fs\.mkdirSync\(path\.dirname\(file\), \{ recursive: true \}\);\s*const tmp = `\$\{file\}\.card-intake-\$\{process\.pid\}\.tmp`;\s*fs\.writeFileSync\(tmp, content, 'utf8'\);\s*fs\.renameSync\(tmp, file\);\s*vaultIndex\.noteWritten\(file, content\);$/.test(writerBody),
      'SYNC2-NO-REST-IDENTICAL card-intake atomicWrite keeps its .card-intake-<pid>.tmp rename, between the turn check and the record');
    ok(!/require\('(?:http|https|net|tls|worker_threads)'\)|'PUT'|withLock/.test(intakeSource),
      'SYNC2-NO-POST-VERB-WRITE card-intake opens no connection and takes no coordinator lock of its own');

    const dryFx = await fixture();
    const dryBefore = snapshot(dryFx.vault);
    const dry = await intake.runAndIndex(dryFx.spec, false, deps);
    ok(dry.ok === true && dry.applied === false, `SYNC2-NO-REST-IDENTICAL dry run succeeds — ${JSON.stringify(dry.errors || [])}`);
    ok(!Object.prototype.hasOwnProperty.call(dry, 'obsidian_index'), 'SYNC2-NO-REST-IDENTICAL a dry run carries no obsidian_index');
    eq([(await dryFx.stub.log()).requests.length, changedBetween(dryBefore, snapshot(dryFx.vault))], [0, []],
      'SYNC2-NO-REST-IDENTICAL a dry run makes no request and writes nothing');

    // SYNC2-INDEXED-WHEN-HEALTHY
    const fx = await fixture();
    const before = snapshot(fx.vault);
    const applied = await intake.runAndIndex(fx.spec, true, deps);
    const all = changedBetween(before, snapshot(fx.vault));
    const notes = indexable(all);
    const burst = notes.filter((rel) => !before.has(rel) && rel.startsWith(`spice/projects/demo-project/tasks/${epicTitle}/`));
    const { requests, index: indexed } = await fx.stub.log();
    const puts = requests.filter((request) => request.kind === 'put');
    ok(applied.ok === true && applied.no_op === false, `SYNC2-INDEXED-WHEN-HEALTHY --apply mints the epic — ${JSON.stringify(applied.errors || [])}`);
    eq(burst.length, 11, `SYNC2-INDEXED-WHEN-HEALTHY the mint is eleven new notes: atlas, epic board, context pack, eight cards (${burst.join(', ')})`);
    eq(notes.filter((rel) => indexed[rel] !== sha(path.join(fx.vault, ...rel.split('/')))), [],
      'SYNC2-INDEXED-WHEN-HEALTHY SYNC1-TOUCH-NOT-RELIABLE every note of the mint is in the stub\'s index with its bytes when runAndIndex returns');
    eq(puts.map((request) => request.rel).sort(), notes, 'SYNC2-INDEXED-WHEN-HEALTHY SYNC1-WRITE-THROUGH-REPAIRS every changed note is sent once, the dot-prefixed placeholders never');
    ok(puts.every((request) => request.contentType === 'text/markdown' && request.body.equals(fs.readFileSync(path.join(fx.vault, ...request.rel.split('/'))))),
      'SYNC2-INDEXED-WHEN-HEALTHY each PUT carries the bytes intake wrote, as text/markdown');
    const index = applied.obsidian_index;
    eq(index && [index.available, index.seen.slice().sort(), index.written_through.slice().sort(), index.unseen, index.conflicts,
      index.skipped.map((item) => item.path).sort(), index.not_written_through.map((item) => [item.path, item.reason]).sort()],
    [true, notes, notes, [], [], all.filter(hidden), all.filter(hidden).map((rel) => [rel, 'dot-prefixed'])],
    'SYNC2-INDEXED-WHEN-HEALTHY obsidian_index: every note written through and seen, placeholders skipped');
    const firstList = requests.findIndex((request) => request.kind === 'list');
    eq([requests.filter((request) => request.kind === 'note').length, requests.slice(firstList).filter((request) => request.kind !== 'list').length], [0, 0],
      'SYNC2-READ-ONLY-VERIFY SYNC1B-UNINDEXED-GET-HANGS the check lists folders only, after every PUT: no note GET, no PUT');
    eq(fs.existsSync(turn(fx.vault)), false, 'SYNC2-TURN the mint releases the write turn');

    // SYNC2-TURN an applying mint waits for another holder's write turn
    // before it reads the board or writes anything. The holder, another
    // process, appends to the board and then releases the turn.
    const waitFx = await fixture();
    const { spawn: spawnHolder } = require('child_process');
    const holder = spawnHolder(process.execPath, ['-e', `
const fs = require('fs'); const os = require('os'); const path = require('path');
const lease = ${JSON.stringify(turn(waitFx.vault))};
const board = ${JSON.stringify(waitFx.boardPath)};
fs.mkdirSync(lease, { recursive: true });
fs.writeFileSync(path.join(lease, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'holder', started_at: new Date().toISOString() }));
process.stdout.write('held\\n');
setTimeout(() => {
  fs.appendFileSync(board, '- [x] [[Written by the turn holder]]\\n');
  const at = Date.now();
  fs.rmSync(lease, { recursive: true, force: true });
  process.stdout.write('released ' + at + '\\n');
}, 800);
`], { stdio: ['ignore', 'pipe', 'inherit'] });
    let holderOut = '';
    holder.stdout.on('data', (chunk) => { holderOut += chunk; });
    const holderClosed = new Promise((resolve) => holder.on('close', resolve));
    await until(() => holderOut.includes('held'), 10000);
    const waitBefore = snapshot(waitFx.vault);
    let settledAt = 0;
    const waiting = intake.runAndIndex(waitFx.spec, true, deps).then((result) => { settledAt = Date.now(); return result; });
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    const heldBack = changedBetween(waitBefore, snapshot(waitFx.vault)).filter((rel) => !rel.startsWith(`${vaultIndex.PENDING_DIR}/`));
    const waited = await waiting;
    await holderClosed;
    const releasedAt = Number((holderOut.match(/released (\d+)/) || [])[1]);
    eq([heldBack, releasedAt > 0 && settledAt >= releasedAt, waited.ok], [[], true, true],
      'SYNC2-TURN an applying mint writes nothing while another process holds the write turn, then completes');
    ok(fs.readFileSync(waitFx.boardPath, 'utf8').includes('[[Written by the turn holder]]'),
      'SYNC2-TURN an applying mint reads the board only after it holds the write turn, so the holder\'s board write survives');

    // SYNC2B-INTAKE-STATUS-FIRST an applying mint reads the coordinator status,
    // which takes the selector lock, before it waits for the write turn, so it
    // never holds the turn while it needs a coordinator lock.
    {
      const statusFx = await fixture();
      const { spawn: spawnStatusHolder } = require('child_process');
      const statusHolder = spawnStatusHolder(process.execPath, ['-e', `
const fs = require('fs'); const os = require('os'); const path = require('path');
const lease = ${JSON.stringify(turn(statusFx.vault))};
fs.mkdirSync(lease, { recursive: true });
fs.writeFileSync(path.join(lease, 'owner.json'), JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'holder', started_at: new Date().toISOString() }));
process.stdout.write('held\\n');
setTimeout(() => { const at = Date.now(); fs.rmSync(lease, { recursive: true, force: true }); process.stdout.write('released ' + at + '\\n'); }, 800);
`], { stdio: ['ignore', 'pipe', 'inherit'] });
      let statusHolderOut = '';
      statusHolder.stdout.on('data', (chunk) => { statusHolderOut += chunk; });
      const statusHolderClosed = new Promise((resolve) => statusHolder.on('close', resolve));
      await until(() => statusHolderOut.includes('held'), 10000);
      let statusReadAt = 0;
      const statusRun = await intake.runAndIndex(statusFx.spec, true, { readCoordinatorStatus: () => { statusReadAt = Date.now(); return nullStatus(); } });
      await statusHolderClosed;
      const statusReleasedAt = Number((statusHolderOut.match(/released (\d+)/) || [])[1]);
      eq([statusRun.ok, statusReadAt > 0 && statusReleasedAt > statusReadAt], [true, true],
        'SYNC2B-INTAKE-STATUS-FIRST an applying mint reads the coordinator status while another process holds the turn, then waits for the turn');
    }

    // SYNC2-TURN-INTAKE-RACE (D2): a coordinator verb enters its selector lock,
    // then an applying mint runs in another process. While the mint's PUT of
    // the parent board is stalled, the verb, still inside its lock, is refused
    // the turn and writes nothing; the verb run again later takes the turn
    // before its lock, waits holding no lock, and read-modify-writes the board.
    {
      const coordinator = require('../../scripts/autoloop/codex-coordinator');
      const raceFx = await fixture('reachable', { stallOnPut: 'spice/projects/demo-project/demo-project-board.md', stallMs: 2500 });
      const ctx = { stateDir: path.join(raceFx.base, 'state') };
      const railWrite = (file, text) => {
        vaultIndex.beforeNoteWrite();
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, file);
        vaultIndex.noteWritten(file, text);
      };
      const rewriteBoard = () => {
        vaultIndex.beforeNoteRewrite();
        railWrite(raceFx.boardPath, `${fs.readFileSync(raceFx.boardPath, 'utf8')}- [x] [[Coordinator verb write]]\n`);
      };
      let verbInside = false;
      let boardWhenRefused = null;
      let refusedAt = 0;
      const verb = vaultIndex.withVaultIndex(raceFx.vault, () => coordinator.withLock(ctx, 'selector', async () => {
        verbInside = true;
        await until(() => raceFx.stub.events.some((event) => event.type === 'stalling'), 5000);
        await new Promise((resolve) => { setTimeout(resolve, 200); });
        try { rewriteBoard(); return { ok: true }; } catch (error) {
          refusedAt = Date.now();
          boardWhenRefused = fs.readFileSync(raceFx.boardPath, 'utf8');
          return { ok: false, code: error.code, message: error.message };
        }
      }));
      await until(() => verbInside, 5000);
      const mint = cli(raceFx, ['--apply']);
      const firstAttempt = await verb;
      let verbWroteAt = 0;
      const retry = vaultIndex.withVaultIndex(raceFx.vault, async () => {
        await vaultIndex.awaitWriteTurn();
        return coordinator.withLock(ctx, 'selector', async () => { rewriteBoard(); verbWroteAt = Date.now(); return { ok: true }; });
      });
      const [verbReceipt, mintRun] = await Promise.all([retry, mint]);
      outputs.push(mintRun);
      const mintReceipt = mintRun.receipt;
      await until(() => raceFx.stub.events.some((event) => event.type === 'resumed'), 10000);
      await new Promise((resolve) => { setTimeout(resolve, 500); });
      const finalBoard = fs.readFileSync(raceFx.boardPath, 'utf8');
      const resumedAt = (raceFx.stub.events.find((event) => event.type === 'resumed') || {}).at;
      ok(raceFx.stub.events.some((event) => event.type === 'stalling'), 'SYNC2-TURN-INTAKE-RACE precondition: the stub stalled on a PUT of the parent board');
      ok(firstAttempt.ok === false && firstAttempt.code === 'LOCKED' && refusedAt < resumedAt && !boardWhenRefused.includes('[[Coordinator verb write]]'),
        `SYNC2B-NO-WAIT-IN-LOCK D2: the verb inside its lock is refused the mint's turn during the stall and writes nothing (${firstAttempt.code})`);
      eq([finalBoard.includes('[[Coordinator verb write]]'), finalBoard.includes(`[[${epicTitle}]]`), mintRun.code],
        [true, true, 0], 'SYNC2-TURN-INTAKE-RACE D2: the parent board keeps both the verb\'s write and the mint after the stall');
      ok(resumedAt > 0 && verbWroteAt >= resumedAt,
        `SYNC2-TURN-INTAKE-RACE D2: the verb writes the board only after the stalled PUT of it is handled (${verbWroteAt - resumedAt}ms after)`);
      const mintConflicts = (mintReceipt.obsidian_index && mintReceipt.obsidian_index.conflicts) || [];
      eq([verbReceipt.obsidian_index.conflicts, mintConflicts.filter((rel) => rel !== 'spice/projects/demo-project/demo-project-board.md')], [[], []],
        'SYNC2-TURN-INTAKE-RACE the later writer reports no conflict, and the mint at most the board the verb rewrote after it');
    }

    // SYNC2-NO-REST-IDENTICAL: the apply without REST config against the same
    // apply with vault-index replaced by a no-op module (the shim run in the
    // labels).
    const identical = {};
    for (const mode of ['main', 'no-config']) {
      const each = await fixture('none');
      const beforeCli = snapshot(each.vault);
      const run = await cli(each, ['--apply'], { probe: true, mainShim: mode === 'main' });
      outputs.push(run);
      identical[mode] = { fx: each, run, changed: changedBetween(beforeCli, snapshot(each.vault)), after: snapshot(each.vault) };
    }
    const normalize = (text, entry) => String(text).split(entry.fx.base).join('<base>').replace(new RegExp(`\\b${entry.run.pid}\\b`, 'g'), '<pid>');
    const receiptOf = (entry) => {
      const { obsidian_index: _index, plan_fingerprint: _fingerprint, ...rest } = JSON.parse(normalize(entry.run.stdout, entry) || '{}');
      return rest;
    };
    const opsOf = (entry) => entry.run.probe.map((op) => normalize(JSON.stringify(op), entry));
    eq(identical['no-config'].run.code, identical.main.run.code, `SYNC2-NO-REST-IDENTICAL the CLI --apply exit code matches the shim run (${identical.main.run.code})`);
    eq(receiptOf(identical['no-config']), receiptOf(identical.main), 'SYNC2-NO-REST-IDENTICAL the CLI receipt matches the shim run apart from obsidian_index and the path-derived plan_fingerprint');
    eq(identical['no-config'].changed.map((rel) => [rel, identical['no-config'].after.get(rel)]), identical.main.changed.map((rel) => [rel, identical.main.after.get(rel)]),
      'SYNC2-NO-REST-IDENTICAL the notes the apply changed, and their bytes, match the shim run');
    eq(opsOf(identical['no-config']), opsOf(identical.main), 'SYNC2-NO-REST-IDENTICAL the same probed operations as the shim run, in order: vault writes, tmp names, renames, sockets and workers');
    ok(identical.main.run.probe.some((op) => op.op === 'rename'), 'SYNC2-NO-REST-IDENTICAL precondition: the compared apply renames notes');
    eq(identical['no-config'].run.receipt.obsidian_index && [identical['no-config'].run.receipt.obsidian_index.available, identical['no-config'].run.receipt.obsidian_index.reason],
      [false, 'no-rest-config'], 'SYNC2-NO-REST-IDENTICAL obsidian_index reports that the vault has no REST config');

    // SYNC2D-INVALID-KEY: an apiKey that cannot be sent as a header value
    // makes the REST config malformed, so the CLI --apply mints as without
    // REST config and the stub receives nothing.
    {
      const badKey = 'bad\u0101key';
      const badFx = await fixture('reachable');
      fs.writeFileSync(path.join(badFx.vault, vaultIndex.REST_CONFIG_RELATIVE), JSON.stringify({
        port: await closedPort(), insecurePort: badFx.stub.port, enableInsecureServer: true, enableSecureServer: true, apiKey: badKey,
      }, null, 2));
      const beforeBad = snapshot(badFx.vault);
      const badRun = await cli(badFx, ['--apply']);
      outputs.push(badRun);
      const afterBad = snapshot(badFx.vault);
      const badIndex = badRun.receipt.obsidian_index || {};
      eq([badRun.code, badRun.receipt.ok, badIndex.available, badIndex.reason], [0, true, false, 'malformed-rest-config'],
        `SYNC2D-INVALID-KEY the CLI --apply exits 0 and reports obsidian_index reason malformed-rest-config — ${badRun.stderr.slice(0, 200)}`);
      eq(changedBetween(beforeBad, afterBad).map((rel) => [rel, afterBad.get(rel)]), identical['no-config'].changed.map((rel) => [rel, identical['no-config'].after.get(rel)]),
        'SYNC2D-INVALID-KEY the notes the apply changed, and their bytes, match the run without REST config');
      eq((await badFx.stub.log()).requests.length, 0, 'SYNC2D-INVALID-KEY the stub receives no request');
      ok(!badRun.stdout.includes(badKey) && !badRun.stderr.includes(badKey), 'SYNC2D-INVALID-KEY the apiKey appears on neither stdout nor stderr');
    }

    // SYNC2-INDEXED-WHEN-HEALTHY through the CLI
    const cliFx = await fixture();
    const cliBefore = snapshot(cliFx.vault);
    const cliApply = await cli(cliFx, ['--apply']);
    outputs.push(cliApply);
    const cliNotes = indexable(changedBetween(cliBefore, snapshot(cliFx.vault)));
    const cliLog = await cliFx.stub.log();
    eq(cliApply.code, 0, `SYNC2-INDEXED-WHEN-HEALTHY the CLI --apply exits 0 — ${cliApply.stderr.slice(0, 300)}`);
    eq(cliNotes.filter((rel) => cliLog.index[rel] !== sha(path.join(cliFx.vault, ...rel.split('/')))), [],
      'SYNC2-INDEXED-WHEN-HEALTHY every note the CLI --apply wrote is in the stub\'s index with its bytes when the CLI exits');

    // SYNC2-SAFETY-CARRIED
    const wrongFx = await fixture('reachable', { apiKey: crypto.randomBytes(24).toString('hex') });
    const wrong = await intake.runAndIndex(wrongFx.spec, true, deps);
    eq([wrong.ok, (await wrongFx.stub.log()).requests.map((request) => request.kind), wrong.obsidian_index && wrong.obsidian_index.reason],
      [true, ['root'], 'rest-unauthorized'], 'SYNC2-SAFETY-CARRIED a server that rejects the vault key receives only the probe');
    const refusedFx = await fixture('reachable', { putStatus: 500, hostile: true });
    const refused = await intake.runAndIndex(refusedFx.spec, true, deps);
    const refusedNotes = refused.obsidian_index.not_written_through.filter((item) => item.reason === 'put-http-500');
    ok(refused.ok === true && refusedNotes.length === notes.length
      && refusedNotes.every((item) => fs.existsSync(path.join(refusedFx.vault, ...item.path.split('/')))),
    'SYNC2-SAFETY-CARRIED a refused PUT is reported put-http-500 for as many notes as the healthy mint sent, and each reported note is on disk');
    ok(![applied, refused, wrong].some((receipt) => JSON.stringify(receipt).includes(apiKey))
      && !outputs.some((run) => run.stdout.includes(apiKey) || run.stderr.includes(apiKey)),
    'SYNC2-SAFETY-CARRIED the apiKey appears in none of the applied, refused (from a server that echoes it) and wrong-key receipts, nor on the stdout or stderr of the collected CLI runs');
    const everyRequest = [];
    for (const stub of stubs) everyRequest.push(...(await stub.log()).requests.map((request) => ({ ...request, port: stub.port })));
    ok(everyRequest.length > 0 && everyRequest.every((request) => /^(::ffff:)?127\.0\.0\.1$/.test(request.remote) && request.host === `127.0.0.1:${request.port}`),
      'SYNC2-SAFETY-CARRIED intake requests go only to 127.0.0.1');
  } finally {
    for (const stub of stubs) await stub.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  actualLegacyWriterPin(); installedCoordinatorResolution(); sharedDeliveryFixtures(); localizedBug(); roadmapTheme(); singleParentChildren(); docsOnly(); missingEvidenceAndRefusals(); cutoverEpicIntake(); epicNativeForcedIntake(); canonicalBoardBindings(); supersedeGovernance(); await exactHeadMaterialization();
  await sync2Intake();
  console.log(`\nrun-card-intake: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
