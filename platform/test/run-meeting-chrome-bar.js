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

// MCB-DETECT-HUB — tag-based hub (no `type:` field) also classifies.
{
  const hubViaPageTags = cfg.detect({}, { file: { path: 'spice/meetings/hubs/2026/07-July/Meetings-2026-07-08.md' }, tags: ['meetings-hub', 'personal', '2026/07/08'] });
  const hubViaFileTags = cfg.detect({}, { file: { path: 'spice/meetings/hubs/2026/07-July/Meetings-2026-07-08.md', tags: ['#meetings-hub'] } });
  const typedNoteWins = cfg.detect({}, { file: { path: 'x.md' }, type: 'meeting', tags: ['meetings-hub'] });
  const noHubTag = cfg.detect({}, { file: { path: 'spice/wiki/x.md' }, tags: ['wiki-hub'] });
  ok('MCB-DETECT-HUB-1 page.tags meetings-hub → meetings-hub context',
    hubViaPageTags && hubViaPageTags.context === 'meetings-hub');
  ok('MCB-DETECT-HUB-2 page.file.tags fallback (# stripped) also matches',
    hubViaFileTags && hubViaFileTags.context === 'meetings-hub');
  ok('MCB-DETECT-HUB-3 an explicit type: meeting always wins over a stray hub tag',
    typedNoteWins && typedNoteWins.context === 'meeting');
  ok('MCB-DETECT-HUB-4 no type + no meetings-hub tag → null', noHubTag === null);
}

// MCB-SPEC — primary New Task + 2 overflow + leaf on the meeting leaf surface.
{
  const s = cfg.surfaceSpec({ context: 'meeting' });
  ok('MCB-SPEC-1 primary new-task + overflow add-project,edit-attendees + leaf',
    s.primary && s.primary.id === 'new-task'
    && s.overflow.length === 2
    && s.overflow[0].id === 'add-project'
    && s.overflow[1].id === 'edit-attendees'
    && s.leaf === true);
}

// MCB-SPEC-HUB — no primary/overflow on the hub; EntityCreate owns creation.
{
  const s = cfg.surfaceSpec({ context: 'meetings-hub' });
  ok('MCB-SPEC-HUB-1 no primary, no overflow, leaf:false on the hub',
    s.primary === null && Array.isArray(s.overflow) && s.overflow.length === 0 && s.leaf === false);
}

// MCB-DISPATCH — routes MeetingLeafActions methods.
{
  const calls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    MeetingLeafActions: {
      _onNewTask: () => calls.push('new-task'),
      _onAddToProject: () => calls.push('add-project'),
      _onEditAttendees: () => calls.push('edit-attendees'),
    },
  };
  cfg.dispatch({}, { context: 'meeting' }, 'new-task');
  cfg.dispatch({}, { context: 'meeting' }, 'add-project');
  cfg.dispatch({}, { context: 'meeting' }, 'edit-attendees');
  global.customJS = prevCJS;

  ok('MCB-DISPATCH-1 new-task → MeetingLeafActions._onNewTask', calls[0] === 'new-task');
  ok('MCB-DISPATCH-2 add-project → MeetingLeafActions._onAddToProject', calls[1] === 'add-project');
  ok('MCB-DISPATCH-3 edit-attendees → MeetingLeafActions._onEditAttendees', calls[2] === 'edit-attendees');
}

// MCB-DEST — "This meeting" section on the leaf; nothing on the hub.
{
  const dests = cfg.destinations({}, { context: 'meeting', path: 'spice/meetings/notes/x.md' });
  ok('MCB-DEST-1 leaf destinations = [{section:"This meeting"}]',
    dests.length === 1 && dests[0].section === 'This meeting');
  const hubDests = cfg.destinations({}, { context: 'meetings-hub', path: 'spice/meetings/hubs/x.md' });
  ok('MCB-DEST-HUB-1 hub destinations = [] (EntityCreate/MeetingsHubCards own the body)',
    Array.isArray(hubDests) && hubDests.length === 0);
}

// MCB-CLASS — shared root/btn class helper.
{
  ok('MCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'meeting-chrome-root' && cfg.btnClass('primary') === 'meeting-chrome-btn meeting-chrome-btn-primary');
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
