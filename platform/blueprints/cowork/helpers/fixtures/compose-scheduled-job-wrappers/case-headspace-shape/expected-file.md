---
type: cowork-scheduled-job-wrappers
engagement_id: headspace
sauce_version: 0.93.2
cowork_version: 0.32.0
contract_version: 0.33.0
generated_at: 2026-06-05T14:35:42-06:00
generated_by: cowork:sync-scheduled-jobs@1.0.0
warnings: [contract_version_mismatch:0.33.0:0.32.0]
---

# Cowork scheduled-job wrappers — Headspace (personal)

> [!warning]+ Warnings from generation
> contract_version_mismatch:0.33.0:0.32.0

> [!info]- How to use
> For each of the scheduled tasks below (one per cowork cadence), open the matching task in claude.ai's Cowork UI, replace the prompt body with the fenced block from the matching section, and save. Do not change the schedule.
>
> After all sections are pasted, run `/cowork morning-briefing headspace` in Claude Code as a smoke test.
>
> This file was generated against sauce 0.93.2 + cowork 0.32.0 + contract 0.33.0. When the sauce version moves past 0.93.2, re-run `/cowork sync-scheduled-jobs headspace` to refresh.

---

## 1 — cowork-morning-briefing-headspace (08:00 daily)
<!-- section_contract_version: 0.33.0 -->

````
Use skill cowork:morning-briefing with { engagement_id: "headspace" }.

OUTPUT PATH (NON-NEGOTIABLE): write the atomic note to EXACTLY:
  spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/morning-briefing.md
DO NOT write to spice/daily/<weekday>-<YYYY-MM-DD>.md.

FRONTMATTER (NON-NEGOTIABLE):
  type: cowork-morning-briefing      (EXACT)
  engagement_id: headspace
  day: "<YYYY-MM-DD>"                (ISO — NOT "Friday")
  generator: cowork:morning-briefing@1.0.0
  prompt_source: spice/cowork/prompts/morning-briefing.md
  title: Morning Briefing - <Weekday>, <Month> <D>, <YYYY>
  summary: <1-2 sentence headline>
  created_at: <ISO timestamp with timezone>
Do NOT include: cadence, date, generated_at.

DATAVIEWJS BLOCK (NON-NEGOTIABLE):
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

calendar served-by apple-mcp-uuid; chat served-by apple-mcp-uuid; github served-by github; messages served-by apple-mcp-uuid

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}. Reflective, warm, narrative-leaning; lean into journal-like cadence for personal scope.

MICROSCOPES (NON-NEGOTIABLE): for each kind in priorities, READ spice/cowork/prompts/per-mcp/<kind>/microscope.md and follow its ## Output shape directives verbatim. Resolve display names via people-aliases.md. Emit **[[Person Basename]]** for every inner-circle hit.

SUB-SKILL (NON-NEGOTIABLE): invoke cowork:write-run-note-morning-briefing. v0.91.1 + v0.91.2 + v0.91.3 + v0.92.0 write-guards enforce path + frontmatter + dvjs + body-shape at write time:
  failed:contract-violation:wrong-output-path
  failed:contract-violation:wrong-frontmatter:<field>
  failed:contract-violation:body-missing-navbuttons
  failed:contract-violation:body-shape:<reason>
on any miss.

TONE: Forward-looking; tee up the day's focus with calendar + email + chat + project surfaces.

When the orchestrator instructs you to use ANY sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ IN FULL and strictly follow ALL sections including any ## Pre-write self-check checklist. Return failed:contract-violation:<field> on any miss.
````

---

## 2 — cowork-midday-tripwire-headspace (12:30 daily)
<!-- section_contract_version: 0.33.0 -->

````
Use skill cowork:midday-tripwire with { engagement_id: "headspace" }.

OUTPUT PATH (NON-NEGOTIABLE): write the atomic note to EXACTLY:
  spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/midday-tripwire.md
DO NOT write to spice/daily/.

FRONTMATTER (NON-NEGOTIABLE):
  type: cowork-midday-tripwire       (EXACT)
  engagement_id: headspace
  day: "<YYYY-MM-DD>"                (ISO)
  severity: warn | alert
  generator: cowork:midday-tripwire@1.0.0
  prompt_source: spice/cowork/prompts/midday-tripwire.md
  title: <composed>
  summary: <1-2 sentence>
  created_at: <ISO timestamp with timezone>

