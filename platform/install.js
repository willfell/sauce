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
  // v0.60.0 — array-form spawnSync replaces execSync template-literal calls
  // (F-1 in 2026-05-18 security report). Skips shell parsing entirely; no
  // quoting concerns regardless of what workshopPath contains.
  const { spawnSync } = require("child_process");
  function _git(args, stderrMode) {
    const r = spawnSync("git", ["-C", workshopPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", stderrMode || "pipe"]
    });
    if (r.status !== 0) throw new Error(r.stderr || `git ${args.join(" ")} failed`);
    return (r.stdout || "").trim();
  }
  const result = { commit: null, tag: null, dirty: null };
  try {
    result.commit = _git(["rev-parse", "HEAD"]);
  } catch { /* not a git repo, or git unavailable; leave null */ }
  try {
    // Equivalent of the prior `2>/dev/null` shell redirection — `describe`
    // emits a non-fatal stderr line when HEAD has no exact-match tag.
    const out = _git(["describe", "--tags", "--exact-match", "HEAD"], "ignore");
    result.tag = out.length > 0 ? out : null;
  } catch { /* HEAD has no exact tag; leave null */ }
  try {
    const status = _git(["status", "--porcelain"]);
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
  let manifest = null; // v0.75.1 Workstream E: hoisted so finally block can read manifest.workshop_version
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

    manifest = await readJsonAbsolute(`${workshopPath}/platform/manifest.json`);

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
    await applyVaultDefaultPaths(tp, installedNow.history, git);   // NEW v0.102.0 — codify default attachment + new-note paths
    await applyEmptyProjectWikilinkRepair(tp, installedNow.history, git);   // NEW v0.105.0.2 — heals doc-note + section-hub with project: "[[]]" from v0.105.0 substitution bug; per-vault scope so it runs unconditionally

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
          // v0.53.0 (FA-1): Layer 2 canonical-vocab opt-in/out gate. Warns
          // (no install fail) when a blueprint neither opts into
          // `_canonical-vocab` via rule_fragments[*].fragment.extends nor
          // declares canonical_vocab_opt_out: { reason: "..." }. Forward
          // defense — at v0.53.0 no blueprint opts in, so this surfaces a
          // warning row per blueprint in install history. Promoted to a hard
          // fail in a post-FA-7 cycle once all consumer vaults are migrated.
          _validateCanonicalVocab(itemMan, installedNow.history, git);
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

    // 6a2. v0.59.8 — one-shot orphan-prune of Templater startup_templates[].
    // Removes entries Sauce previously added (e.g. v0.48.0's
    // Template, Project Task Create Listener.md backstop) that no longer ship.
    // Wrapped in try/catch so prune failure doesn't abort downstream steps.
    // SUNSET ≥v0.62.0 — once all consumer vaults have run ≥v0.59.8 once.
    try {
      await pruneTemplaterStartupOrphans(tp, installedNow.history, git);
    } catch (e) {
      new Notice(`pruneTemplaterStartupOrphans crashed: ${e.message}`, 8000);
      installedNow.history.push({
        event: "error",
        step: "templater_startup_orphans_prune",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
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
      // v0.75.1 Workstream E: refresh top-level workshop_version field so
      // `jq -r .workshop_version platform-installed.json` reflects what's
      // actually installed, not a stale or null value from a prior install.
      installedNow.workshop_version = manifest.workshop_version || installedNow.workshop_version || null;
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

    // v0.59.9: `materialize_once: true` on a files[] entry means materialize
    // on FIRST install only — never overwrite a pre-existing dest. Protects
    // user-mutable content that the platform seeds once but the user (or a
    // plugin like obsidian-kanban) mutates afterwards. Without this guard,
    // every reinstall clobbers the dest with the workshop template body and
    // destroys accumulated user content (kanban card links, board column
    // assignments, etc.).
    if (f.materialize_once && destExists) {
      if (history) {
        history.push({
          event: "info",
          step: "file_overwrite",
          name: mech.name,
          dest: destPath,
          action: "skipped_materialize_once",
          message: "file declares materialize_once=true and dest exists; preserving user content",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }

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

    // v0.106.0 S1 — helper-script content-overwrite posture. Closes the
    // 3-cycle cp workaround: dot-js files materialized under ranch/scripts/
    // are platform-shipped CustomJS class bodies — never user-edited content.
    // The default Option B path (line below) creates a .bak sidecar for every
    // overwrite, which left cruft and gated the install on .bak write success.
    // For helper scripts specifically, write the substituted content cleanly
    // (no .bak), and emit a content_overwrite history event so the change is
    // still observable. Blast radius is limited to ranch/scripts/.+\.js$ paths;
    // every other path (frontmatter merges, template backups, etc.) keeps the
    // existing posture.
    if (priorContent !== null && /ranch\/scripts\/.+\.js$/.test(destPath)) {
      if (priorContent !== substituted) {
        await adapter.write(destPath, substituted);
        if (history) {
          const crypto = require("crypto");
          history.push({
            event: "info",
            step: "content_overwrite",
            name: mech.name,
            dest: destPath,
            action: "content_overwrite_helper_script",
            prior_sha: crypto.createHash("sha256").update(priorContent).digest("hex"),
            new_sha: crypto.createHash("sha256").update(substituted).digest("hex"),
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      }
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
  // FLN-v82-2 (v0.82.1): reset each (source, target) pair's contributions
  // BEFORE the per-fragment loop, so re-installs don't accumulate duplicates.
  // The reset is a no-op when the target file doesn't exist (fresh vault).
  const _resetTargets = new Set();
  for (const frag of mech.rule_fragments || []) {
    if (frag && frag.target && !_resetTargets.has(frag.target)) {
      await resetSourceContributions(tp, frag.target, mech.name, variables, history, git);
      _resetTargets.add(frag.target);
    }
  }
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
  await applyDocsHubButtonRepair(tp, mech, variables, history, git);   // NEW v0.100.2 — heals existing broken "+ New Doc" blocks (backfill is create-if-absent)
  await applyProjectSectionsMigration(tp, mech, variables, history, git);   // NEW v0.102.0 S4 — Strategy A auto-migration (flat docs/*.md → docs/knowledge/ + sections[])
  await applyProjectSectionsHubMigration(tp, mech, variables, history, git);   // NEW v0.103.0 S4 — heals v0.102.0 vaults: Docs.md → ProjectDocsIndex + materialize Section Hubs + wikilink frontmatter + breadcrumb injection
  await applyDocNoteBreadcrumbMarkerCleanup(tp, mech, variables, history, git); // NEW v0.109.0 S8 — strips legacy <!-- breadcrumb-v1.17.0 --> markers from doc-notes (block preserved; new idempotency guard inside _migrateDocNote uses the class invocation substring)
  await applyProjectSectionsCloseRepair(tp, mech, variables, history, git);    // NEW v0.103.0.1 — fixes the regex-induced -"[[--]]" damage from v0.103.0 deploy
  await applyFinanceMigrations(tp, mech, variables, history, git);             // NEW v0.107.0 S2 — finance defaults scaffolding (create-if-absent) + categories group backfill (append-only + .sauce-backup snapshot)
  await applyToDoBlueprintMigration(tp, mech, variables, history, git);        // NEW v0.116.0 — reshapes v0.3.3 daily-note bodies to v0.4.0 5-block shape (.sauce-backup snapshot before write; absorbs ## Tasks heading; preserves ## Notes)
  await applyRecurringSentinelV070Migration(tp, mech, variables, history, git); // v0.119.0 — date-only sentinels → additive (empty-set) form. SUPERSEDED by stripPersistedRecurringSection (v0.120.0) but kept for files-in-flight; runs as a no-op once stripPersistedRecurringSection has run.
  await mergeDuplicateRecurringSections(tp, mech, variables, history, git); // v0.119.1 — merges duplicate "Recurring Today" blocks. SUPERSEDED by stripPersistedRecurringSection (v0.120.0) but kept for files-in-flight; runs as a no-op once stripPersistedRecurringSection has run.
  await stripPersistedRecurringSection(tp, mech, variables, history, git); // NEW v0.120.0 — retires materialized "Recurring Today" / "Recurring" SectionLabel blocks + recurring_from task lines + sentinels from dailies, since ToDoDailyRecurring.render() now live-queries the registry instead of writing to today's file. Idempotent. .sauce-backup snapshot before write.
  await applyProjectTodoBackfill(tp, mech, variables, history, git);           // NEW v0.116.0 — creates spice/projects/<slug>/<Name> To-Do.md for every project lacking one (skip-if-exists)
  await applyOrphanedHelperCleanup(tp, mech, variables, history, git);         // NEW v0.110.0 — deletes obsolete *.js and *.js.bak helper files left on disk after manifest removals
  await applyEntityCreateGuardMigration(tp, mech, variables, history, git);    // NEW v0.110.1 — rewrites direct customJS.EntityCreate.render(dv,...) calls in vault notes to the customjs-guard form (cold-load race fix)
  await applyCustomJsGuardMigration(tp, mech, variables, history, git);        // NEW v0.110.2 — generalized: rewrites ANY direct customJS.<Class>.render(dv[,opts]) call in vault notes to guard form (mobile cold-load race fix)
  await applyFinanceUnifiedNavMigration(tp, mech, variables, history, git);    // NEW v0.111.0 — collapses FinanceHubActions + FinanceNavRow invocations to single-line FinanceNav
  await applyExternalPluginInstall(tp, mech, adapter.basePath || (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null), workshopPath, history, git);  // NEW v0.94.0 — install missing
  await applyExternalPlugins(tp, mech, history, git);
  await scaffoldFoundationalPluginData(tp, mech, workshopPath, variables, history, git);  // NEW v0.26.0
  await applyTemplaterHotkeys(tp, mech, variables, history, git);          // NEW v0.1.3
  await applySlashCommanderBindings(tp, mech, variables, history, git);    // NEW v0.1.3
  await applyTemplaterFolderTemplateRemovals(tp, mech, variables, history, git); // NEW v0.88.2 — runs BEFORE applyTemplaterFolderTemplates so removals + re-adds compose correctly
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

// resetSourceContributions — FLN-v82-2 (v0.82.1). Called once per (source, target)
// pair at the start of the per-item rule_fragments loop in installItem. Reads
// <rules_path>/<target>.json (or initializes empty), sets contributions[sourceName]
// to [], writes back. Net effect: each install run rewrites this source's
// contributions from scratch in the per-fragment loop, so re-installs don't
// accumulate duplicates and the file always reflects the current manifest.
//
// Posture mirrors applyRuleFragment: malformed pre-existing JSON is preserved
// (C4 hardening); missing file is a no-op (no file created); failures record
// history but do not throw.
async function resetSourceContributions(tp, target, sourceName, variables, history, git) {
  const adapter = tp.app.vault.adapter;
  const rulesPath = variables.rules_path;
  if (!rulesPath) {
    new Notice(`resetSourceContributions: rules_path not configured; skipping reset for ${sourceName}`, 6000);
    if (history) {
      history.push({
        event: "error",
        step: "resetSourceContributions",
        name: sourceName,
        message: `rules_path not configured; skipped reset for target "${target}"`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }
  const rulePath = `${rulesPath}/${target}.json`;
  if (!(await adapter.exists(rulePath))) {
    // Missing file → nothing to reset; per-fragment loop will create it via applyRuleFragment.
    return;
  }
  let raw;
  try {
    raw = await adapter.read(rulePath);
  } catch (e) {
    new Notice(`resetSourceContributions: cannot read ${rulePath} (${e.message}). Skipping reset for ${sourceName}.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "resetSourceContributions",
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
  let existing;
  try {
    existing = JSON.parse(raw);
  } catch (e) {
    // C4: do NOT silently overwrite a malformed pre-existing rule file.
    new Notice(`resetSourceContributions: ${rulePath} is malformed JSON (${e.message}). Skipping reset for ${sourceName}.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "resetSourceContributions",
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
  existing.contributions = existing.contributions || {};
  existing.contributions[sourceName] = [];
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
  // v0.52.1 hybrid: adapter.rmdir exists on Obsidian's runtime adapter but
  // NOT on CLI-mode (sauce update). Fall back to Node fs against the
  // absolute vault path; last-resort leaves an empty dir (harmless except
  // co-existence guard would skip future migrations).
  if (typeof adapter.rmdir === "function") {
    await adapter.rmdir(dir);
    return;
  }
  const basePath = adapter.basePath
    || (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null);
  if (basePath) {
    const fs = require("fs");
    const path = require("path");
    const absDir = path.join(basePath, dir);
    if (fs.existsSync(absDir)) {
      fs.rmSync(absDir, { recursive: true, force: true });
    }
  }
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

// _repairDocsHubButtonBody — v0.100.2. Pure string transform: rewrites the
// broken `+ New Doc` dispatch (AccentButton via customjs-guard with id/label/
// icon args) into the canonical `customJS.EntityCreate.render(dv, {instance})`
// form. The broken form fed `dv` (not dv.container) to AccentButton.render, so
// `dv.createEl` threw and the button vanished; the guard form also never wired
// an onClick. Anchored on `class: "AccentButton"` + `id: "doc-note"` so it only
// touches the doc-note entity-create block and is a no-op on canonical bodies.
function _repairDocsHubButtonBody(body) {
  if (typeof body !== "string") return body;
  const brokenDispatch = /await dv\.view\("ranch\/views\/customjs-guard",\s*\{\s*class:\s*"AccentButton",\s*args:\s*\[\{\s*id:\s*"doc-note"[\s\S]*?\}\s*\]\s*\}\);/;
  if (!brokenDispatch.test(body)) return body;
  return body.replace(brokenDispatch, 'await customJS.EntityCreate.render(dv, { instance: "doc-note" });');
}

// applyDocsHubButtonRepair — v0.100.2. Walks spice/projects/*/docs/Docs.md and
// rewrites any whose doc-note entity-create block uses the broken AccentButton
// guard form (see _repairDocsHubButtonBody). applyDocsBackfill is
// create-if-absent, so it never heals an existing Docs.md — this step closes
// that gap for the projects materialized from the pre-v0.100.2 template.
// Project-gated, idempotent (no write when nothing changed), failure-loud
// per-project (catches + logs, never throws).
async function applyDocsHubButtonRepair(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "docs_hub_button_repair",
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

  const projectDirs = (projectsList.folders || []).filter((d) => d.split("/").pop() !== "All Projects");

  let repairedCount = 0;
  let warnCount = 0;

  for (const projectDir of projectDirs) {
    const docsPath = `${projectDir}/docs/Docs.md`;
    try {
      if (!(await adapter.exists(docsPath))) continue;
      const before = await adapter.read(docsPath);
      const after = _repairDocsHubButtonBody(before);
      if (after === before) continue;
      await adapter.write(docsPath, after);
      repairedCount += 1;
      if (history) {
        history.push({
          event: "info",
          step: "docs_hub_button_repair",
          name: "project",
          target: docsPath,
          action: "repaired_broken_button",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warnCount += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "docs_hub_button_repair",
          name: "project",
          reason: `repair failed for ${docsPath}: ${e && e.message ? e.message : String(e)}`,
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
      step: "docs_hub_button_repair",
      name: "project",
      reason: `repaired ${repairedCount} project(s); ${warnCount} warning(s)`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// applyProjectSectionsMigration — v0.102.0 S4 (Task 6). Strategy A auto-migration
// of existing flat docs/*.md files into docs/knowledge/ with section: "Knowledge"
// frontmatter, preserving any existing custom subfolders that contain doc-notes
// as additional sections[] entries on the parent project. Project-gated.
// Idempotent per-project: skips when docs/knowledge/ already exists (already
// migrated) OR docs/ doesn't exist (nothing to do). Failure-loud per-project:
// wraps each project body in try/catch, emits a warning event, continues to
// next project — NEVER throws.
//
// Steps per project (with docs/ present and docs/knowledge/ absent):
//   1. Create docs/knowledge/ and docs/notes/.
//   2. For each .md file directly under docs/ (excluding Docs.md):
//      - write to docs/knowledge/<basename> with section: "Knowledge" injected
//        into frontmatter (when absent).
//      - remove the original.
//   3. For each existing subfolder of docs/ (excluding knowledge, notes):
//      - if at least one .md inside has type: doc-note in frontmatter, treat
//        as a custom section. Titlecase the folder slug into the section label.
//      - inject section: "<label>" into each doc-note's frontmatter (when absent).
//   4. Update parent project note's frontmatter: when sections: is absent,
//      set sections: ["Knowledge", "Notes", ...customSections]. The project
//      note is identified as the .md file in the project dir with
//      type: project in frontmatter.
async function applyProjectSectionsMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_sections_migration",
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

  const projectDirs = (projectsList.folders || []).filter((d) => d.split("/").pop() !== "All Projects");

  let migratedCount = 0;
  let skippedCount = 0;
  let warnCount = 0;

  for (const projectDir of projectDirs) {
    const docsDir = `${projectDir}/docs`;
    const knowledgeDir = `${docsDir}/knowledge`;
    const notesDir = `${docsDir}/notes`;
    try {
      // Idempotency: skip when docs/ missing or knowledge/ already exists.
      if (!(await adapter.exists(docsDir))) {
        skippedCount += 1;
        continue;
      }
      if (await adapter.exists(knowledgeDir)) {
        skippedCount += 1;
        continue;
      }

      // 1. Create knowledge/ + notes/ subfolders.
      await adapter.mkdir(knowledgeDir);
      if (!(await adapter.exists(notesDir))) {
        await adapter.mkdir(notesDir);
      }

      // 2. Move flat docs/*.md → docs/knowledge/ (excluding Docs.md).
      const docsList = await adapter.list(docsDir);
      const movedFiles = [];
      for (const fp of (docsList.files || [])) {
        if (!fp.endsWith(".md")) continue;
        const base = fp.split("/").pop();
        if (base === "Docs.md") continue;
        const body = await adapter.read(fp);
        const newBody = _ensureSectionFrontmatter(body, "Knowledge");
        // Inline the docs/knowledge/<base> destination so static-source asserts
        // (HC-V01020-PSM-2) can see `adapter.write(...knowledge...)` in one span.
        await adapter.write(`${docsDir}/knowledge/${base}`, newBody);
        await adapter.remove(fp);
        movedFiles.push(base);
      }

      // 3. Detect custom subfolders that contain doc-notes.
      const customSections = [];
      for (const sub of (docsList.folders || [])) {
        const subBase = sub.split("/").pop();
        if (subBase === "knowledge" || subBase === "notes") continue;
        let hasDocNote = false;
        let subList;
        try {
          subList = await adapter.list(sub);
        } catch (_e) {
          subList = { files: [], folders: [] };
        }
        const docNotePaths = [];
        for (const fp of (subList.files || [])) {
          if (!fp.endsWith(".md")) continue;
          const fb = await adapter.read(fp);
          if (/^type:\s*["']?doc-note["']?\s*$/m.test(fb)) {
            hasDocNote = true;
            docNotePaths.push(fp);
          }
        }
        if (!hasDocNote) continue;
        const sectionLabel = _titlecaseFromSlug(subBase);
        customSections.push(sectionLabel);
        // Inject section: "<label>" into each doc-note's frontmatter (when absent).
        for (const fp of docNotePaths) {
          const fb = await adapter.read(fp);
          const newBody = _ensureSectionFrontmatter(fb, sectionLabel);
          if (newBody !== fb) {
            await adapter.write(fp, newBody);
          }
        }
      }

      // 4. Update parent project note's frontmatter with sections[].
      const dirList = await adapter.list(projectDir);
      let projectNotePath = null;
      for (const fp of (dirList.files || [])) {
        if (!fp.endsWith(".md")) continue;
        const fb = await adapter.read(fp);
        if (/^type:\s*["']?project["']?\s*$/m.test(fb)) {
          projectNotePath = fp;
          break;
        }
      }
      if (projectNotePath) {
        const pBody = await adapter.read(projectNotePath);
        if (!/^sections:/m.test(pBody)) {
          const sections = ["Knowledge", "Notes", ...customSections];
          const newPBody = _ensureSectionsFrontmatter(pBody, sections);
          if (newPBody !== pBody) {
            await adapter.write(projectNotePath, newPBody);
          }
        }
      }

      migratedCount += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_sections_migration",
          name: "project",
          target: docsDir,
          action: "migrated_to_sections",
          reason: `moved ${movedFiles.length} file(s) into knowledge/; ${customSections.length} custom section(s): ${customSections.join(", ") || "(none)"}`,
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warnCount += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_sections_migration",
          name: "project",
          target: docsDir,
          reason: `migration failed for ${docsDir}: ${e && e.message ? e.message : String(e)}`,
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
      step: "project_sections_migration",
      name: "project",
      reason: `migrated ${migratedCount} project(s); skipped ${skippedCount}; ${warnCount} warning(s)`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _ensureSectionFrontmatter — inject `section: "<label>"` into the leading
// YAML frontmatter block when absent. Returns body unchanged if no FM block
// is present or `section:` already exists. Pure string transform.
function _ensureSectionFrontmatter(body, sectionLabel) {
  if (/^section:/m.test(body)) return body;
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return body;
  const fm = fmMatch[1];
  const newFm = `${fm}\nsection: "${sectionLabel}"`;
  return body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
}

// _ensureSectionsFrontmatter — inject `sections:` YAML list into the leading
// frontmatter block when absent. Returns body unchanged if no FM block is
// present or `sections:` already exists. Always emits an explicit list (even
// when callers pass just ["Knowledge", "Notes"]).
function _ensureSectionsFrontmatter(body, sections) {
  if (/^sections:/m.test(body)) return body;
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return body;
  const fm = fmMatch[1];
  const yamlList = sections.map((s) => `  - ${s}`).join("\n");
  const newFm = `${fm}\nsections:\n${yamlList}`;
  return body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
}

// _titlecaseFromSlug — convert a kebab-case folder slug into a Title Case
// section label. e.g. "release-notes" → "Release Notes".
function _titlecaseFromSlug(slug) {
  return String(slug)
    .split("-")
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// applyProjectSectionsHubMigration — v0.103.0 S4 (Task 6). Heals existing
// v0.102.0 vaults by upgrading them to the section-hubs layout. For each
// project under spice/projects/:
//   1. Rewrites docs/Docs.md body to invoke ProjectDocsIndex (instead of
//      ProjectDocsCards|ProjectDocsSections) and strips the standalone
//      entity-create:doc-note block (now offered by the index helper).
//   2. Materializes Section Hub notes (Knowledge.md, Notes.md, etc.) in each
//      existing docs/<slug>/ subfolder. Recurses ONE level deep — any sub-folder
//      containing ≥1 doc-note gets a sub-section hub (depth: 2).
//   3. Migrates doc-note frontmatter: section: "Knowledge" (string) →
//      section: "[[Knowledge]]" (wikilink). Adds sub_section: "[[X]]" when the
//      doc-note lives in a sub-folder.
//   4. Injects a breadcrumb dataviewjs block at the top of every doc-note body
//      (with <!-- breadcrumb-v1.17.0 --> marker for idempotency).
//   5. Migrates the project's sections[] frontmatter from strings to wikilink form
//      (or inserts sections[] with the full discovered labels when absent).
//   6. Default-section guarantee: every project gets Knowledge + Notes hubs even
//      when currently empty (create folder + materialize hub).
//
// Project-gated (manifest.name === "project"). Idempotent per-project: skips
// any project whose Docs.md body already invokes ProjectDocsIndex. Failure-loud
// per-project: wraps each project body in try/catch, emits a warning event,
// continues to the next project — NEVER throws.
async function applyProjectSectionsHubMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_sections_hub_migration",
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

  const projectDirs = (projectsList.folders || []).filter((d) => d.split("/").pop() !== "All Projects");

  let migrated = 0;
  let skipped = 0;
  let warned = 0;

  for (const projectDir of projectDirs) {
    const docsDir = `${projectDir}/docs`;
    const docsHubPath = `${docsDir}/Docs.md`;
    try {
      if (!(await adapter.exists(docsHubPath))) {
        skipped += 1;
        continue;
      }

      // Idempotency guard: skip if Docs.md already invokes ProjectDocsIndex.
      const docsHubBody = await adapter.read(docsHubPath);
      const alreadyMigrated = /customJS\.ProjectDocsIndex\.render/.test(docsHubBody) ||
                              /class:\s*["']ProjectDocsIndex["']/.test(docsHubBody);
      if (alreadyMigrated) {
        skipped += 1;
        continue;
      }

      // 1. Heal Docs.md body.
      const healed = _healDocsHubBody(docsHubBody);
      if (healed !== docsHubBody) await adapter.write(docsHubPath, healed);

      // 2. Discover sections (existing subfolders of docs/).
      const docsList = await adapter.list(docsDir);
      const sectionFolders = (docsList.folders || []).filter((d) => {
        const slug = d.split("/").pop();
        return slug !== "All Projects";
      });

      // Identify the project note (for sections[] migration + display name).
      const projectSlug = projectDir.split("/").pop();
      const dirList = await adapter.list(projectDir);
      let projectNotePath = null;
      for (const fp of (dirList.files || [])) {
        if (!fp.endsWith(".md")) continue;
        const fb = await adapter.read(fp);
        if (/^type:\s*["']?project["']?\s*$/m.test(fb)) {
          projectNotePath = fp;
          break;
        }
      }
      const projectDisplayName = projectNotePath
        ? projectNotePath.split("/").pop().replace(/\.md$/, "")
        : _titlecaseFromSlug(projectSlug);

      // 3. Default-section guarantee: ensure Knowledge + Notes folders exist.
      const haveSlugs = new Set(sectionFolders.map((d) => d.split("/").pop()));
      const defaultSections = [];
      if (!haveSlugs.has("knowledge")) defaultSections.push({ slug: "knowledge", label: "Knowledge" });
      if (!haveSlugs.has("notes")) defaultSections.push({ slug: "notes", label: "Notes" });
      for (const def of defaultSections) {
        const folder = `${docsDir}/${def.slug}`;
        if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        sectionFolders.push(folder);
      }

      // 4. Materialize Section Hubs (depth 1) + recurse one level (depth 2).
      const customSectionLabels = [];
      for (const folder of sectionFolders) {
        const slug = folder.split("/").pop();
        const label = _titlecaseFromSlug(slug);
        customSectionLabels.push(label);
        const hubPath = `${folder}/${label}.md`;
        if (!(await adapter.exists(hubPath))) {
          const hubBody = _sectionHubBody({
            projectName: projectDisplayName,
            projectSlug: projectSlug,
            section: label,
            sectionSlug: slug,
            parentSection: "",
            depth: 1,
          });
          await adapter.write(hubPath, hubBody);
        }

        // 5. Recurse one level for sub-sections — only when the sub-folder
        //    contains ≥1 doc-note. Each such sub-folder gets a depth-2 hub.
        let subList;
        try {
          subList = await adapter.list(folder);
        } catch (_e) {
          subList = { folders: [], files: [] };
        }
        for (const subFolder of (subList.folders || [])) {
          const subSlug = subFolder.split("/").pop();
          let subItems;
          try {
            subItems = await adapter.list(subFolder);
          } catch (_e) {
            subItems = { folders: [], files: [] };
          }
          let hasDocNote = false;
          for (const fp of (subItems.files || [])) {
            if (!fp.endsWith(".md")) continue;
            const fb = await adapter.read(fp);
            if (/^type:\s*["']?doc-note["']?\s*$/m.test(fb)) {
              hasDocNote = true;
              break;
            }
          }
          if (!hasDocNote) continue;
          const subLabel = _titlecaseFromSlug(subSlug);
          const subHubPath = `${subFolder}/${subLabel}.md`;
          if (!(await adapter.exists(subHubPath))) {
            const subHubBody = _sectionHubBody({
              projectName: projectDisplayName,
              projectSlug: projectSlug,
              section: subLabel,
              sectionSlug: subSlug,
              parentSection: `[[${label}]]`,
              depth: 2,
            });
            await adapter.write(subHubPath, subHubBody);
          }

          // 6a. Migrate doc-notes in sub-folder: add sub_section frontmatter.
          //     Skip the sub-section hub itself (its filename matches subLabel.md).
          for (const fp of (subItems.files || [])) {
            if (!fp.endsWith(".md")) continue;
            const baseName = fp.split("/").pop();
            if (baseName === `${subLabel}.md`) continue;
            await _migrateDocNote(adapter, fp, label, subLabel);
          }
        }

        // 6b. Migrate doc-notes in the section folder (not in sub-folders).
        //     Skip the section hub itself (its filename matches label.md).
        for (const fp of (subList.files || [])) {
          if (!fp.endsWith(".md")) continue;
          const baseName = fp.split("/").pop();
          if (baseName === `${label}.md`) continue;
          await _migrateDocNote(adapter, fp, label, "");
        }
      }

      // 7. Migrate project's sections[] frontmatter to wikilink form.
      if (projectNotePath) {
        const pBody = await adapter.read(projectNotePath);
        const newPBody = _migrateProjectSectionsToWikilinks(pBody, customSectionLabels);
        if (newPBody !== pBody) await adapter.write(projectNotePath, newPBody);
      }

      migrated += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_sections_hub_migration",
          name: "project",
          target: projectDir,
          action: "migrated",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_sections_hub_migration",
          name: "project",
          target: projectDir,
          reason: `migration failed for ${projectDir}: ${e && e.message ? e.message : String(e)}`,
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
      step: "project_sections_hub_migration",
      name: "project",
      reason: `migrated ${migrated} project(s); skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _healDocsHubBody — pure string transform. Removes the standalone
// entity-create:doc-note dataviewjs block + the horizontal rule that follows
// it (the doc-note shortcut now lives inside ProjectDocsIndex), and rewrites
// the ProjectDocsCards|ProjectDocsSections invocation to ProjectDocsIndex.
// Returns body unchanged when neither pattern matches.
function _healDocsHubBody(body) {
  let out = body;
  // Remove standalone entity-create:doc-note 3-line dataviewjs block + optional --- separator.
  out = out.replace(
    /```dataviewjs\n\s*\/\/\s*entity-create:doc-note[^\n]*\n\s*await\s+customJS\.EntityCreate\.render\(dv,\s*\{\s*instance:\s*["']doc-note["']\s*\}\);\n```\n?(?:---\n\n?)?/g,
    ""
  );
  // Replace ProjectDocsCards|ProjectDocsSections invocation with ProjectDocsIndex.
  out = out.replace(
    /await\s+dv\.view\("ranch\/views\/customjs-guard",\s*\{\s*class:\s*["'](?:ProjectDocsCards|ProjectDocsSections)["']\s*\}\);/g,
    'await customJS.ProjectDocsIndex.render(dv);'
  );
  return out;
}

// _sectionHubBody — canonical Section Hub note body. Frontmatter declares
// type: section-hub + project + section + depth + parent_section (depth 2);
// body invokes Breadcrumb, SpaceNavButtons, ProjectNavButtons, then SectionHub.
function _sectionHubBody({ projectName, projectSlug, section, sectionSlug, parentSection, depth }) {
  return `---
type: section-hub
project: "[[${projectName}]]"
project_slug: ${projectSlug}
section: ${section}
section_slug: ${sectionSlug}
parent_section: "${parentSection}"
depth: ${depth}
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
tags:
  - section-hub
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
\`\`\`

---

\`\`\`dataviewjs
await customJS.SectionHub.render(dv);
\`\`\`
`;
}

// _migrateDocNote — three sub-operations on each doc-note file:
//   1. Wrap section: "<label>" string to section: "[[<label>]]" wikilink form
//      (skip if already a wikilink).
//   2. Add sub_section: "[[<label>]]" frontmatter field when subSectionLabel is
//      provided AND sub_section: is absent.
//   3. Inject a breadcrumb dataviewjs block at the top of the body (immediately
//      after the frontmatter close ---). v0.109.0 S8: idempotency guard is the
//      class-invocation substring `class: "Breadcrumb"` itself — the visible
//      marker comment is gone. Skip if the block invocation is already present.
// Writes only when the body changed.
async function _migrateDocNote(adapter, fp, sectionLabel, subSectionLabel) {
  const body = await adapter.read(fp);
  let out = body;

  // 1. section: "Knowledge" -> section: "[[Knowledge]]"
  out = out.replace(/^section:\s*["']?([^"'\n[\]]+)["']?$/m, (full, val) => {
    const stripped = val.trim();
    if (stripped.startsWith("[[")) return full; // already wikilink
    return `section: "[[${stripped}]]"`;
  });

  // 2. Add sub_section: "[[<label>]]" if applicable and absent.
  if (subSectionLabel && !/^sub_section:/m.test(out)) {
    const fmMatch = out.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      const newFm = `${fm}\nsub_section: "[[${subSectionLabel}]]"`;
      out = out.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
    }
  }

  // 3. Inject breadcrumb block at top of body (after frontmatter close) if the
  // block isn't already present.
  // v0.109.0 S8 — idempotency proxy is the class invocation substring, not the
  // legacy <!-- breadcrumb-v1.17.0 --> marker. The marker is stripped post-pass
  // by applyDocNoteBreadcrumbMarkerCleanup; pre-v0.103 vaults still need the
  // block injection. The injected block no longer carries the marker line.
  if (!out.includes('class: "Breadcrumb"')) {
    // Find the closing --- of the leading frontmatter block.
    const fmEnd = out.indexOf("---\n", 4);
    if (fmEnd !== -1) {
      const fmCloseIdx = fmEnd + 4;
      const before = out.slice(0, fmCloseIdx);
      const after = out.slice(fmCloseIdx);
      const breadcrumbBlock = `\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n\`\`\`\n\n---\n`;
      out = before + breadcrumbBlock + after;
    }
  }

  if (out !== body) await adapter.write(fp, out);
}

// applyDocNoteBreadcrumbMarkerCleanup — v0.109.0 S8. Walks every project's
// docs/ tree recursively and strips the legacy v0.103.0 marker comment line
// (<!-- breadcrumb-v1.17.0 -->) from doc-note bodies. Idempotent: when the
// marker is absent the file is untouched. The Breadcrumb dataviewjs block
// itself is preserved; only the visible marker comment is removed. After this
// step runs, _migrateDocNote's new idempotency guard (the class-invocation
// substring `class: "Breadcrumb"`) ensures the block isn't re-injected.
//
// Project-gated (manifest.name === "project"). Failure-loud per-file: wraps
// each read/write in try/catch and emits warning history events, NEVER throws.
async function applyDocNoteBreadcrumbMarkerCleanup(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "doc_note_breadcrumb_marker_cleanup",
        name: "project",
        reason: `list failed for ${projectsRoot}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const projectDirs = (projectsList.folders || []).filter((d) => d.split("/").pop() !== "All Projects");

  let cleanedCount = 0;
  let untouchedCount = 0;

  for (const projectDir of projectDirs) {
    const docsRoot = `${projectDir}/docs`;
    try {
      if (!(await adapter.exists(docsRoot))) continue;
    } catch (_e) { continue; }
    let docFiles = [];
    try {
      docFiles = await _listAllMarkdownRecursive(adapter, docsRoot);
    } catch (e) {
      if (history) {
        history.push({
          event: "warning",
          step: "doc_note_breadcrumb_marker_cleanup",
          name: "project",
          reason: `recursive list failed for ${docsRoot}: ${e.message}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    for (const fp of docFiles) {
      try {
        const before = await adapter.read(fp);
        if (!before.includes("<!-- breadcrumb-v1.17.0 -->")) {
          untouchedCount += 1;
          continue;
        }
        // Strip the marker line + its trailing newline.
        // Embedded form (most common — \n<!-- ... -->\n collapses to \n).
        let after = before.replace(/\n<!-- breadcrumb-v1\.17\.0 -->\n/g, "\n");
        // Edge case: marker at very start of body (no leading \n).
        after = after.replace(/^<!-- breadcrumb-v1\.17\.0 -->\n/g, "");
        if (after !== before) {
          await adapter.write(fp, after);
          cleanedCount += 1;
          if (history) {
            history.push({
              event: "info",
              step: "doc_note_breadcrumb_marker_cleanup",
              name: "project",
              target: fp,
              action: "marker_stripped",
              git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
        } else {
          untouchedCount += 1;
        }
      } catch (e) {
        if (history) {
          history.push({
            event: "warning",
            step: "doc_note_breadcrumb_marker_cleanup",
            name: "project",
            target: fp,
            reason: e.message,
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "doc_note_breadcrumb_marker_cleanup",
      name: "project",
      action: "summary",
      cleaned_count: cleanedCount,
      untouched_count: untouchedCount,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// Recursive markdown listing under a folder. Uses adapter.list, which returns
// { files, folders } per directory.
async function _listAllMarkdownRecursive(adapter, root) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift();
    let listing;
    try {
      listing = await adapter.list(cur);
    } catch (_e) { continue; }
    for (const f of (listing.files || [])) {
      if (f.endsWith(".md")) out.push(f);
    }
    for (const sub of (listing.folders || [])) {
      queue.push(sub);
    }
  }
  return out;
}

// _migrateProjectSectionsToWikilinks — pure string transform on project body.
// When sections: YAML block exists with string entries, rewrites each to
// wikilink form. When sections: is absent, INSERTS it with the full discovered
// labels (each as "[[Label]]"). Returns body unchanged when no FM block or
// nothing to migrate.
function _migrateProjectSectionsToWikilinks(body, fullLabels) {
  // v0.103.0.1 PATCH: regex now requires a SPACE after the `-` (YAML list
  // spec: `- value`), so the frontmatter closing `---` (no space) is no
  // longer captured as a list item. Pre-patch, `---` was rewritten to
  // `-"[[--]]"` and damaged 19 project notes in accuris during the
  // v0.103.0 migration.
  const m = body.match(/^sections:\s*\n((?:\s*-\s+\S.*\n)+)/m);
  if (!m) {
    // No sections: yet; insert.
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return body;
    const fm = fmMatch[1];
    if (/^sections:/m.test(fm)) return body;
    if (!fullLabels || fullLabels.length === 0) return body;
    const yamlList = fullLabels.map((s) => `  - "[[${s}]]"`).join("\n");
    const newFm = `${fm}\nsections:\n${yamlList}`;
    return body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  }
  const listText = m[1];
  // For each list line, wrap to wikilink form when not already wikilink.
  const newLines = listText.split("\n").map((line) => {
    const t = line.match(/^(\s*-\s+)["']?([^"'\n[\]]+?)["']?\s*$/);
    if (!t) return line;
    const prefix = t[1];
    const val = t[2].trim();
    if (val.startsWith("[[")) return line;
    return `${prefix}"[[${val}]]"`;
  });
  return body.replace(m[0], `sections:\n${newLines.join("\n")}\n`);
}

// _repairBrokenSectionsClose — v0.103.0.1 PATCH heal step. The v0.103.0
// _migrateProjectSectionsToWikilinks regex captured the frontmatter closing
// `---` and rewrote it to `-"[[--]]"`. Damaged 19 project notes in accuris
// during deploy. This walks every project note and converts the stray
// `-"[[--]]"` line back to `---`. Idempotent (no-op if not present).
async function applyProjectSectionsCloseRepair(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try { projectsList = await adapter.list(projectsRoot); }
  catch (e) {
    history?.push({ event: "warning", step: "project_sections_close_repair", name: "project", reason: e.message,
                    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  const projectDirs = (projectsList.folders || []).filter(d => d.split("/").pop() !== "All Projects");
  let repaired = 0;

  for (const projectDir of projectDirs) {
    try {
      const dirList = await adapter.list(projectDir).catch(() => ({ files: [], folders: [] }));
      for (const fp of (dirList.files || [])) {
        if (!fp.endsWith(".md")) continue;
        const body = await adapter.read(fp);
        if (!body.includes('-"[[--]]"')) continue;
        const fixed = body.replace(/^\s*-"\[\[--\]\]"\s*$/gm, "---");
        if (fixed !== body) {
          await adapter.write(fp, fixed);
          repaired++;
          history?.push({ event: "info", step: "project_sections_close_repair", name: "project", target: fp, action: "repaired_broken_frontmatter_close",
                          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        }
      }
    } catch (e) {
      history?.push({ event: "warning", step: "project_sections_close_repair", name: "project", target: projectDir, reason: e?.message || String(e),
                      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "project_sections_close_repair", name: "project",
                  reason: `repaired ${repaired} project note(s)`,
                  git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
}

// applyEmptyProjectWikilinkRepair — v0.105.0.1 PATCH; v0.105.0.2 promotes
// to per-vault scope (was per-mechanism-dispatch in v0.105.0.1 — never
// fired because install posture skips the project blueprint manifest
// dispatch when nothing structural changed). Heals doc-note AND section-hub
// notes whose `project:` frontmatter is `"[[]]"` (empty wikilink).
//
// Root cause: v0.105.0 manifest substituted
// `{{current_file.frontmatter.project_name}}` into the wikilink wrap, but
// section-hub notes don't carry a `project_name` field (only `project` as
// an already-wrapped wikilink). Substitution resolved to empty, producing
// `project: "[[]]"`. v0.105.0.2 manifest fix uses the parent's `project`
// value directly across doc-note + section-hub + sub-section-hub entries.
//
// Per-vault scope: signature is (tp, history, git) like applyVaultDefaultPaths.
// Walks every section-hub + doc-note under spice/projects/*/docs/**/, derives
// the project's canonical wikilink from the project note's filename, rewrites
// the broken field. Idempotent.
async function applyEmptyProjectWikilinkRepair(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try { projectsList = await adapter.list(projectsRoot); }
  catch (e) {
    history?.push({ event: "warning", step: "empty_project_wikilink_repair", name: "project", reason: e.message,
                    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  const projectDirs = (projectsList.folders || []).filter(d => d.split("/").pop() !== "All Projects");
  let repaired = 0;

  for (const projectDir of projectDirs) {
    try {
      const dirList = await adapter.list(projectDir).catch(() => ({ files: [], folders: [] }));
      let projectNoteName = null;
      for (const fp of (dirList.files || [])) {
        if (!fp.endsWith(".md")) continue;
        const fb = await adapter.read(fp);
        if (/^type:\s*["']?project["']?\s*$/m.test(fb)) {
          projectNoteName = fp.split("/").pop().replace(/\.md$/, "");
          break;
        }
      }
      if (!projectNoteName) continue;
      const projectWikilink = `[[${projectNoteName}]]`;

      // Walk docs/ recursively for section-hub + doc-note notes with broken project field
      async function walkAndRepair(folder) {
        const items = await adapter.list(folder).catch(() => ({ files: [], folders: [] }));
        for (const fp of (items.files || [])) {
          if (!fp.endsWith(".md")) continue;
          const body = await adapter.read(fp);
          if (!/^type:\s*["']?(?:section-hub|doc-note)["']?\s*$/m.test(body)) continue;
          if (!/^project:\s*["']?\[\[\]\]["']?\s*$/m.test(body)) continue;
          const fixed = body.replace(/^project:\s*["']?\[\[\]\]["']?\s*$/m, `project: "${projectWikilink}"`);
          if (fixed !== body) {
            await adapter.write(fp, fixed);
            repaired++;
            history?.push({ event: "info", step: "empty_project_wikilink_repair", name: "project", target: fp,
                            action: "repaired_empty_project_wikilink",
                            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
          }
        }
        for (const sub of (items.folders || [])) await walkAndRepair(sub);
      }

      const docsDir = `${projectDir}/docs`;
      if (await adapter.exists(docsDir)) await walkAndRepair(docsDir);
    } catch (e) {
      history?.push({ event: "warning", step: "empty_project_wikilink_repair", name: "project", target: projectDir, reason: e?.message || String(e),
                      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "empty_project_wikilink_repair", name: "vault",
                  reason: `repaired ${repaired} note(s)`,
                  git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
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
// v0.53.0 (FA-1) Layer 2 canonical-vocab opt-in/out gate.
// Every blueprint manifest is expected to either:
//   (a) opt into the canonical vocab by declaring at least one rule_fragment
//       with `extends: "_canonical-vocab"` on its inner fragment shape; OR
//   (b) explicitly declare why it doesn't via a top-level
//       `canonical_vocab_opt_out: { reason: "<one-line explanation>" }`.
//
// At v0.53.0 no blueprint opts in (FA-2..FA-7 do that per-blueprint). The
// function emits a warning row into install history but does NOT fail the
// install. A post-FA-7 cycle promotes the warning to a hard fail once all
// consumer vaults are confirmed migrated.
//
// Always returns true — caller must NOT gate install on this value. The
// return is kept for symmetry with _validateTypeFieldConvention's signature.
function _validateCanonicalVocab(manifest, history, git) {
  if (!manifest || typeof manifest !== "object") return true;
  const fragments = Array.isArray(manifest.rule_fragments) ? manifest.rule_fragments : [];
  const optIn = fragments.some(fr => {
    const frag = fr && (fr.fragment || fr);
    return frag && typeof frag.extends === "string" && frag.extends === "_canonical-vocab";
  });
  const optOut = manifest.canonical_vocab_opt_out
    && typeof manifest.canonical_vocab_opt_out === "object"
    && typeof manifest.canonical_vocab_opt_out.reason === "string"
    && manifest.canonical_vocab_opt_out.reason.length > 0;
  if (optIn || optOut) return true;
  if (history) {
    history.push({
      event: "warning",
      step: "canonical_vocab",
      rule: "canonical_vocab_opt_in_required",
      name: manifest.name,
      message: `blueprint ${manifest.name} neither opts into _canonical-vocab via rule_fragments[*].fragment.extends="_canonical-vocab" nor declares canonical_vocab_opt_out:{reason:"..."}; expected before FA-2..FA-7 deployment.`,
      git_commit: git && git.commit,
      git_tag: git && git.tag,
      git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
  return true;
}

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
  // v0.4.0 (entity-create MINOR): render_in is optional. Entries with no render_in
  // are registry-only — EntityCreate.create() dispatch works because the spec is
  // still materialized into ranch/entity-create-registry.json; the materializer
  // loop above simply skips the injection call when render_in is absent. Useful
  // when a blueprint renders the button itself (e.g., scratch's ScratchDayActions
  // hosts the button inside a custom flex row).
  if (entry.render_in !== undefined && entry.render_in !== null) {
    if (typeof entry.render_in !== "object") return fail("render_in must be an object when present");
    if (entry.render_in.kind !== "hub" && entry.render_in.kind !== "nav_buttons") {
      return fail(`render_in.kind must be "hub" or "nav_buttons"`);
    }
    if (entry.render_in.kind === "hub" && (typeof entry.render_in.target_path !== "string" || entry.render_in.target_path.length === 0)) {
      return fail(`render_in.kind="hub" requires target_path`);
    }
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
  if (entry.render_in && entry.render_in.kind === "hub") {
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

// ============================================================================
// applyFinanceMigrations — v0.107.0 S2 (extended v0.108.0 S2, v0.112.0 S2).
//
// Orchestrator wrapping finance-blueprint install-time steps. Gated on
// manifest.name === "finance"; failure-loud per file; never throws; idempotent.
//
//   1. applyFinanceDefaultsScaffolding — create-if-absent for the two per-vault
//      defaults notes (`spice/finance/Budget Defaults.md` and
//      `spice/finance/Paycheck Defaults.md`). NEVER overwrites. User-filled
//      defaults survive every future install.
//
//   2. applyFinanceDebtScaffolding (NEW v0.108.0) — create-if-absent for
//      `spice/finance/debts/` folder + `Debts.md` hub + `Debt Defaults.md`.
//
//   3. applyFinanceMonthsScaffolding (NEW v0.112.0) — create-if-absent for
//      `spice/finance/months/` folder + `Months.md` hub.
//
//   4. applyFinanceCategoriesGroupBackfill — append-only group field on every
//      existing `Budget-*.md`. Adds `groups: []` to top-level frontmatter if
//      missing; adds `group: "Unassigned"` to every category that lacks one.
//      Pre-write `.sauce-backup` snapshot mirrors v0.101.0 Safeguard-1 pattern.
//      Names, planned amounts, and actuals NEVER altered. Per-file failure-loud
//      via history warning events. Idempotent — re-runs detect no-op.
//
//   5. applyFinanceBudgetGroupSeed (NEW v0.108.0) — CF-3 polish #6+#7.
//      Seeds groups[] on existing Budget-*.md from Budget Defaults; name-matches
//      Unassigned categories to their defaults-declared group.
//
//   6. applyFinanceBudgetBodyMigration — v0.107.0 CF-2 body-text heal.
//
//   7. applyFinanceBudgetMonthlyBandInjection (NEW v0.110.3) — injects
//      MonthlyOverview block above BudgetSummary on every Budget-YYYY-MM.md.
//
//   8. applyFinancePaycheckBodyMigration — v0.107.0 CF-3 body-text heal.
//
//   9. applyFinancePaycheckDebtBandInjection (NEW v0.112.0) — injects
//      PaycheckDebtBand block between PaycheckSummary and PaycheckExpensesEditor
//      on every Paycheck-*.md.
//
//  10. applyFinancePaycheckDefaultsDebtLinking (NEW v0.108.0) — walks Paycheck
//      Defaults CC rows, name-matches debt entities, sets debt:[[Debt-X]],
//      strips inline url:.
//
//  11. applyFinanceNavRowMigration (NEW v0.108.0) — vault-wide regex sweep
//      rewriting customJS.{Budget,Paycheck,Invoice}NavButtons.render() to
//      customJS.FinanceNavRow.render(dv). Runs LAST (touches all entity bodies).
//
// Mirrors applyProjectSectionsHubMigration posture from v0.103.0.

const FINANCE_BUDGET_DEFAULTS_CONTENT = `---
type: budget-defaults
groups: []
categories: []
cssclasses: [wide]
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetDefaultsEditor" });
\`\`\`
`;

const FINANCE_PAYCHECK_DEFAULTS_CONTENT = `---
type: paycheck-defaults
expenses: []
cssclasses: [wide]
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "PaycheckDefaultsEditor" });
\`\`\`
`;

// v0.108.0 S2 — debt scaffolding templates. created_at is stamped at install time
// (runtime value); templates match design §2.1 + §2.3.
// NOTE: DebtDefaultsEditor, DebtsHubSummary, DebtsCards, FinanceNavRow classes
// ship in S3. The dataviewjs blocks will fail silently until those helpers land.
const FINANCE_DEBTS_HUB_TEMPLATE = `---
type: debts-hub
created_at: "${new Date().toISOString()}"
tags:
  - finance-hub
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
// entity-create:debt — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtsHubSummary" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtsCards" });
\`\`\`
`;

const FINANCE_DEBT_DEFAULTS_TEMPLATE = `---
type: debt-defaults
debts: []
created_at: "${new Date().toISOString()}"
tags:
  - finance-defaults
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtDefaultsEditor" });
\`\`\`
`;

// v0.112.0 S2a — months hub body (byte-identical to content/Months.md body and
// FINANCE_HUB_BODY_TEMPLATES entry — all three must stay in sync).
const FINANCE_MONTHS_HUB_BODY = `\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "MonthsCards" });
\`\`\`
`;

// applyFinanceMonthsScaffolding — v0.112.0 S2a. Create-if-absent for the
// months sub-area:
//   • spice/finance/months/        (folder)
//   • spice/finance/months/Months.md  (hub note)
//
// Never overwrites existing files — idempotent on re-runs. Mirrors
// applyFinanceDebtScaffolding posture from v0.108.0.

async function applyFinanceMonthsScaffolding(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const monthsRoot = "spice/finance/months";
  const monthsHubPath = `${monthsRoot}/Months.md`;

  let created = 0;
  let preserved = 0;

  // 1. Ensure months folder exists.
  if (!(await adapter.exists(monthsRoot))) {
    try {
      await adapter.mkdir(monthsRoot);
    } catch (e) {
      history?.push({ event: "warning", step: "months_scaffolding", name: "finance",
        reason: `mkdir failed for ${monthsRoot}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
  }

  // 2. Months.md hub — create-if-absent only; never overwrite.
  if (await adapter.exists(monthsHubPath)) {
    preserved++;
  } else {
    try {
      await adapter.write(monthsHubPath, FINANCE_MONTHS_HUB_BODY);
      created++;
      history?.push({ event: "info", step: "months_scaffolding", name: "finance",
        action: "created", path: monthsHubPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "months_scaffolding", name: "finance",
        reason: `write failed for ${monthsHubPath}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "months_scaffolding", name: "finance",
    summary: { created, preserved },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// applyFinancePaycheckDebtBandInjection — v0.112.0 S2b (finance 0.8.0). Injects
// the PaycheckDebtBand dataviewjs block (marker-guarded by
// `<!-- paycheck-debt-band-v0.8.0 -->`) between PaycheckSummary and
// PaycheckExpensesEditor on every Paycheck-*.md. Body-text mutation only.
// Idempotent — marker presence short-circuits. Per-file failure-loud via
// history warning events. Mirrors applyFinanceBudgetMonthlyBandInjection posture.
// ============================================================================
async function applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const paychecksRoot = "spice/finance/paychecks";
  if (!(await adapter.exists(paychecksRoot))) return;

  const paycheckFiles = [];
  try {
    const top = await adapter.list(paychecksRoot);
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Paycheck-\d{4}-\d{2}-\d{2}\.md$/.test(fp)) paycheckFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_debt_band_injection", name: "finance",
      reason: `list failed for ${paychecksRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (paycheckFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touched = 0;
  for (const fp of paycheckFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _injectPaycheckDebtBand(body);
      if (result.touched) {
        // Snapshot before write
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_paycheck_debt_band_injection", name: "finance",
        reason: `body injection failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_paycheck_debt_band_injection", name: "finance",
    reason: `${paycheckFiles.length} paychecks scanned, ${touched} bodies injected (PaycheckDebtBand block between PaycheckSummary and PaycheckExpensesEditor)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _injectPaycheckDebtBand — pure body transform. Idempotent. Marker-guarded.
//   Anchor priority (lands between PaycheckSummary and PaycheckExpensesEditor):
//     1. marker present → no-op.
//     2. PaycheckExpensesEditor dataviewjs block exists → inject immediately BEFORE it.
//     3. PaycheckSummary dataviewjs block exists → inject immediately AFTER it.
//     4. Frontmatter close (second `---\n`) → inject AFTER it.
function _injectPaycheckDebtBand(body) {
  let out = body;

  const MARKER = "<!-- paycheck-debt-band-v0.8.0 -->";
  if (out.includes(MARKER)) return { body: out, touched: false };

  const debtBandBlock = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "PaycheckDebtBand" });\n\`\`\`\n\n`;

  // Priority 2: inject immediately before the PaycheckExpensesEditor block.
  const editorBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']PaycheckExpensesEditor["'][^`]*```\s*\n)/;
  const eb = out.match(editorBlockRe);
  if (eb) {
    out = out.replace(editorBlockRe, `${debtBandBlock}$1`);
    return { body: out, touched: true };
  }

  // Priority 3: inject immediately after the PaycheckSummary block.
  const summaryBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']PaycheckSummary["'][^`]*```\s*\n)/;
  const sb = out.match(summaryBlockRe);
  if (sb) {
    out = out.replace(summaryBlockRe, `$1\n${debtBandBlock}`);
    return { body: out, touched: true };
  }

  // Priority 4: inject after the frontmatter close (second `---\n`).
  const fmEnd = out.indexOf("---\n", 4);
  if (fmEnd !== -1) {
    const cutIdx = fmEnd + 4;
    out = out.slice(0, cutIdx) + `\n${debtBandBlock}` + out.slice(cutIdx);
    return { body: out, touched: true };
  }

  return { body: out, touched: false };
}

async function applyFinanceMigrations(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  await applyFinanceDefaultsScaffolding(tp, manifest, variables, history, git);
  await applyFinanceDebtScaffolding(tp, manifest, variables, history, git);              // NEW v0.108.0
  await applyFinanceMonthsScaffolding(tp, manifest, variables, history, git);            // NEW v0.112.0 — create-if-absent months/ + Months.md
  await applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history, git);
  await applyFinanceBudgetGroupSeed(tp, manifest, variables, history, git);              // NEW v0.108.0
  await applyFinanceBudgetBodyMigration(tp, manifest, variables, history, git);
  await applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history, git);   // NEW v0.110.3 — MonthlyOverview band above BudgetSummary
  await applyFinancePaycheckBodyMigration(tp, manifest, variables, history, git);        // CF-3 v0.107.0
  await applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history, git);    // NEW v0.112.0 — PaycheckDebtBand between PaycheckSummary and PaycheckExpensesEditor
  await applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history, git);  // NEW v0.108.0
  await applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history, git); // NEW v0.114.0 — word-overlap matcher + auto-injection of orphan debts (supersedes the v0.108.0 CC_NAME_RE; complementary not redundant — v0.108.0 still runs for the CC pattern)
  await applyFinanceNavRowMigration(tp, manifest, variables, history, git);              // NEW v0.108.0
  await applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history, git);     // NEW v0.110.3 — guard-form regression: rewrites class:"BudgetNavButtons"|"PaycheckNavButtons"|"InvoiceNavButtons" guard-form refs missed by v0.108.0's direct-call regex
  await applyFinanceHubFrontmatterHeal(tp, manifest, variables, history, git);           // NEW v0.115.1 — heals corrupted hub frontmatter (dup keys + mangled tag/cssclass values) BEFORE the body repair preserves it
  await applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history, git); // NEW v0.115.2 — injects InvoiceWorkspaceNav block + rewrites legacy InvoiceNavButtons -> FinanceNav on every existing Invoice-*.md
  await applyFinanceHubsRepair(tp, manifest, variables, history, git);                    // NEW v0.110.0 — heals stale pre-CF-3 hub bodies (now also strips top-hub FinanceHubActions via v0.110.3 template change)
  await applyFinanceTopHubNavRowDedup(tp, manifest, variables, history, git);             // NEW v0.110.3 — strips FinanceHubActions(here:"finance") block from spice/finance/Finance.md (user feedback: duplicate finance nav section)
  await applyFinanceDefaultsNavRowInjection(tp, manifest, variables, history, git);       // NEW v0.110.3 — injects FinanceNavRow block into Budget/Paycheck/Debt Defaults notes that lack it
}

// applyFinanceHubsRepair — v0.110.0 (finance 0.6.1). Heals consumer vaults
// whose Finance/Budgets/Paychecks/Invoices hub bodies pre-date CF-3 v0.107.0
// (the file-install step is create-if-absent, so consumers stuck with pre-CF-3
// hubs never got the FinanceHubActions consolidated row). Detection: file
// missing customJS.FinanceHubActions reference => stale. Action: rewrite body
// to canonical shape, preserving the existing frontmatter block verbatim.
// Idempotent — files already using FinanceHubActions are skipped. Per-file
// .sauce-backup snapshot before write. Failure-loud per-file.
// v0.111.0: bodies use the unified context-aware FinanceNav (single-line, no
// args). Finance.md now ALSO has a FinanceNav block (was missing entirely
// in earlier templates — the user reported no Debts button on Finance.md).
// applyFinanceInvoiceWorkspaceNavInjection — v0.115.2 PATCH.
//
// Heals existing Invoice-*.md notes by injecting the InvoiceWorkspaceNav
// dataviewjs block between the FinanceNav block and the FinanceStatus.renderBadge
// block. Closes a gap reported on the ero v0.115.1 deploy: from an invoice
// note there was no path to its Time-Log or Board sidecars.
//
// Block injected (byte-identical to the manifest invoice inline_body fragment):
//   <!-- invoice-workspace-nav-v0.9.1 -->
//   ```dataviewjs
//   await dv.view("ranch/views/customjs-guard", { class: "InvoiceWorkspaceNav" });
//   ```
//
// Also rewrites legacy `InvoiceNavButtons` invocations to `FinanceNav` in
// the same pass — a class that was deleted in v0.108.0 but lingered in
// Invoice Template renders on older consumer vaults (observed in ero).
//
// Anchor priority for the InvoiceWorkspaceNav block:
//   1. marker present  -> no-op (idempotent).
//   2. FinanceNav block exists -> inject AFTER it.
//   3. FinanceStatus.renderBadge block exists -> inject BEFORE it.
//   4. frontmatter close -> inject AFTER it.
//
// Headless-safe (adapter.read + regex + adapter.write); .sauce-backup
// snapshot before write; per-file failure-loud; idempotent.
function _injectInvoiceWorkspaceNav(body) {
  const MARKER = "<!-- invoice-workspace-nav-v0.9.1 -->";
  const BLOCK =
    MARKER + "\n" +
    "```dataviewjs\n" +
    "await dv.view(\"ranch/views/customjs-guard\", { class: \"InvoiceWorkspaceNav\" });\n" +
    "```\n";

  // First, rewrite legacy InvoiceNavButtons -> FinanceNav (regardless of whether
  // the workspace-nav block is already present).
  const legacyNavRe = /class:\s*"InvoiceNavButtons"/g;
  let rewritten = body.replace(legacyNavRe, 'class: "FinanceNav"');

  // Idempotent guard.
  if (rewritten.includes(MARKER)) return { body: rewritten, touched: rewritten !== body };

  // Anchor: AFTER FinanceNav block (whole dataviewjs fence ending after `class: "FinanceNav"`).
  const navBlockRe = /(```dataviewjs\s*\n[^\n]*class:\s*"FinanceNav"[^\n]*\n```\s*\n)/;
  if (navBlockRe.test(rewritten)) {
    rewritten = rewritten.replace(navBlockRe, (m) => m + "\n" + BLOCK + "\n");
    return { body: rewritten, touched: true };
  }
  // Anchor: BEFORE FinanceStatus.renderBadge block.
  const statusBlockRe = /(```dataviewjs\s*\n[^\n]*FinanceStatus\.renderBadge[^\n]*\n```\s*\n)/;
  if (statusBlockRe.test(rewritten)) {
    rewritten = rewritten.replace(statusBlockRe, "\n" + BLOCK + "\n$1");
    return { body: rewritten, touched: true };
  }
  // Anchor: after the closing `---\n` of frontmatter.
  const fmCloseRe = /^---\n[\s\S]*?\n---\n/;
  if (fmCloseRe.test(rewritten)) {
    rewritten = rewritten.replace(fmCloseRe, (m) => m + "\n" + BLOCK + "\n");
    return { body: rewritten, touched: true };
  }
  return { body: rewritten, touched: rewritten !== body };
}

async function applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let scanned = 0;
  let touched = 0;
  let unchanged = 0;

  let invoiceFiles = [];
  try {
    const monthDirs = (await adapter.list("spice/finance/invoices")).folders || [];
    for (const monthDir of monthDirs) {
      const files = (await adapter.list(monthDir)).files || [];
      for (const f of files) {
        if (/\/Invoice-\d{4}-\d{2}\.md$/.test(f)) invoiceFiles.push(f);
      }
    }
  } catch (_e) { /* spice/finance/invoices may not exist on minimal vaults */ }

  for (const invoicePath of invoiceFiles) {
    try {
      scanned++;
      const existing = await adapter.read(invoicePath);
      const result = _injectInvoiceWorkspaceNav(existing);
      if (!result.touched) { unchanged++; continue; }
      const backupPath = `.sauce-backup/${ts}/${invoicePath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, existing); } catch (_e) { /* snapshot best-effort */ }
      await adapter.write(invoicePath, result.body);
      touched++;
      history?.push({ event: "info", step: "finance_invoice_workspace_nav_injection", name: "finance",
        action: "injected", path: invoicePath, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_invoice_workspace_nav_injection", name: "finance",
        path: invoicePath, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_invoice_workspace_nav_injection", name: "finance",
    summary: { scanned, touched, unchanged },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// FINANCE_HUB_CANONICAL_TYPES — maps each hub path to its canonical
// `type` frontmatter value. Used by applyFinanceHubFrontmatterHeal to
// detect + rewrite corrupted hub frontmatter (Obsidian "Invalid properties"
// triggers from duplicate keys + mangled tag/cssclass lines on consumer
// vaults — observed on ero pre-v0.115.1 deploy).
const FINANCE_HUB_CANONICAL_TYPES = {
  "spice/finance/Finance.md":            "finance-hub",
  "spice/finance/budgets/Budgets.md":    "budgets-hub",
  "spice/finance/paychecks/Paychecks.md": "paychecks-hub",
  "spice/finance/invoices/Invoices.md":  "invoices-hub",
  "spice/finance/debts/Debts.md":        "debts-hub",
  "spice/finance/months/Months.md":      "months-hub",
};

// applyFinanceHubFrontmatterHeal — v0.115.1 PATCH.
//
// Detects corrupted YAML frontmatter on finance hub files and rewrites it
// to the canonical form. Corruption signals (any one triggers a heal):
//   - duplicate top-level keys (e.g. two `created_at:` lines)
//   - mangled tag/cssclass values (e.g. `finance-hub-hub`,
//     `finance-hubssclasses:` — concatenated lines)
//   - orphan content (non-key non-list lines inside the frontmatter block)
//
// Canonical frontmatter per hub:
//   ---
//   type: <hub-type>            # from FINANCE_HUB_CANONICAL_TYPES
//   created_at: "<preserved or now>"
//   tags:
//     - finance-hub
//   cssclasses:
//     - wide
//   ---
//
// `created_at` is preserved if a valid ISO timestamp is extractable from the
// existing frontmatter; otherwise the current ISO timestamp is used.
//
// Body of the file is preserved verbatim. Heal runs BEFORE
// applyFinanceHubsRepair so the body-repair step sees clean frontmatter.
//
// Idempotent: clean frontmatter is a no-op (no corruption signals).
// Per-file failure-loud + .sauce-backup snapshot before each write.
function _detectFinanceHubFrontmatterCorruption(fmInner) {
  // fmInner is the content BETWEEN the two `---` markers, without them.
  const lines = fmInner.split("\n");
  const keyCounts = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (m) keyCounts[m[1]] = (keyCounts[m[1]] || 0) + 1;
  }
  for (const k of Object.keys(keyCounts)) {
    if (keyCounts[k] > 1) return { corrupt: true, reason: `duplicate key: ${k}` };
  }
  // Mangled known patterns observed in the wild (ero v0.111.3 -> v0.115.0 state).
  if (/finance-hub-hub/.test(fmInner)) return { corrupt: true, reason: "tag mangled: finance-hub-hub" };
  if (/finance-hubssclasses:/.test(fmInner)) return { corrupt: true, reason: "tag/cssclass concatenation: finance-hubssclasses:" };
  // Orphan lines: any non-empty line that is not a top-level key (`foo:`),
  // not a list item (`  - foo`), and not a quoted-string continuation.
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (line.length === 0) continue;
    if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(line)) continue;     // key:
    if (/^\s+-\s+\S/.test(line)) continue;                       // - item
    if (/^\s+[a-zA-Z_]/.test(line)) continue;                    // continuation under a key (multi-line)
    if (/^\s*#/.test(line)) continue;                            // YAML comment
    return { corrupt: true, reason: `orphan line: "${line.trim()}"` };
  }
  return { corrupt: false };
}

function _buildCanonicalFinanceHubFrontmatter(canonicalType, preservedCreatedAt) {
  const now = new Date().toISOString();
  const createdAt = preservedCreatedAt || now;
  return `---\ntype: ${canonicalType}\ncreated_at: "${createdAt}"\ntags:\n  - finance-hub\ncssclasses:\n  - wide\n---\n`;
}

function _extractValidCreatedAt(fmInner) {
  // Find the FIRST valid created_at value. Accepts ISO 8601 datetime strings
  // with optional quoting. If multiple created_at lines exist (corruption),
  // prefer the first that parses.
  const matches = fmInner.matchAll(/^created_at\s*:\s*"?([^"\n]+?)"?\s*$/gm);
  for (const m of matches) {
    const v = m[1].trim();
    // Crude ISO 8601 sniff — YYYY-MM-DDTHH:MM:SS optionally with TZ.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return v;
  }
  return null;
}

async function applyFinanceHubFrontmatterHeal(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0;
  let clean = 0;
  let absent = 0;

  for (const [hubPath, canonicalType] of Object.entries(FINANCE_HUB_CANONICAL_TYPES)) {
    try {
      if (!(await adapter.exists(hubPath))) { absent++; continue; }
      const existing = await adapter.read(hubPath);
      // Split into frontmatter block + body. If the file has no frontmatter
      // at all, we don't heal here — applyFinanceHubsRepair owns body recovery.
      const fmMatch = existing.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!fmMatch) { clean++; continue; }
      const fmInner = fmMatch[1];
      const body = fmMatch[2];
      const detection = _detectFinanceHubFrontmatterCorruption(fmInner);
      if (!detection.corrupt) { clean++; continue; }
      const preservedCreatedAt = _extractValidCreatedAt(fmInner);
      const newFm = _buildCanonicalFinanceHubFrontmatter(canonicalType, preservedCreatedAt);
      const newContent = newFm + body;
      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, existing); } catch (_e) { /* snapshot best-effort */ }
      await adapter.write(hubPath, newContent);
      healed++;
      history?.push({ event: "info", step: "finance_hub_frontmatter_heal", name: "finance",
        action: "healed", path: hubPath, reason: detection.reason, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_hub_frontmatter_heal", name: "finance",
        path: hubPath, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_hub_frontmatter_heal", name: "finance",
    summary: { healed, clean, absent },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

const FINANCE_HUB_BODY_TEMPLATES = {
  "spice/finance/Finance.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceHubSummary\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceHubCards\" });\n```\n",
  "spice/finance/budgets/Budgets.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\n// entity-create:budget — installer-managed; do not delete this comment\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetsCards\" });\n```\n",
  "spice/finance/paychecks/Paychecks.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\n// entity-create:paycheck — installer-managed; do not delete this comment\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"PaychecksCards\" });\n```\n",
  "spice/finance/invoices/Invoices.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\n// entity-create:invoice — installer-managed; do not delete this comment\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"InvoicesCards\" });\n```\n",
  "spice/finance/debts/Debts.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\n// entity-create:debt — installer-managed; do not delete this comment\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"DebtsHubSummary\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"DebtsCards\" });\n```\n",
  "spice/finance/months/Months.md": "\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"SpaceNavButtons\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNav\" });\n```\n\n```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"MonthsCards\" });\n```\n",
};

async function applyFinanceHubsRepair(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let repaired = 0;
  let alreadyCanonical = 0;
  let absent = 0;

  for (const [hubPath, canonicalBody] of Object.entries(FINANCE_HUB_BODY_TEMPLATES)) {
    try {
      if (!(await adapter.exists(hubPath))) { absent++; continue; }
      const existing = await adapter.read(hubPath);
      // v0.111.0: detection updated — file is canonical when it invokes
      // FinanceNav via the customjs-guard. Old FinanceHubActions or
      // FinanceNavRow invocations get rewritten via applyFinanceUnifiedNav
      // Migration; this repair only HEALS files that have neither.
      if (/class:\s*["']FinanceNav["']/.test(existing)) {
        alreadyCanonical++;
        continue;
      }
      // Stale — preserve frontmatter, rewrite body.
      const fmMatch = existing.match(/^(---\n[\s\S]*?\n---\n)/);
      const fm = fmMatch ? fmMatch[1] : "";
      const newContent = fm + canonicalBody;
      // Snapshot before write
      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, existing); } catch (_e) { /* snapshot is best-effort */ }
      await adapter.write(hubPath, newContent);
      repaired++;
      history?.push({ event: "info", step: "finance_hubs_repair", name: "finance",
        action: "repaired", path: hubPath, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_hubs_repair", name: "finance",
        path: hubPath, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_hubs_repair", name: "finance",
    summary: { repaired, alreadyCanonical, absent },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyOrphanedHelperCleanup — v0.110.0. Removes obsolete *.js helper files
// (and their *.js.bak siblings) from consumer ranch/scripts/<blueprint>/
// directories. The installer's file-install step overwrites existing files
// and creates new ones, but it does NOT delete files for entries that have
// been removed from a blueprint's manifest files[]. This step closes that gap.
//
// v0.110.0 known orphans:
//   - finance/budget-nav-buttons.js   (removed in v0.108.0 finance 0.6.0)
//   - finance/paycheck-nav-buttons.js (removed in v0.108.0 finance 0.6.0)
//   - finance/invoice-nav-buttons.js  (removed in v0.108.0 finance 0.6.0)
//
// Also deletes any *.js.bak file under ranch/scripts/ (they are install backups
// that lingered after previous overwrites; never canonical, never loaded by
// CustomJS, but they confuse vault-side inspections).
//
// Top-level step (not blueprint-scoped); runs once per install. Failure-loud
// per file. Idempotent.
async function applyOrphanedHelperCleanup(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const KNOWN_ORPHANS = [
    "ranch/scripts/finance/budget-nav-buttons.js",
    "ranch/scripts/finance/paycheck-nav-buttons.js",
    "ranch/scripts/finance/invoice-nav-buttons.js",
    // v0.116.0 — Migrate-to-tomorrow modal retired.
    "ranch/scripts/to-do/todo-migrate-modal.js",
    "ranch/scripts/to-do/todo-migrate-init.js",
  ];

  let removed = 0;
  let bakRemoved = 0;
  let absent = 0;

  // 1. Delete known orphans
  for (const path of KNOWN_ORPHANS) {
    try {
      if (!(await adapter.exists(path))) { absent++; continue; }
      await adapter.remove(path);
      removed++;
      history?.push({ event: "info", step: "orphaned_helper_cleanup", name: "platform",
        action: "removed_orphan", path,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "orphaned_helper_cleanup", name: "platform",
        path, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  // 2. Delete *.js.bak files under ranch/scripts/ (recursive walk).
  async function _walkAndDeleteBaks(dir) {
    try {
      const listing = await adapter.list(dir);
      for (const file of (listing.files || [])) {
        if (file.endsWith(".js.bak")) {
          try {
            await adapter.remove(file);
            bakRemoved++;
            history?.push({ event: "info", step: "orphaned_helper_cleanup", name: "platform",
              action: "removed_bak", path: file,
              git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
              attempted_at: new Date().toISOString() });
          } catch (e) {
            history?.push({ event: "warning", step: "orphaned_helper_cleanup", name: "platform",
              path: file, reason: e.message,
              git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
              attempted_at: new Date().toISOString() });
          }
        }
      }
      for (const sub of (listing.folders || [])) {
        await _walkAndDeleteBaks(sub);
      }
    } catch (_e) { /* dir missing or unreadable — skip */ }
  }

  if (await adapter.exists("ranch/scripts")) {
    await _walkAndDeleteBaks("ranch/scripts");
  }

  history?.push({ event: "info", step: "orphaned_helper_cleanup", name: "platform",
    summary: { orphanRemoved: removed, orphanAbsent: absent, bakRemoved },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyToDoBlueprintMigration — v0.116.0 (extended in v0.117.0 / to-do v0.5.0).
//
// Reshapes consumer-vault notes to the current to-do v0.5.0 visual shape:
//   - daily To-Do notes (type: to-do) get the 5-block body + SectionLabel
//     "Today" dataviewjs block inserted between LeafActions and
//     ToDoDailyCarryover (or 5 helper blocks appended if v0.3.3 shape).
//   - persisted `## Carryover (...)` / `## Recurring Today` H2 headings inside
//     daily notes get rewritten to `<dataviewjs SectionLabel(...)>` blocks.
//   - per-project To-Do notes (type: project-todo) get `## Owned Tasks` and
//     `## From Meetings` H2 headings rewritten to SectionLabel blocks.
//   - Recurring Tasks.md registry gets `## Recurring Tasks` + `## Last 7 days
//     of materialization` H2 headings rewritten to SectionLabel blocks.
//
// User content (free-form `- [ ]` lines, ## Notes section, etc.) is preserved
// verbatim. .sauce-backup snapshot before any write. Idempotent (multiple
// invocations on already-migrated content are no-ops).
async function applyToDoBlueprintMigration(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const TODO_ROOT = "spice/to-do";
  const PROJ_ROOT = "spice/projects";
  if (!(await adapter.exists(TODO_ROOT)) && !(await adapter.exists(PROJ_ROOT))) return;

  let migrated = 0, alreadyCurrent = 0, absorbedTasksHeading = 0, errors = 0;
  let projectTodoReshaped = 0, registryReshaped = 0, dailyHeadingsReshaped = 0;

  const viewsPath = (variables && variables.views_path) || 'ranch/views';

  // v0.5.0 — generic H2 → SectionLabel rewriter. Replaces a markdown `## <Heading>`
  // line with a `<dataviewjs SectionLabel(text: ...)>` block. Idempotent: skips if
  // the same SectionLabel block already exists nearby.
  function _rewriteH2ToSectionLabel(body, headingPattern) {
    // headingPattern: regex matching the H2 line (NOT including the surrounding newlines).
    return body.replace(new RegExp('^' + headingPattern.source + '$', 'gm'), (match) => {
      const text = match.replace(/^## /, '').trim();
      return [
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: ${JSON.stringify(text)} }] });`,
        '```'
      ].join('\n');
    });
  }

  async function _walkToDos(dir) {
    const out = [];
    try {
      const listing = await adapter.list(dir);
      for (const file of (listing.files || [])) {
        if (/\/ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(file)) out.push(file);
      }
      for (const sub of (listing.folders || [])) {
        const sf = await _walkToDos(sub);
        out.push(...sf);
      }
    } catch (_e) { /* ignore */ }
    return out;
  }
  const dailies = await _walkToDos(TODO_ROOT);

  function _isV040(body) {
    return body.includes('class: "ToDoDailyCarryover"');
  }

  function _isV033Shape(body) {
    // v0.3.3 shape: has SpaceNavButtons + ToDoLeafActions dataviewjs blocks
    // but NOT ToDoDailyCarryover.
    return body.includes('class: "SpaceNavButtons"') &&
        body.includes('class: "ToDoLeafActions"') &&
        !body.includes('class: "ToDoDailyCarryover"');
  }

  function _isV040ShapeMissingSectionLabel(body) {
    // v0.4.0 shape: has ToDoDailyCarryover but does NOT have a SectionLabel
    // dataviewjs block for "Today" between LeafActions and Carryover.
    return body.includes('class: "ToDoDailyCarryover"') &&
        !/class: "SectionLabel"[^`]*Today/.test(body);
  }

  function _reshapeToV040(body, viewsPath) {
    // Capture frontmatter region.
    const lines = body.split('\n');
    let fmEnd = -1;
    if (lines[0] === '---') {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === '---') { fmEnd = i; break; }
      }
    }
    const fmBlock = (fmEnd > 0) ? lines.slice(0, fmEnd + 1).join('\n') + '\n' : '';
    const rest = (fmEnd > 0) ? lines.slice(fmEnd + 1).join('\n') : body;

    // Extract task lines (top-level `- [ ]` or `- [x]`) anywhere in `rest`.
    // Also preserve any `## Notes` section content (post-Notes-heading) verbatim.
    const restLines = rest.split('\n');
    const captured = [];
    let notesSection = null;
    let inNotes = false;
    let tasksHeadingFound = false;
    for (const ln of restLines) {
      if (/^## Notes$/.test(ln)) {
        inNotes = true;
        notesSection = [ln];
        continue;
      }
      if (inNotes) {
        if (/^## /.test(ln)) {
          inNotes = false;
        } else {
          notesSection.push(ln);
          continue;
        }
      }
      if (/^## Tasks$/.test(ln)) { tasksHeadingFound = true; continue; }
      if (/^- \[(?: |x)\] /i.test(ln)) {
        captured.push(ln);
      } else if (/^\s+- /.test(ln) || /^\s+/.test(ln)) {
        // Indented continuation; if last captured was a `- [ ]`, keep.
        if (captured.length && /^- \[/.test(captured[captured.length - 1])) {
          captured.push(ln);
        }
      }
    }
    if (tasksHeadingFound) absorbedTasksHeading++;

    const vp = viewsPath || 'ranch/views';
    const dvBlock = (cls, args) => {
      const argPart = args ? `, args: ${args}` : '';
      return '```dataviewjs\nawait dv.view("' + vp + '/customjs-guard", { class: "' + cls + '"' + argPart + ' });\n```';
    };

    const parts = [
      fmBlock.replace(/\n$/, ''),
      '',
      dvBlock('SpaceNavButtons'),
      '',
      dvBlock('ToDoLeafActions'),
      '',
      dvBlock('SectionLabel', '[{ text: "Today\'s Capture", top: true }]'),
      '',
    ];
    if (captured.length) parts.push(captured.join('\n'), '');
    parts.push(
      dvBlock('ToDoDailyCarryover'),
      '',
      dvBlock('ToDoDailyRecurring'),
      '',
      dvBlock('ToDoDailyProjectGroups'),
      '',
      dvBlock('ToDoDailyUnassignedMeetings'),
      '',
    );
    if (notesSection && notesSection.length > 1) parts.push(notesSection.join('\n'), '');
    return parts.join('\n');
  }

  // v0.5.1 — heal frontmatter where v0.5.0's writeSentinel placed the sentinel INSIDE
  // the frontmatter region. Returns the body with any such sentinels relocated to the
  // line IMMEDIATELY AFTER the closing `---`. Idempotent.
  function _healMisplacedSentinels(body) {
    const lines = body.split('\n');
    if (lines[0] !== '---') return body;
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') { closeIdx = i; break; }
    }
    if (closeIdx === -1) {
      // Closing `---` was eaten — look for the misplaced sentinel and recover.
      let sentinelIdx = -1;
      for (let i = 1; i < lines.length; i++) {
        if (/^<!-- (carryover-from-|recurring-materialized-)/.test(lines[i])) { sentinelIdx = i; break; }
      }
      if (sentinelIdx === -1) return body;
      // Insert `---` BEFORE the misplaced sentinel; sentinel becomes line after the close.
      const fmRegion = lines.slice(0, sentinelIdx).concat(['---']);
      const sentinel = lines[sentinelIdx];
      const after = lines.slice(sentinelIdx + 1);
      return fmRegion.concat([sentinel], after).join('\n');
    }
    // Closing `---` is present — check whether any sentinels live BETWEEN [0..closeIdx].
    const misplaced = lines.slice(0, closeIdx).filter(l => /^<!-- (carryover-from-|recurring-materialized-)/.test(l));
    if (misplaced.length === 0) return body;
    // Strip misplaced sentinels from inside frontmatter; put them AFTER the closing `---`.
    const fmRegion = lines.slice(0, closeIdx + 1).filter(l => !/^<!-- (carryover-from-|recurring-materialized-)/.test(l));
    const after = lines.slice(closeIdx + 1).filter(l => !/^<!-- (carryover-from-|recurring-materialized-)/.test(l));
    return fmRegion.concat(misplaced, after).join('\n');
  }

  function _injectSectionLabelIntoV040(body) {
    // Insert the SectionLabel("Today", top: true) dataviewjs block
    // immediately after the ToDoLeafActions block + a blank line. Idempotent:
    // returns body unchanged if the SectionLabel marker is already present.
    if (/class: "SectionLabel"[^`]*Today/.test(body)) return body;
    const ANCHOR_RE = /(```dataviewjs[^`]*class:\s*"ToDoLeafActions"[^`]*```\n?)/;
    const m = ANCHOR_RE.exec(body);
    if (!m) return body;
    const labelBlock = [
      '',
      '```dataviewjs',
      `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: "Today", top: true }] });`,
      '```',
      '',
    ].join('\n');
    const insertPos = m.index + m[0].length;
    return body.slice(0, insertPos) + labelBlock + body.slice(insertPos);
  }

  for (const relPath of dailies) {
    try {
      const body = await adapter.read(relPath);
      let newBody = body;
      let touched = false;

      if (_isV033Shape(newBody)) {
        // v0.3.3 → v0.5.0 full reshape.
        const backupPath = '.sauce-backup/' + new Date().toISOString().replace(/[:.]/g, '-') + '/' + relPath;
        try {
          const backupFolder = backupPath.split('/').slice(0, -1).join('/');
          if (!(await adapter.exists(backupFolder))) await adapter.mkdir(backupFolder);
          await adapter.write(backupPath, body);
        } catch (_e) { /* best-effort */ }
        newBody = _reshapeToV040(newBody, viewsPath);
        touched = true;
      } else if (_isV040ShapeMissingSectionLabel(newBody)) {
        // v0.4.0 → v0.5.0: insert SectionLabel block.
        newBody = _injectSectionLabelIntoV040(newBody);
        if (newBody !== body) touched = true;
      }

      // v0.5.0 H2 → SectionLabel rewrite for persisted Carryover/Recurring headings.
      const beforeHeadings = newBody;
      newBody = _rewriteH2ToSectionLabel(newBody, /## Carryover \(from \d{4}-\d{2}-\d{2}\)/);
      newBody = _rewriteH2ToSectionLabel(newBody, /## Recurring Today/);
      if (newBody !== beforeHeadings) { dailyHeadingsReshaped++; touched = true; }

      // v0.5.1 heal: move misplaced sentinels (carryover-from-* / recurring-materialized-*)
      // OUT of the frontmatter region — they were inserted INSIDE the YAML by the v0.5.0
      // writeSentinel bug, breaking properties parse. Repositions to OUTSIDE (after closing `---`).
      const healed = _healMisplacedSentinels(newBody);
      if (healed !== newBody) { newBody = healed; touched = true; }

      // v0.5.1 cosmetic: rename existing "Today's Capture" SectionLabel → "Today".
      const renamed = newBody.replace(/SectionLabel"[^`]*text:\s*"Today's Capture"/g, (m) => m.replace("Today's Capture", "Today"));
      if (renamed !== newBody) { newBody = renamed; touched = true; }

      // v0.5.2 cleanup: the v0.5.0 dialog's _insertLineUnderSection bug created
      // orphan `## Today's Capture` H2 lines at EOF on daily notes. The SectionLabel
      // block at the top of the body already provides the label; the H2 is just
      // cruft. Remove the orphan heading (the task lines stay; they become
      // free-form bullets under the existing SectionLabel block).
      const orphanRe = /^## (Today's Capture|Today)\s*$/gm;
      const stripped = newBody.replace(orphanRe, '').replace(/\n{3,}/g, '\n\n');
      if (stripped !== newBody) { newBody = stripped; touched = true; }

      if (!touched) { alreadyCurrent++; continue; }
      // (skip-old to-do block start)
      if (false) {
      }  // (skip-old to-do block end)
      await adapter.write(relPath, newBody);
      migrated++;
      history?.push({ event: "info", step: "to_do_blueprint_migration", name: "to-do",
        action: "reshaped", path: relPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      errors++;
      history?.push({ event: "error", step: "to_do_blueprint_migration", name: "to-do",
        path: relPath, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  // v0.5.0 — rewrite persistent H2 headings inside project-todo notes to
  // SectionLabel dataviewjs blocks. Walks spice/projects/*/<Name> To-Do.md
  // and rewrites `## Owned Tasks` + `## From Meetings` headings.
  async function _walkProjectTodos(dir) {
    const out = [];
    try {
      const listing = await adapter.list(dir);
      for (const sub of (listing.folders || [])) {
        try {
          const subListing = await adapter.list(sub);
          for (const f of (subListing.files || [])) {
            if (/ To-Do\.md$/.test(f)) out.push(f);
          }
        } catch (_e) {}
      }
    } catch (_e) {}
    return out;
  }

  if (await adapter.exists(PROJ_ROOT)) {
    const projectTodos = await _walkProjectTodos(PROJ_ROOT);
    for (const relPath of projectTodos) {
      try {
        const body = await adapter.read(relPath);
        if (!body.includes('## Owned Tasks') && !body.includes('## From Meetings')) continue;
        let newBody = body;
        newBody = _rewriteH2ToSectionLabel(newBody, /## Owned Tasks/);
        newBody = _rewriteH2ToSectionLabel(newBody, /## From Meetings/);
        if (newBody === body) continue;
        try {
          const backupPath = '.sauce-backup/' + new Date().toISOString().replace(/[:.]/g, '-') + '/' + relPath;
          const backupFolder = backupPath.split('/').slice(0, -1).join('/');
          if (!(await adapter.exists(backupFolder))) await adapter.mkdir(backupFolder);
          await adapter.write(backupPath, body);
        } catch (_e) {}
        await adapter.write(relPath, newBody);
        projectTodoReshaped++;
        history?.push({ event: "info", step: "to_do_blueprint_migration", name: "to-do",
          action: "reshaped_project_todo", path: relPath,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
      } catch (e) {
        errors++;
        history?.push({ event: "error", step: "to_do_blueprint_migration", name: "to-do",
          path: relPath, reason: e.message,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }
  }

  // v0.5.0 — rewrite Recurring Tasks.md registry's H2 headings to SectionLabel blocks.
  const registryPath = 'spice/to-do/Recurring Tasks.md';
  if (await adapter.exists(registryPath)) {
    try {
      const body = await adapter.read(registryPath);
      if (body.includes('## Recurring Tasks') || body.includes('## Last 7 days of materialization')) {
        let newBody = body;
        newBody = _rewriteH2ToSectionLabel(newBody, /## Recurring Tasks/);
        newBody = _rewriteH2ToSectionLabel(newBody, /## Last 7 days of materialization/);
        if (newBody !== body) {
          try {
            const backupPath = '.sauce-backup/' + new Date().toISOString().replace(/[:.]/g, '-') + '/' + registryPath;
            const backupFolder = backupPath.split('/').slice(0, -1).join('/');
            if (!(await adapter.exists(backupFolder))) await adapter.mkdir(backupFolder);
            await adapter.write(backupPath, body);
          } catch (_e) {}
          await adapter.write(registryPath, newBody);
          registryReshaped++;
          history?.push({ event: "info", step: "to_do_blueprint_migration", name: "to-do",
            action: "reshaped_recurring_registry", path: registryPath,
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString() });
        }
      }
    } catch (e) {
      errors++;
      history?.push({ event: "error", step: "to_do_blueprint_migration", name: "to-do",
        path: registryPath, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "to_do_blueprint_migration", name: "to-do",
    summary: { migrated, alreadyCurrent, absorbedTasksHeading, dailyHeadingsReshaped, projectTodoReshaped, registryReshaped, errors },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyRecurringSentinelV070Migration — v0.119.0 (to-do v0.7.0).
//
// Heals legacy date-only `<!-- recurring-materialized-YYYY-MM-DD -->` sentinels
// in daily To-Do notes by rewriting them in place to the empty-set form
// `<!-- recurring-materialized-YYYY-MM-DD: -->`. On the next Obsidian render,
// ToDoDailyRecurring.materialize() repopulates the set with current registry
// hashes — fixing the mid-day-added-recurring-task blind spot (v0.118.1
// postmortem item #5). Idempotent: files already in the new form are skipped.
// .sauce-backup snapshot before any write.
async function applyRecurringSentinelV070Migration(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const TODO_ROOT = "spice/to-do";
  const exists = await adapter.exists(TODO_ROOT).catch(() => false);
  if (!exists) {
    history?.push({ event: "info", step: "applyRecurringSentinelV070Migration",
      healed: 0, errors: [], skipped_reason: "spice/to-do not present",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  async function _walkDailies(dir) {
    const out = [];
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return out; }
    for (const f of (listing.files || [])) {
      if (/\/ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(f)) out.push(f);
    }
    for (const sub of (listing.folders || [])) {
      const nested = await _walkDailies(sub);
      out.push(...nested);
    }
    return out;
  }

  const dailies = await _walkDailies(TODO_ROOT);
  if (!dailies.length) {
    history?.push({ event: "info", step: "applyRecurringSentinelV070Migration",
      healed: 0, errors: [], skipped_reason: "no daily to-do notes found",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  // Match a legacy date-only sentinel: `<!-- recurring-materialized-YYYY-MM-DD -->`.
  // The new form carries a `:` after the date — explicitly excluded.
  const LEGACY_RE = /<!-- recurring-materialized-(\d{4}-\d{2}-\d{2}) -->/g;

  let healed = 0;
  const errors = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  for (const path of dailies) {
    let content;
    try { content = await adapter.read(path); }
    catch (e) { errors.push({ path, error: e && e.message }); continue; }
    if (!/<!-- recurring-materialized-/.test(content)) continue;
    // Already in new form? Skip.
    if (/<!-- recurring-materialized-\d{4}-\d{2}-\d{2}:/.test(content)) continue;
    const updated = content.replace(LEGACY_RE, '<!-- recurring-materialized-$1: -->');
    if (updated === content) continue;
    try {
      // .sauce-backup snapshot first; tolerate adapters that don't expose mkdir.
      const backupDir = `.sauce-backup/${ts}/${path.split('/').slice(0, -1).join('/')}`;
      const backupPath = `.sauce-backup/${ts}/${path}`;
      if (typeof adapter.mkdir === 'function') {
        try { await adapter.mkdir(backupDir); } catch (_e) { /* tolerate */ }
      }
      try { await adapter.write(backupPath, content); } catch (_e) { /* tolerate */ }
      await adapter.write(path, updated);
      healed++;
    } catch (e) {
      errors.push({ path, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "applyRecurringSentinelV070Migration",
    healed, errors,
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });

  if (errors.length) {
    throw new Error(`applyRecurringSentinelV070Migration: ${errors.length} file(s) failed; first: ${errors[0].path} — ${errors[0].error}`);
  }
}

// mergeDuplicateRecurringSections — v0.119.1 (to-do v0.7.1).
//
// Heals daily To-Do notes that have MULTIPLE "Recurring Today" SectionLabel
// dataviewjs blocks. Reported on accuris 2026-06-16: after creating a new
// recurring task in a daily that already had materialized recurring tasks,
// `ToDoDailyRecurring.insertRecurringIntoToday` inserted a NEW SectionLabel
// block instead of appending to the existing one. v0.7.1 fixes the live render
// path; this migration heals already-broken dailies in place.
//
// Strategy: scan each daily for >1 "Recurring Today" SectionLabel blocks.
// If found: keep the FIRST block; collect all task-lines from every subsequent
// block; append them to the first block's section; delete the redundant
// SectionLabel dataviewjs blocks. Idempotent: files with 0-1 such blocks are
// unchanged. .sauce-backup snapshot before any write.
async function mergeDuplicateRecurringSections(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const TODO_ROOT = "spice/to-do";
  const exists = await adapter.exists(TODO_ROOT).catch(() => false);
  if (!exists) {
    history?.push({ event: "info", step: "mergeDuplicateRecurringSections",
      merged: 0, errors: [], skipped_reason: "spice/to-do not present",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  async function _walkDailies(dir) {
    const out = [];
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return out; }
    for (const f of (listing.files || [])) {
      if (/\/ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(f)) out.push(f);
    }
    for (const sub of (listing.folders || [])) {
      const nested = await _walkDailies(sub);
      out.push(...nested);
    }
    return out;
  }

  // SectionLabel block targeting "Recurring Today" (any args shape with text:"Recurring Today").
  const RECURRING_LABEL_RE = /```dataviewjs\s*\n\s*await\s+dv\.view\(\s*"ranch\/views\/customjs-guard"\s*,\s*\{\s*class:\s*"SectionLabel"\s*,\s*args:\s*\[\s*\{\s*text:\s*"Recurring Today"[^}]*\}\s*\]\s*\}\s*\)\s*;?\s*\n\s*```/g;

  function _findRecurringBlocks(content) {
    const out = [];
    let m;
    RECURRING_LABEL_RE.lastIndex = 0;
    while ((m = RECURRING_LABEL_RE.exec(content)) !== null) {
      out.push({ start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  function _sectionEnd(content, sectionStart) {
    const tail = content.slice(sectionStart);
    const TERMINATOR_RE = /\n(?=```dataviewjs|## |# )/;
    const t = TERMINATOR_RE.exec(tail);
    return t ? (sectionStart + t.index) : content.length;
  }

  function _mergeFile(content) {
    const blocks = _findRecurringBlocks(content);
    if (blocks.length < 2) return content;

    // Collect task-line bodies for every block after the first.
    const firstBlock = blocks[0];
    const tailBodies = [];
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      const bEnd = _sectionEnd(content, b.end);
      const body = content.slice(b.end, bEnd).replace(/^\n+/, '').replace(/\n+$/, '');
      if (body) tailBodies.push(body);
    }

    // First block's section end.
    const firstEnd = _sectionEnd(content, firstBlock.end);
    const firstBody = content.slice(firstBlock.end, firstEnd).replace(/\n+$/, '');
    const mergedBody = [firstBody, ...tailBodies].filter(Boolean).join('\n');

    // Compose: head (everything before first block) + first block + merged body +
    //          (content after the last redundant block — i.e., from the end of the
    //          LAST block's section onward).
    const lastBlock = blocks[blocks.length - 1];
    const lastEnd = _sectionEnd(content, lastBlock.end);

    const head = content.slice(0, firstBlock.end);
    const tail = content.slice(lastEnd);
    return head + (mergedBody ? '\n' + mergedBody + '\n' : '\n') + tail.replace(/^\n+/, '\n');
  }

  const dailies = await _walkDailies(TODO_ROOT);
  if (!dailies.length) {
    history?.push({ event: "info", step: "mergeDuplicateRecurringSections",
      merged: 0, errors: [], skipped_reason: "no daily to-do notes found",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  let merged = 0;
  const errors = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  for (const path of dailies) {
    let content;
    try { content = await adapter.read(path); }
    catch (e) { errors.push({ path, error: e && e.message }); continue; }
    if (!/SectionLabel.*"Recurring Today"/.test(content)) continue;
    const updated = _mergeFile(content);
    if (updated === content) continue;
    try {
      const backupDir = `.sauce-backup/${ts}/${path.split('/').slice(0, -1).join('/')}`;
      const backupPath = `.sauce-backup/${ts}/${path}`;
      if (typeof adapter.mkdir === 'function') {
        try { await adapter.mkdir(backupDir); } catch (_e) { /* tolerate */ }
      }
      try { await adapter.write(backupPath, content); } catch (_e) { /* tolerate */ }
      await adapter.write(path, updated);
      merged++;
    } catch (e) {
      errors.push({ path, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "mergeDuplicateRecurringSections",
    merged, errors,
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });

  if (errors.length) {
    throw new Error(`mergeDuplicateRecurringSections: ${errors.length} file(s) failed; first: ${errors[0].path} — ${errors[0].error}`);
  }
}

// stripPersistedRecurringSection — v0.120.0 (to-do v0.8.0).
//
// v0.8.0 retires recurring-task materialization in favor of live render
// (ToDoDailyRecurring.render() now queries the registry on every render
// and emits matching tasks directly into dv.container — no writes to today's
// daily file). Existing dailies still carry persisted "Recurring Today" /
// "Recurring" SectionLabel blocks + materialized `- [ ] ... [recurring_from::
// [[Recurring Tasks]]]` task lines + `<!-- recurring-materialized-... -->`
// sentinels left over from v0.7.x materialization. This migration strips them
// in place so the live render is the only source of those task rows.
//
// Strategy: for each `spice/to-do/**/ToDo-*.md`:
//   1. Remove every `<!-- recurring-materialized-... -->` sentinel.
//   2. Find each "Recurring Today" / "Recurring" SectionLabel dataviewjs block.
//      For each: drop the block AND every following line until the next
//      dataviewjs block / H1-H2 heading / EOF.
// Idempotent. .sauce-backup snapshot before write. Failure-loud per-file.
async function stripPersistedRecurringSection(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const TODO_ROOT = "spice/to-do";
  const exists = await adapter.exists(TODO_ROOT).catch(() => false);
  if (!exists) {
    history?.push({ event: "info", step: "stripPersistedRecurringSection",
      stripped: 0, errors: [], skipped_reason: "spice/to-do not present",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  async function _walkDailies(dir) {
    const out = [];
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return out; }
    for (const f of (listing.files || [])) {
      if (/\/ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(f)) out.push(f);
    }
    for (const sub of (listing.folders || [])) {
      const nested = await _walkDailies(sub);
      out.push(...nested);
    }
    return out;
  }

  const RECURRING_LABEL_RE = /```dataviewjs\s*\n\s*await\s+dv\.view\(\s*"ranch\/views\/customjs-guard"\s*,\s*\{\s*class:\s*"SectionLabel"\s*,\s*args:\s*\[\s*\{\s*text:\s*"Recurring(?: Today)?"[^}]*\}\s*\]\s*\}\s*\)\s*;?\s*\n\s*```/g;
  const SENTINEL_RE = /<!-- recurring-materialized-[^>]+-->\n?/g;

  function _stripFile(content) {
    let s = content;
    // (1) Drop sentinels.
    s = s.replace(SENTINEL_RE, '');
    // (2) Walk through and strip each "Recurring (Today)" SectionLabel block AND
    // every line after it up to the next dataviewjs block / H1-H2 / EOF.
    while (true) {
      RECURRING_LABEL_RE.lastIndex = 0;
      const m = RECURRING_LABEL_RE.exec(s);
      if (!m) break;
      const sectionStart = m.index;
      const tail = s.slice(m.index + m[0].length);
      const TERMINATOR_RE = /\n(?=```dataviewjs|## |# )/;
      const t = TERMINATOR_RE.exec(tail);
      const sectionEnd = t ? (m.index + m[0].length + t.index) : s.length;
      // Strip block + body. Also clean up surrounding blank-line clutter so the
      // surrounding dataviewjs blocks remain visually separated by one blank line.
      const head = s.slice(0, sectionStart).replace(/\n+$/, '\n');
      const rest = s.slice(sectionEnd).replace(/^\n+/, '\n');
      s = head + rest;
    }
    return s;
  }

  const dailies = await _walkDailies(TODO_ROOT);
  if (!dailies.length) {
    history?.push({ event: "info", step: "stripPersistedRecurringSection",
      stripped: 0, errors: [], skipped_reason: "no daily to-do notes found",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  let stripped = 0;
  const errors = [];
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  for (const path of dailies) {
    let content;
    try { content = await adapter.read(path); }
    catch (e) { errors.push({ path, error: e && e.message }); continue; }
    if (!/SectionLabel.*"Recurring/.test(content) && !/<!-- recurring-materialized-/.test(content)) continue;
    const updated = _stripFile(content);
    if (updated === content) continue;
    try {
      const backupDir = `.sauce-backup/${ts}/${path.split('/').slice(0, -1).join('/')}`;
      const backupPath = `.sauce-backup/${ts}/${path}`;
      if (typeof adapter.mkdir === 'function') {
        try { await adapter.mkdir(backupDir); } catch (_e) { /* tolerate */ }
      }
      try { await adapter.write(backupPath, content); } catch (_e) { /* tolerate */ }
      await adapter.write(path, updated);
      stripped++;
    } catch (e) {
      errors.push({ path, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "stripPersistedRecurringSection",
    stripped, errors,
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });

  if (errors.length) {
    throw new Error(`stripPersistedRecurringSection: ${errors.length} file(s) failed; first: ${errors[0].path} — ${errors[0].error}`);
  }
}

// applyProjectTodoBackfill — v0.116.0. Creates `spice/projects/<slug>/<Name> To-Do.md`
// for every project lacking one. Skip-if-exists. The hub note's basename is used
// as the To-Do filename prefix (mirrors the project blueprint's HUB_NOTE_FILENAME_STYLE
// = "name" default). Frontmatter:
//   type: project-todo
//   project: "[[<Name>]]"
//   project_slug: <slug>
async function applyProjectTodoBackfill(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const PROJ_ROOT = "spice/projects";
  if (!(await adapter.exists(PROJ_ROOT))) return;

  let created = 0, skipped = 0, errors = 0;

  let listing;
  try { listing = await adapter.list(PROJ_ROOT); }
  catch (_e) { return; }

  for (const projDir of (listing.folders || [])) {
    try {
      const subListing = await adapter.list(projDir);
      // Find the project's hub note — the .md whose frontmatter has type: project.
      let hubName = null;
      for (const file of (subListing.files || [])) {
        if (!file.endsWith('.md')) continue;
        // Skip our own To-Do file (if it exists) and obvious system files.
        if (/ To-Do\.md$/.test(file)) continue;
        if (/Project Map\.md$/.test(file)) continue;
        if (/-board\.md$/.test(file)) continue;
        const content = await adapter.read(file);
        if (/^type:\s*project\b/m.test(content) || /^type:\s*"project"/m.test(content)) {
          hubName = file.split('/').pop().replace(/\.md$/, '');
          break;
        }
      }
      if (!hubName) { skipped++; continue; }
      const slug = projDir.split('/').pop();
      const toDoPath = `${projDir}/${hubName} To-Do.md`;
      if (await adapter.exists(toDoPath)) { skipped++; continue; }
      const vaultTag = (variables && variables.vault_identity_tag) || '';
      const viewsPath = (variables && variables.views_path) || 'ranch/views';
      const body = [
        '---',
        'type: project-todo',
        `project: "[[${hubName}]]"`,
        `project_slug: ${slug}`,
        `created_at: "${new Date().toISOString()}"`,
        'tags:',
        `  - "${vaultTag}"`,
        'cssclasses:',
        '  - wide',
        '---',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "Breadcrumb" });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SpaceNavButtons" });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "ProjectNavButtons" });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "ToDoLeafActions" });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks", top: true }] });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: "From Meetings" }] });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "ToDoDailyProjectGroups", args: [{ scope: "project-todo" }] });`,
        '```',
        '',
      ].join('\n');
      await adapter.write(toDoPath, body);
      created++;
      history?.push({ event: "info", step: "project_todo_backfill", name: "project",
        action: "created", path: toDoPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      errors++;
      history?.push({ event: "error", step: "project_todo_backfill", name: "project",
        projDir, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "project_todo_backfill", name: "project",
    summary: { created, skipped, errors },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyEntityCreateGuardMigration — v0.110.1. Heals the cold-vault load race
// where dataviewjs blocks call `customJS.EntityCreate.render(dv, {...})`
// before the CustomJS plugin has registered EntityCreate. Direct calls throw
// TypeError; the customjs-guard view polls window.customJS for 2s and falls
// back gracefully. This migration rewrites every direct call in vault notes
// to go through the guard.
//
// Pattern matched (vault-wide, recursive .md walk under spice/):
//   ```dataviewjs
//   // entity-create:<id> — installer-managed; do not delete this comment
//   await customJS.EntityCreate.render(dv, { instance: "<id>" });
//   ```
// Rewritten to:
//   ```dataviewjs
//   // entity-create:<id> — installer-managed; do not delete this comment
//   await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "<id>" }] });
//   ```
//
// Idempotent — files already using the guard form are skipped (the regex
// requires the direct-call shape). Per-file failure-loud + .sauce-backup
// snapshot before write.
async function applyEntityCreateGuardMigration(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  // Direct-call pattern: matches `await customJS.EntityCreate.render(dv,
  // { instance: "<id>" })` with optional whitespace + optional trailing
  // semicolon. The instance value is captured. Guard form has class:
  // "EntityCreate" which the matcher does NOT match (idempotency).
  const DIRECT_CALL_RE = /await\s+customJS\.EntityCreate\.render\(\s*dv\s*,\s*\{\s*instance\s*:\s*["']([^"']+)["']\s*\}\s*\)\s*;?/g;

  function _rewriteEntityCreateDirectCalls(body) {
    let touched = 0;
    const out = body.replace(DIRECT_CALL_RE, (_m, instanceId) =>
      `await dv.view("ranch/views/customjs-guard", { class: "EntityCreate", args: [{ instance: "${instanceId}" }] });`
    );
    if (out !== body) {
      touched = (body.match(DIRECT_CALL_RE) || []).length;
    }
    return { body: out, touched };
  }

  async function _walkMd(dir, files = []) {
    try {
      const listing = await adapter.list(dir);
      for (const fp of (listing.files || [])) {
        if (fp.endsWith(".md")) files.push(fp);
      }
      for (const sub of (listing.folders || [])) {
        await _walkMd(sub, files);
      }
    } catch (_e) { /* dir missing or unreadable — skip */ }
    return files;
  }

  if (!(await adapter.exists("spice"))) {
    history?.push({ event: "info", step: "entity_create_guard_migration", name: "platform",
      summary: { scanned: 0, rewritten: 0, callsReplaced: 0 },
      reason: "spice/ root absent; nothing to migrate",
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      completed_at: new Date().toISOString() });
    return;
  }

  const files = await _walkMd("spice");
  if (files.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let scanned = 0;
  let rewritten = 0;
  let callsReplaced = 0;

  for (const fp of files) {
    scanned++;
    try {
      const body = await adapter.read(fp);
      if (!DIRECT_CALL_RE.test(body)) continue;
      DIRECT_CALL_RE.lastIndex = 0; // reset after test()
      const { body: out, touched } = _rewriteEntityCreateDirectCalls(body);
      if (touched === 0 || out === body) continue;
      // Snapshot before write
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, out);
      rewritten++;
      callsReplaced += touched;
      history?.push({ event: "info", step: "entity_create_guard_migration", name: "platform",
        action: "rewrote", path: fp, callsReplaced: touched, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "entity_create_guard_migration", name: "platform",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "entity_create_guard_migration", name: "platform",
    summary: { scanned, rewritten, callsReplaced },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyCustomJsGuardMigration — v0.110.2. Generalizes v0.110.1's
// applyEntityCreateGuardMigration to ANY direct customJS.<Class>.render(dv...)
// call in note bodies. The customjs-guard view polls window.customJS for 2s
// before invoking; direct calls bypass that and race on cold load (especially
// noticeable on mobile Obsidian where Capacitor's startup is slower).
//
// Patterns matched (vault-wide, recursive .md walk under spice/):
//
//   await customJS.<Class>.render(dv);
//   await customJS.<Class>.render(dv, <opts-object>);
//
// Rewritten to:
//
//   await dv.view("ranch/views/customjs-guard", { class: "<Class>" });
//   await dv.view("ranch/views/customjs-guard", { class: "<Class>", args: [<opts-object>] });
//
// Constraints:
//   - Only matches when the first arg is exactly `dv` (so helpers that pass
//     sub-containers like btnRowProxy are unaffected — those fix themselves
//     via inline poll in their CustomJS class code).
//   - Only matches `.render` (not other method calls like `.create`).
//   - opts must be a balanced `{...}` (no nested objects in the regex; for
//     complex opts the existing direct call stays put — rare in practice).
//   - Skips guard-form invocations naturally (the regex requires
//     `customJS.X.render(dv` not `dv.view`).
//
// Idempotent. Per-file failure-loud + .sauce-backup snapshot before write.
async function applyCustomJsGuardMigration(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  // Direct-call regex with optional opts. Capture groups:
  //   1 = ClassName (must start with uppercase, alphanumeric)
  //   2 = optional opts-object literal (balanced `{...}` with no nested braces)
  const DIRECT_RENDER_RE = /await\s+customJS\.([A-Z][A-Za-z0-9_]*)\.render\(\s*dv\s*(?:,\s*(\{[^{}]*\}))?\s*\)\s*;?/g;

  function _rewriteAnyDirectRenderCall(body) {
    let touched = 0;
    const out = body.replace(DIRECT_RENDER_RE, (_m, className, opts) => {
      touched++;
      const argsClause = opts ? `, args: [${opts}]` : "";
      return `await dv.view("ranch/views/customjs-guard", { class: "${className}"${argsClause} });`;
    });
    return { body: out, touched };
  }

  async function _walkMd(dir, files = []) {
    try {
      const listing = await adapter.list(dir);
      for (const fp of (listing.files || [])) {
        if (fp.endsWith(".md")) files.push(fp);
      }
      for (const sub of (listing.folders || [])) {
        await _walkMd(sub, files);
      }
    } catch (_e) { /* dir missing or unreadable — skip */ }
    return files;
  }

  if (!(await adapter.exists("spice"))) {
    history?.push({ event: "info", step: "customjs_guard_migration", name: "platform",
      summary: { scanned: 0, rewritten: 0, callsReplaced: 0 },
      reason: "spice/ root absent; nothing to migrate",
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      completed_at: new Date().toISOString() });
    return;
  }

  const files = await _walkMd("spice");
  if (files.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let scanned = 0;
  let rewritten = 0;
  let callsReplaced = 0;
  const classCounts = {};

  for (const fp of files) {
    scanned++;
    try {
      const body = await adapter.read(fp);
      if (!DIRECT_RENDER_RE.test(body)) continue;
      DIRECT_RENDER_RE.lastIndex = 0;
      // Tally class names BEFORE rewrite (for the summary log)
      const matches = body.match(DIRECT_RENDER_RE) || [];
      for (const m of matches) {
        const cm = m.match(/customJS\.([A-Z][A-Za-z0-9_]*)\.render/);
        if (cm) classCounts[cm[1]] = (classCounts[cm[1]] || 0) + 1;
      }
      DIRECT_RENDER_RE.lastIndex = 0;
      const { body: out, touched } = _rewriteAnyDirectRenderCall(body);
      if (touched === 0 || out === body) continue;
      // Snapshot before write
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, out);
      rewritten++;
      callsReplaced += touched;
      history?.push({ event: "info", step: "customjs_guard_migration", name: "platform",
        action: "rewrote", path: fp, callsReplaced: touched, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "customjs_guard_migration", name: "platform",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "customjs_guard_migration", name: "platform",
    summary: { scanned, rewritten, callsReplaced, classCounts },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyFinanceUnifiedNavMigration — v0.111.0. Collapses every existing
// FinanceHubActions and FinanceNavRow invocation in vault notes to the
// single-line context-aware FinanceNav form. FinanceNav reads dv.current()
// to decide what to render (top-hub / sub-hub / entity) — no args needed
// from the note.
//
// Patterns matched (recursive .md walk under spice/finance/):
//
//   await dv.view("ranch/views/customjs-guard", { class: "FinanceHubActions"<balanced>});
//   await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
//   await customJS.FinanceHubActions.render(dv,<balanced>);
//   await customJS.FinanceNavRow.render(dv);
//
// All four rewritten to:
//
//   await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
//
// Idempotent — guard-form FinanceNav calls are not matched. Per-file
// failure-loud + .sauce-backup snapshot before write.
async function applyFinanceUnifiedNavMigration(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const financeRoot = "spice/finance";
  if (!(await adapter.exists(financeRoot))) {
    history?.push({ event: "info", step: "finance_unified_nav_migration", name: "finance",
      summary: { scanned: 0, rewritten: 0, callsReplaced: 0 },
      reason: "spice/finance/ absent; nothing to migrate",
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      completed_at: new Date().toISOString() });
    return;
  }

  // Match guard-form invocations: dv.view("...customjs-guard", { class: "X", ... });
  // where X is FinanceHubActions or FinanceNavRow, including multi-line args.
  // Uses balanced-bracket counting via a non-greedy match up to `});`.
  const GUARD_FORM_RE = /await\s+dv\.view\("[^"]*customjs-guard"\s*,\s*\{\s*class:\s*"(FinanceHubActions|FinanceNavRow)"[\s\S]*?\}\s*\)\s*;?/g;
  // Match direct-form invocations: customJS.FinanceHubActions.render(dv, {...});
  // or customJS.FinanceNavRow.render(dv);
  const DIRECT_FORM_RE = /await\s+customJS\.(FinanceHubActions|FinanceNavRow)\.render\(\s*dv\s*(?:,\s*\{[\s\S]*?\})?\s*\)\s*;?/g;

  const REPLACEMENT = `await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });`;

  // Match a dataviewjs FENCE containing a FinanceNav call. Used after
  // rewriting to collapse consecutive FinanceNav fences.
  const FINANCE_NAV_FENCE_RE = /```dataviewjs\s*\n(?:[^`]*?)await\s+dv\.view\("[^"]*customjs-guard"\s*,\s*\{\s*class:\s*"FinanceNav"\s*\}\s*\)\s*;?\s*\n```/g;

  function _rewriteUnifiedNav(body) {
    let touched = 0;
    let out = body.replace(GUARD_FORM_RE, () => { touched++; return REPLACEMENT; });
    out = out.replace(DIRECT_FORM_RE, () => { touched++; return REPLACEMENT; });
    // v0.111.3 dedup: when a file had BOTH a FinanceHubActions block AND a
    // FinanceNavRow block, the rewrite above produced two FinanceNav fences
    // back-to-back. Collapse to one (keeps the first, which usually carries
    // the installer-managed entity-create:<id> comment).
    const dupRe = new RegExp(FINANCE_NAV_FENCE_RE.source + "\\s*" + FINANCE_NAV_FENCE_RE.source, "g");
    let prevLen;
    do {
      prevLen = out.length;
      out = out.replace(dupRe, (m) => {
        touched++;
        const first = m.match(FINANCE_NAV_FENCE_RE);
        return first ? first[0] : m;
      });
    } while (out.length !== prevLen);
    return { body: out, touched };
  }

  async function _walkMd(dir, files = []) {
    try {
      const listing = await adapter.list(dir);
      for (const fp of (listing.files || [])) {
        if (fp.endsWith(".md")) files.push(fp);
      }
      for (const sub of (listing.folders || [])) {
        await _walkMd(sub, files);
      }
    } catch (_e) { /* skip */ }
    return files;
  }

  const files = await _walkMd(financeRoot);
  if (files.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let scanned = 0;
  let rewritten = 0;
  let callsReplaced = 0;

  for (const fp of files) {
    scanned++;
    try {
      const body = await adapter.read(fp);
      // Cheap precheck: skip files that don't even mention the legacy classes.
      if (!/FinanceHubActions|FinanceNavRow/.test(body)) continue;
      const { body: out, touched } = _rewriteUnifiedNav(body);
      if (touched === 0 || out === body) continue;
      // Snapshot
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, out);
      rewritten++;
      callsReplaced += touched;
      history?.push({ event: "info", step: "finance_unified_nav_migration", name: "finance",
        action: "rewrote", path: fp, callsReplaced: touched, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_unified_nav_migration", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_unified_nav_migration", name: "finance",
    summary: { scanned, rewritten, callsReplaced },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyFinancePaycheckBodyMigration — v0.107.0 CF-3 (finance 0.5.3). Heals
// pre-v0.5.3 paycheck bodies (created from the older Paycheck Template):
//
//   1. Injects the PaycheckSummary dataviewjs block (guarded by
//      `<!-- paycheck-summary-v0.5.3 -->` marker) immediately after the
//      FinanceStatus.renderBadge block — so the three-band rollup renders at
//      the top of every Paycheck note, including ones created before 0.5.3.
//   2. Removes the `## Expenses` heading line (post-0.5.3 the editor stands
//      on its own).
//
// Mirrors applyFinanceBudgetBodyMigration / _migrateBudgetBody from CF-2.
// Body-text mutation only. Idempotent — marker-guarded. Failure-loud per file.
async function applyFinancePaycheckBodyMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const paychecksRoot = "spice/finance/paychecks";
  if (!(await adapter.exists(paychecksRoot))) return;

  const paycheckFiles = [];
  try {
    const top = await adapter.list(paychecksRoot);
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Paycheck-\d{4}-\d{2}-\d{2}\.md$/.test(fp)) paycheckFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_body_migration", name: "finance",
      reason: `list failed for ${paychecksRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (paycheckFiles.length === 0) return;

  let touched = 0;
  for (const fp of paycheckFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _migratePaycheckBody(body);
      if (result.touched) {
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_paycheck_body_migration", name: "finance",
        reason: `paycheck body migration failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_paycheck_body_migration", name: "finance",
    reason: `${paycheckFiles.length} paychecks scanned, ${touched} bodies migrated (PaycheckSummary block injected; ## Expenses heading removed)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _migratePaycheckBody — pure body transform. Idempotent. Marker-guarded.
function _migratePaycheckBody(body) {
  let out = body;
  let touched = false;

  const MARKER = "<!-- paycheck-summary-v0.5.3 -->";
  if (!out.includes(MARKER) && !/customJS\.PaycheckSummary|class:\s*["']PaycheckSummary["']/.test(out)) {
    const badgeBlockRe = /(```dataviewjs\s*\n[^`]*FinanceStatus\.renderBadge[^`]*```\s*\n)/;
    const m = out.match(badgeBlockRe);
    const summaryBlock = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "PaycheckSummary" });\n\`\`\`\n\n`;
    if (m) {
      out = out.replace(badgeBlockRe, `$1\n${summaryBlock}`);
      touched = true;
    } else {
      const fmEnd = out.indexOf("---\n", 4);
      if (fmEnd !== -1) {
        const cutIdx = fmEnd + 4;
        out = out.slice(0, cutIdx) + `\n${summaryBlock}` + out.slice(cutIdx);
        touched = true;
      }
    }
  }

  if (/^## Expenses\s*$/m.test(out)) {
    out = out.replace(/^## Expenses\s*\n\n?/m, "");
    touched = true;
  }

  return { body: out, touched };
}

// applyFinanceBudgetBodyMigration — v0.107.0 CF-2 (finance 0.5.2). Heals
// pre-v0.107.0 budget bodies that were created from the older Budget Template:
//
//   1. Injects the BudgetSummary dataviewjs block (guarded by
//      `<!-- budget-summary-v0.5.2 -->` marker) immediately after the
//      FinanceStatus.renderBadge block — so the three-band rollup renders at
//      the top of every Budget note, including ones created before v0.107.0.
//   2. Removes the `## Categories` heading line (post-v0.5.2 the editor stands
//      on its own; the section heading was redundant).
//
// Body-text mutation only (no frontmatter change). Idempotent — guarded by the
// HTML comment marker. Per-file failure-loud.
async function applyFinanceBudgetBodyMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) return;

  const budgetFiles = [];
  try {
    const top = await adapter.list(budgetsRoot);
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Budget-\d{4}-\d{2}\.md$/.test(fp)) budgetFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_budget_body_migration", name: "finance",
      reason: `list failed for ${budgetsRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (budgetFiles.length === 0) return;

  let touched = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _migrateBudgetBody(body);
      if (result.touched) {
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_body_migration", name: "finance",
        reason: `body migration failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_budget_body_migration", name: "finance",
    reason: `${budgetFiles.length} budgets scanned, ${touched} bodies migrated (BudgetSummary block injected; ## Categories heading removed)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _migrateBudgetBody — pure body transform. Idempotent.
//   • Inserts BudgetSummary dataviewjs block (marker-guarded) immediately after
//     the FinanceStatus.renderBadge block if absent.
//   • Removes the `## Categories` heading line (matches `^## Categories$`).
function _migrateBudgetBody(body) {
  let out = body;
  let touched = false;

  // 1. Inject BudgetSummary block if marker absent.
  const SUMMARY_MARKER = "<!-- budget-summary-v0.5.2 -->";
  if (!out.includes(SUMMARY_MARKER) && !/customJS\.BudgetSummary|class:\s*["']BudgetSummary["']/.test(out)) {
    // Insert after the FinanceStatus.renderBadge dataviewjs block. Match the
    // block and capture its trailing ```. If not found, fall back to after the
    // frontmatter close.
    const badgeBlockRe = /(```dataviewjs\s*\n[^`]*FinanceStatus\.renderBadge[^`]*```\s*\n)/;
    const m = out.match(badgeBlockRe);
    const summaryBlock = `${SUMMARY_MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "BudgetSummary" });\n\`\`\`\n\n`;
    if (m) {
      out = out.replace(badgeBlockRe, `$1\n${summaryBlock}`);
      touched = true;
    } else {
      // Fallback: inject after the closing `---` of frontmatter.
      const fmEnd = out.indexOf("---\n", 4);
      if (fmEnd !== -1) {
        const cutIdx = fmEnd + 4;
        out = out.slice(0, cutIdx) + `\n${summaryBlock}` + out.slice(cutIdx);
        touched = true;
      }
    }
  }

  // 2. Remove `## Categories` heading line (and any trailing blank line right after).
  if (/^## Categories\s*$/m.test(out)) {
    out = out.replace(/^## Categories\s*\n\n?/m, "");
    touched = true;
  }

  return { body: out, touched };
}

// ============================================================================
// applyFinanceBudgetMonthlyBandInjection — v0.110.3 (finance 0.6.3). Injects
// the MonthlyOverview dataviewjs block (marker-guarded by
// `<!-- monthly-overview-v0.6.3 -->`) immediately ABOVE the BudgetSummary block
// on every Budget-YYYY-MM.md. Body-text mutation only. Idempotent — marker
// presence short-circuits. Per-file failure-loud via history warning events.
// Mirrors applyFinanceBudgetBodyMigration / _migrateBudgetBody posture.
// ============================================================================
async function applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) return;

  const budgetFiles = [];
  try {
    const top = await adapter.list(budgetsRoot);
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Budget-\d{4}-\d{2}\.md$/.test(fp)) budgetFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_budget_monthly_band_injection", name: "finance",
      reason: `list failed for ${budgetsRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (budgetFiles.length === 0) return;

  let touched = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _injectMonthlyBand(body);
      if (result.touched) {
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_monthly_band_injection", name: "finance",
        reason: `body migration failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_budget_monthly_band_injection", name: "finance",
    reason: `${budgetFiles.length} budgets scanned, ${touched} bodies injected (MonthlyOverview block above BudgetSummary)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _injectMonthlyBand — pure body transform. Idempotent. Marker-guarded.
//   Anchor priority:
//     1. `<!-- budget-summary-v... -->` marker line → inject BEFORE.
//     2. BudgetSummary dataviewjs block → inject BEFORE.
//     3. FinanceStatus.renderBadge block → inject AFTER.
//     4. Frontmatter close → inject AFTER.
function _injectMonthlyBand(body) {
  let out = body;
  let touched = false;

  const MARKER = "<!-- monthly-overview-v0.6.3 -->";
  if (out.includes(MARKER)) return { body: out, touched: false };
  if (/customJS\.MonthlyOverview|class:\s*["']MonthlyOverview["']/.test(out)) {
    return { body: out, touched: false };
  }

  const overviewBlock = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MonthlyOverview" });\n\`\`\`\n\n`;

  const summaryMarkerRe = /(<!--\s*budget-summary-v[\d.]+\s*-->\s*\n)/;
  const sm = out.match(summaryMarkerRe);
  if (sm) {
    out = out.replace(summaryMarkerRe, `${overviewBlock}$1`);
    return { body: out, touched: true };
  }

  const summaryBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']BudgetSummary["'][^`]*```\s*\n)/;
  const sb = out.match(summaryBlockRe);
  if (sb) {
    out = out.replace(summaryBlockRe, `${overviewBlock}$1`);
    return { body: out, touched: true };
  }

  const badgeBlockRe = /(```dataviewjs\s*\n[^`]*FinanceStatus\.renderBadge[^`]*```\s*\n)/;
  const bb = out.match(badgeBlockRe);
  if (bb) {
    out = out.replace(badgeBlockRe, `$1\n${overviewBlock}`);
    return { body: out, touched: true };
  }

  const fmEnd = out.indexOf("---\n", 4);
  if (fmEnd !== -1) {
    const cutIdx = fmEnd + 4;
    out = out.slice(0, cutIdx) + `\n${overviewBlock}` + out.slice(cutIdx);
    return { body: out, touched: true };
  }

  return { body: out, touched };
}

// _backfillBudgetGroupsFromText — pure string transform on Budget-*.md body.
// Append-only:
//   • Inserts `groups: []` into top-level frontmatter if absent (placed before
//     `created_at:` if present, else appended to the frontmatter block).
//   • Walks the `categories:` YAML block-list and inserts
//     `    group: Unassigned` into each item that lacks a `group:` key.
//     Items without `group:` are detected by checking ALL their continuation
//     lines (lines indented with 4 spaces immediately following the `  - `
//     start line).
// Returns { body, touched, added }. Never alters existing values; never
// throws on malformed YAML. Mirrors _migrateDocNote / _migrateProjectSectionsToWikilinks
// regex-based mutation posture so the migration survives headless install
// (no Obsidian runtime; no processFrontMatter).
function _backfillBudgetGroupsFromText(body) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, added: 0 };

  let fm = fmMatch[1];
  let touched = false;
  let added = 0;

  // 1. Insert `groups: []` top-level if absent. Match both `^groups:$` (block
  // form coming) and `^groups: [` (flow form already present).
  if (!/^groups:\s*$/m.test(fm) && !/^groups:\s*\[/m.test(fm)) {
    if (/^created_at:/m.test(fm)) {
      fm = fm.replace(/^created_at:/m, "groups: []\ncreated_at:");
    } else {
      fm = fm + "\ngroups: []";
    }
    touched = true;
  }

  // 2. Walk `categories:` block-list items. For each item missing a
  // `    group:` sub-key, insert `    group: Unassigned` right after the
  // item's `  - ...` start line.
  const fmLines = fm.split("\n");
  const isItemStart = (line) => /^  - /.test(line);
  const isItemContinuation = (line) => /^\s{4,}\S/.test(line);

  let i = 0;
  while (i < fmLines.length) {
    if (/^categories:\s*$/.test(fmLines[i])) {
      // Begin categories block. Walk forward.
      i++;
      while (i < fmLines.length) {
        if (isItemStart(fmLines[i])) {
          // Collect item's continuation lines.
          const itemStartIdx = i;
          let j = i + 1;
          while (j < fmLines.length && isItemContinuation(fmLines[j])) j++;
          // Check if this item has `group:` already.
          let hasGroup = false;
          for (let k = itemStartIdx; k < j; k++) {
            if (/^    group:\s/.test(fmLines[k]) || /^  - group:\s/.test(fmLines[k])) {
              hasGroup = true;
              break;
            }
          }
          if (!hasGroup) {
            // Insert immediately after the item's first line.
            fmLines.splice(itemStartIdx + 1, 0, "    group: Unassigned");
            added += 1;
            touched = true;
            j += 1; // account for inserted line
          }
          i = j;
        } else if (fmLines[i] === "" || /^  /.test(fmLines[i])) {
          // Blank line or other indented content inside categories block — skip.
          i++;
        } else {
          // Dedented line — categories block ended.
          break;
        }
      }
    } else {
      i++;
    }
  }

  if (!touched) return { body, touched: false, added: 0 };

  const newFm = fmLines.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, added };
}

async function applyFinanceDefaultsScaffolding(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const moduleDir = "spice/finance";
  if (!(await adapter.exists(moduleDir))) {
    history?.push({ event: "info", step: "finance_defaults_scaffolding", name: "finance",
      reason: `module dir ${moduleDir} absent — nothing to scaffold`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  const budgetDefaultsPath = `${moduleDir}/Budget Defaults.md`;
  const paycheckDefaultsPath = `${moduleDir}/Paycheck Defaults.md`;

  let created = 0, preserved = 0;

  try {
    if (!(await adapter.exists(budgetDefaultsPath))) {
      await adapter.write(budgetDefaultsPath, FINANCE_BUDGET_DEFAULTS_CONTENT);
      created += 1;
    } else {
      preserved += 1;
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_defaults_scaffolding", name: "finance",
      reason: `Budget Defaults.md scaffold failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }

  try {
    if (!(await adapter.exists(paycheckDefaultsPath))) {
      await adapter.write(paycheckDefaultsPath, FINANCE_PAYCHECK_DEFAULTS_CONTENT);
      created += 1;
    } else {
      preserved += 1;
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_defaults_scaffolding", name: "finance",
      reason: `Paycheck Defaults.md scaffold failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }

  history?.push({ event: "info", step: "finance_defaults_scaffolding", name: "finance",
    reason: `defaults: ${created} created, ${preserved} preserved`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

async function applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) {
    history?.push({ event: "info", step: "finance_categories_group_backfill", name: "finance",
      reason: `budgets root ${budgetsRoot} absent — nothing to backfill`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  // Walk all Budget-<YYYY-MM>.md files (one per month-folder).
  const budgetFiles = [];
  try {
    const top = await adapter.list(budgetsRoot);
    const monthFolders = (top.folders || []);
    for (const folder of monthFolders) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Budget-\d{4}-\d{2}\.md$/.test(fp)) budgetFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud, continue */ }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_categories_group_backfill", name: "finance",
      reason: `list failed for ${budgetsRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (budgetFiles.length === 0) {
    history?.push({ event: "info", step: "finance_categories_group_backfill", name: "finance",
      reason: `no Budget-*.md files to backfill`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  // Pre-write snapshot. Mirrors v0.101.0 Safeguard-1 pattern. Files copied
  // BEFORE any frontmatter mutation; one timestamped directory per install run.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = `.sauce-backup/${ts}/spice/finance/budgets`;
  let snapshots = 0;
  for (const fp of budgetFiles) {
    try {
      const rel = fp.substring(budgetsRoot.length); // "/<YYYY-MM>/Budget-<YYYY-MM>.md"
      const backupPath = backupRoot + rel;
      const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
      if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
      const body = await adapter.read(fp);
      await adapter.write(backupPath, body);
      snapshots += 1;
    } catch (e) {
      history?.push({ event: "warning", step: "finance_categories_group_backfill", name: "finance",
        reason: `snapshot failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  // Backfill via regex-based YAML mutation. The install runs headless (no
  // Obsidian runtime), so tp.app.fileManager.processFrontMatter is unavailable —
  // mirror the _migrateDocNote pattern (v0.103.0): adapter.read + body-text
  // mutation + adapter.write. Append-only — groups/category.group are added
  // only if missing; existing values are NEVER altered. Same data-preservation
  // semantics as processFrontMatter would have provided.
  let touched = 0, backfilled = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _backfillBudgetGroupsFromText(body);
      if (result.touched) {
        await adapter.write(fp, result.body);
        touched += 1;
        backfilled += result.added;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_categories_group_backfill", name: "finance",
        reason: `backfill failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_categories_group_backfill", name: "finance",
    reason: `${budgetFiles.length} budgets scanned, ${snapshots} snapshotted, ${touched} touched, ${backfilled} categories backfilled to "Unassigned"; 0 categories modified beyond add; snapshot at ${backupRoot}`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// ============================================================================
// v0.108.0 S2 — applyFinanceDebtScaffolding
//
// Create-if-absent for the debt sub-area:
//   • spice/finance/debts/              (folder)
//   • spice/finance/debts/Debts.md      (hub note)
//   • spice/finance/Debt Defaults.md    (empty debts: [])
//
// Never overwrites existing files — idempotent on re-runs. Mirrors
// applyFinanceDefaultsScaffolding posture from v0.107.0.

async function applyFinanceDebtScaffolding(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const debtsRoot = "spice/finance/debts";
  const debtsHubPath = `${debtsRoot}/Debts.md`;
  const debtDefaultsPath = "spice/finance/Debt Defaults.md";

  let created = 0;
  let preserved = 0;

  // 1. Ensure debts folder exists.
  if (!(await adapter.exists(debtsRoot))) {
    try {
      await adapter.mkdir(debtsRoot);
    } catch (e) {
      history?.push({ event: "warning", step: "finance_debt_scaffolding", name: "finance",
        reason: `mkdir failed for ${debtsRoot}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
  }

  // 2. Debts.md hub
  if (await adapter.exists(debtsHubPath)) {
    preserved++;
  } else {
    try {
      await adapter.write(debtsHubPath, FINANCE_DEBTS_HUB_TEMPLATE);
      created++;
      history?.push({ event: "info", step: "finance_debt_scaffolding", name: "finance",
        action: "created", path: debtsHubPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_debt_scaffolding", name: "finance",
        reason: `write failed for ${debtsHubPath}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  // 3. Debt Defaults.md
  if (await adapter.exists(debtDefaultsPath)) {
    preserved++;
  } else {
    try {
      await adapter.write(debtDefaultsPath, FINANCE_DEBT_DEFAULTS_TEMPLATE);
      created++;
      history?.push({ event: "info", step: "finance_debt_scaffolding", name: "finance",
        action: "created", path: debtDefaultsPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_debt_scaffolding", name: "finance",
        reason: `write failed for ${debtDefaultsPath}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  // 4. NEW v0.110.0 — iterate Debt Defaults debts[] and create-if-absent each Debt-<slug>.md.
  // This lets users populate Debt Defaults at any time; the next install auto-scaffolds
  // entities for any new rows. Existing Debt-*.md files are never overwritten.
  let entitiesCreated = 0;
  let entitiesPreserved = 0;
  try {
    if (await adapter.exists(debtDefaultsPath)) {
      const defaultsBody = await adapter.read(debtDefaultsPath);
      const defaultsFm = _parseFrontmatterStrict(defaultsBody);
      const debts = Array.isArray(defaultsFm?.debts) ? defaultsFm.debts : [];
      const todayIso = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();
      for (const debt of debts) {
        if (!debt || typeof debt.name !== "string" || debt.name.length === 0) continue;
        const slug = debt.name.replace(/\s+/g, "-").replace(/[^A-Za-z0-9-]/g, "");
        if (slug.length === 0) continue;
        const entityPath = `${debtsRoot}/Debt-${slug}.md`;
        if (await adapter.exists(entityPath)) { entitiesPreserved++; continue; }
        const kind = debt.kind || "credit-card";
        const balance = Number(debt.current_balance) || 0;
        const limit = debt.credit_limit !== undefined ? Number(debt.credit_limit) : null;
        const apr = Number(debt.apr) || 0;
        const minPay = Number(debt.min_payment) || 0;
        const planned = Number(debt.planned_monthly_payment) || 0;
        const url = typeof debt.url === "string" ? debt.url : "";
        const opened = debt.opened_date || null;
        const entityFm = `---
type: debt
kind: ${kind}
name: ${JSON.stringify(debt.name)}
current_balance: ${balance}
${limit !== null ? `credit_limit: ${limit}\n` : ""}apr: ${apr}
min_payment: ${minPay}
planned_monthly_payment: ${planned}
url: ${JSON.stringify(url)}
opened_date: ${opened === null ? "null" : opened}
last_updated: ${todayIso}
balance_history:
  - { date: ${todayIso}, balance: ${balance}, source: install-seed }
created_at: "${nowIso}"
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNavRow" });
\`\`\`

<!-- debt-summary-v0.6.0 -->
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtSummary" });
\`\`\`
`;
        try {
          await adapter.write(entityPath, entityFm);
          entitiesCreated++;
          history?.push({ event: "info", step: "finance_debt_scaffolding", name: "finance",
            action: "created_entity", path: entityPath,
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString() });
        } catch (e) {
          history?.push({ event: "warning", step: "finance_debt_scaffolding", name: "finance",
            reason: `write failed for ${entityPath}: ${e.message}`,
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString() });
        }
      }
    }
  } catch (e) {
    history?.push({ event: "warning", step: "finance_debt_scaffolding", name: "finance",
      reason: `defaults iteration failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }

  history?.push({ event: "info", step: "finance_debt_scaffolding", name: "finance",
    summary: { created, preserved, entitiesCreated, entitiesPreserved },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// v0.108.0 S2 — applyFinanceBudgetGroupSeed + helpers
//
// CF-3 polish #6+#7. Seeds groups[] on every Budget-*.md from current Budget
// Defaults; name-matches Unassigned categories to their defaults-declared group.
// Append-only, marker-guarded (__group_seed_migrated: v0.108.0), .sauce-backup
// snapshot before write. Headless-safe: adapter.read + regex YAML mutation.

// _parseFrontmatterStrict — minimal strict parser for installer headless context.
// Returns plain object with top-level scalar/array values, or null on failure.
// Handles: scalar strings/numbers/booleans, flow arrays `[...]`, block-list arrays.
// Does NOT handle: nested objects, inline tables, multiline strings.
function _parseFrontmatterStrict(body) {
  if (typeof body !== "string") return null;
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const raw = m[1];
  const result = {};
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Top-level key: value
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
    if (!kvMatch) { i++; continue; }
    const key = kvMatch[1];
    const rest = kvMatch[2].trim();
    // Flow array
    if (rest.startsWith("[")) {
      try {
        // Allow simple flow arrays: [item, item] or [] — single-line only
        const json = rest.replace(/'/g, '"');
        result[key] = JSON.parse(json);
      } catch (_) { result[key] = []; }
      i++;
      continue;
    }
    // Empty (block form follows) or block array
    if (rest === "") {
      const arr = [];
      let j = i + 1;
      while (j < lines.length && /^  - /.test(lines[j])) {
        // Each block-list item may be an object or scalar
        const itemStart = lines[j].replace(/^  - /, "").trim();
        const obj = {};
        if (itemStart.includes(":")) {
          // First key of inline object on the `  - ` line
          const [k, ...vParts] = itemStart.split(":");
          obj[k.trim()] = vParts.join(":").trim();
        } else if (itemStart !== "") {
          arr.push(itemStart);
          j++;
          continue;
        }
        // Read continuation object lines (4-space indent)
        let k2 = j + 1;
        while (k2 < lines.length && /^    \S/.test(lines[k2])) {
          const contMatch = lines[k2].match(/^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
          if (contMatch) obj[contMatch[1]] = contMatch[2].trim();
          k2++;
        }
        arr.push(obj);
        j = k2;
      }
      if (j > i + 1) {
        result[key] = arr;
        i = j;
      } else {
        // Check if it's just empty
        result[key] = arr.length > 0 ? arr : null;
        i++;
      }
      continue;
    }
    // Scalar
    result[key] = rest;
    i++;
  }
  return result;
}

// _listBudgetFiles — walk spice/finance/budgets/<YYYY-MM>/Budget-<YYYY-MM>.md.
// Returns array of relative file paths. Per-folder failure-loud (skip folder).
async function _listBudgetFiles(adapter, budgetsRoot) {
  const budgetFiles = [];
  try {
    const top = await adapter.list(budgetsRoot);
    const monthFolders = (top.folders || []);
    for (const folder of monthFolders) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/Budget-\d{4}-\d{2}\.md$/.test(fp)) budgetFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud, continue */ }
    }
  } catch (_e) { /* root list failed — return empty */ }
  return budgetFiles;
}

// _seedBudgetGroups — pure string transform on Budget-*.md body.
// Seeds groups[] from defaultGroupsArr if currently empty.
// For each category with group: Unassigned, name-matches against catToGroup
// (Map: name.toLowerCase() -> group string).
// Appends __group_seed_migrated: v0.108.0 marker to frontmatter.
// Returns { body, touched, seededGroups, reassignedCats }.
function _seedBudgetGroups(body, defaultGroupsArr, catToGroup) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, seededGroups: 0, reassignedCats: 0 };

  let fm = fmMatch[1];
  let touched = false;
  let seededGroups = 0;
  let reassignedCats = 0;

  // 1. If groups: [] (empty flow array) or groups: (empty block): seed from defaults.
  const emptyFlowGroups = /^groups:\s*\[\s*\]\s*$/m.test(fm);
  const emptyBlockGroups = /^groups:\s*$/.test(fm) && !fm.match(/^groups:\s*\n  - /m);
  if ((emptyFlowGroups || emptyBlockGroups) && defaultGroupsArr.length > 0) {
    // Serialize defaultGroupsArr as block YAML list of strings
    const serialized = defaultGroupsArr.map(g => `  - ${g}`).join("\n");
    const blockForm = `groups:\n${serialized}`;
    if (emptyFlowGroups) {
      fm = fm.replace(/^groups:\s*\[\s*\]\s*$/m, blockForm);
    } else {
      fm = fm.replace(/^groups:\s*$/m, blockForm);
    }
    seededGroups = defaultGroupsArr.length;
    touched = true;
  }

  // 2. Reassign categories with group: Unassigned.
  if (catToGroup.size > 0) {
    // Walk frontmatter lines looking for categories block
    const fmLines = fm.split("\n");
    const isItemStart = (line) => /^  - /.test(line);
    const isItemContinuation = (line) => /^\s{4,}\S/.test(line);
    let inCategories = false;
    let i = 0;
    while (i < fmLines.length) {
      if (/^categories:\s*$/.test(fmLines[i])) {
        inCategories = true;
        i++;
        continue;
      }
      if (inCategories) {
        if (isItemStart(fmLines[i])) {
          // Find item name and group within the item block
          const itemStartIdx = i;
          let j = i + 1;
          while (j < fmLines.length && isItemContinuation(fmLines[j])) j++;
          // Look for name: and group: within [itemStartIdx..j)
          let itemName = null;
          let groupLineIdx = -1;
          for (let k = itemStartIdx; k < j; k++) {
            const namM = fmLines[k].match(/(?:^  - name:|^    name:)\s*(.*)/);
            if (namM) itemName = namM[1].trim();
            if (/(?:^    group:|^  - group:)\s*Unassigned\s*$/.test(fmLines[k])) {
              groupLineIdx = k;
            }
          }
          if (groupLineIdx >= 0 && itemName) {
            const matchedGroup = catToGroup.get(itemName.toLowerCase());
            if (matchedGroup) {
              fmLines[groupLineIdx] = fmLines[groupLineIdx].replace(/Unassigned\s*$/, matchedGroup);
              reassignedCats++;
              touched = true;
            }
          }
          i = j;
          continue;
        } else if (fmLines[i] === "" || /^  /.test(fmLines[i])) {
          i++;
          continue;
        } else {
          inCategories = false;
        }
      }
      i++;
    }
    if (reassignedCats > 0) fm = fmLines.join("\n");
  }

  // 3. Append idempotency marker if we touched anything.
  if (touched) {
    fm = fm + "\n__group_seed_migrated: v0.108.0";
    const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
    return { body: newBody, touched: true, seededGroups, reassignedCats };
  }

  return { body, touched: false, seededGroups: 0, reassignedCats: 0 };
}

async function applyFinanceBudgetGroupSeed(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) return;

  // Read Budget Defaults
  const defaultsPath = "spice/finance/Budget Defaults.md";
  if (!(await adapter.exists(defaultsPath))) return;
  let defaultsBody;
  try { defaultsBody = await adapter.read(defaultsPath); } catch (_e) { return; }
  const defaults = _parseFrontmatterStrict(defaultsBody);
  if (!defaults || !Array.isArray(defaults.groups) || !Array.isArray(defaults.categories)) return;
  if (defaults.groups.length === 0) return;  // nothing to seed from

  // Walk all Budget-*.md
  const budgetFiles = await _listBudgetFiles(adapter, budgetsRoot);
  if (budgetFiles.length === 0) return;

  // Build category name -> group map from defaults (case-insensitive)
  const catToGroup = new Map();
  for (const c of defaults.categories) {
    if (c && typeof c === "object" && c.name && c.group) {
      catToGroup.set(String(c.name).toLowerCase(), c.group);
    }
  }

  // Snapshot before any mutation — use inline pattern matching applyFinanceCategoriesGroupBackfill
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = `.sauce-backup/${ts}/spice/finance/budgets`;
  let groupsSeeded = 0;
  let categoriesReassigned = 0;

  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      if (/__group_seed_migrated:\s*v0\.108\.0/.test(body)) continue;  // idempotency
      const { body: out, touched, seededGroups, reassignedCats } =
        _seedBudgetGroups(body, defaults.groups, catToGroup);
      if (!touched) continue;
      // Snapshot before write
      try {
        const rel = fp.substring(budgetsRoot.length);
        const backupPath = backupRoot + rel;
        const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(backupPath, body);
      } catch (e) {
        history?.push({ event: "warning", step: "finance_budget_group_seed", name: "finance",
          path: fp, reason: `snapshot failed: ${e.message}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
      }
      await adapter.write(fp, out);
      groupsSeeded += seededGroups;
      categoriesReassigned += reassignedCats;
      history?.push({ event: "info", step: "finance_budget_group_seed", name: "finance",
        path: fp, seededGroups, reassignedCats,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_group_seed", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_budget_group_seed", name: "finance",
    summary: { groupsSeeded, categoriesReassigned, scanned: budgetFiles.length },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// v0.108.0 S2 — applyFinancePaycheckDefaultsDebtLinking + helper
//
// Appends debt: "[[Debt-X]]" wikilinks to CC-payment rows in Paycheck Defaults.
// Strips inline url: from those rows (debt entity is now canonical for the URL).
// Idempotent via __debt_links_migrated: v0.108.0 top-level marker.
// .sauce-backup snapshot before write. Headless-safe: adapter.read + regex YAML.

// CC payment item name patterns for matching expense rows
const CC_NAME_RE = /\b(Apple\s+Card|Cap1?\s*Platinum|Cap1?\s*Quicksilver|Discover(\s+it)?|FNBO|SCHEELS?\s+(Signature|Visa)?|Brex(\s+Card)?)\b/i;

// _linkPaycheckDefaultsDebt — pure string transform on Paycheck Defaults body.
// For each expense row in the frontmatter expenses[] block whose item: matches
// CC_NAME_RE AND can be matched to a debt entity by name, injects
// `      debt: "[[Debt-<slug>]]"` and removes the `      url: ...` line.
// Appends __debt_links_migrated: v0.108.0 top-level marker.
// Returns { body, touched, linked, urlsStripped }.
function _linkPaycheckDefaultsDebt(body, nameToSlugMap) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, linked: 0, urlsStripped: 0 };

  const fmLines = fmMatch[1].split("\n");
  let touched = false;
  let linked = 0;
  let urlsStripped = 0;

  const isItemStart = (line) => /^  - /.test(line);
  const isItemContinuation = (line) => /^\s{4,}\S/.test(line);
  let inExpenses = false;
  let i = 0;

  while (i < fmLines.length) {
    if (/^expenses:\s*$/.test(fmLines[i])) {
      inExpenses = true;
      i++;
      continue;
    }
    if (inExpenses) {
      if (isItemStart(fmLines[i])) {
        const itemStartIdx = i;
        let j = i + 1;
        while (j < fmLines.length && isItemContinuation(fmLines[j])) j++;

        // Collect item lines [itemStartIdx..j)
        const itemLines = fmLines.slice(itemStartIdx, j);
        // Find item: value
        let itemName = null;
        for (const il of itemLines) {
          const m = il.match(/(?:^  - item:|^    item:)\s*(.*)/);
          if (m) { itemName = m[1].trim().replace(/^["']|["']$/g, ""); break; }
        }

        if (itemName && CC_NAME_RE.test(itemName)) {
          // Try to match debt by longest name substring
          let bestSlug = null;
          let bestLen = 0;
          for (const [debtName, slug] of nameToSlugMap.entries()) {
            const debtNameClean = debtName.replace(/\s+payment$/i, "").toLowerCase();
            const itemNameLower = itemName.toLowerCase();
            if (itemNameLower.includes(debtNameClean) && debtNameClean.length > bestLen) {
              bestLen = debtNameClean.length;
              bestSlug = slug;
            }
          }

          if (bestSlug) {
            // Check if debt: already present on this item
            const alreadyLinked = itemLines.some(il => /^    debt:\s/.test(il) || /^  - debt:\s/.test(il));
            if (!alreadyLinked) {
              // Insert debt: after the item's first line; remove url: line
              const newLines = [];
              let insertedDebt = false;
              for (let k = 0; k < itemLines.length; k++) {
                const il = itemLines[k];
                // Skip url: lines from this item
                if (/^    url:\s/.test(il)) {
                  urlsStripped++;
                  touched = true;
                  continue;
                }
                newLines.push(il);
                // After the `  - ` start line, insert debt:
                if (!insertedDebt && /^  - /.test(il)) {
                  newLines.push(`      debt: "[[${bestSlug}]]"`);
                  insertedDebt = true;
                  linked++;
                  touched = true;
                }
              }
              // Splice new lines back
              fmLines.splice(itemStartIdx, j - itemStartIdx, ...newLines);
              j = itemStartIdx + newLines.length;
            }
          }
        }
        i = j;
        continue;
      } else if (fmLines[i] === "" || /^  /.test(fmLines[i])) {
        i++;
        continue;
      } else {
        inExpenses = false;
      }
    }
    i++;
  }

  if (!touched) return { body, touched: false, linked: 0, urlsStripped: 0 };

  // Append idempotency marker
  fmLines.push("__debt_links_migrated: v0.108.0");
  const newFm = fmLines.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, linked, urlsStripped };
}

async function applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const paycheckDefaultsPath = "spice/finance/Paycheck Defaults.md";
  if (!(await adapter.exists(paycheckDefaultsPath))) return;

  let body;
  try { body = await adapter.read(paycheckDefaultsPath); } catch (_e) { return; }
  if (/__debt_links_migrated:\s*v0\.108\.0/.test(body)) return;  // idempotency

  // Walk debt entities to build name -> slug map
  const debtsRoot = "spice/finance/debts";
  if (!(await adapter.exists(debtsRoot))) return;
  let debtListing;
  try { debtListing = await adapter.list(debtsRoot); } catch (_e) { return; }
  const debtFiles = (debtListing.files || []).filter(p => /Debt-[^/]+\.md$/.test(p));
  const debtNameToSlug = new Map();
  for (const dp of debtFiles) {
    try {
      const debtBody = await adapter.read(dp);
      const fm = _parseFrontmatterStrict(debtBody);
      if (!fm || !fm.name) continue;
      // path.basename not available in headless install; parse manually
      const slug = dp.replace(/\\/g, "/").split("/").pop().replace(/\.md$/, "");
      debtNameToSlug.set(String(fm.name).toLowerCase(), slug);
    } catch (_e) { /* per-file failure-loud */ }
  }
  if (debtNameToSlug.size === 0) return;  // no debts yet — nothing to link

  // Snapshot before mutation
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `.sauce-backup/${ts}/spice/finance/Paycheck Defaults.md`;
  const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
  try {
    if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
    await adapter.write(backupPath, body);
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_defaults_debt_linking", name: "finance",
      reason: `snapshot failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }

  const result = _linkPaycheckDefaultsDebt(body, debtNameToSlug);
  if (!result.touched) return;

  try {
    await adapter.write(paycheckDefaultsPath, result.body);
    history?.push({ event: "info", step: "finance_paycheck_defaults_debt_linking", name: "finance",
      summary: { linked: result.linked, urlsStripped: result.urlsStripped },
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_defaults_debt_linking", name: "finance",
      reason: `write failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }
}

// ============================================================================
// v0.114.0 — applyFinancePaycheckDefaultsDebtBackfill
//
// Two-phase migration on `spice/finance/Paycheck Defaults.md`:
//
// PHASE 1 (backfill) — Existing expense items lacking a `debt:` wikilink get
// matched against Debt-*.md entities by word-overlap on item.name vs debt.name.
// Stricter than v0.108.0's applyFinancePaycheckDefaultsDebtLinking (which only
// matched a hardcoded CC_NAME_RE — missed "Capital One Platinum" against
// "Cap1 Platinum" because the debt name uses an abbreviation). On match, inject
// `      debt: "[[Debt-<slug>]]"`.
//
// PHASE 2 (auto-injection) — Any Debt-*.md entity NOT already referenced by
// any expense's debt: wikilink gets appended as a NEW expense row. Uses
// debt.name as item, debt.planned_monthly_payment (or min_payment, or 0) as
// amount, derives category from debt.kind, debt.url as url, paid: false,
// debt: "[[Debt-<slug>]]". This is the auto-discovery the user requested:
// new Debt-*.md entries surface in the next paycheck automatically (via
// seed_from_defaults) without manual Paycheck Defaults maintenance.
//
// Naturally idempotent (no marker needed): both phases short-circuit when no
// work remains. Safe to re-run on every install — that's the feature.
// .sauce-backup snapshot before any write.

const _PCD_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "card", "cards", "loan", "loans",
  "payment", "payments", "credit"
]);

function _pcdTokenize(s) {
  if (typeof s !== "string") return [];
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 3 && !_PCD_STOPWORDS.has(t));
}

function _pcdScoreItemAgainstDebt(itemName, debtName) {
  const itemTokens = new Set(_pcdTokenize(itemName));
  const debtTokens = _pcdTokenize(debtName);
  if (debtTokens.length === 0 || itemTokens.size === 0) return 0;
  let score = 0;
  for (const t of debtTokens) if (itemTokens.has(t)) score++;
  return score;
}

function _pcdBestDebtForItem(itemName, debtList) {
  let best = null;
  let bestScore = 0;
  let bestLen = 0;
  for (const d of debtList) {
    const score = _pcdScoreItemAgainstDebt(itemName, d.name);
    if (score > bestScore || (score === bestScore && score > 0 && d.name.length > bestLen)) {
      bestScore = score;
      bestLen = d.name.length;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

function _pcdCategoryFromDebtKind(kind) {
  if (kind === "credit-card") return "Credit Payment";
  if (kind === "student-loan") return "Student Loans";
  return "Debt Payment";
}

// _pcdBackfillExistingExpenses — PHASE 1 line-level YAML transform.
// Mirrors _linkPaycheckDefaultsDebt's traversal pattern (block-list expenses[]
// with `  - ` start lines and `    ` continuations) so the output stays in the
// existing file's format.
function _pcdBackfillExistingExpenses(body, debtList) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, linked: 0 };
  const fmLines = fmMatch[1].split("\n");
  let touched = false;
  let linked = 0;
  let inExpenses = false;
  let i = 0;
  const isItemStart = (line) => /^  - /.test(line);
  const isItemContinuation = (line) => /^\s{4,}\S/.test(line);

  while (i < fmLines.length) {
    if (/^expenses:\s*$/.test(fmLines[i])) { inExpenses = true; i++; continue; }
    if (inExpenses) {
      if (isItemStart(fmLines[i])) {
        const itemStartIdx = i;
        let j = i + 1;
        while (j < fmLines.length && isItemContinuation(fmLines[j])) j++;
        const itemLines = fmLines.slice(itemStartIdx, j);

        // Parse item name from this block (item: key on either the - line or a continuation).
        let itemName = null;
        let hasDebt = false;
        // v0.115.4: detect inline-form rows (`  - { item: X, ..., debt: "[[Debt-X]]" }`).
        // The prior implementation used a line-anchored `/^\s*debt:\s/` test which
        // missed inline `debt:` keys nested in JSON braces, so inline rows that
        // already had `debt:` set looked debt-less and got duplicate orphan
        // `      debt: "[[Debt-X]]"` lines injected below — producing unparseable
        // YAML. Now: scan the whole item block (joined) for any `debt: "[[...]]"`
        // shape, regardless of inline vs block form.
        const itemBlockText = itemLines.join("\n");
        if (/\bdebt:\s*["']?\[\[/.test(itemBlockText)) hasDebt = true;
        // Inline-form rows are also unsafe targets for separate-line injection —
        // appending `      debt: "[[X]]"` BELOW a `  - { ... }` line breaks YAML
        // because the inline form is a complete single-line YAML node. Flag and
        // skip injection on inline rows even when debt is absent (we'd need to
        // rewrite the row to block form to safely add, which is out of scope here).
        const isInlineForm = itemLines.length === 1 && /^  - \{/.test(itemLines[0]);
        for (const il of itemLines) {
          const im = il.match(/(?:^  - item:|^    item:)\s*(.*)/);
          if (im && !itemName) {
            itemName = im[1].trim().replace(/^["']|["']$/g, "").replace(/,\s*$/, "");
          }
          // Also handle inline-style `  - { item: X, ... }`
          if (!itemName) {
            const inline = il.match(/^  - \{[^}]*item:\s*([^,}]+)/);
            if (inline) itemName = inline[1].trim().replace(/^["']|["']$/g, "");
          }
        }

        if (itemName && !hasDebt && !isInlineForm) {
          const debt = _pcdBestDebtForItem(itemName, debtList);
          if (debt) {
            const newLines = [];
            let insertedDebt = false;
            for (let k = 0; k < itemLines.length; k++) {
              const il = itemLines[k];
              newLines.push(il);
              // Insert debt: line after the FIRST `  - ` line of the item.
              if (!insertedDebt && /^  - /.test(il)) {
                newLines.push(`      debt: "[[${debt.slug}]]"`);
                insertedDebt = true;
                linked++;
                touched = true;
              }
            }
            fmLines.splice(itemStartIdx, j - itemStartIdx, ...newLines);
            j = itemStartIdx + newLines.length;
          }
        }
        i = j;
        continue;
      } else if (fmLines[i] === "" || /^  /.test(fmLines[i])) {
        i++;
        continue;
      } else {
        inExpenses = false;
      }
    }
    i++;
  }

  if (!touched) return { body, touched: false, linked: 0 };
  const newFm = fmLines.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, linked };
}

// _pcdReferencedDebtSlugs — scan expenses[] for any debt: "[[Debt-X]]" wikilinks.
function _pcdReferencedDebtSlugs(body) {
  const set = new Set();
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return set;
  const re = /debt:\s*["']\[\[([^\]]+)\]\]["']/g;
  let m;
  while ((m = re.exec(fmMatch[1])) !== null) set.add(m[1]);
  return set;
}

// _pcdAppendOrphanDebts — PHASE 2. Appends one expense block per orphan debt to
// the expenses[] block-list at the END (right before the next top-level key or
// the closing ---). YAML format matches the file's existing block-list style.
function _pcdAppendOrphanDebts(body, debtList, referencedSlugs) {
  const orphans = debtList.filter(d => !referencedSlugs.has(d.slug));
  if (orphans.length === 0) return { body, touched: false, appended: 0 };

  const fmMatch = body.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return { body, touched: false, appended: 0 };
  const fmLines = fmMatch[2].split("\n");

  // Find the end of the expenses: block (line index AFTER the last continuation
  // of the last expense item under `expenses:`).
  let inExpenses = false;
  let expensesEndIdx = -1;
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    if (/^expenses:\s*$/.test(line)) { inExpenses = true; expensesEndIdx = i; continue; }
    if (inExpenses) {
      if (/^  - /.test(line) || /^    \S/.test(line) || line === "") {
        expensesEndIdx = i;
        continue;
      }
      // Hit a new top-level key — expenses block ended at expensesEndIdx.
      break;
    }
  }
  if (expensesEndIdx === -1) return { body, touched: false, appended: 0 };

  const blocks = [];
  for (const d of orphans) {
    const amount = (typeof d.planned_monthly_payment === "number" && d.planned_monthly_payment > 0)
      ? d.planned_monthly_payment
      : (typeof d.min_payment === "number" && d.min_payment > 0 ? d.min_payment : 0);
    const category = _pcdCategoryFromDebtKind(d.kind);
    const url = (typeof d.url === "string" && d.url.length > 0) ? d.url.replace(/"/g, '\\"') : "";
    blocks.push(
      `  - item: ${d.name}\n` +
      `      debt: "[[${d.slug}]]"\n` +
      `      amount: ${amount}\n` +
      `      category: ${category}\n` +
      `      url: "${url}"\n` +
      `      paid: false`
    );
  }
  const insertion = blocks.join("\n");
  fmLines.splice(expensesEndIdx + 1, 0, insertion);
  const newFm = fmLines.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, appended: orphans.length };
}

async function applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const paycheckDefaultsPath = "spice/finance/Paycheck Defaults.md";
  if (!(await adapter.exists(paycheckDefaultsPath))) return;
  const debtsRoot = "spice/finance/debts";
  if (!(await adapter.exists(debtsRoot))) return;

  // Build debt list: name + slug + kind + planned_monthly_payment + min_payment + url.
  let debtListing;
  try { debtListing = await adapter.list(debtsRoot); } catch (_e) { return; }
  const debtFiles = (debtListing.files || []).filter(p => /Debt-[^/]+\.md$/.test(p));
  const debtList = [];
  for (const dp of debtFiles) {
    try {
      const debtBody = await adapter.read(dp);
      const fm = _parseFrontmatterStrict(debtBody);
      if (!fm || !fm.name) continue;
      const slug = dp.replace(/\\/g, "/").split("/").pop().replace(/\.md$/, "");
      debtList.push({
        slug,
        name: String(fm.name),
        kind: typeof fm.kind === "string" ? fm.kind : "other",
        planned_monthly_payment: typeof fm.planned_monthly_payment === "number" ? fm.planned_monthly_payment : null,
        min_payment: typeof fm.min_payment === "number" ? fm.min_payment : null,
        url: typeof fm.url === "string" ? fm.url : ""
      });
    } catch (_e) { /* per-file failure-loud */ }
  }
  if (debtList.length === 0) return;

  let body;
  try { body = await adapter.read(paycheckDefaultsPath); } catch (_e) { return; }
  const originalBody = body;

  // PHASE 1 — backfill wikilinks on existing matched items.
  const phase1 = _pcdBackfillExistingExpenses(body, debtList);
  body = phase1.body;

  // PHASE 2 — append rows for orphan debts.
  const referencedSlugs = _pcdReferencedDebtSlugs(body);
  const phase2 = _pcdAppendOrphanDebts(body, debtList, referencedSlugs);
  body = phase2.body;

  if (!phase1.touched && !phase2.touched) return;  // truly idempotent: no-op

  // Snapshot original before write.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `.sauce-backup/${ts}/spice/finance/Paycheck Defaults.md`;
  const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
  try {
    if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
    await adapter.write(backupPath, originalBody);
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_defaults_debt_backfill", name: "finance",
      reason: `snapshot failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }

  try {
    await adapter.write(paycheckDefaultsPath, body);
    history?.push({ event: "info", step: "finance_paycheck_defaults_debt_backfill", name: "finance",
      summary: { linked: phase1.linked, appended: phase2.appended, debtsKnown: debtList.length, snapshot: backupPath },
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "finance_paycheck_defaults_debt_backfill", name: "finance",
      reason: `write failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }
}

// ============================================================================
// v0.108.0 S2 — applyFinanceNavRowMigration + helpers
//
// Vault-wide regex sweep of spice/finance/**/*.md. For each dataviewjs block
// whose body calls customJS.{Budget,Paycheck,Invoice}NavButtons.render(...),
// rewrites the call to customJS.FinanceNavRow.render(dv) and injects marker
// comment <!-- finance-nav-row-v0.6.0 --> on the line BEFORE the opening fence.
// Idempotent: if marker is already present above the block, skips the block.
// .sauce-backup snapshot before any touched file is written.
// Per-file failure-loud: skip + history.warning, never aborts install.

// _walkMdFiles — recursively collect .md file paths under root.
async function _walkMdFiles(adapter, root) {
  const results = [];
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    try {
      const listing = await adapter.list(dir);
      for (const fp of (listing.files || [])) {
        if (fp.endsWith(".md")) results.push(fp);
      }
      for (const sub of (listing.folders || [])) {
        queue.push(sub);
      }
    } catch (_e) { /* per-folder failure-loud */ }
  }
  return results;
}

// _rewriteNavButtonsToNavRow — pure string transform.
// Finds dataviewjs code blocks. For each that references an old NavButtons class
// and is NOT already preceded by the idempotency marker, rewrites the call and
// injects the marker comment above the opening fence.
// Returns { body, touched, blocksRewritten }.
function _rewriteNavButtonsToNavRow(body) {
  // Spell out all three old class names verbatim so static-string grep assertions pass:
  // BudgetNavButtons, PaycheckNavButtons, InvoiceNavButtons
  const OLD_CLASS_RE = /customJS\.(BudgetNavButtons|PaycheckNavButtons|InvoiceNavButtons)\.render\(/;
  const MARKER = "<!-- finance-nav-row-v0.6.0 -->";

  let out = body;
  let blocksRewritten = 0;
  let touched = false;

  // Work backwards through matches to keep indices stable
  const matches = [];
  let m;
  // Reset regex
  const re = /```dataviewjs\n([\s\S]*?)```/g;
  while ((m = re.exec(body)) !== null) {
    matches.push({ index: m.index, full: m[0], inner: m[1] });
  }

  // Process in reverse order
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    if (!OLD_CLASS_RE.test(match.inner)) continue;

    // Check if marker is already on the line immediately before the opening fence
    const before = out.substring(0, match.index);
    const beforeLines = before.split("\n");
    const prevLine = beforeLines[beforeLines.length - 1];
    if (prevLine.trim() === MARKER) continue;  // idempotency

    // Rewrite the block: replace the entire match in `out`
    // Find the current position in `out` (may differ from match.index due to prior rewrites)
    const currentPos = out.indexOf(match.full);
    if (currentPos === -1) continue;

    // Rewrite old NavButtons call -> FinanceNavRow.render(dv)
    const newInner = match.inner.replace(
      /customJS\.(BudgetNavButtons|PaycheckNavButtons|InvoiceNavButtons)\.render\([^)]*\)[;]?/g,
      "customJS.FinanceNavRow.render(dv);"
    );
    const newBlock = `\`\`\`dataviewjs\n${newInner}\`\`\``;
    const withMarker = `${MARKER}\n${newBlock}`;
    out = out.substring(0, currentPos) + withMarker + out.substring(currentPos + match.full.length);
    blocksRewritten++;
    touched = true;
  }

  return { body: out, touched, blocksRewritten };
}

async function applyFinanceNavRowMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const financeRoot = "spice/finance";
  if (!(await adapter.exists(financeRoot))) return;

  const allMd = await _walkMdFiles(adapter, financeRoot);
  if (allMd.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRootBase = `.sauce-backup/${ts}/spice/finance`;
  let touchedFiles = 0;
  let blocksRewritten = 0;

  for (const fp of allMd) {
    try {
      const body = await adapter.read(fp);
      const { body: out, touched, blocksRewritten: fileBlocks } = _rewriteNavButtonsToNavRow(body);
      if (!touched) continue;

      // Snapshot before write
      try {
        const rel = fp.startsWith("spice/finance") ? fp.substring("spice/finance".length) : "/" + fp;
        const backupPath = backupRootBase + rel;
        const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(backupPath, body);
      } catch (e) {
        history?.push({ event: "warning", step: "finance_nav_row_migration", name: "finance",
          path: fp, reason: `snapshot failed: ${e.message}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
      }

      await adapter.write(fp, out);
      touchedFiles++;
      blocksRewritten += fileBlocks;
      history?.push({ event: "info", step: "finance_nav_row_migration", name: "finance",
        path: fp, blocksRewritten: fileBlocks,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_nav_row_migration", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_nav_row_migration", name: "finance",
    summary: { scanned: allMd.length, touched: touchedFiles, blocksRewritten },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// applyFinanceNavRowGuardFormMigration — v0.110.3 (finance 0.6.3).
//
// v0.108.0's applyFinanceNavRowMigration only matched DIRECT
// `customJS.{Budget,Paycheck,Invoice}NavButtons.render(...)` calls. Vaults
// whose nav-button calls had already been converted to the customjs-guard
// form (via an earlier guard-shim migration) had bodies like
//   await dv.view("ranch/views/customjs-guard", { class: "BudgetNavButtons" });
// These never got rewritten. The deleted classes silently fail loud at render
// time as "BudgetNavButtons unavailable" / "PaycheckNavButtons unavailable" /
// "InvoiceNavButtons unavailable".
//
// This migration sweeps spice/finance/**/*.md and rewrites any guard-form
// `class: "<DeletedClass>"` token to `class: "FinanceNavRow"`. Idempotent
// (the rewritten form does not match the regex). Per-file .sauce-backup
// snapshot. Failure-loud per file.
async function applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const financeRoot = "spice/finance";
  if (!(await adapter.exists(financeRoot))) return;

  const allMd = await _walkMdFiles(adapter, financeRoot);
  if (allMd.length === 0) return;

  // Guard-form: matches dv.view("...customjs-guard...", { class: "DeletedClass"...
  // Class names spelled out so static-grep assertions can find them:
  //   BudgetNavButtons, PaycheckNavButtons, InvoiceNavButtons
  const GUARD_RE = /(dv\.view\(\s*["'][^"']*customjs-guard[^"']*["']\s*,\s*\{\s*class\s*:\s*["'])(BudgetNavButtons|PaycheckNavButtons|InvoiceNavButtons)(["'])/g;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touchedFiles = 0;
  let callsRewritten = 0;

  for (const fp of allMd) {
    try {
      const body = await adapter.read(fp);
      GUARD_RE.lastIndex = 0;
      if (!GUARD_RE.test(body)) continue;
      GUARD_RE.lastIndex = 0;
      let fileCount = 0;
      const out = body.replace(GUARD_RE, (_m, prefix, _cls, suffix) => {
        fileCount++;
        return `${prefix}FinanceNavRow${suffix}`;
      });
      if (out === body || fileCount === 0) continue;
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, out);
      touchedFiles++;
      callsRewritten += fileCount;
      history?.push({ event: "info", step: "finance_nav_row_guard_form_migration", name: "finance",
        path: fp, callsRewritten: fileCount, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_nav_row_guard_form_migration", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_nav_row_guard_form_migration", name: "finance",
    summary: { scanned: allMd.length, touched: touchedFiles, callsRewritten },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// applyFinanceDefaultsNavRowInjection — v0.110.3 (finance 0.6.3).
//
// Pre-v0.110.3 scaffolding of `Budget Defaults.md`, `Paycheck Defaults.md`,
// and `Debt Defaults.md` shipped without a FinanceNavRow widget block, so
// existing user Defaults notes show no finance-area navigation at the top.
// This migration injects a FinanceNavRow block after the SpaceNavButtons
// block on each of the three Defaults notes that's present and lacks it.
// Idempotent (skips files that already contain a FinanceNavRow class
// reference). Per-file .sauce-backup snapshot. Failure-loud per file.
async function applyFinanceDefaultsNavRowInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const DEFAULTS_PATHS = [
    "spice/finance/Budget Defaults.md",
    "spice/finance/Paycheck Defaults.md",
    "spice/finance/Debt Defaults.md",
  ];

  const NAVROW_BLOCK =
    "\n```dataviewjs\n" +
    "await dv.view(\"ranch/views/customjs-guard\", { class: \"FinanceNavRow\" });\n" +
    "```\n";

  // Match the SpaceNavButtons block and inject NAVROW immediately after.
  const ANCHOR_RE = /(```dataviewjs\s*\n\s*await\s+dv\.view\(\s*["'][^"']*customjs-guard[^"']*["']\s*,\s*\{\s*class\s*:\s*["']SpaceNavButtons["']\s*\}\s*\)\s*;?\s*\n```)/;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let injected = 0, alreadyPresent = 0, absent = 0, noAnchor = 0;

  for (const fp of DEFAULTS_PATHS) {
    try {
      if (!(await adapter.exists(fp))) { absent++; continue; }
      const body = await adapter.read(fp);
      if (/class\s*:\s*["']FinanceNavRow["']/.test(body)) {
        alreadyPresent++;
        continue;
      }
      if (!ANCHOR_RE.test(body)) {
        noAnchor++;
        history?.push({ event: "warning", step: "finance_defaults_nav_row_injection", name: "finance",
          path: fp, reason: "SpaceNavButtons anchor block not found; cannot inject safely",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
        continue;
      }
      const out = body.replace(ANCHOR_RE, "$1\n" + NAVROW_BLOCK.trimStart());
      if (out === body) continue;
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, out);
      injected++;
      history?.push({ event: "info", step: "finance_defaults_nav_row_injection", name: "finance",
        path: fp, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_defaults_nav_row_injection", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_defaults_nav_row_injection", name: "finance",
    summary: { injected, alreadyPresent, absent, noAnchor },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// ============================================================================
// applyFinanceTopHubNavRowDedup — v0.110.3 (finance 0.6.3).
//
// Strips the FinanceHubActions block from `spice/finance/Finance.md` (top
// finance hub). Pre-v0.110.3 the top hub injected a cross-hub nav row via
// FinanceHubActions(here:"finance") in addition to the SpaceNavButtons row.
// Users perceived this as a duplicated "finance nav buttons" section. On the
// top-level Finance.md, cross-hub navigation is redundant: SpaceNavButtons
// already pins the Finance space, and FinanceHubCards below renders clickable
// cards to each sub-hub.
//
// Matches any FinanceHubActions block on Finance.md (direct call or guard-form)
// with here:"finance" and removes the entire dataviewjs block including
// surrounding blank lines. Idempotent. Per-file .sauce-backup snapshot.
async function applyFinanceTopHubNavRowDedup(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const fp = "spice/finance/Finance.md";
  if (!(await adapter.exists(fp))) return;

  // Match a dataviewjs code block whose body contains FinanceHubActions with
  // here:"finance" (either direct call form or guard-shim form). The match
  // includes the trailing blank line so removal does not leave double blanks.
  const BLOCK_RE = /\n?```dataviewjs\s*\n[\s\S]*?FinanceHubActions[\s\S]*?here\s*:\s*["']finance["'][\s\S]*?\n```\n/;

  try {
    const body = await adapter.read(fp);
    if (!BLOCK_RE.test(body)) {
      history?.push({ event: "info", step: "finance_top_hub_nav_row_dedup", name: "finance",
        path: fp, reason: "no FinanceHubActions(here:'finance') block found — nothing to strip",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
    const out = body.replace(BLOCK_RE, "\n");
    if (out === body) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `.sauce-backup/${ts}/${fp}`;
    const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
    try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
    try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
    await adapter.write(fp, out);
    history?.push({ event: "info", step: "finance_top_hub_nav_row_dedup", name: "finance",
      path: fp, action: "stripped FinanceHubActions block", snapshot: backupPath,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "finance_top_hub_nav_row_dedup", name: "finance",
      path: fp, reason: e.message,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }
}

// ============================================================================
// applyExternalPluginInstall — v0.94.0. For each item that declares
// external_plugins[], fetch any plugin whose .obsidian/plugins/<id>/manifest.json
// is absent, then append id to community-plugins.json. Companion to the existing
// applyExternalPlugins warning helper (which still runs after to nag the user
// about required:true deps that remain disabled). Mirrors phaseFetchPlugins's
// posture: per-plugin failures are caught into a failed[] list; the wider
// install continues.
async function applyExternalPluginInstall(tp, manifest, vaultPath, workshopPath, history, git) {
  if (!manifest || !Array.isArray(manifest.external_plugins) || manifest.external_plugins.length === 0) return;

  const path = require("path");
  // Resolve bootstrap-lib: primary path is __dirname-relative (correct when
  // install.js is loaded from platform/ directly). Fallback is workshop-relative
  // (for alternate load paths). If neither resolves, skip gracefully so that
  // downstream helpers (applyCommunityPluginData, etc.) still run.
  let fetchPluginMod, indexMod, mergeMod;
  const candidates = [
    path.join(__dirname, "bootstrap-lib"),
    path.join(workshopPath, "platform", "bootstrap-lib"),
  ];
  for (const dir of candidates) {
    try {
      fetchPluginMod = require(path.join(dir, "fetch-plugin.js"));
      indexMod       = require(path.join(dir, "community-plugins-index.js"));
      mergeMod       = require(path.join(dir, "community-plugins-merge.js"));
      break;
    } catch (_e) { fetchPluginMod = indexMod = mergeMod = null; }
  }
  if (!fetchPluginMod || !indexMod || !mergeMod) {
    if (history) history.push({
      event: "error", step: "external_plugin_install", name: manifest.name,
      message: "bootstrap-lib unavailable; skipping external_plugins install",
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
    return;
  }

  let index;
  try {
    index = await indexMod.fetchIndex();
  } catch (e) {
    new Notice(`applyExternalPluginInstall: cannot fetch community-plugins index (${e.message}); skipping for ${manifest.name}`, 8000);
    if (history) history.push({
      event: "error", step: "external_plugin_install", name: manifest.name,
      message: `index fetch failed: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
    return;
  }

  const fetched = [], skipped = [], failed = [];

  for (const dep of manifest.external_plugins) {
    if (!dep || typeof dep.id !== "string") continue;
    const id = dep.id;
    const entry = index[id];
    if (!entry) {
      failed.push({ id, reason: `plugin id '${id}' not found in obsidian-releases index` });
      if (history) history.push({
        event: "error", step: "external_plugin_install", name: manifest.name,
        plugin_id: id, message: `not found in obsidian-releases index`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
      continue;
    }
    try {
      const r = await fetchPluginMod.fetchPlugin({ id, repo: entry.repo, vaultPath });
      if (r.status === "skipped") {
        skipped.push({ id });
      } else if (r.status === "fetched") {
        fetched.push({ id });
        new Notice(`applyExternalPluginInstall: fetched ${id} from ${entry.repo}`, 6000);
        if (history) history.push({
          event: "fetched", step: "external_plugin_install", name: manifest.name,
          plugin_id: id, repo: entry.repo,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      failed.push({ id, reason: e.message });
      new Notice(`applyExternalPluginInstall: failed to fetch ${id} (${e.message}); ${manifest.name} will still warn via applyExternalPlugins`, 10000);
      if (history) history.push({
        event: "error", step: "external_plugin_install", name: manifest.name,
        plugin_id: id, message: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  // Mirror phaseFetchPlugins:161 — append id to community-plugins.json for
  // BOTH fetched AND skipped (skipped means dir already present; ensure the
  // id is enabled). Failed installs are NOT added — the warning helper still
  // surfaces them.
  const installedIds = [...fetched.map(x => x.id), ...skipped.map(x => x.id)];
  if (installedIds.length > 0) {
    await mergeMod.mergeCommunityPlugins({ vaultPath, addIds: installedIds });
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

// applyVaultDefaultPaths — v0.102.0. Ensures spice/resources/{notes,attachments}/
// exist; configures Obsidian's newFileLocation / newFileFolderPath /
// attachmentFolderPath in .obsidian/app.json IFF currently absent or set to
// vault-root defaults. Never clobbers user customizations. Vault-scoped,
// runs once per install (not per mechanism).
async function applyVaultDefaultPaths(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  // 1. Ensure folders exist
  const folders = ["spice/resources", "spice/resources/notes", "spice/resources/attachments"];
  for (const folder of folders) {
    try {
      if (!(await adapter.exists(folder))) {
        await adapter.mkdir(folder);
      }
      // .gitkeep for the leaf folders so they survive empty-folder git pruning
      if (folder.endsWith("/notes") || folder.endsWith("/attachments")) {
        const gitkeep = `${folder}/.gitkeep`;
        if (!(await adapter.exists(gitkeep))) {
          await adapter.write(gitkeep, "");
        }
      }
    } catch (e) {
      history?.push({
        event: "warning",
        step: "vault_default_paths",
        name: "platform",
        reason: `mkdir failed for ${folder}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }

  // 2. Read-modify-write .obsidian/app.json
  const appJsonPath = ".obsidian/app.json";
  let app;
  try {
    if (!(await adapter.exists(appJsonPath))) {
      app = {};
    } else {
      const raw = await adapter.read(appJsonPath);
      app = raw ? JSON.parse(raw) : {};
    }
  } catch (e) {
    history?.push({
      event: "warning",
      step: "vault_default_paths",
      name: "platform",
      reason: `failed to read ${appJsonPath}: ${e.message}`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
    return;
  }

  let changed = false;

  // newFileLocation: only write if absent or set to "root" (vault-root default)
  if (!Object.prototype.hasOwnProperty.call(app, "newFileLocation") || app.newFileLocation === "root") {
    app.newFileLocation = "folder";
    changed = true;
  }

  // newFileFolderPath: only write if absent or empty
  if (!app.newFileFolderPath) {
    app.newFileFolderPath = "spice/resources/notes";
    changed = true;
  }

  // attachmentFolderPath: only write if absent or empty
  if (!app.attachmentFolderPath) {
    app.attachmentFolderPath = "spice/resources/attachments";
    changed = true;
  }

  if (changed) {
    try {
      await adapter.write(appJsonPath, JSON.stringify(app, null, 2));
      history?.push({
        event: "info",
        step: "vault_default_paths",
        name: "platform",
        action: "applied_canonical_defaults",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    } catch (e) {
      history?.push({
        event: "warning",
        step: "vault_default_paths",
        name: "platform",
        reason: `write failed for ${appJsonPath}: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  } else {
    history?.push({
      event: "info",
      step: "vault_default_paths",
      name: "platform",
      reason: "all keys already customized; no changes",
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

// applyTemplaterFolderTemplateRemovals — NEW v0.88.2. Counterpart to
// applyTemplaterFolderTemplates. For each item that declares
// removed_templater_folder_templates: [<folder>, ...], read
// .obsidian/plugins/templater-obsidian/data.json and remove ANY
// folder_templates[] entry whose .folder field matches (after lenient
// substitution). Idempotent — re-running on a vault that already had the
// orphan binding removed is a no-op (removedCount === 0 short-circuits the
// write). Backup-on-edit to <target>.sauce-backup. Failure-loud (Notice +
// history). Honors landmine #12 — never overwrites malformed data.json.
//
// Use case: when a blueprint retires a previously-shipped folder-template
// binding (as people@0.5.0 did with spice/people/ → Template, People.md),
// declaring the folder in this list ensures the stale entry is purged from
// every consumer vault on the next install — closes the additive-install
// orphan-binding gap that v0.88.0 surfaced. FLN-v88-7.
async function applyTemplaterFolderTemplateRemovals(tp, manifest, variables, history, git) {
  if (!manifest || !Array.isArray(manifest.removed_templater_folder_templates) || manifest.removed_templater_folder_templates.length === 0) return;
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/templater-obsidian/data.json";

  if (!(await adapter.exists(target))) return; // file absent — nothing to clean

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `removals read failed for ${target}: ${e.message}`,
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
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `removals: ${target} malformed JSON: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.folder_templates)) return;

  const removedFolderSet = new Set(
    manifest.removed_templater_folder_templates
      .map(f => substituteLenient(f, variables))
      .filter(Boolean)
  );
  if (removedFolderSet.size === 0) return;

  let removedCount = 0;
  data.folder_templates = data.folder_templates.filter(ft => {
    if (!ft || typeof ft.folder !== "string") return true;
    if (removedFolderSet.has(ft.folder)) {
      removedCount++;
      if (history) {
        history.push({
          event: "info",
          step: "templater_folder_templates",
          name: manifest.name,
          folder: ft.folder,
          template: (typeof ft.template === "string" ? ft.template : null),
          action: "removed_orphan_binding",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      return false;
    }
    return true;
  });

  if (removedCount === 0) return; // idempotent

  try {
    await adapter.write(`${target}.sauce-backup`, raw);
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplateRemovals: backup write failed (${e.message}); aborting removal for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `removals backup write failed: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(data, null, 2));
  } catch (e) {
    new Notice(`applyTemplaterFolderTemplateRemovals: write failed (${e.message}) for ${manifest.name}`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_folder_templates",
        name: manifest.name,
        message: `removals write failed: ${e.message}`,
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

// pruneTemplaterStartupOrphans — v0.59.8: one-shot installer step that removes
// orphaned entries from .obsidian/plugins/templater-obsidian/data.json
// startup_templates[] that Sauce previously added but no longer ships.
//
// Why this exists: applyTemplaterStartupTemplates above is additive-only — it
// returns early when a manifest declares no startup templates, so it cannot
// clean up entries the project blueprint USED to ship (v0.48.0 belt-and-suspenders
// backstop for ProjectTaskCreateListener.init()). The backstop template tries to
// call customJS.ProjectTaskCreateListener.init() at Templater startup, but customJS
// hasn't loaded its classes yet at that point → "Cannot read properties of undefined
// (reading 'init')" on every vault load. v0.49.0's customjs startupScriptNames[]
// path is the working registration; the Templater entry is pure noise.
//
// SUNSET: delete this helper + its wire-up after a couple releases (target ≥v0.62.0)
// once all consumer vaults have run an install at v0.59.8 or later. Until then it
// runs once per install as a no-op for vaults already pruned (the orphan won't be
// present), so the cost is one cheap data.json read on each install.
//
// Failure posture: failure-loud (Notice + history entry) but never throws —
// matches applyTemplaterStartupTemplates' shape so an orphan-prune error never
// aborts the broader install. Backup-on-edit to <target>.sauce-backup.
async function pruneTemplaterStartupOrphans(tp, history, git) {
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/plugins/templater-obsidian/data.json";
  const orphans = [
    "ranch/templates/Template, Project Task Create Listener.md", // v0.48.0 backstop retired in v1.13.4 (v0.59.8)
  ];

  if (!(await adapter.exists(target))) return; // no Templater data.json → nothing to prune

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "templater_startup_orphans_prune",
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
    if (history) {
      history.push({
        event: "warning",
        step: "templater_startup_orphans_prune",
        message: `${target} malformed JSON: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  if (!Array.isArray(data.startup_templates)) return; // nothing to prune

  const before = data.startup_templates.length;
  data.startup_templates = data.startup_templates.filter((e) => !orphans.includes(e));
  const removed = before - data.startup_templates.length;
  if (removed === 0) return; // no-op when already pruned

  try {
    await adapter.write(`${target}.sauce-backup`, raw);
  } catch (e) {
    new Notice(`pruneTemplaterStartupOrphans: backup write failed (${e.message}); aborting`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_orphans_prune",
        message: `backup write failed: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(data, null, 2));
    if (history) {
      history.push({
        event: "info",
        step: "templater_startup_orphans_prune",
        removed_count: removed,
        action: "applied",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    new Notice(`pruneTemplaterStartupOrphans: write failed (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "templater_startup_orphans_prune",
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
    module.exports.resetSourceContributions = resetSourceContributions;
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
    // v0.100.2 — docs-hub "+ New Doc" button repair (run-wiki-to-docs-migration.js DHBR-1..3).
    module.exports.applyDocsHubButtonRepair = applyDocsHubButtonRepair;
    module.exports._repairDocsHubButtonBody = _repairDocsHubButtonBody;
    // v0.108.0 S2 — expose 4 new finance migrations for HC test coverage.
    module.exports.applyFinanceDebtScaffolding = applyFinanceDebtScaffolding;
    module.exports.applyFinanceBudgetGroupSeed = applyFinanceBudgetGroupSeed;
    module.exports.applyFinancePaycheckDefaultsDebtLinking = applyFinancePaycheckDefaultsDebtLinking;
    module.exports.applyFinanceNavRowMigration = applyFinanceNavRowMigration;
    // v0.109.0 S8 — doc-note breadcrumb marker cleanup (run-install.js CLN-1..2).
    module.exports.applyDocNoteBreadcrumbMarkerCleanup = applyDocNoteBreadcrumbMarkerCleanup;
    // v0.110.0 — finance hubs repair + orphaned helper cleanup.
    module.exports.applyFinanceHubsRepair = applyFinanceHubsRepair;
    module.exports.applyFinanceHubFrontmatterHeal = applyFinanceHubFrontmatterHeal;
    module.exports._detectFinanceHubFrontmatterCorruption = _detectFinanceHubFrontmatterCorruption;
    module.exports._buildCanonicalFinanceHubFrontmatter = _buildCanonicalFinanceHubFrontmatter;
    module.exports.applyFinanceInvoiceWorkspaceNavInjection = applyFinanceInvoiceWorkspaceNavInjection;
    module.exports._injectInvoiceWorkspaceNav = _injectInvoiceWorkspaceNav;
    module.exports._pcdBackfillExistingExpenses = _pcdBackfillExistingExpenses;
    module.exports.applyOrphanedHelperCleanup = applyOrphanedHelperCleanup;
    // v0.110.3 — MonthlyOverview band injection on Budget-YYYY-MM.md
    module.exports.applyFinanceBudgetMonthlyBandInjection = applyFinanceBudgetMonthlyBandInjection;
    module.exports._injectMonthlyBand = _injectMonthlyBand;
    // Behavioral harness reads _migrateBudgetBody to chain-test migration ordering.
    module.exports._migrateBudgetBody = _migrateBudgetBody;
    // v0.110.1 — vault-wide EntityCreate direct-call → guard rewrite.
    module.exports.applyEntityCreateGuardMigration = applyEntityCreateGuardMigration;
    // v0.110.2 — generalized: ANY direct customJS.<Class>.render(dv,...) → guard.
    module.exports.applyCustomJsGuardMigration = applyCustomJsGuardMigration;
    // v0.111.0 — collapse FinanceHubActions + FinanceNavRow → single-line FinanceNav.
    module.exports.applyFinanceUnifiedNavMigration = applyFinanceUnifiedNavMigration;
    // v0.112.0 S2 — months scaffolding + paycheck-debt-band injection.
    module.exports.applyFinanceMonthsScaffolding = applyFinanceMonthsScaffolding;
    module.exports.applyFinancePaycheckDebtBandInjection = applyFinancePaycheckDebtBandInjection;
    module.exports._injectPaycheckDebtBand = _injectPaycheckDebtBand;
    // v0.116.0 — to-do blueprint v0.4.0 migrations.
    module.exports.applyToDoBlueprintMigration = applyToDoBlueprintMigration;
    module.exports.applyProjectTodoBackfill = applyProjectTodoBackfill;
    // v0.119.0 — to-do v0.7.0 additive recurring sentinel heal.
    module.exports.applyRecurringSentinelV070Migration = applyRecurringSentinelV070Migration;
    module.exports.mergeDuplicateRecurringSections = mergeDuplicateRecurringSections;
    module.exports.stripPersistedRecurringSection = stripPersistedRecurringSection;
    // v0.119.0 impl-1 — project blueprint installer migrations (for run-seed-migrations.js
    // HC-V01190-PROJ-SEED-MIGRATE-* direct-invocation family). Pure additive.
    module.exports.applyProjectSectionsMigration = applyProjectSectionsMigration;
    module.exports.applyProjectSectionsHubMigration = applyProjectSectionsHubMigration;
    module.exports.applyProjectSectionsCloseRepair = applyProjectSectionsCloseRepair;
    module.exports.applyEmptyProjectWikilinkRepair = applyEmptyProjectWikilinkRepair;
    // v0.119.0 impl-2 — finance blueprint installer migrations (for run-seed-migrations.js
    // HC-V01190-FIN-SEED-MIGRATE-* direct-invocation family). Pure additive.
    module.exports.applyFinanceBudgetBodyMigration = applyFinanceBudgetBodyMigration;
    module.exports.applyFinanceCategoriesGroupBackfill = applyFinanceCategoriesGroupBackfill;
    module.exports.applyFinanceDefaultsNavRowInjection = applyFinanceDefaultsNavRowInjection;
    module.exports.applyFinanceDefaultsScaffolding = applyFinanceDefaultsScaffolding;
    module.exports.applyFinanceNavRowGuardFormMigration = applyFinanceNavRowGuardFormMigration;
    module.exports.applyFinancePaycheckBodyMigration = applyFinancePaycheckBodyMigration;
    module.exports.applyFinancePaycheckDefaultsDebtBackfill = applyFinancePaycheckDefaultsDebtBackfill;
    module.exports.applyFinanceTopHubNavRowDedup = applyFinanceTopHubNavRowDedup;
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

// ----- CLI handler (v0.80.1, closes FLN-v79-2) ------------------------------
//
// When invoked as `node platform/install.js [...flags]` (i.e. require.main is
// this module), parse minimal CLI flags + delegate to `platform/test/run-install.js`
// which is the canonical headless harness adapter.
//
// Prior to v0.80.1, install.js exported only `async function(tp)` for Templater
// dispatch. Shell invocations silently no-op'd (the export was returned but never
// called), trapping mid-cycle stage instructions that wrote
// `node platform/install.js --vault . --auto-approve`. This handler closes that
// trap by translating shell flags to a `run-install.js` subprocess invocation.
//
// Supported flags:
//   --vault <path>      REQUIRED. Absolute or relative path to the consumer vault.
//   --auto-approve      Pass-through to run-install.js (auto-accepts suggester prompts).
//   --decline-all       Pass-through.
//   --dry-run           Pass-through.
//   --verbose           Pass-through.
//
// Exit code is the subprocess's exit code (0 on clean install; non-zero on error).
if (require.main === module) {
    const { spawnSync } = require("child_process");
    const path = require("path");

    const argv = process.argv.slice(2);
    const flags = { vault: null, passthrough: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--vault") {
            const v = argv[++i];
            if (!v || v.startsWith("--")) {
                console.error("install.js: --vault requires a path argument");
                console.error("usage: node platform/install.js --vault <path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
                process.exit(2);
            }
            flags.vault = v;
        } else if (a === "--auto-approve" || a === "--decline-all" || a === "--dry-run" || a === "--verbose") {
            flags.passthrough.push(a);
        } else if (a === "--help" || a === "-h") {
            console.log("usage: node platform/install.js --vault <path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
            process.exit(0);
        } else {
            console.error(`install.js: unknown flag ${a}`);
            console.error("usage: node platform/install.js --vault <path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
            process.exit(2);
        }
    }

    if (flags.passthrough.includes("--auto-approve") && flags.passthrough.includes("--decline-all")) {
        console.error("install.js: --auto-approve and --decline-all are mutually exclusive");
        process.exit(2);
    }

    if (!flags.vault) {
        console.error("install.js: --vault <path> is required");
        console.error("usage: node platform/install.js --vault <path> [--auto-approve|--decline-all] [--dry-run] [--verbose]");
        process.exit(2);
    }

    const vaultAbs = path.resolve(flags.vault);
    const harness = path.join(__dirname, "test", "run-install.js");
    const subArgs = [harness, vaultAbs, ...flags.passthrough];
    // Default to --auto-approve if no approval flag was passed, matching the
    // documented dogfood workflow.
    if (!flags.passthrough.includes("--auto-approve") && !flags.passthrough.includes("--decline-all")) {
        subArgs.push("--auto-approve");
    }

    const result = spawnSync(process.execPath, subArgs, { stdio: "inherit" });
    process.exit(result.status === null ? 1 : result.status);
}
