# Contributing to Sauce

Sauce is solo-developed by Will Fellhoelter using a cycle-versioned workflow: every change ships as a `vX.Y.Z` cycle with companion `design.md` → `plan.md` → `result.md` docs under `Docs/plans/`.

## Before opening a PR

Please open an issue first to discuss the proposed change. PRs without a prior issue may be closed.

## Background reading

If you want to understand how the codebase is organized before contributing:

- [`Docs/Index.md`](Docs/Index.md) — start here
- [`Docs/why.md`](Docs/why.md) — purpose and end goal
- [`Docs/how.md`](Docs/how.md) — architecture
- [`Docs/landmines.md`](Docs/landmines.md) — known footguns to avoid
- [`Docs/plans/`](Docs/plans/) — chronological cycle history

## Running the test suite

```bash
npm install --omit=dev
npm run release:preflight
```

The preflight chain runs the full harness suite; expect ~30s on a recent machine.

## Security issues

For vulnerabilities, do NOT open a public issue. See [`SECURITY.md`](SECURITY.md) for the private reporting process.
