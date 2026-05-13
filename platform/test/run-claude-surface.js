#!/usr/bin/env node
// run-claude-surface.js — v0.32.0 S2/S3/S4 sub-asserts for aggregateClaudeSurface
// + materializeClaudeSurface + regenerateClaudeMd (CLAUDE.md marker renderer).
//
// S2 (CS-AG-*): tests the registry builder in isolation: imports
// aggregateClaudeSurface from platform/install.js and exercises it with
// constructed Map<name,manifest> + subscription fixtures.
//
// S3 (CS-MAT-*): tests the per-entry file materializer. Each case scaffolds
// a tmpdir vault + fake-workshop layout, builds a materializeList entry
// shape (mirrors aggregator output with target_path + itemVars), invokes
// materializeClaudeSurface directly, and asserts on file contents +
// history events.
//
// Cases:
//   CS-AG-1  zero subscribed items → empty registry + materializeList + rows
//   CS-AG-2  one blueprint w/ command + skill + claude_md_row(resolvers) →
//            registry has 3 entries, materializeList length 2, rows.resolvers length 1
//   CS-AG-3  {{module_directory}} in claude_md_row.row.path → spice/<bare>/...
//   CS-AG-4  {{skills_dir}} in skill dest → manifest.skills_dir value substituted
//   CS-AG-5  dest "/etc/passwd" rejected (error event in history; not in materializeList)
//   CS-AG-6  rows.resolvers sorted alphabetically by topic
//   CS-AG-7  unsubscribed item with claude_surface[] in manifest map → NOT in registry
//   CS-MAT-1 command kind materializes .claude/commands/<x>.md with body substitution
//   CS-MAT-2 skill kind materializes <skills_dir>/<x>/SKILL.md
//   CS-MAT-3 context_doc kind materializes <module_dir>/context/<x>.md
//   CS-MAT-4 missing source file → error event; other entries still materialize
//   CS-MAT-5 no orphan .tmp file left behind after success
//   CS-MD-1  marker pair present → content replaced; surrounds preserved
//   CS-MD-2  missing marker pair → section appended at end with markers
//   CS-MD-3  half-open marker (BEGIN w/o END) → throws explicit Error
//   CS-MD-4  outside-marker content preserved bit-for-bit
//   CS-MD-5  pre-seeded directory-map rows always present
//   CS-MD-6  alphabetic order honored within contributed rows
//   CS-MD-7  rendered table shape (headers, separator, data rows)
//
// Usage: node platform/test/run-claude-surface.js
// Exit: 0 = all pass; 1 = any fail.

"use strict";

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const os = require("os");

const WORKSHOP = path.resolve(__dirname, "../..");
const INSTALLER_PATH = path.join(WORKSHOP, "platform/install.js");

const installer = require(INSTALLER_PATH);
const aggregateClaudeSurface = installer.aggregateClaudeSurface;
const materializeClaudeSurface = installer.materializeClaudeSurface;
const pruneClaudeSurface = installer.pruneClaudeSurface;
const applyLocalShadows = installer.applyLocalShadows;
const { regenerateClaudeMd, beginMarker, endMarker } = require(
  path.join(WORKSHOP, "platform/mechanisms/platform-claude/claude-md-renderer.js")
);

function makeTpStub(dir) {
  return {
    app: {
      vault: {
        adapter: {
          async exists(p)         { return fs.existsSync(path.join(dir, p)); },
          async mkdir(p)          { fs.mkdirSync(path.join(dir, p), { recursive: true }); },
          async read(p)           { return fs.readFileSync(path.join(dir, p), "utf8"); },
          async write(p, content) {
            const abs = path.join(dir, p);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content);
          },
          // v0.32.0 S5 — mirror Obsidian's FileSystemAdapter.list shape:
          // returns { files: string[], folders: string[] } with VAULT-RELATIVE
          // path strings (no leading slash, no trailing slash on folders).
          async list(p) {
            const abs = path.join(dir, p);
            if (!fs.existsSync(abs)) {
              const err = new Error(`ENOENT: no such file or directory, scandir '${abs}'`);
              err.code = "ENOENT";
              throw err;
            }
            const entries = fs.readdirSync(abs, { withFileTypes: true });
            const files = [];
            const folders = [];
            for (const e of entries) {
              const rel = p ? `${p}/${e.name}` : e.name;
              if (e.isDirectory()) folders.push(rel);
              else files.push(rel);
            }
            return { files, folders };
          },
          async remove(p) {
            const abs = path.join(dir, p);
            fs.unlinkSync(abs);
          },
        },
      },
    },
  };
}

async function withTempFixture(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "cs-mat-"));
  try {
    return await fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
  }
}

let pass = 0;
let fail = 0;
const failures = [];

function assertEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    fail++;
    failures.push(`FAIL: ${label}\n  expected ${e}\n  actual   ${a}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function assertTrue(label, cond, hint) {
  if (!cond) {
    fail++;
    failures.push(`FAIL: ${label}${hint ? ` — ${hint}` : ""}`);
    return false;
  }
  pass++;
  console.log(`  PASS: ${label}`);
  return true;
}

function mkGit() {
  return { commit: "deadbeef", tag: null, dirty: false };
}

// ============================================================
// CS-AG-1: zero subscribed items → fully empty output
// ============================================================
async function caseCSAG1Empty() {
  console.log("\n--- Case CS-AG-1: aggregate with zero subscribed items ---");
  const perItemManifest = new Map();
  const subscription = { mechanisms: [], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-1: result is an object", out && typeof out === "object");
  assertEq("CS-AG-1: registry.contributions is empty", out.registry.contributions, {});
  assertEq("CS-AG-1: materializeList empty", out.materializeList, []);
  assertEq("CS-AG-1: rows.directory-map empty", out.rows["directory-map"], []);
  assertEq("CS-AG-1: rows.resolvers empty", out.rows["resolvers"], []);
  assertEq("CS-AG-1: rows.skills-index empty", out.rows["skills-index"], []);
}

// ============================================================
// CS-AG-2: three-kind aggregation
// ============================================================
async function caseCSAG2ThreeKinds() {
  console.log("\n--- Case CS-AG-2: blueprint w/ command + skill + claude_md_row(resolvers) ---");
  const perItemManifest = new Map();
  perItemManifest.set("test-bp", {
    name: "test-bp",
    version: "0.1.0",
    kind: "blueprint",
    module_directory: "testbp",
    skills_dir: ".claude/skills/sauce",
    claude_surface: [
      { kind: "command", source: "commands/foo.md", dest: ".claude/commands/foo.md" },
      { kind: "skill", source: "skills/bar/SKILL.md", dest: "{{skills_dir}}/bar/SKILL.md" },
      { kind: "claude_md_row", table: "resolvers", row: { topic: "alpha", skill: "test-bp:alpha" } }
    ]
  });
  const subscription = { mechanisms: [], blueprints: [{ name: "test-bp", version: "0.1.0" }] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-2: test-bp in registry.contributions", Array.isArray(out.registry.contributions["test-bp"]));
  assertEq("CS-AG-2: test-bp has 3 contributions", out.registry.contributions["test-bp"].length, 3);
  assertEq("CS-AG-2: materializeList length 2", out.materializeList.length, 2);
  assertEq("CS-AG-2: rows.resolvers length 1", out.rows.resolvers.length, 1);
  assertEq("CS-AG-2: resolver row carries owner field", out.rows.resolvers[0].owner, "test-bp");
}

// ============================================================
// CS-AG-3: {{module_directory}} substitution in claude_md_row.row.path
// ============================================================
async function caseCSAG3ModuleDirSub() {
  console.log("\n--- Case CS-AG-3: {{module_directory}} → spice/<bare>/... in claude_md_row.row.path ---");
  const perItemManifest = new Map();
  perItemManifest.set("project", {
    name: "project",
    version: "1.0.0",
    kind: "blueprint",
    module_directory: "projects",
    claude_surface: [
      { kind: "claude_md_row", table: "directory-map", row: { path: "{{module_directory}}/Projects.md", note: "project hub" } }
    ]
  });
  const subscription = { mechanisms: [], blueprints: [{ name: "project", version: "1.0.0" }] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-3: rows.directory-map length 1", out.rows["directory-map"].length, 1);
  const row = out.rows["directory-map"][0];
  assertEq("CS-AG-3: row.path is substituted to spice/projects/Projects.md", row.path, "spice/projects/Projects.md");
}

// ============================================================
// CS-AG-4: {{skills_dir}} substitution in skill dest
// ============================================================
async function caseCSAG4SkillsDirSub() {
  console.log("\n--- Case CS-AG-4: {{skills_dir}} → manifest.skills_dir value in skill dest ---");
  const perItemManifest = new Map();
  perItemManifest.set("platform-claude", {
    name: "platform-claude",
    version: "0.1.0",
    kind: "mechanism",
    skills_dir: ".claude/skills/test",
    claude_surface: [
      { kind: "skill", source: "skills/foo/SKILL.md", dest: "{{skills_dir}}/foo/SKILL.md" }
    ]
  });
  const subscription = { mechanisms: [{ name: "platform-claude", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-4: materializeList length 1", out.materializeList.length, 1);
  assertEq("CS-AG-4: skill dest substituted", out.materializeList[0].dest, ".claude/skills/test/foo/SKILL.md");
}

// ============================================================
// CS-AG-5: destination path validation — /etc/passwd rejected
// ============================================================
async function caseCSAG5DestPathRejected() {
  console.log("\n--- Case CS-AG-5: dest \"/etc/passwd\" rejected; error event + not materialized ---");
  const perItemManifest = new Map();
  perItemManifest.set("bad", {
    name: "bad",
    version: "0.1.0",
    kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "x.md", dest: "/etc/passwd" }
    ]
  });
  const subscription = { mechanisms: [{ name: "bad", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-5: rejected entry NOT in materializeList", out.materializeList.length, 0);
  const errs = history.filter((h) => h.event === "error" && h.step === "claude_surface_dest_disallowed");
  assertEq("CS-AG-5: exactly one disallowed-dest error event", errs.length, 1);
}

// ============================================================
// CS-AG-6: rows.resolvers sorted alphabetically by topic
// ============================================================
async function caseCSAG6RowSort() {
  console.log("\n--- Case CS-AG-6: rows.resolvers sorted alphabetically by topic ---");
  const perItemManifest = new Map();
  perItemManifest.set("a", {
    name: "a", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "claude_md_row", table: "resolvers", row: { topic: "Zebra", skill: "a:zebra" } }
    ]
  });
  perItemManifest.set("b", {
    name: "b", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "claude_md_row", table: "resolvers", row: { topic: "Apple", skill: "b:apple" } }
    ]
  });
  const subscription = {
    mechanisms: [{ name: "a", version: "0.1.0" }, { name: "b", version: "0.1.0" }],
    blueprints: []
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertEq("CS-AG-6: rows.resolvers length 2", out.rows.resolvers.length, 2);
  assertEq("CS-AG-6: first resolver topic is Apple", out.rows.resolvers[0].topic, "Apple");
  assertEq("CS-AG-6: second resolver topic is Zebra", out.rows.resolvers[1].topic, "Zebra");
}

// ============================================================
// CS-AG-7: unsubscribed item with claude_surface[] absent from registry
// ============================================================
async function caseCSAG7Unsubscribed() {
  console.log("\n--- Case CS-AG-7: unsubscribed item with claude_surface[] absent from registry ---");
  const perItemManifest = new Map();
  perItemManifest.set("subbed", {
    name: "subbed", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "s.md", dest: ".claude/commands/s.md" }
    ]
  });
  perItemManifest.set("orphan", {
    name: "orphan", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "o.md", dest: ".claude/commands/o.md" }
    ]
  });
  const subscription = { mechanisms: [{ name: "subbed", version: "0.1.0" }], blueprints: [] };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-AG-7: subscribed item in registry", Array.isArray(out.registry.contributions["subbed"]));
  assertTrue("CS-AG-7: unsubscribed item NOT in registry", out.registry.contributions["orphan"] === undefined);
  assertEq("CS-AG-7: materializeList only includes subscribed entry", out.materializeList.length, 1);
}

// ============================================================
// CS-SUB-1: real platform-claude manifest loaded; subscription includes it →
//           registry.contributions["platform-claude"] has 9 entries
//           (3 commands + 3 skills + 3 claude_md_row).
// ============================================================
async function caseCSSUB1PlatformClaudeIncluded() {
  console.log("\n--- Case CS-SUB-1: subscription with platform-claude → 9 contributions ---");
  const mechManifestPath = path.join(WORKSHOP, "platform/mechanisms/platform-claude/manifest.json");
  assertTrue("CS-SUB-1: platform-claude manifest.json exists", fs.existsSync(mechManifestPath));
  const mechMan = JSON.parse(fs.readFileSync(mechManifestPath, "utf8"));

  const perItemManifest = new Map();
  perItemManifest.set("platform-claude", mechMan);

  const subscription = {
    mechanisms: [{ name: "platform-claude", version: "0.1.0" }],
    blueprints: [],
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-SUB-1: registry has platform-claude key",
    Array.isArray(out.registry.contributions["platform-claude"]));
  assertEq("CS-SUB-1: 9 contributions total (3 cmd + 3 skill + 3 row)",
    out.registry.contributions["platform-claude"].length, 9);

  const cmdEntries = out.materializeList.filter((e) => e.owner === "platform-claude" && e.kind === "command");
  const skillEntries = out.materializeList.filter((e) => e.owner === "platform-claude" && e.kind === "skill");
  assertEq("CS-SUB-1: 3 command entries in materializeList", cmdEntries.length, 3);
  assertEq("CS-SUB-1: 3 skill entries in materializeList", skillEntries.length, 3);

  // Skill dests should have {{skills_dir}} substituted to ".claude/skills/platform".
  for (const e of skillEntries) {
    assertTrue(`CS-SUB-1: skill dest ${e.dest} starts with .claude/skills/platform/`,
      e.dest.startsWith(".claude/skills/platform/"));
  }

  // claude_md_row entries appear under rows.resolvers.
  const platRows = out.rows.resolvers.filter((r) => r.owner === "platform-claude");
  assertEq("CS-SUB-1: 3 resolver rows owned by platform-claude", platRows.length, 3);
  const topics = platRows.map((r) => r.topic).sort();
  assertEq("CS-SUB-1: resolver topics are Bootstrap/Install/Upgrade",
    topics, ["Bootstrap", "Install", "Upgrade"]);
}

// ============================================================
// CS-SUB-2: real platform-claude manifest loaded BUT subscription does NOT
//           include it → registry.contributions has no platform-claude key
//           and materializeList has zero platform-claude entries.
// ============================================================
async function caseCSSUB2PlatformClaudeExcluded() {
  console.log("\n--- Case CS-SUB-2: subscription omits platform-claude → not in registry ---");
  const mechManifestPath = path.join(WORKSHOP, "platform/mechanisms/platform-claude/manifest.json");
  const mechMan = JSON.parse(fs.readFileSync(mechManifestPath, "utf8"));

  const perItemManifest = new Map();
  perItemManifest.set("platform-claude", mechMan);
  // Also seed an unrelated mechanism so the subscription has SOMETHING.
  perItemManifest.set("other", {
    name: "other", version: "0.1.0", kind: "mechanism",
    claude_surface: [
      { kind: "command", source: "x.md", dest: ".claude/commands/x.md" },
    ],
  });

  const subscription = {
    mechanisms: [{ name: "other", version: "0.1.0" }],
    blueprints: [],
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-SUB-2: platform-claude NOT in registry.contributions",
    out.registry.contributions["platform-claude"] === undefined);
  const platMat = out.materializeList.filter((e) => e.owner === "platform-claude");
  assertEq("CS-SUB-2: 0 platform-claude entries in materializeList", platMat.length, 0);
  const platRows = out.rows.resolvers.filter((r) => r.owner === "platform-claude");
  assertEq("CS-SUB-2: 0 platform-claude resolver rows", platRows.length, 0);
  // The other mechanism's single command should still be present.
  assertTrue("CS-SUB-2: 'other' mechanism is in registry",
    Array.isArray(out.registry.contributions["other"]));
}

// ============================================================
// CS-SUB-3: every `sauce <word>` reference in EVERY mechanism + blueprint
//           claude_surface[] command + skill body must resolve to a real
//           verb in sauce-cli.js's VERBS dispatch table. Catches
//           reviewer-flagged bugs like `sauce install` (no such verb) or
//           `sauce bootstrap --rewizard` (no such flag) by asserting verb
//           tokens against ground truth.
//
//           Method: parse sauce-cli.js for the `VERBS = { ... }` literal,
//           extract verb names; walk every manifest with claude_surface[]
//           (mechanisms + blueprints) and scan each command + skill .md
//           body for occurrences of /\bsauce\s+([a-z][a-z0-9-]*)/g; assert
//           every captured verb is in VERBS. A short DOCUMENTED_NON_VERB
//           allowlist skips noun-phrase tokens that follow "sauce" but are
//           not CLI verbs (e.g. "sauce installer", "sauce vault").
//
//           v0.33.0 S1.2 generalization: scanner was previously hard-scoped
//           to platform/mechanisms/platform-claude/{commands,skills}. Now
//           iterates every manifest carrying claude_surface[] so wave 2
//           blueprint bodies (project / daily / meetings) and any future
//           addition are covered without further harness edits.
// ============================================================

// Walk every manifest with claude_surface[] and return the set of materialized
// command + skill body absolute paths. Mechanisms AND blueprints.
function walkClaudeSurfaceBodies(workshopRoot, manifestEntries) {
  const out = [];
  for (const entry of manifestEntries) {
    const baseDir = path.join(workshopRoot, entry.path || `blueprints/${entry.name}`);
    const manifestPath = path.join(baseDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { continue; }
    const surface = Array.isArray(manifest.claude_surface) ? manifest.claude_surface : [];
    for (const item of surface) {
      if (item.kind !== "command" && item.kind !== "skill") continue;
      const bodyPath = path.join(baseDir, item.source);
      if (!fs.existsSync(bodyPath)) continue;
      out.push({
        rel: `${entry.name}/${item.source}`,
        abs: bodyPath,
        owner: entry.name
      });
    }
  }
  return out;
}

// For each body, regex out "sauce <word>", classify (article-prefixed → prose),
// and return an array of bad-verb messages.
function scanBodyForBadVerbs(bodies, verbs, documentedNonVerb) {
  const articleRe = /(?:^|[\s(])(?:a|an|the)\s+$/i;
  const sauceRe = /\bsauce\s+([a-z][a-z0-9-]*)/g;
  const bad = [];
  for (const t of bodies) {
    const raw = fs.readFileSync(t.abs, "utf8");
    const stripped = raw.replace(/```[\s\S]*?```/g, "");
    let m; sauceRe.lastIndex = 0;
    while ((m = sauceRe.exec(stripped)) !== null) {
      const verb = m[1];
      const lookbehind = stripped.substring(Math.max(0, m.index - 12), m.index);
      if (articleRe.test(lookbehind) || documentedNonVerb.has(verb)) continue;
      if (!verbs.has(verb)) {
        bad.push(`${t.rel}: \`sauce ${verb}\` is not a real verb (VERBS=${[...verbs].sort().join(",")})`);
      }
    }
  }
  return bad;
}

