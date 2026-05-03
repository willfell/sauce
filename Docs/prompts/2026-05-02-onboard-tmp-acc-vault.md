# Prompt — Onboard `tmp-acc-vault` as the first external consumer

> **For the user:** Open a fresh Claude Code session at the workshop vault root: `cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault`. Copy the entire fenced prompt below and paste it as the first user message.

> **Why this prompt exists:** `tmp-acc-vault` is a test mirror of the real accuris vault. The platform self-installs in the workshop (Phase 6 ✅). The next milestone is proving the **cross-vault** flow — writing bootstrap files into a separate vault, having the installer read FROM the workshop, materializing files INTO the consumer. We do this on the test mirror first to avoid risking real accuris content.

---

````text
Working directory: /Users/willfell/Documents/obsidian/sync/workshop/poc-vault (the workshop / canonical platform host).
Target vault for this onboarding: /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault (test mirror of accuris).

YOUR JOB
========
Onboard tmp-acc-vault as the first external consumer of the platform. Bootstrap its config + subscription, copy in the installer, then hand off to the user to run the installer in Obsidian and verify materialization. Report results.

READ FIRST (in this order, in full)
====================================
1. ./CLAUDE.md — workshop identity check + non-negotiables.
2. ./Docs/Index.md — documentation entry point.
3. ./Docs/why.md — purpose and end goal.
4. ./Docs/how.md — architecture, three concepts (mechanism / blueprint / subscription), installer flow.
5. ./Docs/use.md — operational guide. Section "Onboarding a new consumer vault" is the procedure for this task.
6. ./Docs/landmines.md — every trap we've already hit. NON-NEGOTIABLE. Reread before writing any code or running any install.

VERIFY VAULT IDENTITY before any write
=======================================
Run `ls /Users/willfell/Documents/obsidian/sync/workshop/poc-vault`. Expected: CLAUDE.md, Docs/, platform/, commands/, .obsidian/. If you see Boards/, Timestamps/, Resources/, or Finance/ at root, STOP — wrong vault.

Run `ls /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault`. Expected: looks like accuris (Boards/, Timestamps/, Docs/, Extras/, etc.). If empty or missing, STOP — the test mirror was not set up.

CONTEXT YOU NEED
================
- The workshop ships three mechanisms: customjs-guard@1.0.0, validator@0.1.0, audit@0.1.0.
- The workshop's own self-install ALREADY succeeded (Phase 6). Workshop has Docs/Meta/platform-installed.json with all three mechanisms recorded.
- tmp-acc-vault is a copy of accuris, so it ALREADY has customjs-guard installed at Extras/Scripts/customjs-guard/view.js (from the original accuris rollout). The installer will overwrite that file with the workshop's version. They should be byte-identical (workshop's version was originally copied from accuris). If the diff is non-empty before install, capture it for the user.
- tmp-acc-vault ALREADY has .obsidian/snippets/customjs-loader.css and customjs-loader enabled in appearance.json (from the accuris original). The installer's enable_snippet step is idempotent — it will detect already-enabled and skip.

PHASE A — Discover tmp-acc-vault's current state
=================================================
Capture (read-only):
1. Confirm tmp-acc-vault is a separate vault (.obsidian/ exists at its root).
2. List existing customjs-guard artifacts in tmp-acc-vault:
   - Extras/Scripts/customjs-guard/view.js → exists?
   - .obsidian/snippets/customjs-loader.css → exists?
   - .obsidian/appearance.json → contains customjs-loader in enabledCssSnippets?
3. Confirm Templater plugin's data.json: read .obsidian/plugins/templater-obsidian/data.json. Capture user_scripts_folder. (Will likely be unset or "Docs/Meta/Templater"; if anything else, flag it for the user.)
4. Confirm CustomJS plugin's data.json: read .obsidian/plugins/customjs/data.json. Capture jsFolder.
5. Capture Templater's templates_folder so we know where to drop the install template.
6. Confirm: does Docs/Meta/Templater/ exist? If not, the installer will create it, but flag.

PHASE B — Write bootstrap files into tmp-acc-vault
====================================================
Three files. Use the EXISTING tmp-acc-vault paths (do not impose canonical migration):

B.1. /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault/Docs/Meta/platform-config.json:
{
  "_comment": "tmp-acc-vault test mirror config. Mirrors accuris's current paths so the installer respects existing layout.",
  "workshop_relative_path": "../poc-vault",
  "variables": {
    "views_path": "Extras/Scripts",
    "templater_scripts_path": "Docs/Meta/Templater",
    "scripts_path": "Docs/Meta/Scripts"
  }
}

