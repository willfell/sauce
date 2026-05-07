# How to use the platform

This doc covers daily operations. For architectural background, see [how.md](how.md).

## Onboarding via curl one-liner (v0.22.0+)

The fastest way to onboard a fresh consumer vault is the inside-vault layout introduced in v0.22.0 — a single curl one-liner clones the workshop into `<vault>/pantry/`, npm-installs, and runs the first-run wizard.

> [!success] One command
> ```bash
> cd /path/to/your/vault
> curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh | bash
> ```

> [!info] Prerequisites
> - **Node.js 18 or newer** (`brew install node` on macOS, `apt-get install -y nodejs npm` on Debian/Ubuntu, `dnf install -y nodejs npm` on Fedora/RHEL).
> - **git 2.30 or newer** (`brew install git` / `apt-get install -y git` / `dnf install -y git`).
>
> The installer fails loud at phase `[1/4]` if either binary is missing.

### What the wizard prompts for

After the curl one-liner clones + npm-installs, the existing first-run wizard runs (5 prompts via `@inquirer/prompts`):

1. **Workshop relative path** (defaults to `pantry` for the inside-vault layout)
2. **Vault display name** (defaults to vault dirname)
3. **Mechanisms checkbox** (defaults: customjs-guard, nav-buttons, cards, accent-button, styling, convenience)
4. **Blueprints checkbox** (defaults: none — opt-in per blueprint)
5. **Confirm summary**

> [!info] Multi-theme presets DEFERRED
> v0.22.0 keeps the existing free-form mechanism + blueprint picker. Multi-theme subscription presets (rose-pine-dawn / melange-dark / one-dark / tokyo-night-storm packaged as one-click subscriptions) are DEFERRED to v0.23.0+ per user direction.

### Where the workshop lands

```
<vault>/
├── pantry/                               NEW — workshop clone
│   ├── platform/                         CLI verbs, install.js, mechanisms, blueprints
│   ├── Scripts/{activate.sh, sauce}      NEW — activation + CLI wrapper
│   ├── node_modules/                     npm install --omit=dev artifact
│   └── .git/                             clone --depth=1 history
└── ranch/platform-{config,subscription,installed}.json       Consumer-side state
```

### Activation per shell

The install does NOT modify `~/.zshrc` or `~/.bashrc`. Each new shell needs:

```bash
source <vault>/pantry/Scripts/activate.sh
```

After that, the `sauce` CLI is on your PATH:

- `sauce status` — read-only state report
- `sauce update` — `git fetch + git reset --hard origin/main` inside `pantry/` + re-run installer
- `sauce update --force` — discard dirty working tree before reset
- `sauce wizard` — re-run the subscription / config prompts

> [!tip] Full reference
> See [install.md](install.md) for the full reference — sync-exclusion guides for Obsidian Sync / iCloud / Dropbox, troubleshooting, uninstall steps.

---

## Onboarding a new consumer vault (post-v0.1.2)

> [!info] When to use this flow vs the curl one-liner
> The curl one-liner above is the canonical flow for fresh consumer vaults. Use the manual flow below when you're (a) maintaining an existing POC vault that uses the legacy sibling-of-workshop layout, (b) onboarding into an environment without internet access, or (c) explicitly want the legacy `workshop_relative_path: "../beacon"` shape rather than the inside-vault `pantry/` shape.



Before v0.1.2 the onboarding flow required cp'ing a 1300-line `install.js` into each consumer's `ranch/templater/platformInstall.js` (the bootstrap-copy × 3 ritual). v0.1.2 retires that — consumers now use a 20-line content-static thin stub that dispatches at runtime.

### 1. Clone the workshop repo

On the consumer machine, ensure the Sauce workshop is cloned at a known relative path. The convention is `../workshop/poc-vault` from each consumer vault root, but any path works as long as it's recorded in `platform-config.json` (step 2):

```bash
git clone git@github-personal:willfell/sauce.git /path/to/workshop/poc-vault
```

### 2. Create the consumer's bootstrap state files

In the new vault's `ranch/`, create three JSON files (all platform metadata is JSON per landmine #6):

- **`platform-config.json`** — at minimum:
  ```json
  {
    "workshop_relative_path": "../workshop/poc-vault",
    "variables": {
      "templates_path": "ranch/templates",
      "scripts_path": "ranch/scripts",
      "rules_path": "ranch/rules"
    }
  }
  ```
