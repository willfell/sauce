'use strict';

// v0.124.0 — note-chrome grammar gate.
//
// Enforces the canonical "note-chrome standard" across blueprint templates that
// have ADOPTED it. The adopted set is derived DYNAMICALLY, never hardcoded: a
// blueprint is adopted iff its `manifest.json` carries a top-level `breadcrumb`
// key. Today that is exactly { project, meetings, scratch, to-do }; later
// adoption waves widen the set by adding a `breadcrumb` block, and this gate
// starts enforcing the new blueprint automatically. Un-adopted blueprints
// (daily, journal, finance, trips, people, products, teams, cowork, …) still
// legitimately use `## H2` and MUST NOT be flagged. (Kanban boards are not a
// blueprint of their own — they live inside the `project` blueprint.)
//
// Rules over adopted templates (platform/blueprints/<bp>/templates/*.md where
// <bp>/manifest.json has a `breadcrumb` key):
//
//   1. No `## H2` / `### H3` content headings. `# H1` (note titles) is allowed.
//      Fence-aware: a heading line inside a ``` fenced code block is ignored.
//      Kanban-board templates (frontmatter `kanban-plugin:`) are exempt — their
//      `## Column` lines are obsidian-kanban column structure, NOT content
//      headings, and cannot become SectionLabel blocks.
//      Per-line opt-out: a `<!-- lint-note-chrome:allow -->` HTML comment on the
//      heading line OR the line directly above it suppresses that one violation.
//
//   2. Breadcrumb-first chrome. (a) Ordering: whenever a template renders BOTH a
//      `Breadcrumb` view and a `SpaceNavButtons` view, the Breadcrumb call must
//      appear before the first SpaceNavButtons call. (b) Presence: a template
//      whose frontmatter `type` is a declared breadcrumb type (a key under the
//      manifest's `breadcrumb.types`) and which renders SpaceNavButtons must
//      also render a Breadcrumb. Hub/index and kanban-card templates (whose
//      `type` is not a declared breadcrumb type, or absent) render nav without a
//      parent trail and are exempt from the presence half — they are landing
//      pages with no ancestors. Kanban-board templates are exempt from presence.
//
//   3. Manifest declaration. Every blueprint whose templates render a Breadcrumb
//      view must declare a `breadcrumb` block in its `manifest.json`. Because the
//      adopted set IS "manifest has a breadcrumb block", this mainly catches a
//      template rendering Breadcrumb under a manifest that lacks the block.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const BLUEPRINTS_DIR = path.join(REPO_ROOT, 'platform', 'blueprints');

// Rule 1 targets only `## H2` / `### H3`; `#### H4`+ are intentionally out of
// scope (and `# H1` note titles are allowed).
const HEADING_RE = /^#{2,3}\s/;                 // ## or ### at line start
const ALLOW_RE = /<!--\s*lint-note-chrome:allow\b.*?-->/;
const BREADCRUMB_CALL = 'class: "Breadcrumb"';
const NAV_CALL = 'class: "SpaceNavButtons"';

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

// Returns the body lines of the leading `---`-fenced YAML block (exclusive of
// the two `---` fences), or null if no frontmatter is found. Robust to a
// leading Templater header block: several adopted templates (e.g. the meetings
// `Meeting.md`) open with a `<%* … -%>` / `<% … %>` region BEFORE their
// frontmatter, so the opening `---` is not at byte 0. We skip one leading
// Templater region plus any leading blank lines, then accept the first `---`
// as the frontmatter open and read until the closing `---`.
function frontmatterLines(content) {
    const lines = content.split('\n');
    let i = 0;

    // Skip a single leading Templater header region: a line opening with `<%*`
    // or `<%` through the first line whose trimmed end is `-%>` or `%>`.
    if (i < lines.length && /^\s*<%/.test(lines[i])) {
        // If the opener also closes on the same line, consume just that line.
        if (/(-%>|%>)\s*$/.test(lines[i])) {
            i++;
        } else {
            i++;
            while (i < lines.length && !/(-%>|%>)\s*$/.test(lines[i])) i++;
            if (i < lines.length) i++;   // consume the closing `-%>`/`%>` line
        }
    }

    // Skip any leading blank lines between the Templater header and the `---`.
    while (i < lines.length && lines[i].trim() === '') i++;

    // The next non-blank line must open the frontmatter.
    if (i >= lines.length || lines[i].trim() !== '---') return null;
    const open = i;
    for (let j = open + 1; j < lines.length; j++) {
        if (lines[j].trim() === '---') return lines.slice(open + 1, j);
    }
    return null;   // unterminated → treat as no frontmatter
}

