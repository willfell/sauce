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
const ADVANCE_ACTIONS = ['phase-change', 'waiting', 'fix-ci', 'refresh-feature', 'verify-gates', 'needs-implementation', 'deploy', 'complete', 'completion-projection-failed', 'blocked', 'blocked-external', 'needs-inspection', 'deploy-failed'];
const inSource = ADVANCE_ACTIONS.filter((a) => COORD_SRC.includes(`action: '${a}'`));
ok('DG-3 every advance-path action literal exists in the coordinator source', inSource.length === ADVANCE_ACTIONS.length, ADVANCE_ACTIONS.filter((a) => !inSource.includes(a)).join(','));
const advanceOn = outOf('advance');
ok('DG-4 every advance action is an on: edge out of advance', ADVANCE_ACTIONS.every((a) => advanceOn.includes(a)), ADVANCE_ACTIONS.filter((a) => !advanceOn.includes(a)).join(','));
const CLAIM_ACTIONS = ['implement', 'no-work', 'at-capacity', 'all-work-leased', 'halted', 'blocked'];
const claimOn = outOf('claim');
ok('DG-5 every claim outcome is an on: edge out of claim', CLAIM_ACTIONS.every((a) => claimOn.includes(a)), CLAIM_ACTIONS.filter((a) => !claimOn.includes(a)).join(','));
const lensNodes = parsed.graph.nodes.filter((n) => /^lens-/.test(n.id));
ok('DG-6 three sequential lenses, each recorded through record-review', lensNodes.length === 3 && ['correctness', 'regression', 'test-adequacy'].every((l) => parsed.graph.nodes.some((n) => n.type === 'shell' && n.run.includes(`--lens ${l}`))));
const repairEdges = parsed.graph.edges.filter((e) => e.to === 'implement' && e.max === 1);
ok('DG-7 one same-card repair per gate, then supersede on exhausted', repairEdges.length >= 4 && parsed.graph.edges.filter((e) => e.to === 'supersede' && e.on === 'exhausted').length >= 4);
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
ok('DR-7 a refuted lens repairs once (implement twice, full quorum rerun) and still completes', rf.r.status === 'done' && sR.nodes.implement.attempts === 2 && sR.nodes['lens-correctness'].attempts === 2 && sR.nodes['lens-regression'].attempts === 2 && sR.edge_counts['record-regression->implement'] === 1, JSON.stringify({ status: rf.r.status, attempts: Object.fromEntries(Object.entries(sR.nodes).map(([k, n]) => [k, n.attempts])) }));
const rrR = rf.calls.filter((c) => c.verb === 'record-review');
ok('DR-8 the refutation was recorded as --verdict refute before the repair', rrR.some((c) => c.args.includes('regression') && c.args.includes('refute')));
fs.writeFileSync(NOTE, fs.readFileSync(GRAPH, 'utf8'));

const twice = fs.readFileSync(NOTE, 'utf8').replace("  - id: lens-adequacy\n    type: agent\n    worker: claude-code\n", "  - id: lens-adequacy\n    type: agent\n    worker: claude-code\n    fake: refute\n");
fs.writeFileSync(NOTE, twice);
const ex = runGraph(scenarioFile('exhausted', JSON.parse(fs.readFileSync(refuted, 'utf8'))));
ok('DR-9 a second refutation parks on the supersede human node instead of looping', ex.r.status === 'parked' && ex.r.parked.node === 'supersede', JSON.stringify({ status: ex.r.status, parked: ex.r.parked }));
fs.writeFileSync(NOTE, fs.readFileSync(GRAPH, 'utf8'));

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
