import pty from 'node-pty';
import xterm from '@xterm/headless';
import os from 'node:os';
import path from 'node:path';
import { CommandTracker } from './command-tracker.js';
import { resolveCodex } from './launch.js';
import { layoutScreen, drawFrame, titleSignals } from './terminal-view.js';
import { toSnapshot } from './signals.js';

// A real Codex process owns the chat; its VT output is confined to the upper
// viewport. The outer terminal owns the fixed footer and forwards input.
export function projectWindowTitle(state, cwd, { title, home = os.homedir() } = {}) {
  const clean = value => typeof value === 'string' ? Array.from(value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 90).join('') : '';
  const named = clean(title) || clean(state.threadName);
  if (named) return named;
  const directory = state.cwd || cwd;
  if (path.resolve(directory) === path.resolve(home)) return 'Nueva tarea';
  return clean(state.project || path.win32.basename(directory.replace(/[\\/]+$/, '')) || directory) || 'Codex';
}

export async function integratedTerminal(store, options, args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('El chat integrado requiere una terminal interactiva. Usa run --plain para comandos sin terminal.');
  const cwd = options.project || process.cwd();
  let state = toSnapshot({ cwd }), selected = null, announced = null, layout, frame = [], stopped = false;
  let painting = null, refreshing = false, timer, child, active = false;
  let runtimeSignals = {};
  let windowTitle = null;
  const updateTitle = () => {
    const label = projectWindowTitle(state, cwd, options);
    if (label !== windowTitle) {
      windowTitle = label;
      process.stdout.write(`\x1b]0;${label}\x07`);
    }
  };
  const commands = new CommandTracker();
  const dimensions = () => ({ cols: Math.max(20, process.stdout.columns || 120), rows: Math.max(10, process.stdout.rows || 30) });
  const size = dimensions();
  layout = layoutScreen(size.cols, size.rows, state, options);
  const terminal = new xterm.Terminal({ cols: size.cols, rows: layout.chatRows, scrollback: 10000, allowProposedApi: true, windowsPty: process.platform === 'win32' ? { backend: 'conpty', buildNumber: Number(os.release().split('.')[2]) } : undefined });
  const oldRaw = Boolean(process.stdin.isRaw);
  const modeReset = '\x1b[?1l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l';
  let modeKey = '';
  const paint = () => {
    painting = null;
    if (stopped) return;
    const modes = terminal.modes;
    const newModeKey = JSON.stringify([modes.applicationCursorKeysMode, modes.bracketedPasteMode, modes.sendFocusMode, modes.mouseTrackingMode]);
    let output = '';
    if (newModeKey !== modeKey) {
      modeKey = newModeKey;
      output += modeReset;
      if (modes.applicationCursorKeysMode) output += '\x1b[?1h';
      if (modes.bracketedPasteMode) output += '\x1b[?2004h';
      if (modes.sendFocusMode) output += '\x1b[?1004h';
      const mouse = { vt200: 1000, drag: 1002, any: 1003 }[modes.mouseTrackingMode];
      if (mouse) output += `\x1b[?${mouse}h\x1b[?1006h`;
    }
    const result = drawFrame(terminal, layout, frame);
    frame = result.lines;
    process.stdout.write(output + result.text);
  };
  const schedule = () => { if (!painting && !stopped) painting = setTimeout(paint, 25); };
  const refresh = async () => {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      if (announced && !selected) {
        const prefix = announced;
        const resolved = await store.resolveSession(prefix);
        if (announced === prefix) selected = resolved;
      }
      const id = selected;
      // Unbound means unknown. Never borrow another active agent's session.
      if (id) {
        const snapshot = await store.snapshot(id);
        if (selected === id && !snapshot.error) state = { ...snapshot, ...runtimeSignals };
      }
      const current = dimensions();
      const next = layoutScreen(current.cols, current.rows, state, options);
      if (terminal.cols !== current.cols || terminal.rows !== next.chatRows) {
        terminal.resize(current.cols, next.chatRows);
        child?.resize(current.cols, next.chatRows);
        frame = [];
      }
      layout = next;
      updateTitle();
      schedule();
    } finally { refreshing = false; }
  };
  const input = data => {
    const value = data.toString('utf8');
    if (value === '\x1b[5;2~' || value === '\x1b[6;2~') {
      terminal.scrollLines(value.includes('5;') ? -layout.chatRows : layout.chatRows);
      schedule();
      return;
    }
    // Mouse events in the reserved footer must not reach the chat.
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(value) && Number(value.match(/;(\d+)[Mm]$/)[1]) > layout.chatRows) return;
    terminal.scrollToBottom();
    const submitted = commands.accept(value);
    if (submitted?.kind === 'command') runtimeSignals.lastCommand = submitted.name;
    if (submitted?.kind === 'skill') runtimeSignals.skill = submitted.name.slice(1);
    if (submitted) { state = { ...state, ...runtimeSignals }; schedule(); }
    child.write(value);
  };
  const resize = () => { frame = []; void refresh(); };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer); clearTimeout(painting);
    process.stdin.off('data', input); process.stdout.off('resize', resize);
    if (active) {
      process.stdin.setRawMode(oldRaw); process.stdin.pause();
      process.stdout.write(modeReset + '\x1b[0m\x1b[?25h\x1b[?1049l');
    }
    terminal.dispose();
  };
  try {
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.CODEX_THREAD_ID; delete env.CODEX_SESSION_ID;
    child = pty.spawn(resolveCodex(options.executable), ['-c', 'tui.terminal_title=["session-id","model","reasoning","status","fast-mode"]', '-c', 'tui.status_line=[]', ...args], { name: 'xterm-256color', cols: size.cols, rows: layout.chatRows, cwd, env, useConpty: true });
    process.stdout.write('\x1b[?1049h\x1b[2J');
    active = true;
    updateTitle();
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdin.on('data', input); process.stdout.on('resize', resize);
    terminal.onData(data => child.write(data)); // DSR and device attribute replies.
    terminal.onTitleChange(title => {
      const parsed = titleSignals(title), id = parsed?.prefix;
      if (parsed) runtimeSignals = { ...runtimeSignals, ...parsed.signals };
      if (id && id !== announced) {
        announced = id;
        selected = null;
        state = { ...toSnapshot({ id, cwd, status: 'connecting' }), connected: true };
        store.refreshed = 0;
        void refresh();
      }
      if (parsed) { state = { ...state, ...runtimeSignals }; void refresh(); }
      updateTitle();
    });
    child.onData(data => terminal.write(data, schedule));
    timer = setInterval(() => void refresh(), 1000);
    paint();
    return await new Promise(resolve => child.onExit(event => { cleanup(); resolve(event.exitCode); }));
  } catch (error) {
    cleanup();
    try { child?.kill(); } catch { /* Already exited. */ }
    throw error;
  }
}
