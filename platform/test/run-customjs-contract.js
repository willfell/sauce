'use strict';

// customJS static-vs-instance contract test (v0.119.0 thrash-defenses #1).
//
// Workshop convention: classes loaded via the customJS plugin are stored as
// INSTANCES (`customJS.X = new X()`). Methods called via `customJS.X.method(...)`
// must therefore be on the prototype (non-static). Static-only utility classes
// (e.g., FinanceMath) are tolerated when ALL members are static — detected by
// shape, not by allowlist.
//
// Algorithm: scan platform/ for class definitions, scan platform/+ranch/+commands/+spice/+.claude/
// for `customJS.X.member` callsites, cross-validate.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');

const CLASS_DIRS = [
    'platform/customjs',
    'platform/blueprints',
];
const CALLSITE_DIRS = [
    'platform',
    'ranch',
    'commands',
    'spice',
    '.claude',
];
const SKIP_PATTERNS = [
    /node_modules\//,
    /\.git\//,
    // Nested git worktrees are full checkouts of THIS repo living inside it, so
    // walking the `.claude` callsite root descends into another commit's entire
    // tree — including its `Docs/`, which is deliberately not a callsite root
    // here. That reports historical plan prose as live contract violations and
    // makes preflight fail for whichever branch happens to be checked out in a
    // worktree. Skip them: only the tree under test is the tree under test.
    /(^|\/)\.claude\/worktrees\//,
    /(^|\/)\.worktrees\//,
    /\.sauce-backup\//,
    /\.sauce-prev\//,
    /platform\/test\/seed-vault\//,
    /platform\/test\/fixtures\/customjs-contract\//,  // self-test fixtures (handled separately)
    /platform\/migrate\//,
    /platform\/test\/(?!fixtures\/).+/,                 // skip platform/test/* (tests + harnesses)
    /platform\/install\.js$/,
    /Docs\/cycle-history\.md$/,                          // very large; can't contain real callsites
];

function shouldSkip(file, skipPatterns) {
    const rel = path.relative(REPO_ROOT, file);
    return (skipPatterns || SKIP_PATTERNS).some(re => re.test(rel));
}

function walkDir(dir, exts, skipPatterns) {
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
            if (shouldSkip(p, skipPatterns)) continue;
            out.push(p);
        }
    }
    return out;
}

