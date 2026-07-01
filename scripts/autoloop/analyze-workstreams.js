#!/usr/bin/env node
/**
 * analyze-workstreams — read-only divergence analysis for the project
 * `workstreams` frontmatter, split today between a project's hub (atlas) note
 * (type:project) and its Map note (type:map). Slice 0 of the "Workstreams in
 * Projects need updating" epic: produce the evidence (per-project hub-vs-map
 * divergence profile) that the Slice 3/4 merge rule needs, BEFORE any migration
 * ships. Pure functions in; a fixture harness (platform/test/run-workstreams-
 * analysis.js) proves the report. The CLI walks a real vault's projects dir and
 * only READS — it never writes.
 *
 * Exports: parseWorkstreams, analyzeProject, analyzeVault, extractWorkstreams,
 *          fmType, sameSet, unionOf
 */
'use strict';

// Normalize a raw `workstreams` value into an ordered, deduped array of trimmed
// non-empty strings. Accepts an array, a JSON-encoded string, null/undefined, or
// garbage (-> []). Values are opaque (plain names or [[wikilinks]]) — compared as
// trimmed strings.
function parseWorkstreams(value) {
  let raw = value;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try { raw = JSON.parse(s); } catch (_e) { raw = [s]; }
  }
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (entry == null) continue;
    const v = String(entry).trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function unionOf(a, b) {
  const out = a.slice();
  const seen = new Set(a);
  for (const x of b) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

function difference(a, b) { // items in a not in b
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

// Analyze one project's hub vs map workstreams. `hubWs`/`mapWs` are raw
// frontmatter values (normalized via parseWorkstreams).
function analyzeProject(o) {
  const hubWs = parseWorkstreams(o && o.hubWs);
  const mapWs = parseWorkstreams(o && o.mapWs);
  const hubHas = hubWs.length > 0;
  const mapHas = mapWs.length > 0;
  const agree = sameSet(hubWs, mapWs);
  const union = unionOf(hubWs, mapWs);
  // map-wins merge: prefer the Map note's list; fall back to the hub when the
  // Map note has none. This is the candidate Slice-3 rule; the analysis flags
  // where it would DROP data that a union would keep (unionVsMapWinsDiffer).
  const mapWins = mapHas ? mapWs : hubWs;
  const unionVsMapWinsDiffer = !sameSet(union, mapWins);
  return {
    slug: (o && o.slug) || null,
    hubWs,
    mapWs,
    hubHas,
    mapHas,
    agree,
    union,
    mapWins,
    unionVsMapWinsDiffer,
    onlyOnHub: difference(hubWs, mapWs),
    onlyOnMap: difference(mapWs, hubWs),
  };
}

// Analyze a whole vault: projects = [{slug, hubWs, mapWs}] -> per-project reports
// + a roll-up summary (the divergence profile).
function analyzeVault(projects) {
  const perProject = (Array.isArray(projects) ? projects : []).map(analyzeProject);
  const summary = {
    total: perProject.length,
    bothEmpty: perProject.filter((p) => !p.hubHas && !p.mapHas).length,
    agreeNonEmpty: perProject.filter((p) => (p.hubHas || p.mapHas) && p.agree).length,
    diverge: perProject.filter((p) => !p.agree).length,
    hubOnly: perProject.filter((p) => p.hubHas && !p.mapHas).length,
    mapOnly: perProject.filter((p) => p.mapHas && !p.hubHas).length,
    unionDiffersFromMapWins: perProject.filter((p) => p.unionVsMapWinsDiffer).length,
  };
  return { perProject, summary };
}

// ---- frontmatter helpers (read-only text parse; zero-dep) ----

function frontmatterBlock(noteText) {
  const m = String(noteText || '').match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}

function fmType(noteText) {
  const m = frontmatterBlock(noteText).match(/^type:\s*["']?([a-z-]+)["']?\s*$/m);
  return m ? m[1] : '';
}

// Extract the `workstreams` identities from a note's YAML frontmatter as a
// normalized string array. The real data model is a block list of OBJECTS
// (`- id: bedroom\n    name: Bedroom\n    description: ""`), so the workstream
// IDENTITY is each item's `id` field. Also handles: bare-scalar list items
// (`- "[[X]]"` / `- Foo`), inline arrays (`[a, "b"]`), and empty (`[]`/absent).
// Read-only text parse; zero-dep.
function extractWorkstreams(noteText) {
  const fm = frontmatterBlock(noteText);
  if (!fm) return [];
  const lines = fm.split('\n');
  const i = lines.findIndex((l) => /^workstreams:\s*(.*)$/.test(l));
  if (i < 0) return [];
  const rest = lines[i].match(/^workstreams:\s*(.*)$/)[1].trim();
  if (rest === '[]') return [];
  if (rest.startsWith('[')) {
    const inner = rest.replace(/^\[/, '').replace(/\]$/, '');
    const parts = inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    return parseWorkstreams(parts);
  }
  if (rest) return parseWorkstreams([rest.replace(/^["']|["']$/g, '')]);

  // Block list. Each item starts at a `-` line; an object item's identity is its
  // `id` (inline on the dash line or on a deeper sub-line). Stops at the next
  // top-level key (a line starting with a non-space, non-dash char).
  const items = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    // Identity precedence: id > bare scalar > name. Falling back to `name` means a
    // (malformed) object item with a name but no id still COUNTS as a workstream —
    // dropping it would understate the very divergence this tool measures.
    const val = cur.id != null ? cur.id : (cur.scalar != null ? cur.scalar : cur.name);
    if (val != null && String(val).trim()) items.push(String(val).trim());
    cur = null;
  };
  // Strip a trailing inline YAML comment (whitespace + `#...`) THEN surrounding
  // quotes, so `- id: ops   # east` yields `ops`, not `ops   # east`.
  const unquote = (s) => String(s).trim().replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^[^\s-]/.test(line)) break; // next top-level frontmatter key
    const dash = line.match(/^\s*-\s+(.*)$/);
    if (dash) {
      flush();
      cur = {};
      const itemRest = dash[1].trim();
      const idInline = itemRest.match(/^id:\s*(.+)$/);
      const nameInline = itemRest.match(/^name:\s*(.+)$/);
      if (idInline) cur.id = unquote(idInline[1]);
      else if (nameInline) cur.name = unquote(nameInline[1]);
      else if (itemRest && !/^\w+:/.test(itemRest)) cur.scalar = unquote(itemRest);
      continue;
    }
    if (cur) {
      if (cur.id == null) {
        const sub = line.match(/^\s+id:\s*(.+)$/);
        if (sub) cur.id = unquote(sub[1]);
      }
      if (cur.name == null) {
        const subN = line.match(/^\s+name:\s*(.+)$/);
        if (subN) cur.name = unquote(subN[1]);
      }
    }
  }
  flush();
  return parseWorkstreams(items);
}

module.exports = {
  parseWorkstreams,
  analyzeProject,
  analyzeVault,
  extractWorkstreams,
  fmType,
  sameSet,
  unionOf,
};

// ---- CLI: walk a real vault's projects dir (READ-ONLY) ----
if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const root = process.argv[2];
  if (!root) {
    console.error('usage: analyze-workstreams.js <projects-dir>   (read-only)');
    process.exit(2);
  }
  const projects = [];
  let slugs = [];
  try { slugs = fs.readdirSync(root); } catch (e) { console.error('cannot read ' + root + ': ' + e.message); process.exit(3); }
  for (const slug of slugs) {
    const dir = path.join(root, slug);
    let st; try { st = fs.statSync(dir); } catch (_e) { continue; }
    if (!st.isDirectory()) continue;
    let hubText = null;
    let mapText = null;
    let files = []; try { files = fs.readdirSync(dir); } catch (_e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const p = path.join(dir, f);
      let s2; try { s2 = fs.statSync(p); } catch (_e) { continue; }
      if (!s2.isFile()) continue;
      const text = fs.readFileSync(p, 'utf8');
      const t = fmType(text);
      if (t === 'project' && hubText === null) hubText = text;
      else if (t === 'map' && mapText === null) mapText = text;
    }
    if (hubText === null && mapText === null) continue;
    projects.push({
      slug,
      hubWs: extractWorkstreams(hubText || ''),
      mapWs: extractWorkstreams(mapText || ''),
    });
  }
  console.log(JSON.stringify(analyzeVault(projects), null, 2));
  process.exit(0);
}
