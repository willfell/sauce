/*
 * loop-config (plugin surface) — the mayo plugin's entry point to sauce's
 * binding resolver.
 *
 * The resolver itself lives once, at scripts/autoloop/loop-config.js, because
 * the coordinator and the board-health installer require it directly and must
 * keep working whether or not the plugin is installed. This file exists so the
 * skill bodies' `${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js` contract and
 * Codex's `codex.plugin_root` resolve to the same module rather than a copy
 * that can drift from it.
 *
 * It forwards both surfaces the real module exposes: the require() exports and
 * the CLI. The CLI needs forwarding explicitly because the resolver guards its
 * entry with `require.main === module`, which is false when it is reached
 * through this file.
 */
const resolver = require('../../../scripts/autoloop/loop-config.js');

module.exports = resolver;

if (require.main === module) resolver.main(process.argv.slice(2));
