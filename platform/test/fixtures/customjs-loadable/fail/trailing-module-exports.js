// Self-test fixture (FAIL): a class followed by a trailing `if` statement
// (the Node dual-export trailer). This parses fine as a Node *script* (two
// valid statements) — so `node --check` and `require()` are green — but
// CustomJS wraps the file in ( ... ) and evals it as a single *expression*,
// where a class expression followed by an `if` statement is a SyntaxError
// ("Unexpected token 'if'"). This is the exact shape of the bug that made
// SpaceDailyDashboard fail to register. The gate MUST flag this.
class TrailingModuleExports {
  render(dv) {
    dv.paragraph("nope");
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TrailingModuleExports };
}
