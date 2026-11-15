import { useState } from 'react';
import { updateMessageInChat } from '../lib/aiChatStore.js';
import { describeAction, executeAgentActions } from '../lib/agent.js';

// The AI's proposed changes, shown for review: nothing happens until Apply.
// Shared by Ask AI and the AI panel inside pages.
export default function AgentActionCard({ chatId, message, onApplied = null }) {
  const [busy, setBusy] = useState(false);
  const refs = new Map(Object.entries(message.refMap || {}));
  const created = new Map(message.actions.filter((a) => a.ref).map((a) => [a.ref, a.title || a.name]));
  const state = message.actionState || 'pending';

  async function apply() {
    setBusy(true);
    const { results, navigateTo } = await executeAgentActions(message.actions, { refs });
    const failed = results.filter((r) => !r.ok).length;
    updateMessageInChat(chatId, message.id, { actionState: failed === results.length ? 'failed' : 'applied', results });
    setBusy(false);
    if (onApplied) onApplied({ results, navigateTo, failed });
    else if (navigateTo && !failed) window.location.assign(`#${navigateTo}`);
  }

  return (
    <div className={`agent-card is-${state}`}>
      <div className="agent-card-head">
        <span className="material-symbols-outlined">{state === 'applied' ? 'task_alt' : state === 'cancelled' ? 'block' : 'bolt'}</span>
        <strong>{state === 'applied' ? 'Applied' : state === 'cancelled' ? 'Cancelled' : state === 'failed' ? 'Could not apply' : `${message.actions.length} proposed change${message.actions.length === 1 ? '' : 's'}`}</strong>
      </div>
      <ul>
        {message.actions.map((action, index) => {
          const info = describeAction(action, refs, created);
          const result = message.results?.[index];
          return (
            <li key={index} className={result ? (result.ok ? 'is-ok' : 'is-error') : ''}>
              <span className="material-symbols-outlined">{result ? (result.ok ? 'check_circle' : 'error') : info.icon}</span>
              <div>
                {result?.ok && result.href ? <a href={result.href}>{info.text}</a> : <span>{info.text}</span>}
                {info.detail ? <small>{info.detail}</small> : null}
                {result && !result.ok ? <small className="agent-error">{result.error}</small> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {message.dropped ? <p className="agent-note">{message.dropped} suggestion{message.dropped === 1 ? ' was' : 's were'} skipped because {message.dropped === 1 ? 'it' : 'they'} referred to something that doesn’t exist.</p> : null}
      {state === 'pending' ? (
        <div className="agent-card-actions">
          <button type="button" className="modal-btn-secondary" disabled={busy} onClick={() => updateMessageInChat(chatId, message.id, { actionState: 'cancelled' })}>Cancel</button>
          <button type="button" className="modal-btn-primary" disabled={busy} onClick={apply}>{busy ? 'Applying…' : 'Apply'}</button>
        </div>
      ) : null}
    </div>
  );
}

