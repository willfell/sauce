#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * run-entity-create.js — v0.46.0 S11 entity-create mechanism harness.
 *
 * Unit-tests EntityCreate's pure-function helpers (_substitute, _evalDerive,
 * _runValidate, _renderFrontmatter, _emitScalar, _joinDestination, _slugify,
 * _routedFromDate, _loadSpec) by loading the class body via `new Function()`
 * with stubbed `app`, `customJS`, `Notice`, `window` — same loader pattern as
 * run-renderer.js. No Obsidian runtime required.
 *
 * Also exercises (a) the installer's manifest-field validator
 * (resolveEntityCreateEntry) via a tiny scaffolded vault + invoking it through
 * the install.js export surface, and (b) the audit walker walkEntityCreate via
 * three seeded fixtures (HIGH / INFO / MEDIUM severity buckets).
 *
 * Target: ~30 sub-asserts. Mirrors the bar-ii pattern of run-seed.js +
 * run-cowork-smoke.js. Each load-bearing assertion gets its own `ok` line.
 */

"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..", "..");
const MECH_DIR = path.join(ROOT, "platform/mechanisms/entity-create");
const ENTITY_SRC_PATH = path.join(MECH_DIR, "entity-create.js");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

// -------------------------------------------------------------------------
// Minimal moment stub — supports the EXACT subset EntityCreate uses:
//   moment(s, "YYYY-MM-DD", true).isValid()
//   moment(d).format(<fmt>)
//   moment().format(<fmt>)  (fixed to ANCHOR for determinism)
// Supports formats YYYY, YYYY-MM, YYYY-MM-DD, MM-MMMM, HH-mm, plus the
// composite YYYY/MM-MMMM/YYYY-MM-DD via piece-replace.
// -------------------------------------------------------------------------

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];

function pad2(n) { return String(n).padStart(2, "0"); }

