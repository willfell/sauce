# seed-vault-prev

Snapshot of `platform/test/seed-vault/` from one cycle ago. Populated by
`scripts/seed-prev-snapshot.js` at every cycle close (run before
`scripts/rebaseline-seed.js`).

Acts as a safety net: if a regression is discovered later, you can compare the
current seed-vault against this prev-snapshot to see exactly what the prior
release looked like.

**This directory is intentionally empty in the v0.110.0 foundation cycle.** The
first real snapshot lands at the close of the next cycle (the first one that
ships actual migrations against the seed). Until then, this README is the only
file here.

See `Docs/agent-guides/build-test-verify.md` § "Branch + PR workflow" for the
full cycle-close procedure.
