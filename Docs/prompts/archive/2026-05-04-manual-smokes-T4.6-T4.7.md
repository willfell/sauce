---
date: 2026-05-04
purpose: Manual smokes for v0.1.1 S4 close — Obsidian-driven tests against barebones
predecessor: 2026-05-03-registry-driven-nav-buttons-plan.md (S4 T4.6 + T4.7)
related:
  - 2026-05-03-v0.1.1-S3-close-and-S4-handoff.md
  - execution-logs/2026-05-03-registry-driven-nav-buttons/T4.0-T4.9-S4-harness-and-barebones-regression.md
---

# Morning smokes — T4.6 + T4.7 (manual, in Obsidian on barebones)

> [!abstract] Goal
> Run the two Obsidian-in-the-loop smokes that the headless harnesses can't cover. After both pass, paste the captured output into chat and the assistant will fold the evidence into `Docs/plans/2026-05-03-registry-driven-nav-buttons-result.md` (T4.10), which closes v0.1.1.

---

## Pre-flight

> [!info] State at start
> - Workshop is at `workshop_version: 0.4.0`; nav-buttons@2.0.0; project@0.2.0.
> - Barebones (`tmp-test-barebones-vault`) was installed via headless harness yesterday — has nav-buttons@2.0.0 + project@0.2.0 materialized.
> - Registry has one Board entry (verified by T4.4 harness smoke).
> - Lazy scaffold dispatch shape verified by T4.5 harness smoke (createFolder + create + openLinkText all captured).

> [!todo] Setup
> 1. Open the barebones vault in Obsidian (macOS desktop).
>    - Path: `/Users/willfell/Documents/obsidian/sync/workshop/tmp-test-barebones-vault` (or wherever it lives on your machine).
> 2. Reload Templater user scripts: Settings → Templater → User Script Functions → **Reload**.
> 3. Reload CustomJS: Command Palette → "CustomJS: Reload" (or toggle the plugin off/on).

---

## T4.6 — `/new-project` + board update

> [!todo] Steps
> 1. Open or create any markdown note in barebones (a scratch one is fine).
> 2. Add this dataviewjs block to the note:
>
>    ````markdown
>    ```dataviewjs
>    await dv.view("Docs/Meta/Views/customjs-guard", { class: "SpaceNavButtons" });
>    ```
>    ````
>
>    **Expected:** exactly **one** button rendered, labeled "Board", with the board icon. No prev/next arrows, no other buttons.
>
> 3. **Click the Board button.**
>
>    **Expected:**
>    - `boards/` folder created
>    - `boards/To-Do-Board.md` materialized; body byte-matches `Docs/Meta/Content/project/kanban-board.md`
>    - The note opens in the active pane
>    - Dataview block renders with empty-state: `_No projects yet. Run /new-project to create one._`
>
> 4. Run `/new-project` (slash command). When prompted, name it `test-project-alpha`.
>
>    **Expected:**
>    - New note at `boards/planning/test-project-alpha/test-project-alpha.md`
>    - Frontmatter has `type: project`, `tags: [project, barebones]`, `status: active`
>
> 5. Re-open `boards/To-Do-Board.md`.
>
>    **Expected:**
>    - Dataview block now shows `## active` header
>    - Listed under it: `- [[boards/planning/test-project-alpha/test-project-alpha|test-project-alpha]]`

> [!success] Capture for the result writeup
> - Screenshot the rendered nav (one button)
> - Screenshot or copy frontmatter of the new project note
> - Screenshot the updated board with the project listed
> - Note any anomalies (Notice popups, errors, render delays)

---

## T4.7 — Validator + audit walker

> [!todo] Steps
> 1. With the new project note (`test-project-alpha`) open, run `tp.user.validate(tp)` (Templater user script — invoke via Command Palette → "Templater: Insert Template" → pick the validate runner, OR use a one-shot Templater snippet).
>
>    **Expected:** Notice "PASS" or equivalent (rule.json compliance).
>
> 2. Edit the project note's frontmatter — **temporarily** remove the `barebones` tag from `tags`. Save.
>
> 3. Re-run `tp.user.validate(tp)`.
>
>    **Expected:** Notice FAIL surfacing the missing tag (e.g., "tags must include barebones").
>
> 4. **Restore** the `barebones` tag. Save.
>
> 5. Run `tp.user.audit(tp)`.
>
>    **Expected:** an audit report file written under the audit-walker's configured destination (per the audit mechanism's manifest). Open it and verify it lists at least the new project note.

> [!success] Capture for the result writeup
> - Verbatim Notice text from each validate run (PASS, FAIL, restored PASS)
> - Path of the audit report file + a brief excerpt of its content

---

## What to send back

Paste into chat:
- T4.6 outcomes (with screenshots / DOM excerpts inline)
- T4.7 outcomes (with Notice text + audit report path)
- Any unexpected behavior (Notice popups not in the expected set, console errors, render flickers, etc.)

> [!info] After both pass
> The assistant will write `Docs/plans/2026-05-03-registry-driven-nav-buttons-result.md` (T4.10) using the evidence above + harness outputs from the T4.0-T4.9 log, then v0.1.1 closes.
>
> If anything fails, STOP and paste the failure mode immediately — do not attempt other tests until that's diagnosed.

---

## If barebones state needs reset

If you suspect barebones drifted overnight or want a clean slate, run from the workshop:
```bash
cd /Users/willfell/Documents/obsidian/sync/workshop/poc-vault
node platform/test/run-install.js ../tmp-test-barebones-vault
```
That re-applies everything idempotently. Should report "New history entries this run (0)" if nothing changed.

---

## Reference

- v0.1.1 plan (Stage 4): `Docs/plans/2026-05-03-registry-driven-nav-buttons-plan.md`
- S3-close handoff: `Docs/plans/2026-05-03-v0.1.1-S3-close-and-S4-handoff.md`
- S4 consolidated execution log: `Docs/plans/execution-logs/2026-05-03-registry-driven-nav-buttons/T4.0-T4.9-S4-harness-and-barebones-regression.md`
