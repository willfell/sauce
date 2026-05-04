// install.js — the per-vault installer. Runs as tp.user.platformInstall(tp).
//
// Reads:
//   <workshop>/platform/manifest.json               (workshop catalogue)
//   Docs/Meta/platform-config.json                  (this vault's path map + workshop_path)
//   Docs/Meta/platform-subscription.json            (what this vault wants)
//   Docs/Meta/platform-installed.json               (what's currently installed)
//
// All platform metadata is JSON for portability — Templater scripts can't access
// require("obsidian").parseYaml. Rule files (used by validator) stay JSON for the
// same reason.
//
// For each subscribed mechanism / blueprint at a NEWER version than installed:
//   1. Read its manifest.json.
//   2. For each file: substitute {{vars}} from platform-config.json, copy to dest.
//   3. For each post_install step: handle (snippet enable, notice, etc.) gated by approval.
//   4. Update platform-installed.json.

// gitState(workshopPath) — best-effort capture of workshop git state for
// installed.history audit. Returns {commit, tag, dirty} where any field may
// be null if the workshop is not a git repo, git is unavailable, or HEAD has
// no exact-match tag. NEVER throws — install correctness must NOT depend on
// git correctness (landmine #14).
//
// Used by every installed.history.push() site post-workshopPath-resolution.
// Pre-resolution push sites (step: read_config, step: read_subscription) MUST
// record git_commit:null, git_tag:null, git_dirty:null explicitly.
function gitState(workshopPath) {
  const { execSync } = require("child_process");
  const result = { commit: null, tag: null, dirty: null };
  try {
    result.commit = execSync(`git -C "${workshopPath}" rev-parse HEAD`, { encoding: "utf8" }).trim();
  } catch { /* not a git repo, or git unavailable; leave null */ }
  try {
    const out = execSync(`git -C "${workshopPath}" describe --tags --exact-match HEAD 2>/dev/null`, { encoding: "utf8" }).trim();
    result.tag = out.length > 0 ? out : null;
  } catch { /* HEAD has no exact tag; leave null */ }
  try {
    const status = execSync(`git -C "${workshopPath}" status --porcelain`, { encoding: "utf8" });
    result.dirty = status.length > 0;
  } catch { /* leave null */ }
  return result;
}

