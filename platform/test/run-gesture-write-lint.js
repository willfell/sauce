#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { lintSource, loadAllowlist, run } = require('../../scripts/lint-gesture-writes.js');

const ROOT = path.resolve(__dirname, '..', '..');
const LINT = path.join(ROOT, 'scripts', 'lint-gesture-writes.js');
const results = [];
const ok = (name, condition) => {
  results.push([name, !!condition]);
  console.log(`  ${condition ? 'PASS' : 'FAIL'} — ${name}`);
};

const bareGestureFindings = lintSource(`
  button.addEventListener('click', async () => {
    await app.fileManager.processFrontMatter(file, update);
  });
`);
ok('GW-1 bare processFrontMatter inside addEventListener fails with a stable line',
  bareGestureFindings.length === 1
    && bareGestureFindings[0].line === 3
    && /bare fileManager\.processFrontMatter/.test(bareGestureFindings[0].message));

ok('GW-2 RenderSafe.mutate and gesture-write-ok fixtures pass', lintSource(`
  button.addEventListener('click', async () => {
    await renderSafe.mutate({
      write: () => app.fileManager.processFrontMatter(file, update),
    });
    // gesture-write-ok delegated to an externally audited transaction
    await app.vault.modify(file, body);
  });
`).length === 0);

ok('GW-3 vault.modify is covered by the same rule', lintSource(`
  button.onchange = async () => {
    await app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4G-VAULT-CREATE-BYPASS vault.create is covered by the same rule', lintSource(`
  button.onclick = async () => {
    await app.vault.create(path, body);
  };
`).length === 1);

ok('GW-4 non-gesture background writes are not false positives', lintSource(`
  async function reconcile(vault, file, body) {
    await vault.modify(file, body);
  }
`).length === 0);

ok('GW-5 unrelated mutate methods cannot bypass the RenderSafe requirement', lintSource(`
  button.onclick = async () => {
    await database.mutate({
      write: () => app.fileManager.processFrontMatter(file, update),
    });
  };
`).length === 1);

ok('GW-6 a reasonless gesture-write-ok marker is rejected', lintSource(`
  button.onclick = async () => {
    // gesture-write-ok
    await app.vault.modify(file, body);
  };
`).length === 1);

const allowlist = loadAllowlist();
ok('GW-7 required automated writers have reasoned allowlist entries', [
  'platform/blueprints/project/helpers/project-workstreams.js',
  'platform/blueprints/meetings/helpers/meeting-leaf-actions.js',
  'platform/blueprints/project/helpers/doc-bulk-move.js',
  'platform/blueprints/project/helpers/doc-leaf-actions.js',
].every((entry) => allowlist.has(entry)));

const syntheticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-write-lint-'));
try {
  const scanDir = path.join(syntheticRoot, 'helpers');
  const sourcePath = path.join(scanDir, 'synthetic.js');
  const allowlistPath = path.join(syntheticRoot, 'allowlist.json');
  fs.mkdirSync(scanDir, { recursive: true });
  fs.writeFileSync(sourcePath, [
    'button.onclick = async () => {',
    '  await app.vault.modify(allowedFile, allowedBody);',
    '  await app.vault.create(unapprovedPath, unapprovedBody);',
    '};',
    '',
  ].join('\n'));
  fs.writeFileSync(allowlistPath, JSON.stringify({
    entries: [{
      path: 'helpers/synthetic.js',
      reason: 'The first synthetic write is the exact line-bound control for the file contract.',
      lines: [2],
    }],
  }));

  const synthetic = run([scanDir], allowlistPath, syntheticRoot);
  ok('GA-P4G-TEST-FILE-CONTRACT line-bound allowlists do not suppress the whole file',
    synthetic.findings.length === 1);
  ok('GA-P4G-TEST-FILE-CONTRACT another violation in the same file remains visible',
    synthetic.findings[0]?.line === 3 && /bare vault\.create/.test(synthetic.findings[0]?.message || ''));
  ok('GA-P4G-TEST-FILE-CONTRACT run returns a stable POSIX relative path',
    synthetic.findings[0]?.file === 'helpers/synthetic.js');

  const syntheticCli = spawnSync(process.execPath, [
    LINT,
    '--scan', scanDir,
    '--root', syntheticRoot,
    '--allowlist', allowlistPath,
  ], { encoding: 'utf8' });
  ok('GA-P4G-TEST-FILE-CONTRACT CLI fails with the exact path:line finding',
    syntheticCli.status !== 0
      && /helpers\/synthetic\.js:3 bare vault\.create/.test(syntheticCli.stderr));
} finally {
  fs.rmSync(syntheticRoot, { recursive: true, force: true });
}

const repository = spawnSync(process.execPath, [LINT], { cwd: ROOT, encoding: 'utf8' });
ok('GW-8 post-GA-P3c repository has no unapproved gesture writes', repository.status === 0);
if (repository.status !== 0) process.stderr.write(repository.stderr || repository.stdout);

ok('GA-P4B-STRING-ESCAPE-BYPASS string markers cannot suppress a finding', lintSource(`
  button.onclick = async () => {
    const explanation = "gesture-write-ok this is string data, not a reviewed escape";
    await app.vault.modify(file, explanation);
  };
`).length === 1);

ok('GA-P4B-EAGER-MUTATE-OPTION-BYPASS only write callbacks receive protection', lintSource(`
  button.onclick = async () => {
    await renderSafe.mutate({
      before: app.vault.modify(file, body),
      write: () => Promise.resolve(),
    });
  };
`).length === 1);

ok('GA-P4B-REGEX-BRACE-BYPASS assigned regex braces cannot truncate gestures', lintSource(`
  button.onclick = async () => {
    const closingBrace = /}/;
    await app.vault.modify(file, closingBrace.source);
  };
`).length === 1);

ok('GA-P4B-EXPRESSION-BODY-BYPASS property assignment expression is covered', lintSource(`
  button.onclick = () => app.vault.modify(file, body);
`).length === 1);

ok('GA-P4B-EXPRESSION-BODY-BYPASS addEventListener expression is covered', lintSource(`
  button.addEventListener('click', () => app.vault.modify(file, body));
`).length === 1);

ok('GA-P4B-REGEX-BRACE-BYPASS post-condition regex braces stay masked', lintSource(`
  button.onclick = () => {
    if (ok) /}/.test(value);
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4B-TEMPLATE-INTERPOLATION-BYPASS executable interpolation stays visible', lintSource([
  'button.onclick = () => {',
  '  const rendered = `value ${app.vault.modify(file, body)}`;',
  '};',
].join('\n')).length === 1);

