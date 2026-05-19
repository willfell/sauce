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
 *            items_schema | engagement_templates | claude_surface | scratch |
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

// AU4 — project entity missing description (v1.4.0 — type-discriminator, name-as-filename)
async function caseAU4() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/*.md" },
      frontmatter_branch: [
        {
          when: { frontmatter: { type: "project" } },
          required_frontmatter: { description: { required: true, type: "string" } }
        }
      ]
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    // v1.4.0 filename-as-name: file basename is the project name, not "Project.md"
    writeNote(dir, "spice/projects/widget/Widget.md",
      { type: "project", created: "2026-05-01", workstreams: [], tags: ["project"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.description"), "AU4: project description missing");
  });
}

// AU5 — project entity wrong tag (v1.4.0 — type-discriminator, name-as-filename)
async function caseAU5() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/*.md" },
      frontmatter_branch: [
        {
          when: { frontmatter: { type: "project" } },
          required_tags: [{ tag: "project" }]
        }
      ]
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    writeNote(dir, "spice/projects/widget/Widget.md",
      { type: "project", tags: ["initiative"] });  // missing "project" tag
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

// AU32 — canonical conforming project fixture (v1.4.0 — type-discriminator, name-as-filename) → zero project violations
async function caseAU32() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/projects/*/*.md" },
      frontmatter_branch: [
        {
          when: { frontmatter: { type: "project" } },
          required_frontmatter: {
            created: { required: true, type: "string" },
            description: { required: true, type: "string" },
            workstreams: { required: true, type: "list" }
          },
          required_tags: [{ tag: "project" }]
        }
      ]
    }];
    makeSauceVault(dir, { rules: { project: rules } });
    // v1.4.0 filename-as-name: file basename is the project name, not "Project.md"
    writeNote(dir, "spice/projects/widget/Widget.md", {
      type: "project", created: "2026-05-08", description: "Widget redesign", workstreams: [], tags: ["project"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.blueprint === "project").length, 0, "AU32: canonical conforming project clean");
  });
}

// -------------------------------------------------------------------------
// v0.31.0 S4 — engagement-templates path-glob cases
// -------------------------------------------------------------------------
//
// Verifies path_glob scoping fires correctly against the nested per-engagement
// context dir shape introduced by the cowork@0.2.0 restructure.

// AU39 — per-type engagement-templates path_glob limits scope to one type's dir.
async function caseAU39() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/cowork/context/engagement-templates/w2-fte/*.md" },
      required_frontmatter: { type: { required: true, type: "string", equals: "scheduled-context" } }
    }];
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: rules } });
    writeNote(dir, "spice/cowork/context/engagement-templates/w2-fte/about.md",          { type: "scheduled-context" });        // matches glob, conforms → 0 violations
    writeNote(dir, "spice/cowork/context/engagement-templates/w2-fte/working-style.md",  { type: "wrong-type" });                // matches glob, equals fails → 1 violation
    writeNote(dir, "spice/cowork/context/engagement-templates/personal/about.md",        { type: "wrong-type" });                // sibling type dir, doesn't match w2-fte glob → 0 violations
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "required_frontmatter.type.equals").length, 1,
      "AU39: engagement-templates path_glob scopes to one type's dir only");
    assertEqual(result.violations.filter(v => v.blueprint === "cowork" && v.file.includes("personal/")).length, 0,
      "AU39b: personal/ dir not flagged by w2-fte-scoped rule");
  });
}

// AU40 — per-engagement-id materialized path_glob matches deep paths.
async function caseAU40() {
  await withTempVault(async (dir) => {
    const rules = [{
      scope: { path_glob: "spice/cowork/context/*/about.md" },
      required_frontmatter: { type: { required: true, type: "string" } }
    }];
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: rules } });
    writeNote(dir, "spice/cowork/context/accuris/about.md",  { type: "scheduled-context" });   // matches glob, conforms → 0
    writeNote(dir, "spice/cowork/context/personal/about.md", { /* type missing */ });          // matches glob, required missing → 1
    writeNote(dir, "spice/cowork/context/active-threads.md", { /* type missing */ });          // does NOT match glob (no <id>/) → 0
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertEqual(result.violations.filter(v => v.rule === "required_frontmatter.type").length, 1,
      "AU40: per-engagement <id>/about.md glob matches deep paths");
    assertEqual(result.violations.filter(v => v.file && v.file.endsWith("active-threads.md")).length, 0,
      "AU40b: vault-wide siblings not flagged by <id>/ glob");
  });
}

// v0.32.0 S7.A — claude-surface walker cases (AU-CS-1..6).
// Tests walkClaudeSurface() against fixtures that scaffold a vault with
// ranch/claude-surface-registry.json + .claude/commands/ + .claude/skills/.
const { walkClaudeSurface } = require("../mechanisms/audit/claude-surface-walker");

function writeRegistry(dir, contributions) {
  const reg = {
    schema_version: 1,
    generated_at: "2026-05-12T00:00:00.000Z",
    workshop_version: "0.32.0",
    contributions,
  };
  fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ranch/claude-surface-registry.json"), JSON.stringify(reg, null, 2));
}

// AU-CS-1 — dead_path when registry entry's dest is missing on FS
async function caseAUCS1() {
  await withTempVault(async (dir) => {
    writeRegistry(dir, {
      "test-mech": [
        { kind: "command", source: "commands/foo.md", dest: ".claude/commands/foo.md", version: "0.1.0" },
      ],
    });
    const result = await walkClaudeSurface(dir, {});
    const dp = result.findings.filter(f => f.severity === "dead_path" && f.path === ".claude/commands/foo.md");
    assertEqual(dp.length, 1, "AU-CS-1: dead_path finding surfaced for missing dest");
    assertEqual(result.counts.dead_path, 1, "AU-CS-1: counts.dead_path === 1");
  });
}

// AU-CS-2 — orphan when FS has .claude/commands/orphan.md not in registry
async function caseAUCS2() {
  await withTempVault(async (dir) => {
    writeRegistry(dir, {});
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/commands/orphan.md"), "# orphan\n");
    const result = await walkClaudeSurface(dir, {});
    const orph = result.findings.filter(f => f.severity === "orphan");
    assertEqual(orph.length, 1, "AU-CS-2: single orphan finding");
    assertContains(orph[0].path, "orphan.md", "AU-CS-2: orphan path mentions orphan.md");
    assertEqual(result.counts.orphan, 1, "AU-CS-2: counts.orphan === 1");
  });
}

