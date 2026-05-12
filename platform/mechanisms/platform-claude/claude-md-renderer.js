// platform/mechanisms/platform-claude/claude-md-renderer.js
//
// v0.32.0 S4 — CLAUDE.md marker-bounded section renderer.
//
// regenerateClaudeMd(rows, vault, history, git):
//
//   Reads <vault>/CLAUDE.md, locates three marker pairs, and replaces the
//   content between each BEGIN/END pair with a freshly-rendered markdown
//   table built from the aggregator's `rows` output. Content OUTSIDE any
//   marker pair is preserved bit-for-bit.
//
// Marker pairs (per table key):
//   <!-- @claude-surface:directory-map BEGIN -->
//   ... rendered table ...
//   <!-- @claude-surface:directory-map END -->
//   <!-- @claude-surface:resolvers BEGIN -->
//   ... rendered table ...
//   <!-- @claude-surface:resolvers END -->
//   <!-- @claude-surface:skills-index BEGIN -->
//   ... rendered table ...
//   <!-- @claude-surface:skills-index END -->
//
// Tables:
//   directory-map → | Path | Blueprint | Purpose |
//                   Pre-seeded platform rows always come first, then
//                   blueprint-contributed rows sorted alphabetically by
//                   `path` (the aggregator already sorts; we trust it).
//   resolvers     → | Topic | Path | Slash command |
//                   No pre-seeded rows. Aggregator output is already
//                   sorted alphabetically by `topic`.
//   skills-index  → | Command | SKILL.md | Blueprint/Mechanism |
//                   No pre-seeded rows. Aggregator output is already
//                   sorted alphabetically by `command`.
//
// Behavior:
//   1. Read <vault>/CLAUDE.md via adapter.read. Missing file → log a notice
//      event and return without writing. First-touch scaffold is a separate
//      concern (S6 ships claude-md-template.md).
//   2. For each table:
//        - Both markers present: replace BEGIN..END inclusive with
//            BEGIN\n<rendered>\nEND.
//        - Only BEGIN (no matching END): throw Error (fail-loud).
//        - Neither marker: append a new section to end of file.
//   3. Write back via adapter.write iff content changed.
//   4. Log { event: "claude_md_regen", tables_updated, rows_total, git_*,
//           attempted_at } on success.
//
// Adapter contract:
//   vault.app.vault.adapter.{ exists, read, write } — same triplet used by
//   materializeSkills and materializeClaudeSurface. The node-test fake-tp
//   in run-claude-surface.js satisfies the same shape.
//
"use strict";

// Pre-seeded directory-map rows. ALWAYS appear in the rendered directory-map
// table, ahead of any blueprint-contributed rows.
const DIRECTORY_MAP_SEEDS = [
  { path: "spice/",            owner: "(platform)", purpose: "Module-directory namespace for blueprints" },
  { path: "ranch/",            owner: "(platform)", purpose: "Runtime plumbing (config, scripts, templates, views)" },
  { path: ".claude/commands/", owner: "(platform)", purpose: "Slash commands managed via claude_surface[]" },
  { path: ".claude/skills/",   owner: "(platform)", purpose: "Native Claude Code skill bodies" },
];

const TABLE_TITLES = {
  "directory-map": "Directory map",
  "resolvers":     "Resolvers",
  "skills-index":  "Skills index",
};

// Per-table render config: header row + separator row + per-row formatter
// pulling fields from each row object.
const TABLE_RENDERERS = {
  "directory-map": {
    header: "| Path | Blueprint | Purpose |",
    sep:    "| --- | --- | --- |",
    rowFn:  (r) => `| ${r.path || ""} | ${r.owner || ""} | ${r.purpose || ""} |`,
  },
  "resolvers": {
    header: "| Topic | Path | Slash command |",
    sep:    "| --- | --- | --- |",
    rowFn:  (r) => `| ${r.topic || ""} | ${r.path || ""} | ${r.command || ""} |`,
  },
  "skills-index": {
    header: "| Command | SKILL.md | Blueprint/Mechanism |",
    sep:    "| --- | --- | --- |",
    rowFn:  (r) => `| ${r.command || ""} | ${r.skill_path || ""} | ${r.owner || ""} |`,
  },
};

function beginMarker(table) { return `<!-- @claude-surface:${table} BEGIN -->`; }
function endMarker(table)   { return `<!-- @claude-surface:${table} END -->`; }

function renderTable(table, rows) {
  const cfg = TABLE_RENDERERS[table];
  if (!cfg) throw new Error(`renderTable: unknown table "${table}"`);
  const out = [cfg.header, cfg.sep];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    out.push(cfg.rowFn(r));
  }
  return out.join("\n");
}

// Build the full body that lives between BEGIN+END markers (inclusive).
function buildSection(table, rows) {
  return `${beginMarker(table)}\n${renderTable(table, rows)}\n${endMarker(table)}`;
}

