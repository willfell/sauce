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
//
// v0.29.0 — additive predicates (equals / matches / contains) added to checkFrontmatter
// for read-side compatibility with the new rule_fragments schema. Full audit logic
// lives in platform/audit/rule-runner.js (Node CLI); shared core extraction deferred to v0.29.1.
//
// v0.31.0 S2.1a — additive predicates `min_length` + `items_schema` (discriminated-union
// per-item validator). items_schema resolves `by_type_source` against the consumer-vault
// override path `spice/cowork/engagement-types/<type>.json`; workshop fallback is NOT
// reachable from in-vault context, so we only attempt the vault-local lookup here. The
// CLI audit path in platform/audit/rule-runner.js handles the workshop-rooted lookup.

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
    // NEW v0.29.0 — additive predicates
    if (spec.equals !== undefined && ctx.fm[key] !== undefined && ctx.fm[key] !== spec.equals) {
      ctx.result.violations.push({ rule: `required_frontmatter.${key}.equals`, severity: "error", message: `Field ${key} must equal ${JSON.stringify(spec.equals)}` });
    }
    if (spec.matches && typeof ctx.fm[key] === "string" && !new RegExp(spec.matches).test(ctx.fm[key])) {
      ctx.result.violations.push({ rule: `required_frontmatter.${key}.matches`, severity: "error", message: `Field ${key} does not match pattern ${spec.matches}` });
    }
    if (spec.contains && Array.isArray(ctx.fm[key]) && !spec.contains.every(x => ctx.fm[key].includes(x))) {
      const missing = spec.contains.filter(x => !ctx.fm[key].includes(x));
      ctx.result.violations.push({ rule: `required_frontmatter.${key}.contains`, severity: "error", message: `Field ${key} missing: ${missing.join(", ")}` });
    }
    // NEW v0.31.0 — min_length predicate (list-type frontmatter values)
    if (typeof spec.min_length === "number" && Array.isArray(ctx.fm[key]) && ctx.fm[key].length < spec.min_length) {
      ctx.result.violations.push({
        rule: `required_frontmatter.${key}.min_length`,
        severity: "error",
        message: `Field ${key} must have at least ${spec.min_length} entries, got ${ctx.fm[key].length}`,
      });
    }
    // NEW v0.31.0 — items_schema predicate (discriminated-union per-item validator for object arrays)
    if (spec.items_schema && Array.isArray(ctx.fm[key])) {
      await _checkItemsSchemaInVault(ctx, key, spec.items_schema, ctx.fm[key]);
    }
  }
}

