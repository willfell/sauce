# Test Coverage Arc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit every sauce blueprint + mechanism for test coverage on a 6-axis scorecard, rank gaps by risk-weighted priority, then ship harnesses for the top 3 gaps. One long-lived feature branch in a dedicated worktree; one PR at arc close.

**Architecture:** Audit-first. A re-runnable Node.js script (`scripts/regen-coverage-matrix.js`) reads every blueprint + mechanism manifest, scores each on the 6 axes defined in the design doc, applies the risk-weighted prioritization formula, and writes a machine-readable matrix plus a human audit markdown. The audit ratifies the top-3 gaps; only then do impl cycles 1-3 brainstorm-plan-execute against those concrete picks. Phase boundaries are gated by handoff prompts so any session can resume cold.

**Tech Stack:** Node.js (zero-dep wherever possible — matches the workshop's existing scripts). Bash for git/preflight. Subagents (Explore + general-purpose) for the audit qualitative pass and the per-cycle implementation chunks. Existing harness archetypes: `run-helper-cases.js` (HC families) / `run-seed-migrations.js` (SEED-MIGRATE) / blueprint-specific behavioral runners / `run-renderer.js` (DOM-stub render) / `run-integration-smoke.js` / `run-cowork-smoke.js`.

**Design doc:** `Docs/plans/2026-06-16-test-coverage-arc-design.md` — read it before starting. The rubric, the gap→archetype tree, the prioritization formula, and the done criteria all live there. This plan implements those choices; it doesn't redefine them.

**Worktree:** `/Users/willfellhoelter/projects/repos/sauce-test-coverage` on branch `feature/test-coverage-arc`. Every Bash, Read, Write, Edit, git command MUST target this path. Never `cd` out. The main sauce checkout (`/Users/willfellhoelter/projects/repos/sauce`) is unrelated to this arc — it has its own in-flight v0.119.0 cycle work; leave it alone.

---

## Hard rules for every session in this arc

1. **Stay in the worktree.** All file ops absolute-pathed to `/Users/willfellhoelter/projects/repos/sauce-test-coverage/...`.
2. **No per-phase PRs.** One mega-PR at arc close. Commits accumulate on `feature/test-coverage-arc`.
3. **No consumer-vault deploys during the arc.** Brew + dogfood wait until merge.
4. **Re-read the design doc** before each impl cycle's brainstorm — the gap→archetype routing and rubric live there.
5. **Handoff prompts** at every phase boundary. Anything in your head between sessions goes there, not in chat.
6. **Subagent fan-out** for parallelizable work (per-blueprint audit qualitative pass; independent impl-step chunks). Sequential when stepwise.
7. **`npm run release:preflight` must pass** before any commit that adds/extends a harness. Per landmines/build-test-verify.
8. **No emojis** in any committed file (per user memory `feedback_no_emojis_use_icons.md`).
9. **No Claude Co-Authored-By trailer** in sauce commits (per user memory `feedback_no_claude_commit_trailer.md`).

---

## File Structure (what gets created/modified)

### Created in Phase 1 (audit)
- `scripts/regen-coverage-matrix.js` — re-runnable audit script
- `scripts/lib/coverage-rubric.js` — per-axis scorers, pure functions
- `platform/test/blast-radius-seed.json` — hand-curated tier per blueprint/mechanism
- `platform/test/coverage-matrix.json` — generated audit output
- `Docs/plans/2026-06-16-test-coverage-audit.md` — generated human audit
- `Docs/prompts/2026-06-16-post-audit-handoff.md` — handoff to impl-1

### Created in Phase 2-4 (per impl cycle, three times)
- `Docs/plans/2026-06-16-test-coverage-impl-{N}-design.md`
- `Docs/plans/2026-06-16-test-coverage-impl-{N}-plan.md`
- `Docs/plans/2026-06-16-test-coverage-impl-{N}-result.md`
- `Docs/prompts/2026-06-16-post-impl-{N}-handoff.md`
- New or extended harness file(s) per the archetype routed in the audit
- Possible seed-vault extensions (only if rank-N gap routes to `seed-migrate`)

### Created in Phase 5 (arc close)
- `Docs/plans/2026-06-16-test-coverage-arc-result.md`
- `Docs/prompts/2026-06-16-post-arc-handoff.md`
- One mega-PR on GitHub

### Touched (extended) anywhere
- `package.json` (`release:preflight` script gains new harness invocations as Phase 2-4 land)
- `platform/test/seed-vault/` (only if a rank-N gap routes to seed-migrate and adds pre-migration fixtures)

---

## Phase 0 — Setup (done in chat; documented here for resume-from-cold)

The conversation that authored this plan already:
1. Created the worktree: `git worktree add /Users/willfellhoelter/projects/repos/sauce-test-coverage -b feature/test-coverage-arc main`
2. Committed `Docs/plans/2026-06-16-test-coverage-arc-design.md` at `729d1f7`
3. Committed this plan.

### Task 0.1: Verify the worktree is in the expected state

**Files:** none (read-only checks)

- [ ] **Step 1: Confirm worktree exists and is checked out to the right branch**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage status
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --oneline -3
```

Expected: branch `feature/test-coverage-arc`; last commit is the plan commit (or the design commit `729d1f7`); working tree clean.

- [ ] **Step 2: Confirm the design doc is on disk**

Run:
```bash
ls -la /Users/willfellhoelter/projects/repos/sauce-test-coverage/Docs/plans/2026-06-16-test-coverage-arc-design.md
```

Expected: file exists, ~19 KB.

- [ ] **Step 3: Confirm npm scripts run from the worktree**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run status 2>&1 | head -20
```

Expected: workshop-status output with `workshop_version: 0.118.1` and a harness count of 32.

---

## Phase 1 — Audit

Build the coverage matrix. Then render the human audit. Then write the impl-1 handoff prompt.

### Task 1.1: Create the script skeleton

**Files:**
- Create: `scripts/regen-coverage-matrix.js`
- Create: `scripts/lib/coverage-rubric.js`

- [ ] **Step 1: Write the orchestrator skeleton**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/scripts/regen-coverage-matrix.js`:

```javascript
#!/usr/bin/env node
// scripts/regen-coverage-matrix.js
// Re-runnable audit script. Produces platform/test/coverage-matrix.json.
// See Docs/plans/2026-06-16-test-coverage-arc-design.md for the rubric.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BLUEPRINTS_DIR = path.join(REPO_ROOT, "platform", "blueprints");
const MECHANISMS_DIR = path.join(REPO_ROOT, "platform", "mechanisms");
const TEST_DIR = path.join(REPO_ROOT, "platform", "test");
const BLAST_RADIUS_SEED = path.join(TEST_DIR, "blast-radius-seed.json");
const OUT_JSON = path.join(TEST_DIR, "coverage-matrix.json");

const rubric = require("./lib/coverage-rubric.js");

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listSurfaces() {
    const blueprints = fs.readdirSync(BLUEPRINTS_DIR)
        .filter(n => fs.statSync(path.join(BLUEPRINTS_DIR, n)).isDirectory())
        .map(n => ({ kind: "blueprint", name: n, dir: path.join(BLUEPRINTS_DIR, n) }));
    const mechanisms = fs.readdirSync(MECHANISMS_DIR)
        .filter(n => fs.statSync(path.join(MECHANISMS_DIR, n)).isDirectory())
        .map(n => ({ kind: "mechanism", name: n, dir: path.join(MECHANISMS_DIR, n) }));
    return [...blueprints, ...mechanisms];
}

function readManifest(surface) {
    const p = path.join(surface.dir, "manifest.json");
    if (!fs.existsSync(p)) return null;
    return readJson(p);
}

function scoreSurface(surface, manifest, blastRadiusSeed) {
    const axes = {
        customjs_behavioral: rubric.scoreCustomJSBehavioral(surface, manifest, REPO_ROOT),
        installer_migration:  rubric.scoreInstallerMigration(surface, manifest, REPO_ROOT),
        manifest_schema:      rubric.scoreManifestSchema(surface, manifest, REPO_ROOT),
        template_lockstep:    rubric.scoreTemplateLockstep(surface, manifest, REPO_ROOT),
        widget_render:        rubric.scoreWidgetRender(surface, manifest, REPO_ROOT),
        integration_smoke:    rubric.scoreIntegrationSmoke(surface, manifest, REPO_ROOT)
    };
    const composite = rubric.composite(axes);
    const blastTier = blastRadiusSeed[surface.name] || { tier: "low", rationale: "unassigned" };
    return {
        kind: surface.kind,
        name: surface.name,
        current_version: manifest ? manifest.version : null,
        axes,
        composite_score: composite,
        blast_radius: blastTier.tier,
        blast_radius_rationale: blastTier.rationale,
        recent_incidents_30d: rubric.recentIncidents(surface.name, REPO_ROOT),
        priority_score: 0
    };
}

function applyPriority(entry) {
    const blastVal = { low: 0.3, med: 0.6, high: 1.0 }[entry.blast_radius] || 0.3;
    const incidentFactor = 1.0 + Math.min(1.0, entry.recent_incidents_30d * 0.2);
    let topGap = null, topGapScore = -1;
    for (const [axis, val] of Object.entries(entry.axes)) {
        if (val.score === null) continue;
        const debt = 1.0 - val.score;
        const axisWeight = rubric.axisWeight(axis);
        const score = blastVal * debt * incidentFactor * axisWeight;
        if (score > topGapScore) {
            topGapScore = score;
            topGap = { axis, score, archetype: val.suggested_archetype, target_file: val.suggested_target_file };
        }
    }
    entry.priority_score = topGapScore;
    entry.top_gap = topGap;
    return entry;
}

function main() {
    const blastRadiusSeed = fs.existsSync(BLAST_RADIUS_SEED)
        ? readJson(BLAST_RADIUS_SEED)
        : {};
    const surfaces = listSurfaces();
    const entries = surfaces
        .map(s => {
            const m = readManifest(s);
            if (!m) return null;
            return scoreSurface(s, m, blastRadiusSeed);
        })
        .filter(Boolean)
        .map(applyPriority)
        .sort((a, b) => b.priority_score - a.priority_score);

    const workshopVersion = readJson(path.join(REPO_ROOT, "package.json")).version;
    const out = {
        generated_at: workshopVersion,
        rubric_version: "1.0.0",
        entries
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");
    console.log(`Wrote ${OUT_JSON} — ${entries.length} surfaces scored.`);
    console.log(`Top 5 by priority_score:`);
    for (const e of entries.slice(0, 5)) {
        console.log(`  ${e.priority_score.toFixed(3)}  ${e.kind}/${e.name}  axis=${e.top_gap?.axis}  archetype=${e.top_gap?.archetype}`);
    }
}

main();
```

- [ ] **Step 2: Write the rubric library skeleton**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/scripts/lib/coverage-rubric.js`:

```javascript
// scripts/lib/coverage-rubric.js
// Per-axis scorers + composite + priority weights.
// All functions are PURE (no fs writes, no execSync that mutates).
// Each scorer returns { score: number|null, ...details, suggested_archetype, suggested_target_file }.

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function tryGrep(pattern, dir, opts = {}) {
    try {
        const flags = opts.flags || "-r -l";
        const out = execSync(`grep ${flags} ${JSON.stringify(pattern)} ${dir}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
        return out.trim().split("\n").filter(Boolean);
    } catch (e) {
        return [];
    }
}

