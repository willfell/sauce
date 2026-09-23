// platform/engine/workers/claude-code.js — runs a Claude Code session
// non-interactively in the node's isolation scope. Binary override:
// SAUCE_CLAUDE_BIN. The verdict is read from result.json, never from stdout.
'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function run({ prompt, cwd, timeoutMs, stdoutPath, env, node }) {
  const bin = (env || process.env).SAUCE_CLAUDE_BIN || 'claude';
  const maxTurns = Number.isInteger(node && node.max_turns) ? node.max_turns : 60;
  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', '--max-turns', String(maxTurns)];
  if (node && typeof node.model === 'string' && node.model) args.push('--model', node.model);
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
  if (stdoutPath) fs.appendFileSync(stdoutPath, (r.stdout || '') + (r.stderr ? `\n[stderr]\n${r.stderr}` : ''));
  return { exitCode: r.status === null ? -1 : r.status, timedOut: !!r.error && r.error.code === 'ETIMEDOUT', error: r.error ? r.error.message : null };
}

module.exports = { run };
