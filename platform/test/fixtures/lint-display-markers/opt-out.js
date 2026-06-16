// 0 warnings expected — opt-out marker present.
function parseSection(content) {
    return content.match(/^## Recurring Tasks/m); // lint-display-markers:allow legacy parser kept for v0.118.x compatibility
}
