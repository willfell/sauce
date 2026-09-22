#!/usr/bin/env node
/**
 * run-engine-smoke — end-to-end harness for the Sauce engine: a temp vault,
 * a temp git repo, and graph notes driven by the fake worker through
 * createRun → tick/follow → ledger → projection → human node → halt, plus
 * the `sauce run` CLI verb on top. Zero-dep.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ENGINE = path.resolve(__dirname, '..', 'engine');
const engine = require(path.join(ENGINE, 'index.js'));
const projection = require(path.join(ENGINE, 'projection.js'));
const CLI = path.resolve(__dirname, '..', 'cli', 'sauce-cli.js');

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-smoke-vault-'));
fs.mkdirSync(path.join(vault, 'ranch'), { recursive: true });
fs.writeFileSync(path.join(vault, 'ranch', 'platform-config.json'), JSON.stringify({ workshop_relative_path: path.resolve(__dirname, '..', '..'), variables: {} }, null, 2) + '\n');
fs.mkdirSync(path.join(vault, 'spice', 'graphs'), { recursive: true });
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-smoke-repo-'));
const git = (args, cwd) => execFileSync('git', args, { cwd: cwd || repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git(['init', '-q', '-b', 'main']); git(['config', 'user.email', 'e@t']); git(['config', 'user.name', 'e']);
fs.writeFileSync(path.join(repo, 'README.md'), 'repo\n'); git(['add', '.']); git(['commit', '-qm', 'init']);

function writeNote(name, body) {
  const p = path.join(vault, 'spice', 'graphs', name);
  fs.writeFileSync(p, body);
  return p;
}

// ---- Graph A: plan → build (retry once via check) → check ----
const NOTE_A = writeNote('fix-flaky-harness.md', [
  '---', 'type: sauce-graph', `repo: ${repo}`, 'status: idle', '---', '',
  '# Fix the flaky harness', '', 'Some prose the projection must keep.', '',
  '```sauce',
  'nodes:',
  '  - id: plan', '    type: agent', '    worker: fake', '    isolate: none', '    prompt: Plan the fix.', '    fake: pass', '    fake_vars: { topic: flaky-harness }',
  '  - id: build', '    type: agent', '    worker: fake', '    isolate: worktree', '    prompt: Build ${vars.topic}.', '    fake: [pass, pass]', '    fake_touch: ok.txt',
  '  - id: check', '    type: judge', '    run: test -f "$SAUCE_CHECK_DIR/ok.txt" && test "$(cat $SAUCE_CHECK_DIR/ok.txt)" = "build attempt 2"',
  'edges:',
  '  - { from: plan, to: build }',
  '  - { from: build, to: check }',
  '  - { from: check, to: build, on: fail, max: 1 }',
  '```', '',
].join('\n'));

const a = engine.createRun({ vault, notePath: NOTE_A, now: new Date(2026, 8, 22, 12, 0, 0) });
ok('SM-1 run id is slug + stamp', a.runId === 'fix-flaky-harness-20260922-120000', a.runId);
ok('SM-2 ledger seeded with run.created carrying the repo and graph hash',
  (ev => ev.length === 1 && ev[0].type === 'run.created' && ev[0].repo === repo && /^[0-9a-f]{16}$/.test(ev[0].graph_hash) && ev[0].graph_note === 'spice/graphs/fix-flaky-harness.md')(engine.readEvents(vault, a.runId)));
// The judge reads the build worktree; expose it through the env the shell node inherits.
const wtA = path.join(repo, '.worktrees', 'sauce', `${a.runId}-build`);
a.ctx.env = { SAUCE_CHECK_DIR: wtA };
const r1 = engine.tick(a.ctx);
ok('SM-3 run completes done after one retry', r1.status === 'done' && r1.nodes.plan === 'pass' && r1.nodes.build === 'pass' && r1.nodes.check === 'pass', JSON.stringify(r1));
const evA = engine.readEvents(vault, a.runId);
const sA = engine.reduce(a.ctx.graph, evA);
ok('SM-4 build ran twice, check twice, retry edge fired once, exactly one run.ended',
  sA.nodes.build.attempts === 2 && sA.nodes.check.attempts === 2 && sA.edge_counts['check->build'] === 1 && evA.filter((e) => e.type === 'run.ended').length === 1, JSON.stringify(sA.edge_counts));
ok('SM-5 handoff: build prompt carries plan summary and substituted var',
  (p => /## Handoff context/.test(p) && /From node `plan`/.test(p) && /Build flaky-harness\./.test(p))(fs.readFileSync(path.join(a.ctx.runDir, 'build', 'prompt.md'), 'utf8')));
ok('SM-6 build ran in a worktree on its own branch', fs.existsSync(path.join(wtA, 'ok.txt')) && git(['rev-parse', '--abbrev-ref', 'HEAD'], wtA) === `sauce/${a.runId}-build` && r1.worktrees.includes(wtA));
ok('SM-7 per-node artifacts on disk', ['plan/result.json', 'plan/prompt.md', 'build/stdout.log', 'check/command.txt', 'check/stdout.log'].every((f) => fs.existsSync(path.join(a.ctx.runDir, f))));
const r1again = engine.tick(a.ctx);
ok('SM-8 ticking a finished run is a no-op', r1again.status === 'done' && r1again.executed.length === 0 && engine.readEvents(vault, a.runId).length === evA.length);
const noteA = fs.readFileSync(NOTE_A, 'utf8');
ok('SM-9 projection: status frontmatter, Runs section with markers, prose preserved',
  /^---\ntype: sauce-graph\nrepo: .*\nstatus: done\n---/.test(noteA) && noteA.includes('## Runs') && noteA.includes(projection.BEGIN) && noteA.includes('Some prose the projection must keep.') && /● `build` agent · pass · attempts 2/.test(noteA), noteA.slice(0, 200));
engine.writeProjection(NOTE_A, sA, a.ctx.graph);
ok('SM-10 projection rewrite is idempotent', fs.readFileSync(NOTE_A, 'utf8') === noteA);
ok('SM-11 listRuns derives the index', (l => l.length === 1 && l[0].run_id === a.runId && l[0].status === 'done')(engine.listRuns(vault)));

// ---- Graph B: human node parks, answer resumes; decision routes a named outcome ----
const NOTE_B = writeNote('ship-it.md', [
  '---', 'type: sauce-graph', 'status: idle', '---', '', '# Ship it', '',
  '```sauce',
  'nodes:',
  '  - id: draft', '    type: agent', '    worker: fake', '    prompt: Draft.', '    fake: pass',
  '  - id: approve', '    type: human', '    ask: Open a PR from this branch?',
  '  - id: ship', '    type: shell', '    run: echo shipped',
  '  - id: shelved', '    type: end', '    outcome: shelved',
  'edges:',
  '  - { from: draft, to: approve }',
  '  - { from: approve, to: ship, on: pass }',
  '  - { from: approve, to: shelved, on: later }',
  '```', '',
].join('\n'));
const b = engine.createRun({ vault, notePath: NOTE_B });
const rb1 = engine.tick(b.ctx);
const noteB1 = fs.readFileSync(NOTE_B, 'utf8');
ok('SM-12 human node parks the run and writes an unchecked box', rb1.status === 'parked' && rb1.parked.node === 'approve' && /status: parked/.test(noteB1) && new RegExp(`- \\[ \\] run:${b.runId} node:approve — Open a PR from this branch\\?`).test(noteB1));
const rb2 = engine.tick(b.ctx);
ok('SM-13 parked run stays parked while the box is unticked', rb2.status === 'parked' && rb2.executed.length === 0);
fs.writeFileSync(NOTE_B, fs.readFileSync(NOTE_B, 'utf8').replace(`- [ ] run:${b.runId} node:approve`, `- [x] run:${b.runId} node:approve`));
const rb3 = engine.tick(b.ctx);
ok('SM-14 ticked box resumes: ship runs, run done', rb3.status === 'done' && rb3.nodes.approve === 'pass' && rb3.nodes.ship === 'pass', JSON.stringify(rb3));
const evB = engine.readEvents(vault, b.runId);
ok('SM-15 ledger records human.answered once', evB.filter((e) => e.type === 'human.answered').length === 1);
fs.writeFileSync(NOTE_B, fs.readFileSync(NOTE_B, 'utf8').replace(`- [x] run:${b.runId}`, `- [ ] run:${b.runId}`).replace(`- [ ] run:${b.runId}`, `- [x] run:${b.runId}`));
const rb4 = engine.tick(b.ctx);
ok('SM-16 a stale ticked box on a done run appends nothing', rb4.status === 'done' && engine.readEvents(vault, b.runId).length === evB.length);
const b2 = engine.createRun({ vault, notePath: NOTE_B, now: new Date(2026, 8, 22, 13, 0, 0) });
engine.tick(b2.ctx);
fs.writeFileSync(NOTE_B, fs.readFileSync(NOTE_B, 'utf8').replace(`- [ ] run:${b2.runId} node:approve — Open a PR from this branch?`, `- [x] run:${b2.runId} node:approve — Open a PR from this branch? (decision: later)`));
const rb5 = engine.tick(b2.ctx);
ok('SM-17 a decision word routes a named outcome to its end node', rb5.status === 'shelved' && rb5.nodes.approve === 'later' && rb5.nodes.shelved === 'shelved' && rb5.nodes.ship === 'idle', JSON.stringify(rb5));

// ---- Graph C: halt via frontmatter; exhausted retry ends failed ----
const NOTE_C = writeNote('halt-me.md', ['---', 'type: sauce-graph', 'status: idle', '---', '', '```sauce', 'nodes:', '  - id: a', '    type: agent', '    worker: fake', '    prompt: x', '    fake: pass', 'edges: []', '```', ''].join('\n'));
const c = engine.createRun({ vault, notePath: NOTE_C });
fs.writeFileSync(NOTE_C, fs.readFileSync(NOTE_C, 'utf8').replace('status: idle', 'status: halted'));
const rc = engine.tick(c.ctx);
ok('SM-18 halted note runs nothing and records run.halted', rc.status === 'halted' && rc.executed.length === 0 && engine.readEvents(vault, c.runId).some((e) => e.type === 'run.halted'));
const NOTE_D = writeNote('exhaust.md', ['---', 'type: sauce-graph', 'status: idle', '---', '', '```sauce', 'nodes:', '  - id: try', '    type: agent', '    worker: fake', '    prompt: x', '    fake: fail', '  - id: fix', '    type: agent', '    worker: fake', '    prompt: y', '    fake: pass', 'edges:', '  - { from: try, to: fix, on: fail, max: 2 }', '  - { from: fix, to: try }', '```', ''].join('\n'));
const d = engine.createRun({ vault, notePath: NOTE_D });
const rd = engine.tick(d.ctx);
const sD = engine.reduce(d.ctx.graph, engine.readEvents(vault, d.runId));
ok('SM-19 exhausted retry budget ends the run failed with outcome exhausted', rd.status === 'failed' && rd.final_outcome === 'exhausted' && sD.nodes.try.attempts === 3 && sD.edge_counts['try->fix'] === 2, JSON.stringify({ rd, counts: sD.edge_counts }));

// ---- Graph E: missing result.json is a fail, never a pass ----
const NOTE_E = writeNote('no-result.md', ['---', 'type: sauce-graph', 'status: idle', '---', '', '```sauce', 'nodes:', '  - id: a', '    type: agent', '    worker: fake', '    prompt: x', '    fake: pass', '    fake_write_result: false', 'edges: []', '```', ''].join('\n'));
const e = engine.createRun({ vault, notePath: NOTE_E });
const re = engine.tick(e.ctx);
ok('SM-20 worker exit 0 without result.json fails the node and the run', re.status === 'failed' && re.nodes.a === 'fail');

// ---- CLI: sauce run ----
function cli(args, opts) {
  const o = Object.assign({ cwd: os.tmpdir(), encoding: 'utf8', env: Object.assign({}, process.env, { SAUCE_VAULT: '' }), stdio: ['ignore', 'pipe', 'pipe'] }, opts || {});
  try { return { code: 0, out: execFileSync(process.execPath, [CLI, 'run', ...args], o) }; }
  catch (err) { return { code: err.status, out: (err.stdout || '') + (err.stderr || '') }; }
}
const NOTE_F = writeNote('cli-graph.md', ['---', 'type: sauce-graph', 'status: idle', '---', '', '# CLI', '', '```sauce', 'nodes:', '  - id: one', '    type: agent', '    worker: claude-code', '    prompt: hello', '  - id: two', '    type: judge', '    run: true', 'edges:', '  - { from: one, to: two }', '```', ''].join('\n'));
const dry = cli([NOTE_F, '--dry-run', '--json']);
ok('CLI-1 dry-run from outside the vault resolves it from the note and writes no ledger',
  dry.code === 0 && (j => j.ok === true && j.plan.nodes.length === 2 && j.vault === fs.realpathSync(vault))(JSON.parse(dry.out)) && engine.listRuns(vault).every((r) => r.graph_note !== 'spice/graphs/cli-graph.md'), dry.out.slice(0, 300));
const live = cli([NOTE_F, '--worker', 'fake', '--follow', '--json']);
ok('CLI-2 --worker fake --follow completes the run', live.code === 0 && (j => j.status === 'done' && j.nodes.one === 'pass' && j.nodes.two === 'pass')(JSON.parse(live.out)), live.out.slice(0, 300));
const st = cli([NOTE_F, '--status', '--json']);
ok('CLI-3 --status reports the latest run', st.code === 0 && (j => j.status === 'done' && /cli-graph-/.test(j.run_id))(JSON.parse(st.out)), st.out.slice(0, 300));
const ls = cli(['--list', '--json'], { cwd: vault });
ok('CLI-4 --list from inside the vault lists every run newest first', ls.code === 0 && (j => j.runs.length >= 6 && j.runs[0].run_id.startsWith('cli-graph-'))(JSON.parse(ls.out)), ls.out.slice(0, 300));
const missing = cli([path.join(vault, 'spice', 'graphs', 'nope.md'), '--json']);
ok('CLI-5 missing note → exit 2 with a refusal', missing.code === 2 && /not found/.test(missing.out), missing.out.slice(0, 200));
const bad = writeNote('bad.md', ['---', 'type: sauce-graph', '---', '```sauce', 'nodes:', '  - id: a', '    type: robot', '```', ''].join('\n'));
const badRun = cli([bad, '--json']);
ok('CLI-6 invalid graph → exit 2 naming the code', badRun.code === 2 && /unknown_type/.test(badRun.out), badRun.out.slice(0, 200));
const help = execFileSync(process.execPath, [CLI, 'help'], { encoding: 'utf8', env: Object.assign({}, process.env, { SAUCE_TEST_MODE: '' }) });
ok('CLI-7 help advertises run', /\n  run\s+/.test(help));
const swDirty = cli([NOTE_A, '--sweep', '--json']);
ok('CLI-8 --sweep keeps a worktree with uncommitted files and says why', swDirty.code === 0 && (j => j.removed.length === 0 && j.kept.length === 1 && /dirty/.test(j.kept[0].reason))(JSON.parse(swDirty.out)) && fs.existsSync(wtA), swDirty.out.slice(0, 300));
fs.unlinkSync(path.join(wtA, 'ok.txt'));
const sw = cli([NOTE_A, '--sweep', '--json']);
ok('CLI-9 --sweep removes the finished clean worktree', sw.code === 0 && (j => j.removed.length === 1 && j.removed[0] === wtA)(JSON.parse(sw.out)) && !fs.existsSync(wtA), sw.out.slice(0, 300));

fs.rmSync(vault, { recursive: true, force: true });
fs.rmSync(repo, { recursive: true, force: true });

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
