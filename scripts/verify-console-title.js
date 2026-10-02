// Comprueba lectura de título de sólo lectura en una consola Windows real.
import assert from 'node:assert/strict';
import pty from 'node-pty';
import { observeConsoleTitle } from '../src/console-title.js';

const title = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbb... | gpt-6-sol | high | Ready';
const code = `process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.on('data', () => process.exit(0)); process.stdout.write(${JSON.stringify(`]0;${title}`)}); setTimeout(() => process.exit(0), 15000);`;
const child = pty.spawn(process.execPath, ['-e', code], { cols: 100, rows: 20, env: process.env, useConpty: true });
child.onData(() => {});
let stop, timer, inputTimer, ended = false;
const finished = new Promise(resolve => child.onExit(event => { ended = true; resolve(event); }));
try {
  const actual = await new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No llegó el título de la consola.')), 12000);
    stop = observeConsoleTitle(child.pid, value => { console.log(JSON.stringify({ tituloDeLaConsolaDePrueba: value })); if (value === title) resolve(value); }, () => reject(new Error('Falló el observador de título.')));
  });
  assert.equal(actual, title);
  child.write('q');
  const result = await Promise.race([finished, new Promise((_, reject) => {
    inputTimer = setTimeout(() => reject(new Error('El observador interfirió con la entrada raw de la consola.')), 2500);
  })]);
  assert.equal(result.exitCode, 0);
  console.log('Título leído; la consola observada conservó su entrada raw mientras el auxiliar estaba conectado.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timer); clearTimeout(inputTimer); stop?.(); if (!ended) child.kill();
}
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(process.exitCode || 0);
