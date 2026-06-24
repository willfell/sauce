#!/usr/bin/env node
/*
 * run-release-bumper.js — behavioral harness for the release bumper engine
 * (scripts/release/). Exercises vendored libs + compute-release against
 * synthetic commit fixtures and a temp fixture vault. Zero-dep; cleans up.
 * Family: HC-V0129-RELEASE-*.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; } else { fail++; console.error(`  FAIL ${label}`); } };
const eq = (label, a, b) => ok(`${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);

// ---- Task 1: semver-inc ----
const { parse, inc, maxLevel, RANK } = require("../../scripts/release/lib/semver-inc.js");
console.log("\n--- HC-V0129-RELEASE-SEMVER ---");
eq("HC-V0129-RELEASE-SEMVER-A: patch", inc("0.128.0", "patch"), "0.128.1");
eq("HC-V0129-RELEASE-SEMVER-B: minor zeroes patch", inc("0.128.5", "minor"), "0.129.0");
eq("HC-V0129-RELEASE-SEMVER-C: major zeroes minor+patch", inc("1.4.7", "major"), "2.0.0");
eq("HC-V0129-RELEASE-SEMVER-D: none is identity", inc("0.128.0", "none"), "0.128.0");
eq("HC-V0129-RELEASE-SEMVER-E: maxLevel picks higher", maxLevel("patch", "minor"), "minor");
eq("HC-V0129-RELEASE-SEMVER-F: maxLevel none<patch", maxLevel("none", "patch"), "patch");
ok("HC-V0129-RELEASE-SEMVER-G: parse rejects junk", (() => { try { parse("1.2"); return false; } catch (e) { return true; } })());

// ---- Task 2: conventional classifier ----
const { parseCommit, bumpLevel } = require("../../scripts/release/lib/conventional.js");
console.log("\n--- HC-V0129-RELEASE-CONV ---");
const c1 = parseCommit("feat(meetings): add leaf actions");
eq("HC-V0129-RELEASE-CONV-A: type", c1.type, "feat");
eq("HC-V0129-RELEASE-CONV-B: scope", c1.scope, "meetings");
ok("HC-V0129-RELEASE-CONV-C: not breaking", c1.breaking === false);
const c2 = parseCommit("feat(installer,validator): big change");
eq("HC-V0129-RELEASE-CONV-D: multi-scope count", c2.scopes.length, 2);
const c3 = parseCommit("feat(api)!: drop legacy field");
ok("HC-V0129-RELEASE-CONV-E: bang breaking", c3.breaking === true);
const c4 = parseCommit("fix: thing\n\nBREAKING CHANGE: removed X");
ok("HC-V0129-RELEASE-CONV-F: footer breaking", c4.breaking === true);
const c5 = parseCommit("feat(meetings): x\n\nRelease-As: 1.0.0");
eq("HC-V0129-RELEASE-CONV-G: release-as", c5.releaseAs, "1.0.0");
ok("HC-V0129-RELEASE-CONV-H: junk header -> null", parseCommit("just some words") === null);
eq("HC-V0129-RELEASE-CONV-I: feat pre1 -> minor", bumpLevel(c1, true), "minor");
eq("HC-V0129-RELEASE-CONV-J: breaking pre1 -> minor", bumpLevel(c3, true), "minor");
eq("HC-V0129-RELEASE-CONV-K: breaking post1 -> major", bumpLevel(c3, false), "major");
eq("HC-V0129-RELEASE-CONV-L: fix -> patch", bumpLevel(parseCommit("fix: y"), true), "patch");
eq("HC-V0129-RELEASE-CONV-M: chore -> none", bumpLevel(parseCommit("chore: z"), true), "none");
eq("HC-V0129-RELEASE-CONV-N: null -> none", bumpLevel(null, true), "none");

// ---- Task 3: compute-release plan ----
const cr = require("../../scripts/release/compute-release.js");
console.log("\n--- HC-V0129-RELEASE-PLAN ---");

const FIX_MANIFEST = {
    workshop_version: "0.128.0",
    blueprints: [
        { name: "meetings", version: "0.12.0", path: "blueprints/meetings" },
        { name: "project", version: "1.26.0", path: "blueprints/project" },
    ],
    mechanisms: [
        { name: "breadcrumb", version: "0.1.0", path: "mechanisms/breadcrumb" },
    ],
};
const idx = cr.buildIndex(FIX_MANIFEST);

eq("HC-V0129-RELEASE-PLAN-A: attribute meetings file",
    cr.attribute(["platform/blueprints/meetings/Template.md"], idx).components[0], "meetings");
ok("HC-V0129-RELEASE-PLAN-B: shared root -> umbrella only",
    cr.attribute(["platform/helpers/foo.js"], idx).umbrellaOnly === true);
{
    const a = cr.attribute(["platform/blueprints/meetings/a.md", "platform/mechanisms/breadcrumb/b.js"], idx);
    eq("HC-V0129-RELEASE-PLAN-C: multi-component", a.components.slice().sort().join(","), "breadcrumb,meetings");
}

const COMMITS = [
    { hash: "a1", message: "feat(meetings): leaf actions", files: ["platform/blueprints/meetings/T.md"] },
    { hash: "a2", message: "fix(project): guard null", files: ["platform/blueprints/project/P.js"] },
    { hash: "a3", message: "feat!: drop legacy", files: ["platform/mechanisms/breadcrumb/b.js"] },
    { hash: "a4", message: "chore: tidy docs", files: ["Docs/x.md"] },
];
const plan = cr.computePlan(COMMITS, FIX_MANIFEST);
const byName = Object.fromEntries(plan.components.map((c) => [c.name, c]));
eq("HC-V0129-RELEASE-PLAN-D: meetings feat -> 0.13.0", byName.meetings.to, "0.13.0");
eq("HC-V0129-RELEASE-PLAN-E: project fix -> 1.26.1", byName.project.to, "1.26.1");
eq("HC-V0129-RELEASE-PLAN-F: breadcrumb breaking pre1 -> 0.2.0", byName.breadcrumb.to, "0.2.0");
eq("HC-V0129-RELEASE-PLAN-G: workshop max=minor -> 0.129.0", plan.workshop.to, "0.129.0");

// Release-As override
const planRA = cr.computePlan(
    [{ hash: "b1", message: "feat(meetings): x\n\nRelease-As: 2.5.0", files: ["platform/blueprints/meetings/T.md"] }],
    FIX_MANIFEST);
eq("HC-V0129-RELEASE-PLAN-H: release-as override",
    planRA.components.find((c) => c.name === "meetings").to, "2.5.0");

// ---- Task 4: write path against a temp fixture vault ----
console.log("\n--- HC-V0129-RELEASE-WRITE ---");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-bumper-"));
try {
    fs.mkdirSync(path.join(tmp, "platform/blueprints/meetings"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "ranch"), { recursive: true });
    const man = {
        workshop_version: "0.128.0",
        blueprints: [{ name: "meetings", version: "0.12.0", path: "blueprints/meetings" }],
        mechanisms: [],
    };
    fs.writeFileSync(path.join(tmp, "platform/manifest.json"), JSON.stringify(man, null, 2) + "\n");
    fs.writeFileSync(path.join(tmp, "platform/blueprints/meetings/manifest.json"),
        JSON.stringify({ name: "meetings", version: "0.12.0", kind: "blueprint" }, null, 2) + "\n");
    fs.writeFileSync(path.join(tmp, "ranch/platform-subscription.json"),
        JSON.stringify({ workshop_version: "0.128.0", blueprints: [{ name: "meetings", version: "0.12.0" }], mechanisms: [] }, null, 2) + "\n");
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "sauce", version: "0.128.0" }, null, 2) + "\n");
    // a contract file the bumper must NOT touch
    fs.mkdirSync(path.join(tmp, "platform/blueprints/cowork/data"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "platform/blueprints/cowork/data/scheduled-job-contract.json"),
        JSON.stringify({ contract_version: "0.35.1" }, null, 2) + "\n");

    const plan = cr.computePlan(
        [{ hash: "z1", message: "feat(meetings): leaf actions", files: ["platform/blueprints/meetings/T.md"] }],
        man);
    cr.applyPlan(plan, tmp);

    const man2 = JSON.parse(fs.readFileSync(path.join(tmp, "platform/manifest.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-A: catalogue meetings bumped", man2.blueprints[0].version, "0.13.0");
    eq("HC-V0129-RELEASE-WRITE-B: workshop_version bumped", man2.workshop_version, "0.129.0");
    const comp2 = JSON.parse(fs.readFileSync(path.join(tmp, "platform/blueprints/meetings/manifest.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-C: per-component manifest bumped", comp2.version, "0.13.0");
    const ranch2 = JSON.parse(fs.readFileSync(path.join(tmp, "ranch/platform-subscription.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-D: ranch pin bumped", ranch2.blueprints[0].version, "0.13.0");
    eq("HC-V0129-RELEASE-WRITE-E: ranch workshop bumped", ranch2.workshop_version, "0.129.0");
    const pkg2 = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-F: package.json bumped", pkg2.version, "0.129.0");
    const contract2 = JSON.parse(fs.readFileSync(path.join(tmp, "platform/blueprints/cowork/data/scheduled-job-contract.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-G: contract_version UNTOUCHED", contract2.contract_version, "0.35.1");

    // idempotence: recomputing against the now-updated manifest with the SAME
    // commits still maps meetings feat to a single minor bump from the new base
    const planAgain = cr.computePlan(
        [{ hash: "z1", message: "feat(meetings): leaf actions", files: ["platform/blueprints/meetings/T.md"] }],
        man2);
    eq("HC-V0129-RELEASE-WRITE-H: idempotent re-plan from new base", planAgain.components[0].to, "0.14.0");
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- Phase 0b: snapshot generation ----
console.log("\n--- HC-V0129-RELEASE-SNAPSHOT ---");
{
    const snap = cr.buildSnapshot({
        workshop_version: "0.128.2",
        blueprints: [{ name: "meetings", version: "0.12.0", path: "blueprints/meetings" }],
        mechanisms: [{ name: "breadcrumb", version: "0.1.0", path: "mechanisms/breadcrumb" }],
    });
    eq("HC-V0129-RELEASE-SNAPSHOT-A: workshop_version", snap.workshop_version, "0.128.2");
    eq("HC-V0129-RELEASE-SNAPSHOT-B: component meetings", snap.components.meetings, "0.12.0");
    eq("HC-V0129-RELEASE-SNAPSHOT-C: component breadcrumb", snap.components.breadcrumb, "0.1.0");
    eq("HC-V0129-RELEASE-SNAPSHOT-D: only declared components", Object.keys(snap.components).length, 2);
}
{
    // applyPlan regenerates the snapshot fixture when the fixtures dir exists
    const t2 = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-snap-"));
    try {
        fs.mkdirSync(path.join(t2, "platform/blueprints/meetings"), { recursive: true });
        fs.mkdirSync(path.join(t2, "platform/test/fixtures"), { recursive: true });
        const man = {
            workshop_version: "0.128.0",
            blueprints: [{ name: "meetings", version: "0.12.0", path: "blueprints/meetings" }],
            mechanisms: [],
        };
        fs.writeFileSync(path.join(t2, "platform/manifest.json"), JSON.stringify(man, null, 2) + "\n");
        fs.writeFileSync(path.join(t2, "platform/blueprints/meetings/manifest.json"),
            JSON.stringify({ name: "meetings", version: "0.12.0" }, null, 2) + "\n");
        const plan = cr.computePlan(
            [{ hash: "s1", message: "feat(meetings): x", files: ["platform/blueprints/meetings/T.md"] }], man);
        cr.applyPlan(plan, t2);
        const snap = JSON.parse(fs.readFileSync(path.join(t2, cr.SNAPSHOT_REL), "utf8"));
        eq("HC-V0129-RELEASE-SNAPSHOT-E: regen workshop matches bump", snap.workshop_version, "0.129.0");
        eq("HC-V0129-RELEASE-SNAPSHOT-F: regen component matches bump", snap.components.meetings, "0.13.0");
    } finally {
        fs.rmSync(t2, { recursive: true, force: true });
    }
}

console.log(`\nrun-release-bumper: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
