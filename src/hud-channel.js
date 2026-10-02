import net from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export async function createHudChannel(requestedName) {
  if (requestedName && !/^\\\\\.\\pipe\\gaona-hub-[0-9a-f-]+$/i.test(requestedName)) throw new Error('Canal local del HUD inválido.');
  const name = requestedName || (process.platform === 'win32'
    ? `\\\\.\\pipe\\gaona-hub-${randomUUID()}`
    : path.join(os.tmpdir(), `gaona-hub-${randomUUID()}.sock`));
  const clients = new Set();
  let last = '', ready;
  const connected = new Promise(resolve => { ready = resolve; });
  const server = net.createServer(socket => {
    clients.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => clients.delete(socket));
    // Este canal no acepta órdenes ni entrada del teclado del panel.
    socket.on('data', () => {});
    if (last) socket.write(last);
    ready();
  });
  server.maxConnections = 1;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(name, resolve);
  });
  return {
    name,
    publish(state) {
      const { sessions, ...view } = state;
      last = JSON.stringify(view) + '\n';
      for (const socket of clients) {
        if (socket.writableLength > 256 * 1024) socket.destroy();
        else socket.write(last);
      }
    },
    async waitReady(timeout = 5000) {
      let timer;
      try {
        await Promise.race([connected, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('El panel no confirmó su conexión.')), timeout);
        })]);
      } finally { clearTimeout(timer); }
    },
    async close() {
      for (const socket of clients) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
