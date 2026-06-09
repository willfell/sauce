// platform/mechanisms/cowork-reconciler/sidecar-backfill.js
//
// Backfills missing .cowork.json sidecars from the prose of their
// companion .md atomic notes. Walks the last 30 days of
// spice/cowork/daily and writes a minimal sidecar for any .md without
// a sibling .cowork.json. Item-level features are unrecoverable from
// prose without an LLM, so items[] stays empty; surfaced_kinds[] is
// inferred from > [!example|warning]+ callout titles.
//
// Synchronous.

const fs = require("node:fs");
const path = require("node:path");

const RECONCILER_VERSION = "0.97.0";

const CADENCE_BY_FRONTMATTER_TYPE = {
  "cowork-morning-briefing": "morning-briefing",
  "cowork-morning-briefing-cold": "morning-briefing",
  "cowork-midday-tripwire": "midday-tripwire",
  "cowork-eod-review": "eod-review",
  "cowork-weekly-review": "weekly-review",
  "cowork-monthly-review": "monthly-review",
};

function _parseMdFrontmatter(content) {
  const m = content.match(/^---\s*\n([\s\S]+?)\n---/);
  if (!m) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const fieldMatch = line.match(/^([a-z_][a-zA-Z_]*):\s*(.+)$/);
    if (fieldMatch) {
      const key = fieldMatch[1];
      let val = fieldMatch[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      fm[key] = val;
    }
  }
  return { frontmatter: fm, body: content.slice(m[0].length) };
}

// Map a callout title to a `kind` key.
// Priority order:
//   1. Exact-prefix match against the engagement's `priorities` array
//      (case-insensitive). "Calendar - Today" matches "calendar".
//   2. Heuristic substring fallback for well-known surface categories.
function _inferKindFromCalloutTitle(title, priorities) {
  if (!title) return null;
  const lower = title.toLowerCase();
  if (Array.isArray(priorities)) {
    for (const kind of priorities) {
      if (typeof kind !== "string") continue;
      if (lower.startsWith(kind.toLowerCase())) return kind;
    }
  }
  if (lower.includes("calendar")) return "calendar";
  if (lower.includes("email") || lower.includes("gmail") || lower.includes("inbox")) return "email";
  if (lower.includes("chat") || lower.includes("teams") || lower.includes("slack") || lower.includes("conversation")) return "chat";
  if (lower.includes("message")) return "messages";
  if (lower.includes("finance") || lower.includes("debt") || lower.includes("scoreboard")) return "finance";
  if (lower.includes("project") || lower.includes("kanban")) return "projects";
  if (lower.includes("thread")) return "threads";
  if (lower.includes("github") || lower.includes("pull request")) return "github";
  if (lower.includes("ado") || lower.includes("azure devops") || lower.includes("work item")) return "ado";
  return null;
}

function backfillSidecar(opts) {
  const { mdPath, engagementPriorities } = opts || {};
  if (!mdPath) throw new Error("backfillSidecar: mdPath required");
  const stat = fs.statSync(mdPath);
  const fileMtime = stat.mtime;
  const content = fs.readFileSync(mdPath, "utf8");
  const { frontmatter } = _parseMdFrontmatter(content);

  const surfaced_kinds = [];
  // Match both [!example] and [!warning] callouts with optional +/- modifier.
  const calloutRx = /^>\s*\[!(?:example|warning)\][+\-]?\s+(.+)$/gm;
  let m;
  while ((m = calloutRx.exec(content)) !== null) {
    const title = m[1].trim();
    const kind = _inferKindFromCalloutTitle(title, engagementPriorities || []);
    if (kind && !surfaced_kinds.includes(kind)) surfaced_kinds.push(kind);
  }

  const origGenerator = frontmatter.generator || "cowork:unknown@?";
  return {
    schema_version: "1.0.0",
    generated_by: `${origGenerator} (reconciler-backfill@${RECONCILER_VERSION})`,
    generated_at: fileMtime.toISOString(),
    cadence: CADENCE_BY_FRONTMATTER_TYPE[frontmatter.type] || "unknown",
    engagement_id: frontmatter.engagement_id || "",
    frontmatter,
    surfaced_kinds,
    surfaced_items: [],
    render_aspects_applied: [],
    memory_used: {
      yesterday_present: false,
      drift_warning_present: false,
      echoes_count: 0,
    },
    plan_dispatch: {
      mode: "reconciler-backfill",
      kinds_dispatched: surfaced_kinds.length,
      warnings_emitted: 0,
    },
  };
}

function backfillMissing(opts) {
  const { vault_path, engagement_id, dry_run = false } = opts || {};
  if (!vault_path) throw new Error("backfillMissing: vault_path required");

  const dailyRoot = path.join(vault_path, "spice/cowork/daily");
  let backfilled_count = 0;
  let validated_count = 0;
  if (!fs.existsSync(dailyRoot)) {
    return { backfilled_count, validated_count };
  }

  const now = new Date();
  for (let d = 0; d < 30; d++) {
    const date = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const monthName = date.toLocaleString("en-US", { month: "long" });
    const dayDir = path.join(
      dailyRoot,
      String(yyyy),
      `${mm}-${monthName}`,
      `${yyyy}-${mm}-${dd}`
    );
    if (!fs.existsSync(dayDir)) continue;

    let entries;
    try {
      entries = fs.readdirSync(dayDir);
    } catch (_) {
      continue;
    }

    for (const file of entries) {
      if (!file.endsWith(".md")) continue;
      // Skip sidecar JSON companions (defensive — readdirSync doesn't
      // mix extensions but the .endsWith(".md") already filters them).
      const mdPath = path.join(dayDir, file);
      const sidecarPath = mdPath.replace(/\.md$/, ".cowork.json");

      let content;
      try {
        content = fs.readFileSync(mdPath, "utf8");
      } catch (_) {
        continue;
      }
      const { frontmatter } = _parseMdFrontmatter(content);
      if (
        engagement_id &&
        frontmatter.engagement_id &&
        frontmatter.engagement_id !== engagement_id
      ) {
        continue;
      }

      if (!fs.existsSync(sidecarPath)) {
        const sidecar = backfillSidecar({ mdPath, engagementPriorities: [] });
        if (!dry_run) {
          fs.writeFileSync(
            sidecarPath,
            JSON.stringify(sidecar, null, 2) + "\n",
            "utf8"
          );
        }
        backfilled_count += 1;
      } else {
        validated_count += 1;
      }
    }
  }

  return { backfilled_count, validated_count };
}

module.exports = {
  backfillSidecar,
  backfillMissing,
  _inferKindFromCalloutTitle,
  _parseMdFrontmatter,
  RECONCILER_VERSION,
  CADENCE_BY_FRONTMATTER_TYPE,
};
