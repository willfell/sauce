// platform/audit/walker.js — vault filesystem walker for `sauce audit` (v0.29.0).
//
// Public API:
//   exports.runAudit(opts) → Promise<{
//     violations: [{file, blueprint, rule, severity, message}],
//     untracked: [{name, fileCount}],
//     warnings: [string],
//     scanned: number
//   }>
//
//   opts: {
//     vaultPath: string         (absolute path to vault root)
//     blueprintFilter: string   (when set, restricts walk to that one blueprint; null = all)
//     untrackedCheck: boolean   (when false, skip top-level untracked-dir scan)
//   }
//
// Behavior (per S2.1 plan contract):
//   1. Read <vaultPath>/ranch/platform-installed.json. If missing, throw with .exitCode=2.
//   2. Read installed.blueprints[]. If blueprintFilter set, intersect to that one.
//   3. For each installed blueprint, read <vaultPath>/ranch/rules/<bp>.json:
//      - missing → push warning ("rules file missing for <bp>: <path>") and continue.
//      - parse JSON. Extract `contributions` object. For each sourceName key, the value
//        is an ARRAY of fragments (post-S2.5 install.js array-support).
//      - if value is NOT array, wrap in [value] for backward read-compat.
//      - flatten all fragments into a single rules[] array per blueprint.
//   4. For each blueprint, recursively walk <vaultPath>/spice/<bp>/**/*.md:
//      - read each file; parse frontmatter (minimal inline YAML parser).
//      - if frontmatter parse fails: push violation {rule:"frontmatter_parse",
//        severity:"error", ...} and continue.
//      - pass {file, relPath, frontmatter, body, blueprint} to
//        ruleRunner.applyRules(rules, fileRecord) → push returned violations.
//   5. Untracked-dir scan (if untrackedCheck === true):
//      - read direct entries of <vaultPath>/. For each entry:
//        - if isDirectory() AND !sanctionedDirs.includes(entry.name):
//          - count .md files under that dir (recursive).
//          - push {name, fileCount} to untracked[].
//   6. Return aggregate result.
//
// CONSTRAINT (NEW landmine #21): walker MUST NOT write to <vaultPath>. Read-only.
// No fs.writeFileSync / fs.appendFileSync / fs.mkdirSync etc. with target inside vaultPath.
//
// YAML parser scope (per plan + design Section 5):
//   Supports: `key: value` (string scalars including quoted), `key:` followed by
//   `  - item` lines (lists), `key: true|false|null|<int>` (basic types),
//   empty frontmatter, no-frontmatter files. Conservative posture: ambiguous input
//   raises a parse error which becomes a frontmatter_parse violation.
//   Extraction to platform/lib/frontmatter.js deferred to v0.29.1 PATCH.

const fs = require("fs");
const path = require("path");
const sanctionedDirs = require("./sanctioned-dirs");
const ruleRunner = require("./rule-runner");

// Blueprint name → vault module directory under spice/.
// Where blueprint name (singular) ≠ vault directory (often plural).
// v0.29.1 carry: replace with `module_directory` field on each blueprint
// entry in ranch/platform-installed.json, populated by install.js at install time.
const BLUEPRINT_MODULE_DIRS = {
  project: "projects",
};

function blueprintToDir(bpName) {
  return BLUEPRINT_MODULE_DIRS[bpName] || bpName;
}

// Normalize installed.blueprints[] entry → string blueprint name.
// Real consumer ranch/platform-installed.json uses [{name, version, installed_at}, ...].
// Test fixtures use ["string", ...]. Accept both.
function blueprintName(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.name === "string") return entry.name;
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

