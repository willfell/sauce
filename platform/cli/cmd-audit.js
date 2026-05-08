// platform/cli/cmd-audit.js — `sauce audit` verb (v0.29.0).
//
// Detection-only vault auditor: walks a sauce vault, applies rule_fragments
// per blueprint, surfaces violations + untracked top-level dirs as a
// markdown report. READ-ONLY contract (NEW landmine #21): never writes
// inside the audited vault. The only optional write is the --output-file
// destination (caller-controlled path, must already exist as a directory).
//
// Stub posture (S1 RED): _parseFlags + _runForTest + run shells exist;
// they delegate to platform/audit/{walker,report}.js — modules NOT YET
// IMPLEMENTED. Tests that exercise only the parse + arg-validation paths
// (CA1-CA5 in run-cli.js) pass at S1; tests that reach into walker/report
// (run-audit.js AU1-AU32) fail at S1 with "Cannot find module" — that is
// the planned RED state. S2 implements the audit core.

const path = require("path"), fs = require("fs");

exports._parseFlags = function(argv) {
    const flags = { vault: null, blueprint: null, outputFile: null, untrackedCheck: true, quiet: false };
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
    }
    return flags;
};

exports._runForTest = async function({ vaultPath, blueprintFilter, outputFile, untrackedCheck, quiet }) {
    // Test entry-point used by run-audit.js. Throws Error with .exitCode set
    // (1 = violations, 2 = error) instead of calling process.exit so harness
    // can introspect.
    const installedJsonPath = path.join(vaultPath, "ranch/platform-installed.json");
    if (!fs.existsSync(installedJsonPath)) {
        const e = new Error("not a sauce vault");
        e.exitCode = 2;
        throw e;
    }
    const { runAudit } = require("../audit/walker");
    const { formatReport } = require("../audit/report");
    const result = await runAudit({ vaultPath, blueprintFilter, untrackedCheck });
    const md = formatReport(result, vaultPath);
    if (outputFile) {
        if (!fs.existsSync(path.dirname(outputFile))) {
            const e = new Error("output dir missing");
            e.exitCode = 2;
            throw e;
        }
        fs.writeFileSync(outputFile, md);
        const summary = `audit: ${result.violations.length} violations, ${result.untracked.length} untracked dirs — written to ${outputFile}`;
        if (!quiet) process.stdout.write(summary + "\n");
        return summary;
    } else if (!quiet) {
        process.stdout.write(md);
    }
    if (result.violations.length > 0 || result.untracked.length > 0) {
        const e = new Error("violations");
        e.exitCode = 1;
        throw e;
    }
    return null;
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
        });
        process.exit(0);
    } catch (e) {
        if (!flags.quiet && e.exitCode !== 1) process.stderr.write(`error: ${e.message}\n`);
        process.exit(e.exitCode || 2);
    }
};
