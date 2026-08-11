#!/usr/bin/env node
// Slice-plan skill surface harness (SP-*): the canonical body now ships in the
// loop plugin (skills/plan); the legacy .agents name is a deprecation alias and
// platform-claude no longer registers slice-plan (retired to the plugin).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let count = 0;
function ok(cond, label) {
  count += 1;
  if (!cond) { console.error(`FAIL SP-${count}: ${label}`); process.exit(1); }
  console.log(`ok SP-${count}: ${label}`);
}
const canonical = path.join(ROOT, 'plugins/loop/skills/plan/SKILL.md');
const alias = path.join(ROOT, '.agents/skills/slice-plan/SKILL.md');
const router = path.join(ROOT, '.agents/skills/loop-plan/SKILL.md');
const metadata = path.join(ROOT, '.agents/skills/slice-plan/agents/openai.yaml');
for (const file of [canonical, alias, router, metadata]) ok(fs.existsSync(file), `${path.relative(ROOT, file)} exists`);
const body = fs.readFileSync(canonical, 'utf8');
ok(/^---\nname: plan\ndescription: .+\n---/s.test(body), 'canonical plugin body has valid frontmatter');
ok(body.includes('depends_on'), 'canonical body encodes order as depends_on');
ok(/NO placeholders/i.test(body), 'canonical body forbids placeholder slices');
ok(/id prefix/i.test(body) && /priority position/i.test(body), 'canonical body prompts for id prefix and board priority position');
ok(/dry-run/.test(body) && /--apply/.test(body) && /no_op/.test(body), 'canonical body applies through the intake rail with replay proof');
ok(/loop:execute/.test(body), 'canonical body offers in-session execution handoff');
const aliasBody = fs.readFileSync(alias, 'utf8');
ok(/^---\nname: slice-plan\ndescription: .+\n---/s.test(aliasBody), 'deprecated alias keeps its $slice-plan frontmatter name');
ok(/deprecated/i.test(aliasBody) && /loop-plan/.test(aliasBody), 'alias points at the loop-plan router');
ok(fs.readFileSync(metadata, 'utf8').includes('default_prompt: "Use $slice-plan'), 'openai.yaml names $slice-plan');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/mechanisms/platform-claude/manifest.json'), 'utf8'));
ok(!manifest.claude_surface.some((e) => /slice-plan/.test(JSON.stringify(e))), 'platform-claude no longer registers slice-plan (retired to the loop plugin)');
ok(!fs.existsSync(path.join(ROOT, 'platform/mechanisms/platform-claude/skills/slice-plan')), 'mirror skill body removed');
console.log(`\nrun-slice-plan: ${count}/${count} passed`);
