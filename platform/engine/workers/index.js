// platform/engine/workers/index.js — worker registry and the result contract
// every agent node shares. Workers never return a verdict in free text: they
// publish result.json (by rename) and the engine reads that file.
'use strict';

const fs = require('fs');
const path = require('path');

const RESULT_SCHEMA = 'sauce.worker-result.v1';

const REGISTRY = {
  fake: () => require('./fake.js'),
  'claude-code': () => require('./claude-code.js'),
  codex: () => require('./codex.js'),
};

function resolveWorker(name) {
  const load = REGISTRY[name];
  if (!load) throw new Error(`unknown worker "${name}" (claude-code | codex | fake)`);
  return Object.assign({ name }, load());
}

function promptTail(resultPath) {
  return [
    '',
    '---',
    'When you are done, write your result as JSON to this exact path (create the directory if needed):',
    '',
    `    ${resultPath}`,
    '',
    'Write it to a temporary file first and rename it into place so a partial file is never read. Shape:',
    '',
    '```json',
    JSON.stringify({ schema: RESULT_SCHEMA, outcome: 'pass', summary: 'one paragraph of what you did and why', artifacts: ['relative/paths/you/changed'], head: 'git HEAD sha if you committed, else null', vars: {} }, null, 2),
    '```',
    '',
    '`outcome` is `pass`, `fail`, or a named outcome the graph declares (lowercase, hyphenated). Anything else counts as `fail`.',
    'Do not print the verdict anywhere else; the file is the only thing the engine reads.',
    '',
  ].join('\n');
}

function publishResult(resultPath, obj) {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  const tmp = `${resultPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, resultPath);
}

function readResult(resultPath) {
  if (!fs.existsSync(resultPath)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(resultPath, 'utf8')); }
  catch (_e) { return null; }
  if (!parsed || typeof parsed !== 'object' || parsed.schema !== RESULT_SCHEMA) return null;
  if (typeof parsed.outcome !== 'string' || !/^[a-z][a-z0-9-]*$/.test(parsed.outcome)) return null;
  return {
    schema: RESULT_SCHEMA,
    outcome: parsed.outcome,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.map(String) : [],
    head: typeof parsed.head === 'string' && parsed.head ? parsed.head : null,
    vars: parsed.vars && typeof parsed.vars === 'object' && !Array.isArray(parsed.vars) ? parsed.vars : {},
  };
}

module.exports = { resolveWorker, promptTail, publishResult, readResult, RESULT_SCHEMA };
