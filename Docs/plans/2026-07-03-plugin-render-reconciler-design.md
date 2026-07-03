# Sauce plugin — event-driven render reconciler — design

**Date:** 2026-07-03
**Status:** Design → plan → subagent build → ship to vaults (autonomous)
**Scope:** Extend the `sauce` plugin so it drives *faster reconciliation* of Dataview views on vault changes, escaping the 2.5s refresh debounce — **safe-by-construction** (Dataview stays the renderer + the backstop; the active-edit path is never touched).

---

## 1. Problem
After a vault change, dataviewjs views only reconcile when Dataview's `refreshInterval:2500` debounce fires — up to a 2.5s lag before a hub/dashboard reflects a background change. (Task complete/add is already instant via v0.187.1's optimistic UI + metadataCache-gated force-refresh; this generalizes fast reconcile to *all* background changes.)

## 2. What we will NOT do (and why)
We will **not** hand-render individual dataviewjs blocks in the plugin. That "targeted re-render" is the theoretically-optimal fix but is unsafe: it has no fallback (a mis-fire shows stale/wrong data forever if Dataview's refresh is suppressed), it isn't headlessly verifiable (real-Obsidian event/render timing), and coexisting with Dataview's own refresh causes double-renders. Out of scope.

## 3. Design — a debounced, active-edit-aware fast-reconciler
The plugin registers (via `this.registerEvent`, auto-detached on unload) listeners on `metadataCache.on('changed')` + `vault.on('rename')` + `vault.on('delete')`. Each change:
- **`shouldReconcile(changedPath, activePath)`** (pure static) → `true` iff `changedPath` is set AND `changedPath !== activePath`. **Changes to the file you're actively editing are skipped** — so typing never triggers a refresh of the note you're in (no flicker regression). Background changes qualify.
- A qualifying change schedules a **debounced (~500ms)** reconcile (a timer reset on each qualifying event, coalescing bursts like sync).
- On fire: `app.commands.executeCommandById('dataview:dataview-force-refresh-views')` (Dataview re-renders its shown views — correctly, as always). Wrapped try/catch → **no-op if the command is absent**.

## 4. Why this cannot regress ("works first go")
- **Dataview remains the renderer + the backstop.** The plugin only makes Dataview's *own* refresh happen sooner (~500ms vs 2.5s) for background changes. If the plugin's listener/command mis-fires or is unavailable, Dataview's untouched 2.5s refresh still reconciles — worst case = today's behavior.
- **The active-edit path is never touched** (`shouldReconcile` skips the active file) → no typing-flicker regression.
- **Debounced** → no thrash during sync/bulk changes; **`registerEvent`** → no listener leak.
- Overlaps harmlessly with v0.187.1's L4 task-write force-refresh (both debounce-coalesce).

## 5. Testing (headless — the verifiable surface)
Extend `platform/test/run-sauce-plugin.js`:
- **RC-1** `shouldReconcile`: true for a background path; false when `changed===active`; false for null/empty.
- **RC-2** a background-file change schedules exactly one debounced reconcile; two rapid changes coalesce to one (injected timer fns); the fired reconcile calls `executeCommandById('dataview:dataview-force-refresh-views')`.
- **RC-3** an active-file change schedules NO reconcile.
- **RC-4** absent `commands`/`executeCommandById` → fire is a no-op, never throws.
- **RC-5** `onload` wires the listeners via `registerEvent` (spy) without throwing.
Full `release:preflight` green; the plugin `main.js` still reads as non-class (customjs scanners skip it).

## 6. Ship
sauce-plugin mechanism (already subscribed on all 3 consumers) → the change re-vendors on `deploy.js` bump-pins. **User must fully RESTART Obsidian** to load the updated plugin. Design→plan→TDD→PR→CI→merge→release→tap→deploy→verify.
