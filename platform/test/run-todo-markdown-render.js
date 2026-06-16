'use strict';

// Behavioral harness for inline markdown rendering in to-do live-render widgets.
// Asserts on the rendered DOM (not on _cleanTaskText output) so the fix actually
// shows in Obsidian. Repro for v0.118.1 postmortem bug (c).

const fs = require('fs');
const path = require('path');
const { makeStubElement } = require('./helpers/dom-render-stub.js');

let passes = 0; let fails = 0;
function ok(name, fn) {
    try { fn(); console.log('ok ' + name); passes++; }
    catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; }
}
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg ? msg + ' — ' : '') + `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function loadWidget(relPath, className) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
    return new Function(`${src}; return ${className};`)();
}

const ToDoDailyUnassignedMeetings = loadWidget('platform/blueprints/to-do/helpers/todo-daily-unassigned-meetings.js', 'ToDoDailyUnassignedMeetings');
const ToDoDailyProjectGroups      = loadWidget('platform/blueprints/to-do/helpers/todo-daily-project-groups.js', 'ToDoDailyProjectGroups');

function renderAgainst(WidgetClass, text) {
    const widget = new WidgetClass();
    const container = makeStubElement('div');
    widget._renderTaskRow(container, { text, source: 'spice/meetings/notes/2026/06-June/X.md' });
    return container;
}

// ---------- TDM-1: external link renders as <a> ----------
ok('TDM-1 external link → <a href> with text label', () => {
    const c = renderAgainst(ToDoDailyUnassignedMeetings, 'Take a look at [here](https://github.com/foo/bar)');
    const anchors = c._collectAnchors();
    const ext = anchors.filter(a => a.href === 'https://github.com/foo/bar');
    assertEq(ext.length, 1, 'expected exactly one external <a> for the github URL');
    assertEq(ext[0].text, 'here');
    assertEq(ext[0].target, '_blank');
});

// ---------- TDM-2: simple wikilink ----------
ok('TDM-2 wikilink [[Name]] → <a class="internal-link">', () => {
    const c = renderAgainst(ToDoDailyUnassignedMeetings, 'Send docs to [[Patryk Szelagowski]]');
    const anchors = c._collectAnchors();
    const wl = anchors.filter(a => (a.class || '').split(/\s+/).includes('internal-link'));
    assertEq(wl.length, 1, 'expected one internal-link <a>');
    assertEq(wl[0]['data-href'], 'Patryk Szelagowski');
    assertEq(wl[0].text, 'Patryk Szelagowski');
});

// ---------- TDM-3: aliased wikilink ----------
ok('TDM-3 wikilink [[Name|alias]] → <a class="internal-link"> with alias text', () => {
    const c = renderAgainst(ToDoDailyUnassignedMeetings, 'Ping [[Patryk Szelagowski|Patryk]] today');
    const anchors = c._collectAnchors();
    const wl = anchors.filter(a => (a.class || '').split(/\s+/).includes('internal-link'));
    assertEq(wl.length, 1);
    assertEq(wl[0]['data-href'], 'Patryk Szelagowski');
    assertEq(wl[0].text, 'Patryk');
});

// ---------- TDM-4: mixed text + link + text + wikilink ----------
ok('TDM-4 mixed text+link+text+wikilink renders correct sequence', () => {
    const c = renderAgainst(
        ToDoDailyUnassignedMeetings,
        'Take a look at [project](https://example.com) discussed with [[John Doe]]'
    );
    const anchors = c._collectAnchors();
    assertEq(anchors.length, 2, 'expected 2 anchors (one external, one internal)');
    assertEq(anchors[0].href, 'https://example.com');
    assertEq(anchors[0].text, 'project');
    assertEq((anchors[1].class || ''), 'internal-link');
    assertEq(anchors[1]['data-href'], 'John Doe');
});

// ---------- TDM-5: HTML-injection safety ----------
ok('TDM-5 raw HTML in title escapes safely (no <script> element)', () => {
    const c = renderAgainst(ToDoDailyUnassignedMeetings, 'Watch out for <script>alert(1)</script>');
    const txtSpan = c.children.find(ch => !ch.attributes || !('href' in ch.attributes));
    // The injected text must NOT produce a <script> child in our stub
    const scriptChildren = c._collectAnchors().filter(a => a.tagName === 'SCRIPT');
    assertEq(scriptChildren.length, 0);
});

// ---------- TDM-6: same assertions for ToDoDailyProjectGroups ----------
ok('TDM-6 ToDoDailyProjectGroups also renders external link as <a>', () => {
    const c = renderAgainst(ToDoDailyProjectGroups, 'See [docs](https://docs.example.com) for details');
    const anchors = c._collectAnchors();
    const ext = anchors.filter(a => a.href === 'https://docs.example.com');
    assertEq(ext.length, 1);
    assertEq(ext[0].text, 'docs');
});

// ---------- TDM-7: XSS — whitespace-prefixed javascript: scheme must be rejected ----------
// Regression for C1 from final code review: " javascript:alert(1)" (with leading
// whitespace) bypassed _isSafeUrl because the scheme regex `^[a-z]...:` doesn't
// match leading whitespace, fell into the "relative URL — allow" branch, and
// emitted as a clickable <a href> — browsers trim href whitespace before resolve,
// executing the javascript: scheme on click.
ok('TDM-7 leading-whitespace javascript: URL is escaped as plain text (not anchor)', () => {
    const widget = new ToDoDailyUnassignedMeetings();
    // Direct unit-test of _isSafeUrl: all three whitespace/scheme variants must be rejected.
    if (widget._isSafeUrl(' javascript:alert(1)')) throw new Error('leading-space javascript: not rejected');
    if (widget._isSafeUrl('\tjavascript:alert(1)')) throw new Error('leading-tab javascript: not rejected');
    if (widget._isSafeUrl('javascript:alert(1)')) throw new Error('plain javascript: not rejected');
    if (widget._isSafeUrl('JAVASCRIPT:alert(1)')) throw new Error('uppercase javascript: not rejected');
    // Render-path: malicious link emits as escaped text, not anchor.
    const c = renderAgainst(ToDoDailyUnassignedMeetings, '[click](< javascript:alert(1)>)');
    const anchors = c._collectAnchors();
    const danger = anchors.filter(a => /javascript/i.test(a.href || ''));
    assertEq(danger.length, 0, `expected 0 javascript: anchors, got ${danger.length}`);
});

// ---------- TDM-8: same XSS guard for ToDoDailyProjectGroups ----------
ok('TDM-8 ProjectGroups also rejects whitespace-prefixed javascript:', () => {
    const widget = new ToDoDailyProjectGroups();
    if (widget._isSafeUrl(' javascript:alert(1)')) throw new Error('ProjectGroups leading-space javascript: not rejected');
    const c = renderAgainst(ToDoDailyProjectGroups, '[click](< javascript:alert(1)>)');
    const danger = c._collectAnchors().filter(a => /javascript/i.test(a.href || ''));
    assertEq(danger.length, 0);
});

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails === 0 ? 0 : 1);
