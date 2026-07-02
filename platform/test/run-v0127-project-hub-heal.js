#!/usr/bin/env node
// run-v0127-project-hub-heal.js — v0.127.0 §D behavioral harness for
// applyProjectMeetingsPanelHeal in platform/install.js.
//
// Zero-dep. Requires install.js (gated by `require.main === module` so this
// require is side-effect-safe), pulls applyProjectMeetingsPanelHeal off the
// module.exports surface, exercises it against an in-memory adapter stub.
//
// Coverage (HC-V0127-PHH-*):
//   A — stale hub with ProjectStatusWidget → PMP inserted after status fence.
//   B — stale hub w/o ProjectStatusWidget but with ProjectNavButtons → fallback.
//   C — already-healed hub → second pass is a no-op.
//   D — hub with NO dataviewjs blocks → warning history, no write.
//   E — non-project hub (project-todo) under spice/projects/<x>/ untouched.
//   F — empty spice/projects/ → no error, no writes.
//
// Verdict: "PASS N/N" exit 0, "FAIL X/N" exit 1.

"use strict";

const path = require("path");

const install = require(path.join(__dirname, "..", "install.js"));
const { applyProjectMeetingsPanelHeal, applyProjectHubLegacyHeadingCleanup } = install;

if (typeof applyProjectMeetingsPanelHeal !== "function") {
  console.error("FATAL: applyProjectMeetingsPanelHeal not exported from install.js");
  process.exit(2);
}
if (typeof applyProjectHubLegacyHeadingCleanup !== "function") {
  console.error("FATAL: applyProjectHubLegacyHeadingCleanup not exported from install.js");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// In-memory adapter stub mimicking the subset of FileSystemAdapter used by
// applyProjectMeetingsPanelHeal: exists, list, read, write, mkdir.
// ---------------------------------------------------------------------------
function makeAdapter(initial) {
  const files = new Map(Object.entries(initial || {}));
  const dirs = new Set();
  for (const p of files.keys()) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    async exists(p) { return files.has(p) || dirs.has(p); },
    async list(p) {
      const folders = [];
      const filesAt = [];
      for (const d of dirs) {
        if (d === p) continue;
        if (d.startsWith(p + "/") && d.indexOf("/", p.length + 1) === -1) {
          folders.push(d);
        }
      }
      for (const f of files.keys()) {
        if (f.startsWith(p + "/") && f.indexOf("/", p.length + 1) === -1) {
          filesAt.push(f);
        }
      }
      return { folders, files: filesAt };
    },
    async read(p) {
      if (!files.has(p)) throw new Error("ENOENT: " + p);
      return files.get(p);
    },
    async write(p, body) {
      files.set(p, body);
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
    },
    async mkdir(p) {
      dirs.add(p);
    },
    _files: files,
    _dirs: dirs,
  };
}

function makeTp(adapter) {
  return { app: { vault: { adapter } } };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const STALE_HUB_WITH_STATUS_WIDGET = `---
type: project
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

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const STALE_HUB_NO_STATUS_WIDGET = `---
type: project
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

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const FRESH_HUB = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectMeetingsPanel" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

const NO_DATAVIEWJS_HUB = `---
type: project
---

# Plain project hub with no dataviewjs blocks at all.
Some narrative text.
`;

const NON_PROJECT_HUB = `---
type: project-todo
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
\`\`\`
`;

// Pre-v0.109.0 hub: literal `## Status` / `## Workstreams` H2s labelling their
// widget blocks (the case applyProjectHubLegacyHeadingCleanup heals).
const LEGACY_HUB_WITH_HEADINGS = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
\`\`\`

---

## Status

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectMeetingsPanel" });
\`\`\`

---

## Workstreams

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
\`\`\`
`;

// A `## Status` heading that is the user's OWN section (followed by prose, not
// the ProjectStatusWidget block) — the heal must NOT touch it even though a
// ProjectStatusWidget block exists elsewhere in the note.
const USER_AUTHORED_STATUS_HEADING = `---
type: project
---

\`\`\`dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
\`\`\`

## Status

My own status notes — not the widget label, keep this heading.
`;

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    const msg = `${label}${detail ? " — " + detail : ""}`;
    failures.push(msg);
    console.log(`  FAIL  ${msg}`);
  }
}

const GIT = { commit: null, tag: null, dirty: null };

