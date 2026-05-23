---
type: cowork-user-preferences
updated: 1970-01-01
updated_by: install.js
priorities: []
personality:
  vibe: null
  formality: null
  pep_talk: null
  length: null
mcps: {}
---

# user-preferences.md

This file is your personal preferences for cowork's atomic-note rendering — what to surface from each MCP, how to order it, what voice to use.

**This file is YOURS.** `sauce update` and `sauce reinstall` will NEVER overwrite it (carried by `materialize_once: true` in the cowork manifest).

To populate or update preferences, invoke `cowork:context-builder` — or just ask Claude to "update my cowork preferences". The skill auto-detects which MCPs are connected in your current session and asks tailored questions per MCP. Re-runs are idempotent and additive: only NEW MCPs are asked about by default; existing answers are preserved unless you explicitly choose to update them.

When v0.77.0 ships, the 5 atomic-note-emitting orchestrators (morning-briefing, midday-tripwire, eod-review, weekly-review, monthly-review) will read this file at fire time to:

- Reorder `[!example]+` blocks according to your `priorities:`
- Apply your `personality:` voice in narrative sections
- Skip MCP kinds you said you don't care about

For the boundary contract (which files are STOCK vs USER), see the workshop's `Docs/agent-guides/cowork-customization-contract.md`.
