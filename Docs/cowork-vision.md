---
purpose: Cowork's long-term direction, quality bar, anti-goals, and locked strategic decisions. Authored 2026-06-07 in a parallel-with-v0.94.0 brainstorm session. Read this before scoping any cowork-touching cycle from v0.95.0 onward.
load_when: Picking a next cowork cycle; designing a cowork sub-skill; assessing whether a proposed cowork change advances the platform or just bolts on.
status: authoritative as of 2026-06-07
parallel_with: v0.94.0 — applyExternalPluginInstall (tactical install-helper cycle executing in a separate session)
informs: v0.95.0+ cowork-spine, v0.95.x voice/bootstrap polish, v0.96.0+ memory write-side + cross-machine wrappers
---

# Cowork vision

This is cowork's North Star, the quality bar that operationalizes it, the anti-goals that keep it from drifting, and the strategic decisions locked in during the 2026-06-07 brainstorm. It is short by design — the value is in the *commitments*, not the prose. Each cycle that touches cowork should be checkable against this doc.

## 1 — North Star

> Cowork is a **composable, adaptable, assistant-like framework** that dynamically connects and utilizes all of your tools, configures a network of people / interests / connectors, runs daily, ticks memory hourly, synthesizes that memory, and **slowly becomes a personal assistant** — providing the information you need every day, getting better and better over time through pattern matching, memory ticking, microscope functionality, dynamic use, and consistent scheduling.

Three load-bearing intents in one sentence:

1. **Composable + adaptable** — the same skill code serves any user with any setup with any needs; engagements are knob bundles, not categories; users reorder + tune connectors per cadence; voice + microscopes + scheduling are first-class composables.
2. **Memory-compounding** — cowork's value increases over time. Memory ticks (hourly), synthesis (daily, weekly), and semantic retrieval (echoes) build a richer corpus every day. Future runs leverage what past runs observed.
3. **Assistant-like** — cowork is ambient and rhythmic, not transactional. The user doesn't ask; cowork shows up at the right cadences with the right shape.

## 2 — Quality bar (operational dimensions)

The compounding-assistant North Star has to be measurable. The platform's current quality state was assessed during the 2026-06-07 brainstorm via two consumer-vault atomic notes (headspace 2026-06-07 morning-briefing; accuris 2026-06-05 morning-briefing). All four thematic buckets graded **weak today** — the platform has structural deficits across the board, not one isolated gap. v0.95.0+ ships the spine; v0.95.x → v0.96.0+ cascade the rest.

| # | Dimension | What "great" looks like | Current grade | Target |
|---|---|---|---|---|
| 1 | **Cohesion** (skill structural alignment) | Same conceptual step has the same label across all 5 orchestrators; no copy-pasted pseudocode; one canonical orchestrator template. | C (drift accelerating per cycle) | A by v0.95.0 |
| 2 | **Composability** (knob ergonomics) | Users reorder + tune connectors per cadence per engagement without forking any JSON. Layered preferences tree (type_bundle ⨁ engagement_overrides ⨁ ad_hoc → final). | C (rigid `render_aspects`; if-ladders in skill code) | B+ by v0.95.0; A by v0.96.0 |
| 3 | **Adaptive memory loop** (write-side compounding) | Cowork actively logs observations about user patterns; future runs use them. North Star explicitly elevates this from supporting to first-class. | D (read-side only — v0.85.0/v0.87.0) | B by v0.96.0+ |
| 4 | **Voice fidelity** (per-engagement personality) | Same skill code yields engagement-flavored output. brand-voice.md, personality block, microscopes drive narrative voice; LLM session variance is bounded. | B (great on headspace; C on accuris — data-population gap) | A by v0.95.0.x |
| 5 | **Generalizability** (any-user posture) | A new user cloning sauce sees generic placeholders, not the author's team baked into the test surface. Engagement-types are knob bundles, not gated by hard-coded discriminators in skill code. | C (accuris-specific identifiers leak into fixtures + SKILL.md prose) | A by v0.94.2 + v0.95.0 |
| 6 | **Quality observability** (grading own output) | Automated KPIs (Echoes-fire rate; warning-Notice count; sub-skill-invocation rate; atomic-note size variance). `cowork:doctor` skill surfaces them. | F (manual inspection only) | B by v0.96.0+ |
| 7 | **Recoverability** (failure-mode polish) | MCP-unavailable warnings render usefully; cold-corpus Echoes warning rewords gracefully; sentinel detection is robust. | C (the Echoes warning callout is the most visible scar) | A by v0.95.0.x or v0.96.x |
| 8 | **Cross-machine consistency** | Same wrapper, same atomic-note output on every machine the user syncs to. No machine-local paths baked into wrapper bodies. | C (v0.93.0 sync-scheduled-jobs gave partial relief; wrappers still bake `/Users/willfellhoelter` at sync time) | A by v0.96.0+ |
| 9 | **Bootstrap quality** (interview thoroughness) | Engagement context dir gets populated to ~7-8 files for every engagement; `brand-voice.md`, `people.md`, `finance-guide.md` are prompted aggressively when relevant. | C (headspace has 8; accuris has 4 — population gap pulls voice fidelity down) | B by v0.95.0.x |

