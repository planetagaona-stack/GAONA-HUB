const palette = { cyan: '73;208;255', purple: '177;118;255', green: '54;232;164', pink: '245;75;185', orange: '255;179;99', gray: '128;145;164', white: '216;227;238', border: '44;76;96' };
export function safeText(value) {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ');
}
const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
function charWidth(char) {
  const code = char.codePointAt(0);
  return /\p{Extended_Pictographic}/u.test(char) || code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xfe10 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60 || code >= 0x20000) ? 2 : 1;
}
export function visibleLength(text) { return [...segments.segment(String(text).replace(/\x1b\[[0-9;]*m/g, ''))].reduce((sum, item) => sum + charWidth(item.segment), 0); }
export function clip(value, width, ascii = false) {
  const text = safeText(value);
  if (visibleLength(text) <= width) return text;
  let result = '', used = 0;
  for (const item of segments.segment(text)) {
    const size = charWidth(item.segment);
    if (used + size > width - 1) break;
    result += item.segment; used += size;
  }
  return result + (ascii ? '~' : '…');
}
export function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.00$/, '')}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
}
export function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  seconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds / 3600) % 24, minutes = Math.floor(seconds / 60) % 60;
  if (days) return `${days}d ${hours}h ${minutes}m`;
  if (hours) return `${hours}h ${minutes}m`;
  return minutes ? `${minutes}m` : `${seconds}s`;
}
export function renderHud(state, { width = 120, color = true, ascii = false, demo = false, footer = false, input = '', entering = false, note = '', now = Date.now() } = {}) {
  width = Math.max(40, Math.min(240, width));
  const paint = (name, text) => color ? `\x1b[38;2;${palette[name]}m${text}\x1b[0m` : text;
  const missing = ascii ? '--' : '—';
  const val = item => item == null || item === '' ? missing : safeText(item);
  const percent = item => item == null ? missing : `${Math.round(item)}%`;
  const free = state.weekly?.usedPercent == null ? null : Math.max(0, 100 - state.weekly.usedPercent);
  const reset = state.weekly?.resetsAt == null ? null : Math.max(0, state.weekly.resetsAt - now / 1000);
  const tokens = n => formatTokens(n).replaceAll('—', missing);
  const time = n => duration(n).replaceAll('—', missing);
  const progress = value => value == null ? missing : (ascii ? '#' : '━').repeat(Math.round(Math.max(0, Math.min(100, value)) / 10)) + (ascii ? '-' : '─').repeat(10 - Math.round(Math.max(0, Math.min(100, value)) / 10));
  const fillLine = ascii ? '-' : String.fromCharCode(0x2500);
  const compactionStatus = () => {
    if (!color) return 'COMPACTANDO';
    const depth = [0, 1, 2, 2, 1, 0][Math.abs(Math.floor(state.compactionFrame ?? 0)) % 6];
    const left = (ascii ? ['  ', '< ', '<<'] : ['  ', '‹ ', '‹‹'])[depth];
    const right = (ascii ? ['  ', ' >', '>>'] : ['  ', ' ›', '››'])[depth];
    return `${left}${ascii ? '@' : '◉'}${right} COMPACTANDO`;
  };
  const bar = progress(free);
  const cells = [
    ['orange', `${ascii ? '#' : '▤'} CTX  ${percent(state.contextPercent)} usado`, `${progress(state.contextPercent)}  IN ${tokens(state.inputTokens)} · OUT ${tokens(state.outputTokens)}`],
    ['pink', `${ascii ? 'O' : '◔'} SEMANAL  ${percent(free)} libre`, bar],
    ['purple', `${ascii ? 'R' : '↻'} REINICIO`, time(reset)],
    ['purple', `${ascii ? '*' : '◇'} MODEL`, `${val(state.model)} ${state.effort ? safeText(state.effort) : ''}`.trim()],
    ['green', `${ascii ? '+' : '⑂'} GIT`, `${val(state.git?.branch)}${state.git?.dirty ? '*' : ''}`],
    ['cyan', `${ascii ? '[+]' : '▰'} PROJECT`, val(state.project)],
    ['green', `${ascii ? 'o' : '●'} STATUS`, ({ working: 'Working', idle: 'Idle', paused: 'Paused', connecting: 'Esperando datos', unknown: 'Sin sesión' })[state.status] ?? 'Sin sesión'],
    ['cyan', `${ascii ? ':' : '◷'} TAREA`, time(state.taskSeconds)],
  ];
  if (state.compacting) cells[6][2] = compactionStatus();
  const horizontal = fillLine;
  const border = (left, right) => paint('border', left + horizontal.repeat(width - 2) + right);
  const enclosed = text => paint('border', ascii ? '|' : '│') + text + ' '.repeat(Math.max(0, width - 2 - visibleLength(text))) + paint('border', ascii ? '|' : '│');
  const title = '>_ GAONA-HUB byGaona';
  const heading = paint('cyan', '>_ GAONA-') + paint('purple', 'HUB') + paint('gray', ' byGaona') + paint('gray', clip(demo ? '  |  DEMO · datos de ejemplo' : entering ? `  |  > ${input}` : '  |  Ask Codex to do anything…', width - 2 - visibleLength(title), ascii));
  const output = footer ? [] : [border(ascii ? '+' : '╭', ascii ? '+' : '╮'), enclosed(heading), border(ascii ? '+' : '├', ascii ? '+' : '┤')];
  let group = [], used = 0;
  const flush = () => {
    if (!group.length) return;
    const content = [0, 1].map(row => group.map(({ cell, size }) => {
      const text = clip(cell[row + 1], size - 2, ascii);
      const padding = Math.max(0, size - 1 - visibleLength(text));
      const colorName = row === 0 || cell[0] === 'pink' || /CTX|TAREA/.test(cell[1]) ? cell[0] : 'white';
      return ' ' + paint(colorName, text) + (row === 0 && padding > 1 ? ' ' + paint('border', horizontal.repeat(padding - 1)) : ' '.repeat(padding));
    }).join(paint('border', ascii ? '|' : '│')));
    output.push(...content.map((text, row) => {
      const remaining = Math.max(0, width - 2 - visibleLength(text));
      const filled = row === 0 && remaining > 1 ? text + ' ' + paint('border', horizontal.repeat(remaining - 1)) : text;
      return footer ? filled.trimEnd() : enclosed(filled);
    }));
    group = []; used = 0;
  };
  for (const cell of cells) {
    const size = Math.min(width - 2, 44, Math.max(15, ...cell.slice(1).map(text => visibleLength(text) + 2)));
    if (used + size + (group.length ? 1 : 0) > width - 2) flush();
    if (group.length) used++;
    group.push({ cell, size }); used += size;
  }
  flush();
  if (!footer) {
    output.push(border(ascii ? '+' : '├', ascii ? '+' : '┤'));
    const hint = note || (state.connected ? `LOCAL · Ctrl+K escribir · N siguiente sesión · Ctrl+C salir${state.activeTool ? ` · ${state.activeTool}` : ''}` : 'Abre Codex para recibir datos · Ctrl+K iniciar · Ctrl+C salir');
    output.push(enclosed(' ' + paint('gray', clip(hint, width - 4, ascii))), border(ascii ? '+' : '╰', ascii ? '+' : '╯'));
  }
  return (ascii ? output.join('\n').replaceAll('·', '|').replaceAll('—', '--').replaceAll('…', '~').normalize('NFD').replace(/\p{Mark}/gu, '').replace(/[^\x00-\x7f]/g, '?') : output.join('\n'));
}
export const demoSnapshot = {
  contextPercent: 26, inputTokens: 534000000, outputTokens: 1640000,
  model: 'gpt-6-astra', effort: 'medium', project: 'codex-hub', git: { branch: 'main', dirty: false },
  status: 'working', weekly: { usedPercent: 80, resetsAt: 0 }, taskSeconds: 2280, connected: true,
};