async function caseCSSUB3VerbsExist() {
  console.log("\n--- Case CS-SUB-3: every `sauce <verb>` in platform-claude bodies is a real CLI verb ---");

  // 1. Extract VERBS from sauce-cli.js. We parse the literal source rather
  //    than require()-ing the module to avoid pulling its CLI side-effects.
  const cliSrc = fs.readFileSync(path.join(WORKSHOP, "platform/cli/sauce-cli.js"), "utf8");
  const verbsBlockMatch = cliSrc.match(/const\s+VERBS\s*=\s*\{([\s\S]*?)\};/);
  assertTrue("CS-SUB-3: VERBS block parsed from sauce-cli.js", !!verbsBlockMatch);
  const verbs = new Set();
  if (verbsBlockMatch) {
    const block = verbsBlockMatch[1];
    const keyRe = /(?:^|\n)\s*([a-z][a-z0-9-]*)\s*:/g;
    let m;
    while ((m = keyRe.exec(block)) !== null) verbs.add(m[1]);
  }
  assertTrue("CS-SUB-3: VERBS includes bootstrap", verbs.has("bootstrap"));
  assertTrue("CS-SUB-3: VERBS includes update", verbs.has("update"));
  assertTrue("CS-SUB-3: VERBS includes help", verbs.has("help"));

  // Tokens that legitimately follow "sauce" in prose but are NOT CLI verbs.
  // ONLY tokens that genuinely appear as noun-phrase suffixes — these MUST
  // NOT include real-looking verb candidates (e.g. "install", "upgrade")
  // because that's exactly the failure mode CS-SUB-3 exists to catch.
  const DOCUMENTED_NON_VERB = new Set([
    "installer", // "Re-run sauce installer" — prose noun
    "vault",     // "a sauce vault" / "a sauce-managed vault" — adjective use
  ]);

  // 2. Walk every mechanism + blueprint with claude_surface[].
  const platformManifest = JSON.parse(fs.readFileSync(path.join(WORKSHOP, "platform/manifest.json"), "utf8"));
  const all = [
    ...(platformManifest.mechanisms || []).map(m => ({ ...m, path: `platform/mechanisms/${m.name}` })),
    ...(platformManifest.blueprints || []).map(b => ({ ...b, path: `platform/blueprints/${b.name}` }))
  ];
  const targets = walkClaudeSurfaceBodies(WORKSHOP, all);
  assertTrue("CS-SUB-3: at least one command body scanned across platform", targets.some(t => t.rel.includes("/commands/")));
  assertTrue("CS-SUB-3: at least one skill body scanned across platform",   targets.some(t => t.rel.includes("/skills/")));

  // 3. Scan + assert no bad verbs.
  const bad = scanBodyForBadVerbs(targets, verbs, DOCUMENTED_NON_VERB);
  assertTrue(
    `CS-SUB-3: every invocation-style \`sauce <verb>\` resolves to a real verb (${bad.length} bad of ${targets.length} bodies scanned)`,
    bad.length === 0,
    bad.join("\n          ")
  );

  // CS-SUB-3b: the walker scans bodies OUTSIDE platform-claude too.
  // Plant a temp blueprint manifest pointing at a body containing
  // `sauce nopevern` and assert the walker reports it.
  {
    const tmpDir = path.join(os.tmpdir(), `sauce-cssub3b-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, "blueprints/sentinel/commands"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "blueprints/sentinel/manifest.json"), JSON.stringify({
      name: "sentinel", version: "0.0.1", kind: "blueprint", module_directory: "sentinel",
      claude_surface: [{ kind: "command", source: "commands/sentinel.md", dest: ".claude/commands/sentinel.md" }]
    }));
    fs.writeFileSync(path.join(tmpDir, "blueprints/sentinel/commands/sentinel.md"),
      "Run `sauce nopevern --foo` to do the thing.\n");
    const found = walkClaudeSurfaceBodies(tmpDir, [{ name: "sentinel", path: "blueprints/sentinel" }]);
    assertTrue("CS-SUB-3b: walker discovered the sentinel body",
      found.some(f => f.rel.endsWith("sentinel.md")));
    const badRefs = scanBodyForBadVerbs(found, verbs, DOCUMENTED_NON_VERB);
    assertTrue("CS-SUB-3b: walker flagged `sauce nopevern` as bad",
      badRefs.some(b => b.includes("nopevern")));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// CS-MIG-1: cowork@0.3.0 manifest with claude_surface[] entries → aggregator
//           yields contributions including all 32 skill entries + 1 command
//           + 1 claude_md_row (resolvers). v0.32.0 S8 dogfood migration of
//           the legacy skills[] + files[] command shape to claude_surface[].
// ============================================================
async function caseCSMIG1CoworkAggregation() {
  console.log("\n--- Case CS-MIG-1: cowork manifest claude_surface[] yields 34 contributions ---");
  const bpManifestPath = path.join(WORKSHOP, "platform/blueprints/cowork/manifest.json");
  assertTrue("CS-MIG-1: cowork manifest.json exists", fs.existsSync(bpManifestPath));
  const bpMan = JSON.parse(fs.readFileSync(bpManifestPath, "utf8"));

  assertEq("CS-MIG-1: cowork version bumped to 0.3.0", bpMan.version, "0.3.0");
  assertTrue("CS-MIG-1: cowork manifest no longer has skills[] field", !("skills" in bpMan));
  assertTrue("CS-MIG-1: cowork manifest has claude_surface[]", Array.isArray(bpMan.claude_surface));

  const perItemManifest = new Map();
  perItemManifest.set("cowork", bpMan);
  const subscription = {
    mechanisms: [],
    blueprints: [{ name: "cowork", version: "0.3.0" }],
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  assertTrue("CS-MIG-1: cowork in registry.contributions",
    Array.isArray(out.registry.contributions["cowork"]));
  assertEq("CS-MIG-1: cowork has 34 contributions (32 skill + 1 command + 1 claude_md_row)",
    out.registry.contributions["cowork"].length, 34);

  const skillEntries = out.materializeList.filter((e) => e.owner === "cowork" && e.kind === "skill");
  const cmdEntries = out.materializeList.filter((e) => e.owner === "cowork" && e.kind === "command");
  assertEq("CS-MIG-1: 32 skill entries in materializeList", skillEntries.length, 32);
  assertEq("CS-MIG-1: 1 command entry in materializeList", cmdEntries.length, 1);

  // Skill dests should have {{skills_dir}} substituted to ".claude/skills/cowork".
  for (const e of skillEntries) {
    assertTrue(`CS-MIG-1: skill dest ${e.dest} starts with .claude/skills/cowork/`,
      e.dest.startsWith(".claude/skills/cowork/"));
  }

  // claude_md_row resolver entry contributes a single row for cowork.
  const coworkRows = out.rows.resolvers.filter((r) => r.owner === "cowork");
  assertEq("CS-MIG-1: exactly 1 resolver row owned by cowork", coworkRows.length, 1);
  assertEq("CS-MIG-1: cowork resolver topic is 'Cowork'", coworkRows[0].topic, "Cowork");
  assertEq("CS-MIG-1: cowork resolver command is '/cowork'", coworkRows[0].command, "/cowork");
  assertEq("CS-MIG-1: cowork resolver path substituted to spice/cowork",
    coworkRows[0].path, "spice/cowork");
}

// ============================================================
// CS-MIG-2: cowork's .claude/commands/cowork.md materializes from
//           claude_surface[] (kind=command path), not from files[]. The
//           single command entry in cowork's claude_surface[] should be
//           the sole owner of the .claude/commands/cowork.md dest.
// ============================================================
async function caseCSMIG2CoworkCommandFromSurface() {
  console.log("\n--- Case CS-MIG-2: cowork.md command materializes via claude_surface, not files[] ---");
  const bpManifestPath = path.join(WORKSHOP, "platform/blueprints/cowork/manifest.json");
  const bpMan = JSON.parse(fs.readFileSync(bpManifestPath, "utf8"));

  // files[] must NOT contain a .claude/commands/cowork.md entry anymore.
  const filesCmdEntries = (bpMan.files || []).filter(
    (f) => typeof f.dest === "string" && f.dest === ".claude/commands/cowork.md"
  );
  assertEq("CS-MIG-2: files[] no longer has the cowork.md command entry",
    filesCmdEntries.length, 0);

  // claude_surface[] kind=command for that exact dest must be present.
  const csCmdEntries = (bpMan.claude_surface || []).filter(
    (e) => e && e.kind === "command" && e.dest === ".claude/commands/cowork.md"
  );
  assertEq("CS-MIG-2: claude_surface[] has the cowork.md command entry",
    csCmdEntries.length, 1);
  assertEq("CS-MIG-2: command entry source is commands/cowork.md",
    csCmdEntries[0].source, "commands/cowork.md");

  // Aggregator emits one command materialize entry for cowork.md.
  const perItemManifest = new Map();
  perItemManifest.set("cowork", bpMan);
  const subscription = {
    mechanisms: [],
    blueprints: [{ name: "cowork", version: "0.3.0" }],
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  const cmdMat = out.materializeList.filter(
    (e) => e.owner === "cowork" && e.kind === "command" && e.dest === ".claude/commands/cowork.md"
  );
  assertEq("CS-MIG-2: aggregator produced 1 command materialize entry for cowork.md",
    cmdMat.length, 1);
}

// ============================================================
// CS-MIG-3: backwards-compat shim — a synthesized manifest with BOTH legacy
//           skills[] AND new claude_surface[] triggers a deprecation event
//           and merges the shimmed entries into the contributions list.
// ============================================================
async function caseCSMIG3DeprecationShim() {
  console.log("\n--- Case CS-MIG-3: legacy skills[] shimmed; deprecation event emitted ---");
  const perItemManifest = new Map();
  perItemManifest.set("legacy-bp", {
    name: "legacy-bp",
    version: "0.1.0",
    kind: "blueprint",
    module_directory: "legacybp",
    skills_dir: ".claude/skills/legacy",
    // Legacy field — should be shimmed in.
    skills: [
      { source: "skills/foo/SKILL.md", dest: "{{skills_dir}}/foo/SKILL.md" },
      { source: "skills/bar/SKILL.md", dest: "{{skills_dir}}/bar/SKILL.md" },
    ],
    // New field — should coexist with shim entries.
    claude_surface: [
      { kind: "command", source: "commands/legacy.md", dest: ".claude/commands/legacy.md" },
    ],
  });
  const subscription = {
    mechanisms: [],
    blueprints: [{ name: "legacy-bp", version: "0.1.0" }],
  };
  const history = [];
  const out = await aggregateClaudeSurface(perItemManifest, subscription, history, mkGit(), { workshop_version: "0.0.0-test" });

  const deprecations = history.filter(
    (h) => h.event === "deprecation" && h.step === "manifest_skills_legacy"
  );
  assertEq("CS-MIG-3: exactly one deprecation event recorded", deprecations.length, 1);
  assertEq("CS-MIG-3: deprecation event names the offending item",
    deprecations[0].name, "legacy-bp");

  // Contributions include the new command + 2 shimmed skills = 3 total.
  assertTrue("CS-MIG-3: legacy-bp in registry.contributions",
    Array.isArray(out.registry.contributions["legacy-bp"]));
  assertEq("CS-MIG-3: contributions length is 3 (1 command + 2 shimmed skills)",
    out.registry.contributions["legacy-bp"].length, 3);

  // Shimmed skill dests have {{skills_dir}} substituted.
  const shimmedSkills = out.materializeList.filter(
    (e) => e.owner === "legacy-bp" && e.kind === "skill"
  );
  assertEq("CS-MIG-3: 2 shimmed skill entries in materializeList", shimmedSkills.length, 2);
  for (const e of shimmedSkills) {
    assertTrue(`CS-MIG-3: shimmed skill dest ${e.dest} resolved skills_dir`,
      e.dest.startsWith(".claude/skills/legacy/"));
  }
}

// ============================================================
// CS-MAT-1: command kind → .claude/commands/<x>.md with body substitution
// ============================================================
async function caseCSMAT1Command() {
  console.log("\n--- Case CS-MAT-1: command kind materializes with body substitution ---");
  await withTempFixture(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const targetPath = "blueprints/test-bp";
    const sourceDir = path.join(workshop, "platform", targetPath, "commands");
    fs.mkdirSync(sourceDir, { recursive: true });
    // Body content references {{module_directory}} — must be substituted at materialize time.
    fs.writeFileSync(path.join(sourceDir, "foo.md"), "# foo\nrefers to {{module_directory}}/index.md\n");

    const tp = makeTpStub(dir);
    const history = [];
    const matList = [{
      kind: "command",
      source: "commands/foo.md",
      dest: ".claude/commands/foo.md",
      owner: "test-bp",
      version: "0.1.0",
      target_path: targetPath,
      itemVars: { module_directory: "spice/testbp" },
    }];

    await materializeClaudeSurface(matList, tp, workshop, history, { commit: "x", tag: null, dirty: false });

    const destAbs = path.join(dir, ".claude/commands/foo.md");
    assertTrue("CS-MAT-1: dest file exists", fs.existsSync(destAbs));
    const body = fs.readFileSync(destAbs, "utf8");
    assertTrue("CS-MAT-1: body has substituted module_directory", body.includes("spice/testbp/index.md"));
    assertTrue("CS-MAT-1: body has NO literal {{module_directory}}", !body.includes("{{module_directory}}"));
    const events = history.filter((h) => h.event === "claude_surface_install");
    assertEq("CS-MAT-1: one install event recorded", events.length, 1);
    assertEq("CS-MAT-1: event kind is command", events[0].kind, "command");
    assertEq("CS-MAT-1: event dest matches", events[0].dest, ".claude/commands/foo.md");
    assertEq("CS-MAT-1: event owner matches", events[0].owner, "test-bp");
    assertEq("CS-MAT-1: event version matches", events[0].version, "0.1.0");
  });
}

// ============================================================
// CS-MAT-2: skill kind → <skills_dir>/<x>/SKILL.md
// ============================================================
async function caseCSMAT2Skill() {
  console.log("\n--- Case CS-MAT-2: skill kind materializes to <skills_dir>/<x>/SKILL.md ---");
  await withTempFixture(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const targetPath = "mechanisms/test-mech";
    const sourceDir = path.join(workshop, "platform", targetPath, "skills/bar");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "---\nname: bar\n---\nbody\n");

    const tp = makeTpStub(dir);
    const history = [];
    const matList = [{
      kind: "skill",
      source: "skills/bar/SKILL.md",
      dest: ".claude/skills/sauce/bar/SKILL.md",
      owner: "test-mech",
      version: "0.1.0",
      target_path: targetPath,
      itemVars: { skills_dir: ".claude/skills/sauce" },
    }];

    await materializeClaudeSurface(matList, tp, workshop, history, { commit: "x", tag: null, dirty: false });

    const destAbs = path.join(dir, ".claude/skills/sauce/bar/SKILL.md");
    assertTrue("CS-MAT-2: skill SKILL.md exists at dest", fs.existsSync(destAbs));
    const events = history.filter((h) => h.event === "claude_surface_install" && h.kind === "skill");
    assertEq("CS-MAT-2: one skill install event recorded", events.length, 1);
  });
}

// ============================================================
// CS-MAT-3: context_doc kind → <module_dir>/context/<x>.md
// ============================================================
async function caseCSMAT3ContextDoc() {
  console.log("\n--- Case CS-MAT-3: context_doc kind materializes to <module_dir>/context/<x>.md ---");
  await withTempFixture(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const targetPath = "blueprints/project";
    const sourceDir = path.join(workshop, "platform", targetPath, "context");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "PROJECT.md"), "Project context for {{module_directory}}\n");

    const tp = makeTpStub(dir);
    const history = [];
    const matList = [{
      kind: "context_doc",
      source: "context/PROJECT.md",
      dest: "spice/projects/context/PROJECT.md",
      owner: "project",
      version: "1.4.0",
      target_path: targetPath,
      itemVars: { module_directory: "spice/projects" },
    }];

    await materializeClaudeSurface(matList, tp, workshop, history, { commit: "x", tag: null, dirty: false });

    const destAbs = path.join(dir, "spice/projects/context/PROJECT.md");
    assertTrue("CS-MAT-3: context_doc exists at dest", fs.existsSync(destAbs));
    const body = fs.readFileSync(destAbs, "utf8");
    assertTrue("CS-MAT-3: body has substituted module_directory", body.includes("spice/projects"));
  });
}

// ============================================================
// CS-MAT-4: missing source file → error event; other entries still materialize
// ============================================================
async function caseCSMAT4MissingSourceLoopContinues() {
  console.log("\n--- Case CS-MAT-4: missing source logs error; sibling entries still materialize ---");
  await withTempFixture(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const targetPath = "blueprints/bp";
    const sourceDir = path.join(workshop, "platform", targetPath, "commands");
    fs.mkdirSync(sourceDir, { recursive: true });
    // Only sibling source exists — first entry's source is intentionally absent.
    fs.writeFileSync(path.join(sourceDir, "sibling.md"), "# sibling\n");

    const tp = makeTpStub(dir);
    const history = [];
    const matList = [
      {
        kind: "command",
        source: "commands/missing.md",
        dest: ".claude/commands/missing.md",
        owner: "bp",
        version: "0.1.0",
        target_path: targetPath,
        itemVars: {},
      },
      {
        kind: "command",
        source: "commands/sibling.md",
        dest: ".claude/commands/sibling.md",
        owner: "bp",
        version: "0.1.0",
        target_path: targetPath,
        itemVars: {},
      },
    ];

    await materializeClaudeSurface(matList, tp, workshop, history, { commit: "x", tag: null, dirty: false });

    const missingDest = path.join(dir, ".claude/commands/missing.md");
    const siblingDest = path.join(dir, ".claude/commands/sibling.md");
    assertTrue("CS-MAT-4: missing-source dest NOT written", !fs.existsSync(missingDest));
    assertTrue("CS-MAT-4: sibling dest WAS written", fs.existsSync(siblingDest));

    const errs = history.filter((h) => h.event === "error" && h.step === "claude_surface_install");
    assertEq("CS-MAT-4: exactly one error event for the missing source", errs.length, 1);
    const installs = history.filter((h) => h.event === "claude_surface_install");
    assertEq("CS-MAT-4: exactly one successful install event (sibling)", installs.length, 1);
  });
}

// ============================================================
// CS-MAT-5: no orphan .tmp file left behind after success
// ============================================================
async function caseCSMAT5NoTmpLeftBehind() {
  console.log("\n--- Case CS-MAT-5: no orphan .tmp file alongside dest after success ---");
  await withTempFixture(async (dir) => {
    const workshop = path.join(dir, "_fake-workshop");
    const targetPath = "blueprints/bp";
    const sourceDir = path.join(workshop, "platform", targetPath, "commands");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "x.md"), "# x\n");

    const tp = makeTpStub(dir);
    const history = [];
    const matList = [{
      kind: "command",
      source: "commands/x.md",
      dest: ".claude/commands/x.md",
      owner: "bp",
      version: "0.1.0",
      target_path: targetPath,
      itemVars: {},
    }];

    await materializeClaudeSurface(matList, tp, workshop, history, { commit: "x", tag: null, dirty: false });

    const destAbs = path.join(dir, ".claude/commands/x.md");
    const tmpAbs = `${destAbs}.tmp`;
    assertTrue("CS-MAT-5: dest exists after success", fs.existsSync(destAbs));
    assertTrue("CS-MAT-5: no orphan .tmp file beside dest", !fs.existsSync(tmpAbs));
  });
}

// ============================================================
// CS-MD-1: marker pair present → content between markers replaced cleanly;
//          pre/post-marker content preserved verbatim.
// ============================================================
async function caseCSMD1MarkerReplace() {
  console.log("\n--- Case CS-MD-1: marker pair present → content replaced; surrounds preserved ---");
  await withTempFixture(async (dir) => {
    const pre  = "# Project README\n\nIntro paragraph.\n\n";
    const post = "\n\n## Trailing section\n\nbody body body.\n";
    const initial = `${pre}${beginMarker("resolvers")}\nSTALE CONTENT\n${endMarker("resolvers")}${post}`;
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);

    const tp = makeTpStub(dir);
    const history = [];
    const rows = {
      "directory-map": [],
      "resolvers":     [{ topic: "alpha", path: "spice/alpha", command: "/alpha" }],
      "skills-index":  [],
    };
    await regenerateClaudeMd(rows, tp, history, mkGit());

    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    assertTrue("CS-MD-1: pre-marker prose preserved", out.startsWith(pre));
    assertTrue("CS-MD-1: post-marker prose preserved", out.includes(post));
    assertTrue("CS-MD-1: STALE CONTENT no longer present", !out.includes("STALE CONTENT"));
    assertTrue("CS-MD-1: rendered resolver row present", out.includes("| alpha | spice/alpha | /alpha |"));
    assertTrue("CS-MD-1: BEGIN marker preserved", out.includes(beginMarker("resolvers")));
    assertTrue("CS-MD-1: END marker preserved", out.includes(endMarker("resolvers")));
  });
}

// ============================================================
// CS-MD-2: missing marker pair → new section appended at end with markers
// ============================================================
async function caseCSMD2AppendSection() {
  console.log("\n--- Case CS-MD-2: missing marker pair → section appended at end ---");
  await withTempFixture(async (dir) => {
    const initial = "# README\n\nNo markers here.\n";
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);

    const tp = makeTpStub(dir);
    const history = [];
    const rows = {
      "directory-map": [],
      "resolvers":     [{ topic: "beta", path: "spice/beta", command: "/beta" }],
      "skills-index":  [],
    };
    await regenerateClaudeMd(rows, tp, history, mkGit());

    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    assertTrue("CS-MD-2: original prose preserved at start", out.startsWith(initial));
    assertTrue("CS-MD-2: resolvers BEGIN marker appended", out.includes(beginMarker("resolvers")));
    assertTrue("CS-MD-2: resolvers END marker appended",   out.includes(endMarker("resolvers")));
    assertTrue("CS-MD-2: directory-map BEGIN marker appended", out.includes(beginMarker("directory-map")));
    assertTrue("CS-MD-2: skills-index BEGIN marker appended",  out.includes(beginMarker("skills-index")));
    assertTrue("CS-MD-2: resolver row body appended", out.includes("| beta | spice/beta | /beta |"));
  });
}

// ============================================================
// CS-MD-3: half-open marker (BEGIN without END) → throws
// ============================================================
async function caseCSMD3HalfOpenThrows() {
  console.log("\n--- Case CS-MD-3: half-open marker (BEGIN w/o END) → throws explicit Error ---");
  await withTempFixture(async (dir) => {
    const initial = `# README\n\n${beginMarker("resolvers")}\nno end marker here\n`;
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);

    const tp = makeTpStub(dir);
    const history = [];
    const rows = { "directory-map": [], "resolvers": [], "skills-index": [] };
    let threw = false;
    let msg = "";
    try {
      await regenerateClaudeMd(rows, tp, history, mkGit());
    } catch (e) {
      threw = true;
      msg = e && e.message ? e.message : "";
    }
    assertTrue("CS-MD-3: regenerateClaudeMd threw on half-open marker", threw);
    assertTrue("CS-MD-3: error message mentions half-open / matching", /half-open|matching/i.test(msg));
  });
}

