---
type: wiki-page
title: VPC Peering
created_at: "2026-06-01T00:00:00Z"
tags:
  - wiki-page
  - networking
  - aws
---

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "Breadcrumb" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });
```

```dataviewjs
await dv.view("ranch/views/customjs-guard", { class: "WikiLeafActions" });
```

---

VPC Peering allows routing between two VPCs using private IP addresses.

Configure the peering connection in the AWS Console or via CLI:
`aws ec2 create-vpc-peering-connection --vpc-id vpc-abc123 --peer-vpc-id vpc-def456`
