# Operator experience — epic atlas readability + the Loop Station — design spec

**Date:** 2026-07-26
**Status:** Designed by Will's delegate under the Standing delegation of ratification (FID 2026-07-25); mechanical/UX design class — no constitution-class item touched
**Builds on:** `2026-07-25-board-governance-redesign-design.md` (board topology, discard law, digest), FID "Minimal mobile observability", FID "ES1 ratification-as-receipt"
**Slices:** minted into the LIVE Loop Ops epic via card-intake (§8); this spec is the design source of record

## 0. The operator problem

Will (verbatim intent): *"as an operator, understanding what is blocked, where it's blocked, and having a designated spot that's easy to find for me to go ahead and assess the situation, ratify, write whatever I need to where so that it's unblocked… make this a pretty and easy to navigate solution… visually consistent, easy, and pretty to look at… the information displayed should give me context for my lack of knowing what's going on when I open the epic card."*

Two surfaces answer this:

- **A. The epic atlas** (EpicDashboard on each epic note) must answer, on open: *what is happening in this epic right now, what's stuck and why, what's next, what shipped recently* — at 390px, in the sauce visual language.
- **B. The Loop Station** — one designated cross-epic surface: what needs Will (with plain-language why + exact links), what's a genuine no-action wait, what happened since he last looked, and the **ratification inbox** — the one place he writes a line to unblock something, consumed through ES1's ratification-as-receipt machinery.

## 1. Confirmed defects (2026-07-26 live screenshot audit, iPhone 390px dark, Loop Ops atlas)

All root-caused in `platform/blueprints/project/helpers/epic-dashboard.js` (v0.260.1 source):

| # | Defect | Root cause |
| --- | --- | --- |
| D1 | Title link and "depends on" line render on top of each other at 390px | `_renderSlices` builds ONE wrapping flex row (`flex-wrap:wrap` line ~199); title (`flex:1;min-width:120px`) and metadata spans compete in the same wrap line — there is no second row |
| D2 | `depends on [[GA-OPS13a2 …]]` renders as literal bracket text | line ~207-208: raw `depends_on` values string-interpolated into a text span; never routed through `_link`/bracket-strip (the `_renderLinkStrip` pattern at ~219 does it right) |
| D3 | `in-planning` / `in-progress` / `in_progress` all appear as pill labels | line ~202: `String(slice.status)` used verbatim as the label; `_statusKind` maps only a coarse CSS kind; Delivery's `normalizeStatus` + `status_aliases` (delivery-schema.json) never consulted |
| D4 | Full basenames with "(supersedes …)" suffixes dominate rows | line ~200: label is `file.basename`; no short-id + clean-title split anywhere |
| D5 | Empty-looking progress bar; bare "frontier" word floating next to a pill | ~179-184: single done/total fill = 0% for any epic with no completions; ~206: `createEl("span", { text: "frontier" })` — unstyled, unclassed |
| D6 | GA-OPS14a (tombstoned) renders beside GA-OPS14a3 | **Real defect, two layers** — see §6 |

## 2. Current-state map — what exists and where it surfaces

Verified against origin/main @ v0.260.1 (workshop rebased to parity with the installed brew binary during this session — the pre-rebase checkout was 9 commits stale).

| Data | Exists | Operator surface today |
| --- | --- | --- |
| `status --json`: `active`, `parked[].resume_condition`, `discarded_recent[]`, `cutover`, `cutover_history[]`, `board_drift`, `projection_problems`, `tracked`, `state_path` | ✅ installed coordinator | CLI-only; `delivery:status` / `delivery:review` skills |
| Triage classes (escalation vs genuine wait) | ✅ `delivery-review-triage.js` | CLI-only via digest |
| Retroactive digest incl. `.delivery-digest-last-seen` marker, `sinceLastLook` (discards, cutover flips, SELF-RATIFIED amendments), `--peek` | ✅ **shipped** (landed with the BGR redesign commits; the "not implemented" reading was from the stale checkout) | CLI-only — **no in-vault render**; dataviewjs cannot run the CLI |
| `deriveEpicLifecycle` buckets `planned/active/waiting/blocked/done`; parked→waiting; discarded excluded | ✅ shipped | EpicDashboard consumes it (metrics line already says "waiting") |
| `resume_condition` projected into parked slice note frontmatter | ✅ (park + reconcile-metadata enforce it) | **Nothing renders it** — the atlas shows a parked slice with no why |
| Ratification artifact contract: markdown section + one ```delivery-ratification``` fenced JSON block, keys `{schema_version, receipt_id, decision, accepted_at, authority, target_card, target_head, scope}`; `consumeRatificationArtifact` validates + computes sha256-bound receipt | ✅ `delivery-contract.js` + coordinator fns | **NONE — test-only.** Not wired into `main()`, no CLI verb, no note format, no inbox. The write→receipt→consumption path has no last mile |
| Coordinator vault projection | card frontmatter + board lines + epic atlas status/posture only | **No station/status note exists** — the FID's "one current-status note updated on meaningful transitions" (Minimal mobile observability) is unbuilt |
| Live board state (this session) | 1 active (GA-OPS14a3, implementing), 9 parked (7 human-value-review escalations, 1 zone yield, 1 misc), 8 projection_problems, 1 board_drift, cutover enabled | — |

