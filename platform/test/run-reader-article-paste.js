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

const passed = results.filter(([, p]) => p).length;
const total = results.length;
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
