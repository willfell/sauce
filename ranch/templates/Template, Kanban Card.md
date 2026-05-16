<%*
// Use target_file (the note being created) — most reliable in Templater new-file context
const targetPath = tp.config.target_file?.path || "";
const activePath = app.workspace.getActiveFile()?.path || "";
const detectPath = targetPath || activePath;
const sourceBoard = activePath || targetPath;

// Workstream picker: detect project dir and read atlas note directly
let workstreamValue = "";
const parts = detectPath.split("/");
const planIdx = parts.indexOf("projects");
if (planIdx >= 0 && planIdx + 1 < parts.length) {
    const projectDir = parts.slice(0, planIdx + 2).join("/");

    // Find atlas note: in project root, not tasks/, not board, not map
    const candidates = app.vault.getFiles().filter(f =>
        f.extension === "md" &&
        f.path.startsWith(projectDir + "/") &&
        !f.path.includes("/tasks/") &&
        !f.path.includes("/resources/") &&
        !f.basename.endsWith("-board") &&
        !f.basename.includes("Map")
    );

    const atlasNote = candidates.find(f => {
        const c = app.metadataCache.getFileCache(f);
        return c?.frontmatter?.tags?.includes?.("project");
    }) || candidates[0];

    if (atlasNote) {
        let ws = [];
        try {
            // Strategy 1: metadata cache
            const cache = app.metadataCache.getFileCache(atlasNote);
            let raw = cache?.frontmatter?.workstreams;
            if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch(e) {} }
            if (Array.isArray(raw)) ws = raw.filter(w => w.id && w.name);

            // Strategy 2: processFrontMatter
            if (ws.length === 0) {
                await new Promise((resolve) => {
                    app.fileManager.processFrontMatter(atlasNote, (fm) => {
                        let val = fm.workstreams;
                        if (typeof val === "string") { try { val = JSON.parse(val); } catch(e) {} }
                        if (Array.isArray(val)) ws = val.filter(w => w.id && w.name);
                    });
                    resolve();
                });
            }

            // Strategy 3: raw file read + regex
            if (ws.length === 0) {
                const content = await app.vault.read(atlasNote);
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                const yaml = fmMatch?.[1] || "";
                const wsStart = yaml.indexOf("workstreams:");
                if (wsStart >= 0) {
                    const wsBlock = yaml.substring(wsStart);
                    const items = [...wsBlock.matchAll(/- id:\s*(\S+)\s*\n\s*name:\s*["']?([^"'\n]+)["']?/g)];
                    ws = items.map(m => ({ id: m[1].trim(), name: m[2].trim() }));
                }
            }
        } catch(e) { /* all strategies failed */ }

        if (ws.length === 0) {
            new Notice("No workstreams defined on this project's atlas. Define one (or pick '+ Create new' on next task) to enable workstream tagging.", 8000);
        } else if (ws.length > 0) {
            const names = ws.map(w => w.name);
            const ids = ws.map(w => w.id);
            const CREATE_NEW = '__create_new__';
            names.push('+ Create new workstream');
            ids.push(CREATE_NEW);
            const picked = await tp.system.suggester(names, ids, false, "Select workstream (Esc to skip)");
            if (picked === CREATE_NEW) {
                const newName = await tp.system.prompt("New workstream name");
                if (newName && newName.trim()) {
                    const trimmedName = newName.trim();
                    const newSlug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (newSlug && !ws.find(w => w.id === newSlug)) {
                        await app.fileManager.processFrontMatter(atlasNote, fm => {
                            fm.workstreams = [...(fm.workstreams || []), { id: newSlug, name: trimmedName }];
                        });
                        workstreamValue = newSlug;
                        new Notice(`Workstream added: ${trimmedName}`);
                    } else if (newSlug) {
                        // Re-use existing id with same slug (idempotency)
                        workstreamValue = newSlug;
                    }
                }
            } else if (picked) {
                workstreamValue = picked;
            }
        }
    }
}
-%>
---
created: <% tp.file.creation_date("YYYY-MM-DD HH:mm") %>
source_board: <% sourceBoard %>
workstream: <% workstreamValue %>
tags:
  - kanban-card
  - project-card
  - <% tp.date.now("YYYY/MM/DD") %>
---
<%*
// Auto-promote into per-task folder convention.
// Kanban creates the file flat at spice/projects/<slug>/tasks/<TaskName>.md.
// Move it into spice/projects/<slug>/tasks/<TaskName>/<TaskName>.md so the task
// note and any sub-notes live together. Idempotent: skips if already inside a
// folder of the same name, or if the target file already exists.
const newFilePath = tp.config.target_file?.path || "";
if (newFilePath.includes("/tasks/")) {
    const fileName = tp.file.title;
    const folder = newFilePath.substring(0, newFilePath.lastIndexOf("/"));
    const folderBasename = folder.substring(folder.lastIndexOf("/") + 1);
    if (folderBasename !== fileName) {
        const targetPath = folder + "/" + fileName + "/" + fileName;
        const existing = app.vault.getAbstractFileByPath(targetPath + ".md");
        if (!existing) {
            await tp.file.move(targetPath);
        }
    }
}
-%>

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectNavButtons" });
```
