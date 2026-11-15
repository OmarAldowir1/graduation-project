import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, formatSnapshot, validateAgentOutput, needsTaskFollowUp, mergeTaskFollowUp, taskFollowUpPrompt, parseTaskLines } from '../supabase/functions/_shared/agentContract.js';
import { markdownToHtml } from '../src/lib/markdown.js';

const snapshot = validateSnapshot({
  team: 'Team A', me: 'U1', today: '2026-11-08',
  members: [{ ref: 'U1', name: 'Omar', role: 'owner' }, { ref: 'U2', name: 'Sara', role: 'editor' }],
  projects: [{ ref: 'P1', title: 'Launch', done: 1, total: 3, plan: 'G1' }],
  pages: [{ ref: 'G1', title: 'Launch', project: 'P1' }, { ref: 'G2', title: 'Notes', project: null }],
  tasks: [{ ref: 'T1', title: 'Write copy', status: 'todo', priority: 'high', due: '2026-11-10', owner: 'U2', project: 'P1' }]
});

test('formats a readable context with refs', () => {
  const text = formatSnapshot(snapshot);
  assert.match(text, /THE USER IS: U1/);
  assert.match(text, /T1 "Write copy" \[todo, 0%, high, due 2026-11-10, owner U2, P1\]/);
});

test('rejects malformed snapshots', () => {
  assert.throws(() => validateSnapshot(null));
  assert.throws(() => validateSnapshot({ tasks: new Array(400).fill({ ref: 'T1' }) }));
});

test('keeps valid actions and resolves NEW refs in order', () => {
  const out = validateAgentOutput(JSON.stringify({
    reply: 'Creating it.',
    actions: [
      { type: 'create_project', ref: 'NEW1', title: 'Trip', template: 'team' },
      { type: 'create_task', title: 'Book hotel', project: 'NEW1', owner: 'U2', due: '2026-11-20', priority: 'high' },
      { type: 'update_task', task: 'T1', status: 'done', owner: 'none' },
      { type: 'comment', page: 'G2', text: 'Please review', mention: ['U2', 'U9'] },
      { type: 'open', target: 'NEW1' }
    ]
  }), snapshot);
  assert.equal(out.actions.length, 5);
  assert.deepEqual(out.actions[3].mention, ['U2']);
  assert.equal(out.actions[2].owner, 'none');
  assert.equal(out.dropped.length, 0);
});

test('drops invented ids, unknown types and forward NEW refs', () => {
  const out = validateAgentOutput({
    reply: 'ok',
    actions: [
      { type: 'create_task', title: 'X', project: 'P9' },
      { type: 'create_task', title: 'Y', owner: 'U7' },
      { type: 'delete_everything' },
      { type: 'create_task', title: 'Z', project: 'NEW1' },
      { type: 'update_task', task: 'T1' },
      { type: 'append_to_page', page: 'G1', content: '  ' }
    ]
  }, snapshot);
  assert.equal(out.actions.length, 0);
  assert.equal(out.dropped.length, 6);
});

test('accepts plain-text model output as a reply', () => {
  const out = validateAgentOutput('You have 1 open task.', snapshot);
  assert.equal(out.reply, 'You have 1 open task.');
  assert.deepEqual(out.actions, []);
  const fenced = validateAgentOutput('```json\n{"reply":"hi","actions":[],"read":["G2","G99"]}\n```', snapshot);
  assert.deepEqual(fenced.read, ['G2']);
});

test('converts markdown safely', () => {
  const html = markdownToHtml('# Title\n- [ ] todo <b>\n- [x] done\n\n1. one\n2. two\n\n**bold** and `code`\n<script>alert(1)</script>');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul class="editor-todo-list"><li><label><input type="checkbox" {2}\/> <span>todo &lt;b&gt;<\/span>/);
  assert.match(html, /checked/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<strong>bold<\/strong> and <code>code<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/ul class/);
});

