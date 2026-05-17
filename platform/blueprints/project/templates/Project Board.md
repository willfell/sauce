---

kanban-plugin: board
title: {{prompts.name}} Board
type: kanban
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - project/{{prompts.slug}}

---

## In Planning

## In Progress

## Blocked

## Completed

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false],"mark-cards-complete":true,"new-note-folder":"spice/projects/{{prompts.slug}}/tasks","new-note-template":"{{templates_path}}/Template, Kanban Card.md"}
```
%%