The "8 parked-card metadata findings" follow-up is **already covered**: GA-OPS14a3 (active now) is exactly the "rebind parked-card migration metadata / exact-eight" slice. No new slice needed for it.

## 3. Design A — epic atlas readability (fixes D1–D5, render-guards D6)

Redesign of the slice row + lifecycle header in `EpicDashboard`. Same data flow (folder-truth via `getMarkdownFiles` + metadataCache; lifecycle via `deriveEpicLifecycle`); presentation only.

### Slice row — two stacked lines per slice, card-like breathing room

```
┌────────────────────────────────────────────────┐
│ GA-OPS14a3  Rebind parked-card migration       │   line 1: short-id chip + clean-title LINK
│             metadata                           │            (wraps freely, nothing beside it)
│ [in progress]  [→ next up]  needs GA-OPS13a2   │   line 2: meta row — pills + real dep links
└────────────────────────────────────────────────┘
│ parked — waiting on: "yield platform/… zones   │   line 3 (parked/blocked only): the WHY —
│ to ES2; resume after ES2 deploys"              │   resume_condition excerpt, ≤140 chars
```

- **Line 1 (D1, D4):** its own block row (`display:block` / grid row — never sharing a wrap line with metadata). Short-id chip = leading token of the basename matching `/^[A-Z]+-[A-Z0-9]+/` rendered as a muted mono chip; clean title = basename minus id prefix minus any trailing `(supersedes …)` parenthetical. The **link target keeps the full path/name**; only the display text is cleaned. No id match → whole basename as title (generalizable; no GA-specific assumptions).
- **Line 2 (D2, D3, D5-frontier):**
  - Status pill: label from Delivery `normalizeStatus` (already resolved via `_deliveryApi`) with display map `planning → planning`, `in_progress → in progress`, `parked → waiting`, `blocked → blocked`, `completed → done`. Styling = the board-stats chip recipe (project-dashboard.js `_renderBoardStats`): `border-radius:999px; font-size:0.75em; font-weight:600; color:<c>; background:color-mix(in srgb, <c> 12%, transparent); border:1px solid color-mix(in srgb, <c> 35%, transparent)` with the shared `STATUS_COLORS` semantics — planning→`--color-blue`, in progress→`--color-green`, waiting→`--color-orange`, blocked→`--color-red`, done→`--color-purple`. Raw frontmatter status is never displayed.
  - **Unrecognized status** (e.g. `archived` — the D6 corpse): a distinct attention chip (`--color-orange` border, label `unrecognized: <value>`), never a silent planning row. Drift becomes visible instead of camouflaged.
  - Frontier: a real chip (`→ next up`, accent-colored recipe), only on the frontier slice.
  - Dependencies: `needs` + one real internal link per dep — bracket-stripped, routed through the `_link` pattern (real element + click → `_open`; the MarkdownRenderer-not-global landmine). Dep display text = short-id when the leading token matches, else full name.
