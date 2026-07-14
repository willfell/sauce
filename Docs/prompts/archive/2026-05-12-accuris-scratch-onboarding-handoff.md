---
title: Onboard accuris-sauce to scratch@0.1.0 — fully automated handoff
date: 2026-05-12
status: ready-to-execute
prerequisites:
  - Workshop tag v0.37.0 pushed to willfell/sauce (DONE)
  - Tap PR willfell/homebrew-sauce#2 MERGED (manual click — required before this prompt fires)
  - `brew upgrade sauce` run on the machine where accuris-sauce lives
predecessors:
  - Docs/plans/2026-05-12-v0.37.0-scratch-blueprint-plan.md (cycle plan)
  - Docs/cycle-history.md § v0.37.0 (close summary)
---

# Onboard accuris-sauce to scratch@0.1.0 — fully-automated handoff

> [!abstract] Goal
> Add the `scratch@0.1.0` blueprint to the accuris-sauce vault. Fully automated — no Obsidian UI clicks, no Templater runs, no manual file edits required by the human. The agent edits the subscription file + runs `sauce reinstall --vault $(pwd)` + verifies `/audit` is clean. Total elapsed time: ~30 seconds of agent work after the brew upgrade lands.

---

## Pre-requisites (DONE before this handoff fires)

> [!info] Confirm before starting the prompt
> 1. **Workshop tag `v0.37.0` is on `origin/main` of `willfell/sauce`** — verify: `git -C /Users/willfell/Documents/obsidian/sync/workshop/sauce tag --list | grep v0.37.0` should print `v0.37.0`.
> 2. **Tap PR willfell/homebrew-sauce#2 is MERGED** — verify: `gh api repos/willfell/homebrew-sauce/contents/Formula/sauce.rb --jq '.content' | base64 -d | grep 'url '` should show `v0.37.0`, not `v0.36.1`.
> 3. **`brew upgrade sauce` has been run on this machine** — verify: `sauce doctor 2>&1 | head` should report platform version 0.37.0 (or `sauce --version` / similar).

If any of those three are not satisfied, **stop and fix first**:
- Step 1 was already done (this cycle).
- Step 2 requires a manual merge click at the PR URL because the `gh` CLI auth (EMU) can't merge personal-repo PRs.
- Step 3 is `brew upgrade sauce` — takes ~30s.

---

## Vault target

`/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce`

Verify path exists with `ls -d /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/platform-subscription.json`. The vault is on this predecessor machine (same machine as the workshop dev repo). One-shot onboarding — no cross-machine sync.

---

## The fully-automated recipe (agent runs all of this)

### Step 1 — Verify pre-requisites

```bash
# 1a. Confirm sauce CLI is at v0.37.0
sauce doctor 2>&1 | head -20
# Expect: sauce libexec resolves; version ≥ 0.37.0 (verify via the Formula's pantry path)

# 1b. Confirm tap merge landed
gh api repos/willfell/homebrew-sauce/contents/Formula/sauce.rb --jq '.content' 2>&1 | base64 -d | grep 'url '
# Expect: url "https://github.com/willfell/sauce/archive/refs/tags/v0.37.0.tar.gz"
# If still shows v0.36.1, the tap PR isn't merged — STOP and tell the user to merge
# https://github.com/willfell/homebrew-sauce/pull/2

# 1c. Confirm accuris-sauce subscription exists
test -f /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce/ranch/platform-subscription.json && echo "OK: subscription file present"
```

### Step 2 — Edit the subscription (in-place patch via node one-liner)

```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
node -e '
const fs = require("fs");
const p = "ranch/platform-subscription.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.workshop_version = "0.37.0";
if (!s.blueprints.find(x => x.name === "scratch")) {
  s.blueprints.push({ name: "scratch", version: "0.1.0" });
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  console.log("OK: added scratch@0.1.0 + bumped workshop_version to 0.37.0");
} else {
  // Already subscribed — still bump workshop_version + scratch pin if drifted
  s.blueprints = s.blueprints.map(b => b.name === "scratch" ? { ...b, version: "0.1.0" } : b);
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  console.log("OK: scratch already subscribed; pin synced + workshop_version bumped");
}
'
```

### Step 3 — Run the installer

```bash
sauce reinstall --vault "$(pwd)" 2>&1 | tail -30
# Alternatively: sauce update --force
```

