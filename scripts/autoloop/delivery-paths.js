#!/usr/bin/env node
/**
 * delivery-paths — resolve delivery: family project paths. Env overrides let one
 * skill body serve multiple projects; defaults target this Sauce workshop machine.
 * The portability seam for the delivery: family. No side effects.
 *
 * Exports: deliveryPaths, coordinatorPresent, DEFAULTS
 */
'use strict';

const os = require('os');
const path = require('path');

// Home-relative so the username change across machines needs no edit; the
// DELIVERY_* env overrides (set by the loop resolver) supersede these for any
// bound repo. Last-resort literals target this machine's workshop layout.
const HOME = os.homedir();
const DEFAULTS = {
  repoRoot: path.join(HOME, 'Documents/GitHub/sauce'),
  coordinator: '/opt/homebrew/opt/sauce/libexec/scripts/autoloop/codex-coordinator.js',
  fid: path.join(HOME, 'obsidian/headspace-sauce/spice/projects/sauce-ai-loop-system/docs/final-initial-design/Final Initial Design.md'),
  statePath: path.join(HOME, 'Documents/GitHub/sauce/.git/sauce-autoloop/state.json'),
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
