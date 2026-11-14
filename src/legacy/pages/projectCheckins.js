// ============================================
// GROUPIFY — Project › Check-ins tab
// Once a week: what I did, what's next, what's blocking me (+ mood).
// ============================================
import { AppState, showToast } from '../app.js';
import { supabase } from '../../lib/supabase.js';
import { escapeHtml } from '../../lib/sanitize.js';
import { requestConfirmation } from '../../lib/dialogs.js';
import {
  MOODS, weekStart, shiftWeek, weekLabel, getCheckins, saveCheckin, deleteCheckin, expectedPeople, blockersOf
} from '../../lib/checkins.js';

function personName(user, fallback = 'Teammate') {
  return user?.name || user?.email?.split('@')[0] || fallback;
}

function face(user, size = 32) {
  const name = personName(user);
  const url = /^https?:\/\//i.test(user?.avatar_url || '') ? user.avatar_url : '';
  return url
    ? `<img class="checkin-face" style="width:${size}px;height:${size}px" src="${escapeHtml(url)}" alt="" />`
    : `<span class="checkin-face" style="width:${size}px;height:${size}px">${escapeHtml(name.trim().slice(0, 1).toUpperCase())}</span>`;
}

function paragraph(text) {
  return escapeHtml(text).replace(/\n/g, '<br />');
}

