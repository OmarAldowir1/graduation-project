import {supabase} from './supabase.js';

export async function invokeAI(functionName, body, signal) {
  if (import.meta.env.DEV) {
    const {data: {session}, error: sessionError} = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      const failure = new Error('Please sign in again to use AI.');
      failure.code = 'SIGN_IN_REQUIRED';
      throw failure;
    }
    const response = await fetch(`/__motion_ai/${functionName}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`},
      body: JSON.stringify(body),
      signal
    });
    if (signal?.aborted) throw new DOMException('Generation stopped', 'AbortError');
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      const failure = new Error(data?.error?.message || 'AI is unavailable. Check the local free AI setup.');
      failure.code = data?.error?.code || 'SERVICE_UNAVAILABLE';
      throw failure;
    }
    return data;
  }
  const {data, error} = await supabase.functions.invoke(functionName, {body, signal});
  if (signal?.aborted) throw new DOMException('Generation stopped', 'AbortError');
  if (error) {
    let detail;
    try { detail = await error.context?.json(); } catch { /* Network error. */ }
    const failure = new Error(detail?.error?.message || 'AI is unavailable. Check that the free AI setup is complete.');
    failure.code = detail?.error?.code || 'SERVICE_UNAVAILABLE';
    throw failure;
  }
  if (!data || data.error) {
    const failure = new Error(data?.error?.message || 'AI returned an invalid response.');
    failure.code = data?.error?.code || 'INVALID_DRAFT';
    throw failure;
  }
  return data;
}
