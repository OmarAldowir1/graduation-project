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
  assert.match(text, /T1 "Write copy" \[todo, high, due 2026-11-10, owner U2, P1\]/);
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
  assert.match(html, /<ul class="editor-todo-list"><li><label><input type="checkbox"  \/> <span>todo &lt;b&gt;<\/span>/);
  assert.match(html, /checked/);
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(html, /<strong>bold<\/strong> and <code>code<\/code>/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<\/ul class/);
});