export async function renderCheckinsTab(section, ctx) {
  const { project, tasks, teams, members, workspaceId } = ctx;
  const me = AppState.user?.id;
  const currentWeek = weekStart();
  const week = section.__week && section.__week <= currentWeek ? section.__week : currentWeek;
  section.__week = week;
  const isCurrent = week === currentWeek;

  section.innerHTML = '<div class="checkins-loading">Loading check-ins…</div>';
  const { data: checkins, error, unavailable } = await getCheckins({ projectId: project.id, weeks: [week] });
  if (!section.isConnected) return;
  if (unavailable) {
    section.innerHTML = '<div class="project-hint"><span class="material-symbols-outlined">construction</span><div><strong>Check-ins aren’t set up yet</strong><p>Run <code>sql/checkins.sql</code> in Supabase to turn on weekly check-ins.</p></div></div>';
    return;
  }
  if (error) {
    section.innerHTML = `<div class="project-hint"><span class="material-symbols-outlined">error</span><div><strong>Check-ins could not load</strong><p>${escapeHtml(error.message)}</p></div></div>`;
    return;
  }

  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const expected = expectedPeople(tasks, teams);
  const mine = checkins.find((checkin) => checkin.user_id === me) || null;
  const others = checkins.filter((checkin) => checkin.user_id !== me);
  const answered = new Set(checkins.map((checkin) => checkin.user_id));
  const waiting = [...expected].filter((id) => !answered.has(id));
  const blockers = blockersOf(checkins);
  const moodCounts = [3, 2, 1].map((value) => ({ value, count: checkins.filter((checkin) => checkin.mood === value).length })).filter((item) => item.count);
  const editing = isCurrent && (!mine || section.__editing);

  const answerCard = (checkin, own = false) => {
    const user = checkin.user || memberById.get(checkin.user_id)?.user;
    const mood = MOODS[checkin.mood];
    return `
      <article class="checkin-card ${checkin.blockers ? 'has-blocker' : ''}">
        <header>
          ${face(user)}
          <div class="checkin-card-who"><strong>${escapeHtml(personName(user))}${own ? ' <em>(you)</em>' : ''}</strong><small>${escapeHtml(new Date(checkin.updated_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}</small></div>
          ${mood ? `<span class="checkin-mood" title="${escapeHtml(mood.label)}">${mood.emoji}</span>` : ''}
          ${own && isCurrent ? '<button type="button" class="team-icon-btn" data-edit-checkin title="Edit your check-in" aria-label="Edit your check-in"><span class="material-symbols-outlined">edit</span></button>' : ''}
        </header>
        ${checkin.done ? `<div class="checkin-answer"><span>Done</span><p>${paragraph(checkin.done)}</p></div>` : ''}
        ${checkin.next ? `<div class="checkin-answer"><span>Next</span><p>${paragraph(checkin.next)}</p></div>` : ''}
        ${checkin.blockers ? `<div class="checkin-answer is-blocker"><span>🚧 Blocked by</span><p>${paragraph(checkin.blockers)}</p></div>` : ''}
      </article>`;
  };

  const form = `
    <form class="checkin-form" data-checkin-form>
      <div class="checkin-form-head">
        <div><h3>${mine ? 'Edit your check-in' : 'Your check-in for this week'}</h3><p>Two minutes. Your team and leader will see it.</p></div>
        <div class="checkin-moods" role="radiogroup" aria-label="How is your week going?">
          ${[3, 2, 1].map((value) => `<button type="button" role="radio" data-mood="${value}" aria-checked="${mine?.mood === value}" title="${MOODS[value].label}">${MOODS[value].emoji}</button>`).join('')}
        </div>
      </div>
      <label><span>What did you get done?</span><textarea name="done" rows="3" maxlength="2000" placeholder="e.g. Finished the login page and reviewed Sara’s design">${escapeHtml(mine?.done || '')}</textarea></label>
      <label><span>What will you work on next?</span><textarea name="next" rows="3" maxlength="2000" placeholder="e.g. Connect the login page to the database">${escapeHtml(mine?.next || '')}</textarea></label>
      <label><span>Anything blocking you? <small>(optional)</small></span><textarea name="blockers" rows="2" maxlength="2000" placeholder="e.g. Waiting for the API keys from Ahmed">${escapeHtml(mine?.blockers || '')}</textarea></label>
      <div class="checkin-form-actions">
        ${mine ? '<button type="button" class="gs-btn gs-btn-ghost" data-cancel-edit>Cancel</button><button type="button" class="gs-btn gs-btn-danger" data-delete-checkin>Delete</button>' : ''}
        <button type="submit" class="gs-btn gs-btn-primary">${mine ? 'Save changes' : 'Share check-in'}</button>
      </div>
    </form>`;

  section.innerHTML = `
    <div class="project-section-head">
      <div><h2>Weekly check-ins</h2><p class="team-intro">Once a week everyone shares what they did, what’s next and what’s blocking them. Blockers show up in the Progress report.</p></div>
      <div class="checkin-week">
        <button type="button" class="team-icon-btn" data-week="-1" aria-label="Previous week"><span class="material-symbols-outlined">chevron_left</span></button>
        <strong>${isCurrent ? 'This week' : 'Week of'} · ${escapeHtml(weekLabel(week))}</strong>
        <button type="button" class="team-icon-btn" data-week="1" ${isCurrent ? 'disabled' : ''} aria-label="Next week"><span class="material-symbols-outlined">chevron_right</span></button>
      </div>
    </div>
    <div class="checkin-summary">
      <span><strong>${checkins.length}</strong>${expected.size ? ` of ${new Set([...expected, ...answered]).size}` : ''} checked in</span>
      ${blockers.length ? `<span class="is-blocker">🚧 <strong>${blockers.length}</strong> blocker${blockers.length === 1 ? '' : 's'}</span>` : '<span>No blockers</span>'}
      ${moodCounts.length ? `<span>${moodCounts.map((item) => `${MOODS[item.value].emoji} ${item.count}`).join(' · ')}</span>` : ''}
    </div>
    ${editing ? form : ''}
    <div class="checkin-grid">
      ${mine && !editing ? answerCard(mine, true) : ''}
      ${others.map((checkin) => answerCard(checkin)).join('')}
    </div>
    ${!checkins.length && !editing ? `<div class="team-empty-state"><span class="material-symbols-outlined">event_note</span><h3>No check-ins for this week</h3><p>Nobody shared a check-in for ${escapeHtml(weekLabel(week))}.</p></div>` : ''}
    ${waiting.length && isCurrent ? `<div class="checkin-waiting"><span>Still to check in:</span>${waiting.map((id) => `<span class="checkin-chip">${face(memberById.get(id)?.user, 20)}${escapeHtml(personName(memberById.get(id)?.user, 'Former member'))}${id === me ? ' (you)' : ''}</span>`).join('')}</div>` : ''}`;

  const rerender = () => renderCheckinsTab(section, ctx);
  section.querySelectorAll('[data-week]').forEach((button) => button.addEventListener('click', () => {
    section.__week = shiftWeek(week, Number(button.dataset.week));
    section.__editing = false;
    rerender();
  }));
  section.querySelector('[data-edit-checkin]')?.addEventListener('click', () => { section.__editing = true; rerender(); });
  section.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { section.__editing = false; rerender(); });

  const formEl = section.querySelector('[data-checkin-form]');
  if (formEl) {
    let mood = mine?.mood || null;
    formEl.querySelectorAll('[data-mood]').forEach((button) => button.addEventListener('click', () => {
      mood = Number(button.dataset.mood) === mood ? null : Number(button.dataset.mood);
      formEl.querySelectorAll('[data-mood]').forEach((other) => other.setAttribute('aria-checked', String(Number(other.dataset.mood) === mood)));
    }));
    formEl.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(['done', 'next', 'blockers'].map((name) => [name, formEl.elements[name].value.trim()]));
      if (!values.done && !values.next && !values.blockers) { showToast('Write at least one answer first.', 'error'); return; }
      const submit = formEl.querySelector('button[type=submit]');
      submit.disabled = true;
      const { error: saveError } = await saveCheckin({ workspaceId, projectId: project.id, userId: me, week, mood, ...values });
      submit.disabled = false;
      if (saveError) { showToast(`Could not save your check-in: ${saveError.message}`, 'error'); return; }
      section.__editing = false;
      showToast(values.blockers ? 'Check-in shared. Your blocker is visible to the team.' : 'Check-in shared ✓', 'success');
      rerender();
    });
    formEl.querySelector('[data-delete-checkin]')?.addEventListener('click', async () => {
      if (!mine || !await requestConfirmation('Delete your check-in for this week?')) return;
      const { error: deleteError } = await deleteCheckin(mine.id);
      if (deleteError) { showToast(`Could not delete: ${deleteError.message}`, 'error'); return; }
      section.__editing = false;
      rerender();
    });
  }

  // Live: show teammates' check-ins as they arrive.
  if (!section.__live) {
    const channel = supabase.channel(`checkins-${project.id}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_checkins', filter: `project_id=eq.${project.id}` }, () => {
        if (!section.isConnected) { supabase.removeChannel(channel); section.__live = null; return; }
        if (!section.__editing && !section.querySelector('[data-checkin-form] textarea:focus')) rerender();
      })
      .subscribe();
    section.__live = channel;
    // Stop listening once the tab is gone (checked after each navigation settles).
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
