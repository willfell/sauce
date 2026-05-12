# accuris-sauce install drift recovery — Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Restore the working New-Task flow in the `accuris-sauce` consumer vault by re-running the sauce installer (refreshes stale platform-managed templates) and migrating two flat test-task files into the canonical folder shape.

**Architecture:** This is an **operational remediation** plan, not a code change. We invoke `sauce update`, which (a) git-resets the in-vault workshop clone (`pantry/`) to `origin/main`, then (b) re-runs the installer. The installer's Option-B content-overwrite mechanic (see `platform/install.js:521-612`) diffs each platform-managed file, writes the prior contents to `<dest>.bak`, and writes the workshop source. Then we filesystem-`mv` two pre-existing flat task files into folder shape so they match the path glob the project nav-buttons key on.

**Tech Stack:** `bash`, `git`, `node` (sauce CLI), `md5`, `diff`. No code is written.

**Source design:** `Docs/plans/2026-05-12-accuris-sauce-install-drift-recovery-design.md`.

**Pinned vault path:** `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`
**Pinned workshop repo:** `/Users/willfell/Documents/obsidian/sync/workshop/sauce`
**Vault-internal workshop clone:** `<vault>/pantry`

---

## Out of scope (deferred)

- Bug #1 (project file naming) — by-design expectation gap.
- Bug #2 (workstream prompt during project creation) — by-design.
- Bug #3 (workstream buttons render twice on first load) — separate platform triage.
- Bug #6 (cannot create notes within project) — separate triage; verify whether this is a missing nav-button action.
- Root-cause investigation of WHY templates drifted to rendered output (Templater config? sync conflict? something else). Flagged for follow-up if drift recurs.

---

## Pre-flight assumption checks (do this once before Task 1)

Confirm all four are true. If any fails, STOP and escalate.

1. The vault backup the user mentioned exists somewhere outside the working vault path. (User confirmed verbally; trust + proceed.)
2. `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/` exists (vault identity).
3. `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/pantry/` exists (workshop clone present).
4. `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/platform-config.json` exists.

Quick verification command:
```bash
ls -d /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/{spice,pantry,ranch} \
  && cat /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/platform-config.json | head -5
```
Expected: three directories listed, JSON dumps cleanly.

---

## Task 1: Snapshot evidence + preserve existing .bak files

**Why:** The installer's `.bak` mechanic is "one-deep, no rotation" (`install.js:526-527`). If we run the installer and a template already has a `.bak`, the prior `.bak` gets clobbered. We want to preserve the historical stale-render evidence for the post-mortem.

**Files (read/write inside accuris-sauce):**
- Read: `ranch/templates/Template, Kanban Card.md`
- Read: `ranch/templates/Template, Task Board Card.md`
- Read: all `ranch/templates/*.bak` and `ranch/scripts/project/*.bak`
- Write: `<vault>/_drift-evidence-2026-05-12/` (new sibling directory holding copies)

**Step 1: Capture md5 of the known-stale templates and confirm they match the rendered-shape signature**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
md5 "ranch/templates/Template, Kanban Card.md" "ranch/templates/Template, Task Board Card.md"
head -3 "ranch/templates/Template, Kanban Card.md"
```
Expected: the first three lines of `Kanban Card.md` start with `---` / `created: 2026-05-10 20:45` / `source_board: spice/daily/2026/05-May/Sunday-2026-05-10.md` (the stale-rendered signature). Record both md5 hashes in your scratchpad — they'll be compared to the post-install state in Task 3.

**Step 2: Create the evidence-preserve directory**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
mkdir -p _drift-evidence-2026-05-12
```
Expected: directory created. (Note: this lives OUTSIDE the platform-managed namespaces `pantry/`, `spice/`, `ranch/` — placed at vault root only for the duration of this remediation, will be removed in the final cleanup task.)

**Step 3: Copy all existing `.bak` files into the evidence directory, preserving relative paths**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
find ranch/templates ranch/scripts -name '*.bak' -print0 \
  | while IFS= read -r -d '' f; do
      dest="_drift-evidence-2026-05-12/$f"
      mkdir -p "$(dirname "$dest")"
      cp -p "$f" "$dest"
    done
ls -R _drift-evidence-2026-05-12 | head -20
```
Expected: `_drift-evidence-2026-05-12/ranch/templates/` and `_drift-evidence-2026-05-12/ranch/scripts/project/` contain `.bak` copies. Confirm at least 10 files are present (based on the design's pre-survey).

**Step 4: Copy the two STALE template files (the live, broken ones) into evidence too — separate filename**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
cp -p "ranch/templates/Template, Kanban Card.md" "_drift-evidence-2026-05-12/Template, Kanban Card.md.STALE-LIVE"
cp -p "ranch/templates/Template, Task Board Card.md" "_drift-evidence-2026-05-12/Template, Task Board Card.md.STALE-LIVE"
ls _drift-evidence-2026-05-12/*.STALE-LIVE
```
Expected: two files listed.

