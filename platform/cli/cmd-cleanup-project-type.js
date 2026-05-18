// v0.59.4 — One-shot cleanup for FLN-FA3-2 over-aggressive type:project
// backfill. Walks <vault>/spice/projects/**/*.md and removes any
// `type: project` line that landed on a non-atlas path (atlas = the file
// where folder basename == file basename, e.g. spice/projects/foo/foo.md).
//
// Dry-run by default; --apply to write. Backups go to <vault>/.sauce-backup/
// per-touched-file with timestamped subdir (mirrors cmd-migrate-frontmatter).
// Idempotent — a clean vault re-runs as no-op.
//
// Usage:
//   sauce cleanup-project-type --vault <path>          # dry-run report
//   sauce cleanup-project-type --vault <path> --apply  # rewrite + backup

const fs = require("fs");
const path = require("path");

const RE_TYPE_LINE = /^type:\s*project\s*$/;

function parseArgs(argv) {
  const out = { vault: null, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault" && i + 1 < argv.length) { out.vault = argv[++i]; continue; }
    if (a === "--apply") { out.apply = true; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
  }
  return out;
}

// Atlas-detection heuristic for `type: project` cleanup.
//
// A project's atlas file lives at depth-2 under spice/projects/, but the
// filename can vary by creation-vintage:
//   - v0.50.0+ entity-create flow: spice/projects/<slug>/<spaced display name>.md
//     (folder slugified; filename retains user's spaces, e.g. `you know.md`)
//   - pre-v0.50.0 legacy flow: spice/projects/<slug>/Project.md
//   - any other depth-2 user-named atlas .md
//
// So we conservatively preserve any depth-2 file UNLESS it's a known
// canonical sub-type (Project Map.md → type:map; <slug>-board.md → type:kanban).
// Files at depth-3+ (tasks/, board/, docs/, steps/) are sub-files — strip.
function isAtlasPath(relPath) {
  const m = relPath.match(/^spice\/projects\/([^/]+)\/([^/]+)\.md$/);
  if (!m) return false;                         // depth-3+ = not atlas
  const [, , filename] = m;
  if (filename === "Project Map") return false; // canonical map; should be type:map
  if (/-board$/.test(filename)) return false;   // kanban board; should be type:kanban
  return true;                                   // anything else at depth-2 → atlas
}

// Walk spice/projects/**/*.md → array of {abs, rel}.
function walkProjects(vault) {
  const root = path.join(vault, "spice/projects");
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === ".sauce-backup") continue;
        stack.push(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      out.push({ abs: full, rel: path.relative(vault, full) });
    }
  }
  return out;
}

// Split a file into [fmLines, restLines] OR returns null if no frontmatter.
function splitFrontmatter(body) {
  const lines = body.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      return {
        head: lines[0],
        fmLines: lines.slice(1, i),
        sepEnd: lines[i],
        rest: lines.slice(i + 1),
        eol: body.includes("\r\n") ? "\r\n" : "\n",
      };
    }
  }
  return null;
}

// Find the first `type: project` line (top-level, not nested) in fmLines.
// Returns its index, or -1 if not present.
function findTypeProjectLine(fmLines) {
  let inListBlock = false;
  for (let i = 0; i < fmLines.length; i++) {
    const ln = fmLines[i];
    if (/^[A-Za-z_]/.test(ln)) inListBlock = false;
    if (/^\s/.test(ln)) { inListBlock = true; continue; }
    if (inListBlock) continue;
    if (RE_TYPE_LINE.test(ln)) return i;
  }
  return -1;
}

