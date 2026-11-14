# Cloudflare Workers AI Free setup

Motion uses one fixed Cloudflare Workers AI model, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, for page drafts, chat, and editor text actions. In local development, the Vite server on your Mac reads the token from `supabase/functions/.env` and verifies the user's Supabase session before calling Cloudflare. The token is never sent to the browser or Supabase in this mode. Hosted deployments can instead use authenticated Supabase Edge Functions, but only after the owner explicitly approves storing the token there. There is no paid model fallback, AI Gateway, automatic retry, or model choice from the browser.

## Keep usage at zero cost

Create or select a Cloudflare account on the **Workers Free** plan. Do not upgrade to Workers Paid, enable prepaid AI Gateway credits, or connect this app to an account that is already paid. Cloudflare's Free plan includes 10,000 Neurons per day; after that, requests fail until the allocation resets at 00:00 UTC. The account owner must confirm the plan in the dashboard before setting `MOTION_AI_CLOUDFLARE_PLAN=workers-free`. This variable is an owner declaration, not a technical billing check. If the Cloudflare account is upgraded later, disable the functions immediately by changing the declaration to `disabled` or removing the token.

Keep the Supabase project on its Free plan too. Free offerings and limits can change. Text from prompts and explicitly attached documents is sent to Cloudflare for inference; check its data policy before sending private material. PDFs are converted to selectable text in the browser. Scanned PDFs need OCR first.

## 1. Get Cloudflare credentials

In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers AI → Use REST API**. Copy the **Account ID** and create a **Workers AI API Token** using Cloudflare's template. The token is a secret. Do not put it in `.env`, a `VITE_*` variable, GitHub, or chat. The Account ID itself is not a secret.

## 2. Local-only AI (token stays on your Mac)

Copy `supabase/functions/.env.example` to `supabase/functions/.env` and set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`, and `MOTION_AI_CLOUDFLARE_PLAN=workers-free` after confirming Workers Free in Cloudflare. The file is ignored by Git. Run `npm run dev` and open the Vite URL on this Mac. The development server handles AI requests locally, checks the signed-in user with Supabase, and reserves the shared project quota. No Cloudflare token is sent to Supabase. Do not use `npm run preview` or a production build to test this local-only path; those use the hosted functions.

The local AI server rejects non-loopback network clients. Keep the token out of the root `.env`, `VITE_*` variables, GitHub, and chat. If you close the terminal running Vite, AI is unavailable until you restart it.

## 3. Prepare Supabase quota

In the same Supabase project used by the app, run `sql/page-ai-quota.sql` in the SQL Editor if it has not already been applied. Then run `sql/cloudflare-ai-quota.sql`. The latter replaces the reservation function with limits shared by page drafts, chat, and editor actions: 4 attempts per minute per user, 50 per day per user, and 100 per day across the project. Failed attempts admitted by the function count. Cloudflare's own free allowance can run out before these limits; it is the final hard stop on a Workers Free account.

The quota migration is needed for both local and hosted AI. For a hosted deployment only, and only with the owner's explicit approval to share the token with Supabase, set these **Supabase → Edge Functions → Secrets**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID from Workers AI |
| `CLOUDFLARE_AI_TOKEN` | Workers AI API token |
| `MOTION_AI_CLOUDFLARE_PLAN` | `workers-free`, only after confirming the account is on Workers Free |
| `MOTION_AI_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173`; add the exact deployed website origin if needed |

Do not set these Supabase secrets for local-only AI. Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to its function runtime. Remove old Gemini secrets only after confirming no other client uses them.

## 4. Optional hosted function deployment

From the project folder, using an authenticated Supabase CLI:

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy cloudflare-page-ai --project-ref YOUR_PROJECT_REF
npx supabase functions deploy text-ai --project-ref YOUR_PROJECT_REF
```

Both functions keep gateway JWT verification enabled in `supabase/config.toml`, verify the bearer token with Supabase Auth, and reserve quota before contacting Cloudflare. The page function additionally verifies page access through the caller's RLS policies. Do not disable JWT verification to work around an authentication error.

## 5. Check it

Run `npm run test:ai` and `npm run build`. For local-only AI, start `npm run dev`, sign in, create a page, request a draft, and try chat and a text editor action. The automated tests mock Cloudflare and cannot establish that your live account is Free or that its token works. If local AI says it is not configured, check the ignored local environment file and restart Vite. If hosted AI says it is not configured, its Supabase secrets are not set. If either path reaches a free limit, wait for the UTC reset; no paid service is selected.

Official references: [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [REST API setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), [Supabase function secrets](https://supabase.com/docs/guides/functions/secrets).
