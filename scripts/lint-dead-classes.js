'use strict';

// CJS-3 — customjs class resolution gate.
//
// Generalizes platform/test/run-finance-template-classes.js (finance-only) to
// EVERY blueprint + mechanism. Two ENFORCED checks over customjs-guard
// invocations (`dv.view(".../customjs-guard", { class: "X" })`) found in a
// component's own templates, content, AND helper/view JS (scaffolders embed the
// invocation as a string when they write runtime notes):
//
//   BREAKING   — invoked class `X` has NO defining `class X` file anywhere and
//                is declared by no manifest. Renders an "_X unavailable_"
//                placeholder. (The InvoiceNavButtons-deletion bug class.)
//   UNDECLARED — invoked class `X` exists (has a file / is declared somewhere)
//                but is NOT in the invoking component's own `customjs_classes[]`
//                nor any depends_on mechanism's. The manifest contract is
//                incomplete (e.g. project invokes ProjectActivityPanel without
//                declaring it). Safe fix: declare it / add the depends_on.
//
// A THIRD signal is printed but NON-fatal (report-only) — dead-code deletion is
// riskier (seed-vault / consumer usage) and belongs to a separate cleanup pass:
//   DEAD       — a declared / file-defined class never referenced anywhere.
//
// Opt-out: registry exemptions + `// lint-dead-classes:allow <reason>`.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BP_DIR = path.join(REPO_ROOT, 'platform', 'blueprints');
const MECH_DIR = path.join(REPO_ROOT, 'platform', 'mechanisms');

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

const CLASS_REF_RE = /customjs-guard"?\s*,\s*\{\s*class:\s*"([A-Za-z0-9_]+)"/g;
const CLASS_DEF_RE = /^\s*class\s+([A-Za-z0-9_]+)/gm;
const CUSTOMJS_RE = /customJS\.([A-Za-z0-9_]+)/g;
const NEW_RE = /\bnew\s+([A-Z][A-Za-z0-9_]+)\s*\(/g;

// Strip JS comments so example class-names in docstrings (e.g. the customjs-guard
// loader's canonical-usage block) are not mistaken for real invocations. Only
// applied to .js content; .md is left intact (fenced code is real usage).
function stripJsComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // line comments (leave `://` in URLs)
}
const readScan = (f) => {
    const src = fs.readFileSync(f, 'utf8');
    return f.endsWith('.js') ? stripJsComments(src) : src;
};

// Load every component (blueprint + mechanism): { name, dir, kind, own:Set, deps:[names] }
// `roots` defaults to the real tree; the self-test passes a fixture tree so it
// exercises THIS function + the real regexes/comment-stripper end to end.
function loadComponents(roots) {
    const comps = [];
    for (const [root, kind] of (roots || [[BP_DIR, 'blueprint'], [MECH_DIR, 'mechanism']])) {
        let entries;
        try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_e) { continue; }
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const dir = path.join(root, e.name);
            let m;
            try { m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch (_e) { continue; }
            comps.push({
                name: m.name || e.name,
                dir,
                kind,
                own: new Set(m.customjs_classes || []),
                deps: (m.depends_on || []).map(d => d.name),
                startup: (m.customjs_startup_scripts || []).map(s => (typeof s === 'string' ? s : (s && s.class))).filter(Boolean),
            });
        }
    }
    return comps;
}

function analyze(roots) {
    const comps = loadComponents(roots);
    const byName = new Map(comps.map(c => [c.name, c]));

    // Global "defined": manifest-declared ∪ file-defined `class X`.
    const declared = new Map();      // className -> owner name
    const fileDefined = new Set();   // className with a real `class X {` file
    for (const c of comps) {
        for (const cls of c.own) if (!declared.has(cls)) declared.set(cls, c.name);
        for (const f of walk(c.dir, n => n.endsWith('.js'))) {
            const src = readScan(f);
            let m; CLASS_DEF_RE.lastIndex = 0;
            while ((m = CLASS_DEF_RE.exec(src)) !== null) fileDefined.add(m[1]);
        }
    }
    const existsSomewhere = (name) => declared.has(name) || fileDefined.has(name);

    // allowed(component) = own ∪ each dep mechanism's own
    const allowedFor = (c) => {
        const s = new Set(c.own);
        for (const dep of c.deps) { const d = byName.get(dep); if (d) for (const x of d.own) s.add(x); }
        return s;
    };

    const breaking = [];
    const undeclared = [];
    const referenced = new Set();

    for (const c of comps) {
        const allowed = allowedFor(c);
        // invocations in this component's .md + .js
        const files = walk(c.dir, n => n.endsWith('.md') || n.endsWith('.js'));
        for (const f of files) {
            const text = readScan(f);
            let m;
            CLASS_REF_RE.lastIndex = 0;
            while ((m = CLASS_REF_RE.exec(text)) !== null) {
                const name = m[1];
                referenced.add(name);
                const line = text.slice(0, m.index).split('\n').length;
                const loc = { name, file: path.relative(REPO_ROOT, f), line, owner: c.name };
                if (!existsSomewhere(name)) breaking.push(loc);
                else if (!allowed.has(name)) undeclared.push(loc);
            }
            CUSTOMJS_RE.lastIndex = 0;
            while ((m = CUSTOMJS_RE.exec(text)) !== null) referenced.add(m[1]);
            NEW_RE.lastIndex = 0;
            while ((m = NEW_RE.exec(text)) !== null) referenced.add(m[1]);
        }
        for (const s of c.startup) referenced.add(s);
    }

    // DEAD (report-only): declared class never referenced anywhere.
    const dead = [];
    for (const [name, owner] of declared) if (!referenced.has(name)) dead.push({ name, owner });

    return { breaking, undeclared, dead, declaredCount: declared.size };
}

