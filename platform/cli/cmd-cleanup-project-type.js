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

const RE_ATLAS = /^spice\/projects\/([^/]+)\/([^/]+)\.md$/;
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

function isAtlasPath(relPath) {
  const m = relPath.match(RE_ATLAS);
  return Boolean(m && m[1] === m[2]);
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

  for (const f of files) {
    const content = fs.readFileSync(f.abs, "utf8");
    const fm = splitFrontmatter(content);
    if (!fm) { continue; }
    const idx = findTypeProjectLine(fm.fmLines);
    if (idx < 0) { continue; }  // No type: project line, nothing to clean
    if (isAtlasPath(f.rel)) {
      actions.push({ rel: f.rel, action: "skip-atlas" });
      continue;
    }
    actions.push({ rel: f.rel, action: "remove", _abs: f.abs, _idx: idx, _fm: fm, _content: content });
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
  _isAtlasPath: isAtlasPath,
  _splitFrontmatter: splitFrontmatter,
  _findTypeProjectLine: findTypeProjectLine,
  _walkProjects: walkProjects,
};
