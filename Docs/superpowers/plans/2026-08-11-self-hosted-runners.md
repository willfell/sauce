# Self-hosted runners for every CI job — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all seven GitHub Actions jobs in `willfell/sauce` onto self-hosted infrastructure, leaving no `ubuntu-latest` or `macos-latest` anywhere in `.github/workflows/`, and enforce that permanently with a preflight harness.

**Architecture:** Two pools. **Pool A** is an ARC runner scale set named `sauce` (linux/arm64, ephemeral pods) declared as an Argo CD Application in the separate `willfell/lab` repo. **Pool B** is Tartelet driving up to two ephemeral Tart macOS VMs on the Mac mini host. Both authenticate with the existing `arc-github-app`. CodeQL and every Homebrew-touching job go to Pool B because no linux-arm64 CodeQL bundle exists; everything else goes to Pool A.

**Tech Stack:** GitHub Actions, Actions Runner Controller (`gha-runner-scale-set` chart `0.14.2`), Argo CD, k3s on Colima, Tart + Tartelet, Node 20, zero-dependency Node test harnesses.

**Design spec:** [`Docs/superpowers/specs/2026-08-11-self-hosted-runners-design.md`](../specs/2026-08-11-self-hosted-runners-design.md)

## Global Constraints

- **No comments in config files.** YAML, HCL, JSON, TOML, Dockerfiles — the new Argo Application and all workflow edits carry no comments. Rationale goes in the commit message. Never strip a human's pre-existing comments; `release.yml` already has some, leave them.
- **Never hand-edit versions.** Do not bump `package.json`, do not tag, do not merge the release PR. The release pipeline is fully automatic.
- **Harnesses stay zero-dependency.** No YAML parser. Parse workflows with `fs.readFileSync` + regex, matching the existing style of `platform/test/run-ci-candidate-source.js`.
- **Runner labels are exactly:** `sauce` for Pool A; `[self-hosted, macOS, ARM64]` for Pool B. Tartelet cannot set custom labels.
- **ARC chart pin:** `0.14.2`, matching the three sibling Applications.
- **Preflight concurrency:** `SAUCE_PREFLIGHT_JOBS: '4'` as a job-level `env:` on every job that runs `npm run release:preflight`.
- **Workflow pushes need SSH.** Commits touching `.github/workflows/*` are rejected over HTTPS (no `workflow` token scope). Push over the `git@github.com` remote.
- **Cross-repo:** Task 1 edits `willfell/lab`, not this repo. Tasks 3–6 edit `willfell/sauce`.

## Prerequisite — Director action, blocks Task 1

Add `willfell/sauce` to the `arc-github-app` installation at <https://github.com/settings/installations>. One App serves both pools. Nothing below can be verified until this is done.

Verify: `gh api repos/willfell/sauce/actions/runners` must respond without a 403.

## File Structure

| File | Repo | Responsibility |
| --- | --- | --- |
| `k8s/argocd-apps/arc-runner-sauce.yaml` | `lab` | **Create.** Argo Application declaring the `sauce` ARC scale set |
| `.github/workflows/runner-smoke.yml` | `sauce` | **Create then delete.** Temporary two-pool proof |
| `platform/test/run-ci-runner-policy.js` | `sauce` | **Create.** Enforces "no GitHub-hosted runner" across all workflows |
| `platform/test/preflight-manifest.json` | `sauce` | **Modify.** Register the new harness |
| `package.json` | `sauce` | **Modify.** Add `test:ci-runner-policy` script |
| `.github/workflows/ci.yml` | `sauce` | **Modify.** Matrix restructure, three jobs repointed |
| `.github/workflows/codeql.yml` | `sauce` | **Modify.** `analyze` → Pool B |
| `.github/workflows/release.yml` | `sauce` | **Modify.** Three jobs → Pool A, `gh` install steps |
| `platform/test/run-ci-candidate-source.js` | `sauce` | **Modify.** Five assertions + two mutation fixtures track the new contract |
| `platform/test/run-codex-autoloop.js` | `sauce` | **Modify.** Check-name fixtures track the renamed checks |
| `Docs/landmines.md` | `sauce` | **Modify.** Record the branch-protection trap |

---

### Task 1: Pool A — the `sauce` ARC scale set

**Files:**
- Create: `~/Documents/GitHub/lab/k8s/argocd-apps/arc-runner-sauce.yaml`

