import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineHealth, pollResults, isSafeUrl, canManageItem, canAdd } from '../src/lib/teamToolsLogic.js';

const ms = (title, due, done = false) => ({ title, due_date: due, done_at: done ? '2026-11-10T00:00:00Z' : null });

test('deadline health: none, done, on track, at risk, behind', () => {
  assert.equal(deadlineHealth({ milestones: [] }).status, 'none');
  assert.equal(deadlineHealth({ milestones: [ms('A', '2026-12-01', true)] }).status, 'done');
  // Halfway through the time (Nov 1 → Dec 1, today Nov 16) with 50% done → on track.
  const half = { milestones: [ms('Final', '2026-12-01')], projectStart: '2026-11-01', today: '2026-11-16' };
  assert.equal(deadlineHealth({ ...half, progress: 50 }).status, 'on_track');
  assert.equal(deadlineHealth({ ...half, progress: 35 }).status, 'at_risk');
  assert.equal(deadlineHealth({ ...half, progress: 10 }).status, 'behind');
  // An open milestone in the past is always "behind".
  const late = deadlineHealth({ milestones: [ms('Proposal', '2026-11-10'), ms('Final', '2026-12-20')], progress: 90, projectStart: '2026-11-01', today: '2026-11-16' });
  assert.equal(late.status, 'behind');
  assert.match(late.detail, /Proposal” was due 6 day/);
});

test('deadline health: next milestone and clamped numbers', () => {
  const h = deadlineHealth({ milestones: [ms('Proposal', '2026-11-10', true), ms('Prototype', '2026-11-20'), ms('Final', '2026-12-20')], progress: 140, projectStart: '2026-11-01', today: '2026-11-16' });
  assert.equal(h.next.title, 'Prototype');
  assert.equal(h.actual, 100);
  assert.match(h.detail, /Next: “Prototype” in 4 day/);
  assert.equal(deadlineHealth({ milestones: [ms('Today', '2026-11-16')], progress: 100, projectStart: '2026-11-01', today: '2026-11-16' }).detail.includes('due today'), true);
});

test('poll results, ties and empty polls', () => {
  const poll = { options: ['A', 'B', 'C'], votes: [{ option_index: 1 }, { option_index: 1 }, { option_index: 0 }] };
  assert.deepEqual(pollResults(poll), { options: ['A', 'B', 'C'], counts: [1, 2, 0], total: 3, winners: [1] });
  assert.deepEqual(pollResults({ options: ['A', 'B'], votes: [{ option_index: 0 }, { option_index: 1 }] }).winners, [0, 1]);
  assert.deepEqual(pollResults({ options: ['A', 'B'], votes: [] }).winners, []);
});

test('links and permissions', () => {
  assert.equal(isSafeUrl('https://example.com/x'), true);
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.equal(isSafeUrl('http://a b'), false);
  assert.equal(canManageItem({ created_by: 'u1' }, { userId: 'u1', role: 'editor' }), true);
  assert.equal(canManageItem({ created_by: 'u1' }, { userId: 'u2', role: 'editor' }), false);
  assert.equal(canManageItem({ created_by: 'u1' }, { userId: 'u2', role: 'admin' }), true);
  assert.equal(canAdd('viewer'), false);
  assert.equal(canAdd('editor'), true);
});

test('catch me up: only what changed since the last visit, and only what others did', async () => {
  const { catchUpItems } = await import('../src/lib/teamToolsLogic.js');
  const since = '2026-11-10T00:00:00Z';
  const groups = catchUpItems({
    me: 'me', since, today: '2026-11-15',
    projectTitle: (id) => (id === 'p1' ? 'Capstone' : ''),
    projectOf: () => 'p1',
    tasks: [
      { id: 't1', title: 'New for me', assignee_id: 'me', created_by: 'sara', created_at: '2026-11-12T10:00:00Z', status: 'todo' },
      { id: 't2', title: 'Old for me', assignee_id: 'me', created_by: 'sara', created_at: '2026-11-01T10:00:00Z', status: 'todo' },
      { id: 't3', title: 'I made it myself', assignee_id: 'me', created_by: 'me', created_at: '2026-11-12T10:00:00Z', status: 'todo' },
      { id: 't4', title: 'Sara finished', assignee_id: 'sara', status: 'done', completed_at: '2026-11-13T10:00:00Z', completed_by: 'sara' },
      { id: 't5', title: 'I finished', assignee_id: 'me', status: 'done', completed_at: '2026-11-13T10:00:00Z', completed_by: 'me' },
      { id: 't6', title: 'Finished long ago', assignee_id: 'sara', status: 'done', completed_at: '2026-11-02T10:00:00Z' }
    ],
    updates: {
      blockers: [{ user_id: 'omar', user: { name: 'Omar' }, blockers: 'Waiting for the API key', project_id: 'p1' }, { user_id: 'me', blockers: 'mine', project_id: 'p1' }],
      polls: [{ id: 'a', question: 'Map provider?', project_id: 'p1', votes: [] }, { id: 'b', question: 'Voted already', project_id: 'p1', votes: [{ user_id: 'me' }] }],
      milestones: [{ title: 'Prototype', due_date: '2026-11-14', project_id: 'p1' }, { title: 'Final', due_date: '2027-01-20', project_id: 'p1' }],
      decisions: [{ title: 'Use OpenStreetMap', created_by: 'sara', project_id: 'p1' }, { title: 'Mine', created_by: 'me', project_id: 'p1' }]
    }
  });
  const byKind = Object.fromEntries(groups.map((group) => [group.kind, group]));
  assert.deepEqual(groups.map((group) => group.kind), ['assigned', 'blockers', 'polls', 'milestones', 'decisions', 'finished']);
  assert.deepEqual(byKind.assigned.items.map((item) => item.text), ['New for me']);
  assert.equal(byKind.blockers.items.length, 1);
  assert.match(byKind.blockers.items[0].text, /^Omar: Waiting for the API key · Capstone$/);
  assert.deepEqual(byKind.polls.items.map((item) => item.href), ['#project/p1/decisions']);
  assert.deepEqual(byKind.milestones.items.map((item) => item.text), ['LATE · Prototype · 2026-11-14 · Capstone']);
  assert.equal(byKind.milestones.tone, 'bad');
  assert.deepEqual(byKind.decisions.items.map((item) => item.text), ['Use OpenStreetMap · Capstone']);
  assert.deepEqual(byKind.finished.items.map((item) => item.text), ['Sara finished · Capstone']);
  assert.deepEqual(catchUpItems({ me: 'me', since, tasks: [], updates: {} }), []);
});
