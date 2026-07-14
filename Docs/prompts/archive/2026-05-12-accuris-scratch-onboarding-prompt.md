---
title: Fresh-session prompt — onboard accuris-sauce to scratch@0.1.0
date: 2026-05-12
status: ready-to-paste
---

# Fresh-session prompt

> [!info] Paste the prompt block below as the first message in a new Claude Code session inside the `/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce` vault (or just from anywhere — the prompt names the absolute path).

---

```
Onboard the accuris-sauce vault to the scratch@0.1.0 blueprint shipped in
workshop v0.37.0. Fully automated — no Obsidian UI clicks. The full
handoff doc lives at:

/Users/willfell/Documents/obsidian/sync/workshop/sauce/Docs/prompts/2026-05-12-accuris-scratch-onboarding-handoff.md

Read that doc first for context, then execute its Steps 1-4. Pause only
if Step 1's pre-requisite checks fail (e.g., tap PR not yet merged, brew
upgrade not yet run on this machine). Otherwise proceed straight through
to /audit smoke at Step 4 and report the acceptance-criteria checklist.

## Target vault

/Users/willfell/Documents/obsidian/sync/sauce/accuris-sauce

## Pre-requisites (confirm before acting)

1. Workshop tag v0.37.0 exists at origin/main of willfell/sauce
   (verify: cd /Users/willfell/Documents/obsidian/sync/workshop/sauce && git tag --list | grep v0.37.0)

2. Tap PR https://github.com/willfell/homebrew-sauce/pull/2 has been MERGED
   (verify the formula reflects v0.37.0:
    gh api repos/willfell/homebrew-sauce/contents/Formula/sauce.rb --jq '.content' | base64 -d | grep 'url ')
   If still showing v0.36.1, STOP and tell me to merge PR #2 at
   https://github.com/willfell/homebrew-sauce/pull/2 before proceeding.

3. brew upgrade sauce has been run on this machine
   (verify: sauce doctor | head)

## Skill expectations

- Use de:executing-plans to drive the handoff doc as the plan.
- Use de:verification-before-completion before claiming /audit-clean —
  actually run the audit command, paste the output, confirm 0/0 on the
  dead-path + consumer-edit-at-risk severities.

## What success looks like

The acceptance-criteria checklist in the handoff doc is fully satisfied:
- sauce reinstall exit 0 with "clean run" verdict
- .claude/commands/scratch.md + .claude/skills/scratch/new-scratch/SKILL.md
  materialized
- spice/scratch/Scratch.md hub present
- CLAUDE.md resolvers includes Scratch row
- /audit reports 0 dead_path / 0 consumer_edit_at_risk for scratch
- ranch/platform-subscription.json shows workshop_version 0.37.0 + scratch@0.1.0

Report back with the audit counts + the materialized file list. Don't
commit the subscription change in accuris-sauce unless I explicitly ask
(may have its own git policy I haven't decided yet).

## Non-negotiables

- Don't run sauce update against the workshop dev repo at
  /Users/willfell/Documents/obsidian/sync/workshop/sauce — only against
  the accuris-sauce vault.
- Don't push anything to remote repos from this session.
- If anything is unclear after reading the handoff doc, ask instead of
  guessing.
```

---

## Why this is fully automated

Once pre-requisites are satisfied (steps 1-3 of the handoff), the agent's path through Steps 1-4 is:

1. **Edit** `ranch/platform-subscription.json` via a node one-liner — adds `scratch@0.1.0` and bumps `workshop_version: 0.37.0`. Idempotent (running it twice is safe).
2. **Run** `sauce reinstall --vault "$(pwd)"`. The installer:
   - Reads the now-edited subscription
   - Materializes scratch's `files[]` (3 templates) into `ranch/templates/`
   - Copies the 2 helper scripts into `ranch/scripts/scratch/`
   - Writes the hub note into `spice/scratch/Scratch.md`
   - Materializes `.claude/commands/scratch.md` + `.claude/skills/scratch/new-scratch/SKILL.md` via claude_surface aggregator
   - Updates `CLAUDE.md` resolvers marker region
   - Writes `ranch/claude-surface-registry.json` with scratch contributions
   - Registers the `scratch-new` nav-button entry
3. **Audit** via `sauce audit --claude-surface` and report counts.

No Obsidian needed. No Templater runs needed. No user clicks. The agent verifies via filesystem + CLI exit codes.

The only manual touchpoint in the whole flow is the **tap PR merge click** (which only happens once per workshop release, and is unrelated to per-vault onboarding) and the **brew upgrade** on each machine (which only happens once per machine per release).

## After accuris lands

To onboard headspace-sauce + ero-sauce on the other machine: copy this prompt, swap the vault path to `/Users/willfellhoelter/notes/sauce/<vault>-sauce`, and paste into a session on that machine. The handoff doc has a Cross-Machine Variant section noting this directly.
