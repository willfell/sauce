#!/usr/bin/env node
'use strict';

const contract = require('./delivery-contract');

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { out._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? next : true;
    if (out[key] !== true) index += 1;
  }
  return out;
}

function run(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command !== 'describe' || !args._[1]) {
    const result = { ok: false, error: 'usage: delivery-schema-cli.js describe <type> [--consumer <seat>] --json' };
    io.log(JSON.stringify(result));
    return { exitCode: 2, result };
  }
  const description = contract.describe(args._[1], args.consumer || null);
  if (!description) {
    const result = { ok: false, error: `unknown Delivery contract type: ${args._[1]}` };
    io.log(JSON.stringify(result));
    return { exitCode: 2, result };
  }
  if (description.contract_version !== contract.CONTRACT_VERSION) {
    const result = { ok: false, error: 'registry/module version mismatch' };
    io.log(JSON.stringify(result));
    return { exitCode: 3, result };
  }
  const result = { ok: true, ...description };
  io.log(JSON.stringify(result, null, args.json ? 2 : 0));
  return { exitCode: 0, result };
}

if (require.main === module) {
  const outcome = run();
  process.exitCode = outcome.exitCode;
}

module.exports = { parseArgs, run };
