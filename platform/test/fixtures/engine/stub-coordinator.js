#!/usr/bin/env node
// Stub coordinator for the delivery-slice graph harness. Reads a scenario
// JSON (STUB_SCENARIO) whose keys are verbs and whose values are arrays of
// receipts consumed in order (the last one repeats). Every call is logged to
// STUB_LOG as one JSON line so the harness can assert the verb sequence and
// the operands the graph passed. Exit code comes from receipt.exit (default 0).
'use strict';
const fs = require('fs');

const verb = process.argv[2];
const args = process.argv.slice(3);
const scenarioPath = process.env.STUB_SCENARIO;
const logPath = process.env.STUB_LOG;
const statePath = `${scenarioPath}.cursor.json`;

const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
let cursor = {};
try { cursor = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_e) { cursor = {}; }
const list = scenario[verb] || [{ ok: false, code: 'unknown_verb', message: `stub has no scenario for ${verb}`, exit: 2 }];
const idx = Math.min(cursor[verb] || 0, list.length - 1);
cursor[verb] = (cursor[verb] || 0) + 1;
fs.writeFileSync(statePath, JSON.stringify(cursor));
const receipt = list[idx];
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ verb, args, receipt }) + '\n');
const { exit, ...body } = receipt;
process.stdout.write(JSON.stringify(body) + '\n');
process.exit(exit || 0);
