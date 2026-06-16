// Clean fixture — no display-marker dependencies.
function parseFrontmatter(content) {
    const idx = content.indexOf('---', 4);
    return content.slice(0, idx);
}
function parseAnchor(content) {
    const re = /<!-- section-start -->/;
    return re.test(content);
}
