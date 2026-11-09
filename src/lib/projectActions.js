import { AppState, showToast } from '../legacy/app.js';
import { createPage, createTask, updatePage } from './queries.js';
import { requestForm } from './dialogs.js';
import { PROJECT_TEMPLATES, PROJECT_TYPE } from './projects.js';
import { loadTeamTemplates } from './pageTools.js';

export const PROJECTS_MIGRATION_HINT = 'Projects need a one-time database update: run sql/projects.sql in the Supabase SQL Editor.';

export function isProjectTypeRejected(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`;
  return error?.code === '23514' || /page_type/i.test(text);
}

// Ask for a name and template, create the project page and its starter tasks,
// then open the project. Resolves to the project page or null.
export async function startNewProject({ template = 'team' } = {}) {
  const workspaceId = AppState.workspace?.id;
  if (!workspaceId) {
    showToast('Create or select a team first', 'error');
    return null;
  }
  const teamTemplates = await loadTeamTemplates('project');
  const values = await requestForm({
    title: 'New project',
    description: 'A project keeps its plan, pages, tasks and discussion together.',
    submitLabel: 'Create project',
    fields: [
      { name: 'title', label: 'Project name', required: true, placeholder: 'e.g. Graduation project, Website launch', maxLength: 120 },
      {
        name: 'template',
        label: 'Start from',
        type: 'select',
        value: template,
        options: [
          ...Object.entries(PROJECT_TEMPLATES).map(([value, item]) => ({ value, label: `${item.icon}  ${item.label} — ${item.description}` })),
          ...teamTemplates.map((item) => ({ value: `team:${item.id}`, label: `★  ${item.title} — team template (${item.tasks?.length || 0} tasks)` }))
        ]
      }
    ]
  });
  if (!values?.title) return null;
  const team = teamTemplates.find((item) => `team:${item.id}` === values.template);
  const chosen = team
    ? { icon: team.icon || '📁', html: team.html || '', tasks: Array.isArray(team.tasks) ? team.tasks : [] }
    : PROJECT_TEMPLATES[values.template] || PROJECT_TEMPLATES.blank;

  const { data: project, error } = await createPage(workspaceId, values.title, PROJECT_TYPE, { html: chosen.html }, null);
  if (error) {
    showToast(isProjectTypeRejected(error) ? PROJECTS_MIGRATION_HINT : `Could not create project: ${error.message}`, 'error');
    return null;
  }
  await updatePage(project.id, { icon: chosen.icon });

  let failed = 0;
  for (const [index, task] of chosen.tasks.entries()) {
    const { error: taskError } = await createTask(task.title, {
      workspaceId,
      pageId: project.id,
      priority: task.priority,
      assigneeId: null,
      sortOrder: Date.now() + index
    });
    if (taskError) failed += 1;
  }
  showToast(failed ? `Project created, but ${failed} starter task(s) could not be added` : `Project “${values.title}” created`, failed ? 'error' : 'success');
  window.dispatchEvent(new CustomEvent('motion:pages-changed'));
  window.location.hash = `project/${project.id}`;
  return project;
}

// New page inside a project (or any parent page).
export async function startNewPageIn(parentId, { open = true } = {}) {
  const values = await requestForm({
    title: 'New page',
    submitLabel: 'Create page',
    fields: [{ name: 'title', label: 'Page title', required: true, placeholder: 'e.g. Meeting notes, Research, Draft', maxLength: 200 }]
  });
  if (!values?.title) return null;
  const { data: page, error } = await createPage(AppState.workspace?.id, values.title, 'note', {}, parentId);
  if (error) {
    showToast(`Could not create page: ${error.message}`, 'error');
    return null;
  }
  window.dispatchEvent(new CustomEvent('motion:pages-changed'));
  if (open) window.location.hash = `editor/${page.id}`;
  return page;
}
