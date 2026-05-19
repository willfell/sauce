```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

---

## Status

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectStatusWidget" });
```

---

## Workstreams

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectWorkstreamManager" });
```

---

## Mentions

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "BacklinkPanel",
  method: "render",
  args: [{ entityType: "project", groupBy: "type" }]
});
```

---

> [!example]- Project Notes & Referenced By
>
> #### Project Notes
> ```dataviewjs
> await dv.view("ranch/views/customjs-guard", { class: "ProjectNotesCards" });
> ```
>
> #### Referenced By
> ```dataviewjs
> await dv.view("ranch/views/customjs-guard", { class: "ProjectReferencedByCards" });
> ```
