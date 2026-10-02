import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { launchCodex } from './launch.js';
import { nativePanel } from './native-panel.js';
import { SessionStore } from './sessions.js';

const run = promisify(execFile);
const pipe = suffix => `\\\\.\\pipe\\gaona-hub-${suffix}`;

export function windowArguments(name, bootstrap, channel, { node = process.execPath, cli = fileURLToPath(new URL('../bin/codex-hub.js', import.meta.url)), rows = process.stdout.rows || 30, ascii = false, color = true, title } = {}) {
  if ([name, node, cli, bootstrap, channel].some(value => /[;\r\n]/.test(value))) throw new Error('La ruta contiene un separador incompatible con Windows Terminal.');
  const size = Math.min(0.4, Math.max(0.12, 7 / Math.max(20, rows)));
  const label = String(title || '').replace(/[;\x00-\x1f\x7f-\x9f]/g, ' ').trim().slice(0, 90) || 'Codex · GAONA-HUB';
  return ['-w', name, 'new-tab', '--title', label, '--suppressApplicationTitle', node, cli, 'window', '--channel', bootstrap,
    ';', 'split-pane', '-H', '--size', String(size), '--title', 'GAONA-HUB', '--suppressApplicationTitle', node, cli, 'panel', '--channel', channel,
    ...(ascii ? ['--ascii'] : []), ...(color === false ? ['--no-color'] : []), ';', 'move-focus', 'up'];
}

export async function nativeWindow(options, args, dependencies = {}) {
  const { platform = process.platform, launch = launchCodex, execute = run,
    log = text => process.stderr.write(`GAONA-HUB: ${text}\n`) } = dependencies;
  const cwd = options.project || process.cwd();
  if (platform !== 'win32') {
    log('El panel inferior requiere Windows Terminal. Codex continúa con sus controles nativos.');
    return launch(args, { executable: options.executable, cwd });
  }
  const id = randomUUID(), name = `GAONA-HUB-${id}`;
  const bootstrap = pipe(`launch-${id}`), channel = pipe(randomUUID());
  let client, connected = false, timer, settle;
  const completed = new Promise(resolve => { settle = resolve; });
  const server = net.createServer(socket => {
    if (connected) { socket.destroy(); return; }
    connected = true; client = socket; clearTimeout(timer);
    // Argumentos y entorno viajan sólo por el pipe local: nunca en archivos,
    // logs ni en la cadena de comandos que Windows Terminal interpreta.
    socket.write(JSON.stringify({ options: { ...options, project: cwd, precreatedChannel: channel }, args, environment: process.env }) + '\n');
    let response = '';
    socket.setEncoding('utf8');
    socket.on('data', data => {
      response += data;
      if (response.length > 1024) { socket.destroy(); return; }
      let newline;
      while ((newline = response.indexOf('\n')) >= 0) {
        const line = response.slice(0, newline);
        response = response.slice(newline + 1);
        try {
          const result = JSON.parse(line);
          if (typeof result.ready === 'boolean') dependencies.onReady?.(result.ready);
          if (Number.isInteger(result.exitCode)) settle(result.exitCode);
        }
        catch { /* El cierre del canal resolverá el fallo. */ }
      }
    });
    socket.on('error', () => settle(1));
    socket.on('close', () => settle(1));
  });
  server.maxConnections = 1;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(bootstrap, resolve); });
    timer = setTimeout(() => settle(null), 15000);
    await execute('wt.exe', windowArguments(name, bootstrap, channel, options), { windowsHide: true, timeout: 10000 });
    const result = await completed;
    if (result !== null) return result;
  } catch {
    if (connected) return 1;
  } finally {
    clearTimeout(timer); client?.destroy();
    await new Promise(resolve => { if (server.listening) server.close(resolve); else resolve(); });
  }
  log('No se pudo abrir la ventana del HUD. Codex continúa con sus controles nativos.');
  return launch(args, { executable: options.executable, cwd });
}

export async function receiveNativeWindow(channel) {
  if (!/^\\\\\.\\pipe\\gaona-hub-launch-[0-9a-f-]+$/i.test(channel || '')) throw new Error('Canal de inicio inválido.');
  const socket = net.createConnection(channel);
  socket.setEncoding('utf8');
  try {
    const configuration = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('No llegó la configuración del launcher.')); }, 15000);
      const data = chunk => {
        text += chunk;
        if (text.length > 2 * 1024 * 1024) { clearTimeout(timer); reject(new Error('Configuración de inicio demasiado grande.')); return; }
        const newline = text.indexOf('\n');
        if (newline >= 0) {
          clearTimeout(timer); socket.off('data', data);
          try { resolve(JSON.parse(text.slice(0, newline))); } catch { reject(new Error('Configuración de inicio inválida.')); }
        }
      };
      socket.on('data', data);
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('close', () => { clearTimeout(timer); reject(new Error('El launcher se desconectó antes de iniciar.')); });
    });
    const { options, args, environment } = configuration;
    if (!options || !Array.isArray(args) || !args.every(arg => typeof arg === 'string') || typeof options.codexHome !== 'string') throw new Error('Argumentos de inicio inválidos.');
    const launchEnv = { ...environment, WT_SESSION: process.env.WT_SESSION, WT_PROFILE_ID: process.env.WT_PROFILE_ID };
    delete launchEnv.CODEX_THREAD_ID; delete launchEnv.CODEX_SESSION_ID;
    const code = await nativePanel(new SessionStore(options.codexHome), { ...options, launchEnv }, args, {
      onReady: ready => { if (!socket.destroyed) socket.write(JSON.stringify({ ready }) + '\n'); }
    });
    if (!socket.destroyed) await new Promise(resolve => socket.end(JSON.stringify({ exitCode: code }) + '\n', resolve));
    return code;
  } finally { socket.destroy(); }
}
