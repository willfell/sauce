// platform/audit/frontmatter-alignment-walker.js — v0.53.0 FA-1
//
// Walks every blueprint installed in ranch/platform-installed.json and inspects
// every spice/<module>/**/*.md note's frontmatter for drift away from the
// canonical vocabulary declared in platform/rules/_canonical-vocab.json.
//
// Emits a 6-severity report:
//   - legacy_key_used (HIGH)        Note has `created:` / `attending:` /
//                                   `product:` (singular on team). Expected
//                                   migration to canonical form
//                                   (created_at / people / products).
//   - non_iso_timestamp (HIGH)      `created_at` exists but its value doesn't
//                                   match the ISO-8601-with-TZ regex.
//   - unquoted_wikilink (MEDIUM)    Cross-ref key contains a bare `[[X]]`
//                                   instead of `"[[X]]"`.
//   - discriminator_tag_present (INFO)  `tags:` contains a type discriminator
//                                       (`meeting`, `person`, etc.).
//   - temporal_tag_present (INFO)   `tags:` contains a date pattern
//                                   (`YYYY/MM/DD`, `YYYY/MM`, `YYYY`).
//   - missing_canonical_key (MEDIUM)  Note has `type:` set but lacks the
//                                     canonical audit-triplet key `created_at:`.
//
// Plus one non-finding counter:
//   - aligned    Note has no findings.
//
// Read-only against the audited vault (landmine #21). Pure node module; no
// Obsidian dependency. Modeled on entity-create-walker.js (v0.46.0 S3).

"use strict";

const fs = require("fs");
const path = require("path");

const INSTALLED_REL = "ranch/platform-installed.json";
const CANONICAL_VOCAB_VAULT_REL = "ranch/rules/_canonical-vocab.json";
const CANONICAL_VOCAB_WORKSHOP_REL = "platform/rules/_canonical-vocab.json";

const ISO_WITH_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/;

// Blueprint name → vault module directory under spice/. Mirrors
// platform/audit/walker.js' BLUEPRINT_MODULE_DIRS map.
const BLUEPRINT_MODULE_DIRS = {
    project: "projects",
};

function blueprintToDir(name) {
    return BLUEPRINT_MODULE_DIRS[name] || name;
}

function fileExists(absPath) {
    try { return fs.statSync(absPath).isFile(); } catch (_e) { return false; }
}

function readJsonSafe(absPath) {
    try { return JSON.parse(fs.readFileSync(absPath, "utf8")); } catch (_e) { return null; }
}

function loadCanonicalVocab(vaultPath, workshopPath) {
    const candidates = [];
    if (vaultPath) candidates.push(path.join(vaultPath, CANONICAL_VOCAB_VAULT_REL));
    if (workshopPath) candidates.push(path.join(workshopPath, CANONICAL_VOCAB_WORKSHOP_REL));
    for (const p of candidates) {
        if (fileExists(p)) {
            const parsed = readJsonSafe(p);
            if (parsed && typeof parsed === "object") return parsed;
        }
    }
    return null;
}

// Minimal frontmatter split + parse (mirrors platform/audit/walker.js scope).
function splitFrontmatter(raw) {
    let r = raw;
    if (r.startsWith("﻿")) r = r.slice(1);
    if (!r.startsWith("---\n") && !r.startsWith("---\r\n")) return { fm: null, body: r };
    const lines = r.split(/\r?\n/);
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---" || lines[i] === "...") { endIdx = i; break; }
    }
    if (endIdx === -1) return { fm: null, body: r };
    return { fm: lines.slice(1, endIdx), bodyLines: lines.slice(endIdx + 1) };
}

function parseFrontmatterYaml(fmLines) {
    const out = {};
    let i = 0;
    while (i < fmLines.length) {
        const line = fmLines[i];
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) { i++; continue; }
        if (/^\s/.test(line)) throw new Error(`unexpected indented line: ${JSON.stringify(line)}`);
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (!m) throw new Error(`unrecognized line: ${JSON.stringify(line)}`);
        const key = m[1];
        const inline = stripInlineComment(m[2]);
        if (inline.length > 0) { out[key] = coerceScalar(inline); i++; continue; }
        i++;
        const list = [];
        let sawListItem = false;
        while (i < fmLines.length) {
            const sub = fmLines[i];
            if (sub.trim() === "" || sub.trim().startsWith("#")) { i++; continue; }
            if (!/^\s/.test(sub)) break;
            const itemMatch = sub.match(/^\s+-\s*(.*)$/);
            if (itemMatch) { sawListItem = true; list.push(coerceScalar(itemMatch[1].trim())); i++; continue; }
            if (/^\s+[A-Za-z_]/.test(sub)) throw new Error(`key '${key}' has nested mapping`);
            throw new Error(`unrecognized indented line: ${JSON.stringify(sub)}`);
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
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (s === "null" || s === "Null" || s === "NULL" || s === "~") return null;
    if (/^-?\d+$/.test(s)) {
        const n = parseInt(s, 10);
        if (Number.isSafeInteger(n)) return n;
    }
    return s;
}

function walkMdFiles(root) {
    const out = [];
    if (!fs.existsSync(root)) return out;
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { continue; }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) stack.push(full);
            else if (ent.isFile() && ent.name.endsWith(".md")) out.push(full);
        }
    }
    return out;
}

