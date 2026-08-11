# Every CI job on our own runners — design

- **Date:** 2026-08-11
- **Workshop version at authoring:** 0.285.1
- **Status:** approved, ready for planning
- **Origin:** a Director directive — *"ensure that every job runs on our runners, we are to not use github runners whatsoever."*
- **Supersedes:** the *Ruled out: migrating CI to the self-hosted runners* section of
  [`2026-08-10-parallel-preflight-design.md`](2026-08-10-parallel-preflight-design.md). See [Why this reopens a one-day-old decision](#why-this-reopens-a-one-day-old-decision).

## Goal

Move all seven GitHub Actions jobs in `willfell/sauce` off GitHub-hosted runners and onto
infrastructure we own, with no `ubuntu-latest` / `macos-latest` remaining anywhere in
`.github/workflows/`.

This is a **posture** goal, not a performance or cost goal. Nothing below claims sauce's CI
gets faster or cheaper. It claims sauce stops depending on GitHub-hosted compute.

## Why this reopens a one-day-old decision

The parallel-preflight spec ruled this migration out on 2026-08-10 and closed with *"Revisit
self-hosted runners if and only if sauce grows a job that requires in-cluster identity. Speed
is not a reason."* That analysis was sound and is not being called wrong. Three things moved:

| Prior finding | Status on 2026-08-11 |
| --- | --- |
| "It would be slower. Native on the mini is 333s versus GitHub's `ubuntu-latest` at 160s." | **Stale.** That measured the serial preflight. The manifest runner shipped in v0.285.0 (2.08×). Measured on this mini today: **98.4s for 174/174 steps**. |
| "An ARC pod capped at 2 CPU… would be slower still." | Addressed by sizing. The suite averages **162% CPU over 98.4s** — spawn- and IO-bound, not CPU-starved. This design specifies 4 CPU, not 2. |
| "A host-level macOS runner… would sit alongside `~/obsidian` and the user's SSH keys." | **Correct, and decisive.** This design does not use a host-level macOS runner. Ephemeral macOS VMs (Tartelet/Tart) were not considered in the prior analysis. |

Findings that still stand and are **accepted, not solved**:

- **No cost lever.** `willfell/sauce` is public; GitHub-hosted minutes are free and unlimited,
  macOS included.
- **No queueing lever.** Sampled queue delay was ≤16s, median 3–4s.
- **Availability.** Sauce's release train is fully automatic and runs unattended. After this
  change, a down Mac mini, Colima, or k3s cluster means no CI, no tag, and no Homebrew ship.
  `willfell/finance` deliberately declined this trade. Sauce is taking it deliberately.

The directive supplies a reason the prior spec never weighed: independence from GitHub-hosted
infrastructure as an end in itself. That is a legitimate basis for the change and the only one
claimed here.

## Current state

Seven jobs, three workflows, all on GitHub-hosted runners:

| Workflow | Job | Runner | Notes |
| --- | --- | --- | --- |
| `ci.yml` | `preflight` | matrix `[macos-latest, ubuntu-latest]` | full `release:preflight`; macOS leg also validates the candidate CLI and a fresh-vault bootstrap |
| `ci.yml` | `pr-title-bump` | `ubuntu-latest` | one node script |
| `ci.yml` | `released-formula-smoke` | `macos-latest` | `brew tap`/`install`; `continue-on-error`, non-required |
| `codeql.yml` | `analyze` | `ubuntu-latest` | `github/codeql-action@v4`, javascript-typescript |
| `release.yml` | `prepare-release` | `ubuntu-latest` | preflight, `create-pull-request`, `gh pr merge` |
| `release.yml` | `tag-and-ship` | `ubuntu-latest` | preflight, tag, `curl`+`shasum`, tap PR, `gh pr merge` |
| `release.yml` | `rebaseline-seed` | `ubuntu-latest` | seed rebaseline, push to main |

## Constraints discovered by measurement

Each of these was verified against live infrastructure, not inferred.

**No `sauce` runner exists.** `gh api repos/willfell/sauce/actions/runners` returns
`total_count: 0`. The cluster hosts three scale sets — `lab` (0→3), `finance` (0→2),
`egnyte-mcp` (0→2). Flipping `runs-on` before onboarding queues every job indefinitely.

**The ARC runner image is minimal.** Probed `ghcr.io/actions/actions-runner:latest` on the
cluster:

```
arch: aarch64      os: Ubuntu 24.04.4 LTS
present: curl, shasum, sha256sum, git, jq, python3, unzip, tar, sudo (passwordless)
absent:  gh, node, npm, make, gcc, g++, wget
```

`node`/`npm` are supplied by `actions/setup-node@v4`. **`gh` is not**, and `release.yml`
invokes `gh pr merge` in two jobs. Verified fix: `sudo apt-get install -y gh` yields
`gh 2.45.0` from Ubuntu 24.04 universe.

**CodeQL cannot run on linux/arm64.** The current bundle (`codeql-bundle-v2.26.2`) ships
`linux64`, `osx64`, and `win64` assets only — there is no `linux-arm64` build. Corroborated by
[github/codeql#16692](https://github.com/github/codeql/issues/16692),
[github/codeql#20616](https://github.com/github/codeql/issues/20616), and
[codeql-cli-binaries#157](https://github.com/github/codeql-cli-binaries/issues/157). The
documented workaround is `--platform=linux/amd64` emulation, described as prone to severe
performance degradation. Our Colima VM registers `qemu-x86_64` binfmt, **not** Rosetta, so
emulation here would take the slow path. **CodeQL must therefore run on macOS.**

**ARC cannot host macOS, at any configuration.** Custom images are supported — ARC's own ADR
sets the contract (runner binary and `run.sh` present, correct working directory) — but
containers share the host kernel, and the k3s node is Linux `6.8.0-117-generic` inside Colima.
No macOS container image exists from any vendor. macOS CI requires a VM, which
`gha-runner-scale-set` does not orchestrate.

**Node dependencies are clean on arm64.** `npm install --omit=dev` of sauce's three
dependencies on `linux/arm64` succeeds — `added 115 packages in 10s`, and
`require("@xenova/transformers")` loads. `sharp` and `onnxruntime-node` both resolve aarch64
prebuilds; no compiler needed, which matters given the image has none.

**Preflight baseline on this host:** `PASS — preflight (174/174), total 98.4s`,
`87.45s user 72.19s system 162% cpu`. 2 serial steps, 172 parallel.

**Public-repo exposure is real.** `willfell/sauce` is public with forking enabled (0 forks
today). GitHub's guidance is explicit: *"Self-hosted runners should almost never be used for
public repositories… any user can open pull requests against the repository and compromise the
environment,"* with the two mitigations being **ephemeral runners** and requiring approval for
all outside collaborators. This rules out any persistent host-level runner.

**Homebrew cannot be shared with a locked-down account.** `/opt/homebrew` is `willfell:admin`,
mode `drwxr-xr-x`. A non-admin service account cannot drive `brew`. Granting it `admin`
defeats the isolation; a private Homebrew prefix forces the formula's `depends_on "node"` to
build Node from source. Ephemeral VMs dissolve this constraint entirely.

## Architecture

Two pools, both self-hosted, split strictly by what each can physically run.

```
                 github.com/willfell/sauce  (Actions service)
                    ▲ outbound long-poll         ▲ outbound long-poll
                    │                            │
┌───────────────────┴──────── Wills-Mac-mini (14 CPU / 64 GiB) ──┴──────────────┐
│                                                                               │
│  Colima k3s VM (8 CPU / 24 GiB, Linux 6.8, aarch64)                           │
│    arc-systems: gha-runner-scale-set-controller  (already running)            │
│    arc-runners: scale set "sauce"  → 0..3 ephemeral pods   [POOL A]           │
│                                                                               │
│  macOS host                                                                    │
│    Tartelet  → up to 2 ephemeral Tart macOS VMs            [POOL B]           │
│                clone → boot → register → one job → destroy                    │
└───────────────────────────────────────────────────────────────────────────────┘
```

Both pools authenticate with the **same existing `arc-github-app`**. Tartelet's documented
requirement for personal accounts — `Repository: Administration (Read & write)` plus
`Repository: Metadata (Read)` — is identical to what that App already holds for ARC. No new
credential, no PAT.

### Pool A — `sauce` (ARC, linux/arm64, ephemeral)

New file in the **`lab`** repo: `k8s/argocd-apps/arc-runner-sauce.yaml`, following the three
sibling Applications (OCI chart `gha-runner-scale-set` pinned `0.14.2`, namespace
`arc-runners`, sync-wave `1`, `ServerSideApply=true`, `CreateNamespace=true`, automated sync
with prune and selfHeal), with `releaseName: sauce` and
`githubConfigUrl: https://github.com/willfell/sauce`.

Two deliberate divergences from the siblings:

1. **No `containerMode: dind`.** Every sauce job is pure Node; nothing builds an image. Omitting
   dind removes a privileged sidecar from a public repo's runner and shortens pod start.
2. **Larger resources:** requests `1 CPU / 2Gi`, limits `4 CPU / 8Gi`, `maxRunners: 3` — versus
   the siblings' `500m/1Gi` → `2/4Gi`. Justified by the 174-step suite; see
   [Resource budget](#resource-budget).

Per the global configuration-file convention, this file carries **no comments**; its rationale
lives in the commit message.

### Pool B — Tartelet ephemeral macOS VMs

On the Mac mini (macOS 15.7.7, Apple Silicon, 374 GiB free — all prerequisites satisfied):

1. `brew install cirruslabs/cli/tart`
2. Pull a base image (`ghcr.io/cirruslabs/macos-sequoia-base`, ~25 GB) — Homebrew and dev tools
   preinstalled; the Xcode variant is not needed
3. Install Tartelet.app; configure Repository scope, account `willfell`, repository `sauce`,
   App ID + private key from the existing `arc-github-app`, **2 virtual machines**
4. Register as a login item so the pool survives reboot

Lifecycle per job: clone VM → boot → download and register the runner → run exactly one job →
destroy the VM. Nothing persists between jobs.

Tartelet does not expose custom runner labels, so these runners carry the stock
`self-hosted, macOS, ARM64` label set and are addressed as
`runs-on: [self-hosted, macOS, ARM64]`.

Tart is licensed **Fair Source 100**: free for personal machines, paid only for organizational
server fleets exceeding 100 CPU cores. A single personal 14-core Mac mini is well inside the
free tier.

## Job placement

| Workflow | Job | New runner | Rationale |
| --- | --- | --- | --- |
| `ci.yml` | `preflight` | matrix: `sauce` + `[self-hosted, macOS, ARM64]` | preserves both-platform coverage |
| `ci.yml` | `pr-title-bump` | `sauce` | trivial; ephemeral Linux is ideal |
| `ci.yml` | `released-formula-smoke` | `[self-hosted, macOS, ARM64]` | requires real Homebrew |
| `codeql.yml` | `analyze` | `[self-hosted, macOS, ARM64]` | **forced** — no linux-arm64 CodeQL bundle exists |
| `release.yml` | `prepare-release` | `sauce` | ephemeral; needs `gh` installed |
| `release.yml` | `tag-and-ship` | `sauce` | ephemeral; `curl`/`shasum` present, needs `gh` |
| `release.yml` | `rebaseline-seed` | `sauce` | ephemeral |

### Matrix restructuring

`runs-on: ${{ matrix.os }}` cannot carry a multi-label runner set while `matrix.os` is also the
discriminator for `if: matrix.os == 'macos-latest'`. The matrix becomes an explicit `include`
with separate platform and runner keys:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - platform: linux
        runner: sauce
      - platform: macos
        runner: [self-hosted, macOS, ARM64]
runs-on: ${{ matrix.runner }}
```

The macOS-only validation step's guard changes from `if: matrix.os == 'macos-latest'` to
`if: matrix.platform == 'macos'`.

If array-valued `runs-on` from a matrix expression misbehaves, the fallback is the single
label `runner: macOS`, which matches these runners unambiguously because they are the only
macOS runners registered to this repository.

## Workflow body changes beyond `runs-on`

**`gh` installation** in `prepare-release` and `tag-and-ship`, before the first `gh pr merge`:

```yaml
- name: Install gh
  run: sudo apt-get update -qq && sudo apt-get install -y -qq gh
```

Inline rather than a composite action — two call sites do not justify a new
`.github/actions/` surface.

**`released-formula-smoke` returns to a true clean-install test.** On a GitHub-hosted VM the
job installed and then uninstalled to leave no trace; on an ephemeral Tart VM the teardown is
free, so the job keeps `brew tap` → `brew install` → `sauce help` → fresh-vault bootstrap and
**drops the `brew uninstall` / `brew untap` cleanup steps entirely**. The VM is destroyed
regardless. This is both safer and higher-fidelity than the persistent-host alternative, which
would have had to degrade to `brew reinstall` in place.

## Resource budget

| Consumer | CPU | Memory |
| --- | --- | --- |
| Colima k3s VM (existing) | 8 | 24 GiB |
| 2 × Tart macOS VM | ~8 | ~16 GiB |
| **Host total** | **14** | **64 GiB** |

CPU is oversubscribed under simultaneous peak load; memory is not. Colima is idle most of the
time, and the 2-VM cap bounds the macOS side. Within the cluster, `sauce` pods at `4 CPU / 8Gi`
limits and `maxRunners: 3` share the same 8 Colima CPUs as `lab`, `finance`, and `egnyte-mcp`;
requests stay low (`1 CPU / 2Gi`) so scheduling remains feasible and real usage sits far below
the limits.

Preflight concurrency is pinned via the runner's existing `--jobs` / `SAUCE_PREFLIGHT_JOBS`
control rather than left at `os.availableParallelism()`, which reports the node's core count
and would over-spawn relative to the pod's 4-CPU limit.

`SAUCE_PREFLIGHT_JOBS=4` is set as a job-level `env:` on **every** job that runs
`npm run release:preflight` — `ci.yml`'s `preflight` (both matrix legs) and `release.yml`'s
`prepare-release` and `tag-and-ship`. Pinning both legs to the same value, rather than letting
the macOS leg autodetect, keeps concurrency deterministic across platforms and avoids depending
on how many cores Tartelet hands a VM. It is deliberately **not** set in the Argo Application:
the cap belongs to the workload, not to the runner definition.

## Cutover sequence

Ordering is load-bearing: flipping `runs-on` before the runners exist queues every job forever.

1. **Director, in the browser:** add `willfell/sauce` to the `arc-github-app` installation.
   This single action serves both pools.
2. **`lab` repo:** add `k8s/argocd-apps/arc-runner-sauce.yaml`; merge; confirm Argo CD syncs and
   `kubectl get autoscalingrunnersets -n arc-runners` lists `sauce`.
3. **Mac mini:** install tart, pull the base image, install and configure Tartelet, confirm a
   macOS runner registers against the repository.
4. **Prove both pools** with a temporary `workflow_dispatch`-only workflow in the **`sauce`**
   repo, modelled on `lab`'s `runner-smoke.yml` — one job per pool asserting arch, hostname, and
   toolchain, plus a `brew --version` check on the macOS leg. Delete it once both are green.
5. **`sauce` repo:** the workflow PR flipping every `runs-on`, restructuring the matrix, adding
   the `gh` install steps, and simplifying the formula smoke.
6. **Director, in the browser:** Settings → Actions → **Require approval for all outside
   collaborators**.

Step 5 pushes `.github/workflows/*`, which is rejected over HTTPS without the `workflow` token
scope; push over the `git@github.com` SSH remote.

## Verification

- `kubectl get autoscalingrunnersets -n arc-runners` lists `sauce` with `0` minimum, `3` maximum.
- The smoke workflow from step 4 reports `aarch64` on the `sauce` pool and `arm64` macOS on the
  Tartelet pool.
- A pull request runs `preflight` on both matrix legs, `pr-title-bump`, and `codeql/analyze`,
  all green, with no GitHub-hosted runner in any job's annotations.
- `grep -rn "runs-on" .github/` returns no `ubuntu-latest` and no `macos-latest`.
- A release cycle completes end to end: `prepare-release` opens the standing PR, and on merge
  `tag-and-ship` tags and opens the tap PR — proving `gh` works on the `sauce` pool.
- After a Tart VM is destroyed, `tart list` shows no leftover clones.

## Risks

**The `smart-connections-bridge` preflight step is the one to watch.** It loads
`@xenova/transformers` and pulls the `bge-micro-v2` model from HuggingFace. Ephemeral pods
carry no cache, so this downloads on every run — added latency plus an external network
dependency inside a previously self-contained suite. Mitigation if it proves slow or flaky: a
ReadWriteMany PVC mounted at the transformers cache path, deliberately out of scope for v1.

**Release availability now depends on the homelab.** Accepted; see
[Why this reopens a one-day-old decision](#why-this-reopens-a-one-day-old-decision).

**The 2-VM cap serialises macOS work.** A push to main wants macOS preflight, CodeQL, and the
formula smoke concurrently; only two can run at once. Expect longer main-branch wall clock.
This is an Apple limit (`VZErrorDomain` code 6), not a tunable.

**Tartelet is a GUI app outside GitOps.** Unlike the ARC pool, it is not reconciled by Argo CD
and its configuration is not in version control. Its state must be reproduced by hand after a
machine rebuild; the runbook in the implementation plan is the mitigation.

**No cache between ephemeral runs.** `npm install` repeats every job on both pools. Measured at
10s for the Linux dependency set, so this is accepted rather than solved.

## Out of scope

- A custom ARC runner image with `gh` and Node preinstalled. The prior spec measured a prebaked
  image at ~15s of benefit; `apt-get install gh` is simpler than maintaining an image and a
  registry push.
- A PVC cache for the transformers model or `node_modules`.
- Onboarding any other repository to a `sauce`-style pool.
- Migrating `lab`, `finance`, or `egnyte-mcp` off their remaining `ubuntu-latest` jobs.
- Enabling Rosetta binfmt in Colima to make x86_64 emulation viable. It would not help — CodeQL
  moves to macOS regardless, and nothing else needs amd64.
