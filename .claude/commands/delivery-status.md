---
description: delivery:status — read-only glance at the Sauce Delivery board (exceptions, no-action summary, active claim, recent releases, since-you-last-looked digest)
allowed-tools: Read, Bash, Glob, Grep, Skill
---

# /delivery-status

Invoke the `delivery-status` skill: a phone-sized, read-only digest of the Sauce Delivery board — how many things need you, what's frozen/waiting/done, the active claim, recent releases, and what happened since you last looked (self-ratified amendments, discards, cutover flips). Writes nothing except its own last-seen marker.

Run the `delivery-status` skill now and follow it exactly.
