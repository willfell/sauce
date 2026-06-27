```dataviewjs
await customJS.Bad.render(dv);
await dv.view("ranch/views/customjs-guard", { class: "P", args: [{ p: dv.current().file.path }] });
```