async function run() {
  // Case A — stale hub with ProjectStatusWidget → PMP injected after status fence.
  {
    const adapter = makeAdapter({
      "spice/projects/databricks/Databricks.md": STALE_HUB_WITH_STATUS_WIDGET,
    });
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const result = await adapter.read("spice/projects/databricks/Databricks.md");
    ok(
      "HC-V0127-PHH-A.pmp-injected",
      result.includes('class: "ProjectMeetingsPanel"'),
      "PMP block missing after heal"
    );
    const statusIdx = result.indexOf("ProjectStatusWidget");
    const pmpIdx = result.indexOf("ProjectMeetingsPanel");
    const wsmIdx = result.indexOf("ProjectWorkstreamManager");
    ok(
      "HC-V0127-PHH-A.order",
      statusIdx > -1 && pmpIdx > -1 && wsmIdx > -1 && statusIdx < pmpIdx && pmpIdx < wsmIdx,
      `expected Status<PMP<Workstream, got status=${statusIdx} pmp=${pmpIdx} wsm=${wsmIdx}`
    );
    ok(
      "HC-V0127-PHH-A.history-healed",
      history.some(
        (h) => h.action === "healed" && h.target && h.target.includes("Databricks.md")
      ),
      "no healed history entry"
    );
  }

  // Case B — stale hub without ProjectStatusWidget but with ProjectNavButtons.
  {
    const adapter = makeAdapter({
      "spice/projects/oldproj/OldProj.md": STALE_HUB_NO_STATUS_WIDGET,
    });
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const result = await adapter.read("spice/projects/oldproj/OldProj.md");
    ok(
      "HC-V0127-PHH-B.pmp-injected",
      result.includes('class: "ProjectMeetingsPanel"'),
      "PMP block missing after heal"
    );
    const navIdx = result.indexOf("ProjectNavButtons");
    const pmpIdx = result.indexOf("ProjectMeetingsPanel");
    ok(
      "HC-V0127-PHH-B.order",
      navIdx > -1 && pmpIdx > -1 && navIdx < pmpIdx,
      `expected NavButtons<PMP, got nav=${navIdx} pmp=${pmpIdx}`
    );
  }

  // Case C — already-healed hub: second pass is a no-op.
  {
    const adapter = makeAdapter({
      "spice/projects/fresh/Fresh.md": FRESH_HUB,
    });
    const before = await adapter.read("spice/projects/fresh/Fresh.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/fresh/Fresh.md");
    ok(
      "HC-V0127-PHH-C.unchanged",
      before === after,
      "fresh hub was modified by heal"
    );
    ok(
      "HC-V0127-PHH-C.history-skipped",
      history.some((h) => h.action === "skipped_already_healed"),
      "no skipped_already_healed history entry"
    );
  }

  // Case D — no dataviewjs blocks: warning + no write.
  {
    const adapter = makeAdapter({
      "spice/projects/plain/Plain.md": NO_DATAVIEWJS_HUB,
    });
    const before = await adapter.read("spice/projects/plain/Plain.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/plain/Plain.md");
    ok(
      "HC-V0127-PHH-D.unchanged",
      before === after,
      "anchorless hub was modified"
    );
    ok(
      "HC-V0127-PHH-D.history-warning",
      history.some((h) => h.action === "no_anchor_found"),
      "no no_anchor_found warning recorded"
    );
  }

  // Case E — non-project file (type: project-todo) untouched.
  {
    const adapter = makeAdapter({
      "spice/projects/dbk/Databricks To-Do.md": NON_PROJECT_HUB,
    });
    const before = await adapter.read("spice/projects/dbk/Databricks To-Do.md");
    const history = [];
    await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    const after = await adapter.read("spice/projects/dbk/Databricks To-Do.md");
    ok(
      "HC-V0127-PHH-E.unchanged",
      before === after,
      "project-todo hub was modified"
    );
    ok(
      "HC-V0127-PHH-E.no-per-target-history",
      !history.some(
        (h) => h.target && h.target.includes("Databricks To-Do.md")
      ),
      "non-project file picked up a per-target history entry"
    );
  }

  // Case F — empty spice/projects/ runs without throwing.
  {
    const adapter = makeAdapter({});
    const history = [];
    let threw = false;
    try {
      await applyProjectMeetingsPanelHeal(makeTp(adapter), {}, {}, history, GIT);
    } catch (_e) {
      threw = true;
    }
    ok(
      "HC-V0127-PHH-F.no-throw",
      !threw,
      "empty spice/projects/ threw"
    );
  }

  // ----- applyProjectHubLegacyHeadingCleanup (HC-V0127-PHLH-*) -----

  // PHLH-A — legacy hub: both `## Status` and `## Workstreams` heading lines
  // removed; widget blocks preserved; .sauce-backup written; history healed.
  {
    const adapter = makeAdapter({
      "spice/projects/legacy/Legacy.md": LEGACY_HUB_WITH_HEADINGS,
    });
    const history = [];
    await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, history, GIT);
    const result = await adapter.read("spice/projects/legacy/Legacy.md");
    ok("HC-V0127-PHLH-A.status-heading-removed", !/^## Status\s*$/m.test(result),
      "## Status heading still present");
    ok("HC-V0127-PHLH-A.workstreams-heading-removed", !/^## Workstreams\s*$/m.test(result),
      "## Workstreams heading still present");
    ok("HC-V0127-PHLH-A.status-widget-preserved", result.includes('class: "ProjectStatusWidget"'),
      "ProjectStatusWidget block lost");
    ok("HC-V0127-PHLH-A.workstream-widget-preserved", result.includes('class: "ProjectWorkstreamManager"'),
      "ProjectWorkstreamManager block lost");
    ok("HC-V0127-PHLH-A.meetings-widget-preserved", result.includes('class: "ProjectMeetingsPanel"'),
      "ProjectMeetingsPanel block lost");
    ok("HC-V0127-PHLH-A.backup-written",
      [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("Legacy.md")),
      "no .sauce-backup snapshot written");
    ok("HC-V0127-PHLH-A.history-healed",
      history.some((h) => h.action === "healed" && h.target && h.target.includes("Legacy.md")),
      "no healed history entry");
  }

  // PHLH-B — idempotent: a second pass over the healed hub is a no-op.
  {
    const adapter = makeAdapter({
      "spice/projects/legacy2/Legacy2.md": LEGACY_HUB_WITH_HEADINGS,
    });
    await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, [], GIT);
    const afterFirst = await adapter.read("spice/projects/legacy2/Legacy2.md");
    await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, [], GIT);
    const afterSecond = await adapter.read("spice/projects/legacy2/Legacy2.md");
    ok("HC-V0127-PHLH-B.idempotent", afterFirst === afterSecond,
      "second pass changed the already-healed hub");
  }

  // PHLH-C — fresh (post-v0.109.0) hub with no legacy H2s: untouched.
  {
    const adapter = makeAdapter({
      "spice/projects/fresh3/Fresh3.md": FRESH_HUB,
    });
    const before = await adapter.read("spice/projects/fresh3/Fresh3.md");
    await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, [], GIT);
    const after = await adapter.read("spice/projects/fresh3/Fresh3.md");
    ok("HC-V0127-PHLH-C.unchanged", before === after, "fresh hub was modified");
  }

  // PHLH-D — user-authored `## Status` heading (not labelling the widget): kept.
  {
    const adapter = makeAdapter({
      "spice/projects/userstatus/UserStatus.md": USER_AUTHORED_STATUS_HEADING,
    });
    const before = await adapter.read("spice/projects/userstatus/UserStatus.md");
    await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, [], GIT);
    const after = await adapter.read("spice/projects/userstatus/UserStatus.md");
    ok("HC-V0127-PHLH-D.user-heading-preserved",
      after === before && /^## Status\s*$/m.test(after),
      "user-authored ## Status heading was stripped");
  }

  // PHLH-E — empty spice/projects/ runs without throwing.
  {
    const adapter = makeAdapter({});
    let threw = false;
    try { await applyProjectHubLegacyHeadingCleanup(makeTp(adapter), {}, {}, [], GIT); }
    catch (_e) { threw = true; }
    ok("HC-V0127-PHLH-E.no-throw", !threw, "empty spice/projects/ threw");
  }

  // ----- applyProjectNavButtonsSeparatorGap (NAV-SEP-*) -----
  // "Project Card Separator Fix" card: remove the stray blank line between the
  // ProjectNavButtons row and the `---` below it, on templates + existing notes.
  {
    const collapse = install._collapseNavButtonsSeparatorGap;
    const applyGap = install.applyProjectNavButtonsSeparatorGap;
    ok("NAV-SEP.exports", typeof collapse === "function" && typeof applyGap === "function",
      "install.js must export _collapseNavButtonsSeparatorGap + applyProjectNavButtonsSeparatorGap");

    const DVOPEN = "```dataviewjs";
    const FENCE = "```";
    const NAV = 'await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });';
    const SPACE = 'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });';
    const STATUS = 'await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });';

    const withGap = ["---", "type: project-card", "---", "", DVOPEN, SPACE, FENCE, "",
      DVOPEN, NAV, FENCE, "", "---", "body text", ""].join("\n");
    const collapsed = ["---", "type: project-card", "---", "", DVOPEN, SPACE, FENCE, "",
      DVOPEN, NAV, FENCE, "---", "body text", ""].join("\n");
    const twoBlanks = ["---", "x", "---", "", DVOPEN, NAV, FENCE, "", "", "---", "b", ""].join("\n");
    const twoBlanksFixed = ["---", "x", "---", "", DVOPEN, NAV, FENCE, "---", "b", ""].join("\n");
    // ProjectNavButtons NOT followed by `---` (followed by another widget) → untouched.
    const notSeparator = ["---", "x", "---", "", DVOPEN, NAV, FENCE, "", DVOPEN, STATUS, FENCE, ""].join("\n");

    // U1 — the stray blank between the ProjectNavButtons fence and `---` is removed.
    {
      const r = collapse(withGap);
      ok("NAV-SEP-U1 blank removed", r.changed === true && r.body === collapsed,
        "expected the single blank between the ProjectNavButtons fence and `---` to be dropped");
    }
    // U2 — idempotent: an already-collapsed body is unchanged.
    {
      const r = collapse(collapsed);
      ok("NAV-SEP-U2 idempotent", r.changed === false && r.body === collapsed,
        "second pass over collapsed body must be a no-op");
    }
    // U3 — multiple blank lines are all collapsed.
    {
      const r = collapse(twoBlanks);
      ok("NAV-SEP-U3 collapses multiple blanks", r.changed === true && r.body === twoBlanksFixed,
        "two blank lines before the `---` should all be removed");
    }
    // U4 — a ProjectNavButtons block NOT followed by `---` is left untouched.
    {
      const r = collapse(notSeparator);
      ok("NAV-SEP-U4 leaves non-separator blank alone", r.changed === false && r.body === notSeparator,
        "the blank before a following widget block (not `---`) must be preserved");
    }

    // I1 — integration: a nested card note is healed, backed up, and idempotent.
    {
      const notePath = "spice/projects/Demo/tasks/WS/board/Card/Card.md";
      const adapter = makeAdapter({ [notePath]: withGap });
      const history = [];
      await applyGap(makeTp(adapter), {}, {}, history, GIT);
      ok("NAV-SEP-I1a note healed", adapter._files.get(notePath) === collapsed,
        "nested card note should have the blank collapsed");
      const backedUp = Array.from(adapter._files.keys())
        .some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + notePath));
      ok("NAV-SEP-I1b backup written", backedUp, "a .sauce-backup snapshot of the pre-heal note must exist");
      const healEvent = history.some((h) => h.step === "project_nav_buttons_separator_gap" && h.action === "healed");
      ok("NAV-SEP-I1c heal history event", healEvent, "a healed history event must be recorded");
      // second pass = no-op
      await applyGap(makeTp(adapter), {}, {}, [], GIT);
      ok("NAV-SEP-I1d idempotent second pass", adapter._files.get(notePath) === collapsed,
        "second install pass must not re-touch the already-collapsed note");
    }
    // I2 — a note without ProjectNavButtons is untouched.
    {
      const other = "spice/projects/Demo/docs/plain.md";
      const body = ["---", "type: doc-note", "---", "", "just prose", "", "---", "more", ""].join("\n");
      const adapter = makeAdapter({ [other]: body });
      await applyGap(makeTp(adapter), {}, {}, [], GIT);
      ok("NAV-SEP-I2 non-navbuttons note untouched", adapter._files.get(other) === body,
        "notes without a ProjectNavButtons block must be left byte-identical");
    }
    // I3 — empty spice/projects runs without throwing.
    {
      const adapter = makeAdapter({});
      let threw = false;
      try { await applyGap(makeTp(adapter), {}, {}, [], GIT); } catch (_e) { threw = true; }
      ok("NAV-SEP-I3 no-throw on empty vault", !threw, "empty spice/projects/ must not throw");
    }

    // T1..T4 / T5..T8 (RETIRED — chrome overhaul 2026-07-02) — these asserted
    // that project templates (blueprint + installer-materialized ranch copies)
    // keep a literal `---` hugging the ProjectNavButtons fence. That grammar is
    // REVERSED by this cycle: helpers now own dividers (SectionLabel.divider)
    // and project templates carry NO literal chrome `---`. Coverage of "no
    // literal chrome `---` in project templates" now lives in
    // scripts/lint-note-chrome.js (Rule 4, project-scoped). The NAV-SEP-U*/I*
    // heal-function unit tests (below) remain valid — the
    // applyProjectNavButtonsSeparatorGap heal still collapses a stray blank
    // before a `---` on LEGACY notes that predate this overhaul.

    // U5 — a ProjectNavButtons fence followed by a blank then ordinary PROSE
    // (not `---`, not a widget block) is left untouched.
    {
      const prose = ["---", "x", "---", "", DVOPEN, NAV, FENCE, "", "just prose here", ""].join("\n");
      const r = collapse(prose);
      ok("NAV-SEP-U5 leaves blank-before-prose alone", r.changed === false && r.body === prose,
        "a blank before ordinary prose (not a `---` separator) must be preserved");
    }

  }

  // ----- Project hub Display tweaks (PHUB-*) -----
  {
    const strip = install._stripAllProjectsHeading;
    const applyHeal = install.applyProjectsHubAllProjectsHeadingCleanup;
    ok("PHUB.exports", typeof strip === "function" && typeof applyHeal === "function",
      "install must export _stripAllProjectsHeading + applyProjectsHubAllProjectsHeadingCleanup");

    const DVOPEN = "```dataviewjs";
    const FENCE = "```";
    const withH2 = ["---", "type: projects-hub", "---", "", DVOPEN, "x", FENCE, "", "---", "",
      "## All Projects", "", DVOPEN, "ProjectsHubCards", FENCE, ""].join("\n");
    const withoutH2 = ["---", "type: projects-hub", "---", "", DVOPEN, "x", FENCE, "", "---", "",
      DVOPEN, "ProjectsHubCards", FENCE, ""].join("\n");

    // U1 — removes the `## All Projects` heading + one trailing blank.
    {
      const r = strip(withH2);
      ok("PHUB-U1 removes ## All Projects", r.changed === true && r.body === withoutH2,
        "should drop the H2 line + one trailing blank");
    }
    // U2 — idempotent (no heading → no change).
    {
      const r = strip(withoutH2);
      ok("PHUB-U2 idempotent", r.changed === false && r.body === withoutH2, "no-op when the heading is absent");
    }
    // U3 — `## All Projects` inside a code fence is NOT stripped.
    {
      const fenced = ["---", "type: projects-hub", "---", "", DVOPEN, "## All Projects", FENCE, ""].join("\n");
      const r = strip(fenced);
      ok("PHUB-U3 leaves fenced text alone", r.changed === false && r.body === fenced,
        "a `## All Projects` line inside a code fence must be preserved");
    }
    // I1 — integration: the projects-hub note is healed + backed up + idempotent.
    {
      const p = "spice/projects/Projects.md";
      const adapter = makeAdapter({ [p]: withH2 });
      const history = [];
      await applyHeal(makeTp(adapter), {}, {}, history, GIT);
      ok("PHUB-I1a note healed", adapter._files.get(p) === withoutH2, "projects-hub note should lose the ## All Projects H2");
      const backedUp = Array.from(adapter._files.keys())
        .some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + p));
      ok("PHUB-I1b backup written", backedUp, "a .sauce-backup snapshot of the pre-heal note must exist");
      const healEvent = history.some((h) => h.step === "projects_hub_all_projects_heading_cleanup" && h.action === "healed");
      ok("PHUB-I1c heal history event", healEvent, "a healed history event must be recorded");
      await applyHeal(makeTp(adapter), {}, {}, [], GIT);
      ok("PHUB-I1d idempotent second pass", adapter._files.get(p) === withoutH2, "second install pass must be a no-op");
    }
    // I2 — a non-projects-hub note is untouched even if it contains the text.
    {
      const p = "spice/projects/Demo/Demo.md";
      const body = ["---", "type: project", "---", "", "## All Projects", "", "x", ""].join("\n");
      const adapter = makeAdapter({ [p]: body });
      await applyHeal(makeTp(adapter), {}, {}, [], GIT);
      ok("PHUB-I2 non-hub note untouched", adapter._files.get(p) === body,
        "only type:projects-hub notes are healed");
    }

    // Source lints — renderer + DocSearch opts + template.
    const fs = require("fs");
    const bpDir = path.join(__dirname, "..", "blueprints", "project");
    const phc = fs.readFileSync(path.join(bpDir, "helpers", "projects-hub-cards.js"), "utf8");
    const ds = fs.readFileSync(path.join(__dirname, "..", "mechanisms", "doc-search", "doc-search.js"), "utf8");
    const tpl = fs.readFileSync(path.join(bpDir, "content", "Projects.md"), "utf8");
    // WS1 chrome overhaul: the group-by selector + status/team/product chip bars
    // + recently-active strip were REMOVED. The hub is sorted, not grouped —
    // default sort is last-edited (mtime), toggled to alpha, persisted under
    // localStorage. PHUB-L1/L2 rewritten to lock the removal + the new sort.
    ok("PHUB-L1 group-by + recently-active + chip bars removed", !/_groupBy/.test(phc) && !/_renderGroupSelector/.test(phc) && !/_renderRecentStrip/.test(phc) && !/_renderChips/.test(phc),
      "projects hub must no longer carry group-by / recently-active / status-chip code paths");
    ok("PHUB-L2 no raw <h3> chrome + sort persisted to localStorage", !/createEl\("h3"/.test(phc) && /sauce\.projects-hub\.sort/.test(phc) && /_sortProjects/.test(phc),
      "hub must persist the sort mode (sauce.projects-hub.sort) and expose the pure _sortProjects, with no raw <h3> headers");
    ok("PHUB-L3 passes hideTags + persist:false to DocSearch", /hideTags:\s*true/.test(phc) && /persist:\s*false/.test(phc),
      "projects hub must pass hideTags:true + persist:false to DocSearch");
    ok("PHUB-L4 doc-search honors hideTags", /hideTags\s*=\s*opts\.hideTags\s*===\s*true/.test(ds) && /hideTags\s*\?\s*\{\}\s*:/.test(ds),
      "doc-search must gate the tag-chip pool on hideTags");
    ok("PHUB-L5 doc-search honors persist", /persist\s*=\s*opts\.persist\s*!==\s*false/.test(ds) && /if\s*\(!persist\)\s*return/.test(ds) && /if\s*\(persist\)\s*try/.test(ds),
      "doc-search must gate both save and restore on persist");
    ok("PHUB-L6 template has no ## All Projects H2", !/^##\s+All Projects\s*$/m.test(tpl),
      "the Projects.md template must not carry a `## All Projects` heading");
  }

  // ===== WS9 P0a — applyProjectChromeDividerHeal (CHR-DIV-*) =====
  // Strips legacy literal `---` chrome dividers BETWEEN consecutive customjs-guard
  // chrome blocks + collapses doubled blank gaps; preserves content-boundary `---`.
  {
    const strip = install._stripProjectChromeDividers;
    const applyHeal = install.applyProjectChromeDividerHeal;
    ok("CHR-DIV.exports", typeof strip === "function" && typeof applyHeal === "function",
      "install must export _stripProjectChromeDividers + applyProjectChromeDividerHeal");

    const G = (c) => '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + c + '" });\n```';

    // U1 — a `---` HUGGING a chrome fence, between two chrome blocks, is removed
    // (Project Map real shape: ProjectNavButtons```\n---\n\nProjectWorkstreams).
    {
      const map = ["---", "type: map", "---", "", G("SpaceNavButtons"), "", G("ProjectNavButtons"), "---", "", G("ProjectWorkstreams"), ""].join("\n");
      const r = strip(map);
      ok("CHR-DIV-U1 hugging chrome-chrome --- removed",
        r.changed === true && !/```\n---\n/.test(r.body) && r.body.includes('ProjectWorkstreams'),
        "the `---` hugging the ProjectNavButtons fence between two chrome blocks must be dropped");
    }
    // U2 — a blank-shielded `---` between two chrome blocks is removed (Links Hub).
    {
      const links = ["---", "type: links-hub", "---", "", G("ProjectNavButtons"), "", "---", "", G("ProjectLinksManager"), ""].join("\n");
      const want = ["---", "type: links-hub", "---", "", G("ProjectNavButtons"), "", G("ProjectLinksManager"), ""].join("\n");
      const r = strip(links);
      ok("CHR-DIV-U2 blank-shielded chrome-chrome --- removed",
        r.changed === true && r.body === want,
        "a blank-shielded `---` between two chrome blocks collapses to a single blank");
    }
    // U3 — a `---` between a chrome block and an `## H2` heading is PRESERVED
    // (Databricks hub `## Mentions` boundary — content divider, not chrome).
    {
      const hub = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", "---", "", "## Mentions", "", "body", ""].join("\n");
      const r = strip(hub);
      ok("CHR-DIV-U3 content-boundary --- preserved",
        r.changed === false && /```\n\n---\n\n## Mentions/.test(r.body),
        "a `---` between a chrome block and a `## H2` heading is a content boundary and must survive");
    }
    // U4 — a `---` between a chrome block and a user callout is PRESERVED.
    {
      const callout = ["---", "type: project", "---", "", G("BacklinkPanel"), "", "---", "", "> [!note] mine", ""].join("\n");
      const r = strip(callout);
      ok("CHR-DIV-U4 callout-boundary --- preserved",
        r.changed === false && r.body.includes("\n---\n\n> [!note]"),
        "a `---` before a user callout must survive");
    }
    // U5 — a trailing chrome `---` at EOF (orphaned chrome, Kanban Card) is removed.
    {
      const kanban = ["---", "type: task-hub", "---", "", G("ProjectNavButtons"), "", "---", ""].join("\n");
      const want = ["---", "type: task-hub", "---", "", G("ProjectNavButtons"), ""].join("\n");
      const r = strip(kanban);
      ok("CHR-DIV-U5 trailing chrome --- at EOF removed",
        r.changed === true && r.body === want,
        "a `---` after the last chrome block with no content below is orphaned chrome and must be dropped");
    }
    // U6 — an already-clean note (single-blank-separated chrome, no `---`) is a no-op.
    {
      const clean = ["---", "type: map", "---", "", G("SpaceNavButtons"), "", G("ProjectNavButtons"), ""].join("\n");
      const r = strip(clean);
      ok("CHR-DIV-U6 clean note untouched", r.changed === false && r.body === clean,
        "a note already using single-blank chrome separators must be left byte-identical");
    }
    // U7 — the leading frontmatter `---`/`---` YAML fence is NEVER touched.
    {
      const fmOnly = ["---", "type: project", "status: active", "---", "", G("SpaceNavButtons"), ""].join("\n");
      const r = strip(fmOnly);
      ok("CHR-DIV-U7 frontmatter fence untouched", r.changed === false && r.body === fmOnly,
        "the YAML frontmatter `---` fences must never be treated as chrome dividers");
    }
    // U8 — idempotent: a second pass over a healed body is a no-op.
    {
      const map = ["---", "type: map", "---", "", G("ProjectNavButtons"), "---", "", G("ProjectWorkstreams"), ""].join("\n");
      const once = strip(map);
      const twice = strip(once.body);
      ok("CHR-DIV-U8 idempotent", twice.changed === false && twice.body === once.body,
        "second pass over a healed body must be a no-op");
    }
    // I1 — integration: a nested map note is healed, backed up, idempotent; a
    // NON-project-type note in spice/projects is skipped.
    {
      const mapPath = "spice/projects/demo/Project Map.md";
      const mapBody = ["---", "type: map", "---", "", G("ProjectNavButtons"), "---", "", G("ProjectWorkstreams"), ""].join("\n");
      const alien = "spice/projects/demo/random.md";
      const alienBody = ["---", "type: something-else", "---", "", G("SpaceNavButtons"), "", "---", "", G("ProjectNavButtons"), ""].join("\n");
      const adapter = makeAdapter({ [mapPath]: mapBody, [alien]: alienBody });
      const history = [];
      await applyHeal(makeTp(adapter), {}, {}, history, GIT);
      const healedMap = adapter._files.get(mapPath);
      ok("CHR-DIV-I1a map healed", healedMap && !/```\n---\n/.test(healedMap),
        "the map note's hugging chrome `---` should be gone");
      ok("CHR-DIV-I1b alien type skipped", adapter._files.get(alien) === alienBody,
        "a note whose type is not in PROJECT_CHROME_TYPES must be left byte-identical");
      const backedUp = [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + mapPath));
      ok("CHR-DIV-I1c backup written", backedUp, "a .sauce-backup snapshot of the pre-heal map must exist");
      ok("CHR-DIV-I1d heal history event",
        history.some((h) => h.step === "project_chrome_divider_heal" && h.action === "healed"),
        "a healed history event must be recorded");
      const after1 = adapter._files.get(mapPath);
      await applyHeal(makeTp(adapter), {}, {}, [], GIT);
      ok("CHR-DIV-I1e idempotent second install", adapter._files.get(mapPath) === after1,
        "a second install pass must not re-touch the healed map");
    }
    // I2 — empty spice/projects/ runs without throwing.
    {
      const adapter = makeAdapter({});
      let threw = false;
      try { await applyHeal(makeTp(adapter), {}, {}, [], GIT); } catch (_e) { threw = true; }
      ok("CHR-DIV-I2 no-throw on empty vault", !threw, "empty spice/projects/ must not throw");
    }
  }

  // ===== WS9 P0b — applyBoardCardBreadcrumbHeal (BC-BC-*) =====
  // Stamps `type` + injects a leading Breadcrumb on promoted board-card notes
  // (basename === parent folder, under /tasks/).
  {
    const inject = install._injectBoardCardBreadcrumb;
    const applyHeal = install.applyBoardCardBreadcrumbHeal;
    ok("BC-BC.exports", typeof inject === "function" && typeof applyHeal === "function",
      "install must export _injectBoardCardBreadcrumb + applyBoardCardBreadcrumbHeal");

    const G = (c) => '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + c + '" });\n```';

    // U1 — real legacy card: FM without type, no breadcrumb, SpaceNavButtons first.
    {
      const legacy = ["---", "created_at: 2026-05-19", "tags:", "  - kanban-card", "status: completed", "---", "", G("SpaceNavButtons"), "", "---", "", G("ProjectNavButtons"), ""].join("\n");
      const r = inject(legacy, "task-hub");
      ok("BC-BC-U1a type: task-hub added as first FM line",
        r.changed === true && /^---\ntype: task-hub\ncreated_at:/.test(r.body),
        "`type: task-hub` must be inserted as the first frontmatter line");
      ok("BC-BC-U1b breadcrumb is the first rendered block",
        /^---[\s\S]*?\n---\n\n```dataviewjs\nawait dv\.view\("ranch\/views\/customjs-guard", \{ class: "Breadcrumb" \}\);/.test(r.body),
        "a Breadcrumb block must be the first rendered block");
      ok("BC-BC-U1c breadcrumb before nav",
        r.body.indexOf("Breadcrumb") < r.body.indexOf("SpaceNavButtons"),
        "the Breadcrumb must precede SpaceNavButtons");
    }
    // U2 — existing `type:` is NEVER overwritten.
    {
      const withType = ["---", "type: task-board-card", "created_at: x", "---", "", G("SpaceNavButtons"), ""].join("\n");
      const r = inject(withType, "task-hub");
      ok("BC-BC-U2 existing type preserved",
        !/type: task-hub/.test(r.body) && /type: task-board-card/.test(r.body) && /Breadcrumb/.test(r.body),
        "an existing frontmatter type must be preserved; only the breadcrumb is added");
    }
    // U3 — no frontmatter at all → a minimal FM block is created.
    {
      const noFm = [G("SpaceNavButtons"), "", "body"].join("\n");
      const r = inject(noFm, "task-hub");
      ok("BC-BC-U3 minimal FM created",
        r.changed === true && /^---\ntype: task-hub\n---/.test(r.body) && /Breadcrumb/.test(r.body),
        "a note with no frontmatter must gain a minimal `---\\ntype: task-hub\\n---` block");
    }
    // U4 — idempotent: breadcrumb + type already present → total no-op.
    {
      const done = ["---", "type: task-hub", "---", "", G("Breadcrumb"), "", G("SpaceNavButtons"), ""].join("\n");
      const r = inject(done, "task-hub");
      ok("BC-BC-U4 idempotent no-op", r.changed === false && r.body === done,
        "a note that already has a Breadcrumb + type must be untouched");
    }
    // U5 — breadcrumb present but no type → only the type is added (no 2nd breadcrumb).
    {
      const bcNoType = ["---", "created_at: x", "---", "", G("Breadcrumb"), "", G("SpaceNavButtons"), ""].join("\n");
      const r = inject(bcNoType, "task-hub");
      const bcCount = (r.body.match(/class: "Breadcrumb"/g) || []).length;
      ok("BC-BC-U5 adds type only when breadcrumb already present",
        r.changed === true && /type: task-hub/.test(r.body) && bcCount === 1,
        "the heal must add the type without injecting a second Breadcrumb");
    }
    // I1 — integration: only promoted board cards are healed; hubs/todos/leaf
    // notes are skipped; the deeper board/<Card>/<Card>.md gets task-board-card.
    {
      const legacyCard = ["---", "tags:", "  - kanban-card", "---", "", G("SpaceNavButtons"), "", "---", "", G("ProjectNavButtons"), ""].join("\n");
      const hub = ["---", "type: project", "---", "", G("SpaceNavButtons"), ""].join("\n");
      const todo = ["---", "type: project-todo", "---", "", G("SpaceNavButtons"), ""].join("\n");
      const adapter = makeAdapter({
        "spice/projects/demo/tasks/Foo/Foo.md": legacyCard,             // promoted → task-hub
        "spice/projects/demo/tasks/Foo/board/Bar/Bar.md": legacyCard,   // deeper   → task-board-card
        "spice/projects/demo/tasks/Foo/Notes.md": legacyCard,          // basename!==parent → skip
        "spice/projects/demo/Demo.md": hub,                            // hub → skip
        "spice/projects/demo/Demo To-Do.md": todo,                     // todo → skip
      });
      const history = [];
      await applyHeal(makeTp(adapter), {}, {}, history, GIT);
      const foo = adapter._files.get("spice/projects/demo/tasks/Foo/Foo.md");
      const bar = adapter._files.get("spice/projects/demo/tasks/Foo/board/Bar/Bar.md");
      ok("BC-BC-I1a promoted card → type:task-hub + Breadcrumb",
        /type: task-hub/.test(foo) && /class: "Breadcrumb"/.test(foo), "Foo.md must become a task-hub with a breadcrumb");
      ok("BC-BC-I1b deeper board card → type:task-board-card + Breadcrumb",
        /type: task-board-card/.test(bar) && /class: "Breadcrumb"/.test(bar), "board/Bar/Bar.md must become a task-board-card with a breadcrumb");
      ok("BC-BC-I1c non-promoted leaf note skipped",
        adapter._files.get("spice/projects/demo/tasks/Foo/Notes.md") === legacyCard, "Notes.md (basename != parent) must be untouched");
      ok("BC-BC-I1d hub skipped", adapter._files.get("spice/projects/demo/Demo.md") === hub, "the project hub must be untouched");
      ok("BC-BC-I1e todo skipped", adapter._files.get("spice/projects/demo/Demo To-Do.md") === todo, "the project to-do must be untouched");
      ok("BC-BC-I1f backup written",
        [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/Foo.md")),
        "a .sauce-backup snapshot of the pre-heal card must exist");
      ok("BC-BC-I1g heal history event",
        history.some((h) => h.step === "board_card_breadcrumb_heal" && h.action === "healed"), "a healed history event must be recorded");
      const fooAfter = adapter._files.get("spice/projects/demo/tasks/Foo/Foo.md");
      await applyHeal(makeTp(adapter), {}, {}, [], GIT);
      ok("BC-BC-I1h idempotent second install", adapter._files.get("spice/projects/demo/tasks/Foo/Foo.md") === fooAfter,
        "a second install pass must not re-touch the healed card");
    }
    // I2 — empty spice/projects/ runs without throwing.
    {
      const adapter = makeAdapter({});
      let threw = false;
      try { await applyHeal(makeTp(adapter), {}, {}, [], GIT); } catch (_e) { threw = true; }
      ok("BC-BC-I2 no-throw on empty vault", !threw, "empty spice/projects/ must not throw");
    }
  }

  // ===== WS9 P1 — applyProjectHubWorkstreamRemovalHeal (WSM-RM-*) =====
  // Removes the redundant ProjectWorkstreamManager block from existing type:project
  // hubs (workstream management now lives on the Map).
  {
    const remove = install._removeWorkstreamManagerBlock;
    const applyHeal = install.applyProjectHubWorkstreamRemovalHeal;
    ok("WSM-RM.exports", typeof remove === "function" && typeof applyHeal === "function",
      "install must export _removeWorkstreamManagerBlock + applyProjectHubWorkstreamRemovalHeal");

    const G = (c) => '```dataviewjs\nawait dv.view("ranch/views/customjs-guard", { class: "' + c + '" });\n```';

    // U1 — the whole ProjectWorkstreamManager fence is removed; gap collapses to
    // a single blank; no doubled blank remains (fresh v0.109 shape).
    {
      const fresh = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", G("ProjectWorkstreamManager"), "", G("ProjectLinksPanel"), ""].join("\n");
      const want = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", G("ProjectLinksPanel"), ""].join("\n");
      const r = remove(fresh);
      ok("WSM-RM-U1 block removed + gap collapsed",
        r.changed === true && r.body === want && !/ProjectWorkstreamManager/.test(r.body) && !/\n\n\n/.test(r.body),
        "the ProjectWorkstreamManager block must be removed and the gap collapsed to one blank");
    }
    // U2 — after a P0a pass on the Databricks shape, P1 removes the block and
    // preserves the `---` before `## Mentions`.
    {
      const hub = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", "---", "", G("ProjectWorkstreamManager"), "", "---", "", "## Mentions", "", "body", ""].join("\n");
      const afterP0a = install._stripProjectChromeDividers(hub).body;
      const r = remove(afterP0a);
      ok("WSM-RM-U2 P0a→P1 chain clean",
        r.changed === true && !/ProjectWorkstreamManager/.test(r.body) && /```\n\n---\n\n## Mentions/.test(r.body) && !/\n\n\n/.test(r.body),
        "after P0a strips chrome dividers, P1 must remove the WSM block yet keep the `## Mentions` content divider");
    }
    // U3 — no-op when the block is absent.
    {
      const noWsm = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", G("ProjectLinksPanel"), ""].join("\n");
      const r = remove(noWsm);
      ok("WSM-RM-U3 no-op when absent", r.changed === false && r.body === noWsm,
        "a hub without a ProjectWorkstreamManager block must be untouched");
    }
    // U4 — idempotent: a second pass over a healed body is a no-op.
    {
      const fresh = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", G("ProjectWorkstreamManager"), "", G("ProjectLinksPanel"), ""].join("\n");
      const once = remove(fresh);
      const twice = remove(once.body);
      ok("WSM-RM-U4 idempotent", twice.changed === false && twice.body === once.body,
        "second pass over a healed hub must be a no-op");
    }
    // I1 — integration: the type:project hub is healed, backed up, idempotent; a
    // non-hub note in the same project dir is skipped.
    {
      const hubPath = "spice/projects/demo/Demo.md";
      const hubBody = ["---", "type: project", "---", "", G("ProjectMeetingsPanel"), "", G("ProjectWorkstreamManager"), "", G("ProjectLinksPanel"), ""].join("\n");
      const mapPath = "spice/projects/demo/Project Map.md";
      const mapBody = ["---", "type: map", "---", "", G("ProjectNavButtons"), "", G("ProjectWorkstreamManager"), ""].join("\n");
      const adapter = makeAdapter({ [hubPath]: hubBody, [mapPath]: mapBody });
      const history = [];
      await applyHeal(makeTp(adapter), {}, {}, history, GIT);
      ok("WSM-RM-I1a hub block removed", !/ProjectWorkstreamManager/.test(adapter._files.get(hubPath)),
        "the type:project hub must lose its ProjectWorkstreamManager block");
      ok("WSM-RM-I1b map (type:map) untouched", adapter._files.get(mapPath) === mapBody,
        "the Map note keeps its ProjectWorkstreamManager block — only type:project hubs are healed");
      ok("WSM-RM-I1c backup written",
        [...adapter._files.keys()].some((k) => k.startsWith(".sauce-backup/") && k.endsWith("/" + hubPath)),
        "a .sauce-backup snapshot of the pre-heal hub must exist");
      ok("WSM-RM-I1d heal history event",
        history.some((h) => h.step === "project_hub_workstream_removal_heal" && h.action === "healed"),
        "a healed history event must be recorded");
      const hubAfter = adapter._files.get(hubPath);
      await applyHeal(makeTp(adapter), {}, {}, [], GIT);
      ok("WSM-RM-I1e idempotent second install", adapter._files.get(hubPath) === hubAfter,
        "a second install pass must not re-touch the healed hub");
    }
    // I2 — empty spice/projects/ runs without throwing.
    {
      const adapter = makeAdapter({});
      let threw = false;
      try { await applyHeal(makeTp(adapter), {}, {}, [], GIT); } catch (_e) { threw = true; }
      ok("WSM-RM-I2 no-throw on empty vault", !threw, "empty spice/projects/ must not throw");
    }
  }

  console.log("");
  if (fail === 0) {
    console.log(`PASS ${pass}/${pass + fail}`);
    process.exit(0);
  } else {
    console.log(`FAIL ${fail}/${pass + fail}`);
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("UNCAUGHT: " + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});
