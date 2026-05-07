<%*
// create-new-project (project blueprint v0.1.0)
//
// Prompts for a project name, derives a kebab-case slug, creates
// boards/planning/<slug>/<slug>.md with the required frontmatter +
// dataviewjs nav-button blocks, then opens it.
//
// Reads Docs/Meta/platform-config.json at runtime to pick up
// vault_identity (used as a frontmatter tag) and views_path (used
// inside the dataviewjs dv.view() calls). Both are optional — if
// the config is missing or malformed, sensible defaults are used
// and a Notice is surfaced.
//
// v0.1.0 limitations (deferred to v0.1.1):
//   - Does NOT create the planning kanban board (Template, Project Board.md
//     workflow). Author manually after creation if desired.
//   - Does NOT load variants.json overrides (path_root, alias).

const adapter = app.vault.adapter;

// --- 1. Read platform-config.json (best-effort) ---
let vaultIdentity = null;
let viewsPath = "Docs/Meta/Views";
try {
  const cfgRaw = await adapter.read("Docs/Meta/platform-config.json");
  const cfg = JSON.parse(cfgRaw);
  if (cfg && typeof cfg === "object") {
    if (typeof cfg.vault_identity === "string" && cfg.vault_identity.length > 0) {
      vaultIdentity = cfg.vault_identity;
    }
    if (cfg.variables && typeof cfg.variables.views_path === "string" && cfg.variables.views_path.length > 0) {
      viewsPath = cfg.variables.views_path;
    }
  }
} catch (e) {
  new Notice("create-new-project: could not read Docs/Meta/platform-config.json — using defaults", 6000);
}

// --- 2. Prompt for project name ---
const projectName = await tp.system.prompt("Project name?");
if (!projectName || !projectName.trim()) {
  new Notice("create-new-project: cancelled (no name)", 4000);
  return;
}

// --- 3. Derive kebab-case slug ---
const slug = projectName
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, "")
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");

if (!slug) {
  new Notice("create-new-project: could not derive a slug from name", 6000);
  return;
}

// --- 4. Create folder (idempotent) ---
const folderPath = `boards/planning/${slug}`;
try {
  if (!(await adapter.exists(folderPath))) {
    await adapter.mkdir(folderPath);
  }
} catch (e) {
  new Notice(`create-new-project: failed to create ${folderPath} — ${e.message}`, 8000);
  return;
}

// --- 5. Atlas note path ---
const atlasPath = `${folderPath}/${slug}.md`;
if (await adapter.exists(atlasPath)) {
  new Notice(`create-new-project: ${atlasPath} already exists; aborting.`, 6000);
  return;
}

// --- 6. Build frontmatter tags ---
let tagsLine;
if (vaultIdentity) {
  tagsLine = `tags: [project, ${vaultIdentity}]`;
} else {
  tagsLine = `tags: [project]`;
  new Notice("create-new-project: vault_identity missing from platform-config.json — add identity tag manually if needed", 8000);
}

// --- 7. Build atlas body ---
const today = tp.date.now("YYYY-MM-DD");
const body = [
  "---",
  `title: ${projectName}`,
  `slug: ${slug}`,
  "type: project",
  "status: active",
  tagsLine,
  `created: ${today}`,
  "---",
  "",
  "```dataviewjs",
  `await dv.view("${viewsPath}/customjs-guard", { class: "SpaceNavButtons" });`,
  "```",
  "",
  "```dataviewjs",
  `await dv.view("${viewsPath}/customjs-guard", { class: "ProjectNavButtons" });`,
  "```",
  "",
  `# ${projectName}`,
  "",
  "## Goals",
  "",
  "## Workstreams",
  "",
  "```dataviewjs",
  `await dv.view("${viewsPath}/customjs-guard", { class: "ProjectWorkstreamManager", input: { project: dv.current().file.name } });`,
  "```",
  "",
  "## Notes",
  "",
].join("\n");

// --- 8. Create file ---
try {
  await app.vault.create(atlasPath, body);
} catch (e) {
  new Notice(`create-new-project: failed to write ${atlasPath} — ${e.message}`, 8000);
  return;
}

new Notice(`Created project ${slug} at ${atlasPath}`, 6000);

// --- 9. Open the new file ---
const newFile = app.vault.getAbstractFileByPath(atlasPath);
if (newFile) {
  await app.workspace.getLeaf(false).openFile(newFile);
}
%>