// ============================================================
// CS-MD-4: content OUTSIDE markers preserved bit-for-bit
// ============================================================
async function caseCSMD4OutsideBitForBit() {
  console.log("\n--- Case CS-MD-4: outside-marker content preserved bit-for-bit ---");
  await withTempFixture(async (dir) => {
    const pre  = "# Top\n\nLine one.\nLine two with `code`.\n\n";
    const mid  = `${beginMarker("resolvers")}\nold\n${endMarker("resolvers")}`;
    const post = "\n\nTail: 0xDEADBEEF  NBSP—em-dash.\n";
    const initial = `${pre}${mid}${post}`;
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);

    const tp = makeTpStub(dir);
    const history = [];
    const rows = {
      "directory-map": [],
      "resolvers":     [{ topic: "x", path: "y", command: "/z" }],
      "skills-index":  [],
    };
    await regenerateClaudeMd(rows, tp, history, mkGit());
    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");

    // Locate the new resolvers block in `out`; everything before its BEGIN
    // marker must equal `pre`, and everything after its END marker must
    // contain `post` somewhere (the renderer may append the OTHER two tables
    // after, with a leading newline between them).
    const bIdx = out.indexOf(beginMarker("resolvers"));
    const eIdx = out.indexOf(endMarker("resolvers"));
    assertTrue("CS-MD-4: both resolver markers found", bIdx !== -1 && eIdx !== -1 && eIdx > bIdx);
    const outPre  = out.substring(0, bIdx);
    const outPost = out.substring(eIdx + endMarker("resolvers").length);
    assertEq("CS-MD-4: pre-marker bytes identical", outPre, pre);
    assertTrue("CS-MD-4: post-marker prose still embedded verbatim", outPost.includes(post));
  });
}

