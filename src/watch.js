import { emitKeypressEvents } from 'node:readline';
import { renderHud } from './render.js';
import { launchCodex, promptArgs } from './launch.js';

export async function watch(store, options) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) throw new Error('El HUD en vivo requiere una terminal interactiva. Usa status --json en scripts.');
  let stopped = false, entering = false, input = '', note = '', session = options.session, busy = false, latest;
  const enter = () => { process.stdout.write('\x1b[?1049h\x1b[2J\x1b[?25l'); process.stdin.setRawMode(true); process.stdin.resume(); };
  const leave = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\x1b[?25h\x1b[?1049l'); };
  const stop = () => { stopped = true; };
  const redraw = () => {
    if (busy || stopped || !latest) return;
    const width = options.fixedWidth ? options.width : process.stdout.columns ?? options.width;
    process.stdout.write('\x1b[H' + renderHud(latest, { ...options, width, input, entering, note }) + '\n\x1b[J');
  };
  const keypress = async (text, key = {}) => {
    if (busy) return;
    if (key.ctrl && key.name === 'c') { stop(); return; }
    if (key.ctrl && key.name === 'k') { entering = !entering; input = ''; note = ''; }
    else if (key.name === 'escape') { entering = false; input = ''; }
    else if (entering && key.name === 'backspace') input = [...input].slice(0, -1).join('');
    else if (entering && key.name === 'return' && input.trim()) {
      busy = true;
      leave();
      try { const code = await launchCodex(promptArgs(input), { executable: options.executable, cwd: options.project || latest.cwd || process.cwd() }); note = code === 0 ? 'De vuelta en el Hub · Ctrl+K iniciar otra tarea' : `Codex terminó con código ${code} · Ctrl+K reintentar`; }
      catch (error) { note = error.message; }
      input = ''; entering = false; busy = false;
      if (!stopped) enter();
    } else if (entering && text && !key.ctrl && !key.meta) input += text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 4000 - input.length);
    else if (!entering && key.name === 'n' && latest?.sessions.length) {
      const index = latest.sessions.findIndex(item => item.id === latest.id);
      session = latest.sessions[(index + 1) % latest.sessions.length].id;
      note = 'Sesión seleccionada · N cambiar · Ctrl+K escribir';
    }
    redraw();
  };
  emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', keypress);
  process.stdout.on('resize', redraw);
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  enter();
  try {
    while (!stopped) {
      if (!busy) { latest = await store.snapshot(session, options.project); redraw(); }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  } finally {
    leave(); process.stdin.removeListener('keypress', keypress); process.stdout.removeListener('resize', redraw);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
