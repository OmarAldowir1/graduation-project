// Turns a notification row into a short sentence and a destination.

const ICONS = {
  mention: 'alternate_email',
  comment_added: 'comment',
  comment_reply: 'reply',
  task_comment: 'forum',
  task_assigned: 'assignment_ind',
  page_updated: 'edit_note',
  task_due: 'alarm'
};

function quoted(value, fallback) {
  const text = String(value || '').trim();
  return text ? `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”` : fallback;
}

export function describeNotification(notification) {
  const payload = notification?.payload || {};
  const actor = String(payload.actor_name || '').trim() || 'A teammate';
  const target = quoted(payload.page_title || payload.title, 'a page');
  const taskTarget = quoted(payload.title, 'a task');
  const isTask = Boolean(payload.task_id) && !notification?.page_id;
  let text;
  switch (notification?.type) {
    case 'mention':
      text = `${actor} mentioned you on ${isTask ? taskTarget : target}`;
      break;
    case 'comment_added':
      text = `${actor} commented on ${target}`;
      break;
    case 'comment_reply':
      text = `${actor} replied on ${target}`;
      break;
    case 'task_comment':
      text = `${actor} commented on task ${taskTarget}`;
      break;
    case 'task_assigned':
      text = `${actor} assigned you ${taskTarget}`;
      break;
    case 'page_updated':
      text = `${actor} edited ${target}`;
      break;
    case 'task_due':
      text = payload.when === 'overdue' ? `Overdue: ${taskTarget}` : `Reminder: ${taskTarget} is due ${payload.when === 'today' ? 'today' : 'tomorrow'}`;
      break;
    default:
      text = payload.message || payload.title || String(notification?.type || 'Workspace update').replaceAll('_', ' ');
  }
  // Rows created before collaboration.sql have no actor name; keep their old title.
  if (!payload.actor_name && notification?.type === 'comment_added') text = 'New comment on a page';
  if (!payload.actor_name && notification?.type === 'page_updated') text = `${target} was updated`;
  if (!payload.actor_name && notification?.type === 'task_assigned') text = `You were assigned ${taskTarget}`;

  let href = null;
  if (notification?.page_id) href = `editor/${notification.page_id}`;
  else if (payload.task_id) href = `kanban?task=${encodeURIComponent(payload.task_id)}`;
  else if (notification?.type === 'task_assigned') href = 'kanban';

  return {
    text,
    excerpt: payload.excerpt ? String(payload.excerpt) : '',
    icon: ICONS[notification?.type] || (String(notification?.type || '').includes('member') ? 'group' : 'notifications'),
    href
  };
}