// ============================================================
// CS-MD-5: pre-seeded directory-map rows always present, even with zero
//          contributed rows
// ============================================================
async function caseCSMD5SeedRows() {
  console.log("\n--- Case CS-MD-5: pre-seeded directory-map rows present with zero contributions ---");
  await withTempFixture(async (dir) => {
    const initial = `# R\n\n${beginMarker("directory-map")}\nstale\n${endMarker("directory-map")}\n`;
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);
    const tp = makeTpStub(dir);
    const history = [];
    const rows = { "directory-map": [], "resolvers": [], "skills-index": [] };
    await regenerateClaudeMd(rows, tp, history, mkGit());
    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");

    assertTrue("CS-MD-5: spice/ seed row present", out.includes("| spice/ | (platform) |"));
    assertTrue("CS-MD-5: ranch/ seed row present", out.includes("| ranch/ | (platform) |"));
    assertTrue("CS-MD-5: .claude/commands/ seed row present", out.includes("| .claude/commands/ | (platform) |"));
    assertTrue("CS-MD-5: .claude/skills/ seed row present",  out.includes("| .claude/skills/ | (platform) |"));
  });
}

// ============================================================
// CS-MD-6: alphabetic order preserved across contributed rows (resolvers).
//          The aggregator pre-sorts; the renderer must not re-order or
//          mangle the ordering.
// ============================================================
async function caseCSMD6AlphabeticOrder() {
  console.log("\n--- Case CS-MD-6: alphabetic order honored within resolvers table ---");
  await withTempFixture(async (dir) => {
    const initial = `# R\n${beginMarker("resolvers")}\nstale\n${endMarker("resolvers")}\n`;
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);
    const tp = makeTpStub(dir);
    const history = [];
    // Aggregator sorts; here we simulate already-sorted input (Apple < Zebra).
    const rows = {
      "directory-map": [],
      "resolvers":     [
        { topic: "Apple", path: "spice/apple", command: "/apple" },
        { topic: "Zebra", path: "spice/zebra", command: "/zebra" },
      ],
      "skills-index":  [],
    };
    await regenerateClaudeMd(rows, tp, history, mkGit());
    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");
    const aIdx = out.indexOf("| Apple |");
    const zIdx = out.indexOf("| Zebra |");
    assertTrue("CS-MD-6: Apple row present", aIdx !== -1);
    assertTrue("CS-MD-6: Zebra row present", zIdx !== -1);
    assertTrue("CS-MD-6: Apple appears before Zebra", aIdx < zIdx);
  });
}

