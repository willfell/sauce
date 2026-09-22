#!/usr/bin/env node
/**
 * run-engine-graph — unit harness for the Sauce engine's pure core:
 * yaml-lite (the documented YAML subset), graph note parsing, graph
 * validation, the append-only ledger + state reducer, variable
 * substitution, worktree isolation, and per-node execution with the
 * fake worker. Zero-dep. The end-to-end run lives in run-engine-smoke.js.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ENGINE = path.resolve(__dirname, '..', 'engine');
const yaml = require(path.join(ENGINE, 'yaml-lite.js'));
const graphMod = require(path.join(ENGINE, 'graph.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}
function throwsWith(fn, re) {
  try { fn(); return null; } catch (e) { return re.test(String(e.message)) ? e : e; }
}

// ---- yaml-lite (YL-*) ----
const y1 = yaml.parse('name: demo\ncount: 3\nlive: true\nnothing: null\nquoted: "a: b"\n');
ok('YL-1 scalar map with typed values', y1.name === 'demo' && y1.count === 3 && y1.live === true && y1.nothing === null && y1.quoted === 'a: b');
const y2 = yaml.parse('nodes:\n  - id: a\n    type: agent\n  - id: b\n    type: judge\nedges:\n  - from: a\n    to: b\n');
ok('YL-2 nested list of maps', Array.isArray(y2.nodes) && y2.nodes.length === 2 && y2.nodes[1].type === 'judge' && y2.edges[0].to === 'b');
const y3 = yaml.parse('prompt: |\n  line one\n  line two\n\n  line four\nafter: x\n');
ok('YL-3 block scalar preserves newlines and blank lines', y3.prompt === 'line one\nline two\n\nline four\n' && y3.after === 'x');
const y4 = yaml.parse('edges:\n  - { from: a, to: b, on: fail, max: 2 }\n  - {from: b, to: a}\n');
ok('YL-4 inline flow maps', y4.edges[0].max === 2 && y4.edges[0].on === 'fail' && y4.edges[1].to === 'a');
const y5 = yaml.parse('list:\n  - one\n  - 2\n  - "three # not a comment"\n# comment line\nkey: value # trailing comment\n');
ok('YL-5 scalar lists and comments', y5.list[0] === 'one' && y5.list[1] === 2 && y5.list[2] === 'three # not a comment' && y5.key === 'value');
const tabErr = throwsWith(() => yaml.parse('a:\n\tb: 1\n'), /tab/);
ok('YL-6 tab indentation refused with a line number', tabErr && tabErr.line === 2 && /tab/i.test(tabErr.message), tabErr && tabErr.message);
const flowErr = throwsWith(() => yaml.parse('e:\n  - { from: a, to: b\n'), /flow/);
ok('YL-7 unbalanced flow map refused with a line number', flowErr && flowErr.line === 2, flowErr && flowErr.message);
ok('YL-8 empty document parses to an empty map', JSON.stringify(yaml.parse('')) === '{}' && JSON.stringify(yaml.parse('# only\n')) === '{}');
const y9 = yaml.parse('a:\n  b:\n    c: deep\n  d: 1\n');
ok('YL-9 nested maps', y9.a.b.c === 'deep' && y9.a.d === 1);
const y11 = yaml.parse('a: [pass, fail, 3]\nb: []\nc: [{ x: 1 }, two]\n');
ok('YL-11 flow sequences of scalars, empty, and nested flow maps', y11.a.length === 3 && y11.a[2] === 3 && y11.b.length === 0 && y11.c[0].x === 1 && y11.c[1] === 'two');
const y10 = yaml.parse('items:\n  - id: x\n    body: |\n      first\n      second\n    after: y\n');
ok('YL-10 block scalar inside a list item', y10.items[0].body === 'first\nsecond\n' && y10.items[0].after === 'y');

// ---- graph note (GN-*) ----
const NOTE = [
  '---', 'type: sauce-graph', 'repo: ~/Documents/GitHub/sauce', 'status: idle', '---', '',
  '# Fix the flaky sticky-notes harness', '',
  '```sauce',
  'nodes:',
  '  - id: implement', '    type: agent', '    worker: claude-code', '    isolate: worktree',
  '    prompt: |', '      Find the nondeterminism and fix it.', '      Commit with a conventional message.',
  '  - id: verify', '    type: judge', '    run: npm run test:sticky-notes',
  '  - id: review', '    type: agent', '    worker: codex', '    prompt: Review the diff. Answer PASS or FAIL.',
  '  - id: ship', '    type: human', '    ask: Open a PR from this branch?',
  'edges:',
  '  - { from: implement, to: verify }',
  '  - { from: verify, to: review, on: pass }',
  '  - { from: verify, to: implement, on: fail, max: 2 }',
  '  - { from: review, to: ship, on: pass }',
  '  - { from: review, to: implement, on: fail, max: 1 }',
  '```', '', 'Trailing prose.', '',
].join('\n');
const gn = graphMod.parseGraphNote(NOTE);
ok('GN-1 frontmatter parsed', gn.frontmatter.type === 'sauce-graph' && gn.frontmatter.status === 'idle');
ok('GN-2 four nodes, five edges', gn.graph.nodes.length === 4 && gn.graph.edges.length === 5);
ok('GN-3 retry budget typed', gn.graph.edges[2].max === 2 && gn.graph.edges[2].on === 'fail');
ok('GN-4 block prompt kept', /Commit with a conventional message\.\n$/.test(gn.graph.nodes[0].prompt));
ok('GN-5 block text exposed for hashing', typeof gn.block === 'string' && gn.block.startsWith('nodes:'));
const noFence = throwsWith(() => graphMod.parseGraphNote('---\ntype: sauce-graph\n---\n# no block\n'), /sauce/);
ok('GN-6 note without a sauce fence refused', noFence && noFence.name === 'GraphNoteError', noFence && noFence.message);
const twoFences = throwsWith(() => graphMod.parseGraphNote(NOTE + '\n```sauce\nnodes: []\n```\n'), /one/);
ok('GN-7 two sauce fences refused', twoFences && twoFences.name === 'GraphNoteError');
const sf = graphMod.splitFrontmatter('---\na: 1\n---\nbody\n');
ok('GN-8 splitFrontmatter separates body', sf.frontmatter.a === 1 && sf.body === 'body\n');
const sf2 = graphMod.splitFrontmatter('no frontmatter here\n');
ok('GN-9 splitFrontmatter tolerates absence', JSON.stringify(sf2.frontmatter) === '{}' && sf2.body === 'no frontmatter here\n');
ok('GN-10 renderFrontmatter round-trips a status change',
  graphMod.setFrontmatterField('---\ntype: sauce-graph\nstatus: idle\n---\nbody\n', 'status', 'running') === '---\ntype: sauce-graph\nstatus: running\n---\nbody\n'
  && graphMod.setFrontmatterField('---\ntype: sauce-graph\n---\nbody\n', 'status', 'done') === '---\ntype: sauce-graph\nstatus: done\n---\nbody\n');

// ---- validate (GV-*) ----
const { validateGraph } = require(path.join(ENGINE, 'validate.js'));
const g = (nodes, edges) => ({ nodes, edges });
const A = { id: 'a', type: 'agent', worker: 'fake', prompt: 'x' };
const B = { id: 'b', type: 'judge', run: 'true' };
const codes = (r) => r.errors.map((e) => e.code).join(',');
ok('GV-1 minimal valid graph', validateGraph(gn.graph).ok === true, codes(validateGraph(gn.graph)));
ok('GV-2 duplicate id', codes(validateGraph(g([A, { ...A }], []))).includes('duplicate_id'));
ok('GV-3 dangling edge', codes(validateGraph(g([A, B], [{ from: 'a', to: 'zz' }]))).includes('dangling_edge'));
ok('GV-4 agent without prompt', codes(validateGraph(g([{ id: 'a', type: 'agent', worker: 'fake' }], []))).includes('missing_field'));
ok('GV-5 unknown worker', codes(validateGraph(g([{ id: 'a', type: 'agent', worker: 'gpt', prompt: 'x' }], []))).includes('unknown_worker'));
ok('GV-6 bad on', codes(validateGraph(g([A, B], [{ from: 'a', to: 'b', on: 'PASS' }]))).includes('bad_on'));
ok('GV-7 bad max', codes(validateGraph(g([A, B], [{ from: 'a', to: 'b', max: 0 }]))).includes('bad_max'));
ok('GV-8 unbounded cycle refused', codes(validateGraph(g([A, B], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', on: 'fail' }]))).includes('unbounded_cycle'));
ok('GV-9 bounded cycle accepted', validateGraph(g([A, B], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a', on: 'fail', max: 1 }])).ok === true);
ok('GV-10 no entry node when every node has an unbounded incoming edge', codes(validateGraph(g([A, B], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]))).includes('no_entry'));
ok('GV-10b entries ignore bounded edges', validateGraph(gn.graph).entries.join(',') === 'implement');
ok('GV-11 judge needs exactly one of run/gate', codes(validateGraph(g([{ id: 'j', type: 'judge', run: 'x', gate: 'adequacy' }], []))).includes('missing_field')
  && codes(validateGraph(g([{ id: 'j', type: 'judge' }], []))).includes('missing_field'));
ok('GV-12 unknown type', codes(validateGraph(g([{ id: 'q', type: 'robot' }], []))).includes('unknown_type'));
ok('GV-13 empty graph', codes(validateGraph(g([], []))).includes('no_nodes'));
ok('GV-14 human needs ask, shell needs run', codes(validateGraph(g([{ id: 'h', type: 'human' }, { id: 's', type: 'shell' }], []))).split(',').filter((c) => c === 'missing_field').length === 2);
ok('GV-15 named outcomes allowed on edges', validateGraph(g([A, B], [{ from: 'a', to: 'b', on: 'needs-design' }])).ok === true);

// ---- ledger + state (LS-*) ----
const ledger = require(path.join(ENGINE, 'ledger.js'));
const state = require(path.join(ENGINE, 'state.js'));
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-vault-'));
fs.mkdirSync(path.join(vault, 'ranch'), { recursive: true });
fs.writeFileSync(path.join(vault, 'ranch', 'platform-config.json'), '{}\n');
const RUN = 'demo-20260922-120000';
const evCreated = { type: 'run.created', run_id: RUN, graph_note: 'x.md', graph_hash: 'abc', repo: null };
ledger.appendEvent(vault, RUN, evCreated);
ledger.appendEvent(vault, RUN, { type: 'node.started', node: 'implement', attempt: 1 });
const ev = ledger.readEvents(vault, RUN);
ok('LS-1 append then read round-trip with ts', ev.length === 2 && ev[0].type === 'run.created' && typeof ev[1].ts === 'string');
fs.appendFileSync(ledger.runPath(vault, RUN), '{"type":"node.fin');
ok('LS-2 trailing partial line ignored', ledger.readEvents(vault, RUN).length === 2);
const s1 = state.reduce(gn.graph, ledger.readEvents(vault, RUN));
ok('LS-3 created + started → implement running, nothing ready', s1.status === 'running' && s1.nodes.implement.status === 'running' && s1.nodes.implement.attempts === 1 && s1.ready.length === 0);
const s0 = state.reduce(gn.graph, [evCreated]);
ok('LS-4 entry nodes ready after creation', s0.ready.join(',') === 'implement');
const evs = [evCreated,
  { type: 'node.started', node: 'implement', attempt: 1 },
  { type: 'node.finished', node: 'implement', attempt: 1, outcome: 'pass', result: { summary: 'did it', vars: { head: 'h1' } } },
  { type: 'edge.fired', from: 'implement', to: 'verify', on: 'pass' },
];
const s2 = state.reduce(gn.graph, evs);
ok('LS-5 finished + edge fired → verify ready, vars merged, result stored',
  s2.ready.join(',') === 'verify' && s2.vars.head === 'h1' && s2.results.implement.summary === 'did it' && s2.edge_counts['implement->verify'] === 1);
const s3 = state.reduce(gn.graph, [evCreated, { type: 'node.finished', node: 'verify', attempt: 1, outcome: 'pass' }]);
ok('LS-6 out-of-order node.finished for a node never started is ignored', s3.nodes.verify.status === 'idle' && s3.ready.join(',') === 'implement');
const m1 = state.matchEdges(gn.graph, s2, 'verify', 'fail');
ok('LS-7 matchEdges fires the retry edge under budget', m1.fired.length === 1 && m1.fired[0].to === 'implement' && m1.exhausted.length === 0);
const s4 = { ...s2, edge_counts: { ...s2.edge_counts, 'verify->implement': 2 } };
const m2 = state.matchEdges(gn.graph, s4, 'verify', 'fail');
ok('LS-8 matchEdges reports exhausted at budget', m2.fired.length === 0 && m2.exhausted.length === 1);
const s5 = state.reduce(gn.graph, [...evs, { type: 'run.parked', node: 'ship', ask: 'Open a PR?' }]);
ok('LS-9 parked run', s5.status === 'parked' && s5.parked.node === 'ship');
const s6 = state.reduce(gn.graph, [...evs, { type: 'run.parked', node: 'ship', ask: 'q' }, { type: 'human.answered', node: 'ship', outcome: 'pass' }]);
ok('LS-10 human answered → running, node finished', s6.status === 'running' && s6.nodes.ship.status === 'finished' && s6.nodes.ship.outcome === 'pass');
const s7 = state.reduce(gn.graph, [...evs, { ts: '2026-09-22T12:00:00.000Z', type: 'run.ended', status: 'done' }]);
ok('LS-11 ended run is terminal', s7.status === 'done' && state.isTerminal(s7) === true && typeof s7.ended_at === 'string');
const s8 = state.reduce(gn.graph, [evCreated, { type: 'run.halted' }]);
ok('LS-12 halted run is terminal', s8.status === 'halted' && state.isTerminal(s8) === true);
const RUN2 = 'demo-20260922-130000';
ledger.appendEvent(vault, RUN2, { ...evCreated, run_id: RUN2 });
ledger.appendEvent(vault, RUN2, { type: 'run.ended', status: 'failed' });
const runs = ledger.listRuns(vault);
ok('LS-13 listRuns derives an index at read time, newest first', runs.length === 2 && runs[0].run_id === RUN2 && runs[0].status === 'failed' && runs[1].run_id === RUN);
ok('LS-14 no index file was written', !fs.readdirSync(ledger.runsDir(vault)).some((f) => /index/i.test(f)));

// ---- vars (VR-*) ----
const vars = require(path.join(ENGINE, 'vars.js'));
const vctx = { run: { id: RUN }, vars: { coordinator: '/c.js' }, results: { claim: { receipt: { lease_token: 'tok' }, summary: 'ok' } }, node: { id: 'n' } };
ok('VR-1 run, vars, result, node tokens',
  vars.substitute('${run.id} ${vars.coordinator} ${result.claim.receipt.lease_token} ${result.claim.summary} ${node.id}', vctx) === `${RUN} /c.js tok ok n`);
const vErr = throwsWith(() => vars.substitute('${vars.missing}', vctx), /missing/);
ok('VR-2 unknown reference throws VarsError', vErr && vErr.name === 'VarsError');
ok('VR-3 text without tokens untouched', vars.substitute('plain $ text {x}', vctx) === 'plain $ text {x}');
ok('VR-4 non-string values stringified', vars.substitute('${result.claim.receipt}', vctx) === '{"lease_token":"tok"}');

// ---- isolation (IS-*) ----
const iso = require(path.join(ENGINE, 'isolation.js'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-repo-'));
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'engine@test']); git(['config', 'user.name', 'engine']);
fs.writeFileSync(path.join(repo, 'README.md'), 'hi\n'); git(['add', '.']); git(['commit', '-qm', 'init']);
const wt1 = iso.createWorktree({ repo, dest: path.join(repo, '.worktrees', 'sauce', 'r1-build'), branch: 'sauce/r1-build', base: 'main' });
ok('IS-1 worktree created on the branch', fs.existsSync(path.join(wt1.path, 'README.md')) && git(['rev-parse', '--abbrev-ref', 'HEAD'], wt1.path) === 'sauce/r1-build');
const wt1again = iso.createWorktree({ repo, dest: wt1.path, branch: 'sauce/r1-build', base: 'main' });
ok('IS-2 createWorktree is idempotent', wt1again.path === wt1.path);
const wt2 = iso.createWorktree({ repo, dest: path.join(repo, '.worktrees', 'sauce', 'r1-review'), branch: 'sauce/r1-review', base: 'main' });
fs.writeFileSync(path.join(wt2.path, 'new.txt'), 'x\n'); git(['add', '.'], wt2.path); git(['commit', '-qm', 'work'], wt2.path);
const sw = iso.sweep({ repo, worktrees: [wt1.path, wt2.path], baseRef: 'main' });
ok('IS-3 sweep removes the clean worktree and keeps the one with commits ahead',
  sw.removed.length === 1 && sw.removed[0] === wt1.path && sw.kept.length === 1 && sw.kept[0].path === wt2.path && /ahead/.test(sw.kept[0].reason), JSON.stringify(sw));
ok('IS-4 removed worktree is gone from disk and git', !fs.existsSync(wt1.path) && !git(['worktree', 'list']).includes('r1-build'));
iso.removeWorktree({ repo, path: wt2.path, force: true });
ok('IS-5 removeWorktree with force drops a worktree with commits', !fs.existsSync(wt2.path));

// ---- nodes + workers (ND-*) ----
const workers = require(path.join(ENGINE, 'workers', 'index.js'));
const nodes = require(path.join(ENGINE, 'nodes.js'));
const runDir = path.join(ledger.runsDir(vault), RUN);
fs.mkdirSync(runDir, { recursive: true });
const baseCtx = { vault, runId: RUN, runDir, repo: null, notePath: path.join(vault, 'x.md'), state: state.reduce(gn.graph, [evCreated]), graph: gn.graph };
const rp = path.join(runDir, 'probe', 'result.json');
fs.mkdirSync(path.dirname(rp), { recursive: true });
workers.publishResult(rp, { schema: 'sauce.worker-result.v1', outcome: 'pass', summary: 's' });
ok('ND-1 publishResult writes by rename and leaves no tmp', fs.existsSync(rp) && !fs.existsSync(rp + '.tmp') && workers.readResult(rp).outcome === 'pass');
fs.writeFileSync(rp, '{"schema":"sauce.worker-result.v1","outcome":"pa');
ok('ND-2 readResult null on a partial file', workers.readResult(rp) === null);
ok('ND-3 readResult null on schema mismatch', (fs.writeFileSync(rp, '{"outcome":"pass"}'), workers.readResult(rp) === null));
const r1 = nodes.runNode(baseCtx, { id: 'f1', type: 'agent', worker: 'fake', prompt: 'hi ${node.id}', fake: 'pass', fake_vars: { k: 'v' } });
ok('ND-4 fake agent pass with vars', r1.outcome === 'pass' && r1.result.vars.k === 'v' && fs.readFileSync(path.join(runDir, 'f1', 'prompt.md'), 'utf8').includes('hi f1'));
const r2 = nodes.runNode(baseCtx, { id: 'f2', type: 'agent', worker: 'fake', prompt: 'x', fake: 'pass', fake_write_result: false });
ok('ND-5 worker exit 0 without result.json → fail', r2.outcome === 'fail' && /result/.test(r2.result.summary));
const r3 = nodes.runNode({ ...baseCtx, state: { ...baseCtx.state, nodes: { ...baseCtx.state.nodes, f3: { status: 'running', attempts: 2 } } } }, { id: 'f3', type: 'agent', worker: 'fake', prompt: 'x', fake: ['fail', 'pass'] });
ok('ND-6 fake outcome indexed by attempt', r3.outcome === 'pass');
const r4 = nodes.runNode(baseCtx, { id: 's1', type: 'shell', run: 'echo \'{"action":"waiting","n":2}\'', capture: 'json', outcome_from: 'action' });
ok('ND-7 shell capture json + outcome_from', r4.outcome === 'waiting' && r4.result.receipt.n === 2);
const r5 = nodes.runNode(baseCtx, { id: 'j1', type: 'judge', run: 'exit 3' });
ok('ND-8 judge non-zero exit → fail with exit code', r5.outcome === 'fail' && r5.result.exit_code === 3);
const r6 = nodes.runNode(baseCtx, { id: 'j2', type: 'judge', run: 'true' });
ok('ND-9 judge zero exit → pass', r6.outcome === 'pass');
const r7 = nodes.runNode(baseCtx, { id: 'h1', type: 'human', ask: 'ok?' });
ok('ND-10 human node parks', r7.outcome === 'parked');
const r8 = nodes.runNode(baseCtx, { id: 'e1', type: 'end', outcome: 'abandoned' });
ok('ND-11 end node yields its named outcome', r8.outcome === 'abandoned');
const r9 = nodes.runNode({ ...baseCtx, workerOverride: 'fake' }, { id: 'f4', type: 'agent', worker: 'claude-code', prompt: 'x', fake: 'pass' });
ok('ND-12 worker override routes claude-code to fake', r9.outcome === 'pass');
const r10 = nodes.runNode({ ...baseCtx, state: { ...baseCtx.state, vars: { who: 'me' } } }, { id: 's2', type: 'shell', run: 'echo ${vars.who}' });
ok('ND-13 shell run text is substituted', r10.outcome === 'pass' && r10.result.stdout.trim() === 'me');
ok('ND-14 prompt tail names the result path and schema', /result\.json/.test(workers.promptTail('/tmp/r/result.json')) && /sauce\.worker-result\.v1/.test(workers.promptTail('/tmp/r/result.json')));

// ---- launchd (LD-*) ----
const launchd = require(path.join(ENGINE, 'launchd.js'));
const plist = launchd.renderPlist({ user: 'will', home: '/Users/will', nodePath: '/usr/local/bin/node', cliPath: '/opt/sauce/platform/cli/sauce-cli.js', notePath: '/Users/will/vault/spice/graphs/nightly.md', slug: 'nightly', intervalSeconds: 600 });
ok('LD-1 plist carries the label, note path, cli, interval and no template residue',
  plist.includes('<string>com.will.sauce-run.nightly</string>') && plist.includes('<string>/Users/will/vault/spice/graphs/nightly.md</string>') && plist.includes('<string>/opt/sauce/platform/cli/sauce-cli.js</string>') && plist.includes('<integer>600</integer>') && !plist.includes('{{$'));
ok('LD-2 plist dict and array tags balance', (plist.match(/<dict>/g) || []).length === (plist.match(/<\/dict>/g) || []).length && (plist.match(/<array>/g) || []).length === (plist.match(/<\/array>/g) || []).length);
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-home-'));
const calls = [];
const origHome = os.homedir;
os.homedir = () => fakeHome;
const inst = launchd.install({ notePath: '/Users/will/vault/spice/graphs/nightly.md', intervalSeconds: 300, cliPath: '/opt/sauce/platform/cli/sauce-cli.js', launchctl: (cmd) => calls.push(cmd) });
ok('LD-3 install writes the plist under LaunchAgents and loads it', fs.existsSync(inst.plist) && inst.plist.startsWith(path.join(fakeHome, 'Library', 'LaunchAgents')) && calls.some((c) => /launchctl load -w/.test(c)));
const un = launchd.uninstall({ notePath: '/Users/will/vault/spice/graphs/nightly.md', launchctl: (cmd) => calls.push(cmd) });
ok('LD-4 uninstall unloads and removes the plist', un.removed === true && !fs.existsSync(inst.plist));
os.homedir = origHome;
fs.rmSync(fakeHome, { recursive: true, force: true });

fs.rmSync(vault, { recursive: true, force: true });
fs.rmSync(repo, { recursive: true, force: true });

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