module.exports = async function (tp) {
  const app = tp.app;

  const installed = (await readJson(app, "Docs/Meta/platform-installed.json")) || {
    mechanisms: [],
    blueprints: [],
    history: [],
  };

  // Always carry installedNow into the finally so partial state is preserved
  // even when something blows up mid-flow (E1 hardening).
  const installedNow = {
    ...installed,
    mechanisms: [...(installed.mechanisms || [])],
    blueprints: [...(installed.blueprints || [])],
    history: [...(installed.history || [])],
  };

  let topLevelOk = false;
  try {
    const config = await readJson(app, "Docs/Meta/platform-config.json");
    const subscription = await readJson(app, "Docs/Meta/platform-subscription.json");

    if (!config) {
      new Notice("platformInstall: cannot read/parse Docs/Meta/platform-config.json. Aborting.", 6000);
      installedNow.history.push({ event: "error", step: "read_config", message: "Docs/Meta/platform-config.json missing or unparseable", git_commit: null, git_tag: null, git_dirty: null, attempted_at: new Date().toISOString() });
      return;
    }
    if (!subscription) {
      new Notice("platformInstall: cannot read/parse Docs/Meta/platform-subscription.json. Aborting.", 6000);
      installedNow.history.push({ event: "error", step: "read_subscription", message: "Docs/Meta/platform-subscription.json missing or unparseable", git_commit: null, git_tag: null, git_dirty: null, attempted_at: new Date().toISOString() });
      return;
    }

    const workshopPath =
      config.workshop_path ||
      resolveWorkshopPath(app, config.workshop_relative_path || "../workshop/poc-vault");

    // gitState captured BEFORE manifest read so even read_manifest failures get git context.
    // Carried into every installed.history.push() site post-resolution.
    const git = gitState(workshopPath);

    const manifest = await readJsonAbsolute(`${workshopPath}/platform/manifest.json`);

    if (!manifest) {
      new Notice(`platformInstall: cannot read workshop manifest at ${workshopPath}/platform/manifest.json`, 8000);
      installedNow.history.push({ event: "error", step: "read_manifest", message: `cannot read workshop manifest at ${workshopPath}/platform/manifest.json`, git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      return;
    }

    const variables = config.variables || {};
    // Defaults for substitution variables not explicitly set in platform-config.json.
    // Keep this list narrow — only variables the installer itself depends on (registry
    // location, content drop) belong here. Per-item path variables stay required-by-config.
    if (variables.content_path === undefined || variables.content_path === null) {
      variables.content_path = "Docs/Meta/Content";
    }

    // 1. resolve which items to install + their order
    const { nodes, skipped: missingItems } = resolveDependencies(subscription, manifest);

    // 2. read each item's manifest.json so we can see its depends_on
    const perItemManifest = new Map();
    const subscriptionLookup = new Map();
    for (const [name, node] of nodes) {
      const path = `${workshopPath}/platform/${node.target.path}/manifest.json`;
      const m = await readJsonAbsolute(path);
      if (m) perItemManifest.set(name, m);
      subscriptionLookup.set(name, node.sub);
    }

    // 3. check dep satisfaction (E3: pass missingItems so checkDeps can
    //    distinguish "not subscribed" from "subscribed-but-skipped").
    const depSkipped = checkDeps(nodes, perItemManifest, subscriptionLookup, missingItems);

    // 3a. validate module_directory on every blueprint manifest (v0.2.0 T1.1).
    //
    // Mechanisms are EXEMPT — module_directory is a blueprint-only contract.
    //
    // Two checks per blueprint:
    //   A. required-field check: manifest.module_directory must be a non-empty
    //      string. Missing/empty/non-string → record event:"error",
    //      step:"module_directory_missing"; surface Notice; SKIP this blueprint
    //      (do not call installItem; do not error out the whole install).
    //   B. collision check: tracks claims in a Map<string,string> (directory →
    //      first blueprint to claim it; iteration order is the resolved-deps
    //      iteration order, so first-wins). On collision → record event:"warning",
    //      step:"module_directory_collision"; surface Notice; SKIP the SECOND
    //      blueprint. The first installs normally.
    //
    // Both checks add the offending blueprint name to a skip set; the install
    // loop below short-circuits when the current name is in the set.
    //
    // Posture mirrors v0.1.3 helpers (applyTemplaterHotkeys / applySlashCommanderBindings):
    // failure-loud, never throws, full git fields on every history push, attempted_at on each.
    const moduleDirectorySkip = new Set();
    const moduleDirToBlueprint = new Map();
    for (const [name, node] of nodes) {
      if (node.target.kind !== "blueprint") continue;
      const itemMan = perItemManifest.get(name);
      if (!itemMan) continue; // missing manifest already handled in installItem; nothing to validate.
      try {
        const md = itemMan.module_directory;
        if (typeof md !== "string" || md.length === 0) {
          new Notice(`platformInstall: blueprint ${name} is missing required module_directory; skipping.`, 8000);
          installedNow.history.push({
            event: "error",
            step: "module_directory_missing",
            name,
            message: `blueprint ${name} manifest lacks required non-empty string module_directory field`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
          moduleDirectorySkip.add(name);
          continue;
        }
        if (moduleDirToBlueprint.has(md)) {
          const firstClaimant = moduleDirToBlueprint.get(md);
          new Notice(`platformInstall: blueprint ${name} declares module_directory "${md}" already claimed by ${firstClaimant}; skipping ${name}.`, 8000);
          installedNow.history.push({
            event: "warning",
            step: "module_directory_collision",
            name,
            colliding_with: firstClaimant,
            module_directory: md,
            message: `blueprint ${name} declares module_directory "${md}" already claimed by ${firstClaimant}; skipping ${name} (first-wins by topo order)`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
          moduleDirectorySkip.add(name);
          continue;
        }
        moduleDirToBlueprint.set(md, name);
      } catch (e) {
        // Defensive: never let validation failures abort the broader install.
        installedNow.history.push({
          event: "warning",
          step: "module_directory_validation",
          name,
          message: `module_directory validation threw: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    // 4. topo sort
    const { order, cycle } = topoSort(nodes);
    if (cycle) {
      new Notice(`platformInstall: dependency cycle involving ${cycle}. Aborting.`, 8000);
      installedNow.history.push({ event: "error", step: "topo_sort", message: `dependency cycle involving ${cycle}`, git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      return;
    }

    // 5. log + record skips
    const allSkipped = [...missingItems, ...depSkipped];
    for (const s of allSkipped) {
      new Notice(`platformInstall: skipping ${s.name} — ${s.reason}`, 6000);
      installedNow.history.push({ event: "skip", name: s.name, reason: s.reason, git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }

    // 6. install in resolved order. Each installItem is wrapped in try/catch
    //    so a single item failure doesn't abort the whole loop (E1).
    for (const name of order) {
      // v0.2.0 T1.1: skip blueprints that failed module_directory validation
      // (missing field) or lost a collision check (first-wins). The Notice +
      // history entry was already recorded in the validation pass above.
      if (moduleDirectorySkip.has(name)) continue;
      const node = nodes.get(name);
      const bucketKey = node.target.kind === "blueprint" ? "blueprints" : "mechanisms";
      installedNow[bucketKey] = installedNow[bucketKey] || [];
      const installedEntry = installedNow[bucketKey].find((m) => m.name === name);
      if (installedEntry && installedEntry.version === node.sub.version) continue;
      const itemMan = perItemManifest.get(name);
      try {
        // v0.2.0 T1.2: per-blueprint {{module_directory}} substitution overlay.
        // Resolves to the namespaced full path "beacon/<bare-name>" (per
        // landmine #11 + 2026-05-04 design refinement). The base `variables`
        // object is NEVER mutated — each iteration constructs a fresh shallow
        // copy, so module_directory cannot leak from one blueprint into
        // another's substitution context. Mechanisms receive the unchanged
        // base `variables` (no module_directory key), so substituteStrict
        // failures loud on any mechanism content that misuses the variable
        // and substituteLenient leaves the literal `{{module_directory}}` in
        // bodies — both desired postures.
        //
        // T1.1's validation pass already guarantees itemMan.module_directory
        // is a non-empty string for any blueprint that reaches this loop
        // (moduleDirectorySkip short-circuits the rest at line 218).
        let itemVars = variables;
        if (node.target.kind === "blueprint") {
          itemVars = { ...variables, module_directory: `beacon/${itemMan.module_directory}` };
        }
        const ok = await installItem(tp, workshopPath, node.target, itemMan, itemVars, installedNow.history, git);
        if (ok) {
          const entry = { name, version: node.sub.version, installed_at: new Date().toISOString() };
          const idx = installedNow[bucketKey].findIndex((m) => m.name === name);
          if (idx >= 0) installedNow[bucketKey][idx] = entry;
          else installedNow[bucketKey].push(entry);
          installedNow.history.push({ event: "install", kind: node.target.kind, ...entry, git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty });
        }
      } catch (e) {
        new Notice(`platformInstall: ${name} crashed during install — ${e.message}`, 8000);
        installedNow.history.push({
          event: "error",
          name,
          step: "installItem",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    // 7. Subscription-aware pruning of Docs/Meta/nav-buttons-registry.json.
    // Removes contributions.<source> for any source that is no longer in the
    // current subscription. Self-cleaning registry — no separate uninstall
    // mechanic needed. Wrapped in its own try/catch so a malformed registry
    // (or a missing one) never aborts the broader install.
    try {
      await pruneNavButtonsRegistry(tp, subscription, installedNow.history, git);
    } catch (e) {
      new Notice(`platformInstall: nav-buttons registry prune failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "nav_buttons_prune",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }

    // 8. Subscription-aware pruning of Docs/Meta/platform-installed.json
    // bucket arrays (mechanisms[], blueprints[]). Symmetric with the
    // nav-buttons-registry prune above: drops install ledger entries whose
    // names are no longer in the current subscription, so the ledger never
    // drifts from subscription truth. history[] is preserved verbatim
    // (only NEW prune events are appended). Wrapped in its own try/catch so
    // a malformed ledger (or read failure) never aborts the broader install.
    //
    // IMPORTANT: this prunes the in-memory `installedNow` object directly.
    // We cannot mirror pruneNavButtonsRegistry's "read-from-disk → write-to-disk"
    // shape literally for this file, because the `finally` block below
    // unconditionally writes `installedNow` back to the same path — that would
    // clobber any disk-only mutation. Mutating `installedNow` lets finally
    // persist the pruned state. All other posture (Notice on errors, history
    // entry on errors, shape guards, idempotency, no-write-when-clean) is
    // preserved by gating on `mutated` and only writing through the finally.
    try {
      await pruneInstalledLedger(tp, subscription, installedNow, git);
    } catch (e) {
      new Notice(`platformInstall: installed ledger prune failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "installed_ledger_prune",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }

    topLevelOk = true;
    new Notice("platformInstall: complete.", 4000);
  } catch (e) {
    new Notice(`platformInstall: top-level error — ${e.message}`, 8000);
    installedNow.history.push({
      event: "error",
      step: "top_level",
      message: e.message,
      git_commit: null,
      git_tag: null,
      git_dirty: null,
      attempted_at: new Date().toISOString(),
    });
  } finally {
    // ALWAYS persist whatever state we have, success or failure (E1).
    try {
      await writeJson(app, "Docs/Meta/platform-installed.json", installedNow);
    } catch (e) {
      new Notice(`platformInstall: failed to write platform-installed.json — ${e.message}`, 8000);
    }
    if (!topLevelOk) {
      new Notice("platformInstall: finished with errors. See platform-installed.json history.", 8000);
    }
  }
};

async function installItem(tp, workshopPath, target, itemMan, variables, history, git) {
  const adapter = tp.app.vault.adapter;
  const mech = itemMan;

  // v0.2.0 T1.2 defensive guard: if a blueprint reaches installItem without
  // module_directory in `variables`, T1.1's validation pass + the install-loop
  // skip-set should have already short-circuited it. This guard is
  // belt-and-suspenders — record a warning (not error) so the issue surfaces
  // in history, but proceed; substituteStrict on a `{{module_directory}}`-
  // containing path will fail loud on its own and abort the file. This
  // guard's only job is to make the diagnostic obvious rather than masked
  // behind a generic "unsubstituted variables" error.
  if (mech && target && target.kind === "blueprint") {
    if (variables.module_directory === undefined || variables.module_directory === null || variables.module_directory === "") {
      if (history) {
        history.push({
          event: "warning",
          step: "module_directory_substitution_missing",
          name: mech.name || (target && target.name),
          message: "blueprint reached installItem without variables.module_directory; T1.1 validation pass should have caught this",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (!mech) {
    new Notice(`installItem: missing manifest for ${target && target.path}`, 4000);
    if (history) {
      history.push({
        event: "error",
        step: "installItem",
        name: (target && target.name) || (target && target.path),
        message: `missing manifest for ${target && target.path}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return false;
  }

  // v0.2.0 T1.4: pre_install[] runs FIRST, before files[] materialization and
  // every other helper. Currently supports `type: "delete"` only — sweeps
  // legacy / superseded files prior to fresh install. Failure-loud, never
  // throws (helper handles its own errors). Ordering rationale: any leftover
  // file the new contract wants to overwrite at a different path needs to be
  // out of the way before T1.3's Option B mechanic compares prior bytes.
  await applyPreInstall(tp, mech, variables, history, git);

  for (const f of mech.files || []) {
    const sourceAbs = `${workshopPath}/platform/${target.path}/${f.source}`;

    const sourceText = await readAbsolute(sourceAbs);
    if (sourceText === null) {
      new Notice(`installItem: source missing: ${sourceAbs}`, 4000);
      return false;
    }

    let destPath, substituted;
    try {
      destPath = substituteStrict(f.dest, variables);
    } catch (e) {
      new Notice(`installItem: ${mech.name} ${f.source} dest path — ${e.message}`, 8000);
      return false;
    }
    substituted = substituteLenient(sourceText, variables);

    if (f.approval === "required") {
      const ok = await approvalGate(tp, `Install ${mech.name} → ${destPath}?`);
      if (!ok) {
        new Notice(`Skipped ${destPath} (no approval)`, 3000);
        continue;
      }
    }

    const destDir = destPath.includes("/") ? destPath.substring(0, destPath.lastIndexOf("/")) : "";
    if (destDir && !(await adapter.exists(destDir))) {
      await adapter.mkdir(destDir);
    }

    // v0.2.0 T1.3: Option B content overwrite mechanic for files[]-declared
    // content. Compare the post-substitution body against the existing dest
    // (if any). Three branches:
    //   1. Identical content → skip the write entirely (idempotent;
    //      no history event).
    //   2. Differs AND prior is non-empty → write prior to <dest>.bak
    //      (overwrite-on-edit, one-deep, no rotation), then overwrite dest
    //      with the new substituted body. Record event:"replace",
    //      step:"file_overwrite" with prior_sha + new_sha.
    //   3. Dest absent OR 0-byte → write substituted source as fresh; no
    //      history event for the fresh write.
    //
    // Posture mirrors v0.1.3 helpers (applyTemplaterHotkeys / applySlashCommanderBindings):
    // never throws — read failures + bak write failures degrade to a
    // history error and skip the dest write so we don't half-update.
    // The .bak suffix here (NOT .beacon-backup) is the file-content-overwrite
    // convention; v0.1.3's plugin-data convention uses .beacon-backup.
    const destExists = await adapter.exists(destPath);
    let priorContent = null;
    if (destExists) {
      try {
        priorContent = await adapter.read(destPath);
      } catch (e) {
        // Treat unreadable dest as null; fall through to fresh write. Record
        // a warning so the issue surfaces in history.
        if (history) {
          history.push({
            event: "warning",
            step: "file_overwrite",
            name: mech.name,
            dest: destPath,
            message: `read failed before overwrite check: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      }
    }

    if (priorContent !== null && priorContent === substituted) {
      // Identical; skip the write entirely (idempotent).
      continue;
    }

    if (priorContent !== null && priorContent.length > 0) {
      // Differs and non-empty: backup prior to <dest>.bak, then overwrite.
      const crypto = require("crypto");
      const priorSha = crypto.createHash("sha256").update(priorContent).digest("hex");
      const newSha = crypto.createHash("sha256").update(substituted).digest("hex");
      const bakPath = `${destPath}.bak`;
      try {
        await adapter.write(bakPath, priorContent);
      } catch (e) {
        // Don't half-update: skip the dest overwrite if bak write failed.
        new Notice(`installItem: bak write failed for ${destPath} — ${e.message}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "file_overwrite",
            name: mech.name,
            dest: destPath,
            message: `bak write failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
      await adapter.write(destPath, substituted);
      if (history) {
        history.push({
          event: "replace",
          step: "file_overwrite",
          name: mech.name,
          dest: destPath,
          prior_sha: priorSha,
          new_sha: newSha,
          bak_path: bakPath,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } else {
      // priorContent is null OR empty (0-byte) → fresh write; existing flow.
      await adapter.write(destPath, substituted);
    }
  }

  for (const step of mech.post_install || []) {
    if (step.type === "enable_snippet") {
      await enableSnippet(tp, step.snippet, step.approval === "required", mech.name, history, git);
    } else if (step.type === "notice") {
      new Notice(step.message, 8000);
    }
  }

  // Materialize rule_fragments contributed by this item.
  for (const frag of mech.rule_fragments || []) {
    await applyRuleFragment(tp, frag, mech.name, variables, history, git);
  }

  // Aggregate nav-button declarations into Docs/Meta/nav-buttons-registry.json.
  // Failure here records history but does NOT throw — install of this item
  // is otherwise complete, and the registry is regenerated on every install.
  await applyNavButtons(tp, mech, variables, history, git);
  await applyExternalPlugins(tp, mech, history, git);
  await applyTemplaterHotkeys(tp, mech, variables, history, git);          // NEW v0.1.3
  await applySlashCommanderBindings(tp, mech, variables, history, git);    // NEW v0.1.3

  return true;
}

function substituteStrict(text, variables) {
  const missing = new Set();
  const result = text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (variables[key] === undefined || variables[key] === null) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return variables[key];
  });
  if (missing.size > 0) {
    const err = new Error(`Unsubstituted variables: ${[...missing].join(", ")}`);
    err.missing = [...missing];
    throw err;
  }
  return result;
}

function substituteLenient(text, variables) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (variables[key] === undefined || variables[key] === null) {
      return `{{${key}}}`;
    }
    return variables[key];
  });
}

function resolveWorkshopPath(app, relative) {
  const base = app.vault.adapter.basePath || app.vault.adapter.getBasePath?.();
  if (!base) return relative;
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

function parseJsonText(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    console.warn("[platform] JSON parse failed:", e.message);
    return null;
  }
}

async function readJsonAbsolute(absPath) {
  const text = await readAbsolute(absPath);
  if (!text) return null;
  return parseJsonText(text);
}

async function readJson(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  const text = await app.vault.read(f);
  return parseJsonText(text);
}

async function writeJson(app, path, obj) {
  const text = JSON.stringify(obj, null, 2);
  const tfile = app.vault.getAbstractFileByPath(path);
  if (tfile) await app.vault.modify(tfile, text);
  else await app.vault.create(path, text);
}

async function approvalGate(tp, message) {
  const choice = await tp.system.suggester(["Approve", "Skip"], [true, false], false, message);
  return choice === true;
}

function resolveDependencies(subscription, manifest) {
  const skipped = [];
  const nodes = new Map();

  // L2: detect any name appearing as both mechanism and blueprint in either
  // the subscription OR the workshop manifest. Hard-skip both items so an
  // accidental cross-bucket collision can't silently overwrite in `nodes`.
  const subMechNames = new Set((subscription.mechanisms || []).map((m) => m.name));
  const subBpNames = new Set((subscription.blueprints || []).map((b) => b.name));
  const manMechNames = new Set((manifest.mechanisms || []).map((m) => m.name));
  const manBpNames = new Set((manifest.blueprints || []).map((b) => b.name));

  const collisionNames = new Set();
  for (const n of subMechNames) if (subBpNames.has(n)) collisionNames.add(n);
  for (const n of manMechNames) if (manBpNames.has(n)) collisionNames.add(n);

  for (const name of collisionNames) {
    skipped.push({
      name,
      reason: `name collision: "${name}" appears as both mechanism and blueprint`,
    });
  }

  const subItems = [];
  for (const m of subscription.mechanisms || []) subItems.push({ ...m, kind: "mechanism" });
  for (const b of subscription.blueprints || []) subItems.push({ ...b, kind: "blueprint" });

  const manifestItem = (name) =>
    (manifest.mechanisms || []).find((m) => m.name === name) ||
    (manifest.blueprints || []).find((b) => b.name === name);

  for (const sub of subItems) {
    if (collisionNames.has(sub.name)) continue; // L2: hard-skip both halves of a collision.
    const target = manifestItem(sub.name);
    if (!target) {
      skipped.push({ name: sub.name, reason: `workshop has no item named "${sub.name}"` });
      continue;
    }
    if (target.version !== sub.version) {
      skipped.push({
        name: sub.name,
        reason: `subscription pins ${sub.name}@${sub.version} but workshop has ${target.version}`,
      });
      continue;
    }
    // Annotate target with kind so the install loop can route to the right bucket.
    const targetWithKind = { ...target, kind: sub.kind };
    nodes.set(sub.name, { sub, target: targetWithKind, deps: [] });
  }

  return { nodes, skipped };
}

function checkDeps(nodes, perItemManifest, subscriptionLookup, missingItems) {
  // E3: build a name -> reason map for items skipped during resolveDependencies
  // so we can distinguish "not subscribed at all" from "subscribed-but-skipped".
  const missingByName = new Map();
  for (const m of missingItems || []) missingByName.set(m.name, m.reason);

  const skipped = [];
  for (const [name, node] of nodes) {
    const itemMan = perItemManifest.get(name);
    const deps = (itemMan && itemMan.depends_on) || [];
    for (const dep of deps) {
      const sub = subscriptionLookup.get(dep.name);
      if (!sub) {
        // E3: if dep was subscribed but skipped at resolve-time, surface that.
        if (missingByName.has(dep.name)) {
          skipped.push({
            name,
            reason: `depends on ${dep.name} which was skipped (${missingByName.get(dep.name)})`,
          });
        } else {
          skipped.push({ name, reason: `depends on ${dep.name} ${dep.range} but it is not subscribed` });
        }
        node.unfit = true;
        break;
      }
      const result = satisfiesRange(sub.version, dep.range);
      if (!result.ok) {
        // C2: distinct skip reason for unrecognized range syntax.
        if (result.reason === "unrecognized") {
          skipped.push({
            name,
            reason: `depends on ${dep.name} with unrecognized version range syntax "${result.syntax}". Supported: >=N.N.N or exact X.Y.Z.`,
          });
        } else {
          skipped.push({
            name,
            reason: `depends on ${dep.name} ${dep.range} but subscription pins ${dep.name}@${sub.version}`,
          });
        }
        node.unfit = true;
        break;
      }
      node.deps.push(dep.name);
    }
  }
  return skipped;
}

// C2: tagged-union return shape so callers can distinguish
//   - { ok: true }                                 — version satisfies range
//   - { ok: false, reason: "unsatisfied" }         — recognized syntax, version too low
//   - { ok: false, reason: "unrecognized", syntax }— range syntax not understood
function satisfiesRange(version, range) {
  if (range === version) return { ok: true };
  const m = range.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [, a, b, c] = m.map(Number);
    const [x, y, z] = version.split(".").map(Number);
    if (x > a) return { ok: true };
    if (x < a) return { ok: false, reason: "unsatisfied" };
    if (y > b) return { ok: true };
    if (y < b) return { ok: false, reason: "unsatisfied" };
    return z >= c ? { ok: true } : { ok: false, reason: "unsatisfied" };
  }
  // Exact version match (X.Y.Z form) was handled by `range === version` above.
  // Anything else is unrecognized syntax.
  return { ok: false, reason: "unrecognized", syntax: range };
}

function topoSort(nodes) {
  const order = [];
  const visited = new Set();
  const temp = new Set();
  function visit(name) {
    if (visited.has(name)) return true;
    if (temp.has(name)) return false; // cycle
    const node = nodes.get(name);
    if (!node || node.unfit) return true;
    temp.add(name);
    for (const d of node.deps) {
      if (!visit(d)) return false;
    }
    temp.delete(name);
    visited.add(name);
    order.push(name);
    return true;
  }
  for (const name of nodes.keys()) {
    if (!visit(name)) return { order: null, cycle: name };
  }
  return { order, cycle: null };
}

async function applyRuleFragment(tp, frag, sourceName, variables, history, git) {
  const adapter = tp.app.vault.adapter;
  const rulesPath = variables.rules_path;
  if (!rulesPath) {
    new Notice(`applyRuleFragment: rules_path not configured; skipping fragment from ${sourceName}`, 6000);
    if (history) {
      history.push({
        event: "error",
        step: "applyRuleFragment",
        name: sourceName,
        message: `rules_path not configured; skipped fragment for target "${frag && frag.target}"`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  const target = frag.target; // e.g., "_global", "project"
  const rulePath = `${rulesPath}/${target}.json`;
  if (!(await adapter.exists(rulesPath))) await adapter.mkdir(rulesPath);
  let existing = {};
  if (await adapter.exists(rulePath)) {
    let raw;
    try {
      raw = await adapter.read(rulePath);
    } catch (e) {
      new Notice(`applyRuleFragment: cannot read ${rulePath} (${e.message}). Skipping fragment from ${sourceName}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "applyRuleFragment",
          name: sourceName,
          message: `read failed for ${rulePath}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    try {
      existing = JSON.parse(raw);
    } catch (e) {
      // C4: do NOT silently overwrite a malformed pre-existing rule file.
      new Notice(`applyRuleFragment: ${rulePath} is malformed JSON (${e.message}). Skipping fragment from ${sourceName}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "applyRuleFragment",
          name: sourceName,
          message: `${rulePath} is malformed JSON: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
  }
  existing.contributions = existing.contributions || {};
  existing.contributions[sourceName] = frag.fragment;
  await adapter.write(rulePath, JSON.stringify(existing, null, 2));
}

// applyNavButtons — aggregate this item's nav_buttons[] declarations into
// Docs/Meta/nav-buttons-registry.json under contributions.<name>. Mirrors
// applyRuleFragment in posture: malformed pre-existing JSON is preserved
// (C4 hardening); per-entry validation skips bad entries without taking the
// whole contribution down; failures record history but do not throw.
async function applyNavButtons(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.nav_buttons) || manifest.nav_buttons.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const registryPath = "Docs/Meta/nav-buttons-registry.json";

  let registry = { schema_version: 1, contributions: {} };
  if (await adapter.exists(registryPath)) {
    let raw;
    try {
      raw = await adapter.read(registryPath);
    } catch (e) {
      new Notice(`applyNavButtons: cannot read ${registryPath} (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "nav_buttons",
          name: manifest.name,
          message: `read failed for ${registryPath}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    try {
      registry = JSON.parse(raw);
    } catch (e) {
      // C4: do NOT silently overwrite a malformed pre-existing registry file.
      new Notice(`applyNavButtons: ${registryPath} is malformed JSON (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "nav_buttons",
          name: manifest.name,
          message: `${registryPath} is malformed JSON: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
  }
  registry.contributions = registry.contributions || {};

  const validated = manifest.nav_buttons
    .map((btn) => validateAndResolve(btn, manifest.name, variables, history, git))
    .filter(Boolean);

  if (validated.length === 0) {
    if (history) {
      history.push({
        event: "error",
        step: "nav_buttons",
        name: manifest.name,
        reason: "all entries invalid",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  registry.contributions[manifest.name] = validated;
  await adapter.write(registryPath, JSON.stringify(registry, null, 2));
}

// validateAndResolve — per-entry validation. Returns null for malformed entries
// (a Notice is fired and a warning is recorded in history) and a resolved entry
// otherwise. createFromTemplate's template_source is rewritten from the
// manifest-relative form (e.g., "content/kanban-board.md") to the consumer-resolved
// form ("<content_path>/<sourceName>/<...>") so the renderer can read it directly.
function validateAndResolve(btn, sourceName, variables, history, git) {
  if (!btn || !btn.id || !btn.label || !btn.action || !btn.action.type) {
    new Notice(`nav-buttons: invalid declaration in ${sourceName} (missing id/label/action)`, 8000);
    if (history) {
      history.push({
        event: "warning",
        step: "nav_buttons",
        name: sourceName,
        reason: `entry ${(btn && btn.id) || "<no-id>"} invalid`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return null;
  }
  if (btn.action.type === "createFromTemplate" && btn.action.template_source) {
    const contentPath = variables.content_path || "Docs/Meta/Content";
    return {
      ...btn,
      action: {
        ...btn.action,
        template_source: `${contentPath}/${sourceName}/${btn.action.template_source}`,
      },
    };
  }
  return btn;
}

// applyExternalPlugins — for each item that declares external_plugins[], read
// .obsidian/community-plugins.json and warn (Notice + history) for any required
// dep that is not currently enabled. Honors C4 hardening: malformed
// community-plugins.json is preserved + reported, never overwritten. Failures
// here record history but do NOT throw — install of this item is otherwise
// complete. The runtime plugin (e.g., Kanban) materializes board notes; the
// installer cannot install Obsidian community plugins itself, so this is a
// detection-and-surface-up helper, not a remediation step.
async function applyExternalPlugins(tp, manifest, history, git) {
  if (!manifest || !Array.isArray(manifest.external_plugins) || manifest.external_plugins.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const pluginsPath = ".obsidian/community-plugins.json";

  if (!(await adapter.exists(pluginsPath))) {
    new Notice(`applyExternalPlugins: ${pluginsPath} absent; cannot verify deps for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "external_plugins",
        name: manifest.name,
        message: `${pluginsPath} absent`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let raw;
  try {
    raw = await adapter.read(pluginsPath);
  } catch (e) {
    new Notice(`applyExternalPlugins: cannot read ${pluginsPath} (${e.message}); skipping check for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "external_plugins",
        name: manifest.name,
        message: `read failed for ${pluginsPath}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let enabled;
  try {
    enabled = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyExternalPlugins: ${pluginsPath} malformed JSON (${e.message}); skipping check for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "external_plugins",
        name: manifest.name,
        message: `${pluginsPath} malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (!Array.isArray(enabled)) {
    new Notice(`applyExternalPlugins: ${pluginsPath} parsed but not an array; skipping check for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "external_plugins",
        name: manifest.name,
        message: `${pluginsPath} parsed but not an array`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const dep of manifest.external_plugins) {
    if (!dep || !dep.id) continue;
    if (dep.required && !enabled.includes(dep.id)) {
      new Notice(`${manifest.name} requires plugin ${dep.id}: ${dep.reason || "(no reason)"}. Install + enable in Settings → Community plugins.`, 10000);
      if (history) {
        history.push({
          event: "warning",
          step: "external_plugins",
          name: manifest.name,
          plugin_id: dep.id,
          reason: dep.reason || null,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }
}

// applyPreInstall — for each item that declares pre_install[], execute each
// step in order. Currently the only supported `type` is "delete" — sweep a
// stale legacy / superseded file before the new contract materializes (e.g.,
// boards blueprint v0.1.1 → v0.2.0 retires top-level boards/To-Do-Board.md
// in favor of beacon/boards/To-Do-Board.md). Failure-loud, never throws.
//
// Step shape: { type: "delete", path: "<dest-relative-path>", reason: "<why>" }
//
// Per-step behavior:
//   - "delete" + file exists:    backup to <path>.pre_install_bak (one-deep,
//                                 overwrite-on-edit, no rotation), then
//                                 adapter.remove(path). History event:
//                                 event:"delete", step:"pre_install_delete"
//                                 with name, path, prior_sha (sha256 hex),
//                                 bak_path, reason, full git fields, attempted_at.
//   - "delete" + file absent:    no-op. History event:
//                                 event:"info", step:"pre_install_delete_skip"
//                                 with message:"file already absent". Idempotent
//                                 on re-runs.
//   - "delete" + path is dir:    no-op. History event:
//                                 event:"warning", step:"pre_install_delete_skip"
//                                 with message:"target is a directory; pre_install
//                                 delete is single-file only". Continues to next
//                                 entry.
//   - unknown type:              History event:
//                                 event:"warning", step:"pre_install_unknown_type"
//                                 with name, type, message. Skips the step but
//                                 continues with remaining pre_install entries.
//
// .pre_install_bak suffix is intentionally distinct from T1.3's content-overwrite
// .bak suffix to prevent collision (one is per-file content drift recovery; the
// other is per-pre-install-delete recovery).
async function applyPreInstall(tp, mech, variables, history, git) {
  if (!mech || !Array.isArray(mech.pre_install) || mech.pre_install.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const crypto = require("crypto");

  for (const step of mech.pre_install) {
    if (!step || typeof step !== "object") continue;

    if (step.type !== "delete") {
      // Unknown / future type; surface a warning and continue.
      if (history) {
        history.push({
          event: "warning",
          step: "pre_install_unknown_type",
          name: mech.name,
          type: step.type,
          message: `pre_install step has unsupported type "${step.type}"; skipped (only "delete" is supported)`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} has unsupported pre_install type "${step.type}"; skipped`, 6000);
      continue;
    }

    // type === "delete"
    let resolvedPath;
    try {
      resolvedPath = substituteStrict(step.path, variables);
    } catch (e) {
      if (history) {
        history.push({
          event: "error",
          step: "pre_install_delete",
          name: mech.name,
          path: step.path,
          message: `path substitution failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} pre_install path substitution failed — ${e.message}`, 8000);
      continue;
    }

    const exists = await adapter.exists(resolvedPath);
    if (!exists) {
      if (history) {
        history.push({
          event: "info",
          step: "pre_install_delete_skip",
          name: mech.name,
          path: resolvedPath,
          reason: step.reason || null,
          message: "file already absent",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // Distinguish file vs directory. Prefer adapter.stat() if available;
    // fall back to attempting adapter.read() and treating any failure as
    // "probably a directory; skip with a warning". Obsidian's DataAdapter
    // exposes stat() returning { type: "file" | "folder", ... }.
    let isDirectory = false;
    if (typeof adapter.stat === "function") {
      try {
        const s = await adapter.stat(resolvedPath);
        if (s && s.type === "folder") isDirectory = true;
      } catch {
        // stat threw — treat as unknown; fall through to read-attempt below.
      }
    }

    if (!isDirectory && typeof adapter.stat !== "function") {
      // Best-effort heuristic when stat is unavailable: try to read the path
      // as a file. read() on a directory throws on every adapter we care
      // about (Node fs, Obsidian DataAdapter). If read fails, conservatively
      // assume directory and skip with a warning rather than calling remove.
      try {
        await adapter.read(resolvedPath);
      } catch {
        isDirectory = true;
      }
    }

    if (isDirectory) {
      if (history) {
        history.push({
          event: "warning",
          step: "pre_install_delete_skip",
          name: mech.name,
          path: resolvedPath,
          reason: step.reason || null,
          message: "target is a directory; pre_install delete is single-file only",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} pre_install delete target "${resolvedPath}" is a directory; skipped`, 6000);
      continue;
    }

    // File exists; capture prior_sha, write backup, then delete.
    let priorContent;
    try {
      priorContent = await adapter.read(resolvedPath);
    } catch (e) {
      if (history) {
        history.push({
          event: "error",
          step: "pre_install_delete",
          name: mech.name,
          path: resolvedPath,
          message: `read failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} read failed for ${resolvedPath} — ${e.message}`, 8000);
      continue;
    }

    const priorSha = crypto.createHash("sha256").update(priorContent).digest("hex");
    const bakPath = `${resolvedPath}.pre_install_bak`;

    try {
      await adapter.write(bakPath, priorContent);
    } catch (e) {
      // Don't half-update — record failure and skip the delete so the user
      // can recover the original by hand if necessary.
      if (history) {
        history.push({
          event: "error",
          step: "pre_install_delete",
          name: mech.name,
          path: resolvedPath,
          message: `backup write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} backup write failed for ${bakPath} — ${e.message}`, 8000);
      continue;
    }

    try {
      await adapter.remove(resolvedPath);
    } catch (e) {
      if (history) {
        history.push({
          event: "error",
          step: "pre_install_delete",
          name: mech.name,
          path: resolvedPath,
          bak_path: bakPath,
          message: `remove failed (backup at ${bakPath}): ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applyPreInstall: ${mech.name} remove failed for ${resolvedPath} — ${e.message}`, 8000);
      continue;
    }

    if (history) {
      history.push({
        event: "delete",
        step: "pre_install_delete",
        name: mech.name,
        path: resolvedPath,
        prior_sha: priorSha,
        bak_path: bakPath,
        reason: step.reason || null,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyTemplaterHotkeys — for each item that declares templater_hotkeys[],
// read .obsidian/plugins/templater-obsidian/data.json and additive-merge each
// entry's full template path into enabled_templates_hotkeys[]. Idempotent
// (skip if already present). Failure-loud (Notice + history). Backup-on-edit
// to <target>.beacon-backup. Honors landmine #12 — never overwrites a
// malformed data.json; never strips user entries.
//
// Empty-string entries Templater seeds at first install (`[""]`) are
// preserved — additive merge only. Templater's register_templates_hotkeys()
// early-returns on falsy entries, so the empty seed is harmless.
async function applyTemplaterHotkeys(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.templater_hotkeys) || manifest.templater_hotkeys.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/templater-obsidian/data.json";

  if (!(await adapter.exists(target))) {
    new Notice(`applyTemplaterHotkeys: ${target} absent; cannot register hotkeys for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `${target} absent`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    new Notice(`applyTemplaterHotkeys: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `read failed for ${target}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyTemplaterHotkeys: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.enabled_templates_hotkeys)) {
    new Notice(`applyTemplaterHotkeys: ${target} parsed but enabled_templates_hotkeys not an array; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `${target} enabled_templates_hotkeys not an array`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const templatesPath = variables && variables.templates_path;
  if (!templatesPath) {
    new Notice(`applyTemplaterHotkeys: variables.templates_path missing; cannot register for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: "variables.templates_path missing",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let appended = 0;
  for (const entry of manifest.templater_hotkeys) {
    if (!entry || !entry.template) continue;
    const fullPath = `${templatesPath}/${entry.template}`;
    if (data.enabled_templates_hotkeys.includes(fullPath)) {
      if (history) {
        history.push({
          event: "info",
          step: "templater_hotkeys",
          name: manifest.name,
          template_path: fullPath,
          action: "skipped_existing",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    data.enabled_templates_hotkeys.push(fullPath);
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "templater_hotkeys",
        name: manifest.name,
        template_path: fullPath,
        action: "applied",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  if (appended === 0) return;

  // Backup before write (one-deep, overwrite-on-edit).
  try {
    await adapter.write(`${target}.beacon-backup`, raw);
  } catch (e) {
    new Notice(`applyTemplaterHotkeys: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `backup write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(data, null, 2));
  } catch (e) {
    new Notice(`applyTemplaterHotkeys: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_hotkeys",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applySlashCommanderBindings — for each item that declares
// slash_commander_bindings[], read .obsidian/plugins/slash-commander/data.json
// and additive-merge each entry into bindings[]. Idempotency on `id` field.
// Cross-validates that entry.template is also declared in
// manifest.templater_hotkeys[] or manifest.files[] (catches typos). Honors
// landmine #12 — never overwrites a malformed data.json; never strips user
// bindings.
async function applySlashCommanderBindings(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.slash_commander_bindings) || manifest.slash_commander_bindings.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/slash-commander/data.json";

  if (!(await adapter.exists(target))) {
    new Notice(`applySlashCommanderBindings: ${target} absent; cannot register bindings for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `${target} absent`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `read failed for ${target}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    return;
  }

  if (!Array.isArray(data.bindings)) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `${target} bindings not an array`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: ${target} bindings not an array; skipping for ${manifest.name}`, 8000);
    return;
  }

  const templatesPath = variables && variables.templates_path;
  if (!templatesPath) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: "variables.templates_path missing",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: variables.templates_path missing; cannot register for ${manifest.name}`, 8000);
    return;
  }

  // Build cross-validation set: templates the manifest is known to ship.
  const declared = new Set();
  for (const e of manifest.templater_hotkeys || []) {
    if (e && e.template) declared.add(e.template);
  }
  for (const f of manifest.files || []) {
    if (f && f.source) {
      const base = f.source.includes("/") ? f.source.substring(f.source.lastIndexOf("/") + 1) : f.source;
      declared.add(base);
    }
    if (f && f.dest) {
      const base = f.dest.includes("/") ? f.dest.substring(f.dest.lastIndexOf("/") + 1) : f.dest;
      declared.add(base);
    }
  }

  let appended = 0;
  for (const entry of manifest.slash_commander_bindings) {
    if (!entry || !entry.name || !entry.template) continue;

    if (!declared.has(entry.template)) {
      if (history) {
        history.push({
          event: "warning",
          step: "slash_commander_bindings",
          name: manifest.name,
          binding_name: entry.name,
          template: entry.template,
          message: `binding references template "${entry.template}" not declared in templater_hotkeys[] or files[]; skipping`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      new Notice(`applySlashCommanderBindings: ${manifest.name} binding "${entry.name}" references undeclared template "${entry.template}"; skipped`, 8000);
      continue;
    }

    const fullPath = `${templatesPath}/${entry.template}`;
    const cmdId = `templater-obsidian:${fullPath}`;

    if (data.bindings.some((b) => b && b.id === cmdId)) {
      if (history) {
        history.push({
          event: "info",
          step: "slash_commander_bindings",
          name: manifest.name,
          binding_name: entry.name,
          command_id: cmdId,
          action: "skipped_existing",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    data.bindings.push({
      name: entry.name,
      id: cmdId,
      action: cmdId,
      icon: "templater-icon",
      mode: "any",
      triggerMode: "anywhere",
    });
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "slash_commander_bindings",
        name: manifest.name,
        binding_name: entry.name,
        command_id: cmdId,
        action: "applied",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  if (appended === 0) return;

  try {
    await adapter.write(`${target}.beacon-backup`, raw);
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `backup write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(data, null, 2));
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "slash_commander_bindings",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    new Notice(`applySlashCommanderBindings: write failed (${e.message}) for ${manifest.name}`, 8000);
  }
}

// pruneNavButtonsRegistry — drop contributions.<X> for any X not in the current
// subscription. Called once at the end of the install loop. Honors C4 hardening:
// a malformed pre-existing registry is left untouched and reported.
async function pruneNavButtonsRegistry(tp, subscription, history, git) {
  const adapter = tp.app.vault.adapter;
  const registryPath = "Docs/Meta/nav-buttons-registry.json";
  if (!(await adapter.exists(registryPath))) return;

  let raw;
  try {
    raw = await adapter.read(registryPath);
  } catch (e) {
    new Notice(`pruneNavButtonsRegistry: cannot read ${registryPath} (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "nav_buttons_prune",
        message: `read failed for ${registryPath}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (e) {
    new Notice(`pruneNavButtonsRegistry: ${registryPath} is malformed JSON (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "nav_buttons_prune",
        message: `${registryPath} is malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (registry === null || typeof registry !== "object" || Array.isArray(registry)) {
    new Notice(`pruneNavButtonsRegistry: ${registryPath} parsed but has unexpected shape (expected object). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "nav_buttons_prune",
        message: `${registryPath} parsed but has unexpected shape (expected object)`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (!registry.contributions) return;

  const subscribedNames = new Set([
    ...((subscription && subscription.mechanisms) || []).map((m) => m.name),
    ...((subscription && subscription.blueprints) || []).map((b) => b.name),
  ]);

  let mutated = false;
  for (const source of Object.keys(registry.contributions)) {
    if (!subscribedNames.has(source)) {
      delete registry.contributions[source];
      mutated = true;
    }
  }

  if (mutated) {
    await adapter.write(registryPath, JSON.stringify(registry, null, 2));
  }
}

// pruneInstalledLedger — drop entries from installedNow.mechanisms[] and
// installedNow.blueprints[] whose names are no longer in the current
// subscription. Symmetric with pruneNavButtonsRegistry: same C4 hardening,
// same Notice + history posture, same idempotency. installedNow.history[]
// is preserved verbatim — only NEW `prune` events are appended for each
// removed entry.
//
// DEVIATION FROM pruneNavButtonsRegistry: this function mutates the in-memory
// `installedNow` object instead of writing the on-disk file directly, because
// the install-loop's `finally` block writes `installedNow` back to the same
// path unconditionally. A disk-only mutation here would be silently clobbered.
// Disk is still read for malformed-JSON / shape-guard parity — if the on-disk
// state is unreadable or malformed, we Notice + record a history error and
// skip the prune entirely (do NOT mutate installedNow). The "write only when
// mutated" idempotency optimization is implicit: when nothing is removed, no
// history events are pushed and `installedNow` shape is unchanged, so the
// finally-block write is byte-identical to the prior on-disk content.
async function pruneInstalledLedger(tp, subscription, installedNow, git) {
  const adapter = tp.app.vault.adapter;
  const ledgerPath = "Docs/Meta/platform-installed.json";
  const history = installedNow.history;

  // First-install case: nothing on disk yet → no-op (installedNow is the
  // freshly-constructed default-shape object).
  if (!(await adapter.exists(ledgerPath))) return;

  let raw;
  try {
    raw = await adapter.read(ledgerPath);
  } catch (e) {
    new Notice(`pruneInstalledLedger: cannot read ${ledgerPath} (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "installed_ledger_prune",
        message: `read failed for ${ledgerPath}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  let onDisk;
  try {
    onDisk = JSON.parse(raw);
  } catch (e) {
    new Notice(`pruneInstalledLedger: ${ledgerPath} is malformed JSON (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "installed_ledger_prune",
        message: `${ledgerPath} is malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (onDisk === null || typeof onDisk !== "object" || Array.isArray(onDisk)) {
    new Notice(`pruneInstalledLedger: ${ledgerPath} parsed but has unexpected shape (expected object). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "installed_ledger_prune",
        message: `${ledgerPath} parsed but has unexpected shape (expected object)`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const subscribedNames = new Set([
    ...((subscription && subscription.mechanisms) || []).map((m) => m.name),
    ...((subscription && subscription.blueprints) || []).map((b) => b.name),
  ]);

  let mutated = false;

  const pruneBucket = (bucketKey, kind) => {
    const arr = installedNow[bucketKey];
    if (!Array.isArray(arr)) return;
    const kept = [];
    for (const entry of arr) {
      if (entry && entry.name && subscribedNames.has(entry.name)) {
        kept.push(entry);
      } else {
        mutated = true;
        if (history) {
          history.push({
            event: "prune",
            kind,
            name: (entry && entry.name) || "<unknown>",
            reason: "no longer subscribed",
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      }
    }
    installedNow[bucketKey] = kept;
  };

  pruneBucket("mechanisms", "mechanism");
  pruneBucket("blueprints", "blueprint");

  // No explicit write here — the install-loop's `finally` block persists
  // installedNow. When mutated === false, the finally write is byte-identical
  // to the prior on-disk state (idempotency parity with pruneNavButtonsRegistry).
  // `mutated` is intentionally declared so the function's shape stays parallel
  // and a future caller can be wired to a no-op short-circuit if needed.
  void mutated;
}

async function enableSnippet(tp, snippet, approvalRequired, sourceName, history, git) {
  const adapter = tp.app.vault.adapter;
  const path = ".obsidian/appearance.json";
  let json;
  if (await adapter.exists(path)) {
    let raw;
    try {
      raw = await adapter.read(path);
    } catch (e) {
      new Notice(`enableSnippet: cannot read ${path} (${e.message}). Skipping snippet enable for ${snippet} from ${sourceName || "?"}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "enableSnippet",
          name: sourceName,
          message: `read failed for ${path}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    try {
      json = JSON.parse(raw);
    } catch (e) {
      // C4: do NOT silently overwrite a malformed appearance.json.
      new Notice(`enableSnippet: ${path} is malformed JSON (${e.message}). Skipping snippet enable for ${snippet} from ${sourceName || "?"}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "enableSnippet",
          name: sourceName,
          message: `${path} is malformed JSON: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
  } else {
    // No file yet — safe to create.
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