function publicMethodsFromJsFile(jsPath) {
    if (!fs.existsSync(jsPath)) return [];
    const src = fs.readFileSync(jsPath, "utf8");
    // matches:  methodName(args) {   /  static methodName(args) {  /  async methodName(args) {
    const re = /^\s*(?:static\s+)?(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]*)\s*\(/gm;
    const out = new Set();
    let m;
    while ((m = re.exec(src)) !== null) {
        const name = m[1];
        if (name.startsWith("_")) continue;
        if (["constructor", "if", "for", "while", "switch", "catch", "function", "return"].includes(name)) continue;
        out.add(name);
    }
    return [...out];
}

function findClassFile(className, repoRoot, surface) {
    // search the surface's source dir + customjs scripts dirs
    const candidates = [
        path.join(surface.dir),
        path.join(repoRoot, "platform", "mechanisms"),
        path.join(repoRoot, "platform", "blueprints")
    ];
    for (const root of candidates) {
        if (!fs.existsSync(root)) continue;
        const hits = tryGrep(`^class ${className}\\b`, root, { flags: "-r -l -E" });
        if (hits.length > 0) return hits[0];
    }
    return null;
}

function scoreCustomJSBehavioral(surface, manifest, repoRoot) {
    const classes = manifest.customjs_classes || [];
    if (classes.length === 0) {
        return { score: null, reason: "no customjs_classes", suggested_archetype: null, suggested_target_file: null };
    }
    const testDir = path.join(repoRoot, "platform", "test");
    const methodCoverage = [];
    let total = 0, covered = 0;
    for (const cls of classes) {
        const clsFile = findClassFile(cls, repoRoot, surface);
        const methods = clsFile ? publicMethodsFromJsFile(clsFile) : [];
        for (const m of methods) {
            total++;
            const pattern = `${cls}\\.${m}\\b`;
            const hits = tryGrep(pattern, testDir, { flags: "-r -l -E" });
            const isCovered = hits.length > 0;
            if (isCovered) covered++;
            methodCoverage.push({ cls, method: m, covered: isCovered, hits: hits.length });
        }
    }
    const score = total === 0 ? null : covered / total;
    return {
        score,
        covered,
        total,
        methods: methodCoverage,
        suggested_archetype: "behavioral-runner",
        suggested_target_file: `platform/test/run-${surface.name}-${manifest.customjs_classes[0] ? manifest.customjs_classes[0].toLowerCase() : surface.name}.js`
    };
}

function scoreInstallerMigration(surface, manifest, repoRoot) {
    // Find `apply*` functions added to platform/install.js that mention this surface's name
    const installJs = path.join(repoRoot, "platform", "install.js");
    if (!fs.existsSync(installJs)) {
        return { score: null, reason: "no install.js", suggested_archetype: null, suggested_target_file: null };
    }
    const src = fs.readFileSync(installJs, "utf8");
    const fnRe = /^async function (apply[A-Za-z0-9_]+)/gm;
    const allFns = [];
    let m;
    while ((m = fnRe.exec(src)) !== null) allFns.push(m[1]);
    // Heuristic: a fn "belongs" to a surface if the fn name contains the surface name as a substring (case-insensitive),
    // OR the fn body references the surface's module_directory.
    const lcName = surface.name.toLowerCase();
    const moduleDir = manifest.module_directory || "";
    const ownFns = allFns.filter(fn => {
        if (fn.toLowerCase().includes(lcName.replace("-", ""))) return true;
        if (moduleDir && src.includes(`"${moduleDir}"`) && src.indexOf(`function ${fn}`) >= 0) {
            // weak signal; still include
            const i = src.indexOf(`async function ${fn}`);
            const next = src.indexOf("async function ", i + 1);
            const body = src.slice(i, next > 0 ? next : src.length);
            return body.includes(moduleDir);
        }
        return false;
    });
    if (ownFns.length === 0) {
        return {
            score: null,
            reason: "no install-time migrations attributed",
            migrations: [],
            suggested_archetype: null,
            suggested_target_file: null
        };
    }
    const seedHarness = path.join(repoRoot, "platform", "test", "run-seed-migrations.js");
    const seedSrc = fs.existsSync(seedHarness) ? fs.readFileSync(seedHarness, "utf8") : "";
    let covered = 0;
    const detail = ownFns.map(fn => {
        const isCovered = seedSrc.includes(fn);
        if (isCovered) covered++;
        return { fn, covered: isCovered };
    });
    return {
        score: covered / ownFns.length,
        covered,
        total: ownFns.length,
        migrations: detail,
        suggested_archetype: "seed-migrate",
        suggested_target_file: "platform/test/run-seed-migrations.js"
    };
}

