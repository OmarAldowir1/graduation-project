import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIndex, listProjects, projectPageIds, tasksForProject, projectProgress, isOverdue, sortTasksForFocus, PROJECT_TEMPLATES } from '../src/lib/projects.js';

const pages = [
  { id: 'p1', page_type: 'project', parent_id: null, title: 'Launch', updated_at: '2026-11-01' },
  { id: 'p2', page_type: 'project', parent_id: null, title: 'Thesis', updated_at: '2026-11-05' },
  { id: 'a', page_type: 'note', parent_id: 'p1' },
  { id: 'b', page_type: 'note', parent_id: 'a' },
  { id: 'c', page_type: 'note', parent_id: null },
  { id: 'x', page_type: 'project', parent_id: null, archived_at: '2026-10-01' }
];

test('lists live projects, most recently edited first', () => {
  assert.deepEqual(listProjects(pages).map((page) => page.id), ['p2', 'p1']);
});

test('maps nested pages to their project', () => {
  const index = buildProjectIndex(pages);
  assert.equal(index.get('b'), 'p1');
  assert.equal(index.get('p1'), 'p1');
  assert.equal(index.get('c'), null);
  assert.deepEqual([...projectPageIds(pages, 'p1')].sort(), ['a', 'b', 'p1']);
});

test('survives parent cycles', () => {
  const index = buildProjectIndex([{ id: 'm', parent_id: 'n' }, { id: 'n', parent_id: 'm' }]);
  assert.equal(index.get('m'), null);
});

test('scopes tasks and computes progress', () => {
  const tasks = [
    { id: 1, page_id: 'b', status: 'done' },
    { id: 2, page_id: 'p1', status: 'todo' },
    { id: 3, page_id: 'c', status: 'todo' },
    { id: 4, page_id: null, status: 'todo' }
  ];
  const scoped = tasksForProject(tasks, pages, 'p1');
  assert.deepEqual(scoped.map((task) => task.id), [1, 2]);
  assert.deepEqual(projectProgress(scoped), { done: 1, total: 2, open: 1, percent: 50 });
  assert.deepEqual(projectProgress([]), { done: 0, total: 0, open: 0, percent: 0 });
});

test('orders focus tasks by due date then priority', () => {
  const sorted = sortTasksForFocus([
    { title: 'later', due_date: '2026-12-01', priority: 'urgent' },
    { title: 'none', priority: 'urgent' },
    { title: 'soon-low', due_date: '2026-11-10', priority: 'low' },
    { title: 'soon-high', due_date: '2026-11-10', priority: 'high' }
  ]);
  assert.deepEqual(sorted.map((task) => task.title), ['soon-high', 'soon-low', 'later', 'none']);
  assert.equal(isOverdue({ due_date: '2026-11-01', status: 'todo' }, new Date('2026-11-08')), true);
  assert.equal(isOverdue({ due_date: '2026-11-01', status: 'done' }, new Date('2026-11-08')), false);
});

test('templates have a plan and valid starter tasks', () => {
  for (const template of Object.values(PROJECT_TEMPLATES)) {
    assert.ok(template.html.length > 20);
    for (const task of template.tasks) assert.ok(['low', 'medium', 'high', 'urgent'].includes(task.priority));
  }
});
