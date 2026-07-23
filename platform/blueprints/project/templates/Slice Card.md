---
<%*
const targetPath = tp.config.target_file?.path || tp.file.path(true) || "";
const targetFile = tp.config.target_file
    || (typeof tp.file.find_tfile === "function" ? tp.file.find_tfile(tp.file.path(true)) : null);
function canonicalEpicBoardPath(notePath) {
    const normalized = String(notePath || "").replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length < 4 || parts[parts.length - 2] !== "board") return "";
    const epicName = parts[parts.length - 3];
    return `${parts.slice(0, -1).join("/")}/${epicName}-board.md`;
}
function canonicalEpicBoardInfo(file) {
    if (!file?.path) return null;
    const normalized = String(file.path).replace(/\\/g, "/");
    const match = normalized.match(/^spice\/projects\/[^/]+\/tasks\/([^/]+)\/board\/([^/]+)-board\.md$/);
    if (!match || match[1] !== match[2]) return null;
    const fm = app.metadataCache?.getFileCache(file)?.frontmatter || {};
    if (fm["kanban-plugin"] !== "board" || fm.board_role !== "epic") return null;
    const linkedEpic = String(fm.epic || "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|").pop();
    if (linkedEpic && linkedEpic !== match[1]) return null;
    return {
        path: normalized,
        epicName: match[1],
        epicAtlas: normalized.replace(/\/board\/[^/]+-board\.md$/, `/${match[1]}.md`),
        boardDir: normalized.substring(0, normalized.lastIndexOf("/")),
        file,
    };
}
function visibleFailure(message) {
    try { if (typeof Notice !== "undefined") new Notice(message, 8000); } catch (_) {}
    throw new Error(message);
}
async function findSourceEpicBoard() {
    const expected = canonicalEpicBoardPath(targetPath);
    if (expected) {
        const expectedInfo = canonicalEpicBoardInfo(app.vault.getAbstractFileByPath(expected));
        if (expectedInfo) return expectedInfo;
        visibleFailure(`Canonical epic board missing or invalid: ${expected}`);
    }

    const allCanonical = (app.vault.getMarkdownFiles?.() || [])
        .map(canonicalEpicBoardInfo)
        .filter(Boolean);
    const selectOnly = (candidates, evidence) => {
        const unique = [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
        if (unique.length === 1) return unique[0];
        if (unique.length > 1) {
            visibleFailure(`Ambiguous canonical epic boards from ${evidence}: ${unique.map((item) => item.path).join(", ")}`);
        }
        return null;
    };

    if (targetFile && app.metadataCache?.getBacklinksForFile) {
        try {
            const backlinks = app.metadataCache.getBacklinksForFile(targetFile);
            const backlinkPaths = backlinks?.data ? Object.keys(backlinks.data) : [];
            const backlinkCandidates = backlinkPaths
                .map((candidate) => canonicalEpicBoardInfo(app.vault.getAbstractFileByPath(candidate)))
                .filter(Boolean);
            const selected = selectOnly(backlinkCandidates, "backlinks");
            if (selected) return selected;
        } catch (error) {
            if (/^Ambiguous canonical epic boards/.test(String(error?.message || error))) throw error;
        }
    }

    const linkedCandidates = [];
    for (const candidate of allCanonical) {
        try {
            const body = await app.vault.read(candidate.file);
            if (body.includes(`[[${tp.file.title}]]`)) linkedCandidates.push(candidate);
        } catch (_) {}
    }
    const linked = selectOnly(linkedCandidates, "persisted board links");
    if (linked) return linked;

    const targetTime = Number(targetFile?.stat?.ctime || targetFile?.stat?.mtime || 0);
    const recentCandidates = targetTime > 0
        ? allCanonical.filter((candidate) => {
            const boardTime = Number(candidate.file?.stat?.mtime || 0);
            return boardTime > 0 && Math.abs(targetTime - boardTime) <= 15000;
        })
        : [];
    const recent = selectOnly(recentCandidates, "the Kanban creation window");
    if (recent) return recent;

    visibleFailure(`Cannot recover one canonical source epic board for root-created slice: ${targetPath || tp.file.title}`);
}
const source = await findSourceEpicBoard();
const sourceBoard = source.path;
const epicName = source.epicName;
const epicAtlas = source.epicAtlas;
const destination = `${source.boardDir}/${tp.file.title}.md`;
if (String(targetPath).replace(/\\/g, "/") !== destination) {
    const collision = app.vault.getAbstractFileByPath(destination);
    if (collision && collision !== targetFile) {
        visibleFailure(`Canonical slice destination already exists: ${destination}`);
    }
    await tp.file.move(destination.replace(/\.md$/, ""));
}
const alias = epicName ? `${epicName}: ${tp.file.title}` : tp.file.title;
-%>
type: slice
schema_version: 1.1.0
created_at: "<% tp.file.creation_date("YYYY-MM-DDTHH:mm:ssZ") %>"
epic: "[[<% epicName %>]]"
task_parent: <% epicAtlas %>
source_board: <% sourceBoard %>
kanban_board: <% sourceBoard %>
status: planning
depends_on: []
aliases:
  - "<% alias %>"
tags:
  - slice
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ProjectChromeBar" });
```
