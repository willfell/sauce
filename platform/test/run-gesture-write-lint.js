#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { lintSource, loadAllowlist } = require('../../scripts/lint-gesture-writes.js');

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
  'platform/blueprints/to-do/helpers/todo-daily-carryover.js',
  'platform/blueprints/sticky-notes/helpers/sticky-day-migrate.js',
  'platform/mechanisms/kanban-status-sync/kanban-status-sync.js',
  'platform/blueprints/project/helpers/project-workstreams.js',
  'platform/blueprints/meetings/helpers/meeting-leaf-actions.js',
].every((entry) => allowlist.has(entry)));

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

const failed = results.filter(([, passed]) => !passed);
console.log(`\n${failed.length ? 'FAIL' : 'PASS'} — gesture-write lint (${results.length - failed.length}/${results.length})`);
process.exitCode = failed.length ? 1 : 0;
