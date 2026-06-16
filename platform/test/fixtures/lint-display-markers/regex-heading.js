// 1 warning expected — regex anchored on heading.
function parseSection(content) {
    return content.match(/^## Recurring Tasks/m);
}
