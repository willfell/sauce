// platform/mechanisms/cowork-reconciler/launchd-installer.js
//
// One-shot installer for the cowork-reconciler launchd job (macOS).
// Substitutes {{$user}}/{{$home}}/{{$sauce_path}} tokens into the
// plist template, writes to ~/Library/LaunchAgents/, then runs
// `launchctl unload -w` (defensive) and `launchctl load -w`.
//
// Invoked by `sauce reconcile-cowork --install-launchd`.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync } = require("node:child_process");

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Docs",
  "install",
  "cowork-reconciler-launchd.plist.template"
);

function _sauceBinPath() {
  try {
    const out = execSync("which sauce", { encoding: "utf8" }).trim();
    if (out) return out;
  } catch (_) {
    /* fallthrough */
  }
  // Common brew prefixes; the first one that exists wins.
  const candidates = ["/opt/homebrew/bin/sauce", "/usr/local/bin/sauce"];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) { /* ignore */ }
  }
  return "/opt/homebrew/bin/sauce";
}

async function installLaunchd() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Template not found at ${TEMPLATE_PATH}`);
    return 1;
  }
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const user = process.env.USER || os.userInfo().username;
  const home = os.homedir();
  const saucePath = _sauceBinPath();

  const populated = template
    .replaceAll("{{$user}}", user)
    .replaceAll("{{$home}}", home)
    .replaceAll("{{$sauce_path}}", saucePath);

  const plistPath = path.join(
    home,
    "Library/LaunchAgents",
    `com.${user}.cowork-reconciler.plist`
  );
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  fs.writeFileSync(plistPath, populated, "utf8");
  console.log(`Wrote launchd plist: ${plistPath}`);

  try {
    execSync(`launchctl unload -w ${plistPath} 2>/dev/null || true`, {
      stdio: "inherit",
    });
  } catch (_) {
    /* ok */
  }
  try {
    execSync(`launchctl load -w ${plistPath}`, { stdio: "inherit" });
    console.log(`Loaded launchd job: com.${user}.cowork-reconciler`);
  } catch (err) {
    console.error(`launchctl load failed: ${err.message}`);
    return 1;
  }

  console.log(`\nNext fire: 03:00 local time. Logs:`);
  console.log(`  ${home}/Library/Logs/cowork-reconciler.log`);
  console.log(`  ${home}/Library/Logs/cowork-reconciler.err`);
  console.log(`\nTo uninstall: launchctl unload -w ${plistPath} && rm ${plistPath}`);
  return 0;
}

module.exports = { installLaunchd, _sauceBinPath, TEMPLATE_PATH };
