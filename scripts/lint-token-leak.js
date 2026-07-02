'use strict';

// TPL-2 — no-token-leak gate (templates surface).
//
// A `{{TOKEN}}` in a blueprint TEMPLATE leaks a literal string into the created
// note UNLESS something resolves it:
//   • the installer substitutes its fixed variable set when it copies the
//     template into `ranch/templates/` (views_path, scripts_path, templates_path,
//     module_directory, vault_identity_tag);
//   • entity-create / a blueprint's own scaffolder resolves the token in JS at
//     note-creation time (e.g. trips' trip-nav-buttons.js does
//     `.replaceAll("{{DATE}}", isoTz)`), or `{{now.<fmt>}}`.
//
// This gate is RESOLVER-AWARE: it treats a token as safe iff it is an installer
// var, is `now`, OR appears as a `.replace(All)?("{{TOKEN}}"|/\{\{TOKEN\}\}/…)`
// target anywhere in platform JS. Any OTHER `{{TOKEN}}` in a template is a leak.
//
// The complementary content/*.md surface (installer-only) is covered by
// platform/test/run-content-token-leaks.js. Together they satisfy TPL-2.
//
// Scope: platform/blueprints/**/templates/*.md
// Opt-out: `<!-- lint-token-leak:allow <reason> -->` on the token line/above.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BLUEPRINTS_DIR = path.join(REPO_ROOT, 'platform', 'blueprints');
const MECHANISMS_DIR = path.join(REPO_ROOT, 'platform', 'mechanisms');

const INSTALLER_VARS = ['views_path', 'scripts_path', 'templates_path', 'module_directory', 'vault_identity_tag'];
const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const ALLOW_RE = /<!--\s*lint-token-leak:allow\b.*?-->/;
// token name = inner text up to the first separator (`now.YYYY` -> `now`).
const tokenName = (inner) => inner.split(/[.\s|/:]/)[0];

// Walk a dir tree collecting *.js files.
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

// Build the set of tokens any platform JS resolves via a string/regex replace.
// Catches `.replaceAll("{{DATE}}", …)`, `.replace("{{X}}", …)`,
// `.replace(/\{\{X\}\}/g, …)`.
function buildCodeResolvedTokens() {
    const resolved = new Set();
    const jsFiles = [...jsFilesUnder(BLUEPRINTS_DIR), ...jsFilesUnder(MECHANISMS_DIR)];
    const strRe = /\.replace(?:All)?\(\s*["'`]\{\{\s*([A-Za-z0-9_]+)/g;
    const reRe = /\.replace(?:All)?\(\s*\/\\?\{\\?\{\s*([A-Za-z0-9_]+)/g;
    for (const f of jsFiles) {
        const src = fs.readFileSync(f, 'utf8');
        let m;
        while ((m = strRe.exec(src)) !== null) resolved.add(m[1]);
        while ((m = reRe.exec(src)) !== null) resolved.add(m[1]);
    }
    return resolved;
}

// Returns [{line, message}] for tokens not in `safe`.
function lintContent(content, safe) {
    const violations = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;
        let m;
        TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(line)) !== null) {
            const name = tokenName(m[1]);
            if (!safe.has(name)) {
                violations.push({
                    line: i + 1,
                    message: `unresolved template token \`${m[0]}\` — nothing substitutes \`${name}\` (not an installer var, not \`now\`, not resolved by any scaffolder). It would leak literally into the created note.`,
                });
            }
        }
    }
    return violations;
}

function collectTemplates() {
    const out = [];
    let bps;
    try { bps = fs.readdirSync(BLUEPRINTS_DIR, { withFileTypes: true }); } catch (_e) { return out; }
    for (const e of bps) {
        if (!e.isDirectory()) continue;
        const tplDir = path.join(BLUEPRINTS_DIR, e.name, 'templates');
        let tpls;
        try { tpls = fs.readdirSync(tplDir); } catch (_e) { continue; }
        for (const name of tpls) {
            if (!name.endsWith('.md')) continue;
            const file = path.join(tplDir, name);
            out.push({ blueprint: e.name, file, content: fs.readFileSync(file, 'utf8') });
        }
    }
    return out;
}

function buildSafeSet() {
    const safe = new Set(INSTALLER_VARS);
    safe.add('now');
    for (const t of buildCodeResolvedTokens()) safe.add(t);
    return safe;
}

function runSelfTest() {
    // Explicit safe set so fixtures need no sibling helper.
    const safe = new Set([...INSTALLER_VARS, 'now', 'DATE', 'NAME']);
    const cases = [
        { name: 'pass/installer-var.md', content: 'created_at: "{{module_directory}}/x"\ntag: {{vault_identity_tag}}', expect: false },
        { name: 'pass/scaffolder-token.md', content: 'created: {{DATE}}\nname: {{NAME}}', expect: false },
        { name: 'pass/entity-now.md', content: 'created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"', expect: false },
        { name: 'pass/templater.md', content: 'created: <% tp.file.creation_date("YYYY-MM-DD") %>', expect: false },
        { name: 'fail/unresolved.md', content: 'created: {{BOGUS}}', expect: true },
    ];
    let passes = 0, fails = 0;
    for (const c of cases) {
        const flagged = lintContent(c.content, safe).length > 0;
        if (flagged === c.expect) { console.log(`ok self-test ${c.name}: ${c.expect ? 'flagged' : 'clean'} as expected`); passes++; }
        else { console.error(`FAIL self-test ${c.name}: expected ${c.expect ? 'violation' : 'clean'}, got ${flagged ? 'violation' : 'clean'}`); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    const safe = buildSafeSet();
    const templates = collectTemplates();
    const violations = [];
    for (const t of templates) {
        for (const v of lintContent(t.content, safe)) {
            violations.push({ file: path.relative(REPO_ROOT, t.file), line: v.line, message: v.message });
        }
    }
    if (violations.length === 0) {
        console.log(`ok lint-token-leak: ${templates.length} template(s) scanned; no unresolved-token leaks. (safe tokens: ${[...safe].sort().join(', ')})`);
        process.exit(0);
    }
    console.error(`FAIL lint-token-leak: ${violations.length} unresolved-token leak(s) in templates:\n`);
    for (const v of violations) { console.error(`  ${v.file}:${v.line}`); console.error(`    ${v.message}`); }
    process.exit(1);
}

main();