const teamSnapshot = validateSnapshot({
  team: 'Team A', me: 'U2', today: '2026-11-08',
  members: [{ ref: 'U1', name: 'Omar', role: 'owner' }, { ref: 'U2', name: 'Sara', role: 'editor' }, { ref: 'U3', name: 'Ali', role: 'editor' }],
  projects: [{ ref: 'P1', title: 'Launch', done: 0, total: 1, plan: 'G1' }],
  teams: [{ ref: 'M1', name: 'Design', project: 'P1', leader: 'U1', members: ['U1', 'U3'], progress: 40, canManage: false }],
  pages: [{ ref: 'G1', title: 'Launch', project: 'P1' }],
  tasks: [{ ref: 'T1', title: 'Logo', status: 'in_progress', priority: 'high', owner: 'U3', project: 'P1', team: 'M1', progress: 40 }]
});

test('shows teams, leaders, progress and edit rights in the context', () => {
  const text = formatSnapshot(teamSnapshot);
  assert.match(text, /M1 "Design" in P1, leader U1, members U1 U3, 40% done, THE USER CANNOT EDIT/);
  assert.match(text, /T1 "Logo" \[in_progress, 40%, high, owner U3, P1, team M1\]/);
});

test('builds a team plan: project, teams with leaders, then team tasks', () => {
  const out = validateAgentOutput(JSON.stringify({
    reply: 'Here is the plan.',
    actions: [
      { type: 'create_project', ref: 'NEW1', title: 'Graduation', template: 'blank' },
      { type: 'create_team', ref: 'NEW2', project: 'NEW1', name: 'Backend', leader: 'U2', members: ['U2', 'U3', 'U99'], color: 'teal' },
      { type: 'create_task', title: 'Design the database', team: 'NEW2', project: 'NEW1', owner: 'U3', due: '2026-12-01', progress: 0 },
      { type: 'create_team', project: 'P9', name: 'Ghost' },
      { type: 'update_task', task: 'T1', progress: 80 },
      { type: 'update_task', task: 'T1', team: 'none' },
      { type: 'update_team', team: 'M1', leader: 'U3' }
    ]
  }), teamSnapshot);
  assert.equal(out.actions.length, 6);
  assert.deepEqual(out.actions[1].members, ['U2', 'U3']);
  assert.equal(out.actions[2].team, 'NEW2');
  assert.equal(out.actions[2].progress, 0);
  assert.equal(out.actions[3].progress, 80);
  assert.equal(out.actions[4].team, 'none');
  assert.equal(out.actions[5].leader, 'U3');
  assert.match(out.dropped.join(' '), /create_team: unknown project/);
});

test('allows big plans of up to 40 actions', () => {
  const actions = Array.from({ length: 45 }, (_, index) => ({ type: 'create_task', title: `Task ${index}`, project: 'P1' }));
  assert.equal(validateAgentOutput(JSON.stringify({ reply: 'ok', actions }), teamSnapshot).actions.length, 40);
});

test('keeps task steps as a short checklist and asks for real plans', () => {
  const out = validateAgentOutput(JSON.stringify({
    reply: 'Created your plan.',
    actions: [
      { type: 'create_project', ref: 'NEW1', title: 'Restaurant booking website', template: 'blank' },
      { type: 'create_task', title: 'Design the booking form', project: 'NEW1', owner: 'U1', steps: ['List the fields', '', 'Sketch the layout', 42, ...Array(10).fill('extra step')] }
    ]
  }), snapshot);
  assert.equal(out.actions.length, 2);
  assert.deepEqual(out.actions[1].steps.slice(0, 3), ['List the fields', 'Sketch the layout', '42']);
  assert.equal(out.actions[1].steps.length, 8);
});

test('asks again for tasks when a plan comes back without any', () => {
  const planOnly = { reply: 'Created a plan and 12 tasks.', actions: [
    { type: 'create_project', ref: 'NEW1', title: 'Restaurant booking website', template: 'blank' },
    { type: 'create_page', title: 'Plan', project: 'NEW1', content: '# Plan' }
  ] };
  assert.equal(needsTaskFollowUp('plan all of the tasks for my restaurant website', planOnly), true);
  assert.equal(needsTaskFollowUp('what is overdue?', planOnly), false);
  assert.equal(needsTaskFollowUp('plan it', { actions: [...planOnly.actions, { type: 'create_task', title: 'x' }] }), true);
  const six = Array.from({ length: 6 }, (_, i) => ({ type: 'create_task', title: `t${i}` }));
  assert.equal(needsTaskFollowUp('plan it', { actions: [...planOnly.actions, ...six] }), false);
  const deduped = mergeTaskFollowUp({ actions: [{ type: 'create_task', title: 'Design the form' }] }, { actions: [{ type: 'create_task', title: 'design the form ' }, { type: 'create_task', title: 'Build the API' }] });
  assert.deepEqual(deduped.actions.map((a) => a.title), ['Design the form', 'Build the API']);
  assert.match(taskFollowUpPrompt(planOnly), /TASK: <title> \| <due date/);
  const merged = mergeTaskFollowUp(planOnly, { actions: [{ type: 'create_task', title: 'Design the booking form', project: 'NEW1', owner: 'U1' }, { type: 'comment', page: 'G1', text: 'ignored' }] });
  const out = validateAgentOutput(merged, snapshot);
  assert.deepEqual(out.actions.map((a) => a.type), ['create_project', 'create_page', 'create_task']);
});

