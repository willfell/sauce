/**
 * Products Hub Cards (CustomJS)
 * Renders the hub at spice/products/Products.md. One card per product note.
 * Cards show: name, description, team count, active-project count, last-touched recency.
 * Sort: recent activity first (most-recently-touched project), alphabetical tiebreaker.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "ProductsHubCards" });
 */
class ProductsHubCards {
  async render(dv, opts) {
    if (dv.container.closest(".markdown-embed")) return;

    const products = dv.pages('"spice/products"')
      .where(p => p.file.name !== "Products" && p.type === "product");

    if (!products.length) {
      const empty = dv.container.createEl("div", {
        text: "No products yet — use /products or click + New Product to create your first."
      });
      empty.style.cssText = "color: var(--text-muted); font-style: italic; padding: 8px;";
      return;
    }

    // Pre-compute team + project counts + last-touched per product
    const teams = dv.pages('"spice/teams"').where(t => t.type === "team");
    const projects = dv.pages('"spice/projects"').where(p => p.type === "project");
    const ACTIVE = new Set(["idea", "planning", "in-progress", "blocked"]);

    const enriched = products.map(p => {
      const productLink = p.file.link.path;
      const memberTeams = teams.where(t => t.product && t.product.path === productLink);
      const memberTeamLinks = new Set(memberTeams.map(t => t.file.link.path));
      const memberProjects = projects.where(pr =>
        (pr.products || []).some(link => link.path === productLink) ||
        (pr.teams || []).some(link => memberTeamLinks.has(link.path))
      );
      const activeProjects = memberProjects.where(pr => ACTIVE.has(pr.status));
      // last-touched: max status_changed_at across member projects
      const dates = memberProjects.map(pr => pr.status_changed_at || pr.created || "1970-01-01");
      const lastTouched = dates.array().sort().pop() || null;
      return { product: p, teamCount: memberTeams.length, activeCount: activeProjects.length, lastTouched };
    });

    // Sort: lastTouched desc, alphabetical tiebreaker
    enriched.sort((a, b) => {
      const at = a.lastTouched || "1970-01-01";
      const bt = b.lastTouched || "1970-01-01";
      if (at !== bt) return bt.localeCompare(at);
      return a.product.file.name.localeCompare(b.product.file.name);
    });

    await customJS.BeaconCards.render(dv, {
      pages: enriched.map(e => e.product),
      layout: "row",
      columns: 1,
      title: (p) => p.file.name,
      subtitle: (p) => p.description || null,
      meta: (p) => {
        const e = enriched.find(x => x.product.file.path === p.file.path);
        const teamPart = `${e.teamCount} team${e.teamCount === 1 ? "" : "s"}`;
        const projPart = `${e.activeCount} active project${e.activeCount === 1 ? "" : "s"}`;
        const datePart = e.lastTouched ? `· last touched ${e.lastTouched}` : "";
        return `${teamPart} · ${projPart} ${datePart}`.trim();
      }
    });
  }
}
