#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * run-cowork-smoke.js — cowork blueprint smoke harness (v0.31.0 S5.8)
 *
 * Static-validates the cowork blueprint's engagement-aware contract for each
 * of the three engagement types. NOT a full Claude-runtime simulator — there
 * is no programmatic execution of SKILL.md bodies in this workshop. Instead,
 * the harness asserts each fixture's gather → write pipeline contract holds:
 *
 *   - manifest exposes the morning-briefing orchestrator + required sub-skills
 *   - orchestrator SKILL.md references the new merged write-callout-morning-briefing
 *   - write-callout-morning-briefing SKILL.md exposes the per-type shape header
 *   - engagement-type registry loads + has required_fields for the fixture's type
 *   - engagement-templates/<type>/ dir contains the expected files
 *   - gather-* sub-skills referenced by the orchestrator declare engagement_id input
 *
 * 3 fixtures × ~5 sub-asserts each ≈ 15 baseline sub-asserts. Designed to catch
 * regressions in the SKILL.md contract shape (missing engagement_id in a gather,
 * type-branch dropped from the merged write-callout, template dir reorganized
 * without manifest update).
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BP = path.join(ROOT, "platform/blueprints/cowork");

let passed = 0, failed = 0;
function assertTrue(c, msg)     { if (!c)      { failed++; console.error(`FAIL ${msg}`); } else passed++; }
function assertContains(haystack, needle, msg) { if (!String(haystack).includes(needle)) { failed++; console.error(`FAIL ${msg}: missing ${JSON.stringify(needle)}`); } else passed++; }

function readSkill(relPath) {
  const full = path.join(BP, relPath);
  return fs.readFileSync(full, "utf8");
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(BP, "manifest.json"), "utf8"));
}

function loadEngagementType(type) {
  return JSON.parse(fs.readFileSync(path.join(BP, `engagement-types/${type}.json`), "utf8"));
}

// -------------------------------------------------------------------------
// Fixtures — one per engagement type
// -------------------------------------------------------------------------

const FIXTURES = [
  {
    name: "morning-briefing — personal engagement",
    engagement: {
      id:   "personal-fixture",
      type: "personal",
      label: "Personal",
      owner_name: "Test Owner",
      home_city: "Evergreen, CO",
    },
    expected_templates: [
      "about.md", "brand-voice.md", "finance-guide.md", "mcp-integrations.md",
      "people.md", "project-management.md", "whatsapp-integration.md", "working-style.md",
    ],
    expected_shape_marker: "### personal shape",
  },
  {
    name: "morning-briefing — w2-fte engagement",
    engagement: {
      id:   "fte-fixture",
      type: "w2-fte",
      label: "Acme",
      role: "Principal Engineer",
      employer: "Acme Corp",
      stakeholders: ["Pat", "Sam"],
    },
    expected_templates: [
      "about.md", "mcp-integrations.md", "stakeholders.md", "working-style.md",
    ],
    expected_shape_marker: "### w2-fte shape",
  },
  {
    name: "morning-briefing — consulting engagement",
    engagement: {
      id:   "consulting-fixture",
      type: "consulting",
      label: "ClientCo",
      role: "Staff Engineer (contract)",
      primary_client: "ClientCo",
      hourly_rate_usd: 200,
      ap_email: "ap@clientco.example",
      invoice_cadence: "monthly",
    },
    expected_templates: [
      "about.md", "client-context.md", "finance-guide.md", "mcp-integrations.md",
      "stakeholders.md", "working-style.md",
    ],
    expected_shape_marker: "### consulting shape",
  },
];

// -------------------------------------------------------------------------
// Shared assertions across all fixtures (manifest + merged write-callout)
// -------------------------------------------------------------------------

function checkSharedContracts() {
  const manifest = loadManifest();

  // v0.32.0 S8 — cowork@0.3.0 migrated manifest.skills[] → claude_surface[]
  // with kind=skill entries. Filter to kind=skill to recover the source list.
  // S1 — orchestrator + key sub-skills present
  const skillSources = Array.isArray(manifest.claude_surface)
    ? manifest.claude_surface.filter(e => e && e.kind === "skill").map(e => e.source)
    : (Array.isArray(manifest.skills) ? manifest.skills.map(s => s.source) : []);
  assertTrue(skillSources.includes("skills/orchestrators/morning-briefing/SKILL.md"),
    "S1: manifest exposes morning-briefing orchestrator");
  assertTrue(skillSources.includes("skills/skills/write-run-note-morning-briefing/SKILL.md"),
    "S1: manifest exposes write-run-note-morning-briefing (v0.65.0 run-note form)");
  assertTrue(!skillSources.includes("skills/skills/patch-daily-callouts/SKILL.md"),
    "S1: manifest no longer exposes patch-daily-callouts (v0.68.0 — orphan removed)");

  // S2 — manifest dropped the 4 deleted ero-* orchestrators
  for (const dropped of ["ero-morning", "ero-eod", "ero-weekly", "ero-monthly"]) {
    assertTrue(!skillSources.some(s => s.includes(`/${dropped}/`)),
      `S2: manifest no longer references orchestrators/${dropped}`);
  }

  // S3 — manifest dropped the 8 collapsed-pair sub-skills + invoice-prep rename
  const droppedSubs = [
    "write-callout-morning-briefing-life", "write-callout-morning-briefing-ero",
    "write-callout-eod-life", "write-callout-eod-ero",
    "write-summary-weekly-life", "write-summary-weekly-ero",
    "write-summary-monthly-life", "write-summary-monthly-ero",
    "invoice-prep",
  ];
  for (const sub of droppedSubs) {
    assertTrue(!skillSources.some(s => s.endsWith(`/${sub}/SKILL.md`)),
      `S3: manifest no longer references skills/${sub}`);
  }

  // S4 — engagement-type registry present
  assertTrue(Array.isArray(manifest.engagement_types) && manifest.engagement_types.length === 3,
    "S4: manifest declares 3 engagement_types");

  // S5 — write-run-note-morning-briefing (v0.65.0 run-note form) has canonical frontmatter fields
  const wcb = readSkill("skills/skills/write-run-note-morning-briefing/SKILL.md");
  assertContains(wcb, "cowork:write-run-note-morning-briefing", "S5: write-run-note-morning-briefing has canonical name");
  assertContains(wcb, "created_at",                             "S5: write-run-note-morning-briefing references created_at");
  assertContains(wcb, "engagement-aware",                       "S5: write-run-note-morning-briefing tagged engagement-aware");

  // S6 — orchestrator declares engagement_id intake
  const morning = readSkill("skills/orchestrators/morning-briefing/SKILL.md");
  assertContains(morning, "engagement_id: string", "S6: morning-briefing orchestrator declares engagement_id input");
  assertContains(morning, ".claude/skills/cowork/skills/write-run-note-morning-briefing/SKILL.md", "S6: morning-briefing dispatches write-run-note-morning-briefing");
  assertContains(morning, "Resolve engagement", "S6: morning-briefing has Resolve engagement pre-flight step");

  // S7 — every gather sub-skill referenced by orchestrators declares engagement_id
  const gathers = [
    "gather-weather", "gather-calendar", "gather-gmail", "gather-imessage",
    "gather-finance-yesterday", "gather-cc-debt-snapshot", "gather-projects", "gather-threads",
    "gather-finance-cc-today",
  ];
  for (const g of gathers) {
    const body = readSkill(`skills/skills/${g}/SKILL.md`);
    assertContains(body, "engagement_id: string", `S7: ${g} declares engagement_id input`);
    assertContains(body, "engagement-aware", `S7: ${g} tagged engagement-aware`);
  }

  // S8 — patch-daily-callouts removed in v0.68.0 (orphan deletion; atomic-note
  // contract retired callout-patching surface). Asserted absent in S1 above.
}

// -------------------------------------------------------------------------
// Per-fixture assertions
// -------------------------------------------------------------------------

function checkFixture(fix) {
  console.log(`--- ${fix.name} ---`);

  // F1 — engagement-type registry has required_fields for this type
  const typeManifest = loadEngagementType(fix.engagement.type);
  assertTrue(typeManifest.id === fix.engagement.type,
    `F1[${fix.engagement.type}]: registry id matches`);
  assertTrue(Array.isArray(typeManifest.required_fields) && typeManifest.required_fields.length >= 1,
    `F1[${fix.engagement.type}]: registry has required_fields`);
  assertTrue(typeManifest.render_aspects && typeof typeManifest.render_aspects === "object",
    `F1[${fix.engagement.type}]: registry has render_aspects`);

  // F2 — engagement-templates/<type>/ has all expected files
  const tplDir = path.join(BP, `content/context/engagement-templates/${fix.engagement.type}`);
  const tplFiles = fs.readdirSync(tplDir).sort();
  for (const expected of fix.expected_templates) {
    assertTrue(tplFiles.includes(expected),
      `F2[${fix.engagement.type}]: engagement-templates/${fix.engagement.type}/${expected} present`);
  }

  // F3 — fixture engagement has all required fields per the registry
  for (const rf of typeManifest.required_fields) {
    assertTrue(rf.id in fix.engagement,
      `F3[${fix.engagement.type}]: fixture engagement has required field '${rf.id}'`);
  }

  // F4 — write-run-note-morning-briefing (v0.65.0) exists and is engagement-aware
  const wcb = readSkill("skills/skills/write-run-note-morning-briefing/SKILL.md");
  assertContains(wcb, "engagement-aware",
    `F4[${fix.engagement.type}]: write-run-note-morning-briefing tagged engagement-aware`);

  // F5 — render_aspects-driven gating predicates expected for this type
  const ra = typeManifest.render_aspects;
  if (fix.engagement.type === "personal") {
    assertTrue(ra.finance_block === "include",
      "F5[personal]: render_aspects.finance_block == include");
    assertTrue(ra.inner_circle_imessage === "include",
      "F5[personal]: render_aspects.inner_circle_imessage == include");
    assertTrue(ra.invoice_prep === "skip",
      "F5[personal]: render_aspects.invoice_prep == skip");
  } else if (fix.engagement.type === "w2-fte") {
    assertTrue(ra.finance_block === "skip",
      "F5[w2-fte]: render_aspects.finance_block == skip");
    assertTrue(ra.invoice_prep === "skip",
      "F5[w2-fte]: render_aspects.invoice_prep == skip");
    assertTrue(ra.inner_circle_imessage === "skip",
      "F5[w2-fte]: render_aspects.inner_circle_imessage == skip");
  } else if (fix.engagement.type === "consulting") {
    assertTrue(ra.finance_block === "include",
      "F5[consulting]: render_aspects.finance_block == include");
    assertTrue(ra.invoice_prep === "include",
      "F5[consulting]: render_aspects.invoice_prep == include");
    assertTrue(ra.inner_circle_imessage === "skip",
      "F5[consulting]: render_aspects.inner_circle_imessage == skip");
  }
}

// -------------------------------------------------------------------------
// v0.42.0 S9 — Timeframe surface contracts (6 sub-asserts)
// Verifies the three hub content sources + two template sources exist and
// the skill source file is present. Also confirms manifest files[] declares
// the correct dest for each so the installer will materialize them correctly.
// -------------------------------------------------------------------------

