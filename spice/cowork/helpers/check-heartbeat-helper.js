// platform/blueprints/cowork/helpers/check-heartbeat-helper.js
//
// Rail H — walks .cowork.json sidecars under spice/cowork/daily/<date>/
// to compute per-cadence last-fire timestamps; evaluates freshness against
// cadence-freshness-windows.json; emits warning callout when any expected
// cadence missed its window. Pure data — no MCP / LLM calls.

const fs = require("node:fs");
const path = require("node:path");

const CADENCE_BY_TYPE = {
  "cowork-morning-briefing": "morning-briefing",
  "cowork-morning-briefing-cold": "lens-shift",
  "cowork-midday-tripwire": "midday-tripwire",
  "cowork-eod-review": "eod-review",
  "cowork-finance": "finance",
  "cowork-weekly-review": "weekly-review",
  "cowork-monthly-review": "monthly-review",
};

function _walkSidecarFiles(dailyRoot) {
  if (!fs.existsSync(dailyRoot)) return [];
  const results = [];
  function recurse(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".cowork.json")) {
        results.push(fullPath);
      }
    }
  }
  recurse(dailyRoot);
  return results;
}

function walkCadenceSidecars(opts) {
  const { vault_root, engagement_id, days = 30 } = opts || {};
  const dailyRoot = path.join(vault_root || ".", "spice", "cowork", "daily");
  const sidecarFiles = _walkSidecarFiles(dailyRoot);
  const result = {};
  for (const fullPath of sidecarFiles) {
    let sidecar = null;
    try { sidecar = JSON.parse(fs.readFileSync(fullPath, "utf8")); } catch (_) { continue; }
    if (engagement_id && sidecar.engagement_id && sidecar.engagement_id !== engagement_id) continue;
    const fmType = sidecar.frontmatter && sidecar.frontmatter.type;
    const cadence = CADENCE_BY_TYPE[fmType];
    if (!cadence) continue;
    const generated_at = sidecar.generated_at;
    if (!generated_at) continue;
    const existing = result[cadence];
    if (!existing) {
      result[cadence] = { last_fire_at: generated_at, count_in_window: 1 };
    } else {
      result[cadence].count_in_window += 1;
      if (generated_at > existing.last_fire_at) {
        existing.last_fire_at = generated_at;
      }
    }
  }
  return result;
}

function evaluateFreshness(opts) {
  const { windows_hours, expected_cadences, last_fires, now } = opts || {};
  if (!Array.isArray(expected_cadences) || !windows_hours) {
    return { missed: [], green: [], first_fire: false };
  }
  const nowDate = now instanceof Date ? now : new Date(now || Date.now());
  const missed = [];
  const green = [];
  let anyFireFound = false;
  for (const cadence of expected_cadences) {
    const window_hours = windows_hours[cadence];
    if (!window_hours) {
      green.push({ cadence, reason: "no-window-configured" });
      continue;
    }
    const fireRecord = (last_fires || {})[cadence];
    if (!fireRecord || !fireRecord.last_fire_at) {
      missed.push({ cadence, last_fire_at: null, expected_window_hours: window_hours });
      continue;
    }
    anyFireFound = true;
    const last = new Date(fireRecord.last_fire_at);
    const ageHours = (nowDate - last) / (1000 * 60 * 60);
    if (ageHours <= window_hours) {
      green.push({ cadence, last_fire_at: fireRecord.last_fire_at, age_hours: ageHours });
    } else {
      missed.push({
        cadence,
        last_fire_at: fireRecord.last_fire_at,
        expected_window_hours: window_hours,
        actual_age_hours: ageHours,
      });
    }
  }
  return { missed, green, first_fire: !anyFireFound };
}

function composeHeartbeatCallout(missed, first_fire, today) {
  if (!Array.isArray(missed) || missed.length === 0) return "";
  const dateLabel = today || new Date().toISOString().slice(0, 10);
  const lines = missed.map((m) => {
    const last = m.last_fire_at ? `last fired ${m.last_fire_at}` : "never fired";
    return `> - **${m.cadence}**: ${last} (expected: within ${m.expected_window_hours} hours)`;
  });
  const intro = first_fire
    ? `> No v0.96.0+ sidecars found yet — this may be the first post-upgrade fire. Revisit tomorrow to confirm.`
    : `> Some scheduled cadences haven't fired within their expected windows:`;
  return [
    `> [!warning]+ Cron heartbeat anomaly — ${dateLabel}`,
    intro,
    ...lines,
    `>`,
    `> Investigate the scheduled-job configuration in claude.ai's Cowork UI, or run \`/cowork sync-scheduled-jobs <engagement_id>\` to refresh the paste-blocks. Confirm the job's task ID exists + is enabled.`,
  ].join("\n");
}

function _loadFreshnessWindows(vault_root) {
  const consumer = path.join(vault_root || "", ".claude/skills/cowork/data/cadence-freshness-windows.json");
  const workshop = path.join(__dirname, "..", "data", "cadence-freshness-windows.json");
  const tryPath = (p) => {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (_) { return null; }
  };
  return tryPath(consumer) || tryPath(workshop) || { schema_version: "1.0.0", windows_hours: {} };
}

module.exports = {
  CADENCE_BY_TYPE,
  walkCadenceSidecars,
  evaluateFreshness,
  composeHeartbeatCallout,
  _loadFreshnessWindows,
};
