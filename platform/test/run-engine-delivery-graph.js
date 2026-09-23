#!/usr/bin/env node
/**
 * run-engine-delivery-graph — proves the shipped delivery-slice graph
 * (platform/engine/graphs/delivery-slice.md) parses, validates, and covers
 * every outcome the coordinator's advance/claim paths can return, then drives
 * it end to end with the fake worker against a stub coordinator: the happy
 * path (claim → implement → adequacy → three lenses → verify-gates → PR →
 * advance through phase-change/waiting → complete), a refuted lens that
 * repairs once, and a claim that finds no work. Zero-dep.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE = path.join(ROOT, 'platform', 'engine');
const engine = require(path.join(ENGINE, 'index.js'));
const GRAPH = path.join(ENGINE, 'graphs', 'delivery-slice.md');
const STUB = path.join(__dirname, 'fixtures', 'engine', 'stub-coordinator.js');
const COORD_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'autoloop', 'codex-coordinator.js'), 'utf8');

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

// ---- static: parse, validate, coverage (DG-*) ----
const parsed = engine.parseGraphNote(fs.readFileSync(GRAPH, 'utf8'));
const v = engine.validateGraph(parsed.graph);
ok('DG-1 shipped graph validates', v.ok === true, JSON.stringify(v.errors));
ok('DG-2 claim is the only entry', (v.entries || []).join(',') === 'claim', (v.entries || []).join(','));
const outOf = (id) => parsed.graph.edges.filter((e) => e.from === id).map((e) => e.on === undefined ? 'pass' : e.on);

// The action set is DERIVED from the coordinator, never hand-listed here: a
// hand-written array only ever covers the actions its author remembered, and
// an action the graph does not route wedges a live run. `stepCard` is what
// the advance verb calls; the terminal actions advance itself returns are
// added from the verb's own body.
function functionBody(src, header) {
  const start = src.indexOf(header);
  if (start < 0) throw new Error(`coordinator source has no ${header}`);
  // Skip the parameter list before looking for the body brace: a default
  // parameter (opts = {}) otherwise closes the scan on its own braces.
  let p = src.indexOf('(', start), pd = 0, bodyStart = -1;
  for (let j = p; j < src.length; j++) {
    if (src[j] === '(') pd++;
    else if (src[j] === ')') { pd--; if (pd === 0) { bodyStart = src.indexOf('{', j); break; } }
  }
  if (bodyStart < 0) throw new Error(`no body brace after ${header}`);
  let depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(bodyStart, j + 1); }
  }
  throw new Error(`unbalanced braces after ${header}`);
}
const actionsIn = (body) => Array.from(new Set((body.match(/action: '[a-z-]+'/g) || []).map((m) => m.slice(9, -1))));
const STEP_ACTIONS = actionsIn(functionBody(COORD_SRC, 'async function stepCard('));
const ADVANCE_TERMINALS = ['complete', 'completion-projection-failed', 'deploy-failed'].filter((a) => COORD_SRC.includes(`action: '${a}'`));
const ADVANCE_ACTIONS = Array.from(new Set([...STEP_ACTIONS, ...ADVANCE_TERMINALS]));
ok('DG-3 the advance action set is derived from stepCard, not hand-listed', STEP_ACTIONS.length >= 11 && STEP_ACTIONS.includes('parked') && STEP_ACTIONS.includes('phase-change'), STEP_ACTIONS.join(','));
const advanceOn = outOf('advance');
ok('DG-4 every derived advance action is an on: edge out of advance', ADVANCE_ACTIONS.every((a) => advanceOn.includes(a)), 'unrouted: ' + ADVANCE_ACTIONS.filter((a) => !advanceOn.includes(a)).join(','));
ok('DG-4b every node an advance edge points at is terminal, a repair, or advance itself',
  parsed.graph.edges.filter((e) => e.from === 'advance').every((e) => {
    const n = parsed.graph.nodes.find((x) => x.id === e.to);
    return n && (n.type === 'end' || n.type === 'agent' || n.id === 'advance' || n.id === 'wait' || n.id === 'verify-gates' || n.id === 'implement');
  }));
const CLAIM_ACTIONS = ['implement', 'no-work', 'at-capacity', 'all-work-leased', 'halted', 'blocked'];
const claimOn = outOf('claim');
ok('DG-5 every claim outcome is an on: edge out of claim', CLAIM_ACTIONS.every((a) => claimOn.includes(a)), CLAIM_ACTIONS.filter((a) => !claimOn.includes(a)).join(','));
const lensNodes = parsed.graph.nodes.filter((n) => /^lens-/.test(n.id));
const LENS_BINDINGS = [['record-correctness', 'correctness', 'lens-correctness'], ['record-regression', 'regression', 'lens-regression'], ['record-adequacy', 'test-adequacy', 'lens-adequacy']];
ok('DG-6 three lenses, each recorded under its own name AND carrying its own verdict',
  lensNodes.length === 3 && LENS_BINDINGS.every(([rec, lens, src]) => {
    const n = parsed.graph.nodes.find((x) => x.id === rec);
    return n && n.type === 'shell' && n.run.includes(`--lens ${lens} `) && n.run.includes(`--verdict \${result.${src}.outcome}`) && n.outcome === `\${result.${src}.outcome}`;
  }), LENS_BINDINGS.filter(([rec, lens, src]) => { const n = parsed.graph.nodes.find((x) => x.id === rec); return !(n && n.run.includes(`--lens ${lens} `) && n.run.includes(`--verdict \${result.${src}.outcome}`)); }).map((b) => b[0]).join(','));
const LEASED_VERBS = ['record-review', 'verify-gates', 'record-pr', 'advance'];
ok('DG-6b every leased coordinator verb in the graph carries the lease token',
  LEASED_VERBS.every((verb) => parsed.graph.nodes.filter((n) => n.type === 'shell' && n.run.includes(` ${verb} `)).every((n) => n.run.includes('--lease-token \${vars.lease_token}'))),
  LEASED_VERBS.filter((verb) => !parsed.graph.nodes.filter((n) => n.type === 'shell' && n.run.includes(` ${verb} `)).every((n) => n.run.includes('--lease-token \${vars.lease_token}'))).join(','));
const repairEdges = parsed.graph.edges.filter((e) => e.to === 'implement' && e.max === 1);
ok('DG-7 every repair edge shares ONE budget, so the card gets one repair in total, not one per gate',
  repairEdges.length >= 4 && repairEdges.every((e) => e.budget === 'repair'),
  repairEdges.filter((e) => e.budget !== 'repair').map((e) => e.from).join(','));
ok('DG-7b exhaustion routes through the supersession-depth probe before any human supersede',
  parsed.graph.edges.filter((e) => e.on === 'exhausted').length >= 4
  && parsed.graph.edges.filter((e) => e.on === 'exhausted').every((e) => e.to === 'supersession-depth')
  && parsed.graph.nodes.some((n) => n.id === 'supersession-depth' && n.run.includes('supersession-depth'))
  && parsed.graph.edges.some((e) => e.from === 'supersession-depth' && e.to === 'depth-exceeded'));
const prCmd = String((parsed.graph.vars || {}).pr_command || '');
ok('DG-9 the pr node tolerates an existing PR: it views before it creates',
  /gh pr view/.test(prCmd) && /gh pr create/.test(prCmd) && prCmd.indexOf('gh pr view') < prCmd.indexOf('gh pr create') && /\|\|/.test(prCmd), prCmd);
ok('DG-9b every re-entry path leads back through verify-gates, not straight to pr',
  ['fix-ci', 'refresh'].every((n) => parsed.graph.edges.filter((e) => e.from === n).every((e) => e.to === 'verify-gates')));
const phases = ['claimed', 'feature_pr', 'feature_merged', 'release_pr', 'tagged', 'tap_pr', 'deployed'];
ok('DG-8 the seven coordinator phases are reachable through phase-change/deploy self-edges', parsed.graph.edges.some((e) => e.from === 'advance' && e.to === 'advance' && e.on === 'phase-change' && e.max >= phases.length));

// ---- dynamic: stub coordinator + fake worker (DR-*) ----
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-delivery-vault-'));
fs.mkdirSync(path.join(vault, 'ranch'), { recursive: true });
fs.writeFileSync(path.join(vault, 'ranch', 'platform-config.json'), '{}\n');
fs.mkdirSync(path.join(vault, 'graphs'), { recursive: true });
const NOTE = path.join(vault, 'graphs', 'delivery-slice.md');
fs.copyFileSync(GRAPH, NOTE);
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-delivery-wt-'));
const git = (args) => execFileSync('git', args, { cwd: worktree, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '-q', '-b', 'main']); git(['config', 'user.email', 'e@t']); git(['config', 'user.name', 'e']);
fs.writeFileSync(path.join(worktree, 'a.txt'), 'a\n'); git(['add', '.']); git(['commit', '-qm', 'init']);
const HEAD = git(['rev-parse', 'HEAD']);

function scenarioFile(name, scenario) {
  const p = path.join(vault, `${name}.scenario.json`);
  fs.writeFileSync(p, JSON.stringify(scenario));
  return p;
}
function runGraph(scenarioPath, extraVars) {
  const log = `${scenarioPath}.log`;
  const created = engine.createRun({ vault, notePath: NOTE, workerOverride: 'fake', vars: Object.assign({ coordinator: STUB, gate: '/dev/null', wait_seconds: '0', adequacy_command: 'true', pr_command: 'echo \'{"number": 7, "url": "https://example/pr/7"}\'' }, extraVars || {}), env: { STUB_SCENARIO: scenarioPath, STUB_LOG: log } });
  const r = engine.follow(created.ctx, { intervalSeconds: 1 });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  return { r, calls, created };
}

const happy = scenarioFile('happy', {
  claim: [{ ok: true, action: 'implement', card: 'GA-1 Demo slice', branch: 'codex-autoloop/ga-1', worktree, lease_token: 'tok-1', phase: 'claimed' }],
  'record-review': [{ ok: true, action: 'review-recorded' }],
  'verify-gates': [{ ok: true, action: 'gates-passed' }],
  'record-pr': [{ ok: true, action: 'pr-recorded', pr: 7 }],
  advance: [{ ok: true, action: 'phase-change', phase: 'feature_pr' }, { ok: true, action: 'waiting', phase: 'feature_pr' }, { ok: true, action: 'phase-change', phase: 'feature_merged' }, { ok: true, action: 'deploy' }, { ok: true, action: 'complete' }],
});
const h = runGraph(happy);
ok('DR-1 happy path ends done', h.r.status === 'done', JSON.stringify({ status: h.r.status, nodes: h.r.nodes }));
const verbs = h.calls.map((c) => c.verb);
ok('DR-2 coordinator verb sequence: claim, 3 record-review, verify-gates, record-pr, 5 advance', verbs.join(' ') === 'claim record-review record-review record-review verify-gates record-pr advance advance advance advance advance', verbs.join(' '));
const rr = h.calls.filter((c) => c.verb === 'record-review');
ok('DR-3 record-review carries card, lens, verdict pass, exact head, and the lease token', rr.every((c) => c.args.includes('GA-1 Demo slice') && c.args.includes('pass') && c.args.includes(HEAD) && c.args.includes('tok-1')) && ['correctness', 'regression', 'test-adequacy'].every((l) => rr.some((c) => c.args.includes(l))), JSON.stringify(rr.map((c) => c.args)));
ok('DR-4 record-pr carries the PR number captured from pr_command', h.calls.some((c) => c.verb === 'record-pr' && c.args.includes('7')));
const sH = engine.reduce(h.created.ctx.graph, engine.readEvents(vault, h.created.runId));
ok('DR-5 implement ran once in the coordinator worktree; wait node ran once', sH.nodes.implement.attempts === 1 && sH.results.implement.cwd === path.resolve(worktree) && sH.nodes.wait.attempts === 1, JSON.stringify({ cwd: sH.results.implement.cwd, wt: worktree }));
ok('DR-6 vars captured from claim receipt', sH.vars.card === 'GA-1 Demo slice' && sH.vars.lease_token === 'tok-1' && sH.vars.branch === 'codex-autoloop/ga-1' && sH.vars.pr === 7);

const refuted = scenarioFile('refuted', Object.assign({}, JSON.parse(fs.readFileSync(happy, 'utf8')), { advance: [{ ok: true, action: 'complete' }] }));
// The fake worker's lens-regression node answers refute on attempt 1 and pass on attempt 2 via the node's fake script.
const refNote = fs.readFileSync(NOTE, 'utf8').replace("  - id: lens-regression\n    type: agent\n    worker: claude-code\n", "  - id: lens-regression\n    type: agent\n    worker: claude-code\n    fake: [refute, pass]\n");
fs.writeFileSync(NOTE, refNote);
const rf = runGraph(refuted);
const sR = engine.reduce(rf.created.ctx.graph, engine.readEvents(vault, rf.created.runId));
ok('DR-7 a refuted lens repairs once (implement twice, full quorum rerun) and still completes', rf.r.status === 'done' && sR.nodes.implement.attempts === 2 && sR.nodes['lens-correctness'].attempts === 2 && sR.nodes['lens-regression'].attempts === 2 && sR.edge_counts['budget:repair'] === 1, JSON.stringify({ status: rf.r.status, attempts: Object.fromEntries(Object.entries(sR.nodes).map(([k, n]) => [k, n.attempts])) }));
const rrR = rf.calls.filter((c) => c.verb === 'record-review');
ok('DR-8 the refutation was recorded as --verdict refute before the repair', rrR.some((c) => c.args.includes('regression') && c.args.includes('refute')));
fs.writeFileSync(NOTE, fs.readFileSync(GRAPH, 'utf8'));

const twice = fs.readFileSync(NOTE, 'utf8').replace("  - id: lens-adequacy\n    type: agent\n    worker: claude-code\n", "  - id: lens-adequacy\n    type: agent\n    worker: claude-code\n    fake: refute\n");
fs.writeFileSync(NOTE, twice);
const exScenario = Object.assign(JSON.parse(fs.readFileSync(refuted, 'utf8')), { 'supersession-depth': [{ ok: true, status: 'ok', depth: 1 }] });
const ex = runGraph(scenarioFile('exhausted', exScenario));
ok('DR-9 a second refutation probes supersession-depth, then parks on the human supersede node',
  ex.r.status === 'parked' && ex.r.parked.node === 'supersede' && ex.calls.some((c) => c.verb === 'supersession-depth' && c.args.includes('GA-1 Demo slice')),
  JSON.stringify({ status: ex.r.status, parked: ex.r.parked, verbs: ex.calls.map((c) => c.verb).join(',') }));
const atLimit = Object.assign(JSON.parse(fs.readFileSync(refuted, 'utf8')), { 'supersession-depth': [{ ok: true, status: 'at-limit', depth: 3 }] });
const al = runGraph(scenarioFile('at-limit', atLimit));
ok('DR-9b a lineage already at the ceiling ends the run instead of superseding again',
  al.r.status === 'supersession-depth-exceeded' && al.r.nodes.supersede === 'idle', JSON.stringify({ status: al.r.status, supersede: al.r.nodes.supersede }));
fs.writeFileSync(NOTE, fs.readFileSync(GRAPH, 'utf8'));

// Two DIFFERENT lenses refuting must still buy only ONE repair for the card.
const twoLens = fs.readFileSync(NOTE, 'utf8')
  .replace('  - id: lens-correctness\n    type: agent\n    worker: claude-code\n', '  - id: lens-correctness\n    type: agent\n    worker: claude-code\n    fake: [refute, pass]\n')
  .replace('  - id: lens-regression\n    type: agent\n    worker: claude-code\n', '  - id: lens-regression\n    type: agent\n    worker: claude-code\n    fake: refute\n');
fs.writeFileSync(NOTE, twoLens);
const tl = runGraph(scenarioFile('two-lens', exScenario));
const sTL = engine.reduce(tl.created.ctx.graph, engine.readEvents(vault, tl.created.runId));
ok('DR-9c refutations from two different lenses share ONE repair budget and then stop',
  sTL.nodes.implement.attempts === 2 && sTL.edge_counts['budget:repair'] === 1 && tl.calls.some((c) => c.verb === 'supersession-depth') && tl.r.status === 'parked',
  JSON.stringify({ implement: sTL.nodes.implement.attempts, counts: sTL.edge_counts, status: tl.r.status }));
fs.writeFileSync(NOTE, fs.readFileSync(GRAPH, 'utf8'));

// A CI failure re-enters through verify-gates and must not re-create the PR.
const marker = path.join(vault, 'pr-created');
const prEmulator = `if [ -f ${JSON.stringify(marker)} ]; then cat ${JSON.stringify(marker)}; else printf '%s' '{"number":7,"url":"u"}' > ${JSON.stringify(marker)}; cat ${JSON.stringify(marker)}; fi`;
const ciScenario = Object.assign(JSON.parse(fs.readFileSync(happy, 'utf8')), { advance: [{ ok: true, action: 'fix-ci', pr: 7, failed_checks: ['preflight'] }, { ok: true, action: 'complete' }], 'verify-gates': [{ ok: true, action: 'gates-passed' }] });
const ci = runGraph(scenarioFile('fix-ci', ciScenario), { pr_command: prEmulator });
const sCI = engine.reduce(ci.created.ctx.graph, engine.readEvents(vault, ci.created.runId));
ok('DR-9d a fix-ci re-entry re-verifies and re-records the PR without failing the run',
  ci.r.status === 'done' && sCI.nodes['fix-ci'].attempts === 1 && sCI.nodes['verify-gates'].attempts === 2 && sCI.nodes.pr.attempts === 2 && sCI.nodes.pr.outcome === 'pass',
  JSON.stringify({ status: ci.r.status, pr: sCI.nodes.pr, fixci: sCI.nodes['fix-ci'].attempts }));

// The coordinator's own parked action must route, not wedge the run.
const pk = runGraph(scenarioFile('parked', Object.assign(JSON.parse(fs.readFileSync(happy, 'utf8')), { advance: [{ ok: true, action: 'parked', card: 'GA-1 Demo slice', dependencies: ['GA-0'], resume_condition: 'GA-0 deployed' }] })));
const sPK = engine.reduce(pk.created.ctx.graph, engine.readEvents(vault, pk.created.runId));
ok('DR-9e advance returning parked ends the run terminally, never a silent wedge',
  pk.r.status === 'parked-on-dependency' && engine.isTerminal(sPK) === true && pk.r.parked === null, JSON.stringify({ status: pk.r.status, terminal: engine.isTerminal(sPK) }));
const pkAgain = engine.tick(pk.created.ctx);
ok('DR-9f a second tick on that run executes nothing', pkAgain.executed.length === 0 && pkAgain.status === 'parked-on-dependency');

// A hostile card title reaches the shell as one literal operand.
const injMarker = path.join(vault, 'PWNED');
const injScenario = Object.assign(JSON.parse(fs.readFileSync(happy, 'utf8')), { claim: [{ ok: true, action: 'implement', card: `GA-2 $(touch ${injMarker}) it's quoted`, branch: 'b', worktree, lease_token: 'tok-1' }] });
const inj = runGraph(scenarioFile('injection', injScenario));
const recCard = (inj.calls.find((c) => c.verb === 'record-review') || { args: [] }).args;
ok('DR-9g a card title carrying $(...) and a quote is passed through literally and executes nothing',
  !fs.existsSync(injMarker) && recCard.includes(`GA-2 $(touch ${injMarker}) it's quoted`),
  JSON.stringify({ pwned: fs.existsSync(injMarker), card: recCard[recCard.indexOf('--card') + 1] }));

// The lease token must reach every mutating verb, not just record-review.
const leased = inj.calls.filter((c) => ['record-review', 'verify-gates', 'record-pr', 'advance'].includes(c.verb));
ok('DR-9h every mutating coordinator call carried the claim lease token',
  leased.length >= 6 && leased.every((c) => c.args.includes('--lease-token') && c.args[c.args.indexOf('--lease-token') + 1] === 'tok-1'),
  leased.filter((c) => !c.args.includes('--lease-token')).map((c) => c.verb).join(','));

const idle = runGraph(scenarioFile('idle', { claim: [{ ok: true, action: 'no-work', reason: 'no eligible execution card' }] }));
ok('DR-10 no-work ends the run without touching implement', idle.r.status === 'no-work' && idle.r.nodes.implement === 'idle' && idle.calls.length === 1);
const cap = runGraph(scenarioFile('cap', { claim: [{ ok: true, action: 'at-capacity' }] }));
ok('DR-11 at-capacity ends the run at-capacity', cap.r.status === 'at-capacity');

fs.rmSync(vault, { recursive: true, force: true });
fs.rmSync(worktree, { recursive: true, force: true });

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
