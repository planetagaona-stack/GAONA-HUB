import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function resolveCodex(explicit, env = process.env) {
  if (explicit) return explicit;
  if (env.CODEX_HUB_CODEX_PATH) return env.CODEX_HUB_CODEX_PATH;
  if (process.platform === 'win32') {
    const desktop = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    if (existsSync(desktop)) return desktop;
    const npm = path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex');
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    for (const base of [path.join(npm, 'node_modules', '@openai', `codex-win32-${process.arch}`), npm]) {
      const binary = path.join(base, 'vendor', `${arch}-pc-windows-msvc`, 'codex', 'codex.exe');
      if (existsSync(binary)) return binary;
    }
    return 'codex.exe';
  }
  return 'codex';
}
export function promptArgs(prompt) { return ['--', prompt.trim()]; }
export function footerOverride(nodePath, cliPath, platform = process.platform) {
  const quote = value => {
    if (platform === 'win32') {
      if (/["%\r\n]/.test(value)) throw new Error('La ruta contiene caracteres incompatibles con el pie de terminal.');
      return `"${value}"`;
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
  };
  return `tui.status_line=${JSON.stringify([`command: ${quote(nodePath)} ${quote(cliPath)} status --footer --color`])}`;
}
export function launchCodex(args, { executable, cwd, native = false, onSpawn, spawnProcess = spawn, env } = {}) {
  const command = resolveCodex(executable, env);
  if (native && !executable && !(env || process.env).CODEX_HUB_CODEX_PATH) throw new Error('--native requiere --codex <binario con soporte command: status_line>. El HUD independiente funciona con Codex oficial.');
  const cli = fileURLToPath(new URL('../bin/codex-hub.js', import.meta.url));
  const childArgs = native ? ['-c', footerOverride(process.execPath, cli), ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, childArgs, { cwd, env, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('spawn', () => onSpawn?.(child));
    child.once('error', error => reject(new Error(error.code === 'ENOENT' ? 'No se encontró Codex CLI. Instálalo o indica --codex <ruta a codex.exe>.' : error.message)));
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
  });
}
