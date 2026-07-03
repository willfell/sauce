---
type: reader-article
title: The Unix Philosophy Revisited
url: https://example.com/unix-philosophy-revisited
author: Jane Ritchie
site: example.com
published: 2026-05-14
captured_at: "2026-06-30T09:12:00Z"
word_count: 1420
status: unread
summary: A modern reappraisal of the "do one thing well" doctrine and how it holds up in the age of large composed systems and pervasive networking.
tags:
  - reader-article
  - systems
  - unix
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

> Small, sharp tools that compose beat one monolith that tries to do everything.

[//]: # (READER_CONTENT)

The Unix philosophy is often reduced to a bumper sticker, but its enduring value is in the discipline of clear interfaces. Composition is only cheap when the seams are honest.

Networked systems complicate the picture: a pipe across a machine boundary carries latency and partial failure that a local pipe never did.