// v0.31.0 — discriminated-union per-item validator (in-vault path).
// Resolves `by_type_source` against consumer-vault override at
// `spice/cowork/engagement-types/<type>.json`. Workshop fallback is not reachable
// from in-vault context; the CLI audit handler in rule-runner.js carries that path.
async function _checkItemsSchemaInVault(ctx, key, schemaSpec, items) {
  if (!schemaSpec || typeof schemaSpec !== "object") return;
  const app = ctx.file && ctx.file.path ? (this && this.app) || window.app : null;
  // ctx.file resolves via Obsidian; reach app via window.app fallback.
  const obsidianApp = window.app || (ctx.app);
  const discriminator = schemaSpec.discriminator;
  const commonRequired = schemaSpec.common_required || null;
  const bySource = schemaSpec.by_type_source || null;

  const CAP = 100;
  const limit = Math.min(items.length, CAP);
  for (let idx = 0; idx < limit; idx++) {
    const item = items[idx];
    if (!item || typeof item !== "object") {
      ctx.result.violations.push({
        rule: `required_frontmatter.${key}[${idx}].not_object`,
        severity: "error",
        message: `Item at index ${idx} is not an object`,
      });
      continue;
    }
    // 1. common_required checks
    if (commonRequired && typeof commonRequired === "object") {
      for (const [fieldKey, fieldSpec] of Object.entries(commonRequired)) {
        _checkInnerFieldInVault(ctx, `${key}[${idx}].${fieldKey}`, fieldSpec, item[fieldKey]);
      }
    }
    // 2. by_type_source per-type required-fields lookup
    if (bySource && discriminator) {
      const typeValue = item[discriminator];
      if (typeof typeValue !== "string" || typeValue.length === 0) {
        // discriminator missing — common_required already surfaced its absence if required.
        continue;
      }
      // Substitute <type> placeholder in path expression "engagement-types/<type>.json#required_fields"
      const hashIdx = bySource.indexOf("#");
      const pathExpr = hashIdx === -1 ? bySource : bySource.slice(0, hashIdx);
      // The fragment identifier after `#` is informational; we always pull `required_fields[]`.
      const concretePath = pathExpr.replace("<type>", typeValue);
      // Consumer-vault override location: spice/cowork/<concretePath>
      const vaultPath = `spice/cowork/${concretePath}`;
      let typeManifest = null;
      try {
        const tfile = obsidianApp && obsidianApp.vault && obsidianApp.vault.getAbstractFileByPath
          ? obsidianApp.vault.getAbstractFileByPath(vaultPath)
          : null;
        if (tfile) {
          const text = await obsidianApp.vault.read(tfile);
          typeManifest = JSON.parse(text);
        }
      } catch (_e) {
        typeManifest = null;
      }
      if (!typeManifest) {
        ctx.result.violations.push({
          rule: `required_frontmatter.${key}[${idx}].items_schema.by_type_source.unresolved`,
          severity: "warn",
          message: `Could not resolve engagement-type manifest for type "${typeValue}" at ${vaultPath} (in-vault override)`,
        });
        continue;
      }
      const reqFields = Array.isArray(typeManifest.required_fields) ? typeManifest.required_fields : [];
      for (const f of reqFields) {
        if (!f || typeof f !== "object" || typeof f.id !== "string") continue;
        const fieldSpec = { required: true };
        if (typeof f.type === "string") fieldSpec.type = f.type;
        _checkInnerFieldInVault(ctx, `${key}[${idx}].${f.id}`, fieldSpec, item[f.id]);
      }
    }
  }
}

// Inner-field assertion for items_schema (in-vault path).
// Supports required + type predicates only (mirrors checkFrontmatter's shape but
// scoped to discriminated-union members; matches type-manifest required_fields entries).
function _checkInnerFieldInVault(ctx, rulePath, fieldSpec, value) {
  if (!fieldSpec || typeof fieldSpec !== "object") return;
  if (fieldSpec.required && (value === undefined || value === null || value === "")) {
    ctx.result.violations.push({
      rule: `required_frontmatter.${rulePath}`,
      severity: "error",
      message: `Missing required field: ${rulePath}`,
    });
    return;
  }
  if (value === undefined || value === null) return;
  if (fieldSpec.type) {
    // engagement-type manifests use "string[]" for list-of-string; normalize.
    const declared = fieldSpec.type === "string[]" ? "array" : fieldSpec.type;
    const actual = Array.isArray(value) ? "array" : typeof value;
    const norm = declared === "list" ? "array" : declared;
    if (actual !== norm && !(declared === "datetime" && actual === "string")) {
      ctx.result.violations.push({
        rule: `required_frontmatter.${rulePath}.type`,
        severity: "warn",
        message: `Field ${rulePath} should be ${fieldSpec.type}, got ${actual}`,
      });
    }
  }
  if (fieldSpec.equals !== undefined && value !== fieldSpec.equals) {
    ctx.result.violations.push({
      rule: `required_frontmatter.${rulePath}.equals`,
      severity: "error",
      message: `Field ${rulePath} must equal ${JSON.stringify(fieldSpec.equals)}`,
    });
  }
  if (fieldSpec.matches && typeof value === "string") {
    try {
      if (!new RegExp(fieldSpec.matches).test(value)) {
        ctx.result.violations.push({
          rule: `required_frontmatter.${rulePath}.matches`,
          severity: "error",
          message: `Field ${rulePath} does not match pattern ${fieldSpec.matches}`,
        });
      }
    } catch (_e) {
      // malformed regex — skip silently (mirrors rule-runner posture)
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
