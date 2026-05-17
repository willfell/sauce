// platform/cli/cmd-migrate-frontmatter.js — `sauce migrate-frontmatter` verb (v0.53.0 FA-1).
//
// Applies the v0.53-frontmatter.json migration spec against vault notes:
//   - rename keys (created → created_at, attending → people, product → products,
//     month → month_label) with optional per-type scoping + value coercion
//   - reformat date values into ISO-8601 with TZ
//   - strip discriminator + temporal tags; preserve allowlisted functional tags
//   - quote bare wikilinks in canonical cross-ref keys
//   - backfill missing type (inferred from path) + created_at (from file mtime)
//
// Default mode is dry-run → writes <vault>/sauce-migration-report.md with per-file
// proposed diffs grouped by blueprint. `--apply` performs the rewrites with a
// .sauce-backup/<rel>/<ts>/<basename> sidecar per touched file.
//
// Read-only by default; --apply is the only write site (mirrors landmine #21
// for audit walker, lifted for the migration verb).

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const registry = require("./registry.js");

const MIGRATION_SPEC_REL = "platform/migrations/v0.53-frontmatter.json";
const CANONICAL_VOCAB_REL = "platform/rules/_canonical-vocab.json";

// Blueprint slug → frontmatter `type` value used for path-based backfill.
// Where blueprint dir name (under spice/) differs from the canonical type name.
const PATH_TO_TYPE = {
    "projects": "project",
    "meetings": "meeting",
    "people": "person",
    "products": "product",
    "teams": "team",
    "trips": "trip",
    "daily": "daily",
    "journal": "journal",
    "scratch": "scratch",
    "cowork": "cowork-daily",   // overridden by sub-path below
    "finance": null,             // ambiguous: budget / paycheck / invoice
    "to-do": "to-do",
    "boards": "board",
};

function expandTilde(p) {
    if (!p) return p;
    if (p === "~" || p === "~/") return process.env.HOME || os.homedir();
    if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
    return p;
}

function parseArgs(args) {
    const out = {
        vault: null,
        blueprint: null,
        apply: false,
        dryRun: false,
        report: null,
        help: false,
    };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--help" || a === "-h") { out.help = true; }
        else if (a === "--vault") out.vault = expandTilde(args[++i]);
        else if (a.startsWith("--vault=")) out.vault = expandTilde(a.slice(8));
        else if (a === "--blueprint") out.blueprint = args[++i];
        else if (a.startsWith("--blueprint=")) out.blueprint = a.slice(12);
        else if (a === "--apply") out.apply = true;
        else if (a === "--dry-run") out.dryRun = true;
        else if (a === "--report") out.report = expandTilde(args[++i]);
        else if (a.startsWith("--report=")) out.report = expandTilde(a.slice(9));
        else throw new Error(`unknown arg: ${a}`);
    }
    return out;
}

function resolveTargetVault(opts) {
    if (opts.vault) return path.resolve(opts.vault);
    const vaults = registry.list();
    if (vaults.length === 1) return vaults[0].path;
    if (vaults.length === 0) throw new Error("no vaults registered; pass --vault <path>");
    throw new Error(`multiple vaults registered (${vaults.length}); specify --vault`);
}

function readJsonSafe(absPath) {
    if (!fs.existsSync(absPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(absPath, "utf8"));
    } catch (e) {
        const err = new Error(`malformed JSON at ${absPath}: ${e.message}`);
        err.exitCode = 2;
        throw err;
    }
}

function loadMigrationSpec(workshopRoot) {
    const abs = path.join(workshopRoot, MIGRATION_SPEC_REL);
    const spec = readJsonSafe(abs);
    if (!spec) {
        const err = new Error(`migration spec missing: ${abs}`);
        err.exitCode = 2;
        throw err;
    }
    return spec;
}

function loadCanonicalVocab(workshopRoot) {
    const abs = path.join(workshopRoot, CANONICAL_VOCAB_REL);
    return readJsonSafe(abs) || {};
}

