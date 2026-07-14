---
purpose: Design for bringing community-plugin state into parity across the three consumer vaults — smart-connections default-off, foundational version enforcement, a vendored patched editor-width-slider, and the claudian→realclaudian migration.
load_when: Implementing or reviewing the plugin-parity cycle (post-v0.230.0).
status: approved
date: 2026-07-14
---

# Plugin parity across vaults — design

## Problem

The three consumer vaults (`accuris-sauce`, `headspace-sauce`, `ero-sauce`) drift in their
community-plugin state, producing different console behavior and a plugin the user cannot keep
disabled. The audit (documented in the headspace vault at
`spice/projects/sauce/docs/plugins/Plugin Audit.md`) established:

- **smart-connections** is force-re-enabled on every install pass because
  `applyExternalPluginInstall` unconditionally adds every declared `external_plugins[]` id to
  `.obsidian/community-plugins.json`. There is no "install the dir but don't auto-enable" flag.
  The user wants it **off by default** and to stay off.
- **Foundational plugins drift.** `templater-obsidian`, `dataview`, `obsidian-admonition`,
  `obsidian-tasks-plugin`, and `url-into-selection` are on mismatched versions across vaults
  because `fetchPlugin` returns `skipped` when the plugin dir already exists — sauce enforces
  **presence but never upgrades**. There is no version-pin/upgrade path.
- **editor-width-slider** (enabled only on accuris) throws a null-deref
  (`updateEditorStyleYAML` reads `.name` off a null active file during obsidian-kanban's
  `setActiveLeaf` chain) and logs debug `"1.1"`/`"1.2"` noise. Upstream's **latest release
  (1.0.5) still ships the bug** — there is no newer version to pin to. The user wants the
  slider at parity on all three vaults *and* the crash gone.
- **claudian** is really **two plugins**: old `claudian` v1.3.20 (personal build, not in the
  community index, enabled everywhere) and new `realclaudian` v2.0.21 (in the index as
  `yishentu/claudian`, enabled only on headspace). The user wants to **migrate to
  realclaudian everywhere and retire old claudian**.

Scope is **A + editor-width-slider + claudian**: fix the plugins the user named and enforce
versions for the plugins sauce already manages. Manually-installed plugins outside this set are
left alone. Subscriptions remain intentionally different per vault; "parity" means each vault is
at the pinned version for the components it manages — not identical plugin lists.

## Approach

**Approach 1 (chosen): extend the existing plugin machinery.** Add two optional manifest fields
and three `install.js` behaviors within the current `external_plugins[]` / `foundational_plugins[]`
model, plus two sentinel-guarded one-time heals. No new subsystem; reuses the vendoring and
heal patterns already present. (Rejected: Approach 2, a new dedicated `plugin-sync` mechanism —
duplicates existing machinery; Approach 3, operational-only — does not make the behavior stick.)

## Design

### 1. Manifest schema — two new optional fields

On `external_plugins[]` and `foundational_plugins[]` entries:

| Field | Default | Meaning |
| --- | --- | --- |
| `auto_enable` | `true` | When `false`, install the plugin **directory** but do NOT add the id to `community-plugins.json`. |
| `version` | (none) | Pinned target version. When set, install upgrades a plugin whose installed dir reports an older version. |

Both fields are additive and backward-compatible — omitting them preserves today's behavior.

### 2. `install.js` behavior — three changes

1. **`applyExternalPluginInstall` honors `auto_enable`.** When an entry has `auto_enable: false`,
   fetch/keep the plugin dir but exclude its id from the `mergeCommunityPlugins` add-set. All
   other entries continue to auto-enable as today.
2. **Version upgrade-on-mismatch.** For any `external_plugins[]` / `foundational_plugins[]`
   entry with a pinned `version`, after ensuring the dir exists, compare the installed
   `manifest.json` version to the pin. If installed `<` pinned (semver-ish compare), re-fetch to
   upgrade (for index-sourced plugins) or re-copy (for vendored plugins). Backup the prior dir
   contents on overwrite. Never downgrade.
3. **New `applyVendoredPluginInstall` step.** Copies a workshop-shipped patched plugin
   (`main.js`, `manifest.json`, `styles.css`) from a mechanism's `files[]` into
   `.obsidian/plugins/<id>/`. Backup-on-overwrite (`.sauce-backup`), atomic tmp+rename per file,
   and **never touches the user's `data.json`** (per-user settings). Governed by the same pinned
   `version` compare so re-installs are idempotent.

`scaffoldFoundationalPluginData` is unchanged (still only writes `data.json` when absent).

### 3. Concrete outcomes — component ownership

| Plugin | Mechanism | Manifest change |
| --- | --- | --- |
| smart-connections | `smart-connections-bridge` (existing) | `external_plugins: [{id:"smart-connections", required:false, auto_enable:false}]` |
| editor-width-slider | **`editor-width`** (new) | vendored patched build, pinned `version: "1.0.5-sauce.1"`, auto-enabled |
| realclaudian | **`agent-embed`** (new) | `external_plugins: [{id:"realclaudian", version:"2.0.21"}]` (index-fetched, auto-enabled) |
| templater / customjs / dataview / admonition / calendar / tasks / url-into-selection | `platform/manifest.json` `foundational_plugins[]` | add `version` pins: 2.20.0 / 1.0.21 / 0.5.68 / 11.0.3 / 1.5.10 / 7.23.1 / 1.11.4 |

