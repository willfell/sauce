---
purpose: Schema registry — every schema-shaped surface in the Sauce workshop, indexed at platform/schemas-index.json. Read this before designing any feature that touches frontmatter, sidecars, contracts, or learned state.
load_when: Designing a new feature, writing a brief/design doc, debugging a frontmatter / sidecar mismatch, adding a new schema, or whenever the "verify helpers before design asserts them" landmine threatens to fire.
---

# Schemas

This guide is the answer to the recurring "what's the schema for X?" question. Across v0.93.3 / v0.94.0 (twice) / v0.95.0 / v0.108.0, the same lesson surfaced: design docs guessed at helper read-contracts because the contracts weren't centralized. v0.113.0 ships the index. This guide says how to use it.

## The eight schema surfaces in Sauce

| Surface | Where it lives | Versioned? | Example |
|---|---|---|---|
| Sidecar JSON Schema | `platform/blueprints/cowork/data/schemas/*.json` | Yes — `properties.schema_version.enum` | eod-review sidecar v1.0..1.4 |
| Contract | `platform/blueprints/<bp>/data/*-contract.json` | Yes — `contract_version` field; mirror blueprint version per landmine #20 | scheduled-job-contract.json |
| rule_fragments[] | Blueprint manifests | No (implicit) | finance budget / paycheck / debt / invoice |
| Data file (implicit schema) | `platform/blueprints/<bp>/data/*.json` | Sometimes | kind-titles.json / kind-patterns.json |
| Workshop manifest | `platform/manifest.json` / `ranch/platform-subscription.json` | Yes — `workshop_version` + per-blueprint pins | the canonical workshop pin map |
| Learned-state schema | Encoded in helpers (e.g. `normalizeLearnedWeightsV5`) | Yes — schema N | learned_weights schema 5 |
| Entity-create prompts | `new_entity_buttons[].prompts` in blueprint manifests | No | finance `+ New Budget` form |
| Helper read-contract | Implicit in helper source | No | `MonthlyOverview` reads `page.month` + `categories[*].actual` |

## The registry — `platform/schemas-index.json`

Every entry has at minimum: `id`, `kind`, `owner`, `source`. Optional: `accepted_versions`, `validator`, `consumers`, `notes`.

```json
{
  "id": "cowork-eod-review-sidecar",
  "kind": "sidecar-schema",
  "owner": { "type": "blueprint", "name": "cowork" },
  "source": "platform/blueprints/cowork/data/schemas/eod-review@1.0.0.json",
  "accepted_versions": ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"],
  "validator": "platform/blueprints/cowork/helpers/validate-sidecar-helper.js",
  "consumers": [
    "platform/blueprints/cowork/skills/orchestrators/eod-review/SKILL.md",
    "platform/blueprints/cowork/helpers/write-atomic-note-helper.js"
  ],
  "notes": "EOD review sidecar — JSON Schema draft-07. Latest accepted version 1.4.0 (v0.101.0 sparse-signal-feedback)."
}
```

### `kind` enum

| kind | Meaning |
|---|---|
| `sidecar-schema` | JSON Schema doc validating a per-cadence sidecar. |
| `rule-fragment-bundle` | A blueprint manifest's `rule_fragments[]` block. |
| `contract` | A platform-level contract (e.g. `scheduled-job-contract.json`). |
| `data-file` | A blueprint's static data file with implicit schema. |
| `workshop-manifest` | `platform/manifest.json` or `ranch/platform-subscription.json`. |
| `learned-state-schema` | A versioned learned-state shape (e.g. `learned_weights` schema 5). |
| `entity-create-prompts` | A `new_entity_buttons[].prompts` schema in a blueprint manifest. |
| `helper-read-contract` | Implicit schema a helper assumes about `page.X` / `opts.Y` reads. |

## When designing a new feature