## 3 — Anti-goals

What cowork is explicitly NOT trying to be. Naming these prevents scope drift.

- **NOT a CRM.** People records live in `spice/people/`; cowork *references* them via wikilinks and resolves them via `cowork:resolve-person`, but cowork doesn't own the CRM data model. (CRM-ish ergonomics like inner-circle bootstrap, person-note stubs, and the `discover-people` / `find-missing-people` orchestrators are SECONDARY tooling that supports atomic-note quality. They are not the product.)
- **NOT a project-management tool.** Projects (and their statuses) live in `spice/projects/`; cowork *reads* them via `gather-projects` but doesn't manipulate the project model. Atomic notes surface project signal; they don't manage it.
- **NOT an email client / chat client / calendar.** MCPs own the data sources; cowork is the cadence-driven reader + composer. The platform never tries to *replace* M365 / Gmail / Google Calendar / iMessage — it consumes whatever's served and renders it through the user's voice + microscopes.
- **NOT a finance tracker.** Finance data lives in third-party services (Copilot, banks, Brex) reached via MCP. cowork's finance callouts are surface-level — debt snapshot, CC drift, budget pace. Detailed budget management is out of scope.
- **NOT a slash-command interface.** Cowork is primarily cron-driven (5 cadences). User-invocable orchestrators (`/cowork discover-people`, `/cowork find-missing-people`, `/cowork sync-scheduled-jobs`) exist as platform tooling — they support the cadence flow but are not the everyday surface.
- **NOT a workflow engine.** Cowork has fixed cadences (morning, midday, eod, weekly, monthly). It is not pluggable with arbitrary user-defined cadences. The five are the contract.
- **NOT an AI-generic chat assistant.** Cowork doesn't converse. It generates ONE deterministic-path atomic note per (engagement, cadence, day). The personality + voice contract is what makes it feel assistant-like; the cadence-driven write contract is what makes it a *system*, not a chat.

## 4 — Locked strategic decisions

Q&A list, mirrored on `Docs/plans/2026-06-07-post-v0.93.2-brainstorm-state.md` § 8's 10 seeded questions plus new ones from the 2026-06-07 brainstorm.

### Q1 — Distribution model (the "any user" claim)
**Locked: personal-public with OSS readiness as a v1.0.0 target.** Sauce ships via Homebrew; anyone *can* install and customize, but the platform doesn't yet optimize for true OSS multi-user contribution. v0.94.2 (de-personalization) closes the most visible "your team is baked into my install" gap. v1.0.0+ may add governance + OSS scaffolding if user-base growth justifies. Reasoning: keeping a personal-public posture lets the platform evolve fast; full OSS posture adds governance overhead that doesn't pay back until users beyond the author exist.

