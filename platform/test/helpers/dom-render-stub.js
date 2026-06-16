'use strict';

// Narrow DOM stub for to-do widget rendering tests. Supports:
//   container.createEl(tag, opts?)  → element node
//   element.createEl(tag, opts?)    → recursive child node
//   element.style                   → mutable plain object
//   element.textContent (get/set)   → with property semantics
//   element.innerHTML (get/set)     → with HTML-string semantics
//   element.children                → array of child nodes
//   element.querySelectorAll(sel)   → minimal: supports 'a', 'a.internal-link', 'a[href]'
//   element.closest(sel)            → always returns null (good enough for the .markdown-embed guard)
//
// NOT a full DOM. Intentionally narrow. If a widget under test needs more,
// extend incrementally — DO NOT pull in jsdom (zero-deps rule).

function makeStubElement(tag) {
    const el = {
        tagName: String(tag || 'DIV').toUpperCase(),
        attributes: {},
        style: {},
        children: [],
        _textContent: '',
        _innerHTML: '',
        get textContent() { return this._textContent; },
        set textContent(v) {
            this._textContent = String(v == null ? '' : v);
            this.children = [];   // setting textContent wipes children, per DOM spec
            this._innerHTML = '';
        },
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = String(v == null ? '' : v);
            // Parse a minimal subset to populate children + textContent for assertions.
            // We only need to surface <a> elements with their attributes for our tests.
            this.children = parseAnchorsFromHtml(this._innerHTML);
            this._textContent = stripTags(this._innerHTML);
        },
        get classList() {
            const self = this;
            return {
                add: (...cls) => {
                    const cur = (self.attributes.class || '').split(/\s+/).filter(Boolean);
                    for (const c of cls) if (!cur.includes(c)) cur.push(c);
                    self.attributes.class = cur.join(' ');
                },
                remove: (...cls) => {
                    const cur = (self.attributes.class || '').split(/\s+/).filter(Boolean);
                    self.attributes.class = cur.filter(c => !cls.includes(c)).join(' ');
                },
                contains: (c) => (self.attributes.class || '').split(/\s+/).includes(c),
            };
        },
        createEl(childTag, opts) {
            const child = makeStubElement(childTag);
            if (opts) {
                if (opts.text != null) child.textContent = opts.text;
                if (opts.cls) child.attributes.class = String(opts.cls);
                if (opts.attr) for (const k of Object.keys(opts.attr)) child.attributes[k] = String(opts.attr[k]);
                if (opts.href != null) child.attributes.href = String(opts.href);
            }
            this.children.push(child);
            return child;
        },
        closest(_sel) { return null; },
        querySelectorAll(sel) {
            // Walk descendants; match: 'a', 'a.internal-link', 'a[href]'.
            const out = [];
            walk(this);
            return out;
            function walk(node) {
                for (const c of node.children) {
                    if (selectorMatches(c, sel)) out.push(c);
                    walk(c);
                }
            }
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        // Convenience for tests: collect all <a> attributes from this subtree.
        _collectAnchors() {
            const out = [];
            const visit = (n) => {
                if (n.tagName === 'A') out.push({ ...n.attributes, text: n.textContent || '' });
                for (const c of n.children) visit(c);
            };
            visit(this);
            return out;
        },
    };
    el.onclick = null;
    return el;
}

function selectorMatches(el, sel) {
    if (el.tagName !== 'A') {
        if (!/^a/.test(sel)) return false;
    }
    if (sel === 'a') return el.tagName === 'A';
    const classMatch = /^a\.([\w-]+)$/.exec(sel);
    if (classMatch) {
        return el.tagName === 'A' && (el.attributes.class || '').split(/\s+/).includes(classMatch[1]);
    }
    const attrMatch = /^a\[(\w+)\]$/.exec(sel);
    if (attrMatch) {
        return el.tagName === 'A' && Object.prototype.hasOwnProperty.call(el.attributes, attrMatch[1]);
    }
    return false;
}

function parseAnchorsFromHtml(html) {
    // Extract <a ... >text</a> elements. Stub purpose only — not a real parser.
    const out = [];
    const re = /<a\b([^>]*)>([^<]*)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const a = makeStubElement('a');
        const attrRe = /(\w[\w-]*)=("([^"]*)"|'([^']*)')/g;
        let am;
        while ((am = attrRe.exec(m[1])) !== null) {
            a.attributes[am[1]] = am[3] != null ? am[3] : am[4];
        }
        a._textContent = m[2];
        out.push(a);
    }
    // Plain-text segments BETWEEN <a> elements are returned as text-only stub
    // nodes so callers iterating children see the full sequence.
    const text = stripTags(html);
    if (text && !out.length) {
        const t = makeStubElement('span');
        t._textContent = text;
        return [t];
    }
    return out;
}

function stripTags(html) {
    // Loop until fixed point so embedded patterns like `<scr<script>ipt>` don't
    // round-trip through a single pass. Test-only utility (the stubs process
    // test fixtures, never untrusted user input) but CodeQL flags the
    // single-pass form (js/incomplete-multi-character-sanitization) so we use
    // the safe form here too.
    let s = String(html || '');
    let prev;
    do { prev = s; s = s.replace(/<[^>]+>/g, ''); } while (s !== prev);
    return s;
}

module.exports = { makeStubElement };