// AU-CS-3 — stale_but_valid when body @claude-surface:version != registry version
async function caseAUCS3() {
  await withTempVault(async (dir) => {
    writeRegistry(dir, {
      "test-mech": [
        { kind: "command", source: "commands/x.md", dest: ".claude/commands/x.md", version: "0.2.0" },
      ],
    });
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/commands/x.md"),
      "---\ndescription: x\n---\n\n<!-- @claude-surface:version 0.1.0 -->\n\n# x\n");
    const result = await walkClaudeSurface(dir, {});
    const stale = result.findings.filter(f => f.severity === "stale_but_valid");
    assertEqual(stale.length, 1, "AU-CS-3: single stale_but_valid finding");
    assertEqual(stale[0].expected, "0.2.0", "AU-CS-3: expected=0.2.0");
    assertEqual(stale[0].found, "0.1.0", "AU-CS-3: found=0.1.0");
  });
}

// AU-CS-4 — consumer_edit_at_risk: deployed body != source, no .local/ shadow
async function caseAUCS4() {
  await withTempVault(async (dir) => {
    // Fake workshop with source content.
    const workshopDir = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-ws-"));
    try {
      const srcDir = path.join(workshopDir, "platform/mechanisms/test-mech/commands");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, "y.md"), "# source body\n");
      writeRegistry(dir, {
        "test-mech": [
          { kind: "command", source: "commands/y.md", dest: ".claude/commands/y.md", version: "0.1.0" },
        ],
      });
      fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".claude/commands/y.md"), "# CONSUMER EDITED body\n");
      const result = await walkClaudeSurface(dir, { workshopPath: workshopDir });
      const cear = result.findings.filter(f => f.severity === "consumer_edit_at_risk");
      assertEqual(cear.length, 1, "AU-CS-4: single consumer_edit_at_risk finding");
      // With .local/ shadow → NOT flagged.
      fs.mkdirSync(path.join(dir, ".claude/commands.local"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".claude/commands.local/y.md"), "# CONSUMER EDITED body\n");
      const result2 = await walkClaudeSurface(dir, { workshopPath: workshopDir });
      const cear2 = result2.findings.filter(f => f.severity === "consumer_edit_at_risk");
      assertEqual(cear2.length, 0, "AU-CS-4b: .local/ shadow suppresses consumer_edit_at_risk");
    } finally {
      fs.rmSync(workshopDir, { recursive: true, force: true });
    }
  });
}

// AU-CS-5 — aligned count = entries with no severity raised
async function caseAUCS5() {
  await withTempVault(async (dir) => {
    writeRegistry(dir, {
      "test-mech": [
        { kind: "command", source: "commands/a.md", dest: ".claude/commands/a.md", version: "0.1.0" },
        { kind: "command", source: "commands/b.md", dest: ".claude/commands/b.md", version: "0.1.0" },
      ],
    });
    fs.mkdirSync(path.join(dir, ".claude/commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude/commands/a.md"), "# a\n");
    fs.writeFileSync(path.join(dir, ".claude/commands/b.md"), "# b\n");
    const result = await walkClaudeSurface(dir, {});
    assertEqual(result.counts.aligned, 2, "AU-CS-5: 2 aligned entries");
    assertEqual(result.findings.length, 0, "AU-CS-5: no findings when both aligned");
  });
}

// AU-CS-6 — missing registry → single dead_path finding for the registry itself
async function caseAUCS6() {
  await withTempVault(async (dir) => {
    // Don't write the registry file at all.
    const result = await walkClaudeSurface(dir, {});
    assertEqual(result.findings.length, 1, "AU-CS-6: single finding when registry missing");
    assertEqual(result.findings[0].kind, "registry", "AU-CS-6: kind=registry");
    assertEqual(result.findings[0].severity, "dead_path", "AU-CS-6: severity=dead_path");
    assertEqual(result.counts.dead_path, 1, "AU-CS-6: counts.dead_path === 1");
  });
}

// ============================================================
// v0.37.0 S3.3 — Scratch blueprint rule_fragment audit cases (SA-S1..S6).
// Six per-rule-shape assertions: positive case + 5 negatives (3 required-fm,
// 2 naming-pattern). Fragment shape mirrors blueprints/scratch/manifest.json:
//   scope.path_glob: spice/scratch/**/Scratch-*.md
//   required_frontmatter: { created: type:string, type: equals:"scratch", day: type:string }
//   naming_pattern: ^Scratch-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$
// ============================================================
const SCRATCH_FRAGMENT = [{
  scope: { path_glob: "spice/scratch/**/Scratch-2*.md" },
  required_frontmatter: {
    created: { required: true, type: "string" },
    type:    { required: true, equals: "scratch" },
    day:     { required: true, type: "string" }
  },
  naming_pattern: "^Scratch-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}\\.md$"
}];

// v0.40.0 S4.3 — Scratch Day Hub rule_fragment shape for SA-S7/S8.
// Mirrors blueprints/scratch/manifest.json's "scratch-day-hub" rule_fragment:
//   scope.path_glob: spice/scratch/**/Scratch-Day-*.md
//   required_frontmatter: { created: type:string, type: equals:"scratch-day", day: type:string }
//   naming_pattern: ^Scratch-Day-\d{4}-\d{2}-\d{2}\.md$
const SCRATCH_DAY_HUB_FRAGMENT = [{
  scope: { path_glob: "spice/scratch/**/Scratch-Day-*.md" },
  required_frontmatter: {
    created: { required: true, type: "string" },
    type:    { required: true, equals: "scratch-day" },
    day:     { required: true, type: "string" }
  },
  naming_pattern: "^Scratch-Day-\\d{4}-\\d{2}-\\d{2}\\.md$"
}];

// SA-S1 — valid scratch frontmatter + valid filename → 0 violations.
async function caseSAS1() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-09-15.md",
      { created: "2026-05-12T09:15:00", type: "scratch", day: "2026-05-12", time: "09:15" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const scratchViolations = result.violations.filter(v => v.blueprint === "scratch");
    assertEqual(scratchViolations.length, 0, "SA-S1: valid scratch note has zero violations");
  });
}

// SA-S2 — missing day field → required_frontmatter.day violation.
async function caseSAS2() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-09-15.md",
      { created: "2026-05-12T09:15:00", type: "scratch", time: "09:15" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.day"),
      "SA-S2: missing day field surfaces required_frontmatter.day");
  });
}

