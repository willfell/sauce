// platform/engine/workers/fake.js — the test double. Outcome comes from the
// node (`fake: pass` or `fake: [fail, pass]` indexed by attempt) or from
// SAUCE_FAKE_OUTCOME. `fake_write_result: false` simulates a worker that
// exited cleanly without publishing, `fake_touch: <file>` writes a file in
// the cwd so a judge downstream can observe the attempt.
'use strict';

const fs = require('fs');
const path = require('path');
const { publishResult, RESULT_SCHEMA } = require('./index.js');

function run({ node, attempt, cwd, resultPath, stdoutPath, env }) {
  const spec = node.fake !== undefined ? node.fake : ((env || process.env).SAUCE_FAKE_OUTCOME || 'pass');
  const outcome = Array.isArray(spec) ? String(spec[Math.min(Math.max(attempt, 1), spec.length) - 1]) : String(spec);
  if (stdoutPath) fs.appendFileSync(stdoutPath, `fake worker: node=${node.id} attempt=${attempt} outcome=${outcome}\n`);
  if (node.fake_touch && cwd) fs.writeFileSync(path.join(cwd, node.fake_touch), `${node.id} attempt ${attempt}\n`);
  if (node.fake_write_result === false) return { exitCode: 0 };
  publishResult(resultPath, {
    schema: RESULT_SCHEMA,
    outcome,
    summary: `fake ${node.id} attempt ${attempt} → ${outcome}`,
    artifacts: node.fake_touch ? [node.fake_touch] : [],
    head: null,
    vars: Object.assign({}, node.fake_vars || {}),
  });
  return { exitCode: 0 };
}

module.exports = { run };
