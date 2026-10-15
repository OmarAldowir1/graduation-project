// Keep deployment-specific credentials out of the source tree. The fallback
// host is intentionally non-routable so a copied project cannot silently
// connect to another person's Supabase project.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://missing-supabase-project.invalid';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing-supabase-anon-key';
const configuredUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const configuredKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const isSupabaseConfigured = Boolean(
  configuredUrl &&
  configuredKey &&
  /^https?:\/\/[^\s]+$/i.test(configuredUrl) &&
  !configuredUrl.includes('YOUR_SUPABASE') &&
  !configuredKey.includes('YOUR_SUPABASE')
);
