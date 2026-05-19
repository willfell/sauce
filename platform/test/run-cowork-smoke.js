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
  assertTrue(skillSources.includes("skills/skills/write-callout-morning-briefing/SKILL.md"),
    "S1: manifest exposes write-callout-morning-briefing (merged form)");
  assertTrue(skillSources.includes("skills/skills/patch-daily-callouts/SKILL.md"),
    "S1: manifest exposes patch-daily-callouts");

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

  // S5 — merged write-callout-morning-briefing exposes all 3 per-type shape markers
  const wcb = readSkill("skills/skills/write-callout-morning-briefing/SKILL.md");
  assertContains(wcb, "### personal shape",   "S5: write-callout-morning-briefing has personal shape");
  assertContains(wcb, "### w2-fte shape",     "S5: write-callout-morning-briefing has w2-fte shape");
  assertContains(wcb, "### consulting shape", "S5: write-callout-morning-briefing has consulting shape");

  // S6 — orchestrator declares engagement_id intake
  const morning = readSkill("skills/orchestrators/morning-briefing/SKILL.md");
  assertContains(morning, "engagement_id: string", "S6: morning-briefing orchestrator declares engagement_id input");
  assertContains(morning, "cowork:write-callout-morning-briefing", "S6: morning-briefing dispatches merged write-callout");
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

  // S8 — patch-daily-callouts is engagement-aware
  const patch = readSkill("skills/skills/patch-daily-callouts/SKILL.md");
  assertContains(patch, "engagement_id: string", "S8: patch-daily-callouts declares engagement_id input");
  assertContains(patch, "## <Cadence> — <engagement.label>", "S8: patch-daily-callouts uses per-engagement H2 layout");
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

  // F4 — merged write-callout exposes the matching per-type shape
  const wcb = readSkill("skills/skills/write-callout-morning-briefing/SKILL.md");
  assertContains(wcb, fix.expected_shape_marker,
    `F4[${fix.engagement.type}]: write-callout exposes ${fix.expected_shape_marker}`);

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
  const dailyTemplatePath = path.join(cowork, "content/Daily Note.md");
  assertTrue(fs.existsSync(dailyTemplatePath), "v0.45.0: content/Daily Note.md exists");
  if (fs.existsSync(dailyTemplatePath)) {
    const body = fs.readFileSync(dailyTemplatePath, "utf8");
    assertContains(body, "type: cowork-daily", "v0.45.0: Daily Note template type=cowork-daily");
    assertContains(body, "SpaceNavButtons", "v0.45.0: Daily Note template has SpaceNavButtons");
    assertContains(body, "CoworkHubNav", "v0.45.0: Daily Note template has CoworkHubNav");
  }

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

  // --- Nav pattern on all 5 hubs + 3 templates ---
  const navPatternFiles = [
    "content/Cowork.md", "content/About Cowork.md", "content/Daily Hub.md",
    "content/Weekly Hub.md", "content/Monthly Hub.md",
    "content/Daily Note.md", "content/Weekly Note.md", "content/Monthly Note.md"
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

  // --- 3 note templates emit canonical created_at + drop discriminator tags ---
  const dailyTpl = fs.readFileSync(path.join(cowork, "content/Daily Note.md"), "utf8");
  assertContains(dailyTpl, "created_at:", "v0.57.0: Daily Note template emits created_at:");
  assertTrue(!/^created:\s/m.test(dailyTpl), "v0.57.0: Daily Note template drops legacy created:");
  assertContains(dailyTpl, "tags: [daily]", "v0.57.0: Daily Note template tags is [daily] (no cowork-daily)");

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

(function main() {
  console.log("--- shared contracts ---");
  checkSharedContracts();
  for (const fix of FIXTURES) checkFixture(fix);
  checkTimeframeContracts();
  assertCoworkV044Shape();
  assertCoworkV045Shape();
  assertCoworkV057Shape();
  assertCoworkV062Shape();
  console.log(`========\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
