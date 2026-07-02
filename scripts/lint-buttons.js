'use strict';

// BTN-1 / BTN-2 — button + glyph conformance gate (STRICT).
//
// Canonical button vocabulary (blueprint-conformance.md):
//   • nav / breadcrumb chrome -> nav_buttons[] / breadcrumb manifest blocks
//     (nav-buttons + breadcrumb mechanisms)
//   • "New X" creation        -> new_entity_buttons[] (entity-create mechanism)
//   • action buttons (Edit/Open/Delete) -> AccentButton.render(...)
//   • icons / glyphs          -> Icons.get('kebab-name') (icons mechanism)
//
// BTN-1 (strict): a hand-rolled button — `createEl("button", …)` or a literal
//   `<button …>` — anywhere OUTSIDE the sanctioned renderers is a violation.
//   The sanctioned renderers ARE the right way, so they are exempt.
// BTN-2 (strict): an emoji or a raw inline `<svg …>` used as a glyph outside
//   the icons mechanism is a violation — use Icons.get(...).
//
// Both are STRICT per the approved design. They are wired into `conformance:audit`
// (report), not `release:preflight`, until their (output-changing) sweeps land.
//
// Scope: platform/{blueprints,mechanisms}/**/*.js (+ .md for <button>/emoji glyphs)
// Opt-out: `// lint-buttons:allow <reason>` (js) / `<!-- lint-buttons:allow -->` (md)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const ROOTS = [
    path.join(REPO_ROOT, 'platform', 'blueprints'),
    path.join(REPO_ROOT, 'platform', 'mechanisms'),
];

// Sanctioned button renderers — exempt from BTN-1 (they ARE the mechanism).
const BTN1_EXEMPT_RE = /mechanisms\/(accent-button|nav-buttons|entity-create)\//;
// Icons mechanism is exempt from BTN-2 (it IS the glyph source).
const BTN2_EXEMPT_RE = /mechanisms\/icons\//;
const SKIP_RE = /(?:^|\/)(?:fixtures|test|seed-vault)\//;
const ALLOW_RE = /(?:\/\/|<!--)\s*lint-buttons:allow\b/;

const BTN_RE = /createEl\(\s*["'`]button\b|<button[\s>]/;
// Pictographic emoji, dingbats, misc symbols, transport/supplemental — the kind
// used as button/label glyphs. Plain unicode arrows are intentionally excluded.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2705}\u{2714}\u{2716}\u{274C}\u{2795}-\u{2797}]/u;
const RAW_SVG_RE = /["'`]\s*<svg[\s>]/;   // raw inline <svg glyph inside a string

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

// opts: { rel } — the repo-relative path, used for exemption checks.
function lintContent(content, opts) {
    const rel = opts.rel || '';
    const violations = [];
    const lines = content.split('\n');
    const btn1Exempt = BTN1_EXEMPT_RE.test(rel) || SKIP_RE.test(rel);
    // BTN-2 targets glyphs in rendered-UI view code (.js). Emoji in .md prose
    // (skill/command docs, orchestrator instructions) is documentation text, not
    // a button glyph, and is not flagged.
    const btn2Exempt = BTN2_EXEMPT_RE.test(rel) || SKIP_RE.test(rel) || !rel.endsWith('.js');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
        if (!btn1Exempt && BTN_RE.test(line)) {
            violations.push({ rule: 'BTN-1', line: i + 1, message: 'hand-rolled button — use AccentButton.render(parent, { label, icon, onClick }).' });
        }
        if (!btn2Exempt) {
            if (EMOJI_RE.test(line)) {
                violations.push({ rule: 'BTN-2', line: i + 1, message: `emoji glyph — use Icons.get('kebab-name') from the icons mechanism.` });
            } else if (RAW_SVG_RE.test(line)) {
                violations.push({ rule: 'BTN-2', line: i + 1, message: `raw inline <svg> glyph — use Icons.get('kebab-name').` });
            }
        }
    }
    return violations;
}

function collect() {
    return ROOTS.flatMap(r => walk(r, n => n.endsWith('.js') || n.endsWith('.md')));
}

function runSelfTest() {
    const cases = [
        { name: 'fail/createEl-button', rel: 'platform/blueprints/x/helpers/e.js', content: 'row.createEl("button", { text: "Save" });', expect: ['BTN-1'] },
        { name: 'fail/html-button', rel: 'platform/blueprints/x/helpers/e.js', content: 'el.innerHTML = "<button>Go</button>";', expect: ['BTN-1'] },
        { name: 'fail/emoji', rel: 'platform/blueprints/x/helpers/e.js', content: 'b.setText("✅ Done");', expect: ['BTN-2'] },
        { name: 'fail/raw-svg', rel: 'platform/blueprints/x/helpers/e.js', content: 'el.innerHTML = "<svg viewBox=\\"0 0 1 1\\"></svg>";', expect: ['BTN-2'] },
        { name: 'pass/accent-button', rel: 'platform/blueprints/x/helpers/e.js', content: 'customJS.AccentButton.render(parent, { label: "Save", icon });', expect: [] },
        { name: 'pass/icons', rel: 'platform/blueprints/x/helpers/e.js', content: "const svg = customJS.Icons.get('check');", expect: [] },
        { name: 'pass/sanctioned-btn1', rel: 'platform/mechanisms/accent-button/accent-button.js', content: 'parent.createEl("button", { cls: "accent" });', expect: [] },
        { name: 'pass/sanctioned-btn2', rel: 'platform/mechanisms/icons/icons.js', content: 'return "<svg>...</svg>";', expect: [] },
        { name: 'pass/opt-out', rel: 'platform/blueprints/x/helpers/e.js', content: 'row.createEl("button"); // lint-buttons:allow native modal', expect: [] },
    ];
    let passes = 0, fails = 0;
    for (const c of cases) {
        const got = [...new Set(lintContent(c.content, { rel: c.rel }).map(v => v.rule))].sort();
        const exp = [...c.expect].sort();
        if (JSON.stringify(got) === JSON.stringify(exp)) { console.log(`ok self-test ${c.name}: [${got}] as expected`); passes++; }
        else { console.error(`FAIL self-test ${c.name}: expected [${exp}], got [${got}]`); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    const files = collect();
    const violations = [];
    for (const f of files) {
        const rel = path.relative(REPO_ROOT, f);
        for (const v of lintContent(fs.readFileSync(f, 'utf8'), { rel })) {
            violations.push({ file: rel, ...v });
        }
    }
    const byRule = (r) => violations.filter(v => v.rule === r).length;
    if (violations.length === 0) {
        console.log(`ok lint-buttons: ${files.length} file(s) scanned; no hand-rolled buttons or emoji/svg glyphs.`);
        process.exit(0);
    }
    console.error(`FAIL lint-buttons: ${violations.length} violation(s) — BTN-1: ${byRule('BTN-1')}, BTN-2: ${byRule('BTN-2')}:\n`);
    for (const v of violations) { console.error(`  [${v.rule}] ${v.file}:${v.line}`); console.error(`    ${v.message}`); }
    process.exit(1);
}

main();
