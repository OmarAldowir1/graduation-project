import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSince, buildCatchUp, describeWindow, FIRST_VISIT_DAYS, MAX_DAYS } from '../src/lib/catchUp.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const DAY = 86400000;
const since = '2026-11-12T12:00:00.000Z';
const before = '2026-11-11T12:00:00Z';
const recent = '2026-11-13T09:00:00Z';
const names = { me: 'Me', u2: 'Omar', u3: 'Lina' };
const nameOf = (id) => names[id] || 'A teammate';

test('resolves the catch-up window', () => {
  assert.deepEqual(resolveSince(null, NOW), { since: new Date(NOW - FIRST_VISIT_DAYS * DAY).toISOString(), firstVisit: true });
  assert.deepEqual(resolveSince('2026-11-13T12:00:00Z', NOW), { since: '2026-11-13T12:00:00.000Z', firstVisit: false });
  assert.equal(resolveSince('2026-01-01T00:00:00Z', NOW).since, new Date(NOW - MAX_DAYS * DAY).toISOString());
  assert.equal(resolveSince('2027-01-01T00:00:00Z', NOW).since, new Date(NOW).toISOString());
  assert.equal(resolveSince('not a date', NOW).firstVisit, true);
});

test('describes the window in plain words', () => {
  assert.equal(describeWindow({ since: '2026-11-14T11:50:00Z', firstVisit: false }, NOW), 'Since you last checked, a few minutes ago');
  assert.equal(describeWindow({ since: '2026-11-14T07:00:00Z', firstVisit: false }, NOW), 'Since you last checked, 5 hours ago');
  assert.equal(describeWindow({ since: '2026-11-13T12:00:00Z', firstVisit: false }, NOW), 'Since you last checked, 1 day ago');
  assert.equal(describeWindow({ since: new Date(NOW - MAX_DAYS * DAY).toISOString(), firstVisit: false }, NOW), `In the last ${MAX_DAYS} days`);
  assert.equal(describeWindow({ since, firstVisit: true }, NOW), `In the last ${FIRST_VISIT_DAYS} days`);
});

