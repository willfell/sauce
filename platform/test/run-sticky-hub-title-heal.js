#!/usr/bin/env node
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const install = require(path.join(ROOT, 'platform/install.js'));

const stripHubH1 = install._stripHubH1;

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

ok('SHTH-0 _stripHubH1 exported', typeof stripHubH1 === 'function');

const stickyBefore = `---\ntype: sticky-hub\n---\n\n# Sticky Notes\n\n\`\`\`dataviewjs\nawait dv.view("x", { class: "StickyChromeBar" });\n\`\`\`\n`;
const stickyAfter = stripHubH1(stickyBefore, 'Sticky Notes');
ok('SHTH-1 removes `# Sticky Notes` line', !/^# Sticky Notes\s*$/m.test(stickyAfter));
ok('SHTH-2 idempotent', stripHubH1(stickyAfter, 'Sticky Notes') === stickyAfter);

const journalBefore = `---\ntype: journal-hub\n---\n\n# Journal\n\n\`\`\`dataviewjs\nawait dv.view("x", { class: "JournalChromeBar" });\n\`\`\`\n`;
const journalAfter = stripHubH1(journalBefore, 'Journal');
ok('SHTH-3 removes `# Journal` line', !/^# Journal\s*$/m.test(journalAfter));
ok('SHTH-4 collapses 3+ newlines to 2', !/\n\n\n/.test(journalAfter));

const clean = `---\ntype: sticky-hub\n---\n\n\`\`\`dataviewjs\n\`\`\`\n`;
ok('SHTH-5 no-op when H1 missing', stripHubH1(clean, 'Sticky Notes') === clean);

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
