// npm run setup:gemini
// Saves your Google Gemini API key (for YouTube lessons) into supabase/functions/.env,
// the git-ignored secrets file. You paste the key here; it is hidden while you type,
// never printed, and never sent anywhere. Other lines in the file are kept as they are.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

const FILE = 'supabase/functions/.env';

// Ask with hidden input (nothing is echoed to the screen).
function askHidden(question) {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); });
    muted = true;
  });
}

const key = await askHidden('Paste your Gemini API key (it stays hidden), then press Enter: ');

if (!/^[A-Za-z0-9._-]{20,200}$/.test(key)) {
  console.error('\n✗ That does not look like an API key. Copy it again from Google AI Studio and run this again. Nothing was saved.\n');
  process.exit(1);
}

// Ask Google whether the key works before saving it (lists one model; costs nothing).
process.stdout.write('Checking the key with Google… ');
let check;
try {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  check = response.ok ? { ok: true } : { ok: false, reason: body?.error?.message || `HTTP ${response.status}` };
} catch (error) {
  check = { ok: false, offline: true, reason: error.message };
}
if (!check.ok && !check.offline) {
  console.error(`\n✗ Google did not accept this key: ${check.reason}`);
  console.error('  Nothing was saved. In Google AI Studio, click "Create API key", copy the new key, and run this again.\n');
  process.exit(1);
}
console.log(check.ok ? 'it works ✓' : `could not reach Google (${check.reason}); saving it anyway.`);

const lines = existsSync(FILE) ? readFileSync(FILE, 'utf8').split(/\r?\n/) : [];
while (lines.length && lines[lines.length - 1] === '') lines.pop();
const line = `GEMINI_API_KEY=${key}`;
const at = lines.findIndex((existing) => existing.startsWith('GEMINI_API_KEY='));
if (at >= 0) lines[at] = line;
else lines.push('# YouTube lessons (Google Gemini). Server-only; never put it in the browser .env.', line);
writeFileSync(FILE, `${lines.join('\n')}\n`, { mode: 0o600 });

console.log(`\n✓ Saved the Gemini key to ${FILE} (${at >= 0 ? 'replaced the old one' : 'added'}). It is git-ignored.`);
console.log('  Restart the dev server so the app picks it up.\n');