DATAVIEWJS BLOCK (NON-NEGOTIABLE):
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

calendar served-by apple-mcp-uuid; chat served-by apple-mcp-uuid; github served-by github; messages served-by apple-mcp-uuid

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}. Reflective, warm, narrative-leaning; lean into journal-like cadence for personal scope.

SUB-SKILL (NON-NEGOTIABLE): invoke cowork:write-run-note-midday-tripwire. v0.91.1 + v0.91.2 + v0.91.3 + v0.92.0 write-guards enforce path + frontmatter + dvjs + body-shape at write time:
  failed:contract-violation:wrong-output-path
  failed:contract-violation:wrong-frontmatter:<field>
  failed:contract-violation:body-missing-navbuttons
  failed:contract-violation:body-shape:<reason>
on any miss.

TONE: Short + punchy by design; only fires when tripwire_aspects trip — otherwise produces a brief 'all clear' note.

When the orchestrator instructs you to use ANY sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ IN FULL and strictly follow ALL sections including any ## Pre-write self-check checklist. Return failed:contract-violation:<field> on any miss.
````

---

## 3 — cowork-eod-review-headspace (17:00 daily)
<!-- section_contract_version: 0.33.0 -->

````
Use skill cowork:eod-review with { engagement_id: "headspace" }.

OUTPUT PATH (NON-NEGOTIABLE): write the atomic note to EXACTLY:
  spice/cowork/daily/<YYYY>/<MM-Month>/<YYYY-MM-DD>/eod-review.md
DO NOT write to spice/daily/<weekday>-<YYYY-MM-DD>.md.

FRONTMATTER (NON-NEGOTIABLE):
  type: cowork-eod-review            (EXACT)
  engagement_id: headspace
  day: "<YYYY-MM-DD>"                (ISO — NOT "Friday")
  generator: cowork:eod-review@1.0.0
  prompt_source: spice/cowork/prompts/eod-review.md
  title: EOD Review - <Weekday>, <Month> <D>, <YYYY>
  summary: <1-2 sentence headline>
  created_at: <ISO timestamp with timezone>
Do NOT include: cadence, date, generated_at.

DATAVIEWJS BLOCK (NON-NEGOTIABLE):
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

calendar served-by apple-mcp-uuid; chat served-by apple-mcp-uuid; github served-by github; messages served-by apple-mcp-uuid

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}. Reflective, warm, narrative-leaning; lean into journal-like cadence for personal scope.

MICROSCOPES (NON-NEGOTIABLE): for each kind in priorities, READ spice/cowork/prompts/per-mcp/<kind>/microscope.md and follow its ## Output shape directives verbatim. Resolve display names via people-aliases.md. Emit **[[Person Basename]]** for every inner-circle hit.

SUB-SKILL (NON-NEGOTIABLE): invoke cowork:write-run-note-eod-review. v0.91.1 + v0.91.2 + v0.91.3 + v0.92.0 write-guards enforce path + frontmatter + dvjs + body-shape at write time:
  failed:contract-violation:wrong-output-path
  failed:contract-violation:wrong-frontmatter:<field>
  failed:contract-violation:body-missing-navbuttons
  failed:contract-violation:body-shape:<reason>
on any miss.

TONE: Retrospective; what shipped, what's carrying forward, what tomorrow looks like. Memory tick at the bottom is mandatory.

When the orchestrator instructs you to use ANY sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ IN FULL and strictly follow ALL sections including any ## Pre-write self-check checklist. Return failed:contract-violation:<field> on any miss.
````

---

## 4 — cowork-weekly-review-headspace (17:30 Friday)
<!-- section_contract_version: 0.33.0 -->

````
Use skill cowork:weekly-review with { engagement_id: "headspace" }.

OUTPUT PATH (NON-NEGOTIABLE): write the atomic note to EXACTLY:
  spice/cowork/weekly/<YYYY>/<YYYY-Www>/weekly-review.md
DO NOT write to spice/daily/ or spice/cowork/daily/.

FRONTMATTER (NON-NEGOTIABLE):
  type: cowork-weekly-review         (EXACT)
  engagement_id: headspace
  week: "<YYYY-Www>"                 (e.g. 2026-W23)
  generator: cowork:weekly-review@1.0.0
  prompt_source: spice/cowork/prompts/weekly-review.md
  title: <composed>
  summary: <1-2 sentence>
  created_at: <ISO timestamp with timezone>