test('is empty when nothing changed', () => {
  const result = buildCatchUp({ since, me: 'me', workspaceId: 'w1' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.sections, []);
});

test('builds sections from notifications, tasks, pages, meetings and chat', () => {
  const result = buildCatchUp({
    since, me: 'me', workspaceId: 'w1', nameOf, messageCount: 4,
    notifications: [
      { id: 'n1', type: 'task_assigned', created_at: recent, workspace_id: 'w1', actor_id: 'u2', payload: { actor_name: 'Omar', title: 'Write intro', task_id: 't1' } },
      { id: 'n2', type: 'mention', created_at: recent, workspace_id: 'w1', actor_id: 'u3', page_id: 'p1', payload: { actor_name: 'Lina', page_title: 'Plan' } },
      { id: 'n3', type: 'comment_reply', created_at: recent, workspace_id: 'w1', actor_id: 'u2', page_id: 'p1', payload: { actor_name: 'Omar', page_title: 'Plan' } },
      { id: 'n4', type: 'mention', created_at: before, workspace_id: 'w1', actor_id: 'u3', payload: {} },
      { id: 'n5', type: 'mention', created_at: recent, workspace_id: 'other', actor_id: 'u3', payload: {} },
      { id: 'n6', type: 'page_updated', created_at: recent, workspace_id: 'w1', actor_id: 'u3', page_id: 'p2', payload: {} },
      { id: 'n7', type: 'comment_added', created_at: recent, workspace_id: 'w1', actor_id: 'me', payload: {} }
    ],
    tasks: [
      { id: 't1', title: 'Write intro', assignee_id: 'me', created_by: 'u2', created_at: recent, status: 'todo' },
      { id: 't2', title: 'Fix slides', assignee_id: 'me', created_by: 'u3', created_at: recent, status: 'todo' },
      { id: 't3', title: 'Collect data', assignee_id: 'u2', created_by: 'u2', created_at: recent, status: 'todo' },
      { id: 't4', title: 'Draft survey', assignee_id: 'u2', created_at: before, status: 'done', completed_at: recent, completed_by: 'u2' },
      { id: 't5', title: 'My own work', assignee_id: 'me', created_at: before, status: 'done', completed_at: recent, completed_by: 'me' },
      { id: 't6', title: 'Mine, created by me', assignee_id: 'u2', created_by: 'me', created_at: recent, status: 'todo' },
      { id: 't7', title: 'Old task', assignee_id: 'u3', created_by: 'u3', created_at: before, status: 'todo' }
    ],
    pages: [{ id: 'p1', title: 'Plan', icon: '🗺️' }, { id: 'p2', title: 'Research' }, { id: 'p3', title: 'Archived', archived_at: before }],
    pageEdits: [
      { page_id: 'p1', replaced_by: 'u2', created_at: recent },
      { page_id: 'p1', replaced_by: 'u3', created_at: recent },
      { page_id: 'p3', replaced_by: 'u2', created_at: recent },
      { page_id: 'p2', replaced_by: 'me', created_at: recent }
    ],
    meetings: [
      { id: 'm1', title: 'Weekly sync', status: 'live' },
      { id: 'm2', title: 'Kick-off', status: 'ended', ended_at: recent, decisions: ['A', 'B'], summary: 'Done' },
      { id: 'm3', title: 'Old', status: 'ended', ended_at: before, decisions: ['C'] }
    ]
  });
  const byId = Object.fromEntries(result.sections.map((section) => [section.id, section]));
  assert.deepEqual(result.sections.map((section) => section.id), ['live', 'assigned', 'mentions', 'comments', 'meetings', 'completed', 'added', 'pages', 'chat']);

  assert.equal(byId.live.items[0].href, '#meeting/m1');
  assert.equal(byId.assigned.count, 2);
  assert.equal(byId.assigned.label, '2 new tasks assigned to you');
  assert.match(byId.assigned.items[1].text, /Lina assigned you “Fix slides”/);
  assert.equal(byId.mentions.label, 'You were mentioned once');
  assert.equal(byId.comments.label, '1 new comment or reply');
  assert.equal(byId.meetings.label, '1 meeting ended with 2 decisions');
  assert.equal(byId.completed.count, 1);
  assert.match(byId.completed.items[0].text, /Omar finished “Draft survey”/);
  assert.deepEqual(byId.added.items.map((item) => item.text), ['Omar added “Collect data”']);
  assert.deepEqual(byId.pages.items.map((item) => item.href), ['#editor/p1', '#editor/p2']);
  assert.match(byId.pages.items[0].text, /🗺️ Plan · Omar/);
  assert.equal(byId.chat.label, '4 new messages in Team chat');
  assert.equal(result.total, 1 + 2 + 1 + 1 + 1 + 1 + 1 + 2 + 4);
});

test('works on databases without the newer task columns', () => {
  const result = buildCatchUp({
    since, me: 'me', workspaceId: 'w1',
    tasks: [
      { id: 't1', title: 'No creator info', assignee_id: 'u2', created_at: recent, status: 'todo' },
      { id: 't2', title: 'Done, no timestamp', assignee_id: 'u2', created_at: before, status: 'done' }
    ]
  });
  assert.equal(result.total, 0);
});

test('caps each section at three items and shortens long titles', () => {
  const tasks = Array.from({ length: 5 }, (_, index) => ({ id: `t${index}`, title: `${'Long title '.repeat(10)}${index}`, assignee_id: 'u2', created_by: 'u2', created_at: recent, status: 'todo' }));
  const result = buildCatchUp({ since, me: 'me', workspaceId: 'w1', tasks, nameOf });
  assert.equal(result.sections[0].count, 5);
  assert.equal(result.sections[0].items.length, 3);
  assert.ok(result.sections[0].items[0].text.includes('…'));
});