- **Line 3 (the operator's WHY):** only when status is parked/blocked AND `resume_condition` frontmatter exists: muted single line, `waiting on: "<excerpt ≤140 chars>"`. Absent field → render nothing (no placeholder — note-chrome law).

### Lifecycle header (D5)

- **Segmented progress bar** replacing the single done-fill: one flex track (6px, 999px radius), segments sized by count for done/active/waiting/blocked in the same STATUS_COLORS, remainder (planned) = track background. All-planned epic: track + `not started` in `--text-muted` beside it — never a bare empty bar.
- Metric chips row: reuse the board-stats chip recipe for `N deployed / N in flight / N waiting / N blocked / N planned`, zero-count chips dropped silently (project-blueprint-ui §6).

Everything stays inline-styled with theme tokens (existing helper convention), sections via `SectionLabel`, no new CSS files, no new visual language.

## 4. Design B — the Loop Station

### 4.1 Shape decision

Three candidate shapes considered:

1. **Pinned station note at the delivery project root** — `spice/projects/sauce/Loop Station.md`: coordinator projects data INTO the note's frontmatter; body renders it. **Chosen.**
2. Section on the Sauce project hub — rejected: bloats the generic project hub with delivery-specific UI; every non-loop project would carry dead weight (platform-generalizability rule), and the hub is already six sections deep.
3. Home integration — rejected as the primary surface: Home is vault-global; cross-epic loop plumbing is noise for every non-loop moment. (A later one-chip Home glance integration remains open as a follow-up, not in this cycle.)

Why 1: it is literally Will's ask — *a designated spot that's easy to find* — one note, pinnable, linkable from the phone home screen, one tap from the project hub. And it lets the FID's **Minimal mobile observability** clause be satisfied exactly: the vault receives **one current-status note updated on meaningful transitions** — this is that note.

### 4.2 One note, one writer, two halves

- **Frontmatter = the projection payload.** Written ONLY by the coordinator (`patchFrontmatter`, same machinery as card projection) on **meaningful transitions**: claim, park, resume, discard/reap, advance/deploy, cutover flip, ratification consumption, halt/recover. Never per poll — FID law. Schema registered in `platform/schemas-index.json` (`sauce.loop-station.v1`), `npm run lint-schemas` green.
- **Body = stock render block** (customjs-guard → `OperatorStation.render(dv)`), reading the note's own frontmatter via RenderSafe (cold-load overlay handles the mobile partial-frontmatter trap). The body is scaffolded once if the note is missing; the coordinator never rewrites a body.

Payload (bounded; every list capped at 20 with `+N more` counts):

```yaml
type: loop-station
schema_version: 1.0.0
updated_at: 2026-07-26T18:04:11Z          # staleness banner keys off this
updated_on: <transition verb>              # claim|park|discard|deploy|cutover|ratify|…
headline: "2 need you · 7 frozen / 1 waiting / 31 done · active: GA-OPS14a3"
exact_action: "Ratify GA-H1a in [[ratifications/GA-H1a]] — one decision line"   # or null
active: { card, phase, epic }
needs_attention:                           # triage escalation classes only
  - { card, epic, bucket, why: "<resume_condition excerpt>", ratification: "<path|null>" }
waiting:                                   # genuine no-action waits (zone/deploy)
  - { card, epic, why }
since:                                     # digest sinceLastLook computed via --peek
  marker_at: <ISO|null>
  discards: [ { name, reason, superseded_by } ]
  self_ratified: [ { heading, date } ]
  cutover_flips: [ { enabled, at } ]
  ratified: [ { card, authority, at } ]    # new feed once OPX4 lands
releases_recent: [ v0.260.1, … ]
counts: { needs_attention, waiting, frozen, done }
```

### 4.3 Render (phone-first, sauce grammar)

Section order, each via `SectionLabel`, chrome per note-chrome grammar:

1. **Headline strip** — the digest headline as large calm text; staleness banner if `updated_at` > 24h old ("last projected Xh ago — run delivery:status for live state").
2. **Needs you** — the only loud section. One card per item: card link + epic chip + plain-language why + a `Ratify →` link straight to its inbox note when one exists. Empty state: *"Nothing needs you."*
3. **Ratification inbox** — pending artifacts under `spice/projects/sauce/ratifications/` (live folder-truth enumeration via metadataCache, `state: pending` frontmatter): note link + target card + one-line ask. This is where Will writes.
4. **Waiting — no action** — collapsed count-first row of genuine waits; expandable list, muted.
5. **Since you last looked** — discards (name struck through + reason + successor link), self-ratified amendments (heading text), cutover flips, delegate ratifications. Labeled honestly: *"since your last delivery:status read (<date>)"* — rendering the note does NOT advance the marker (render surfaces are read-only; the marker stays CLI-owned and `--peek` semantics are used at projection time).
6. **Active now + recent releases** — one line each.

### 4.4 The ratification inbox — write → receipt → consumption, precisely

The coordinator remains the only board/ledger writer. The vault note is the ratification **artifact** — exactly what ES1 shipped a validator for. The missing last mile is (a) a place the artifact lives, (b) prefilled correctness, (c) a CLI verb that consumes it.

1. **Scaffold (coordinator writes, on escalation park + backfill for already-parked escalations during a projection pass):** `spice/projects/sauce/ratifications/<card-short-id>.md` with frontmatter `{type: ratification, state: pending, target_card, created_at}`, a body that explains in plain language what is being decided and what accepting does, and the exact ES1 section:

   ~~~markdown
   ## Ratification — <full card name>

   ```delivery-ratification
   {
     "schema_version": "1.0.0",
     "receipt_id": "<uuid, prefilled>",
     "decision": "",
     "accepted_at": "",
     "authority": "",
     "target_card": "<exact canonical identity, prefilled>",
     "target_head": "<exact 40-hex parked HEAD, prefilled>",
     "scope": ["<prefilled from the escalation>"]
   }
   ```
   ~~~

   Prefill satisfies both GA-OPS10 binding findings by construction: target identity comes only from the ledger record; `target_head` is token-bound to the exact SHA. Will (or the delegate, within the standing delegation) fills **three fields**: `decision: "accepted"`, `accepted_at`, `authority: "will"|"delegate"`. One edit, phone-friendly.
2. **Consumption (new CLI verb):** `consume-ratification --card <name> --json [--artifact <path>]` wires the existing `consumeRatificationArtifact` into `main()` under the selector lock. Validates section-uniqueness, payload keys, decision enum, exact identity + 40-hex head against the ledger's expected values; computes the sha256-bound receipt (`artifact_path`, `artifact_sha256`, `section_heading`, `section_sha256`).
   - **ok** → receipt stored on the ledger record (`ratification_receipt`), the card's park resolves (resume/eligible per its resume_condition class), artifact frontmatter patched `state: consumed` + `consumed_at`, digest gains the `ratified` feed entry, station reprojected (it's a meaningful transition).
   - **invalid** → machine receipt listing every error, zero state change, artifact stays `pending`, failure surfaced in `status --json` so the station's needs-attention shows *"ratification for X is malformed: <first error>"*.
   - Literal replay → `no_op: true`; different operands → refuse (coordinator replay law).
