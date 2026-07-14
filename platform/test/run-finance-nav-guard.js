#!/usr/bin/env node
'use strict';

// run-finance-nav-guard.js — unit harness for FinanceNav's chrome-presence guard
// (mirrors the ReaderArticleActions / PersonNavButtons precedent covered by
// run-reader.js's HC-READER-13). Once a finance note carries FinanceChromeBar
// (v0.204.0+), its Go▾ launcher already lists all 7 hubs — FinanceNav's
// Section 1 cross-hub button row, and the single "<X> Hub" back-buttons in
// entity/defaults context, become redundant and must be SKIPPED. Prev/Next
// sibling nav + hub Defaults links are now in the chrome bar overflow menu.
// "+ New X" is now ALSO guarded (v0.205.0+ — FinanceChromeBar's own primary
// button, to the right of the compass, owns it once migrated); the
// defaults-page link (Budget/Paycheck/Debt Defaults) is untouched either way.
// Minimal DOM/app stubs — no real Dataview.

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const FinanceNav = loadClass('platform/blueprints/finance/helpers/finance-nav.js', 'FinanceNav');

const results = [];
const ok = (n, c, detail) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}${detail && !c ? ' — ' + detail : ''}`); };

function makeStubEl(overrides) {
  const el = Object.assign({
    style: {},
    children: [],
    attr: {},
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createEl(_tag, opts) { const child = makeStubEl(); child._text = opts && opts.text; this.children.push(child); return child; },
    addEventListener() {},
    remove() {},
  }, overrides || {});
  return el;
}

function makeDv(previewHasChromeRoot, page) {
  const previewView = makeStubEl({ querySelector: (sel) => (sel === '.finance-chrome-root' && previewHasChromeRoot ? makeStubEl() : null) });
  const container = makeStubEl({
    closest: (sel) => (sel === '.markdown-preview-view' ? previewView : (sel === '.markdown-embed' ? null : null)),
    querySelector: () => null, // no pre-existing .fnav-root to dedupe
  });
  return { dv: { container, current: () => page }, container };
}

async function run() {
  const prevApp = global.app;
  const prevWindow = global.window;
  const prevCustomJS = global.customJS;
  const accentButtonCalls = [];
  const entityCreateCalls = [];
  global.app = { workspace: { openLinkText: () => {} }, vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } };
  global.customJS = {
    AccentButton: { render: (row, opts) => { accentButtonCalls.push(opts && opts.label); return makeStubEl(); } },
    EntityCreate: { render: async (_shim, opts) => { entityCreateCalls.push(opts && opts.instance); } },
  };
  global.window = { customJS: global.customJS };

  try {
    // FNG-1/2 — top hub (hub-finance): only has Section 1 (cross-hub row); no
    // Section 2 applies. chromePresent=true → root ends up with ZERO children.
    {
      const { dv, container } = makeDv(true, { file: { path: 'spice/finance/Finance.md' }, type: 'finance-hub' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      const root = container.children[0];
      ok('FNG-1 hub-finance + chromePresent: cross-hub row fully skipped (root has no children)',
        root && root.children.length === 0, 'childCount=' + (root && root.children.length));
    }
    {
      const { dv, container } = makeDv(false, { file: { path: 'spice/finance/Finance.md' }, type: 'finance-hub' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      const root = container.children[0];
      ok('FNG-2 hub-finance + no chrome (legacy/unmigrated): cross-hub row still renders',
        root && root.children.length > 0, 'childCount=' + (root && root.children.length));
    }

    // FNG-3/4 — entity page (entity-budget): Section 1 skipped when chrome
    // present; Section 2's "Budgets Hub" back-button skipped too, but the row
    // itself + Prev/Next attempt still happen (no siblings in this stub, so
    // no AccentButton call for either — assert zero AccentButton calls when
    // chrome present vs. one ["Budgets Hub"] call when chrome absent).
    {
      const { dv } = makeDv(true, { file: { path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' }, type: 'budget', month: '2026-07' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-3 entity-budget + chromePresent: no "Budgets Hub" back-button rendered',
        !accentButtonCalls.includes('Budgets Hub'), 'calls=' + JSON.stringify(accentButtonCalls));
    }
    {
      const { dv } = makeDv(false, { file: { path: 'spice/finance/budgets/2026-07/Budget-2026-07.md' }, type: 'budget', month: '2026-07' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-4 entity-budget + no chrome: "Budgets Hub" back-button still rendered',
        accentButtonCalls.includes('Budgets Hub'), 'calls=' + JSON.stringify(accentButtonCalls));
    }

    // FNG-5/6 — defaults page (defaults-budget): entirely redundant once
    // chrome-migrated (its ONLY content is a "Budgets Hub" back-button) —
    // both the row AND its trailing divider must be skipped, not just the button.
    {
      const { dv, container } = makeDv(true, { file: { path: 'spice/finance/Budget Defaults.md' }, type: 'budget-defaults' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      const root = container.children[0];
      ok('FNG-5 defaults-budget + chromePresent: entire row + divider skipped (root has no children)',
        root && root.children.length === 0 && !accentButtonCalls.includes('Budgets Hub'),
        'childCount=' + (root && root.children.length) + ' calls=' + JSON.stringify(accentButtonCalls));
    }
    {
      const { dv } = makeDv(false, { file: { path: 'spice/finance/Budget Defaults.md' }, type: 'budget-defaults' });
      accentButtonCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-6 defaults-budget + no chrome: "Budgets Hub" back-button still rendered',
        accentButtonCalls.includes('Budgets Hub'), 'calls=' + JSON.stringify(accentButtonCalls));
    }

    // FNG-7/8 — hub-budgets: "+ New Budget" AND "Budget Defaults" are now
    // owned by FinanceChromeBar (primary + overflow) once migrated — both
    // inline renders must be SKIPPED when chrome is present.
    {
      const { dv } = makeDv(true, { file: { path: 'spice/finance/budgets/Budgets.md' }, type: 'budgets-hub' });
      accentButtonCalls.length = 0; entityCreateCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-7 hub-budgets + chromePresent: EntityCreate not invoked, Budget Defaults not rendered',
        entityCreateCalls.length === 0 && !accentButtonCalls.includes('Budget Defaults'),
        'entityCreateCalls=' + JSON.stringify(entityCreateCalls) + ' accentButtonCalls=' + JSON.stringify(accentButtonCalls));
    }
    {
      const { dv } = makeDv(false, { file: { path: 'spice/finance/budgets/Budgets.md' }, type: 'budgets-hub' });
      accentButtonCalls.length = 0; entityCreateCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-8 hub-budgets + no chrome: EntityCreate(instance:"budget") still invoked, Budget Defaults link still renders',
        entityCreateCalls.includes('budget') && accentButtonCalls.includes('Budget Defaults'),
        'entityCreateCalls=' + JSON.stringify(entityCreateCalls) + ' accentButtonCalls=' + JSON.stringify(accentButtonCalls));
    }

    // FNG-9/10 — hub-invoices: no defaults link exists for invoices, so once
    // "+ New Invoice" moves to the chrome-bar primary there is NOTHING left
    // to show in this section — the whole row + trailing divider must vanish,
    // same posture as the already-covered defaults-page case (FNG-5).
    {
      const { dv, container } = makeDv(true, { file: { path: 'spice/finance/invoices/Invoices.md' }, type: 'invoices-hub' });
      entityCreateCalls.length = 0;
      await new FinanceNav().render(dv);
      const root = container.children[0];
      ok('FNG-9 hub-invoices + chromePresent: entire row + divider skipped (root has no children)',
        root && root.children.length === 0 && entityCreateCalls.length === 0,
        'childCount=' + (root && root.children.length) + ' entityCreateCalls=' + JSON.stringify(entityCreateCalls));
    }
    {
      const { dv } = makeDv(false, { file: { path: 'spice/finance/invoices/Invoices.md' }, type: 'invoices-hub' });
      entityCreateCalls.length = 0;
      await new FinanceNav().render(dv);
      ok('FNG-10 hub-invoices + no chrome: EntityCreate(instance:"invoice") still invoked',
        entityCreateCalls.includes('invoice'), 'entityCreateCalls=' + JSON.stringify(entityCreateCalls));
    }
  } finally {
    global.app = prevApp;
    global.window = prevWindow;
    global.customJS = prevCustomJS;
  }

  console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
  process.exit(results.every(([, c]) => c) ? 0 : 1);
}

run();