// ============================================================
// CS-MD-7: markdown-table shape — headers, separator, data rows all correctly
//          formatted for each of the three tables.
// ============================================================
async function caseCSMD7TableShape() {
  console.log("\n--- Case CS-MD-7: rendered table shape (headers, separator, data rows) ---");
  await withTempFixture(async (dir) => {
    // Seed all three marker pairs so we replace rather than append.
    const initial = [
      "# R",
      `${beginMarker("directory-map")}`,
      "stale",
      `${endMarker("directory-map")}`,
      `${beginMarker("resolvers")}`,
      "stale",
      `${endMarker("resolvers")}`,
      `${beginMarker("skills-index")}`,
      "stale",
      `${endMarker("skills-index")}`,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), initial);
    const tp = makeTpStub(dir);
    const history = [];
    const rows = {
      "directory-map": [{ path: "spice/x", owner: "x", purpose: "test row" }],
      "resolvers":     [{ topic: "alpha", path: "spice/a", command: "/a" }],
      "skills-index":  [{ command: "/foo", skill_path: ".claude/skills/sauce/foo/SKILL.md", owner: "foo" }],
    };
    await regenerateClaudeMd(rows, tp, history, mkGit());
    const out = fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8");

    // directory-map headers + separator
    assertTrue("CS-MD-7: directory-map header present", out.includes("| Path | Blueprint | Purpose |"));
    // resolvers headers
    assertTrue("CS-MD-7: resolvers header present",     out.includes("| Topic | Path | Slash command |"));
    // skills-index headers
    assertTrue("CS-MD-7: skills-index header present",  out.includes("| Command | SKILL.md | Blueprint/Mechanism |"));
    // each header followed by separator row "| --- | --- | --- |"
    const sepCount = (out.match(/\| --- \| --- \| --- \|/g) || []).length;
    assertTrue("CS-MD-7: at least three separator rows present (one per table)", sepCount >= 3);

    // claude_md_regen event recorded
    const evts = history.filter((h) => h.event === "claude_md_regen");
    assertEq("CS-MD-7: one regen event recorded", evts.length, 1);
    assertTrue("CS-MD-7: regen event lists all three tables",
      evts[0].tables_updated && evts[0].tables_updated.length === 3 &&
      evts[0].tables_updated.includes("directory-map") &&
      evts[0].tables_updated.includes("resolvers") &&
      evts[0].tables_updated.includes("skills-index"));
  });
}

