#!/usr/bin/env node
/**
 * run-cycle-status.js — GA-D2: cycle-status.md must stay a live-state pointer
 * file, not an archive. It has a hard byte cap; regen-cycle-status.js must
 * refuse to write a rewrite that would exceed it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const CYCLE_STATUS = path.join(ROOT, 'Docs', 'agent-guides', 'cycle-status.md');
const REGEN_SCRIPT = path.join(ROOT, 'scripts', 'regen-cycle-status.js');
const MAX_BYTES = 15360;

const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };

// CS-1 — the live file itself is within the cap right now.
{
  const size = fs.statSync(CYCLE_STATUS).size;
  ok(`CS-1 cycle-status.md is <= ${MAX_BYTES} bytes (actual ${size})`, size <= MAX_BYTES);
}

// CS-2 — regen-cycle-status.js declares the same cap constant, so drift
// between the harness and the enforcement can't happen silently.
{
  const src = fs.readFileSync(REGEN_SCRIPT, 'utf8');
  const m = src.match(/const\s+MAX_BYTES\s*=\s*(\d+)/);
  ok('CS-2 regen script declares MAX_BYTES matching this harness', m && Number(m[1]) === MAX_BYTES);
}

// CS-3 — regen script refuses (non-zero exit) to write a body over the cap.
// Build a scratch copy with an oversized `## Current` block and confirm the
// script's fatal-on-overflow path fires, without touching the real file.
{
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cycle-status-cap-'));
  const scratchWorkshop = tmpDir;
  const scratchDocsDir = path.join(scratchWorkshop, 'Docs', 'agent-guides');
  const scratchPlansDir = path.join(scratchWorkshop, 'Docs', 'plans');
  fs.mkdirSync(scratchDocsDir, { recursive: true });
  fs.mkdirSync(scratchPlansDir, { recursive: true });

  // Bloat lives AFTER '## Current' (in a later section) rather than inside it:
  // the regen script fully replaces the '## Current' block from the manifest +
  // latest result doc, so oversize there gets discarded on rewrite. Realistic
  // drift is bloat elsewhere in the file that the rewrite preserves verbatim.
  const oversizedFile = '## Current\n\n- **Workshop version:** `0.1.0`\n\n## Mechanisms\n\n' + ('x'.repeat(MAX_BYTES + 500)) + '\n';
  fs.writeFileSync(path.join(scratchDocsDir, 'cycle-status.md'), oversizedFile);
  fs.writeFileSync(path.join(scratchWorkshop, 'platform-manifest-stub.json'), '{}');
  fs.mkdirSync(path.join(scratchWorkshop, 'platform'), { recursive: true });
  fs.writeFileSync(path.join(scratchWorkshop, 'platform', 'manifest.json'), JSON.stringify({ workshop_version: '99.0.0' }));
  fs.writeFileSync(
    path.join(scratchPlansDir, '2026-01-01-scratch-result.md'),
    '---\ncycle_arc: scratch cycle for CS-3\n---\n\n## What shipped\n\nScratch.\n'
  );

  // Run the real regen script's logic against the scratch workshop by
  // pointing WORKSHOP-relative paths at it via a copied invocation: the
  // script resolves WORKSHOP from __dirname, so instead we copy the script
  // next to the scratch tree and invoke it there.
  const scratchScriptDir = path.join(scratchWorkshop, 'scripts');
  fs.mkdirSync(scratchScriptDir, { recursive: true });
  fs.copyFileSync(REGEN_SCRIPT, path.join(scratchScriptDir, 'regen-cycle-status.js'));

  let exitCode = 0;
  let stderr = '';
  try {
    execFileSync('node', [path.join(scratchScriptDir, 'regen-cycle-status.js')], { cwd: scratchWorkshop, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    exitCode = e.status;
    stderr = (e.stderr || '').toString();
  }

  ok('CS-3 regen script exits non-zero on an over-cap rewrite', exitCode !== 0);
  ok('CS-3b failure message names the byte cap', /byte cap|MAX_BYTES|15360/.test(stderr));

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

const allPass = results.every(([, p]) => p);
console.log(`\n${results.filter(([, p]) => p).length}/${results.length} passed`);
process.exit(allPass ? 0 : 1);
