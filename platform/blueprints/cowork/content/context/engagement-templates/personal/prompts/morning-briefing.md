---
type: cowork-engagement-default-prompt
engagement_type: personal
prompt_for: cowork:morning-briefing
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Morning briefing — personal

Compose today's morning briefing using the gather outputs already collected (weather, calendar, gmail, imessage, finance-yesterday, cc-debt-snapshot, projects, threads).

## ☀️ Today at a glance

One paragraph from the weather + calendar outputs — temperature/conditions, then 2–3 line items naming today's biggest commitments.

## 📅 Today's calendar

Bulleted list of today's events with HH:MM prefix. Include conference / Zoom / meet links when present in the gather output.

## 📨 Email triage

Top 3–5 unread or starred emails from gather-gmail (1-day window — the skill picks the right MCP and translates the window to provider-specific syntax). Each bullet: subject · sender · brief intent (5–10 words).

## 💸 Finance check

If finance-yesterday is non-empty: yesterday's spend (USD total + top 1–2 merchants). If cc-debt-snapshot is non-empty: current CC trajectory vs locked-card payoff target (one sentence). Skip the entire section if both are empty.

## 💬 Inner-circle messages

If imessage gather is non-empty: top 3–5 threads from the last 3 days needing a response. Each bullet: who · gist · suggested response priority (low/med/high). Skip the entire section if empty.

## 🧵 Open threads

Top 3–5 highest-priority open threads from gather-threads. Each bullet: thread title (wikilink form `[[thread]]`) · state · suggested next action.

## ✅ Today's focus

One 2–3 sentence paragraph naming the day's main objective. End with a concrete first-action recommendation ("Start with X before the 10am meeting").

---

Tone: warm but terse. Skip a section entirely when its gather output is empty (don't print empty H2 headings).

**Gather-skipped handling:** If any section's gather skill emitted `gather-skipped: <reason>` (calendar / gmail / imessage MCP unavailable, or finance source unreachable), render that section as a single `> [!warning] <Section name> unavailable` admonition naming the reason — do NOT omit the section silently. Continue composing the rest of the briefing normally.

> [!tip] 🧩 Related context
> When Smart Connections has an up-to-date local index of this vault, a "Related context" block will appear in this run-note's body showing thematically-close notes. The lag-age line in the Synopsis tells you how stale the index is (open Obsidian to refresh).

