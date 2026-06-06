```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

> [!info]- Today at a glance
> Light calendar — Nevado Scrum at 11:00 AM (tentative) and CDC discussion with **[[Ted Grzesik]]** and **[[Graham Lammers]]** at 12:30 PM. Heavy Teams activity overnight with **[[Ben Tanner]]**, **[[Stale Veipe]]**, and **[[Matt Hemingway]]** on the document-registry namespace migration and Redis/New Relic setup. **[[Jason Batai]]** wrapped up the Hawaii CDN cutover work late yesterday. Two GitHub deployment reviews waiting for approval in mcp-mesh and ontology-api-gateway.

> [!info]+ Chat (Teams)
> Utilization snapshot: 75 messages since yesterday 5 PM, split roughly 30 sent / 45 received. Busiest threads: **[[Ben Tanner]]** DM (48 msgs), infra/preprod debugging with **[[Jason Batai]]** and **[[Kevin Morales]]** (15 msgs), project-library channel (6 msgs). No outstanding reply debt — latest messages in active threads are from Will. Inner circle reach: 8 of 11 (Ben, Stale, Matt, Jason B, Kevin M, Justin, Ted, Alfredo). No unmapped senders.
>
> ### Inner circle
>
> **[[Ben Tanner]]** (priority pair, DM) — Extended technical session on moving document-registry components from `content-registry` namespace to new `document-registry` namespace. Redis cluster migrated to `document-registry` in nonprod; prod stays in `redis` namespace for now. New Relic instrumentation updated to support both. AccurAPI PR ready for review. Ben working through New Relic operator secret access for Redis monitoring. Last message 6:11 PM: "there's the 3rd node" (Redis cluster discovery). [DM chat](teams:///chats/19%3A127315966d22408c9faad35919d3cd0c%40thread.v2)
>
> **[[Stale Veipe]]** (priority pair, DM with Ben/Matt) — Confirmed Redis implementation fails open (on error, falls through to direct DB). Joined late in the namespace migration discussion. [DM chat](teams:///chats/19%3A127315966d22408c9faad35919d3cd0c%40thread.v2)
>
> **[[Matt Hemingway]]** (DM with Ben/Stale) — Working on Argo project creation for document-registry. Clarified Redis should move to `document-registry` namespace. Confirmed losing Redis data on migration is acceptable. [DM chat](teams:///chats/19%3A127315966d22408c9faad35919d3cd0c%40thread.v2)
>
> **[[Jason Batai]]** (infra/preprod debugging channel) — Finished Hawaii CDN migration work. Approved the Hawaii PR #322, merged. Added liveness/readiness probes and backend connection checks. Confirmed Dev Enablement is now fully off awsapigateway. Thanked team for jumping on ad hoc request. Last update 4:13 PM. [Channel chat](teams:///chats/19%3A13add89dd9664c7a98b6b1db6f5ab12f%40thread.v2)
>
> **[[Kevin Morales]]** (infra/preprod debugging, noted as "now teamless" after reorg) — Active in the Hawaii CDN discussion. [Channel chat](teams:///chats/19%3A13add89dd9664c7a98b6b1db6f5ab12f%40thread.v2)
>
> **[[Justin Pflueger]]** (project-library channel) — Posted thread.interactions.sink PR #32 (report authoring guide + agent instructions update) at 5:10 PM, merged at 5:16 PM. [Channel chat](teams:///chats/19%3Af29561607de447298cce4f3668764d1c%40thread.v2)
>
> **[[Ted Grzesik]]** (DM or group) — Replied to Will's question about diving into CDC work: "I will dive into this next week. I got sideways in a good way today. I am also packing up my office." Context: CDC table for BoM team is on Ted's docket for next week per prior commitment. [Chat](teams:///chats/19%3Aa931a590cdcc48e88887b9ec9f95733b%40thread.v2)
>
> **[[Alfredo Diaz]]** (project-library channel) — Posted at 4:33 PM: "as I mentioned in the meeting, I'll add senso client & aws secret for new relic api key, they should be done later today". [Channel chat](teams:///chats/19%3Af29561607de447298cce4f3668764d1c%40thread.v2)
>
> ### Other activity
>
> Kevin Williams (platform/argocd channel) — Posted argocd genesis PR #313 (istiod fix) at 4:13 PM. [Channel chat](teams:///chats/19%3Ab397e2d59da547ae8a9814b7a18e369d%40thread.v2)
>
> Juan German Arrieta (project-library) — Off-topic neighbor pet discussion.
>
> Shreya Wani (support, unmapped DM `19:a33dcaab53e9483295c614a4d5296e38`) — Closed ServiceNow request RITM0020140 (Power Automate Premium access) after Will confirmed access via provided link. Final comment 4:49 PM.

> [!tip]+ Today's calendar
> - 11:00 AM – 11:15 AM: Nevado Scrum (tentative) · Ying Zhu organizer · [Teams Meeting](https://outlook.office365.com/owa/?itemid=AAMkAGU5ZTAzMDRlLTJmNTMtNGI3MC1hYmVjLWZjZGQ5ODVhYmUwYwFRAAgI3sKVYv9AAEYAAAAAz5Y0b67glUKLqVM0T2MzPAcANoJJasuQLUGJ6e6u9d4U2gAAAAABDQAANoJJasuQLUGJ6e6u9d4U2gAA%2BwwXLwAAEA%3D%3D&exvsurl=1&path=/calendar/item)
> - 12:30 PM – 1:00 PM: CDC discussion · **[[Ted Grzesik]]** organizer, **[[Graham Lammers]]** attending · [Teams Meeting](https://outlook.office365.com/owa/?itemid=AAMkAGU5ZTAzMDRlLTJmNTMtNGI3MC1hYmVjLWZjZGQ5ODVhYmUwYwBGAAAAAADPljRvruCVQoupUzRPYzM8BwA2gklqy5AtQYnp7q713hTaAAAAAAENAAA2gklqy5AtQYnp7q713hTaAALLbYq2AAA%3D&exvsurl=1&path=/calendar/item)
>
> Tomorrow: No events scheduled (Saturday).

> [!quote]+ Email triage (work scope)
> - **GitHub deployment review — mcp-mesh production** · notifications@github.com · Deployment workflow waiting for approval in ai.agentic-workflows.mcp-mesh (AgentGateway + OBO Sidecar) · [Email](https://outlook.office365.com/owa/?ItemID=AAMkAGU5ZTAzMDRlLTJmNTMtNGI3MC1hYmVjLWZjZGQ5ODVhYmUwYwBGAAAAAADPljRvruCVQoupUzRPYzM8BwA2gklqy5AtQYnp7q713hTaAAAAAAEMAAA2gklqy5AtQYnp7q713hTaAALK1O9EAAA%3D&exvsurl=1&viewmodel=ReadMessageItem)
> - **GitHub deployment review — ontology-api-gateway dev-pr** · notifications@github.com · Deployment workflow waiting for approval in oneapi.sci-connect.ontology-api-gateway · [Email](https://outlook.office365.com/owa/?ItemID=AAMkAGU5ZTAzMDRlLTJmNTMtNGI3MC1hYmVjLWZjZGQ5ODVhYmUwYwBGAAAAAADPljRvruCVQoupUzRPYzM8BwA2gklqy5AtQYnp7q713hTaAAAAAAEMAAA2gklqy5AtQYnp7q713hTaAALK1O9DAAA%3D&exvsurl=1&viewmodel=ReadMessageItem)
> - **New Relic user approval — Sandesh Shenoy Beloor** · noreply@newrelic.com (2 emails) · Approval needed for full platform user access, Supply Chain Full Stack Engineering Team · [Email](https://outlook.office365.com/owa/?ItemID=AAMkAGU5ZTAzMDRlLTJmNTMtNGI3MC1hYmVjLWZjZGQ5ODVhYmUwYwBGAAAAAADPljRvruCVQoupUzRPYzM8BwA2gklqy5AtQYnp7q713hTaAAAAAAEMAAA2gklqy5AtQYnp7q713hTaAALK1O9CAAA%3D&exvsurl=1&viewmodel=ReadMessageItem)
>
> Filtered: TechMentor conference promo, Miro Canvas sessions, iRU endpoint security newsletter, O'Reilly trial upsell, Tufts building update (denver-office list).

> [!note]+ GitHub
> *(Chat-sourced PR activity — direct GitHub search encountered rate/permission constraints)*
>
> **PRs involving Will or awaiting review:**
> - **accurapi.ingress-api.routes** — Will requested Ben's approval for AccurAPI changes related to document-registry namespace migration. Linked to content-registry CD pipeline changes. [Mentioned in chat](teams:///chats/19%3A127315966d22408c9faad35919d3cd0c%40thread.v2/messages/1780700802078)
> - **hawaii.hawaii-system.delivery-platform-cdn #322** — Approved by Will and **[[Kevin Williams]]**, merged by **[[Jason Batai]]**. Completes Hawaii CDN migration off awsapigateway. [Mentioned in chat](teams:///chats/19%3A13add89dd9664c7a98b6b1db6f5ab12f%40thread.v2/messages/1780693887433)
>
> **Team PR activity:**
> - **product-technology.argocd.genesis #314** (**[[Ben Tanner]]**) — Redis support for document-registry namespace, New Relic instrumentation. [PR link](https://github.com/accuristech/product-technology.argocd.genesis/pull/314)
> - **product-technology.argocd.genesis #313** (Kevin Williams) — istiod fix. [PR link](https://github.com/accuristech/product-technology.argocd.genesis/pull/313)
> - **thread.interactions.sink #32** (**[[Justin Pflueger]]**) — Report authoring guide + agent instructions update. Merged. [PR link](https://github.com/accuristech/thread.interactions.sink/pull/32)

> [!example]+ ADO (board status)
> Dev Enablement team scope (EPD\Product Technology\Developer Enablement):
>
> **Active work:**
> - **[708212](https://dev.azure.com/pdd-ihsmarkit/_apis/wit/workItems/708212)** [DE] – [EMS] – Remove Linkerd from prod (User Story, Active, assigned to Will)
> - **[706967](https://dev.azure.com/pdd-ihsmarkit/_apis/wit/workItems/706967)** [SCI] – Databricks Platform Modernization: Serverless Workspaces and Private-Egress Storage (Feature, Active, assigned to Will)
> - **[707565](https://dev.azure.com/pdd-ihsmarkit/_apis/wit/workItems/707565)** [DE] Centralized Pipeline Rules IaC Platform Build-out (Feature, Active, assigned to Will)
>
> **New work:**
> - **[707659](https://dev.azure.com/pdd-ihsmarkit/_apis/wit/workItems/707659)** [NEVADO] – Business Event K8s Migration: Prod Cutover (User Story, New, assigned to Will)
> - **[708152](https://dev.azure.com/pdd-ihsmarkit/_apis/wit/workItems/708152)** [SCI] – Add Database to CDC Pipeline Production (User Story, New, no assignee yet) — ties to today's CDC discussion with **[[Ted Grzesik]]** and **[[Graham Lammers]]**

> [!tip] Today's focus
> Wrap up the document-registry namespace migration PRs (AccurAPI + content-registry argocd) and confirm the e3 environment update is stable. The CDC discussion at 12:30 PM with **[[Ted Grzesik]]** and **[[Graham Lammers]]** ties directly to work item 708152 (CDC pipeline production database add) — Ted committed to diving into this next week, so use today's call to align on scope and handoff. Approve the two GitHub deployment reviews (mcp-mesh production, ontology-api-gateway dev-pr) and the New Relic user access for Sandesh Shenoy Beloor. First action: review and merge the AccurAPI PR so **[[Ben Tanner]]** can proceed with the Argo sync.

> [!quote]- Memory log
> Today's memory: [[spice/cowork/memory/accuris/2026/06-June/2026-06-05/memory.md|Memory log — 2026-06-05]]
