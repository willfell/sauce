# Task notes design

Approved by Will on 2026-11-12, in chat.

## Why

In one week in accuris, 38 subtasks were really notes about their task, not steps of it. They were named Prompt, Handoff Prompt, Proposed Plan, Plan, Questions, Context and Explanation, plus analysis notes like CI Impact, CD Impact and Dead Code Findings. The work happens in agent sessions, and the task is where the brief, the handoff and what came back are kept. As subtasks they cost:

- 29 of the 38 were checked off just to clear them.
- They skew the progress ring.
- They need clash suffixes, as in `Prompt (Backup Script)`.
- They nest as subtasks of subtasks: Questions sits under Prompt.
- Pasting a prompt means opening the note and finding the block.

## Goals

- A task can hold notes that are not steps. Notes have no checkbox and no status, never count toward progress, and never list as to-dos.
- The card shows them and copies a prompt in one click.
- A new note starts blank under its header. (Until 2026-11-13 each kind had starter text; it was removed so notes start empty.)
- Agent sessions know where to write them.

## Non-goals (this release)

- Converting existing prompt-style subtasks into notes. That comes next, as a report you tick plus an in-app Apply, and it reuses this model.
- Notes on flat legacy tasks. Those have no folder; the folder migration covers them.

## Design

- **Path:** `spice/tasks/<Task>/notes/<Name>.md`, only under a task folder note. Notes move with the folder to `_done/` and `_trash/`.
- **Frontmatter:** `type: task-doc`, `kind`, `title`, `task: "[[<Task>]]"`, `created_at`.
  - Kinds are a fixed list: prompt, handoff, comms, plan, context, findings, questions, note. Comms (added 2026-11-13 at Will's request) holds the message to send others about the task; its card button is Copy message. Any other value reads as `note`. A fixed list was Claude's call; Will accepted the proposal without choosing.
  - Registered as `task-doc-frontmatter` in `platform/schemas-index.json`.
- **Names:** `TaskEntity.taskName(title, { parentTitle: task title })`, the same rule subtasks use.
- **Card:** a Notes section after Subtasks.
  - One row per note: kind icon, title, kind and age. Clicking a row opens the note.
  - Prompt and handoff rows have **Copy prompt**. It copies, in order of preference:
    1. a fenced block under a heading or callout titled "prompt";
    2. else the first text or untagged fence;
    3. else the body, minus frontmatter, code-run blocks, the header callout and the "Resume session" callout.
  - **+ Note** opens a kind menu, creates the note and opens it.
- **Templates:**
  - Every note starts with a header callout linking back to the task.
  - **Prompt:** a plain body.
  - **Handoff:** a Resume session callout and a `## Prompt to paste` text fence.
  - **Plan:** Goal, Approach, Steps, Risks.
  - **Context:** a Goal callout, Background, Links.
  - **Findings:** a Summary callout, Details.
  - **Questions:** Open questions, Answers.
  - **Note:** empty.
- **Breadcrumb:** `To-Do › <task>`, linked from `task:`.
- **Agents:** directory-map rows in the vault CLAUDE.md, contributed by task-entity's `claude_surface`. One names `spice/tasks/<Task>/notes/`; the other says never to write a flat `spice/tasks/<Title>.md`.