// Looks at the raw frontmatter block (not the parsed object) for a key's
// presence with an unquoted wikilink value under it. Our minimal parser can't
// represent the difference between `key:\n  - [[X]]` and `key:\n  - "[[X]]"`
// (both parse to the same string `[[X]]` since we strip outer quotes); we
// detect unquoted by scanning the raw lines instead.
function hasUnquotedWikilink(fmLines, key) {
    const keyRe = new RegExp(`^\\s*${key.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\s*:`);
    let inKey = false;
    for (const line of fmLines) {
        if (keyRe.test(line)) { inKey = true; continue; }
        if (inKey) {
            if (!/^\s/.test(line) && line.trim() !== "") break;
            const m = line.match(/^\s+-\s*(.*?)\s*$/);
            if (m) {
                const v = m[1];
                // Already-quoted starts with `"` or `'`
                if (v.startsWith('"') || v.startsWith("'")) continue;
                if (/^\[\[.+\]\]$/.test(v)) return v;
            }
        }
    }
    return null;
}

async function walkFrontmatterAlignment(vaultPath, opts) {
    opts = opts || {};
    const findings = [];
    const counts = {
        legacy_key_used: 0,
        non_iso_timestamp: 0,
        unquoted_wikilink: 0,
        discriminator_tag_present: 0,
        temporal_tag_present: 0,
        missing_canonical_key: 0,
        aligned: 0,
    };

    const installedAbs = path.join(vaultPath, INSTALLED_REL);
    if (!fileExists(installedAbs)) {
        throw Object.assign(
            new Error("Not a sauce vault: ranch/platform-installed.json missing"),
            { exitCode: 2 }
        );
    }
    const installed = readJsonSafe(installedAbs) || {};
    const blueprints = (installed.blueprints || []).map(b =>
        typeof b === "string" ? b : (b && typeof b === "object" ? b.name : null)
    ).filter(Boolean);

    const workshopPath = opts.workshopPath || path.resolve(__dirname, "..", "..");
    const vocab = loadCanonicalVocab(vaultPath, workshopPath);
    if (!vocab) {
        throw Object.assign(
            new Error(`canonical-vocab template missing: looked at ${vaultPath}/ranch/rules/_canonical-vocab.json and ${workshopPath}/platform/rules/_canonical-vocab.json`),
            { exitCode: 2 }
        );
    }

    const legacyKeys = vocab.legacy_keys || [];
    const wikilinkKeys = vocab.wikilink_keys || [];
    const discriminatorSet = new Set(vocab.discriminator_tags || []);
    const temporalRes = (vocab.temporal_tag_patterns || []).map(p => new RegExp(p));

    for (const bp of blueprints) {
        const moduleDir = blueprintToDir(bp);
        const root = path.join(vaultPath, "spice", moduleDir);
        if (!fs.existsSync(root)) continue;
        const mdFiles = walkMdFiles(root);
        for (const absFile of mdFiles) {
            const relPath = path.relative(vaultPath, absFile).split(path.sep).join("/");
            let raw;
            try { raw = fs.readFileSync(absFile, "utf8"); } catch (_e) { continue; }
            const split = splitFrontmatter(raw);
            if (split.fm === null) continue;
            let fm;
            try { fm = parseFrontmatterYaml(split.fm); }
            catch (_e) { continue; }

            const fileFindings = [];

            // 1. legacy_key_used
            for (const key of legacyKeys) {
                if (key in fm) {
                    fileFindings.push({
                        severity: "legacy_key_used",
                        path: relPath,
                        message: `legacy key '${key}' present; expected migration to canonical form`,
                    });
                }
            }
            // Singular `product:` on type:team is legacy (canonical = plural list).
            if ("product" in fm && fm.type === "team") {
                fileFindings.push({
                    severity: "legacy_key_used",
                    path: relPath,
                    message: `'product' singular on type:team; expected 'products' plural list`,
                });
            }

            // 2. non_iso_timestamp
            if (typeof fm.created_at === "string" && !ISO_WITH_TZ_RE.test(fm.created_at)) {
                fileFindings.push({
                    severity: "non_iso_timestamp",
                    path: relPath,
                    message: `created_at='${fm.created_at}' does not match ISO-8601-with-TZ`,
                });
            }

            // 3. unquoted_wikilink
            for (const key of wikilinkKeys) {
                if (!(key in fm)) continue;
                const v = hasUnquotedWikilink(split.fm, key);
                if (v) {
                    fileFindings.push({
                        severity: "unquoted_wikilink",
                        path: relPath,
                        message: `'${key}' contains unquoted wikilink ${v}`,
                    });
                    break; // one finding per file (avoid duplicate noise)
                }
            }

            // 4. discriminator_tag_present
            if (Array.isArray(fm.tags)) {
                for (const t of fm.tags) {
                    if (typeof t === "string" && discriminatorSet.has(t)) {
                        fileFindings.push({
                            severity: "discriminator_tag_present",
                            path: relPath,
                            message: `tags contains discriminator '${t}'`,
                        });
                        break;
                    }
                }
            }

            // 5. temporal_tag_present
            if (Array.isArray(fm.tags) && temporalRes.length > 0) {
                for (const t of fm.tags) {
                    if (typeof t === "string" && temporalRes.some(re => re.test(t))) {
                        fileFindings.push({
                            severity: "temporal_tag_present",
                            path: relPath,
                            message: `tags contains temporal pattern '${t}'`,
                        });
                        break;
                    }
                }
            }

            // 6. missing_canonical_key: type is set but created_at is absent.
            if (typeof fm.type === "string" && !("created_at" in fm)) {
                fileFindings.push({
                    severity: "missing_canonical_key",
                    path: relPath,
                    message: `type='${fm.type}' but missing canonical 'created_at'`,
                });
            }

            if (fileFindings.length === 0) {
                counts.aligned++;
            } else {
                for (const f of fileFindings) {
                    findings.push(f);
                    counts[f.severity]++;
                }
            }
        }
    }

    return { findings, counts };
}

module.exports = { walkFrontmatterAlignment };
