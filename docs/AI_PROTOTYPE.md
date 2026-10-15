# Free page AI prototype

Open **AI page assistant** in an existing page. Describe what you want, optionally include page text, and Copy request. Open the linked Colab notebook, choose a free GPU runtime, run installation/model cells, paste the request JSON into `REQUEST_JSON`, and run generation/export. Upload the downloaded JSON in Motion and Preview. Select blocks and Apply selected to append them; Cancel leaves the page untouched.

The notebook runs Qwen2.5-1.5B-Instruct, not a paid API. GPU availability and session duration are limited by Colab. CPU inference is an explicit, slower fallback. This prototype does not host a website backend on Colab. Model downloads use Hugging Face; notebook compute uses Google. Do not send private page context without permission.

Output follows `colab/motion-blocks.schema.json`. Both notebook and application validate it. Supported blocks: text, headings 1–3, bullet/numbered/to-do lists, quote, callout, code, table, toggle and divider. Generated text is escaped, not executed. Proposals are limited to 40 blocks, 60,000 content characters and a 100 KB import file.

Apply preserves the page title and existing blocks. Undo last AI apply removes only the last AI batch, including after reload in the same browser. It refuses if that batch was changed or reordered, protecting subsequent edits. The undo record lives in browser local storage, not a cross-device history. Saving failures restore the previous editor content.

Load sample demonstrates the import workflow; it is clearly labeled and is not model-generated. Review model output for accuracy before applying. Existing Smart assist is a separate feature.

Run `npm run test:ai` for validation/escaping tests and `npm run check` for lint/build. The self-contained notebook mirrors `motion_ai.py` and the schema; update its embedded cells when changing those sources.
