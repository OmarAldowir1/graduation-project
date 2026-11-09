// ============================================
// MOTION — Project view (Overview · Plan & discussion · Tasks · Pages)
// ============================================
import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getPages, getTasks, getWorkspaceMembers, createTask, toggleTask, timeAgo } from '../../lib/queries.js';
import { supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { isProject, projectPageIds, tasksForProject, projectProgress, isOverdue, sortTasksForFocus } from '../../lib/projects.js';
import { startNewPageIn } from '../../lib/projectActions.js';
import { requestNewTask, openTaskDetails } from '../../lib/taskDetails.js';
import { renderKanban } from './kanban.js';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'space_dashboard' },
  { id: 'plan', label: 'Plan & discussion', icon: 'forum' },
  { id: 'tasks', label: 'Tasks', icon: 'view_kanban' },
  { id: 'pages', label: 'Pages', icon: 'description' }
];

function tabHref(projectId, tab) {
  if (tab === 'plan') return `#editor/${projectId}`;
  return tab === 'overview' ? `#project/${projectId}` : `#project/${projectId}/${tab}`;
}

function avatar(member, size = 28) {
  const user = member?.user || {};
  const name = user.name || user.email || 'Member';
  const url = /^https?:\/\//i.test(user.avatar_url || '') ? user.avatar_url : '';
  return url
    ? `<img class="project-avatar" style="width:${size}px;height:${size}px" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" title="${escapeHtml(name)}" />`
    : `<span class="project-avatar" style="width:${size}px;height:${size}px" title="${escapeHtml(name)}">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`;
}

// Shared header used by the project view and by pages inside a project.
export function renderProjectBar({ project, activeTab, progress = null, members = [] }) {
  return `
    <div class="project-bar">
      <div class="project-bar-top">
        <a class="project-bar-title" href="#project/${escapeHtml(project.id)}">
          <span class="project-bar-icon">${escapeHtml(project.icon || '📁')}</span>
          <span><small>PROJECT</small><strong>${escapeHtml(project.title || 'Untitled project')}</strong></span>
        </a>
        ${progress ? `<div class="project-progress" title="${progress.done} of ${progress.total} tasks done">
          <div class="project-progress-track"><span style="width:${progress.percent}%"></span></div>
          <small>${progress.total ? `${progress.done}/${progress.total} tasks done` : 'No tasks yet'}</small>
        </div>` : ''}
        ${members.length ? `<div class="project-members">${members.slice(0, 5).map((member) => avatar(member, 26)).join('')}${members.length > 5 ? `<span class="project-more">+${members.length - 5}</span>` : ''}<a href="#settings?section=team" class="project-invite" title="Invite teammates"><span class="material-symbols-outlined">person_add</span></a></div>` : ''}
      </div>
      <nav class="project-tabs" aria-label="Project sections">
        ${TABS.map((tab) => `<a href="${tabHref(project.id, tab.id)}" class="${tab.id === activeTab ? 'is-active' : ''}" ${tab.id === activeTab ? 'aria-current="page"' : ''}><span class="material-symbols-outlined">${tab.icon}</span>${tab.label}</a>`).join('')}
      </nav>
    </div>`;
}

