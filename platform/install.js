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
          // v0.46.0 S3 follow-up (C1): embed new_entity_buttons[] declarations
          // into the installed.json blueprints[] entry so the entity-create
          // audit walker has a stable single-source-of-truth surface to read
          // at audit time. Deep-copy to insulate the registry from later
          // manifest mutation. Omit when absent.
          //
          // v0.47.0 S5 invariant: store RAW manifest values (bare basenames for
          // body_template + extra_files[].body_template), NOT the resolved
          // {{templates_path}}/-prefixed forms. The audit walker
          // (platform/audit/entity-create-walker.js) reads from installed.json
          // and joins TEMPLATES_REL itself — embedding resolved paths here
          // would produce double-prefixed values like
          // "ranch/templates/ranch/templates/Foo.md" inside the walker.
          if (Array.isArray(itemMan.new_entity_buttons)) {
            entry.new_entity_buttons = JSON.parse(JSON.stringify(itemMan.new_entity_buttons));
          }
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

    // 6b. v0.32.0 S3 — aggregate claude_surface[] contributions across
    // subscribed mechanisms + blueprints. Wrapped in its own try/catch so
    // aggregator failure does NOT abort the broader install. The
    // targetPathByName lookup lets the aggregator stamp `target_path` and
    // `itemVars` onto each materializeList entry — both consumed by
    // materializeClaudeSurface below.
    let claudeSurfaceState = null;
    try {
      const targetPathByName = new Map();
      for (const [name, node] of nodes) {
        if (node && node.target && typeof node.target.path === "string") {
          targetPathByName.set(name, node.target.path);
        }
      }
      claudeSurfaceState = await aggregateClaudeSurface(
        perItemManifest,
        subscription,
        installedNow.history,
        git,
        { workshop_version: manifest.workshop_version, targetPathByName }
      );
    } catch (e) {
      new Notice(`platformInstall: claude_surface aggregation failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "claude_surface_aggregate",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }

    // 6c. v0.32.0 S3 — materialize the file-kind claude_surface entries
    // (command | skill | context_doc). The claude_md_row table contributions
    // are still in claudeSurfaceState.rows for a future stage to render into
    // CLAUDE.md; this stage only writes the four kinds' file bodies.
    if (claudeSurfaceState) {
      try {
        await materializeClaudeSurface(
          claudeSurfaceState.materializeList,
          tp,
          workshopPath,
          installedNow.history,
          git
        );
      } catch (e) {
        new Notice(`platformInstall: claude_surface materialize failed — ${e.message}`, 6000);
        installedNow.history.push({
          event: "error",
          step: "claude_surface_materialize",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    // 6d. v0.32.0 S4 — regenerate marker-bounded sections of CLAUDE.md from
    // the aggregator's rows output. Wrapped in its own try/catch so a CLAUDE.md
    // regen failure does NOT abort the nav-buttons prune or ledger prune
    // below. The renderer is a no-op when CLAUDE.md is absent in the vault
    // (first-touch scaffold ships in S6).
    if (claudeSurfaceState) {
      try {
        const { regenerateClaudeMd } = require("./mechanisms/platform-claude/claude-md-renderer.js");
        await regenerateClaudeMd(claudeSurfaceState.rows, tp, installedNow.history, git);
      } catch (e) {
        new Notice(`platformInstall: CLAUDE.md regen failed — ${e.message}`, 6000);
        installedNow.history.push({
          event: "error",
          step: "claude_md_regen",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    // 6e. v0.32.0 S5 — subscription-aware prune of the claude_surface
    // registry. Reads the prior on-disk registry, diffs against the freshly
    // built one from step 6b, and deletes orphaned dest files. Wrapped in
    // its own try/catch so a prune failure does NOT abort downstream steps.
    const claudeSurfaceRegistryPath = "ranch/claude-surface-registry.json";
    let prevClaudeSurfaceRegistry = null;
    try {
      if (await tp.app.vault.adapter.exists(claudeSurfaceRegistryPath)) {
        const raw = await tp.app.vault.adapter.read(claudeSurfaceRegistryPath);
        prevClaudeSurfaceRegistry = JSON.parse(raw);
      }
    } catch (e) {
      installedNow.history.push({
        event: "warning",
        step: "claude_surface_prune_prev_read",
        message: `could not read prev ${claudeSurfaceRegistryPath}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    if (claudeSurfaceState && prevClaudeSurfaceRegistry) {
      try {
        await pruneClaudeSurface(
          prevClaudeSurfaceRegistry,
          claudeSurfaceState.registry,
          tp,
          installedNow.history,
          git
        );
      } catch (e) {
        new Notice(`platformInstall: claude_surface prune failed — ${e.message}`, 6000);
        installedNow.history.push({
          event: "error",
          step: "claude_surface_prune",
          message: e.message,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    // 6f. v0.32.0 S5 — apply .claude/commands.local/ + .claude/skills.local/
    // shadow overrides (overwrites canonical with consumer customizations).
    // Runs AFTER 6c materialize so the canonical files are on disk and ready
    // to be overwritten. Independent try/catch — failures don't abort the
    // downstream registry write.
    try {
      await applyLocalShadows(tp, installedNow.history, git);
    } catch (e) {
      new Notice(`platformInstall: local shadows failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "claude_local_shadow",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }

    // 6g. v0.32.0 S5 — persist the new claude_surface registry to disk so
    // the next install's prune step has a baseline to diff against.
    if (claudeSurfaceState) {
      try {
        const registryDir = "ranch";
        if (!(await tp.app.vault.adapter.exists(registryDir))) {
          await tp.app.vault.adapter.mkdir(registryDir);
        }
        await tp.app.vault.adapter.write(
          claudeSurfaceRegistryPath,
          JSON.stringify(claudeSurfaceState.registry, null, 2) + "\n"
        );
      } catch (e) {
        new Notice(`platformInstall: claude_surface registry write failed — ${e.message}`, 6000);
        installedNow.history.push({
          event: "error",
          step: "claude_surface_registry_write",
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

    // 7b. Subscription-aware pruning of ranch/entity-create-registry.json.
    // Symmetric with the nav-buttons prune above: removes contributions.<source>
    // for any source no longer in the current subscription. Closes the
    // "entirely unsubscribed blueprint" gap that applyNewEntityButtons can't
    // see (it only runs for items still in the subscription). Wrapped in its
    // own try/catch so a malformed registry never aborts the broader install.
    try {
      await pruneEntityCreateRegistry(tp, subscription, installedNow.history, git);
    } catch (e) {
      new Notice(`platformInstall: entity-create registry prune failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "entity_create_prune",
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
  // v0.46.0 S2 — symmetric per-item step for new_entity_buttons[]. Writes
  // ranch/entity-create-registry.json (read-modify-write so the registry
  // accumulates across the install loop, with prune-on-empty for re-installs)
  // and injects an idempotent AccentButton dataviewjs block at any hub-kind
  // render_in.target_path. nav_buttons-kind render_in is schema-reserved but
  // installer-rejected with a deferred warning for Cycle 1.
  await applyNewEntityButtons(tp, mech, variables, history, git);
  await applyWikiToDocsMigration(tp, mech, variables, history, git);   // NEW v0.52.0 — must run BEFORE applyDocsBackfill
  await applyDocsBackfill(tp, mech, variables, history, git);          // NEW v0.50.0; renamed from applyWikiBackfill v0.52.0
  await applyExternalPlugins(tp, mech, history, git);
  await scaffoldFoundationalPluginData(tp, mech, workshopPath, variables, history, git);  // NEW v0.26.0
  await applyTemplaterHotkeys(tp, mech, variables, history, git);          // NEW v0.1.3
  await applySlashCommanderBindings(tp, mech, variables, history, git);    // NEW v0.1.3
  await applyTemplaterFolderTemplates(tp, mech, variables, history, git);  // NEW v0.4.0
  await applyTemplaterStartupTemplates(tp, mech, variables, history, git); // NEW v0.48.0
  await applyCustomJsStartupScripts(tp, mech, variables, history, git);    // NEW v0.49.0
  await applyCorePluginSettings(tp, mech, variables, history, git);        // NEW v0.3.0
  await applyCommunityPluginData(tp, mech, variables, history, git);       // NEW v0.21.1
  await applyVendoredThemes(tp, mech, workshopPath, target.path, history, git);  // NEW v0.19.0
  await applySnippets(tp, mech, workshopPath, target.path, history, git);         // NEW v0.41.0
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

// applyWikiToDocsMigration — v0.52.0. One-time per-project migration that
// renames spice/projects/<slug>/wiki/ → docs/, Wiki.md → Docs.md, rewrites
// frontmatter (type wiki-hub → docs-hub, wiki-note → doc-note + tags),
// and rewrites customJS.ProjectWikiCards → ProjectDocsCards references in
// migrated .md bodies. Gated by manifest.name === "project".
//
// Posture mirrors applyDocsBackfill (formerly applyWikiBackfill):
// - Failure-loud per-project (try/catch per slug); does NOT halt install.
// - Idempotent: skips if docs/ already exists at the target path.
// - Backup: before any destructive op, copies wiki/ → .sauce-backup/<slug>/wiki/<ts>/.
// - Co-existence safety: if BOTH wiki/ and docs/ exist for the same project,
//   skips with a history warning (user manually started a docs/ pre-migration).
//
// install.js cannot use Obsidian's parseYaml; frontmatter rewrite uses regex
// against the leading `---` block, matching the pattern of applyDocsBackfill.
async function applyWikiToDocsMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (_) {
    return;
  }

  const projectDirs = (projectsList.folders || []).filter((d) => {
    const base = d.split("/").pop();
    return base !== "All Projects";
  });

  let migratedCount = 0;
  let skippedExistsCount = 0;
  let skippedNoWikiCount = 0;
  let warnCoexistCount = 0;
  let warnFailCount = 0;

  const ts = (() => {
    const n = new Date();
    const z = (x) => String(x).padStart(2, "0");
    return `${n.getFullYear()}${z(n.getMonth() + 1)}${z(n.getDate())}-${z(n.getHours())}${z(n.getMinutes())}${z(n.getSeconds())}`;
  })();

  for (const projectDir of projectDirs) {
    const slug = projectDir.split("/").pop();
    const wikiDir = `${projectDir}/wiki`;
    const docsDir = `${projectDir}/docs`;

    try {
      const wikiExists = await adapter.exists(wikiDir);
      const docsExists = await adapter.exists(docsDir);

      if (!wikiExists && !docsExists) {
        skippedNoWikiCount += 1;
        continue;
      }
      if (!wikiExists && docsExists) {
        // Already migrated OR user-created docs/ from day one.
        skippedExistsCount += 1;
        continue;
      }
      if (wikiExists && docsExists) {
        // Co-existence: don't touch either. User started a docs/ pre-migration.
        warnCoexistCount += 1;
        if (history) {
          history.push({
            event: "warning",
            step: "wiki_to_docs_migration",
            name: "project",
            reason: `co-existence: both wiki/ and docs/ exist for ${slug} — skipping migration; user must resolve manually`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      // From here: wikiExists && !docsExists. Perform migration.

      // 1. Backup
      const backupDir = `.sauce-backup/${slug}/wiki/${ts}`;
      await _copyDirRecursive(adapter, wikiDir, backupDir);

      // 2. List wiki/ contents (before rename so we know what to rewrite later)
      const wikiListing = await adapter.list(wikiDir);
      const wikiMdFiles = (wikiListing.files || []).filter((f) => f.endsWith(".md"));

      // 3. Rename wiki/ → docs/ via copy + delete (adapter doesn't have rename)
      await _copyDirRecursive(adapter, wikiDir, docsDir);
      await _rmDirRecursive(adapter, wikiDir);

      // 4. Inside docs/, rename Wiki.md → Docs.md if present
      const docsWikiHubPath = `${docsDir}/Wiki.md`;
      const docsDocsHubPath = `${docsDir}/Docs.md`;
      if (await adapter.exists(docsWikiHubPath) && !(await adapter.exists(docsDocsHubPath))) {
        const hubBody = await adapter.read(docsWikiHubPath);
        await adapter.write(docsDocsHubPath, hubBody);
        await adapter.remove(docsWikiHubPath);
      }

      // 5. Rewrite frontmatter + customJS class refs in each .md inside docs/
      const docsListing = await adapter.list(docsDir);
      const docsMdFiles = (docsListing.files || []).filter((f) => f.endsWith(".md"));
      for (const mdFile of docsMdFiles) {
        let body;
        try { body = await adapter.read(mdFile); } catch (_) { continue; }
        const newBody = _rewriteWikiToDocsBody(body);
        if (newBody !== body) {
          await adapter.write(mdFile, newBody);
        }
      }

      migratedCount += 1;
      if (history) {
        history.push({
          event: "info",
          step: "wiki_to_docs_migration",
          name: "project",
          reason: `migrated ${slug}: wiki/ → docs/ (${wikiMdFiles.length} .md files; backup at ${backupDir})`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warnFailCount += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "wiki_to_docs_migration",
          name: "project",
          reason: `migration failed for ${slug}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "wiki_to_docs_migration",
      name: "project",
      reason: `migrated ${migratedCount}; skipped-already-migrated ${skippedExistsCount}; skipped-no-wiki ${skippedNoWikiCount}; warn-coexist ${warnCoexistCount}; warn-fail ${warnFailCount}`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// Helper: rewrite a markdown body's frontmatter type/tags + dataviewjs class refs.
// Exported for unit tests in run-wiki-to-docs-migration.js.
function _rewriteWikiToDocsBody(body) {
  // 1. type: wiki-hub → docs-hub (frontmatter line, with or without quotes)
  body = body.replace(/^type:\s*["']?wiki-hub["']?\s*$/m, 'type: docs-hub');
  // 2. type: wiki-note → doc-note
  body = body.replace(/^type:\s*["']?wiki-note["']?\s*$/m, 'type: doc-note');
  // 3. tags array: wiki-hub → docs-hub (anywhere in a tags YAML block, supports
  //    both bullet form `- wiki-hub` and inline-flow `tags: [wiki-hub, ...]`)
  body = body.replace(/(\btags\s*:[\s\S]*?)(["']?)wiki-hub\2/g, '$1$2docs-hub$2');
  // 4. tags array: wiki-note → doc-note (same)
  body = body.replace(/(\btags\s*:[\s\S]*?)(["']?)wiki-note\2/g, '$1$2doc-note$2');
  // 5. customJS class refs in dataviewjs blocks
  body = body.replace(/customJS\.ProjectWikiCards/g, 'customJS.ProjectDocsCards');
  body = body.replace(/class:\s*"ProjectWikiCards"/g, 'class: "ProjectDocsCards"');
  // 6. entity-create sentinel comment (defensive)
  body = body.replace(/entity-create:wiki-note/g, 'entity-create:doc-note');
  return body;
}

// Helpers for recursive copy/remove against tp.app.vault.adapter.
async function _copyDirRecursive(adapter, srcDir, destDir) {
  if (!(await adapter.exists(destDir))) await adapter.mkdir(destDir);
  const listing = await adapter.list(srcDir);
  for (const f of (listing.files || [])) {
    const rel = f.substring(srcDir.length + 1);
    const target = `${destDir}/${rel}`;
    const body = await adapter.read(f);
    await adapter.write(target, body);
  }
  for (const sub of (listing.folders || [])) {
    const rel = sub.substring(srcDir.length + 1);
    const target = `${destDir}/${rel}`;
    await _copyDirRecursive(adapter, sub, target);
  }
}

async function _rmDirRecursive(adapter, dir) {
  if (!(await adapter.exists(dir))) return;
  const listing = await adapter.list(dir);
  for (const f of (listing.files || [])) {
    await adapter.remove(f);
  }
  for (const sub of (listing.folders || [])) {
    await _rmDirRecursive(adapter, sub);
  }
  await adapter.rmdir(dir);
}

// applyDocsBackfill — v0.52.0 (renamed from applyWikiBackfill, v0.50.0).
// Walks `spice/projects/*/` and creates `docs/Docs.md` per pre-existing
// project that lacks one. Gated by manifest.name === "project" so it only
// fires for the project blueprint's per-blueprint pipeline.
//
// v0.52.0 changes vs prior applyWikiBackfill:
// - Path: wiki/Wiki.md → docs/Docs.md
// - Step name in history: "wiki_backfill" → "docs_backfill"
// - Template path: Template, Wiki Hub.md → Template, Docs Hub.md
// - FLN-1 fold-in: now ALSO repairs 0-byte Docs.md (treats them as missing).
//
// Idempotent: skips projects whose docs/Docs.md already exists AND is non-empty.
// Failure-loud per-project: catches per-entry exceptions, logs warning to
// history, continues.
//
// Project-root heuristic: scans *.md files directly inside each project dir
// (non-recursive) and matches the first one with `type: project` in its
// frontmatter block. project_slug = dir basename; project_name = frontmatter
// `name:` value (fallback: filename without .md extension).
//
// install.js cannot use Obsidian's parseYaml (per the top-of-file note);
// frontmatter is matched via a narrow regex against the leading `---` block.
async function applyDocsBackfill(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) {
    if (history) {
      history.push({
        event: "info",
        step: "docs_backfill",
        name: "project",
        reason: `projects root ${projectsRoot} absent — nothing to backfill`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "docs_backfill",
        name: "project",
        reason: `list failed for ${projectsRoot}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const projectDirs = (projectsList.folders || []).filter((d) => {
    const base = d.split("/").pop();
    return base !== "All Projects";
  });

  const templatePath = `${variables.templates_path}/Template, Docs Hub.md`;
  if (!(await adapter.exists(templatePath))) {
    if (history) {
      history.push({
        event: "error",
        step: "docs_backfill",
        name: "project",
        reason: `template missing: ${templatePath}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  let templateBody;
  try {
    templateBody = await adapter.read(templatePath);
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "docs_backfill",
        name: "project",
        reason: `template read failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let backfilledCount = 0;
  let skippedCount = 0;
  let warnCount = 0;

  for (const projectDir of projectDirs) {
    try {
      const docsPath = `${projectDir}/docs/Docs.md`;
      if (await adapter.exists(docsPath)) {
        // FLN-1 fold-in: a 0-byte Docs.md is treated as missing (repair path).
        // Otherwise prior-failed installs leave a useless empty Docs.md that
        // skip-if-exists masks indefinitely.
        let existingBody = "";
        try { existingBody = await adapter.read(docsPath); } catch (_) { existingBody = ""; }
        if (existingBody.length > 0) {
          skippedCount += 1;
          continue;
        }
        // 0-byte: fall through to (re)write below.
      }

      let dirListing;
      try {
        dirListing = await adapter.list(projectDir);
      } catch (e) {
        warnCount += 1;
        continue;
      }
      const mdFiles = (dirListing.files || []).filter((f) => f.endsWith(".md"));

      let projectName = null;
      for (const mdFile of mdFiles) {
        let fileBody;
        try {
          fileBody = await adapter.read(mdFile);
        } catch (e) {
          continue;
        }
        const fmMatch = fileBody.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        const fmBlock = fmMatch[1];
        // Tolerate quoted ("project" / 'project') and unquoted (project) YAML
        // forms. Entity-create-emitted notes quote string scalars; pre-v0.50.0
        // hand-authored project roots don't. BUG-C fix (v0.50.2).
        if (!/^type:\s*["']?project["']?\s*$/m.test(fmBlock)) continue;
        const nameMatch = fmBlock.match(/^name:\s*(.+?)\s*$/m);
        projectName = nameMatch
          ? nameMatch[1].replace(/^["']|["']$/g, "")
          : mdFile.split("/").pop().replace(/\.md$/, "");
        break;
      }

      if (!projectName) {
        warnCount += 1;
        if (history) {
          history.push({
            event: "warning",
            step: "docs_backfill",
            name: "project",
            reason: `no project root found in ${projectDir} — skipping`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const projectSlug = projectDir.split("/").pop();
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      const nowStr = `${yyyy}-${mm}-${dd} ${hh}:${mi}`;

      const substituted = templateBody
        .replace(/\{\{prompts\.slug\}\}/g, projectSlug)
        .replace(/\{\{prompts\.name\}\}/g, projectName)
        .replace(/\{\{now\.YYYY-MM-DD HH:mm\}\}/g, nowStr);

      const docsDir = `${projectDir}/docs`;
      if (!(await adapter.exists(docsDir))) {
        await adapter.mkdir(docsDir);
      }

      await adapter.write(docsPath, substituted);
      backfilledCount += 1;
    } catch (e) {
      warnCount += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "docs_backfill",
          name: "project",
          reason: `backfill failed for ${projectDir}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "docs_backfill",
      name: "project",
      reason: `backfilled ${backfilledCount} project(s); skipped ${skippedCount} (already had Docs.md); ${warnCount} warning(s)`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// applyNewEntityButtons — v0.46.0 S2. Aggregates this item's
// new_entity_buttons[] declarations into ranch/entity-create-registry.json
// under contributions.<name>, flattens a top-level entries[] view for the
// EntityCreate runtime, and (for render_in.kind === "hub") injects an
// idempotent AccentButton dataviewjs block at render_in.target_path. Mirrors
// applyNavButtons in posture: malformed pre-existing JSON is preserved
// (no silent overwrite); per-entry validation skips bad entries without
// taking the whole contribution down; failures record history but do not
// throw. An empty/missing new_entity_buttons[] on a re-installing item
// PRUNES that item's prior contribution (otherwise stale entries from
// earlier versions persist forever — symmetric with applyNavButtons' v0.2.0
// prune fix).
async function applyNewEntityButtons(tp, manifest, variables, history, git) {
  if (!manifest) return;
  const declared = Array.isArray(manifest.new_entity_buttons) ? manifest.new_entity_buttons : [];
  // v0.47.0 S7 — Layer 2 type-field convention gate. Bails before any
  // registry mutation if a blueprint with a when.frontmatter.type-keyed
  // rule_fragment ships new_entity_buttons[] missing the matching type
  // value in frontmatter_template. Forward-defense; no current blueprint
  // trips this gate at v0.47.0 (BUG-2 fixed independently in people manifest).
  if (!_validateTypeFieldConvention(manifest, history, git)) return;
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/entity-create-registry.json";

  let registry = { schema_version: 1, contributions: {}, entries: [] };
  if (await adapter.exists(registryPath)) {
    let raw;
    try {
      raw = await adapter.read(registryPath);
    } catch (e) {
      new Notice(`applyNewEntityButtons: cannot read ${registryPath} (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "new_entity_buttons",
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
      const parsed = JSON.parse(raw);
      // Tolerant of two prior shapes: bare array (legacy) OR
      // {schema_version, contributions, entries}. Both normalize into the
      // current contribution-keyed form so a hand-authored bare-array
      // registry isn't silently dropped on first install.
      if (Array.isArray(parsed)) {
        registry = { schema_version: 1, contributions: {}, entries: parsed.slice() };
      } else if (parsed && typeof parsed === "object") {
        registry = parsed;
        registry.contributions = registry.contributions || {};
        registry.entries = Array.isArray(registry.entries) ? registry.entries : [];
      }
    } catch (e) {
      // Match applyNavButtons C4 posture: do NOT silently overwrite a
      // malformed pre-existing registry file.
      new Notice(`applyNewEntityButtons: ${registryPath} is malformed JSON (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "new_entity_buttons",
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

  // Empty declared new_entity_buttons[] → prune any prior contribution +
  // rewrite flattened entries[]. No write when there was nothing to prune
  // AND the registry file is absent.
  if (declared.length === 0) {
    if (manifest.name in registry.contributions) {
      delete registry.contributions[manifest.name];
      registry.entries = Object.values(registry.contributions).flat();
      await adapter.write(registryPath, JSON.stringify(registry, null, 2));
      if (history) {
        history.push({
          event: "info",
          step: "new_entity_buttons",
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

  const validated = declared
    .map((entry) => resolveEntityCreateEntry(entry, variables, manifest.name, history, git))
    .filter(Boolean);

  if (validated.length === 0) {
    if (history) {
      history.push({
        event: "error",
        step: "new_entity_buttons",
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

  // Materialize render_in side-effects BEFORE writing the registry. A render
  // failure for one entry must not corrupt the registry; injectAccentButtonBlock
  // is already failure-loud + try/catch'd internally so it never throws.
  for (const entry of validated) {
    if (!entry.render_in || typeof entry.render_in !== "object") continue;
    if (entry.render_in.kind === "hub") {
      await injectAccentButtonBlock(tp, entry.render_in.target_path, entry.id, manifest.name, history, git);
    } else if (entry.render_in.kind === "nav_buttons") {
      // v0.46.0 Cycle 1 decision: render_in.kind === "nav_buttons" is
      // schema-reserved but installer rejects it as deferred. All 7 in-scope
      // sites use kind: "hub". Schema-declared but installer rejects with a
      // clear warning so the registry entry survives but no nav-buttons
      // synthesis happens.
      new Notice(`applyNewEntityButtons: render_in.kind="nav_buttons" deferred to future cycle (entry ${entry.id} in ${manifest.name})`, 8000);
      if (history) {
        history.push({
          event: "warning",
          step: "new_entity_buttons",
          name: manifest.name,
          reason: `entry ${entry.id} render_in.kind="nav_buttons" deferred to future cycle`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  // Stamp the blueprint name onto each entry for downstream introspection
  // (audit, doctor, future prune-by-source diagnostics). The contributions
  // map already keys by sourceName, but flattened entries[] loses that
  // grouping otherwise.
  const stamped = validated.map((e) => ({ blueprint: manifest.name, ...e }));
  registry.contributions[manifest.name] = stamped;
  registry.entries = Object.values(registry.contributions).flat();
  await adapter.write(registryPath, JSON.stringify(registry, null, 2));
}

// v0.47.0 S7 — Layer 2 type-field convention rule (validator@0.2.0).
//
// For every blueprint that
//   1. Declares at least one rule_fragments[*] entry whose body contains
//      when.frontmatter.type === "<value>" (forward-defense — the convention
//      is "if a fragment filters by type, every new_entity_buttons must
//      emit that type"), AND
//   2. Declares a new_entity_buttons[] array,
// every new_entity_buttons[*].frontmatter_template MUST declare
// "type": "<value>" matching ONE of the rule_fragments' when-keyed type
// values. Closes BUG-2 (people manifest shipped without type:person; the
// type-filtered People hub queries skipped new entries).
//
// At v0.47.0 no existing blueprint uses when.frontmatter.type — the rule
// is forward-defense. people's BUG-2 fix is the manifest patch (type:person
// added to frontmatter_template) directly. If a future blueprint adopts the
// when.frontmatter.type pattern, this rule fires and blocks install with a
// loud notice + history error.
//
// Returns true on pass; pushes a history error + returns false on violation.
function _validateTypeFieldConvention(manifest, history, git) {
  const fragments = Array.isArray(manifest && manifest.rule_fragments) ? manifest.rule_fragments : [];
  const buttons = Array.isArray(manifest && manifest.new_entity_buttons) ? manifest.new_entity_buttons : [];
  if (!buttons.length) return true;
  const declaredTypes = new Set();
  for (const fr of fragments) {
    const frag = fr && (fr.fragment || fr);
    const when = frag && frag.when;
    const t = when && when.frontmatter && when.frontmatter.type;
    if (typeof t === "string" && t.length > 0) declaredTypes.add(t);
  }
  if (!declaredTypes.size) return true;
  for (const btn of buttons) {
    const fm = btn && btn.frontmatter_template;
    const fmType = (fm && typeof fm === "object") ? fm.type : undefined;
    if (typeof fmType !== "string" || !declaredTypes.has(fmType)) {
      const declared = [...declaredTypes].join(", ");
      const got = (typeof fmType === "string" && fmType.length > 0) ? fmType : "MISSING";
      const message = `new_entity_buttons[${btn && btn.id}].frontmatter_template must declare "type" matching one of rule_fragments' when.frontmatter.type values (declared: ${declared}; got: ${got})`;
      new Notice(`${manifest.name}: ${message}`, 10000);
      if (history) {
        history.push({
          event: "error",
          step: "new_entity_buttons",
          rule: "type_field_convention",
          name: manifest.name,
          button_id: btn && btn.id,
          message,
          git_commit: git && git.commit,
          git_tag: git && git.tag,
          git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return false;
    }
  }
  return true;
}

// Convention: body_template values are blueprint-template basenames.
// If the substituted value has no path separator, prepend templates_path.
// Pre-existing values containing '/' pass through untouched — defensive
// pass-through for forward-compat; the JSON schema at
// platform/mechanisms/entity-create/schema/new-entity-buttons.json
// documents the basename-only constraint but is not currently loaded by
// a runtime validator. THIS HELPER is the operative enforcement; if/when
// the validator mechanism wires up schema-driven manifest validation,
// path-shaped values will be rejected upstream and this branch becomes
// belt-and-suspenders.
//
// Called by resolveEntityCreateEntry for body_template + extra_files[].body_template.
function _resolveBodyTemplatePath(value, variables) {
  if (typeof value !== "string" || !value) return value;
  if (value.includes("/") || value.includes("\\")) return value;
  const templatesPath = (variables && variables.templates_path) || "ranch/templates";
  return `${templatesPath}/${value}`;
}

// resolveEntityCreateEntry — per-entry validation + lenient substitution.
// Returns null for malformed entries (Notice fired + warning history entry);
// otherwise returns the resolved entry with path fields substituted.
//
// Validation layers (v0.46.0 S3 — deep shape validator added):
//   Layer 1 (S2): required-key check at top + destination + render_in levels.
//   Layer 2 (S3): deep shape: id pattern, prompts[].type enum +
//     prompts[].key pattern, render_in.kind oneOf, extra_files[].filename_pattern
//     required. Mirrors the validateAndResolve / validateAndResolveButton posture
//     for nav-buttons: warn-and-skip on any shape failure, install proceeds.
const _EC_ID_RE = /^[a-z][a-z0-9_-]*$/;
const _EC_KEY_RE = /^[a-z][a-z0-9_]*$/;
const _EC_PROMPT_TYPES = new Set(["string", "date", "month", "number", "select"]);

function resolveEntityCreateEntry(entry, variables, sourceName, history, git) {
  const fail = (reason) => {
    new Notice(`new_entity_buttons: invalid entry in ${sourceName} (${reason})`, 8000);
    if (history) {
      history.push({
        event: "warning",
        step: "new_entity_buttons",
        name: sourceName,
        reason: `entry ${(entry && entry.id) || "<no-id>"}: ${reason}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return null;
  };

  // --- Layer 1: required-key checks (S2) ---
  if (!entry || typeof entry !== "object") return fail("entry is not an object");
  if (!entry.id || typeof entry.id !== "string") return fail("missing id");
  if (!entry.label || typeof entry.label !== "string") return fail("missing label");
  if (!Array.isArray(entry.prompts)) return fail("prompts must be an array");
  if (!entry.destination || typeof entry.destination !== "object") return fail("missing destination");
  if (typeof entry.destination.folder_prefix !== "string" || entry.destination.folder_prefix.length === 0) {
    return fail("missing destination.folder_prefix");
  }
  if (typeof entry.destination.filename_prefix !== "string") return fail("missing destination.filename_prefix");
  if (!entry.frontmatter_template || typeof entry.frontmatter_template !== "object") {
    return fail("missing frontmatter_template");
  }
  if (!entry.render_in || typeof entry.render_in !== "object") return fail("missing render_in");
  if (entry.render_in.kind !== "hub" && entry.render_in.kind !== "nav_buttons") {
    return fail(`render_in.kind must be "hub" or "nav_buttons"`);
  }
  if (entry.render_in.kind === "hub" && (typeof entry.render_in.target_path !== "string" || entry.render_in.target_path.length === 0)) {
    return fail(`render_in.kind="hub" requires target_path`);
  }

  // --- Layer 2: deep shape checks (S3) ---
  // id must match ^[a-z][a-z0-9_-]*$ per schema.
  if (!_EC_ID_RE.test(entry.id)) {
    return fail(`id "${entry.id}" does not match ^[a-z][a-z0-9_-]*$`);
  }
  // prompts[] per-entry: type enum + key pattern.
  for (let _pi = 0; _pi < entry.prompts.length; _pi++) {
    const p = entry.prompts[_pi];
    if (!p || typeof p !== "object") return fail(`prompts[${_pi}] is not an object`);
    if (!_EC_PROMPT_TYPES.has(p.type)) {
      return fail(`prompts[${_pi}].type "${p.type}" is not one of ${[..._EC_PROMPT_TYPES].join(", ")}`);
    }
    if (typeof p.key !== "string" || !_EC_KEY_RE.test(p.key)) {
      return fail(`prompts[${_pi}].key "${p.key}" does not match ^[a-z][a-z0-9_]*$`);
    }
  }
  // frontmatter_template must be a plain object (not Array, not null — already
  // checked above for object but exclude arrays explicitly).
  if (Array.isArray(entry.frontmatter_template)) {
    return fail("frontmatter_template must be a plain object, not an array");
  }
  // extra_files[] per-entry: filename_pattern required.
  if (Array.isArray(entry.extra_files)) {
    for (let _ei = 0; _ei < entry.extra_files.length; _ei++) {
      const ef = entry.extra_files[_ei];
      if (!ef || typeof ef !== "object") return fail(`extra_files[${_ei}] is not an object`);
      if (typeof ef.filename_pattern !== "string" || ef.filename_pattern.length === 0) {
        return fail(`extra_files[${_ei}].filename_pattern is required`);
      }
    }
  }

  // Lenient substitution on every path-bearing field (folder_prefix,
  // filename_prefix, filename_suffix, render_in.target_path, body_template,
  // extra_files[].filename_pattern / .subfolder / .body_template) so
  // {{module_directory}} et al. resolve at install time. Frontmatter values,
  // prompts, and inline_body are NOT substituted here — they are user-authored
  // runtime templates rendered by EntityCreate using its own placeholder syntax
  // (e.g., {{date}}, {{title}}).
  const destination = {
    folder_prefix:         substituteLenient(entry.destination.folder_prefix, variables),
    filename_prefix:       substituteLenient(entry.destination.filename_prefix, variables),
  };
  if (typeof entry.destination.folder_date_pattern === "string") {
    destination.folder_date_pattern = entry.destination.folder_date_pattern;
  }
  if (typeof entry.destination.filename_date_pattern === "string") {
    destination.filename_date_pattern = entry.destination.filename_date_pattern;
  }
  if (typeof entry.destination.filename_suffix === "string") {
    destination.filename_suffix = substituteLenient(entry.destination.filename_suffix, variables);
  }

  const resolved = {
    ...entry,
    destination,
  };
  if (typeof entry.body_template === "string") {
    const substituted = substituteLenient(entry.body_template, variables);
    resolved.body_template = _resolveBodyTemplatePath(substituted, variables);
  }
  if (entry.render_in.kind === "hub") {
    resolved.render_in = {
      ...entry.render_in,
      target_path: substituteLenient(entry.render_in.target_path, variables),
    };
  }
  if (Array.isArray(entry.extra_files)) {
    resolved.extra_files = entry.extra_files.map((ef) => {
      if (!ef || typeof ef !== "object") return ef;
      const out = { ...ef };
      if (typeof ef.filename_pattern === "string") {
        out.filename_pattern = substituteLenient(ef.filename_pattern, variables);
      }
      if (typeof ef.subfolder === "string") {
        out.subfolder = substituteLenient(ef.subfolder, variables);
      }
      if (typeof ef.body_template === "string") {
        const substituted = substituteLenient(ef.body_template, variables);
        out.body_template = _resolveBodyTemplatePath(substituted, variables);
      }
      return out;
    });
  }
  return resolved;
}

// injectAccentButtonBlock — VERIFY-ONLY since v0.49.0.
//
// v0.49.0 architectural change (Choice A from v0.49.0 design): hub source files
// own the AccentButton dataviewjs block (each blueprint's content/<Hub>.md
// hand-authors the block with the inside-block JS comment sentinel as its
// first content line). The installer's role is reduced to verifying that the
// expected block exists at the target path; it never edits the file.
//
// Sentinel format change vs v0.46.0+:
//   OLD (outside-block HTML comment):  <!-- entity-create:<id> -->
//   NEW (inside-block JS comment):    // entity-create:<id>
//
// Why the change: the outside-block HTML comment was visible in source/edit
// mode of the hub file (HTML comments render in Obsidian's source view). The
// inside-block JS comment is invisible in BOTH source AND reading modes
// (JS comments inside dataviewjs fences are part of the script body, not
// surfaced as document content). Surfaced as BUG-8 during v0.48.0 S10 manual
// smoke at headspace.
//
// Behavior:
//   - target file absent → warning + history entry; return.
//   - target file read failure → error + history entry; return.
//   - sentinel found inside any dataviewjs fence → success (info history entry,
//     action: "verified_present"); return.
//   - sentinel NOT found → warning + history entry, action:
//     "missing_skip_inject". The hub source file is missing the block; manifest/
//     source mismatch needing hand-fix.
//
// Function never throws; never edits the file. Idempotent by construction.
async function injectAccentButtonBlock(tp, targetPath, instanceId, sourceName, history, git) {
  const adapter = tp.app.vault.adapter;
  const pushWarn = (msg, action) => {
    new Notice(`injectAccentButtonBlock: ${msg}`, 8000);
    if (history) {
      history.push({
        event: "warning",
        step: "entity_create_block_missing",
        name: sourceName,
        target: targetPath,
        instance: instanceId,
        message: msg,
        action,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  };
  const pushErr = (msg) => {
    new Notice(`injectAccentButtonBlock: ${msg}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "entity_create_block_error",
        name: sourceName,
        target: targetPath,
        instance: instanceId,
        message: msg,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  };

  if (typeof targetPath !== "string" || targetPath.length === 0) {
    return pushErr(`target_path missing for entry ${instanceId} (${sourceName})`);
  }
  if (!(await adapter.exists(targetPath))) {
    return pushWarn(
      `target_path ${targetPath} does not exist (entry ${instanceId} in ${sourceName})`,
      "target_absent"
    );
  }

  let body;
  try {
    body = await adapter.read(targetPath);
  } catch (e) {
    return pushErr(`read failed for ${targetPath}: ${e.message}`);
  }

  const sentinel = `// entity-create:${instanceId}`;
  const escSentinel = sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match any dataviewjs fence containing the sentinel comment as one of its
  // body lines. The sentinel must be on its own logical line within the fence.
  const blockRegex = new RegExp(
    "```dataviewjs[ \\t]*\\r?\\n" +
    "[\\s\\S]*?" +
    escSentinel +
    "[\\s\\S]*?" +
    "\\n```",
    ""
  );

  if (blockRegex.test(body)) {
    if (history) {
      history.push({
        event: "info",
        step: "entity_create_block_verified",
        name: sourceName,
        target: targetPath,
        instance: instanceId,
        sentinel,
        action: "verified_present",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  pushWarn(
    `entity-create block missing in ${targetPath}: expected sentinel "${sentinel}" inside a dataviewjs fence (entry ${instanceId} in ${sourceName})`,
    "missing_skip_inject"
  );
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

// applyTemplaterStartupTemplates — for each item that declares
// templater_startup_templates[], read .obsidian/plugins/templater-obsidian/data.json
// and additive-merge each entry into startup_templates[]. Match-by-string-equality;
// first-wins idempotency. Failure-loud (Notice + history). Backup-on-edit to
// <target>.sauce-backup. Honors landmine #12 — never overwrites a malformed
// data.json; never strips user entries.
//
// Parallels applyTemplaterFolderTemplates (install.js:3727) but for the
// startup_templates field (array of strings, each a template path).
//
// Why same data.json target: Templater's settings live in one file; this is
// a different field within the same file. Backup is shared (sequential helpers
// in the install pipeline each write their own .sauce-backup as last-write-wins;
// the LAST helper to modify the file owns the backup snapshot from immediately
// before its own write — sufficient for rollback if last-helper failure is the
// failure mode worth recovering from).
async function applyTemplaterStartupTemplates(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.templater_startup_templates) || manifest.templater_startup_templates.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/templater-obsidian/data.json";

  if (!(await adapter.exists(target))) {
    new Notice(`applyTemplaterStartupTemplates: ${target} absent; cannot register startup-templates for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "templater_startup_templates",
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
    new Notice(`applyTemplaterStartupTemplates: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_templates",
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
    new Notice(`applyTemplaterStartupTemplates: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_templates",
        name: manifest.name,
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.startup_templates)) {
    new Notice(`applyTemplaterStartupTemplates: ${target} parsed but startup_templates not an array; skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_templates",
        name: manifest.name,
        message: `${target} startup_templates not an array`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  let appended = 0;
  for (const entry of manifest.templater_startup_templates) {
    if (typeof entry !== "string" || !entry.trim()) {
      if (history) {
        history.push({
          event: "warning",
          step: "templater_startup_templates",
          name: manifest.name,
          message: "invalid entry shape (expected non-empty string)",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    const resolved = substituteLenient(entry, variables);
    if (!resolved) {
      if (history) {
        history.push({
          event: "warning",
          step: "templater_startup_templates",
          name: manifest.name,
          message: "empty entry after substitution",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (data.startup_templates.includes(resolved)) {
      if (history) {
        history.push({
          event: "info",
          step: "templater_startup_templates",
          name: manifest.name,
          template: resolved,
          action: "skipped_existing",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    data.startup_templates.push(resolved);
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "templater_startup_templates",
        name: manifest.name,
        template: resolved,
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
    new Notice(`applyTemplaterStartupTemplates: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_templates",
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
    new Notice(`applyTemplaterStartupTemplates: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_templates",
        name: manifest.name,
        message: `write failed: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyCustomJsStartupScripts — for each item that declares
// customjs_startup_scripts[], read .obsidian/plugins/customjs/data.json
// and additive-merge each entry into startupScriptNames[]. Match-by-string-equality;
// first-wins idempotency. Failure-loud (Notice + history). Backup-on-edit to
// <target>.sauce-backup. Honors landmine #12 — never overwrites a malformed
// data.json; never strips user entries.
//
// Parallels applyTemplaterStartupTemplates (install.js:3938) but for the
// customjs plugin's startupScriptNames[] field. customjs is a different plugin
// from Templater — it's bound to its own load lifecycle, which empirically fires
// reliably at vault boot (validated at v0.49.0 S0 gate; v0.48.0's Templater
// startup_templates path was unreliable at consumer vaults).
//
// Why same data.json target file pattern: customjs's settings live in one file;
// startupScriptNames[] is a top-level array within it. Backup is shared with
// applyCustomJsSettings (which also writes to this file) — sequential helpers
// in the install pipeline each write their own .sauce-backup as last-write-wins.
async function applyCustomJsStartupScripts(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.customjs_startup_scripts) || manifest.customjs_startup_scripts.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/customjs/data.json";

  if (!(await adapter.exists(target))) {
    new Notice(`applyCustomJsStartupScripts: ${target} absent; cannot register startup-scripts for ${manifest.name}`, 6000);
    if (history) {
      history.push({
        event: "warning",
        step: "customjs_startup_scripts",
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
    new Notice(`applyCustomJsStartupScripts: cannot read ${target} (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_startup_scripts",
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
    new Notice(`applyCustomJsStartupScripts: ${target} malformed JSON (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_startup_scripts",
        name: manifest.name,
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.startupScriptNames)) {
    // customjs may have an empty/absent field on first-init; default to empty array.
    data.startupScriptNames = [];
  }

  let appended = 0;
  for (const entry of manifest.customjs_startup_scripts) {
    if (typeof entry !== "string" || !entry.trim()) {
      if (history) {
        history.push({
          event: "warning",
          step: "customjs_startup_scripts",
          name: manifest.name,
          message: "invalid entry shape (expected non-empty string)",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    const resolved = substituteLenient(entry, variables);
    if (!resolved || !resolved.trim()) {
      if (history) {
        history.push({
          event: "warning",
          step: "customjs_startup_scripts",
          name: manifest.name,
          message: "empty entry after substitution",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    if (data.startupScriptNames.includes(resolved)) {
      if (history) {
        history.push({
          event: "info",
          step: "customjs_startup_scripts",
          name: manifest.name,
          script: resolved,
          action: "skipped_existing",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    data.startupScriptNames.push(resolved);
    appended++;
    if (history) {
      history.push({
        event: "info",
        step: "customjs_startup_scripts",
        name: manifest.name,
        script: resolved,
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
    new Notice(`applyCustomJsStartupScripts: backup write failed (${e.message}); aborting modification for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_startup_scripts",
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
    new Notice(`applyCustomJsStartupScripts: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "customjs_startup_scripts",
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

// applySnippets — for each item that declares manifest.snippets[], copy the
// source CSS asset to <vault>/.obsidian/snippets/<name>.css. Platform-vendored
// snippets only — entry.name MUST match /^sauce-[A-Za-z0-9._-]+$/ (carve-out
// codified in landmine #12 v0.41.0 amendment so consumer-authored snippets at
// other names are never touched). Mirrors applyVendoredThemes posture:
// sha256-compare overwrite-with-backup (`.sauce-backup` suffix on overwrite of
// non-empty prior content), failure-loud history (Notice + history.error on
// read/write failures; aborts modification on backup-write failure), never-
// throws. Registration in .obsidian/appearance.json's enabledCssSnippets[]
// piggybacks on the existing applyAppearance helper — callers declare
// `appearance.enabledCssSnippets` in the same manifest. NEW v0.41.0.
async function applySnippets(tp, manifest, workshopPath, targetPath, history, git) {
  if (!manifest || !Array.isArray(manifest.snippets) || manifest.snippets.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const fs = require("fs");
  const fsp = fs.promises;
  const nodePath = require("path");
  const crypto = require("crypto");

  const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

  for (const entry of manifest.snippets) {
    const valid =
      entry &&
      typeof entry.source === "string" && entry.source.length > 0 &&
      typeof entry.name === "string" && entry.name.length > 0 &&
      /^sauce-[A-Za-z0-9._-]+$/.test(entry.name);

    if (!valid) {
      new Notice(`applySnippets: ${manifest.name} invalid snippet entry; skipped`, 6000);
      if (history) {
        history.push({
          event: "warning",
          step: "snippets",
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

    const srcAbs = nodePath.join(workshopPath, "platform", targetPath, entry.source);
    if (!fs.existsSync(srcAbs)) {
      new Notice(`applySnippets: source absent ${srcAbs} for ${manifest.name}/${entry.name}`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "snippets",
          name: manifest.name,
          message: `source absent: ${srcAbs}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    let srcBody;
    try {
      srcBody = await fsp.readFile(srcAbs, "utf8");
    } catch (e) {
      new Notice(`applySnippets: read source failed for ${srcAbs} (${e.message})`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "snippets",
          name: manifest.name,
          message: `read source failed: ${e.message}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

    const destRel = `.obsidian/snippets/${entry.name}.css`;

    // Ensure dest dir exists (mkdir-already-exists is non-fatal).
    try {
      await adapter.mkdir(".obsidian/snippets");
    } catch (e) {
      if (!/exists|EEXIST/i.test(e.message || "")) {
        new Notice(`applySnippets: mkdir .obsidian/snippets failed (${e.message})`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "snippets",
            name: manifest.name,
            message: `mkdir failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }

    const exists = await adapter.exists(destRel);
    if (exists) {
      let existingBody;
      try {
        existingBody = await adapter.read(destRel);
      } catch (e) {
        new Notice(`applySnippets: read dest failed for ${destRel} (${e.message})`, 8000);
        if (history) {
          history.push({
            event: "error",
            step: "snippets",
            name: manifest.name,
            message: `read dest failed: ${e.message}`,
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const existingHash = sha256(Buffer.from(existingBody, "utf8"));
      const srcHash = sha256(Buffer.from(srcBody, "utf8"));
      if (existingHash === srcHash) {
        if (history) {
          history.push({
            event: "info",
            step: "snippets",
            name: manifest.name,
            snippet: entry.name,
            action: "skipped_identical",
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      // Divergent: backup non-empty prior content before overwrite.
      if (existingBody && existingBody.length > 0) {
        try {
          await adapter.write(`${destRel}.sauce-backup`, existingBody);
        } catch (e) {
          new Notice(`applySnippets: backup write failed for ${destRel}.sauce-backup (${e.message}); aborting overwrite`, 8000);
          if (history) {
            history.push({
              event: "error",
              step: "snippets",
              name: manifest.name,
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
    }

    try {
      await adapter.write(destRel, srcBody);
    } catch (e) {
      new Notice(`applySnippets: dest write failed for ${destRel} (${e.message})`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "snippets",
          name: manifest.name,
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
        event: "info",
        step: "snippets",
        name: manifest.name,
        snippet: entry.name,
        action: exists ? "overwrote" : "applied",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
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

// ============================================================
// v0.32.0 S2 — aggregateClaudeSurface
//
// Walks the subscribed mechanisms + blueprints, harvests each item's
// `claude_surface[]` array, substitutes per-item variables ({{module_directory}}
// for blueprints with module_directory; {{skills_dir}} for items with
// skills_dir), categorizes entries into:
//
//   - materializeList: { kind, source, dest, version, owner } for kinds
//       command | skill | context_doc (files to copy in S3 materializer).
//   - rows: { 'directory-map': [...], 'resolvers': [...], 'skills-index': [...] }
//       table-keyed buckets for kind=claude_md_row.
//
// Returns { registry, materializeList, rows } where registry is the canonical
// shape persisted to ranch/claude-surface-registry.json in S3:
//   { schema_version: 1, generated_at, workshop_version, contributions: {<name>:[...]} }
//
// Behavior contract:
//   - Subscription-aware: items present in perItemManifest but absent from
//     subscription.mechanisms/blueprints are NOT included.
//   - Destination path allowlist: only `.claude/`, `<module_directory>/`
//     (resolved to spice/<bare>/), `Docs/Meta/`, `ranch/` prefixes accepted
//     for kinds command|skill|context_doc. Disallowed dests log an
//     `error` event with step `claude_surface_dest_disallowed` and are
//     skipped (not in materializeList, not in registry contributions).
//   - claude_md_row entries: any string field in `row` undergoes
//     substituteLenient with the item's overlay vars so {{module_directory}}
//     in `row.path` resolves to spice/<bare>/.
//   - rows[<table>] is sorted alphabetically by primary key after
//     aggregation: topic for resolvers, command for skills-index, path for
//     directory-map. Stable for ties.
//   - history: pushes aggregator summary event + per-skip error events.
//
// Pure function — no filesystem I/O. Callers (install.js step 6b in S3,
// run-claude-surface.js harness) pass in the already-loaded perItemManifest.
//
// Inputs:
//   perItemManifest: Map<name, manifest>
//   subscription:    { mechanisms: [{name,version}], blueprints: [{name,version}] }
//   history:         array; aggregator pushes events onto it
//   git:             { commit, tag, dirty } — included on every event push
//   opts (optional): { workshop_version, targetPathByName: Map<name,string> }
//                    targetPathByName — if provided, each materializeList entry
//                    gains a `target_path` field (e.g. "blueprints/cowork")
//                    plus an `itemVars` snapshot. S3's materializeClaudeSurface
//                    uses both to resolve the source file
//                    (`${workshopPath}/platform/${target_path}/${source}`) and
//                    re-apply substituteLenient to the source body content.
//                    When absent (the original S2 contract), entries omit those
//                    fields and the aggregator behaves exactly as before — pure
//                    additive, preserves backward-compat with CS-AG-* tests.
//
// Output:
//   { registry, materializeList, rows }
// ============================================================
const CLAUDE_SURFACE_ALLOWED_DEST_PREFIXES = [".claude/", "Docs/Meta/", "ranch/"];
const CLAUDE_SURFACE_ROW_SORT_KEY = {
  "resolvers": "topic",
  "skills-index": "command",
  "directory-map": "path",
};

async function aggregateClaudeSurface(perItemManifest, subscription, history, git, opts) {
  opts = opts || {};
  const targetPathByName = opts.targetPathByName instanceof Map ? opts.targetPathByName : null;
  const out = {
    registry: {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      workshop_version: opts.workshop_version || null,
      contributions: {},
    },
    materializeList: [],
    rows: {
      "directory-map": [],
      "resolvers": [],
      "skills-index": [],
    },
  };

  // Build subscribed-name set keyed by name; preserve { name, version, kind }.
  const subscribed = new Map();
  for (const m of (subscription && subscription.mechanisms) || []) {
    subscribed.set(m.name, { name: m.name, version: m.version, kind: "mechanism" });
  }
  for (const b of (subscription && subscription.blueprints) || []) {
    subscribed.set(b.name, { name: b.name, version: b.version, kind: "blueprint" });
  }

  let entryCount = 0;
  let rejectCount = 0;

  for (const [name, subEntry] of subscribed) {
    const itemMan = perItemManifest.get(name);
    if (!itemMan) continue;

    // v0.32.0 S8 — backwards-compat shim: legacy `manifest.skills[]` field
    // (pre-S1 cowork shape) is processed as if its entries were
    // `claude_surface[]` entries of kind=skill. Emits a deprecation event on
    // every shimmed manifest so the drift is visible in install history.
    // Removal target: v0.34.0 (wave 3). After cowork's S8 dogfood migration,
    // no blueprint in tree uses manifest.skills[]; this shim only fires if
    // someone copy-pastes the legacy shape into a new blueprint.
    let cs = itemMan.claude_surface;
    if (Array.isArray(itemMan.skills) && itemMan.skills.length > 0) {
      if (history) {
        history.push({
          event: "deprecation",
          step: "manifest_skills_legacy",
          name,
          message: `${name} manifest.skills[] is deprecated; use claude_surface[] kind=skill (removal target v0.34.0)`,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
      const shimmed = itemMan.skills
        .filter((s) => s && typeof s.source === "string" && typeof s.dest === "string")
        .map((s) => ({ kind: "skill", source: s.source, dest: s.dest }));
      cs = Array.isArray(cs) && cs.length > 0 ? cs.concat(shimmed) : shimmed;
    }
    if (!Array.isArray(cs) || cs.length === 0) continue;

    // Build the item's substitution overlay — mirrors the install-loop
    // overlay at install.js step 6 (lines ~385-400). Blueprint with a
    // module_directory gets {{module_directory}} → spice/<bare>. Any item
    // (blueprint or mechanism) with skills_dir gets {{skills_dir}}.
    const itemVars = {};
    if (subEntry.kind === "blueprint" && typeof itemMan.module_directory === "string" && itemMan.module_directory.length > 0) {
      itemVars.module_directory = `spice/${itemMan.module_directory}`;
    }
    if (typeof itemMan.skills_dir === "string" && itemMan.skills_dir.length > 0) {
      itemVars.skills_dir = itemMan.skills_dir;
    }

    const contributions = [];
    for (let i = 0; i < cs.length; i++) {
      const entry = cs[i];
      if (!entry || typeof entry !== "object") continue;
      const kind = entry.kind;

      if (kind === "command" || kind === "skill" || kind === "context_doc") {
        if (typeof entry.source !== "string" || typeof entry.dest !== "string") continue;
        const dest = substituteLenient(entry.dest, itemVars);

        // Destination allowlist: explicit prefix check. The item's own
        // module_directory (spice/<bare>/) is a sanctioned prefix because
        // it resolves via substituteLenient above; we check explicitly.
        const moduleDirPrefix = itemVars.module_directory ? `${itemVars.module_directory}/` : null;
        const allowed =
          CLAUDE_SURFACE_ALLOWED_DEST_PREFIXES.some((p) => dest.startsWith(p)) ||
          (moduleDirPrefix && dest.startsWith(moduleDirPrefix));

        if (!allowed) {
          rejectCount++;
          if (history) {
            history.push({
              event: "error",
              step: "claude_surface_dest_disallowed",
              name,
              index: i,
              kind,
              dest,
              message: `${name} claude_surface[${i}] dest "${dest}" is not within an allowlisted prefix (.claude/, Docs/Meta/, ranch/, or <module_directory>/)`,
              git_commit: git ? git.commit : null,
              git_tag: git ? git.tag : null,
              git_dirty: git ? git.dirty : null,
              attempted_at: new Date().toISOString(),
            });
          }
          continue;
        }

        const matEntry = {
          kind,
          source: entry.source,
          dest,
          version: subEntry.version,
          owner: name,
        };
        if (targetPathByName) {
          const tp = targetPathByName.get(name);
          if (typeof tp === "string" && tp.length > 0) {
            matEntry.target_path = tp;
          }
          // Snapshot the substitution overlay so S3's materializer can
          // re-substitute the source body content using the same vars the
          // aggregator used for the dest path. Shallow copy so later
          // iterations cannot mutate this entry's vars.
          matEntry.itemVars = { ...itemVars };
        }
        out.materializeList.push(matEntry);
        contributions.push({ kind, source: entry.source, dest, version: subEntry.version });
        entryCount++;
      } else if (kind === "claude_md_row") {
        const table = entry.table;
        if (typeof table !== "string" || !(table in out.rows)) continue;
        if (!entry.row || typeof entry.row !== "object" || Array.isArray(entry.row)) continue;

        // Substitute string-valued row fields lenient-style with itemVars
        // so {{module_directory}} → spice/<bare>/ resolves in row.path.
        const substRow = {};
        for (const [k, v] of Object.entries(entry.row)) {
          if (typeof v === "string") substRow[k] = substituteLenient(v, itemVars);
          else substRow[k] = v;
        }
        const rowOut = { ...substRow, owner: name };
        out.rows[table].push(rowOut);
        contributions.push({ kind, table, row: substRow });
        entryCount++;
      }
    }

    if (contributions.length > 0) {
      out.registry.contributions[name] = contributions;
    }
  }

  // Sort each table's rows alphabetically by its primary key.
  for (const [table, primaryKey] of Object.entries(CLAUDE_SURFACE_ROW_SORT_KEY)) {
    out.rows[table].sort((a, b) => {
      const ak = (a && typeof a[primaryKey] === "string") ? a[primaryKey] : "";
      const bk = (b && typeof b[primaryKey] === "string") ? b[primaryKey] : "";
      if (ak < bk) return -1;
      if (ak > bk) return 1;
      return 0;
    });
  }

  if (history) {
    history.push({
      event: "aggregate",
      step: "claude_surface_aggregate",
      contributions: Object.keys(out.registry.contributions).length,
      entries: entryCount,
      rejected: rejectCount,
      git_commit: git ? git.commit : null,
      git_tag: git ? git.tag : null,
      git_dirty: git ? git.dirty : null,
      attempted_at: new Date().toISOString(),
    });
  }

  return out;
}

// ============================================================
// v0.32.0 S3 — materializeClaudeSurface
//
// Reads each entry from aggregateClaudeSurface's materializeList and writes
// the source body to the vault-relative dest. Mirrors materializeSkills'
// vault-write abstraction (tp.app.vault.adapter.{exists,mkdir,write}) so
// Obsidian and the node-harness fake-tp both work without code-path forks.
//
// Posture vs materializeSkills:
//   - Per-entry try/catch — single failure does NOT abort the loop.
//   - Substitutes the SOURCE body content with `entry.itemVars`
//     (substituteLenient) at materialize time. The aggregator already
//     substituted the DEST path; this closes the body-content gap.
//   - Source path is resolved as
//     `${workshopPath}/platform/${entry.target_path}/${entry.source}`.
//     entry.target_path is set when the aggregator was called with
//     `opts.targetPathByName`; if absent the entry is skipped with a
//     history error (the install-flow call site always provides it).
//   - Missing source file → error event, loop continues.
//   - Atomicity: dest dir is created recursively before write.
//     adapter.write itself is the atomicity unit — mirrors materializeSkills
//     (which has shipped to all consumers since v0.30.0 without atomic-
//     write incidents). Spec called for .tmp+rename; choosing the
//     materializeSkills precedent keeps the vault-write abstraction
//     consistent across both helpers and avoids forking the code path
//     between Obsidian's adapter (no rename) and node fs (has rename).
//   - Event: `claude_surface_install` per successful write with
//     { kind, dest, owner, version, git fields, attempted_at }.
//
// Inputs:
//   materializeList: Array<{kind, source, dest, version, owner, target_path, itemVars}>
//   tp:              Obsidian Templater stub OR test fake — anything with
//                    tp.app.vault.adapter.{exists, mkdir, write}.
//   workshopPath:    abs path to the workshop repo (source of platform/<bp>/<src>).
//   history:         array; per-entry events pushed onto it.
//   git:             { commit, tag, dirty } — included on every push.
//
// Output: undefined. Side effects are file writes + history pushes.
// ============================================================
async function materializeClaudeSurface(materializeList, tp, workshopPath, history, git) {
  if (!Array.isArray(materializeList) || materializeList.length === 0) return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  for (const entry of materializeList) {
    try {
      if (!entry || typeof entry !== "object") continue;
      const { kind, source, dest, owner, version, target_path, itemVars } = entry;

      if (typeof source !== "string" || source.length === 0 ||
          typeof dest !== "string" || dest.length === 0 ||
          typeof target_path !== "string" || target_path.length === 0) {
        if (history) {
          history.push({
            event: "error",
            step: "claude_surface_install",
            kind,
            owner,
            dest,
            message: `materializeClaudeSurface: entry missing source/dest/target_path (owner=${owner}, kind=${kind})`,
            git_commit: git ? git.commit : null,
            git_tag: git ? git.tag : null,
            git_dirty: git ? git.dirty : null,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const sourceAbs = `${workshopPath}/platform/${target_path}/${source}`;
      const sourceText = await readAbsolute(sourceAbs);
      if (sourceText === null) {
        if (history) {
          history.push({
            event: "error",
            step: "claude_surface_install",
            kind,
            owner,
            dest,
            message: `source absent at ${sourceAbs}`,
            git_commit: git ? git.commit : null,
            git_tag: git ? git.tag : null,
            git_dirty: git ? git.dirty : null,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const substituted = substituteLenient(sourceText, itemVars || {});

      // Ensure dest dir exists (recursive mkdir).
      const destDir = dest.includes("/") ? dest.substring(0, dest.lastIndexOf("/")) : "";
      if (destDir && !(await adapter.exists(destDir))) {
        await adapter.mkdir(destDir);
      }

      await adapter.write(dest, substituted);

      if (history) {
        history.push({
          event: "claude_surface_install",
          step: "claude_surface_install",
          kind,
          dest,
          owner,
          version,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      if (history) {
        history.push({
          event: "error",
          step: "claude_surface_install",
          kind: entry && entry.kind,
          owner: entry && entry.owner,
          dest: entry && entry.dest,
          message: e.message,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
    }
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

// pruneEntityCreateRegistry — drop contributions.<X> for any X not in the
// current subscription. Symmetric with pruneNavButtonsRegistry: same C4
// hardening, same Notice + history posture, same idempotency. Closes the
// "consumer unsubscribes from a blueprint entirely" gap that applyNewEntityButtons
// alone can't see (applyNewEntityButtons only runs for items still in the
// subscription, so an entirely-removed blueprint's prior contribution would
// otherwise persist forever in the registry). Mirrors the v0.2.0+ nav-buttons
// subscription-aware prune pattern.
//
// Registry shape: { schema_version, contributions: { <name>: [...] }, entries: [...] }.
// When a contribution is pruned, the flattened entries[] view is rebuilt from
// the remaining contributions so the EntityCreate runtime view stays coherent.
async function pruneEntityCreateRegistry(tp, subscription, history, git) {
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/entity-create-registry.json";
  if (!(await adapter.exists(registryPath))) return;

  let raw;
  try {
    raw = await adapter.read(registryPath);
  } catch (e) {
    new Notice(`pruneEntityCreateRegistry: cannot read ${registryPath} (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "entity_create_prune",
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
    new Notice(`pruneEntityCreateRegistry: ${registryPath} is malformed JSON (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "entity_create_prune",
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
    new Notice(`pruneEntityCreateRegistry: ${registryPath} parsed but has unexpected shape (expected object). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "entity_create_prune",
        message: `${registryPath} parsed but has unexpected shape (expected object)`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  if (!registry.contributions || typeof registry.contributions !== "object") return;

  const subscribedNames = new Set([
    ...((subscription && subscription.mechanisms) || []).map((m) => m.name),
    ...((subscription && subscription.blueprints) || []).map((b) => b.name),
  ]);

  let mutated = false;
  for (const source of Object.keys(registry.contributions)) {
    if (!subscribedNames.has(source)) {
      delete registry.contributions[source];
      mutated = true;
      if (history) {
        history.push({
          event: "info",
          step: "entity_create_prune",
          action: "pruned_unsubscribed_blueprint",
          source,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (mutated) {
    // Rewrite the flattened entries[] view so EntityCreate runtime stays
    // coherent with the pruned contributions map.
    registry.entries = Object.values(registry.contributions).flat();
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

// ============================================================
// v0.32.0 S5 — pruneClaudeSurface
//
// Subscription-aware diff prune for the claude_surface registry. Mirrors
// pruneNavButtonsRegistry's C4 hardening posture: any malformed input is
// reported via a `warning` event and the function returns cleanly — it
// never aborts the broader install.
//
// Behavior:
//   1. prevRegistry null/undefined → return (first install case).
//   2. prevRegistry malformed (not a plain object, or missing `contributions`
//      object) → emit { event: "warning", step: "claude_surface_prune_malformed_prev" }
//      and return.
//   3. Compute the per-owner diff:
//        - Owner present in prev but absent in new → walk every file-kind
//          entry (those with a `dest` string) and delete the dest file.
//        - Owner present in both → compute dest-keyed set difference
//          (prev[owner].dest \ new[owner].dest); delete the orphans.
//      claude_md_row entries are skipped (they have no `dest`; rows are
//      dropped from CLAUDE.md by the regen step).
//   4. Each adapter.remove() is wrapped in its own try/catch. ENOENT (file
//      already gone) is logged as a `warning`; other errors emit `error`.
//      Successful deletes emit { event: "claude_surface_prune", surface_kind,
//      dest, removed_from, ... }.
//
// Inputs:
//   prevRegistry: prior on-disk registry (parsed JSON object) or null.
//   newRegistry:  freshly-built registry from aggregateClaudeSurface.
//   tp:           Templater stub OR test fake — anything with tp.app.vault.adapter.
//   history:      array; events pushed onto it.
//   git:          { commit, tag, dirty } — included on every push.
//
// Output: undefined.
// ============================================================
async function pruneClaudeSurface(prevRegistry, newRegistry, tp, history, git) {
  if (prevRegistry === null || prevRegistry === undefined) return;

  const malformed =
    prevRegistry === null ||
    typeof prevRegistry !== "object" ||
    Array.isArray(prevRegistry) ||
    !prevRegistry.contributions ||
    typeof prevRegistry.contributions !== "object" ||
    Array.isArray(prevRegistry.contributions);

  if (malformed) {
    if (history) {
      history.push({
        event: "warning",
        step: "claude_surface_prune_malformed_prev",
        message: "prev claude-surface-registry has unexpected shape (expected object with contributions field); skipping prune",
        git_commit: git ? git.commit : null,
        git_tag: git ? git.tag : null,
        git_dirty: git ? git.dirty : null,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const prevContribs = prevRegistry.contributions || {};
  const newContribs = (newRegistry && newRegistry.contributions) || {};

  // Helper — collect the file-kind dests for an owner's contribution array.
  // Returns Map<dest, {kind}>. claude_md_row entries (no dest) are skipped.
  const destMap = (arr) => {
    const m = new Map();
    if (!Array.isArray(arr)) return m;
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.dest !== "string" || entry.dest.length === 0) continue;
      m.set(entry.dest, { kind: entry.kind });
    }
    return m;
  };

  // Helper — delete a single dest with full hardening.
  const tryDelete = async (dest, surfaceKind, owner) => {
    try {
      const exists = await adapter.exists(dest);
      if (!exists) {
        if (history) {
          history.push({
            event: "warning",
            step: "claude_surface_prune",
            surface_kind: surfaceKind,
            dest,
            removed_from: owner,
            message: "file already absent at delete time",
            git_commit: git ? git.commit : null,
            git_tag: git ? git.tag : null,
            git_dirty: git ? git.dirty : null,
            attempted_at: new Date().toISOString(),
          });
        }
        return;
      }
      await adapter.remove(dest);
      if (history) {
        history.push({
          event: "claude_surface_prune",
          step: "claude_surface_prune",
          surface_kind: surfaceKind,
          dest,
          removed_from: owner,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      if (history) {
        history.push({
          event: "warning",
          step: "claude_surface_prune",
          surface_kind: surfaceKind,
          dest,
          removed_from: owner,
          message: `delete failed: ${e.message}`,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  };

  for (const owner of Object.keys(prevContribs)) {
    const prevDests = destMap(prevContribs[owner]);
    const newDests = destMap(newContribs[owner]);
    for (const [dest, info] of prevDests) {
      if (!newDests.has(dest)) {
        await tryDelete(dest, info.kind, owner);
      }
    }
  }
}

// ============================================================
// v0.32.0 S5 — applyLocalShadows
//
// Consumer override seam. Walks `.claude/commands.local/**` and
// `.claude/skills.local/**` for `.md` files; for each, reads the body and
// OVERWRITES the parallel canonical path under `.claude/commands/` or
// `.claude/skills/`. Bodies are copied verbatim — no substitution — because
// .local/ is raw consumer content.
//
// Posture:
//   - Step runs AFTER materializeClaudeSurface in install.js (step 6f),
//     so canonical files are already on disk when shadows are applied.
//   - Missing .local/ directories → silent (first-install case).
//   - Adapter errors during walk or write → `error` event with step
//     "claude_local_shadow"; loop continues.
//   - Successful overwrites → `claude_local_shadow` event per file.
//
// Inputs:
//   tp:      Templater stub OR test fake — tp.app.vault.adapter.{exists,list,read,write,mkdir}.
//   history: array; events pushed onto it.
//   git:     { commit, tag, dirty } — included on every push.
//
// Output: undefined.
// ============================================================
async function applyLocalShadows(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  // Recursive walk via adapter.list() — returns { files, folders } of
  // vault-relative path strings. Builds a flat string[] of every file path
  // beneath `rootRel`.
  async function walkFiles(rootRel) {
    const out = [];
    const stack = [rootRel];
    while (stack.length > 0) {
      const cur = stack.pop();
      let listing;
      try {
        listing = await adapter.list(cur);
      } catch (e) {
        // Treat list-failures on subdirs as walk errors (the root-exists
        // check is upstream, so this should be rare).
        if (history) {
          history.push({
            event: "error",
            step: "claude_local_shadow",
            message: `list failed for ${cur}: ${e.message}`,
            git_commit: git ? git.commit : null,
            git_tag: git ? git.tag : null,
            git_dirty: git ? git.dirty : null,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
      for (const f of listing.files || []) out.push(f);
      for (const d of listing.folders || []) stack.push(d);
    }
    return out;
  }

  const shadowRoots = [
    { localRoot: ".claude/commands.local", canonRoot: ".claude/commands", kind: "command" },
    { localRoot: ".claude/skills.local", canonRoot: ".claude/skills", kind: "skill" },
  ];

  for (const { localRoot, canonRoot, kind } of shadowRoots) {
    try {
      if (!(await adapter.exists(localRoot))) continue;
      const files = await walkFiles(localRoot);
      for (const srcPath of files) {
        try {
          if (!srcPath.endsWith(".md")) continue;
          // Compute canonical = srcPath with localRoot/ → canonRoot/.
          const canonDest = canonRoot + srcPath.substring(localRoot.length);
          const content = await adapter.read(srcPath);
          const canonDir = canonDest.includes("/") ? canonDest.substring(0, canonDest.lastIndexOf("/")) : "";
          if (canonDir && !(await adapter.exists(canonDir))) {
            await adapter.mkdir(canonDir);
          }
          await adapter.write(canonDest, content);
          if (history) {
            history.push({
              event: "claude_local_shadow",
              step: "claude_local_shadow",
              kind,
              dest: canonDest,
              source: srcPath,
              git_commit: git ? git.commit : null,
              git_tag: git ? git.tag : null,
              git_dirty: git ? git.dirty : null,
              attempted_at: new Date().toISOString(),
            });
          }
        } catch (e) {
          if (history) {
            history.push({
              event: "error",
              step: "claude_local_shadow",
              kind,
              source: srcPath,
              message: e.message,
              git_commit: git ? git.commit : null,
              git_tag: git ? git.tag : null,
              git_dirty: git ? git.dirty : null,
              attempted_at: new Date().toISOString(),
            });
          }
        }
      }
    } catch (e) {
      if (history) {
        history.push({
          event: "error",
          step: "claude_local_shadow",
          kind,
          message: `shadow walk failed for ${localRoot}: ${e.message}`,
          git_commit: git ? git.commit : null,
          git_tag: git ? git.tag : null,
          git_dirty: git ? git.dirty : null,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }
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
    // v0.32.0 S2 — expose aggregateClaudeSurface for run-claude-surface.js
    // (CS-AG-1..7). Pure additive; does not affect the function-as-default export.
    module.exports.aggregateClaudeSurface = aggregateClaudeSurface;
    // v0.32.0 S3 — expose materializeClaudeSurface for run-claude-surface.js
    // (CS-MAT-1..5) + run-helper-cases.js (M-CS-1..3). Pure additive.
    module.exports.materializeClaudeSurface = materializeClaudeSurface;
    // v0.32.0 S5 — expose pruneClaudeSurface + applyLocalShadows for
    // run-claude-surface.js (CS-PR-1..3, CS-SH-1..4). Pure additive.
    module.exports.pruneClaudeSurface = pruneClaudeSurface;
    module.exports.applyLocalShadows = applyLocalShadows;
    // v0.52.0 S5 — expose migration helpers for run-wiki-to-docs-migration.js
    // (WTD-MIG-1..3). Pure additive; does not affect the function-as-default export.
    module.exports.applyWikiToDocsMigration = applyWikiToDocsMigration;
    module.exports.applyDocsBackfill = applyDocsBackfill;
    module.exports._rewriteWikiToDocsBody = _rewriteWikiToDocsBody;
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