test('recovers actions the model put under garbled keys', () => {
  const garbled = { reply: 'Plan ready.', actions: [{ type: 'create_project', ref: 'NEW1', title: 'Restaurant site' }],
    "actions':[{": { type: 'create_task', title: 'Research the stack', project: 'NEW1', owner: 'U1' },
    extra: [{ type: 'create_task', title: 'Deploy the website', project: 'NEW1' }, { type: 'drop_database' }] };
  const out = validateAgentOutput(garbled, snapshot);
  assert.deepEqual(out.actions.map((a) => a.title), ['Restaurant site', 'Research the stack', 'Deploy the website']);
});

test('reads plain-text task lines from the follow-up', () => {
  const text = `Here you go:
TASK: Design the booking form | 2026-11-20 | high | U1 | Form for date, time and party size | Pick fields; Sketch layout; Review
- TASK: Build the reservations API | 2026-11-27 | urgent | u1 | Save and list bookings | Model tables; Write endpoints
TASK: Deploy the site | 2026-12-15 | medium | someone | Put it online |
Not a task line`;
  const tasks = parseTaskLines(text, 'NEW1');
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks[0], { type: 'create_task', title: 'Design the booking form', project: 'NEW1', due: '2026-11-20', priority: 'high', owner: 'U1', description: 'Form for date, time and party size', steps: ['Pick fields', 'Sketch layout', 'Review'] });
  assert.equal(tasks[1].owner, 'U1');
  assert.equal(tasks[2].owner, undefined);
  const out = validateAgentOutput({ reply: 'ok', actions: [{ type: 'create_project', ref: 'NEW1', title: 'Site' }, ...tasks] }, snapshot);
  assert.equal(out.actions.filter((a) => a.type === 'create_task').length, 3);
});

test('reads steps written as one "a; b; c" string', () => {
  const out = validateAgentOutput({ reply: 'ok', actions: [{ type: 'create_task', title: 'Plan features', owner: 'U1', steps: 'Brainstorm features; Prioritize; Write the list' }] }, snapshot);
  assert.deepEqual(out.actions[0].steps, ['Brainstorm features', 'Prioritize', 'Write the list']);
});

test('records milestones and decisions in a project (or from its meeting page)', () => {
  const out = validateAgentOutput({ reply: 'ok', actions: [
    { type: 'create_milestone', project: 'P1', title: 'Prototype demo', due: '2026-12-01' },
    { type: 'create_decision', page: 'G1', title: 'Use email login first', details: 'Faster to build.' },
    { type: 'create_project', ref: 'NEW1', title: 'Thesis' },
    { type: 'create_milestone', project: 'NEW1', title: 'Final presentation', due: '2027-01-10' },
    { type: 'create_milestone', project: 'P1', title: 'No date' },
    { type: 'create_milestone', project: 'P9', title: 'Ghost', due: '2026-12-01' },
    { type: 'create_decision', page: 'G2', title: 'Page outside any project' },
    { type: 'create_decision', project: 'P1', title: '  ' }
  ] }, snapshot);
  assert.deepEqual(out.actions.map((a) => a.type), ['create_milestone', 'create_decision', 'create_project', 'create_milestone']);
  assert.equal(out.actions[1].project, 'P1');
  assert.equal(out.actions[1].details, 'Faster to build.');
  assert.equal(out.actions[3].project, 'NEW1');
  assert.deepEqual(out.dropped, ['create_milestone: missing date', 'create_milestone: unknown project', 'create_decision: unknown project', 'create_decision: missing title']);
});
