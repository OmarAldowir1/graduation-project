// ============================================
// MOTION — Home: my tasks, projects, team activity, getting started
// ============================================
import { AppState, setBreadcrumb, showToast } from '../app.js';
import { getPages, getTasks, getWorkspaceMembers, getNotifications, toggleTask, createTask, timeAgo } from '../../lib/queries.js';
import { supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { listProjects, buildProjectIndex, tasksForProject, projectProgress, isOverdue, sortTasksForFocus, PROJECT_TEMPLATES } from '../../lib/projects.js';
import { startNewProject } from '../../lib/projectActions.js';
import { requestNewTask, openTaskDetails } from '../../lib/taskDetails.js';
import { describeNotification } from '../../lib/notificationText.js';
import { pickAndFocus } from '../../lib/focusZone.js';
import { getMyCheckinsForWeek } from '../../lib/checkins.js';
import { getWorkspaceTeams } from '../../lib/teams.js';

function checklistKey() {
  return `motion-onboarding-dismissed-${AppState.workspace?.id || 'none'}`;
}
function readDismissed() {
  try { return localStorage.getItem(checklistKey()) === '1'; } catch { return false; }
}

export async function renderDashboard(container) {
  setBreadcrumb('Home');
  const workspaceId = AppState.workspace?.id;
  const me = AppState.user?.id;

  const [pagesResult, tasksResult, membersResult, notificationsResult, commentsResult, myCheckinsResult, teamsResult] = await Promise.all([
    workspaceId ? getPages(workspaceId) : Promise.resolve({ data: [] }),
    getTasks({ workspaceId }),
    workspaceId ? getWorkspaceMembers(workspaceId) : Promise.resolve({ data: [] }),
    getNotifications(8),
    supabase.from('comments').select('id', { count: 'exact', head: true }),
    workspaceId ? getMyCheckinsForWeek(workspaceId, me) : Promise.resolve({ data: [] }),
    workspaceId ? getWorkspaceTeams(workspaceId) : Promise.resolve({ data: [] })
  ]);
  if (tasksResult.error || pagesResult.error) {
    const message = (tasksResult.error || pagesResult.error)?.message || 'Please try again.';
    container.innerHTML = `<div class="error-state m-8"><span class="material-symbols-outlined">error</span><h3>Could not load your home</h3><p>${escapeHtml(message)}</p><button id="home-retry" type="button">Try again</button></div>`;
    container.querySelector('#home-retry')?.addEventListener('click', () => renderDashboard(container));
    return;
  }

  const pages = pagesResult.data || [];
  const tasks = tasksResult.data || [];
  const members = membersResult.data || [];
  const projects = listProjects(pages);
  const projectIndex = buildProjectIndex(pages);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const myTasks = sortTasksForFocus(tasks.filter((task) => task.assignee_id === me && task.status !== 'done' && !task.completed));
  const unassigned = tasks.filter((task) => !task.assignee_id && task.status !== 'done' && !task.completed);
  const overdueMine = myTasks.filter((task) => isOverdue(task));
  // Weekly check-ins still due: projects where I have open tasks or am in a team.
  const checkedIn = new Set((myCheckinsResult.data || []).map((row) => row.project_id));
  const myProjectIds = new Set([
    ...myTasks.map((task) => projectIndex.get(task.page_id)).filter(Boolean),
    ...(teamsResult.data || []).filter((team) => team.leader_id === me || (team.members || []).some((member) => member.user_id === me)).map((team) => team.project_id)
  ]);
  const checkinsDue = myCheckinsResult.unavailable ? [] : [...myProjectIds].filter((id) => projectById.has(id) && !checkedIn.has(id)).map((id) => projectById.get(id));
  const firstName = escapeHtml((AppState.profile?.name || AppState.user?.email?.split('@')[0] || 'there').split(' ')[0]);
  const teamName = escapeHtml(AppState.workspace?.name || 'your team');

  const steps = [
    { id: 'project', done: projects.length > 0, label: 'Create a project', hint: 'A shared home for the plan, tasks and pages.', action: 'new-project' },
    { id: 'invite', done: members.length > 1, label: 'Invite a teammate', hint: 'Collaboration starts with a second person.', href: '#settings?section=team' },
    { id: 'assign', done: tasks.some((task) => task.assignee_id && task.assignee_id !== me), label: 'Give a teammate a task', hint: 'Every task should have one owner.', href: projects[0] ? `#project/${projects[0].id}/tasks` : null, action: projects[0] ? null : 'new-project' },
    { id: 'discuss', done: (commentsResult.count || 0) > 0, label: 'Start a discussion', hint: 'Comment on the plan and @mention someone.', href: projects[0] ? `#editor/${projects[0].id}` : null, action: projects[0] ? null : 'new-project' }
  ];
  const stepsDone = steps.filter((step) => step.done).length;
  const showChecklist = stepsDone < steps.length && !readDismissed();

  const taskRow = (task) => {
    const project = projectById.get(projectIndex.get(task.page_id));
    return `<li class="home-task ${isOverdue(task) ? 'is-overdue' : ''}">
      <button type="button" class="project-task-check" data-toggle="${escapeHtml(task.id)}" aria-label="Mark “${escapeHtml(task.title)}” as done"><span class="material-symbols-outlined">radio_button_unchecked</span></button>
      <button type="button" class="project-task-title" data-open="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
      ${project ? `<a class="home-chip" href="#project/${escapeHtml(project.id)}">${escapeHtml(project.icon || '📁')} ${escapeHtml(project.title)}</a>` : '<span></span>'}
      <span class="project-task-meta ${isOverdue(task) ? 'is-overdue' : ''}">${task.due_date ? `${isOverdue(task) ? 'Overdue' : 'Due'} ${escapeHtml(task.due_date)}` : ''}</span>
    </li>`;
  };

  const projectCard = (project) => {
    const progress = projectProgress(tasksForProject(tasks, pages, project.id));
    return `<a class="home-project" href="#project/${escapeHtml(project.id)}">
      <span class="home-project-icon">${escapeHtml(project.icon || '📁')}</span>
      <strong>${escapeHtml(project.title || 'Untitled project')}</strong>
      <div class="project-progress-track"><span style="width:${progress.percent}%"></span></div>
      <small>${progress.total ? `${progress.done}/${progress.total} done · ${progress.open} open` : 'No tasks yet'} · edited ${escapeHtml(timeAgo(project.updated_at))}</small>
    </a>`;
  };

  const activity = (notificationsResult.data || []).filter((item) => !item.workspace_id || item.workspace_id === workspaceId).slice(0, 6);

  // Due-soon alert and weekly digest.
  const localKey = (offsetDays) => {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const todayStr = localKey(0);
  const tomorrow = localKey(1);
  const weekEnd = localKey(7);
  const weekAgo = Date.now() - 7 * 86400000;
  const dueSoonMine = myTasks.filter((task) => task.due_date && task.due_date <= tomorrow && task.due_date >= todayStr);
  const openTeamTasks = tasks.filter((task) => task.status !== 'done' && !task.completed);
  const digest = {
    dueThisWeek: openTeamTasks.filter((task) => task.due_date && task.due_date >= todayStr && task.due_date <= weekEnd).length,
    overdue: openTeamTasks.filter((task) => isOverdue(task)).length,
    unowned: unassigned.length,
    pagesEdited: pages.filter((page) => Date.parse(page.updated_at) > weekAgo).length
  };

  const templatesHtml = Object.entries(PROJECT_TEMPLATES).map(([key, template]) => `
    <button type="button" class="home-template" data-template="${key}">
      <span class="home-template-icon">${template.icon}</span>
      <strong>${escapeHtml(template.label)}</strong>
      <p>${escapeHtml(template.description)}</p>
    </button>`).join('');

  container.innerHTML = `
    <div class="home">
      <header class="home-header">
        <div>
          <p class="home-eyebrow">${teamName}</p>
          <h1>Hi ${firstName} 👋</h1>
          <p class="home-summary">${overdueMine.length ? `<strong class="is-overdue">${overdueMine.length} of your tasks ${overdueMine.length === 1 ? 'is' : 'are'} overdue.</strong> ` : ''}${myTasks.length ? `You have ${myTasks.length} open task${myTasks.length === 1 ? '' : 's'}${projects.length ? ` across ${projects.length} project${projects.length === 1 ? '' : 's'}` : ''}.` : projects.length ? 'Nothing assigned to you right now.' : 'Groupify helps your team plan projects, split them into tasks, and finish them together.'}</p>
        </div>
        <div class="home-actions">
          <button type="button" class="project-btn primary" data-new-project><span class="material-symbols-outlined">create_new_folder</span> New project</button>
          <button type="button" class="project-btn" data-new-task><span class="material-symbols-outlined">add_task</span> Add task</button>
          <button type="button" class="project-btn" data-focus-start title="Work on one thing with a timer, no distractions"><span class="material-symbols-outlined">timer</span> Focus</button>
        </div>
      </header>

      ${dueSoonMine.length ? `<a class="home-due-alert" href="#kanban?assignee=mine"><span class="material-symbols-outlined">alarm</span><span><strong>${dueSoonMine.length === 1 ? 'One of your tasks is' : `${dueSoonMine.length} of your tasks are`} due ${dueSoonMine.every((task) => task.due_date === todayStr) ? 'today' : 'by tomorrow'}:</strong> ${dueSoonMine.slice(0, 3).map((task) => escapeHtml(task.title)).join(', ')}${dueSoonMine.length > 3 ? '…' : ''}</span></a>` : ''}

      ${checkinsDue.length ? `<div class="home-checkin-alert"><span class="material-symbols-outlined">event_note</span><span><strong>Weekly check-in:</strong> tell your team how the week went in ${checkinsDue.map((project) => `<a href="#project/${escapeHtml(project.id)}/checkins">${escapeHtml(project.icon || '📁')} ${escapeHtml(project.title || 'Untitled project')}</a>`).join(', ')}.</span></div>` : ''}

      ${projects.length ? `<section class="home-digest" aria-label="This week">
        <h2>This week in ${teamName}</h2>
        <div class="home-digest-grid">
          <a href="#kanban"><strong>${digest.dueThisWeek}</strong><span>task${digest.dueThisWeek === 1 ? '' : 's'} due in the next 7 days</span></a>
          <a href="#kanban" class="${digest.overdue ? 'is-bad' : ''}"><strong>${digest.overdue}</strong><span>overdue</span></a>
          <a href="#kanban" class="${digest.unowned ? 'is-warn' : ''}"><strong>${digest.unowned}</strong><span>without an owner</span></a>
          <a href="#notes"><strong>${digest.pagesEdited}</strong><span>page${digest.pagesEdited === 1 ? '' : 's'} edited</span></a>
        </div>
      </section>` : ''}

      ${projects.length ? '' : `<section class="home-start">
        <h2>Start your first project</h2>
        <p>Pick a starting point. You’ll get a plan page and starter tasks you can assign to teammates.</p>
        <div class="home-templates">${templatesHtml}</div>
      </section>`}

      ${showChecklist ? `<section class="home-checklist" aria-label="Getting started">
        <div class="home-checklist-head"><div><h2>Get your team going</h2><p>${stepsDone} of ${steps.length} done</p></div><button type="button" class="home-dismiss" data-dismiss aria-label="Hide getting started">Hide</button></div>
        <div class="project-progress-track"><span style="width:${Math.round((stepsDone / steps.length) * 100)}%"></span></div>
        <ol>${steps.map((step) => `<li class="${step.done ? 'is-done' : ''}">
          <span class="material-symbols-outlined">${step.done ? 'check_circle' : 'radio_button_unchecked'}</span>
          <div><strong>${step.label}</strong><small>${step.hint}</small></div>
          ${step.done ? '' : step.action ? `<button type="button" class="project-link" data-step-action="${step.action}">Do it →</button>` : step.href ? `<a class="project-link" href="${step.href}">Do it →</a>` : ''}
        </li>`).join('')}</ol>
      </section>` : ''}

      <div class="home-grid">
        <section class="project-section">
          <div class="project-section-head"><h2>My tasks</h2><a class="project-link" href="#kanban?assignee=mine">See all →</a></div>
          ${myTasks.length ? `<ul class="project-task-list">${myTasks.slice(0, 8).map(taskRow).join('')}</ul>` : `<div class="project-hint"><span class="material-symbols-outlined">task_alt</span><div><strong>Nothing assigned to you</strong><p>${unassigned.length ? `${unassigned.length} task${unassigned.length === 1 ? ' has' : 's have'} no owner yet — <a href="#kanban">pick one up</a>.` : 'Tasks assigned to you from any project appear here.'}</p></div></div>`}
        </section>

        <div class="project-side">
          ${projects.length ? `<section class="project-section">
            <div class="project-section-head"><h2>Projects</h2><button type="button" class="project-btn" data-new-project><span class="material-symbols-outlined">add</span> New</button></div>
            <div class="home-projects">${projects.slice(0, 6).map(projectCard).join('')}</div>
          </section>` : ''}
          <section class="project-section">
            <div class="project-section-head"><h2>Team activity</h2></div>
            ${activity.length ? `<ul class="project-feed">${activity.map((item) => {
              const info = describeNotification(item);
              return `<li><a href="${info.href ? `#${escapeHtml(info.href)}` : '#dashboard'}" data-notification="${escapeHtml(item.id)}"><strong>${escapeHtml(info.text)}</strong>${info.excerpt ? `<p>${escapeHtml(info.excerpt)}</p>` : ''}<small>${escapeHtml(timeAgo(item.created_at))}</small></a></li>`;
            }).join('')}</ul>` : `<div class="project-hint"><span class="material-symbols-outlined">groups</span><div><strong>Quiet for now</strong><p>${members.length > 1 ? 'When teammates comment, mention you or assign you work, it shows up here.' : '<a href="#settings?section=team">Invite a teammate</a> to see their updates here.'}</p></div></div>`}
          </section>
        </div>
      </div>
    </div>`;

  const refresh = () => renderDashboard(container);
  container.querySelectorAll('[data-new-project]').forEach((button) => button.addEventListener('click', () => startNewProject()));
  container.querySelectorAll('[data-template]').forEach((button) => button.addEventListener('click', () => startNewProject({ template: button.dataset.template })));
  container.querySelectorAll('[data-step-action="new-project"]').forEach((button) => button.addEventListener('click', () => startNewProject()));
  container.querySelector('[data-dismiss]')?.addEventListener('click', () => {
    try { localStorage.setItem(checklistKey(), '1'); } catch { /* private mode */ }
    container.querySelector('.home-checklist')?.remove();
  });
  container.querySelector('[data-focus-start]')?.addEventListener('click', () => pickAndFocus());
  container.querySelector('[data-new-task]')?.addEventListener('click', async () => {
    const draft = await requestNewTask({ members, projects, projectId: projects[0]?.id || '' });
    if (!draft) return;
    const { title, ...options } = draft;
    const { error } = await createTask(title, { ...options, workspaceId, sortOrder: Date.now() });
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
