// ============================================
// GROUPIFY — Project team tools
// Milestones & deadline health · Meeting assistant · Decisions & polls ·
// Resources · Workload & AI rebalance
// ============================================
import { AppState, showToast } from '../app.js';
import { supabase } from '../../lib/supabase.js';
import { createPage, invalidateQueryCache } from '../../lib/queries.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { requestForm, requestConfirmation, openCustomDialog } from '../../lib/dialogs.js';
import { markdownToHtml } from '../../lib/markdown.js';
import { taskProgress } from '../../lib/teams.js';
import {
  getMilestones, createMilestone, updateMilestone, deleteMilestone, deadlineHealth, todayKey,
  getDecisions, createDecision, deleteDecision,
  getPolls, createPoll, vote, removeVote, closePoll, deletePoll, pollResults,
  getResources, createResource, deleteResource, isSafeUrl,
  canManageItem, canAdd
} from '../../lib/teamTools.js';

const e = escapeHtml;
const shortDate = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
const personName = (user) => user?.name || user?.email?.split('@')[0] || 'Teammate';
const unavailableHint = '<div class="project-hint"><span class="material-symbols-outlined">construction</span><div><strong>Not set up yet</strong><p>Run <code>sql/team-tools.sql</code> in Supabase to turn this on.</p></div></div>';

// Hand a prepared request to "Ask AI" (it opens a fresh chat and sends it).
function askAI(prompt, pageId = null) {
  try { sessionStorage.setItem('motion-ai-pending', JSON.stringify({ prompt: prompt.slice(0, 3900), pageId })); } catch { /* ignore */ }
  window.location.hash = 'ai-chat?new=1';
}

// ---------------------------------------------------------------- Milestones
export async function renderMilestonesCard(el, ctx) {
  const { project, progress, role, workspaceId, refresh } = ctx;
  const { data: milestones, unavailable, error } = await getMilestones(project.id);
  if (!el.isConnected) return null;
  if (unavailable) { el.innerHTML = `<div class="project-section-head"><h2>Milestones</h2></div>${unavailableHint}`; return null; }
  if (error) { el.innerHTML = `<div class="project-section-head"><h2>Milestones</h2></div><p class="tools-error">${e(error.message)}</p>`; return null; }
  const today = todayKey();
  const health = deadlineHealth({ milestones, progress, projectStart: project.created_at, today });
  const editable = canAdd(role);
  el.innerHTML = `
    <div class="project-section-head">
      <h2>Milestones</h2>
      ${editable ? '<button type="button" class="project-btn" data-add-milestone><span class="material-symbols-outlined">flag</span> Add</button>' : ''}
    </div>
    ${milestones.length ? `<div class="deadline-health is-${health.status}" role="status">
      <span class="deadline-dot" aria-hidden="true"></span>
      <div><strong>${e(health.label)}</strong><small>${e(health.detail)}</small></div>
    </div>` : ''}
    ${milestones.length ? `<ol class="milestone-list">${milestones.map((milestone) => {
      const done = Boolean(milestone.done_at);
      const late = !done && milestone.due_date < today;
      return `<li class="${done ? 'is-done' : ''} ${late ? 'is-late' : ''}">
        <button type="button" class="milestone-check" data-toggle-milestone="${e(milestone.id)}" ${editable ? '' : 'disabled'} aria-label="${done ? 'Mark as not reached' : 'Mark as reached'}: ${e(milestone.title)}"><span class="material-symbols-outlined">${done ? 'check_circle' : 'flag'}</span></button>
        <button type="button" class="milestone-title" data-edit-milestone="${e(milestone.id)}" ${editable ? '' : 'disabled'}>${e(milestone.title)}</button>
        <span class="milestone-date">${late ? 'Late · ' : ''}${e(shortDate(milestone.due_date))}</span>
      </li>`;
    }).join('')}</ol>` : `<p class="tools-empty">${editable ? 'Add key dates like Proposal, Prototype and Final presentation.' : 'No key dates yet.'}</p>`}`;

  const byId = (id) => milestones.find((milestone) => milestone.id === id);
  el.querySelector('[data-add-milestone]')?.addEventListener('click', async () => {
    const values = await requestForm({
      title: 'Add a milestone',
      description: 'A key date for the whole project, e.g. “Proposal”, “Prototype demo” or “Final presentation”.',
      submitLabel: 'Add milestone',
      fields: [
        { name: 'title', label: 'Name', required: true, placeholder: 'e.g. Prototype demo', maxLength: 120 },
        { name: 'date', label: 'Date', type: 'date', required: true, value: '' }
      ]
    });
    if (!values?.title || !values.date) return;
    const { error: addError } = await createMilestone({ workspaceId, projectId: project.id, title: values.title, dueDate: values.date });
    if (addError) return showToast(`Could not add the milestone: ${addError.message}`, 'error');
    showToast('Milestone added', 'success');
    refresh();
  });
  el.querySelectorAll('[data-toggle-milestone]').forEach((button) => button.addEventListener('click', async () => {
    const milestone = byId(button.dataset.toggleMilestone);
    const { error: toggleError } = await updateMilestone(milestone.id, { done: !milestone.done_at });
    if (toggleError) return showToast(`Could not update the milestone: ${toggleError.message}`, 'error');
    showToast(milestone.done_at ? 'Milestone reopened' : `“${milestone.title}” reached 🎉`, 'success');
    refresh();
  }));
  el.querySelectorAll('[data-edit-milestone]').forEach((button) => button.addEventListener('click', async () => {
    const milestone = byId(button.dataset.editMilestone);
    const canDelete = canManageItem(milestone, { userId: AppState.user?.id, role });
    const values = await requestForm({
      title: 'Edit milestone',
      submitLabel: 'Save',
      fields: [
        { name: 'title', label: 'Name', required: true, value: milestone.title, maxLength: 120 },
        { name: 'date', label: 'Date', type: 'date', required: true, value: milestone.due_date },
        ...(canDelete ? [{ name: 'remove', label: 'Delete this milestone?', type: 'select', value: 'no', options: [{ value: 'no', label: 'Keep it' }, { value: 'yes', label: 'Delete it' }] }] : [])
      ]
    });
    if (!values) return;
    if (values.remove === 'yes') {
      if (!await requestConfirmation(`Delete the milestone “${milestone.title}”?`)) return;
      const { error: deleteError } = await deleteMilestone(milestone.id);
      if (deleteError) return showToast(`Could not delete it: ${deleteError.message}`, 'error');
      showToast('Milestone deleted', 'success');
      return refresh();
    }
    const { error: saveError } = await updateMilestone(milestone.id, { title: values.title, dueDate: values.date });
    if (saveError) return showToast(`Could not save: ${saveError.message}`, 'error');
    showToast('Milestone saved', 'success');
    refresh();
  }));
  return health;
}