// SA-S3 — missing type field → required_frontmatter.type violation.
async function caseSAS3() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-09-15.md",
      { created: "2026-05-12T09:15:00", day: "2026-05-12", time: "09:15" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.type"),
      "SA-S3: missing type field surfaces required_frontmatter.type");
  });
}

// SA-S4 — wrong type value ("notscratch") → equals-predicate violation.
async function caseSAS4() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-09-15.md",
      { created: "2026-05-12T09:15:00", type: "notscratch", day: "2026-05-12" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.type.equals"),
      "SA-S4: wrong type value surfaces required_frontmatter.type.equals");
  });
}

// SA-S5 — filename without HH-mm suffix → naming_pattern violation.
async function caseSAS5() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12.md",
      { created: "2026-05-12T09:15:00", type: "scratch", day: "2026-05-12" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(
      result.violations.some(v => v.rule === "naming_pattern" && v.file.endsWith("Scratch-2026-05-12.md")),
      "SA-S5: filename without HH-mm surfaces naming_pattern violation"
    );
  });
}

// SA-S6 — non-zero-padded hour component → naming_pattern violation.
// (The path_glob `Scratch-*.md` is case-sensitive, so a lowercase-prefix
// filename would fall out of scope and produce no violation; this test keeps
// the Scratch- prefix so the scope-match fires, but breaks the digit
// component grammar `\d{2}-\d{2}` with a single-digit hour `9-15`.)
async function caseSAS6() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["scratch"], rules: { scratch: SCRATCH_FRAGMENT } });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-9-15.md",
      { created: "2026-05-12T09:15:00", type: "scratch", day: "2026-05-12" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(
      result.violations.some(v => v.rule === "naming_pattern" && v.file.endsWith("Scratch-2026-05-12-9-15.md")),
      "SA-S6: non-zero-padded hour component surfaces naming_pattern violation"
    );
  });
}

// v0.40.0 S4.3 — Scratch Day Hub rule_fragment audit cases (SA-S7/S8).
// Manifest semantics: scratch blueprint contributes BOTH fragments
// (scratch-leaf + scratch-day-hub) under the same "scratch" rule namespace —
// the walker reads ranch/rules/scratch.json and applies all fragments to every
// .md file under spice/scratch/. Disjoint path_globs (Scratch-2*.md vs
// Scratch-Day-*.md, narrowed by 73a08cc) ensure each fragment only matches
// the corresponding note kind.

// SA-S7 — valid scratch-day-hub frontmatter + valid filename → 0 violations.
async function caseSAS7DayHubValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {
      blueprints: ["scratch"],
      rules: { scratch: [...SCRATCH_FRAGMENT, ...SCRATCH_DAY_HUB_FRAGMENT] },
    });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-Day-2026-05-12.md",
      { created: "2026-05-12T09:15:00", type: "scratch-day", day: "2026-05-12" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file.endsWith("Scratch-Day-2026-05-12.md"));
    assertEqual(violations.length, 0, "SA-S7: valid day-hub note has zero violations");
  });
}

// SA-S8 — wrong type field (type: scratch instead of scratch-day) → violation.
async function caseSAS8DayHubBadType() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, {
      blueprints: ["scratch"],
      rules: { scratch: [...SCRATCH_FRAGMENT, ...SCRATCH_DAY_HUB_FRAGMENT] },
    });
    writeNote(dir, "spice/scratch/2026/05-May/2026-05-12/Scratch-Day-2026-05-12.md",
      { created: "2026-05-12T09:15:00", type: "scratch", day: "2026-05-12" });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file.endsWith("Scratch-Day-2026-05-12.md"));
    assertTrue(violations.length > 0, "SA-S8: wrong type yields at least one violation");
    assertTrue(violations.some(v => /type/i.test(JSON.stringify(v))),
      "SA-S8: violation references the type field");
  });
}

// ============================================================
// v0.42.0 S7 — Cowork timeframe rule_fragment audit cases (CW-1..12).
// Six new rule_fragments added to cowork/manifest.json:
//   1. Daily Hub     — scope: spice/cowork/Daily Hub.md
//   2. Weekly Hub    — scope: spice/cowork/Weekly Hub.md
//   3. Monthly Hub   — scope: spice/cowork/Monthly Hub.md
//   4. Weekly note   — scope: spice/cowork/weekly/**/*.md + naming_pattern
//   5. Monthly note  — scope: spice/cowork/monthly/**/*.md + naming_pattern
//   6. Prompt stub   — scope: spice/cowork/prompts/*.md
// 12 sub-asserts: 6 happy-path (zero violations) + 6 failure-path.
// ============================================================

const COWORK_DAILY_HUB_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/Daily Hub.md" },
  required_frontmatter: { type: { required: true, type: "string", equals: "cowork-daily-hub" } },
  required_tags: [{ tag: "cowork-hub" }, { tag: "daily-hub" }]
}];

const COWORK_WEEKLY_HUB_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/Weekly Hub.md" },
  required_frontmatter: { type: { required: true, type: "string", equals: "cowork-weekly-hub" } },
  required_tags: [{ tag: "cowork-hub" }, { tag: "weekly-hub" }]
}];

const COWORK_MONTHLY_HUB_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/Monthly Hub.md" },
  required_frontmatter: { type: { required: true, type: "string", equals: "cowork-monthly-hub" } },
  required_tags: [{ tag: "cowork-hub" }, { tag: "monthly-hub" }]
}];

const COWORK_WEEKLY_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/weekly/**/*.md" },
  required_frontmatter: {
    type:       { required: true, type: "string", equals: "cowork-weekly" },
    week_label: { required: true, type: "string" },
    week_start: { required: true, type: "string" },
    week_end:   { required: true, type: "string" },
    created:    { required: true, type: "string" }
  },
  required_tags: [{ tag: "weekly" }],
  naming_pattern: "^\\d{4}-W\\d{2}\\.md$"
}];

const COWORK_MONTHLY_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/monthly/**/*.md" },
  required_frontmatter: {
    type:        { required: true, type: "string", equals: "cowork-monthly" },
    month_label: { required: true, type: "string" },
    month_start: { required: true, type: "string" },
    month_end:   { required: true, type: "string" },
    created:     { required: true, type: "string" }
  },
  required_tags: [{ tag: "monthly" }],
  naming_pattern: "^\\d{4}-\\d{2}\\.md$"
}];

