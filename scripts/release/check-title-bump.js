#!/usr/bin/env node
'use strict';
// PR-title bump gate. Recomputes the release bump two ways and fails when they
// disagree: (a) from the branch's individual commits (what the pre-squash
// bumper sees pre-merge) and (b) from the PR title (the ONLY conventional
// commit the squash-merge bumper actually reads). Catches the v0.281.1 incident
// where a feat branch shipped as a patch behind a fix-titled PR.
const { computePlan, getCommits, loadManifest } = require('./compute-release.js');
const { parseCommit, bumpLevel } = require('./lib/conventional.js');

function checkTitleBump({ title, commits, manifest }) {
  const isPre1 = String(manifest.workshop_version).startsWith('0.');
  const parsedTitle = parseCommit(String(title || '').trim());
  const titleLevel = parsedTitle ? bumpLevel(parsedTitle, isPre1) : 'none';
  const branchLevel = computePlan(commits, manifest).workshop.level;
  const ok = Boolean(parsedTitle) && titleLevel === branchLevel;
  const reason = !parsedTitle
    ? `PR title is not a conventional-commit header: "${title}"`
    : (ok ? 'title bump matches branch bump'
      : `PR title bump (${titleLevel}) != branch-commit bump (${branchLevel}); `
        + 'the squash-merge bumper reads the TITLE — fix the title before merge');
  return { ok, titleLevel, branchLevel, reason };
}

module.exports = { checkTitleBump };

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const title = getArg('--title') || process.env.PR_TITLE || '';
  const base = getArg('--base') || 'main';
  const manifest = loadManifest();
  const commits = getCommits(`${base}..HEAD`);
  const result = checkTitleBump({ title, commits, manifest });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(`\n✗ ${result.reason}`);
    process.exit(1);
  }
  console.log(`\n✓ ${result.reason}`);
}
