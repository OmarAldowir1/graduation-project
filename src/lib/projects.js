// Projects: a top-level page with page_type 'project'. Pages nested under it belong
// to the project; tasks linked to any of those pages are the project's tasks.

export const PROJECT_TYPE = 'project';

export function isProject(page) {
  return Boolean(page) && page.page_type === PROJECT_TYPE && !page.archived_at;
}

export function listProjects(pages = []) {
  return pages
    .filter(isProject)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

// pageId -> projectId (or null) for every page, following parent links.
export function buildProjectIndex(pages = []) {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const memo = new Map();
  const resolve = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    const page = byId.get(id);
    if (!page || seen.has(id)) return null;
    seen.add(id);
    const result = page.page_type === PROJECT_TYPE ? page.id : page.parent_id ? resolve(page.parent_id, seen) : null;
    memo.set(id, result);
    return result;
  };
  for (const page of pages) resolve(page.id);
  return memo;
}

export function projectPageIds(pages, projectId) {
  const index = buildProjectIndex(pages);
  return new Set([...index].filter(([, owner]) => owner === projectId).map(([id]) => id));
}

export function tasksForProject(tasks = [], pages = [], projectId) {
  const ids = projectPageIds(pages, projectId);
  return tasks.filter((task) => task.page_id && ids.has(task.page_id));
}

export function projectProgress(tasks = []) {
  const done = tasks.filter((task) => task.status === 'done' || task.completed).length;
  const total = tasks.length;
  return { done, total, open: total - done, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function isOverdue(task, now = new Date()) {
  if (!task?.due_date || task.status === 'done' || task.completed) return false;
  return new Date(`${task.due_date}T23:59:59`) < now;
}

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
export function sortTasksForFocus(tasks = []) {
  return [...tasks].sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')
    || (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4)
    || String(a.title || '').localeCompare(String(b.title || '')));
}

// Starter content so a new project is never a blank screen.
export const PROJECT_TEMPLATES = {
  blank: {
    label: 'Blank project',
    description: 'Just a plan page. Add tasks and pages as you go.',
    icon: '📁',
    html: '<h2>Goal</h2><p>What does “done” look like for this project?</p><h2>Plan</h2><p>Write the plan here. Turn any step into a task from the Tasks tab.</p>',
    tasks: []
  },
  team: {
    label: 'Team project',
    description: 'Goal, milestones, roles and five starter tasks to assign.',
    icon: '🚀',
    html: [
      '<h2>Goal</h2><p>Describe the outcome in one or two sentences.</p>',
      '<h2>Milestones</h2><ul><li>Kick-off and roles agreed</li><li>First draft ready for review</li><li>Final version delivered</li></ul>',
      '<h2>Roles</h2><p>Who owns what? @mention teammates in the discussion to agree on roles.</p>',
      '<h2>Links &amp; resources</h2><p>Add pages to this project for research, meeting notes and drafts.</p>'
    ].join(''),
    tasks: [
      { title: 'Agree on the goal and scope', priority: 'high' },
      { title: 'Split the work and assign owners', priority: 'high' },
      { title: 'Collect research and references', priority: 'medium' },
      { title: 'Prepare the first draft', priority: 'medium' },
      { title: 'Review together and finalize', priority: 'medium' }
    ]
  },
  study: {
    label: 'Study / course project',
    description: 'Deadlines, reading list, and tasks for a course or graduation project.',
    icon: '🎓',
    html: [
      '<h2>Assignment</h2><p>Paste the brief or requirements here.</p>',
      '<h2>Deadlines</h2><ul><li>Proposal: </li><li>Progress review: </li><li>Final submission: </li></ul>',
      '<h2>Reading list</h2><ul><li>Add sources here</li></ul>',
      '<h2>Team agreement</h2><p>How often you meet, where you talk, and who reviews what.</p>'
    ].join(''),
    tasks: [
      { title: 'Read the brief and list the requirements', priority: 'high' },
      { title: 'Write the project proposal', priority: 'high' },
      { title: 'Research and collect sources', priority: 'medium' },
      { title: 'Build / write the main part', priority: 'medium' },
      { title: 'Prepare the presentation', priority: 'medium' },
      { title: 'Final review and submit', priority: 'urgent' }
    ]
  }
};
