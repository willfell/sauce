'use strict';

// TPL-1 — path-variables gate.
//
// Non-negotiable #3: file paths in mechanism/blueprint source use
// `{{template_variables}}`, never hardcoded runtime paths. The installer
// substitutes `{{views_path}}` -> `ranch/views` (etc.) per consumer's
// platform-config.json, so a hardcoded `ranch/views/customjs-guard` breaks any
// consumer that maps its runtime dir elsewhere. The fix is byte-identical for
// the default mapping.
//
// Flags literal `ranch/views`, `ranch/scripts`, `ranch/templates` in blueprint
// + mechanism source (templates, content, helper/view JS). The variable form
// (`{{views_path}}`) has no `ranch/` substring, so there is no overlap.
//
// Scope: platform/{blueprints,mechanisms}/**/*.{md,js}
// Opt-out: `<!-- lint-path-variables:allow <reason> -->` (md) /
//          `// lint-path-variables:allow <reason>` (js).

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const ROOTS = [
    path.join(REPO_ROOT, 'platform', 'blueprints'),
    path.join(REPO_ROOT, 'platform', 'mechanisms'),
];

const HARDCODED_RE = /ranch\/(views|scripts|templates)\b/;
const VAR_FOR = { views: '{{views_path}}', scripts: '{{scripts_path}}', templates: '{{templates_path}}' };
const ALLOW_RE = /(?:<!--|\/\/)\s*lint-path-variables:allow\b/;

function walk(root, pred) {
    const out = [];
    const rec = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_e) { return; }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) rec(p);
            else if (pred(e.name)) out.push(p);
        }
    };
    rec(root);
    return out;
}

function lintContent(content) {
    const violations = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
        const re = /ranch\/(views|scripts|templates)\b/g;
        let m;
        while ((m = re.exec(line)) !== null) {
            violations.push({
                line: i + 1,
                message: `hardcoded runtime path \`ranch/${m[1]}\` — use \`${VAR_FOR[m[1]]}\` (installer substitutes per consumer).`,
            });
        }
    }
    return violations;
}

// Test fixtures / expected-output files legitimately embed the RESOLVED
// `ranch/...` path (they assert a helper's rendered output). They are not
// source-to-substitute and must not be flagged.
const EXCLUDE_RE = /(?:^|\/)(?:fixtures|test|seed-vault)\/|(?:^|\/)expected-[^/]*$/;
function collect() {
    return ROOTS
        .flatMap(r => walk(r, n => n.endsWith('.md') || n.endsWith('.js')))
        .filter(f => !EXCLUDE_RE.test(path.relative(REPO_ROOT, f)));
}

function runSelfTest() {
    const cases = [
        { name: 'fail/hardcoded-md', content: 'await dv.view("ranch/views/customjs-guard", { class: "X" });', expect: true },
        { name: 'fail/hardcoded-scripts', content: 'require("ranch/scripts/foo")', expect: true },
        { name: 'pass/var-form', content: 'await dv.view("{{views_path}}/customjs-guard", { class: "X" });', expect: false },
        { name: 'pass/unrelated', content: 'const x = "spice/trips/foo";', expect: false },
        { name: 'pass/opt-out', content: 'await dv.view("ranch/views/x"); // lint-path-variables:allow legacy', expect: false },
    ];
    let passes = 0, fails = 0;
    for (const c of cases) {
        const flagged = lintContent(c.content).length > 0;
        if (flagged === c.expect) { console.log(`ok self-test ${c.name}: ${c.expect ? 'flagged' : 'clean'} as expected`); passes++; }
        else { console.error(`FAIL self-test ${c.name}: expected ${c.expect ? 'violation' : 'clean'}, got ${flagged ? 'violation' : 'clean'}`); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    const files = collect();
    const violations = [];
    for (const f of files) {
        for (const v of lintContent(fs.readFileSync(f, 'utf8'))) {
            violations.push({ file: path.relative(REPO_ROOT, f), line: v.line, message: v.message });
        }
    }
    if (violations.length === 0) {
        console.log(`ok lint-path-variables: ${files.length} source file(s) scanned; no hardcoded ranch/ runtime paths.`);
        process.exit(0);
    }
    console.error(`FAIL lint-path-variables: ${violations.length} hardcoded runtime path(s):\n`);
    for (const v of violations) { console.error(`  ${v.file}:${v.line}`); console.error(`    ${v.message}`); }
    process.exit(1);
}

main();
