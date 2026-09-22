#!/usr/bin/env node
/**
 * run-engine-install — installs the `engine` mechanism into a temp consumer
 * vault through the real installer (platform/install.js via run-install.js)
 * and checks: the always-on subscription heal, the materialized surface
 * (/sauce command, engine:run skill, Sauce Graph template, ranch/engine),
 * the claude-surface registry rows, idempotence, and `sauce audit --engine`.
 * Zero-dep.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const RUN_INSTALL = path.join(__dirname, 'run-install.js');
const CLI = path.join(ROOT, 'platform', 'cli', 'sauce-cli.js');
const installer = require(path.join(ROOT, 'platform', 'install.js'));

let pass = 0, fail = 0; const failures = [];
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok  ${label}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); failures.push(label); fail++; }
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const catalogue = readJson(path.join(ROOT, 'platform', 'manifest.json'));
const engineVersion = catalogue.mechanisms.find((m) => m.name === 'engine').version;
const claudeVersion = catalogue.mechanisms.find((m) => m.name === 'platform-claude').version;

// ---- unit: ensureAlwaysOnMechanisms (AO-*) ----
{
  const sub = { workshop_version: catalogue.workshop_version, mechanisms: [{ name: 'customjs-guard', version: '1.0.2' }], blueprints: [] };
  const history = [];
  const added = installer.ensureAlwaysOnMechanisms(sub, catalogue, history, { commit: 'abc', tag: null, dirty: false });
  ok('AO-1 appends platform-claude and engine at catalogue versions', added.join(',') === `platform-claude@${claudeVersion},engine@${engineVersion}` && sub.mechanisms.length === 3, added.join(','));
  ok('AO-2 records one heal history row', history.length === 1 && history[0].event === 'heal' && history[0].step === 'always_on_subscription' && history[0].git_commit === 'abc');
  const before = JSON.stringify(sub);
  const again = installer.ensureAlwaysOnMechanisms(sub, catalogue, history, {});
  ok('AO-3 already-subscribed → no-op, no history row', again.length === 0 && JSON.stringify(sub) === before && history.length === 1);
  const noMech = { mechanisms: undefined, blueprints: [] };
  const added2 = installer.ensureAlwaysOnMechanisms(noMech, catalogue, [], {});
  ok('AO-4 tolerates a subscription without mechanisms[]', added2.length === 2 && noMech.mechanisms.length === 2);
}

// ---- integration: real install into a temp vault (IN-*) ----
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-install-vault-'));
fs.mkdirSync(path.join(vault, 'ranch'), { recursive: true });
fs.mkdirSync(path.join(vault, 'Docs', 'Meta', 'Templater'), { recursive: true });
fs.writeFileSync(path.join(vault, 'ranch', 'platform-config.json'), JSON.stringify({
  workshop_relative_path: ROOT,
  variables: { views_path: 'ranch/views', templater_scripts_path: 'ranch/templater', scripts_path: 'ranch/scripts', rules_path: 'ranch/rules', templates_path: 'ranch/templates', commands_path: 'commands', workshop: 'engine-test-vault', vault_identity_tag: 'engine-test-vault' },
}, null, 2) + '\n');
const subPath = path.join(vault, 'ranch', 'platform-subscription.json');
fs.writeFileSync(subPath, JSON.stringify({ workshop_version: catalogue.workshop_version, mechanisms: [], blueprints: [] }, null, 2));
fs.writeFileSync(path.join(vault, 'CLAUDE.md'), '# test vault\n');
fs.mkdirSync(path.join(vault, 'ranch', 'templater'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'platform', 'installer-stub.js'), path.join(vault, 'ranch', 'templater', 'platformInstall.js'));

function install() {
  try { return { code: 0, out: execFileSync(process.execPath, [RUN_INSTALL, vault, '--auto-approve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const r1 = install();
ok('IN-1 installer exits 0 on a subscription with no mechanisms', r1.code === 0, r1.out.slice(-600));
const sub1 = readJson(subPath);
ok('IN-2 subscription healed to include engine and platform-claude', sub1.mechanisms.some((m) => m.name === 'engine' && m.version === engineVersion) && sub1.mechanisms.some((m) => m.name === 'platform-claude'), JSON.stringify(sub1.mechanisms));
const surface = ['.claude/commands/sauce.md', '.claude/skills/engine/run/SKILL.md', 'ranch/templates/Sauce Graph.md', 'ranch/engine/README.md'];
ok('IN-3 engine surface materialized', surface.every((f) => fs.existsSync(path.join(vault, f))), surface.filter((f) => !fs.existsSync(path.join(vault, f))).join(','));
const cmdBody = fs.readFileSync(path.join(vault, '.claude', 'commands', 'sauce.md'), 'utf8');
ok('IN-4 command body is the canonical one', cmdBody === fs.readFileSync(path.join(ROOT, 'platform', 'mechanisms', 'engine', 'commands', 'sauce.md'), 'utf8'));
const reg = readJson(path.join(vault, 'ranch', 'claude-surface-registry.json'));
const regEntries = JSON.stringify(reg);
ok('IN-5 claude-surface registry carries the engine rows', /\.claude\/commands\/sauce\.md/.test(regEntries) && /engine\/run\/SKILL\.md/.test(regEntries), regEntries.slice(0, 300));
const installed = readJson(path.join(vault, 'ranch', 'platform-installed.json'));
ok('IN-6 platform-installed records engine at the catalogue version', (installed.mechanisms || []).some((m) => m.name === 'engine' && m.version === engineVersion));
ok('IN-7 history carries the always_on_subscription heal', (installed.history || []).some((h) => h.step === 'always_on_subscription'));
const claudeMd = fs.readFileSync(path.join(vault, 'CLAUDE.md'), 'utf8');
ok('IN-8 CLAUDE.md resolvers row for /sauce', /\| Sauce \| \.claude\/commands\/sauce\.md \| \/sauce \|/.test(claudeMd), claudeMd.slice(0, 400));
const subBytes = fs.readFileSync(subPath, 'utf8');
const r2 = install();
ok('IN-9 second install is idempotent for the subscription', r2.code === 0 && fs.readFileSync(subPath, 'utf8') === subBytes);

// ---- sauce audit --engine (AU-*) ----
function audit(extra) {
  try { return { code: 0, out: execFileSync(process.execPath, [CLI, 'audit', '--engine', '--vault', vault, ...(extra || [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: vault }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const a1 = audit();
ok('AU-1 clean install audits clean (exit 0, zero findings)', a1.code === 0 && /findings_total":0/.test(a1.out), a1.out.slice(-400));
fs.mkdirSync(path.join(vault, 'ranch', 'engine', 'runs'), { recursive: true });
fs.writeFileSync(path.join(vault, 'ranch', 'engine', 'runs', 'demo-20260922-120000.jsonl'), '{"ts":"2026-09-22T12:00:00.000Z","type":"run.created","run_id":"demo-20260922-120000","graph_note":"x.md"}\nnot json\n');
fs.unlinkSync(path.join(vault, '.claude', 'commands', 'sauce.md'));
const a2 = audit();
ok('AU-2 missing command → engine_surface_missing; corrupt ledger line → engine_ledger_unparsable; exit 1', a2.code === 1 && /engine_surface_missing/.test(a2.out) && /engine_ledger_unparsable/.test(a2.out), a2.out.slice(-500));
fs.writeFileSync(path.join(vault, '.claude', 'commands', 'sauce.md'), cmdBody + '\nlocal edit\n');
const a3 = audit();
ok('AU-3 edited command body → engine_surface_stale', a3.code === 1 && /engine_surface_stale/.test(a3.out), a3.out.slice(-400));
fs.writeFileSync(path.join(vault, 'ranch', 'engine', 'runs', 'demo-20260922-120000.jsonl'), '{"ts":"2026-09-22T12:00:00.000Z","type":"run.created","run_id":"demo-20260922-120000","graph_note":"x.md"}\n{"ts":"2026-09-22T12:01:00.000Z","type":"node.finished","node":"a","attempt":1,"outcome":"pass","result":{"worktree":"/nonexistent/wt"}}\n{"ts":"2026-09-22T12:02:00.000Z","type":"run.ended","status":"done"}\n');
fs.writeFileSync(path.join(vault, '.claude', 'commands', 'sauce.md'), cmdBody);
const a4 = audit();
ok('AU-4 ledger referencing a missing worktree → engine_worktree_orphan (LOW, still exit 1)', a4.code === 1 && /engine_worktree_orphan/.test(a4.out), a4.out.slice(-400));

fs.rmSync(vault, { recursive: true, force: true });

console.log('');
console.log(`Tests: ${pass}/${pass + fail}`);
if (fail > 0) { console.log('Failures:'); for (const f of failures) console.log(`  ${f}`); process.exit(1); }
process.exit(0);