function scoreManifestSchema(surface, manifest, repoRoot) {
    // Manifest fields we expect to be asserted somewhere:
    const expectedFields = ["name", "version", "customjs_classes", "files", "templates", "rule_fragments", "depends_on"];
    const testDir = path.join(repoRoot, "platform", "test");
    const hcSrc = fs.existsSync(path.join(testDir, "run-helper-cases.js"))
        ? fs.readFileSync(path.join(testDir, "run-helper-cases.js"), "utf8")
        : "";
    const lcName = surface.name.toLowerCase();
    // A field is "asserted" if the HC source mentions both the surface name and the field name within ~200 chars.
    let asserted = 0, applicable = 0;
    const fieldDetail = [];
    for (const f of expectedFields) {
        const presentInManifest = Object.prototype.hasOwnProperty.call(manifest, f);
        if (!presentInManifest) continue;
        applicable++;
        const re = new RegExp(`${lcName.replace(/[-]/g, "[- ]?")}[\\s\\S]{0,200}${f}|${f}[\\s\\S]{0,200}${lcName.replace(/[-]/g, "[- ]?")}`, "i");
        const isAsserted = re.test(hcSrc);
        if (isAsserted) asserted++;
        fieldDetail.push({ field: f, asserted: isAsserted });
    }
    const manifestRatio = applicable === 0 ? 1.0 : asserted / applicable;

    // Schema ownership: scan platform/schemas-index.json for entries owned by this surface.
    const schemaIdx = path.join(repoRoot, "platform", "schemas-index.json");
    let schemaOwned = 0, schemaCovered = 0;
    if (fs.existsSync(schemaIdx)) {
        const idx = JSON.parse(fs.readFileSync(schemaIdx, "utf8"));
        const entries = Array.isArray(idx.entries) ? idx.entries : (Array.isArray(idx) ? idx : []);
        for (const e of entries) {
            if ((e.owner || e.blueprint || e.mechanism || "") === surface.name) {
                schemaOwned++;
                // lint-schemas.js exercise = covered
                schemaCovered++;
            }
        }
    }
    const schemaRatio = schemaOwned === 0 ? 1.0 : schemaCovered / schemaOwned;
    const score = (manifestRatio + schemaRatio) / 2;
    return {
        score,
        manifest_ratio: manifestRatio,
        schema_ratio: schemaRatio,
        manifest_fields: fieldDetail,
        schema_owned: schemaOwned,
        suggested_archetype: "hc-family",
        suggested_target_file: "platform/test/run-helper-cases.js"
    };
}