const COWORK_PROMPT_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/prompts/*.md" },
  required_frontmatter: {
    type:       { required: true, type: "string", equals: "cowork-prompt" },
    prompt_for: { required: true, type: "string" },
    updated:    { required: true, type: "string" },
    updated_by: { required: true, type: "string" }
  }
}];

// CW-1 — audit-daily-hub-valid: conforming Daily Hub → 0 violations
async function caseCW1DailyHubValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_DAILY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Daily Hub.md",
      { type: "cowork-daily-hub", tags: ["cowork-hub", "daily-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("Daily Hub.md"));
    assertEqual(violations.length, 0, "audit-daily-hub-valid: conforming Daily Hub has zero violations");
  });
}

// CW-2 — audit-daily-hub-missing-type: Daily Hub without type frontmatter → violation
async function caseCW2DailyHubMissingType() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_DAILY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Daily Hub.md",
      { tags: ["cowork-hub", "daily-hub"] });  // missing type
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.type"),
      "audit-daily-hub-missing-type: missing type field surfaces violation");
  });
}

// CW-3 — audit-weekly-hub-valid: conforming Weekly Hub → 0 violations
async function caseCW3WeeklyHubValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_WEEKLY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Weekly Hub.md",
      { type: "cowork-weekly-hub", tags: ["cowork-hub", "weekly-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("Weekly Hub.md"));
    assertEqual(violations.length, 0, "audit-weekly-hub-valid: conforming Weekly Hub has zero violations");
  });
}

// CW-4 — audit-weekly-hub-missing-tags: Weekly Hub missing both cowork tags → violation
async function caseCW4WeeklyHubMissingTags() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_WEEKLY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Weekly Hub.md",
      { type: "cowork-weekly-hub", tags: [] });  // missing required tags
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing" && v.file && v.file.endsWith("Weekly Hub.md")),
      "audit-weekly-hub-missing-tags: missing tags violation surfaced for Weekly Hub");
  });
}

// CW-5 — audit-monthly-hub-valid: conforming Monthly Hub → 0 violations
async function caseCW5MonthlyHubValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_MONTHLY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Monthly Hub.md",
      { type: "cowork-monthly-hub", tags: ["cowork-hub", "monthly-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("Monthly Hub.md"));
    assertEqual(violations.length, 0, "audit-monthly-hub-valid: conforming Monthly Hub has zero violations");
  });
}

// CW-6 — audit-monthly-hub-missing-tags: Monthly Hub missing monthly-hub tag → violation
async function caseCW6MonthlyHubMissingTags() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_MONTHLY_HUB_FRAGMENT } });
    writeNote(dir, "spice/cowork/Monthly Hub.md",
      { type: "cowork-monthly-hub", tags: ["cowork-hub"] });  // missing monthly-hub
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing" && v.message && v.message.includes("monthly-hub")),
      "audit-monthly-hub-missing-tags: missing monthly-hub tag surfaced");
  });
}

// CW-7 — audit-weekly-valid: full conforming weekly note → 0 violations
async function caseCW7WeeklyValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_WEEKLY_FRAGMENT } });
    writeNote(dir, "spice/cowork/weekly/2026/2026-W20.md", {
      type: "cowork-weekly", week_label: "Week 20 · May 2026",
      week_start: "2026-05-11", week_end: "2026-05-17",
      created: "2026-05-11", tags: ["weekly"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("2026-W20.md"));
    assertEqual(violations.length, 0, "audit-weekly-valid: fully conforming weekly note has zero violations");
  });
}

// CW-8 — audit-weekly-missing-week-start: weekly note without week_start → violation
async function caseCW8WeeklyMissingWeekStart() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_WEEKLY_FRAGMENT } });
    writeNote(dir, "spice/cowork/weekly/2026/2026-W20.md", {
      type: "cowork-weekly", week_label: "Week 20 · May 2026",
      // week_start intentionally omitted
      week_end: "2026-05-17", created: "2026-05-11", tags: ["weekly"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.week_start"),
      "audit-weekly-missing-week-start: missing week_start surfaces violation");
  });
}

// CW-9 — audit-monthly-valid: full conforming monthly note → 0 violations
async function caseCW9MonthlyValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_MONTHLY_FRAGMENT } });
    writeNote(dir, "spice/cowork/monthly/2026/2026-05.md", {
      type: "cowork-monthly", month_label: "May 2026",
      month_start: "2026-05-01", month_end: "2026-05-31",
      created: "2026-05-01", tags: ["monthly"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("2026-05.md"));
    assertEqual(violations.length, 0, "audit-monthly-valid: fully conforming monthly note has zero violations");
  });
}

// CW-10 — audit-monthly-bad-filename: monthly note with non-matching filename → naming_pattern violation
async function caseCW10MonthlyBadFilename() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_MONTHLY_FRAGMENT } });
    writeNote(dir, "spice/cowork/monthly/2026/notmatching.md", {
      type: "cowork-monthly", month_label: "May 2026",
      month_start: "2026-05-01", month_end: "2026-05-31",
      created: "2026-05-01", tags: ["monthly"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "naming_pattern" && v.file && v.file.endsWith("notmatching.md")),
      "audit-monthly-bad-filename: non-matching filename surfaces naming_pattern violation");
  });
}

// CW-11 — audit-prompt-valid: conforming prompt stub → 0 violations
async function caseCW11PromptValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_PROMPT_FRAGMENT } });
    writeNote(dir, "spice/cowork/prompts/morning-briefing.md", {
      type: "cowork-prompt", prompt_for: "morning-briefing",
      updated: "2026-05-13", updated_by: "scaffold"
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("morning-briefing.md"));
    assertEqual(violations.length, 0, "audit-prompt-valid: conforming prompt stub has zero violations");
  });
}

// CW-12 — audit-prompt-missing-prompt-for: prompt stub without prompt_for → violation
async function caseCW12PromptMissingPromptFor() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_PROMPT_FRAGMENT } });
    writeNote(dir, "spice/cowork/prompts/morning-briefing.md", {
      type: "cowork-prompt",
      // prompt_for intentionally omitted
      updated: "2026-05-13", updated_by: "scaffold"
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.prompt_for"),
      "audit-prompt-missing-prompt-for: missing prompt_for field surfaces violation");
  });
}

// ============================================================
// v0.44.0 S9 — cowork-about rule_fragment audit cases (CW-13..14).
// Mirrors the CW-1/2 hub-fragment posture for the NEW About Cowork.md note
// rule_fragment added in v0.44.0 S7 (cowork manifest@0.6.0).
// ============================================================

const COWORK_ABOUT_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/About Cowork.md" },
  required_frontmatter: { type: { required: true, type: "string", equals: "cowork-about" } },
  required_tags: [{ tag: "cowork-about" }]
}];

// CW-13 — audit-cowork-about-valid: conforming About Cowork → 0 violations
async function caseCW13AboutValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_ABOUT_FRAGMENT } });
    writeNote(dir, "spice/cowork/About Cowork.md",
      { type: "cowork-about", tags: ["cowork-about"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("About Cowork.md"));
    assertEqual(violations.length, 0, "audit-cowork-about-valid: conforming About Cowork has zero violations");
  });
}

// CW-14 — audit-cowork-about-missing-tag: About Cowork without cowork-about tag → violation
async function caseCW14AboutMissingTag() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_ABOUT_FRAGMENT } });
    writeNote(dir, "spice/cowork/About Cowork.md",
      { type: "cowork-about", tags: [] });  // missing cowork-about tag
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_tags.missing" && v.file && v.file.endsWith("About Cowork.md")),
      "audit-cowork-about-missing-tag: missing cowork-about tag surfaces required_tags.missing violation");
  });
}

// ============================================================
// v0.45.0 S8 — cowork-daily rule_fragment audit cases (CW-15..16).
// Mirrors the CW-7/8 weekly-fragment posture for the NEW cowork-daily
// rule_fragment added in v0.45.0 S7 (cowork manifest@0.7.0).
// ============================================================

const COWORK_DAILY_FRAGMENT = [{
  scope: { path_glob: "spice/cowork/daily/**/*.md" },
  required_frontmatter: {
    type:    { required: true, type: "string", equals: "cowork-daily" },
    day:     { required: true, type: "string", matches: "^\\d{4}-\\d{2}-\\d{2}$" },
    created: { required: true, type: "string" }
  },
  required_tags: [{ tag: "cowork-daily" }],
  naming_pattern: "^\\d{4}-\\d{2}-\\d{2}\\.md$"
}];

