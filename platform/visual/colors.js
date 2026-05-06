// platform/visual/colors.js — ANSI primitives. No-color when stdout is not a TTY.
const isTTY = process.stdout.isTTY;
function wrap(open, close) { return s => isTTY ? `\x1b[${open}m${s}\x1b[${close}m` : String(s); }
module.exports = {
    bold:   wrap(1, 22),
    dim:    wrap(2, 22),
    red:    wrap(31, 39),
    green:  wrap(32, 39),
    yellow: wrap(33, 39),
    blue:   wrap(34, 39),
    cyan:   wrap(36, 39)
};
