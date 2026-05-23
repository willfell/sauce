---
type: cowork-engagement-default-prompt
engagement_type: w2-fte
prompt_for: cowork:morning-briefing
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Morning briefing — w2-fte

Compose today's morning briefing for the w2 engagement using the gather outputs (calendar scoped to `calendar_id`, gmail scoped to `gmail_label`, projects with kanban_projects: include, threads).

## Today at a glance

One paragraph — today's headline meeting + tone of the day (light vs back-to-back) drawn from calendar + projects gather outputs.

## Today's calendar

Bulleted list of today's events with HH:MM prefix. Annotate each with `[w2:<employer>]` when calendar is shared across engagements. Include conference links.

## Email triage (work scope)

Top 3–5 unread or starred emails from gather-gmail (scoped to the engagement's `gmail_label`). Each bullet: subject · sender · brief intent (5–10 words). Highlight any from `stakeholders[]` or `manager`.

## Project status briefing

From gather-projects (kanban_projects: include): top 3–5 cards in progress or blocked. Each bullet: project name (wikilink) · status · next action.

## Open threads

Top 3–5 open threads tagged to this engagement. Each bullet: thread title (wikilink) · state · suggested next action.

## Today's focus

One 2–3 sentence paragraph naming the day's main deliverable for the w2 role. End with a concrete first-action recommendation.

---

Tone: professional but human. Skip a section entirely when its gather output is empty. Don't include personal-life content (no finance, no inner-circle imessage — engagement-type's render_aspects skip those).

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (e.g. the calendar MCP was unavailable in this runtime), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.

> [!tip] Related context
> When Smart Connections has an up-to-date local index of this vault, a "Related context" block will appear in this run-note's body showing thematically-close notes. The lag-age line in the Synopsis tells you how stale the index is (open Obsidian to refresh).

