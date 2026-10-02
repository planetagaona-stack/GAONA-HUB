import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSignals, toSnapshot } from '../src/signals.js';
import { SessionStore } from '../src/sessions.js';
import { renderHud, demoSnapshot, visibleLength, safeText } from '../src/render.js';
import { launchCodex, footerOverride, promptArgs } from '../src/launch.js';
const run = promisify(execFile);
const cli = path.resolve('bin/codex-hub.js');
const event = (type, payload, timestamp = '2026-10-01T10:00:00Z') => JSON.stringify({ type, payload, timestamp }) + '\n';
const tokenEvent = event('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 123000, output_tokens: 456 }, last_token_usage: { total_tokens: 26000 }, model_context_window: 100000 }, rate_limits: { primary: { used_percent: 61, window_minutes: 10080, resets_at: 1800000000 }, secondary: null } });
async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-hub-test-'));
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  await mkdir(path.join(home, 'sessions'));
  const file = path.join(home, 'sessions', 'test.jsonl');
  await writeFile(file, event('session_meta', { id: 'session-1', cwd: home }) + event('turn_context', { model: 'test-model', reasoning_effort: 'medium' }) + tokenEvent);
  return { home, file };
}

test('shortened native IDs resolve uniquely and reject colliding or mismatched metadata', async t => {
  const { home } = await fixture(t);
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  const prefix = id.slice(0, 29);
  const file = path.join(home, 'sessions', `${id}.jsonl`);
  await writeFile(file, event('session_meta', { id, cwd: home }));
  const store = new SessionStore(home);
  assert.equal(await store.resolveSession(prefix), id);
  const second = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  await writeFile(path.join(home, 'sessions', `${second}.jsonl`), event('session_meta', { id: second, cwd: home }));
  store.refreshed = 0;
  assert.equal(await store.resolveSession(prefix), null);
  await writeFile(file, event('session_meta', { id: 'wrong-id', cwd: home }));
  assert.equal(await store.resolveSession(id), null);
});

test('chat titles use only the bound session index entry and follow appended renames', async t => {
  const { home } = await fixture(t);
  const index = path.join(home, 'session_index.jsonl');
  const store = new SessionStore(home);
  assert.equal((await store.snapshot('session-1')).threadName, null);
  await writeFile(index, JSON.stringify({ id: 'other-session', thread_name: 'Otra tarea' }) + '\n' + JSON.stringify({ id: 'session-1', thread_name: 'Mi tarea', message: 'PRIVATE_BODY' }) + '\ninvalid\n');
  assert.equal((await store.snapshot('session-1')).threadName, 'Mi tarea');
  assert.ok(!JSON.stringify(store.titleCache).includes('PRIVATE_BODY'));
  assert.ok(!JSON.stringify(store.titleCache).includes('Otra tarea'));
  await appendFile(index, JSON.stringify({ id: 'session-1', thread_name: 'Renombrada' }) + '\n');
  assert.equal((await store.snapshot('session-1')).threadName, 'Renombrada');
  await appendFile(index, JSON.stringify({ id: 'session-1', thread_name: '' }) + '\n');
  assert.equal((await store.snapshot('session-1')).threadName, null);
});

test('explicitly bound older session is found beyond the thirty recent files', async t => {
  const { home } = await fixture(t);
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const file = path.join(home, 'sessions', `${id}.jsonl`);
  await writeFile(file, event('session_meta', { id, cwd: home }) + tokenEvent);
  await utimes(file, 1, 1);
  for (let i = 0; i < 31; i++) await writeFile(path.join(home, 'sessions', `${i}.jsonl`), event('session_meta', { id: `other-${i}`, cwd: home }));
  const store = new SessionStore(home);
  assert.equal((await store.snapshot(id)).id, id);
  assert.equal(await store.resolveSession(id.slice(0, 29)), id);
});