// Returns the raw `type:` frontmatter value (string) or null. Reads the leading
// `---`-fenced YAML block (see frontmatterLines for Templater-header handling).
// Tolerant of templater expressions / quotes.
function frontmatterType(content) {
    const fm = frontmatterLines(content);
    if (!fm) return null;
    for (const line of fm) {
        const m = /^type:\s*(.+?)\s*$/.exec(line);
        if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
    return null;
}

// Kanban-board templates declare `kanban-plugin:` in frontmatter. Their `## …`
// lines are obsidian-kanban column definitions, not content headings.
function isKanbanBoard(content) {
    const fm = frontmatterLines(content);
    if (!fm) return false;
    return fm.some(line => /^kanban-plugin:\s*/.test(line));
}

// ---------------------------------------------------------------------------
// Rule implementations — each returns an array of { line, message } violations.
// `opts`: { breadcrumbTypes: string[], manifestHasBreadcrumb: boolean }
// ---------------------------------------------------------------------------

// Rule 1: no ## H2 / ### H3 (fence-aware, kanban-exempt, opt-out aware).
function checkNoHeadings(content) {
    const violations = [];
    if (isKanbanBoard(content)) return violations;   // kanban columns are structural

    const lines = content.split('\n');
    let fenceDepth = 0;   // 0 = outside a fenced code block
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Track ``` / ~~~ fences. A fence toggles in/out of a code block.
        if (/^\s*(```|~~~)/.test(line)) {
            fenceDepth = fenceDepth === 0 ? 1 : 0;
            continue;
        }
        if (fenceDepth !== 0) continue;              // inside a code fence
        if (!HEADING_RE.test(line)) continue;

        // Per-line opt-out: on this line or the line directly above.
        const prev = i > 0 ? lines[i - 1] : '';
        if (ALLOW_RE.test(line) || ALLOW_RE.test(prev)) continue;

        violations.push({
            line: i + 1,
            message: `\`## H2\`/\`### H3\` content heading not allowed in an adopted note-chrome template — use a SectionLabel dataviewjs block instead: ${line.trim()}`,
        });
    }
    return violations;
}

// Rule 2: breadcrumb-first chrome (ordering + scoped presence).
function checkBreadcrumbFirst(content, opts) {
    const violations = [];
    if (isKanbanBoard(content)) return violations;   // boards are not chromed leaves

    const navIdx = content.indexOf(NAV_CALL);
    const bcIdx = content.indexOf(BREADCRUMB_CALL);
    if (navIdx === -1) return violations;            // no chrome → rule N/A

    const lineOf = (idx) => content.slice(0, idx).split('\n').length;

    if (bcIdx !== -1) {
        // (a) Ordering: when both present, Breadcrumb must precede the first nav.
        if (bcIdx > navIdx) {
            violations.push({
                line: lineOf(navIdx),
                message: 'Breadcrumb view must appear BEFORE the first SpaceNavButtons view (breadcrumb-first chrome).',
            });
        }
        return violations;
    }

    // (b) Presence: only required for leaf templates whose `type` is a declared
    // breadcrumb type. Hubs / kanban cards (type absent or not declared) render
    // nav without a parent trail and are exempt.
    const type = frontmatterType(content);
    if (type && opts.breadcrumbTypes.includes(type)) {
        violations.push({
            line: lineOf(navIdx),
            message: `template renders SpaceNavButtons and is a breadcrumb type (\`${type}\`) but has no Breadcrumb view — adopted leaf templates must render Breadcrumb first.`,
        });
    }
    return violations;
}

// Rule 3: a template rendering Breadcrumb requires its manifest to declare a
// `breadcrumb` block.
function checkManifestDeclaration(content, opts) {
    const violations = [];
    if (content.indexOf(BREADCRUMB_CALL) === -1) return violations;
    if (!opts.manifestHasBreadcrumb) {
        const idx = content.indexOf(BREADCRUMB_CALL);
        const line = content.slice(0, idx).split('\n').length;
        violations.push({
            line,
            message: 'template renders a Breadcrumb view but its blueprint manifest declares no `breadcrumb` block.',
        });
    }
    return violations;
}

function lintContent(content, opts) {
    return [
        ...checkNoHeadings(content),
        ...checkBreadcrumbFirst(content, opts),
        ...checkManifestDeclaration(content, opts),
    ];
}

