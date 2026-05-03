# Stage 1 spec compliance review

Date: 2026-05-02
Scope: Stage 1 (Tasks 1.1 - 1.6) of the nav-buttons + project blueprint implementation plan.
Reviewer mode: spec-compliance only (not code-quality).

---

## Docs/Meta/platform-config.json

- [x] `vault_identity` is a top-level key with value `"workshop"` — line 4.
- [x] `variables.rules_path` exists with value `"Docs/Meta/rules"` — line 9.
- [x] `variables.templates_path` exists with value `"Docs/Meta/Templates"` — line 10.
- [x] `variables.commands_path` exists with value `"commands"` — line 11.
- [x] Existing keys preserved: `workshop_relative_path` (line 3), `views_path` (line 6), `templater_scripts_path` (line 7), `scripts_path` (line 8).

---

## platform/install.js — strict substitution (Task 1.2)

- [x] `substitute()` throws on missing variable (not silent fallback) — lines 165-180; collects missing names into a Set, throws `Error` with `.missing` array if size > 0.
- [x] Both call sites in `installItem` wrapped in try/catch — lines 125-132 wrap both `substitute(f.dest, variables)` and `substitute(sourceText, variables)` in a single try block.
- [x] On error: Notice fires with file source + missing var names, function returns false — line 130 `Notice('installItem: ${mech.name} ${f.source} — ${e.message}', 8000)`; line 131 `return false`. The `e.message` includes `Unsubstituted variables: <list>`, so missing var names are surfaced.

---

## platform/install.js — dep resolver (Task 1.3)

- [x] `resolveDependencies` exists; returns `{ nodes: Map, skipped: Array }` — lines 233-264.
- [x] `checkDeps` exists; populates each node's `deps` array, marks `unfit` if dep missing or version-range fails — lines 266-290; sets `node.unfit = true` on miss or range fail and breaks; pushes `dep.name` into `node.deps` on success.
- [x] `satisfiesRange(version, range)` exists; supports exact match + `>=X.Y.Z` — lines 292-305.
- [x] `topoSort(nodes)` exists; returns `{ order, cycle }` (cycle is non-null on cycle detection) — lines 307-329; returns `{ order: null, cycle: name }` on detection.
- [x] Main flow: resolve → load per-item manifests → checkDeps → topoSort → log skips → install in order — lines 56-102 follow the 6-step structure prescribed in plan Task 1.3 Step 2.
- [x] Cycle detection aborts with Notice — lines 73-77 `Notice('platformInstall: dependency cycle involving ${cycle}. Aborting.', 8000); return;`.
- [x] Skip entries written to `installedNow.history` with `{ event: "skip", name, reason, attempted_at }` — lines 80-84.

---

## platform/install.js — installItem + rule_fragments (Task 1.4)

- [x] Function renamed from `installMechanism` to `installItem` — line 108.
- [x] Signature is `(tp, workshopPath, target, itemMan, variables)` — line 108.
- [x] `installMechanism` no longer exists in the file — confirmed by reading the entire file; only `installItem` is present, and the main loop calls `installItem` (line 94).
- [x] rule_fragments loop at end of `installItem` calls `applyRuleFragment(tp, frag, mech.name, variables)` — lines 157-160, immediately before `return true;`.
- [x] `applyRuleFragment` exists at module scope — lines 331-352.
- [x] `applyRuleFragment` writes `${rules_path}/<target>.json` with `contributions[sourceName] = frag.fragment` — lines 339, 349-351.
- [x] Aborts (early-returns) with Notice if `rules_path` is unset — lines 333-337. Note: function returns rather than aborting the entire install; this matches the literal pseudo-code in Task 1.4 Step 2.
- [x] Creates rules directory if missing — line 340 `if (!(await adapter.exists(rulesPath))) await adapter.mkdir(rulesPath);`.

---

## platform/mechanisms/customjs-guard/manifest.json (Task 1.5)

- [x] `rule_fragments[0].fragment` is a JSON object, not a string — lines 14-19.
- [x] Object shape: `{ "forbid_dataviewjs_patterns": [{ "pattern": "...", "reason": "..." }] }` — lines 15-18 match exactly.
- [x] Pattern uses single backslash escape (`\\.` in JSON ⇒ `\.` regex), not quad-backslash — line 17 `"pattern": "await customJS\\."`. JSON-decoded value is `await customJS\.` which is the regex form.

---

## platform/manifest.json (Task 1.6)

- [x] `workshop_version` is `"0.3.0"` — line 3.
- [x] All other top-level keys preserved unchanged — `_comment` (line 2), `date` (line 4), `installer` (lines 5-9), `mechanisms` array of 3 items (lines 10-14), `blueprints: []` (line 15).

---

## Bootstrap copy

- [x] `Docs/Meta/Templater/platformInstall.js` byte-identical to `platform/install.js` — verified via `diff`, output IDENTICAL.

---

## Final verdict

**PASS** — all 26 checklist items pass. No spec gaps detected. Stage 1 is ready for quality review + dogfood (Tasks 1.7 / 1.8 human-in-Obsidian validation).
