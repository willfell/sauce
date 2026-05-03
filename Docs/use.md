# How to use the platform

This doc covers daily operations. For architectural background, see [how.md](how.md).

## Onboarding a new consumer vault

The recurring workflow. Steps:

### 1. Decide vault paths

Two choices the consumer's `platform-config.json` needs:
- `views_path` — where Dataview view scripts go (e.g., `Docs/Meta/Views`, or `Extras/Scripts` if not yet canonically migrated).
- `templater_scripts_path` — where Templater user scripts go (matches the consumer's Templater settings).

If the consumer is brand new (no existing customjs-guard installation), use the canonical paths:
```json
{
  "workshop_relative_path": "../workshop/poc-vault",
  "variables": {
    "views_path": "Docs/Meta/Views",
    "templater_scripts_path": "Docs/Meta/Templater",
    "scripts_path": "Docs/Meta/Scripts"
  }
}
```

If the consumer has an existing customjs-guard installation (e.g., accuris), use its current paths so the installer overwrites cleanly without orphan files.

### 2. Write the consumer's bootstrap files

Three files, all under `<consumer>/Docs/Meta/`:

- `platform-config.json` — paths + variables.
- `platform-subscription.json` — what mechanisms this vault adopts.
- `Templater/platformInstall.js` — copy of `<workshop>/platform/install.js`. This is the bootstrap: the consumer needs `platformInstall.js` BEFORE it can run any other install.

### 3. Verify Obsidian-side configuration

In the consumer vault's Obsidian:
- Templater plugin's "Script files folder location" matches `templater_scripts_path` from `platform-config.json`.
- CustomJS plugin's "JS files folder" matches `scripts_path` from `platform-config.json`.
- Dataview plugin has "Enable JavaScript queries" ON.
- The plugins are present + enabled (Templater, Dataview, CustomJS at minimum).

### 4. Run the installer

In the consumer vault's Obsidian:
1. Settings → Templater → User Script Functions → reload.
2. Open any note. Command palette → `Templater: Open Insert Template modal` → pick the install template (or paste `<%* await tp.user.platformInstall(tp) %>` into a note and run "Templater: Replace templates in active file").
3. Approve the gates that fire (CSS snippet, appearance.json edit).
4. Final Notice: `platformInstall: complete.`

### 5. Verify

```bash
cat <consumer>/Docs/Meta/platform-installed.json
ls <consumer>/Docs/Meta/Templater/{validate,hook-validate,audit-walker,platformInstall}.js
ls <consumer>/<views_path>/customjs-guard/view.js
cat <consumer>/.obsidian/appearance.json | grep customjs-loader
```

All five should resolve. `platform-installed.json` should list the subscribed mechanisms with `installed_at` timestamps.

### 6. Wire the validator hook (optional, after first install)

If you want the validator to fire automatically on every new note in this consumer:
- Templater → Trigger settings → enable "Trigger Templater on new file creation".
- Add a startup hook: in the consumer's Templater settings, register a startup template that calls `<%* await tp.user["hook-validate"](tp) %>`.
- The hook reads each newly-created note's frontmatter, looks up the matching rule, validates, auto-fixes simple things, surfaces complex violations as Notices.

This is opt-in — without it, the validator only fires when manually invoked.

---

## Slash Commander setup (per consumer vault)

> [!info] Why this exists
> The platform ships three runner templates (`Create New Project.md`, `Validate.md`, `Audit.md`) as Templater commands. Slash Commander is a third-party community plugin that surfaces them as ergonomic slash keywords (`/new-project`, `/validate`, `/audit`) — type the keyword in any note → command palette filters → Templater fires the template. One-time setup per consumer vault.

> [!todo] One-time setup steps
> 1. **Install the plugin.** Settings → Community plugins → Browse → search "Slash Commander" → Install → Enable. The installer's `external_plugins[]` check fires a Notice + history `warning, step: external_plugins` entry on every install if this is missing.
> 2. **Register the three runner templates in Templater's "Template Hotkeys" section.** Settings → Templater → scroll to "Template Hotkeys" → click "Add new hotkey for template" three times → in each dropdown pick `Docs/Meta/Templates/Create New Project.md`, `Docs/Meta/Templates/Validate.md`, `Docs/Meta/Templates/Audit.md`. (You don't need to assign a keyboard hotkey — registration alone surfaces them as `Templater: Insert <name>` commands in the palette.) Each registration appears as an entry in `.obsidian/plugins/templater-obsidian/data.json:enabled_templates_hotkeys`.
> 3. **Reload Templater user scripts** (Settings → Templater → reload user scripts) so `tp.user.validate` and `tp.user["audit-walker"]` are picked up.
> 4. **Map the three slash keywords.** Settings → Slash Commander → "Add command":
>    - `/new-project` → `Templater: Insert Create New Project`
>    - `/validate` → `Templater: Insert Validate`
>    - `/audit` → `Templater: Insert Audit`

