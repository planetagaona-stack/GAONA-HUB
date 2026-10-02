# Barra desplazadora del chat de GAONA-HUB — Plan de implementación

> **Para agentes:** ejecutar el plan en la rama aislada `fix/scrollbar-drag`, paso a paso y manteniendo el alcance aprobado.

**Meta:** permitir ver la posición dentro del historial de Codex y navegarlo con un deslizador funcional dentro del chat integrado.

**Arquitectura:** un módulo pequeño calcula el tamaño, posición y destino del thumb desde el buffer normal de xterm. En el buffer alternativo de Codex, estima la posición desde las acciones de navegación que observa el HUB. El renderer añade una columna fija al borde del chat, y el controlador del terminal interpreta solo los reportes SGR sobre esa columna para hacer clic y arrastre; los demás eventos conservan la ruta actual.

**Stack:** Node.js ES modules, `@xterm/headless` 6.0.0, ANSI/SGR mouse, terminal de Windows.

---

## Mapa de archivos

- Crear `src/scrollbar.js`: geometría del thumb, conversión de la fila del puntero a `viewportY` y glifos de la pista.
- Modificar `src/terminal-view.js`: reservar el gutter de una celda, componerlo junto al frame del chat, quitar la regla que rellena el encabezado después del título y leer el modelo marcado como actual en el buffer visible.
- Modificar `src/terminal.js`: sincronizar ancho del PTY, preservar coordenadas SGR, controlar clic/arrastre y aplicar el modelo actual leído del selector sin alterar rueda ni atajos existentes.
- La revisión se limita a esos tres archivos. No se cambian el HUD, sus métricas, el estilo de compactación ni los perfiles de Windows Terminal.

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
  al fondo y `120` arriba. Marcarlo `mode: 'estimated'` para que el controlador
  traduzca el drag a `PageUp` / `PageDown`.

- [ ] Crear `scrollTarget(pointerRow, pointerOffset, thumb, rows)`. Limitar el comienzo del thumb a `[0, rows - thumb.size]`; convertirlo a `[0, thumb.maxScroll]` para el buffer normal y usar la dirección invertida para el buffer alternativo. Si `rows === thumb.size`, devolver `0`.
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
- [ ] Ampliar el token SGR del mouse para conservar `x`, `y` y el terminador (`M` o `m`):

```js
tokens.push({
  type: 'mouse', raw: mouse[0], code: Number(mouse[1]),
  x: Number(mouse[2]), y: Number(mouse[3]), action: mouse[4]
});
```

- [ ] En el callback de `terminal.write` de `child.onData`, llamar `modelPickerState(terminal)`. Si devuelve datos, guardar `current` como el modelo retenido y reflejarlo en `state.model`.
- [ ] Antes de reenviar texto que contiene Enter al hijo, consultar `modelPickerState(terminal)`. Si existe, guardar `active` como el nuevo modelo retenido; Enter en el composer no cambia nada porque el parser devuelve `null` fuera del selector.
- [ ] Al cambiar el UUID de sesión en `onTitleChange`, limpiar el modelo retenido antes de aplicar las señales de título de la sesión nueva. Durante la misma sesión, aplicar el modelo retenido después de `runtimeSignals` en cada actualización de estado para que una señal vieja no lo revierta.

- [ ] Solicitar tracking SGR de arrastre (`1002`) al terminal exterior. Al reenviar reportes al hijo, mantener la condición existente basada en `terminal.modes.mouseTrackingMode`; así los eventos añadidos por el HUB fuera del gutter no llegan a Codex si este no pidió tracking.
- [ ] Mantener `scrollbarDragging`, `scrollbarDragOffset` y el offset alternativo estimado. Un press izquierdo (`action === 'M'`, botón izquierdo en `code`) en la última columna del terminal y dentro de `chatRows` inicia el arrastre. Si el press cae fuera del thumb, centrar el thumb en esa fila y saltar al destino.
- [ ] Mientras se arrastra, mapear la fila SGR a `scrollTarget(...)`. En buffer normal, llamar `terminal.scrollLines(target - terminal.buffer.active.viewportY)`; en buffer alternativo, enviar la diferencia estimada como `PageUp` / `PageDown`. Procesar el release (`action === 'm'`) antes de filtrar eventos del footer, para terminar el gesto aunque el puntero salga del chat.
- [ ] Interceptar exclusivamente la columna del gutter para clic/arrastre. Conservar el encaminamiento actual de rueda, `Shift+PageUp` y `Shift+PageDown`, y el tratamiento de eventos en el resto del chat/footer.

## Tarea 3: revisión estática y entrega en rama

**Archivos:** los tres archivos de implementación anteriores.

- [ ] Revisar manualmente la posición aproximada del buffer alternativo, los estados `baseY === 0`, thumb en los extremos, click sobre pista, drag hasta fuera del chat y resize.
- [ ] Ejecutar `rtk node --check src/scrollbar.js`, `rtk node --check src/terminal-view.js` y `rtk node --check src/terminal.js`.
- [ ] Ejecutar `rtk git diff --check` y revisar `rtk git diff` para confirmar que el HUD y otros flujos no cambiaron.
- [ ] No agregar ni ejecutar tests automatizados en esta tarea, según la instrucción activa de no hacerlo salvo solicitud del usuario.
- [ ] Commit de implementación: `fix: añade desplazamiento con barra en el chat`.
- [ ] Publicar la rama y abrir una Pull Request; revisar el diff y los checks automáticos antes de cualquier merge.

## Autorrevisión contra el diseño aprobado

- Dirección visual: cian/gris discreto, un solo gutter, sin animación; `--ascii` y `--no-color` considerados. El scrollback normal es exacto y Codex fullscreen usa una estimación.
- Modelo: leer la opción `(current)`, actualizar al confirmar la fila activa con Enter, ignorar filas resaltadas sin confirmar y mantener el modelo al cerrar el selector o refrescar la sesión actual.
- Comportamiento: posición proporcional, clic y arrastre, sin retirar rueda ni atajos existentes.
- Aislamiento: solo renderer, controlador del terminal y módulo nuevo de geometría; las demás métricas del HUD, compactación y perfil externo quedan fuera del cambio. El título del HUD deja de tener regla de relleno, manteniendo los separadores existentes.
- Estados límite: buffer alternativo, historial vacío, thumb que ocupa toda la pista, release fuera del chat y redimensionado están cubiertos.
