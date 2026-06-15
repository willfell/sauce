---
purpose: Day-to-day dev workflow for the Sauce workshop. Local-clone vs brew. Per-vault subscription cadence. The four v0.112.0 scripts (workshop-status, regen-cycle-status, scaffold-behavioral-harness, dev-sync). When to use each.
load_when: First session in this workshop, picking up a cycle in progress, after long absence, or whenever a `scripts/*` invocation is unclear.
---

# Dev workflow

This guide covers the operational layer between [`build-test-verify.md`](build-test-verify.md) (per-cycle release protocol) and [`vault-paths.md`](vault-paths.md) (absolute paths reference). It assumes you know what mechanisms and blueprints are; if not, read [`architecture.md`](architecture.md) first.

## First thing in every session

```bash
npm run status        # or: node scripts/workshop-status.js
```

One-shot survey in <250ms — workshop version, blueprint versions, branch + sync state, recent cycles, in-flight pointers, carry-forwards, cached harness gate. Use this BEFORE running `git log` + reading manifests + scanning `Docs/plans/` manually. It's the same data, presented in one screen.

Flags worth knowing:
- `--fresh` — re-run helper-cases + behavioral harness and refresh the cache. Slow (~30s). Use after picking up a cycle that may have intervening work.
- `--json` — emit machine-readable JSON. Pipe into `jq` or read in another script.
- `--no-color` — disable ANSI codes. Auto-detected for non-TTY; force off for CI / piped consumers.

## Workshop vs consumer vault layout

| Concept | Workshop | Consumer vault |
|---|---|---|
| Root | `/Users/willfellhoelter/projects/repos/sauce` | e.g. `/Users/willfellhoelter/notes/sauce/headspace-sauce` |
| Source of truth for | mechanisms + blueprints + tests + this guide | per-user content under module-directory namespaces |
| Self-installs? | Yes (dogfood) — but only subscribes to a subset of blueprints | Yes — subscribes to whichever blueprints the engagement needs |
| Modifies platform code? | YES — this is where edits happen | NO — installer overwrites consumer copies on every run |

The workshop is its OWN first consumer (workshop dogfood). Look at `ranch/platform-subscription.json` in the workshop to see what the workshop subscribes to (it deliberately omits `finance` for example — finance is consumer-vault-only).

## Local-clone vs brew install

The workshop ships to Homebrew via the `willfell/homebrew-sauce` tap. Consumer vaults can resolve their `workshop_relative_path` to EITHER `/opt/homebrew/opt/sauce/libexec` (brew) OR a local clone (`/Users/willfellhoelter/projects/repos/sauce`). The two consumer vaults on this machine point at the local clone for daily-cycle dev workflow.

