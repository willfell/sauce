// platform/blueprints/daily/seed/seed.js
// Generates 30 daily notes across the 30 days ending at --anchor-date.
// Programmatic (β) seed — deterministic given (blueprint, anchor_date) via ctx.rng.

module.exports = {
    schema_version: 1,
    kind: "programmatic",
    seed(ctx) {
        const moods = ["good", "neutral", "busy"];
        let notesCreated = 0;
        for (let i = 0; i < 30; i++) {
            const date = ctx.daysAgo(i);
            const dateStr = date.format("YYYY-MM-DD");
            const folderRoute = date.format("YYYY/MM-MMMM");
            const wakeup = ctx.helpers.jitterTime("07:30", 15, ctx.rng);
            const mood = ctx.helpers.pickFrom(moods, ctx.rng);
            // body_template is best-effort: if template exists, render with vars; else write a minimal stub.
            let body;
            try {
                body = ctx.helpers.renderTemplate("content/daily-template.md", { date: dateStr, wakeup, mood });
            } catch {
                body = `# ${dateStr}\n\nMorning notes go here.\n`;
            }
            const r = ctx.writeNote({
                path: `spice/${ctx.moduleDir}/${folderRoute}/${dateStr}.md`,
                frontmatter: { date: dateStr, wakeup, mood },
                body,
            });
            if (!r.skipped) notesCreated++;
        }
        return { notesCreated };
    }
};
