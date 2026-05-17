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

    // --- Vault-scan fallback (v0.49.2 behavior; cold-cache safety net) ---
    const candidates = [];
    const files = app.vault.getMarkdownFiles();
    for (const f of files) {
        const cache = app.metadataCache.getFileCache(f);
        const isKanban = cache?.frontmatter?.["kanban-plugin"] === "board"
            || f.path.endsWith("-board.md");
        if (!isKanban) continue;
        try {
            const body = await app.vault.read(f);
            if (body.includes(`[[${title}]]`)) {
                candidates.push({ path: f.path, mtime: f.stat?.mtime || 0 });
            }
        } catch (_) { /* ignore unreadable */ }
    }
    if (candidates.length === 0) return "";
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0].path;
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
// Idempotent: skips if target already exists. If source board not
// detected (e.g., card created from a non-project kanban board),
// auto-promote silently skips.
const sourceParts = activePath.split("/");
const projectsIdx = sourceParts.indexOf("projects");
if (projectsIdx >= 0 && projectsIdx + 1 < sourceParts.length) {
    const projectDir = sourceParts.slice(0, projectsIdx + 2).join("/");
    const fileName = tp.file.title;
    const newTargetPath = `${projectDir}/tasks/${fileName}/${fileName}`;
    const existing = app.vault.getAbstractFileByPath(newTargetPath + ".md");
    if (!existing) {
        await tp.file.move(newTargetPath);
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