**Expected outcome:** `Verdict: clean run — exit 0` with materialization output showing:
- `[Notice] Scratch blueprint installed at spice/scratch/. ...` (post_install notice)
- `claude_surface_install` history entries for `.claude/commands/scratch.md` + `.claude/skills/scratch/new-scratch/SKILL.md`
- `claude_md_regen` event updating the resolvers table

**No skip events expected.** If any blueprint reports `subscription pins X but workshop has Y`, the brew upgrade didn't land — re-check Step 1a.

### Step 4 — Smoke test

```bash
# Verify materialization
ls -la .claude/commands/scratch.md .claude/skills/scratch/new-scratch/SKILL.md
grep -c "Scratch" CLAUDE.md  # expect ≥1 (resolvers row)

# Verify spice/scratch/ hub note exists
ls -la spice/scratch/Scratch.md

# Verify nav-button registered
grep -c "scratch-new\|scratch_new\|scratch" ranch/nav-buttons-registry.json

# Run /audit via CLI for the cohesion smoke
sauce audit --claude-surface --vault "$(pwd)" 2>&1 | tail -15
```

**Expected /audit output:**
- `dead_path=0`
- `consumer_edit_at_risk=0`
- `orphan` may be ≥0 (if accuris has personal commands like `ticket.md`)
- `stale_but_valid=0` (or 4 if the pre-existing audit/install/upgrade/bootstrap mechanism body version-comment lag hasn't been fixed yet — that's a separate housekeeping FIX-LATER, unrelated to scratch)
- `aligned≥N+3` where N is the pre-cycle count (scratch contributes 3 entries: command + skill + claude_md_row)

### Step 5 — Optionally commit subscription change in the consumer vault

If `accuris-sauce` is a git-tracked repo (check with `git status` inside the vault), commit the subscription bump so the consumer-side state is recorded:

```bash
cd /Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce
git status --short ranch/platform-subscription.json
# If shown:
git add ranch/platform-subscription.json
git commit -m "$(cat <<'EOF'
chore(subscription): scratch@0.1.0 + workshop_version 0.37.0

Onboards accuris-sauce to the scratch blueprint shipped in workshop
v0.37.0. Per-day index files materialize lazily; global hub at
spice/scratch/Scratch.md.
EOF
)"
# Don't push unless the user explicitly approves — the consumer repo may have
# its own push policy
```

If the vault is NOT git-tracked, skip this step entirely.

---

## Acceptance criteria — agent reports back when ALL are true

- [ ] `sauce reinstall --vault "$(pwd)"` exited 0 with `Verdict: clean run`
- [ ] `.claude/commands/scratch.md` exists (4kb-ish)
- [ ] `.claude/skills/scratch/new-scratch/SKILL.md` exists (3-4kb)
- [ ] `spice/scratch/Scratch.md` exists (hub note)
- [ ] CLAUDE.md resolvers marker block contains a `Scratch` row
- [ ] `/audit` reports `0 dead_path / 0 consumer_edit_at_risk` for scratch
- [ ] Subscription file shows `workshop_version: "0.37.0"` and `scratch@0.1.0` in blueprints[]

If any criterion fails: surface the failure mode + the relevant log lines, do NOT continue.

---

## Use the blueprint in Obsidian (after install lands)

> [!tip] User-facing manual step (NOT agent's job — agent's job ends at /audit clean)
> Open the accuris-sauce vault in Obsidian. The `Scratch` nav-button should appear in the SpaceNavButtons row at the top of every note (assuming nav-buttons is enabled — it should be, since accuris is already subscribed). Click `Scratch` to create today's first scratch note at `spice/scratch/2026/05-May/2026-05-12/Scratch-2026-05-12-HH-mm.md`. The per-day index file `<DayName>-2026-05-12.md` appears in the same folder. The global hub at `spice/scratch/Scratch.md` shows day cards.

---

## Cross-machine variant (if onboarding to headspace-sauce or ero-sauce later)

This handoff is for accuris-sauce on the predecessor machine. For headspace + ero on the target machine, the recipe is **identical** but the vault paths differ:

| Vault | Path on target machine |
|---|---|
| headspace-sauce | `/Users/willfellhoelter/notes/sauce/headspace-sauce` |
| ero-sauce | `/Users/willfellhoelter/notes/sauce/ero-sauce` |

On the target machine, run `brew upgrade sauce` once, then re-run Step 2-4 against each vault path. ero specifically does NOT subscribe to cowork — same constraint applies here (no scratch-side concern; just informational).