function scoreTemplateLockstep(surface, manifest, repoRoot) {
    const files = manifest.files || [];
    const templates = files.filter(f => /templates_path|\/templates\//.test(f.dest || ""));
    const ruleFragments = manifest.rule_fragments || [];
    const total = templates.length + ruleFragments.length;
    if (total === 0) {
        return { score: null, reason: "no templates or rule_fragments", suggested_archetype: null, suggested_target_file: null };
    }
    const testDir = path.join(repoRoot, "platform", "test");
    let covered = 0;
    const detail = [];
    for (const t of templates) {
        const filename = (t.source || t.dest || "").split("/").pop();
        const hits = tryGrep(filename, testDir, { flags: "-r -l" });
        const isCovered = hits.length > 0;
        if (isCovered) covered++;
        detail.push({ kind: "template", name: filename, covered: isCovered });
    }
    for (const r of ruleFragments) {
        const target = r.target || "";
        const hits = target ? tryGrep(target, testDir, { flags: "-r -l" }) : [];
        const isCovered = hits.length > 0;
        if (isCovered) covered++;
        detail.push({ kind: "rule_fragment", name: target, covered: isCovered });
    }
    return {
        score: covered / total,
        covered,
        total,
        items: detail,
        suggested_archetype: "template-assert",
        suggested_target_file: "platform/test/run-helper-cases.js"
    };
}

function scoreWidgetRender(surface, manifest, repoRoot) {
    const classes = manifest.customjs_classes || [];
    if (classes.length === 0) {
        return { score: null, reason: "no customjs_classes", suggested_archetype: null, suggested_target_file: null };
    }
    const widgets = [];
    for (const cls of classes) {
        const f = findClassFile(cls, repoRoot, surface);
        if (!f) continue;
        const src = fs.readFileSync(f, "utf8");
        if (/\brender\s*\(/.test(src)) widgets.push(cls);
    }
    if (widgets.length === 0) {
        return { score: null, reason: "no render() widgets", suggested_archetype: null, suggested_target_file: null };
    }
    const rendererSrc = fs.existsSync(path.join(repoRoot, "platform", "test", "run-renderer.js"))
        ? fs.readFileSync(path.join(repoRoot, "platform", "test", "run-renderer.js"), "utf8")
        : "";
    let covered = 0;
    const detail = widgets.map(w => {
        const isCovered = rendererSrc.includes(w);
        if (isCovered) covered++;
        return { widget: w, covered: isCovered };
    });
    return {
        score: covered / widgets.length,
        covered,
        total: widgets.length,
        widgets: detail,
        suggested_archetype: "renderer-extend",
        suggested_target_file: "platform/test/run-renderer.js"
    };
}

function scoreIntegrationSmoke(surface, manifest, repoRoot) {
    // Heuristic: a blueprint has integration_smoke coverage if any test file in platform/test/
    // mentions the surface name AND contains an end-to-end pattern (install or seed-vault or smoke).
    const testDir = path.join(repoRoot, "platform", "test");
    const candidates = fs.readdirSync(testDir).filter(f => f.startsWith("run-") && f.endsWith(".js"));
    const lcName = surface.name.toLowerCase();
    let happyPath = false, failureMode = false;
    for (const c of candidates) {
        const src = fs.readFileSync(path.join(testDir, c), "utf8");
        if (!src.toLowerCase().includes(lcName)) continue;
        if (/smoke|integration|end-?to-?end|seed/i.test(c)) happyPath = true;
        if (/error|failure|throw|reject|fail/i.test(src) && src.toLowerCase().includes(lcName)) failureMode = true;
    }
    const score = !happyPath ? 0.0 : (failureMode ? 1.0 : 0.5);
    return {
        score,
        happy_path: happyPath,
        failure_mode: failureMode,
        suggested_archetype: happyPath ? "smoke-extend" : "behavioral-runner",
        suggested_target_file: "platform/test/run-integration-smoke.js"
    };
}

function composite(axes) {
    const vals = Object.values(axes).map(a => a.score).filter(v => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function axisWeight(name) {
    return {
        installer_migration: 1.0,
        customjs_behavioral: 1.0,
        template_lockstep: 1.0,
        integration_smoke: 0.75,
        widget_render: 0.75,
        manifest_schema: 0.5
    }[name] || 0.75;
}

function recentIncidents(name, repoRoot) {
    // Count PATCH (X.Y.Z where Z > 0) commits in last 30 days that mention this surface name in the subject.
    try {
        const since = "30 days ago";
        const out = execSync(
            `git -C ${JSON.stringify(repoRoot)} log --since=${JSON.stringify(since)} --pretty=format:%s`,
            { encoding: "utf8" }
        );
        const lines = out.split("\n").filter(Boolean);
        const lcName = name.toLowerCase();
        return lines.filter(l => {
            const lc = l.toLowerCase();
            if (!lc.includes(lcName)) return false;
            return /v?\d+\.\d+\.[1-9]\d*/.test(l);
        }).length;
    } catch (e) {
        return 0;
    }
}

module.exports = {
    scoreCustomJSBehavioral,
    scoreInstallerMigration,
    scoreManifestSchema,
    scoreTemplateLockstep,
    scoreWidgetRender,
    scoreIntegrationSmoke,
    composite,
    axisWeight,
    recentIncidents
};
```

- [ ] **Step 3: Commit the skeleton**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add scripts/regen-coverage-matrix.js scripts/lib/coverage-rubric.js
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "feat(audit): coverage-matrix script + rubric library skeleton

Re-runnable Node.js audit: enumerates blueprints + mechanisms,
scores each on 6 axes per arc-design.md, applies risk-weighted priority,
writes coverage-matrix.json. Rubric library is pure functions per axis."
```

### Task 1.2: Seed the blast_radius tiers

**Files:**
- Create: `platform/test/blast-radius-seed.json`

- [ ] **Step 1: Write the seed file**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/blast-radius-seed.json`:

```json
{
  "boards":                 { "tier": "low",  "rationale": "Single consumer uses kanban occasionally; one external plugin coupling." },
  "cowork":                 { "tier": "high", "rationale": "Active arc with cross-machine state; recent migrations every cycle." },
  "daily":                  { "tier": "high", "rationale": "Every consumer hits daily notes; touched by carryover + recurring." },
  "finance":                { "tier": "high", "rationale": "v0.108-v0.115 rapid evolution; load-bearing schemas + measured-debt math." },
  "journal":                { "tier": "med",  "rationale": "Used by both consumers; relatively static lately." },
  "meetings":               { "tier": "high", "rationale": "Linked from project + cowork; recent project-link migration." },
  "people":                 { "tier": "med",  "rationale": "Cross-cutting via people-identity; stable shape." },
  "products":               { "tier": "med",  "rationale": "Consumer-vault hub; relatively static." },
  "project":                { "tier": "high", "rationale": "Docs hub + sections + section hubs + search arc; load-bearing." },
  "scratch":                { "tier": "high", "rationale": "Daily hits; carries todo capture surface." },
  "teams":                  { "tier": "low",  "rationale": "Not in active use by either consumer vault." },
  "to-do":                  { "tier": "high", "rationale": "Multi-cycle storm v0.116-v0.118; highest recent-incident rate." },
  "trips":                  { "tier": "low",  "rationale": "Niche use; rare touches." },
  "accent-button":          { "tier": "low",  "rationale": "Trivial wrapper; v0.88 bug already netted." },
  "activity-feed":          { "tier": "med",  "rationale": "Hub embed; visible on hubs widely." },
  "audit":                  { "tier": "high", "rationale": "Self-grading harness; touched by every install." },
  "backlink-panel":         { "tier": "med",  "rationale": "Visible on every project + meeting." },
  "cards":                  { "tier": "low",  "rationale": "Pure renderer primitive." },
  "convenience":            { "tier": "low",  "rationale": "Misc plugin install; rare edits." },
  "cowork-reconciler":      { "tier": "high", "rationale": "Runs nightly via cron; v0.98+ ingest path." },
  "customjs-guard":         { "tier": "low",  "rationale": "Pure-fn guard utility; stable." },
  "entity-create":          { "tier": "high", "rationale": "Every + New button uses it; v0.94 + v0.102 + v0.108 evolution." },
  "icons":                  { "tier": "low",  "rationale": "Static glyph map; rare touches." },
  "kanban-status-sync":     { "tier": "low",  "rationale": "Boards-coupled; low traffic." },
  "nav-buttons":            { "tier": "med",  "rationale": "Visible on every hub + entity." },
  "people-identity":        { "tier": "low",  "rationale": "Stable resolver; rare edits." },
  "people-rendering":       { "tier": "low",  "rationale": "Pure widget; stable." },
  "platform-claude":        { "tier": "high", "rationale": "Owns CLAUDE.md + claude_surface[]; touched every cycle close." },
  "smart-connections-bridge": { "tier": "med", "rationale": "Cowork-adjacent embedding bridge; opt-in." },
  "styling":                { "tier": "low",  "rationale": "CSS surface; visual only." },
  "validator":              { "tier": "high", "rationale": "Front-line schema gate; touched by every blueprint change." }
}
```

- [ ] **Step 2: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/blast-radius-seed.json
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "feat(audit): blast-radius tier seed with per-surface rationale"
```

### Task 1.3: Run the script + sanity-check the output

**Files:** none (read script output only)

- [ ] **Step 1: Run the script**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/regen-coverage-matrix.js
```

Expected: prints `Wrote .../coverage-matrix.json — N surfaces scored.` where `N` is `13 blueprints + 18 mechanisms = 31`. Prints a "Top 5 by priority_score" block.

- [ ] **Step 2: Spot-check the JSON shape**

Run:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); console.log("entries:", m.entries.length); console.log("first entry:", JSON.stringify(m.entries[0], null, 2).slice(0, 800));'
```

Expected: 31 entries; first entry (highest priority) has all 6 axes populated, a `composite_score`, a `priority_score`, and a `top_gap` object with `axis` + `archetype` + `target_file`.

- [ ] **Step 3: Sanity-check known-coverage surfaces**

Run:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); const todo = m.entries.find(e => e.name === "to-do"); console.log("to-do composite:", todo.composite_score); console.log("to-do customjs:", todo.axes.customjs_behavioral.score);'
```

Expected: to-do composite_score is reasonably high (≥ 0.4 — it has 5 dedicated harnesses); the audit should not claim to-do is uncovered.

If the script attributes near-zero coverage to a well-covered surface like to-do, the heuristics need debugging — pause and investigate before continuing.

### Task 1.4: Qualitative subagent pass (parallel fan-out)

**Files:**
- Modify: `platform/test/coverage-matrix.json` (per-entry qualitative_notes added)

The deterministic scorer is grep-driven and can over- or under-count. A subagent pass adds judgment.

- [ ] **Step 1: Read the current matrix to get the entry list**

Run:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); console.log(m.entries.map(e => e.kind + "/" + e.name).join("\\n"));'
```

Expected: list of 31 surfaces.

- [ ] **Step 2: Fan out Explore subagents in parallel — one per surface**

Send ONE message containing 31 `Agent` tool uses (one per surface) so they run concurrently. Each agent uses `subagent_type: "Explore"` and gets a self-contained prompt:

```
Sauce repo at /Users/willfellhoelter/projects/repos/sauce-test-coverage. Branch feature/test-coverage-arc.

I'm auditing test coverage for the {KIND} `{NAME}`. The deterministic scorer in scripts/lib/coverage-rubric.js produced these scores:
- customjs_behavioral: {SCORE} (covered {COVERED}/{TOTAL} methods)
- installer_migration: {SCORE} (covered {COVERED}/{TOTAL} migrations)
- manifest_schema: {SCORE}
- template_lockstep: {SCORE} (covered {COVERED}/{TOTAL} items)
- widget_render: {SCORE} (covered {COVERED}/{TOTAL} widgets)
- integration_smoke: {SCORE}

Your job: validate the scores by reading the actual blueprint at platform/{KIND-PLURAL}/{NAME}/ (manifest.json + class files + templates) and the actual test files under platform/test/. Spot any false positives (the grep found a class name in a comment, not a real assert) or false negatives (the method is exercised by a runner whose name doesn't match the pattern).

Return ONLY a JSON object:
{
  "name": "{NAME}",
  "kind": "{KIND}",
  "validates_scores": "yes" | "no",
  "false_positives": [{"axis":"...","note":"..."}],
  "false_negatives": [{"axis":"...","note":"..."}],
  "primary_user_flow": "<one-sentence description of the primary flow for Axis 6>",
  "qualitative_recommendation": "<one paragraph: what test would most reduce this surface's risk>"
}

Keep your search bounded — do not explore beyond the surface's source dir and platform/test/. Read no more than 8 files.
```

Run all 31 in parallel. Each returns a JSON object.

- [ ] **Step 3: Patch the matrix with qualitative notes**

Write a small inline script that reads the 31 subagent outputs and merges them into the matrix:

```javascript
// inline; one-off
const fs = require("fs");
const matrixPath = "/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json";
const m = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
const notes = /* paste an object keyed by `${kind}/${name}` with the 31 subagent results */ {};
for (const entry of m.entries) {
    const key = `${entry.kind}/${entry.name}`;
    const note = notes[key];
    if (!note) continue;
    entry.qualitative = {
        validates_scores: note.validates_scores,
        false_positives: note.false_positives || [],
        false_negatives: note.false_negatives || [],
        primary_user_flow: note.primary_user_flow,
        recommendation: note.qualitative_recommendation
    };
}
fs.writeFileSync(matrixPath, JSON.stringify(m, null, 2) + "\n");
console.log("Patched.");
```

Run the snippet, verify the file updates, then DELETE the snippet file (it's one-off).

- [ ] **Step 4: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/coverage-matrix.json
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(qual): subagent qualitative pass on 31 surfaces

Validates the deterministic scorer's per-axis output; surfaces false
positives + false negatives; identifies the primary user flow per
blueprint for Axis 6 grounding."
```

### Task 1.5: Render the human audit markdown

**Files:**
- Create: `scripts/render-coverage-audit.js`
- Create: `Docs/plans/2026-06-16-test-coverage-audit.md`

- [ ] **Step 1: Write the renderer script**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/scripts/render-coverage-audit.js`:

```javascript
#!/usr/bin/env node
// scripts/render-coverage-audit.js
// Reads platform/test/coverage-matrix.json, writes Docs/plans/2026-06-16-test-coverage-audit.md.

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const IN = path.join(REPO_ROOT, "platform", "test", "coverage-matrix.json");
const OUT = path.join(REPO_ROOT, "Docs", "plans", "2026-06-16-test-coverage-audit.md");

function fmt(n) { return n === null || n === undefined ? "—" : n.toFixed(2); }

function renderAxisCell(axis) {
    if (axis.score === null) return "n/a";
    const covered = axis.covered ?? "";
    const total = axis.total ?? "";
    if (typeof covered === "number" && typeof total === "number") {
        return `${fmt(axis.score)} (${covered}/${total})`;
    }
    return fmt(axis.score);
}

function main() {
    const m = JSON.parse(fs.readFileSync(IN, "utf8"));
    const lines = [];
    lines.push("---");
    lines.push("arc: test-coverage-arc");
    lines.push("phase: audit");
    lines.push(`generated_against_workshop_version: ${m.generated_at}`);
    lines.push(`rubric_version: ${m.rubric_version}`);
    lines.push("---");
    lines.push("");
    lines.push("# Test coverage audit");
    lines.push("");
    lines.push("Coverage matrix for all 13 blueprints + 18 mechanisms scored against the 6-axis rubric in `Docs/plans/2026-06-16-test-coverage-arc-design.md`. Ranked queue at the bottom drives impl-1/2/3 selection.");
    lines.push("");
    lines.push("## Composite scorecard");
    lines.push("");
    lines.push("| Kind | Name | v | CustomJS | Migration | Manifest+Schema | Template | Widget | Smoke | Composite | Blast | Incidents 30d | Priority |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const e of m.entries) {
        lines.push([
            "", e.kind, e.name, e.current_version || "",
            renderAxisCell(e.axes.customjs_behavioral),
            renderAxisCell(e.axes.installer_migration),
            renderAxisCell(e.axes.manifest_schema),
            renderAxisCell(e.axes.template_lockstep),
            renderAxisCell(e.axes.widget_render),
            renderAxisCell(e.axes.integration_smoke),
            fmt(e.composite_score),
            e.blast_radius,
            e.recent_incidents_30d,
            fmt(e.priority_score),
            ""
        ].join(" | "));
    }
    lines.push("");
    lines.push("## Per-surface deep dive");
    lines.push("");
    for (const e of m.entries) {
        lines.push(`### ${e.kind}/${e.name} (v${e.current_version || "?"})`);
        lines.push(`- Blast radius: **${e.blast_radius}** — ${e.blast_radius_rationale}`);
        lines.push(`- Composite: **${fmt(e.composite_score)}** · Priority: **${fmt(e.priority_score)}** · Incidents 30d: ${e.recent_incidents_30d}`);
        if (e.qualitative) {
            lines.push(`- Primary flow (Axis 6 grounding): ${e.qualitative.primary_user_flow || "—"}`);
            lines.push(`- Qualitative recommendation: ${e.qualitative.recommendation || "—"}`);
            if ((e.qualitative.false_positives || []).length > 0) {
                lines.push(`- False positives: ${e.qualitative.false_positives.map(f => `${f.axis}: ${f.note}`).join("; ")}`);
            }
            if ((e.qualitative.false_negatives || []).length > 0) {
                lines.push(`- False negatives: ${e.qualitative.false_negatives.map(f => `${f.axis}: ${f.note}`).join("; ")}`);
            }
        }
        if (e.top_gap) {
            lines.push(`- Top gap: axis=\`${e.top_gap.axis}\` archetype=\`${e.top_gap.archetype}\` target=\`${e.top_gap.target_file}\``);
        }
        lines.push("");
    }
    lines.push("## Ranked queue (top 10)");
    lines.push("");
    lines.push("| Rank | Surface | Axis | Archetype | Target file | Priority |");
    lines.push("|---|---|---|---|---|---|");
    for (let i = 0; i < Math.min(10, m.entries.length); i++) {
        const e = m.entries[i];
        if (!e.top_gap) continue;
        lines.push(`| ${i+1} | ${e.kind}/${e.name} | ${e.top_gap.axis} | ${e.top_gap.archetype} | ${e.top_gap.target_file} | ${fmt(e.priority_score)} |`);
    }
    lines.push("");
    lines.push("## Picks for this arc");
    lines.push("");
    lines.push("- **impl-1**: rank-1 above");
    lines.push("- **impl-2**: rank-2 above");
    lines.push("- **impl-3**: rank-3 above");
    lines.push("");
    lines.push("If two ranks above belong to the same blueprint, impl-2 = next distinct blueprint OR next gap on the same blueprint when the design's `out of scope` allows — pick whichever maximizes total composite lift.");
    lines.push("");
    fs.writeFileSync(OUT, lines.join("\n"));
    console.log(`Wrote ${OUT}`);
}

main();
```

- [ ] **Step 2: Run the renderer**

Run:
```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/render-coverage-audit.js
```

Expected: writes the audit markdown; prints the output path.

- [ ] **Step 3: Spot-check the audit**

Open `Docs/plans/2026-06-16-test-coverage-audit.md` and verify:
- Composite scorecard table has 31 rows
- Per-surface deep-dive sections look coherent
- Ranked queue top 10 has 10 entries with priorities descending
- Picks section names impl-1 / impl-2 / impl-3 against the top-3 ranks

- [ ] **Step 4: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add scripts/render-coverage-audit.js Docs/plans/2026-06-16-test-coverage-audit.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(render): human audit markdown + per-surface deep-dive + ranked queue"
```

### Task 1.6: Verify the audit picks ahead of impl

**Files:** none (read-only)

- [ ] **Step 1: Read the ranked queue**

Open `Docs/plans/2026-06-16-test-coverage-audit.md`, scroll to "Ranked queue (top 10)", note the top-3 (surface + axis + archetype + target_file).

- [ ] **Step 2: Sanity-check against the design's blast_radius tiers**

For each of the top-3, confirm:
- The surface is in either the `high` or `med` blast-radius tier (a `low` tier in the top-3 may indicate a bug in the priority formula — investigate before committing to it).
- The archetype is one of the six the design committed to.
- The target_file path is plausible (existing file to extend OR a new path under `platform/test/`).

- [ ] **Step 3: If anything looks off, file a fix-it task before continuing**

If the top-3 look wrong (e.g. high-priority blueprint NOT in the top-3, or an axis that the qualitative pass already flagged as a false negative), pause. Either:
- Patch the rubric library's heuristics, re-run `regen-coverage-matrix.js`, re-render the audit, re-commit.
- OR document the override decision in the handoff prompt: "manual override — picking surface X over surface Y because reason Z."

Do not proceed to impl-1 with a queue you don't trust.

### Task 1.7: Write the post-audit handoff prompt + Phase 1 user review gate

**Files:**
- Create: `Docs/prompts/2026-06-16-post-audit-handoff.md`

- [ ] **Step 1: Write the handoff**

Create `/Users/willfellhoelter/projects/repos/sauce-test-coverage/Docs/prompts/2026-06-16-post-audit-handoff.md`:

```markdown
---
phase_closed: phase-1-audit
phase_next: phase-2-impl-1
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
arc_design: Docs/plans/2026-06-16-test-coverage-arc-design.md
arc_plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
audit_doc: Docs/plans/2026-06-16-test-coverage-audit.md
audit_matrix: platform/test/coverage-matrix.json
---

# Resume here — Phase 1 closed, Phase 2 (impl-1) next

## Where you are
- Worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
- Branch: feature/test-coverage-arc
- Just closed: Phase 1 — audit
- Current preflight: <fill in: pass or fail summary>

## What just shipped (Phase 1)
- `scripts/regen-coverage-matrix.js` — re-runnable audit script
- `scripts/lib/coverage-rubric.js` — per-axis pure scorers
- `scripts/render-coverage-audit.js` — markdown renderer
- `platform/test/blast-radius-seed.json` — hand-curated tiers
- `platform/test/coverage-matrix.json` — 31 surfaces scored
- `Docs/plans/2026-06-16-test-coverage-audit.md` — human audit

## Top-3 picks (from the audit's ranked queue)
- **impl-1**: <surface / axis / archetype / target_file>
- **impl-2**: <surface / axis / archetype / target_file>
- **impl-3**: <surface / axis / archetype / target_file>

## What's next — Phase 2 (impl-1)
- Open the arc plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Jump to "Phase 2 — Impl cycle template" section
- Instantiate it with the impl-1 picks above (substitute the parameters)
- Skill to invoke first: `superpowers:brainstorming` to refine the impl-1 sub-design before writing-plans

## Hard constraints (don't violate)
- Stay in the worktree
- Don't open per-phase PRs — one giant PR at arc close
- Re-read arc-design.md if anything feels ambiguous
- Pause for user review between phases

## Carry-forwards from Phase 1
- <fill in: any surface where the deterministic scorer disagreed with the qualitative pass>
- <fill in: any rubric tweaks queued for a v1.1.0 rubric revision>
- <fill in: any blast-radius-seed.json rationale you'd revisit>
```

Fill in the `<surface / axis / ...>` placeholders from the audit's ranked queue.

- [ ] **Step 2: Commit**

Run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/prompts/2026-06-16-post-audit-handoff.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(handoff): post-Phase-1 handoff prompt with top-3 picks"
```

- [ ] **Step 3: User review gate**

Stop here. Surface the audit + the top-3 picks to the user. Wait for "approved" before starting Phase 2.

The user may override picks; if they do, update the handoff prompt and the audit's "Picks for this arc" section to reflect the override + rationale.

---

## Phase 2 — Impl-1 (rank-1 gap)

> **This phase is parameterized.** Substitute the rank-1 row's tuple before starting:
> - `{IMPL_N}` = `1`
> - `{SURFACE}` = `<kind>/<name>` from the audit's rank-1
> - `{AXIS}` = the axis name (e.g. `installer_migration`)
> - `{ARCHETYPE}` = one of `{hc-family, behavioral-runner, seed-migrate, template-assert, renderer-extend, smoke-extend}`
> - `{TARGET_FILE}` = existing file to extend OR new path

### Task 2.1: Mini-brainstorm impl-1

**Files:**
- Create: `Docs/plans/2026-06-16-test-coverage-impl-1-design.md`

- [ ] **Step 1: Invoke the brainstorming skill**

In a fresh session OR continuing this one, invoke `superpowers:brainstorming` with this priming context:

```
We're brainstorming impl-1 of the test-coverage arc. The audit's rank-1 gap is:
- Surface: {SURFACE}
- Axis: {AXIS}
- Archetype: {ARCHETYPE}
- Target file: {TARGET_FILE}

Arc design: Docs/plans/2026-06-16-test-coverage-arc-design.md
Arc plan: Docs/plans/2026-06-16-test-coverage-arc-plan.md
Audit: Docs/plans/2026-06-16-test-coverage-audit.md

The archetype + target are pre-committed by the design's gap→archetype tree.
We don't relitigate them. Brainstorm focus: what specific asserts close the
gap; what fixtures are needed; what's the smallest set of asserts that
lifts the surface's composite_score by ≥ +0.15.
```

The brainstorming skill will ask clarifying questions and produce a design doc. Direct it to write to `Docs/plans/2026-06-16-test-coverage-impl-1-design.md`.

- [ ] **Step 2: Commit the design**

The brainstorming skill commits its design doc. If it doesn't, run:
```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/plans/2026-06-16-test-coverage-impl-1-design.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(impl-1): design for {SURFACE}/{AXIS} via {ARCHETYPE}"
```

### Task 2.2: writing-plans → impl-1 plan

**Files:**
- Create: `Docs/plans/2026-06-16-test-coverage-impl-1-plan.md`

- [ ] **Step 1: Invoke writing-plans**

Invoke `superpowers:writing-plans` with the impl-1 design as input. It will produce `Docs/plans/2026-06-16-test-coverage-impl-1-plan.md` with bite-sized tasks.

- [ ] **Step 2: Commit the plan**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/plans/2026-06-16-test-coverage-impl-1-plan.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(impl-1): bite-sized plan for {SURFACE}/{AXIS} via {ARCHETYPE}"
```

### Task 2.3: Execute impl-1 (subagent-driven)

**Files:** per impl-1 plan

- [ ] **Step 1: Invoke subagent-driven-development**

Invoke `superpowers:subagent-driven-development` against `Docs/plans/2026-06-16-test-coverage-impl-1-plan.md`. The skill dispatches fresh subagents per task and reviews between tasks.

- [ ] **Step 2: After each task subagent returns**

Review the diff in the worktree. If it's clean, commit per the plan's per-task commit step. If not, send the subagent back with corrections.

- [ ] **Step 3: After ALL tasks land, run preflight**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && npm run release:preflight
```

Expected: exit 0. The new harness (or new HC family / SEED-MIGRATE family / etc.) is included in the preflight chain. Per the design's done criteria, preflight MUST pass.

If preflight fails, do not proceed. Diagnose, fix, commit, re-run.

### Task 2.4: Re-run the audit to confirm composite_score lift

**Files:**
- Modify: `platform/test/coverage-matrix.json` (regenerated)
- Modify: `Docs/plans/2026-06-16-test-coverage-audit.md` (regenerated)

- [ ] **Step 1: Re-run the audit script**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js
```

- [ ] **Step 2: Verify the impl-1 surface's composite lifted by ≥ +0.15**

Run:
```bash
node -e 'const m = require("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json"); const e = m.entries.find(x => x.name === "{SURFACE_NAME}"); console.log("composite now:", e.composite_score, "top_gap_axis_now:", e.top_gap?.axis);'
```

Expected: composite > previous composite by ≥ 0.15 (compare against pre-impl-1 value documented in `impl-1-design.md`).

If the lift is < +0.15, the impl didn't close enough of the gap. Two options:
- Add more asserts (extend impl-1 with a follow-up commit before closing the cycle)
- Document the limitation in the result doc (e.g. "rubric over-promised; lift is +0.10 because uncovered methods are inherently hard to assert")

- [ ] **Step 3: Commit the regenerated matrix + audit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/coverage-matrix.json Docs/plans/2026-06-16-test-coverage-audit.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(refresh): post-impl-1 matrix + audit regenerated"
```

### Task 2.5: Write impl-1 result doc

**Files:**
- Create: `Docs/plans/2026-06-16-test-coverage-impl-1-result.md`

- [ ] **Step 1: Write the result doc**

Template:

```markdown
---
arc: test-coverage-arc
phase: phase-2-impl-1
status: closed
closed_at: <YYYY-MM-DD>
surface: {SURFACE}
axis: {AXIS}
archetype: {ARCHETYPE}
target_file: {TARGET_FILE}
---

# Impl-1 result — {SURFACE}/{AXIS} via {ARCHETYPE}

## What landed
- <bullet list of new harnesses / HC families / SEED-MIGRATE families / fixture files>

## Composite lift
- Before: <pre-impl-1 composite_score>
- After:  <post-impl-1 composite_score>
- Delta:  +<delta>

## Asserts added (counts)
- <e.g. HC-V0119-X-Y-Z: 8 sub-asserts>
- <e.g. SEED-MIGRATE-FOO: 3 sub-asserts>

## Preflight
- exit 0, <N>/<N> green

## Lessons / discoveries
- <bullet list>

## Carry-forwards
- <anything noticed but out-of-scope; queue for v0.119.x+ or arc-result.md>
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/plans/2026-06-16-test-coverage-impl-1-result.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(impl-1): result doc — {SURFACE}/{AXIS} closed, composite +{delta}"
```

### Task 2.6: Write post-impl-1 handoff + Phase 2 user review gate

**Files:**
- Create: `Docs/prompts/2026-06-16-post-impl-1-handoff.md`

- [ ] **Step 1: Write the handoff**

Use the handoff template from Task 1.7, swapping `phase_closed: phase-1-audit` → `phase_closed: phase-2-impl-1`, `phase_next: phase-3-impl-2`, and updating the body to reflect impl-1's deliverables + the impl-2 picks from the refreshed audit.

If the impl-1 work changed any audit picks (e.g. impl-2 used to be rank-2, but the post-impl-1 refresh changed the ordering), update the impl-2 row in the handoff.

- [ ] **Step 2: Commit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/prompts/2026-06-16-post-impl-1-handoff.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(handoff): post-impl-1 handoff with impl-2 picks"
```

- [ ] **Step 3: User review gate**

Stop here. Surface impl-1's deliverables + composite lift + the impl-2 picks. Wait for "approved" before starting Phase 3.

---

## Phase 3 — Impl-2 (rank-2 gap)

Repeat Phase 2's task structure for impl-2:
- Task 3.1: Mini-brainstorm impl-2 (Phase 2 Task 2.1 with `{IMPL_N}` = `2`)
- Task 3.2: writing-plans → impl-2 plan
- Task 3.3: Execute impl-2 (subagent-driven)
- Task 3.4: Re-run the audit, verify +0.15 lift on impl-2's surface
- Task 3.5: Write impl-2 result doc
- Task 3.6: Write post-impl-2 handoff + user review gate

**Differences from Phase 2:**
- Impl-2 inherits the post-impl-1 refreshed audit; if rank-2 changed, use the updated rank-2 picks.
- The handoff at the end of Phase 3 names impl-3 picks (the post-impl-2 rank-3).

---

## Phase 4 — Impl-3 (rank-3 gap)

Repeat Phase 2's task structure for impl-3:
- Task 4.1: Mini-brainstorm impl-3 (Phase 2 Task 2.1 with `{IMPL_N}` = `3`)
- Task 4.2: writing-plans → impl-3 plan
- Task 4.3: Execute impl-3 (subagent-driven)
- Task 4.4: Re-run the audit, verify +0.15 lift on impl-3's surface
- Task 4.5: Write impl-3 result doc
- Task 4.6: Write post-impl-3 handoff + user review gate

The post-impl-3 handoff is the LAST per-phase handoff before arc close — it names Phase 5 as next, not another impl.

---

## Phase 5 — Arc close

### Task 5.1: Re-run audit + compute arc-wide delta

**Files:**
- Modify: `platform/test/coverage-matrix.json` (final refresh)
- Modify: `Docs/plans/2026-06-16-test-coverage-audit.md` (final refresh)

- [ ] **Step 1: Final audit refresh**

```bash
cd /Users/willfellhoelter/projects/repos/sauce-test-coverage && node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js
```

- [ ] **Step 2: Compute arc-wide composite delta**

Run:
```bash
node -e '
const fs = require("fs");
const matrix = JSON.parse(fs.readFileSync("/Users/willfellhoelter/projects/repos/sauce-test-coverage/platform/test/coverage-matrix.json", "utf8"));
const post = matrix.entries.reduce((a, e) => a + (e.composite_score || 0), 0) / matrix.entries.length;
// Pre-arc baseline: read from the first matrix commit
const { execSync } = require("child_process");
const preRaw = execSync("git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage show $(git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage log --reverse --format=%H -- platform/test/coverage-matrix.json | head -1):platform/test/coverage-matrix.json", { encoding: "utf8" });
const pre = JSON.parse(preRaw).entries.reduce((a, e) => a + (e.composite_score || 0), 0) / matrix.entries.length;
console.log("Pre-arc mean composite:", pre.toFixed(3));
console.log("Post-arc mean composite:", post.toFixed(3));
console.log("Delta:", (post - pre).toFixed(3));
'
```

Note the delta.

- [ ] **Step 3: Commit the final audit refresh**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add platform/test/coverage-matrix.json Docs/plans/2026-06-16-test-coverage-audit.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "audit(refresh): final post-impl-3 matrix + audit"
```

### Task 5.2: Write the arc-result doc

**Files:**
- Create: `Docs/plans/2026-06-16-test-coverage-arc-result.md`

- [ ] **Step 1: Write the result doc**

Template:

```markdown
---
arc: test-coverage-arc
phase: arc-close
status: closed
closed_at: <YYYY-MM-DD>
branch: feature/test-coverage-arc
---

# Test coverage arc — result

## Arc-wide composite delta
- Pre-arc mean composite_score:  <X>
- Post-arc mean composite_score: <Y>
- Delta: +<Z>

## Per-cycle deliverables
- **impl-1**: <surface/axis/archetype> — composite +<delta>
- **impl-2**: <surface/axis/archetype> — composite +<delta>
- **impl-3**: <surface/axis/archetype> — composite +<delta>

## Harnesses added or extended
- <bullet list>

## New scripts
- scripts/regen-coverage-matrix.js
- scripts/render-coverage-audit.js

## Preflight status at arc close
- exit 0, <N>/<N> green

## Lessons + carry-forwards
- <Phase 1 lessons>
- <Phase 2/3/4 lessons>
- <Out-of-scope gaps remaining; queue for follow-on cycles>

## Done criteria
- [x] coverage-matrix.json scores all 13 blueprints + 18 mechanisms
- [x] 3 impl cycles closed; each ≥ +0.15 composite lift on its surface
- [x] release:preflight passes with new harnesses included
- [x] arc-wide delta documented above
- [x] post-arc handoff prompt written
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/plans/2026-06-16-test-coverage-arc-result.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(arc): arc-close result doc with composite delta + per-cycle deliverables"
```

### Task 5.3: Write the post-arc handoff

**Files:**
- Create: `Docs/prompts/2026-06-16-post-arc-handoff.md`

- [ ] **Step 1: Write the post-arc handoff**

Template:

```markdown
---
arc_closed: test-coverage-arc
worktree: /Users/willfellhoelter/projects/repos/sauce-test-coverage
branch: feature/test-coverage-arc
pr_url: <to-be-filled-after-Task-5.4>
---

# Post-arc handoff

## Where you are
- Arc closed. PR opened (see pr_url above).
- Worktree stays alive until PR merges; after merge: `git worktree remove /Users/willfellhoelter/projects/repos/sauce-test-coverage`.

## What this arc shipped
- See `Docs/plans/2026-06-16-test-coverage-arc-result.md`

## Follow-on cycles in the queue (from carry-forwards)
- <bullet list of remaining gaps the audit identified but the arc didn't close>
- <any rubric tweaks queued for a v1.1.0 revision of the coverage rubric>

## Re-running the audit later
- `node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js`
- Updates `platform/test/coverage-matrix.json` + `Docs/plans/2026-06-16-test-coverage-audit.md`
- Should be a clean diff if no harnesses were added/removed
```

- [ ] **Step 2: Commit**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/prompts/2026-06-16-post-arc-handoff.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(handoff): post-arc handoff + follow-on queue"
```

### Task 5.4: Open the mega-PR

**Files:** none (GitHub via `gh`)

- [ ] **Step 1: Push the feature branch**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage push -u origin feature/test-coverage-arc
```

- [ ] **Step 2: Open the PR via gh**

```bash
gh -R willfell/sauce pr create \
  --base main \
  --head feature/test-coverage-arc \
  --title "feat(workshop): test-coverage arc — audit + 3 high-priority gaps" \
  --body "$(cat <<'EOF'
## Summary
- Audits every blueprint + mechanism on a 6-axis scorecard.
- Re-runnable: `node scripts/regen-coverage-matrix.js && node scripts/render-coverage-audit.js`.
- Ships harnesses for top-3 risk-weighted gaps (composite +0.15 each).

## Arc artifacts
- Design: `Docs/plans/2026-06-16-test-coverage-arc-design.md`
- Plan: `Docs/plans/2026-06-16-test-coverage-arc-plan.md`
- Audit: `Docs/plans/2026-06-16-test-coverage-audit.md`
- Result: `Docs/plans/2026-06-16-test-coverage-arc-result.md`
- Impl results: `Docs/plans/2026-06-16-test-coverage-impl-{1,2,3}-result.md`

## Test plan
- [x] `npm run release:preflight` green (extended chain includes new harnesses)
- [x] coverage-matrix.json scores all 31 surfaces
- [x] Re-running the audit script is idempotent (no diff on clean re-run)
EOF
)"
```

- [ ] **Step 3: Update the post-arc handoff with the PR URL**

Capture the PR URL from the `gh pr create` output; replace `<to-be-filled-after-Task-5.4>` in `Docs/prompts/2026-06-16-post-arc-handoff.md`.

```bash
# After editing:
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage add Docs/prompts/2026-06-16-post-arc-handoff.md
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage commit -m "docs(handoff): pr url stamped"
git -C /Users/willfellhoelter/projects/repos/sauce-test-coverage push
```

### Task 5.5: User review + merge gate

- [ ] **Step 1: Surface the PR to the user**

The PR is in the user's hands now. Do not merge without explicit approval.

- [ ] **Step 2: After merge, clean up the worktree**

```bash
git -C /Users/willfellhoelter/projects/repos/sauce worktree remove /Users/willfellhoelter/projects/repos/sauce-test-coverage
```

(Run this from the main checkout — the worktree path won't exist as cwd anymore.)

The main checkout's `main` branch will fast-forward on a `git pull`. The feature branch can be deleted (`git branch -d feature/test-coverage-arc`).

---

## Self-review (run after writing the plan)

The writing-plans skill requires a self-review against the spec. Confirmed:

1. **Spec coverage**:
   - Phase 0 (worktree setup) — covered by Task 0.1 (verify state; the setup itself was done in chat).
   - Phase 1 (audit) — covered by Tasks 1.1 through 1.7.
   - Phase 2 (impl-1) — covered by Tasks 2.1 through 2.6.
   - Phase 3 (impl-2) — covered by reference to Phase 2 template.
   - Phase 4 (impl-3) — covered by reference to Phase 2 template.
   - Phase 5 (arc close) — covered by Tasks 5.1 through 5.5.
   - 6-axis rubric — implemented in `scripts/lib/coverage-rubric.js` (Task 1.1 Step 2).
   - Gap → archetype tree — embedded as per-scorer `suggested_archetype` values; cross-referenced to design doc.
   - Risk-weighted prioritization — implemented in `applyPriority` (Task 1.1 Step 1) using `axisWeight` (rubric library).
   - Handoff prompts — Tasks 1.7, 2.6, 3.6, 4.6, 5.3.
   - Subagent fan-out for audit qualitative pass — Task 1.4.
   - Mega-PR shape — Task 5.4.

2. **Placeholder scan**:
   - Phase 2-4's `{SURFACE}` / `{AXIS}` / etc. are parameters, not placeholders — explicit instantiation instructions provided. Acceptable per the design's strict-phase-gating decision.
   - "fill in" markers appear only inside template documents (handoff prompts, result docs) and refer to runtime values that don't exist at plan-write time — acceptable per the same reasoning.
   - No "TBD" / "TODO" / "implement later" anywhere.

3. **Type consistency**:
   - Rubric library function names: `scoreCustomJSBehavioral`, `scoreInstallerMigration`, `scoreManifestSchema`, `scoreTemplateLockstep`, `scoreWidgetRender`, `scoreIntegrationSmoke`, `composite`, `axisWeight`, `recentIncidents` — same across `regen-coverage-matrix.js` (importer) and `coverage-rubric.js` (exporter).
   - Matrix shape — `kind` / `name` / `current_version` / `axes` / `composite_score` / `blast_radius` / `recent_incidents_30d` / `priority_score` / `top_gap` — same across `applyPriority`, `renderAxisCell`, and the per-entry deep-dive renderer.
   - Archetype enum — `{hc-family, behavioral-runner, seed-migrate, template-assert, renderer-extend, smoke-extend}` — same across design doc, plan body, and the rubric library's `suggested_archetype` returns.

---

## Execution handoff

Plan complete and saved to `Docs/plans/2026-06-16-test-coverage-arc-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — `superpowers:subagent-driven-development` dispatches a fresh subagent per task, with review between tasks. Best fit for this plan because the audit phase has 7 tasks of varying scope and the impl phases each have 6 templated tasks; per-task review catches drift early.

**2. Inline Execution** — `superpowers:executing-plans`, batch execution with checkpoints between phases. Faster within a single session but less robust to mid-session compaction.

Pick one to start Phase 1.
