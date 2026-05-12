#!/usr/bin/env node
/**
 * Audit harness — TDD-RED baseline (v0.29.0 S1)
 *
 * 32 cases across 12 logical selectors. References platform/audit/* +
 * platform/cli/cmd-audit modules. At S1 close cmd-audit.js exists as a
 * stub but platform/audit/{walker,rule-runner,report,sanctioned-dirs}.js
 * do NOT — so most cases FAIL with "Cannot find module ../audit/walker".
 * S2 implementation flips them GREEN.
 *
 * Selectors: trips | project | people | meetings | daily | untracked |
 *            flags | errors | predicates | exits | report | positive |
 *            all (default)
 */

const fs = require("fs"), path = require("path"), os = require("os");
const ROOT = path.resolve(__dirname, "../..");
let passed = 0, failed = 0;

function assertEqual(a, b, msg) { if (a !== b) { failed++; console.error(`FAIL ${msg}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); } else passed++; }
function assertTrue(c, msg)     { if (!c)      { failed++; console.error(`FAIL ${msg}`); } else passed++; }
function assertContains(haystack, needle, msg) { if (!String(haystack).includes(needle)) { failed++; console.error(`FAIL ${msg}: ${JSON.stringify(haystack).slice(0,200)} does not contain ${JSON.stringify(needle)}`); } else passed++; }
async function withTempVault(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-audit-")); try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); } }

function makeSauceVault(dir, opts = {}) {
  // Creates ranch/platform-installed.json + ranch/rules/<bp>.json files
  // opts: { blueprints: ["trips","project",...], rules: {trips: {...}, ...} }
  const installed = { blueprints: opts.blueprints || ["trips","project","people","meetings","daily"], mechanisms: [], workshop_version: "0.29.0" };
  fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"), JSON.stringify(installed, null, 2));
  fs.mkdirSync(path.join(dir, "ranch/rules"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ranch/rules/_global.json"), JSON.stringify({contributions: {}}, null, 2));
  for (const [bp, fragment] of Object.entries(opts.rules || {})) {
    fs.writeFileSync(path.join(dir, `ranch/rules/${bp}.json`), JSON.stringify({contributions: {[bp]: fragment}}, null, 2));
  }
  for (const bp of installed.blueprints) {
    fs.mkdirSync(path.join(dir, `spice/${bp}`), { recursive: true });
  }
}

function writeNote(dir, relPath, frontmatter, body = "") {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  let fm = "---\n";
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      if (v.length === 0) { fm += `${k}: []\n`; }   // empty list → inline form (YAML "key:" alone is null, not empty list)
      else { fm += `${k}:\n`; for (const x of v) fm += `  - ${JSON.stringify(x)}\n`; }
    } else {
      fm += `${k}: ${JSON.stringify(v)}\n`;
    }
  }
  fm += "---\n" + body;
  fs.writeFileSync(full, fm);
}

// AU1 — trips entity missing start_date frontmatter
async function caseAU1() {
  await withTempVault(async (dir) => {
    const tripsRules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_frontmatter: { start_date: { required: true, type: "string" } },
      required_tags: [{ tag: "trip" }]
    }];
    makeSauceVault(dir, { rules: { trips: tripsRules } });
    writeNote(dir, "spice/trips/2026-paris/Trip Atlas.md",
      { type: "trip", end_date: "2026-06-15", location: "Paris", tags: ["trip"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const tripsViolations = result.violations.filter(v => v.blueprint === "trips");
    assertTrue(tripsViolations.some(v => v.rule === "required_frontmatter.start_date"), "AU1: start_date violation surfaced");
  });
}

// AU2 — trips entity wrong type value (equals predicate)
async function caseAU2() {
  await withTempVault(async (dir) => {
    const tripsRules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_frontmatter: { type: { required: true, type: "string", equals: "trip" } }
    }];
    makeSauceVault(dir, { rules: { trips: tripsRules } });
    writeNote(dir, "spice/trips/2026-paris/Trip Atlas.md",
      { type: "vacation", start_date: "2026-06-01", end_date: "2026-06-15", location: "Paris", tags: ["trip"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.type.equals"), "AU2: equals predicate violation surfaced");
  });
}

// AU3 — trips entity missing required tag
async function caseAU3() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_tags: [{ tag: "trip" }]
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/2026-paris/Trip Atlas.md",
      { type: "trip", tags: ["vacation"] });  // missing "trip" tag
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing" && v.message.includes("trip")), "AU3: required tag violation");
  });
}

// AU4 — project entity missing description
async function caseAU4() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/Project.md" },
      required_frontmatter: { description: { required: true, type: "string" } }
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    writeNote(dir, "spice/projects/widget/Project.md",
      { created: "2026-05-01", workstreams: [], tags: ["project"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.description"), "AU4: project description missing");
  });
}

// AU5 — project entity wrong tag (positive: "project" present matches)
async function caseAU5() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/Project.md" },
      required_tags: [{ tag: "project" }]
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    writeNote(dir, "spice/projects/widget/Project.md",
      { tags: ["initiative"] });  // missing "project" tag
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing"), "AU5: project tag missing");
  });
}

// AU6 — people entity wrong naming pattern
async function caseAU6() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/people/*.md", exclude_basenames: ["People.md"] },
      naming_pattern: "^[A-Z][a-zA-Z'\\- ]+ [A-Z][a-zA-Z'\\- ]+\\.md$"
    }];
    makeSauceVault(dir, { rules: { people: rules } });
    writeNote(dir, "spice/people/john-doe.md", { tags: ["person"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "naming_pattern" && v.file.endsWith("john-doe.md")), "AU6: naming pattern violation");
  });
}

// AU7 — people hub excluded from naming pattern check (positive)
async function caseAU7() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/people/*.md", exclude_basenames: ["People.md"] },
      naming_pattern: "^[A-Z][a-zA-Z'\\- ]+ [A-Z][a-zA-Z'\\- ]+\\.md$"
    }];
    makeSauceVault(dir, { rules: { people: rules } });
    writeNote(dir, "spice/people/People.md", { tags: ["people-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const peopleViolations = result.violations.filter(v => v.blueprint === "people" && v.rule === "naming_pattern");
    assertEqual(peopleViolations.length, 0, "AU7: People.md hub excluded from naming check");
  });
}

// AU8 — meetings frontmatter_branch — type:meeting path
async function caseAU8() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/meetings/notes/**/*.md" },
      frontmatter_branch: [{
        when: { frontmatter: { type: "meeting" } },
        required_frontmatter: { date: { required: true, type: "string" } }
      }]
    }];
    makeSauceVault(dir, { rules: { meetings: rules } });
    writeNote(dir, "spice/meetings/notes/2026-05/test.md",
      { type: "meeting", tags: ["meeting"] });  // missing date
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.date"), "AU8: meeting branch fired");
  });
}

// AU9 — meetings frontmatter_branch — tags:meetings-hub path
async function caseAU9() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/meetings/hubs/**/*.md" },
      frontmatter_branch: [{
        when: { tags_contains: "meetings-hub" },
        required_tags: [{ tag: "meetings-hub" }]
      }]
    }];
    makeSauceVault(dir, { rules: { meetings: rules } });
    writeNote(dir, "spice/meetings/hubs/2026-05.md",
      { tags: ["wrong-tag"] });  // missing meetings-hub tag → branch shouldn't fire either
    // Verify the branch DOESN'T fire when when-predicate fails
    writeNote(dir, "spice/meetings/hubs/2026-06.md",
      { tags: ["meetings-hub"] });  // matches when-predicate but tags satisfy required → no violation
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.blueprint === "meetings");
    assertEqual(violations.length, 0, "AU9: hub branch first-match resolution OK");
  });
}

// AU10 — daily wrong filename
async function caseAU10() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/daily/**/*.md" },
      naming_pattern: "^\\d{4}-\\d{2}-\\d{2}\\.md$"
    }];
    makeSauceVault(dir, { rules: { daily: rules } });
    writeNote(dir, "spice/daily/2026/may-1.md", { tags: ["daily"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "naming_pattern" && v.file.endsWith("may-1.md")), "AU10: daily filename violation");
  });
}

// AU11 — daily missing required tag
async function caseAU11() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/daily/**/*.md" },
      required_tags: [{ tag: "daily" }]
    }];
    makeSauceVault(dir, { rules: { daily: rules } });
    writeNote(dir, "spice/daily/2026/2026-05-01.md", { tags: ["journal"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing"), "AU11: daily tag missing");
  });
}

// AU12 — untracked top-level dir flagged
async function caseAU12() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    fs.mkdirSync(path.join(dir, "Timestamps"));
    fs.writeFileSync(path.join(dir, "Timestamps/old.md"), "---\n---\nlegacy");
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: true });
    assertTrue(result.untracked.some(d => d.name === "Timestamps"), "AU12: Timestamps flagged as untracked");
  });
}

// AU13 — sanctioned dirs not flagged (positive)
async function caseAU13() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    // spice/, ranch/ already exist; create the others
    for (const name of ["pantry", "assets", ".obsidian", ".claude"]) fs.mkdirSync(path.join(dir, name));
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: true });
    assertEqual(result.untracked.length, 0, "AU13: sanctioned dirs not flagged");
  });
}

// AU14 — --no-untracked-check skips scan
async function caseAU14() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    fs.mkdirSync(path.join(dir, "Garbage"));
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.untracked.length, 0, "AU14: --no-untracked-check skips scan");
  });
}

// AU15 — --blueprint <name> filters
async function caseAU15() {
  await withTempVault(async (dir) => {
    const tripsRules = [{ scope: { path_glob: "spice/trips/*/Trip Atlas.md" }, required_tags: [{ tag: "trip" }] }];
    const dailyRules = [{ scope: { path_glob: "spice/daily/**/*.md" }, required_tags: [{ tag: "daily" }] }];
    makeSauceVault(dir, { rules: { trips: tripsRules, daily: dailyRules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { tags: [] });   // missing tag
    writeNote(dir, "spice/daily/2026/2026-05-01.md", { tags: [] }); // missing tag
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false, blueprintFilter: "trips" });
    assertEqual(result.violations.filter(v => v.blueprint === "trips").length, 1, "AU15: trips filter includes trips");
    assertEqual(result.violations.filter(v => v.blueprint === "daily").length, 0, "AU15: trips filter excludes daily");
  });
}

// AU16 — --output-file writes report + emits one-line summary
async function caseAU16() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    const outFile = path.join(dir, "audit-report.md");
    const cmdAudit = require("../cli/cmd-audit");
    const summary = await cmdAudit._runForTest({ vaultPath: dir, outputFile: outFile, untrackedCheck: false });
    assertTrue(fs.existsSync(outFile), "AU16: output file written");
    assertTrue(fs.readFileSync(outFile, "utf8").includes("# Audit report"), "AU16: report markdown structure");
    assertContains(summary, "audit:", "AU16: stdout summary line");
  });
}

// AU17 — vault not sauce → exit 2
async function caseAU17() {
  await withTempVault(async (dir) => {
    // No ranch/platform-installed.json — not a sauce vault
    const cmdAudit = require("../cli/cmd-audit");
    let exitCode = null;
    try { await cmdAudit._runForTest({ vaultPath: dir, untrackedCheck: false }); } catch (e) { exitCode = e.exitCode; }
    assertEqual(exitCode, 2, "AU17: exit 2 when not a sauce vault");
  });
}

// AU18 — missing rules file → warning, continue
async function caseAU18() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});  // platform-installed declares trips installed but no trips.json
    const installed = JSON.parse(fs.readFileSync(path.join(dir, "ranch/platform-installed.json"), "utf8"));
    installed.blueprints = ["trips"];
    fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"), JSON.stringify(installed));
    // Don't create ranch/rules/trips.json
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.warnings.some(w => w.includes("trips") && w.includes("rules file")), "AU18: missing-rules warning");
  });
}

// AU19 — malformed YAML → recorded violation, continue walking
async function caseAU19() {
  await withTempVault(async (dir) => {
    const rules = [{ scope: { path_glob: "spice/trips/**/*.md" } }];
    makeSauceVault(dir, { rules: { trips: rules } });
    fs.mkdirSync(path.join(dir, "spice/trips/broken"), { recursive: true });
    fs.writeFileSync(path.join(dir, "spice/trips/broken/Trip Atlas.md"), "---\nstart_date: not\n  - a list\n  but: dict\n---\nbody");
    fs.mkdirSync(path.join(dir, "spice/trips/ok"), { recursive: true });
    fs.writeFileSync(path.join(dir, "spice/trips/ok/Trip Atlas.md"), "---\nstart_date: 2026-06-01\n---\nbody");
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "frontmatter_parse"), "AU19: malformed YAML recorded as violation");
    // walker continues to the OK file (didn't crash)
    assertTrue(result.scanned >= 2, "AU19: walker continues after malformed");
  });
}

// AU20 — equals predicate
async function caseAU20() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_frontmatter: { type: { required: true, type: "string", equals: "trip" } }
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { type: "trip" });
    writeNote(dir, "spice/trips/y/Trip Atlas.md", { type: "vacation" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const eqViolations = result.violations.filter(v => v.rule === "required_frontmatter.type.equals");
    assertEqual(eqViolations.length, 1, "AU20: equals predicate fires only when value mismatch");
  });
}

// AU21 — matches predicate (regex)
async function caseAU21() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_frontmatter: { start_date: { required: true, type: "string", matches: "^\\d{4}-\\d{2}-\\d{2}$" } }
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { start_date: "2026-05-01" });   // matches
    writeNote(dir, "spice/trips/y/Trip Atlas.md", { start_date: "May 1, 2026" });  // doesn't match
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "required_frontmatter.start_date.matches").length, 1, "AU21: matches predicate fires only on regex miss");
  });
}

// AU22 — contains predicate (list)
async function caseAU22() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/Trips.md" },
      required_frontmatter: { cssclasses: { required: true, type: "list", contains: ["wide", "cards"] } }
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/Trips.md", { cssclasses: ["wide"] });   // missing "cards"
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.cssclasses.contains"), "AU22: contains predicate fires on missing element");
  });
}

// AU23 — path_glob predicate matches
async function caseAU23() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_tags: [{ tag: "trip" }]
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { tags: [] });        // matches glob → should violate
    writeNote(dir, "spice/trips/x/Trip Flights.md", { tags: [] });      // doesn't match glob → no violation
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "required_tags.missing").length, 1, "AU23: path_glob limits scope");
  });
}

// AU24 — exclude_basenames predicate
async function caseAU24() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/people/*.md", exclude_basenames: ["People.md"] },
      naming_pattern: "^[A-Z]"  // any capital first char
    }];
    makeSauceVault(dir, { rules: { people: rules } });
    writeNote(dir, "spice/people/Jane Doe.md", {});                  // matches → no violation
    writeNote(dir, "spice/people/People.md", {});                    // excluded → no violation
    writeNote(dir, "spice/people/lowercase-bad.md", {});             // matches glob, not excluded, naming fails → violation
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "naming_pattern").length, 1, "AU24: exclude_basenames excludes hub");
  });
}

// AU25 — frontmatter_branch first-match wins
async function caseAU25() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/meetings/**/*.md" },
      frontmatter_branch: [
        { when: { frontmatter: { type: "meeting" } }, required_tags: [{ tag: "meeting" }] },
        { when: { tags_contains: "meetings-hub" }, required_tags: [{ tag: "meetings-hub" }] }
      ]
    }];
    makeSauceVault(dir, { rules: { meetings: rules } });
    writeNote(dir, "spice/meetings/notes/A.md", { type: "meeting", tags: ["meeting", "meetings-hub"] });  // matches BOTH branches' when-predicates; first-match resolution → meeting branch fires; tags satisfy that branch's required_tags → 0 violations
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    // First branch matches: required_tags includes "meeting"; "meetings-hub" present but not required by first branch.
    // Since file has both tags, neither branch's required_tags is missing. Expect zero violations.
    assertEqual(result.violations.filter(v => v.blueprint === "meetings").length, 0, "AU25: first-match resolution applied");
  });
}

// AU26 — exit 0 when no violations
async function caseAU26() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    const cmdAudit = require("../cli/cmd-audit");
    const exitCode = await cmdAudit._runForTest({ vaultPath: dir, untrackedCheck: false }).then(() => 0).catch(e => e.exitCode);
    assertEqual(exitCode, 0, "AU26: exit 0 when clean");
  });
}

// AU27 — exit 1 when violations
async function caseAU27() {
  await withTempVault(async (dir) => {
    const rules = [{ scope: { path_glob: "spice/trips/**/*.md" }, required_tags: [{ tag: "trip" }] }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { tags: [] });
    const cmdAudit = require("../cli/cmd-audit");
    let exitCode = null;
    try { await cmdAudit._runForTest({ vaultPath: dir, untrackedCheck: false }); exitCode = 0; } catch (e) { exitCode = e.exitCode; }
    assertEqual(exitCode, 1, "AU27: exit 1 when violations");
  });
}

// AU28 — --quiet suppresses output, preserves exit code
async function caseAU28() {
  await withTempVault(async (dir) => {
    const rules = [{ scope: { path_glob: "spice/trips/**/*.md" }, required_tags: [{ tag: "trip" }] }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { tags: [] });
    const cmdAudit = require("../cli/cmd-audit");
    let stdoutContent = "";
    const origWrite = process.stdout.write;
    process.stdout.write = (s) => { stdoutContent += s; return true; };
    let exitCode = 0;
    try { await cmdAudit._runForTest({ vaultPath: dir, untrackedCheck: false, quiet: true }); } catch (e) { exitCode = e.exitCode; }
    process.stdout.write = origWrite;
    assertEqual(exitCode, 1, "AU28: quiet preserves exit");
    assertEqual(stdoutContent, "", "AU28: quiet suppresses stdout");
  });
}

// AU29 — report markdown structure
async function caseAU29() {
  await withTempVault(async (dir) => {
    const rules = [{ scope: { path_glob: "spice/trips/**/*.md" }, required_tags: [{ tag: "trip" }] }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/x/Trip Atlas.md", { tags: [] });
    fs.mkdirSync(path.join(dir, "Garbage"));
    const { runAudit } = require("../audit/walker");
    const { formatReport } = require("../audit/report");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: true });
    const md = formatReport(result, dir);
    assertContains(md, "# Audit report", "AU29: title heading");
    assertContains(md, "## Summary", "AU29: summary section");
    assertContains(md, "## Untracked top-level directories", "AU29: untracked section");
    assertContains(md, "## Violations by blueprint", "AU29: violations section");
  });
}

// AU30 — empty vault → zero violations
async function caseAU30() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {});
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: true });
    assertEqual(result.violations.length, 0, "AU30: empty vault zero violations");
    assertEqual(result.untracked.length, 0, "AU30: empty vault zero untracked");
  });
}

// AU31 — canonical conforming trips fixture → zero trips violations
async function caseAU31() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/*/Trip Atlas.md" },
      required_frontmatter: {
        type: { required: true, type: "string", equals: "trip" },
        start_date: { required: true, type: "string" },
        end_date: { required: true, type: "string" },
        location: { required: true, type: "string" }
      },
      required_tags: [{ tag: "trip" }]
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/2026-paris/Trip Atlas.md", {
      type: "trip", start_date: "2026-06-01", end_date: "2026-06-15", location: "Paris", tags: ["trip"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.blueprint === "trips").length, 0, "AU31: canonical conforming trip clean");
  });
}

// -------------------------------------------------------------------------
// v0.31.0 S2 — new predicate cases (min_length + items_schema)
// -------------------------------------------------------------------------
//
// Helper for cowork-vault-config fixtures: writes a vault-config.md with
// engagements[] inline-flow JSON (since the harness's writeNote() helper only
// handles scalar + list-of-scalar, not list-of-object). We emit raw YAML using
// JSON syntax for object items — works because the walker's YAML parser hits a
// frontmatter_parse violation for nested-object lists. So instead we write the
// file directly via fs without going through writeNote().

function writeRawNote(dir, relPath, rawBody) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, rawBody);
}

// AU33 — min_length predicate: list shorter than min_length triggers violation.
async function caseAU33() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/Trips.md" },
      required_frontmatter: {
        cssclasses: { required: true, type: "list", min_length: 2 }
      }
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    // list with 1 entry → violates min_length: 2
    writeNote(dir, "spice/trips/Trips.md", { cssclasses: ["wide"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.cssclasses.min_length"),
      "AU33: min_length violation surfaced for short list");
  });
}

// AU34 — min_length predicate: list meeting threshold passes.
async function caseAU34() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/trips/Trips.md" },
      required_frontmatter: {
        cssclasses: { required: true, type: "list", min_length: 2 }
      }
    }];
    makeSauceVault(dir, { rules: { trips: rules } });
    writeNote(dir, "spice/trips/Trips.md", { cssclasses: ["wide", "cards"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "required_frontmatter.cssclasses.min_length").length, 0,
      "AU34: list meeting min_length passes");
  });
}

// AU35 — items_schema common_required: each engagement item must have id + type.
// Engagement with missing id triggers required_frontmatter.engagements[0].id violation.
async function caseAU35() {
  await withTempVault(async (dir) => {
    // Use the in-tree cowork rule_fragment for vault-config.md by installing cowork.
    const installed = { blueprints: ["cowork"], mechanisms: [], workshop_version: "0.31.0" };
    fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"), JSON.stringify(installed, null, 2));
    fs.mkdirSync(path.join(dir, "ranch/rules"), { recursive: true });
    // Embed the cowork rule_fragment under contributions.cowork (array form).
    const coworkRule = {
      contributions: {
        cowork: [{
          scope: { path_glob: "spice/cowork/context/vault-config.md" },
          required_frontmatter: {
            engagements: {
              required: true,
              type: "list",
              min_length: 1,
              items_schema: {
                discriminator: "type",
                by_type_source: "engagement-types/<type>.json#required_fields",
                common_required: {
                  id:   { required: true, type: "string", matches: "^[a-z][a-z0-9-]+$" },
                  type: { required: true, type: "string" }
                }
              }
            }
          }
        }]
      }
    };
    fs.writeFileSync(path.join(dir, "ranch/rules/cowork.json"), JSON.stringify(coworkRule, null, 2));
    // Write vault-config.md with an engagement missing `id`.
    // The walker's YAML parser supports list-of-scalar but NOT list-of-mapping.
    // To stay within parser scope, we test the simpler shape: discriminator absent.
    // Use plain list-of-string trick: emit one engagement as plain mapping using
    // a list of mapping keys — but parser rejects that. Instead: place the engagement
    // as a list of inline-mapped scalars won't work either. Solution: validate the
    // shape via a direct rule-runner call rather than the walker.
    const ruleRunner = require("../audit/rule-runner");
    const fileRecord = {
      relPath: "spice/cowork/context/vault-config.md",
      frontmatter: {
        type: "cowork-vault-config",
        updated: "2026-05-11",
        updated_by: "test",
        engagements: [
          { type: "w2-fte", role: "Engineer", employer: "Acme", stakeholders: ["A"] }  // missing id
        ]
      },
      body: "",
      blueprint: "cowork",
    };
    const fragments = coworkRule.contributions.cowork;
    const violations = ruleRunner.applyRules(fragments, fileRecord, { workshopRoot: ROOT });
    assertTrue(violations.some(v => v.rule === "required_frontmatter.engagements[0].id"),
      "AU35: items_schema common_required surfaces missing id");
  });
}

// AU36 — items_schema by_type_source: w2-fte engagement missing required `role`
// surfaces an indexed violation rule.
async function caseAU36() {
  await withTempVault(async (dir) => {
    const fragments = [{
      scope: { path_glob: "spice/cowork/context/vault-config.md" },
      required_frontmatter: {
        engagements: {
          required: true,
          type: "list",
          min_length: 1,
          items_schema: {
            discriminator: "type",
            by_type_source: "engagement-types/<type>.json#required_fields",
            common_required: {
              id:   { required: true, type: "string" },
              type: { required: true, type: "string" }
            }
          }
        }
      }
    }];
    const ruleRunner = require("../audit/rule-runner");
    const fileRecord = {
      relPath: "spice/cowork/context/vault-config.md",
      frontmatter: {
        engagements: [
          { id: "accuris", type: "w2-fte", employer: "Acme", stakeholders: ["A"] }  // missing `role`
        ]
      },
      body: "",
      blueprint: "cowork",
    };
    const violations = ruleRunner.applyRules(fragments, fileRecord, { workshopRoot: ROOT });
    assertTrue(violations.some(v => v.rule === "required_frontmatter.engagements[0].role"),
      "AU36: items_schema by_type_source surfaces missing role for w2-fte");
  });
}

// AU37 — items_schema by_type_source: unknown discriminator value surfaces warn-severity
// "unresolved" violation (not a hard error — type manifest just can't be found).
async function caseAU37() {
  await withTempVault(async (dir) => {
    const fragments = [{
      scope: { path_glob: "spice/cowork/context/vault-config.md" },
      required_frontmatter: {
        engagements: {
          required: true,
          type: "list",
          items_schema: {
            discriminator: "type",
            by_type_source: "engagement-types/<type>.json#required_fields",
            common_required: {
              id:   { required: true, type: "string" },
              type: { required: true, type: "string" }
            }
          }
        }
      }
    }];
    const ruleRunner = require("../audit/rule-runner");
    const fileRecord = {
      relPath: "spice/cowork/context/vault-config.md",
      frontmatter: {
        engagements: [
          { id: "weird", type: "nonexistent-type" }
        ]
      },
      body: "",
      blueprint: "cowork",
    };
    const violations = ruleRunner.applyRules(fragments, fileRecord, { workshopRoot: ROOT });
    const u = violations.find(v => v.rule.includes("items_schema.by_type_source.unresolved"));
    assertTrue(!!u, "AU37: unknown discriminator value surfaces unresolved warning");
    assertEqual(u && u.severity, "warn", "AU37: unresolved violation is warn-severity");
  });
}

// AU38 — items_schema valid fixture: w2-fte engagement with all required fields → zero items violations.
async function caseAU38() {
  await withTempVault(async (dir) => {
    const fragments = [{
      scope: { path_glob: "spice/cowork/context/vault-config.md" },
      required_frontmatter: {
        engagements: {
          required: true,
          type: "list",
          min_length: 1,
          items_schema: {
            discriminator: "type",
            by_type_source: "engagement-types/<type>.json#required_fields",
            common_required: {
              id:   { required: true, type: "string" },
              type: { required: true, type: "string" }
            }
          }
        }
      }
    }];
    const ruleRunner = require("../audit/rule-runner");
    const fileRecord = {
      relPath: "spice/cowork/context/vault-config.md",
      frontmatter: {
        engagements: [
          { id: "accuris", type: "w2-fte", role: "Engineer", employer: "Acme", stakeholders: ["A","B"] }
        ]
      },
      body: "",
      blueprint: "cowork",
    };
    const violations = ruleRunner.applyRules(fragments, fileRecord, { workshopRoot: ROOT });
    const itemsViolations = violations.filter(v => v.rule.startsWith("required_frontmatter.engagements["));
    assertEqual(itemsViolations.length, 0, "AU38: valid w2-fte engagement passes items_schema");
  });
}

// AU32 — canonical conforming project fixture → zero project violations
async function caseAU32() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/Project.md" },
      required_frontmatter: {
        created: { required: true, type: "string" },
        description: { required: true, type: "string" },
        workstreams: { required: true, type: "list" }
      },
      required_tags: [{ tag: "project" }]
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    writeNote(dir, "spice/projects/widget/Project.md", {
      created: "2026-05-08", description: "Widget redesign", workstreams: [], tags: ["project"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.blueprint === "project").length, 0, "AU32: canonical conforming project clean");
  });
}

// Per-case error firewall: a thrown error inside any case body (including
// the deliberate "Cannot find module ../audit/walker" RED-state throws)
// counts as exactly one failed sub-assert and does NOT abort the harness.
async function runCase(name, fn) {
  try { await fn(); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
}

const selector = process.argv[2] || "all";
(async () => {
  if (selector === "trips"      || selector === "all") { for (let i = 1; i <= 3; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "project"    || selector === "all") { for (let i = 4; i <= 5; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "people"     || selector === "all") { for (let i = 6; i <= 7; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "meetings"   || selector === "all") { for (let i = 8; i <= 9; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "daily"      || selector === "all") { for (let i = 10; i <= 11; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "untracked"  || selector === "all") { for (let i = 12; i <= 13; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "flags"      || selector === "all") { for (let i = 14; i <= 16; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "errors"     || selector === "all") { for (let i = 17; i <= 19; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "predicates" || selector === "all") { for (let i = 20; i <= 25; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "exits"      || selector === "all") { for (let i = 26; i <= 28; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  if (selector === "report"     || selector === "all") { await runCase("AU29", caseAU29); await runCase("AU30", caseAU30); }
  if (selector === "positive"   || selector === "all") { await runCase("AU31", caseAU31); await runCase("AU32", caseAU32); }
  // v0.31.0 S2.6 — min_length + items_schema predicate cases
  if (selector === "items_schema" || selector === "all") { for (let i = 33; i <= 38; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  console.log(`========\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
