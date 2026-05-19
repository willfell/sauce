<%*
// Source-board detection. The obsidian-kanban plugin's flow for
// "+ Add a card" with new-note-template set:
//   1. Create empty new file (at vault root or new-note-folder)
//   2. Open the new file as the active leaf
//   3. Call templaterPlugin.append_template_to_active_file(template)
// By the time this template body runs, app.workspace.getActiveFile()
// IS the new file, and tp.config.active_file ALSO points at the new
// file (Templater's "active file" is whoever's active right now).
// The kanban board's source identity is LOST in this flow.
//
// v0.49.2 fix: detect source board by SCANNING THE VAULT for kanban-plugin
// boards that just got a link to the new card's title. When kanban-plugin
// adds a card, it appends [[<title>]] to the board's body — so we search
// for the board file that contains [[<title>]] and was most recently
// modified. This is robust to vault-root file placement, multiple open
// boards, and kanban-plugin's internal flow.
//
// v0.49.1 (superseded) tried tp.config.active_file which is the NEW file
// in this flow — symptom: card files landing at vault root with no
// workstream picker.
//
// v0.51.1 patch: cache-first via app.metadataCache.getBacklinksForFile;
// falls back to v0.49.2 vault-scan on cache miss. The cache path is O(K)
// where K = backlink count on the new file (usually 1), vs. the vault-scan's
// O(N) read of every kanban-plugin file body. Cache is identity-based, so
// title collisions across the vault resolve correctly. Fallback preserved
// byte-for-byte for cold-cache safety (kanban modifies the board immediately
// before invoking Templater; metadataCache reindex is event-driven and
// typically — but not guaranteed — current by template-run time).
async function _findSourceKanbanBoard(title) {
    if (!title) return "";

    // --- Strategy 0: directory-of-target sibling-board detection ---
    //
    // v0.59.11 fix: when kanban-plugin v2.0.51 creates the new file under
    // a board's `new-note-folder`, the new file ends up a SIBLING of its
    // source board (same parent directory). Detect this case by path —
    // it's bullet-proof against title collisions because the path is
    // unique even when the title isn't.
    //
    // Falls through when:
    //   (a) new file at vault root (Templater default placement)
    //   (b) multiple boards in same dir (ambiguous — Strategy 1/2 resolve)
    //   (c) zero boards in same dir (e.g. file already moved elsewhere)
    const newFileForStrategy0 = tp.config.target_file
        || tp.file.find_tfile(tp.file.path(true));
    if (newFileForStrategy0) {
        const targetPath = newFileForStrategy0.path || "";
        const lastSlash = targetPath.lastIndexOf("/");
        const targetDir = lastSlash >= 0 ? targetPath.substring(0, lastSlash) : "";
        if (targetDir) {
            const siblingBoards = app.vault.getMarkdownFiles().filter(f => {
                if (!f.path.startsWith(targetDir + "/")) return false;
                if (f.path === targetPath) return false;
                const rest = f.path.substring(targetDir.length + 1);
                if (rest.includes("/")) return false;
                const cache = app.metadataCache.getFileCache(f);
                return cache?.frontmatter?.["kanban-plugin"] === "board"
                    || f.path.endsWith("-board.md");
            });
            if (siblingBoards.length === 1) {
                return siblingBoards[0].path;
            }
        }
    }

    // --- Cache-first path: query indexed backlinks on the new file ---
    const newFile = tp.config.target_file
        || tp.file.find_tfile(tp.file.path(true));
    if (newFile) {
        try {
            const backlinks = app.metadataCache.getBacklinksForFile(newFile);
            const sources = backlinks?.data ? Object.keys(backlinks.data) : [];
            const cacheCandidates = [];
            for (const srcPath of sources) {
                const srcFile = app.vault.getAbstractFileByPath(srcPath);
                if (!srcFile || !srcFile.stat) continue;
                const cache = app.metadataCache.getFileCache(srcFile);
                const isKanban = cache?.frontmatter?.["kanban-plugin"] === "board"
                    || srcPath.endsWith("-board.md");
                if (isKanban) {
                    cacheCandidates.push({ path: srcPath, mtime: srcFile.stat.mtime || 0 });
                }
            }
            if (cacheCandidates.length > 0) {
                cacheCandidates.sort((a, b) => b.mtime - a.mtime);
                return cacheCandidates[0].path;
            }
        } catch (_) { /* cache path failed; fall through to vault scan */ }
    }

    // --- Vault-scan: prefer boards that contain [[title]], fall back to mtime ---
    //
    // v0.56.2 PATCH: kanban-plugin v2.0.51's actual flow (verified by reading
    // main.js around the `yb()` template-apply helper) is:
    //   1. createNewMarkdownFile(folder, title)   ← new file created
    //   2. openFile(newFile)                      ← made active leaf
    //   3. yb(stateManager, templatePath)         ← Templater fires HERE
    //   4. n.updateItem(r, updateItemContent(t, "[[link]]"))
    //                                             ← board's card text becomes [[title]]
    //
    // The `[[<title>]]` link is written to the board AFTER Templater finishes.
    // The v0.49.2 vault-scan `body.includes("[[<title>]]")` never matched
    // because the link wasn't there yet — every new card ended up with the
    // sourceBoard fallback to the new file's own path, no auto-promote,
    // orphaned at vault root.
    //
    // New strategy: enumerate kanban boards, prefer the one with [[title]]
    // (covers the "card already existed before file creation" path used by
    // the right-click "New note from card" menu), fall back to the
    // most-recently-modified kanban board (covers the inline "+ Add a card"
    // flow where the board mtime got bumped by the in-progress card edit
    // even if [[title]] isn't yet on disk).
    const allKanbanBoards = [];
    const linkedKanbanBoards = [];
    const files = app.vault.getMarkdownFiles();
    for (const f of files) {
        const cache = app.metadataCache.getFileCache(f);
        const isKanban = cache?.frontmatter?.["kanban-plugin"] === "board"
            || f.path.endsWith("-board.md");
        if (!isKanban) continue;
        const mtime = f.stat?.mtime || 0;
        allKanbanBoards.push({ path: f.path, mtime });
        try {
            const body = await app.vault.read(f);
            if (body.includes(`[[${title}]]`)) {
                linkedKanbanBoards.push({ path: f.path, mtime });
            }
        } catch (_) { /* ignore unreadable */ }
    }
    if (linkedKanbanBoards.length > 0) {
        linkedKanbanBoards.sort((a, b) => b.mtime - a.mtime);
        return linkedKanbanBoards[0].path;
    }
    if (allKanbanBoards.length === 0) return "";
    allKanbanBoards.sort((a, b) => b.mtime - a.mtime);
    return allKanbanBoards[0].path;
}
const targetPath = tp.config.target_file?.path || "";
const activePath = await _findSourceKanbanBoard(tp.file.title)
    || tp.config.active_file?.path
    || app.workspace.getActiveFile()?.path
    || "";
