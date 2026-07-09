#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const FinanceChromeBar = loadClass('platform/blueprints/finance/helpers/finance-chrome-bar.js', 'FinanceChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new FinanceChromeBar();
const cfg = inst._config();

const HUB_TYPES = ['finance-hub', 'budgets-hub', 'paychecks-hub', 'invoices-hub', 'debts-hub', 'months-hub', 'savings-hub'];
const ENTITY_TYPES = ['budget', 'paycheck', 'invoice', 'debt', 'month', 'savings-account'];
const DEFAULTS_TYPES = ['budget-defaults', 'paycheck-defaults', 'debt-defaults', 'finance-plan'];
const AUX_TYPES = ['invoice-board-card', 'time-log'];

// FCB-DETECT — every one of the 19 types classifies; unrelated types → null.
{
  let allHubs = true, allEntities = true, allDefaults = true, allAux = true;
  for (const t of HUB_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allHubs = false; }
  for (const t of ENTITY_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allEntities = false; }
  for (const t of DEFAULTS_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allDefaults = false; }
  for (const t of AUX_TYPES) { const r = cfg.detect({}, { file: { path: 'x' }, type: t }); if (!r || r.context !== t) allAux = false; }
  const off = cfg.detect({}, { file: { path: 'spice/other/x.md' }, type: 'meeting' });
  ok('FCB-DETECT-1 all 7 hub types classify', allHubs);
  ok('FCB-DETECT-2 all 6 entity types classify', allEntities);
  ok('FCB-DETECT-3 all 4 defaults/plan types classify', allDefaults);
  ok('FCB-DETECT-4 non-finance type → null', off === null);
  ok('FCB-DETECT-5 both aux types classify (invoice-board-card, time-log)', allAux);
}
// FCB-SPEC — no primary/overflow anywhere (FinanceNav already owns "+ New X" + defaults links);
// hubs are not leaf, entities/defaults/plan/aux are leaf.
{
  let hubsOk = true, entitiesOk = true, defaultsOk = true, auxOk = true;
  for (const t of HUB_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== false) hubsOk = false; }
  for (const t of ENTITY_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== true) entitiesOk = false; }
  for (const t of DEFAULTS_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== true) defaultsOk = false; }
  for (const t of AUX_TYPES) { const s = cfg.surfaceSpec({ context: t }); if (s.primary !== null || s.overflow.length !== 0 || s.leaf !== true) auxOk = false; }
  ok('FCB-SPEC-1 hubs: primary null + overflow empty + not leaf', hubsOk);
  ok('FCB-SPEC-2 entities: primary null + overflow empty + leaf', entitiesOk);
  ok('FCB-SPEC-3 defaults/plan: primary null + overflow empty + leaf', defaultsOk);
  ok('FCB-SPEC-4 aux (invoice-board-card, time-log): primary null + overflow empty + leaf', auxOk);
}
// FCB-DISPATCH — never throws (no chrome-owned actions on any surface).
{
  let threw = false;
  try { cfg.dispatch({}, { context: 'budget' }, 'unknown-id'); } catch (_e) { threw = true; }
  ok('FCB-DISPATCH-1 dispatch never throws (no-op surface)', !threw);
}
// FCB-DEST — This finance marker + 7 hub entries; current hub omits its own self-link.
{
  const prevCJS = global.customJS;
  global.customJS = { ChromeBar: { openNavTarget: () => {} } };
  const fromEntity = cfg.destinations({}, { context: 'budget', path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' });
  const fromFinanceHub = cfg.destinations({}, { context: 'finance-hub', path: 'spice/finance/Finance.md' });
  const fromBudgetsHub = cfg.destinations({}, { context: 'budgets-hub', path: 'spice/finance/budgets/Budgets.md' });
  global.customJS = prevCJS;
  ok('FCB-DEST-1 leads with This finance marker', fromEntity[0] && fromEntity[0].section === 'This finance');
  ok('FCB-DEST-2 entity surface lists all 7 hubs (no self to omit)', fromEntity.length === 8);
  ok('FCB-DEST-3 Finance hub omits its own self-link (6 remaining)', fromFinanceHub.length === 7);
  ok('FCB-DEST-4 Budgets hub omits its own self-link, keeps Finance', fromBudgetsHub.length === 7 && fromBudgetsHub.some((e) => e && e.label === 'Finance'));
}
console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
