// Adaptador para @xterm/headless 6.0.0 (versión fijada en package.json).
// La API pública no expone el destino OSC 8 de una celda. Centralizamos
// el acceso interno y comprobamos su contrato mediante reproducción VT.
export function cellHyperlink(terminal, cell) {
  const id = cell.extended?.urlId;
  if (!id) return '';
  const data = terminal._core?._oscLinkService?.getLinkData(id);
  if (!data?.uri || /[\x00-\x1f\x7f-\x9f]/.test(data.uri)) return '';
  // El terminal exterior decide cómo abrirlo y qué protocolos permite.
  // El HUB nunca ejecuta el destino ni captura el clic.
  return `\x1b]8;id=gaona-${id};${data.uri}\x1b\\`;
}

export const closeHyperlink = '\x1b]8;;\x1b\\';
