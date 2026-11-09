# In-page AI verification — 2026-10-16

Implemented the prompt-only assistant, suggestion chips, optional context, Generate/Refine, preview selection, Discard, Stop, Apply and guarded Undo. No Colab or JSON controls remain in the active assistant. Legacy deterministic text tools no longer accept an arbitrary remote AI endpoint.

`npm run test:ai`: 13 tests pass, covering the shared block contract/escaping and the authenticated function's successful response, disabled billing gate/missing key, unauthorized users/pages, quota denial/storage failure, request limits/field rejection, opted-in context, revisions, provider failure/timeout/quota, invalid/truncated/safety-blocked drafts, CORS/method handling and local text helpers. Provider responses in unit tests are mocks. `npm run check`: lint and build pass.

## Live activation

Google AI Studio failed in the in-app browser but loaded in the owner's regular Safari session. The owner explicitly approved creation of a dedicated key and storage in the Motion Supabase project's server secrets. Google displayed the selected Gemini project as Free tier with Set up billing; no billing or payment settings were enabled. The credential was stored server-side, not in source, frontend environment or GitHub.

The additive `sql/page-ai-quota.sql` migration completed successfully. The `page-ai` function was deployed through Supabase's editor from the same shared validator, handler and entrypoint sources (concatenated into its single index.ts). Existing gateway JWT verification remained enabled, in addition to the handler's Auth and RLS checks. The server's free-tier mode and exact localhost origin allowlist were configured.

The older 2.5 model returned 404 for this project. Google's current guidance restricts legacy 2.5 access for new projects and recommends 3.5 Flash-Lite, which has a free input/output tier. The rich provider response-schema settings returned HTTP 400. JSON response mode plus strict application validation worked, without switching providers, linking billing, or adding automatic retries. Temporary detailed setup diagnostics were removed; production logs only contain HTTP status and an error category, not provider bodies, prompts or keys.

## Live user workflow

From a signed-in Motion page, “Plan a project” produced a real six-block preview, including headings, an overview, a checklist and a milestones table. Page context was unchecked. Reading the editor confirmed the page remained unchanged during preview. The first draft invented calendar dates/progress, so the system instructions now explicitly require relative weeks/TBD and Not started unless the user supplies dates/progress. AI output still requires user review.

The existing local Vite server on port 5173 was reused. Backend request caps remain 2/minute/user, 10/day/user and 20/day/project, counting admitted failed attempts. Google's own limits can be lower. The billing-mode flag is an owner attestation, not a technical query of Google's billing account.

Final live verification: a React/Supabase task-manager request generated six valid blocks with Week 1–4 milestones and Not started statuses. A natural-language refinement shortened its overview to one sentence while retaining the plan. Apply saved all six blocks; the milestones remained visible after reload. Undo after reload removed only that new batch and saved successfully. A DOM text comparison confirmed the original page content was restored exactly. A screenshot of the real draft is saved locally as `/private/tmp/motion-in-page-ai-ready.png` (not committed).

The usage table reported 9 admitted setup/test attempts for the signed-in account, including provider-rejected configuration attempts. The 10/day account cap was not reset or bypassed; one application request remains for that account until the next UTC day. No live quota-exhaustion call was made just to consume the remaining allowance; quota-denial behavior is unit-tested.
