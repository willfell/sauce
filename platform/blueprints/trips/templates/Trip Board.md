---

kanban-plugin: board
title: {{NAME}}
type: kanban
tags:
  - board
  - trip/{{SLUG}}

---

## To Do

## In Progress

## Completed

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false],"mark-cards-complete":true,"new-note-folder":"beacon/trips/{{SLUG}}/board","new-note-template":"{{templates_path}}/Template, Trip Board Card.md"}
```
%%
