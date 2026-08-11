# Parallel preflight runner — design

- **Date:** 2026-08-10
- **Workshop version at authoring:** 0.284.3
- **Status:** approved, ready for planning
- **Origin:** a proposal to move sauce's pipelines onto the Mac mini's self-hosted GitHub runners. Measurement redirected the work; see [Ruled out](#ruled-out-migrating-ci-to-the-self-hosted-runners).

## Problem

`npm run release:preflight` is 171 shell steps joined by `&&` — 163 direct `node` invocations plus 8 `npm run` wrappers. It runs strictly serially on one core.

Measured on this Mac mini (14 cores, 64 GB):

```
real 332.67s    user 90.48s    sys 78.03s
```

333s of wall clock against 168s of CPU. Roughly half the elapsed time is not computation at all — it is serialization and filesystem I/O. Average utilization is about **0.5 of 14 available cores**. Bare `node` process startup accounts for only ~6s of the total (34ms × 171), so this is filesystem-bound work executed single-file, not a process-spawn problem.

Where that cost is paid:

| Consumer | Occurrences | Cost |
| --- | --- | --- |
| Coordinator merge gate (`scripts/autoloop/codex-coordinator.js:6384`) | 2× per slice — `release:preflight`, then `release:preflight-bumped`, which runs the full suite a second time on the bumped tree | **666s** |
| CI `preflight (macos-latest)` | 1× per PR, 1× per release PR | 313s each |
| CI `preflight (ubuntu-latest)` | same | 160s each |
| `release.yml` `prepare-release` | 1× per cycle | 176s |
| `release.yml` `tag-and-ship` | 1× per shipped release | 196s |

The loop ships 8–16 releases on an active day (16 on 2026-08-02, 10 on 08-03, 8 on 08-04). On a 16-release day the local gate alone burns ~3 hours of single-core wall clock on a machine with 14 idle cores, and the macOS CI legs add ~2h47m to the path the loop waits on.

The suite is embarrassingly parallel. The longest single harness is `run-codex-autoloop.js` at **65.8s**, which sets the floor for any concurrent scheduling. 333s of work over a 66s pole is a realistic **~4.3x**.

### Parallel-safety audit

The suite is already safe to run concurrently, by construction:

- **290 unique temp directories** — 191 `mkdtempSync` + 99 `mkdtemp` across the harnesses. `mkdtemp` appends random characters, so the prefixes seen in the source (`sauce-seed-vault-`, `v097-r8-vault-`, …) cannot collide.
- **`platform/test/seed-vault` is read-only.** `run-seed-migrations.js` holds `SEED_DIR` but only reads from it, calling `helpers.copyDir(SEED_DIR, vault)` into a temp vault before mutating. `run-seed.js` and `run-release-bumper.js` likewise build into `mkdtemp` roots.
- **Every hardcoded `/tmp/<name>` path is owned by exactly one harness** — `/tmp/coordinator` (`run-delivery-status.js`), `/tmp/es3-shadow` and `/tmp/bgd-cutover` (`run-codex-autoloop.js`), `/tmp/cleanup-` (`run-epic-dashboard.js`), `/tmp/residue.md` (`run-operator-station.js`). No two harnesses share a fixed path.

That third property is the fragile one. It holds today by luck rather than by rule, and a future harness adopting `/tmp/coordinator` would introduce a silent cross-test race. The design converts it into an enforced invariant.

`run-sticky-notes-render-guards.js`, previously recorded as failing ~50% of the time on clean `main`, passed 6/6 consecutive runs during this audit. We are not parallelizing on top of a known-unstable chain.

## Ruled out: migrating CI to the self-hosted runners

Recorded so the analysis is not repeated. The original proposal was to move sauce's pipelines onto the Actions Runner Controller pool on the Mac mini, mirroring `willfell/finance`, and to build a runner image with dependencies preinstalled.

Measurement did not support it:

- **No cost lever.** `willfell/sauce` is **public**, so GitHub-hosted minutes are free and unlimited, macOS included. `willfell/finance` is **private**, where macOS bills at 10×. That motivation does not transfer.
- **No queueing lever.** Maximum queue delay across ~100 sampled jobs was **16 seconds**, median 3–4s, even with the loop firing a run every ~3 minutes.
- **A prebaked image is worth ~15 seconds.** Checkout + `setup-node` + `npm install` totals 11–17s of a 313s job. Preinstalled dependencies cannot recover time that is not being spent.
- **It would be slower.** Native on the mini is 333s versus GitHub's `ubuntu-latest` at 160s. An ARC pod capped at 2 CPU, on Colima's overlay filesystem, running a ~50% filesystem-bound workload, would be slower still.
- **It cannot serve the critical path.** The ARC pool is linux/arm64. The dominant CI leg is `macos-latest`, which validates the brew formula and darwin vault bootstrap — sauce's actual delivery surface. No linux runner can replace it.
- **Availability.** Sauce's release train is fully automatic and runs unattended overnight. Finance deliberately kept its merge-gating checks on `ubuntu-latest` for exactly this reason, using self-hosted only for the one job that *requires* in-cluster identity (registry DNS, `kubectl` to Argo CD). Sauce has no such job — it ships to a Homebrew tap.
- **Public-repo posture.** GitHub advises against self-hosted runners on public repositories, since a fork's PR can execute arbitrary code on the runner. ARC's ephemeral sandboxed pods absorb most of this; a host-level macOS runner would not, and would sit alongside `~/obsidian` and the user's SSH keys. Current exposure is small (0 forks, all PRs from `willfell` or Dependabot on same-repo branches) but it is one stranger's fork away and changes silently.

A follow-up idea — onboarding sauce to ARC for a nightly soak and a non-required mirror — was also dropped. It would re-run the same suite CI already runs, on linux/arm64, a platform sauce does not ship to; it would compete with this design for the same 8 Colima CPUs once the mini's cores are actually busy; and it would add a fourth Argo app, a GitHub App installation, a workflow, and image drift for a benefit that could not be quantified above zero.

**Revisit self-hosted runners if and only if sauce grows a job that requires in-cluster identity.** Speed is not a reason.

## Design

### The manifest

The step list moves out of `package.json` into `platform/test/preflight-manifest.json` — the declarative list it has effectively been all along, minus the shell operators.

```json
{
  "schema_version": "1.0.0",
  "steps": [
    { "id": "codex-autoloop", "cmd": ["node", "platform/test/run-codex-autoloop.js"], "lane": "parallel" }
  ]
}
```

- `id` — unique, stable, used in output and in the summary table.
- `cmd` — argv array, executed without a shell.
- `lane` — `"parallel"` (default, may be omitted) or `"serial"`.

Steps are authored **heaviest-first** — `codex-autoloop` (66s), `seed-migrations` (23s), `integration-smoke` (19s), `helper-cases` (17s) — so the long pole starts at t=0 and the tail packs behind it. This is dispatch order, not a scheduler: no duration cache, no learned state, no persisted timings.

`release:preflight` becomes `node scripts/run-preflight.js`. The script name, invocation, and exit-code contract are unchanged, so CI, `release.yml`, and the coordinator gate all keep working untouched.

### The runner

`scripts/run-preflight.js` — a work queue over N workers.

- **Concurrency** defaults to `os.availableParallelism?.() ?? os.cpus().length` — the fallback is required because `package.json` declares `engines.node >= 18` and `availableParallelism` only landed in Node 18.14. Overridable by `--jobs N` or `SAUCE_PREFLIGHT_JOBS`. The coordinator can reserve headroom later if the box proves contended; no such tuning ships in this change.
- **Serial lane** runs to completion before the parallel lane begins. It is empty at launch and exists as the escape hatch for any step the soak proves unsafe.
- **Output is buffered per step** and printed as one contiguous block on completion. Never interleaved.
- **`--jobs 1`** reproduces today's serial behavior exactly. This is both the debugging contract and the rollout mechanism.

### Failure semantics

Deliberately conservative, because the highest-stakes consumer is an unattended merge gate. A flaky gate is worse than a slow gate.

- **No auto-retry, ever.** Retrying is precisely what would mask a concurrency-coupling bug and convert it into a rare mystery. A step fails once, it fails.
- **On first failure:** stop dispatching new steps, let in-flight steps finish, exit nonzero.
- **Print the failing step's full buffered output**, then a summary table of step / duration / verdict for everything that ran.
- **Triage protocol:** any failure seen in parallel is re-run with `--jobs 1`. If it reproduces, it is a real bug. If it does not, it is coupling — fix it, or move that step to the `serial` lane.

Parallel execution improves attribution here rather than degrading it. Today a failure mid-chain tells you nothing about what the remaining 100 steps would have done.

### Enforcing the invariant

`scripts/check-orphan-harnesses.js` currently reads `package.json` scripts to assert every `platform/test/run-*.js` is registered. It must change regardless, since the step list is moving. It gains a second assertion at the same time:

1. Every `run-*.js` is registered — in the manifest's steps **or** in a `package.json` script. This preserves today's exact semantics.
2. No fixed `/tmp/<name>` literal appears in two different harnesses.

The second is what keeps parallelism correct as harnesses are added.

Note that today the guard's registration source is `package.json` scripts, and several harnesses (`run-cli.js`, `run-migrate.js`, and others) appear there *only* inside the preflight chain string — so moving the chain out is precisely what forces this change.

Assertion 1 is deliberately the union, not "must be in the manifest." **Seven harnesses are registered via `test:*` scripts but are not in the preflight chain at all** — `run-install.js`, `run-project-dashboard.js`, `run-project-dashboard-heal.js`, `run-task-trip-list.js`, `run-trip-dashboard.js`, `run-trip-entry-list.js`, `run-trip-links.js`. A manifest-only assertion would fail on day one. Whether those seven *should* gate is a real question, and a pre-existing one; it is explicitly out of scope here, since answering it means changing what preflight covers rather than how fast it runs.

`platform/test/run-orphan-harnesses.js` exercises the exported `orphanHarnesses(harnesses, registered)` as a pure function against synthetic inputs; it does not read `package.json` itself. It therefore needs changing only if that signature changes, plus new coverage for the `/tmp`-collision assertion.

### Schema registration

`platform/schemas-index.json` gains an entry for the manifest, following the precedent of the tooling contracts already registered from `scripts/` (`autoloop-durable-batch-ledger`, `autoloop-card-lease`, `loop-plugin-binding-config`):

```json
{
  "id": "preflight-manifest",
  "kind": "data-file",
  "owner": { "type": "workshop" },
  "source": "platform/test/preflight-manifest.json",
  "consumers": [
    "scripts/run-preflight.js",
    "scripts/check-orphan-harnesses.js"
  ]
}
```

`scripts/lint-schemas.js` validates registered entries but does not scan for unregistered ones, so this is convention rather than enforcement — it is followed because the equivalent tooling contracts follow it.

## Rollout

The risky part is isolated into a single revertible line.

1. **Land the runner with concurrency off.** Ship `preflight-manifest.json` and `run-preflight.js` with the default at `--jobs 1`. Behavior is identical to today's chain. This step proves only that the manifest is complete and that sequencing and exit codes are correct.
2. **Update the lint** — `check-orphan-harnesses.js` and `run-orphan-harnesses.js` read the manifest and assert both invariants.
3. **Soak for coupling.** Run parallel preflight ~10 consecutive times. Any nondeterministic failure is a coupling bug: fix it, or move the step to the `serial` lane. This is the acceptance gate for step 4.
4. **Flip the default** to `os.availableParallelism()`. One line, its own commit, instantly revertible.
5. **Register the schema entry.**

## Testing

`platform/test/run-preflight-runner.js` — a new harness covering the runner's own logic against **synthetic fast steps**, not the real 171. The runner's mechanics and the suite's contents are separate concerns, and a harness that shells out to the real suite would be untestable in practice.

Coverage:

- Serial lane completes before the parallel lane begins.
- `--jobs 1` executes in manifest order.
- Concurrency is bounded by `--jobs N`.
- A failing step yields a nonzero exit, halts dispatch of new steps, and allows in-flight steps to finish.
- Step output is contiguous, never interleaved.
- The summary table reports every step that ran, with verdicts.
- A manifest referencing a missing harness fails loudly.

Wired into the manifest itself, like every other harness.

## Expected outcome

| Consumer | Today | After |
| --- | --- | --- |
| Coordinator gate (2× per slice) | 666s | ~150s |
| CI preflight (macos-latest) | 313s | ~110s |
| CI preflight (ubuntu-latest) | 160s | ~70s |
| `prepare-release` / `tag-and-ship` | 176s / 196s | ~75s each |

On a 16-release day this removes roughly 3–4 hours of wall clock from the loop, most of it on the Mac mini. CI gains are smaller and core-bound: GitHub's hosted runners have 3–4 vCPU, so expect ~110s on macOS rather than the ~75s achievable on 14 cores.

## Risks

| Risk | Mitigation |
| --- | --- |
| Hidden inter-test coupling surfaces as intermittent gate failures | Ship serial first; 10-run soak as the acceptance gate; no auto-retry; `serial` lane escape hatch; `--jobs 1` triage contract |
| A new harness introduces a shared fixed `/tmp` path | Enforced by the extended `check-orphan-harnesses.js` |
| Manifest and `package.json` drift during migration | The orphan check asserts exact one-to-one coverage of `run-*.js` |
| Contention with other work on the mini | `--jobs` / `SAUCE_PREFLIGHT_JOBS` override; coordinator tuning deferred until measured |
| Regression in the coordinator's merge gate | The gate is untouched — same script name, same exit-code contract |

## Non-goals

- Sharding `run-codex-autoloop.js` to lower the 66s floor. Worth revisiting after measuring the real parallel run; not needed for the 4.3x.
- Recorded-duration or adaptive scheduling. Static heaviest-first ordering is sufficient and carries no state.
- Trimming the CI matrix so each OS leg runs a different subset. A real option with a real cross-platform coverage trade-off; deferred, and possibly unnecessary once this lands.
- Any change to `.github/workflows/`, the release pipeline, or the coordinator.
- Onboarding sauce to the ARC runner pool.
