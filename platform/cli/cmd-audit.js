// platform/cli/cmd-audit.js — `sauce audit` verb (v0.29.0; --claude-surface added v0.32.0 S7;
//                              --entity-create added v0.46.0 S3).
//
// Detection-only vault auditor. Three passes:
//
//   (1) Default rule-fragment pass (v0.29.0): walks the vault, applies
//       rule_fragments per blueprint, surfaces violations + untracked
//       top-level dirs.
//   (2) --claude-surface pass (v0.32.0 S7): walks ranch/claude-surface-registry.json
//       against the filesystem + bodies + workshop source to surface
//       dead_path / orphan / stale_but_valid / consumer_edit_at_risk drift.
//   (3) --entity-create pass (v0.46.0 S3): walks ranch/platform-installed.json +
//       ranch/scripts/<blueprint>/ to surface entity-create modularization drift:
//       manual_implementation_at_risk (HIGH) / escape_hatch_used (INFO) /
//       dead_path (MEDIUM). 4-level severity; JSON summary footer for skill parsers.
//
// All passes are READ-ONLY against the audited vault (landmine #21). The
// only optional write is the --output-file destination.

const path = require("path"), fs = require("fs");

exports._parseFlags = function(argv) {
    const flags = {
        vault: null,
        blueprint: null,
        outputFile: null,
        untrackedCheck: true,
        quiet: false,
        claudeSurface: false,
        entityCreate: false,
        frontmatterAlignment: false,
        workshopPath: null,
        strict: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--help" || a === "-h") flags.help = true;
        else if (a === "--vault") flags.vault = argv[++i];
        else if (a.startsWith("--vault=")) flags.vault = a.slice(8);
        else if (a === "--blueprint") flags.blueprint = argv[++i];
        else if (a.startsWith("--blueprint=")) flags.blueprint = a.slice(12);
        else if (a === "--output-file") flags.outputFile = argv[++i];
        else if (a.startsWith("--output-file=")) flags.outputFile = a.slice(14);
        else if (a === "--no-untracked-check") flags.untrackedCheck = false;
        else if (a === "--quiet") flags.quiet = true;
        else if (a === "--claude-surface") flags.claudeSurface = true;
        else if (a === "--entity-create") flags.entityCreate = true;
        else if (a === "--frontmatter-alignment") flags.frontmatterAlignment = true;
        else if (a === "--workshop") flags.workshopPath = argv[++i];
        else if (a.startsWith("--workshop=")) flags.workshopPath = a.slice(11);
        else if (a === "--strict") flags.strict = true;
    }
    return flags;
};

// Severity -> callout type for the markdown render.
const CS_SEVERITY_ORDER = ["dead_path", "orphan", "stale_but_valid", "consumer_edit_at_risk"];
const CS_SEVERITY_LABEL = {
    dead_path: "Dead paths (registry says exists; disk does not)",
    orphan: "Orphans (disk has it; registry never mentioned it)",
    stale_but_valid: "Stale but valid (body version comment != registry version)",
    consumer_edit_at_risk: "Consumer edits at risk (deployed body differs from source; no .local/ shadow)",
};

// Entity-create severity constants (v0.46.0 S3).
// HIGH / MEDIUM / INFO map to the 3 rule-fragment severities; aligned is the
// implicit 4th level (no finding emitted). Ordered from most severe to least.
const EC_SEVERITY_ORDER = ["manual_implementation_at_risk", "dead_path", "escape_hatch_used"];
const EC_SEVERITY_LABEL = {
    manual_implementation_at_risk: "Manual implementation at risk (HIGH) — New*Button class exists but no new_entity_buttons[] entry; migration incomplete",
    dead_path: "Dead paths (MEDIUM) — destination.folder_prefix or body_template does not resolve on disk",
    escape_hatch_used: "Escape hatch used (INFO) — New*Button class coexists with new_entity_buttons[]; intentional but requires justification",
};

// Frontmatter-alignment severity constants (v0.53.0 FA-1).
// HIGH = legacy_key_used + non_iso_timestamp; MEDIUM = unquoted_wikilink +
// missing_canonical_key; INFO = discriminator_tag_present + temporal_tag_present.
const FA_SEVERITY_ORDER = [
    "legacy_key_used",
    "non_iso_timestamp",
    "unquoted_wikilink",
    "missing_canonical_key",
    "discriminator_tag_present",
    "temporal_tag_present",
];
const FA_SEVERITY_LABEL = {
    legacy_key_used: "Legacy key used (HIGH) — created / attending / singular-product; expected migration to canonical form",
    non_iso_timestamp: "Non-ISO timestamp (HIGH) — created_at value doesn't match ISO-8601 with TZ",
    unquoted_wikilink: "Unquoted wikilink (MEDIUM) — cross-ref value is bare [[X]] instead of \"[[X]]\"",
    missing_canonical_key: "Missing canonical key (MEDIUM) — note has type but no created_at",
    discriminator_tag_present: "Discriminator tag present (INFO) — tags contains a type discriminator that duplicates type:",
    temporal_tag_present: "Temporal tag present (INFO) — tags contains a date pattern",
};

