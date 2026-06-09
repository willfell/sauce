// platform/mechanisms/cowork-reconciler/heartbeat-check.js
//
// Wraps check-heartbeat-helper for the reconciler's per-engagement flow.
// Walks the 30-day sidecar window, evaluates freshness against the
// engagement's enabled cadences, and (when missed) upserts a
// > [!warning]+ Cron heartbeat anomaly callout into today's memory.md.
//
// Synchronous: HC harness contract.

const fs = require("node:fs");
const path = require("node:path");
const chb = require("../../blueprints/cowork/helpers/check-heartbeat-helper");

function _todayDirRel() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const monthName = now.toLocaleString("en-US", { month: "long" });
  return path.join(String(yyyy), `${mm}-${monthName}`, `${yyyy}-${mm}-${dd}`);
}

function _enabledCadences(engagement) {
  const out = [];
  if (!engagement || !engagement.cadences) return out;
  const c = engagement.cadences;
  if (c.morning) out.push("morning-briefing");
  if (c.midday) out.push("midday-tripwire");
  if (c.eod) out.push("eod-review");
  if (c.weekly) out.push("weekly-review");
  if (c.monthly) out.push("monthly-review");
  if (c.lens_shift) out.push("lens_shift");
  return out;
}

function _upsertHeartbeatCallout(existing, newCallout) {
  // Idempotent same-day replace: if a > [!warning]+ Cron heartbeat anomaly
  // callout already exists, replace it; else append before ## Ticks (if
  // present) or at file end.
  const calloutRx = />\s*\[!warning\]\+\s+Cron heartbeat anomaly[\s\S]*?(?=\n>?\s*\n[^>]|\n##|$)/;
  if (calloutRx.test(existing)) {
    return existing.replace(calloutRx, newCallout);
  }
  const ticksRx = /(\n)## Ticks/;
  if (ticksRx.test(existing)) {
    return existing.replace(ticksRx, `\n\n${newCallout}\n$1## Ticks`);
  }
  return existing.trimEnd() + "\n\n" + newCallout + "\n";
}

function runForEngagement(opts) {
  const { vault_path, engagement_id, engagement, dry_run = false } = opts || {};
  if (!vault_path || !engagement_id) {
    throw new Error("runForEngagement: vault_path + engagement_id required");
  }

  const enabled_cadences = _enabledCadences(engagement);
  if (enabled_cadences.length === 0) {
    return { missed_count: 0, first_fire: true, skipped: "no-enabled-cadences" };
  }

  const last_fires = chb.walkCadenceSidecars({
    vault_root: vault_path,
    engagement_id,
    days: 30,
  });
  const windows = (chb._loadFreshnessWindows(vault_path) || {}).windows_hours || {};
  const result = chb.evaluateFreshness({
    windows_hours: windows,
    expected_cadences: enabled_cadences,
    last_fires,
    now: new Date(),
  });

  if (!result || !result.missed || result.missed.length === 0) {
    return {
      missed_count: 0,
      first_fire: result ? result.first_fire : true,
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const calloutBody = chb.composeHeartbeatCallout(result.missed, result.first_fire, today);

  if (!dry_run) {
    const memoryPath = path.join(
      vault_path,
      "spice/cowork/memory",
      engagement_id,
      _todayDirRel(),
      "memory.md"
    );
    if (fs.existsSync(memoryPath)) {
      const existing = fs.readFileSync(memoryPath, "utf8");
      const next = _upsertHeartbeatCallout(existing, calloutBody);
      fs.writeFileSync(memoryPath, next, "utf8");
    }
  }

  return {
    missed_count: result.missed.length,
    first_fire: result.first_fire,
    missed: result.missed,
  };
}

module.exports = {
  runForEngagement,
  _todayDirRel,
  _enabledCadences,
  _upsertHeartbeatCallout,
};
