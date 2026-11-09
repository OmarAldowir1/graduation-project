import test from 'node:test';
import assert from 'node:assert/strict';
import { saveWorkspaceInvitation } from '../src/lib/workspaceInvitations.js';

function fakeClient(responses) {
  const calls = [];
  const client = { from(table) {
    calls.push(['from', table]);
    const chain = {};
    for (const method of ['select', 'eq', 'insert']) chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
    chain.maybeSingle = chain.single = async () => responses.shift();
    return chain;
  } };
  return { client, calls };
}
const invite = { id: 'invite', token: 'unchanged-token', role: 'editor', accepted_at: null };

test('new invitation uses INSERT and normalized email, never UPDATE/UPSERT', async () => {
  const { client, calls } = fakeClient([{ data: null }, { data: invite }]);
  assert.equal((await saveWorkspaceInvitation(client, 'workspace', ' USER@example.com ', 'editor', 'owner')).data, invite);
  const row = calls.find(call => call[0] === 'insert')[1];
  assert.equal(row.email, 'user@example.com');
  assert.equal(row.invited_by, 'owner');
  assert.equal(row.workspace_id, 'workspace');
});
test('repeated invitation reuses token without mutation', async () => {
  const { client, calls } = fakeClient([{ data: invite }]);
  assert.equal((await saveWorkspaceInvitation(client, 'workspace', 'user@example.com', 'editor', 'owner')).data.token, invite.token);
  assert.equal(calls.some(call => call[0] === 'insert'), false);
});
test('does not silently change role or reopen accepted invitations', async () => {
  for (const data of [{ ...invite, role: 'viewer' }, { ...invite, accepted_at: '2026-10-16' }]) {
    const { client, calls } = fakeClient([{ data }]);
    assert.ok((await saveWorkspaceInvitation(client, 'workspace', 'user@example.com', 'editor', 'owner')).error);
    assert.equal(calls.some(call => call[0] === 'insert'), false);
  }
});
test('propagates RLS rejection rather than bypassing it', async () => {
  const error = { code: '42501', message: 'row-level security policy' };
  const { client } = fakeClient([{ data: null }, { data: null, error }]);
  assert.equal((await saveWorkspaceInvitation(client, 'workspace', 'user@example.com', 'editor', 'owner')).error, error);
});
test('handles concurrent duplicate creation by reusing the pending invitation', async () => {
  const { client } = fakeClient([{ data: null }, { error: { code: '23505' } }, { data: invite }]);
  assert.equal((await saveWorkspaceInvitation(client, 'workspace', 'user@example.com', 'editor', 'owner')).data, invite);
});
