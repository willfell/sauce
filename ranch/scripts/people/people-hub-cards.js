/**
 * People Hub Cards (CustomJS)
 * Thin wrapper over BeaconCards (cards mechanism v0.1.1+) using the "row"
 * layout: name left, company right, title as subtitle. Mirrors
 * ProjectsHubCards / TripsHubCards precedent.
 *
 * Usage in DataviewJS:
 *   await dv.view("ranch/views/customjs-guard", { class: "PeopleHubCards" });
 */
class PeopleHubCards {
  async render(dv, opts) {
    // Embed-dedup: when this hub is embedded via ![[People]] in another note,
    // suppress the inner render so cards don't double up.
    if (dv.container.closest(".markdown-embed")) return;

    const people = dv.pages('"spice/people"')
      .where(p => p.file.name !== "People")
      .sort(p => p.file.name, "asc");

    if (!people.length) {
      const empty = dv.container.createEl("div", {
        text: "No people yet — click + New Person above to create your first."
      });
      empty.style.cssText = "color: var(--text-muted); font-style: italic; padding: 8px;";
      return;
    }

    await customJS.BeaconCards.render(dv, {
      pages: people,
      layout: "row",
      columns: 1,
      title: (p) => p.file.name,
      meta: (p) => p.company || null,
      subtitle: (p) => p.title || null
    });
  }
}