// ---------------------------------------------------------------------------
// Date coercion
// ---------------------------------------------------------------------------

const ISO_WITH_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

// Coerce a date-like string into ISO-8601 with TZ offset (e.g. -07:00).
// Supported inputs (per audit-inventory):
//   "YYYY-MM-DD"             → "YYYY-MM-DDT00:00:00<local-tz>"
//   "YYYY-MM-DD HH:mm"       → "YYYY-MM-DDTHH:mm:00<local-tz>"
//   "YYYY-MM-DD HH:mm:ss"    → "YYYY-MM-DDTHH:mm:ss<local-tz>"
//   "YYYY-MM-DDTHH:mm:ss"    → "YYYY-MM-DDTHH:mm:ss<local-tz>"
//   Already-canonical ISO+TZ → returned verbatim
// Returns the original string if shape is unrecognized (walker reports non_iso).
function coerceIsoWithTz(raw, dateNow) {
    if (typeof raw !== "string") return raw;
    const s = raw.trim();
    if (ISO_WITH_TZ_RE.test(s)) return s;

    const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return raw;
    const datePart = m[1];
    const hh = m[2] !== undefined ? m[2] : "00";
    const mm = m[3] !== undefined ? m[3] : "00";
    const ss = m[4] !== undefined ? m[4] : "00";

    // Local TZ offset at the date (handles DST correctly).
    const d = new Date(`${datePart}T${hh}:${mm}:${ss}`);
    if (isNaN(d.getTime())) return raw;
    return `${datePart}T${hh}:${mm}:${ss}${tzOffsetString(d)}`;
}