// Replace a marker pair within `content`. Returns { content, replaced } on
// happy path. Throws if BEGIN exists without a matching END. Returns
// { content, replaced: false } if neither marker is present.
function replaceMarkerPair(content, table, rows) {
  const begin = beginMarker(table);
  const end   = endMarker(table);
  const beginIdx = content.indexOf(begin);
  const endIdx   = content.indexOf(end);

  if (beginIdx === -1 && endIdx === -1) {
    return { content, replaced: false };
  }
  if (beginIdx !== -1 && endIdx === -1) {
    throw new Error(
      `regenerateClaudeMd: half-open marker — found "${begin}" without matching "${end}" in CLAUDE.md`
    );
  }
  if (beginIdx === -1 && endIdx !== -1) {
    throw new Error(
      `regenerateClaudeMd: half-open marker — found "${end}" without matching "${begin}" in CLAUDE.md`
    );
  }
  if (endIdx < beginIdx) {
    throw new Error(
      `regenerateClaudeMd: malformed markers for ${table} — END appears before BEGIN`
    );
  }
  const before = content.substring(0, beginIdx);
  const after  = content.substring(endIdx + end.length);
  const replaced = `${before}${buildSection(table, rows)}${after}`;
  return { content: replaced, replaced: true };
}

// Append a new section to end of content. Ensures a trailing newline before
// the BEGIN marker so the appended block reads cleanly under existing prose.
function appendSection(content, table, rows) {
  const title = TABLE_TITLES[table] || table;
  const headed =
    `\n${beginMarker(table)}\n## ${title}\n${renderTable(table, rows)}\n${endMarker(table)}\n`;
  // If content already ends with a newline keep it; else add one before the
  // leading "\n" we put in `headed` — we don't want to leave the appended
  // block flush against arbitrary trailing characters.
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}${headed}`;
}

// Compose the directory-map rows: seeds first, then aggregator rows. The
// aggregator pre-sorts contributed rows by `path`, so we just concat.
function composeRows(table, contributedRows) {
  const contributed = Array.isArray(contributedRows) ? contributedRows : [];
  if (table === "directory-map") return [...DIRECTORY_MAP_SEEDS, ...contributed];
  return contributed;
}

// Pull adapter triplet from either a true Obsidian tp wrapper or the
// node-test fake-tp shim (both expose `.app.vault.adapter`).
function pickAdapter(vault) {
  if (!vault) return null;
  if (vault.app && vault.app.vault && vault.app.vault.adapter) {
    return vault.app.vault.adapter;
  }
  // Direct-adapter form (also supported so callers can pass adapter directly).
  if (typeof vault.read === "function" && typeof vault.write === "function") {
    return vault;
  }
  return null;
}

async function regenerateClaudeMd(rows, vault, history, git) {
  const adapter = pickAdapter(vault);
  if (!adapter) {
    if (Array.isArray(history)) {
      history.push({
        event: "error",
        step: "claude_md_regen",
        message: "regenerateClaudeMd: vault adapter unavailable",
        git_commit: git ? git.commit : null,
        git_tag:    git ? git.tag    : null,
        git_dirty:  git ? git.dirty  : null,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const claudeMdPath = "CLAUDE.md";
  const exists = await adapter.exists(claudeMdPath);
  if (!exists) {
    if (Array.isArray(history)) {
      history.push({
        event: "notice",
        step: "claude_md_regen",
        message: "CLAUDE.md not present; skipping regen (first-touch scaffold ships in S6)",
        git_commit: git ? git.commit : null,
        git_tag:    git ? git.tag    : null,
        git_dirty:  git ? git.dirty  : null,
        attempted_at: new Date().toISOString(),
      });
    }
    return;
  }

  const original = await adapter.read(claudeMdPath);
  let working = original;
  const tablesUpdated = [];
  let rowsTotal = 0;

  for (const table of ["directory-map", "resolvers", "skills-index"]) {
    const contributed = (rows && rows[table]) || [];
    const composed = composeRows(table, contributed);
    rowsTotal += composed.length;
    const { content: next, replaced } = replaceMarkerPair(working, table, composed);
    if (replaced) {
      working = next;
      tablesUpdated.push(table);
    } else {
      working = appendSection(working, table, composed);
      tablesUpdated.push(table);
    }
  }

  if (working !== original) {
    await adapter.write(claudeMdPath, working);
  }

  if (Array.isArray(history)) {
    history.push({
      event: "claude_md_regen",
      step: "claude_md_regen",
      tables_updated: tablesUpdated,
      rows_total: rowsTotal,
      git_commit: git ? git.commit : null,
      git_tag:    git ? git.tag    : null,
      git_dirty:  git ? git.dirty  : null,
      attempted_at: new Date().toISOString(),
    });
  }
}

module.exports = {
  regenerateClaudeMd,
  // Exported for testability / future reuse.
  DIRECTORY_MAP_SEEDS,
  beginMarker,
  endMarker,
  renderTable,
  buildSection,
};
