import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAgenda, isValidDate, matchOwner, extractJsonObject, parseMeetingResponse, fallbackProposal,
  buildMeetingRequest, buildNotesText, buildMinutesHtml, MAX_TASKS, MAX_TASK_TITLE, MAX_NOTES_CHARS, MAX_PROMPT_CHARS
} from '../src/lib/meetingAI.js';

const members = [
  { user_id: 'u1', user: { id: 'u1', name: 'Ana Lopez' } },
  { user_id: 'u2', user: { id: 'u2', name: 'Omar Haddad' } },
  { user_id: 'u3', user: { id: 'u3', name: 'omar Farouk' } },
  { user_id: 'u4', user: { id: 'u4', name: 'Lina' } }
];
const agenda = [
  { id: 'item-1', title: 'Status', minutes: 5 },
  { id: 'item-2', title: 'Budget', minutes: 10 }
];
const note = (id, item_id, kind, body, author_id = 'u1') => ({ id, item_id, kind, body, author_id, created_at: '2026-11-14T10:00:00Z' });

test('parses agenda lines with minutes, defaults and bullets', () => {
  assert.deepEqual(parseAgenda('Intro - 5\n\n- Budget review – 15 min\n2. Wrap up\nQ&A: 3m'), [
    { id: 'item-1', title: 'Intro', minutes: 5 },
    { id: 'item-2', title: 'Budget review', minutes: 15 },
    { id: 'item-3', title: 'Wrap up', minutes: 10 },
    { id: 'item-4', title: 'Q&A', minutes: 3 }
  ]);
  assert.equal(parseAgenda('Long - 999')[0].minutes, 240);
  assert.equal(parseAgenda('Zero - 0')[0].minutes, 1);
  assert.deepEqual(parseAgenda('   \n'), []);
});

test('validates calendar dates', () => {
  assert.equal(isValidDate('2026-11-20'), true);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('20-11-2026'), false);
  assert.equal(isValidDate('next Friday'), false);
  assert.equal(isValidDate(null), false);
});

test('maps owner names case-insensitively, unknown or ambiguous names stay unassigned', () => {
  assert.equal(matchOwner('ana lopez', members), 'u1');
  assert.equal(matchOwner('@LINA', members), 'u4');
  assert.equal(matchOwner('Ana', members), 'u1');
  assert.equal(matchOwner('Omar', members), null);
  assert.equal(matchOwner('Zed', members), null);
  assert.equal(matchOwner(null, members), null);
});

test('extracts JSON from code fences and surrounding text', () => {
  assert.deepEqual(extractJsonObject('Sure! ```json\n{"a": "x}"}\n``` hope that helps'), { a: 'x}' });
  assert.deepEqual(extractJsonObject('Notes {not json} then {"b": 1}'), { b: 1 });
  assert.equal(extractJsonObject('no json here'), null);
});

test('parses and cleans the AI reply', () => {
  const tasks = Array.from({ length: 20 }, (_, index) => ({ title: `Task ${index} ${'x'.repeat(index === 0 ? 300 : 0)}`, owner: 'OMAR HADDAD', due: '2026-11-20' }));
  tasks[1] = { title: 'Book the room', owner: 'Nobody', due: '2026-13-01' };
  tasks[2] = { title: '  ', owner: null, due: null };
  const reply = `Here is the result:\n\`\`\`json\n${JSON.stringify({ summary: 'We agreed on the budget.', decisions: ['Budget is 5k', 'Budget is 5k', ''], tasks })}\n\`\`\``;
  const result = parseMeetingResponse(reply, members);
  assert.equal(result.summary, 'We agreed on the budget.');
  assert.deepEqual(result.decisions, ['Budget is 5k']);
  assert.equal(result.tasks.length, MAX_TASKS);
  assert.ok(result.tasks[0].title.length <= MAX_TASK_TITLE);
  assert.deepEqual(result.tasks[0], { ...result.tasks[0], assigneeId: 'u2', owner: 'Omar Haddad', due: '2026-11-20' });
  assert.deepEqual(result.tasks[1], { title: 'Book the room', owner: '', assigneeId: null, due: null });
  assert.ok(result.tasks.every((task) => task.title.trim()));
});

test('returns null for unusable replies', () => {
  assert.equal(parseMeetingResponse('I cannot help with that.', members), null);
  assert.equal(parseMeetingResponse('{"summary": "", "decisions": [], "tasks": []}', members), null);
  assert.equal(parseMeetingResponse('{"summary": 1, "tasks": "nope"}', members), null);
});

test('local fallback uses decision and action notes', () => {
  const notes = [
    note('1', 'item-1', 'note', 'Website is live'),
    note('2', 'item-2', 'decision', 'Budget capped at 5k'),
    note('3', 'item-2', 'action', '@Ana Lopez: send the invoice'),
    note('4', 'item-2', 'action', '@lina call the venue'),
    note('5', 'item-2', 'action', 'Update the roadmap'),
    note('6', 'item-2', 'action', '@Zed check prices')
  ];
  const result = fallbackProposal({ agenda, notes, members });
  assert.deepEqual(result.decisions, ['Budget capped at 5k']);
  assert.deepEqual(result.tasks.map((task) => [task.title, task.assigneeId, task.due]), [
    ['send the invoice', 'u1', null],
    ['call the venue', 'u4', null],
    ['Update the roadmap', null, null],
    ['check prices', null, null]
  ]);
  assert.match(result.summary, /6 notes captured across 2 agenda items/);
  assert.equal(fallbackProposal({ agenda, notes: [], members }).tasks.length, 0);
});

test('builds a chat-mode request within the server limits', () => {
  const notes = Array.from({ length: 200 }, (_, index) => note(String(index), 'item-1', 'note', 'y'.repeat(900)));
  const body = buildMeetingRequest({
    meeting: { title: 'Weekly sync', agenda },
    notes,
    members: members.map((member) => ({ id: member.user_id, name: member.user.name })),
    today: '2026-11-14',
    authorName: () => 'Ana'
  });
  assert.equal(body.mode, 'chat');
  assert.deepEqual(Object.keys(body).sort(), ['attachment', 'mode', 'prompt']);
  assert.ok(body.prompt.length <= MAX_PROMPT_CHARS);
  assert.match(body.prompt, /2026-11-14/);
  assert.match(body.prompt, /Omar Haddad/);
  assert.match(body.prompt, /```json code block/);
  assert.ok(body.attachment.content.length <= MAX_NOTES_CHARS);
  assert.ok(body.attachment.name.length <= 200);
});

test('notes text and minutes HTML group notes by agenda item and escape content', () => {
  const notes = [note('1', 'item-2', 'decision', '<b>Yes</b>'), note('2', 'gone', 'note', 'Loose end')];
  const text = buildNotesText({ agenda, notes, authorName: () => 'Ana' });
  assert.match(text, /## Status\n- \(no notes\)/);
  assert.match(text, /## Budget\n- \[decision\] Ana: <b>Yes<\/b>/);
  assert.match(text, /## Other notes/);
  const html = buildMinutesHtml({ meeting: { agenda, started_at: '2026-11-14T10:00:00Z' }, notes, authorName: () => 'Ana', summary: 'Done.', decisions: ['Ship it'], createdTasks: [{ title: 'Send <invoice>', owner: 'Ana', due: '2026-11-20' }] });
  assert.ok(!html.includes('<b>Yes</b>'));
  assert.match(html, /&lt;b&gt;Yes&lt;\/b&gt;/);
  assert.match(html, /Send &lt;invoice&gt; — Ana \(due 2026-11-20\)/);
  assert.match(html, /<h3>Budget<\/h3>/);
});