exports.runAudit = async function (opts) {
    const vaultPath = opts && opts.vaultPath;
    const blueprintFilter = (opts && opts.blueprintFilter) || null;
    const untrackedCheck = !!(opts && opts.untrackedCheck);

    if (typeof vaultPath !== "string" || vaultPath.length === 0) {
        const e = new Error("walker.runAudit: vaultPath is required");
        e.exitCode = 2;
        throw e;
    }

    const violations = [];
    const untracked = [];
    const warnings = [];
    let scanned = 0;

    // ---- Phase 1: read platform-installed.json ----
    const installedPath = path.join(vaultPath, "ranch/platform-installed.json");
    if (!fs.existsSync(installedPath)) {
        const e = new Error(`platform-installed.json missing: ${installedPath}`);
        e.exitCode = 2;
        throw e;
    }
    let installed;
    try {
        installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
    } catch (err) {
        const e = new Error(`platform-installed.json malformed: ${err.message}`);
        e.exitCode = 2;
        throw e;
    }

    const rawBlueprints = Array.isArray(installed.blueprints) ? installed.blueprints.slice() : [];
    let blueprints = rawBlueprints.map(blueprintName).filter(n => n !== null);
    if (blueprintFilter) {
        blueprints = blueprints.filter(b => b === blueprintFilter);
    }

    // ---- Phase 2-4: per-blueprint rules + walk ----
    for (const bp of blueprints) {
        const rulesPath = path.join(vaultPath, "ranch/rules", `${bp}.json`);
        if (!fs.existsSync(rulesPath)) {
            warnings.push(`rules file missing for ${bp}: ${rulesPath}`);
            // Even with no rules, we still walk so untracked count of files is accurate
            // for downstream report. But the rules array is empty so applyRules() produces
            // no violations. (We still skip walking entirely if there are zero installed
            // expectations? — plan says "continue", which means we keep iterating
            // blueprints; the per-blueprint walk is contingent on having rules. We
            // skip the walk for this bp since there's nothing to apply.)
            continue;
        }

        let rulesJson;
        try {
            rulesJson = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
        } catch (err) {
            warnings.push(`rules file malformed for ${bp}: ${rulesPath} (${err.message})`);
            continue;
        }

        const rules = _flattenContributions(rulesJson && rulesJson.contributions);

        // ---- Phase 4: walk spice/<module_dir>/**/*.md ----
        // Use module_directory mapping; for project, blueprint name "project" → dir "projects".
        const moduleDir = blueprintToDir(bp);
        const bpRoot = path.join(vaultPath, "spice", moduleDir);
        if (!fs.existsSync(bpRoot)) continue;

        const mdFiles = _walkMdFiles(bpRoot);
        for (const absFile of mdFiles) {
            scanned++;
            const relPath = path.relative(vaultPath, absFile).split(path.sep).join("/");

            let raw;
            try {
                raw = fs.readFileSync(absFile, "utf8");
            } catch (err) {
                violations.push({
                    file: relPath,
                    blueprint: bp,
                    rule: "frontmatter_parse",
                    severity: "error",
                    message: `Failed to read file: ${err.message}`,
                });
                continue;
            }

            const split = _splitFrontmatter(raw);
            let frontmatter;
            try {
                frontmatter = split.fm === null ? {} : _parseFrontmatterYaml(split.fm);
            } catch (err) {
                violations.push({
                    file: relPath,
                    blueprint: bp,
                    rule: "frontmatter_parse",
                    severity: "error",
                    message: `Frontmatter YAML parse error: ${err.message}`,
                });
                continue;
            }

            const fileRecord = {
                file: absFile,
                relPath,
                frontmatter,
                body: split.body,
                blueprint: bp,
            };
            const fileViolations = ruleRunner.applyRules(rules, fileRecord);
            if (Array.isArray(fileViolations)) {
                for (const v of fileViolations) violations.push(v);
            }
        }
    }

    // ---- Phase 5: untracked-dir scan ----
    if (untrackedCheck) {
        let entries = [];
        try {
            entries = fs.readdirSync(vaultPath, { withFileTypes: true });
        } catch (err) {
            warnings.push(`failed to read vault root for untracked scan: ${err.message}`);
            entries = [];
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            if (sanctionedDirs.includes(ent.name)) continue;
            const sub = path.join(vaultPath, ent.name);
            const fileCount = _countMdFiles(sub);
            untracked.push({ name: ent.name, fileCount });
        }
    }

    return { violations, untracked, warnings, scanned };
};

// ---------------------------------------------------------------------------
// Rules flattening
// ---------------------------------------------------------------------------

