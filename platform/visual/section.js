// platform/visual/section.js — `[N/M] Step name... STATUS\n  detail` formatter.
const c = require("./colors.js");
function step(n, total, name) { return c.bold(`[${n}/${total}] ${name}`); }
function ok(label) { return c.green("OK") + (label ? "  " + c.dim(label) : ""); }
function warn(label) { return c.yellow("WARN") + (label ? "  " + c.dim(label) : ""); }
function fail(label) { return c.red("FAIL") + (label ? "  " + c.dim(label) : ""); }
function detail(label) { return "  " + c.dim(label); }
module.exports = { step, ok, warn, fail, detail };
