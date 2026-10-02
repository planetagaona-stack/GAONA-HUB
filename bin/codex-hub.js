#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../src/sessions.js';
import { renderHud, demoSnapshot } from '../src/render.js';
import { launchCodex, resolveCodex } from '../src/launch.js';
import { watch } from '../src/watch.js';
import { nativeWindow, receiveNativeWindow } from '../src/native-window.js';
import { passiveHud } from '../src/passive-hud.js';
import { automaticUpdate, checkUpdate, installUpdate } from '../src/update.js';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]+$/, '');
const restarted = process.env.GAONA_HUB_UPDATED === '1';
delete process.env.GAONA_HUB_UPDATED;
const raw = process.argv.slice(2), separator = raw.indexOf('--');
const args = separator < 0 ? raw : raw.slice(0, separator);
const passthrough = separator < 0 ? [] : raw.slice(separator + 1);
const help = `GAONA-HUB ${version} · Codex nativo y HUD inferior

  gaona-hub                  Ventana con Codex arriba y HUD abajo
  gaona-hub -- resume <id>    Reanudar una conversación
  gaona-hub run -- <args>     Reenviar argumentos a Codex
  gaona-hub --plain           Codex sin panel ni emulador
  gaona-hub --integrated      Emulador anterior (compatibilidad)
  gaona-hub watch             Monitor independiente
  gaona-hub status --json     Métricas locales
  gaona-hub doctor            Diagnóstico local
  gaona-hub update --check    Consultar una versión publicada
  gaona-hub update            Actualizar desde GitHub Releases

  --ascii --no-color --color --width <40..240>
  --session <id> --project <ruta> --codex-home <ruta>
  --title <nombre> --codex <ejecutable> --no-update
  --native                   Compatibilidad con un Codex modificado

El modo normal conserva la entrada y salida nativas de Codex.
El HUD dibuja sólo en su panel. No requiere una clave API.
`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
if (args.includes('--version')) { console.log(version); process.exit(0); }
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'terminal';
const flags = new Set(['--ascii', '--no-color', '--color', '--json', '--native', '--footer', '--plain', '--check', '--no-update', '--integrated']);
const values = new Set(['--width', '--session', '--project', '--codex-home', '--codex', '--title', '--channel']);
const parsed = new Map();
try {
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) parsed.set(args[i], true);
    else if (values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) parsed.set(args[i], args[++i]);
    else throw new Error(`Opción desconocida o sin valor: ${args[i]}`);
  }
  const automaticWidth = Math.max(40, Math.min(240, Number(process.stdout.columns || process.env.COLUMNS) || 120));
  const width = Number(parsed.get('--width') ?? automaticWidth);
  if (!Number.isInteger(width) || width < 40 || width > 240) throw new Error('--width debe estar entre 40 y 240.');
  const home = path.resolve(parsed.get('--codex-home') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const project = parsed.get('--project') ? path.resolve(parsed.get('--project')) : null;
  const store = new SessionStore(home);
  const options = { width, fixedWidth: parsed.has('--width'), ascii: parsed.has('--ascii'), color: !parsed.has('--no-color') && (parsed.has('--color') || Boolean(process.stdout.isTTY) && !process.env.NO_COLOR), footer: parsed.has('--footer'), session: parsed.get('--session') || null, project, title: parsed.get('--title'), executable: parsed.get('--codex') };
  const snapshot = () => store.snapshot(options.session, project);
  if (command === 'terminal' || command === 'run') {
    if (parsed.has('--plain') || parsed.has('--native') || !process.stdin.isTTY || !process.stdout.isTTY) process.exitCode = await launchCodex(passthrough, { executable: options.executable, cwd: project || process.cwd(), native: parsed.has('--native') });
    else {
      if (!restarted && !parsed.has('--no-update') && process.stdin.isTTY && process.stdout.isTTY && await automaticUpdate(root, version)) {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', shell: false, windowsHide: true, env: { ...process.env, GAONA_HUB_UPDATED: '1' } });
        const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
        process.exit(code);
      }
      const display = { ...options, color: !parsed.has('--no-color') && !process.env.NO_COLOR };
      const code = parsed.has('--integrated')
        ? await (await import('../src/terminal.js')).integratedTerminal(store, display, passthrough)
        : await nativeWindow({ ...display, codexHome: home }, passthrough);
      // Windows ConPTY may keep internal pipe workers alive after child exit.
      await new Promise(resolve => process.stdout.write('', resolve));
      process.exit(code);
    }
  }
  else if (command === 'panel') await passiveHud(parsed.get('--channel'), options);
  else if (command === 'window') process.exitCode = await receiveNativeWindow(parsed.get('--channel'));
  else if (command === 'update') {
    const release = await checkUpdate(version);
    if (!release) console.log(`GAONA-HUB ${version}: ya tienes la versión más reciente.`);
    else if (parsed.has('--check')) console.log(`GAONA-HUB ${version} → ${release.version}: actualización disponible.`);
    else {
      if (!root.replaceAll('\\', '/').endsWith('/node_modules/gaona-hub')) throw new Error('Actualiza la instalación global; el checkout de desarrollo no se sobrescribe.');
      if (await installUpdate(root, release)) console.log(`GAONA-HUB ${release.version} instalado. Abre una nueva sesión para usarlo.`);
    }
  }
  else if (command === 'demo') console.log(renderHud({ ...demoSnapshot, weekly: { usedPercent: 80, resetsAt: Date.now() / 1000 + 211080 } }, { ...options, demo: true }));
  else if (command === 'status') {
    const state = await snapshot();
    if (state.error) throw new Error(state.error);
    console.log(parsed.has('--json') ? JSON.stringify(state, null, 2) : renderHud(state, options));
  } else if (command === 'sessions') console.log(JSON.stringify((await snapshot()).sessions, null, 2));
  else if (command === 'doctor') {
    const state = await snapshot();
    let codexVersion = 'no encontrado';
    try { codexVersion = execFileSync(resolveCodex(options.executable), ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim(); } catch { /* Optional launcher dependency. */ }
    console.log(`Gaona-HUB ${version}\nNode: ${process.version}\nCodex CLI: ${codexVersion}\nCodex home: ${home}\nCarpeta de sesiones: ${existsSync(path.join(home, 'sessions')) ? 'encontrada' : 'todavía no existe'}\nSesiones recientes: ${state.sessions.length}\nHUD inferior separado: disponible en Windows Terminal\nPrivacidad: métricas locales; no envía mensajes ni metadatos\nModo normal: Codex nativo y HUD en paneles independientes; identificación por título de sesión.`);
  } else if (command === 'watch') await watch(store, options);
  else throw new Error(`Comando desconocido: ${command}\n${help}`);
} catch (error) { console.error(`Gaona-HUB: ${error.message}`); process.exitCode = 1; }
