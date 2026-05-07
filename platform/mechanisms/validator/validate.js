// validate.js — vault-platform validator (runs as tp.user.validate).
//
// Usage from a runner template (preferred — no Templater wrapper traps):
//   <%* const result = await tp.user.validate({ file: app.workspace.getActiveFile() });
//       if (!result.violations.length) { new Notice("validate: clean"); }
//       else { console.log("[validate]", result.violations); } %>
//
// Usage from a hook (hook.js):
//   tp.hooks.on_all_templates_executed(async () => {
//     const file = tp.config.target_file;
//     const result = await tp.user.validate({ file });
//   });
//
// Returns: { fixes: [{file, op, ...}], violations: [{rule, severity, message}] }

function resolveTFile(input, app) {
  if (!input) return app.workspace.getActiveFile() || null;
  // shape: { file: TFile }
  if (input.file && input.file.path && typeof input.file.path === "string") return input.file;
  // shape: TFile directly (string path + basename present)
  if (input.path && typeof input.path === "string" && input.basename) return input;
  // shape: tp.file wrapper or anything else — fall through to activeFile
  return app.workspace.getActiveFile() || null;
}

function whenMatches(when, fm) {
  // Crude evaluator: supports "frontmatter.X == 'Y'" / "frontmatter.X != 'Y'".
  const m = when.match(/^frontmatter\.(\w+)\s*(==|!=)\s*['"]([^'"]+)['"]$/);
  if (!m) return true; // unknown predicate → don't filter
  const [, key, op, val] = m;
  const actual = fm[key];
  return op === "==" ? actual === val : actual !== val;
}

module.exports = async function (tpFileOrObj, moduleId) {
  const app = this.app || window.app;
  const result = { fixes: [], violations: [] };

  const file = resolveTFile(tpFileOrObj, app);
  if (!file) {
    result.violations.push({ rule: "internal", severity: "error", message: "validate: cannot resolve file" });
    return result;
  }

  // Read frontmatter via Obsidian metadata cache.
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter ?? {};

  // Resolve moduleId (argument > frontmatter.module > "_global").
  const resolvedModule = moduleId || fm.module || null;

  // Load rules.
  const rulesPath = "ranch/rules";
  const globalRule = await loadRule(app, rulesPath, "_global");
  const moduleRule = resolvedModule ? await loadRule(app, rulesPath, resolvedModule) : null;

  if (!globalRule) {
    result.violations.push({ rule: "internal", severity: "warn", message: "validate: _global.json not found; skipping" });
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
  const tfile = app.vault.getAbstractFileByPath(`${rulesPath}/${name}.json`);
  if (!tfile) return null;
  const text = await app.vault.read(tfile);
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
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
  const dvjsBlocks = [...ctx.body.matchAll(/```dataviewjs\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  for (const spec of required) {
    if (spec.when && !whenMatches(spec.when, ctx.fm)) continue;
    if (spec.kind === "dataviewjs" && spec.must_call && spec.via === "customjs-guard") {
      const className = spec.must_call.replace(/^customJS\./, "");
      const wrapperRe = new RegExp(
        `dv\\.view\\(\\s*["']ranch/views/customjs-guard["']\\s*,\\s*\\{[^}]*class\\s*:\\s*["']${className}["']`
      );
      const matched = dvjsBlocks.some((b) => wrapperRe.test(b));
      if (!matched) {
        ctx.result.violations.push({
          rule: "required_blocks.missing",
          severity: "error",
          message: `Missing required ${spec.kind} block calling ${spec.must_call} via ${spec.via}`,
        });
      }
    } else {
      ctx.result.violations.push({
        rule: "required_blocks.schema",
        severity: "warn",
        message: `Unknown required_blocks schema: ${JSON.stringify(spec).slice(0, 100)}`,
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
