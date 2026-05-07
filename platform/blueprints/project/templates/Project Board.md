---

kanban-plugin: board
title: {{NAME}} Board
type: kanban
tags:
  - board
  - project/{{SLUG}}

---

## In Planning

## In Progress

## Blocked

## Completed

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false],"mark-cards-complete":true,"new-note-folder":"spice/projects/{{SLUG}}/tasks","new-note-template":"{{templates_path}}/Template, Kanban Card.md"}
```
%%
