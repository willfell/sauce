---
date: 2026-05-05
phase: design
status: approved
target_cycle: v0.19.0 (tentative — pick at next-cycle-handoff selection time)
cycle_codename: styling-mechanism
predecessors:
  - blueprints i want.md (lines 11-62 — Styling wishlist + canonical Style Settings JSON)
  - Docs/plans/2026-05-04-v0.1.3-plugin-data-automation-result.md (helper posture mirror)
  - Docs/landmines.md (#12 plugin-data allowlist + four safety mechanics)
brainstorm_session: this design was frozen in a parallel chat session on 2026-05-05; sections 1-4 each user-approved before write
exit_criteria:
  - new-mechanism-styling-0.1.0-shipped
  - workshop_version-bumped-0.18.x-to-0.19.0-MINOR
  - mechanism-count-5-to-6
  - landmine-12-allowlist-3-to-6-paths
  - new-landmine-vendored-theme-ownership-next-available-number
  - 3-new-installer-helpers-applyVendoredThemes-applyAppearance-applyStyleSettings
  - new-landmine-claims-the-next-available-number-at-execution-time-NOT-pinned-to-15
  - workshop-self-install-+-barebones-install-green-+-idempotent
  - all-6-manual-smokes-A-F-user-confirmed
  - tag-vX.Y.0-annotated-and-pushed
---

# v0.19.0 (tentative) Design — Styling mechanism

> [!abstract] One new mechanism, single canonical style, prerequisite-style plugin posture
> Ships `styling@0.1.0` — vendored Baseline theme + canonical rose-pine-light/melange-dark Style Settings JSON. Style Settings community plugin declared as prerequisite (mirrors Templater + Slash Commander posture, NOT vendored). Three new installer helpers mirror the v0.1.3 plugin-data automation posture verbatim (additive merge, backup-on-edit, malformed-JSON guard, failure-loud history). Single-stage S1 + reserved 0.19.x headroom for 1-2 inline CFs (visual cohesion smoke-time feedback expected on the rose-pine palette).

---

## Origin

User has the Baseline theme + Style Settings JSON working across 3 production vaults (`accuris/`, `headspace/`, `ero/`) and wants beacon to ship the same look as a first-class platform mechanism. Workshop's `.obsidian/community-plugins.json` already enables `obsidian-style-settings`; no theme is installed yet. Accuris vault is the working reference: `cssTheme: "Baseline"` in `appearance.json`, theme files at `.obsidian/themes/Baseline/`, the canonical JSON at `.obsidian/plugins/obsidian-style-settings/data.json`.

---

## Section 1 — shape & scope (LOCKED)

New mechanism `styling@0.1.0`. Mechanism count 5 → 6.

```
platform/mechanisms/styling/
├── manifest.json
├── assets/
│   └── themes/
│       └── Baseline/
│           ├── manifest.json   # vendored from upstream (copy from accuris .obsidian/themes/Baseline)
│           └── theme.css       # vendored from upstream
└── data/
    └── style-settings-default.json   # canonical JSON (38 baseline-style@@... keys)
```

Consumer-side install touches three NEW `.obsidian/` paths (landmine #12 allowlist 3 → 6, expanded with the same four safety mechanics):
1. `.obsidian/themes/Baseline/{manifest.json, theme.css}` — vendored copy
2. `.obsidian/appearance.json` — set `cssTheme: "Baseline"`; merge `enabledCssSnippets` additively (preserves consumer's existing snippets like `customjs-loader`)
3. `.obsidian/plugins/obsidian-style-settings/data.json` — additive merge (first-wins per key; user overrides preserved on re-install; new canonical keys reach existing consumers as we extend the JSON in future cycles)

`obsidian-style-settings` declared in `external_plugins[]` (user installs the plugin themselves before running install — same prerequisite posture as Templater + Slash Commander). Theme is vendored; plugin is not.

**Locked alternatives rejected:**
- Preset-capable schema from day one — premature; deferred to a future v0.19.x cycle when a second style emerges.
- Two-mechanism split (theme-pack + style-settings) — no real reuse benefit; Style Settings is theme-specific.
- Vendoring the Style Settings plugin folder itself — inconsistent with current prerequisite story; pulls third-party source into repo with manual refresh burden.
- Fetch via obsidian-cli or HTTPS at install — no other helper does network; harder to make idempotent + offline-tolerant.
- Declare-only (don't vendor theme either) — adds a manual UI step before install; user explicitly preferred vendoring.

---

## Section 2 — manifest schema + installer mechanics (LOCKED)

**Mechanism manifest** (`platform/mechanisms/styling/manifest.json`):
```json
{
  "name": "styling",
  "version": "0.1.0",
  "description": "Vault appearance — Baseline theme + Style Settings canonical config.",
  "depends_on": [],
  "external_plugins": [
    { "id": "obsidian-style-settings", "name": "Style Settings", "required": true }
  ],
  "vendored_themes": [
    { "name": "Baseline", "src": "assets/themes/Baseline" }
  ],
  "appearance": {
    "cssTheme": "Baseline",
    "enabledCssSnippets": ["customjs-loader"]
  },
  "style_settings_defaults_src": "data/style-settings-default.json"
}
```

**Three new installer helpers** wired into `installItem` (`install.js:614`-ish, after `applyTemplaterFolderTemplates`), gated on the styling mechanism being subscribed. Existing `applyExternalPlugins` already validates Style Settings is installed before these helpers run — no new prereq plumbing.

| Helper | Reads | Writes | Merge rule |
|---|---|---|---|
| `applyVendoredThemes` | `assets/themes/<Name>/{manifest.json, theme.css}` from workshop | `.obsidian/themes/<Name>/` in consumer | overwrite vendored files (sha256 compare; backup non-empty prior to `<file>.bak`); event `replace/theme_overwrite`. Mirrors v0.2.0 boards Option B `file_overwrite` posture, applied under `.obsidian/`. |
| `applyAppearance` | `manifest.appearance` | `.obsidian/appearance.json` | `cssTheme` always set (single canonical theme); `enabledCssSnippets[]` additive union (consumer's existing snippets preserved). Backup-on-edit to `<target>.beacon-backup`. |
| `applyStyleSettings` | `data/style-settings-default.json` | `.obsidian/plugins/obsidian-style-settings/data.json` | additive per-key first-wins (user values preserved on re-install; new canonical keys reach existing consumers). Backup-on-edit. |

Posture mirrored verbatim from v0.1.3 (`applyTemplaterHotkeys` / `applySlashCommanderBindings`) and v0.3.0 (`applyCorePluginSettings`):
- additive-merge-only (themes excepted: vendored sha256 overwrite)
- backup-on-edit to `<target>.beacon-backup`
- malformed-JSON guard (refuse to write; emit Notice; record `error/malformed_json` history; never throws)
- failure-loud history (every read/write emits an `installed.history` event)

**Helper-cases harness** grows 255 → ~270 (5 cases per helper × 3 = ~15 sub-asserts under new selector `styling`):
- `caseStyling1*` defaults-write-on-empty (data.json absent → full canonical write)
- `caseStyling2*` additive-merge-preserves-user-override (existing keys win; new keys filled)
- `caseStyling3*` malformed-JSON guard (corrupt data.json → Notice + abort + history error)
- `caseStyling4*` missing-target Notice (themes dir absent → mkdir; appearance.json absent → write fresh)
- `caseStyling5*` backup-on-edit verification (`<target>.beacon-backup` exists post-edit)

---

## Section 3 — landmine #12 expansion + new landmine #15 (LOCKED)

**Landmine #12 path-count 3 → 6.** Updated allowlist:

| Path | Helper | Posture |
|---|---|---|
| `.obsidian/plugins/templater-obsidian/data.json` | applyTemplaterHotkeys | additive merge (existing) |
| `.obsidian/plugins/slash-commander/data.json` | applySlashCommanderBindings | additive merge (existing) |
| `.obsidian/daily-notes.json` | applyCorePluginSettings | additive shallow merge (existing) |
| **`.obsidian/themes/<Name>/`** | applyVendoredThemes | overwrite-with-backup (NEW this cycle) |
| **`.obsidian/appearance.json`** | applyAppearance | additive merge (NEW this cycle) |
| **`.obsidian/plugins/obsidian-style-settings/data.json`** | applyStyleSettings | additive per-key first-wins (NEW this cycle) |

Same four safety mechanics enforced on every NEW path (no new safety primitives — reused verbatim from existing helpers).

**New landmine (next-available number at execution time — NOT pinned to #15).** *Vendored theme is owned by the styling mechanism; never hand-edit `.obsidian/themes/Baseline/` in any vault.* Edits get clobbered on next install (sha256 compare → overwrite, prior content preserved at `.bak`). Customizations route through Style Settings JSON (the whole point of the plugin) or a separate user-owned snippet under `.obsidian/snippets/`.

> [!warning] Numbering note
> The post-v0.18.2 docs-polish candidate cycle is also tentatively claiming landmine #15 (for a separate gotcha v0.18.2 surfaced). Whichever cycle lands first claims #15; this cycle's landmine takes the next available number at execution time. The implementer must `grep '^### Landmine #' Docs/landmines.md` and pick the next slot — do not hard-code #15 in the design.

---

## Section 4 — dogfooding, version bumps, smokes, cycle shape (LOCKED)

**Workshop self-subscription:** add `styling@0.1.0` to mechanisms[]. Workshop already has Style Settings plugin installed; first dogfood passes prereq without action.

**Barebones consumer:** add `styling@0.1.0` to its `platform-subscription.json`. Barebones doesn't have Style Settings yet — first run will Notice "Install Style Settings first, then re-run install" (existing v0.1.3 prereq behavior). User installs via Obsidian UI, re-runs.

**Version bumps:**
- `styling@0.1.0` (new mechanism)
- `workshop_version` MINOR bump (every prior new-mechanism cycle was MINOR — v0.11.0 cards, v0.18.0 beacon-button precedent)
- Annotated tag pushed
- Mechanism count 5 → 6 in CLAUDE.md status snapshot

**Manual smokes (in barebones, post-Cmd+R):**
| # | Smoke | Pass criteria |
|:-:|---|---|
| A | Fresh install with Style Settings absent | Notice fires; `appearance.json` + Style Settings `data.json` untouched; no theme files written |
| B | Install Style Settings, re-run install | Baseline theme materializes at `.obsidian/themes/Baseline/`; `appearance.json` `cssTheme: "Baseline"`; Style Settings `data.json` populated with full canonical JSON |
| C | Cmd+R; visual check | Baseline + rose-pine-light renders; H1 muted-purple, H2 rose, custom Inter font, blockquote-edge style visible |
| D | Edit one Style Settings key (e.g., `h1-size`) in plugin UI; re-run install | User's override preserved (additive first-wins); other canonical keys unchanged; no `.beacon-backup` thrash |
| E | Add a user CSS snippet via Obsidian UI; re-run install | User snippet preserved in `enabledCssSnippets[]`; canonical `customjs-loader` still present; additive union holds |
| F | Workshop self-install (dogfood) | Same Pass-state as B + C in workshop's own `.obsidian/` |

**Cycle shape prediction:** Closest precedent is v0.1.3 plugin-data automation (mirror posture, same 4 safety mechanics, gated by `applyExternalPlugins`). v0.1.3 closed clean with no inline-CFs because the four safety mechanics had a stable template. Expectation: **single-stage S1 + reserved 0.19.x headroom for 1-2 inline CFs** (visual cohesion / smoke-time feedback on the rose-pine palette feeling off in some surface — gotcha 9 reserved-headroom-unused has 2 data points; pure-mechanism cycles tend to land cleaner than entity-ecosystem cycles).

**Stages:**
- **S1** — vendor Baseline assets (copy from `../accuris/.obsidian/themes/Baseline/`); ship mechanism manifest; add 3 helpers to `install.js`; wire into `installItem`; extend landmine #12 + add #15 in `Docs/landmines.md`; harness +15 sub-asserts under `styling` selector; workshop self-subscription bump; barebones subscription bump; manual smokes A-F.
- *(S2 reserved for inline CFs if smokes surface drift.)*

**Out-of-scope (carry-forward to future cycles):**
- Multiple presets (rose-pine / catppuccin / nord — schema is single-style for now per Section 1)
- User-selectable styles via consumer subscription (`style_preset: "<name>"`)
- Per-vault palette overrides via subscription variables
- Vendoring Style Settings plugin itself (deferred per Section 1)

---

## Reference — canonical Style Settings JSON

Verbatim copy of `../accuris/.obsidian/plugins/obsidian-style-settings/data.json`. To be vendored at `platform/mechanisms/styling/data/style-settings-default.json`.

```json
{
  "baseline-style@@accented-interface": true,
  "baseline-style@@color-scheme-light": "rose-pine-light",
  "baseline-style@@color-scheme-dark": "melange-dark",
  "baseline-style@@color-scheme-accent": true,
  "baseline-style@@radius-modifier": 1.5,
  "baseline-style@@element-style": "input-fluent",
  "baseline-style@@colorful-folders": "colorful-folders-off",
  "baseline-style@@hide-vault-switcher-off": true,
  "baseline-style@@nav-indentation-guide-width": "1px",
  "baseline-style@@font-text-override": "Inter",
  "baseline-style@@indentation-guide-width": "1px",
  "baseline-style@@active-line-style": "active-line-side",
  "baseline-style@@h1-color@@light": "#575279",
  "baseline-style@@h1-size": "1.8em",
  "baseline-style@@h1-weight": 600,
  "baseline-style@@h1-l": true,
  "baseline-style@@h2-color@@light": "#B4637A",
  "baseline-style@@h2-size": "1.7em",
  "baseline-style@@h3-color@@light": "#D7827E",
  "baseline-style@@h3-size": "1.6em",
  "baseline-style@@h4-color@@light": "#286983",
  "baseline-style@@h4-size": "1.5em",
  "baseline-style@@h5-color@@light": "#907AA9",
  "baseline-style@@h5-size": "1.4em",
  "baseline-style@@h6-size": "1.1em",
  "baseline-style@@blockquote-style": "blockquote-edge",
  "baseline-style@@blockquote-border-thickness": 5,
  "baseline-style@@blockquote-border-color@@light": "#F6C177",
  "baseline-style@@code-line-numbers": true,
  "baseline-style@@embed-style": "embed-block",
  "baseline-style@@row-lines": true,
  "baseline-style@@col-lines": true,
  "baseline-style@@tag-radius": "16px",
  "baseline-style@@tag-border-width": 1,
  "baseline-style@@checkbox-radius": "100px",
  "baseline-style@@tab-top-left-style": "tab-top-left-icon",
  "baseline-style@@nav-action": "nav-action-center",
  "baseline-style@@tab-left-style": "tab-left-icon",
  "baseline-style@@tab-right-style": "tab-right-icon"
}
```

---

## Handoff note

This design was brainstormed in a parallel chat session while another window executed the post-v0.18.1 cycle. Per the Beacon handoff protocol, this doc lives in the working tree as untracked-pre-write or modified state until the next cycle-close handoff-writer surfaces it as a candidate. The wishlist entry at `blueprints i want.md` lines 11-62 has been updated with a pointer to this design doc.

When the next session picks this cycle up, **skip `/de:brainstorming`** — sections 1-4 are user-approved. Go straight to `/de:writing-plans` to derive the implementation plan, then execute.