export async function renderProject(container, route) {
  const projectId = route?.segments?.[0];
  const tab = ['tasks', 'pages'].includes(route?.segments?.[1]) ? route.segments[1] : 'overview';
  const workspaceId = AppState.workspace?.id;

  const [pagesResult, tasksResult, membersResult] = await Promise.all([
    workspaceId ? getPages(workspaceId) : Promise.resolve({ data: [] }),
    getTasks({ workspaceId }),
    workspaceId ? getWorkspaceMembers(workspaceId) : Promise.resolve({ data: [] })
  ]);
  const pages = pagesResult.data || [];
  const project = pages.find((page) => page.id === projectId);
  if (!project || !isProject(project)) {
    setBreadcrumb('Project not found');
    container.innerHTML = `<div class="project-empty-state"><span class="material-symbols-outlined">folder_off</span><h2>Project not found</h2><p>It may have been archived, or it belongs to another team.</p><a href="#dashboard">Go home</a></div>`;
    return;
  }
  setBreadcrumb(project.title || 'Untitled project');

  const members = membersResult.data || [];
  const tasks = tasksForProject(tasksResult.data || [], pages, project.id);
  const progress = projectProgress(tasks);
  const bar = renderProjectBar({ project, activeTab: tab, progress, members });

  if (tab === 'tasks') {
    container.innerHTML = `<div class="project-view">${bar}<div class="project-board"></div></div>`;
    await renderKanban(container.querySelector('.project-board'), { query: route.query, scope: { projectId: project.id, project, pages } });
    return;
  }

  const ids = projectPageIds(pages, project.id);
  const projectPages = pages.filter((page) => ids.has(page.id) && page.id !== project.id);

  if (tab === 'pages') {
    const children = new Map();
    for (const page of projectPages) {
      const list = children.get(page.parent_id) || [];
      list.push(page);
      children.set(page.parent_id, list);
    }
    const renderTree = (parentId, depth) => (children.get(parentId) || [])
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
      .map((page) => `<li style="--depth:${depth}"><a href="#editor/${escapeHtml(page.id)}"><span>${escapeHtml(page.icon || '📄')}</span><strong>${escapeHtml(page.title || 'Untitled')}</strong><small>Edited ${escapeHtml(timeAgo(page.updated_at))}</small></a></li>${renderTree(page.id, depth + 1)}`)
      .join('');
    container.innerHTML = `<div class="project-view">${bar}
      <section class="project-section">
        <div class="project-section-head"><h2>Pages in this project</h2><button type="button" class="project-btn primary" data-new-page><span class="material-symbols-outlined">note_add</span> New page</button></div>
        ${projectPages.length ? `<ul class="project-page-tree">${renderTree(project.id, 0)}</ul>` : `<div class="project-hint"><span class="material-symbols-outlined">description</span><div><strong>No pages yet</strong><p>Add pages for meeting notes, research or drafts. The project plan lives in “Plan &amp; discussion”.</p></div></div>`}
      </section></div>`;
    container.querySelector('[data-new-page]')?.addEventListener('click', () => startNewPageIn(project.id));
    return;
  }

  // Overview
  const openTasks = sortTasksForFocus(tasks.filter((task) => task.status !== 'done' && !task.completed));
  const overdue = openTasks.filter((task) => isOverdue(task));
  const unassigned = openTasks.filter((task) => !task.assignee_id);
  const recentPages = [...projectPages].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 5);
  const { data: comments } = await supabase
    .from('comments')
    .select('id, page_id, content, created_at, author:users(name)')
    .in('page_id', [...ids])
    .order('created_at', { ascending: false })
    .limit(5);
  const pageTitle = (id) => (id === project.id ? 'Project plan' : pages.find((page) => page.id === id)?.title || 'Untitled');

  const taskRow = (task) => `
    <li class="project-task ${isOverdue(task) ? 'is-overdue' : ''}">
      <button type="button" class="project-task-check" data-toggle="${escapeHtml(task.id)}" aria-label="Mark “${escapeHtml(task.title)}” as done"><span class="material-symbols-outlined">radio_button_unchecked</span></button>
      <button type="button" class="project-task-title" data-open="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
      <span class="project-task-meta">${task.assignee?.name ? escapeHtml(task.assignee.name) : '<em>Unassigned</em>'}</span>
      <span class="project-task-meta ${isOverdue(task) ? 'is-overdue' : ''}">${task.due_date ? (isOverdue(task) ? 'Overdue · ' : 'Due ') + escapeHtml(task.due_date) : ''}</span>
    </li>`;

  container.innerHTML = `<div class="project-view">${bar}
    ${overdue.length || unassigned.length ? `<div class="project-alerts">
      ${overdue.length ? `<span class="project-alert danger"><span class="material-symbols-outlined">schedule</span>${overdue.length} overdue</span>` : ''}
      ${unassigned.length ? `<span class="project-alert"><span class="material-symbols-outlined">person_off</span>${unassigned.length} without an owner — assign them so nothing slips</span>` : ''}
    </div>` : ''}
    <div class="project-grid">
      <section class="project-section">
        <div class="project-section-head"><h2>Next up</h2><div class="project-head-actions"><button type="button" class="project-btn primary" data-add-task><span class="material-symbols-outlined">add_task</span> Add task</button><a class="project-link" href="${tabHref(project.id, 'tasks')}">Board →</a></div></div>
        ${openTasks.length ? `<ul class="project-task-list">${openTasks.slice(0, 8).map(taskRow).join('')}</ul>` : `<div class="project-hint"><span class="material-symbols-outlined">task_alt</span><div><strong>${tasks.length ? 'All tasks are done 🎉' : 'No tasks yet'}</strong><p>${tasks.length ? 'Add the next piece of work, or celebrate.' : 'Break the plan into tasks and give each one an owner.'}</p></div></div>`}
      </section>
      <div class="project-side">
        <section class="project-section">
          <div class="project-section-head"><h2>Latest discussion</h2><a class="project-link" href="${tabHref(project.id, 'plan')}">Open →</a></div>
          ${comments?.length ? `<ul class="project-feed">${comments.map((comment) => `<li><a href="#editor/${escapeHtml(comment.page_id)}"><strong>${escapeHtml(comment.author?.name || 'Teammate')}</strong> on ${escapeHtml(pageTitle(comment.page_id))}<p>${escapeHtml(String(comment.content || '').replace(/^\[RESOLVED\] /, '').slice(0, 120))}</p><small>${escapeHtml(timeAgo(comment.created_at))}</small></a></li>`).join('')}</ul>` : `<div class="project-hint"><span class="material-symbols-outlined">forum</span><div><strong>No discussion yet</strong><p>Open the plan and leave a comment. @mention a teammate to bring them in.</p></div></div>`}
        </section>
        <section class="project-section">
          <div class="project-section-head"><h2>Pages</h2><div class="project-head-actions"><button type="button" class="project-btn" data-new-page><span class="material-symbols-outlined">note_add</span> New</button><a class="project-link" href="${tabHref(project.id, 'pages')}">All →</a></div></div>
          <ul class="project-mini-pages">
            <li><a href="#editor/${escapeHtml(project.id)}"><span>🗺️</span><strong>Project plan</strong><small>Edited ${escapeHtml(timeAgo(project.updated_at))}</small></a></li>
            ${recentPages.map((page) => `<li><a href="#editor/${escapeHtml(page.id)}"><span>${escapeHtml(page.icon || '📄')}</span><strong>${escapeHtml(page.title || 'Untitled')}</strong><small>Edited ${escapeHtml(timeAgo(page.updated_at))}</small></a></li>`).join('')}
          </ul>
        </section>
      </div>
    </div></div>`;

  const refresh = () => renderProject(container, route);
  container.querySelector('[data-new-page]')?.addEventListener('click', () => startNewPageIn(project.id));
  container.querySelector('[data-add-task]')?.addEventListener('click', async () => {
    const draft = await requestNewTask({ members, heading: `New task in “${project.title}”` });
    if (!draft) return;
    const { title, ...options } = draft;
    const { error } = await createTask(title, { ...options, workspaceId, pageId: project.id, sortOrder: Date.now() });
    if (error) return showToast(`Could not create task: ${error.message}`, 'error');
    showToast(`Task “${title}” added`, 'success');
    refresh();
  });
  container.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await toggleTask(button.dataset.toggle, true);
    if (error) return showToast(`Could not update task: ${error.message}`, 'error');
    showToast('Task done ✓', 'success');
    refresh();
  }));
  container.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => {
    const task = tasks.find((item) => item.id === button.dataset.open);
    if (task) openTaskDetails(task, members, refresh);
  }));
}
