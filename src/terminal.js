import pty from 'node-pty';
import xterm from '@xterm/headless';
import os from 'node:os';
import path from 'node:path';
import { CommandTracker } from './command-tracker.js';
import { resolveCodex } from './launch.js';
import { layoutScreen, drawFrame, titleSignals, modelPickerState, isCompacting } from './terminal-view.js';
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

export function applyCompactionView(terminal, child, frame, layout, state, runtimeSignals, compacting, frameNumber, options) {
  const nextRuntimeSignals = { ...runtimeSignals, compacting };
  if (compacting) nextRuntimeSignals.compactionFrame = frameNumber;
  else delete nextRuntimeSignals.compactionFrame;
  const nextState = { ...state, ...nextRuntimeSignals };
  if (!compacting) delete nextState.compactionFrame;
  const nextLayout = layoutScreen(layout.columns, layout.rows, nextState, options);
  let nextFrame = frame;
  if (terminal.cols !== nextLayout.columns || terminal.rows !== nextLayout.chatRows) {
    terminal.resize(nextLayout.columns, nextLayout.chatRows);
    child?.resize(nextLayout.columns, nextLayout.chatRows);
    nextFrame = [];
  }
  return {
    runtimeSignals: nextRuntimeSignals,
    state: nextState,
    layout: nextLayout,
    frame: nextFrame
  };
}

const pasteStart = '\x1b[200~';
const pasteEnd = '\x1b[201~';
const shiftPageUp = '\x1b[5;2~';
const shiftPageDown = '\x1b[6;2~';

function suffixPrefixLength(value, markers) {
  for (let size = Math.min(value.length, Math.max(...markers.map(marker => marker.length))); size > 0; size--) {
    const suffix = value.slice(-size);
    if (markers.some(marker => marker.startsWith(suffix))) return size;
  }
  return 0;
}