- **`platform-subscription.json`** — list mechanisms + blueprints to install with version pins:
  ```json
  {
    "workshop_version": "0.5.0",
    "mechanisms": [
      { "name": "customjs-guard", "version": "1.0.0" },
      { "name": "validator", "version": "0.1.1" },
      { "name": "audit", "version": "0.1.1" }
    ],
    "blueprints": []
  }
  ```
- `platform-installed.json` is auto-managed; the installer creates it on first run.

### 3. Drop in the thin stub

Copy the canonical stub from the workshop:

```bash
cp /path/to/workshop/poc-vault/platform/installer-stub.js \
   /path/to/consumer/ranch/templater/platformInstall.js
```

Verify md5 matches the canonical:
```bash
md5sum /path/to/workshop/poc-vault/platform/installer-stub.js \
       /path/to/consumer/ranch/templater/platformInstall.js
```

The stub is content-static per landmine #13 — never edit it per-consumer. Future workshop updates reach the consumer via `git pull` in the workshop repo + a fresh install run; the stub itself doesn't change.

### 4. Install Slash Commander (community plugin)

In Obsidian: Settings → Community plugins → Browse → "Slash Commander" → Install + Enable. This is irreducible per Obsidian's plugin-install API not being script-accessible (the only manual plugin step left in the consumer flow).

### 5. Run the installer

Open the Templater command palette and run `_install-platform`. The thin stub reads `platform-config.json`, resolves the workshop path, and dispatches to canonical `<workshop>/platform/install.js`. The canonical installer materializes mechanisms + blueprints, applies external-plugin checks, registers Templater hotkeys + Slash Commander bindings (v0.1.3), and records the run in `platform-installed.json` history with `git_commit / git_tag / git_dirty` (v0.1.2).

### 6. Reload Obsidian

Cmd+R (or Ctrl+R) — picks up newly registered Templater hotkeys + Slash Commander bindings. The slash commands `/validate`, `/audit`, and any blueprint-declared bindings go live.

---

## Slash Commander setup (per consumer vault)

> [!info] Why this exists
> The platform ships three runner templates (`Create New Project.md`, `Validate.md`, `Audit.md`) and surfaces them as slash commands (`/new-project`, `/validate`, `/audit`) via the Slash Commander community plugin. Three steps total per consumer vault — two installer-driven, one manual.

> [!todo] One-time setup steps
> 1. **Install Slash Commander.** Settings → Community plugins → Browse → search "Slash Commander" → Install → Enable. Irreducible (Obsidian's plugin install API is not exposed to scripts).
> 2. **Run the platform installer.** It writes Templater Template Hotkeys + Slash Commander bindings into the two plugin data.jsons (additive merge, backup on edit, idempotent on re-runs). See landmine #12 for the safety mechanics.
> 3. **Reload Obsidian** (Cmd+R / Ctrl+R or restart). Plugin caches re-read from disk; the three slash commands go live. Irreducible (Templater registers per-template commands at plugin boot, not on settings save).

> [!example] Verifying
> Open any note. Type `/validate` → fuzzy-matches the platform's binding → fires `Insert Validate` → Notice: `validate: clean` (or violation count). Type `/audit` → walker writes `Timestamps/Audits/<today>-audit.md`. Type `/new-project` → prompts for slug → new project note materializes.

> [!warning] Plugin id is `slash-commander`
> The Obsidian community-plugin slug is the un-prefixed form (NOT `obsidian-slash-commander`). The three manifests' `external_plugins[].id` declarations cite this exact string. Locked from disk in v0.1.x patch cycle (T2.1) by reading `.obsidian/community-plugins.json` after a real install.

---

## Updating an existing consumer

Consumer is at version A; workshop has version B (newer):

1. In workshop: bump versions in `platform/manifest.json` and the relevant `mechanisms/<name>/manifest.json`.
2. Obsidian Sync delivers the new workshop contents to every machine.
3. In the consumer: edit `ranch/platform-subscription.json` to pin the new versions.
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
1. Delete `ranch/platform-installed.json`.
2. Optionally delete `ranch/templater/{validate,hook-validate,audit-walker}.js`, `ranch/views/customjs-guard/view.js`, `.obsidian/snippets/customjs-loader.css`.
3. Re-run `tp.user.platformInstall(tp)`. Everything re-installs from scratch.
