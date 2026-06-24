# Seed-Pin Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `compute-release.applyPlan` mirror per-component version bumps into the seed-vault subscription pins, so `run-seed-migrations.js` no longer skews when the pipeline ships a blueprint/mechanism bump.

**Architecture:** One addition to `scripts/release/compute-release.js` `applyPlan()` — update `platform/test/seed-vault/ranch/platform-subscription.json` per-item pins (by-name match against the bumped components), **never** its `workshop_version`. Locked by a new write-path assertion in `platform/test/run-release-bumper.js`.

**Tech Stack:** Node.js (CommonJS, zero-dep), the existing `run-*.js` harness convention.

**All paths are relative to the worktree:** `/Users/willfellhoelter/projects/repos/sauce-seedpin-wt`

---

### Task 1: Seed-vault subscription per-item pin sync (TDD)

**Files:**
- Modify: `platform/test/run-release-bumper.js` (extend the HC-V0129-RELEASE-WRITE fixture + add two assertions)
- Modify: `scripts/release/compute-release.js` (`applyPlan`, after the `ranch subscription pins` block at line ~172)

- [ ] **Step 1: Extend the write-path test fixture + add failing assertions**

In `platform/test/run-release-bumper.js`, inside the `HC-V0129-RELEASE-WRITE` block:

(a) After the contract-file write (the lines that create `platform/blueprints/cowork/data/scheduled-job-contract.json`, ending at the `+ "\n");` on the line after `JSON.stringify({ contract_version: "0.35.1" }...`), ADD a seed-vault subscription fixture with a meetings pin matching the catalogue and an intentionally-frozen `workshop_version`:

```js
    // seed-vault subscription: meetings pin tracks the catalogue; workshop_version
    // is intentionally frozen (drives migration coverage) and must NOT be bumped.
    fs.mkdirSync(path.join(tmp, "platform/test/seed-vault/ranch"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "platform/test/seed-vault/ranch/platform-subscription.json"),
        JSON.stringify({ workshop_version: "0.100.0", blueprints: [{ name: "meetings", version: "0.12.0" }], mechanisms: [] }, null, 2) + "\n");
```

(b) After the existing `HC-V0129-RELEASE-WRITE-G` contract assertion (the `eq("HC-V0129-RELEASE-WRITE-G: ...")` line), ADD:

```js
    const seedSub2 = JSON.parse(fs.readFileSync(path.join(tmp, "platform/test/seed-vault/ranch/platform-subscription.json"), "utf8"));
    eq("HC-V0129-RELEASE-WRITE-I: seed-vault sub meetings pin bumped", seedSub2.blueprints[0].version, "0.13.0");
    eq("HC-V0129-RELEASE-WRITE-J: seed-vault sub workshop_version UNTOUCHED", seedSub2.workshop_version, "0.100.0");
```

- [ ] **Step 2: Run the harness to verify WRITE-I fails (WRITE-J passes incidentally)**

Run: `node platform/test/run-release-bumper.js`
Expected: FAIL on `HC-V0129-RELEASE-WRITE-I: seed-vault sub meetings pin bumped (got "0.12.0", want "0.13.0")` — applyPlan doesn't touch the seed sub yet. (WRITE-J passes because nothing touches it.)

- [ ] **Step 3: Add the seed-sub per-item pin sync to `applyPlan`**

In `scripts/release/compute-release.js`, immediately AFTER the `ranch subscription pins` block (the `}` closing `if (fs.existsSync(ranchPath)) { ... }`, line ~172) and BEFORE the `// package.json` comment, INSERT:

```js
    // seed-vault subscription pins — per-item ONLY. The installer reconciles
    // subscription vs catalogue with an exact-match check (install.js:1307), so a
    // component bump must move the seed's matching pin too or run-seed-migrations
    // skews + skips it. Leave the seed's workshop_version (intentionally frozen →
    // drives migration coverage) and its installed state alone (the post-merge
    // rebaseline-seed job owns those).
    const seedSubPath = path.join(root, "platform/test/seed-vault/ranch/platform-subscription.json");
    if (fs.existsSync(seedSubPath)) {
        const seed = JSON.parse(fs.readFileSync(seedSubPath, "utf8"));
        for (const arr of [seed.blueprints || [], seed.mechanisms || []]) {
            for (const c of arr) if (toByName[c.name]) c.version = toByName[c.name];
        }
        writeJson(seedSubPath, seed);
    }
```

- [ ] **Step 4: Run the harness to verify all pass**

Run: `node platform/test/run-release-bumper.js`
Expected: PASS — final line `run-release-bumper: <N> passed, 0 failed` (N = previous count + 2). HC-V0129-RELEASE-WRITE-I and -J both pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/release/compute-release.js platform/test/run-release-bumper.js
git commit -m "fix(release): compute-release mirrors per-item bumps into seed-vault subscription pins

run-seed-migrations installs the workshop into a copy of platform/test/seed-vault/,
which carries its own ranch/platform-subscription.json. The installer skips any
item whose subscription pin != the catalogue (install.js:1307, exact-match), so a
blueprint/mechanism bump made prepare-release's internal preflight fail there —
the pipeline could not ship component bumps. applyPlan now syncs the seed sub's
per-item pins (by-name) in lockstep with the catalogue. Per-item ONLY: the seed's
workshop_version stays frozen (drives migration coverage) and its installed state
is left to the post-merge rebaseline-seed job. Locked by HC-V0129-RELEASE-WRITE-I/J."
```

---

### Task 2: Result doc

**Files:**
- Create: `Docs/plans/2026-06-24-compute-release-seed-pin-sync-result.md`

- [ ] **Step 1:** Write the result doc: root cause (install.js:1307), the one-block fix (per-item seed-sub sync, workshop_version left frozen), the new HC-V0129-RELEASE-WRITE-I/J assertions, verification evidence (worktree repro + preflight), and the Half-2 carry-forward (branch-protection vs bot-PR — token-gated follow-up). Manual smoke: N/A (release tooling only).

- [ ] **Step 2: Commit**

```bash
git add Docs/plans/2026-06-24-compute-release-seed-pin-sync-result.md
git commit -m "docs(release): seed-pin sync result doc"
```

---

### Final gate (controller-run, before PR)

- [ ] `node platform/test/run-release-bumper.js` → all green (incl. WRITE-I/J).
- [ ] **Repro proof:** in the worktree, bump one real component's catalogue + per-component manifest by hand (no seed-sub edit) → `node platform/test/run-seed-migrations.js` fails with the `subscription pins … but workshop has …` skip; then `git restore` + run `compute-release.js --write` against a synthetic bump → seed sub pin moves → `run-seed-migrations` green. (Reversible; restore after.)
- [ ] `npm run release:preflight` → whole-suite GREEN (no version bump in the PR → no real skew introduced).
- [ ] No `.github/workflows/*.yml` in any commit (`git diff --name-only origin/main... | grep workflows` empty).

## Self-review

- **Spec coverage:** design §"Fix (Half 1)" → Task 1 Step 3; design §"Tests" regression → Task 1 Steps 1-4; result doc → Task 2; verification → Final gate. Half 2 is explicitly out of this PR (design §"Half 2") — no task, correct.
- **No placeholders:** all code blocks complete; commands have expected output.
- **Type consistency:** uses existing `toByName` map + `writeJson()` helper (both already in `applyPlan`'s scope); `seedSubPath` mirrors the existing `ranchPath`/`pkgPath` pattern; assertion labels follow the existing `HC-V0129-RELEASE-WRITE-*` family (next free letters I/J).