3. **Authority policy** stays governance-side: the validator records `authority` verbatim; whether an item was reserved-to-Will is FID law enforced by session discipline and visible in the digest — mechanical validation does not police it (constitution untouched).

## 5. Data-flow summary (who writes what)

| Writer | Writes | When |
| --- | --- | --- |
| Coordinator | Loop Station frontmatter; ratification stubs (`state: pending`); `state: consumed` flips; boards/cards/ledger (as today) | Meaningful transitions only |
| Will / delegate | Three fields inside a pending ratification block; FID amendments (as today) | At leisure — nothing waits |
| `delivery-status` CLI | `.delivery-digest-last-seen` marker | Real reads only (`--peek` never) |
| OperatorStation / EpicDashboard (render) | **Nothing.** Read-only per the bounded render bar | — |

## 6. D6 finding — tombstone residue (real defect, two layers)

Evidence chain (2026-07-26): ledger records `GA-OPS14a` `phase: discarded`, `superseded_by: GA-OPS14a2`, discarded 05:49:28Z — but its note **survives** at the exact `card_path` the ledger records, frontmatter flipped to `status: archived` (`status_prev: in-progress`, `status_changed_at: 2026-07-26`). `archived` is not in the Delivery vocabulary and **no sanctioned writer emits it** (coordinator: zero occurrences; it is project-blueprint vocabulary). Sibling GA-OPS14a2 reached the identical ledger state and its note WAS deleted — the happy path works. The epic kanban board is clean; only the folder-authoritative atlas renders the corpse (unknown status → silently bucketed as planned).

- **Layer 1 — heal:** `reap`'s residue sweep (`phase === 'discarded'` + note exists at `card_path` → unlink) WILL heal this today; the note sits at the recorded path. Next loop turn should run `reap --json`. No slice needed for the heal itself.
- **Layer 2 — detection gap (slice OPX5):** nothing *reports* residue between reaps. `status --json` gains `tombstone_residue[]` — the same predicate reap uses, exposed read-only: `{card, path, heal: "reap"}`. Digest/station surface it as attention-lite. The atlas's unrecognized-status chip (OPX1) makes it visible render-side. The open question of WHAT wrote `status: archived` after discard (unsanctioned session write vs. sync resurrection) is recorded here as a watch-item; the detection field turns any recurrence into a visible, dated signal instead of a screenshot surprise.