Note: workshop_relative_path is "../poc-vault" because tmp-acc-vault sits at workshop/tmp-acc-vault and the canonical platform sits at workshop/poc-vault — they're siblings under workshop/.

B.2. /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault/Docs/Meta/platform-subscription.json:
{
  "_comment": "tmp-acc-vault subscribes to all three v0.x mechanisms.",
  "workshop_version": "0.2.0",
  "mechanisms": [
    { "name": "customjs-guard", "version": "1.0.0" },
    { "name": "validator", "version": "0.1.0" },
    { "name": "audit", "version": "0.1.0" }
  ],
  "blueprints": []
}

B.3. /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault/Docs/Meta/Templater/platformInstall.js:
Copy of /Users/willfell/Documents/obsidian/sync/workshop/poc-vault/platform/install.js (byte-identical).
Make sure Docs/Meta/Templater/ exists in tmp-acc-vault first; create if missing.

Optional B.4: a one-shot install template. Copy /Users/willfell/Documents/obsidian/sync/workshop/poc-vault/Docs/Meta/Templates/_install-platform.md to tmp-acc-vault/Docs/Meta/Templates/_install-platform.md. Make sure Docs/Meta/Templates/ exists; create if missing.

After each write, verify the file landed (read it back). For B.3, run a `diff` between source and dest to confirm byte-identical.

PHASE C — Hand off to the user for Obsidian-side steps
=======================================================
You CANNOT do these. Surface them clearly:

C.1. Open tmp-acc-vault in Obsidian (File → Open vault → /Users/willfell/Documents/obsidian/sync/workshop/tmp-acc-vault).

C.2. Verify Templater config in tmp-acc-vault: Settings → Templater → "Script files folder location" should be Docs/Meta/Templater. If not, set it.

C.3. Verify Templater "Template folder location" matches where you want install templates. The default tmp-acc-vault setting (inherited from accuris) is probably Extras/Templates — if so, copy _install-platform.md there instead, OR change Templater's setting to Docs/Meta/Templates.

C.4. Settings → Templater → User Script Functions → reload (Templater scans templater_scripts_folder and registers tp.user.platformInstall).

C.5. Open any note in tmp-acc-vault. Command palette → "Templater: Open Insert Template modal" → pick _install-platform. Approve the gates that fire (CSS snippet copy will likely be a NO-OP since the file already exists; appearance.json edit will be NO-OP since customjs-loader is already enabled). Final Notice: "platformInstall: complete."

C.6. Reload Templater again to pick up validate.js / hook-validate.js / audit-walker.js.

PHASE D — Verify (you can do this once user reports install complete)
=====================================================================
Read these files in tmp-acc-vault and report contents:
- Docs/Meta/platform-installed.json — should list customjs-guard@1.0.0, validator@0.1.0, audit@0.1.0 with installed_at timestamps.
- Docs/Meta/Templater/{validate.js, hook-validate.js, audit-walker.js, platformInstall.js} — all four should exist.
- Extras/Scripts/customjs-guard/view.js — should match workshop's version (run diff).
- .obsidian/snippets/customjs-loader.css — should exist.
- .obsidian/appearance.json — enabledCssSnippets should include customjs-loader.

If any of those are missing or wrong, report exactly what's wrong. Do NOT try to "fix" by re-running the installer — the user runs it.

PHASE E — Report back
======================
Produce a short summary:
- Bootstrap files written? (yes/no)
- Pre-install state of tmp-acc-vault (any pre-existing artifacts).
- Post-install verification results (each file: present, absent, or different).
- Any deviations from expectation (capture for the user; do not silently fix).
- Recommendation for the next step: real accuris onboarding, or fix issues first.

HARD RULES
==========
1. Do not modify any file outside tmp-acc-vault and (within the workshop) the Docs/prompts/ logs.
2. Do not modify the workshop's platform/ source files; this onboarding is a consumer-side operation.
3. Do not propose canonical-path migration for tmp-acc-vault — that's a separate plan. The installer respects existing paths via platform-config.json variables.
4. Do not invent new mechanisms or blueprints; the workshop ships exactly three mechanisms.
5. The five customjs-guard landmines + the three platform landmines from Docs/landmines.md are non-negotiable — do not reintroduce any of them.
6. If you discover that workshop_relative_path "../poc-vault" doesn't resolve correctly from tmp-acc-vault (e.g., adapter.basePath returns something unexpected), surface it; don't paper over.
7. The user has explicitly said tmp-acc-vault is a test mirror. Treat it as expendable — but do not delete files in it without asking.
````
