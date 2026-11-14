import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextAIHandler} from '../supabase/functions/text-ai/handler.js';
import {FREE_MODEL} from '../supabase/functions/_shared/cloudflareAI.js';

const origin = 'http://localhost:5173';
function fixture(overrides = {}) {
  const calls = [];
  const settings = {CLOUDFLARE_AI_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), MOTION_AI_CLOUDFLARE_PLAN: 'workers-free', MOTION_AI_ALLOWED_ORIGINS: origin};
  const handler = createTextAIHandler({env: key => settings[key], authenticate: async () => ({id: 'test-user'}), reserveQuota: async () => ({allowed: true}), fetchImpl: async (url, options) => {calls.push({url, options}); return Response.json({success: true, result: {response: 'Cloudflare answer'}});}, ...overrides});
  const invoke = body => handler(new Request('https://example.test/functions/v1/text-ai', {method: 'POST', headers: {Origin: origin, Authorization: 'Bearer test-session', 'Content-Type': 'application/json'}, body: JSON.stringify(body)}));
  return {invoke, calls, settings};
}

test('chat and editor actions use the fixed free model through the server', async () => {
  const f = fixture();
  assert.equal((await f.invoke({mode: 'chat', prompt: 'Summarize', messages: [{role: 'user', content: 'Hello'}], attachment: {name: 'notes.txt', content: 'Notes'}})).status, 200);
  assert.equal((await f.invoke({mode: 'edit', action: 'proofread', text: 'a sentance'})).status, 200);
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.ok(call.url.endsWith(`/ai/run/${FREE_MODEL}`));
    assert.equal(call.options.headers.Authorization, 'Bearer test-token');
    assert.equal(JSON.parse(call.options.body).model, undefined);
  }
  assert.match(JSON.parse(f.calls[0].options.body).messages.at(-1).content, /Notes/);
});

test('text AI refuses unconfirmed plans, unsupported actions and quota exhaustion', async () => {
  const f = fixture(); f.settings.MOTION_AI_CLOUDFLARE_PLAN = 'paid';
  assert.equal((await f.invoke({mode: 'chat', prompt: 'Hello'})).status, 503);
  assert.equal(f.calls.length, 0);
  const bad = fixture();
  assert.equal((await bad.invoke({mode: 'edit', action: 'run-code', text: 'hello'})).status, 400);
  assert.equal((await bad.invoke({mode: 'chat', prompt: 'Hi', model: 'paid'})).status, 400);
  assert.equal(bad.calls.length, 0);
  const limit = fixture({reserveQuota: async () => ({allowed: false})});
  assert.equal((await limit.invoke({mode: 'chat', prompt: 'Hi'})).status, 429);
  assert.equal(limit.calls.length, 0);
});
