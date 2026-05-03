// install.js — the per-vault installer. Runs as tp.user.platformInstall(tp).
//
// Reads:
//   <workshop>/platform/manifest.yml                (workshop catalogue)
//   Docs/Meta/platform-config.yml                  (this vault's path map + workshop_path)
//   Docs/Meta/platform-subscription.yml            (what this vault wants)
//   Docs/Meta/platform-installed.yml               (what's currently installed)
//
// For each subscribed mechanism / blueprint at a NEWER version than installed:
//   1. Read its manifest.yml.
//   2. For each file: substitute {{vars}} from platform-config.yml, copy to dest.
//   3. For each post_install step: handle (snippet enable, notice, etc.) gated by approval.
//   4. Update platform-installed.yml.

module.exports = async function (tp) {
  const app = tp.app;

  const config = await readYaml(app, "Docs/Meta/platform-config.yml");
  const subscription = await readYaml(app, "Docs/Meta/platform-subscription.yml");
  const installed = (await readYaml(app, "Docs/Meta/platform-installed.yml")) || {
    mechanisms: [],
    blueprints: [],
    history: [],
  };

  if (!config || !subscription) {
    new Notice("platformInstall: missing platform-config.yml or platform-subscription.yml. Aborting.", 6000);
    return;
  }

  const workshopPath =
    config.workshop_path ||
    resolveWorkshopPath(app, config.workshop_relative_path || "../workshop/poc-vault");
  const manifest = await readYamlAbsolute(`${workshopPath}/platform/manifest.yml`);

  if (!manifest) {
    new Notice(`platformInstall: cannot read workshop manifest at ${workshopPath}/platform/manifest.yml`, 8000);
    return;
  }

  const variables = config.variables || {};
  const installedNow = {
    ...installed,
    mechanisms: [...(installed.mechanisms || [])],
    history: [...(installed.history || [])],
  };

  for (const sub of subscription.mechanisms || []) {
    const target = (manifest.mechanisms || []).find((m) => m.name === sub.name);
    if (!target) {
      new Notice(`platformInstall: workshop has no mechanism "${sub.name}"`, 4000);
      continue;
    }
    if (target.version !== sub.version) {
      new Notice(
        `platformInstall: subscription pins ${sub.name}@${sub.version} but workshop has ${target.version}. Skipping.`,
        6000,
      );
      continue;
    }
    const installedEntry = installedNow.mechanisms.find((m) => m.name === sub.name);
    if (installedEntry && installedEntry.version === sub.version) continue;

    const ok = await installMechanism(tp, workshopPath, target, variables);
    if (ok) {
      const entry = { name: sub.name, version: sub.version, installed_at: new Date().toISOString() };
      const idx = installedNow.mechanisms.findIndex((m) => m.name === sub.name);
      if (idx >= 0) installedNow.mechanisms[idx] = entry;
      else installedNow.mechanisms.push(entry);
      installedNow.history.push({ event: "install", ...entry });
    }
  }

  // Blueprint install: same shape, deferred to a future task. The harness is here:
  // for (const sub of subscription.blueprints || []) { ... }

  await writeYaml(app, "Docs/Meta/platform-installed.yml", installedNow);
  new Notice("platformInstall: complete.", 4000);
};

async function installMechanism(tp, workshopPath, target, variables) {
  const adapter = tp.app.vault.adapter;
  const manPath = `${workshopPath}/platform/${target.path}/manifest.yml`;
  const mech = await readYamlAbsolute(manPath);
  if (!mech) {
    new Notice(`installMechanism: cannot read ${manPath}`, 4000);
    return false;
  }

  for (const f of mech.files || []) {
    const sourceAbs = `${workshopPath}/platform/${target.path}/${f.source}`;
    const destPath = substitute(f.dest, variables);

    if (f.approval === "required") {
      const ok = await approvalGate(tp, `Install ${mech.name} → ${destPath}?`);
      if (!ok) {
        new Notice(`Skipped ${destPath} (no approval)`, 3000);
        continue;
      }
    }

    const sourceText = await readAbsolute(sourceAbs);
    if (sourceText === null) {
      new Notice(`installMechanism: source missing: ${sourceAbs}`, 4000);
      return false;
    }

    const substituted = substitute(sourceText, variables);

    const destDir = destPath.includes("/") ? destPath.substring(0, destPath.lastIndexOf("/")) : "";
    if (destDir && !(await adapter.exists(destDir))) {
      await adapter.mkdir(destDir);
    }
    await adapter.write(destPath, substituted);
  }

  for (const step of mech.post_install || []) {
    if (step.type === "enable_snippet") {
      await enableSnippet(tp, step.snippet, step.approval === "required");
    } else if (step.type === "notice") {
      new Notice(step.message, 8000);
    }
  }

  return true;
}

function substitute(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

function resolveWorkshopPath(app, relative) {
  // Templater desktop: app.vault.adapter.basePath is the absolute vault root.
  const base = app.vault.adapter.basePath || app.vault.adapter.getBasePath?.();
  if (!base) return relative; // best-effort — relative paths may fail in fs.readFile
  // node:path is available in Templater scripts via require.
  const path = require("path");
  return path.resolve(base, relative);
}

async function readAbsolute(absPath) {
  try {
    const fs = require("fs").promises;
    return await fs.readFile(absPath, "utf8");
  } catch (e) {
    return null;
  }
}

async function readYamlAbsolute(absPath) {
  const text = await readAbsolute(absPath);
  if (!text) return null;
  try {
    if (typeof YAML !== "undefined" && YAML.parse) return YAML.parse(text);
    if (typeof window !== "undefined" && window.YAML?.parse) return window.YAML.parse(text);
    return null;
  } catch (e) {
    return null;
  }
}

async function readYaml(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  const text = await app.vault.read(f);
  try {
    if (typeof YAML !== "undefined" && YAML.parse) return YAML.parse(text);
    if (typeof window !== "undefined" && window.YAML?.parse) return window.YAML.parse(text);
    return null;
  } catch (e) {
    return null;
  }
}

async function writeYaml(app, path, obj) {
  const banner =
    "# Auto-managed by platform installer.\n" +
    "# Edit by hand only if you know what you're doing.\n";
  let body;
  try {
    if (typeof YAML !== "undefined" && YAML.stringify) body = YAML.stringify(obj);
    else if (typeof window !== "undefined" && window.YAML?.stringify) body = window.YAML.stringify(obj);
    else body = JSON.stringify(obj, null, 2); // last-resort fallback
  } catch (e) {
    body = JSON.stringify(obj, null, 2);
  }
  const text = banner + body;
  const tfile = app.vault.getAbstractFileByPath(path);
  if (tfile) await app.vault.modify(tfile, text);
  else await app.vault.create(path, text);
}

async function approvalGate(tp, message) {
  const choice = await tp.system.suggester(["Approve", "Skip"], [true, false], false, message);
  return choice === true;
}

async function enableSnippet(tp, snippet, approvalRequired) {
  const adapter = tp.app.vault.adapter;
  const path = ".obsidian/appearance.json";
  let json;
  try {
    json = JSON.parse(await adapter.read(path));
  } catch (e) {
    json = {};
  }
  if ((json.enabledCssSnippets || []).includes(snippet)) return;
  if (approvalRequired) {
    const ok = await approvalGate(tp, `Enable snippet ${snippet} in appearance.json?`);
    if (!ok) return;
  }
  json.enabledCssSnippets = [...(json.enabledCssSnippets || []), snippet];
  await adapter.write(path, JSON.stringify(json, null, 2));
  new Notice(`Enabled snippet ${snippet}. Reload Obsidian to apply.`, 6000);
}