// Parse the `tags:` array from frontmatter lines (top-level only). Handles
// both inline form `tags: [a, b]` and block form (`tags:` followed by `- x`
// indented items). Returns string[] or null if no tags key present.
function parseFrontmatterTags(fmLines) {
  for (let i = 0; i < fmLines.length; i++) {
    const ln = fmLines[i];
    const inline = ln.match(/^tags:\s*\[(.*)\]\s*$/);
    if (inline) {
      return inline[1].split(",")
        .map(s => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    if (/^tags:\s*$/.test(ln)) {
      const out = [];
      for (let j = i + 1; j < fmLines.length; j++) {
        const sub = fmLines[j];
        if (/^[A-Za-z_]/.test(sub)) break;  // next top-level key
        const item = sub.match(/^\s+-\s*(.+?)\s*$/);
        if (item) {
          out.push(item[1].replace(/^["']|["']$/g, ""));
        }
      }
      return out;
    }
  }
  return null;
}

// Returns true if frontmatter has a top-level key with the given name.
function fmHasKey(fmLines, key) {
  const re = new RegExp(`^${key}:\\s`);
  for (const ln of fmLines) {
    if (re.test(ln)) return true;
    if (new RegExp(`^${key}:\\s*$`).test(ln)) return true;
  }
  return false;
}

// Classifies a file with `type: project`. Returns true if the file is a
// legitimate project atlas; false if it's a sub-file (card / task / free-form
// note) whose `type: project` was wrongly backfilled by FA-3 migration.
//
// Two-stage cascade:
//
// STAGE 1 — definite signals (per-file):
//   - source_board: or task_parent: key       → NOT atlas (card/task indicator)
//   - explicit negative tag (kanban-card etc.)→ NOT atlas
//   - canonical sub-type filename (Project Map.md, *-board.md) → NOT atlas
//   - depth-3+ (under tasks/, board/, docs/)  → NOT atlas
//
// STAGE 2 — folder-relative one-atlas rule (for depth-2 ambiguous cases):
//   Among files with type:project in the same project folder, the atlas is:
//   1. <folder>.md if it exists (slug == filename)
//   2. <Display Name>.md where slugify(name) == folder (entity-create flow)
//   3. Project.md legacy fallback
//   All other depth-2 files with type:project are stripped.
//
// STAGE 2 needs the per-folder file list, so isAtlas accepts an optional
// folderCandidates array (basenames of depth-2 .md files in this folder).
function isAtlas(relPath, fmTags, fmLines, folderCandidates) {
  // STAGE 1
  if (Array.isArray(fmLines)) {
    if (fmHasKey(fmLines, "source_board")) return false;
    if (fmHasKey(fmLines, "task_parent")) return false;
  }
  const negativeMarkers = ["kanban-card", "task-board-card", "task-note", "project-card", "doc-note"];
  if (Array.isArray(fmTags) && fmTags.some(t => negativeMarkers.includes(t))) return false;
  const m = relPath.match(/^spice\/projects\/([^/]+)\/([^/]+)\.md$/);
  if (!m) return false;                           // depth-3+
  const [, folder, filename] = m;
  if (filename === "Project Map") return false;
  if (/-board$/.test(filename)) return false;

  // STAGE 2 — folder-relative one-atlas rule
  if (Array.isArray(folderCandidates) && folderCandidates.length > 0) {
    const designatedAtlas = pickDesignatedAtlas(folder, folderCandidates);
    return designatedAtlas === `${filename}.md`;
  }
  return true;                                    // no folder context → fall back to preserve
}

// Slugify mimicking what the project entity-create slugifies to (lowercase,
// non-alphanumeric → dash, collapse + trim).
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Among basenames in a project folder, pick the one most likely to be the atlas.
// Returns the basename including .md, or null if nothing in folder qualifies.
function pickDesignatedAtlas(folder, basenames) {
  const mds = basenames.filter(b => b.endsWith(".md"));
  // 1) Exact <folder>.md
  if (mds.includes(`${folder}.md`)) return `${folder}.md`;
  // 2) Display-name match: filename's slug equals folder
  for (const b of mds) {
    const stem = b.replace(/\.md$/, "");
    if (slugify(stem) === folder) return b;
  }
  // 3) Project.md legacy fallback
  if (mds.includes("Project.md")) return "Project.md";
  return null;
}

// Backup a file's pre-edit content under <vault>/.sauce-backup/<rel>/<ts>/
function writeBackup(vault, rel, originalContent, ts) {
  const backupDir = path.join(vault, ".sauce-backup", rel, ts);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(path.join(backupDir, path.basename(rel)), originalContent);
}

async function run(ctx, argv) {
  const args = parseArgs(argv || []);
  if (args.help || !args.vault) {
    console.log("Usage: sauce cleanup-project-type --vault <path> [--apply]");
    console.log("");
    console.log("Removes mis-applied `type: project` frontmatter entries from non-atlas");
    console.log("files under spice/projects/. Dry-run by default; --apply to write.");
    return { ok: !args.help, reason: args.help ? "help" : "missing-vault" };
  }
  const vault = path.resolve(args.vault);
  if (!fs.existsSync(vault)) {
    console.error(`Vault path not found: ${vault}`);
    process.exitCode = 1;
    return { ok: false };
  }

  const ts = (ctx && ctx._now ? ctx._now() : new Date()).toISOString().replace(/[:.]/g, "-");
  const files = walkProjects(vault);
  const actions = []; // {rel, action: "skip-atlas"|"skip-no-type"|"remove"}

  // First pass: read each file's frontmatter, build per-folder candidate sets.
  // folderTypedFiles[slug] = array of basenames (with .md) that currently
  // carry `type: project` AND would pass STAGE 1 (no source_board / task_parent /
  // negative tags / Project Map / -board). These are atlas candidates.
  const fileMeta = new Map(); // abs → {fm, tags, idx, content, folder, filename}
  const folderCandidates = new Map(); // folder → basenames[]

  for (const f of files) {
    const content = fs.readFileSync(f.abs, "utf8");
    const fm = splitFrontmatter(content);
    if (!fm) continue;
    const idx = findTypeProjectLine(fm.fmLines);
    if (idx < 0) continue;
    const tags = parseFrontmatterTags(fm.fmLines);
    const m = f.rel.match(/^spice\/projects\/([^/]+)\/([^/]+)\.md$/);
    if (!m) {
      // depth-3+ — never an atlas; record for stripping
      fileMeta.set(f.abs, { rel: f.rel, fm, tags, idx, content, isStage1Atlas: false });
      continue;
    }
    const [, folder, filename] = m;
    // STAGE 1 filter
    let s1NotAtlas = false;
    if (fmHasKey(fm.fmLines, "source_board") || fmHasKey(fm.fmLines, "task_parent")) s1NotAtlas = true;
    const negativeMarkers = ["kanban-card", "task-board-card", "task-note", "project-card", "doc-note"];
    if (Array.isArray(tags) && tags.some(t => negativeMarkers.includes(t))) s1NotAtlas = true;
    if (filename === "Project Map" || /-board$/.test(filename)) s1NotAtlas = true;

    fileMeta.set(f.abs, { rel: f.rel, fm, tags, idx, content, folder, filename, s1NotAtlas });
    if (!s1NotAtlas) {
      if (!folderCandidates.has(folder)) folderCandidates.set(folder, []);
      folderCandidates.get(folder).push(`${filename}.md`);
    }
  }

  // Second pass: classify each candidate using folder context.
  for (const [abs, meta] of fileMeta) {
    if (meta.s1NotAtlas || !meta.folder) {
      // STAGE 1 reject OR depth-3+ → strip
      actions.push({ rel: meta.rel, action: "remove", _abs: abs, _idx: meta.idx, _fm: meta.fm, _content: meta.content });
      continue;
    }
    const candidates = folderCandidates.get(meta.folder) || [];
    const designated = pickDesignatedAtlas(meta.folder, candidates);
    // If a canonical atlas exists in this folder, only IT is atlas — others stripped.
    if (designated) {
      if (designated === `${meta.filename}.md`) {
        actions.push({ rel: meta.rel, action: "skip-atlas" });
      } else {
        actions.push({ rel: meta.rel, action: "remove", _abs: abs, _idx: meta.idx, _fm: meta.fm, _content: meta.content });
      }
      continue;
    }
    // No designated atlas detected — singleton-fallback: if this is the only
    // candidate in the folder, it's the atlas (user used a non-canonical name).
    if (candidates.length === 1) {
      actions.push({ rel: meta.rel, action: "skip-atlas" });
      continue;
    }
    // Multiple candidates with no canonical detection → ambiguous, preserve all
    // (defensive — don't over-strip on first pass; manual cleanup or future
    // cycle can resolve).
    actions.push({ rel: meta.rel, action: "skip-atlas" });
  }

  const toRemove = actions.filter(a => a.action === "remove");
  const skipped = actions.filter(a => a.action === "skip-atlas");

  if (!args.apply) {
    console.log(`# sauce cleanup-project-type — dry-run`);
    console.log(`Vault: ${vault}`);
    console.log(`Scanned files under spice/projects/: ${files.length}`);
    console.log(`Atlas files (skipped — correctly typed): ${skipped.length}`);
    console.log(`Non-atlas files with mis-applied type:project (would clean): ${toRemove.length}`);
    if (toRemove.length === 0) {
      console.log(`\n(vault already clean — re-run is a no-op)`);
    } else {
      console.log(`\n## Would remove type:project from:\n`);
      for (const a of toRemove) console.log(`- \`${a.rel}\``);
    }
    return { ok: true, scanned: files.length, would_remove: toRemove.length, dry_run: true };
  }

  let written = 0;
  for (const a of toRemove) {
    writeBackup(vault, a.rel, a._content, ts);
    const newFmLines = a._fm.fmLines.slice(0, a._idx).concat(a._fm.fmLines.slice(a._idx + 1));
    const newBody = [a._fm.head, ...newFmLines, a._fm.sepEnd, ...a._fm.rest].join(a._fm.eol);
    fs.writeFileSync(a._abs, newBody);
    written++;
  }
  console.log(`apply: ${written} files cleaned; ${skipped.length} atlas files preserved; backups under .sauce-backup/`);
  return { ok: true, scanned: files.length, written, skipped: skipped.length };
}

module.exports = {
  run,
  // Test hooks
  _isAtlas: isAtlas,
  _isAtlasPath: isAtlas,  // back-compat alias for v0.59.4/0.59.5 callers
  _splitFrontmatter: splitFrontmatter,
  _findTypeProjectLine: findTypeProjectLine,
  _parseFrontmatterTags: parseFrontmatterTags,
  _walkProjects: walkProjects,
};
