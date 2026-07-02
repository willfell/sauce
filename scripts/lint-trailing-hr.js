'use strict';

// TPL-5 — no-trailing-hr gate.
//
// A trailing `---` horizontal rule as the last non-blank line of a template
// body renders as a dangling divider with nothing after it. Internal `---`
// dividers BETWEEN widgets are legitimate and are not flagged — only the final
// trailing rule is. A file that is frontmatter-only (its last non-blank line is
// the frontmatter CLOSING fence) is never flagged.
//
// Scope: platform/blueprints/**/templates/*.md
// Opt-out: `<!-- lint-trailing-hr:allow <reason> -->` on the rule line or the
// line directly above it.
//
// Usage:
//   node scripts/lint-trailing-hr.js            # lint the real tree
//   node scripts/lint-trailing-hr.js --self-test

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BLUEPRINTS_DIR = path.join(REPO_ROOT, 'platform', 'blueprints');
const ALLOW_RE = /<!--\s*lint-trailing-hr:allow\b.*?-->/;

// Returns { open, close } line indices (0-based) of the leading `---`-fenced
// frontmatter, or null. Skips one optional leading Templater `<% … %>` header.
function frontmatterBounds(lines) {
    let i = 0;
    if (i < lines.length && /^\s*<%/.test(lines[i])) {
        if (/(-%>|%>)\s*$/.test(lines[i])) {
            i++;
        } else {
            i++;
            while (i < lines.length && !/(-%>|%>)\s*$/.test(lines[i])) i++;
            if (i < lines.length) i++;
        }
    }
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length || lines[i].trim() !== '---') return null;
    const open = i;
    for (let j = open + 1; j < lines.length; j++) {
        if (lines[j].trim() === '---') return { open, close: j };
    }
    return null;   // unterminated frontmatter → treat as none
}

// Returns [{ line, message }] — at most one violation per file.
function lintContent(content) {
    const lines = content.split('\n');

    let lastIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim() !== '') { lastIdx = i; break; }
    }
    if (lastIdx < 0) return [];                       // empty file
    if (lines[lastIdx].trim() !== '---') return [];   // no trailing rule

    const fm = frontmatterBounds(lines);
    if (fm && lastIdx === fm.close) return [];        // frontmatter-only file

    const prev = lastIdx > 0 ? lines[lastIdx - 1] : '';
    if (ALLOW_RE.test(lines[lastIdx]) || ALLOW_RE.test(prev)) return [];

    return [{
        line: lastIdx + 1,
        message: 'trailing `---` horizontal rule at end of template body — remove it (internal dividers between widgets are fine; a dangling final rule is not).',
    }];
}

function collectTemplates() {
    const out = [];
    let bps;
    try { bps = fs.readdirSync(BLUEPRINTS_DIR, { withFileTypes: true }); }
    catch (_e) { return out; }
    for (const e of bps) {
        if (!e.isDirectory()) continue;
        const tplDir = path.join(BLUEPRINTS_DIR, e.name, 'templates');
        let tpls;
        try { tpls = fs.readdirSync(tplDir); }
        catch (_e) { continue; }
        for (const name of tpls) {
            if (!name.endsWith('.md')) continue;
            const file = path.join(tplDir, name);
            out.push({ blueprint: e.name, file, content: fs.readFileSync(file, 'utf8') });
        }
    }
    return out;
}

function runSelfTest() {
    const fixturesDir = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'lint-trailing-hr');
    const cases = [{ dir: 'pass', expect: false }, { dir: 'fail', expect: true }];
    let passes = 0, fails = 0;
    for (const c of cases) {
        const dirAbs = path.join(fixturesDir, c.dir);
        let files;
        try { files = fs.readdirSync(dirAbs).filter(f => f.endsWith('.md')); }
        catch (_e) { files = []; }
        for (const name of files) {
            const content = fs.readFileSync(path.join(dirAbs, name), 'utf8');
            const flagged = lintContent(content).length > 0;
            const rel = path.join('platform/test/fixtures/lint-trailing-hr', c.dir, name);
            if (flagged === c.expect) { console.log(`ok self-test ${rel}: ${c.expect ? 'flagged' : 'clean'} as expected`); passes++; }
            else { console.error(`FAIL self-test ${rel}: expected ${c.expect ? 'violation' : 'clean'}, got ${flagged ? 'violation' : 'clean'}`); fails++; }
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    const templates = collectTemplates();
    const violations = [];
    for (const t of templates) {
        for (const v of lintContent(t.content)) {
            violations.push({ file: path.relative(REPO_ROOT, t.file), line: v.line, message: v.message });
        }
    }
    if (violations.length === 0) {
        console.log(`ok lint-trailing-hr: ${templates.length} template(s) scanned; no trailing-rule violations.`);
        process.exit(0);
    }
    console.error(`FAIL lint-trailing-hr: ${violations.length} trailing-rule violation(s):\n`);
    for (const v of violations) { console.error(`  ${v.file}:${v.line}`); console.error(`    ${v.message}`); }
    console.error('\nRemove the trailing `---`, or opt out one line with `<!-- lint-trailing-hr:allow <reason> -->`.');
    process.exit(1);
}

main();
