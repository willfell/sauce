---
date: 2026-05-12
purpose: Drive the v0.31.0 cowork engagement-aware bootstrap against the headspace-sauce vault on the OTHER machine. Designed for a FRESH Claude Code session invoked from inside the headspace vault. Self-contained — no assumed context from prior sessions.
canonical: yes
machine: the OTHER machine (not the one used 2026-05-12 for accuris). User has not specified which machine this is; assume a clean macOS setup with node + git installed.
vault: /Users/<user>/Documents/obsidian/sync/sauce/headspace-sauce  (likely path; verify with `ls`)
engagement: id=`headspace`, type=`personal`
related:
  - Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-design.md
  - Docs/plans/2026-05-11-v0.31.0-cowork-engagement-model-plan.md
  - Docs/plans/2026-05-11-v0.31.0-bootstrap-vault-skill-spec.md
  - Docs/prompts/2026-05-12-accuris-cowork-bootstrap-handoff.md (sibling, primary machine)
---

# v0.31.0 S7 D.3 — headspace-sauce cowork bootstrap (OTHER machine)

> [!abstract] What this session does
> Bootstraps the cowork@0.2.0 engagement-aware schema against the **headspace-sauce** Obsidian vault on the OTHER machine. Engagement = `headspace`, type = `personal`. The accuris-sauce vault has already been bootstrapped on the primary machine (2026-05-12 session); this one is independent.
>
> Session shape: fresh Claude Code window invoked from inside the headspace vault. Drives shell-helper install (if not present on this machine) + `sauce-refresh` + `sauce-pin --catalog` + `cowork:bootstrap-vault` interactively. Pauses for USER APPROVAL gates as noted below.

---

## Step 0 — fresh machine setup

The canonical fresh-machine setup is documented at:
**`pantry/Docs/prompts/2026-05-12-fresh-machine-setup.md`**

Run that doc's Path A or Path B end-to-end on the other machine. After step 6 of that doc, you have `sauce`, `sauce-refresh`, `sauce-pin`, `sauce-here`, `sauce-bootstrap` shell helpers + a bootstrapped headspace vault. Return here for Steps 1+ (which are mostly verification — the heavy lifting is in the fresh-machine doc).

Short version (Path A from the fresh-machine doc, paraphrased):

```bash
# Install helpers globally
mkdir -p ~/.alias-config && \
  curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/platform/cli/shell-helpers/sauce.sh \
    -o ~/.alias-config/sauce.sh

# Auto-source loop in ~/.aliases if missing (see fresh-machine doc)
# Reload shell, verify type sauce

# Bootstrap the vault
cd /path/to/headspace-sauce
sauce-bootstrap        # if pantry/ missing
sauce-refresh          # pull + auto-bump pins + install
```

---

## Step 1 — does headspace have `pantry/` already?

```bash
ls pantry/platform/cli/sauce-cli.js 2>&1
```

**If present:** skip to Step 2.

**If absent:** bootstrap pantry:

```bash
sauce-bootstrap                    # wraps the curl install.sh one-liner
# OR manually:
# curl -fsSL https://raw.githubusercontent.com/willfell/sauce/main/install.sh | bash -s -- --vault . --overwrite
```

The bootstrap clones the sauce repo into `pantry/` + runs `npm install` + runs the first-run wizard. Pick your subscription preferences in the wizard; for headspace at minimum include `cowork`. (If wizard skip → manually edit `ranch/platform-subscription.json` to include `{ "name": "cowork", "version": "0.2.0" }` in `blueprints[]`.)

---

## Step 2 — refresh + pin to catalog

```bash
sauce-here                         # vault + pantry sha + sub pin
sauce-refresh                      # fetch + reset + npm install + sauce update --force
sauce-pin --diff                   # show pin drift
```

Expected pin drift (depends on what headspace pinned previously):

```
--- mechanisms (pin → catalog) ---
  validator                    0.1.1      → 0.1.2
  nav-buttons                  2.5.3      → 2.6.0
--- blueprints (pin → catalog) ---
  cowork                       (unpinned) → 0.2.0   (or 0.1.0 → 0.2.0 if already pinned)
  daily                        ?          → 0.2.6
  project                      ?          → 1.4.1
```

**USER APPROVAL gate:** surface the diff. The cowork bump 0.1.0 → 0.2.0 is the critical one (engagement-aware schema refactor).

```bash
sauce-pin --catalog                # bump all drifted pins
sauce-refresh                      # apply
```

Expect `clean run — exit 0`. If any version skip happens, investigate the specific blueprint — likely it's a sub-blueprint dep mismatch.

---

## Step 3 — confirm cowork installed

```bash
find .claude/skills/cowork -name SKILL.md | wc -l
# expect ~32

ls spice/cowork/context/engagement-templates/
# expect: consulting/  personal/  w2-fte/

ls spice/cowork/context/engagement-shared-templates/
# expect: active-threads.md  vault-config.md  weekly-snapshot.md

ls spice/cowork/Cowork.md
# expect: exists
```

If any of the above is missing/empty: STOP. Investigate.

---

## Step 4 — invoke cowork bootstrap (interactive)

Open a fresh Claude Code window pointing at the headspace-sauce vault. Type:

```
/cowork
```

The `/cowork` slash command (shipped at `<vault>/.claude/commands/cowork.md` by cowork@0.2.0+ install) dispatches to the `cowork:bootstrap-vault` skill. If `/cowork` is missing from your vault's `.claude/commands/`, hand-copy it from the workshop tree first:

```bash
mkdir -p .claude/commands
cp pantry/platform/blueprints/cowork/commands/cowork.md .claude/commands/cowork.md
```

The skill is the same 25-step engagement-aware interview as accuris's session. For headspace, the engagement type is `personal`, not `w2-fte`. Per `platform/blueprints/cowork/engagement-types/personal.json`:

**Required personal fields:** `owner_name`, `home_city`.

**Optional personal fields:** `cc_active_cards`, `cc_locked_cards`, `cc_ignored_cards`, `cc_focus_card`, `debt_weekly_target_usd`, `debt_monthly_target_usd`, `inner_circle_people`, `includes_wellness_prompts` (default true), `discretionary_categories`.

**Default cadences (personal):** morning ✓ / midday ✓ / eod ✓ / weekly ✓ / monthly ✓. All five enabled — personal engagements use the full cadence set.

**Render aspects (personal):** finance_block: include, invoice_prep: skip, ai_committee: skip, kanban_projects: include, inner_circle_imessage: include.

**Engagement basics for headspace:**
- id: `headspace`
- type: `personal`
- label: `Headspace` (or your preferred display name)

**USER APPROVAL gates DURING the interview:**
- Before writing vault-config.md (Notice prompt).
- Before mutating Cowork.md hub (nav-button table render).

---

## Step 5 — verify bootstrap completed

```bash
# vault-config.md should now have engagements[] frontmatter
node -e "
  const fs = require('fs');
  const fm = fs.readFileSync('spice/cowork/context/vault-config.md', 'utf8').split('---')[1];
  console.log(fm.includes('engagements:') ? 'engagements[] present ✓' : 'NO engagements[] — bootstrap may have failed');
"

sauce audit --blueprint cowork
```

Expected: `0 violations` (or only warnings, no errors).

---

## Step 6 — paste cron blocks (optional)

Same as accuris session — bootstrap-report emits paste-ready cron block markdown for each `(engagement, cadence)` pair enabled. Five cadences enabled by default for personal → five cron blocks. Paste them into your cron infrastructure.

---

## Step 7 — close + sync state back to workshop git

```bash
# After bootstrap completes, save a snapshot of the report into the workshop
# repo so the next session can see what shipped (workshop is the source of truth)
cp spice/cowork/bootstrap-report.md \
   <path-to-workshop-on-this-machine>/Docs/plans/2026-05-12-headspace-bootstrap-report-snapshot.md

cd <path-to-workshop-on-this-machine>
git pull origin main             # important: pull the primary-machine accuris changes first
git add Docs/plans/2026-05-12-headspace-bootstrap-report-snapshot.md
git commit -m "docs(plans): v0.31.0 S7 D.3 — headspace cowork bootstrap report snapshot"
git push origin main
```

---

## Notes the next session should be aware of

- **Ero-sauce is also pending on this machine** (per user direction 2026-05-12). After headspace is bootstrapped clean, optionally drive ero-sauce next using the same flow — engagement = `ero`, type = `consulting`. Required consulting fields differ (role, primary_client, hourly_rate_usd, ap_email, invoice_cadence) per `engagement-types/consulting.json`. Default cadences: morning ✓ / midday ✗ / eod ✓ / weekly ✓ / monthly ✓.
- **Workshop_version is still `0.29.0`** pre-S8. After headspace (and optionally ero) bootstraps clean, the primary machine runs S8 close — workshop_version bump 0.29.0 → 0.31.0 + annotated git tag `v0.31.0`. **Don't bump workshop_version from this machine** — that's a single-source-of-truth decision the primary machine owns.
- **Legacy `Cowork/` directory in headspace** (if present pre-bootstrap): bootstrap-vault step 4 detects pre-v0.30.0 `vault_scope` legacy frontmatter and aborts with a fresh-interview Notice. Remove any legacy `vault_scope: life|ero` frontmatter manually before invoking bootstrap-vault if it errors out.

---

## Common pitfalls

1. **Shell helpers missing.** Symptom: `sauce-here: command not found`. Fix: install ~/.alias-config/sauce.sh on this machine (Step 0).
2. **Pin mismatch errors during sauce-refresh.** Symptom: `[Notice] platformInstall: skipping <blueprint>`. Fix: `sauce-pin --catalog && sauce-refresh`.
3. **Cowork not subscribed.** Symptom: no .claude/skills/cowork/ after install. Fix: `sauce wizard` → Edit subscription → toggle `cowork` ON → confirm. Then sauce-refresh.
4. **Workshop catalog skew (pre-2026-05-12).** Symptom: `sauce-pin --diff` shows `cowork: 0.1.0 == 0.1.0` even though you'd expect 0.2.0. Fix: confirm pantry HEAD is at or beyond commit `e6900d6` (catalog skew repair). If older, `sauce-refresh` once to pull.

---

## Cycle metadata

- v0.31.0 S0–S6.7 closed.
- S7 D.1 barebones validation: PASSED 2026-05-12 (primary machine).
- S7 D.4 accuris-sauce: PENDING — primary machine session.
- S7 D.3 headspace-sauce (this handoff): PENDING — other machine session.
- S7 D.2 ero-sauce: PENDING — other machine session (after headspace).
- S8 close: PENDING — primary machine, after all 4 vaults clean.
