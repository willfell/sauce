---
type: cowork-engagement-default-prompt
engagement_type: consulting
prompt_for: cowork:morning-briefing
updated: 2026-05-20
updated_by: cowork@0.11.0 installer
---

# Morning briefing — consulting

Compose today's morning briefing for the consulting engagement using the gather outputs (calendar scoped to `calendar_id`, gmail scoped to `gmail_label`, projects, finance-yesterday + cc-debt-snapshot if finance_block: include, threads). Body shape:

## ☀️ Today at a glance

One paragraph — today's headline commitment for the client + tone of the day, drawn from calendar + projects gather outputs.

## 📅 Today's calendar

Bulleted list of today's events with HH:MM prefix. Annotate each with `[client:<primary_client>]`. Include conference links.

## 📨 Client communication triage

Top 3–5 unread or starred emails from gather-gmail (scoped to the engagement's `gmail_label`, often `Clients/<name>`). Each bullet: subject · sender · brief intent. Highlight `stakeholders[]` and `ap_email` senders.

## 📊 Project status

From gather-projects (kanban_projects: include): top 3–5 cards in progress or blocked for this client. Each bullet: project name (wikilink) · status · next action.

## 💰 Billing-day check

If today is at or near `billing_anchor_day` for the engagement's `invoice_cadence`, note "Invoice prep due — consider running cowork:weekly-review with invoice block". One sentence; skip section otherwise.

## 🧵 Open threads

Top 3–5 open threads tagged to this engagement. Each bullet: thread title (wikilink) · state · suggested next action.

## ✅ Today's focus

One 2–3 sentence paragraph naming the day's main deliverable for the client. End with a concrete first-action recommendation.

---

Tone: professional. The consulting morning is billing-aware — flag billing-day proximity for invoice prep planning.
