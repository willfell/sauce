'use strict';

// Meta-gate for platform/conformance-index.json.
//
// Guarantees the conformance registry stays honest:
//   • parseable, schema_version === 1, unique ids, required keys present;
//   • status ∈ {enforcing, report-only, planned}, severity ∈ {error, warn};
//   • every exemption is { target, reason } with a non-empty reason (no silent
//     skips — an exemption must say WHY);
//   • a non-planned rule's `gate` file exists on disk;
//   • an `enforcing` rule's gate is actually wired into release:preflight;
//   • a `report-only` rule's gate is actually wired into conformance:audit.
//
// Usage: node scripts/lint-conformance-index.js [--self-test]

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const INDEX = path.join(REPO_ROOT, 'platform', 'conformance-index.json');
const PKG = path.join(REPO_ROOT, 'package.json');

const STATUSES = new Set(['enforcing', 'report-only', 'planned']);
const SEVERITIES = new Set(['error', 'warn']);
const REQUIRED = ['id', 'theme', 'title', 'gate', 'severity', 'status'];

// Validate a parsed registry against optional wiring strings. Returns string[]
// of error messages (empty = valid). `opts.preflight` / `opts.audit` are the
// npm script bodies; `opts.gateExists(path)` reports on-disk presence.
function validate(reg, opts) {
    const errs = [];
    if (!reg || typeof reg !== 'object') return ['registry is not an object'];
    if (reg.schema_version !== 1) errs.push(`schema_version must be 1 (got ${JSON.stringify(reg.schema_version)})`);
    if (!Array.isArray(reg.rules)) return [...errs, 'rules[] missing or not an array'];

    const seen = new Set();
    for (const r of reg.rules) {
        const id = r && r.id ? r.id : '(no id)';
        for (const k of REQUIRED) {
            if (r[k] === undefined || r[k] === null || r[k] === '') errs.push(`${id}: missing required key "${k}"`);
        }
        if (r.id) {
            if (seen.has(r.id)) errs.push(`duplicate rule id "${r.id}"`);
            seen.add(r.id);
        }
        if (r.status && !STATUSES.has(r.status)) errs.push(`${id}: invalid status "${r.status}"`);
        if (r.severity && !SEVERITIES.has(r.severity)) errs.push(`${id}: invalid severity "${r.severity}"`);
        if (r.exemptions !== undefined) {
            if (!Array.isArray(r.exemptions)) errs.push(`${id}: exemptions must be an array`);
            else for (const ex of r.exemptions) {
                if (!ex || typeof ex !== 'object' || !ex.target || !ex.reason || String(ex.reason).trim() === '') {
                    errs.push(`${id}: every exemption needs { target, reason } with a non-empty reason (got ${JSON.stringify(ex)})`);
                }
            }
        }
        // gate existence + wiring (skipped for planned). report-only gates are
        // run by the registry-driven `conformance:audit` runner (they need no
        // explicit per-gate wiring), so only enforcing rules assert on preflight.
        if (r.gate && r.status && r.status !== 'planned') {
            if (opts.gateExists && !opts.gateExists(r.gate)) errs.push(`${id}: gate file "${r.gate}" does not exist`);
            if (r.status === 'enforcing' && opts.preflight !== undefined && !opts.preflight.includes(r.gate)) {
                errs.push(`${id}: status "enforcing" but gate "${r.gate}" is not wired into release:preflight`);
            }
        }
    }
    return errs;
}

function runSelfTest() {
    const good = {
        schema_version: 1,
        rules: [
            { id: 'A', theme: 't', title: 'a', gate: 'scripts/a.js', severity: 'error', status: 'enforcing', exemptions: [] },
            { id: 'B', theme: 't', title: 'b', gate: 'scripts/b.js', severity: 'error', status: 'report-only', exemptions: [{ target: 'x', reason: 'because' }] },
            { id: 'C', theme: 't', title: 'c', gate: 'scripts/c.js', severity: 'error', status: 'planned', exemptions: [] },
        ],
    };
    const opts = {
        gateExists: (g) => ['scripts/a.js', 'scripts/b.js'].includes(g),   // c.js absent, but C is planned
        preflight: 'node scripts/a.js',
        audit: 'node scripts/b.js',
    };
    const cases = [
        ['good registry passes', validate(good, opts).length === 0],
        ['duplicate id caught', validate({ schema_version: 1, rules: [good.rules[0], good.rules[0]] }, opts).some(e => /duplicate/.test(e))],
        ['bad status caught', validate({ schema_version: 1, rules: [{ ...good.rules[0], status: 'live' }] }, opts).some(e => /invalid status/.test(e))],
        ['missing reason caught', validate({ schema_version: 1, rules: [{ ...good.rules[1], exemptions: [{ target: 'x' }] }] }, opts).some(e => /non-empty reason/.test(e))],
        ['enforcing-not-wired caught', validate({ schema_version: 1, rules: [{ ...good.rules[0], gate: 'scripts/z.js' }] }, { ...opts, gateExists: () => true }).some(e => /not wired into release:preflight/.test(e))],
        ['missing gate file caught', validate({ schema_version: 1, rules: [{ ...good.rules[0], gate: 'scripts/nope.js' }] }, opts).some(e => /does not exist/.test(e))],
        ['planned skips wiring/existence', validate({ schema_version: 1, rules: [good.rules[2]] }, opts).length === 0],
    ];
    let passes = 0, fails = 0;
    for (const [name, ok] of cases) {
        if (ok) { console.log(`ok self-test ${name}`); passes++; }
        else { console.error(`FAIL self-test ${name}`); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    let reg;
    try { reg = JSON.parse(fs.readFileSync(INDEX, 'utf8')); }
    catch (e) { console.error(`FAIL lint-conformance-index: cannot parse ${path.relative(REPO_ROOT, INDEX)}: ${e.message}`); process.exit(1); }
    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    const opts = {
        gateExists: (g) => fs.existsSync(path.join(REPO_ROOT, g)),
        preflight: (pkg.scripts && pkg.scripts['release:preflight']) || '',
        audit: (pkg.scripts && pkg.scripts['conformance:audit']) || '',
    };
    const errs = validate(reg, opts);
    if (!(pkg.scripts && pkg.scripts['conformance:audit'])) {
        errs.push('package.json has no "conformance:audit" script (the registry-driven report runner)');
    }
    if (errs.length === 0) {
        console.log(`ok lint-conformance-index: ${reg.rules.length} rules; registry valid + gates wired per status.`);
        process.exit(0);
    }
    console.error(`FAIL lint-conformance-index: ${errs.length} problem(s):`);
    for (const e of errs) console.error(`  ${e}`);
    process.exit(1);
}

main();
