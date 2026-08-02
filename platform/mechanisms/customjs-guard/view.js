// Guarded CustomJS dispatcher for dataviewjs blocks.
//
// Canonical usage (always-object form):
//   await dv.view("Extras/Scripts/customjs-guard", { class: "SpaceNavButtons" });
//   await dv.view("Extras/Scripts/customjs-guard", { class: "TodoDataviewBlocks", method: "renderCarryover" });
//
// Optional input fields:
//   class   (required) — the CustomJS class name on window.customJS
//   method  (default "render")
//   args    (default []) — additional args passed after dv
//
// This file is a Dataview view script — its body runs inline with `dv`
// and `input` already in scope. Do NOT wrap it in module.exports.
//
// Why this exists: on cold vault load, Dataview/Templater can render a
// note before the CustomJS plugin has registered window.customJS, which
// produces a flash of "ReferenceError: customJS is not defined" in every
// block that uses it. This helper polls for up to ~10s per registration
// phase, shows a muted spinner (.customjs-loader CSS snippet) while waiting,
// and gives an actionable diagnostic if CustomJS or the class never appears.

const cfg = typeof input === "string" ? { class: input } : (input ?? {});
const className = cfg.class;
const method = cfg.method ?? "render";
const argsValid = cfg.args === undefined || Array.isArray(cfg.args);
const args = Array.isArray(cfg.args) ? cfg.args : [];

if (!className) {
  dv.paragraph("_customjs-guard: missing `class`_");
} else if (!argsValid) {
  dv.paragraph("_customjs-guard: `args` must be an array_");
} else {
  const MAX_POLL_ATTEMPTS = 200;
  const POLL_INTERVAL_MS = 50;
  const loader = dv.container.createEl("div", { cls: "customjs-loader", text: "loading…" });
  for (let i = 0; i < MAX_POLL_ATTEMPTS && !window.customJS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  for (let i = 0; i < MAX_POLL_ATTEMPTS && window.customJS && !window.customJS[className]; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  loader.remove();

  const klass = window.customJS?.[className];
  if (!window.customJS) {
    dv.paragraph("_CustomJS is still loading — reopen this note to try again._");
  } else if (!klass) {
    dv.paragraph(`_${className} is not loaded. Mobile: fully reopen Obsidian, then verify its script synced._`);
  } else {
    const target = klass[method];
    if (typeof target !== "function") {
      dv.paragraph(`_${className}.${method} is not a function_`);
    } else {
      await target.call(klass, dv, ...args);
    }
  }
}
