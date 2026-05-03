// validate.js — vault-platform validator (runs as tp.user.validate).
//
// Usage from a template (manual):
//   <%* const result = await tp.user.validate(tp.file, "project");
//       if (result.violations.length) console.log(result.violations); %>
//
// Usage from a hook (preferred — see hook.js):
//   tp.hooks.on_all_templates_executed(async () => {
//     const file = tp.config.target_file;
//     const result = await tp.user.validate({ file });
//   });
//
// Returns: { fixes: [{file, op, ...}], violations: [{rule, severity, message}] }

module.exports = async function (tpFileOrObj, moduleId) {
  const app = this.app || window.app;
  const result = { fixes: [], violations: [] };

  // Resolve TFile from input (Templater passes a TFile in tp.file; hook passes { file }).
  const file = tpFileOrObj?.file ?? tpFileOrObj;
  if (!file || !file.path) {
    result.violations.push({ rule: "internal", severity: "error", message: "validate: invalid file argument" });
    return result;
  }

  // Read frontmatter via Obsidian metadata cache.
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter ?? {};

  // Resolve moduleId (argument > frontmatter.module > "_global").
  const resolvedModule = moduleId || fm.module || null;

  // Load rules.
  const rulesPath = "Docs/Meta/rules";
  const globalRule = await loadRule(app, rulesPath, "_global");
  const moduleRule = resolvedModule ? await loadRule(app, rulesPath, resolvedModule) : null;

  if (!globalRule) {
    result.violations.push({ rule: "internal", severity: "warn", message: "validate: _global.yml not found; skipping" });
    return result;
  }

  // Run rule checks.
  const ctx = { file, fm, body: await app.vault.read(file), result };
  await checkFrontmatter(ctx, globalRule, moduleRule);
  await checkTags(ctx, globalRule, moduleRule);
  await checkRequiredBlocks(ctx, globalRule, moduleRule);
  await checkForbiddenPatterns(ctx, globalRule, moduleRule);
  await checkNamingPattern(ctx, globalRule, moduleRule);

  return result;
};

async function loadRule(app, rulesPath, name) {
  const tfile = app.vault.getAbstractFileByPath(`${rulesPath}/${name}.yml`);
  if (!tfile) return null;
  const text = await app.vault.read(tfile);
  try {
    const obs = require("obsidian");
    if (obs && typeof obs.parseYaml === "function") return obs.parseYaml(text);
  } catch (e) { /* fall through */ }
  try {
    if (typeof YAML !== "undefined" && YAML.parse) return YAML.parse(text);
    if (typeof window !== "undefined" && window.YAML?.parse) return window.YAML.parse(text);
  } catch (e) { /* fall through */ }
  return null;
}

async function checkFrontmatter(ctx, gr, mr) {
  const required = { ...(gr.required_frontmatter || {}), ...((mr || {}).required_frontmatter || {}) };
  for (const [key, spec] of Object.entries(required)) {
    if (spec.required && (ctx.fm[key] === undefined || ctx.fm[key] === null || ctx.fm[key] === "")) {
      ctx.result.violations.push({
        rule: `required_frontmatter.${key}`,
        severity: "error",
        message: `Missing required frontmatter field: ${key}`,
      });
    }
    if (spec.type && ctx.fm[key] !== undefined) {
      const actual = Array.isArray(ctx.fm[key]) ? "array" : typeof ctx.fm[key];
      if (actual !== spec.type && !(spec.type === "datetime" && actual === "string")) {
        ctx.result.violations.push({
          rule: `required_frontmatter.${key}.type`,
          severity: "warn",
          message: `Field ${key} should be ${spec.type}, got ${actual}`,
        });
      }
    }
  }
}

async function checkTags(ctx, gr, mr) {
  const required = [...((gr.required_tags) || []), ...(((mr || {}).required_tags) || [])];
  const tags = Array.isArray(ctx.fm.tags) ? ctx.fm.tags : [];

  for (const spec of required) {
    const tag = spec.tag;
    if (typeof tag === "string" && tag.includes("{{")) continue; // unsubstituted template variable; skip
    const idx = tags.indexOf(tag);
    if (idx === -1) {
      ctx.result.violations.push({
        rule: "required_tags.missing",
        severity: "error",
        message: `Missing required tag: ${tag}`,
      });
      ctx.result.fixes.push({ file: ctx.file, op: "add_tag", value: tag, position: spec.position });
      continue;
    }
    if (spec.position !== undefined && spec.position >= 0 && idx !== spec.position) {
      ctx.result.violations.push({
        rule: "required_tags.position",
        severity: "warn",
        message: `Tag ${tag} should be at position ${spec.position}, found at ${idx}`,
      });
      ctx.result.fixes.push({ file: ctx.file, op: "move_tag", value: tag, to: spec.position });
    }
    if (spec.pattern) {
      const re = new RegExp(
        "^" + spec.pattern.replace("YYYY", "\\d{4}").replace("MM", "\\d{2}").replace("DD", "\\d{2}") + "$",
      );
      if (!re.test(tag)) {
        ctx.result.violations.push({
          rule: "required_tags.pattern",
          severity: "warn",
          message: `Tag ${tag} does not match pattern ${spec.pattern}`,
        });
      }
    }
  }
}

async function checkRequiredBlocks(ctx, gr, mr) {
  const required = [...((gr.required_blocks) || []), ...(((mr || {}).required_blocks) || [])];
  for (const spec of required) {
    if (spec.when) {
      // Crude evaluator: supports "frontmatter.X == 'Y'" / "frontmatter.X != 'Y'".
      const m = spec.when.match(/^frontmatter\.(\w+)\s*(==|!=)\s*['"]([^'"]+)['"]$/);
      if (m) {
        const [, key, op, val] = m;
        const actual = ctx.fm[key];
        const matches = op === "==" ? actual === val : actual !== val;
        if (!matches) continue;
      }
    }
    const expectedSnippet = spec.content;
    if (!ctx.body.includes(expectedSnippet)) {
      ctx.result.violations.push({
        rule: "required_blocks.missing",
        severity: "error",
        message: `Missing required ${spec.type} block containing: ${expectedSnippet.slice(0, 80)}`,
      });
    }
  }
}

async function checkForbiddenPatterns(ctx, gr, mr) {
  const patterns = [...((gr.forbid_dataviewjs_patterns) || []), ...(((mr || {}).forbid_dataviewjs_patterns) || [])];
  const dvjsBlocks = [...ctx.body.matchAll(/```dataviewjs\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  for (const spec of patterns) {
    const re = new RegExp(spec.pattern);
    for (const block of dvjsBlocks) {
      if (re.test(block)) {
        ctx.result.violations.push({
          rule: "forbid_dataviewjs_patterns",
          severity: "error",
          message: `Forbidden pattern matched in dataviewjs: ${spec.pattern} — ${spec.reason || "(no reason given)"}`,
        });
      }
    }
  }
}

async function checkNamingPattern(ctx, gr, mr) {
  const pattern = (mr || {}).naming_pattern;
  if (!pattern) return;
  const basename = ctx.file.basename;
  if (!basename || basename.length === 0) {
    ctx.result.violations.push({ rule: "naming_pattern", severity: "error", message: "Empty basename" });
  }
}
