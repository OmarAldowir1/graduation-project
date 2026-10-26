/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withAuthDeadline } from '../src/lib/authRequest.js';

test('auth deadline returns successful session without another session request', async () => {
  const result = { session: { user: { id: 'test-user' } }, error: null };
  assert.equal(await withAuthDeadline(() => Promise.resolve(result), 100), result);
});

test('auth deadline preserves service errors', async () => {
  const error = new Error('Email rate limit exceeded');
  await assert.rejects(withAuthDeadline(() => Promise.reject(error), 100), error);
});

test('a hung auth request settles with a recoverable timeout', async () => {
  await assert.rejects(withAuthDeadline(() => new Promise(() => {}), 5), { code: 'AUTH_TIMEOUT' });
});

test('a late request rejection is handled after timeout', async () => {
  const unhandled = [];
  const listener = error => unhandled.push(error);
  process.on('unhandledRejection', listener);
  try {
    await assert.rejects(withAuthDeadline(() => new Promise((_, reject) => setTimeout(() => reject(new Error('Late network failure')), 20)), 5), { code: 'AUTH_TIMEOUT' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listener);
  }
});
