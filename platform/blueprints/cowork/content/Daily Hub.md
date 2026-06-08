---
type: cowork-daily-hub
created_at: "2026-05-17T15:03:00-06:00"
tags: [cowork-hub, daily-hub]
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkHubNav" });
```

---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkDailyActions" });
```

# Daily Notes

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "CoworkDailyHubCards" });
```

## Lens-shift companions

```dataviewjs
await dv.view("ranch/views/customjs-guard", {
  class: "CoworkLensShiftCards",
  method: "render",
  args: [{ scope: "this_week" }]
});
```

## Today's Activity

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
    scope: "today",
    groupBy: "blueprint",
    framed: true,
    limit: 50,
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
      return p.engagement_id || (p.file && p.file.name) || "(unknown)";
    },
    getSubtitle: function (p) {
      return (typeof p.summary === "string" && p.summary) || "";
    }
  }]
});
```
