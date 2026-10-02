# HUD independiente y controles nativos

Rodrigo aprobó priorizar controles nativos y mover el mismo HUD a un panel
inferior separado dentro de Windows Terminal. Se conserva la estética existente.

## Contrato

- Codex se inicia con stdin/stdout/stderr heredados, sin PTY intermedio, xterm,
  captura de teclado, traducción de mouse ni repintado del chat.
- Windows Terminal crea una división horizontal inferior. Sólo ese panel dibuja
  el HUD. El foco vuelve al chat después de crear la división.
- No se escribe settings.json, perfiles de PowerShell ni configuración de Codex.
- Para identificar la sesión, se solicita un título de metadatos mediante
  argumentos temporales de Codex. Un proceso auxiliar Windows lee ese título
  mediante GetConsoleTitle; nunca lee la entrada del chat. Se conservan los
  controles y la línea de estado propios de Codex.
- Un canal local por ejecución lleva las métricas al HUD. Sin identidad exacta,
  se muestra espera, nunca otra conversación elegida por proximidad temporal.
- Cerrar el HUD no cierra Codex. Terminar Codex desconecta y termina el HUD.
- Si no se puede abrir el panel, Codex continúa nativo con un diagnóstico breve.
- El emulador anterior sólo queda disponible mediante --integrated explícito,
  documentado como modo de compatibilidad con limitaciones.

## Composición y movimiento

Chat superior con scrollbar y enlaces administrados por el terminal/Codex.
Panel inferior de aproximadamente seis filas, separador nativo de Windows
Terminal y métricas existentes. Sin barra ficticia superpuesta al chat. Las
animaciones del HUD, cuando exista señal fiable, sólo afectan su propio panel.

## Validación

Pruebas de argumentos y stdio heredado; canal de métricas aislado; lectura real
de título en ConPTY; inicio/teclado/redimensionado/salida de Codex sin enviar
prompts; comprobación manual pendiente de Ctrl+clic en la ventana visible.

No se declarará que un test de OSC8 prueba un clic físico. La revisión y la PR
preceden al merge y a cualquier actualización de la instalación activa.
