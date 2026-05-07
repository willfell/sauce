// platform/visual/banner.js — three-line box-drawing banner.
const c = require("./colors.js");
function render(opts) {
    const ver = (opts && opts.version) || "0.0.0";
    const sub = (opts && opts.subtitle) || "Obsidian vault platform";
    const W = 38;
    const pad = s => "  " + s.padEnd(W) + "  ";
    const line1 = "  ╔" + "═".repeat(W + 2) + "╗";
    const line2 = "  ║" + pad(`Sauce   ·  v${ver}`).slice(2, W + 2) + "  ║";
    const line3 = "  ║" + pad(sub).slice(2, W + 2) + "  ║";
    const line4 = "  ╚" + "═".repeat(W + 2) + "╝";
    return [line1, c.bold(line2), c.dim(line3), line4].join("\n");
}
module.exports = { render };
