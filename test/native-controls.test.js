import test from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { drawFrame, layoutScreen } from '../src/terminal-view.js';

const write = (terminal, text) => new Promise(resolve => terminal.write(text, resolve));
function emulator(t, cols = 80, rows = 24) {
  const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  t.after(() => terminal.dispose());
  return terminal;
}
// Comprueba el destino que recibiría el terminal exterior, no sólo el texto.
function linkAt(terminal, row, col) {
  const cell = terminal.buffer.active.getLine(row)?.getCell(col);
  return terminal._core._oscLinkService.getLinkData(cell?.extended?.urlId)?.uri;
}

for (const uri of ['https://example.com/documentacion?q=1', 'file:///C:/Proyecto/archivo.js', 'vscode://file/C:/Proyecto/archivo.js:12']) {
  test(`el repintado conserva el enlace nativo ${uri}`, async t => {
    const layout = layoutScreen(80, 24, {}, { color: false });
    const inner = emulator(t, layout.chatColumns, layout.chatRows);
    const outer = emulator(t);
    const sequence = `\x1b]8;id=prueba;${uri}\x1b\\Abrir archivo\x1b]8;;\x1b\\ texto normal`;
    // Incluye fragmentos de OSC separados entre lecturas del PTY.
    for (let i = 0; i < sequence.length; i += 3) await write(inner, sequence.slice(i, i + 3));
    const first = drawFrame(inner, layout);
    await write(outer, first.text);
    assert.equal(linkAt(outer, 0, 0), uri);
    assert.equal(linkAt(outer, 0, 14), undefined);
    assert.equal(linkAt(outer, layout.chatRows, 0), undefined);
    // Borrar y sobrescribir el enlace debe eliminar su destino anterior.
    await write(inner, '\x1b[H\x1b[2KTexto sin enlace');
    await write(outer, drawFrame(inner, layout, first.lines, 0, { previousCursor: first.cursor }).text);
    assert.equal(linkAt(outer, 0, 0), undefined);
  });
}

test('una pantalla idéntica no emite bytes ni interrumpe la interacción nativa', async t => {
  const inner = emulator(t);
  await write(inner, 'https://example.com');
  const layout = layoutScreen(80, 24, {}, { color: false });
  const first = drawFrame(inner, layout);
  const unchanged = drawFrame(inner, layout, first.lines, 0, { previousCursor: first.cursor });
  assert.equal(unchanged.text, '');
  await write(inner, '\x1b[2;3H');
  const moved = drawFrame(inner, layout, first.lines, 0, { previousCursor: first.cursor });
  assert.notEqual(moved.text, '');
});
