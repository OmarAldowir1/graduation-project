// ============================================
// GROUPIFY — Project › Teams tab
// Teams with a leader, members, progress and their own tasks.
// ============================================
import { AppState, showToast } from '../app.js';
import { createTask, toggleTask } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { requestForm, requestConfirmation } from '../../lib/dialogs.js';
import { requestNewTask, openTaskDetails } from '../../lib/taskDetails.js';
import { isOverdue, sortTasksForFocus } from '../../lib/projects.js';
import {
  TEAM_COLORS, TEAM_COLOR_NAMES, createTeam, updateTeam, deleteTeam,
  canManageTeam, canCreateTeams, workspaceRole, teamStats, taskProgress
} from '../../lib/teams.js';

const COLOR_LABELS = { blue: 'Blue', teal: 'Teal', green: 'Green', amber: 'Amber', orange: 'Orange', red: 'Red', pink: 'Pink', purple: 'Purple', slate: 'Slate' };

function personName(user) {
  return user?.name || user?.email || 'Member';
}

function face(user, size = 26) {
  const name = personName(user);
  const url = /^https?:\/\//i.test(user?.avatar_url || '') ? user.avatar_url : '';
  return url
    ? `<img class="team-face" style="width:${size}px;height:${size}px" src="${escapeHtml(url)}" alt="" title="${escapeHtml(name)}" />`
    : `<span class="team-face" style="width:${size}px;height:${size}px" title="${escapeHtml(name)}">${escapeHtml(name.trim().slice(0, 1).toUpperCase())}</span>`;
}

async function askTeamDetails({ heading, submitLabel, members, team = null }) {
  const me = AppState.user?.id;
  const options = members.map((member) => ({ value: member.user_id, label: `${personName(member.user)}${member.user_id === me ? ' (you)' : ''}` }));
  const values = await requestForm({
    title: heading,
    description: 'The leader manages the team’s tasks. Members can update the progress of tasks assigned to them, and everyone can comment.',
    submitLabel,
    fields: [
      { name: 'name', label: 'Team name', value: team?.name || '', required: true, placeholder: 'e.g. Design, Backend, Testing', maxLength: 60 },
      { name: 'leaderId', label: 'Leader', type: 'select', value: team ? team.leader_id || '' : me, options: [{ value: '', label: 'No leader yet' }, ...options] },
      { name: 'color', label: 'Colour', type: 'swatches', value: team?.color || TEAM_COLOR_NAMES[Math.floor(Math.random() * TEAM_COLOR_NAMES.length)], options: TEAM_COLOR_NAMES.map((name) => ({ value: name, label: COLOR_LABELS[name], color: TEAM_COLORS[name] })) },
      { name: 'memberIds', label: 'Members', type: 'checkboxes', value: (team?.members || []).map((member) => member.user_id), options }
    ]
  });
  if (!values?.name) return null;
  return values;
}

