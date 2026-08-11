'use strict';

// v0.119.0 PATCH harness — regression for the project-hub TypeError on freshly
// created projects (reported on accuris 2026-06-16, spice/projects/dev-enablement/
// Dev-Enablement.md). After EntityCreate.openFile, Dataview hasn't indexed the
// new file yet so `dv.current()` returns undefined. Five project helpers were
// unguarded; they now early-return when current is missing. This harness
// asserts each helper's render() does NOT throw when dv.current() is null,
// undefined, or returns a file-less object.

const fs = require('fs');
const path = require('path');

let passes = 0; let fails = 0;
async function ok(name, fn) {
    try { await fn(); console.log('ok ' + name); passes++; }
    catch (e) { console.error('FAIL ' + name + ': ' + (e && e.message)); fails++; }
}

function loadWidget(relPath, className) {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
    return new Function(`${src}; return ${className};`)();
}

const widgets = [
    { name: 'ProjectNavButtons',          path: 'platform/blueprints/project/helpers/project-nav-buttons.js' },
    { name: 'ProjectWorkstreamManager',   path: 'platform/blueprints/project/helpers/project-workstream-manager.js' },
    { name: 'ProjectWorkstreams',         path: 'platform/blueprints/project/helpers/project-workstreams.js' },
    { name: 'ProjectNotesCards',          path: 'platform/blueprints/project/helpers/project-notes-cards.js' },
    { name: 'ProjectReferencedByCards',   path: 'platform/blueprints/project/helpers/project-referenced-by-cards.js' },
    { name: 'ProjectActivityPanel',       path: 'platform/blueprints/project/helpers/project-activity-panel.js' },
    { name: 'ProjectOpenTasks',           path: 'platform/blueprints/project/helpers/project-open-tasks.js' },
    { name: 'ProjectLinksPanel',          path: 'platform/blueprints/project/helpers/project-links-panel.js' },
    { name: 'DocLeafActions',             path: 'platform/blueprints/project/helpers/doc-leaf-actions.js' },
    { name: 'DocBulkMoveActions',         path: 'platform/blueprints/project/helpers/doc-bulk-move.js' },
    { name: 'ProjectLinksManager',        path: 'platform/blueprints/project/helpers/project-links-manager.js' },
    { name: 'ProjectStatusWidget',        path: 'platform/blueprints/project/helpers/project-status-widget.js' },
    { name: 'ProjectDocsCards',           path: 'platform/blueprints/project/helpers/project-docs-cards.js' },
    { name: 'ProjectDocsSections',        path: 'platform/blueprints/project/helpers/project-docs-sections.js' },
    { name: 'ProjectDocsIndex',           path: 'platform/blueprints/project/helpers/project-docs-index.js' },
    { name: 'SectionHub',                 path: 'platform/blueprints/project/helpers/section-hub.js' },
    { name: 'ProjectMeetingsPanel',       path: 'platform/blueprints/project/helpers/project-meetings-panel.js' },
    { name: 'ProjectDashboard',           path: 'platform/blueprints/project/helpers/project-dashboard.js' },
    { name: 'ProjectChromeBar',           path: 'platform/blueprints/project/helpers/project-chrome-bar.js' },
];

// dv stub variants the guards must tolerate.
const dvVariants = [
    {
        label: 'dv.current() returns undefined (Dataview not indexed yet)',
        stub: { current: () => undefined, container: { createEl: () => ({}) } },
    },
    {
        label: 'dv.current() returns null',
        stub: { current: () => null, container: { createEl: () => ({}) } },
    },
    {
        label: 'dv.current() returns object without .file',
        stub: { current: () => ({ workstreams: [] }), container: { createEl: () => ({}) } },
    },
    {
        label: 'dv itself missing .current method',
        stub: { container: { createEl: () => ({}) } },
    },
];

// render-safe wiring: after the cold-load conversion the project helpers call
// customJS.RenderSafe.page(dv). Provide the real RenderSafe instance as a global
// so the guard exercises the genuine fallback. With `app` unset in this harness,
// page(dv) returns null on every stub above, so the helpers' `if (!page ||
// !page.file) return;` early-returns cleanly — exactly the no-throw this asserts.
const RenderSafeClass = loadWidget('platform/mechanisms/render-safe/render-safe.js', 'RenderSafe');
global.customJS = Object.assign(global.customJS || {}, { RenderSafe: new RenderSafeClass() });

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { await ok(`PROJGUARD-load ${w.name}`, () => { throw e; }); continue; }

        for (const v of dvVariants) {
            await ok(`PROJGUARD ${w.name} — ${v.label}`, async () => {
                const widget = new WidgetClass();
                // render() MUST return without throwing.
                // Some helpers are async, some are sync — Promise.resolve handles both.
                await Promise.resolve().then(() => widget.render(v.stub));
            });
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