**Currently** the brew tap formula is stale at v0.84.0 (we're at workshop 0.111.3+); 27 versions behind. Local-clone is the only realistic deploy path until the tap is bumped. See [`Docs/landmines.md`](../landmines.md) for the asking-before-acting policy around brew operations.

**Quick check** — look at a consumer vault's `Docs/Meta/platform-config.json`:
```json
{
  "workshop_relative_path": "/Users/willfellhoelter/projects/repos/sauce"  // local-clone
}
```
vs
```json
{
  "workshop_relative_path": "/opt/homebrew/opt/sauce/libexec"  // brew
}
```

## Per-vault subscription cadence

When workshop ships a new version, consumer vaults need to re-pin and re-install:

```bash
cd /Users/willfellhoelter/notes/sauce/<vault-name>
sauce update --bump-pins   # rewrites ranch/platform-subscription.json pins
sauce install              # runs the installer against the new pin map
```

The `sauce update --bump-pins` command preserves explicit version pins (anything not at `latest`) but advances `latest` pins to the workshop's current version. After install, run `sauce status` from inside the consumer vault to confirm drift is gone.

**`scripts/dev-sync.sh`** automates this across multiple consumer vaults — see § dev-sync below.

## Workshop self-install dogfood

After any cycle that touches install.js / manifests / blueprint files, run the workshop dogfood:

```bash
node platform/install.js --vault . --auto-approve
```

This installs the workshop into itself per `ranch/platform-subscription.json`. ~4 seconds, ~80 history entries. Catches manifest entry order, materialization paths, and path-resolution drift that preflight misses. See [`build-test-verify.md`](build-test-verify.md) § Self-install.

## Cycle close hygiene

After a cycle ships, run:

```bash
npm run regen-cycle-status   # or: node scripts/regen-cycle-status.js
```

This rewrites `Docs/agent-guides/cycle-status.md § Current` from the most-recent `Docs/plans/*-result.md` + workshop manifest pin. Idempotent — re-running on a fresh file is a no-op.

Modes:
- default: apply in-place.
- `--check`: dry-run; exits 1 if drift detected, 0 if in-sync. Candidate for `release:preflight` once cycle-status drift is fully closed.
- `--current-only`: update top entry without demoting historical rows.
- `--verbose`: print the parsed snapshot and proposed diff.

**Demote logic preserves the prior cycle's "Most recent cycle:" prose** by appending it with the canonical ` — ` separator that historical (previous) rows already use. No information is lost across regen.

## Starting a per-cycle behavioral harness

For cycles that ship a new helper / shared primitive / non-trivial render dispatch, behavioral harnesses are the right regression net. See [`build-test-verify.md`](build-test-verify.md) § Per-cycle behavioral harness pattern.

```bash
npm run scaffold-harness -- v01200 workshop-tooling   # or: node scripts/scaffold-behavioral-harness.js v01200 workshop-tooling
```

Generates `platform/test/run-v01200-workshop-tooling.js` with the canonical zero-dep template (DOM stub + Dataview-proxy stubs + verdict footer). Wire into `package.json release:preflight` manually after populating sections (the script doesn't auto-edit the long single-line scripts field).

Flags:
- `--force` — overwrite existing target.
- `--dry-run` — print to stdout instead of writing.
- `--help` — usage.

The cycle-id pattern is `v\d+` or `v\d+-CFn` (e.g. `v01200`, `v01200-CF1`). The topic-slug is lowercase-with-hyphens (`workshop-tooling`, `finance-monthly-overview`).

## `scripts/dev-sync.sh`

End-of-cycle multi-consumer sync:

```bash
./scripts/dev-sync.sh
```

Runs:
1. Workshop sanity (clean tree, up-to-date with origin/main, harness PASS).
2. For each consumer vault in the `CONSUMERS` array: `sauce update --bump-pins` + `sauce install` + `sauce status`.

Edit `CONSUMERS` in the script to include/exclude vaults. Default covers headspace + accuris.

Exit codes:
- 0 — all consumers in sync.
- 1 — workshop has uncommitted changes.
- 2 — workshop is ahead/behind origin/main.
- 3 — harness failed.
- 4 — one or more consumers reported drift.

## CI vs local preflight

`npm run release:preflight` runs the full harness chain locally (~30s):
- `scripts/check-version-sync.js` — gates workshop_version vs manifest vs package.json.
- `scripts/check-files-forbidden-paths.js` — Safeguard 3 path guard.
- All `npm run test:*` harnesses + every `platform/test/run-*.js` harness in sequence.
- Wired the same way in `.github/workflows/ci.yml` and `.github/workflows/release.yml`.

CI fires on every push to `main` + every PR + every annotated tag. Local preflight is the bar before push; CI is the safety net.

## When in doubt, in this order

1. Run `npm run status` to see live state.
2. Read the most recent `Docs/plans/*-result.md` (workshop-status lists it).
3. Read the next-session handoff prompt (`Docs/prompts/*-next-session-handoff.md`) if present.
4. Check `Docs/agent-guides/cycle-status.md` § Current for the live pointer (run `npm run regen-cycle-status -- --check` first to detect drift).
5. Pick a lane from the open brainstorm (`Docs/plans/*-enhancements-brainstorm.md`) OR start a new brief.

End of guide.