function tzOffsetString(d) {
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMin);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}:${mm}`;
}

function mtimeIsoWithTz(absPath) {
    try {
        const stat = fs.statSync(absPath);
        return `${stat.mtime.toISOString().slice(0, 19)}Z`;
    } catch (_e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Frontmatter parser (minimal; mirrors platform/audit/walker.js scope)
// ---------------------------------------------------------------------------

function splitFrontmatter(raw) {
    let r = raw;
    if (r.startsWith("﻿")) r = r.slice(1);
    if (!r.startsWith("---\n") && !r.startsWith("---\r\n")) {
        return { fm: null, fmRaw: "", body: r, eol: "\n" };
    }
    const eol = r.includes("\r\n") ? "\r\n" : "\n";
    const lines = r.split(/\r?\n/);
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---" || lines[i] === "...") { endIdx = i; break; }
    }
    if (endIdx === -1) return { fm: null, fmRaw: "", body: r, eol };
    const fmLines = lines.slice(1, endIdx);
    const bodyLines = lines.slice(endIdx + 1);
    return {
        fm: fmLines,
        fmRaw: fmLines.join(eol),
        body: bodyLines.join(eol),
        eol,
    };
}

// Parses a list of frontmatter lines (between --- delimiters) into a plain object.
// Top-level mapping keys only, scalar or list-of-scalar values. Throws on shapes
// outside that scope (the migrator surfaces the error per-file in dry-run mode
// and halts on apply; same posture as the audit walker).
function parseFrontmatterYaml(fmLines) {
    const out = {};
    let i = 0;
    while (i < fmLines.length) {
        const line = fmLines[i];
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) { i++; continue; }
        if (/^\s/.test(line)) {
            throw new Error(`unexpected indented line at top level: ${JSON.stringify(line)}`);
        }
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (!m) throw new Error(`unrecognized line: ${JSON.stringify(line)}`);
        const key = m[1];
        const inlineRaw = stripInlineComment(m[2]);
        if (inlineRaw.length > 0) {
            out[key] = coerceScalar(inlineRaw);
            i++;
            continue;
        }
        i++;
        const list = [];
        let sawListItem = false;
        while (i < fmLines.length) {
            const sub = fmLines[i];
            const subTrim = sub.trim();
            if (subTrim === "" || subTrim.startsWith("#")) { i++; continue; }
            if (!/^\s/.test(sub)) break;
            const itemMatch = sub.match(/^\s+-\s*(.*)$/);
            if (itemMatch) {
                sawListItem = true;
                list.push(coerceScalar(itemMatch[1].trim()));
                i++;
                continue;
            }
            if (/^\s+[A-Za-z_]/.test(sub)) {
                throw new Error(`key '${key}' has nested mapping — unsupported`);
            }
            throw new Error(`unrecognized indented line under '${key}': ${JSON.stringify(sub)}`);
        }
        out[key] = sawListItem ? list : null;
    }
    return out;
}

function stripInlineComment(s) {
    let inSingle = false, inDouble = false, escaped = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\" && inDouble) { escaped = true; continue; }
        if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === "#" && !inSingle && !inDouble) {
            if (i === 0 || /\s/.test(s[i - 1])) return s.slice(0, i).replace(/\s+$/, "");
        }
    }
    return s.replace(/\s+$/, "");
}

function coerceScalar(raw) {
    const s = raw.trim();
    if (s === "") return null;
    if (/^\[\s*\]$/.test(s)) return [];
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1).replace(/\\(["\\nrt])/g, (_m, ch) => ({
            n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"',
        })[ch] || ch);
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (s === "null" || s === "Null" || s === "NULL" || s === "~") return null;
    if (/^-?\d+$/.test(s)) {
        const n = parseInt(s, 10);
        if (Number.isSafeInteger(n)) return n;
    }
    return s;
}

// ---------------------------------------------------------------------------
// Transform computation
// ---------------------------------------------------------------------------

// Returns an array of `op` records describing changes to apply to the
// frontmatter block. Each op is one logical change; multiple ops may apply
// to one file. Op shape:
//   { kind: "rename_key",       from, to }                                  // simple rename
//   { kind: "rename_wrap_list", from, to }                                  // rename + wrap scalar in list
//   { kind: "set_value",        key, newValue }                             // reformat scalar
//   { kind: "filter_list",      key, drop: [string], keep: [string] }       // tag cleanup
//   { kind: "quote_list_items", key }                                       // wikilink quote on list-of-string
//   { kind: "append_key",       key, value }                                // backfill (append at end of fm)
function computeTransforms(frontmatter, migrationSpec, opts) {
    const ops = [];
    const fm = frontmatter || {};
    const fmType = typeof fm.type === "string" ? fm.type : null;

    // 1. Renames
    for (const r of (migrationSpec.renames || [])) {
        if (!(r.from in fm)) continue;
        if (r.scope && r.scope.type && fmType !== r.scope.type) continue;
        if (r.coerce === "wrap-as-list") {
            ops.push({ kind: "rename_wrap_list", from: r.from, to: r.to });
        } else if (r.coerce === "iso8601-with-tz") {
            const cur = fm[r.from];
            if (typeof cur === "string") {
                const coerced = coerceIsoWithTz(cur, new Date());
                if (coerced !== cur) {
                    ops.push({ kind: "rename_key", from: r.from, to: r.to });
                    ops.push({ kind: "set_value", key: r.to, newValue: coerced });
                } else {
                    ops.push({ kind: "rename_key", from: r.from, to: r.to });
                }
            } else {
                ops.push({ kind: "rename_key", from: r.from, to: r.to });
            }
        } else {
            ops.push({ kind: "rename_key", from: r.from, to: r.to });
        }
    }

    // 2. Date reformat (skip keys that were just renamed-with-coerce; their target value was already handled)
    const renameTargetsCoerced = new Set();
    for (const r of (migrationSpec.renames || [])) {
        if (r.coerce === "iso8601-with-tz") renameTargetsCoerced.add(r.to);
    }
    for (const key of (migrationSpec.date_reformat || [])) {
        if (renameTargetsCoerced.has(key)) continue;
        // Also: if this key is the SOURCE of a rename, the value was handled there
        const isRenameSource = (migrationSpec.renames || []).some(r => r.from === key);
        if (isRenameSource) continue;
        if (!(key in fm) || typeof fm[key] !== "string") continue;
        const coerced = coerceIsoWithTz(fm[key], new Date());
        if (coerced !== fm[key]) {
            ops.push({ kind: "set_value", key, newValue: coerced });
        }
    }

    // 3. Tag cleanup
    if (Array.isArray(fm.tags) && migrationSpec.tag_cleanup) {
        const tc = migrationSpec.tag_cleanup;
        const stripDisc = new Set(tc.strip_discriminator || []);
        const tempRes = (tc.strip_temporal_patterns || []).map(p => new RegExp(p));
        const preserve = new Set(tc.preserve || []);
        const drop = [];
        for (const tag of fm.tags) {
            if (typeof tag !== "string") continue;
            if (preserve.has(tag)) continue;
            if (stripDisc.has(tag)) { drop.push(tag); continue; }
            if (tempRes.some(re => re.test(tag))) { drop.push(tag); continue; }
        }
        if (drop.length > 0) ops.push({ kind: "filter_list", key: "tags", drop });
    }

    // 4. Wikilink quoting
    for (const key of (migrationSpec.wikilink_quote_keys || [])) {
        if (!(key in fm)) continue;
        if (!Array.isArray(fm[key])) continue;
        const needsQuote = fm[key].some(v => typeof v === "string" && /^\[\[.+\]\]$/.test(v));
        if (needsQuote) ops.push({ kind: "quote_list_items", key });
    }

    // 5. Backfill type (inferred from path; only if missing)
    if (!("type" in fm) || fm.type === null || fm.type === undefined) {
        const inferred = inferTypeFromPath(opts.relPath);
        if (inferred) {
            ops.push({ kind: "append_key", key: "type", value: inferred });
        }
    }

    // 6. Backfill created_at (from file mtime; only if BOTH created_at and created are missing)
    if (!("created_at" in fm) && !("created" in fm)) {
        const mtime = mtimeIsoWithTz(opts.absPath);
        if (mtime) ops.push({ kind: "append_key", key: "created_at", value: mtime });
    }

    return ops;
}

function inferTypeFromPath(relPath) {
    const m = relPath.match(/^spice\/([^/]+)/);
    if (!m) return null;
    const moduleDir = m[1];
    const t = PATH_TO_TYPE[moduleDir];
    if (t !== undefined) return t;
    return null;
}

// ---------------------------------------------------------------------------
// Op application (line-based edits within the frontmatter block)
// ---------------------------------------------------------------------------

function applyOpsToFmLines(fmLines, ops) {
    let lines = fmLines.slice();

    for (const op of ops) {
        if (op.kind === "rename_key") {
            const idx = findKeyLineIdx(lines, op.from);
            if (idx === -1) continue;
            lines[idx] = lines[idx].replace(
                new RegExp(`^(\\s*)${escapeRegex(op.from)}(\\s*:)`),
                `$1${op.to}$2`
            );
        } else if (op.kind === "rename_wrap_list") {
            const idx = findKeyLineIdx(lines, op.from);
            if (idx === -1) continue;
            // Match: `from: <value>` → split into `to:\n  - <value>`
            const m = lines[idx].match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
            if (!m) continue;
            const indent = m[1];
            const value = m[3];
            const newLines = [
                `${indent}${op.to}:`,
                `${indent}  - ${value || ""}`.trimEnd(),
            ];
            lines.splice(idx, 1, ...newLines);
        } else if (op.kind === "set_value") {
            const idx = findKeyLineIdx(lines, op.key);
            if (idx === -1) continue;
            // Replace inline value (only inline form supported here; date-reformat
            // targets are always inline scalars).
            const m = lines[idx].match(/^(\s*[A-Za-z_][A-Za-z0-9_-]*\s*:\s*)(.*)$/);
            if (!m) continue;
            const valStr = formatScalarForYaml(op.newValue);
            lines[idx] = `${m[1]}${valStr}`;
        } else if (op.kind === "filter_list") {
            const idx = findKeyLineIdx(lines, op.key);
            if (idx === -1) continue;
            const dropSet = new Set(op.drop);
            // Two list shapes: inline (`tags: [a, b]`) or block (`tags:\n  - a\n  - b`).
            const inlineMatch = lines[idx].match(/^(\s*[A-Za-z_][A-Za-z0-9_-]*\s*:\s*)\[(.*)\]\s*$/);
            if (inlineMatch) {
                const items = inlineMatch[2].split(",").map(s => s.trim()).filter(s => s.length > 0);
                const stripped = stripDropItems(items, dropSet);
                lines[idx] = `${inlineMatch[1]}[${stripped.join(", ")}]`;
            } else {
                // Block form: scan subsequent indented `  - X` lines, drop matches.
                let j = idx + 1;
                while (j < lines.length) {
                    const sub = lines[j];
                    if (!/^\s+-\s/.test(sub) && sub.trim() !== "") break;
                    const itemMatch = sub.match(/^\s+-\s*(.*)$/);
                    if (itemMatch) {
                        const itemVal = coerceScalar(itemMatch[1].trim());
                        if (typeof itemVal === "string" && dropSet.has(itemVal)) {
                            lines.splice(j, 1);
                            continue;
                        }
                    }
                    j++;
                }
            }
        } else if (op.kind === "quote_list_items") {
            const idx = findKeyLineIdx(lines, op.key);
            if (idx === -1) continue;
            // Block form: rewrite each `  - [[X]]` → `  - "[[X]]"` if unquoted.
            let j = idx + 1;
            while (j < lines.length) {
                const sub = lines[j];
                if (!/^\s+-\s/.test(sub) && sub.trim() !== "") break;
                const m = sub.match(/^(\s+-\s*)(\[\[.+\]\])\s*$/);
                if (m) {
                    lines[j] = `${m[1]}"${m[2]}"`;
                }
                j++;
            }
            // Inline form: rewrite [[X]] → "[[X]]" in `key: [[[X]], ...]` value.
            const inlineMatch = lines[idx].match(/^(\s*[A-Za-z_][A-Za-z0-9_-]*\s*:\s*\[)(.*)(\]\s*)$/);
            if (inlineMatch) {
                const inner = inlineMatch[2].split(",").map(s => s.trim());
                const quoted = inner.map(s => {
                    if (/^\[\[.+\]\]$/.test(s)) return `"${s}"`;
                    return s;
                });
                lines[idx] = `${inlineMatch[1]}${quoted.join(", ")}${inlineMatch[3]}`;
            }
        } else if (op.kind === "append_key") {
            const valStr = formatScalarForYaml(op.value);
            lines.push(`${op.key}: ${valStr}`);
        }
    }

    return lines;
}

function findKeyLineIdx(lines, key) {
    const re = new RegExp(`^\\s*${escapeRegex(key)}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) return i;
    }
    return -1;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripDropItems(items, dropSet) {
    return items.filter(item => {
        const coerced = coerceScalar(item);
        return !(typeof coerced === "string" && dropSet.has(coerced));
    });
}

