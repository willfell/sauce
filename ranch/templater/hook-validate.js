// hook.js — Templater on_all_templates_executed handler.
// Wired into a startup template by the installer (see manifest.yml post_install).

module.exports = async function (tp) {
  tp.hooks.on_all_templates_executed(async () => {
    try {
      const file = tp.config.target_file;
      if (!file) return;
      const result = await tp.user.validate({ file });
      // Apply auto-fixes (tag inserts, tag reorders).
      for (const fix of result.fixes || []) {
        await applyFix(tp, fix);
      }
      if ((result.violations || []).length) {
        const msg = result.violations.map((v) => `[${v.severity}] ${v.rule}: ${v.message}`).join("\n");
        new Notice("Vault-platform validator:\n" + msg, 8000);
        await appendLintQueue(tp, file, result.violations);
      }
    } catch (e) {
      new Notice("Validator hook error: " + e.message, 6000);
      console.error(e);
    }
  });
};

async function applyFix(tp, fix) {
  if (fix.op === "add_tag" || fix.op === "move_tag") {
    await tp.app.fileManager.processFrontMatter(fix.file, (fm) => {
      const tags = Array.isArray(fm.tags) ? fm.tags.filter((t) => t !== fix.value) : [];
      const target = fix.op === "move_tag" ? fix.to : fix.position;
      const pos = target === undefined || target < 0 ? tags.length : Math.min(target, tags.length);
      tags.splice(pos, 0, fix.value);
      fm.tags = tags;
    });
  }
}

async function appendLintQueue(tp, file, violations) {
  const path = "Docs/Meta/_lint-queue.yml";
  const tfile = tp.app.vault.getAbstractFileByPath(path);
  const entry =
    `\n- file: "${file.path}"\n  date: "${new Date().toISOString()}"\n  violations:\n` +
    violations
      .map(
        (v) =>
          `    - { rule: "${v.rule}", severity: "${v.severity}", message: ${JSON.stringify(v.message)} }`,
      )
      .join("\n");
  if (tfile) {
    const existing = await tp.app.vault.read(tfile);
    await tp.app.vault.modify(tfile, existing + entry);
  } else {
    await tp.app.vault.create(path, "# Vault lint queue — entries appended by validator hook\n" + entry);
  }
}
