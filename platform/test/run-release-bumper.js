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
    // seed-vault subscription: meetings pin tracks the catalogue; workshop_version
    // is intentionally frozen (drives migration coverage) and must NOT be bumped.
    fs.mkdirSync(path.join(tmp, "platform/test/seed-vault/ranch"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "platform/test/seed-vault/ranch/platform-subscription.json"),
        JSON.stringify({ workshop_version: "0.100.0", blueprints: [{ name: "meetings", version: "0.12.0" }], mechanisms: [] }, null, 2) + "\n");

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
    const seedSub2 = JSON.parse(fs.readFileSync(path.join(tmp, "platform/test/seed-vault/ranch/platform-subscription.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-I: seed-vault sub meetings pin bumped", seedSub2.blueprints[0].version, "0.13.0");
    eq("HC-V0129-RELEASE-WRITE-J: seed-vault sub workshop_version UNTOUCHED", seedSub2.workshop_version, "0.100.0");

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

// ---- Release range: count from the commit a release was computed from ----
// v0.307.1's release PR was computed before #910 landed and merged after it,
// so its tag sat on top of #910 and #910's components were never bumped. The
// record lives in platform/release-state.json, inside the release commit's
// tree: a commit-message trailer did not survive the auto-merged squash.
console.log("\n--- HC-RELEASE-RANGE ---");
{
    const { execFileSync } = require("child_process");
    const SHA = "65a7cbc2d1e4f00000000000000000000000abcd";
    const state = (v) => JSON.stringify({ computed_from: v });
    eq("HC-RELEASE-RANGE-A: computed_from read from release-state.json", cr.computedFromOf(state(SHA)), SHA);
    eq("HC-RELEASE-RANGE-B: empty / missing / malformed state -> null",
        [cr.computedFromOf(state("")), cr.computedFromOf(null), cr.computedFromOf("{")].join(), ",,");
    eq("HC-RELEASE-RANGE-C: computed_from must be a hex sha", cr.computedFromOf(state("main")), null);
    ok("HC-RELEASE-RANGE-D: release commits are recognised", cr.isReleaseCommit("chore(release): v1.2.3") && !cr.isReleaseCommit("fix(release): x")
        && !cr.isReleaseCommit("chore(seed): rebaseline") && !cr.isReleaseCommit("chore: tidy"));
    const r1 = cr.resolveRange({ releaseHash: "f4f5", releaseState: state(SHA), tag: "v0.307.1", isAncestor: (s) => s === SHA });
    eq("HC-RELEASE-RANGE-E: reachable computed_from -> range from it", r1.range, `${SHA}..HEAD`);
    eq("HC-RELEASE-RANGE-F: reason computed-from", r1.reason, "computed-from");
    const r2 = cr.resolveRange({ releaseHash: "f4f5", releaseState: state(SHA), tag: "v0.307.1", isAncestor: () => false });
    eq("HC-RELEASE-RANGE-G: unreachable computed_from -> range from the release commit", r2.range, "f4f5..HEAD");
    const r3 = cr.resolveRange({ releaseHash: "f4f5", releaseState: null, tag: "v0.307.0", isAncestor: () => true });
    eq("HC-RELEASE-RANGE-H: no state -> range from the release commit (same as its tag)", r3.range, "f4f5..HEAD");
    const r4 = cr.resolveRange({ releaseHash: "f4f5", releaseState: state(SHA), isAncestor: () => { throw new Error("git"); } });
    eq("HC-RELEASE-RANGE-I: a failing ancestry check falls back to the release commit", r4.range, "f4f5..HEAD");
    eq("HC-RELEASE-RANGE-J: no release commit -> last tag", cr.resolveRange({ tag: "v0.1.0" }).range, "v0.1.0..HEAD");
    eq("HC-RELEASE-RANGE-K: nothing -> all of HEAD", cr.resolveRange({}).range, "HEAD");

    // The race replayed in a real repo. S is where the release is computed;
    // F (#910) lands next; the release commit R is squashed on top of F with
    // a title-only message, carrying the state file that names S.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sauce-race-"));
    try {
        const git = (...a) => execFileSync("git", a, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.writeFileSync(path.join(tmp, rel), text); };
        const commit = (msg) => { git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg); return git("rev-parse", "HEAD"); };
        git("init", "-q");
        write("platform/blueprints/meetings/manifest.json", "{}\n");
        write("platform/mechanisms/section-label/manifest.json", "{}\n");
        write("platform/mechanisms/convenience/manifest.json", "{}\n");
        write(cr.RELEASE_STATE_REL, state("") + "\n");
        commit("chore(release): v0.307.0 (#908)");
        write("platform/mechanisms/convenience/c.js", "1\n");
        const S = commit("fix(convenience): homepage reset (#909)");
        write("platform/blueprints/meetings/helpers/m.js", "1\n");
        write("platform/mechanisms/section-label/filter-bar.js", "1\n");
        commit("feat(meetings): bring the meetings pages onto the To-Do design (#910)");
        write("platform/mechanisms/convenience/manifest.json", "{\"v\":1}\n");
        cr.writeReleaseState(tmp, S);
        commit("chore(release): v0.307.1 (#911)");
        write("platform/mechanisms/other/x.js", "1\n");
        commit("fix(render-safe): keep live UI (#913)");
        const got = cr.releaseCommits(tmp);
        const subjects = got.commits.map((c) => c.message.split("\n")[0]);
        eq("HC-RELEASE-RANGE-L: the squashed release commit's state file names the computed-from commit",
            cr.computedFromOf(cr.releaseStateAt(git("rev-parse", "HEAD~1"), tmp)), S);
        eq("HC-RELEASE-RANGE-M: the next release counts from it (reason)", got.reason, "computed-from");
        ok("HC-RELEASE-RANGE-N: the stranded feat is counted, the release commit and earlier commits are not",
            subjects.includes("feat(meetings): bring the meetings pages onto the To-Do design (#910)")
            && subjects.includes("fix(render-safe): keep live UI (#913)")
            && !subjects.some((x) => x.startsWith("chore(release)")) && !subjects.some((x) => x.includes("#909")));
        const man = {
            workshop_version: "0.307.1",
            blueprints: [{ name: "meetings", version: "0.19.4", path: "blueprints/meetings" }],
            mechanisms: [{ name: "section-label", version: "0.2.2", path: "mechanisms/section-label" },
                         { name: "convenience", version: "0.6.1", path: "mechanisms/convenience" }],
        };
        const to = Object.fromEntries(cr.computePlan(got.commits, man).components.map((c) => [c.name, c.to]));
        ok("HC-RELEASE-RANGE-O: the stranded feat bumps meetings and section-label; convenience is not bumped again",
            to.meetings === "0.20.0" && to["section-label"] === "0.3.0" && !("convenience" in to));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts/release/compute-release.js"), "utf8");
    const cli = src.slice(src.indexOf("// --- CLI ---"));
    ok("HC-RELEASE-RANGE-P: the CLI counts releaseCommits() and --write records the computed-from sha after applying the plan",
        /const \{ range, reason, commits \} = releaseCommits\(\);/.test(cli)
        && cli.indexOf("writeReleaseState(REPO_ROOT, headSha());") > cli.indexOf("applyPlan(plan, REPO_ROOT);")
        && src.indexOf("getCommits(range, cwd).filter((c) => !isReleaseCommit(c.message))") >= 0);
    const seeded = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, cr.RELEASE_STATE_REL), "utf8"));
    ok("HC-RELEASE-RANGE-Q: release-state.json is tracked with a computed_from key (so preflight-bumped restores it)",
        Object.prototype.hasOwnProperty.call(seeded, "computed_from"));
}

console.log(`\nrun-release-bumper: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
