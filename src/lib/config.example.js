// ============================================
// MOTION — Configuration (Example)
// ============================================
// Rename this file to config.js and add your actual Supabase project credentials.
// Alternatively, create a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
// You can find them at: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'YOUR_SUPABASE_URL_HERE';

export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'YOUR_SUPABASE_ANON_KEY_HERE';