**Vendored slider patch.** The workshop ships `editor-width-slider` `main.js` derived from
upstream 1.0.5 with exactly two changes: `if (file.name)` → `if (file?.name)` (the null guard)
and removal of the two debug `console.log("1.1")` / `console.log("1.2")` lines. `manifest.json`
version becomes `1.0.5-sauce.1` so the upgrade check can distinguish the patched build from a
stray upstream 1.0.5. `styles.css` copied verbatim.

### 4. Two one-time heals (sentinel-guarded)

Both record a sentinel (in the vault's ledger / a marker file consistent with existing heal
patterns) so they run **once** and never override a later deliberate user action.

- **`disableSmartConnectionsOnce`** — remove `smart-connections` from `community-plugins.json`
  where present (currently accuris), backup-on-edit, set sentinel. Combined with
  `auto_enable:false`, smart-connections is off and stays off unless the user re-enables it.
- **`retireOldClaudianOnce`** — remove old `claudian` from `community-plugins.json` on all three
  vaults, backup-on-edit, set sentinel. `realclaudian` becomes the enabled agent embed.

### 5. Error handling

- All community-plugins writes go through the existing `mergeCommunityPlugins` helper's
  contract (malformed-JSON guard, `.sauce-backup`, atomic write). A parallel remove path reuses
  the same guards.
- Vendored copy is failure-loud on a malformed workshop payload; skips (with a history note)
  when the target `data.json` cannot be read rather than clobbering user settings.
- Version compare treats an unparseable installed version as "older" only when the pin parses,
  and never downgrades.
- Index fetch failures (realclaudian) surface as a Notice + history warning, matching
  `applyExternalPlugins` today — install continues.

### 6. Rollout & testing

- Add `editor-width` and `agent-embed` to all three `ranch/platform-subscription.json` files
  (new-mechanism-needs-subscription lesson), then `sauce update --bump-pins` per vault.
- **Operational prerequisite (not this cycle's code):** catch `ero-sauce` up from `0.127.1`
  before deploy, with a backup, so the new mechanisms land on a current base.
- Release/versioning is fully automatic — conventional commits only; no hand-edited
  `workshop_version` / `package.json` / pins / tags.
- TDD (helper cases in `platform/test/`):
  - `auto_enable:false` → plugin dir present, id **absent** from `community-plugins.json`.
  - version-upgrade → older installed dir gets re-fetched/re-copied to the pin; equal/newer is a no-op.
  - vendored-install → patched `main.js` lands (contains `file?.name`, no `"1.1"` log), user
    `data.json` untouched, backup created on overwrite.
  - `disableSmartConnectionsOnce` / `retireOldClaudianOnce` → id removed once; second run is a
    sentinel no-op; a user re-add after the sentinel is preserved.

## Revision — 2026-07-14 (post-anchor discovery)

Code-anchor research surfaced three facts that change the build without changing the goals:

1. **Vendored slider uses existing machinery.** `applyBundledPlugin` (install.js:8529) already
   copies a mechanism's `bundled_plugin.files` into `.obsidian/plugins/<id>/`, stamps the
   mechanism version into the plugin manifest, and enables it — idempotent, never throws. The
   `editor-width` mechanism therefore ships the patched build via a `bundled_plugin` block; **no
   new `applyVendoredPluginInstall` function and no `external_plugins` fetch** (so upstream 1.0.5
   is never pulled). The `1.0.5-sauce.1` version string is moot — the plugin manifest inherits
   the mechanism version.
2. **`realclaudian` needs no `version` pin.** ero (absent) fetches the index's latest (2.0.21),
   accuris/headspace already have 2.0.21; a plain `external_plugins: [{id:"realclaudian"}]`
   entry enables it everywhere. The only new schema field this cycle is **`auto_enable`**.
3. **Foundational version enforcement is deferred (operational this cycle).** `sauce update`
   never fetches/upgrades foundational plugins today — that path exists only in fresh bootstrap
   (`bootstrap.js:phaseFetchPlugins`). Baking auto-force-upgrade into `install.js` would jump
   ero's templater 2.4.1→2.20.0 (and tasks/admonition) unattended, risking existing
   templates/queries. Per user decision, foundational versions are aligned **operationally
   during deploy** (small-delta upgrades applied; large jumps like ero templater flagged for the
   user), and the code-enforced auto-upgrade subsystem is a **carry-forward**. The `version`
   field on `foundational_plugins[]` is NOT added this cycle.

Net code scope this cycle: `auto_enable` field + `applyExternalPluginInstall` honoring it;
`smart-connections-bridge` manifest → `auto_enable:false`; new `editor-width` mechanism
(`bundled_plugin`, patched build); new `agent-embed` mechanism (`external_plugins` realclaudian);
two sentinel heals (`disableSmartConnectionsOnce`, `retireOldClaudianOnce`); tests.

## Non-goals

- Bringing manually-installed, sauce-unmanaged plugins (big-calendar, quickadd, tag-wrangler,
  etc.) under management.
- Identical plugin sets across vaults (subscriptions are intentionally divergent).
- Upgrading foundational plugins **beyond** the pinned "current" versions, or auto-tracking
  future upstream releases (pins are explicit and bumped deliberately).
