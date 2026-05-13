/**
 * Teams Hub Cards (CustomJS)
 * Renders the hub at spice/teams/Teams.md. Cards grouped by Product (section per product).
 * Each card: team name, description, active-project count, status histogram chip
 * (e.g. "3 in-progress · 2 planning · 1 blocked · 2 done").
 * Filter chip stub: by product (multi-select) — Phase 1 ships group-by-only; chip
 * UI lands when ProjectsHubCards's chip pattern is settled in S6 (then refactor).
 *
 * Usage:
 *   await dv.view("ranch/views/customjs-guard", { class: "TeamsHubCards" });
 */
class TeamsHubCards {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;

    const teams = dv.pages('"spice/teams"').where(t => t.file.name !== "Teams" && t.type === "team");
    if (!teams.length) {
      const empty = dv.container.createEl("div", {
        text: "No teams yet — use /teams or click + New Team. Each team needs a product: wikilink."
      });
      empty.style.cssText = "color: var(--text-muted); font-style: italic; padding: 8px;";
      return;
    }

    const projects = dv.pages('"spice/projects"').where(p => p.type === "project");
    const STATUS_ORDER = ["in-progress", "planning", "blocked", "idea", "done", "superseded", "cancelled"];
    const ACTIVE = new Set(["idea", "planning", "in-progress", "blocked"]);

    // Compute per-team: active count + status histogram
    const enriched = teams.map(t => {
      const teamLinkPath = t.file.link.path;
      const memberProjects = projects.where(p => (p.teams || []).some(link => link.path === teamLinkPath));
      const hist = {};
      memberProjects.forEach(p => { hist[p.status] = (hist[p.status] || 0) + 1; });
      const histStr = STATUS_ORDER
        .filter(s => hist[s])
        .map(s => `${hist[s]} ${s}`)
        .join(" · ");
      const activeCount = memberProjects.where(p => ACTIVE.has(p.status)).length;
      return { team: t, activeCount, histStr };
    });

    // Group by product link path
    const groups = new Map();
    enriched.forEach(e => {
      const key = e.team.product ? e.team.product.path : "(no product)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    // Sort group keys by product name (alphabetical)
    const sortedKeys = [...groups.keys()].sort();

    for (const key of sortedKeys) {
      const header = dv.container.createEl("h2", { text: key === "(no product)" ? key : `[[${key.replace(/\.md$/, "")}]]` });
      header.style.cssText = "margin-top: 16px; margin-bottom: 4px;";
      const groupTeams = groups.get(key);
      groupTeams.sort((a, b) => a.team.file.name.localeCompare(b.team.file.name));

      await customJS.BeaconCards.render(dv, {
        pages: groupTeams.map(e => e.team),
        layout: "row",
        columns: 1,
        title: (t) => t.file.name,
        subtitle: (t) => t.description || null,
        meta: (t) => {
          const e = enriched.find(x => x.team.file.path === t.file.path);
          const active = `${e.activeCount} active`;
          return e.histStr ? `${active} · ${e.histStr}` : active;
        }
      });
    }
  }
}