DATAVIEWJS BLOCK (NON-NEGOTIABLE):
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

calendar served-by apple-mcp-uuid; chat served-by apple-mcp-uuid; github served-by github; messages served-by apple-mcp-uuid

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}. Reflective, warm, narrative-leaning; lean into journal-like cadence for personal scope.

MICROSCOPES (NON-NEGOTIABLE): for each kind in priorities, READ spice/cowork/prompts/per-mcp/<kind>/microscope.md and follow its ## Output shape directives verbatim. Resolve display names via people-aliases.md. Emit **[[Person Basename]]** for every inner-circle hit.

SUB-SKILL (NON-NEGOTIABLE): invoke cowork:write-run-note-weekly-review. v0.91.1 + v0.91.2 + v0.91.3 + v0.92.0 write-guards enforce path + frontmatter + dvjs + body-shape at write time:
  failed:contract-violation:wrong-output-path
  failed:contract-violation:wrong-frontmatter:<field>
  failed:contract-violation:body-missing-navbuttons
  failed:contract-violation:body-shape:<reason>
on any miss.

TONE: Reflective; patterns across the week, what got dropped, what's queued for next week. Memory tick at the bottom is mandatory.

When the orchestrator instructs you to use ANY sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ IN FULL and strictly follow ALL sections including any ## Pre-write self-check checklist. Return failed:contract-violation:<field> on any miss.
````

---

## 5 — cowork-monthly-review-headspace (last weekday 17:30)
<!-- section_contract_version: 0.33.0 -->

````
Use skill cowork:monthly-review with { engagement_id: "headspace" }.

OUTPUT PATH (NON-NEGOTIABLE): write the atomic note to EXACTLY:
  spice/cowork/monthly/<YYYY>/<YYYY-MM>/monthly-review.md
DO NOT write to spice/daily/ or spice/cowork/daily/.

FRONTMATTER (NON-NEGOTIABLE):
  type: cowork-monthly-review        (EXACT)
  engagement_id: headspace
  month: "<YYYY-MM>"                 (e.g. 2026-06)
  generator: cowork:monthly-review@1.0.0
  prompt_source: spice/cowork/prompts/monthly-review.md
  title: <composed>
  summary: <1-2 sentence>
  created_at: <ISO timestamp with timezone>

DATAVIEWJS BLOCK (NON-NEGOTIABLE):
```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

CONNECTIVITY (NON-NEGOTIABLE): trust user-preferences.mcps served_by + connected as runtime authority; vault-config.mcp_map is bootstrap-time audit hint only. Load deferred MCP tools via ToolSearch BEFORE dispatch. Cross-reference resolved served_by names against reachable_namespaces[] before dispatching. NEVER emit "MCP unavailable" callouts when prefs + reachable show the served_by is connected.

calendar served-by apple-mcp-uuid; chat served-by apple-mcp-uuid; github served-by github; messages served-by apple-mcp-uuid

VOICE (NON-NEGOTIABLE): apply spice/cowork/context/user-preferences.md personality.notes verbatim AND personality.{vibe, formality, length, pep_talk}. Reflective, warm, narrative-leaning; lean into journal-like cadence for personal scope.

MICROSCOPES (NON-NEGOTIABLE): for each kind in priorities, READ spice/cowork/prompts/per-mcp/<kind>/microscope.md and follow its ## Output shape directives verbatim. Resolve display names via people-aliases.md. Emit **[[Person Basename]]** for every inner-circle hit.

SUB-SKILL (NON-NEGOTIABLE): invoke cowork:write-run-note-monthly-review. v0.91.1 + v0.91.2 + v0.91.3 + v0.92.0 write-guards enforce path + frontmatter + dvjs + body-shape at write time:
  failed:contract-violation:wrong-output-path
  failed:contract-violation:wrong-frontmatter:<field>
  failed:contract-violation:body-missing-navbuttons
  failed:contract-violation:body-shape:<reason>
on any miss.

TONE: Longest-arc view; month's wins/misses, projects landed, what's on the next-month board.

When the orchestrator instructs you to use ANY sub-skill (cowork:write-run-note-*, cowork:gather-*, etc.), READ that sub-skill's SKILL.md from .claude/skills/cowork/skills/<name>/ IN FULL and strictly follow ALL sections including any ## Pre-write self-check checklist. Return failed:contract-violation:<field> on any miss.
````

---
