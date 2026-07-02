#!/usr/bin/env node
/**
 * run-content-token-leaks.js — consistency-audit regression guard.
 *
 * Shipped `content/*.md` notes are materialized by the installer, which
 * substitutes ONLY its known `variables` tokens (views_path / scripts_path /
 * templates_path / module_directory / vault_identity_tag) via a `\w+`-only regex.
 * Any OTHER `{{token}}` — Templater's `{{DATE}}`/`{{TIME}}`, or `{{now.<fmt>}}`
 * (which entity-create resolves only at note-creation time, NEVER on installer
 * file-copy) — leaks into the shipped hub note as a literal string.
 *
 * The audit found `created: {{DATE}}` in products/teams hubs AND
 * `created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"` in the wiki hub. This harness
 * asserts every blueprint content note contains ONLY allowlisted installer
 * tokens; reverting any of the fixes makes it red.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BP = path.join(ROOT, 'platform', 'blueprints');

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// The ONLY tokens the installer substitutes when materializing content/*.md
// (config.variables in install.js). Any {{token}} whose name is not in this set
// leaks literally into the shipped note.
const ALLOWED = new Set(['views_path', 'scripts_path', 'templates_path', 'module_directory', 'vault_identity_tag']);
// token name = inner text up to the first separator (so `now.YYYY-MM-DD` -> `now`,
// `views_path` -> `views_path`).
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const tokenName = (inner) => inner.split(/[.\s|/:]/)[0];

const files = [];
for (const bp of fs.readdirSync(BP)) {
  const cdir = path.join(BP, bp, 'content');
  if (!fs.existsSync(cdir)) continue;
  for (const f of fs.readdirSync(cdir)) if (f.endsWith('.md')) files.push(path.join(cdir, f));
}
ok('CTL-0 found content notes to scan', files.length > 0);

const leaks = [];
let tokenCount = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    tokenCount++;
    const name = tokenName(m[1]);
    if (!ALLOWED.has(name)) leaks.push(`${path.relative(ROOT, f)} -> ${m[0]}`);
  }
}
if (leaks.length) console.log('  LEAKS:\n    ' + leaks.join('\n    '));
ok('CTL-1 no content note leaks a non-installer {{token}} (only allowlisted vars)', leaks.length === 0);

// Sanity: the allowlist must actually admit the real path tokens (guards against
// an over-tight allowlist that would false-FAIL legit content).
ok('CTL-2 allowlist admits the canonical path tokens', ['views_path', 'templates_path', 'module_directory'].every((t) => ALLOWED.has(t)));

// Targeted: the three hubs the audit flagged now use created_at with a literal
// value (no leak, not the bare `created` field).
for (const [bp, hub] of [['products', 'Products.md'], ['teams', 'Teams.md'], ['wiki', 'Wiki Hub.md']]) {
  const fp = path.join(BP, bp, 'content', hub);
  if (!fs.existsSync(fp)) { ok(`CTL-3 ${bp}/${hub} present`, false); continue; }
  const fm = (fs.readFileSync(fp, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [null, ''])[1];
  let leakInFm = false; let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(fm)) !== null) if (!ALLOWED.has(tokenName(m[1]))) leakInFm = true;
  ok(`CTL-3 ${bp} hub created_at present + no token leak in frontmatter`, /^created_at:/m.test(fm) && !/^created:/m.test(fm) && !leakInFm);
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed (${tokenCount} tokens across ${files.length} content notes)`);
process.exit(allPass ? 0 : 1);
