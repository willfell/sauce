<%*
// One-shot template — fires tp.user.platformInstall(tp) once.
// To run: command palette → "Templater: Open insert template modal" → pick "_install-platform".
// Or: command palette → "Templater: Replace templates in active file" while this template's body is in the active note.
//
// What happens:
//   - Reads Docs/Meta/platform-config.yml + platform-subscription.yml + (existing) platform-installed.yml.
//   - Reads workshop manifest at <workshop-root>/platform/manifest.yml.
//   - For each subscribed mechanism not already installed at the same version: copies files in, substitutes {{vars}}, fires approval gates for any approval:required steps.
//   - Writes Docs/Meta/platform-installed.yml.
//
// You'll see Notice popups for each approval gate (CSS snippet, appearance.json edit) and a final "platformInstall: complete" Notice.

await tp.user.platformInstall(tp);
tR += "Installer fired at " + tp.date.now("YYYY-MM-DD HH:mm") + ". See Notices for results.";
%>
