import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { launchCodex, resolveCodex } from '../src/launch.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { nativePanel } from '../src/native-panel.js';
import { titleSignals } from '../src/terminal-view.js';
import { windowArguments, nativeWindow } from '../src/native-window.js';
import { createHudChannel } from '../src/hud-channel.js';
import { renderPassiveHud } from '../src/passive-hud.js';
import { demoSnapshot } from '../src/render.js';
import net from 'node:net';
import { once } from 'node:events';

test('el panel usa una división inferior y devuelve el foco al chat sin shell', () => {
  const args = windowArguments('GAONA-HUB-unica', 'inicio', 'canal', { node: 'C:\\Program Files\\node.exe', cli: 'C:\\Mi Hub\\cli.js', rows: 30 });
  assert.deepEqual(args.slice(0, 3), ['-w', 'GAONA-HUB-unica', 'new-tab']);
  const size = Number(args[args.indexOf('--size') + 1]);
  assert.ok(size > 0 && size < 0.5);
  assert.ok(args.includes('C:\\Mi Hub\\cli.js'));
  assert.deepEqual(args.slice(-3), [';', 'move-focus', 'up']);
  assert.throws(() => windowArguments('ventana', 'inicio', 'canal', { node: 'node', cli: 'C:\\a;new-tab\\cli.js' }), /ruta/i);
});

test('el arranque aislado transporta argumentos literales fuera de la sintaxis de WT', { skip: process.platform !== 'win32' }, async () => {
  const sensitiveArgument = 'texto; new-tab & argumento literal';
  let ready = false;
  const code = await nativeWindow({ codexHome: 'C:\\home', project: 'C:\\proyecto;literal' }, [sensitiveArgument], {
    onReady: value => { ready = value; },
    execute: async (exe, args) => {
      assert.equal(exe, 'wt.exe');
      assert.notEqual(args[1], '0');
      assert.ok(!args.includes(sensitiveArgument));
      assert.ok(!args.includes('C:\\proyecto;literal'));
      const socket = net.createConnection(args[args.indexOf('--channel') + 1]);
      const [packet] = await once(socket, 'data');
      const config = JSON.parse(packet.toString());
      assert.deepEqual(config.args, [sensitiveArgument]);
      assert.equal(config.options.project, 'C:\\proyecto;literal');
      socket.end(JSON.stringify({ ready: true }) + '\n' + JSON.stringify({ exitCode: 5 }) + '\n');
    }
  });
  assert.equal(code, 5);
  assert.equal(ready, true);
});

test('Codex recibe los tres descriptores heredados y argumentos literales', async () => {
  let actual;
  const spawnProcess = (exe, args, options) => {
    actual = { exe, args, options };
    const child = new EventEmitter();
    process.nextTick(() => { child.emit('spawn'); child.emit('exit', 0); });
    return child;
  };
  await launchCodex(['resume', 'id', '--', 'texto & sin shell'], { executable: 'codex.exe', spawnProcess });
  assert.equal(actual.options.stdio, 'inherit');
  assert.equal(actual.options.shell, false);
  assert.deepEqual(actual.args, ['resume', 'id', '--', 'texto & sin shell']);
});

test('se respeta el ejecutable del entorno original aunque WT tenga otro entorno', async () => {
  const env = { CODEX_HUB_CODEX_PATH: 'C:\\Codex del usuario\\codex.exe' };
  assert.equal(resolveCodex(undefined, env), env.CODEX_HUB_CODEX_PATH);
  let actual;
  await launchCodex([], { env, spawnProcess: (exe, args, options) => {
    actual = { exe, options };
    const child = new EventEmitter();
    process.nextTick(() => child.emit('exit', 0));
    return child;
  } });
  assert.equal(actual.exe, env.CODEX_HUB_CODEX_PATH);
  assert.equal(actual.options.env, env);
});

test('el ancho automático de una ventana grande no bloquea el arranque del CLI', async () => {
  const cli = fileURLToPath(new URL('../bin/codex-hub.js', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'demo', '--no-color'], { env: { ...process.env, COLUMNS: '320' } });
  assert.ok(stdout.length > 0);
});

