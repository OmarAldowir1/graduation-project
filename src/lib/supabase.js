import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session || null;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data?.user || null, session: data?.session || null, error };
}

export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } }
  });
  return { user: data?.user || null, session: data?.session || null, error };
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  return { data, error };
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}#reset-password`
  });
  return { error };
}

export async function updatePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  return { user: data?.user || null, error };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(event, session));
}
