---
type: reader-article
title: Notes on Distributed Consensus
url: https://example.com/distributed-consensus-notes
author: Miguel Alvarez
site: papertrail.dev
published: 2026-06-02
captured_at: "2026-07-01T14:45:00Z"
word_count: 3080
status: reading
summary: A practitioner's field notes on Raft and Paxos, focusing on the operational hazards that the papers gloss over — leadership churn, log compaction, and membership changes.
tags:
  - reader-article
  - distributed-systems
  - consensus
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ReaderArticleActions" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "ReaderArticleView" });
```

[//]: # (READER_HIGHLIGHTS)

> The hard part of consensus is not agreeing once; it is agreeing repeatedly while the membership underneath you keeps changing.

[//]: # (READER_CONTENT)

Raft made consensus teachable, but teachable is not the same as operable. The failure modes that bite in production are rarely the ones in the diagrams.

Log compaction and snapshot transfer are where most real incidents live. Plan for them before you need them, not during the outage.
