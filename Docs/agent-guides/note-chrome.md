---
purpose: Vault-wide note-chrome standard. Locks the breadcrumb / nav grammar, the no-`## H2` / SectionLabel rule and its outline/anchor tradeoff, the breadcrumb-declaration schema, open-mode + button rules, and migration posture established across the note-chrome arc (v0.121.0 → v0.124.0). Project-specific rendering detail (section ordering, proxyDv shim, card meta-lines) stays in [`project-blueprint-ui.md`](project-blueprint-ui.md).
---

# Note-chrome standard — vault-wide

Authored across the note-chrome arc (`section-label` v0.122.0, `breadcrumb` mechanism v0.123.0, adoption wave 1 v0.124.0). Every template in an **adopted** blueprint (one declaring a `breadcrumb` block in its manifest — currently `project`, `meetings`, `scratch`, `to-do`) MUST conform. Other blueprints adopt in later waves.

When you change a template or helper that renders into an adopted-blueprint note, read this file first. For project-only conventions (section ordering, proxyDv shim, card meta-line format, naming) see [`project-blueprint-ui.md`](project-blueprint-ui.md) — note-chrome.md is the vault-wide generalization; that file remains the project-specific doc.

## 1. Chrome grammar

The chrome region sits below any `# H1` title and above the first content block. Order:

1. **Breadcrumb** (FIRST block) — `Breadcrumb` view via customjs-guard.
2. **Global nav bar** — `SpaceNavButtons` / blueprint nav-button row(s).
3. **Content.**

Rules:

- **No `---` between the breadcrumb and the nav bar.** They are one chrome unit. (Precedent: `platform/blueprints/to-do/templates/Project To-Do.md`.)
- **`SectionLabel` owns content-section dividers.** It renders its own hairline above the label, so do NOT add literal `---` between SectionLabels. The chrome `---` grammar applies only between nav tiers, never between content sections. The first content label may pass `top: true` to suppress its hairline directly under the nav bar.

## 2. No `## H2` rule + the SectionLabel tradeoff

Content section headings use `SectionLabel` (a dataviewjs view), **NOT `## H2`** (nor `### H3`). Helpers / templates emit:

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SectionLabel", args: [{ text: "Notes" }] });
```

**The tradeoff, plainly:** `SectionLabel` renders a styled `<div>`, not a markdown heading. So a section converted from `## H2` to `SectionLabel`:

- **leaves the Obsidian outline pane** (no heading → no outline entry), and
- **breaks any `[[note#Heading]]` anchor link** that targeted the old heading, and
- **shows a dataviewjs code block in edit mode** instead of a heading.

This is the accepted, documented cost of the standard. Heals are `.sauce-backup`-reversible (see §6), and adopted-blueprint notes (meetings / scratch / daily to-do) are ephemeral and rarely heading-anchored.

**Scope:** the rule applies only to **adopted** blueprints (those with a `breadcrumb` manifest block).

**Exemption — kanban-board templates.** Board templates keep their `## Column` headings: those are obsidian-kanban plugin structure, not content headings — converting them breaks the board. The lint gate (`scripts/lint-note-chrome.js`) exempts any template with `kanban-plugin:` frontmatter.

## 3. Breadcrumb declaration schema

Each adopted blueprint declares its trails per-type in `manifest.json`:

```json
"breadcrumb": {
  "types": {
    "<type>": {
      "ancestors": [ { "when?": …, "label": "<chain>", "link?": "<template>" }, … ],
      "current?":  { "label": "<chain>", "link?": "<template>" }
    }
  }
}
```

The installer's `applyBreadcrumb` aggregates every blueprint's block into `ranch/breadcrumb-registry.json` (schema_version 1, `contributions.<blueprint>.types.<type>`). The `breadcrumb` mechanism is generic — it knows zero blueprint paths; it just consumes the registry.

**Resolver grammar** (see `platform/mechanisms/breadcrumb/breadcrumb.js`):

- **Atoms:** `fm:<field>` · `path:<n>` (0-indexed path segment) · `file:basename` / `file:stem` · `lit:<text>`.
- **Transform:** `slug:<atom>` (single-level slugify).
- **Chains:** `<atom>|<atom>|…` — first non-empty wins.
- **Link templates:** `"…{<chain>}…{<chain>}…"` — any empty slot voids the whole link (segment renders as plain bold label instead).
- **Predicates:** optional `when: { "fm:<field>": "present"|"absent"|"<literal>" }`, AND-conjoined across keys, gating a single ancestor.

**Dispatch is by frontmatter `type` ALONE** across all contributions — first-match-wins with a one-time `console.warn` on collision. So **`type` values must be globally unique** across blueprints (`meeting` / `scratch` / `scratch-day` / `to-do` / `project` / `project-todo` / … do not collide today). Top-level hubs render NO trail: either their `type` isn't in the registry, or they're tag-based hubs with no `type` field at all.

## 4. Open-mode rule

Brand-new notes open in **read / preview**, never edit-with-title-selected. The shared helper is `open-helpers`' `forceLeafPreview(leaf)` (and `forceActiveLeafPreview()`); entity-create and nav-button create paths route through it.

**Trap:** `app.commands.executeCommandById` is fire-and-forget for async Templater callbacks. Do NOT flip a leaf to preview immediately after a Templater replace-in-file command — it races the in-flight mutation. Flip only after the command's own completion path.

## 5. Button rules

- **Nav-buttons row:** `flex-wrap: wrap`, and each label gets `text-overflow: ellipsis` + `overflow: hidden` + `white-space: nowrap` + `min-width: 0` so long labels truncate instead of overflowing the button.
- **Accent-button hover:** mutate individual style props (`style.background` / `style.color`). NEVER rebuild `cssText` on hover — that caused button jitter (fixed at `accent-button` v0.1.2).

## 6. Migration posture

- **Managed adopted-blueprint TEMPLATES conform** — new notes are born correct.
- **EXISTING notes are healed at install** by `applyNoteChromeHeal` (per-vault, idempotent, `.sauce-backup` snapshot before any write, fence-aware H2 rewrite, fails loud but never throws). It keys on the dataviewjs invocation substring + frontmatter `type`, never on display markers. **Never hand-edit a note body to conform** — the heal owns it.
- **Heal scope** is notes with frontmatter `type` ∈ {`meeting`, `scratch`, `scratch-day`, `to-do`}. **Tag-based hubs without a `type` field** (e.g. Meeting Hub, `tags: meetings-hub`) are therefore NOT healed — their template is fixed for new notes, but existing hubs keep their incidental `## H2` (e.g. `## Today's Meetings`). This is an **accepted cosmetic regression**, not a bug: the cards list below the heading is unaffected, and per the registry-grammar feedback we accept a cosmetic regression over a same-cycle heal.

## 7. Cross-references

- Project-specific render conventions (section ordering, empty-state-renders-nothing, proxyDv shim, card meta-lines, naming): [`project-blueprint-ui.md`](project-blueprint-ui.md).
- Cross-blueprint non-negotiables (customjs-guard, module-directory invariant, marker regions, dispatcher contracts): [`code-conventions.md`](code-conventions.md).
- Mechanisms vs blueprints, installer, registry aggregation: [`architecture.md`](architecture.md).
- Conformance + heal traps: [`../landmines.md`](../landmines.md) (note-chrome conformance + `/Scripts/` ignore trap).