export function renderTeamsTab(section, ctx) {
  const { project, teams, tasks, members, workspaceId, refresh, unavailable } = ctx;
  const me = AppState.user?.id;
  const role = workspaceRole(members, me, AppState.workspace);
  const memberById = new Map(members.map((member) => [member.user_id, member]));

  if (unavailable) {
    section.innerHTML = `<div class="project-hint"><span class="material-symbols-outlined">construction</span><div><strong>Teams aren’t set up yet</strong><p>Run <code>sql/project-teams.sql</code> in Supabase to turn on teams, leaders and progress.</p></div></div>`;
    return;
  }

  const noTeamTasks = tasks.filter((task) => !task.team_id);
  const taskRow = (task, team) => {
    const progress = taskProgress(task);
    const done = task.status === 'done' || task.completed;
    const mine = task.assignee_id === me;
    const canToggle = !team || canManageTeam(team, role, me) || mine;
    return `
      <li class="team-task ${done ? 'is-done' : ''} ${isOverdue(task) ? 'is-overdue' : ''}">
        <button type="button" class="team-task-check" data-toggle="${escapeHtml(task.id)}" ${canToggle ? '' : 'disabled'} aria-label="${done ? 'Mark as not done' : 'Mark as done'}: ${escapeHtml(task.title)}"><span class="material-symbols-outlined">${done ? 'check_circle' : 'radio_button_unchecked'}</span></button>
        <button type="button" class="team-task-title" data-open="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
        <span class="team-task-owner">${task.assignee ? face(task.assignee, 20) : '<em>No owner</em>'}</span>
        <span class="team-task-due ${isOverdue(task) ? 'is-overdue' : ''}">${task.due_date ? escapeHtml(new Date(`${task.due_date}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : ''}</span>
        <span class="team-task-progress" title="${progress}% done"><i style="width:${progress}%"></i></span>
      </li>`;
  };

  const teamCard = (team) => {
    const stats = teamStats(team, tasks);
    const manage = canManageTeam(team, role, me);
    const color = TEAM_COLORS[team.color] || TEAM_COLORS.blue;
    const teamMembers = (team.members || []).map((member) => member.user || memberById.get(member.user_id)?.user).filter(Boolean);
    const open = sortTasksForFocus(stats.tasks.filter((task) => task.status !== 'done'));
    const done = stats.tasks.filter((task) => task.status === 'done');
    return `
      <article class="team-card" style="--team:${color}" data-team="${escapeHtml(team.id)}">
        <header class="team-card-head">
          <span class="team-dot" aria-hidden="true"></span>
          <div class="team-card-title">
            <h3>${escapeHtml(team.name)}</h3>
            <p>${team.leader ? `${face(team.leader, 18)} <span>Led by <strong>${escapeHtml(personName(team.leader))}</strong>${team.leader_id === me ? ' (you)' : ''}</span>` : '<span class="team-no-leader">No leader yet</span>'}</p>
          </div>
          ${manage ? `<div class="team-card-actions">
            <button type="button" class="team-icon-btn" data-edit-team="${escapeHtml(team.id)}" title="Edit team" aria-label="Edit ${escapeHtml(team.name)}"><span class="material-symbols-outlined">edit</span></button>
            <button type="button" class="team-icon-btn is-danger" data-delete-team="${escapeHtml(team.id)}" title="Delete team" aria-label="Delete ${escapeHtml(team.name)}"><span class="material-symbols-outlined">delete</span></button>
          </div>` : `<span class="team-lock" title="Only the leader edits this team’s tasks"><span class="material-symbols-outlined">lock</span></span>`}
        </header>
        <div class="team-progress">
          <div class="team-progress-track"><span style="width:${stats.percent}%"></span></div>
          <strong>${stats.percent}%</strong>
        </div>
        <div class="team-meta">
          <span>${stats.done}/${stats.total} done</span>
          ${stats.overdue ? `<span class="is-overdue">${stats.overdue} overdue</span>` : ''}
          <span class="team-faces">${teamMembers.slice(0, 5).map((user) => face(user, 22)).join('')}${teamMembers.length > 5 ? `<em>+${teamMembers.length - 5}</em>` : ''}</span>
        </div>
        <ul class="team-task-list">
          ${open.map((task) => taskRow(task, team)).join('')}
          ${done.length ? `<li class="team-done-toggle"><details><summary>${done.length} done</summary><ul>${done.map((task) => taskRow(task, team)).join('')}</ul></details></li>` : ''}
          ${!stats.total ? `<li class="team-empty">${manage ? 'No tasks yet. Add the first one for this team.' : 'No tasks yet.'}</li>` : ''}
        </ul>
        ${manage ? `<button type="button" class="team-add-task" data-add-task="${escapeHtml(team.id)}"><span class="material-symbols-outlined">add</span> Add task</button>` : ''}
      </article>`;
  };

  section.innerHTML = `
    <div class="project-section-head">
      <div><h2>Teams</h2><p class="team-intro">Split the project into teams. Each leader manages their team’s tasks; members update their own progress.</p></div>
      ${canCreateTeams(role) ? '<button type="button" class="project-btn primary" data-new-team><span class="material-symbols-outlined">group_add</span> New team</button>' : ''}
    </div>
    ${teams.length ? `<div class="team-grid">${teams.map(teamCard).join('')}</div>` : `
      <div class="team-empty-state">
        <span class="material-symbols-outlined">groups</span>
        <h3>No teams in this project yet</h3>
        <p>Teams help bigger groups split the work, for example <strong>Design</strong>, <strong>Backend</strong> and <strong>Testing</strong>, each with its own leader and progress bar.</p>
        ${canCreateTeams(role) ? '<button type="button" class="project-btn primary" data-new-team><span class="material-symbols-outlined">group_add</span> Create the first team</button>' : '<p><em>Ask a team owner or editor to create teams.</em></p>'}
        <p class="team-ai-tip"><span class="material-symbols-outlined">auto_awesome</span> Tip: ask the AI “Create teams for this project with a leader for each”.</p>
      </div>`}
    ${teams.length && noTeamTasks.length ? `<details class="team-unassigned"><summary>${noTeamTasks.length} task${noTeamTasks.length === 1 ? '' : 's'} not in a team</summary><ul class="team-task-list">${sortTasksForFocus(noTeamTasks).map((task) => taskRow(task, null)).join('')}</ul></details>` : ''}`;

  const teamById = (id) => teams.find((team) => team.id === id);

  section.querySelectorAll('[data-new-team]').forEach((button) => button.addEventListener('click', async () => {
    const values = await askTeamDetails({ heading: `New team in “${project.title || 'this project'}”`, submitLabel: 'Create team', members });
    if (!values) return;
    const { error } = await createTeam({ workspaceId, projectId: project.id, name: values.name, color: values.color, leaderId: values.leaderId || null, memberIds: values.memberIds, sortOrder: teams.length });
    if (error) return showToast(`Could not create team: ${error.message}`, 'error');
    showToast(`Team “${values.name}” created`, 'success');
    refresh();
  }));

  section.querySelectorAll('[data-edit-team]').forEach((button) => button.addEventListener('click', async () => {
    const team = teamById(button.dataset.editTeam);
    const values = await askTeamDetails({ heading: `Edit “${team.name}”`, submitLabel: 'Save team', members, team });
    if (!values) return;
    const { error } = await updateTeam(team, { name: values.name, color: values.color, leaderId: values.leaderId || null, memberIds: values.memberIds });
    if (error) return showToast(`Could not save team: ${error.message}`, 'error');
    showToast('Team saved', 'success');
    refresh();
  }));

  section.querySelectorAll('[data-delete-team]').forEach((button) => button.addEventListener('click', async () => {
    const team = teamById(button.dataset.deleteTeam);
    if (!await requestConfirmation(`Delete the team “${team.name}”? Its tasks stay in the project, just without a team.`)) return;
    const { error } = await deleteTeam(team.id);
    if (error) return showToast(`Could not delete team: ${error.message}`, 'error');
    showToast('Team deleted', 'success');
    refresh();
  }));

  section.querySelectorAll('[data-add-task]').forEach((button) => button.addEventListener('click', async () => {
    const team = teamById(button.dataset.addTask);
    const teamMemberIds = new Set((team.members || []).map((member) => member.user_id));
    const ordered = [...members].sort((a, b) => Number(teamMemberIds.has(b.user_id)) - Number(teamMemberIds.has(a.user_id)));
    const draft = await requestNewTask({ members: ordered, heading: `New task for ${team.name}` });
    if (!draft) return;
    const { title, ...options } = draft;
    const { error } = await createTask(title, { ...options, workspaceId, pageId: project.id, teamId: team.id, progress: options.status === 'done' ? 100 : 0, sortOrder: Date.now() });
    if (error) return showToast(`Could not add task: ${error.message}`, 'error');
    showToast(`Task added to ${team.name}`, 'success');
    refresh();
  }));

  section.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', async () => {
    const task = tasks.find((item) => item.id === button.dataset.toggle);
    if (!task) return;
    const { error } = await toggleTask(task.id, task.status !== 'done');
    if (error) return showToast(error.message, 'error');
    refresh();
  }));

  section.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => {
    const task = tasks.find((item) => item.id === button.dataset.open);
    if (task) openTaskDetails(task, members, refresh, { teams });
  }));
}
