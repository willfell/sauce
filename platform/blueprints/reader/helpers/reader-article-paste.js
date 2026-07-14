/**
 * ReaderArticlePaste (CustomJS) — reader-hub's "+ New article" paste dialog.
 *
 * Lets the user paste a Web-Clipper "Copy" payload (YAML frontmatter + a body
 * with READER_HIGHLIGHTS / READER_CONTENT markers) into one dialog that also
 * carries editable Title + URL inputs. Parsed fields are injected into the
 * UNCHANGED shared entity-create mechanism via
 * EC.create({instance, dv, presetPrompts}); presetPrompts short-circuit skips
 * entity-create's own UI + validation for every supplied key. Malformed pastes
 * fall back to "whole paste is content, manual Title required" — the flow never
 * blocks on errors.
 *
 * PURE STATICS (Node-testable, no DOM/app/dv):
 *   ReaderArticlePaste.parse(raw)               → { frontmatter, highlights, content, malformed }
 *   ReaderArticlePaste.buildPresetPrompts(p, m) → { title, url, author, ... } for EC.create
 *   ReaderArticlePaste.validateTitle(title)     → error string | null
 *
 * BROWSER-SIDE:
 *   ReaderArticlePaste.open(dv)                 ← opens dialog, wires Create → EC.create
 *
 * COLD-LOAD SAFETY (landmines #1-5): statics never touch DOM; open() reaches
 * other classes only via window.customJS?.X and never throws.
 *
 * BARE CLASS ONLY (CustomJS evals the whole file as ONE expression;
 * Node-test loads via new Function(src + "\nreturn ReaderArticlePaste;")()).
 */
class ReaderArticlePaste {
  static parse(raw) {
    const text = (typeof raw === 'string') ? raw : '';
    try {
      // Frontmatter must be a leading --- … --- block.
      const m = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) { return { frontmatter: {}, highlights: '', content: text, malformed: true }; }
      const fm = ReaderArticlePaste._parseFrontmatter(m[1]);
      if (!fm || typeof fm.title !== 'string' || fm.title.trim() === '') {
        // Frontmatter block present but no usable title → treat as malformed.
        return { frontmatter: {}, highlights: '', content: text, malformed: true };
      }
      const body = m[2] || '';
      const { highlights, content } = ReaderArticlePaste._splitBody(body);
      return { frontmatter: fm, highlights, content, malformed: false };
    } catch (_e) {
      return { frontmatter: {}, highlights: '', content: text, malformed: true };
    }
  }

  // Minimal, shape-scoped frontmatter parser (NOT general YAML): flat
  // `key: value` scalars + one `tags:` array (inline [a, b] or bulleted list).
  static _parseFrontmatter(block) {
    const out = {};
    const lines = String(block).split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const km = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!km) { i++; continue; }
      const key = km[1];
      const val = km[2];
      if (key === 'tags') {
        const inline = val.match(/^\[(.*)\]$/);
        if (inline) {
          out.tags = inline[1].split(',')
            .map((s) => ReaderArticlePaste._unquote(s.trim()))
            .filter((s) => s !== '');
          i++;
        } else if (val.trim() === '') {
          // Bulleted list on following lines.
          const arr = [];
          let j = i + 1;
          while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
            arr.push(ReaderArticlePaste._unquote(lines[j].replace(/^\s*-\s+/, '').trim()));
            j++;
          }
          out.tags = arr.filter((s) => s !== '');
          i = j;
        } else {
          out.tags = [ReaderArticlePaste._unquote(val.trim())].filter((s) => s !== '');
          i++;
        }
      } else {
        out[key] = ReaderArticlePaste._unquote(val.trim());
        i++;
      }
    }
    return out;
  }

  static _unquote(s) {
    if (typeof s !== 'string') return s;
    const t = s.trim();
    if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
      return t.slice(1, -1);
    }
    return t;
  }

  // Split body on READER_HIGHLIGHTS / READER_CONTENT marker comments.
  static _splitBody(body) {
    const HL = /\[\/\/\]:\s*#\s*\(READER_HIGHLIGHTS\)/;
    const CT = /\[\/\/\]:\s*#\s*\(READER_CONTENT\)/;
    const hlIdx = body.search(HL);
    const ctIdx = body.search(CT);
    if (ctIdx === -1) {
      // No content marker: the post-frontmatter remainder is all content.
      return { highlights: '', content: body.trim() };
    }
    const ctMarkerLen = (body.slice(ctIdx).match(CT) || [''])[0].length;
    const contentRaw = body.slice(ctIdx + ctMarkerLen);
    let highlights = '';
    if (hlIdx !== -1 && hlIdx < ctIdx) {
      const hlMarkerLen = (body.slice(hlIdx).match(HL) || [''])[0].length;
      highlights = body.slice(hlIdx + hlMarkerLen, ctIdx);
    }
    return { highlights: highlights.trim(), content: contentRaw.trim() };
  }

  // Mirror the manifest's `title` prompt: required + safe-filename. Returns an
  // error string when invalid, null when OK. (entity-create's presetPrompts
  // short-circuit skips its own validation for preset keys, so the dialog must
  // enforce this itself before EC.create.)
  static validateTitle(title) {
    if (typeof title !== 'string' || title.trim() === '') {
      return 'Title is required.';
    }
    // Reject path/filesystem-hostile characters (safe-filename).
    if (/[\\/:*?"<>|]/.test(title)) {
      return 'Title cannot contain \\ / : * ? " < > |';
    }
    return null;
  }

  // Map parse() result + the dialog's (possibly edited) title/url inputs into
  // the presetPrompts object EC.create consumes. Every key here MUST also exist
  // in the manifest's new_entity_buttons[0].prompts[] so {{prompts.<key>}} can
  // resolve. Defaults mirror today's manifest frontmatter_template so an empty
  // paste yields a note byte-equivalent to the old title+url-only path.
  static buildPresetPrompts(parsed, manual) {
    const p = (parsed && parsed.frontmatter) ? parsed.frontmatter : {};
    const m = manual || {};
    const str = (v, d) => (typeof v === 'string' && v !== '') ? v : d;
    let tags = ['reader-article'];
    if (Array.isArray(p.tags) && p.tags.length > 0) tags = p.tags;
    const capturedAt = str(p.captured_at, '') || new Date().toISOString();
    return {
      title: str(m.title, ''),
      url: str(m.url, ''),
      author: str(p.author, ''),
      site: str(p.site, ''),
      published: str(p.published, ''),
      captured_at: capturedAt,
      word_count: (p.word_count !== undefined && p.word_count !== '') ? p.word_count : 0,
      status: str(p.status, 'unread'),
      summary: str(p.summary, ''),
      tags: tags,
      highlights: (parsed && typeof parsed.highlights === 'string') ? parsed.highlights : '',
      content: (parsed && typeof parsed.content === 'string') ? parsed.content : '',
    };
  }
}