**Interfaces:**
- Consumes: the existing `arc-github-app` Secret in namespace `arc-runners`, and the `arc-controller` service account `arc-controller-gha-rs-controller` in `arc-systems`.
- Produces: a runner scale set answering `runs-on: sauce` for `willfell/sauce`.

Two intentional divergences from the three sibling Applications, both from the spec: **no `containerMode: dind`** (nothing in sauce builds an image; this drops a privileged sidecar from a public repo's runner) and **larger resources** sized from the measured 174-step baseline.

- [ ] **Step 1: Confirm the prerequisite landed and no `sauce` scale set exists yet**

```bash
gh api repos/willfell/sauce/actions/runners --jq '.total_count'
kubectl get autoscalingrunnersets -n arc-runners
```

Expected: `0`, and a list containing `egnyte-mcp`, `finance`, `lab` but **not** `sauce`. If the API 403s, the Director has not installed the App on the repo — stop.

- [ ] **Step 2: Write the Argo Application**

Create `~/Documents/GitHub/lab/k8s/argocd-apps/arc-runner-sauce.yaml`. No comments, per Global Constraints.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: arc-runner-sauce
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  project: default
  source:
    repoURL: ghcr.io/actions/actions-runner-controller-charts
    chart: gha-runner-scale-set
    targetRevision: "0.14.2"
    helm:
      releaseName: sauce
      valuesObject:
        githubConfigUrl: https://github.com/willfell/sauce
        githubConfigSecret: arc-github-app
        controllerServiceAccount:
          namespace: arc-systems
          name: arc-controller-gha-rs-controller
        minRunners: 0
        maxRunners: 3
        template:
          spec:
            containers:
              - name: runner
                image: ghcr.io/actions/actions-runner:2.336.0
                command: ["/home/runner/run.sh"]
                resources:
                  requests:
                    cpu: "1"
                    memory: 2Gi
                  limits:
                    cpu: "4"
                    memory: 8Gi
  destination:
    server: https://kubernetes.default.svc
    namespace: arc-runners
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

- [ ] **Step 3: Commit and push on a branch in the `lab` repo**

```bash
cd ~/Documents/GitHub/lab
git checkout -b feat/arc-runner-sauce
git add k8s/argocd-apps/arc-runner-sauce.yaml
git commit -m "feat(arc): add the sauce runner scale set

Onboards willfell/sauce to the in-cluster ARC pool so its CI can leave
GitHub-hosted runners entirely.

Two deliberate divergences from the sibling scale sets:

- No containerMode: dind. Every sauce job is pure Node; nothing builds
  an image. Omitting dind drops a privileged sidecar from a public
  repo's runner and shortens pod start.
- Larger resources (requests 1/2Gi, limits 4/8Gi vs the siblings'
  500m/1Gi and 2/4Gi). Sized from a measured baseline: sauce's preflight
  is 174 steps, 98.4s wall, 162% average CPU."
git push -u origin feat/arc-runner-sauce
gh pr create --fill
```

- [ ] **Step 4: Merge, then verify Argo reconciled the scale set**

```bash
gh pr merge --squash --delete-branch
kubectl get autoscalingrunnersets -n arc-runners -w
```

Expected within ~2 minutes: a `sauce` row with `MINIMUM RUNNERS 0`, `MAXIMUM RUNNERS 3`. Also confirm a listener pod exists:

```bash
kubectl get pods -n arc-runners | grep sauce
gh api repos/willfell/sauce/actions/runners --jq '.total_count'
```

Expected: a `sauce-*-listener` pod `Running`. The runner count stays `0` — pods are created on demand.

- [ ] **Step 5: Return to the sauce worktree**

```bash
cd /Users/willfell/Documents/GitHub/sauce/.claude/worktrees/ci-self-hosted-runners
```

---

### Task 2: Pool B — Tartelet ephemeral macOS VMs

**Files:** none in version control. This task configures the Mac mini host.

**Interfaces:**
- Consumes: the same `arc-github-app` — App ID plus the private-key PEM.
- Produces: up to two ephemeral runners answering `runs-on: [self-hosted, macOS, ARM64]` for `willfell/sauce`.

Prerequisites already verified on this host: macOS 15.7.7 (needs ≥13), Apple Silicon, 374 GiB free (needs ~25 GiB).

- [ ] **Step 1: Install Tart and pull the base image**

```bash
brew install cirruslabs/cli/tart
tart --version
tart clone ghcr.io/cirruslabs/macos-sequoia-base:latest sauce-macos-base
tart list
```

Expected: `sauce-macos-base` listed. The pull is ~25 GB — allow time. Use the `-base` variant, not `-xcode`; sauce needs Homebrew, git, and Node-via-`setup-node`, nothing more.

- [ ] **Step 2: Retrieve the GitHub App credentials from the cluster secret**

The same App already backs ARC, so its credentials are in the cluster. Extract them rather than creating anything new:

```bash
kubectl get secret arc-github-app -n arc-runners -o jsonpath='{.data.github_app_id}' | base64 -d; echo
kubectl get secret arc-github-app -n arc-runners \
  -o jsonpath='{.data.github_app_private_key}' | base64 -d > ~/Desktop/arc-github-app.pem
chmod 600 ~/Desktop/arc-github-app.pem
```

If those keys are named differently, list them first with
`kubectl get secret arc-github-app -n arc-runners -o jsonpath='{.data}' | tr ',' '\n'`.

- [ ] **Step 3: Install and configure Tartelet**

Download the latest release from <https://github.com/framna-dk/tartelet/releases> and move `Tartelet.app` to `/Applications`. Configure:

| Tab | Setting | Value |
| --- | --- | --- |
| GitHub | Runner Scope | **Repository** (personal account) |
| GitHub | Owner / account | `willfell` |
| GitHub | Repository | `sauce` |
| GitHub | App ID | value from Step 2 |
| GitHub | Private key | `~/Desktop/arc-github-app.pem` (stored in Keychain) |
| Virtual Machine | VM | `sauce-macos-base` |
| Virtual Machine | Number of VMs | **2** (Apple's hard cap) |

Then delete the PEM from disk — Tartelet holds it in the Keychain:

```bash
rm -f ~/Desktop/arc-github-app.pem
```

- [ ] **Step 4: Start the pool and verify a runner registers**

Start Tartelet, then:

```bash
gh api repos/willfell/sauce/actions/runners \
  --jq '.runners[] | {name, os, status, labels: [.labels[].name]}'
```

Expected: at least one runner, `status: online`, labels including `self-hosted`, `macOS`, `ARM64`. If nothing appears, the App is not installed on `willfell/sauce` — revisit the Prerequisite.

- [ ] **Step 5: Make the pool survive reboot**

System Settings → General → Login Items → add Tartelet. Confirm it is listed.

- [ ] **Step 6: Record the runbook**

This host configuration is not in version control, which the spec flags as a risk. Append the exact settings from Step 3 to `Docs/agent-guides/build-test-verify.md` under a new `### Self-hosted runner pools` heading, so a machine rebuild is reproducible. Commit:

```bash
git add Docs/agent-guides/build-test-verify.md
git commit -m "docs(build-test-verify): record the Tartelet macOS runner pool config

Pool B is a GUI app outside Argo CD, so its configuration cannot be
reconciled from git. This is the runbook to reproduce it after a machine
rebuild."
```

---

### Task 3: Prove both pools before touching any real workflow

**Files:**
- Create then delete: `.github/workflows/runner-smoke.yml`

**Interfaces:**
- Consumes: Pool A (`sauce`) from Task 1, Pool B (`[self-hosted, macOS, ARM64]`) from Task 2.
- Produces: evidence both pools dispatch jobs. Nothing downstream depends on this file; it is removed in Task 6.

This exists because Task 4 flips every real job at once. Finding out then that a pool cannot dispatch would leave the repo with no working CI.

- [ ] **Step 1: Write the smoke workflow**

Modelled on `lab`'s `runner-smoke.yml`. `workflow_dispatch` only — it must never gate anything. No comments.

```yaml
name: runner-smoke

on:
  workflow_dispatch:

jobs:
  linux:
    runs-on: sauce
    steps:
      - uses: actions/checkout@v4
      - name: Runner facts
        run: |
          echo "arch: $(uname -m)"
          echo "host: $(hostname)"
          echo "gh: $(command -v gh || echo MISSING)"
      - name: Install gh
        run: sudo apt-get update -qq && sudo apt-get install -y -qq gh
      - name: Node toolchain
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install deps and prove the arm64 dependency tree resolves
        run: |
          npm install --omit=dev
          node -e 'require("@xenova/transformers"); console.log("transformers ok")'
          gh --version

  macos:
    runs-on: [self-hosted, macOS, ARM64]
    steps:
      - uses: actions/checkout@v4
      - name: Runner facts
        run: |
          echo "arch: $(uname -m)"
          echo "host: $(hostname)"
          sw_vers
      - name: Homebrew is present and writable
        run: |
          brew --version
          brew --prefix
      - name: Node toolchain
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node -v
```

- [ ] **Step 2: Commit and push over SSH**

`.github/workflows/*` is rejected over HTTPS. Confirm the remote first:

```bash
git remote -v
git remote set-url origin git@github.com:willfell/sauce.git
git add .github/workflows/runner-smoke.yml
git commit -m "ci: add a temporary two-pool runner smoke workflow

workflow_dispatch only. Proves both self-hosted pools dispatch before
the real jobs are repointed. Deleted once green."
git push -u origin ci/self-hosted-runners
```

- [ ] **Step 3: Run it and watch both jobs**

```bash
gh workflow run runner-smoke.yml --ref ci/self-hosted-runners
sleep 10
gh run list --workflow=runner-smoke.yml --limit 1
gh run watch "$(gh run list --workflow=runner-smoke.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: both jobs succeed. The `linux` job prints `arch: aarch64` and `gh version 2.45.0`; the `macos` job prints `arch: arm64` and a Homebrew version.

While the macOS job runs, confirm the VM really is ephemeral:

```bash
tart list
```

Expected: a transient clone alongside `sauce-macos-base` during the run, gone afterwards.

- [ ] **Step 4: If a job stays queued**

A job queued more than ~2 minutes means the pool is not answering that label.

```bash
kubectl get pods -n arc-runners | grep sauce
kubectl logs -n arc-runners -l app.kubernetes.io/instance=sauce --tail=50
gh api repos/willfell/sauce/actions/runners --jq '.runners[].labels[].name'
```

Do not proceed to Task 4 until both jobs are green. Task 4 removes the GitHub-hosted fallback entirely.

---

### Task 4: The migration — enforcement harness plus all three workflows

**Files:**
- Create: `platform/test/run-ci-runner-policy.js`
- Modify: `platform/test/preflight-manifest.json`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `platform/test/run-ci-candidate-source.js:68,80,127,264-267`
- Modify: `platform/test/run-codex-autoloop.js`

**Interfaces:**
- Consumes: both pools, proven in Task 3.
- Produces: workflows with no GitHub-hosted runner, and a harness that fails if one reappears. Renames two required checks from `preflight (macos-latest)` / `preflight (ubuntu-latest)` to **`preflight (macos)` / `preflight (linux)`** — Task 5 updates branch protection to match.

This is one task, not several, because the invariant is repo-wide. Splitting it would leave commits where the harness asserts a contract the workflows do not yet meet.

- [ ] **Step 1: Write the failing enforcement harness**

Your CLAUDE.md is explicit that an invariant belongs in a test rather than a comment. This is that test. Create `platform/test/run-ci-runner-policy.js`:

```javascript
#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const WORKFLOW_DIR = path.join(ROOT, ".github/workflows");

const GITHUB_HOSTED = /^(?:ubuntu|macos|windows)-/i;
const ALLOWED_LABELS = new Set(["sauce", "self-hosted", "macOS", "ARM64"]);

let passed = 0;
let failed = 0;

function check(condition, name, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

function workflowFiles() {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
}

// Every runner label a workflow can dispatch to: literal `runs-on:` values plus
// the matrix `runner:` entries an expression-valued `runs-on` resolves through.
// Regex rather than a YAML parser -- harnesses are zero-dependency.
function runnerLabels(source) {
  const lines = String(source).split("\n");
  const found = [];
  const push = (value, line) => {
    const trimmed = String(value).trim().replace(/^['"]|['"]$/g, "");
    if (trimmed) found.push({ value: trimmed, line });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*(?:runs-on|runner):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const raw = match[1].trim();

    if (raw === "") {
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = /^\s*-\s+(.+)$/.exec(lines[j]);
        if (!item) break;
        push(item[1], j + 1);
      }
      continue;
    }

    if (raw.startsWith("[")) {
      raw.replace(/^\[|\]$/g, "").split(",").forEach((token) => push(token, i + 1));
      continue;
    }

    push(raw, i + 1);
  }
  return found;
}

console.log("\n--- CI runner policy: no GitHub-hosted runners ---");

const files = workflowFiles();
check(files.length > 0, "workflow directory is non-empty", WORKFLOW_DIR);

for (const file of files) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), "utf8");
  const labels = runnerLabels(source);

  check(labels.length > 0, `${file} declares at least one runner target`);

  const hosted = labels.filter((entry) => GITHUB_HOSTED.test(entry.value));
  check(
    hosted.length === 0,
    `${file} targets no GitHub-hosted runner`,
    hosted.map((entry) => `line ${entry.line}: ${entry.value}`).join("; ")
  );

  const unknown = labels.filter(
    (entry) => !entry.value.includes("${{") && !ALLOWED_LABELS.has(entry.value)
  );
  check(
    unknown.length === 0,
    `${file} uses only known self-hosted labels`,
    unknown.map((entry) => `line ${entry.line}: ${entry.value}`).join("; ")
  );
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it and verify it FAILS against the current workflows**

```bash
node platform/test/run-ci-runner-policy.js
```

Expected: FAIL. It should name `ci.yml` lines with `ubuntu-latest` / `macos-latest`, plus `codeql.yml` and `release.yml`. If it passes, the harness is not detecting anything — fix it before continuing.

- [ ] **Step 3: Rewrite `ci.yml`**

Replace the `preflight` job header (lines 11–16) with the restructured matrix. The explicit `name:` is **required** — without it GitHub derives the check name from every matrix key, yielding `preflight (linux, sauce)`.

```yaml
  preflight:
    name: preflight (${{ matrix.platform }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: linux
            runner: sauce
          - platform: macos
            runner: [self-hosted, macOS, ARM64]
    runs-on: ${{ matrix.runner }}
    env:
      SAUCE_PREFLIGHT_JOBS: '4'
```

If `runs-on: ${{ matrix.runner }}` fails to resolve the array-valued leg — the job errors with an invalid `runs-on` rather than queueing — fall back to a single label, which is unambiguous because these are the only macOS runners registered to this repository:

```yaml
          - platform: macos
            runner: macOS
```

If you take the fallback, the `hasMacosLeg` regex in Step 8 must match `runner: macOS` instead of the bracketed form. `macOS` is already in the policy harness's `ALLOWED_LABELS`, so Step 1 needs no change.

In the same job, change the macOS-only step's guard:

```yaml
        if: matrix.platform == 'macos'
```

In `pr-title-bump`, change `runs-on: ubuntu-latest` to `runs-on: sauce`.

In `released-formula-smoke`, change `runs-on: macos-latest` to `runs-on: [self-hosted, macOS, ARM64]`, and replace the final cleanup step so it no longer mutates Homebrew. The VM is destroyed after the job, so `brew uninstall` / `brew untap` are both unnecessary and destructive if the pool is ever repointed at a persistent host. Keep the `rm -rf` and its `if: always()`:

```yaml
      - name: Cleanup released formula smoke
        if: always()
        run: |
          rm -rf "$RUNNER_TEMP/sauce-released-formula-vault" 2>/dev/null || true
```

- [ ] **Step 4: Rewrite `codeql.yml`**

Change line 14 only:

```yaml
    runs-on: [self-hosted, macOS, ARM64]
```

This job **cannot** go to Pool A: bundle `codeql-bundle-v2.26.2` ships `linux64`, `osx64`, and `win64` assets only.

- [ ] **Step 5: Rewrite `release.yml`**

Change `runs-on: ubuntu-latest` to `runs-on: sauce` in all three jobs (lines 17, 77, 164). Leave the existing human comments alone.

Add `SAUCE_PREFLIGHT_JOBS` to the two jobs that run preflight. In `prepare-release`, directly under `runs-on: sauce`:

```yaml
    env:
      SAUCE_PREFLIGHT_JOBS: '4'
```

Same block under `tag-and-ship`'s `runs-on: sauce`.

The ARC image has no `gh`, and both jobs call `gh pr merge`. Insert this step immediately **before** `Auto-merge the release PR when checks pass (squash)` in `prepare-release`:

```yaml
      - name: Install gh
        if: steps.diff.outputs.changed == 'true' && steps.cpr.outputs.pull-request-number != ''
        run: sudo apt-get update -qq && sudo apt-get install -y -qq gh
```

And immediately **before** `Auto-merge the tap PR` in `tag-and-ship`:

```yaml
      - name: Install gh
        if: ${{ steps.cpr_tap.outputs.pull-request-number != '' }}
        run: sudo apt-get update -qq && sudo apt-get install -y -qq gh
```

`curl` and `shasum` are already in the image, so the tarball-SHA step needs no change.

- [ ] **Step 6: Run the policy harness and verify it now PASSES**

```bash
node platform/test/run-ci-runner-policy.js
```

Expected: PASS, every check green.

- [ ] **Step 7: Run the existing CI harness and watch it FAIL**

```bash
node platform/test/run-ci-candidate-source.js
```

Expected: FAIL. It asserts the old matrix at line 68, `if: matrix.os == 'macos-latest'` at line 80, and `runs-on: macos-latest` at line 127. It may also throw from `replaceOnce` — that function raises `fixture precondition missing` when a mutation string is absent. Both are expected here.

- [ ] **Step 8: Update `run-ci-candidate-source.js` to the new contract**

Replace the matrix assertion at line 68:

```javascript
  const hasLinuxLeg = /- platform: linux\s*\n\s*runner: sauce\b/.test(body);
  const hasMacosLeg = /- platform: macos\s*\n\s*runner: \[self-hosted, macOS, ARM64\]/.test(body);
  if (!hasLinuxLeg || !hasMacosLeg) {
    errors.push("required linux/macOS self-hosted matrix changed");
  }
  if (/\b(?:ubuntu|macos|windows)-latest\b/.test(body)) {
    errors.push("required preflight still targets a GitHub-hosted runner");
  }
```

Line 80:

```javascript
  if (!candidateStep.includes("if: matrix.platform == 'macos'")) {
```

Line 127:

```javascript
  if (!body.includes("runs-on: [self-hosted, macOS, ARM64]")) {
```

And the mutation fixture at lines 264–267, which proves the harness catches drift off the macOS arm:

```javascript
  const linuxOnlyCandidate = replaceOnce(
    workflow,
    "        if: matrix.platform == 'macos'\n        env:\n          SAUCE_CANDIDATE_CLI:",
    "        if: matrix.platform == 'linux'\n        env:\n          SAUCE_CANDIDATE_CLI:"
  );
  check(
    candidateErrors(linuxOnlyCandidate).length > 0,
    "candidate bootstrap cannot leave the required macOS matrix arm"
  );
```

Rename the `ubuntuOnlyCandidate` binding to `linuxOnlyCandidate` at both its declaration and its use.

- [ ] **Step 9: Verify the CI harness passes again**

```bash
node platform/test/run-ci-candidate-source.js
```

Expected: PASS, including all mutation checks. A `fixture precondition missing` throw means a mutation string in Step 8 does not match the file byte-for-byte — re-read the surrounding lines and correct it.

- [ ] **Step 10: Update the coordinator's check-name fixtures**

`platform/test/run-codex-autoloop.js` uses `preflight (macos-latest)` as a fixture check name in several places. The logic under test is generic, so these pass either way — but they should reflect the real check names.

```bash
grep -n "preflight (macos-latest)" platform/test/run-codex-autoloop.js
```

Replace each occurrence with `preflight (macos)`, then:

```bash
node platform/test/run-codex-autoloop.js
```

Expected: PASS.

- [ ] **Step 11: Wire the new harness into preflight**

Add to `package.json` `scripts`, beside the other `test:` entries:

```json
    "test:ci-runner-policy": "node platform/test/run-ci-runner-policy.js",
```

Add to the `steps` array in `platform/test/preflight-manifest.json`, next to the other CI-contract steps:

```json
    {
      "id": "ci-runner-policy",
      "cmd": ["node", "platform/test/run-ci-runner-policy.js"],
      "lane": "parallel"
    }
```

- [ ] **Step 12: Run the full preflight**

```bash
npm run release:preflight
```

Expected: `PASS — preflight (175/175)`. The count rises by one from the 174 baseline. Any failure here is a real regression — fix it before committing.

- [ ] **Step 13: Commit**

```bash
git add platform/test/run-ci-runner-policy.js platform/test/preflight-manifest.json \
        package.json .github/workflows/ci.yml .github/workflows/codeql.yml \
        .github/workflows/release.yml platform/test/run-ci-candidate-source.js \
        platform/test/run-codex-autoloop.js
git commit -m "ci: move every job onto self-hosted runners

No ubuntu-latest or macos-latest remains in .github/workflows. Pool A is
the ARC scale set 'sauce' (linux/arm64, ephemeral pods); Pool B is
Tartelet's ephemeral Tart macOS VMs, labelled [self-hosted, macOS,
ARM64].

CodeQL moves to macOS rather than the Linux pool because no linux-arm64
CodeQL bundle exists -- codeql-bundle-v2.26.2 ships linux64, osx64 and
win64 only -- and Colima registers qemu-x86_64 rather than Rosetta, so
emulation would take the slow path.

The ARC image has no gh, which release.yml needs twice, so both jobs
install it from Ubuntu 24.04 universe (gh 2.45.0; sudo is passwordless).

The preflight matrix becomes an explicit include with separate platform
and runner keys, because runs-on cannot carry a multi-label runner set
while the same key also discriminates the macOS-only step. The explicit
job name keeps the check names clean; they become preflight (linux) and
preflight (macos). Branch protection contexts are updated to match
before this merges.

released-formula-smoke drops its brew uninstall/untap cleanup: the VM is
destroyed after every job, so the teardown is redundant, and it would be
destructive if the pool were ever repointed at a persistent host.

The invariant is enforced by platform/test/run-ci-runner-policy.js
rather than a comment: it fails if any workflow targets a GitHub-hosted
runner or an unrecognised label."
```

---

### Task 5: Land it without deadlocking branch protection

**Files:** none. This task changes repository settings and merges Task 4.

**Interfaces:**
- Consumes: the renamed checks from Task 4.
- Produces: `main` protected by the new check names, with the migration merged.

**This is the step that can brick the repo.** `main` currently requires two contexts by exact name:

```
["preflight (macos-latest)", "preflight (ubuntu-latest)"]  strict: true
```

Task 4 renames both. Update protection too early and `main` is briefly unguarded; too late and every PR hangs on "Expected — waiting for status to be reported" while the automated release train stalls. The correct order is: open the PR, let the new checks report, then swap the contexts, then merge.

- [ ] **Step 1: Record the current protection so it can be restored**

```bash
gh api repos/willfell/sauce/branches/main/protection > /tmp/main-protection-backup.json
gh api repos/willfell/sauce/branches/main/protection \
  --jq '.required_status_checks.contexts'
```

Expected: `["preflight (macos-latest)","preflight (ubuntu-latest)"]`.

- [ ] **Step 2: Push and open the PR**

```bash
git push
gh pr create --fill --title "ci: move every job onto self-hosted runners"
```

- [ ] **Step 3: Watch the new checks report**

```bash
gh pr checks --watch
```

Expected: `preflight (linux)` and `preflight (macos)` both run and pass, alongside `pr-title-bump` and CodeQL. The PR will still show as blocked — the two old contexts are required and will never report. That is expected and is exactly why Step 4 exists.

If `preflight (macos)` never starts, Pool B is not answering. Re-run Task 2 Step 4.

**Watch the `smart-connections-bridge` step specifically.** It loads `@xenova/transformers` and pulls the `bge-micro-v2` model from HuggingFace. Ephemeral runners carry no cache, so this downloads on every run — the spec flags it as the likeliest source of new latency or flakiness. Compare its duration against the 98.4s whole-suite baseline:

```bash
gh run view "$(gh run list --workflow=ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --log \
  | grep -iE "smart-connections|preflight \(1"
```

If it dominates the run or fails intermittently, that is the PVC-cache follow-up the spec parks — do not fix it inside this migration.

- [ ] **Step 4: Swap the required contexts**

Only once Step 3 is green:

```bash
gh api -X PATCH repos/willfell/sauce/branches/main/protection/required_status_checks \
  -f 'contexts[]=preflight (linux)' \
  -f 'contexts[]=preflight (macos)'
gh api repos/willfell/sauce/branches/main/protection \
  --jq '.required_status_checks.contexts'
```

Expected: `["preflight (linux)","preflight (macos)"]`.

- [ ] **Step 5: Merge**

```bash
gh pr checks
gh pr merge --squash --delete-branch
```

Expected: the PR is now mergeable and merges. If anything goes wrong, restore protection from the Step 1 backup:

```bash
gh api -X PUT repos/willfell/sauce/branches/main/protection \
  --input /tmp/main-protection-backup.json
```

- [ ] **Step 6: Verify the release train still works on the new pool**

The merge to `main` triggers `release.yml`'s `prepare-release` on Pool A — the first real exercise of the `gh` install.

```bash
gh run list --workflow=release.yml --limit 1
gh run watch "$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: success. If the run has nothing releasable it exits early at the diff step, which is also a pass. What must **not** happen is a failure at `Install gh` or `gh: command not found`.

---

### Task 6: Harden and document

**Files:**
- Delete: `.github/workflows/runner-smoke.yml`
- Modify: `Docs/landmines.md`

**Interfaces:**
- Consumes: the merged migration from Task 5.
- Produces: the final security posture and a recorded trap.

- [ ] **Step 1: Require approval for all outside collaborators**

`willfell/sauce` is public with forking enabled. GitHub's guidance is that self-hosted runners should almost never serve public repositories; ephemeral runners plus this setting are the two recommended mitigations, and Tasks 1–2 delivered the first.

Check the current policy — it is `first_time_contributors`, GitHub's default:

```bash
gh api repos/willfell/sauce/actions/permissions/fork-pr-contributor-approval
```

Tighten it to cover every outside contributor, not just first-timers:

```bash
gh api -X PUT repos/willfell/sauce/actions/permissions/fork-pr-contributor-approval \
  -f approval_policy=all_external_contributors
gh api repos/willfell/sauce/actions/permissions/fork-pr-contributor-approval
```

Expected: `{"approval_policy":"all_external_contributors"}`. The equivalent UI path, if the API call is rejected, is **Settings → Actions → General → Fork pull request workflows from outside collaborators → Require approval for all outside collaborators**.

- [ ] **Step 2: Delete the smoke workflow**

Both pools are now proven by real jobs; the temporary proof is redundant.

```bash
git checkout main && git pull
git checkout -b chore/remove-runner-smoke
git rm .github/workflows/runner-smoke.yml
```

- [ ] **Step 3: Record the branch-protection landmine**

Append to `Docs/landmines.md`, following the numbered-entry format of the surrounding file and continuing its numbering:

```markdown
### 34. Renaming a matrix leg renames a required status check
Trigger: restructuring a workflow matrix whose job name feeds a required
status check — e.g. `preflight (macos-latest)` → `preflight (macos)`.
Rule: update `required_status_checks.contexts` on the branch protection
*after* the PR's new checks report green and *before* merging.
Why: protection matches contexts by exact string. Rename them first and
`main` is briefly unguarded; rename them late and every PR hangs forever
on "Expected — waiting for status to be reported", stalling the
automated release train. Back the protection up with
`gh api repos/willfell/sauce/branches/main/protection` before touching it.
```

- [ ] **Step 4: Verify, commit, and merge**

```bash
npm run release:preflight
```

Expected: `PASS — preflight (175/175)`. The runner-policy harness tolerates the deleted file — it iterates whatever is present and requires the directory to be non-empty.

```bash
git add Docs/landmines.md .github/workflows/runner-smoke.yml
git commit -m "chore(ci): drop the temporary runner smoke workflow

Both pools are exercised by real jobs now. Also records the
branch-protection rename trap in landmines."
git push -u origin chore/remove-runner-smoke
gh pr create --fill
gh pr checks --watch
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Final acceptance**

```bash
grep -rn "runs-on" .github/
```

Expected: only `sauce`, `[self-hosted, macOS, ARM64]`, and `${{ matrix.runner }}`. No `ubuntu-latest`, no `macos-latest`.

```bash
gh api repos/willfell/sauce/branches/main/protection --jq '.required_status_checks.contexts'
kubectl get autoscalingrunnersets -n arc-runners
tart list
```

Expected: contexts are `preflight (linux)` and `preflight (macos)`; `sauce` is listed with max 3; `tart list` shows only `sauce-macos-base` with no leftover clones.

---

## Rollback

Every step is reversible. If the homelab proves too unreliable, revert to GitHub-hosted runners by restoring the old `runs-on` values and old protection contexts:

```bash
git revert <migration-commit>
gh api -X PATCH repos/willfell/sauce/branches/main/protection/required_status_checks \
  -f 'contexts[]=preflight (macos-latest)' \
  -f 'contexts[]=preflight (ubuntu-latest)'
```

The runner-policy harness will then fail, which is correct — it is the record of the decision. Remove its manifest step in the same revert.

Pool A can be torn down by deleting `arc-runner-sauce.yaml` from the `lab` repo (Argo prunes it). Pool B by quitting Tartelet and running `tart delete sauce-macos-base`.
