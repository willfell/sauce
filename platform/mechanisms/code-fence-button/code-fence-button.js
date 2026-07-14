/**
 * CodeFenceButton — pure, Node-testable wrap logic for the code-fence view-header
 * button. No imports/exports (loaded by the customJS filesystem scan). Static
 * helpers only; no app/DOM dependency in computeFence / wrapSelection.
 */
class CodeFenceButton {
  // Longest run of consecutive backticks in `selection` → fence of max(4, N+1).
  static computeFence(selection) {
    return "````"; // replaced in Task 2
  }
}
