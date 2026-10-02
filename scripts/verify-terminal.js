// Manual Windows/TTY smoke test. Starts and closes a real Codex session without
// submitting a prompt. No transcript text is written to the report or disk.
import pty from 'node-pty';
import xterm from '@xterm/headless';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const cli = process.argv[2] || fileURLToPath(new URL('../bin/codex-hub.js', import.meta.url));
const id = process.argv[3];
const args = [cli, '--integrated', '--no-update', '--project', process.argv[4] || os.homedir(), '--', '--no-alt-screen', '-c', 'tui.resume_cwd="session"', ...(id ? ['fork', id] : [])];
const terminal = new xterm.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
const titles = [];
terminal.onTitleChange(title => titles.push(title));
const child = pty.spawn(process.execPath, args, { cols: 80, rows: 24, cwd: process.cwd(), env: { ...process.env, TERM: 'xterm-256color' }, useConpty: true });
child.onData(data => terminal.write(data));
terminal.onData(data => child.write(data));
let exited = false, exitCode;
child.onExit(event => { exited = true; exitCode = event.exitCode; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lines = () => Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true) || '');
const hudRow = () => lines().findLastIndex(line => line.startsWith('>_ GAONA-HUB'));
async function until(predicate, label, timeout = 30000) {
  const start = Date.now();
  while (!predicate()) {
    if (exited) throw new Error(`Codex terminó antes de completar ${label}: código ${exitCode}`);
    if (Date.now() - start > timeout) throw new Error(`Timeout: ${label}`);
    await sleep(100);
  }
}
try {
  await until(() => hudRow() >= 0 && lines().some(line => line.includes('OpenAI Codex')), 'chat + HUD');
  if (id) await until(() => lines().slice(hudRow() + 1).some(line => /gpt[-\s]/i.test(line)), 'bound model metadata');
  assert.ok(titles.length > 0, 'project title is emitted');
  assert.ok(titles.every(title => !title.includes('GAONA-HUB') && !title.includes('byGaona')), 'branding stays in the HUD, outside the window title');
  let heading = hudRow();
  assert.ok(heading > 8 && heading < 24);
  child.write('HUB_KEYBOARD_CHECK');
  await until(() => lines().some(line => line.includes('HUB_KEYBOARD_CHECK')), 'keyboard forwarding');
  child.write('\x15'); // Clear the unsent text, never submit it.
  terminal.resize(120, 35); child.resize(120, 35);
  await until(() => { heading = hudRow(); return heading >= 25 && lines().slice(heading + 1).some(line => line.includes('CTX')); }, 'resized footer');
  assert.ok(terminal.buffer.active.cursorY < heading);
  console.log(JSON.stringify({ chat: true, bottomHud: true, sessionMetadata: Boolean(id), keyboard: true, resize: '80x24 -> 120x35', cursorAboveHud: true }));
  child.write('\x03');
  for (let i = 0; i < 50 && !exited; i++) await sleep(100);
  if (!exited) child.write('\x03');
  await until(() => exited, 'normal shutdown', 15000);
  assert.equal(exitCode, 0);
  terminal.dispose();
  console.log('Normal exit: 0. No prompt was submitted.');
  process.exit(0);
} catch (error) {
  console.error(error.message);
  console.error(JSON.stringify({ titles, rows: lines().map((line, row) => ({ row, hud: line.includes('GAONA-HUB'), composer: /^\s*›/.test(line), nativeId: /^\s*[0-9a-f]{8}-[0-9a-f-]{27}/i.test(line), model: /gpt-/.test(line), pendingDirectoryChoice: /current directory|session.*directory|directory.*session/i.test(line) })).filter(row => Object.values(row).slice(1).some(Boolean)) }));
  try { child.kill(); } catch { /* exited */ }
  terminal.dispose();
  process.exit(1);
}