// Conserva los reportes SGR entre fragmentos y no interpreta escapes dentro
// del contenido de un pegado entre corchetes.
function inputTokens(chunk, state) {
  const source = state.pending + chunk;
  const tokens = [];
  let text = '';
  let index = 0;
  state.pending = '';
  const flushText = () => {
    if (text) tokens.push({ type: 'text', value: text });
    text = '';
  };

  while (index < source.length) {
    if (state.pasting) {
      const end = source.indexOf(pasteEnd, index);
      if (end < 0) {
        const remainder = source.slice(index);
        const keep = suffixPrefixLength(remainder, [pasteEnd]);
        text += remainder.slice(0, remainder.length - keep);
        state.pending = remainder.slice(remainder.length - keep);
        break;
      }
      text += source.slice(index, end + pasteEnd.length);
      index = end + pasteEnd.length;
      state.pasting = false;
      continue;
    }

    const markers = [pasteStart, shiftPageUp, shiftPageDown, '\x1b[<'];
    let next = -1, marker = '';
    for (const candidate of markers) {
      const at = source.indexOf(candidate, index);
      if (at >= 0 && (next < 0 || at < next)) { next = at; marker = candidate; }
    }
    if (next < 0) {
      const remainder = source.slice(index);
      const keep = suffixPrefixLength(remainder, markers);
      text += remainder.slice(0, remainder.length - keep);
      state.pending = remainder.slice(remainder.length - keep);
      break;
    }
    text += source.slice(index, next);
    if (marker === pasteStart) {
      text += pasteStart;
      state.pasting = true;
      index = next + pasteStart.length;
      continue;
    }
    if (marker === shiftPageUp || marker === shiftPageDown) {
      flushText();
      tokens.push({ type: 'key', direction: marker === shiftPageUp ? -1 : 1 });
      index = next + marker.length;
      continue;
    }

    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(source.slice(next));
    if (mouse) {
      flushText();
      tokens.push({ type: 'mouse', raw: mouse[0], code: Number(mouse[1]), y: Number(mouse[3]) });
      index = next + mouse[0].length;
      continue;
    }
    const remainder = source.slice(next);
    if (remainder.length <= 64 && /^\x1b\[<(?:\d+(?:;\d*(?:;\d*)?)?)?$/.test(remainder)) {
      flushText();
      state.pending = remainder;
      break;
    }
    text += '\x1b[<';
    index = next + 3;
  }
  flushText();
  return tokens;
}

export async function integratedTerminal(store, options, args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('El chat integrado requiere una terminal interactiva. Usa run --plain para comandos sin terminal.');
  const cwd = options.project || process.cwd();
  let state = toSnapshot({ cwd }), selected = null, announced = null, layout, frame = [], stopped = false;
  let painting = null, refreshing = false, timer, compactionTimer, inputFlushTimer, child, active = false;
  const inputState = { pending: '', pasting: false };
  let runtimeSignals = {};
  let selectedModel = null;
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
      // Captura la rueda en el HUB aunque Codex no solicite tracking; si no,
      // Windows Terminal puede convertirla en flechas.
      const mouse = { x10: 1000, vt200: 1000, drag: 1002, any: 1003 }[modes.mouseTrackingMode] || 1000;
      output += `\x1b[?${mouse}h\x1b[?1006h`;
    }
    const result = drawFrame(terminal, layout, frame);
    frame = result.lines;
    process.stdout.write(output + result.text);
  };
  const schedule = () => { if (!painting && !stopped) painting = setTimeout(paint, 25); };
  const setSelectedModel = model => {
    if (!model) return;
    selectedModel = model;
    runtimeSignals = { ...runtimeSignals, model };
    state = { ...state, model };
    schedule();
  };
  const syncCompaction = () => {
    const compacting = isCompacting(terminal);
    if (compacting === Boolean(runtimeSignals.compacting)) return;
    clearInterval(compactionTimer);
    const updateView = (active, frameNumber) => {
      const next = applyCompactionView(terminal, child, frame, layout, state, runtimeSignals, active, frameNumber, options);
      runtimeSignals = next.runtimeSignals;
      state = next.state;
      layout = next.layout;
      frame = next.frame;
    };
    if (compacting) {
      updateView(true, 0);
      if (options.color !== false) {
        compactionTimer = setInterval(() => {
          if (!isCompacting(terminal)) { syncCompaction(); return; }
          updateView(true, (runtimeSignals.compactionFrame + 1) % 6);
          schedule();
        }, 180);
      }
    } else {
      updateView(false, 0);
    }
    schedule();
  };
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
        if (selected === id && !snapshot.error) {
          state = { ...snapshot, ...runtimeSignals, ...(selectedModel ? { model: selectedModel } : {}) };
        }
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
  const scrollChat = (direction, lines = layout.chatRows) => {
    if (terminal.buffer.active.type === 'alternate') {
      child.write(direction < 0 ? '\x1b[5~' : '\x1b[6~');
      return;
    }
    terminal.scrollLines(direction * lines);
    schedule();
  };
  const forward = value => {
    if (!value) return;
    if (value.includes('\r')) setSelectedModel(modelPickerState(terminal)?.active);
    terminal.scrollToBottom();
    const submitted = commands.accept(value);
    if (submitted?.kind === 'command') runtimeSignals.lastCommand = submitted.name;
    if (submitted?.kind === 'skill') runtimeSignals.skill = submitted.name.slice(1);
    if (submitted) { state = { ...state, ...runtimeSignals }; schedule(); }
    child.write(value);
  };
  const input = data => {
    clearTimeout(inputFlushTimer);
    for (const token of inputTokens(data.toString('utf8'), inputState)) {
      if (token.type === 'text') {
        forward(token.value);
        continue;
      }
      if (token.type === 'key') {
        scrollChat(token.direction);
        continue;
      }
      // Los eventos del pie pertenecen al HUD. La rueda vertical desplaza la
      // conversación en vez de llegar al editor como historial de flechas.
      if (token.y > layout.chatRows) continue;
      const verticalWheel = (token.code & 64) !== 0 && (token.code & 2) === 0;
      if (verticalWheel) {
        const direction = (token.code & 1) === 0 ? -1 : 1;
        const buffer = terminal.buffer.active;
        const childTracksMouse = terminal.modes.mouseTrackingMode && terminal.modes.mouseTrackingMode !== 'none';
        if (buffer.type === 'alternate' && childTracksMouse) child.write(token.raw);
        else scrollChat(direction, 3);
        continue;
      }
      const buffer = terminal.buffer.active;
      if (buffer.type === 'normal' && buffer.viewportY < buffer.baseY) continue;
      if (!terminal.modes.mouseTrackingMode || terminal.modes.mouseTrackingMode === 'none') continue;
      child.write(token.raw);
    }
    // Escape sola es una tecla válida. Espera brevemente por si viene una
    // secuencia más larga; después, reenvía el prefijo incompleto.
    if (inputState.pending && !inputState.pasting && !inputState.pending.startsWith('\x1b[<')) {
      inputFlushTimer = setTimeout(() => {
        const pending = inputState.pending;
        inputState.pending = '';
        if (!inputState.pasting) forward(pending);
      }, 50);
    }
  };
  const resize = () => { frame = []; void refresh(); };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer); clearInterval(compactionTimer); clearTimeout(painting); clearTimeout(inputFlushTimer);
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
      if (id && id !== announced) {
        announced = id;
        selected = null;
        selectedModel = null;
        delete runtimeSignals.model;
        state = { ...toSnapshot({ id, cwd, status: 'connecting' }), connected: true };
        store.refreshed = 0;
        void refresh();
      }
      if (parsed) {
        runtimeSignals = { ...runtimeSignals, ...parsed.signals };
        state = { ...state, ...runtimeSignals, ...(selectedModel ? { model: selectedModel } : {}) };
        void refresh();
      }
      updateTitle();
    });
    child.onData(data => terminal.write(data, () => {
      const picker = modelPickerState(terminal);
      if (picker) setSelectedModel(picker.current);
      syncCompaction();
      schedule();
    }));
    timer = setInterval(() => void refresh(), 1000);
    paint();
    return await new Promise(resolve => child.onExit(event => { cleanup(); resolve(event.exitCode); }));
  } catch (error) {
    cleanup();
    try { child?.kill(); } catch { /* Already exited. */ }
    throw error;
  }
}
