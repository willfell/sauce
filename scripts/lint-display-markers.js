'use strict';

// v0.119.0 thrash-defenses #4 — anchor lint.
// Flags parsers that key on display-mutable markdown markers (^## , ^### )
// which future cosmetic migrations may rewrite. Prefer stable HTML-comment
// anchors, frontmatter, or block-ids.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/lint-display-markers-baseline.json');

const SCAN_DIRS = ['platform'];
const SKIP_PATTERNS = [
    /platform\/test\//,
    /platform\/migrate\//,
    /platform\/install\.js$/,
    /node_modules\//,
    /\.sauce-backup\//,
];

const HEADING_REGEX_PATTERN = /\/\^#{1,6}\s/;            // /^## /, /^### /, etc.
const HEADING_STRING_PATTERN = /['"`]## .+?['"`]/;        // '## Recurring Tasks', etc.
const HEADING_STARTSWITH_PATTERN = /\.startsWith\(\s*['"`]## /;
const HEADING_INDEXOF_PATTERN = /\.indexOf\(\s*['"`]## /;

function walkDir(dir, exts) {
    const out = [];
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) return out;
    const stack = [abs];
    while (stack.length) {
        const cur = stack.pop();
        let entries;
        try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (_e) { continue; }
        for (const e of entries) {
            const p = path.join(cur, e.name);
            if (e.isDirectory()) { stack.push(p); continue; }
            if (!exts.some(x => p.endsWith(x))) continue;
            const rel = path.relative(REPO_ROOT, p);
            if (SKIP_PATTERNS.some(re => re.test(rel))) continue;
            out.push(p);
        }
    }
    return out;
}

function scanFile(file) {
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    const warnings = [];
    lines.forEach((line, idx) => {
        // Strip comments out of the line first — comments are allowed to mention headings.
        // For simplicity: strip from // to end OR /* to */ if same line.
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*\*\//g, '');

        // Opt-out marker support (on the SAME line as the flagged construct).
        if (/\/\/\s*lint-display-markers:allow\b/.test(line)) return;

        if (HEADING_REGEX_PATTERN.test(code)
            || HEADING_STARTSWITH_PATTERN.test(code)
            || HEADING_INDEXOF_PATTERN.test(code)
            || HEADING_STRING_PATTERN.test(code)) {
            warnings.push({
                file: path.relative(REPO_ROOT, file),
                line: idx + 1,
                snippet: line.trim(),
            });
        }
    });
    return warnings;
}

function loadBaseline() {
    if (!fs.existsSync(BASELINE_PATH)) return { warnings: [] };
    try { return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')); }
    catch (_e) { return { warnings: [] }; }
}

function writeBaseline(warnings) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify({ warnings }, null, 2) + '\n');
}

function warningKey(w) {
    return `${w.file}:${w.line}:${w.snippet}`;
}

function main() {
    const args = process.argv.slice(2);

    // --self-test mode: scan only platform/test/fixtures/lint-display-markers/
    if (args.includes('--self-test')) {
        const fixturesDir = 'platform/test/fixtures/lint-display-markers';
        const files = walkDir(fixturesDir, ['.js']);
        const expectations = {
            'clean.js': 0,
            'regex-heading.js': 1,
            'string-prefix.js': 1,
            'opt-out.js': 0,
            'mixed.js': 2,
        };
        let passes = 0; let fails = 0;
        for (const f of files) {
            const rel = path.basename(f);
            if (!(rel in expectations)) continue;
            const warns = scanFile(f).filter(_ => true);  // self-test ignores baseline
            if (warns.length === expectations[rel]) {
                console.log(`ok lint-self-test ${rel}: ${warns.length} warning(s) as expected`);
                passes++;
            } else {
                console.error(`FAIL lint-self-test ${rel}: expected ${expectations[rel]}, got ${warns.length}`);
                for (const w of warns) console.error(`  ${w.file}:${w.line} — ${w.snippet}`);
                fails++;
            }
        }
        console.log(`\n${passes} passed, ${fails} failed`);
        process.exit(fails === 0 ? 0 : 1);
    }

    // Normal mode.
    const allWarnings = [];
    for (const dir of SCAN_DIRS) {
        for (const f of walkDir(dir, ['.js'])) {
            allWarnings.push(...scanFile(f));
        }
    }

    if (args.includes('--update-baseline')) {
        writeBaseline(allWarnings);
        console.log(`Baseline updated: ${allWarnings.length} warning(s) recorded.`);
        process.exit(0);
    }

    const baseline = loadBaseline();
    const baselineKeys = new Set(baseline.warnings.map(warningKey));
    const newWarnings = allWarnings.filter(w => !baselineKeys.has(warningKey(w)));

    if (newWarnings.length === 0) {
        console.log(`ok lint-display-markers: ${allWarnings.length} grandfathered warning(s); no new warnings.`);
        process.exit(0);
    }

    console.error(`FAIL lint-display-markers: ${newWarnings.length} NEW warning(s) (baseline has ${baseline.warnings.length}):\n`);
    for (const w of newWarnings) {
        console.error(`  ${w.file}:${w.line}`);
        console.error(`    ${w.snippet}`);
        console.error('    → Prefer a stable anchor (HTML comment, frontmatter, block-id). Opt-out:');
        console.error(`      ${w.snippet.split('\n')[0]}  // lint-display-markers:allow <reason>`);
    }
    console.error('');
    console.error('If these are intentional, opt out each line OR regenerate the baseline:');
    console.error('  npm run lint-display-markers -- --update-baseline');
    process.exit(1);
}

main();
