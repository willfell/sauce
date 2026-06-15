---
purpose: How the seed-vault migration regression net works. Per-cycle authoring loop (extend seed + add assert family + rebaseline), the portable sentinel pattern, what the harness covers + doesn't, common failure modes.
load_when: Adding install-time migrations, editing platform/test/seed-vault/, authoring a new HC-V0XYZ-SEED-* family, running scripts/rebaseline-seed.js, or debugging a run-seed-migrations.js failure on CI.
---

# Migration regression net

The 24th harness, `platform/test/run-seed-migrations.js`, plus the checked-in synthetic seed vault under `platform/test/seed-vault/`. Shipped as the v0.110.0 foundation cycle (PR #2). Gap closed: every other harness validates pieces (helper outputs, manifest shapes, single-file fixtures); none exhaustively exercised migration safety against a vault-shaped vault-from-prior-state.

For the spec + the cycle that introduced it: `Docs/plans/2026-06-14-v0.110.0-migration-regression-net-{design,plan}.md`.

## The one-paragraph model

The seed vault is a synthetic Sauce-shaped consumer vault frozen at the last released `workshop_version`. The harness copies it to a tmp dir, runs the headless installer against the copy (`node platform/install.js --vault <tmp> --auto-approve`, which delegates to `platform/test/run-install.js`), and asserts on the resulting state: install exit code, history growth, directory shape, registry validity, hub-note frontmatter types, user-content preservation, CLAUDE.md markered-surface rewriting, and idempotency on a second run. Each cycle that ships a migration extends the seed with input data at the *pre-migration schema* and adds an `HC-V0XYZ-SEED-MIGRATE-*` assert family. After cycle close, `npm run seed:prev && npm run seed:rebaseline` ratchets the seed forward to the just-released version. Skip-version coverage falls out automatically — the installer always runs every migration in the chain, so a vault at v0.95 going to v0.115 exercises every intervening migration in order.

## Files

```
platform/test/
├── seed-vault/                                          (~376 files, ~2.9MB)
│   ├── CLAUDE.md                                        (hand-authored stub with markers)
│   ├── ranch/platform-config.json                       (sentinel workshop_relative_path — see below)
│   ├── ranch/platform-subscription.json                 (all blueprints + mechanisms subscribed)
│   ├── ranch/platform-installed.json                    (installed history from last bootstrap)
│   ├── ranch/{scripts,templates,rules,templater,...}    (materialized blueprint surfaces)
│   ├── ranch/{*-registry}.json                          (3 registries)
│   ├── spice/{cowork,finance,projects,daily,...}        (per-blueprint dirs + hub notes)
│   ├── spice/daily/2026-06-14.md                        (hand-authored user fixture — PRESERVE-1)
│   ├── spice/scratch/2026-06-14-test-scratch.md         (hand-authored user fixture — PRESERVE-2)
│   ├── spice/meetings/2026-06-14 Test Meeting.md        (hand-authored user fixture — PRESERVE-3)
│   ├── .claude/{commands,skills}/                       (claude_surface materialized)
│   └── .obsidian/                                       (data.json files only; plugin binaries excluded)
├── seed-vault-prev/README.md                            (one-cycle-back snapshot; empty until cycle 2)
├── run-seed-migrations.js                               (the harness)
└── helpers/seed-vault-helpers.js                        (frontmatter parse, tree snapshot, diff, runInstall)

scripts/
├── rebaseline-seed.js                                   (post-cycle-close forward-ratchet; --dry-run flag)
└── seed-prev-snapshot.js                                (run BEFORE rebaseline; archives current seed)
```

## The portable-seed sentinel

The seed lives in the repo and travels across machines (developer laptops + GitHub Actions runners on macOS + Ubuntu). The Templater stub `platformInstall.js` resolves the workshop via `path.resolve(tp.app.vault.adapter.basePath, cfg.workshop_relative_path)` — so a baked-in absolute path would only work on the machine that generated the seed.

**Pattern:**
- The seed's `ranch/platform-config.json` holds `workshop_relative_path = "__SEED_REPO_ROOT__"` (sentinel; never a valid path).
- The harness (`run-seed-migrations.js`) patches sentinel → current `REPO_ROOT` after copy-to-tmp, before invoking install.
- `rebaseline-seed.js` patches sentinel → `REPO_ROOT` before install, then **restores** the sentinel before writing the result back to `seed-vault/`. The committed seed always carries the sentinel.

Any new tooling that runs install against the seed MUST do the same patch-then-restore dance. Don't commit a seed with a real path baked in — that's the bug that broke CI on PR #2's first push (commits `e2ccc2d` red → fix `a3d13f3` green).

## What the harness asserts (foundation cycle)

48 sub-asserts across 7 families. All `HC-V01100-SEED-*`:

| Family | Count | Covers |
|---|---|---|
| `INSTALL-*` | 6 | install exit code 0, `platform-installed.json` exists + parses + has `history[]` + >50 entries + records `workshop_version` |
| `SHAPE-*` | 12 | root tetrad (`spice/`, `ranch/`, `.claude/`, `.obsidian/`) + key blueprint dirs (`spice/cowork/`, `spice/finance/`, `spice/projects/`, `spice/finance/debts/`) + materialized infra (`ranch/scripts/`, `ranch/templates/`, `.claude/{commands,skills}/`) |
| `REGISTRIES-*` | 3 | `claude-surface-registry.json`, `nav-buttons-registry.json`, `entity-create-registry.json` exist + valid JSON |
| `FM-*` | 10 | hub-note `type:` frontmatter (Cowork.md, Daily Hub.md, Finance.md, Debts.md, Budget Defaults.md, Projects.md, Scratch.md, All-ToDos.md, People.md, Products.md) |
| `PRESERVE-*` | 3 | 3 hand-authored user notes (daily, scratch, meetings) byte-equal between seed and post-install vault |
| `CLAUDE-*` | 6 | `CLAUDE.md` exists; 3 markered-surface pairs present (`resolvers`, `directory-map`, `skills-index`); resolvers block populated by install; outside-marker prose preserved |
| `IDEMP-*` | 5 + 3 | second install exit 0, no unexpected files added / changed / removed vs. first install (with `KNOWN_MUTABLE` allowlist for timestamp-bearing files), `platform-installed.json` history grew, all 3 user notes still preserved after second install |

## Per-cycle authoring loop (when YOU add a migration)

The whole point. For every cycle that ships an install-time migration (`platform/install.js` `applyXxx` function), do this:

### 1. Extend the seed at the pre-migration schema

The migration transforms vault state from shape A to shape B. The harness needs to *see* shape A in the seed so it can verify the install applied the transform. Add a note (or edit an existing one in the seed) at shape A. This is a **sanctioned hand-edit** of `seed-vault/` per landmine #26.

Example: if a cycle adds `applyFinanceBudgetGroupSeed` that backfills `groups[]` on existing budget notes, add a `Budget-2026-07.md` to the seed without the `groups[]` field. The harness will assert post-install that the field got backfilled.

### 2. Add an `HC-V0XYZ-SEED-MIGRATE-*` assert family

In `run-seed-migrations.js`, append a new family after the existing ones (keep families ordered chronologically by cycle). Pattern:

```js
// ===== HC-V0XYZ-SEED-MIGRATE-BUDGET-GROUP-* — applyFinanceBudgetGroupSeed =====
const budgetNote = helpers.readNote(vault, "spice/finance/budgets/Budget-2026-07.md");
const { frontmatter: budgetFm } = helpers.parseFrontmatter(budgetNote);
ok(
    "HC-V0XYZ-SEED-MIGRATE-BUDGET-GROUP-1 groups[] backfilled",
    Array.isArray(budgetFm.groups) && budgetFm.groups.length > 0
);
ok(
    "HC-V0XYZ-SEED-MIGRATE-BUDGET-GROUP-2 .sauce-backup snapshot exists",
    fs.readdirSync(path.join(vault, ".sauce-backup")).length > 0
);
ok(
    "HC-V0XYZ-SEED-MIGRATE-BUDGET-GROUP-3 marker comment present",
    budgetNote.includes("__group_seed_migrated:")
);
```

Family naming: `HC-V<workshop_version>-SEED-MIGRATE-<topic>-<n>`. The `<workshop_version>` is the *closing* version of the cycle (e.g. `V01080` for v0.108.0).

### 3. Local verification

```
node platform/test/run-seed-migrations.js     # new family green
npm run release:preflight                     # full chain green
```

### 4. Commit + PR

The branch + PR + CI gate workflow from `build-test-verify.md` § "Branch + PR workflow" applies. Open PR → ci.yml runs preflight on macOS + Ubuntu → merge when green.

### 5. Post-merge rebaseline (maintainer)

After tag + bump-tap chain, on `main`:

```
npm run seed:prev          # archive seed-vault -> seed-vault-prev
npm run seed:rebaseline    # run install on a copy of seed; write result back
git add -A platform/test/seed-vault platform/test/seed-vault-prev
git commit -m "chore(seed): rebaseline to v0.X.Y"
git push
```

The seed forward-ratchets to represent the just-released version. The next cycle's pre-migration data lands on top of the new baseline.

## What the harness does NOT cover

By design, this is a **headless Node-only regression net**. It does NOT cover:

- **Obsidian-runtime widget rendering** — `customJS.<Class>.render(dv)` calls need a Dataview process. Existing harnesses (`run-renderer.js`, `run-v0109-projects-overhaul.js`) handle some of that via DOM stubs; visual smoke remains a manual Cmd+R step in the dogfood workflow.
- **Slash-command execution** — needs a live Claude Code session. The dogfood self-install verifies materialized command file presence; runtime invocation is not exercised.
- **Network-dependent bootstrap paths** — `run-bootstrap.js` already mocks `https.get`; the seed-migrations harness assumes a fully-materialized vault as input, so it never reaches bootstrap's network gateway.
- **`sauce migrate` from the legacy source vault** — `run-migrate.js` covers that path with its own fixtures.

When you need coverage in any of those areas, extend the appropriate existing harness instead of stretching `run-seed-migrations.js` past its design.

## Common failure modes

### "install exit code 1, stderr at ranch/templater/platformInstall.js:19"

The Templater stub failed to resolve the workshop. Almost always one of:
- The seed's `workshop_relative_path` is not the sentinel — a real path got committed by mistake. Fix: edit `ranch/platform-config.json` in the seed to `"workshop_relative_path": "__SEED_REPO_ROOT__"`.
- The harness or rebaseline forgot the sentinel→`REPO_ROOT` patch.

### "platform-installed.json grew (before=X after=X)" — IDEMP-5 fails

Install never ran the second time (because the first install's stub failed, or some other crash). Almost always a downstream symptom of an INSTALL-1 failure.

### "second install changed unexpected files" — IDEMP-3 fails

A registry or hub note has time-dependent content that's not in `KNOWN_MUTABLE`. Either:
- Add the file to `KNOWN_MUTABLE` in `run-seed-migrations.js` (if it legitimately rewrites on every install).
- Or fix the installer step to be truly idempotent (preferred — IDEMP regressions are real bugs more often than not).

### Rebaseline diff shows huge churn

Usually means a blueprint shipped a schema change without a migration to apply it to existing files. The rebaseline picks up the new shape from the install side but doesn't backfill the seed's pre-existing notes. Fix: add a migration OR hand-edit the affected seed notes to the new shape (sanctioned per landmine #26 when there's no migration; document why).

### CLAUDE.md changes between rebaselines

Expected if the workshop's `claude-surface[]` registry changed (new commands / skills / dir-map rows). Inside-marker content gets rewritten; outside-marker prose is preserved. Don't fight this — it's the point.

## Pointers

- Spec + plan: `Docs/plans/2026-06-14-v0.110.0-migration-regression-net-{design,plan}.md`.
- Landmine #26: don't hand-edit `seed-vault/` outside the 3 sanctioned cases. `Docs/landmines.md`.
- Workflow + branch-protection setup: `Docs/agent-guides/build-test-verify.md` § "Branch + PR workflow (preferred from v0.110.0)".
- PR template: `.github/pull_request_template.md` (anchors the per-PR checklist).
