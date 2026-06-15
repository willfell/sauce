# Summary

<!-- One or two bullets describing what this PR changes. -->

## Migration regression checklist

- [ ] If this PR adds an install-time migration, I extended `platform/test/seed-vault/` with input data at the pre-migration schema.
- [ ] If this PR adds an install-time migration, I added an `HC-V0XYZ-SEED-MIGRATE-*` assert family to `platform/test/run-seed-migrations.js`.
- [ ] `npm run release:preflight` passes locally.
- [ ] No Claude commit trailer.
- [ ] No emojis in code, callouts, commit messages, or docs.

## Test plan

- [ ] CI green on `macos-latest` and `ubuntu-latest`.
- [ ] Manual smoke (if applicable).

## Notes

<!-- Anything reviewers should know: scope, tradeoffs, follow-ups. -->
