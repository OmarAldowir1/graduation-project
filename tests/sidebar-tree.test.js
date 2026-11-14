import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageDescendant, getDraggedPageId, buildTreeHierarchy } from '../src/lib/sidebarTreeHelpers.js';
import { buildProjectIndex, listProjects } from '../src/lib/projects.js';

test('isPageDescendant detects descendants accurately', () => {
  const pages = [
    { id: 'root1', parent_id: null },
    { id: 'child1', parent_id: 'root1' },
    { id: 'grandchild1', parent_id: 'child1' },
    { id: 'root2', parent_id: null }
  ];

  // grandchild1 is a descendant of child1 and root1
  assert.equal(isPageDescendant('grandchild1', 'child1', pages), true);
  assert.equal(isPageDescendant('grandchild1', 'root1', pages), true);

  // root1 is NOT a descendant of child1
  assert.equal(isPageDescendant('root1', 'child1', pages), false);

  // root2 is NOT a descendant of root1
  assert.equal(isPageDescendant('root2', 'root1', pages), false);

  // Self is not considered descendant by while condition (current.parent_id === ancestorId)
  assert.equal(isPageDescendant('child1', 'child1', pages), false);
});

test('isPageDescendant safely survives circular references', () => {
  const pages = [
    { id: 'cycle1', parent_id: 'cycle2' },
    { id: 'cycle2', parent_id: 'cycle1' }
  ];
  assert.equal(isPageDescendant('cycle1', 'cycle3', pages), false);
});

test('getDraggedPageId extracts pure UUID from various data transfer inputs', () => {
  // Plain UUID
  const event1 = {
    dataTransfer: {
      getData: (type) => (type === 'text/plain' ? '93a92147-3801-4475-b9f1-39fe8fb695d7' : '')
    }
  };
  assert.equal(getDraggedPageId(event1), '93a92147-3801-4475-b9f1-39fe8fb695d7');

  // Custom application/x-page-id
  const event2 = {
    dataTransfer: {
      getData: (type) => (type === 'application/x-page-id' ? 'custom-id-123' : '')
    }
  };
  assert.equal(getDraggedPageId(event2), 'custom-id-123');

  // Full URL from drag
  const event3 = {
    dataTransfer: {
      getData: (type) => (type === 'text/plain' ? 'http://localhost:5173/#editor/my-page-uuid?draft=1' : '')
    }
  };
  assert.equal(getDraggedPageId(event3), 'my-page-uuid');
});

test('buildTreeHierarchy creates nested children array structure', () => {
  const pages = [
    { id: 'p1', parent_id: null, title: 'Parent 1' },
    { id: 'p2', parent_id: 'p1', title: 'Child 1' },
    { id: 'p3', parent_id: null, title: 'Parent 2' }
  ];
  const roots = buildTreeHierarchy(pages);
  assert.equal(roots.length, 2);
  const p1 = roots.find((r) => r.id === 'p1');
  assert.ok(p1);
  assert.equal(p1.children.length, 1);
  assert.equal(p1.children[0].id, 'p2');
});

test('projects and pages partitioning for sidebar works correctly', () => {
  const pages = [
    { id: 'proj1', page_type: 'project', parent_id: null, title: 'Project 1' },
    { id: 'p_in_proj', page_type: 'note', parent_id: 'proj1', title: 'Plan' },
    { id: 'sub_in_proj', page_type: 'note', parent_id: 'p_in_proj', title: 'Sub Plan' },
    { id: 'standalone1', page_type: 'note', parent_id: null, title: 'Note 1' },
    { id: 'sub_note', page_type: 'note', parent_id: 'standalone1', title: 'Sub Note' }
  ];

  const projectIndex = buildProjectIndex(pages);
  const projects = listProjects(pages);
  const otherPages = pages.filter((page) => !projectIndex.get(page.id));

  // Projects list
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'proj1');

  // Other pages should only contain standalone1 and sub_note
  assert.deepEqual(otherPages.map((p) => p.id).sort(), ['standalone1', 'sub_note'].sort());

  // Pages belonging to proj1
  const proj1Pages = pages.filter((p) => projectIndex.get(p.id) === 'proj1' && p.id !== 'proj1');
  assert.deepEqual(proj1Pages.map((p) => p.id).sort(), ['p_in_proj', 'sub_in_proj'].sort());
});
