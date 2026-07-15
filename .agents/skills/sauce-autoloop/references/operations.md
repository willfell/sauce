# Sauce Autoloop operations

Load this reference only for recovery, concurrency, release attribution, or deployment questions.

## Durable state

The coordinator resolves `git rev-parse --git-common-dir` and stores atomic state below `<common-dir>/sauce-autoloop/`. Every worktree therefore sees the same ledger without advancing `main`.

Card phases are:

```text
claimed -> implementing -> feature_pr -> feature_merged -> release_pr
-> release_merged -> tagged -> tap_pr -> tap_merged -> brew_installed
-> deploying -> deployed
```

Pending external state is resumable, not failure. Exception states are `blocked`, `failed`, `cancelled`, and `needs-inspection`.

## Gate receipts

Every feature commit has three review receipts and one combined gate receipt in the shared ledger. Review receipts name the lens, verdict, summary, and exact `HEAD`. Review writes, `verify-gates`, and `record-pr` share one per-card lock so a late refutation cannot be overwritten. `verify-gates` fetches canonical `origin/main` and records both exact commits after mutation adequacy, full preflight, workshop self-install in a disposable worktree, and bumped preflight. `record-pr` rejects missing, failed, incomplete, noncanonical, or stale receipts. A changed PR head/base also blocks `advance`, invalid legacy auto-merge is disabled, and a merged PR without valid gates remains durably at `needs-inspection`.

## Concurrency

- Maximum active claims: three.
- Selector locking lasts only through atomic claim creation.
- Each card owns explicit branch/worktree/PR fields.
- Dependencies require `deployed` state.
- Intersecting `touch_zones` reject a claim.
- Treat `platform/install.js`, `package.json`, `.github/workflows`, `platform/manifest.json`, shared registries, Homebrew promotion, and each vault deployment as exclusive zones.
- Preserve unrelated branches, worktrees, and dirty files.

When another merge makes a feature PR stale, update it normally and rerun CI. Never force-push or admin-merge a feature PR.

## Release ancestry

Do not use the globally newest PR or tag. Record the feature merge SHA, then select the first release tag containing that SHA. Several cards may share one release. A newer installed release satisfies an older required version only when the feature merge SHA is an ancestor of the newer tag.

## Deployment

Acquire one host promotion lock, recheck the installed formula, then run `brew update` and `brew upgrade sauce` only if needed. Deploy three independent child processes:

- headspace: `/Users/willfellhoelter/notes/sauce/headspace-sauce`
- accuris: `/Users/willfellhoelter/notes/sauce/accuris-sauce`
- ero: `/Users/willfellhoelter/notes/sauce/ero-sauce`

Each verifies identity and the brew workshop path, applies only explicit subscription additions, runs `sauce update --bump-pins`, checks the new install-history segment for errors, verifies the installed version floor, and returns a receipt. Retry only failed/behind vaults.

## Recovery

- Reclaim a lock only when its PID is dead and it is older than the stale threshold.
- Never delete a dirty interrupted worktree automatically.
- Reconcile a card by its recorded PR number and merge SHA.
- Git/PR state wins over board projection.
- Malformed state requires backup/recovery; never overwrite it with an empty state.
- Release/tap workflow failure blocks externally. Do not cut manual versions/tags or edit the tap.
