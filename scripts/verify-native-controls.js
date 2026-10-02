// Verificación local con un PTY real: no abre enlaces ni envía mensajes a Codex.
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { drawFrame, layoutScreen } from '../src/terminal-view.js';

const layout = layoutScreen(100, 30, {}, { color: false });
const inner = new xterm.Terminal({ cols: layout.chatColumns, rows: layout.chatRows, allowProposedApi: true });
const outer = new xterm.Terminal({ cols: 100, rows: 30, allowProposedApi: true });
const write = (terminal, text) => new Promise(resolve => terminal.write(text, resolve));
const urls = ['https://example.com/prueba', 'file:///C:/Proyecto/archivo.js'];
const sequences = urls.map((url, i) => `\x1b]8;;${url}\x1b\\ENLACE${i}\x1b]8;;\x1b\\\r\n`).join('');
const payload = Buffer.from('\x1b[5;2~\x1b[6;2~\x1b[200~á🙂\x1b[201~FIN');
const fixture = `process.stdin.setRawMode(true); process.stdin.resume(); let data = Buffer.alloc(0); process.stdin.on('data', chunk => { data = Buffer.concat([data, chunk]); if (data.includes('FIN')) process.stdout.write('RECIBIDO:' + data.toString('hex') + '\\r\\n', () => process.exit(0)); }); process.stdout.write(${JSON.stringify(sequences + 'PREPARADO\r\n')});`;
let child, sent = false, exited = false, pending = Promise.resolve();
try {
  child = pty.spawn(process.execPath, ['-e', fixture], { cols: layout.chatColumns, rows: layout.chatRows, cwd: process.cwd(), env: { ...process.env, TERM: 'xterm-256color' }, useConpty: true });
  inner.onData(data => child.write(data));
  child.onData(data => {
    pending = pending.then(async () => {
      await write(inner, data);
      const text = Array.from({ length: inner.rows }, (_, row) => inner.buffer.active.getLine(row)?.translateToString(true) || '').join('\n');
      if (!sent && text.includes('PREPARADO')) {
        sent = true;
        // Divide también los caracteres UTF-8, sin convertirlos a texto.
        for (let i = 0; i < payload.length; i += 2) child.write(payload.subarray(i, i + 2));
      }
    });
  });
  let timeout;
  const exitCode = await new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('El PTY no completó la prueba en 15 segundos.')), 15000);
    child.onExit(event => { exited = true; clearTimeout(timeout); resolve(event.exitCode); });
  });
  await pending;
  assert.equal(exitCode, 0);
  await write(outer, drawFrame(inner, layout).text);
  const text = Array.from({ length: outer.rows }, (_, row) => outer.buffer.active.getLine(row)?.translateToString(true) || '').join('\n');
  assert.ok(text.includes(`RECIBIDO:${payload.toString('hex')}`));
  for (let row = 0; row < urls.length; row++) {
    const cell = outer.buffer.active.getLine(row).getCell(0);
    assert.equal(outer._core._oscLinkService.getLinkData(cell.extended.urlId)?.uri, urls[row]);
  }
  console.log('ConPTY y render: enlaces web/archivo conservados. Transporte PTY: UTF-8 íntegro.');
  console.log('Pendiente manual: Ctrl+clic y selección en la ventana real de Windows Terminal.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  try { if (!exited) child?.kill(); } catch { /* El proceso de prueba puede haber terminado. */ }
  inner.dispose(); outer.dispose();
}
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(process.exitCode || 0);
