---
description: "Deprecated — use /loop:review from the sauce loop plugin instead"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill, AskUserQuestion
---

# /delivery-review (deprecated)

The delivery skills moved into the `loop` plugin — one source of truth for every repo and agent runtime. Run the `loop:review` skill (`/loop:review`) now and follow it exactly.

If the plugin is not installed: `/plugin marketplace add willfell/sauce`, then `/plugin install loop@sauce`. The repo binding lives in `.loop/config.json` (run `/loop:init` once per repo).
