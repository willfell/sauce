---
type: section-hub
project: "[[{{current_file.frontmatter.project_name}}]]"
project_slug: {{current_file.frontmatter.project_slug}}
section: {{prompts.name}}
section_slug: {{prompts.slug}}
parent_section: "{{prompts.parent_section}}"
depth: {{prompts.depth|number}}
created_at: "{{now.YYYY-MM-DDTHH:mm:ssZ}}"
tags:
  - section-hub
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SectionHub" });
```
