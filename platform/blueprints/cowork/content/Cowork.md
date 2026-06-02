---
type: cowork-hub
created_at: "2026-05-17T15:03:00-06:00"
tags: [cowork-hub]
---

# Cowork

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

```dataviewjs
// Scaffold-status callout (v0.42.0): detects missing engagements + missing
// timeframe notes + missing prompt stubs; renders a single ! callout listing
// gaps + the Claude invocation to run. Renders nothing when scaffolding complete.
const vaultConfig = app.vault.getAbstractFileByPath("spice/cowork/context/vault-config.md");
let bootstrapped = false;
if (vaultConfig) {
  const cache = app.metadataCache.getFileCache(vaultConfig);
  const engagements = cache?.frontmatter?.engagements;
  bootstrapped = Array.isArray(engagements) && engagements.length > 0;
}

const now = window.moment();
const isoWeekLabel = now.format("YYYY-[W]ww");
const monthLabel = now.format("YYYY-MM");
const year = now.format("YYYY");
const weeklyExists = !!app.vault.getAbstractFileByPath(`spice/cowork/weekly/${year}/${isoWeekLabel}.md`);
const monthlyExists = !!app.vault.getAbstractFileByPath(`spice/cowork/monthly/${year}/${monthLabel}.md`);
const promptNames = ["morning-briefing", "eod-review", "weekly-review", "monthly-review"];
const missingPrompts = promptNames.filter(n => !app.vault.getAbstractFileByPath(`spice/cowork/prompts/${n}.md`));

const gaps = [];
if (!bootstrapped)   gaps.push("Engagements (run `cowork:bootstrap-vault` to interview)");
if (!weeklyExists)   gaps.push(`This week's note (\`${isoWeekLabel}.md\`) — run \`cowork:scaffold-timeframes\``);
if (!monthlyExists)  gaps.push(`This month's note (\`${monthLabel}.md\`) — run \`cowork:scaffold-timeframes\``);
if (missingPrompts.length) gaps.push("Prompt stubs: " + missingPrompts.join(", ") + " — re-run `sauce reinstall`");

if (gaps.length > 0) {
  dv.paragraph("> [!warning]+ Cowork scaffold incomplete\n> " + gaps.map(g => "- [ ] " + g).join("\n> ") + "\n> \n> Run `cowork:bootstrap-vault` in a Claude session inside this vault to address everything at once.");
}
```

---

## Readiness

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkReadiness" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkLatestRuns" });
```

---

## Timeframes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkTimeframeButtons" });
```

---

## Engagements + cadences

<!-- BOOTSTRAP_ENGAGEMENT_TABLE_BEGIN -->

The nav-button table below is rendered by `cowork:bootstrap-vault` at first run (and refreshed by every re-bootstrap pass). Rows = engagements; columns = supported cadences. Each cell is a nav-button that invokes the matching orchestrator with `engagement_id` already bound.

Before bootstrap runs, this section is empty — the warning callout above prompts you to run `cowork:bootstrap-vault`.

<!-- BOOTSTRAP_ENGAGEMENT_TABLE_END -->

```dataviewjs
// Renders a "Last run" stamp column per (engagement, cadence) pair by scanning
// recent daily notes for the matching ## <Cadence> — <Engagement.label> H2 blocks.
// Pre-bootstrap: silent no-op.
const vaultConfig = app.vault.getAbstractFileByPath("spice/cowork/context/vault-config.md");
if (vaultConfig) {
  const cache = app.metadataCache.getFileCache(vaultConfig);
  const engagements = cache?.frontmatter?.engagements;
  if (Array.isArray(engagements) && engagements.length > 0) {
    dv.paragraph("_(Last-run table renders here when bootstrap completes.)_");
  }
}
```

---

## Memory

> [!info]+ Background memory layer (v0.84.0+)
> Cowork captures hourly snapshots of your day across MCPs and synthesizes them at EOD into a daily-pattern note. Background-only — does not clutter the daily note. Click any file below to inspect.

```dataviewjs
// 5 most-recent memory.md files cross-engagement, sorted by last_tick_at desc.
const pages = dv.pages('"spice/cowork/memory"')
    .where(p => p.type === "cowork-memory")
    .sort(p => p.last_tick_at || p.created_at, "desc")
    .limit(5);
if (pages.length === 0) {
    dv.paragraph("_(No memory captured yet — the first hourly tick will create today's memory.md.)_");
} else {
    dv.list(pages.map(p => `[[${p.file.path}|${p.engagement_id} — ${p.day} (${p.tick_count} ticks)]]`));
}
```

---

## About

```dataviewjs
const target = "spice/cowork/About Cowork.md";
const items = [{
  label: "About Cowork",
  path: target,
  _icon: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
  file: { name: "About Cowork", path: target }
}];
if (typeof window.customJS !== "undefined" && window.customJS.BeaconCards) {
  await window.customJS.BeaconCards.render(dv, {
    pages: items,
    title:    (p) => p.label,
    icon:     (p) => p._icon,
    subtitle: () => "What cowork is, the full skills catalogue, and getting-started steps",
    target:   (p) => p.path,
    layout: "row",
    columns: 1
  });
} else {
  dv.paragraph(`- [[${target}|About Cowork]]`);
}
```
