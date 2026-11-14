import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, formatSnapshot, validateAgentOutput } from '../supabase/functions/_shared/agentContract.js';
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
