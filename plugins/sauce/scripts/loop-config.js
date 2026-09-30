/*
 * loop-config (plugin surface) — the sauce plugin's entry point to sauce's
 * binding resolver.
 *
 * The resolver itself lives once, at scripts/autoloop/loop-config.js, because
 * the coordinator and the board-health installer require it directly and must
 * keep working whether or not the plugin is installed. This file exists so the
 * skill bodies' `${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js` contract and
 * Codex's `codex.plugin_root` resolve to the same module rather than a copy
 * that can drift from it.
 *
 * Where the resolver is found, in order:
 *   1. Beside this plugin, three levels up. True in a sauce clone and in the
 *      Homebrew libexec, where plugins/sauce sits inside the full tree.
 *   2. $SAUCE_LIBEXEC/scripts/autoloop/loop-config.js, an explicit override.
 *   3. `brew --prefix sauce`/libexec/scripts/autoloop/loop-config.js. This is
 *      the path that matters for the Claude plugin cache, which holds only the
 *      plugin subtree, so step 1 finds nothing there.
 * If none exists, the CLI prints a refusal receipt in the resolver's own
 * envelope instead of a module-not-found stack trace. `SAUCE_BREW` names the
 * brew binary; it exists so the harness can exercise the no-brew path.
 *
 * It forwards both surfaces the real module exposes: the require() exports and
 * the CLI. The CLI needs forwarding explicitly because the resolver guards its
 * entry with `require.main === module`, which is false when it is reached
 * through this file.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RESOLVER_REL = path.join('scripts', 'autoloop', 'loop-config.js');

function resolverCandidates(env = process.env) {
  const candidates = [path.resolve(__dirname, '..', '..', '..', RESOLVER_REL)];
  if (env.SAUCE_LIBEXEC) candidates.push(path.join(env.SAUCE_LIBEXEC, RESOLVER_REL));
  try {
    const prefix = execFileSync(env.SAUCE_BREW || 'brew', ['--prefix', 'sauce'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    }).trim();
    if (prefix) candidates.push(path.join(prefix, 'libexec', RESOLVER_REL));
  } catch (_) {
    // brew absent or sauce not installed: the candidates above are all there is.
  }
  return candidates;
}

function locateResolver(env = process.env) {
  const tried = resolverCandidates(env);
  return { path: tried.find((p) => fs.existsSync(p)) || null, tried };
}

const located = locateResolver();

if (located.path) {
  const resolver = require(located.path);
  module.exports = resolver;
  if (require.main === module) resolver.main(process.argv.slice(2));
} else {
  const refusal = {
    code: 'resolver_unavailable',
    message: 'the sauce binding resolver was not found beside this plugin, at $SAUCE_LIBEXEC, or under `brew --prefix sauce` — install sauce with `brew install willfell/sauce/sauce`, or set SAUCE_LIBEXEC to a sauce checkout or libexec',
    tried: located.tried,
  };
  module.exports = { resolverUnavailable: refusal, locateResolver };
  if (require.main === module) {
    const verb = process.argv[2] || 'resolve';
    process.stdout.write(JSON.stringify({ action: `loop-config-${verb}`, ok: false, no_op: false, refusals: [refusal] }, null, 2) + '\n');
    process.exit(1);
  }
}