const detectPath = activePath || targetPath;
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

    // v0.56.1 PATCH (FA-3 fallout): the FA-3 migration stripped the `project`
    // discriminator tag from atlas frontmatter, so tag-based detection picks
    // candidates[0] which is often `docs/Docs.md` → workstream picker reads
    // the wrong file → "No workstreams defined" Notice on every new card.
    // Now reads canonical `type: "project"` first, falls back to legacy tag.
    const atlasNote = candidates.find(f => {
        const fm = app.metadataCache.getFileCache(f)?.frontmatter || {};
        const tags = fm.tags || [];
        return fm.type === "project"
            || (Array.isArray(tags) && tags.includes("project"));
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
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
source_board: <% sourceBoard %>
workstream: <% workstreamValue %>
tags:
  - kanban-card
  - project-card
---
<%*
// Auto-promote into per-task folder convention.
//
// v0.49.2 fix: reuses the source-board path detected in the top block
// via vault scan (`activePath` from above). When the source board is
// under spice/projects/<slug>/, moves the new file (wherever Templater
// placed it — typically vault root) to <projectDir>/tasks/<title>/<title>.md.
//
// v0.49.1 (superseded) used tp.config.active_file which is the NEW
// file in the kanban-plugin → Templater flow — symptom: auto-promote
// never fired, file stayed at vault root.
//
// v0.59.11 fix: name-collision disambiguation. When the per-task folder
// + file already exists (most often: another task with the same title in
// this same project, or sometimes a different project routed wrongly by
// source-board detection), append `-2`, `-3`, ... until a free slot is
// found. Surface the rename via Notice so the user knows. Bound the loop
// at 999 — pathologically deep collisions stop the move rather than
// looping forever.
const sourceParts = activePath.split("/");
const projectsIdx = sourceParts.indexOf("projects");
if (projectsIdx >= 0 && projectsIdx + 1 < sourceParts.length) {
    const projectDir = sourceParts.slice(0, projectsIdx + 2).join("/");
    const fileName = tp.file.title;
    let chosenName = fileName;
    let suffix = 2;
    while (
        app.vault.getAbstractFileByPath(`${projectDir}/tasks/${chosenName}/${chosenName}.md`)
        && suffix <= 999
    ) {
        chosenName = `${fileName}-${suffix}`;
        suffix++;
    }
    const newTargetPath = `${projectDir}/tasks/${chosenName}/${chosenName}`;
    if (!app.vault.getAbstractFileByPath(newTargetPath + ".md")) {
        await tp.file.move(newTargetPath);
        if (chosenName !== fileName) {
            new Notice(`Task name "${fileName}" already exists in this project. Saved as "${chosenName}".`, 6000);
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