// Renders a scalar value as a YAML inline token.
// Strings containing wikilink shape or special chars are double-quoted; bare
// alphanumerics are emitted unquoted. Dates already include `:` so always quote.
function formatScalarForYaml(value) {
    if (value === null) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    if (typeof value === "string") {
        // Always quote: contains `:` or `#` or starts with `[[` or contains comma or quotes
        if (/[":#,]/.test(value) || value.startsWith("[[") || value.includes("'") || /^\s|\s$/.test(value)) {
            return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
        }
        return value;
    }
    return String(value);
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

function walkVaultMd(vaultPath, blueprintFilter) {
    const out = [];
    const root = blueprintFilter
        ? path.join(vaultPath, "spice", blueprintToDir(blueprintFilter))
        : path.join(vaultPath, "spice");
    if (!fs.existsSync(root)) return out;
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (_e) { continue; }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) stack.push(full);
            else if (ent.isFile() && ent.name.endsWith(".md")) out.push(full);
        }
    }
    return out;
}

function blueprintToDir(name) {
    // Same map as audit walker — handle blueprint slug → spice dir.
    if (name === "project") return "projects";
    return name;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function applyChanges(vaultPath, absPath, originalRaw, newRaw, timestamp) {
    const relPath = path.relative(vaultPath, absPath).split(path.sep).join("/");
    const basename = path.basename(absPath);
    const backupDir = path.join(vaultPath, ".sauce-backup", relPath, timestamp);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, basename), originalRaw);
    fs.writeFileSync(absPath, newRaw);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderReport(fileResults, migrationSpec, vaultPath, mode) {
    const now = new Date();
    const tsIso = `${now.toISOString().slice(0, 19)}${tzOffsetString(now)}`;
    const groups = {};
    let withChanges = 0;
    let parseErrors = 0;
    for (const r of fileResults) {
        const m = r.relPath.match(/^spice\/([^/]+)/);
        const bp = m ? m[1] : "other";
        if (!groups[bp]) groups[bp] = { count: 0, changed: 0, errors: 0 };
        groups[bp].count++;
        if (r.error) { groups[bp].errors++; parseErrors++; }
        else if (r.ops && r.ops.length > 0) { groups[bp].changed++; withChanges++; }
    }

    const lines = [];
    lines.push("# Sauce migration report — frontmatter alignment");
    lines.push("");
    lines.push(`- **Generated:** ${tsIso}`);
    lines.push(`- **Migration version:** ${migrationSpec.version || "(unknown)"}`);
    lines.push(`- **Vault:** \`${vaultPath}\``);
    lines.push(`- **Mode:** ${mode}`);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Total files scanned: ${fileResults.length}`);
    lines.push(`- Files with proposed changes: ${withChanges}`);
    lines.push(`- Parse errors: ${parseErrors}`);
    lines.push("");
    lines.push("## By blueprint");
    lines.push("");
    const sortedGroups = Object.keys(groups).sort();
    for (const bp of sortedGroups) {
        const g = groups[bp];
        lines.push(`- **${bp}**: ${g.count} scanned / ${g.changed} changed / ${g.errors} parse errors`);
    }
    lines.push("");
    lines.push("## Proposed changes by file");
    lines.push("");
    let any = false;
    for (const r of fileResults) {
        if (r.error) {
            any = true;
            lines.push(`### ${r.relPath}`);
            lines.push("");
            lines.push(`- ❗ parse error: ${r.error}`);
            lines.push("");
            continue;
        }
        if (!r.ops || r.ops.length === 0) continue;
        any = true;
        lines.push(`### ${r.relPath}`);
        lines.push("");
        for (const op of r.ops) {
            lines.push(`- ${renderOpDescription(op)}`);
        }
        lines.push("");
    }
    if (!any) {
        lines.push("_No changes proposed; vault is canonical._");
        lines.push("");
    }
    return lines.join("\n") + "\n";
}

