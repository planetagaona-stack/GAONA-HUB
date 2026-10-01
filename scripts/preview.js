import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { demoSnapshot, visibleLength } from '../src/render.js';
import { layoutScreen } from '../src/terminal-view.js';
const directory = fileURLToPath(new URL('../dist/', import.meta.url));
await mkdir(directory, { recursive: true });
const snapshot = { ...demoSnapshot, weekly: { usedPercent: 80, resetsAt: 211080 } };
const layout = layoutScreen(180, 22, snapshot, { color: true, now: 0 });
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const chat = Array(layout.chatRows).fill('');
chat[0] = '  >_ OpenAI Codex · DEMO de integración · sin mensajes reales';
chat[3] = '  › Haz que el HUD permanezca debajo de esta conversación.';
chat[6] = '  • El chat ocupa esta zona. Codex conserva sus comandos y permisos.';
chat[layout.chatRows - 3] = '  › Ask Codex to do anything';
const lines = [...chat, ...layout.footer];
const spans = lines.map((line, index) => {
  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  let color = '#d8e3ee', text = '', column = 0;
  for (const part of parts) {
    const match = part.match(/^\x1b\[(?:1;)?38;2;(\d+);(\d+);(\d+)m$/);
    if (match) color = `rgb(${match.slice(1).join(',')})`;
    else if (part === '\x1b[0m') color = '#d8e3ee';
    else if (/^\x1b\[[0-9;]*m$/.test(part)) continue;
    else for (const char of part) { text += `<tspan x="${32 + column * 9}" fill="${color}">${escape(char)}</tspan>`; column += visibleLength(char); }
  }
  return `<text x="32" y="${58 + index * 24}" xml:space="preserve">${text}</text>`;
}).join('\n');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1700" height="${lines.length * 24 + 80}" viewBox="0 0 1700 ${lines.length * 24 + 80}"><rect width="100%" height="100%" fill="#06090c"/><g font-family="Consolas, monospace" font-size="15">${spans}</g></svg>`;
await writeFile(directory + 'preview.svg', svg);
await writeFile(directory + 'preview.html', `<!doctype html><meta charset="utf-8"><title>Gaona-HUB terminal preview</title><style>body{margin:0;background:#06090c}svg{display:block;width:100%}</style>${svg}`);
console.log('Preview: dist/preview.svg (integrated layout, demo chat and metrics)');
