// Prueba dos consolas independientes con Codex real, sin enviar prompts.
// No abre ventanas ni modifica la configuración del usuario.
import pty from 'node-pty';
import xterm from '@xterm/headless';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { nativePanel } from '../src/native-panel.js';
import { SessionStore } from '../src/sessions.js';
import { createHudChannel } from '../src/hud-channel.js';
import { prepareConsoleTitleObserver } from '../src/console-title.js';
import { titleSignals } from '../src/terminal-view.js';
import { launchCodex } from '../src/launch.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const cli = fileURLToPath(new URL('../bin/codex-hub.js', import.meta.url));
const here = fileURLToPath(import.meta.url);
const lines = terminal => Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true) || '');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

if (process.argv.includes('--child')) {
  let panel, finished, sawHud = false, bound = false, observerFailed = false;
  const titles = [];
  const reportFile = process.argv[process.argv.indexOf('--report') + 1];
  const report = { stage: 'inicio' };
  const record = fields => { Object.assign(report, fields); writeFileSync(reportFile, JSON.stringify(report)); };
  const view = new xterm.Terminal({ cols: 110, rows: 8, allowProposedApi: true });
  const store = new SessionStore(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const code = await nativePanel(store, { project: os.homedir(), color: false }, ['--no-alt-screen'], {
    env: { ...process.env, WT_SESSION: 'verificacion-local' },
    prepareObserver: (onTitle, onError) => prepareConsoleTitleObserver(title => { titles.push(title); record({ titles }); onTitle(title); }, () => { observerFailed = true; record({ observerFailed }); onError(); }),
    launch: async (args, options) => {
      record({ stage: 'iniciando Codex' });
      const code = await launchCodex(args, { ...options, onSpawn: child => { record({ stage: 'Codex activo', pid: child.pid }); options.onSpawn(child); } });
      record({ stage: 'Codex terminó', code });
      return code;
    },
    channelFactory: async () => {
      const channel = await createHudChannel();
      const publish = channel.publish;
      channel.publish = state => { bound ||= Boolean(state.connected); publish(state); };
      return channel;
    },
    openPane: async channel => {
      panel = pty.spawn(process.execPath, [cli, 'panel', '--channel', channel, '--no-color'], { cols: 110, rows: 8, env: process.env, useConpty: true });
      panel.onData(data => view.write(data, () => { sawHud ||= lines(view).some(line => line.includes('GAONA-HUB')); }));
      finished = new Promise(resolve => panel.onExit(event => { record({ panelExit: event.exitCode }); resolve(event); }));
    }
  });
  record({ stage: 'esperando cierre del panel' });
  await finished;
  view.dispose();
  console.log(`RESULTADO_PANEL:${JSON.stringify({ sawHud, bound, code, titleSeen: titles.some(title => titleSignals(title, { allowPending: true })), identitySeen: titles.some(title => titleSignals(title)), observerFailed, titles })}`);
  await new Promise(resolve => process.stdout.write('', resolve));
  process.exit(code);
} else {
  const view = new xterm.Terminal({ cols: 110, rows: 30, allowProposedApi: true });
  const reportFile = path.join(os.tmpdir(), `gaona-native-check-${randomUUID()}.json`);
  const child = pty.spawn(process.execPath, [here, '--child', '--report', reportFile], { cols: 110, rows: 30, env: process.env, useConpty: true });
  let ended = false, exitCode, wire = '';
  child.onData(data => { wire = (wire + data).slice(-12000); view.write(data); });
  view.onData(data => child.write(data));
  child.onExit(event => { ended = true; exitCode = event.exitCode; });
  const until = async (condition, label, timeout = 20000) => {
    const start = Date.now();
    while (!condition()) {
      if (ended || Date.now() - start > timeout) throw new Error(`No se completó: ${label}; salida=${exitCode}`);
      await sleep(100);
    }
  };
  try {
    await until(() => lines(view).some(line => line.includes('OpenAI Codex')), 'arranque nativo');
    assert.ok(!lines(view).some(line => line.includes('GAONA-HUB')));
    child.write('VERIFICACION_NATIVA');
    await until(() => lines(view).some(line => line.includes('VERIFICACION_NATIVA')), 'entrada directa');
    child.write('\x15');
    await until(() => !lines(view).some(line => line.includes('VERIFICACION_NATIVA')), 'limpieza del texto no enviado');
    view.resize(120, 35); child.resize(120, 35);
    await sleep(6000);
    assert.ok(!lines(view).some(line => line.includes('GAONA-HUB')));
    for (let attempt = 0; attempt < 4 && !ended; attempt++) { child.write('\x03'); await sleep(300); }
    await until(() => ended, 'cierre de ambas consolas', 15000);
    const match = /RESULTADO_PANEL:(\{[^\r\n]*\})/.exec(wire);
    assert.ok(match, 'El launcher debe informar cierre del panel.');
    const result = JSON.parse(match[1].replace(/\x1b\[[0-9;]*m/g, ''));
    assert.equal(result.sawHud, true, 'El panel debe dibujar el HUD.');
    assert.equal(result.code, 0);
    assert.equal(result.observerFailed, false);
    assert.equal(result.titleSeen, true, 'El observador debe recibir el modelo y estado de Codex.');
    console.log(JSON.stringify({ codexNativo: true, tecladoDirecto: true, redimensionado: true, hudSeparado: result.sawHud, tituloDetectado: result.titleSeen, identidadPersistida: result.identitySeen, metricasPersistidas: result.bound, cierre: exitCode, promptsEnviados: 0 }));
  } catch (error) {
    console.error(error.message);
    if (existsSync(reportFile)) console.error(readFileSync(reportFile, 'utf8'));
    process.exitCode = 1;
    if (!ended) child.kill();
  } finally { view.dispose(); if (existsSync(reportFile)) unlinkSync(reportFile); }
  await new Promise(resolve => process.stdout.write('', resolve));
  process.exit(process.exitCode || 0);
}
