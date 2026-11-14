import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMentionIds, renderMentionsHtml } from '../src/lib/mentions.js';
import { describeNotification } from '../src/lib/notificationText.js';

const members = [
  { user_id: 'u1', user: { name: 'Ann', email: 'ann@x.io' } },
  { user_id: 'u2', user: { name: 'Ann Lee', email: 'lee@x.io' } },
  { user_id: 'u3', user: { name: '', email: 'sam@x.io' } }
];

test('finds mentions, preferring the longest name', () => {
  assert.deepEqual(extractMentionIds('Hey @Ann Lee, can you check?', members), ['u2']);
  assert.deepEqual(extractMentionIds('@Ann and @ann lee', members).sort(), ['u1', 'u2']);
  assert.deepEqual(extractMentionIds('ping @sam please', members), ['u3']);
});

test('ignores emails, partial words and the author', () => {
  assert.deepEqual(extractMentionIds('mail ann@x.io or @Annabel', members), []);
  assert.deepEqual(extractMentionIds('@Ann thanks', members, 'u1'), []);
  assert.deepEqual(extractMentionIds('no mentions here', members), []);
});

test('renders mentions as escaped highlights', () => {
  const html = renderMentionsHtml('<b>hi</b> @Ann Lee', members);
  assert.equal(html, '&lt;b&gt;hi&lt;/b&gt; <span class="mention-chip">@Ann Lee</span>');
  assert.equal(renderMentionsHtml('@Ann', members, ['u2']), '@Ann');
});

test('describes notifications with actor and destination', () => {
  const mention = describeNotification({ type: 'mention', page_id: 'p1', payload: { actor_name: 'Sara', page_title: 'Roadmap', excerpt: 'look' } });
  assert.equal(mention.text, 'Sara mentioned you on “Roadmap”');
  assert.equal(mention.href, 'editor/p1');
  assert.equal(mention.excerpt, 'look');
  const taskComment = describeNotification({ type: 'task_comment', payload: { actor_name: 'Omar', title: 'Fix login', task_id: 't 1' } });
  assert.equal(taskComment.text, 'Omar commented on task “Fix login”');
  assert.equal(taskComment.href, 'kanban?task=t%201');
});

test('keeps older notifications readable', () => {
  assert.equal(describeNotification({ type: 'comment_added', page_id: 'p', payload: { title: 'New comment on a page' } }).text, 'New comment on a page');
});

test('describes due-date reminders', () => {
  const info = describeNotification({ type: 'task_due', payload: { title: 'Ship it', task_id: 't1', when: 'tomorrow' } });
  assert.equal(info.text, 'Reminder: “Ship it” is due tomorrow');
  assert.equal(info.href, 'kanban?task=t1');
  assert.equal(describeNotification({ type: 'task_due', payload: { title: 'X', task_id: 't', when: 'overdue' } }).text, 'Overdue: “X”');
});
