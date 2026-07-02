---
purpose: The authoritative blueprint conformance standard — the ONE right way to add buttons, use templates, and load customjs in a Sauce blueprint, plus the gates that enforce each rule. Read before adding UI, a template, or a customjs class to any blueprint.
load_when: Adding or editing a blueprint's buttons, templates, helpers/views, or customjs classes; designing a new blueprint; investigating a conformance gate failure.
---

# Blueprint conformance standard

Sauce already ships the canonical UI + loader primitives as **mechanisms**. The
right way is to USE them, not to hand-roll. Every rule here is a deterministic
gate; the machine-readable catalog is [`platform/conformance-index.json`](../../platform/conformance-index.json)
and the live status is `npm run conformance:audit`.

**How enforcement works.** Each rule has a `status`:
- `enforcing` — its gate is in `release:preflight` and green; violations fail the build.
- `report-only` — its gate runs in `conformance:audit` (non-blocking); a known sweep is in flight.
- `planned` — the rule is defined; its gate is not built/extended yet.

Every gate ships a `--self-test` (pass/fail fixtures proving it flags real
violations AND exempts the legit set). Exemptions are declared WITH A REASON in
the registry, or per-line via `// lint-<gate>:allow <reason>` (JS) /
`<!-- lint-<gate>:allow <reason> -->` (Markdown). No silent skips.

## Buttons — the canonical vocabulary

| Button kind | The right way | Forbidden | Rule |
| --- | --- | --- | --- |
| Nav / breadcrumb chrome | `nav_buttons[]` + a `breadcrumb` block in the manifest → rendered by the `nav-buttons` + `breadcrumb` mechanisms | hand-rolled nav rows | BTN-1, CHR-1/2 |
| "New X" creation | `new_entity_buttons[]` in the manifest → rendered by the `entity-create` mechanism | hand-rolled "New" buttons | BTN-1 |
| Action buttons (Edit / Open / Delete) | `customJS.AccentButton.render(parent, { label, icon, onClick })` | raw `createEl("button")` / `<button>` with bespoke inline styles | BTN-1 |
| Icons / glyphs | `customJS.Icons.get('kebab-name')` (the `icons` mechanism, Lucide vocab) | inline emoji or raw `<svg>` used as a glyph | BTN-2 |

The sanctioned renderers (`accent-button`, `nav-buttons`, `entity-create`,
`icons`) are the only place button/glyph primitives are constructed.

## Templates

- **TPL-1 path-variables** — never hardcode `ranch/views` / `ranch/scripts` /
  `ranch/templates`; use `{{views_path}}` / `{{scripts_path}}` /
  `{{templates_path}}`. The installer substitutes per consumer (non-negotiable #3).
- **TPL-2 no-token-leak** — a template `{{TOKEN}}` must be resolved by something:
  an installer var, `{{now.<fmt>}}` (entity-create), or a scaffolder's
  `.replace(All)`. An unresolved token leaks literally into the created note.
- **TPL-3 no-content-h2** — no `## H2` / `### H3` / `dv.header(2|3)` content
  headings; a helper emits a `SectionLabel` instead. (Kanban `## Column` lines
  are exempt.)
- **TPL-4 render-nothing** — empty helper output renders NOTHING: no info
  callouts, no "No items yet" placeholder strings (project-blueprint-ui.md §3).
  The always-present `+ New` button is the guidance on an empty surface.
- **TPL-5 no-trailing-hr** — no dangling final `---` at the end of a template
  body. Internal `---` dividers between widgets are fine.

## CustomJS + loading

- **CJS-1 loadable** — a customJS class file is a BARE class expression, no
  trailing statements (customJS `eval("(" + file + ")")`; landmine #31).
- **CJS-2 render-safe** — guard every `dv.current()` / `customJS.X` against
  cold-load TDZ (via the `render-safe` mechanism + the customjs-guard view).
- **CJS-3 no-dead-classes** — every `customjs-guard { class: "X" }` invocation
  resolves to a real class. (Report-only sub-signals: UNDECLARED = missing from
  the owner's `customjs_classes[]` ∪ deps; DEAD = declared but unreferenced.)
- **CJS-4 contract** — members called as `customJS.X.method` are non-static
  (customJS stores instances, not constructors).

## Note-chrome (adoption)

- **CHR-1 note-chrome-adoption** *(planned)* — every non-exempt blueprint
  declares a `breadcrumb` block; this is what flips `lint-note-chrome.js` from
  opt-in to mandatory. Boards is exempt (kanban-only). Lands per-blueprint.
- **CHR-2 template-has-breadcrumb** — an adopted leaf template that renders
  `SpaceNavButtons` must render `Breadcrumb` first.
- **CHR-3 open-mode-routed** *(planned)* — new-note open routed through the
  `open-helpers` mechanism (`forceLeafPreview`).

## Adding a new blueprint / helper

1. Declare buttons via manifest blocks; render actions via `AccentButton`, glyphs
   via `Icons.get`.
2. Use `{{template_variables}}` for every runtime path.
3. Emit `SectionLabel` for section headers; render nothing when empty.
4. Write customjs classes as bare class expressions; guard cold-load access.
5. Run `npm run conformance:audit` — land green (or add a reasoned exemption).
