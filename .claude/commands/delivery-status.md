---
description: "Deprecated — use /loop:status from the sauce loop plugin instead"
allowed-tools: Read, Bash, Glob, Grep, Skill
---

# /delivery-status (deprecated)

The delivery skills moved into the `loop` plugin — one source of truth for every repo and agent runtime. Run the `loop:status` skill (`/loop:status`) now and follow it exactly.

If the plugin is not installed: `/plugin marketplace add willfell/sauce`, then `/plugin install loop@sauce`. The repo binding lives in `.loop/config.json` (run `/loop:init` once per repo).
