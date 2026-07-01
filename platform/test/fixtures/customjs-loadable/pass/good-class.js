// Self-test fixture (PASS): a bare customJS class — no trailing statements.
// CustomJS wraps the whole file in ( ... ) and evals it as a single expression,
// so a file that is ONLY a class expression loads + instantiates cleanly.
class GoodClass {
  render(dv) {
    dv.paragraph("ok");
  }
}
