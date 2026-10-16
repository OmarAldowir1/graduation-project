# In-page AI — administrator setup

Users only open the AI assistant, type a request and click Generate draft. They never visit Colab, edit JSON or provide their own API key. Drafts are validated on both the server and client; Apply appends selected blocks, preserving existing content/title. Refine sends the last draft with the new request; Discard and Stop never modify a page. Undo removes only an unchanged last AI batch.

## Cost and privacy boundary

Only `gemini-3.5-flash-lite` at Google's standard `generateContent` endpoint is allowlisted. No configurable model, provider fallback, automatic retry, search/maps grounding, code execution or caching is used. Quota errors stop generation. The key is sent in an HTTP header server-side, never a browser variable or URL. Do not enable Google Cloud billing or attach payment details. Keep Supabase on its existing free plan; do not upgrade it for this feature. Free services have quotas and availability limits. The older 2.5 model returned 404 for this project; Google's current deprecation guidance restricts 2.5 access for new projects and recommends 3.5 Flash-Lite, which currently has a free input/output tier.

**Important:** Google uses the same API endpoint for free and paid accounts. Code cannot prove from an API key whether billing is linked. The server requires the owner to attest that the Google project has no linked billing before enabling requests. That attestation is not a billing-status verification. If billing is later linked, immediately remove the key or set the mode back to `disabled`; application limits alone cannot guarantee zero charges on a billed account. There is no promise that a provider's free offering will remain unchanged.

Google's free-tier inputs/outputs may be used to improve its products. A notice appears before Generate. Current page text is excluded by default and only included when the user selects its checkbox. No prompts, page contents or responses are stored in the quota table or application logs. Do not share sensitive/confidential page content with the free provider.

## 1. Create a free-tier key (owner)

1. Sign in at https://aistudio.google.com/api-keys and inspect Projects/Billing.
2. Select or create a project that shows **Free tier**, with **no linked Cloud Billing account**. If offered payment, credits requiring billing, an upgrade or a paid subscription, stop.
3. Create a key named `Motion free page AI`. Creating a credential and accepting any new terms require the owner's confirmation. Do not paste the key into chat or commit it to GitHub.
4. If AI Studio shows an unknown error or no projects, resolve that account/setup problem first. Do not bypass it with a billed project.

## 2. Add quota storage

In your own Supabase project's SQL Editor, run `sql/page-ai-quota.sql` once. It is additive: a usage-counter table and an authenticated reservation function. Limits are **2 attempts/minute/user, 10/day/user and 20/day/project**, reset daily in UTC. All admitted attempts count even if Google rejects them. No automatic retries. Limits are persistent/atomic across Edge Function instances. Missing quota storage fails closed. These conservative demo limits are not a claim about Google's current quotas.

## 3. Deploy the Edge Function

Using the official Supabase CLI (installation is a separate owner action; no Homebrew required):

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy page-ai --project-ref YOUR_PROJECT_REF
```

The function keeps this project's gateway JWT verification enabled (`verify_jwt = true`) and **additionally verifies the bearer token with Supabase Auth on every POST**. Do not remove those checks. It checks page access through the caller's existing RLS policies and uses no service-role credential. Its dependencies are local files under `supabase/functions/`. Projects using a different signing-key setup may need a reviewed authentication configuration; do not simply disable verification to bypass an error.

## 4. Set server secrets securely

In Supabase → Edge Functions → Secrets, enter:

| Secret | Value |
| --- | --- |
| `GEMINI_API_KEY` | The key from your verified free, unbilled Google project |
| `MOTION_AI_BILLING_MODE` | `unlinked-free-tier` **only after the check above**; otherwise `disabled` |
| `MOTION_AI_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` for local development; add your exact website origin when deployed |

Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to its runtime. Never add the Gemini key to `VITE_*`, the frontend `.env`, screenshots, logs, GitHub or source code. Local function secrets, if needed, belong in the ignored `supabase/functions/.env`.

## 5. Test activation

Sign into Motion, open a page and ask: “Create a React project plan with a heading, checklist and milestones table.” Check the preview, refine, apply, reload, and undo. Test a second user cannot generate for an inaccessible page. Quota exhaustion should show a friendly limit message, never switch providers. Stop hides late results; a request already accepted by the server may still count toward quota.

Run `npm run test:ai` and `npm run check`. The test suite uses mocked provider responses; it cannot verify a live Google account or its billing status. No live generation should be claimed until the real key, migration and deployment are verified.

## Official references

- Google free-tier pricing/data usage: https://ai.google.dev/gemini-api/docs/pricing
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output
- Supabase secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase function authentication: https://supabase.com/docs/guides/functions/auth
