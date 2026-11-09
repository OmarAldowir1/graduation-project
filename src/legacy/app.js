import { signOut } from '../lib/supabase.js';

// Keep a similar shape to the original vanilla AppState so legacy page modules can reuse it.
export const AppState = {
  user: null,
  profile: null,
  workspace: null,
  workspaces: [],
  isLoading: true
};

export function setBreadcrumb(text) {
  window.dispatchEvent(new CustomEvent('motion:breadcrumb', { detail: text }));
}

export function showToast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('motion:toast', { detail: { message, type } }));
}

export async function handleSignOut() {
  await signOut();
  window.location.hash = 'login';
}
