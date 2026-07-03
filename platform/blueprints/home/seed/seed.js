// platform/blueprints/home/seed/seed.js
// Scaffolds the singleton spice/home/Home.md command-center note ONCE.
// Programmatic (β) seed — deterministic (no rng needed; a single fixed note).
//
// writeNote() prepends emitFrontmatter(opts.frontmatter) to opts.body, so the
// body handed to it must NOT carry its own `---` block. We render the template
// (which DOES have a leading `--- type: home … ---`), strip that leading block,
// and pass the frontmatter via opts.frontmatter — yielding exactly one FM block.

// Minimal chrome fallback (mirrors daily's try/catch idiom) — kept in lockstep
// with content/home-template.md's body below the frontmatter.
const FALLBACK_BODY = [
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "SpaceNavButtons" });',
  '```',
  '',
  '---',
  '',
  '```dataviewjs',
  'await dv.view("ranch/views/customjs-guard", { class: "SpaceHome" });',
  '```',
  '',
  '[//]: # (HOME_CHROME_END)',
  '',
].join("\n");

// Strip a leading `---\n…\n---\n` frontmatter block; return the body beneath it.
function stripLeadingFrontmatter(text) {
  const m = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? String(text).slice(m[0].length).replace(/^\n+/, "") : String(text);
}

module.exports = {
  schema_version: 1,
  kind: "programmatic",
  seed(ctx) {
    let notesCreated = 0;
    let body;
    try {
      const rendered = ctx.helpers.renderTemplate("content/home-template.md", {});
      body = stripLeadingFrontmatter(rendered);
      if (!/class:\s*"SpaceHome"/.test(body)) body = FALLBACK_BODY; // guard: render lost the chrome
    } catch {
      body = FALLBACK_BODY;
    }
    const r = ctx.writeNote({
      path: `spice/${ctx.moduleDir}/Home.md`,
      frontmatter: { type: "home", cssclasses: ["wide"] },
      body,
    });
    if (!r.skipped) notesCreated++;
    return { notesCreated };
  },
};
