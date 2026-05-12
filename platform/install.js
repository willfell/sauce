// install.js — the per-vault installer. Runs as tp.user.platformInstall(tp).
//
// Reads:
//   <workshop>/platform/manifest.json               (workshop catalogue)
//   ranch/platform-config.json                  (this vault's path map + workshop_path)
//   ranch/platform-subscription.json            (what this vault wants)
//   ranch/platform-installed.json               (what's currently installed)
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

  const installed = (await readJson(app, "ranch/platform-installed.json")) || {
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
    const config = await readJson(app, "ranch/platform-config.json");
    const subscription = await readJson(app, "ranch/platform-subscription.json");

    if (!config) {
      new Notice("platformInstall: cannot read/parse ranch/platform-config.json. Aborting.", 6000);
      installedNow.history.push({ event: "error", step: "read_config", message: "ranch/platform-config.json missing or unparseable", git_commit: null, git_tag: null, git_dirty: null, attempted_at: new Date().toISOString() });
      return;
    }
    if (!subscription) {
      new Notice("platformInstall: cannot read/parse ranch/platform-subscription.json. Aborting.", 6000);
      installedNow.history.push({ event: "error", step: "read_subscription", message: "ranch/platform-subscription.json missing or unparseable", git_commit: null, git_tag: null, git_dirty: null, attempted_at: new Date().toISOString() });
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
      variables.content_path = "ranch/content";
    }

    // CF-3 (v0.24.0): align CustomJS plugin's jsFolder setting with the
    // consumer's scripts_path variable. CustomJS scans this dir at startup;
    // after Tree 3 rename (Docs/Meta -> ranch) every consumer's stale
    // jsFolder="Docs/Meta/Scripts" no longer resolves -> "SpaceNavButtons
    // unavailable" chips on every dataviewjs render. Run ONCE per install
    // run (not per-item) since CustomJS is foundational + platform-wide.
    await applyCustomJsSettings(tp, variables, installedNow.history, git);

    // v0.26.1 P1-2: write declared keys from workshopManifest.app_settings
    // into <vault>/.obsidian/app.json (additive shallow merge, platform-as-
    // overrider, backup-on-edit, atomic write). Workshop-level helper.
    await applyAppSettings(tp, manifest, installedNow.history, git);

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

    // 3b. validate claude_surface[] on every item manifest (v0.32.0 S1.1).
    //
    // Both blueprints AND mechanisms may declare a `claude_surface[]` field
    // that enumerates contributions to the Claude agent surface (slash
    // commands, SKILL.md bodies, CLAUDE.md rows, operator context docs).
    // The materializer + registry come in S2-S5; S1 is purely additive
    // validation — error events surface in history but never abort install
    // or skip the offending item.
    //
    // Schema:
    //   manifest.claude_surface (optional) — if present, MUST be an array.
    //   Each entry MUST have a `kind` in {command, skill, context_doc,
    //   claude_md_row} and the kind-specific required fields:
    //     - command       : { source: string, dest: string }
    //     - skill         : { source: string, dest: string }   (dest may contain {{skills_dir}})
    //     - context_doc   : { source: string, dest: string }   (dest may contain {{module_directory}})
    //     - claude_md_row : { table: "directory-map"|"resolvers"|"skills-index", row: object }
    //
    // Posture mirrors the module_directory validation pass: failure-loud
    // Notice + full git fields on every history push + attempted_at. Defensive
    // try/catch so a thrown validation never aborts the broader install.
    const VALID_CLAUDE_SURFACE_KINDS = new Set(["command", "skill", "context_doc", "claude_md_row"]);
    const VALID_CLAUDE_MD_TABLES = new Set(["directory-map", "resolvers", "skills-index"]);
    for (const [name, node] of nodes) {
      const itemMan = perItemManifest.get(name);
      if (!itemMan) continue;
      if (!("claude_surface" in itemMan)) continue;
      try {
        const cs = itemMan.claude_surface;
        if (!Array.isArray(cs)) {
          new Notice(`platformInstall: ${name} claude_surface must be an array; skipping field.`, 8000);
          installedNow.history.push({
            event: "error",
            step: "claude_surface_invalid",
            name,
            message: `${name} manifest.claude_surface must be an array (got ${typeof cs})`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
          continue;
        }
        for (let i = 0; i < cs.length; i++) {
          const entry = cs[i];
          if (!entry || typeof entry !== "object") {
            installedNow.history.push({
              event: "error",
              step: "claude_surface_invalid",
              name,
              index: i,
              message: `${name} claude_surface[${i}] is not an object`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
            continue;
          }
          const kind = entry.kind;
          if (typeof kind !== "string" || !VALID_CLAUDE_SURFACE_KINDS.has(kind)) {
            new Notice(`platformInstall: ${name} claude_surface[${i}] has unknown kind "${kind}".`, 6000);
            installedNow.history.push({
              event: "error",
              step: "claude_surface_invalid",
              name,
              index: i,
              kind,
              message: `${name} claude_surface[${i}] has invalid kind "${kind}" (must be one of: command, skill, context_doc, claude_md_row)`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
            continue;
          }
          if (kind === "command" || kind === "skill" || kind === "context_doc") {
            const missing = [];
            if (typeof entry.source !== "string" || entry.source.length === 0) missing.push("source");
            if (typeof entry.dest !== "string" || entry.dest.length === 0) missing.push("dest");
            if (missing.length > 0) {
              installedNow.history.push({
                event: "error",
                step: "claude_surface_invalid",
                name,
                index: i,
                kind,
                message: `${name} claude_surface[${i}] kind=${kind} missing required field(s): ${missing.join(", ")}`,
                git_commit: git.commit,
                git_tag: git.tag,
                git_dirty: git.dirty,
                attempted_at: new Date().toISOString(),
              });
            }
          } else if (kind === "claude_md_row") {
            const missing = [];
            if (typeof entry.table !== "string" || !VALID_CLAUDE_MD_TABLES.has(entry.table)) {
              missing.push(`table (must be one of: directory-map, resolvers, skills-index)`);
            }
            if (!entry.row || typeof entry.row !== "object" || Array.isArray(entry.row)) {
              missing.push("row (must be object)");
            }
            if (missing.length > 0) {
              installedNow.history.push({
                event: "error",
                step: "claude_surface_invalid",
                name,
                index: i,
                kind,
                message: `${name} claude_surface[${i}] kind=claude_md_row missing/invalid field(s): ${missing.join("; ")}`,
                git_commit: git.commit,
                git_tag: git.tag,
                git_dirty: git.dirty,
                attempted_at: new Date().toISOString(),
              });
            }
          }
        }
      } catch (e) {
        installedNow.history.push({
          event: "warning",
          step: "claude_surface_validation",
          name,
          message: `claude_surface validation threw: ${e.message}`,
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
        // Resolves to the namespaced full path "spice/<bare-name>" (per
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
          itemVars = { ...variables, module_directory: `spice/${itemMan.module_directory}` };
        }
        // v0.32.0 S1.2 — overlay skills_dir for ANY item (blueprint or
        // mechanism) that declares a non-empty skills_dir field. Generalized
        // from v0.30.0's blueprint-only form so mechanisms shipping Claude
        // Code skills via the new claude_surface[] manifest field can also
        // substitute {{skills_dir}} in their file destinations. The
        // module_directory overlay above remains blueprint-only.
        if (typeof itemMan.skills_dir === "string" && itemMan.skills_dir.length > 0) {
          if (itemVars === variables) {
            itemVars = { ...variables };
          }
          itemVars.skills_dir = itemMan.skills_dir;
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

    // 7. Subscription-aware pruning of ranch/nav-buttons-registry.json.
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

    // 8. Subscription-aware pruning of ranch/platform-installed.json
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
      await writeJson(app, "ranch/platform-installed.json", installedNow);
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

  // v0.3.0: ensure the blueprint's module_directory exists at install time.
  // Codifies landmine #11 — every blueprint owns spice/<module_directory>/ —
  // at the installer level. Historically the directory was created as a
  // side-effect of files[] writes there; blueprints whose files all land
  // under ranch/* (e.g., daily — Daily Notes plugin requires
  // spice/daily/ to pre-exist) need an explicit mkdir. Mechanisms exempt:
  // variables.module_directory is unset for non-blueprint installs per the
  // v0.2.0 T1.2 per-blueprint overlay logic; this guard is just truthiness.
  // Ordering rationale: AFTER applyPreInstall (so a pre_install delete that
  // cleared a stale spice/<old-name>/ directory has run before mkdir creates
  // the new one) and BEFORE the files[] loop (so any files[] dest under
  // {{module_directory}}/sub/... finds the parent already present). Three
  // outcomes — created / already_exists / error — recorded with full git
  // fields + attempted_at for parity with pre_install_delete events.
  if (variables && variables.module_directory) {
    const moduleDir = variables.module_directory;
    let mkdirAction = null;
    let mkdirError = null;
    // Check existence FIRST to distinguish created vs already_exists
    // deterministically across adapters. Obsidian's vault adapter throws when
    // mkdir hits an existing path; Node's fs.promises.mkdir({recursive:true})
    // is silently idempotent. Pre-checking unifies both behaviors and keeps
    // the harness assertions on the already_exists event meaningful.
    const preExisted = await adapter.exists(moduleDir);
    if (preExisted) {
      mkdirAction = "already_exists";
    } else {
      try {
        await adapter.mkdir(moduleDir);
        mkdirAction = "created";
      } catch (e) {
        // Race or permission — re-check existence; if present, treat as
        // already_exists (someone else created it between our check and call);
        // otherwise record the underlying error.
        if (await adapter.exists(moduleDir)) {
          mkdirAction = "already_exists";
        } else {
          mkdirError = e && e.message ? e.message : String(e);
        }
      }
    }
    if (history) {
      if (mkdirError) {
        new Notice(`installItem: ${mech.name} mkdir ${moduleDir} failed — ${mkdirError}`, 8000);
        history.push({
          event: "error",
          step: "module_directory",
          name: mech.name,
          path: moduleDir,
          message: `mkdir failed: ${mkdirError}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      } else {
        history.push({
          event: "info",
          step: "module_directory",
          name: mech.name,
          path: moduleDir,
          action: mkdirAction,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

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
    // The .bak suffix here (NOT .sauce-backup) is the file-content-overwrite
    // convention; v0.1.3's plugin-data convention uses .sauce-backup.
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

  // Aggregate nav-button declarations into ranch/nav-buttons-registry.json.
  // Failure here records history but does NOT throw — install of this item
  // is otherwise complete, and the registry is regenerated on every install.
  await applyNavButtons(tp, mech, variables, history, git);
  await applyExternalPlugins(tp, mech, history, git);
  await scaffoldFoundationalPluginData(tp, mech, workshopPath, variables, history, git);  // NEW v0.26.0
  await applyTemplaterHotkeys(tp, mech, variables, history, git);          // NEW v0.1.3
  await applySlashCommanderBindings(tp, mech, variables, history, git);    // NEW v0.1.3
  await applyTemplaterFolderTemplates(tp, mech, variables, history, git);  // NEW v0.4.0
  await applyCorePluginSettings(tp, mech, variables, history, git);        // NEW v0.3.0
  await applyCommunityPluginData(tp, mech, variables, history, git);       // NEW v0.21.1
  await applyVendoredThemes(tp, mech, workshopPath, target.path, history, git);  // NEW v0.19.0
  await applyAppearance(tp, mech, history, git);                                  // NEW v0.19.0
  await applyStyleSettings(tp, mech, workshopPath, target.path, history, git);    // NEW v0.19.0
  await applyHotkeys(tp, mech, history, git);                                     // NEW v0.21.1
  await materializeSkills(tp, workshopPath, target.path, mech, variables, history, git);  // NEW v0.30.0

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
  existing.contributions[sourceName] = existing.contributions[sourceName] || [];
  if (!Array.isArray(existing.contributions[sourceName])) {
    // Backward-compat: legacy single-value contribution. Wrap.
    existing.contributions[sourceName] = [existing.contributions[sourceName]];
  }
  existing.contributions[sourceName].push(frag.fragment);
  await adapter.write(rulePath, JSON.stringify(existing, null, 2));
}

// applyNavButtons — aggregate this item's nav_buttons[] declarations into
// ranch/nav-buttons-registry.json under contributions.<name>. Mirrors
// applyRuleFragment in posture: malformed pre-existing JSON is preserved
// (C4 hardening); per-entry validation skips bad entries without taking the
// whole contribution down; failures record history but do not throw.
async function applyNavButtons(tp, manifest, variables, history, git) {
  if (!manifest) return;
  // v0.2.0 fix: an empty/missing nav_buttons[] on a re-installing item must
  // PRUNE that item's prior contribution from the registry (otherwise stale
  // buttons from earlier versions persist forever — surfaced in v0.2.0 S2 when
  // project@0.3.0 retired its Board button but the v0.2.1-era entry remained).
  // We still need to read/write the registry to perform the prune, so we cannot
  // early-return on empty.
  const navButtonsArr = Array.isArray(manifest.nav_buttons) ? manifest.nav_buttons : [];
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/nav-buttons-registry.json";

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

  // Empty declared nav_buttons[] → prune any prior contribution + return early
  // (no need to write if there was nothing to prune).
  if (navButtonsArr.length === 0) {
    if (manifest.name in registry.contributions) {
      delete registry.contributions[manifest.name];
      await adapter.write(registryPath, JSON.stringify(registry, null, 2));
      if (history) {
        history.push({
          event: "info",
          step: "nav_buttons",
          name: manifest.name,
          action: "pruned_empty_declaration",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
    return;
  }

  const validated = navButtonsArr
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
    const contentPath = variables.content_path || "ranch/content";
    // v0.2.0 fix: substitute {{xxx}} placeholders in the target path using the
    // current item's variables overlay (which already includes the per-blueprint
    // {{module_directory}} → "spice/<bare-name>" mapping per T1.2). Stores
    // resolved literals in the registry so the renderer dispatches without
    // needing per-blueprint substitution context at click time.
    const resolvedTarget = substituteLenient(btn.action.target || "", variables);
    return {
      ...btn,
      action: {
        ...btn.action,
        target: resolvedTarget,
        template_source: `${contentPath}/${sourceName}/${btn.action.template_source}`,
      },
    };
  }
  if (btn.action.type === "runTemplaterTemplate" && btn.action.template_source) {
    const templatesPath = variables.templates_path || "ranch/templates";
    if (typeof btn.action.folder_prefix !== "string" || btn.action.folder_prefix.length === 0) {
      new Notice(`nav-buttons: invalid runTemplaterTemplate in ${sourceName} (missing required folder_prefix)`, 8000);
      if (history) {
        history.push({
          event: "warning",
          step: "nav_buttons",
          name: sourceName,
          reason: `entry ${btn.id || "<no-id>"} missing folder_prefix`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return null;
    }
    return {
      ...btn,
      action: {
        ...btn.action,
        folder_prefix:         substituteLenient(btn.action.folder_prefix, variables),
        folder_date_pattern:   typeof btn.action.folder_date_pattern === "string" ? btn.action.folder_date_pattern : "",
        filename_prefix:       substituteLenient(btn.action.filename_prefix || "", variables),
        filename_date_pattern: typeof btn.action.filename_date_pattern === "string" ? btn.action.filename_date_pattern : "",
        filename_suffix:       substituteLenient(btn.action.filename_suffix || "", variables),
        template_source: `${templatesPath}/${btn.action.template_source}`,
      },
    };
  }
  if (btn.action.type === "openLink" && btn.action.target) {
    return {
      ...btn,
      action: {
        ...btn.action,
        target: substituteLenient(btn.action.target, variables),
      },
    };
  }
  if (btn.action.type === "invoke_command" && btn.action.command_id) {
    // v0.31.0 / nav-buttons@2.6.0: optional args object (string→string map).
    // Literal passthrough — values are user-authored at manifest time and reach
    // the renderer as-typed (NO substituteLenient). Malformed args (non-object
    // or non-string values) are dropped with a history warning; install proceeds.
    if (btn.action.args === undefined || btn.action.args === null) {
      return btn;  // passthrough; command_id preserved literally for runtime dispatch
    }
    const isPlainObject = typeof btn.action.args === "object" && !Array.isArray(btn.action.args);
    const allStringValues = isPlainObject
      && Object.values(btn.action.args).every((v) => typeof v === "string");
    if (!isPlainObject || !allStringValues) {
      new Notice(`nav-buttons: invoke_command args malformed in ${sourceName} (entry ${btn.id}); dropping args`, 8000);
      if (history) {
        history.push({
          event: "warning",
          step: "nav_buttons",
          name: sourceName,
          reason: `entry ${btn.id} invoke_command args malformed (must be {[string]: string}); dropped`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      const { args: _drop, ...restAction } = btn.action;
      return { ...btn, action: restAction };
    }
    return btn;  // valid args: literal passthrough (no substitution)
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
// in favor of spice/boards/To-Do-Board.md). Failure-loud, never throws.
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

// FOUNDATIONAL_PLUGIN_DEFAULTS — minimal valid data.json shapes for plugins
// that require pre-existing config when they first start. Keyed by plugin id;
// value is a function (variables) => object so substitution from variables
// (e.g., templates_path) is honored. Only plugins that need pre-install
// scaffolding belong here — customjs and dataview do NOT (no required schema
// at startup; their data.json is created by Obsidian itself).
//
// v0.26.0 P0-2 — closes the "6 silent helper-skips on fresh install" symptom
// where applyTemplaterHotkeys + applyTemplaterFolderTemplates skip because
// .obsidian/plugins/templater-obsidian/data.json doesn't exist yet.
const FOUNDATIONAL_PLUGIN_DEFAULTS = {
  "templater-obsidian": (variables) => ({
    // CF-1 (v0.26.0 S4 acceptance smoke): scaffold MUST include the array
    // fields downstream helpers (applyTemplaterHotkeys, applyTemplaterFolderTemplates)
    // read additively. Without enabled_templates_hotkeys: [], the hotkeys helper
    // errors on read with "enabled_templates_hotkeys not an array" because the
    // first thing it does is JSON.parse + array-shape validation. Folder-templates
    // helper similarly expects folder_templates: [] to merge into.
    //
    // Fields kept minimal — Templater's own defaults fill in everything else
    // when the plugin starts. These four are the ones our installer logic
    // touches at install time.
    templates_folder: variables.templates_path || "ranch/templates",
    trigger_on_file_creation: true,
    enable_folder_templates: true,
    folder_templates: [],
    enabled_templates_hotkeys: [],
    startup_templates: [],
    enable_system_commands: true
  })
};

// scaffoldFoundationalPluginData — for plugins that need a minimal valid
// data.json before they first start (e.g. templater-obsidian's
// templates_folder + folder_templates), materialize defaults from the
// FOUNDATIONAL_PLUGIN_DEFAULTS registry when the plugin dir exists but
// data.json is absent. Idempotent (skip-if-present). Failure-loud (Notice +
// history; never throws). Atomic write (tmp + rename). NO backup suffix —
// this helper only writes when the file is ABSENT.
//
// Path-traversal validator on plugin id (mirrors v0.21.1 lesson). Unknown
// ids are silent no-ops (registry is opt-in; many declared external_plugins
// don't need pre-install scaffolding). Candidate ids gathered from item
// manifest.external_plugins[] + manifest.foundational_plugins[] PLUS the
// workshop-level manifest.foundational_plugins[] (read best-effort from
// disk; failure to read does NOT throw).
//
// v0.26.0 P0-2 — closes the fresh-install gap where the 6 helpers
// (applyTemplaterHotkeys + applyTemplaterFolderTemplates across
// validator/audit/to-do/journal/meetings/finance) silently skip because
// Obsidian hasn't created data.json yet.
async function scaffoldFoundationalPluginData(tp, manifest, workshopPath, variables, history, git) {
  if (!manifest) return;
  const fs = require("fs");
  const path = require("path");

  function _validId(id) {
    return typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/i.test(id);
  }

  // Gather candidate plugin ids from per-item declarations + workshop manifest.
  const ids = new Set();
  if (Array.isArray(manifest.external_plugins)) {
    for (const dep of manifest.external_plugins) {
      if (dep && typeof dep.id === "string" && _validId(dep.id)) ids.add(dep.id);
    }
  }
  if (Array.isArray(manifest.foundational_plugins)) {
    for (const dep of manifest.foundational_plugins) {
      if (dep && typeof dep.id === "string" && _validId(dep.id)) ids.add(dep.id);
    }
  }
  // Best-effort workshop-level read: failure to read does NOT throw.
  try {
    const workshopManifestPath = path.join(workshopPath, "platform/manifest.json");
    if (fs.existsSync(workshopManifestPath)) {
      const raw = fs.readFileSync(workshopManifestPath, "utf8");
      const wm = JSON.parse(raw);
      if (wm && Array.isArray(wm.foundational_plugins)) {
        for (const dep of wm.foundational_plugins) {
          if (dep && typeof dep.id === "string" && _validId(dep.id)) ids.add(dep.id);
        }
      }
    }
  } catch { /* best-effort; never throws */ }

  if (ids.size === 0) return;

  // I-3 (v0.26.0 quality review): defensive — getBasePath() can throw or return
  // undefined on adapters that don't expose it. Failure-loud + early-return keeps
  // the helper non-fatal to install when the vault adapter is non-standard.
  let basePath;
  try {
    basePath = tp.app.vault.adapter.getBasePath();
  } catch (e) {
    new Notice(`scaffoldFoundationalPluginData: vault adapter getBasePath unavailable (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "scaffold_foundational",
        name: manifest.name,
        item: manifest.name,
        action: "adapter_unavailable",
        error: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (!basePath || typeof basePath !== "string") {
    if (history) {
      history.push({
        event: "error",
        step: "scaffold_foundational",
        name: manifest.name,
        item: manifest.name,
        action: "adapter_unavailable",
        error: "getBasePath returned non-string",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const id of ids) {
    // Unknown id: silent no-op. Registry is opt-in.
    const factory = FOUNDATIONAL_PLUGIN_DEFAULTS[id];
    if (typeof factory !== "function") continue;

    const pluginDir = path.join(basePath, ".obsidian/plugins", id);
    const dataPath = path.join(pluginDir, "data.json");
    const relDataPath = `.obsidian/plugins/${id}/data.json`;

    // Plugin dir must exist; otherwise skip.
    let dirOk = false;
    try {
      dirOk = fs.statSync(pluginDir).isDirectory();
    } catch {
      dirOk = false;
    }
    if (!dirOk) {
      if (history) {
        history.push({
          event: "info",
          step: "scaffold_foundational",
          name: manifest.name,
          item: manifest.name,
          id,
          action: "skipped_missing_plugin_dir",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // data.json already present: skip (no overwrite).
    let dataExists = false;
    try {
      fs.statSync(dataPath);
      dataExists = true;
    } catch {
      dataExists = false;
    }
    if (dataExists) {
      if (history) {
        history.push({
          event: "info",
          step: "scaffold_foundational",
          name: manifest.name,
          item: manifest.name,
          id,
          action: "skipped_already_present",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // Atomic write: tmp + rename. No backup since data.json was absent.
    try {
      const defaults = factory(variables || {});
      const body = JSON.stringify(defaults, null, 2);
      const tmpPath = `${dataPath}.tmp`;
      fs.writeFileSync(tmpPath, body, "utf8");
      fs.renameSync(tmpPath, dataPath);
      if (history) {
        history.push({
          event: "info",
          step: "scaffold_foundational",
          name: manifest.name,
          item: manifest.name,
          id,
          action: "scaffolded",
          path: relDataPath,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      new Notice(`scaffoldFoundationalPluginData: write failed for ${relDataPath} (${e.message})`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "scaffold_foundational",
          name: manifest.name,
          item: manifest.name,
          id,
          action: "write_failed",
          error: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      // Failure-loud, do not throw — install continues.
    }
  }
}

// applyTemplaterHotkeys — for each item that declares templater_hotkeys[],
// read .obsidian/plugins/templater-obsidian/data.json and additive-merge each
// entry's full template path into enabled_templates_hotkeys[]. Idempotent
// (skip if already present). Failure-loud (Notice + history). Backup-on-edit
// to <target>.sauce-backup. Honors landmine #12 — never overwrites a
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
    await adapter.write(`${target}.sauce-backup`, raw);
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

// applyHotkeys — for each item that declares manifest.hotkeys[], merge into
// `.obsidian/hotkeys.json` with first-wins semantics on command_id. Mirrors
// applyTemplaterHotkeys posture (read/parse/validate -> backup-on-edit -> write)
// but creates the target fresh when absent and skips the variables.templates_path
// dependency. NEW v0.21.1.
async function applyHotkeys(tp, manifest, history, git) {
  if (!manifest || !Array.isArray(manifest.hotkeys) || manifest.hotkeys.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/hotkeys.json";
  const validModifiers = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

  let raw = null;
  let existing = {};
  if (await adapter.exists(target)) {
    try {
      raw = await adapter.read(target);
    } catch (e) {
      new Notice(`applyHotkeys: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "hotkeys",
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

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      new Notice(`applyHotkeys: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "hotkeys",
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

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      new Notice(`applyHotkeys: ${target} parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "hotkeys",
          name: manifest.name,
          message: `${target} parsed but is not a JSON object`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }

    existing = parsed;
  }

  let appended = 0;
  for (const entry of manifest.hotkeys) {
    const cid = entry && entry.command_id;
    const isValid =
      entry &&
      typeof cid === "string" && cid.length > 0 &&
      Array.isArray(entry.modifiers) &&
      entry.modifiers.every((m) => validModifiers.includes(m)) &&
      typeof entry.key === "string" && entry.key.length > 0;

    if (!isValid) {
      new Notice(`applyHotkeys: ${manifest.name} invalid hotkey entry; skipped`, 6000);
      if (history) {
        history.push({
          event: "warning",
          step: "hotkeys",
          name: manifest.name,
          command_id: (cid && typeof cid === "string") ? cid : "<missing>",
          message: "invalid_entry",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (Array.isArray(existing[cid]) && existing[cid].length > 0) {
      if (history) {
        history.push({
          event: "info",
          step: "hotkeys",
          name: manifest.name,
          command_id: cid,
          action: "skipped_existing",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    existing[cid] = [{ modifiers: [...entry.modifiers], key: entry.key }];
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "hotkeys",
        name: manifest.name,
        command_id: cid,
        action: "applied",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  if (appended === 0) return;

  // Backup before write (one-deep, overwrite-on-edit). Only when target pre-existed.
  if (raw !== null) {
    try {
      await adapter.write(`${target}.sauce-backup`, raw);
    } catch (e) {
      new Notice(`applyHotkeys: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "hotkeys",
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
  }

  try {
    await adapter.write(target, JSON.stringify(existing, null, 2));
  } catch (e) {
    new Notice(`applyHotkeys: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "hotkeys",
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

// materializeSkills — copy <workshop>/platform/<bp>/<entry.source> →
// <vault>/<entry.dest> for each item in manifest.skills[]. Mirrors the
// installItem files[] loop's Option B overwrite mechanics (identical-skip,
// .bak-on-edit, no-bak on fresh/zero-byte). NEW v0.30.0 for the cowork
// blueprint which materializes native Claude Code skill bodies into
// <vault>/.claude/skills/<subtree>/. Skill bodies are markdown with YAML
// frontmatter; the Option B + .bak posture matches files[] so users hand-
// editing a SKILL.md get their edits backed up on next sauce update.
//
// Posture vs files[]: invalid entries (missing source/dest) record a history
// warning and SKIP rather than abort, because skill arrays may grow to 30+
// entries and one bad row shouldn't block the rest. files[] aborts on bad
// rows because it's a smaller, hand-curated list.
async function materializeSkills(tp, workshopPath, targetPath, mech, variables, history, git) {
  if (!mech || !Array.isArray(mech.skills) || mech.skills.length === 0) return;
  const adapter = tp.app.vault.adapter;
  for (const entry of mech.skills) {
    if (!entry || typeof entry.source !== "string" || entry.source.length === 0 ||
        typeof entry.dest !== "string" || entry.dest.length === 0) {
      if (history) {
        history.push({
          event: "warning",
          step: "materialize_skill_invalid_entry",
          name: mech.name,
          message: `skipping skill entry: missing source or dest (source=${entry && entry.source}, dest=${entry && entry.dest})`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    const sourceAbs = `${workshopPath}/platform/${targetPath}/${entry.source}`;
    const sourceText = await readAbsolute(sourceAbs);
    if (sourceText === null) {
      new Notice(`materializeSkills: source missing: ${sourceAbs}`, 4000);
      if (history) {
        history.push({
          event: "error",
          step: "materialize_skill_source_missing",
          name: mech.name,
          source: entry.source,
          message: `source absent at ${sourceAbs}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    let destPath, substituted;
    try {
      destPath = substituteStrict(entry.dest, variables);
    } catch (e) {
      new Notice(`materializeSkills: ${mech.name} ${entry.source} dest path — ${e.message}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "materialize_skill_substitution",
          name: mech.name,
          source: entry.source,
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    substituted = substituteLenient(sourceText, variables);

    const destDir = destPath.includes("/") ? destPath.substring(0, destPath.lastIndexOf("/")) : "";
    if (destDir && !(await adapter.exists(destDir))) {
      await adapter.mkdir(destDir);
    }

    const destExists = await adapter.exists(destPath);
    let priorContent = null;
    if (destExists) {
      try {
        priorContent = await adapter.read(destPath);
      } catch (e) {
        if (history) {
          history.push({
            event: "warning",
            step: "materialize_skill_overwrite",
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
      // Identical — idempotent skip.
      continue;
    }
    if (priorContent !== null && priorContent.length > 0) {
      const crypto = require("crypto");
      const priorSha = crypto.createHash("sha256").update(priorContent).digest("hex");
      const newSha = crypto.createHash("sha256").update(substituted).digest("hex");
      const bakPath = `${destPath}.bak`;
      try {
        await adapter.write(bakPath, priorContent);
      } catch (e) {
        new Notice(`materializeSkills: bak write failed for ${destPath} — ${e.message}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "materialize_skill_overwrite",
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
          step: "materialize_skill_overwrite",
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
      await adapter.write(destPath, substituted);
    }
  }
}

// applyCustomJsSettings — write .obsidian/plugins/customjs/data.json's
// jsFolder field to match the consumer's scripts_path variable. NEW v0.24.0
// (CF-3 of v0.24.0 Tree 3 rename). Mirrors applyHotkeys posture
// (read/parse/validate -> backup-on-edit -> write). Idempotent: skips write
// when jsFolder is already set to scripts_path. Surgical migration: only
// overwrites the legacy value "Docs/Meta/Scripts" or absent/empty values
// (preserves user-customized jsFolder).
async function applyCustomJsSettings(tp, variables, history, git) {
  const adapter = tp.app.vault.adapter;
  const pluginDir = ".obsidian/plugins/customjs";
  const target = `${pluginDir}/data.json`;
  const desired = (variables && typeof variables.scripts_path === "string") ? variables.scripts_path : null;

  if (!desired) return;
  // Path-traversal guard.
  if (desired.startsWith("/") || desired.startsWith("..") || desired.includes("../") || desired.includes("\\")) {
    new Notice(`applyCustomJsSettings: refusing suspicious scripts_path '${desired}'`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_settings",
        message: `refused suspicious scripts_path: ${desired}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Foundational prereq: customjs plugin dir must exist (vendored by bootstrap).
  if (!(await adapter.exists(pluginDir))) {
    if (history) {
      history.push({
        event: "info",
        step: "customjs_settings",
        action: "skipped_missing_prereq",
        message: `${pluginDir} absent`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let raw = null;
  let existing = {};
  if (await adapter.exists(target)) {
    try {
      raw = await adapter.read(target);
    } catch (e) {
      new Notice(`applyCustomJsSettings: cannot read ${target} (${e.message}); skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "customjs_settings",
          message: `read failed for ${target}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      new Notice(`applyCustomJsSettings: ${target} malformed JSON (${e.message}); skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "customjs_settings",
          message: `${target} malformed JSON: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      new Notice(`applyCustomJsSettings: ${target} parsed but is not a JSON object; skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "customjs_settings",
          message: `${target} parsed but is not a JSON object`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }

    existing = parsed;
  }

  const current = existing.jsFolder;
  const isLegacyDocsmeta = (typeof current === "string" && current === "Docs/Meta/Scripts");
  const isAbsentOrEmpty = (current === undefined || current === null || current === "");
  const alreadyDesired = (current === desired);

  if (alreadyDesired) {
    if (history) {
      history.push({
        event: "info",
        step: "customjs_settings",
        action: "noop_already_desired",
        jsFolder: desired,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Surgical: only overwrite legacy v0.23.x value OR absent. Preserve any
  // other user-customized jsFolder (e.g., a user who runs CustomJS classes
  // out of a non-platform dir for development).
  if (!isLegacyDocsmeta && !isAbsentOrEmpty) {
    if (history) {
      history.push({
        event: "info",
        step: "customjs_settings",
        action: "skipped_user_customized",
        jsFolder: current,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  existing.jsFolder = desired;
  // Provide expected default fields when starting fresh — keeps the file
  // shape recognizable to the CustomJS plugin without forcing schema drift.
  if (existing.jsFiles === undefined) existing.jsFiles = "";
  if (existing.startupScriptNames === undefined) existing.startupScriptNames = [];
  if (existing.registeredInvocableScriptNames === undefined) existing.registeredInvocableScriptNames = [];
  if (existing.rerunStartupScriptsOnFileChange === undefined) existing.rerunStartupScriptsOnFileChange = false;

  if (raw !== null) {
    try {
      await adapter.write(`${target}.sauce-backup`, raw);
    } catch (e) {
      new Notice(`applyCustomJsSettings: backup write failed (${e.message}); aborting`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "customjs_settings",
          message: `backup write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
  }

  try {
    await adapter.write(target, JSON.stringify(existing, null, 2));
    if (history) {
      history.push({
        event: "info",
        step: "customjs_settings",
        action: isLegacyDocsmeta ? "migrated_legacy" : "applied_fresh",
        jsFolder: desired,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    new Notice(`applyCustomJsSettings: write failed (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_settings",
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyAppSettings — write declared keys from workshopManifest.app_settings
// into <vault>/.obsidian/app.json. NEW v0.26.1 (P1-2). Workshop-level helper
// (runs ONCE per install run, NOT per-item). Mirrors applyCustomJsSettings
// posture: additive shallow merge, backup-on-edit (.sauce-backup), atomic write
// (tmp + rename), malformed-JSON guard, failure-loud history under step
// "app_settings". Platform-as-overrider for declared keys (NOT first-wins) —
// the platform DECLARES alwaysOpenInNewTab as a vault baseline; user's other
// app.json keys are preserved verbatim.
async function applyAppSettings(tp, workshopManifest, history, git) {
  if (!workshopManifest || !workshopManifest.app_settings ||
      typeof workshopManifest.app_settings !== "object" ||
      Object.keys(workshopManifest.app_settings).length === 0) {
    return; // silent no-op when no settings declared
  }

  let basePath;
  try {
    basePath = tp.app.vault.adapter.getBasePath();
  } catch (e) {
    new Notice(`applyAppSettings: vault adapter getBasePath unavailable (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "app_settings",
        action: "error",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (!basePath || typeof basePath !== "string") {
    if (history) {
      history.push({
        event: "error",
        step: "app_settings",
        action: "error",
        message: "getBasePath returned non-string",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const obsidianDir = require("path").join(basePath, ".obsidian");
  if (!require("fs").existsSync(obsidianDir)) {
    if (history) {
      history.push({
        event: "info",
        step: "app_settings",
        action: "skipped_obsidian_dir_absent",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const target = require("path").join(obsidianDir, "app.json");
  let existing = {};
  const targetExisted = require("fs").existsSync(target);
  if (targetExisted) {
    let raw;
    try {
      raw = require("fs").readFileSync(target, "utf8");
    } catch (e) {
      new Notice(`applyAppSettings: cannot read ${target} (${e.message}); skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "app_settings",
          action: "error",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      new Notice(`applyAppSettings: ${target} malformed JSON (${e.message}); skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "app_settings",
          action: "error",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      new Notice(`applyAppSettings: ${target} parsed but not a JSON object; skipping`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "app_settings",
          action: "error",
          message: "malformed shape",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    existing = parsed;
  }

  // Backup-on-edit BEFORE write (only if file existed; create-from-scratch needs no backup).
  if (targetExisted) {
    try {
      require("fs").copyFileSync(target, target + ".sauce-backup");
    } catch (e) {
      new Notice(`applyAppSettings: backup write failed (${e.message}); aborting`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "app_settings",
          action: "error",
          message: `backup failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
  }

  // Additive shallow merge: platform-as-overrider for declared keys.
  const merged = { ...existing, ...workshopManifest.app_settings };

  // Atomic write: tmp + rename.
  const tmp = target + ".tmp";
  try {
    require("fs").writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
    require("fs").renameSync(tmp, target);
  } catch (e) {
    new Notice(`applyAppSettings: write failed (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "app_settings",
        action: "error",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (history) {
    history.push({
      event: "info",
      step: "app_settings",
      action: "applied",
      keys_written: Object.keys(workshopManifest.app_settings),
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
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
    await adapter.write(`${target}.sauce-backup`, raw);
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

// applyTemplaterFolderTemplates — for each item that declares
// templater_folder_templates[], read .obsidian/plugins/templater-obsidian/data.json
// and additive-merge each entry into folder_templates[]. Match-by-folder; first-wins
// idempotency. Empty-default placeholder {folder:"", template:""} is replaced
// on first-write rather than appended-alongside (Templater seeds it on plugin first-init).
// Failure-loud (Notice + history). Backup-on-edit to <target>.sauce-backup.
// Honors landmine #12 — never overwrites a malformed data.json; never strips user entries.
async function applyTemplaterFolderTemplates(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.templater_folder_templates) || manifest.templater_folder_templates.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/templater-obsidian/data.json";

  if (!(await adapter.exists(target))) {
    new Notice(`applyTemplaterFolderTemplates: ${target} absent; cannot register folder-templates for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `${target} absent`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplates: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `read failed for ${target}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplates: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.folder_templates)) {
    new Notice(`applyTemplaterFolderTemplates: ${target} parsed but folder_templates not an array; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `${target} folder_templates not an array`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let appended = 0;
  for (const entry of manifest.templater_folder_templates) {
    if (!entry || typeof entry.folder !== "string" || typeof entry.template !== "string") {
      if (history) {
        history.push({
          event: "warning",
          step: "templater_folder_templates",
          name: manifest.name,
          message: "invalid entry shape",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    const resolvedFolder = substituteLenient(entry.folder, variables);
    const resolvedTemplate = substituteLenient(entry.template, variables);
    if (!resolvedFolder || !resolvedTemplate) {
      if (history) {
        history.push({
          event: "warning",
          step: "templater_folder_templates",
          name: manifest.name,
          message: "empty folder or template after substitution",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    const emptyDefaultIdx = data.folder_templates.findIndex(ft =>
      ft && ft.folder === "" && ft.template === ""
    );

    const existingIdx = data.folder_templates.findIndex(ft => ft && ft.folder === resolvedFolder);
    if (existingIdx >= 0) {
      const existing = data.folder_templates[existingIdx];
      if (existing.template === resolvedTemplate) {
        if (history) {
          history.push({
            event: "info",
            step: "templater_folder_templates",
            name: manifest.name,
            folder: resolvedFolder,
            template: resolvedTemplate,
            action: "skipped_existing",
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
      if (history) {
        history.push({
          event: "warning",
          step: "templater_folder_templates",
          name: manifest.name,
          folder: resolvedFolder,
          message: `user override preserved (existing template "${existing.template}" differs from manifest "${resolvedTemplate}")`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (emptyDefaultIdx >= 0 && data.folder_templates.length === 1) {
      data.folder_templates[emptyDefaultIdx] = { folder: resolvedFolder, template: resolvedTemplate };
    } else {
      data.folder_templates.push({ folder: resolvedFolder, template: resolvedTemplate });
    }
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "templater_folder_templates",
        name: manifest.name,
        folder: resolvedFolder,
        template: resolvedTemplate,
        action: "applied",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  if (appended === 0) return;

  try {
    await adapter.write(`${target}.sauce-backup`, raw);
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplates: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `backup write failed: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(data, null, 2));
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplates: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyCorePluginSettings — for each item that declares core_plugin_settings[],
// read .obsidian/<entry.id>.json and additive-merge the declared settings.
// Top-level shallow merge: keys in entry.settings overwrite existing top-level
// keys; nested objects are replaced wholesale; pre-existing keys NOT declared
// in entry.settings are preserved.
//
// Posture (mirrors v0.1.3 applyTemplaterHotkeys / applySlashCommanderBindings):
//   - Idempotent skip-write: if shallow-merged result === existing structurally,
//     emit info/skipped_existing event and skip both backup write AND target write.
//   - Backup-on-edit: when there's pre-existing content to back up, write the
//     raw pre-edit body to <target>.sauce-backup BEFORE overwriting the live file.
//     If the target file is absent, create it directly with no backup.
//   - Malformed-JSON guard: never overwrite a file we can't parse; record an
//     error and skip — no backup, no live write.
//   - Failure-loud history: every failure path emits an error event under
//     step:"core_plugin_settings" with full git fields + attempted_at.
//   - Substitution: settings values are substituted via substituteLenient using
//     the per-item variables overlay (so blueprints get {{module_directory}}).
//     Substitution variable values must be JSON-safe scalars (no embedded `"`,
//     `\`, or control chars) — round-trip is JSON.stringify → substitute → JSON.parse,
//     so an unsafe value triggers a parse error and we fail closed (no live write).
//     TODO(v0.3.x): substitute on the parsed object tree to remove this constraint.
//
// Targets Obsidian CORE plugin data files at .obsidian/<id>.json (e.g.,
// daily-notes, periodic-notes). Distinct from community-plugin data which
// lives at .obsidian/plugins/<id>/data.json (handled by applyTemplaterHotkeys
// and applySlashCommanderBindings).
async function applyCorePluginSettings(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.core_plugin_settings) || manifest.core_plugin_settings.length === 0) return;
  const adapter = tp.app.vault.adapter;

  for (const entry of manifest.core_plugin_settings) {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      new Notice(`applyCorePluginSettings: ${manifest.name} has invalid entry.id; skipped`, 6000);
      if (history) {
        history.push({
          event: "warning",
          step: "core_plugin_settings",
          name: manifest.name,
          message: "invalid_id",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    const target = `.obsidian/${entry.id}.json`;

    // Substitute placeholders in settings values via substituteLenient.
    // Round-trip via JSON to apply substitution to every string value at any
    // nesting level (per locked decision: nested objects are replaced wholesale,
    // but their string values are still substituted on the way through).
    let substituted;
    try {
      const sourceJson = JSON.stringify(entry.settings || {});
      substituted = JSON.parse(substituteLenient(sourceJson, variables));
    } catch (e) {
      new Notice(`applyCorePluginSettings: ${manifest.name} substitution failed for ${entry.id} — ${e.message}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "core_plugin_settings",
          name: manifest.name,
          plugin_id: entry.id,
          message: `substitution failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    let raw = "";
    let existing = {};
    if (await adapter.exists(target)) {
      try {
        raw = await adapter.read(target);
      } catch (e) {
        new Notice(`applyCorePluginSettings: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "core_plugin_settings",
            name: manifest.name,
            plugin_id: entry.id,
            message: `read failed for ${target}: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      try {
        existing = JSON.parse(raw);
      } catch (e) {
        new Notice(`applyCorePluginSettings: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "core_plugin_settings",
            name: manifest.name,
            plugin_id: entry.id,
            message: `${target} malformed JSON: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
        new Notice(`applyCorePluginSettings: ${target} parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "core_plugin_settings",
            name: manifest.name,
            plugin_id: entry.id,
            message: `${target} parsed but is not a JSON object`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }

    // Shallow merge: substituted (manifest) wins on key collisions.
    const merged = Object.assign({}, existing, substituted);
    const mergedSerialized = JSON.stringify(merged, null, 2);

    // Idempotent skip-write: structural equality between merged and existing.
    if (raw && JSON.stringify(existing, null, 2) === mergedSerialized) {
      if (history) {
        history.push({
          event: "info",
          step: "core_plugin_settings",
          name: manifest.name,
          plugin_id: entry.id,
          action: "skipped_existing",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // Backup-on-edit: only when there is pre-existing content to back up.
    let backupPath = null;
    if (raw) {
      backupPath = `${target}.sauce-backup`;
      try {
        await adapter.write(backupPath, raw);
      } catch (e) {
        new Notice(`applyCorePluginSettings: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "core_plugin_settings",
            name: manifest.name,
            plugin_id: entry.id,
            message: `backup write failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }

    try {
      await adapter.write(target, mergedSerialized);
    } catch (e) {
      new Notice(`applyCorePluginSettings: write failed (${e.message}) for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "core_plugin_settings",
          name: manifest.name,
          plugin_id: entry.id,
          message: `write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (history) {
      history.push({
        event: "info",
        step: "core_plugin_settings",
        name: manifest.name,
        plugin_id: entry.id,
        action: "applied",
        settings_keys: Object.keys(substituted),
        backup_path: backupPath,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyCommunityPluginData — for each item that declares community_plugin_settings[],
// merge per-plugin settings into .obsidian/plugins/<id>/data.json. Mirrors the
// applyCorePluginSettings posture (additive shallow merge, backup-on-edit to
// <target>.sauce-backup, malformed-JSON guard, idempotent skip-write,
// failure-loud history). Differences from applyCorePluginSettings:
//   - Target path is .obsidian/plugins/<id>/data.json (NOT .obsidian/<id>.json).
//   - Prereq gate at the top via _externalPluginsSatisfied (NEW v0.19.0 lesson:
//     helpers that materialize state need a stronger prereq contract than
//     helpers that read existing state — short-circuit before any writes).
//   - Path-traversal validator on id (rejects "/", "\", "..").
//   - Plugin-dir-absent skip per entry (info/skipped_plugin_dir_absent).
async function applyCommunityPluginData(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.community_plugin_settings) || manifest.community_plugin_settings.length === 0) return;

  const adapter = tp.app.vault.adapter;

  // Prereq gate: delegate to the canonical _externalPluginsSatisfied helper
  // (honors required:true entries). For applyCommunityPluginData specifically
  // we additionally treat ALL external_plugins[] as prereqs (whether or not
  // they're flagged required:true), since materializing settings into a
  // plugin's data.json without that plugin enabled would be a wasted write
  // and risks silent drift on next consumer reload.
  const canonical = await _externalPluginsSatisfied(tp, manifest);
  let allDeclaredIds = (manifest && Array.isArray(manifest.external_plugins))
    ? manifest.external_plugins.filter((e) => e && typeof e.id === "string" && e.id.length > 0).map((e) => e.id)
    : [];
  let extraMissing = [];
  if (allDeclaredIds.length > 0) {
    const cpPath = ".obsidian/community-plugins.json";
    let enabledIds = null;
    try {
      if (await adapter.exists(cpPath)) {
        const raw = await adapter.read(cpPath);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) enabledIds = new Set(parsed);
      }
    } catch (e) {
      // Conservative: treat as empty so all declared ids are missing.
      enabledIds = null;
    }
    if (enabledIds === null) {
      extraMissing = allDeclaredIds.slice();
    } else {
      extraMissing = allDeclaredIds.filter((id) => !enabledIds.has(id));
    }
  }
  if (!canonical.ok || extraMissing.length > 0) {
    const merged = Array.from(new Set([...(canonical.missingIds || []), ...extraMissing]));
    new Notice(`applyCommunityPluginData: ${manifest.name} prereq plugins missing (${merged.join(",")}); skipped`, 6000);
    if (history) {
      history.push({
        event: "info",
        step: "community_plugin_data",
        name: manifest.name,
        action: "skipped_missing_prereq",
        missing_ids: merged,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const entry of manifest.community_plugin_settings) {
    const id = entry && entry.id;
    if (typeof id !== "string" || id.length === 0 || /[\\/]|\.\./.test(id)) {
      new Notice(`applyCommunityPluginData: ${manifest.name} has invalid entry.id; skipped`, 6000);
      if (history) {
        history.push({
          event: "warning",
          step: "community_plugin_data",
          name: manifest.name,
          id: id,
          message: "invalid_id",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    const target = `.obsidian/plugins/${id}/data.json`;
    const pluginDir = `.obsidian/plugins/${id}`;

    if (!(await adapter.exists(pluginDir))) {
      if (history) {
        history.push({
          event: "info",
          step: "community_plugin_data",
          name: manifest.name,
          plugin_id: id,
          action: "skipped_plugin_dir_absent",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // Substitute placeholders via JSON round-trip (mirrors applyCorePluginSettings).
    let substituted;
    try {
      const sourceJson = JSON.stringify(entry.settings || {});
      substituted = JSON.parse(substituteLenient(sourceJson, variables));
    } catch (e) {
      new Notice(`applyCommunityPluginData: ${manifest.name} substitution failed for ${id} — ${e.message}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "community_plugin_data",
          name: manifest.name,
          plugin_id: id,
          message: `substitution failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    let raw = "";
    let existing = {};
    if (await adapter.exists(target)) {
      try {
        raw = await adapter.read(target);
      } catch (e) {
        new Notice(`applyCommunityPluginData: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "community_plugin_data",
            name: manifest.name,
            plugin_id: id,
            message: `read failed for ${target}: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      try {
        existing = JSON.parse(raw);
      } catch (e) {
        new Notice(`applyCommunityPluginData: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "community_plugin_data",
            name: manifest.name,
            plugin_id: id,
            message: `${target} malformed JSON: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
        new Notice(`applyCommunityPluginData: ${target} parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "community_plugin_data",
            name: manifest.name,
            plugin_id: id,
            message: `${target} parsed but is not a JSON object`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }

    // Shallow merge: substituted (manifest) wins on key collisions.
    const merged = Object.assign({}, existing, substituted);
    const mergedSerialized = JSON.stringify(merged, null, 2);

    // Idempotent skip-write: structural equality between merged and existing.
    if (raw && JSON.stringify(existing, null, 2) === mergedSerialized) {
      if (history) {
        history.push({
          event: "info",
          step: "community_plugin_data",
          name: manifest.name,
          plugin_id: id,
          action: "skipped_existing",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    // Backup-on-edit: only when there is pre-existing content to back up.
    let backupPath = null;
    if (raw) {
      backupPath = `${target}.sauce-backup`;
      try {
        await adapter.write(backupPath, raw);
      } catch (e) {
        new Notice(`applyCommunityPluginData: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "community_plugin_data",
            name: manifest.name,
            plugin_id: id,
            message: `backup write failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }

    try {
      await adapter.write(target, mergedSerialized);
    } catch (e) {
      new Notice(`applyCommunityPluginData: write failed (${e.message}) for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "community_plugin_data",
          name: manifest.name,
          plugin_id: id,
          message: `write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (history) {
      history.push({
        event: "info",
        step: "community_plugin_data",
        name: manifest.name,
        plugin_id: id,
        action: "applied",
        keys: Object.keys(substituted),
        backup_path: backupPath,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyVendoredThemes — for each item that declares vendored_themes[], copy the
// vendored theme directory from <workshop>/platform/<targetPath>/<src>/ into the
// consumer's .obsidian/themes/<name>/ via the vault adapter. Mirrors the boards
// Option B `file_overwrite` posture (sha256 compare; .bak of non-empty prior;
// replace event), applied per-file under .obsidian/themes/. Suffix is .bak
// (file-content overwrite convention) NOT .sauce-backup (plugin-data
// convention; that's reserved for applyTemplaterHotkeys / applySlashCommanderBindings /
// applyCorePluginSettings under .obsidian/plugins/<id>/data.json or
// .obsidian/<core-id>.json).
//
// Source-side reads use require("fs") synchronously (the workshop is OUTSIDE
// the vault — the adapter cannot reach it). Consumer-side reads/writes use the
// async vault adapter (tp.app.vault.adapter).
//
// Posture (mirrors v0.3.0 applyCorePluginSettings + v0.2.0 file_overwrite):
//   - Failure-loud: every fs / adapter operation in try/catch; on catch push
//     error/theme_overwrite + Notice + continue with next file (never throws).
//   - Backup-on-edit: when consumer dest exists AND differs from source, write
//     <destRelPath>.bak before overwriting.
//   - Idempotent: sha256-compare source vs. existing; on match push
//     info/theme_overwrite + action "skipped_existing" + skip-write.
//   - All history entries include git.commit / git.tag / git.dirty +
//     attempted_at: new Date().toISOString().
// _externalPluginsSatisfied — small gate used by the three v0.19.0 styling
// helpers (applyVendoredThemes / applyAppearance / applyStyleSettings) to
// short-circuit when a manifest's declared external_plugins[] aren't all
// present in .obsidian/community-plugins.json. Without this gate the v0.1.3
// applyExternalPlugins helper merely emits a warning + continues; the styling
// helpers actively materialize state so they need a stronger contract: if any
// REQUIRED prereq is absent, do nothing (no theme files, no appearance.json
// edit, no Style Settings data.json write). Returns { ok, missingIds }; on
// read/parse failure conservatively returns ok=false with a synthetic missing
// list so the caller no-ops (failure-loud — caller emits its own info event).
async function _externalPluginsSatisfied(tp, manifest) {
  const required = (manifest && Array.isArray(manifest.external_plugins))
    ? manifest.external_plugins.filter((e) => e && e.required && typeof e.id === "string").map((e) => e.id)
    : [];
  if (required.length === 0) return { ok: true, missingIds: [] };
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/community-plugins.json";
  if (!(await adapter.exists(target))) return { ok: false, missingIds: required };
  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    return { ok: false, missingIds: required };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, missingIds: required };
  }
  if (!Array.isArray(parsed)) return { ok: false, missingIds: required };
  const have = new Set(parsed);
  const missing = required.filter((id) => !have.has(id));
  return { ok: missing.length === 0, missingIds: missing };
}

async function applyVendoredThemes(tp, manifest, workshopPath, targetPath, history, git) {
  if (!manifest || !Array.isArray(manifest.vendored_themes) || manifest.vendored_themes.length === 0) return;
  const prereq = await _externalPluginsSatisfied(tp, manifest);
  if (!prereq.ok) {
    if (history) {
      history.push({
        event: "info",
        step: "theme_overwrite",
        name: manifest.name,
        action: "skipped_missing_prereq",
        missing_plugin_ids: prereq.missingIds,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  const fs = require("fs");
  const path = require("path");
  const crypto = require("crypto");
  const adapter = tp.app.vault.adapter;

  for (const entry of manifest.vendored_themes) {
    if (!entry || typeof entry.name !== "string" || entry.name.length === 0 ||
        typeof entry.src !== "string" || entry.src.length === 0) {
      new Notice(`applyVendoredThemes: ${manifest.name} has invalid vendored_themes entry; skipped`, 6000);
      if (history) {
        history.push({
          event: "warning",
          step: "theme_overwrite",
          name: manifest.name,
          message: "invalid_entry",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    const sourceDir = path.join(workshopPath, "platform", targetPath, entry.src);
    if (!fs.existsSync(sourceDir)) {
      new Notice(`applyVendoredThemes: source absent ${sourceDir} for ${manifest.name}/${entry.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "theme_overwrite",
          name: manifest.name,
          theme: entry.name,
          message: `source absent: ${sourceDir}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    const destDir = `.obsidian/themes/${entry.name}`;
    try {
      if (!(await adapter.exists(destDir))) {
        await adapter.mkdir(destDir);
      }
    } catch (e) {
      new Notice(`applyVendoredThemes: mkdir failed for ${destDir} (${e.message}); skipping ${manifest.name}/${entry.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "theme_overwrite",
          name: manifest.name,
          theme: entry.name,
          message: `mkdir failed for ${destDir}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    let srcFiles = [];
    try {
      srcFiles = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch (e) {
      new Notice(`applyVendoredThemes: readdir failed for ${sourceDir} (${e.message}); skipping ${manifest.name}/${entry.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "theme_overwrite",
          name: manifest.name,
          theme: entry.name,
          message: `readdir failed for ${sourceDir}: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    for (const filename of srcFiles) {
      const srcPath = path.join(sourceDir, filename);
      const destRelPath = `${destDir}/${filename}`;

      let srcBytes;
      let srcSha;
      try {
        srcBytes = fs.readFileSync(srcPath);
        srcSha = crypto.createHash("sha256").update(srcBytes).digest("hex");
      } catch (e) {
        new Notice(`applyVendoredThemes: read source failed for ${srcPath} (${e.message})`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "theme_overwrite",
            name: manifest.name,
            theme: entry.name,
            dest: destRelPath,
            message: `read source failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      let destExists = false;
      try {
        destExists = await adapter.exists(destRelPath);
      } catch (e) {
        new Notice(`applyVendoredThemes: exists check failed for ${destRelPath} (${e.message})`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "theme_overwrite",
            name: manifest.name,
            theme: entry.name,
            dest: destRelPath,
            message: `exists check failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      if (destExists) {
        let existingRaw;
        try {
          existingRaw = await adapter.read(destRelPath);
        } catch (e) {
          new Notice(`applyVendoredThemes: read dest failed for ${destRelPath} (${e.message})`, 8000);
          if (history) {
            history.push({
              event: "error",
              step: "theme_overwrite",
              name: manifest.name,
              theme: entry.name,
              dest: destRelPath,
              message: `read dest failed: ${e.message}`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        const existingBytes = Buffer.from(existingRaw, "utf8");
        const existingSha = crypto.createHash("sha256").update(existingBytes).digest("hex");

        if (srcSha === existingSha) {
          if (history) {
            history.push({
              event: "info",
              step: "theme_overwrite",
              name: manifest.name,
              theme: entry.name,
              dest: destRelPath,
              action: "skipped_existing",
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        const bakPath = `${destRelPath}.bak`;
        try {
          await adapter.write(bakPath, existingRaw);
        } catch (e) {
          new Notice(`applyVendoredThemes: bak write failed for ${bakPath} (${e.message}); aborting overwrite of ${destRelPath}`, 8000);
          if (history) {
            history.push({
              event: "error",
              step: "theme_overwrite",
              name: manifest.name,
              theme: entry.name,
              dest: destRelPath,
              message: `bak write failed: ${e.message}`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        try {
          await adapter.write(destRelPath, srcBytes.toString("utf8"));
        } catch (e) {
          new Notice(`applyVendoredThemes: dest write failed for ${destRelPath} (${e.message})`, 8000);
          if (history) {
            history.push({
              event: "error",
              step: "theme_overwrite",
              name: manifest.name,
              theme: entry.name,
              dest: destRelPath,
              message: `dest write failed: ${e.message}`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        if (history) {
          history.push({
            event: "replace",
            step: "theme_overwrite",
            name: manifest.name,
            theme: entry.name,
            dest: destRelPath,
            prior_sha: existingSha,
            new_sha: srcSha,
            backup_path: bakPath,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      } else {
        // Fresh write — no prior content to back up.
        try {
          await adapter.write(destRelPath, srcBytes.toString("utf8"));
        } catch (e) {
          new Notice(`applyVendoredThemes: fresh write failed for ${destRelPath} (${e.message})`, 8000);
          if (history) {
            history.push({
              event: "error",
              step: "theme_overwrite",
              name: manifest.name,
              theme: entry.name,
              dest: destRelPath,
              message: `fresh write failed: ${e.message}`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        if (history) {
          history.push({
            event: "replace",
            step: "theme_overwrite",
            name: manifest.name,
            theme: entry.name,
            dest: destRelPath,
            new_sha: srcSha,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      }
    }
  }
}

// applyAppearance — write/merge .obsidian/appearance.json from a manifest's
// `appearance` block. Mirrors applyCorePluginSettings posture (failure-loud
// history, malformed-JSON guard, backup-on-edit, idempotent skip-write,
// never-throws). cssTheme is ALWAYS overridden (single canonical theme per
// design); enabledCssSnippets is additively unioned (existing-first order
// preserved); any other keys in `desired` are shallow-merged over the existing
// object for forward-compat. Backup suffix is .sauce-backup (plugin-data
// convention; same as applyCorePluginSettings).
async function applyAppearance(tp, manifest, history, git) {
  if (!manifest || typeof manifest.appearance !== "object" || manifest.appearance === null || Array.isArray(manifest.appearance)) return;
  const prereq = await _externalPluginsSatisfied(tp, manifest);
  if (!prereq.ok) {
    if (history) {
      history.push({
        event: "info",
        step: "appearance",
        name: manifest.name,
        action: "skipped_missing_prereq",
        missing_plugin_ids: prereq.missingIds,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/appearance.json";
  const desired = manifest.appearance;

  // Fresh-write branch: no pre-existing file → write desired verbatim.
  if (!(await adapter.exists(target))) {
    const body = JSON.stringify(desired, null, 2);
    try {
      await adapter.write(target, body);
    } catch (e) {
      new Notice(`applyAppearance: write failed (${e.message}) for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "appearance",
          name: manifest.name,
          message: `write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    if (history) {
      history.push({
        event: "info",
        step: "appearance",
        name: manifest.name,
        action: "applied",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Merge branch: file exists. Read raw → parse → C4 guard → merge → backup → write.
  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    new Notice(`applyAppearance: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "appearance",
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

  let existing;
  try {
    existing = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyAppearance: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "appearance",
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

  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    new Notice(`applyAppearance: ${target} parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "appearance",
        name: manifest.name,
        message: `${target} parsed but is not a JSON object`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Compose merged: shallow-merge desired over existing for forward-compat,
  // then overlay the two structured fields with their explicit semantics.
  const merged = Object.assign({}, existing, desired);
  // cssTheme: always overridden by desired (single canonical theme).
  if (typeof desired.cssTheme !== "undefined") {
    merged.cssTheme = desired.cssTheme;
  }
  // enabledCssSnippets: additive union (existing first; preserve order; skip dups).
  if (Array.isArray(desired.enabledCssSnippets)) {
    const existingSnippets = Array.isArray(existing.enabledCssSnippets) ? existing.enabledCssSnippets.slice() : [];
    const seen = new Set(existingSnippets);
    for (const s of desired.enabledCssSnippets) {
      if (!seen.has(s)) {
        existingSnippets.push(s);
        seen.add(s);
      }
    }
    merged.enabledCssSnippets = existingSnippets;
  }

  const mergedSerialized = JSON.stringify(merged, null, 2);

  // Idempotent skip-write: structural equality.
  if (JSON.stringify(existing, null, 2) === mergedSerialized) {
    if (history) {
      history.push({
        event: "info",
        step: "appearance",
        name: manifest.name,
        action: "skipped_existing",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Backup-on-edit: capture pre-edit raw bytes before overwriting.
  const backupPath = `${target}.sauce-backup`;
  try {
    await adapter.write(backupPath, raw);
  } catch (e) {
    new Notice(`applyAppearance: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "appearance",
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
    await adapter.write(target, mergedSerialized);
  } catch (e) {
    new Notice(`applyAppearance: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "appearance",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (history) {
    history.push({
      event: "info",
      step: "appearance",
      name: manifest.name,
      action: "applied",
      backup_path: backupPath,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// applyStyleSettings — v0.19.0 styling cycle. Materializes the canonical
// Style Settings defaults JSON (declared per blueprint/mechanism via the
// manifest field `style_settings_defaults_src`) into the consumer's
// .obsidian/plugins/obsidian-style-settings/data.json. First-wins merge —
// existing user values win over source defaults so manual tweaks survive
// re-install. Posture mirrors applyCorePluginSettings (failure-loud history,
// malformed-JSON guard, backup-on-edit, idempotent skip-write on
// structural-equal, never-throws). Source is read from the workshop via
// require("fs") synchronously — the workshop lives outside the vault and the
// vault adapter cannot reach it.
async function applyStyleSettings(tp, manifest, workshopPath, targetPath, history, git) {
  if (!manifest || typeof manifest.style_settings_defaults_src !== "string") return;
  const prereq = await _externalPluginsSatisfied(tp, manifest);
  if (!prereq.ok) {
    if (history) {
      history.push({
        event: "info",
        step: "style_settings",
        name: manifest.name,
        action: "skipped_missing_prereq",
        missing_plugin_ids: prereq.missingIds,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  const fs = require("fs");
  const path = require("path");
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/obsidian-style-settings/data.json";

  const sourceAbs = path.join(workshopPath, "platform", targetPath, manifest.style_settings_defaults_src);

  if (!fs.existsSync(sourceAbs)) {
    new Notice(`applyStyleSettings: source missing ${sourceAbs}; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `source missing: ${sourceAbs}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let sourceText;
  try {
    sourceText = fs.readFileSync(sourceAbs, "utf8");
  } catch (e) {
    new Notice(`applyStyleSettings: source read failed (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `source read failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let sourceParsed;
  try {
    sourceParsed = JSON.parse(sourceText);
  } catch (e) {
    new Notice(`applyStyleSettings: source malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `source malformed JSON: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (sourceParsed === null || typeof sourceParsed !== "object" || Array.isArray(sourceParsed)) {
    new Notice(`applyStyleSettings: source parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `source parsed but is not a JSON object`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const exists = await adapter.exists(target);
  let raw = "";
  if (exists) {
    try {
      raw = await adapter.read(target);
    } catch (e) {
      new Notice(`applyStyleSettings: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "style_settings",
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
  }

  // Empty / whitespace-only consumer content → fresh write (no backup).
  if (!exists || raw.trim().length === 0) {
    const body = JSON.stringify(sourceParsed, null, 2);
    try {
      await adapter.write(target, body);
    } catch (e) {
      new Notice(`applyStyleSettings: write failed (${e.message}) for ${manifest.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "style_settings",
          name: manifest.name,
          message: `write failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return;
    }
    if (history) {
      history.push({
        event: "info",
        step: "style_settings",
        name: manifest.name,
        action: "applied",
        backup_path: null,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Pre-existing non-empty: parse + structural validate. Malformed → skip
  // (do NOT write, do NOT backup; leave malformed file as-is so the user can
  // recover manually).
  let existingParsed;
  try {
    existingParsed = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyStyleSettings: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
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

  if (existingParsed === null || typeof existingParsed !== "object" || Array.isArray(existingParsed)) {
    new Notice(`applyStyleSettings: ${target} parsed but is not a JSON object; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `${target} parsed but is not a JSON object`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // First-wins merge: existing user values win over source defaults.
  const merged = Object.assign({}, sourceParsed, existingParsed);
  const mergedSerialized = JSON.stringify(merged, null, 2);
  const existingSerialized = JSON.stringify(existingParsed, null, 2);

  if (mergedSerialized === existingSerialized) {
    if (history) {
      history.push({
        event: "info",
        step: "style_settings",
        name: manifest.name,
        action: "skipped_existing",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Backup-on-edit BEFORE write. Skip dest write on backup failure so we
  // don't half-update.
  const bakPath = `${target}.sauce-backup`;
  try {
    await adapter.write(bakPath, raw);
  } catch (e) {
    new Notice(`applyStyleSettings: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
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
    await adapter.write(target, mergedSerialized);
  } catch (e) {
    new Notice(`applyStyleSettings: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "style_settings",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (history) {
    history.push({
      event: "info",
      step: "style_settings",
      name: manifest.name,
      action: "applied",
      backup_path: bakPath,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// pruneNavButtonsRegistry — drop contributions.<X> for any X not in the current
// subscription. Called once at the end of the install loop. Honors C4 hardening:
// a malformed pre-existing registry is left untouched and reported.
async function pruneNavButtonsRegistry(tp, subscription, history, git) {
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/nav-buttons-registry.json";
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
  const ledgerPath = "ranch/platform-installed.json";
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

// ============================================================
// v0.21.0 — re-importable Node entrypoint for bootstrap.js
// No-op when loaded inside Templater (module / module.exports both undefined there).
// Wraps run-install.js as a child process for safety; cleaner refactor TBD if S4 surfaces friction.
// ============================================================
if (typeof module !== "undefined" && module.exports && typeof module.exports === "function") {
    // Attach as a property of the existing function export — preserves the
    // top-level `module.exports = async function (tp) {...}` contract that
    // run-install.js relies on (it expects `require(installerPath)` to return
    // a function), while also exposing `.runInstall(vaultPath, opts)` for
    // bootstrap.js to invoke.
    //
    // v0.29.0 S2.5 — additively expose `applyRuleFragment` for unit testing
    // by run-helper-cases.js (HC-RF1/HC-RF2/HC-RF3 cover the array-support
    // patch). Pure additive; does not affect the function-as-default export.
    module.exports.applyRuleFragment = applyRuleFragment;
    // v0.30.0 S1.5 — expose materializeSkills for HC-MS1..HC-MS5 in
    // run-helper-cases.js. Pure additive; does not affect the function-as-default export.
    module.exports.materializeSkills = materializeSkills;
    //
    // CF-2: by default, capture run-install.js's stdio (Phase B/C surfaced
    // 2200-line JSON dumps mixed into the user's terminal). We tee the
    // captured output to <vault>/ranch/bootstrap-last-install.log + emit
    // only a condensed summary (Notice lines + verdict + run counts) to
    // stdout. Pass { verbose: true } to opt back into raw stdio inherit.
    module.exports.runInstall = async function runInstall(vaultPath, opts) {
        opts = opts || {};
        const path = require("path");
        const fs = require("fs");
        const child_process = require("child_process");

        if (opts.verbose) {
            const result = child_process.spawnSync(
                process.execPath,
                [path.join(__dirname, "test", "run-install.js"), vaultPath],
                { stdio: "inherit", encoding: "utf8" }
            );
            if (result.status !== 0) {
                throw new Error(`runInstall failed with exit ${result.status}`);
            }
            return;
        }

        // Use async spawn (NOT spawnSync) because run-install.js calls
        // process.exit(N) which truncates buffered stdout when piped.
        // spawnSync collects what's flushed, returns ~1900 lines instead of
        // the full ~4100. Async spawn waits for the child's `close` event
        // which fires AFTER stdout EOF — gets the full output even with
        // process.exit truncation upstream.
        const { stdout, stderr, status } = await new Promise((resolve, reject) => {
            const child = child_process.spawn(
                process.execPath,
                [path.join(__dirname, "test", "run-install.js"), vaultPath],
                { stdio: ["ignore", "pipe", "pipe"] }
            );
            const out = []; const err = [];
            child.stdout.on("data", (c) => out.push(c));
            child.stderr.on("data", (c) => err.push(c));
            child.on("error", reject);
            child.on("close", (code) => {
                resolve({
                    stdout: Buffer.concat(out).toString("utf8"),
                    stderr: Buffer.concat(err).toString("utf8"),
                    status: code
                });
            });
        });
        const result = { stdout, stderr, status };

        // Tee full output to a log file inside the vault so the user can
        // inspect when something goes wrong, without polluting stdout on
        // the happy path.
        const logDir = path.join(vaultPath, "ranch");
        try { fs.mkdirSync(logDir, { recursive: true }); } catch (_e) {}
        const logPath = path.join(logDir, "bootstrap-last-install.log");
        try {
            fs.writeFileSync(logPath, stdout + (stderr ? "\n--- STDERR ---\n" + stderr : ""), "utf8");
        } catch (_e) {}

        // Condensed summary: emit Notice lines, the Verdict block, and the
        // simple count rows. Skip the JSON dumps + history blobs.
        const lines = stdout.split("\n");
        const summary = [];
        let inJsonBlock = false;
        let inHistoryBlock = false;
        for (const line of lines) {
            // Skip indented JSON content blocks (history dump + final
            // platform-installed.json block).
            if (line === "--- Final platform-installed.json ---" || line === "--- New history entries this run ---") {
                inJsonBlock = true;
                continue;
            }
            if (line.startsWith("--- ") && inJsonBlock) {
                inJsonBlock = false;
                // fall through to emit the new section heading
            }
            if (inJsonBlock) continue;

            // Skip raw history JSON one-liners (start with {"event"...).
            if (/^\s*\{"event"/.test(line)) continue;

            // Skip empty leading lines.
            if (!line.trim() && summary.length === 0) continue;

            summary.push(line);
        }

        // Print summary, but cap to ~60 lines. If the install is enormous,
        // direct user to the log.
        const MAX_SUMMARY_LINES = 80;
        if (summary.length > MAX_SUMMARY_LINES) {
            const head = summary.slice(0, MAX_SUMMARY_LINES);
            head.push("");
            head.push(`(+${summary.length - MAX_SUMMARY_LINES} more lines — full log: ${logPath})`);
            for (const l of head) console.log(l);
        } else {
            for (const l of summary) console.log(l);
        }

        if (stderr.trim()) {
            console.error("--- runInstall STDERR ---");
            console.error(stderr);
        }

        if (result.status !== 0) {
            throw new Error(`runInstall failed with exit ${result.status} — full log: ${logPath}`);
        }
    };
}