## 7. Landmine compliance (binding on every render slice)

customJS single-expression loading via customjs-guard; RenderSafe for page + frontmatter (no raw `dv.current()`); metadataCache enumeration; **no MarkdownRenderer** — real `<a>`/button elements with click handlers; 400ms ghost-click guard on any new overlay (prefer MenuPopover, which has it); byte-equality-gated snippet copies (no sauce-core.css hand-edits); visual proof via the CDP headless-Chrome harness — fixture per surface at 390px device metrics + desktop, `body.theme-light` + `body.theme-dark` blocks, registered in `release:preflight` (check-orphan-harnesses gate).

## 8. Slice decomposition — Loop Ops epic, dependency-ordered, visible improvement first

All five are PR-sized, one surface each. Render slices (OPX1, OPX3) carry the ratified bounded 7-item core render set + FULL correctness/regression; state-mutating slices (OPX2, OPX4, OPX5 — coordinator) carry FULL test adequacy. Fixture names below are the binding red/green set (each red without the change, green with).

### GA-OPS15a — Epic atlas readability (D1–D5 + unrecognized-status guard)
- **Surface:** `platform/blueprints/project/helpers/epic-dashboard.js` presentation layer only (§3).
- **Touch zones:** `platform/blueprints/project/helpers/epic-dashboard.js`, `platform/test/run-epic-dashboard.js`, `platform/test/visual/epic-dashboard.html`.
- **model_profile:** standard · **depends_on:** — · **deploy:** all three vaults.
- **Fixtures:** `OPX1-TWO-LINE-ROW` (title and meta are separate block rows; 390px geometry assert: bounding boxes never intersect); `OPX1-DEP-LINKS-REAL` (`depends_on: ["[[GA-X …]]", "GA-Y …"]` renders real internal-link elements with click handlers, never literal brackets); `OPX1-STATUS-NORMALIZED` (`in-planning`/`in-progress`/`in_progress`/`parked` render normalized display labels from one shared map; raw string never a label); `OPX1-TITLE-CLEAN` (basename with id prefix + `(supersedes …)` suffix renders short-id chip + clean title; link target keeps full name; no-id basename renders whole title); `OPX1-FRONTIER-CHIP` (styled chip, exactly one, never a bare text node); `OPX1-PROGRESS-SEGMENTED` (active/waiting/blocked segments visible with zero done; all-planned shows "not started", never an empty track); `OPX1-PARKED-WHY` (parked slice with `resume_condition` shows ≤140-char excerpt; absent field renders nothing); `OPX1-UNRECOGNIZED-STATUS` (status `archived` → attention chip, never a silent planning row — binds the GA-OPS14a finding render-side); plus the 7-item core set retained green and the existing source guards updated in lockstep.
- **Visual proof:** regenerated `epic-dashboard.html` fixture mirroring the new DOM, 390px + desktop, light + dark.

### GA-OPS16a — Tombstone residue detection in status (D6 layer 2)
- **Surface:** coordinator `status --json` + digest feed (§6).
- **Touch zones:** `scripts/autoloop/codex-coordinator.js`, `scripts/autoloop/delivery-status-digest.js`, `platform/test/run-codex-autoloop.js`, `Docs/agent-guides/delivery-board.md`.
- **model_profile:** standard · **depends_on:** — · **deploy:** none (workshop tooling). **FULL adequacy.**
- **Fixtures:** `OPX5-RESIDUE-REPORTED` (state fixture: discarded record + surviving note at `card_path` → `tombstone_residue: [{card, path, heal: "reap"}]`; exactly the GA-OPS14a shape); `OPX5-RESIDUE-CLEAN-AFTER-REAP` (post-reap state → empty array); `OPX5-RESIDUE-READ-ONLY` (status computation performs zero writes with residue present); `OPX5-DIGEST-SURFACES-RESIDUE` (digest output carries the residue count).