// CW-15 — audit-cowork-daily-valid: conforming cowork-daily note → 0 violations
async function caseCW15DailyValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_DAILY_FRAGMENT } });
    writeNote(dir, "spice/cowork/daily/2026/05-May/2026-05-14.md", {
      type: "cowork-daily", day: "2026-05-14",
      created: "2026-05-14T10:00:00", tags: ["cowork-daily"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("2026-05-14.md"));
    assertEqual(violations.length, 0, "audit-cowork-daily-valid: fully conforming cowork-daily note has zero violations");
  });
}

// CW-16 — audit-cowork-daily-bad-type: wrong type (cowork-weekly) → type violation
async function caseCW16DailyBadType() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["cowork"], rules: { cowork: COWORK_DAILY_FRAGMENT } });
    writeNote(dir, "spice/cowork/daily/2026/05-May/2026-05-14.md", {
      type: "cowork-weekly", day: "2026-05-14",
      created: "2026-05-14T10:00:00", tags: ["cowork-daily"]
    });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => v.rule === "required_frontmatter.type.equals" && v.file && v.file.endsWith("2026-05-14.md")),
      "audit-cowork-daily-bad-type: wrong type surfaces required_frontmatter.type.equals violation");
  });
}

// ============================================================
// v0.46.0 S11 — entity-create-walker audit cases (AU-EC-1..6)
// ============================================================

function seedEntityCreateVault(dir, setup) {
  // Seeds installed.json + scripts + dirs + templates for walkEntityCreate tests.
  fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"),
    JSON.stringify(setup.installed, null, 2));
  if (setup.scripts) {
    for (const [bp, files] of Object.entries(setup.scripts)) {
      const sd = path.join(dir, "ranch/scripts", bp);
      fs.mkdirSync(sd, { recursive: true });
      for (const [fname, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(sd, fname), body);
      }
    }
  }
  if (setup.dirs) {
    for (const rel of setup.dirs) {
      fs.mkdirSync(path.join(dir, rel), { recursive: true });
    }
  }
  if (setup.templates) {
    const td = path.join(dir, "ranch/templates");
    fs.mkdirSync(td, { recursive: true });
    for (const [name, body] of Object.entries(setup.templates)) {
      fs.writeFileSync(path.join(td, name), body);
    }
  }
}

// AU-EC-1 — walkEntityCreate is callable as a node module
async function caseAUEC1() {
  const mod = require("../audit/entity-create-walker");
  assertTrue(typeof mod.walkEntityCreate === "function",
    "AU-EC-1: walkEntityCreate exported as a function");
}

// AU-EC-2 — HIGH finding raised when New*Button class exists without manifest entry
async function caseAUEC2() {
  await withTempVault(async (dir) => {
    seedEntityCreateVault(dir, {
      installed: { blueprints: [{ name: "foo", version: "0.1.0" }], mechanisms: [] },
      scripts: { foo: { "new-foo-button.js": "class NewFooButton { render() {} }\n" } },
    });
    const { walkEntityCreate } = require("../audit/entity-create-walker");
    const result = await walkEntityCreate(dir);
    const hi = result.findings.find(f => f.severity === "manual_implementation_at_risk" && f.blueprint === "foo");
    assertTrue(!!hi, "AU-EC-2: HIGH manual_implementation_at_risk finding raised for class-without-entry");
    assertTrue(result.counts.manual_implementation_at_risk >= 1,
      "AU-EC-2: counts.manual_implementation_at_risk >= 1");
  });
}

// AU-EC-3 — INFO finding raised when both class + entry coexist
async function caseAUEC3() {
  await withTempVault(async (dir) => {
    seedEntityCreateVault(dir, {
      installed: {
        blueprints: [{
          name: "foo", version: "0.1.0",
          new_entity_buttons: [{
            id: "foo", label: "New Foo",
            destination: { folder_prefix: "spice/foo", filename_prefix: "F" },
            frontmatter_template: { type: "foo" },
            render_in: { kind: "hub", target_path: "spice/foo/Foo.md" },
          }],
        }],
        mechanisms: [],
      },
      scripts: { foo: { "new-foo-button.js": "class NewFooButton { render() {} }\n" } },
      dirs: ["spice/foo"],
    });
    const { walkEntityCreate } = require("../audit/entity-create-walker");
    const result = await walkEntityCreate(dir);
    const info = result.findings.find(f => f.severity === "escape_hatch_used" && f.blueprint === "foo");
    assertTrue(!!info, "AU-EC-3: INFO escape_hatch_used finding raised when both coexist");
  });
}

