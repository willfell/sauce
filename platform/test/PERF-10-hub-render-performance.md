# PERF-10 hub render-performance measurement

Measured 2026-08-03 on the workshop Node harness using the real `ProjectsHubCards`, `ProjectDashboard`, and `SpaceDailyDashboard` classes. The fixture contains 1,740 synthetic notes: 120 projects with six child docs each, 440 task notes, 180 meetings, 140 reader articles, 40 trips, and 100 activity notes. Dataview queries use chainable iterable fixtures and hub dependencies render into a lightweight DOM.

| Hub | Warm median | Warm p95 |
| --- | ---: | ---: |
| Projects hub | 0.86 ms | 1.41 ms |
| Project dashboard | 0.15 ms | 0.27 ms |
| Daily dashboard | 2.11 ms | 5.33 ms |

Seven measured renders follow two warm-up renders per hub. The binding regression budget is 250 ms median and 500 ms p95. This is intentionally far above the observed Node time: it is a portable ceiling for catastrophic query/render regressions, not a promise about Obsidian wall-clock paint. A quarter-second median is the point where a hub interaction becomes perceptibly sluggish; the doubled p95 allowance absorbs CI and host variance.

Recommendation: **NO-GO on a follow-on EntityQuery epic for now.** All three heavy hubs are more than two orders of magnitude below the budget on a 1,740-note fixture. The current targeted query ownership and precomputed ActivityFeed path are adequate. Reconsider EntityQuery only when a reproducible consumer-vault trace exceeds the 250 ms median budget, or when scale testing shows non-linear growth.

Limitations: the harness measures JavaScript query, enrichment, and DOM-construction work in Node. It excludes Obsidian layout/paint, plugin scheduling, disk latency beyond deterministic async reads, and third-party plugin contention. Those are reasons to retain field telemetry as a future trigger, not reasons to introduce a query layer without evidence.

Run with:

```sh
node platform/test/perf-10-hub-render-performance.js
```
