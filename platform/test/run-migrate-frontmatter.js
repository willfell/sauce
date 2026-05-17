// platform/test/run-migrate-frontmatter.js — v0.53.0 FA-1
// Tests cmd-migrate-frontmatter.js: renames, date coercion, tag cleanup,
// wikilink quoting, backfill, dry-run + apply.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const cmd = require("../cli/cmd-migrate-frontmatter.js");

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ok ${label}`); pass++; }
    else { console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); fail++; }
}

function withTempVault(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-migfm-"));
    try { return fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function seedSpec() {
    // The real spec lives at platform/migrations/v0.53-frontmatter.json.
    // For unit tests we use that file's contents via require — it is JSON.
    return require("../migrations/v0.53-frontmatter.json");
}

function writeFile(absPath, content) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
}

function readFile(absPath) {
    return fs.readFileSync(absPath, "utf8");
}

const WORKSHOP_ROOT = path.resolve(__dirname, "..", "..");

// =============================================================================
// MF-REN — renames
// =============================================================================

// MF-REN-1: rename created → created_at with date coercion
{
    const fm = { created: "2026-05-15", type: "meeting" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/meetings/x.md" });
    const renameOp = ops.find(o => o.kind === "rename_key" && o.from === "created");
    ok("MF-REN-1 rename created → created_at", renameOp && renameOp.to === "created_at",
        `got: ${JSON.stringify(ops)}`);
}

// MF-REN-2: rename attending → people, scoped to type:trip
{
    const fm = { attending: ["[[Alice]]"], type: "trip" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/trips/x.md" });
    const op = ops.find(o => o.from === "attending");
    ok("MF-REN-2 rename attending → people on trip", op && op.to === "people");
}

// MF-REN-2b: attending → people NOT renamed when type is not trip
{
    const fm = { attending: ["[[Alice]]"], type: "meeting" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/meetings/x.md" });
    const op = ops.find(o => o.from === "attending");
    ok("MF-REN-2b attending → people scope-gated", !op);
}

// MF-REN-3: rename product → products, wrap as list
{
    const fm = { product: "[[ACME]]", type: "team" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/teams/x.md" });
    const op = ops.find(o => o.kind === "rename_wrap_list");
    ok("MF-REN-3 rename product → products wrap as list",
        op && op.from === "product" && op.to === "products");
}

// MF-REN-4: rename month → month_label, scoped to type:cowork-monthly
{
    const fm = { month: "May", type: "cowork-monthly" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/cowork/x.md" });
    const op = ops.find(o => o.from === "month");
    ok("MF-REN-4 rename month → month_label on cowork-monthly",
        op && op.to === "month_label");
}

// MF-REN-4b: month NOT renamed when type is finance
{
    const fm = { month: "2026-05", type: "budget" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/finance/x.md" });
    const op = ops.find(o => o.from === "month");
    ok("MF-REN-4b month rename scope-gated (no-op on type:budget)", !op);
}

// =============================================================================
// MF-DT — date coercion
// =============================================================================

// MF-DT-1: YYYY-MM-DD
{
    const out = cmd._coerceIsoWithTz("2026-05-17", new Date());
    ok("MF-DT-1 YYYY-MM-DD → ISO+TZ",
        /^2026-05-17T00:00:00[+-]\d{2}:\d{2}$/.test(out),
        `got: ${out}`);
}

// MF-DT-2: YYYY-MM-DD HH:mm
{
    const out = cmd._coerceIsoWithTz("2026-05-17 09:30", new Date());
    ok("MF-DT-2 YYYY-MM-DD HH:mm → ISO+TZ",
        /^2026-05-17T09:30:00[+-]\d{2}:\d{2}$/.test(out),
        `got: ${out}`);
}

// MF-DT-3: YYYY-MM-DD HH:mm:ss
{
    const out = cmd._coerceIsoWithTz("2026-05-17 09:30:45", new Date());
    ok("MF-DT-3 YYYY-MM-DD HH:mm:ss → ISO+TZ",
        /^2026-05-17T09:30:45[+-]\d{2}:\d{2}$/.test(out),
        `got: ${out}`);
}

// MF-DT-4: YYYY-MM-DDTHH:mm:ss (no TZ) → ISO+TZ
{
    const out = cmd._coerceIsoWithTz("2026-05-17T09:30:45", new Date());
    ok("MF-DT-4 partial T-form (no TZ) → ISO+TZ",
        /^2026-05-17T09:30:45[+-]\d{2}:\d{2}$/.test(out),
        `got: ${out}`);
}

// MF-DT-5: already-canonical → no change
{
    const input = "2026-05-17T09:30:00-07:00";
    const out = cmd._coerceIsoWithTz(input, new Date());
    ok("MF-DT-5 already-canonical no-op", out === input,
        `got: ${out}`);
}

// =============================================================================
// MF-TAG-S — discriminator tag strip
// =============================================================================

{
    const fm = { tags: ["meeting", "work"], type: "meeting" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/meetings/x.md" });
    const op = ops.find(o => o.kind === "filter_list" && o.key === "tags");
    ok("MF-TAG-S-1 strip discriminator 'meeting'",
        op && op.drop.includes("meeting"));
}

{
    const fm = { tags: ["person"], type: "person" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/people/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-S-2 strip discriminator 'person'",
        op && op.drop.includes("person"));
}

{
    const fm = { tags: ["scratch", "scratch-day"], type: "scratch" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/scratch/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-S-3 strip discriminator 'scratch' and 'scratch-day'",
        op && op.drop.includes("scratch") && op.drop.includes("scratch-day"));
}

{
    const fm = { tags: ["budget", "paycheck", "invoice"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/finance/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-S-4 strip multi-finance discriminators",
        op && op.drop.length === 3);
}

// =============================================================================
// MF-TAG-T — temporal tag strip
// =============================================================================

{
    const fm = { tags: ["2026/05/17"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/daily/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-T-1 strip temporal YYYY/MM/DD",
        op && op.drop.includes("2026/05/17"));
}

{
    const fm = { tags: ["2026/05"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/daily/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-T-2 strip temporal YYYY/MM",
        op && op.drop.includes("2026/05"));
}

{
    const fm = { tags: ["2026"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/daily/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-T-3 strip temporal YYYY",
        op && op.drop.includes("2026"));
}

// =============================================================================
// MF-TAG-P — preserve allowlist
// =============================================================================

{
    const fm = { tags: ["kanban-card"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-P-1 preserve 'kanban-card' (no op emitted)", !op);
}

{
    const fm = { tags: ["project-card"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-P-2 preserve 'project-card'", !op);
}

{
    const fm = { tags: ["task-board-card"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-P-3 preserve 'task-board-card'", !op);
}

{
    const fm = { tags: ["task-board"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-P-4 preserve 'task-board'", !op);
}

{
    // Mixed: discriminator + preserve should drop only discriminator
    const fm = { tags: ["meeting", "kanban-card", "2026/05/17"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "filter_list");
    ok("MF-TAG-P-5 mixed: preserve 'kanban-card', drop discriminator+temporal",
        op && op.drop.includes("meeting") && op.drop.includes("2026/05/17") && !op.drop.includes("kanban-card"));
}

// =============================================================================
// MF-WL — wikilink quoting
// =============================================================================

const WL_KEYS = ["people", "projects", "teams", "products", "trips", "meetings", "attendees", "daily_note", "day_link", "created_by"];
WL_KEYS.forEach((key, i) => {
    const fm = { [key]: ["[[Alice]]"] };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    const op = ops.find(o => o.kind === "quote_list_items" && o.key === key);
    ok(`MF-WL-${i + 1} quote bare wikilinks in '${key}'`, !!op);
});

// MF-WL-already-quoted: no op when already quoted
{
    // Already-quoted strings would have been parsed as bare strings (no [[]] shape),
    // so the regex check skips them. Use a string that contains a quoted form:
    const fm = { people: ['"[[Alice]]"'] };  // quoted form as the string value
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: "/x.md", relPath: "spice/x/x.md" });
    // After YAML parse, "\"[[Alice]]\"" would just be `"[[Alice]]"` — but our check looks at the raw string.
    // Since the parsed string is `"[[Alice]]"` containing quote chars, the /^\[\[.+\]\]$/ regex won't match.
    const op = ops.find(o => o.kind === "quote_list_items" && o.key === "people");
    ok("MF-WL-already-quoted no-op when strings include quote chars", !op);
}

// =============================================================================
// MF-BF — backfill
// =============================================================================

withTempVault((vault) => {
    const filePath = path.join(vault, "spice", "meetings", "m.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "---\nstatus: x\n---\nbody\n");
    const fm = { status: "x" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: filePath, relPath: "spice/meetings/m.md" });
    const tOp = ops.find(o => o.kind === "append_key" && o.key === "type");
    ok("MF-BF-1 backfill type inferred from path",
        tOp && tOp.value === "meeting", `got: ${JSON.stringify(tOp)}`);
});

withTempVault((vault) => {
    const filePath = path.join(vault, "spice", "meetings", "m.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "---\ntype: meeting\n---\nbody\n");
    const fm = { type: "meeting" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: filePath, relPath: "spice/meetings/m.md" });
    const cOp = ops.find(o => o.kind === "append_key" && o.key === "created_at");
    ok("MF-BF-2 backfill created_at from mtime", !!cOp);
}); // when nothing exists

withTempVault((vault) => {
    const filePath = path.join(vault, "spice", "meetings", "m.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "---\ntype: meeting\ncreated: 2026-05-15\n---\nbody\n");
    const fm = { type: "meeting", created: "2026-05-15" };
    const ops = cmd._computeTransforms(fm, seedSpec(), { absPath: filePath, relPath: "spice/meetings/m.md" });
    const cOp = ops.find(o => o.kind === "append_key" && o.key === "created_at");
    ok("MF-BF-3 NO backfill created_at when 'created' present (rename will handle)", !cOp);
});

// =============================================================================
// MF-OP-APPLY — op application on actual frontmatter lines
// =============================================================================

// MF-OP-1: rename_key on inline scalar
{
    const fmLines = ["created: 2026-05-15", "type: meeting"];
    const out = cmd._applyOpsToFmLines(fmLines, [
        { kind: "rename_key", from: "created", to: "created_at" }
    ]);
    ok("MF-OP-1 rename_key rewrites key name", out[0] === "created_at: 2026-05-15");
}

// MF-OP-2: set_value rewrites scalar
{
    const fmLines = ["created_at: 2026-05-15"];
    const out = cmd._applyOpsToFmLines(fmLines, [
        { kind: "set_value", key: "created_at", newValue: "2026-05-15T00:00:00-07:00" }
    ]);
    ok("MF-OP-2 set_value rewrites scalar",
        out[0].includes("2026-05-15T00:00:00-07:00"),
        `got: ${out[0]}`);
}

// MF-OP-3: filter_list block form drops items
{
    const fmLines = ["tags:", "  - meeting", "  - work", "  - 2026/05/17"];
    const out = cmd._applyOpsToFmLines(fmLines, [
        { kind: "filter_list", key: "tags", drop: ["meeting", "2026/05/17"] }
    ]);
    ok("MF-OP-3 filter_list block drops items",
        out.length === 2 && out[0] === "tags:" && out[1] === "  - work",
        `got: ${JSON.stringify(out)}`);
}

// MF-OP-4: rename_wrap_list converts scalar to list
{
    const fmLines = ["product: \"[[ACME]]\""];
    const out = cmd._applyOpsToFmLines(fmLines, [
        { kind: "rename_wrap_list", from: "product", to: "products" }
    ]);
    ok("MF-OP-4 rename_wrap_list converts scalar to list",
        out.length === 2 && out[0] === "products:" && /^\s+- "\[\[ACME\]\]"/.test(out[1]),
        `got: ${JSON.stringify(out)}`);
}

// MF-OP-5: quote_list_items wraps unquoted wikilinks
{
    const fmLines = ["people:", "  - [[Alice]]", "  - \"[[Bob]]\""];
    const out = cmd._applyOpsToFmLines(fmLines, [
        { kind: "quote_list_items", key: "people" }
    ]);
    ok("MF-OP-5 quote_list_items wraps unquoted only",
        out[1] === "  - \"[[Alice]]\"" && out[2] === "  - \"[[Bob]]\"",
        `got: ${JSON.stringify(out)}`);
}

// =============================================================================
// MF-DR — dry-run report
// =============================================================================

withTempVault((vault) => {
    const filePath = path.join(vault, "spice", "meetings", "m.md");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "---\nstatus: x\ncreated: 2026-05-15\ntags:\n  - meeting\n---\nbody\n");
    const r = cmd._runMigration({
        vaultPath: vault, workshopRoot: WORKSHOP_ROOT,
        blueprint: null, apply: false, reportPath: null, log: () => {}
    });
    const reportPath = path.join(vault, "sauce-migration-report.md");
    ok("MF-DR-1 dry-run report file created", fs.existsSync(reportPath));
    const md = fs.readFileSync(reportPath, "utf8");
    ok("MF-DR-2 dry-run report has Summary section", /## Summary/.test(md));
    ok("MF-DR-3 dry-run report lists the changed file", md.includes("spice/meetings/m.md"));
});

withTempVault((vault) => {
    // Clean vault (no files) → "No changes proposed"
    cmd._runMigration({
        vaultPath: vault, workshopRoot: WORKSHOP_ROOT,
        blueprint: null, apply: false, reportPath: null, log: () => {}
    });
    const reportPath = path.join(vault, "sauce-migration-report.md");
    const md = fs.readFileSync(reportPath, "utf8");
    ok("MF-DR-4 clean vault produces no-changes message",
        /No changes proposed|0 changed/.test(md));
});

// =============================================================================
// MF-AP — apply
// =============================================================================

withTempVault((vault) => {
    const relPath = "spice/meetings/m.md";
    const absPath = path.join(vault, relPath);
    const original = "---\nstatus: x\ncreated: 2026-05-15\n---\nbody content\n";
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, original);
    cmd._runMigration({
        vaultPath: vault, workshopRoot: WORKSHOP_ROOT,
        blueprint: null, apply: true, log: () => {}
    });
    const rewritten = fs.readFileSync(absPath, "utf8");
    ok("MF-AP-1 --apply renames created → created_at",
        rewritten.includes("created_at:") && !rewritten.includes("\ncreated:"),
        `got: ${rewritten}`);
    ok("MF-AP-2 --apply preserves body verbatim",
        rewritten.includes("body content"));
    // Sidecar exists somewhere under .sauce-backup/
    const backupRoot = path.join(vault, ".sauce-backup");
    let foundBackup = false;
    if (fs.existsSync(backupRoot)) {
        const tsDirs = fs.readdirSync(path.join(backupRoot, relPath));
        if (tsDirs.length > 0) {
            const backupFile = path.join(backupRoot, relPath, tsDirs[0], path.basename(absPath));
            foundBackup = fs.existsSync(backupFile) && fs.readFileSync(backupFile, "utf8") === original;
        }
    }
    ok("MF-AP-3 --apply writes .sauce-backup sidecar with original content", foundBackup);
});

withTempVault((vault) => {
    // Parse error halts on --apply
    const absPath = path.join(vault, "spice/meetings/bad.md");
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    // Frontmatter with a nested mapping that the parser rejects.
    fs.writeFileSync(absPath, "---\nattendees:\n  alice:\n    role: lead\n---\nbody\n");
    let threw = false;
    try {
        cmd._runMigration({
            vaultPath: vault, workshopRoot: WORKSHOP_ROOT,
            blueprint: null, apply: true, log: () => {}
        });
    } catch (e) {
        threw = e.exitCode === 2 && /YAML parse error/.test(e.message);
    }
    ok("MF-AP-4 --apply halts on YAML parse error with exitCode 2", threw);
});

console.log(`\nrun-migrate-frontmatter.js: ${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
