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

  // S1 — orchestrator + key sub-skills present
  const skillSources = manifest.skills.map(s => s.source);
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
// Main
// -------------------------------------------------------------------------

(function main() {
  console.log("--- shared contracts ---");
  checkSharedContracts();
  for (const fix of FIXTURES) checkFixture(fix);
  console.log(`========\nResult: ${passed} passed, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