// Flattens `contributions` map into a single rules[] array.
// Each value is either an array of fragments (post-S2.5 array-support) OR a
// single fragment (legacy single-fragment write OR foreign source) — wrapped in
// [value] for backward read-compat per S2.1 contract.
function _flattenContributions(contributions) {
    const out = [];
    if (!contributions || typeof contributions !== "object") return out;
    for (const sourceName of Object.keys(contributions)) {
        const v = contributions[sourceName];
        const fragments = Array.isArray(v) ? v : (v == null ? [] : [v]);
        for (const f of fragments) {
            if (f && typeof f === "object") out.push(f);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Filesystem walking (read-only)
// ---------------------------------------------------------------------------

// Recursively collects absolute paths to .md files under root.
// Returns [] if root doesn't exist.
function _walkMdFiles(root) {
    const out = [];
    if (!fs.existsSync(root)) return out;
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_e) {
            continue;
        }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile() && ent.name.endsWith(".md")) {
                out.push(full);
            }
        }
    }
    return out;
}

// Counts .md files under root (recursive). Returns 0 if root doesn't exist.
function _countMdFiles(root) {
    if (!fs.existsSync(root)) return 0;
    let count = 0;
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_e) {
            continue;
        }
        for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                stack.push(full);
            } else if (ent.isFile() && ent.name.endsWith(".md")) {
                count++;
            }
        }
    }
    return count;
}

// ---------------------------------------------------------------------------
// Frontmatter splitting
// ---------------------------------------------------------------------------

// Splits a markdown body into { fm: string[]|null, body: string }.
// fm is null when the file has no `---\n...---` frontmatter block.
// Empty-frontmatter case (`---\n---\n...`) returns fm = [] (empty array).
function _splitFrontmatter(raw) {
    if (raw.startsWith("﻿")) raw = raw.slice(1); // strip BOM
    if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
        return { fm: null, body: raw };
    }
    const lines = raw.split(/\r?\n/);
    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---" || lines[i] === "...") { endIdx = i; break; }
    }
    if (endIdx === -1) {
        // Opener but no closer — treat as no frontmatter to avoid false-confidence parse.
        return { fm: null, body: raw };
    }
    return {
        fm: lines.slice(1, endIdx),
        body: lines.slice(endIdx + 1).join("\n"),
    };
}

// ---------------------------------------------------------------------------
// Minimal YAML frontmatter parser
//
// Scope (intentionally narrow per design Section 5; deferred extraction):
//   - top-level mapping keys only (no nested mappings beyond list-of-strings)
//   - scalar value forms:
//       key: "double-quoted"
//       key: 'single-quoted'
//       key: bare-scalar
//       key:                       (null)
//       key: 42                    (number)
//       key: true | false          (boolean)
//       key: null | ~              (null)
//   - list-of-scalar form:
//       key:
//         - "item"
//         - bare
//   - blank lines and `# comment` lines are ignored at top level.
//
// Conservative on edge cases — any input that doesn't fit one of the supported
// shapes raises a parse error (caller converts to frontmatter_parse violation).
// ---------------------------------------------------------------------------

