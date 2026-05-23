---
description: Re-run sauce installer against current subscription
allowed-tools: Bash, Read
---

<!-- @claude-surface:version 0.1.0 -->

# /install

Re-runs `sauce update` for the current vault against `ranch/platform-subscription.json`. Use this after:
- Pulling a workshop update (`cd ~/sauce && git pull`)
- Editing `ranch/platform-subscription.json` (subscription drift)
- Manually placing files under `.claude/commands.local/` or `.claude/skills.local/` (re-apply shadow shim)

The skill at `.claude/skills/platform/install/SKILL.md` shells out to `sauce update --vault $(pwd)` and renders the install ledger delta.

---

### Upgrading from v0.74.0 → v0.75.0

The headline change: **cowork orchestrators now refuse to ship non-compliant atomic notes.** Three layers of skill-routing hardening close the multi-context-Claude-Code gap that opened in v0.74.0's body-shape contract.

**Auto-bump consumer subscription pins:**

```
cd /path/to/your/consumer/vault
sauce update --bump-pins
```

This replaces the v0.74.0 manual `vim ranch/platform-subscription.json` step.

**Immediate-mitigation recipe (existing scheduled-tasks MCP entries):**

For each consumer vault with pre-v0.75.0 onboarded cowork schedules, run the manual prompt-edit recipe below. This rewrites the ~20 existing scheduled-tasks MCP entries (5 cadences × 4 vaults) to the new enriched form so cron fires explicitly READ the sub-skill SKILL.md bodies. Going forward, all `cowork:onboard-scheduled-jobs` invocations register the enriched form by default.

If the recipe isn't run, the existing entries continue to use the v0.74.0 prompt — Layer 2's post-write verification step is the durable backstop: any non-compliant body gets deleted and the orchestrator emits `failed:contract-violation:<field>`. The recipe is friction-reduction, not strict-requirement.

#### Per-vault audit

Run from inside Obsidian via Claude Code session in the consumer vault:

```
mcp__scheduled-tasks__list { }
```

Filter the returned list for tasks whose name matches `cowork-<orch>-<engagement>`. Expected count per vault:
- accuris-sauce (w2-fte): 5 tasks
- ero-sauce (consulting): 5 tasks
- headspace-sauce (personal): 5 tasks
- barebones: 0 or up to 5

#### Replacement prompt template

For each task with id `<task_id>`, orchestrator `<orch>`, engagement `<engagement.id>`:

```
mcp__scheduled-tasks__update {
  task_id: "<task_id>",
  prompt: "Use skill cowork:<orch> with { engagement_id: \"<engagement.id>\" }. When the orchestrator instructs you to use a sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ and strictly follow its sections including any \"## Pre-write self-check\" checklist before proceeding with the action described in \"## Steps\". Return failed:contract-violation:<field> on any miss."
}
```

#### Smart Connections semantic retrieval (optional)

If you have Smart Connections installed and indexed in your consumer vault, morning-briefing / eod-review / weekly-review now surface a `> [!example]+ 🧩 Related context` callout block with thematically-close notes. Lag-age is interpolated into the Synopsis callout. Index-absent vaults degrade gracefully (one-line warning, no abort).

To enable per-engagement, ensure `render_aspects.semantic_related: "include"` is set on your engagement (it's the new default; opt out by setting it to `"skip"` in `vault-config.md`).
