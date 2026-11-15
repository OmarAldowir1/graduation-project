import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOTION_COLORS } from '../src/lib/notionColors.js';

// The editor's AI actions (improve, summarize, translate…) run on the server now and are
// tested in text-ai-handler.test.js.
describe('Page editor', () => {
  it('offers the full 10-colour text and background palette', () => {
    assert.equal(NOTION_COLORS.text.length, 10);
    assert.equal(NOTION_COLORS.background.length, 10);
    const labels = NOTION_COLORS.text.map((c) => c.label);
    for (const name of ['Default', 'Gray', 'Brown', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'Red']) {
      assert.ok(labels.includes(name), `missing ${name}`);
    }
    assert.ok(NOTION_COLORS.background.every((c) => typeof c.label === 'string' && typeof c.value === 'string'));
  });
});
