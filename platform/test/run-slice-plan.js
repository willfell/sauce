#!/usr/bin/env node
// Slice-plan skill surface harness (SP-*): validates the dual-seat skill file
// set + manifest registration, mirroring run-card-intake.js's conventions.
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
const codexSkill = path.join(ROOT, '.agents/skills/slice-plan/SKILL.md');
const claudeSkill = path.join(ROOT, 'platform/mechanisms/platform-claude/skills/slice-plan/SKILL.md');
const command = path.join(ROOT, 'platform/mechanisms/platform-claude/commands/slice-plan.md');
const metadata = path.join(ROOT, '.agents/skills/slice-plan/agents/openai.yaml');
for (const file of [codexSkill, claudeSkill]) {
  const body = fs.readFileSync(file, 'utf8');
  ok(/^---\nname: slice-plan\ndescription: .+\n---/s.test(body), `${path.relative(ROOT, file)} has valid frontmatter`);
  ok(body.includes('PLAN mode') && body.includes('IMPLEMENT mode'), `${path.relative(ROOT, file)} documents both modes`);
  ok(body.includes('depends_on'), `${path.relative(ROOT, file)} encodes order as depends_on`);
  ok(/never bypass|hand off and stop/i.test(body), `${path.relative(ROOT, file)} defers release-path work to the coordinator`);
}
ok(fs.readFileSync(codexSkill, 'utf8') === fs.readFileSync(claudeSkill, 'utf8'), 'codex and claude skill bodies are identical (one source of truth)');
const cmd = fs.readFileSync(command, 'utf8');
ok(/@claude-surface:version \d+\.\d+\.\d+/.test(cmd), 'command carries a claude-surface version marker');
ok(cmd.includes('.claude/skills/platform/slice-plan/SKILL.md'), 'command routes to the installed skill body');
ok(fs.readFileSync(metadata, 'utf8').includes('default_prompt: "Use $slice-plan'), 'openai.yaml names $slice-plan');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform/mechanisms/platform-claude/manifest.json'), 'utf8'));
ok(manifest.claude_surface.some((e) => e.kind === 'command' && e.dest === '.claude/commands/slice-plan.md'), 'manifest registers command');
ok(manifest.claude_surface.some((e) => e.kind === 'skill' && e.dest === '{{skills_dir}}/slice-plan/SKILL.md'), 'manifest registers skill');
ok(manifest.claude_surface.some((e) => e.kind === 'claude_md_row' && e.table === 'resolvers' && e.row && e.row.command === '/slice-plan'), 'manifest registers resolver row');
ok(manifest.claude_surface.some((e) => e.kind === 'claude_md_row' && e.table === 'skills-index' && e.row && e.row.command === '/slice-plan'), 'manifest registers skills-index row');
console.log(`\nrun-slice-plan: ${count}/${count} passed`);
