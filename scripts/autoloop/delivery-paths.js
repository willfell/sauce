#!/usr/bin/env node
/**
 * delivery-paths — resolve delivery: family project paths. Env overrides let one
 * skill body serve multiple projects; defaults target this Sauce workshop machine.
 * The portability seam for the delivery: family. No side effects.
 *
 * Exports: deliveryPaths, coordinatorPresent, DEFAULTS
 */
'use strict';

const DEFAULTS = {
  repoRoot: '/Users/willfellhoelter/projects/repos/sauce',
  coordinator: '/opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js',
  fid: '/Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md',
  statePath: '/Users/willfellhoelter/projects/repos/sauce/.git/sauce-autoloop/state.json',
};

function deliveryPaths(env) {
  env = env || process.env;
  return {
    repoRoot: env.DELIVERY_REPO_ROOT || DEFAULTS.repoRoot,
    coordinator: env.DELIVERY_COORDINATOR || DEFAULTS.coordinator,
    fid: env.DELIVERY_FID || DEFAULTS.fid,
    statePath: env.DELIVERY_STATE || DEFAULTS.statePath,
  };
}

// Full-variant (Sauce) has the coordinator installed OR a local state file.
function coordinatorPresent(paths, fsImpl) {
  const fs = fsImpl || require('fs');
  return fs.existsSync(paths.coordinator) || fs.existsSync(paths.statePath);
}

module.exports = { deliveryPaths, coordinatorPresent, DEFAULTS };
