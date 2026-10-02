export const alternateScrollRange = 120;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function scrollThumb(buffer, rows, approximateOffset = 0) {
  if (rows < 1) return null;

  if (buffer.type === 'normal') {
    if (buffer.baseY <= 0) return null;
    const maxScroll = buffer.baseY;
    const size = Math.max(1, Math.min(rows, Math.round(rows * rows / (maxScroll + rows))));
    const top = clamp(Math.round((buffer.viewportY / maxScroll) * (rows - size)), 0, rows - size);
    return { top, size, maxScroll, mode: 'exact' };
  }

  if (buffer.type !== 'alternate') return null;
  // Codex owns this full-screen buffer's scroll position, so the HUB tracks
  // page navigation as an estimate instead of claiming an exact proportion.
  const maxScroll = alternateScrollRange;
  const size = Math.max(1, Math.min(rows, Math.round(rows / 5)));
  const offset = clamp(approximateOffset, 0, maxScroll);
  const top = clamp(Math.round((1 - offset / maxScroll) * (rows - size)), 0, rows - size);
  return { top, size, maxScroll, mode: 'estimated' };
}

export function scrollTarget(pointerRow, pointerOffset, thumb, rows) {
  const travel = Math.max(0, rows - thumb.size);
  const top = clamp(pointerRow - pointerOffset, 0, travel);
  if (travel === 0) return 0;
  const ratio = top / travel;
  return Math.round((thumb.mode === 'exact' ? ratio : 1 - ratio) * thumb.maxScroll);
}

export function scrollbarRows(terminal, options = {}, approximateOffset = 0) {
  const thumb = scrollThumb(terminal.buffer.active, terminal.rows, approximateOffset);
  const track = options.ascii ? '|' : '│';
  const handle = options.ascii ? '#' : '┃';
  return Array.from({ length: terminal.rows }, (_, row) => {
    if (!thumb) return ' ';
    const active = row >= thumb.top && row < thumb.top + thumb.size;
    const glyph = active ? handle : track;
    if (options.color === false) return glyph;
    return `${active ? '\x1b[1;38;2;73;208;255m' : '\x1b[38;2;56;76;86m'}${glyph}\x1b[0m`;
  });
}