test('uses last context usage, cumulative counters, and primary weekly limits', () => {
  const state = parseSignals(tokenEvent);
  assert.equal(state.contextPercent, 26);
  assert.equal(state.inputTokens, 123000);
  assert.equal(state.weekly.usedPercent, 61);
  assert.equal(state.usage, undefined);
  assert.equal(parseSignals(event('event_msg', { type: 'token_count', rate_limits: { primary: { used_percent: 20, window_minutes: 300 } } })).weekly, undefined);
});
test('freezes task duration and ignores chat bodies and malformed input', () => {
  const text = event('event_msg', { type: 'task_started' }) + 'invalid\n' + event('response_item', { type: 'message', content: 'PRIVATE_MESSAGE' }) + event('event_msg', { type: 'task_complete', last_agent_message: 'PRIVATE_MESSAGE' }, '2026-10-01T10:02:00Z');
  const snapshot = toSnapshot(parseSignals(text), Date.parse('2026-10-01T12:00:00Z'));
  assert.equal(snapshot.taskSeconds, 120);
  assert.equal(snapshot.status, 'idle');
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_MESSAGE'));
});
test('tracks tools without exposing their arguments', () => {
  const state = parseSignals(event('response_item', { type: 'function_call', call_id: 'one', name: 'exec', arguments: 'SECRET' }));
  assert.equal(state.activeTool, 'exec');
  assert.equal(parseSignals(event('response_item', { type: 'function_call_output', call_id: 'one', output: 'SECRET' }), state).activeTool, null);
  assert.ok(!JSON.stringify(toSnapshot(state)).includes('SECRET'));
});
test('session reader handles a partial JSON line and appended UTF-8 data', async t => {
  const { home, file } = await fixture(t);
  const store = new SessionStore(home);
  assert.equal((await store.snapshot()).contextPercent, 26);
  const line = event('turn_context', { model: 'modelo-ñ', reasoning_effort: 'high' });
  await appendFile(file, line.slice(0, -4));
  assert.equal((await store.snapshot()).model, 'test-model');
  await appendFile(file, line.slice(-4));
  assert.equal((await store.snapshot()).model, 'modelo-ñ');
});
test('session reader resets after file truncation', async t => {
  const { home, file } = await fixture(t);
  const store = new SessionStore(home);
  await store.snapshot();
  await writeFile(file, event('session_meta', { id: 'replacement', cwd: home }));
  const state = await store.snapshot();
  assert.equal(state.id, 'replacement');
  assert.equal(state.contextPercent, null);
});
test('initial streaming scan finds task start in the middle of a large session', async t => {
  const { home, file } = await fixture(t);
  await appendFile(file, event('response_item', { type: 'message', content: 'x'.repeat(2200000) }));
  await appendFile(file, event('event_msg', { type: 'task_started' }, new Date(Date.now() - 5000).toISOString()));
  await appendFile(file, event('response_item', { type: 'message', content: 'x'.repeat(2200000) }));
  await appendFile(file, tokenEvent);
  const snapshot = await new SessionStore(home).snapshot();
  assert.ok(snapshot.taskSeconds >= 5 && snapshot.taskSeconds < 15);
  assert.equal(snapshot.contextPercent, 26);
});
test('missing sessions stay unavailable and explicit selection fails clearly', async t => {
  const { home } = await fixture(t);
  const state = await new SessionStore(path.join(home, 'absent')).snapshot();
  assert.equal(state.connected, false);
  assert.equal(state.weekly, null);
  assert.equal((await new SessionStore(home).snapshot('missing')).error, 'Sesión no disponible');
  assert.equal((await new SessionStore(home).snapshot(null, path.join(home, 'other'))).connected, false);
});
test('renderer fits narrow/wide terminals, unicode and colored padding', () => {
  for (const width of [40, 60, 80, 120, 180, 240]) {
    for (const color of [false, true]) {
      const text = renderHud({ ...demoSnapshot, project: '项目🧪très-long'.repeat(10) }, { width, color });
      for (const line of text.split('\n')) assert.equal(visibleLength(line), width, `width ${width}: ${line}`);
    }
  }
});
test('HUD uses a clean rule and renders a moving compaction indicator only in color mode', () => {
  const normal = renderHud({ ...demoSnapshot, status: 'working' }, { width: 180, color: false, footer: true });
  assert.ok(!normal.includes('////'));
  const first = renderHud({ ...demoSnapshot, compacting: true, compactionFrame: 0 }, { width: 120, color: true, footer: true });
  const later = renderHud({ ...demoSnapshot, compacting: true, compactionFrame: 2 }, { width: 120, color: true, footer: true });
  assert.match(first, /COMPACTANDO/);
  assert.notEqual(first, later);
  const still = renderHud({ ...demoSnapshot, compacting: true, compactionFrame: 0 }, { width: 120, color: false, footer: true });
  const stillLater = renderHud({ ...demoSnapshot, compacting: true, compactionFrame: 2 }, { width: 120, color: false, footer: true });
  assert.match(still, /COMPACTANDO/);
  assert.equal(still, stillLater);
});
test('terminal control sequences from metadata cannot execute', () => {
  const text = renderHud({ ...demoSnapshot, project: '\x1b[2J\x1b]52;c;SECRET\x07\nproject', model: '\x1b[31mtest' }, { color: false });
  assert.ok(!text.includes('\x1b'));
  assert.ok(!safeText('\x1b[2Jtest\x07').includes('\x07'));
});
test('ASCII output and missing metrics do not invent demo values', () => {
  const text = renderHud({ status: 'unknown' }, { ascii: true, color: false, width: 80 });
  assert.match(text, /CTX/);
  assert.ok(!/[^\x00-\x7f]/.test(text));
  assert.ok(!text.includes('26%'));
  assert.ok(!text.includes('gpt-6-astra'));
});
test('CLI reports real fixture metadata and rejects invalid arguments', async t => {
  const { home } = await fixture(t);
  const { stdout } = await run(process.execPath, [cli, 'status', '--json', '--codex-home', home]);
  assert.equal(JSON.parse(stdout).id, 'session-1');
  await assert.rejects(run(process.execPath, [cli, 'status', '--width', 'abc']));
  await assert.rejects(run(process.execPath, [cli, 'status', '--unknown']));
  await assert.rejects(run(process.execPath, [cli, 'watch']));
});
test('launcher passes spaces and shell metacharacters literally', async t => {
  const { home } = await fixture(t);
  const script = path.join(home, 'fake codex.js'), output = path.join(home, 'args.json');
  await writeFile(script, `require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));`);
  const prompt = 'hello & $(echo nope) "quoted"';
  assert.equal(await launchCodex([script, output, prompt], { executable: process.execPath }), 0);
  const { readFile } = await import('node:fs/promises');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), [prompt]);
});
test('footer override preserves paths with spaces in valid TOML JSON', () => {
  const config = footerOverride('C:\\Program Files\\node.exe', 'C:\\My Hub\\cli.js', 'win32');
  const command = JSON.parse(config.slice(config.indexOf('=') + 1))[0];
  assert.match(command, /^command: "C:\\Program Files\\node.exe"/);
  assert.match(command, /status --footer --color$/);
  assert.throws(() => footerOverride('C:\\%BAD%\\node.exe', 'cli.js', 'win32'));
});
test('prompt entry treats flag-like text as a task, never a permission switch', () => {
  assert.deepEqual(promptArgs(' --dangerously-bypass-approvals-and-sandbox '), ['--', '--dangerously-bypass-approvals-and-sandbox']);
});
