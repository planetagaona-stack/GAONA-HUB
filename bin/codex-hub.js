#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { SessionStore } from '../src/sessions.js';
import { renderHud, demoSnapshot } from '../src/render.js';
import { launchCodex, resolveCodex } from '../src/launch.js';
import { watch } from '../src/watch.js';
import { integratedTerminal } from '../src/terminal.js';

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const raw = process.argv.slice(2), separator = raw.indexOf('--');
const args = separator < 0 ? raw : raw.slice(0, separator);
const passthrough = separator < 0 ? [] : raw.slice(separator + 1);
const help = `Gaona-HUB ${version} · HUD debajo del chat\n\n  gaona-hub                   Codex CLI con HUD inferior integrado\n  gaona-hub -- resume <id>     Reanudar chat con el HUD\n  gaona-hub run -- <args>     Codex con HUD (en una terminal)\n  gaona-hub watch             Monitor separado, modo opcional\n  gaona-hub status            Captura con datos reales\n  gaona-hub demo              Diseño con datos de ejemplo\n  gaona-hub sessions          Sesiones recientes\n  gaona-hub doctor            Diagnóstico local\n\n  --ascii --no-color --color --width <40..240> --json\n  --session <id> --project <ruta> --codex-home <ruta>\n  --codex <ejecutable> --plain (ejecutar sin HUD)\n  --native (compatibilidad con un Codex modificado)\n\nTeclado y permisos: los de Codex. Shift+PageUp/PageDown: historial local.\nMétricas locales; el HUD no requiere una clave API.\n`;
if (args.includes('--help') || args.includes('-h')) { console.log(help); process.exit(0); }
if (args.includes('--version')) { console.log(version); process.exit(0); }
const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'terminal';
const flags = new Set(['--ascii', '--no-color', '--color', '--json', '--native', '--footer', '--plain']);
const values = new Set(['--width', '--session', '--project', '--codex-home', '--codex']);
const parsed = new Map();
try {
  for (let i = 0; i < args.length; i++) {
    if (flags.has(args[i])) parsed.set(args[i], true);
    else if (values.has(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) parsed.set(args[i], args[++i]);
    else throw new Error(`Opción desconocida o sin valor: ${args[i]}`);
  }
  const width = Number(parsed.get('--width') ?? process.stdout.columns ?? process.env.COLUMNS ?? 120);
  if (!Number.isInteger(width) || width < 40 || width > 240) throw new Error('--width debe estar entre 40 y 240.');
  const home = path.resolve(parsed.get('--codex-home') || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const project = parsed.get('--project') ? path.resolve(parsed.get('--project')) : null;
  const store = new SessionStore(home);
  const options = { width, fixedWidth: parsed.has('--width'), ascii: parsed.has('--ascii'), color: !parsed.has('--no-color') && (parsed.has('--color') || Boolean(process.stdout.isTTY) && !process.env.NO_COLOR), footer: parsed.has('--footer'), session: parsed.get('--session') || null, project, executable: parsed.get('--codex') };
  const snapshot = () => store.snapshot(options.session, project);
  if (command === 'terminal' || command === 'run') {
    if (parsed.has('--plain') || parsed.has('--native') || command === 'run' && !process.stdout.isTTY) process.exitCode = await launchCodex(passthrough, { executable: options.executable, cwd: project || process.cwd(), native: parsed.has('--native') });
    else {
      const code = await integratedTerminal(store, { ...options, color: !parsed.has('--no-color') && !process.env.NO_COLOR }, passthrough);
      // Windows ConPTY may keep internal pipe workers alive after child exit.
      await new Promise(resolve => process.stdout.write('', resolve));
      process.exit(code);
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
    console.log(`Gaona-HUB ${version}\nNode: ${process.version}\nCodex CLI: ${codexVersion}\nCodex home: ${home}\nCarpeta de sesiones: ${existsSync(path.join(home, 'sessions')) ? 'encontrada' : 'todavía no existe'}\nSesiones recientes: ${state.sessions.length}\nHUD inferior integrado: disponible\nPrivacidad: métricas locales; no envía mensajes ni metadatos\nModo normal: Codex oficial arriba, HUD fijo debajo; identificación por sesión.`);
  } else if (command === 'watch') await watch(store, options);
  else throw new Error(`Comando desconocido: ${command}\n${help}`);
} catch (error) { console.error(`Gaona-HUB: ${error.message}`); process.exitCode = 1; }
