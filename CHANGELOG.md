# Changelog

## 0.7.0

- El inicio normal abre una ventana identificada con Codex nativo arriba y el
  HUD en un panel inferior independiente. El HUB no captura el teclado ni el
  mouse del chat, ni reconstruye su pantalla.
- Ambos paneles se crean en una sola operación de Windows Terminal; no se
  divide la última conversación enfocada por el usuario.
- Las métricas se vinculan por el título de sesión leído con un auxiliar de
  sólo lectura. Hasta que Codex guarda métricas, los campos quedan sin datos.
- El emulador anterior queda bajo `--integrated`, con sus límites de scroll.
  En ese modo se corrige la pérdida de enlaces OSC8 y el repintado vacío.
- El instalador sólo cambia perfiles, PATH persistente y efectos de Windows
  Terminal cuando se solicita la opción correspondiente explícitamente.

## 0.6.1

- La barra del historial queda visual y Windows Terminal conserva Ctrl+clic,
  selección y rueda nativos; `Shift+PageUp` / `Shift+PageDown` desplazan el chat.
- El indicador MODEL se actualiza al elegir modelos anteriores.
- El encabezado del HUD elimina la regla de relleno y conserva los separadores.

## 0.6.0

- La rueda del mouse recorre el chat en vez de cambiar el texto del editor.
- El HUD reemplaza los rellenos diagonales por reglas horizontales finas.
- La señal viva de compactación de Codex activa un pulso que converge al centro;
  `--ascii` conserva la salida ASCII y `--no-color` mantiene el estado fijo.

## 0.5.0

- Automatic stable-release checks once daily when starting the installed HUD.
- Downloads are verified against release SHA-256 sums before applying updates.
- Updates preserve native dependencies and user settings, and restart the HUD
  before opening Codex. Existing chats remain open on their current version.
- Added `update`, `update --check`, `--no-update` and an environment opt-out.
- The README download button points directly to the latest Windows installer.

## 0.4.3

- Window titles prefer the saved Codex chat name and follow renames.
- Optional `--title` sets a task name explicitly.
- Opening in the user home folder shows "Nueva tarea" instead of the username.

## 0.4.2

- Window and tab titles now identify the current project instead of HUD branding.
- Titles update when a resumed session resolves to a different project.
- Windows test command works with both Node.js 20 and 24.

## 0.4.1

- GAONA-HUB branding and visible byGaona signature.
- Prepared public source repository and downloadable Windows release.

## 0.4.0

- Context usage now has a proportional orange bar; weekly quota is beside CTX.
- Live FAST ON/OFF from native Codex metadata, last typed slash command and
  explicit skill indicator in the header.
- Skill-file reads retain only skill names, without storing tool arguments.
- Includes Windows Terminal glow and clean installation profile.

## 0.3.1

- Added a compiled-verified Windows Terminal HLSL glow shader, restricted to
  saturated colors near the bottom so white chat text stays sharp.
- Installer creates the Gaona-HUB Terminal profile and enables its glow.
- Optional current PowerShell profile activation; uninstall restores previous
  shader settings from a single installation state file.

## 0.3.0

- Renamed the product, command and release to Gaona-HUB (`gaona-hub`).
- Cyan/purple title styling with slash rails filling unused heading space.
- Metric headings use slash padding; PROJECT uses a filled geometric marker.

## 0.2.0

- Default launch now integrates the official Codex CLI and a fixed HUD below its
  chat in one terminal. A patched or downgraded Codex binary is not required.
- ConPTY/node-pty and an xterm VT viewport isolate chat redraws from the footer.
- Native terminal-title metadata binds the actual session, model, reasoning and
  status, including truncated IDs resolved uniquely against local session files.
- Keyboard, paste, terminal replies, mouse modes and resizing forwarded to Codex.
- Optional PowerShell `codex` integration with backups and uninstall support.
- Verified on Windows 11, Node 24.19.0 and official Codex CLI 0.159.3.

## 0.1.0

- Initial terminal release inspired by a cyan, purple, green and magenta HUD.
- Live local Codex session metadata: context, tokens, model, project, Git, status, weekly reset and task duration.
- Ctrl+K task launcher, session switching, responsive layout and ASCII mode.
- Cross-platform Node CLI with no runtime dependencies; Windows installer and distributable npm archive.
- Optional footer output for a separately supplied compatible Codex binary.
