/**
 * cowork-latest-runs.js — CoworkLatestRuns CustomJS class.
 *
 * Renders a 5-row panel showing the most recent atomic run-note PER
 * ORCHESTRATOR (morning-briefing, midday-tripwire, eod-review, weekly-review,
 * monthly-review) with a body-content preview. Each row is clickable to open
 * the atomic note.
 *
 * Embedded in Cowork.md directly under the CoworkReadiness panel via:
 *   await dv.view("ranch/views/customjs-guard", { class: "CoworkLatestRuns" });
 *
 * v0.68.0 cowork-orchestrator-cohesion cycle.
 */
class CoworkLatestRuns {
  async render(dv) {
    const orchestrators = [
      { slug: "morning-briefing", type: "cowork-morning-briefing", label: "Morning briefing" },
      { slug: "midday-tripwire",  type: "cowork-midday-tripwire",  label: "Midday tripwire" },
      { slug: "eod-review",       type: "cowork-eod-review",       label: "EOD review" },
      { slug: "weekly-review",    type: "cowork-weekly-review",    label: "Weekly review" },
      { slug: "monthly-review",   type: "cowork-monthly-review",   label: "Monthly review" },
    ];

    const container = dv.el("div", "", { cls: "cowork-latest-runs-panel" });
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
    header.innerText = "Latest cowork runs";
    header.style.cssText = "font-weight: 600; font-size: 1.05em; margin-bottom: 10px;";

    const list = container.createEl("ul");
    list.style.cssText = "margin: 0; padding-left: 0; list-style-type: none; font-size: 0.95em;";

    for (const orch of orchestrators) {
      const row = list.createEl("li");
      row.style.cssText = "margin: 8px 0; padding: 8px 10px; background-color: var(--background-primary); border-radius: 8px; border: 1px solid var(--background-modifier-border-hover);";

      let latest = null;
      try {
        const matches = dv.pages('"spice/cowork"')
          .where(p => p && p.type === orch.type)
          .sort(p => p.created_at, "desc")
          .limit(1)
          .array();
        latest = matches[0] || null;
      } catch (e) {
        latest = null;
      }

      const titleLine = row.createEl("div");
      titleLine.style.cssText = "font-weight: 600; font-size: 0.95em; display: flex; justify-content: space-between; align-items: baseline; gap: 12px;";

      const slugSpan = titleLine.createEl("span");
      slugSpan.innerText = orch.label;
      slugSpan.style.cssText = "color: var(--text-normal);";

      const tsSpan = titleLine.createEl("span");
      tsSpan.style.cssText = "font-weight: 400; font-size: 0.85em; color: var(--text-muted); font-family: var(--font-monospace);";

      if (!latest) {
        tsSpan.innerText = "(never)";
        const previewLine = row.createEl("div");
        previewLine.innerText = "No run-note yet — scheduled invocation has not fired (or wrote to wrong slot — check orchestrator)";
        previewLine.style.cssText = "margin-top: 4px; font-size: 0.85em; color: var(--text-faint); font-style: italic;";
        continue;
      }

      const ts = typeof latest.created_at === "string" ? latest.created_at : "(no timestamp)";
      tsSpan.innerText = ts;

      // Wire row click to open the atomic note
      const targetPath = latest.file && typeof latest.file.path === "string" ? latest.file.path : null;
      if (targetPath) {
        row.style.cursor = "pointer";
        row.addEventListener("click", (evt) => {
          evt.preventDefault();
          app.workspace.openLinkText(targetPath, "");
        });
      }

      // Body preview — first ~200 chars after frontmatter
      let preview = "";
      try {
        const body = (latest.file && typeof latest.file.text === "string") ? latest.file.text : "";
        // Strip leading YAML frontmatter block (--- ... ---)
        let afterFm = body;
        if (body.startsWith("---")) {
          const closeIdx = body.indexOf("\n---", 3);
          if (closeIdx !== -1) {
            afterFm = body.slice(closeIdx + 4);
          }
        }
        preview = afterFm.trim().replace(/\s+/g, " ").slice(0, 200);
        if (preview.length === 200) preview += "…";
      } catch (e) {
        preview = "";
      }

      if (preview) {
        const previewLine = row.createEl("div");
        previewLine.innerText = preview;
        previewLine.style.cssText = "margin-top: 4px; font-size: 0.85em; color: var(--text-muted); line-height: 1.4;";
      }
    }
  }
}
