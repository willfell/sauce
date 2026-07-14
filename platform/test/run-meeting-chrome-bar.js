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

// MCB-SPEC — primary New Task + overflow (add-project, edit-attendees, add-link) + leaf on the meeting leaf surface.
{
  const s = cfg.surfaceSpec({ context: 'meeting' });
  ok('MCB-SPEC-1 primary new-task + overflow add-project,edit-attendees + leaf',
    s.primary && s.primary.id === 'new-task'
    && s.overflow[0].id === 'add-project'
    && s.overflow[1].id === 'edit-attendees'
    && s.leaf === true);
  ok('MCB-SPEC-LINK-1 leaf overflow contains an add-link item (after edit-attendees)',
    Array.isArray(s.overflow) && s.overflow.some((o) => o && o.id === 'add-link'));
}

// MCB-SPEC-HUB-LINK — the hub overflow must NOT contain add-link (leaf-only feature).
{
  const s = cfg.surfaceSpec({ context: 'meetings-hub' });
  ok('MCB-SPEC-HUB-LINK-1 hub overflow does not contain add-link',
    Array.isArray(s.overflow) && !s.overflow.some((o) => o && o.id === 'add-link'));
}

// MCB-SPEC-HUB — "+ New Meeting" primary (right of the compass) on the hub;
// no overflow; MeetingsHubCards still owns the listing below.
{
  const s = cfg.surfaceSpec({ context: 'meetings-hub' });
  ok('MCB-SPEC-HUB-1 primary "+ New Meeting" (id new-meeting), no overflow, leaf:false',
    s.primary && s.primary.id === 'new-meeting' && s.primary.label === '+ New Meeting'
    && Array.isArray(s.overflow) && s.overflow.length === 0 && s.leaf === false);
}

// MCB-DISPATCH — routes MeetingLeafActions methods + the hub's new-meeting → EntityCreate.
{
  const calls = [];
  const entityCreateCalls = [];
  const prevCJS = global.customJS;
  global.customJS = {
    MeetingLeafActions: {
      _onNewTask: () => calls.push('new-task'),
      _onAddToProject: () => calls.push('add-project'),
      _onEditAttendees: () => calls.push('edit-attendees'),
    },
    EntityCreate: { create: (opts) => entityCreateCalls.push(opts) },
  };
  cfg.dispatch({}, { context: 'meeting' }, 'new-task');
  cfg.dispatch({}, { context: 'meeting' }, 'add-project');
  cfg.dispatch({}, { context: 'meeting' }, 'edit-attendees');
  cfg.dispatch({}, { context: 'meetings-hub' }, 'new-meeting');
  global.customJS = prevCJS;

  ok('MCB-DISPATCH-1 new-task → MeetingLeafActions._onNewTask', calls[0] === 'new-task');
  ok('MCB-DISPATCH-2 add-project → MeetingLeafActions._onAddToProject', calls[1] === 'add-project');
  ok('MCB-DISPATCH-3 edit-attendees → MeetingLeafActions._onEditAttendees', calls[2] === 'edit-attendees');
  ok('MCB-DISPATCH-4 new-meeting → EntityCreate.create({instance:"meeting"})',
    entityCreateCalls.length === 1 && entityCreateCalls[0].instance === 'meeting');
}

// MCB-DISPATCH-LINK — add-link → SectionExplorer._openAddLinkForm(dv, _noteSelfAdapter(page), null).
{
  const addLinkCalls = [];
  const adapterCalls = [];
  const prevCJS = global.customJS;
  const meetingPage = { file: { path: 'spice/meetings/notes/2026/07-July/Standup-2026-07-06.md' }, type: 'meeting' };
  global.customJS = {
    RenderSafe: { page: () => meetingPage },
    SectionExplorer: {
      _noteSelfAdapter: (p) => { adapterCalls.push(p); return { __adapterFor: p }; },
      _openAddLinkForm: (dv, adapter, section) => addLinkCalls.push({ dv, adapter, section }),
    },
  };
  cfg.dispatch({}, { context: 'meeting', path: meetingPage.file.path }, 'add-link');
  global.customJS = prevCJS;

  ok('MCB-DISPATCH-LINK-1 add-link → SectionExplorer._openAddLinkForm invoked once',
    addLinkCalls.length === 1);
  ok('MCB-DISPATCH-LINK-2 _openAddLinkForm called with _noteSelfAdapter(page) and null section',
    adapterCalls.length === 1 && adapterCalls[0] === meetingPage
    && addLinkCalls[0] && addLinkCalls[0].adapter && addLinkCalls[0].adapter.__adapterFor === meetingPage
    && addLinkCalls[0].section === null);
}

// MCB-DEST — "This meeting" section on the leaf; nothing extra on the hub
// (its create action now lives on the primary, not in the Go▾ menu).
{
  const dests = cfg.destinations({}, { context: 'meeting', path: 'spice/meetings/notes/x.md' });
  ok('MCB-DEST-1 leaf destinations = [{section:"This meeting"}]',
    dests.length === 1 && dests[0].section === 'This meeting');
  const hubDests = cfg.destinations({}, { context: 'meetings-hub', path: 'spice/meetings/hubs/x.md' });
  ok('MCB-DEST-HUB-1 hub destinations = [] (primary + MeetingsHubCards own the body)',
    Array.isArray(hubDests) && hubDests.length === 0);
}

// MCB-CLASS — shared root/btn class helper.
{
  ok('MCB-CLASS-1 rootClass + btnClass',
    cfg.rootClass === 'meeting-chrome-root' && cfg.btnClass('primary') === 'meeting-chrome-btn meeting-chrome-btn-primary');
}

console.log(`\n${results.filter(([, c]) => c).length}/${results.length} passed`);
process.exit(results.every(([, c]) => c) ? 0 : 1);
