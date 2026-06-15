/**
 * cowork-readiness.js — CoworkReadiness CustomJS class.
 * Renders a 4-row live-state panel for the cowork onboarding ritual.
 * Embedded in Cowork.md via:
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkReadiness" });
 *
 * v0.65.0 cowork-scheduling-cycle.
 */
class CoworkReadiness {
  async render(dv) {
    const container = dv.el("div", "", { cls: "cowork-readiness-panel" });
    container.style.cssText = `
      background-color: var(--background-secondary);
      border-radius: 12px;
      padding: 16px;
      margin: 12px 0;
      border: 1px solid var(--background-modifier-border);
      box-sizing: border-box;
      width: 100%;
    `;

    const header = container.createEl("div");
    header.innerText = "Cowork readiness";
    header.style.cssText = "font-weight: 600; font-size: 1.05em; margin-bottom: 10px;";

    const list = container.createEl("ul");
    list.style.cssText = "margin: 0; padding-left: 22px; list-style-type: disc; font-size: 0.95em;";

    // Row 1: Engagement
    let engagementLine = "Engagement: (loading…)";
    try {
      const cfg = dv.pages('"spice/cowork/context"').where(p => p.file.name === "vault-config").array()[0];
      const engagements = cfg && Array.isArray(cfg.engagements) ? cfg.engagements : [];
      if (engagements.length > 0) {
        engagementLine = `Engagement: ✓ ${engagements.map(e => (typeof e === "object" ? e.id : e)).join(", ")}`;
      } else {
        engagementLine = "Engagement: ✗ none — run cowork:bootstrap-vault";
      }
    } catch (e) {
      engagementLine = "Engagement: ✗ vault-config.md not readable";
    }
    list.createEl("li").innerText = engagementLine;

    // Row 2: Prompts
    let promptsLine = "Prompts: (loading…)";
    try {
      const promptFiles = dv.pages('"spice/cowork/prompts"').array();
      const required = ["morning-briefing", "midday-tripwire", "eod-review", "weekly-review", "monthly-review"];
      const present = required.filter(name => promptFiles.some(p => p.file.name === name));
      const emptyStubs = present.filter(name => {
        const p = promptFiles.find(f => f.file.name === name);
        return p && (typeof p.file.size !== "number" || p.file.size < 400);
      });
      promptsLine = `Prompts: ${present.length}/${required.length} present (${emptyStubs.length} empty stubs)`;
    } catch (e) {
      promptsLine = "Prompts: ✗ spice/cowork/prompts/ not readable";
    }
    list.createEl("li").innerText = promptsLine;

    // Row 3: MCP routing (from .routing-cache.json)
    let routingLine = "MCP routing: (no cache — runs cowork:check-vault-routing on first scheduled invocation)";
    try {
      const cachePages = dv.pages('"spice/cowork"').where(p => p.file.name === ".routing-cache").array();
      const cache = cachePages[0];
      if (cache && typeof cache.status === "string") {
        const lastChecked = cache.last_checked ? ` (last checked: ${cache.last_checked})` : "";
        routingLine = cache.status === "ready"
          ? `MCP routing: ✓ ready${lastChecked}`
          : `MCP routing: ✗ ${cache.status}${lastChecked}`;
      }
    } catch (e) {
      // leave routingLine as-is
    }
    list.createEl("li").innerText = routingLine;

    // Row 4: Last runs per orchestrator (via ActivityFeed query)
    const orchestrators = [
      { slug: "morning-briefing", type: "cowork-morning-briefing" },
      { slug: "midday-tripwire",  type: "cowork-midday-tripwire" },
      { slug: "eod-review",       type: "cowork-eod-review" },
      { slug: "weekly-review",    type: "cowork-weekly-review" },
      { slug: "monthly-review",   type: "cowork-monthly-review" },
    ];
    const runsHeader = container.createEl("div");
    runsHeader.innerText = "Last runs:";
    runsHeader.style.cssText = "margin-top: 12px; font-weight: 600; font-size: 0.95em;";
    const runsList = container.createEl("ul");
    runsList.style.cssText = "margin: 4px 0 0 0; padding-left: 22px; list-style-type: disc; font-size: 0.9em;";
    for (const orch of orchestrators) {
      let lastLine = `${orch.slug}: (never)`;
      try {
        const matches = dv.pages('"spice/cowork"')
          .where(p => p.type === orch.type)
          .sort(p => p.created_at, "desc")
          .limit(1)
          .array();
        if (matches.length > 0) {
          const ts = matches[0].created_at ? String(matches[0].created_at) : "(no timestamp)";
          lastLine = `${orch.slug}: ${ts}`;
        }
      } catch (e) {
        // leave as never
      }
      runsList.createEl("li").innerText = lastLine;
    }

    // Row 5: Expected jobs (parsed from scheduled-jobs.md, cross-checked vs last-runs)
    const jobsHeader = container.createEl("div");
    jobsHeader.innerText = "Expected jobs:";
    jobsHeader.style.cssText = "margin-top: 12px; font-weight: 600; font-size: 0.95em;";
    let jobsLine = "(no scheduled-jobs.md — run cowork:onboard-scheduled-jobs)";
    try {
      const jobsPages = dv.pages('"spice/cowork"').where(p => p.file.name === "scheduled-jobs").array();
      const jobsNote = jobsPages[0];
      if (jobsNote && Array.isArray(jobsNote.file.tasks) === false) {
        // Count table rows minus header — naive but works for our shipped template
        const body = jobsNote.file.text || "";
        const tableRows = (body.match(/^\|\s*cowork:/gm) || []).length;
        if (tableRows === 0) {
          jobsLine = "Expected jobs: 0 configured — run cowork:onboard-scheduled-jobs";
        } else {
          // Cross-check against last-runs: count how many of `orchestrators` have a recent run today
          let firedToday = 0;
          const todayYMD = window.moment().format("YYYY-MM-DD");
          for (const orch of orchestrators) {
            const recent = dv.pages('"spice/cowork"')
              .where(p => p.type === orch.type && typeof p.created_at === "string" && p.created_at.startsWith(todayYMD))
              .array();
            if (recent.length > 0) firedToday++;
          }
          jobsLine = `Expected jobs: ${tableRows} configured · ${firedToday} fired today`;
        }
      }
    } catch (e) {
      // leave fallback
    }
    const jobsRowEl = container.createEl("div");
    jobsRowEl.innerText = jobsLine;
    jobsRowEl.style.cssText = "margin: 4px 0 0 0; font-size: 0.9em;";
  }
}
