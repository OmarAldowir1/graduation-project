const FIELDS = 'id, workspace_id, email, role, token, created_at, accepted_at';

// INSERT matches the owner-only policies. Do not UPSERT: updating invitations
// is deliberately not permitted, and rotating tokens invalidates shared links.
export async function saveWorkspaceInvitation(client, workspaceId, email, role, invitedBy) {
  const normalizedEmail = email.trim().toLowerCase();
  async function existing() {
    return client.from('workspace_invitations').select(FIELDS)
      .eq('workspace_id', workspaceId).eq('email', normalizedEmail).maybeSingle();
  }
  function reuse(result) {
    if (result.error || !result.data) return result;
    if (result.data.accepted_at) return { data: null, error: { message: 'This invitation has already been accepted. Check the workspace member list.' } };
    if (result.data.role !== role) return { data: null, error: { message: 'A pending invitation already exists with a different role. Revoke it first, then invite again with the new role.' } };
    return result;
  }
  const previous = await existing();
  if (previous.error || previous.data) return reuse(previous);
  const result = await client.from('workspace_invitations').insert({
    workspace_id: workspaceId, email: normalizedEmail, role, invited_by: invitedBy,
    token: crypto.randomUUID(), accepted_at: null
  }).select(FIELDS).single();
  // Another click/tab may have created the same invitation in the meantime.
  if (result.error?.code === '23505') {
    const concurrent = await existing();
    return concurrent.data || concurrent.error ? reuse(concurrent) : result;
  }
  return result;
}
