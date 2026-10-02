import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

export function prepareConsoleTitleObserver(onTitle, onError = () => {}) {
  return new Promise((resolve, reject) => {
    const name = `gaona-hub-title-${randomUUID()}`;
    const source = `$titlePipe = '${name}'\n` + readFileSync(new URL('../scripts/read-console-title.ps1', import.meta.url), 'utf8');
    let helper, client, reader, stopped = false, ready = false;
    const stop = () => {
      stopped = true; clearTimeout(timeout);
      reader?.close(); client?.destroy(); helper?.kill();
      if (server.listening) server.close();
    };
    const fail = () => {
      if (stopped) return;
      if (ready) onError();
      else reject(new Error('No se pudo preparar el observador de título.'));
      stop();
    };
    const server = net.createServer(socket => {
      if (stopped || client) { socket.destroy(); return; }
      client = socket;
      socket.on('error', fail);
      reader = createInterface({ input: socket });
      reader.on('line', line => {
        if (line.length > 16384) { fail(); return; }
        try {
          const item = JSON.parse(line);
          if (item.ready === true && !ready) {
            ready = true; clearTimeout(timeout);
            resolve({
              attach(pid) {
                if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('PID de Codex inválido.');
                if (!stopped) socket.write(JSON.stringify({ pid }) + '\n');
              },
              stop
            });
          }
          if (typeof item.title === 'string' && item.title.length <= 2048) onTitle(item.title);
        } catch { /* Ignora mensajes que no sean parte del protocolo local. */ }
      });
    });
    const timeout = setTimeout(fail, 10000);
    server.maxConnections = 1;
    server.on('error', fail);
    server.listen(`\\\\.\\pipe\\${name}`, () => {
      if (stopped) { server.close(); return; }
      // Inicializa y libera su consola ANTES de arrancar Codex. Después sólo
      // recibe el PID y lee el título; no comparte stdin/stdout con el chat.
      helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], {
        stdio: 'ignore', shell: false, windowsHide: true
      });
      helper.on('error', fail);
      helper.on('exit', () => { if (!stopped) fail(); });
    });
  });
}

// Atajo para las pruebas de un proceso ya existente en otra consola.
export function observeConsoleTitle(pid, onTitle, onError = () => {}) {
  let observer, stopped = false;
  void prepareConsoleTitleObserver(onTitle, onError).then(value => {
    observer = value;
    if (stopped) observer.stop();
    else observer.attach(pid);
  }).catch(onError);
  return () => { stopped = true; observer?.stop(); };
}