**Step 5: No commit.** The vault is not a git repo we're managing here; the workshop repo doesn't track the consumer vault. Just note that evidence is captured.

---

## Task 2: Run the sauce installer in update mode

**Why:** `sauce update` does git-fetch + reset --hard on `pantry/` and re-runs the installer. The installer's content-overwrite mechanic refreshes stale templates with workshop source, writing prior contents to `<dest>.bak`.

**Files:**
- Modifies: many files under `<vault>/ranch/` (templates, scripts, views). Specifically: stale templates get refreshed.
- Modifies: `<vault>/pantry/*` — hard-reset to `origin/main`.
- Writes: `<vault>/ranch/bootstrap-last-install.log` (history log).

**Step 1: Check `pantry/` working tree state before update**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/pantry
git status --short
```
Expected: empty output (clean) — `pantry/` should be a pristine clone of `origin/main` (no local edits ever; landmine #18). If anything shows up, we'll need `--force` in Step 3. Record the exit.

**Step 2: Fetch latest origin/main and check for incoming changes (informational)**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/pantry
git fetch origin main
git log --oneline HEAD..origin/main | head -10
```
Expected: list of commits to be pulled in (or empty if pantry is already up-to-date). Either way we proceed — the installer re-runs regardless.

**Step 3: Run `sauce update`**

Run (use `--force` only if Step 1 showed dirty):
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
node pantry/platform/cli/sauce-cli.js update
```
(If Step 1 was dirty, append `--force`.)

Expected output (4 steps):
```
[1/4] Fetching origin/main...                  OK
[2/4] Checking working tree...                 OK (clean | dirty (override via --force))
[3/4] Resetting pantry/ to origin/main...      OK
[4/4] Re-running installer...                  OK
Tip: Cmd+R Obsidian to pick up changes.
```
If any step fails: STOP, capture the stderr, escalate.

**Step 4: Inspect `bootstrap-last-install.log` for the file_overwrite events on the templates we care about**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
grep -E "Template, Kanban Card|Template, Task Board Card" ranch/bootstrap-last-install.log | head -10
```
Expected: at least one `event: "replace"` / `step: "file_overwrite"` entry for each of the two stale templates, with `bak_path` pointing to `<dest>.bak`.

**Step 5: No commit.** Nothing to commit — workshop repo isn't tracking the consumer vault.

---

## Task 3: Validate post-install state (zero-diff)

**Why:** Prove the stale templates were refreshed to match workshop source. If diff is non-zero, the install didn't fully take and we stop before migrating data.

**Files:** Read-only diff comparison between vault `ranch/` and workshop `platform/blueprints/project/`.

**Step 1: Zero-diff the canonical project templates**

Run:
```bash
WSP=/Users/willfell/Documents/obsidian/sync/workshop/sauce/platform/blueprints/project
VAULT=/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
for pair in \
  "templates/Kanban Card.md:Template, Kanban Card.md" \
  "templates/Task Board Card.md:Template, Task Board Card.md" \
  "templates/Project.md:Template, Project.md" \
  "templates/Project Map.md:Template, Project Map.md" \
  "templates/Project Board.md:Template, Project Board.md" \
  "templates/Task Note.md:Template, Task Note.md" \
  "templates/Task Board.md:Template, Task Board.md"; do
    src="${pair%%:*}"
    dst="${pair##*:}"
    echo "=== $dst ==="
    diff "$WSP/$src" "$VAULT/ranch/templates/$dst" && echo "  IDENTICAL"
done
```
Expected: every pair prints `=== <dst> ===` followed by `  IDENTICAL` (no diff hunks). If ANY pair shows a diff, STOP and investigate before proceeding.

**Step 2: Zero-diff the project helpers**

Run:
```bash
WSP=/Users/willfell/Documents/obsidian/sync/workshop/sauce/platform/blueprints/project/helpers
VAULT=/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/scripts/project
for f in project-nav-buttons.js project-workstream-manager.js project-workstreams.js \
         projects-hub-cards.js project-notes-cards.js project-referenced-by-cards.js; do
    echo "=== $f ==="
    diff "$WSP/$f" "$VAULT/$f" && echo "  IDENTICAL"
done
```
Expected: all six print `  IDENTICAL`. Any diff = STOP.

**Step 3: Confirm the Templater header is now present in Kanban Card**

Run:
```bash
head -3 "/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/templates/Template, Kanban Card.md"
```
Expected: line 1 is `<%*`, line 2 starts with `// Use target_file` or similar Templater-script content. Confirms the workstream picker + folder auto-promote logic is back.

---

## Task 4: Migrate the two flat test tasks into folder shape

