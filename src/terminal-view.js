import { renderHud, clip, safeText } from './render.js';
import { scrollbarRows } from './scrollbar.js';
import { cellHyperlink, closeHyperlink } from './terminal-links.js';

export function sessionFromTitle(title) {
  title = title.split(' | ')[0];
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)) return title;
  // Codex 0.159.3 truncates each terminal-title component to 32 characters.
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{3,11})(?:\.\.\.|…)$/i.exec(title);
  return match ? match[1] : null;
}

export function titleSignals(title, { allowPending = false } = {}) {
  const prefix = sessionFromTitle(title);
  const parts = title.split(' | ');
  if (!prefix && (!allowPending || parts.length !== 4 ||
      !/^[a-z0-9][a-z0-9._:/-]*$/i.test(parts[0]) ||
      !/^(default|none|minimal|low|medium|high|xhigh|max|ultra)$/.test(parts[1]) ||
      !/^(Ready|Working|Starting|Waiting|Blocked|Interrupted)$/.test(parts[2]) ||
      !/^Fast (on|off)$/.test(parts[3]))) return null;
  const [model, effort, status, fast] = prefix ? parts.slice(1) : parts;
  const signals = {};
  if (model && !/(\.\.\.|…)$/.test(model)) signals.model = model;
  if (effort && !/(\.\.\.|…)$/.test(effort)) signals.effort = effort;
  const mapped = { Ready: 'idle', Working: 'working', Starting: 'connecting', Waiting: 'paused', Blocked: 'paused', Interrupted: 'paused' }[status];
  if (mapped) signals.status = mapped;
  if (fast === 'Fast on' || fast === 'Fast off') signals.fastMode = fast === 'Fast on';
  return { prefix, signals };
}

export function modelPickerState(terminal) {
  const buffer = terminal.buffer.active;
  let current = null, active = null, currentCount = 0, activeCount = 0;
  for (let row = 0; row < terminal.rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '';
    const match = /^\s*([>›❯])?\s*\d+\.\s+([a-z0-9][a-z0-9._:/-]*)(?:\s+\((current)\))?(?:\s+.*)?$/i.exec(line);
    if (!match) continue;
    if (match[3]) { current = match[2]; currentCount++; }
    if (match[1]) { active = match[2]; activeCount++; }
  }
  return currentCount === 1 && activeCount === 1 ? { current, active } : null;
}

export function layoutScreen(columns, rows, state = {}, options = {}) {
  const width = Math.max(20, Math.min(240, columns));
  const indicators = [state.fastMode == null ? null : `FAST ${state.fastMode ? 'ON' : 'OFF'}`, state.lastCommand ? `CMD ${safeText(state.lastCommand)}` : null, state.skill ? `SKILL ${safeText(state.skill)}` : null].filter(Boolean);
  const title = clip(`>_ GAONA-HUB byGaona  ·  ${indicators.length ? indicators.join(' · ') : 'sesión actual'}`, width - 1, options.ascii);
  const heading = options.color === false ? title : `\x1b[1;38;2;73;208;255m${title}\x1b[0m`;
  const metrics = columns < 40 ? [] : renderHud(state, { ...options, width, footer: true }).split('\n');
  const available = Math.max(0, rows - 8);
  const footer = [heading, ...metrics].slice(0, available);
  return { columns, chatColumns: Math.max(1, columns - 1), rows, chatRows: Math.max(1, rows - footer.length), footer };
}

export function cellStyle(cell) {
  const codes = [0];
  for (const [method, code] of [['isBold', 1], ['isDim', 2], ['isItalic', 3], ['isUnderline', 4], ['isBlink', 5], ['isInverse', 7], ['isInvisible', 8], ['isStrikethrough', 9], ['isOverline', 53]]) {
    if (cell[method]()) codes.push(code);
  }
  for (const [prefix, side] of [[38, 'Fg'], [48, 'Bg']]) {
    const color = cell[`get${side}Color`]();
    if (cell[`is${side}RGB`]()) codes.push(prefix, 2, color >> 16 & 255, color >> 8 & 255, color & 255);
    else if (cell[`is${side}Palette`]()) codes.push(prefix, 5, color);
  }
  return `\x1b[${codes.join(';')}m`;
}