### Q2 — Engagement-type taxonomy
**Locked: engagement-types become NAMED KNOB BUNDLES, not first-class categories.** v0.95.0 reshapes the schema so `type: personal | w2-fte | consulting` is a starting bundle the user picks at bootstrap. Per-engagement overrides ride on top. Runtime skill code reads the FINAL composed preferences; the `if engagement.type === "personal"` ladder is gone from gather/write skills. The three current bundle names stay; new bundles can be added without code change. Custom engagements pick `type_bundle: custom` + populate all knobs themselves.

### Q3 — Cowork's relationship to other blueprints
**Locked: cowork is sui generis (flagship); others are utility-scale.** Daily / weekly / monthly / scratch / meetings / projects / people are utility blueprints — they ship a small surface that cowork (and direct user editing) consumes. The vision in this doc is cowork-specific; other blueprints have their own (smaller) directions. If a non-cowork blueprint feature would advance cowork's compounding-assistant intent, it's allowed to live there; otherwise utility blueprints stay small and stable.

### Q4 — Knob taxonomy (the layered preferences tree)
**Locked: type_bundle ⨁ engagement_overrides ⨁ ad_hoc → final.** Composition order: engagement-type JSON ships bundle defaults; `engagement.overrides` block in `vault-config.md` overrides per-engagement; ad-hoc / runtime overrides (e.g. user-preferences.md priorities reorder) are the final layer. Final composition happens in a NEW `cowork:read-engagement` helper called from the NEW `cowork:plan-dispatch` sub-skill. All gather/write skills read the FINAL preferences; none touch engagement-type JSON at runtime.

### Q5 — Skill structural cohesion enforcement
**Locked: canonical template doc + extracted sub-skills.** v0.95.0 authors `Docs/agent-guides/cowork-orchestrator-template.md` (the canonical shape) AND extracts the ~100-line dispatch-plan pseudocode into a NEW `cowork:plan-dispatch` sub-skill that wraps the existing `dispatch-plan-helper.js`. The 5 orchestrators become thin coordinators (~150 lines each) that READ the sub-skill. Drift is structurally prevented — there's only one dispatch logic copy. A `cowork:audit-cohesion` skill is queued as a v1.0.0+ candidate if growth ever justifies enforcement automation; the template + extraction are sufficient through v0.96.x.

### Q6 — Dynamic understanding scope
**Locked: read-side compounding is the v0.94-v0.95 frontier; write-side is v0.96.0+.** "Dynamic understanding" today means: `prefs.mcps[<kind>]` is runtime-authoritative (not vault-config.mcp_map); microscopes per-kind override callout shape; voice contract pulls from `prefs.personality`. v0.96.0+ adds the WRITE side — cowork actively logs observations ("user prefers morning calls", "Diana is the quiet one", "Cap1 attack payment is the recurring debt anchor") into a pattern store that future runs consult. North Star elevates this from supporting to first-class; the platform isn't ready until the spine (v0.95.0) lands.

### Q7 — Quality observability
**Locked: `cowork:doctor` skill is a v0.96.0+ candidate; manual inspection covers v0.94-v0.95.** v0.95.0's verification step (re-read + structural verify, already shipped in v0.91.x) catches per-run violations. Aggregate KPIs (warning-Notice count over time; Echoes-fire rate; atomic-note size variance per cadence) wait until v0.96.0+ when the memory write-side gives us a place to *write* the observations.

### Q8 — Bootstrap-interview quality
**Locked: v0.95.0.x PATCH ships interview enhancement after the spine lands.** Headspace has 8 populated context files; accuris has 4. The gap is bootstrap-vault not prompting aggressively for `brand-voice.md` / `people.md` / `finance-guide.md`. Post-v0.95.0, bootstrap-vault gains stage-gated optional fill steps that walk the user through populating each context file when its render_aspect is `include`. v0.95.0 itself does NOT enhance bootstrap — the spine refactor is the gate.