// AU-EC-4 — MEDIUM dead_path for bogus body_template
async function caseAUEC4() {
  await withTempVault(async (dir) => {
    seedEntityCreateVault(dir, {
      installed: {
        blueprints: [{
          name: "bar", version: "0.1.0",
          new_entity_buttons: [{
            id: "bar", label: "New Bar",
            destination: { folder_prefix: "spice/bar", filename_prefix: "B" },
            frontmatter_template: { type: "bar" },
            body_template: "no-such-template.md",
            render_in: { kind: "hub", target_path: "spice/bar/Bar.md" },
          }],
        }],
        mechanisms: [],
      },
      dirs: ["spice/bar"],
    });
    const { walkEntityCreate } = require("../audit/entity-create-walker");
    const result = await walkEntityCreate(dir);
    const dp = result.findings.find(f => f.severity === "dead_path" && /body_template/.test(f.message || ""));
    assertTrue(!!dp, "AU-EC-4: MEDIUM dead_path finding raised for bogus body_template");
  });
}

// AU-EC-5 — MEDIUM dead_path for bogus destination.folder_prefix
async function caseAUEC5() {
  await withTempVault(async (dir) => {
    seedEntityCreateVault(dir, {
      installed: {
        blueprints: [{
          name: "baz", version: "0.1.0",
          new_entity_buttons: [{
            id: "baz", label: "New Baz",
            destination: { folder_prefix: "no-such-dir/baz", filename_prefix: "Z" },
            frontmatter_template: { type: "baz" },
            render_in: { kind: "hub", target_path: "no-such-dir/baz/Baz.md" },
          }],
        }],
        mechanisms: [],
      },
      // No `dirs: [...]` → folder_prefix "no-such-dir/baz" does not resolve.
    });
    const { walkEntityCreate } = require("../audit/entity-create-walker");
    const result = await walkEntityCreate(dir);
    const dp = result.findings.find(f => f.severity === "dead_path"
      && /folder_prefix/.test(f.message || "")
      && /no-such-dir\/baz/.test(f.message || ""));
    assertTrue(!!dp, "AU-EC-5: MEDIUM dead_path finding raised for bogus folder_prefix");
  });
}

// AU-EC-6 — Clean vault with declared entries that resolve → all-aligned report
async function caseAUEC6() {
  await withTempVault(async (dir) => {
    seedEntityCreateVault(dir, {
      installed: {
        blueprints: [{
          name: "ok", version: "0.1.0",
          new_entity_buttons: [{
            id: "ok", label: "New OK",
            destination: { folder_prefix: "spice/ok", filename_prefix: "O" },
            frontmatter_template: { type: "ok" },
            render_in: { kind: "hub", target_path: "spice/ok/OK.md" },
          }],
        }],
        mechanisms: [],
      },
      dirs: ["spice/ok"],
      // No scripts directory at all → no New*Button class → no findings.
    });
    const { walkEntityCreate } = require("../audit/entity-create-walker");
    const result = await walkEntityCreate(dir);
    assertEqual(result.findings.length, 0, "AU-EC-6: clean vault has zero findings");
    assertTrue(result.counts.aligned >= 1, "AU-EC-6: clean vault has aligned >= 1");
  });
}

// ============================================================
// v0.53.0 FA-1 S7 — AU-FA-1..12: frontmatter-alignment walker cases.
// ============================================================

// Seed a minimal sauce vault under tmpdir with one installed blueprint.
// The walker uses the workshop fallback for canonical-vocab when vault override is absent.
function seedFrontmatterAlignmentVault(dir, opts) {
  const blueprints = (opts && opts.blueprints) || [{ name: "meetings", version: "0.5.0" }];
  fs.mkdirSync(path.join(dir, "ranch"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ranch/platform-installed.json"),
    JSON.stringify({ blueprints, mechanisms: [], workshop_version: "0.53.0" }, null, 2));
  for (const b of blueprints) {
    const name = typeof b === "string" ? b : b.name;
    fs.mkdirSync(path.join(dir, `spice/${name === "project" ? "projects" : name}`), { recursive: true });
  }
}

function writeRawNote(dir, relPath, raw) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, raw);
}

// AU-FA-1 — module loads + legacy_key_used HIGH fires on `created:`
async function caseAUFA1() {
  await withTempVault(async (dir) => {
    const mod = require("../audit/frontmatter-alignment-walker");
    assertTrue(typeof mod.walkFrontmatterAlignment === "function",
      "AU-FA-1a: walkFrontmatterAlignment exported as a function");
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m.md",
      "---\ntype: meeting\ncreated: 2026-05-15\n---\nbody\n");
    const result = await mod.walkFrontmatterAlignment(dir);
    const hi = result.findings.find(f => f.severity === "legacy_key_used" && /created/.test(f.message));
    assertTrue(!!hi, "AU-FA-1b: legacy_key_used HIGH fires on `created:` key");
  });
}

// AU-FA-2 — non_iso_timestamp HIGH for malformed created_at
async function caseAUFA2() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m2.md",
      "---\ntype: meeting\ncreated_at: 2026-05-15\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "non_iso_timestamp");
    assertTrue(!!found, "AU-FA-2: non_iso_timestamp HIGH fires on malformed created_at");
  });
}

// AU-FA-3 — unquoted_wikilink MEDIUM for bare [[X]] in people block
async function caseAUFA3() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m3.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\npeople:\n  - [[Alice]]\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "unquoted_wikilink");
    assertTrue(!!found, "AU-FA-3: unquoted_wikilink MEDIUM fires on bare [[X]] in people");
  });
}

// AU-FA-4 — discriminator_tag_present INFO
async function caseAUFA4() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m4.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\ntags:\n  - meeting\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "discriminator_tag_present");
    assertTrue(!!found, "AU-FA-4: discriminator_tag_present INFO fires on tags: [meeting]");
  });
}

// AU-FA-5 — temporal_tag_present INFO
async function caseAUFA5() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m5.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\ntags:\n  - 2026/05/17\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "temporal_tag_present");
    assertTrue(!!found, "AU-FA-5: temporal_tag_present INFO fires on tags: [2026/05/17]");
  });
}

// AU-FA-6 — missing_canonical_key MEDIUM (type set, created_at absent)
async function caseAUFA6() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m6.md",
      "---\ntype: meeting\nstatus: scheduled\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "missing_canonical_key");
    assertTrue(!!found, "AU-FA-6: missing_canonical_key MEDIUM fires when type set but created_at absent");
  });
}

