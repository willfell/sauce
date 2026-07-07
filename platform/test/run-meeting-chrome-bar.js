#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
function loadClass(rel, name) { return new Function(`${fs.readFileSync(path.join(ROOT, rel), 'utf8')}\nreturn ${name};`)(); }
const MeetingChromeBar = loadClass('platform/blueprints/meetings/helpers/meeting-chrome-bar.js', 'MeetingChromeBar');
const results = [];
const ok = (n, c) => { results.push([n, !!c]); console.log(`  ${c ? 'PASS' : 'FAIL'} — ${n}`); };
const inst = new MeetingChromeBar();
const cfg = inst._config();

// MCB-DETECT — classify meeting surfaces; null off-surface.
{
  const meeting = cfg.detect({}, { file: { path: 'spice/meetings/notes/2026/07-July/Standup-2026-07-06.md' }, type: 'meeting' });
  const off = cfg.detect({}, { file: { path: 'spice/to-do/x.md' }, type: 'to-do' });
  ok('MCB-DETECT-1 meeting classifies; non-meeting → null',
    meeting && meeting.context === 'meeting' && off === null);
}

// MCB-SPEC — primary New Task + 2 overflow + leaf.
{
  const s = cfg.surfaceSpec({ context: 'meeting' });
  ok('MCB-SPEC-1 primary new-task + overflow add-project,edit-attendees + leaf',
    s.primary && s.primary.id === 'new-task'
    && s.overflow.length === 2
    && s.overflow[0].id === 'add-project'
    && s.overflow[1].id === 'edit-attendees'
    && s.leaf === true);
}

// MCB-DISPATCH — routes to MeetingLeafActions methods.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    MeetingLeafActions: {
      _onNewTask: (dv) => calls.push('new-task'),
      _onAddToProject: (dv) => calls.push('add-project'),
      _onEditAttendees: (dv) => calls.push('edit-attendees'),
    },
  };
  global.Notice = function() {};
  cfg.dispatch({}, { context: 'meeting' }, 'new-task');
  cfg.dispatch({}, { context: 'meeting' }, 'add-project');
  cfg.dispatch({}, { context: 'meeting' }, 'edit-attendees');
  global.customJS = prevCJS;
  delete global.Notice;
  ok('MCB-DISPATCH-1 new-task → _onNewTask', calls[0] === 'new-task');
  ok('MCB-DISPATCH-2 add-project → _onAddToProject', calls[1] === 'add-project');
  ok('MCB-DISPATCH-3 edit-attendees → _onEditAttendees', calls[2] === 'edit-attendees');
}

// MCB-DEST — destinations include section marker.
{
  const dests = cfg.destinations({}, { context: 'meeting', path: 'spice/meetings/notes/x.md' });
  ok('MCB-DEST-1 includes This meeting section marker',
    dests[0] && dests[0].section === 'This meeting');
}

// MCB-CLASS — rootClass + btnClass correct.
{
  ok('MCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'meeting-chrome-root' && cfg.btnClass('primary') === 'meeting-chrome-btn meeting-chrome-btn-primary');
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
