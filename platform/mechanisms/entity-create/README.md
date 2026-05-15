# entity-create

Cycle 1 of the blueprint-modularization strategy (`Docs/plans/2026-05-14-blueprint-modularization-design.md`). One mechanism, one concern: **click a button → prompt user → create file at a date-routed or flat path with declarative frontmatter.**

Replaces 7 hand-authored `New<X>Button` CustomJS classes across 5 blueprints with a single declarative manifest field on each consuming blueprint.

## The manifest field

Consuming blueprints declare a top-level `new_entity_buttons[]` array. Each entry:

| Field | Required | Description |
|---|:---:|---|
| `id` | yes | Unique within blueprint. The runtime invokes `customJS.EntityCreate.render(dv, { instance: <id> })`. |
| `label` | yes | Button text + overlay heading. |
| `icon` | no | Inline SVG; defaults to a plus icon. |
| `prompts[]` | yes (may be empty) | Ordered list. Each: `{key, label, type, required?, default?, options?, min?, max?, validate?, derive?}` — `type` ∈ `"string" \| "date" \| "month" \| "number" \| "select"`. |
| `destination` | yes | `{folder_prefix, folder_date_pattern?, filename_prefix, filename_date_pattern?, filename_suffix?}` — same shape as nav-buttons `runTemplaterTemplate` action. |
| `frontmatter_template` | yes | Object literal with substitution tokens; emitted as YAML. |
| `body_template` | no | Vault-relative path to a body template file (substituted by installer). |
| `inline_body` | no | Inline body literal (peer to `body_template`). |
| `extra_files[]` | no | Sidecar files materialized alongside the primary. Each: `{filename_pattern, subfolder?, frontmatter_template?, inline_body?, body_template?}`. |
| `render_in` | yes | `{kind: "nav_buttons"}` OR `{kind: "hub", target_path: <path>}` |

See `schema/new-entity-buttons.json` for the authoritative json-schema (validator + audit both consume it).

## Substitution catalogue

Tokens resolved at create-time inside `frontmatter_template`, `destination.*`, `inline_body`, `body_template` contents, `extra_files[].*`, and prompt `default` fields:

| Token | Expands to |
|---|---|
| `{{prompts.<key>}}` | raw prompt value |
| `{{prompts.<key>\|sanitize-filename}}` | strip `/\:*?"<>|` |
| `{{prompts.<key>\|lowercase}}` | `String.toLowerCase` |
| `{{prompts.<key>\|number}}` | emit unquoted YAML numeric scalar (handled at frontmatter emission) |
| `{{now.<moment-format>}}` | `ctx.now.format(<moment-format>)` |
| `{{current_file.frontmatter.<key>}}` | read frontmatter `<key>` from the note hosting the button |
| `{{current_file.frontmatter.<key>}}-routed` | expand `YYYY-MM-DD` date string to `YYYY/MM-MMMM/YYYY-MM-DD` |

### Derive DSL (prompts[].derive)

For derived (non-input) values computed from other prompts. Initial primitives:

| Form | Result |
|---|---|
| `slugify(prompts.<key>)` | lowercase + dasherize (`"Testing It Out"` → `"testing-it-out"`) |
| `lowercase(prompts.<key>)` | `String.toLowerCase` |
| `sanitize-filename(prompts.<key>)` | strip `/\:*?"<>|` |

### Validate predicates (prompts[].validate)

Comma- or semicolon-separated:

| Predicate | Meaning |
|---|---|
| `safe-filename` | reject `/\:*?"<>|` in value |
| `min:<n>` | value must be ≥ `<n>` (numeric) |
| `max:<n>` | value must be ≤ `<n>` (numeric) |
| `gte:<other-key>` | value must be ≥ `prompts[<other-key>]`; numeric if both parse as numbers, else lexicographic (works for ISO `YYYY-MM-DD` / `YYYY-MM`) |

## In-scope blueprints + their `id` strings (v0.46.0 cycle)

| Blueprint | `id` | Notes |
|---|---|---|
| meetings | `meeting` | 1 prompt (title); body via Templater template |
| people | `person` | 1 prompt (name); flat folder; `safe-filename` validate |
| project | `project` | 1 prompt (name) + 1 `derive: slugify(prompts.name)` slug; `extra_files[]` for Project Map + Board sidecars |
| scratch | `scratch` | 1 optional prompt (title); folder routes via `{{current_file.frontmatter.day}}-routed` |
| finance — budget | `budget` | 1 prompt (month, `type: "month"`); `inline_body` |
| finance — paycheck | `paycheck` | 3 prompts: `start_date` (date), `end_date` (date, `gte:start_date`), `amount` (number, `min:0`); `paycheck_amount` emitted via `\|number` pipe |
| finance — invoice | `invoice` | 1 prompt (month); two `extra_files[]` (Time-Log + Board) |

Each migration site is catalogued in detail in **Appendix A** of `Docs/plans/2026-05-14-v0.46.0-entity-create-plan.md`.

## Runtime contract

The `EntityCreate` CustomJS class exposes two entry points:

```js
// Dataviewjs surface — renders an AccentButton wired to .create()
await customJS.EntityCreate.render(dv, { instance: "<id>" });

// Programmatic surface — runs prompts + creates the file directly
await customJS.EntityCreate.create({ instance: "<id>", dv });
```

Spec lookup reads `ranch/entity-create-registry.json` (materialized by the installer in S2). If the registry file is absent, `render` paints a "no spec" placeholder and `create` is a no-op — the runtime is graceful when the installer has not yet run.

## Principle context

This mechanism realizes principles #1 (one concern), #2 (manifest as API surface), #3 (mechanism owns its materialization), and the schema-coverage governing rule from the strategy doc. All 7 in-scope migration sites fit the schema without escape hatch — see Appendix A's verdict row.

The aesthetic commitment is AccentButton-row rendering: `render()` delegates to `customJS.AccentButton.render(...)` so every entity-create button looks identical to the existing AccentButton consumers (`ScratchDayActions`, `CoworkHubNav`, etc.). No new rendering primitive is introduced.

## Links

- Plan: `Docs/plans/2026-05-14-v0.46.0-entity-create-plan.md` (Appendix A + Stage S1)
- Strategy doc: `Docs/plans/2026-05-14-blueprint-modularization-design.md`
- Schema: `schema/new-entity-buttons.json`
