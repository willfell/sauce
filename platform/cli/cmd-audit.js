// platform/cli/cmd-audit.js — `sauce audit` verb (v0.29.0; --claude-surface added v0.32.0 S7).
//
// Detection-only vault auditor. Two passes:
//
//   (1) Default rule-fragment pass (v0.29.0): walks the vault, applies
//       rule_fragments per blueprint, surfaces violations + untracked
//       top-level dirs.
//   (2) --claude-surface pass (v0.32.0 S7): walks ranch/claude-surface-registry.json
//       against the filesystem + bodies + workshop source to surface
//       dead_path / orphan / stale_but_valid / consumer_edit_at_risk drift.
//
// Both passes are READ-ONLY against the audited vault (landmine #21). The
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
        workshopPath: null,
        strict: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--vault") flags.vault = argv[++i];
        else if (a.startsWith("--vault=")) flags.vault = a.slice(8);
        else if (a === "--blueprint") flags.blueprint = argv[++i];
        else if (a.startsWith("--blueprint=")) flags.blueprint = a.slice(12);
        else if (a === "--output-file") flags.outputFile = argv[++i];
        else if (a.startsWith("--output-file=")) flags.outputFile = a.slice(14);
        else if (a === "--no-untracked-check") flags.untrackedCheck = false;
        else if (a === "--quiet") flags.quiet = true;
        else if (a === "--claude-surface") flags.claudeSurface = true;
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

exports._runForTest = async function({ vaultPath, blueprintFilter, outputFile, untrackedCheck, quiet, claudeSurface, workshopPath, strict }) {
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

    // (1) Default rule-fragment pass — always runs unless --claude-surface is set alone.
    // To preserve original behavior, the default pass runs when --claude-surface is
    // NOT set OR when both are requested. For now, --claude-surface ALONE skips
    // the default pass (concession: user can run both passes explicitly by omitting
    // --claude-surface to get default, or pass --claude-surface for the new pass).
    if (!claudeSurface) {
        const { runAudit } = require("../audit/walker");
        const { formatReport } = require("../audit/report");
        const result = await runAudit({ vaultPath, blueprintFilter, untrackedCheck });
        combinedMd += formatReport(result, vaultPath);
        if (result.violations.length > 0 || result.untracked.length > 0) hasFindings = true;
    } else {
        const { walkClaudeSurface } = require("../mechanisms/audit/claude-surface-walker");
        const csResult = await walkClaudeSurface(vaultPath, { workshopPath });
        combinedMd += formatClaudeSurfaceReport(csResult);
        if (csResult.findings.length > 0) hasFindings = true;
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
    const vaultPath = flags.vault ? path.resolve(process.cwd(), flags.vault) : process.cwd();
    try {
        await exports._runForTest({
            vaultPath,
            blueprintFilter: flags.blueprint,
            outputFile: flags.outputFile ? path.resolve(process.cwd(), flags.outputFile) : null,
            untrackedCheck: flags.untrackedCheck,
            quiet: flags.quiet,
            claudeSurface: flags.claudeSurface,
            workshopPath: flags.workshopPath ? path.resolve(process.cwd(), flags.workshopPath) : null,
            strict: flags.strict,
        });
        process.exit(0);
    } catch (e) {
        if (!flags.quiet && e.exitCode !== 1) process.stderr.write(`error: ${e.message}\n`);
        process.exit(e.exitCode || 2);
    }
};