test('sin Windows Terminal se conserva Codex nativo y sus argumentos', async () => {
  let received;
  const code = await nativePanel({}, {}, ['resume', '--last'], {
    platform: 'win32', env: {}, log() {},
    launch: async args => { received = args; return 7; },
    channelFactory() { throw new Error('No debe crear panel'); }
  });
  assert.equal(code, 7);
  assert.deepEqual(received, ['resume', '--last']);
});

test('si falla el panel Codex sigue nativo y el canal se cierra', async () => {
  let closed = false, received;
  const code = await nativePanel({}, {}, ['--no-alt-screen'], {
    platform: 'win32', env: { WT_SESSION: 'sesion' }, log() {},
    channelFactory: async () => ({ name: 'canal', close: async () => { closed = true; } }),
    openPane: async () => { throw new Error('wt no disponible'); },
    launch: async args => { received = args; return 0; }
  });
  assert.equal(code, 0);
  assert.equal(closed, true);
  assert.deepEqual(received, ['--no-alt-screen']);
});

test('el canal transmite sólo la sesión seleccionada y cerrar el monitor no da órdenes al chat', async () => {
  const channel = await createHudChannel();
  const socket = net.createConnection(channel.name);
  try {
    await channel.waitReady();
    const data = once(socket, 'data');
    channel.publish({ id: 'sesion-seleccionada', model: 'modelo-real', sessions: [{ id: 'otra-sesion' }] });
    const [packet] = await data;
    assert.deepEqual(JSON.parse(packet.toString()), { id: 'sesion-seleccionada', model: 'modelo-real' });
    socket.write('NO ES UNA ORDEN PARA CODEX');
    socket.destroy();
    channel.publish({ status: 'working' });
  } finally { socket.destroy(); await channel.close(); }
});

test('el HUD cabe en el panel inferior y no usa modos de mouse', () => {
  const text = renderPassiveHud(demoSnapshot, 110, 8, { color: false });
  assert.match(text, /GAONA-HUB/);
  assert.match(text, /CTX/);
  assert.match(text, /MODEL/);
  assert.ok(text.split('\r\n').length <= 7);
  assert.doesNotMatch(text, /\x1b\[\?(?:1000|1002|1003|1006|1049)/);
});

test('la identidad proviene del título exacto y nunca de la última conversación', async () => {
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const snapshots = [];
  let stopped = false, closed = false, titleCallback;
  const store = {
    resolveSession: async prefix => { assert.equal(prefix, id); return id; },
    snapshot: async selected => { assert.equal(selected, id); return { id, connected: true, model: 'modelo-del-log' }; }
  };
  await nativePanel(store, {}, [], {
    platform: 'win32', env: { WT_SESSION: 'sesion' },
    channelFactory: async () => ({ name: 'canal', publish: value => snapshots.push(value), waitReady: async () => {}, close: async () => { closed = true; } }),
    openPane: async () => {},
    prepareObserver: async callback => { titleCallback = callback; return { attach: pid => assert.equal(pid, 42), stop: () => { stopped = true; } }; },
    launch: async (args, options) => {
      assert.ok(!args.includes('tui.status_line=[]'));
      options.onSpawn({ pid: 42 });
      titleCallback('Otra tarea sin ID');
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(snapshots.every(state => !state.id));
      titleCallback(`${id} | modelo-vivo | high | Ready`);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(snapshots.at(-1).id, id);
      assert.equal(snapshots.at(-1).model, 'modelo-vivo');
      titleCallback('gpt-5.5 | medium | Ready | Fast off');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(snapshots.at(-1).id, null);
      assert.equal(snapshots.at(-1).model, 'gpt-5.5');
      assert.equal(snapshots.at(-1).fastMode, false);
      assert.ok(!snapshots.at(-1).connected);
      return 0;
    }
  });
  assert.equal(stopped, true);
  assert.equal(closed, true);
});

test('un título pendiente entrega modelo y estado sin inventar identidad', () => {
  const pending = 'gpt-6-astra | default | Ready | Fast on';
  assert.equal(titleSignals(pending), null);
  assert.deepEqual(titleSignals(pending, { allowPending: true }), {
    prefix: null, signals: { model: 'gpt-6-astra', effort: 'default', status: 'idle', fastMode: true }
  });
  assert.equal(titleSignals('Otra ventana | otra tarea', { allowPending: true }), null);
});