// ---------------------------------------------------------------- Meeting assistant
export async function openMeetingAssistant(ctx) {
  const { project, tasks, members, workspaceId, weekCheckins = [] } = ctx;
  const today = todayKey();
  const soon = todayKey(new Date(Date.now() + 7 * 86400000));
  const [{ data: milestones = [] }, { data: polls = [] }, { data: decisions = [] }] = await Promise.all([
    getMilestones(project.id), getPolls(project.id), getDecisions(project.id)
  ]);
  const nameOf = (userId) => personName(members.find((member) => member.user_id === userId)?.user);
  const open = tasks.filter((task) => task.status !== 'done' && !task.completed);
  const blockers = weekCheckins.filter((checkin) => checkin.blockers && !checkin.blocker_resolved_at);
  const overdue = open.filter((task) => task.due_date && task.due_date < today);
  const dueSoon = open.filter((task) => task.due_date && task.due_date >= today && task.due_date <= soon);
  const noOwner = open.filter((task) => !task.assignee_id);
  const lateMilestones = milestones.filter((milestone) => !milestone.done_at && milestone.due_date < today);
  const nextMilestone = milestones.find((milestone) => !milestone.done_at && milestone.due_date >= today);
  const openPolls = polls.filter((poll) => !poll.closed_at);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const newDecisions = decisions.filter((decision) => decision.created_at >= weekAgo);

  // The agenda: most urgent first, each item with who it concerns.
  const agenda = [];
  if (blockers.length) agenda.push({ title: 'Unblock teammates', items: blockers.map((checkin) => `${personName(checkin.user) || nameOf(checkin.user_id)}: ${checkin.blockers}`) });
  if (lateMilestones.length || nextMilestone) agenda.push({ title: 'Milestones', items: [...lateMilestones.map((milestone) => `LATE: ${milestone.title} (was due ${shortDate(milestone.due_date)})`), ...(nextMilestone ? [`Next: ${nextMilestone.title} on ${shortDate(nextMilestone.due_date)}`] : [])] });
  if (overdue.length) agenda.push({ title: 'Overdue work', items: overdue.slice(0, 8).map((task) => `${task.title} (${nameOf(task.assignee_id)}, due ${shortDate(task.due_date)})`) });
  if (dueSoon.length) agenda.push({ title: 'Due this week', items: dueSoon.slice(0, 8).map((task) => `${task.title} (${nameOf(task.assignee_id)}, ${taskProgress(task)}%)`) });
  if (openPolls.length) agenda.push({ title: 'Decide together', items: openPolls.map((poll) => `Poll: ${poll.question}`) });
  if (noOwner.length) agenda.push({ title: 'Give these an owner', items: noOwner.slice(0, 6).map((task) => task.title) });
  if (newDecisions.length) agenda.push({ title: 'Decisions made this week (for the record)', items: newDecisions.map((decision) => decision.title) });

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const markdown = [
    `## Agenda`,
    ...(agenda.length ? agenda.flatMap((section, index) => [`### ${index + 1}. ${section.title}`, ...section.items.map((item) => `- ${item}`)]) : ['- Quick round: what did everyone do, what is next?']),
    '## Notes',
    '- ',
    '## Decisions',
    '- ',
    '## Action items',
    '- [ ] '
  ].join('\n');

  await openCustomDialog({
    label: 'Meeting assistant',
    html: `<div class="modal-container meeting-dialog">
      <div class="modal-header"><h3>📋 Meeting for ${e(project.title || 'this project')}</h3></div>
      <div class="modal-body">
        <p class="meeting-intro">Groupify built this agenda from your blockers, milestones, late work and open polls. Most urgent first.</p>
        ${agenda.length ? agenda.map((section, index) => `<section class="meeting-section"><h4>${index + 1}. ${e(section.title)}</h4><ul>${section.items.map((item) => `<li>${e(item)}</li>`).join('')}</ul></section>`).join('') : '<p class="tools-empty">Nothing urgent. A quick round of updates is enough today. 🎉</p>'}
        <p class="meeting-tip"><span class="material-symbols-outlined">auto_awesome</span><span>After the meeting, open the page’s <strong>Ask AI</strong> menu and choose <strong>“Meeting notes → decisions &amp; tasks”</strong>.</span></p>
      </div>
      <div class="modal-footer"><button type="button" class="modal-btn-secondary" data-cancel>Close</button><button type="button" class="modal-btn-primary" data-create-meeting>Create meeting page</button></div>
    </div>`,
    onReady(dialog, finish) {
      const createButton = dialog.querySelector('[data-create-meeting]');
      createButton.addEventListener('click', async () => {
        createButton.disabled = true;
        const { data: page, error } = await createPage(workspaceId, `Meeting · ${dateLabel}`, 'note', { html: markdownToHtml(markdown) }, project.id);
        if (error) { createButton.disabled = false; showToast(`Could not create the page: ${error.message}`, 'error'); return; }
        await supabase.from('pages').update({ icon: '📋' }).eq('id', page.id);
        invalidateQueryCache('pages');
        window.dispatchEvent(new CustomEvent('motion:pages-changed'));
        finish(true);
        window.location.hash = `editor/${page.id}`;
      });
    }
  });
}

