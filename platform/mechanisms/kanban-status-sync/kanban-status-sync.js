/**
 * kanban-status-sync@0.1.0 — reconciles kanban card-note frontmatter against
 * the card's current column in its obsidian-kanban board.
 *
 * Loaded via customjs-guard (avoids landmines #1 / #2 cold-load TDZ). Three
 * closure args are visible in scope per the loader contract: `app`, `customJS`,
 * `Notice`. `app.fileManager.processFrontMatter` is read at call-time inside
 * syncBoard, never at class-load.
 *
 * Public API (instance methods on customJS.KanbanStatusSync):
 *   async syncAllBoards(dv, today) → { synced: number, archived: number, boards: number }
 *   async syncBoard(boardPath, today)  → { synced: number, archived: number }
 *
 * Pure static helpers (Node-testable):
 *   KanbanStatusSync.parseBoardColumns(boardSrc) → { [cardLinkpath]: columnName }
 *   KanbanStatusSync.slugifyStatus(name)         → string (lowercase, hyphenated)
 *   KanbanStatusSync.computeDiff(curMap, prior)  → { moves, creates, archives }
 *
 * NEVER reads the mtime property off a TFile (mobile sync time, unreliable — landmine #23).
 * Frontmatter writes use app.fileManager.processFrontMatter (atomic).
 */
class KanbanStatusSync {
  /**
   * Discover every kanban board (file with frontmatter `kanban-plugin: board`)
   * and sync each card's frontmatter to its current column.
   *
   * Returns { synced, archived, boards } aggregated across all boards.
   *
   * v0.1.1 (sauce v0.72.1): cached at most once per (today, customjs-singleton
   * lifetime). The daily/weekly dashboard re-renders whenever Dataview re-indexes
   * the vault — on a vault with many cards, the first-day sync (e.g., 283 cards)
   * is followed by a cascade of re-renders that each call syncAllBoards. The
   * forward pass is idempotent and writes zero on those re-renders, but each
   * still iterates every card on every board. The cache returns the prior
   * result instantly. Cards moved in the same session won't be picked up until
   * the next day OR until the CustomJS plugin is toggled off/on (which clears
   * the singleton instance).
   */
  async syncAllBoards(dv, today) {
    if (this._lastSyncDay === today && this._lastSyncResult) {
      return this._lastSyncResult;
    }
    if (!dv || typeof dv.pages !== "function") {
      return { synced: 0, archived: 0, boards: 0 };
    }
    // Dataview field access for hyphenated frontmatter keys uses bracket form.
    const boards = dv.pages().where(p => p && p["kanban-plugin"] === "board").array();
    let synced = 0;
    let archived = 0;
    for (const board of boards) {
      if (!board.file || !board.file.path) continue;
      try {
        const r = await this.syncBoard(board.file.path, today);
        synced += r.synced || 0;
        archived += r.archived || 0;
      } catch (e) {
        if (typeof console !== "undefined") {
          console.warn("[kanban-status-sync] syncBoard failed for " + board.file.path + ": " + (e && e.message));
        }
      }
    }
    const result = { synced, archived, boards: boards.length };
    this._lastSyncDay = today;
    this._lastSyncResult = result;
    return result;
  }

