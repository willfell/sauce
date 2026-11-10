#!/usr/bin/env node
'use strict';

// run-installed-notes-no-templater.js — a markdown file the installer copies
// straight into a vault (any files[] entry whose dest is not the templates
// folder) is written verbatim after {{variable}} substitution. Templater never
// runs on it, so a `<% ... %>` tag lands in the note as literal text: in
// frontmatter Obsidian flags the property as invalid (All-ToDos.md and
// Recurring.md shipped `created_at: "<% tp.file.creation_date(...) %>"`).
// Only notes that go through Templater (dest under {{templates_path}}) may
// carry tags. Zero-dep. Exit 0 iff no offenders.

const fs = require('fs');
const path = require('path');

const PLATFORM = path.resolve(__dirname, '..');
const offenders = [];
let checked = 0;

for (const kind of ['blueprints', 'mechanisms']) {
  const dir = path.join(PLATFORM, kind);
  for (const name of fs.readdirSync(dir)) {
    const manifestPath = path.join(dir, name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const entry of manifest.files || []) {
      if (!entry || typeof entry.source !== 'string' || typeof entry.dest !== 'string') continue;
      if (!/\.md$/i.test(entry.dest) || entry.dest.includes('{{templates_path}}')) continue;
      const source = path.join(dir, name, entry.source);
      if (!fs.existsSync(source)) continue;
      checked += 1;
      const text = fs.readFileSync(source, 'utf8');
      const line = text.split('\n').findIndex((l) => /<%[\s\S]*?%>|<%/.test(l));
      if (line >= 0) offenders.push(`${kind}/${name}/${entry.source}:${line + 1} -> ${entry.dest}`);
    }
  }
}

if (checked === 0) {
  console.error('FAIL — no installer-copied notes found; the manifest scan is broken');
  process.exit(1);
}
if (offenders.length) {
  console.error('FAIL — installer-copied notes carry Templater tags that will never run:');
  for (const o of offenders) console.error('  ' + o);
  process.exit(1);
}
console.log(`PASS — ${checked} installer-copied notes carry no Templater tags`);
