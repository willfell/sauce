// audit-walker.js — runs as tp.user["audit-walker"](tp). Invoked by /audit slash command.
// Walks every .md file in the vault, runs tp.user.validate on each, groups violations.
// Also reports platform-version drift (installed vs subscribed).

module.exports = async function (tp) {
  const app = tp.app;
  const files = app.vault.getMarkdownFiles();
  const report = { summary: {}, byFile: {}, generated: new Date().toISOString(), platformDrift: [] };

  for (const file of files) {
    const result = await tp.user.validate({ file });
    if (!result.violations || result.violations.length === 0) continue;
    report.byFile[file.path] = result.violations;
    for (const v of result.violations) {
      report.summary[v.rule] = (report.summary[v.rule] || 0) + 1;
    }
  }

  // Compare installed vs subscribed platform versions.
  const installed = (await readYaml(app, "Docs/Meta/platform-installed.yml")) || {};
  const subscription = (await readYaml(app, "Docs/Meta/platform-subscription.yml")) || {};
  report.platformDrift = computeDrift(installed, subscription);

  const today = new Date().toISOString().slice(0, 10);
  const reportPath = `Timestamps/Audits/${today}-audit.md`;
  const md = renderMarkdown(report);
  const existing = app.vault.getAbstractFileByPath(reportPath);
  if (existing) {
    await app.vault.modify(existing, md);
  } else {
    // Ensure directory exists.
    const dir = "Timestamps/Audits";
    if (!(await app.vault.adapter.exists(dir))) {
      await app.vault.adapter.mkdir(dir);
    }
    await app.vault.create(reportPath, md);
  }
  return reportPath;
};

async function readYaml(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) return null;
  const text = await app.vault.read(f);
  try {
    if (typeof YAML !== "undefined" && YAML.parse) return YAML.parse(text);
    if (typeof window !== "undefined" && window.YAML?.parse) return window.YAML.parse(text);
    return null;
  } catch (e) {
    return null;
  }
}

function computeDrift(installed, subscription) {
  const drift = [];
  const sub = subscription.mechanisms || [];
  const inst = installed.mechanisms || [];
  for (const s of sub) {
    const i = inst.find((x) => x.name === s.name);
    if (!i) drift.push({ name: s.name, status: "not_installed", subscribed: s.version });
    else if (i.version !== s.version)
      drift.push({ name: s.name, status: "version_mismatch", installed: i.version, subscribed: s.version });
  }
  return drift;
}

function renderMarkdown(report) {
  const dateTag = report.generated.slice(0, 10).replace(/-/g, "/");
  const lines = [
    "---",
    `tags: [audit, ${dateTag}]`,
    "---",
    "",
    `# Vault Audit — ${report.generated.slice(0, 10)}`,
    "",
    "## Platform drift",
    "",
  ];
  if (report.platformDrift.length === 0) {
    lines.push("- No drift detected.");
  } else {
    for (const d of report.platformDrift) {
      lines.push(`- 🔴 ${d.name}: ${d.status} (${JSON.stringify(d)})`);
    }
  }
  lines.push("", "## Violations summary", "");
  if (Object.keys(report.summary).length === 0) {
    lines.push("- No violations.");
  } else {
    for (const [rule, count] of Object.entries(report.summary)) {
      lines.push(`- ${rule}: ${count}`);
    }
  }
  lines.push("", "## Violations by file", "");
  if (Object.keys(report.byFile).length === 0) {
    lines.push("- All files clean.");
  } else {
    for (const [file, vs] of Object.entries(report.byFile)) {
      lines.push("### " + file);
      for (const v of vs) lines.push(`- [${v.severity}] ${v.rule}: ${v.message}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