function renderOpDescription(op) {
    switch (op.kind) {
        case "rename_key":       return `rename \`${op.from}\` → \`${op.to}\``;
        case "rename_wrap_list": return `rename \`${op.from}\` → \`${op.to}\` (wrap scalar as list)`;
        case "set_value":        return `reformat \`${op.key}\` → \`${op.newValue}\``;
        case "filter_list":      return `drop \`${op.key}\` items: ${op.drop.map(t => `\`${t}\``).join(", ")}`;
        case "quote_list_items": return `quote bare wikilinks in \`${op.key}\``;
        case "append_key":       return `backfill \`${op.key}: ${op.value}\``;
        default:                 return `unknown op: ${JSON.stringify(op)}`;
    }
}

// ---------------------------------------------------------------------------
// Core runner (callable from CLI + tests)
// ---------------------------------------------------------------------------

function runMigration({ vaultPath, workshopRoot, blueprint, apply, reportPath, log }) {
    log = log || (() => {});
    const migrationSpec = loadMigrationSpec(workshopRoot);
    const canonicalVocab = loadCanonicalVocab(workshopRoot);

    const targets = walkVaultMd(vaultPath, blueprint);
    const fileResults = [];

    for (const absPath of targets) {
        const relPath = path.relative(vaultPath, absPath).split(path.sep).join("/");
        let raw;
        try { raw = fs.readFileSync(absPath, "utf8"); }
        catch (e) {
            fileResults.push({ absPath, relPath, error: `read failed: ${e.message}` });
            if (apply) {
                const err = new Error(`failed to read ${absPath}: ${e.message}`);
                err.exitCode = 2;
                throw err;
            }
            continue;
        }
        const split = splitFrontmatter(raw);
        if (split.fm === null) continue; // no frontmatter → nothing to migrate

        let fm;
        try { fm = parseFrontmatterYaml(split.fm); }
        catch (e) {
            fileResults.push({ absPath, relPath, error: e.message });
            if (apply) {
                const err = new Error(`YAML parse error in ${relPath}: ${e.message}`);
                err.exitCode = 2;
                throw err;
            }
            continue;
        }

        const ops = computeTransforms(fm, migrationSpec, { absPath, relPath });
        if (ops.length === 0) continue;

        fileResults.push({ absPath, relPath, ops, frontmatter: fm });
    }

    if (apply) {
        const ts = `${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
        let applied = 0;
        for (const r of fileResults) {
            if (!r.ops || r.ops.length === 0) continue;
            const raw = fs.readFileSync(r.absPath, "utf8");
            const split = splitFrontmatter(raw);
            const newFmLines = applyOpsToFmLines(split.fm, r.ops);
            const newRaw = `---${split.eol}${newFmLines.join(split.eol)}${split.eol}---${split.eol}${split.body}`;
            applyChanges(vaultPath, r.absPath, raw, newRaw, ts);
            applied++;
        }
        log(`apply: ${applied} files rewritten; backups under .sauce-backup/`);
    } else {
        const out = reportPath || path.join(vaultPath, "sauce-migration-report.md");
        const md = renderReport(fileResults, migrationSpec, vaultPath, "dry-run");
        fs.writeFileSync(out, md);
        const withChanges = fileResults.filter(r => r.ops && r.ops.length > 0).length;
        const errors = fileResults.filter(r => r.error).length;
        log(`dry-run report: ${out} (${withChanges} files would change, ${errors} parse errors)`);
    }

    return { fileResults, migrationSpec, canonicalVocab };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

async function run(ctx, args) {
    const opts = parseArgs(args || []);
    if (opts.help) {
        console.log("usage: sauce migrate-frontmatter [--vault <path>] [--blueprint <name>] [--apply] [--dry-run] [--report <path>]");
        console.log("");
        console.log("Applies the v0.53-frontmatter.json migration spec to vault notes.");
        console.log("Default = dry-run; writes <vault>/sauce-migration-report.md.");
        console.log("--apply rewrites in-place with .sauce-backup/<rel>/<ts>/ sidecar.");
        return;
    }
    const vaultPath = resolveTargetVault(opts);
    const workshopRoot = ctx && ctx._sauceDir
        ? path.resolve(ctx._sauceDir, "..")
        : path.resolve(__dirname, "..", "..");
    const apply = opts.apply && !opts.dryRun;
    runMigration({
        vaultPath,
        workshopRoot,
        blueprint: opts.blueprint,
        apply,
        reportPath: opts.report,
        log: (msg) => console.log(msg),
    });
}

module.exports = {
    run,
    // Test exports — pure functions for run-migrate-frontmatter.js.
    _parseArgs: parseArgs,
    _coerceIsoWithTz: coerceIsoWithTz,
    _splitFrontmatter: splitFrontmatter,
    _parseFrontmatterYaml: parseFrontmatterYaml,
    _computeTransforms: computeTransforms,
    _applyOpsToFmLines: applyOpsToFmLines,
    _runMigration: runMigration,
    _inferTypeFromPath: inferTypeFromPath,
    _formatScalarForYaml: formatScalarForYaml,
};