export function bufferRows(terminal) {
  const buffer = terminal.buffer.active;
  const output = [];
  for (let row = 0; row < terminal.rows; row++) {
    const line = buffer.getLine(buffer.viewportY + row);
    let rendered = '', previous = '', previousLink = '';
    for (let col = 0; col < terminal.cols; col++) {
      const cell = line?.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      const link = cellHyperlink(terminal, cell);
      if (link !== previousLink) {
        if (previousLink) rendered += closeHyperlink;
        if (link) rendered += link;
        previousLink = link;
      }
      const style = cellStyle(cell);
      if (style !== previous) { rendered += style; previous = style; }
      rendered += cell.getChars() || ' ';
    }
    output.push(rendered + (previousLink ? closeHyperlink : '') + '\x1b[0m');
  }
  return output;
}

export function footerSession(terminal) {
  const buffer = terminal.buffer.active;
  // Inline Codex uses only part of the PTY viewport. Its footer follows the last
  // composer, not necessarily the physical bottom. Never scan above that editor.
  let composer = -1;
  for (let row = 0; row < terminal.rows; row++) {
    if (/^\s*›(?:\s|$)/.test(buffer.getLine(buffer.baseY + row)?.translateToString(true) || '')) composer = row;
  }
  if (composer < 0) return null;
  for (let row = composer + 1; row < terminal.rows; row++) {
    const text = buffer.getLine(buffer.baseY + row)?.translateToString(true).trim();
    const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\s{2,}.*)?$/i.exec(text || '');
    if (match) return match[1];
  }
  return null;
}

export function isCompacting(terminal) {
  const buffer = terminal.buffer.active;
  const start = buffer.baseY;
  if (buffer.viewportY < start) return false;
  const end = Math.min(buffer.length, start + terminal.rows);
  const textAt = row => buffer.getLine(row)?.translateToString(true) || '';
  for (let row = start; row + 1 < end; row++) {
    const header = textAt(row);
    const detail = textAt(row + 1);
    if (!/^(?:•|∙|\*)\s*Compacting context(?:\s|$)/u.test(header)
      || !/^ {2}└\s*Making room to continue\./u.test(detail)) continue;
    let composer = row + 2;
    while (composer < end && composer - row <= 5 && !textAt(composer).trim()) composer++;
    if (composer < end && /^\s*›(?:\s|$)/u.test(textAt(composer))) return true;
  }
  return false;
}

export function drawFrame(terminal, layout, previous = [], approximateOffset = 0, options = {}) {
  const gutter = scrollbarRows(terminal, options, approximateOffset);
  const lines = [...bufferRows(terminal).map((line, row) => `${line}${gutter[row]}`), ...layout.footer];
  let changes = '';
  for (let row = 0; row < lines.length; row++) {
    if (lines[row] !== previous[row]) changes += `\x1b[${row + 1};1H\x1b[0m\x1b[2K${lines[row]}`;
  }
  const cursorRow = Math.min(layout.chatRows, terminal.buffer.active.cursorY + 1);
  const cursorColumn = Math.min(layout.chatColumns, terminal.buffer.active.cursorX + 1);
  const visible = !terminal._core?.coreService?.isCursorHidden;
  const cursor = `${cursorRow};${cursorColumn};${visible}`;
  // Un refresh de métricas sin cambios no debe tocar el cursor del terminal.
  const text = changes || cursor !== options.previousCursor
    ? `\x1b[?2026h\x1b[?25l${changes}\x1b[0m\x1b[${cursorRow};${cursorColumn}H\x1b[?25${visible ? 'h' : 'l'}\x1b[?2026l`
    : '';
  return { text, lines, cursor };
}
