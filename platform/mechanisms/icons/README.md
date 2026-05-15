# icons mechanism

Lucide kebab-name → SVG HTML resolver. Single-method API:

```js
customJS.Icons.resolve("users-plus");
// → "<svg ...>...</svg>" or null
```

## Two-tier resolution

1. **Tier 1 — vendored SVG map.** ~21 entries pre-shipped in `icons.js` as a frozen object literal. Lifted byte-for-byte from `space-nav-buttons.js` v2.6.2's ICONS map plus 6 entity-create-introduced kebab names. Deterministic — DOM-icon assert in `run-renderer.js` can validate against exact byte content.

2. **Tier 2 — Obsidian `setIcon()` runtime fallback.** For names not in Tier 1, renders via Obsidian's `setIcon(el, name)` and captures `el.innerHTML`. Best-effort; returns `null` if `setIcon` unavailable (e.g., headless test harness) or name unresolvable.

## Callers (v0.47.0)

- `entity-create/entity-create.js` `render()` — passes `spec.icon` (kebab name) through `Icons.resolve`, falls back to inline `plusIcon` SVG on null.
- `nav-buttons/space-nav-buttons.js` `render()` — replaces the deleted inline `ICONS` const lookup with `Icons.resolve`, preserves existing `fallbackIcon(label)` letter helper for null.

`accent-button.js` remains a raw-SVG consumer; widening its API to accept names is deferred to a future cycle.

## Failure modes

- Name not in Tier 1 + Tier 2 returns null → caller receives `null`, handles its own fallback.
- `setIcon` not in scope (preflight harness without Obsidian) → Tier 2 catches the `ReferenceError`, returns null. Tier 1 names still resolve.
