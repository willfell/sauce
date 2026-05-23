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
  assertTrue(/^0\.(8|9|1\d)\.\d+$/.test(m.version), `v0.57.0: cowork manifest version >= 0.8.0 (got ${m.version})`);
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

  // V0750-VERSION: cowork blueprint version bumped to 0.15.0 (was 0.14.1 in v0.75.0; v0.76.0 S13 MINOR for context-builder + user-preferences).
  assertTrue(manifest.version === "0.15.0",
    `V0750-VERSION: cowork manifest.version === "0.15.0" (got ${JSON.stringify(manifest.version)})`);
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
// HC-V0750-C1..C3 — onboard-scheduled-jobs Step 2 workshop_manifest_path
// ---------------------------------------------------------------------------
{
  const onboard = fs.readFileSync(path.join(BP, "skills/orchestrators/onboard-scheduled-jobs/SKILL.md"), "utf8");
  assertContains(onboard, "workshop_manifest_path",               "HC-V0750-C1 Step 2 uses workshop_manifest_path");
  assertTrue(!onboard.includes("in-vault context can only reach"),
             "HC-V0750-C2 false-premise sentence removed");
  assertContains(onboard, "consumer wins on conflict",             "HC-V0750-C3 consumer-override merge semantics");
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
                detected_mcps: ["calendar", "gmail"],
                per_mcp_answers: {
                    calendar: { surface_event_kinds: ["conflicts", "focus-blocks"], include_all_day: false },
                    gmail: { inbox_zero_threshold: 5, surface_kinds: ["unanswered-24h"] },
                },
                priorities: ["calendar", "gmail"],
                personality: { vibe: "dry-and-factual", formality: "casual", pep_talk: false, length: "terse" },
            },
        });

        const prefsPath = path.join(vault, "spice", "cowork", "context", "user-preferences.md");
        assertTrue(fs.existsSync(prefsPath), `${label}: user-preferences.md was written`);

        const body = fs.readFileSync(prefsPath, "utf8");
        assertTrue(/type: cowork-user-preferences/.test(body), `${label}: frontmatter has type:`);
        assertTrue(/updated_by: cowork:context-builder/.test(body), `${label}: frontmatter updated_by:`);
        assertTrue(/mcps:\s*\n[\s\S]*calendar:/m.test(body), `${label}: mcps.calendar block`);
        assertTrue(/mcps:\s*\n[\s\S]*gmail:/m.test(body), `${label}: mcps.gmail block`);
        assertTrue(!/imessage:/.test(body), `${label}: imessage NOT present (not detected)`);
        assertTrue(/priorities:\s*\n\s*- calendar\s*\n\s*- gmail/.test(body), `${label}: priorities ordered`);
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