> [!warning] Why step 2 is required (Templater quirk)
> Templater does NOT auto-generate per-template commands — by default the command palette only exposes 4 base Templater commands (Open insert template modal, Replace templates in active file, Jump to next cursor location, Create new note from template). Per-template `Templater: Insert <name>` commands ONLY appear in the palette (and therefore are ONLY mappable in Slash Commander) AFTER registering each template in the Template Hotkeys section. Without step 2, Slash Commander's command picker shows none of the three "Insert" commands; mapping fails. Surfaced during v0.1.x manual smokes (T2.6) — codified here. The platform installer cannot do this registration automatically because editing `.obsidian/plugins/templater-obsidian/data.json` is an "ask before acting" gate (CLAUDE.md non-negotiables); per-vault user action only.

> [!example] Verifying
> Open any note. Type `/validate` → Notice: `validate: clean` (or violation count + console output). Type `/audit` → walker runs; Notice: `audit: complete — see Timestamps/Audits/`. Type `/new-project` → prompts for slug; new project note materializes under `boards/planning/<slug>/`.

> [!warning] Plugin id is `slash-commander`
> The Obsidian community-plugin slug is the un-prefixed form (NOT `obsidian-slash-commander`). The three manifests' `external_plugins[].id` declarations cite this exact string. Locked from disk in v0.1.x patch cycle (T2.1) by reading `.obsidian/community-plugins.json` after a real install.

---

## Updating an existing consumer

Consumer is at version A; workshop has version B (newer):

1. In workshop: bump versions in `platform/manifest.json` and the relevant `mechanisms/<name>/manifest.json`.
2. Obsidian Sync delivers the new workshop contents to every machine.
3. In the consumer: edit `Docs/Meta/platform-subscription.json` to pin the new versions.
4. Run `tp.user.platformInstall(tp)` in the consumer. It detects the version delta and re-installs.
5. `platform-installed.json` records the new version + a new history entry.

## Adding a new mechanism

1. In `workshop/platform/mechanisms/<new-name>/`:
   - Write the JS / CSS / config files.
   - Write `manifest.json` declaring `name`, `version`, `files`, `post_install`.
2. Update `workshop/platform/manifest.json`'s `mechanisms` array — add `{ name, version, path }`.
3. Test in workshop's self-install: bump workshop's `platform-subscription.json` to include the new mechanism, run `tp.user.platformInstall(tp)`, verify materialization.
4. When ready, update each consumer's subscription and run their installer.

## Adding a new blueprint

The first blueprint is the next major workstream. Sketch:

1. In `workshop/platform/blueprints/<name>/`:
   - `rule.json` — required tags, frontmatter, blocks, naming.
   - `templates/` — Templater templates.
   - `helpers/` — CustomJS classes.
   - `commands/` — slash commands.
   - `variants.json` — per-vault aliases.
   - `manifest.json`.
2. The installer needs blueprint-handling code. The current installer has the loop scaffolded but not implemented (see `// for (const sub of subscription.blueprints || [])` comment in `install.js`).

## Running the audit

Once `audit-walker.js` + `Audit.md` are materialized in a consumer (audit mechanism v0.1.0+) and Slash Commander is mapped:

1. Open any note in the consumer.
2. Type `/audit` (or run `Templater: Insert Audit` from the command palette).
3. Audit report writes to `Timestamps/Audits/YYYY-MM-DD-audit.md`.
4. Sections: platform drift, violations summary, violations by file.
5. Notice: `audit: complete — see Timestamps/Audits/`.

> [!info] Pre-Slash-Commander fallback
> If Slash Commander isn't installed, run the audit by replacing templates in the active file with `<%* await tp.user["audit-walker"](tp); %>`. The `Audit.md` runner template is the same content as a saved Templater command.

## Recovering from a broken install

If the installer aborts mid-flight:
- `platform-installed.json` only records mechanisms that succeeded entirely. Partial installs are not recorded.
- Files that DID land are still on disk. They're in canonical locations (no half-written files since `adapter.write` is atomic).
- Re-running `tp.user.platformInstall(tp)` is idempotent: already-installed mechanisms (matching version in `platform-installed.json`) are skipped.
- If an approval gate was declined, the file is skipped but the mechanism is otherwise installed. Re-run the installer to re-prompt.

If you need to fully reset a consumer's platform state:
1. Delete `Docs/Meta/platform-installed.json`.
2. Optionally delete `Docs/Meta/Templater/{validate,hook-validate,audit-walker}.js`, `Docs/Meta/Views/customjs-guard/view.js`, `.obsidian/snippets/customjs-loader.css`.
3. Re-run `tp.user.platformInstall(tp)`. Everything re-installs from scratch.
