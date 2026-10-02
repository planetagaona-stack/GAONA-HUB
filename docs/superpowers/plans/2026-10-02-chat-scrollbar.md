# Barra desplazadora del chat de GAONA-HUB — Plan de implementación

> **Para agentes:** ejecutar el plan en la rama aislada `fix/scrollbar-drag`, paso a paso y manteniendo el alcance aprobado.

**Meta:** permitir ver la posición dentro del historial de Codex y navegarlo con un deslizador funcional dentro del chat integrado.

**Arquitectura:** un módulo pequeño calcula el tamaño y la posición del thumb desde el buffer normal de xterm. En el buffer alternativo de Codex, estima la posición desde los atajos de página. El renderer añade una columna fija al borde del chat; la barra es visual y el terminal conserva el control nativo de todos los eventos del mouse.

**Stack:** Node.js ES modules, `@xterm/headless` 6.0.0, secuencias VT para teclado y terminal de Windows.

---

## Mapa de archivos

- Crear `src/scrollbar.js`: geometría del thumb, conversión de la fila del puntero a `viewportY` y glifos de la pista.
- Modificar `src/terminal-view.js`: reservar el gutter de una celda, componerlo junto al frame del chat, quitar la regla que rellena el encabezado después del título y leer el modelo marcado como actual en el buffer visible.
- Modificar `src/terminal.js`: sincronizar ancho del PTY, mantener desactivados los modos de mouse, conservar los atajos de página y aplicar el modelo actual leído del selector.
- Actualizar las expectativas existentes de `test/terminal.test.js` para el gutter y el encabezado. No se agregan ni ejecutan tests.
- No se cambian el HUD, sus métricas, el estilo de compactación ni los perfiles de Windows Terminal.

## Tarea 1: geometría y representación de la barra

**Archivos:** crear `src/scrollbar.js`; modificar `src/terminal-view.js`.

- [ ] Crear `scrollThumb(buffer, rows, approximateOffset)`. En el buffer normal, devolver `null` si `buffer.baseY <= 0` o `rows < 1`; si no, usar el scrollback exacto. En el buffer alternativo, devolver un thumb estimado que represente hasta 120 avances de página, ya que Codex no expone su posición real:

```js
const maxScroll = buffer.baseY;
const size = Math.max(1, Math.min(rows, Math.round(rows * rows / (maxScroll + rows))));
const top = Math.max(0, Math.min(rows - size,
  Math.round((buffer.viewportY / maxScroll) * (rows - size))));
return { top, size, maxScroll, mode: 'exact' };
```

  Para el buffer alternativo, invertir la dirección visual del offset: `0` queda
  al fondo y `120` arriba. Marcarlo `mode: 'estimated'` para indicar que la
  posición es aproximada y se basa en atajos de página.

- [ ] Crear `scrollbarRows(terminal, options, approximateOffset)`. Para cada fila usar `│` de pista y `┃` de thumb; en `--ascii`, usar `|` y `#`. Colorear pista en gris azulado y thumb en cian solo cuando `options.color !== false`. En el buffer normal sin historial, devolver espacios para conservar el ancho.
- [ ] En `layoutScreen`, exponer `chatColumns: Math.max(1, columns - 1)`. Mantener `columns` como ancho completo del terminal para que el HUD conserve su tamaño.
- [ ] Quitar la regla horizontal que solo rellena el espacio después del título del HUD. Construir el encabezado solo con el título y su estilo actual:

```js
const heading = options.color === false
  ? title
  : `\x1b[1;38;2;73;208;255m${title}\x1b[0m`;
```

- [ ] Conservar cualquier línea que se use para separar secciones; no reemplazar el relleno eliminado con otro adorno.
- [ ] Crear `modelPickerState(terminal)`. Revisar `translateToString(true)` de las filas visibles del buffer activo y extraer solo los identificadores de las opciones numeradas. Reconocer los marcadores de fila activa `>`, `›` y `❯`; devolver `null` salvo que exista exactamente una opción `(current)` y una opción activa.

```js
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
```

- [ ] En `drawFrame`, añadir una celda de `scrollbarRows` a cada fila de `bufferRows`. Mantener las filas de footer a ancho completo y limitar el cursor del chat a `chatColumns`.

## Tarea 2: interacción y redimensionado

**Archivo:** modificar `src/terminal.js`.

- [ ] Crear el emulador y el PTY con `layout.chatColumns`. En `refresh` y `applyCompactionView`, comparar y redimensionar con `layout.chatColumns`; conservar `layout.columns` como ancho exterior.
- [ ] En el callback de `terminal.write` de `child.onData`, llamar `modelPickerState(terminal)`. Si devuelve datos, guardar `current` como el modelo retenido y reflejarlo en `state.model`.
- [ ] Antes de reenviar texto que contiene Enter al hijo, consultar `modelPickerState(terminal)`. Si existe, guardar `active` como el nuevo modelo retenido; Enter en el composer no cambia nada porque el parser devuelve `null` fuera del selector.
- [ ] Al cambiar el UUID de sesión en `onTitleChange`, limpiar el modelo retenido antes de aplicar las señales de título de la sesión nueva. Durante la misma sesión, aplicar el modelo retenido después de `runtimeSignals` en cada actualización de estado para que una señal vieja no lo revierta.

- [ ] Mantener desactivados los modos de mouse del terminal exterior, incluso si Codex los solicita internamente. No parsear ni reenviar eventos SGR; la barra es visual y Windows Terminal conserva Ctrl+clic, selección y rueda.
- [ ] Conservar `Shift+PageUp` y `Shift+PageDown` para navegar el chat.

## Tarea 3: revisión estática y entrega en rama

**Archivos:** los tres archivos de implementación anteriores.

- [ ] Revisar manualmente la posición aproximada del buffer alternativo, los estados `baseY === 0`, el thumb en los extremos y el resize.
- [ ] Ejecutar `rtk node --check src/scrollbar.js`, `rtk node --check src/terminal-view.js` y `rtk node --check src/terminal.js`.
- [ ] Ejecutar `rtk git diff --check` y revisar `rtk git diff` para confirmar que el HUD y otros flujos no cambiaron.
- [ ] No agregar ni ejecutar tests automatizados en esta tarea, según la instrucción activa de no hacerlo salvo solicitud del usuario.
- [ ] Commit de implementación: `fix: añade desplazamiento con barra en el chat`.
- [ ] Publicar la rama y abrir una Pull Request; revisar el diff y los checks automáticos antes de cualquier merge.

## Autorrevisión contra el diseño aprobado

- Dirección visual: cian/gris discreto, un solo gutter, sin animación; `--ascii` y `--no-color` considerados. El scrollback normal es exacto y Codex fullscreen usa una estimación.
- Modelo: leer la opción `(current)`, actualizar al confirmar la fila activa con Enter, ignorar filas resaltadas sin confirmar y mantener el modelo al cerrar el selector o refrescar la sesión actual.
- Comportamiento: barra visual, mouse nativo sin captura y navegación por `Shift+PageUp` / `Shift+PageDown`.
- Aislamiento: solo renderer, controlador del terminal y módulo nuevo de geometría; las demás métricas del HUD, compactación y perfil externo quedan fuera del cambio. El título del HUD deja de tener regla de relleno, manteniendo los separadores existentes.
- Estados límite: buffer alternativo, historial vacío, thumb que ocupa toda la pista y redimensionado están cubiertos.
