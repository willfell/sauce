# Working Style

> [!info] User-managed
> Captures the owner's preferred work cadence so cron-fired Claude can frame output appropriately (morning briefing energy, EOD reflection depth, weekly review pacing).

## Daily Routines

- **Wake / focus block 1:** {{morning_focus_window}}
- **Mid-day:** {{midday_routine}}
- **Evening / focus block 2:** {{evening_focus_window}}
- **Sleep target:** {{sleep_target}}

## Focus Blocks

Cron-fired output should respect these protected windows. Don't schedule new threads to surface during a focus block; surface in the next briefing window after.

| Window               | Purpose                              | Notes |
|:---------------------|:-------------------------------------|:------|
| {{focus_block_1_window}} | {{focus_block_1_purpose}}        | {{focus_block_1_notes}} |
| {{focus_block_2_window}} | {{focus_block_2_purpose}}        | {{focus_block_2_notes}} |

## Output Preferences

- **Default format:** Markdown.
- **Length:** Concise. Short outputs unless detail is explicitly requested.
- **Tone:** See `brand-voice.md`.

## File Handling

- Tell the owner what's about to be created and where before doing it.
- Never delete user content when patching daily callouts.
- Never overwrite a user-managed context file.

## How the Owner Likes to Work

- Start with questions, not outputs.
- Iterate. First draft doesn't need to be perfect.
- If something isn't working, say so. Don't keep going down a bad path.
- Owner would rather you ask a dumb question than make a wrong assumption.
