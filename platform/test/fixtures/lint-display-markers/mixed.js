// 2 warnings expected — one regex, one string-prefix.
function findHeader(content) {
    if (content.startsWith('## ')) return 'h2';
    return content.match(/^### /);
}
