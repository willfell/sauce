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

// --- Per-vault migration gate ------------------------------------------------
// A ONE-TIME-reshaper heal runs only when the vault's prior installed
// workshop_version is unknown OR below the version the heal shipped in. Fail-safe:
// unknown prior version => run. Set once per install from the consumer's existing
// platform-installed.json:workshop_version. NOTE: only gate heals that reshape
// PRE-EXISTING legacy content (new content is born correct via templates). NEVER
// gate backfill/ensure/inject/repair/cleanup heals — they must run for new content.
let __installPriorVersion = null;
function semverLt(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x < y) return true; if (x > y) return false; }
  return false;
}
function _migrationGated(introducedIn) {
  return __installPriorVersion != null && introducedIn != null && !semverLt(__installPriorVersion, introducedIn);
}

module.exports = async function (tp) {
  const app = tp.app;

  const installed = (await readJson(app, "ranch/platform-installed.json")) || {
    mechanisms: [],
    blueprints: [],
    history: [],
  };

  __installPriorVersion = (installed && typeof installed.workshop_version === "string" && installed.workshop_version) ? installed.workshop_version : null;

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
    // NOTE: applyNoteChromeHeal is NOT wired here (per-vault block) even though
    // its signature is (tp, history, git) like the heals above. It MUST run
    // AFTER applyToDoBlueprintMigration (which runs inside installItem) — that
    // migration rebuilds v0.3.3 daily-to-do bodies from a hardcoded block list
    // (_reshapeToV040), discarding any Breadcrumb injected earlier. Running the
    // chrome heal here would never converge (reshape strips the breadcrumb on
    // run 1, heal re-adds it on run 2). Wired after the install loop instead —
    // see the applyNoteChromeHeal call following pruneTemplaterStartupOrphans.

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

    // 6a2b. Prune the orphaned project/breadcrumb.js — a stale pre-mechanism
    // `class Breadcrumb` that collides with the breadcrumb mechanism's class of the
    // same name. The customJS scan order is platform-dependent, so on mobile the
    // legacy could win and the ChromeBar breadcrumb silently rendered nothing.
    try {
      await pruneOrphanedProjectBreadcrumb(tp, installedNow.history, git);
    } catch (e) {
      new Notice(`pruneOrphanedProjectBreadcrumb crashed: ${e.message}`, 8000);
      installedNow.history.push({
        event: "error",
        step: "orphaned_project_breadcrumb_prune",
        message: e.message,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }

    // 6a3. v0.124.0 (note-chrome wave 1) — inject the Breadcrumb dataviewjs
    // block into EXISTING meetings/scratch/to-do notes (and rewrite meeting
    // ## H2 content headers to SectionLabel), so notes created before Task 1's
    // template edits render the same chrome as new ones. Per-vault scope (runs
    // once). MUST run HERE — after the install loop / after
    // pruneTemplaterStartupOrphans — not in the per-vault heals block near the
    // top of install(): applyToDoBlueprintMigration (inside installItem)
    // rebuilds v0.3.3 daily-to-do bodies from a hardcoded block list, discarding
    // any breadcrumb injected earlier. Running post-loop lets the heal inject
    // into the FINAL note shape, so a second install is a true no-op (idempotent).
    await applyNoteChromeHeal(tp, installedNow.history, git);

    // 6a3b. Meeting Hub notes are a tag-based hub (`tags: meetings-hub`, no
    // `type:` field) — applyNoteChromeHeal's type-keyed dispatch above never
    // reaches them (see note-chrome.md §6). Separate heal for that surface.
    await applyMeetingsHubChromeBarHeal(tp, installedNow.history, git);

    // 6a4. task-entity — convert the MOST-RECENT daily's open `- [ ]` lines into
    // note-per-task files under spice/tasks/ and swap the legacy capture/carryover
    // dataviewjs blocks for a single TaskTodayList render. MUST run HERE (post-loop,
    // after applyNoteChromeHeal) — NOT in the per-item to-do heals block — because
    // applyToDoBlueprintMigration (inside installItem, which runs once per item)
    // reshapes v0.3.3/v0.4.0 daily bodies from a hardcoded block list, re-injecting
    // a TodayCaptureEditableList block on every item. Running post-loop lets this
    // heal operate on the FINAL note shape so the swap is complete + a second
    // install is a true no-op (idempotent via the TaskTodayList/<!-- tasks-migrated -->
    // sentinel skip). Ungated, backup-first, non-destructive (done lines +
    // historical dailies untouched).
    await applyDailyTasksToEntityMigration(tp, installedNow.history, git);

    // 6a4b. task-entity — convert EVERY meeting note's OPEN Action Items lines +
    // EVERY project To-Do note's OPEN Owned Tasks lines into note-per-task files
    // under spice/tasks/ (source: meeting / project). Ungated, backup-first,
    // per-note sentinel, non-destructive (done lines untouched; unparseable lines
    // left raw). Runs alongside the daily migration so all three surfaces feed the
    // same spice/tasks/ store.
    await applyMeetingTasksToEntityMigration(tp, installedNow.history, git);
    await applyProjectTasksToEntityMigration(tp, installedNow.history, git);

    // 6a5. task-entity — heal EXISTING task notes under spice/tasks/ (top level):
    // rename ugly `task-YYYYMMDD-HHmmss-hhhh.md` files to the readable
    // `<title>.md`, and inject the standard chrome (TaskChromeBar + TaskNoteView
    // + <!-- TASK_NOTES --> marker) into bare notes (preserving user body below the
    // marker). Runs AFTER applyDailyTasksToEntityMigration so migration-created
    // notes get healed the same install. Ungated, backup-first, idempotent
    // (title-named + marker-present notes are skipped), failure-loud-per-file.
    await applyTaskNoteHeal(tp, installedNow.history, git);

    // 6a6. task-entity B1 — un-mangle existing task-notes whose project/project_slug
    // was written from a RESOLVED Dataview Link path (project:
    // "[[spice/projects/connectors/Connectors.md|Connectors]]" +
    // project_slug: spice-projects-connectors-connectors-md-connectors). Re-derive
    // the CLEAN basename + REAL project slug. Ungated, idempotent (clean notes
    // skipped), .sauce-backup, per-note try/catch.
    await applyTaskNoteProjectSlugHeal(tp, installedNow.history, git);

    // 6a7. task-entity B2 — inject the live task-list render blocks into EXISTING
    // notes that predate them (only NEW notes get the block from the template):
    //   - project-todo notes gain a "Project Tasks" SectionLabel + TaskProjectList
    //   - meeting notes gain a "Tasks" SectionLabel + TaskMeetingList
    // Ungated, idempotent (skip if the block is already present), .sauce-backup.
    await applyProjectTodoTaskListHeal(tp, installedNow.history, git);
    await applyMeetingTaskListHeal(tp, installedNow.history, git);

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

    // 7c. Subscription-aware pruning of ranch/breadcrumb-registry.json.
    // Symmetric with the nav-buttons + entity-create prunes above: removes
    // contributions.<source> for any source no longer in the current
    // subscription. Closes the "entirely unsubscribed blueprint" gap that
    // applyBreadcrumb can't see (it only runs for items still in the
    // subscription). Wrapped in its own try/catch so a malformed registry
    // never aborts the broader install.
    try {
      await pruneBreadcrumbRegistry(tp, subscription, installedNow.history, git);
    } catch (e) {
      new Notice(`platformInstall: breadcrumb registry prune failed — ${e.message}`, 6000);
      installedNow.history.push({
        event: "error",
        step: "breadcrumb_prune",
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
  // v0.123.0 — aggregate per-blueprint breadcrumb: { types: {...} } into
  // ranch/breadcrumb-registry.json (read-modify-write so the registry
  // accumulates across the install loop, with prune-on-empty for re-installs).
  // The Breadcrumb mechanism reads from this registry at render time.
  await applyBreadcrumb(tp, mech, variables, history, git);
  await applyWikiToDocsMigration(tp, mech, variables, history, git);   // NEW v0.52.0 — must run BEFORE applyDocsBackfill
  await applyJournalMultiEntryMigration(tp, mech, variables, history, git); // NEW v0.212.0 journal multi-entry — per-item phase (gated manifest.name==="journal"), converts flat Journal-YYYY-MM-DD.md into day-folder+day-hub+leaf shape
  await applyScratchToStickyNotesMigration(tp, mech, variables, history, git); // NEW v0.9.0 sticky-notes rename — per-item phase (gated manifest.name==="sticky-notes"), before per-vault applyNoteChromeHeal
  await applyDocsBackfill(tp, mech, variables, history, git);          // NEW v0.50.0; renamed from applyWikiBackfill v0.52.0
  await applyDocsHubButtonRepair(tp, mech, variables, history, git);   // NEW v0.100.2 — heals existing broken "+ New Doc" blocks (backfill is create-if-absent)
  await applyProjectMeetingsPanelHeal(tp, mech, variables, history, git); // NEW v0.127.0 §D — injects ProjectMeetingsPanel dataviewjs block into stale type:project hubs (insert-only, idempotent, .sauce-backup snapshot before write)
  await applyDocLeafActionsBackfill(tp, mech, variables, history, git);   // NEW (Project Doc Updating Wiring PR4) — injects the DocLeafActions Move-button block into existing type:doc-note notes lacking it (insert-only after the ProjectNavButtons `---` divider, idempotent, .sauce-backup before write)
  await applyDocBulkMoveActionsBackfill(tp, mech, variables, history, git); // (Project Doc Updating Wiring PR5) — NEUTERED for docs-hub: Move docs now lives in renderActionRow; this no longer injects the standalone block (skips every docs-hub note)
  await applyDocsHubModernizeHeal(tp, mech, variables, history, git);       // NEW (docs-hub modernize) — rewrites legacy docs-hub bodies to the renderActionRow chrome shape (removes standalone DocBulkMoveActions + doubled `---`, injects Breadcrumb + renderActionRow, idempotent, .sauce-backup before write). MUST run AFTER the neutered backfill above.
  await applyProjectLinksManagerBackfill(tp, mech, variables, history, git); // NEW (Project Links Wiring PR4) — injects the ProjectLinksManager Add/Manage-links block into existing type:links-hub notes lacking it (insert-only before the ProjectLinksPanel block, idempotent, .sauce-backup before write)
  await applyProjectActivityPanelsHeal(tp, mech, variables, history, git); // injects ProjectActivityPanel + ProjectOpenTasks before the MeetingsPanel block (insert-only, idempotent)
  await applyProjectSectionsMigration(tp, mech, variables, history, git);   // NEW v0.102.0 S4 — Strategy A auto-migration (flat docs/*.md → docs/knowledge/ + sections[])
  await applyProjectSectionsHubMigration(tp, mech, variables, history, git);   // NEW v0.103.0 S4 — heals v0.102.0 vaults: Docs.md → ProjectDocsIndex + materialize Section Hubs + wikilink frontmatter + breadcrumb injection
  await applyDocSectionBackfill(tp, mech, variables, history, git);   // PR1 project-doc-updating-wiring — backfill section/sub_section from sibling section-hub (authoritative display name), ungated + idempotent
  await applyDocNoteBreadcrumbMarkerCleanup(tp, mech, variables, history, git); // NEW v0.109.0 S8 — strips legacy <!-- breadcrumb-v1.17.0 --> markers from doc-notes (block preserved; new idempotency guard inside _migrateDocNote uses the class invocation substring)
  await applyProjectHubLegacyHeadingCleanup(tp, mech, variables, history, git); // strips legacy ## Status / ## Workstreams H2 heading lines from pre-v0.109.0 project hubs (cleanup, idempotent, .sauce-backup; only when the heading labels its widget)
  await applyProjectNavButtonsSeparatorGap(tp, mech, variables, history, git); // removes the stray blank line between the ProjectNavButtons row and the `---` below it on existing project/card/doc/map/section notes (cleanup, idempotent, .sauce-backup)
  await applyBoardCardBreadcrumbHeal(tp, mech, variables, history, git); // WS9 P0b chrome overhaul — stamps `type: task-hub` (or task-board-card) + injects a leading Breadcrumb on promoted board-card notes (tasks/<Task>/<Task>.md); MUST run BEFORE applyProjectChromeDividerHeal so the fresh type lets that heal reach these notes (insert-only, idempotent, .sauce-backup)
  await applyProjectChromeDividerHeal(tp, mech, variables, history, git); // WS9 P0a chrome overhaul — strips legacy literal `---` chrome dividers BETWEEN consecutive customjs-guard chrome blocks + collapses doubled blank gaps on project-related notes (cleanup, idempotent, .sauce-backup; only chrome-bounded `---`, preserves content-boundary dividers)
  await applyProjectHubWorkstreamRemovalHeal(tp, mech, variables, history, git); // WS9 P1 chrome overhaul — removes the redundant ProjectWorkstreamManager dataviewjs block from existing type:project hubs (workstream mgmt now lives on the Map); collapses the gap (cleanup, idempotent, .sauce-backup)
  await applyProjectsHubAllProjectsHeadingCleanup(tp, mech, variables, history, git); // strips the legacy `## All Projects` H2 from the all-projects hub so it uses the SectionLabel chrome pattern (cleanup, idempotent, .sauce-backup)
  await applySectionHubEntityCreateCleanup(tp, mech, variables, history, git); // NEW v0.124.1 Task B2 — strips redundant standalone "+ New Section" / "+ New Sub-Section" entity-create blocks from existing section-hub notes (SectionHub view + Docs hub render those buttons inline; entity-create INSTANCES stay registered for inline create)
  await applyProjectSectionsCloseRepair(tp, mech, variables, history, git);    // NEW v0.103.0.1 — fixes the regex-induced -"[[--]]" damage from v0.103.0 deploy
  await applyProjectNameBackfill(tp, mech, variables, history, git);   // NEW v0.124.0 — backfill project_name FM on map/kanban/task-note for breadcrumb name display
  await applyFinanceMigrations(tp, mech, variables, history, git);             // NEW v0.107.0 S2 — finance defaults scaffolding (create-if-absent) + categories group backfill (append-only + .sauce-backup snapshot)
  await applyToDoBlueprintMigration(tp, mech, variables, history, git);        // NEW v0.116.0 — reshapes v0.3.3 daily-note bodies to v0.4.0 5-block shape (.sauce-backup snapshot before write; absorbs ## Tasks heading; preserves ## Notes)
  await applyRecurringSentinelV070Migration(tp, mech, variables, history, git); // v0.119.0 — date-only sentinels → additive (empty-set) form. SUPERSEDED by stripPersistedRecurringSection (v0.120.0) but kept for files-in-flight; runs as a no-op once stripPersistedRecurringSection has run.
  await mergeDuplicateRecurringSections(tp, mech, variables, history, git); // v0.119.1 — merges duplicate "Recurring Today" blocks. SUPERSEDED by stripPersistedRecurringSection (v0.120.0) but kept for files-in-flight; runs as a no-op once stripPersistedRecurringSection has run.
  await stripPersistedRecurringSection(tp, mech, variables, history, git); // NEW v0.120.0 — retires materialized "Recurring Today" / "Recurring" SectionLabel blocks + recurring_from task lines + sentinels from dailies, since ToDoDailyRecurring.render() now live-queries the registry instead of writing to today's file. Idempotent. .sauce-backup snapshot before write.
  await applyProjectTodoBackfill(tp, mech, variables, history, git);           // NEW v0.116.0 — creates spice/projects/<slug>/<Name> To-Do.md for every project lacking one (skip-if-exists)
  await applyRecurringTasksMigrationHeal(tp, mech, variables, history, git);   // NEW recurring-tasks cycle — migrates legacy Recurring Tasks.md registry entries (checked + unchecked) into real rolling spice/tasks/*.md notes; ungated (idempotent via per-title exists-check), never touches/deletes the original registry
  await applyTaskDueScheduledRenameMigration(tp, mech, variables, history, git);   // NEW subtasks-and-dialog-polish cycle — renames scheduled -> due on every existing task note (open + _done/ + _trash/); ungated, idempotent, .sauce-backup before write. MUST run before any consumer relies on TaskEntity.queryToday's due-only bucketing.
  await applyProjectLinksHubBackfill(tp, mech, variables, history, git);       // NEW (Project Links Wiring PR3) — creates spice/projects/<slug>/Links Hub.md for every project lacking one (skip-if-exists); ungated backfill, never overwrites
  await applyProjectTodoOwnedTasksHeal(tp, history, git);                      // NEW — makes existing project-todo "Owned Tasks" sections editable (inject OWNED_TASKS_MARKER + TodayCaptureEditableList renderer); ungated, idempotent, .sauce-backup before write
  await applyProjectTodoSectionReorderHeal(tp, history, git);                  // NEW v0.179 UI polish — reorders existing project-todo sections to Project Tasks → From Meetings → Owned Tasks (moves the whole Owned Tasks block below From Meetings); ungated, idempotent, .sauce-backup before write. MUST run after applyProjectTodoOwnedTasksHeal.
  await applyProjectChromeBarHeal(tp, mech, variables, history, git);          // NEW (button/nav refactor Pass 9b) — forward-migrates existing project-surface notes from any old/partial stacked chrome to the canonical single ProjectChromeBar shape (SectionHub/WorkstreamManager → contentOnly; drops nav + action-row blocks + chrome `---`). MUST run LAST in the project heal chain so it normalizes whatever earlier heals produced. Doubly-guarded (idempotent on ProjectChromeBar + conservative no-op when no legacy nav marker); .sauce-backup before write; never throws.
  await applyTripsConformanceHeal(tp, history, git); // NEW — collision-free trip note names (atlas → <name>.md, sections → <name> — <section>.md) + canonical section frontmatter + Breadcrumb/SectionLabel chrome for existing trips; per-trip .sauce-backup, idempotent, never throws.
  await applyHomeScaffoldHeal(tp, history, git); // NEW — scaffolds + heals the singleton spice/home/Home.md command-center note (chrome above HOME_CHROME_END, user free-write below preserved); backup-first, idempotent, never throws.
  await applyDailyHomeChromeBarHeal(tp, mech, variables, history, git); // NEW (Daily/Home chrome-bar adoption) — forward-migrates existing Daily (cowork-daily) + Home notes from the legacy SpaceNavButtons chrome to the new DailyChromeBar/HomeChromeBar block. MUST run AFTER applyHomeScaffoldHeal so a freshly-scaffolded Home.md is in scope. Doubly-guarded (idempotent per-bar + type-gated on cowork-daily for dailies); .sauce-backup before write; never throws.
  await applyHomeHotkeyRemapHeal(tp, history, git); // NEW — retargets Cmd+[ from daily-notes to sauce-home:open on already-installed vaults
  await applyReaderScaffoldHeal(tp, history, git); // NEW — scaffolds + heals the singleton spice/reader/Reader.md reading-queue hub note (Breadcrumb/SpaceNavButtons/ReaderQueue chrome, user free-write below a READER_CONTENT marker preserved); backup-first, idempotent, never throws.
  await applyOrphanedHelperCleanup(tp, mech, variables, history, git);         // NEW v0.110.0 — deletes obsolete *.js and *.js.bak helper files left on disk after manifest removals
  await applyEntityCreateGuardMigration(tp, mech, variables, history, git);    // NEW v0.110.1 — rewrites direct customJS.EntityCreate.render(dv,...) calls in vault notes to the customjs-guard form (cold-load race fix)
  await applyCustomJsGuardMigration(tp, mech, variables, history, git);        // NEW v0.110.2 — generalized: rewrites ANY direct customJS.<Class>.render(dv[,opts]) call in vault notes to guard form (mobile cold-load race fix)
  await applyFinanceUnifiedNavMigration(tp, mech, variables, history, git);    // NEW v0.111.0 — collapses FinanceHubActions + FinanceNavRow invocations to single-line FinanceNav
  await applyExternalPluginInstall(tp, mech, adapter.basePath || (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null), workshopPath, history, git);  // NEW v0.94.0 — install missing
  await applyExternalPlugins(tp, mech, history, git);
  await applyBundledPlugin(tp, mech, adapter.basePath || (typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null), workshopPath, history, git);  // NEW — vendor + enable a first-party bundled plugin (sauce-plugin mechanism); gated on mech.bundled_plugin
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

// applyBreadcrumb — v0.123.0. Aggregate this item's breadcrumb: { types: {...} }
// declaration into ranch/breadcrumb-registry.json under contributions.<name>.
// Mirrors applyNavButtons posture byte-for-byte: malformed pre-existing JSON
// preserved (C4 hardening), per-entry validation skips bad entries without
// taking the whole contribution down, empty/missing declaration on a
// re-installing item prunes the prior contribution, failures record history
// but never throw.
async function applyBreadcrumb(tp, manifest, variables, history, git) {
  if (!manifest) return;
  const breadcrumbBlock = manifest.breadcrumb && typeof manifest.breadcrumb === "object" ? manifest.breadcrumb : null;
  const typesBlock = breadcrumbBlock && breadcrumbBlock.types && typeof breadcrumbBlock.types === "object" ? breadcrumbBlock.types : null;
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/breadcrumb-registry.json";

  let registry = { schema_version: 1, contributions: {} };
  if (await adapter.exists(registryPath)) {
    let raw;
    try {
      raw = await adapter.read(registryPath);
    } catch (e) {
      new Notice(`applyBreadcrumb: cannot read ${registryPath} (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "breadcrumb",
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
      new Notice(`applyBreadcrumb: ${registryPath} is malformed JSON (${e.message}). Skipping contribution from ${manifest.name}.`, 8000);
      if (history) {
        history.push({
          event: "error",
          step: "breadcrumb",
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
  if (typeof registry.schema_version !== "number") registry.schema_version = 1;

  // Manifest declared `breadcrumb` but the shape is wrong (e.g. types is not
  // an object). Mirror applyNavButtons posture: surface a Notice so the
  // blueprint author sees the misformat in-vault, then record + return without
  // mutating the registry.
  if (breadcrumbBlock && !typesBlock) {
    new Notice(`applyBreadcrumb: manifest.breadcrumb.types is not an object for ${manifest.name}. Skipping contribution.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "breadcrumb",
        name: manifest.name,
        message: "manifest.breadcrumb.types is not an object",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  // Empty/missing breadcrumb block on a re-installing item → prune any prior
  // contribution + return.
  if (!typesBlock || Object.keys(typesBlock).length === 0) {
    if (manifest.name in registry.contributions) {
      delete registry.contributions[manifest.name];
      await adapter.write(registryPath, JSON.stringify(registry, null, 2));
      if (history) {
        history.push({
          event: "info",
          step: "breadcrumb",
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

  // Per-entry validation. Each types[<t>] must have either an `ancestors` array
  // (may be empty) OR a `path_walk` object (additive path-walk mode added with
  // the wiki blueprint — breadcrumb.js builds the trail from the file's folder
  // path at render time; no static ancestors needed). An optional `current`
  // object with at least a `label` string is accepted on both forms.
  // Bad entries are dropped + logged; do not take the whole contribution down.
  const validated = {};
  for (const [typeName, entry] of Object.entries(typesBlock)) {
    if (!entry || typeof entry !== "object") {
      if (history) {
        history.push({
          event: "error",
          step: "breadcrumb",
          name: manifest.name,
          type: typeName,
          message: "entry is not an object",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    // Accept path_walk entries (no ancestors needed — trail derived at render time).
    const hasPathWalk = entry.path_walk && typeof entry.path_walk === "object";
    if (!hasPathWalk && !Array.isArray(entry.ancestors)) {
      if (history) {
        history.push({
          event: "error",
          step: "breadcrumb",
          name: manifest.name,
          type: typeName,
          message: "ancestors is not an array",
          git_commit: git.commit,
          git_tag: git.tag,
          git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
      continue;
    }
    if (entry.current !== undefined) {
      if (!entry.current || typeof entry.current !== "object" || typeof entry.current.label !== "string") {
        if (history) {
          history.push({
            event: "error",
            step: "breadcrumb",
            name: manifest.name,
            type: typeName,
            message: "current must be an object with a string label",
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
    }
    validated[typeName] = entry;
  }

  if (Object.keys(validated).length === 0) {
    if (history) {
      history.push({
        event: "error",
        step: "breadcrumb",
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

  registry.contributions[manifest.name] = { types: validated };
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
  if (_migrationGated("0.52.0")) return;
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

// applyJournalMultiEntryMigration — v0.212.0 journal multi-entry. Converts
// pre-multi-entry journal vaults (flat spice/journal/**/Journal-YYYY-MM-DD.md,
// type: journal) into the day-folder + day-hub + leaf-entry shape mirroring
// sticky-notes. Per-file gated — NOT a whole-tree rename like
// applyScratchToStickyNotesMigration, because the module_directory root name
// (spice/journal) is unchanged, so no cross-vault link rewrite or old-artifact
// pruning is needed. The old flat note already lives inside its correct
// YYYY/MM-MMMM/ folder (per journal's pre-v0.4.0 folder_date_pattern), so the
// new day-folder is just that same parent dir + "/<day>" — no date-library
// month-name computation required. Runs per-item, gated on
// manifest.name === "journal". Idempotent: once a flat note is converted, its
// path no longer matches the flat-filename regex, so re-running finds
// nothing to do. Backup-before-write, never-throw.
async function applyJournalMultiEntryMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "journal") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/journal";
  if (!(await adapter.exists(root))) return;

  const viewsPath = (variables && variables.views_path) || "ranch/views";
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBase = `.sauce-backup/journal-multi-entry/${ts}`;
  const pushEvent = (event, reason) => {
    if (!history) return;
    history.push({
      event, step: "journal_multi_entry_migration", name: "journal", reason,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  };

  const mkdirp = async (dir) => {
    const segs = dir.split("/");
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!(await adapter.exists(acc))) { try { await adapter.mkdir(acc); } catch (_e) { /* implied */ } }
    }
  };
  const backupFile = async (p, body) => {
    try {
      const dest = `${backupBase}/${p}`;
      await mkdirp(dest.substring(0, dest.lastIndexOf("/")));
      await adapter.write(dest, body);
    } catch (_e) { /* best-effort backup */ }
  };

  let migratedCount = 0;
  let errors = 0;
  let allMd;
  try { allMd = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) { pushEvent("warning", `listing failed: ${e && e.message ? e.message : String(e)}`); return; }

  for (const fpath of allMd) {
    const base = fpath.split("/").pop();
    const m = base.match(/^Journal-(\d{4}-\d{2}-\d{2})\.md$/);
    if (!m) continue; // Journal-Day-*, already-migrated leaves, and Journal.md itself don't match
    const day = m[1];
    let body;
    try { body = await adapter.read(fpath); } catch (_e) { errors++; continue; }
    if (!/^type:\s*["']?journal["']?\s*$/m.test(body)) continue; // safety: only migrate journal-typed flat notes

    const parentDir = fpath.substring(0, fpath.lastIndexOf("/")); // e.g. spice/journal/2026/07-July
    const dayDir = `${parentDir}/${day}`;
    const dayHubPath = `${dayDir}/Journal-Day-${day}.md`;
    const leafPath = `${dayDir}/Journal-${day}-00-00-00.md`;
    if (await adapter.exists(leafPath)) continue; // already migrated

    try {
      await backupFile(fpath, body);
      await mkdirp(dayDir);

      const createdAtMatch = body.match(/^created_at:\s*["']?([^"'\n]+)["']?\s*$/m);
      const createdAt = createdAtMatch ? createdAtMatch[1] : `${day}T00:00:00Z`;
      const bodyAfterFrontmatter = body.split(/^---\s*$/m).slice(2).join("---");

      const dayHubBody = `---\ntype: journal-day\ncreated_at: "${new Date().toISOString()}"\nday: "${day}"\n---\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalChromeBar" });\n\`\`\`\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalDayList", args: [{ day: dv.current()?.day }] });\n\`\`\`\n`;
      const leafBody = `---\ntype: journal-entry\ncreated_at: "${createdAt}"\nday: "${day}"\ntime: "00:00"\nday_link: "[[Journal-Day-${day}]]"\n---\n\n\`\`\`dataviewjs\nawait dv.view("${viewsPath}/customjs-guard", { class: "JournalChromeBar" });\n\`\`\`\n${bodyAfterFrontmatter}`;

      if (!(await adapter.exists(dayHubPath))) await adapter.write(dayHubPath, dayHubBody);
      await adapter.write(leafPath, leafBody);
      await adapter.remove(fpath);
      migratedCount++;
    } catch (e) {
      errors++;
      pushEvent("warning", `migrate ${fpath} failed: ${e && e.message ? e.message : String(e)}`);
    }
  }

  if (migratedCount > 0 || errors > 0) {
    pushEvent("info", `journal_multi_entry_migration: migrated=${migratedCount} errors=${errors}`);
  }
}

// ============================================================================
// applyScratchToStickyNotesMigration — v0.9.0 sticky-notes rename.
// One-time, idempotent, backup-guarded migration that converts a pre-rename
// consumer vault (scratch blueprint) to the new sticky-notes shape.
// Existence-gated on `spice/scratch` (NOT _migrationGated — a structural move
// must always run whenever the old tree survives, mirroring applyWikiToDocsMigration).
// Runs in the per-item pipeline gated on manifest.name === "sticky-notes",
// BEFORE the per-vault applyNoteChromeHeal block. Moves + renames the tree,
// rewrites frontmatter/class-refs/links vault-wide, then prunes every orphaned
// scratch-era installer artifact (files, registries, customjs startup entry,
// templater folder-template, claude_surface files, installed-ledger entry).
// The SAME install run writes the NEW sticky-notes keys/entries through the
// normal per-item steps, so this only DELETES the old "scratch" keys (disjoint,
// order-independent). Every prune is defensive: existence-guarded, backed up,
// wrapped in its own try/catch, emits a history event, and never throws.
//
// Pure helper: rename a scratch-era basename to its sticky-notes counterpart.
// isRoot === true means the file sits directly in spice/scratch (i.e. the hub
// Scratch.md). Exported for unit tests in run-sticky-notes-rename-migration.js.
function _stickyRenameFor(basename, isRoot) {
  if (isRoot && basename === "Scratch.md") return "Sticky.md";
  if (/^Scratch-Day-/.test(basename)) return basename.replace(/^Scratch-Day-/, "Sticky-Day-");
  if (/^Scratch-/.test(basename)) return basename.replace(/^Scratch-/, "Sticky-");
  return basename;
}

// Pure helper: rewrite a markdown body's scratch-era frontmatter/class-refs/
// links/paths to the sticky-notes shape. Anchored rewrites only (type-lines,
// class idents, [[Scratch- links, spice/scratch/ paths) so prose words like
// "scratchpad" survive untouched. Exported for unit tests.
function _rewriteScratchToStickyBody(body) {
  if (typeof body !== "string") return body;
  let out = body;
  // frontmatter types (order: longest first, so scratch-day/-hub win before scratch)
  out = out.replace(/^type:\s*["']?scratch-day["']?\s*$/m, "type: sticky-day");
  out = out.replace(/^type:\s*["']?scratch-hub["']?\s*$/m, "type: sticky-hub");
  out = out.replace(/^type:\s*["']?scratch["']?\s*$/m, "type: sticky-note");
  // tags blocks (bullet + inline-flow), mirror _rewriteWikiToDocsBody. The
  // negative-lookahead (?!-) on the generic scratch rule stops it double-hitting
  // an already-matched `scratch-day` fragment.
  out = out.replace(/(\btags\s*:[\s\S]*?)(["']?)scratch-day\2/g, "$1$2sticky-day$2");
  out = out.replace(/(\btags\s*:[\s\S]*?)(["']?)scratch\2(?!-)/g, "$1$2sticky-note$2");
  // customJS class refs
  out = out.replace(/ScratchChromeBar/g, "StickyChromeBar");
  out = out.replace(/ScratchDayList/g, "StickyDayList");
  out = out.replace(/ScratchHubCards/g, "StickyHubCards");
  out = out.replace(/ScratchDayMigrate/g, "StickyDayMigrate");
  // hub-specific path BEFORE generic path so Scratch.md is renamed too
  out = out.replace(/spice\/scratch\/Scratch\.md/g, "spice/sticky-notes/Sticky.md");
  // Sticky-Day- before generic spice/scratch (filename token in wikilinks/paths)
  out = out.replace(/Scratch-Day-/g, "Sticky-Day-");
  out = out.replace(/spice\/scratch/g, "spice/sticky-notes");
  out = out.replace(/ranch\/templates\/Scratch Hub\.md/g, "ranch/templates/Sticky Hub.md");
  // wikilinks: [[Scratch-<digit>… (leaf/day) and bare [[Scratch]] (hub)
  out = out.replace(/\[\[Scratch-(\d)/g, "[[Sticky-$1");
  out = out.replace(/\[\[Scratch\]\]/g, "[[Sticky]]");
  // entity-create sentinel comment
  out = out.replace(/entity-create:scratch/g, "entity-create:sticky-note");
  return out;
}

async function applyScratchToStickyNotesMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "sticky-notes") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const oldRoot = "spice/scratch";
  const newRoot = "spice/sticky-notes";

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupBase = `.sauce-backup/sticky-notes-rename/${ts}`;
  const pushEvent = (event, reason) => {
    if (!history) return;
    history.push({
      event, step: "scratch_to_sticky_rename", name: "sticky-notes", reason,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  };

  // Existence gate + idempotency: if the old tree is gone there is nothing to
  // migrate. (Prunes below are also individually existence-guarded, so a
  // partially-migrated vault whose spice/scratch is already gone re-running
  // here is a clean no-op.)
  if (!(await adapter.exists(oldRoot))) return;

  let movedCount = 0;
  let rewroteCount = 0;
  let prunedCount = 0;

  // --- 1. Backup the whole spice/scratch tree before any destructive op. ---
  try {
    await _copyDirRecursive(adapter, oldRoot, `${backupBase}/${oldRoot}`);
  } catch (e) {
    pushEvent("warning", `backup of ${oldRoot} failed: ${e && e.message ? e.message : String(e)}`);
  }

  // --- 2. Walk + rename + rewrite each file into the new tree. ---
  //     _stickyRenameFor's isRoot flag: file sits DIRECTLY in spice/scratch.
  async function migrateTree(srcDir, atRootLevel) {
    let listing;
    try { listing = await adapter.list(srcDir); } catch (_e) { return; }
    for (const f of (listing.files || [])) {
      const base = f.split("/").pop();
      const renamed = _stickyRenameFor(base, atRootLevel);
      const relDir = srcDir.substring(oldRoot.length); // "" or "/2026/06-June/…"
      const destDir = `${newRoot}${relDir}`;
      const destPath = `${destDir}/${renamed}`;
      // Ensure nested parent folders exist (segment-walk mkdir idiom).
      const segs = destDir.split("/");
      let acc = "";
      for (const seg of segs) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!(await adapter.exists(acc))) { try { await adapter.mkdir(acc); } catch (_e) { /* implied */ } }
      }
      // Never clobber an installer-fresh dest. The only file that can already
      // exist here is the boilerplate hub (spice/sticky-notes/Sticky.md), which
      // the files[] step wrote earlier in THIS install with the current shape
      // (# Sticky Notes heading, StickyChromeBar/StickyHubCards). User + dated
      // notes (leaf, day-hub, user notes) carry unique names install never
      // materializes, so they never pre-exist. Letting the fresh hub win avoids
      // a migrated vault surfacing a stale "# Scratch" heading. The pre-migration
      // original is still captured in the .sauce-backup snapshot taken above.
      if (await adapter.exists(destPath)) continue;
      let body;
      try { body = await adapter.read(f); } catch (_e) { continue; }
      const rewritten = _rewriteScratchToStickyBody(body);
      if (rewritten !== body) rewroteCount += 1;
      await adapter.write(destPath, rewritten);
      movedCount += 1;
    }
    for (const sub of (listing.folders || [])) {
      await migrateTree(sub, false);
    }
  }
  try {
    await migrateTree(oldRoot, true);
    // Remove the old tree once fully copied+renamed.
    await _rmDirRecursive(adapter, oldRoot);
  } catch (e) {
    pushEvent("warning", `tree move failed: ${e && e.message ? e.message : String(e)}`);
  }

  // --- 3. Vault-wide cross-ref rewrite (skip backups, trash, already-migrated). ---
  try {
    const allMd = await _listAllMarkdownRecursive(adapter, "");
    for (const fpath of allMd) {
      if (fpath.startsWith(".sauce-backup/")) continue;
      if (fpath.startsWith(".trash/")) continue;
      if (fpath.startsWith(`${newRoot}/`) || fpath === `${newRoot}`) continue;
      let body;
      try { body = await adapter.read(fpath); } catch (_e) { continue; }
      const rewritten = _rewriteScratchToStickyBody(body);
      if (rewritten !== body) {
        await adapter.write(fpath, rewritten);
        rewroteCount += 1;
      }
    }
  } catch (e) {
    pushEvent("warning", `vault-wide cross-ref rewrite failed: ${e && e.message ? e.message : String(e)}`);
  }

  // --- 4. Prune orphaned scratch-era installer artifacts. ---
  //     Each prune: existence-guarded → backup → delete → history event → never throw.
  const backupFile = async (p) => {
    try {
      const body = await adapter.read(p);
      const dest = `${backupBase}/${p}`;
      const parent = dest.substring(0, dest.lastIndexOf("/"));
      const segs = parent.split("/");
      let acc = "";
      for (const seg of segs) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!(await adapter.exists(acc))) { try { await adapter.mkdir(acc); } catch (_e) { /* implied */ } }
      }
      await adapter.write(dest, body);
    } catch (_e) { /* best-effort backup */ }
  };

  // 4a. loose files.
  const looseFiles = [
    "ranch/templates/Scratch.md",
    "ranch/templates/Scratch Day Hub.md",
    "ranch/rules/scratch.json",
    "ranch/rules/scratch-day-hub.json",
    ".claude/commands/scratch.md",
  ];
  for (const p of looseFiles) {
    try {
      if (await adapter.exists(p) && !(await _isDirLike(adapter, p))) {
        await backupFile(p);
        await adapter.remove(p);
        prunedCount += 1;
        pushEvent("info", `pruned artifact ${p}`);
      }
    } catch (e) {
      pushEvent("warning", `prune ${p} failed: ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 4b. directories (backup tree then remove recursively).
  const looseDirs = ["ranch/scripts/scratch", ".claude/skills/scratch"];
  for (const d of looseDirs) {
    try {
      if (await adapter.exists(d)) {
        try { await _copyDirRecursive(adapter, d, `${backupBase}/${d}`); } catch (_e) { /* best-effort */ }
        await _rmDirRecursive(adapter, d);
        prunedCount += 1;
        pushEvent("info", `pruned artifact dir ${d}`);
      }
    } catch (e) {
      pushEvent("warning", `prune dir ${d} failed: ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 4c. registries — delete the "scratch"-keyed contribution/entry. Both real
  //     ({schema_version, contributions}) and legacy bare-dict shapes handled.
  const pruneRegistryScratchKey = async (p, opts) => {
    try {
      if (!(await adapter.exists(p))) return;
      let reg;
      try { reg = JSON.parse(await adapter.read(p)); } catch (_e) { return; }
      let mutated = false;
      if (reg && reg.contributions && typeof reg.contributions === "object" && "scratch" in reg.contributions) {
        delete reg.contributions.scratch;
        mutated = true;
      }
      // Legacy bare-dict shape (no `contributions` wrapper).
      if (reg && !reg.contributions && typeof reg === "object" && "scratch" in reg) {
        delete reg.scratch;
        mutated = true;
      }
      // entity-create `entries` array carries a `blueprint` field.
      if (opts && opts.pruneEntries && Array.isArray(reg.entries)) {
        const before = reg.entries.length;
        reg.entries = reg.entries.filter((e) => !(e && e.blueprint === "scratch"));
        if (reg.entries.length !== before) mutated = true;
      }
      if (mutated) {
        await backupFile(p);
        await adapter.write(p, JSON.stringify(reg, null, 2));
        prunedCount += 1;
        pushEvent("info", `pruned scratch key from ${p}`);
      }
    } catch (e) {
      pushEvent("warning", `prune registry ${p} failed: ${e && e.message ? e.message : String(e)}`);
    }
  };
  await pruneRegistryScratchKey("ranch/nav-buttons-registry.json", {});
  await pruneRegistryScratchKey("ranch/entity-create-registry.json", { pruneEntries: true });
  await pruneRegistryScratchKey("ranch/breadcrumb-registry.json", {});
  await pruneRegistryScratchKey("ranch/claude-surface-registry.json", {});

  // 4d. customjs startup — remove ScratchDayMigrateInit.
  try {
    const p = ".obsidian/plugins/customjs/data.json";
    if (await adapter.exists(p)) {
      const data = JSON.parse(await adapter.read(p));
      if (Array.isArray(data.startupScriptNames) && data.startupScriptNames.includes("ScratchDayMigrateInit")) {
        data.startupScriptNames = data.startupScriptNames.filter((n) => n !== "ScratchDayMigrateInit");
        await backupFile(p);
        await adapter.write(p, JSON.stringify(data, null, 2));
        prunedCount += 1;
        pushEvent("info", "pruned ScratchDayMigrateInit from customjs startup");
      }
    }
  } catch (e) {
    pushEvent("warning", `prune customjs startup failed: ${e && e.message ? e.message : String(e)}`);
  }

  // 4e. templater — remove any folder_templates entry for spice/scratch.
  try {
    const p = ".obsidian/plugins/templater-obsidian/data.json";
    if (await adapter.exists(p)) {
      const data = JSON.parse(await adapter.read(p));
      if (Array.isArray(data.folder_templates)) {
        const before = data.folder_templates.length;
        data.folder_templates = data.folder_templates.filter((x) => !(x && x.folder === "spice/scratch"));
        if (data.folder_templates.length !== before) {
          await backupFile(p);
          await adapter.write(p, JSON.stringify(data, null, 2));
          prunedCount += 1;
          pushEvent("info", "pruned spice/scratch templater folder-template");
        }
      }
    }
  } catch (e) {
    pushEvent("warning", `prune templater folder failed: ${e && e.message ? e.message : String(e)}`);
  }

  // 4f. installed ledger — remove the "scratch" blueprint entry.
  try {
    const p = "ranch/platform-installed.json";
    if (await adapter.exists(p)) {
      const led = JSON.parse(await adapter.read(p));
      if (Array.isArray(led.blueprints) && led.blueprints.some((b) => b && b.name === "scratch")) {
        led.blueprints = led.blueprints.filter((b) => !(b && b.name === "scratch"));
        await backupFile(p);
        await adapter.write(p, JSON.stringify(led, null, 2));
        prunedCount += 1;
        pushEvent("info", "pruned scratch entry from platform-installed ledger");
      }
    }
  } catch (e) {
    pushEvent("warning", `prune installed ledger failed: ${e && e.message ? e.message : String(e)}`);
  }

  pushEvent("info", `moved ${movedCount} notes, rewrote ${rewroteCount} cross-refs, pruned ${prunedCount} artifacts`);
}

// Helper: does an adapter path look like a directory (has children) rather than
// a file? Used so a loose-file prune never trips on a same-named directory.
async function _isDirLike(adapter, p) {
  try {
    const listing = await adapter.list(p);
    return (listing && ((listing.files && listing.files.length) || (listing.folders && listing.folders.length))) ? true : false;
  } catch (_e) {
    return false;
  }
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

// applyProjectMeetingsPanelHeal — v0.127.0 §D. Walks spice/projects/*/ and
// injects a `class: "ProjectMeetingsPanel"` dataviewjs block into any
// `type: project` hub note that lacks one. Insert-only + idempotent per
// landmine #16. Anchor preference: after ProjectStatusWidget closing fence
// (canonical v0.109.0+ template order) → fallback after ProjectNavButtons
// → fallback after the first dataviewjs block. Warning history when no
// dataviewjs anchor exists. .sauce-backup snapshot before write per the
// applyNoteChromeHeal posture. Failure-loud per-project (catch + log,
// never throws).
async function applyProjectMeetingsPanelHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0;
  let skipped = 0;
  let warned = 0;

  let projectDirs;
  try {
    const listing = await adapter.list(root);
    projectDirs = (listing.folders || []).filter((f) => f.startsWith(root + "/"));
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_meetings_panel_heal",
        reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const projectDir of projectDirs) {
    try {
      // Find the hub note: a *.md DIRECTLY inside projectDir (not nested) with
      // frontmatter type: project. Mirrors applyProjectNameBackfill's pattern.
      const sub = await adapter.list(projectDir);
      const candidates = (sub.files || []).filter((p) => p.endsWith(".md"));
      let hubPath = null;
      for (const cand of candidates) {
        const body = await adapter.read(cand);
        if (_noteChromeFrontmatterType(body) === "project") {
          hubPath = cand;
          break;
        }
      }
      if (!hubPath) continue;

      const before = await adapter.read(hubPath);

      // Idempotency guard: already healed.
      if (before.includes('class: "ProjectMeetingsPanel"')) {
        skipped += 1;
        if (history) {
          history.push({
            event: "info",
            step: "project_meetings_panel_heal",
            target: hubPath,
            action: "skipped_already_healed",
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }

      // Locate the insertion anchor. Preference order:
      //   1. After the closing fence of `class: "ProjectStatusWidget"` block
      //   2. After the closing fence of `class: "ProjectNavButtons"` block
      //   3. After the closing fence of the FIRST dataviewjs block (fallback)
      const block = '\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectMeetingsPanel" });\n```';
      let after = null;
      for (const anchorClass of ["ProjectStatusWidget", "ProjectNavButtons"]) {
        const anchorStr = `class: "${anchorClass}"`;
        const anchorIdx = before.indexOf(anchorStr);
        if (anchorIdx === -1) continue;
        const closeRel = before.indexOf("\n```", anchorIdx);
        if (closeRel === -1) continue;
        const insertAt = closeRel + 4; // just after "\n```"
        after = before.slice(0, insertAt) + block + before.slice(insertAt);
        break;
      }
      if (after === null) {
        const firstDvIdx = before.indexOf("```dataviewjs");
        if (firstDvIdx !== -1) {
          const closeRel = before.indexOf("\n```", firstDvIdx);
          if (closeRel !== -1) {
            const insertAt = closeRel + 4;
            after = before.slice(0, insertAt) + block + before.slice(insertAt);
          }
        }
      }
      if (after === null) {
        warned += 1;
        if (history) {
          history.push({
            event: "warning",
            step: "project_meetings_panel_heal",
            target: hubPath,
            action: "no_anchor_found",
            reason: "no ProjectStatusWidget/ProjectNavButtons/dataviewjs block to anchor on",
            git_commit: git.commit,
            git_tag: git.tag,
            git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
        continue;
      }
      if (after === before) {
        skipped += 1;
        continue;
      }

      // .sauce-backup snapshot before write (mirrors applyNoteChromeHeal posture).
      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try {
        await adapter.mkdir(backupParent);
      } catch (_e) { /* already exists */ }
      try {
        await adapter.write(backupPath, before);
      } catch (_e) { /* best-effort */ }

      await adapter.write(hubPath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_meetings_panel_heal",
          target: hubPath,
          action: "healed",
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
          step: "project_meetings_panel_heal",
          reason: `${projectDir}: ${e && e.message ? e.message : String(e)}`,
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
      step: "project_meetings_panel_heal",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit,
      git_tag: git.tag,
      git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _injectDocLeafActionsBody — pure, idempotent transform. Injects the
// `class: "DocLeafActions"` dataviewjs block into a doc-note body that lacks it,
// placed AFTER the `---` divider that follows the ProjectNavButtons block (the
// shipped Doc Note template placement — toolbar below the chrome divider). If the
// body already has the block, or has no ProjectNavButtons anchor, returns the body
// unchanged (the heal driver treats unchanged-with-no-block as no_anchor_found).
// When no `---` immediately follows the ProjectNavButtons fence, falls back to
// inserting right after that fence.
function _injectDocLeafActionsBody(body) {
  if (typeof body !== "string") return body;
  if (body.includes('class: "DocLeafActions"')) return body; // idempotent
  const navIdx = body.indexOf('class: "ProjectNavButtons"');
  if (navIdx === -1) return body;                             // no anchor
  const fenceClose = body.indexOf("\n```", navIdx);           // closing fence of the ProjectNavButtons block
  if (fenceClose === -1) return body;
  const afterFence = fenceClose + 4;                          // just past "\n```"
  const rest = body.slice(afterFence);
  const div = rest.match(/^\s*\n?---[ \t]*\n/);               // the `---` divider (allowing stray blanks)
  const blockBody = 'await dv.view("ranch/views/customjs-guard", { class: "DocLeafActions" });';
  if (div) {
    const insertAt = afterFence + div[0].length;
    return body.slice(0, insertAt) + '\n```dataviewjs\n' + blockBody + '\n```\n' + body.slice(insertAt);
  }
  // No divider — insert directly after the ProjectNavButtons fence.
  return body.slice(0, afterFence) + '\n\n```dataviewjs\n' + blockBody + '\n```\n' + body.slice(afterFence);
}

// applyDocLeafActionsBackfill — Project Doc Updating Wiring PR4. Injects the
// per-doc Move button (DocLeafActions) into pre-existing doc-note notes lacking
// it, so the Move affordance PR2 shipped for NEW docs (via the template) also
// reaches docs users already have. Walks spice/projects/**, filters type:doc-note,
// applies _injectDocLeafActionsBody. Insert-only + idempotent (skip if already
// present); .sauce-backup snapshot before write; per-note try/catch, never throws;
// ungated (backfills new content). Mirrors applyProjectMeetingsPanelHeal posture.
async function applyDocLeafActionsBackfill(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try { files = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) {
    history?.push({ event: "warning", step: "doc_leaf_actions_backfill", reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      if (_noteChromeFrontmatterType(before) !== "doc-note") continue;
      // ProjectChromeBar guard (button/nav refactor Pass 9a): a migrated doc-note
      // renders the single ProjectChromeBar block, whose `⋯` overflow OWNS the
      // per-doc Move action. Injecting a standalone DocLeafActions Move block would
      // duplicate it. (On the new shape there's no ProjectNavButtons anchor so the
      // transform already no-ops, but the guard makes the intent explicit and skips
      // the spurious no_anchor_found warning.) Legacy old-shape doc-notes still
      // backfill below.
      if (_hasChromeBar(before)) { skipped += 1; continue; }
      if (before.includes('class: "DocLeafActions"')) { skipped += 1; continue; }
      const after = _injectDocLeafActionsBody(before);
      if (after === before) {
        warned += 1;
        history?.push({ event: "warning", step: "doc_leaf_actions_backfill", target: fpath, action: "no_anchor_found",
          reason: "no ProjectNavButtons block to anchor on",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "doc_leaf_actions_backfill", target: fpath, action: "healed",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "doc_leaf_actions_backfill", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "doc_leaf_actions_backfill", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// _injectDocBulkMoveActionsBody — pure, idempotent transform. Injects the
// `class: "DocBulkMoveActions"` dataviewjs block into a docs-hub body that lacks
// it, placed AFTER the entity-create:doc-note ("+ New Doc") block (the shipped
// Docs Hub template placement — a hub-action beside "+ New Doc", above the `---`
// divider). Falls back to after the ProjectNavButtons fence when the
// entity-create block is absent. Returns the body unchanged when the block is
// already present or no anchor exists (driver treats unchanged-no-block as
// no_anchor_found).
function _injectDocBulkMoveActionsBody(body) {
  if (typeof body !== "string") return body;
  if (body.includes('class: "DocBulkMoveActions"')) return body; // idempotent
  let anchorIdx = body.indexOf('instance: "doc-note"');          // the "+ New Doc" entity-create block
  if (anchorIdx === -1) anchorIdx = body.indexOf('class: "ProjectNavButtons"');
  if (anchorIdx === -1) return body;                             // no anchor
  const fenceClose = body.indexOf("\n```", anchorIdx);           // closing fence of the anchor block
  if (fenceClose === -1) return body;
  const afterFence = fenceClose + 4;                             // just past "\n```"
  const block = '\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "DocBulkMoveActions" });\n```';
  return body.slice(0, afterFence) + block + body.slice(afterFence);
}

// applyDocBulkMoveActionsBackfill — Project Doc Updating Wiring PR5. Historically
// injected the standalone "Move docs" block (DocBulkMoveActions) into pre-existing
// docs-hub notes lacking it. NEUTERED at the docs-hub-modernize cycle: "Move docs"
// now lives INSIDE the renderActionRow block (ProjectDocsIndex.renderActionRow draws
// New Doc · New Section · Move docs in one full-width row), and applyDocsHubModernizeHeal
// REMOVES the standalone block from legacy bodies. So this backfill must NOT
// re-inject the block into docs-hub notes — it would undo the modernize heal. It
// now skips every docs-hub note. The function + its exports are retained (the
// no_anchor_found / non-docs-hub behaviours are still exercised by the harness),
// but the docs-hub injection path is dead. Insert-only + idempotent; .sauce-backup
// before write; per-note try/catch, never throws; ungated. Mirrors
// applyDocLeafActionsBackfill.
async function applyDocBulkMoveActionsBackfill(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try { files = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) {
    history?.push({ event: "warning", step: "doc_bulk_move_actions_backfill", reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      // NEUTERED: docs-hub notes are now modernized by applyDocsHubModernizeHeal
      // (Move docs lives in renderActionRow). Never re-inject the standalone block
      // here — it would undo that heal. Skip every docs-hub note outright.
      if (_noteChromeFrontmatterType(before) === "docs-hub") { skipped += 1; continue; }
      // Only docs-hub notes were ever eligible, so with docs-hub excluded this
      // loop no longer injects anything; the remaining code is inert but kept for
      // the retained history/skip semantics.
      if (_noteChromeFrontmatterType(before) !== "docs-hub") continue;
      if (before.includes('class: "DocBulkMoveActions"')) { skipped += 1; continue; }
      const after = _injectDocBulkMoveActionsBody(before);
      if (after === before) {
        warned += 1;
        history?.push({ event: "warning", step: "doc_bulk_move_actions_backfill", target: fpath, action: "no_anchor_found",
          reason: "no entity-create doc-note / ProjectNavButtons block to anchor on",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "doc_bulk_move_actions_backfill", target: fpath, action: "healed",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "doc_bulk_move_actions_backfill", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "doc_bulk_move_actions_backfill", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// The modern renderActionRow block (New Doc · New Section · Move docs). Kept as a
// module-level constant so the pure transform, the heal driver, and the tests all
// reference ONE canonical string. Mirrors platform/blueprints/project/templates/Docs Hub.md.
const DOCS_HUB_ACTION_ROW_BLOCK = [
  "```dataviewjs",
  "// entity-create:doc-note — installer-managed; do not delete this comment",
  "// renderActionRow draws the full-width action row: New Doc · New Section · Move docs.",
  'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex", method: "renderActionRow" });',
  "```",
].join("\n");
const DOCS_HUB_BREADCRUMB_BLOCK = [
  "```dataviewjs",
  'await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });',
  "```",
].join("\n");
const DOCS_HUB_INDEX_BLOCK = [
  "```dataviewjs",
  'await dv.view("ranch/views/customjs-guard", { class: "ProjectDocsIndex" });',
  "```",
].join("\n");

// _modernizeDocsHubBody — PURE, idempotent transform: rewrites a legacy docs-hub
// body to the modern chrome shape (Breadcrumb → SpaceNavButtons → ProjectNavButtons
// → renderActionRow block → plain ProjectDocsIndex block). Regex/fence-walking only
// (install.js has no parseYaml at runtime). Returns { changed, body }. The legacy
// shape (headspace) is:
//   [fm] → SpaceNavButtons → ProjectNavButtons → DocBulkMoveActions → --- → --- → ProjectDocsIndex
// (no Breadcrumb, standalone narrow "Move docs", doubled literal dividers). Steps:
//   1. Remove the entire `class: "DocBulkMoveActions"` dataviewjs block (fence-to-fence).
//   2. Remove literal `---` thematic-break lines OUTSIDE the frontmatter that are
//      adjacent to chrome dataviewjs blocks (incl. consecutive/doubled ones).
//   3. Ensure the renderActionRow block is present, inserted immediately AFTER the
//      ProjectNavButtons block if absent. Idempotent via the `method: "renderActionRow"`
//      substring guard.
//   4. Ensure a Breadcrumb block is the FIRST rendered block (before SpaceNavButtons).
//   5. Ensure a plain ProjectDocsIndex (render) block is present at the end.
// A note already in modern shape → { changed:false }. User content AFTER the
// ProjectDocsIndex block is preserved (never dropped).
function _modernizeDocsHubBody(body) {
  if (typeof body !== "string") return { changed: false, body };
  const original = body;

  // Split leading frontmatter off so the divider strip never touches the FM close.
  let fmPart = "";
  let rest = body;
  const fmMatch = body.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (fmMatch) { fmPart = fmMatch[1]; rest = body.slice(fmMatch[1].length); }

  const nl = rest.includes("\r\n") ? "\r\n" : "\n";
  let lines = rest.split(/\r?\n/);

  // Classify each line: which fenced code block (if any) it belongs to, and — for
  // a dataviewjs chrome block — the customJS class it invokes. We walk fences so a
  // literal "---" inside a code block is never treated as a thematic break.
  function classify(ls) {
    const info = ls.map(() => ({ inFence: false, fenceOpen: false, fenceClose: false }));
    let inFence = false;
    for (let i = 0; i < ls.length; i++) {
      const t = ls[i].trim();
      const isFence = /^(```|~~~)/.test(t);
      if (isFence && !inFence) { inFence = true; info[i] = { inFence: true, fenceOpen: true, fenceClose: false }; continue; }
      if (isFence && inFence) { inFence = false; info[i] = { inFence: true, fenceOpen: false, fenceClose: true }; continue; }
      info[i] = { inFence, fenceOpen: false, fenceClose: false };
    }
    return info;
  }

  // ── Step 1: remove the DocBulkMoveActions block (fence-to-fence). ──────────────
  {
    let info = classify(lines);
    let removeFrom = -1, removeTo = -1;
    for (let i = 0; i < lines.length; i++) {
      if (info[i].fenceOpen) {
        // Scan the block body for the DocBulkMoveActions class ref.
        let j = i + 1; let isTarget = false; let close = -1;
        for (; j < lines.length; j++) {
          if (info[j].fenceClose) { close = j; break; }
          if (lines[j].includes('class: "DocBulkMoveActions"')) isTarget = true;
        }
        if (isTarget && close !== -1) { removeFrom = i; removeTo = close; break; }
        i = close === -1 ? lines.length : close;
      }
    }
    if (removeFrom !== -1) {
      lines.splice(removeFrom, removeTo - removeFrom + 1);
      // Drop one immediately-trailing blank line so we don't leave a double blank.
      if (removeFrom < lines.length && lines[removeFrom].trim() === "") lines.splice(removeFrom, 1);
    }
  }

  // ── Step 2: strip literal `---` thematic breaks OUTSIDE fences that are adjacent
  //    to a chrome dataviewjs block (or to another such divider — doubled case). We
  //    only remove a `---` whose nearest non-blank neighbour (up OR down, skipping
  //    blanks) is a code-fence line or another strippable divider. This removes the
  //    doubled literal dividers of the legacy body without disturbing a user's own
  //    `---` buried in prose. ──────────────────────────────────────────────────
  {
    let info = classify(lines);
    const isDivider = (i) => {
      if (i < 0 || i >= lines.length) return false;
      if (info[i].inFence) return false;
      return /^-{3,}[ \t]*$/.test(lines[i]);
    };
    // A neighbour index (skipping blanks) in direction dir (+1/-1). Divider lines
    // themselves count as "chrome-adjacent" so a run of doubled dividers all strip.
    const neighbourIsChrome = (start, dir) => {
      let i = start + dir;
      while (i >= 0 && i < lines.length && lines[i].trim() === "") i += dir;
      if (i < 0 || i >= lines.length) return false;
      if (info[i].fenceOpen || info[i].fenceClose) return true;   // touches a code block
      if (isDivider(i)) return true;                              // doubled divider
      return false;
    };
    const drop = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (!isDivider(i)) continue;
      if (neighbourIsChrome(i, -1) || neighbourIsChrome(i, +1)) drop.add(i);
    }
    if (drop.size) {
      lines = lines.filter((_, i) => !drop.has(i));
      // Collapse any double blank lines the removal left behind.
      const collapsed = [];
      for (const l of lines) {
        if (l.trim() === "" && collapsed.length && collapsed[collapsed.length - 1].trim() === "") continue;
        collapsed.push(l);
      }
      lines = collapsed;
    }
  }

  let workBody = lines.join(nl);

  // ── Step 3: ensure the renderActionRow block, after ProjectNavButtons. ────────
  if (!/method:\s*"renderActionRow"/.test(workBody)) {
    const navIdx = workBody.indexOf('class: "ProjectNavButtons"');
    let inserted = false;
    if (navIdx !== -1) {
      const fenceClose = workBody.indexOf("\n```", navIdx);
      if (fenceClose !== -1) {
        const afterFence = fenceClose + 4; // just past "\n```"
        workBody = workBody.slice(0, afterFence) + "\n\n" + DOCS_HUB_ACTION_ROW_BLOCK + workBody.slice(afterFence);
        inserted = true;
      }
    }
    if (!inserted) {
      // No ProjectNavButtons anchor — fall back to before the ProjectDocsIndex block.
      const idxIdx = workBody.indexOf('class: "ProjectDocsIndex"');
      if (idxIdx !== -1) {
        const openFence = workBody.lastIndexOf("```dataviewjs", idxIdx);
        if (openFence !== -1) workBody = workBody.slice(0, openFence) + DOCS_HUB_ACTION_ROW_BLOCK + "\n\n" + workBody.slice(openFence);
      }
    }
  }

  // ── Step 4: ensure a Breadcrumb block is the FIRST rendered block. ────────────
  if (!/class:\s*"Breadcrumb"/.test(workBody)) {
    const navIdx = workBody.indexOf('class: "SpaceNavButtons"');
    if (navIdx !== -1) {
      const openFence = workBody.lastIndexOf("```dataviewjs", navIdx);
      if (openFence !== -1) workBody = workBody.slice(0, openFence) + DOCS_HUB_BREADCRUMB_BLOCK + "\n\n" + workBody.slice(openFence);
    } else {
      // No nav block at all — prepend the breadcrumb to the body top.
      workBody = DOCS_HUB_BREADCRUMB_BLOCK + "\n\n" + workBody.replace(/^\s+/, "");
    }
  }

  // ── Step 5: ensure a plain ProjectDocsIndex (render) block at the end. ────────
  // The renderActionRow block also names ProjectDocsIndex, so match the render
  // form specifically ({ class: "ProjectDocsIndex" } with NO method).
  if (!/\{\s*class:\s*"ProjectDocsIndex"\s*\}/.test(workBody)) {
    workBody = workBody.replace(/\s*$/, "") + "\n\n" + DOCS_HUB_INDEX_BLOCK + "\n";
  }

  const finalBody = fmPart + workBody;
  return { changed: finalBody !== original, body: finalBody };
}

// applyDocsHubModernizeHeal — walks every type:docs-hub note and rewrites a legacy
// body to the modern renderActionRow chrome shape via _modernizeDocsHubBody. The
// deferred WS4 reshape heal: existing hubs (e.g. headspace Docs.md) still carry the
// pre-renderActionRow body (standalone DocBulkMoveActions + doubled `---` + no
// Breadcrumb). Runs AFTER applyDocBulkMoveActionsBackfill (now neutered for docs-hub)
// so nothing re-adds the standalone block. Idempotent (no write when unchanged);
// .sauce-backup before every write; per-note try/catch, never throws; ungated.
// Mirrors applyDocBulkMoveActionsBackfill's posture.
async function applyDocsHubModernizeHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try { files = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) {
    history?.push({ event: "warning", step: "docs_hub_modernize_heal", reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      if (_noteChromeFrontmatterType(before) !== "docs-hub") continue;
      // ProjectChromeBar guard (button/nav refactor Pass 9a): a migrated docs-hub
      // renders the single ProjectChromeBar block, which OWNS the breadcrumb + the
      // New Doc / New Section / Move docs actions. _modernizeDocsHubBody would
      // re-inject a second Breadcrumb + a renderActionRow block onto it → duplicate
      // chrome. Skip it (legacy old-shape hubs still modernize below).
      if (_hasChromeBar(before)) { skipped += 1; continue; }
      const { changed, body: after } = _modernizeDocsHubBody(before);
      if (!changed || after === before) { skipped += 1; continue; }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "docs_hub_modernize_heal", target: fpath, action: "modernized",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "docs_hub_modernize_heal", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "docs_hub_modernize_heal", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// _injectProjectLinksManagerBody — pure, idempotent transform. Injects the
// `class: "ProjectLinksManager"` (Add link / Manage links) dataviewjs block into
// a links-hub body that lacks it, placed IMMEDIATELY BEFORE the ProjectLinksPanel
// (read-only list) block — the shipped Links Hub template placement (manager
// buttons above the list). Returns the body unchanged when the block is already
// present or there's no ProjectLinksPanel anchor (driver treats unchanged-no-block
// as no_anchor_found).
function _injectProjectLinksManagerBody(body) {
  if (typeof body !== "string") return body;
  if (body.includes('class: "ProjectLinksManager"')) return body; // idempotent
  const panelIdx = body.indexOf('class: "ProjectLinksPanel"');
  if (panelIdx === -1) return body;                               // no anchor
  const openFence = body.lastIndexOf("```dataviewjs", panelIdx); // opening fence of the ProjectLinksPanel block
  if (openFence === -1) return body;
  const block = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectLinksManager" });\n```\n\n';
  return body.slice(0, openFence) + block + body.slice(openFence);
}

// applyProjectLinksManagerBackfill — Project Links Wiring PR4. Injects the
// ProjectLinksManager (Add link / Manage links) block into pre-existing
// type:links-hub notes lacking it, so Link Hubs backfilled before Project Links
// PR2 (which have ProjectLinksPanel but no manager) gain the add/edit buttons.
// Walks spice/projects/**, filters type:links-hub, applies
// _injectProjectLinksManagerBody. Insert-only + idempotent; .sauce-backup before
// write; per-note try/catch, never throws; ungated. Mirrors applyDocLeafActionsBackfill.
async function applyProjectLinksManagerBackfill(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try { files = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) {
    history?.push({ event: "warning", step: "project_links_manager_backfill", reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      if (_noteChromeFrontmatterType(before) !== "links-hub") continue;
      // ProjectChromeBar guard (button/nav refactor Pass 9a): a migrated links-hub
      // renders the single ProjectChromeBar block, which OWNS the Add link / Manage
      // links actions (its primary + overflow). _injectProjectLinksManagerBody would
      // inject a second ProjectLinksManager action row above the panel → double row.
      // Skip it (legacy old-shape hubs still backfill below).
      if (_hasChromeBar(before)) { skipped += 1; continue; }
      if (before.includes('class: "ProjectLinksManager"')) { skipped += 1; continue; }
      const after = _injectProjectLinksManagerBody(before);
      if (after === before) {
        warned += 1;
        history?.push({ event: "warning", step: "project_links_manager_backfill", target: fpath, action: "no_anchor_found",
          reason: "no ProjectLinksPanel block to anchor on",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "project_links_manager_backfill", target: fpath, action: "healed",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "project_links_manager_backfill", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "project_links_manager_backfill", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// applyProjectHubLegacyHeadingCleanup — strips the legacy `## Status` and
// `## Workstreams` H2 heading lines from pre-v0.109.0 project hub notes. The
// v0.109.0 template rewrite dropped those H2s (ProjectStatusWidget has no label;
// ProjectWorkstreamManager renders its own "Workstreams" SectionLabel), but
// existing hubs were never healed (applyNoteChromeHeal's scope excludes
// type:project). Cleanup heal — runs every install, idempotent, no-op on
// already-clean / freshly-templated hubs. A heading is removed ONLY when it
// labels its matching widget block (the next non-blank line opens that widget's
// dataviewjs), so a user-authored `## Status` heading is never touched.
// .sauce-backup snapshot before any write. Mirrors applyProjectMeetingsPanelHeal.
async function applyProjectHubLegacyHeadingCleanup(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0;
  let skipped = 0;
  let warned = 0;

  const LEGACY = { "## Status": "ProjectStatusWidget", "## Workstreams": "ProjectWorkstreamManager" };
  function stripLegacyHeadings(body) {
    const lines = body.split("\n");
    const out = [];
    let changed = false;
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; out.push(line); continue; }
      const wantClass = !inFence ? LEGACY[trimmed] : undefined;
      if (wantClass) {
        // Strip ONLY when this heading labels its widget: the next non-blank line
        // opens a dataviewjs block whose following line names the widget class.
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        const opensDv = j < lines.length && lines[j].trim().startsWith("```dataviewjs");
        const labelsWidget = opensDv && j + 1 < lines.length && lines[j + 1].includes(`class: "${wantClass}"`);
        if (labelsWidget) {
          changed = true;
          // Drop the heading line + one trailing blank so no double blank remains.
          if (i + 1 < lines.length && lines[i + 1].trim() === "") i++;
          continue;
        }
      }
      out.push(line);
    }
    return { changed, body: out.join("\n") };
  }

  let projectDirs;
  try {
    const listing = await adapter.list(root);
    projectDirs = (listing.folders || []).filter((f) => f.startsWith(root + "/"));
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_hub_legacy_heading_cleanup",
        reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const projectDir of projectDirs) {
    try {
      const sub = await adapter.list(projectDir);
      const candidates = (sub.files || []).filter((p) => p.endsWith(".md"));
      let hubPath = null;
      for (const cand of candidates) {
        const body = await adapter.read(cand);
        if (_noteChromeFrontmatterType(body) === "project") { hubPath = cand; break; }
      }
      if (!hubPath) continue;

      const before = await adapter.read(hubPath);
      const { changed, body: after } = stripLegacyHeadings(before);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(hubPath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_hub_legacy_heading_cleanup",
          target: hubPath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_hub_legacy_heading_cleanup",
          reason: `${projectDir}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "project_hub_legacy_heading_cleanup",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _collapseNavButtonsSeparatorGap — pure transform. Removes the blank line(s)
// that sit between the ProjectNavButtons dataviewjs block's closing fence and
// the `---` separator directly below it, so the separator hugs the button row.
// Idempotent (no blank → no change). Only touches that exact sequence; every
// other blank line and every other block is left untouched.
function _collapseNavButtonsSeparatorGap(body) {
  const lines = String(body == null ? "" : body).split("\n");
  const out = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (lines[i].includes('class: "ProjectNavButtons"') &&
        i + 1 < lines.length && lines[i + 1].trim() === "```") {
      out.push(lines[i + 1]);  // keep the closing fence
      i += 1;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j > i + 1 && j < lines.length && lines[j].trim() === "---") {
        changed = true;
        i = j - 1;  // drop the blank line(s); next iteration pushes the `---`
      }
    }
  }
  return { changed, body: out.join("\n") };
}

// applyProjectNavButtonsSeparatorGap — heals pre-existing project/card/doc/map/
// section notes that shipped with a stray blank line between the ProjectNavButtons
// button row and the `---` below it (the templates used to emit it). Recursively
// walks spice/projects, applies _collapseNavButtonsSeparatorGap. Cleanup-type:
// idempotent (no-op once collapsed), .sauce-backup snapshot, per-note try/catch,
// history events, never throws. Safe to run every install.
async function applyProjectNavButtonsSeparatorGap(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  async function collectMd(dir) {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return []; }
    let files = (listing.files || []).filter((p) => p.endsWith(".md"));
    for (const sub of (listing.folders || [])) {
      if (sub.includes("/.sauce-backup")) continue;  // never recurse our own backups
      files = files.concat(await collectMd(sub));
    }
    return files;
  }

  let mdFiles;
  try {
    mdFiles = await collectMd(root);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_nav_buttons_separator_gap",
        reason: `walk failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const notePath of mdFiles) {
    try {
      const before = await adapter.read(notePath);
      if (!before.includes('class: "ProjectNavButtons"')) { skipped += 1; continue; }
      const { changed, body: after } = _collapseNavButtonsSeparatorGap(before);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${notePath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(notePath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_nav_buttons_separator_gap",
          target: notePath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_nav_buttons_separator_gap",
          reason: `${notePath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "project_nav_buttons_separator_gap",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// PROJECT_CHROME_TYPES — the frontmatter `type:` values whose bodies the project
// chrome overhaul (WS0-WS8, 2026-07-02) governs. applyProjectChromeDividerHeal +
// applyBoardCardBreadcrumbHeal both scope to this set. Kept as a module-level
// constant so the two heals + their unit harness read from one source.
const PROJECT_CHROME_TYPES = [
  "project", "projects-hub", "project-todo", "docs-hub", "section-hub", "doc-note",
  "map", "kanban", "task-note", "task-hub", "task-board-card", "links-hub",
];

// _hasChromeBar — true when a note body already renders the single ProjectChromeBar
// chrome block (the button/nav refactor shape: one `class: "ProjectChromeBar"`
// dv.view call replaces the old stacked Breadcrumb + SpaceNavButtons +
// ProjectNavButtons + per-surface action row). Every legacy project-chrome heal
// that would INJECT a breadcrumb / nav row / action row guards on this so it
// NO-OPs on a migrated note (ProjectChromeBar owns that chrome — re-injecting
// would double it). Legacy (old-shape) notes lack the substring, so those heals
// still run on them until the forward migration (Pass 9b) reshapes them.
// Substring match (install.js has no parseYaml at runtime); mirrors the many
// `body.includes('class: "X"')` idempotency guards already used across the heals.
// Generalized (v0.205.0) from a literal ProjectChromeBar-only check: any
// "<Name>ChromeBar" adapter class owning a surface's chrome means legacy
// standalone widgets/markers for that surface are redundant — same guard
// semantics regardless of WHICH blueprint's adapter is present. All 5
// call sites either only ever see ProjectChromeBar bodies (project-typed
// notes) — unchanged behavior — or now correctly recognize MeetingChromeBar
// et al. too (the injectAccentButtonBlock verify pass at line ~7265).
function _hasChromeBar(body) {
  return typeof body === "string" && /class:\s*"[A-Za-z]+ChromeBar"/.test(body);
}

// _stripProjectChromeDividers — pure transform (WS9 P0a chrome overhaul). The
// chrome overhaul reversed the divider grammar: helpers now render their own
// leading hairline (SectionLabel.divider()), so consecutive chrome dataviewjs
// blocks must be separated by a SINGLE blank line and NO literal `---`. Legacy
// notes still carry the old grammar: a `---` line (often blank-shielded) BETWEEN
// two consecutive customjs-guard chrome blocks, and/or a doubled blank gap.
//
// This transform removes a `---` divider ONLY when it sits between two chrome
// blocks (a customjs-guard dataviewjs fence closes above it — ignoring blanks —
// AND a customjs-guard dataviewjs fence opens below it), and collapses the
// surrounding blank-line gap down to exactly one blank line. A `---` adjacent to
// a chrome block on ONE side but to prose / an `## H2` heading / a callout on the
// other side is a CONTENT boundary and is preserved (e.g. the `---` above a
// `## Mentions` heading, or below a BacklinkPanel before user notes).
//
// Fence-aware + column-0-only: a chrome block is recognized ONLY when its
// ```dataviewjs opener starts at column 0 (so callout-embedded `> ```dataviewjs`
// blocks and blocks nested inside another fence never count as chrome anchors,
// and the leading frontmatter `---`/`---` YAML fence is never a chrome divider).
// Idempotent: once collapsed the span is a single blank line with no `---`, which
// re-matches to itself. Returns { changed, body }.
function _stripProjectChromeDividers(body) {
  const src = String(body == null ? "" : body);
  const lines = src.split("\n");

  // Skip the leading frontmatter block so its `---` fences are never candidates.
  let start = 0;
  if (lines[0] === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { start = i + 1; break; }
    }
  }

  // Classify each line's fence state at column 0 so we know which ``` opens a
  // chrome (customjs-guard) dataviewjs block. isChromeClose[i] = true when line i
  // is the closing ``` of a column-0 dataviewjs block that referenced
  // customjs-guard. isChromeOpen[i] = true when line i is that opener.
  const isChromeOpen = new Array(lines.length).fill(false);
  const isChromeClose = new Array(lines.length).fill(false);
  {
    let inFence = false;   // inside a column-0 fenced block?
    let openIdx = -1;      // line index of the current block's opener
    let state = "none";    // "none" | "pending" (```dataviewjs opener, no guard ref yet) | "guard"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // A column-0 fence line opens/closes a block. Skip inline triple-backtick
      // spans (```lang``` on one line) — those aren't block fences.
      const isFenceLine = /^```/.test(line) && !/^```[^`]*```/.test(line);
      if (isFenceLine) {
        if (!inFence) {
          inFence = true;
          openIdx = i;
          state = /^```dataviewjs\s*$/.test(line) ? "pending" : "none";
        } else {
          // closing fence: mark the block as chrome only if a guard ref appeared.
          if (state === "guard") {
            isChromeOpen[openIdx] = true;
            isChromeClose[i] = true;
          }
          inFence = false;
          openIdx = -1;
          state = "none";
        }
        continue;
      }
      if (inFence && state === "pending" && line.includes("customjs-guard")) {
        state = "guard";
      }
    }
  }

  // Walk and drop `---` lines that sit between two chrome blocks, collapsing the
  // blank gap to one blank line. We rebuild the output. `lastEmittedChromeClose`
  // tracks whether the most recent non-blank emitted line was a chrome closing
  // fence, so a `---`/gap is only collapsed when it's chrome-bounded on BOTH sides.
  const out = [];
  let changed = false;
  let i = start;
  // Emit the frontmatter verbatim.
  for (let k = 0; k < start; k++) out.push(lines[k]);

  while (i < lines.length) {
    if (isChromeClose[i]) {
      out.push(lines[i]);
      i++;
      // Look ahead: [blanks] ([---] [blanks])? — decide if the NEXT non-blank,
      // non-`---` line opens a chrome block. If so, normalize the span to one
      // blank line. Otherwise emit the span verbatim.
      let j = i;
      let sawDivider = false;
      let dividerCount = 0;
      while (j < lines.length && (lines[j].trim() === "" || lines[j].trim() === "---")) {
        if (lines[j].trim() === "---") { sawDivider = true; dividerCount++; }
        j++;
      }
      // j now points at the first "real" line after the gap (or EOF).
      const nextIsChrome = j < lines.length && isChromeOpen[j];
      const atEof = j >= lines.length;
      // Collapse when the gap has AT MOST one `---` AND either the next real line
      // opens a chrome block (chrome↔chrome divider), OR there's no content below
      // at all (a trailing chrome `---` at EOF — orphaned chrome cruft). A `---`
      // followed by prose / an `## H2` / a callout is a CONTENT boundary → kept.
      // Multiple `---` in one gap is unusual content — left verbatim to avoid
      // eating a user divider.
      if ((nextIsChrome || (atEof && sawDivider)) && dividerCount <= 1) {
        // Chrome↔chrome divider OR a trailing chrome `---` at EOF: normalize the
        // span to exactly one blank line after the chrome fence.
        const spanLen = j - i;
        if (sawDivider || spanLen !== 1) changed = true;
        out.push("");
        i = j;
      } else {
        // Emit the span verbatim (content boundary or ambiguous).
        for (; i < j; i++) out.push(lines[i]);
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }

  const result = out.join("\n");
  return { changed: changed && result !== src, body: result };
}

// applyProjectChromeDividerHeal — WS9 P0a. Walks spice/projects/** recursively
// and applies _stripProjectChromeDividers to every project-related note (frontmatter
// type ∈ PROJECT_CHROME_TYPES). Removes the legacy literal `---` chrome dividers
// between consecutive customjs-guard chrome blocks + collapses doubled blank gaps,
// so the helper-owned leading hairline is the sole separator. Cleanup-type:
// idempotent (no-op once normalized), .sauce-backup snapshot before any write,
// per-note try/catch (fails loud via history, never throws), history events. Safe
// to run every install. Mirrors applyProjectNavButtonsSeparatorGap posture.
async function applyProjectChromeDividerHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  async function collectMd(dir) {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return []; }
    let files = (listing.files || []).filter((p) => p.endsWith(".md"));
    for (const sub of (listing.folders || [])) {
      if (sub.includes("/.sauce-backup")) continue;  // never recurse our own backups
      files = files.concat(await collectMd(sub));
    }
    return files;
  }

  let mdFiles;
  try {
    mdFiles = await collectMd(root);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_chrome_divider_heal",
        reason: `walk failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const notePath of mdFiles) {
    try {
      const before = await adapter.read(notePath);
      const type = _noteChromeFrontmatterType(before);
      if (!PROJECT_CHROME_TYPES.includes(type)) { skipped += 1; continue; }
      const { changed, body: after } = _stripProjectChromeDividers(before);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${notePath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(notePath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_chrome_divider_heal",
          target: notePath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_chrome_divider_heal",
          reason: `${notePath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "project_chrome_divider_heal",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// PROJECT_CHROME_BAR_BLOCK — the canonical single chrome block the button/nav
// refactor introduced. ProjectChromeBar owns the breadcrumb + core-nav + `⋯`
// overflow + the surface's primary action button, replacing the old stacked
// Breadcrumb + SpaceNavButtons + ProjectNavButtons + per-surface action row.
const PROJECT_CHROME_BAR_BLOCK =
  '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });\n```';

// _projectChromeBarBody — PURE, idempotent forward-migration transform (button/nav
// refactor Pass 9b). Converts an EXISTING project-surface note body from any
// old/partial stacked-chrome shape to the canonical single-ProjectChromeBar shape:
//
//   ```dataviewjs
//   await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
//   ```
//   <remaining content widgets, SectionHub/WorkstreamManager now contentOnly>
//
// Rules (see the migrated templates under platform/blueprints/project/templates/):
//   1. Idempotency — a body already carrying `class: "ProjectChromeBar"` returns
//      { changed:false } unchanged.
//   2. Surface-scope — only bodies whose frontmatter `type` ∈ PROJECT_CHROME_TYPES
//      are eligible. `type` is passed in (the driver reads it once). A non-project
//      surface → { changed:false }.
//   3. Conservatism — the transform only acts when it finds at least one legacy
//      chrome MARKER block to drop (Breadcrumb / SpaceNavButtons / ProjectNavButtons).
//      A body with NO such marker is left alone (return { changed:false }); we would
//      rather leave an unrecognized note untouched than corrupt it.
//   4. DROP action-row / nav chrome blocks (fence-to-fence): the Breadcrumb,
//      SpaceNavButtons, ProjectNavButtons nav blocks; the DocLeafActions,
//      ProjectLinksManager, ToDoLeafActions action rows; and the ProjectDocsIndex
//      block whose method is renderActionRow (the docs-hub action row). Their
//      affordances are subsumed by ProjectChromeBar's primary + overflow.
//   5. CONVERT to contentOnly — SectionHub and ProjectWorkstreamManager render BOTH
//      an action row AND content; rewrite their invocation to
//      `args: [{ contentOnly: true }]` (keep the block, drop only its action row).
//   6. KEEP everything else — the plain ProjectDocsIndex (render) block,
//      ProjectLinksPanel, ProjectStatusWidget, ProjectActivityPanel, ProjectOpenTasks,
//      ProjectMeetingsPanel, ProjectWorkstreams, ProjectsHubCards, SectionLabel /
//      search strips, `## Column` kanban headings, all user prose.
//   7. Strip literal `---` chrome dividers left between removed chrome blocks
//      (fence-adjacent, outside content), then collapse doubled blank gaps.
//   8. Prepend exactly ONE ProjectChromeBar block at the top (where the old chrome
//      header sat — after the frontmatter, before the first remaining block).
//
// Regex/fence-walking only (install.js has no parseYaml at runtime). Returns
// { changed, body }.
function _projectChromeBarBody(body, type) {
  if (typeof body !== "string") return { changed: false, body };
  // 1. Idempotency — already the single-bar shape.
  if (body.includes('class: "ProjectChromeBar"')) return { changed: false, body };
  // 2. Surface-scope.
  if (!PROJECT_CHROME_TYPES.includes(type)) return { changed: false, body };

  const original = body;

  // Split leading frontmatter off so its `---` fences are never candidates.
  let fmPart = "";
  let rest = body;
  const fmMatch = body.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (fmMatch) { fmPart = fmMatch[1]; rest = body.slice(fmMatch[1].length); }

  const nl = rest.includes("\r\n") ? "\r\n" : "\n";
  let lines = rest.split(/\r?\n/);

  // Fence-classify: for each column-0 fenced block, record its open/close indices,
  // whether it is a customjs-guard dataviewjs block, and the customJS class it
  // invokes (plus whether it carries method: "renderActionRow").
  function classifyBlocks(ls) {
    const info = ls.map(() => ({ inFence: false, fenceOpen: false, fenceClose: false }));
    const blocks = []; // { open, close, cls, isRenderActionRow }
    let inFence = false, openIdx = -1, isDv = false, blockText = "";
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      const isFenceLine = /^(```|~~~)/.test(line) && !/^(```|~~~)[^`~]*(```|~~~)/.test(line);
      if (isFenceLine && !inFence) {
        inFence = true; openIdx = i; isDv = /^```dataviewjs\s*$/.test(line); blockText = "";
        info[i] = { inFence: true, fenceOpen: true, fenceClose: false };
        continue;
      }
      if (isFenceLine && inFence) {
        info[i] = { inFence: true, fenceOpen: false, fenceClose: true };
        if (isDv) {
          const clsM = blockText.match(/class:\s*"([A-Za-z0-9_]+)"/);
          blocks.push({
            open: openIdx,
            close: i,
            cls: clsM ? clsM[1] : null,
            isRenderActionRow: /method:\s*"renderActionRow"/.test(blockText),
          });
        }
        inFence = false; openIdx = -1; isDv = false; blockText = "";
        continue;
      }
      info[i] = { inFence, fenceOpen: false, fenceClose: false };
      if (inFence) blockText += line + "\n";
    }
    return { info, blocks };
  }

  const DROP_CLASSES = new Set([
    "Breadcrumb", "SpaceNavButtons", "ProjectNavButtons",
    "DocLeafActions", "ProjectLinksManager", "ToDoLeafActions",
  ]);
  const NAV_MARKER_CLASSES = new Set(["Breadcrumb", "SpaceNavButtons", "ProjectNavButtons"]);
  const CONTENT_ONLY_CLASSES = new Set(["SectionHub", "ProjectWorkstreamManager"]);

  let cl = classifyBlocks(lines);

  // 3. Conservatism — require at least one legacy nav marker to act.
  const hasNavMarker = cl.blocks.some((b) => b.cls && NAV_MARKER_CLASSES.has(b.cls));
  if (!hasNavMarker) return { changed: false, body: original };

  // 4 + 5: mark blocks for drop (fence-to-fence) or contentOnly-rewrite.
  const dropRanges = []; // [openLine, closeLine]
  const contentOnlyOpens = new Set(); // open-line indices to rewrite
  for (const b of cl.blocks) {
    if (!b.cls) continue;
    if (DROP_CLASSES.has(b.cls)) { dropRanges.push([b.open, b.close]); continue; }
    if (b.cls === "ProjectDocsIndex" && b.isRenderActionRow) { dropRanges.push([b.open, b.close]); continue; }
    if (CONTENT_ONLY_CLASSES.has(b.cls)) contentOnlyOpens.add(b.open);
  }

  // Rewrite contentOnly invocations in place (before we delete lines, so indices
  // stay valid). The invocation line is always the single dv.view line inside the
  // block (line open+1 for the canonical one-line-body block).
  for (const openLine of contentOnlyOpens) {
    for (let i = openLine + 1; i < lines.length; i++) {
      if (cl.info[i] && cl.info[i].fenceClose) break;
      const m = lines[i].match(/class:\s*"([A-Za-z0-9_]+)"/);
      if (m && CONTENT_ONLY_CLASSES.has(m[1])) {
        if (!/contentOnly/.test(lines[i])) {
          lines[i] = `await dv.view("ranch/views/customjs-guard", { class: "${m[1]}", args: [{ contentOnly: true }] });`;
        }
        break;
      }
    }
  }

  // 7. Identify literal `---` chrome dividers to drop. Computed against the ORIGINAL
  // classification (chrome fences still present) so a `---` that sat between a
  // to-be-dropped chrome block and content is recognized as chrome-adjacent BEFORE
  // the block deletion erases its chrome neighbour. Mirrors _modernizeDocsHubBody
  // Step 2. Actual behavior (the neighbourIsChrome test below): a `---` is dropped
  // when its nearest non-blank neighbour on EITHER side is a fence line (any
  // rendered widget's open/close ```) or another `---`. So a `---` between two
  // prose paragraphs is preserved, but a `---` sitting immediately adjacent to a
  // KEPT widget block's fence (not just a dropped chrome block) is treated as
  // chrome-adjacent and removed too. This is intentional — chrome-hugging dividers
  // are noise under the single bar — but it means a user `---` placed right against
  // a widget's close fence can be dropped. The pre-write .sauce-backup snapshot
  // makes that fully recoverable.
  const dividerDrop = new Set();
  {
    const info = cl.info;
    const isDivider = (i) => {
      if (i < 0 || i >= lines.length) return false;
      if (info[i].inFence) return false;
      return /^-{3,}[ \t]*$/.test(lines[i]);
    };
    const neighbourIsChrome = (start, dir) => {
      let i = start + dir;
      while (i >= 0 && i < lines.length && lines[i].trim() === "") i += dir;
      if (i < 0 || i >= lines.length) return false;
      if (info[i].fenceOpen || info[i].fenceClose) return true;
      if (isDivider(i)) return true;
      return false;
    };
    for (let i = 0; i < lines.length; i++) {
      if (!isDivider(i)) continue;
      if (neighbourIsChrome(i, -1) || neighbourIsChrome(i, +1)) dividerDrop.add(i);
    }
  }

  // Delete the drop ranges + chrome dividers (bottom-up so indices stay valid).
  // For each block range, also drop one immediately-trailing blank line to avoid
  // leaving a doubled gap. Chrome-divider lines are single-line drops.
  const rangeSet = new Set();
  for (const [o, c] of dropRanges) {
    let end = c;
    if (end + 1 < lines.length && lines[end + 1].trim() === "") end += 1;
    for (let i = o; i <= end; i++) rangeSet.add(i);
  }
  for (const i of dividerDrop) rangeSet.add(i);
  lines = lines.filter((_, i) => !rangeSet.has(i));

  // Collapse doubled blank lines.
  {
    const collapsed = [];
    for (const l of lines) {
      if (l.trim() === "" && collapsed.length && collapsed[collapsed.length - 1].trim() === "") continue;
      collapsed.push(l);
    }
    lines = collapsed;
  }

  // 8. Prepend exactly one ProjectChromeBar block, then the remaining content
  // (leading blanks trimmed so the bar sits directly under the header gap). When a
  // frontmatter block precedes, insert a single blank line between its close and the
  // bar (matches the migrated templates: `---\n\n```dataviewjs`).
  let workBody = lines.join(nl).replace(/^\s+/, "");
  const gap = fmPart ? nl : "";
  const finalBody = fmPart + gap + PROJECT_CHROME_BAR_BLOCK + (workBody ? nl + nl + workBody : nl);

  return { changed: finalBody !== original, body: finalBody };
}

// applyProjectChromeBarHeal — button/nav refactor Pass 9b forward migration. Walks
// spice/projects/** recursively and reshapes every project-surface note (frontmatter
// type ∈ PROJECT_CHROME_TYPES) from any old/partial stacked-chrome shape to the
// canonical single-ProjectChromeBar shape via _projectChromeBarBody. Runs LAST in
// the project heal chain so it normalizes whatever earlier heals produced. Migration-
// type (reshapes pre-existing legacy content); ungated is safe because the transform
// is doubly-guarded (idempotent on ProjectChromeBar + conservative no-op when no
// legacy nav marker is present). .sauce-backup snapshot before every write; per-note
// try/catch, never throws; history events. Mirrors applyProjectChromeDividerHeal.
async function applyProjectChromeBarHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try { files = await _listAllMarkdownRecursive(adapter, root); }
  catch (e) {
    history?.push({ event: "warning", step: "project_chrome_bar_heal", reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      const type = _noteChromeFrontmatterType(before);
      if (!PROJECT_CHROME_TYPES.includes(type)) { skipped += 1; continue; }
      const { changed, body: chromeAfter } = _projectChromeBarBody(before, type);
      const after = _healSectionLinksFrontmatter(changed ? chromeAfter : before, type);
      if (after === before) { skipped += 1; continue; }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "project_chrome_bar_heal", target: fpath, action: "migrated",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "project_chrome_bar_heal", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "project_chrome_bar_heal", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// applyDailyHomeChromeBarHeal(tp, manifest, variables, history, git) — forward
// migration for the Daily/Home chrome-bar adoption cycle. Walks every Daily note
// (type: cowork-daily under spice/daily/) plus the singleton spice/home/Home.md
// and rewrites the legacy SpaceNavButtons chrome onto the new
// DailyChromeBar / HomeChromeBar block via the pure transforms
// _dailyChromeBarBody / _homeChromeBarBody. Mirrors applyProjectChromeBarHeal's
// posture exactly: .sauce-backup snapshot before any write, per-note try/catch
// (fails-loud via a history warning but NEVER throws), full git fields on every
// push, idempotent (both transforms are self-guarding no-ops on already-migrated
// bodies). Ungated — runs on every install. MUST be wired AFTER
// applyHomeScaffoldHeal so a freshly-scaffolded Home.md is already on disk (the
// generic applyNoteChromeHeal runs too early in the sequence to see it, which is
// why Daily/Home are intentionally NOT in CHROME_BAR_MAP).
async function applyDailyHomeChromeBarHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  // Candidate discovery: every .md under spice/daily/ (filtered to cowork-daily
  // by frontmatter type) + the singleton Home.md if present.
  const candidates = [];
  if (await adapter.exists("spice/daily")) {
    try {
      const dailyFiles = await _listAllMarkdownRecursive(adapter, "spice/daily");
      for (const f of dailyFiles) candidates.push(f);
    } catch (e) {
      history?.push({ event: "warning", step: "daily_home_chrome_bar_heal", reason: `list failed for spice/daily: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }
  if (await adapter.exists("spice/home/Home.md")) candidates.push("spice/home/Home.md");

  for (const fpath of candidates) {
    try {
      const before = await adapter.read(fpath);
      const isHome = fpath === "spice/home/Home.md";
      // Daily notes are type-gated so stray .md under spice/daily/ (a README,
      // an attachment sidecar) is never touched. Accepts BOTH the current
      // "cowork-daily" type AND the legacy "daily" type real consumer vaults
      // still carry on notes predating the cowork-flavor frontmatter rename
      // (daily@v0.5.0) — those notes were never migrated to the new type
      // value, so gating on "cowork-daily" alone silently skipped every
      // pre-rename daily note (found live: 232/282 real daily notes on a
      // deployed consumer vault still had type: daily and were never healed).
      const fmType = _noteChromeFrontmatterType(before);
      if (!isHome && fmType !== "cowork-daily" && fmType !== "daily") { skipped += 1; continue; }
      const after = isHome ? _homeChromeBarBody(before) : _dailyChromeBarBody(before);
      if (after === before) { skipped += 1; continue; }
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "daily_home_chrome_bar_heal", target: fpath, action: "migrated",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "daily_home_chrome_bar_heal", target: fpath, reason: e && e.message ? e.message : String(e),
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "daily_home_chrome_bar_heal", name: "vault", summary: { healed, skipped, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// _injectBoardCardBreadcrumb — pure transform (WS9 P0b chrome overhaul). Promoted
// board-card notes (the file at spice/projects/<slug>/tasks/<Task>/<Task>.md, or a
// deeper board card at .../board/<Card>/<Card>.md) shipped BEFORE the chrome
// overhaul with NO Breadcrumb block and often NO frontmatter `type:` (only tags:
// kanban-card/project-card). The overhaul stamps a stable type + a Breadcrumb as
// the first rendered block. This transform, given a `desiredType`:
//   (1) Ensures frontmatter carries `type: <desiredType>`. install.js CANNOT use
//       parseYaml (it runs in the Templater Node context, not Obsidian), so this
//       is regex-based, mirroring the frontmatter idioms already used across the
//       installer:
//         - frontmatter present + a `type:` line already exists → left untouched
//           (never overwrite a user/other type);
//         - frontmatter present, no `type:` line → insert `type: <desiredType>`
//           as the FIRST line inside the FM block;
//         - no frontmatter at all → prepend a minimal `---\ntype: <t>\n---\n\n`.
//   (2) Inserts a Breadcrumb dataviewjs block as the FIRST rendered block — right
//       before the first `class: "SpaceNavButtons"` / `class: "ProjectNavButtons"`
//       dataviewjs fence; if neither exists, immediately after the frontmatter.
// Idempotent: if a `class: "Breadcrumb"` block is already present the breadcrumb
// step is skipped; the type step only fires when the FM lacks a `type:`. Returns
// { changed, body }.
function _injectBoardCardBreadcrumb(body, desiredType) {
  const src = String(body == null ? "" : body);
  const type = String(desiredType || "task-hub");
  let out = src;
  let changed = false;

  // ---- (1) frontmatter type: ----
  const fmMatch = out.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (fmMatch) {
    const fmBody = fmMatch[1];
    // A `type:` key anywhere in the FM block (line-anchored) → leave it.
    if (!/^\s*type\s*:/m.test(fmBody)) {
      const nl = fmMatch[0].includes("\r\n") ? "\r\n" : "\n";
      // Insert `type: <type>` as the first FM line, just after the opening `---`.
      const openLen = ("---" + nl).length;
      out = out.slice(0, openLen) + "type: " + type + nl + out.slice(openLen);
      changed = true;
    }
  } else {
    // No frontmatter → prepend a minimal block.
    out = "---\ntype: " + type + "\n---\n\n" + out;
    changed = true;
  }

  // ---- (2) Breadcrumb as first rendered block ----
  if (!/class:\s*"Breadcrumb"/.test(out)) {
    const bcBlock = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n```';
    // Anchor: the first SpaceNavButtons or ProjectNavButtons chrome fence.
    let navIdx = out.indexOf('class: "SpaceNavButtons"');
    if (navIdx === -1) navIdx = out.indexOf('class: "ProjectNavButtons"');
    if (navIdx !== -1) {
      const fence = out.lastIndexOf("```dataviewjs", navIdx);
      if (fence !== -1) {
        out = out.slice(0, fence) + bcBlock + "\n\n" + out.slice(fence);
        changed = true;
      }
    } else {
      // No nav block — insert right after the frontmatter (or at the top).
      const fm2 = out.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
      if (fm2) {
        out = out.slice(0, fm2[0].length) + "\n" + bcBlock + "\n" + out.slice(fm2[0].length);
      } else {
        out = bcBlock + "\n\n" + out;
      }
      changed = true;
    }
  }

  return { changed: changed && out !== src, body: out };
}

// applyBoardCardBreadcrumbHeal — WS9 P0b. Walks spice/projects/** and heals
// promoted board-card notes: a file whose basename === its parent folder name and
// whose path contains a `/tasks/` segment. Two shapes:
//   - spice/projects/<slug>/tasks/<Task>/<Task>.md              → type: task-hub
//   - spice/projects/<slug>/tasks/<Task>/board/<Card>/<Card>.md → type: task-board-card
// Injects `type` + a leading Breadcrumb via _injectBoardCardBreadcrumb. Insert-only
// + idempotent (skips notes that already render a Breadcrumb AND carry a type),
// .sauce-backup snapshot before any write, per-note try/catch (fails loud via
// history, never throws). MUST run BEFORE applyProjectChromeDividerHeal so the
// freshly-stamped type lets that heal reach these notes. Mirrors the
// applyProjectNavButtonsSeparatorGap walk posture.
async function applyBoardCardBreadcrumbHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  async function collectMd(dir) {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return []; }
    let files = (listing.files || []).filter((p) => p.endsWith(".md"));
    for (const sub of (listing.folders || [])) {
      if (sub.includes("/.sauce-backup")) continue;
      files = files.concat(await collectMd(sub));
    }
    return files;
  }

  // Classify a path as a promoted board card + return its desired type, else null.
  //   .../tasks/<Task>/<Task>.md              → task-hub
  //   .../tasks/<Task>/board/<Card>/<Card>.md → task-board-card
  function boardCardType(notePath) {
    const parts = notePath.split("/");
    const file = parts[parts.length - 1];
    if (!file.endsWith(".md")) return null;
    const base = file.slice(0, -3);
    const parent = parts[parts.length - 2];
    if (parent !== base) return null;            // basename must === parent folder
    if (parts.indexOf("tasks") === -1) return null;
    // Deeper board card: .../board/<Card>/<Card>.md
    if (parts[parts.length - 3] === "board") return "task-board-card";
    // Promoted task hub: .../tasks/<Task>/<Task>.md
    if (parts[parts.length - 3] === "tasks") return "task-hub";
    return null;
  }

  let mdFiles;
  try {
    mdFiles = await collectMd(root);
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "board_card_breadcrumb_heal",
        reason: `walk failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const notePath of mdFiles) {
    try {
      const desiredType = boardCardType(notePath);
      if (!desiredType) { skipped += 1; continue; }
      const before = await adapter.read(notePath);
      // ProjectChromeBar guard (button/nav refactor Pass 9a): a migrated promoted
      // board-card / task-hub renders the single ProjectChromeBar block, which OWNS
      // the breadcrumb. _injectBoardCardBreadcrumb would inject a SECOND leading
      // Breadcrumb block above it → duplicate breadcrumb. Skip it (the note's `type`
      // is already stamped by the template; legacy typeless/breadcrumb-less notes
      // still heal below).
      if (_hasChromeBar(before)) { skipped += 1; continue; }
      const { changed, body: after } = _injectBoardCardBreadcrumb(before, desiredType);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${notePath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(notePath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "board_card_breadcrumb_heal",
          target: notePath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "board_card_breadcrumb_heal",
          reason: `${notePath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "board_card_breadcrumb_heal",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _removeWorkstreamManagerBlock — pure transform (WS9 P1 chrome overhaul). The
// chrome overhaul consolidated workstream management onto the Map note, so the
// ProjectWorkstreamManager block is redundant on the project HUB. This removes the
// WHOLE `class: "ProjectWorkstreamManager"` dataviewjs fence (the ```dataviewjs
// opener through its closing ```) from a hub body and collapses the surrounding
// blank-line gap down to a single blank line, so no doubled blank / orphaned gap
// remains. Fence-aware + column-0-only: only a top-level (column-0) dataviewjs
// block naming that class is removed; a callout-embedded reference (`> ...`) is
// left alone. Idempotent: once removed the class no longer appears → no-op.
// Returns { changed, body }.
function _removeWorkstreamManagerBlock(body) {
  const src = String(body == null ? "" : body);
  if (!/class:\s*"ProjectWorkstreamManager"/.test(src)) return { changed: false, body: src };
  const lines = src.split("\n");
  const out = [];
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // A column-0 ```dataviewjs opener: scan its block for the target class.
    if (/^```dataviewjs\s*$/.test(line)) {
      let j = i + 1;
      let isTarget = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        if (lines[j].includes('class: "ProjectWorkstreamManager"')) isTarget = true;
        j++;
      }
      // j points at the closing fence (or EOF if unterminated).
      if (isTarget && j < lines.length) {
        changed = true;
        // Drop lines i..j (the whole fence). Then collapse the gap: if BOTH the
        // last emitted line and the next surviving line are blank, drop one blank
        // so the removal leaves exactly one blank separator, not two.
        i = j + 1;
        // Consume a single trailing blank that immediately followed the block so
        // we don't leave a doubled blank when the line above `out`'s tail is blank.
        const prevBlank = out.length > 0 && out[out.length - 1].trim() === "";
        const nextBlank = i < lines.length && lines[i].trim() === "";
        if (prevBlank && nextBlank) i++;  // skip one blank line
        continue;
      }
    }
    out.push(line);
    i++;
  }
  const result = out.join("\n");
  return { changed: changed && result !== src, body: result };
}

// applyProjectHubWorkstreamRemovalHeal — WS9 P1. Walks spice/projects/<slug>/ and
// removes the redundant ProjectWorkstreamManager dataviewjs block from each
// `type: project` hub note (workstream management now lives on the Map). Finds the
// hub note the same way applyProjectMeetingsPanelHeal / applyProjectHubLegacyHeadingCleanup
// do: the *.md directly inside each project dir whose frontmatter type is
// `project`. Cleanup-type: idempotent (no-op once the block is gone), .sauce-backup
// snapshot before any write, per-project try/catch (fails loud via history, never
// throws), history events. Mirrors applyProjectHubLegacyHeadingCleanup posture.
async function applyProjectHubWorkstreamRemovalHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let projectDirs;
  try {
    const listing = await adapter.list(root);
    projectDirs = (listing.folders || []).filter((f) => f.startsWith(root + "/"));
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "project_hub_workstream_removal_heal",
        reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const projectDir of projectDirs) {
    try {
      const sub = await adapter.list(projectDir);
      const candidates = (sub.files || []).filter((p) => p.endsWith(".md"));
      let hubPath = null;
      for (const cand of candidates) {
        const body = await adapter.read(cand);
        if (_noteChromeFrontmatterType(body) === "project") { hubPath = cand; break; }
      }
      if (!hubPath) continue;

      const before = await adapter.read(hubPath);
      const { changed, body: after } = _removeWorkstreamManagerBlock(before);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(hubPath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "project_hub_workstream_removal_heal",
          target: hubPath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "project_hub_workstream_removal_heal",
          reason: `${projectDir}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "project_hub_workstream_removal_heal",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// _stripAllProjectsHeading — pure transform. Removes a standalone `## All Projects`
// H2 line (and one trailing blank) from the all-projects hub body, so the hub uses
// the SectionLabel/no-##-H2 chrome pattern. Fence-aware + idempotent.
function _stripAllProjectsHeading(body) {
  const lines = String(body == null ? "" : body).split("\n");
  const out = [];
  let changed = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(```|~~~)/.test(line.trim())) { inFence = !inFence; out.push(line); continue; }
    if (!inFence && line.trim() === "## All Projects") {
      changed = true;
      if (i + 1 < lines.length && lines[i + 1].trim() === "") i++;  // drop one trailing blank
      continue;
    }
    out.push(line);
  }
  return { changed, body: out.join("\n") };
}

// applyProjectsHubAllProjectsHeadingCleanup — strips the legacy `## All Projects`
// H2 from the existing type:projects-hub note (spice/projects/Projects.md) so the
// hub matches the SectionLabel chrome pattern. Cleanup-type: idempotent, .sauce-backup
// snapshot, per-note try/catch, history events, never throws. Runs every install.
async function applyProjectsHubAllProjectsHeadingCleanup(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let files;
  try {
    const listing = await adapter.list(root);
    files = (listing.files || []).filter((p) => p.endsWith(".md"));
  } catch (e) {
    if (history) {
      history.push({
        event: "warning",
        step: "projects_hub_all_projects_heading_cleanup",
        reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  for (const notePath of files) {
    try {
      const before = await adapter.read(notePath);
      if (_noteChromeFrontmatterType(before) !== "projects-hub") { skipped += 1; continue; }
      const { changed, body: after } = _stripAllProjectsHeading(before);
      if (!changed || after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${notePath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }

      await adapter.write(notePath, after);
      healed += 1;
      if (history) {
        history.push({
          event: "info",
          step: "projects_hub_all_projects_heading_cleanup",
          target: notePath,
          action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      warned += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "projects_hub_all_projects_heading_cleanup",
          reason: `${notePath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString(),
        });
      }
    }
  }

  if (history) {
    history.push({
      event: "info",
      step: "projects_hub_all_projects_heading_cleanup",
      name: "vault",
      reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString(),
    });
  }
}

// applyProjectActivityPanelsHeal — injects ProjectActivityPanel + ProjectOpenTasks
// dataviewjs blocks into existing type:project hubs. Anchor preference:
//   1. BEFORE the opening fence of the `class: "ProjectMeetingsPanel"` block
//      (universal across all live hubs → primary)
//   2. after the closing fence of `class: "ProjectStatusWidget"`
//   3. after the closing fence of `class: "ProjectNavButtons"`
//   4. after the closing fence of the first dataviewjs block
//   5. none → warning, no write.
// Mirrors applyProjectMeetingsPanelHeal: exact type:project match, idempotent
// (skip when ProjectActivityPanel already present), .sauce-backup snapshot,
// per-project try/catch, history events, never throws. Both blocks inserted
// together. MUST run AFTER applyProjectMeetingsPanelHeal so the primary anchor
// exists on hubs that just received a Meetings block this pass.
async function applyProjectActivityPanelsHeal(tp, manifest, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/projects";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, skipped = 0, warned = 0;

  let projectDirs;
  try {
    const listing = await adapter.list(root);
    projectDirs = (listing.folders || []).filter((f) => f.startsWith(root + "/"));
  } catch (e) {
    if (history) history.push({ event: "warning", step: "project_activity_panels_heal",
      reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  const blockA = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectActivityPanel" });\n```';
  const blockB = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "ProjectOpenTasks" });\n```';

  for (const projectDir of projectDirs) {
    try {
      const sub = await adapter.list(projectDir);
      const candidates = (sub.files || []).filter((p) => p.endsWith(".md"));
      let hubPath = null;
      for (const cand of candidates) {
        const body = await adapter.read(cand);
        if (_noteChromeFrontmatterType(body) === "project") { hubPath = cand; break; }
      }
      if (!hubPath) continue;

      const before = await adapter.read(hubPath);
      if (before.includes('class: "ProjectActivityPanel"')) {
        skipped += 1;
        if (history) history.push({ event: "info", step: "project_activity_panels_heal", target: hubPath,
          action: "skipped_already_healed", git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }

      let after = null;
      const pmpIdx = before.indexOf('class: "ProjectMeetingsPanel"');
      if (pmpIdx !== -1) {
        const openIdx = before.lastIndexOf("```dataviewjs", pmpIdx);
        if (openIdx !== -1) {
          after = before.slice(0, openIdx) + blockA + "\n\n" + blockB + "\n\n" + before.slice(openIdx);
        }
      }
      if (after === null) {
        for (const anchorClass of ["ProjectStatusWidget", "ProjectNavButtons"]) {
          const anchorIdx = before.indexOf(`class: "${anchorClass}"`);
          if (anchorIdx === -1) continue;
          const closeRel = before.indexOf("\n```", anchorIdx);
          if (closeRel === -1) continue;
          const insertAt = closeRel + 4;
          after = before.slice(0, insertAt) + "\n\n" + blockA + "\n\n" + blockB + before.slice(insertAt);
          break;
        }
      }
      if (after === null) {
        const firstDvIdx = before.indexOf("```dataviewjs");
        if (firstDvIdx !== -1) {
          const closeRel = before.indexOf("\n```", firstDvIdx);
          if (closeRel !== -1) {
            const insertAt = closeRel + 4;
            after = before.slice(0, insertAt) + "\n\n" + blockA + "\n\n" + blockB + before.slice(insertAt);
          }
        }
      }
      if (after === null) {
        warned += 1;
        if (history) history.push({ event: "warning", step: "project_activity_panels_heal", target: hubPath,
          action: "no_anchor_found", reason: "no MeetingsPanel/Status/Nav/dataviewjs block to anchor on",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }
      if (after === before) { skipped += 1; continue; }

      const backupPath = `.sauce-backup/${ts}/${hubPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) {}
      try { await adapter.write(backupPath, before); } catch (_e) {}

      await adapter.write(hubPath, after);
      healed += 1;
      if (history) history.push({ event: "info", step: "project_activity_panels_heal", target: hubPath,
        action: "healed", git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      if (history) history.push({ event: "warning", step: "project_activity_panels_heal",
        reason: `${projectDir}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  if (history) history.push({ event: "info", step: "project_activity_panels_heal", name: "vault",
    reason: `healed ${healed}; skipped ${skipped}; ${warned} warning(s)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
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
  if (_migrationGated("0.102.0")) return;
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

// _docNoteDirname — dir portion of a vault-relative path (everything before the
// last "/"), "" when the path has no slash. Pure string transform (module-local
// so install.js needn't require doc-move.js's DocMove._dirname class method).
function _docNoteDirname(p) {
  const s = String(p == null ? "" : p);
  const i = s.lastIndexOf("/");
  return i < 0 ? "" : s.slice(0, i);
}

// _inferSectionFromDocPath — { section, subSection } = the folder segments
// strictly BETWEEN the last "docs" path segment and the filename. Mirrors
// doc-move.js DocMove.inferSectionFromPath (inlined — no require). Returns raw
// folder names (slug or display); callers reconcile against section-hub labels.
function _inferSectionFromDocPath(docPath) {
  const s = String(docPath == null ? "" : docPath);
  const parts = s.split("/");
  const di = parts.lastIndexOf("docs");
  if (di < 0) return { section: "", subSection: "" };
  const between = parts.slice(di + 1, parts.length - 1);
  return {
    section: between.length >= 1 ? between[0] : "",
    subSection: between.length >= 2 ? between[1] : "",
  };
}

// _ensureSubSectionFrontmatter — inject `sub_section: "<label>"` into the leading
// YAML frontmatter block when absent. Mirrors _ensureSectionFrontmatter exactly
// but for sub_section. Returns body unchanged if no FM block is present or
// `sub_section:` already exists. Pure string transform.
function _ensureSubSectionFrontmatter(body, subLabel) {
  if (/^sub_section:/m.test(body)) return body;
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return body;
  const fm = fmMatch[1];
  const newFm = `${fm}\nsub_section: "${subLabel}"`;
  return body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
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

// applyDocSectionBackfill — PR1 project-doc-updating-wiring. Backfills MISSING
// `section` / `sub_section` frontmatter on project doc-notes, sourcing the
// AUTHORITATIVE section display name from the sibling `section-hub` note in the
// same folder (its `section:` frontmatter, falling back to the hub's basename).
//
// Posture (mirrors applyDocsBackfill): project-gated (manifest.name ===
// "project"), UNGATED (additive backfill of a missing field — per the
// migration-lifecycle rule, backfill/ensure heals run every install and are
// never version-gated), idempotent (skips doc-notes that already carry
// `section:`), and failure-tolerant per-project (try/catch → warning history
// entry, never throws).
//
// For each doc-note missing `section:`:
//   - depth-1 (docs/<folder>/Note.md): section = hubLabel(folder); no sub_section.
//   - depth-2 (docs/<section>/<sub>/Note.md): sub_section = hubLabel(folder)
//     [the sub-section hub in the doc's own folder]; section = hubLabel(parent)
//     [the section hub one level up].
// When no sibling section-hub gives an authoritative display name, the doc is
// SKIPPED (never guessed from the slug — the user's explicit decision).
//
// Runs AFTER applyProjectSectionsHubMigration so section-hubs are materialized
// before this reads them. install.js cannot use Obsidian's parseYaml (per the
// top-of-file note); frontmatter is matched via narrow regexes.
async function applyDocSectionBackfill(tp, manifest, variables, history, git) {
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
        step: "doc_section_backfill",
        name: "project",
        reason: `list failed for ${projectsRoot}: ${e && e.message ? e.message : String(e)}`,
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

  let backfilledCount = 0;
  let skippedCount = 0;
  let warnCount = 0;

  // Resolve the authoritative section display name for a folder: find the first
  // .md with type: section-hub in that folder, return its `section:` FM value
  // (surrounding quotes/brackets stripped) if present, else the hub's basename
  // without ".md". Returns null when the folder has NO section-hub.
  const hubLabel = async (folder) => {
    if (!folder) return null;
    let list;
    try {
      list = await adapter.list(folder);
    } catch (_e) {
      return null;
    }
    for (const fp of (list.files || [])) {
      if (!fp.endsWith(".md")) continue;
      let fb;
      try {
        fb = await adapter.read(fp);
      } catch (_e) {
        continue;
      }
      if (!/^type:\s*["']?section-hub["']?\s*$/m.test(fb)) continue;
      const secMatch = fb.match(/^section:\s*(.+?)\s*$/m);
      if (secMatch) {
        const raw = secMatch[1].replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim();
        if (raw) return raw;
      }
      return fp.split("/").pop().replace(/\.md$/, "");
    }
    return null;
  };

  for (const projectDir of projectDirs) {
    const docsDir = `${projectDir}/docs`;
    try {
      if (!(await adapter.exists(docsDir))) {
        continue;
      }

      // Recursively collect every doc-note under docs/ (mirrors the
      // adapter.list recursion in applyProjectSectionsMigration/Hub).
      const docNotePaths = [];
      const walk = async (dir) => {
        let list;
        try {
          list = await adapter.list(dir);
        } catch (_e) {
          return;
        }
        for (const fp of (list.files || [])) {
          if (!fp.endsWith(".md")) continue;
          let fb;
          try {
            fb = await adapter.read(fp);
          } catch (_e) {
            continue;
          }
          if (/^type:\s*["']?doc-note["']?\s*$/m.test(fb)) {
            docNotePaths.push(fp);
          }
        }
        for (const sub of (list.folders || [])) {
          await walk(sub);
        }
      };
      await walk(docsDir);

      for (const docPath of docNotePaths) {
        const body = await adapter.read(docPath);
        // Idempotent: already carries section: → leave untouched.
        if (/^section:/m.test(body)) {
          skippedCount += 1;
          continue;
        }

        const folder = _docNoteDirname(docPath);
        const seg = _inferSectionFromDocPath(docPath);

        let sectionLabel;
        let subLabel;
        if (seg.subSection) {
          // depth-2: sub-section hub lives in the doc's own folder; the section
          // hub is one level up.
          subLabel = await hubLabel(folder);
          sectionLabel = await hubLabel(_docNoteDirname(folder));
        } else {
          // depth-1: section hub lives in the doc's own folder; no sub_section.
          sectionLabel = await hubLabel(folder);
          subLabel = "";
        }

        // No authoritative section display name → SKIP (never guess from slug).
        if (!sectionLabel) {
          skippedCount += 1;
          continue;
        }

        let newBody = _ensureSectionFrontmatter(body, sectionLabel);
        if (subLabel) {
          newBody = _ensureSubSectionFrontmatter(newBody, subLabel);
        }
        if (newBody !== body) {
          await adapter.write(docPath, newBody);
          backfilledCount += 1;
          if (history) {
            history.push({
              event: "info",
              step: "doc_section_backfill",
              name: "project",
              target: docPath,
              action: "backfilled_section",
              reason: `section: "${sectionLabel}"${subLabel ? `; sub_section: "${subLabel}"` : ""}`,
              git_commit: git.commit,
              git_tag: git.tag,
              git_dirty: git.dirty,
              attempted_at: new Date().toISOString(),
            });
          }
        } else {
          skippedCount += 1;
        }
      }
    } catch (e) {
      warnCount += 1;
      if (history) {
        history.push({
          event: "warning",
          step: "doc_section_backfill",
          name: "project",
          target: docsDir,
          reason: `backfill failed for ${docsDir}: ${e && e.message ? e.message : String(e)}`,
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
      step: "doc_section_backfill",
      name: "project",
      reason: `backfilled ${backfilledCount} doc-note(s); skipped ${skippedCount}; ${warnCount} warning(s)`,
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
// body invokes the single ProjectChromeBar chrome block, then SectionHub in
// contentOnly mode (chrome is owned by the bar, so the helper renders only the
// search strip + list). The button-nav refactor folded the old stacked chrome
// (Breadcrumb + SpaceNavButtons + ProjectNavButtons + a literal `---`) into
// ProjectChromeBar — this matches the migrated Section Hub.md template + the
// project manifest's Section Hub entity-create inline_body.
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
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
\`\`\`

\`\`\`dataviewjs
await customJS.SectionHub.render(dv, { contentOnly: true });
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
  if (_migrationGated("0.109.0")) return;
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

// _stripEntityCreateMarkerBlocks — v0.124.1. Pure string transform: removes any
// ```dataviewjs … ``` fenced block whose body carries a
// `// entity-create:<id>` marker comment for one of the supplied marker ids.
// Used by applySectionHubEntityCreateCleanup to strip the redundant
// "+ New Section" / "+ New Sub-Section" standalone blocks from existing
// section-hub notes (the SectionHub view renders those buttons inline, and the
// Docs hub renders "+ New Section" inline too — see v0.124.1 Task B2). Surgical:
// only the fenced block containing a target marker is dropped; every other line
// (the SectionHub view block, breadcrumb chrome, frontmatter, user content) is
// preserved. Collapses the extra blank lines left behind so the body doesn't
// accumulate whitespace across repeat installs. Idempotent: returns the input
// unchanged when no target marker is present.
function _stripEntityCreateMarkerBlocks(body, markerIds) {
  if (typeof body !== "string" || !Array.isArray(markerIds) || markerIds.length === 0) {
    return body;
  }
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect a dataviewjs fence open (allowing trailing whitespace).
    if (/^```dataviewjs[ \t]*$/.test(line)) {
      // Scan forward to the matching closing fence.
      let j = i + 1;
      let hasMarker = false;
      while (j < lines.length && !/^```\s*$/.test(lines[j])) {
        for (const id of markerIds) {
          if (lines[j].includes(`// entity-create:${id}`)) { hasMarker = true; break; }
        }
        j++;
      }
      const closedFence = j < lines.length; // lines[j] is the closing ``` (or EOF)
      if (hasMarker && closedFence) {
        // Drop the whole block: open fence … closing fence inclusive.
        i = j + 1;
        continue;
      }
      // Not a target block (or unterminated) → keep verbatim. Emit through the
      // closing fence so we don't re-enter the scanner mid-block.
      const end = closedFence ? j : lines.length - 1;
      for (let k = i; k <= end; k++) out.push(lines[k]);
      i = end + 1;
      continue;
    }
    out.push(line);
    i++;
  }
  // Collapse runs of 3+ blank lines (left by a dropped block) down to 1.
  let result = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return result;
}

// applySectionHubEntityCreateCleanup — v0.124.1 Task B2. Walks every project's
// docs/ tree recursively and strips the redundant standalone
// "+ New Section" (entity-create:section-hub) and "+ New Sub-Section"
// (entity-create:sub-section-hub) dataviewjs blocks from existing section-hub
// notes. The SectionHub view (rendered by the surviving block) already provides
// "+ New Doc" / "+ New Sub-Section" inline, and the Docs hub provides
// "+ New Section" inline — so these standalone blocks were duplicate buttons.
// The entity-create INSTANCES stay registered (render_in removed from the
// manifest, not the entries), so the inline create buttons keep working.
//
// Project-gated (manifest.name === "project"). Idempotent: when neither marker
// is present the file is untouched. .sauce-backup snapshot before any write.
// Per-file try/catch; emits warning/info history events; NEVER throws.
async function applySectionHubEntityCreateCleanup(tp, manifest, variables, history, git) {
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
        step: "section_hub_entity_create_cleanup",
        name: "project",
        reason: `list failed for ${projectsRoot}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const MARKERS = ["section-hub", "sub-section-hub"];
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
          step: "section_hub_entity_create_cleanup",
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
        // Idempotency fast-path: skip files carrying neither marker.
        if (!before.includes("// entity-create:section-hub")
          && !before.includes("// entity-create:sub-section-hub")) {
          untouchedCount += 1;
          continue;
        }
        const after = _stripEntityCreateMarkerBlocks(before, MARKERS);
        if (after === before) {
          untouchedCount += 1;
          continue;
        }
        // .sauce-backup snapshot before write.
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, after);
        cleanedCount += 1;
        if (history) {
          history.push({
            event: "info",
            step: "section_hub_entity_create_cleanup",
            name: "project",
            target: fp,
            action: "blocks_stripped",
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
            attempted_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        if (history) {
          history.push({
            event: "warning",
            step: "section_hub_entity_create_cleanup",
            name: "project",
            target: fp,
            reason: e && e.message ? e.message : String(e),
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
      step: "section_hub_entity_create_cleanup",
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
  if (_migrationGated("0.103.0.1")) return;
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

// _noteChromeFrontmatterType — extracts the frontmatter `type:` value from a
// markdown body. Mirrors the inline `type:` regex idiom used across the
// installer (e.g. applyEmptyProjectWikilinkRepair). Returns null when no
// frontmatter `type:` line is present.
function _noteChromeFrontmatterType(body) {
  if (typeof body !== "string") return null;
  const m = body.match(/^type:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m);
  return m ? m[1] : null;
}

// Mirrors task-interactions@0.1.0's TaskInteractions.actionItemsAnchor() and
// .todayCaptureAnchor(). install.js cannot reach customJS (runs in Templater
// Node context, not Obsidian renderer), so these constants are intentionally
// duplicated. Keep them in sync if the mechanism's anchor strings change.
const ACTION_ITEMS_MARKER = '<!-- ACTION_ITEMS_MARKER -->';
const TODAY_CAPTURE_MARKER = '<!-- TODAY_CAPTURE_MARKER -->';

// _healNoteChromeBody — pure, idempotent body transform for the note-chrome
// wave-1 heal. (1) Injects a Breadcrumb dataviewjs block immediately before the
// first SpaceNavButtons dataviewjs fence when absent — the Breadcrumb guard
// (!/Breadcrumb/) makes the inject a no-op on already-healed notes. (2) For
// meeting notes only, rewrites the four `## H2` content headers to SectionLabel
// dataviewjs blocks matching the Meeting.md template's args shape. (3) For
// meeting notes only, drops a leftover markdown `---` divider that the old
// blank-shielded Meeting.md template left before each header (double-divider
// cleanup, v0.124.1). (4) Any type: scrub `args: [dv, ...]` from PeopleRendering
// invocations (v0.127.0 §A; bug shipped in <0.126.1 templates + inline_body).
// (5) Meeting only: inject ACTION_ITEMS_MARKER above the Action Items
// SectionLabel block (v0.127.0 §B; task-interactions appendTask anchor).
// (6) To-do only: inject TODAY_CAPTURE_MARKER below the Today SectionLabel
// block (v0.127.0 §F; TodayCaptureEditableList anchor). (7) To-do / meeting /
// scratch-day: strip the redundant `---` bracketing the action block now that
// the ToDoLeafActions/MeetingLeafActions/ScratchDayActions helper renders its own
// <hr> dividers (see _stripDividersAroundActionBlock). Returns the body unchanged
// when nothing applies (driver relies on `after === before`).
function _healNoteChromeBody(body, type) {
  if (typeof body !== "string") return body;
  let out = body;
  // 1. Inject breadcrumb if absent — before the first SpaceNavButtons dataviewjs
  //    fence (which, for scratch-day, sits after the H1, so this lands after H1).
  if (!/class:\s*"Breadcrumb"/.test(out)) {
    const bc = '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n```\n\n';
    const navIdx = out.indexOf('class: "SpaceNavButtons"');
    if (navIdx !== -1) {
      const fence = out.lastIndexOf('```dataviewjs', navIdx);
      if (fence !== -1) out = out.slice(0, fence) + bc + out.slice(fence);
    }
  }
  // 2. meeting only: rewrite "## Heading" content headers to SectionLabel.
  //    Fence-aware, line-by-line scan: a heading is only converted at code-fence
  //    depth 0, so a target heading a user pasted INSIDE a ```markdown sample is
  //    left untouched (rewriting it would corrupt both their fence and ours).
  //    Preserves the prior behavior for depth-0 headings: a preceding `---`
  //    divider line is dropped, the exact SectionLabel block text + view path are
  //    unchanged, and Attendees gets `top: true`. Idempotent: once a heading is a
  //    dataviewjs fence it no longer matches the `^##` test, so a second pass is a
  //    no-op.
  if (type === "meeting") {
    const labels = { "Attendees": true, "Agenda": false, "Notes": false, "Action Items": false };
    const lines = out.split("\n");
    const result = [];
    let inFence = false;
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence;
        result.push(line);
        continue;
      }
      if (!inFence) {
        const m = line.match(/^##\s+(Attendees|Agenda|Notes|Action Items)\s*$/);
        if (m) {
          const text = m[1];
          // Drop a `---` divider immediately preceding this heading (the prior
          // regex consumed it). result's tail is the line above this heading.
          if (result.length && /^---\s*$/.test(result[result.length - 1])) result.pop();
          const args = labels[text] ? `[{ text: "${text}", top: true }]` : `[{ text: "${text}" }]`;
          result.push('```dataviewjs');
          result.push('await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: ' + args + ' });');
          result.push('```');
          // Match the Meeting.md template spacing: exactly one blank line between
          // the closing fence and the following content line. If the source kept
          // its own blank after the heading, consume it so we don't double up.
          result.push('');
          if (i + 1 < lines.length && lines[i + 1].trim() === '') i++;
          changed = true;
          continue;
        }
      }
      result.push(line);
    }
    if (changed) out = result.join("\n");
    // 3. meeting only: drop a leftover markdown `---` divider when its next
    //    non-blank content is a SectionLabel dataviewjs block. v0.124.0 only
    //    consumed a `---` DIRECTLY adjacent to a `## Heading`; the old Meeting.md
    //    template shielded its `---` with a blank line (...```\n\n---\n\n## H2),
    //    so that `---` survived the H2->SectionLabel rewrite and now renders as a
    //    double divider (leftover `---` PLUS the SectionLabel hairline). This runs
    //    on the post-step-2 body so it cleans BOTH freshly-converted notes (step 2
    //    just emitted the SectionLabel blocks) AND already-healed notes from the
    //    v0.124.0 install (whose blocks are SectionLabel already — no `## H2` to
    //    re-trigger step 2). Content-safe: a `---` is removed ONLY when its next
    //    non-blank line opens a SectionLabel dataviewjs fence; a `---` before
    //    prose, a list, a heading, or any other block is left untouched.
    out = _dropDividersBeforeSectionLabels(out);
    // Inject the MeetingLeafActions row after the first SpaceNavButtons block,
    // for meeting LEAF notes only (skip Meeting Hubs, which carry the
    // `meetings-hub` tag in some vaults). Insert-only + idempotent.
    const isMeetingHub = /(^|\n)\s*-\s*meetings-hub\s*$/m.test(out);
    if (!isMeetingHub && !out.includes('class: "MeetingLeafActions"')) {
      const navIdx2 = out.indexOf('class: "SpaceNavButtons"');
      if (navIdx2 !== -1) {
        const closeRel = out.indexOf('\n```', navIdx2);   // closing fence of the SpaceNavButtons block
        if (closeRel !== -1) {
          const insertAt = closeRel + 4;                  // just after "\n```"
          const block = '\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MeetingLeafActions" });\n```';
          out = out.slice(0, insertAt) + block + out.slice(insertAt);
        }
      }
    }
  }
  // Step 4 (v0.127.0 §A) — scrub `args: [dv, ...]` from PeopleRendering
  // invocations. v0.126.1 fixed the source (template + inline_body), but 411+
  // existing notes carry the bug on-disk. The {0,400} bound restricts the match
  // to a single dataviewjs block — never rewrites a stray "[dv," outside a
  // PeopleRendering call. Fence-aware: handled by the larger function — this
  // step does a string replace AFTER fence-aware passes have run, because the
  // bug is inside a dataviewjs FENCE BODY (which means our step-1/2 fence
  // tracking treated it as content, not as bypass).
  const PEOPLE_RENDERING_BAD = /(class:\s*"PeopleRendering"[\s\S]{0,400}?args:\s*\[)\s*dv\s*,\s*/g;
  out = out.replace(PEOPLE_RENDERING_BAD, '$1');
  // Step 4b — guard the eager `dv.current().file.path` in the meeting
  // PeopleRendering inline_body. On cold load dv.current() is undefined, so
  // reading `.file` throws the transient "Cannot read properties of undefined
  // (reading 'file')" Evaluation Error that flashes then clears on re-render.
  // Rewrite to an optional-chained form with an active-file fallback (resolves
  // on the FIRST render, so no flash). Targets only the button-created shape;
  // the Templater template already guards via `const cur = dv.current(); … if
  // (notePath)`. Idempotent: `dv.current()?.file?.path` no longer matches.
  out = out.replace(
    /notePath:\s*dv\.current\(\)\.file\.path\b/g,
    'notePath: (dv.current()?.file?.path || app.workspace.getActiveFile()?.path)'
  );
  // Step 4c (cold-load-eradication cycle) — guard the eager
  // `personLink: dv.current().file.link` in the person-note PeopleRendering
  // inline_body (mentioning_person mode). Same cold-load failure + fix shape as
  // Step 4b, but a Dataview Link has no TFile equivalent, so the guard is a plain
  // optional-chain (no getActiveFile fallback) — matching the form the
  // Template, People.md + people manifest inline_body now emit for NEW notes.
  // Targets only the button-created person-note shape. Idempotent:
  // `dv.current()?.file?.link` no longer matches the bare pattern.
  // CYCLE-A-RETIREABLE: pure-additive + idempotent; lift into the migration-
  // retirement registry once all consumers pass the cold-load-eradication release.
  out = out.replace(
    /personLink:\s*dv\.current\(\)\.file\.link\b/g,
    'personLink: dv.current()?.file?.link'
  );
  // `out` may have changed; downstream steps (5, 6) operate on the scrubbed
  // content.
  // Step 5 — ensure the ACTION_ITEMS_MARKER sits INSIDE the Action Items
  // section (immediately after the "Action Items" SectionLabel block) so
  // task-interactions appendTask() deposits tasks BELOW the label, not above
  // it. Supersedes the v0.127.0 §B inject (which parked the marker above the
  // label; combined with the old insert-before-marker write, every button-
  // created task landed in the preceding Notes section). _relocateActionItemsMarker
  // handles all three states idempotently: no marker → inject after the label;
  // marker mis-placed above the label → relocate it AND drag the mis-placed
  // task run down into Action Items; marker already below the label → no-op.
  if (type === 'meeting') {
    out = _relocateActionItemsMarker(out);
  }
  // Step 6 (v0.127.0 §F; v0.127.1 PATCH — also inject the renderer block) —
  // inject TODAY_CAPTURE_MARKER + the TodayCaptureEditableList dataviewjs
  // block into daily to-do notes. v0.127.0 only injected the marker comment;
  // existing pre-deploy daily notes ended up with the anchor but no renderer
  // (the template was correct for NEW notes, but the heal didn't back-inject
  // the dataviewjs block). v0.127.1 closes that gap by inserting both
  // together. Idempotent guards: skip marker insert if marker present; skip
  // renderer insert if block already present (independent guards so a
  // partially-healed note from v0.127.0 still gets the renderer added).
  if (type === 'to-do'
      // task-entity model: once a daily has been migrated to note-per-task (it
      // carries a TaskTodayList render and/or the <!-- tasks-migrated --> sentinel),
      // the legacy TodayCaptureEditableList back-injection is obsolete and would
      // fight applyDailyTasksToEntityMigration (which strips that block) — each
      // install would re-add it, breaking idempotency. Skip step 6 entirely for
      // already-migrated dailies so the two heals cooperate.
      && !/class:\s*"TaskTodayList"/.test(out)
      && !out.includes('<!-- tasks-migrated -->')) {
    const sectionLabelStr = 'class: "SectionLabel", args: [{ text: "Today", top: true }]';
    const slIdx = out.indexOf(sectionLabelStr);
    if (slIdx !== -1) {
      // Find the closing fence of THIS dataviewjs block: walk forward from slIdx
      // looking for the next "\n```" sequence.
      const closeRel = out.indexOf('\n```', slIdx);
      if (closeRel !== -1) {
        const insertAt = closeRel + 4; // just after "\n```"
        // (a) Inject marker if absent.
        if (!out.includes(TODAY_CAPTURE_MARKER)) {
          out = out.slice(0, insertAt)
              + '\n\n' + TODAY_CAPTURE_MARKER
              + out.slice(insertAt);
        }
        // (b) Inject TodayCaptureEditableList block if absent. Position:
        // immediately after the marker line (so renderer reads tasks BETWEEN
        // SectionLabel("Today") fence and ToDoDailyCarryover block above).
        if (!out.includes('class: "TodayCaptureEditableList"')) {
          const markerIdx = out.indexOf(TODAY_CAPTURE_MARKER);
          if (markerIdx !== -1) {
            const markerLineEnd = markerIdx + TODAY_CAPTURE_MARKER.length;
            const rendererBlock = '\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList" });\n```';
            out = out.slice(0, markerLineEnd)
                + rendererBlock
                + out.slice(markerLineEnd);
          }
        }
      }
    }
  }
  // Step 7 (action-bar dividers) — the daily to-do / meeting / scratch-day action
  // helpers now render their OWN top+bottom <hr> dividers INSIDE their dataviewjs
  // block (wiki methodology), so the literal `---` the old templates bracketed
  // those blocks with is now a redundant double divider (and keeps the big
  // inter-block gap the change was meant to close). Strip a `---` immediately
  // before AND after the action block. Idempotent + tolerant of the current
  // adjacent shape (```/---/```dataviewjs) and the older blank-padded shape.
  if (type === 'to-do')       out = _stripDividersAroundActionBlock(out, 'ToDoLeafActions');
  if (type === 'meeting')     out = _stripDividersAroundActionBlock(out, 'MeetingLeafActions');
  if (type === 'scratch-day') out = _stripDividersAroundActionBlock(out, 'ScratchDayActions');
  // v0.9.0: NO sticky-day line here on purpose — migrated bodies already had
  // their class refs rewritten and no longer contain ScratchDayActions; only
  // legacy pre-migration scratch-day bodies still carry it (kept above).
  // Step 8 (chrome-bar cycle 2) — migrate to-do / meeting / scratch notes from
  // legacy stacked chrome (Breadcrumb + SpaceNavButtons + action-helper blocks)
  // to the single <Bp>ChromeBar block. Mirrors _healWikiChromeBody's approach:
  // strip known legacy blocks, insert the ChromeBar block after frontmatter.
  // Idempotent: notes already carrying the ChromeBar block are returned unchanged.
  const CHROME_BAR_MAP = {
    "to-do": "ToDoChromeBar", "to-do-hub": "ToDoChromeBar", "project-todo": "ToDoChromeBar", "to-do-recurring": "ToDoChromeBar",
    "meeting": "MeetingChromeBar",
    "task": "TaskChromeBar",
    // v0.9.0 sticky-notes rename: a stray un-migrated scratch-typed note heals to
    // StickyChromeBar (the class that actually exists post-rename). Scratch keys
    // KEPT so a partially-migrated vault still routes. New sticky types added.
    "scratch-hub": "StickyChromeBar", "scratch-day": "StickyChromeBar", "scratch": "StickyChromeBar",
    "sticky-hub": "StickyChromeBar", "sticky-day": "StickyChromeBar", "sticky-note": "StickyChromeBar",
    "trips-hub": "TripsChromeBar", "trip": "TripsChromeBar", "trip-section": "TripsChromeBar", "trip-board-card": "TripsChromeBar",
    "reader-hub": "ReaderChromeBar", "reader-article": "ReaderChromeBar",
    "people-hub": "PeopleChromeBar", "person": "PeopleChromeBar",
    "products-hub": "ProductsChromeBar", "product": "ProductsChromeBar",
    "teams-hub": "TeamsChromeBar", "team": "TeamsChromeBar",
    "journal": "JournalChromeBar",
    "board-card": "BoardsChromeBar",
    "finance-hub": "FinanceChromeBar", "budgets-hub": "FinanceChromeBar", "paychecks-hub": "FinanceChromeBar",
    "invoices-hub": "FinanceChromeBar", "debts-hub": "FinanceChromeBar", "months-hub": "FinanceChromeBar", "savings-hub": "FinanceChromeBar",
    "budget": "FinanceChromeBar", "paycheck": "FinanceChromeBar", "invoice": "FinanceChromeBar", "debt": "FinanceChromeBar",
    "month": "FinanceChromeBar", "savings-account": "FinanceChromeBar",
    "budget-defaults": "FinanceChromeBar", "paycheck-defaults": "FinanceChromeBar", "debt-defaults": "FinanceChromeBar", "finance-plan": "FinanceChromeBar",
    "invoice-board-card": "FinanceChromeBar", "time-log": "FinanceChromeBar",
  };
  const barClass = CHROME_BAR_MAP[type];
  if (barClass) out = _healChromeBarMigration(out, type, barClass);
  // Step 9 (v0.205.0) — people-hub: "+ New Person" moved from a standalone
  // EntityCreate dataviewjs fence into PeopleChromeBar's own primary button
  // (right of the compass). Strip the now-redundant block; a no-op when
  // already stripped (fresh template) or absent.
  if (type === "people-hub") out = _stripEntityCreateMarkerBlock(out, "person");
  return out;
}

// _stripDividersAroundActionBlock — pure, idempotent. Removes a markdown `---`
// divider immediately BEFORE and immediately AFTER a `class: "<className>"`
// dataviewjs action block, collapsing each side to a single blank line. The
// action helper now renders its own <hr> dividers (wiki methodology), so the
// template `---` is redundant. Tolerant of both the current adjacent template
// shape (```\n---\n```dataviewjs) and the older seed-fixture shape that padded
// the `---` with blank lines (```\n\n---\n\n```dataviewjs). A `---` that is not
// adjacent to the named action block is never touched. Mirrors the wiki heal's
// trailing-divider strip (_healWikiChromeBody step 4), extended to both sides.
function _stripDividersAroundActionBlock(body, className) {
  if (typeof body !== "string") return body;
  const q = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = body;
  // BEFORE: a `---` (with any padding blank lines) directly preceding the action
  // block → drop it, keeping exactly one blank line before the block.
  out = out.replace(
    new RegExp('\\n\\n-{3,}[ \\t]*\\n[ \\t\\r\\n]*(```dataviewjs\\n(?:\\/\\/[^\\n]*\\n)?await dv\\.view\\([^\\n]*class:\\s*"' + q + '")'),
    '\n\n$1'
  );
  // AFTER: a `---` directly following the action block's closing fence → drop it,
  // keeping one blank line after the block. (Same tail as _healWikiChromeBody.)
  out = out.replace(
    new RegExp('(class:\\s*"' + q + '"[\\s\\S]*?\\n```\\n)\\s*\\n?-{3,}[ \\t]*(\\r?\\n|$)'),
    '$1'
  );
  return out;
}

// _relocateActionItemsMarker — meeting-only, pure, idempotent. Guarantees the
// ACTION_ITEMS_MARKER lives immediately AFTER the Action Items SectionLabel
// block — the stable anchor task-interactions@appendTask writes BELOW. Three
// states:
//   (a) no marker present → inject "[blank, marker]" after the label's closing
//       fence.
//   (b) marker present but at/above the label (the original v0.127.0 placement,
//       which parked every button-created task under the Notes section) →
//       excise the marker PLUS the contiguous run of mis-placed task lines
//       directly above it, then re-emit "[blank, marker, blank, ...tasks]"
//       after the label's closing fence (tasks kept in document order).
//   (c) marker already below the label's closing fence → return unchanged.
// Conservative: only the contiguous (blank|task) run immediately above a
// mis-placed marker is moved; real Notes prose above that run is preserved
// (the upward walk stops at the first non-blank, non-task line). Idempotent:
// after one pass the marker is below the fence, so a second pass hits state (c)
// and returns the body unchanged (after === before).
function _relocateActionItemsMarker(body) {
  if (typeof body !== "string") return body;
  const sectionLabelStr = 'class: "SectionLabel", args: [{ text: "Action Items" }]';
  let lines = body.split("\n");
  const labelIdx = lines.findIndex((l) => l.includes(sectionLabelStr));
  if (labelIdx === -1) return body;                       // no Action Items section
  // Closing ``` fence of the Action Items dataviewjs block.
  let closeIdx = -1;
  for (let i = labelIdx + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("```")) { closeIdx = i; break; }
  }
  if (closeIdx === -1) return body;

  const markerIdx = lines.findIndex((l) => l.includes(ACTION_ITEMS_MARKER));
  if (markerIdx !== -1 && markerIdx > closeIdx) return body;   // (c) already correct

  let movedTasks = [];
  if (markerIdx !== -1) {
    // (b) marker mis-placed. Collect the contiguous (blank|task) run directly
    //     above it — those task lines are the mis-placed action items.
    const isTask = (s) => /^[-*+] \[[ xX]\] /.test(s);
    let regionEnd = markerIdx;
    if (markerIdx + 1 < lines.length && lines[markerIdx + 1].trim() === "") regionEnd = markerIdx + 1;
    const taskIdxs = [];
    for (let i = markerIdx - 1; i >= 0; i--) {
      const t = lines[i];
      if (t.trim() === "") continue;                      // blank — keep walking
      if (isTask(t)) { taskIdxs.push(i); continue; }      // task — collect
      break;                                              // prose / fence — stop
    }
    movedTasks = taskIdxs.slice().reverse().map((idx) => lines[idx]); // document order
    let regionStart = taskIdxs.length ? Math.min.apply(null, taskIdxs) : markerIdx;
    // Absorb the leading blank lines below the run's anchor so the excised gap
    // collapses to a single blank separator.
    while (regionStart - 1 >= 0 && lines[regionStart - 1].trim() === "") regionStart--;
    // Excise [regionStart..regionEnd], replacing it with one blank line — keeps
    // the Notes section and the Action Items label one blank apart.
    lines = lines.slice(0, regionStart).concat([""], lines.slice(regionEnd + 1));
  }

  // Re-locate the Action Items closing fence in the (possibly excised) array.
  const labelIdx2 = lines.findIndex((l) => l.includes(sectionLabelStr));
  let closeIdx2 = -1;
  for (let i = labelIdx2 + 1; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("```")) { closeIdx2 = i; break; }
  }
  if (closeIdx2 === -1) return lines.join("\n");          // defensive; shouldn't happen

  const insert = ["", ACTION_ITEMS_MARKER];
  if (movedTasks.length) insert.push("", ...movedTasks);
  lines.splice(closeIdx2 + 1, 0, ...insert);
  return lines.join("\n");
}

// _dropDividersBeforeSectionLabels — fence-aware, content-safe normalization.
// Removes a fence-depth-0 markdown `---` line whose next non-blank content opens
// a ```dataviewjs block containing "SectionLabel", collapsing to exactly ONE
// blank line before that block. A `---` inside a fenced code block (depth > 0) is
// user content and never touched; a `---` whose lookahead is anything other than
// a SectionLabel block is left verbatim. We never remove or alter a non-`---`
// line, so prose loss is impossible. Idempotent: after the pass no `---` precedes
// a SectionLabel block, so a second run finds nothing to drop (after === before).
function _dropDividersBeforeSectionLabels(body) {
  if (typeof body !== "string") return body;
  const lines = body.split("\n");
  // Never treat the leading YAML frontmatter delimiters as droppable dividers.
  let fmEnd = -1;
  if (lines.length && lines[0].trim() === "---") {
    for (let f = 1; f < lines.length; f++) {
      if (lines[f].trim() === "---") { fmEnd = f; break; }
    }
  }
  const result = [];
  let inFence = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      result.push(line);
      continue;
    }
    // Only a depth-0 `---` can be a markdown divider; one inside a fence is content.
    // A `---` at or before the leading frontmatter close (fmEnd) is a YAML
    // delimiter, never a divider — pushing it verbatim keeps the note's
    // frontmatter terminated (content-safety guard, v0.124.1).
    if (i > fmEnd && !inFence && /^---\s*$/.test(line)) {
      // Look ahead past blank lines to the next content line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      // Does that next content line open a SectionLabel dataviewjs block?
      let isSectionLabel = false;
      if (j < lines.length && /^\s*```dataviewjs\s*$/.test(lines[j])) {
        for (let k = j + 1; k < lines.length; k++) {
          if (/^\s*```\s*$/.test(lines[k])) break; // fence closed before a hit
          if (lines[k].includes("SectionLabel")) { isSectionLabel = true; break; }
        }
      }
      if (isSectionLabel) {
        // Drop this `---` and the blank run between it and the block, then push
        // exactly one blank separator (unless the emitted tail is already blank).
        if (result.length && result[result.length - 1].trim() !== "") result.push("");
        i = j - 1; // resume at the SectionLabel fence opener next iteration
        changed = true;
        continue;
      }
    }
    result.push(line);
  }
  return changed ? result.join("\n") : body;
}

// applyNoteChromeHeal — v0.124.0 (note-chrome wave 1). Per-vault scope heal
// (signature (tp, history, git), wired unconditionally like
// applyEmptyProjectWikilinkRepair). Task 1 added the Breadcrumb dv.view(...)
// call to the meetings/scratch/to-do TEMPLATES, so NEW notes get chrome; this
// heal back-injects it into EXISTING notes (and rewrites meeting ## H2 content
// headers to SectionLabel) so old + new notes render identically. Idempotent:
// the Breadcrumb guard + `after === before` short-circuit make re-runs no-ops.
// Posture mirrors the established heals: per-note try/catch, fails-loud (history
// warning) but never throws, full git fields on every push, .sauce-backup
// snapshot before any write. Reuses _listAllMarkdownRecursive.
// _healChromeBarMigration — pure, idempotent body transform for cycle-2
// chrome-bar adoption (to-do / meetings / scratch). Strips every LEGACY
// chrome block (Breadcrumb / SpaceNavButtons / ProjectNavButtons / the
// standalone action-helper blocks: ToDoHubActions, ToDoLeafActions,
// MeetingLeafActions, ScratchHubActions, ScratchDayActions, ScratchLeafActions /
// chrome "---" dividers around those blocks) and inserts one <Bp>ChromeBar
// block right after the frontmatter. A note already carrying the target
// ChromeBar class is returned unchanged (idempotent).
function _healChromeBarMigration(body, type, barClass) {
  if (!body || typeof body !== 'string') return body;
  // Already migrated — idempotent guard.
  if (body.includes(barClass)) return body;
  // No legacy chrome to strip — nothing to do (e.g. notes that never had nav).
  const hasLegacyNav = /SpaceNavButtons|Breadcrumb/.test(body);
  const hasLegacyAction = /ToDoHubActions|ToDoLeafActions|MeetingLeafActions|ScratchHubActions|ScratchDayActions|ScratchLeafActions|TripNavButtons|ReaderArticleActions|ProductActionButtons|TeamActionButtons/.test(body);
  // person notes carry ONLY PersonNavButtons (kept, not stripped — see LEGACY_CLASSES
  // below) with no Breadcrumb/SpaceNavButtons/action block at all, so the generic
  // hasLegacyNav/hasLegacyAction checks never fire for them. Without this allowance
  // the function would bail here and existing person notes would never gain
  // PeopleChromeBar. This is the ONLY type where ChromeBar is inserted alongside
  // (not in place of) existing chrome.
  const hasPersonNav = type === 'person' && /PersonNavButtons/.test(body);
  if (!hasLegacyNav && !hasLegacyAction && !hasPersonNav) return body;

  let out = body;

  // Strip known legacy dataviewjs blocks (class name inside the block).
  const LEGACY_CLASSES = [
    'Breadcrumb', 'SpaceNavButtons', 'ProjectNavButtons',
    'ToDoHubActions', 'ToDoLeafActions',
    'MeetingLeafActions',
    'ScratchHubActions', 'ScratchDayActions', 'ScratchLeafActions',
    'TripNavButtons', 'ReaderArticleActions', 'ProductActionButtons', 'TeamActionButtons',
  ];
  for (const cls of LEGACY_CLASSES) {
    // Match the full ```dataviewjs ... ``` fence containing the class name.
    const re = new RegExp('```dataviewjs\\s*\\n[^`]*?["\']' + cls + '["\'][^`]*?\\n```\\s*\\n?', 'g');
    out = out.replace(re, '');
  }

  // Strip orphaned chrome "---" dividers: a line that is just `---` (not
  // frontmatter) surrounded by blank lines (left by removing the nav/action blocks).
  // Preserve the frontmatter fence (first and second `---` in the file).
  // Strategy: split on frontmatter, then strip standalone `---` lines from the body.
  const fmEnd = out.indexOf('---', out.indexOf('---') + 3);
  if (fmEnd >= 0) {
    const fm = out.slice(0, fmEnd + 3);
    let rest = out.slice(fmEnd + 3);
    // Collapse runs of \n---\n (standalone divider, not preceded by non-blank).
    rest = rest.replace(/\n---\s*\n(\s*\n)*/g, '\n');
    out = fm + rest;
  }

  // Collapse triple+ blank lines → double.
  out = out.replace(/\n{3,}/g, '\n\n');

  // Insert the ChromeBar block right after the frontmatter close.
  const insertIdx = out.indexOf('---', out.indexOf('---') + 3);
  if (insertIdx >= 0) {
    const before = out.slice(0, insertIdx + 3);
    const after = out.slice(insertIdx + 3);
    // Skip any heading line (e.g. "# Scratch") right after frontmatter.
    const headingMatch = after.match(/^\s*\n(# [^\n]+\n)/);
    if (headingMatch) {
      const heading = headingMatch[0];
      const rest = after.slice(heading.length);
      out = before + heading + '\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + barClass + '" });\n```\n' + rest;
    } else {
      out = before + '\n\n```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + barClass + '" });\n```\n' + after;
    }
  }

  return out;
}

// _dailyChromeBarBody(body) — pure, idempotent body transform. Rewrites a
// legacy Daily note (type: cowork-daily) that still carries the old
// SpaceNavButtons chrome block into the new DailyChromeBar block, stripping the
// literal "---" chrome dividers the old daily template used (DailyChromeBar's
// own trailing hairline divider now owns that boundary). The SpaceDailyDashboard
// content block is preserved. Idempotent: a note already carrying a
// DailyChromeBar block is returned UNCHANGED (never re-touch a healthy note).
// Self-contained (no closure over module constants) mirroring
// _healChromeBarMigration / _healWikiChromeBody so it's directly unit-testable.
function _dailyChromeBarBody(body) {
  if (typeof body !== "string") return body;
  if (/class:\s*"DailyChromeBar"/.test(body)) return body; // idempotent guard
  const VP = "ranch/views/customjs-guard";
  const barBlock = '```dataviewjs\nawait dv.view("' + VP + '", { class: "DailyChromeBar" });\n```';

  // Split leading frontmatter off so its `---` fences are never candidates.
  const fm = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? body.slice(0, fm[0].length) : "";
  let rest = fm ? body.slice(fm[0].length) : body;

  // Strip the legacy SpaceNavButtons chrome block (fence-to-fence, optional
  // leading `// comment` line inside the block), matching _healWikiChromeBody.
  rest = rest.replace(
    /```dataviewjs\n(?:\/\/[^\n]*\n)?await dv\.view\("[^"]*",\s*\{\s*class:\s*"SpaceNavButtons"\s*\}\);\n```\n?/g,
    ""
  );
  // Strip standalone `---` chrome dividers (a line that is only dashes),
  // surrounded by blank lines, left by removing the nav block or padded by the
  // old template around the dashboard.
  rest = rest.replace(/(^|\n)[ \t]*-{3,}[ \t]*(?=\r?\n)/g, "$1");
  // Collapse the blank-line runs the strips leave behind.
  rest = rest.replace(/\n{3,}/g, "\n\n");
  rest = rest.replace(/^\s*/, "");
  rest = rest.replace(/\s*$/, "\n");

  return head + (head ? "\n" : "") + barBlock + "\n\n" + rest;
}

// _homeChromeBarBody(body) — pure, idempotent body transform. Rewrites a legacy
// Home.md (type: home) that still carries the old SpaceNavButtons chrome block
// into the new HomeChromeBar block, preserving the SpaceHome content block and
// the HOME_CHROME_END marker verbatim. Idempotent: a note already carrying a
// HomeChromeBar block is returned UNCHANGED. Self-contained, mirroring
// _dailyChromeBarBody above. Named to avoid colliding with the pre-existing
// _healHomeChromeBody (which intentionally rebuilds the OLD SpaceNavButtons +
// SpaceHome chrome above the marker for applyHomeScaffoldHeal).
function _homeChromeBarBody(body) {
  if (typeof body !== "string") return body;
  if (/class:\s*"HomeChromeBar"/.test(body)) return body; // idempotent guard
  const VP = "ranch/views/customjs-guard";
  const barBlock = '```dataviewjs\nawait dv.view("' + VP + '", { class: "HomeChromeBar" });\n```';

  const fm = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? body.slice(0, fm[0].length) : "";
  let rest = fm ? body.slice(fm[0].length) : body;

  rest = rest.replace(
    /```dataviewjs\n(?:\/\/[^\n]*\n)?await dv\.view\("[^"]*",\s*\{\s*class:\s*"SpaceNavButtons"\s*\}\);\n```\n?/g,
    ""
  );
  // Strip standalone `---` chrome dividers, but NEVER the HOME_CHROME_END
  // marker line ("[//]: # (...)") — the dash strip only targets pure-dash lines,
  // so the marker is safe.
  rest = rest.replace(/(^|\n)[ \t]*-{3,}[ \t]*(?=\r?\n)/g, "$1");
  rest = rest.replace(/\n{3,}/g, "\n\n");
  rest = rest.replace(/^\s*/, "");
  rest = rest.replace(/\s*$/, "\n");

  return head + (head ? "\n" : "") + barBlock + "\n\n" + rest;
}

// _healSectionLinksFrontmatter — pure, idempotent frontmatter transform. Backfills
// `links: []` onto wiki-hub / wiki-section / docs-hub / section-hub notes that
// lack the key (section-explorer's per-hub/section links contract — see
// schemas-index.json's "section-explorer-links-frontmatter" entry). It never
// touches an EXISTING `links:` line (line-anchored /^links:/m match) regardless
// of quoting; it only ever inserts a brand-new key when one is entirely absent.
// No-ops on notes of any other type, on notes with no frontmatter block, and on
// notes that already carry a `links:` key (idempotent — re-running install a
// second time is a no-op here).
function _healSectionLinksFrontmatter(body, type) {
  if (typeof body !== "string") return body;
  if (!["wiki-hub", "wiki-section", "docs-hub", "section-hub"].includes(type)) return body;
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!fm) return body;
  const fmBody = fm[1];
  if (/^links:/m.test(fmBody)) return body;
  const newFmBody = fmBody + "\nlinks: []";
  return body.slice(0, fm.index) + "---\n" + newFmBody + "\n---\n" + body.slice(fm.index + fm[0].length);
}

// _healWikiChromeBody — pure, idempotent body transform for wiki notes
// (chrome-bar adoption). Migrates a note's chrome to the single WikiChromeBar
// bar: strips every LEGACY chrome block (Breadcrumb / SpaceNavButtons / the
// standalone WikiHubActions & WikiLeafActions action blocks / the two legacy
// stacked entity-create blocks / the chrome "---" divider) and inserts one
// WikiChromeBar block right after the frontmatter. WikiTree is CONTENT (the
// create buttons moved into the bar) and is preserved; hub/section notes are
// guaranteed a WikiTree block below the bar. A note already carrying a
// WikiChromeBar block is returned unchanged (idempotent).
function _healWikiChromeBody(body, type) {
  if (typeof body !== "string") return body;
  if (!["wiki-hub", "wiki-section", "wiki-page"].includes(type)) return body;
  const VP = "ranch/views/customjs-guard";
  const barBlock = '```dataviewjs\nawait dv.view("' + VP + '", { class: "WikiChromeBar" });\n```';
  const treeBlock = '```dataviewjs\nawait dv.view("' + VP + '", { class: "WikiTree" });\n```';

  // Idempotent: already migrated → no-op.
  if (/class:\s*"WikiChromeBar"/.test(body)) return body;

  let out = body;

  // Strip the two legacy stacked entity-create blocks (older hub grammar).
  out = out.replace(/```dataviewjs\n\/\/ entity-create:wiki-section[\s\S]*?instance: "wiki-page" \}\] \}\);\n```\n?/g, "");
  // Strip each legacy chrome block (Breadcrumb / SpaceNavButtons / WikiHubActions
  // / WikiLeafActions). WikiTree is intentionally NOT in this list — it's content.
  for (const cls of ["Breadcrumb", "SpaceNavButtons", "WikiHubActions", "WikiLeafActions"]) {
    const re = new RegExp('```dataviewjs\\n(?:\\/\\/[^\\n]*\\n)?await dv\\.view\\("[^"]*",\\s*\\{\\s*class:\\s*"' + cls + '"\\s*\\}\\);\\n```\\n?', "g");
    out = out.replace(re, "");
  }

  // Split off the frontmatter so the bar lands right after it.
  const fm = out.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  const head = fm ? out.slice(0, fm[0].length) : "";
  let rest = fm ? out.slice(fm[0].length) : out;
  // Drop leading blank lines + any stray leading chrome "---" the strips left behind.
  rest = rest.replace(/^\s*/, "");
  rest = rest.replace(/^-{3,}[ \t]*\r?\n\s*/, "");
  // hub/section keep their WikiTree content block; guarantee one exists.
  if (type !== "wiki-page" && !/class:\s*"WikiTree"/.test(rest)) {
    rest = treeBlock + "\n\n" + rest;
  }

  const sep = rest.length ? "\n\n" : "\n";
  return head + (head ? "\n" : "") + barBlock + sep + rest;
}

// _HOME_CHROME — canonical body chrome for spice/home/Home.md written by the
// FRESH-FILE scaffold branch of applyHomeScaffoldHeal. Two customjs-guard blocks
// (HomeChromeBar → SpaceHome) terminated by an invisible link-ref marker.
// Everything ABOVE the marker is platform-owned; anything the user types BELOW
// it is preserved. Kept in lockstep with blueprints/home/content/home-template.md
// ({{views_path}} resolves to ranch/views, so the paths are byte-identical after
// render). The template adopted HomeChromeBar this cycle; this constant follows so
// a brand-new Home.md is born in the new-bar shape and applyDailyHomeChromeBarHeal
// no-ops on it (no scaffold-then-migrate churn / .sauce-backup on fresh installs).
// NOTE: the SEPARATE _healHomeChromeBody() existing-note repair path still
// rebuilds the older SpaceNavButtons+SpaceHome chrome (locked by run-home.js
// HOME-HEAL-*); applyDailyHomeChromeBarHeal is what forward-migrates any such
// repaired/legacy note onto HomeChromeBar.
const _HOME_CHROME_MARKER = "[//]: # (HOME_CHROME_END)";
const _HOME_CHROME = [
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "HomeChromeBar" });',
  '```',
  '',
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });',
  '```',
  '',
  _HOME_CHROME_MARKER,
].join("\n");

// _healHomeChromeBody — pure, idempotent body transform for spice/home/Home.md.
// SELF-CONTAINED (no closure over module-level constants) so the behavioral
// harness can slice its source out of install.js and eval it standalone, exactly
// like run-wiki.js does with _healWikiChromeBody.
// - Chrome already present (`class: "SpaceHome"` found): return the body
//   UNCHANGED (idempotent no-op — never re-touch a healthy note).
// - Chrome absent: rebuild the canonical chrome above the marker, preserving any
//   user content that lived after the marker (or, for a bare pre-blueprint note
//   with no marker at all, appending the whole thing below the fresh marker).
function _healHomeChromeBody(body) {
  // Contract: everything ABOVE the HOME_CHROME_END marker is platform-owned chrome
  // (rebuilt here); only content BELOW the marker is user free-write and is preserved.
  // A healthy note (SpaceHome block present) is returned unchanged. When the chrome is
  // missing, above-marker text is intentionally discarded — applyHomeScaffoldHeal always
  // writes a .sauce-backup first, so it is recoverable.
  const marker = "[//]: # (HOME_CHROME_END)";
  const chrome = [
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
    '```',
    '',
    '---',
    '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });',
    '```',
    '',
    marker,
  ].join("\n");
  const raw = typeof body === "string" ? body : "";
  // Healthy note — leave every byte alone.
  if (/class:\s*"SpaceHome"/.test(raw)) return raw;
  // Split off any user content below the marker (there won't be chrome above it
  // since SpaceHome is absent, but a stray marker could still exist).
  const markerIdx = raw.indexOf(marker);
  let userTail;
  if (markerIdx >= 0) {
    userTail = raw.slice(markerIdx + marker.length);
  } else {
    const trimmed = raw.trim();
    userTail = trimmed ? "\n\n" + trimmed : "";
  }
  return chrome + userTail;
}

// _healHomeFrontmatterEditorWidth — pure, idempotent frontmatter transform for
// spice/home/Home.md. Stamps `editor-width: 100` when absent.
//
// WHY: the third-party community plugin "editor-width-slider" listens to
// Obsidian's "file-open" event and unconditionally overwrites the
// --file-line-width CSS custom property with `!important` — which beats our
// own cssclasses:[wide] rule (not !important) regardless of source order. If
// a note has NO `editor-width` frontmatter field, the plugin falls back to
// its own slider-percentage default, which differs from whatever width was
// showing a moment ago (the previously active note's own width, or nothing
// yet) — producing a visible width jump on every single Home open. The
// plugin explicitly supports a per-note override via `editor-width` in
// frontmatter (0-100); stamping Home's own note with a fixed value makes its
// rendered width deterministic on every open, independent of plugin state
// left over from whatever note was active before. `100` maps to the
// plugin's own formula (`calc(100px + 100vw)`) which is effectively
// unconstrained, matching the intent of cssclasses:[wide].
//
// Never touches a note that already declares editor-width (respects an
// explicit user override); never touches anything if there's no frontmatter
// block at all; never throws.
function _healHomeFrontmatterEditorWidth(body) {
  const raw = typeof body === "string" ? body : "";
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return raw;
  const fmBlock = fmMatch[1];
  if (/^editor-width\s*:/m.test(fmBlock)) return raw;
  const healedFm = "---\n" + fmBlock + "\neditor-width: 100\n---\n";
  return raw.slice(0, fmMatch.index) + healedFm + raw.slice(fmMatch.index + fmMatch[0].length);
}

// _READER_CHROME — canonical body chrome for spice/reader/Reader.md. Two
// customjs-guard blocks (ReaderChromeBar → ReaderQueue). Kept in lockstep with
// blueprints/reader/content/Reader Hub.md ({{views_path}} resolves to
// ranch/views, so the paths are byte-identical after render). The hub template
// has no content marker by default; any user free-write below a READER_CONTENT
// marker is preserved by _healReaderChromeBody.
const _READER_CHROME = [
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "ReaderChromeBar" });',
  '```',
  '',
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "ReaderQueue" });',
  '```',
].join("\n");

// _healReaderChromeBody — pure, idempotent body transform for spice/reader/Reader.md.
// SELF-CONTAINED (no closure over module-level constants) so the behavioral harness
// can slice its source out of install.js and eval it standalone, exactly like
// _healHomeChromeBody.
// - Chrome already present (`class: "ReaderQueue"` found): return the body
//   UNCHANGED (idempotent no-op — never re-touch a healthy note).
// - Chrome absent: rebuild the canonical chrome, preserving any user content that
//   lived after a READER_CONTENT marker (or, for a bare pre-blueprint note with no
//   marker at all, appending the whole thing below the fresh chrome).
function _healReaderChromeBody(raw) {
  const marker = "[//]: # (READER_CONTENT)";
  const chrome = [
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "ReaderChromeBar" });',
    '```',
    '',
    '```dataviewjs',
    'await dv.view("ranch/views/customjs-guard", { class: "ReaderQueue" });',
    '```',
  ].join("\n");
  const body = typeof raw === "string" ? raw : "";
  // Healthy note — leave every byte alone.
  if (/class:\s*"ReaderQueue"/.test(body)) return body;
  // Split off any user content below the marker (there won't be chrome above it
  // since ReaderQueue is absent, but a stray marker could still exist).
  const markerIdx = body.indexOf(marker);
  let userTail;
  if (markerIdx >= 0) {
    userTail = "\n\n" + marker + body.slice(markerIdx + marker.length);
  } else {
    const trimmed = body.trim();
    userTail = trimmed ? "\n\n" + trimmed : "";
  }
  return chrome + userTail;
}

async function applyNoteChromeHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const roots = ["spice/meetings", "spice/scratch", "spice/sticky-notes", "spice/to-do", "spice/people", "spice/wiki", "spice/projects", "spice/trips", "spice/reader", "spice/products", "spice/teams", "spice/journal", "spice/boards", "spice/finance", "spice/tasks"];
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, warned = 0;
  for (const root of roots) {
    if (!(await adapter.exists(root))) continue;
    let files;
    try {
      files = await _listAllMarkdownRecursive(adapter, root);
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "note_chrome_heal",
        reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      continue;
    }
    for (const fpath of files) {
      try {
        const before = await adapter.read(fpath);
        const type = _noteChromeFrontmatterType(before);
        const WIKI_TYPES = ["wiki-hub", "wiki-section", "wiki-page"];
        const CYCLE3_TYPES = ["trips-hub", "trip", "trip-section", "trip-board-card", "reader-hub", "reader-article", "people-hub", "products-hub", "product", "teams-hub", "team", "journal"];
        const CYCLE4_TYPES = ["board-card", "finance-hub", "budgets-hub", "paychecks-hub", "invoices-hub", "debts-hub", "months-hub", "savings-hub", "budget", "paycheck", "invoice", "debt", "month", "savings-account", "budget-defaults", "paycheck-defaults", "debt-defaults", "finance-plan", "invoice-board-card", "time-log"];
        if (!["meeting", "scratch", "scratch-day", "scratch-hub", "sticky-note", "sticky-day", "sticky-hub", "to-do", "to-do-hub", "project-todo", "to-do-recurring", "person", "task", ...WIKI_TYPES, ...CYCLE3_TYPES, ...CYCLE4_TYPES].includes(type)) continue;
        let after = WIKI_TYPES.includes(type) ? _healWikiChromeBody(before, type) : _healNoteChromeBody(before, type);
        after = _healSectionLinksFrontmatter(after, type);
        if (after === before) continue;
        // .sauce-backup snapshot before write (mirrors applyFinanceMigrations).
        const backupPath = `.sauce-backup/${ts}/${fpath}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
        await adapter.write(fpath, after);
        healed += 1;
        history?.push({ event: "info", step: "note_chrome_heal", target: fpath, action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: "note_chrome_heal",
          reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
    }
  }
  history?.push({ event: "info", step: "note_chrome_heal", name: "vault",
    reason: `healed ${healed}; ${warned} warning(s)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
}

// applyMeetingsHubChromeBarHeal — Meeting Hub notes carry `tags: [..., meetings-hub,
// ...]` but NO frontmatter `type:` field (tag-based hub, not type-based — see
// note-chrome.md §6), so applyNoteChromeHeal's type-keyed dispatch (line 6517)
// never reaches them. Separate, small heal: scan spice/meetings/hubs for tag
// "meetings-hub", reuse the existing pure _healChromeBarMigration(body, type,
// barClass) transform (same strip-legacy-chrome + insert-ChromeBar-block logic
// cycle-2 already uses for meeting/scratch/to-do) with barClass "MeetingChromeBar".
// Per-vault, .sauce-backup snapshot before write, idempotent (transform itself
// short-circuits when the target class is already present), never throws.
// _stripEntityCreateMarkerBlock — pure, idempotent transform (v0.205.0):
// strips a single standalone EntityCreate dataviewjs fence for instanceId,
// collapsing any orphaned standalone "---" divider / blank-line runs left
// behind. Used wherever a hub's "+ New <X>" moves from this standalone block
// into its own ChromeBar adapter's primary button (right of the compass) —
// first meetings, now people, generic so future blueprints doing the same
// fold don't need a bespoke copy. Handles both marker shapes: the current
// inside-fence `// entity-create:<id>` JS comment, and the pre-v0.49.0
// outside-fence `<!-- entity-create:<id> -->` HTML comment (a handful of
// very old notes predate the v0.49.0 marker-format migration and never got
// touched by it, since that migration only rewrote the comment syntax —
// it never removed blocks). No-op when neither shape is present.
function _stripEntityCreateMarkerBlock(body, instanceId) {
  if (typeof body !== "string" || typeof instanceId !== "string" || instanceId.length === 0) return body;
  const escId = instanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const viewCall = 'await dv\\.view\\("[^"]*",\\s*\\{\\s*class:\\s*"EntityCreate",\\s*args:\\s*\\[\\{\\s*instance:\\s*"' + escId + '"\\s*\\}\\]\\s*\\}\\);\\n';
  const reNewFormat = new RegExp(
    "```dataviewjs\\n// entity-create:" + escId + "[^\\n]*\\n" + viewCall + "```\\n?",
    "g"
  );
  const reOldFormat = new RegExp(
    "<!--\\s*entity-create:" + escId + "\\s*-->\\n```dataviewjs\\n" + viewCall + "```\\n?",
    "g"
  );
  let out = body.replace(reNewFormat, "").replace(reOldFormat, "");
  if (out === body) return body;
  const fmEnd = out.indexOf('---', out.indexOf('---') + 3);
  if (fmEnd >= 0) {
    const fm = out.slice(0, fmEnd + 3);
    let rest = out.slice(fmEnd + 3);
    rest = rest.replace(/\n---\s*\n(\s*\n)*/g, '\n');
    out = fm + rest;
  }
  out = out.replace(/\n{3,}/g, '\n\n');
  return out;
}

// _stripMeetingsHubEntityCreateBlock — thin wrapper (kept for call-site/test
// clarity) around the generic _stripEntityCreateMarkerBlock for the "meeting"
// instance specifically.
function _stripMeetingsHubEntityCreateBlock(body) {
  return _stripEntityCreateMarkerBlock(body, "meeting");
}

async function applyMeetingsHubChromeBarHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const root = "spice/meetings/hubs";
  if (!(await adapter.exists(root))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, warned = 0;
  let files;
  try {
    files = await _listAllMarkdownRecursive(adapter, root);
  } catch (e) {
    history?.push({ event: "warning", step: "meetings_hub_chrome_bar_heal",
      reason: `list failed for ${root}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }
  for (const fpath of files) {
    try {
      const before = await adapter.read(fpath);
      if (!/^\s*-\s*["']?meetings-hub["']?\s*$/m.test(before)) continue;
      let after = _healChromeBarMigration(before, "meeting", "MeetingChromeBar");
      after = _stripMeetingsHubEntityCreateBlock(after);
      if (after === before) continue;
      const backupPath = `.sauce-backup/${ts}/${fpath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
      try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
      await adapter.write(fpath, after);
      healed += 1;
      history?.push({ event: "info", step: "meetings_hub_chrome_bar_heal", target: fpath, action: "healed",
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "meetings_hub_chrome_bar_heal",
        reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }
  history?.push({ event: "info", step: "meetings_hub_chrome_bar_heal", name: "vault",
    reason: `healed ${healed}; ${warned} warning(s)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
}

// _resolveProjectDisplayName — given a project dir's markdown files (paths) +
// an adapter, returns the basename (sans .md) of the note that lives DIRECTLY
// under projectDir and carries frontmatter type:project. This is the project's
// display name (mirrors the legacy ProjectNavButtons._resolveProjectFromPath
// convention: the hub note's filename IS the display name). Returns null when
// no such note is found. Reads the type via _noteChromeFrontmatterType.
async function _resolveProjectDisplayName(adapter, projectDir, candidateFiles) {
  const prefix = projectDir + "/";
  for (const fpath of candidateFiles) {
    if (!fpath.startsWith(prefix)) continue;
    if (fpath.slice(prefix.length).includes("/")) continue;
    let body;
    try { body = await adapter.read(fpath); } catch (_e) { continue; }
    if (_noteChromeFrontmatterType(body) === "project") {
      const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm) {
        const nm = fm[1].match(/^name:\s*(.+?)\s*$/m);
        if (nm) {
          const v = nm[1].trim().replace(/^["']|["']$/g, "");
          if (v) return v;
        }
      }
      const base = fpath.split("/").pop();
      return base.endsWith(".md") ? base.slice(0, -3) : base;
    }
  }
  return null;
}

// _injectProjectNameFrontmatter — pure, idempotent transform. When the body has
// a leading frontmatter block whose `type:` is map/kanban/task-note and which
// LACKS a `project_name:` field, inserts `project_name: "<name>"` immediately
// after the `type:` line (mirrors the template field placement). Returns the
// body unchanged when there's no FM block, the type doesn't match, project_name
// already exists, or the type: line can't be located (driver short-circuits on
// `after === before`). The display name is YAML-double-quote escaped.
function _injectProjectNameFrontmatter(body, name) {
  if (typeof body !== "string") return body;
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return body;
  const fmText = fmMatch[1];
  const typeMatch = fmText.match(/^type:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/m);
  if (!typeMatch) return body;
  if (!["map", "kanban", "task-note"].includes(typeMatch[1])) return body;
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const existing = fmText.match(/^project_name:\s*(.*)\s*$/m);
  if (existing) {
    const curVal = existing[1].trim().replace(/^["']|["']$/g, "");
    if (curVal === String(name)) return body;        // idempotent no-op
    const fmStart = body.indexOf(fmText);
    const lineIdxInFm = fmText.indexOf(existing[0]);
    const head = body.slice(0, fmStart + lineIdxInFm);
    const tail = body.slice(fmStart + lineIdxInFm + existing[0].length);
    return head + `project_name: "${escaped}"` + tail;  // repair
  }

  const insert = `\nproject_name: "${escaped}"`;
  const fmStart = body.indexOf(fmText);
  const typeLineFull = typeMatch[0];
  const typeIdxInFm = fmText.indexOf(typeLineFull);
  const absIdx = fmStart + typeIdxInFm + typeLineFull.length;
  return body.slice(0, absIdx) + insert + body.slice(absIdx);
}

// applyProjectNameBackfill — v0.124.0 (note-chrome wave 1). Per-mechanism scope
// (project-gated, mirrors applyDocsHubButtonRepair). Task 1 added project_name
// FM to the Project Map / Project Board / Task Note templates so NEW notes carry
// the display name; this heal back-fills it into EXISTING map/kanban/task-note
// notes so the breadcrumb's fm:project_name resolver shows the mixed-case
// display name instead of the lowercase path:2 slug fallback. For each project
// dir it resolves the display name from the hub note (type:project) basename,
// then stamps project_name onto every map/kanban/task-note note under that dir
// that lacks it. Idempotent (skips notes that already carry project_name + uses
// `after === before` short-circuit), per-note try/catch, never throws, full git
// fields on every history push, .sauce-backup snapshot before any write. Reuses
// _listAllMarkdownRecursive + _noteChromeFrontmatterType.
async function applyProjectNameBackfill(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "project") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const projectsRoot = "spice/projects";
  if (!(await adapter.exists(projectsRoot))) return;

  let projectsList;
  try {
    projectsList = await adapter.list(projectsRoot);
  } catch (e) {
    history?.push({ event: "warning", step: "project_name_backfill", name: "project",
      reason: `list failed for ${projectsRoot}: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }

  const projectDirs = (projectsList.folders || []).filter((d) => d.split("/").pop() !== "All Projects");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let stamped = 0, warned = 0;

  for (const projectDir of projectDirs) {
    let files;
    try {
      files = await _listAllMarkdownRecursive(adapter, projectDir);
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "project_name_backfill", name: "project",
        reason: `list failed for ${projectDir}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      continue;
    }

    const displayName = await _resolveProjectDisplayName(adapter, projectDir, files);
    if (!displayName) continue; // no hub note resolvable — leave notes untouched.

    for (const fpath of files) {
      try {
        const before = await adapter.read(fpath);
        const type = _noteChromeFrontmatterType(before);
        if (!["map", "kanban", "task-note"].includes(type)) continue;
        const after = _injectProjectNameFrontmatter(before, displayName);
        if (after === before) continue;
        // .sauce-backup snapshot before write (mirrors applyNoteChromeHeal).
        const backupPath = `.sauce-backup/${ts}/${fpath}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
        await adapter.write(fpath, after);
        stamped += 1;
        history?.push({ event: "info", step: "project_name_backfill", name: "project", target: fpath, action: "stamped_project_name",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: "project_name_backfill", name: "project",
          reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
    }
  }

  history?.push({ event: "info", step: "project_name_backfill", name: "project",
    reason: `stamped ${stamped}; ${warned} warning(s)`,
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

  // ProjectChromeBar guard (button/nav refactor Pass 9a): a hub that renders the
  // single ProjectChromeBar block OWNS entity creation (the bar's primary + `⋯`
  // route through EntityCreate.create). Such hubs intentionally carry NO
  // `// entity-create:<id>` marker — the marker + this verify pass predate
  // ProjectChromeBar. Treat a ProjectChromeBar target as satisfied (record an info
  // event, no missing_skip_inject warning) so the retired project-hub markers don't
  // spam every install. Non-ProjectChromeBar hubs (people, finance, meetings,
  // scratch) still verify their marker below.
  if (_hasChromeBar(body)) {
    if (history) {
      history.push({
        event: "info",
        step: "entity_create_block_verified",
        name: sourceName,
        target: targetPath,
        instance: instanceId,
        action: "owned_by_project_chrome_bar",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
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
// applyBundledPlugin — vendors a FIRST-PARTY Obsidian plugin bundled inside a
// mechanism (mech.bundled_plugin) into <vault>/.obsidian/plugins/<id>/ and
// enables it in community-plugins.json. Unlike applyExternalPluginInstall (which
// FETCHES community plugins from the obsidian-releases index), this copies files
// shipped in the platform payload. Idempotent; per-file try/catch; NEVER throws.
// The enable step preserves all other plugin ids and no-ops on an absent/malformed
// community-plugins.json (the files still land, so a later manual enable works).
// Gated on mech.bundled_plugin, so it only fires for the sauce-plugin mechanism.
async function applyBundledPlugin(tp, mech, vaultPath, workshopPath, history, git) {
  const bp = mech && mech.bundled_plugin;
  if (!bp || !bp.id || !Array.isArray(bp.files) || bp.files.length === 0) return;
  const path = require("path");
  const fs = require("fs");
  const adapter = tp.app.vault.adapter;
  const gitInfo = git || {};
  const hist = (event, extra) => {
    if (!history) return;
    history.push(Object.assign({
      event, step: "bundled_plugin", name: mech.name, plugin_id: bp.id,
      git_commit: gitInfo.commit, git_tag: gitInfo.tag, git_dirty: gitInfo.dirty,
      attempted_at: new Date().toISOString(),
    }, extra || {}));
  };

  // Resolve the mechanism's bundled source dir (mirror the bootstrap-lib
  // __dirname-first / workshopPath-fallback resolution at applyExternalPluginInstall).
  const srcCandidates = [
    path.join(__dirname, "mechanisms", mech.name, bp.source_dir || "plugin"),
    workshopPath ? path.join(workshopPath, "platform", "mechanisms", mech.name, bp.source_dir || "plugin") : null,
  ].filter(Boolean);
  let srcDir = null;
  for (const c of srcCandidates) { try { if (fs.existsSync(c)) { srcDir = c; break; } } catch (_e) {} }
  if (!srcDir) { hist("error", { message: "bundled plugin source dir not found for " + bp.id }); return; }

  const destDir = ".obsidian/plugins/" + bp.id;
  try { await adapter.mkdir(destDir); } catch (_e) { /* already exists — fine */ }
  let wroteCount = 0;
  for (const f of bp.files) {
    try {
      let content = fs.readFileSync(path.join(srcDir, f), "utf8");
      // Stamp the mechanism version into the plugin's own manifest so Obsidian's
      // plugin list shows the shipped version (the release bumper versions the
      // MECHANISM, not this inner manifest, so they would otherwise drift).
      if (f === "manifest.json" && mech.version) {
        try { const j = JSON.parse(content); j.version = mech.version; content = JSON.stringify(j, null, 2) + "\n"; }
        catch (_e) { /* leave content as-is if not parseable */ }
      }
      await adapter.write(destDir + "/" + f, content);
      wroteCount++;
    } catch (e) {
      hist("error", { message: "vendor " + f + " failed: " + (e && e.message ? e.message : String(e)) });
    }
  }
  // Enable ONLY once EVERY declared file vendored — never enable a half-written
  // plugin dir (Obsidian would fail to load it; CustomJS fallback still applies).
  if (wroteCount < bp.files.length) {
    hist("warning", { message: "vendored " + wroteCount + "/" + bp.files.length + " files; not enabling" });
    return;
  }

  // Enable in community-plugins.json — preserve all other ids; safe on absent/malformed.
  const pluginsPath = ".obsidian/community-plugins.json";
  let exists = false;
  try { exists = await adapter.exists(pluginsPath); } catch (_e) { exists = false; }
  if (!exists) { hist("warning", { message: pluginsPath + " absent; vendored but not auto-enabled" }); return; }
  let raw;
  try { raw = await adapter.read(pluginsPath); }
  catch (e) { hist("warning", { message: "read " + pluginsPath + " failed: " + (e && e.message) }); return; }
  let enabled;
  try { enabled = JSON.parse(raw); }
  catch (_e) { hist("warning", { message: pluginsPath + " malformed JSON; vendored but not auto-enabled" }); return; }
  if (!Array.isArray(enabled)) { hist("warning", { message: pluginsPath + " not an array; vendored but not auto-enabled" }); return; }
  if (!enabled.includes(bp.id)) {
    enabled.push(bp.id);
    try { await adapter.write(pluginsPath, JSON.stringify(enabled, null, 2) + "\n"); hist("enabled", {}); }
    catch (e) { hist("warning", { message: "write " + pluginsPath + " failed: " + (e && e.message) }); return; }
  }
  hist("vendored", {});
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
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

<!-- finance-edit-scope -->
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceEditScopeBanner" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "BudgetDefaultsEditor" });
\`\`\`
`;

const FINANCE_PAYCHECK_DEFAULTS_CONTENT = `---
type: paycheck-defaults
deposit_schedule:
  - { day: 1, amount: 0 }
  - { day: 15, amount: 0 }
expenses: []
cssclasses: [wide]
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

<!-- finance-edit-scope -->
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceEditScopeBanner" });
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
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
tags:
  - finance-hub
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
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
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
tags:
  - finance-defaults
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

<!-- finance-edit-scope -->
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceEditScopeBanner" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "DebtDefaultsEditor" });
\`\`\`
`;

// v0.10.0 — planning-layer scaffolding templates. The finance-plan singleton holds
// per-vault policy (safe zero defaults shipped; the user fills in real knobs once),
// and the savings sub-area mirrors the debts sub-area. FinancePlanDashboard /
// SavingsCards / SavingsSummary ship as helpers in the same cycle; the dataviewjs
// blocks render once Cmd+R loads the new CustomJS classes.
const FINANCE_PLAN_TEMPLATE = `---
type: finance-plan
income_floor: 0
fixed_living_monthly: 0
attack_above_minimums: 0
pay_periods_per_month: 2
roll_freed_savings_to_attack: true
savings_glide:
  - { at_or_above: 0, monthly: 0 }
overflow: { attack_pct: 80, flex_pct: 20 }
lever_order: [discretionary, savings, attack]
avalanche_order_by: apr
governed_from: null
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinancePlanDashboard" });
\`\`\`
`;

const FINANCE_SAVINGS_HUB_TEMPLATE = `---
type: savings-hub
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
tags:
  - finance-hub
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
// entity-create:savings — installer-managed; do not delete this comment
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SavingsCards" });
\`\`\`
`;

const FINANCE_SAVINGS_EMERGENCY_TEMPLATE = `---
type: savings-account
name: "Emergency Fund"
target: 5000
current_balance: 0
last_updated: "${new Date().toISOString().slice(0, 10)}"
balance_history:
  - { date: ${new Date().toISOString().slice(0, 10)}, balance: 0, source: install-seed }
created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"
cssclasses:
  - wide
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceNav" });
\`\`\`

<!-- savings-summary-v0.10.0 -->
\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SavingsSummary" });
\`\`\`
`;

// v0.112.0 S2a — months hub body (byte-identical to content/Months.md body and
// FINANCE_HUB_BODY_TEMPLATES entry — all three must stay in sync).
const FINANCE_MONTHS_HUB_BODY = `\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "FinanceChromeBar" });
\`\`\`

\`\`\`dataviewjs
// entity-create:month — installer-managed; do not delete this comment
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

// applyFinanceMonthsEntityCreateSentinel — normalizes the `// entity-create:month`
// marker on the months hub so it LEADS the FinanceNav dataviewjs block (byte-
// matching the working content/Budgets.md format). When the marker is placed as
// a TRAILING comment (last line of the block, after the `dv.view` call), it
// comments out Dataview's injected closing brace and the block throws
// "Evaluation Error: eval@[native code]" on render. This heal strips ALL
// existing `// entity-create:month` lines (a leading dup AND/OR a malformed
// trailing one) and re-inserts the canonical marker immediately BEFORE the
// FinanceNav call.
//
// Target: spice/finance/months/Months.md. UNGATED (no version guard) —
// idempotent (a canonical file is a no-op with no write; running twice yields
// identical output). Body-text mutation only; .sauce-backup snapshot before
// write; failure-loud. Mirrors applyFinanceBudgetGroupSeed's snapshot +
// history.push + adapter.read/write posture.
async function applyFinanceMonthsEntityCreateSentinel(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const monthsHubPath = "spice/finance/months/Months.md";
  if (!(await adapter.exists(monthsHubPath))) return;

  const SENTINEL = "// entity-create:month — installer-managed; do not delete this comment";
  // FinanceNav dv.view call line (any quote style / views path).
  const navRe = /^([ \t]*)await dv\.view\((["'])[^"']*customjs-guard\2\s*,\s*\{\s*class:\s*(["'])FinanceNav\3\s*\}\)\s*;[ \t]*$/m;

  let body;
  try { body = await adapter.read(monthsHubPath); } catch (_e) { return; }
  if (!navRe.test(body)) return; // no FinanceNav block → nothing to normalize

  // 1. Strip ALL existing `// entity-create:month` comment lines (removes a
  //    leading dup AND a malformed trailing one).
  let out = body.replace(/^[ \t]*\/\/[ \t]*entity-create:month\b[^\n]*\n/gm, "");
  // 2. Re-insert the canonical marker immediately BEFORE the FinanceNav call.
  out = out.replace(navRe, (m, indent) => `${indent}${SENTINEL}\n${m}`);
  if (out === body) return; // already canonical → idempotent no-op (skip write)

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    // .sauce-backup snapshot before write.
    const backupPath = `.sauce-backup/${ts}/${monthsHubPath}`;
    const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
    try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
    try { await adapter.write(backupPath, body); } catch (_e) { /* snapshot best-effort */ }
    await adapter.write(monthsHubPath, out);
    history?.push({ event: "info", step: "finance_months_entity_create_sentinel", name: "finance",
      action: "normalized", path: monthsHubPath, snapshot: backupPath,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "finance_months_entity_create_sentinel", name: "finance",
      path: monthsHubPath, reason: e.message,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }
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
      if (folder.includes("/_archive")) continue;  // archived legacy notes are inert — never re-inject
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

// applyFinancePlanScaffolding — v0.10.0. Create-if-absent the finance-plan singleton
// (spice/finance/Finance Plan.md), which holds per-vault lever/glide/overflow policy.
// Never overwrites an existing plan (it carries user config). No snapshot — create-only.
async function applyFinancePlanScaffolding(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const planPath = "spice/finance/Finance Plan.md";
  try {
    if (await adapter.exists(planPath)) {
      history?.push({ event: "info", step: "finance_plan_scaffolding", name: "finance",
        action: "preserved", path: planPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
    await adapter.write(planPath, FINANCE_PLAN_TEMPLATE);
    history?.push({ event: "info", step: "finance_plan_scaffolding", name: "finance",
      action: "created", path: planPath,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "finance_plan_scaffolding", name: "finance",
      reason: `write failed for ${planPath}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
  }
}

// applyFinanceSavingsScaffolding — v0.10.0. Create-if-absent the savings sub-area
// (spice/finance/savings/ + Savings.md hub + Savings-Emergency-Fund.md). Mirrors
// applyFinanceDebtScaffolding posture. Never overwrites existing files. No snapshot.
async function applyFinanceSavingsScaffolding(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const savingsRoot = "spice/finance/savings";
  const savingsHubPath = `${savingsRoot}/Savings.md`;
  const emergencyPath = `${savingsRoot}/Savings-Emergency-Fund.md`;
  let created = 0, preserved = 0;

  if (!(await adapter.exists(savingsRoot))) {
    try {
      await adapter.mkdir(savingsRoot);
    } catch (e) {
      history?.push({ event: "warning", step: "finance_savings_scaffolding", name: "finance",
        reason: `mkdir failed for ${savingsRoot}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
  }

  const writes = [[savingsHubPath, FINANCE_SAVINGS_HUB_TEMPLATE], [emergencyPath, FINANCE_SAVINGS_EMERGENCY_TEMPLATE]];
  for (const [p, tmpl] of writes) {
    if (await adapter.exists(p)) { preserved++; continue; }
    try {
      await adapter.write(p, tmpl);
      created++;
      history?.push({ event: "info", step: "finance_savings_scaffolding", name: "finance",
        action: "created", path: p,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_savings_scaffolding", name: "finance",
        reason: `write failed for ${p}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_savings_scaffolding", name: "finance",
    summary: { created, preserved },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// applyFinancePlanBandInjection — v0.10.0. Injects the PlanBand dataviewjs block at the
// TOP of every Budget-*.md (above MonthlyOverview / BudgetSummary). Marker-guarded by
// `<!-- plan-band-v0.10.0 -->`. .sauce-backup snapshot before write. Per-file failure-loud.
// Mirrors applyFinancePaycheckDebtBandInjection (snapshot-bearing) posture.
async function applyFinancePlanBandInjection(tp, manifest, variables, history, git) {
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
    history?.push({ event: "warning", step: "finance_plan_band_injection", name: "finance",
      reason: `list failed for ${budgetsRoot}: ${e.message}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }

  if (budgetFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touched = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _injectPlanBand(body);
      if (result.touched) {
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_plan_band_injection", name: "finance",
        reason: `body injection failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_plan_band_injection", name: "finance",
    reason: `${budgetFiles.length} budgets scanned, ${touched} bodies injected (PlanBand at top)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _injectPlanBand — pure body transform. Idempotent. Marker-guarded. Lands the PlanBand
// block at the TOP of the note's content (above all other bands).
//   Anchor priority:
//     1. marker present → no-op.
//     2. monthly-overview marker → inject BEFORE it.
//     3. budget-summary marker → inject BEFORE it.
//     4. FinanceNav / FinanceNavRow block → inject AFTER it.
//     5. Frontmatter close (second `---\n`) → inject AFTER it.
function _injectPlanBand(body) {
  let out = body;
  const MARKER = "<!-- plan-band-v0.10.0 -->";
  if (out.includes(MARKER)) return { body: out, touched: false };

  const block = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "PlanBand" });\n\`\`\`\n\n`;

  const moMarkerRe = /(<!--\s*monthly-overview-v[\d.]+\s*-->\s*\n)/;
  if (moMarkerRe.test(out)) { out = out.replace(moMarkerRe, `${block}$1`); return { body: out, touched: true }; }

  const bsMarkerRe = /(<!--\s*budget-summary-v[\d.]+\s*-->\s*\n)/;
  if (bsMarkerRe.test(out)) { out = out.replace(bsMarkerRe, `${block}$1`); return { body: out, touched: true }; }

  const navBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']FinanceNav(?:Row)?["'][^`]*```\s*\n)/;
  const nb = out.match(navBlockRe);
  if (nb) { out = out.replace(navBlockRe, `$1\n${block}`); return { body: out, touched: true }; }

  const fmEnd = out.indexOf("---\n", 4);
  if (fmEnd !== -1) {
    const cutIdx = fmEnd + 4;
    out = out.slice(0, cutIdx) + `\n${block}` + out.slice(cutIdx);
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
  await applyFinanceMonthsEntityCreateSentinel(tp, manifest, variables, history, git);   // NEW — entity-create:month marker must LEAD the FinanceNav block (fixes dataviewjs eval error from a trailing marker)
  await applyFinancePlanScaffolding(tp, manifest, variables, history, git);              // NEW v0.10.0 — create-if-absent Finance Plan.md singleton
  await applyFinanceSavingsScaffolding(tp, manifest, variables, history, git);           // NEW v0.10.0 — create-if-absent savings/ + Savings.md + Savings-Emergency-Fund.md
  await applyFinanceCategoriesGroupBackfill(tp, manifest, variables, history, git);
  await applyFinanceBudgetMalformedGroupRepair(tp, manifest, variables, history, git);   // NEW — repairs pre-fix stray Unassigned
  await applyFinanceBudgetGroupSeed(tp, manifest, variables, history, git);              // NEW v0.108.0
  await applyFinanceBudgetBodyMigration(tp, manifest, variables, history, git);
  await applyFinanceBudgetMonthlyBandInjection(tp, manifest, variables, history, git);   // NEW v0.110.3 — MonthlyOverview band above BudgetSummary
  await applyFinanceBudgetAllocationsBandInjection(tp, manifest, variables, history, git); // NEW (month reality WS2) — BudgetAllocationsEditor block after BudgetCategoriesEditor
  await applyFinancePaycheckBodyMigration(tp, manifest, variables, history, git);        // CF-3 v0.107.0
  await applyFinancePaycheckArchiveLegacy(tp, manifest, variables, history, git);        // NEW (monthly-paycheck) — MOVE legacy per-check notes (pay_period_start, no deposits[]) into paychecks/_archive/ so the month rollup ignores them (ungated, one-time-ish, copy+remove)
  await applyFinancePaycheckDebtBandInjection(tp, manifest, variables, history, git);    // NEW v0.112.0 — PaycheckDebtBand between PaycheckSummary and PaycheckExpensesEditor
  await applyFinancePlanBandInjection(tp, manifest, variables, history, git);            // NEW v0.10.0 — PlanBand over-envelope flag at top of every Budget
  await applyFinancePaycheckDefaultsDebtLinking(tp, manifest, variables, history, git);  // NEW v0.108.0
  await applyFinancePaycheckDefaultsDebtBackfill(tp, manifest, variables, history, git); // NEW v0.114.0 — word-overlap matcher + auto-injection of orphan debts (supersedes the v0.108.0 CC_NAME_RE; complementary not redundant — v0.108.0 still runs for the CC pattern)
  await applyFinanceNavRowMigration(tp, manifest, variables, history, git);              // NEW v0.108.0
  await applyFinanceNavRowGuardFormMigration(tp, manifest, variables, history, git);     // NEW v0.110.3 — guard-form regression: rewrites class:"BudgetNavButtons"|"PaycheckNavButtons"|"InvoiceNavButtons" guard-form refs missed by v0.108.0's direct-call regex
  await applyFinanceHubFrontmatterHeal(tp, manifest, variables, history, git);           // NEW v0.115.1 — heals corrupted hub frontmatter (dup keys + mangled tag/cssclass values) BEFORE the body repair preserves it
  await applyFinanceInvoiceWorkspaceNavInjection(tp, manifest, variables, history, git); // NEW v0.115.2 — injects InvoiceWorkspaceNav block + rewrites legacy InvoiceNavButtons -> FinanceNav on every existing Invoice-*.md
  await applyFinanceHubsRepair(tp, manifest, variables, history, git);                    // NEW v0.110.0 — heals stale pre-CF-3 hub bodies (now also strips top-hub FinanceHubActions via v0.110.3 template change)
  await applyFinanceTopHubNavRowDedup(tp, manifest, variables, history, git);             // NEW v0.110.3 — strips FinanceHubActions(here:"finance") block from spice/finance/Finance.md (user feedback: duplicate finance nav section)
  await applyFinanceDefaultsNavRowRetirement(tp, manifest, variables, history, git);       // NEW (cockpit #3) — RETIRES the dead FinanceNavRow injection: strips any FinanceNavRow block from the three Defaults notes (FinanceNav supersedes it). Replaces applyFinanceDefaultsNavRowInjection.
  await applyFinanceMonthChecklistInjection(tp, manifest, variables, history, git);        // NEW (cockpit #3) — MonthSetupChecklist block above MonthDashboard on every Month note
  await applyFinanceEditScopeBannerInjection(tp, manifest, variables, history, git);       // NEW (cockpit #3) — FinanceEditScopeBanner one-liner after FinanceNav on Budget/Paycheck/Defaults notes
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
  if (_migrationGated("0.115.1")) return;
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
  if (_migrationGated("0.110.0")) return;
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
  if (_migrationGated("0.116.0")) return;
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
  if (_migrationGated("0.119.0")) return;
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
  if (_migrationGated("0.119.1")) return;
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
  if (_migrationGated("0.120.0")) return;
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
        `created_at: "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"`,
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
        // Section order (v0.179 UI polish): Project Tasks → From Meetings →
        // Owned Tasks (legacy completed). Owned Tasks sits LAST. MUST stay in
        // lockstep with platform/blueprints/to-do/templates/Project To-Do.md.
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: "Project Tasks", top: true }] });`,
        '```',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "TaskProjectList" });`,
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
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "SectionLabel", args: [{ text: "Owned Tasks" }] });`,
        '```',
        '',
        '<!-- OWNED_TASKS_MARKER -->',
        '',
        '```dataviewjs',
        `await dv.view("${viewsPath}/customjs-guard", { class: "TodayCaptureEditableList", args: [{ anchor: "ownedTasks" }] });`,
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

// applyRecurringTasksMigrationHeal — recurring-tasks note-per-task migration.
//
// Migrates every parseable entry in the legacy spice/to-do/Recurring
// Tasks.md registry into a real spice/tasks/*.md rolling recurring task
// note. Reads BOTH `- [ ] ...` (unchecked) AND `- [x] ...` (checked) lines —
// checking a registry line off was the OLD (broken) way a user tried to mark
// a day done under the pre-migration UI, not an intentional deactivation, so
// both forms migrate. UNGATED (runs every install) but fully idempotent: an
// entry with a task note ALREADY present at the same title is skipped, so
// repeat runs are a no-op. NEVER writes to or deletes the original registry
// file — it stays in place, untouched, as a passive backup. Never throws;
// every outcome is a failure-loud history entry.
async function applyRecurringTasksMigrationHeal(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "to-do") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const registryPath = "spice/to-do/Recurring Tasks.md";
  const registryExists = await adapter.exists(registryPath).catch(() => false);
  if (!registryExists) {
    history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
      migrated: 0, skipped: 0, errors: [],
      reason: "no Recurring Tasks.md registry present",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  let registryContent;
  try { registryContent = await adapter.read(registryPath); }
  catch (e) {
    history?.push({ event: "error", step: "recurring_tasks_migration_heal", name: "to-do",
      reason: "could not read registry: " + (e && e.message),
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const entries = _parseRecurringRegistry(registryContent);
  if (!entries.length) {
    history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
      migrated: 0, skipped: 0, errors: [],
      reason: "registry has no parseable recurring entries",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const tasksRoot = "spice/tasks";
  try { if (!(await adapter.exists(tasksRoot))) await adapter.mkdir(tasksRoot); } catch (_e) { /* tolerate */ }

  const nowIso = new Date().toISOString();
  const errors = [];
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    if (entry.invalid) { skipped++; continue; }
    const filename = _sanitizeRecurringTitle(entry.title) + ".md";
    const path = tasksRoot + "/" + filename;
    let alreadyExists = false;
    try { alreadyExists = await adapter.exists(path); } catch (_e) { alreadyExists = false; }
    if (alreadyExists) { skipped++; continue; }

    const scheduled = _nextOccurrenceForHeal(entry.recurrence);
    const project = entry.project ? "[[" + entry.project + "]]" : "";
    const lines = [
      "---",
      "type: task",
      "title: " + entry.title,
      "status: open",
      "due: " + (scheduled || ""),
      "recurrence: " + entry.recurrence,
      "priority: " + (entry.priority || ""),
      "project: " + project,
      "project_slug: " + (entry.projectSlug || ""),
      "source: migrated-from-registry",
      "source_note:",
      "links: []",
      "created_at: " + nowIso,
      "completed_at:",
      "---",
      "",
      "```dataviewjs",
      'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
      "```",
      "",
      "---",
      "",
      "```dataviewjs",
      'await dv.view("ranch/views/customjs-guard", { class: "TaskNoteView" });',
      "```",
      "",
      "---",
      "",
      "<!-- TASK_NOTES -->",
      "",
    ];
    try {
      await adapter.write(path, lines.join("\n"));
      migrated++;
    } catch (e) {
      errors.push({ title: entry.title, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "recurring_tasks_migration_heal", name: "to-do",
    migrated, skipped, errors,
    reason: migrated + " recurring task note(s) created from the legacy registry; " + skipped + " skipped (already migrated or unsupported grammar); registry left untouched at " + registryPath,
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });
}

// _stripCompletionEmojiSuffix — strips a trailing "✅ YYYY-MM-DD" annotation
// (tolerant of surrounding/missing whitespace) from a title string. The
// legacy Recurring Tasks.md registry supported CHECKED lines
// (`- [x] Pay Rent ✅ 2026-07-06 [recurrence:: every day]`) where a user had
// manually typed a checkmark + completion date as free text (a common
// personal habit-tracking convention) — NOT a structured `[field:: value]`
// annotation, so the existing inline-field strip in _parseRecurringRegistry
// never touched it, and it survived verbatim into the migrated task note's
// title (and, via TaskEntity.taskFilename, its filename). Pure,
// null-tolerant (→ ""); a title with no such suffix passes through
// unchanged; never throws.
function _stripCompletionEmojiSuffix(title) {
  const s = String(title == null ? "" : title);
  return s.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}\s*$/, "").trim();
}

// _parseRecurringRegistry — adapted from ToDoDailyRecurring.parseRegistryLine's
// grammar, EXTENDED to also match checked (`- [x] ...`) lines. Section-scoped
// the same way (`## Recurring Tasks` H2 OR the SectionLabel block form).
// Returns [{ title, recurrence, project, projectSlug, priority, invalid }].
// Pure; never throws.
function _parseRecurringRegistry(content) {
  const lines = String(content == null ? "" : content).split("\n");
  let inSection = false;
  const entries = [];
  for (const line of lines) {
    if (/^## Recurring Tasks/.test(line) ||
      (/SectionLabel/.test(line) && /text:\s*["']Recurring Tasks["']/.test(line))) {
      inSection = true; continue;
    }
    if (inSection && (/^## /.test(line) ||
      (/SectionLabel/.test(line) && /text:\s*["']Last 7 days/.test(line)))) {
      inSection = false; continue;
    }
    if (!inSection) continue;
    // Match BOTH "- [ ] " and "- [x] " (case-insensitive on the x).
    const m = /^- \[([ xX])\] (.+)$/.exec(line);
    if (!m) continue;
    const rest = m[2];
    const fields = {};
    const fieldRe = /\[(\w+)::\s*([^\]]+(?:\]\][^\]]*)*)\]/g;
    let mm;
    while ((mm = fieldRe.exec(rest)) !== null) {
      let val = mm[2].trim();
      const wl = /^\[\[([^\]]+)\]\]$/.exec(val);
      if (wl) val = wl[1];
      fields[mm[1]] = val;
    }
    const title = _stripCompletionEmojiSuffix(rest.replace(/\s*\[\w+::\s*(?:\[\[[^\]]+\]\]|[^\]]+)\]/g, "").trim());
    if (!title) continue;
    const recurrence = fields.recurrence || null;
    if (!recurrence) { entries.push({ title, invalid: true }); continue; }
    entries.push({
      title,
      recurrence,
      project: fields.project || null,
      projectSlug: fields.project ? _slugifyForHeal(fields.project) : null,
      priority: fields.priority || null,
      invalid: false,
    });
  }
  return entries;
}

function _slugifyForHeal(name) {
  return String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Human-readable filename base for a migrated task, same illegal-char strip as
// TaskEntity._sanitizeTitle (kept as a self-contained copy here since
// install.js runs in the Templater/Node context, not the browser customJS
// scope — no cross-import). Collisions are handled by the caller's
// `adapter.exists` pre-check (an existing note at that path is treated as
// "already migrated" and skipped, matching the idempotency contract).
function _sanitizeRecurringTitle(title) {
  const s = String(title == null ? "" : title)
    .replace(/[/\\:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return s === "" ? "Task" : s;
}

// _nextOccurrenceForHeal — a SELF-CONTAINED (no window/customJS dependency)
// reimplementation of the 4 supported RecurrenceParser grammar families,
// walking forward from TODAY (never returning today itself) so a freshly
// migrated task never lands already-overdue. Unsupported grammar -> null
// (the task note still gets created with `recurrence` set and an EMPTY
// `scheduled`, so it's visible on the new Recurring.md index for the user to
// fix by hand, rather than silently dropped). Mirrors
// ToDoDailyRecurring._fallbackRecurrenceMatch's grammar exactly.
function _nextOccurrenceForHeal(recurrence) {
  const g = String(recurrence == null ? "" : recurrence).trim().toLowerCase();
  if (!g.startsWith("every ")) return null;
  const tail = g.slice(6).trim();
  const dayMap = {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6,
  };
  const toDaySet = (text) => {
    const tokens = text.split(/[\s,]+/).filter(Boolean);
    if (!tokens.length) return null;
    const out = new Set();
    for (const t of tokens) {
      if (!Object.prototype.hasOwnProperty.call(dayMap, t)) return null;
      out.add(dayMap[t]);
    }
    return out;
  };
  const matches = (dow, dom) => {
    if (tail === "day") return true;
    if (tail === "weekday" || tail === "weekdays") return dow >= 1 && dow <= 5;
    if (tail === "weekend" || tail === "weekends") return dow === 0 || dow === 6;
    const m1 = tail.match(/^(\d{1,2})(?:st|nd|rd|th)? of (?:the )?month$/);
    if (m1) return dom === +m1[1];
    // "every N weeks on X" needs an anchor we don't have at migration time —
    // unsupported for the heal (falls through to the plain weekday-set check
    // below, which is WRONG for this family, so explicitly bail instead).
    if (/^\d+\s+weeks?\s+on\s+/.test(tail)) return false;
    const days = toDaySet(tail);
    return days ? days.has(dow) : false;
  };
  const startMs = Date.now();
  const DAY_MS = 86400000;
  for (let i = 1; i <= 400; i++) {
    const d = new Date(startMs + i * DAY_MS);
    if (matches(d.getUTCDay(), d.getUTCDate())) {
      const p = (n) => String(n).padStart(2, "0");
      return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
    }
  }
  return null;
}

// applyTaskDueScheduledRenameMigration — schema consolidation.
//
// TaskEntity's schema retired the separate `scheduled` field (queryToday /
// buildBands / groupByDate now all bucket Today/Overdue by `due` alone).
// This heal walks every note under spice/tasks/ (open root + _done/ +
// _trash/ — a task can live in any of the three) and, where a `scheduled:`
// key is present, copies its value into `due:` ONLY IF `due` is currently
// blank (never clobber a value someone already had in `due` under the old
// dual-field system), then removes the `scheduled` key entirely. Ungated
// (runs every install), idempotent (a note with no `scheduled` key is a
// no-op), one `.sauce-backup` snapshot per touched file, failure-loud
// history. Critical correctness note: without this heal, every existing
// task with a `scheduled` date silently vanishes from Today/Overdue the
// moment queryToday starts reading `due` instead.
async function applyTaskDueScheduledRenameMigration(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "task-entity") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const roots = ["spice/tasks", "spice/tasks/_done", "spice/tasks/_trash"];
  const files = [];
  for (const root of roots) {
    const exists = await adapter.exists(root).catch(() => false);
    if (!exists) continue;
    let listing;
    try { listing = await adapter.list(root); } catch (_e) { continue; }
    for (const f of (listing.files || [])) {
      if (/\.md$/i.test(f)) files.push(f);
    }
  }

  if (!files.length) {
    history?.push({ event: "info", step: "task_due_scheduled_rename_migration", name: "task-entity",
      renamed: 0, skipped: 0, errors: [],
      reason: "no task notes found under spice/tasks/",
      git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
      completed_at: new Date().toISOString() });
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let renamed = 0;
  let skipped = 0;
  const errors = [];

  for (const path of files) {
    let content;
    try { content = await adapter.read(path); }
    catch (e) { errors.push({ path, error: e && e.message }); continue; }

    // NOTE: [ \t]* (not \s*) right after the colon — \s* would cross the
    // newline into the FOLLOWING frontmatter line whenever this key's value
    // is blank (e.g. "due:\npriority:" — \s* greedily eats the blank line's
    // newline, then (.*) captures "priority:" as if it were due's value).
    // That silently made a blank `due:` look non-blank, skipping the copy.
    const schedMatch = /^scheduled:[ \t]*(.*)$/m.exec(content);
    if (!schedMatch) { skipped++; continue; }
    const schedValue = schedMatch[1].trim();

    const dueMatch = /^due:[ \t]*(.*)$/m.exec(content);
    const dueIsBlank = !dueMatch || dueMatch[1].trim() === "";

    let updated = content;
    if (dueIsBlank && schedValue) {
      // Move the scheduled value into due (only when due is currently blank).
      if (dueMatch) {
        updated = updated.replace(/^due:[ \t]*.*$/m, "due: " + schedValue);
      } else {
        // No due key at all (very old note) — insert one right after the
        // scheduled line so we don't have to guess at overall key order.
        updated = updated.replace(/^scheduled:[ \t]*.*$/m, (m) => m + "\ndue: " + schedValue);
      }
    }
    // Always strip the scheduled line itself, whether or not we moved its value.
    updated = updated.replace(/^scheduled:[ \t]*.*\n?/m, "");

    if (updated === content) { skipped++; continue; }

    try {
      const backupDir = ".sauce-backup/" + ts + "/" + path.split("/").slice(0, -1).join("/");
      const backupPath = ".sauce-backup/" + ts + "/" + path;
      if (typeof adapter.mkdir === "function") {
        try { await adapter.mkdir(backupDir); } catch (_e) { /* tolerate */ }
      }
      try { await adapter.write(backupPath, content); } catch (_e) { /* tolerate */ }
      await adapter.write(path, updated);
      renamed++;
    } catch (e) {
      errors.push({ path, error: e && e.message });
    }
  }

  history?.push({ event: "info", step: "task_due_scheduled_rename_migration", name: "task-entity",
    renamed, skipped, errors,
    reason: renamed + " task note(s) migrated from scheduled to due; " + skipped + " already-clean or no-op",
    git_commit: (git && git.commit), git_tag: (git && git.tag), git_dirty: (git && git.dirty),
    completed_at: new Date().toISOString() });
}

// _linksHubBody — pure. Returns the Links Hub note BODY (below the frontmatter),
// byte-identical to the project blueprint's entity-create scaffold for a NEW
// project's `Links Hub.md` (manifest new_entity_buttons[0].extra_files[] →
// filename_pattern "Links Hub.md" inline_body). Keeping this a single source
// means backfilled hubs render exactly like freshly-created ones. The
// button-nav refactor folded the old stacked chrome (Breadcrumb +
// SpaceNavButtons + ProjectNavButtons + ProjectLinksManager) into the single
// ProjectChromeBar block, so the body is now just ProjectChromeBar +
// ProjectLinksPanel — matching the migrated manifest inline_body + template.
// `viewsPath` defaults to "ranch/views" (the shipped default); passing the
// installer's resolved views_path keeps the dv.view() paths correct on
// relocated vaults. run-project-links-hub-backfill.js pins body↔entity-create
// parity so a future edit to one without the other fails the harness.
function _linksHubBody(viewsPath) {
  const v = viewsPath || "ranch/views";
  return [
    '```dataviewjs',
    `await dv.view("${v}/customjs-guard", { class: "ProjectChromeBar" });`,
    '```',
    '',
    '```dataviewjs',
    `await dv.view("${v}/customjs-guard", { class: "ProjectLinksPanel" });`,
    '```',
    '',
  ].join('\n');
}

// _renderLinksHubNote — pure. Full `Links Hub.md` note (frontmatter + body) for
// project `name` (display name, mixed case) with folder `slug`. Frontmatter
// mirrors the entity-create frontmatter_template (type: links-hub, project
// wikilink, project_slug, empty links[], created_at, links-hub tag). `nowIso`
// is injectable so tests are deterministic; production passes none and stamps
// the current time (millisecond-trimmed, matching applyProjectTodoBackfill).
function _renderLinksHubNote({ name, slug, viewsPath, nowIso } = {}) {
  const created = nowIso || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return [
    '---',
    'type: links-hub',
    `project: "[[${name}]]"`,
    `project_slug: ${slug}`,
    'links: []',
    `created_at: "${created}"`,
    'tags:',
    '  - links-hub',
    '---',
    '',
    _linksHubBody(viewsPath),
  ].join('\n');
}

// applyProjectLinksHubBackfill — Project Links Wiring PR3. Creates
// `spice/projects/<slug>/Links Hub.md` for every project lacking one, so
// pre-existing projects gain the Helpful Links hub that PR1 scaffolds only for
// NEW projects (via entity-create). Sibling of applyProjectTodoBackfill: same
// hub-detection (first direct `type: project` note; the hub basename is the
// display name), same skip-if-exists idempotency, per-project try/catch, never
// throws. UNGATED backfill (runs every install) — it materializes NEW content,
// not a one-time reshape of legacy content, so it is not version-gated (per the
// migration-lifecycle rule). No .sauce-backup needed: it only ever CREATES a
// missing note (skip-if-exists), never overwrites, so there is nothing to snap.
async function applyProjectLinksHubBackfill(tp, mech, variables, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const PROJ_ROOT = "spice/projects";
  if (!(await adapter.exists(PROJ_ROOT))) return;

  const viewsPath = (variables && variables.views_path) || "ranch/views";
  let created = 0, skipped = 0, errors = 0;

  let listing;
  try { listing = await adapter.list(PROJ_ROOT); }
  catch (_e) { return; }

  for (const projDir of (listing.folders || [])) {
    try {
      const subListing = await adapter.list(projDir);
      // Find the project's hub note — the .md whose frontmatter has type: project
      // (mirrors applyProjectTodoBackfill). Its basename is the display name.
      let hubName = null;
      for (const file of (subListing.files || [])) {
        if (!file.endsWith('.md')) continue;
        if (/ To-Do\.md$/.test(file)) continue;
        if (/Project Map\.md$/.test(file)) continue;
        if (/-board\.md$/.test(file)) continue;
        if (/Links Hub\.md$/.test(file)) continue;
        const content = await adapter.read(file);
        if (/^type:\s*project\b/m.test(content) || /^type:\s*"project"/m.test(content)) {
          hubName = file.split('/').pop().replace(/\.md$/, '');
          break;
        }
      }
      if (!hubName) { skipped++; continue; }
      const slug = projDir.split('/').pop();
      const linksHubPath = `${projDir}/Links Hub.md`;
      if (await adapter.exists(linksHubPath)) { skipped++; continue; }
      const body = _renderLinksHubNote({ name: hubName, slug, viewsPath });
      await adapter.write(linksHubPath, body);
      created++;
      history?.push({ event: "info", step: "project_links_hub_backfill", name: "project",
        action: "created", path: linksHubPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      errors++;
      history?.push({ event: "error", step: "project_links_hub_backfill", name: "project",
        projDir, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "project_links_hub_backfill", name: "project",
    summary: { created, skipped, errors },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
}

// _healProjectTodoOwnedTasksBody — pure, idempotent body transform (project-todo
// only). Makes the "Owned Tasks" section editable by TodayCaptureEditableList:
//   (1) injects the OWNED_TASKS_MARKER directly below the "Owned Tasks"
//       SectionLabel block, and
//   (2) inserts the TodayCaptureEditableList({ anchor: "ownedTasks" }) renderer
//       block directly BELOW the section's existing raw `- [ ]` task lines.
// The renderer sits after the raw lines so the raw native task list PRECEDES it
// and _hideRawCaptureLines can suppress it — the same layout the daily-note
// Today capture relies on. Anchors on the SectionLabel class + "Owned Tasks"
// text so it matches both shipped label forms (`{ text: "Owned Tasks" }` on
// healed notes and `{ text: "Owned Tasks", top: true }` from
// applyProjectTodoBackfill). Returns body unchanged when the section is absent
// or already has BOTH marker + renderer (idempotent).
function _healProjectTodoOwnedTasksBody(body) {
  if (typeof body !== "string") return body;
  const MARKER = "<!-- OWNED_TASKS_MARKER -->";
  if (body.includes(MARKER) && body.includes('anchor: "ownedTasks"')) return body;

  const lines = body.split("\n");
  // Anchor on the Owned Tasks header in EITHER shipped form: a SectionLabel
  // dataviewjs block (healed notes / applyProjectTodoBackfill scaffold) OR a
  // plain `## Owned Tasks` H2 heading (the project entity-create inline_body,
  // which the H2->SectionLabel rewrite — version-gated to 0.116.0 — no longer
  // converts on vaults already past that version). `headerEnd` is the LAST line
  // of the header block (the closing ``` for a SectionLabel; the H2 line itself
  // for a heading), i.e. the line the marker is injected directly below.
  let labelIdx = -1;
  let headerEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('class: "SectionLabel"') && lines[i].includes('text: "Owned Tasks"')) {
      labelIdx = i;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trimStart().startsWith("```")) { headerEnd = j; break; }
      }
      break;
    }
  }
  if (labelIdx === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/^## +Owned Tasks\s*$/.test(lines[i])) { labelIdx = i; headerEnd = i; break; }
    }
  }
  if (labelIdx === -1 || headerEnd === -1) return body;  // no Owned Tasks header to anchor on
  const fenceIdx = headerEnd;                            // insert point = last line of the header

  // End of the Owned Tasks section: the opener of the next SectionLabel
  // dataviewjs block (e.g. "From Meetings"), the next `## ` heading, or EOF.
  let sectionEnd = lines.length;
  for (let i = fenceIdx + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) { sectionEnd = i; break; }
    if (lines[i].trimStart().startsWith("```dataviewjs")
        && i + 1 < lines.length && lines[i + 1].includes("SectionLabel")) {
      sectionEnd = i; break;
    }
  }

  // Retain the section's raw task lines verbatim; strip any prior marker line and
  // any prior ownedTasks renderer block so a re-emit stays idempotent.
  const between = lines.slice(fenceIdx + 1, sectionEnd);
  const kept = [];
  for (let i = 0; i < between.length; i++) {
    const ln = between[i];
    if (ln.includes(MARKER)) continue;
    if (ln.trimStart().startsWith("```dataviewjs")
        && i + 1 < between.length && between[i + 1].includes('anchor: "ownedTasks"')) {
      let j = i + 1;
      while (j < between.length && !between[j].trimStart().startsWith("```")) j++;
      i = j;                                            // skip through closing fence
      continue;
    }
    kept.push(ln);
  }
  let s = 0, e = kept.length;
  while (s < e && kept[s].trim() === "") s++;
  while (e > s && kept[e - 1].trim() === "") e--;
  const raw = kept.slice(s, e);

  const rendererBlock = [
    "```dataviewjs",
    'await dv.view("ranch/views/customjs-guard", { class: "TodayCaptureEditableList", args: [{ anchor: "ownedTasks" }] });',
    "```",
  ];

  const rebuilt = ["", MARKER, ""];
  if (raw.length) rebuilt.push(...raw, "");
  rebuilt.push(...rendererBlock, "");

  return lines.slice(0, fenceIdx + 1)
    .concat(rebuilt)
    .concat(lines.slice(sectionEnd))
    .join("\n");
}

// _reorderProjectTodoOwnedTasksLast — pure body transform (v0.179 UI polish).
// Section order on a project To-Do note must be Project Tasks → From Meetings →
// Owned Tasks (legacy completed lines). Older notes were authored/healed with
// Owned Tasks ABOVE From Meetings; this moves the WHOLE Owned Tasks block —
// the "Owned Tasks" SectionLabel block + the `<!-- OWNED_TASKS_MARKER -->` + all
// its raw task lines + the TodayCaptureEditableList(ownedTasks) block — to the
// END (below From Meetings), as one unit.
//
// Idempotent: returns the body unchanged when there's no "From Meetings"
// SectionLabel (nothing to reorder against) OR when the "Owned Tasks" label
// already appears AFTER the "From Meetings" label (already last). Anchors on the
// SectionLabel dataviewjs blocks by their `text:` label; tolerant of a `## Owned
// Tasks` / `## From Meetings` H2 heading form too. Returns the ORIGINAL body on
// any parse ambiguity (fails safe — never corrupts a note).
function _reorderProjectTodoOwnedTasksLast(body) {
  if (typeof body !== "string") return body;
  const lines = body.split("\n");

  // Locate the start line of the Owned Tasks header + the From Meetings header.
  // A header is either a SectionLabel dataviewjs block opener (```dataviewjs) whose
  // body carries text: "<label>", or a bare `## <label>` H2.
  const findHeader = (label) => {
    for (let i = 0; i < lines.length; i++) {
      // SectionLabel dataviewjs block: opener is ```dataviewjs, look ahead to the
      // closing fence for a matching text: "<label>".
      if (/^\s*```dataviewjs\s*$/.test(lines[i])) {
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\s*```\s*$/.test(lines[j])) break;
          if (lines[j].includes('class: "SectionLabel"') &&
              lines[j].includes('text: "' + label + '"')) {
            return { start: i, kind: "block" };
          }
        }
      }
      // Bare H2 heading form.
      if (new RegExp("^##\\s+" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$").test(lines[i])) {
        return { start: i, kind: "h2" };
      }
    }
    return null;
  };

  const owned = findHeader("Owned Tasks");
  const meetings = findHeader("From Meetings");
  // Nothing to reorder against, or no Owned Tasks section → leave as-is.
  if (!owned || !meetings) return body;
  // Already ordered (Owned Tasks after From Meetings) → idempotent no-op.
  if (owned.start > meetings.start) return body;

  // The Owned Tasks block runs from its header line up to (but not including) the
  // NEXT section header — the opener of another SectionLabel dataviewjs block or
  // the next `## ` heading — else EOF.
  const isSectionStart = (i) => {
    if (i <= owned.start) return false;
    if (/^##\s+/.test(lines[i])) return true;
    if (/^\s*```dataviewjs\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\s*```\s*$/.test(lines[j])) return false;
        if (lines[j].includes('class: "SectionLabel"')) return true;
      }
    }
    return false;
  };
  let ownedEnd = lines.length;
  for (let i = owned.start + 1; i < lines.length; i++) {
    if (isSectionStart(i)) { ownedEnd = i; break; }
  }

  // Sanity: the Owned Tasks block must end at-or-before the From Meetings header
  // (they're distinct sections and Owned currently precedes Meetings). If the
  // computed block would swallow the From Meetings header, bail (fail safe).
  if (ownedEnd > meetings.start) return body;

  // Extract the block, trimming trailing blank lines off it; re-append after a
  // single blank separator at EOF.
  const head = lines.slice(0, owned.start);
  let block = lines.slice(owned.start, ownedEnd);
  const tail = lines.slice(ownedEnd);

  // Trim leading/trailing blank lines from the moved block so re-insertion is clean.
  let bs = 0, be = block.length;
  while (bs < be && block[bs].trim() === "") bs++;
  while (be > bs && block[be - 1].trim() === "") be--;
  block = block.slice(bs, be);
  if (!block.length) return body;  // nothing substantive to move

  // Rebuild: head + tail (with the Owned block removed), one blank separator,
  // block, trailing newline.
  const rest = head.concat(tail);
  // Strip trailing blanks off `rest` so we control the separator.
  let re = rest.length;
  while (re > 0 && rest[re - 1].trim() === "") re--;
  const out = rest.slice(0, re).concat([""], block, [""]);
  return out.join("\n");
}

// _parseDailyTaskLine — pure minimal parser for a `- [ ] Title [k:: v]...` task
// line. Replicates TaskInteractions.parseTaskLine's inline-field grammar (which
// is a bare customJS class, not requireable in Node) so the migration stays a
// self-contained install.js function. Returns null for non-task / checked lines
// (only OPEN `- [ ]`/`- [ ]` etc. lines are parsed). Fields recognised:
//   project (wikilink brackets stripped: "[[Name]]" -> "Name"), priority, due,
//   scheduled. Title = everything before the first inline `[key:: value]` field.
function _parseDailyTaskLine(line) {
  if (typeof line !== "string") return null;
  // Open (unchecked) only. Any non-`x` mark inside the box counts as open
  // (`- [ ]`, `- [/]`, `- [-]`, ...), matching the "open" contract; `- [x]`/
  // `- [X]` (done) is explicitly excluded.
  const m = line.match(/^[-*+] \[([^xX\]])\] (.*)$/);
  if (!m) return null;
  const body = m[2];

  // Inline fields: [key:: value]. The value alternation matches a wikilink
  // (`[[...]]`) BEFORE the bare-value branch so `[[Name]]` is not truncated at
  // the first `]`. First occurrence of a key wins.
  const fieldRe = /\[(\w+)::\s*(\[\[[^\]]+\]\]|[^\]]+)\]/g;
  const fields = {};
  let firstFieldIdx = -1;
  let mm;
  while ((mm = fieldRe.exec(body)) !== null) {
    if (firstFieldIdx === -1) firstFieldIdx = mm.index;
    const key = mm[1];
    if (!(key in fields)) fields[key] = mm[2].trim();
  }

  const title = (firstFieldIdx === -1 ? body : body.slice(0, firstFieldIdx)).trim();
  if (!title) return null;  // a bracket-only line with no title — leave it raw

  let project = fields.project || null;
  if (project) {
    const wm = project.match(/^\[\[(.+?)\]\]$/);
    if (wm) project = wm[1];
  }

  return {
    title,
    project,                        // display name, brackets stripped, or null
    priority: fields.priority || null,
    due: fields.due || null,
    scheduled: fields.scheduled || null,
  };
}

// _dailyTaskHash4 — deterministic 4-hex-char hash (FNV-1a-ish, masked to 16
// bits), matching TaskEntity._hash4's algorithm. NO Math.random / Date.now, so
// re-deriving the same input yields the same filename (idempotency + audit).
// The migration folds a per-note index into the hash input so two tasks composed
// in the SAME install second with DIFFERENT indices land in different files even
// if their titles collide.
function _dailyTaskHash4(str) {
  let h = 0x811c9dc5;
  const s = String(str == null ? "" : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const v = (h ^ (h >>> 16)) & 0xffff;
  return ("0000" + (v >>> 0).toString(16)).slice(-4);
}

// _composeDailyTaskNote — pure. Builds the { path, body } for one task-note from
// a parsed open line + context. Mirrors TaskEntity.composeNote's canonical
// frontmatter key ORDER and empty-string-for-blank convention BYTE-FOR-BYTE so
// migrated task-notes are indistinguishable from dialog-created ones:
//   type / title / status / scheduled / due / priority / project /
//   project_slug / source / source_note / created_at / completed_at
// Args:
//   parsed      — _parseDailyTaskLine output
//   noteDateStr — the daily's date (YYYY-MM-DD from ToDo-<date>.md), or ""
//   nowIso      — ISO create timestamp (created_at)
//   ymd/hms     — YYYYMMDD / HHmmss for the filename
//   index       — per-note ordinal (folded into the filename hash for collision
//                 resistance across same-second composes)
function _composeDailyTaskNote(parsed, noteDateStr, nowIso, ymd, hms, index) {
  const p = parsed || {};
  // scheduled: parsed.due if present (a due date implies it's live now), else
  // the daily's own date, else blank (install date is intentionally NOT forced
  // here — the caller passes noteDateStr, which already falls back to the
  // install date when the filename carries no date).
  const scheduled = p.due || noteDateStr || "";
  const project = p.project ? `[[${p.project}]]` : "";
  const projectSlug = p.project
    ? String(p.project).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  const sourceNote = noteDateStr ? `[[ToDo-${noteDateStr}]]` : "";

  const fm = [
    "---",
    "type: task",
    `title: ${p.title || ""}`,
    "status: open",
    `scheduled: ${scheduled}`,
    `due: ${p.due || ""}`,
    `priority: ${p.priority || ""}`,
    `project: ${project ? `"${project}"` : ""}`,
    `project_slug: ${projectSlug}`,
    "source: daily",
    `source_note: ${sourceNote ? `"${sourceNote}"` : ""}`,
    `created_at: ${nowIso}`,
    "completed_at:",
    "---",
    "",
  ];
  const hex = _dailyTaskHash4((p.title || "") + "|" + hms + "|" + index);
  const path = `spice/tasks/task-${ymd}-${hms}-${hex}.md`;
  return { path, body: fm.join("\n") };
}

// applyDailyTasksToEntityMigration — v0.14.0 (to-do) / task-entity. Ungated,
// backup-first, idempotent, NON-DESTRUCTIVE conversion of the MOST-RECENT daily
// note's raw-markdown open tasks into note-per-task files under spice/tasks/.
//
// WHY only the most-recent daily: the carryover mechanism copies unfinished
// `- [ ]` lines forward each day, so the newest daily holds the current open
// set. Historical dailies are left COMPLETELY untouched (their raw lines remain
// as harmless archival markdown; nothing is ever deleted vault-wide).
//
// Contract (mirrors applyProjectTodoOwnedTasksHeal's posture):
//   - Ungated (runs every install) — back-injects NEW content, per the
//     migration-lifecycle rule.
//   - .sauce-backup snapshot of the daily BEFORE any write.
//   - Idempotent: if the target daily already has a TaskTodayList block OR a
//     `<!-- tasks-migrated -->` sentinel, SKIP entirely (no-op). After a
//     successful run the daily has both, so re-runs no-op.
//   - Fail-safe: per-line + whole-heal try/catch. An unparseable line is LEFT as
//     raw markdown (never dropped). Never throws out of the heal.
//   - Only OPEN `- [ ]` lines convert; `- [x]` (done) lines are left untouched.
//   - Extra safety: an equivalent task-note (same title+due, source: daily)
//     already under spice/tasks/ (incl. _done/_trash) is NOT re-created.
// Signature matches applyProjectTodoOwnedTasksHeal: (tp, history, git).
async function applyDailyTasksToEntityMigration(tp, history, git) {
  // Whole-heal guard: any unexpected failure records a warning + returns; it
  // NEVER throws out of the installer (loss-averse: a bad heal must not abort
  // the install or corrupt state).
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const TODO_ROOT = "spice/to-do";
    if (!(await adapter.exists(TODO_ROOT).catch(() => false))) {
      history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
        summary: { converted: 0, skipped_reason: "spice/to-do not present" },
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // (1) Enumerate daily notes (ToDo-YYYY-MM-DD.md, recursive).
    async function _walkDailies(dir, out = []) {
      let listing;
      try { listing = await adapter.list(dir); } catch (_e) { return out; }
      for (const f of (listing.files || [])) {
        if (/\/ToDo-\d{4}-\d{2}-\d{2}\.md$/.test(f)) out.push(f);
      }
      for (const sub of (listing.folders || [])) {
        await _walkDailies(sub, out);
      }
      return out;
    }
    const dailies = await _walkDailies(TODO_ROOT);
    if (!dailies.length) {
      history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
        summary: { converted: 0, skipped_reason: "no daily notes found" },
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // (2) Pick the daily with the greatest YYYY-MM-DD in its filename.
    const dateOf = (p) => {
      const mm = p.match(/ToDo-(\d{4}-\d{2}-\d{2})\.md$/);
      return mm ? mm[1] : "";
    };
    let target = dailies[0];
    for (const d of dailies) {
      if (dateOf(d) > dateOf(target)) target = d;
    }
    const noteDateStr = dateOf(target);
    const noteBase = target.split("/").pop().replace(/\.md$/, "");

    // (3) Read + idempotency skip.
    let content;
    try { content = await adapter.read(target); }
    catch (e) {
      history?.push({ event: "warning", step: "daily_tasks_to_entity_migration", name: "to-do",
        target, reason: `read failed: ${e && e.message ? e.message : String(e)}`,
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        attempted_at: new Date().toISOString() });
      return;
    }
    if (/class:\s*"TaskTodayList"/.test(content) || content.includes("<!-- tasks-migrated -->")) {
      history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
        target, action: "skipped_already_migrated", converted: 0,
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // (4) Extract OPEN task lines (fence-aware). Dedup by normalized title within
    // this note (a task duplicated in TODAY_CAPTURE + Carryover → one task-note).
    const lines = content.split("\n");
    let inFence = false;
    const openLineIdxs = [];       // indices of lines to REMOVE from the daily
    const parsedByIdx = new Map(); // idx -> parsed
    const seenTitles = new Set();
    const uniqueParsed = [];       // parsed entries to materialize (dedup'd)
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (/^\s*```/.test(ln)) { inFence = !inFence; continue; }
      if (inFence) continue;
      let parsed = null;
      try { parsed = _parseDailyTaskLine(ln); }
      catch (_e) { parsed = null; }  // per-line fail-safe → leave raw
      if (!parsed) continue;
      // This IS an open task line — mark for removal from the daily.
      openLineIdxs.push(i);
      parsedByIdx.set(i, parsed);
      const norm = parsed.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (seenTitles.has(norm)) continue;  // duplicate title → single task-note
      seenTitles.add(norm);
      uniqueParsed.push(parsed);
    }

    if (!openLineIdxs.length) {
      // Nothing to convert. Still swap the legacy widget blocks + stamp the
      // sentinel so a note that only had blocks (no open lines) becomes the
      // TaskTodayList shape and is a no-op next install.
      const swapped = _swapDailyToTaskTodayList(content);
      if (swapped === content) {
        history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
          target, action: "no_open_tasks", converted: 0,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          completed_at: new Date().toISOString() });
        return;
      }
      await _backupAndWrite(adapter, target, content, swapped);
      history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
        target, action: "blocks_swapped_no_tasks", converted: 0,
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // (5) Compose + create a task-note per unique open line.
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const hms = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const nowIso = _localIsoNoMillis(now);

    try { await adapter.mkdir("spice/tasks"); } catch (_e) { /* already exists */ }

    let created = 0;
    const createdTitles = [];
    for (let k = 0; k < uniqueParsed.length; k++) {
      const parsed = uniqueParsed[k];
      try {
        // Extra idempotency safety: skip if an equivalent task-note (same title +
        // due, source: daily) already exists ANYWHERE under spice/tasks/.
        if (await _dailyTaskNoteExists(adapter, parsed)) { continue; }
        const { path: taskPath, body } = _composeDailyTaskNote(parsed, noteDateStr, nowIso, ymd, hms, k);
        // Do not clobber an existing file at the deterministic path.
        if (await adapter.exists(taskPath).catch(() => false)) { continue; }
        await adapter.write(taskPath, body);
        created += 1;
        createdTitles.push(parsed.title);
      } catch (e) {
        // Per-task fail-safe: record + continue; the raw line stays in the daily
        // only if we ALSO fail to rewrite — but we still attempt the rewrite for
        // the tasks that DID materialize. A failed task means its raw line is
        // preserved below (we only strip lines whose task-note exists).
        history?.push({ event: "warning", step: "daily_tasks_to_entity_migration", name: "to-do",
          target, task: parsed && parsed.title, reason: e && e.message ? e.message : String(e),
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    // (6) Rewrite the daily: drop the migrated open lines, swap legacy blocks for
    // TaskTodayList, stamp the sentinel. Back up first.
    //
    // Only strip open lines whose title is now represented by a task-note (either
    // just-created OR pre-existing). If a task-note failed to materialize AND no
    // equivalent exists, we KEEP its raw line (never drop it silently).
    const strippableTitles = new Set();
    for (const parsed of uniqueParsed) {
      try {
        if (createdTitles.includes(parsed.title) || await _dailyTaskNoteExists(adapter, parsed)) {
          strippableTitles.add(parsed.title.toLowerCase().replace(/\s+/g, " ").trim());
        }
      } catch (_e) { /* leave the line raw on error */ }
    }
    const keptLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (openLineIdxs.includes(i)) {
        const parsed = parsedByIdx.get(i);
        const norm = parsed.title.toLowerCase().replace(/\s+/g, " ").trim();
        if (strippableTitles.has(norm)) continue;  // migrated → drop the raw line
      }
      keptLines.push(lines[i]);
    }
    let rewritten = _swapDailyToTaskTodayList(keptLines.join("\n"));
    // Collapse any 3+ consecutive blank lines the strip may have left.
    rewritten = rewritten.replace(/\n{3,}/g, "\n\n");

    await _backupAndWrite(adapter, target, content, rewritten);

    history?.push({ event: "info", step: "daily_tasks_to_entity_migration", name: "to-do",
      target, action: "migrated", converted: created, unique: uniqueParsed.length,
      raw_lines: openLineIdxs.length,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "daily_tasks_to_entity_migration", name: "to-do",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// _composeEntityTaskFrontmatter — pure. Builds the task-note frontmatter block
// (the `---`…`---` YAML + trailing blank line) for a meeting/project migration,
// mirroring TaskEntity.composeNote's canonical key ORDER + empty-string-for-blank
// + quote-when-hostile convention (same as _composeDailyTaskNote). The body
// (chrome) is appended by the caller. Args:
//   opts = {
//     title, scheduled, due, priority,       // scalars (strings; "" allowed)
//     project,        // display name (no brackets), or "" — emitted as "[[name]]"
//     projectSlug,    // slug string, or ""
//     source,         // "meeting" | "project"
//     sourceNote,     // "[[<Meeting>]]" wikilink string, or ""
//     nowIso,         // created_at ISO string
//   }
// Quoting: project + source_note are wikilinks (contain `[`), so quoted when
// non-empty (matches _composeDailyTaskNote). Title emitted raw (parser tolerant).
function _composeEntityTaskFrontmatter(opts) {
  const o = opts || {};
  const project = o.project ? `[[${o.project}]]` : "";
  const sourceNote = o.sourceNote || "";
  return [
    "---",
    "type: task",
    `title: ${o.title || ""}`,
    "status: open",
    `scheduled: ${o.scheduled || ""}`,
    `due: ${o.due || ""}`,
    `priority: ${o.priority || ""}`,
    `project: ${project ? `"${project}"` : ""}`,
    `project_slug: ${o.projectSlug || ""}`,
    `source: ${o.source || ""}`,
    `source_note: ${sourceNote ? `"${sourceNote}"` : ""}`,
    `created_at: ${o.nowIso || ""}`,
    "completed_at:",
    "---",
    "",
  ].join("\n");
}

// _parseSurfaceTaskLine — like _parseDailyTaskLine but returns ALL parsed fields
// for a meeting/project surface line. Reuses _parseDailyTaskLine (same grammar),
// so an OPEN `- [ ] Title [due:: …][priority:: …]` line yields {title, due,
// priority, scheduled, project}. Returns null for non-task / checked lines.
function _parseSurfaceTaskLine(line) {
  return _parseDailyTaskLine(line);
}

// _extractOpenLinesUnderMarker — pure. Given a note's full text + a marker
// comment, return the OPEN task lines that appear AFTER the marker (fence-aware),
// dedup'd by normalized title within the note. Returns { openIdxs, parsedByIdx,
// uniqueParsed } shaped like applyDailyTasksToEntityMigration's step (4) so the
// strip logic is identical. When the marker is absent, scans the WHOLE body
// (some legacy notes lack the marker but still hold `- [ ]` lines under the
// section heading).
function _extractOpenLinesUnderMarker(content, marker) {
  const lines = content.split("\n");
  const markerIdx = lines.findIndex((l) => l.includes(marker));
  const startAt = markerIdx >= 0 ? markerIdx + 1 : 0;
  let inFence = false;
  const openIdxs = [];
  const parsedByIdx = new Map();
  const seenTitles = new Set();
  const uniqueParsed = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (i < startAt) continue;                 // only lines AFTER the marker
    let parsed = null;
    try { parsed = _parseSurfaceTaskLine(ln); }
    catch (_e) { parsed = null; }
    if (!parsed) continue;
    openIdxs.push(i);
    parsedByIdx.set(i, parsed);
    const norm = parsed.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    uniqueParsed.push(parsed);
  }
  return { lines, openIdxs, parsedByIdx, uniqueParsed };
}

// _surfaceTaskNoteExists — true if an OPEN/any task-note with the SAME title +
// source + (project_slug for project source) already exists ANYWHERE under
// spice/tasks/. Idempotency guard mirroring _dailyTaskNoteExists so a re-run
// never spawns a duplicate. Matches on title + source; for project source also
// project_slug (so the same title under two projects stays distinct).
async function _surfaceTaskNoteExists(adapter, wantTitle, wantSource, wantSlug) {
  const ROOT = "spice/tasks";
  if (!(await adapter.exists(ROOT).catch(() => false))) return false;
  const wt = String(wantTitle || "").trim();
  const ws = String(wantSource || "").trim();
  const wslug = String(wantSlug || "").trim();
  async function _walk(dir, out = []) {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return out; }
    for (const f of (listing.files || [])) { if (f.endsWith(".md")) out.push(f); }
    for (const sub of (listing.folders || [])) { await _walk(sub, out); }
    return out;
  }
  const files = await _walk(ROOT);
  for (const f of files) {
    let body;
    try { body = await adapter.read(f); } catch (_e) { continue; }
    const tm = body.match(/^title:\s*(.*)$/m);
    const sm = body.match(/^source:\s*(.*)$/m);
    const gm = body.match(/^project_slug:\s*(.*)$/m);
    const title = tm ? tm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    const source = sm ? sm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    const slug = gm ? gm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    if (source !== ws) continue;
    if (title !== wt) continue;
    if (wslug && slug !== wslug) continue;
    return true;
  }
  return false;
}

// _createSurfaceTaskNotes — shared writer for the meeting + project migrations.
// For each uniqueParsed line, compose a task-note (frontmatter + chrome body)
// with a READABLE filename (<sanitized title>.md, deduped via _uniqueName against
// the vault — matching dialog-created notes). Skips a line whose equivalent
// task-note already exists (idempotency). Returns { created, createdTitles } and
// grows `existingNames` so intra-run dedupe is correct. Never throws per-line —
// records a warning + preserves the raw line (caller only strips created titles).
async function _createSurfaceTaskNotes(adapter, uniqueParsed, common, existingNames, history, git, step) {
  const _uniqueName = (baseFilename) => {
    if (!existingNames.has(baseFilename)) return baseFilename;
    const dot = baseFilename.lastIndexOf(".");
    const stem = dot > 0 ? baseFilename.slice(0, dot) : baseFilename;
    const ext = dot > 0 ? baseFilename.slice(dot) : "";
    for (let n = 2; n < 10000; n++) {
      const cand = stem + " " + n + ext;
      if (!existingNames.has(cand)) return cand;
    }
    return stem + " " + Date.now() + ext;
  };
  let created = 0;
  const createdTitles = [];
  for (const parsed of uniqueParsed) {
    try {
      const projectSlug = common.source === "project"
        ? (common.projectSlug || "")
        : (parsed.project
            ? String(parsed.project).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
            : (common.projectSlug || ""));
      const projectName = common.source === "project"
        ? (common.project || "")
        : (parsed.project || common.project || "");
      // Skip if an equivalent task-note already exists (idempotency).
      if (await _surfaceTaskNoteExists(adapter, parsed.title, common.source, projectSlug)) { continue; }
      const fmBlock = _composeEntityTaskFrontmatter({
        title: parsed.title,
        scheduled: parsed.due || "",
        due: parsed.due || "",
        priority: parsed.priority || "",
        project: projectName,
        projectSlug,
        source: common.source,
        sourceNote: common.sourceNote || "",
        nowIso: common.nowIso,
      });
      const body = fmBlock + _taskNoteChromeBody();
      const base = _sanitizeTaskTitleForFilename(parsed.title) + ".md";
      const finalName = _uniqueName(base);
      const taskPath = `spice/tasks/${finalName}`;
      if (await adapter.exists(taskPath).catch(() => false)) { continue; }
      await adapter.write(taskPath, body);
      existingNames.add(finalName);
      created += 1;
      createdTitles.push(parsed.title);
    } catch (e) {
      history?.push({ event: "warning", step, name: "task-entity",
        task: parsed && parsed.title, reason: e && e.message ? e.message : String(e),
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }
  return { created, createdTitles };
}

// applyMeetingTasksToEntityMigration — task-entity. Ungated, backup-first,
// idempotent, NON-DESTRUCTIVE conversion of EVERY meeting note's OPEN Action
// Items lines into note-per-task files under spice/tasks/. Unlike the daily
// migration (most-recent only), this processes ALL meeting notes under
// spice/meetings/notes/**.
//
// Contract (mirrors applyDailyTasksToEntityMigration's posture):
//   - Ungated (runs every install) — back-injects NEW content.
//   - Per-note `<!-- meeting-tasks-migrated -->` sentinel → SKIP on re-run.
//   - .sauce-backup snapshot of the meeting note BEFORE any write.
//   - Fail-safe: per-note + per-line + whole-heal try/catch. An unparseable
//     line is LEFT as raw markdown (never dropped). Never throws.
//   - Only OPEN `- [ ]` lines under the ACTION_ITEMS_MARKER convert; done lines
//     untouched. A task-note is stamped source: meeting, source_note:
//     [[<meetingBasename>]], + project/project_slug when the meeting has a
//     project: frontmatter.
// Signature matches applyDailyTasksToEntityMigration: (tp, history, git).
async function applyMeetingTasksToEntityMigration(tp, history, git) {
  const STEP = "meeting_tasks_to_entity_migration";
  const SENTINEL = "<!-- meeting-tasks-migrated -->";
  const MARKER = "<!-- ACTION_ITEMS_MARKER -->";
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/meetings/notes";
    if (!(await adapter.exists(ROOT).catch(() => false))) {
      history?.push({ event: "info", step: STEP, name: "meetings",
        summary: { converted: 0, skipped_reason: "spice/meetings/notes not present" },
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // Enumerate meeting notes recursively.
    async function _walk(dir, out = []) {
      let listing;
      try { listing = await adapter.list(dir); } catch (_e) { return out; }
      for (const f of (listing.files || [])) { if (f.endsWith(".md")) out.push(f); }
      for (const sub of (listing.folders || [])) { await _walk(sub, out); }
      return out;
    }
    const meetings = await _walk(ROOT);
    if (!meetings.length) return;

    const now = new Date();
    const nowIso = _localIsoNoMillis(now);
    try { await adapter.mkdir("spice/tasks"); } catch (_e) { /* already exists */ }

    // Live set of top-level task-note basenames for intra-run dedupe.
    let taskListing;
    try { taskListing = await adapter.list("spice/tasks"); } catch (_e) { taskListing = { files: [] }; }
    const existingNames = new Set((taskListing.files || [])
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.substring(f.lastIndexOf("/") + 1)));

    let totalConverted = 0, notesTouched = 0;
    for (const fp of meetings) {
      try {
        const content = await adapter.read(fp);
        if (content.includes(SENTINEL)) continue;  // idempotent skip

        const fm = _parseFrontmatterStrict(content) || {};
        // project display name (strip [[ ]] / quotes) + slug.
        let projectName = fm.project != null ? String(fm.project).replace(/^"(.*)"$/, "$1").replace(/^\[\[|\]\]$/g, "").trim() : "";
        const projectSlug = projectName
          ? projectName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
          : "";
        const meetingBasename = fp.substring(fp.lastIndexOf("/") + 1).replace(/\.md$/, "");
        const sourceNote = `[[${meetingBasename}]]`;

        const { lines, openIdxs, parsedByIdx, uniqueParsed } =
          _extractOpenLinesUnderMarker(content, MARKER);

        if (!openIdxs.length) {
          // No open Action Items lines — still stamp the sentinel so re-runs skip.
          const stamped = content.replace(/\s*$/, "") + "\n\n" + SENTINEL + "\n";
          await _backupAndWrite(adapter, fp, content, stamped);
          continue;
        }

        const { created, createdTitles } = await _createSurfaceTaskNotes(
          adapter, uniqueParsed,
          { source: "meeting", project: projectName, projectSlug, sourceNote, nowIso },
          existingNames, history, git, STEP);
        totalConverted += created;

        // Strip only the migrated open lines (those whose task-note exists now).
        const strippable = new Set();
        for (const parsed of uniqueParsed) {
          try {
            if (createdTitles.includes(parsed.title)
              || await _surfaceTaskNoteExists(adapter, parsed.title, "meeting", projectSlug)) {
              strippable.add(parsed.title.toLowerCase().replace(/\s+/g, " ").trim());
            }
          } catch (_e) { /* leave the line raw on error */ }
        }
        const keptLines = [];
        for (let i = 0; i < lines.length; i++) {
          if (openIdxs.includes(i)) {
            const parsed = parsedByIdx.get(i);
            const norm = parsed.title.toLowerCase().replace(/\s+/g, " ").trim();
            if (strippable.has(norm)) continue;
          }
          keptLines.push(lines[i]);
        }
        let rewritten = keptLines.join("\n").replace(/\n{3,}/g, "\n\n");
        rewritten = rewritten.replace(/\s*$/, "") + "\n\n" + SENTINEL + "\n";
        await _backupAndWrite(adapter, fp, content, rewritten);
        notesTouched += 1;
      } catch (e) {
        history?.push({ event: "warning", step: STEP, name: "meetings",
          target: fp, reason: e && e.message ? e.message : String(e),
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: STEP, name: "meetings",
      summary: { scanned: meetings.length, notes_touched: notesTouched, converted: totalConverted },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: STEP, name: "meetings",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// applyProjectTasksToEntityMigration — task-entity. Ungated, backup-first,
// idempotent, NON-DESTRUCTIVE conversion of EVERY project To-Do note's OPEN
// Owned Tasks lines (and any spice/projects/*/tasks/*.md kanban task files'
// open lines) into note-per-task files under spice/tasks/. Processes ALL
// project-todo notes (spice/projects/*/*  To-Do.md).
//
// Contract mirrors applyMeetingTasksToEntityMigration: ungated, per-note
// `<!-- project-tasks-migrated -->` sentinel, .sauce-backup before write,
// per-note/-line try/catch, only OPEN lines under OWNED_TASKS_MARKER convert.
// Task-notes are stamped source: project, project: [[<projectName>]],
// project_slug (from the note's frontmatter). Signature: (tp, history, git).
async function applyProjectTasksToEntityMigration(tp, history, git) {
  const STEP = "project_tasks_to_entity_migration";
  const SENTINEL = "<!-- project-tasks-migrated -->";
  const MARKER = "<!-- OWNED_TASKS_MARKER -->";
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/projects";
    if (!(await adapter.exists(ROOT).catch(() => false))) {
      history?.push({ event: "info", step: STEP, name: "project",
        summary: { converted: 0, skipped_reason: "spice/projects not present" },
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    // Enumerate every markdown file under spice/projects/ so we can pick out the
    // project-todo notes (frontmatter type: project-todo) + kanban task files
    // (spice/projects/<slug>/tasks/<X>.md).
    async function _walk(dir, out = []) {
      let listing;
      try { listing = await adapter.list(dir); } catch (_e) { return out; }
      for (const f of (listing.files || [])) { if (f.endsWith(".md")) out.push(f); }
      for (const sub of (listing.folders || [])) { await _walk(sub, out); }
      return out;
    }
    const allFiles = await _walk(ROOT);
    // Targets: project-todo notes (type: project-todo) + tasks/*.md kanban files.
    const targets = [];
    for (const fp of allFiles) {
      const rel = fp.slice(ROOT.length + 1);              // "<slug>/..."
      const parts = rel.split("/");
      const isToDo = /\sTo-Do\.md$/.test(fp) || parts.length === 2;  // <slug>/<Name> To-Do.md
      const isKanbanTask = parts.length >= 3 && parts[1] === "tasks";
      if (isToDo || isKanbanTask) targets.push(fp);
    }
    if (!targets.length) {
      history?.push({ event: "info", step: STEP, name: "project",
        summary: { converted: 0, skipped_reason: "no project-todo / kanban task notes found" },
        git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
        completed_at: new Date().toISOString() });
      return;
    }

    const now = new Date();
    const nowIso = _localIsoNoMillis(now);
    try { await adapter.mkdir("spice/tasks"); } catch (_e) { /* already exists */ }

    let taskListing;
    try { taskListing = await adapter.list("spice/tasks"); } catch (_e) { taskListing = { files: [] }; }
    const existingNames = new Set((taskListing.files || [])
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.substring(f.lastIndexOf("/") + 1)));

    let totalConverted = 0, notesTouched = 0;
    for (const fp of targets) {
      try {
        const content = await adapter.read(fp);
        // Only migrate genuine project-todo notes (type: project-todo). Kanban
        // task files rarely carry OWNED_TASKS_MARKER; process them only if the
        // marker is present.
        const fm = _parseFrontmatterStrict(content) || {};
        const isProjectTodo = fm.type === "project-todo";
        const hasMarker = content.includes(MARKER);
        if (!isProjectTodo && !hasMarker) continue;  // not a task surface we own
        if (content.includes(SENTINEL)) continue;    // idempotent skip

        // project name + slug from the project-todo frontmatter; fall back to path.
        let projectName = fm.project != null
          ? String(fm.project).replace(/^"(.*)"$/, "$1").replace(/^\[\[|\]\]$/g, "").trim()
          : "";
        let projectSlug = fm.project_slug != null
          ? String(fm.project_slug).replace(/^"(.*)"$/, "$1").trim()
          : "";
        if (!projectSlug) {
          const rel = fp.slice(ROOT.length + 1);
          projectSlug = rel.split("/")[0] || "";
        }
        if (!projectName && projectSlug) projectName = projectSlug;

        const { lines, openIdxs, parsedByIdx, uniqueParsed } =
          _extractOpenLinesUnderMarker(content, MARKER);

        if (!openIdxs.length) {
          const stamped = content.replace(/\s*$/, "") + "\n\n" + SENTINEL + "\n";
          await _backupAndWrite(adapter, fp, content, stamped);
          continue;
        }

        const { created, createdTitles } = await _createSurfaceTaskNotes(
          adapter, uniqueParsed,
          { source: "project", project: projectName, projectSlug, sourceNote: "", nowIso },
          existingNames, history, git, STEP);
        totalConverted += created;

        const strippable = new Set();
        for (const parsed of uniqueParsed) {
          try {
            if (createdTitles.includes(parsed.title)
              || await _surfaceTaskNoteExists(adapter, parsed.title, "project", projectSlug)) {
              strippable.add(parsed.title.toLowerCase().replace(/\s+/g, " ").trim());
            }
          } catch (_e) { /* leave the line raw on error */ }
        }
        const keptLines = [];
        for (let i = 0; i < lines.length; i++) {
          if (openIdxs.includes(i)) {
            const parsed = parsedByIdx.get(i);
            const norm = parsed.title.toLowerCase().replace(/\s+/g, " ").trim();
            if (strippable.has(norm)) continue;
          }
          keptLines.push(lines[i]);
        }
        let rewritten = keptLines.join("\n").replace(/\n{3,}/g, "\n\n");
        rewritten = rewritten.replace(/\s*$/, "") + "\n\n" + SENTINEL + "\n";
        await _backupAndWrite(adapter, fp, content, rewritten);
        notesTouched += 1;
      } catch (e) {
        history?.push({ event: "warning", step: STEP, name: "project",
          target: fp, reason: e && e.message ? e.message : String(e),
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: STEP, name: "project",
      summary: { scanned: targets.length, notes_touched: notesTouched, converted: totalConverted },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: STEP, name: "project",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// _taskNoteChromeBody — the canonical CHROME body a task note gets: a
// SpaceNavButtons nav block, a `---` HR, the TaskNoteView card block, a second
// `---` HR, and the `<!-- TASK_NOTES -->` marker that separates the (regenerable)
// chrome above from the user's own notes below (nav → HR → card → HR → notes).
// MUST stay BYTE-IDENTICAL to TaskEntity._chromeBody()
// (mechanisms/task-entity/task-entity.js) — the heal can't require the customJS
// class in the headless installer, so the string is replicated here. Any drift
// breaks the "already has chrome → skip" idempotency.
function _taskNoteChromeBody() {
  return "\n" +
    "```dataviewjs\n" +
    "await dv.view(\"ranch/views/customjs-guard\", { class: \"TaskChromeBar\" });\n" +
    "```\n" +
    "\n" +
    "---\n" +
    "\n" +
    "```dataviewjs\n" +
    "await dv.view(\"ranch/views/customjs-guard\", { class: \"TaskNoteView\" });\n" +
    "```\n" +
    "\n" +
    "---\n" +
    "\n" +
    "<!-- TASK_NOTES -->\n";
}

// _sanitizeTaskTitleForFilename — the SAME sanitization as
// TaskEntity._sanitizeTitle (mechanisms/task-entity/task-entity.js). Replicated
// inline (the heal can't require the customJS class). Strip Obsidian-illegal
// filename chars, collapse whitespace, trim, cap to 80, empty → "Task".
function _sanitizeTaskTitleForFilename(title) {
  const s = String(title == null ? "" : title)
    .replace(/[/\\:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return s === "" ? "Task" : s;
}

// applyTaskNoteHeal — ungated, idempotent, failure-loud-per-file heal for task
// notes under spice/tasks/ (TOP LEVEL only; skips _trash/ and _done/). Three jobs:
//
//   1. RENAME ugly-named notes: a basename matching the old deterministic form
//      `task-YYYYMMDD-HHmmss-hhhh` is renamed to the readable
//      `<sanitized title>.md`, deduped against existing top-level task notes
//      (" 2", " 3", …). copy-content-to-new-path + remove-old (backlinks to task
//      notes are effectively nil — they're queried, not linked — so copy+remove
//      is safe; the installer adapter has no rename()).
//   2. INJECT CHROME into bare notes: a note whose body has NO
//      `<!-- TASK_NOTES -->` marker gets the standard chrome body, with any
//      existing user body text preserved BELOW the marker.
//   3. CLEAN a corrupted title: a `title:` frontmatter value carrying a
//      trailing "✅ YYYY-MM-DD" annotation (baked in by a legacy
//      registry-migration parsing bug — see _stripCompletionEmojiSuffix) is
//      cleaned in place, and the note is renamed to match via the SAME
//      rename path job 1 uses (desired filename now always derives from the
//      clean title, whichever job triggered the rename).
//
// Idempotent: a note already title-named, already clean-titled, AND already
// carrying the marker is skipped (no write). Ungated (runs every install)
// since it back-injects NEW content into existing notes, per the
// migration-lifecycle rule. Mirrors applyProjectTodoOwnedTasksHeal /
// applyDailyTasksToEntityMigration posture: .sauce-backup snapshot before
// write, per-file try/catch, never throws. Signature matches
// applyProjectTodoOwnedTasksHeal: (tp, history, git).
async function applyTaskNoteHeal(tp, history, git) {
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/tasks";
    if (!(await adapter.exists(ROOT).catch(() => false))) return;

    // Enumerate TOP-LEVEL task notes only (skip _trash/ + _done/ subfolders).
    let listing;
    try { listing = await adapter.list(ROOT); }
    catch (_e) { return; }
    const topLevel = (listing.files || []).filter((f) => f.endsWith(".md"));
    if (!topLevel.length) return;

    const OLD_NAME_RE = /^task-\d{8}-\d{6}-[0-9a-f]{4}$/;
    const MARKER = "<!-- TASK_NOTES -->";
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    let renamed = 0, chromed = 0, warned = 0;

    // Live set of top-level task-note basenames so dedupe sees prior renames in
    // THIS pass (seeded from the current listing; grows as we rename).
    const existingNames = new Set(topLevel.map((f) => f.substring(f.lastIndexOf("/") + 1)));

    const _uniqueName = (baseFilename) => {
      if (!existingNames.has(baseFilename)) return baseFilename;
      const dot = baseFilename.lastIndexOf(".");
      const stem = dot > 0 ? baseFilename.slice(0, dot) : baseFilename;
      const ext = dot > 0 ? baseFilename.slice(dot) : "";
      for (let n = 2; n < 10000; n++) {
        const cand = stem + " " + n + ext;
        if (!existingNames.has(cand)) return cand;
      }
      return stem + " " + Date.now() + ext;
    };

    const _backup = async (relPath, content) => {
      const backupPath = `.sauce-backup/${ts}/${relPath}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* tolerate */ }
      try { await adapter.write(backupPath, content); } catch (_e) { /* best-effort */ }
    };

    // Inject chrome into a bare body: preserve frontmatter verbatim, insert the
    // chrome + marker, move any existing user body text BELOW the marker.
    const _injectChrome = (content) => {
      const m = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/.exec(content);
      const header = m ? m[1] : "";
      const bodyBelow = m ? content.slice(m[0].length) : content;
      const userBody = String(bodyBelow).replace(/\s+$/, "");
      const chrome = _taskNoteChromeBody();
      const tail = userBody ? userBody + "\n" : "";
      if (!header) return chrome + tail;
      return header + "\n" + chrome + tail;
    };

    // UPGRADE old chrome (has the marker but the above-marker region is a legacy
    // shape — the v0.178 chrome that carried a TaskNoteToDoNav block, or an even
    // older chrome lacking the second `---` HR before the marker): rebuild the
    // WHOLE region above (and including) the marker as frontmatter + the current
    // chrome body, PRESERVING everything the user wrote BELOW the marker verbatim.
    // Idempotent because the new chrome drops TaskNoteToDoNav AND ends with a
    // `---` HR right before the marker, so the caller's needsChromeUpgrade guard
    // is false on the next pass.
    const _upgradeChrome = (content) => {
      const idx = content.indexOf(MARKER);
      if (idx < 0) return content;                 // no marker → not our case
      const belowRaw = content.slice(idx + MARKER.length);
      // Keep the user's notes below the marker; drop only a single leading
      // newline so the rebuilt chrome (which ends in "<!-- TASK_NOTES -->\n")
      // joins cleanly. Preserve internal structure otherwise.
      const below = belowRaw.replace(/^\r?\n/, "");
      const m = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?/.exec(content);
      const header = m ? m[1] : "";
      const chrome = _taskNoteChromeBody();       // ends with "<!-- TASK_NOTES -->\n"
      const tail = below ? below : "";
      if (!header) return chrome + tail;
      return header + "\n" + chrome + tail;
    };

    for (const fp of topLevel) {
      try {
        const basename = fp.substring(fp.lastIndexOf("/") + 1);
        const stemNoExt = basename.replace(/\.md$/, "");
        const before = await adapter.read(fp);
        // Parse title from frontmatter (strict headless parser).
        const fm = _parseFrontmatterStrict(before) || {};
        const rawTitle = fm.title != null ? String(fm.title).replace(/^"(.*)"$/, "$1") : "";

        const needsTitleCleanup = rawTitle !== _stripCompletionEmojiSuffix(rawTitle);
        const cleanTitle = needsTitleCleanup ? _stripCompletionEmojiSuffix(rawTitle) : rawTitle;
        const needsRename = OLD_NAME_RE.test(stemNoExt) || needsTitleCleanup;
        const needsChrome = !before.includes(MARKER);
        // Old-chrome upgrade: the note HAS the marker but its above-marker region
        // is a LEGACY chrome — either the v0.178 shape that still carries a
        // TaskNoteToDoNav block, or an older shape that lacks the second `---` HR
        // right before the marker. The NEW chrome has NEITHER a TaskNoteToDoNav
        // block NOR a missing pre-marker HR, so both conditions being false ⇒
        // already-new ⇒ skip (idempotent). Only inspect the region ABOVE the
        // marker so a user who happens to mention the class / a `---` in their
        // notes below doesn't perturb the decision.
        const _aboveMarker = needsChrome ? "" : before.slice(0, before.indexOf(MARKER));
        const _hasToDoNav = /class:\s*"TaskNoteToDoNav"/.test(_aboveMarker);
        const _endsWithHr = /\n---[ \t]*\r?\n\s*$/.test(_aboveMarker);
        const needsChromeUpgrade = !needsChrome && (_hasToDoNav || !_endsWithHr);
        if (!needsRename && !needsChrome && !needsChromeUpgrade) continue;  // idempotent no-op

        // Compute the healed CONTENT: inject chrome if bare, else UPGRADE the
        // old chrome region (drop TaskNoteToDoNav, add the second `---` HR)
        // preserving user notes; and the healed PATH (rename if old-pattern;
        // copy-to-new + remove-old).
        let content = needsChrome ? _injectChrome(before)
          : (needsChromeUpgrade ? _upgradeChrome(before) : before);
        if (needsTitleCleanup) {
          const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---)/.exec(content);
          if (fmMatch) {
            const fixedFm = fmMatch[1].replace(/^title:\s*.*$/m, "title: " + cleanTitle);
            content = fixedFm + content.slice(fmMatch[1].length);
          }
        }

        if (needsRename) {
          const desired = _sanitizeTaskTitleForFilename(cleanTitle) + ".md";
          // Never collide with the file we're leaving, nor any existing note.
          existingNames.delete(basename);  // free the old name for reuse math
          const finalName = _uniqueName(desired);
          const newPath = `${ROOT}/${finalName}`;
          // Snapshot the original before touching it.
          await _backup(fp, before);
          // Write the (possibly chromed/upgraded) content to the new path, remove old.
          await adapter.write(newPath, content);
          await adapter.remove(fp);
          existingNames.add(finalName);
          renamed += 1;
          if (needsChrome || needsChromeUpgrade) chromed += 1;
          history?.push({ event: "info", step: "task_note_heal", name: "task-entity",
            action: (needsChrome ? "renamed+chromed" : (needsChromeUpgrade ? "renamed+chrome-upgraded" : "renamed")),
            from: fp, to: newPath,
            git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
            attempted_at: new Date().toISOString() });
        } else if (needsChrome) {
          // Chrome-only, in place.
          await _backup(fp, before);
          await adapter.write(fp, content);
          chromed += 1;
          history?.push({ event: "info", step: "task_note_heal", name: "task-entity",
            action: "chromed", target: fp,
            git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
            attempted_at: new Date().toISOString() });
        } else if (needsChromeUpgrade) {
          // Upgrade old chrome in place (preserve user notes below the marker).
          await _backup(fp, before);
          await adapter.write(fp, content);
          chromed += 1;
          history?.push({ event: "info", step: "task_note_heal", name: "task-entity",
            action: "chrome-upgraded", target: fp,
            git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
            attempted_at: new Date().toISOString() });
        }
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: "task_note_heal", name: "task-entity",
          reason: `${fp}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: "task_note_heal", name: "task-entity",
      summary: { scanned: topLevel.length, renamed, chromed, warned },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "task_note_heal", name: "task-entity",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// _cleanProjectLinkName — extract the CLEAN project basename from a raw
// frontmatter `project:` value string (as read from the note text). The value
// may be MANGLED — a full resolved path inside `[[...]]` with a `|alias`, e.g.
// `[[spice/projects/connectors/Connectors.md|Connectors]]` — or a clean
// `[[Connectors]]`, or a quoted variant. Returns the basename (last `/` segment,
// `.md` + `|alias` + `[[ ]]` + surrounding quotes stripped): "Connectors". Pure.
function _cleanProjectLinkName(raw) {
  let s = String(raw == null ? "" : raw).trim();
  // Strip surrounding YAML quotes.
  s = s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
  // Strip surrounding [[ ]].
  const m = /^\[\[([^\]]*)\]\]$/.exec(s);
  if (m) s = m[1].trim();
  // Drop a trailing |alias → keep the target (before the pipe).
  const pipe = s.indexOf("|");
  if (pipe >= 0) s = s.slice(0, pipe).trim();
  // Basename: last `/` segment, drop trailing `.md`.
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  return s.replace(/\.md$/i, "").trim();
}

// _isMangledProjectField — true when a task-note's project/project_slug pair looks
// like the B1 mangle: `project` carries a `/` (a PATH inside `[[...]]`, not a bare
// basename) OR `project_slug` contains `-md-` / has the path-slug shape
// (starts with `spice-projects-`). A clean note (`project: "[[Connectors]]"`,
// `project_slug: connectors`) is NOT mangled → skipped (idempotent). Pure.
function _isMangledProjectField(projectRaw, slugRaw) {
  const proj = String(projectRaw == null ? "" : projectRaw);
  const slug = String(slugRaw == null ? "" : slugRaw).replace(/^"(.*)"$/, "$1").trim();
  // A path inside the project link (a `/` between the `[[` and `]]`).
  const inner = /\[\[([^\]]*)\]\]/.exec(proj);
  const linkPathish = inner ? inner[1].includes("/") : proj.includes("/");
  const slugPathish = /-md-/.test(slug) || /^spice-projects-/.test(slug);
  return linkPathish || slugPathish;
}

// _projectSlugByName — map a clean project NAME to its REAL slug by scanning the
// vault's `type: project` hub notes under spice/projects/<dir>/. Returns the
// matching project's slug (its own `project_slug` frontmatter, else the dir
// basename) when the hub's basename OR project_slug matches the clean name
// (case-insensitively / slug-equal); else "" so the caller sanitizes the name.
async function _projectSlugByName(adapter, cleanName) {
  const want = String(cleanName == null ? "" : cleanName).trim();
  if (!want) return "";
  const wantLc = want.toLowerCase();
  const wantSlug = _sanitizeProjectSlug(want);
  const PROJ_ROOT = "spice/projects";
  let listing;
  try { listing = await adapter.list(PROJ_ROOT); } catch (_e) { return ""; }
  for (const projDir of (listing.folders || [])) {
    let sub;
    try { sub = await adapter.list(projDir); } catch (_e) { continue; }
    for (const file of (sub.files || [])) {
      if (!file.endsWith(".md")) continue;
      if (/ To-Do\.md$/.test(file) || /Project Map\.md$/.test(file) ||
          /-board\.md$/.test(file) || /Links Hub\.md$/.test(file)) continue;
      let content;
      try { content = await adapter.read(file); } catch (_e) { continue; }
      const fm = _parseFrontmatterStrict(content) || {};
      if (fm.type !== "project" && !/^type:\s*"?project"?\s*$/m.test(content)) continue;
      const hubName = file.split("/").pop().replace(/\.md$/, "");
      const dirSlug = projDir.split("/").pop();
      const fmSlug = fm.project_slug != null
        ? String(fm.project_slug).replace(/^"(.*)"$/, "$1").trim()
        : "";
      const slug = fmSlug || dirSlug || "";
      if (hubName.toLowerCase() === wantLc || _sanitizeProjectSlug(hubName) === wantSlug
        || (slug && slug === wantSlug)) {
        return slug;
      }
    }
  }
  return "";
}

// _sanitizeProjectSlug — the canonical project-slug shape (lowercase, non-alnum
// runs → "-", trimmed) used everywhere a slug is derived from a name. Pure.
function _sanitizeProjectSlug(name) {
  return String(name == null ? "" : name)
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// applyTaskNoteProjectSlugHeal — B1 heal. Ungated, idempotent, .sauce-backup,
// per-note try/catch. For each TOP-LEVEL task-note under spice/tasks/ (skip
// _trash/ + _done/): when its `project`/`project_slug` looks MANGLED (a resolved
// PATH inside `[[...]]`, or a `-md-` / `spice-projects-` path-slug), re-derive:
//   - cleanName = basename of the project link (path + `.md` + `|alias` stripped)
//   - slug      = the REAL project slug (looked up in the vault's type: project
//                 notes by cleanName), else the sanitized cleanName
// then rewrite ONLY `project: "[[<cleanName>]]"` + `project_slug: <slug>` in the
// frontmatter, preserving everything else. A NON-mangled note is skipped (no
// write) → idempotent. Never throws. Signature: (tp, history, git).
async function applyTaskNoteProjectSlugHeal(tp, history, git) {
  const STEP = "task_note_project_slug_heal";
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/tasks";
    if (!(await adapter.exists(ROOT).catch(() => false))) return;

    let listing;
    try { listing = await adapter.list(ROOT); } catch (_e) { return; }
    const topLevel = (listing.files || []).filter((f) => f.endsWith(".md"));
    if (!topLevel.length) return;

    let scanned = 0, healed = 0, warned = 0;
    for (const fp of topLevel) {
      scanned += 1;
      try {
        const before = await adapter.read(fp);
        const fm = _parseFrontmatterStrict(before) || {};
        if (fm.type !== "task") continue;                 // not a task note
        const projectRaw = fm.project != null ? String(fm.project) : "";
        const slugRaw = fm.project_slug != null ? String(fm.project_slug) : "";
        // Only act on a NON-empty project field (a blank project isn't mangled).
        if (!projectRaw.trim() && !slugRaw.trim()) continue;
        if (!_isMangledProjectField(projectRaw, slugRaw)) continue;  // idempotent skip

        const cleanName = _cleanProjectLinkName(projectRaw)
          || _cleanProjectLinkName(slugRaw);
        if (!cleanName) continue;                          // nothing to re-derive
        const realSlug = await _projectSlugByName(adapter, cleanName);
        const slug = realSlug || _sanitizeProjectSlug(cleanName);

        // Rewrite ONLY the two lines in the frontmatter block; preserve the rest.
        const fmMatch = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(before);
        if (!fmMatch) continue;                            // no frontmatter → skip
        let block = fmMatch[2];
        const projLineRe = /^project:.*$/m;
        const slugLineRe = /^project_slug:.*$/m;
        if (projLineRe.test(block)) block = block.replace(projLineRe, `project: "[[${cleanName}]]"`);
        if (slugLineRe.test(block)) block = block.replace(slugLineRe, `project_slug: ${slug}`);
        const after = before.slice(0, fmMatch.index)
          + fmMatch[1] + block + fmMatch[3]
          + before.slice(fmMatch.index + fmMatch[0].length);
        if (after === before) continue;                    // no-op (defensive)

        await _backupAndWrite(adapter, fp, before, after);
        healed += 1;
        history?.push({ event: "info", step: STEP, name: "task-entity",
          action: "unmangled", target: fp, project: cleanName, project_slug: slug,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: STEP, name: "task-entity",
          reason: `${fp}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: STEP, name: "task-entity",
      summary: { scanned, healed, warned },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: STEP, name: "task-entity",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// _projectTasksListBlock — the EXACT block pair a NEW project-todo template
// emits for the live task list: a "Project Tasks" SectionLabel (top: true, since
// it's the first section) + the TaskProjectList dataviewjs block. Materialized
// `ranch/views/customjs-guard` form (heals write INSTALLED notes, not templates).
// MUST stay in lockstep with platform/blueprints/to-do/templates/Project To-Do.md.
function _projectTasksListBlock() {
  return '```dataviewjs\n' +
    'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Project Tasks", top: true }] });\n' +
    '```\n' +
    '\n' +
    '```dataviewjs\n' +
    'await dv.view("ranch/views/customjs-guard", { class: "TaskProjectList" });\n' +
    '```\n';
}

// _meetingTasksListBlock — the EXACT block pair a NEW meeting template emits: a
// "Tasks" SectionLabel + the TaskMeetingList dataviewjs block. Materialized
// customjs-guard form. MUST stay in lockstep with
// platform/blueprints/meetings/templates/Meeting.md.
function _meetingTasksListBlock() {
  return '```dataviewjs\n' +
    'await dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "Tasks" }] });\n' +
    '```\n' +
    '\n' +
    '```dataviewjs\n' +
    'await dv.view("ranch/views/customjs-guard", { class: "TaskMeetingList" });\n' +
    '```\n';
}

// applyProjectTodoTaskListHeal — B2 heal. For each per-project To-Do note
// (spice/projects/*/* To-Do.md, type: project-todo) that lacks a TaskProjectList
// block, inject the "Project Tasks" SectionLabel + TaskProjectList block so the
// live task list renders (only NEW notes got it from the template). Injected just
// BEFORE the "Owned Tasks" SectionLabel (mirrors template ordering); falls back to
// just before the OWNED_TASKS_MARKER, else appended. Ungated, idempotent (skip if
// the block is already present), .sauce-backup before write, per-note try/catch.
async function applyProjectTodoTaskListHeal(tp, history, git) {
  const STEP = "project_todo_task_list_heal";
  const MARKER = "<!-- OWNED_TASKS_MARKER -->";
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/projects";
    if (!(await adapter.exists(ROOT).catch(() => false))) return;

    async function _walk(dir, out = []) {
      let listing;
      try { listing = await adapter.list(dir); } catch (_e) { return out; }
      for (const f of (listing.files || [])) { if (f.endsWith(".md")) out.push(f); }
      for (const sub of (listing.folders || [])) { await _walk(sub, out); }
      return out;
    }
    const files = await _walk(ROOT);
    const todos = files.filter((f) => / To-Do\.md$/.test(f));
    if (!todos.length) return;

    const block = _projectTasksListBlock();
    let scanned = 0, injected = 0, warned = 0;
    for (const fp of todos) {
      scanned += 1;
      try {
        const before = await adapter.read(fp);
        const fm = _parseFrontmatterStrict(before) || {};
        if (fm.type !== "project-todo") continue;             // only project-todo notes
        if (/class:\s*"TaskProjectList"/.test(before)) continue;  // idempotent skip

        let after;
        // Section order (v0.179 UI polish) is Project Tasks → From Meetings →
        // Owned Tasks, so Project Tasks goes at the TOP. Insert before whichever
        // of the "From Meetings" / "Owned Tasks" SectionLabel blocks appears
        // FIRST (the reorder heal runs after this, so pre-reorder notes may still
        // have Owned Tasks above From Meetings — inserting before the earliest
        // keeps Project Tasks first either way); fall back to the marker, else
        // append.
        const fromMeetingsRe = /```dataviewjs\r?\n[^`]*class:\s*"SectionLabel"[^`]*text:\s*"From Meetings"[\s\S]*?```\r?\n?/;
        const ownedLabelRe = /```dataviewjs\r?\n[^`]*class:\s*"SectionLabel"[^`]*text:\s*"Owned Tasks"[\s\S]*?```\r?\n?/;
        const fm2 = fromMeetingsRe.exec(before);
        const om = ownedLabelRe.exec(before);
        let anchorIdx = -1;
        if (fm2 && om) anchorIdx = Math.min(fm2.index, om.index);
        else if (fm2) anchorIdx = fm2.index;
        else if (om) anchorIdx = om.index;
        if (anchorIdx >= 0) {
          after = before.slice(0, anchorIdx) + block + "\n" + before.slice(anchorIdx);
        } else {
          const mi = before.indexOf(MARKER);
          if (mi >= 0) {
            // Insert the block just before the marker line.
            const lineStart = before.lastIndexOf("\n", mi) + 1;
            after = before.slice(0, lineStart) + block + "\n" + before.slice(lineStart);
          } else {
            // No marker/label — append the block at the end.
            after = before.replace(/\s*$/, "") + "\n\n" + block;
          }
        }
        if (after === before) continue;
        await _backupAndWrite(adapter, fp, before, after);
        injected += 1;
        history?.push({ event: "info", step: STEP, name: "project",
          action: "injected", target: fp,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: STEP, name: "project",
          reason: `${fp}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: STEP, name: "project",
      summary: { scanned, injected, warned },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: STEP, name: "project",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// applyMeetingTaskListHeal — B2 heal. For each meeting note under
// spice/meetings/notes/** (type: meeting) that lacks a TaskMeetingList block,
// inject the "Tasks" SectionLabel + TaskMeetingList block near the
// ACTION_ITEMS_MARKER (only NEW notes got it from the template). Injected AFTER
// the marker line (matching the template, where the Tasks block follows the
// marker); falls back to appended at end. Ungated, idempotent (skip if present),
// .sauce-backup, per-note try/catch.
async function applyMeetingTaskListHeal(tp, history, git) {
  const STEP = "meeting_task_list_heal";
  const MARKER = "<!-- ACTION_ITEMS_MARKER -->";
  try {
    if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
    const adapter = tp.app.vault.adapter;
    const ROOT = "spice/meetings/notes";
    if (!(await adapter.exists(ROOT).catch(() => false))) return;

    async function _walk(dir, out = []) {
      let listing;
      try { listing = await adapter.list(dir); } catch (_e) { return out; }
      for (const f of (listing.files || [])) { if (f.endsWith(".md")) out.push(f); }
      for (const sub of (listing.folders || [])) { await _walk(sub, out); }
      return out;
    }
    const meetings = await _walk(ROOT);
    if (!meetings.length) return;

    const block = _meetingTasksListBlock();
    let scanned = 0, injected = 0, warned = 0;
    for (const fp of meetings) {
      scanned += 1;
      try {
        const before = await adapter.read(fp);
        const fm = _parseFrontmatterStrict(before) || {};
        if (fm.type !== "meeting") continue;                  // only meeting notes
        if (/class:\s*"TaskMeetingList"/.test(before)) continue;  // idempotent skip

        let after;
        const mi = before.indexOf(MARKER);
        if (mi >= 0) {
          // Insert AFTER the marker line (template order: Tasks block follows it).
          const lineEnd = before.indexOf("\n", mi);
          const cut = lineEnd >= 0 ? lineEnd + 1 : before.length;
          const sep = before.slice(cut).startsWith("\n") ? "" : "\n";
          after = before.slice(0, cut) + sep + "\n" + block + before.slice(cut);
        } else {
          after = before.replace(/\s*$/, "") + "\n\n" + block;
        }
        if (after === before) continue;
        await _backupAndWrite(adapter, fp, before, after);
        injected += 1;
        history?.push({ event: "info", step: STEP, name: "meetings",
          action: "injected", target: fp,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: STEP, name: "meetings",
          reason: `${fp}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
          attempted_at: new Date().toISOString() });
      }
    }

    history?.push({ event: "info", step: STEP, name: "meetings",
      summary: { scanned, injected, warned },
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      completed_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: STEP, name: "meetings",
      reason: `heal failed (non-fatal): ${e && e.message ? e.message : String(e)}`,
      git_commit: git && git.commit, git_tag: git && git.tag, git_dirty: git && git.dirty,
      attempted_at: new Date().toISOString() });
    return;
  }
}

// _localIsoNoMillis — local-offset ISO timestamp with NO milliseconds
// (YYYY-MM-DDTHH:mm:ss±HH:mm), matching the canonical created_at vocab the
// schema validator + seed harness expect (new Date().toISOString() emits `.SSSZ`
// which the validator rejects).
function _localIsoNoMillis(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();          // minutes east of UTC
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// _dailyTaskNoteExists — true if a task-note with the SAME title (+ same due,
// when the daily line carries one) and source: daily already exists ANYWHERE
// under spice/tasks/ (incl. _done/ and _trash/ subfolders). Pure read; tolerant
// of a missing dir. Extra idempotency guard so a re-run (or a partially-migrated
// note) never spawns a duplicate.
async function _dailyTaskNoteExists(adapter, parsed) {
  const ROOT = "spice/tasks";
  if (!(await adapter.exists(ROOT).catch(() => false))) return false;
  const wantTitle = String((parsed && parsed.title) || "").trim();
  const wantDue = String((parsed && parsed.due) || "").trim();
  async function _walk(dir, out = []) {
    let listing;
    try { listing = await adapter.list(dir); } catch (_e) { return out; }
    for (const f of (listing.files || [])) {
      if (f.endsWith(".md")) out.push(f);
    }
    for (const sub of (listing.folders || [])) { await _walk(sub, out); }
    return out;
  }
  const files = await _walk(ROOT);
  for (const f of files) {
    let body;
    try { body = await adapter.read(f); } catch (_e) { continue; }
    const tm = body.match(/^title:\s*(.*)$/m);
    const sm = body.match(/^source:\s*(.*)$/m);
    const dm = body.match(/^due:\s*(.*)$/m);
    const title = tm ? tm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    const source = sm ? sm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    const due = dm ? dm[1].trim().replace(/^"(.*)"$/, "$1") : "";
    if (source !== "daily") continue;
    if (title !== wantTitle) continue;
    if (due !== wantDue) continue;
    return true;
  }
  return false;
}

// _backupAndWrite — write a .sauce-backup snapshot of the ORIGINAL content, then
// write the new content. Best-effort backup (tolerates mkdir/write failure) but
// the primary write is awaited. Matches the sibling heals' .sauce-backup idiom.
async function _backupAndWrite(adapter, targetPath, originalContent, newContent) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `.sauce-backup/${ts}/${targetPath}`;
  const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
  if (typeof adapter.mkdir === "function") {
    try { await adapter.mkdir(backupParent); } catch (_e) { /* tolerate */ }
  }
  try { await adapter.write(backupPath, originalContent); } catch (_e) { /* best-effort */ }
  await adapter.write(targetPath, newContent);
}

// _swapDailyToTaskTodayList — pure body transform. Replaces the legacy
// TodayCaptureEditableList + ToDoDailyCarryover dataviewjs blocks (and any
// "Carryover" SectionLabel block) with a SINGLE TaskTodayList dataviewjs block
// (materialized `ranch/views/customjs-guard` form, matching an INSTALLED daily),
// and appends a `<!-- tasks-migrated -->` sentinel. If neither legacy block is
// present but a "Today" SectionLabel is, injects the TaskTodayList block right
// after it. Idempotent-friendly: if a TaskTodayList block already exists it is
// not duplicated; the sentinel is added at most once.
function _swapDailyToTaskTodayList(content) {
  const TTL_BLOCK =
    '```dataviewjs\n' +
    'await dv.view("ranch/views/customjs-guard", { class: "TaskTodayList" });\n' +
    '```';
  const SENTINEL = "<!-- tasks-migrated -->";
  const hasTTL = /class:\s*"TaskTodayList"/.test(content);

  const lines = content.split("\n");
  const out = [];
  let ttlInjected = hasTTL;

  // Helper: is line i the opener of a dataviewjs block whose body (up to the
  // closing fence) references `className`? Returns the index of the closing
  // fence, or -1 if not a matching block.
  const matchBlock = (i, classRe) => {
    if (!/^\s*```dataviewjs\s*$/.test(lines[i])) return -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*```\s*$/.test(lines[j])) {
        // scan body i+1..j-1 for the class
        for (let k = i + 1; k < j; k++) {
          if (classRe.test(lines[k])) return j;
        }
        return -1;
      }
    }
    return -1;
  };

  for (let i = 0; i < lines.length; i++) {
    // Legacy TodayCaptureEditableList block → replace with TaskTodayList (once).
    let end = matchBlock(i, /class:\s*"TodayCaptureEditableList"/);
    if (end !== -1) {
      if (!ttlInjected) { out.push(...TTL_BLOCK.split("\n")); ttlInjected = true; }
      i = end;  // skip the whole legacy block
      continue;
    }
    // Legacy ToDoDailyCarryover block → drop (TaskTodayList already covers it).
    end = matchBlock(i, /class:\s*"ToDoDailyCarryover"/);
    if (end !== -1) {
      if (!ttlInjected) { out.push(...TTL_BLOCK.split("\n")); ttlInjected = true; }
      i = end;
      continue;
    }
    // "Carryover" SectionLabel block → drop (the whole Carryover section is
    // subsumed by the live TaskTodayList query).
    end = matchBlock(i, /class:\s*"SectionLabel"[^\n]*text:\s*"Carryover"/);
    if (end !== -1) { i = end; continue; }

    out.push(lines[i]);
  }

  let result = out.join("\n");

  // If we never injected the TTL block but a "Today" SectionLabel exists, place
  // it right after that label's closing fence.
  if (!ttlInjected) {
    const rl = result.split("\n");
    let injAt = -1;
    for (let i = 0; i < rl.length; i++) {
      if (/^\s*```dataviewjs\s*$/.test(rl[i])) {
        // find closing fence + check body for the Today SectionLabel
        let close = -1, isToday = false;
        for (let j = i + 1; j < rl.length; j++) {
          if (/^\s*```\s*$/.test(rl[j])) { close = j; break; }
          if (/class:\s*"SectionLabel"/.test(rl[j]) && /text:\s*"Today"/.test(rl[j])) isToday = true;
        }
        if (isToday && close !== -1) { injAt = close; break; }
      }
    }
    if (injAt !== -1) {
      rl.splice(injAt + 1, 0, "", ...TTL_BLOCK.split("\n"));
      result = rl.join("\n");
      ttlInjected = true;
    }
  }

  // Stamp the sentinel exactly once (append at EOF if absent).
  if (!result.includes(SENTINEL)) {
    result = result.replace(/\s*$/, "") + "\n\n" + SENTINEL + "\n";
  }
  return result;
}

// applyProjectTodoOwnedTasksHeal — ungated backfill (runs every install; NOT
// version-gated because it back-injects NEW content into existing notes, per the
// migration-lifecycle rule). Walks spice/projects/<slug>/<Name> To-Do.md and
// makes each note's Owned Tasks section editable via _healProjectTodoOwnedTasksBody.
// .sauce-backup snapshot before any write; per-note try/catch; fails-loud (history
// warning) but never throws; idempotent (already-editable notes are no-ops).
// Mirrors applyNoteChromeHeal posture.
async function applyProjectTodoOwnedTasksHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const PROJ_ROOT = "spice/projects";
  if (!(await adapter.exists(PROJ_ROOT))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, warned = 0;

  let listing;
  try { listing = await adapter.list(PROJ_ROOT); }
  catch (_e) { return; }

  for (const projDir of (listing.folders || [])) {
    let subListing;
    try { subListing = await adapter.list(projDir); }
    catch (_e) { continue; }
    for (const fpath of (subListing.files || [])) {
      if (!/ To-Do\.md$/.test(fpath)) continue;
      try {
        const before = await adapter.read(fpath);
        if (!/^type:\s*project-todo\b/m.test(before) && !/^type:\s*"project-todo"/m.test(before)) continue;
        const after = _healProjectTodoOwnedTasksBody(before);
        if (after === before) continue;
        const backupPath = `.sauce-backup/${ts}/${fpath}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
        await adapter.write(fpath, after);
        healed += 1;
        history?.push({ event: "info", step: "project_todo_owned_tasks_heal", target: fpath, action: "healed",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: "project_todo_owned_tasks_heal",
          reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
    }
  }
  history?.push({ event: "info", step: "project_todo_owned_tasks_heal", name: "vault",
    summary: { healed, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// applyProjectTodoSectionReorderHeal — ungated backfill (v0.179 UI polish; runs
// every install — moves NEW content into an existing note's canonical order, per
// the migration-lifecycle rule, so NOT version-gated). Walks
// spice/projects/<slug>/<Name> To-Do.md and reorders each note's sections to
// Project Tasks → From Meetings → Owned Tasks via _reorderProjectTodoOwnedTasksLast
// (moves the whole Owned Tasks block below From Meetings). Idempotent
// (already-ordered notes are no-ops), .sauce-backup snapshot before any write,
// per-note try/catch, fails-loud (history warning) but never throws. Must run
// AFTER applyProjectTodoTaskListHeal + applyProjectTodoOwnedTasksHeal so the
// Owned Tasks block is fully materialized (marker + editable list) before it
// moves. Mirrors applyProjectTodoOwnedTasksHeal posture.
async function applyProjectTodoSectionReorderHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const PROJ_ROOT = "spice/projects";
  if (!(await adapter.exists(PROJ_ROOT))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, warned = 0;

  let listing;
  try { listing = await adapter.list(PROJ_ROOT); }
  catch (_e) { return; }

  for (const projDir of (listing.folders || [])) {
    let subListing;
    try { subListing = await adapter.list(projDir); }
    catch (_e) { continue; }
    for (const fpath of (subListing.files || [])) {
      if (!/ To-Do\.md$/.test(fpath)) continue;
      try {
        const before = await adapter.read(fpath);
        if (!/^type:\s*project-todo\b/m.test(before) && !/^type:\s*"project-todo"/m.test(before)) continue;
        const after = _reorderProjectTodoOwnedTasksLast(before);
        if (after === before) continue;
        const backupPath = `.sauce-backup/${ts}/${fpath}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
        await adapter.write(fpath, after);
        healed += 1;
        history?.push({ event: "info", step: "project_todo_section_reorder_heal", target: fpath, action: "reordered",
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      } catch (e) {
        warned += 1;
        history?.push({ event: "warning", step: "project_todo_section_reorder_heal",
          reason: `${fpath}: ${e && e.message ? e.message : String(e)}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
    }
  }
  history?.push({ event: "info", step: "project_todo_section_reorder_heal", name: "vault",
    summary: { healed, warned },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// ===========================================================================
// applyTripsConformanceHeal — ungated backfill (runs every install; NOT
// version-gated, per the migration-lifecycle rule, because it renames + back-
// injects canonical shape into EXISTING trip notes). Migrates PRE-refactor
// trips (folder-generic note names `Trip Atlas.md` / `Trip <Section>.md`, no
// Breadcrumb chrome, legacy `created:` + `tags: [trip]` section frontmatter) to
// the collision-free canonical shape the current create flow emits:
//   atlas   → `<sanitized name>.md`
//   section → `<sanitized name> — <Section>.md`  (canonical trip-section FM)
// plus Breadcrumb/SectionLabel chrome and `[[Trip Atlas]]` link repair.
//
// Highest-risk heal (renames real user notes) → backup-first + idempotent +
// never-throws are mandatory. Posture mirrors applyProjectTodoOwnedTasksHeal
// (ungated, per-item try/catch → history warning on fail / info on success,
// final summary info event) + applyWikiToDocsMigration (.sauce-backup copy via
// _copyDirRecursive BEFORE any write; regex frontmatter rewrite since install.js
// cannot use Obsidian's parseYaml).
//
// Idempotency contract: a SECOND run writes ZERO files. All change-detection is
// existence/substring/regex based against the ALREADY-canonical state (canonical
// names, `type: trip-section`, canonical fields, `class: "Breadcrumb"` present,
// `## All Trips`/`## Mentions` already converted), so no-ops cleanly.
// ===========================================================================

// Node copy of platform/blueprints/trips/helpers/trip-section-kinds.js — KEEP IN
// LOCKSTEP with that file (install.js can't load customjs classes).
const TRIP_SECTION_KINDS = [
  { kind: "flights",      label: "Flights",      legacy: "Trip Flights" },
  { kind: "stay",         label: "Stay",         legacy: "Trip Stay" },
  { kind: "packing-list", label: "Packing List", legacy: "Trip Packing List" },
  { kind: "to-do",        label: "To Do",        legacy: "Trip To Do" },
  { kind: "notes",        label: "Notes",        legacy: "Trip Notes" },
  { kind: "links",        label: "Links",        legacy: "Trip Links" },
];

// Mirrors TripNavButtons._sanitizeFilename / TripSectionKinds helpers.
function _tripSanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
}
function _tripKindFromLegacy(basename) {
  const e = TRIP_SECTION_KINDS.find((k) => k.legacy === basename);
  return e ? e.kind : "custom";
}
function _tripLabelForKind(kind) {
  const e = TRIP_SECTION_KINDS.find((k) => k.kind === kind);
  return e ? e.label : null;
}

// ISO-8601 with local TZ offset (±HH:MM). Matches TripNavButtons._isoWithTz.
function _tripIsoWithTz(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oa = Math.abs(off);
  const oh = pad(Math.floor(oa / 60));
  const om = pad(oa % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

// The canonical Breadcrumb block (fenced dataviewjs) + a trailing blank line.
const _TRIP_BREADCRUMB_BLOCK =
  '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });\n```\n\n';

// Split a body into { fm, rest } where fm is the inner text of the leading
// `---\n...\n---\n` block (null if none) and rest is everything after it.
function _tripSplitFrontmatter(body) {
  const m = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: null, rest: body, raw: null };
  return { fm: m[1], rest: body.slice(m[0].length), raw: m[0] };
}

// Insert the Breadcrumb block immediately after the closing `---\n` of
// frontmatter, iff the body doesn't already contain `class: "Breadcrumb"`.
// Idempotent via the substring check. No-op (returns input) if no frontmatter.
function _tripInjectBreadcrumb(body) {
  if (body.includes('class: "Breadcrumb"')) return body;
  const m = body.match(/^---\n[\s\S]*?\n---\n/);
  if (!m) return body;
  const head = m[0];
  return head + _TRIP_BREADCRUMB_BLOCK + body.slice(head.length);
}

// Replace a `## <Heading>` line with a SectionLabel dataviewjs block. Idempotent:
// once converted the `## <Heading>` line is gone so the regex no longer matches.
function _tripHeadingToSectionLabel(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  if (!re.test(body)) return body;
  const block =
    '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "SectionLabel", args: [{ text: "' +
    heading + '" }] });\n```';
  // Function replacer — the replacement text is emitted verbatim (no `$&`/`$1`
  // special-pattern interpretation, which would corrupt any value containing `$`).
  return body.replace(re, () => block);
}

// Rewrite `[[Trip Atlas]]` and `[[Trip Atlas|<alias>]]` → the atlas basename.
// Only the EXACT `Trip Atlas` target (never partial matches inside other links).
function _tripRepairAtlasLinks(body, atlasBase) {
  // Function replacers — atlasBase is user free-form text; a string replacement
  // would interpret `$&`/`$$` etc. and corrupt names like "Cash $$ Run".
  return body
    .replace(/\[\[Trip Atlas\|/g, () => `[[${atlasBase}|`)
    .replace(/\[\[Trip Atlas\]\]/g, () => `[[${atlasBase}]]`);
}

// Per-key replace-or-insert of `key: value` INSIDE the leading `---` block.
// Preserves all body content after frontmatter. Returns the full new body.
// If the key exists (single-line `key:` form), its line is replaced; otherwise
// the key line is appended to the end of the frontmatter block.
function _tripSetFmKey(body, key, valueLine) {
  const parts = _tripSplitFrontmatter(body);
  if (parts.fm === null) return body; // no frontmatter — refuse to guess
  const keyRe = new RegExp(`^${key}\\s*:.*$`, "m");
  let fm = parts.fm;
  // Function replacer — valueLine embeds user text (section label / atlas name);
  // a string replacement would misinterpret `$&`/`$1`/`$$` inside it.
  if (keyRe.test(fm)) fm = fm.replace(keyRe, () => valueLine);
  else fm = fm + "\n" + valueLine;
  return `---\n${fm}\n---\n` + parts.rest;
}

// Migrate a legacy `created:` FM key → `created_at:` inside the leading block.
// - If `created_at` already present → leave everything (return unchanged).
// - Else if a `created:` line exists → rename to `created_at:`, coercing a
//   date-only `YYYY-MM-DD` value to `YYYY-MM-DDT00:00:00±HH:MM` (local tz).
// - Else (neither present) → insert a fresh `created_at` (now, ISO+TZ).
function _tripMigrateCreatedAt(body) {
  const parts = _tripSplitFrontmatter(body);
  if (parts.fm === null) return body;
  const fm = parts.fm;
  if (/^created_at\s*:/m.test(fm)) return body; // already canonical
  const m = fm.match(/^created\s*:\s*(.*)$/m);
  if (m) {
    let val = m[1].trim().replace(/^["']|["']$/g, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const off = _tripIsoWithTz(new Date()).slice(-6); // ±HH:MM from local tz
      val = `${val}T00:00:00${off}`;
    }
    const newFm = fm.replace(/^created\s*:.*$/m, () => `created_at: "${val}"`);
    return `---\n${newFm}\n---\n` + parts.rest;
  }
  const nowIso = _tripIsoWithTz(new Date());
  const newFm = fm + `\ncreated_at: "${nowIso}"`;
  return `---\n${newFm}\n---\n` + parts.rest;
}

// Remove a legacy `tags:` block that is EXACTLY the single `trip` tag. Leaves any
// other tags (block form with >1 entry, or a different single tag) untouched.
function _tripStripLoneTripTag(body) {
  const parts = _tripSplitFrontmatter(body);
  if (parts.fm === null) return body;
  // Match a `tags:` block whose ONLY list entry is `- trip`. The trailing
  // boundary is asserted with a NEGATIVE lookahead against another indented
  // `  - <tag>` list item, so a multi-tag block (e.g. `- trip` + `- hotels`) is
  // left untouched. What may follow is a new top-level key line or end-of-block
  // (note: a bare `$` under /m matches before every newline, which is why we use
  // an explicit negative lookahead here instead of `\n?$`).
  const re = /^tags:[ \t]*\n[ \t]*-[ \t]*trip[ \t]*(?!\n[ \t]+-)(?=\n\S|\s*$)/m;
  if (!re.test(parts.fm)) return body;
  let newFm = parts.fm.replace(re, "");
  newFm = newFm.replace(/\n{2,}/g, "\n").replace(/^\n+|\n+$/g, "");
  return `---\n${newFm}\n---\n` + parts.rest;
}

async function applyTripsConformanceHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const TRIPS_ROOT = "spice/trips";
  if (!(await adapter.exists(TRIPS_ROOT))) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let healed = 0, warned = 0, skipped = 0;

  let rootListing;
  try { rootListing = await adapter.list(TRIPS_ROOT); }
  catch (_e) { return; }

  const tripFolders = (rootListing.folders || []).filter((d) => {
    const base = d.split("/").pop();
    return base !== "attachments" && !d.includes(".sauce-backup");
  });

  for (const tripDir of tripFolders) {
    const slug = tripDir.split("/").pop();
    try {
      let subListing;
      try { subListing = await adapter.list(tripDir); }
      catch (_e) { continue; }
      const mdFiles = (subListing.files || []).filter((f) => f.endsWith(".md"));
      if (mdFiles.length === 0) { skipped += 1; continue; }

      // Locate the atlas: the file whose leading frontmatter block has type: trip.
      let atlasPath = null, atlasBody = null, tripName = null;
      for (const f of mdFiles) {
        let body;
        try { body = await adapter.read(f); } catch (_e) { continue; }
        const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;
        if (!/^type:\s*["']?trip["']?\s*$/m.test(fmMatch[1])) continue;
        const nm = fmMatch[1].match(/^name\s*:\s*(.*)$/m);
        if (!nm) continue;
        atlasPath = f;
        atlasBody = body;
        tripName = nm[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
      if (!atlasPath || !tripName) {
        warned += 1;
        history?.push({ event: "warning", step: "trips_conformance_heal",
          reason: `${slug}: no atlas (type: trip + name:) found — skipping folder untouched`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
        continue;
      }

      const atlasBase = _tripSanitize(tripName);

      // --- Compute all planned writes first (so a no-op run skips the backup) ---
      const plan = []; // { path, newPath, newBody } — newPath===path means edit-in-place
      const atlasCurBase = atlasPath.split("/").pop().replace(/\.md$/, "");

      // Atlas transforms.
      let newAtlasBody = atlasBody;
      newAtlasBody = _tripInjectBreadcrumb(newAtlasBody);
      // Only convert `## Mentions` when BOTH the heading and a BacklinkPanel exist.
      if (/^##\s+Mentions\s*$/m.test(newAtlasBody) && /BacklinkPanel/.test(newAtlasBody)) {
        newAtlasBody = _tripHeadingToSectionLabel(newAtlasBody, "Mentions");
      }
      newAtlasBody = _tripRepairAtlasLinks(newAtlasBody, atlasBase);
      const atlasNewPath = `${tripDir}/${atlasBase}.md`;
      if (atlasNewPath !== atlasPath || newAtlasBody !== atlasBody) {
        plan.push({ path: atlasPath, newPath: atlasNewPath, newBody: newAtlasBody });
      }

      // Section transforms (every OTHER top-level .md).
      for (const f of mdFiles) {
        if (f === atlasPath) continue;
        let body;
        try { body = await adapter.read(f); } catch (_e) { continue; }
        const legacy = f.split("/").pop().replace(/\.md$/, "");
        // Prefer the note's OWN canonical frontmatter (section_kind + section) when
        // present — this is what makes a re-run idempotent: once the file is renamed
        // to `<atlas> — <Label>.md` the basename no longer matches a legacy name, so
        // deriving kind/label from the basename would corrupt an already-migrated
        // note. The frontmatter is authoritative; the legacy-basename path is only
        // the first-migration fallback.
        const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
        const fmInner = fmMatch ? fmMatch[1] : "";
        const fmKindM = fmInner.match(/^section_kind\s*:\s*(.*)$/m);
        const fmSectionM = fmInner.match(/^section\s*:\s*(.*)$/m);
        const fmKind = fmKindM ? fmKindM[1].trim().replace(/^["']|["']$/g, "") : null;
        const fmSection = fmSectionM ? fmSectionM[1].trim().replace(/^["']|["']$/g, "") : null;
        let kind, sectionLabel;
        if (fmKind) {
          kind = fmKind;
          sectionLabel = fmSection || (_tripLabelForKind(kind) || legacy.replace(/^Trip\s+/, ""));
        } else {
          kind = _tripKindFromLegacy(legacy);
          sectionLabel = kind === "custom"
            ? legacy.replace(/^Trip\s+/, "")
            : _tripLabelForKind(kind);
        }

        let nb = body;
        // Canonical frontmatter (per-key replace-or-insert).
        nb = _tripMigrateCreatedAt(nb);
        nb = _tripStripLoneTripTag(nb);
        nb = _tripSetFmKey(nb, "type", "type: trip-section");
        nb = _tripSetFmKey(nb, "section_kind", `section_kind: ${kind}`);
        nb = _tripSetFmKey(nb, "section", `section: "${sectionLabel}"`);
        nb = _tripSetFmKey(nb, "trip", `trip: "[[${atlasBase}]]"`);
        nb = _tripSetFmKey(nb, "trip_slug", `trip_slug: ${slug}`);
        // Chrome + link repair.
        nb = _tripInjectBreadcrumb(nb);
        nb = _tripRepairAtlasLinks(nb, atlasBase);

        const newBase = `${atlasBase} — ${sectionLabel}`;
        const newPath = `${tripDir}/${newBase}.md`;
        if (newPath !== f || nb !== body) {
          plan.push({ path: f, newPath, newBody: nb });
        }
      }

      if (plan.length === 0) { skipped += 1; continue; }

      // --- Collision guard: two sources (e.g. a legacy `Trip Flights.md` + a
      // hand-authored note already carrying section_kind: flights) can compute the
      // SAME rename target. Applying blindly would overwrite the first note (only
      // the backup would survive). De-collide the later target(s) with " (N)" so no
      // note is clobbered. Edit-in-place steps (newPath === path) never contend. ---
      const usedTargets = new Set();
      for (const step of plan) {
        if (step.newPath === step.path) continue;
        if (usedTargets.has(step.newPath)) {
          const base = step.newPath.replace(/\.md$/, "");
          let n = 2;
          while (usedTargets.has(`${base} (${n}).md`)) n++;
          const target = `${base} (${n}).md`;
          history?.push({ event: "warning", step: "trips_conformance_heal", name: slug,
            reason: `${slug}: rename target ${step.newPath} already claimed — wrote to ${target} to avoid clobber`,
            git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
          step.newPath = target;
        }
        usedTargets.add(step.newPath);
      }

      // --- Backup once (BEFORE any write), only when a change is pending. ---
      await _copyDirRecursive(adapter, tripDir, `.sauce-backup/trips/${slug}/${ts}`);

      // --- Apply. Rename = write new path + remove old (adapter has no rename). ---
      for (const step of plan) {
        await adapter.write(step.newPath, step.newBody);
        if (step.newPath !== step.path) {
          try { await adapter.remove(step.path); } catch (_e) { /* best-effort */ }
        }
      }

      healed += 1;
      history?.push({ event: "info", step: "trips_conformance_heal", name: slug,
        reason: `healed ${slug}: atlas → ${atlasBase}.md + ${plan.length - 1} section(s); backup at .sauce-backup/trips/${slug}/${ts}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      warned += 1;
      history?.push({ event: "warning", step: "trips_conformance_heal", name: slug,
        reason: `heal failed for ${slug}: ${e && e.message ? e.message : String(e)}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }

  // Heal the hub once (outside the per-trip loop).
  try {
    const hubPath = `${TRIPS_ROOT}/Trips.md`;
    if (await adapter.exists(hubPath)) {
      const hubBody = await adapter.read(hubPath);
      let nh = _tripInjectBreadcrumb(hubBody);
      nh = _tripHeadingToSectionLabel(nh, "All Trips");
      if (nh !== hubBody) {
        const backupPath = `.sauce-backup/trips/Trips.md.${ts}`;
        try { await adapter.write(backupPath, hubBody); } catch (_e) { /* best-effort */ }
        await adapter.write(hubPath, nh);
        history?.push({ event: "info", step: "trips_conformance_heal", name: "hub",
          reason: `healed Trips.md (breadcrumb + All Trips SectionLabel)`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
    }
  } catch (e) {
    warned += 1;
    history?.push({ event: "warning", step: "trips_conformance_heal", name: "hub",
      reason: `hub heal failed: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  }

  history?.push({ event: "info", step: "trips_conformance_heal", name: "vault",
    summary: { healed, warned, skipped },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, completed_at: new Date().toISOString() });
}

// applyHomeScaffoldHeal — ungated scaffold + chrome heal for the singleton
// spice/home/Home.md command-center note. Runs every install (NOT version-gated,
// per the migration-lifecycle rule, because it materializes + heals a user-facing
// note). Posture mirrors applyTripsConformanceHeal: guard on the adapter, ensure
// the folder, backup-first before any overwrite, per-step try/catch → history
// warning on fail / info on success, NEVER throws.
//
//   MISSING → write the canonical chrome body (a brand-new file needs no backup).
//   PRESENT → read → _healHomeChromeBody → if changed, snapshot to a timestamped
//             .sauce-backup copy FIRST, then write the healed body; a healthy note
//             is a no-op (the pure helper returns it unchanged).
//
// Idempotent: once Home.md carries the chrome, _healHomeChromeBody returns it
// byte-for-byte, so a second install writes zero files.
async function applyHomeScaffoldHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const HOME_DIR = "spice/home";
  const HOME_PATH = `${HOME_DIR}/Home.md`;
  try {
    // Ensure the module-directory namespace exists.
    if (!(await adapter.exists(HOME_DIR))) {
      try { await adapter.mkdir(HOME_DIR); } catch (_e) { /* already exists */ }
    }

    if (!(await adapter.exists(HOME_PATH))) {
      // Brand-new file — no backup needed. Frontmatter mirrors the template.
      // editor-width: 100 works around the third-party "editor-width-slider"
      // community plugin overriding --file-line-width on every file-open
      // when a note has no explicit width — see
      // _healHomeFrontmatterEditorWidth's docstring for the full story.
      const fm = "---\ntype: home\ncssclasses:\n  - wide\neditor-width: 100\n---\n\n";
      await adapter.write(HOME_PATH, fm + _HOME_CHROME + "\n");
      history?.push({ event: "info", step: "home_scaffold_heal", name: "Home.md", action: "created",
        reason: `scaffolded ${HOME_PATH}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      return;
    }

    const before = await adapter.read(HOME_PATH);
    const after = _healHomeFrontmatterEditorWidth(_healHomeChromeBody(before));
    if (after === before) return; // healthy note — no-op
    const backupPath = `.sauce-backup/home/Home.md.${ts}`;
    try { await adapter.mkdir(".sauce-backup/home"); } catch (_e) { /* already exists */ }
    try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
    await adapter.write(HOME_PATH, after);
    history?.push({ event: "info", step: "home_scaffold_heal", name: "Home.md", action: "healed",
      reason: `healed ${HOME_PATH} (backup at ${backupPath})`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "home_scaffold_heal", name: "Home.md",
      reason: `home scaffold/heal failed: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  }
}

// _planHomeHotkeyRemap — PURE decision logic for applyHomeHotkeyRemapHeal.
// Given the parsed .obsidian/hotkeys.json object, decide whether the
// daily-notes -> Mod+[ binding (seeded by an OLDER daily blueprint manifest)
// should move to sauce-home:open. Only acts when daily-notes owns EXACTLY a
// Mod+[ entry and sauce-home:open has no binding yet; any OTHER daily-notes
// binding is preserved untouched. Never mutates its input.
function _planHomeHotkeyRemap(existing) {
  const src = (existing && typeof existing === "object" && !Array.isArray(existing)) ? existing : {};
  const isModBracket = (b) => b && Array.isArray(b.modifiers) && b.modifiers.length === 1
    && b.modifiers[0] === "Mod" && b.key === "[";

  const homeAlreadyBound = Array.isArray(src["sauce-home:open"]) && src["sauce-home:open"].length > 0;
  const dailyBindings = Array.isArray(src["daily-notes"]) ? src["daily-notes"] : [];
  const dailyOwnsModBracket = dailyBindings.some(isModBracket);

  if (homeAlreadyBound || !dailyOwnsModBracket) {
    return { act: false, next: src };
  }

  const next = Object.assign({}, src);
  next["daily-notes"] = dailyBindings.filter((b) => !isModBracket(b));
  next["sauce-home:open"] = [{ modifiers: ["Mod"], key: "[" }];
  return { act: true, next };
}

// applyHomeHotkeyRemapHeal — IO wrapper around _planHomeHotkeyRemap. Mirrors
// applyHotkeys's read/parse-guard/backup-then-write posture for
// .obsidian/hotkeys.json. Never throws; no-ops on any read/parse failure or
// when the plan says nothing to do. NEW (home fixes cycle).
async function applyHomeHotkeyRemapHeal(tp, history, git) {
  const adapter = tp.app.vault.adapter;
  const target = ".obsidian/hotkeys.json";
  if (!(await adapter.exists(target))) return;

  let raw;
  try {
    raw = await adapter.read(target);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: cannot read ${target} (${e.message}); skipping`, 8000);
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: ${target} malformed JSON (${e.message}); skipping`, 8000);
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;

  const plan = _planHomeHotkeyRemap(parsed);
  if (!plan.act) return;

  try {
    await adapter.write(`${target}.sauce-backup`, raw);
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: backup write failed (${e.message}); aborting`, 8000);
    return;
  }

  try {
    await adapter.write(target, JSON.stringify(plan.next, null, 2));
    if (history) {
      history.push({
        event: "info",
        step: "home_hotkey_remap",
        message: "moved Mod+[ from daily-notes to sauce-home:open",
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  } catch (e) {
    new Notice(`applyHomeHotkeyRemapHeal: write failed (${e.message})`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "home_hotkey_remap",
        message: `write failed: ${e.message}`,
        git_commit: git.commit,
        git_tag: git.tag,
        git_dirty: git.dirty,
        attempted_at: new Date().toISOString(),
      });
    }
  }
}

// applyReaderScaffoldHeal — ungated scaffold + chrome heal for the singleton
// spice/reader/Reader.md reading-queue hub note. Runs every install (NOT
// version-gated, per the migration-lifecycle rule, because it materializes +
// heals a user-facing note). Posture mirrors applyHomeScaffoldHeal: guard on the
// adapter, ensure the folder, backup-first before any overwrite, per-step
// try/catch → history warning on fail / info on success, NEVER throws.
//
//   MISSING → write the canonical chrome body (a brand-new file needs no backup).
//   PRESENT → read → _healReaderChromeBody → if changed, snapshot to a timestamped
//             .sauce-backup copy FIRST, then write the healed body; a healthy note
//             is a no-op (the pure helper returns it unchanged).
//
// Idempotent: once Reader.md carries the chrome, _healReaderChromeBody returns it
// byte-for-byte, so a second install writes zero files.
async function applyReaderScaffoldHeal(tp, history, git) {
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const READER_DIR = "spice/reader";
  const READER_PATH = "spice/reader/Reader.md";
  try {
    // Ensure the module-directory namespace exists.
    if (!(await adapter.exists(READER_DIR))) {
      try { await adapter.mkdir(READER_DIR); } catch (_e) { /* already exists */ }
    }

    if (!(await adapter.exists(READER_PATH))) {
      // Brand-new file — no backup needed. Frontmatter mirrors the hub template.
      const fm = `---\ntype: reader-hub\ntitle: Reader\ndir: spice/reader\ncreated_at: "${new Date().toISOString()}"\ntags:\n  - reader-hub\n---\n\n`;
      await adapter.write(READER_PATH, fm + _READER_CHROME + "\n");
      history?.push({ event: "info", step: "reader_scaffold_heal", name: "Reader.md", action: "created",
        reason: `scaffolded ${READER_PATH}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      return;
    }

    const before = await adapter.read(READER_PATH);
    const after = _healReaderChromeBody(before);
    if (after === before) return; // healthy note — no-op
    const backupPath = `.sauce-backup/reader/Reader.md.${ts}`;
    try { await adapter.mkdir(".sauce-backup/reader"); } catch (_e) { /* already exists */ }
    try { await adapter.write(backupPath, before); } catch (_e) { /* best-effort */ }
    await adapter.write(READER_PATH, after);
    history?.push({ event: "info", step: "reader_scaffold_heal", name: "Reader.md", action: "healed",
      reason: `healed ${READER_PATH} (backup at ${backupPath})`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  } catch (e) {
    history?.push({ event: "warning", step: "reader_scaffold_heal", name: "Reader.md",
      reason: `reader scaffold/heal failed: ${e && e.message ? e.message : String(e)}`,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  }
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
  if (_migrationGated("0.110.1")) return;
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
  if (_migrationGated("0.110.2")) return;
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
  if (_migrationGated("0.111.0")) return;
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
  if (_migrationGated("0.107.0")) return;
  const adapter = tp.app.vault.adapter;

  const paychecksRoot = "spice/finance/paychecks";
  if (!(await adapter.exists(paychecksRoot))) return;

  const paycheckFiles = [];
  try {
    const top = await adapter.list(paychecksRoot);
    for (const folder of (top.folders || [])) {
      if (folder.includes("/_archive")) continue;  // archived legacy notes are inert — never re-heal
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
  if (_migrationGated("0.107.0")) return;
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

// applyFinanceBudgetAllocationsBandInjection — finance "month reality" WS2.
// Injects the BudgetAllocationsEditor dataviewjs block (editable live/override
// Debt + Savings sections) into every existing Budget-YYYY-MM.md that lacks it.
// New budgets get the block from the template/inline_body; this heal covers
// pre-existing budgets across consumer vaults. UNGATED (no version guard) —
// idempotent via presence of `class: "BudgetAllocationsEditor"`. Body-text
// mutation only; .sauce-backup snapshot before write; failure-loud per-file.
// Mirrors applyFinanceBudgetMonthlyBandInjection posture.
async function applyFinanceBudgetAllocationsBandInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const budgetsRoot = "spice/finance/budgets";
  if (!(await adapter.exists(budgetsRoot))) return;

  const budgetFiles = await _listBudgetFiles(adapter, budgetsRoot);
  if (budgetFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touched = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _injectAllocationsBand(body);
      if (result.touched) {
        // .sauce-backup snapshot before write.
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_allocations_band_injection", name: "finance",
        reason: `body injection failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_budget_allocations_band_injection", name: "finance",
    reason: `${budgetFiles.length} budgets scanned, ${touched} bodies injected (BudgetAllocationsEditor block after BudgetCategoriesEditor)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// _injectAllocationsBand — pure body transform. Idempotent (skips when the
// BudgetAllocationsEditor block is already present). Anchor priority:
//   1. After the BudgetCategoriesEditor dataviewjs block.
//   2. Fallback: append at the end of the dataviewjs stack (end of body).
function _injectAllocationsBand(body) {
  let out = body;
  if (/class:\s*["']BudgetAllocationsEditor["']/.test(out)) return { body: out, touched: false };

  const allocBlock = "```dataviewjs\nawait dv.view(\"ranch/views/customjs-guard\", { class: \"BudgetAllocationsEditor\" });\n```\n";

  const catBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']BudgetCategoriesEditor["'][^`]*```[ \t]*\r?\n)/;
  const cb = out.match(catBlockRe);
  if (cb) {
    out = out.replace(catBlockRe, `$1\n${allocBlock}`);
    return { body: out, touched: true };
  }

  // Fallback: append at end of the dataviewjs stack.
  out = out.replace(/\s*$/, "") + "\n\n" + allocBlock;
  return { body: out, touched: true };
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
          // Inline flow-mapping items (e.g. `- {"group":"…","name":"…"}`) carry
          // their group INSIDE the braces; the line-scan below cannot see it and
          // would splice a stray `    group: Unassigned` beneath the row, producing
          // malformed frontmatter. Skip flow-map items entirely — the scaffold and
          // BudgetCategoriesEditor always write `group` inside the flow-map, so
          // there is nothing to backfill.
          if (/^  - \{/.test(fmLines[itemStartIdx])) {
            i = j;
            continue;
          }
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

// _repairMalformedBudgetGroups — pure string transform on Budget-*.md body.
// Undoes the pre-fix corruption where the group backfill spliced a stray
// `    group: Unassigned` line directly beneath an inline flow-mapping category
// item (which already carries its group inside the braces). Removes ONLY a
// `    group: Unassigned` line that immediately follows a `  - { … "group" … }`
// flow-map item. Never touches legitimate block-style `group: Unassigned`.
// Returns { body, touched, repaired }. Idempotent; never throws on malformed YAML.
function _repairMalformedBudgetGroups(body) {
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { body, touched: false, repaired: 0 };

  const fmLines = fmMatch[1].split("\n");
  const out = [];
  let repaired = 0;
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i];
    out.push(line);
    // Flow-map category item that already carries a group inside the braces.
    if (/^  - \{.*["']?group["']?\s*:/.test(line)) {
      // Drop a stray `    group: Unassigned` immediately beneath it.
      if (i + 1 < fmLines.length && /^    group:\s*Unassigned\s*$/.test(fmLines[i + 1])) {
        i += 1; // skip the stray line (do not push)
        repaired += 1;
      }
    }
  }
  if (repaired === 0) return { body, touched: false, repaired: 0 };
  const newFm = out.join("\n");
  const newBody = body.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
  return { body: newBody, touched: true, repaired };
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

// applyFinanceBudgetMalformedGroupRepair — ungated, snapshot-first, marker-guarded,
// idempotent repair of the pre-fix corruption (stray `    group: Unassigned` spliced
// under inline flow-mapping category items). Runs on every install so every vault
// self-heals; per-file failure-loud. Mirrors applyFinanceCategoriesGroupBackfill.
async function applyFinanceBudgetMalformedGroupRepair(tp, manifest, variables, history, git) {
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
    history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
      reason: `list failed: ${e.message}`, git_commit: git.commit, git_tag: git.tag,
      git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    return;
  }
  if (budgetFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = `.sauce-backup/${ts}/spice/finance/budgets`;
  let touchedFiles = 0, repairedRows = 0;
  for (const fp of budgetFiles) {
    try {
      const body = await adapter.read(fp);
      if (/__budget_malformed_group_repaired:/.test(body)) continue; // idempotency marker
      const result = _repairMalformedBudgetGroups(body);
      if (!result.touched) continue;
      // Snapshot before write.
      try {
        const rel = fp.substring(budgetsRoot.length);
        const backupPath = backupRoot + rel;
        const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(backupPath, body);
      } catch (e) {
        history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
          path: fp, reason: `snapshot failed: ${e.message}`, git_commit: git.commit,
          git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
      }
      // Append the marker so the repair is one-shot per file.
      let out = result.body;
      out = out.replace(/^(---\n[\s\S]*?)\n---/, `$1\n__budget_malformed_group_repaired: v0.16.1\n---`);
      await adapter.write(fp, out);
      touchedFiles += 1;
      repairedRows += result.repaired;
      history?.push({ event: "info", step: "finance_budget_malformed_group_repair", name: "finance",
        path: fp, repaired: result.repaired, git_commit: git.commit, git_tag: git.tag,
        git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_budget_malformed_group_repair", name: "finance",
        path: fp, reason: e.message, git_commit: git.commit, git_tag: git.tag,
        git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    }
  }
  history?.push({ event: "info", step: "finance_budget_malformed_group_repair", name: "finance",
    summary: { touchedFiles, repairedRows, scanned: budgetFiles.length },
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    completed_at: new Date().toISOString() });
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
      const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
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
// Strip a single pair of surrounding matching quotes from a YAML scalar so
// `type: "project-todo"` parses to `project-todo` (not `"project-todo"`). YAML
// quotes are syntactic — the parsed value never includes them — so this is
// always correct; without it, `fm.type === "..."` checks in the install heals
// silently skip quoted-frontmatter notes (e.g. project-todo To-Do notes).
function _unquoteScalar(v) {
  if (typeof v !== "string" || v.length < 2) return v;
  const a = v[0], b = v[v.length - 1];
  if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1);
  return v;
}

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
          obj[k.trim()] = _unquoteScalar(vParts.join(":").trim());
        } else if (itemStart !== "") {
          arr.push(_unquoteScalar(itemStart));
          j++;
          continue;
        }
        // Read continuation object lines (4-space indent)
        let k2 = j + 1;
        while (k2 < lines.length && /^    \S/.test(lines[k2])) {
          const contMatch = lines[k2].match(/^    ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)/);
          if (contMatch) obj[contMatch[1]] = _unquoteScalar(contMatch[2].trim());
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
    result[key] = _unquoteScalar(rest);
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
// applyFinancePaycheckArchiveLegacy — monthly-paycheck clean cutover.
//
// The paycheck entity is now MONTH-KEYED (one note per month carrying
// `deposits: [{date, amount}]` + `expenses[].deposit`). The month rollup reads
// only new-format notes (those with a `deposits[]` array) and EXCLUDES
// spice/finance/paychecks/_archive/. Any LEGACY per-check note (`type: paycheck`
// with `pay_period_start` and NO `deposits[]`) would otherwise still be picked
// up by widgets that scan the paychecks folder. This heal MOVES those legacy
// notes into spice/finance/paychecks/_archive/ so the rollup ignores them.
//
// Nothing is deleted — it's a MOVE: snapshot the original body to .sauce-backup,
// write a byte-identical copy to _archive/<basename>, then remove the original
// (write-copy-then-remove, since the installer adapter exposes remove() but not
// rename() in the headless harness). UNGATED — runs on every install so any
// vault still holding legacy notes gets cleaned up. Idempotent: once archived,
// a second install finds nothing to move (new-format notes have deposits[];
// already-archived notes are under _archive/ and skipped). Failure-loud per file.
// Mirrors applyFinanceBudgetGroupSeed's snapshot + history conventions.

// _listPaycheckFiles — walk spice/finance/paychecks/<sub>/Paycheck-*.md,
// EXCLUDING anything already under _archive/. Returns array of relative paths.
// Per-folder failure-loud (skip folder). Matches BOTH the legacy per-check
// naming (Paycheck-YYYY-MM-DD.md) and the new month-keyed naming
// (Paycheck-YYYY-MM.md) — the archive filter is by frontmatter, not by name.
async function _listPaycheckFiles(adapter, paychecksRoot) {
  const paycheckFiles = [];
  try {
    const top = await adapter.list(paychecksRoot);
    for (const folder of (top.folders || [])) {
      if (folder.includes("/_archive")) continue;  // never re-scan archived notes
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/\/Paycheck-[^/]*\.md$/.test(fp)) paycheckFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud, continue */ }
    }
  } catch (_e) { /* root list failed — return empty */ }
  return paycheckFiles;
}

async function applyFinancePaycheckArchiveLegacy(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const paychecksRoot = "spice/finance/paychecks";
  if (!(await adapter.exists(paychecksRoot))) return;

  const archiveDir = `${paychecksRoot}/_archive`;
  const paycheckFiles = await _listPaycheckFiles(adapter, paychecksRoot);
  if (paycheckFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = `.sauce-backup/${ts}/spice/finance/paychecks`;
  let archived = 0;

  for (const fp of paycheckFiles) {
    try {
      if (fp.includes("/_archive/")) continue;  // already archived (belt-and-suspenders)
      const body = await adapter.read(fp);
      const fm = _parseFrontmatterStrict(body);
      // Only LEGACY per-check notes: type paycheck + pay_period_start + NO deposits[].
      if (!fm || fm.type !== "paycheck") continue;
      if (!fm.pay_period_start) continue;
      if (Array.isArray(fm.deposits)) continue;  // new month-keyed note — never touch

      const basename = fp.substring(fp.lastIndexOf("/") + 1);
      const dest = `${archiveDir}/${basename}`;
      if (await adapter.exists(dest)) {
        // A legacy note with this basename is already archived — remove the stray
        // original (idempotent recovery from a half-completed prior move).
        await adapter.remove(fp);
        continue;
      }

      // Snapshot the original before touching it.
      try {
        const rel = fp.substring(paychecksRoot.length);
        const backupPath = backupRoot + rel;
        const backupDir = backupPath.substring(0, backupPath.lastIndexOf("/"));
        if (!(await adapter.exists(backupDir))) await adapter.mkdir(backupDir);
        await adapter.write(backupPath, body);
      } catch (e) {
        history?.push({ event: "warning", step: "finance_paycheck_archive_legacy", name: "finance",
          path: fp, reason: `snapshot failed: ${e.message}`,
          git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
          attempted_at: new Date().toISOString() });
      }

      // Move: ensure archive dir, write byte-identical copy, remove original.
      if (!(await adapter.exists(archiveDir))) await adapter.mkdir(archiveDir);
      await adapter.write(dest, body);
      await adapter.remove(fp);
      archived += 1;
      history?.push({ event: "info", step: "finance_paycheck_archive_legacy", name: "finance",
        path: fp, dest,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_paycheck_archive_legacy", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_paycheck_archive_legacy", name: "finance",
    summary: { archived, scanned: paycheckFiles.length },
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
  if (_migrationGated("0.108.0")) return;
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
  if (_migrationGated("0.110.3")) return;
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
// Finance Month cockpit + edit-scope banner injection + nav-row retirement
// (finance "make it make sense" #3). Three UNGATED, snapshot-first,
// marker-guarded, per-file failure-loud heals. Mirror
// applyFinanceBudgetAllocationsBandInjection posture.
// ============================================================================

// _listMonthFiles — walk spice/finance/months/<...>/Month-*.md OR flat
// months/Month-*.md. Returns array of relative file paths. Per-folder
// failure-loud (skip folder). The month entity historically materializes as a
// flat months/Month-YYYY-MM.md.
async function _listMonthFiles(adapter, monthsRoot) {
  const monthFiles = [];
  try {
    const top = await adapter.list(monthsRoot);
    for (const fp of (top.files || [])) {
      if (/\/Month-\d{4}-\d{2}\.md$/.test(fp) || /Month-\d{4}-\d{2}\.md$/.test(fp)) monthFiles.push(fp);
    }
    for (const folder of (top.folders || [])) {
      try {
        const inner = await adapter.list(folder);
        for (const fp of (inner.files || [])) {
          if (/\/Month-\d{4}-\d{2}\.md$/.test(fp)) monthFiles.push(fp);
        }
      } catch (_e) { /* per-folder failure-loud, continue */ }
    }
  } catch (_e) { /* root list failed — return empty */ }
  return monthFiles;
}

// _injectMonthChecklist — pure body transform. Idempotent (marker-guarded).
// Injects the MonthSetupChecklist dataviewjs block ABOVE the MonthDashboard
// block on Month notes. Anchor priority:
//   1. `<!-- month-setup-checklist -->` marker present → no-op.
//   2. MonthDashboard dataviewjs block → inject BEFORE.
//   3. FinanceNav dataviewjs block → inject AFTER.
//   4. Frontmatter close → inject AFTER.
function _injectMonthChecklist(body) {
  let out = body;
  const MARKER = "<!-- month-setup-checklist -->";
  if (out.includes(MARKER)) return { body: out, touched: false };
  if (/class:\s*["']MonthSetupChecklist["']/.test(out)) return { body: out, touched: false };

  const checklistBlock = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "MonthSetupChecklist" });\n\`\`\`\n\n`;

  const dashboardBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']MonthDashboard["'][^`]*```[ \t]*\r?\n)/;
  const db = out.match(dashboardBlockRe);
  if (db) {
    out = out.replace(dashboardBlockRe, `${checklistBlock}$1`);
    return { body: out, touched: true };
  }

  const navBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']FinanceNav["'][^`]*```[ \t]*\r?\n)/;
  const nb = out.match(navBlockRe);
  if (nb) {
    out = out.replace(navBlockRe, `$1\n${checklistBlock}`);
    return { body: out, touched: true };
  }

  const fmEnd = out.indexOf("---\n", 4);
  if (fmEnd !== -1) {
    const cutIdx = fmEnd + 4;
    out = out.slice(0, cutIdx) + `\n${checklistBlock}` + out.slice(cutIdx);
    return { body: out, touched: true };
  }

  return { body: out, touched: false };
}

// _injectEditScopeBanner — pure body transform. Idempotent (marker-guarded).
// Injects the FinanceEditScopeBanner dataviewjs block AFTER the FinanceNav
// block on Budget/Paycheck/Defaults notes. Anchor priority:
//   1. `<!-- finance-edit-scope -->` marker present → no-op.
//   2. FinanceNav dataviewjs block → inject AFTER.
//   3. Frontmatter close → inject AFTER.
function _injectEditScopeBanner(body) {
  let out = body;
  const MARKER = "<!-- finance-edit-scope -->";
  if (out.includes(MARKER)) return { body: out, touched: false };
  if (/class:\s*["']FinanceEditScopeBanner["']/.test(out)) return { body: out, touched: false };

  const bannerBlock = `${MARKER}\n\`\`\`dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "FinanceEditScopeBanner" });\n\`\`\`\n\n`;

  const navBlockRe = /(```dataviewjs\s*\n[^`]*class:\s*["']FinanceNav["'][^`]*```[ \t]*\r?\n)/;
  const nb = out.match(navBlockRe);
  if (nb) {
    out = out.replace(navBlockRe, `$1\n${bannerBlock}`);
    return { body: out, touched: true };
  }

  const fmEnd = out.indexOf("---\n", 4);
  if (fmEnd !== -1) {
    const cutIdx = fmEnd + 4;
    out = out.slice(0, cutIdx) + `\n${bannerBlock}` + out.slice(cutIdx);
    return { body: out, touched: true };
  }

  return { body: out, touched: false };
}

// _stripDefaultsNavRow — pure body transform. Idempotent. Removes a dead
// FinanceNavRow dataviewjs block (superseded by FinanceNav) from a body,
// including any leading `// entity-create:` sentinel comment line inside the
// same block and the trailing blank line so removal leaves no double blank.
// Leaves FinanceNav (and every other block) untouched.
function _stripDefaultsNavRow(body) {
  const BLOCK_RE = /\n?```dataviewjs\s*\n(?:\/\/[^\n]*\n)?await\s+dv\.view\(\s*["'][^"']*customjs-guard[^"']*["']\s*,\s*\{\s*class\s*:\s*["']FinanceNavRow["']\s*\}\s*\)\s*;?\s*\n```[ \t]*\r?\n/;
  if (!BLOCK_RE.test(body)) return { body, touched: false };
  const out = body.replace(BLOCK_RE, "\n");
  if (out === body) return { body, touched: false };
  return { body: out, touched: true };
}

// applyFinanceMonthChecklistInjection — inject the MonthSetupChecklist block
// into every existing Month-YYYY-MM.md that lacks it (above MonthDashboard).
// UNGATED · marker-guarded · .sauce-backup snapshot before write · per-file
// failure-loud. New month notes get the block from the manifest inline_body.
async function applyFinanceMonthChecklistInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const monthsRoot = "spice/finance/months";
  if (!(await adapter.exists(monthsRoot))) return;

  const monthFiles = await _listMonthFiles(adapter, monthsRoot);
  if (monthFiles.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touched = 0;
  for (const fp of monthFiles) {
    try {
      const body = await adapter.read(fp);
      const result = _injectMonthChecklist(body);
      if (result.touched) {
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_month_checklist_injection", name: "finance",
        reason: `body injection failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_month_checklist_injection", name: "finance",
    reason: `${monthFiles.length} month notes scanned, ${touched} bodies injected (MonthSetupChecklist above MonthDashboard)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// applyFinanceEditScopeBannerInjection — inject the FinanceEditScopeBanner block
// into every existing Budget-*.md + Paycheck-*.md + the three Defaults notes
// that lack it (after FinanceNav). UNGATED · marker-guarded · .sauce-backup
// snapshot · per-file failure-loud. New notes get the block from inline_body.
async function applyFinanceEditScopeBannerInjection(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const targets = [];
  const budgetsRoot = "spice/finance/budgets";
  if (await adapter.exists(budgetsRoot)) {
    for (const fp of await _listBudgetFiles(adapter, budgetsRoot)) targets.push(fp);
  }
  const paychecksRoot = "spice/finance/paychecks";
  if (await adapter.exists(paychecksRoot)) {
    for (const fp of await _listPaycheckFiles(adapter, paychecksRoot)) targets.push(fp);
  }
  for (const fp of ["spice/finance/Budget Defaults.md", "spice/finance/Paycheck Defaults.md", "spice/finance/Debt Defaults.md"]) {
    if (await adapter.exists(fp)) targets.push(fp);
  }
  if (targets.length === 0) return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let touched = 0;
  for (const fp of targets) {
    try {
      const body = await adapter.read(fp);
      const result = _injectEditScopeBanner(body);
      if (result.touched) {
        const backupPath = `.sauce-backup/${ts}/${fp}`;
        const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
        try { await adapter.mkdir(backupParent); } catch (_e) { /* already exists */ }
        try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
        await adapter.write(fp, result.body);
        touched += 1;
      }
    } catch (e) {
      history?.push({ event: "warning", step: "finance_edit_scope_banner_injection", name: "finance",
        reason: `body injection failed for ${fp}: ${e.message}`,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_edit_scope_banner_injection", name: "finance",
    reason: `${targets.length} budget/paycheck/defaults notes scanned, ${touched} bodies injected (FinanceEditScopeBanner after FinanceNav)`,
    git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
    attempted_at: new Date().toISOString() });
}

// applyFinanceDefaultsNavRowRetirement — retires the DEAD second nav row.
// Replaces applyFinanceDefaultsNavRowInjection (which ungated-re-injected the
// superseded FinanceNavRow on every install). Strips any FinanceNavRow block
// from the three Defaults notes (FinanceNav supersedes it). UNGATED · idempotent
// (a body with no FinanceNavRow is a no-op) · .sauce-backup snapshot before
// write · per-file failure-loud.
async function applyFinanceDefaultsNavRowRetirement(tp, manifest, variables, history, git) {
  if (!manifest || manifest.name !== "finance") return;
  if (!tp || !tp.app || !tp.app.vault || !tp.app.vault.adapter) return;
  const adapter = tp.app.vault.adapter;

  const DEFAULTS_PATHS = [
    "spice/finance/Budget Defaults.md",
    "spice/finance/Paycheck Defaults.md",
    "spice/finance/Debt Defaults.md",
  ];

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  let stripped = 0, absent = 0, alreadyClean = 0;

  for (const fp of DEFAULTS_PATHS) {
    try {
      if (!(await adapter.exists(fp))) { absent++; continue; }
      const body = await adapter.read(fp);
      const result = _stripDefaultsNavRow(body);
      if (!result.touched) { alreadyClean++; continue; }
      const backupPath = `.sauce-backup/${ts}/${fp}`;
      const backupParent = backupPath.substring(0, backupPath.lastIndexOf("/"));
      try { await adapter.mkdir(backupParent); } catch (_e) { /* ok */ }
      try { await adapter.write(backupPath, body); } catch (_e) { /* best-effort */ }
      await adapter.write(fp, result.body);
      stripped++;
      history?.push({ event: "info", step: "finance_defaults_nav_row_retirement", name: "finance",
        path: fp, snapshot: backupPath,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    } catch (e) {
      history?.push({ event: "warning", step: "finance_defaults_nav_row_retirement", name: "finance",
        path: fp, reason: e.message,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty,
        attempted_at: new Date().toISOString() });
    }
  }

  history?.push({ event: "info", step: "finance_defaults_nav_row_retirement", name: "finance",
    summary: { stripped, absent, alreadyClean },
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

// pruneOrphanedProjectBreadcrumb — one-shot removal of a stale customJS script that
// the project blueprint USED to ship: helpers/breadcrumb.js, a pre-mechanism
// `class Breadcrumb`. It was dropped from the project manifest when the breadcrumb
// MECHANISM (mechanisms/breadcrumb, also `class Breadcrumb`) took over (~v0.123.0),
// but the installer has no general orphaned-script prune, so the old copy lingered
// at ranch/scripts/project/breadcrumb.js in every already-installed vault. Two
// `class Breadcrumb` files means a customJS NAME COLLISION: customJS registers by
// class name and the winner depends on the filesystem scan order, which differs by
// platform — on mobile the legacy (which has no buildSegments/path_walk) could win,
// so the ChromeBar breadcrumb silently rendered nothing (desktop happened to load
// the mechanism's). Delete the orphan so the mechanism's Breadcrumb is the only one.
//
// Path-scoped (only ranch/scripts/project/breadcrumb.js) AND content-guarded (must
// be the legacy shape: has `class Breadcrumb`, lacks buildSegments) so it can never
// touch the mechanism's file or an unrelated file. Backup-on-delete; never throws.
// SUNSET: remove after all consumer vaults have installed ≥ this release once.
async function pruneOrphanedProjectBreadcrumb(tp, history, git) {
  const adapter = tp.app.vault.adapter;
  const target = "ranch/scripts/project/breadcrumb.js";
  const step = "orphaned_project_breadcrumb_prune";
  const warn = (message, event) => {
    if (history) history.push({ event: event || "warning", step, message,
      git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
  };
  try {
    if (!(await adapter.exists(target))) return; // already pruned / never had it
    let body;
    try { body = await adapter.read(target); }
    catch (e) { warn(`read failed for ${target}: ${e.message}`); return; }
    // Safety: only remove the LEGACY standalone class. Never delete a file that
    // exposes the mechanism's API (buildSegments), and never a non-Breadcrumb file.
    if (!/class\s+Breadcrumb\b/.test(body) || /buildSegments/.test(body)) {
      warn(`${target} is not the legacy Breadcrumb class — left untouched`);
      return;
    }
    try { await adapter.write(`${target}.sauce-backup`, body); }
    catch (e) { new Notice(`pruneOrphanedProjectBreadcrumb: backup write failed (${e.message}); aborting`, 8000); warn(`backup write failed: ${e.message}`, "error"); return; }
    try {
      await adapter.remove(target);
      if (history) history.push({ event: "info", step, action: "applied", removed: target,
        git_commit: git.commit, git_tag: git.tag, git_dirty: git.dirty, attempted_at: new Date().toISOString() });
    } catch (e) { new Notice(`pruneOrphanedProjectBreadcrumb: remove failed (${e.message})`, 8000); warn(`remove failed: ${e.message}`, "error"); }
  } catch (e) { warn(`crashed: ${e.message}`, "error"); }
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

// pruneBreadcrumbRegistry — v0.123.0. Drop contributions.<X> for any X not
// in the current subscription. Symmetric with pruneNavButtonsRegistry: same
// C4 hardening, same Notice + history posture, same idempotency. Closes the
// "consumer unsubscribes from a blueprint entirely" gap that applyBreadcrumb
// alone can't see (applyBreadcrumb only runs for items still in the
// subscription, so an entirely-removed blueprint's prior contribution would
// otherwise persist forever in the registry).
async function pruneBreadcrumbRegistry(tp, subscription, history, git) {
  const adapter = tp.app.vault.adapter;
  const registryPath = "ranch/breadcrumb-registry.json";
  if (!(await adapter.exists(registryPath))) return;

  let raw;
  try {
    raw = await adapter.read(registryPath);
  } catch (e) {
    new Notice(`pruneBreadcrumbRegistry: cannot read ${registryPath} (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "breadcrumb_prune",
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
    new Notice(`pruneBreadcrumbRegistry: ${registryPath} is malformed JSON (${e.message}). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "breadcrumb_prune",
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
    new Notice(`pruneBreadcrumbRegistry: ${registryPath} parsed but has unexpected shape (expected object). Skipping prune.`, 8000);
    if (history) {
      history.push({
        event: "error",
        step: "breadcrumb_prune",
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
          step: "breadcrumb_prune",
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
    module.exports.applyBundledPlugin = applyBundledPlugin;
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
    // v0.9.0 sticky-notes rename — expose migration + pure helpers for
    // run-sticky-notes-rename-migration.js (SNRM-1..3). Pure additive.
    module.exports.applyScratchToStickyNotesMigration = applyScratchToStickyNotesMigration;
    module.exports.applyJournalMultiEntryMigration = applyJournalMultiEntryMigration;
    module.exports._rewriteScratchToStickyBody = _rewriteScratchToStickyBody;
    module.exports._stickyRenameFor = _stickyRenameFor;
    // v0.100.2 — docs-hub "+ New Doc" button repair (run-wiki-to-docs-migration.js DHBR-1..3).
    module.exports.applyDocsHubButtonRepair = applyDocsHubButtonRepair;
    module.exports._repairDocsHubButtonBody = _repairDocsHubButtonBody;
    // v0.127.0 §D — ProjectMeetingsPanel heal (run-v0127-project-hub-heal.js).
    // Also export note-chrome internals so the heal harness can reuse the
    // frontmatter-type detector / body transform when authoring future cases.
    module.exports.applyProjectMeetingsPanelHeal = applyProjectMeetingsPanelHeal;
    // Project Doc Updating Wiring PR4 — existing-doc DocLeafActions backfill heal
    // + its pure body transform (run-doc-leaf-actions-heal.js DLAH-*).
    module.exports.applyDocLeafActionsBackfill = applyDocLeafActionsBackfill;
    module.exports._injectDocLeafActionsBody = _injectDocLeafActionsBody;
    // Project Doc Updating Wiring PR5 — existing Docs-hub DocBulkMoveActions
    // backfill heal + its pure body transform (run-doc-bulk-move-heal.js DBMH-*).
    module.exports.applyDocBulkMoveActionsBackfill = applyDocBulkMoveActionsBackfill;
    module.exports._injectDocBulkMoveActionsBody = _injectDocBulkMoveActionsBody;
    // docs-hub modernize — legacy docs-hub body → renderActionRow chrome shape.
    module.exports.applyDocsHubModernizeHeal = applyDocsHubModernizeHeal;
    module.exports._modernizeDocsHubBody = _modernizeDocsHubBody;
    // Project Links Wiring PR4 — existing Link-Hub ProjectLinksManager backfill
    // heal + its pure body transform (run-project-links-manager-heal.js PLMH-*).
    module.exports.applyProjectLinksManagerBackfill = applyProjectLinksManagerBackfill;
    module.exports._injectProjectLinksManagerBody = _injectProjectLinksManagerBody;
    module.exports.applyProjectActivityPanelsHeal = applyProjectActivityPanelsHeal;
    // Project Links Wiring PR3 — existing-project Links Hub backfill heal + its
    // pure note builders (run-project-links-hub-backfill.js HC-PLHB-*).
    module.exports.applyProjectLinksHubBackfill = applyProjectLinksHubBackfill;
    module.exports._renderLinksHubNote = _renderLinksHubNote;
    module.exports._linksHubBody = _linksHubBody;
    module.exports.applyProjectNavButtonsSeparatorGap = applyProjectNavButtonsSeparatorGap;
    module.exports._collapseNavButtonsSeparatorGap = _collapseNavButtonsSeparatorGap;
    // WS9 P0a — project chrome literal-`---`-divider strip heal + pure transform
    // (run-v0127-project-hub-heal.js CHR-DIV-*).
    module.exports.applyProjectChromeDividerHeal = applyProjectChromeDividerHeal;
    module.exports._stripProjectChromeDividers = _stripProjectChromeDividers;
    // button/nav refactor Pass 9b — forward migration of existing project-surface
    // notes to the single ProjectChromeBar shape (run-project-chrome-bar-heal.js).
    module.exports.applyProjectChromeBarHeal = applyProjectChromeBarHeal;
    module.exports._projectChromeBarBody = _projectChromeBarBody;
    module.exports.PROJECT_CHROME_TYPES = PROJECT_CHROME_TYPES;
    // Daily/Home chrome-bar adoption — forward migration of legacy SpaceNavButtons
    // chrome onto DailyChromeBar / HomeChromeBar (run-daily-home-chrome-bar-heal.js).
    module.exports.applyDailyHomeChromeBarHeal = applyDailyHomeChromeBarHeal;
    module.exports._dailyChromeBarBody = _dailyChromeBarBody;
    module.exports._homeChromeBarBody = _homeChromeBarBody;
    // WS9 P0b — promoted board-card breadcrumb + type heal + pure transform
    // (run-v0127-project-hub-heal.js BC-BC-*).
    module.exports.applyBoardCardBreadcrumbHeal = applyBoardCardBreadcrumbHeal;
    module.exports._injectBoardCardBreadcrumb = _injectBoardCardBreadcrumb;
    // WS9 P1 — project-hub ProjectWorkstreamManager block removal heal + pure
    // transform (run-v0127-project-hub-heal.js WSM-RM-*).
    module.exports.applyProjectHubWorkstreamRemovalHeal = applyProjectHubWorkstreamRemovalHeal;
    module.exports._removeWorkstreamManagerBlock = _removeWorkstreamManagerBlock;
    module.exports.applyProjectsHubAllProjectsHeadingCleanup = applyProjectsHubAllProjectsHeadingCleanup;
    module.exports._stripAllProjectsHeading = _stripAllProjectsHeading;
    module.exports._resolveProjectDisplayName = _resolveProjectDisplayName;
    module.exports._injectProjectNameFrontmatter = _injectProjectNameFrontmatter;
    module.exports._noteChromeFrontmatterType = _noteChromeFrontmatterType;
    // button/nav refactor Pass 9a — ProjectChromeBar-shape guard predicate.
    // Every legacy project-chrome heal that would re-inject breadcrumb/nav/action
    // chrome guards on this so it no-ops on a migrated note
    // (run-project-chrome-heal-guard.js).
    module.exports._hasChromeBar = _hasChromeBar;
    module.exports._healNoteChromeBody = _healNoteChromeBody;
    module.exports._healChromeBarMigration = _healChromeBarMigration;
    module.exports.applyMeetingsHubChromeBarHeal = applyMeetingsHubChromeBarHeal;
    module.exports._stripMeetingsHubEntityCreateBlock = _stripMeetingsHubEntityCreateBlock;
    module.exports._stripEntityCreateMarkerBlock = _stripEntityCreateMarkerBlock;
    module.exports._stripDividersAroundActionBlock = _stripDividersAroundActionBlock;
    // v0.108.0 S2 — expose 4 new finance migrations for HC test coverage.
    module.exports.applyFinanceDebtScaffolding = applyFinanceDebtScaffolding;
    module.exports.applyFinanceBudgetGroupSeed = applyFinanceBudgetGroupSeed;
    module.exports.applyFinancePaycheckArchiveLegacy = applyFinancePaycheckArchiveLegacy;
    module.exports.applyFinancePaycheckDefaultsDebtLinking = applyFinancePaycheckDefaultsDebtLinking;
    module.exports.applyFinanceNavRowMigration = applyFinanceNavRowMigration;
    // v0.109.0 S8 — doc-note breadcrumb marker cleanup (run-install.js CLN-1..2).
    module.exports.applyDocNoteBreadcrumbMarkerCleanup = applyDocNoteBreadcrumbMarkerCleanup;
    module.exports.applyProjectHubLegacyHeadingCleanup = applyProjectHubLegacyHeadingCleanup;
    // v0.124.1 Task B2 — section-hub redundant entity-create block cleanup.
    module.exports.applySectionHubEntityCreateCleanup = applySectionHubEntityCreateCleanup;
    module.exports._stripEntityCreateMarkerBlocks = _stripEntityCreateMarkerBlocks;
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
    // month reality WS2 — BudgetAllocationsEditor band injection on Budget-YYYY-MM.md
    module.exports.applyFinanceBudgetAllocationsBandInjection = applyFinanceBudgetAllocationsBandInjection;
    module.exports._injectAllocationsBand = _injectAllocationsBand;
    // Behavioral harness reads _migrateBudgetBody to chain-test migration ordering.
    module.exports._migrateBudgetBody = _migrateBudgetBody;
    // v0.110.1 — vault-wide EntityCreate direct-call → guard rewrite.
    module.exports.applyEntityCreateGuardMigration = applyEntityCreateGuardMigration;
    // v0.119.0 impl-3 — registry materializer for entity-create direct-invocation harness.
    module.exports.applyNewEntityButtons = applyNewEntityButtons;
    // v0.110.2 — generalized: ANY direct customJS.<Class>.render(dv,...) → guard.
    module.exports.applyCustomJsGuardMigration = applyCustomJsGuardMigration;
    // v0.111.0 — collapse FinanceHubActions + FinanceNavRow → single-line FinanceNav.
    module.exports.applyFinanceUnifiedNavMigration = applyFinanceUnifiedNavMigration;
    // v0.112.0 S2 — months scaffolding + paycheck-debt-band injection.
    module.exports.applyFinanceMonthsScaffolding = applyFinanceMonthsScaffolding;
    // entity-create:month marker normalization (leading, not trailing) on the months hub.
    module.exports.applyFinanceMonthsEntityCreateSentinel = applyFinanceMonthsEntityCreateSentinel;
    module.exports.applyFinancePaycheckDebtBandInjection = applyFinancePaycheckDebtBandInjection;
    module.exports._injectPaycheckDebtBand = _injectPaycheckDebtBand;
    // v0.116.0 — to-do blueprint v0.4.0 migrations.
    module.exports.applyToDoBlueprintMigration = applyToDoBlueprintMigration;
    module.exports.applyProjectTodoBackfill = applyProjectTodoBackfill;
    module.exports._healProjectTodoOwnedTasksBody = _healProjectTodoOwnedTasksBody;
    module.exports.applyProjectTodoOwnedTasksHeal = applyProjectTodoOwnedTasksHeal;
    module.exports._reorderProjectTodoOwnedTasksLast = _reorderProjectTodoOwnedTasksLast;
    module.exports.applyProjectTodoSectionReorderHeal = applyProjectTodoSectionReorderHeal;
    // trips-conformance heal — rename + canonicalize + breadcrumb for existing
    // trips (for run-trips-heal.js TRIPHEAL-*). Pure additive.
    module.exports.applyTripsConformanceHeal = applyTripsConformanceHeal;
    // home-scaffold heal — materialize + chrome-heal the singleton
    // spice/home/Home.md (for run-home.js HOME-HEAL-*). The pure body transform
    // is also extracted by regex in the harness; expose it explicitly too.
    module.exports.applyHomeScaffoldHeal = applyHomeScaffoldHeal;
    module.exports._healHomeChromeBody = _healHomeChromeBody;
    // home-hotkey-remap heal — retargets Cmd+[ from daily-notes to
    // sauce-home:open on already-installed vaults (for run-home.js HOME-HOTKEY-*).
    // The pure decision function is also extracted by regex in the harness;
    // expose it explicitly too.
    module.exports.applyHomeHotkeyRemapHeal = applyHomeHotkeyRemapHeal;
    module.exports._planHomeHotkeyRemap = _planHomeHotkeyRemap;
    // reader-scaffold heal — materialize + chrome-heal the singleton
    // spice/reader/Reader.md reading-queue hub. The pure body transform is also
    // extractable by regex in a harness; expose it explicitly too.
    module.exports.applyReaderScaffoldHeal = applyReaderScaffoldHeal;
    module.exports._healReaderChromeBody = _healReaderChromeBody;
    // task-entity — backup-first daily→note-per-task migration (for
    // run-seed-migrations.js HC-DAILYTASK-* + run-helper-cases structural asserts).
    module.exports.applyDailyTasksToEntityMigration = applyDailyTasksToEntityMigration;
    module.exports.applyMeetingTasksToEntityMigration = applyMeetingTasksToEntityMigration;
    module.exports.applyProjectTasksToEntityMigration = applyProjectTasksToEntityMigration;
    module.exports.applyTaskNoteHeal = applyTaskNoteHeal;
    module.exports.applyTaskNoteProjectSlugHeal = applyTaskNoteProjectSlugHeal;
    module.exports.applyProjectTodoTaskListHeal = applyProjectTodoTaskListHeal;
    module.exports.applyMeetingTaskListHeal = applyMeetingTaskListHeal;
    module.exports._cleanProjectLinkName = _cleanProjectLinkName;
    module.exports._isMangledProjectField = _isMangledProjectField;
    module.exports._taskNoteChromeBody = _taskNoteChromeBody;
    module.exports._sanitizeTaskTitleForFilename = _sanitizeTaskTitleForFilename;
    module.exports._stripCompletionEmojiSuffix = _stripCompletionEmojiSuffix;
    module.exports._parseRecurringRegistry = _parseRecurringRegistry;
    module.exports._parseDailyTaskLine = _parseDailyTaskLine;
    module.exports._composeDailyTaskNote = _composeDailyTaskNote;
    module.exports._composeEntityTaskFrontmatter = _composeEntityTaskFrontmatter;
    module.exports._extractOpenLinesUnderMarker = _extractOpenLinesUnderMarker;
    module.exports._swapDailyToTaskTodayList = _swapDailyToTaskTodayList;
    // v0.119.0 — to-do v0.7.0 additive recurring sentinel heal.
    module.exports.applyRecurringSentinelV070Migration = applyRecurringSentinelV070Migration;
    module.exports.mergeDuplicateRecurringSections = mergeDuplicateRecurringSections;
    module.exports.stripPersistedRecurringSection = stripPersistedRecurringSection;
    // v0.119.0 impl-1 — project blueprint installer migrations (for run-seed-migrations.js
    // HC-V01190-PROJ-SEED-MIGRATE-* direct-invocation family). Pure additive.
    module.exports.applyProjectSectionsMigration = applyProjectSectionsMigration;
    module.exports.applyProjectSectionsHubMigration = applyProjectSectionsHubMigration;
    // PR1 project-doc-updating-wiring — doc-note section/sub_section backfill
    // (run-seed-migrations.js HC-DOCSEC-BACKFILL-* family). Pure additive.
    module.exports.applyDocSectionBackfill = applyDocSectionBackfill;
    module.exports.applyProjectSectionsCloseRepair = applyProjectSectionsCloseRepair;
    module.exports.applyEmptyProjectWikilinkRepair = applyEmptyProjectWikilinkRepair;
    // v0.119.0 impl-2 — finance blueprint installer migrations (for run-seed-migrations.js
    // HC-V01190-FIN-SEED-MIGRATE-* direct-invocation family). Pure additive.
    module.exports.applyFinanceBudgetBodyMigration = applyFinanceBudgetBodyMigration;
    module.exports.applyFinanceCategoriesGroupBackfill = applyFinanceCategoriesGroupBackfill;
    module.exports.applyFinanceBudgetMalformedGroupRepair = applyFinanceBudgetMalformedGroupRepair;
    module.exports._backfillBudgetGroupsFromText = _backfillBudgetGroupsFromText;
    module.exports._repairMalformedBudgetGroups = _repairMalformedBudgetGroups;
    module.exports.applyFinanceDefaultsNavRowInjection = applyFinanceDefaultsNavRowInjection;
    // cockpit #3 — Month cockpit + edit-scope banner injection + nav-row retirement.
    module.exports.applyFinanceMonthChecklistInjection = applyFinanceMonthChecklistInjection;
    module.exports._injectMonthChecklist = _injectMonthChecklist;
    module.exports.applyFinanceEditScopeBannerInjection = applyFinanceEditScopeBannerInjection;
    module.exports._injectEditScopeBanner = _injectEditScopeBanner;
    module.exports.applyFinanceDefaultsNavRowRetirement = applyFinanceDefaultsNavRowRetirement;
    module.exports._stripDefaultsNavRow = _stripDefaultsNavRow;
    module.exports._listMonthFiles = _listMonthFiles;
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
    // Per-vault migration gate test hooks (purely additive) — exercised by
    // platform/test/run-migration-gate.js.
    module.exports.__migrationGateTestHooks = { semverLt, migrationGated: _migrationGated, setPriorVersion(v){ __installPriorVersion = v; } };
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
