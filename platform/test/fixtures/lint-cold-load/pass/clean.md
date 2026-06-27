```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Clean" });
await dv.view("ranch/views/customjs-guard", { class: "P", method: "r", args: [{ p: dv.current()?.file?.path }] });
```
