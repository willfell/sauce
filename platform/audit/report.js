// platform/audit/report.js — v0.29.0 S2.3.
//
// Public API:
//   exports.formatReport(result, vaultPath) → string (markdown)
//
// `result` shape (produced by walker.js + rule-runner.js):
//   {
//     violations: [{ file, blueprint, rule, severity, message }],
//     untracked:  [{ name, fileCount }],
//     warnings:   string[],
//     scanned:    number
//   }
//
// Output format: see Docs/plans/2026-05-08-v0.29.0-vault-audit-design.md
// Section 8 "Report shape (markdown)". Pure function — no filesystem
// writes. cmd-audit.js handles --output-file.

const fs = require("fs");
const path = require("path");

function readInstalledMeta(vaultPath) {
    const installedPath = path.join(vaultPath, "ranch/platform-installed.json");
    try {
        const raw = fs.readFileSync(installedPath, "utf8");
        const parsed = JSON.parse(raw);
        // Normalize blueprint entries: real consumer ranch/platform-installed.json uses
        // [{name, version, installed_at}, ...]; test fixtures use ["string", ...]. Accept both.
        const rawBps = Array.isArray(parsed.blueprints) ? parsed.blueprints : [];
        const blueprints = rawBps
            .map(b => (typeof b === "string" ? b : (b && b.name) || null))
            .filter(n => n !== null);
        return {
            workshopVersion: parsed.workshop_version || "unknown",
            blueprints
        };
    } catch (e) {
        return { workshopVersion: "unknown", blueprints: [] };
    }
}

function nowStamp() {
    // UTC timestamp in YYYY-MM-DD HH:mm form. ISO format like
    // "2026-05-08T14:32:05.123Z" → replace T with space, slice to 16
    // chars (drop seconds + ms + 'Z'). UTC keeps it consistent across
    // machines / timezones.
    return new Date().toISOString().replace("T", " ").slice(0, 16);
}

function escapeCell(s) {
    // Markdown table cells: pipes break the column count; newlines break
    // the row. Replace defensively so weird filenames / messages don't
    // corrupt the table.
    return String(s == null ? "" : s)
        .replace(/\|/g, "\\|")
        .replace(/\r?\n/g, " ");
}

exports.formatReport = function (result, vaultPath) {
    result = result || {};
    const violations = Array.isArray(result.violations) ? result.violations : [];
    const untracked = Array.isArray(result.untracked) ? result.untracked : [];
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];

    const meta = readInstalledMeta(vaultPath);
    const blueprintsList = meta.blueprints.length ? meta.blueprints.join(", ") : "(none)";

    const lines = [];
    lines.push(`# Audit report — ${vaultPath}`);
    lines.push("");
    lines.push(`**Date:** ${nowStamp()}`);
    lines.push(`**Workshop version:** ${meta.workshopVersion}`);
    lines.push(`**Vault platform-installed:** ${meta.workshopVersion}`);
    lines.push(`**Blueprints installed:** ${blueprintsList}`);
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- Violations: ${violations.length}`);
    lines.push(`- Untracked top-level dirs: ${untracked.length}`);
    lines.push("");

    if (violations.length === 0 && untracked.length === 0 && warnings.length === 0) {
        lines.push("Audit clean.");
        lines.push("");
    }

    // Untracked top-level directories — header always emitted (AU29
    // checks for the "## Untracked top-level directories" string), but
    // body only populated if any dirs surfaced.
    lines.push("## Untracked top-level directories");
    lines.push("");
    if (untracked.length === 0) {
        lines.push("(none)");
        lines.push("");
    } else {
        lines.push("| Directory | File count | Note |");
        lines.push("|---|---|---|");
        for (const u of untracked) {
            const name = escapeCell(u.name) + "/";
            const count = `${u.fileCount || 0} .md`;
            const note = "not in sanctioned set; review for migration residue or user-owned content";
            lines.push(`| ${name} | ${count} | ${note} |`);
        }
        lines.push("");
    }

    // Violations by blueprint — group + sort alphabetically.
    lines.push("## Violations by blueprint");
    lines.push("");
    if (violations.length === 0) {
        lines.push("No violations.");
        lines.push("");
    } else {
        const grouped = {};
        for (const v of violations) {
            const bp = v.blueprint || "(unknown)";
            if (!grouped[bp]) grouped[bp] = [];
            grouped[bp].push(v);
        }
        const blueprintNames = Object.keys(grouped).sort();
        for (const bp of blueprintNames) {
            const bucket = grouped[bp];
            // Stable sort within bucket: by (file, rule). Without this, fs.readdirSync ordering
            // varies across filesystems (alphabetical on macOS APFS, insertion-order on some Linux ext4)
            // — diffing reports across machines would show line-shuffles even when violations match.
            bucket.sort((a, b) => (a.file || "").localeCompare(b.file || "") || (a.rule || "").localeCompare(b.rule || ""));
            lines.push(`### ${bp} (${bucket.length} violation${bucket.length === 1 ? "" : "s"})`);
            lines.push("");
            lines.push("| File | Rule | Severity | Message |");
            lines.push("|---|---|---|---|");
            for (const v of bucket) {
                lines.push(
                    `| ${escapeCell(v.file)} | ${escapeCell(v.rule)} | ${escapeCell(v.severity)} | ${escapeCell(v.message)} |`
                );
            }
            lines.push("");
        }
    }

    if (warnings.length > 0) {
        lines.push("## Warnings");
        lines.push("");
        for (const w of warnings) {
            lines.push(`- ${w}`);
        }
        lines.push("");
    }

    return lines.join("\n");
};