### Q9 — Memory-layer write side
**Locked: v0.96.0+.** See Q6. Premature without the spine.

### Q10 — OSS readiness
**Locked: not a v0.94-v0.95 priority.** v0.94.2 (de-personalization) handles the highest-leverage hygiene gap. Full OSS readiness (CONTRIBUTING.md for cowork specifically; governance; broader test coverage of edge-case engagements; documentation refresh; HOWTO guides) waits until user-base growth justifies. Personal-public posture per Q1.

## 5 — Cadence arc (the resequenced cycles)

Live arc as of this doc. See `Docs/plans/2026-06-07-post-v0.93.3-brainstorm-state.md` § 4 for the canonical version; this section is a cross-reference.

| Cycle | Scope | Status | Vision dimension(s) advanced |
|---|---|---|---|
| **v0.94.0** | `applyExternalPluginInstall` — closes v0.93.3 existing-consumer install gap | shipped 2026-06-07 (tag `v0.94.0`) | Recoverability |
| **v0.95.0** | cowork-spine MINOR — `cowork:plan-dispatch` sub-skill | **PARKED 2026-06-10** (cohesion-sweep premise obsoleted by v0.97.x wrapper architecture; see PARKED banner on design doc) | superseded |
| **v0.95.1** | cowork-anti-echo MINOR — three knobs breaking the memory echo loop | shipped 2026-06-08 | Recoverability + (proactive memory-arc safety net) |
| **v0.96.0** | cowork-rethought-1 MINOR — Rail W sidecars + Rail D MCP discovery + Rail L per-kind preference learning | shipped 2026-06-08 | Composability + Adaptive memory loop (read+write) |
| **v0.96.1** | cowork-rethought-1-patch PATCH — multi-engagement learned_weights nesting + cron heartbeat read | shipped 2026-06-08 | Adaptive memory loop tail + Recoverability |
| **v0.96.2** | daily-dashboard-tskeys-hotfix PATCH — semantic `day:` bucketing | shipped 2026-06-09 | Cross-machine consistency tail |
| **v0.97.0** | cowork-rethought-2 MINOR — Rail O orchestrator-instructions single-source + Rail T wrapper template + Rail A claude.ai sync + Rail R local reconciler | shipped 2026-06-09 | Cohesion (A) + Cross-machine consistency |
| **v0.97.1** | reconciler-as-cadence PATCH — reconciler moves from launchd to claude.ai scheduled job | shipped 2026-06-09 | Cross-machine consistency tail |
| **v0.97.2** | wrapper-delegation-proof PATCH — anti-delegation directive + inline write contract + PRELUDE date fix | shipped 2026-06-10 | Recoverability (LLM-behavior bounding) |
| **v0.97.3** | cloud-sync-parity PATCH — guardrails move from JS literals to `_shared-clauses.md` | shipped 2026-06-10 | Cross-machine consistency tail |
| **v0.97.4** | prose-invariant write-guards PATCH — rating + anti-echo + coverage-gap deterministic backstops + inline microscope output-shape contract | shipped 2026-06-10 | Recoverability + Quality observability (machine-readable coverage-gap mirror) |
| **v0.98.0** ⭐ | **synopsis-density rewrite MINOR** — brief-shape contract change at OI layer (5 cadences): `[!info]+ <per-cadence title>` lead callout OPEN by default carrying ≤80-word predictive synopsis; per-kind callouts collapsed by default; bottom `[!tip] <closing>` REMOVED; NEW `## Synopsis composition rules (v0.98.0 contract)` EOF section per cadence | **SHIPPED 2026-06-10** (SHA TBD-at-S4-push) | Substance/Voice + Predictiveness (FIRST brief-shape change targeting the user's stated reading-load complaint directly) |
| **v0.98.1** | questionnaire expansion + free-text capture — stable item-IDs (`^item-<key>` block-IDs) + per-item ticks + per-kind frequency knobs + fenced code block free-text + sentinel HTML comment for v0.98.2 parse | **shipped 2026-06-11 (tag v0.98.1 — pending S4)** | Substance/Voice + Predictiveness tail |
| **v0.98.2** | feedback-loop closure MINOR — Rail L v=2 (+ Didn't-like list); reconcile-cowork ingest steps 3/3.5/3.6/5.5/5.6 (BOTH sentinels + deterministic rollup + inline LLM intents + non-weight deltas + voice-proposal sweep); learned_weights schema 2 → 3 nested per-kind entity maps in `user-preferences.md` frontmatter; voice changes PROPOSED + tick-to-approve in next morning brief; coverage queue + feedback-deltas audit log; eod sidecar 1.2.0 with items[] registry | **SHIPPED 2026-06-11** | Adaptive memory loop (write-side compounding — first cycle the loop is LIVE) + Substance/Voice tail (downvote completes capture) |
| **v0.99.0** | sparse-signal feedback MINOR — engagement-gated learning days (Step 3.4: ENGAGED/TAP-ONLY/SILENT classified at the 03:00 reconciler; only ENGAGED days emit observations/run decay/progress warmup); prose-first capture v=3 (one-tap `Useful: yes/no` + free-text fence on TOP, per-kind lists collapsed below; `<kind>:` prose-prefix deterministic section scoping); rolling-30 satisfaction series; learned_weights schema 3 → 4 (engaged_days + satisfaction in totals; warmup_until retired; ONE-TIME silence-reset migration zeroes silence-built skips + restores warmup); graduation = 7 engaged days AND 7 ticks+skips | **SHIPPED 2026-06-12** | Adaptive memory loop (sparse-signal correctness — the loop learns from real signal instead of mis-learning from silence) + Quality observability seed (satisfaction series is the doctor's first KPI) |
| **v0.101.0** | verbal feedback everywhere MINOR — capture v=4 on ALL FIVE cadences (one-tap `Useful: yes/no` + free-text typing box on top of every brief; EOD keeps per-item Mattered/Didn't-like lists + knobs; the 4 non-EOD cadences render ONE collapsed kind checklist — old checkboxes demoted to garnish; rating-block EMISSION retired, parser retained forever; either-marker write-guard); per-cadence satisfaction `{day, cadence, useful}` + learned_weights schema 4 → 5 (PURELY ADDITIVE — no reset, counters intact); prose ingest generalized (per-note intents tagged source_cadence; dedup per (day, intent, kind, entity); prose-over-tap precedence; NEW `satisfaction` intent; downrank-kind-no-entity = kind skip symmetry) | **SHIPPED 2026-06-13** | Adaptive memory loop (the primary feedback channel now exists at every touchpoint) + Quality observability (the satisfaction series becomes cadence-resolvable — the doctor's KPI upgrade) |
| **v0.99.1+** | `cowork:doctor` (embedded in the nightly reconciler; 4 checks locked at the 2026-06-11 brainstorm; **displaced ONE cycle by v0.101.0 — its self-grading digest now reads PER-CADENCE satisfaction**) + cross-machine lockfiles/path-relative wrappers (bundled, queued behind doctor) + `cowork:audit-cohesion` + per-skill SemVer + the v0.95.1-migrator carry-forward | queued (doctor NEXT) | Quality observability + Cross-machine consistency + Cohesion enforcement |

## 6 — Decision audit (how to use this doc)

Before scoping a cowork-touching cycle:

1. Which vision dimension(s) does this cycle advance? (Name them.)
2. Does the proposed scope conflict with any anti-goal in § 3? (If yes, redesign or carve out.)
3. Does it conflict with any locked decision in § 4? (If yes, reopen the decision explicitly — don't slip past it.)
4. Where does it land in the arc in § 5? (If it skips earlier cycles, name what's blocked by the skip.)

When a future brainstorm wants to add a vision dimension, anti-goal, or locked decision, update this doc and reference the update in the cycle's design doc. The vision doc is the authoritative reference, not a snapshot — but every update must be traceable to a brainstorm.