// ============================================================
// CS-PR-1: owner present in prev registry but absent from new → all of its
//          file-kind dests are deleted from the filesystem.
// ============================================================
async function caseCSPR1OwnerGone() {
  console.log("\n--- Case CS-PR-1: owner removed → all its dest files deleted ---");
  await withTempFixture(async (dir) => {
    // Pre-seed two on-disk files that the prev registry claims belong to "old-bp".
    const fileA = ".claude/commands/old-a.md";
    const fileB = ".claude/skills/sauce/old-b/SKILL.md";
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".claude/skills/sauce/old-b"), { recursive: true });
    fs.writeFileSync(path.join(dir, fileA), "# old A\n");
    fs.writeFileSync(path.join(dir, fileB), "# old B SKILL\n");

    const prev = {
      schema_version: 1,
      contributions: {
        "old-bp": [
          { kind: "command", source: "commands/old-a.md", dest: fileA, version: "0.1.0" },
          { kind: "skill", source: "skills/old-b/SKILL.md", dest: fileB, version: "0.1.0" },
        ],
      },
    };
    const next = { schema_version: 1, contributions: {} };

    const tp = makeTpStub(dir);
    const history = [];
    await pruneClaudeSurface(prev, next, tp, history, mkGit());

    assertTrue("CS-PR-1: old-a.md deleted", !fs.existsSync(path.join(dir, fileA)));
    assertTrue("CS-PR-1: old-b SKILL.md deleted", !fs.existsSync(path.join(dir, fileB)));
    const evts = history.filter((h) => h.event === "claude_surface_prune");
    assertEq("CS-PR-1: two prune events recorded", evts.length, 2);
    assertTrue("CS-PR-1: prune event names removed_from owner",
      evts.every((e) => e.removed_from === "old-bp"));
  });
}

// ============================================================
// CS-PR-2: owner shared between prev and new but new has fewer entries →
//          orphan entries (in prev[owner] but not new[owner], keyed by dest)
//          are deleted; surviving entries' files are NOT touched.
// ============================================================
async function caseCSPR2OrphanEntries() {
  console.log("\n--- Case CS-PR-2: shared owner, orphan entries deleted ---");
  await withTempFixture(async (dir) => {
    const kept = ".claude/commands/kept.md";
    const dropped = ".claude/commands/dropped.md";
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, kept), "# kept\n");
    fs.writeFileSync(path.join(dir, dropped), "# dropped\n");

    const prev = {
      schema_version: 1,
      contributions: {
        "bp": [
          { kind: "command", source: "commands/kept.md", dest: kept, version: "0.1.0" },
          { kind: "command", source: "commands/dropped.md", dest: dropped, version: "0.1.0" },
        ],
      },
    };
    const next = {
      schema_version: 1,
      contributions: {
        "bp": [
          { kind: "command", source: "commands/kept.md", dest: kept, version: "0.2.0" },
        ],
      },
    };

    const tp = makeTpStub(dir);
    const history = [];
    await pruneClaudeSurface(prev, next, tp, history, mkGit());

    assertTrue("CS-PR-2: kept.md preserved", fs.existsSync(path.join(dir, kept)));
    assertTrue("CS-PR-2: dropped.md deleted", !fs.existsSync(path.join(dir, dropped)));
    const evts = history.filter((h) => h.event === "claude_surface_prune");
    assertEq("CS-PR-2: one prune event recorded (only dropped)", evts.length, 1);
    assertEq("CS-PR-2: prune event dest matches dropped", evts[0].dest, dropped);
  });
}

// ============================================================
// CS-PR-3: malformed prev registry (no contributions field) → warning event
//          emitted; no abort.
// ============================================================
async function caseCSPR3MalformedPrev() {
  console.log("\n--- Case CS-PR-3: malformed prev registry → warning event, no abort ---");
  await withTempFixture(async (dir) => {
    const tp = makeTpStub(dir);
    const history = [];
    // Shape: not an object — array.
    let threw = false;
    try {
      await pruneClaudeSurface(["not", "an", "object"], { schema_version: 1, contributions: {} }, tp, history, mkGit());
    } catch (_e) { threw = true; }
    assertTrue("CS-PR-3: did NOT throw on malformed prev", !threw);
    const warnings = history.filter((h) => h.event === "warning" && h.step === "claude_surface_prune_malformed_prev");
    assertEq("CS-PR-3: warning event recorded", warnings.length, 1);

    // Second flavor: object missing contributions field.
    const history2 = [];
    await pruneClaudeSurface({ schema_version: 1 }, { schema_version: 1, contributions: {} }, tp, history2, mkGit());
    const warnings2 = history2.filter((h) => h.event === "warning" && h.step === "claude_surface_prune_malformed_prev");
    assertEq("CS-PR-3: warning event for missing contributions", warnings2.length, 1);
  });
}

