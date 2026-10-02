import os from 'node:os';
import path from 'node:path';
import { nativeWindow } from '../src/native-window.js';

process.exitCode = await nativeWindow({
  codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  project: process.argv[2] || os.homedir(), color: true
}, [], {
  onReady: ready => console.log(ready
    ? 'GAONA-HUB 0.7.0: ventana de prueba abierta; el panel inferior confirmó su conexión. Instalación activa intacta.'
    : 'La ventana abrió Codex nativo, pero el panel no confirmó su conexión.')
});