// AU-FA-7 — happy: clean canonical note has no findings, counts.aligned incremented
async function caseAUFA7() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/clean.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\nattendees:\n  - \"[[Alice]]\"\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    assertEqual(result.findings.length, 0, "AU-FA-7a: canonical note produces zero findings");
    assertTrue(result.counts.aligned >= 1, "AU-FA-7b: counts.aligned >= 1 for clean note");
  });
}

// AU-FA-8 — non-sauce vault throws exitCode=2
async function caseAUFA8() {
  await withTempVault(async (dir) => {
    // No ranch/platform-installed.json
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    let threw = false;
    try { await walkFrontmatterAlignment(dir); }
    catch (e) { threw = e && e.exitCode === 2; }
    assertTrue(threw, "AU-FA-8: non-sauce vault throws exitCode=2");
  });
}

// AU-FA-9 — legacy_key_used: singular `product:` on type:team
async function caseAUFA9() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir, { blueprints: [{ name: "teams", version: "0.1.0" }] });
    writeRawNote(dir, "spice/teams/t.md",
      "---\ntype: team\ncreated_at: \"2026-05-15T09:30:00-07:00\"\nproduct: \"[[ACME]]\"\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const found = result.findings.find(f => f.severity === "legacy_key_used" && /product/.test(f.message));
    assertTrue(!!found, "AU-FA-9: legacy_key_used HIGH fires on singular product: on type:team");
  });
}

// AU-FA-10 — canonical ISO+TZ created_at produces no non_iso finding
async function caseAUFA10() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/ok.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\nattendees:\n  - \"[[Alice]]\"\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const niFinding = result.findings.find(f => f.severity === "non_iso_timestamp");
    assertTrue(!niFinding, "AU-FA-10: canonical ISO+TZ created_at produces no non_iso finding");
  });
}

// AU-FA-11 — report formatter emits counts line + JSON summary footer
async function caseAUFA11() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/m.md",
      "---\ntype: meeting\ncreated: 2026-05-15\n---\nbody\n");
    const cmd = require("../cli/cmd-audit");
    const outputFile = path.join(dir, "out.md");
    try {
      await cmd._runForTest({
        vaultPath: dir, blueprintFilter: null, outputFile,
        untrackedCheck: false, quiet: true,
        frontmatterAlignment: true, workshopPath: ROOT, strict: false,
      });
    } catch (e) { /* exit code 1 from findings is expected; outputFile still written */ }
    const md = fs.readFileSync(outputFile, "utf8");
    assertContains(md, "sauce audit --frontmatter-alignment", "AU-FA-11a: report header present");
    assertContains(md, "frontmatter-alignment-summary:", "AU-FA-11b: JSON summary footer present");
  });
}

// AU-FA-12 — preserve_tags allowlist: tags:[kanban-card] doesn't trigger discriminator finding
async function caseAUFA12() {
  await withTempVault(async (dir) => {
    seedFrontmatterAlignmentVault(dir);
    writeRawNote(dir, "spice/meetings/p.md",
      "---\ntype: meeting\ncreated_at: \"2026-05-15T09:30:00-07:00\"\ntags:\n  - kanban-card\n---\nbody\n");
    const { walkFrontmatterAlignment } = require("../audit/frontmatter-alignment-walker");
    const result = await walkFrontmatterAlignment(dir);
    const discFinding = result.findings.find(f => f.severity === "discriminator_tag_present");
    assertTrue(!discFinding, "AU-FA-12: preserve_tags allowlist excludes kanban-card from discriminator finding");
  });
}

// ============================================================
// v0.50.0 S5 (renamed v0.52.0) — AU-DOCS-1..4: docs rule_fragment audit cases.
// ============================================================

const WIKI_HUB_FRAGMENT = [{
  scope: { path_glob: "spice/projects/*/docs/Docs.md" },
  required_frontmatter: {
    type:         { required: true, type: "string", equals: "docs-hub" },
    project_slug: { required: true, type: "string" },
    project_name: { required: true, type: "string" },
    created:      { required: true, type: "string" }
  },
  required_tags: [{ tag: "docs-hub" }]
}];

const WIKI_NOTE_FRAGMENT = [{
  scope: { path_glob: "spice/projects/*/docs/*.md", exclude_basenames: ["Docs.md"] },
  required_frontmatter: {
    type:         { required: true, type: "string", equals: "doc-note" },
    project:      { required: true, type: "string" },
    project_slug: { required: true, type: "string" },
    created:      { required: true, type: "string" }
  },
  required_tags: [{ tag: "doc-note" }]
}];

// AU-DOCS-1: valid docs-hub → zero violations
async function caseAUWIKI1WikiHubValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["project"], rules: { project: WIKI_HUB_FRAGMENT } });
    writeNote(dir, "spice/projects/test-proj/docs/Docs.md",
      { type: "docs-hub", project_slug: "test-proj", project_name: "Test Proj", created: "2026-05-16 12:00", tags: ["docs-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("Docs.md"));
    assertEqual(violations.length, 0, "AU-DOCS-1: valid docs-hub has zero violations");
  });
}

// AU-DOCS-2: docs-hub missing project_slug → violation
async function caseAUWIKI2WikiHubMissingSlug() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["project"], rules: { project: WIKI_HUB_FRAGMENT } });
    writeNote(dir, "spice/projects/test-proj/docs/Docs.md",
      { type: "docs-hub", project_name: "Test Proj", created: "2026-05-16 12:00", tags: ["docs-hub"] });  // missing project_slug
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    assertTrue(result.violations.some(v => /project_slug/i.test(JSON.stringify(v))),
      "AU-DOCS-2: missing project_slug surfaces violation");
  });
}

// AU-DOCS-3: valid doc-note → zero violations
async function caseAUWIKI3WikiNoteValid() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["project"], rules: { project: WIKI_NOTE_FRAGMENT } });
    writeNote(dir, "spice/projects/test-proj/docs/Some Thought.md",
      { type: "doc-note", project: "[[Test Proj]]", project_slug: "test-proj", created: "2026-05-16 12:00", tags: ["doc-note"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const violations = result.violations.filter(v => v.file && v.file.endsWith("Some Thought.md"));
    assertEqual(violations.length, 0, "AU-DOCS-3: valid doc-note has zero violations");
  });
}

