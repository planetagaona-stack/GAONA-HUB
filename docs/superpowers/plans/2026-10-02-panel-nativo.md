# Plan de implementación del panel nativo

**Objetivo:** mantener el HUD inferior con Codex dueño de su terminal.

**Arquitectura:** launcher con stdio heredado, monitor de título Windows de sólo
lectura y panel independiente comunicado por canal local. Node.js, Windows
Terminal y renderizador de métricas existente.

- [x] Probar y construir argumentos del panel sin shell ni interpolación de prompts.
- [x] Implementar lector Windows del título y probarlo contra ConPTY real.
- [x] Implementar transporte de snapshots y ciclo de vida del panel.
- [x] Convertir el arranque normal a nativo; dejar --integrated explícito.
- [x] Probar fallback, identidad exacta, aislamiento de entrada y cierre.
- [x] Actualizar ayuda y documentación, ejecutar suite y smoke pertinentes.
- [ ] Revisión de código, commit y PR. Merge/despliegue sujetos a aprobación.

## Hallazgos ya reproducidos

El renderer 0.6.1 descarta OSC8; corregido y probado en esta rama. Eliminar los
atajos del emulador rompe su historial, por lo que esa propuesta fue retirada.
El instalador ejecutaba configure-terminal sin opt-in; corregido en esta rama.
El diseño aprobado evita estas interferencias en el camino normal de arranque.

## Evidencia de cierre de implementación

- Suite local: 55 pruebas, 55 aprobadas.
- Codex real en dos consolas: arranque, texto no enviado, borrado, resize,
  lectura de título y cierre de ambos procesos con código 0.
- Observador Windows: conserva la entrada raw mientras está conectado.
- Un chat nuevo sin archivo de sesión conserva las métricas pendientes.
  Un título válido sin ID limpia la asociación con la conversación anterior.
- Empaquetado y diff revisados. No se verificó un clic físico del mouse.
- Instalación global anterior conservada hasta aprobar el commit productivo.
