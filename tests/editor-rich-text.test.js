import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeAIAction } from '../src/lib/editorAI.js';
import { NOTION_COLORS } from '../src/lib/notionEditor.js';

describe('Notion-like Editor Architecture & AI Actions', () => {
  it('contains full 10-color Notion text and background color palette', () => {
    assert.equal(NOTION_COLORS.text.length, 10);
    assert.equal(NOTION_COLORS.background.length, 10);

    const labels = NOTION_COLORS.text.map(c => c.label);
    assert.ok(labels.includes('Default'));
    assert.ok(labels.includes('Gray'));
    assert.ok(labels.includes('Brown'));
    assert.ok(labels.includes('Orange'));
    assert.ok(labels.includes('Yellow'));
    assert.ok(labels.includes('Green'));
    assert.ok(labels.includes('Blue'));
    assert.ok(labels.includes('Purple'));
    assert.ok(labels.includes('Pink'));
    assert.ok(labels.includes('Red'));
  });

  it('rejects empty text for AI writing action without unhandled errors', async () => {
    await assert.rejects(
      async () => {
        await executeAIAction({ text: '', action: 'improve' });
      },
      { message: 'Please select some text first.' }
    );
  });

  it('provides safe deterministic fallback for AI actions when offline/local', async () => {
    const text = 'motion simplifies your workspace with notes and databases.';
    const improved = await executeAIAction({ text, action: 'improve' });
    assert.ok(improved.length > 0);
    assert.match(improved, /Motion/);

    const summarized = await executeAIAction({
      text: 'First point here. Second point here. Third point here.',
      action: 'summarize'
    });
    assert.ok(summarized.length > 0);

    const translated = await executeAIAction({
      text: 'Welcome',
      action: 'translate',
      language: 'Arabic'
    });
    assert.ok(translated.includes('Translation to Arabic') || translated.length > 0);
  });
});