function formatClaudeSurfaceReport(result) {
    const { findings, counts } = result;
    const lines = [];
    lines.push(`# sauce audit --claude-surface`);
    lines.push("");
    lines.push(`Counts: dead_path=${counts.dead_path}, orphan=${counts.orphan}, stale_but_valid=${counts.stale_but_valid}, consumer_edit_at_risk=${counts.consumer_edit_at_risk}, aligned=${counts.aligned}`);
    lines.push("");
    for (const sev of CS_SEVERITY_ORDER) {
        const rows = findings.filter(f => f.severity === sev);
        if (rows.length === 0) continue;
        lines.push(`## ${sev} (${rows.length})`);
        lines.push("");
        lines.push(`_${CS_SEVERITY_LABEL[sev]}_`);
        lines.push("");
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            lines.push(`${i + 1}. \`${r.path}\` — ${r.message}`);
        }
        lines.push("");
    }
    if (findings.length === 0) {
        lines.push(`No drift detected. ${counts.aligned} aligned entries.`);
        lines.push("");
    }
    // JSON summary line for the skill parser.
    lines.push(`<!-- summary:${JSON.stringify({ counts, findings_total: findings.length })} -->`);
    return lines.join("\n") + "\n";
}

function formatFrontmatterAlignmentReport(result) {
    const { findings, counts } = result;
    const lines = [];
    lines.push(`# sauce audit --frontmatter-alignment`);
    lines.push("");
    lines.push(`Counts: legacy_key_used=${counts.legacy_key_used}, non_iso_timestamp=${counts.non_iso_timestamp}, unquoted_wikilink=${counts.unquoted_wikilink}, missing_canonical_key=${counts.missing_canonical_key}, discriminator_tag_present=${counts.discriminator_tag_present}, temporal_tag_present=${counts.temporal_tag_present}, aligned=${counts.aligned}`);
    lines.push("");
    for (const sev of FA_SEVERITY_ORDER) {
        const rows = findings.filter(f => f.severity === sev);
        if (rows.length === 0) continue;
        lines.push(`## ${sev} (${rows.length})`);
        lines.push("");
        lines.push(`_${FA_SEVERITY_LABEL[sev]}_`);
        lines.push("");
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            lines.push(`${i + 1}. \`${r.path}\` — ${r.message}`);
        }
        lines.push("");
    }
    if (findings.length === 0) {
        lines.push(`No frontmatter-alignment drift detected. ${counts.aligned} aligned notes.`);
        lines.push("");
    }
    lines.push(`<!-- frontmatter-alignment-summary:${JSON.stringify({ counts, findings_total: findings.length })} -->`);
    return lines.join("\n") + "\n";
}

function formatEntityCreateReport(result) {
    const { findings, counts } = result;
    const lines = [];
    lines.push(`# sauce audit --entity-create`);
    lines.push("");
    // v0.46.0 S3 follow-up (I4): surface unverifiable count alongside aligned.
    // Defaults to 0 for backwards-compat with older walker outputs that don't
    // emit the field.
    const unverifiable = (counts && typeof counts.unverifiable === "number") ? counts.unverifiable : 0;
    lines.push(`Counts: manual_implementation_at_risk=${counts.manual_implementation_at_risk}, dead_path=${counts.dead_path}, escape_hatch_used=${counts.escape_hatch_used}, aligned=${counts.aligned}, unverifiable=${unverifiable}`);
    lines.push("");
    for (const sev of EC_SEVERITY_ORDER) {
        const rows = findings.filter(f => f.severity === sev);
        if (rows.length === 0) continue;
        lines.push(`## ${sev} (${rows.length})`);
        lines.push("");
        lines.push(`_${EC_SEVERITY_LABEL[sev]}_`);
        lines.push("");
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            lines.push(`${i + 1}. \`${r.path}\` — ${r.message}`);
        }
        lines.push("");
    }
    if (findings.length === 0) {
        lines.push(`No entity-create drift detected. ${counts.aligned} aligned entries.`);
        lines.push("");
    }
    // JSON summary footer for skill parsers.
    lines.push(`<!-- entity-create-summary:${JSON.stringify({ counts, findings_total: findings.length })} -->`);
    return lines.join("\n") + "\n";
}