ok('GA-P4B-TEMPLATE-INTERPOLATION-BYPASS inert template text stays masked', lintSource([
  'button.onclick = () => {',
  '  const rendered = `app.vault.modify(file, body)`;',
  '};',
].join('\n')).length === 0);

ok('GA-P4B-OPTIONAL-CHAIN-WRITE-BYPASS optional receiver writes are covered', lintSource(`
  button.onclick = () => {
    app.vault?.modify(file, body);
    app.fileManager?.processFrontMatter(file, update);
  };
`).length === 2);

ok('GA-P4B-ACTIVE-DASHBOARD-FALSE-ALLOWLIST dashboard is not allowlisted',
  !allowlist.has('platform/blueprints/project/helpers/project-dashboard.js'));

ok('GA-P4C-NESTED-ARROW-PARAM-BYPASS braced assignment parameters are balanced', lintSource(`
  button.onclick = ({ value = fn() }) => {
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4C-NESTED-ARROW-PARAM-BYPASS braced listener parameters are balanced', lintSource(`
  button.addEventListener('click', ({ value = fn() }) => {
    app.vault.modify(file, body);
  });
`).length === 1);

ok('GA-P4C-NESTED-ARROW-PARAM-BYPASS expression assignment parameters are balanced', lintSource(`
  button.onclick = ({ value = fn(other()) }) => app.vault.modify(file, body);
`).length === 1);

ok('GA-P4C-NESTED-ARROW-PARAM-BYPASS expression listener parameters are balanced', lintSource(`
  button.addEventListener(getEvent(kind()), ({ value = fn(other()) }) => app.vault.modify(file, body));
`).length === 1);

ok('GA-P4C-NESTED-ARROW-PARAM-BYPASS balanced callbacks retain RenderSafe protection', lintSource(`
  button.onclick = ({ value = fn(other()) }) => renderSafe.mutate({
    write: ({ current = select(other()) }) => app.vault.modify(file, body),
  });
`).length === 0);

ok('GA-P4D-PARENTHESIZED-CALLBACK-BYPASS wrapped assignment callbacks remain gestures', lintSource(`
  button.onclick = (({ value = fn() }) => {
    app.vault.modify(file, body);
  });
`).length === 1);

ok('GA-P4D-PARENTHESIZED-CALLBACK-BYPASS wrapped listener callbacks remain gestures', lintSource(`
  button.addEventListener('click', (({ value = fn() }) => {
    app.vault.modify(file, body);
  }));
`).length === 1);

ok('GA-P4D-WRITE-WHITESPACE-BYPASS member whitespace cannot hide writes', lintSource(`
  button.onclick = () => {
    app.vault
      . modify(file, body);
    app.fileManager /* executable spacing */ . processFrontMatter(file, update);
  };
`).length === 2);

ok('GA-P4D-LOOKBACK-CAP-BYPASS long handler trivia cannot hide callbacks', lintSource(`
  button.onclick = /* ${'x'.repeat(600)} */ ({ value = fn() }) => {
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4D-LOOKBACK-CAP-BYPASS long listener arguments cannot hide callbacks', lintSource(`
  button.addEventListener('${'x'.repeat(2200)}', ({ value = fn() }) => {
    app.vault.modify(file, body);
  });
`).length === 1);

ok('GA-P4D-REGEX-CONTEXT-BYPASS void regex braces stay masked', lintSource(`
  button.onclick = () => {
    void /}/.test(value);
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4D-REGEX-CONTEXT-BYPASS else regex braces stay masked', lintSource(`
  button.onclick = () => {
    if (ok) noop(); else /}/.test(value);
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4D-PARENTHESIZED-RENDERSAFE-WRITE-BYPASS wrapped write callbacks stay protected', lintSource(`
  button.onclick = () => renderSafe.mutate({
    write: (({ current = select(other()) }) => app.vault.modify(file, body)),
  });
`).length === 0);

ok('GA-P4G-WRAPPER-DEPTH-CAP wrapped writes have no finite callback cap', lintSource(`
  button.onclick = () => renderSafe.mutate({
    write: ${'('.repeat(101)}() => app.vault.modify(file, body)${')'.repeat(101)},
  });
`).length === 0);

ok('GA-P4E-REGEX-TOKEN-BOUNDARY string values keep following division from masking writes', lintSource(`
  button.onclick = () => { const ratio = "value" / divisor; app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-REGEX-TOKEN-BOUNDARY regex values keep following division from masking writes', lintSource(`
  button.onclick = () => { const ratio = /value/ / divisor; app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-SLASH-SYNTAX-ORACLE spread regex operands stay masked', lintSource(`
  button.onclick = () => { const values = [.../}/]; app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-SLASH-SYNTAX-ORACLE class-expression division stays executable', lintSource(`
  button.onclick = () => { const ratio = class {} / 2; app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-SLASH-SYNTAX-ORACLE function-expression division stays executable', lintSource(`
  button.onclick = () => { const ratio = function () {} / 2; app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-SLASH-SYNTAX-ORACLE post-block regex braces stay masked', lintSource(`
  button.onclick = () => { if (ok) {} /}/.test(value); app.vault.modify(file, body); };
`).length === 1);

ok('GA-P4E-GENERATOR-YIELD-REGEX-BYPASS yield regex braces stay masked', lintSource(`
  button.onclick = () => {
    function* inner() { yield /a}{b/g; }
    app.vault.modify(file, body);
  };
`).length === 1);

ok('GA-P4E-MODULE-SYNTAX-FALLBACK-BYPASS module spread regex stays masked', lintSource(`
  export const marker = true;
  button.onclick = () => {
    const values = [.../a}{b/g];
    app.vault.modify(file, body);
  };
`).length === 1);

delete globalThis.__gestureLintExecutionSentinel;
lintSource(`
  globalThis.__gestureLintExecutionSentinel = 1;
  button.onclick = () => app.vault.modify(file, body);
`);
ok('GA-P4F-PARSE-ONLY scanned source is never executed',
  globalThis.__gestureLintExecutionSentinel === undefined);

// GA-P4I-CONTEXT-MATRIX — a synthetic NEW bare write in each gesture context
// must fail the registered preflight engine (walk + parse + allowlist filter,
// the same run() the CLI main drives), one file per context so no context can
// hide behind another's finding. Generator handlers assigned directly
// (button.onclick = function* () {...}) are deliberately absent: a generator
// body does not execute on the gesture — invoking it only returns an iterator
// — so the executable generator shapes are the ones pinned here.
{
  const matrixRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-context-matrix-'));
  const scanDir = path.join(matrixRoot, 'scan');
  fs.mkdirSync(scanDir);
  const contexts = {
    'assignment.js': "button.onclick = async () => { await app.vault.modify(file, body); };\n",
    'listener.js': "button.addEventListener('click', async () => { await app.fileManager.processFrontMatter(file, update); });\n",
    'property.js': "panel.el.onchange = () => app.vault.modify(file, body);\n",
    'expression.js': "button.onclick = () => app.fileManager.processFrontMatter(file, update);\n",
    'template-interpolation.js': "button.onclick = async () => { await notify(`saved ${await app.vault.modify(file, body)}`); };\n",
    'optional-chain.js': "button.onclick = async () => { await app?.fileManager?.processFrontMatter(file, update); };\n",
    'generator.js': "button.onclick = async () => { for (const step of (function* () { yield app.fileManager.processFrontMatter(file, update); })()) { await step; } };\n",
    'module.js': "export const wire = (button) => { button.onclick = () => app.vault.modify(file, body); };\n",
  };
  for (const [name, source] of Object.entries(contexts)) {
    fs.writeFileSync(path.join(scanDir, name), source);
  }
  const matrix = run([scanDir], null, matrixRoot);
  const flagged = new Set(matrix.findings.map((finding) => path.basename(finding.file)));
  const missed = Object.keys(contexts).filter((name) => !flagged.has(name));
  ok(`GA-P4I-CONTEXT-MATRIX every gesture context is flagged by the preflight engine${missed.length ? ` (missed: ${missed.join(', ')})` : ''}`,
    missed.length === 0);
  fs.rmSync(matrixRoot, { recursive: true, force: true });
}

// GA-P4I-ALLOWLIST-AUDIT — the allowlist is a narrow set of audited,
// non-gesture automated writers: every entry must resolve to an existing
// file, carry a specific reason, still be flagged by the lint when the
// allowlist is ignored (a no-longer-flagged entry is rot and must be
// pruned), and pin exactly the finding lines it excuses.
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'lint-gesture-writes-allowlist.json'), 'utf8'));
  const audits = raw.entries.map((entry) => {
    const abs = path.join(ROOT, entry.path);
    const exists = fs.existsSync(abs);
    const findingLines = exists
      ? lintSource(fs.readFileSync(abs, 'utf8')).map((finding) => finding.line).sort((a, b) => a - b)
      : [];
    const pinnedLines = (entry.lines || []).slice().sort((a, b) => a - b);
    return {
      path: entry.path,
      exists,
      reasoned: typeof entry.reason === 'string' && entry.reason.trim().length >= 20,
      live: findingLines.length > 0,
      exact: JSON.stringify(findingLines) === JSON.stringify(pinnedLines),
    };
  });
  const broken = (key) => audits.filter((audit) => !audit[key]).map((audit) => audit.path);
  const dead = broken('live');
  const inexact = broken('exact');
  ok('GA-P4I-ALLOWLIST-AUDIT every entry resolves to an existing reasoned file',
    audits.every((audit) => audit.exists && audit.reasoned));
  ok(`GA-P4I-ALLOWLIST-AUDIT no dead entries: each file is still flagged without the allowlist${dead.length ? ` (dead: ${dead.join(', ')})` : ''}`,
    dead.length === 0);
  ok(`GA-P4I-ALLOWLIST-AUDIT entries pin exactly the finding lines they excuse${inexact.length ? ` (inexact: ${inexact.join(', ')})` : ''}`,
    inexact.length === 0);
}

const failed = results.filter(([, passed]) => !passed);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — gesture-write lint (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
