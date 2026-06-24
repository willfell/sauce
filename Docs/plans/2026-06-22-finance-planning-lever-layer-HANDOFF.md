---
purpose: Copy-paste handoff prompt to start a fresh Claude Code session (cwd = the sauce repo) that brainstorms a native "allocation engine + unified dashboard" for the finance blueprint — making the lever / debt / savings system easier to manage.
kind: handoff-prompt
date: 2026-06-22
pair_with: Docs/plans/2026-06-22-finance-planning-lever-layer-brainstorm.md
---

# Handoff prompt — finance blueprint "allocation + dashboard" brainstorm

**How to use:** open a new Claude Code session with the working directory set to `/Users/willfellhoelter/projects/repos/sauce`, then paste everything in the block below.

---

```
You're picking up a finance-blueprint design effort for the "sauce" platform. There's deep prior context and I want ZERO gaps before you propose anything — get fully oriented first, in this order.

## 1. Invoke my finance skill first (it loads how my money works)
Use the global `finance` skill (it lives at /Users/willfellhoelter/.claude/skills/finance/ and is available in every session). Read its SKILL.md and references/map.md. That teaches you my "lever" system (the rules), where my real data lives, and the Copilot Money caveats. The skill reads my headspace Obsidian vault + Copilot via absolute paths, so it works even though your cwd is this repo.

## 2. Read the brainstorm-input doc (your starting point)
/Users/willfellhoelter/projects/repos/sauce/Docs/plans/2026-06-22-finance-planning-lever-layer-brainstorm.md
It has the why, the current blueprint state, the 8 functionality gaps, seed design directions, hard constraints, and the open questions you must resolve.

## 3. Read my real-world setup (the headspace vault — full paths)
- Situation + numbers + build log: /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/onboarding/Current Lay of the Land.md
- The rules (canonical): /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/knowledge/Lever Protocol.md
- The rituals: /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/knowledge/Cadence.md
- What's configured + status: /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/onboarding/Build-Out Plan.md
- The finance skill's own design spec: /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/finance/docs/knowledge/Finance Skill — Design Spec.md
- Live finance entities (the data the feature operates on): /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/finance/ — Budget Defaults.md, Paycheck Defaults.md, Debt Defaults.md, debts/Debt-*.md, budgets/<YYYY-MM>/, paychecks/, months/

## 4. Read how the blueprint works
- How-it-works reference: /Users/willfellhoelter/notes/sauce/headspace-sauce/spice/projects/sauce/docs/blueprints/how-they-work/Finance Blueprint.md
- Source in THIS repo: /Users/willfellhoelter/projects/repos/sauce/platform/blueprints/finance/ (manifest.json + content/ + templates/ + helpers/*.js). Finance blueprint is v0.9.2; workshop v0.125.0. The Docs/plans/ convention is a dated design → plan → result triplet.

## 5. The context in one paragraph
I have ~$49,740 in credit-card debt at ~24.6% APR on ~$9,000/mo net. I just built an accountability system as PROCESS + CONFIG on top of the finance blueprint: an income-bound discretionary envelope (~$2,950), three ordered levers (discretionary -> savings -> debt-attack-last), a savings glide path, an overflow rule, and a debt avalanche set via each debt entity's planned_monthly_payment. It works, but all the intelligence lives in my head and four markdown docs — the blueprint itself can't compute the envelope, run the glide path, allocate the avalanche, or roll it up. The four vault docs in step 3 are the concrete spec of "what good looks like."

## 6. Your task — brainstorm this feature
Design how to make my lever / debt / savings system EASIER TO MANAGE, natively in the finance blueprint. The vision I want you to design toward:
- A UNIFIED DASHBOARD that updates as I record/mark payments — one place that rolls up the envelope, debt, savings, and payoff date.
- An ALLOCATION ENGINE: from my configuration (income floor, savings glide tiers, attack level, lever order, avalanche order), it TELLS ME how much to put on each credit card and how much into savings this cycle — so I stop computing it by hand. When a card hits $0, it rolls that payment to the next avalanche target automatically.
- TRACKING + ADAPTATION: when something changes (a surprise expense, a savings tier crossed, extra/consulting income), it reallocates per the lever order and shows the downstream effect (e.g. "this slips your payoff ~N weeks").
- Net goal: simpler for me to run day-to-day, more sophisticated under the hood, and durable long-term as my situation changes.

Use the superpowers:brainstorming skill. Resolve the brief's open questions (where the plan config lives; envelope derived vs editable; widget vs cowork-skill split; how to source income floor + emergency-fund balance; lever-enforcement strength; MVP scope for a v0.10.0). Keep my headspace vault as the acceptance test: the native feature should be able to REPLACE my hand-built system with no loss of fidelity. Produce a design doc at /Users/willfellhoelter/projects/repos/sauce/Docs/plans/2026-06-22-v0.10.0-finance-planning-layer-design.md following the repo convention, then (after I approve the design) a matching -plan.md.

## 7. Hard constraints (don't break these)
- CustomJS classes use INSTANCE methods (customJS.X.method), never static; new shared math goes in FinanceMath, no widget re-implements a formula.
- Installer migrations must be headless-safe (adapter.read/write + regex/YAML, never processFrontMatter), marker-guarded for idempotency, with a .sauce-backup/<timestamp>/ snapshot per write, per-file failure-loud.
- Additive + backcompat: my headspace vault is LIVE on this blueprint with real data (the exact files in step 3) — any migration must be safe against them.
- A new sub-feature is a finance MINOR bump (v0.10.0); bump pins in platform/manifest.json + ranch/platform-subscription.json when you get to implementation.
- Don't touch my consumer vault from this repo session without telling me; this session is for designing the blueprint.

Start by invoking the finance skill and reading the docs above, then tell me your understanding of the current state + the gap before you start asking brainstorming questions. I want to know you have the full picture first.
```

---

**Note:** this pairs with the brainstorm-input doc (`...-brainstorm.md`) in the same folder — that doc is the structured detail; this prompt is the on-ramp.
