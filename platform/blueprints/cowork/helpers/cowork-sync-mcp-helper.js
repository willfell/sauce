// platform/blueprints/cowork/helpers/cowork-sync-mcp-helper.js
//
// Diff logic for Rail A auto-sync. Pure JS. Called by cowork:sync-scheduled-jobs
// after the LLM composes wrappers + lists live tasks.

const TASK_NAME_RX = /^cowork-(.+)-(.+)$/;

function diffWrappersAgainstLive(composed, live) {
  if (!Array.isArray(composed)) throw new Error("composed must be an array");
  if (!Array.isArray(live)) throw new Error("live must be an array");

  const composedByName = new Map(composed.map((c) => [c.task_name, c]));
  const liveByName = new Map(live.map((l) => [l.name, l]));

  const result = { changed: [], new: [], orphan: [], noop: [] };

  for (const c of composed) {
    const liveTask = liveByName.get(c.task_name);
    if (!liveTask) {
      result.new.push({ task_name: c.task_name, composed_prompt: c.prompt });
    } else if (liveTask.prompt !== c.prompt) {
      result.changed.push({
        task_id: liveTask.task_id,
        task_name: c.task_name,
        composed_prompt: c.prompt,
        live_prompt_excerpt: (liveTask.prompt || "").slice(0, 200),
      });
    } else {
      result.noop.push({ task_id: liveTask.task_id, task_name: c.task_name });
    }
  }

  for (const l of live) {
    if (!TASK_NAME_RX.test(l.name)) continue;
    if (!composedByName.has(l.name)) {
      result.orphan.push({
        task_id: l.task_id,
        task_name: l.name,
        live_cron: l.cron,
      });
    }
  }

  return result;
}

module.exports = {
  diffWrappersAgainstLive,
  TASK_NAME_RX,
};