// AU-DOCS-4: doc-note rule respects exclude_basenames — a Docs.md in the
// same folder is NOT subject to the doc-note rule (no spurious violation
// on Docs.md when only the doc-note fragment is active).
async function caseAUWIKI4ExcludeBasenamesHonored() {
  await withTempVault(async (dir) => {
    makeSauceVault(dir, { blueprints: ["project"], rules: { project: WIKI_NOTE_FRAGMENT } });
    // Docs.md has docs-hub-shaped frontmatter (NOT doc-note). Under the
    // doc-note fragment alone, exclude_basenames must drop it from scope.
    writeNote(dir, "spice/projects/test-proj/docs/Docs.md",
      { type: "docs-hub", project_slug: "test-proj", project_name: "Test Proj", created: "2026-05-16 12:00", tags: ["docs-hub"] });
    const { runAudit } = require("../audit/walker");
    const result = await runAudit({ vaultPath: dir, untrackedCheck: false });
    const wikiViolations = result.violations.filter(v => v.file && v.file.endsWith("Docs.md"));
    assertEqual(wikiViolations.length, 0, "AU-DOCS-4: exclude_basenames excludes Docs.md from doc-note rule");
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
  // v0.31.0 S4 — engagement-templates path-glob cases
  if (selector === "engagement_templates" || selector === "all") { for (let i = 39; i <= 40; i++) await runCase(`AU${i}`, eval(`caseAU${i}`)); }
  // v0.32.0 S7.A — claude-surface walker cases (AU-CS-1..6)
  if (selector === "claude_surface" || selector === "all") {
    await runCase("AU-CS-1", caseAUCS1);
    await runCase("AU-CS-2", caseAUCS2);
    await runCase("AU-CS-3", caseAUCS3);
    await runCase("AU-CS-4", caseAUCS4);
    await runCase("AU-CS-5", caseAUCS5);
    await runCase("AU-CS-6", caseAUCS6);
  }
  // v0.37.0 S3.3 — scratch blueprint rule_fragment audit cases (SA-S1..6)
  if (selector === "scratch" || selector === "all") {
    await runCase("SA-S1", caseSAS1);
    await runCase("SA-S2", caseSAS2);
    await runCase("SA-S3", caseSAS3);
    await runCase("SA-S4", caseSAS4);
    await runCase("SA-S5", caseSAS5);
    await runCase("SA-S6", caseSAS6);
    await runCase("SA-S7", caseSAS7DayHubValid);
    await runCase("SA-S8", caseSAS8DayHubBadType);
  }
  // v0.42.0 S7 — cowork timeframe rule_fragment audit cases (CW-1..12)
  if (selector === "cowork" || selector === "all") {
    await runCase("CW-1",  caseCW1DailyHubValid);
    await runCase("CW-2",  caseCW2DailyHubMissingType);
    await runCase("CW-3",  caseCW3WeeklyHubValid);
    await runCase("CW-4",  caseCW4WeeklyHubMissingTags);
    await runCase("CW-5",  caseCW5MonthlyHubValid);
    await runCase("CW-6",  caseCW6MonthlyHubMissingTags);
    await runCase("CW-7",  caseCW7WeeklyValid);
    await runCase("CW-8",  caseCW8WeeklyMissingWeekStart);
    await runCase("CW-9",  caseCW9MonthlyValid);
    await runCase("CW-10", caseCW10MonthlyBadFilename);
    await runCase("CW-11", caseCW11PromptValid);
    await runCase("CW-12", caseCW12PromptMissingPromptFor);
    // v0.44.0 S9 — cowork-about rule_fragment audit cases
    await runCase("CW-13", caseCW13AboutValid);
    await runCase("CW-14", caseCW14AboutMissingTag);
    // v0.45.0 S8 — cowork-daily rule_fragment audit cases
    await runCase("CW-15", caseCW15DailyValid);
    await runCase("CW-16", caseCW16DailyBadType);
  }
  // v0.46.0 S11 — entity-create-walker audit cases (AU-EC-1..6)
  if (selector === "entity_create" || selector === "all") {
    await runCase("AU-EC-1", caseAUEC1);
    await runCase("AU-EC-2", caseAUEC2);
    await runCase("AU-EC-3", caseAUEC3);
    await runCase("AU-EC-4", caseAUEC4);
    await runCase("AU-EC-5", caseAUEC5);
    await runCase("AU-EC-6", caseAUEC6);
  }
  // v0.53.0 FA-1 S7 — frontmatter-alignment-walker audit cases (AU-FA-1..12)
  if (selector === "frontmatter_alignment" || selector === "all") {
    await runCase("AU-FA-1",  caseAUFA1);
    await runCase("AU-FA-2",  caseAUFA2);
    await runCase("AU-FA-3",  caseAUFA3);
    await runCase("AU-FA-4",  caseAUFA4);
    await runCase("AU-FA-5",  caseAUFA5);
    await runCase("AU-FA-6",  caseAUFA6);
    await runCase("AU-FA-7",  caseAUFA7);
    await runCase("AU-FA-8",  caseAUFA8);
    await runCase("AU-FA-9",  caseAUFA9);
    await runCase("AU-FA-10", caseAUFA10);
    await runCase("AU-FA-11", caseAUFA11);
    await runCase("AU-FA-12", caseAUFA12);
  }
  // v0.50.0 S5 (renamed v0.52.0) — docs rule_fragment audit cases (AU-DOCS-1..4)
  if (selector === "wiki" || selector === "docs" || selector === "all") {
    await runCase("AU-DOCS-1", caseAUWIKI1WikiHubValid);
    await runCase("AU-DOCS-2", caseAUWIKI2WikiHubMissingSlug);
    await runCase("AU-DOCS-3", caseAUWIKI3WikiNoteValid);
    await runCase("AU-DOCS-4", caseAUWIKI4ExcludeBasenamesHonored);
  }
  // AUDIT-V065: 6 new cowork run-note rule_fragments registered
  {
    const manifest = JSON.parse(fs.readFileSync("platform/blueprints/cowork/manifest.json", "utf8"));
    const registeredTypes = (manifest.rule_fragments || [])
      .map(rf => rf?.fragment?.required_frontmatter?.type?.equals)
      .filter(Boolean);
    const expectedTypes = [
      "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
      "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review",
    ];
    for (const t of expectedTypes) {
      assertTrue(registeredTypes.includes(t), `AUDIT-V065: cowork manifest registers rule_fragment for ${t}`);
    }
  }

  console.log(`========\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
