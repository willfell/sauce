---
caption: New project
icon: lucide-folder-plus
---

<%*
// Slash command wrapper for the create-new-project blueprint.
// Locates the installed Templater template by name and includes its body.
//
// At install time the workshop installer substitutes {{templates_path}} with
// the consumer's templates folder (e.g. "Docs/Meta/Templates" or
// "Extras/Templates"), so the lookup path below is baked per-vault.

const templatePath = "{{templates_path}}/Create New Project.md";
const tfile = tp.file.find_tfile(templatePath);
if (!tfile) {
  new Notice(`new-project: template not found at ${templatePath}`, 8000);
  return;
}
await tp.file.include(tfile);
%>
