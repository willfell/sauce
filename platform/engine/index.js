// platform/engine/index.js — the Sauce engine's public surface.
'use strict';

const graph = require('./graph.js');
const validate = require('./validate.js');
const ledger = require('./ledger.js');
const state = require('./state.js');
const scheduler = require('./scheduler.js');
const projection = require('./projection.js');
const run = require('./run.js');
const isolation = require('./isolation.js');
const workers = require('./workers/index.js');

module.exports = {
  parseGraphNote: graph.parseGraphNote,
  splitFrontmatter: graph.splitFrontmatter,
  validateGraph: validate.validateGraph,
  entryNodes: validate.entryNodes,
  createRun: run.createRun,
  openRun: run.openRun,
  latestRunFor: run.latestRunFor,
  resolveVaultForNote: run.resolveVaultForNote,
  loadGraphNote: run.loadGraphNote,
  dryRunPlan: run.dryRunPlan,
  tick: scheduler.tick,
  follow: scheduler.follow,
  reduce: state.reduce,
  isTerminal: state.isTerminal,
  listRuns: ledger.listRuns,
  readEvents: ledger.readEvents,
  runsDir: ledger.runsDir,
  writeProjection: projection.writeProjection,
  sweep: isolation.sweep,
  workers,
  RunError: run.RunError,
  GraphNoteError: graph.GraphNoteError,
};
