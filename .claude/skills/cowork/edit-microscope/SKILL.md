---
name: cowork:edit-microscope
description: Interactive, MCP-tool-aware capture loop that authors/deepens a per-kind microscope contract at spice/cowork/prompts/per-mcp/<kind>/microscope.md. Enumerates the kind's served_by tools, consent-gated samples real data to ask grounded questions, surfaces data gaps with resolution paths, and writes a deep gather contract the orchestrators read. Re-run to dig deeper over time. Reachable via /cowork microscope <kind>.
inputs:
  kind: string | null
outputs:
  microscope_path: string
  status: string
tags: [cowork, orchestrator, interactive, microscope, user-owned]
---

# cowork:edit-microscope

Authors and iteratively deepens a USER-OWNED per-kind gather contract. The output file `spice/cowork/prompts/per-mcp/<kind>/microscope.md` is never overwritten by `sauce update`/`reinstall` (it is not in cowork's `files[]`). The atomic-note orchestrators read it and route that kind through `cowork:gather-from-served-by` with the microscope body as the deep `what_matters` (see `cowork:read-user-preferences` + the orchestrators' dispatch step). This is a DISCOVERY loop, not a form: tool calls reveal reality, reality drives the questions, each pass digs deeper.

## Inputs

- `kind` (string, optional): the MCP kind to deepen (e.g. `finance`, `chat`). When omitted, ask the user which kind, listing the kinds present in `spice/cowork/context/user-preferences.md`.

## Steps

1. **Resolve kind.** Read `user-preferences.md` (via `cowork:read-user-preferences`). Call the helper `resolveKind({ requested: kind, kinds: Object.keys(prefs.mcps) })`. If `status == "unclassified"`, tell the user to run `/cowork preferences` first and STOP. If `status == "ask"`, ask which kind (one question), then proceed. Capture the kind's `served_by` + `notes` (the kind's `what_matters`).
2. **Read existing contract.** If `spice/cowork/prompts/per-mcp/<kind>/microscope.md` exists, read it — this is the iteration anchor to deepen.
3. **Enumerate tools.** Filter your tool list to `mcp__<served_by>__*`. Show the user what the MCP can do (tool names + one-line purpose each).
4. **Consent-gated live sample + gap-finding.** Ask: *"Want me to pull a small sample so my questions are grounded in your real data?"* On YES, call a few cheap read tools, inspect the real field shapes, and surface GAPS. For each gap, call `classifyGap({ gap, tools })` and present the resolution path:
   - `resolvable-in-gather` → record an instruction in the contract's `## Tools & how to use them` (e.g. "resolve numbers→names via `search_contacts` before summarizing").
   - `mcp-ceiling` → tell the user the MCP can't go deeper and name a richer alternative if known (e.g. `lharries/whatsapp-mcp` for WhatsApp message content); record under `## Gaps & handling`.
   - `user-supplied` → offer to maintain a sibling file (e.g. `per-mcp/<kind>/contacts-map.md`).
   On NO, proceed enumerate-only.
5. **Brainstorm preferences, one question at a time.** Grounded in tools + sample + gaps: what to surface, how to group, what to flag/ignore, how to ground it into a usable summary ("brain map"). Collect into `answers` (`what_matters`, `output_shape`, …).
6. **Compose/refine.** Call `composeMicroscope({ kind_name, existing, notes, answers, tools, gaps })`. Write the result to `spice/cowork/prompts/per-mcp/<kind>/microscope.md` (create the directory). On a re-run, the helper preserves prior content and appends the new material.
7. **Confirm.** Show the user the written path and a one-line summary. Mention they can re-run `/cowork microscope <kind>` anytime to go deeper.

## Consent & safety

Live tool calls in step 4 are consent-gated (this repo's ask-before-acting posture). The skill reads the user's own vault data only, in an interactive session the user initiated. Never write outside `spice/cowork/prompts/per-mcp/<kind>/`.

## Dry-run mode

The helper at `platform/blueprints/cowork/helpers/edit-microscope-helper.js` exports `resolveKind`, `classifyGap`, `composeMicroscope` (pure). Harness cases HC-V0790-E1..E3 exercise these directly.

## Test fixtures

HC-V0790-E1 (seed-from-notes), E2 (deepen-existing), E3 (gap classification) in `platform/test/run-cowork-smoke.js`.
