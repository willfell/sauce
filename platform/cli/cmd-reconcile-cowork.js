// platform/cli/cmd-reconcile-cowork.js
//
// `sauce reconcile-cowork` CLI verb (v0.97.0).
//
// Nightly reconciliation for cowork atomic notes. Walks atomic notes +
// sidecars across configured vaults; backfills missing .cowork.json
// companions; updates learned_weights frontmatter; runs check-heartbeat;
// appends per-vault reconciler-log entry.
//
// Flags:
//   --vault <path>       Process a single vault
//   --all-vaults         Process all vaults in ~/.sauce/vault-paths.json (default)
//   --engagement <id>    Limit to one engagement within the vault
//   --dry-run            Compute reconciliation but don't write
//   --install-launchd    Write + load the launchd plist (one-time setup)
//   --help               Show this help
//
// Both `run` and `dispatch` are exported and tolerate either signature:
//   run(ctx, argv)  — sauce-cli dispatcher path (ctx is the resolved context)
//   run(argv)       — direct/test invocation (single argv array)
//   dispatch(argv)  — alias for direct/test invocation

const path = require("node:path");

function printHelp() {
  console.log(`sauce reconcile-cowork — nightly reconciliation for cowork atomic notes

Usage:
  sauce reconcile-cowork [--vault <path>]       Process a single vault
  sauce reconcile-cowork [--all-vaults]         Process all vaults in ~/.sauce/vault-paths.json (default)
  sauce reconcile-cowork [--engagement <id>]    Limit to one engagement within the vault
  sauce reconcile-cowork [--dry-run]            Compute reconciliation but don't write
  sauce reconcile-cowork [--install-launchd]    Write + load the launchd plist (one-time setup)
  sauce reconcile-cowork --help                 Show this help

The reconciler:
  - Parses rating callouts from yesterday's atomic notes
  - Updates learned_weights in user-preferences.md (.bak written first)
  - Runs check-heartbeat against last 30 days of sidecars
  - Backfills missing .cowork.json sidecars from .md prose
  - Writes a reconciler-log entry per vault per night

Logs (when run via launchd): ~/Library/Logs/cowork-reconciler.{log,err}
`);
}

function parseArgs(argv) {
  const args = {
    vault: null,
    all_vaults: false,
    engagement: null,
    dry_run: false,
    install_launchd: false,
    help: false,
  };
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a === "--vault") {
      args.vault = list[++i];
    } else if (a.startsWith("--vault=")) {
      args.vault = a.slice("--vault=".length);
    } else if (a === "--all-vaults") {
      args.all_vaults = true;
    } else if (a === "--engagement") {
      args.engagement = list[++i];
    } else if (a.startsWith("--engagement=")) {
      args.engagement = a.slice("--engagement=".length);
    } else if (a === "--dry-run") {
      args.dry_run = true;
    } else if (a === "--install-launchd") {
      args.install_launchd = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    }
  }
  if (
    !args.vault &&
    !args.all_vaults &&
    !args.install_launchd &&
    !args.help
  ) {
    args.all_vaults = true;
  }
  return args;
}

// Normalize calling conventions: accept either (ctx, argv) or (argv).
function _resolveArgv(arg1, arg2) {
  if (Array.isArray(arg1)) return arg1;
  if (Array.isArray(arg2)) return arg2;
  return [];
}

async function run(arg1, arg2) {
  const argv = _resolveArgv(arg1, arg2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.install_launchd) {
    const installer = require("../mechanisms/cowork-reconciler/launchd-installer");
    return await installer.installLaunchd();
  }

  const reconciler = require("../mechanisms/cowork-reconciler");
  const { loadVaultPaths } = require("../helpers/vault-paths-registry-helper");

  let vaults = [];
  if (args.vault) {
    vaults = [{ path: args.vault, label: path.basename(args.vault) }];
  } else if (args.all_vaults) {
    const registry = loadVaultPaths();
    vaults = registry.vaults || [];
    if (vaults.length === 0) {
      console.error(
        "No vaults configured. Run `sauce update --bump-pins` from each consumer vault first, OR hand-edit ~/.sauce/vault-paths.json."
      );
      return 1;
    }
  }

  let totalErrors = 0;
  for (const v of vaults) {
    console.log(`\n=== Reconciling vault: ${v.label || path.basename(v.path)} (${v.path}) ===`);
    let result;
    try {
      result = await reconciler.reconcileVault({
        vault_path: v.path,
        dry_run: args.dry_run,
        engagement_filter: args.engagement,
      });
    } catch (err) {
      console.error(`  vault failed: ${err.message}`);
      totalErrors += 1;
      continue;
    }
    if (result && Array.isArray(result.errors) && result.errors.length) {
      totalErrors += result.errors.length;
      for (const e of result.errors) console.error(`  err: ${e}`);
    }
  }
  return totalErrors > 0 ? 1 : 0;
}

// Aliases for HC test compatibility — both `run` and `dispatch` work.
async function dispatch(arg1, arg2) {
  return await run(arg1, arg2);
}

module.exports = { run, dispatch, printHelp, parseArgs };
