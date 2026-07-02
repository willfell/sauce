'use strict';

// conformance:audit — registry-driven conformance report.
//
// Reads platform/conformance-index.json and runs every rule's gate, grouped by
// theme. Prints a status line per rule. Exit code is 0 iff every ENFORCING rule
// passes; report-only debt is shown but NOT fatal (that is the point of the
// report). `planned` rules are listed but not run. This is the "how much
// conformance debt remains" command; the blocking guarantees live in
// release:preflight.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const INDEX = path.join(REPO_ROOT, 'platform', 'conformance-index.json');

function runGate(gate) {
    const abs = path.join(REPO_ROOT, gate);
    if (!fs.existsSync(abs)) return { ran: false, ok: false, out: 'gate file missing' };
    const res = spawnSync('node', [abs], { cwd: REPO_ROOT, encoding: 'utf8' });
    return { ran: true, ok: res.status === 0, out: (res.stdout || '') + (res.stderr || '') };
}

// Summarize a gate's output to a compact one-liner (the final ok/FAIL/note line).
function summarize(out) {
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
    const head = lines.find(l => /^(ok|FAIL|note)\b/.test(l));
    return head || (lines[lines.length - 1] || '').slice(0, 120);
}

function main() {
    let reg;
    try { reg = JSON.parse(fs.readFileSync(INDEX, 'utf8')); }
    catch (e) { console.error(`cannot parse conformance-index.json: ${e.message}`); process.exit(1); }

    // Run each distinct gate once (several rules can share a gate).
    const gateResult = new Map();
    for (const r of reg.rules) {
        if (r.status === 'planned') continue;
        if (!gateResult.has(r.gate)) gateResult.set(r.gate, runGate(r.gate));
    }

    const byTheme = {};
    for (const r of reg.rules) (byTheme[r.theme] ||= []).push(r);

    let enforcingFail = 0, reportDebt = 0, planned = 0;
    console.log('\n=== Blueprint conformance audit ===\n');
    for (const theme of Object.keys(byTheme)) {
        console.log(`# ${theme}`);
        for (const r of byTheme[theme]) {
            if (r.status === 'planned') {
                planned++;
                console.log(`  · ${r.id} ${r.title} — PLANNED (gate not yet built/extended)`);
                continue;
            }
            const g = gateResult.get(r.gate);
            const pass = g.ok;
            if (!pass && r.status === 'enforcing') enforcingFail++;
            if (!pass && r.status === 'report-only') reportDebt++;
            const tag = pass ? 'PASS' : (r.status === 'enforcing' ? 'FAIL' : 'DEBT');
            console.log(`  ${pass ? '✓' : '✗'} ${r.id} ${r.title} [${r.status}] — ${tag}: ${summarize(g.out)}`);
        }
        console.log('');
    }

    console.log(`enforcing failures: ${enforcingFail} | report-only debt: ${reportDebt} | planned: ${planned}`);
    if (enforcingFail > 0) {
        console.error('\nFAIL: an enforcing conformance rule is red.');
        process.exit(1);
    }
    console.log('\nOK: all enforcing rules green (report-only debt is expected during the sweep).');
    process.exit(0);
}

main();
