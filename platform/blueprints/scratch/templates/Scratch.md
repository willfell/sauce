---
created: <% tp.date.now("YYYY-MM-DDTHH:mm:ss") %>
type: scratch
day: <% tp.date.now("YYYY-MM-DD") %>
time: <% tp.date.now("HH:mm") %>
day_link: "[[<% tp.date.now("dddd") %>-<% tp.date.now("YYYY-MM-DD") %>]]"
---

<%*
const dayName = tp.date.now("dddd");
const dayDate = tp.date.now("YYYY-MM-DD");
const monthFolder = tp.date.now("YYYY/MM-MMMM");
const dayFolder = `spice/scratch/${monthFolder}/${dayDate}`;
const dayIndexPath = `${dayFolder}/${dayName}-${dayDate}.md`;
if (!app.vault.getAbstractFileByPath(dayIndexPath)) {
  try {
    const dayTpl = tp.file.find_tfile("Scratch Day.md");
    const folderTFile = app.vault.getAbstractFileByPath(dayFolder);
    await tp.file.create_new(dayTpl, `${dayName}-${dayDate}`, false, folderTFile);
  } catch (e) {
    // concurrent create or already exists — fine.
  }
}
%>

```dataviewjs
await dv.view("{{views_path}}/customjs-guard", { class: "SpaceNavButtons" });
```

---



---

← [[<% tp.date.now("dddd") %>-<% tp.date.now("YYYY-MM-DD") %>|Back to day]] · [[Scratch|Hub]]