function momentLike(date) {
    return {
        _d: date,
        isValid() { return date instanceof Date && !isNaN(date.getTime()); },
        format(fmt) {
            const d = date;
            // Replace longest tokens first to avoid partial overwrites.
            return String(fmt)
                .replace(/YYYY/g, d.getFullYear())
                .replace(/MMMM/g, MONTHS[d.getMonth()])
                .replace(/MM/g, pad2(d.getMonth() + 1))
                .replace(/DD/g, pad2(d.getDate()))
                .replace(/HH/g, pad2(d.getHours()))
                .replace(/mm/g, pad2(d.getMinutes()));
        },
        toISODate() { return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`; },
    };
}

function moment(input, fmt, strict) {
    if (input === undefined) {
        return momentLike(new Date("2026-05-14T10:30:00"));
    }
    if (input instanceof Date) {
        return momentLike(input);
    }
    if (typeof input === "string") {
        const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
            const y = +m[1], mo = +m[2], d = +m[3];
            const probe = new Date(y, mo - 1, d);
            const valid = probe.getFullYear() === y && (probe.getMonth() + 1) === mo && probe.getDate() === d;
            if (strict && !valid) return { isValid: () => false, format: () => input };
            return momentLike(probe);
        }
        // Strict-mode failure for non-matching strings.
        if (strict) return { isValid: () => false, format: () => input };
        const d = new Date(input);
        return momentLike(isNaN(d.getTime()) ? new Date(NaN) : d);
    }
    return momentLike(new Date(NaN));
}

// -------------------------------------------------------------------------
// Load EntityCreate class with stubbed globals (mirrors loadRendererClass).
// -------------------------------------------------------------------------

const ENTITY_SRC = fs.readFileSync(ENTITY_SRC_PATH, "utf8");

function loadEntityCreate(opts = {}) {
    const accentBtnCalls = [];
    const customJS = {
        AccentButton: {
            render(parent, o) {
                accentBtnCalls.push(o);
                return { tagName: "BUTTON" };
            },
        },
    };
    const FakeNotice = function (msg) { (FakeNotice.captured ||= []).push(String(msg)); };
    FakeNotice.captured = [];
    const vaultFiles = opts.vaultFiles || {};
    const opens = [];
    const created = [];
    const app = {
        vault: {
            getAbstractFileByPath(p) { return vaultFiles[p] ? { path: p } : null; },
            adapter: {
                async read(p) {
                    if (!vaultFiles[p]) throw new Error(`no such file: ${p}`);
                    return vaultFiles[p];
                },
            },
            async createFolder(p) { vaultFiles[p] = { __folder: true }; },
            async create(p, content) { vaultFiles[p] = content; created.push({ path: p, content }); },
        },
        workspace: {
            openLinkText(p) { opens.push(p); },
        },
    };
    const win = { moment };
    const fn = new Function("app", "customJS", "Notice", "window", "moment", `${ENTITY_SRC}\nreturn EntityCreate;`);
    const Cls = fn(app, customJS, FakeNotice, win, moment);
    return { Cls, app, customJS, Notice: FakeNotice, accentBtnCalls, opens, created, vaultFiles, window: win };
}

// -------------------------------------------------------------------------
// 1. mechanism dir + files present
// -------------------------------------------------------------------------

const mechFiles = [
    ["manifest.json", path.join(MECH_DIR, "manifest.json")],
    ["entity-create.js", path.join(MECH_DIR, "entity-create.js")],
    ["schema/new-entity-buttons.json", path.join(MECH_DIR, "schema", "new-entity-buttons.json")],
    ["README.md", path.join(MECH_DIR, "README.md")],
];
let allPresent = true;
for (const [label, p] of mechFiles) {
    if (!fs.existsSync(p)) { allPresent = false; break; }
}
ok("EC-1 entity-create mechanism dir + 4 files present", fs.existsSync(MECH_DIR) && allPresent);

// 2. manifest parses, version is "0.3.2" (PATCH v0.50.4 embedded-subfolder guard)
const manifest = JSON.parse(fs.readFileSync(path.join(MECH_DIR, "manifest.json"), "utf8"));
ok("EC-2 entity-create manifest parses + version === 0.3.2",
    manifest && manifest.name === "entity-create" && manifest.version === "0.3.2",
    `got name=${manifest && manifest.name} version=${manifest && manifest.version}`);

// 3. json-schema parses + has 7 extension shapes
const schemaRaw = fs.readFileSync(path.join(MECH_DIR, "schema/new-entity-buttons.json"), "utf8");
const schema = JSON.parse(schemaRaw);
const props = schema.items.properties;
const hasExtraFiles  = !!props.extra_files;
const hasInlineBody  = !!props.inline_body;
const hasMonthType   = props.prompts && JSON.stringify(props.prompts).includes('"month"');
const hasNumberType  = props.prompts && JSON.stringify(props.prompts).includes('"number"');
const hasValidate    = JSON.stringify(props.prompts).includes('"validate"');
const hasDerive      = JSON.stringify(props.prompts).includes('"derive"');
const hasCurrentFileTokenInREADME = fs.readFileSync(path.join(MECH_DIR, "README.md"), "utf8").includes("current_file.frontmatter");
const shapeCount = [hasExtraFiles, hasInlineBody, hasMonthType, hasNumberType, hasValidate, hasDerive, hasCurrentFileTokenInREADME].filter(Boolean).length;
ok("EC-3 json-schema declares 7 extension shapes",
    shapeCount === 7,
    `got ${shapeCount}/7 (extra_files=${hasExtraFiles} inline_body=${hasInlineBody} month=${!!hasMonthType} number=${!!hasNumberType} validate=${!!hasValidate} derive=${!!hasDerive} current_file_in_README=${hasCurrentFileTokenInREADME})`);

// 4. entity-create.js wraps in `new Function()` cleanly
let ec;
try { ec = loadEntityCreate(); ok("EC-4 entity-create.js wraps in new Function() cleanly", typeof ec.Cls === "function"); }
catch (e) { ok("EC-4 entity-create.js wraps in new Function() cleanly", false, e.message); }

const inst = new ec.Cls();

// -------------------------------------------------------------------------
// Substitution catalogue
// -------------------------------------------------------------------------

const baseCtx = (extra = {}) => Object.assign({
    now: moment("2026-05-14"),
    prompts: {},
    current_file: null,
    spec: {},
}, extra);

// 5. _substitute({{now.YYYY-MM-DD}})
ok("EC-5 _substitute({{now.YYYY-MM-DD}}) === 2026-05-14",
    inst._substitute("{{now.YYYY-MM-DD}}", baseCtx()) === "2026-05-14");

// 6. _substitute({{now.HH-mm}}) returns 2-digit HH-mm pair
{
    // Use a moment instance with known HH-mm (10-30 per ANCHOR).
    const ctx = baseCtx({ now: momentLike(new Date(2026, 4, 14, 10, 30)) });
    const v = inst._substitute("{{now.HH-mm}}", ctx);
    ok("EC-6 _substitute({{now.HH-mm}}) returns HH-mm with 2-digit pad",
        /^\d{2}-\d{2}$/.test(v) && v === "10-30",
        `got ${JSON.stringify(v)}`);
}

// 7. _substitute({{prompts.title}})
ok("EC-7 _substitute({{prompts.title}}) === X",
    inst._substitute("{{prompts.title}}", baseCtx({ prompts: { title: "X" } })) === "X");

// 8. _substitute with |number pipe via _renderFrontmatter (end-to-end)
{
    const ctx = baseCtx({ prompts: { amount: "42.5" } });
    const fmStr = inst._renderFrontmatter({ paycheck_amount: "{{prompts.amount|number}}" }, ctx);
    ok("EC-8 _renderFrontmatter emits |number pipe as unquoted YAML scalar",
        /^paycheck_amount: 42\.5(\s|$)/m.test(fmStr),
        `got ${JSON.stringify(fmStr)}`);
}

// 9. _substitute |sanitize-filename strips forbidden chars
ok("EC-9 _substitute|sanitize-filename strips /\\\\:*?\"<>|",
    inst._substitute("{{prompts.x|sanitize-filename}}", baseCtx({ prompts: { x: 'a/b\\c:d*e?f"g<h>i|j' } })) === "abcdefghij");

// 10. _substitute({{current_file.frontmatter.day}})
{
    // dv.current()-style page object: top-level key access AND file.frontmatter fallback.
    const cf = { day: "2026-05-14" };
    const out = inst._substitute("{{current_file.frontmatter.day}}", baseCtx({ current_file: cf }));
    ok("EC-10 _substitute({{current_file.frontmatter.day}}) reads top-level key",
        out === "2026-05-14", `got ${JSON.stringify(out)}`);
}

// 11. {{current_file.frontmatter.<key>}}-routed expands to YYYY/MM-MMMM/YYYY-MM-DD
{
    const cf = { day: "2026-05-14" };
    const out = inst._substitute("{{current_file.frontmatter.day}}-routed", baseCtx({ current_file: cf }));
    ok("EC-11 {{current_file.frontmatter.day}}-routed expands to 3-level form",
        out === "2026/05-May/2026-05-14", `got ${JSON.stringify(out)}`);
}

// -------------------------------------------------------------------------
// Derive DSL
// -------------------------------------------------------------------------

// 12. _evalDerive(slugify(prompts.name))
ok("EC-12 _evalDerive slugify(prompts.name) === 'testing-it-out'",
    inst._evalDerive("slugify(prompts.name)", baseCtx({ prompts: { name: "Testing It Out" } })) === "testing-it-out");

// 13. _evalDerive(lowercase(prompts.tag))
ok("EC-13 _evalDerive lowercase(prompts.tag) === 'fooo'",
    inst._evalDerive("lowercase(prompts.tag)", baseCtx({ prompts: { tag: "FOOO" } })) === "fooo");

// -------------------------------------------------------------------------
// Validate predicates
// -------------------------------------------------------------------------

// 14. gte:start_date pass
{
    const p = { key: "end_date", label: "End date", validate: "gte:start_date" };
    const err = inst._runValidate(p, "2026-05-14", baseCtx({ prompts: { start_date: "2026-05-01" } }));
    ok("EC-14 validate gte:start_date pass (end >= start) returns null", err === null, `got ${JSON.stringify(err)}`);
}

// 15. gte:start_date fail
{
    const p = { key: "end_date", label: "End date", validate: "gte:start_date" };
    const err = inst._runValidate(p, "2026-04-01", baseCtx({ prompts: { start_date: "2026-05-01" } }));
    ok("EC-15 validate gte:start_date fail (end < start) returns error",
        typeof err === "string" && err.includes("start_date"), `got ${JSON.stringify(err)}`);
}

// 16. min:0 rejects "-1"
{
    const p = { key: "amount", label: "Amount", validate: "min:0" };
    const err = inst._runValidate(p, "-1", baseCtx());
    ok("EC-16 validate min:0 rejects '-1'", typeof err === "string" && /≥ 0/.test(err), `got ${JSON.stringify(err)}`);
}

// 17. safe-filename rejects "Foo/Bar"
{
    const p = { key: "name", label: "Name", validate: "safe-filename" };
    const err = inst._runValidate(p, "Foo/Bar", baseCtx());
    ok("EC-17 validate safe-filename rejects 'Foo/Bar'", typeof err === "string" && /must not contain/.test(err), `got ${JSON.stringify(err)}`);
}

// -------------------------------------------------------------------------
// Prompt-default substitution + validate-min/max code path
// -------------------------------------------------------------------------

// 18. month prompt default "{{now.YYYY-MM}}" substitutes correctly
{
    const ctx = baseCtx({ now: moment("2026-05-14") });
    const subbed = inst._substitute("{{now.YYYY-MM}}", ctx);
    ok("EC-18 _substitute({{now.YYYY-MM}}) === 2026-05 (month default substitution)",
        subbed === "2026-05", `got ${JSON.stringify(subbed)}`);
}

// 19. number prompt enforces min/max via _runValidate (composite min,max)
{
    const p = { key: "n", label: "N", validate: "min:0,max:100" };
    const lo = inst._runValidate(p, "-1", baseCtx());
    const hi = inst._runValidate(p, "101", baseCtx());
    const okMid = inst._runValidate(p, "50", baseCtx());
    ok("EC-19 number prompt validate composite min:0,max:100 enforces both bounds",
        typeof lo === "string" && typeof hi === "string" && okMid === null,
        `lo=${lo} hi=${hi} mid=${okMid}`);
}

// -------------------------------------------------------------------------
// _renderFrontmatter type preservation
// -------------------------------------------------------------------------

// 20. _renderFrontmatter preserves nested arrays + null types
{
    const tmpl = {
        title:  "{{prompts.title}}",
        tags:   ["{{prompts.tag1}}", "{{prompts.tag2}}"],
        empty:  [],
        nullv:  null,
        countN: 7,
        boolT:  true,
    };
    const fmStr = inst._renderFrontmatter(tmpl, baseCtx({ prompts: { title: "T", tag1: "a", tag2: "b" } }));
    const hasTitle = /^title: "T"$/m.test(fmStr);
    const hasTags  = /^tags:\n  - "a"\n  - "b"$/m.test(fmStr);
    const hasEmpty = /^empty: \[\]$/m.test(fmStr);
    const hasNull  = /^nullv: null$/m.test(fmStr);
    const hasNum   = /^countN: 7$/m.test(fmStr);
    const hasBool  = /^boolT: true$/m.test(fmStr);
    ok("EC-20 _renderFrontmatter preserves array/null/number/boolean types",
        hasTitle && hasTags && hasEmpty && hasNull && hasNum && hasBool,
        `got ${JSON.stringify(fmStr)}`);
}

// 21. _renderFrontmatter |number pipe → unquoted scalar
{
    const fmStr = inst._renderFrontmatter({ amount: "{{prompts.amt|number}}" },
        baseCtx({ prompts: { amt: "199.99" } }));
    ok("EC-21 _renderFrontmatter |number pipe emits unquoted numeric YAML scalar",
        /^amount: 199\.99$/m.test(fmStr) && !/"199\.99"/.test(fmStr),
        `got ${JSON.stringify(fmStr)}`);
}

// -------------------------------------------------------------------------
// _joinDestination composition
// -------------------------------------------------------------------------

// 22. _joinDestination flat (no date pattern)
{
    const dest = { folder_prefix: "spice/people", filename_prefix: "alice", filename_suffix: "" };
    const path1 = inst._joinDestination(dest);
    ok("EC-22 _joinDestination composes flat folder + filename",
        path1 === "spice/people/alice.md", `got ${JSON.stringify(path1)}`);
}

// 23. _joinDestination date-routed composition
{
    const dest = {
        folder_prefix: "spice/daily",
        folder_date_pattern: "YYYY/MM-MMMM",
        filename_prefix: "",
        filename_date_pattern: "YYYY-MM-DD",
        filename_suffix: "",
    };
    const raw = inst._joinDestination(dest);
    const subbed = inst._substitute(raw, baseCtx({ now: moment("2026-05-14") }));
    ok("EC-23 _joinDestination date-routed composes correctly",
        subbed === "spice/daily/2026/05-May/2026-05-14.md", `got ${JSON.stringify(subbed)}`);
}

// -------------------------------------------------------------------------
// extra_files subfolder composition (24)
// -------------------------------------------------------------------------

// 24. extra_files entry with subfolder produces nested path
{
    const xf = { filename_pattern: "Map.md", subfolder: "{{prompts.slug}}" };
    const ctx = baseCtx({ prompts: { slug: "acme" } });
    const subbed = inst._substitute(xf.subfolder, ctx);
    const filename = inst._substitute(xf.filename_pattern, ctx);
    ok("EC-24 extra_files entry with subfolder composes nested path",
        subbed === "acme" && filename === "Map.md",
        `sub=${JSON.stringify(subbed)} file=${JSON.stringify(filename)}`);
}

// -------------------------------------------------------------------------
// _loadSpec registry-read
// -------------------------------------------------------------------------

// 26. _loadSpec("meeting") reads ranch/entity-create-registry.json + decodes
{
    const ec2 = loadEntityCreate({
        vaultFiles: {
            "ranch/entity-create-registry.json": JSON.stringify({
                schema_version: 1,
                contributions: {
                    meetings: [{ id: "meeting", label: "New Meeting", prompts: [], destination: {}, frontmatter_template: {} }],
                },
                entries: [{ id: "meeting", label: "New Meeting", prompts: [], destination: {}, frontmatter_template: {} }],
            }),
        },
    });
    const inst2 = new ec2.Cls();
    inst2._loadSpec("meeting").then((spec) => {
        ok("EC-26 _loadSpec('meeting') reads registry + decodes entry",
            spec && spec.id === "meeting" && spec.label === "New Meeting",
            `got ${JSON.stringify(spec)}`);
    });
}

// 27. _loadSpec("unknown") returns null (no throw)
{
    const ec3 = loadEntityCreate({
        vaultFiles: {
            "ranch/entity-create-registry.json": JSON.stringify({ entries: [{ id: "meeting" }] }),
        },
    });
    const inst3 = new ec3.Cls();
    inst3._loadSpec("unknown-id").then((spec) => {
        ok("EC-27 _loadSpec('unknown-id') returns null without throwing", spec === null);
    });
}

// 25. idempotency: EntityCreate.create on existing path opens existing
{
    // Use _loadSpec + create() — but create() expects spec.destination.folder_prefix etc.
    // Pre-seed an existing target path; spy on workspace.openLinkText.
    const ec4 = loadEntityCreate({
        vaultFiles: {
            "ranch/entity-create-registry.json": JSON.stringify({
                entries: [{
                    id: "test", label: "Test",
                    prompts: [],
                    destination: { folder_prefix: "spice/test", filename_prefix: "Note", filename_suffix: "" },
                    frontmatter_template: { type: "test" },
                }],
            }),
            "spice/test/Note.md": "existing content",
            "spice/test": { __folder: true },
        },
    });
    const inst4 = new ec4.Cls();
    inst4.create({ instance: "test", dv: null }).then(() => {
        // Expect: openLinkText fired with the existing path; no new vault.create.
        const opened = ec4.opens.length === 1 && ec4.opens[0] === "spice/test/Note.md";
        const noCreate = ec4.created.length === 0;
        ok("EC-25 EntityCreate.create on existing path opens existing without creating",
            opened && noCreate,
            `opens=${JSON.stringify(ec4.opens)} created=${JSON.stringify(ec4.created.map(x=>x.path))}`);
    });
}

// -------------------------------------------------------------------------
// 28 + 29. Installer manifest-field validator (resolveEntityCreateEntry)
// -------------------------------------------------------------------------

// Load only the resolveEntityCreateEntry function via grep+wrap of install.js.
// install.js is too large + has many side-effects; we sandbox-load it by
// extracting just the function body via regex + eval. The function is pure
// (no app/vault reads) so this isolates cleanly.
const installSrc = fs.readFileSync(path.join(ROOT, "platform/install.js"), "utf8");
function extractFn(src, name) {
    // Find "function <name>(...) {" and balance-match braces.
    const startIdx = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
    if (startIdx < 0) return null;
    // Find opening "{"
    let i = src.indexOf("{", startIdx);
    if (i < 0) return null;
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(startIdx, i);
}

const resolveFnSrc      = extractFn(installSrc, "resolveEntityCreateEntry");
const resolveBodySrc    = extractFn(installSrc, "_resolveBodyTemplatePath");
const substituteSrc     = extractFn(installSrc, "substituteLenient");
const idReSrc           = installSrc.match(/const\s+_EC_ID_RE\s*=[^;]+;/);
const keyReSrc          = installSrc.match(/const\s+_EC_KEY_RE\s*=[^;]+;/);
const promptTypesSrc    = installSrc.match(/const\s+_EC_PROMPT_TYPES\s*=[^;]+;/);

let resolveEntityCreateEntry = null;
if (resolveFnSrc && substituteSrc && idReSrc && keyReSrc && promptTypesSrc && resolveBodySrc) {
    const wrapped =
        `"use strict";\n` +
        `${substituteSrc}\n` +
        `${idReSrc[0]}\n` +
        `${keyReSrc[0]}\n` +
        `${promptTypesSrc[0]}\n` +
        `${resolveBodySrc}\n` +
        `${resolveFnSrc}\n` +
        `return resolveEntityCreateEntry;`;
    const NoticeStub = function (msg) { (NoticeStub.captured ||= []).push(String(msg)); };
    resolveEntityCreateEntry = new Function("Notice", wrapped)(NoticeStub);
}

// 28. resolveEntityCreateEntry: missing id → warn, return null
if (resolveEntityCreateEntry) {
    const history = [];
    const git = { commit: "0", tag: "x", dirty: false };
    const r = resolveEntityCreateEntry({}, {}, "test-bp", history, git);
    ok("EC-28 resolveEntityCreateEntry: missing id returns null + history warning",
        r === null && history.length === 1 && history[0].event === "warning" && /missing id/.test(history[0].reason || ""),
        `r=${r} history=${JSON.stringify(history)}`);
} else {
    ok("EC-28 resolveEntityCreateEntry: missing id returns null + history warning",
        false, "could not extract resolveEntityCreateEntry from install.js");
}

// 29. resolveEntityCreateEntry: malformed render_in (kind="bogus") → warn, return null
if (resolveEntityCreateEntry) {
    const history = [];
    const git = { commit: "0", tag: "x", dirty: false };
    const entry = {
        id: "x", label: "L",
        prompts: [],
        destination: { folder_prefix: "spice/x", filename_prefix: "X" },
        frontmatter_template: {},
        render_in: { kind: "bogus" },
    };
    const r = resolveEntityCreateEntry(entry, {}, "test-bp", history, git);
    ok("EC-29 resolveEntityCreateEntry: render_in.kind bogus returns null + warning",
        r === null && history.some(h => /render_in\.kind/.test(h.reason || "")),
        `r=${r} history=${JSON.stringify(history)}`);
} else {
    ok("EC-29 resolveEntityCreateEntry: render_in.kind bogus returns null + warning",
        false, "could not extract resolveEntityCreateEntry");
}

// -------------------------------------------------------------------------
// 33-38. v0.47.0 S5 — _resolveBodyTemplatePath helper + auto-prepend +
//                     JSON-schema basename-only enforcement
// -------------------------------------------------------------------------

// Reconstitute the helper as a callable function for direct unit tests.
let _resolveBodyTemplatePathFn = null;
if (resolveBodySrc) {
    const wrapped = `${resolveBodySrc}\nreturn _resolveBodyTemplatePath;`;
    try { _resolveBodyTemplatePathFn = new Function(wrapped)(); }
    catch (_e) { _resolveBodyTemplatePathFn = null; }
}

// 33. _resolveBodyTemplatePath prepends templates_path on bare basename.
if (_resolveBodyTemplatePathFn) {
    const r = _resolveBodyTemplatePathFn("Template, Project.md", { templates_path: "ranch/templates" });
    ok("EC-33 _resolveBodyTemplatePath prepends templates_path on bare basename",
        r === "ranch/templates/Template, Project.md", `got ${JSON.stringify(r)}`);
} else {
    ok("EC-33 _resolveBodyTemplatePath prepends templates_path on bare basename",
        false, "helper not extracted");
}

// 34. _resolveBodyTemplatePath pass-through when path separator already present.
if (_resolveBodyTemplatePathFn) {
    const r = _resolveBodyTemplatePathFn("ranch/templates/Foo.md", { templates_path: "ranch/templates" });
    ok("EC-34 _resolveBodyTemplatePath pass-through when path separator present",
        r === "ranch/templates/Foo.md", `got ${JSON.stringify(r)}`);
} else {
    ok("EC-34 _resolveBodyTemplatePath pass-through when path separator present",
        false, "helper not extracted");
}

// 35. _resolveBodyTemplatePath empty-string no-op.
if (_resolveBodyTemplatePathFn) {
    const r = _resolveBodyTemplatePathFn("", { templates_path: "ranch/templates" });
    ok("EC-35 _resolveBodyTemplatePath empty-string no-op",
        r === "", `got ${JSON.stringify(r)}`);
} else {
    ok("EC-35 _resolveBodyTemplatePath empty-string no-op",
        false, "helper not extracted");
}

// 36. resolveEntityCreateEntry applies the helper to body_template end-to-end.
if (resolveEntityCreateEntry) {
    const history = [];
    const git = { commit: "0", tag: "x", dirty: false };
    const entry = {
        id: "x", label: "L",
        prompts: [],
        destination: { folder_prefix: "spice/x", filename_prefix: "X" },
        frontmatter_template: { type: "x" },
        body_template: "Foo.md",
        render_in: { kind: "hub", target_path: "spice/x/X.md" },
    };
    const r = resolveEntityCreateEntry(entry, { templates_path: "ranch/templates" }, "test-bp", history, git);
    ok("EC-36 resolveEntityCreateEntry applies _resolveBodyTemplatePath to body_template",
        r && r.body_template === "ranch/templates/Foo.md",
        `body_template=${r && JSON.stringify(r.body_template)} history=${JSON.stringify(history)}`);
} else {
    ok("EC-36 resolveEntityCreateEntry applies _resolveBodyTemplatePath to body_template",
        false, "could not extract resolveEntityCreateEntry");
}

// 37. resolveEntityCreateEntry applies the helper to extra_files[].body_template.
if (resolveEntityCreateEntry) {
    const history = [];
    const git = { commit: "0", tag: "x", dirty: false };
    const entry = {
        id: "x", label: "L",
        prompts: [],
        destination: { folder_prefix: "spice/x", filename_prefix: "X" },
        frontmatter_template: { type: "x" },
        body_template: "Foo.md",
        extra_files: [{ filename_pattern: "Y.md", body_template: "Sidecar.md" }],
        render_in: { kind: "hub", target_path: "spice/x/X.md" },
    };
    const r = resolveEntityCreateEntry(entry, { templates_path: "ranch/templates" }, "test-bp", history, git);
    const ef0bt = r && Array.isArray(r.extra_files) && r.extra_files[0] && r.extra_files[0].body_template;
    ok("EC-37 resolveEntityCreateEntry applies _resolveBodyTemplatePath to extra_files[].body_template",
        ef0bt === "ranch/templates/Sidecar.md",
        `extra_files[0].body_template=${JSON.stringify(ef0bt)}`);
} else {
    ok("EC-37 resolveEntityCreateEntry applies _resolveBodyTemplatePath to extra_files[].body_template",
        false, "could not extract resolveEntityCreateEntry");
}

// 38. JSON-schema body_template pattern rejects '/'-containing values
//     and accepts bare basenames. Pattern is documentation today (no runtime
//     validator loads the schema) but the regex IS the documented constraint;
//     this case proves the regex matches the convention.
{
    const schemaObj = JSON.parse(schemaRaw);
    const topPattern = schemaObj.items.properties.body_template.pattern;
    const efPattern = schemaObj.items.properties.extra_files.items.properties.body_template.pattern;
    const patternsAgree = topPattern === efPattern;
    const re = new RegExp(topPattern);
    const acceptsBasename   = re.test("Foo.md") && re.test("Template, Project.md");
    const rejectsSlash      = !re.test("ranch/templates/Foo.md");
    const rejectsBackslash  = !re.test("ranch\\templates\\Foo.md");
    const rejectsNonMd      = !re.test("Foo.txt");
    ok("EC-38 JSON-schema body_template pattern rejects path-shaped values",
        patternsAgree && acceptsBasename && rejectsSlash && rejectsBackslash && rejectsNonMd,
        `topPattern=${JSON.stringify(topPattern)} efPattern=${JSON.stringify(efPattern)} ` +
        `acceptsBasename=${acceptsBasename} rejectsSlash=${rejectsSlash} ` +
        `rejectsBackslash=${rejectsBackslash} rejectsNonMd=${rejectsNonMd}`);
}

// -------------------------------------------------------------------------
// 30 + 31 + 32. Audit walker fixture seeds
// -------------------------------------------------------------------------

const { walkEntityCreate } = require("../audit/entity-create-walker");

function seedVault(setup) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-ec-audit-"));
    fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"),
        JSON.stringify(setup.installed, null, 2));
    if (setup.scripts) {
        for (const [bp, files] of Object.entries(setup.scripts)) {
            const sd = path.join(dir, "ranch/scripts", bp);
            fs.mkdirSync(sd, { recursive: true });
            for (const [fname, body] of Object.entries(files)) {
                fs.writeFileSync(path.join(sd, fname), body);
            }
        }
    }
    if (setup.dirs) {
        for (const rel of setup.dirs) {
            fs.mkdirSync(path.join(dir, rel), { recursive: true });
        }
    }
    if (setup.templates) {
        const td = path.join(dir, "ranch/templates");
        fs.mkdirSync(td, { recursive: true });
        for (const [name, body] of Object.entries(setup.templates)) {
            fs.writeFileSync(path.join(td, name), body);
        }
    }
    return dir;
}

// 30. HIGH manual_implementation_at_risk: NewFooButton class + no manifest entry
{
    const vault = seedVault({
        installed: {
            blueprints: [{ name: "foo", version: "0.1.0" /* no new_entity_buttons */ }],
            mechanisms: [],
        },
        scripts: { foo: { "new-foo-button.js": "class NewFooButton { render(){} }\n" } },
    });
    walkEntityCreate(vault).then((result) => {
        const r = result.findings.find(f => f.severity === "manual_implementation_at_risk" && f.blueprint === "foo");
        ok("EC-30 audit walker: New*Button without manifest entry → HIGH finding",
            !!r && result.counts.manual_implementation_at_risk >= 1,
            `findings=${JSON.stringify(result.findings)}`);
        fs.rmSync(vault, { recursive: true, force: true });
    }).catch(e => {
        ok("EC-30 audit walker: New*Button without manifest entry → HIGH finding",
            false, e.message);
        fs.rmSync(vault, { recursive: true, force: true });
    });
}

// 31. INFO escape_hatch_used: NewFooButton + manifest entry coexist
{
    const vault = seedVault({
        installed: {
            blueprints: [{
                name: "foo",
                version: "0.1.0",
                new_entity_buttons: [{
                    id: "foo", label: "New Foo",
                    destination: { folder_prefix: "spice/foo", filename_prefix: "F" },
                    frontmatter_template: { type: "foo" },
                    render_in: { kind: "hub", target_path: "spice/foo/Foo.md" },
                }],
            }],
            mechanisms: [],
        },
        scripts: { foo: { "new-foo-button.js": "class NewFooButton { render(){} }\n" } },
        dirs: ["spice/foo"],
    });
    walkEntityCreate(vault).then((result) => {
        const r = result.findings.find(f => f.severity === "escape_hatch_used" && f.blueprint === "foo");
        ok("EC-31 audit walker: class + manifest entry coexist → INFO escape_hatch_used",
            !!r && result.counts.escape_hatch_used >= 1,
            `findings=${JSON.stringify(result.findings)}`);
        fs.rmSync(vault, { recursive: true, force: true });
    }).catch(e => {
        ok("EC-31 audit walker: class + manifest entry coexist → INFO escape_hatch_used",
            false, e.message);
        fs.rmSync(vault, { recursive: true, force: true });
    });
}

// 32. MEDIUM dead_path: manifest entry with bogus body_template
{
    const vault = seedVault({
        installed: {
            blueprints: [{
                name: "bar",
                version: "0.1.0",
                new_entity_buttons: [{
                    id: "bar", label: "New Bar",
                    destination: { folder_prefix: "spice/bar", filename_prefix: "B" },
                    frontmatter_template: { type: "bar" },
                    body_template: "no-such-template.md",
                    render_in: { kind: "hub", target_path: "spice/bar/Bar.md" },
                }],
            }],
            mechanisms: [],
        },
        dirs: ["spice/bar"],
        // no templates → body_template should fail to resolve.
    });
    walkEntityCreate(vault).then((result) => {
        const r = result.findings.find(f => f.severity === "dead_path" && f.blueprint === "bar"
            && /body_template/.test(f.message || ""));
        ok("EC-32 audit walker: bogus body_template → MEDIUM dead_path finding",
            !!r && result.counts.dead_path >= 1,
            `findings=${JSON.stringify(result.findings)}`);
        fs.rmSync(vault, { recursive: true, force: true });
    }).catch(e => {
        ok("EC-32 audit walker: bogus body_template → MEDIUM dead_path finding",
            false, e.message);
        fs.rmSync(vault, { recursive: true, force: true });
    });
}

// -------------------------------------------------------------------------
// DOC-1..6 — v0.50.0 project doc-note entity-create entry (renamed from WIKI in v0.52.0)
// -------------------------------------------------------------------------
{
    const projectManifest = JSON.parse(fs.readFileSync(
        path.join(__dirname, "..", "blueprints", "project", "manifest.json"), "utf8"));

    const docEntry = (projectManifest.new_entity_buttons || []).find((e) => e.id === "doc-note");
    ok("DOC-1 project manifest declares id=doc-note entity-create entry",
        !!docEntry, `entries=${(projectManifest.new_entity_buttons || []).map(e => e.id).join(",")}`);

    if (docEntry) {
        ok("DOC-2 doc-note destination.folder_prefix uses {{current_file.frontmatter.project_slug}}",
            docEntry.destination &&
            docEntry.destination.folder_prefix === "spice/projects/{{current_file.frontmatter.project_slug}}/docs",
            `got ${JSON.stringify(docEntry.destination && docEntry.destination.folder_prefix)}`);

        ok("DOC-3 doc-note frontmatter_template.project uses {{current_file.frontmatter.project_name}}",
            docEntry.frontmatter_template &&
            docEntry.frontmatter_template.project === "[[{{current_file.frontmatter.project_name}}]]",
            `got ${JSON.stringify(docEntry.frontmatter_template && docEntry.frontmatter_template.project)}`);

        ok("DOC-4 doc-note render_in.target_path points at Template, Docs Hub.md",
            docEntry.render_in &&
            docEntry.render_in.target_path === "{{templates_path}}/Template, Docs Hub.md",
            `got ${JSON.stringify(docEntry.render_in && docEntry.render_in.target_path)}`);
    } else {
        ok("DOC-2 doc-note destination.folder_prefix uses {{current_file.frontmatter.project_slug}}", false, "no doc-note entry");
        ok("DOC-3 doc-note frontmatter_template.project uses {{current_file.frontmatter.project_name}}", false, "no doc-note entry");
        ok("DOC-4 doc-note render_in.target_path points at Template, Docs Hub.md", false, "no doc-note entry");
    }

    const projectEntry = (projectManifest.new_entity_buttons || []).find((e) => e.id === "project");
    // Find the docs sidecar by body_template (stable across the v0.50.4
    // filename_pattern → subfolder canonicalization).
    const docsSidecar = projectEntry && projectEntry.extra_files &&
        projectEntry.extra_files.find((x) => x.body_template === "Template, Docs Hub.md");
    ok("DOC-5 project entity's extra_files[] maps to Template, Docs Hub.md",
        !!docsSidecar,
        `docsSidecar=${JSON.stringify(docsSidecar)}`);

    // DOC-6: resolveEntityCreateEntry resolves the doc-note entry cleanly
    if (resolveEntityCreateEntry && docEntry) {
        const history = [];
        const git = { commit: "0", tag: "x", dirty: false };
        const r = resolveEntityCreateEntry(docEntry, { templates_path: "ranch/templates" }, "project", history, git);
        ok("DOC-6 doc-note entry resolves cleanly via resolveEntityCreateEntry",
            r !== null && r.body_template === "ranch/templates/Template, Doc Note.md",
            `r=${r === null ? "null" : "ok"} body_template=${r && JSON.stringify(r.body_template)} history=${JSON.stringify(history)}`);
    } else {
        ok("DOC-6 doc-note entry resolves cleanly via resolveEntityCreateEntry",
            false, "resolveEntityCreateEntry or doc-note entry not available");
    }
}

// -------------------------------------------------------------------------
// v0.50.1 BUG-B: _readBody no longer gates on app.vault.getAbstractFileByPath.
// Obsidian's metadata cache lags newly-materialized files in the same install
// run (templates added at v0.50.0 weren't indexed by the time the user clicked
// New Project, so getAbstractFileByPath returned null and Wiki.md ended up
// empty). adapter.read hits the filesystem directly regardless of index state.
// -------------------------------------------------------------------------
{
    const ecSrc = fs.readFileSync(
        path.join(__dirname, "..", "mechanisms", "entity-create", "entity-create.js"), "utf8");
    const readBodyMatch = ecSrc.match(/async _readBody\([\s\S]*?\n    \}/);
    // Anti-pattern: a CALL to app.vault.getAbstractFileByPath(...). The comment
    // documenting why the call was removed remains in the body (mentions the
    // name), so the assertion checks for the actual call shape, not just the
    // identifier substring.
    ok("EC-RB-1 _readBody no longer CALLS app.vault.getAbstractFileByPath",
        readBodyMatch && !/app\.vault\.getAbstractFileByPath\s*\(/.test(readBodyMatch[0]),
        readBodyMatch ? `match: ${/app\.vault\.getAbstractFileByPath\s*\(/.test(readBodyMatch[0])}` : "_readBody not found");
    ok("EC-RB-2 _readBody uses app.vault.adapter.read",
        readBodyMatch && /app\.vault\.adapter\.read/.test(readBodyMatch[0]),
        readBodyMatch ? `adapter.read present: ${/app\.vault\.adapter\.read/.test(readBodyMatch[0])}` : "_readBody not found");
}

// -------------------------------------------------------------------------
// v0.50.4 — _createExtra ensures parent dir when filename_pattern itself
// embeds a subfolder (e.g. "docs/Docs.md"). Regression for the case where
// only the outer xFolder was ensured and vault.create silently left an
// empty file in real Obsidian. Stub vault records createFolder calls so we
// can assert the embedded "docs" subdir was ensured before the file write.
// -------------------------------------------------------------------------
{
    const ec39 = loadEntityCreate({
        vaultFiles: {
            "ranch/templates/Template, Docs Hub.md": "FAKE DOCS HUB BODY",
        },
    });
    const inst39 = new ec39.Cls();
    const xf = { filename_pattern: "docs/Docs.md", body_template: "ranch/templates/Template, Docs Hub.md" };
    const ctx39 = baseCtx({ prompts: { slug: "demo" } });
    const folder39 = "spice/projects/demo";
    inst39._createExtra(xf, ctx39, folder39).then(() => {
        const wrote = ec39.vaultFiles["spice/projects/demo/docs/Docs.md"];
        const docsDir = ec39.vaultFiles["spice/projects/demo/docs"];
        ok("EC-39 _createExtra ensures parent dir for filename_pattern with embedded subfolder",
            docsDir && docsDir.__folder === true &&
            typeof wrote === "string" && wrote.includes("FAKE DOCS HUB BODY"),
            `docsDir=${JSON.stringify(docsDir)} wrote=${typeof wrote === "string" ? `len=${wrote.length}` : JSON.stringify(wrote)}`);
    });
}

// -------------------------------------------------------------------------
// v0.50.4 — project blueprint's docs extra_file uses the canonical
// subfolder field (not an embedded slash in filename_pattern). EC-39 above
// covers the mechanism-side robustness; this asserts the in-tree manifest
// adopts the schema-canonical form.
// -------------------------------------------------------------------------
{
    const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/blueprints/project/manifest.json"), "utf8"));
    const pe = (pm.new_entity_buttons || []).find((e) => e.id === "project");
    const docsXf = pe && pe.extra_files &&
        pe.extra_files.find((x) => x.body_template === "Template, Docs Hub.md");
    ok("EC-40 project docs extra_file uses canonical subfolder field (v0.50.4)",
        docsXf && docsXf.subfolder === "docs" && docsXf.filename_pattern === "Docs.md",
        `docsXf=${JSON.stringify(docsXf)}`);
}

// -------------------------------------------------------------------------
// Drain pending promises before exiting. The audit walker tests + _loadSpec
// tests are async; we await one tick by deferring the summary via setImmediate
// chained twice to flush microtasks.
// -------------------------------------------------------------------------

setImmediate(() => setImmediate(() => setImmediate(() => {
    console.log(`\nrun-entity-create.js: ${pass} pass · ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
})));