**Why:** The previously created tasks landed as flat files (`tasks/<x>.md`) because the auto-promote `tp.file.move` was missing from the broken Kanban Card template. The project nav-buttons key on the `tasks/<x>/<x>.md` folder shape. We move the existing files manually so they pick up the right rendering on next reload.

**Files:**
- Move: `spice/projects/test-project/tasks/test-task.md` → `spice/projects/test-project/tasks/test-task/test-task.md`
- Move: `spice/projects/test-project/tasks/another-task-post-stream.md` → `spice/projects/test-project/tasks/another-task-post-stream/another-task-post-stream.md`

**Step 1: Verify the two files exist in their current flat shape**

Run:
```bash
ls -la /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/projects/test-project/tasks/
```
Expected: `test-task.md` and `another-task-post-stream.md` listed as plain files (not directories).

**Step 2: Migrate `test-task.md`**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/projects/test-project/tasks
mkdir -p test-task
mv test-task.md test-task/test-task.md
ls -la test-task/
```
Expected: `test-task/test-task.md` exists, original flat file gone.

**Step 3: Migrate `another-task-post-stream.md`**

Run:
```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/projects/test-project/tasks
mkdir -p another-task-post-stream
mv another-task-post-stream.md another-task-post-stream/another-task-post-stream.md
ls -la another-task-post-stream/
```
Expected: `another-task-post-stream/another-task-post-stream.md` exists, original flat file gone.

**Step 4: Confirm file contents are intact (no accidental edit)**

Run:
```bash
head -10 /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/projects/test-project/tasks/test-task/test-task.md
head -10 /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/projects/test-project/tasks/another-task-post-stream/another-task-post-stream.md
```
Expected: both files show their original frontmatter (`created: 2026-05-10 20:45`, `source_board: ...`, `tags:` block). No content changes.

**Step 5: No commit.** Vault is not git-tracked from this workshop session.

---

## Task 5: Cleanup + hand off to user for in-Obsidian validation

**Files:**
- Read: `_drift-evidence-2026-05-12/` (no changes — preserved evidence stays)
- Output: a hand-off note in chat for the user

**Step 1: Verify the evidence directory still has all preserved files**

Run:
```bash
ls /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/_drift-evidence-2026-05-12/
ls /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/_drift-evidence-2026-05-12/ranch/templates/ 2>/dev/null | head -10
```
Expected: directory present with the two `.STALE-LIVE` files at top + the captured `.bak` copies inside `ranch/templates/` and `ranch/scripts/project/`.

**Step 2: Decide on evidence directory fate**

Two options — both reasonable, ask the user which they prefer (default = leave in place):
- (a) Leave `_drift-evidence-2026-05-12/` in vault root. Obsidian will see it as a folder; harmless but visible.
- (b) Move it outside the vault (e.g., to `~/Desktop/accuris-sauce-drift-evidence-2026-05-12/`). Cleaner vault, evidence preserved.

If (b): `mv /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/_drift-evidence-2026-05-12 ~/Desktop/accuris-sauce-drift-evidence-2026-05-12`

**Step 3: Hand off to user**

Report the following to the user, verbatim:

> Install drift fixed in `accuris-sauce`. Evidence preserved at `_drift-evidence-2026-05-12/` (or wherever you chose).
>
> Please validate in Obsidian:
> 1. Open the accuris-sauce vault.
> 2. Cmd+R (full reload) to refresh CustomJS classes.
> 3. Open `spice/projects/test-project/Project.md`. Confirm Project Map / Project Board nav-buttons render.
> 4. Open the two migrated tasks (`tasks/test-task/test-task.md` and `tasks/another-task-post-stream/another-task-post-stream.md`). Confirm the task-board / board-task nav-buttons now render at the top of each.
> 5. Click **New Task** on `Project.md`. Verify the workstream picker fires (the project has one workstream: `test-stream`). Pick it.
> 6. After creation, confirm the new card lives at `tasks/<task-name>/<task-name>.md` (folder shape, not flat). Confirm task-board buttons render on it.
>
> If any of those fail, capture screenshots + the relevant frontmatter and ping back — we'll need a deeper investigation than a re-install can fix.
>
> Heads-up: the root cause of the original drift (why templates lost their Templater headers) is NOT yet identified. If templates go stale again within a day or two, escalate to a real investigation.

---

## Risks (carried over from design)

1. **Drift recurs.** If the templates re-corrupt to rendered output after this fix, we have a live bug source we haven't found. Possible suspects: Templater "Trigger on new file" config pointing at a template path; Obsidian Sync / iCloud conflict; some other tool writing into `ranch/templates/`. Investigation candidate for a fresh session if it happens.

2. **`.bak` clobber.** Already mitigated by Task 1's evidence-copy step.

3. **`pantry/` dirty.** Mitigated by Task 2 Step 1 check + optional `--force`.

4. **User changed test-project state between brainstorm + execution.** Mitigated by Task 4 Step 1 existence check.
