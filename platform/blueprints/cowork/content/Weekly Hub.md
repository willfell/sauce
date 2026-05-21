---
type: cowork-weekly-hub
created_at: "2026-05-17T15:03:00-06:00"
tags: [cowork-hub, weekly-hub]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

# Weekly Notes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkWeeklyHubCards" });
```

## This Week's Activity

```dataviewjs
// v0.71.0: scoped to cowork-* types with framed renderer.
// groupLabels mirrors platform/rules/_canonical-vocab.json#display_names —
// hardcoded inline because canonical-vocab.json isn't materialized as a
// standalone file in consumer vaults (validator merges it via extends:).
// Keep these 6 entries in sync with _canonical-vocab.json if either side changes.
await dv.view("ranch/views/customjs-guard", {
  class: "ActivityFeed",
  method: "render",
  args: [{
    scope: "week",
    groupBy: "blueprint",
    framed: true,
    limit: 100,
    blueprints: [
      "cowork-morning-briefing",
      "cowork-midday-tripwire",
      "cowork-eod-review",
      "cowork-finance-snapshot",
      "cowork-weekly-review",
      "cowork-monthly-review",
    ],
    groupOrder: [
      "cowork-morning-briefing",
      "cowork-midday-tripwire",
      "cowork-eod-review",
      "cowork-finance-snapshot",
      "cowork-weekly-review",
      "cowork-monthly-review",
    ],
    groupLabels: {
      "cowork-morning-briefing": "Morning Briefing",
      "cowork-midday-tripwire":  "Midday Tripwire",
      "cowork-eod-review":       "EOD Review",
      "cowork-finance-snapshot": "Finance Snapshot",
      "cowork-weekly-review":    "Weekly Review",
      "cowork-monthly-review":   "Monthly Review",
    },
    getTitle: function (p) {
      return (p.frontmatter && p.frontmatter.engagement_id) || (p.file && p.file.name) || "(unknown)";
    },
    getSubtitle: function (p) {
      return (p.frontmatter && p.frontmatter.summary) || "";
    }
  }]
});
```
