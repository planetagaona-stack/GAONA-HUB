# Diseño: barra funcional para el historial del chat

## Objetivo

Hacer que la posición y el desplazamiento del historial de Codex se puedan
controlar con una barra visible dentro del chat integrado de GAONA-HUB.
El alcance se limita a la navegación del chat y al ajuste minimalista pedido
para el encabezado; el resto del HUD y de los controles conserva su
comportamiento actual. También se actualizará el indicador `MODEL` cuando el
selector de Codex muestre un modelo actual distinto al último registrado.

## Dirección visual

La barra será una columna delgada y discreta en el borde derecho del chat. La
pista usará un tono gris azulado de bajo contraste y el deslizador un cian del
sistema visual actual. No tendrá animación ni etiquetas permanentes. El gutter
mantendrá un ancho estable de una columna; la barra se ocultará cuando no exista
historial desplazable o Codex esté en su buffer alternativo. `--ascii` y
`--no-color` conservarán sus variantes legibles. En el encabezado del HUD se
eliminará la regla que rellena el espacio después del título y se mantendrán las
líneas que sí separen secciones.

## Comportamiento

- El largo y la posición del deslizador representarán proporcionalmente el
  historial retenido por el emulador xterm.
- Arrastrar el deslizador moverá el viewport del chat. Hacer clic en la pista
  saltará hacia esa zona del historial.
- La rueda del mouse y `Shift+PageUp` / `Shift+PageDown` seguirán funcionando.
- Los eventos fuera de la columna de la barra seguirán llegando a Codex. Los
  eventos del footer seguirán perteneciendo al HUD.
- La barra tendrá un gutter propio de una columna para no tapar texto del chat;
  el PTY de Codex y el renderer se ajustarán juntos al ancho disponible.
- Si el selector de modelos está visible, el modelo marcado `(current)` será la
  fuente viva de `MODEL`. Al confirmar con Enter, el modelo resaltado pasa a
  ser el valor activo y se conserva en memoria al cerrar el selector para que
  el último `turn_context` o una señal de título antigua no lo reemplacen. Al
  cambiar a otra sesión, se limpia ese valor retenido.

## Arquitectura y estados límite

La barra se dibujará al componer el frame del terminal y consultará el estado
del buffer normal (`baseY`, `viewportY` y filas visibles). El parser SGR del
mouse conservará columna, fila y tipo de evento para identificar clic, arrastre
y liberación. Durante el arrastre, la posición del puntero se convertirá en una
posición de viewport acotada al historial disponible.

El buffer alternativo no tiene scrollback y no mostrará un deslizador falso.
Si no hay historial adicional, tampoco se dibuja la pista. El redimensionado
mantendrá sincronizados el emulador, el PTY y el gutter.

El lector del selector inspeccionará solo las filas visibles del buffer activo
y retendrá únicamente los identificadores del modelo actual y de la opción
resaltada. No guardará texto del chat ni otras líneas del selector.

La barra nativa de Windows Terminal pertenece al buffer externo de la ventana.
La navegación funcional se implementará dentro del viewport del HUB, que es
donde vive el historial del chat. El renderer del encabezado dejará de añadir
una regla decorativa de relleno y conservará solo las líneas separadoras.
La lectura de `(current)` complementará el título y el registro de sesión, que
pueden seguir mostrando el modelo del turno anterior tras cambiar la selección.

## Revisión y validación

Revisar que el deslizador coincida con los extremos y posiciones intermedias del
historial, que el arrastre no consuma eventos del resto del chat, y que el
gutter se mantenga alineado al cambiar el tamaño de la terminal. Revisar también
que `MODEL` refleje `(current)`, cambie al confirmar otra opción y se mantenga
correcto al cerrar el selector y refrescar los datos de sesión. La revisión de
código y los
checks del PR cubrirán el cambio antes de cualquier integración.