// ============================================================
// CS-SH-1: .claude/commands.local/foo.md overrides .claude/commands/foo.md
// ============================================================
async function caseCSSH1CommandShadow() {
  console.log("\n--- Case CS-SH-1: commands.local/foo.md overwrites canonical ---");
  await withTempFixture(async (dir) => {
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".claude/commands.local"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/commands/foo.md"), "# CANONICAL\n");
    fs.writeFileSync(path.join(dir, ".claude/commands.local/foo.md"), "# LOCAL OVERRIDE\n");

    const tp = makeTpStub(dir);
    const history = [];
    await applyLocalShadows(tp, history, mkGit());

    const body = fs.readFileSync(path.join(dir, ".claude/commands/foo.md"), "utf8");
    assertEq("CS-SH-1: canonical replaced with local content", body, "# LOCAL OVERRIDE\n");
    const evts = history.filter((h) => h.event === "claude_local_shadow");
    assertEq("CS-SH-1: one shadow event recorded", evts.length, 1);
    assertEq("CS-SH-1: event kind is command", evts[0].kind, "command");
    assertEq("CS-SH-1: event dest matches canonical", evts[0].dest, ".claude/commands/foo.md");
  });
}

// ============================================================
// CS-SH-2: nested skills.local/<bp>/<x>/SKILL.md shadows canonical
// ============================================================
async function caseCSSH2SkillShadow() {
  console.log("\n--- Case CS-SH-2: skills.local/<bp>/<x>/SKILL.md overwrites canonical ---");
  await withTempFixture(async (dir) => {
    const canonRel = ".claude/skills/sauce/bar/SKILL.md";
    const localRel = ".claude/skills.local/sauce/bar/SKILL.md";
    fs.mkdirSync(path.join(dir, path.dirname(canonRel)), { recursive: true });
    fs.mkdirSync(path.join(dir, path.dirname(localRel)), { recursive: true });
    fs.writeFileSync(path.join(dir, canonRel), "---\nname: bar\n---\nCANONICAL BODY\n");
    fs.writeFileSync(path.join(dir, localRel), "---\nname: bar\n---\nLOCAL BODY\n");

    const tp = makeTpStub(dir);
    const history = [];
    await applyLocalShadows(tp, history, mkGit());

    const body = fs.readFileSync(path.join(dir, canonRel), "utf8");
    assertTrue("CS-SH-2: canonical now contains LOCAL BODY", body.includes("LOCAL BODY"));
    assertTrue("CS-SH-2: canonical no longer contains CANONICAL BODY", !body.includes("CANONICAL BODY"));
    const evts = history.filter((h) => h.event === "claude_local_shadow" && h.kind === "skill");
    assertEq("CS-SH-2: one skill shadow event recorded", evts.length, 1);
    assertEq("CS-SH-2: event dest matches canonical", evts[0].dest, canonRel);
  });
}

// ============================================================
// CS-SH-3: no .local/ directories → no error events, no shadow events.
// ============================================================
async function caseCSSH3NoLocalDirs() {
  console.log("\n--- Case CS-SH-3: no .local/ directories → silent no-op ---");
  await withTempFixture(async (dir) => {
    // Vault has nothing under .claude/.
    const tp = makeTpStub(dir);
    const history = [];
    await applyLocalShadows(tp, history, mkGit());

    const errs = history.filter((h) => h.event === "error");
    assertEq("CS-SH-3: no error events", errs.length, 0);
    const shadows = history.filter((h) => h.event === "claude_local_shadow");
    assertEq("CS-SH-3: no shadow events", shadows.length, 0);
  });
}

// ============================================================
// CS-SH-4: ordering check — local content replaces canonical even when
//          materialize wrote the canonical first. We simulate materialize by
//          writing a "canonical" string, then apply shadows; final content
//          must equal the .local/ content.
// ============================================================
async function caseCSSH4OrderingMaterializeThenShadow() {
  console.log("\n--- Case CS-SH-4: shadow OVERWRITES content written by materialize ---");
  await withTempFixture(async (dir) => {
    const canonRel = ".claude/commands/baz.md";
    const localRel = ".claude/commands.local/baz.md";
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, ".claude/commands.local"), { recursive: true });

    // Step 1: simulate materializeClaudeSurface writing the canonical body.
    fs.writeFileSync(path.join(dir, canonRel), "# CANONICAL (materialized)\n");
    // Step 2: .local/ shadow body that should win.
    fs.writeFileSync(path.join(dir, localRel), "# LOCAL WINS\n");

    const tp = makeTpStub(dir);
    const history = [];
    await applyLocalShadows(tp, history, mkGit());

    const finalBody = fs.readFileSync(path.join(dir, canonRel), "utf8");
    assertEq("CS-SH-4: final canonical equals .local/ content", finalBody, "# LOCAL WINS\n");
  });
}

async function main() {
  if (typeof aggregateClaudeSurface !== "function") {
    console.error("FATAL: aggregateClaudeSurface is not exported from install.js");
    process.exit(1);
  }
  if (typeof materializeClaudeSurface !== "function") {
    console.error("FATAL: materializeClaudeSurface is not exported from install.js");
    process.exit(1);
  }
  if (typeof pruneClaudeSurface !== "function") {
    console.error("FATAL: pruneClaudeSurface is not exported from install.js");
    process.exit(1);
  }
  if (typeof applyLocalShadows !== "function") {
    console.error("FATAL: applyLocalShadows is not exported from install.js");
    process.exit(1);
  }
  if (typeof regenerateClaudeMd !== "function") {
    console.error("FATAL: regenerateClaudeMd is not exported from claude-md-renderer.js");
    process.exit(1);
  }

  await caseCSAG1Empty();
  await caseCSAG2ThreeKinds();
  await caseCSAG3ModuleDirSub();
  await caseCSAG4SkillsDirSub();
  await caseCSAG5DestPathRejected();
  await caseCSAG6RowSort();
  await caseCSAG7Unsubscribed();
  await caseCSSUB1PlatformClaudeIncluded();
  await caseCSSUB2PlatformClaudeExcluded();
  await caseCSSUB3VerbsExist();
  await caseCSMIG1CoworkAggregation();
  await caseCSMIG2CoworkCommandFromSurface();
  await caseCSMIG3DeprecationShim();
  await caseCSMAT1Command();
  await caseCSMAT2Skill();
  await caseCSMAT3ContextDoc();
  await caseCSMAT4MissingSourceLoopContinues();
  await caseCSMAT5NoTmpLeftBehind();
  await caseCSMD1MarkerReplace();
  await caseCSMD2AppendSection();
  await caseCSMD3HalfOpenThrows();
  await caseCSMD4OutsideBitForBit();
  await caseCSMD5SeedRows();
  await caseCSMD6AlphabeticOrder();
  await caseCSMD7TableShape();
  await caseCSPR1OwnerGone();
  await caseCSPR2OrphanEntries();
  await caseCSPR3MalformedPrev();
  await caseCSSH1CommandShadow();
  await caseCSSH2SkillShadow();
  await caseCSSH3NoLocalDirs();
  await caseCSSH4OrderingMaterializeThenShadow();

  console.log("\n========================================");
  console.log(`run-claude-surface: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    for (const f of failures) console.log(f);
    process.exit(1);
  }
  console.log("ALL GREEN");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
