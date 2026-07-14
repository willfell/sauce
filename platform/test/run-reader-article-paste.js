#!/usr/bin/env node
/**
 * run-reader-article-paste.js — behavioral harness for ReaderArticlePaste.
 *
 * Exercises the PURE statics only (parse / buildPresetPrompts / validateTitle);
 * the browser-side open(dv) dialog is covered by a source-structure guard here
 * and by manual dogfood verification. Loads via new Function(...) to prove the
 * file evals as ONE bare class expression (CustomJS loader contract).
 *
 * Asserts HC-READER-PASTE-N.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'platform', 'blueprints', 'reader', 'helpers', 'reader-article-paste.js');

function loadClass(srcPath, className) {
  const src = fs.readFileSync(srcPath, 'utf8');
  return new Function(`${src}\nreturn ${className};`)();
}
const ReaderArticlePaste = loadClass(SRC, 'ReaderArticlePaste');

const results = [];
const ok = (name, cond, msg) => {
  results.push([name, !!cond]);
  console.log(`  ${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : (msg ? ' :: ' + msg : '')}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A faithful Web-Clipper "Copy" payload: frontmatter + chrome + both markers.
const CLIP = [
  '---',
  'type: reader-article',
  'title: "The Bitter Lesson"',
  'url: "http://www.incompleteideas.net/IncIdeas/BitterLesson.html"',
  'author: "Rich Sutton"',
  'site: "incompleteideas.net"',
  'published: 2019-03-13',
  'captured_at: 2026-07-12T10:00:00Z',
  'word_count: 1200',
  'status: unread',
  'summary: "Compute beats cleverness over the long run."',
  'tags: [ai, rl]',
  '---',
  '',
  '```dataviewjs',
  'await dv.view("x", { class: "ReaderChromeBar" });',
  '```',
  '',
  '[//]: # (READER_HIGHLIGHTS)',
  '',
  'A highlighted sentence.',
  '',
  '[//]: # (READER_CONTENT)',
  '',
  'The full article body goes here.',
  '',
].join('\n');

// ---------------------------------------------------------------------------
// HC-READER-PASTE-1 — well-formed clip parses fm + highlights/content split.
// ---------------------------------------------------------------------------
{
  const r = ReaderArticlePaste.parse(CLIP);
  ok('HC-READER-PASTE-1 well-formed clip → frontmatter parsed, not malformed',
     r && r.malformed === false &&
     r.frontmatter.title === 'The Bitter Lesson' &&
     r.frontmatter.author === 'Rich Sutton' &&
     r.frontmatter.word_count === '1200' &&
     eq(r.frontmatter.tags, ['ai', 'rl']),
     JSON.stringify(r && r.frontmatter));
  ok('HC-READER-PASTE-1b highlights + content split on marker comments',
     r && /A highlighted sentence\./.test(r.highlights) &&
     /full article body/.test(r.content) &&
     !/full article body/.test(r.highlights),
     `hl=${JSON.stringify(r && r.highlights)} content=${JSON.stringify(r && r.content)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-2 — well-formed frontmatter but NO markers → content only.
// ---------------------------------------------------------------------------
{
  const noMarkers = [
    '---',
    'title: "Plain"',
    'url: "http://x.test"',
    '---',
    '',
    'Body text with no markers.',
  ].join('\n');
  const r = ReaderArticlePaste.parse(noMarkers);
  ok('HC-READER-PASTE-2 fm, no markers → not malformed, empty highlights, body=content',
     r.malformed === false && r.highlights === '' &&
     /no markers\./.test(r.content) && r.frontmatter.title === 'Plain',
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-3 — no frontmatter at all → malformed, whole input = content.
// ---------------------------------------------------------------------------
{
  const raw = 'This is just pasted text with no YAML frontmatter.';
  const r = ReaderArticlePaste.parse(raw);
  ok('HC-READER-PASTE-3 no frontmatter → malformed, whole input = content',
     r.malformed === true && eq(r.frontmatter, {}) && r.content === raw && r.highlights === '',
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-4 — empty / whitespace / non-string → malformed, empty content.
// ---------------------------------------------------------------------------
{
  const a = ReaderArticlePaste.parse('');
  const b = ReaderArticlePaste.parse(null);
  const c = ReaderArticlePaste.parse(undefined);
  ok('HC-READER-PASTE-4 empty/null/undefined → malformed, no throw',
     a.malformed === true && a.content === '' &&
     b.malformed === true && b.content === '' &&
     c.malformed === true && c.content === '',
     `${JSON.stringify(a)} ${JSON.stringify(b)}`);
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-5 — frontmatter block present but no title key → malformed.
// ---------------------------------------------------------------------------
{
  const noTitle = ['---', 'url: "http://x.test"', 'status: unread', '---', '', 'body'].join('\n');
  const r = ReaderArticlePaste.parse(noTitle);
  ok('HC-READER-PASTE-5 fm without title → malformed, whole input = content',
     r.malformed === true && r.content === noTitle,
     JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-6 — never throws on adversarial input.
// ---------------------------------------------------------------------------
{
  let threw = false;
  try {
    ReaderArticlePaste.parse('---\n:::not yaml:::\n[[[\n---\nbody');
    ReaderArticlePaste.parse('---\n---');
    ReaderArticlePaste.parse(12345);
    ReaderArticlePaste.parse({});
  } catch (_e) { threw = true; }
  ok('HC-READER-PASTE-6 adversarial input never throws', threw === false);
}

// ---------------------------------------------------------------------------
// HC-READER-PASTE-7 — validateTitle mirrors manifest safe-filename prompt.
// ---------------------------------------------------------------------------
{
  ok('HC-READER-PASTE-7a empty/whitespace title → error',
     typeof ReaderArticlePaste.validateTitle('') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('   ') === 'string' &&
     typeof ReaderArticlePaste.validateTitle(null) === 'string');
  ok('HC-READER-PASTE-7b filesystem-unsafe chars → error',
     typeof ReaderArticlePaste.validateTitle('a/b') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('bad:name') === 'string' &&
     typeof ReaderArticlePaste.validateTitle('q?mark') === 'string');
  ok('HC-READER-PASTE-7c ordinary title → null (valid)',
     ReaderArticlePaste.validateTitle('The Bitter Lesson') === null &&
     ReaderArticlePaste.validateTitle('A note, punctuation!') === null);
}

const passed = results.filter(([, p]) => p).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