### GA-OPS17a — Loop Station projection writer
- **Surface:** coordinator projects the station note frontmatter on meaningful transitions (§4.2); schema registration.
- **Touch zones:** `scripts/autoloop/codex-coordinator.js`, `scripts/autoloop/delivery-status-digest.js`, `scripts/autoloop/delivery-review-triage.js`, `platform/test/run-codex-autoloop.js`, `platform/schemas-index.json`, `Docs/agent-guides/delivery-board.md`.
- **model_profile:** heavy · **depends_on:** GA-OPS16a (payload includes the residue field) · **deploy:** none. **FULL adequacy.**
- **Fixtures:** `OPX2-TRANSITION-ONLY` (no station write on `status`/read verbs; write fires on park/discard/deploy/cutover); `OPX2-PAYLOAD-SCHEMA` (payload validates against the registered `sauce.loop-station.v1`; lint-schemas green); `OPX2-BOUNDED` (21+ items → capped at 20 + count); `OPX2-EXACT-ACTION` (value-review escalation park yields `exact_action` naming the card and its ratification path); `OPX2-IDEMPOTENT-REPLAY` (same transition replayed → byte-identical frontmatter, zero churn); `OPX2-BODY-PRESERVED` (existing note body never rewritten — frontmatter patch only; missing note → scaffolded once with the stock body); `OPX2-PEEK-NEVER-ADVANCES` (projection computes `since` via peek; `.delivery-digest-last-seen` byte-identical before/after).

### GA-OPS18a — Operator Station render surface
- **Surface:** new `OperatorStation` customJS helper + stock station body (§4.3).
- **Touch zones:** `platform/blueprints/project/helpers/operator-station.js` (new), `platform/test/run-operator-station.js` (new), `platform/test/visual/operator-station.html` (new), `package.json` (preflight registration), `platform/blueprints/project/manifest.json`.
- **model_profile:** standard · **depends_on:** GA-OPS17a (schema contract) · **deploy:** all three vaults.
- **Fixtures:** the full 7-item core render set as named red/green pairs (read-only proof via throwing app mutators; empty payload → calm "Nothing needs you" empty state; missing/partial payload or Delivery API → visible recovery line, never blank/throw; cold-load RenderSafe; installed-artifact resolution; 390px no horizontal overflow; folder-truth scoping of the ratifications enumeration) plus `OPX3-NEEDS-YOU-FIRST` (needs_attention renders above all other sections, each item = real link + why + ratify link); `OPX3-STALENESS-BANNER` (`updated_at` > 24h → stale banner naming the age); `OPX3-SINCE-HONEST-LABEL` (since-section labeled with the marker date, and the render provably writes no marker).
- **Visual proof:** new `operator-station.html` fixture, 390px + desktop, light + dark, registered in preflight (orphan-harness gate).

### GA-OPS19a — Ratification inbox end-to-end
- **Surface:** artifact scaffolding + `consume-ratification` CLI verb + consumed-state flip + digest feed (§4.4).
- **Touch zones:** `scripts/autoloop/codex-coordinator.js`, `platform/test/run-codex-autoloop.js`, `scripts/autoloop/delivery-status-digest.js`, `Docs/agent-guides/delivery-board.md`, `platform/schemas-index.json` (ratification note frontmatter).
- **model_profile:** heavy · **depends_on:** GA-OPS17a (stub scaffolding rides the projection pass; backfill for the 7 already-parked escalations) · **deploy:** none. **FULL adequacy.**
- **Fixtures:** `OPX4-SCAFFOLD-PREFILLED` (escalation park → pending artifact with exact canonical `target_card` + exact 40-hex `target_head` prefilled from the ledger, decision/accepted_at/authority empty); `OPX4-CONSUME-VALID` (filled artifact → receipt stored with `artifact_sha256`/`section_sha256`, park resolves, artifact `state: consumed`, digest `ratified` entry); `OPX4-CONSUME-TAMPERED-HEAD` (any deviation from the exact 40-hex → refused, zero state change); `OPX4-CONSUME-INCOMPLETE` (empty decision → refused, artifact stays pending, error surfaced in status); `OPX4-REPLAY-LITERAL` (identical re-consume → `no_op: true`; different operands → refuse); `OPX4-CONTAINMENT` (artifact path outside the vault-relative markdown space → refused before any read of state); `OPX4-AUTHORITY-VERBATIM` (authority recorded exactly as written; no policy enforcement in the validator); `OPX4-BACKFILL-IDEMPOTENT` (backfill pass over already-parked escalations scaffolds each once; replay scaffolds none).

### Sequencing

`GA-OPS15a` (visible improvement, independent) → `GA-OPS16a` (small, independent) → `GA-OPS17a` → `GA-OPS18a` + `GA-OPS19a` (both depend on 17a; parallelizable zones permitting — 18a touches blueprints, 19a touches the coordinator, zones are disjoint).

Operational note (not a slice): next loop turn should run `reap --json` to clear the GA-OPS14a residue note.
