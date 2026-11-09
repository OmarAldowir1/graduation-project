import {createTextAIHandler} from './handler.js';

const env = (name: string) => Deno.env.get(name);
const base = env('SUPABASE_URL')!;
const publicKey = env('SUPABASE_ANON_KEY')!;
const headers = (token: string) => ({apikey: publicKey, Authorization: token, 'Content-Type': 'application/json'});

Deno.serve(createTextAIHandler({
  env,
  authenticate: async (token: string) => {
    const result = await fetch(`${base}/auth/v1/user`, {headers: headers(token), signal: AbortSignal.timeout(10000)});
    return result.ok ? await result.json() : null;
  },
  reserveQuota: async (token: string) => {
    const result = await fetch(`${base}/rest/v1/rpc/reserve_page_ai_request`, {method: 'POST', headers: headers(token), body: '{}', signal: AbortSignal.timeout(10000)});
    if (!result.ok) throw new Error('AI quota storage unavailable');
    return await result.json();
  }
}));
