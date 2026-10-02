import net from 'node:net';
import { layoutScreen } from './terminal-view.js';
import { safeText, clip } from './render.js';
import { once } from 'node:events';

export function renderPassiveHud(state, columns, rows, options = {}) {
  const footer = layoutScreen(columns, Math.max(16, rows + 8), state, options).footer;
  if (state.panelNote) footer[0] = clip(`>_ GAONA-HUB · ${safeText(state.panelNote)}`, columns - 1, options.ascii);
  return footer.slice(0, Math.max(1, rows - 1)).join('\r\n');
}

export async function passiveHud(channel, options = {}) {
  if (!channel || !/^\\\\\.\\pipe\\gaona-hub-[0-9a-f-]+$/i.test(channel)) throw new Error('Canal local del HUD inválido.');
  if (!process.stdout.isTTY) throw new Error('El panel requiere una terminal interactiva.');
  let socket;
  const deadline = Date.now() + 12000;
  // Ambos paneles se crean juntos; el proceso del HUD puede arrancar primero.
  while (true) {
    socket = net.createConnection(channel);
    try { await once(socket, 'connect'); break; }
    catch (error) {
      socket.destroy();
      if (!['ENOENT', 'ECONNREFUSED'].includes(error.code) || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  socket.setEncoding('utf8');
  let pending = '', state, previous = '', stopping = false;
  const draw = () => {
    if (!state || stopping) return;
    const rendered = renderPassiveHud(state, process.stdout.columns || 100, process.stdout.rows || 8, options);
    if (rendered !== previous) {
      previous = rendered;
      process.stdout.write('\x1b[H' + rendered + '\x1b[J');
    }
  };
  process.stdout.write('\x1b[2J\x1b[H\x1b[?25l');
  process.stdout.on('resize', draw);
  const stop = () => { stopping = true; socket.destroy(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const timer = setInterval(draw, 1000);
  try {
    await new Promise((resolve, reject) => {
      socket.on('data', data => {
        pending += data;
        if (pending.length > 256 * 1024) { socket.destroy(new Error('El mensaje de métricas supera el límite.')); return; }
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const parsed = JSON.parse(line);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { state = parsed; draw(); }
          } catch { /* Una métrica incompleta no altera el chat. */ }
        }
      });
      socket.once('error', reject);
      socket.once('close', resolve);
    });
  } finally {
    stopping = true;
    clearInterval(timer); socket.destroy();
    process.stdout.off('resize', draw);
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
    process.stdout.write('\x1b[0m\x1b[?25h');
  }
}
