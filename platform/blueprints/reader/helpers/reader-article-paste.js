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
        if (typeof title !== 'string' || title.trim() === '') return 'Article title is required.';
        // Filesystem-hostile chars are allowed: the manifest filename_prefix uses
        // |sanitize-filename (strips them) and the frontmatter keeps the original
        // title. Only reject a title that sanitizes to nothing.
        const sanitized = title.replace(/[\\/:*?"<>|]/g, '').trim();
        if (sanitized === '') return 'Article title needs at least one letter or number.';
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

  // BROWSER-SIDE: open the paste dialog. Reaches other classes only via
  // window.customJS?.X and never throws (cold-load safe). On Create it validates
  // the title, then feeds the UNCHANGED entity-create mechanism via
  // EC.create({instance:'reader-article', dv, presetPrompts}). Pasting into the
  // textarea auto-fills empty Title/URL from the parsed frontmatter.
  open(dv) {
   try {
    const EC = window.customJS && window.customJS.EntityCreate;
    if (!EC || typeof EC.create !== 'function') {
      try { new Notice('ReaderArticlePaste: EntityCreate mechanism unavailable.', 8000); } catch (_e) {}
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background: var(--background-primary); border-radius: 12px; padding: 24px; min-width: 340px; max-width: 560px; width: 90%; box-shadow: 0 8px 32px rgba(0,0,0,0.3);';

    const heading = document.createElement('div');
    heading.textContent = 'New article';
    heading.style.cssText = 'font-size: 1.1em; font-weight: 600; margin-bottom: 4px;';
    dialog.appendChild(heading);

    const hint = document.createElement('div');
    hint.textContent = 'Paste a Web Clipper "Copy" here — or leave it empty and just name it.';
    hint.style.cssText = 'font-size: 0.8em; color: var(--text-muted); margin-bottom: 12px;';
    dialog.appendChild(hint);

    const paste = document.createElement('textarea');
    paste.rows = 8;
    paste.placeholder = 'Paste article frontmatter + body…';
    paste.style.cssText = 'width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.9em; font-family: var(--font-monospace); resize: vertical; margin-bottom: 12px;';
    dialog.appendChild(paste);

    const mkField = (labelText, type) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
      const lab = document.createElement('label');
      lab.textContent = labelText;
      lab.style.cssText = 'font-size: 0.85em; color: var(--text-muted); flex: 0 0 48px;';
      const input = document.createElement('input');
      input.type = type;
      input.style.cssText = 'flex: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-secondary); color: var(--text-normal); font-size: 0.9em; box-sizing: border-box;';
      wrap.appendChild(lab); wrap.appendChild(input);
      dialog.appendChild(wrap);
      return input;
    };
    const titleInput = mkField('Title', 'text');
    const urlInput = mkField('URL', 'text');

    const status = document.createElement('div');
    status.style.cssText = 'font-size: 0.8em; color: var(--text-error); min-height: 1em; margin: 4px 0 8px;';
    dialog.appendChild(status);

    // Auto-fill empty Title/URL from the parsed paste as the user types/pastes.
    let lastParsed = ReaderArticlePaste.parse('');
    const reparse = () => {
      lastParsed = ReaderArticlePaste.parse(paste.value);
      const fm = lastParsed.frontmatter || {};
      if (fm.title && !titleInput.value) titleInput.value = fm.title;
      if (fm.url && !urlInput.value) urlInput.value = fm.url;
    };
    paste.addEventListener('input', reparse);
    paste.addEventListener('paste', () => setTimeout(reparse, 0));

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-muted);';
    const close = () => { if (overlay.parentNode) document.body.removeChild(overlay); };
    cancelBtn.onclick = () => close();

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Create';
    okBtn.style.cssText = 'padding: 6px 14px; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); background: var(--interactive-accent); color: var(--text-on-accent);';
    okBtn.onclick = () => {
      const err = ReaderArticlePaste.validateTitle(titleInput.value);
      if (err) { status.textContent = err; return; }
      const presetPrompts = ReaderArticlePaste.buildPresetPrompts(lastParsed, {
        title: titleInput.value, url: urlInput.value,
      });
      close();
      try { EC.create({ instance: 'reader-article', dv: dv, presetPrompts: presetPrompts }); }
      catch (e) { try { new Notice('ReaderArticlePaste: could not create article — ' + e.message, 8000); } catch (_e) {} }
    };

    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); okBtn.click(); }
    });

    btnRow.appendChild(cancelBtn); btnRow.appendChild(okBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancelBtn.click(); });
    document.body.appendChild(overlay);
    setTimeout(() => paste.focus(), 0);
   } catch (_e) {
     try { new Notice('ReaderArticlePaste: dialog error.', 6000); } catch (_e2) {}
   }
  }
}
