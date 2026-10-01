# Changelog

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