1. `npm run lint-schemas -- --list` to see what's already indexed.
2. Find the closest existing entry (by surface or by ownership). Open its `source` file. Read the schema.
3. If your feature TOUCHES an existing schema → cite the entry in your design doc by `id`. Don't paraphrase the contract — quote it.
4. If your feature ADDS a new schema → add the entry to `platform/schemas-index.json` in the SAME commit that introduces the schema file. Lint runs in preflight; missing-source is a hard fail.
5. If your feature bumps an `accepted_versions[]` → update the registry entry's `accepted_versions[]` AND the source file's `properties.schema_version.enum`. The lint's soft-warning will catch drift between them.

## The linter

```bash
npm run lint-schemas              # default --check mode; exit 1 on hard failure
npm run lint-schemas -- --list    # one-line per schema
npm run lint-schemas -- --json    # full validated index as JSON
npm run lint-schemas -- --verbose # per-entry validation lines
```

Hard failures (exit 1):
- Index file missing / unparseable / wrong `schema_version`.
- Duplicate `id` across entries.
- Missing required key (`id` / `kind` / `owner` / `source`).
- `source` or `validator` file does not exist on disk.
- `kind` not in enum.
- `owner.type` not in `{blueprint, mechanism, workshop}`.
- `owner.name` not in the workshop's blueprint/mechanism catalog (for blueprint/mechanism types).

Soft warnings (exit 0, printed to stderr):
- `consumers[]` entry path does not exist (the schema is still valid; just the cross-reference is stale).
- `accepted_versions` drift vs source JSON Schema's `properties.schema_version.enum`.

`npm run release:preflight` runs lint-schemas after `check-version-sync.js`. A clean preflight requires a clean lint.

## Adding a new entry — checklist

- [ ] Pick an `id` — kebab-case, unique. Convention: `<owner>-<surface>-<role>` (e.g. `cowork-eod-review-sidecar`, `finance-monthly-overview-page-read`).
- [ ] Choose `kind` from the enum above.
- [ ] Set `owner.type` + `owner.name`. For blueprints/mechanisms, `name` must exactly match the workshop manifest's blueprint/mechanism entry name.
- [ ] `source` is the workshop-relative path to the schema doc OR the closest schema-shaped artifact (the helper for read-contracts; the manifest for rule_fragments).
- [ ] If the schema has explicit versions (sidecar / contract / learned-state), set `accepted_versions[]`.
- [ ] If a validator helper exists, set `validator`.
- [ ] List `consumers[]` — files that consume this schema. Soft-warns if stale; useful for impact analysis.
- [ ] Add a `notes` string explaining context, version history, and any landmines (e.g. landmine #20 for contracts).
- [ ] Run `npm run lint-schemas` — must exit 0.

## Bumping schema versions

- **Sidecar schema bump (e.g. eod-review 1.4.0 → 1.5.0):** add new version to source file's `properties.schema_version.enum`; add to registry entry's `accepted_versions[]`; document the migration in the cycle's result doc.
- **Contract version bump:** mirror the cowork blueprint version exactly. Landmine #20.
- **Learned-state schema bump (e.g. learned_weights 5 → 6):** write `normalizeLearnedWeightsV6` migrator. Update registry entry's `accepted_versions[]`. Ensure migration is purely additive (counters intact across version bumps).
- **Workshop manifest bump:** landmine #16. Sweep `HC-V0*-VERSION-*` hardcoded values in `run-helper-cases.js`.

## When NOT to add an entry

- For schema-shaped things that are entirely encapsulated in a single helper class and never crossed by other code, the helper IS the contract. Add an entry ONLY if you want it surfaced for design-time discovery. A read-contract for a tiny helper with one consumer is over-indexing.

## Related guides

- [`build-test-verify.md`](build-test-verify.md) — preflight context for lint-schemas.
- [`dev-workflow.md`](dev-workflow.md) — day-to-day workflow including `npm run lint-schemas`.
- [`landmines.md`](../landmines.md) — landmine #16 (version-pin sweep) + #20 (contract_version mirroring).
- [`code-conventions.md`](code-conventions.md) — the five non-negotiables; helper read-contracts inherit them.

End of guide.