function checkTimeframeContracts() {
  console.log("--- v0.42.0 timeframe surface contracts ---");
  const manifest = loadManifest();
  const filesArr = manifest.files || [];

  // T1 — Daily Hub source exists + manifest declares dest {{module_directory}}/Daily Hub.md
  const dailyHubSrc = path.join(BP, "content/Daily Hub.md");
  assertTrue(fs.existsSync(dailyHubSrc), "T1: content/Daily Hub.md source exists");
  const dailyHubEntry = filesArr.find(f => f.source === "content/Daily Hub.md");
  assertTrue(!!dailyHubEntry && dailyHubEntry.dest === "{{module_directory}}/Daily Hub.md",
    "T1: manifest files[] maps Daily Hub to {{module_directory}}/Daily Hub.md");

  // T2 — Weekly Hub source exists
  const weeklyHubSrc = path.join(BP, "content/Weekly Hub.md");
  assertTrue(fs.existsSync(weeklyHubSrc), "T2: content/Weekly Hub.md source exists");
  const weeklyHubEntry = filesArr.find(f => f.source === "content/Weekly Hub.md");
  assertTrue(!!weeklyHubEntry && weeklyHubEntry.dest === "{{module_directory}}/Weekly Hub.md",
    "T2: manifest files[] maps Weekly Hub to {{module_directory}}/Weekly Hub.md");

  // T3 — Monthly Hub source exists
  const monthlyHubSrc = path.join(BP, "content/Monthly Hub.md");
  assertTrue(fs.existsSync(monthlyHubSrc), "T3: content/Monthly Hub.md source exists");

  // T4 — Weekly Note template source exists + manifest maps to {{templates_path}}/Weekly Note.md
  const weeklyNoteSrc = path.join(BP, "content/Weekly Note.md");
  assertTrue(fs.existsSync(weeklyNoteSrc), "T4: content/Weekly Note.md source exists");
  const weeklyNoteEntry = filesArr.find(f => f.source === "content/Weekly Note.md");
  assertTrue(!!weeklyNoteEntry && weeklyNoteEntry.dest === "{{templates_path}}/Weekly Note.md",
    "T4: manifest files[] maps Weekly Note to {{templates_path}}/Weekly Note.md");

  // T5 — Monthly Note template source exists
  const monthlyNoteSrc = path.join(BP, "content/Monthly Note.md");
  assertTrue(fs.existsSync(monthlyNoteSrc), "T5: content/Monthly Note.md source exists");

  // T6 — scaffold-timeframes SKILL.md source exists in claude_surface[]
  const scaffoldSkill = (manifest.claude_surface || []).find(
    e => e.kind === "skill" && e.source === "skills/skills/scaffold-timeframes/SKILL.md"
  );
  assertTrue(!!scaffoldSkill, "T6: claude_surface[] declares scaffold-timeframes skill");
  const scaffoldSrc = path.join(BP, "skills/skills/scaffold-timeframes/SKILL.md");
  assertTrue(fs.existsSync(scaffoldSrc), "T6: scaffold-timeframes SKILL.md source file exists");

  // T7 — v0.43.0: CoworkTimeframeButtons helper file exists + manifest registers it.
  const tfHelperSrc = path.join(BP, "helpers/cowork-timeframe-buttons.js");
  assertTrue(fs.existsSync(tfHelperSrc), "T7: helpers/cowork-timeframe-buttons.js source exists");
  const tfHelperBody = fs.existsSync(tfHelperSrc) ? fs.readFileSync(tfHelperSrc, "utf8") : "";
  assertTrue(/class\s+CoworkTimeframeButtons\b/.test(tfHelperBody),
    "T7: helper body declares class CoworkTimeframeButtons");
  assertTrue(/_dispatch\s*\(/.test(tfHelperBody),
    "T7: helper body has _dispatch method");
  assertTrue(/create_new_note_from_template/.test(tfHelperBody),
    "T7: helper body invokes Templater.create_new_note_from_template (runTemplaterTemplate mirror)");
  const tfHelperEntry = filesArr.find(f => f.source === "helpers/cowork-timeframe-buttons.js");
  assertTrue(!!tfHelperEntry && tfHelperEntry.dest === "{{scripts_path}}/cowork/cowork-timeframe-buttons.js",
    "T7: manifest files[] maps helper to {{scripts_path}}/cowork/cowork-timeframe-buttons.js");
  const cjsClasses = manifest.customjs_classes || [];
  assertTrue(cjsClasses.includes("CoworkTimeframeButtons"),
    "T7: manifest customjs_classes[] includes CoworkTimeframeButtons");

  // T8 — v0.43.0: Cowork.md Timeframes section delegates via customjs-guard
  // to CoworkTimeframeButtons (replaces the v0.42.0 inline 3-card block).
  const coworkMdSrc = path.join(BP, "content/Cowork.md");
  const coworkMdBody = fs.existsSync(coworkMdSrc) ? fs.readFileSync(coworkMdSrc, "utf8") : "";
  assertTrue(/^##\s+Timeframes\s*$/m.test(coworkMdBody),
    "T8: Cowork.md retains the ## Timeframes heading");
  assertTrue(/customjs-guard.*class:\s*"CoworkTimeframeButtons"/.test(coworkMdBody),
    "T8: Cowork.md Timeframes section delegates to CoworkTimeframeButtons via customjs-guard");
  assertTrue(!/items:\s*cardItems/.test(coworkMdBody) && !/titleField/.test(coworkMdBody) && !/subtitleField/.test(coworkMdBody) && !/linkField/.test(coworkMdBody),
    "T8: Cowork.md no longer contains the v0.42.0 broken BeaconCards call (items/titleField/subtitleField/linkField)");

  // T9 — v0.43.0: nav_buttons[] retains only cowork-hub (the 2 timeframe-creation
  // buttons moved inside Cowork.md as cards in T2).
  const navBtns = manifest.nav_buttons || [];
  assertTrue(navBtns.length === 1,
    `T9: manifest.nav_buttons[].length === 1 (got ${navBtns.length})`);
  assertTrue(navBtns[0] && navBtns[0].id === "cowork-hub",
    "T9: nav_buttons[0].id === 'cowork-hub'");
  assertTrue(!navBtns.some(b => b.id === "cowork-weekly-this" || b.id === "cowork-monthly-this"),
    "T9: nav_buttons[] no longer contains cowork-weekly-this or cowork-monthly-this");
}

// -------------------------------------------------------------------------
// v0.44.0 S9 — UX polish shape asserts
// -------------------------------------------------------------------------

function assertCoworkV044Shape() {
  console.log("--- v0.44.0 UX polish shape ---");
  const cowork = BP;
  // --- About Cowork.md materialized ---
  const aboutPath = path.join(cowork, "content/About Cowork.md");
  assertTrue(fs.existsSync(aboutPath), "v0.44.0: About Cowork.md exists");
  if (fs.existsSync(aboutPath)) {
    const about = fs.readFileSync(aboutPath, "utf8");
    assertContains(about, "type: cowork-about", "v0.44.0: About Cowork frontmatter type");
    assertContains(about, "What is cowork?", "v0.44.0: About Cowork holds the abstract");
    assertContains(about, "Orchestrators (5)", "v0.44.0: About Cowork holds orchestrators table");
    assertContains(about, "Sub-skills (27)", "v0.44.0: About Cowork holds sub-skills table");
    assertContains(about, "## Getting started", "v0.44.0: About Cowork holds getting-started section");
  }
  // --- Cowork.md hub stripped of docs ---
  const hubPath = path.join(cowork, "content/Cowork.md");
  const hub = fs.readFileSync(hubPath, "utf8");
  assertTrue(!hub.includes("What is cowork?"), "v0.44.0: Cowork.md no longer holds 'What is cowork?' abstract");
  assertTrue(!hub.includes("Orchestrators (5)"), "v0.44.0: Cowork.md no longer holds skills tables");
  assertTrue(!hub.includes("## Getting started"), "v0.44.0: Cowork.md no longer holds getting-started");
  assertContains(hub, "CoworkHubNav", "v0.44.0: Cowork.md invokes CoworkHubNav");
  assertContains(hub, "About Cowork.md", "v0.44.0: Cowork.md links to About Cowork.md");
  // --- CoworkHubNav helper materialized ---
  const navPath = path.join(cowork, "helpers/cowork-hub-nav.js");
  assertTrue(fs.existsSync(navPath), "v0.44.0: cowork-hub-nav.js exists");
  if (fs.existsSync(navPath)) {
    const nav = fs.readFileSync(navPath, "utf8");
    assertContains(nav, "class CoworkHubNav", "v0.44.0: CoworkHubNav class declared");
    // v0.45.0 S1: subtitle 'you are here' removed; CoworkHubNav now an AccentButton row.
    // The v0.7.0+ posture is exercised by assertCoworkV045Shape below.
  }
  // --- Daily/Weekly/Monthly Hub all use CoworkHubNav, dropped text-link row ---
  for (const name of ["Daily Hub", "Weekly Hub", "Monthly Hub"]) {
    const body = fs.readFileSync(path.join(cowork, `content/${name}.md`), "utf8");
    assertContains(body, "CoworkHubNav", `v0.44.0: ${name}.md invokes CoworkHubNav`);
    assertTrue(!body.includes("◀ Cowork"), `v0.44.0: ${name}.md no longer has '◀ Cowork' text-link row`);
  }
  // --- Cards helpers use correct BeaconCards API (fix for v0.44.0) ---
  for (const f of ["cowork-daily-hub-cards.js", "cowork-weekly-hub-cards.js", "cowork-monthly-hub-cards.js"]) {
    const body = fs.readFileSync(path.join(cowork, `helpers/${f}`), "utf8");
    assertTrue(!/\bitems:\s*cardItems/.test(body), `v0.44.0: ${f} no longer uses 'items:' (was wrong BeaconCards key)`);
    assertTrue(!/\btitleField\b/.test(body), `v0.44.0: ${f} no longer uses 'titleField:'`);
    assertTrue(!/\bbodyField\b/.test(body), `v0.44.0: ${f} no longer uses 'bodyField:'`);
    assertTrue(!/\blinkField\b/.test(body), `v0.44.0: ${f} no longer uses 'linkField:'`);
    assertContains(body, "pages: cardItems", `v0.44.0: ${f} uses 'pages: cardItems'`);
  }
  // --- Manifest icon is briefcase ---
  // v0.45.0: version assertion bumped to assertCoworkV045Shape (which checks 0.7.0).
  const m = loadManifest();
  const hubNav = (m.nav_buttons || []).find(b => b.id === "cowork-hub");
  assertTrue(hubNav && hubNav.icon === "briefcase", "v0.44.0: cowork-hub nav-button icon is 'briefcase'");
}

// -------------------------------------------------------------------------
// v0.45.0 S8 — Self-contained cowork shape asserts
// -------------------------------------------------------------------------

function assertCoworkV045Shape() {
  console.log("--- v0.45.0 self-contained shape ---");
  const cowork = BP;

  // --- Daily Note.md template ---
  // v0.64.0 S5 baseline widening: cowork@0.9.1 no longer owns the daily
  // template (template ownership returned to daily@0.5.0 to resolve the
  // destination collision at ranch/templates/Daily Note.md). The
  // type=cowork-daily / SpaceNavButtons / created_at shape now lives in
  // daily/content/daily-template.md and is pinned by DD-T1 in
  // run-helper-cases.js. CoworkHubNav DELIBERATELY no longer appears in
  // the daily template (still present in cowork hub files).

  // --- CoworkDailyActions helper ---
  const dailyActionsPath = path.join(cowork, "helpers/cowork-daily-actions.js");
  assertTrue(fs.existsSync(dailyActionsPath), "v0.45.0: cowork-daily-actions.js exists");

  // --- CoworkHubNav uses AccentButton ---
  const hubNav = fs.readFileSync(path.join(cowork, "helpers/cowork-hub-nav.js"), "utf8");
  assertContains(hubNav, "AccentButton.render", "v0.45.0: CoworkHubNav uses AccentButton.render");
  assertTrue(!hubNav.includes("you are here"), "v0.45.0: CoworkHubNav no longer has 'you are here'");
  assertTrue(!/BeaconCards\.render/.test(hubNav), "v0.45.0: CoworkHubNav no longer calls BeaconCards.render");

  // --- Daily hub cards retargeted ---
  const dailyCards = fs.readFileSync(path.join(cowork, "helpers/cowork-daily-hub-cards.js"), "utf8");
  assertContains(dailyCards, "spice/cowork/daily", "v0.45.0: cowork-daily-hub-cards reads spice/cowork/daily");
  assertTrue(!/dv\.pages\('"spice\/daily"'\)/.test(dailyCards), "v0.45.0: cowork-daily-hub-cards no longer reads spice/daily");

  // --- Nav pattern on all 5 hubs + 2 templates (Weekly + Monthly Note) ---
  // v0.64.0 S5 baseline widening: content/Daily Note.md dropped from the
  // nav-pattern loop; cowork no longer materializes that template
  // (daily@0.5.0 now owns it, and per design CoworkHubNav is absent from
  // the daily-note template).
  const navPatternFiles = [
    "content/Cowork.md", "content/About Cowork.md", "content/Daily Hub.md",
    "content/Weekly Hub.md", "content/Monthly Hub.md",
    "content/Weekly Note.md", "content/Monthly Note.md"
  ];
  for (const rel of navPatternFiles) {
    const body = fs.readFileSync(path.join(cowork, rel), "utf8");
    assertContains(body, "SpaceNavButtons", `v0.45.0: ${rel} has SpaceNavButtons block`);
    assertContains(body, "CoworkHubNav", `v0.45.0: ${rel} has CoworkHubNav block`);
  }

  // --- Timeframes 6-card row ---
  const tfButtons = fs.readFileSync(path.join(cowork, "helpers/cowork-timeframe-buttons.js"), "utf8");
  assertContains(tfButtons, "createDaily", "v0.45.0: Timeframes has createDaily card");
  assertContains(tfButtons, '"Today"', "v0.45.0: Timeframes has Today label");

  // --- Manifest version + depends_on ---
  const m = loadManifest();
  assertTrue(require("./helpers/semver-helper").versionAtLeast(m.version, "0.8.0"),
    `v0.57.0: cowork manifest version >= 0.8.0 (got ${m.version})`);
  const hasAccentDep = (m.depends_on || []).some(d => d.name === "accent-button");
  assertTrue(hasAccentDep, "v0.45.0: cowork depends_on accent-button");
}

// -------------------------------------------------------------------------
// v0.57.0 (FA-5) — canonical-vocab adoption shape
// -------------------------------------------------------------------------

function assertCoworkV057Shape() {
  console.log("--- v0.57.0 (FA-5) canonical-vocab shape ---");
  const cowork = BP;

  // --- 2 note templates emit canonical created_at + drop discriminator tags ---
  // v0.64.0 S5 baseline widening: Daily Note.md ownership returned to
  // daily@0.5.0 (DD-T1 in run-helper-cases.js pins the canonical
  // created_at: + tags: [daily] + type: cowork-daily shape there).
  const weeklyTpl = fs.readFileSync(path.join(cowork, "content/Weekly Note.md"), "utf8");
  assertContains(weeklyTpl, "created_at:", "v0.57.0: Weekly Note template emits created_at:");
  assertContains(weeklyTpl, "tags: [weekly]", "v0.57.0: Weekly Note template tags is [weekly]");

  const monthlyTpl = fs.readFileSync(path.join(cowork, "content/Monthly Note.md"), "utf8");
  assertContains(monthlyTpl, "created_at:", "v0.57.0: Monthly Note template emits created_at:");
  assertContains(monthlyTpl, "tags: [monthly]", "v0.57.0: Monthly Note template tags is [monthly]");
  assertContains(monthlyTpl, 'month: "<%', "v0.57.0: Monthly Note template emits canonical month:");
  assertContains(monthlyTpl, "month_label:", "v0.57.0: Monthly Note template retains friendly month_label:");
  assertTrue(!/month_iso:/.test(monthlyTpl), "v0.57.0: Monthly Note template drops month_iso:");

  // --- 5 hub files carry static created_at: ---
  for (const hub of ["Cowork.md", "Daily Hub.md", "Weekly Hub.md", "Monthly Hub.md", "About Cowork.md"]) {
    const body = fs.readFileSync(path.join(cowork, "content", hub), "utf8");
    assertContains(body, 'created_at: "2026-', `v0.57.0: ${hub} carries static created_at:`);
  }

  // --- 4 prompt stubs carry static created_at: ---
  for (const prompt of ["morning-briefing", "eod-review", "weekly-review", "monthly-review"]) {
    const body = fs.readFileSync(path.join(cowork, "content/prompts", `${prompt}.md`), "utf8");
    assertContains(body, 'created_at: "2026-', `v0.57.0: prompts/${prompt}.md carries static created_at:`);
  }

  // --- rule_fragments: all-but-SKILL.md fragments have extends ---
  // v0.62.0 FA-9a: NEW cowork-today-hub fragment grew count 13 → 14. Widened.
  const m = loadManifest();
  const fragments = m.rule_fragments || [];
  assertTrue(fragments.length >= 13, `v0.57.0: cowork has >= 13 rule_fragments (got ${fragments.length})`);
  const withExtends = fragments.filter(rf => rf.fragment && rf.fragment.extends === "_canonical-vocab");
  assertTrue(withExtends.length === fragments.length - 1, `v0.57.0: all-but-one rule_fragments extend _canonical-vocab (got ${withExtends.length}/${fragments.length})`);
  const skillFrag = fragments.find(rf => rf.fragment && rf.fragment.scope && /SKILL\.md/.test(rf.fragment.scope.path_glob || ""));
  assertTrue(skillFrag && !skillFrag.fragment.extends, "v0.57.0: SKILL.md rule_fragment does NOT extend _canonical-vocab");

  // --- daily/weekly/monthly fragments drop legacy `created` requirement ---
  for (const scope of ["spice/cowork/daily/**/*.md", "spice/cowork/weekly/**/*.md", "spice/cowork/monthly/**/*.md"]) {
    const frag = fragments.find(rf => rf.fragment.scope.path_glob === scope);
    assertTrue(frag && !((frag.fragment.required_frontmatter || {}).created), `v0.57.0: ${scope} fragment drops required created`);
  }

  // --- daily fragment drops required_tags: [{ tag: "cowork-daily" }] ---
  const dailyFrag = fragments.find(rf => rf.fragment.scope.path_glob === "spice/cowork/daily/**/*.md");
  const dailyRequiredTags = (dailyFrag.fragment.required_tags || []).map(t => t.tag);
  assertTrue(!dailyRequiredTags.includes("cowork-daily"), "v0.57.0: daily fragment drops cowork-daily required_tag");

  // --- monthly fragment adds canonical month: with YYYY-MM regex ---
  const monthlyFrag = fragments.find(rf => rf.fragment.scope.path_glob === "spice/cowork/monthly/**/*.md");
  const monthSpec = (monthlyFrag.fragment.required_frontmatter || {}).month;
  assertTrue(monthSpec && monthSpec.matches === "^\\d{4}-\\d{2}$", "v0.57.0: monthly fragment validates canonical month: regex");
}

// -------------------------------------------------------------------------
// v0.64.0 S5 — cowork manifest no-Daily-Note assertion
// -------------------------------------------------------------------------

function assertCoworkV064NoDailyNote() {
  console.log("--- v0.64.0 (S5) cowork no longer materializes Daily Note.md ---");
  const manifest = loadManifest();
  const filesArr = Array.isArray(manifest.files) ? manifest.files : [];
  const stillMaterializes = filesArr.some(f => f && f.dest === "{{templates_path}}/Daily Note.md");
  assertTrue(!stillMaterializes,
    "COWORK-NDN-1: cowork manifest still materializes templates/Daily Note.md");
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

function assertCoworkV062Shape() {
  console.log("--- v0.62.0 (FA-9a) ActivityFeed hub embeds + Today.md ---");
  const cowork = BP;

  // COWORK-AF-1: Daily Hub embeds "## Today's Activity"
  const dailyHub = fs.readFileSync(path.join(cowork, "content/Daily Hub.md"), "utf8");
  assertContains(dailyHub, "## Today's Activity", "COWORK-AF-1: Daily Hub has '## Today's Activity' H2");
  assertContains(dailyHub, '"ActivityFeed"', "COWORK-AF-1: Daily Hub references ActivityFeed class");
  assertContains(dailyHub, '"today"', "COWORK-AF-1: Daily Hub scope=today");

  // COWORK-AF-2: Weekly Hub embeds "## This Week's Activity"
  const weeklyHub = fs.readFileSync(path.join(cowork, "content/Weekly Hub.md"), "utf8");
  assertContains(weeklyHub, "## This Week's Activity", "COWORK-AF-2: Weekly Hub has '## This Week's Activity' H2");
  assertContains(weeklyHub, '"week"', "COWORK-AF-2: Weekly Hub scope=week");

  // COWORK-AF-3: Monthly Hub embeds "## This Month's Activity"
  const monthlyHub = fs.readFileSync(path.join(cowork, "content/Monthly Hub.md"), "utf8");
  assertContains(monthlyHub, "## This Month's Activity", "COWORK-AF-3: Monthly Hub has '## This Month's Activity' H2");
  assertContains(monthlyHub, '"month"', "COWORK-AF-3: Monthly Hub scope=month");

  // COWORK-AF-4: NEW Today.md exists with 4 ActivityFeed sections + useStatusChangedAt opt
  const todayPath = path.join(cowork, "content/Today.md");
  assertTrue(fs.existsSync(todayPath), "COWORK-AF-4a: cowork content/Today.md exists");
  const todayBody = fs.readFileSync(todayPath, "utf8");
  assertContains(todayBody, "cowork-today-hub", "COWORK-AF-4b: Today.md frontmatter type cowork-today-hub");
  assertContains(todayBody, "## Today's daily note", "COWORK-AF-4c: Today.md has daily-note section");
  assertContains(todayBody, "## Today's meetings", "COWORK-AF-4d: Today.md has meetings section");
  assertContains(todayBody, "## Today's scratches", "COWORK-AF-4e: Today.md has scratches section");
  assertContains(todayBody, "## Today's project status changes", "COWORK-AF-4f: Today.md has project-status section");
  assertContains(todayBody, "useStatusChangedAt", "COWORK-AF-4g: Today.md project-status section uses useStatusChangedAt opt");
  const activityFeedBlocks = (todayBody.match(/class:\s*"ActivityFeed"/g) || []).length;
  assertTrue(activityFeedBlocks >= 4, `COWORK-AF-4h: Today.md has >= 4 ActivityFeed blocks (got ${activityFeedBlocks})`);
}

// -------------------------------------------------------------------------
// v0.65.0 cowork-scheduling-cycle: write-run-note + onboard + readiness
// -------------------------------------------------------------------------

function assertCoworkV065Shape() {
  console.log("--- v0.65.0 cowork-scheduling-cycle: write-run-note + onboard + readiness ---");
  const cowork = BP;

  // S2: 6 write-run-note-* sub-skill bodies present
  const subSkills = [
    "write-run-note-morning-briefing",
    "write-run-note-midday-tripwire",
    "write-run-note-eod-review",
    "write-run-note-finance",
    "write-run-note-weekly-review",
    "write-run-note-monthly-review",
  ];
  for (const slug of subSkills) {
    const p = path.join(cowork, "skills/skills", slug, "SKILL.md");
    assertTrue(fs.existsSync(p), `v065-S2: sub-skill ${slug}/SKILL.md exists`);
    const body = fs.readFileSync(p, "utf8");
    assertTrue(body.startsWith("---"), `v065-S2: ${slug} starts with frontmatter`);
    assertTrue(/^name: cowork:write-run-note-/m.test(body), `v065-S2: ${slug} name frontmatter matches`);
  }

  // S3.8: 7 legacy sub-skill directories absent (out-of-scope extras fte-status/invoice-prep NOT checked)
  const legacy = [
    "write-callout-morning-briefing",
    "write-callout-eod-review",
    "write-callout-tripwire-yellow",
    "write-callout-tripwire-red",
    "write-callout-finance",
    "write-summary-weekly",
    "write-summary-monthly",
  ];
  for (const slug of legacy) {
    const p = path.join(cowork, "skills/skills", slug);
    assertTrue(!fs.existsSync(p), `v065-S3.8: legacy sub-skill ${slug} removed`);
  }

  // S3.1..S3.6: orchestrator step lists reference new sub-skills, not legacy
  const orchRewires = [
    { orch: "morning-briefing", expect: "write-run-note-morning-briefing", forbid: "write-callout-morning-briefing" },
    { orch: "eod-review",       expect: "write-run-note-eod-review",       forbid: "write-callout-eod-review" },
    { orch: "midday-tripwire",  expect: "write-run-note-midday-tripwire",  forbid: "write-callout-tripwire" },
    { orch: "weekly-review",    expect: "write-run-note-weekly-review",    forbid: "write-summary-weekly" },
    { orch: "monthly-review",   expect: "write-run-note-monthly-review",   forbid: "write-summary-monthly" },
  ];
  for (const o of orchRewires) {
    const p = path.join(cowork, "skills/orchestrators", o.orch, "SKILL.md");
    const body = fs.readFileSync(p, "utf8");
    assertContains(body, o.expect, `v065-S3: orchestrator ${o.orch} references ${o.expect}`);
    assertTrue(!body.includes(o.forbid), `v065-S3: orchestrator ${o.orch} no longer references ${o.forbid}`);
  }

  // S3.4: midday-tripwire prompt stub
  const tripStub = path.join(cowork, "content/prompts/midday-tripwire.md");
  assertTrue(fs.existsSync(tripStub), `v065-S3.4: midday-tripwire prompt stub exists`);

  // S6: CoworkReadiness helper + Cowork.md embed
  const readinessHelper = path.join(cowork, "helpers/cowork-readiness.js");
  assertTrue(fs.existsSync(readinessHelper), `v065-S6: cowork-readiness.js helper exists`);
  const coworkMd = fs.readFileSync(path.join(cowork, "content/Cowork.md"), "utf8");
  assertContains(coworkMd, "CoworkReadiness", `v065-S6: Cowork.md embeds CoworkReadiness`);

  // S6.2 manifest: customjs_classes includes CoworkReadiness
  const manifest = JSON.parse(fs.readFileSync(path.join(cowork, "manifest.json"), "utf8"));
  assertTrue(Array.isArray(manifest.customjs_classes) && manifest.customjs_classes.includes("CoworkReadiness"),
    `v065-S6.2: manifest.customjs_classes includes CoworkReadiness`);

  // S1.2 + S6.5.3 Manifest: 6 run-note rule_fragments + 1 scheduled-jobs rule_fragment
  const rfTypes = (manifest.rule_fragments || [])
    .map(rf => rf?.fragment?.required_frontmatter?.type?.equals)
    .filter(Boolean);
  for (const t of [
    "cowork-morning-briefing", "cowork-midday-tripwire", "cowork-eod-review",
    "cowork-finance-snapshot", "cowork-weekly-review", "cowork-monthly-review",
    "cowork-scheduled-jobs",
  ]) {
    assertTrue(rfTypes.includes(t), `v065-S1.2/S6.5.3: rule_fragment for type ${t} registered`);
  }

  // S6.5.1: cowork:onboard-scheduled-jobs orchestrator present
  const onboardSkill = path.join(cowork, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md");
  assertTrue(fs.existsSync(onboardSkill), `v065-S6.5.1: cowork:onboard-scheduled-jobs orchestrator SKILL.md exists`);
  const onboardBody = fs.readFileSync(onboardSkill, "utf8");
  assertTrue(/^name: cowork:onboard-scheduled-jobs/m.test(onboardBody),
    `v065-S6.5.1: onboard-scheduled-jobs name frontmatter matches`);
  assertContains(onboardBody, "scheduled-tasks",
    `v065-S6.5.1: onboard-scheduled-jobs references scheduled-tasks MCP`);
  assertTrue(onboardBody.includes("paste") && onboardBody.includes("direct"),
    `v065-S6.5.1: onboard-scheduled-jobs documents both modes (direct + paste)`);

  // S6.5.2 + S6.5.3: scheduled-jobs.md template + claude_surface registration
  const sjTemplate = path.join(cowork, "content/scheduled-jobs.md");
  assertTrue(fs.existsSync(sjTemplate), `v065-S6.5.2: content/scheduled-jobs.md template exists`);
  const claudeSurface = manifest.claude_surface || [];
  const hasOnboardCS = claudeSurface.some(cs =>
    cs?.source?.includes("onboard-scheduled-jobs/SKILL.md"));
  assertTrue(hasOnboardCS, `v065-S6.5.3: claude_surface[] includes onboard-scheduled-jobs orchestrator`);

  // S6.5.4: CoworkReadiness 5th row references scheduled-jobs
  const readinessBody = fs.readFileSync(path.join(cowork, "helpers/cowork-readiness.js"), "utf8");
  assertContains(readinessBody, "scheduled-jobs",
    `v065-S6.5.4: CoworkReadiness helper reads scheduled-jobs.md (5th row)`);
}

// ── v0.66.0 ─────────────────────────────────────────────────────────────────

function assertCoworkV066Shape() {
  // COWORK-V066-AFC-1: cowork callers don't use activity-feed@0.3.0-only opts
  //
  // Cowork invokes ActivityFeed via the customjs-guard dataviewjs pattern in
  // content .md files (args: [{ scope, groupBy, ... }]).  None of the new
  // v0.3.0 opts (rollUpRoots / flatGrouped / metaBuilder) should appear in
  // any of those args objects — confirming the additive-compat contract holds.
  const coworkContent = [
    "content/Daily Hub.md",
    "content/Weekly Hub.md",
    "content/Monthly Hub.md",
    "content/Today.md",
  ];
  let checked = 0;
  for (const rel of coworkContent) {
    const abs = path.join(BP, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    // Scan every args: [...] block that passes options to ActivityFeed
    const blocks = src.match(/args:\s*\[\s*\{([\s\S]*?)\}\s*\]/g) || [];
    for (const block of blocks) {
      checked++;
      assertTrue(!block.includes("rollUpRoots"),
        `COWORK-V066-AFC-1 [${rel}]: args block has no rollUpRoots`);
      assertTrue(!block.includes("flatGrouped"),
        `COWORK-V066-AFC-1 [${rel}]: args block has no flatGrouped`);
      assertTrue(!block.includes("metaBuilder"),
        `COWORK-V066-AFC-1 [${rel}]: args block has no metaBuilder`);
    }
  }
  assertTrue(checked >= 1,
    "COWORK-V066-AFC-1: scanned at least one ActivityFeed args block for additive-compat regression");
}

// ── v0.67.0 ─────────────────────────────────────────────────────────────────

function assertCoworkV067Shape() {
  // COWORK-V067-AFC-1: cowork content/*.md still doesn't pass v0.67.0 render-opts
  // (additive-compat regression — _rollUpChildrenPages is a render-output field,
  // not a render-input; cowork callers should not regress to pass v0.67.0 inputs)
  try {
    const coworkDir = path.join(BP, "content");
    const files = fs.existsSync(coworkDir) ? fs.readdirSync(coworkDir).filter(f => f.endsWith(".md")) : [];
    let coworkPassesNewOpts = false;
    for (const f of files) {
      const body = fs.readFileSync(path.join(coworkDir, f), "utf8");
      // Regression guard: cowork shouldn't have added accentSegments to its ActivityFeed.render calls
      if (/accentSegments\s*:/.test(body)) { coworkPassesNewOpts = true; break; }
    }
    assertTrue(!coworkPassesNewOpts,
      "COWORK-V067-AFC-1: cowork content does not pass v0.67.0-specific opts");
  } catch (e) {
    assertTrue(false,
      `COWORK-V067-AFC-1: cowork content does not pass v0.67.0-specific opts — ${e && e.message}`);
  }
}

// ── v0.68.0 ─────────────────────────────────────────────────────────────────
// cowork-orchestrator-cohesion cycle: orchestrator descriptions aligned to
// v0.65.0 atomic-note contract; patch-daily-callouts orphan deleted; 15
// engagement-type default prompts shipped; CoworkLatestRuns helper added.

function assertCoworkV068Shape() {
  console.log("--- v0.68.0 cowork-orchestrator-cohesion: descriptions + defaults + latest-runs ---");

  // V068-DESC-1..5: each per-job orchestrator SKILL.md description + opening
  // prose mentions "atomic note" / "atomic-note write contract" and does NOT
  // describe legacy callout-patching surface.
  const orchs = ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"];
  for (const o of orchs) {
    const body = readSkill(`skills/orchestrators/${o}/SKILL.md`);
    const top = body.split("## ")[0]; // description-frontmatter + opening prose; stops at first H2
    assertTrue(
      /atomic note|atomic-note write contract/i.test(top),
      `V068-DESC-${o}: description/intro mentions atomic-note write contract`
    );
    assertTrue(
      !/patches it into|appends a tripwire callout|patches a link callout|patches them into|patches the daily note(?!'s callouts)|composes the morning callout|composes the EOD callout/i.test(top),
      `V068-DESC-${o}: description/intro does NOT describe legacy callout-patching surface`
    );
    assertContains(
      top,
      "atomic-note write contract is the only output surface",
      `V068-DESC-${o}: opening prose explicitly disclaims legacy callout-patching`
    );
  }

  // V068-ORPHAN-1: patch-daily-callouts directory absent on disk.
  const orphanPath = path.join(BP, "skills/skills/patch-daily-callouts");
  assertTrue(!fs.existsSync(orphanPath),
    "V068-ORPHAN-1: skills/skills/patch-daily-callouts/ directory deleted from workshop tree");

  // V068-ORPHAN-2: patch-daily-callouts claude_surface entry absent from manifest.
  const manifest = loadManifest();
  const skillSources = Array.isArray(manifest.claude_surface)
    ? manifest.claude_surface.filter(e => e && e.kind === "skill").map(e => e.source)
    : [];
  assertTrue(!skillSources.some(s => /patch-daily-callouts/.test(s)),
    "V068-ORPHAN-2: manifest claude_surface no longer references patch-daily-callouts");

  // V068-ORPHAN-3: About Cowork.md skills catalogue no longer lists the row.
  const aboutCowork = fs.readFileSync(path.join(BP, "content/About Cowork.md"), "utf8");
  assertTrue(!/patch-daily-callouts/.test(aboutCowork),
    "V068-ORPHAN-3: About Cowork.md skills catalogue no longer lists patch-daily-callouts row");

  // V068-DEFAULTS-1..15: each of 3 engagement_types × 5 orchestrators ships
  // a default prompt file with non-empty body + canonical frontmatter shape.
  const types = ["personal", "w2-fte", "consulting"];
  for (const t of types) {
    for (const o of orchs) {
      const p = path.join(BP, `content/context/engagement-templates/${t}/prompts/${o}.md`);
      assertTrue(fs.existsSync(p),
        `V068-DEFAULTS-${t}-${o}: engagement-templates/${t}/prompts/${o}.md exists`);
      if (fs.existsSync(p)) {
        const body = fs.readFileSync(p, "utf8");
        assertTrue(body.length > 200,
          `V068-DEFAULTS-${t}-${o}-NONEMPTY: ${t}/prompts/${o}.md is non-trivial (>200 chars)`);
        // V068-DEFAULTS-CLEAN: forbidden legacy-surface phrases absent
        assertTrue(!/\bcallout\b|patch the daily|Timestamps\/|append to|into today|into the daily|\bsummaries\//i.test(body),
          `V068-DEFAULTS-${t}-${o}-CLEAN: prompt body free of legacy-surface phrases`);
      }
    }
  }

  // V068-DEFAULTS-MANIFEST: cowork manifest files[] declares all 15 default prompts.
  const fileSources = Array.isArray(manifest.files) ? manifest.files.map(f => f.source) : [];
  for (const t of types) {
    for (const o of orchs) {
      const src = `content/context/engagement-templates/${t}/prompts/${o}.md`;
      assertTrue(fileSources.includes(src),
        `V068-DEFAULTS-MANIFEST-${t}-${o}: manifest files[] declares ${src}`);
    }
  }

  // V068-ONBOARD-GUARD: onboard-scheduled-jobs SKILL.md core structural invariants.
  // Updated for v0.74.0 S6: the file was fully rewritten; the old step 6(c) contract-guard
  // scan and "writes ONE atomic note at" phrasing were removed. Assertions updated to match
  // the v0.74.0 contract: re-runnable entry-point that delegates to cowork:bootstrap-vault
  // when not-bootstrapped, then registers tasks via scheduled-tasks MCP.
  const onboard = readSkill("skills/orchestrators/onboard-scheduled-jobs/SKILL.md");
  assertContains(onboard, ".claude/skills/cowork/bootstrap-vault/SKILL.md",
    "V068-ONBOARD-GUARD: onboard-scheduled-jobs delegates to cowork:bootstrap-vault when not-bootstrapped");
  assertContains(onboard, "scheduled-tasks",
    "V068-ONBOARD-GUARD-MSG: onboard skill registers schedules via scheduled-tasks MCP");

  // V068-LATEST-RUNS-1: CoworkLatestRuns helper file exists on disk.
  const latestRunsPath = path.join(BP, "helpers/cowork-latest-runs.js");
  assertTrue(fs.existsSync(latestRunsPath),
    "V068-LATEST-RUNS-1: helpers/cowork-latest-runs.js exists");

  // V068-LATEST-RUNS-2: CoworkLatestRuns class declared in customjs_classes[].
  const classes = Array.isArray(manifest.customjs_classes) ? manifest.customjs_classes : [];
  assertTrue(classes.includes("CoworkLatestRuns"),
    "V068-LATEST-RUNS-2: manifest customjs_classes[] declares CoworkLatestRuns");

  // V068-LATEST-RUNS-3: helper file declares CoworkLatestRuns class body
  // with a 5-orchestrator iteration shape.
  if (fs.existsSync(latestRunsPath)) {
    const lrBody = fs.readFileSync(latestRunsPath, "utf8");
    assertContains(lrBody, "class CoworkLatestRuns",
      "V068-LATEST-RUNS-3: helper declares CoworkLatestRuns class");
    for (const o of orchs) {
      assertContains(lrBody, `cowork-${o}`,
        `V068-LATEST-RUNS-TYPES-${o}: helper queries cowork-${o} run-note type`);
    }
  }

  // V068-LATEST-RUNS-4: Cowork.md embeds the CoworkLatestRuns dataviewjs block.
  const coworkHub = fs.readFileSync(path.join(BP, "content/Cowork.md"), "utf8");
  assertContains(coworkHub, 'class: "CoworkLatestRuns"',
    "V068-LATEST-RUNS-4: Cowork.md embeds CoworkLatestRuns block");

  // V068-MANIFEST-FILES: manifest files[] declares the helper.
  assertTrue(fileSources.includes("helpers/cowork-latest-runs.js"),
    "V068-MANIFEST-FILES: manifest files[] declares helpers/cowork-latest-runs.js");

  // V0750-VERSION: cowork blueprint version bumped to 0.27.0 (was 0.26.0 in v0.87.0; MINOR bump for v0.89.0 — adds cowork:resolve-person sub-skill + depends_on people≥0.6.0).
  assertTrue(manifest.version === "0.27.0",
    `V0750-VERSION: cowork manifest.version === "0.27.0" (got ${JSON.stringify(manifest.version)})`);
}

// ---------------------------------------------------------------------------
// HC-V0750-A1 — audit-grep: no naked "Use Skill cowork:" references
// Every "Use Skill cowork:<X>" reference (case-insensitive) must be
// accompanied by a ".claude/skills/cowork/" or "READ " mention within
// the next 200 chars.
// ---------------------------------------------------------------------------
{
  const orchestratorFiles = [
    "skills/orchestrators/morning-briefing/SKILL.md",
    "skills/orchestrators/midday-tripwire/SKILL.md",
    "skills/orchestrators/eod-review/SKILL.md",
    "skills/orchestrators/weekly-review/SKILL.md",
    "skills/orchestrators/monthly-review/SKILL.md",
    "skills/orchestrators/onboard-scheduled-jobs/SKILL.md",
  ];
  const refRe = /\b[Uu]se [Ss]kill `?cowork:[a-z0-9\-]+/g;
  for (const rel of orchestratorFiles) {
    const body = fs.readFileSync(path.join(BP, rel), "utf8");
    let match;
    let nakedCount = 0;
    while ((match = refRe.exec(body)) !== null) {
      const windowText = body.slice(match.index + match[0].length, match.index + match[0].length + 200);
      if (!windowText.includes(".claude/skills/cowork/") && !windowText.includes("READ ")) {
        nakedCount++;
        console.error(`HC-V0750-A1 naked ref at ${rel} offset ${match.index}: "${match[0]}"`);
      }
    }
    assertTrue(nakedCount === 0, `HC-V0750-A1 ${rel} has no naked "Use Skill cowork:" refs`);
  }
}

// ---------------------------------------------------------------------------
// HC-V0750-A2 — Layer 2 post-write verification step present in all 5
// atomic-note-writing orchestrators.
// ---------------------------------------------------------------------------
{
  const fives = [
    "skills/orchestrators/morning-briefing/SKILL.md",
    "skills/orchestrators/midday-tripwire/SKILL.md",
    "skills/orchestrators/eod-review/SKILL.md",
    "skills/orchestrators/weekly-review/SKILL.md",
    "skills/orchestrators/monthly-review/SKILL.md",
  ];
  for (const rel of fives) {
    const body = fs.readFileSync(path.join(BP, rel), "utf8");
    assertContains(body, "Re-read + structural verify", `HC-V0750-A2 ${rel} contains verify step`);
    assertContains(body, "rm -f ",                       `HC-V0750-A2 ${rel} contains rm -f delete-on-miss`);
    assertContains(body, "failed:contract-violation:",   `HC-V0750-A2 ${rel} returns contract-violation status`);
  }
}

// ---------------------------------------------------------------------------
// HC-V0750-A3 — onboard-scheduled-jobs Step 6 emits enriched prompts
// for BOTH direct-mode and paste-mode branches (regex count == 2).
// ---------------------------------------------------------------------------
{
  const body = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
  const enrichedRe = /READ that sub-skill's SKILL\.md from \.claude\/skills\/cowork\/skills\//g;
  const matches = body.match(enrichedRe) || [];
  assertTrue(matches.length === 2, `HC-V0750-A3 onboard-scheduled-jobs Step 6 enriched count == 2 (direct + paste); got ${matches.length}`);
}

// ---------------------------------------------------------------------------
// HC-V0750-A4 — Verify-step regex patterns reject a non-compliant body.
// ---------------------------------------------------------------------------
{
  const nonCompliantBody = "# Morning Briefing\n\nHello! Here's today's overview.\n\n## Calendar\n\n- 09:00 - Meeting\n- 10:00 - Other meeting\n\n## Status\n\nThings are good.\n";
  const synopsisRe   = /^> \[!info\]- /m;
  const exampleRe    = /^> \[!example\]\+ /m;
  const tipRe        = /^> \[!tip\] /m;
  const navRe        = /```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/;
  assertTrue(!synopsisRe.test(nonCompliantBody), "HC-V0750-A4 synopsis missing");
  assertTrue(!exampleRe.test(nonCompliantBody),  "HC-V0750-A4 example missing");
  assertTrue(!tipRe.test(nonCompliantBody),      "HC-V0750-A4 tip missing");
  assertTrue(!navRe.test(nonCompliantBody),      "HC-V0750-A4 SpaceNavButtons missing");
}

// ---------------------------------------------------------------------------
// HC-V0751-A1 — engagement-template prompts contain no emoji glyphs.
// v0.75.1 G stripped 93 emoji characters from 15 prompt files. This
// audit-grep fails-closed on any future reintroduction.
// ---------------------------------------------------------------------------
{
    const promptDirs = [
        "content/context/engagement-templates/personal/prompts",
        "content/context/engagement-templates/w2-fte/prompts",
        "content/context/engagement-templates/consulting/prompts",
    ];
    const promptFiles = [
        "morning-briefing.md", "midday-tripwire.md", "eod-review.md",
        "weekly-review.md", "monthly-review.md",
    ];
    // Unicode emoji ranges: symbols+pictographs, misc symbols, dingbats, mahjong/cards, variation selector.
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu;
    let totalEmoji = 0;
    const violatingFiles = [];
    for (const dir of promptDirs) {
        for (const file of promptFiles) {
            const rel = `${dir}/${file}`;
            const body = fs.readFileSync(path.join(BP, rel), "utf8");
            const matches = body.match(emojiRe) || [];
            if (matches.length > 0) {
                totalEmoji += matches.length;
                violatingFiles.push(`${rel} (${matches.length})`);
            }
        }
    }
    assertTrue(
        totalEmoji === 0,
        `HC-V0751-A1 zero emoji in 15 engagement-template prompts; found ${totalEmoji} across ${violatingFiles.length} files: ${violatingFiles.join(", ")}`,
    );
}

// ---------------------------------------------------------------------------
// HC-V0751-H1 — morning-briefing step 14 gates semantic_index_unavailable on
// step 12b having actually run (calendar_signal.events.length > 0). A
// calendar-empty fire must NOT emit the Semantic-index-not-available warning.
// ---------------------------------------------------------------------------
{
    const body = fs.readFileSync(
        path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"),
        "utf8",
    );
    // The fixed condition must include both the step-12b-ran gate AND the
    // skipped-status check. Look for the canonical phrase introduced in S10.
    assertContains(
        body,
        "ONLY IF step 12b ran",
        "HC-V0751-H1 morning-briefing step 14 carries 'ONLY IF step 12b ran' gate",
    );
    assertContains(
        body,
        "NO warning callout is emitted",
        "HC-V0751-H1 morning-briefing step 14 explicitly states no-warning-emitted on calendar-empty",
    );
}

// ---------------------------------------------------------------------------
// HC-V0751-H2 — when the warning callout IS emitted, its text matches the
// gather-semantic-related sub-skill's canonical contract verbatim. Single
// source of truth lives with the sub-skill that knows the failure mode.
// ---------------------------------------------------------------------------
{
    const orchBody = fs.readFileSync(
        path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"),
        "utf8",
    );
    const subBody = fs.readFileSync(
        path.join(BP, "skills/skills/gather-semantic-related/SKILL.md"),
        "utf8",
    );
    // Canonical text from gather-semantic-related's orchestrator-integration-contract section.
    const canonical = "Smart Connections index absent or anchor not indexed — semantic gather skipped.";
    assertContains(subBody, canonical, "HC-V0751-H2 gather-semantic-related defines canonical warning text");
    assertContains(orchBody, canonical, "HC-V0751-H2 morning-briefing step 14 copies canonical warning text verbatim");
    // And the old freelance text must be gone.
    const stale = "Smart Connections index is not built for this vault. Run the SC index from the Obsidian ribbon";
    assertTrue(
        !orchBody.includes(stale),
        "HC-V0751-H2 morning-briefing step 14 no longer carries stale 'not built for this vault' text",
    );
}

// ---------------------------------------------------------------------------
// HC-V0750-A5 — Verify-step regex patterns accept a compliant body.
// ---------------------------------------------------------------------------
{
  const compliantBody = '```dataviewjs\nawait dv.view("SpaceNavButtons", { variant: "atomic" });\n```\n\n> [!info]- Synopsis\n> All good.\n\n> [!example]+ 📋 Status\n> Things are good.\n\n> [!tip] ✏️ Next action\n> Carry on.\n';
  const synopsisRe   = /^> \[!info\]- /m;
  const exampleRe    = /^> \[!example\]\+ /m;
  const tipRe        = /^> \[!tip\] /m;
  const navRe        = /```dataviewjs\n[\s\S]*?SpaceNavButtons[\s\S]*?```/;
  assertTrue(synopsisRe.test(compliantBody), "HC-V0750-A5 synopsis matches");
  assertTrue(exampleRe.test(compliantBody),  "HC-V0750-A5 example matches");
  assertTrue(tipRe.test(compliantBody),      "HC-V0750-A5 tip matches");
  assertTrue(navRe.test(compliantBody),      "HC-V0750-A5 SpaceNavButtons matches");
}

// ---------------------------------------------------------------------------
// HC-V0750-B13..B21 — SC integration regex-presence in orchestrators +
// write-run-note skeleton entries.
// ---------------------------------------------------------------------------
{
  const morning = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
  assertContains(morning, "12b. **Semantic related.**",         "HC-V0750-B13 morning step 12b present");
  assertContains(morning, "render_aspects.semantic_related",     "HC-V0750-B14 morning gates on render_aspects.semantic_related");
  assertContains(morning, "first 5",                              "HC-V0750-B15 morning 5-event cap mentioned");

  const eod = fs.readFileSync(path.join(BP, "skills/orchestrators/eod-review/SKILL.md"), "utf8");
  assertContains(eod, "9b. **Semantic related.**",               "HC-V0750-B16 eod step 9b present");
  assertContains(eod, "find-related",                             "HC-V0750-B17 eod uses find-related mode");

  const weekly = fs.readFileSync(path.join(BP, "skills/orchestrators/weekly-review/SKILL.md"), "utf8");
  assertContains(weekly, "11b. **Semantic related",              "HC-V0750-B18 weekly step 11b present");
  assertContains(weekly, "Emergent themes this week",             "HC-V0750-B19 weekly emergent-themes callout");
  assertContains(weekly, "coverage",                               "HC-V0750-B20 weekly coverage ranking");

  for (const orch of ["morning-briefing", "eod-review", "weekly-review"]) {
    const wrn = fs.readFileSync(path.join(BP, `skills/skills/write-run-note-${orch}/SKILL.md`), "utf8");
    assertContains(wrn, "🧩",                                     `HC-V0750-B21 write-run-note-${orch} skeleton entry`);
  }
}

// ---------------------------------------------------------------------------
// HC-V0750-C1..C3 — onboard-scheduled-jobs Step 2 engagement-type manifest read
// (v0.83.0: workshop_manifest_path resolution + consumer-override merge removed;
//  now reads materialized_manifest_path at spice/cowork/context/engagement-types/)
// ---------------------------------------------------------------------------
{
  const onboard = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
  assertContains(onboard, "materialized_manifest_path",            "HC-V0750-C1 Step 2 uses materialized_manifest_path (v0.83.0)");
  assertTrue(!onboard.includes("in-vault context can only reach"),
             "HC-V0750-C2 false-premise sentence removed");
  assertTrue(!onboard.includes("consumer wins on conflict"),       "HC-V0750-C3 consumer-override merge semantics removed (v0.83.0)");
}

// ---------------------------------------------------------------------------
// HC-V0760-C1..C4 — cross-orchestrator semantic-warning parity.
// Mirrors v0.75.1 H morning-briefing fix on eod-review (step 11 stale text
// + ungated emission) and weekly-review (step 15 same).
// ---------------------------------------------------------------------------

// HC-V0760-C1 — eod-review: emission gated on step 9b having actually run.
{
    const label = "HC-V0760-C1 eod-review: render_aspects.semantic_related != 'include' emits zero Semantic index not available callouts";
    const skillPath = path.join(BP, "skills/orchestrators/eod-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    // Step 11 must gate emission on render_aspects.semantic_related == "include"
    // AND on the related_signal.status starting with skipped:no-index OR skipped:anchor-not-indexed
    const semanticBlock = body.match(/ONLY IF step 9b ran[\s\S]{0,500}Smart Connections index absent or anchor not indexed/);
    assertTrue(
        semanticBlock !== null,
        `${label}: SKILL.md step 11 must carry "ONLY IF step 9b ran" gate AND canonical "Smart Connections index absent or anchor not indexed" text`,
    );
}

// HC-V0760-C2 — eod-review: canonical em-dash text replaces v0.75.1 stale string.
{
    const label = "HC-V0760-C2 eod-review: skipped-no-index emits canonical 'Smart Connections index absent or anchor not indexed — semantic gather skipped' text";
    const skillPath = path.join(BP, "skills/orchestrators/eod-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    // Asserting verbatim canonical text presence
    assertTrue(
        /Smart Connections index absent or anchor not indexed — semantic gather skipped/.test(body),
        `${label}: SKILL.md must contain the em-dash canonical text matching gather-semantic-related's Orchestrator integration contract`,
    );
    // The stale v0.75.1 text MUST be gone
    assertTrue(
        !/Smart Connections index is not built for this vault/.test(body),
        `${label}: SKILL.md must NOT carry the pre-v0.76.0 stale text`,
    );
}

// HC-V0760-C3 — weekly-review: emission gated on step 11b having actually run.
{
    const label = "HC-V0760-C3 weekly-review: render_aspects.semantic_related != 'include' emits zero Semantic index not available callouts";
    const skillPath = path.join(BP, "skills/orchestrators/weekly-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    const semanticBlock = body.match(/ONLY IF step 11b ran[\s\S]{0,500}Smart Connections index absent or anchor not indexed/);
    assertTrue(
        semanticBlock !== null,
        `${label}: SKILL.md step 15 must carry "ONLY IF step 11b ran" gate AND canonical text`,
    );
}

// HC-V0760-C4 — weekly-review: canonical em-dash text replaces v0.75.1 stale string.
{
    const label = "HC-V0760-C4 weekly-review: canonical em-dash text replaces v0.75.1 stale string";
    const skillPath = path.join(BP, "skills/orchestrators/weekly-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    assertTrue(
        /Smart Connections index absent or anchor not indexed — semantic gather skipped/.test(body),
        `${label}: SKILL.md must contain canonical em-dash text`,
    );
    assertTrue(
        !/Smart Connections index is not built for this vault/.test(body),
        `${label}: SKILL.md must NOT carry the pre-v0.76.0 stale text`,
    );
}

// HC-V0760-D1..D3: engagement-template prompt fallback
// Mirrors morning-briefing's behavior. When spice/cowork/prompts/<orch>.md is
// empty, fall back to spice/cowork/context/engagement-templates/<type>/prompts/
// <orch>.md before emitting the stub. Only stub when BOTH are empty.

{
    const label = "HC-V0760-D1 eod-review: SKILL.md Write phase reads engagement-template prompt as fallback when user-prompt is empty";
    const skillPath = path.join(BP, "skills/orchestrators/eod-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    assertTrue(
        /engagement-templates\/<engagement\.type>\/prompts\/eod-review\.md/.test(body)
            || /engagement-templates\/\$\{engagement\.type\}\/prompts\/eod-review\.md/.test(body)
            || /engagement-templates\/[<>{][^/]+[>}]?\/prompts\/eod-review\.md/.test(body),
        `${label}: SKILL.md must reference the engagement-template fallback path`,
    );
    assertTrue(
        /(If|when|If) `?user_prompt_body`? is empty/i.test(body) || /user_prompt_body is empty/i.test(body),
        `${label}: SKILL.md must guard the fallback on user_prompt_body emptiness`,
    );
}

{
    const label = "HC-V0760-D2 weekly-review: SKILL.md Write phase reads engagement-template prompt as fallback";
    const skillPath = path.join(BP, "skills/orchestrators/weekly-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    assertTrue(
        /engagement-templates\/<engagement\.type>\/prompts\/weekly-review\.md/.test(body)
            || /engagement-templates\/[<>{][^/]+[>}]?\/prompts\/weekly-review\.md/.test(body),
        `${label}: SKILL.md must reference the engagement-template fallback path`,
    );
    assertTrue(
        /(If|when|If) `?user_prompt_body`? is empty/i.test(body) || /user_prompt_body is empty/i.test(body),
        `${label}: SKILL.md must guard the fallback on user_prompt_body emptiness`,
    );
}

{
    const label = "HC-V0760-D3 monthly-review: SKILL.md Write phase reads engagement-template prompt as fallback";
    const skillPath = path.join(BP, "skills/orchestrators/monthly-review/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");
    assertTrue(
        /engagement-templates\/<engagement\.type>\/prompts\/monthly-review\.md/.test(body)
            || /engagement-templates\/[<>{][^/]+[>}]?\/prompts\/monthly-review\.md/.test(body),
        `${label}: SKILL.md must reference the engagement-template fallback path`,
    );
    assertTrue(
        /(If|when|If) `?user_prompt_body`? is empty/i.test(body) || /user_prompt_body is empty/i.test(body),
        `${label}: SKILL.md must guard the fallback on user_prompt_body emptiness`,
    );
}

// HC-V0760-F1..F2: cowork:context-builder dry-run + re-run
// The skill body is interactive (AskUserQuestion) but supports a non-
// interactive harness mode via dry_run_answers. F1 = first invocation
// writes the file. F2 = second invocation with all Skip preserves file.

{
    const label = "HC-V0760-F1 context-builder dry-run writes user-preferences.md with detected-MCP blocks";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-cb-f1-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        fs.writeFileSync(path.join(vault, "spice", "cowork", "context", "vault-config.md"),
            "---\ntype: cowork-vault-config\nupdated: 2026-05-23\nupdated_by: bootstrap-vault\nengagements:\n  - id: dogfood\n    type: personal\n---\n");

        // The helper module is created in S9 (stub) and implemented in S10.
        // Before then, this require() throws MODULE_NOT_FOUND — the test FAILs cleanly.
        const cbDryRun = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        cbDryRun.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: ["calendar", "email"],
                per_mcp_answers: {
                    calendar: { surface_event_kinds: ["conflicts", "focus-blocks"], include_all_day: false },
                    email: { inbox_zero_threshold: 5, surface_kinds: ["unanswered-24h"] },
                },
                priorities: ["calendar", "email"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
            },
        });

        const prefsPath = path.join(vault, "spice", "cowork", "context", "user-preferences.md");
        assertTrue(fs.existsSync(prefsPath), `${label}: user-preferences.md was written`);

        const body = fs.readFileSync(prefsPath, "utf8");
        assertTrue(/type: cowork-user-preferences/.test(body), `${label}: frontmatter has type:`);
        assertTrue(/updated_by: cowork:context-builder/.test(body), `${label}: frontmatter updated_by:`);
        assertTrue(/mcps:\s*\n[\s\S]*calendar:/m.test(body), `${label}: mcps.calendar block`);
        assertTrue(/mcps:\s*\n[\s\S]*email:/m.test(body), `${label}: mcps.email block`);
        assertTrue(!/chat:/.test(body), `${label}: chat NOT present (not detected)`);
        assertTrue(/priorities:\s*\n\s*- calendar\s*\n\s*- email/.test(body), `${label}: priorities ordered`);
        assertTrue(/vibe:\s*dry-and-factual/.test(body), `${label}: personality.vibe`);
    } catch (e) {
        // Module-not-found is the expected failure at this stage. Surface as a
        // single FAIL with a clear message; don't crash the suite.
        if (e && (e.code === "MODULE_NOT_FOUND" || /not yet implemented/.test(e.message))) {
            failed++;
            console.error(`FAIL ${label}: helper not yet ready (${e.message}) (expected until S10)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

{
    const label = "HC-V0760-F2 context-builder re-run with all-Skip preserves file content (only updated: changes)";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-cb-f2-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        fs.writeFileSync(path.join(vault, "spice", "cowork", "context", "vault-config.md"),
            "---\ntype: cowork-vault-config\nupdated: 2026-05-23\nengagements:\n  - id: dogfood\n    type: personal\n---\n");

        const cbDryRun = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        cbDryRun.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: ["calendar"],
                per_mcp_answers: { calendar: { surface_event_kinds: ["conflicts"], include_all_day: true } },
                priorities: ["calendar"],
                personality: { vibe: "dry-and-factual", formality: "formal", pep_talk: false, length: "terse" },
            },
        });
        const prefsPath = path.join(vault, "spice", "cowork", "context", "user-preferences.md");
        const after_first = fs.readFileSync(prefsPath, "utf8");

        cbDryRun.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: ["calendar"],
                per_mcp_actions: { calendar: "Skip" },
                priorities: ["calendar"],
                personality: { vibe: "dry-and-factual", formality: "formal", pep_talk: false, length: "terse" },
            },
        });
        const after_second = fs.readFileSync(prefsPath, "utf8");

        const calendarBlockMatch1 = after_first.match(/calendar:\s*\n((?: {4}[^\n]*\n?)+)/);
        const calendarBlockMatch2 = after_second.match(/calendar:\s*\n((?: {4}[^\n]*\n?)+)/);
        const block1 = calendarBlockMatch1 && calendarBlockMatch1[1];
        const block2 = calendarBlockMatch2 && calendarBlockMatch2[1];
        assertTrue(
            block1 === block2 && block1 !== null && block1 !== undefined,
            `${label}: mcps.calendar block byte-identical after Skip re-run (got first=${JSON.stringify(block1)} second=${JSON.stringify(block2)})`,
        );
    } catch (e) {
        if (e && (e.code === "MODULE_NOT_FOUND" || /not yet implemented/.test(e.message))) {
            failed++;
            console.error(`FAIL ${label}: helper not yet ready (${e.message}) (expected until S10)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0760-H1: onboard-scheduled-jobs auto-delegation to context-builder
// Structural assert on the orchestrator SKILL.md: the body must reference
// the cowork:context-builder skill and gate the delegation on the absence
// (or seed-stamping) of user-preferences.md.

{
    const label = "HC-V0760-H1 onboard-scheduled-jobs SKILL.md auto-delegates to cowork:context-builder";
    const skillPath = path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md");
    const body = fs.readFileSync(skillPath, "utf8");

    assertTrue(
        /context-builder/.test(body),
        `${label}: SKILL.md must reference cowork:context-builder (delegation target)`,
    );
    assertTrue(
        /user-preferences\.md/.test(body),
        `${label}: SKILL.md must reference spice/cowork/context/user-preferences.md (probe target)`,
    );
    assertTrue(
        /updated_by:\s*install\.js|updated_by: install\.js|seed.*stamped/i.test(body),
        `${label}: SKILL.md must gate delegation on the seed-stamped condition (updated_by: install.js indicates unpopulated seed)`,
    );
}

// ---------------------------------------------------------------------------
// HC-V0760-A1 — cowork USER-bucket files preserved across sauce reinstall.
//
// Forward-looking boundary-contract guard. Per the v0.76.0
// cowork-interactive-context cycle, the cowork blueprint exposes nine
// USER-owned files (engagement-aware files that accumulate user content
// over time and must NOT be silently overwritten by `brew upgrade sauce`):
//
//   - spice/cowork/context/user-preferences.md  (NEW in v0.76.0; S13 wires)
//   - spice/cowork/context/vault-config.md
//   - spice/cowork/context/active-threads.md
//   - spice/cowork/context/weekly-snapshot.md
//   - spice/cowork/prompts/morning-briefing.md
//   - spice/cowork/prompts/midday-tripwire.md
//   - spice/cowork/prompts/eod-review.md
//   - spice/cowork/prompts/weekly-review.md
//   - spice/cowork/prompts/monthly-review.md
//
// install.js (line 941, v0.59.9) is the SINGLE mechanism that protects user
// content across a reinstall: a files[] entry carrying `materialize_once: true`
// causes install.js to log `action: "skipped_materialize_once"` and skip the
// overwrite when the dest already exists. Any USER-bucket path that appears
// as a `dest` in cowork's files[] WITHOUT this flag will get clobbered on
// every reinstall.
//
// What this case enforces — v0.76.0 SCOPE ONLY: the NEW
// `spice/cowork/context/user-preferences.md` path, once added to files[]
// by S13, MUST carry materialize_once: true. Today (pre-S13) the path is
// absent from files[] entirely (bootstrap-vault materializes it). Either
// state is safe — the guard fires only when it appears in files[] WITHOUT
// the flag, which is the precise regression S13 must avoid.
//
// Out of scope (deliberately): the five prompt files
// (spice/cowork/prompts/<orch>.md) are currently in files[] without
// materialize_once — a pre-existing boundary question independent of the
// v0.76.0 user-preferences workstream. A future cycle that decides to make
// those user-owned-byte-for-byte can extend FOCUSED_USER_PATHS below and
// resolve the flag-or-removal question lockstep with the boundary-redefinition.
//
// Why structural, not runtime: install.js's materialize_once branch is the
// ONLY surface that can let a USER file survive a reinstall, so a missing
// flag IS the only failure mode. Running the full installer against a
// fixture vault would require materializing platform-installed.json + the
// workshop manifest + every dep — substantially more scaffolding for the
// same coverage.
// ---------------------------------------------------------------------------
{
    const label = "HC-V0760-A1 cowork USER files preserved across reinstall";

    // v0.76.0-scope USER paths to enforce. Future cycles may add more; the
    // out-of-scope list above documents the deliberate narrowing for S7.
    const FOCUSED_USER_PATHS = [
        "spice/cowork/context/user-preferences.md",   // v0.76.0 NEW — S13 wires materialize_once: true
        "spice/cowork/prompts/per-mcp/finance/microscope.md",  // v0.79.0 NEW — cowork:edit-microscope writes on demand; NOT in files[] by construction
    ];

    const manifest = loadManifest();
    // {{module_directory}} substitutes to "spice/<module_directory>" per
    // install.js line 401 (T1.2 per-blueprint overlay). Replicate exactly so
    // we compare against the SAME post-substitution dest the installer computes.
    const moduleDir = `spice/${manifest.module_directory}`;
    const files = Array.isArray(manifest.files) ? manifest.files : [];

    const destToEntry = new Map();
    for (const f of files) {
        if (!f || typeof f.dest !== "string") continue;
        const resolved = f.dest.replace(/\{\{module_directory\}\}/g, moduleDir);
        destToEntry.set(resolved, f);
    }

    const violations = [];
    for (const userPath of FOCUSED_USER_PATHS) {
        const entry = destToEntry.get(userPath);
        if (!entry) continue;                         // absent from files[] — bootstrap surface; safe.
        if (entry.materialize_once === true) continue; // protected by v0.59.9 mechanic; safe.
        violations.push(userPath);
    }

    assertTrue(
        violations.length === 0,
        `${label}: ${violations.length} USER file(s) appear in cowork files[] without materialize_once: true — reinstall will overwrite user content at: ${violations.join(", ")}`,
    );
}

// HC-V0770-A1..A3: tool-pattern detection (Workstream B)
// HC-V0770-D1:     schema v2 validation (Workstream F)
// All exercise the new helper.detectCapabilities() export.

{
    const label = "HC-V0770-A1 Outlook UUID detected as calendar via tool-pattern set membership";
    try {
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        if (typeof helper.detectCapabilities !== "function") {
            failed++;
            console.error(`FAIL  ${label}: helper.detectCapabilities not yet exported (expected — created in S2)`);
        } else {
            const availableTools = [
                "mcp__45224a84-deadbeef__list_events",
                "mcp__45224a84-deadbeef__create_event",
                "mcp__45224a84-deadbeef__update_event",
                "mcp__45224a84-deadbeef__list_messages",
                "mcp__45224a84-deadbeef__send_message",
                "mcp__some-other-mcp__do_thing",
            ];
            const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
            const result = helper.detectCapabilities(availableTools, map);
            const calendarDetections = result.detected.filter(d => d.kind === "calendar");
            assertTrue(
                calendarDetections.length === 1 && calendarDetections[0].served_by === "45224a84-deadbeef",
                `${label}: expected 1 calendar detection with served_by=45224a84-deadbeef, got ${JSON.stringify(calendarDetections)}`,
            );
        }
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || /detectCapabilities is not a function/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S2)`);
        } else {
            throw e;
        }
    }
}

{
    const label = "HC-V0770-A2 same Outlook UUID also detected as email (capability subset)";
    try {
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        if (typeof helper.detectCapabilities !== "function") {
            failed++;
            console.error(`FAIL  ${label}: helper.detectCapabilities not yet exported (expected until S2)`);
        } else {
            const availableTools = [
                "mcp__45224a84-deadbeef__list_events",
                "mcp__45224a84-deadbeef__create_event",
                "mcp__45224a84-deadbeef__search_threads",
                "mcp__45224a84-deadbeef__send_message",
            ];
            const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
            const result = helper.detectCapabilities(availableTools, map);
            const kinds = result.detected.map(d => d.kind);
            assertTrue(
                kinds.includes("calendar") && kinds.includes("email"),
                `${label}: expected both calendar AND email detected from same namespace, got ${JSON.stringify(kinds)}`,
            );
            const calendar = result.detected.find(d => d.kind === "calendar");
            const email = result.detected.find(d => d.kind === "email");
            assertTrue(
                calendar.served_by === email.served_by && calendar.served_by === "45224a84-deadbeef",
                `${label}: both kinds must report same served_by namespace; got calendar=${calendar.served_by}, email=${email.served_by}`,
            );
        }
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || /detectCapabilities is not a function/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S2)`);
        } else {
            throw e;
        }
    }
}

{
    const label = "HC-V0770-A3 chat kind matches any of 3 tool_alternatives branches";
    try {
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        if (typeof helper.detectCapabilities !== "function") {
            failed++;
            console.error(`FAIL  ${label}: helper.detectCapabilities not yet exported (expected until S2)`);
        } else {
            const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
            // iMessage variant
            const imessageTools = ["mcp__imessage-mcp__send_message", "mcp__imessage-mcp__list_chats"];
            const r1 = helper.detectCapabilities(imessageTools, map);
            assertTrue(
                r1.detected.some(d => d.kind === "chat"),
                `${label}: iMessage variant (list_chats) must match chat kind`,
            );
            // Teams variant
            const teamsTools = ["mcp__teams-mcp__send_message", "mcp__teams-mcp__list_threads"];
            const r2 = helper.detectCapabilities(teamsTools, map);
            assertTrue(
                r2.detected.some(d => d.kind === "chat"),
                `${label}: Teams variant (list_threads) must match chat kind`,
            );
            // Slack variant
            const slackTools = ["mcp__slack-mcp__send_message", "mcp__slack-mcp__list_conversations"];
            const r3 = helper.detectCapabilities(slackTools, map);
            assertTrue(
                r3.detected.some(d => d.kind === "chat"),
                `${label}: Slack variant (list_conversations) must match chat kind`,
            );
        }
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || /detectCapabilities is not a function/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S2)`);
        } else {
            throw e;
        }
    }
}

{
    const label = "HC-V0770-D1 mcp-skill-map.json v2.0.0 schema validates";
    const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));

    assertTrue(map.version === "2.0.0", `${label}: version field must be "2.0.0"; got "${map.version}"`);
    assertTrue(Array.isArray(map.kinds) && map.kinds.length > 0, `${label}: kinds[] must be non-empty array; got ${typeof map.kinds}`);

    const missing = [];
    for (const entry of (map.kinds || [])) {
        if (typeof entry.kind !== "string") missing.push(`kind:${entry.kind || "<missing>"}: kind must be string`);
        if (!Array.isArray(entry.required_tools)) missing.push(`kind:${entry.kind}: required_tools must be array`);
        if (entry.required_tools && !entry.required_tools.every(t => typeof t === "string")) missing.push(`kind:${entry.kind}: required_tools must be array of strings`);
        if (typeof entry.gather_skill !== "string") missing.push(`kind:${entry.kind}: gather_skill must be string`);
        if (entry.tool_alternatives !== undefined) {
            if (!Array.isArray(entry.tool_alternatives)) {
                missing.push(`kind:${entry.kind}: tool_alternatives must be array of arrays when present`);
            } else {
                for (const alt of entry.tool_alternatives) {
                    if (!Array.isArray(alt) || !alt.every(t => typeof t === "string")) {
                        missing.push(`kind:${entry.kind}: each tool_alternatives entry must be array of strings`);
                    }
                }
            }
        }
        if (entry.rename_from_v1 !== undefined && entry.rename_from_v1 !== null && typeof entry.rename_from_v1 !== "string") {
            missing.push(`kind:${entry.kind}: rename_from_v1 must be string|null|absent`);
        }
    }
    assertTrue(
        missing.length === 0,
        `${label}: schema violations: ${missing.join("; ")}`,
    );
}

// HC-V0770-B1..B2: v1 → v2 schema migration (Workstream D)
// HC-V0770-E1:     backward-compat read of v0.76.0-shaped user-preferences.md

{
    const label = "HC-V0770-B1 migrateV1ToV2: mcps.gmail renamed to mcps.email";
    try {
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        if (typeof helper.migrateV1ToV2 !== "function") {
            failed++;
            console.error(`FAIL  ${label}: helper.migrateV1ToV2 not yet exported (expected until S4)`);
        } else {
            const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
            const existingPrefs = {
                type: "cowork-user-preferences",
                updated: "2026-05-23",
                updated_by: "cowork:context-builder",
                priorities: ["calendar", "gmail"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
                mcps: {
                    calendar: { captured_at: "2026-05-23", surface_event_kinds: ["conflicts"] },
                    gmail: { captured_at: "2026-05-23", inbox_zero_threshold: 5 },
                },
            };
            const migrated = helper.migrateV1ToV2(existingPrefs, map);
            assertTrue(
                migrated.mcps.email && !migrated.mcps.gmail,
                `${label}: gmail block must rename to email; got mcps=${JSON.stringify(Object.keys(migrated.mcps))}`,
            );
            assertTrue(
                migrated.mcps.email.inbox_zero_threshold === 5,
                `${label}: renamed block must preserve answers (inbox_zero_threshold=5); got ${JSON.stringify(migrated.mcps.email)}`,
            );
            assertTrue(
                migrated.priorities.includes("email") && !migrated.priorities.includes("gmail"),
                `${label}: priorities[] must rename gmail→email; got ${JSON.stringify(migrated.priorities)}`,
            );
        }
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || /migrateV1ToV2 is not a function/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S4)`);
        } else {
            throw e;
        }
    }
}

{
    const label = "HC-V0770-B2 migrateV1ToV2: mcps.imessage renamed to mcps.chat";
    try {
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        if (typeof helper.migrateV1ToV2 !== "function") {
            failed++;
            console.error(`FAIL  ${label}: helper.migrateV1ToV2 not yet exported (expected until S4)`);
        } else {
            const map = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
            const existingPrefs = {
                type: "cowork-user-preferences",
                priorities: ["imessage", "calendar"],
                personality: { vibe: "casual", formality: "casual", pep_talk: true, length: "balanced" },
                mcps: {
                    calendar: { captured_at: "2026-05-23", surface_event_kinds: ["conflicts"] },
                    imessage: { captured_at: "2026-05-23", inner_circle: ["alice", "bob"], suppress_quiet_hours: true },
                },
            };
            const migrated = helper.migrateV1ToV2(existingPrefs, map);
            assertTrue(
                migrated.mcps.chat && !migrated.mcps.imessage,
                `${label}: imessage block must rename to chat; got mcps=${JSON.stringify(Object.keys(migrated.mcps))}`,
            );
            assertTrue(
                Array.isArray(migrated.mcps.chat.inner_circle) && migrated.mcps.chat.inner_circle.length === 2,
                `${label}: renamed block must preserve inner_circle list; got ${JSON.stringify(migrated.mcps.chat.inner_circle)}`,
            );
            assertTrue(
                migrated.priorities[0] === "chat" && !migrated.priorities.includes("imessage"),
                `${label}: priorities[] must rename imessage→chat; got ${JSON.stringify(migrated.priorities)}`,
            );
        }
    } catch (e) {
        if (e.code === "MODULE_NOT_FOUND" || /migrateV1ToV2 is not a function/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S4)`);
        } else {
            throw e;
        }
    }
}

{
    const label = "HC-V0770-E1 v0.76.0-shaped prefs (mcps.gmail + mcps.imessage) read+rewrite cleanly via run()";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-v077-e1-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        const v076Body = "---\n" +
            "type: cowork-user-preferences\n" +
            "updated: 2026-05-23\n" +
            "updated_by: cowork:context-builder\n\n" +
            "priorities:\n" +
            "  - gmail\n" +
            "  - imessage\n\n" +
            "personality:\n" +
            "  vibe: dry-and-factual\n" +
            "  formality: casual\n" +
            "  pep_talk: false\n" +
            "  length: terse\n\n" +
            "mcps:\n" +
            "  gmail:\n" +
            "    captured_at: \"2026-05-23\"\n" +
            "    inbox_zero_threshold: 5\n" +
            "  imessage:\n" +
            "    captured_at: \"2026-05-23\"\n" +
            "    inner_circle: [\"alice\", \"bob\"]\n" +
            "---\n";
        fs.writeFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), v076Body);

        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: ["calendar"],
                per_mcp_answers: { calendar: { surface_event_kinds: ["focus-blocks"] } },
                priorities: ["calendar"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
            },
        });
        const newBody = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        assertTrue(/mcps:\s*\n[\s\S]*email:/.test(newBody), `${label}: rewritten file must have mcps.email block`);
        assertTrue(/mcps:\s*\n[\s\S]*chat:/.test(newBody), `${label}: rewritten file must have mcps.chat block`);
        assertTrue(!/^\s*gmail:/m.test(newBody), `${label}: rewritten file must NOT contain mcps.gmail`);
        assertTrue(!/^\s*imessage:/m.test(newBody), `${label}: rewritten file must NOT contain mcps.imessage`);
        assertTrue(/inbox_zero_threshold:\s*5/.test(newBody), `${label}: rewritten email block must preserve inbox_zero_threshold=5`);
        assertTrue(/inner_circle:.*alice.*bob/.test(newBody), `${label}: rewritten chat block must preserve inner_circle list`);
    } catch (e) {
        if (/migrateV1ToV2 is not a function/.test(e.message) || /not yet implemented/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S4)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// HC-V0770-C1..C4: custom-kind / unknown-MCP handling (Workstream C)

{
    const label = "HC-V0770-C1 custom-kind dry-run writes custom_kind: true + what_matters block";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-v077-c1-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });

        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: [],
                per_mcp_answers: {},
                priorities: ["ado"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
                unknown_namespace_classifications: {
                    "986d1053-cafebabe": [
                        { kind: "ado", classification: "custom", what_matters: "Active PRs waiting on my review.\nMy tickets due this week.\nBlocked tickets with no comment in 3+ days." },
                    ],
                },
            },
        });
        const body = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        assertTrue(/mcps:\s*\n[\s\S]*ado:/m.test(body), `${label}: mcps.ado block exists`);
        assertTrue(/custom_kind:\s*true/.test(body), `${label}: custom_kind: true marker present`);
        assertTrue(/what_matters:\s*\|/.test(body), `${label}: what_matters block uses YAML literal indicator`);
        assertTrue(/Active PRs waiting on my review/.test(body), `${label}: what_matters content preserved`);
        assertTrue(/served_by:\s*"986d1053-cafebabe"/.test(body) || /served_by:\s*986d1053-cafebabe/.test(body),
            `${label}: served_by namespace recorded`);
    } catch (e) {
        if (/not yet implemented/.test(e.message) || /Cannot read|unknown_namespace_classifications/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S6)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

{
    const label = "HC-V0770-C2 custom-kind preserved on re-run with no unknown classifications (Skip equivalent)";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-v077-c2-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        // First run: capture custom kind
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: [],
                priorities: ["ado"],
                personality: { vibe: "casual", formality: "casual", pep_talk: false, length: "terse" },
                unknown_namespace_classifications: {
                    "986d1053-cafebabe": [{ kind: "ado", classification: "custom", what_matters: "Things I care about." }],
                },
            },
        });
        const after_first = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        // Second run: declared as known/captured this run with action=Skip
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: ["ado"],
                per_mcp_actions: { ado: "Skip" },
                priorities: ["ado"],
                personality: { vibe: "casual", formality: "casual", pep_talk: false, length: "terse" },
            },
        });
        const after_second = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        const block1 = after_first.match(/ado:[\s\S]*?(?=\n\w|\n---|$)/);
        const block2 = after_second.match(/ado:[\s\S]*?(?=\n\w|\n---|$)/);
        assertTrue(
            block1 && block2 && block1[0] === block2[0],
            `${label}: mcps.ado block byte-identical after Skip re-run`,
        );
    } catch (e) {
        if (/not yet implemented/.test(e.message) || /Cannot read/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S6)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

{
    const label = "HC-V0770-C3 custom-kind marked connected: false when MCP no longer detected";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-v077-c3-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        // First run
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: [],
                priorities: ["ado"],
                personality: { vibe: "casual", formality: "casual", pep_talk: false, length: "terse" },
                unknown_namespace_classifications: {
                    "986d1053-cafebabe": [{ kind: "ado", classification: "custom", what_matters: "Things to watch." }],
                },
            },
        });
        // Second run: ado NOT in detected_mcps, no classifications
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: [],
                priorities: [],
                personality: { vibe: "casual", formality: "casual", pep_talk: false, length: "terse" },
            },
        });
        const body = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        assertTrue(/ado:/.test(body), `${label}: ado block must persist (PreserveDisconnected)`);
        assertTrue(/connected:\s*false/.test(body), `${label}: ado must be marked connected: false`);
        assertTrue(/what_matters/.test(body), `${label}: what_matters content preserved`);
    } catch (e) {
        if (/not yet implemented/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S6)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

{
    const label = "HC-V0770-C4 user picks known-kind classification on unknown MCP → normal block + override_classified: true";
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-v077-c4-"));
    try {
        const vault = path.join(tmp, "vault");
        fs.mkdirSync(path.join(vault, "spice", "cowork", "context"), { recursive: true });
        const helper = require(path.join(BP, "helpers", "context-builder-dry-run.js"));
        helper.run({
            vaultRoot: vault,
            dryRunAnswers: {
                detected_mcps: [],
                per_mcp_answers: {},
                priorities: ["calendar"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
                unknown_namespace_classifications: {
                    "45224a84-deadbeef": [{
                        kind: "calendar",
                        classification: "known-override",
                        answers: { surface_event_kinds: ["conflicts", "prep-needed"], include_all_day: false },
                    }],
                },
            },
        });
        const body = fs.readFileSync(path.join(vault, "spice", "cowork", "context", "user-preferences.md"), "utf8");
        assertTrue(/mcps:\s*\n[\s\S]*calendar:/m.test(body), `${label}: mcps.calendar block exists`);
        assertTrue(/override_classified:\s*true/.test(body), `${label}: override_classified: true marker present`);
        assertTrue(!/custom_kind:\s*true/.test(body), `${label}: known-override must NOT be marked custom_kind`);
        assertTrue(/served_by:\s*"?45224a84-deadbeef/.test(body), `${label}: served_by namespace recorded`);
        assertTrue(/surface_event_kinds:.*conflicts.*prep-needed/.test(body), `${label}: answers persisted`);
    } catch (e) {
        if (/not yet implemented/.test(e.message)) {
            failed++;
            console.error(`FAIL  ${label}: ${e.message} (expected until S6)`);
        } else {
            throw e;
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// =====================================================================
// v0.78.0 Workstream A — read-user-preferences parser
// =====================================================================

// HC-V0780-A1: populated user-preferences.md → status: ok
{
    const label = "HC-V0780-A1 populated user-preferences.md parses cleanly";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0780-a1-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "updated: 2026-05-27",
            "updated_by: cowork:context-builder",
            "priorities:",
            "  - chat",
            "  - ado",
            "  - calendar",
            "personality:",
            "  vibe: casual",
            "  formality: casual",
            "  pep_talk: false",
            "  length: balanced",
            "  notes: |",
            "    Facts only. No overreach.",
            "mcps:",
            "  calendar:",
            "    served_by: \"45224a84-deadbeef\"",
            "    override_classified: true",
            "    connected: true",
            "    captured_at: 2026-05-27",
            "    what_matters: |",
            "      Conflicts are the primary signal.",
            "  chat:",
            "    served_by: \"45224a84-deadbeef\"",
            "    override_classified: true",
            "    connected: true",
            "    captured_at: 2026-05-27",
            "    what_matters: |",
            "      Teams chat is the BIG priority.",
            "  ado:",
            "    served_by: \"1151913a-cafebabe\"",
            "    custom_kind: true",
            "    connected: true",
            "    captured_at: 2026-05-27",
            "    what_matters: |",
            "      ADO is for BOARD progress only.",
            "---",
            "",
            "# user-preferences.md",
            "",
            "Body content here.",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");

        let helper;
        try {
            helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        } catch (e) {
            failed++;
            console.error(`FAIL  ${label}: helper not yet created (expected — created in S2): ${e.message}`);
            throw new Error("__skip__");
        }
        if (typeof helper.readUserPreferences !== "function") {
            failed++;
            console.error(`FAIL  ${label}: readUserPreferences not exported (expected — created in S2)`);
            throw new Error("__skip__");
        }
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.status === "ok", `${label}: expected status ok, got ${result.status} (${result.reason || ""})`);
        assertTrue(Array.isArray(result.prefs.priorities) && result.prefs.priorities.length === 3,
            `${label}: expected 3 priorities, got ${JSON.stringify(result.prefs.priorities)}`);
        assertTrue(result.prefs.priorities[0] === "chat",
            `${label}: expected priorities[0]=chat, got ${result.prefs.priorities[0]}`);
        assertTrue(result.prefs.personality && result.prefs.personality.vibe === "casual",
            `${label}: expected personality.vibe=casual, got ${JSON.stringify(result.prefs.personality)}`);
        assertTrue(result.prefs.personality.pep_talk === false,
            `${label}: expected pep_talk=false, got ${result.prefs.personality.pep_talk}`);
        assertTrue(result.prefs.mcps && result.prefs.mcps.ado && result.prefs.mcps.ado.custom_kind === true,
            `${label}: expected mcps.ado.custom_kind=true, got ${JSON.stringify(result.prefs.mcps && result.prefs.mcps.ado)}`);
        assertTrue(result.prefs.mcps.calendar.override_classified === true,
            `${label}: expected mcps.calendar.override_classified=true`);
        assertTrue(result.prefs.mcps.ado.what_matters && result.prefs.mcps.ado.what_matters.includes("BOARD progress"),
            `${label}: expected mcps.ado.what_matters preserved, got ${JSON.stringify(result.prefs.mcps.ado.what_matters)}`);
    } catch (e) {
        if (e.message !== "__skip__") {
            failed++;
            console.error(`FAIL  ${label}: ${e.message}`);
        }
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0780-A2: missing file → status: empty, reason: file_not_found
{
    const label = "HC-V0780-A2 missing user-preferences.md → status: empty";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0780-a2-"));
    try {
        let helper;
        try { helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js")); }
        catch (e) { failed++; console.error(`FAIL  ${label}: helper not yet created`); throw new Error("__skip__"); }
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.status === "empty", `${label}: expected status empty, got ${result.status}`);
        assertTrue(result.reason === "file_not_found", `${label}: expected reason file_not_found, got ${result.reason}`);
    } catch (e) {
        if (e.message !== "__skip__") { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0780-A3: workshop-seed shape (priorities: [], mcps: {}) → status: empty, reason: unpopulated_seed
{
    const label = "HC-V0780-A3 seed-shape user-preferences.md → status: empty, reason: unpopulated_seed";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0780-a3-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const seed = [
            "---",
            "type: cowork-user-preferences",
            "updated: 1970-01-01",
            "updated_by: install.js",
            "priorities: []",
            "personality:",
            "  vibe: null",
            "  formality: null",
            "  pep_talk: null",
            "  length: null",
            "mcps: {}",
            "---",
            "",
            "# user-preferences.md",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), seed, "utf8");
        const helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.status === "empty", `${label}: expected status empty, got ${result.status}`);
        assertTrue(result.reason === "unpopulated_seed", `${label}: expected reason unpopulated_seed, got ${result.reason}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0780-A4: malformed YAML (missing closing fence) → status: malformed
{
    const label = "HC-V0780-A4 malformed user-preferences.md → status: malformed";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0780-a4-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const malformed = [
            "---",
            "type: cowork-user-preferences",
            "priorities:",
            "- chat",
            "mcps: {}",
            "---",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), malformed, "utf8");
        const helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.status === "malformed" || (result.status === "empty" && result.reason === "unpopulated_seed"),
            `${label}: expected malformed (or degraded-to-empty), got status=${result.status}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// =====================================================================
// v0.78.0 Workstream B+C — gather-from-served-by dry-run
// =====================================================================

// HC-V0780-B1: known-kind override (chat served by M365 UUID) dry-run returns
//              markdown with `> [!example]+ Chat` prefix, status: ready
{
    const label = "HC-V0780-B1 gather-from-served-by chat dry-run returns ready callout";
    try {
        let helper;
        try { helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js")); }
        catch (e) {
            failed++;
            console.error(`FAIL  ${label}: helper not yet created (expected — created in S4): ${e.message}`);
            throw new Error("__skip__");
        }
        if (typeof helper.gatherFromServedBy !== "function") {
            failed++;
            console.error(`FAIL  ${label}: gatherFromServedBy not exported`);
            throw new Error("__skip__");
        }
        const result = helper.gatherFromServedBy({
            kind_name: "chat",
            kind_title: "Chat",
            served_by: "45224a84-deadbeef",
            what_matters: "Teams chat is the BIG priority for my morning briefing.",
            question_set_answers: { inner_circle: ["Stefan", "Hayden"], surface_kinds: ["reply-owed-24h"] },
            today: "2026-05-27",
            range: { start: "2026-05-27", end: "2026-05-29" },
            timezone: "America/Denver",
            dry_run_answers: {
                available_tools: [
                    "mcp__45224a84-deadbeef__chat_message_search",
                    "mcp__45224a84-deadbeef__send_message",
                ],
                agent_markdown: "> [!example]+ Chat\n> - **Stefan**: replied about cyan-4 board\n> - **Hayden**: needs your review on PR 234",
                tools_used: ["mcp__45224a84-deadbeef__chat_message_search"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected status ready, got ${result.status} (${result.reason || ""})`);
        assertTrue(/^> \[!example\]\+ Chat\n/.test(result.markdown),
            `${label}: expected markdown to start with > [!example]+ Chat, got: ${JSON.stringify(result.markdown.slice(0,60))}`);
        assertTrue(Array.isArray(result.tools_used) && result.tools_used.length >= 1,
            `${label}: expected tools_used non-empty, got ${JSON.stringify(result.tools_used)}`);
    } catch (e) {
        if (e.message !== "__skip__") { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
    }
}

// HC-V0780-B2: custom-kind (ado) dry-run returns markdown with title-cased `Ado`
{
    const label = "HC-V0780-B2 gather-from-served-by ado (custom) dry-run returns title-cased callout";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "ado",
            kind_title: "Ado",  // title-cased per design Option A
            served_by: "1151913a-cafebabe",
            what_matters: "ADO is for BOARD progress only.",
            question_set_answers: null,
            today: "2026-05-27",
            range: { start: "2026-05-27", end: "2026-05-27" },
            timezone: "America/Denver",
            dry_run_answers: {
                available_tools: [
                    "mcp__1151913a-cafebabe__list_work_items",
                    "mcp__1151913a-cafebabe__get_work_item",
                ],
                agent_markdown: "> [!example]+ Ado\n> - Story 705679 moved to Active by Will Fellhoelter\n> - PR linked: 234",
                tools_used: ["mcp__1151913a-cafebabe__list_work_items"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected status ready, got ${result.status}`);
        assertTrue(/^> \[!example\]\+ Ado\n/.test(result.markdown),
            `${label}: expected markdown to start with > [!example]+ Ado, got: ${JSON.stringify(result.markdown.slice(0,60))}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0780-B3: no tools exposed for served_by → skipped:no-tools
{
    const label = "HC-V0780-B3 gather-from-served-by with no matching tools → skipped:no-tools";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "calendar",
            kind_title: "Calendar",
            served_by: "nonexistent-ns",
            what_matters: "Conflicts are the primary signal.",
            question_set_answers: null,
            today: "2026-05-27",
            range: { start: "2026-05-27", end: "2026-05-29" },
            timezone: "America/Denver",
            dry_run_answers: {
                available_tools: [
                    "mcp__some-other-ns__do_thing",
                ],
                agent_markdown: null,
                tools_used: [],
            },
        });
        assertTrue(result.status === "skipped:no-tools",
            `${label}: expected status skipped:no-tools, got ${result.status}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.78.0 Workstream A — orchestrator dispatch planning
// =====================================================================

// HC-V0780-C1: accuris-shape prefs → 5-entry plan in priority order
//              chat/calendar/email → gather_from_served_by (override)
//              ado/github → gather_from_served_by (custom)
//              no warnings
{
    const label = "HC-V0780-C1 accuris-shape prefs → 5 priority-ordered dispatch entries";
    try {
        let helper;
        try { helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js")); }
        catch (e) {
            failed++;
            console.error(`FAIL  ${label}: helper not yet created (expected — created in S6): ${e.message}`);
            throw new Error("__skip__");
        }
        if (typeof helper.planDispatch !== "function") {
            failed++;
            console.error(`FAIL  ${label}: planDispatch not exported`);
            throw new Error("__skip__");
        }
        const prefs = {
            priorities: ["chat", "ado", "github", "calendar", "email"],
            personality: { vibe: "casual" },
            mcps: {
                chat:     { served_by: "45224a84-deadbeef", override_classified: true, connected: true, what_matters: "Teams chat priority" },
                ado:      { served_by: "1151913a-cafebabe", custom_kind: true,         connected: true, what_matters: "ADO board progress" },
                github:   { served_by: "github",              custom_kind: true,         connected: true, what_matters: "PR review queue" },
                calendar: { served_by: "45224a84-deadbeef", override_classified: true, connected: true, what_matters: "Conflicts surface" },
                email:    { served_by: "45224a84-deadbeef", override_classified: true, connected: true, what_matters: "Action required only" },
            },
        };
        const reachable = new Set(["45224a84-deadbeef", "1151913a-cafebabe", "github"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const plan = helper.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap });
        assertTrue(Array.isArray(plan) && plan.length === 5,
            `${label}: expected 5-entry plan, got ${plan && plan.length}`);
        assertTrue(plan[0].kind_name === "chat", `${label}: expected plan[0]=chat, got ${plan[0] && plan[0].kind_name}`);
        assertTrue(plan[1].kind_name === "ado", `${label}: expected plan[1]=ado, got ${plan[1] && plan[1].kind_name}`);
        assertTrue(plan[4].kind_name === "email", `${label}: expected plan[4]=email, got ${plan[4] && plan[4].kind_name}`);
        for (const entry of plan) {
            assertTrue(entry.action === "gather_from_served_by",
                `${label}: expected all actions gather_from_served_by, got ${entry.kind_name}→${entry.action}`);
        }
        // chat is override_classified → kind_title = "Chat" (canonical)
        const chatEntry = plan.find(e => e.kind_name === "chat");
        assertTrue(chatEntry.kind_title === "Chat", `${label}: expected chat kind_title="Chat", got "${chatEntry.kind_title}"`);
        // ado is custom_kind → kind_title = "Ado" (title-cased)
        const adoEntry = plan.find(e => e.kind_name === "ado");
        assertTrue(adoEntry.kind_title === "Ado", `${label}: expected ado kind_title="Ado", got "${adoEntry.kind_title}"`);
    } catch (e) {
        if (e.message !== "__skip__") { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
    }
}

// HC-V0780-C2: priorities=[chat, calendar] but mcps lacks calendar → warning in-position
{
    const label = "HC-V0780-C2 kind in priorities not in mcps → warn entry, not_classified";
    try {
        const helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const prefs = {
            priorities: ["chat", "calendar"],
            personality: {},
            mcps: {
                chat:  { served_by: "ns-a", override_classified: true, connected: true, what_matters: "x" },
                email: { served_by: "ns-b", override_classified: true, connected: true, what_matters: "y" },  // present but not in priorities
            },
        };
        const reachable = new Set(["ns-a", "ns-b"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const plan = helper.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap });
        assertTrue(plan.length === 2, `${label}: expected 2 entries, got ${plan.length}`);
        assertTrue(plan[0].kind_name === "chat" && plan[0].action === "gather_from_served_by",
            `${label}: expected plan[0]=chat gather, got ${plan[0].kind_name}/${plan[0].action}`);
        assertTrue(plan[1].kind_name === "calendar" && plan[1].action === "warn",
            `${label}: expected plan[1]=calendar warn, got ${plan[1].kind_name}/${plan[1].action}`);
        assertTrue(plan[1].reason === "not_classified",
            `${label}: expected reason=not_classified, got "${plan[1].reason}"`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0780-C3: mcps[kind].connected=false → warning not_connected
{
    const label = "HC-V0780-C3 mcps[kind].connected=false → warn entry, not_connected";
    try {
        const helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const prefs = {
            priorities: ["email"],
            personality: {},
            mcps: {
                email: { served_by: "45224a84", override_classified: true, connected: false, captured_at: "2026-05-20", what_matters: "x" },
            },
        };
        const reachable = new Set(["45224a84"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const plan = helper.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap });
        assertTrue(plan.length === 1 && plan[0].action === "warn" && plan[0].reason === "not_connected",
            `${label}: expected warn/not_connected, got ${JSON.stringify(plan[0])}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0780-C4: served_by not in reachable namespaces → warning served_by_unreachable
{
    const label = "HC-V0780-C4 served_by namespace not reachable → warn entry, served_by_unreachable";
    try {
        const helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const prefs = {
            priorities: ["calendar"],
            personality: {},
            mcps: {
                calendar: { served_by: "nonexistent-ns", override_classified: true, connected: true, what_matters: "x" },
            },
        };
        const reachable = new Set(["claude_ai_Gmail", "claude_ai_Google_Calendar"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const plan = helper.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap });
        assertTrue(plan.length === 1 && plan[0].action === "warn" && plan[0].reason === "served_by_unreachable",
            `${label}: expected warn/served_by_unreachable, got ${JSON.stringify(plan[0])}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.78.0 Workstream A — legacy fallback
// =====================================================================

// HC-V0780-D1: empty prefs → dispatch_mode legacy
{
    const label = "HC-V0780-D1 empty user-preferences → dispatch_mode legacy";
    try {
        let helper;
        try { helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js")); }
        catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); throw new Error("__skip__"); }
        if (typeof helper.decideDispatchMode !== "function") {
            failed++;
            console.error(`FAIL  ${label}: decideDispatchMode not exported (expected — added in S8)`);
            throw new Error("__skip__");
        }
        const mode = helper.decideDispatchMode({ prefsStatus: "empty" });
        assertTrue(mode === "legacy", `${label}: expected legacy, got ${mode}`);
    } catch (e) {
        if (e.message !== "__skip__") { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
    }
}

// HC-V0780-D2: malformed prefs → dispatch_mode legacy
{
    const label = "HC-V0780-D2 malformed user-preferences → dispatch_mode legacy";
    try {
        const helper = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const mode = helper.decideDispatchMode({ prefsStatus: "malformed" });
        assertTrue(mode === "legacy", `${label}: expected legacy, got ${mode}`);
        const okMode = helper.decideDispatchMode({ prefsStatus: "ok" });
        assertTrue(okMode === "prefs", `${label}: expected prefs for ok, got ${okMode}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.78.0 Workstream A+B+C — end-to-end body composition
// =====================================================================

// HC-V0780-E1: simulated morning-briefing body composition produces priority-ordered example blocks + voice-contract prefix
{
    const label = "HC-V0780-E1 morning-briefing body composition: 5 priority-ordered example blocks + voice-contract prefix";
    try {
        let helper;
        try { helper = require(path.join(BP, "helpers", "compose-body-helper.js")); }
        catch (e) {
            failed++;
            console.error(`FAIL  ${label}: compose-body-helper not yet created (expected — added in S10): ${e.message}`);
            throw new Error("__skip__");
        }
        if (typeof helper.composeBody !== "function") {
            failed++; console.error(`FAIL  ${label}: composeBody not exported`); throw new Error("__skip__");
        }
        const prefs = {
            priorities: ["chat", "ado", "github", "calendar", "email"],
            personality: { vibe: "casual", pep_talk: false, length: "balanced", notes: "Facts only. No overreach." },
            mcps: {
                chat:     { served_by: "ns1", override_classified: true, connected: true, what_matters: "Teams priority" },
                ado:      { served_by: "ns2", custom_kind: true,         connected: true, what_matters: "Board progress" },
                github:   { served_by: "ns3", custom_kind: true,         connected: true, what_matters: "PR review" },
                calendar: { served_by: "ns1", override_classified: true, connected: true, what_matters: "Conflicts" },
                email:    { served_by: "ns1", override_classified: true, connected: true, what_matters: "Action only" },
            },
        };
        const orderedBlocks = [
            { kind_name: "chat",     markdown: "> [!example]+ Chat\n> - Stefan replied\n> - Hayden needs review", kind: "example" },
            { kind_name: "ado",      markdown: "> [!example]+ Ado\n> - Story 705679 moved",                       kind: "example" },
            { kind_name: "github",   markdown: "> [!example]+ Github\n> - PR 234 awaiting review",                kind: "example" },
            { kind_name: "calendar", markdown: "> [!example]+ Calendar\n> - 9am Standup\n> - 10am conflict",      kind: "example" },
            { kind_name: "email",    markdown: "> [!example]+ Email\n> - VIP from Stefan",                        kind: "example" },
        ];
        const result = helper.composeBody({
            dispatch_mode: "prefs",
            prefs,
            ordered_blocks: orderedBlocks,
            engagement: { id: "accuris", timezone: "America/Denver" },
            prompt_body: "Compose today's briefing.",
            today: "2026-05-27",
            synopsis: "Today's plan: focused dev work, two meeting blocks, one conflict at 10am.",
            tip: "First action: reply to Stefan's thread on cyan-4 board.",
            aspect_blocks: [], // none for accuris (render_aspects skip semantic/finance)
        });
        assertTrue(typeof result.body === "string" && result.body.length > 200,
            `${label}: expected non-trivial body, got length ${result.body && result.body.length}`);
        // Body shape checks
        assertTrue(/```dataviewjs[\s\S]*?SpaceNavButtons[\s\S]*?```/.test(result.body),
            `${label}: body missing SpaceNavButtons block`);
        assertTrue(/^> \[!info\]- /m.test(result.body),
            `${label}: body missing [!info]- callout`);
        assertTrue(/^> \[!tip\] /m.test(result.body),
            `${label}: body missing [!tip] callout`);
        // Priority ordering: chat before ado before github before calendar before email
        const idxChat     = result.body.indexOf("> [!example]+ Chat");
        const idxAdo      = result.body.indexOf("> [!example]+ Ado");
        const idxGithub   = result.body.indexOf("> [!example]+ Github");
        const idxCalendar = result.body.indexOf("> [!example]+ Calendar");
        const idxEmail    = result.body.indexOf("> [!example]+ Email");
        assertTrue(idxChat > -1 && idxAdo > -1 && idxGithub > -1 && idxCalendar > -1 && idxEmail > -1,
            `${label}: missing one or more priority example markers in body`);
        assertTrue(idxChat < idxAdo && idxAdo < idxGithub && idxGithub < idxCalendar && idxCalendar < idxEmail,
            `${label}: priority order incorrect (chat→ado→github→calendar→email)`);
        // Voice contract present in prompt body that was passed to compose
        assertTrue(typeof result.prompt_body_with_voice === "string" && result.prompt_body_with_voice.startsWith("Voice contract"),
            `${label}: prompt_body_with_voice missing voice contract prefix`);
        assertTrue(result.prompt_body_with_voice.includes("Facts only. No overreach."),
            `${label}: voice contract missing notes`);
    } catch (e) {
        if (e.message !== "__skip__") { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
    }
}

// =====================================================================
// v0.78.1 — agent-side algorithm primary + URL contract (prose lints)
// =====================================================================

// HC-V0781-A1: read-user-preferences + 5 orchestrators describe the
// agent-side algorithm as primary; helper-mention is harness-only.
{
    const label = "HC-V0781-A1 SKILL.md tells agent to execute algorithm directly (no helper-primary)";
    try {
        const rpSkill = readSkill("skills/skills/read-user-preferences/SKILL.md");
        assertTrue(!/Delegate to the helper at `\.local\/blueprints/.test(rpSkill),
            `${label}: read-user-preferences SKILL.md must not say "Delegate to the helper at \`.local/blueprints/...\`"`);
        assertTrue(/Read the user-preferences\.md file/i.test(rpSkill),
            `${label}: read-user-preferences SKILL.md must instruct the agent to read the file directly`);
        assertTrue(/v1.+v2 migration|gmail.*email|imessage.*chat/i.test(rpSkill),
            `${label}: read-user-preferences SKILL.md must document v1->v2 migration rules in prose`);
        assertTrue(/## Harness testing/.test(rpSkill),
            `${label}: read-user-preferences SKILL.md must have a ## Harness testing section`);
        assertTrue(/NOT materialized into consumer vaults/i.test(rpSkill),
            `${label}: read-user-preferences ## Harness testing must state helper is NOT materialized in consumer vaults`);

        const orchestrators = ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"];
        for (const orch of orchestrators) {
            const orchSkill = readSkill(`skills/orchestrators/${orch}/SKILL.md`);
            assertTrue(!/Invoke .*`\.local\/blueprints\/cowork\/helpers\/dispatch-plan-helper/.test(orchSkill),
                `${label}: orchestrators/${orch}/SKILL.md must not say "Invoke ...\`.local/blueprints/cowork/helpers/dispatch-plan-helper..."`);
            assertTrue(/reachable_namespaces|tool list.*mcp__/i.test(orchSkill),
                `${label}: orchestrators/${orch}/SKILL.md must document reachable_namespaces extraction from tool list`);
            assertTrue(/## Harness testing/.test(orchSkill),
                `${label}: orchestrators/${orch}/SKILL.md must have ## Harness testing section`);
        }
    } catch (e) {
        failed++;
        console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0781-B1: gather-from-served-by has the Source URL requirements section
{
    const label = "HC-V0781-B1 gather-from-served-by SKILL.md has Source URL contract";
    try {
        const skill = readSkill("skills/skills/gather-from-served-by/SKILL.md");
        assertTrue(/## Source URL requirements/.test(skill),
            `${label}: SKILL.md must have ## Source URL requirements section`);
        assertTrue(/github[\s\S]{0,80}MUST/i.test(skill),
            `${label}: github kind must be MUST`);
        assertTrue(/ado[\s\S]{0,80}MUST/i.test(skill),
            `${label}: ado kind must be MUST`);
        assertTrue(/email[\s\S]{0,80}MUST/i.test(skill),
            `${label}: email kind must be MUST`);
        assertTrue(/calendar[\s\S]{0,80}SHOULD/i.test(skill),
            `${label}: calendar kind must be SHOULD`);
        assertTrue(/chat[\s\S]{0,80}SHOULD/i.test(skill),
            `${label}: chat kind must be SHOULD`);
        assertTrue(/\*\*\[[^\]]+\]\(https?:\/\/[^)]+\)\*\*/.test(skill),
            `${label}: SKILL.md must contain at least one inline-link formatting example`);
        assertTrue(/did not expose URL/i.test(skill),
            `${label}: SKILL.md must document the "did not expose URL" fallback note pattern`);
    } catch (e) {
        failed++;
        console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream B — hard_rules + no_emojis parsing
// =====================================================================

// HC-V0790-A1: hard_rules + no_emojis parsed; effective_hard_rules composes
{
    const label = "HC-V0790-A1 hard_rules + no_emojis → effective_hard_rules";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0790-a1-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "priorities:",
            "  - finance",
            "personality:",
            "  vibe: encouraging",
            "  no_emojis: true",
            "  hard_rules:",
            "    - 'never use the word leverage'",
            "mcps:",
            "  finance:",
            "    served_by: \"copilot-money\"",
            "    override_classified: true",
            "    connected: true",
            "    what_matters: |",
            "      Monitor all spend.",
            "---",
            "",
            "# user-preferences.md",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.status === "ok", `${label}: expected ok, got ${result.status}`);
        assertTrue(result.prefs.personality.no_emojis === true, `${label}: expected no_emojis=true`);
        assertTrue(Array.isArray(result.prefs.effective_hard_rules), `${label}: expected effective_hard_rules array`);
        assertTrue(result.prefs.effective_hard_rules.some(r => /leverage/.test(r)), `${label}: expected user rule preserved`);
        assertTrue(result.prefs.effective_hard_rules.some(r => r === helper.CANONICAL_NO_EMOJI_RULE),
            `${label}: expected canonical no-emoji rule appended, got ${JSON.stringify(result.prefs.effective_hard_rules)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0790-A2: no hard_rules / no_emojis absent → effective_hard_rules == []
{
    const label = "HC-V0790-A2 absent hard_rules/no_emojis → empty effective_hard_rules";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0790-a2-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---", "type: cowork-user-preferences", "priorities:", "  - finance",
            "personality:", "  vibe: casual",
            "mcps:", "  finance:", "    served_by: \"copilot-money\"", "    override_classified: true",
            "    connected: true", "    what_matters: |", "      x",
            "---", "", "# user-preferences.md",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const result = helper.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(result.prefs.personality.no_emojis === false, `${label}: expected no_emojis default false`);
        assertTrue(Array.isArray(result.prefs.effective_hard_rules) && result.prefs.effective_hard_rules.length === 0,
            `${label}: expected empty effective_hard_rules, got ${JSON.stringify(result.prefs.effective_hard_rules)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0790-A3: composeEffectiveHardRules unit
{
    const label = "HC-V0790-A3 composeEffectiveHardRules({no_emojis,hard_rules})";
    try {
        const helper = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        assertTrue(typeof helper.composeEffectiveHardRules === "function", `${label}: composeEffectiveHardRules not exported`);
        const r1 = helper.composeEffectiveHardRules({ no_emojis: true, hard_rules: ["a"] });
        assertTrue(r1.length === 2 && r1[0] === "a" && r1[1] === helper.CANONICAL_NO_EMOJI_RULE,
            `${label}: expected [a, canonical], got ${JSON.stringify(r1)}`);
        const r2 = helper.composeEffectiveHardRules({ no_emojis: false, hard_rules: [] });
        assertTrue(r2.length === 0, `${label}: expected empty, got ${JSON.stringify(r2)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream B — hard_rules propagation
// =====================================================================

// HC-V0790-B1: composeVoiceContract appends a Hard rules block when rules present
{
    const label = "HC-V0790-B1 composeVoiceContract appends Hard rules block";
    try {
        const dh = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const vc = dh.composeVoiceContract({ vibe: "casual" }, ["never use leverage", "X"]);
        assertTrue(/Hard rules \(non-negotiable/.test(vc), `${label}: expected Hard rules header, got: ${vc.slice(0,200)}`);
        assertTrue(/never use leverage/.test(vc), `${label}: expected rule text present`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-B2: composeVoiceContract emits even when personality empty but rules exist
{
    const label = "HC-V0790-B2 voice contract emits for rules-only (empty personality)";
    try {
        const dh = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const vc = dh.composeVoiceContract({ vibe: null, formality: null, pep_talk: null, length: null, notes: null }, ["no em-dashes"]);
        assertTrue(vc !== "" && /no em-dashes/.test(vc), `${label}: expected non-empty contract with rule, got ${JSON.stringify(vc)}`);
        const vcNone = dh.composeVoiceContract({ vibe: null, formality: null, pep_talk: null, length: null, notes: null }, []);
        assertTrue(vcNone === "", `${label}: expected empty contract when no personality + no rules`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-B3: gather-from-served-by accepts hard_rules input without breaking dry-run
{
    const label = "HC-V0790-B3 gather-from-served-by accepts hard_rules input";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "finance", kind_title: "Finance", served_by: "copilot-money",
            what_matters: "Yesterday transactions.", question_set_answers: null,
            hard_rules: ["no emoji anywhere"],
            today: "2026-05-29", range: { start: "2026-05-29", end: "2026-05-29" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__copilot-money__list_transactions"],
                agent_markdown: "> [!example]+ Finance\n> - Groceries $52 at Walmart\n> - Gas $44 at South Platte\n> - Dining $38 at Sushi Den",
                tools_used: ["mcp__copilot-money__list_transactions"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status} (${result.reason||""})`);
        assertTrue(Array.isArray(result.hard_rules_applied) && result.hard_rules_applied.length === 1,
            `${label}: expected hard_rules echoed in hard_rules_applied, got ${JSON.stringify(result.hard_rules_applied)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-B4: gather-from-served-by SKILL.md documents Hard rules binding (prose-lint)
{
    const label = "HC-V0790-B4 gather-from-served-by SKILL.md has Hard rules section";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-from-served-by/SKILL.md"), "utf8");
        assertTrue(/##\s*Hard rules/i.test(skill), `${label}: expected '## Hard rules' section`);
        assertTrue(/title/i.test(skill) && /hard_rules/.test(skill), `${label}: expected binding mentions title + hard_rules`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream A — microscope dispatch routing
// =====================================================================

// HC-V0790-C1: microscope present for a canonical kind → forced gather_from_served_by
{
    const label = "HC-V0790-C1 microscope forces canonical kind through served-by";
    try {
        const dh = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const prefs = {
            priorities: ["calendar"],
            personality: {},
            mcps: { calendar: { served_by: "ns-cal", connected: true, what_matters: "conflicts only" } },
        };
        const reachable = new Set(["ns-cal"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const microscopes = { calendar: "## What matters\nDeep calendar contract: surface travel + conflicts + prep gaps." };
        const plan = dh.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap, microscopes });
        assertTrue(plan.length === 1, `${label}: expected 1 entry, got ${plan.length}`);
        assertTrue(plan[0].action === "gather_from_served_by", `${label}: expected forced served-by, got ${plan[0].action}`);
        assertTrue(plan[0].microscope === true, `${label}: expected microscope flag true`);
        assertTrue(/Deep calendar contract/.test(plan[0].what_matters), `${label}: expected microscope body as what_matters`);
        assertTrue(/conflicts only/.test(plan[0].baseline_notes || ""), `${label}: expected notes preserved as baseline_notes`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-C2: no microscope → behavior unchanged (canonical stays canonical)
{
    const label = "HC-V0790-C2 no microscope → canonical kind unchanged";
    try {
        const dh = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const prefs = {
            priorities: ["calendar"],
            personality: {},
            mcps: { calendar: { served_by: "ns-cal", connected: true, what_matters: "x" } },
        };
        const reachable = new Set(["ns-cal"]);
        const mcpSkillMap = JSON.parse(fs.readFileSync(path.join(BP, "content/context/mcp-skill-map.json"), "utf8"));
        const plan = dh.planDispatch({ prefs, reachableNamespaces: reachable, mcpSkillMap, microscopes: {} });
        assertTrue(plan.length === 1, `${label}: expected 1 entry`);
        assertTrue(plan[0].action === "gather_canonical", `${label}: expected canonical when no microscope, got ${plan[0].action}`);
        assertTrue(!plan[0].microscope, `${label}: expected no microscope flag`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream B — end-to-end emoji scan
// =====================================================================

// HC-V0790-D1: no_emojis:true → composed prefix + mocked gather callout carry zero emoji
{
    const label = "HC-V0790-D1 no_emojis end-to-end → zero pictographs in composed body";
    try {
        // Emoji/pictograph codepoint detector (block-scoped to this case)
        const hasEmoji = (str) =>
            /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{2764}]/u.test(str);
        const rup = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const dh = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const dp = require(path.join(BP, "helpers", "dispatch-plan-helper.js"));
        const effective = rup.composeEffectiveHardRules({ no_emojis: true, hard_rules: [] });
        const voice = dp.composeVoiceContract({ vibe: "casual" }, effective);
        // A compliant gather output (agent honored the no-emoji hard rule)
        const gather = dh.gatherFromServedBy({
            kind_name: "finance", kind_title: "Finance", served_by: "copilot-money",
            what_matters: "transactions", question_set_answers: null, hard_rules: effective,
            today: "2026-05-29", range: { start: "2026-05-29", end: "2026-05-29" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__copilot-money__list_transactions"],
                agent_markdown: "> [!example]+ Finance\n> - Groceries $52 at Walmart\n> - Gas $44 at South Platte\n> - Dining $38 at Sushi Den",
                tools_used: ["mcp__copilot-money__list_transactions"],
            },
        });
        const composedBody = voice + "\n" + gather.markdown;
        assertTrue(!hasEmoji(composedBody), `${label}: composed body contains emoji: ${JSON.stringify(composedBody.slice(0,120))}`);
        assertTrue(/Hard rules/.test(voice), `${label}: expected hard-rules block in voice contract`);
        // Negative control: a non-compliant gather output WOULD trip the detector
        assertTrue(hasEmoji("> [!example]+ 💰 Finance\n> - Groceries"), `${label}: detector sanity — should flag emoji`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream A — edit-microscope helper
// =====================================================================

// HC-V0790-E1: composeMicroscope seeds from notes on first run
{
    const label = "HC-V0790-E1 composeMicroscope seeds from notes (first run)";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeMicroscope({
            kind_name: "finance",
            existing: null,
            notes: "Monitor all spend; keep debt front and center.",
            answers: { what_matters: "Yesterday transaction table; category outliers; recurring changes." },
            tools: ["mcp__copilot-money__list_transactions", "mcp__copilot-money__list_accounts"],
            gaps: [],
        });
        assertTrue(/^##\s*What matters/m.test(out), `${label}: expected '## What matters' section`);
        assertTrue(/##\s*Tools & how to use them/m.test(out), `${label}: expected Tools section`);
        assertTrue(/Yesterday transaction table/.test(out), `${label}: expected answers in body`);
        assertTrue(/Monitor all spend/.test(out), `${label}: expected notes seeded as baseline`);
        assertTrue(/list_transactions/.test(out), `${label}: expected available tools referenced`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-E2: composeMicroscope deepens existing (re-run preserves prior + appends)
{
    const label = "HC-V0790-E2 composeMicroscope deepens existing contract";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const existing = "## What matters\nPrior contract line ALPHA.\n\n## Tools & how to use them\n- list_transactions\n";
        const out = em.composeMicroscope({
            kind_name: "finance", existing, notes: "",
            answers: { what_matters: "New deeper requirement BETA." },
            tools: ["mcp__copilot-money__list_transactions"], gaps: [],
        });
        assertTrue(/ALPHA/.test(out), `${label}: expected prior content preserved`);
        assertTrue(/BETA/.test(out), `${label}: expected new content appended`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0790-E3: classifyGap distinguishes resolvable-in-gather vs mcp-ceiling
{
    const label = "HC-V0790-E3 classifyGap resolvable vs ceiling";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        // search_contacts present → number→name gap is resolvable in-gather
        const g1 = em.classifyGap({
            gap: "messages show phone numbers, not contact names",
            tools: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
        });
        assertTrue(g1.resolution === "resolvable-in-gather", `${label}: expected resolvable-in-gather, got ${g1.resolution}`);
        // no message-content tool → ceiling
        const g2 = em.classifyGap({
            gap: "cannot read message content",
            tools: ["mcp__wa__check-whatsapp-status", "mcp__wa__list-recent-contacts"],
        });
        assertTrue(g2.resolution === "mcp-ceiling", `${label}: expected mcp-ceiling, got ${g2.resolution}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.79.0 Workstream C — styling per-type callout-color snippet
// =====================================================================

// HC-V0790-G1: styling ships sauce-callouts.css and enables it
{
    const label = "HC-V0790-G1 styling vendors + enables sauce-callouts.css";
    try {
        const cssPath = path.join(__dirname, "..", "mechanisms", "styling", "assets", "snippets", "sauce-callouts.css");
        assertTrue(fs.existsSync(cssPath), `${label}: sauce-callouts.css not vendored at ${cssPath}`);
        const css = fs.readFileSync(cssPath, "utf8");
        assertTrue(/--callout-color/.test(css), `${label}: expected per-type --callout-color rules`);
        // distinct hues for at least info + warning + tip + example
        for (const t of ["info", "warning", "tip", "example"]) {
            assertTrue(new RegExp(`callout-metadata.*${t}|data-callout=["']${t}["']|"${t}"`, "i").test(css) || css.includes(t),
                `${label}: expected a rule referencing the "${t}" callout type`);
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mechanisms", "styling", "manifest.json"), "utf8"));
        const enabled = (manifest.appearance && manifest.appearance.enabledCssSnippets) || [];
        assertTrue(enabled.includes("sauce-callouts"), `${label}: sauce-callouts not in appearance.enabledCssSnippets, got ${JSON.stringify(enabled)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.80.0 Workstream — gather-from-served-by accepts siblings[]
// =====================================================================

// HC-V0800-B1: gather-from-served-by accepts siblings[] input without breaking dry-run
{
    const label = "HC-V0800-B1 gather-from-served-by accepts siblings[] input";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            what_matters: "Messages today.", question_set_answers: null,
            hard_rules: [],
            siblings: [{ name: "contacts-map.md", body: "| phone | name |\n|---|---|\n| +1-555 | Alice |\n" }],
            today: "2026-05-30", range: { start: "2026-05-30", end: "2026-05-30" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
                agent_markdown: "> [!example]+ Chat\n> - Alice (resolved from +1-555): meeting confirmed\n> - Bob: heading out at five thirty for sure\n> - Carol: project update soon",
                tools_used: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status} (${result.reason||""})`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-B2: gather-from-served-by echoes siblings_used[] (filenames) on success
{
    const label = "HC-V0800-B2 gather-from-served-by returns siblings_used[]";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            what_matters: "Messages today.", question_set_answers: null,
            hard_rules: [],
            siblings: [
                { name: "contacts-map.md", body: "| phone | name |\n|---|---|\n" },
                { name: "vip-list.md",     body: "- Alice\n- Bob\n" },
            ],
            today: "2026-05-30", range: { start: "2026-05-30", end: "2026-05-30" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages"],
                agent_markdown: "> [!example]+ Chat\n> - Alice: meeting confirmed for two pm tomorrow\n> - Bob: heading out at five thirty for sure today\n> - Carol: project update later this evening",
                tools_used: ["mcp__imsg__read_imessages"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status} (${result.reason||""})`);
        assertTrue(Array.isArray(result.siblings_used), `${label}: expected siblings_used array, got ${JSON.stringify(result.siblings_used)}`);
        assertTrue(result.siblings_used.length === 2 && result.siblings_used[0] === "contacts-map.md" && result.siblings_used[1] === "vip-list.md",
            `${label}: expected ["contacts-map.md","vip-list.md"], got ${JSON.stringify(result.siblings_used)}`);
        // Empty/absent siblings → empty array, not undefined
        const r2 = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            what_matters: "Messages today.", question_set_answers: null,
            hard_rules: [],
            today: "2026-05-30", range: { start: "2026-05-30", end: "2026-05-30" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages"],
                agent_markdown: "> [!example]+ Chat\n> - Alice: meeting confirmed for two pm tomorrow\n> - Bob: heading out at five thirty for sure today\n> - Carol: project update later this evening",
                tools_used: ["mcp__imsg__read_imessages"],
            },
        });
        assertTrue(Array.isArray(r2.siblings_used) && r2.siblings_used.length === 0,
            `${label}: expected empty siblings_used when omitted, got ${JSON.stringify(r2.siblings_used)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-B3: gather-from-served-by SKILL.md documents siblings injection (prose-lint)
{
    const label = "HC-V0800-B3 gather-from-served-by SKILL.md has User-supplied reference section";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-from-served-by/SKILL.md"), "utf8");
        assertTrue(/##\s*User-supplied reference/i.test(skill), `${label}: expected '## User-supplied reference' section`);
        assertTrue(/siblings/i.test(skill) && /\*\*User-supplied reference:/i.test(skill),
            `${label}: expected prose to mention 'siblings' input and the literal '**User-supplied reference:' block format`);
        assertTrue(/siblings:\s*list\[\{name\s*,\s*body\}\]|siblings:\s*list\[\{name,body\}\]/i.test(skill),
            `${label}: expected inputs frontmatter to declare 'siblings: list[{name,body}]'`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.80.0 Workstream — composeSibling helper
// =====================================================================

// HC-V0800-C1: phone gap → contacts-map.md template with | phone | name |
{
    const label = "HC-V0800-C1 composeSibling phone gap → | phone | name | columns";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "chat",
            gap: "messages show phone numbers, not contact names",
            suggested_name: "contacts-map.md",
        });
        assertTrue(out.status === "ok", `${label}: expected status=ok, got ${out.status}`);
        assertTrue(out.name === "contacts-map.md", `${label}: expected name preserved, got ${out.name}`);
        assertTrue(/\| phone \| name \|/.test(out.body) && /\|---\|---\|/.test(out.body),
            `${label}: expected '| phone | name |' header + separator row, got: ${out.body.slice(0,200)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-C2: email gap → | email | name |
{
    const label = "HC-V0800-C2 composeSibling email gap → | email | name |";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "email",
            gap: "inbox shows sender email addresses, want display names",
            suggested_name: "senders-map.md",
        });
        assertTrue(/\| email \| name \|/.test(out.body), `${label}: expected '| email | name |' header, got: ${out.body.slice(0,200)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-C3: id gap → | id | nickname |
{
    const label = "HC-V0800-C3 composeSibling account/id gap → | id | nickname |";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "finance",
            gap: "transactions show account id codes, prefer nicknames",
            suggested_name: "account-aliases.md",
        });
        assertTrue(/\| id \| nickname \|/.test(out.body), `${label}: expected '| id | nickname |' header, got: ${out.body.slice(0,200)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-C4: vip gap → | id | reason |
{
    const label = "HC-V0800-C4 composeSibling vip/priority gap → | id | reason |";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "email",
            gap: "want VIP highlighting for priority senders",
            suggested_name: "vip-list.md",
        });
        assertTrue(/\| id \| reason \|/.test(out.body), `${label}: expected '| id | reason |' header, got: ${out.body.slice(0,200)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-C5: no-signal gap → | key | value |
{
    const label = "HC-V0800-C5 composeSibling generic gap → | key | value |";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "github",
            gap: "need a glossary of project shorthand",
            suggested_name: "glossary.md",
        });
        assertTrue(/\| key \| value \|/.test(out.body), `${label}: expected '| key | value |' header, got: ${out.body.slice(0,200)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-C6: body has heading + preamble + table (structural shape)
{
    const label = "HC-V0800-C6 composeSibling body has heading + preamble + table";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeSibling({
            kind_name: "chat",
            gap: "messages show phone numbers, not contact names",
            suggested_name: "contacts-map.md",
        });
        assertTrue(/^# /m.test(out.body), `${label}: expected a top-level heading`);
        assertTrue(/USER-OWNED|USER-owned|user-owned/.test(out.body), `${label}: expected USER-OWNED marker in preamble`);
        assertTrue(/^\|/m.test(out.body), `${label}: expected at least one markdown table row`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.80.0 Workstream — composeMicroscope ## References extension
// =====================================================================

// HC-V0800-D1: composeMicroscope emits ## References when siblings_to_reference non-empty
{
    const label = "HC-V0800-D1 composeMicroscope emits ## References section";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out = em.composeMicroscope({
            kind_name: "chat",
            existing: null,
            notes: "Surface inner-circle threads.",
            answers: { what_matters: "Inner-circle senders + topics today." },
            tools: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
            gaps: [],
            siblings_to_reference: [
                { name: "contacts-map.md", role: "resolve sender phone numbers to display names before summarizing" },
                { name: "vip-list.md",     role: "elevate any matching sender to the top of the callout" },
            ],
        });
        assertTrue(/^##\s*References\s*$/m.test(out), `${label}: expected '## References' section header`);
        assertTrue(/- \*\*contacts-map\.md\*\* — resolve sender phone numbers/.test(out),
            `${label}: expected first sibling entry rendered with role`);
        assertTrue(/- \*\*vip-list\.md\*\* — elevate any matching sender/.test(out),
            `${label}: expected second sibling entry rendered with role`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-D2: composeMicroscope omits ## References when siblings_to_reference empty/absent
{
    const label = "HC-V0800-D2 composeMicroscope omits ## References when no siblings";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const out1 = em.composeMicroscope({
            kind_name: "chat", existing: null, notes: "",
            answers: { what_matters: "x" }, tools: [], gaps: [],
            siblings_to_reference: [],
        });
        assertTrue(!/^##\s*References/m.test(out1), `${label}: expected NO References section when empty array`);
        const out2 = em.composeMicroscope({
            kind_name: "chat", existing: null, notes: "",
            answers: { what_matters: "x" }, tools: [], gaps: [],
            // siblings_to_reference absent entirely
        });
        assertTrue(!/^##\s*References/m.test(out2), `${label}: expected NO References section when arg absent`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-D3: deepen-pass appends ## References (added) to existing content
{
    const label = "HC-V0800-D3 composeMicroscope deepen-pass appends ## References (added)";
    try {
        const em = require(path.join(BP, "helpers", "edit-microscope-helper.js"));
        const existing = "## What matters\nPrior contract ALPHA.\n";
        const out = em.composeMicroscope({
            kind_name: "chat", existing, notes: "",
            answers: { what_matters: "deeper BETA" }, tools: [], gaps: [],
            siblings_to_reference: [{ name: "contacts-map.md", role: "resolve sender numbers" }],
        });
        assertTrue(/ALPHA/.test(out), `${label}: expected prior content preserved`);
        assertTrue(/^##\s*References \(added\)\s*$/m.test(out), `${label}: expected '## References (added)' header in deepen-pass`);
        assertTrue(/- \*\*contacts-map\.md\*\* — resolve sender numbers/.test(out),
            `${label}: expected sibling entry rendered in deepen-pass References`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.80.0 Workstream — orchestrator step 2c (sibling-file discovery)
// =====================================================================

// HC-V0800-A1: morning-briefing SKILL.md has step 2c (sibling read + glob/exclude prose)
{
    const label = "HC-V0800-A1 morning-briefing SKILL.md has step 2c sibling read";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
        assertTrue(/^\s*2c\.\s+\*\*Read per-kind sibling files\.\*\*/m.test(skill),
            `${label}: expected '2c. **Read per-kind sibling files.**' sub-step header`);
        // v0.80.1 FLN-v80-1: accept either the literal `per-mcp/<kind_name>/*.md` glob
        // substring OR a split `per-mcp/<kind_name>/` + "matching `*.md`" phrasing
        // (both convey the same contract; the plan-template HC skeleton can use either).
        const hasLiteralGlob = /per-mcp\/<kind_name>\/\*\.md|per-mcp\/<kind>\/\*\.md/.test(skill);
        const hasSplitPhrasing = /per-mcp\/<kind_name>\//.test(skill) && /matching\s+(the\s+)?`?\*\.md/i.test(skill);
        assertTrue(hasLiteralGlob || hasSplitPhrasing,
            `${label}: expected per-mcp glob pattern in step 2c (either literal 'per-mcp/<kind_name>/*.md' OR split 'per-mcp/<kind_name>/' + 'matching \`*.md\`')`);
        assertTrue(/microscope\.md/.test(skill) && /(_\*\.md|underscore-prefix|\^_)/.test(skill),
            `${label}: expected exclusion of microscope.md and underscore-prefix files`);
        assertTrue(/siblings\[kind_name\]|siblings\[kind\]/.test(skill),
            `${label}: expected build of siblings[kind_name] map`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-A2: same step 2c prose present in all 4 other orchestrators
{
    const label = "HC-V0800-A2 step 2c sibling read in 4 other orchestrators";
    try {
        for (const orch of ["midday-tripwire", "eod-review", "weekly-review", "monthly-review"]) {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${orch}/SKILL.md`), "utf8");
            assertTrue(/^\s*2c\.\s+\*\*Read per-kind sibling files\.\*\*/m.test(skill),
                `${label}: ${orch} missing 2c sub-step header`);
            assertTrue(/siblings\[kind_name\]|siblings\[kind\]/.test(skill),
                `${label}: ${orch} missing siblings map build`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0800-A3: gather-loop in all 5 orchestrators passes siblings: siblings[entry.kind_name] || []
{
    const label = "HC-V0800-A3 gather loop passes siblings to gather-from-served-by";
    try {
        for (const orch of ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"]) {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${orch}/SKILL.md`), "utf8");
            assertTrue(/siblings:\s+siblings\[entry\.kind_name\]\s*\|\|\s*\[\]/.test(skill),
                `${label}: ${orch} missing 'siblings: siblings[entry.kind_name] || []' in gather loop input`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.80.0 Workstream — end-to-end injection
// =====================================================================

// HC-V0800-E1: end-to-end — orchestrator dispatch with one sibling carries it verbatim into gather result
{
    const label = "HC-V0800-E1 end-to-end sibling injection echoes through helper";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const SIB_BODY = "| phone | name |\n|---|---|\n| +1-555-0100 | Alice |\n| +1-555-0101 | Bob |\n";
        const result = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            what_matters: "Inner-circle threads today.", question_set_answers: null,
            hard_rules: ["never use the word leverage"],
            siblings: [{ name: "contacts-map.md", body: SIB_BODY }],
            today: "2026-05-30", range: { start: "2026-05-30", end: "2026-05-30" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
                agent_markdown: "> [!example]+ Chat\n> - Alice: meeting confirmed for two pm tomorrow\n> - Bob: heading out at five thirty for sure today\n> - Carol: project update later this evening",
                tools_used: ["mcp__imsg__read_imessages", "mcp__imsg__search_contacts"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status} (${result.reason||""})`);
        assertTrue(Array.isArray(result.siblings_used) && result.siblings_used[0] === "contacts-map.md",
            `${label}: expected siblings_used=[contacts-map.md], got ${JSON.stringify(result.siblings_used)}`);
        assertTrue(Array.isArray(result.hard_rules_applied) && result.hard_rules_applied.length === 1,
            `${label}: expected hard_rules echoed, got ${JSON.stringify(result.hard_rules_applied)}`);
        // Negative control: empty siblings → empty siblings_used
        const r2 = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            what_matters: "x", question_set_answers: null, hard_rules: [],
            today: "2026-05-30", range: { start: "2026-05-30", end: "2026-05-30" }, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages"],
                agent_markdown: "> [!example]+ Chat\n> - Alice: meeting confirmed for two pm tomorrow\n> - Bob: heading out at five thirty for sure today\n> - Carol: project update later this evening",
                tools_used: ["mcp__imsg__read_imessages"],
            },
        });
        assertTrue(r2.siblings_used.length === 0, `${label}: expected empty siblings_used when no siblings, got ${JSON.stringify(r2.siblings_used)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.81.0 Workstream — audit-siblings-helper.js (parseReferences + auditSiblings)
// =====================================================================

// HC-V0810-A1: parseReferences extracts names from a seed-pass ## References block
{
    const label = "HC-V0810-A1 parseReferences: seed-pass References with 2 entries";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const body = [
            "## What matters",
            "Inner-circle threads today.",
            "",
            "## References",
            "- **contacts-map.md** — resolve sender phone numbers",
            "- **vip-list.md** — elevate inner-circle senders",
            "",
        ].join("\n");
        const out = h.parseReferences(body);
        assertTrue(Array.isArray(out) && out.length === 2, `${label}: expected length 2, got ${JSON.stringify(out)}`);
        assertTrue(out[0] === "contacts-map.md", `${label}: expected first=contacts-map.md, got ${out[0]}`);
        assertTrue(out[1] === "vip-list.md", `${label}: expected second=vip-list.md, got ${out[1]}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-A2: parseReferences returns [] when no References section
{
    const label = "HC-V0810-A2 parseReferences: no References section → []";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const body = "## What matters\nJust some content, no References block.\n";
        const out = h.parseReferences(body);
        assertTrue(Array.isArray(out) && out.length === 0, `${label}: expected [], got ${JSON.stringify(out)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-A3: parseReferences handles deepen-pass `## References (added)` header
{
    const label = "HC-V0810-A3 parseReferences: deepen-pass `## References (added)` recognized";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const body = [
            "## What matters",
            "Prior content.",
            "",
            "## References (added)",
            "- **contacts-map.md** — resolve sender numbers",
            "",
        ].join("\n");
        const out = h.parseReferences(body);
        assertTrue(out.length === 1 && out[0] === "contacts-map.md", `${label}: expected [contacts-map.md], got ${JSON.stringify(out)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-A4: parseReferences dedupes across seed + deepen-pass blocks
{
    const label = "HC-V0810-A4 parseReferences: dedupe across seed + deepen blocks";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const body = [
            "## References",
            "- **contacts-map.md** — initial role",
            "- **vip-list.md** — initial role",
            "",
            "## Output shape",
            "Bulleted, grounded.",
            "",
            "## References (added)",
            "- **contacts-map.md** — refined role",
            "- **senders-map.md** — new in deepen pass",
            "",
        ].join("\n");
        const out = h.parseReferences(body);
        assertTrue(out.length === 3, `${label}: expected length 3 (deduped), got ${out.length}: ${JSON.stringify(out)}`);
        assertTrue(out.includes("contacts-map.md") && out.includes("vip-list.md") && out.includes("senders-map.md"),
            `${label}: expected all 3 names present, got ${JSON.stringify(out)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B1: auditSiblings flags dangling references
{
    const label = "HC-V0810-B1 auditSiblings: dangling reference flagged";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: { chat: [] },
            microscope_bodies: { chat: "## References\n- **vip-list.md** — elevate inner-circle\n" },
        });
        assertTrue(out.dangling.length === 1, `${label}: expected 1 dangling, got ${out.dangling.length}: ${JSON.stringify(out.dangling)}`);
        assertTrue(out.dangling[0].kind === "chat" && out.dangling[0].name === "vip-list.md",
            `${label}: expected {kind:chat, name:vip-list.md}, got ${JSON.stringify(out.dangling[0])}`);
        assertTrue(out.orphans.length === 0, `${label}: expected 0 orphans, got ${JSON.stringify(out.orphans)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B2: auditSiblings flags orphan files
{
    const label = "HC-V0810-B2 auditSiblings: orphan file flagged";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: { chat: ["vip-list.md"] },
            microscope_bodies: { chat: "## What matters\nThings.\n" },
        });
        assertTrue(out.dangling.length === 0, `${label}: expected 0 dangling, got ${JSON.stringify(out.dangling)}`);
        assertTrue(out.orphans.length === 1, `${label}: expected 1 orphan, got ${out.orphans.length}: ${JSON.stringify(out.orphans)}`);
        assertTrue(out.orphans[0].kind === "chat" && out.orphans[0].name === "vip-list.md",
            `${label}: expected {kind:chat, name:vip-list.md}, got ${JSON.stringify(out.orphans[0])}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B3: auditSiblings returns clean state when consistent
{
    const label = "HC-V0810-B3 auditSiblings: clean state (consistent)";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: { chat: ["contacts-map.md", "vip-list.md"] },
            microscope_bodies: { chat: "## References\n- **contacts-map.md** — resolve numbers\n- **vip-list.md** — elevate\n" },
        });
        assertTrue(out.dangling.length === 0 && out.orphans.length === 0,
            `${label}: expected 0/0, got dangling=${JSON.stringify(out.dangling)} orphans=${JSON.stringify(out.orphans)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B4: auditSiblings flags all siblings as orphans when no microscope exists
{
    const label = "HC-V0810-B4 auditSiblings: no microscope + siblings → all orphans";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: { finance: ["account-aliases.md", "vendor-aliases.md"] },
            microscope_bodies: {},
        });
        assertTrue(out.dangling.length === 0, `${label}: expected 0 dangling, got ${JSON.stringify(out.dangling)}`);
        assertTrue(out.orphans.length === 2, `${label}: expected 2 orphans, got ${out.orphans.length}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B5: auditSiblings is a no-op when microscope exists + no siblings
{
    const label = "HC-V0810-B5 auditSiblings: microscope + no siblings → 0/0";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: { chat: [] },
            microscope_bodies: { chat: "## What matters\nThings.\n" },
        });
        assertTrue(out.dangling.length === 0 && out.orphans.length === 0,
            `${label}: expected 0/0, got ${JSON.stringify(out)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-B6: auditSiblings output is deterministically sorted by (kind, name)
{
    const label = "HC-V0810-B6 auditSiblings: output sorted by (kind, name)";
    try {
        const h = require(path.join(BP, "helpers", "audit-siblings-helper.js"));
        const out = h.auditSiblings({
            kinds_dir_listing: {
                finance: ["zeta.md", "alpha.md"],
                chat: ["gamma.md"],
            },
            microscope_bodies: {},
        });
        assertTrue(out.orphans.length === 3, `${label}: expected 3 orphans, got ${out.orphans.length}`);
        assertTrue(out.orphans[0].kind === "chat" && out.orphans[0].name === "gamma.md",
            `${label}: expected first chat/gamma.md, got ${JSON.stringify(out.orphans[0])}`);
        assertTrue(out.orphans[1].kind === "finance" && out.orphans[1].name === "alpha.md",
            `${label}: expected second finance/alpha.md, got ${JSON.stringify(out.orphans[1])}`);
        assertTrue(out.orphans[2].kind === "finance" && out.orphans[2].name === "zeta.md",
            `${label}: expected third finance/zeta.md, got ${JSON.stringify(out.orphans[2])}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0810-C1: audit-siblings/SKILL.md exists at orchestrator-tier dest + declares the expected steps
{
    const label = "HC-V0810-C1 audit-siblings/SKILL.md exists + declares References parsing + callout shapes";
    try {
        const skillPath = path.join(BP, "skills/orchestrators/audit-siblings/SKILL.md");
        assertTrue(fs.existsSync(skillPath), `${label}: expected SKILL.md at ${skillPath}`);
        const skill = fs.readFileSync(skillPath, "utf8");
        assertTrue(/name:\s*cowork:audit-siblings/.test(skill),
            `${label}: expected 'name: cowork:audit-siblings' in frontmatter`);
        assertTrue(/##\s*References/i.test(skill),
            `${label}: expected mention of '## References' parsing in SKILL.md prose`);
        assertTrue(/\[!warning\].*Dangling|Dangling.*\[!warning\]/i.test(skill),
            `${label}: expected [!warning] callout for dangling references`);
        assertTrue(/\[!info\].*Orphan|Orphan.*\[!info\]/i.test(skill),
            `${label}: expected [!info] callout for orphan siblings`);
        assertTrue(/auditSiblings/.test(skill),
            `${label}: expected reference to auditSiblings helper`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0811-A1: /cowork slash body documents audit-siblings sub-command
{
    const label = "HC-V0811-A1 /cowork slash body documents audit-siblings sub-command (v0.81.1)";
    try {
        const cmdPath = path.join(BP, "commands", "cowork.md");
        assertTrue(fs.existsSync(cmdPath), `${label}: expected slash command at ${cmdPath}`);
        const body = fs.readFileSync(cmdPath, "utf8");
        assertTrue(/##\s+\/cowork audit-siblings/i.test(body),
            `${label}: expected '## /cowork audit-siblings' section header in slash body`);
        assertTrue(/cowork:audit-siblings/.test(body),
            `${label}: expected reference to 'cowork:audit-siblings' skill name in slash body`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// =====================================================================
// v0.82.0 Workstream A — per-kind callout_type resolution
// =====================================================================

// HC-V0820-A1: read-user-preferences-helper parses explicit callout_type override
{
    const label = "HC-V0820-A1 read-user-preferences-helper: explicit callout_type override parsed";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0820-a1-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "updated: 2026-06-01",
            "updated_by: cowork:context-builder",
            "priorities:",
            "  - chat",
            "  - finance",
            "personality:",
            "  vibe: casual",
            "  formality: casual",
            "  pep_talk: false",
            "  length: balanced",
            "mcps:",
            "  chat:",
            "    served_by: \"test\"",
            "    callout_type: warning",
            "    connected: true",
            "  finance:",
            "    served_by: \"copilot-money\"",
            "    connected: true",
            "---",
            "",
            "# user-preferences",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const h = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const out = h.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(out.status === "ok", `${label}: expected status=ok, got ${out.status} (${out.reason || ""})`);
        assertTrue(out.prefs && out.prefs.mcps && out.prefs.mcps.chat && out.prefs.mcps.chat.callout_type === "warning",
            `${label}: expected chat.callout_type=warning (explicit), got ${JSON.stringify(out.prefs && out.prefs.mcps && out.prefs.mcps.chat)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0820-A2: default mapping applied when callout_type absent
{
    const label = "HC-V0820-A2 read-user-preferences-helper: default callout_type mapping per kind";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0820-a2-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "updated: 2026-06-01",
            "updated_by: cowork:context-builder",
            "priorities:",
            "  - chat",
            "  - finance",
            "  - calendar",
            "  - email",
            "  - ado",
            "  - github",
            "personality:",
            "  vibe: casual",
            "mcps:",
            "  chat:",
            "    served_by: \"a\"",
            "    connected: true",
            "  finance:",
            "    served_by: \"b\"",
            "    connected: true",
            "  calendar:",
            "    served_by: \"c\"",
            "    connected: true",
            "  email:",
            "    served_by: \"d\"",
            "    connected: true",
            "  ado:",
            "    served_by: \"e\"",
            "    connected: true",
            "  github:",
            "    served_by: \"f\"",
            "    connected: true",
            "---",
            "",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const h = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const out = h.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(out.status === "ok", `${label}: expected status=ok, got ${out.status} (${out.reason || ""})`);
        assertTrue(out.prefs.mcps.chat.callout_type === "info",      `${label}: chat default expected info, got ${out.prefs.mcps.chat.callout_type}`);
        assertTrue(out.prefs.mcps.finance.callout_type === "warning", `${label}: finance default expected warning, got ${out.prefs.mcps.finance.callout_type}`);
        assertTrue(out.prefs.mcps.calendar.callout_type === "tip",   `${label}: calendar default expected tip, got ${out.prefs.mcps.calendar.callout_type}`);
        assertTrue(out.prefs.mcps.email.callout_type === "quote",    `${label}: email default expected quote, got ${out.prefs.mcps.email.callout_type}`);
        assertTrue(out.prefs.mcps.ado.callout_type === "example",    `${label}: ado default expected example, got ${out.prefs.mcps.ado.callout_type}`);
        assertTrue(out.prefs.mcps.github.callout_type === "note",    `${label}: github default expected note, got ${out.prefs.mcps.github.callout_type}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0820-A3: invalid callout_type falls back to default mapping
{
    const label = "HC-V0820-A3 read-user-preferences-helper: invalid callout_type → default";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0820-a3-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "updated: 2026-06-01",
            "updated_by: cowork:context-builder",
            "priorities:",
            "  - chat",
            "personality:",
            "  vibe: casual",
            "mcps:",
            "  chat:",
            "    served_by: \"a\"",
            "    callout_type: bogus-not-a-real-type",
            "    connected: true",
            "---",
            "",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const h = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const out = h.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(out.status === "ok", `${label}: expected status=ok, got ${out.status} (${out.reason || ""})`);
        // Invalid → falls back to default mapping for chat = info
        assertTrue(out.prefs.mcps.chat.callout_type === "info",
            `${label}: invalid type should fall back to default 'info' for chat, got ${out.prefs.mcps.chat.callout_type}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0820-A4: unknown kind → falls back to "example"
// (Uses an underscore key — parseYamlIsh's flat-key regex requires [a-z_]+;
// hyphens are silently dropped at the parser level. Pre-existing limitation,
// independent of v0.82.0.)
{
    const label = "HC-V0820-A4 read-user-preferences-helper: unknown kind → 'example'";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v0820-a4-"));
    try {
        const ctxDir = path.join(tmpDir, "spice/cowork/context");
        fs.mkdirSync(ctxDir, { recursive: true });
        const populated = [
            "---",
            "type: cowork-user-preferences",
            "updated: 2026-06-01",
            "updated_by: cowork:context-builder",
            "priorities:",
            "  - notion",
            "personality:",
            "  vibe: casual",
            "mcps:",
            "  notion:",
            "    served_by: \"x\"",
            "    custom_kind: true",
            "    connected: true",
            "---",
            "",
        ].join("\n");
        fs.writeFileSync(path.join(ctxDir, "user-preferences.md"), populated, "utf8");
        const h = require(path.join(BP, "helpers", "read-user-preferences-helper.js"));
        const out = h.readUserPreferences({ vaultRoot: tmpDir });
        assertTrue(out.status === "ok", `${label}: expected status=ok, got ${out.status} (${out.reason || ""})`);
        assertTrue(out.prefs.mcps.notion && out.prefs.mcps.notion.callout_type === "example",
            `${label}: unknown kind should default to 'example', got ${JSON.stringify(out.prefs.mcps.notion)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    }
}

// HC-V0820-B1: gather-from-served-by accepts callout_type input + validates prefix
{
    const label = "HC-V0820-B1 gather-from-served-by: callout_type 'warning' → expects '[!warning]+ Finance'";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "finance", kind_title: "Finance", served_by: "copilot-money",
            callout_type: "warning",
            what_matters: "Daily spend.", question_set_answers: null,
            hard_rules: [], siblings: [],
            today: "2026-06-01", range: {start: "2026-06-01", end: "2026-06-01"}, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__copilot-money__list_transactions"],
                agent_markdown: "> [!warning]+ Finance\n> - Daily spend within threshold.\n> - Categories: food, transport.\n> - No category outliers today; rent posted; budget pace +1.2% YTD.",
                tools_used: ["mcp__copilot-money__list_transactions"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status} (${result.reason||""})`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-B2: gather-from-served-by echoes callout_type_used on success
{
    const label = "HC-V0820-B2 gather-from-served-by returns callout_type_used";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "chat", kind_title: "Chat", served_by: "imsg",
            callout_type: "info",
            what_matters: "Messages.", question_set_answers: null,
            hard_rules: [], siblings: [],
            today: "2026-06-01", range: {start: "2026-06-01", end: "2026-06-01"}, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__imsg__read_imessages"],
                agent_markdown: "> [!info]+ Chat\n> - Alice: hello there, this is a long enough message for the floor.\n> - Bob: meeting confirmed.\n> - Carol: project update soon.",
                tools_used: ["mcp__imsg__read_imessages"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready, got ${result.status}`);
        assertTrue(result.callout_type_used === "info",
            `${label}: expected callout_type_used='info', got ${JSON.stringify(result.callout_type_used)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-B3: gather-from-served-by defaults to "example" when callout_type absent
{
    const label = "HC-V0820-B3 gather-from-served-by: missing callout_type → default 'example'";
    try {
        const helper = require(path.join(BP, "helpers", "gather-from-served-by-helper.js"));
        const result = helper.gatherFromServedBy({
            kind_name: "ado", kind_title: "Ado", served_by: "azure-devops",
            // callout_type omitted intentionally
            what_matters: "Board state.", question_set_answers: null,
            hard_rules: [], siblings: [],
            today: "2026-06-01", range: {start: "2026-06-01", end: "2026-06-01"}, timezone: "America/Denver",
            dry_run_answers: {
                available_tools: ["mcp__azure-devops__list_workitems"],
                agent_markdown: "> [!example]+ Ado\n> - 705679 in progress.\n> - 707653 new today.\n> - Two blocked items aging.",
                tools_used: ["mcp__azure-devops__list_workitems"],
            },
        });
        assertTrue(result.status === "ready", `${label}: expected ready (default 'example' accepts [!example]+ prefix), got ${result.status}`);
        assertTrue(result.callout_type_used === "example",
            `${label}: expected callout_type_used='example' (default), got ${JSON.stringify(result.callout_type_used)}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-C1: gather-from-served-by SKILL.md dispatch contract uses <callout_type> parameter
{
    const label = "HC-V0820-C1 gather-from-served-by SKILL.md: dispatch contract has <callout_type> parameter";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-from-served-by/SKILL.md"), "utf8");
        assertTrue(/\[!<callout_type>\]\+/.test(skill),
            `${label}: expected '[!<callout_type>]+' literal in Step 3 dispatch contract`);
        assertTrue(/callout_type:\s*string/i.test(skill),
            `${label}: expected 'callout_type: string' in inputs frontmatter`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-C2: gather-from-served-by SKILL.md no longer says "no tables"
{
    const label = "HC-V0820-C2 gather-from-served-by SKILL.md: 'no tables' prohibition removed";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-from-served-by/SKILL.md"), "utf8");
        assertTrue(!/no tables — cross-vendor portability|Bulleted lines preferred \(no tables/.test(skill),
            `${label}: expected the 'no tables' prohibition line to be removed from Step 3`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-C3: gather-from-served-by SKILL.md mentions tables OR bullets decision rule
{
    const label = "HC-V0820-C3 gather-from-served-by SKILL.md: table-or-bullet decision rule present";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-from-served-by/SKILL.md"), "utf8");
        assertTrue(/tables?\s+(or|OR)\s+bullets?/i.test(skill),
            `${label}: expected 'tables OR bullets' decision rule in Step 3`);
        assertTrue(/information density|structured (data|columns|fields)/i.test(skill),
            `${label}: expected mention of decision criterion (information density or structured data)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0820-D1: 5 orchestrators pass callout_type in gather loop
{
    const label = "HC-V0820-D1 5 orchestrators pass callout_type: prefs.mcps[entry.kind_name].callout_type";
    try {
        for (const orch of ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"]) {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${orch}/SKILL.md`), "utf8");
            assertTrue(/callout_type:\s+prefs\.mcps\[entry\.kind_name\]\.callout_type/.test(skill),
                `${label}: ${orch} missing 'callout_type: prefs.mcps[entry.kind_name].callout_type' in gather loop input`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-A1: materialized engagement-type JSONs present in workshop dogfood vault
{
    const label = "HC-V0830-A1 dogfood: spice/cowork/context/engagement-types/*.json materialized";
    try {
        const dogfoodDir = path.join(ROOT, "spice/cowork/context/engagement-types");
        for (const type of ["personal", "w2-fte", "consulting"]) {
            const dest = path.join(dogfoodDir, `${type}.json`);
            assertTrue(fs.existsSync(dest),
                `${label}: missing ${type}.json at ${dest}`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-A2: materialized JSONs parse + match workshop source content
{
    const label = "HC-V0830-A2 dogfood: materialized engagement-type JSONs match workshop source";
    try {
        for (const type of ["personal", "w2-fte", "consulting"]) {
            const source = JSON.parse(fs.readFileSync(path.join(BP, `engagement-types/${type}.json`), "utf8"));
            const dest = JSON.parse(fs.readFileSync(path.join(ROOT, `spice/cowork/context/engagement-types/${type}.json`), "utf8"));
            assertTrue(JSON.stringify(source) === JSON.stringify(dest),
                `${label}: ${type}.json content drift between workshop source and materialized dest`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-A3: materialized JSONs carry required schema fields
{
    const label = "HC-V0830-A3 dogfood: materialized JSONs carry required schema fields";
    try {
        const required = ["id", "tripwire_aspects", "render_aspects", "default_cadences", "supported_cadences", "required_fields"];
        for (const type of ["personal", "w2-fte", "consulting"]) {
            const dest = JSON.parse(fs.readFileSync(path.join(ROOT, `spice/cowork/context/engagement-types/${type}.json`), "utf8"));
            for (const field of required) {
                assertTrue(Object.prototype.hasOwnProperty.call(dest, field),
                    `${label}: ${type}.json missing required field '${field}'`);
            }
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-B1..B5: each atomic-note orchestrator references the materialized engagement-type path
{
    const orchestrators = ["midday-tripwire", "morning-briefing", "eod-review", "weekly-review", "monthly-review"];
    const expectedPath = "spice/cowork/context/engagement-types/";
    const removedPhrase = "load type manifest";
    for (let i = 0; i < orchestrators.length; i++) {
        const orch = orchestrators[i];
        const label = `HC-V0830-B${i + 1} ${orch}/SKILL.md references materialized engagement-type path + removes vague 'load type manifest' phrasing`;
        try {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${orch}/SKILL.md`), "utf8");
            assertTrue(skill.includes(expectedPath),
                `${label}: SKILL.md missing canonical path substring '${expectedPath}'`);
            assertTrue(!skill.toLowerCase().includes(removedPhrase),
                `${label}: SKILL.md still contains vague phrasing '${removedPhrase}'`);
        } catch (e) {
            failed++; console.error(`FAIL  ${label}: ${e.message}`);
        }
    }
}

// HC-V0830-C1: bootstrap-vault/SKILL.md references materialized engagement-type path + drops workshop_path engagement-type resolution
{
    const label = "HC-V0830-C1 bootstrap-vault/SKILL.md references materialized engagement-type path";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/bootstrap-vault/SKILL.md"), "utf8");
        assertTrue(skill.includes("spice/cowork/context/engagement-types/"),
            `${label}: missing canonical path 'spice/cowork/context/engagement-types/'`);
        assertTrue(!/Read\s+`platform\/blueprints\/cowork\/engagement-types/.test(skill),
            `${label}: still references workshop path 'platform/blueprints/cowork/engagement-types/' for engagement-type read`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-C2: onboard-scheduled-jobs/SKILL.md references materialized path + drops workshop_manifest_path composition + override check
{
    const label = "HC-V0830-C2 onboard-scheduled-jobs/SKILL.md references materialized path; drops workshop_manifest_path + override logic";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
        assertTrue(skill.includes("spice/cowork/context/engagement-types/"),
            `${label}: missing canonical path 'spice/cowork/context/engagement-types/'`);
        assertTrue(!skill.includes("workshop_manifest_path"),
            `${label}: still composes 'workshop_manifest_path'`);
        assertTrue(!skill.includes("type_manifest_consumer"),
            `${label}: still references 'type_manifest_consumer' override variable`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0830-D1: cowork-customization-contract.md STOCK table includes engagement-types/*.json row
{
    const label = "HC-V0830-D1 cowork-customization-contract.md STOCK table mentions engagement-types/*.json";
    try {
        const contract = fs.readFileSync(path.join(ROOT, "Docs/agent-guides/cowork-customization-contract.md"), "utf8");
        const stockSectionStart = contract.indexOf("## STOCK");
        const nextSectionStart  = contract.indexOf("## USER", stockSectionStart);
        assertTrue(stockSectionStart !== -1 && nextSectionStart !== -1 && nextSectionStart > stockSectionStart,
            `${label}: could not locate '## STOCK' or '## USER' sections in customization contract`);
        const stockBlock = contract.slice(stockSectionStart, nextSectionStart);
        assertTrue(stockBlock.includes("engagement-types/"),
            `${label}: STOCK table missing 'engagement-types/' row`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-A1: capture-tick orchestrator SKILL.md exists at canonical dest
{
    const label = "HC-V0840-A1 capture-tick/SKILL.md exists";
    try {
        const dest = path.join(BP, "skills/orchestrators/capture-tick/SKILL.md");
        assertTrue(fs.existsSync(dest),
            `${label}: missing at ${dest}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-A2: capture-tick SKILL.md declares required sections
{
    const label = "HC-V0840-A2 capture-tick/SKILL.md declares required sections";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/capture-tick/SKILL.md"), "utf8");
        for (const section of ["## Inputs", "## Pre-flight", "## Gather", "## Decide", "## Write", "## Verify", "## Done", "## Harness testing"]) {
            assertTrue(skill.includes(section),
                `${label}: missing section '${section}'`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-A3: capture-tick references canonical memory path + tick range pattern
{
    const label = "HC-V0840-A3 capture-tick/SKILL.md references canonical memory path + range pattern";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/capture-tick/SKILL.md"), "utf8");
        assertTrue(skill.includes("spice/cowork/memory/"),
            `${label}: missing canonical path 'spice/cowork/memory/'`);
        assertTrue(/range:\s*\{\s*start:\s*<?last[_-]tick[_-]at>?/i.test(skill) || skill.includes("last_tick_at"),
            `${label}: missing range/last_tick_at pattern`);
        assertTrue(skill.includes("memory.md"),
            `${label}: missing dest filename 'memory.md'`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-B1: synthesize-day orchestrator SKILL.md exists at canonical dest
{
    const label = "HC-V0840-B1 synthesize-day/SKILL.md exists";
    try {
        const dest = path.join(BP, "skills/orchestrators/synthesize-day/SKILL.md");
        assertTrue(fs.existsSync(dest),
            `${label}: missing at ${dest}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-B2: synthesize-day SKILL.md declares required sections
{
    const label = "HC-V0840-B2 synthesize-day/SKILL.md declares required sections";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-day/SKILL.md"), "utf8");
        for (const section of ["## Inputs", "## Pre-flight", "## Gather", "## Decide", "## Write", "## Verify", "## Done", "## Harness testing"]) {
            assertTrue(skill.includes(section),
                `${label}: missing section '${section}'`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-B3: synthesize-day references memory path + atomic-note discovery + replace-section pattern
{
    const label = "HC-V0840-B3 synthesize-day/SKILL.md references memory path + atomic-note discovery + synthesis section";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-day/SKILL.md"), "utf8");
        assertTrue(skill.includes("spice/cowork/memory/"),
            `${label}: missing canonical memory path`);
        assertTrue(skill.includes("Today's pattern (synthesis)") || skill.includes("synthesis section"),
            `${label}: missing synthesis section reference`);
        assertTrue(skill.includes("synthesized: true") || /synthesized:\s*true/.test(skill),
            `${label}: missing 'synthesized: true' frontmatter update mention`);
        assertTrue(skill.includes("spice/cowork/daily/"),
            `${label}: missing reference to today's atomic notes path for cross-correlation`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-C1, HC-V0840-C2: SUPERSEDED at v0.85.0 S8.
//
// These cases asserted the v0.84.0 morning-briefing inline file-read prose at
// step 3a (`yesterday_synthesis` variable references) + the body composition's
// hand-composed `Yesterday at a glance` + `Overnight` callout literals. The
// v0.85.0 S8 refactor moved both surfaces to the pure helper compose-memory-
// callouts.js (asserted byte-identical via HC-V0850-C1..C5 golden-fixture).
// Removed at v0.85.0 S8 close as the new sub-asserts fully cover the contract
// + the literal prose is now opaque inside the helper. See v0.85.0 design § 2.2.3
// / § 2.2.4 + Docs/plans/2026-06-02-v0.85.0-tier-2-and-read-memory-design.md.

// HC-V0840-D1: engagement-types/*.json declare tick + synthesize_day in supported + default cadences
{
    const label = "HC-V0840-D1 engagement-types JSONs extend supported_cadences + default_cadences with tick + synthesize_day";
    try {
        for (const type of ["personal", "w2-fte", "consulting"]) {
            const j = JSON.parse(fs.readFileSync(path.join(BP, `engagement-types/${type}.json`), "utf8"));
            assertTrue(Array.isArray(j.supported_cadences) && j.supported_cadences.includes("tick"),
                `${label}: ${type}.json supported_cadences missing 'tick'`);
            assertTrue(Array.isArray(j.supported_cadences) && j.supported_cadences.includes("synthesize_day"),
                `${label}: ${type}.json supported_cadences missing 'synthesize_day'`);
            assertTrue(j.default_cadences && j.default_cadences.tick === true,
                `${label}: ${type}.json default_cadences.tick !== true`);
            assertTrue(j.default_cadences && j.default_cadences.synthesize_day === true,
                `${label}: ${type}.json default_cadences.synthesize_day !== true`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-E1: cowork manifest declares both new orchestrators in claude_surface[] + has cowork-memory rule_fragment
{
    const label = "HC-V0840-E1 cowork manifest claude_surface[] declares capture-tick + synthesize-day + cowork-memory rule_fragment";
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(BP, "manifest.json"), "utf8"));
        const cs = manifest.claude_surface || [];
        const sources = cs.filter(e => e.kind === "skill").map(e => e.source);
        assertTrue(sources.some(s => s.includes("orchestrators/capture-tick/SKILL.md")),
            `${label}: claude_surface[] missing capture-tick entry`);
        assertTrue(sources.some(s => s.includes("orchestrators/synthesize-day/SKILL.md")),
            `${label}: claude_surface[] missing synthesize-day entry`);
        const memFrag = (manifest.rule_fragments || []).find(rf => {
            const eq = rf.fragment && rf.fragment.required_frontmatter && rf.fragment.required_frontmatter.type && rf.fragment.required_frontmatter.type.equals;
            return eq === "cowork-memory";
        });
        assertTrue(!!memFrag, `${label}: missing rule_fragment for cowork-memory`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-E2: cowork-customization-contract.md STOCK table includes memory path
{
    const label = "HC-V0840-E2 cowork-customization-contract.md STOCK or platform-owned section mentions spice/cowork/memory/";
    try {
        const contract = fs.readFileSync(path.join(ROOT, "Docs/agent-guides/cowork-customization-contract.md"), "utf8");
        assertTrue(contract.includes("spice/cowork/memory/"),
            `${label}: customization contract missing 'spice/cowork/memory/' row`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0840-F1: onboard-scheduled-jobs/SKILL.md cadence walk references tick + synthesize-day
{
    const label = "HC-V0840-F1 onboard-scheduled-jobs/SKILL.md cadence walk includes tick + synthesize-day";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
        assertTrue(/\btick\b/.test(skill),
            `${label}: missing tick cadence reference`);
        assertTrue(/synthesize.day|synthesize_day/.test(skill),
            `${label}: missing synthesize-day cadence reference`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-G2: Cowork.md hub gains visible Memory section + dataview filter
{
    const label = "HC-V0850-G2 Cowork.md ## Memory + cowork-memory dataview filter";
    try {
        const hub = fs.readFileSync(path.join(BP, "content/Cowork.md"), "utf8");
        assertTrue(hub.includes("## Memory"),
            `${label}: missing '## Memory' heading`);
        assertTrue(hub.includes('"spice/cowork/memory"'),
            `${label}: missing dv.pages('"spice/cowork/memory"') dataview query`);
        assertTrue(hub.includes('p.type === "cowork-memory"'),
            `${label}: missing cowork-memory type filter`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-G3: 3 orchestrators ## Write step gains Memory log backlink callout
{
    const label_root = "HC-V0850-G3 memory log backlink";
    for (const orch of ["morning-briefing", "midday-tripwire", "eod-review"]) {
        const label = `${label_root}: ${orch} ## Write contains Memory log callout`;
        try {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${orch}/SKILL.md`), "utf8");
            const writeIdx = skill.indexOf("\n## Write");
            assertTrue(writeIdx > 0, `${label}: missing '## Write' section`);
            const nextH2 = skill.indexOf("\n## ", writeIdx + 1);
            const writeBlock = nextH2 > 0 ? skill.slice(writeIdx, nextH2) : skill.slice(writeIdx);
            assertTrue(writeBlock.includes("[!quote]-") && writeBlock.includes("Memory log"),
                `${label}: ## Write body missing '[!quote]-' Memory log callout`);
            assertTrue(writeBlock.includes("[[spice/cowork/memory/"),
                `${label}: ## Write body missing canonical memory wikilink target`);
        } catch (e) {
            failed++; console.error(`FAIL  ${label}: ${e.message}`);
        }
    }
}

// ============================================================================
// HC-V0850 RED baseline — surface progressively turns green S6-S10.
// At S5 close: A1..A4, B1..B5, C1..C5, D1×3, E1, E2, F1 all expected to FAIL.
// (G1..G3 already green from S1-S3.)
// ============================================================================

// HC-V0850-A1: read-memory sub-skill SKILL.md exists at sub-skill-tier dest
{
    const label = "HC-V0850-A1 read-memory/SKILL.md exists at skills/skills/read-memory/SKILL.md";
    try {
        const dest = path.join(BP, "skills/skills/read-memory/SKILL.md");
        assertTrue(fs.existsSync(dest), `${label}: missing at ${dest}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-A2: read-memory SKILL.md declares required sections
{
    const label = "HC-V0850-A2 read-memory/SKILL.md declares required sections";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/read-memory/SKILL.md"), "utf8");
        for (const section of ["## Inputs", "## Pre-flight", "## Gather", "## Decide", "## Done", "## Harness testing"]) {
            assertTrue(skill.includes(section), `${label}: missing section '${section}'`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-A3: read-memory SKILL.md declares structured output shape
{
    const label = "HC-V0850-A3 read-memory/SKILL.md declares structured-output fields";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/read-memory/SKILL.md"), "utf8");
        for (const field of ["day_synthesis", "week_synthesis", "ticks", "files_read", "window_resolved"]) {
            assertTrue(skill.includes(field), `${label}: missing output field '${field}'`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-A4: read-memory SKILL.md declares graceful null-data return on file-not-found
{
    const label = "HC-V0850-A4 read-memory/SKILL.md declares null-data return on file-not-found";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/read-memory/SKILL.md"), "utf8");
        assertTrue(/found:\s*false|null-data|graceful/i.test(skill),
            `${label}: missing null-data / found:false / graceful-failure prose`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-B1: synthesize-week orchestrator SKILL.md exists at orchestrator-tier dest
{
    const label = "HC-V0850-B1 synthesize-week/SKILL.md exists at skills/orchestrators/synthesize-week/SKILL.md";
    try {
        const dest = path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md");
        assertTrue(fs.existsSync(dest), `${label}: missing at ${dest}`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-B2: synthesize-week declares required sections
{
    const label = "HC-V0850-B2 synthesize-week/SKILL.md declares required sections";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md"), "utf8");
        for (const section of ["## Inputs", "## Pre-flight", "## Gather", "## Decide", "## Write", "## Verify", "## Done", "## Harness testing"]) {
            assertTrue(skill.includes(section), `${label}: missing section '${section}'`);
        }
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-B3: synthesize-week invokes read-memory + references canonical week-synthesis path
{
    const label = "HC-V0850-B3 synthesize-week invokes cowork:read-memory + canonical week-synthesis path";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md"), "utf8");
        assertTrue(skill.includes("cowork:read-memory"),
            `${label}: missing 'cowork:read-memory' sub-skill invocation`);
        assertTrue(skill.includes("YYYY-Www/synthesis.md") || /<?YYYY-Www>?\/synthesis\.md/.test(skill),
            `${label}: missing canonical week-synthesis path pattern`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-B4: synthesize-week declares cowork-weekly-synthesis type + replace semantics
{
    const label = "HC-V0850-B4 synthesize-week declares cowork-weekly-synthesis type + replace-section idempotency";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md"), "utf8");
        assertTrue(skill.includes("cowork-weekly-synthesis"),
            `${label}: missing 'cowork-weekly-synthesis' canonical type`);
        assertTrue(/replace|idempot/i.test(skill),
            `${label}: missing replace-section or idempotency prose`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-B5: synthesize-week declares ## Days included section
{
    const label = "HC-V0850-B5 synthesize-week declares '## Days included' body section";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md"), "utf8");
        assertTrue(skill.includes("Days included"),
            `${label}: missing 'Days included' section reference`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-C1: morning-briefing pre-flight step 3a invokes cowork:read-memory
{
    const label = "HC-V0850-C1 morning-briefing step 3a invokes cowork:read-memory";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
        assertTrue(skill.includes("cowork:read-memory"),
            `${label}: step 3a doesn't reference cowork:read-memory sub-skill`);
        assertTrue(/output_yesterday|tier:\s*"day"\s*,\s*window:\s*"yesterday"/.test(skill),
            `${label}: step 3a doesn't invoke read-memory with tier:day window:yesterday`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-C2: morning-briefing body composition invokes composeMemoryCallouts helper
{
    const label = "HC-V0850-C2 morning-briefing body composition invokes composeMemoryCallouts";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
        assertTrue(skill.includes("composeMemoryCallouts"),
            `${label}: body composition doesn't reference composeMemoryCallouts helper`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-C3: composeMemoryCallouts byte-identical to v0.84.0 — yesterday only
{
    const label = "HC-V0850-C3 composeMemoryCallouts: yesterday fixture matches expected output";
    try {
        const helperPath = path.join(BP, "helpers/compose-memory-callouts.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMemoryCallouts } = require(helperPath);
        const fixturePath = path.join(ROOT, "platform/test/fixtures/v0.85.0-mb-yesterday-fixture.json");
        const expectedPath = path.join(ROOT, "platform/test/fixtures/v0.85.0-mb-expected-yesterday-callout.md");
        const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const expected = fs.readFileSync(expectedPath, "utf8");
        const out = composeMemoryCallouts(fixture, null);
        assertTrue(out.yesterdayCalloutMd === expected,
            `${label}: yesterdayCalloutMd diverges from expected (byte-diff)`);
        assertTrue(out.overnightCalloutMd === "",
            `${label}: overnightCalloutMd should be empty when overnight input is null`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-C4: composeMemoryCallouts byte-identical to v0.84.0 — overnight only
{
    const label = "HC-V0850-C4 composeMemoryCallouts: overnight fixture matches expected output";
    try {
        const helperPath = path.join(BP, "helpers/compose-memory-callouts.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMemoryCallouts } = require(helperPath);
        const fixtureJsonPath = path.join(ROOT, "platform/test/fixtures/v0.85.0-mb-overnight-fixture.json");
        const expectedPath = path.join(ROOT, "platform/test/fixtures/v0.85.0-mb-expected-overnight-callout.md");
        const fixture = JSON.parse(fs.readFileSync(fixtureJsonPath, "utf8"));
        const expected = fs.readFileSync(expectedPath, "utf8");
        const out = composeMemoryCallouts(null, fixture);
        assertTrue(out.overnightCalloutMd === expected,
            `${label}: overnightCalloutMd diverges from expected (byte-diff)`);
        assertTrue(out.yesterdayCalloutMd === "",
            `${label}: yesterdayCalloutMd should be empty when yesterday input is null`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-C5: composeMemoryCallouts null-data clean-omit (backward-compat)
{
    const label = "HC-V0850-C5 composeMemoryCallouts(null, null) returns empty strings";
    try {
        const helperPath = path.join(BP, "helpers/compose-memory-callouts.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMemoryCallouts } = require(helperPath);
        const out = composeMemoryCallouts(null, null);
        assertTrue(out.yesterdayCalloutMd === "", `${label}: yesterdayCalloutMd not empty on null input`);
        assertTrue(out.overnightCalloutMd === "", `${label}: overnightCalloutMd not empty on null input`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-D1: 3 engagement-types JSONs gain synthesize_week + version 0.5.0
{
    const label_root = "HC-V0850-D1 engagement-types schema v0.5.0 + synthesize_week";
    for (const type of ["personal", "w2-fte", "consulting"]) {
        const label = `${label_root}: ${type}.json`;
        try {
            const j = JSON.parse(fs.readFileSync(path.join(BP, `engagement-types/${type}.json`), "utf8"));
            assertTrue(j.version === "0.5.0", `${label}: version != 0.5.0 (got ${j.version})`);
            assertTrue(Array.isArray(j.supported_cadences) && j.supported_cadences.includes("synthesize_week"),
                `${label}: supported_cadences missing 'synthesize_week'`);
            assertTrue(j.default_cadences && j.default_cadences.synthesize_week === true,
                `${label}: default_cadences.synthesize_week !== true`);
            // Regression-protect: tick + synthesize_day still present per v0.84.0
            assertTrue(Array.isArray(j.supported_cadences) && j.supported_cadences.includes("tick") && j.supported_cadences.includes("synthesize_day"),
                `${label}: regressed v0.84.0 tick/synthesize_day`);
        } catch (e) {
            failed++; console.error(`FAIL  ${label}: ${e.message}`);
        }
    }
}

// HC-V0850-E1: cowork manifest declares synthesize-week + read-memory in claude_surface[] + cowork-weekly-synthesis rule_fragment
{
    const label = "HC-V0850-E1 cowork manifest claude_surface[] + cowork-weekly-synthesis rule_fragment";
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(BP, "manifest.json"), "utf8"));
        const sources = (manifest.claude_surface || [])
            .filter(e => e.kind === "skill")
            .map(e => e.source);
        assertTrue(sources.some(s => s.includes("orchestrators/synthesize-week/SKILL.md")),
            `${label}: claude_surface[] missing synthesize-week entry`);
        assertTrue(sources.some(s => s.includes("skills/read-memory/SKILL.md")),
            `${label}: claude_surface[] missing read-memory entry`);
        const wsFrag = (manifest.rule_fragments || []).find(rf => {
            const eq = rf.fragment && rf.fragment.required_frontmatter && rf.fragment.required_frontmatter.type && rf.fragment.required_frontmatter.type.equals;
            return eq === "cowork-weekly-synthesis";
        });
        assertTrue(!!wsFrag, `${label}: missing rule_fragment for cowork-weekly-synthesis`);
        assertTrue(wsFrag && wsFrag.fragment && /^\^synthesis\\?\.md\$$/.test(wsFrag.fragment.naming_pattern || ""),
            `${label}: rule_fragment naming_pattern must be '^synthesis\\.md$' (accepts escaped or unescaped period)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-E2: cowork-customization-contract.md STOCK table includes synthesis.md row
{
    const label = "HC-V0850-E2 cowork-customization-contract.md STOCK includes spice/cowork/memory/**/synthesis.md";
    try {
        const contract = fs.readFileSync(path.join(ROOT, "Docs/agent-guides/cowork-customization-contract.md"), "utf8");
        assertTrue(contract.includes("spice/cowork/memory/**/synthesis.md"),
            `${label}: customization contract missing 'spice/cowork/memory/**/synthesis.md' STOCK row`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0850-F1: onboard-scheduled-jobs cadence walk references synthesize-week
{
    const label = "HC-V0850-F1 onboard-scheduled-jobs cadence walk references synthesize-week + Friday cron";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
        assertTrue(/synthesize[-_]week/.test(skill),
            `${label}: missing synthesize-week reference`);
        assertTrue(/Friday|0 17 \* \* 5/.test(skill),
            `${label}: missing Friday cron default suggestion`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0851-B1: synthesize-week + onboard cadence walk default cron 30 17 (after synthesize-day)
{
    const label = "HC-V0851-B1 synthesize-week + onboard cadence walk Friday 17:30 default";
    try {
        const onboard = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
        const syn = fs.readFileSync(path.join(BP, "skills/orchestrators/synthesize-week/SKILL.md"), "utf8");

        // Onboard walk: must propose 30 17 NOT 0 17 for synthesize-week
        const wwIdx = onboard.indexOf("synthesize-week");
        assertTrue(wwIdx > 0, `${label}: onboard walk missing synthesize-week entry`);
        const wwBlock = onboard.slice(wwIdx, wwIdx + 1200);
        assertTrue(/30 17 \* \* 5/.test(wwBlock),
            `${label}: onboard cadence walk for synthesize-week missing '30 17 * * 5' cron`);
        assertTrue(!/`0 17 \* \* 5`/.test(wwBlock),
            `${label}: onboard cadence walk still has legacy '0 17 * * 5' default in synthesize-week block`);

        // synthesize-week SKILL.md schedule line
        assertTrue(/17:30/.test(syn) || /30 17 \* \* 5/.test(syn),
            `${label}: synthesize-week SKILL.md schedule line missing 17:30 default`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// v0.86.0 — cross-orchestrator memory wire-through (4 orchestrators × 4 groups)
// Mirrors v0.85.0 HC-V0850-C1/C2/C3 pattern. 4 helpers byte-identical to
// golden fixtures; 4 orchestrator SKILL.md edits add pre-flight 3a + body
// composition bullet referencing the per-orchestrator compose helper.
// ---------------------------------------------------------------------------

// HC-V0860-A1..A4: each orchestrator pre-flight step 3a invokes cowork:read-memory
{
    const cases = [
        { orch: "midday-tripwire", id: "A1", hint: "tier:\\s*\"tick\".*window:\\s*\"today\"" },
        { orch: "eod-review",      id: "A2", hint: "tier:\\s*\"day\"\\s*,\\s*window:\\s*\"today\"" },
        { orch: "weekly-review",   id: "A3", hint: "tier:\\s*\"week\"\\s*,\\s*window:\\s*\"this-week\"" },
        { orch: "monthly-review",  id: "A4", hint: "tier:\\s*\"week\"\\s*,\\s*window:\\s*\\{" }
    ];
    for (const c of cases) {
        const label = `HC-V0860-${c.id} ${c.orch} step 3a invokes cowork:read-memory`;
        try {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${c.orch}/SKILL.md`), "utf8");
            assertTrue(skill.includes("cowork:read-memory"),
                `${label}: step 3a doesn't reference cowork:read-memory sub-skill`);
            assertTrue(/3a\.\s+\*\*Read recent memory\.\*\*/.test(skill),
                `${label}: missing '3a. **Read recent memory.**' header marker`);
            const re = new RegExp(c.hint);
            assertTrue(re.test(skill),
                `${label}: step 3a doesn't invoke read-memory with the expected tier+window shape`);
        } catch (e) {
            failed++; console.error(`FAIL  ${label}: ${e.message}`);
        }
    }
}

// HC-V0860-B1..B4: each orchestrator body composition invokes per-orch compose helper
{
    const cases = [
        { orch: "midday-tripwire", id: "B1", helper: "composeMidamMemoryCallout" },
        { orch: "eod-review",      id: "B2", helper: "composeEodMemoryCallout" },
        { orch: "weekly-review",   id: "B3", helper: "composeWeeklyMemoryCallout" },
        { orch: "monthly-review",  id: "B4", helper: "composeMonthlyMemoryCallout" }
    ];
    for (const c of cases) {
        const label = `HC-V0860-${c.id} ${c.orch} body composition invokes ${c.helper}`;
        try {
            const skill = fs.readFileSync(path.join(BP, `skills/orchestrators/${c.orch}/SKILL.md`), "utf8");
            assertTrue(skill.includes(c.helper),
                `${label}: body composition doesn't reference ${c.helper} helper`);
            assertTrue(skill.includes("NEW (v0.86.0)"),
                `${label}: body composition missing 'NEW (v0.86.0)' marker bullet`);
        } catch (e) {
            failed++; console.error(`FAIL  ${label}: ${e.message}`);
        }
    }
}

// HC-V0860-C1: composeMidamMemoryCallout byte-identical to golden fixture
{
    const label = "HC-V0860-C1 composeMidamMemoryCallout: fixture matches expected output";
    try {
        const helperPath = path.join(BP, "helpers/compose-midam-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMidamMemoryCallout } = require(helperPath);
        const fixturePath = path.join(ROOT, "platform/test/fixtures/v0.86.0-midam-fixture.json");
        const expectedPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-midam-expected-callout.md");
        const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const expected = fs.readFileSync(expectedPath, "utf8");
        const out = composeMidamMemoryCallout(fixture);
        assertTrue(out === expected,
            `${label}: midam callout diverges from expected (byte-diff)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-C2: composeEodMemoryCallout byte-identical to dual golden fixtures
{
    const label = "HC-V0860-C2 composeEodMemoryCallout: dual fixtures match expected outputs";
    try {
        const helperPath = path.join(BP, "helpers/compose-eod-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeEodMemoryCallout } = require(helperPath);
        const ticksPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-eod-fixture.json");
        const dayPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-eod-day-fixture.json");
        const expTickPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-eod-expected-tick-callout.md");
        const expDayPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-eod-expected-pattern-callout.md");
        const ticks = JSON.parse(fs.readFileSync(ticksPath, "utf8"));
        const day = JSON.parse(fs.readFileSync(dayPath, "utf8"));
        const expTick = fs.readFileSync(expTickPath, "utf8");
        const expDay = fs.readFileSync(expDayPath, "utf8");
        const out = composeEodMemoryCallout(ticks, day);
        assertTrue(out.tickLogCalloutMd === expTick,
            `${label}: tickLogCalloutMd diverges from expected (byte-diff)`);
        assertTrue(out.dayPatternCalloutMd === expDay,
            `${label}: dayPatternCalloutMd diverges from expected (byte-diff)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-C3: composeWeeklyMemoryCallout byte-identical to golden fixture
{
    const label = "HC-V0860-C3 composeWeeklyMemoryCallout: fixture matches expected output";
    try {
        const helperPath = path.join(BP, "helpers/compose-weekly-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeWeeklyMemoryCallout } = require(helperPath);
        const fixturePath = path.join(ROOT, "platform/test/fixtures/v0.86.0-weekly-fixture.json");
        const expectedPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-weekly-expected-callout.md");
        const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const expected = fs.readFileSync(expectedPath, "utf8");
        const out = composeWeeklyMemoryCallout(fixture);
        assertTrue(out === expected,
            `${label}: weekly callout diverges from expected (byte-diff)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-C4: composeMonthlyMemoryCallout byte-identical to golden fixture
{
    const label = "HC-V0860-C4 composeMonthlyMemoryCallout: fixture matches expected output";
    try {
        const helperPath = path.join(BP, "helpers/compose-monthly-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMonthlyMemoryCallout } = require(helperPath);
        const fixturePath = path.join(ROOT, "platform/test/fixtures/v0.86.0-monthly-fixture.json");
        const expectedPath = path.join(ROOT, "platform/test/fixtures/v0.86.0-monthly-expected-callout.md");
        const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        const expected = fs.readFileSync(expectedPath, "utf8");
        const out = composeMonthlyMemoryCallout(fixture);
        assertTrue(out === expected,
            `${label}: monthly callout diverges from expected (byte-diff)`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-D1: composeMidamMemoryCallout(null) returns empty string (null-data clean-omit)
{
    const label = "HC-V0860-D1 composeMidamMemoryCallout(null) returns empty string";
    try {
        const helperPath = path.join(BP, "helpers/compose-midam-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMidamMemoryCallout } = require(helperPath);
        assertTrue(composeMidamMemoryCallout(null) === "",
            `${label}: did not return empty string on null input`);
        assertTrue(composeMidamMemoryCallout({ found: false }) === "",
            `${label}: did not return empty string on found:false input`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-D2: composeEodMemoryCallout(null, null) returns dual empty strings
{
    const label = "HC-V0860-D2 composeEodMemoryCallout(null, null) returns dual empty strings";
    try {
        const helperPath = path.join(BP, "helpers/compose-eod-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeEodMemoryCallout } = require(helperPath);
        const out = composeEodMemoryCallout(null, null);
        assertTrue(out.tickLogCalloutMd === "",
            `${label}: tickLogCalloutMd not empty on null input`);
        assertTrue(out.dayPatternCalloutMd === "",
            `${label}: dayPatternCalloutMd not empty on null input`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-D3: composeWeeklyMemoryCallout(null) returns empty string
{
    const label = "HC-V0860-D3 composeWeeklyMemoryCallout(null) returns empty string";
    try {
        const helperPath = path.join(BP, "helpers/compose-weekly-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeWeeklyMemoryCallout } = require(helperPath);
        assertTrue(composeWeeklyMemoryCallout(null) === "",
            `${label}: did not return empty string on null input`);
        assertTrue(composeWeeklyMemoryCallout({ found: false }) === "",
            `${label}: did not return empty string on found:false input`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0860-D4: composeMonthlyMemoryCallout(null) returns empty string
{
    const label = "HC-V0860-D4 composeMonthlyMemoryCallout(null) returns empty string";
    try {
        const helperPath = path.join(BP, "helpers/compose-monthly-memory-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeMonthlyMemoryCallout } = require(helperPath);
        assertTrue(composeMonthlyMemoryCallout(null) === "",
            `${label}: did not return empty string on null input`);
        assertTrue(composeMonthlyMemoryCallout({ found: false }) === "",
            `${label}: did not return empty string on found:false input`);
        assertTrue(composeMonthlyMemoryCallout({ found: true, week_syntheses: [] }) === "",
            `${label}: did not return empty string on empty week_syntheses input`);
    } catch (e) {
        failed++; console.error(`FAIL  ${label}: ${e.message}`);
    }
}

// HC-V0870-A1: gather-semantic-memory sub-skill SKILL.md exists at sub-skill-tier dest
{
    const label = "HC-V0870-A1 gather-semantic-memory/SKILL.md exists";
    try {
        const dest = path.join(BP, "skills/skills/gather-semantic-memory/SKILL.md");
        assertTrue(fs.existsSync(dest), `${label}: missing at ${dest}`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-A2: gather-semantic-memory SKILL.md declares required sections
{
    const label = "HC-V0870-A2 gather-semantic-memory required sections";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-semantic-memory/SKILL.md"), "utf8");
        for (const section of ["## Inputs", "## Pre-flight", "## Gather", "## Decide", "## Done", "## Harness testing"]) {
            assertTrue(skill.includes(section), `${label}: missing '${section}'`);
        }
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-A3: gather-semantic-memory declares structured-output fields
{
    const label = "HC-V0870-A3 gather-semantic-memory structured-output fields";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-semantic-memory/SKILL.md"), "utf8");
        for (const field of ["matches", "similarity_score", "synthesis_excerpt", "day_or_week", "tier"]) {
            assertTrue(skill.includes(field), `${label}: missing output field '${field}'`);
        }
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-A4: gather-semantic-memory declares graceful failure modes
{
    const label = "HC-V0870-A4 gather-semantic-memory graceful failure clause";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/skills/gather-semantic-memory/SKILL.md"), "utf8");
        assertTrue(skill.includes("sc_bridge_unavailable"),
            `${label}: missing sc_bridge_unavailable error code`);
        assertTrue(skill.includes("index_unavailable") || skill.includes("SC index"),
            `${label}: missing SC index unavailable failure mode`);
        assertTrue(/found:\s*false|null-data|graceful/i.test(skill),
            `${label}: missing graceful null-data clause`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-B1: composeSemanticEchoesCallout helper exists + exports correctly
{
    const label = "HC-V0870-B1 composeSemanticEchoesCallout helper exists + exports";
    try {
        const helperPath = path.join(BP, "helpers/compose-semantic-echoes-callout.js");
        assertTrue(fs.existsSync(helperPath), `${label}: helper missing`);
        delete require.cache[require.resolve(helperPath)];
        const { composeSemanticEchoesCallout } = require(helperPath);
        assertTrue(typeof composeSemanticEchoesCallout === "function",
            `${label}: composeSemanticEchoesCallout not exported as function`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-B2: composeSemanticEchoesCallout byte-identical to golden fixture
{
    const label = "HC-V0870-B2 composeSemanticEchoesCallout byte-identical";
    try {
        const helperPath = path.join(BP, "helpers/compose-semantic-echoes-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeSemanticEchoesCallout } = require(helperPath);
        const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/test/fixtures/v0.87.0-echoes-fixture.json"), "utf8"));
        const expected = fs.readFileSync(path.join(ROOT, "platform/test/fixtures/v0.87.0-echoes-expected-callout.md"), "utf8");
        const out = composeSemanticEchoesCallout(fixture);
        assertTrue(out === expected, `${label}: byte-diff vs expected`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-B3: composeSemanticEchoesCallout null-data clean-omit
{
    const label = "HC-V0870-B3 composeSemanticEchoesCallout null-data clean-omit";
    try {
        const helperPath = path.join(BP, "helpers/compose-semantic-echoes-callout.js");
        delete require.cache[require.resolve(helperPath)];
        const { composeSemanticEchoesCallout } = require(helperPath);
        assertTrue(composeSemanticEchoesCallout(null) === "",
            `${label}: null input non-empty`);
        assertTrue(composeSemanticEchoesCallout({ found: false }) === "",
            `${label}: found:false non-empty`);
        assertTrue(composeSemanticEchoesCallout({ found: true, matches: [] }) === "",
            `${label}: empty matches non-empty`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-C1: MB SKILL.md step 3b invokes cowork:gather-semantic-memory
{
    const label = "HC-V0870-C1 MB step 3b invokes cowork:gather-semantic-memory";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
        assertTrue(skill.includes("cowork:gather-semantic-memory"),
            `${label}: missing cowork:gather-semantic-memory invocation`);
        assertTrue(/3b\.\s+\*\*Gather semantic echoes\.\*\*/.test(skill),
            `${label}: missing step 3b 'Gather semantic echoes' header`);
        assertTrue(skill.includes("top_k: 2") || /top_k:\s*2/.test(skill),
            `${label}: missing top_k: 2 parameter`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-C2: MB SKILL.md body composition invokes composeSemanticEchoesCallout
{
    const label = "HC-V0870-C2 MB body composition invokes composeSemanticEchoesCallout";
    try {
        const skill = fs.readFileSync(path.join(BP, "skills/orchestrators/morning-briefing/SKILL.md"), "utf8");
        assertTrue(skill.includes("composeSemanticEchoesCallout"),
            `${label}: missing composeSemanticEchoesCallout invocation`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

// HC-V0870-D1: cowork manifest declares gather-semantic-memory claude_surface + helper files entry
{
    const label = "HC-V0870-D1 cowork manifest registers gather-semantic-memory + echoes helper";
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(BP, "manifest.json"), "utf8"));
        const skillSources = (manifest.claude_surface || []).filter(e => e.kind === "skill").map(e => e.source);
        assertTrue(skillSources.some(s => s.includes("skills/gather-semantic-memory/SKILL.md")),
            `${label}: claude_surface[] missing gather-semantic-memory entry`);
        const filesSources = (manifest.files || []).map(e => e.source);
        assertTrue(filesSources.some(s => s.includes("compose-semantic-echoes-callout.js")),
            `${label}: files[] missing compose-semantic-echoes-callout.js entry`);
    } catch (e) { failed++; console.error(`FAIL  ${label}: ${e.message}`); }
}

(function main() {
  console.log("--- shared contracts ---");
  checkSharedContracts();
  for (const fix of FIXTURES) checkFixture(fix);
  checkTimeframeContracts();
  assertCoworkV044Shape();
  assertCoworkV045Shape();
  assertCoworkV057Shape();
  assertCoworkV062Shape();
  assertCoworkV064NoDailyNote();
  assertCoworkV065Shape();
  assertCoworkV066Shape();
  assertCoworkV067Shape();
  assertCoworkV068Shape();
  console.log(`========\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
