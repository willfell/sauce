'use strict';

// TPL-4 — render-nothing gate.
//
// Canonical rule (project-blueprint-ui.md §2/§3, non-negotiable since v0.106.0.1):
// "Empty helper output = render NOTHING. No info callouts. No placeholder
// strings. No '(empty state)' UI." A view MUST NOT emit a user-facing
// "No <things> yet"-style placeholder for an empty collection — it renders
// nothing and lets the surrounding chrome carry the context.
//
// Detection: a DOM-text emit (`{ text: "…" }`, `.setText("…")`,
// `.textContent = "…"`) whose string begins with No/None/Nothing AND names an
// empty collection or temporal ("yet"/"assigned"/"found"/"items"/"tasks"/…).
// Field-value strings like "No due date" are NOT flagged (no collection noun).
//
// Scope: platform/blueprints/**/*.js + platform/mechanisms/**/*.js
// Opt-out: `// lint-empty-state:allow <reason>` on the line or the line above.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SCAN_ROOTS = [
    path.join(REPO_ROOT, 'platform', 'blueprints'),
    path.join(REPO_ROOT, 'platform', 'mechanisms'),
];

const ALLOW_RE = /\/\/\s*lint-empty-state:allow\b/;
// Emit contexts that put a string literal into the DOM as visible text.
const EMIT_RE = /(?:\btext:\s*|\.setText\(\s*|\.textContent\s*=\s*|\.innerText\s*=\s*)(["'`])([^"'`]*)\1/g;
// Empty-state phrasing: starts with no/none/nothing AND carries a collection or
// temporal signal, so field values ("No due date") are not caught.
const EMPTY_RE = /^\s*(no|none|nothing)\b.*\b(yet|assigned|found|here|empty|data|items?|tasks?|entries|results?|notes?|records?)\b/i;

function jsFilesUnder(root) {
    const out = [];
    const walk = (d) => {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_e) { return; }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.js')) out.push(p);
        }
    };
    walk(root);
    return out;
}

function lintContent(content) {
    const violations = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
        let m;
        EMIT_RE.lastIndex = 0;
        while ((m = EMIT_RE.exec(line)) !== null) {
            if (EMPTY_RE.test(m[2])) {
                violations.push({
                    line: i + 1,
                    message: `empty-state placeholder string "${m[2]}" — empty helper output must render NOTHING (project-blueprint-ui.md §3). Return/skip instead of emitting a placeholder.`,
                });
            }
        }
    }
    return violations;
}

function runSelfTest() {
    const cases = [
        { name: 'fail/no-tasks.js', content: 'list.createEl("div", { text: "No tasks assigned" });', expect: true },
        { name: 'fail/none-yet.js', content: "c.createEl('div', { text: 'No tasks yet. Add a checkbox above.' });", expect: true },
        { name: 'fail/set-text.js', content: 'el.setText("No results found");', expect: true },
        { name: 'pass/field-value.js', content: 'meta.createEl("span", { text: "No due date" });', expect: false },
        { name: 'pass/silent.js', content: 'if (!items.length) return;', expect: false },
        { name: 'pass/real-label.js', content: 'el.createEl("div", { text: "Workstreams" });', expect: false },
        { name: 'pass/opt-out.js', content: 'el.setText("No data available"); // lint-empty-state:allow legacy banner', expect: false },
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
    const files = SCAN_ROOTS.flatMap(jsFilesUnder);
    const violations = [];
    for (const f of files) {
        for (const v of lintContent(fs.readFileSync(f, 'utf8'))) {
            violations.push({ file: path.relative(REPO_ROOT, f), line: v.line, message: v.message });
        }
    }
    if (violations.length === 0) {
        console.log(`ok lint-empty-state: ${files.length} view file(s) scanned; no empty-state placeholders.`);
        process.exit(0);
    }
    console.error(`FAIL lint-empty-state: ${violations.length} empty-state placeholder(s):\n`);
    for (const v of violations) { console.error(`  ${v.file}:${v.line}`); console.error(`    ${v.message}`); }
    process.exit(1);
}

main();
