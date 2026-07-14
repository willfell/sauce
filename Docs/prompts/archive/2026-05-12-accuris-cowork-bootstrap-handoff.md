---
date: 2026-05-12
purpose: Drive the v0.31.0 cowork engagement-aware bootstrap against the accuris-sauce vault on this machine. Designed for a FRESH Claude Code session invoked from inside the accuris vault. Self-contained — no assumed context from prior sessions.
canonical: yes
machine: macOS, will@/Users/willfell
vault: /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
engagement: id=`accuris`, type=`w2-fte`
related:
  - Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md
  - Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-plan.md
  - Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md
  - Docs/prompts/2026-05-12-post-v0.31.0-S3-handoff.md (immediate predecessor)
  - Docs/prompts/2026-05-12-headspace-cowork-bootstrap-handoff.md (sibling, other machine)
---

# v0.31.0 S7 D.4 — accuris-sauce cowork bootstrap (this machine)

> [!abstract] What this session does
> Bootstraps the cowork@0.2.0 engagement-aware schema against the **accuris-sauce** Obsidian vault. Engagement = `accuris`, type = `w2-fte`. This is the long-awaited goal that motivated the entire v0.31.0 cycle (the A.2 pause from 2026-05-10 happened when the original v0.30.0 schema didn't support w2-fte properly).
>
> Session shape: fresh Claude Code window invoked from inside `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`. Drives `sauce-pin --catalog` + `sauce-refresh` + `cowork:bootstrap-vault` interactively. Pauses for USER APPROVAL gates as noted below.

---

## Step 0 — environment sanity (always run first)

```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce

# Verify shell helpers are loaded
type sauce && type sauce-refresh && type sauce-pin && type sauce-here

# If any of those say "not found": source the helpers
# source ~/.alias-config/sauce.sh

sauce-here                         # show vault + pantry sha + sub pin
```

Expected `sauce-here` output (or close to it):
```
  vault:              /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
  pantry HEAD:        <some sha>
  subscription pins:  workshop_version 0.29.0
```

If `sauce` / `sauce-pin` / `sauce-refresh` / `sauce-here` are missing on this machine, the helpers file is at `~/.alias-config/sauce.sh`. `~/.aliases` should auto-source it on every new shell.

---

## Step 1 — pull latest workshop + bump pins to current catalog

```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
sauce-refresh                      # fetch + reset + npm + install (may report version-pin skips — fine, fixing next)
sauce-pin --diff                   # show pin drift vs catalog
```

Expected drift to see — confirm before bumping:

```
--- mechanisms (pin → catalog) ---
  validator                    0.1.1      → 0.1.2
  nav-buttons                  2.5.3      → 2.6.0
--- blueprints (pin → catalog) ---
  cowork                       0.1.0      → 0.2.0
  (possibly: daily, project — already bumped by you earlier today, may show ==)
```

**USER APPROVAL gate:** before running `sauce-pin --catalog`, surface the diff and confirm. The cowork bump 0.1.0 → 0.2.0 is the critical one — it's a MINOR with the engagement-aware schema refactor.

```bash
sauce-pin --catalog                # bump all drifted pins (mechs + blueprints)
sauce-refresh                      # apply via installer
```

Expect the installer to run clean (`clean run — exit 0`). The cowork@0.2.0 install MATERIALIZES native Claude Code skills under `<vault>/.claude/skills/cowork/` (5 orchestrators + 27 sub-skills) + context-template seed files under `<vault>/spice/cowork/context/engagement-{templates,shared-templates}/`. It does **NOT** auto-run the bootstrap interview.

---

## Step 2 — confirm cowork installed

```bash
find /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/.claude/skills/cowork -name SKILL.md | wc -l
# expect ~32

ls /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/cowork/context/engagement-templates/
# expect: consulting/  personal/  w2-fte/

ls /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/cowork/context/engagement-shared-templates/
# expect: active-threads.md  vault-config.md  weekly-snapshot.md

ls /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/cowork/Cowork.md
# expect: exists
```

If any of the above is missing or empty: STOP. The cowork install didn't take. Investigate before proceeding.

---

## Step 3 — invoke the bootstrap interview

Open a fresh Claude Code window with cwd inside accuris-sauce. Type:

```
/cowork
```

The `/cowork` slash command lives at `<vault>/.claude/commands/cowork.md` (added 2026-05-12 session) and dispatches to the canonical `cowork:bootstrap-vault` skill materialized at `<vault>/.claude/skills/cowork/bootstrap-vault/SKILL.md`. The skill content is what drives the actual interview.

If `/cowork` is missing for some reason (e.g., you re-bootstrapped and the slash command file got wiped), hand-copy it:

```bash
cp pantry/platform/blueprints/cowork/commands/cowork.md .claude/commands/cowork.md
```

The skill is a **25-step engagement-aware interview**. Per `Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md`, it:

1. Pre-flight: check obsidian MCP, vault routing, prior bootstrap state.
2. Detects this is a fresh-bootstrap (no `engagements[]` yet in `vault-config.md`).
3. Interviews you ONE QUESTION AT A TIME:
   - **Engagement basics:** id = `accuris`, type = `w2-fte`, label = `Accuris` (or your preferred display name).
   - **Required w2-fte fields** (per `platform/blueprints/cowork/engagement-types/w2-fte.json`): role, employer, stakeholders[].
   - **Optional w2-fte fields:** manager, gmail_label, calendar_id.
   - **Cadences to enable:** morning, midday, eod, weekly, monthly. w2-fte defaults: morning ✓ / midday ✗ / eod ✓ / weekly ✓ / monthly ✗.
   - **Cron drop mode:** (a) just emit blocks for me to paste / (b) write to vault/.scratch/ / (c) skip.
4. Probes MCP backends (obsidian, gmail, gcal, brex, imessage, whatsapp — w2-fte typically uses obsidian + gmail + gcal).
5. Writes `<vault>/spice/cowork/context/vault-config.md` with the captured engagement[]+ MCP map.
6. For each engagement (just `accuris` here), materializes per-engagement context files under `<vault>/spice/cowork/context/accuris/` from `engagement-templates/w2-fte/*.md`.
7. Renders the nav-button table on `<vault>/spice/cowork/Cowork.md` (engagement × cadence grid).
8. Emits a 7-section bootstrap report with an inline audit-receipt (via the new `cowork:run-audit-receipt` sub-skill from v0.31.0 S2).

**USER APPROVAL gates DURING the interview:**
- The bootstrap-vault SKILL.md v2 surfaces an "approve to proceed" Notice before writing vault-config.md.
- It also surfaces before writing the nav-button table on `Cowork.md` (which mutates a hub note).

---

## Step 4 — verify the bootstrap completed cleanly

```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce

# vault-config.md should now have engagements[] frontmatter
node -e "
  const fs = require('fs');
  const fm = fs.readFileSync('spice/cowork/context/vault-config.md', 'utf8').split('---')[1];
  const engagements = fm.match(/engagements:[\s\S]+?(?=^\w|\$)/m);
  console.log(engagements ? 'engagements[] present ✓' : 'NO engagements[] — bootstrap may have failed');
"

# audit should pass clean with the new cowork rule_fragments
sauce audit --blueprint cowork
```

Expected audit output: `# Audit Results — clean. 0 violations.` (or close to it). If the cowork rule_fragment fires a violation (engagement structure, vault-config.md fields), surface to user.

---

## Step 5 — paste cron blocks (optional)

If you picked cron drop mode (a) at step 3, the bootstrap-report emits paste-ready cron block markdown for each `(engagement, cadence)` pair you enabled. Paste those into whatever cron infrastructure you use (launchd / supercronic / a hosted scheduler). Example block for `(accuris, morning)`:

```
# accuris morning briefing — Mon-Fri 06:30 local
30 6 * * 1-5 cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce && /path/to/your-claude-cli-or-tool invoke cowork:morning-briefing --engagement_id accuris
```

Adapt the invocation to your actual Claude trigger infrastructure.

---

## Step 6 — close + commit handoff status

After bootstrap completes successfully:

```bash
# Capture what shipped per the bootstrap report — save a copy outside the vault
# for the next session's pickup
cp /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/spice/cowork/bootstrap-report.md \
   /Users/willfell/Documents/obsidian/sync/workshop/sauce/Docs/plans/2026-05-12-accuris-bootstrap-report-snapshot.md

cd /Users/willfell/Documents/obsidian/sync/workshop/sauce
git add Docs/plans/2026-05-12-accuris-bootstrap-report-snapshot.md
git commit -m "docs(plans): v0.31.0 S7 D.4 — accuris cowork bootstrap report snapshot"
git push origin main
```

---

## Notes the next session should be aware of

- **Workshop_version is still `0.29.0`.** S8 close (bump to `0.31.0` + annotated tag) is the final stage, pending verification across all 4 vaults. After accuris bootstraps, the other-machine session bootstraps headspace; once both report clean, S8 can run.
- **Ero-sauce is deferred.** Per user direction 2026-05-12, ero-sauce + headspace-sauce both ship from the other machine. This session ONLY does accuris.
- **Legacy `Cowork/` directory in accuris** (if present pre-bootstrap): bootstrap-vault SKILL.md step 4 detects pre-v0.30.0 `vault_scope` legacy frontmatter and aborts with a fresh-interview Notice if found. If accuris had any `vault_scope: life|ero` frontmatter from prior experimentation, remove it manually before invoking bootstrap-vault.
- **Catalog/sub-manifest skew was repaired in commit `e6900d6`** (validator + nav-buttons + cowork catalog entries aligned with sub-manifests). The pin diff for those mechanisms is now visible to `sauce-pin --diff`.

---

## Open questions to surface if encountered

- **Engagement label preference.** The user's accuris engagement label could be `Accuris`, `Accuris Tech`, or any display string. Confirm at interview step.
- **Gmail label for accuris.** If you scope work email under a `Work` label or similar in Gmail, surface this at the optional-fields step. Otherwise leave blank and gather-gmail won't apply a label filter.
- **Calendar id for accuris.** Default is `primary`. If the user has a dedicated work calendar id (their `@accuristech.com` calendar?), capture it.
- **Stakeholders[].** w2-fte requires at least one stakeholder name (manager + any cross-functional partners). Confirm at interview step.

---

## Cycle metadata

- v0.31.0 S0–S6.7 closed (all v0.31.0 platform refactor + shell helpers + S6.5 project filename-as-name + S6.6 daily dashboard polish + S6.7 catalog skew repair shipped to origin/main).
- S7 D.1 barebones validation: PASSED 2026-05-12 (mechanisms + non-cowork blueprints install clean against the new catalog).
- S7 D.4 (this handoff): PENDING — interactive cowork bootstrap on accuris.
- S7 D.2 (ero-sauce) + S7 D.3 (headspace-sauce): PENDING — other machine.
- S8 close: PENDING — workshop_version 0.29.0 → 0.31.0 + tag, after all 4 vaults bootstrap clean.
