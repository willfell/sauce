# Summary

<!-- One or two bullets describing what this PR changes. -->

## Migration / structural change checklist

- [ ] If this PR adds an install-time migration, I extended `platform/test/seed-vault/` with input data at the pre-migration schema.
- [ ] If this PR adds an install-time migration, I added an `HC-V0XYZ-SEED-MIGRATE-*` assert family to `platform/test/run-seed-migrations.js`.
- [ ] Enumerated all consumers of any rewritten structural marker (grep the codebase).
- [ ] Updated read + write + parse + migrate + template + fixture paths in lockstep.
- [ ] Fixtures regenerated to post-migration shape (no fixture still references the old form).
- [ ] If keying off `^## ` or similar display markers, considered stable anchors (HTML comments, frontmatter, block-ids); see `Docs/agent-guides/code-conventions.md` § Stable anchors vs display markers.
- [ ] `npm run release:preflight` passes locally.
- [ ] No Claude commit trailer.
- [ ] No emojis in code, callouts, commit messages, or docs.

## Test plan

- [ ] CI green on `macos-latest` and `ubuntu-latest`.
- [ ] (UI-surface change) walked `Docs/agent-guides/smoke-checklists/<blueprint>.md` on a deployed vault.
- [ ] Manual smoke (if applicable).

## Cycle artifacts (if a cycle close)

- [ ] `Docs/plans/<date>-<cycle>-{design,plan,result}.md` present.
- [ ] `Docs/cycle-history.md` prepended.
- [ ] `Docs/agent-guides/cycle-status.md` Current updated.
- [ ] `npm run seed:rebaseline` ran clean.

## Notes

<!-- Anything reviewers should know: scope, tradeoffs, follow-ups. -->
