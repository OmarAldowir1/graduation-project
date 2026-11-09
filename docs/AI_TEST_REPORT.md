# Prototype verification — 2026-10-15

- `npm run test:ai`: three tests passed (valid contract, malformed/oversized/unsupported proposals, escaped model text).
- `npm run check`: ESLint and production build passed.
- All Python notebook code cells compile locally.
- In Motion: invalid JSON rejected; Cancel did not mutate the page; selected-only Apply saved six of seven sample blocks; blocks persisted after reload; Undo worked after reload and preserved an original note.
- Editing an applied checklist caused guarded Undo to refuse removal. Reverting that edit allowed Undo.
- Colab allocated a free T4 GPU and loaded Qwen2.5-1.5B-Instruct without an API key. The initial prompt copied schema fields; validation rejected it. The revised prompt generated four valid blocks, which were pasted into Motion, previewed, applied, saved, and verified after reload on “AI prototype — validation test”.

Limitations: the small model did not include all requested block types and left Markdown markers in plain text. Structural validation is not a semantic quality guarantee. Review generated content before applying. Colab emitted dependency-conflict warnings for unused preinstalled Gradio/Diffusers packages; this notebook's inference completed. Colab export executed, but the automated browser download event did not complete; testing therefore used the supported copy/paste path. A mobile viewport override was not honored by this browser, so mobile rendering is not claimed as tested.