// The prompt behind the page menu item "Meeting notes → decisions & tasks".
export function meetingNotesPrompt(title, projectTitle) {
  return `Read the meeting page “${title}”${projectTitle ? ` in the project “${projectTitle}”` : ''}. Then: (1) append a short "## Summary" (3-5 bullet points) to that page, (2) record every decision the team made with create_decision (one per decision, with a one-sentence "details" saying why), and (3) create a task for every action item, with the owner named in the notes when they match a team member and a due date. Use only what is written in the notes.`;
}

// ---------------------------------------------------------------- Decisions & polls
export async function renderDecisionsTab(section, ctx) {
  const { project, members, role, workspaceId } = ctx;
  const me = AppState.user?.id;
  section.innerHTML = '<p class="tools-empty">Loading…</p>';
  const [pollsResult, decisionsResult] = await Promise.all([getPolls(project.id), getDecisions(project.id)]);
  if (!section.isConnected) return;
  if (pollsResult.unavailable || decisionsResult.unavailable) { section.innerHTML = unavailableHint; return; }
  const loadError = pollsResult.error || decisionsResult.error;
  if (loadError) { section.innerHTML = `<p class="tools-error">${e(loadError.message)}</p>`; return; }
  const polls = pollsResult.data;
  const decisions = decisionsResult.data;
  const editable = canAdd(role);
  const memberCount = members.length || 1;

  const pollCard = (poll) => {
    const { options, counts, total, winners } = pollResults(poll);
    const myVote = (poll.votes || []).find((entry) => entry.user_id === me)?.option_index;
    const closed = Boolean(poll.closed_at);
    const manage = canManageItem(poll, { userId: me, role });
    return `<article class="poll-card ${closed ? 'is-closed' : ''}">
      <header><h3>${e(poll.question)}</h3><small>${closed ? 'Closed' : 'Open'} · ${total} of ${memberCount} voted · by ${e(personName(poll.author))}</small></header>
      <ul class="poll-options">${options.map((option, index) => {
        const share = total ? Math.round((counts[index] / total) * 100) : 0;
        const mine = myVote === index;
        const winner = closed && winners.length === 1 && winners[0] === index;
        return `<li><button type="button" class="poll-option ${mine ? 'is-mine' : ''} ${winner ? 'is-winner' : ''}" data-vote="${e(poll.id)}" data-option="${index}" ${closed ? 'disabled' : ''} aria-pressed="${mine}">
          <span class="poll-bar" style="width:${share}%"></span>
          <span class="poll-label">${mine ? '✓ ' : ''}${winner ? '🏆 ' : ''}${e(option)}</span>
          <span class="poll-count">${counts[index]}</span>
        </button></li>`;
      }).join('')}</ul>
      ${closed ? '' : `<footer>${myVote !== undefined ? `<button type="button" class="tools-link" data-unvote="${e(poll.id)}">Remove my vote</button>` : '<small>Tap an option to vote. You can change it until the poll closes.</small>'}
        ${manage ? `<button type="button" class="project-btn" data-close-poll="${e(poll.id)}"><span class="material-symbols-outlined">gavel</span> Close & record decision</button>` : ''}</footer>`}
      ${manage ? `<button type="button" class="team-icon-btn tools-delete" data-delete-poll="${e(poll.id)}" title="Delete poll" aria-label="Delete poll"><span class="material-symbols-outlined">delete</span></button>` : ''}
    </article>`;
  };

  section.innerHTML = `
    <div class="project-section-head">
      <div><h2>Decisions</h2><p class="team-intro">Vote on open questions, and keep a record of what the team decided and why, so nobody argues the same thing twice.</p></div>
      ${editable ? '<div class="project-head-actions"><button type="button" class="project-btn" data-new-poll><span class="material-symbols-outlined">ballot</span> New poll</button><button type="button" class="project-btn primary" data-new-decision><span class="material-symbols-outlined">gavel</span> Record decision</button></div>' : ''}
    </div>
    <div class="decisions-layout">
      <section>
        <h3 class="tools-subhead">Polls</h3>
        ${polls.length ? polls.map(pollCard).join('') : `<p class="tools-empty">${editable ? 'Not sure which option to pick? Start a poll and let the team vote.' : 'No polls yet.'}</p>`}
      </section>
      <section>
        <h3 class="tools-subhead">Decision log</h3>
        ${decisions.length ? `<ol class="decision-list">${decisions.map((decision) => `<li>
          <span class="material-symbols-outlined decision-icon" aria-hidden="true">${decision.poll_id ? 'how_to_vote' : 'gavel'}</span>
          <div><strong>${e(decision.title)}</strong>${decision.details ? `<p>${e(decision.details)}</p>` : ''}<small>${e(personName(decision.author))} · ${e(shortDate(decision.created_at))}</small></div>
          ${canManageItem(decision, { userId: me, role }) ? `<button type="button" class="team-icon-btn" data-delete-decision="${e(decision.id)}" title="Delete decision" aria-label="Delete decision"><span class="material-symbols-outlined">delete</span></button>` : ''}
        </li>`).join('')}</ol>` : '<p class="tools-empty">No decisions recorded yet. Close a poll or record one directly.</p>'}
      </section>
    </div>`;

  const rerender = () => renderDecisionsTab(section, ctx);
  const pollById = (id) => polls.find((poll) => poll.id === id);
  section.querySelector('[data-new-poll]')?.addEventListener('click', async () => {
    const values = await requestForm({
      title: 'New poll',
      description: 'Ask the team a question with 2 to 6 options.',
      submitLabel: 'Start poll',
      fields: [
        { name: 'question', label: 'Question', required: true, placeholder: 'e.g. Which map provider should we use?', maxLength: 200 },
        { name: 'options', label: 'Options (one per line)', type: 'textarea', required: true, placeholder: 'Google Maps\nOpenStreetMap' }
      ]
    });
    if (!values) return;
    const options = values.options.split('\n').map((option) => option.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 6) return showToast('A poll needs between 2 and 6 options (one per line).', 'error');
    const { error } = await createPoll({ workspaceId, projectId: project.id, question: values.question, options });
    if (error) return showToast(`Could not start the poll: ${error.message}`, 'error');
    showToast('Poll started', 'success');
    rerender();
  });
  section.querySelector('[data-new-decision]')?.addEventListener('click', async () => {
    const values = await requestForm({
      title: 'Record a decision',
      submitLabel: 'Save decision',
      fields: [
        { name: 'title', label: 'What did you decide?', required: true, placeholder: 'e.g. Email login first, Google sign-in later', maxLength: 200 },
        { name: 'details', label: 'Why? (optional)', type: 'textarea', placeholder: 'e.g. Faster to build; Google login needs extra setup.' }
      ]
    });
    if (!values?.title) return;
    const { error } = await createDecision({ workspaceId, projectId: project.id, title: values.title, details: values.details });
    if (error) return showToast(`Could not save the decision: ${error.message}`, 'error');
    showToast('Decision recorded', 'success');
    rerender();
  });
  section.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await vote(button.dataset.vote, me, Number(button.dataset.option));
    if (error) return showToast(`Could not vote: ${error.message}`, 'error');
    rerender();
  }));
  section.querySelectorAll('[data-unvote]').forEach((button) => button.addEventListener('click', async () => {
    const { error } = await removeVote(button.dataset.unvote, me);
    if (error) return showToast(`Could not remove your vote: ${error.message}`, 'error');
    rerender();
  }));
  section.querySelectorAll('[data-close-poll]').forEach((button) => button.addEventListener('click', async () => {
    const poll = pollById(button.dataset.closePoll);
    if (!await requestConfirmation(`Close “${poll.question}”? Voting stops and the winning option is saved as a decision.`)) return;
    const result = await closePoll(poll, { workspaceId });
    if (result.error) return showToast(`Could not close the poll: ${result.error.message}`, 'error');
    showToast(result.decision ? `Decided: ${result.decision}` : result.tie ? 'Poll closed. It’s a tie, so record the decision yourself.' : 'Poll closed (no votes).', result.decision ? 'success' : 'error');
    rerender();
  }));
  section.querySelectorAll('[data-delete-poll]').forEach((button) => button.addEventListener('click', async () => {
    if (!await requestConfirmation('Delete this poll and its votes?')) return;
    const { error } = await deletePoll(button.dataset.deletePoll);
    if (error) return showToast(`Could not delete it: ${error.message}`, 'error');
    rerender();
  }));
  section.querySelectorAll('[data-delete-decision]').forEach((button) => button.addEventListener('click', async () => {
    if (!await requestConfirmation('Delete this decision from the log?')) return;
    const { error } = await deleteDecision(button.dataset.deleteDecision);
    if (error) return showToast(`Could not delete it: ${error.message}`, 'error');
    rerender();
  }));

  // Live: votes from teammates appear without reloading.
  if (!section.__live) {
    const channel = supabase.channel(`decisions-${project.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_poll_votes' }, () => {
        if (!section.isConnected) return;
        invalidateQueryCache('teamtools');
        rerender();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_polls', filter: `project_id=eq.${project.id}` }, () => {
        if (!section.isConnected) return;
        invalidateQueryCache('teamtools');
        rerender();
      })
      .subscribe();
    section.__live = channel;
    window.addEventListener('hashchange', function stop() {
      window.setTimeout(() => {
        if (section.isConnected) return;
        supabase.removeChannel(channel);
        section.__live = null;
        window.removeEventListener('hashchange', stop);
      }, 1500);
    });
  }
}

// ---------------------------------------------------------------- Resources
export async function renderResources(el, ctx) {
  const { project, role, workspaceId } = ctx;
  const me = AppState.user?.id;
  const { data: resources, unavailable, error } = await getResources(project.id);
  if (!el.isConnected) return;
  if (unavailable) { el.innerHTML = `<div class="project-section-head"><h2>Resources</h2></div>${unavailableHint}`; return; }
  if (error) { el.innerHTML = `<p class="tools-error">${e(error.message)}</p>`; return; }
  const editable = canAdd(role);
  const tags = [...new Set(resources.map((resource) => resource.tag).filter(Boolean))].sort();
  const active = el.__tag && tags.includes(el.__tag) ? el.__tag : '';
  const shown = active ? resources.filter((resource) => resource.tag === active) : resources;
  el.innerHTML = `
    <div class="project-section-head">
      <div><h2>Resources</h2><p class="team-intro">Links, references and notes the team needs, in one place.</p></div>
      ${editable ? '<button type="button" class="project-btn primary" data-add-resource><span class="material-symbols-outlined">add_link</span> Add resource</button>' : ''}
    </div>
    ${tags.length ? `<div class="resource-tags" role="group" aria-label="Filter by topic"><button type="button" data-tag="" aria-pressed="${!active}">All (${resources.length})</button>${tags.map((tag) => `<button type="button" data-tag="${e(tag)}" aria-pressed="${active === tag}">${e(tag)}</button>`).join('')}</div>` : ''}
    ${shown.length ? `<div class="resource-grid">${shown.map((resource) => `<article class="resource-card">
      <span class="material-symbols-outlined resource-icon" aria-hidden="true">${resource.url ? 'link' : 'sticky_note_2'}</span>
      <div class="resource-main">
        ${resource.url && isSafeUrl(resource.url) ? `<a href="${e(resource.url)}" target="_blank" rel="noopener noreferrer"><strong>${e(resource.title)}</strong></a><small class="resource-host">${e((() => { try { return new URL(resource.url).hostname; } catch { return ''; } })())}</small>` : `<strong>${e(resource.title)}</strong>`}
        ${resource.note ? `<p>${e(resource.note)}</p>` : ''}
        <small>${resource.tag ? `<span class="resource-tag">${e(resource.tag)}</span> · ` : ''}${e(personName(resource.author))} · ${e(shortDate(resource.created_at))}</small>
      </div>
      ${canManageItem(resource, { userId: me, role }) ? `<button type="button" class="team-icon-btn" data-delete-resource="${e(resource.id)}" title="Delete" aria-label="Delete ${e(resource.title)}"><span class="material-symbols-outlined">delete</span></button>` : ''}
    </article>`).join('')}</div>` : `<p class="tools-empty">${editable ? 'Add the brief, useful links, papers, designs or tools your team uses.' : 'No resources yet.'}</p>`}`;

  const rerender = () => renderResources(el, ctx);
  el.querySelectorAll('[data-tag]').forEach((button) => button.addEventListener('click', () => { el.__tag = button.dataset.tag; rerender(); }));
  el.querySelector('[data-add-resource]')?.addEventListener('click', async () => {
    const values = await requestForm({
      title: 'Add a resource',
      submitLabel: 'Add',
      fields: [
        { name: 'title', label: 'Name', required: true, placeholder: 'e.g. Campus map (PDF)', maxLength: 200 },
        { name: 'url', label: 'Link (optional)', placeholder: 'https://…' },
        { name: 'tag', label: 'Topic (optional)', placeholder: 'e.g. Research, Design, Tools', maxLength: 40, value: active, half: true },
        { name: 'note', label: 'Note (optional)', type: 'textarea', placeholder: 'Why it’s useful' }
      ]
    });
    if (!values?.title) return;
    if (values.url && !isSafeUrl(values.url)) return showToast('Links must start with http:// or https://', 'error');
    const { error: addError } = await createResource({ workspaceId, projectId: project.id, title: values.title, url: values.url, tag: values.tag, note: values.note });
    if (addError) return showToast(`Could not add it: ${addError.message}`, 'error');
    showToast('Resource added', 'success');
    rerender();
  });
  el.querySelectorAll('[data-delete-resource]').forEach((button) => button.addEventListener('click', async () => {
    if (!await requestConfirmation('Delete this resource?')) return;
    const { error: deleteError } = await deleteResource(button.dataset.deleteResource);
    if (deleteError) return showToast(`Could not delete it: ${deleteError.message}`, 'error');
    rerender();
  }));
}

// ---------------------------------------------------------------- Workload
// Remaining work per person: each open task counts by what's left (100% - progress).
export function workloadRows(tasks = [], members = [], teams = []) {
  const today = todayKey();
  const soon = todayKey(new Date(Date.now() + 7 * 86400000));
  const rows = new Map();
  const ensure = (userId) => {
    if (!rows.has(userId)) rows.set(userId, { userId, name: personName(members.find((member) => member.user_id === userId)?.user), open: 0, dueSoon: 0, overdue: 0, remaining: 0, teams: new Set() });
    return rows.get(userId);
  };
  teams.forEach((team) => (team.members || []).forEach((member) => ensure(member.user_id).teams.add(team.name)));
  tasks.filter((task) => task.assignee_id && task.status !== 'done' && !task.completed).forEach((task) => {
    const row = ensure(task.assignee_id);
    row.open += 1;
    row.remaining += (100 - taskProgress(task)) / 100;
    if (task.due_date && task.due_date < today) row.overdue += 1;
    else if (task.due_date && task.due_date <= soon) row.dueSoon += 1;
  });
  const list = [...rows.values()].sort((a, b) => b.remaining - a.remaining);
  const average = list.length ? list.reduce((sum, row) => sum + row.remaining, 0) / list.length : 0;
  return list.map((row) => ({ ...row, teams: [...row.teams], overloaded: list.length > 1 && row.open >= 3 && row.remaining > average * 1.5, light: list.length > 1 && row.remaining < average * 0.5 }));
}

export function renderWorkload(el, ctx) {
  const { project, tasks, members, teams } = ctx;
  const rows = workloadRows(tasks, members, teams);
  if (!rows.length) { el.innerHTML = ''; return; }
  const max = Math.max(1, ...rows.map((row) => row.remaining));
  const unbalanced = rows.some((row) => row.overloaded);
  el.innerHTML = `
    <div class="project-section-head">
      <div><h2>Workload</h2><p class="team-intro">Open work per person (half-done tasks count as half). ${unbalanced ? '<strong class="is-warn">Some people have much more than others.</strong>' : 'Looks balanced.'}</p></div>
      ${rows.length > 1 ? '<button type="button" class="project-btn" data-rebalance><span class="material-symbols-outlined">auto_awesome</span> Suggest a fairer split</button>' : ''}
    </div>
    <ul class="workload-list">${rows.map((row) => `<li class="${row.overloaded ? 'is-heavy' : row.light ? 'is-light' : ''}">
      <span class="workload-name">${e(row.name)}${row.teams.length ? `<small>${e(row.teams.join(', '))}</small>` : ''}</span>
      <span class="workload-bar"><i style="width:${Math.round((row.remaining / max) * 100)}%"></i></span>
      <span class="workload-numbers">${row.open} open${row.dueSoon ? ` · ${row.dueSoon} due soon` : ''}${row.overdue ? ` · <b>${row.overdue} late</b>` : ''}</span>
      ${row.overloaded ? '<span class="workload-flag">Overloaded</span>' : row.light ? '<span class="workload-flag is-light">Has room</span>' : ''}
    </li>`).join('')}</ul>`;
  el.querySelector('[data-rebalance]')?.addEventListener('click', () => {
    const facts = rows.map((row) => `${row.name}: ${row.open} open tasks, about ${row.remaining.toFixed(1)} tasks of work left${row.overdue ? `, ${row.overdue} late` : ''}${row.teams.length ? ` (teams: ${row.teams.join(', ')})` : ''}`).join('\n');
    askAI(`The workload in the project “${project.title}” is uneven:\n${facts}\n\nSuggest a fairer split: propose update_task actions that change the owner of a few open tasks from the busiest people to people with room. Only move a task to someone in the same team as that task (or, for tasks without a team, to any member). Do not move tasks that are almost done. In "reply", explain each move in one short line.`, project.id);
  });
}