function _parseFrontmatterYaml(fmLines) {
    const out = {};
    let i = 0;
    while (i < fmLines.length) {
        const line = fmLines[i];
        const trimmed = line.trim();

        // Skip blanks and comments.
        if (trimmed === "" || trimmed.startsWith("#")) { i++; continue; }

        // Top-level key MUST start at column 0 (no leading whitespace).
        if (/^\s/.test(line)) {
            throw new Error(`unexpected indented line at top level: ${JSON.stringify(line)}`);
        }

        const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (!m) {
            throw new Error(`unrecognized line: ${JSON.stringify(line)}`);
        }
        const key = m[1];
        const inlineRaw = m[2];

        // Strip trailing comment from inline (only when not inside quotes).
        const inline = _stripInlineComment(inlineRaw);

        if (inline.length > 0) {
            // Inline value present. Look ahead — if next non-blank line is a list
            // item or an indented continuation, that's an ambiguity (mixing
            // inline scalar + child structure). Fail loud.
            const next = _peekNextSignificantLine(fmLines, i + 1);
            if (next !== null && /^\s+\S/.test(next)) {
                throw new Error(
                    `key '${key}' has inline value AND indented children — ambiguous`
                );
            }
            out[key] = _coerceScalar(inline);
            i++;
            continue;
        }

        // No inline value. Consume subsequent indented lines: they must all be
        // list items (`  - item`). Mixed mapping-children + list-items at same
        // key are rejected.
        i++;
        const list = [];
        let sawListItem = false;
        let sawMappingChild = false;
        while (i < fmLines.length) {
            const sub = fmLines[i];
            const subTrim = sub.trim();
            if (subTrim === "" || subTrim.startsWith("#")) { i++; continue; }
            if (!/^\s/.test(sub)) break; // back to top level
            const itemMatch = sub.match(/^\s+-\s*(.*)$/);
            if (itemMatch) {
                sawListItem = true;
                if (sawMappingChild) {
                    throw new Error(`key '${key}' mixes list items with mapping children`);
                }
                list.push(_coerceScalar(itemMatch[1].trim()));
                i++;
                continue;
            }
            // Indented but not a list item — treat as a mapping child, which
            // we don't support at this scope. Reject.
            if (/^\s+[A-Za-z_]/.test(sub)) {
                sawMappingChild = true;
                throw new Error(
                    `key '${key}' has nested mapping at sub-line ${JSON.stringify(sub)} — unsupported`
                );
            }
            throw new Error(`unrecognized indented line under '${key}': ${JSON.stringify(sub)}`);
        }
        if (sawListItem) {
            out[key] = list;
        } else {
            // No inline, no children → null
            out[key] = null;
        }
    }
    return out;
}

// Returns the next non-blank, non-comment line at index >= start, or null.
function _peekNextSignificantLine(lines, start) {
    for (let j = start; j < lines.length; j++) {
        const t = lines[j].trim();
        if (t === "" || t.startsWith("#")) continue;
        return lines[j];
    }
    return null;
}

// Strips a trailing `# comment` from an inline scalar fragment, but only when
// the `#` is outside any quoted region. Conservative: if quoting is unbalanced,
// leave the string as-is (caller's coerceScalar will error if malformed).
function _stripInlineComment(s) {
    let inSingle = false, inDouble = false, escaped = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\" && inDouble) { escaped = true; continue; }
        if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === "#" && !inSingle && !inDouble) {
            // Must be preceded by whitespace (or start) to count as a comment.
            if (i === 0 || /\s/.test(s[i - 1])) {
                return s.slice(0, i).replace(/\s+$/, "");
            }
        }
    }
    return s.replace(/\s+$/, "");
}

// Coerces a YAML scalar token (already trimmed) into a JS value.
//   "..."    → unescaped string
//   '...'    → string (single-quote: backslashes literal)
//   true     → true
//   false    → false
//   null | ~ → null
//   <integer>→ Number
//   else     → string (bare scalar, returned literally)
function _coerceScalar(raw) {
    const s = raw.trim();
    if (s === "") return null;

    // Inline empty list. Sauce templates emit `workstreams: []` for
    // present-but-empty list fields. Distinguish from `workstreams:` (null).
    // Tolerate inner whitespace (`[ ]`, `[  ]`) for hand-edited frontmatter.
    if (/^\[\s*\]$/.test(s)) return [];

    // Double-quoted
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return _unescapeDoubleQuoted(s.slice(1, -1));
    }
    // Single-quoted (single quotes inside escape via doubling)
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        return s.slice(1, -1).replace(/''/g, "'");
    }

    // Boolean / null reserved words (YAML 1.2 core schema, narrow set).
    if (s === "true" || s === "True" || s === "TRUE") return true;
    if (s === "false" || s === "False" || s === "FALSE") return false;
    if (s === "null" || s === "Null" || s === "NULL" || s === "~") return null;

    // Integer
    if (/^-?\d+$/.test(s)) {
        const n = parseInt(s, 10);
        if (Number.isSafeInteger(n)) return n;
    }

    // Bare scalar — return string literal
    return s;
}

function _unescapeDoubleQuoted(s) {
    return s.replace(/\\(["\\nrt])/g, (_m, ch) => {
        switch (ch) {
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "\\": return "\\";
            case "\"": return "\"";
            default: return ch;
        }
    });
}
