```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```

<!-- lint-note-chrome:allow kanban column heading is plugin state -->
## In Planning

<!-- lint-note-chrome:allow kanban column heading is plugin state -->
## In Progress

<!-- lint-note-chrome:allow kanban column heading is plugin state -->
## Blocked

<!-- lint-note-chrome:allow kanban column heading is plugin state -->
## Completed

%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false],"mark-cards-complete":true,"new-note-folder":"{{current_file.folder}}/tasks/{{prompts.name|sanitize-filename}}/board","new-note-template":"{{templates_path}}/Template, Slice Card.md"}
```
%%
