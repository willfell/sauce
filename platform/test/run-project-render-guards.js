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
function ok(name, fn) {
    try { fn(); console.log('ok ' + name); passes++; }
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

(async () => {
    for (const w of widgets) {
        let WidgetClass;
        try { WidgetClass = loadWidget(w.path, w.name); }
        catch (e) { ok(`PROJGUARD-load ${w.name}`, () => { throw e; }); continue; }

        for (const v of dvVariants) {
            await new Promise((resolve) => {
                ok(`PROJGUARD ${w.name} — ${v.label}`, async () => {
                    const widget = new WidgetClass();
                    // render() MUST return without throwing.
                    // Some helpers are async, some are sync — Promise.resolve handles both.
                    await Promise.resolve().then(() => widget.render(v.stub));
                });
                resolve();
            });
        }
    }
    console.log(`\n${passes} passed, ${fails} failed`);
    process.exit(fails === 0 ? 0 : 1);
})();