exports._runForTest = async function({ vaultPath, blueprintFilter, outputFile, untrackedCheck, quiet, claudeSurface, entityCreate, frontmatterAlignment, workshopPath, strict }) {
    // Test entry-point used by run-audit.js / run-cli.js. Throws Error with
    // .exitCode set (1 = violations, 2 = error) instead of calling process.exit.
    const installedJsonPath = path.join(vaultPath, "ranch/platform-installed.json");
    if (!fs.existsSync(installedJsonPath)) {
        const e = new Error("not a sauce vault");
        e.exitCode = 2;
        throw e;
    }

    // Concatenate outputs from each requested pass; collect a single "has findings" flag.
    let combinedMd = "";
    let hasFindings = false;

    // (1) Default rule-fragment pass — runs unless an explicit pass flag is set alone.
    // To preserve original behavior, the default pass runs when none of the explicit
    // pass flags is set. When a specific flag is set, only that pass runs.
    const anyExplicitPass = claudeSurface || entityCreate || frontmatterAlignment;
    if (!anyExplicitPass) {
        const { runAudit } = require("../audit/walker");
        const { formatReport } = require("../audit/report");
        const result = await runAudit({ vaultPath, blueprintFilter, untrackedCheck });
        combinedMd += formatReport(result, vaultPath);
        if (result.violations.length > 0 || result.untracked.length > 0) hasFindings = true;
    } else if (claudeSurface) {
        const { walkClaudeSurface } = require("../mechanisms/audit/claude-surface-walker");
        const csResult = await walkClaudeSurface(vaultPath, { workshopPath });
        combinedMd += formatClaudeSurfaceReport(csResult);
        if (csResult.findings.length > 0) hasFindings = true;
    } else if (entityCreate) {
        const { walkEntityCreate } = require("../audit/entity-create-walker");
        const ecResult = await walkEntityCreate(vaultPath, { workshopPath });
        combinedMd += formatEntityCreateReport(ecResult);
        if (ecResult.findings.length > 0) hasFindings = true;
    } else if (frontmatterAlignment) {
        const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
        const faResult = await walkFrontmatterAlignment(vaultPath, { workshopPath });
        combinedMd += formatFrontmatterAlignmentReport(faResult);
        if (faResult.findings.length > 0) hasFindings = true;
    }

    let summary = null;
    if (outputFile) {
        if (!fs.existsSync(path.dirname(outputFile))) {
            const e = new Error("output dir missing");
            e.exitCode = 2;
            throw e;
        }
        fs.writeFileSync(outputFile, combinedMd);
        summary = `audit: written to ${outputFile}` + (hasFindings ? " (findings present)" : " (clean)");
        if (!quiet) process.stdout.write(summary + "\n");
    } else if (!quiet) {
        process.stdout.write(combinedMd);
    }

    // Exit-code semantics:
    //   Default pass: violations OR untracked → exit 1.
    //   --claude-surface pass: findings → exit 1 (legacy semantics). --strict
    //   is reserved for future opt-in stricter rules.
    if (hasFindings) {
        const e = new Error("findings");
        e.exitCode = 1;
        throw e;
    }
    return summary;
};

exports.run = async function(ctx, args) {
    const flags = exports._parseFlags(args);
    if (flags.help) {
        console.log(
            "usage: sauce audit [--vault <path>] [--blueprint <name>] [--output-file <path>]\n" +
            "                   [--no-untracked-check] [--quiet] [--strict]\n" +
            "                   [--claude-surface [--workshop <path>]]\n" +
            "                   [--entity-create] [--frontmatter-alignment]\n" +
            "\n" +
            "Passes (mutually exclusive; default = rule-fragment pass):\n" +
            "  (default)               Rule-fragment audit: blueprint conformance + untracked dirs.\n" +
            "  --claude-surface        Claude-surface drift: dead_path / orphan / stale_but_valid /\n" +
            "                          consumer_edit_at_risk.  --workshop <path> enables body-diff checks.\n" +
            "  --entity-create         Entity-create modularization drift:\n" +
            "                          manual_implementation_at_risk (HIGH) — New*Button class with no\n" +
            "                            new_entity_buttons[] declaration.\n" +
            "                          dead_path (MEDIUM) — folder_prefix or body_template unresolved.\n" +
            "                          escape_hatch_used (INFO) — New*Button + declaration coexist.\n" +
            "  --frontmatter-alignment Frontmatter canonical-vocab drift (v0.53.0+):\n" +
            "                          legacy_key_used (HIGH), non_iso_timestamp (HIGH),\n" +
            "                          unquoted_wikilink (MEDIUM), missing_canonical_key (MEDIUM),\n" +
            "                          discriminator_tag_present (INFO), temporal_tag_present (INFO).\n" +
            "\n" +
            "Exit codes: 0 = clean, 1 = findings, 2 = error."
        );
        return;
    }
    const vaultPath = flags.vault ? path.resolve(process.cwd(), flags.vault) : process.cwd();
    try {
        await exports._runForTest({
            vaultPath,
            blueprintFilter: flags.blueprint,
            outputFile: flags.outputFile ? path.resolve(process.cwd(), flags.outputFile) : null,
            untrackedCheck: flags.untrackedCheck,
            quiet: flags.quiet,
            claudeSurface: flags.claudeSurface,
            entityCreate: flags.entityCreate,
            frontmatterAlignment: flags.frontmatterAlignment,
            workshopPath: flags.workshopPath ? path.resolve(process.cwd(), flags.workshopPath) : null,
            strict: flags.strict,
        });
        process.exit(0);
    } catch (e) {
        if (!flags.quiet && e.exitCode !== 1) process.stderr.write(`error: ${e.message}\n`);
        process.exit(e.exitCode || 2);
    }
};