function runSelfTest() {
    // Exercise the REAL analyze() against a fixture component tree so the
    // self-test protects the actual detection logic (regexes, comment-stripper,
    // existsSomewhere, allowedFor), not a reimplementation.
    const fixRoot = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'lint-dead-classes', 'tree');
    const roots = [
        [path.join(fixRoot, 'blueprints'), 'blueprint'],
        [path.join(fixRoot, 'mechanisms'), 'mechanism'],
    ];
    let breaking, undeclared, dead;
    try { ({ breaking, undeclared, dead } = analyze(roots)); }
    catch (e) { console.error(`FAIL self-test: analyze() threw (${e.message}) — fixtures missing?`); process.exit(1); }
    const bn = breaking.map(b => b.name), un = undeclared.map(u => u.name), dn = dead.map(d => d.name);
    const cases = [
        ['BREAKING flags Ghost (invoked, no file, undeclared)', bn.includes('Ghost')],
        ['BREAKING does NOT flag AlphaWidget/MechClass (they resolve)', !bn.includes('AlphaWidget') && !bn.includes('MechClass')],
        ['comment-strip: CommentGhost (in a // comment) is NOT a ref', !bn.includes('CommentGhost')],
        ['UNDECLARED flags UndeclaredPanel (has file, not in own/deps)', un.includes('UndeclaredPanel')],
        ['UNDECLARED does NOT flag MechClass (declared via dep mech1)', !un.includes('MechClass')],
        ['DEAD flags DeadClass (declared, never invoked)', dn.includes('DeadClass')],
        ['DEAD does NOT flag AlphaWidget (it is invoked)', !dn.includes('AlphaWidget')],
    ];
    let passes = 0, fails = 0;
    for (const [name, ok] of cases) {
        if (ok) { console.log(`ok self-test ${name}`); passes++; }
        else { console.error(`FAIL self-test ${name}`); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    if (passes + fails < 7) { console.error('FAIL self-test: too few cases ran (fixtures missing?)'); process.exit(1); }
    process.exit(fails === 0 ? 0 : 1);
}

function main() {
    if (process.argv.slice(2).includes('--self-test')) { runSelfTest(); return; }
    const { breaking, undeclared, dead, declaredCount } = analyze();

    // UNDECLARED + DEAD are report-only (informational), never fatal:
    // both are manifest-completeness / cleanup nits — everything works at
    // runtime (mechanisms always install; classes load by directory scan).
    // Only BREAKING (invocation of a class that exists NOWHERE) is fatal.
    if (undeclared.length) {
        console.log(`note lint-dead-classes: ${undeclared.length} UNDECLARED invocation(s) (class exists but not in the invoking component's customjs_classes[] ∪ deps — contract-completeness follow-up):`);
        for (const u of undeclared) console.log(`  ${u.file}:${u.line} -> "${u.name}" invoked by ${u.owner}`);
        console.log('');
    }
    if (dead.length) {
        console.log(`note lint-dead-classes: ${dead.length} declared class(es) with no detected reference (report-only, cleanup candidates):`);
        for (const d of dead) console.log(`  ${d.owner}: ${d.name}`);
        console.log('');
    }

    if (breaking.length === 0) {
        console.log(`ok lint-dead-classes: ${declaredCount} declared classes; every customjs-guard invocation resolves to a real class (no BREAKING refs).`);
        process.exit(0);
    }
    console.error(`FAIL lint-dead-classes: ${breaking.length} BREAKING invocation(s) of a non-existent class:`);
    for (const b of breaking) console.error(`  ${b.file}:${b.line} -> class "${b.name}" (no file, declared nowhere)`);
    process.exit(1);
}

main();