  /**
   * Sync one board file.
   *
   * Forward pass: walk each card in the board, write frontmatter if column changed.
   * Reverse pass: query dv for cards previously linked to this board but missing
   *               from the current placement; mark archived.
   */
  async syncBoard(boardPath, today) {
    if (!app || !app.vault || !app.metadataCache) return { synced: 0, archived: 0 };
    const boardFile = app.vault.getAbstractFileByPath(boardPath);
    if (!boardFile || !("extension" in boardFile)) return { synced: 0, archived: 0 };

    const boardSrc = await app.vault.read(boardFile);
    const currentMap = KanbanStatusSync.parseBoardColumns(boardSrc);

    // Resolve linkpaths → vault paths via metadataCache (sourcePath = boardPath).
    const resolved = {};
    for (const linkpath of Object.keys(currentMap)) {
      const dest = app.metadataCache.getFirstLinkpathDest(linkpath, boardPath);
      if (dest && dest.path) {
        resolved[dest.path] = currentMap[linkpath];
      } else if (typeof console !== "undefined") {
        console.warn("[kanban-status-sync] unresolved wikilink '" + linkpath + "' in board " + boardPath);
      }
    }

    let synced = 0;
    let archived = 0;

    // Forward pass.
    for (const cardPath of Object.keys(resolved)) {
      const cardFile = app.vault.getAbstractFileByPath(cardPath);
      if (!cardFile) continue;
      const cache = app.metadataCache.getFileCache(cardFile) || {};
      const fm = cache.frontmatter || {};
      const desired = KanbanStatusSync.slugifyStatus(resolved[cardPath]);
      const sameBoard = fm.kanban_board === boardPath;
      const sameStatus = fm.status === desired;
      if (sameBoard && sameStatus) continue;
      const prev = (typeof fm.status === "string") ? fm.status : null;
      await app.fileManager.processFrontMatter(cardFile, (cur) => {
        cur.kanban_board = boardPath;
        cur.kanban_column = resolved[cardPath];
        cur.status_prev = prev;
        cur.status = desired;
        cur.status_changed_at = today;
      });
      synced++;
    }

    // Reverse pass: cards previously tracked to this board but now missing.
    let dvApi = null;
    if (typeof window !== "undefined" && window.app && window.app.plugins &&
        window.app.plugins.plugins && window.app.plugins.plugins.dataview) {
      dvApi = window.app.plugins.plugins.dataview.api;
    }
    if (dvApi && typeof dvApi.pages === "function") {
      const orphans = dvApi.pages()
        .where(p => p && p.kanban_board === boardPath && p.status !== "archived")
        .array();
      for (const p of orphans) {
        if (!p.file || !p.file.path) continue;
        if (Object.prototype.hasOwnProperty.call(resolved, p.file.path)) continue;
        const cardFile = app.vault.getAbstractFileByPath(p.file.path);
        if (!cardFile) continue;
        const cache = app.metadataCache.getFileCache(cardFile) || {};
        const fm = cache.frontmatter || {};
        const prev = (typeof fm.status === "string") ? fm.status : null;
        await app.fileManager.processFrontMatter(cardFile, (cur) => {
          cur.status_prev = prev;
          cur.status = "archived";
          cur.kanban_column = null;
          cur.status_changed_at = today;
        });
        archived++;
      }
    }
    return { synced, archived };
  }
  /**
   * Parse an obsidian-kanban board's markdown source into a {cardLinkpath: columnName} map.
   * - Skips YAML frontmatter at the top of the file.
   * - A column is a depth-2 heading: `## ColumnName`.
   * - Cards are `[[wikilink]]` occurrences inside list items (`- [[...]]` or
   *   `- [[path|alias]]`) under a column heading. Bare wikilinks (not in a
   *   list item) are NOT cards — obsidian-kanban writes cards only as list items,
   *   and bare links inside a column are typically prose / descriptions.
   * - For `[[path/to/card|Alias]]`, the linkpath (left of `|`, before any `#`) is stored.
   * - Wikilinks outside any column are ignored.
   */
  static parseBoardColumns(boardSrc) {
    if (typeof boardSrc !== "string" || boardSrc.length === 0) return {};
    const lines = boardSrc.split("\n");
    let i = 0;
    if (lines[0] && lines[0].trim() === "---") {
      i = 1;
      while (i < lines.length && lines[i].trim() !== "---") i++;
      if (i < lines.length) i++;
    }
    const map = {};
    let currentColumn = null;
    const headingRe = /^##\s+(.+?)\s*$/;
    const listItemRe = /^\s*-\s+/;
    const linkRe = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const h = headingRe.exec(line);
      if (h) {
        currentColumn = h[1].trim();
        continue;
      }
      if (!currentColumn) continue;
      if (!listItemRe.test(line)) continue;
      let m;
      linkRe.lastIndex = 0;
      while ((m = linkRe.exec(line)) !== null) {
        const linkpath = m[1].trim();
        if (linkpath.length > 0) map[linkpath] = currentColumn;
      }
    }
    return map;
  }
  /**
   * Normalize a raw column label to a status slug.
   * "In Progress" → "in-progress"; trims, lowercases, collapses spaces to single hyphen,
   * strips non-alphanumeric/hyphen.
   */
  static slugifyStatus(name) {
    if (typeof name !== "string") return "";
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  /**
   * Compute the diff between the board's current column placement and each card's
   * prior frontmatter state.
   *
   * currentMap: { [linkpath]: rawColumnName }  — from parseBoardColumns()
   * priorMap:   { [linkpath]: { status: slug, column: rawColumnName | null } }
   *
   * Returns: { moves: [...], creates: [...], archives: [...] }
   * - moves: prior status was non-archived AND ≠ current slug
   * - creates: linkpath absent from prior, OR prior status was 'archived'
   * - archives: linkpath present in prior (non-archived) but absent from current
   */
  static computeDiff(currentMap, priorMap) {
    const moves = [];
    const creates = [];
    const archives = [];
    const cur = currentMap || {};
    const prior = priorMap || {};

    for (const linkpath of Object.keys(cur)) {
      const toColumn = cur[linkpath];
      const toStatus = KanbanStatusSync.slugifyStatus(toColumn);
      const p = prior[linkpath];
      if (!p || p.status === "archived") {
        creates.push({ linkpath, toStatus, toColumn });
        continue;
      }
      if (p.status !== toStatus) {
        moves.push({
          linkpath,
          fromStatus: p.status,
          fromColumn: p.column || null,
          toStatus,
          toColumn,
        });
      }
    }

    for (const linkpath of Object.keys(prior)) {
      const p = prior[linkpath];
      if (!p || p.status === "archived") continue;
      if (!Object.prototype.hasOwnProperty.call(cur, linkpath)) {
        archives.push({ linkpath, fromStatus: p.status, fromColumn: p.column || null });
      }
    }
    return { moves, creates, archives };
  }
}