function parseClassMembers(src) {
    // Find each `class X { ... }` block via brace-counting; extract member declarations.
    const classes = [];
    const classRe = /\bclass\s+(\w+)(?:\s+extends\s+\w+)?\s*\{/g;
    let cm;
    while ((cm = classRe.exec(src)) !== null) {
        const className = cm[1];
        let i = cm.index + cm[0].length;
        let depth = 1;
        const startBody = i;
        while (i < src.length && depth > 0) {
            const c = src[i];
            if (c === '{') depth++;
            else if (c === '}') depth--;
            i++;
        }
        const body = src.slice(startBody, i - 1);
        const members = [];

        // Pass 1: method declarations.
        //   [static] [async] name([args]) { ... }
        // Skip constructor.
        const methodRe = /(^|\n)\s*(static\s+)?(?:async\s+)?(\w+)\s*\(/g;
        let mm;
        while ((mm = methodRe.exec(body)) !== null) {
            const isStatic = !!mm[2];
            const name = mm[3];
            if (name === 'constructor') continue;
            if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(name)) continue;
            // Detect getter/setter prefix (skip — we only check direct member calls).
            const before = body.slice(0, mm.index + mm[0].length - name.length - 1);
            if (/(get|set)\s+$/.test(before)) continue;
            members.push({ name, isStatic, kind: 'method' });
        }

        // Pass 2: class fields.
        //   [static] name = expr;
        const fieldRe = /(^|\n)\s*(static\s+)?([A-Z_][A-Z0-9_]*|\w+)\s*=\s*[^=]/g;
        let fm;
        while ((fm = fieldRe.exec(body)) !== null) {
            const isStatic = !!fm[2];
            const name = fm[3];
            // Avoid false positives: assignments inside method bodies (we can't easily distinguish
            // top-level fields from nested assignments via regex). Heuristic: only count fields whose
            // name is ALL_CAPS OR appear at the start of a line at "low" indentation. Skip lowercase
            // fields entirely — false-positive risk too high; class fields are conventionally CONSTANTS.
            if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
            members.push({ name, isStatic, kind: 'field' });
        }

        classes.push({ name: className, members });
    }
    return classes;
}

function parseCallsites(src) {
    // `customJS.X.member` — both calls and property reads.
    const out = [];
    const re = /\bcustomJS\.(\w+)\.(\w+)(?:\b|\()/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        out.push({ className: m[1], member: m[2], index: m.index });
    }
    return out;
}

function indexToLine(src, idx) {
    let line = 1;
    for (let i = 0; i < idx; i++) if (src.charCodeAt(i) === 10) line++;
    return line;
}

function scan(opts) {
    opts = opts || {};
    const classRoots = opts.classRoots || CLASS_DIRS;
    const callsiteRoots = opts.callsiteRoots || CALLSITE_DIRS;
    const skipPatterns = opts.skipPatterns || SKIP_PATTERNS;

    const classDefs = new Map();   // name → { file, members }
    const classDupes = new Map();  // name → [file1, file2]
    const callsites = [];

    for (const dir of classRoots) {
        for (const f of walkDir(dir, ['.js'], skipPatterns)) {
            const src = fs.readFileSync(f, 'utf8');
            const found = parseClassMembers(src);
            for (const c of found) {
                if (classDefs.has(c.name)) {
                    const prev = classDefs.get(c.name);
                    if (!classDupes.has(c.name)) classDupes.set(c.name, [prev.file]);
                    classDupes.get(c.name).push(f);
                } else {
                    classDefs.set(c.name, { file: f, members: c.members });
                }
            }
        }
    }

    for (const dir of callsiteRoots) {
        for (const f of walkDir(dir, ['.js', '.md', '.json'], skipPatterns)) {
            const src = fs.readFileSync(f, 'utf8');
            const found = parseCallsites(src);
            for (const c of found) {
                callsites.push({ ...c, file: f, line: indexToLine(src, c.index) });
            }
        }
    }

    const failures = [];

    // Multi-definition collisions = FAIL.
    for (const [name, files] of classDupes) {
        failures.push({
            kind: 'multi-definition',
            className: name,
            message: `Class ${name} defined in multiple files: ${files.map(f => path.relative(REPO_ROOT, f)).join(', ')}`,
        });
    }

    for (const cs of callsites) {
        const def = classDefs.get(cs.className);
        if (!def) {
            // Allow unknown classes for now (might be platform-external or mech-loaded at runtime).
            // For Stage 2, we focus on the static-vs-instance shape — missing-class is INFO only.
            continue;
        }
        const member = def.members.find(m => m.name === cs.member);
        if (!member) {
            // Member doesn't exist — FAIL.
            failures.push({
                kind: 'unknown-member',
                className: cs.className,
                member: cs.member,
                callsite: `${path.relative(REPO_ROOT, cs.file)}:${cs.line}`,
                defFile: path.relative(REPO_ROOT, def.file),
                declaredMembers: def.members.map(m => `${m.isStatic ? 'static ' : ''}${m.name}`),
            });
            continue;
        }
        const hasInstance = def.members.some(m => !m.isStatic);
        if (hasInstance && member.isStatic) {
            failures.push({
                kind: 'static-on-instance-class',
                className: cs.className,
                member: cs.member,
                callsite: `${path.relative(REPO_ROOT, cs.file)}:${cs.line}`,
                defFile: path.relative(REPO_ROOT, def.file),
            });
        }
    }

    return { classDefs, callsites, failures };
}

function reportFailures(failures) {
    for (const f of failures) {
        console.error('---');
        if (f.kind === 'static-on-instance-class') {
            console.error(`FAIL: customJS.${f.className}.${f.member} called at ${f.callsite}`);
            console.error(`  Class ${f.className} (${f.defFile}) has instance methods → customJS stores it as an instance.`);
            console.error(`  Member \`${f.member}\` is declared static → not on the prototype → call throws at runtime.`);
            console.error(`  Fix: drop \`static\`, OR add instance delegator: ${f.member}(...a) { return ${f.className}.${f.member}(...a); }`);
        } else if (f.kind === 'unknown-member') {
            console.error(`FAIL: customJS.${f.className}.${f.member} called at ${f.callsite}`);
            console.error(`  Class ${f.className} (${f.defFile}) has no member named ${f.member}.`);
            console.error(`  Declared members: ${f.declaredMembers.join(', ')}`);
        } else if (f.kind === 'multi-definition') {
            console.error(f.message);
        }
    }
}

// --- Self-test mode (used by CCONTRACT-1..5) ---
if (process.argv.includes('--self-test')) {
    const fixturesDir = 'platform/test/fixtures/customjs-contract';

    // Each fixture is scanned in isolation: scan the fixture as the only class root
    // AND the only callsite root. Override skipPatterns so the fixtures themselves
    // aren't excluded by the default SKIP_PATTERNS list.
    function run(fixture) {
        return scan({
            classRoots: [`${fixturesDir}/${fixture}`],
            callsiteRoots: [`${fixturesDir}/${fixture}`],
            skipPatterns: [],
        });
    }

    const cases = [
        { fixture: 'pass-instance-class', expectFail: false, name: 'CCONTRACT-1 instance class + instance callsite' },
        { fixture: 'pass-static-class', expectFail: false, name: 'CCONTRACT-2 all-static class + static callsite' },
        { fixture: 'fail-static-on-instance-class', expectFail: true, name: 'CCONTRACT-3 static-on-instance-class FAIL' },
        { fixture: 'fail-unknown-member', expectFail: true, name: 'CCONTRACT-4 unknown member FAIL' },
        { fixture: 'fail-multi-definition', expectFail: true, name: 'CCONTRACT-5 multi-definition FAIL' },
    ];
    let passes = 0; let fails = 0;
    for (const c of cases) {
        const r = run(c.fixture);
        const ok = c.expectFail ? r.failures.length > 0 : r.failures.length === 0;
        if (ok) { console.log('ok ' + c.name); passes++; }
        else { console.error('FAIL ' + c.name + ': expectFail=' + c.expectFail + ' got failures=' + r.failures.length); fails++; }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

// --- Live mode (CCONTRACT-6: scan workshop tree) ---
const { failures } = scan();
if (failures.length === 0) {
    console.log('ok CCONTRACT-LIVE: no customJS contract violations in workshop tree');
    process.exit(0);
} else {
    console.error(`FAIL CCONTRACT-LIVE: ${failures.length} contract violation(s)`);
    reportFailures(failures);
    process.exit(1);
}