// ---------------------------------------------------------------------------
// Adopted-set discovery (real tree)
// ---------------------------------------------------------------------------

function readManifest(bpDir) {
    const p = path.join(bpDir, 'manifest.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_e) { return null; }
}

// Returns [{ blueprint, file, content, opts }] for every template under an
// ADOPTED blueprint (manifest has a `breadcrumb` key).
function collectAdoptedTemplates() {
    const out = [];
    let bps;
    try { bps = fs.readdirSync(BLUEPRINTS_DIR, { withFileTypes: true }); }
    catch (_e) { return out; }

    for (const e of bps) {
        if (!e.isDirectory()) continue;
        const bpDir = path.join(BLUEPRINTS_DIR, e.name);
        const manifest = readManifest(bpDir);
        if (!manifest || !manifest.breadcrumb) continue;   // not adopted → skip

        const breadcrumbTypes = Object.keys(
            (manifest.breadcrumb && manifest.breadcrumb.types) || {}
        );
        const opts = { breadcrumbTypes, manifestHasBreadcrumb: true };

        const tplDir = path.join(bpDir, 'templates');
        let tpls;
        try { tpls = fs.readdirSync(tplDir); }
        catch (_e) { continue; }
        for (const name of tpls) {
            if (!name.endsWith('.md')) continue;
            const file = path.join(tplDir, name);
            out.push({
                blueprint: e.name,
                file,
                content: fs.readFileSync(file, 'utf8'),
                opts,
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
    const fixturesDir = path.join(REPO_ROOT, 'platform', 'test', 'fixtures', 'lint-note-chrome');
    // Fixtures have no sibling manifest, so feed the rule context explicitly.
    // Both fixtures declare `type: meeting`; treat `meeting` as a declared
    // breadcrumb type so the presence half of rule 2 is exercised.
    const opts = { breadcrumbTypes: ['meeting'], manifestHasBreadcrumb: true };

    const cases = [
        { dir: 'pass', expectViolations: false },
        { dir: 'fail', expectViolations: true },
    ];

    let passes = 0;
    let fails = 0;
    for (const c of cases) {
        const dirAbs = path.join(fixturesDir, c.dir);
        let files;
        try { files = fs.readdirSync(dirAbs).filter(f => f.endsWith('.md')); }
        catch (_e) { files = []; }
        for (const name of files) {
            const content = fs.readFileSync(path.join(dirAbs, name), 'utf8');
            const violations = lintContent(content, opts);
            const flagged = violations.length > 0;
            const rel = path.join('platform/test/fixtures/lint-note-chrome', c.dir, name);
            if (flagged === c.expectViolations) {
                console.log(`ok self-test ${rel}: ${c.expectViolations ? `flagged (${violations.length})` : 'clean'} as expected`);
                for (const v of violations) console.log(`    ${rel}:${v.line} — ${v.message}`);
                passes++;
            } else {
                console.error(`FAIL self-test ${rel}: expected ${c.expectViolations ? 'violations' : 'clean'}, got ${violations.length} violation(s)`);
                for (const v of violations) console.error(`    ${rel}:${v.line} — ${v.message}`);
                fails++;
            }
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const args = process.argv.slice(2);

    if (args.includes('--self-test')) {
        runSelfTest();
        return;
    }

    const templates = collectAdoptedTemplates();
    const allViolations = [];
    for (const t of templates) {
        for (const v of lintContent(t.content, t.opts)) {
            allViolations.push({
                file: path.relative(REPO_ROOT, t.file),
                line: v.line,
                message: v.message,
            });
        }
    }

    if (allViolations.length === 0) {
        console.log(`ok lint-note-chrome: ${templates.length} adopted template(s) scanned; no violations.`);
        process.exit(0);
    }

    console.error(`FAIL lint-note-chrome: ${allViolations.length} violation(s) across adopted blueprint templates:\n`);
    for (const v of allViolations) {
        console.error(`  ${v.file}:${v.line}`);
        console.error(`    ${v.message}`);
    }
    console.error('');
    console.error('The note-chrome standard (Breadcrumb-first chrome, SectionLabel instead of');
    console.error('## H2, manifest breadcrumb declaration) applies to every blueprint whose');
    console.error('manifest declares a `breadcrumb` block. Opt out a single heading with');
    console.error('`<!-- lint-note-chrome:allow <reason> -->` on the heading line or the line above.');
    process.exit(1);
}

main();
