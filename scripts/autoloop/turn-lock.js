#!/usr/bin/env node
/**
 * turn-lock — single-turn lock so only ONE autoloop turn runs at a time
 * (a 10m /loop and a 2h launchd job must not overlap). Pure `lockState`
 * decides held/stale from the lock-file content + now; the CLI acquires /
 * checks / releases `.autoloop-lock` at the repo root.
 *
 * Exports: lockState
 * CLI: node scripts/autoloop/turn-lock.js acquire|check|release [--stale-min 30]
 *   acquire → exit 0 + writes the lock if free/stale; exit 1 if another turn holds it.
 */
'use strict';

// content = lock-file text (JSON {pid, startedAt}); nowMs + staleMs are numbers.
function lockState(content, nowMs, staleMs) {
  if (!content || !String(content).trim()) return { present: false, held: false, stale: false };
  let parsed = null;
  try { parsed = JSON.parse(content); } catch (_) { parsed = null; }
  const started = parsed ? new Date(parsed.startedAt).getTime() : NaN;
  if (!Number.isFinite(started)) return { present: true, held: false, stale: true }; // garbage lock → overridable
  const ageMs = nowMs - started;
  // stale if older than the window OR future-skewed (negative age, e.g. clock jumped back on sleep/wake) → overridable.
  const stale = ageMs >= staleMs || ageMs < 0;
  return { present: true, held: !stale, stale, ageMs };
}

module.exports = { lockState };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const LOCK = path.join(ROOT, '.autoloop-lock');
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let staleMin = 30;
  const si = argv.indexOf('--stale-min');
  if (si !== -1 && argv[si + 1]) staleMin = Number(argv[si + 1]) || 30;
  const staleMs = staleMin * 60 * 1000;
  const now = Date.now();
  const read = () => { try { return fs.readFileSync(LOCK, 'utf8'); } catch (_) { return ''; } };

  if (cmd === 'check' || cmd === 'acquire') {
    const st = lockState(read(), now, staleMs);
    if (st.held) { console.log(JSON.stringify({ acquired: false, reason: 'another turn in progress', ageMs: st.ageMs })); process.exit(1); }
    if (cmd === 'acquire') fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString() }), 'utf8');
    console.log(JSON.stringify({ acquired: cmd === 'acquire', wasStale: st.stale })); process.exit(0);
  }
  if (cmd === 'release') { try { fs.unlinkSync(LOCK); } catch (_) {} console.log(JSON.stringify({ released: true })); process.exit(0); }
  console.error('usage: turn-lock.js acquire|check|release [--stale-min 30]'); process.exit(2);
}
